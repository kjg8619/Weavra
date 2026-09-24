import { type Static, Type } from "typebox";
import {
	ACCEPTANCE_CRITERION_ID_PATTERN,
	MAX_ACCEPTANCE_CRITERIA,
	MAX_ACCEPTANCE_STATEMENT_LENGTH,
} from "./contracts.ts";

/**
 * V0.7B COMPLEX contract v1 (docs/architecture/COMPLEX_SEQUENTIAL_WORKFLOW.md §4, §7.1, §9, §10.2).
 * Closed wire/data shapes and their bounds only. A plan is Host-compiled proposal data bound to one frozen
 * parent Task Contract; it never grants Policy, Approval, verification or completion authority.
 */
export const COMPLEX_CONTRACT_VERSION = 1;
export const COMPLEX_MIN_TASKS = 2;
export const COMPLEX_MAX_TASKS = 8;
export const COMPLEX_TITLE_MAX_LENGTH = 80;
export const COMPLEX_GOAL_MAX_LENGTH = 300;
export const COMPLEX_MAX_DEPENDENCIES = COMPLEX_MAX_TASKS - 1;
export const COMPLEX_MAX_TASK_CRITERIA = MAX_ACCEPTANCE_CRITERIA;
export const COMPLEX_MAX_TASK_CLAIMS = 16;
export const COMPLEX_MAX_PLAN_CLAIMS = 64;
export const COMPLEX_MAX_TASK_CHECKS = 16;
/** Registered checks a COMPLEX Run can freeze; larger configurations fail preflight and are never truncated. */
export const COMPLEX_MAX_REGISTRATIONS = 16;
export const COMPLEX_PATH_MAX_BYTES = 256;
export const COMPLEX_DRAFT_MAX_BYTES = 12288;
export const COMPLEX_PLAN_MAX_BYTES = 12288;
export const COMPLEX_EXECUTION_MAX_BYTES = 32768;
export const COMPLEX_MAX_WORKER_INVOCATIONS = 24;
export const COMPLEX_MAX_REPORTED_TOKENS = 200000;
export const COMPLEX_MAX_LOCAL_REVISION_CYCLES = 2;
export const COMPLEX_MAX_TOTAL_REVISION_CYCLES = 3;
/** attempt = local revisionCycle + 1 after activation. */
export const COMPLEX_MAX_TASK_ATTEMPTS = COMPLEX_MAX_LOCAL_REVISION_CYCLES + 1;
/** One Developer and one Reviewer per task attempt. */
export const COMPLEX_MAX_TASK_WORKER_INVOCATIONS = COMPLEX_MAX_TASK_ATTEMPTS * 2;
export const COMPLEX_PARENT_GOAL_MAX_LENGTH = 2048;
export const COMPLEX_PARENT_SCOPE_MAX_PATHS = 32;
export const COMPLEX_PARENT_SCOPE_PATH_MAX_BYTES = 256;
export const COMPLEX_TASK_ID_PATTERN = "^CT-00[1-8]$";
export const COMPLEX_IDENTIFIER_PATTERN = "^[A-Za-z0-9._:-]+$";
export const COMPLEX_PLAN_ID_PATTERN = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";

