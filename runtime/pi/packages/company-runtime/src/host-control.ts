import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
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
import { boundCapabilityInventory, createCapabilityBroker, type RuntimeCapabilityBroker } from "./capability-broker.ts";
import { capabilityJson } from "./capability-catalog.ts";
import { complexDraftBytes, parseComplexDraft } from "./complex-plan.ts";
import { ComplexProjectionError, projectComplexExecution } from "./complex-state.ts";
import {
	COMPLEX_CONTRACT_VERSION,
	COMPLEX_DRAFT_MAX_BYTES,
	type ComplexDraft,
	type ComplexExecution,
} from "./complex-types.ts";
import { loadRuntimeConfig, type RuntimeConfig } from "./config.ts";
import type { ApprovalDecision, ApprovalRequest, Run } from "./contracts.ts";
import { taskContractDigest } from "./criterion-evidence.ts";
import type { RuntimeEventSink } from "./events.ts";
import type { HostBridgeConnection } from "./host-bridge.ts";
import {
	projectHostConfiguration,
	projectHostEvidence,
	projectHostGraph,
	readHostObservation,
} from "./host-bridge-projections.ts";
import type { HostBridgeIdentity, HostSnapshotSummary } from "./host-bridge-protocol.ts";
import {
	HOST_CONTROL_COMMANDS,
	HOST_CONTROL_MAX_REQUEST_BYTES,
	HOST_CONTROL_MAX_RESPONSE_BYTES,
	HOST_CONTROL_PREVIEW_TTL_MS,
	HOST_CONTROL_RESULT_LIMIT,
	HOST_PLANNER_COMMANDS,
	HOST_PLANNER_DRAFT_MAX_RESPONSE_BYTES,
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
	type HostFactPreview,
	type HostPlannerFailureCode,
	type HostPlannerStatus,
	PLANNER_CONTRACT_VERSION,
} from "./host-control-protocol.ts";
import {
	applyHostWorkflowRecipe,
	createHostWorkflow,
	finalizeComplexHostWorkflowPlan,
	finalizeHostWorkflowPlan,
	HostWorkflowError,
	prepareHostWorkflowDraft,
} from "./host-workflow.ts";
import { type PlannerRoute, resolvePlannerRoute } from "./model-routing.ts";
import {
	buildPlanningContext,
	PLANNER_MAX_REPORTED_TOKENS,
	PlannerFailure,
	type PlannerVerdict,
	plannerClassification,
	plannerCriteria,
	plannerRequestDigest,
	runPlannerSession,
} from "./planner.ts";
import type { ProjectFactSummary, ProjectFactsProjection } from "./project-fact-types.ts";
import {
	confirmProjectFact,
	loadProjectFactProjection,
	type PreparedProjectFact,
	ProjectFactError,
	prepareProjectFact,
	projectFactStillCurrent,
} from "./project-facts.ts";
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
/** V0.8B planning request (PLANNER_DRAFT.md §3, §6): Host process memory only, never durable. */
type PlannerState = {
	planId: string;
	status: HostPlannerStatus["status"];
	requestDigest: string;
	goal: string;
	acceptanceStatements?: string[];
	/** Recorded at `planner.start`; `current` and STALE compare against them. */
	projectRevision: number;
	configurationDigest: string;
	startedAt: number;
	finishedAt: number | null;
	route: PlannerRoute | null;
	usage: HostPlannerStatus["usage"];
	failureCode: HostPlannerFailureCode | null;
	/** READY only: exactly as submitted. */
	draft?: ComplexDraft;
	/** The connection that started planning; its close cancels a RUNNING request (§8). */
	owner: HostBridgeConnection | undefined;
	cancellation: AbortController;
};
export interface HostControlOptions {
	cwd: string;
	projectTrusted: boolean;
	agentDir: string;
	readiness?: HostControlCapabilities["readiness"];
	createModels?: (signal: AbortSignal) => Promise<ModelRuntime>;
	events?: RuntimeEventSink;
	approvalTimeoutMs?: number;
	/** Trusted Host/test override (1..3,600,000 ms) of the whole planning request; otherwise `agents.worker_timeout_ms`. */
	plannerTimeoutMs?: number;
	now?: () => number;
}

