import {
  createEnvironmentCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { requestWeavraTask } from "@t3tools/client-runtime/state/weavraTask";
import {
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
import { randomUUID } from "../../lib/utils";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { WeavraPreflightFailure } from "../settings/WeavraPreflightFailure";
import {
  appendTaskEvidence,
  issueVerification,
  type EvidenceCategory,
  type IssueVerification,
  type TaskEvidenceState,
} from "./weavraTaskResultLogic";
import { taskStatus } from "./weavraTaskLogic";
import type { WeavraTaskController } from "./useWeavraTask";

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
  { id: "criteria", label: "Acceptance criteria" },
  { id: "checks", label: "Registered checks" },
  { id: "changed-files", label: "Actual changed paths" },
  { id: "trust-sources", label: "Verifier trust sources" },
] as const;
const verificationReasons: Record<
  Extract<IssueVerification, { status: "unverified" }>["reason"],
  string
> = {
  RUN_NOT_COMPLETED: "The Run has not canonically completed.",
  NO_SYMPTOM_BINDING: "No registered symptom check was frozen for this Run.",
  STALE_OR_MISSING_EVIDENCE:
    "Load a current evidence snapshot before assessing the original issue.",
  BINDING_CHANGED: "The evidence does not match the frozen symptom binding.",
  EVIDENCE_INCOMPLETE: "Load all criterion and check pages before assessing the final attempt.",
  CRITERION_UNVERIFIED: "The bound acceptance criterion is not verified.",
  FINAL_CHECK_UNVERIFIED: "The final required symptom test is absent, failed or stale.",
  REGISTRATION_UNVERIFIED: "The check registration is changed or its trust is unverified.",
  REVIEW_UNVERIFIED: "A matching fresh independent review is unavailable.",
};

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
  return (
    <div className="my-4 min-w-0 space-y-3 rounded-[24px] border border-border/80 bg-card/70 p-4 sm:p-5">
      <label htmlFor={`${id}-history`} className="block text-sm font-medium">
        Recorded task outcomes
      </label>
      <select
        id={`${id}-history`}
        className="w-full min-w-0 rounded-md border border-border bg-background p-2 text-sm"
        value={selected?.id ?? ""}
        onChange={(event) => {
          const task = results.find((item) => item.id === event.target.value);
          if (task) void navigate({ to: pathname, hash: `${prefix}${task.id}` });
        }}
      >
        {!selected ? <option value="">Requested result is unavailable</option> : null}
        {results.map((task) => (
          <option key={task.id} value={task.id}>
            {task.createdAt.slice(0, 16)} | {taskStatus(task)} | {task.id}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">
        Inspection never retargets the active task or starts execution.
        {!active ? " This is a historical attempt; active controls remain in the card above." : ""}
      </p>
      {selected ? (
        <div
          id={`${prefix}${selected.id}`}
          ref={target}
          tabIndex={-1}
          className="min-w-0 focus:outline-none"
        >
          <p className="mb-2 font-mono text-xs [overflow-wrap:anywhere]">
            Inspected task: {selected.id}
          </p>
          <WeavraTaskResult
            key={selected.id}
            task={selected}
            fresh={controller.discovered && connected && (!active || controller.fresh)}
            connected={connected}
            canRefresh={active && controller.canOperate && !controller.busy}
            onRefresh={() => {
              if (active && controller.ref)
                void controller.act({ type: "reconcile", input: controller.ref });
            }}
          />
          {active ? <TaskRunActions controller={controller} connected={connected} /> : null}
        </div>
      ) : (
        <p role="status" className="text-sm">
          The requested task is not available in this conversation. No other result was substituted.
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
        setError("Approval is unavailable. Refresh the task state before inspecting it again.");
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
      aria-label="Bound Runtime controls"
      className="min-w-0 space-y-3 border-t border-border/70 pt-3"
    >
      <p className="text-xs text-muted-foreground">
        These actions target this exact task and Run revision. Cancellation preserves partial
        changes and does not release ownership before cleanup is proven.
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
          Cancel Runtime run
        </Button>
        {run.status === "WAITING_APPROVAL" ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!connected || !c.fresh || c.busy || loading}
            onClick={() => void inspect()}
          >
            {loading ? "Loading approval..." : "Inspect pending approval"}
          </Button>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {loaded && approval === null ? (
        <p className="text-xs">No pending approval was observed.</p>
      ) : null}
      {approval ? (
        <div className="space-y-3 rounded-lg border border-warning/50 p-3 text-sm [overflow-wrap:anywhere]">
          <h5 className="font-medium">One-file deletion approval (R3)</h5>
          <p>{approval.explanation}</p>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            {[
              ["Target", approval.path],
              ["Run", approval.runId],
              ["Approval", approval.approvalId],
              ["Operation / role", `${approval.operation} / ${approval.role}`],
              ["Step", `${approval.step.stepId}@${approval.step.attempt}`],
              ["Run / project revision", `${approval.stateRevision} / ${approval.projectRevision}`],
              ["Bytes", String(approval.bytes)],
              ["Fingerprint", approval.preconditionDigest],
              ["Expires", new Date(approval.expiresAt).toLocaleString()],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            Handoff confirmation did not approve this deletion. No session-wide permission or
            automatic rollback is granted.
          </p>
          {!approvalCurrent ? (
            <p role="status" className="text-xs">
              This approval is stale, expired or already requested. Refresh the task and inspect the
              current request; nothing is retried automatically.
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
              Reject deletion
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={disabled || !approvalCurrent}
              onClick={() => decide("approve")}
            >
              Approve deletion once
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

export function WeavraTaskResult({
  task,
  fresh,
  connected,
  onRefresh,
  canRefresh,
}: {
  task: WeavraTask;
  fresh: boolean;
  connected: boolean;
  onRefresh: () => void;
  canRefresh: boolean;
}) {
  const receipt = task.execution?.receipt;
  const run = receipt?.status === "FOUND" ? receipt.run : null;
  const observations = useMemo(
    () =>
      task.context?.observations.map((observation) => ({ id: randomUUID(), observation })) ?? [],
    [task.context],
  );
  return (
    <section
      aria-label="Controlled outcome"
      className="min-w-0 space-y-4 border-t border-border/70 pt-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-medium">Runtime outcome</h4>
        <Badge variant="outline">
          {run?.status ??
            (receipt?.status === "FOUND" ? receipt.admission.outcome.status : "UNCONFIRMED")}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {fresh
          ? "Last observed canonical outcome."
          : "Historical outcome; reconnect and synchronize before acting."}{" "}
        A task phase or an assistant claim is not completion evidence.
      </p>
      {task.execution?.preview ? (
        <p className="text-sm [overflow-wrap:anywhere]">
          <strong>{task.execution.confirmCommandId ? "Confirmed goal:" : "Prepared goal:"}</strong>{" "}
          {task.execution.preview.goal}
        </p>
      ) : null}
      <details className="min-w-0 text-xs">
        <summary className="cursor-pointer font-medium">
          Reviewed advisory context, not verification
        </summary>
        {task.context ? (
          <div className="mt-3 space-y-3 [overflow-wrap:anywhere]">
            <p>
              <strong>Observed symptom:</strong> {task.context.symptom}
            </p>
            <p>
              <strong>Candidate cause (hypothesis):</strong>{" "}
              {task.context.candidateCause?.text ?? "Not recorded"}
            </p>
            <ul className="space-y-2">
              {observations.map(({ id, observation }) => (
                <li key={id} className="rounded-lg bg-muted/40 p-2">
                  <Badge variant="outline">{observation.provenance}</Badge>
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
              <strong>Uncertainties:</strong>{" "}
              {task.context.uncertainties.join("; ") || "None recorded"}
            </p>
            <p>
              <strong>Constraints:</strong> {task.context.constraints.join("; ") || "None recorded"}
            </p>
          </div>
        ) : (
          <p className="mt-2 text-muted-foreground">Reviewed context is unavailable.</p>
        )}
      </details>
      {!receipt ? (
        <p className="text-sm text-muted-foreground">
          No canonical admission is recorded. No implementation result is claimed.
        </p>
      ) : receipt.status === "UNKNOWN" ? (
        <p className="text-sm text-muted-foreground">
          Admission is unknown. Preserve this execution identity and reconcile; do not resend
          confirmation.
        </p>
      ) : run === null ? (
        <div className="space-y-3">
          <p className="text-sm">
            {receipt.admission.outcome.status === "START_FAILED"
              ? `Startup failed: ${receipt.admission.outcome.reasonCode}. No Run was created.`
              : receipt.admission.outcome.status === "INTERRUPTED_BEFORE_START"
                ? "The owner was lost before a Run started. No automatic restart was performed."
                : "Admission was accepted, but no Run has been observed yet."}
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
        />
      )}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={!connected || !canRefresh}
        onClick={onRefresh}
      >
        Refresh canonical outcome
      </Button>
    </section>
  );
}

function EvidencePanel({
  task,
  fresh,
  connected,
}: {
  task: WeavraTask;
  fresh: boolean;
  connected: boolean;
}) {
  const id = useId();
  const epoch = useMemo(() => Symbol(`evidence:${fresh}:${connected}`), [fresh, connected]);
  const latestEpoch = useRef(epoch);
  useLayoutEffect(() => {
    latestEpoch.current = epoch;
  }, [epoch]);
  const [loaded, setLoaded] = useState<{ epoch: symbol; state: TaskEvidenceState } | null>(null);
  const [category, setCategory] = useState<EvidenceCategory>("criteria");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);
  const rows = useRef(new Map<string, HTMLDivElement>());
  const execute = useAtomCommand(evidenceCommand, { reportFailure: false });
  const state = loaded?.state ?? null;
  const current = fresh && connected && loaded?.epoch === epoch;
  const verification = issueVerification(task, state, current);
  const receipt = task.execution?.receipt;
  const run = receipt?.status === "FOUND" ? receipt.run : null;
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
  const load = async (reset = false) => {
    if (!run || !fresh || !connected || pending.current) return;
    const base = !reset && current ? state : null;
    const cursor = base?.next[category] ?? { category, index: 0 };
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
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
      if (latestEpoch.current !== epoch) return;
      if (result._tag !== "Success") {
        const failure = squashAtomCommandFailure(result);
        const code =
          typeof failure === "object" && failure !== null && "code" in failure
            ? String(failure.code)
            : "REQUEST_FAILED";
        setError(`${code}: Evidence is unavailable. Refresh the task and reload this snapshot.`);
        setLoaded((previous) =>
          previous ? { ...previous, epoch: Symbol("unverified-evidence") } : null,
        );
        return;
      }
      const next = appendTaskEvidence(task, base, result.value);
      if (!next.ok) {
        setError(`${next.code}: Evidence pages were not combined. Refresh the task and reload.`);
        setLoaded((previous) =>
          previous ? { ...previous, epoch: Symbol("unverified-evidence") } : null,
        );
        return;
      }
      setLoaded({ epoch, state: next.state });
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
      }[category]
    : null;
  return (
    <div className="min-w-0 space-y-3 [overflow-wrap:anywhere]">
      <p className="font-mono text-xs">
        Run {run?.runId} | state revision {run?.revision}
      </p>
      <div
        role="status"
        data-issue-verification={verification.status}
        className="rounded-lg bg-muted/40 p-3 text-sm"
      >
        <p className="font-medium">
          {verification.status === "verified"
            ? "Original issue verified for this Run"
            : "Original issue unverified"}
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
            {current ? "Evidence snapshot" : "Historical evidence; reload before assessing it"} |{" "}
            {state.latest.source} | code revision {state.latest.codeRevision}
          </p>
          <p className="font-mono">Diff {state.latest.snapshot.diffDigest}</p>
          <p>
            Changed lines: {state.latest.changedLines ?? "Unavailable"} | Cleanup:{" "}
            {state.latest.ownership.cleanup}
          </p>
          <p>
            Independent review:{" "}
            {state.latest.review
              ? `${state.latest.review.result}; independent=${state.latest.review.independent}; code revision ${state.latest.review.revision}; ${state.latest.review.criteriaCount} criteria${state.latest.review.revision === state.latest.codeRevision && state.latest.review.diffDigest === state.latest.snapshot.diffDigest ? "" : "; stale"}`
              : "Unavailable"}
          </p>
          <p>This evidence describes the recorded Run revision, not later filesystem edits.</p>
          {run?.status !== "COMPLETED" &&
          (state.latest.completeness.changedFiles.total ?? 0) > 0 ? (
            <p>
              Changes remain recorded for this incomplete Run. They are not a successful
              implementation or an automatic rollback.
            </p>
          ) : null}
        </div>
      ) : null}
      <div className="space-y-1">
        <label htmlFor={`${id}-category`} className="text-xs font-medium">
          Evidence category
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
          Availability: {counts.availability} | Loaded {selectedRecords.length} /{" "}
          {counts.total ?? "unavailable"}
          {category === "checks"
            ? ` | Required records: ${state?.latest.completeness.checks.required ?? "unavailable"}`
            : ""}
        </p>
      ) : null}
      {reference ? (
        <p role="status" className="text-xs">
          Evidence reference: <code>{reference}</code>.{" "}
          {matchingRecord
            ? "Matching loaded record focused."
            : "Not present in loaded check records; load remaining pages or inspect the review summary."}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      {unavailable ? (
        <p role="status" className="text-xs">
          Unavailable: {unavailable.reason}, record {unavailable.recordIndex}. This is not an empty
          successful category.
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
            aria-label={`${record.category} record ${record.index + 1}`}
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
        <p className="text-xs text-muted-foreground">
          No records in this available snapshot category.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={!fresh || !connected || busy || !!complete || !!unavailable}
          onClick={() => void load()}
        >
          {busy
            ? "Loading evidence..."
            : current && selectedRecords.length > 0
              ? "Load next evidence page"
              : "Load canonical evidence"}
        </Button>
        {state ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!fresh || !connected || busy}
            onClick={() => void load(true)}
          >
            Reload evidence snapshot
          </Button>
        ) : null}
      </div>
      {current && !complete && !unavailable && selectedRecords.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          More records remain. Incomplete evidence is not proof of resolution.
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
            {record.id} <Badge variant="outline">{record.status}</Badge>
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
            <p className="text-muted-foreground">No evidence references recorded.</p>
          ) : null}
        </div>
      );
    case "checks":
      return (
        <div className="space-y-2">
          <p className="font-medium">
            {record.id} <Badge variant="outline">{record.status}</Badge>
          </p>
          <p>
            {record.kind} | {record.required ? "required" : "optional"} | {record.step} | attempt{" "}
            {record.attempt ?? "unknown"}
          </p>
          <p>
            Code revision {record.revision} |{" "}
            {record.revision === codeRevision && record.diffDigest === diffDigest
              ? "Matches snapshot"
              : "Historical/stale for snapshot"}{" "}
            | exit {record.exitCode ?? "unavailable"}
          </p>
          <p>
            Trust: {record.trust?.status ?? "Unavailable"} | Sandbox:{" "}
            {record.sandbox?.status ?? "Unavailable"}
          </p>
          {record.trust ? (
            <p className="font-mono">Registration {record.trust.registrationDigest}</p>
          ) : null}
          <p className="font-mono">
            {record.evidenceRefs.join(" | ") || "No evidence references recorded"}
          </p>
        </div>
      );
    case "changed-files":
      return <p className="font-mono">{record.path}</p>;
    case "trust-sources":
      return (
        <div className="space-y-1">
          <p>
            {record.checkId} | check record {record.checkIndex + 1}
          </p>
          <p className="font-mono">{record.path}</p>
          <p className="font-mono">{record.digest}</p>
        </div>
      );
  }
}
