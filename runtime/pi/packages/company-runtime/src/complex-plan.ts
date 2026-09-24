import { Check } from "typebox/value";
import { r3DeletionTarget } from "./approval.ts";
import { complexPlanDigest, complexStructureError } from "./complex-binding.ts";
import {
	CHECK_GATES,
	CLEANUP_STATUSES,
	COMPLEX_BUDGET_STATUSES,
	COMPLEX_DRAFT_MAX_BYTES,
	COMPLEX_EXECUTION_MAX_BYTES,
	COMPLEX_FAILURE_CODES,
	COMPLEX_IDENTIFIER_PATTERN,
	COMPLEX_MAX_LOCAL_REVISION_CYCLES,
	COMPLEX_MAX_REGISTRATIONS,
	COMPLEX_MAX_REPORTED_TOKENS,
	COMPLEX_MAX_TASK_ATTEMPTS,
	COMPLEX_MAX_TASK_WORKER_INVOCATIONS,
	COMPLEX_MAX_TASKS,
	COMPLEX_MAX_TOTAL_REVISION_CYCLES,
	COMPLEX_MAX_WORKER_INVOCATIONS,
	COMPLEX_PARENT_SCOPE_PATH_MAX_BYTES,
	COMPLEX_PARENT_STATUSES,
	COMPLEX_PHASES,
	COMPLEX_PLAN_ID_PATTERN,
	COMPLEX_PLAN_MAX_BYTES,
	COMPLEX_TASK_STATUSES,
	type ComplexDraft,
	ComplexDraftSchema,
	type ComplexExecution,
	ComplexParentSchema,
	type ComplexPlan,
	type ComplexPlanMaterial,
	ComplexPlanSchema,
	complexTaskId,
	EVIDENCE_FRESHNESS,
	type OwnershipClaim,
	REVIEW_GATES,
} from "./complex-types.ts";
import type { RuntimeConfig } from "./config.ts";
import type { Risk, TaskContract } from "./contracts.ts";
import { taskContractDigest } from "./criterion-evidence.ts";
import type { ExecutionMode } from "./execution-contract.ts";
import { HostWorkflowError } from "./host-workflow-error.ts";
import { evaluatePolicy, type PolicyAction, type PolicyContext } from "./policy.ts";
import { assertTaskContractBinding } from "./task-contract.ts";

export {
	assertComplexPlanBinding,
	COMPLEX_PLAN_DIGEST_DOMAIN,
	ComplexPlanBindingError,
	complexPlanDigest,
	ownershipPathError,
} from "./complex-binding.ts";

/**
 * Deterministic Host compiler/validator for V0.7B COMPLEX plans (COMPLEX_SEQUENTIAL_WORKFLOW.md §4–§7.2).
 * Pure: no model, worker, check, writer, Approval or durable Run. Filesystem and Policy facts arrive through
 * an injected inspector, and ownership claims are responsibility, never permission.
 */

const identifierPattern = new RegExp(COMPLEX_IDENTIFIER_PATTERN);
const planIdPattern = new RegExp(COMPLEX_PLAN_ID_PATTERN);
/** Worker tools the claimed operation will use; Policy is evaluated for exactly that operation. */
const claimTools = { modify: "runtime_edit", create: "runtime_write", delete: "runtime_delete" } as const;
/** Synthetic identity for evaluating current Policy before a Run exists; the decision is never stored or granted. */
const preparationIdentity = "complex-prepare";

function invalidRequest(message: string): HostWorkflowError {
	return new HostWorkflowError("INVALID_REQUEST", message);
}
function invalidCriteria(message: string): HostWorkflowError {
	return new HostWorkflowError("INVALID_CRITERIA", message);
}
function longest<T extends string>(values: readonly T[]): T {
	return values.reduce((best, value) => (Buffer.byteLength(value) > Buffer.byteLength(best) ? value : best));
}

export function complexDraftBytes(draft: ComplexDraft): number {
	return Buffer.byteLength(JSON.stringify(draft), "utf8");
}

/** Closed shape and byte bound of untrusted draft data (INVALID_REQUEST); references are compiler checks. */
export function parseComplexDraft(value: unknown): ComplexDraft {
	if (!Check(ComplexDraftSchema, value))
		throw invalidRequest(
			"complexDraft does not match the closed COMPLEX draft schema; ids, statuses, digests, limits, Risk and permissions cannot be supplied",
		);
	const bytes = complexDraftBytes(value);
	if (bytes > COMPLEX_DRAFT_MAX_BYTES)
		throw invalidRequest(`complexDraft is ${bytes} UTF-8 bytes; the limit is ${COMPLEX_DRAFT_MAX_BYTES}`);
	return structuredClone(value);
}

