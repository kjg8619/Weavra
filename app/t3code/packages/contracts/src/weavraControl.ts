import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ProjectId } from "./baseSchemas.ts";
import {
  WeavraConnectionStatus,
  WeavraErrorCode,
  WeavraRunSummary,
  WeavraSnapshotEnvelope,
  WeavraSnapshotSummary,
} from "./weavra.ts";

export const WEAVRA_CONTROL_MAX_REQUEST_BYTES = 32768;
export const WEAVRA_CONTROL_MAX_RESPONSE_BYTES = 65536;
export const WEAVRA_CONTROL_COMMANDS = [
  "control.hello",
  "control.snapshot",
  "workflow.prepare",
  "workflow.confirm",
  "workflow.cancel",
  "approval.resolve",
  "browser.inspect",
  "browser.prepare",
  "browser.confirm",
  "facts.prepare",
  "facts.confirm",
] as const;

const identifier = WeavraRunSummary.fields.runId;
const counter = WeavraRunSummary.fields.codeRevision;
const digest = Schema.String.check(Schema.isPattern(/^sha256:[0-9a-f]{64}$/));
const boundedText = Schema.String.check(Schema.isMaxLength(WEAVRA_CONTROL_MAX_RESPONSE_BYTES));
const goal = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2048),
  Schema.isPattern(/\S/),
);
const envelope = { protocolVersion: Schema.Literal(1), id: identifier };
const mutation = { ...envelope, ownerId: identifier, expectedProjectRevision: counter };

const browserIdentifier = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(64),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
);
const browserCaptureId = Schema.String.check(
  Schema.isPattern(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/),
);
const browserUrl = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048));
const browserVersion = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128));
const browserValue = Schema.String.check(Schema.isMaxLength(1024));

export const WeavraBrowserTarget = Schema.Struct({
  selector: Schema.String.check(
    Schema.isPattern(/^#[A-Za-z][A-Za-z0-9_-]{0,63}$/),
    Schema.isMaxLength(65),
  ),
  attribute: Schema.optionalKey(
    Schema.Literals([
      "role",
      "title",
      "aria-label",
      "aria-disabled",
      "aria-checked",
      "aria-expanded",
      "aria-selected",
    ]),
  ),
});
export type WeavraBrowserTarget = typeof WeavraBrowserTarget.Type;

export const WeavraBrowserAssertion = Schema.Union([
  Schema.Struct({
    type: Schema.Literals(["text_equals", "text_contains"]),
    expected: browserValue,
  }),
  Schema.Struct({ type: Schema.Literals(["element_exists", "element_not_exists"]) }),
  Schema.Struct({ type: Schema.Literal("attribute_equals"), expected: browserValue }),
]);
export type WeavraBrowserAssertion = typeof WeavraBrowserAssertion.Type;

export const WeavraBrowserFreshnessPolicy = Schema.Struct({
  mode: Schema.Literal("NEW_ISOLATED_CAPTURE"),
  maxAgeMs: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 15000 })),
});
export type WeavraBrowserFreshnessPolicy = typeof WeavraBrowserFreshnessPolicy.Type;

export const WeavraBrowserRegistrationRequest = Schema.Struct({
  candidateId: browserCaptureId,
  expectedCandidateDigest: digest,
  checkId: browserIdentifier,
  origin: browserUrl,
  documentIdentity: browserUrl,
  target: WeavraBrowserTarget,
  assertion: WeavraBrowserAssertion,
  freshness: WeavraBrowserFreshnessPolicy,
});
export type WeavraBrowserRegistrationRequest = typeof WeavraBrowserRegistrationRequest.Type;

export const WeavraRegisteredBrowserCheck = Schema.Struct({
  version: Schema.Literal(1),
  checkId: browserIdentifier,
  projectId: digest,
  origin: browserUrl,
  documentIdentity: browserUrl,
  target: WeavraBrowserTarget,
  assertion: WeavraBrowserAssertion,
  freshness: WeavraBrowserFreshnessPolicy,
  registrationDigest: digest,
});
export type WeavraRegisteredBrowserCheck = typeof WeavraRegisteredBrowserCheck.Type;

export const WeavraBrowserCandidateSummary = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  kind: Schema.Literal("BROWSER_OBSERVATION_CANDIDATE"),
  candidateId: browserCaptureId,
  projectId: digest,
  authority: Schema.Literal("CANDIDATE_ONLY"),
  scope: Schema.Literal("LOCAL_STATIC_DOCUMENT"),
  origin: browserUrl,
  documentIdentity: browserUrl,
  capturedAt: counter,
  pageRevision: digest,
  source: Schema.Struct({
    implementationRevision: digest,
    readerRevision: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/)),
    readerDigest: digest,
    executableIdentityDigest: digest,
    browserVersion,
  }),
  freshness: Schema.Struct({
    mode: Schema.Literal("CAPTURE_ONLY"),
    startedAt: counter,
    finishedAt: counter,
  }),
  observationDigest: digest,
  observationType: Schema.Literal("target"),
  observation: Schema.Struct({
    target: WeavraBrowserTarget,
    exists: Schema.Boolean,
    value: Schema.NullOr(browserValue),
  }),
  candidateDigest: digest,
  cleanup: Schema.Literal("CONFIRMED"),
});
export type WeavraBrowserCandidateSummary = typeof WeavraBrowserCandidateSummary.Type;

export const WeavraBrowserVerificationEvidence = Schema.Struct({
  version: Schema.Literal(1),
  registrationDigest: digest,
  projectId: digest,
  origin: browserUrl,
  documentIdentity: browserUrl,
  documentDigest: digest,
  observationType: Schema.Literal("target"),
  target: WeavraBrowserTarget,
  assertion: WeavraBrowserAssertion,
  freshness: WeavraBrowserFreshnessPolicy,
  captureId: browserCaptureId,
  capturedAt: counter,
  implementationRevision: digest,
  executableIdentityDigest: digest,
  browserVersion,
  observationDigest: digest,
  isolation: Schema.Literal("PRIVATE_HOME_PROFILE_CDP_PIPE"),
  cleanup: Schema.Literal("CONFIRMED"),
  result: Schema.Literals(["PASS", "FAIL"]),
  browserEvidenceDigest: digest,
});
export type WeavraBrowserVerificationEvidence = typeof WeavraBrowserVerificationEvidence.Type;

export const WeavraBrowserPreview = Schema.Struct({
  previewId: identifier,
  previewDigest: digest,
  ownerId: identifier,
  projectRevision: counter,
  expiresAt: counter,
  candidate: WeavraBrowserCandidateSummary,
  check: WeavraRegisteredBrowserCheck,
  isolation: Schema.Literal("PRIVATE_HOME_PROFILE_CDP_PIPE_NOT_OS_SANDBOX"),
});
export type WeavraBrowserPreview = typeof WeavraBrowserPreview.Type;