export const OWNERSHIP_OPERATIONS = ["modify", "create", "delete"] as const;
export const COMPLEX_TASK_STATUSES = [
	"PENDING",
	"ELIGIBLE",
	"IMPLEMENTING",
	"WAITING_APPROVAL",
	"SELF_CHECK",
	"REVIEW",
	"TEST",
	"STOPPING",
	"COMPLETED",
	"BLOCKED",
	"FAILED",
	"CANCELLED",
	"INTERRUPTED",
] as const;
export const COMPLEX_PHASES = [
	"TASK_SEQUENCE",
	"INTEGRATION_CHECK",
	"FINAL_REVIEW",
	"FINAL_TEST",
	"COMPLETING",
	"STOPPING",
	"TERMINAL",
] as const;
export const CLEANUP_STATUSES = ["NOT_REQUESTED", "PENDING", "CONFIRMED", "UNCONFIRMED"] as const;
export const COMPLEX_FAILURE_CODES = [
	"OWNERSHIP_CONFLICT",
	"UNOWNED_PATH",
	"DEPENDENCY_NOT_COMPLETED",
	"RUN_STOPPED",
	"WORKER_FAILED",
	"INVALID_RESULT",
	"POLICY_DENIED",
	"CHECK_FAILED",
	"CHECK_UNAVAILABLE",
	"REVIEW_BLOCKED",
	"REVIEW_MISSING",
	"STALE_EVIDENCE",
	"PARENT_MISMATCH",
	"PLAN_MISMATCH",
	"BUDGET_EXHAUSTED",
	"BUDGET_UNKNOWN",
	"REVISION_LIMIT",
	"APPROVAL_DENIED",
	"APPROVAL_EXPIRED",
	"APPROVAL_INVALID",
	"EXTERNAL_MUTATION",
	"CANCELLED",
	"OWNER_LOST",
	"CLEANUP_UNCONFIRMED",
	"STORAGE_FAILED",
] as const;
export const CHECK_GATES = ["NOT_RUN", "RUNNING", "PASS", "FAIL", "UNAVAILABLE", "STALE"] as const;
export const REVIEW_GATES = ["NOT_RUN", "RUNNING", "PASS", "REVISE", "BLOCK", "UNAVAILABLE", "STALE"] as const;
export const EVIDENCE_FRESHNESS = ["NONE", "CURRENT", "STALE", "UNKNOWN"] as const;
export const COMPLEX_BUDGET_STATUSES = ["WITHIN_LIMITS", "EXHAUSTED", "UNKNOWN"] as const;
export const COMPLEX_PARENT_STATUSES = ["pending", "inProgress", "completed", "blocked"] as const;

const strict = { additionalProperties: false } as const;
const identifier = Type.String({ minLength: 1, maxLength: 128, pattern: COMPLEX_IDENTIFIER_PATTERN });
const digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
/** Existing GitWorkspace encoding: bare 64-hex, not `sha256:`-prefixed. */
const workspaceDigest = Type.String({ pattern: "^[0-9a-f]{64}$" });
const taskId = Type.String({ pattern: COMPLEX_TASK_ID_PATTERN });
const criterionId = Type.String({ pattern: ACCEPTANCE_CRITERION_ID_PATTERN });
const safeCounter = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const title = Type.String({ minLength: 1, maxLength: COMPLEX_TITLE_MAX_LENGTH, pattern: "\\S" });
const goal = Type.String({ minLength: 1, maxLength: COMPLEX_GOAL_MAX_LENGTH, pattern: "\\S" });
/** Character bound only; the exact lexical/UTF-8 path rule is `ownershipPathError` (an ownership, not shape, rule). */
const ownershipPath = Type.String({ minLength: 1, maxLength: COMPLEX_PATH_MAX_BYTES });

/** Responsibility for mutating one exact file in one plan. Never filesystem access, Policy ALLOW or Approval. */
export const OwnershipClaimSchema = Type.Object(
	{ path: ownershipPath, operation: Type.Enum(OWNERSHIP_OPERATIONS) },
	strict,
);
export type OwnershipClaim = Static<typeof OwnershipClaimSchema>;
export type OwnershipOperation = OwnershipClaim["operation"];

/**
 * Untrusted human decomposition proposal on `workflow.prepare`. Only per-field types and bounds are shape;
 * references between rows, parent criteria and registrations are validated by the Host compiler.
 * Ids, statuses, digests, limits, Risk and permissions cannot be supplied.
 */
