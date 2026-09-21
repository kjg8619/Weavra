import { type Static, type TSchema, Type } from "typebox";
import { Check } from "typebox/value";
import { BrowserVerificationEvidenceSchema, RegisteredBrowserCheckSchema } from "./browser-types.ts";
import { ExecutionModeSchema } from "./execution-contract.ts";
import { LspEvidenceSchema } from "./lsp/types.ts";
import { WorkerMeasurementSchema } from "./measurement-types.ts";
import { ProjectInstructionMetadataSchema } from "./project-instruction-types.ts";
import { BudgetStatusSchema, ProvenanceSchema } from "./provenance-types.ts";

const text = Type.String({ minLength: 1, pattern: "\\S" });
const counter = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const texts = Type.Array(text);
const strict = { additionalProperties: false } as const;

export const STANDARD_STEP_IDS = ["implement", "self-check", "review", "test", "complete"] as const;
export const QUICK_STEP_IDS = ["implement", "self-check", "test", "complete"] as const;
export const QuickScopeSchema = Type.Object(
	{ risk: Type.Enum(["R0", "R1"]), targetPath: Type.Union([text, Type.Null()]) },
	strict,
);
export type QuickScope = Static<typeof QuickScopeSchema>;
export const StepReferenceSchema = Type.Object(
	{ stepId: Type.Enum(STANDARD_STEP_IDS), attempt: Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER }) },
	strict,
);
export type StepReference = Static<typeof StepReferenceSchema>;
export type StepId = StepReference["stepId"];

export const WorkflowSchema = Type.Enum(["QUICK", "STANDARD", "COMPLEX"]);
export const RiskSchema = Type.Enum(["R0", "R1", "R2", "R3"]);
export const RoleSchema = Type.Enum(["Executor", "Developer", "Reviewer", "Lead"]);
export const CommandCheckKindSchema = Type.Enum(["build", "lint", "test", "typecheck", "format", "custom"]);
export const CheckKindSchema = Type.Union([CommandCheckKindSchema, Type.Literal("browser")]);
export const ClassificationSchema = Type.Object(
	{
		intent: Type.Enum([
			"question",
			"analysis",
			"bugfix",
			"implementation",
			"refactor",
			"research",
			"architecture",
			"creative",
			"maintenance",
		]),
		complexity: WorkflowSchema,
		risk: RiskSchema,
		confidence: Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]),
		reason: text,
	},
	strict,
);

/** Historical task shape. New live runs use TaskContractSchema; legacy tasks stay read-only observations. */
export const LegacyTaskSchema = Type.Object(
	{
		id: text,
		goal: text,
		requirements: Type.Array(text, { minItems: 1 }),
		status: Type.Enum(["pending", "inProgress", "completed", "blocked"]),
	},
	strict,
);

export const ACCEPTANCE_CRITERION_ID_PATTERN = "^AC-[0-9]{3}$";
export const MAX_ACCEPTANCE_CRITERIA = 16;
export const MAX_ACCEPTANCE_STATEMENT_LENGTH = 500;

const acceptanceId = Type.String({ pattern: ACCEPTANCE_CRITERION_ID_PATTERN });
export const CriterionStatusSchema = Type.Enum(["MET", "UNMET", "UNVERIFIED"]);
export type CriterionStatus = Static<typeof CriterionStatusSchema>;

export const AcceptanceCriterionSchema = Type.Object(
	{
		// Host-owned stable identity; workers never generate or change it.
		id: acceptanceId,
		statement: Type.String({ minLength: 1, maxLength: MAX_ACCEPTANCE_STATEMENT_LENGTH, pattern: "\\S" }),
		// Descriptive scope for this criterion. Not a permission: Policy/Execution Contract remain authority.
		scope: Type.Object({ paths: Type.Array(text, { maxItems: 32, uniqueItems: true }) }, strict),
		verification: Type.Object(
			{
				// Registered check IDs only; the Kernel maps them to actual verification evidence.
				checkIds: Type.Array(text, { uniqueItems: true }),
				reviewRequired: Type.Boolean(),
			},
			strict,
		),
	},
	strict,
);
export type AcceptanceCriterion = Static<typeof AcceptanceCriterionSchema>;

