import * as Schema from "effect/Schema";
import * as Option from "effect/Option";

import { CommandId, MessageId, NonNegativeInt, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  WeavraEvidenceCursor,
  WeavraEvidenceDetailsPage,
  WeavraEvidenceDetailsUnavailable,
} from "./weavraControl.ts";
import {
  WeavraTask,
  WeavraTaskDraft,
  WeavraTaskReadInput,
  WeavraTaskScopeInput,
} from "./weavraTask.ts";

export class WeavraTaskRpcError extends Schema.TaggedError<WeavraTaskRpcError>()(
  "WeavraTaskRpcError",
  {
    code: Schema.Literals([
      "TARGET_CHANGED",
      "NOT_PREPARED",
      "RUNTIME_UNAVAILABLE",
      "INVALID_RECEIPT",
      "PREPARE_REJECTED",
      "REPREPARE_REQUIRED",
      "STALE_REVISION",
      "COMMAND_CONFLICT",
      "RUN_MISMATCH",
      "APPROVAL_MISMATCH",
      "ALREADY_CONFIRMED",
      "CLEANUP_UNPROVEN",
      "TERMINAL_ACTIVE",
      "RECOVERY_UNAVAILABLE",
      "RECOVERY_UNKNOWN",
      "RECOVERY_BUSY",
      "RECOVERY_OWNER_UNPROVEN",
      "RECOVERY_STALE",
      "RECOVERY_CONFLICT",

      "ANALYSIS_UNAVAILABLE",
      "UNSUPPORTED_PROVIDER",
      "INTERNAL_ERROR",
    ]),
  },
) {}

export const WeavraTaskAnalyzeInput = Schema.Struct({
  task: WeavraTaskReadInput,
  commandId: CommandId,
  messageId: MessageId,
  text: TrimmedNonEmptyString,
  expectedRevision: NonNegativeInt,
});
export type WeavraTaskAnalyzeInput = typeof WeavraTaskAnalyzeInput.Type;

export const WeavraTaskFollowupInput = WeavraTaskAnalyzeInput;
export type WeavraTaskFollowupInput = typeof WeavraTaskFollowupInput.Type;

export const WeavraTaskPrepareInput = Schema.Struct({
  task: WeavraTaskReadInput,
  draft: WeavraTaskDraft,
  expectedRevision: NonNegativeInt,
});
export type WeavraTaskPrepareInput = typeof WeavraTaskPrepareInput.Type;

export const WeavraTaskConfirmInput = Schema.Struct({
  task: WeavraTaskReadInput,
  commandId: CommandId,
  expectedRevision: NonNegativeInt,
});
export type WeavraTaskConfirmInput = typeof WeavraTaskConfirmInput.Type;

export const WeavraTaskAbortInput = Schema.Struct({
  task: WeavraTaskReadInput,
  expectedRevision: NonNegativeInt,
});
export type WeavraTaskAbortInput = typeof WeavraTaskAbortInput.Type;

const taskRecoverInput = Schema.Struct({
  task: WeavraTaskReadInput,
  expectedRevision: NonNegativeInt,
});
const decodeRecoveryInput = Schema.decodeUnknownOption(taskRecoverInput, {
  onExcessProperty: "error",
});
/** Recovery authority is reconstructed from the persisted task, never from the caller. */
export const WeavraTaskRecoverInput = Schema.Unknown.check(
  Schema.makeFilter((value) => Option.isSome(decodeRecoveryInput(value))),
).pipe(Schema.decodeTo(taskRecoverInput));
export type WeavraTaskRecoverInput = typeof WeavraTaskRecoverInput.Type;

export const WeavraTaskReprepareInput = Schema.Struct({
  task: WeavraTaskReadInput,
  commandId: CommandId,
  draft: WeavraTaskDraft,
  expectedRevision: NonNegativeInt,
});
export type WeavraTaskReprepareInput = typeof WeavraTaskReprepareInput.Type;

export const WeavraTaskRunInput = Schema.Struct({
  task: WeavraTaskReadInput,
  expectedRunId: Schema.String,
  expectedStateRevision: NonNegativeInt,
});
export type WeavraTaskRunInput = typeof WeavraTaskRunInput.Type;

export const WeavraTaskResolveApprovalInput = Schema.Struct({
  task: WeavraTaskReadInput,
  expectedRunId: Schema.String,
  expectedStateRevision: NonNegativeInt,
  approvalId: Schema.String,
  decision: Schema.Literals(["approve", "reject"]),
});
export type WeavraTaskResolveApprovalInput = typeof WeavraTaskResolveApprovalInput.Type;

export const WeavraTaskEvidenceInput = Schema.Struct({
  task: WeavraTaskReadInput,
  revision: NonNegativeInt,
  diffDigest: Schema.NullOr(Schema.String),
  cursor: WeavraEvidenceCursor,
});
export type WeavraTaskEvidenceInput = typeof WeavraTaskEvidenceInput.Type;

export const WeavraTaskEvidenceResult = Schema.Union([
  WeavraEvidenceDetailsPage,
  WeavraEvidenceDetailsUnavailable,
]);
export type WeavraTaskEvidenceResult = typeof WeavraTaskEvidenceResult.Type;

export const WeavraTaskObservation = Schema.Union([
  Schema.Struct({
    kind: Schema.Literals(["snapshot", "synchronized"]),
    task: WeavraTask,
  }),
  Schema.Struct({
    kind: Schema.Literal("update"),
    task: WeavraTask,
  }),
]);
export type WeavraTaskObservation = typeof WeavraTaskObservation.Type;

/** Observation remains task-specific; list is the discovery surface for a thread. */
export const WeavraTaskObserveInput = WeavraTaskReadInput;
export type WeavraTaskObserveInput = typeof WeavraTaskObserveInput.Type;

/** Re-exported shape marker used by typed client command helpers. */
export const WeavraTaskListInput = WeavraTaskScopeInput;
export type WeavraTaskListInput = typeof WeavraTaskListInput.Type;
