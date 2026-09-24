import { Check } from "typebox/value";
import { capabilityJson } from "./capability-catalog.ts";
import {
	type CheckGate,
	COMPLEX_EXECUTION_MAX_BYTES,
	COMPLEX_MAX_TASK_CLAIMS,
	type ComplexEvidenceContext,
	type ComplexExecution,
	ComplexExecutionSchema,
	type ComplexFailureCode,
	type ComplexPhase,
	type ComplexPlan,
	type ComplexRunState,
	type ComplexTaskState,
	type ComplexTaskStatus,
	type FrozenComplexPlan,
	type ReviewGate,
} from "./complex-types.ts";
import { isTaskContract, type Run, type TaskContract } from "./contracts.ts";
import { taskContractDigest } from "./criterion-evidence.ts";

/**
 * Pure helpers for the durable COMPLEX Run state (COMPLEX_SEQUENTIAL_WORKFLOW.md §7, §9, §10; PARALLEL_AGENTS.md
 * §4, §6, §8). The Kernel is the only writer; StateStore uses `complexRunError` to reject any save that a consumer
 * would find inconsistent.
 */
export const ACTIVE_TASK_STATUSES: ReadonlySet<ComplexTaskStatus> = new Set([
	"ELIGIBLE",
	"IMPLEMENTING",
	"WAITING_APPROVAL",
	"HANDED_OFF",
	"SELF_CHECK",
	"REVIEW",
	"TEST",
	"STOPPING",
]);
/** Verification stages of the one row in its turn (§4 rule 6). */
export const VERIFYING_TASK_STATUSES: ReadonlySet<ComplexTaskStatus> = new Set(["SELF_CHECK", "REVIEW", "TEST"]);
export const FINISHED_TASK_STATUSES: ReadonlySet<ComplexTaskStatus> = new Set([
	"COMPLETED",
	"BLOCKED",
	"FAILED",
	"CANCELLED",
	"INTERRUPTED",
]);
export const COMPLEX_PHASE_ORDER: Readonly<Record<ComplexPhase, number>> = {
	TASK_SEQUENCE: 0,
	INTEGRATION_CHECK: 1,
	FINAL_REVIEW: 2,
	FINAL_TEST: 3,
	COMPLETING: 4,
	STOPPING: 5,
	TERMINAL: 6,
};
const INTEGRATION_PHASES: ReadonlySet<ComplexPhase> = new Set([
	"INTEGRATION_CHECK",
	"FINAL_REVIEW",
	"FINAL_TEST",
	"COMPLETING",
]);
const TERMINAL_RUN: ReadonlySet<Run["status"]> = new Set([
	"BLOCKED",
	"FAILED",
	"CANCELLED",
	"INTERRUPTED",
	"COMPLETED",
]);

export function isTerminalRun(status: Run["status"]): boolean {
	return TERMINAL_RUN.has(status);
}

/** The frozen wave bound; a historical v1 plan is sequential (one task at a time). */
export function planMaxParallel(plan: FrozenComplexPlan): number {
	return plan.schemaVersion === 2 ? plan.limits.maxParallel : 1;
}

/** Active task IDs of a durable state of either version, in plan order. */
export function activeTaskIdsOf(state: ComplexRunState): string[] {
	if (state.activeTaskIds) return [...state.activeTaskIds];
	return state.activeTaskId ? [state.activeTaskId] : [];
}

/**
 * Scheduling readiness of one row (§4 rule 1, v2 consumer rule 2): every declared dependency COMPLETED; with
 * `maxParallel = 1` (and on v1 plans) every earlier row COMPLETED, which is the V0.7B order.
 */
export function taskReady(plan: FrozenComplexPlan, rows: readonly ComplexTaskState[], index: number): boolean {
	if (planMaxParallel(plan) === 1) return rows.slice(0, index).every((row) => row.status === "COMPLETED");
	return (plan.tasks[index]?.dependsOn ?? []).every((dependency) =>
		rows.some((row) => row.id === dependency && row.status === "COMPLETED"),
	);
}

/**
 * Wave formation (§4 rule 1): the first at most `maxParallel` PENDING rows in plan order whose scheduling
 * dependencies are COMPLETED. A pure function of the frozen plan and persisted statuses, never of which worker
 * finished first; a row whose dependencies are not COMPLETED never enters a wave, even if its files exist.
 */
