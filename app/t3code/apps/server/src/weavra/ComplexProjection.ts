import * as NodeCrypto from "node:crypto";
import type {
  WeavraComplexExecution,
  WeavraComplexPlan,
  WeavraComplexTask,
  WeavraComplexTaskState,
  WeavraControlCapabilities,
  WeavraControlPreview,
  WeavraControlState,
  WeavraTaskContract,
} from "@t3tools/contracts";

// Consumer checks for the COMPLEX contract: v1 (docs/architecture/COMPLEX_SEQUENTIAL_WORKFLOW.md
// §4.2, §10, §11.1) and v2, whose §8 consumer rules in docs/architecture/PARALLEL_AGENTS.md
// replace the single-active-task rules. Runtime stays the authority: these predicates only reject
// inconsistent observations before publication and never repair, merge or advance anything.

type ContractVersion = NonNullable<WeavraControlCapabilities["complexContractVersion"]>;
type Criterion = {
  readonly id: string;
  readonly checkIds: ReadonlyArray<string>;
  readonly reviewRequired: boolean;
};
type Run = NonNullable<WeavraControlState["snapshot"]["status"]["run"]>;

/** Recursively sorted object keys (code-unit order), arrays preserved, no whitespace. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON rejects non-finite numbers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => {
        if (record[key] === undefined) throw new Error("Canonical JSON rejects undefined");
        return `${JSON.stringify(key)}:${canonicalJson(record[key])}`;
      })
      .join(",")}}`;
  }
  throw new Error("Canonical JSON rejects unsupported values");
}
const sha256 = (text: string) =>
  `sha256:${NodeCrypto.createHash("sha256").update(text, "utf8").digest("hex")}`;
const sameList = (left: ReadonlyArray<string>, right: ReadonlyArray<string>) =>
  left.length === right.length && left.every((value, index) => value === right[index]);

/** The Runtime `taskContractDigest`: the key order of this JSON.stringify material is digest input. */
function contractDigest(
  id: string,
  goal: string,
  criteria: ReadonlyArray<{
    readonly id: string;
    readonly statement: string;
    readonly paths: ReadonlyArray<string>;
    readonly checkIds: ReadonlyArray<string>;
    readonly reviewRequired: boolean;
  }>,
) {
  return sha256(
    JSON.stringify({
      id,
      goal,
      acceptanceCriteria: criteria.map((criterion) => ({
        id: criterion.id,
        statement: criterion.statement,
        scope: { paths: criterion.paths },
        verification: { checkIds: criterion.checkIds, reviewRequired: criterion.reviewRequired },
      })),
    }),
  );
}

/** Parent identity digest; lifecycle status is deliberately not digest material. */
export function taskContractDigest(parent: WeavraTaskContract) {
  return contractDigest(
    parent.id,
    parent.goal,
    parent.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      statement: criterion.statement,
      paths: criterion.scope.paths,
      checkIds: criterion.verification.checkIds,
      reviewRequired: criterion.verification.reviewRequired,
    })),
  );
}

/** Rebuilds the pending parent from a preview: the Host scopes every criterion to allowedPaths. */
export function previewTaskContractDigest(preview: WeavraControlPreview, parentTaskId: string) {
  return contractDigest(
    parentTaskId,
    preview.goal,
    preview.acceptanceCriteria.map((criterion) => ({ ...criterion, paths: preview.allowedPaths })),
  );
}

/** Each plan version hashes under its own domain, so a plan never verifies as another version. */
const PLAN_DIGEST_DOMAIN: Record<WeavraComplexPlan["schemaVersion"], string> = {
  1: "weavra-complex-plan-v1",
  2: "weavra-complex-plan-v2",
};
export function complexPlanDigest(plan: WeavraComplexPlan) {
  const { complexPlanDigest: _excluded, ...material } = plan;
  return sha256(canonicalJson([PLAN_DIGEST_DOMAIN[plan.schemaVersion], material]));
}
/** v1 plans, and v2 plans frozen to one worker, schedule only the next row after every earlier one. */
const sequential = (plan: WeavraComplexPlan) =>
  plan.schemaVersion === 1 || plan.limits.maxParallel === 1;
