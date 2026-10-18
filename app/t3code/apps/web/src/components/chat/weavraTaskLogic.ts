import {
  WeavraTaskDraft,
  type MessageId,
  type ThreadId,
  type WeavraAnalysisContext,
  type WeavraTask,
  type WeavraTaskScopeInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { weavraLabel } from "../weavraLabels";

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

// Keep field paths for the editor; the wire boundary still uses the closed schema.
const decodeDraft = Schema.decodeUnknownSync(Schema.toType(WeavraTaskDraft), {
  onExcessProperty: "error",
  errors: "all",
});
const lines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

function taskDraftContext(fields: TaskDraftFields, packetVersion: number, reviewedAt: number) {
  const sourceReferences: unknown = JSON.parse(fields.sources);
  return {
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
    sourceReferences,
  };
}

const utf8 = new TextEncoder();

export function taskDraftContextBytes(
  fields: TaskDraftFields,
  packetVersion: number,
  reviewedAt: number,
): number {
  return utf8.encode(JSON.stringify(taskDraftContext(fields, packetVersion, reviewedAt)))
    .byteLength;
}

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
    context: taskDraftContext(fields, packetVersion, reviewedAt),
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
    throw new Error("화면에 표시된 메시지에서 최대 500자를 선택해 주세요.");
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
  if (!input.fresh) return "작업 전에 다시 연결하고 이 작업을 동기화해 주세요.";
  if (!input.canOperate) return "이 세션에는 orchestration:operate 권한이 없어요.";
  if (input.edited) return "초안이 바뀌었어요. 확인하기 전에 새 스냅샷을 준비해 주세요.";
  const { task } = input;
  const preview = task.execution?.preview;
  if (
    task.phase !== "awaiting-confirmation" ||
    task.ownership.state !== "analysis" ||
    task.execution?.confirmCommandId
  )
    return "이 시도를 확인할 수 없어요. 현재 상태를 다시 조회해 주세요.";
  if (!preview) return "저장된 미리보기를 사용할 수 없어요. 새 시도를 준비해 주세요.";
  if (preview.expiresAt <= input.now) return "미리보기가 만료됐어요. 새 시도를 준비해 주세요.";
  if (!preview.modelRoutes)
    return "확정된 Runtime 모델 경로를 확인할 수 없어요. 호환되는 Runtime에서 다시 준비해 주세요.";
  if (!preview.checks.some((check) => check.required)) return "필수로 등록된 검사가 없어요.";
  if (!input.reviewed) return "이 스냅샷을 검토한 뒤 아래에서 확인해 주세요.";
  return null;
}

export function taskStatus(task: WeavraTask): string {
  const receipt = task.execution?.receipt;
  if (receipt?.status === "FOUND") {
    if (receipt.run) return `Run ${weavraLabel(receipt.run.status)}`;
    const outcome = receipt.admission.outcome;
    return "reasonCode" in outcome
      ? `${weavraLabel(outcome.status)}: ${outcome.reasonCode} (Run 없음)`
      : `${weavraLabel(outcome.status)} (Run 미확인)`;
  }
  if (receipt?.status === "UNKNOWN") return "실행 응답 미확인 - 소유권을 해제하지 않았어요";
  return task.phase === "finished"
    ? "작업 종료 - Runtime 완료 판정은 없어요"
    : weavraLabel(task.phase);
}
