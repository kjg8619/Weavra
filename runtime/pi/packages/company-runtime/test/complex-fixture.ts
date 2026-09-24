import { createHash } from "node:crypto";
import { classifyRequest } from "../src/classification.ts";
import { type ComplexPathFact, compileComplexPlan } from "../src/complex-plan.ts";
import { complexRunError, projectComplexExecution } from "../src/complex-state.ts";
import {
	type ComplexEvidenceContext,
	type ComplexExecution,
	type ComplexPlan,
	evidenceNamespace,
	type OwnershipClaim,
} from "../src/complex-types.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../src/config.ts";
import type {
	CheckRequirement,
	ComplexTaskReview,
	Handoff,
	Review,
	Risk,
	Run,
	TaskContract,
	VerificationResult,
} from "../src/contracts.ts";
import type { RuntimeEvent } from "../src/events.ts";
import { CompanyKernel, type CreateRunRequest } from "../src/kernel.ts";
import type { WorkerMeasurement } from "../src/measurement-types.ts";
import type {
	AgentExecutionRequest,
	AgentExecutionResult,
	ApprovalPort,
	ComplexWorkspaceImages,
	KernelPorts,
	StateStore,
	VerificationRequest,
	WorkspaceFileImage,
} from "../src/ports.ts";
import { buildTaskContract } from "../src/task-contract.ts";
import { type ComplexObservation, complexConsumerIssues, observeDurableRun } from "./complex-conformance.ts";

/** In-memory project files with the GitWorkspace image encoding (sha256 hex of bytes, permission bits). */
export class FakeFiles {
	readonly files = new Map<string, { content: string; mode: number }>();
	private baseline = new Map<string, { content: string; mode: number }>();
	head = "head-0";
	constructor(initial: Record<string, string>) {
		for (const [path, content] of Object.entries(initial)) this.files.set(path, { content, mode: 0o644 });
		this.freeze();
	}
	freeze(): void {
		this.baseline = new Map([...this.files].map(([path, file]) => [path, { ...file }]));
	}
	image(path: string): WorkspaceFileImage | null {
		const file = this.files.get(path);
		return file ? { hash: createHash("sha256").update(file.content).digest("hex"), mode: file.mode } : null;
	}
	write(path: string, content: string): void {
		this.files.set(path, { content, mode: this.files.get(path)?.mode ?? 0o644 });
	}
	remove(path: string): void {
		this.files.delete(path);
	}
	get digest(): string {
		return createHash("sha256")
			.update(JSON.stringify([this.head, [...this.files].sort(([a], [b]) => (a < b ? -1 : 1))]))
			.digest("hex");
	}
	changed(): string[] {
		return [...new Set([...this.baseline.keys(), ...this.files.keys()])]
			.filter((path) => JSON.stringify(this.baseline.get(path)) !== JSON.stringify(this.files.get(path)))
			.sort();
	}
	capture(paths: readonly string[]): ComplexWorkspaceImages {
		const changedFiles = this.changed();
		const images: ComplexWorkspaceImages["images"] = {};
		for (const path of new Set([...paths, ...changedFiles])) images[path] = this.image(path);
		return { diffDigest: this.digest, safe: this.head === "head-0", changedFiles, images };
	}
}

export const COMPLEX_GOAL = "Refactor the parser across multiple modules";

/**
 * The production §10.2 control projection of one durable Run under a fixed test envelope (`stateRevision` is
 * `Run.revision`), exactly as Host Control serializes it.
 */
export function complexProjection(run: Run, envelope = { ownerId: "owner-1", projectRevision: 1 }): ComplexExecution {
	return projectComplexExecution(run, { ...envelope, stateRevision: run.revision });
}

/**
 * Observes every durable save of one Run the way one App connection would: each snapshot is checked against every
 * #17 App consumer rule, and against the previous observation of the same Run (cross-snapshot rules).
 */
