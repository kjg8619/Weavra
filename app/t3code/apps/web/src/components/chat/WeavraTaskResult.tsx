import { weavraLabel } from "../weavraLabels";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import {
  createEnvironmentCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { requestWeavraTask } from "@t3tools/client-runtime/state/weavraTask";
import {
  CommandId,
  WS_METHODS,
  type WeavraEvidenceRecord,
  type WeavraTask,
  type WeavraTaskEvidenceInput,
  type WeavraTaskReadInput,
  type WeavraControlApproval,
} from "@t3tools/contracts";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { connectionAtomRuntime } from "../../connection/runtime";
import { cn, randomUUID } from "../../lib/utils";
import { observations } from "../../state/weavraObservations";
import { toastManager } from "../ui/toast";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { WeavraPreflightFailure } from "../settings/WeavraPreflightFailure";
import {
  appendTaskEvidence,
  issueVerification,
  taskResultNextAction,
  type TaskResultNextAction,
  type EvidenceCategory,
  type IssueVerification,
  type TaskEvidenceState,
} from "./weavraTaskResultLogic";
import { taskDraftFields, taskStatus } from "./weavraTaskLogic";
import { useProjectControlDrafts } from "./projectControlDraft";
import type { WeavraTaskController } from "./useWeavraTask";
import { type RunDiffRecord, WeavraRunDiff } from "./WeavraRunDiff";

const evidenceCommand = createEnvironmentCommand(connectionAtomRuntime, {
  label: "chat:weavra-task-evidence",
  execute: (input: WeavraTaskEvidenceInput) =>
    requestWeavraTask(WS_METHODS.weavraTaskEvidence, input),
});
const approvalCommand = createEnvironmentCommand(connectionAtomRuntime, {
  label: "chat:weavra-task-approval",
  execute: (input: WeavraTaskReadInput) =>
    requestWeavraTask(WS_METHODS.weavraTaskReadApproval, input),
});
const categories = [
  { id: "criteria", label: "수용 기준" },
  { id: "checks", label: "등록된 검사" },
  { id: "changed-files", label: "실제 변경 경로" },
  { id: "trust-sources", label: "검증기의 신뢰 소스" },
] as const;
const verificationReasons: Record<
  Extract<IssueVerification, { status: "unverified" }>["reason"],
  string
> = {
  RUN_NOT_COMPLETED: "Runtime의 Run 완료 기록이 아직 없어요.",
  NO_SYMPTOM_BINDING: "이 Run에는 확정된 증상 검사가 없어요.",
  STALE_OR_MISSING_EVIDENCE: "원래 문제를 평가하려면 현재 증거 스냅샷을 불러와 주세요.",
  BINDING_CHANGED: "증거가 확정된 증상 검증 연결과 일치하지 않아요.",
  EVIDENCE_INCOMPLETE: "최종 시도를 평가하려면 수용 기준과 검사 페이지를 모두 불러와 주세요.",
  CRITERION_UNVERIFIED: "연결된 수용 기준이 검증되지 않았어요.",
  FINAL_CHECK_UNVERIFIED: "최종 필수 증상 검사가 없거나 실패했거나 오래됐어요.",
  REGISTRATION_UNVERIFIED: "검사 등록이 바뀌었거나 신뢰 여부가 검증되지 않았어요.",
  REVIEW_UNVERIFIED: "현재 증거와 일치하는 새 독립 검토가 없어요.",
};
const nextActionGuidance: Record<TaskResultNextAction | "inspect-history", string> = {
  synchronize: "기록된 결과에 따라 작업하기 전에 다시 연결하고 이 대화를 새로고침해 주세요.",
  reconcile:
    "Runtime의 현재 결과를 새로 조회해 이 실행을 확인해 주세요. 확인 요청을 다시 보내지 마세요.",
  "inspect-approval": "별도 결정을 내리기 전에 아래 대기 중인 승인 요청을 확인해 주세요.",
  "recover-interruption":
    "활성 작업 카드의 ‘중단된 작업 복구 확인’으로 복구 상태를 살펴보세요. 작업을 다시 시작하거나 checkout 해제를 보장하지 않아요.",
  "inspect-cleanup":
    "Runtime의 현재 결과를 새로 조회하고 정리 상태를 확인해 주세요. 정리가 확인될 때까지 checkout 보호를 유지해요.",
  "inspect-history":
    "이 시도에 기록된 증거를 확인해 주세요. 실행 제어는 위의 활성 작업에만 적용돼요.",
  none: "아래 기록된 증거를 확인해 주세요. Run 결과만으로 원래 문제가 검증되지는 않아요.",
};
const failureGuidance = {
  RUN_FAILED: {
    status: "실행 실패",
    action: "Runtime 실행 실패 진단을 확인하고 새 스냅샷을 준비해 주세요.",
  },
  CHECK_FAILED: {
    status: "등록 검사 실패",
    action: "아래 검사 증거에서 실패한 검사를 확인해 주세요.",
  },
  RUN_BLOCKED: {
    status: "실행 차단",
    action: "Runtime 증거에서 차단 사유와 필요한 조치를 확인해 주세요.",
  },
  RUN_CANCELLED: {
    status: "실행 취소",
    action: "보존된 변경사항과 증거를 확인한 뒤 새 시도를 준비해 주세요.",
  },
  RUN_INTERRUPTED: {
    status: "실행 중단",
    action: "중단된 실행과 checkout 정리 상태를 확인해 주세요.",
  },
} as const;

type CheckRecord = Extract<WeavraEvidenceRecord, { category: "checks" }>;
type CriterionRecord = Extract<WeavraEvidenceRecord, { category: "criteria" }>;
type ChangedFileRecord = Extract<WeavraEvidenceRecord, { category: "changed-files" }>;
const draftCategories = ["criteria", "checks", "changed-files"] as const;
const runDiffRefusals: Partial<Record<string, string>> = {
  DIFF_STALE: "작업 폴더가 이 Run의 결과 이후 바뀌어서 Run의 변경을 다시 보여 줄 수 없어요.",
  DIFF_UNVERIFIED: "Run의 기준 상태를 기록과 맞춰 확인하지 못해 변경을 보여 주지 않아요.",
  DIFF_TOO_LARGE: "Run의 변경 전체가 표시 한도(256 KiB)를 넘어요.",
};
const cell = (value: string) => value.replaceAll("|", "\\|").replaceAll("\n", " ");

/** Korean PR description built only from the receipt and evidence pages already received. */
function pullRequestDraft(
  task: WeavraTask,
  run: { runId: string; revision: number },
  state: TaskEvidenceState | null,
): string {
  const records = state?.records ?? [];
  const coverage = (category: (typeof draftCategories)[number]) => {
    const unavailable = state?.unavailable[category];
    if (unavailable) return [`_확인할 수 없음: ${unavailable.reason}_`];
    return state?.complete.includes(category) ? [] : ["_일부 기록만 불러왔어요._"];
  };
  const criteria = records.filter(
    (record): record is CriterionRecord => record.category === "criteria",
  );
  const checks = records.filter((record): record is CheckRecord => record.category === "checks");
  const files = records.filter(
    (record): record is ChangedFileRecord => record.category === "changed-files",
  );
  const review = state?.latest.review ?? null;
  return [
    "## 목표",
    task.execution?.preview?.goal ?? "확정된 목표 없음",
    "",
    "## 수용 기준",
    ...criteria.map((record) => `- ${record.status} \`${record.id}\` ${record.statement}`),
    ...(criteria.length === 0 ? ["- 기록 없음"] : []),
    ...coverage("criteria"),
    "",
    "## 검사 결과",
    "| 검사 | 종료 코드 | 결과 |",
    "| --- | --- | --- |",
    ...checks.map(
      (record) =>
        `| \`${cell(record.id)}\` | ${record.exitCode ?? "없음"} | ${record.status}${record.required ? "" : " (선택)"} |`,
    ),
    ...coverage("checks"),
    "",
    "## 독립 검토",
    review
      ? `${review.result} · 독립 검토 ${weavraLabel(review.independent)} · 코드 revision ${review.revision} · 수용 기준 ${review.criteriaCount}개`
      : "검토 기록 없음",
    "",
    "## 변경 파일",
    ...files.map((record) => `- \`${record.path}\``),
    ...(files.length === 0 ? ["- 기록 없음"] : []),
    ...coverage("changed-files"),
    "",
    "---",
    `Weavra Run \`${run.runId}\` · 상태 revision ${run.revision}${state ? ` · 코드 revision ${state.latest.codeRevision} · Diff \`${state.latest.snapshot.diffDigest}\`` : ""}`,
  ].join("\n");
}
type FailureKind =
  | "policy"
  | "check"
  | "revise"
  | "review-block"
  | "blocked"
  | "failed"
  | "interrupted"
  | "cancelled";
interface TaskFailure {
  readonly kind: FailureKind;
  readonly tone: "destructive" | "warning";
  readonly code: string;
  readonly reason: string;
  readonly detail: string | null;
  /** Runtime-masked, bounded output tail of the failed check; display-only. */
  readonly output?: string;
  readonly refs: readonly string[];
  readonly criteria: readonly CriterionRecord[];
  readonly target: { readonly category: EvidenceCategory; readonly index: number } | null;
}
const failureTitles: Record<FailureKind, string> = {
  policy: "실행 정책 거부",
  check: "검사 실패",
  revise: "검토 수정 요청",
  "review-block": "검토 차단",
  blocked: "실행 차단",
  failed: "실행 실패",
  interrupted: "실행 중단",
  cancelled: "실행 취소",
};
const failureCodes = {
  BLOCKED: "RUN_BLOCKED",
  FAILED: "RUN_FAILED",
  INTERRUPTED: "RUN_INTERRUPTED",
  CANCELLED: "RUN_CANCELLED",
} as const;
const isFailedStatus = (status: string): status is keyof typeof failureCodes =>
  status in failureCodes;
const recordStatus = (value: string | undefined) =>
  value === undefined ? "확인할 수 없음" : weavraLabel(value);
// Criterion records say UNMET where the shared labels only know NOT_MET.
const criterionLabel = (status: CriterionRecord["status"]) =>
  status === "UNMET" ? "미충족" : weavraLabel(status);
const draftLines = (value: string) =>
  value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** Reason and next action from the recorded receipt plus evidence pages already loaded; nothing is fetched here. */
function taskFailure(task: WeavraTask, state: TaskEvidenceState | null): TaskFailure | null {
  const receipt = task.execution?.receipt;
  if (receipt?.status !== "FOUND" || receipt.run === null) return null;
  const run = receipt.run;
  const status = run.status;
  if (!isFailedStatus(status)) return null;
  const code = task.failureSummary?.code ?? failureCodes[status];
  const checks =
    state?.records.filter((record): record is CheckRecord => record.category === "checks") ?? [];
  const criteria =
    state?.records.filter(
      (record): record is CriterionRecord =>
        record.category === "criteria" && record.status !== "MET",
    ) ?? [];
  const failed = checks.findLast((check) => check.status === "FAIL");
  const denied =
    checks.findLast((check) => check.status === "UNAVAILABLE" && check.required) ??
    (status === "BLOCKED" ? checks.findLast((check) => check.status === "UNAVAILABLE") : undefined);
  const review = state?.latest.review ?? null;
  const failedOutput = failed
    ? [
        failed.stderrTail ? `[stderr]\n${failed.stderrTail}` : "",
        failed.stdoutTail ? `[stdout]\n${failed.stdoutTail}` : "",
      ]
        .filter(Boolean)
        .join("\n")
    : "";
  const checkFailure: TaskFailure | null = failed
    ? {
        kind: "check",
        tone: "destructive",
        code,
        reason: `${failed.id} 종료 코드 ${failed.exitCode ?? "없음"}`,
        detail: `${weavraLabel(failed.kind)} · ${failed.required ? "필수" : "선택"} · ${failed.step} 단계 시도 ${failed.attempt ?? "확인 안 됨"} · 코드 revision ${failed.revision}. ${failedOutput ? "아래는 검사 출력의 마지막 부분이에요(최대 20줄·2KiB, 비밀값 가림)." : "검사 출력 본문은 증거 레코드에 포함되지 않아요."}`,
        ...(failedOutput ? { output: failedOutput } : {}),
        refs: failed.evidenceRefs,
        criteria: [],
        target: { category: "checks", index: failed.index },
      }
    : null;
  if (checkFailure && code === "CHECK_FAILED") return checkFailure;
  if (denied)
    return {
      kind: "policy",
      tone: "destructive",
      code,
      reason: `검사 ${denied.id}가 실행 정책에 막혔어요: ${denied.required ? "필수" : "선택"} 검사가 ${denied.step} 단계 시도 ${denied.attempt ?? "확인 안 됨"}에서 실행되지 않아 종료 코드 없이 ‘확인할 수 없음’으로 기록됐어요. 신뢰 상태 ${recordStatus(denied.trust?.status)} · sandbox ${recordStatus(denied.sandbox?.status)}.`,
      detail:
        "등록된 검사 명령이 실행 정책 안에서 실행 가능해야 Run이 진행돼요. 거부 사유 문구는 증거 레코드에 포함되지 않아요.",
      refs: denied.evidenceRefs,
      criteria: [],
      target: { category: "checks", index: denied.index },
    };
  if (checkFailure) return checkFailure;
  if (review?.result === "REVISE" || review?.result === "BLOCK") {
    const kind = review.result === "REVISE" ? "revise" : "review-block";
    const reviewer = review.independent ? "독립 검토" : "독립성이 확인되지 않은 검토";
    const outcome = kind === "revise" ? "수정을 요청했어요(REVISE)" : "구현을 차단했어요(BLOCK)";
    const breakdown =
      criteria.length > 0
        ? `미충족·미검증 기준 ${criteria.length}개는 아래와 같아요.`
        : state?.complete.includes("criteria")
          ? "모든 기준이 충족으로 기록됐어요."
          : "기준별 결과는 ‘수용 기준’ 증거를 불러오면 표시돼요.";
    const first = criteria[0];
    return {
      kind,
      tone: kind === "revise" ? "warning" : "destructive",
      code,
      reason: `${reviewer}가 ${outcome}. 코드 revision ${review.revision}의 수용 기준 ${review.criteriaCount}개를 검토했고, ${breakdown}`,
      detail: review.reviseSummary
        ? `검토 수정 이유: ${review.reviseSummary}`
        : "검토 의견 원문은 증거 레코드에 포함되지 않아요. 기준별 상태가 검토 요약이에요.",
      refs: [],
      criteria,
      target: first ? { category: "criteria", index: first.index } : null,
    };
  }
  const last = checks.at(-1);
  const target = last ? { category: "checks" as const, index: last.index } : null;
  const cause = state
    ? "불러온 증거에 실패한 검사·검토 기록이 없어요. 사전 점검·프로바이더·승인 같은 다른 원인일 수 있어요."
    : "원인은 검사·검토 증거에 기록돼 있어요. ‘증거 보기’로 불러와 주세요.";
  switch (status) {
    case "BLOCKED":
      return {
        kind: "blocked",
        tone: "destructive",
        code,
        reason: `Runtime이 실행을 차단했어요 (${code}). ${cause}`,
        detail: null,
        refs: [],
        criteria: [],
        target,
      };
    case "FAILED":
      return {
        kind: "failed",
        tone: "destructive",
        code,
        reason: `Runtime 실행이 실패했어요 (${code}). ${cause}`,
        detail: null,
        refs: [],
        criteria: [],
        target,
      };
    case "INTERRUPTED":
      return {
        kind: "interrupted",
        tone: "warning",
        code,
        reason: `실행이 중단됐어요 (${code}). 정리 상태: ${weavraLabel(receipt.admission.cleanup ?? "UNCONFIRMED")}. 자동으로 다시 시작하지 않았어요.`,
        detail: null,
        refs: [],
        criteria: [],
        target,
      };
    case "CANCELLED":
      return {
        kind: "cancelled",
        tone: "warning",
        code,
        reason: `실행을 취소했어요 (${code}). 보존된 변경사항은 증거에서 확인할 수 있어요.`,
        detail: null,
        refs: [],
        criteria: [],
        target,
      };
  }
}

/** Draft constraint lines for the next attempt; the editor still shows them for review before any prepare. */
function revisionNotes(failure: TaskFailure, runId: string): string[] {
  return [
    `이전 Run ${runId} 검토 결과 ${failure.kind === "revise" ? "REVISE" : "BLOCK"}: 미충족 수용 기준을 먼저 해결해요.`,
    ...failure.criteria.map(
      (criterion) => `${criterion.id} ${criterionLabel(criterion.status)}: ${criterion.statement}`,
    ),
  ];
}

// Mirrors TaskEditor's draftKey in WeavraTaskCard so a seeded draft is picked up when the editor mounts.
const controlDraftKey = (task: WeavraTask) =>
  JSON.stringify([task.environmentId, task.projectId, task.threadId, task.id]);
const withRevisionNotes = (constraints: string, notes: readonly string[]) =>
  [...draftLines(constraints), ...notes.map((note) => note.trim().slice(0, 250))]
    .slice(0, 8)
    .join("\n");

/** Registered checks are only editable in the task card's project setup panel; open it in place. */
function openProjectSetup(): boolean {
  if (typeof document === "undefined") return false;
  const status = document.querySelector<HTMLElement>('[data-weavra="project-setup-status"]');
  const toggle = status?.querySelector<HTMLButtonElement>('[data-weavra-action="set-up-project"]');
  if (!status || !toggle) return false;
  const editor = status.querySelector(
    'section[aria-label="프로젝트 설정"], section[aria-label="프로젝트 설정 YAML 오류"]',
  );
  if (!editor && !toggle.disabled) toggle.click();
  status.scrollIntoView({ block: "start" });
  return true;
}

export function WeavraTaskResults({
  controller,
  connected,
}: {
  controller: WeavraTaskController;
  connected: boolean;
}) {
  const id = useId();
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const hash = useLocation({ select: (location) => location.hash.replace(/^#/, "") });
  const prefix = "weavra-task-";
  const requested = hash.startsWith(prefix) ? hash.slice(prefix.length) : null;
  const results = controller.tasks
    .filter((task) => task.execution?.confirmCommandId != null || task.phase === "finished")
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt));
  const selected = requested
    ? results.find((task) => task.id === requested)
    : (results.find((task) => task.id === controller.task?.id) ?? results[0]);
  const target = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (requested && selected?.id === requested) {
      target.current?.focus({ preventScroll: true });
      target.current?.scrollIntoView({ block: "start" });
    }
  }, [requested, selected?.id]);
  if (results.length === 0 && requested === null) return null;
  const active = selected?.id === controller.task?.id;
  // Reprepare is refused for confirmed tasks, so a revision starts a new attempt whose draft
  // carries the reviewed goal and the recorded revision request; nothing is prepared or run here.
  const reprepare =
    active &&
    selected &&
    selected.ownership.state === "released" &&
    controller.fresh &&
    controller.canOperate &&
    connected &&
    !controller.busy
      ? async (notes: readonly string[]) => {
          const previous = controller.task;
          if (!previous || previous.id !== selected.id) return false;
          // The card's start button already folds in composer and queue guards; honour its decision.
          if (
            typeof document !== "undefined" &&
            document.querySelector<HTMLButtonElement>(
              '[data-weavra-action="start-controlled-task"]',
            )?.disabled
          )
            return false;
          const created = await controller.act({
            type: "create",
            input: {
              environmentId: previous.environmentId,
              projectId: previous.projectId,
              threadId: previous.threadId,
              commandId: CommandId.make(randomUUID()),
            },
          });
          if (!created) return false;
          const fields = taskDraftFields(previous);
          useProjectControlDrafts.getState().setDraft(controlDraftKey(created), {
            ...fields,
            constraints: withRevisionNotes(fields.constraints, notes),
          });
          if (typeof document !== "undefined")
            document
              .querySelector('[data-weavra="controlled-task"]')
              ?.scrollIntoView({ block: "start" });
          return true;
        }
      : undefined;
  return (
    <div className="my-4 min-w-0 space-y-3 rounded-[24px] border border-border/80 bg-card/70 p-4 sm:p-5">
      <label htmlFor={`${id}-history`} className="block text-sm font-medium">
        기록된 작업 결과
      </label>
      <select
        id={`${id}-history`}
        data-weavra="task-result-history"
        className="w-full min-w-0 rounded-md border border-border bg-background p-2 text-sm"
        value={selected?.id ?? ""}
        onChange={(event) => {
          const task = results.find((item) => item.id === event.target.value);
          if (task) void navigate({ to: pathname, hash: `${prefix}${task.id}` });
        }}
      >
        {!selected ? <option value="">요청한 결과를 확인할 수 없어요</option> : null}
        {results.map((task) => (
          <option key={task.id} value={task.id}>
            {task.createdAt.slice(0, 16)} | {taskStatus(task)}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        결과 조회는 활성 작업의 대상을 바꾸거나 실행을 시작하지 않아요.
        {!active ? " 과거 시도의 기록이에요. 활성 작업 제어는 위 카드에서 할 수 있어요." : ""}
      </p>
      {selected ? (
        <div
          id={`${prefix}${selected.id}`}
          ref={target}
          tabIndex={-1}
          className="min-w-0 focus:outline-none"
        >
          <details className="mb-2 text-xs">
            <summary className="cursor-pointer">작업 식별 정보</summary>
            <p className="mt-2 font-mono [overflow-wrap:anywhere]">{selected.id}</p>
          </details>
          <WeavraTaskResult
            key={selected.id}
            task={selected}
            fresh={controller.discovered && connected && (!active || controller.fresh)}
            connected={connected}
            historical={!active}
            recoverySupported={active && controller.recoverySupported}
            canRefresh={active && controller.canOperate && !controller.busy}
            onRefresh={() => {
              if (active && controller.ref)
                void controller.act({ type: "reconcile", input: controller.ref });
            }}
            onReprepare={reprepare}
          />
          {active ? <TaskRunActions controller={controller} connected={connected} /> : null}
        </div>
      ) : (
        <p role="status" className="text-sm">
          이 대화에서 요청한 작업을 찾을 수 없어요. 다른 결과로 대체하지 않았어요.
        </p>
      )}
    </div>
  );
}

function TaskRunActions({
  controller: c,
  connected,
}: {
  controller: WeavraTaskController;
  connected: boolean;
}) {
  const receipt = c.task?.execution?.receipt;
  const run = receipt?.status === "FOUND" ? receipt.run : null;
  const epoch = useMemo(
    () => Symbol(`${c.task?.id}:${run?.runId}:${run?.revision}:${c.fresh}:${connected}`),
    [c.task?.id, run?.runId, run?.revision, c.fresh, connected],
  );
  const latestEpoch = useRef(epoch);
  useLayoutEffect(() => {
    latestEpoch.current = epoch;
  }, [epoch]);
  const [loaded, setLoaded] = useState<{
    epoch: symbol;
    approval: WeavraControlApproval | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const readApproval = useAtomCommand(approvalCommand, { reportFailure: false });
  const approval = loaded?.approval;
  const expiresAt = approval?.expiresAt;
  useEffect(() => {
    if (expiresAt === undefined) return;
    const delay = Math.max(0, expiresAt - Date.now());
    if (delay > 2147483647) return;
    const timer = setTimeout(() => setNow(Date.now()), delay + 1);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  if (
    !run ||
    !c.ref ||
    ["COMPLETED", "FAILED", "BLOCKED", "CANCELLED", "INTERRUPTED"].includes(run.status)
  )
    return null;
  const disabled = !connected || !c.fresh || !c.canOperate || c.busy || loading;
  const approvalCurrent =
    !!approval &&
    loaded?.epoch === epoch &&
    approval.runId === run.runId &&
    approval.stateRevision === run.revision &&
    approval.expiresAt > now &&
    attempted !== approval.approvalId;
  const inspect = async () => {
    if (!c.ref || !connected || !c.fresh || pending.current) return;
    pending.current = true;
    setLoading(true);
    setError(null);
    try {
      const result = await readApproval({ environmentId: c.ref.environmentId, input: c.ref });
      if (latestEpoch.current !== epoch) return;
      if (result._tag === "Success") {
        setLoaded({ epoch, approval: result.value });
        setAttempted(null);
      } else {
        setLoaded((previous) =>
          previous ? { ...previous, epoch: Symbol("unverified-approval") } : null,
        );
        setError("승인 요청을 확인할 수 없어요. 작업 상태를 새로고침한 뒤 다시 확인해 주세요.");
      }
    } finally {
      pending.current = false;
      setLoading(false);
    }
  };
  const decide = (decision: "approve" | "reject") => {
    if (!approval || !approvalCurrent || disabled || !c.ref || approval.expiresAt <= Date.now())
      return;
    setAttempted(approval.approvalId);
    void c.act({
      type: "resolveApproval",
      input: {
        task: c.ref,
        expectedRunId: approval.runId,
        expectedStateRevision: approval.stateRevision,
        approvalId: approval.approvalId,
        decision,
      },
    });
  };
  return (
    <section
      aria-label="연결된 Runtime 제어"
      className="min-w-0 space-y-3 border-t border-border/70 pt-3"
    >
      <p className="text-xs text-muted-foreground">
        이 제어는 현재 작업과 Run revision에만 적용돼요. 취소해도 일부 변경은 보존하며, 정리가
        확인되기 전에는 소유권을 해제하지 않아요.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => {
            if (c.ref)
              void c.act({
                type: "cancel",
                input: {
                  task: c.ref,
                  expectedRunId: run.runId,
                  expectedStateRevision: run.revision,
                },
              });
          }}
        >
          Runtime 실행 취소
        </Button>
        {run.status === "WAITING_APPROVAL" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!connected || !c.fresh || c.busy || loading}
            onClick={() => void inspect()}
          >
            {loading ? "승인 요청을 불러오고 있어요..." : "대기 중인 승인 확인"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {loaded && approval === null ? (
        <p className="text-xs">대기 중인 승인 요청이 없어요.</p>
      ) : null}
      {approval ? (
        <div className="space-y-3 rounded-lg border border-warning/50 p-3 text-sm [overflow-wrap:anywhere]">
          <h5 className="font-medium">파일 하나 삭제 승인(R3)</h5>
          <p>{approval.explanation}</p>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {[
              ["대상", approval.path],
              ["Run", approval.runId],
              ["승인", approval.approvalId],
              ["작업 / 역할", `${approval.operation} / ${approval.role}`],
              ["단계", `${approval.step.stepId}@${approval.step.attempt}`],
              [
                "Run / 프로젝트 revision",
                `${approval.stateRevision} / ${approval.projectRevision}`,
              ],
              ["바이트", String(approval.bytes)],
              ["파일 지문", approval.preconditionDigest],
              ["만료", new Date(approval.expiresAt).toLocaleString()],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            구현 확인은 이 삭제의 승인이 아니에요. 세션 전체 권한이나 자동 되돌리기를 부여하지
            않아요.
          </p>
          {!approvalCurrent ? (
            <p role="status" className="text-xs">
              이 승인은 오래됐거나 만료됐거나 이미 요청했어요. 작업을 새로고침하고 현재 요청을
              확인해 주세요. 자동 재시도는 없어요.
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={disabled || !approvalCurrent}
              onClick={() => decide("reject")}
            >
              삭제 거부
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled || !approvalCurrent}
              onClick={() => decide("approve")}
            >
              이번 삭제만 승인
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

/** Usage the Runtime reported for this Run in the project snapshot; never estimated. */
function ReportedRunUsage({ task, runId }: { task: WeavraTask; runId: string }) {
  const result = useAtomValue(
    observations.stateAtom(task.environmentId, task.projectId, task.target.workspaceRoot),
  );
  const evidence = Option.getOrUndefined(AsyncResult.value(result))?.observation.snapshot?.data
    .evidence;
  if (!evidence || evidence.runId !== runId) return null;
  const { count, toolCalls, reportedTokens } = evidence.workers;
  const tokens =
    reportedTokens === null
      ? "토큰 보고 없음"
      : `보고된 토큰 ${reportedTokens.toLocaleString("ko-KR")}`;
  return (
    <p data-weavra="task-run-usage" className="text-xs text-muted-foreground">
      {`${tokens} · 도구 호출 ${weavraLabel(toolCalls)} · worker ${weavraLabel(count)}`}
    </p>
  );
}

export function WeavraTaskResult({
  task,
  fresh,
  connected,
  onRefresh,
  canRefresh,
  historical = false,
  recoverySupported = false,
  onReprepare,
}: {
  task: WeavraTask;
  fresh: boolean;
  connected: boolean;
  onRefresh: () => void;
  canRefresh: boolean;
  historical?: boolean;
  recoverySupported?: boolean;
  onReprepare?: ((notes: readonly string[]) => Promise<boolean>) | undefined;
}) {
  const receipt = task.execution?.receipt;
  const run = receipt?.status === "FOUND" ? receipt.run : null;
  const nextAction =
    historical && fresh && connected
      ? "inspect-history"
      : taskResultNextAction({ task, fresh, connected, recoverySupported });
  const failure = task.failureSummary ? failureGuidance[task.failureSummary.code] : null;
  const startFailure =
    receipt?.status === "FOUND" &&
    receipt.run === null &&
    receipt.admission.outcome.status === "START_FAILED"
      ? receipt.admission.outcome.reasonCode
      : null;
  const observations = useMemo(
    () =>
      task.context?.observations.map((observation) => ({ id: randomUUID(), observation })) ?? [],
    [task.context],
  );
  return (
    <section
      aria-label="통제 작업 결과"
      data-weavra="controlled-outcome"
      data-weavra-result="goal-plan-result"
      data-weavra-start-failure={startFailure ?? undefined}
      className="min-w-0 space-y-4 border-t border-border/70 pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">작업 결과</h4>
        <Badge variant="outline">
          {weavraLabel(
            run?.status ??
              (receipt?.status === "FOUND" ? receipt.admission.outcome.status : "UNCONFIRMED"),
          )}
        </Badge>
      </div>
      {run ? <ReportedRunUsage task={task} runId={run.runId} /> : null}
      <div className="space-y-2 rounded-lg bg-muted/40 p-3 text-sm">
        {task.execution?.preview ? (
          <p className="[overflow-wrap:anywhere]">
            <strong>목표:</strong> {task.execution.preview.goal}
          </p>
        ) : null}
        <p>
          <strong>계획:</strong>{" "}
          {task.execution?.preview
            ? `${task.execution.preview.acceptanceCriteria.length}개 수용 기준, ${task.execution.preview.checks.filter((check) => check.required).length}개 필수 검사`
            : "확정된 계획 없음"}
        </p>
        <p>
          <strong>결과:</strong>{" "}
          {failure?.status ??
            weavraLabel(
              run?.status ??
                (receipt?.status === "FOUND" ? receipt.admission.outcome.status : "UNCONFIRMED"),
            )}
          {startFailure ? ` (${startFailure})` : ""}
          {run?.status === "COMPLETED" ? " (Runtime 완료 판정)" : ""}
        </p>
        <p role="status" data-next-action={nextAction} data-weavra-action="task-result-next-action">
          <strong>다음 단계:</strong>{" "}
          {nextAction === "none" && startFailure
            ? startFailure === "MODEL_UNAVAILABLE"
              ? "프로젝트 설정에서 Runtime 모델 프로필과 인증을 확인해 주세요. Claude Code 경로라면 명시적 사용 허용과 별도 CLI 로그인이 필요해요. 자동으로 다시 실행하지 않아요."
              : "프로젝트 설정의 Runtime 사전 검사 진단을 확인하고 준비 상태를 다시 검사해 주세요. 자동으로 다시 실행하지 않아요."
            : nextAction === "none" && failure
              ? failure.action
              : nextActionGuidance[nextAction]}
        </p>
        <p className="text-xs text-muted-foreground">
          {fresh
            ? "현재 확인한 결과예요."
            : "과거 결과예요. 작업 전에 다시 연결하고 동기화해 주세요."}{" "}
          작업 단계나 모델의 설명은 완료 증거가 아니에요.
        </p>
      </div>
      <details className="min-w-0 text-xs">
        <summary className="cursor-pointer font-medium">Runtime 및 checkout 진단</summary>
        <div className="mt-2 space-y-2 text-muted-foreground">
          <p>
            checkout 소유권: {weavraLabel(task.ownership.state)}. 정리 상태:{" "}
            {receipt?.status === "FOUND"
              ? weavraLabel(receipt.admission.cleanup ?? "UNCONFIRMED")
              : "확인 안 됨"}
            .
          </p>
          <p data-weavra-outcome-freshness={fresh ? "fresh" : "historical"}>
            {fresh
              ? "마지막으로 확인한 Runtime의 공식 결과예요."
              : "과거 결과예요. 다시 연결하고 동기화해 주세요."}
          </p>
        </div>
      </details>
      <details className="min-w-0 text-xs">
        <summary className="cursor-pointer font-medium">검토한 참고 자료(검증 증거 아님)</summary>
        {task.context ? (
          <div className="mt-3 space-y-3 [overflow-wrap:anywhere]">
            <p>
              <strong>관찰한 증상:</strong> {task.context.symptom}
            </p>
            <p>
              <strong>추정 원인(가설):</strong> {task.context.candidateCause?.text ?? "기록 없음"}
            </p>
            <ul className="space-y-2">
              {observations.map(({ id, observation }) => (
                <li key={id} className="rounded-lg bg-muted/40 p-2">
                  <Badge variant="outline">{weavraLabel(observation.provenance)}</Badge>
                  <p className="mt-1">{observation.text}</p>
                  <code className="text-muted-foreground">
                    {observation.reference.kind === "message"
                      ? `${observation.reference.threadId} / ${observation.reference.messageId}`
                      : observation.reference.path}
                  </code>
                </li>
              ))}
            </ul>
            <p>
              <strong>불확실한 점:</strong> {task.context.uncertainties.join("; ") || "기록 없음"}
            </p>
            <p>
              <strong>제약 조건:</strong> {task.context.constraints.join("; ") || "기록 없음"}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-muted-foreground">검토한 참고 자료를 확인할 수 없어요.</p>
        )}
      </details>
      {!receipt ? (
        <p className="text-sm text-muted-foreground">
          Runtime의 실행 허용 기록이 없어요. 구현 결과가 있다고 판단하지 않아요.
        </p>
      ) : receipt.status === "UNKNOWN" ? (
        <p className="text-sm text-muted-foreground">
          실행 허용 여부를 확인할 수 없어요. 실행 식별자를 보존하고 현재 상태를 조회해 주세요. 확인
          요청을 다시 보내지 마세요.
        </p>
      ) : run === null ? (
        <div className="space-y-3">
          <p className="text-sm">
            {receipt.admission.outcome.status === "START_FAILED"
              ? `시작 실패: ${receipt.admission.outcome.reasonCode}. Run은 만들지 않았어요.`
              : receipt.admission.outcome.status === "INTERRUPTED_BEFORE_START"
                ? "Run 시작 전에 소유 프로세스가 종료됐어요. 자동으로 재시작하지 않았어요."
                : "실행을 허용했지만 아직 Run이 확인되지 않았어요."}
          </p>
          {receipt.admission.outcome.status === "START_FAILED" ? (
            <WeavraPreflightFailure configuration={null} />
          ) : null}
        </div>
      ) : (
        <EvidencePanel
          key={`${task.id}:${run.runId}:${run.revision}`}
          task={task}
          fresh={fresh}
          connected={connected}
          onReprepare={onReprepare}
        />
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!connected || !canRefresh}
        onClick={onRefresh}
      >
        Runtime 결과 새로고침
      </Button>
    </section>
  );
}

function EvidencePanel({
  task,
  fresh,
  connected,
  onReprepare,
}: {
  task: WeavraTask;
  fresh: boolean;
  connected: boolean;
  onReprepare?: ((notes: readonly string[]) => Promise<boolean>) | undefined;
}) {
  const id = useId();
  const receipt = task.execution?.receipt;
  const run = receipt?.status === "FOUND" ? receipt.run : null;
  const epoch = useMemo(
    () =>
      Symbol(
        `evidence:${task.environmentId}:${task.projectId}:${task.threadId}:${task.id}:${run?.runId}:${run?.revision}:${fresh}:${connected}`,
      ),
    [
      task.id,
      task.environmentId,
      task.projectId,
      task.threadId,
      run?.runId,
      run?.revision,
      fresh,
      connected,
    ],
  );
  const latestEpoch = useRef(epoch);
  useLayoutEffect(() => {
    latestEpoch.current = epoch;
    return () => {
      latestEpoch.current = Symbol("retired-evidence");
    };
  }, [epoch]);
  const [loaded, setLoaded] = useState<{ epoch: symbol; state: TaskEvidenceState } | null>(null);
  const [category, setCategory] = useState<EvidenceCategory>("criteria");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const [spotlight, setSpotlight] = useState<{ key: string; token: number } | null>(null);
  const spotlightToken = useRef(0);
  const [note, setNote] = useState<string | null>(null);
  const [repreparing, setRepreparing] = useState(false);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const execute = useAtomCommand(evidenceCommand, { reportFailure: false });
  const state = loaded?.state ?? null;
  const current = fresh && connected && loaded?.epoch === epoch;
  const verification = issueVerification(task, state, current);
  const canAssess =
    run?.status === "COMPLETED" &&
    receipt?.status === "FOUND" &&
    receipt.admission.metadata.binding.symptomVerification !== undefined;
  const selectedRecords = state?.records.filter((record) => record.category === category) ?? [];
  const matchingRecord =
    reference === null
      ? undefined
      : selectedRecords.find(
          (record) =>
            (record.category === "checks" || record.category === "criteria") &&
            record.evidenceRefs.includes(reference),
        );
  const focusKey = matchingRecord ? `${matchingRecord.category}:${matchingRecord.index}` : null;
  useLayoutEffect(() => {
    if (!focusKey) return;
    const row = rows.current.get(focusKey);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "center" });
  }, [focusKey]);
  useLayoutEffect(() => {
    if (!spotlight) return;
    const row = rows.current.get(spotlight.key);
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: "center" });
  }, [spotlight]);
  // "failure" loads the check and criterion pages that explain a failed Run; it is never automatic.
  const load = async (
    reset = false,
    mode: "page" | "assess" | "failure" | "draft" | "diff" = "page",
  ): Promise<TaskEvidenceState | null> => {
    if (!run || !fresh || !connected || pending.current || (mode === "assess" && !canAssess))
      return null;
    let base = !reset && current ? state : null;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const requestedCategories: readonly EvidenceCategory[] =
        mode === "assess"
          ? ["criteria", "checks"]
          : mode === "failure"
            ? ["checks", "criteria"]
            : mode === "draft"
              ? draftCategories
              : mode === "diff"
                ? ["run-diff"]
                : [category];
      for (const requestedCategory of requestedCategories) {
        if (mode === "assess" && base?.unavailable[requestedCategory]) return base;
        if (
          mode !== "page" &&
          (base?.complete.includes(requestedCategory) || base?.unavailable[requestedCategory])
        )
          continue;
        do {
          if (latestEpoch.current !== epoch) return null;
          const cursor = base?.next[requestedCategory] ?? { category: requestedCategory, index: 0 };
          const result = await execute({
            environmentId: task.environmentId,
            input: {
              task: {
                environmentId: task.environmentId,
                projectId: task.projectId,
                threadId: task.threadId,
                taskId: task.id,
              },
              revision: run.revision,
              diffDigest: base?.latest.snapshot.diffDigest ?? null,
              cursor,
            },
          });
          if (latestEpoch.current !== epoch) return null;
          if (result._tag !== "Success") {
            const cause = squashAtomCommandFailure(result);
            const code =
              typeof cause === "object" && cause !== null && "code" in cause
                ? String(cause.code)
                : "REQUEST_FAILED";
            setError(
              `${code}: 증거를 확인할 수 없어요. 작업을 새로고침하고 스냅샷을 다시 불러와 주세요.`,
            );
            setLoaded((previous) =>
              previous ? { ...previous, epoch: Symbol("unverified-evidence") } : null,
            );
            return null;
          }
          const next =
            result.value.cursor.category !== cursor.category ||
            result.value.cursor.index !== cursor.index
              ? { ok: false as const, code: "PAGE_MISMATCH" as const }
              : appendTaskEvidence(task, base, result.value);
          if (!next.ok) {
            setError(
              `${next.code}: 증거 페이지를 합치지 않았어요. 작업을 새로고침하고 다시 불러와 주세요.`,
            );
            setLoaded((previous) =>
              previous ? { ...previous, epoch: Symbol("unverified-evidence") } : null,
            );
            return null;
          }
          base = next.state;
          setLoaded({ epoch, state: base });
          if (mode === "page" || base.unavailable[requestedCategory]) break;
          // Decoded cursors strictly advance within the snapshot's declared total.
        } while (!base.complete.includes(requestedCategory));
        if (mode === "assess" && base?.unavailable[requestedCategory]) return base;
      }
      return base;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const complete = current && state?.complete.includes(category);
  const unavailable = current ? state?.unavailable[category] : undefined;
  const counts = state
    ? {
        criteria: state.latest.completeness.criteria,
        checks: state.latest.completeness.checks,
        "changed-files": state.latest.completeness.changedFiles,
        "trust-sources": state.latest.completeness.trustSources,
        "run-diff": state.latest.completeness.changedFiles,
      }[category]
    : null;
  const failure = taskFailure(task, state);
  const failureLoaded =
    state !== null &&
    (["checks", "criteria"] as const).every(
      (item) => state.complete.includes(item) || state.unavailable[item] !== undefined,
    );
  const inspectFailure = async () => {
    if (!failure) return;
    const base = failureLoaded || !fresh || !connected ? state : await load(false, "failure");
    const target = taskFailure(task, base ?? state)?.target ?? null;
    setReference(null);
    setCategory(target?.category ?? "checks");
    if (target)
      setSpotlight({
        key: `${target.category}:${target.index}`,
        token: ++spotlightToken.current,
      });
  };
  const completed = run?.status === "COMPLETED";
  const draftLoaded =
    state !== null &&
    draftCategories.every(
      (item) => state.complete.includes(item) || state.unavailable[item] !== undefined,
    );
  const copyDraft = async () => {
    if (!run) return;
    const base = draftLoaded || !fresh || !connected ? state : await load(false, "draft");
    try {
      await navigator.clipboard.writeText(pullRequestDraft(task, run, base ?? state));
      toastManager.add({ type: "success", title: "PR 설명 초안을 복사했어요" });
    } catch {
      toastManager.add({ type: "error", title: "PR 설명 초안을 복사하지 못했어요" });
    }
  };
  const [diffShown, setDiffShown] = useState(false);
  const runDiffRecords =
    state?.records.filter((record): record is RunDiffRecord => record.category === "run-diff") ??
    [];
  const runDiffComplete = state?.complete.includes("run-diff") ?? false;
  const runDiffUnavailable = state?.unavailable["run-diff"];
  const runDiffLoaded = runDiffComplete || runDiffUnavailable !== undefined;
  const showRunDiff = () => {
    setDiffShown(true);
    if (!runDiffLoaded) void load(false, "diff");
  };
  const reprepare = async () => {
    if (!failure || !onReprepare || !run || repreparing) return;
    setRepreparing(true);
    try {
      const created = await onReprepare(revisionNotes(failure, run.runId));
      setNote(
        created
          ? "새 통제 작업을 만들고 수정 요청을 초안의 제약 조건에 반영했어요. 활성 작업 카드에서 초안을 검토한 뒤 준비해 주세요. 아직 준비하거나 실행하지 않았어요."
          : "새 작업을 만들지 못했어요. 작업 상태를 새로고침하고 활성 작업 카드의 안내를 확인해 주세요.",
      );
    } finally {
      setRepreparing(false);
    }
  };
  return (
    <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
      {failure ? (
        <section
          aria-label="실패 이유와 다음 행동"
          data-weavra="task-failure"
          data-weavra-failure={failure.kind}
          className={cn(
            "space-y-2 rounded-lg border p-3 text-sm",
            failure.tone === "warning" ? "border-warning/50" : "border-destructive/40",
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={failure.tone === "warning" ? "warning" : "error"}>
              {failureTitles[failure.kind]}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">{failure.code}</span>
          </div>
          <p data-weavra="task-failure-reason">{failure.reason}</p>
          {failure.detail ? (
            <p className="text-xs text-muted-foreground">{failure.detail}</p>
          ) : null}
          {failure.output ? (
            <pre
              data-weavra="task-failure-output"
              className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs"
            >
              {failure.output}
            </pre>
          ) : null}
          {failure.criteria.length > 0 ? (
            <ul className="space-y-1 text-xs">
              {failure.criteria.map((criterion) => (
                <li key={criterion.id}>
                  <span className="font-medium">{criterion.id}</span>{" "}
                  {criterionLabel(criterion.status)}: {criterion.statement}
                </li>
              ))}
            </ul>
          ) : null}
          {failure.refs.length > 0 ? (
            <p className="font-mono text-xs text-muted-foreground">
              출력 참조: {failure.refs.join(" | ")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {failure.kind === "policy" ? (
              <Button
                type="button"
                size="sm"
                data-weavra-action="fix-checks-in-settings"
                onClick={() =>
                  setNote(
                    openProjectSetup()
                      ? "프로젝트 설정 패널을 열었어요. 등록 검사를 실행 가능한 명령으로 고쳐 저장한 뒤 새 통제 작업을 시작해 주세요."
                      : "이 화면에 프로젝트 설정 패널이 없어요. 작업이 해제된 뒤 활성 작업 카드의 ‘프로젝트 설정’에서 검사를 고쳐 주세요.",
                  )
                }
              >
                설정에서 검사 고치기
              </Button>
            ) : null}
            {failure.kind === "revise" ? (
              <Button
                type="button"
                size="sm"
                data-weavra-action="reprepare-with-revision"
                disabled={!onReprepare || busy || repreparing}
                onClick={() => reprepare()}
              >
                {repreparing ? "새 작업을 만들고 있어요..." : "수정 요청 반영해 다시 준비"}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant={
                failure.kind === "policy" || failure.kind === "revise" ? "outline" : "default"
              }
              data-weavra-action="show-failure-evidence"
              disabled={busy || (!failureLoaded && (!fresh || !connected))}
              onClick={() => inspectFailure()}
            >
              증거 보기
            </Button>
          </div>
          {failure.kind === "revise" && !onReprepare ? (
            <p className="text-xs text-muted-foreground">
              다시 준비는 활성 작업에서 연결·권한·작업 해제가 확인된 뒤 가능해요.
            </p>
          ) : null}
          {note ? (
            <p role="status" className="text-xs text-muted-foreground">
              {note}
            </p>
          ) : null}
        </section>
      ) : null}
      {completed ? (
        <section
          aria-label="완료된 Run의 변경과 PR 설명"
          data-weavra="task-completed-actions"
          className="space-y-2"
        >
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              data-weavra-action="show-run-diff"
              disabled={busy || (!runDiffLoaded && (!fresh || !connected))}
              onClick={showRunDiff}
            >
              변경 보기
            </Button>
            <Button
              type="button"
              size="sm"
              data-weavra-action="copy-pr-draft"
              disabled={busy || (!draftLoaded && (!fresh || !connected))}
              onClick={() => copyDraft()}
            >
              PR 설명 초안 복사
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            초안은 이 Run의 수용 기준·검사·변경 경로 증거로만 만들어요. PR을 자동으로 올리지 않아요.
          </p>
          {diffShown ? (
            <div aria-label="이 Run의 변경" data-weavra="run-diff" className="space-y-2">
              <p className="text-xs text-muted-foreground">
                이 Run의 시작 상태와 결과 사이 변경만 보여 줘요. 다른 스레드의 변경이나 이후 변경은
                포함하지 않아요.
              </p>
              {runDiffUnavailable ? (
                <p role="status" data-weavra="run-diff-refused" className="text-xs">
                  {runDiffRefusals[runDiffUnavailable.reason] ?? "Run의 변경을 확인할 수 없어요."}{" "}
                  <span className="font-mono">{runDiffUnavailable.reason}</span>
                </p>
              ) : runDiffRecords.length > 0 ? (
                <WeavraRunDiff records={runDiffRecords} />
              ) : runDiffComplete ? (
                <p className="text-xs text-muted-foreground">이 Run에 기록된 변경 파일이 없어요.</p>
              ) : busy ? (
                <p className="text-xs text-muted-foreground">Run의 변경을 불러오고 있어요...</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer">Run 및 revision 식별 정보</summary>
        <p className="mt-2 font-mono [overflow-wrap:anywhere]">
          Run {run?.runId} | 상태 revision {run?.revision}
        </p>
      </details>
      <div
        role="status"
        data-issue-verification={verification.status}
        className="rounded-lg bg-muted/40 p-3 text-sm"
      >
        <p className="font-medium">
          {verification.status === "verified"
            ? "이 Run에서 원래 문제 검증 완료"
            : "원래 문제 미검증"}
        </p>
        {verification.status === "unverified" ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {verificationReasons[verification.reason]}
          </p>
        ) : null}
      </div>
      {state ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            {current ? "증거 스냅샷" : "과거 증거예요. 평가 전에 다시 불러와 주세요"} |{" "}
            {weavraLabel(state.latest.source)} | 코드 revision {state.latest.codeRevision}
          </p>
          <p className="font-mono">Diff {state.latest.snapshot.diffDigest}</p>
          <p>
            변경된 줄: {state.latest.changedLines ?? "확인할 수 없음"} | 정리 상태:{" "}
            {weavraLabel(state.latest.ownership.cleanup)}
          </p>
          <p>
            독립 검토:{" "}
            {state.latest.review
              ? `${weavraLabel(state.latest.review.result)}; 독립 검토=${weavraLabel(state.latest.review.independent)}; 코드 revision ${state.latest.review.revision}; ${state.latest.review.criteriaCount}개 수용 기준${state.latest.review.revision === state.latest.codeRevision && state.latest.review.diffDigest === state.latest.snapshot.diffDigest ? "" : "; 오래된 결과"}`
              : "확인할 수 없음"}
          </p>
          <p>이 증거는 기록된 Run revision에 대한 것이며 이후 파일 변경을 반영하지 않아요.</p>
          {run?.status !== "COMPLETED" &&
          (state.latest.completeness.changedFiles.total ?? 0) > 0 ? (
            <p>
              완료되지 않은 Run의 변경사항을 보존하고 있어요. 성공한 구현이나 자동 되돌리기로 볼
              수는 없어요.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1">
        <label htmlFor={`${id}-category`} className="text-xs font-medium">
          증거 분류
        </label>
        <select
          id={`${id}-category`}
          className="w-full rounded-md border border-border bg-background p-2 text-sm"
          value={category}
          onChange={(event) => {
            const selected = categories.find((item) => item.id === event.target.value);
            if (selected) {
              setCategory(selected.id);
              setReference(null);
            }
          }}
        >
          {categories.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      {counts ? (
        <p className="text-xs text-muted-foreground">
          제공 상태: {weavraLabel(counts.availability)} | 불러온 항목 {selectedRecords.length} /{" "}
          {counts.total ?? "확인할 수 없음"}
          {category === "checks"
            ? ` | 필수 기록: ${state?.latest.completeness.checks.required ?? "확인할 수 없음"}`
            : ""}
        </p>
      ) : null}
      {reference ? (
        <p role="status" className="text-xs">
          증거 참조: <code>{reference}</code>.{" "}
          {matchingRecord
            ? "불러온 기록 중 일치하는 항목으로 이동했어요."
            : "불러온 검사 기록에 없어요. 남은 페이지를 불러오거나 검토 요약을 확인해 주세요."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {unavailable ? (
        <p role="status" className="text-xs">
          확인 불가: {unavailable.reason}, 기록 {unavailable.recordIndex}. 항목이 없는 성공한
          분류라는 뜻은 아니에요.
        </p>
      ) : null}
      <div className="space-y-3">
        {selectedRecords.map((record) => (
          <div
            key={`${record.category}:${record.index}`}
            ref={(node) => {
              const key = `${record.category}:${record.index}`;
              if (node) rows.current.set(key, node);
              else rows.current.delete(key);
            }}
            tabIndex={-1}
            aria-label={`${record.category} 기록 ${record.index + 1}`}
            data-weavra-record={record.category}
            data-record-index={record.index + 1}
            className="min-w-0 rounded-lg border border-border/70 p-3 text-xs focus:outline-none focus:ring-2 focus:ring-ring"
          >
            <EvidenceRecord
              record={record}
              codeRevision={state?.latest.codeRevision ?? null}
              diffDigest={state?.latest.snapshot.diffDigest ?? null}
              onReference={(value) => {
                setCategory("checks");
                setReference(value);
              }}
            />
          </div>
        ))}
      </div>
      {complete && selectedRecords.length === 0 ? (
        <p className="text-xs text-muted-foreground">현재 스냅샷의 이 분류에는 기록이 없어요.</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          data-weavra-action="assess-original-issue"
          disabled={!fresh || !connected || busy || !canAssess}
          onClick={() => load(false, "assess")}
        >
          원래 문제 검증 상태 확인
        </Button>
        <Button
          type="button"
          size="sm"
          data-weavra-action="load-evidence"
          disabled={!fresh || !connected || busy || !!complete || !!unavailable}
          onClick={() => void load()}
        >
          {busy
            ? "증거를 불러오고 있어요..."
            : current && selectedRecords.length > 0
              ? "다음 증거 페이지 불러오기"
              : "Runtime 증거 불러오기"}
        </Button>
        {state ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-weavra-action="reload-evidence-snapshot"
            disabled={!fresh || !connected || busy}
            onClick={() => void load(true)}
          >
            증거 스냅샷 다시 불러오기
          </Button>
        ) : null}
      </div>
      {current && !complete && !unavailable && selectedRecords.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          남은 기록이 있어요. 일부 증거만으로 해결됐다고 판단할 수는 없어요.
        </p>
      ) : null}
    </div>
  );
}

function EvidenceRecord({
  record,
  codeRevision,
  diffDigest,
  onReference,
}: {
  record: WeavraEvidenceRecord;
  codeRevision: number | null;
  diffDigest: string | null;
  onReference: (reference: string) => void;
}) {
  switch (record.category) {
    case "criteria":
      return (
        <div className="space-y-2">
          <p className="font-medium">
            {record.id} <Badge variant="outline">{weavraLabel(record.status)}</Badge>
          </p>
          <p>{record.statement}</p>
          <div className="flex flex-wrap gap-2">
            {record.evidenceRefs.map((reference) => (
              <Button
                type="button"
                key={reference}
                size="sm"
                variant="outline"
                className="max-w-full break-all whitespace-normal"
                onClick={() => onReference(reference)}
              >
                {reference}
              </Button>
            ))}
          </div>
          {record.evidenceRefs.length === 0 ? (
            <p className="text-muted-foreground">기록된 증거 참조가 없어요.</p>
          ) : null}
        </div>
      );
    case "checks":
      return (
        <div className="space-y-2">
          <p className="font-medium">
            {record.id} <Badge variant="outline">{weavraLabel(record.status)}</Badge>
          </p>
          <p>
            {weavraLabel(record.kind)} | {record.required ? "필수" : "선택"} | {record.step} | 시도{" "}
            {record.attempt ?? "확인 안 됨"}
          </p>
          <p>
            코드 revision {record.revision} |{" "}
            {record.revision === codeRevision && record.diffDigest === diffDigest
              ? "스냅샷과 일치"
              : "스냅샷 기준 과거 기록"}{" "}
            | 종료 코드 {record.exitCode ?? "unavailable"}
          </p>
          <p>
            신뢰 상태: {record.trust?.status ?? "확인할 수 없음"} | sandbox:{" "}
            {record.sandbox?.status ?? "확인할 수 없음"}
          </p>
          {record.trust ? (
            <p className="font-mono">등록 정보 {record.trust.registrationDigest}</p>
          ) : null}
          <p className="font-mono">{record.evidenceRefs.join(" | ") || "기록된 증거 참조 없음"}</p>
        </div>
      );
    case "changed-files":
    case "run-diff":
      return <p className="font-mono">{record.path}</p>;
    case "trust-sources":
      return (
        <div className="space-y-1">
          <p>
            {record.checkId} | 검사 기록 {record.checkIndex + 1}
          </p>
          <p className="font-mono">{record.path}</p>
          <p className="font-mono">{record.digest}</p>
        </div>
      );
  }
}