export function complexWave(plan: FrozenComplexPlan, rows: readonly ComplexTaskState[]): number[] {
	const wave: number[] = [];
	for (const [index, row] of rows.entries()) {
		if (wave.length >= planMaxParallel(plan)) break;
		if (row.status === "PENDING" && taskReady(plan, rows, index)) wave.push(index);
	}
	return wave;
}

/**
 * The wave partition of a plan: each wave forms after every earlier wave COMPLETED, so a successful Run implements
 * exactly these waves. Reports use it to show wave membership; it is never a transition.
 */
export function complexWaves(plan: FrozenComplexPlan): string[][] {
	const rows = plan.tasks.map((task) => pendingTaskState(task.id));
	const waves: string[][] = [];
	for (let wave = complexWave(plan, rows); wave.length; wave = complexWave(plan, rows)) {
		waves.push(wave.map((index) => rows[index].id));
		for (const index of wave) rows[index].status = "COMPLETED";
	}
	return waves;
}

/** PENDING: attempt 0, no invocation, zero (not unknown) tokens, no capture, no change, no evidence, no failure. */
export function pendingTaskState(id: string): ComplexTaskState {
	return {
		id,
		status: "PENDING",
		attempt: 0,
		revisionCycle: 0,
		workerInvocations: 0,
		reportedTokens: 0,
		entryWorkspaceDigest: null,
		exitWorkspaceDigest: null,
		changedFiles: [],
		changesUnknown: false,
		selfCheck: "NOT_RUN",
		review: "NOT_RUN",
		test: "NOT_RUN",
		evidenceFreshness: "NONE",
		failureCode: null,
	};
}

export function initialComplexState(plan: ComplexPlan): ComplexRunState {
	return {
		plan: structuredClone(plan),
		phase: "TASK_SEQUENCE",
		activeTaskIds: [],
		tasks: plan.tasks.map((task) => pendingTaskState(task.id)),
		integration: {
			check: "NOT_RUN",
			review: "NOT_RUN",
			test: "NOT_RUN",
			workspaceDigest: null,
			evidenceFreshness: "NONE",
			failureCode: null,
		},
		cleanup: "NOT_REQUESTED",
		partialChanges: false,
		changesUnknown: false,
		failureCode: null,
	};
}

export function taskContext(plan: FrozenComplexPlan, taskId: string, attempt: number): ComplexEvidenceContext {
	return {
		parentTaskContractDigest: plan.parentTaskContractDigest,
		complexPlanDigest: plan.complexPlanDigest,
		scope: "TASK",
		taskId,
		attempt,
	};
}

export function integrationContext(plan: FrozenComplexPlan): ComplexEvidenceContext {
	return {
		parentTaskContractDigest: plan.parentTaskContractDigest,
		complexPlanDigest: plan.complexPlanDigest,
		scope: "INTEGRATION",
		taskId: null,
		attempt: 1,
	};
}

/** Exact identity equality, independent of key order. Absence never equals a context. */
export function sameContext(
	left: ComplexEvidenceContext | undefined,
	right: ComplexEvidenceContext | undefined,
): boolean {
	return (
		left !== undefined &&
		right !== undefined &&
		left.parentTaskContractDigest === right.parentTaskContractDigest &&
		left.complexPlanDigest === right.complexPlanDigest &&
		left.scope === right.scope &&
		left.taskId === right.taskId &&
		left.attempt === right.attempt
	);
}

/**
 * Every accepted capture re-evaluates freshness against the latest workspace (§8.2): historical COMPLETED rows and
 * integration evidence captured at another digest become STALE. Verdicts and statuses are never rewritten, and a
 * STALE row never turns CURRENT again.
 */
export function markStaleEvidence(state: ComplexRunState, digest: string): void {
	for (const row of state.tasks)
		if (row.status === "COMPLETED" && row.evidenceFreshness === "CURRENT" && row.exitWorkspaceDigest !== digest)
			row.evidenceFreshness = "STALE";
	if (state.integration.evidenceFreshness === "CURRENT" && state.integration.workspaceDigest !== digest)
		state.integration.evidenceFreshness = "STALE";
}

