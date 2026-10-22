import { ko } from "~/i18n/ko";
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
const copy = ko.runtime.task.result;
const categories = [
  { id: "criteria", label: copy.categories.criteria },
  { id: "checks", label: copy.categories.checks },
  { id: "changed-files", label: copy.categories.changedFiles },
  { id: "trust-sources", label: copy.categories.trustSources },
] as const;
const verificationReasons: Record<
  Extract<IssueVerification, { status: "unverified" }>["reason"],
  string
> = copy.verificationReasons;
const nextActionGuidance: Record<TaskResultNextAction | "inspect-history", string> =
  copy.nextActions;
const failureGuidance = copy.failureGuidance;

type CheckRecord = Extract<WeavraEvidenceRecord, { category: "checks" }>;
type CriterionRecord = Extract<WeavraEvidenceRecord, { category: "criteria" }>;
type ChangedFileRecord = Extract<WeavraEvidenceRecord, { category: "changed-files" }>;
const draftCategories = ["criteria", "checks", "changed-files"] as const;
const runDiffRefusals: Partial<Record<string, string>> = copy.runDiffRefusals;
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
    if (unavailable) return [copy.draft.unavailable(unavailable.reason)];
    return state?.complete.includes(category) ? [] : [copy.draft.partial];
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
    copy.draft.goalHeading,
    task.execution?.preview?.goal ?? copy.draft.noGoal,
    "",
    copy.draft.criteriaHeading,
    ...criteria.map((record) => `- ${record.status} \`${record.id}\` ${record.statement}`),
    ...(criteria.length === 0 ? [copy.draft.noRecordItem] : []),
    ...coverage("criteria"),
    "",
    copy.draft.checksHeading,
    copy.draft.checksTableHeader,
    "| --- | --- | --- |",
    ...checks.map(
      (record) =>
        `| \`${cell(record.id)}\` | ${record.exitCode ?? ko.common.none} | ${record.status}${record.required ? "" : copy.draft.optionalSuffix} |`,
    ),
    ...coverage("checks"),
    "",
    copy.draft.reviewHeading,
    review
      ? copy.draft.review(
          review.result,
          weavraLabel(review.independent),
          review.revision,
          review.criteriaCount,
        )
      : copy.draft.noReview,
    "",
    copy.draft.filesHeading,
    ...files.map((record) => `- \`${record.path}\``),
    ...(files.length === 0 ? [copy.draft.noRecordItem] : []),
    ...coverage("changed-files"),
    "",
    "---",
    `${copy.draft.footer(run.runId, run.revision)}${state ? copy.draft.footerEvidence(state.latest.codeRevision, state.latest.snapshot.diffDigest) : ""}`,
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
const failureTitles: Record<FailureKind, string> = copy.failureTitles;
const failureCodes = {
  BLOCKED: "RUN_BLOCKED",
  FAILED: "RUN_FAILED",
  INTERRUPTED: "RUN_INTERRUPTED",
  CANCELLED: "RUN_CANCELLED",
} as const;
const isFailedStatus = (status: string): status is keyof typeof failureCodes =>
  status in failureCodes;
const recordStatus = (value: string | undefined) =>
  value === undefined ? copy.unavailable : weavraLabel(value);