export const WeavraBrowserState = Schema.Struct({
  projectId: digest,
  candidates: Schema.Array(WeavraBrowserCandidateSummary).check(Schema.isMaxLength(2)),
  omittedCandidates: counter,
  checks: Schema.Array(
    Schema.Struct({ check: WeavraRegisteredBrowserCheck, required: Schema.Boolean }),
  ).check(Schema.isMaxLength(2)),
  omittedChecks: counter,
  evidence: Schema.Array(
    Schema.Struct({
      runId: identifier,
      checkId: browserIdentifier,
      revision: counter,
      step: Schema.NullOr(
        Schema.Struct({
          stepId: Schema.Literals(["implement", "self-check", "review", "test", "complete"]),
          attempt: counter.check(Schema.isGreaterThanOrEqualTo(1)),
        }),
      ),
      status: Schema.Literals(["PASS", "FAIL", "SKIPPED", "UNAVAILABLE"]),
      diffDigest: boundedText,
      browser: Schema.NullOr(WeavraBrowserVerificationEvidence),
    }),
  ).check(Schema.isMaxLength(2)),
  omittedEvidence: counter,
});
export type WeavraBrowserState = typeof WeavraBrowserState.Type;

const factSource = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const factStatement = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500));
export const WeavraFactPreview = Schema.Struct({
  previewId: identifier,
  previewDigest: digest,
  ownerId: identifier,
  projectRevision: counter,
  expiresAt: counter,
  sourceRef: factSource,
  sourceDigest: digest,
  statement: factStatement,
});
export type WeavraFactPreview = typeof WeavraFactPreview.Type;
const factIdentity = {
  id: identifier,
  sourceRef: factSource,
  sourceDigest: digest,
  reviewedAt: counter,
};
const projectFact = Schema.Union([
  Schema.Struct({ ...factIdentity, status: Schema.Literal("VALID"), statement: factStatement }),
  Schema.Struct({ ...factIdentity, status: Schema.Literal("STALE"), statement: Schema.Null }),
]);

// COMPLEX workflow wire contract, duplicated from the Runtime wire shapes and never imported
// across build roots. v1 is the sequential V0.7B contract
// (docs/architecture/COMPLEX_SEQUENTIAL_WORKFLOW.md §4, §10); v2 adds implementation waves
// (docs/architecture/PARALLEL_AGENTS.md §8). The unversioned plan and execution schemas accept
// either version; the server requires every shape on a connection to match the advertised version.
// Structural rules that need no parent or hashing live here; digests and cross-object
// consistency are checked by the server consumer before publication.
export const WEAVRA_COMPLEX_MAX_DRAFT_BYTES = 12_288;
export const WEAVRA_COMPLEX_MAX_PLAN_BYTES = 12_288;
export const WEAVRA_COMPLEX_MAX_EXECUTION_BYTES = 32_768;
const utf8 = new TextEncoder();
const jsonBytes = (value: unknown) => utf8.encode(JSON.stringify(value)).byteLength;
/** Unique and ascending in JavaScript code-unit order, which is ASCII order for ASCII values. */
const ascending = (values: ReadonlyArray<string>) =>
  values.every((value, index) => index === 0 || values[index - 1]! < value);
const strictlyAscending = Schema.makeFilter<ReadonlyArray<string>>(ascending, {
  expected: "unique values in ascending order",
});
const complexTaskId = Schema.String.check(Schema.isPattern(/^CT-00[1-8]$/));
const criterionId = Schema.String.check(Schema.isPattern(/^AC-[0-9]{3}$/));
const workspaceDigest = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/));
const canonicalUuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
);
const complexTitle = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/\S/),
);
const complexGoal = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(300),
  Schema.isPattern(/\S/),
);
const oneBasedIndex = counter.check(Schema.isGreaterThanOrEqualTo(1));
const forbiddenPathCharacters = new Set(["\\", "*", "?", "[", "]", "{", "}"]);
/** Lexical wire rule only; Runtime additionally inspects the filesystem before and at effect time. */
function isExactFilePath(path: string) {
  if (utf8.encode(path).byteLength > 256 || /^[A-Za-z]:/.test(path)) return false;
  for (const character of path) {
    const code = character.codePointAt(0)!;
    if (
      code <= 0x1f ||
      code === 0x7f ||
      code === 0x200e ||
      code === 0x200f ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069) ||
      forbiddenPathCharacters.has(character)
    )
      return false;
  }
  return path.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}
const exactFilePath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.makeFilter(isExactFilePath, { expected: "an exact canonical project-relative file" }),
);

export const WeavraComplexOwnershipClaim = Schema.Struct({
  path: exactFilePath,
  operation: Schema.Literals(["modify", "create", "delete"]),
});
export type WeavraComplexOwnershipClaim = typeof WeavraComplexOwnershipClaim.Type;

/** Human planning proposal sent with `workflow.prepare`; Runtime compiles and assigns every ID. */
export const WeavraComplexDraft = Schema.Struct({
  tasks: Schema.Array(
    Schema.Struct({
      title: complexTitle,
      goal: complexGoal,
      dependsOnIndexes: Schema.Array(oneBasedIndex).check(Schema.isMaxLength(7), Schema.isUnique()),
      criterionIndexes: Schema.Array(oneBasedIndex).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(16),
        Schema.isUnique(),
      ),
      ownership: Schema.Array(WeavraComplexOwnershipClaim).check(Schema.isMaxLength(16)),
      checkIds: Schema.Array(identifier).check(
        Schema.isMinLength(1),
        Schema.isMaxLength(16),
        Schema.isUnique(),
      ),
    }),
  ).check(
    Schema.isMinLength(2),
    Schema.isMaxLength(8),
    // A 1-based dependency index must name an earlier row.
    Schema.makeFilter((tasks) =>
      tasks.every((task, index) =>
        task.dependsOnIndexes.every((dependency) => dependency <= index),
      ),
    ),
  ),
}).check(Schema.makeFilter((draft) => jsonBytes(draft) <= WEAVRA_COMPLEX_MAX_DRAFT_BYTES));
export type WeavraComplexDraft = typeof WeavraComplexDraft.Type;

export const WeavraComplexTask = Schema.Struct({
  id: complexTaskId,
  title: complexTitle,
  goal: complexGoal,
  dependsOn: Schema.Array(complexTaskId).check(Schema.isMaxLength(7), Schema.isUnique()),
  criterionIds: Schema.Array(criterionId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
    strictlyAscending,
  ),
  ownership: Schema.Array(WeavraComplexOwnershipClaim).check(
    Schema.isMaxLength(16),
    Schema.makeFilter((claims) => ascending(claims.map((claim) => claim.path))),
  ),
  checkIds: Schema.Array(identifier).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(16),
    strictlyAscending,
  ),
  maxRevisionCycles: counter.check(Schema.isLessThanOrEqualTo(2)),
});
export type WeavraComplexTask = typeof WeavraComplexTask.Type;