/** §10.2 budget projection from the one global ledger (`Run.budget`) and the global work cycle. */
export function complexBudget(
	run: Pick<Run, "budget" | "revisionCycle">,
	plan: FrozenComplexPlan,
): ComplexExecution["budget"] {
	const tokens = run.budget?.reportedTokens ?? null;
	return {
		workerInvocations: run.budget?.workerInvocations ?? 0,
		reportedTokens: tokens,
		totalRevisionCycles: run.revisionCycle,
		status:
			tokens === null
				? "UNKNOWN"
				: run.budget?.exceeded === true || tokens >= plan.limits.maxReportedTokens
					? "EXHAUSTED"
					: "WITHIN_LIMITS",
	};
}

/** Why a latest COMPLEX Run has no publishable projection: an existing Host Control error code, never a partial DTO. */
export class ComplexProjectionError extends Error {
	readonly code: "STATE_UNAVAILABLE" | "RESPONSE_TOO_LARGE";

	constructor(code: "STATE_UNAVAILABLE" | "RESPONSE_TOO_LARGE", message: string) {
		super(message);
		this.name = "ComplexProjectionError";
		this.code = code;
	}
}

/**
 * Opt-in Host Control projection (§10.2, §10.3; v2 per PARALLEL_AGENTS.md §8): a pure function of one durable
 * COMPLEX Run (frozen parent and plan, task rows, integration, the one global budget ledger and work cycle) and the
 * enclosing snapshot envelope. The canonical Run stays the outcome authority; nothing is inferred, merged from
 * another Run, shortened or repaired. A terminal historical V0.7B Run keeps its frozen v1 plan unchanged inside the
 * v2 execution with no active rows (Amendment A1); a non-terminal one has no projection. A Run without a
 * Host-confirmed plan, an inconsistent Run or a DTO outside the closed shape is STATE_UNAVAILABLE; a DTO over
 * 32,768 UTF-8 bytes is RESPONSE_TOO_LARGE.
 */
export function projectComplexExecution(
	run: Run,
	envelope: { ownerId: string; projectRevision: number; stateRevision: number },
): ComplexExecution {
	const state = run.complex;
	const parent = run.tasks[0];
	if (run.workflow !== "COMPLEX" || !state || run.tasks.length !== 1 || !parent || !isTaskContract(parent))
		throw new ComplexProjectionError("STATE_UNAVAILABLE", "The Run has no Host-confirmed COMPLEX plan to project");
	// The projection belongs to exactly this durable snapshot: its revision is the enclosing stateRevision.
	if (envelope.stateRevision !== run.revision)
		throw new ComplexProjectionError("STATE_UNAVAILABLE", "The snapshot stateRevision is not this Run revision");
	const inconsistent = complexRunError(run);
	if (inconsistent) throw new ComplexProjectionError("STATE_UNAVAILABLE", inconsistent);
	if (state.plan.schemaVersion === 1 && !isTerminalRun(run.status))
		throw new ComplexProjectionError(
			"STATE_UNAVAILABLE",
			"A historical V0.7B COMPLEX Run is projected only once terminal; recovery settles it first",
		);
	const execution: ComplexExecution = {
		schemaVersion: 2,
		ownerId: envelope.ownerId,
		projectRevision: envelope.projectRevision,
		runId: run.runId,
		stateRevision: run.revision,
		// Allowlisted wire copy of the frozen parent plus its lifecycle status.
		parent: {
			id: parent.id,
			goal: parent.goal,
			acceptanceCriteria: parent.acceptanceCriteria.map((criterion) => ({
				id: criterion.id,
				statement: criterion.statement,
				scope: { paths: [...criterion.scope.paths] },
				verification: {
					checkIds: [...criterion.verification.checkIds],
					reviewRequired: criterion.verification.reviewRequired,
				},
			})),
			status: parent.status,
		},
		plan: structuredClone(state.plan),
		phase: state.phase,
		activeTaskIds: activeTaskIdsOf(state),
		tasks: structuredClone(state.tasks),
		integration: structuredClone(state.integration),
		budget: complexBudget(run, state.plan),
		cleanup: state.cleanup,
		partialChanges: state.partialChanges,
		changesUnknown: state.changesUnknown,
		failureCode: state.failureCode,
	};
	if (!Check(ComplexExecutionSchema, execution))
		throw new ComplexProjectionError(
			"STATE_UNAVAILABLE",
			"The COMPLEX projection does not fit its closed wire shape",
		);
	const bytes = Buffer.byteLength(JSON.stringify(execution), "utf8");
	if (bytes > COMPLEX_EXECUTION_MAX_BYTES)
		throw new ComplexProjectionError(
			"RESPONSE_TOO_LARGE",
			`The COMPLEX projection is ${bytes} UTF-8 bytes; the limit is ${COMPLEX_EXECUTION_MAX_BYTES} and nothing is truncated`,
		);
	return execution;
}