export const ComplexDraftTaskSchema = Type.Object(
	{
		title,
		goal,
		/** 1-based references to earlier draft rows only. */
		dependsOnIndexes: Type.Array(Type.Integer({ minimum: 1, maximum: COMPLEX_MAX_TASKS }), {
			maxItems: COMPLEX_MAX_DEPENDENCIES,
		}),
		/** 1-based references to the normalized parent acceptance criteria. */
		criterionIndexes: Type.Array(Type.Integer({ minimum: 1, maximum: MAX_ACCEPTANCE_CRITERIA }), {
			minItems: 1,
			maxItems: COMPLEX_MAX_TASK_CRITERIA,
		}),
		ownership: Type.Array(OwnershipClaimSchema, { maxItems: COMPLEX_MAX_TASK_CLAIMS }),
		/** Local selection from registered checks only; never a worker-created command. */
		checkIds: Type.Array(identifier, { minItems: 1, maxItems: COMPLEX_MAX_TASK_CHECKS }),
	},
	strict,
);
export const ComplexDraftSchema = Type.Object(
	{ tasks: Type.Array(ComplexDraftTaskSchema, { minItems: COMPLEX_MIN_TASKS, maxItems: COMPLEX_MAX_TASKS }) },
	strict,
);
export type ComplexDraft = Static<typeof ComplexDraftSchema>;

export const ComplexTaskSchema = Type.Object(
	{
		id: taskId,
		title,
		goal,
		dependsOn: Type.Array(taskId, { maxItems: COMPLEX_MAX_DEPENDENCIES, uniqueItems: true }),
		criterionIds: Type.Array(criterionId, { minItems: 1, maxItems: COMPLEX_MAX_TASK_CRITERIA, uniqueItems: true }),
		ownership: Type.Array(OwnershipClaimSchema, { maxItems: COMPLEX_MAX_TASK_CLAIMS }),
		checkIds: Type.Array(identifier, { minItems: 1, maxItems: COMPLEX_MAX_TASK_CHECKS, uniqueItems: true }),
		maxRevisionCycles: Type.Integer({ minimum: 0, maximum: COMPLEX_MAX_LOCAL_REVISION_CYCLES }),
	},
	strict,
);
export type ComplexTask = Static<typeof ComplexTaskSchema>;

const complexPlanFields = {
	schemaVersion: Type.Literal(1),
	/** Runtime-issued canonical lowercase UUID. */
	planId: Type.String({ pattern: COMPLEX_PLAN_ID_PATTERN }),
	parentTaskId: identifier,
	parentTaskContractDigest: digest,
	/** Array order is execution order, not a scheduling hint. */
	tasks: Type.Array(ComplexTaskSchema, { minItems: COMPLEX_MIN_TASKS, maxItems: COMPLEX_MAX_TASKS }),
	integration: Type.Object(
		{
			criterionIds: Type.Array(criterionId, { minItems: 1, maxItems: MAX_ACCEPTANCE_CRITERIA, uniqueItems: true }),
			checkIds: Type.Array(identifier, { minItems: 1, maxItems: COMPLEX_MAX_REGISTRATIONS, uniqueItems: true }),
			reviewRequired: Type.Literal(true),
			finalChecksRequired: Type.Literal(true),
		},
		strict,
	),
	limits: Type.Object(
		{
			maxTasks: Type.Literal(COMPLEX_MAX_TASKS),
			maxWorkerInvocations: Type.Integer({ minimum: 1, maximum: COMPLEX_MAX_WORKER_INVOCATIONS }),
			maxReportedTokens: Type.Integer({ minimum: 1, maximum: COMPLEX_MAX_REPORTED_TOKENS }),
			maxTotalRevisionCycles: Type.Integer({ minimum: 0, maximum: COMPLEX_MAX_TOTAL_REVISION_CYCLES }),
		},
		strict,
	),
};
/** Digest material: every plan field except `complexPlanDigest`. */
export const ComplexPlanMaterialSchema = Type.Object(complexPlanFields, strict);
export type ComplexPlanMaterial = Static<typeof ComplexPlanMaterialSchema>;
/** Immutable Host-compiled plan. Its digest is not a signature and authorizes nothing. */
export const ComplexPlanSchema = Type.Object({ ...complexPlanFields, complexPlanDigest: digest }, strict);
export type ComplexPlan = Static<typeof ComplexPlanSchema>;