const planFields = {
  planId: canonicalUuid,
  complexPlanDigest: digest,
  parentTaskId: identifier,
  parentTaskContractDigest: digest,
  tasks: Schema.Array(WeavraComplexTask).check(Schema.isMinLength(2), Schema.isMaxLength(8)),
  integration: Schema.Struct({
    criterionIds: Schema.Array(criterionId).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(16),
      strictlyAscending,
    ),
    checkIds: Schema.Array(identifier).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(16),
      strictlyAscending,
    ),
    reviewRequired: Schema.Literal(true),
    finalChecksRequired: Schema.Literal(true),
  }),
};
const planLimits = {
  maxTasks: Schema.Literal(8),
  maxWorkerInvocations: counter.check(Schema.isBetween({ minimum: 1, maximum: 24 })),
  maxReportedTokens: counter.check(Schema.isBetween({ minimum: 1, maximum: 200_000 })),
  maxTotalRevisionCycles: counter.check(Schema.isLessThanOrEqualTo(3)),
};
/** Order, edge, exclusivity and byte rules shared by both plan versions. */
function planRulesHold(plan: {
  readonly tasks: ReadonlyArray<WeavraComplexTask>;
  readonly limits: { readonly maxTotalRevisionCycles: number };
}) {
  const paths = plan.tasks.flatMap((task) => task.ownership.map((claim) => claim.path));
  return (
    jsonBytes(plan) <= WEAVRA_COMPLEX_MAX_PLAN_BYTES &&
    paths.length <= 64 &&
    new Set(paths).size === paths.length &&
    plan.tasks.every(
      (task, index) =>
        task.id === `CT-00${index + 1}` &&
        task.maxRevisionCycles <= plan.limits.maxTotalRevisionCycles &&
        // Fixed-width IDs order like their indexes: every edge points to an earlier task.
        task.dependsOn.every((dependency) => dependency < task.id),
    )
  );
}
export const WeavraComplexPlanV1 = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ...planFields,
  limits: Schema.Struct(planLimits),
}).check(Schema.makeFilter((plan) => planRulesHold(plan)));
export type WeavraComplexPlanV1 = typeof WeavraComplexPlanV1.Type;
/** V0.8A: the frozen number of tasks whose implementation may run at once (Runtime config). */
export const WeavraComplexPlanV2 = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  ...planFields,
  limits: Schema.Struct({
    ...planLimits,
    maxParallel: counter.check(Schema.isBetween({ minimum: 1, maximum: 4 })),
  }),
}).check(Schema.makeFilter((plan) => planRulesHold(plan)));
export type WeavraComplexPlanV2 = typeof WeavraComplexPlanV2.Type;
export const WeavraComplexPlan = Schema.Union([WeavraComplexPlanV1, WeavraComplexPlanV2]);
export type WeavraComplexPlan = typeof WeavraComplexPlan.Type;