export interface ComplexSettlement {
	/** Run-level terminal status and closed failure code: the first failure in plan order, or the stop cause. */
	taskStatus: "BLOCKED" | "FAILED" | "CANCELLED" | "INTERRUPTED";
	failureCode: ComplexFailureCode;
	/**
	 * Rows (by task ID) whose own failure stopped the Run, each keeping its own status and code (§4 rule 8). When
	 * present, every other started unfinished row is a stopped sibling: BLOCKED/RUN_STOPPED, or CANCELLED on a user
	 * cancel. When absent, every started unfinished row takes `taskStatus`/`failureCode` (a Run-level stop).
	 */
	failures?: Readonly<Record<string, { status: "BLOCKED" | "FAILED"; failureCode: ComplexFailureCode }>>;
	/** User cancellation: never-started rows and stopped siblings are CANCELLED instead of BLOCKED. */
	cancelled: boolean;
	/** Owner loss (recovery): every unfinished row is INTERRUPTED. */
	ownerLost: boolean;
	cleanup: "CONFIRMED" | "UNCONFIRMED";
	partialChanges: boolean;
	changesUnknown: boolean;
	/** Honest facts of started rows (by task ID) from the final safe capture, when one exists. */
	rows?: Readonly<Record<string, Pick<ComplexTaskState, "changedFiles" | "changesUnknown">>>;
}

const settleGate = <T extends CheckGate | ReviewGate>(gate: T): T | "UNAVAILABLE" =>
	gate === "RUNNING" ? "UNAVAILABLE" : gate;

/**
 * Terminal settlement (§7.1, §9; V0.8A §4 rule 8, §6): COMPLETED rows stay untouched; every started unfinished row
 * ends with its own failure, as a stopped sibling (BLOCKED/RUN_STOPPED, CANCELLED on cancel, HANDED_OFF rows keeping
 * their attempt data) or INTERRUPTED on owner loss; never-started rows become BLOCKED (RUN_STOPPED when they were
 * ready, else DEPENDENCY_NOT_COMPLETED), CANCELLED or INTERRUPTED; no gate is left RUNNING (never a fabricated
 * verdict) and no row stays active.
 */
export function settleComplexState(state: ComplexRunState, settlement: ComplexSettlement): ComplexRunState {
	const next = structuredClone(state);
	const integrationPhase =
		INTEGRATION_PHASES.has(state.phase) || state.tasks.every((row) => row.status === "COMPLETED");
	for (const [index, row] of next.tasks.entries()) {
		if (FINISHED_TASK_STATUSES.has(row.status)) continue;
		row.selfCheck = settleGate(row.selfCheck);
		row.review = settleGate(row.review);
		row.test = settleGate(row.test);
		if (row.status === "PENDING") {
			const ready = taskReady(state.plan, state.tasks, index);
			row.status = settlement.ownerLost ? "INTERRUPTED" : settlement.cancelled ? "CANCELLED" : "BLOCKED";
			row.failureCode = settlement.ownerLost
				? "OWNER_LOST"
				: settlement.cancelled
					? "CANCELLED"
					: ready
						? "RUN_STOPPED"
						: "DEPENDENCY_NOT_COMPLETED";
			continue;
		}
		const own = settlement.failures?.[row.id];
		if (settlement.ownerLost) {
			row.status = "INTERRUPTED";
			row.failureCode = "OWNER_LOST";
		} else if (own) {
			row.status = own.status;
			row.failureCode = own.failureCode;
		} else if (settlement.failures) {
			row.status = settlement.cancelled ? "CANCELLED" : "BLOCKED";
			row.failureCode = settlement.cancelled ? "CANCELLED" : "RUN_STOPPED";
		} else {
			row.status = settlement.taskStatus;
			row.failureCode = settlement.failureCode;
		}
		const facts = settlement.rows?.[row.id];
		if (facts) {
			row.changedFiles = [...facts.changedFiles];
			row.changesUnknown ||= facts.changesUnknown;
		}
		// attempt>0 always carries an entry capture, a failure code or an unknown-change flag.
		if (row.attempt > 0 && row.entryWorkspaceDigest === null) row.changesUnknown = true;
	}
	next.integration.check = settleGate(next.integration.check);
	next.integration.review = settleGate(next.integration.review);
	next.integration.test = settleGate(next.integration.test);
	if (integrationPhase && next.tasks.every((row) => row.status === "COMPLETED"))
		next.integration.failureCode = settlement.ownerLost ? "OWNER_LOST" : settlement.failureCode;
	next.phase = "TERMINAL";
	// A historical V0.7B state keeps its own active-task field; v2 states list no active row once terminal.
	if (next.activeTaskIds) next.activeTaskIds = [];
	else next.activeTaskId = null;
	next.cleanup = settlement.cleanup;
	next.partialChanges = settlement.partialChanges || settlement.changesUnknown;
	next.changesUnknown = settlement.changesUnknown;
	next.failureCode = settlement.ownerLost ? "OWNER_LOST" : settlement.failureCode;
	return next;
}