export const ComplexTaskStatusSchema = Type.Enum(COMPLEX_TASK_STATUSES);
export type ComplexTaskStatus = Static<typeof ComplexTaskStatusSchema>;
export const ComplexPhaseSchema = Type.Enum(COMPLEX_PHASES);
export type ComplexPhase = Static<typeof ComplexPhaseSchema>;
export const CleanupStatusSchema = Type.Enum(CLEANUP_STATUSES);
export type CleanupStatus = Static<typeof CleanupStatusSchema>;
export const ComplexFailureCodeSchema = Type.Enum(COMPLEX_FAILURE_CODES);
export type ComplexFailureCode = Static<typeof ComplexFailureCodeSchema>;
export const CheckGateSchema = Type.Enum(CHECK_GATES);
export type CheckGate = Static<typeof CheckGateSchema>;
export const ReviewGateSchema = Type.Enum(REVIEW_GATES);
export type ReviewGate = Static<typeof ReviewGateSchema>;
export const EvidenceFreshnessSchema = Type.Enum(EVIDENCE_FRESHNESS);
export type EvidenceFreshness = Static<typeof EvidenceFreshnessSchema>;

/**
 * Kernel-assigned execution identity carried as trusted adapter data (§10.1). TASK names a plan task at
 * attempt 1–3; INTEGRATION has no task and attempt 1. Never taken from worker, App or tool arguments.
 */
export const ComplexEvidenceContextSchema = Type.Union([
	Type.Object(
		{
			parentTaskContractDigest: digest,
			complexPlanDigest: digest,
			scope: Type.Literal("TASK"),
			taskId,
			attempt: Type.Integer({ minimum: 1, maximum: COMPLEX_MAX_TASK_ATTEMPTS }),
		},
		strict,
	),
	Type.Object(
		{
			parentTaskContractDigest: digest,
			complexPlanDigest: digest,
			scope: Type.Literal("INTEGRATION"),
			taskId: Type.Null(),
			attempt: Type.Literal(1),
		},
		strict,
	),
]);
export type ComplexEvidenceContext = Static<typeof ComplexEvidenceContextSchema>;

const failureCode = Type.Union([ComplexFailureCodeSchema, Type.Null()]);
export const ComplexTaskStateSchema = Type.Object(
	{
		id: taskId,
		status: ComplexTaskStatusSchema,
		attempt: Type.Integer({ minimum: 0, maximum: COMPLEX_MAX_TASK_ATTEMPTS }),
		revisionCycle: Type.Integer({ minimum: 0, maximum: COMPLEX_MAX_LOCAL_REVISION_CYCLES }),
		workerInvocations: Type.Integer({ minimum: 0, maximum: COMPLEX_MAX_TASK_WORKER_INVOCATIONS }),
		/** Provider-reported subtotal; null is unknown, never zero, and may exceed the limit after an in-flight call. */
		reportedTokens: Type.Union([safeCounter, Type.Null()]),
		/** null means not captured, not an empty workspace. */
		entryWorkspaceDigest: Type.Union([workspaceDigest, Type.Null()]),
		exitWorkspaceDigest: Type.Union([workspaceDigest, Type.Null()]),
		/** Task-local exact files: unique, ASCII-sorted subset of the task's claims. */
		changedFiles: Type.Array(ownershipPath, { maxItems: COMPLEX_MAX_TASK_CLAIMS, uniqueItems: true }),
		changesUnknown: Type.Boolean(),
		selfCheck: CheckGateSchema,
		review: ReviewGateSchema,
		test: CheckGateSchema,
		evidenceFreshness: EvidenceFreshnessSchema,
		failureCode,
	},
	strict,
);
export type ComplexTaskState = Static<typeof ComplexTaskStateSchema>;