/** Frozen limits (§6): COMPLEX maxima capped by configured Budget and revision limits; R3 allows no revision. */
export function complexPlanLimits(config: RuntimeConfig, risk: Risk): ComplexPlan["limits"] {
	return {
		maxTasks: COMPLEX_MAX_TASKS,
		maxWorkerInvocations: Math.min(
			COMPLEX_MAX_WORKER_INVOCATIONS,
			config.budget?.max_worker_invocations ?? COMPLEX_MAX_WORKER_INVOCATIONS,
		),
		maxReportedTokens: Math.min(
			COMPLEX_MAX_REPORTED_TOKENS,
			config.budget?.max_reported_tokens ?? COMPLEX_MAX_REPORTED_TOKENS,
		),
		maxTotalRevisionCycles:
			risk === "R3" ? 0 : Math.min(COMPLEX_MAX_TOTAL_REVISION_CYCLES, config.agents.max_revision_cycles),
	};
}

/** Parent and registration preflight (§3.2, §4.1, §10.2): reject oversized or unrepresentable input, never shorten. */
function preflightError(parent: TaskContract, config: RuntimeConfig): string | undefined {
	try {
		assertTaskContractBinding(parent, { workflow: "COMPLEX", config });
	} catch (error) {
		return error instanceof Error ? error.message : "Invalid COMPLEX parent Task Contract";
	}
	const registrations = config.verification.checks;
	if (registrations.length > COMPLEX_MAX_REGISTRATIONS)
		return `COMPLEX supports at most ${COMPLEX_MAX_REGISTRATIONS} registered checks; ${registrations.length} are configured and none is truncated or deregistered`;
	if (registrations.some((check) => check.id.length > 128 || !identifierPattern.test(check.id)))
		return "COMPLEX needs every registered check ID to be a Host identifier (1-128 characters of [A-Za-z0-9._:-])";
	if (!registrations.some((check) => check.required)) return "COMPLEX requires at least one required registered check";
	if (!Check(ComplexParentSchema, parent))
		return "The parent Task Contract exceeds the COMPLEX projection bounds (Host identifier, goal of at most 2048 characters, at most 32 scope paths)";
	if (
		parent.acceptanceCriteria.some((criterion) =>
			criterion.scope.paths.some((path) => Buffer.byteLength(path, "utf8") > COMPLEX_PARENT_SCOPE_PATH_MAX_BYTES),
		)
	)
		return `A parent scope path exceeds ${COMPLEX_PARENT_SCOPE_PATH_MAX_BYTES} UTF-8 bytes; the frozen contract is never shortened`;
	return undefined;
}

/** Mechanical draft conversion: Host IDs, parent AC IDs and canonical order. References are validated afterwards. */
function planMaterial(
	planId: string,
	parent: TaskContract,
	draft: ComplexDraft,
	config: RuntimeConfig,
	limits: ComplexPlan["limits"],
): ComplexPlanMaterial {
	const byNumber = (left: number, right: number) => left - right;
	return {
		schemaVersion: 1,
		planId,
		parentTaskId: parent.id,
		parentTaskContractDigest: taskContractDigest(parent),
		tasks: draft.tasks.map((task, index) => ({
			id: complexTaskId(index + 1),
			title: task.title,
			goal: task.goal,
			dependsOn: [...task.dependsOnIndexes].sort(byNumber).map(complexTaskId),
			criterionIds: [...task.criterionIndexes]
				.sort(byNumber)
				.map((position) => `AC-${String(position).padStart(3, "0")}`),
			ownership: task.ownership
				.map(({ path, operation }) => ({ path, operation }))
				.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
			checkIds: [...task.checkIds].sort(),
			maxRevisionCycles: Math.min(COMPLEX_MAX_LOCAL_REVISION_CYCLES, limits.maxTotalRevisionCycles),
		})),
		integration: {
			criterionIds: parent.acceptanceCriteria.map((criterion) => criterion.id),
			checkIds: config.verification.checks.map((check) => check.id).sort(),
			reviewRequired: true,
			finalChecksRequired: true,
		},
		limits,
	};
}