/** R3 keeps the narrow one-deletion flow: its plans freeze maxParallel = 1 (v2 §8 rule 5). */
const riskFits = (risk: Run["risk"], plan: WeavraComplexPlan) => risk !== "R3" || sequential(plan);

/** Plan rules that need the parent: bound identity, complete coverage and mapped check selection. */
function planFitsParent(
  plan: WeavraComplexPlan,
  criteria: ReadonlyArray<Criterion>,
  parentDigest: string,
) {
  const byId = new Map(criteria.map((criterion) => [criterion.id, criterion]));
  const registered = new Set(plan.integration.checkIds);
  const covered = new Set(plan.tasks.flatMap((task) => task.criterionIds));
  return (
    complexPlanDigest(plan) === plan.complexPlanDigest &&
    plan.parentTaskContractDigest === parentDigest &&
    criteria.every(
      (criterion, index) =>
        criterion.id === `AC-${String(index + 1).padStart(3, "0")}` &&
        criterion.reviewRequired &&
        criterion.checkIds.every((id) => registered.has(id)),
    ) &&
    sameList(
      plan.integration.criterionIds,
      criteria.map((criterion) => criterion.id),
    ) &&
    covered.size === criteria.length &&
    plan.tasks.every((task) => {
      const mapped = new Set(task.criterionIds.flatMap((id) => byId.get(id)?.checkIds ?? []));
      return (
        task.criterionIds.every((id) => byId.has(id)) && task.checkIds.every((id) => mapped.has(id))
      );
    })
  );
}

/** Unusable digest material is an inconsistency to reject, never a server defect. */
function total(check: () => boolean) {
  try {
    return check();
  } catch {
    return false;
  }
}

/**
 * §10.3 preview checks; the opaque previewDigest is only echoed on confirmation, never rebuilt.
 * The plan must have exactly the contract version this connection advertised.
 */
export function complexPreviewConsistent(
  preview: WeavraControlPreview,
  version: ContractVersion | undefined,
): boolean {
  const plan = preview.complexPlan;
  if (!plan) return preview.workflow !== "COMPLEX";
  return total(() => {
    const parentDigest = previewTaskContractDigest(preview, plan.parentTaskId);
    return (
      plan.schemaVersion === version &&
      preview.workflow === "COMPLEX" &&
      preview.recipe === null &&
      riskFits(preview.risk, plan) &&
      preview.taskContractDigest === parentDigest &&
      sameList(plan.integration.checkIds, preview.checks.map((check) => check.id).sort()) &&
      (preview.executionMode === "EDIT" ||
        plan.tasks.every((task) => task.ownership.length === 0)) &&
      planFitsParent(plan, preview.acceptanceCriteria, parentDigest)
    );
  });
}

const ACTIVE = new Set<WeavraComplexTaskState["status"]>([
  "ELIGIBLE",
  "IMPLEMENTING",
  "WAITING_APPROVAL",
  "HANDED_OFF",
  "SELF_CHECK",
  "REVIEW",
  "TEST",
  "STOPPING",
]);
const VERIFYING = new Set<WeavraComplexTaskState["status"]>(["SELF_CHECK", "REVIEW", "TEST"]);
const FINISHED = new Set<WeavraComplexTaskState["status"]>([
  "COMPLETED",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
]);
const TERMINAL_RUN = new Set<Run["status"]>([
  "BLOCKED",
  "FAILED",
  "CANCELLED",
  "INTERRUPTED",
  "COMPLETED",
]);
const INTEGRATION = new Set<WeavraComplexExecution["phase"]>([
  "INTEGRATION_CHECK",
  "FINAL_REVIEW",
  "FINAL_TEST",
  "COMPLETING",
]);
const PHASE_ORDER: Record<WeavraComplexExecution["phase"], number> = {
  TASK_SEQUENCE: 0,
  INTEGRATION_CHECK: 1,
  FINAL_REVIEW: 2,
  FINAL_TEST: 3,
  COMPLETING: 4,
  STOPPING: 5,
  TERMINAL: 6,
};
/** A later gate of the same attempt runs only after the earlier gate passed. */
const ordered = (first: string, second: string, third: string) =>
  (second === "NOT_RUN" || first === "PASS") && (third === "NOT_RUN" || second === "PASS");