const ordered = (first: string, second: string, third: string) =>
	(second === "NOT_RUN" || first === "PASS") && (third === "NOT_RUN" || second === "PASS");
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

function rowError(
	row: ComplexTaskState,
	plan: FrozenComplexPlan,
	rows: readonly ComplexTaskState[],
	index: number,
): string | undefined {
	const task = plan.tasks[index];
	if (!task || row.id !== task.id) return "rows must match the plan tasks in order";
	if (row.status === "PENDING")
		return JSON.stringify(row) === JSON.stringify(pendingTaskState(row.id))
			? undefined
			: `${row.id} PENDING row carries attempt, usage, capture, change or evidence state`;
	const claims = new Set(task.ownership.map((claim) => claim.path));
	const sortedUnique = row.changedFiles.every((path, index) => index === 0 || row.changedFiles[index - 1] < path);
	if (row.attempt === 0 ? row.revisionCycle !== 0 : row.attempt !== row.revisionCycle + 1)
		return `${row.id} attempt must equal revisionCycle + 1 once activated`;
	if (row.revisionCycle > task.maxRevisionCycles) return `${row.id} exceeds its revision cycles`;
	if (row.workerInvocations > 2 * row.attempt) return `${row.id} exceeds two workers per attempt`;
	if (row.attempt === 0 && (row.selfCheck !== "NOT_RUN" || row.review !== "NOT_RUN" || row.test !== "NOT_RUN"))
		return `${row.id} has gates before any attempt`;
	if (row.attempt > 0 && row.entryWorkspaceDigest === null && row.failureCode === null && !row.changesUnknown)
		return `${row.id} attempt lacks an entry capture, failure code or unknown-change flag`;
	if (
		!sortedUnique ||
		row.changedFiles.length > COMPLEX_MAX_TASK_CLAIMS ||
		row.changedFiles.some((path) => !claims.has(path))
	)
		return `${row.id} changed files must be unique sorted claims of the task`;
	if (!ordered(row.selfCheck, row.review, row.test)) return `${row.id} gates ran out of order`;
	// v2 rule 2: declared dependencies COMPLETED; maxParallel 1 (and v1): every earlier row COMPLETED.
	if ((ACTIVE_TASK_STATUSES.has(row.status) || row.status === "COMPLETED") && !taskReady(plan, rows, index))
		return `${row.id} is active or completed before ${planMaxParallel(plan) === 1 ? "an earlier task" : "a dependency"} completed`;
	// v2 rule 5: implemented with an entry capture, every gate still waiting for its verification turn.
	if (
		row.status === "HANDED_OFF" &&
		(row.attempt < 1 ||
			row.entryWorkspaceDigest === null ||
			row.selfCheck !== "NOT_RUN" ||
			row.review !== "NOT_RUN" ||
			row.test !== "NOT_RUN")
	)
		return `${row.id} HANDED_OFF without an attempt, an entry capture and NOT_RUN gates`;
	if (
		row.status === "COMPLETED" &&
		(row.attempt < 1 ||
			row.selfCheck !== "PASS" ||
			row.review !== "PASS" ||
			row.test !== "PASS" ||
			row.exitWorkspaceDigest === null ||
			row.evidenceFreshness === "NONE" ||
			row.failureCode !== null)
	)
		return `${row.id} COMPLETED without validated success evidence`;
	return undefined;
}