/** Host-confirmed contract, frozen for one run. Plan confirmation is not an approval or permission token. */
export const TaskContractSchema = Type.Object(
	{
		id: text,
		goal: text,
		acceptanceCriteria: Type.Array(AcceptanceCriterionSchema, {
			minItems: 1,
			maxItems: MAX_ACCEPTANCE_CRITERIA,
		}),
		status: Type.Enum(["pending", "inProgress", "completed", "blocked"]),
	},
	strict,
);
export type TaskContract = Static<typeof TaskContractSchema>;

/** Projection of per-criterion outcomes from trusted submissions and verifier evidence; no second authority store. */
export const AcceptanceResultSchema = Type.Object(
	{
		criterionId: acceptanceId,
		status: CriterionStatusSchema,
		evidenceRefs: texts,
		revision: counter,
		diffDigest: text,
	},
	strict,
);
export type AcceptanceResult = Static<typeof AcceptanceResultSchema>;

export const TaskRecordSchema = Type.Union([TaskContractSchema, LegacyTaskSchema]);
export type TaskRecord = Static<typeof TaskRecordSchema>;

export function isTaskContract(task: TaskRecord): task is TaskContract {
	return "acceptanceCriteria" in task;
}

// Execution evidence is produced by the verifier, never inferred from agent prose.
export const VerifierTrustEvidenceSchema = Type.Object(
	{
		mode: Type.Union([Type.Literal("compatible"), Type.Literal("strict")]),
		status: Type.Enum(["VERIFIED", "UNVERIFIED", "STALE", "UNKNOWN"]),
		// Malformed digests are rejected at the schema boundary, never accepted as VERIFIED evidence.
		registrationDigest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
		executableDigest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
		sources: Type.Array(
			Type.Object({ path: text, digest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }) }, strict),
			{ maxItems: 64 },
		),
	},
	strict,
);

export const SandboxEvidenceSchema = Type.Object(
	{
		mode: Type.Enum(["disabled", "required"]),
		status: Type.Enum(["ENFORCED", "UNAVAILABLE", "STALE", "UNKNOWN"]),
		backend: text,
		backendVersion: text,
		policyDigest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
	},
	strict,
);

export const CheckResultSchema = Type.Object(
	{
		id: text,
		runId: text,
		revision: counter,
		kind: CheckKindSchema,
		step: Type.Optional(StepReferenceSchema),
		status: Type.Enum(["PASS", "FAIL", "SKIPPED", "UNAVAILABLE"]),
		required: Type.Boolean(),
		exitCode: Type.Union([Type.Integer(), Type.Null()]),
		reason: text,
		evidenceRefs: texts,
		diffDigest: text,
		startedAt: Type.Optional(counter),
		finishedAt: Type.Optional(counter),
		stdout: Type.Optional(Type.String({ maxLength: 16384 })),
		stderr: Type.Optional(Type.String({ maxLength: 16384 })),
		// Bounded verifier-trust metadata only: no raw source contents, env or credentials.
		trust: Type.Optional(VerifierTrustEvidenceSchema),
		// Bounded sandbox metadata only: no settings JSON, env, HOME or absolute protected paths.
		sandbox: Type.Optional(SandboxEvidenceSchema),
		// Produced only by the independent registered browser executor, never an exploration candidate.
		browser: Type.Optional(BrowserVerificationEvidenceSchema),
		/** Positive attribution only; absence is never repair authority. */
		failureKind: Type.Optional(Type.Literal("COMMAND_NONZERO")),
	},
	strict,
);