const sum = (values: ReadonlyArray<number>) => values.reduce((total, value) => total + value, 0);

function rowConsistent(
  row: WeavraComplexTaskState,
  task: WeavraComplexTask | undefined,
  rows: ReadonlyArray<WeavraComplexTaskState>,
  index: number,
  inOrder: boolean,
) {
  if (!task || row.id !== task.id) return false;
  if (row.status === "PENDING")
    return (
      row.attempt === 0 &&
      row.revisionCycle === 0 &&
      row.workerInvocations === 0 &&
      row.reportedTokens === 0 &&
      row.entryWorkspaceDigest === null &&
      row.exitWorkspaceDigest === null &&
      row.changedFiles.length === 0 &&
      !row.changesUnknown &&
      row.selfCheck === "NOT_RUN" &&
      row.review === "NOT_RUN" &&
      row.test === "NOT_RUN" &&
      row.evidenceFreshness === "NONE" &&
      row.failureCode === null
    );
  const claims = new Set(task.ownership.map((claim) => claim.path));
  const completed = (id: string) =>
    rows.some((item) => item.id === id && item.status === "COMPLETED");
  // v2 rule 2: an active or COMPLETED row needs its declared dependencies COMPLETED; sequential
  // plans (v1, or maxParallel = 1) need every earlier row COMPLETED, the V0.7B rule.
  const ready = inOrder
    ? rows.slice(0, index).every((before) => before.status === "COMPLETED")
    : task.dependsOn.every(completed);
  return (
    (row.attempt === 0 ? row.revisionCycle === 0 : row.attempt === row.revisionCycle + 1) &&
    row.revisionCycle <= task.maxRevisionCycles &&
    // One Developer and one Reviewer at most per attempt.
    row.workerInvocations <= 2 * row.attempt &&
    (row.attempt > 0 ||
      (row.selfCheck === "NOT_RUN" && row.review === "NOT_RUN" && row.test === "NOT_RUN")) &&
    (row.attempt === 0 ||
      row.entryWorkspaceDigest !== null ||
      row.failureCode !== null ||
      row.changesUnknown) &&
    row.changedFiles.every((path) => claims.has(path)) &&
    ordered(row.selfCheck, row.review, row.test) &&
    ((!ACTIVE.has(row.status) && row.status !== "COMPLETED") || ready) &&
    // v2 rule 5: implemented and entry-captured, every gate still waiting for its verification turn.
    (row.status !== "HANDED_OFF" ||
      (row.attempt >= 1 &&
        row.entryWorkspaceDigest !== null &&
        row.selfCheck === "NOT_RUN" &&
        row.review === "NOT_RUN" &&
        row.test === "NOT_RUN")) &&
    (row.status !== "COMPLETED" ||
      (row.attempt >= 1 &&
        row.selfCheck === "PASS" &&
        row.review === "PASS" &&
        row.test === "PASS" &&
        row.exitWorkspaceDigest !== null &&
        row.evidenceFreshness !== "NONE" &&
        row.failureCode === null))
  );
}

/**
 * Which rows are active, and which may be active together. v1 has at most one active row. v2 lists
 * every active row (rule 1) and constrains the rows doing work (rules 3 and 4); rows only ELIGIBLE,
 * HANDED_OFF or STOPPING are between those states (wave formation, join, settlement).
 */