/**
 * v2 consumer rules 1, 3 and 4 with the atomic-save amendment (PARALLEL_AGENTS.md §8): `activeTaskIds` lists exactly
 * the active rows in plan order within `maxParallel`; first-attempt implementation (IMPLEMENTING attempt 1 or
 * WAITING_APPROVAL) coexists only with HANDED_OFF rows; exactly one verification-state row (a stage, or a revising
 * IMPLEMENTING attempt ≥ 2) coexists only with HANDED_OFF rows; otherwise the active rows are all ELIGIBLE (a formed
 * wave) or all HANDED_OFF/STOPPING (a joined wave, or a stop before its terminal save).
 */
function activeRowsError(state: ComplexRunState, maxParallel: number): string | undefined {
	const active = state.tasks.filter((row) => ACTIVE_TASK_STATUSES.has(row.status));
	if (capabilityJson(state.activeTaskIds ?? null) !== capabilityJson(active.map((row) => row.id)))
		return "activeTaskIds must list exactly the active rows in plan order";
	if (active.length > maxParallel) return "More active rows than the frozen maxParallel";
	const verifying = active.filter(
		(row) => VERIFYING_TASK_STATUSES.has(row.status) || (row.status === "IMPLEMENTING" && row.attempt >= 2),
	);
	const implementing = active.filter(
		(row) => row.status === "WAITING_APPROVAL" || (row.status === "IMPLEMENTING" && row.attempt < 2),
	);
	const beside = (working: readonly ComplexTaskState[]) =>
		active.every((row) => working.includes(row) || row.status === "HANDED_OFF");
	if (implementing.length && (verifying.length || !beside(implementing)))
		return "Implementing rows coexist only with HANDED_OFF rows, never with verification";
	if (verifying.length && (verifying.length > 1 || !beside(verifying)))
		return "Exactly one row verifies at a time, beside HANDED_OFF rows only";
	if (
		!implementing.length &&
		!verifying.length &&
		!active.every((row) => row.status === "ELIGIBLE") &&
		!active.every((row) => row.status === "HANDED_OFF" || row.status === "STOPPING")
	)
		return "Idle active rows must all be ELIGIBLE, or all HANDED_OFF or STOPPING";
	return undefined;
}

function contextError(run: Run, plan: FrozenComplexPlan | undefined): string | undefined {
	const contexts: Array<ComplexEvidenceContext | undefined> = [
		...run.verification.map((check) => check.complexContext),
		...(run.handoff ? [run.handoff.complexContext] : []),
		...(run.review && "criteria" in run.review ? [run.review.complexContext] : []),
		...(run.reviewHistory ?? []).map((review) => ("criteria" in review ? review.complexContext : undefined)),
		...(run.approvals ?? []).map((record) => record.request.complexContext),
		...run.roleSessionRefs.map((ref) => ref.complexContext),
		...(run.workerMeasurements ?? []).map((measurement) => measurement.complexContext),
		...(run.complexReviews ?? []).map((review) => review.complexContext),
		...(run.complexEvidence ?? []).map((record) => record.complexContext),
	];
	const legacyRecords =
		(run.review !== undefined && !("criteria" in run.review)) ||
		(run.reviewHistory ?? []).some((review) => !("criteria" in review));
	if (!plan)
		return contexts.some((context) => context !== undefined) ||
			run.complexEvidence !== undefined ||
			run.complexReviews !== undefined
			? "QUICK/STANDARD records cannot carry COMPLEX identity"
			: undefined;
	if (legacyRecords) return "COMPLEX runs cannot carry legacy review records";
	for (const context of contexts) {
		if (
			!context ||
			context.parentTaskContractDigest !== plan.parentTaskContractDigest ||
			context.complexPlanDigest !== plan.complexPlanDigest ||
			(context.scope === "TASK" && !plan.tasks.some((task) => task.id === context.taskId))
		)
			return "Every COMPLEX record needs the Kernel-assigned context of this plan";
	}
	// Evidence records only reference this Run's typed records, never worker strings (§10.1).
	const checkRefs = new Set(run.verification.flatMap((check) => check.evidenceRefs));
	const sessions = new Set(run.roleSessionRefs.map((ref) => ref.sessionId));
	for (const record of run.complexEvidence ?? []) {
		const task = plan.tasks.find((item) => item.id === record.complexContext.taskId);
		const claims = new Set(task?.ownership.map((claim) => claim.path) ?? []);
		if (
			record.checkRefs.some((ref) => !checkRefs.has(ref)) ||
			record.sessionRefs.some((ref) => !sessions.has(ref.sessionId)) ||
			record.measurementIndexes.some((index) => index >= (run.workerMeasurements?.length ?? 0)) ||
			(task && record.changedFiles.some((path) => !claims.has(path)))
		)
			return "A COMPLEX evidence record references evidence outside this Run or its task claims";
	}
	return undefined;
}