const scopePath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256),
  Schema.isPattern(/\S/),
  Schema.makeFilter((path: string) => utf8.encode(path).byteLength <= 256),
);
/** Exact frozen parent Task Contract plus its lifecycle status; never a replacement contract. */
export const WeavraTaskContract = Schema.Struct({
  id: identifier,
  goal,
  acceptanceCriteria: Schema.Array(
    Schema.Struct({
      id: criterionId,
      statement: Schema.String.check(
        Schema.isMinLength(1),
        Schema.isMaxLength(500),
        Schema.isPattern(/\S/),
      ),
      scope: Schema.Struct({
        paths: Schema.Array(scopePath).check(Schema.isMaxLength(32), Schema.isUnique()),
      }),
      verification: Schema.Struct({
        checkIds: Schema.Array(identifier).check(Schema.isMaxLength(16), Schema.isUnique()),
        reviewRequired: Schema.Boolean,
      }),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(16)),
  status: Schema.Literals(["pending", "inProgress", "completed", "blocked"]),
});
export type WeavraTaskContract = typeof WeavraTaskContract.Type;

const taskStatusesV1 = [
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
export const WeavraComplexTaskStatusV1 = Schema.Literals(taskStatusesV1);
/** v2 adds HANDED_OFF: implemented, waiting for its verification turn. */
export const WeavraComplexTaskStatusV2 = Schema.Literals([...taskStatusesV1, "HANDED_OFF"]);
export type WeavraComplexTaskStatus = typeof WeavraComplexTaskStatusV2.Type;
export const WeavraComplexPhase = Schema.Literals([
  "TASK_SEQUENCE",
  "INTEGRATION_CHECK",
  "FINAL_REVIEW",
  "FINAL_TEST",
  "COMPLETING",
  "STOPPING",
  "TERMINAL",
]);
export type WeavraComplexPhase = typeof WeavraComplexPhase.Type;
export const WeavraComplexCleanupStatus = Schema.Literals([
  "NOT_REQUESTED",
  "PENDING",
  "CONFIRMED",
  "UNCONFIRMED",
]);
export const WeavraComplexFailureCode = Schema.Literals([
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
]);
export const WeavraComplexCheckGate = Schema.Literals([
  "NOT_RUN",
  "RUNNING",
  "PASS",
  "FAIL",
  "UNAVAILABLE",
  "STALE",
]);
export const WeavraComplexReviewGate = Schema.Literals([
  "NOT_RUN",
  "RUNNING",
  "PASS",
  "REVISE",
  "BLOCK",
  "UNAVAILABLE",
  "STALE",
]);
const evidenceFreshness = Schema.Literals(["NONE", "CURRENT", "STALE", "UNKNOWN"]);

const taskStateFields = {
  attempt: counter.check(Schema.isLessThanOrEqualTo(3)),
  revisionCycle: counter.check(Schema.isLessThanOrEqualTo(2)),
  workerInvocations: counter.check(Schema.isLessThanOrEqualTo(6)),
  reportedTokens: Schema.NullOr(counter),
  entryWorkspaceDigest: Schema.NullOr(workspaceDigest),
  exitWorkspaceDigest: Schema.NullOr(workspaceDigest),
  changedFiles: Schema.Array(exactFilePath).check(Schema.isMaxLength(16), strictlyAscending),
  changesUnknown: Schema.Boolean,
  selfCheck: WeavraComplexCheckGate,
  review: WeavraComplexReviewGate,
  test: WeavraComplexCheckGate,
  evidenceFreshness,
  failureCode: Schema.NullOr(WeavraComplexFailureCode),
};
export const WeavraComplexTaskStateV1 = Schema.Struct({
  id: complexTaskId,
  status: WeavraComplexTaskStatusV1,
  ...taskStateFields,
});
export const WeavraComplexTaskStateV2 = Schema.Struct({
  id: complexTaskId,
  status: WeavraComplexTaskStatusV2,
  ...taskStateFields,
});
/** A task row of either contract version; v1 rows are the subset without HANDED_OFF. */
export type WeavraComplexTaskState = typeof WeavraComplexTaskStateV2.Type;
export const WeavraComplexIntegration = Schema.Struct({
  check: WeavraComplexCheckGate,
  review: WeavraComplexReviewGate,
  test: WeavraComplexCheckGate,
  workspaceDigest: Schema.NullOr(workspaceDigest),
  evidenceFreshness,
  failureCode: Schema.NullOr(WeavraComplexFailureCode),
});

const executionIdentity = {
  ownerId: identifier,
  projectRevision: counter,
  runId: identifier,
  stateRevision: counter,
  parent: WeavraTaskContract,
};
const executionOutcome = {
  integration: WeavraComplexIntegration,
  budget: Schema.Struct({
    workerInvocations: counter.check(Schema.isLessThanOrEqualTo(24)),
    reportedTokens: Schema.NullOr(counter),
    totalRevisionCycles: counter.check(Schema.isLessThanOrEqualTo(3)),
    status: Schema.Literals(["WITHIN_LIMITS", "EXHAUSTED", "UNKNOWN"]),
  }),
  cleanup: WeavraComplexCleanupStatus,
  partialChanges: Schema.Boolean,
  changesUnknown: Schema.Boolean,
  failureCode: Schema.NullOr(WeavraComplexFailureCode),
};
const withinExecutionBytes = Schema.makeFilter(
  (execution: unknown) => jsonBytes(execution) <= WEAVRA_COMPLEX_MAX_EXECUTION_BYTES,
);
/** Read-only Runtime projection of the latest COMPLEX Run; the snapshot status stays the outcome. */
export const WeavraComplexExecutionV1 = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  ...executionIdentity,
  plan: WeavraComplexPlanV1,
  phase: WeavraComplexPhase,
  activeTaskId: Schema.NullOr(complexTaskId),
  tasks: Schema.Array(WeavraComplexTaskStateV1).check(Schema.isMinLength(2), Schema.isMaxLength(8)),
  ...executionOutcome,
}).check(withinExecutionBytes);
export type WeavraComplexExecutionV1 = typeof WeavraComplexExecutionV1.Type;
/**
 * v2: the Runtime-reported active rows of the current wave, in plan order (never more than 4).
 * Amendment A1: a historical V0.7B Run keeps its frozen v1 plan, with no wave and only v1 row
 * statuses; the enclosing snapshot must show that Run terminal.
 */
export const WeavraComplexExecutionV2 = Schema.Struct({
  schemaVersion: Schema.Literal(2),
  ...executionIdentity,
  plan: Schema.Union([WeavraComplexPlanV2, WeavraComplexPlanV1]),
  phase: WeavraComplexPhase,
  activeTaskIds: Schema.Array(complexTaskId).check(Schema.isMaxLength(4), strictlyAscending),
  tasks: Schema.Array(WeavraComplexTaskStateV2).check(Schema.isMinLength(2), Schema.isMaxLength(8)),
  ...executionOutcome,
}).check(
  withinExecutionBytes,
  Schema.makeFilter(
    (execution) =>
      execution.plan.schemaVersion === 2 ||
      (execution.activeTaskIds.length === 0 &&
        execution.tasks.every((row) => row.status !== "HANDED_OFF")),
  ),
);
export type WeavraComplexExecutionV2 = typeof WeavraComplexExecutionV2.Type;
export const WeavraComplexExecution = Schema.Union([
  WeavraComplexExecutionV1,
  WeavraComplexExecutionV2,
]);
export type WeavraComplexExecution = typeof WeavraComplexExecution.Type;
const terminalRunStatuses: ReadonlySet<string> = new Set([
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
  "COMPLETED",
]);

// V0.8B Planner wire contract (docs/architecture/PLANNER_DRAFT.md §5.5, §7), duplicated from the
// Runtime wire shapes and never imported across build roots. A Planner draft is candidate data:
// READY is advice, and nothing it proposes runs until the human loads it into the editor, prepares
// and confirms a Runtime preview.
export const WEAVRA_PLANNER_MAX_DRAFT_RESPONSE_BYTES = 16_384;
export const WeavraPlannerFailureCode = Schema.Literals([
  "MODEL_UNAVAILABLE",
  "CONTEXT_TOO_LARGE",
  "TIMEOUT",
  "PROVIDER_ERROR",
  "BUDGET_EXHAUSTED",
  "BUDGET_UNKNOWN",
  "NO_DRAFT",
  "DRAFT_INVALID",
  "STALE",
]);
export type WeavraPlannerFailureCode = typeof WeavraPlannerFailureCode.Type;
const plannerRouteName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(WEAVRA_CONTROL_MAX_RESPONSE_BYTES),
  Schema.isPattern(/\S/),
);
/** Snapshot status of this Host's planning request; the draft itself only travels in `planner.read`. */
export const WeavraPlannerStatus = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  planId: canonicalUuid,
  status: Schema.Literals(["RUNNING", "READY", "FAILED", "CANCELLED"]),
  requestDigest: digest,
  projectRevision: counter,
  current: Schema.Boolean,
  startedAt: counter,
  finishedAt: Schema.NullOr(counter),
  route: Schema.NullOr(
    Schema.Struct({
      alias: Schema.NullOr(Schema.Literal("plan")),
      profile: plannerRouteName,
      provider: plannerRouteName,
      model: plannerRouteName,
    }),
  ),
  usage: Schema.Struct({
    invocations: counter.check(Schema.isLessThanOrEqualTo(3)),
    reportedTokens: Schema.NullOr(counter),
  }),
  taskCount: Schema.NullOr(counter.check(Schema.isBetween({ minimum: 2, maximum: 8 }))),
  failureCode: Schema.NullOr(WeavraPlannerFailureCode),
}).check(
  Schema.makeFilter(
    (planner) =>
      // Each status carries exactly its own fields: a task count only when READY, a failure code
      // only when FAILED, and no finish time only while RUNNING.
      (planner.status === "READY") === (planner.taskCount !== null) &&
      (planner.status === "FAILED") === (planner.failureCode !== null) &&
      (planner.status === "RUNNING") === (planner.finishedAt === null) &&
      // A READY draft was submitted by at least one model invocation.
      (planner.status !== "READY" || planner.usage.invocations >= 1),
    { expected: "a planner status with exactly the fields of its status" },
  ),
);
export type WeavraPlannerStatus = typeof WeavraPlannerStatus.Type;

/** Parent acceptance statements, bounded alike for `workflow.prepare` and `planner.start`. */
const acceptanceStatements = Schema.Array(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(500), Schema.isPattern(/\S/)),
).check(Schema.isMinLength(1), Schema.isMaxLength(16));