function activeRowsConsistent(
  execution: WeavraComplexExecution,
  active: ReadonlyArray<WeavraComplexTaskState>,
) {
  if (execution.schemaVersion === 1)
    return active.length <= 1 && execution.activeTaskId === (active[0]?.id ?? null);
  // A revising row (attempt ≥ 2) re-implements alone during its verification turn.
  const verifying = active.filter(
    (row) => VERIFYING.has(row.status) || (row.status === "IMPLEMENTING" && row.attempt >= 2),
  );
  const implementing = active.filter(
    (row) =>
      row.status === "WAITING_APPROVAL" || (row.status === "IMPLEMENTING" && row.attempt < 2),
  );
  const othersHandedOff = (working: ReadonlyArray<WeavraComplexTaskState>) =>
    active.every((row) => working.includes(row) || row.status === "HANDED_OFF");
  return (
    // Rule 1: exactly the active rows, in plan order, never more than maxParallel. Integration and
    // TERMINAL need every row COMPLETED or finished, so the list is empty there.
    sameList(
      execution.activeTaskIds,
      active.map((row) => row.id),
    ) &&
    active.length <= execution.plan.limits.maxParallel &&
    // Rule 3: first attempts implement together; the other active rows wait HANDED_OFF.
    (implementing.length === 0 || (verifying.length === 0 && othersHandedOff(implementing))) &&
    // Rule 4: one row verifies at a time on a quiescent workspace, never beside a first attempt.
    (verifying.length === 0 ||
      (verifying.length === 1 && implementing.length === 0 && othersHandedOff(verifying)))
  );
}

function executionConsistent(execution: WeavraComplexExecution, run: Run) {
  const { plan, parent, tasks, integration, budget } = execution;
  const parentDigest = taskContractDigest(parent);
  const active = tasks.filter((row) => ACTIVE.has(row.status));
  const inOrder = sequential(plan);
  const integrationGates = [integration.check, integration.review, integration.test];
  const gates = [
    ...tasks.flatMap((row) => [row.selfCheck, row.review, row.test]),
    ...integrationGates,
  ];
  const taskInvocations = sum(tasks.map((row) => row.workerInvocations));
  return (
    plan.parentTaskId === parent.id &&
    (run.taskContractDigest === null || run.taskContractDigest === parentDigest) &&
    planFitsParent(
      plan,
      parent.acceptanceCriteria.map((criterion) => ({
        id: criterion.id,
        checkIds: criterion.verification.checkIds,
        reviewRequired: criterion.verification.reviewRequired,
      })),
      parentDigest,
    ) &&
    // Task success never marks the parent; only final Run completion does.
    (parent.status !== "completed" || run.status === "COMPLETED") &&
    riskFits(run.risk, plan) &&
    tasks.length === plan.tasks.length &&
    tasks.every((row, index) => rowConsistent(row, plan.tasks[index], tasks, index, inOrder)) &&
    activeRowsConsistent(execution, active) &&
    (!tasks.some((row) => row.status === "WAITING_APPROVAL") ||
      run.status === "WAITING_APPROVAL") &&
    (execution.phase === "TERMINAL") === TERMINAL_RUN.has(run.status) &&
    (execution.phase !== "TASK_SEQUENCE" || integrationGates.every((gate) => gate === "NOT_RUN")) &&
    (!INTEGRATION.has(execution.phase) || tasks.every((row) => row.status === "COMPLETED")) &&
    (execution.phase !== "TERMINAL" ||
      (tasks.every((row) => FINISHED.has(row.status)) && !gates.includes("RUNNING"))) &&
    ordered(integration.check, integration.review, integration.test) &&
    (budget.status === "UNKNOWN") === (budget.reportedTokens === null) &&
    (budget.reportedTokens === null ||
      budget.reportedTokens < plan.limits.maxReportedTokens ||
      budget.status === "EXHAUSTED") &&
    budget.workerInvocations <= plan.limits.maxWorkerInvocations &&
    // Task subtotals plus at most one final integration Reviewer form the one global ledger.
    taskInvocations <= budget.workerInvocations &&
    budget.workerInvocations <= taskInvocations + 1 &&
    budget.totalRevisionCycles <= plan.limits.maxTotalRevisionCycles &&
    sum(tasks.map((row) => row.revisionCycle)) === budget.totalRevisionCycles &&
    (run.status === "INTERRUPTED" ||
      !TERMINAL_RUN.has(run.status) ||
      execution.cleanup === "CONFIRMED") &&
    // All tasks COMPLETED alone never implies Run completion.
    (run.status !== "COMPLETED" ||
      (tasks.every((row) => row.status === "COMPLETED") &&
        integrationGates.every((gate) => gate === "PASS") &&
        integration.evidenceFreshness === "CURRENT" &&
        integration.workspaceDigest !== null &&
        integration.failureCode === null &&
        execution.failureCode === null &&
        budget.status === "WITHIN_LIMITS"))
  );
}