export const CheckRequirementSchema = Type.Object(
	{
		id: text,
		kind: CheckKindSchema,
		required: Type.Boolean(),
		// Host-frozen: a required check of a strict verifier-trust Run is not completion authority without VERIFIED trust.
		trustRequired: Type.Optional(Type.Boolean()),
		// Host-frozen expected registration digest from the verifier's Run-start snapshot; never taken from a result.
		trustRegistrationDigest: Type.Optional(Type.String({ pattern: "^sha256:[0-9a-f]{64}$" })),
		// Host-frozen sandbox requirement and policy digest; ENFORCED alone is never authority.
		sandboxRequired: Type.Optional(Type.Boolean()),
		sandboxPolicyDigest: Type.Optional(Type.String({ pattern: "^sha256:[0-9a-f]{64}$" })),
		repairableExitCodes: Type.Optional(Type.Array(Type.Integer({ minimum: 1, maximum: 255 }), { uniqueItems: true })),
		browser: Type.Optional(RegisteredBrowserCheckSchema),
	},
	strict,
);
export const VerificationResultSchema = Type.Object(
	{
		runId: text,
		revision: counter,
		step: StepReferenceSchema,
		diffDigest: text,
		evidenceRefs: Type.Array(text, { minItems: 1 }),
		checks: Type.Array(CheckResultSchema),
		lspEvidence: Type.Optional(Type.Array(LspEvidenceSchema, { maxItems: 9 })),
		changedFiles: Type.Optional(texts),
		/** Verifier-owned settlement of workspace, original trust snapshot and cleanup. */
		integrity: Type.Optional(Type.Enum(["CLEAN", "BLOCKED"])),
		// Explicit verifier-owned review material; no Pi messages or implicit worker context.
		reviewContext: Type.Optional(
			Type.Object(
				{
					diff: Type.String({ maxLength: 262144 }),
					evidence: Type.Array(Type.Object({ ref: text, content: Type.String({ maxLength: 262144 }) }, strict)),
				},
				strict,
			),
		),
	},
	strict,
);
export type CheckRequirement = Static<typeof CheckRequirementSchema>;
export type VerificationResult = Static<typeof VerificationResultSchema>;

export const HandoffSchema = Type.Object(
	{
		runId: text,
		revision: counter,
		role: Type.Literal("Developer"),
		task: text,
		changed_files: texts,
		summary: text,
		assumptions: texts,
		// References to verifier evidence, not agent-supplied check results.
		tests_run: texts,
		known_risks: texts,
		unresolved: texts,
	},
	strict,
);

/** Historical Executor handoff with string requirements; read-only compatibility for stored state. */
export const LegacyExecutorHandoffSchema = Type.Object(
	{
		...HandoffSchema.properties,
		role: Type.Literal("Executor"),
		requirements: Type.Array(
			Type.Object({ requirement: text, status: CriterionStatusSchema, explanation: text }, strict),
			{ minItems: 1 },
		),
	},
	strict,
);

// Executor supplies a criterion-by-criterion result, not a self-approval or invented check evidence.
export const ExecutorHandoffSchema = Type.Object(
	{
		...HandoffSchema.properties,
		role: Type.Literal("Executor"),
		criteria: Type.Array(
			Type.Object({ criterionId: acceptanceId, status: CriterionStatusSchema, explanation: text }, strict),
			{ minItems: 1, maxItems: MAX_ACCEPTANCE_CRITERIA },
		),
	},
	strict,
);
export type ExecutorHandoff = Static<typeof ExecutorHandoffSchema>;
export type LegacyExecutorHandoff = Static<typeof LegacyExecutorHandoffSchema>;
export const ExecutorResultSchema = Type.Union([ExecutorHandoffSchema, LegacyExecutorHandoffSchema]);
export type ExecutorResult = Static<typeof ExecutorResultSchema>;

export function isCriteriaHandoff(result: ExecutorResult): result is ExecutorHandoff {
	return "criteria" in result;
}

const reviewIssues = Type.Array(
	Type.Object(
		{
			severity: Type.Enum(["info", "warning", "blocker"]),
			file: Type.Union([text, Type.Null()]),
			description: text,
			recommendation: text,
		},
		strict,
	),
);

/** Historical Reviewer verdict with string requirements; read-only compatibility for stored state. */
export const LegacyReviewSchema = Type.Object(
	{
		runId: text,
		revision: counter,
		role: Type.Literal("Reviewer"),
		task: text,
		result: Type.Enum(["PASS", "REVISE", "BLOCK"]),
		issues: reviewIssues,
		requirements: Type.Array(
			Type.Object({ requirement: text, status: CriterionStatusSchema, evidenceRefs: texts }, strict),
			{ minItems: 1 },
		),
		evidenceRefs: texts,
		diffDigest: text,
	},
	strict,
);

