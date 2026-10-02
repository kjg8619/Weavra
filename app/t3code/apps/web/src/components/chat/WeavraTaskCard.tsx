import { CommandId, type WeavraTask, type WeavraTaskScopeInput } from "@t3tools/contracts";
import { useEffect, useId, useState } from "react";
import type { ChatMessage } from "../../types";
import { randomUUID } from "../../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import {
  buildTaskDraft,
  selectedMessageFinding,
  taskConfirmBlocker,
  taskDraftFields,
  taskStatus,
  type TaskDraftFields,
} from "./weavraTaskLogic";
import type { WeavraTaskController } from "./useWeavraTask";

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
  const reason = !props.connected
    ? "Reconnect to the environment to use controlled tasks."
    : !props.supported
      ? "This environment does not support controlled tasks."
      : !c.canOperate
        ? "This session needs orchestration:operate access."
        : !c.discovered
          ? "Loading this conversation's controlled task..."
          : (props.entryBlockedReason ?? null);
  return (
    <section
      aria-label="Controlled task"
      aria-busy={c.busy}
      className="my-4 min-w-0 rounded-[24px] border border-border/80 bg-card/70 p-4 text-sm sm:p-5 [overflow-wrap:anywhere]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge variant="secondary">Controlled task</Badge>
          <h3 className="font-medium">Analyze, review, then hand off</h3>
        </div>
        {c.task ? <Badge variant="outline">{c.task.phase}</Badge> : null}
      </div>
      <p className="mt-3 text-muted-foreground">
        Read-only analysis is advisory. Only Runtime implements the confirmed STANDARD plan; model
        text cannot certify completion.
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
      {!c.discovered && props.connected && props.supported ? (
        <Button type="button" variant="outline" className="mt-3" onClick={c.refresh}>
          Reload task association
        </Button>
      ) : null}
      {!c.task || c.task.ownership.state === "released" ? (
        <div className="mt-4 space-y-3">
          {c.task ? <TaskIdentity task={c.task} fresh={c.fresh} /> : null}
          <p className="text-muted-foreground">
            Opt in for this conversation's exact checkout. No model is called until you send an
            analysis request or explicitly confirm implementation.
          </p>
          <Button
            type="button"
            disabled={reason !== null || c.busy}
            onClick={() =>
              void c.act({
                type: "create",
                input: { ...scope, commandId: CommandId.make(randomUUID()) },
              })
            }
          >
            {c.busy ? "Creating task..." : "Start controlled task"}
          </Button>
          {c.task?.execution?.confirmCommandId != null ? (
            c.route === "free" ? (
              <p className="text-xs text-muted-foreground">
                Free coding was explicitly selected. It does not change the recorded controlled
                outcome.
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Follow-ups are saved without starting a provider or another Run. A new controlled
                  attempt needs review and confirmation.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  disabled={reason !== null || !c.fresh || c.busy}
                  onClick={c.chooseFreeCoding}
                >
                  Return to free coding
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

function DraftFields({
  fields,
  change,
  messages,
  task,
  id,
}: {
  fields: TaskDraftFields;
  change: (fields: TaskDraftFields) => void;
  messages: readonly ChatMessage[];
  task: WeavraTask;
  id: string;
}) {
  const [messageId, setMessageId] = useState("");
  const [excerpt, setExcerpt] = useState("");
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [findingKeys, setFindingKeys] = useState(() => fields.observations.map(() => randomUUID()));
  const visible = messages.filter(
    (message) =>
      (message.role === "assistant" || message.role === "user") &&
      message.text.trim() &&
      !message.streaming,
  );
  const selected = visible.find((message) => message.id === messageId);
  const update = (field: Exclude<keyof TaskDraftFields, "observations">, value: string) =>
    change({ ...fields, [field]: value });
  return (
    <>
      <p className="text-xs text-muted-foreground">
        Local draft until prepared. Only reviewed findings enter the advisory packet, never hidden
        reasoning, credentials or tool transcripts. Total packet: 8 KiB maximum.
      </p>
      {(
        [
          ["goal", "Implementation goal", 2048, "Required; at most 2,048 characters."],
          ["symptom", "Observed symptom", 1000, "Required; at most 1,000 characters."],
          [
            "hypothesis",
            "Candidate cause (hypothesis, not a fact)",
            1000,
            "Optional; at most 1,000 characters.",
          ],
          [
            "uncertainties",
            "Uncertainties",
            2007,
            "One per line; up to 8, at most 250 characters each.",
          ],
          [
            "constraints",
            "Constraints",
            2007,
            "One per line; up to 8, at most 250 characters each. These do not grant permissions.",
          ],
          [
            "criteria",
            "Acceptance criteria",
            8015,
            "One per line; 1-16 criteria, at most 500 characters each. These are not verified results.",
          ],
        ] as const
      ).map(([field, label, cap, help]) => (
        <div key={field} className="space-y-1.5">
          <label htmlFor={`${id}-${field}`} className="block font-medium">
            {label}
          </label>
          <Textarea
            id={`${id}-${field}`}
            aria-describedby={`${id}-${field}-help`}
            maxLength={cap}
            value={fields[field]}
            onChange={(event) => update(field, event.target.value)}
          />
          <p id={`${id}-${field}-help`} className="text-xs text-muted-foreground">
            {help}
          </p>
        </div>
      ))}
      <div className="space-y-3">
        <h4 className="font-medium">Selected findings ({fields.observations.length}/8)</h4>
        {fields.observations.map((finding, index) => (
          <div key={findingKeys[index]} className="space-y-1.5 rounded-lg bg-muted/50 p-3">
            <label htmlFor={`${id}-finding-${index}`} className="block text-xs">
              Finding {index + 1} | {finding.provenance} |{" "}
              {finding.reference.kind === "message"
                ? finding.reference.messageId
                : finding.reference.path}
            </label>
            <Textarea
              id={`${id}-finding-${index}`}
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
              Remove finding {index + 1}
            </Button>
          </div>
        ))}
        <label htmlFor={`${id}-message`} className="block text-xs font-medium">
          Choose a visible message as a source
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
          <option value="">Select a message...</option>
          {visible.map((message) => (
            <option key={message.id} value={message.id}>
              {message.role} | {message.id}
            </option>
          ))}
        </select>
        {selected ? (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Read selected visible message</summary>
            <p className="mt-2 whitespace-pre-wrap">{selected.text}</p>
          </details>
        ) : null}
        <label htmlFor={`${id}-excerpt`} className="block text-xs">
          Exact visible excerpt (at most 500 characters)
        </label>
        <Textarea
          id={`${id}-excerpt`}
          maxLength={500}
          value={excerpt}
          onChange={(event) => setExcerpt(event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Copy only the finding you want to include. Assistant excerpts retain MODEL provenance;
          editing a selected finding marks it USER. No message is selected automatically.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!selected || !excerpt.trim() || fields.observations.length >= 8}
          onClick={() => {
            if (!selected || (selected.role !== "user" && selected.role !== "assistant")) return;
            if (!selected.text.includes(excerpt)) {
              setSelectionError(
                "The excerpt must occur in the selected visible message. Add it first, then edit the selected finding if needed.",
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
              setSelectionError("Select 1-500 characters of visible text.");
            }
          }}
        >
          Include selected finding
        </Button>
        {selectionError ? (
          <p role="alert" className="text-xs text-destructive">
            {selectionError}
          </p>
        ) : null}
      </div>
      <details className="min-w-0 space-y-3">
        <summary className="cursor-pointer font-medium">
          Advanced: source provenance and symptom check
        </summary>
        <label htmlFor={`${id}-sources`} className="block text-xs font-medium">
          Source references (optional JSON array)
        </label>
        <Textarea
          id={`${id}-sources`}
          className="font-mono text-xs"
          maxLength={8192}
          value={fields.sources}
          onChange={(event) => update("sources", event.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Leave [] when initial source hashes are unavailable. At most 8 entries with relative path
          and original digest (sha256: plus 64 hex characters); optional lines: start/end. Never
          invent or refresh hashes to hide stale observations. Host compares them to current
          sources.
        </p>
        <label htmlFor={`${id}-symptom-criterion`} className="block text-xs font-medium">
          Symptom criterion number (optional, 1-16)
        </label>
        <Input
          id={`${id}-symptom-criterion`}
          type="number"
          min={1}
          max={16}
          value={fields.symptomCriterion}
          onChange={(event) => update("symptomCriterion", event.target.value)}
        />
        <label htmlFor={`${id}-symptom-check`} className="block text-xs font-medium">
          Registered symptom check ID
        </label>
        <Input
          id={`${id}-symptom-check`}
          maxLength={128}
          list={`${id}-checks`}
          value={fields.symptomCheck}
          onChange={(event) => update("symptomCheck", event.target.value)}
        />
        <datalist id={`${id}-checks`}>
          {task.execution?.preview?.checks.map((check) => (
            <option key={check.id} value={check.id} />
          ))}
        </datalist>
        <p className="text-xs text-muted-foreground">
          Set both fields or leave both empty. The criterion number follows the non-empty lines
          above. This proposes a binding to an existing required check; it does not register a
          check. Runtime supplies its digest. Without this binding, completion cannot verify the
          original issue.
        </p>
      </details>
    </>
  );
}

function TaskPreview({ task }: { task: WeavraTask }) {
  const preview = task.execution?.preview;
  if (!preview) return null;
  return (
    <div className="min-w-0 space-y-4 rounded-lg border border-border bg-background/50 p-3">
      <h4 className="font-medium">
        Prepared snapshot | {preview.workflow} | {preview.executionMode} | {preview.risk}
      </h4>
      <p>{preview.goal}</p>
      <dl className="space-y-2 text-xs">
        <div>
          <dt className="font-medium">Exact checkout / HEAD</dt>
          <dd className="font-mono">
            {preview.taskBinding.checkout.canonicalCwd}
            <br />
            {preview.taskBinding.checkout.headCommit}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Runtime models (frozen routes)</dt>
          <dd>
            {preview.modelRoutes
              ? preview.modelRoutes.map((route) => (
                  <p key={route.role}>
                    {route.role}: {route.provider} / {route.model} | {route.profile} |{" "}
                    {route.intent} | {route.source}
                  </p>
                ))
              : "Unavailable - not inferred from the chat model"}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Allowed paths</dt>
          <dd>
            {preview.allowedPaths.length
              ? preview.allowedPaths.map((path) => (
                  <p key={path} className="font-mono">
                    {path}
                  </p>
                ))
              : "None"}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Host-registered checks</dt>
          <dd>
            {preview.checks.map((check) => (
              <p key={check.id}>
                {check.id} | {check.kind} | {check.required ? "required" : "optional"}
              </p>
            ))}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Acceptance criteria</dt>
          <dd className="space-y-2">
            {preview.acceptanceCriteria.map((criterion) => (
              <div key={criterion.id}>
                <p>
                  {criterion.id}: {criterion.statement}
                </p>
                <p className="text-muted-foreground">
                  Checks: {criterion.checkIds.join(", ") || "none"} | independent review{" "}
                  {criterion.reviewRequired ? "required" : "not required"}
                </p>
              </div>
            ))}
          </dd>
        </div>
        <div>
          <dt className="font-medium">Symptom verification binding</dt>
          <dd>
            {preview.taskBinding.symptomVerification
              ? `${preview.taskBinding.symptomVerification.criterionId} / ${preview.taskBinding.symptomVerification.checkId} / ${preview.taskBinding.symptomVerification.registrationDigest}`
              : "Not bound - original issue remains unverified"}
          </dd>
        </div>
      </dl>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Snapshot identity and configuration</summary>
        <dl className="mt-2 space-y-2 font-mono">
          <div>
            <dt>Execution / packet</dt>
            <dd>
              {preview.taskBinding.executionId} / {preview.taskBinding.packetVersion}
            </dd>
          </div>
          <div>
            <dt>Preview / configuration / advisory digests</dt>
            <dd>
              {preview.previewDigest}
              <br />
              {preview.configDigest}
              <br />
              {preview.taskBinding.advisoryDigest}
            </dd>
          </div>
          <div>
            <dt>Workspace digest</dt>
            <dd>{preview.taskBinding.checkout.workspaceDigest}</dd>
          </div>
          <div>
            <dt>Project revision / expires</dt>
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
        {fresh ? "Current observation" : "Historical snapshot - synchronize before acting"}:{" "}
        {taskStatus(task)}
      </p>
      <dl className="grid min-w-0 gap-1">
        <div>
          <dt className="inline font-medium">Checkout: </dt>
          <dd className="inline font-mono">{task.checkout.canonicalCwd}</dd>
        </div>
        <div>
          <dt className="inline font-medium">HEAD: </dt>
          <dd className="inline font-mono">{task.checkout.headCommit}</dd>
        </div>
        <div>
          <dt className="inline font-medium">Task: </dt>
          <dd className="inline font-mono">
            {task.id} | revision {task.revision} | ownership {task.ownership.state}
          </dd>
        </div>
        {task.execution ? (
          <div>
            <dt className="inline font-medium">Execution: </dt>
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
      <p>
        Task phase is not a completion verdict. Original issue verification is not established by
        this card.
      </p>
    </div>
  );
}

function TaskEditor(props: TaskCardProps & { task: WeavraTask }) {
  const { controller: c, task } = props;
  const [fields, setFields] = useState(() => taskDraftFields(task));
  const [edited, setEdited] = useState(false);
  const [consent, setConsent] = useState<string | null>(null);
  const [confirmAttempted, setConfirmAttempted] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
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
    setEdited(true);
    setConsent(null);
    setValidation(null);
  };
  const blocker = confirmAttempted
    ? "Confirmation was requested. Refresh task state; never resend this attempt. A new attempt needs a new prepared snapshot."
    : taskConfirmBlocker({ task, fresh: c.fresh, canOperate: c.canOperate, edited, reviewed, now });
  const prepare = async () => {
    if (!c.ref || disabled) return;
    try {
      const draft = buildTaskDraft(fields, (task.context?.packetVersion ?? 0) + 1, Date.now());
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
    } catch {
      setValidation(
        "The draft is invalid. Check the field limits, source-reference JSON and optional criterion/check mapping. The entire advisory packet must fit 8 KiB; nothing was truncated or submitted.",
      );
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
    <div className="mt-4 space-y-4">
      <TaskIdentity task={task} fresh={c.fresh} />
      {task.phase === "analysis" ? (
        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">
            Analysis: Codex read-only | network disabled | no escalation
          </p>
          <p className="mt-1">
            {props.analysisSupported && props.provider === "codex"
              ? "Use the message composer to investigate, or prepare a manually reviewed draft without a model call."
              : "Controlled analysis is unavailable for this capability/provider selection. No provider will be switched. A manually reviewed draft can still be prepared."}
          </p>
          <p className="mt-1">
            Profiles, active MCP, unsupported flags and unproven persisted-session resumes are
            refused. There is no unrestricted fallback.
          </p>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Messages are saved as follow-ups only. They do not steer Runtime, start a provider or
          queue another Run.
        </p>
      )}
      {preview ? <TaskPreview task={task} /> : null}
      {editable ? (
        <details open={!preview} className="min-w-0">
          <summary className="cursor-pointer font-medium">
            Review advisory handoff {edited ? "- changed, prepare again" : ""}
          </summary>
          <fieldset disabled={disabled} className="mt-4 min-w-0 space-y-4 disabled:opacity-60">
            <DraftFields
              fields={fields}
              change={change}
              messages={props.messages}
              task={task}
              id={id}
            />
          </fieldset>
        </details>
      ) : null}
      {task.execution?.confirmCommandId != null ? (
        <div className="space-y-2 text-xs text-muted-foreground">
          <p>
            Recovery checks whether this task's Runtime owner has died. It never restarts
            implementation or undoes changes. Partial changes and failed checks are preserved.
            Recovery may leave the checkout protected when cleanup cannot be established.
          </p>
          {!c.recoverySupported ? (
            <p>This environment does not advertise task recovery support.</p>
          ) : null}
          {task.execution.receipt?.status === "FOUND" &&
          task.execution.receipt.admission.cleanup === "UNCONFIRMED" &&
          task.phase === "attention-required" ? (
            <p role="status">
              {task.execution.receipt.run?.status === "INTERRUPTED" ||
              task.execution.receipt.admission.outcome.status === "INTERRUPTED_BEFORE_START"
                ? "Interruption recorded. "
                : null}
              Cleanup is not verified; checkout remains protected.
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
            I reviewed this exact checkout, models, allowed paths, registered checks and acceptance
            criteria. Confirmation is not destructive-action approval.
          </label>
          {blocker ? <p className="text-xs text-muted-foreground">{blocker}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {editable ? (
          preview && !edited && task.phase === "awaiting-confirmation" ? (
            <>
              <Button type="button" disabled={disabled || blocker !== null} onClick={confirm}>
                Confirm Runtime implementation
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={disabled}
                onClick={() => void prepare()}
              >
                Prepare new snapshot
              </Button>
            </>
          ) : (
            <Button type="button" disabled={disabled} onClick={() => void prepare()}>
              {c.busy ? "Preparing..." : "Prepare reviewed handoff"}
            </Button>
          )
        ) : null}
        {c.ref ? (
          <Button
            type="button"
            variant="outline"
            disabled={!props.connected || !props.supported || !c.canOperate || c.busy}
            onClick={() => {
              if (!c.ref) return;
              setConsent(null);
              void c.act({ type: "reconcile", input: c.ref });
            }}
          >
            Refresh task state
          </Button>
        ) : null}
        {task.execution?.confirmCommandId != null && c.ref ? (
          <Button
            type="button"
            variant="outline"
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
            Recover interrupted task
          </Button>
        ) : null}
        {editable && c.ref ? (
          <Button
            type="button"
            variant="ghost"
            disabled={disabled}
            onClick={() => {
              if (!c.ref) return;
              void c.act({
                type: "abort",
                input: { task: c.ref, expectedRevision: task.revision },
              });
            }}
          >
            Stop controlled task
          </Button>
        ) : null}
      </div>
      {c.busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          Waiting for the server...
        </p>
      ) : null}
    </div>
  );
}