export const WeavraControlMutation = Schema.Union([
  Schema.Struct({
    ...mutation,
    type: Schema.Literal("facts.prepare"),
    sourceRef: factSource,
    statement: factStatement,
  }),
  Schema.Struct({
    ...mutation,
    type: Schema.Literal("facts.confirm"),
    previewId: identifier,
    previewDigest: digest,
  }),
  Schema.Struct({ ...mutation, type: Schema.Literal("browser.inspect") }),
  Schema.Struct({
    ...mutation,
    type: Schema.Literal("browser.prepare"),
    registration: WeavraBrowserRegistrationRequest,
  }),
  Schema.Struct({
    ...mutation,
    type: Schema.Literal("browser.confirm"),
    previewId: identifier,
    previewDigest: digest,
  }),
  Schema.Struct({
    ...mutation,
    type: Schema.Literal("workflow.prepare"),
    goal,
    recipeId: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,64}$/))),
    recipeInputs: Schema.optionalKey(
      Schema.Record(
        Schema.String.check(Schema.isPattern(/^[a-z0-9_]+$/)),
        Schema.String.check(Schema.isMaxLength(2048)),
      ).check(Schema.isMaxProperties(16)),
    ),
    acceptanceStatements: Schema.optionalKey(acceptanceStatements),
    complexDraft: Schema.optionalKey(WeavraComplexDraft),
  }).check(
    // Reviewed recipes remain STANDARD-only; a recipe never travels with a COMPLEX draft.
    Schema.makeFilter(
      (request) =>
        request.complexDraft === undefined ||
        (request.recipeId === undefined && request.recipeInputs === undefined),
    ),
  ),
  Schema.Struct({
    ...mutation,
    type: Schema.Literal("workflow.confirm"),
    previewId: identifier,
    previewDigest: digest,
  }),
  Schema.Struct({
    ...mutation,
    type: Schema.Literal("workflow.cancel"),
    runId: identifier,
    expectedStateRevision: counter,
  }),
  Schema.Struct({
    ...mutation,
    type: Schema.Literal("approval.resolve"),
    runId: identifier,
    expectedStateRevision: counter,
    approvalId: identifier,
    decision: Schema.Literals(["approve", "reject"]),
  }),
  // V0.8B: the goal and criteria only. Runtime classifies, plans and bounds everything else, and
  // `planner.start` returns at once while planning runs in the background.
  Schema.Struct({
    ...mutation,
    type: Schema.Literal("planner.start"),
    goal,
    acceptanceStatements: Schema.optionalKey(acceptanceStatements),
  }),
  Schema.Struct({ ...mutation, type: Schema.Literal("planner.cancel"), planId: canonicalUuid }),
  Schema.Struct({ ...mutation, type: Schema.Literal("planner.read"), planId: canonicalUuid }),
  // V0.8C: the Run to derive a candidate re-run draft from. Read-only on the Runtime: Runtime
  // checks eligibility and derives everything else; no writer, `.ai` write, Run or revision change.
  Schema.Struct({ ...mutation, type: Schema.Literal("workflow.derive"), runId: identifier }),
]);
export type WeavraControlMutation = typeof WeavraControlMutation.Type;

export const WeavraControlRequest = Schema.Union([
  Schema.Struct({ ...envelope, type: Schema.Literal("control.hello") }),
  Schema.Struct({ ...envelope, type: Schema.Literal("control.snapshot") }),
  WeavraControlMutation,
]);
export type WeavraControlRequest = typeof WeavraControlRequest.Type;

export const WeavraControlErrorCode = Schema.Literals([
  "INVALID_REQUEST",
  "UNSUPPORTED_VERSION",
  "UNSUPPORTED_COMMAND",
  "HANDSHAKE_REQUIRED",
  "CONTROL_UNAVAILABLE",
  "OWNER_CHANGED",
  "PROJECT_CHANGED",
  "STATE_UNAVAILABLE",
  "STALE_PROJECT",
  "STALE_RUN",
  "CONFIG_CHANGED",
  "ACTIVE_RUN",
  "WRITER_PRESENT",
  "PLAN_NOT_FOUND",
  "PLAN_EXPIRED",
  "PLAN_CHANGED",
  "PLAN_CONSUMED",
  "INVALID_GOAL",
  "UNSUPPORTED_WORKFLOW",
  "INVALID_RECIPE",
  "INVALID_CRITERIA",
  "POLICY_DENIED",
  "RUN_NOT_FOUND",
  "RUN_NOT_OWNED",
  "TERMINAL_RUN",
  "APPROVAL_NOT_PENDING",
  "APPROVAL_EXPIRED",
  "REQUEST_ID_REUSED",
  "REQUEST_EXPIRED",
  "REQUEST_OUT_OF_ORDER",
  "REQUEST_TOO_LARGE",
  "RESPONSE_TOO_LARGE",
  "BUSY",
  "START_FAILED",
  "BROWSER_UNAVAILABLE",
  "CANDIDATE_CHANGED",
  "INVALID_BROWSER_CHECK",
  "CHECK_EXISTS",
  "FACT_SOURCE_UNAVAILABLE",
  "FACT_SOURCE_CHANGED",
  "INVALID_FACT",
  "FACT_LIMIT",
  "PLANNER_BUSY",
  "PLANNER_NOT_FOUND",
  "PLANNER_NOT_READY",
  "RERUN_NOT_APPLICABLE",
]);
export type WeavraControlErrorCode = typeof WeavraControlErrorCode.Type;

export const WeavraControlPreview = Schema.Struct({
  previewId: identifier,
  previewDigest: digest,
  ownerId: identifier,
  projectRevision: counter,
  expiresAt: counter,
  goal,
  workflow: Schema.Literals(["QUICK", "STANDARD", "COMPLEX"]),
  executionMode: Schema.Literals(["EDIT", "READ_ONLY"]),
  risk: WeavraRunSummary.fields.risk,
  allowedPaths: Schema.Array(boundedText).check(
    Schema.isMaxLength(WEAVRA_CONTROL_MAX_RESPONSE_BYTES),
  ),
  checks: Schema.Array(
    Schema.Struct({ id: boundedText, kind: boundedText, required: Schema.Boolean }),
  ).check(Schema.isMaxLength(WEAVRA_CONTROL_MAX_RESPONSE_BYTES)),
  acceptanceCriteria: Schema.Array(
    Schema.Struct({
      id: identifier,
      statement: boundedText,
      checkIds: Schema.Array(boundedText).check(
        Schema.isMaxLength(WEAVRA_CONTROL_MAX_RESPONSE_BYTES),
      ),
      reviewRequired: Schema.Boolean,
    }),
  ).check(Schema.isMaxLength(WEAVRA_CONTROL_MAX_RESPONSE_BYTES)),
  taskContractDigest: digest,
  recipe: Schema.NullOr(Schema.Struct({ id: identifier, version: counter, digest })),
  configuration: Schema.Struct({
    mutationMode: Schema.Literals(["compatible", "strict"]),
    verifierTrustMode: Schema.Literals(["compatible", "strict"]),
    verifierSandboxMode: Schema.Literals(["disabled", "required"]),
    contextPackMode: Schema.Literals(["disabled", "bounded"]),
    verificationRepairMode: Schema.Literals(["disabled", "self-check-once"]),
    lspEnabled: Schema.Boolean,
  }),
  complexPlan: Schema.optionalKey(WeavraComplexPlan),
}).check(
  // Required iff COMPLEX, forbidden otherwise.
  Schema.makeFilter(
    (preview) => (preview.workflow === "COMPLEX") === (preview.complexPlan !== undefined),
  ),
);
export type WeavraControlPreview = typeof WeavraControlPreview.Type;