export const ReviewSchema = Type.Object(
	{
		runId: text,
		revision: counter,
		role: Type.Literal("Reviewer"),
		task: text,
		result: Type.Enum(["PASS", "REVISE", "BLOCK"]),
		issues: reviewIssues,
		// Reviewer judges the frozen AC IDs; it cannot add, remove, replace or restate criteria.
		criteria: Type.Array(
			Type.Object({ criterionId: acceptanceId, status: CriterionStatusSchema, evidenceRefs: texts }, strict),
			{ minItems: 1, maxItems: MAX_ACCEPTANCE_CRITERIA },
		),
		evidenceRefs: texts,
		diffDigest: text,
	},
	strict,
);

export type LegacyReview = Static<typeof LegacyReviewSchema>;
export const ReviewRecordSchema = Type.Union([ReviewSchema, LegacyReviewSchema]);
export type ReviewRecord = Static<typeof ReviewRecordSchema>;

export function isCriteriaReview(review: ReviewRecord): review is Review {
	return "criteria" in review;
}

// A decision is not an approval token. R3 execution requires a separate, bound approval in S5.
export const PolicyDecisionSchema = Type.Object(
	{
		runId: text,
		actionId: text,
		role: Type.Union([RoleSchema, Type.Literal("Verifier")]),
		risk: Type.Union([RiskSchema, Type.Literal("UNKNOWN")]),
		decision: Type.Enum(["ALLOW", "DENY", "REVIEW_REQUIRED", "APPROVAL_REQUIRED"]),
		reason: text,
		actionDigest: text,
		configDigest: text,
		// Missing only in historical audit records; never grants live execution permission.
		executionMode: Type.Optional(ExecutionModeSchema),
		projectInstructionDigest: Type.Optional(
			Type.Union([Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }), Type.Null()]),
		),
	},
	strict,
);

export const RoleSessionReferenceSchema = Type.Object({ role: RoleSchema, sessionId: text, sessionFile: text }, strict);
export type RoleSessionReference = Static<typeof RoleSessionReferenceSchema>;

export const R3ScopeSchema = Type.Object({ runId: text, targetPath: text }, strict);
export type R3Scope = Static<typeof R3ScopeSchema>;
export const ApprovalRequestSchema = Type.Object(
	{
		runId: text,
		actionId: text,
		actionDigest: text,
		configDigest: text,
		reason: text,
		role: Type.Literal("Developer"),
		operation: Type.Literal("delete-file"),
		path: text,
		preconditionDigest: text,
		bytes: counter,
		step: StepReferenceSchema,
		revision: counter,
		expiresAt: counter,
	},
	strict,
);
export type ApprovalRequest = Static<typeof ApprovalRequestSchema>;
export type ApprovalProposal = Omit<ApprovalRequest, "expiresAt">;
export const ApprovalDecisionSchema = Type.Object(
	{
		runId: text,
		actionId: text,
		actionDigest: text,
		configDigest: text,
		expiresAt: counter,
		approved: Type.Boolean(),
	},
	strict,
);
export type ApprovalDecision = Static<typeof ApprovalDecisionSchema>;
export const ApprovalRecordSchema = Type.Object(
	{
		request: ApprovalRequestSchema,
		status: Type.Enum(["PENDING", "APPROVED", "CONSUMED", "DENIED", "EXPIRED", "CANCELLED", "INTERRUPTED"]),
	},
	strict,
);
export type ApprovalRecord = Static<typeof ApprovalRecordSchema>;

export const VerificationRepairAttemptSchema = Type.Object(
	{
		fromRevision: counter,
		fromStep: Type.Object({ stepId: Type.Literal("self-check"), attempt: Type.Integer({ minimum: 1 }) }, strict),
		toRevision: counter,
		toStep: Type.Object({ stepId: Type.Literal("implement"), attempt: Type.Integer({ minimum: 1 }) }, strict),
		diffDigest: text,
		evidenceRefs: Type.Array(text, { minItems: 1, uniqueItems: true }),
		failedCheckIds: Type.Array(text, { minItems: 1, uniqueItems: true }),
		taskContractDigest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
	},
	strict,
);
export type VerificationRepairAttempt = Static<typeof VerificationRepairAttemptSchema>;