export function consumerObserver(ownerId = "owner-1") {
	const issues: string[] = [];
	/** Durable Run revisions observed with a projection present. */
	const projected: number[] = [];
	let previous: ComplexObservation | undefined;
	let projectRevision = 0;
	const observe = (run: Run): void => {
		const observed = observeDurableRun(run, { ownerId, projectRevision: ++projectRevision });
		const found = [...observed.issues, ...complexConsumerIssues(observed.observation, previous)];
		for (const issue of found) issues.push(`revision ${run.revision}: ${issue}`);
		if (observed.observation.state.complexExecution) projected.push(run.revision);
		previous = observed.observation;
	};
	return {
		issues,
		projected,
		observe,
		/** A store that persists through `store` first and then observes the durable snapshot. */
		wrap: (store: StateStore): StateStore => ({
			load: (runId) => store.load(runId),
			save: async (run) => {
				await store.save(run);
				observe(structuredClone(run));
			},
		}),
	};
}

const observers: Array<ReturnType<typeof consumerObserver>> = [];
/** App consumer violations recorded by every harness created since the previous call; then forgotten. */
export function takeConsumerIssues(): string[] {
	return observers.splice(0).flatMap((observer) => observer.issues);
}

export function complexConfig(options: { maxRevisionCycles?: number; budget?: Record<string, number> } = {}) {
	return parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			agents: { max_revision_cycles: options.maxRevisionCycles ?? 3 },
			...(options.budget ? { budget: options.budget } : {}),
			files: { allowed_paths: ["src"] },
			verification: {
				checks: [
					{ id: "lint", kind: "lint", executable: "never-execute", args: [], required: false },
					{ id: "test", kind: "test", executable: "never-execute", args: [] },
				],
			},
		}),
	);
}

export interface ComplexTaskSpec {
	claims: OwnershipClaim[];
	criteria?: number[];
	dependsOn?: number[];
}

/** Host-compiled plan through the production compiler with trusted fake facts (claims are never grants). */
export async function complexPlanFor(
	specs: ComplexTaskSpec[],
	options: {
		goal?: string;
		statements?: string[];
		config?: RuntimeConfig;
		risk?: Risk;
		files?: FakeFiles;
		executionMode?: "EDIT" | "READ_ONLY";
	} = {},
): Promise<{ parent: TaskContract; plan: ComplexPlan; config: RuntimeConfig }> {
	const config = options.config ?? complexConfig();
	const goal = options.goal ?? COMPLEX_GOAL;
	const statements = options.statements ?? ["Parsing is modular", "Duplicate keys are rejected"];
	const parent = buildTaskContract({ goal, statements, workflow: "COMPLEX", config, taskId: "parent-1" });
	const plan = await compileComplexPlan({
		planId: "00000000-0000-4000-8000-000000000001",
		parent,
		draft: {
			tasks: specs.map((spec, index) => ({
				title: `Task ${index + 1}`,
				goal: `Contribution ${index + 1}`,
				dependsOnIndexes: spec.dependsOn ?? (index ? [index] : []),
				criterionIndexes: spec.criteria ?? statements.map((_statement, position) => position + 1),
				ownership: spec.claims,
				checkIds: ["test"],
			})),
		},
		config,
		executionMode: options.executionMode ?? "EDIT",
		risk: options.risk ?? "R1",
		claims: {
			inspect: async (paths) => ({
				facts: paths.map(
					(path): ComplexPathFact => ({
						path,
						safe: true,
						kind: options.files?.files.has(path) ? "file" : "missing",
						exactSpelling: true,
						text: true,
						parentDirectory: true,
					}),
				),
				protectedPaths: [],
			}),
		},
	});
	return { parent, plan, config };
}

export function measurement(request: AgentExecutionRequest, tokens: number | null = 100): WorkerMeasurement {
	return {
		role: request.role,
		profile: request.profile,
		revision: request.revision,
		step: structuredClone(request.step),
		requestedProvider: "faux",
		requestedModel: request.profile,
		actualProvider: "faux",
		actualModel: request.profile,
		startedAt: 1,
		finishedAt: 2,
		durationMs: 1,
		modelTurns: 1,
		toolCalls: 1,
		toolCallsByName: {},
		usage: {
			source: tokens === null ? "unavailable" : "provider",
			input: tokens ?? 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: tokens ?? 0,
		},
		outcome: "SUCCEEDED",
	};
}

