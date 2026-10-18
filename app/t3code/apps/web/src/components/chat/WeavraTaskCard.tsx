import {
  CommandId,
  WEAVRA_ANALYSIS_CONTEXT_MAX_BYTES,
  type WeavraTask,
  type WeavraTaskScopeInput,
} from "@t3tools/contracts";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import type { ChatMessage } from "../../types";
import { randomUUID } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  buildTaskDraft,
  selectedMessageFinding,
  taskConfirmBlocker,
  taskDraftFields,
  taskDraftContextBytes,
  taskStatus,
  type TaskDraftFields,
} from "./weavraTaskLogic";
import type { WeavraTaskController } from "./useWeavraTask";
import { WeavraProjectSetup } from "./WeavraProjectSetup";
import { weavraLabel } from "../weavraLabels";
import {
  applyChatControlDraft,
  latestChatControlDraft,
  reuseControlDraft,
  useProjectControlDrafts,
} from "./projectControlDraft";

const draftFieldByPath: Readonly<Record<string, string>> = {
  goal: "goal",
  acceptanceStatements: "criteria",
  context: "context",
  "context.symptom": "symptom",
  "context.candidateCause": "hypothesis",
  "context.uncertainties": "uncertainties",
  "context.constraints": "constraints",
  "context.sourceReferences": "sources",
  "context.observations": "context",
  "symptomVerification.criterionIndex": "symptom-criterion",
  "symptomVerification.checkId": "symptom-check",
};
const draftIssues = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: () => "이 항목의 필수 값과 입력 한도를 확인해 주세요.",
  checkHook: () => "이 항목의 필수 값과 입력 한도를 확인해 주세요.",
});
// A goal the Runtime rejects as ambiguous (INVALID_GOAL) is re-prepared with one of these
// visible leading tags. The mode is never inferred from untagged text.
const goalModes = [
  { mode: "read-only", tag: "[읽기 전용] ", label: "읽기 전용 조사" },
  { mode: "edit", tag: "[수정] ", label: "수정 작업" },
] as const;
const goalModeOf = (goal: string) =>
  goalModes.find(({ tag }) => goal.trimStart().startsWith(tag))?.mode ?? null;
function tagGoal(goal: string, next: (typeof goalModes)[number]): string {
  const bare = goal.trimStart();
  const current = goalModes.find(({ tag }) => bare.startsWith(tag));
  return `${next.tag}${current ? bare.slice(current.tag.length) : bare}`;
}

function DraftFieldError(props: {
  readonly id: string;
  readonly field: string;
  readonly errors: Readonly<Record<string, string>>;
}) {
  const error = props.errors[props.field];
  return error ? (
    <p id={`${props.id}-${props.field}-error`} className="text-xs text-destructive">
      {error}
    </p>
  ) : null;
}

interface TaskCardProps {
  controller: WeavraTaskController;
  scope: WeavraTaskScopeInput;
  supported: boolean;
  analysisSupported: boolean;
  connected: boolean;
  messages: readonly ChatMessage[];
  provider: string | null;
  entryBlockedReason?: string | null;
}

export function WeavraTaskCard(props: TaskCardProps) {
  const { controller: c, scope } = props;
  const [setupBusy, setSetupBusy] = useState(false);
  const [baselineHead, setBaselineHead] = useState<string | null>(null);
  const reason = !props.connected
    ? "통제 작업을 사용하려면 환경에 다시 연결해 주세요."
    : !props.supported
      ? "이 환경은 통제 작업을 지원하지 않아요."
      : !c.canOperate
        ? "이 세션에는 orchestration:operate 권한이 필요해요."
        : !c.discovered
          ? "이 대화의 통제 작업을 불러오고 있어요..."
          : (props.entryBlockedReason ?? null);
  return (
    <section
      aria-label="통제 작업"
      data-weavra="controlled-task"
      data-weavra-task-ownership={c.task?.ownership.state}
      data-weavra-run-status={
        c.task?.execution?.receipt?.status === "FOUND"
          ? (c.task.execution.receipt.run?.status ??
            c.task.execution.receipt.admission.outcome.status)
          : undefined
      }
      aria-busy={c.busy}
      className="my-4 min-w-0 rounded-[24px] border border-border/80 bg-card/70 p-4 text-sm sm:p-5 [overflow-wrap:anywhere]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="secondary">통제 작업</Badge>
          <h3 className="font-medium">분석하고 검토한 뒤 구현을 맡겨요</h3>
        </div>
        {c.task ? <Badge variant="outline">{weavraLabel(c.task.phase)}</Badge> : null}
      </div>
      <p className="mt-3 text-muted-foreground">
        읽기 전용 조사는 참고 자료예요. 확인한 STANDARD 계획은 Runtime만 구현하며, 모델의 설명만으로
        완료가 인정되지는 않아요. 새 폴더는 첫 시작에서 로컬 Git과 기준 커밋을 준비해요.
      </p>
      {reason ? (
        <p className="mt-3 text-muted-foreground" role="status">
          {reason}
        </p>
      ) : null}
      {c.error ? (
        <p className="mt-3 text-destructive" role="alert">
          {c.error}
        </p>
      ) : null}
      {c.dirtyWorkspace ? (
        <DirtyWorkspaceRefusal
          key={c.dirtyWorkspace.files.join("\0")}
          controller={c}
          details={c.dirtyWorkspace}
          blocked={reason !== null}
          onCommitted={setBaselineHead}
        />
      ) : null}
      {baselineHead !== null && c.task?.checkout.headCommit === baselineHead && !c.error ? (
        <p
          className="mt-3 text-muted-foreground"
          role="status"
          data-weavra="dirty-baseline-committed"
        >
          기준 커밋 {baselineHead.slice(0, 12)}을 만들었어요. 아래 구현 준비를 다시 눌러 주세요.
        </p>
      ) : null}
      {!c.discovered && props.connected && props.supported ? (
        <Button type="button" variant="outline" className="mt-3" onClick={c.refresh}>
          연결된 작업 다시 불러오기
        </Button>
      ) : null}
      {!c.task || c.task.ownership.state === "released" ? (
        <div className="mt-4 space-y-3">
          {c.task ? <TaskIdentity task={c.task} fresh={c.fresh} /> : null}
          <WeavraProjectSetup
            key={`${scope.environmentId}:${scope.projectId}:${scope.threadId}`}
            scope={scope}
            available
            autoPrepare
            onBusyChange={setSetupBusy}
            enabled={props.connected && props.supported && c.canOperate && !c.busy}
            onSaved={() => c.setError(null)}
          />
          <p className="text-muted-foreground">
            이 대화에서 선택한 checkout으로 작업해요. 분석 요청을 보내거나 구현을 명시적으로
            확인하기 전에는 모델을 호출하지 않아요.
          </p>
          <Button
            type="button"
            data-weavra-action="start-controlled-task"
            variant="outline"
            disabled={reason !== null || c.busy || setupBusy}
            onClick={() =>
              void c.act({
                type: "create",
                input: { ...scope, commandId: CommandId.make(randomUUID()) },
              })
            }
          >
            {c.busy ? "작업을 만들고 있어요..." : "통제 작업 시작"}
          </Button>
          {c.task?.execution?.confirmCommandId != null ? (
            c.route === "free" ? (
              <p className="text-xs text-muted-foreground">
                자유 작업을 선택했어요. 기록된 통제 작업 결과는 바뀌지 않아요.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  후속 메시지는 프로바이더나 새 Run을 시작하지 않고 저장해요. 새 통제 작업에는
                  검토와 확인이 필요해요.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  data-weavra-action="return-to-free-coding"
                  disabled={reason !== null || !c.fresh || c.busy}
                  onClick={c.chooseFreeCoding}
                >
                  자유 작업으로 돌아가기
                </Button>
              </div>
            )
          ) : null}
        </div>
      ) : (
        <TaskEditor key={c.task.id} {...props} task={c.task} />
      )}
    </section>
  );
}

