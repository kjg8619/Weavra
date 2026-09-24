import type {
  WeavraComplexExecution,
  WeavraComplexPlan,
  WeavraControlState,
} from "@t3tools/contracts";
import { Badge } from "../ui/badge";

type Run = NonNullable<WeavraControlState["snapshot"]["status"]["run"]>;
const known = (value: number | null) => (value === null ? "unknown" : String(value));

/** Read-only frozen COMPLEX plan. Display only: nothing here schedules, edits or verifies work. */
export function ComplexPlanView({
  plan,
  criteria,
}: {
  plan: WeavraComplexPlan;
  criteria: ReadonlyArray<{ id: string; statement: string }>;
}) {
  const statements = new Map(criteria.map((criterion) => [criterion.id, criterion.statement]));
  return (
    <div className="space-y-3 text-xs">
      <dl className="grid gap-2 sm:grid-cols-2">
        {[
          ["Plan", plan.planId],
          ["Plan digest", plan.complexPlanDigest],
          ["Parent Task Contract", plan.parentTaskId],
          ["Parent digest", plan.parentTaskContractDigest],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      <ol aria-label="Ordered COMPLEX tasks" className="space-y-2">
        {plan.tasks.map((task) => (
          <li key={task.id} className="space-y-1 rounded-md border border-border p-3">
            <p className="font-medium">
              {task.id} · {task.title}
            </p>
            <p className="whitespace-pre-wrap break-words">{task.goal}</p>
            <p>Depends on: {task.dependsOn.join(", ") || "none"}</p>
            <ul className="space-y-0.5">
              {task.criterionIds.map((id) => (
                <li key={id} className="break-words">
                  {id} · {statements.get(id) ?? "statement unavailable"}
                </li>
              ))}
            </ul>
            <p className="break-all">
              Exact file claims:{" "}
              {task.ownership.length === 0
                ? "none (read-only contribution)"
                : task.ownership.map((claim) => `${claim.operation} ${claim.path}`).join(", ")}
            </p>
            <p>
              Task checks: {task.checkIds.join(", ")} · local revision cycles ≤{" "}
              {task.maxRevisionCycles}
            </p>
          </li>
        ))}
      </ol>
      <p>
        Integration: criteria {plan.integration.criterionIds.join(", ")} · all registered checks{" "}
        {plan.integration.checkIds.join(", ")} · independent final review and fresh final checks
        required.
      </p>
      <p>
        Limits: {plan.limits.maxTasks} tasks · {plan.limits.maxWorkerInvocations} worker invocations
        · {plan.limits.maxReportedTokens} provider-reported tokens ·{" "}
        {plan.limits.maxTotalRevisionCycles} total revision cycles.
      </p>
      <p className="text-muted-foreground">
        Tasks run one at a time in this order under one Runtime-owned Run. File claims narrow
        responsibility; they are not filesystem permission, Policy ALLOW or approval.
      </p>
    </div>
  );
}

/** Read-only COMPLEX execution projection; the snapshot Run status stays the only outcome. */
export function ComplexExecutionView({
  execution,
  run,
  current,
  owned,
  observedAt,
  writerPresent,
}: {
  execution: WeavraComplexExecution;
  run: Run;
  current: boolean;
  owned: boolean;
  observedAt: number | null;
  writerPresent: boolean | null;
}) {
  const titles = new Map(execution.plan.tasks.map((task) => [task.id, task.title]));
  const completed = execution.tasks.filter((task) => task.status === "COMPLETED").length;
  const allTasksCompleted = completed === execution.tasks.length;
  const { integration, budget, plan } = execution;
  return (
    <section
      aria-label="COMPLEX execution"
      className="space-y-3 rounded-md border border-border p-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">COMPLEX execution · Runtime projection</h4>
        <div className="flex flex-wrap gap-2">
          <Badge variant={current ? "info" : "warning"}>
            {current ? "CURRENT OBSERVATION" : "HISTORICAL · NOT CURRENT"}
          </Badge>
          {!owned && <Badge variant="outline">DISPLAY ONLY · NOT OWNED</Badge>}
        </div>
      </div>
      {!current && (
        <p>
          Last checked observation:{" "}
          {observedAt === null ? "time unknown" : new Date(observedAt).toLocaleString()}. Historical
          data is not current execution state and enables no action.
        </p>
      )}
      <p>
        Canonical Run outcome: <strong>{run.status}</strong> · phase {execution.phase} · active task{" "}
        {execution.activeTaskId ?? "none"}
      </p>
      <p>
        Task contributions completed: {completed} / {execution.tasks.length}.{" "}
        {allTasksCompleted && run.status !== "COMPLETED"
          ? "Completed tasks do not complete the Run: fresh integration checks, an independent final review, fresh final checks and Kernel completion still decide."
          : "Task completion is not Run completion; only the canonical Run status above is the outcome."}
      </p>
      <ol aria-label="COMPLEX task states" className="space-y-2">
        {execution.tasks.map((task) => (
          <li key={task.id} className="space-y-1 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {task.id} · {titles.get(task.id)}
              </span>
              <Badge variant="outline">{task.status}</Badge>
            </div>
            <p>
              Attempt {task.attempt} · local revision cycle {task.revisionCycle} · worker
              invocations {task.workerInvocations} · reported tokens {known(task.reportedTokens)}
            </p>
            <p>
              Self-check {task.selfCheck} · review {task.review} · test {task.test} · evidence{" "}
              {task.evidenceFreshness}
              {task.status === "COMPLETED" && task.evidenceFreshness !== "CURRENT"
                ? " (historical contribution, not current completion evidence)"
                : ""}
            </p>
            <p className="break-all">
              Changed files: {task.changedFiles.join(", ") || "none recorded"}
              {task.changesUnknown ? " · additional changes UNKNOWN" : ""}
            </p>
            {task.failureCode && <p>Failure: {task.failureCode}</p>}
          </li>
        ))}
      </ol>
      <dl className="grid gap-2 sm:grid-cols-2">
        {[
          [
            "Integration",
            `check ${integration.check} · final review ${integration.review} · final test ${integration.test} · evidence ${integration.evidenceFreshness}`,
          ],
          ["Integration workspace", integration.workspaceDigest ?? "not captured"],
          ["Integration failure", integration.failureCode ?? "none"],
          [
            "Worker invocations",
            `${budget.workerInvocations} / ${plan.limits.maxWorkerInvocations}`,
          ],
          [
            "Provider-reported tokens",
            `${known(budget.reportedTokens)} / ${plan.limits.maxReportedTokens}`,
          ],
          [
            "Global work cycle (revisions)",
            `${budget.totalRevisionCycles} / ${plan.limits.maxTotalRevisionCycles}`,
          ],
          ["Budget", budget.status],
          [
            "Cleanup / writer present",
            `${execution.cleanup} / ${writerPresent === null ? "UNKNOWN" : String(writerPresent)}`,
          ],
          [
            "Workspace changes",
            `${execution.partialChanges ? "partial changes retained" : "no partial changes reported"}${execution.changesUnknown ? " · change set UNKNOWN" : ""}`,
          ],
          ["Run failure", execution.failureCode ?? "none"],
          ["Parent Task Contract", `${execution.parent.id} · ${execution.parent.status}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {execution.cleanup === "UNCONFIRMED" && (
        <p>
          Cleanup is unconfirmed: the writer stays retained for manual inspection. There is no
          automatic resume, cleanup retry or rollback.
        </p>
      )}
      <p className="text-muted-foreground">
        Partial workspace changes, including those of completed tasks, are never rolled back
        automatically. The plan is frozen; tasks cannot be retried, skipped, reordered or completed
        from here.
      </p>
      <ComplexPlanView plan={plan} criteria={execution.parent.acceptanceCriteria} />
    </section>
  );
}
