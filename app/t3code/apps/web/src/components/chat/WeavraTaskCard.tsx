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
import { ko } from "~/i18n/ko";
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
const cardCopy = ko.runtime.task.card;
const draftIssues = SchemaIssue.makeFormatterStandardSchemaV1({
  leafHook: () => cardCopy.fieldLimitHint,
  checkHook: () => cardCopy.fieldLimitHint,
});
// A goal the Runtime rejects as ambiguous (INVALID_GOAL) is re-prepared with one of these
// visible leading tags. The mode is never inferred from untagged text.
const goalModes = [
  { mode: "read-only", tag: cardCopy.goalTagReadOnly, label: cardCopy.goalModeReadOnly },
  { mode: "edit", tag: cardCopy.goalTagEdit, label: cardCopy.goalModeEdit },
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
    ? cardCopy.reconnect
    : !props.supported
      ? cardCopy.unsupported
      : !c.canOperate
        ? cardCopy.permissionRequired("orchestration:operate")
        : !c.discovered
          ? cardCopy.loading
          : (props.entryBlockedReason ?? null);
  return (
    <section
      aria-label={cardCopy.aria}
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
          <Badge variant="secondary">{cardCopy.badge}</Badge>
          <h3 className="font-medium">{cardCopy.title}</h3>
        </div>
        {c.task ? <Badge variant="outline">{weavraLabel(c.task.phase)}</Badge> : null}
      </div>
      <p className="mt-3 text-muted-foreground">{cardCopy.intro(weavraLabel("STANDARD"))}</p>
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
          {cardCopy.baselineCommitted(baselineHead.slice(0, 12))}
        </p>
      ) : null}
      {!c.discovered && props.connected && props.supported ? (
        <Button type="button" variant="outline" className="mt-3" onClick={c.refresh}>
          {cardCopy.reloadTask}
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
          <p className="text-muted-foreground">{cardCopy.checkoutNote}</p>
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
            {c.busy ? cardCopy.creating : cardCopy.start}
          </Button>
          {c.task?.execution?.confirmCommandId != null ? (
            c.route === "free" ? (
              <p className="text-xs text-muted-foreground">{cardCopy.freeChosen}</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">{cardCopy.followupNote}</p>
                <Button
                  type="button"
                  variant="outline"
                  data-weavra-action="return-to-free-coding"
                  disabled={reason !== null || !c.fresh || c.busy}
                  onClick={c.chooseFreeCoding}
                >
                  {cardCopy.returnToFree}
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
      <p className="font-medium">{cardCopy.dirtyCount(details.files.length)}</p>
      {fileList}
      {details.truncated ? (
        <p className="text-xs text-muted-foreground" data-weavra="dirty-workspace-truncated">
          {cardCopy.dirtyTruncated} {cardCopy.dirtyFixBefore}
          <code>git status</code>
          {cardCopy.dirtyFixAfter}
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
          {cardCopy.includeInBaseline}
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
          {cardCopy.copyFileList}
        </Button>
      </div>
      {copy ? (
        <p className="text-xs text-muted-foreground" role="status">
          {copy === "copied" ? cardCopy.fileListCopied : cardCopy.fileListCopyFailed}
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
            {cardCopy.baselineConfirmTitle}
          </p>
          <p className="text-xs text-muted-foreground">{cardCopy.baselineConfirmDescription}</p>
          {fileList}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-weavra-action="confirm-dirty-baseline"
              disabled={disabled}
              onClick={() => void commit()}
            >
              {cardCopy.commit}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-weavra-action="cancel-dirty-baseline"
              onClick={() => setConfirming(false)}
            >
              {ko.common.cancel}
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
      <p className="text-xs text-muted-foreground">{cardCopy.draftIntro}</p>
      <output
        id={`${id}-context`}
        tabIndex={-1}
        aria-label={cardCopy.contextSizeAria}
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
        {cardCopy.contextSize(
          contextBytes === null ? cardCopy.unavailable : String(contextBytes),
          WEAVRA_ANALYSIS_CONTEXT_MAX_BYTES,
        )}
        {contextBytes === null ? cardCopy.contextSizeUnknown : ""}
      </output>
      <DraftFieldError id={id} field="context" errors={errors} />
      {(
        [
          ["goal", cardCopy.goalLabel, 2048, cardCopy.goalHelp],
          ["symptom", cardCopy.symptomLabel, 1000, cardCopy.symptomHelp],
          ["hypothesis", cardCopy.hypothesisLabel, 1000, cardCopy.hypothesisHelp],
          ["uncertainties", cardCopy.uncertaintiesLabel, 2007, cardCopy.uncertaintiesHelp],
          ["constraints", cardCopy.constraintsLabel, 2007, cardCopy.constraintsHelp],
          ["criteria", cardCopy.criteriaLabel, 8015, cardCopy.criteriaHelp],
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
        <h4 className="font-medium">{cardCopy.selectedFindings(fields.observations.length)}</h4>
        {fields.observations.map((finding, index) => (
          <div key={findingKeys[index]} className="space-y-1.5 rounded-lg bg-muted/50 p-3">
            <label htmlFor={`${id}-finding-${index}`} className="block text-xs">
              {cardCopy.findingLabel(
                index + 1,
                weavraLabel(finding.provenance),
                finding.reference.kind === "message"
                  ? finding.reference.messageId
                  : finding.reference.path,
              )}
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
              {cardCopy.removeFinding(index + 1)}
            </Button>
          </div>
        ))}
        <label htmlFor={`${id}-message`} className="block text-xs font-medium">
          {cardCopy.chooseMessage}
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
          <option value="">{cardCopy.messagePlaceholder}</option>
          {visible.map(({ message, preview }) => (
            <option key={message.id} value={message.id}>
              {weavraLabel(message.role)} | {preview}
            </option>
          ))}
        </select>
        {selected ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer" data-weavra="read-selected-message">
              {cardCopy.readSelectedMessage}
            </summary>
            <p className="mt-2 font-mono">
              {weavraLabel(selected.role)} | {selected.id}
            </p>
            <p className="mt-2 whitespace-pre-wrap">{selected.text}</p>
          </details>
        ) : null}
        <label htmlFor={`${id}-excerpt`} className="block text-xs">
          {cardCopy.excerptLabel}
        </label>
        <Textarea
          id={`${id}-excerpt`}
          maxLength={500}
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">{cardCopy.excerptHelp}</p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-weavra-action="include-selected-finding"
          disabled={!selected || !excerpt.trim() || fields.observations.length >= 8}
          onClick={() => {
            if (!selected || (selected.role !== "user" && selected.role !== "assistant")) return;
            if (!selected.text.includes(excerpt)) {
              setSelectionError(cardCopy.excerptMismatch);
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
              setSelectionError(cardCopy.excerptInvalid);
            }
          }}
        >
          {cardCopy.includeFinding}
        </Button>
        {selectionError ? (
          <p role="alert" className="text-xs text-destructive">
            {selectionError}
          </p>
        ) : null}
      </div>
      <details className="min-w-0 space-y-3">
        <summary className="cursor-pointer font-medium">{cardCopy.advanced}</summary>
        <label htmlFor={`${id}-sources`} className="block text-xs font-medium">
          {cardCopy.sourcesLabel}
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
        <p className="text-xs text-muted-foreground">{cardCopy.sourcesHelp}</p>
        <label htmlFor={`${id}-symptom-criterion`} className="block text-xs font-medium">
          {cardCopy.symptomCriterionLabel}
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
          <option value="">{cardCopy.notLinked}</option>
          {bindingOptionsAvailable &&
            preview?.acceptanceCriteria.map((criterion, index) => (
              <option key={criterion.id} value={String(index + 1)}>
                {criterion.id}: {criterion.statement}
              </option>
            ))}
        </select>
        <DraftFieldError id={id} field="symptom-criterion" errors={errors} />
        <label htmlFor={`${id}-symptom-check`} className="block text-xs font-medium">
          {cardCopy.symptomCheckLabel}
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
          <option value="">{cardCopy.notLinked}</option>
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
            {cardCopy.bindingUnavailable}
          </p>
        ) : null}
        {!fields.symptomCriterion || !fields.symptomCheck ? (
          <p className="text-xs text-muted-foreground" role="status">
            {cardCopy.bindingMissing}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{cardCopy.bindingHelp}</p>
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
        {cardCopy.goalModeQuestion}
      </p>
      <p className="text-xs text-muted-foreground">{cardCopy.goalModeHelp}</p>
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
        {cardCopy.reprepare}
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
        {cardCopy.preparedSnapshot(
          weavraLabel(preview.workflow),
          weavraLabel(preview.executionMode),
          preview.risk,
        )}
      </h4>
      <p>{preview.goal}</p>
      <dl className="space-y-2 text-xs">
        <div>
          <dt className="font-medium">{cardCopy.targetCheckout}</dt>
          <dd className="font-mono">
            {preview.taskBinding.checkout.canonicalCwd}
            <br />
            {preview.taskBinding.checkout.headCommit}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{cardCopy.modelRoutes}</dt>
          <dd>
            {preview.modelRoutes
              ? preview.modelRoutes.map((route) => (
                  <p key={route.role}>
                    {weavraLabel(route.role)}: {route.provider} / {route.model} | {route.profile} |{" "}
                    {weavraLabel(route.intent)} | {weavraLabel(route.source)}
                  </p>
                ))
              : cardCopy.modelRoutesUnknown}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{cardCopy.allowedPaths}</dt>
          <dd>
            {preview.allowedPaths.length
              ? preview.allowedPaths.map((path) => (
                  <p key={path} className="font-mono">
                    {path}
                  </p>
                ))
              : ko.common.none}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{cardCopy.hostChecks}</dt>
          <dd>
            {preview.checks.map((check) => (
              <p key={check.id}>
                {check.id} | {weavraLabel(check.kind)} |{" "}
                {check.required ? cardCopy.required : cardCopy.optional}
              </p>
            ))}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{cardCopy.criteria}</dt>
          <dd className="space-y-2">
            {preview.acceptanceCriteria.map((criterion) => (
              <div key={criterion.id}>
                <p>
                  {criterion.id}: {criterion.statement}
                </p>
                <p className="text-muted-foreground">
                  {cardCopy.criterionChecks(
                    criterion.checkIds.join(", ") || ko.common.none,
                    criterion.reviewRequired,
                  )}
                </p>
              </div>
            ))}
          </dd>
        </div>
        <div>
          <dt className="font-medium">{cardCopy.symptomBinding}</dt>
          <dd>
            {preview.taskBinding.symptomVerification
              ? `${preview.taskBinding.symptomVerification.criterionId} / ${preview.taskBinding.symptomVerification.checkId} / ${preview.taskBinding.symptomVerification.registrationDigest}`
              : cardCopy.noSymptomBinding}
          </dd>
        </div>
      </dl>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">{cardCopy.snapshotIdentity}</summary>
        <dl className="mt-2 space-y-2 font-mono">
          <div>
            <dt>{cardCopy.executionContext}</dt>
            <dd>
              {preview.taskBinding.executionId} / {preview.taskBinding.packetVersion}
            </dd>
          </div>
          <div>
            <dt>{cardCopy.digests}</dt>
            <dd>
              {preview.previewDigest}
              <br />
              {preview.configDigest}
              <br />
              {preview.taskBinding.advisoryDigest}
            </dd>
          </div>
          <div>
            <dt>{cardCopy.workspaceDigest}</dt>
            <dd>{preview.taskBinding.checkout.workspaceDigest}</dd>
          </div>
          <div>
            <dt>{cardCopy.projectRevisionExpiry}</dt>
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
        {fresh ? cardCopy.currentObservation : cardCopy.staleObservation}: {taskStatus(task)}
      </p>
      <details className="min-w-0">
        <summary className="cursor-pointer">{cardCopy.diagnostics}</summary>
        <dl className="mt-2 grid min-w-0 gap-1">
          <div>
            <dt className="inline font-medium">{cardCopy.checkoutLabel}</dt>
            <dd className="inline font-mono">{task.checkout.canonicalCwd}</dd>
          </div>
          <div>
            <dt className="inline font-medium">HEAD: </dt>
            <dd className="inline font-mono">{task.checkout.headCommit}</dd>
          </div>
          <div>
            <dt className="inline font-medium">{cardCopy.taskLabel}</dt>
            <dd className="inline font-mono">
              {cardCopy.taskValue(task.id, task.revision, weavraLabel(task.ownership.state))}
            </dd>
          </div>
          {task.execution ? (
            <div>
              <dt className="inline font-medium">{cardCopy.executionLabel}</dt>
              <dd className="inline font-mono">{task.execution.binding.executionId}</dd>
            </div>
          ) : null}
          {receipt?.status === "FOUND" && receipt.run ? (
            <div>
              <dt className="inline font-medium">{cardCopy.runLabel}</dt>
              <dd className="inline font-mono">
                {cardCopy.runValue(receipt.run.runId, receipt.run.revision)}
              </dd>
            </div>
          ) : null}
        </dl>
      </details>
      <p>{cardCopy.notVerdict}</p>
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
    ? cardCopy.confirmRequested
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
        setFieldErrors({ sources: cardCopy.invalidSources });
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
      setValidation(cardCopy.draftInvalid);
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
          <p className="font-medium text-foreground">{cardCopy.analysisMode}</p>
          <p className="mt-1">
            {props.analysisSupported && props.provider === "codex"
              ? cardCopy.analysisAvailable
              : cardCopy.analysisUnavailable}
          </p>
          <p className="mt-1">{cardCopy.analysisRefusals}</p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{cardCopy.followupOnly}</p>
      )}
      {preview ? <TaskPreview task={task} /> : null}
      {editable && previous && !preview ? (
        <p className="text-xs text-muted-foreground" data-weavra="saved-control-history">
          {cardCopy.savedHistory}
        </p>
      ) : null}
      {editable && chatDraft ? (
        <div
          className="space-y-2 text-xs text-muted-foreground"
          data-weavra="chat-control-candidate"
        >
          <p>{cardCopy.chatCandidate}</p>
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
              {cardCopy.applyChatDraft}
            </Button>
          ) : null}
        </div>
      ) : null}
      {editable ? (
        <details open={!preview} className="min-w-0">
          <summary className="cursor-pointer font-medium">
            {cardCopy.reviewHandoff} {edited ? cardCopy.reviewHandoffEdited : ""}
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
          <p>{cardCopy.recoveryNote}</p>
          {!c.recoverySupported ? <p>{cardCopy.recoveryUnsupported}</p> : null}
          {task.execution.receipt?.status === "FOUND" &&
          task.execution.receipt.admission.cleanup === "UNCONFIRMED" &&
          task.phase === "attention-required" ? (
            <p role="status">
              {task.execution.receipt.run?.status === "INTERRUPTED" ||
              task.execution.receipt.admission.outcome.status === "INTERRUPTED_BEFORE_START"
                ? cardCopy.interruptionRecorded
                : null}
              {cardCopy.cleanupUnconfirmed}
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
            {cardCopy.consent}
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
                {cardCopy.confirmImplementation}
              </Button>
              <Button
                type="button"
                variant="outline"
                data-weavra-action="prepare-new-snapshot"
                disabled={disabled}
                onClick={() => void prepare()}
              >
                {cardCopy.prepareSnapshot}
              </Button>
            </>
          ) : (
            <Button
              type="button"
              data-weavra-action="prepare-handoff"
              disabled={disabled}
              onClick={() => void prepare()}
            >
              {c.busy ? cardCopy.preparing : cardCopy.prepareHandoff}
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
            {cardCopy.refreshTask}
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
            {cardCopy.recoverTask}
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
            {cardCopy.stopTask}
          </Button>
        ) : null}
      </div>
      {c.busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          {cardCopy.waiting}
        </p>
      ) : null}
    </div>
  );
}