export const WeavraControlApproval = Schema.Struct({
  approvalId: identifier,
  runId: identifier,
  stateRevision: counter,
  projectRevision: counter,
  risk: Schema.Literal("R3"),
  operation: Schema.Literal("delete-file"),
  role: Schema.Literal("Developer"),
  step: Schema.Struct({ stepId: Schema.Literal("implement"), attempt: counter }),
  path: boundedText,
  bytes: counter,
  // Runtime workerDigest is raw SHA-256 hex, unlike prefixed contract digests.
  preconditionDigest: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  expiresAt: counter,
  explanation: boundedText,
});
export type WeavraControlApproval = typeof WeavraControlApproval.Type;

const capabilityOperations = {
  runtime_read: "read",
  runtime_search: "search",
  runtime_list_files: "list",
  runtime_write: "write",
  runtime_edit: "edit",
  runtime_delete: "delete",
  runtime_lsp_diagnostics: "read",
  runtime_lsp_definition: "read",
  runtime_lsp_references: "read",
  runtime_lsp_symbols: "read",
} as const;
const capabilityEntry = Schema.Struct({
  descriptor: Schema.Struct({
    id: Schema.String.check(Schema.isMaxLength(96)),
    kind: Schema.Literal("worker-tool"),
    name: Schema.Literals([
      "runtime_read",
      "runtime_search",
      "runtime_list_files",
      "runtime_write",
      "runtime_edit",
      "runtime_delete",
      "runtime_lsp_diagnostics",
      "runtime_lsp_definition",
      "runtime_lsp_references",
      "runtime_lsp_symbols",
    ]),
    origin: Schema.Literal("weavra-runtime"),
    transport: Schema.Literal("in-process"),
    schemaDigest: digest,
    fingerprint: digest,
    source: Schema.Literal("runtime-static"),
  }),
  requirements: Schema.Struct({
    operation: Schema.Literals(["read", "search", "list", "write", "edit", "delete"]),
    mode: Schema.Literals(["READ_OR_EDIT", "EDIT_ONLY"]),
    policy: Schema.Literal("PER_ACTION"),
    approval: Schema.Literals(["RUNTIME_DECIDES", "EXACT_R3_ACTION"]),
  }),
  observation: Schema.Struct({
    availability: Schema.Literals(["UNKNOWN", "NEEDS_REFRESH", "AVAILABLE", "UNAVAILABLE"]),
    reason: Schema.Literals([
      "DEFINITION_PRESENT",
      "LSP_DISABLED",
      "LSP_NOT_OBSERVED",
      "CONFIG_UNAVAILABLE",
      "SOURCE_CHANGED",
    ]),
    source: Schema.Literals(["runtime-static", "operator-config"]),
    observedAt: Schema.NullOr(counter),
  }),
}).check(
  Schema.makeFilter(({ descriptor: d, requirements: r, observation: o }) => {
    const operation = capabilityOperations[d.name];
    return (
      d.id === `weavra.worker.${d.name}` &&
      r.operation === operation &&
      r.mode === (["write", "edit", "delete"].includes(operation) ? "EDIT_ONLY" : "READ_OR_EDIT") &&
      r.approval === (operation === "delete" ? "EXACT_R3_ACTION" : "RUNTIME_DECIDES") &&
      (d.name.startsWith("runtime_lsp_")
        ? o.source === "operator-config" &&
          ((o.availability === "UNKNOWN" && o.reason === "LSP_NOT_OBSERVED") ||
            (o.availability === "UNAVAILABLE" && o.reason === "LSP_DISABLED"))
        : o.source === "runtime-static" &&
          o.availability === "AVAILABLE" &&
          o.reason === "DEFINITION_PRESENT")
    );
  }),
);
const capabilityEncoder = new TextEncoder();
export const WeavraCapabilityInventory = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  coverage: Schema.Literal("RUNTIME_ACTION_TOOLS"),
  ownerId: identifier,
  projectRevision: counter,
  brokerEpoch: browserCaptureId,
  generation: counter,
  status: Schema.Literals(["CURRENT", "NEEDS_REFRESH", "UNKNOWN"]),
  reason: Schema.Literals(["OBSERVED", "SOURCE_CHANGED", "CONFIG_UNAVAILABLE", "INVALID_REGISTRY"]),
  observedAt: Schema.NullOr(counter),
  entries: Schema.Array(capabilityEntry).check(Schema.isMaxLength(32)),
  total: Schema.NullOr(counter.check(Schema.isLessThanOrEqualTo(32))),
  omitted: counter.check(Schema.isLessThanOrEqualTo(32)),
})
  .check(
    Schema.makeFilter((inventory) => {
      if (capabilityEncoder.encode(JSON.stringify(inventory)).byteLength > 16_384) return false;
      if (inventory.generation === 0) {
        if (
          inventory.status !== "UNKNOWN" ||
          inventory.reason !== "CONFIG_UNAVAILABLE" ||
          inventory.observedAt !== null
        )
          return false;
      } else if (inventory.observedAt === null) return false;
      if (inventory.status !== "CURRENT") {
        return (
          inventory.entries.length === 0 &&
          inventory.total === null &&
          inventory.omitted === 0 &&
          (inventory.status === "NEEDS_REFRESH"
            ? inventory.reason === "SOURCE_CHANGED"
            : inventory.reason === "CONFIG_UNAVAILABLE" || inventory.reason === "INVALID_REGISTRY")
        );
      }
      return (
        inventory.reason === "OBSERVED" &&
        inventory.generation >= 1 &&
        inventory.total !== null &&
        inventory.total >= inventory.entries.length &&
        inventory.omitted === inventory.total - inventory.entries.length &&
        inventory.entries.every(
          (entry, index, entries) =>
            entry.observation.observedAt === inventory.observedAt &&
            (index === 0 || entries[index - 1]!.descriptor.id < entry.descriptor.id),
        )
      );
    }),
  )
  .pipe(closedRpcInput);
export type WeavraCapabilityInventory = typeof WeavraCapabilityInventory.Type;