function DirtyWorkspaceRefusal(props: {
  controller: WeavraTaskController;
  details: NonNullable<WeavraTaskController["dirtyWorkspace"]>;
  blocked: boolean;
  onCommitted: (headCommit: string) => void;
}) {
  const { controller: c, details } = props;
  const [confirming, setConfirming] = useState(false);
  const [copy, setCopy] = useState<"copied" | "failed" | null>(null);
  const task = c.task;
  // Only an unprepared analysis task can rebase its checkout; a truncated list was never fully shown.
  const committable =
    task !== null &&
    task.ownership.state === "analysis" &&
    task.phase === "analysis" &&
    task.execution === null &&
    details.files.length > 0 &&
    !details.truncated;
  const disabled = props.blocked || !c.fresh || c.busy || !committable;
  const titleId = useId();
  const commit = async () => {
    if (!task || !c.ref || disabled) return;
    setConfirming(false);
    const committed = await c.act({
      type: "commitDirtyBaseline",
      input: {
        task: c.ref,
        expectedRevision: task.revision,
        files: [...details.files],
        consent: true,
      },
    });
    if (committed) props.onCommitted(committed.checkout.headCommit);
  };
  const fileList = (
    <ul className="max-h-48 overflow-auto rounded-md border border-border/70 bg-background/60 p-2 font-mono text-xs">
      {details.files.map((file) => (
        <li key={file} className="py-0.5">
          {file}
        </li>
      ))}
    </ul>
  );
  return (
    <div data-weavra="dirty-workspace" className="mt-3 space-y-2">
      <p className="font-medium">커밋하지 않은 변경 파일 {details.files.length}개</p>
      {fileList}
      {details.truncated ? (
        <p className="text-xs text-muted-foreground" data-weavra="dirty-workspace-truncated">
          파일이 더 있어 일부만 보여요. 전체 목록을 확인할 수 없어서 기준 커밋에 포함할 수 없어요.
          터미널에서 git status로 정리한 뒤 다시 준비해 주세요.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          data-weavra-action="include-dirty-in-baseline"
          disabled={disabled || confirming}
          onClick={() => setConfirming(true)}
        >
          이 변경을 기준 커밋에 포함
        </Button>
        <Button
          type="button"
          variant="outline"
          data-weavra-action="copy-dirty-files"
          onClick={() =>
            void navigator.clipboard.writeText(details.files.join("\n")).then(
              () => setCopy("copied"),
              () => setCopy("failed"),
            )
          }
        >
          파일 목록 복사
        </Button>
      </div>
      {copy ? (
        <p className="text-xs text-muted-foreground" role="status">
          {copy === "copied"
            ? "파일 목록을 복사했어요."
            : "복사하지 못했어요. 목록을 직접 선택해 복사해 주세요."}
        </p>
      ) : null}
      {confirming ? (
        <div
          role="alertdialog"
          aria-labelledby={titleId}
          data-weavra="dirty-baseline-confirm"
          className="space-y-2 rounded-xl border border-border bg-background p-3"
        >
          <p id={titleId} className="font-medium">
            이 파일들을 프로젝트 저장소에 커밋할까요?
          </p>
          <p className="text-xs text-muted-foreground">
            이 대화의 프로젝트 저장소에 "Weavra: 작업 시작 전 기준 커밋"으로 아래 파일만 커밋해요.
            push는 하지 않아요. 커밋한 뒤 구현 준비를 다시 눌러 주세요.
          </p>
          {fileList}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-weavra-action="confirm-dirty-baseline"
              disabled={disabled}
              onClick={() => void commit()}
            >
              커밋하기
            </Button>
            <Button
              type="button"
              variant="outline"
              data-weavra-action="cancel-dirty-baseline"
              onClick={() => setConfirming(false)}
            >
              취소
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function DraftFields({
  fields,
  change,
  messages,
  task,
  id,
  errors,
  contextBytes,
  bindingAvailable,
  goalModeReprepare,
}: {
  fields: TaskDraftFields;
  change: (fields: TaskDraftFields) => void;
  messages: readonly ChatMessage[];
  task: WeavraTask;
  id: string;
  errors: Readonly<Record<string, string>>;
  contextBytes: number | null;
  bindingAvailable: boolean;
  goalModeReprepare: (() => void) | null;
}) {
  const [messageId, setMessageId] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [findingKeys, setFindingKeys] = useState(() => fields.observations.map(() => randomUUID()));
  const visible = useMemo(
    () =>
      messages
        .filter(
          (message) =>
            (message.role === "assistant" || message.role === "user") &&
            message.text.trim() &&
            !message.streaming,
        )
        .map((message) => {
          let preview = "";
          let length = 0;
          let scanned = 0;
          // Bound both label size and work for whitespace-heavy messages.
          for (const character of message.text.trim()) {
            if (length === 120 || scanned++ === 512) {
              preview += "...";
              break;
            }
            const next = /\s/u.test(character) ? " " : character;
            if (next === " " && preview.endsWith(" ")) continue;
            preview += next;
            length++;
          }
          return { message, preview };
        }),
    [messages],
  );
  const selected = visible.find(({ message }) => message.id === messageId)?.message;
  const update = (field: Exclude<keyof TaskDraftFields, "observations">, value: string) =>
    change({
      ...fields,
      [field]: value,
      ...(field === "criteria" && value !== fields.criteria
        ? { symptomCriterion: "", symptomCheck: "" }
        : {}),
    });
  const preview = task.execution?.preview;
  const criteria = fields.criteria
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bindingOptionsAvailable =
    bindingAvailable &&
    preview !== null &&
    preview !== undefined &&
    criteria.length === preview.acceptanceCriteria.length &&
    criteria.every(
      (statement, index) => statement === preview.acceptanceCriteria[index]?.statement,
    );
  return (
    <>
      <p className="text-xs text-muted-foreground">
        준비 전에는 로컬 초안이에요. 검토한 관찰 내용만 참고 자료에 포함하며, 숨겨진 추론·인증
        정보·도구 기록은 포함하지 않아요. 전체 한도는 8 KiB예요.
      </p>
      <output
        id={`${id}-context`}
        tabIndex={-1}
        aria-label="참고 자료 크기"
        data-weavra="advisory-context-size"
        aria-live="polite"
        aria-invalid={
          contextBytes === null ||
          contextBytes > WEAVRA_ANALYSIS_CONTEXT_MAX_BYTES ||
          errors.context !== undefined
        }
        aria-describedby={errors.context ? `${id}-context-error` : undefined}
        className="block text-xs text-muted-foreground"
      >
        {contextBytes === null ? "확인할 수 없음" : contextBytes} /{" "}
        {WEAVRA_ANALYSIS_CONTEXT_MAX_BYTES} 바이트의 참고 자료
        {contextBytes === null ? " - 크기를 확인하려면 소스 참조 JSON을 수정해 주세요." : ""}
      </output>
      <DraftFieldError id={id} field="context" errors={errors} />
      {(
        [
          ["goal", "구현 목표", 2048, "필수 항목이에요. 최대 2,048자까지 입력해 주세요."],
          ["symptom", "관찰한 증상", 1000, "필수 항목이에요. 최대 1,000자까지 입력해 주세요."],
          [
            "hypothesis",
            "추정 원인(확인된 사실이 아닌 가설)",
            1000,
            "선택 항목이에요. 최대 1,000자까지 입력할 수 있어요.",
          ],
          [
            "uncertainties",
            "불확실한 점",
            2007,
            "한 줄에 하나씩, 항목당 최대 250자로 8개까지 입력해 주세요.",
          ],
          [
            "constraints",
            "제약 조건",
            2007,
            "한 줄에 하나씩, 항목당 최대 250자로 8개까지 입력해 주세요. 이 내용으로 권한이 부여되지는 않아요.",
          ],
          [
            "criteria",
            "수용 기준",
            8015,
            "한 줄에 하나씩 1~16개 기준을 입력해 주세요. 기준당 최대 500자이며, 아직 검증된 결과가 아니에요.",
          ],
        ] as const
      ).map(([field, label, cap, help]) => (
        <div key={field} className="space-y-1.5">
          <label htmlFor={`${id}-${field}`} className="block font-medium">
            {label}
          </label>
          <Textarea
            id={`${id}-${field}`}
            aria-invalid={errors[field] !== undefined}
            aria-describedby={`${id}-${field}-help${errors[field] ? ` ${id}-${field}-error` : ""}`}
            maxLength={cap}
            value={fields[field]}
            onChange={(event) => update(field, event.target.value)}
          />
          <p id={`${id}-${field}-help`} className="text-xs text-muted-foreground">
            {help}
          </p>
          <DraftFieldError id={id} field={field} errors={errors} />
          {field === "goal" && goalModeReprepare ? (
            <GoalModeChooser
              id={id}
              goal={fields.goal}
              onChange={(goal) => update("goal", goal)}
              reprepare={goalModeReprepare}
            />
          ) : null}
        </div>
      ))}
      <div className="space-y-3">
        <h4 className="font-medium">선택한 관찰 내용 ({fields.observations.length}/8)</h4>
        {fields.observations.map((finding, index) => (
          <div key={findingKeys[index]} className="space-y-1.5 rounded-lg bg-muted/50 p-3">
            <label htmlFor={`${id}-finding-${index}`} className="block text-xs">
              관찰 내용 {index + 1} | {weavraLabel(finding.provenance)} |{" "}
              {finding.reference.kind === "message"
                ? finding.reference.messageId
                : finding.reference.path}
            </label>
            <Textarea
              id={`${id}-finding-${index}`}
              aria-invalid={errors[`finding-${index}`] !== undefined}
              aria-describedby={
                errors[`finding-${index}`] ? `${id}-finding-${index}-error` : undefined
              }
              maxLength={500}
              value={finding.text}
              onChange={(event) =>
                change({
                  ...fields,
                  observations: fields.observations.map((entry, at) =>
                    at === index
                      ? { ...entry, text: event.target.value, provenance: "USER" }
                      : entry,
                  ),
                })
              }
            />
            <DraftFieldError id={id} field={`finding-${index}`} errors={errors} />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setFindingKeys((keys) => keys.filter((_, at) => at !== index));
                change({
                  ...fields,
                  observations: fields.observations.filter((_, at) => at !== index),
                });
              }}
            >
              관찰 내용 제거 {index + 1}
            </Button>
          </div>
        ))}
        <label htmlFor={`${id}-message`} className="block text-xs font-medium">
          화면에 표시된 메시지를 출처로 선택해 주세요
        </label>
        <select
          id={`${id}-message`}
          className="w-full min-w-0 rounded-lg border border-input bg-background p-2"
          value={messageId}
          onChange={(event) => {
            setMessageId(event.target.value);
            setExcerpt("");
            setSelectionError(null);
          }}
        >
          <option value="">메시지 선택...</option>
          {visible.map(({ message, preview }) => (
            <option key={message.id} value={message.id}>
              {weavraLabel(message.role)} | {preview}
            </option>
          ))}
        </select>
        {selected ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer" data-weavra="read-selected-message">
              선택한 메시지 읽기
            </summary>
            <p className="mt-2 font-mono">
              {weavraLabel(selected.role)} | {selected.id}
            </p>
            <p className="mt-2 whitespace-pre-wrap">{selected.text}</p>
          </details>
        ) : null}
        <label htmlFor={`${id}-excerpt`} className="block text-xs">
          화면에 표시된 원문 발췌(최대 500자)
        </label>
        <Textarea
          id={`${id}-excerpt`}
          maxLength={500}
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          포함할 관찰 내용만 복사해 주세요. 답변을 그대로 발췌하면 MODEL 출처를 유지하고, 선택한
          내용을 편집하면 USER로 표시해요. 메시지를 자동으로 선택하지 않아요.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-weavra-action="include-selected-finding"
          disabled={!selected || !excerpt.trim() || fields.observations.length >= 8}
          onClick={() => {
            if (!selected || (selected.role !== "user" && selected.role !== "assistant")) return;
            if (!selected.text.includes(excerpt)) {
              setSelectionError(
                "발췌문은 선택한 메시지의 원문과 일치해야 해요. 먼저 추가한 뒤 필요하면 관찰 내용을 편집해 주세요.",
              );
              return;
            }
            try {
              const finding = selectedMessageFinding({
                threadId: task.threadId,
                messageId: selected.id,
                role: selected.role,
                text: excerpt,
              });
              setFindingKeys((keys) => [...keys, randomUUID()]);
              change({ ...fields, observations: [...fields.observations, finding] });
              setExcerpt("");
              setSelectionError(null);
            } catch {
              setSelectionError("화면에 표시된 원문에서 1~500자를 선택해 주세요.");
            }
          }}
        >
          선택한 관찰 내용 포함
        </Button>
        {selectionError ? (
          <p role="alert" className="text-xs text-destructive">
            {selectionError}
          </p>
        ) : null}
      </div>
      <details className="min-w-0 space-y-3">
        <summary className="cursor-pointer font-medium">고급: 출처와 증상 검사</summary>
        <label htmlFor={`${id}-sources`} className="block text-xs font-medium">
          소스 참조(선택 사항, JSON 배열)
        </label>
        <Textarea
          id={`${id}-sources`}
          aria-invalid={errors.sources !== undefined}
          aria-describedby={errors.sources ? `${id}-sources-error` : undefined}
          className="font-mono text-xs"
          maxLength={8192}
          value={fields.sources}
          onChange={(event) => update("sources", event.target.value)}
        />
        <DraftFieldError id={id} field="sources" errors={errors} />
        <p className="text-xs text-muted-foreground">
          최초 소스 해시가 없으면 []로 두세요. 상대 경로와 원래 digest(sha256: 및 16진수 64자)를
          최대 8개 입력할 수 있고 lines의 start/end는 선택 사항이에요. 오래된 관찰을 숨기려고 해시를
          만들거나 갱신하지 마세요. Host가 현재 소스와 비교해요.
        </p>
        <label htmlFor={`${id}-symptom-criterion`} className="block text-xs font-medium">
          원래 증상에 대한 수용 기준
        </label>
        <select
          id={`${id}-symptom-criterion`}
          className="w-full min-w-0 rounded-lg border border-input bg-background p-2"
          disabled={!bindingOptionsAvailable}
          aria-invalid={errors["symptom-criterion"] !== undefined}
          aria-describedby={
            errors["symptom-criterion"] ? `${id}-symptom-criterion-error` : undefined
          }
          value={fields.symptomCriterion}
          onChange={(event) =>
            change({
              ...fields,
              symptomCriterion: event.target.value,
              ...(event.target.value === "" ? { symptomCheck: "" } : {}),
            })
          }
        >
          <option value="">연결하지 않음</option>
          {bindingOptionsAvailable &&
            preview?.acceptanceCriteria.map((criterion, index) => (
              <option key={criterion.id} value={String(index + 1)}>
                {criterion.id}: {criterion.statement}
              </option>
            ))}
        </select>
        <DraftFieldError id={id} field="symptom-criterion" errors={errors} />
        <label htmlFor={`${id}-symptom-check`} className="block text-xs font-medium">
          증상을 확인할 필수 등록 검사
        </label>
        <select
          id={`${id}-symptom-check`}
          className="w-full min-w-0 rounded-lg border border-input bg-background p-2"
          disabled={!bindingOptionsAvailable}
          aria-invalid={errors["symptom-check"] !== undefined}
          aria-describedby={errors["symptom-check"] ? `${id}-symptom-check-error` : undefined}
          value={fields.symptomCheck}
          onChange={(event) =>
            change({
              ...fields,
              symptomCheck: event.target.value,
              ...(event.target.value === "" ? { symptomCriterion: "" } : {}),
            })
          }
        >
          <option value="">연결하지 않음</option>
          {bindingOptionsAvailable &&
            preview?.checks
              .filter((check) => check.required)
              .map((check) => (
                <option key={check.id} value={check.id}>
                  {check.id} | {weavraLabel(check.kind)}
                </option>
              ))}
        </select>
        <DraftFieldError id={id} field="symptom-check" errors={errors} />
        {!bindingOptionsAvailable ? (
          <p className="text-xs text-muted-foreground" role="status">
            새 스냅샷을 준비한 뒤 수용 기준과 필수 등록 검사를 선택해 주세요. 모델·허용 경로·검사는
            Runtime이 제공하며, 이 화면에서 검사 등록을 만들 수는 없어요.
          </p>
        ) : null}
        {!fields.symptomCriterion || !fields.symptomCheck ? (
          <p className="text-xs text-muted-foreground" role="status">
            원래 문제에 검증 검사가 연결되지 않았어요. 작업 완료만으로 보고한 증상이 해결됐다고 볼
            수는 없어요.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          두 항목을 함께 선택하거나 모두 비워 두세요. 선택을 바꾸면 새 스냅샷 준비와 재검토가
          필요해요. 수용 기준을 편집하거나 순서를 바꾸면 연결이 해제돼요. 등록 digest는 Runtime이
          제공해요.
        </p>
      </details>
    </>
  );
}

function GoalModeChooser(props: {
  readonly id: string;
  readonly goal: string;
  readonly onChange: (goal: string) => void;
  readonly reprepare: () => void;
}) {
  const selected = goalModeOf(props.goal);
  return (
    <div data-weavra="goal-mode" className="space-y-2 rounded-lg bg-muted/50 p-3">
      <p id={`${props.id}-goal-mode-label`} className="font-medium">
        이 목표를 어떻게 다룰까요?
      </p>
      <p className="text-xs text-muted-foreground">
        고른 방식은 목표 앞에 [읽기 전용] 또는 [수정] 태그로 보이게 남고 저장 초안에도 포함돼요.
        태그 없이 방식을 추측하지 않아요.
      </p>
      <div
        role="radiogroup"
        aria-labelledby={`${props.id}-goal-mode-label`}
        className="space-y-1.5"
      >
        {goalModes.map((entry) => (
          <label key={entry.mode} className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              className="mt-1"
              name={`${props.id}-goal-mode`}
              value={entry.mode}
              checked={selected === entry.mode}
              onChange={() => props.onChange(tagGoal(props.goal, entry))}
            />
            {entry.label}
          </label>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        data-weavra-action="reprepare-with-goal-mode"
        disabled={selected === null}
        onClick={() => {
          if (selected !== null) props.reprepare();
        }}
      >
        다시 준비
      </Button>
    </div>
  );
}

function TaskPreview({ task }: { task: WeavraTask }) {
  const preview = task.execution?.preview;
  if (!preview) return null;
  return (
    <div className="min-w-0 space-y-4 rounded-lg border border-border bg-background/50 p-3">
      <h4 className="font-medium" data-weavra="prepared-snapshot">
        준비된 스냅샷 | {preview.workflow} | {preview.executionMode} | {preview.risk}
      </h4>
      <p>{preview.goal}</p>
      <dl className="space-y-2 text-xs">
        <div>
          <dt className="font-medium">대상 checkout / HEAD</dt>
          <dd className="font-mono">
            {preview.taskBinding.checkout.canonicalCwd}
            <br />
            {preview.taskBinding.checkout.headCommit}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Runtime 모델(확정된 경로)</dt>
          <dd>
            {preview.modelRoutes
              ? preview.modelRoutes.map((route) => (
                  <p key={route.role}>
                    {weavraLabel(route.role)}: {route.provider} / {route.model} | {route.profile} |{" "}
                    {weavraLabel(route.intent)} | {weavraLabel(route.source)}
                  </p>
                ))
              : "확인할 수 없어요. 대화 모델에서 추정하지 않아요"}
          </dd>
        </div>
        <div>
          <dt className="font-medium">허용 경로</dt>
          <dd>
            {preview.allowedPaths.length
              ? preview.allowedPaths.map((path) => (
                  <p key={path} className="font-mono">
                    {path}
                  </p>
                ))
              : "없음"}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Host에 등록된 검사</dt>
          <dd>
            {preview.checks.map((check) => (
              <p key={check.id}>
                {check.id} | {weavraLabel(check.kind)} | {check.required ? "필수" : "선택"}
              </p>
            ))}
          </dd>
        </div>
        <div>
          <dt className="font-medium">수용 기준</dt>
          <dd className="space-y-2">
            {preview.acceptanceCriteria.map((criterion) => (
              <div key={criterion.id}>
                <p>
                  {criterion.id}: {criterion.statement}
                </p>
                <p className="text-muted-foreground">
                  검사: {criterion.checkIds.join(", ") || "없음"} | 독립 검토{" "}
                  {criterion.reviewRequired ? "필수" : "필수 아님"}
                </p>
              </div>
            ))}
          </dd>
        </div>
        <div>
          <dt className="font-medium">증상 검증 연결</dt>
          <dd>
            {preview.taskBinding.symptomVerification
              ? `${preview.taskBinding.symptomVerification.criterionId} / ${preview.taskBinding.symptomVerification.checkId} / ${preview.taskBinding.symptomVerification.registrationDigest}`
              : "연결 없음 - 원래 문제는 미검증 상태예요"}
          </dd>
        </div>
      </dl>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">스냅샷 식별 정보와 설정</summary>
        <dl className="mt-2 space-y-2 font-mono">
          <div>
            <dt>실행 / 참고 자료</dt>
            <dd>
              {preview.taskBinding.executionId} / {preview.taskBinding.packetVersion}
            </dd>
          </div>
          <div>
            <dt>미리보기 / 설정 / 참고 자료 digest</dt>
            <dd>
              {preview.previewDigest}
              <br />
              {preview.configDigest}
              <br />
              {preview.taskBinding.advisoryDigest}
            </dd>
          </div>
          <div>
            <dt>작업 공간 digest</dt>
            <dd>{preview.taskBinding.checkout.workspaceDigest}</dd>
          </div>
          <div>
            <dt>프로젝트 revision / 만료</dt>
            <dd>
              {preview.projectRevision} / {new Date(preview.expiresAt).toLocaleString()}
            </dd>
          </div>
          {Object.entries(preview.configuration).map(([name, value]) => (
            <div key={name}>
              <dt>{name}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

function TaskIdentity({ task, fresh }: { task: WeavraTask; fresh: boolean }) {
  const receipt = task.execution?.receipt;
  return (
    <div className="space-y-2 text-xs text-muted-foreground">
      <p role="status">
        {fresh ? "현재 관찰 결과" : "과거 스냅샷 - 작업 전에 동기화해 주세요"}: {taskStatus(task)}
      </p>
      <details className="min-w-0">
        <summary className="cursor-pointer">작업 및 checkout 진단</summary>
        <dl className="mt-2 grid min-w-0 gap-1">
          <div>
            <dt className="inline font-medium">checkout: </dt>
            <dd className="inline font-mono">{task.checkout.canonicalCwd}</dd>
          </div>
          <div>
            <dt className="inline font-medium">HEAD: </dt>
            <dd className="inline font-mono">{task.checkout.headCommit}</dd>
          </div>
          <div>
            <dt className="inline font-medium">작업: </dt>
            <dd className="inline font-mono">
              {task.id} | revision {task.revision} | 소유권 {weavraLabel(task.ownership.state)}
            </dd>
          </div>
          {task.execution ? (
            <div>
              <dt className="inline font-medium">실행: </dt>
              <dd className="inline font-mono">{task.execution.binding.executionId}</dd>
            </div>
          ) : null}
          {receipt?.status === "FOUND" && receipt.run ? (
            <div>
              <dt className="inline font-medium">Run: </dt>
              <dd className="inline font-mono">
                {receipt.run.runId} | revision {receipt.run.revision}
              </dd>
            </div>
          ) : null}
        </dl>
      </details>
      <p>작업 단계는 완료 판정이 아니에요. 이 카드만으로 원래 문제가 검증되지는 않아요.</p>
    </div>
  );
}

function TaskEditor(props: TaskCardProps & { task: WeavraTask }) {
  const { controller: c, task } = props;
  const draftKey = JSON.stringify([task.environmentId, task.projectId, task.threadId, task.id]);
  const cached = useProjectControlDrafts((state) => state.byTask[draftKey]);
  const saveDraft = useProjectControlDrafts((state) => state.setDraft);
  const chatDraft = useMemo(() => latestChatControlDraft(props.messages), [props.messages]);
  const previous = c.tasks
    .filter(
      (item) =>
        item.id !== task.id &&
        item.environmentId === task.environmentId &&
        item.projectId === task.projectId &&
        item.threadId === task.threadId &&
        item.execution?.preview != null,
    )
    .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
  const savedFields =
    previous && !task.execution?.preview
      ? reuseControlDraft(taskDraftFields(task), taskDraftFields(previous))
      : taskDraftFields(task);
  const initialFields =
    cached ??
    (chatDraft && !task.execution?.confirmCommandId
      ? applyChatControlDraft(savedFields, chatDraft.draft)
      : savedFields);
  const [fields, setFields] = useState(initialFields);
  const [edited, setEdited] = useState(
    () => JSON.stringify(initialFields) !== JSON.stringify(taskDraftFields(task)),
  );
  const [appliedCandidate, setAppliedCandidate] = useState(
    !cached && chatDraft ? chatDraft.messageId : null,
  );
  const [consent, setConsent] = useState<string | null>(null);
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [reviewedMetadata, setReviewedMetadata] = useState(() => ({
    packetVersion: (task.context?.packetVersion ?? 0) + 1,
    reviewedAt: Date.now(),
  }));
  const editorRef = useRef<HTMLDivElement>(null);
  let contextBytes: number | null;
  try {
    contextBytes = taskDraftContextBytes(
      fields,
      reviewedMetadata.packetVersion,
      reviewedMetadata.reviewedAt,
    );
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    contextBytes = null;
  }
  useEffect(() => {
    const field = Object.keys(fieldErrors)[0];
    if (field === undefined) return;
    const target = Array.from(
      editorRef.current?.querySelectorAll<HTMLElement>('[aria-invalid="true"]') ?? [],
    ).find((element) => element.id.endsWith(`-${field}`));
    for (
      let parent = target?.parentElement;
      parent && parent !== editorRef.current;
      parent = parent.parentElement
    ) {
      if (parent.tagName === "DETAILS") parent.setAttribute("open", "");
    }
    target?.focus({ preventScroll: true });
    target?.ownerDocument
      .getElementById(`${target.id}-error`)
      ?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [fieldErrors]);
  // The error mapper keeps the reason code in its message; that token is the only signal
  // the chooser under the goal field needs.
  const goalModeNeeded = c.error !== null && c.error.includes("(INVALID_GOAL)");
  useEffect(() => {
    if (!goalModeNeeded) return;
    const chooser = editorRef.current?.querySelector<HTMLElement>('[data-weavra="goal-mode"]');
    for (
      let parent = chooser?.parentElement;
      parent && parent !== editorRef.current;
      parent = parent.parentElement
    ) {
      if (parent.tagName === "DETAILS") parent.setAttribute("open", "");
    }
    chooser?.scrollIntoView({ block: "center", behavior: "instant" });
  }, [goalModeNeeded]);
  const id = useId();
  const preview = task.execution?.preview;
  const consentKey = `${task.id}:${task.revision}:${task.execution?.previewDigest ?? ""}`;
  const [consentContext, setConsentContext] = useState({ fresh: c.fresh, key: consentKey });
  if (consentContext.fresh !== c.fresh || consentContext.key !== consentKey) {
    setConsentContext({ fresh: c.fresh, key: consentKey });
    setConsent(null);
  }
  const [now, setNow] = useState(Date.now);
  const expiresAt = preview?.expiresAt;
  useEffect(() => {
    if (expiresAt === undefined) return;
    const delay = Math.max(0, expiresAt - Date.now());
    if (delay > 2147483647) return;
    const timer = setTimeout(() => setNow(Date.now()), delay + 1);
    return () => clearTimeout(timer);
  }, [expiresAt]);
  const reviewed = c.fresh && consent === consentKey;
  const editable =
    !task.execution?.confirmCommandId &&
    (task.phase === "analysis" ||
      task.phase === "preparing" ||
      task.phase === "awaiting-confirmation" ||
      task.phase === "handoff" ||
      task.phase === "attention-required");
  const disabled = !c.fresh || !c.canOperate || c.busy;
  const change = (next: TaskDraftFields) => {
    setFields(next);
    saveDraft(draftKey, next);
    setEdited(true);
    setConsent(null);
    setValidation(null);
    setFieldErrors({});
  };
  if (
    chatDraft &&
    chatDraft.messageId !== appliedCandidate &&
    !edited &&
    !task.execution?.confirmCommandId
  ) {
    const next = applyChatControlDraft(fields, chatDraft.draft);
    setAppliedCandidate(chatDraft.messageId);
    if (JSON.stringify(next) !== JSON.stringify(fields)) {
      setFields(next);
      setEdited(true);
      setConsent(null);
    }
  }
  useEffect(() => {
    if (edited && cached !== fields) saveDraft(draftKey, fields);
  }, [cached, fields, draftKey, saveDraft, edited]);
  const blocker = confirmAttempted
    ? "확인을 요청했어요. 같은 요청을 다시 보내지 말고 작업 상태를 새로고침해 주세요. 새 시도에는 새 스냅샷이 필요해요."
    : taskConfirmBlocker({ task, fresh: c.fresh, canOperate: c.canOperate, edited, reviewed, now });
  const prepare = async () => {
    if (!c.ref || disabled) return;
    const timestamp = Date.now();
    const packetVersion = (task.context?.packetVersion ?? 0) + 1;
    setReviewedMetadata({ packetVersion, reviewedAt: timestamp });
    setFieldErrors({});
    let draft: ReturnType<typeof buildTaskDraft>;
    try {
      const saved = chatDraft ? applyChatControlDraft(savedFields, chatDraft.draft) : savedFields;
      const effective = reuseControlDraft(fields, saved);
      draft = buildTaskDraft(effective, packetVersion, timestamp);
      setFields(effective);
      saveDraft(draftKey, effective);
    } catch (error) {
      if (error instanceof SyntaxError) {
        setFieldErrors({ sources: "올바른 소스 참조 JSON 배열을 입력해 주세요." });
      } else if (Schema.isSchemaError(error)) {
        setFieldErrors(
          Object.fromEntries(
            draftIssues(error.issue).issues.map((issue) => {
              const path =
                issue.path?.map((part) => (typeof part === "object" ? part.key : part)) ?? [];
              const field =
                path[0] === "context" && path[1] === "observations" && typeof path[2] === "number"
                  ? `finding-${path[2]}`
                  : (draftFieldByPath[path.slice(0, 2).map(String).join(".")] ??
                    draftFieldByPath[String(path[0])] ??
                    "symptom-criterion");
              return [field, issue.message];
            }),
          ),
        );
      } else {
        throw error;
      }
      setValidation(
        "초안을 확인해 주세요. 항목별 한도·소스 참조 JSON·수용 기준과 검사 연결을 확인해 주세요. 전체 참고 자료는 8 KiB 이내여야 해요. 내용을 자르거나 전송하지 않았어요.",
      );
      return;
    }
    const result = await c.act(
      task.execution || task.phase === "attention-required"
        ? {
            type: "reprepare",
            input: {
              task: c.ref,
              draft,
              expectedRevision: task.revision,
              commandId: CommandId.make(randomUUID()),
            },
          }
        : { type: "prepare", input: { task: c.ref, draft, expectedRevision: task.revision } },
    );
    if (result) {
      setEdited(false);
      setConsent(null);
    }
  };
  const confirm = () => {
    if (confirmAttempted || c.busy) return;
    const reason = taskConfirmBlocker({
      task,
      fresh: c.fresh,
      canOperate: c.canOperate,
      edited,
      reviewed,
      now: Date.now(),
    });
    if (reason || !c.ref) {
      setValidation(reason);
      return;
    }
    setConsent(null);
    setConfirmAttempted(true);
    void c.act({
      type: "confirm",
      input: {
        task: c.ref,
        commandId: CommandId.make(randomUUID()),
        expectedRevision: task.revision,
      },
    });
  };
  return (
    <div ref={editorRef} className="mt-4 space-y-4">
      <TaskIdentity task={task} fresh={c.fresh} />
      {task.phase === "analysis" ? (
        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            조사: Codex 읽기 전용 | 네트워크 차단 | 권한 확대 없음
          </p>
          <p className="mt-1">
            {props.analysisSupported && props.provider === "codex"
              ? "메시지 입력창으로 조사하거나, 모델 호출 없이 직접 검토한 초안을 준비할 수 있어요."
              : "선택한 기능·프로바이더로는 읽기 전용 조사를 사용할 수 없어요. 프로바이더를 바꾸지 않으며, 직접 검토한 초안은 준비할 수 있어요."}
          </p>
          <p className="mt-1">
            프로필·활성 MCP·지원하지 않는 옵션·검증되지 않은 저장 세션 재개는 거부해요. 제한 없는
            실행으로 전환하지 않아요.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          메시지는 후속 기록으로만 저장돼요. Runtime에 지시하거나 프로바이더·다음 Run을 시작하지
          않아요.
        </p>
      )}
      {preview ? <TaskPreview task={task} /> : null}
      {editable && previous && !preview ? (
        <p className="text-xs text-muted-foreground" data-weavra="saved-control-history">
          빈 항목은 이 대화에 저장된 이전 목표와 수용 기준을 재사용해요. 출처나 실행 승인은 자동으로
          옮기지 않아요.
        </p>
      ) : null}
      {editable && chatDraft ? (
        <div
          className="space-y-2 text-xs text-muted-foreground"
          data-weavra="chat-control-candidate"
        >
          <p>
            채팅에서 작성한 AI 초안이에요. 저장된 내용과 직접 수정한 값은 보존하며, 이 초안은 실행
            승인이 아니에요.
          </p>
          {chatDraft.messageId !== appliedCandidate ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              data-weavra-action="apply-chat-control"
              disabled={disabled}
              onClick={() => {
                change(applyChatControlDraft(fields, chatDraft.draft));
                setAppliedCandidate(chatDraft.messageId);
              }}
            >
              채팅 제안으로 채우기
            </Button>
          ) : null}
        </div>
      ) : null}
      {editable ? (
        <details open={!preview} className="min-w-0">
          <summary className="cursor-pointer font-medium">
            구현에 넘길 참고 자료 검토 {edited ? "- 변경됐어요. 다시 준비해 주세요" : ""}
          </summary>
          <fieldset disabled={disabled} className="mt-4 min-w-0 space-y-4 disabled:opacity-60">
            <DraftFields
              fields={fields}
              change={change}
              messages={props.messages}
              task={task}
              id={id}
              errors={fieldErrors}
              contextBytes={contextBytes}
              bindingAvailable={
                c.fresh && preview !== null && preview !== undefined && preview.expiresAt > now
              }
              goalModeReprepare={goalModeNeeded ? () => void prepare() : null}
            />
          </fieldset>
        </details>
      ) : null}
      {task.execution?.confirmCommandId != null ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            복구는 이 작업의 Runtime 소유 프로세스가 종료됐는지 확인해요. 구현을 다시 시작하거나
            변경을 되돌리지 않아요. 일부 변경과 실패한 검사는 보존하며, 정리가 확인되지 않으면
            checkout 보호를 유지해요.
          </p>
          {!c.recoverySupported ? <p>이 환경은 작업 복구 지원을 제공하지 않아요.</p> : null}
          {task.execution.receipt?.status === "FOUND" &&
          task.execution.receipt.admission.cleanup === "UNCONFIRMED" &&
          task.phase === "attention-required" ? (
            <p role="status">
              {task.execution.receipt.run?.status === "INTERRUPTED" ||
              task.execution.receipt.admission.outcome.status === "INTERRUPTED_BEFORE_START"
                ? "중단을 기록했어요. "
                : null}
              정리가 확인되지 않아 checkout 보호를 유지해요.
            </p>
          ) : null}
        </div>
      ) : null}
      {validation ? (
        <p role="alert" className="text-sm text-destructive">
          {validation}
        </p>
      ) : null}
      {editable && preview && !edited ? (
        <div className="space-y-3">
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={reviewed}
              disabled={disabled}
              onChange={(event) => setConsent(event.target.checked ? consentKey : null)}
            />
            대상 checkout·모델·허용 경로·등록 검사·수용 기준을 검토했어요. 이 확인은 파괴적 작업의
            승인이 아니에요.
          </label>
          {blocker ? <p className="text-xs text-muted-foreground">{blocker}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {editable ? (
          preview && !edited && task.phase === "awaiting-confirmation" ? (
            <>
              <Button
                type="button"
                data-weavra-action="confirm-implementation"
                disabled={disabled || blocker !== null}
                onClick={confirm}
              >
                Runtime 구현 확인
              </Button>
              <Button
                type="button"
                variant="outline"
                data-weavra-action="prepare-new-snapshot"
                disabled={disabled}
                onClick={() => void prepare()}
              >
                새 스냅샷 준비
              </Button>
            </>
          ) : (
            <Button
              type="button"
              data-weavra-action="prepare-handoff"
              disabled={disabled}
              onClick={() => void prepare()}
            >
              {c.busy ? "준비하고 있어요..." : "검토한 내용으로 구현 준비"}
            </Button>
          )
        ) : null}
        {c.ref ? (
          <Button
            type="button"
            variant="outline"
            data-weavra-action="refresh-task-state"
            disabled={!props.connected || !props.supported || !c.canOperate || c.busy}
            onClick={() => {
              if (!c.ref) return;
              setConsent(null);
              void c.act({ type: "reconcile", input: c.ref });
            }}
          >
            작업 상태 새로고침
          </Button>
        ) : null}
        {task.execution?.confirmCommandId != null && c.ref ? (
          <Button
            type="button"
            variant="outline"
            data-weavra-action="recover-interrupted-task"
            disabled={disabled || !props.connected || !props.supported || !c.recoverySupported}
            onClick={() => {
              if (
                !c.ref ||
                disabled ||
                !props.connected ||
                !props.supported ||
                !c.recoverySupported
              )
                return;
              void c.act({
                type: "recover",
                input: { task: c.ref, expectedRevision: task.revision },
              });
            }}
          >
            중단된 작업 복구 확인
          </Button>
        ) : null}
        {editable && c.ref ? (
          <Button
            type="button"
            variant="ghost"
            data-weavra-action="stop-controlled-task"
            disabled={disabled}
            onClick={() => {
              if (!c.ref) return;
              void c.act({
                type: "abort",
                input: { task: c.ref, expectedRevision: task.revision },
              });
            }}
          >
            통제 작업 중단
          </Button>
        ) : null}
      </div>
      {c.busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          서버 응답을 기다리고 있어요...
        </p>
      ) : null}
    </div>
  );
}