/** Execution-mode and Risk rules for claims (§3.2.7, §7.2). The R3 target is grammar-derived, never draft-chosen. */
function claimRuleError(
	plan: Pick<ComplexPlanMaterial, "tasks">,
	executionMode: ExecutionMode,
	risk: Risk,
	r3Target: string | undefined,
): string | undefined {
	const claims = plan.tasks.flatMap((task) => task.ownership.map((claim) => ({ taskId: task.id, claim })));
	if (risk === "R3") {
		if (executionMode !== "EDIT" || !r3Target)
			return 'R3 COMPLEX supports only the exact "delete file <path>" goal in EDIT mode';
		const [only] = claims;
		if (
			claims.length !== 1 ||
			only.taskId !== complexTaskId(1) ||
			only.claim.operation !== "delete" ||
			only.claim.path !== r3Target
		)
			return `R3 COMPLEX needs exactly one delete claim of ${JSON.stringify(r3Target)} held by CT-001 and no other claims; later tasks are read-only`;
		return undefined;
	}
	if (executionMode === "READ_ONLY" && claims.length)
		return "A READ_ONLY COMPLEX plan cannot claim files; every task is a read-only contribution";
	if (claims.some(({ claim }) => claim.operation === "delete"))
		return 'Delete claims are supported only for the R3 "delete file <path>" goal';
	return undefined;
}

/** Bounded read-only facts about one exact claim path. Admission evidence only; never permission. */
export interface ComplexPathFact {
	path: string;
	/** FilePolicyPathInspector verdict: no symlink, special file, multiply linked file or root escape. */
	safe: boolean;
	kind: "file" | "missing" | "directory";
	/**
	 * Existing components match the on-disk spelling exactly and a missing name has no case/Unicode-folded sibling;
	 * false when a listing is unreadable or exceeds the inspection bound (fail closed).
	 */
	exactSpelling: boolean;
	/** Existing single-link regular file holding bounded non-binary strict UTF-8 text. */
	text: boolean;
	/** Missing leaf whose parent directory exists with exact spelling (no directory is ever created). */
	parentDirectory: boolean;
}

/** Injected Host adapter; the compiler performs no I/O itself. */
export interface ComplexClaimInspector {
	/**
	 * Facts for each path in input order, plus the protected paths the Run's Policy receives for this project and
	 * configuration. Called at most once, and only after every pure check has passed.
	 */
	inspect(paths: readonly string[]): Promise<{ facts: readonly ComplexPathFact[]; protectedPaths: readonly string[] }>;
}

function claimPolicy(
	config: RuntimeConfig,
	executionMode: ExecutionMode,
	risk: Risk,
	r3Target: string | undefined,
	protectedPaths: readonly string[],
): PolicyContext {
	return {
		executionMode,
		executionRunId: preparationIdentity,
		tools: [
			{ id: claimTools.create, operation: "write" },
			{ id: claimTools.modify, operation: "edit" },
			...(r3Target ? [{ id: claimTools.delete, operation: "delete" as const }] : []),
		],
		allowedPaths: [...config.files.allowed_paths],
		protectedPaths: [...protectedPaths],
		configDigest: preparationIdentity,
		...(risk === "R2" ? { r2RunId: preparationIdentity } : {}),
		...(risk === "R3" && r3Target ? { r3Scope: { runId: preparationIdentity, targetPath: r3Target } } : {}),
	};
}