export const WeavraControlState = Schema.Struct({
  ownerId: identifier,
  nextRequestId: identifier,
  projectRevision: counter,
  stateRevision: Schema.NullOr(counter),
  ownedRunId: Schema.NullOr(identifier),
  busy: Schema.Boolean,
  cancelling: Schema.Boolean,
  startFailure: Schema.NullOr(Schema.Literal("START_FAILED")),
  preview: Schema.NullOr(WeavraControlPreview),
  browserPreview: Schema.NullOr(WeavraBrowserPreview),
  factPreview: Schema.NullOr(WeavraFactPreview),
  projectFacts: Schema.Struct({
    status: Schema.Literals(["available", "unavailable"]),
    entries: Schema.Array(projectFact).check(Schema.isMaxLength(16)),
  }),
  pendingApproval: Schema.NullOr(WeavraControlApproval),
  capabilityInventory: Schema.optional(WeavraCapabilityInventory),
  complexExecution: Schema.optionalKey(WeavraComplexExecution),
  // Present only after a `planner.start` on this Host; absent (never null) otherwise.
  planner: Schema.optionalKey(WeavraPlannerStatus),
  snapshot: WeavraSnapshotSummary,
}).check(
  Schema.makeFilter(
    (state) =>
      (state.capabilityInventory === undefined ||
        (state.capabilityInventory.ownerId === state.ownerId &&
          state.capabilityInventory.projectRevision === state.projectRevision)) &&
      // The planner keeps the project revision it started at. A current READY draft still has
      // it (§6); `current` of the other statuses is not defined, so it binds nothing here.
      (state.planner === undefined ||
        (state.planner.projectRevision <= state.projectRevision &&
          (state.planner.status !== "READY" ||
            !state.planner.current ||
            state.planner.projectRevision === state.projectRevision))) &&
      // The projection belongs to exactly the enclosing latest COMPLEX Run and observation.
      (state.complexExecution === undefined ||
        (state.complexExecution.ownerId === state.ownerId &&
          state.complexExecution.projectRevision === state.projectRevision &&
          state.complexExecution.stateRevision === state.stateRevision &&
          state.complexExecution.runId === state.snapshot.status.run?.runId &&
          state.snapshot.status.run.workflow === "COMPLEX" &&
          // A plan of another version than its projection is only a terminal historical Run.
          (state.complexExecution.plan.schemaVersion === state.complexExecution.schemaVersion ||
            terminalRunStatuses.has(state.snapshot.status.run.status)))),
  ),
);
export type WeavraControlState = typeof WeavraControlState.Type;

export const WeavraControlCapabilities = Schema.Struct({
  authority: Schema.Literal("Runtime/Kernel"),
  control: Schema.Literal("workflow-control-v1"),
  ownerId: identifier,
  commands: Schema.Tuple([
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[0]),
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[1]),
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[2]),
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[3]),
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[4]),
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[5]),
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[6]),
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[7]),
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[8]),
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[9]),
    Schema.Literal(WEAVRA_CONTROL_COMMANDS[10]),
  ]),
  maxRequestBytes: counter,
  maxResponseBytes: counter,
  resultLimit: counter,
  previewTtlMs: counter,
  runtimeVersion: boundedText,
  readiness: Schema.Literals(["READY", "NOT_SETUP", "CONFIG_INVALID"]),
  // Absent means COMPLEX is NOT_EXPOSED; never inferred from readiness or version text. A Runtime
  // advertises exactly one version: 1 (sequential, V0.7B) or 2 (implementation waves, V0.8A).
  complexContractVersion: Schema.optionalKey(Schema.Literals([1, 2])),
  // V0.8B: absent means the Planner does not exist on this connection. As with COMPLEX, the
  // advertisement is not readiness or permission. The `commands` tuple above stays unchanged.
  plannerContractVersion: Schema.optionalKey(Schema.Literal(1)),
  // V0.8C: absent means re-run derivation (`workflow.derive`) does not exist on this connection.
  // Advertisement is not readiness or permission, and the `commands` tuple stays unchanged.
  rerunContractVersion: Schema.optionalKey(Schema.Literal(1)),
  recipes: Schema.Array(
    Schema.Struct({
      id: identifier,
      version: counter,
      title: boundedText,
      inputTemplate: boundedText,
    }),
  ).check(Schema.isMaxLength(WEAVRA_CONTROL_MAX_RESPONSE_BYTES)),
});
export type WeavraControlCapabilities = typeof WeavraControlCapabilities.Type;

// V0.8C explicit re-run wire contract (docs/architecture/COMPLEX_RERUN.md §4–§6), duplicated from
// the Runtime wire shapes and never imported across build roots. A derived draft is candidate data:
// a filled-in planning form for an ordinary new Run. Nothing resumes, no evidence is reused, and
// nothing runs until the human loads it, prepares and confirms a Runtime preview.
export const WEAVRA_RERUN_MAX_DERIVED_RESPONSE_BYTES = 49_152;
/**
 * The existing codes of the prepare pipeline that a derived draft is dry-run through (§4 step 5):
 * classification, COMPLEX compilation with claim facts and Policy, and the preview's response
 * bound. Refusals of `workflow.derive` itself are ordinary error responses, never a check result.
 */
export const WeavraPrepareCheckCode = Schema.Literals([
  "INVALID_REQUEST",
  "INVALID_GOAL",
  "UNSUPPORTED_WORKFLOW",
  "INVALID_CRITERIA",
  "RESPONSE_TOO_LARGE",
] as const satisfies ReadonlyArray<WeavraControlErrorCode>);
/** A leftover exactly as `git status -z` names it (§5); never its contents, diff or mode. */
const leftoverPath = Schema.String.check(
  Schema.isMinLength(1),
  Schema.makeFilter((path: string) => !path.includes("\u0000"), {
    expected: "a path name without NUL",
  }),
);
/** §5: the changes that would fail a clean start, in sorted order and bounded by count and bytes. */
export const WeavraRerunLeftovers = Schema.Struct({
  clean: Schema.NullOr(Schema.Boolean),
  paths: Schema.Array(leftoverPath).check(Schema.isMaxLength(200), strictlyAscending),
  truncated: Schema.Boolean,
}).check(
  Schema.makeFilter(
    (leftovers) =>
      leftovers.paths.reduce((bytes, path) => bytes + utf8.encode(path).byteLength, 0) <= 16_384 &&
      // Only a dirty checkout names leftovers. Unknown state (Git could not run) names none, so it
      // can never read as clean; a clean checkout has nothing to list or truncate.
      (leftovers.clean === false
        ? leftovers.paths.length > 0
        : leftovers.paths.length === 0 && !leftovers.truncated),
    { expected: "leftover names only for a dirty checkout, within 200 names and 16,384 bytes" },
  ),
);
/** §4 step 6: a fixed-template note of at most 200 UTF-8 bytes; it never holds file contents. */
const rerunNote = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isPattern(/\S/),
  Schema.makeFilter((note: string) => utf8.encode(note).byteLength <= 200),
);
/** The §6 success data of `workflow.derive`: a candidate draft, never a plan, preview or Run. */
export const WeavraDerivedDraft = Schema.Struct({
  kind: Schema.Literal("derived-draft"),
  runId: identifier,
  sourcePlanDigest: digest,
  sourceStatus: Schema.Literals(["BLOCKED", "CANCELLED", "FAILED", "INTERRUPTED"]),
  goal,
  acceptanceStatements,
  draft: WeavraComplexDraft,
  prepareCheck: Schema.Struct({
    ok: Schema.Boolean,
    code: Schema.NullOr(WeavraPrepareCheckCode),
  }).check(
    Schema.makeFilter((check) => check.ok === (check.code === null), {
      expected: "a code exactly when the dry-run failed",
    }),
  ),
  leftovers: WeavraRerunLeftovers,
  notes: Schema.Array(rerunNote).check(Schema.isMaxLength(16)),
}).check(
  // Criterion indexes are 1-based positions of the acceptance statements carried with the draft.
  Schema.makeFilter(
    (derived) =>
      derived.draft.tasks.every((task) =>
        task.criterionIndexes.every((index) => index <= derived.acceptanceStatements.length),
      ),
    { expected: "criterion indexes of the carried acceptance statements" },
  ),
);
export type WeavraDerivedDraft = typeof WeavraDerivedDraft.Type;