export const ComplexIntegrationSchema = Type.Object(
	{
		check: CheckGateSchema,
		review: ReviewGateSchema,
		test: CheckGateSchema,
		workspaceDigest: Type.Union([workspaceDigest, Type.Null()]),
		evidenceFreshness: EvidenceFreshnessSchema,
		failureCode,
	},
	strict,
);
export type ComplexIntegration = Static<typeof ComplexIntegrationSchema>;

/**
 * Wire duplicate of the frozen parent Task Contract with the §10.2 projection bounds. Parent scope paths keep
 * the existing Policy scope syntax; exact-file ownership syntax never rewrites them.
 */
export const ComplexParentSchema = Type.Object(
	{
		id: identifier,
		goal: Type.String({ minLength: 1, maxLength: COMPLEX_PARENT_GOAL_MAX_LENGTH, pattern: "\\S" }),
		acceptanceCriteria: Type.Array(
			Type.Object(
				{
					id: criterionId,
					statement: Type.String({ minLength: 1, maxLength: MAX_ACCEPTANCE_STATEMENT_LENGTH, pattern: "\\S" }),
					scope: Type.Object(
						{
							paths: Type.Array(
								Type.String({ minLength: 1, maxLength: COMPLEX_PARENT_SCOPE_PATH_MAX_BYTES, pattern: "\\S" }),
								{ maxItems: COMPLEX_PARENT_SCOPE_MAX_PATHS, uniqueItems: true },
							),
						},
						strict,
					),
					verification: Type.Object(
						{
							checkIds: Type.Array(identifier, { maxItems: COMPLEX_MAX_REGISTRATIONS, uniqueItems: true }),
							reviewRequired: Type.Boolean(),
						},
						strict,
					),
				},
				strict,
			),
			{ minItems: 1, maxItems: MAX_ACCEPTANCE_CRITERIA },
		),
		status: Type.Enum(COMPLEX_PARENT_STATUSES),
	},
	strict,
);
export type ComplexParent = Static<typeof ComplexParentSchema>;

/**
 * Opt-in Host Control execution projection (§10.2), present iff the latest canonical Run is COMPLEX. The outer
 * canonical Run snapshot stays the final status authority; this DTO adds no outcome enum that could disagree.
 */
export const ComplexExecutionSchema = Type.Object(
	{
		schemaVersion: Type.Literal(1),
		ownerId: identifier,
		projectRevision: safeCounter,
		runId: identifier,
		stateRevision: safeCounter,
		parent: ComplexParentSchema,
		plan: ComplexPlanSchema,
		phase: ComplexPhaseSchema,
		activeTaskId: Type.Union([taskId, Type.Null()]),
		tasks: Type.Array(ComplexTaskStateSchema, { minItems: COMPLEX_MIN_TASKS, maxItems: COMPLEX_MAX_TASKS }),
		integration: ComplexIntegrationSchema,
		budget: Type.Object(
			{
				workerInvocations: Type.Integer({ minimum: 0, maximum: COMPLEX_MAX_WORKER_INVOCATIONS }),
				reportedTokens: Type.Union([safeCounter, Type.Null()]),
				totalRevisionCycles: Type.Integer({ minimum: 0, maximum: COMPLEX_MAX_TOTAL_REVISION_CYCLES }),
				status: Type.Enum(COMPLEX_BUDGET_STATUSES),
			},
			strict,
		),
		cleanup: CleanupStatusSchema,
		partialChanges: Type.Boolean(),
		changesUnknown: Type.Boolean(),
		failureCode,
	},
	strict,
);
export type ComplexExecution = Static<typeof ComplexExecutionSchema>;

/** `CT-001`… in accepted plan order (1-based position). */
export function complexTaskId(position: number): string {
	return `CT-${String(position).padStart(3, "0")}`;
}