export const RunSchema = Type.Object(
	{
		schemaVersion: Type.Literal(1),
		revision: counter,
		eventSequence: counter,
		currentStep: Type.Union([StepReferenceSchema, Type.Null()]),
		runId: text,
		goal: text,
		status: Type.Enum([
			"CREATED",
			"RUNNING",
			"WAITING_APPROVAL",
			"BLOCKED",
			"FAILED",
			"CANCELLED",
			"INTERRUPTED",
			"COMPLETED",
		]),
		phase: Type.Enum(["PREFLIGHT", "IMPLEMENT", "SELF_CHECK", "REVIEW", "TEST", "COMPLETE"]),
		workflow: WorkflowSchema,
		// Optional for read-only legacy observations, mandatory for new live Kernel/Store writes.
		executionMode: Type.Optional(ExecutionModeSchema),
		// null = no configured file; absent = legacy/unknown. No instruction content is durable here.
		projectInstruction: Type.Optional(Type.Union([ProjectInstructionMetadataSchema, Type.Null()])),
		classification: ClassificationSchema,
		risk: RiskSchema,
		currentTask: text,
		tasks: Type.Array(TaskRecordSchema, { minItems: 1 }),
		// Present for new live runs; absent on historical legacy runs.
		taskContractDigest: Type.Optional(Type.String({ pattern: "^sha256:[0-9a-f]{64}$" })),
		activeAgents: Type.Array(RoleSchema, { uniqueItems: true }),
		completed: texts,
		next: texts,
		roleSessionRefs: Type.Array(RoleSessionReferenceSchema),
		revisionCycle: counter,
		maxRevisionCycles: Type.Optional(Type.Integer({ minimum: 0, maximum: 3 })),
		verificationRepair: Type.Optional(
			Type.Object(
				{
					mode: Type.Enum(["disabled", "self-check-once"]),
					attempts: Type.Array(VerificationRepairAttemptSchema, { maxItems: 1 }),
				},
				strict,
			),
		),
		handoff: Type.Optional(HandoffSchema),
		reviewHistory: Type.Optional(Type.Array(ReviewRecordSchema)),
		workspace: Type.Optional(
			Type.Object(
				{
					diffDigest: text,
					changedFiles: texts,
					evidenceRefs: texts,
					safe: Type.Boolean(),
					changedLines: Type.Optional(counter),
				},
				strict,
			),
		),
		r3Scope: Type.Optional(R3ScopeSchema),
		approvals: Type.Optional(Type.Array(ApprovalRecordSchema)),
		quickScope: Type.Optional(QuickScopeSchema),
		executorResult: Type.Optional(ExecutorResultSchema),
		executorDigest: Type.Optional(text),
		review: Type.Optional(ReviewRecordSchema),
		// Per-criterion outcome projection for observation; derived from trusted submissions and verifier evidence.
		acceptance: Type.Optional(Type.Array(AcceptanceResultSchema)),
		// Bounded per-invocation measurements (no prompts, completions, reasoning text or tool arguments).
		workerMeasurements: Type.Optional(Type.Array(WorkerMeasurementSchema)),
		provenance: Type.Optional(ProvenanceSchema),
		budget: Type.Optional(BudgetStatusSchema),
		verification: Type.Array(CheckResultSchema),
		lastError: Type.Union([text, Type.Null()]),
		createdAt: counter,
		updatedAt: counter,
	},
	strict,
);

export type Workflow = Static<typeof WorkflowSchema>;
export type Risk = Static<typeof RiskSchema>;
export type Role = Static<typeof RoleSchema>;
export type Classification = Static<typeof ClassificationSchema>;
export type CheckResult = Static<typeof CheckResultSchema>;
export type Handoff = Static<typeof HandoffSchema>;
export type Review = Static<typeof ReviewSchema>;
export type PolicyDecision = Static<typeof PolicyDecisionSchema>;
export type Run = Static<typeof RunSchema>;

export const STANDARD_STEP_PHASES = {
	implement: "IMPLEMENT",
	"self-check": "SELF_CHECK",
	review: "REVIEW",
	test: "TEST",
	complete: "COMPLETE",
} as const satisfies Record<StepId, Run["phase"]>;

/** Shape validation only. Kernel guards additionally check transitions, identity and evidence references. */
export function validateContract<T extends TSchema>(schema: T, value: unknown): Static<T> {
	if (!Check(schema, value)) throw new Error("Invalid runtime contract");
	return value;
}