/**
 * Durable COMPLEX invariants for one save (§10.1, §10.2, the V0.8A §8 v2 consumer rules and Amendment A1): plan/parent
 * binding, exact rows, wave coexistence of active rows, phase/status agreement, gate order, one global budget, cleanup
 * honesty, completion evidence and, against the previous save, immutability and monotonic counters. A historical
 * V0.7B state (v1 plan) keeps the V0.7B single-active-task rules. Returns the first violation.
 */
export function complexRunError(run: Run, previous?: Run): string | undefined {
	const state = run.complex;
	if (run.workflow !== "COMPLEX" || !state) {
		if (state) return "Only COMPLEX runs carry COMPLEX state";
		if (previous?.complex) return "COMPLEX state cannot be removed";
		if (
			run.workflow === "COMPLEX" &&
			!["CREATED", "BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(run.status)
		)
			return "A COMPLEX run without a Host-confirmed plan cannot execute";
		return contextError(run, undefined);
	}
	const { plan } = state;
	const parent: TaskContract | undefined = isTaskContract(run.tasks[0]) ? run.tasks[0] : undefined;
	if (!parent || run.tasks.length !== 1 || plan.parentTaskId !== parent.id || run.currentTask !== parent.id)
		return "The COMPLEX run must keep exactly its bound parent Task Contract";
	if (
		plan.parentTaskContractDigest !== taskContractDigest(parent) ||
		run.taskContractDigest !== plan.parentTaskContractDigest
	)
		return "The parent Task Contract digest differs from the frozen plan";
	if ((parent.status === "completed") !== (run.status === "COMPLETED"))
		return "Only final completion marks the parent";
	if (state.tasks.length !== plan.tasks.length) return "Exactly one state row per plan task";
	const legacy = plan.schemaVersion === 1;
	if (
		legacy ? state.activeTaskIds !== undefined || state.activeTaskId === undefined : state.activeTaskId !== undefined
	)
		return "The active-task field must match the frozen plan version";
	if (legacy && state.tasks.some((row) => row.status === "HANDED_OFF"))
		return "A historical V0.7B Run carries no HANDED_OFF row";
	for (const [index, row] of state.tasks.entries()) {
		const error = rowError(row, plan, state.tasks, index);
		if (error) return error;
	}
	if (legacy) {
		const active = state.tasks.filter((row) => ACTIVE_TASK_STATUSES.has(row.status));
		if (active.length > 1 || state.activeTaskId !== (active[0]?.id ?? null)) return "At most one active task";
	} else {
		const error = activeRowsError(state, planMaxParallel(plan));
		if (error) return error;
	}
	if (run.risk === "R3" && planMaxParallel(plan) !== 1) return "An R3 COMPLEX plan implements one task at a time";
	if (state.tasks.some((row) => row.status === "WAITING_APPROVAL") && run.status !== "WAITING_APPROVAL")
		return "A task waits for Approval only while the Run does";
	if ((state.phase === "TERMINAL") !== isTerminalRun(run.status))
		return "COMPLEX phase TERMINAL must match a terminal Run";
	const integration = state.integration;
	const integrationGates = [integration.check, integration.review, integration.test];
	if (state.phase === "TASK_SEQUENCE" && integrationGates.some((gate) => gate !== "NOT_RUN"))
		return "Integration gates run only after every task";
	if (INTEGRATION_PHASES.has(state.phase) && state.tasks.some((row) => row.status !== "COMPLETED"))
		return "Integration requires every task COMPLETED";
	if (
		state.phase === "TERMINAL" &&
		(state.tasks.some((row) => !FINISHED_TASK_STATUSES.has(row.status)) ||
			[...state.tasks.flatMap((row) => [row.selfCheck, row.review, row.test]), ...integrationGates].includes(
				"RUNNING",
			))
	)
		return "A terminal COMPLEX run leaves no unfinished task or running gate";
	if (!ordered(integration.check, integration.review, integration.test)) return "Integration gates ran out of order";
	const budget = complexBudget(run, plan);
	const invocations = sum(state.tasks.map((row) => row.workerInvocations));
	if (
		budget.workerInvocations > plan.limits.maxWorkerInvocations ||
		invocations > budget.workerInvocations ||
		budget.workerInvocations > invocations + 1 ||
		run.revisionCycle > plan.limits.maxTotalRevisionCycles ||
		sum(state.tasks.map((row) => row.revisionCycle)) !== run.revisionCycle ||
		run.maxRevisionCycles !== plan.limits.maxTotalRevisionCycles
	)
		return "COMPLEX budget counters disagree with the one global ledger";
	if (["BLOCKED", "FAILED", "CANCELLED", "COMPLETED"].includes(run.status) && state.cleanup !== "CONFIRMED")
		return "A clean terminal outcome requires confirmed cleanup";
	if (run.status === "INTERRUPTED" && state.cleanup === "PENDING")
		return "An interrupted Run cannot leave cleanup pending";
	if (
		run.status === "COMPLETED" &&
		(state.tasks.some((row) => row.status !== "COMPLETED") ||
			integrationGates.some((gate) => gate !== "PASS") ||
			integration.evidenceFreshness !== "CURRENT" ||
			integration.workspaceDigest === null ||
			integration.failureCode !== null ||
			state.failureCode !== null ||
			budget.status !== "WITHIN_LIMITS")
	)
		return "COMPLEX completion lacks its integration, task or budget predicates";
	const contexts = contextError(run, plan);
	if (contexts) return contexts;
	const approvals = run.approvals ?? [];
	if (
		approvals.some(
			(record) =>
				record.request.complexContext?.scope !== "TASK" ||
				!plan.tasks.some(
					(task) =>
						task.id === record.request.complexContext?.taskId &&
						task.ownership.some((claim) => claim.operation === "delete" && claim.path === record.request.path),
				),
		)
	)
		return "A COMPLEX Approval binds only the deleting task's exact claim";
	if (!previous) return undefined;
	const before = previous.complex;
	if (!before || previous.workflow !== "COMPLEX") return "A run cannot become COMPLEX after creation";
	const frozen = (value: TaskContract) => capabilityJson({ ...value, status: "" });
	const beforeParent = isTaskContract(previous.tasks[0]) ? previous.tasks[0] : undefined;
	if (!beforeParent || frozen(beforeParent) !== frozen(parent) || capabilityJson(before.plan) !== capabilityJson(plan))
		return "The frozen parent and plan are immutable";
	if (COMPLEX_PHASE_ORDER[state.phase] < COMPLEX_PHASE_ORDER[before.phase]) return "COMPLEX phase cannot regress";
	const beforeBudget = complexBudget(previous, plan);
	const tokens = (from: number | null, to: number | null) => (from === null ? to === null : to === null || to >= from);
	if (
		budget.workerInvocations < beforeBudget.workerInvocations ||
		run.revisionCycle < previous.revisionCycle ||
		!tokens(beforeBudget.reportedTokens, budget.reportedTokens)
	)
		return "COMPLEX budget counters never decrease and unknown usage stays unknown";
	for (const [index, row] of state.tasks.entries()) {
		const prior = before.tasks[index];
		if (
			row.attempt < prior.attempt ||
			row.revisionCycle < prior.revisionCycle ||
			row.workerInvocations < prior.workerInvocations ||
			!tokens(prior.reportedTokens, row.reportedTokens) ||
			(prior.status !== "PENDING" && row.status === "PENDING")
		)
			return `${row.id} counters regressed or re-entered PENDING`;
		if (FINISHED_TASK_STATUSES.has(prior.status)) {
			// A finished row is immutable; a COMPLETED row may only have its historical evidence become STALE.
			const staled =
				prior.status === "COMPLETED" && prior.evidenceFreshness === "CURRENT" && row.evidenceFreshness === "STALE";
			if (JSON.stringify({ ...row, evidenceFreshness: "" }) !== JSON.stringify({ ...prior, evidenceFreshness: "" }))
				return `${row.id} finished row cannot change`;
			if (row.evidenceFreshness !== prior.evidenceFreshness && !staled)
				return `${row.id} finished row cannot change`;
		}
	}
	return undefined;
}