// Criterion records say UNMET where the shared labels only know NOT_MET.
const criterionLabel = (status: CriterionRecord["status"]) =>
  status === "UNMET" ? copy.unmet : weavraLabel(status);
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
        reason: copy.checkFailureReason(failed.id, String(failed.exitCode ?? ko.common.none)),
        detail: copy.checkFailureDetail(
          weavraLabel(failed.kind),
          failed.required,
          failed.step,
          String(failed.attempt ?? ko.common.unknown),
          failed.revision,
          failedOutput !== "",
        ),
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
      reason: copy.policyReason(
        denied.id,
        denied.required,
        denied.step,
        String(denied.attempt ?? ko.common.unknown),
        recordStatus(denied.trust?.status),
        recordStatus(denied.sandbox?.status),
      ),
      detail: copy.policyDetail,
      refs: denied.evidenceRefs,
      criteria: [],
      target: { category: "checks", index: denied.index },
    };
  if (checkFailure) return checkFailure;
  if (review?.result === "REVISE" || review?.result === "BLOCK") {
    const kind = review.result === "REVISE" ? "revise" : "review-block";
    const reviewer = review.independent ? copy.independentReviewer : copy.unprovenReviewer;
    const outcome = kind === "revise" ? copy.reviseOutcome : copy.blockOutcome;
    const breakdown =
      criteria.length > 0
        ? copy.breakdownUnmet(criteria.length)
        : state?.complete.includes("criteria")
          ? copy.breakdownAllMet
          : copy.breakdownLoad;
    const first = criteria[0];
    return {
      kind,
      tone: kind === "revise" ? "warning" : "destructive",
      code,
      reason: copy.reviewReason(
        reviewer,
        outcome,
        review.revision,
        review.criteriaCount,
        breakdown,
      ),
      detail: review.reviseSummary
        ? copy.reviseSummary(review.reviseSummary)
        : copy.reviewOpinionMissing,
      refs: [],
      criteria,
      target: first ? { category: "criteria", index: first.index } : null,
    };
  }
  const last = checks.at(-1);
  const target = last ? { category: "checks" as const, index: last.index } : null;
  const cause = state ? copy.causeLoaded : copy.causeNotLoaded;
  switch (status) {
    case "BLOCKED":
      return {
        kind: "blocked",
        tone: "destructive",
        code,
        reason: copy.blockedReason(code, cause),
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
        reason: copy.failedReason(code, cause),
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
        reason: copy.interruptedReason(
          code,
          weavraLabel(receipt.admission.cleanup ?? "UNCONFIRMED"),
        ),
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
        reason: copy.cancelledReason(code),
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
    copy.revisionNote(runId, failure.kind === "revise" ? "REVISE" : "BLOCK"),
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
        {copy.historyLabel}
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
        {!selected ? <option value="">{copy.resultMissingOption}</option> : null}
        {results.map((task) => (
          <option key={task.id} value={task.id}>
            {task.createdAt.slice(0, 16)} | {taskStatus(task)}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        {copy.historyNote}
        {!active ? copy.historicalNote : ""}
      </p>
      {selected ? (
        <div
          id={`${prefix}${selected.id}`}
          ref={target}
          tabIndex={-1}
          className="min-w-0 focus:outline-none"
        >
          <details className="mb-2 text-xs">
            <summary className="cursor-pointer">{copy.taskIdentity}</summary>
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
          {copy.taskNotFound}
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
        setError(copy.approvalUnverified);
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
      aria-label={copy.controlsAria}
      className="min-w-0 space-y-3 border-t border-border/70 pt-3"
    >
      <p className="text-xs text-muted-foreground">{copy.controlsNote}</p>
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
          {copy.cancelRun}
        </Button>
        {run.status === "WAITING_APPROVAL" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!connected || !c.fresh || c.busy || loading}
            onClick={() => void inspect()}
          >
            {loading ? copy.loadingApproval : copy.inspectApproval}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {loaded && approval === null ? <p className="text-xs">{copy.noApproval}</p> : null}
      {approval ? (
        <div className="space-y-3 rounded-lg border border-warning/50 p-3 text-sm [overflow-wrap:anywhere]">
          <h5 className="font-medium">{copy.approvalTitle}</h5>
          <p>{approval.explanation}</p>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {[
              [copy.approvalTarget, approval.path],
              [copy.approvalRun, approval.runId],
              [copy.approvalId, approval.approvalId],
              [copy.approvalOperation, `${approval.operation} / ${approval.role}`],
              [copy.approvalStep, `${approval.step.stepId}@${approval.step.attempt}`],
              [copy.approvalRevision, `${approval.stateRevision} / ${approval.projectRevision}`],
              [copy.approvalBytes, String(approval.bytes)],
              [copy.approvalFingerprint, approval.preconditionDigest],
              [copy.approvalExpires, new Date(approval.expiresAt).toLocaleString()],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">{copy.approvalScope}</p>
          {!approvalCurrent ? (
            <p role="status" className="text-xs">
              {copy.approvalStale}
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
              {copy.rejectDelete}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled || !approvalCurrent}
              onClick={() => decide("approve")}
            >
              {copy.approveDeleteOnce}
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
      ? copy.noTokens
      : copy.reportedTokens(reportedTokens.toLocaleString("ko-KR"));
  return (
    <p data-weavra="task-run-usage" className="text-xs text-muted-foreground">
      {copy.usage(tokens, weavraLabel(toolCalls), weavraLabel(count))}
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
      aria-label={copy.resultAria}
      data-weavra="controlled-outcome"
      data-weavra-result="goal-plan-result"
      data-weavra-start-failure={startFailure ?? undefined}
      className="min-w-0 space-y-4 border-t border-border/70 pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">{copy.resultTitle}</h4>
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
            <strong>{copy.goal}</strong> {task.execution.preview.goal}
          </p>
        ) : null}
        <p>
          <strong>{copy.plan}</strong>{" "}
          {task.execution?.preview
            ? copy.planSummary(
                task.execution.preview.acceptanceCriteria.length,
                task.execution.preview.checks.filter((check) => check.required).length,
              )
            : copy.noPlan}
        </p>
        <p>
          <strong>{copy.result}</strong>{" "}
          {failure?.status ??
            weavraLabel(
              run?.status ??
                (receipt?.status === "FOUND" ? receipt.admission.outcome.status : "UNCONFIRMED"),
            )}
          {startFailure ? ` (${startFailure})` : ""}
          {run?.status === "COMPLETED" ? copy.runtimeCompleted : ""}
        </p>
        <p role="status" data-next-action={nextAction} data-weavra-action="task-result-next-action">
          <strong>{copy.nextStep}</strong>{" "}
          {nextAction === "none" && startFailure
            ? startFailure === "MODEL_UNAVAILABLE"
              ? copy.modelUnavailable
              : copy.preflightFailed
            : nextAction === "none" && failure
              ? failure.action
              : nextActionGuidance[nextAction]}
        </p>
        <p className="text-xs text-muted-foreground">
          {fresh ? copy.freshResult : copy.staleResult} {copy.notCompletionEvidence}
        </p>
      </div>
      <details className="min-w-0 text-xs">
        <summary className="cursor-pointer font-medium">{copy.diagnostics}</summary>
        <div className="mt-2 space-y-2 text-muted-foreground">
          <p>
            {copy.ownershipCleanup(
              weavraLabel(task.ownership.state),
              receipt?.status === "FOUND"
                ? weavraLabel(receipt.admission.cleanup ?? "UNCONFIRMED")
                : ko.common.unknown,
            )}
          </p>
          <p data-weavra-outcome-freshness={fresh ? "fresh" : "historical"}>
            {fresh ? copy.officialFresh : copy.officialStale}
          </p>
        </div>
      </details>
      <details className="min-w-0 text-xs">
        <summary className="cursor-pointer font-medium">{copy.reviewedContext}</summary>
        {task.context ? (
          <div className="mt-3 space-y-3 [overflow-wrap:anywhere]">
            <p>
              <strong>{copy.symptom}</strong> {task.context.symptom}
            </p>
            <p>
              <strong>{copy.hypothesis}</strong>{" "}
              {task.context.candidateCause?.text ?? copy.noRecord}
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
              <strong>{copy.uncertainties}</strong>{" "}
              {task.context.uncertainties.join("; ") || copy.noRecord}
            </p>
            <p>
              <strong>{copy.constraints}</strong>{" "}
              {task.context.constraints.join("; ") || copy.noRecord}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-muted-foreground">{copy.contextUnavailable}</p>
        )}
      </details>
      {!receipt ? (
        <p className="text-sm text-muted-foreground">{copy.noAdmission}</p>
      ) : receipt.status === "UNKNOWN" ? (
        <p className="text-sm text-muted-foreground">{copy.admissionUnknown}</p>
      ) : run === null ? (
        <div className="space-y-3">
          <p className="text-sm">
            {receipt.admission.outcome.status === "START_FAILED"
              ? copy.startFailed(receipt.admission.outcome.reasonCode)
              : receipt.admission.outcome.status === "INTERRUPTED_BEFORE_START"
                ? copy.interruptedBeforeStart
                : copy.admittedPending}
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
        {copy.refreshResult}
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
            setError(copy.evidenceUnavailable(code));
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
            setError(copy.pageMismatch(next.code));
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
      toastManager.add({ type: "success", title: copy.draftCopied });
    } catch {
      toastManager.add({ type: "error", title: copy.draftCopyFailed });
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
      setNote(created ? copy.reprepared : copy.reprepareFailed);
    } finally {
      setRepreparing(false);
    }
  };
  return (
    <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
      {failure ? (
        <section
          aria-label={copy.failureAria}
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
              {copy.outputRefs(failure.refs.join(" | "))}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            {failure.kind === "policy" ? (
              <Button
                type="button"
                size="sm"
                data-weavra-action="fix-checks-in-settings"
                onClick={() =>
                  setNote(openProjectSetup() ? copy.settingsOpened : copy.settingsMissing)
                }
              >
                {copy.fixChecks}
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
                {repreparing ? copy.repreparing : copy.reprepare}
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
              {copy.showEvidence}
            </Button>
          </div>
          {failure.kind === "revise" && !onReprepare ? (
            <p className="text-xs text-muted-foreground">{copy.reprepareUnavailable}</p>
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
          aria-label={copy.completedAria}
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
              {copy.showDiff}
            </Button>
            <Button
              type="button"
              size="sm"
              data-weavra-action="copy-pr-draft"
              disabled={busy || (!draftLoaded && (!fresh || !connected))}
              onClick={() => copyDraft()}
            >
              {copy.copyDraft}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{copy.draftNote}</p>
          {diffShown ? (
            <div aria-label={copy.runDiffAria} data-weavra="run-diff" className="space-y-2">
              <p className="text-xs text-muted-foreground">{copy.runDiffScope}</p>
              {runDiffUnavailable ? (
                <p role="status" data-weavra="run-diff-refused" className="text-xs">
                  {runDiffRefusals[runDiffUnavailable.reason] ?? copy.runDiffUnknown}{" "}
                  <span className="font-mono">{runDiffUnavailable.reason}</span>
                </p>
              ) : runDiffRecords.length > 0 ? (
                <WeavraRunDiff records={runDiffRecords} />
              ) : runDiffComplete ? (
                <p className="text-xs text-muted-foreground">{copy.runDiffEmpty}</p>
              ) : busy ? (
                <p className="text-xs text-muted-foreground">{copy.runDiffLoading}</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer">{copy.runIdentity}</summary>
        <p className="mt-2 font-mono [overflow-wrap:anywhere]">
          {copy.runIdentityValue(String(run?.runId), String(run?.revision))}
        </p>
      </details>
      <div
        role="status"
        data-issue-verification={verification.status}
        className="rounded-lg bg-muted/40 p-3 text-sm"
      >
        <p className="font-medium">
          {verification.status === "verified" ? copy.verified : copy.unverified}
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
            {current ? copy.snapshotCurrent : copy.snapshotStale} |{" "}
            {weavraLabel(state.latest.source)} | {copy.codeRevision(state.latest.codeRevision)}
          </p>
          <p className="font-mono">{copy.diffDigest(state.latest.snapshot.diffDigest)}</p>
          <p>
            {copy.changedLines(String(state.latest.changedLines ?? copy.unavailable))} |{" "}
            {copy.cleanup} {weavraLabel(state.latest.ownership.cleanup)}
          </p>
          <p>
            {copy.independentReview}{" "}
            {state.latest.review
              ? copy.reviewDetail(
                  weavraLabel(state.latest.review.result),
                  weavraLabel(state.latest.review.independent),
                  state.latest.review.revision,
                  state.latest.review.criteriaCount,
                  !(
                    state.latest.review.revision === state.latest.codeRevision &&
                    state.latest.review.diffDigest === state.latest.snapshot.diffDigest
                  ),
                )
              : copy.unavailable}
          </p>
          <p>{copy.evidenceScope}</p>
          {run?.status !== "COMPLETED" &&
          (state.latest.completeness.changedFiles.total ?? 0) > 0 ? (
            <p>{copy.partialPreserved}</p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1">
        <label htmlFor={`${id}-category`} className="text-xs font-medium">
          {copy.category}
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
          {copy.availability(
            weavraLabel(counts.availability),
            selectedRecords.length,
            String(counts.total ?? copy.unavailable),
          )}
          {category === "checks"
            ? copy.requiredRecords(
                String(state?.latest.completeness.checks.required ?? copy.unavailable),
              )
            : ""}
        </p>
      ) : null}
      {reference ? (
        <p role="status" className="text-xs">
          {copy.reference} <code>{reference}</code>.{" "}
          {matchingRecord ? copy.referenceMatched : copy.referenceMissing}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {unavailable ? (
        <p role="status" className="text-xs">
          {copy.categoryUnavailable(unavailable.reason, unavailable.recordIndex)}
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
            aria-label={copy.recordAria(
              categories.find((item) => item.id === record.category)?.label ?? record.category,
              record.index + 1,
            )}
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
        <p className="text-xs text-muted-foreground">{copy.emptyCategory}</p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          data-weavra-action="assess-original-issue"
          disabled={!fresh || !connected || busy || !canAssess}
          onClick={() => load(false, "assess")}
        >
          {copy.assess}
        </Button>
        <Button
          type="button"
          size="sm"
          data-weavra-action="load-evidence"
          disabled={!fresh || !connected || busy || !!complete || !!unavailable}
          onClick={() => void load()}
        >
          {busy
            ? copy.loadingEvidence
            : current && selectedRecords.length > 0
              ? copy.nextPage
              : copy.loadEvidence}
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
            {copy.reloadSnapshot}
          </Button>
        ) : null}
      </div>
      {current && !complete && !unavailable && selectedRecords.length > 0 ? (
        <p className="text-xs text-muted-foreground">{copy.remaining}</p>
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
            <p className="text-muted-foreground">{copy.noRefs}</p>
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
            {copy.checkMeta(
              weavraLabel(record.kind),
              record.required,
              record.step,
              String(record.attempt ?? ko.common.unknown),
            )}
          </p>
          <p>
            {copy.checkRevision(
              record.revision,
              record.revision === codeRevision && record.diffDigest === diffDigest,
              String(record.exitCode ?? copy.unavailable),
            )}
          </p>
          <p>
            {copy.trust(
              record.trust?.status ?? copy.unavailable,
              record.sandbox?.status ?? copy.unavailable,
            )}
          </p>
          {record.trust ? (
            <p className="font-mono">{copy.registration(record.trust.registrationDigest)}</p>
          ) : null}
          <p className="font-mono">{record.evidenceRefs.join(" | ") || copy.noRefsInline}</p>
        </div>
      );
    case "changed-files":
    case "run-diff":
      return <p className="font-mono">{record.path}</p>;
    case "trust-sources":
      return (
        <div className="space-y-1">
          <p>{copy.trustSource(record.checkId, record.checkIndex + 1)}</p>
          <p className="font-mono">{record.path}</p>
          <p className="font-mono">{record.digest}</p>
        </div>
      );
  }
}