/** Canonical execution data; owner and project revision are observation-envelope values. */
function canonicalExecution(execution: WeavraComplexExecution) {
  const { ownerId: _owner, projectRevision: _project, ...data } = execution;
  return canonicalJson(data);
}
function frozenParent(parent: WeavraTaskContract) {
  const { status: _status, ...identity } = parent;
  return canonicalJson(identity);
}

/** Same Run: frozen parent/plan, no regression and no terminal re-entry. */
function transitionConsistent(before: WeavraComplexExecution, after: WeavraComplexExecution) {
  if (after.stateRevision === before.stateRevision)
    return canonicalExecution(before) === canonicalExecution(after);
  const tokens = (previous: number | null, next: number | null) =>
    previous === null || next === null || next >= previous;
  return (
    after.stateRevision > before.stateRevision &&
    frozenParent(before.parent) === frozenParent(after.parent) &&
    canonicalJson(before.plan) === canonicalJson(after.plan) &&
    PHASE_ORDER[after.phase] >= PHASE_ORDER[before.phase] &&
    after.budget.workerInvocations >= before.budget.workerInvocations &&
    after.budget.totalRevisionCycles >= before.budget.totalRevisionCycles &&
    // Unknown usage is sticky.
    (before.budget.reportedTokens !== null || after.budget.reportedTokens === null) &&
    tokens(before.budget.reportedTokens, after.budget.reportedTokens) &&
    after.tasks.every((row, index) => {
      const prior = before.tasks[index];
      return (
        prior !== undefined &&
        row.attempt >= prior.attempt &&
        row.revisionCycle >= prior.revisionCycle &&
        row.workerInvocations >= prior.workerInvocations &&
        tokens(prior.reportedTokens, row.reportedTokens) &&
        (prior.status === "PENDING" || row.status !== "PENDING") &&
        (!FINISHED.has(prior.status) || row.status === prior.status)
      );
    }) &&
    (before.phase !== "TERMINAL" ||
      (after.failureCode === before.failureCode &&
        after.integration.check === before.integration.check &&
        after.integration.review === before.integration.review &&
        after.integration.test === before.integration.test))
  );
}

/**
 * §10.3 presence and §11.1 consistency for one checked snapshot. An advertised Runtime whose
 * latest Run is COMPLEX must include the projection; an unadvertised one must never send it.
 * Every COMPLEX shape has exactly the advertised contract version, so versions never mix on one
 * connection.
 */
export function complexStateConsistent(
  state: WeavraControlState,
  capabilities: WeavraControlCapabilities,
  previous: WeavraControlState | null,
): boolean {
  const version = capabilities.complexContractVersion;
  const execution = state.complexExecution;
  const run = state.snapshot.status.run;
  if (state.preview && !complexPreviewConsistent(state.preview, version)) return false;
  if (!execution) return version === undefined || run?.workflow !== "COMPLEX";
  if (execution.schemaVersion !== version) return false;
  const before = previous?.complexExecution;
  return total(
    () =>
      run !== null &&
      executionConsistent(execution, run) &&
      // A new Run replaces the projection; nothing is merged from an older one. So does the
      // first snapshot of a reconnected Runtime with another contract version: the old
      // observation came from a different connection and its shape is not comparable.
      (before === undefined ||
        before.runId !== execution.runId ||
        before.schemaVersion !== execution.schemaVersion ||
        (transitionConsistent(before, execution) &&
          (before.phase !== "TERMINAL" || previous?.snapshot.status.run?.status === run.status))),
  );
}
