import { ko } from "~/i18n/ko";
import { weavraLabel } from "../weavraLabels";
import type {
  WeavraComplexExecution,
  WeavraComplexPlan,
  WeavraControlState,
} from "@t3tools/contracts";
import { Badge } from "../ui/badge";

type Run = NonNullable<WeavraControlState["snapshot"]["status"]["run"]>;
type Row = WeavraComplexExecution["tasks"][number];
const copy = ko.runtime.task.complex;
const known = (value: number | null) => (value === null ? ko.common.unknown : String(value));
/** Contract v1 plans have no parallel limit: they run one task at a time. */
const maxParallelOf = (plan: WeavraComplexPlan) =>
  plan.schemaVersion === 2 ? plan.limits.maxParallel : 1;
/** What a Runtime-reported status or failure means; never a transition the App makes. */
const statusNote: Partial<Record<Row["status"], string>> = copy.statusNote;
const failureNote: Partial<Record<NonNullable<Row["failureCode"]>, string>> = copy.failureNote;

/** Read-only frozen COMPLEX plan. Display only: nothing here schedules, edits or verifies work. */
export function ComplexPlanView({
  plan,
  criteria,
}: {
  plan: WeavraComplexPlan;
  criteria: ReadonlyArray<{ id: string; statement: string }>;
}) {
  const statements = new Map(criteria.map((criterion) => [criterion.id, criterion.statement]));
  const maxParallel = maxParallelOf(plan);
  return (
    <div className="space-y-3 text-xs">
      <dl className="grid gap-2 sm:grid-cols-2">
        {[
          [copy.plan, plan.planId],
          [copy.planDigest, plan.complexPlanDigest],
          [copy.parentContract, plan.parentTaskId],
          [copy.parentDigest, plan.parentTaskContractDigest],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      <ol aria-label={copy.orderedTasks} className="space-y-2">
        {plan.tasks.map((task) => (
          <li key={task.id} className="space-y-1 rounded-md border border-border p-3">
            <p className="font-medium">
              {task.id} · {task.title}
            </p>
            <p className="whitespace-pre-wrap break-words">{task.goal}</p>
            <p>{copy.dependsOn(task.dependsOn.join(", ") || ko.common.none)}</p>
            <ul className="space-y-0.5">
              {task.criterionIds.map((id) => (
                <li key={id} className="break-words">
                  {id} · {statements.get(id) ?? copy.missingStatement}
                </li>
              ))}
            </ul>
            <p className="break-all">
              {copy.ownership(
                task.ownership.length === 0
                  ? copy.readOnlyOwnership
                  : task.ownership.map((claim) => `${claim.operation} ${claim.path}`).join(", "),
              )}
            </p>
            <p>{copy.taskChecks(task.checkIds.join(", "), task.maxRevisionCycles)}</p>
          </li>
        ))}
      </ol>
      <p>
        {copy.integrationPlan(
          plan.integration.criterionIds.join(", "),
          plan.integration.checkIds.join(", "),
        )}
      </p>
      <p>
        {copy.limits(
          plan.limits.maxTasks,
          plan.limits.maxWorkerInvocations,
          plan.limits.maxReportedTokens,
          plan.limits.maxTotalRevisionCycles,
          plan.schemaVersion === 2 ? maxParallel : null,
        )}
      </p>
      <p className="text-muted-foreground">
        {maxParallel > 1 ? copy.parallelNote(maxParallel) : copy.sequentialNote}{" "}
        {copy.ownershipDisclaimer}
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
  cancelling,
}: {
  execution: WeavraComplexExecution;
  run: Run;
  current: boolean;
  owned: boolean;
  observedAt: number | null;
  writerPresent: boolean | null;
  cancelling: boolean;
}) {
  const tasks = new Map(execution.plan.tasks.map((task) => [task.id, task]));
  const completed = execution.tasks.filter((task) => task.status === "COMPLETED").length;
  const allTasksCompleted = completed === execution.tasks.length;
  const { integration, budget, plan } = execution;
  // Wave membership is only what the Runtime reports; nothing is inferred from dependencies.
  const wave = execution.schemaVersion === 2 ? execution.activeTaskIds : null;
  const label = (id: string) => `${id} · ${tasks.get(id)?.title ?? copy.unknownTask}`;
  return (
    <section
      aria-label={copy.executionAria}
      className="space-y-3 rounded-md border border-border p-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{copy.executionTitle}</h4>
        <div className="flex flex-wrap gap-2">
          <Badge variant={current ? "info" : "warning"}>
            {current ? copy.currentObservation : copy.historical}
          </Badge>
          {!owned && <Badge variant="outline">{copy.notOwned}</Badge>}
        </div>
      </div>
      {!current && (
        <p>
          {copy.lastObserved(
            observedAt === null ? copy.unknownTime : new Date(observedAt).toLocaleString(),
          )}
        </p>
      )}
      <p>
        {copy.officialResult} <strong>{weavraLabel(run.status)}</strong> · {copy.phase}{" "}
        {weavraLabel(execution.phase)}
        {execution.schemaVersion === 1
          ? copy.activeTask(execution.activeTaskId ?? ko.common.none)
          : ""}
      </p>
      {wave !== null && (
        <p>
          {copy.wave(
            wave.length === 0 ? ko.common.none : wave.map(label).join(", "),
            maxParallelOf(plan),
          )}
        </p>
      )}
      {(cancelling || execution.phase === "STOPPING") && (
        <p>{copy.stopping(cancelling, execution.cleanup)}</p>
      )}
      <p>
        {copy.completedTasks(completed, execution.tasks.length)}{" "}
        {allTasksCompleted && run.status !== "COMPLETED"
          ? copy.completionNeedsKernel
          : copy.completionOfficialOnly}
      </p>
      <ol aria-label={copy.taskStatusAria} className="space-y-2">
        {execution.tasks.map((task) => (
          <li key={task.id} className="space-y-1 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{label(task.id)}</span>
              <div className="flex flex-wrap gap-2">
                {wave?.includes(task.id) && <Badge variant="outline">{copy.currentWave}</Badge>}
                <Badge variant="outline">{weavraLabel(task.status)}</Badge>
              </div>
            </div>
            {statusNote[task.status] && <p>{statusNote[task.status]}</p>}
            <p>{copy.dependsOn(tasks.get(task.id)?.dependsOn.join(", ") || ko.common.none)}</p>
            <p>
              {copy.taskUsage(
                task.attempt,
                task.revisionCycle,
                task.workerInvocations,
                known(task.reportedTokens),
              )}
            </p>
            <p>
              {copy.taskEvidence(task.selfCheck, task.review, task.test, task.evidenceFreshness)}
              {task.status === "COMPLETED" && task.evidenceFreshness !== "CURRENT"
                ? copy.historicalCompletion
                : ""}
            </p>
            <p className="break-all">
              {copy.changedFiles(task.changedFiles.join(", ") || copy.noRecord)}
              {task.changesUnknown ? copy.moreChangesUnknown : ""}
            </p>
            {task.failureCode && (
              <p>
                {failureNote[task.failureCode]
                  ? copy.failureWithNote(task.failureCode, failureNote[task.failureCode]!)
                  : copy.failure(task.failureCode)}
              </p>
            )}
          </li>
        ))}
      </ol>
      <dl className="grid gap-2 sm:grid-cols-2">
        {[
          [
            copy.integration,
            copy.integrationValue(
              integration.check,
              integration.review,
              integration.test,
              integration.evidenceFreshness,
            ),
          ],
          [copy.integrationWorkspace, integration.workspaceDigest ?? copy.notCollected],
          [copy.integrationFailure, integration.failureCode ?? ko.common.none],
          [copy.workerCalls, `${budget.workerInvocations} / ${plan.limits.maxWorkerInvocations}`],
          [
            copy.providerTokens,
            `${known(budget.reportedTokens)} / ${plan.limits.maxReportedTokens}`,
          ],
          [
            copy.totalRevisions,
            `${budget.totalRevisionCycles} / ${plan.limits.maxTotalRevisionCycles}`,
          ],
          [copy.budget, budget.status],
          [copy.cleanupWriter, `${execution.cleanup} / ${weavraLabel(writerPresent)}`],
          [
            copy.workspaceChanges,
            `${execution.partialChanges ? copy.partialKept : copy.partialNone}${execution.changesUnknown ? copy.changeSetUnknown : ""}`,
          ],
          [copy.runFailure, execution.failureCode ?? ko.common.none],
          [copy.parentContract, `${execution.parent.id} · ${execution.parent.status}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {execution.cleanup === "UNCONFIRMED" && <p>{copy.cleanupUnconfirmed}</p>}
      <p className="text-muted-foreground">{copy.noAutoRevert}</p>
      <ComplexPlanView plan={plan} criteria={execution.parent.acceptanceCriteria} />
    </section>
  );
}
