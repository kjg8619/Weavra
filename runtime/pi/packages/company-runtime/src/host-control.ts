import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import runtimePackage from "../package.json" with { type: "json" };
import { validBrowserCheckEvidence } from "./browser-evidence.ts";
import {
	BrowserRegistrationError,
	commitBrowserRegistration,
	listBrowserCandidates,
	type PreparedBrowserRegistration,
	prepareBrowserRegistration,
} from "./browser-registry.ts";
import { browserDigest, browserProjectId } from "./browser-types.ts";
import { loadRuntimeConfig } from "./config.ts";
import type { ApprovalDecision, ApprovalRequest, Run } from "./contracts.ts";
import { taskContractDigest } from "./criterion-evidence.ts";
import type { RuntimeEventSink } from "./events.ts";
import type { HostBridgeConnection } from "./host-bridge.ts";
import {
	projectHostEvidence,
	projectHostGraph,
	readHostConfiguration,
	readHostObservation,
} from "./host-bridge-projections.ts";
import type { HostBridgeIdentity, HostSnapshotSummary } from "./host-bridge-protocol.ts";
import {
	HOST_CONTROL_COMMANDS,
	HOST_CONTROL_MAX_REQUEST_BYTES,
	HOST_CONTROL_MAX_RESPONSE_BYTES,
	HOST_CONTROL_PREVIEW_TTL_MS,
	HOST_CONTROL_RESULT_LIMIT,
	type HostBrowserPreview,
	type HostBrowserState,
	type HostControlApproval,
	type HostControlCapabilities,
	type HostControlData,
	type HostControlErrorCode,
	type HostControlMutation,
	type HostControlPreview,
	type HostControlRequest,
	HostControlRequestSchema,
	type HostControlResponse,
} from "./host-control-protocol.ts";
import {
	applyHostWorkflowRecipe,
	createHostWorkflow,
	finalizeHostWorkflowPlan,
	HostWorkflowError,
	prepareHostWorkflowDraft,
} from "./host-workflow.ts";
import { FileStateStore } from "./state-store.ts";
import { listTaskRecipes, recipeInputTemplate } from "./task-recipes.ts";
import type { StandardWorkflow } from "./workflow.ts";

class ControlError extends Error {
	readonly code: HostControlErrorCode;
	constructor(code: HostControlErrorCode) {
		super(code);
		this.code = code;
	}
}
function fingerprint(value: unknown): string {
	return `sha256:${createHash("sha256")
		.update(
			JSON.stringify(value, (_key, item: unknown) => {
				if (!item || typeof item !== "object" || Array.isArray(item)) return item;
				return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)));
			}),
		)
		.digest("hex")}`;
}
function isActive(run: Run | undefined): boolean {
	return !!run && ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run.status);
}
type Prepared = {
	plan: ReturnType<typeof finalizeHostWorkflowPlan>;
	preview: HostControlPreview;
	configurationDigest: string;
	consumed: boolean;
};
type PendingApproval = { request: ApprovalRequest; settle: (approved: boolean) => void };
export interface HostControlOptions {
	cwd: string;
	projectTrusted: boolean;
	agentDir: string;
	readiness?: HostControlCapabilities["readiness"];
	createModels?: (signal: AbortSignal) => Promise<ModelRuntime>;
	events?: RuntimeEventSink;
	approvalTimeoutMs?: number;
	now?: () => number;
}

/** Owns commands, not workflow transitions. The existing Workflow/Kernel remains the sole execution authority. */
export class HostControlBridge {
	readonly ownerId = randomUUID();
	private readonly options: HostControlOptions;
	private readonly root: { path: string; dev: number; ino: number };
	private readonly connections = new Set<HostBridgeConnection>();
	private sequence = 0;
	private readonly receipts = new Map<number, { fingerprint: string; response: HostControlResponse }>();
	private queue = Promise.resolve();
	private queued = 0;
	private disposed = false;
	private prepared?: Prepared;
	private browserPrepared?: {
		registration: PreparedBrowserRegistration;
		preview: HostBrowserPreview;
		consumed: boolean;
	};
	private workflow?: StandardWorkflow;
	private execution?: Promise<void>;
	private cancellation?: AbortController;
	private cancelling = false;
	private startFailure: "START_FAILED" | null = null;
	private approval?: PendingApproval;