/** Owns commands, not workflow transitions. The existing Workflow/Kernel remains the sole execution authority. */
export class HostControlBridge {
	readonly ownerId = randomUUID();
	private readonly options: HostControlOptions;
	private readonly root: { path: string; dev: number; ino: number };
	private readonly capabilities: RuntimeCapabilityBroker;
	private readonly connections = new Set<HostBridgeConnection>();
	private sequence = 0;
	private readonly receipts = new Map<number, { fingerprint: string; response: HostControlResponse }>();
	private queue = Promise.resolve();
	private queued = 0;
	private disposed = false;
	private prepared?: Prepared;
	private factPrepared?: { prepared: PreparedProjectFact; preview: HostFactPreview; consumed: boolean };
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
	private planner?: PlannerState;
	/** The background planning request, until its session is disposed (also after a cancel). */
	private planning?: Promise<void>;

	private constructor(options: HostControlOptions, root: { path: string; dev: number; ino: number }) {
		this.options = { ...options, cwd: root.path };
		this.root = root;
		this.capabilities = createCapabilityBroker({ ownerId: this.ownerId, projectRevision: 0, now: options.now });
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
	/**
	 * `workflow.prepare` only; snapshots and confirm never recover. When this Host is idle, the project is exactly the
	 * revision the client saw and a writer lock exists, the StateStore settles the lock owner's Run only if that owner is
	 * provably dead on this host (INTERRUPTED, COMPLEX rows OWNER_LOST; nothing resumed, rolled back or deleted). That
	 * commits a new project revision, so the idle check that follows answers STALE_PROJECT and the request prepares
	 * nothing; the client re-reads and prepares at the recovered revision. Any other lock and every failure leave the
	 * project unchanged for the idle checks to refuse exactly as before.
	 */
	private async recoverDeadOwner(expected: number): Promise<void> {
		if (this.execution) return;
		const snapshot = await this.canonical();
		if ((snapshot.state?.revision ?? 0) !== expected || !snapshot.writerPresent) return;
		await FileStateStore.recoverDeadOwner(this.root.path, { events: this.options.events }).catch(() => {});
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
	/** §6: true only while the recorded project revision and configuration fingerprint are still current. */
	private async plannerCurrent(state: PlannerState): Promise<boolean> {
		try {
			if (((await this.canonical()).state?.revision ?? 0) !== state.projectRevision) return false;
			return fingerprint(await this.configuration()) === state.configurationDigest;
		} catch {
			return false;
		}
	}
	/** RUNNING → CANCELLED at once; the session is aborted and disposed, and its late result is discarded (§8). */
	private cancelPlanner(state: PlannerState): void {
		if (state.status !== "RUNNING") return;
		state.status = "CANCELLED";
		state.finishedAt = this.now();
		state.cancellation.abort();
	}
	/**
	 * §5.3 steps 1–2 for one raw submission: the closed draft schema and byte bound first, then the exact
	 * `workflow.prepare` pipeline at the recorded revision with the request's goal and statements. Nothing is stored:
	 * no preview, writer or Run. A configuration that moved ends the request STALE instead of validating against it.
	 */
	private async plannerDryRun(state: PlannerState, raw: unknown): Promise<PlannerVerdict> {
		let config: RuntimeConfig | undefined;
		try {
			config = await this.configuration();
		} catch {
			/* Unavailable configuration is a changed configuration. */
		}
		if (!config || fingerprint(config) !== state.configurationDigest)
			throw new PlannerFailure("STALE", "The configuration changed while planning");
		try {
			const draft = parseComplexDraft(raw);
			await this.preparePreview(
				{
					protocolVersion: 1,
					// The longest request id this Host accepts, so the response bound is checked conservatively.
					id: `${this.ownerId}:${Number.MAX_SAFE_INTEGER}`,
					ownerId: this.ownerId,
					expectedProjectRevision: state.projectRevision,
					type: "workflow.prepare",
					goal: state.goal,
					...(state.acceptanceStatements ? { acceptanceStatements: state.acceptanceStatements } : {}),
					complexDraft: draft,
				},
				config,
			);
			return { ok: true, draft };
		} catch (error) {
			if (error instanceof HostWorkflowError) return { ok: false, code: error.code, message: error.message };
			if (error instanceof ControlError)
				return {
					ok: false,
					code: error.code,
					message:
						error.code === "RESPONSE_TOO_LARGE"
							? `The prepared preview of this draft would exceed the ${HOST_CONTROL_MAX_RESPONSE_BYTES}-byte Host Control response`
							: "The draft could not be prepared",
				};
			return { ok: false, code: "INVALID_REQUEST", message: "The draft could not be validated" };
		}
	}
	/**
	 * The background planning request (§3): context, model runtime and session, bounded by one whole-request timeout.
	 * A result lands only while this exact request is still RUNNING; cancellation, owner close, shutdown and a new
	 * start discard it. Nothing durable is written: no writer lock, no `.ai` write, no Run and no revision change.
	 */
	private async plan(
		state: PlannerState,
		config: RuntimeConfig,
		classification: ReturnType<typeof plannerClassification>,
	): Promise<void> {
		const { signal } = state.cancellation;
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			state.cancellation.abort();
		}, this.options.plannerTimeoutMs ?? config.agents.worker_timeout_ms);
		let outcome: { draft: ComplexDraft } | { code: HostPlannerFailureCode };
		try {
			const { route } = state;
			if (!route) throw new PlannerFailure("MODEL_UNAVAILABLE", "No Planner route; fallback disabled");
			const context = await buildPlanningContext({
				cwd: this.root.path,
				goal: state.goal,
				...(state.acceptanceStatements ? { acceptanceStatements: state.acceptanceStatements } : {}),
				config,
				...classification,
				signal,
			});
			let models: ModelRuntime;
			try {
				models = this.options.createModels
					? await this.options.createModels(signal)
					: await ModelRuntime.create({
							authPath: join(this.options.agentDir, "auth.json"),
							modelsPath: join(this.options.agentDir, "models.json"),
							allowModelNetwork: false,
							signal,
						});
			} catch {
				signal.throwIfAborted();
				throw new PlannerFailure("MODEL_UNAVAILABLE", "The Planner model runtime is unavailable");
			}
			const draft = await runPlannerSession({
				cwd: this.root.path,
				agentDir: this.options.agentDir,
				route,
				modelRuntime: models,
				context,
				maxReportedTokens: Math.min(
					PLANNER_MAX_REPORTED_TOKENS,
					config.budget?.max_reported_tokens ?? PLANNER_MAX_REPORTED_TOKENS,
				),
				signal,
				assertCurrent: async () => {
					if (!(await this.plannerCurrent(state)))
						throw new PlannerFailure("STALE", "The project revision or configuration changed while planning");
				},
				validate: (raw) => this.plannerDryRun(state, raw),
				onUsage: (usage) => {
					if (this.planner === state && state.status === "RUNNING") state.usage = usage;
				},
			});
			// §6: checked again before READY; a draft for a moved project is discarded.
			if (!(await this.plannerCurrent(state)))
				throw new PlannerFailure("STALE", "The project revision or configuration changed while planning");
			signal.throwIfAborted();
			outcome = { draft };
		} catch (error) {
			outcome = {
				code: timedOut ? "TIMEOUT" : error instanceof PlannerFailure ? error.code : "PROVIDER_ERROR",
			};
		} finally {
			clearTimeout(timer);
		}
		if (this.planner !== state || state.status !== "RUNNING") return;
		state.finishedAt = this.now();
		if ("draft" in outcome) {
			state.status = "READY";
			state.draft = outcome.draft;
		} else {
			state.status = "FAILED";
			state.failureCode = outcome.code;
		}
	}
	/** §7.3 snapshot DTO: small and draftless; `current` is computed for this snapshot's revision and configuration. */
	private plannerStatus(
		state: PlannerState,
		projectRevision: number,
		config: RuntimeConfig | null,
	): HostPlannerStatus {
		const { route } = state;
		return {
			schemaVersion: 1,
			planId: state.planId,
			status: state.status,
			requestDigest: state.requestDigest,
			projectRevision: state.projectRevision,
			current:
				state.projectRevision === projectRevision &&
				config !== null &&
				fingerprint(config) === state.configurationDigest,
			startedAt: state.startedAt,
			finishedAt: state.finishedAt,
			route: route
				? { alias: route.alias, profile: route.profile, provider: route.provider, model: route.model }
				: null,
			usage: { ...state.usage },
			taskCount: state.status === "READY" && state.draft ? state.draft.tasks.length : null,
			failureCode: state.status === "FAILED" ? state.failureCode : null,
		};
	}
	private async snapshot(
		request: HostControlRequest,
		attempt = 0,
		sourceChanged = false,
	): Promise<HostControlResponse> {
		try {
			await this.assertRoot();
		} catch (error) {
			this.capabilities.prepare(null)({ projectRevision: 0, sourceChanged: true });
			throw error;
		}
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
		const loaded = await loadRuntimeConfig(this.root.path).catch(() => null);
		const config = loaded?.status === "configured" ? loaded.config : null;
		let publishInventory = this.capabilities.prepare(config);
		const configuration = projectHostConfiguration(loaded);
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
		const factPrepared = this.factPrepared;
		const factPreview =
			factPrepared &&
			!factPrepared.consumed &&
			factPrepared.preview.expiresAt > this.now() &&
			factPrepared.preview.projectRevision === projectRevision &&
			(await projectFactStillCurrent(this.root.path, factPrepared.prepared))
				? factPrepared.preview
				: null;
		let projectFacts: ProjectFactsProjection = { status: "unavailable", entries: [] };
		let factsProjection: (() => ProjectFactSummary[]) | undefined;
		try {
			factsProjection = await loadProjectFactProjection(this.root.path);
		} catch {
			/* No last-good facts when configuration/source state is unavailable. */
		}
		const finalLoaded = await loadRuntimeConfig(this.root.path).catch(() => null);
		const finalConfig = finalLoaded?.status === "configured" ? finalLoaded.config : null;
		// Complete normalized config, not a selected LSP flag or the frozen active-run policy.
		// These private bytes are never a public fingerprint or diagnostic.
		if (!finalConfig) publishInventory = this.capabilities.prepare(null);
		else if (capabilityJson(config) !== capabilityJson(finalConfig)) sourceChanged = true;
		const finalState = await this.canonical().catch((error: unknown) => {
			publishInventory({ projectRevision, sourceChanged: true });
			throw error;
		});
		if ((finalState.state?.revision ?? 0) !== projectRevision) {
			publishInventory({ projectRevision, sourceChanged: true });
			if (attempt >= 2) throw new ControlError("STATE_UNAVAILABLE");
			return this.snapshot(request, attempt + 1, true);
		}
		if (factsProjection) projectFacts = { status: "available", entries: factsProjection() };
		// File reads yield while the owner may finish/release its writer. Never combine
		// an earlier durable snapshot with a later idle owner and advertise it as coherent.
		if (this.execution !== execution) {
			publishInventory({ projectRevision, sourceChanged: true });
			if (attempt >= 2) throw new ControlError("STATE_UNAVAILABLE");
			return this.snapshot(request, attempt + 1, true);
		}
		// §10.3: present iff this coherent snapshot's latest canonical Run is COMPLEX (owned or historical), built from
		// that exact Run and envelope; never null, never from an older Run and never a partial DTO.
		let complexExecution: ComplexExecution | undefined;
		if (run?.workflow === "COMPLEX") {
			const stateRevision = observation.identity.stateRevision;
			if (stateRevision === null) throw new ControlError("STATE_UNAVAILABLE");
			try {
				complexExecution = projectComplexExecution(run, { ownerId: this.ownerId, projectRevision, stateRevision });
			} catch (error) {
				throw new ControlError(error instanceof ComplexProjectionError ? error.code : "STATE_UNAVAILABLE");
			}
		}
		publishInventory({ projectRevision, sourceChanged });
		// §7.3: present only after a planner.start on this Host, so non-planning snapshots are byte-identical.
		const planner = this.planner ? this.plannerStatus(this.planner, projectRevision, finalConfig) : undefined;
		const inventory = this.capabilities.reader.list({ limit: 32 });
		const capabilityInventory = inventory.ok
			? inventory.inventory
			: this.capabilities.prepare(null, "INVALID_REGISTRY")({ projectRevision });
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
					factPreview,
					projectFacts,
					pendingApproval,
					capabilityInventory,
					...(complexExecution ? { complexExecution } : {}),
					...(planner ? { planner } : {}),
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
	/**
	 * The deterministic `workflow.prepare` pipeline after its idle checks: classification, recipe, parent freeze,
	 * COMPLEX compilation with claim facts and current Policy, preview digest and the response bound. Stores nothing,
	 * so the V0.8B Planner dry-runs a submission through exactly this code (PLANNER_DRAFT.md §5.3).
	 */
	private async preparePreview(
		request: Extract<HostControlMutation, { type: "workflow.prepare" }>,
		config: RuntimeConfig,
	): Promise<{ plan: Prepared["plan"]; preview: HostControlPreview; response: HostControlResponse }> {
		const { complexDraft } = request;
		let draft = prepareHostWorkflowDraft({
			goal: request.goal,
			config,
			...(complexDraft !== undefined ? { complexDraft } : {}),
		});
		if (request.recipeInputs && !request.recipeId) throw new ControlError("INVALID_RECIPE");
		if (request.recipeId)
			draft = applyHostWorkflowRecipe(draft, { recipeId: request.recipeId, inputs: request.recipeInputs ?? {} });
		const statements = request.acceptanceStatements ?? draft.statements;
		const plan =
			draft.workflow === "COMPLEX"
				? await finalizeComplexHostWorkflowPlan(draft, statements, { cwd: this.root.path })
				: finalizeHostWorkflowPlan(draft, statements);
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
			// Absent (not null) for QUICK/STANDARD; the preview digest below covers the complete plan.
			...(plan.complexPlan ? { complexPlan: plan.complexPlan } : {}),
		};
		const preview: HostControlPreview = {
			...fields,
			previewDigest: fingerprint({ fields, config, root: this.root, contract: plan.taskContract }),
		};
		const response = this.success(request, { kind: "prepared", preview });
		if (Buffer.byteLength(JSON.stringify(response)) + 1 > HOST_CONTROL_MAX_RESPONSE_BYTES)
			throw new ControlError("RESPONSE_TOO_LARGE");
		return { plan, preview, response };
	}
	private async mutate(request: HostControlMutation, origin?: HostBridgeConnection): Promise<HostControlResponse> {
		if ((this.options.readiness ?? "READY") !== "READY") throw new ControlError("CONTROL_UNAVAILABLE");
		if (request.type === "facts.prepare") {
			await this.idleRevision(request.expectedProjectRevision);
			const prepared = await prepareProjectFact(this.root.path, request.sourceRef, request.statement);
			if (prepared.projectRevision !== request.expectedProjectRevision) throw new ControlError("STALE_PROJECT");
			const fields = {
				previewId: randomUUID(),
				ownerId: this.ownerId,
				projectRevision: prepared.projectRevision,
				expiresAt: this.now() + HOST_CONTROL_PREVIEW_TTL_MS,
				sourceRef: prepared.fact.sourceRef,
				sourceDigest: prepared.fact.sourceDigest,
				statement: prepared.fact.statement,
			};
			const preview = { ...fields, previewDigest: fingerprint({ fields, prepared, root: this.root }) };
			await this.idleRevision(request.expectedProjectRevision);
			if (this.disposed) throw new ControlError("CONTROL_UNAVAILABLE");
			this.prepared = undefined;
			this.browserPrepared = undefined;
			this.factPrepared = { prepared, preview, consumed: false };
			return this.success(
				request,
				{ kind: "fact-prepared", preview },
				{ projectRevision: prepared.projectRevision },
			);
		}
		if (request.type === "facts.confirm") {
			const prepared = this.factPrepared;
			if (!prepared || prepared.preview.previewId !== request.previewId) throw new ControlError("PLAN_NOT_FOUND");
			if (prepared.consumed) throw new ControlError("PLAN_CONSUMED");
			if (prepared.preview.expiresAt <= this.now()) throw new ControlError("PLAN_EXPIRED");
			if (prepared.preview.previewDigest !== request.previewDigest) throw new ControlError("PLAN_CHANGED");
			if (prepared.preview.projectRevision !== request.expectedProjectRevision)
				throw new ControlError("STALE_PROJECT");
			await this.idleRevision(request.expectedProjectRevision);
			prepared.consumed = true;
			const factId = await confirmProjectFact(this.root.path, prepared.prepared, this.now(), () => {
				if (this.disposed) throw new ControlError("CONTROL_UNAVAILABLE");
				if (prepared.preview.expiresAt <= this.now()) throw new ControlError("PLAN_EXPIRED");
			});
			return this.success(
				request,
				{ kind: "fact-confirmed", factId },
				{ projectRevision: request.expectedProjectRevision + 1 },
			);
		}
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
			this.factPrepared = undefined;
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
			const { complexDraft } = request;
			// Recipes stay STANDARD-only; the structured draft is byte-bounded before any compilation.
			if (
				complexDraft !== undefined &&
				(request.recipeId !== undefined ||
					request.recipeInputs !== undefined ||
					complexDraftBytes(complexDraft) > COMPLEX_DRAFT_MAX_BYTES)
			)
				throw new ControlError("INVALID_REQUEST");
			await this.recoverDeadOwner(request.expectedProjectRevision);
			// A preview is only ever bound to the client's own expected revision; a recovery that moved it is STALE_PROJECT.
			await this.idleRevision(request.expectedProjectRevision);
			const config = await this.configuration();
			const { plan, preview, response } = await this.preparePreview(request, config);
			await this.idleRevision(request.expectedProjectRevision);
			this.prepared = { plan, preview, configurationDigest: fingerprint(config), consumed: false };
			this.browserPrepared = undefined;
			this.factPrepared = undefined;
			return response;
		}
		if (request.type === "workflow.confirm") {
			// §8: never an implicit cancel; the user cancels planning first (also while a cancelled session disposes).
			if (this.planning) throw new ControlError("PLANNER_BUSY");
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
			// §8: a successful confirm starts the Run and drops the planner state (READY, FAILED or CANCELLED).
			this.planner = undefined;
			return this.success(request, { kind: "accepted", requestId: request.id, command: request.type, runId: null });
		}
		if (request.type === "planner.start") {
			// §7.2: one planning request or Run execution per Host; a cancelled session still disposing counts.
			if (this.execution || this.planning) throw new ControlError("PLANNER_BUSY");
			// The same idleness test as prepare, including the dead-owner recovery that answers STALE_PROJECT.
			await this.recoverDeadOwner(request.expectedProjectRevision);
			await this.idleRevision(request.expectedProjectRevision);
			const config = await this.configuration();
			// Exactly the draftless prepare classification: only ComplexPlanRequiredError for a non-R3 Risk proceeds.
			const classification = plannerClassification(request.goal, config);
			plannerCriteria(request.goal, request.acceptanceStatements, config);
			let route: PlannerRoute | null = null;
			try {
				route = resolvePlannerRoute(config);
			} catch {
				/* FAILED/MODEL_UNAVAILABLE in the background, with no model call: there is no fallback. */
			}
			await this.idleRevision(request.expectedProjectRevision);
			if (this.disposed) throw new ControlError("CONTROL_UNAVAILABLE");
			if (this.execution || this.planning) throw new ControlError("PLANNER_BUSY");
			const state: PlannerState = {
				planId: randomUUID(),
				status: "RUNNING",
				requestDigest: plannerRequestDigest(request.goal, request.acceptanceStatements),
				goal: request.goal,
				...(request.acceptanceStatements ? { acceptanceStatements: [...request.acceptanceStatements] } : {}),
				projectRevision: request.expectedProjectRevision,
				configurationDigest: fingerprint(config),
				startedAt: this.now(),
				finishedAt: null,
				route,
				usage: { invocations: 0, reportedTokens: 0 },
				failureCode: null,
				owner: origin,
				cancellation: new AbortController(),
			};
			// Replaces a READY, FAILED or CANCELLED request, including an unread draft (§8).
			this.planner = state;
			this.planning = this.plan(state, config, classification).finally(() => {
				this.planning = undefined;
			});
			return this.success(request, {
				kind: "accepted",
				requestId: request.id,
				command: request.type,
				runId: null,
			});
		}
		if (request.type === "planner.cancel") {
			const state = this.planner;
			if (!state || state.planId !== request.planId || state.status !== "RUNNING")
				throw new ControlError("PLANNER_NOT_FOUND");
			this.cancelPlanner(state);
			return this.success(request, {
				kind: "accepted",
				requestId: request.id,
				command: request.type,
				runId: null,
			});
		}
		if (request.type === "planner.read") {
			const state = this.planner;
			if (!state || state.planId !== request.planId) throw new ControlError("PLANNER_NOT_FOUND");
			if (state.status !== "READY" || !state.draft) throw new ControlError("PLANNER_NOT_READY");
			const response = this.success(request, {
				kind: "planner-draft",
				planId: state.planId,
				requestDigest: state.requestDigest,
				projectRevision: state.projectRevision,
				// A non-current draft stays readable as a starting point; prepare recompiles it regardless (§6).
				current: await this.plannerCurrent(state),
				draft: structuredClone(state.draft),
			});
			if (Buffer.byteLength(JSON.stringify(response)) + 1 > HOST_PLANNER_DRAFT_MAX_RESPONSE_BYTES)
				throw new ControlError("RESPONSE_TOO_LARGE");
			return response;
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
	private async handle(request: HostControlRequest, origin?: HostBridgeConnection): Promise<HostControlResponse> {
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
					// §10.3 / V0.8A §8: this Runtime implements exactly COMPLEX contract v2 (implementation waves) and
					// always says so. Advertisement is not readiness, authority or permission to execute.
					complexContractVersion: COMPLEX_CONTRACT_VERSION,
					// V0.8B §7.1: the Planner exists on this connection. Advertisement is not readiness or permission.
					plannerContractVersion: PLANNER_CONTRACT_VERSION,
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
			response = await this.mutate(request, origin);
		} catch (error) {
			response = this.failure(
				error instanceof ControlError ||
					error instanceof HostWorkflowError ||
					error instanceof BrowserRegistrationError ||
					error instanceof ProjectFactError
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
			// §8: the connection that started planning closing cancels a RUNNING request; its late result is discarded.
			if (this.planner?.owner === connection) this.cancelPlanner(this.planner);
			try {
				onClose?.();
			} catch {
				/* Connection teardown is not Runtime teardown. */
			}
		};
		const send = (response: HostControlResponse) => {
			if (closed) return;
			let line = `${JSON.stringify(response)}\n`;
			if (
				Buffer.byteLength(line) > HOST_CONTROL_MAX_RESPONSE_BYTES &&
				response.success &&
				response.data.kind === "snapshot" &&
				response.data.state.capabilityInventory
			) {
				const inventory = response.data.state.capabilityInventory;
				const remaining =
					HOST_CONTROL_MAX_RESPONSE_BYTES - Buffer.byteLength(line) + Buffer.byteLength(JSON.stringify(inventory));
				const bounded = boundCapabilityInventory(inventory, remaining);
				if (bounded)
					line = `${JSON.stringify({
						...response,
						data: { ...response.data, state: { ...response.data.state, capabilityInventory: bounded } },
					})}\n`;
			}
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
							if (
								!command ||
								!([...HOST_CONTROL_COMMANDS, ...HOST_PLANNER_COMMANDS] as readonly string[]).includes(command)
							)
								throw new ControlError("UNSUPPORTED_COMMAND");
							if (!Check(HostControlRequestSchema, input)) throw new ControlError("INVALID_REQUEST");
							const request = input as HostControlRequest;
							if (!ready && request.type !== "control.hello") throw new ControlError("HANDSHAKE_REQUIRED");
							const response = await this.handle(request, connection);
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
		if (this.planner) this.cancelPlanner(this.planner);
		this.cancellation?.abort();
		this.workflow?.cancel();
		this.approval?.settle(false);
		await this.queue;
		await this.execution;
		await this.planning;
		this.planner = undefined;
		this.prepared = undefined;
		this.browserPrepared = undefined;
		this.factPrepared = undefined;
		this.receipts.clear();
	}
}