/** Claim semantics (§5.1) and current Policy for the claimed operation. A reason means denied. */
function claimAdmissionError(
	claim: OwnershipClaim,
	fact: ComplexPathFact | undefined,
	policy: PolicyContext,
	risk: Risk,
): string | undefined {
	if (!fact || fact.path !== claim.path) return "was not inspected";
	if (!fact.safe) return "is not a safe project file (symlink, special file, multiply linked file or root escape)";
	if (fact.kind === "directory") return "is a directory; only exact files can be claimed (no subtree ownership)";
	if (!fact.exactSpelling)
		return "does not match the verified filesystem spelling (case or Unicode alias, or an unreadable or oversized directory)";
	if (claim.operation === "create") {
		if (fact.kind !== "missing") return "already exists; create needs a missing file (no clobber)";
		if (!fact.parentDirectory) return "has no existing parent directory; directories are never created";
	} else if (fact.kind !== "file" || !fact.text) return "needs an existing bounded strict UTF-8 text file";
	const action: PolicyAction = {
		runId: preparationIdentity,
		actionId: preparationIdentity,
		role: "Developer",
		tool: claimTools[claim.operation],
		// Same lower bound the worker tools use: R2 binding for R2 Runs, deletion is always R3.
		risk: claim.operation === "delete" ? "R3" : risk === "R2" ? "R2" : "R1",
		paths: [claim.path],
		actionDigest: preparationIdentity,
	};
	const decision = evaluatePolicy(action, policy, [{ path: fact.path, safe: fact.safe, kind: fact.kind }]);
	const admitted =
		claim.operation === "delete" ? decision.decision === "APPROVAL_REQUIRED" : decision.decision === "ALLOW";
	return admitted
		? undefined
		: `is denied by current Policy (${decision.risk}/${decision.decision}: ${decision.reason})`;
}

async function claimFactsError(
	plan: Pick<ComplexPlanMaterial, "tasks">,
	config: RuntimeConfig,
	executionMode: ExecutionMode,
	risk: Risk,
	r3Target: string | undefined,
	inspector: ComplexClaimInspector,
): Promise<string | undefined> {
	const claims = plan.tasks.flatMap((task) => task.ownership.map((claim) => ({ taskId: task.id, claim })));
	if (!claims.length) return undefined;
	let inspection: Awaited<ReturnType<ComplexClaimInspector["inspect"]>>;
	try {
		inspection = await inspector.inspect(claims.map(({ claim }) => claim.path));
	} catch {
		// Unknown facts fail closed: no claim is admitted without a completed inspection.
		return "Claimed or protected paths could not be inspected; no ownership was admitted";
	}
	const { facts, protectedPaths } = inspection;
	const policy = claimPolicy(config, executionMode, risk, r3Target, protectedPaths);
	for (const [index, { taskId, claim }] of claims.entries()) {
		const error = claimAdmissionError(claim, facts[index], policy, risk);
		if (error) return `${taskId} ${claim.operation} claim ${JSON.stringify(claim.path)} ${error}`;
	}
	return undefined;
}

/**
 * Current feasibility of every claim: execution-mode/R3 rules, fresh exact-path facts and current Policy for the
 * claimed operation. Returns the first denial; undefined is still not a grant. Reusable at Run admission.
 */
export async function complexClaimsDenial(input: {
	plan: Pick<ComplexPlanMaterial, "tasks">;
	config: RuntimeConfig;
	executionMode: ExecutionMode;
	risk: Risk;
	/** Frozen parent goal; the only source of an R3 deletion target. */
	goal: string;
	claims: ComplexClaimInspector;
}): Promise<string | undefined> {
	const r3Target = input.risk === "R3" ? r3DeletionTarget(input.goal) : undefined;
	return (
		claimRuleError(input.plan, input.executionMode, input.risk, r3Target) ??
		(await claimFactsError(input.plan, input.config, input.executionMode, input.risk, r3Target, input.claims))
	);
}

/**
 * Conservative worst-case execution projection for this parent and plan (§10.3): bounded counters at their §6
 * maxima, unbounded revisions/tokens at MAX_SAFE_INTEGER, the longest enum spellings, maximal identifiers,
 * every capture present and every task claim reported as changed. Prepare admits a plan only if this fits.
 */