	private constructor(options: HostControlOptions, root: { path: string; dev: number; ino: number }) {
		this.options = { ...options, cwd: root.path };
		this.root = root;
	}
	static async create(options: HostControlOptions): Promise<HostControlBridge> {
		if (options.projectTrusted !== true) throw new ControlError("CONTROL_UNAVAILABLE");
		const path = await realpath(options.cwd);
		const stat = await lstat(path);
		if (!stat.isDirectory()) throw new ControlError("PROJECT_CHANGED");
		return new HostControlBridge(options, { path, dev: stat.dev, ino: stat.ino });
	}
	private now(): number {
		return (this.options.now ?? Date.now)();
	}
	private identity(): HostBridgeIdentity {
		return {
			protocolVersion: 1,
			runId: null,
			stateRevision: null,
			projectRevision: null,
			eventId: null,
			timestamp: this.now(),
		};
	}
	private async assertRoot(): Promise<void> {
		try {
			const path = await realpath(this.root.path);
			const stat = await lstat(path);
			if (path !== this.root.path || !stat.isDirectory() || stat.dev !== this.root.dev || stat.ino !== this.root.ino)
				throw new Error("changed");
		} catch {
			throw new ControlError("PROJECT_CHANGED");
		}
	}
	private failure(code: HostControlErrorCode, id: string | null, command: string | null): HostControlResponse {
		return {
			...this.identity(),
			type: "control_response",
			id,
			command,
			ownerId: this.ownerId,
			success: false,
			error: { code },
		};
	}
	private success(
		request: HostControlRequest,
		data: HostControlData,
		identity: Partial<HostBridgeIdentity> = {},
	): HostControlResponse {
		return {
			...this.identity(),
			...identity,
			type: "control_response",
			id: request.id,
			command: request.type,
			ownerId: this.ownerId,
			success: true,
			data,
		};
	}
	private async canonical() {
		await this.assertRoot();
		try {
			return await FileStateStore.readSnapshot(this.root.path);
		} catch {
			throw new ControlError("STATE_UNAVAILABLE");
		}
	}
	private async configuration() {
		try {
			const loaded = await loadRuntimeConfig(this.root.path);
			if (loaded.status !== "configured") throw new Error("missing");
			return loaded.config;
		} catch {
			throw new ControlError("CONTROL_UNAVAILABLE");
		}
	}
	private async idleRevision(expected: number): Promise<void> {
		if (this.execution) throw new ControlError("ACTIVE_RUN");
		const snapshot = await this.canonical();
		if ((snapshot.state?.revision ?? 0) !== expected) throw new ControlError("STALE_PROJECT");
		if (snapshot.writerPresent) throw new ControlError("WRITER_PRESENT");
		if (snapshot.state?.runs.some(isActive)) throw new ControlError("ACTIVE_RUN");
	}
	private async currentRun(request: Extract<HostControlMutation, { runId: string }>): Promise<Run> {
		const snapshot = await this.canonical();
		const run = snapshot.state?.runs.find((value) => value.runId === request.runId);
		if (!run) throw new ControlError("RUN_NOT_FOUND");
		if ((snapshot.state?.revision ?? 0) !== request.expectedProjectRevision) throw new ControlError("STALE_PROJECT");
		if (run.revision !== request.expectedStateRevision) throw new ControlError("STALE_RUN");
		if (!isActive(run)) throw new ControlError("TERMINAL_RUN");
		const owned = this.workflow?.snapshot;
		if (!this.execution || owned?.runId !== run.runId) throw new ControlError("RUN_NOT_OWNED");
		// The live owner may have advanced while the canonical read awaited I/O. No yield after this fence.
		if (
			owned.revision !== run.revision ||
			this.workflow?.observationState?.revision !== request.expectedProjectRevision
		)
			throw new ControlError("STALE_RUN");
		return run;
	}
	private requestApproval(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision> {
		return new Promise((resolve) => {
			let settled = false;
			const pending: PendingApproval = {
				request: structuredClone(request),
				settle: (approved) => {
					if (settled) return;
					settled = true;
					signal?.removeEventListener("abort", abort);
					if (this.approval === pending) this.approval = undefined;
					resolve({
						runId: request.runId,
						actionId: request.actionId,
						actionDigest: request.actionDigest,
						configDigest: request.configDigest,
						expiresAt: request.expiresAt,
						approved: approved && !signal?.aborted && this.now() < request.expiresAt,
					});
				},
			};
			const abort = () => pending.settle(false);
			this.approval?.settle(false);
			this.approval = pending;
			signal?.addEventListener("abort", abort, { once: true });
			if (signal?.aborted || this.disposed) abort();
		});
	}
	private async snapshot(request: HostControlRequest, attempt = 0): Promise<HostControlResponse> {
		await this.assertRoot();
		const execution = this.execution;
		const observation = await readHostObservation(this.root.path);
		if (observation.status.state === "unavailable") throw new ControlError("STATE_UNAVAILABLE");
		let graph: HostSnapshotSummary["graph"] = null;
		if (observation.run) {
			try {
				graph = projectHostGraph(observation.run);
			} catch {
				/* Do not reconstruct unavailable evidence. */
			}
		}
		const configuration = await readHostConfiguration(this.root.path);
		await this.assertRoot();
		const run = observation.run;
		const projectRevision = observation.identity.projectRevision ?? 0;
		const pending = this.approval?.request;
		let pendingApproval: HostControlApproval | null = null;
		if (
			pending &&
			run?.runId === pending.runId &&
			run.status === "WAITING_APPROVAL" &&
			pending.expiresAt > this.now() &&
			pending.step.stepId === "implement" &&
			run.approvals?.some((record) => record.request.actionId === pending.actionId && record.status === "PENDING")
		) {
			pendingApproval = {
				approvalId: pending.actionId,
				runId: run.runId,
				stateRevision: run.revision,
				projectRevision,
				risk: "R3",
				operation: "delete-file",
				role: "Developer",
				step: { stepId: "implement", attempt: pending.step.attempt },
				path: pending.path,
				bytes: pending.bytes,
				preconditionDigest: pending.preconditionDigest,
				expiresAt: pending.expiresAt,
				explanation:
					"Delete one tracked text file. Approval is one-time and does not establish completion. No automatic rollback.",
			};
		}
		let preview =
			this.prepared &&
			!this.prepared.consumed &&
			this.prepared.preview.expiresAt > this.now() &&
			this.prepared.preview.projectRevision === projectRevision
				? this.prepared.preview
				: null;
		if (preview) {
			try {
				if (fingerprint(await this.configuration()) !== this.prepared?.configurationDigest) preview = null;
			} catch {
				preview = null;
			}
		}
		const browserPrepared = this.browserPrepared;
		let browserPreview =
			browserPrepared &&
			!browserPrepared.consumed &&
			browserPrepared.preview.expiresAt > this.now() &&
			browserPrepared.preview.projectRevision === projectRevision
				? browserPrepared.preview
				: null;
		if (browserPreview && browserPrepared) {
			try {
				const current = await prepareBrowserRegistration(this.root.path, browserPrepared.registration.request);
				if (browserDigest(current) !== browserDigest(browserPrepared.registration)) browserPreview = null;
			} catch {
				browserPreview = null;
			}
		}
		// File reads yield while the owner may finish/release its writer. Never combine
		// an earlier durable snapshot with a later idle owner and advertise it as coherent.
		if (this.execution !== execution) {
			if (attempt >= 2) throw new ControlError("STATE_UNAVAILABLE");
			return this.snapshot(request, attempt + 1);
		}
		return this.success(
			request,
			{
				kind: "snapshot",
				state: {
					ownerId: this.ownerId,
					nextRequestId: `${this.ownerId}:${this.sequence + 1}`,
					projectRevision,
					stateRevision: observation.identity.stateRevision,
					ownedRunId: this.workflow?.snapshot?.runId ?? null,
					busy: this.execution !== undefined,
					cancelling: this.cancelling,
					startFailure: this.startFailure,
					preview,
					browserPreview,
					pendingApproval,
					snapshot: {
						status: observation.status,
						graph,
						graphAvailable: graph !== null,
						evidence: run ? projectHostEvidence(run) : null,
						configuration,
					},
				},
			},
			observation.identity,
		);
	}
	private async mutate(request: HostControlMutation): Promise<HostControlResponse> {
		if ((this.options.readiness ?? "READY") !== "READY") throw new ControlError("CONTROL_UNAVAILABLE");
		if (request.type === "browser.inspect") {
			const before = await this.canonical();
			if ((before.state?.revision ?? 0) !== request.expectedProjectRevision) throw new ControlError("STALE_PROJECT");
			const config = await this.configuration();
			const listed = await listBrowserCandidates(this.root.path);
			const projectId = browserProjectId(this.root.path);
			const registered = config.verification.checks.filter((check) => check.kind === "browser");
			if (registered.some((check) => check.browser.projectId !== projectId))
				throw new ControlError("BROWSER_UNAVAILABLE");
			const run = before.state?.runs.at(-1);
			const checks = run?.verification.filter((check) => check.kind === "browser") ?? [];
			for (const check of checks) {
				if (
					check.exitCode !== null ||
					check.failureKind !== undefined ||
					check.sandbox !== undefined ||
					(check.browser
						? check.browser.projectId !== projectId || !validBrowserCheckEvidence(check)
						: check.status === "PASS")
				)
					throw new ControlError("STATE_UNAVAILABLE");
			}
			const state: HostBrowserState = {
				projectId,
				candidates: listed.candidates,
				omittedCandidates: listed.omitted,
				checks: registered
					.slice(-2)
					.map((check) => ({ check: structuredClone(check.browser), required: check.required })),
				omittedChecks: Math.max(0, registered.length - 2),
				evidence: checks.slice(-2).map((check) => ({
					runId: check.runId,
					checkId: check.id,
					revision: check.revision,
					step: check.step ?? null,
					status: check.status,
					diffDigest: check.diffDigest,
					browser: check.browser ?? null,
				})),
				omittedEvidence: Math.max(0, checks.length - 2),
			};
			if (((await this.canonical()).state?.revision ?? 0) !== request.expectedProjectRevision)
				throw new ControlError("STALE_PROJECT");
			return this.success(
				request,
				{ kind: "browser-state", state },
				{ projectRevision: request.expectedProjectRevision },
			);
		}
		if (request.type === "browser.prepare") {
			await this.idleRevision(request.expectedProjectRevision);
			const registration = await prepareBrowserRegistration(this.root.path, request.registration);
			const fields = {
				previewId: randomUUID(),
				ownerId: this.ownerId,
				projectRevision: registration.projectRevision,
				expiresAt: this.now() + HOST_CONTROL_PREVIEW_TTL_MS,
				candidate: registration.candidate,
				check: registration.check,
				isolation: "PRIVATE_HOME_PROFILE_CDP_PIPE_NOT_OS_SANDBOX" as const,
			};
			const preview: HostBrowserPreview = {
				...fields,
				previewDigest: browserDigest({ fields, registration, root: this.root }),
			};
			const response = this.success(request, { kind: "browser-prepared", preview });
			if (Buffer.byteLength(JSON.stringify(response)) + 1 > HOST_CONTROL_MAX_RESPONSE_BYTES)
				throw new ControlError("RESPONSE_TOO_LARGE");
			await this.idleRevision(request.expectedProjectRevision);
			if (this.disposed) throw new ControlError("CONTROL_UNAVAILABLE");
			this.prepared = undefined;
			this.browserPrepared = { registration, preview, consumed: false };
			return response;
		}
		if (request.type === "browser.confirm") {
			const prepared = this.browserPrepared;
			if (!prepared || prepared.preview.previewId !== request.previewId) throw new ControlError("PLAN_NOT_FOUND");
			if (prepared.consumed) throw new ControlError("PLAN_CONSUMED");
			if (prepared.preview.expiresAt <= this.now()) throw new ControlError("PLAN_EXPIRED");
			if (prepared.preview.previewDigest !== request.previewDigest) throw new ControlError("PLAN_CHANGED");
			if (prepared.preview.projectRevision !== request.expectedProjectRevision)
				throw new ControlError("STALE_PROJECT");
			await this.idleRevision(request.expectedProjectRevision);
			prepared.consumed = true;
			const check = await commitBrowserRegistration(this.root.path, prepared.registration, () => {
				if (this.disposed) throw new ControlError("CONTROL_UNAVAILABLE");
				if (prepared.preview.expiresAt <= this.now()) throw new ControlError("PLAN_EXPIRED");
			});
			this.prepared = undefined;
			return this.success(
				request,
				{ kind: "browser-registered", check },
				{ projectRevision: request.expectedProjectRevision },
			);
		}
		if (request.type === "workflow.prepare") {
			await this.idleRevision(request.expectedProjectRevision);
			const config = await this.configuration();
			let draft = prepareHostWorkflowDraft({ goal: request.goal, config });
			if (request.recipeInputs && !request.recipeId) throw new ControlError("INVALID_RECIPE");
			if (request.recipeId)
				draft = applyHostWorkflowRecipe(draft, { recipeId: request.recipeId, inputs: request.recipeInputs ?? {} });
			const plan = finalizeHostWorkflowPlan(draft, request.acceptanceStatements ?? draft.statements);
			const fields = {
				previewId: randomUUID(),
				ownerId: this.ownerId,
				projectRevision: request.expectedProjectRevision,
				expiresAt: this.now() + HOST_CONTROL_PREVIEW_TTL_MS,
				goal: plan.goal,
				workflow: plan.workflow,
				executionMode: plan.executionMode,
				risk: plan.risk,
				allowedPaths: [...config.files.allowed_paths],
				checks: config.verification.checks.map(({ id, kind, required }) => ({ id, kind, required })),
				acceptanceCriteria: plan.taskContract.acceptanceCriteria.map((criterion) => ({
					id: criterion.id,
					statement: criterion.statement,
					checkIds: [...criterion.verification.checkIds],
					reviewRequired: criterion.verification.reviewRequired,
				})),
				taskContractDigest: taskContractDigest(plan.taskContract),
				recipe: plan.recipe ?? null,
				configuration: {
					mutationMode: config.mutation.mode,
					verifierTrustMode: config.verification.trust.mode,
					verifierSandboxMode: config.verification.sandbox.mode,
					contextPackMode: config.agents.context_pack.mode,
					verificationRepairMode: config.verification.repair.mode,
					lspEnabled: config.code_intelligence?.lsp.enabled === true,
				},
			};
			const preview: HostControlPreview = {
				...fields,
				previewDigest: fingerprint({ fields, config, root: this.root, contract: plan.taskContract }),
			};
			const response = this.success(request, { kind: "prepared", preview });
			if (Buffer.byteLength(JSON.stringify(response)) + 1 > HOST_CONTROL_MAX_RESPONSE_BYTES)
				throw new ControlError("RESPONSE_TOO_LARGE");
			await this.idleRevision(request.expectedProjectRevision);
			this.prepared = { plan, preview, configurationDigest: fingerprint(config), consumed: false };
			this.browserPrepared = undefined;
			return response;
		}
		if (request.type === "workflow.confirm") {
			const prepared = this.prepared;
			if (!prepared || prepared.preview.previewId !== request.previewId) throw new ControlError("PLAN_NOT_FOUND");
			if (prepared.consumed) throw new ControlError("PLAN_CONSUMED");
			if (prepared.preview.expiresAt <= this.now()) throw new ControlError("PLAN_EXPIRED");
			if (prepared.preview.previewDigest !== request.previewDigest) throw new ControlError("PLAN_CHANGED");
			if (prepared.preview.projectRevision !== request.expectedProjectRevision)
				throw new ControlError("STALE_PROJECT");
			await this.idleRevision(request.expectedProjectRevision);
			if (fingerprint(await this.configuration()) !== prepared.configurationDigest)
				throw new ControlError("CONFIG_CHANGED");
			await this.idleRevision(request.expectedProjectRevision);
			if (this.disposed) throw new ControlError("CONTROL_UNAVAILABLE");
			if (prepared.preview.expiresAt <= this.now()) throw new ControlError("PLAN_EXPIRED");
			prepared.consumed = true;
			this.workflow = undefined;
			this.startFailure = null;
			this.cancelling = false;
			this.cancellation = new AbortController();
			const signal = this.cancellation.signal;
			this.execution = (async () => {
				try {
					const workflow = await createHostWorkflow({
						cwd: this.root.path,
						plan: prepared.plan,
						agentDir: this.options.agentDir,
						signal,
						createModels: this.options.createModels,
						events: this.options.events,
						approvalTimeoutMs: this.options.approvalTimeoutMs,
						approval: {
							requestApproval: (approval, cancellation) => this.requestApproval(approval, cancellation),
						},
						startGuard: async (store) => {
							await this.assertRoot();
							if (store.snapshot.revision !== request.expectedProjectRevision)
								throw new ControlError("STALE_PROJECT");
							if (fingerprint(await this.configuration()) !== prepared.configurationDigest)
								throw new ControlError("CONFIG_CHANGED");
							signal.throwIfAborted();
						},
					});
					await this.assertRoot();
					signal.throwIfAborted();
					this.workflow = workflow;
					const report = await workflow.execute();
					if (!report.run) this.startFailure = "START_FAILED";
				} catch {
					this.startFailure = "START_FAILED";
				}
			})().finally(() => {
				this.approval?.settle(false);
				this.execution = undefined;
				this.cancelling = false;
			});
			return this.success(request, { kind: "accepted", requestId: request.id, command: request.type, runId: null });
		}
		const run = await this.currentRun(request);
		const live = this.workflow?.snapshot;
		if (this.disposed || !this.execution || live?.runId !== run.runId) throw new ControlError("RUN_NOT_OWNED");
		if (
			live.revision !== request.expectedStateRevision ||
			this.workflow?.observationState?.revision !== request.expectedProjectRevision
		)
			throw new ControlError("STALE_RUN");
		if (request.type === "workflow.cancel") {
			this.cancelling = true;
			this.cancellation?.abort();
			this.workflow?.cancel();
		} else {
			const pending = this.approval;
			if (
				!pending ||
				pending.request.runId !== run.runId ||
				pending.request.actionId !== request.approvalId ||
				run.status !== "WAITING_APPROVAL" ||
				!run.approvals?.some(
					(record) => record.status === "PENDING" && record.request.actionId === request.approvalId,
				)
			)
				throw new ControlError("APPROVAL_NOT_PENDING");
			if (pending.request.expiresAt <= this.now()) throw new ControlError("APPROVAL_EXPIRED");
			pending.settle(request.decision === "approve");
		}
		return this.success(request, {
			kind: "accepted",
			requestId: request.id,
			command: request.type,
			runId: run.runId,
		});
	}
	private async handle(request: HostControlRequest): Promise<HostControlResponse> {
		if (request.type === "control.hello")
			return this.success(request, {
				kind: "capabilities",
				capabilities: {
					authority: "Runtime/Kernel",
					control: "workflow-control-v1",
					ownerId: this.ownerId,
					commands: HOST_CONTROL_COMMANDS,
					maxRequestBytes: HOST_CONTROL_MAX_REQUEST_BYTES,
					maxResponseBytes: HOST_CONTROL_MAX_RESPONSE_BYTES,
					resultLimit: HOST_CONTROL_RESULT_LIMIT,
					previewTtlMs: HOST_CONTROL_PREVIEW_TTL_MS,
					runtimeVersion: runtimePackage.version,
					readiness: this.options.readiness ?? "READY",
					recipes: listTaskRecipes().map(({ id, version, title }) => ({
						id,
						version,
						title,
						inputTemplate: recipeInputTemplate(id),
					})),
				},
			});
		if (request.type === "control.snapshot") return this.snapshot(request);
		if (request.ownerId !== this.ownerId) throw new ControlError("OWNER_CHANGED");
		const prefix = `${this.ownerId}:`;
		const suffix = request.id.startsWith(prefix) ? request.id.slice(prefix.length) : "";
		const sequence = Number(suffix);
		if (!/^[1-9][0-9]{0,15}$/.test(suffix) || !Number.isSafeInteger(sequence))
			throw new ControlError("INVALID_REQUEST");
		const payload = fingerprint(request);
		const receipt = this.receipts.get(sequence);
		if (receipt) {
			if (receipt.fingerprint !== payload) throw new ControlError("REQUEST_ID_REUSED");
			return receipt.response;
		}
		if (sequence <= this.sequence) throw new ControlError("REQUEST_EXPIRED");
		if (sequence !== this.sequence + 1) throw new ControlError("REQUEST_OUT_OF_ORDER");
		this.sequence = sequence;
		let response: HostControlResponse;
		try {
			response = await this.mutate(request);
		} catch (error) {
			response = this.failure(
				error instanceof ControlError ||
					error instanceof HostWorkflowError ||
					error instanceof BrowserRegistrationError
					? error.code
					: "CONTROL_UNAVAILABLE",
				request.id,
				request.type,
			);
		}
		this.receipts.set(sequence, { fingerprint: payload, response });
		if (this.receipts.size > HOST_CONTROL_RESULT_LIMIT) this.receipts.delete(this.receipts.keys().next().value!);
		return response;
	}
	connect(write: (line: string) => boolean, onClose?: () => void): HostBridgeConnection {
		if (this.disposed || this.connections.size >= 8) throw new ControlError("BUSY");
		let closed = false;
		let ready = false;
		const close = () => {
			if (closed) return;
			closed = true;
			this.connections.delete(connection);
			try {
				onClose?.();
			} catch {
				/* Connection teardown is not Runtime teardown. */
			}
		};
		const send = (response: HostControlResponse) => {
			if (closed) return;
			let line = `${JSON.stringify(response)}\n`;
			if (Buffer.byteLength(line) > HOST_CONTROL_MAX_RESPONSE_BYTES)
				line = `${JSON.stringify(this.failure("RESPONSE_TOO_LARGE", response.id, response.command))}\n`;
			try {
				if (write(line) !== true) close();
			} catch {
				close();
			}
		};
		const connection: HostBridgeConnection = {
			get closed() {
				return closed;
			},
			close,
			receive: (line) => {
				if (closed) return Promise.resolve();
				if (typeof line !== "string" || Buffer.byteLength(line) > HOST_CONTROL_MAX_REQUEST_BYTES) {
					send(this.failure("REQUEST_TOO_LARGE", null, null));
					close();
					return Promise.resolve();
				}
				if (this.queued >= 8) {
					send(this.failure("BUSY", null, null));
					close();
					return Promise.resolve();
				}
				this.queued++;
				const operation = this.queue
					.then(async () => {
						if (closed || this.disposed) return;
						let id: string | null = null;
						let command: string | null = null;
						try {
							let input: unknown;
							try {
								input = JSON.parse(line);
							} catch {
								throw new ControlError("INVALID_REQUEST");
							}
							if (!input || typeof input !== "object" || Array.isArray(input))
								throw new ControlError("INVALID_REQUEST");
							const record = input as Record<string, unknown>;
							if (typeof record.id === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(record.id)) id = record.id;
							if (typeof record.type === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(record.type))
								command = record.type;
							if (record.protocolVersion !== 1) throw new ControlError("UNSUPPORTED_VERSION");
							if (!command || !(HOST_CONTROL_COMMANDS as readonly string[]).includes(command))
								throw new ControlError("UNSUPPORTED_COMMAND");
							if (!Check(HostControlRequestSchema, input)) throw new ControlError("INVALID_REQUEST");
							const request = input as HostControlRequest;
							if (!ready && request.type !== "control.hello") throw new ControlError("HANDSHAKE_REQUIRED");
							const response = await this.handle(request);
							if (request.type === "control.hello" && response.success) ready = true;
							send(response);
						} catch (error) {
							send(
								this.failure(error instanceof ControlError ? error.code : "CONTROL_UNAVAILABLE", id, command),
							);
						}
					})
					.finally(() => {
						this.queued--;
					});
				this.queue = operation.catch(() => {});
				return operation;
			},
		};
		this.connections.add(connection);
		return connection;
	}
	/** Host process shutdown only. Pipe/subscription detach must not invoke this on a surviving owner. */
	async shutdown(): Promise<void> {
		this.disposed = true;
		for (const connection of this.connections) connection.close();
		this.cancellation?.abort();
		this.workflow?.cancel();
		this.approval?.settle(false);
		await this.queue;
		await this.execution;
		this.prepared = undefined;
		this.browserPrepared = undefined;
		this.receipts.clear();
	}
}