/** Faithful fake adapters: the Developer mutates only through the Kernel ownership capability. */
export function complexHarness(options: {
	plan: ComplexPlan;
	parent: TaskContract;
	files: FakeFiles;
	risk?: Risk;
	goal?: string;
	executionMode?: "EDIT" | "READ_ONLY";
}) {
	const { plan, parent, files } = options;
	const saved: Run[] = [];
	const events: RuntimeEvent[] = [];
	const invariantErrors: string[] = [];
	// #16 stage C: the App consumer rules over the production projection of every durable snapshot.
	const consumer = consumerObserver();
	observers.push(consumer);
	const calls: AgentExecutionRequest[] = [];
	let sessions = 0;
	const register = async (request: AgentExecutionRequest, reuse?: string) => {
		sessions++;
		const id = reuse ?? `${request.role}-${sessions}`;
		await request.onSessionCreated?.({ role: request.role, sessionId: id, sessionFile: `/sessions/${id}.jsonl` });
	};
	const handoffFor = (request: AgentExecutionRequest, changed: string[]): Handoff => ({
		runId: request.runId,
		revision: request.revision,
		role: "Developer",
		task: request.task.id,
		changed_files: changed,
		summary: `Implemented ${request.complexContext?.taskId ?? "task"}`,
		assumptions: [],
		tests_run: [],
		known_risks: [],
		unresolved: [],
		...(request.complexContext ? { complexContext: structuredClone(request.complexContext) } : {}),
	});
	/** Default Developer: every claim of the task gets new bytes through authorize → effect → recordEffect. */
	const develop = async (request: AgentExecutionRequest): Promise<Handoff> => {
		const task = request.complexTask?.task;
		const port = request.ownership;
		const changed: string[] = [];
		for (const claim of task?.ownership ?? []) {
			if (!port) throw new Error("ownership capability missing");
			const operation = claim.operation === "delete" ? "delete" : files.files.has(claim.path) ? "replace" : "create";
			port.authorize(claim.path, operation);
			if (operation === "delete") files.remove(claim.path);
			else files.write(claim.path, `${request.complexContext?.taskId}@${request.complexContext?.attempt}\n`);
			port.recordEffect(claim.path, files.image(claim.path));
			changed.push(claim.path);
		}
		return handoffFor(request, changed.sort());
	};
	const contribution = (request: AgentExecutionRequest, verdict: Review["result"] = "PASS"): ComplexTaskReview => {
		if (request.role !== "Reviewer" || !request.complexContext || !request.complexTask)
			throw new Error("not a task reviewer");
		const ref = request.verification.evidenceRefs[0];
		return {
			runId: request.runId,
			revision: request.revision,
			role: "Reviewer",
			task: request.task.id,
			result: verdict,
			issues: [],
			criteria: request.complexTask.task.criterionIds.map((criterionId) => ({
				criterionId,
				status: "SUPPORTED",
				evidenceRefs: [ref],
			})),
			evidenceRefs: [ref],
			diffDigest: request.verification.diffDigest,
			complexContext: structuredClone(request.complexContext),
		};
	};
	const finalReview = (request: AgentExecutionRequest, verdict: Review["result"] = "PASS"): Review => {
		if (request.role !== "Reviewer") throw new Error("not a reviewer");
		const ref = request.verification.evidenceRefs[0];
		return {
			runId: request.runId,
			revision: request.revision,
			role: "Reviewer",
			task: request.task.id,
			result: verdict,
			issues: [],
			criteria: request.task.acceptanceCriteria.map((criterion) => ({
				criterionId: criterion.id,
				status: "MET",
				evidenceRefs: [ref],
			})),
			evidenceRefs: [ref],
			diffDigest: request.verification.diffDigest,
			...(request.complexContext ? { complexContext: structuredClone(request.complexContext) } : {}),
		};
	};
	/** Default result for any worker request, overridable per test. */
	const defaultExecute = async (request: AgentExecutionRequest): Promise<AgentExecutionResult> => {
		calls.push(request);
		await register(request);
		if (request.role === "Developer")
			return { role: "Developer", handoff: await develop(request), measurement: measurement(request) };
		if (request.role !== "Reviewer") throw new Error("COMPLEX never runs an Executor");
		return request.complexContext?.scope === "TASK"
			? { role: "Reviewer", contribution: contribution(request), measurement: measurement(request) }
			: { role: "Reviewer", review: finalReview(request), measurement: measurement(request) };
	};
	const verify = (request: VerificationRequest): VerificationResult => {
		const digest = files.digest;
		const namespace = evidenceNamespace(request);
		return {
			runId: request.runId,
			revision: request.revision,
			step: structuredClone(request.step),
			...(request.complexContext ? { complexContext: structuredClone(request.complexContext) } : {}),
			diffDigest: digest,
			evidenceRefs: [`diff:${digest}`],
			checks: request.checks.map((check) => ({
				id: check.id,
				runId: request.runId,
				revision: request.revision,
				kind: check.kind,
				step: structuredClone(request.step),
				status: "PASS",
				required: check.required,
				exitCode: 0,
				reason: "Fake check passed",
				evidenceRefs: [`check:${namespace}:${check.id}`],
				diffDigest: digest,
				...(request.complexContext ? { complexContext: structuredClone(request.complexContext) } : {}),
			})),
		};
	};
	const checks: CheckRequirement[] = [
		{ id: "lint", kind: "lint", required: false },
		{ id: "test", kind: "test", required: true },
	];
	const settlement = { agents: true, verifier: true, workspace: true, lsp: true };
	/** Deterministic persistence failure injection for one matching snapshot. */
	const control = { failWhen: undefined as ((run: Run) => boolean) | undefined };
	const ports = {
		agents: { execute: defaultExecute, safeToRelease: true as boolean | undefined },
		verifier: {
			safeToRelease: true as boolean | undefined,
			verify: async (request: VerificationRequest) => verify(request),
			inspect: async () => {
				const capture = files.capture([]);
				return {
					diffDigest: capture.diffDigest,
					changedFiles: capture.changedFiles,
					evidenceRefs: [`diff:${capture.diffDigest}`],
					safe: capture.safe,
				};
			},
			images: async (paths: readonly string[]) => files.capture(paths),
		},
		store: {
			load: async () => undefined,
			save: async (run: Run) => {
				if (control.failWhen?.(run)) throw new Error("disk full");
				const error = complexRunError(run, saved.at(-1));
				if (error) invariantErrors.push(`revision ${run.revision}: ${error}`);
				saved.push(structuredClone(run));
				const before = consumer.issues.length;
				consumer.observe(structuredClone(run));
				invariantErrors.push(...consumer.issues.slice(before));
			},
		},
		events: {
			emit: (event: RuntimeEvent) => {
				events.push(event);
			},
		},
		resources: { settle: async () => ({ ...settlement }) },
		approval: undefined as ApprovalPort | undefined,
	} satisfies KernelPorts & Record<string, unknown>;
	const classification = classifyRequest(options.goal ?? COMPLEX_GOAL).classification;
	const request = (): CreateRunRequest => ({
		executionMode: options.executionMode ?? "EDIT",
		runId: "run-1",
		task: structuredClone(parent),
		classification: { ...classification, ...(options.risk ? { risk: options.risk } : {}) },
		workflow: "COMPLEX",
		checks: structuredClone(checks),
		complexPlan: structuredClone(plan),
	});
	return {
		files,
		saved,
		events,
		calls,
		invariantErrors,
		consumer,
		ports,
		control,
		settlement,
		checks,
		register,
		develop,
		handoffFor,
		contribution,
		finalReview,
		defaultExecute,
		verify,
		request,
		create: (overrides: Partial<CreateRunRequest> = {}) =>
			CompanyKernel.create({ ...request(), ...overrides }, ports, () => 1000),
	};
}

export async function driveComplex(kernel: CompanyKernel, stop?: (run: Run) => boolean): Promise<Run> {
	if (kernel.snapshot.status === "CREATED") await kernel.start();
	for (let count = 0; count < 200 && kernel.snapshot.status === "RUNNING"; count++) {
		if (stop?.(kernel.snapshot)) break;
		const step = kernel.snapshot.currentStep;
		if (!step) break;
		await kernel.advance(step.stepId);
	}
	return kernel.snapshot;
}

export function contextOf(run: Run, taskId: string | null, attempt = 1): ComplexEvidenceContext {
	const plan = run.complex?.plan;
	if (!plan) throw new Error("not a COMPLEX run");
	return taskId === null
		? {
				parentTaskContractDigest: plan.parentTaskContractDigest,
				complexPlanDigest: plan.complexPlanDigest,
				scope: "INTEGRATION",
				taskId: null,
				attempt: 1,
			}
		: {
				parentTaskContractDigest: plan.parentTaskContractDigest,
				complexPlanDigest: plan.complexPlanDigest,
				scope: "TASK",
				taskId,
				attempt,
			};
}