const controlData = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("capabilities"), capabilities: WeavraControlCapabilities }),
  Schema.Struct({ kind: Schema.Literal("snapshot"), state: WeavraControlState }),
  Schema.Struct({ kind: Schema.Literal("prepared"), preview: WeavraControlPreview }),
  Schema.Struct({ kind: Schema.Literal("browser-state"), state: WeavraBrowserState }),
  Schema.Struct({ kind: Schema.Literal("browser-prepared"), preview: WeavraBrowserPreview }),
  Schema.Struct({ kind: Schema.Literal("fact-prepared"), preview: WeavraFactPreview }),
  Schema.Struct({ kind: Schema.Literal("fact-confirmed"), factId: identifier }),
  Schema.Struct({
    kind: Schema.Literal("browser-registered"),
    check: WeavraRegisteredBrowserCheck,
  }),
  Schema.Struct({
    kind: Schema.Literal("accepted"),
    requestId: identifier,
    command: Schema.Literals([
      "workflow.confirm",
      "workflow.cancel",
      "approval.resolve",
      "planner.start",
      "planner.cancel",
    ]),
    runId: Schema.NullOr(identifier),
  }).check(
    // Planning never creates or names a Run.
    Schema.makeFilter((data) => !data.command.startsWith("planner.") || data.runId === null),
  ),
  // A READY Planner proposal for the editor: candidate data, never a plan, preview or approval.
  Schema.Struct({
    kind: Schema.Literal("planner-draft"),
    planId: canonicalUuid,
    requestDigest: digest,
    projectRevision: counter,
    current: Schema.Boolean,
    draft: WeavraComplexDraft,
  }),
  WeavraDerivedDraft,
]);
const responseEnvelope = {
  protocolVersion: WeavraSnapshotEnvelope.fields.protocolVersion,
  runId: WeavraSnapshotEnvelope.fields.runId,
  stateRevision: WeavraSnapshotEnvelope.fields.stateRevision,
  projectRevision: WeavraSnapshotEnvelope.fields.projectRevision,
  eventId: WeavraSnapshotEnvelope.fields.eventId,
  timestamp: WeavraSnapshotEnvelope.fields.timestamp,
  type: Schema.Literal("control_response"),
  id: Schema.NullOr(identifier),
  command: Schema.NullOr(boundedText),
  ownerId: identifier,
};
export const WeavraControlResponse = Schema.Union([
  Schema.Struct({ ...responseEnvelope, success: Schema.Literal(true), data: controlData }).check(
    // A Planner draft travels on its own, well below the general response budget: the whole
    // response line, newline included, is at most 16,384 bytes.
    Schema.makeFilter(
      (response) =>
        response.data.kind !== "planner-draft" ||
        jsonBytes(response) + 1 <= WEAVRA_PLANNER_MAX_DRAFT_RESPONSE_BYTES,
    ),
    // A derived draft line, newline included, is at most 49,152 bytes; beyond that the Runtime
    // answers RESPONSE_TOO_LARGE, and only the leftover names are ever truncated (§5, §6).
    Schema.makeFilter(
      (response) =>
        response.data.kind !== "derived-draft" ||
        jsonBytes(response) + 1 <= WEAVRA_RERUN_MAX_DERIVED_RESPONSE_BYTES,
    ),
  ),
  Schema.Struct({
    ...responseEnvelope,
    success: Schema.Literal(false),
    error: Schema.Struct({ code: WeavraControlErrorCode }),
  }),
]);
export type WeavraControlResponse = typeof WeavraControlResponse.Type;

// Effect 4 does not apply parseOptions annotations. Check raw RPC input before
// the ordinary Struct decoder can strip unknown authority-bearing fields.
function closedRpcInput<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const decode = Schema.decodeUnknownOption(schema, { onExcessProperty: "error" });
  return Schema.Unknown.check(Schema.makeFilter((value) => Option.isSome(decode(value)))).pipe(
    Schema.decodeTo(schema),
  );
}

const requestEncoder = new TextEncoder();
export const WeavraControlInput = Schema.Struct({
  projectId: ProjectId,
  request: WeavraControlMutation,
})
  .check(
    Schema.makeFilter(
      (input) =>
        requestEncoder.encode(JSON.stringify(input.request)).byteLength + 1 <=
        WEAVRA_CONTROL_MAX_REQUEST_BYTES,
    ),
  )
  .pipe(closedRpcInput);
export type WeavraControlInput = typeof WeavraControlInput.Type;

export const WeavraControlObserveInput = Schema.Struct({ projectId: ProjectId }).pipe(
  closedRpcInput,
);
export type WeavraControlObserveInput = typeof WeavraControlObserveInput.Type;

export const WeavraControlObservation = Schema.Struct({
  status: WeavraConnectionStatus,
  state: Schema.NullOr(WeavraControlState),
  capabilities: Schema.NullOr(WeavraControlCapabilities),
  stale: Schema.Boolean,
  observedAt: Schema.NullOr(counter),
  errorCode: Schema.NullOr(WeavraErrorCode),
});
export type WeavraControlObservation = typeof WeavraControlObservation.Type;

export class WeavraControlTransportError extends Schema.TaggedError<WeavraControlTransportError>()(
  "WeavraControlTransportError",
  { code: WeavraErrorCode },
) {}