export function maxComplexExecution(parent: TaskContract, plan: ComplexPlan): ComplexExecution {
	const identifier = "x".repeat(128);
	const workspace = "f".repeat(64);
	const check = longest(CHECK_GATES);
	const review = longest(REVIEW_GATES);
	const evidenceFreshness = longest(EVIDENCE_FRESHNESS);
	const failureCode = longest(COMPLEX_FAILURE_CODES);
	return {
		schemaVersion: 1,
		ownerId: identifier,
		projectRevision: Number.MAX_SAFE_INTEGER,
		runId: identifier,
		stateRevision: Number.MAX_SAFE_INTEGER,
		parent: { ...structuredClone(parent), status: longest(COMPLEX_PARENT_STATUSES) },
		plan: structuredClone(plan),
		phase: longest(COMPLEX_PHASES),
		activeTaskId: complexTaskId(1),
		tasks: plan.tasks.map((task) => ({
			id: task.id,
			status: longest(COMPLEX_TASK_STATUSES),
			attempt: COMPLEX_MAX_TASK_ATTEMPTS,
			revisionCycle: COMPLEX_MAX_LOCAL_REVISION_CYCLES,
			workerInvocations: COMPLEX_MAX_TASK_WORKER_INVOCATIONS,
			reportedTokens: Number.MAX_SAFE_INTEGER,
			entryWorkspaceDigest: workspace,
			exitWorkspaceDigest: workspace,
			changedFiles: task.ownership.map((claim) => claim.path),
			changesUnknown: false,
			selfCheck: check,
			review,
			test: check,
			evidenceFreshness,
			failureCode,
		})),
		integration: { check, review, test: check, workspaceDigest: workspace, evidenceFreshness, failureCode },
		budget: {
			workerInvocations: COMPLEX_MAX_WORKER_INVOCATIONS,
			reportedTokens: Number.MAX_SAFE_INTEGER,
			totalRevisionCycles: COMPLEX_MAX_TOTAL_REVISION_CYCLES,
			status: longest(COMPLEX_BUDGET_STATUSES),
		},
		cleanup: longest(CLEANUP_STATUSES),
		partialChanges: false,
		changesUnknown: false,
		failureCode,
	};
}

export interface CompileComplexPlanInput {
	/** Runtime-issued canonical lowercase UUID; never supplied by the draft or App. */
	planId: string;
	/** Host-built pending parent (`buildTaskContract(... workflow: "COMPLEX")`); bound unchanged. */
	parent: TaskContract;
	/** Untrusted `workflow.prepare.complexDraft` proposal data. */
	draft: unknown;
	/** Trusted configuration: registered checks, Budget, revision limits and allowed paths. */
	config: RuntimeConfig;
	executionMode: ExecutionMode;
	/** Frozen classification Risk; every task inherits it and R3 admits only the grammar-derived deletion. */
	risk: Risk;
	claims: ComplexClaimInspector;
}

/**
 * Validates the draft and compiles the immutable plan bound to the parent: INVALID_REQUEST for shape/bytes,
 * INVALID_CRITERIA for graph, coverage, ownership, check, Policy or limit violations. No silent reorder,
 * truncation, merge or downgrade. The inspector is consulted only after every pure check has passed.
 */
export async function compileComplexPlan(input: CompileComplexPlanInput): Promise<ComplexPlan> {
	const draft = parseComplexDraft(input.draft);
	const { parent, config, executionMode, risk } = input;
	if (!planIdPattern.test(input.planId)) throw invalidRequest("planId must be a Runtime-issued lowercase UUID");
	const preflight = preflightError(parent, config);
	if (preflight) throw invalidCriteria(preflight);
	const r3Target = risk === "R3" ? r3DeletionTarget(parent.goal) : undefined;
	const material = planMaterial(input.planId, parent, draft, config, complexPlanLimits(config, risk));
	// Mode/Risk claim rules first: they name the precise R3/READ_ONLY violation before generic invariants.
	const structural =
		claimRuleError(material, executionMode, risk, r3Target) ??
		complexStructureError(
			material,
			parent,
			config.verification.checks.map((check) => check.id),
		);
	if (structural) throw invalidCriteria(structural);
	const plan: ComplexPlan = { ...material, complexPlanDigest: complexPlanDigest(material) };
	if (!Check(ComplexPlanSchema, plan))
		throw invalidCriteria("The compiled plan does not match the COMPLEX plan schema");
	const planBytes = Buffer.byteLength(JSON.stringify(plan), "utf8");
	if (planBytes > COMPLEX_PLAN_MAX_BYTES)
		throw invalidRequest(
			`The compiled plan is ${planBytes} UTF-8 bytes; the limit is ${COMPLEX_PLAN_MAX_BYTES} and nothing is truncated`,
		);
	const projectionBytes = Buffer.byteLength(JSON.stringify(maxComplexExecution(parent, plan)), "utf8");
	if (projectionBytes > COMPLEX_EXECUTION_MAX_BYTES)
		throw invalidRequest(
			`The largest execution projection for this plan is ${projectionBytes} UTF-8 bytes; the limit is ${COMPLEX_EXECUTION_MAX_BYTES}`,
		);
	const denial = await claimFactsError(material, config, executionMode, risk, r3Target, input.claims);
	if (denial) throw invalidCriteria(denial);
	return plan;
}
