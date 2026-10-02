import {
  WeavraTaskDraft,
  type MessageId,
  type ThreadId,
  type WeavraAnalysisContext,
  type WeavraTask,
  type WeavraTaskScopeInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export interface TaskDraftFields {
  goal: string;
  symptom: string;
  hypothesis: string;
  uncertainties: string;
  constraints: string;
  criteria: string;
  sources: string;
  symptomCriterion: string;
  symptomCheck: string;
  observations: WeavraAnalysisContext["observations"];
}

export function taskDraftFields(task: WeavraTask | null): TaskDraftFields {
  const preview = task?.execution?.preview;
  const symptom = task?.execution?.binding.symptomVerification;
  const criterion = symptom
    ? preview?.acceptanceCriteria.findIndex((item) => item.id === symptom.criterionId)
    : undefined;
  return {
    goal: preview?.goal ?? "",
    symptom: task?.context?.symptom ?? "",
    hypothesis: task?.context?.candidateCause?.text ?? "",
    uncertainties: task?.context?.uncertainties.join("\n") ?? "",
    constraints: task?.context?.constraints.join("\n") ?? "",
    criteria: preview?.acceptanceCriteria.map((item) => item.statement).join("\n") ?? "",
    sources: task?.context?.sourceReferences.length
      ? JSON.stringify(task.context.sourceReferences, null, 2)
      : "[]",
    symptomCriterion: criterion !== undefined && criterion >= 0 ? String(criterion + 1) : "",
    symptomCheck: symptom?.checkId ?? "",
    observations: task?.context?.observations ?? [],
  };
}

const decodeDraft = Schema.decodeUnknownSync(WeavraTaskDraft);
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export function buildTaskDraft(
  fields: TaskDraftFields,
  packetVersion: number,
  reviewedAt: number,
): WeavraTaskDraft {
  return decodeDraft({
    goal: fields.goal.trim(),
    acceptanceStatements: lines(fields.criteria),
    ...(fields.symptomCheck || fields.symptomCriterion
      ? {
          symptomVerification: {
            criterionIndex: Number(fields.symptomCriterion),
            checkId: fields.symptomCheck.trim(),
          },
        }
      : {}),
    context: {
      version: 1,
      packetVersion,
      authority: "ADVISORY_ONLY",
      reviewedAt,
      symptom: fields.symptom.trim(),
      candidateCause: fields.hypothesis.trim()
        ? { kind: "HYPOTHESIS", text: fields.hypothesis.trim() }
        : null,
      observations: fields.observations,
      uncertainties: lines(fields.uncertainties),
      constraints: lines(fields.constraints),
      sourceReferences: JSON.parse(fields.sources),
    },
  });
}

/** Only explicitly selected, visible message text enters a packet. Edits are USER claims. */
export function selectedMessageFinding(input: {
  threadId: ThreadId;
  messageId: MessageId;
  role: "user" | "assistant";
  text: string;
}): WeavraAnalysisContext["observations"][number] {
  if (!input.text.trim() || input.text.length > 500)
    throw new Error("Select at most 500 characters of visible message text.");
  return {
    text: input.text,
    provenance: input.role === "assistant" ? "MODEL" : "USER",
    reference: { kind: "message", threadId: input.threadId, messageId: input.messageId },
  };
}

export function taskMatchesScope(task: WeavraTask, scope: WeavraTaskScopeInput): boolean {
  return (
    task.environmentId === scope.environmentId &&
    task.projectId === scope.projectId &&
    task.threadId === scope.threadId
  );
}

export function taskSendRoute(input: {
  supported: boolean;
  discovered: boolean;
  fresh: boolean;
  canOperate: boolean;
  task: WeavraTask | null;
  allowFreeCoding?: boolean;
}): "free" | "blocked" | "analysis" | "followup" {
  if (
    input.task &&
    (input.task.ownership.state !== "released" || input.task.execution?.confirmCommandId != null)
  ) {
    if (!input.supported || !input.discovered || !input.fresh || !input.canOperate)
      return "blocked";
    if (input.task.ownership.state === "released" && input.allowFreeCoding) return "free";
    return input.task.phase === "analysis" && input.task.ownership.state === "analysis"
      ? "analysis"
      : "followup";
  }
  if (input.supported && !input.discovered) return "blocked";
  return "free";
}

export function taskConfirmBlocker(input: {
  task: WeavraTask;
  fresh: boolean;
  canOperate: boolean;
  edited: boolean;
  reviewed: boolean;
  now: number;
}): string | null {
  if (!input.fresh) return "Reconnect and synchronize this task before acting.";
  if (!input.canOperate) return "This session does not have orchestration:operate access.";
  if (input.edited) return "The draft changed. Prepare a new snapshot before confirming.";
  const { task } = input;
  const preview = task.execution?.preview;
  if (
    task.phase !== "awaiting-confirmation" ||
    task.ownership.state !== "analysis" ||
    task.execution?.confirmCommandId
  )
    return "This attempt cannot be confirmed. Reconcile its current state.";
  if (!preview) return "The saved preview is unavailable. Prepare a new attempt.";
  if (preview.expiresAt <= input.now) return "This preview expired. Prepare a new attempt.";
  if (!preview.modelRoutes)
    return "Frozen Runtime model routes are unavailable. Prepare with a compatible Runtime.";
  if (!preview.checks.some((check) => check.required))
    return "No required registered check is present.";
  if (!input.reviewed) return "Review the exact snapshot and acknowledge it below.";
  return null;
}

export function taskStatus(task: WeavraTask): string {
  const receipt = task.execution?.receipt;
  if (receipt?.status === "FOUND") {
    if (receipt.run) return `Run ${receipt.run.status}`;
    const outcome = receipt.admission.outcome;
    return "reasonCode" in outcome
      ? `${outcome.status}: ${outcome.reasonCode} (no Run)`
      : `${outcome.status} (no Run observed)`;
  }
  if (receipt?.status === "UNKNOWN") return "Execution receipt unknown - ownership is not cleared";
  return task.phase === "finished" ? "Task finished - no canonical completion claim" : task.phase;
}
