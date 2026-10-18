import {
  CommandId,
  WeavraTaskId,
  WeavraTaskAnalyzeInput,
  WeavraTaskCreateInput,
  WeavraTaskDraft,
  WeavraTaskPreview,
  WeavraTaskPrepareReason,
  WeavraTaskExecution,
  WeavraTaskRunMetadata,
  WeavraAdmissionOutcome,
  WeavraCheckoutIdentity,
  type WeavraTaskFailureSummary,
  type WeavraTaskScopeInput,
  type WeavraEvidenceCursor,
  type WeavraControlState,
  type WeavraTask,
  type WeavraTaskReadInput,
  type WeavraTaskReceipt,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { WorkspaceExecutionOwnership } from "../workspace/WorkspaceExecutionOwnership.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { RuntimeController } from "./RuntimeController.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { commitDirtyBaseline } from "./ProjectDirtyBaseline.ts";

const decodeExecution = Schema.decodeUnknownOption(WeavraTaskExecution);
const sameCheckout = Schema.toEquivalence(WeavraCheckoutIdentity);
const samePreview = Schema.toEquivalence(WeavraTaskPreview);
const decodePreview = Schema.decodeUnknownOption(WeavraTaskPreview);
const decodeCreate = Schema.decodeUnknownEffect(WeavraTaskCreateInput);
const decodeAnalyze = Schema.decodeUnknownEffect(WeavraTaskAnalyzeInput);
const decodeDraft = Schema.decodeUnknownEffect(WeavraTaskDraft);
const sameMetadata = Schema.toEquivalence(WeavraTaskRunMetadata);
const sameOutcome = Schema.toEquivalence(WeavraAdmissionOutcome);
const terminalRun = (status: string) =>
  ["COMPLETED", "CANCELLED", "FAILED", "BLOCKED", "INTERRUPTED"].includes(status);

export interface TaskRunSelection {
  /** Expectations only. The command's Run identity always comes from the receipt. */
  readonly expectedRunId: string;
  readonly expectedStateRevision: number;
}
export interface TaskApprovalDecision extends TaskRunSelection {
  readonly approvalId: string;
  readonly decision: "approve" | "reject";
}
export interface TaskEvidencePage {
  readonly revision: number;
  readonly diffDigest: string | null;
  readonly cursor: WeavraEvidenceCursor;
}

export class TaskCoordinatorError extends Schema.TaggedError<TaskCoordinatorError>()(
  "TaskCoordinatorError",
  Schema.Struct({
    code: Schema.Literals([
      "TARGET_CHANGED",
      "PROJECT_NOT_CONFIGURED",
      "PROJECT_PREPARATION_BUSY",
      "PROJECT_PREPARATION_FAILED",
      "WORKSPACE_EVIDENCE_CAPACITY",
      "WORKSPACE_EVIDENCE_UNSUPPORTED",
      "WORKSPACE_EVIDENCE_UNAVAILABLE",
      "NOT_PREPARED",
      "RUNTIME_UNAVAILABLE",
      "INVALID_RECEIPT",
      "PREPARE_REJECTED",
      "REPREPARE_REQUIRED",
      "STALE_REVISION",
      "COMMAND_CONFLICT",
      "RUN_MISMATCH",
      "APPROVAL_MISMATCH",
      "ALREADY_CONFIRMED",
      "CLEANUP_UNPROVEN",
      "TERMINAL_ACTIVE",
      "RECOVERY_UNAVAILABLE",
      "RECOVERY_UNKNOWN",
      "RECOVERY_BUSY",
      "RECOVERY_OWNER_UNPROVEN",
      "RECOVERY_STALE",
      "RECOVERY_CONFLICT",
      "DIRTY_SET_CHANGED",
      "DIRTY_BASELINE_REFUSED",

      "ANALYSIS_UNAVAILABLE",
      "UNSUPPORTED_PROVIDER",
    ]),
    prepareReason: Schema.optionalKey(WeavraTaskPrepareReason),
  }).check(
    Schema.makeFilter(
      (error) => error.prepareReason === undefined || error.code === "PREPARE_REJECTED",
    ),
  ),
) {}

/**
 * Server-only authority. Callers supply selectors and reviewed content, never a
 * checkout, execution binding, Runtime request envelope, or completion status.
 */
export const make = Effect.fn("weavra.taskCoordinator.make")(function* () {
  const ownership = yield* WorkspaceExecutionOwnership;
  const controller = yield* RuntimeController;
  const crypto = yield* Crypto.Crypto;
  const fs = yield* FileSystem.FileSystem;
  const query = yield* ProjectionSnapshotQuery;
  const dependencies = yield* Effect.context<
    ProjectionSnapshotQuery | OrchestrationEngineService
  >();
  const locks = new Map<string, Semaphore.Semaphore>();
  const serial = <A, E, R>(id: string, effect: Effect.Effect<A, E, R>) => {
    let lock = locks.get(id);
    if (!lock) {
      lock = Semaphore.makeUnsafe(1);
      locks.set(id, lock);
    }
    return lock.withPermits(1)(effect.pipe(Effect.provide(dependencies)));
  };
  const resolve = Effect.fn("weavra.taskCoordinator.resolve")(function* (
    input: WeavraTaskScopeInput,
  ) {
    if (input.environmentId !== ownership.environmentId)
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    const selected = yield* ownership.resolveTarget(input.threadId).pipe(
      Effect.catchTag("WorkspaceOwnershipError", (error) =>
        Effect.fail(
          new TaskCoordinatorError({
            code: error.reason === "target-changed" ? "TARGET_CHANGED" : "RUNTIME_UNAVAILABLE",
          }),
        ),
      ),
    );
    if (selected.projectId !== input.projectId)
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    return selected;
  });
  const readTask = Effect.fn("weavra.taskCoordinator.read")(function* (input: WeavraTaskReadInput) {
    const selected = yield* resolve(input);
    const task = yield* ownership.taskById(input.taskId);
    if (
      task.environmentId !== input.environmentId ||
      task.projectId !== input.projectId ||
      task.threadId !== input.threadId ||
      selected.environmentId !== input.environmentId ||
      selected.projectId !== input.projectId ||
      selected.canonicalCwd !== task.checkout.canonicalCwd ||
      selected.repositoryRoot !== task.checkout.repositoryRoot ||
      selected.target.workspaceRoot !== task.target.workspaceRoot ||
      selected.target.worktreePath !== task.target.worktreePath
    )
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    return task;
  });
  const persist = Effect.fn("weavra.taskCoordinator.persist")(function* (
    task: WeavraTask,
    change: Pick<WeavraTask, "phase" | "context" | "execution" | "failureSummary"> &
      Partial<Pick<WeavraTask, "checkout">>,
  ) {
    const next: WeavraTask = {
      ...task,
      ...change,
      revision: task.revision + 1,
      ownership: { ...task.ownership, generation: task.ownership.generation + 1 },
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    yield* ownership.updateTask({
      type: "thread.weavra-task.set",
      commandId: CommandId.make(`coordinator:${yield* crypto.randomUUIDv4}`),
      threadId: task.threadId,
      expectedRevision: task.revision,
      expectedOwnershipGeneration: task.ownership.generation,
      task: next,
    });
    return next;
  });
  const observe = Effect.fn("weavra.taskCoordinator.observe")(function* (
    task: WeavraTaskScopeInput,
  ) {
    const result = yield* controller.observe(task.projectId, task.threadId).pipe(
      Stream.filter(
        (value) =>
          (!value.stale && value.state !== null) ||
          ["ERROR", "PROTOCOL_MISMATCH", "NOT_INSTALLED", "NOT_SETUP", "CONFIG_INVALID"].includes(
            value.status,
          ),
      ),
      Stream.runHead,
      Effect.timeout("10 seconds"),
      Effect.mapError(() => new TaskCoordinatorError({ code: "RUNTIME_UNAVAILABLE" })),
    );
    if (Option.isNone(result) || result.value.stale || result.value.state === null)
      return yield* new TaskCoordinatorError({ code: "RUNTIME_UNAVAILABLE" });
    return result.value.state;
  });
  const checkout = Effect.fn("weavra.taskCoordinator.checkout")(function* (
    task: WeavraTaskScopeInput,
    // Prepare only: a dirty checkout becomes a refusal that names its paths.
    dirtyRefusal = false,
  ) {
    const response = yield* controller.checkout(
      {
        projectId: task.projectId,
        request: {
          protocolVersion: 1,
          id: `checkout:${yield* crypto.randomUUIDv4}`,
          type: "workflow.checkout",
        },
      },
      task.threadId,
    );
    if (!response.success) {
      switch (response.error.code) {
        case "PROJECT_NOT_CONFIGURED":
        case "WORKSPACE_EVIDENCE_CAPACITY":
        case "WORKSPACE_EVIDENCE_UNSUPPORTED":
        case "WORKSPACE_EVIDENCE_UNAVAILABLE":
          return yield* new TaskCoordinatorError({ code: response.error.code });
        default:
          return yield* new TaskCoordinatorError(
            dirtyRefusal &&
              response.error.code === "PROJECT_CHANGED" &&
              response.error.details !== undefined
              ? {
                  code: "PREPARE_REJECTED",
                  prepareReason: {
                    kind: "runtime",
                    code: response.error.code,
                    details: response.error.details,
                  },
                }
              : { code: "TARGET_CHANGED" },
          );
      }
    }
    if (response.data.kind !== "checkout-identity")
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    return response.data.checkout;
  });
  const create = Effect.fn("weavra.taskCoordinator.create")(function* (
    raw: WeavraTaskCreateInput,
    expectedCwd?: string,
  ) {
    const input = yield* decodeCreate(raw);
    const selected = yield* resolve(input);
    if (expectedCwd !== undefined && selected.canonicalCwd !== expectedCwd)
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    const snapshot = yield* query.getCommandReadModel();
    const duplicate = snapshot.weavraTasks?.find(
      (task) => task.createCommandId === input.commandId,
    );
    if (duplicate) {
      if (
        duplicate.environmentId !== input.environmentId ||
        duplicate.projectId !== input.projectId ||
        duplicate.threadId !== input.threadId
      )
        return yield* new TaskCoordinatorError({ code: "COMMAND_CONFLICT" });
      return yield* readTask({ ...input, taskId: duplicate.id });
    }
    // Runtime owns the checkout hash algorithm. This observation neither acquires
    // its writer nor starts checks/models.
    yield* observe(input);
    const identity = yield* checkout(input);
    if (
      identity.canonicalCwd !== selected.canonicalCwd ||
      identity.repositoryRoot !== selected.repositoryRoot
    )
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    const generation =
      snapshot.weavraOwnership?.find(
        (owner) =>
          owner.environmentId === ownership.environmentId &&
          owner.canonicalCwd === identity.canonicalCwd,
      )?.generation ?? 0;
    const now = DateTime.formatIso(yield* DateTime.now);
    const task: WeavraTask = {
      id: WeavraTaskId.make(yield* crypto.randomUUIDv4),
      createCommandId: input.commandId,
      environmentId: ownership.environmentId,
      projectId: selected.projectId,
      threadId: selected.threadId,
      target: selected.target,
      checkout: identity,
      phase: "analysis",
      revision: 1,
      context: null,
      execution: null,
      ownership: { generation: generation + 1, state: "analysis" },
      createdAt: now,
      updatedAt: now,
    };
    return yield* ownership
      .updateTask({
        type: "thread.weavra-task.set",
        commandId: input.commandId,
        threadId: task.threadId,
        expectedRevision: null,
        expectedOwnershipGeneration: generation,
        task,
      })
      .pipe(
        Effect.as(task),
        // Another service instance may have won the same command. The event/CAS
        // transaction decides the winner; never retry with another task or generation.
        Effect.catch((error) =>
          Effect.gen(function* () {
            const winner = (yield* query.getCommandReadModel()).weavraTasks?.find(
              (value) => value.createCommandId === input.commandId,
            );
            if (
              !winner ||
              winner.environmentId !== input.environmentId ||
              winner.projectId !== input.projectId ||
              winner.threadId !== input.threadId
            )
              return yield* error;
            return yield* readTask({ ...input, taskId: winner.id });
          }),
        ),
      );
  });
  const followup = Effect.fn("weavra.taskCoordinator.followup")(function* (
    raw: WeavraTaskAnalyzeInput,
  ) {
    const input = yield* decodeAnalyze(raw);
    const task = yield* readTask(input.task);
    if (task.revision !== input.expectedRevision)
      return yield* new TaskCoordinatorError({ code: "STALE_REVISION" });
    // Append-only: release races cannot turn this request into provider work.
    yield* (yield* OrchestrationEngineService).dispatch({
      type: "thread.message.user.append",
      commandId: input.commandId,
      threadId: task.threadId,
      message: { messageId: input.messageId, text: input.text, attachments: [] },
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
    return task;
  });
  const currentPreview = Effect.fn("weavra.taskCoordinator.currentPreview")(function* (
    task: WeavraTask,
    state: WeavraControlState,
  ) {
    const saved = task.execution?.preview;
    const live = decodePreview(state.preview);
    if (
      !saved ||
      Option.isNone(live) ||
      !samePreview(saved, live.value) ||
      saved.ownerId !== state.ownerId ||
      saved.projectRevision !== state.projectRevision ||
      saved.expiresAt <= DateTime.toEpochMillis(yield* DateTime.now)
    )
      return yield* new TaskCoordinatorError({ code: "REPREPARE_REQUIRED" });
  });
  const analyze = Effect.fn("weavra.taskCoordinator.analyze")(function* (
    input: WeavraTaskAnalyzeInput,
  ) {
    const task = yield* readTask(input.task);
    if (
      task.revision !== input.expectedRevision ||
      task.phase !== "analysis" ||
      task.ownership.state !== "analysis" ||
      task.execution?.confirmCommandId != null
    )
      return yield* new TaskCoordinatorError({ code: "ANALYSIS_UNAVAILABLE" });
    const thread = yield* query.getThreadShellById(task.threadId);
    if (Option.isNone(thread)) return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    const provider = yield* ProviderService;
    const instance = yield* provider
      .getInstanceInfo(thread.value.modelSelection.instanceId)
      .pipe(Effect.mapError(() => new TaskCoordinatorError({ code: "UNSUPPORTED_PROVIDER" })));
    if (instance.driverKind !== "codex")
      return yield* new TaskCoordinatorError({ code: "UNSUPPORTED_PROVIDER" });
    yield* (yield* OrchestrationEngineService).dispatch({
      type: "thread.turn.start",
      commandId: input.commandId,
      threadId: task.threadId,
      message: {
        messageId: input.messageId,
        role: "user",
        text: input.text,
        attachments: [],
      },
      runtimeMode: thread.value.runtimeMode,
      interactionMode: "plan",
      controlledAnalysis: {
        taskId: task.id,
        expectedRevision: task.revision,
      },
      createdAt: DateTime.formatIso(yield* DateTime.now),
    });
    return task;
  });
  // A receipt is canonical evidence; recovery and observation share the same monotonic checks.
  const persistReceipt = Effect.fn("weavra.taskCoordinator.persistReceipt")(function* (
    task: WeavraTask,
    receipt: WeavraTaskReceipt,
    protect = false,
    failureSummary: WeavraTaskFailureSummary | undefined = undefined,
  ) {
    const execution = task.execution;
    if (execution?.confirmCommandId == null)
      return yield* new TaskCoordinatorError({ code: "NOT_PREPARED" });
    const previousReceipt = execution.receipt;
    if (
      previousReceipt?.status === "FOUND" &&
      (receipt.status === "UNKNOWN" ||
        !sameMetadata(receipt.admission.metadata, previousReceipt.admission.metadata) ||
        receipt.admission.acceptedAt !== previousReceipt.admission.acceptedAt ||
        receipt.admission.updatedAt < previousReceipt.admission.updatedAt ||
        (previousReceipt.admission.cleanup !== undefined &&
          (receipt.admission.cleanup === undefined ||
            (previousReceipt.admission.cleanup === "UNCONFIRMED" &&
              receipt.admission.cleanup === "NOT_STARTED") ||
            (previousReceipt.admission.cleanup === "CONFIRMED" &&
              receipt.admission.cleanup !== "CONFIRMED"))) ||
        (previousReceipt.admission.outcome.status !== "ACCEPTED" &&
          !sameOutcome(receipt.admission.outcome, previousReceipt.admission.outcome)) ||
        (previousReceipt.run !== null &&
          (receipt.run === null ||
            receipt.run.runId !== previousReceipt.run.runId ||
            receipt.run.revision < previousReceipt.run.revision ||
            (receipt.run.status === "CREATED" && previousReceipt.run.status !== "CREATED") ||
            ((terminalRun(previousReceipt.run.status) ||
              receipt.run.revision === previousReceipt.run.revision) &&
              receipt.run.status !== previousReceipt.run.status))))
    )
      return yield* new TaskCoordinatorError({ code: "INVALID_RECEIPT" });
    const terminal =
      receipt.status === "FOUND" &&
      (receipt.run !== null
        ? terminalRun(receipt.run.status)
        : ["START_FAILED", "INTERRUPTED_BEFORE_START"].includes(receipt.admission.outcome.status));
    const settledFailureSummary =
      terminal &&
      receipt.status === "FOUND" &&
      receipt.run !== null &&
      receipt.admission.cleanup === "CONFIRMED"
        ? (failureSummary ?? task.failureSummary)
        : task.failureSummary;
    const decoded = decodeExecution({ ...execution, receipt });
    if (Option.isNone(decoded)) return yield* new TaskCoordinatorError({ code: "INVALID_RECEIPT" });
    task = yield* persist(task, {
      context: task.context,
      execution: decoded.value,
      ...(settledFailureSummary ? { failureSummary: settledFailureSummary } : {}),
      phase:
        protect ||
        (terminal && receipt.status === "FOUND" && receipt.admission.cleanup === "UNCONFIRMED")
          ? "attention-required"
          : terminal
            ? "finished"
            : receipt.status === "UNKNOWN"
              ? "attention-required"
              : receipt.run === null
                ? "handoff"
                : "running",
    });
    if (!terminal || task.phase === "attention-required") return task;
    const fresh = observe(task).pipe(
      Effect.map((state) => ({
        executionId: execution.binding.executionId,
        runtimeIdle: !state.busy && !state.cancelling,
        activeAgentCount: state.snapshot.status.run?.activeAgentCount ?? 0,
        writerPresent: state.snapshot.status.writerPresent !== false,
      })),
    );
    return yield* ownership.releaseAfterCleanup(task.id, fresh);
  });
  const reconcile = Effect.fn("weavra.taskCoordinator.reconcile")(function* (
    input: WeavraTaskReadInput,
  ) {
    let task = yield* readTask(input);
    if (task.ownership.state === "released") return task;
    const execution = task.execution;
    if (execution?.confirmCommandId == null) {
      if (execution === null || task.phase === "attention-required") return task;
      const fresh = yield* observe(task);
      const valid = yield* currentPreview(task, fresh).pipe(Effect.result);
      if (valid._tag === "Success") return task;
      return yield* persist(task, {
        phase: "attention-required",
        context: task.context,
        execution,
      });
    }
    // This is the only recovery side effect before read-only Runtime observation.
    // Failure or UNKNOWN retains quarantine; neither is permission to confirm again.
    task = yield* ownership.reconcile(task.id);
    yield* observe(task);
    const response = yield* controller.receipt(task.projectId, task.threadId, {
      protocolVersion: 1,
      id: `receipt:${yield* crypto.randomUUIDv4}`,
      type: "workflow.receipt",
      executionId: execution.binding.executionId,
    });
    if (!response.success || response.data.kind !== "task-receipt")
      return yield* new TaskCoordinatorError({ code: "RUNTIME_UNAVAILABLE" });
    const receipt: WeavraTaskReceipt = response.data.receipt;
    return yield* persistReceipt(task, receipt, false, response.data.failureSummary);
  });
  const recover = Effect.fn("weavra.taskCoordinator.recover")(function* (
    input: WeavraTaskReadInput,
    expectedRevision: number,
  ) {
    let task = yield* readTask(input);
    if (task.revision !== expectedRevision)
      return yield* new TaskCoordinatorError({ code: "STALE_REVISION" });
    // A settled historical task must not be moved back to reconciliation.
    if (task.ownership.state === "released") return task;
    if (task.execution?.confirmCommandId == null)
      return yield* new TaskCoordinatorError({ code: "NOT_PREPARED" });
    const receipt = task.execution.receipt;
    if (receipt?.status !== "FOUND")
      return yield* new TaskCoordinatorError({ code: "RECOVERY_UNKNOWN" });
    // No prepare, checkout-identity collection, or confirm replay: partial changes are retained.
    task = yield* ownership.reconcile(task.id);
    const state = yield* observe(task);
    const response = yield* ownership
      .withTaskControl(
        task.id,
        controller.command(
          {
            projectId: task.projectId,
            request: {
              protocolVersion: 1,
              id: state.nextRequestId,
              ownerId: state.ownerId,
              expectedProjectRevision: state.projectRevision,
              type: "workflow.recover",
              metadata: receipt.admission.metadata,
            },
          },
          task.threadId,
        ),
      )
      .pipe(
        Effect.catchTag("WeavraControlTransportError", (error) =>
          Effect.gen(function* () {
            if (error.code === "INCOMPATIBLE_CAPABILITIES")
              return yield* new TaskCoordinatorError({ code: "RECOVERY_UNAVAILABLE" });
            if (error.code === "INVALID_PAYLOAD")
              return yield* new TaskCoordinatorError({ code: "INVALID_RECEIPT" });
            return yield* error;
          }),
        ),
      );
    if (!response.success) {
      if (response.error.code === "BUSY")
        return yield* new TaskCoordinatorError({ code: "RECOVERY_BUSY" });
      if (response.error.code === "STALE_PROJECT" || response.error.code === "OWNER_CHANGED")
        return yield* new TaskCoordinatorError({ code: "RECOVERY_STALE" });
      return yield* new TaskCoordinatorError({ code: "RUNTIME_UNAVAILABLE" });
    }
    if (response.data.kind !== "task-recovery")
      return yield* new TaskCoordinatorError({ code: "INVALID_RECEIPT" });
    const data = response.data;
    // Persist canonical interruption even when cleanup is unconfirmed. Do not annotate
    // immutable metadata or manufacture an admission outcome from the disposition.
    task = yield* persistReceipt(
      task,
      data.receipt,
      data.disposition === "NOT_RECOVERED" || data.cleanup === "UNCONFIRMED",
    );
    if (data.disposition === "NOT_RECOVERED") {
      switch (data.reason) {
        case "CLEANUP_UNCONFIRMED":
          return task;
        case "UNKNOWN_ADMISSION":
          return yield* new TaskCoordinatorError({ code: "RECOVERY_UNKNOWN" });
        case "OWNER_UNPROVEN":
          return yield* new TaskCoordinatorError({ code: "RECOVERY_OWNER_UNPROVEN" });
        case "STALE_PROJECT":
          return yield* new TaskCoordinatorError({ code: "RECOVERY_STALE" });
        case "METADATA_MISMATCH":
          return yield* new TaskCoordinatorError({ code: "INVALID_RECEIPT" });
        default:
          return yield* new TaskCoordinatorError({ code: "RECOVERY_CONFLICT" });
      }
    }
    return task;
  });
  const drainForConfirmation = (taskId: WeavraTaskId) =>
    ownership.drain(taskId).pipe(
      Effect.catchTag("WorkspaceOwnershipError", (error) =>
        Effect.gen(function* () {
          if (error.reason === "terminal-active")
            return yield* new TaskCoordinatorError({ code: "TERMINAL_ACTIVE" });
          return yield* error;
        }),
      ),
    );
  const prepare = Effect.fn("weavra.taskCoordinator.prepare")(function* (
    input: WeavraTaskReadInput,
    rawDraft: WeavraTaskDraft,
    expectedRevision: number,
  ) {
    const draft = yield* decodeDraft(rawDraft);
    const { context, goal, acceptanceStatements, symptomVerification } = draft;
    let task = yield* readTask(input);
    if (task.revision !== expectedRevision)
      return yield* new TaskCoordinatorError({ code: "STALE_REVISION" });
    if (
      task.ownership.state !== "analysis" ||
      task.execution?.confirmCommandId != null ||
      task.phase === "attention-required"
    )
      return yield* new TaskCoordinatorError({ code: "NOT_PREPARED" });
    const state = yield* observe(task);
    if (task.execution !== null) yield* currentPreview(task, state);
    // A new context version is durable before asking Runtime to prepare it.
    task = yield* persist(task, { phase: "preparing", context, execution: null });
    const preparing = task;
    const current = yield* checkout(task, true).pipe(
      Effect.tapError((error) =>
        error._tag === "TaskCoordinatorError" && error.code === "PREPARE_REJECTED"
          ? persist(preparing, { phase: "analysis", context, execution: null })
          : Effect.void,
      ),
    );
    if (!sameCheckout(current, task.checkout))
      return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
    const response = yield* ownership
      .withTaskControl(
        task.id,
        controller.command(
          {
            projectId: task.projectId,
            request: {
              protocolVersion: 1,
              id: state.nextRequestId,
              ownerId: state.ownerId,
              expectedProjectRevision: state.projectRevision,
              type: "workflow.prepare",
              goal,
              acceptanceStatements,
              task: {
                taskId: task.id,
                environmentId: task.environmentId,
                projectId: task.projectId,
                threadId: task.threadId,
                checkout: task.checkout,
                analysisContext: context,
                ...(symptomVerification === undefined ? {} : { symptomVerification }),
              },
            },
          },
          task.threadId,
        ),
      )
      .pipe(
        Effect.catchTag("WeavraControlTransportError", (error) =>
          Effect.gen(function* () {
            if (error.code !== "INCOMPATIBLE_CAPABILITIES") return yield* error;
            yield* persist(task, { phase: "analysis", context, execution: null });
            return yield* new TaskCoordinatorError({ code: "RUNTIME_UNAVAILABLE" });
          }),
        ),
      );
    if (!response.success) {
      yield* persist(task, { phase: "analysis", context, execution: null });
      return yield* new TaskCoordinatorError({
        code: "PREPARE_REJECTED",
        prepareReason: {
          kind: "runtime",
          code: response.error.code,
          ...(response.error.details === undefined ? {} : { details: response.error.details }),
        },
      });
    }
    if (
      response.data.kind !== "prepared" ||
      response.data.preview.taskBinding === undefined ||
      response.data.preview.configDigest === undefined
    ) {
      yield* persist(task, { phase: "analysis", context, execution: null });
      return yield* new TaskCoordinatorError({
        code: "PREPARE_REJECTED",
        prepareReason: { kind: "preview", code: "INVALID_PREVIEW" },
      });
    }
    if (response.data.preview.workflow !== "STANDARD") {
      yield* persist(task, { phase: "analysis", context, execution: null });
      return yield* new TaskCoordinatorError({
        code: "PREPARE_REJECTED",
        prepareReason: { kind: "preview", code: "STANDARD_REQUIRED" },
      });
    }
    const decoded = decodePreview(response.data.preview);
    if (Option.isNone(decoded))
      return yield* new TaskCoordinatorError({
        code: "PREPARE_REJECTED",
        prepareReason: { kind: "preview", code: "INVALID_PREVIEW" },
      });
    const preview = decoded.value;
    const symptom = preview.taskBinding.symptomVerification;
    if (
      symptomVerification === undefined
        ? symptom !== undefined
        : symptom === undefined ||
          symptom.checkId !== symptomVerification.checkId ||
          symptom.criterionId !==
            preview.acceptanceCriteria[symptomVerification.criterionIndex - 1]?.id ||
          !preview.checks.some((check) => check.id === symptom.checkId && check.required) ||
          !preview.acceptanceCriteria[symptomVerification.criterionIndex - 1]?.checkIds.includes(
            symptom.checkId,
          )
    )
      return yield* new TaskCoordinatorError({
        code: "PREPARE_REJECTED",
        prepareReason: { kind: "preview", code: "BINDING_MISMATCH" },
      });
    return yield* persist(task, {
      phase: "awaiting-confirmation",
      context,
      execution: {
        binding: preview.taskBinding,
        previewId: preview.previewId,
        previewDigest: preview.previewDigest,
        configDigest: preview.configDigest,
        confirmedProjectRevision: preview.projectRevision,
        confirmCommandId: null,
        receipt: null,
        preview,
      },
    });
  });
  const abortUnconfirmed = Effect.fn("weavra.taskCoordinator.abortUnconfirmed")(function* (
    input: WeavraTaskReadInput,
    expectedRevision: number,
  ) {
    const task = yield* readTask(input);
    if (task.execution?.confirmCommandId != null)
      return yield* new TaskCoordinatorError({ code: "ALREADY_CONFIRMED" });
    if (task.revision !== expectedRevision)
      return yield* new TaskCoordinatorError({ code: "STALE_REVISION" });
    if (task.ownership.state === "released") return task;
    const state = yield* observe(task);
    if (
      state.busy ||
      state.cancelling ||
      state.snapshot.status.writerPresent !== false ||
      (state.snapshot.status.run?.activeAgentCount ?? 0) !== 0 ||
      (yield* fs.exists(`${task.checkout.canonicalCwd}/.ai/writer.lock`))
    )
      return yield* new TaskCoordinatorError({ code: "CLEANUP_UNPROVEN" });
    if (task.ownership.state === "analysis") yield* ownership.closeAdmission(task.id);
    yield* ownership.drain(task.id);
    // releaseAnalysis rechecks the current intent and the now-drained provider
    // lifetime under the ownership mutex. A concurrent confirm cannot release here.
    return yield* ownership.releaseAnalysis(task.id);
  });
  const boundRun = Effect.fn("weavra.taskCoordinator.boundRun")(function* (
    task: WeavraTask,
    selection?: TaskRunSelection,
  ) {
    const receipt = task.execution?.receipt;
    if (
      receipt?.status !== "FOUND" ||
      receipt.run === null ||
      (selection !== undefined && receipt.run.runId !== selection.expectedRunId)
    )
      return yield* new TaskCoordinatorError({ code: "RUN_MISMATCH" });
    return receipt;
  });
  const controlRun = Effect.fn("weavra.taskCoordinator.controlRun")(function* (
    input: WeavraTaskReadInput,
    selection: TaskRunSelection,
    decision?: TaskApprovalDecision,
  ) {
    let task = yield* readTask(input);
    yield* boundRun(task, selection);
    task = yield* reconcile(input);
    const receipt = yield* boundRun(task, selection);
    const run = receipt.run;
    if (run === null || terminalRun(run.status) || task.ownership.state === "released")
      return yield* new TaskCoordinatorError({ code: "RUN_MISMATCH" });
    const state = yield* observe(task);
    if (
      !state.busy ||
      state.ownedRunId !== run.runId ||
      state.snapshot.status.run?.runId !== run.runId ||
      state.stateRevision !== selection.expectedStateRevision
    )
      return yield* new TaskCoordinatorError({ code: "RUN_MISMATCH" });
    if (
      decision &&
      (state.pendingApproval?.approvalId !== decision.approvalId ||
        state.pendingApproval.runId !== run.runId)
    )
      return yield* new TaskCoordinatorError({ code: "APPROVAL_MISMATCH" });
    const response = yield* ownership.withTaskControl(
      task.id,
      controller.command(
        {
          projectId: task.projectId,
          request: {
            protocolVersion: 1,
            id: state.nextRequestId,
            ownerId: state.ownerId,
            expectedProjectRevision: state.projectRevision,
            runId: run.runId,
            expectedStateRevision: selection.expectedStateRevision,
            ...(decision === undefined
              ? { type: "workflow.cancel" as const }
              : {
                  type: "approval.resolve" as const,
                  approvalId: decision.approvalId,
                  decision: decision.decision,
                }),
          },
        },
        task.threadId,
      ),
    );
    if (!response.success || response.data.kind !== "accepted" || response.data.runId !== run.runId)
      return yield* new TaskCoordinatorError({ code: "RUNTIME_UNAVAILABLE" });
    return yield* reconcile(input);
  });
  const listRecoverable = query
    .getCommandReadModel()
    .pipe(
      Effect.map((snapshot) =>
        (snapshot.weavraTasks ?? []).filter(
          (task) =>
            task.environmentId === ownership.environmentId && task.ownership.state !== "released",
        ),
      ),
    );
  return {
    create: (input: WeavraTaskCreateInput, expectedCwd?: string) =>
      serial(`create:${input.threadId}`, create(input, expectedCwd)),
    analyze: (input: WeavraTaskAnalyzeInput) => serial(input.task.taskId, analyze(input)),
    followup: (input: WeavraTaskAnalyzeInput) => serial(input.task.taskId, followup(input)),
    read: (input: WeavraTaskReadInput) => readTask(input).pipe(Effect.provide(dependencies)),
    list: (input: WeavraTaskScopeInput) =>
      Effect.gen(function* () {
        // Discovery reads associations, not checkout admission. A new folder may
        // not have Git yet; create/prepare/confirm still require resolveTarget.
        if (input.environmentId !== ownership.environmentId)
          return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
        const thread = yield* query.getThreadShellById(input.threadId);
        if (Option.isNone(thread) || thread.value.projectId !== input.projectId)
          return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
        const project = yield* query.getProjectShellById(input.projectId);
        if (Option.isNone(project))
          return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
        return (
          (yield* query.getCommandReadModel()).weavraTasks?.filter(
            (task) =>
              task.environmentId === ownership.environmentId &&
              task.projectId === input.projectId &&
              task.threadId === input.threadId,
          ) ?? []
        );
      }).pipe(Effect.provide(dependencies)),
    // Server-only: no client-provided environment or task list.
    listRecoverable,
    reconcileAll: listRecoverable.pipe(
      Effect.flatMap((tasks) =>
        Effect.forEach(tasks, (task) =>
          serial(
            task.id,
            reconcile({
              environmentId: task.environmentId,
              projectId: task.projectId,
              threadId: task.threadId,
              taskId: task.id,
            }),
          ).pipe(
            Effect.result,
            Effect.map((result) => ({ taskId: task.id, result })),
          ),
        ),
      ),
    ),
    prepare: (input: WeavraTaskReadInput, draft: WeavraTaskDraft, expectedRevision: number) =>
      serial(input.taskId, prepare(input, draft, expectedRevision)),
    confirm: (input: WeavraTaskReadInput, commandId: CommandId, expectedRevision: number) =>
      serial(
        input.taskId,
        Effect.gen(function* () {
          let task = yield* readTask(input);
          if (task.execution?.confirmCommandId != null) return yield* reconcile(input);
          if (
            task.phase !== "awaiting-confirmation" ||
            task.execution === null ||
            task.revision !== expectedRevision
          )
            return yield* new TaskCoordinatorError({ code: "NOT_PREPARED" });
          yield* currentPreview(task, yield* observe(task));
          const preparedExecution = task.execution;
          task = yield* ownership.closeAdmission(task.id);
          yield* drainForConfirmation(task.id);
          const state = yield* observe(task);
          yield* currentPreview(task, state);
          if (!sameCheckout(yield* checkout(task), task.checkout))
            return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
          // Persisting intent invalidates the drain generation. Drain again before
          // transfer, and enter control authority only after all durable updates.
          task = yield* persist(task, {
            phase: "handoff",
            context: task.context,
            execution: { ...preparedExecution, confirmCommandId: commandId },
          });
          yield* drainForConfirmation(task.id);
          task = yield* ownership.markRuntime(task.id);
          const execution = task.execution;
          if (execution === null) return yield* new TaskCoordinatorError({ code: "NOT_PREPARED" });
          const response = yield* ownership.withTaskControl(
            task.id,
            controller.command(
              {
                projectId: task.projectId,
                request: {
                  protocolVersion: 1,
                  id: state.nextRequestId,
                  ownerId: state.ownerId,
                  expectedProjectRevision: execution.confirmedProjectRevision,
                  type: "workflow.confirm",
                  previewId: execution.previewId,
                  previewDigest: execution.previewDigest,
                },
              },
              task.threadId,
            ),
          );
          const reconciled = yield* reconcile(input);
          // The receipt stays canonical; a dirty refusal additionally names the paths to review.
          if (!response.success && response.error.details !== undefined)
            return yield* new TaskCoordinatorError({
              code: "PREPARE_REJECTED",
              prepareReason: {
                kind: "runtime",
                code: response.error.code,
                details: response.error.details,
              },
            });
          return reconciled;
        }),
      ),
    recover: (input: WeavraTaskReadInput, expectedRevision: number) =>
      serial(input.taskId, recover(input, expectedRevision)),
    reconcile: (input: WeavraTaskReadInput) => serial(input.taskId, reconcile(input)),
    abortUnconfirmed: (input: WeavraTaskReadInput, expectedRevision: number) =>
      serial(input.taskId, abortUnconfirmed(input, expectedRevision)),
    // Reprepare always creates a new unconfirmed attempt. The old task and its
    // exact reviewed preview remain historical; no Runtime preview is recreated.
    reprepare: (
      input: WeavraTaskReadInput,
      commandId: CommandId,
      draft: WeavraTaskDraft,
      expectedRevision: number,
    ) =>
      serial(
        input.taskId,
        Effect.gen(function* () {
          const parsed = yield* decodeDraft(draft);
          const old = yield* readTask(input);
          if (old.createCommandId === commandId)
            return yield* new TaskCoordinatorError({ code: "COMMAND_CONFLICT" });
          yield* abortUnconfirmed(input, expectedRevision);
          const next = yield* create({
            environmentId: input.environmentId,
            projectId: input.projectId,
            threadId: input.threadId,
            commandId,
          });
          return yield* serial(
            next.id,
            prepare({ ...input, taskId: next.id }, parsed, next.revision),
          );
        }),
      ),
    // Explicit consent only: commit the reviewed dirty paths in this task's own checkout and
    // rebind the task to the new HEAD. Never prepares; the user prepares again.
    commitDirtyBaseline: (
      input: WeavraTaskReadInput,
      expectedRevision: number,
      files: readonly string[],
      consent: boolean,
      protectedRoots: readonly string[],
    ) =>
      serial(
        input.taskId,
        Effect.gen(function* () {
          if (consent !== true)
            return yield* new TaskCoordinatorError({ code: "DIRTY_BASELINE_REFUSED" });
          const task = yield* readTask(input);
          if (task.revision !== expectedRevision)
            return yield* new TaskCoordinatorError({ code: "STALE_REVISION" });
          if (
            task.ownership.state !== "analysis" ||
            task.phase !== "analysis" ||
            task.execution !== null
          )
            return yield* new TaskCoordinatorError({ code: "NOT_PREPARED" });
          const state = yield* observe(task);
          if (
            state.busy ||
            state.cancelling ||
            state.snapshot.status.writerPresent !== false ||
            (yield* fs.exists(`${task.checkout.canonicalCwd}/.ai/writer.lock`))
          )
            return yield* new TaskCoordinatorError({ code: "DIRTY_BASELINE_REFUSED" });
          // A dirty checkout has no Runtime identity to compare; the bound cwd (readTask) and
          // HEAD (checked by commitDirtyBaseline) still bind the commit to this task.
          yield* commitDirtyBaseline({
            cwd: task.checkout.canonicalCwd,
            files,
            consent,
            expectedHead: task.checkout.headCommit,
            protectedRoots,
          }).pipe(
            Effect.mapError(
              (error) =>
                new TaskCoordinatorError({
                  code:
                    error.code === "DIRTY_SET_CHANGED"
                      ? "DIRTY_SET_CHANGED"
                      : error.code === "HEAD_CHANGED"
                        ? "TARGET_CHANGED"
                        : error.code === "UNAVAILABLE"
                          ? "PROJECT_PREPARATION_FAILED"
                          : "DIRTY_BASELINE_REFUSED",
                }),
            ),
          );
          const identity = yield* checkout(task);
          if (
            identity.canonicalCwd !== task.checkout.canonicalCwd ||
            identity.repositoryRoot !== task.checkout.repositoryRoot
          )
            return yield* new TaskCoordinatorError({ code: "TARGET_CHANGED" });
          return yield* persist(task, {
            phase: task.phase,
            context: task.context,
            execution: null,
            checkout: identity,
          });
        }),
      ),
    cancel: (input: WeavraTaskReadInput, selection: TaskRunSelection) =>
      serial(input.taskId, controlRun(input, selection)),
    resolveApproval: (input: WeavraTaskReadInput, decision: TaskApprovalDecision) =>
      serial(input.taskId, controlRun(input, decision, decision)),
    readApproval: (input: WeavraTaskReadInput) =>
      serial(
        input.taskId,
        Effect.gen(function* () {
          const task = yield* readTask(input);
          const receipt = yield* boundRun(task);
          const state = yield* observe(task);
          if (state.pendingApproval === null) return null;
          if (state.pendingApproval.runId !== receipt.run?.runId)
            return yield* new TaskCoordinatorError({ code: "RUN_MISMATCH" });
          return state.pendingApproval;
        }),
      ),
    evidence: (input: WeavraTaskReadInput, page: TaskEvidencePage) =>
      serial(
        input.taskId,
        Effect.gen(function* () {
          const task = yield* readTask(input);
          const receipt = yield* boundRun(task);
          const run = receipt.run;
          if (run === null || run.revision !== page.revision)
            return yield* new TaskCoordinatorError({ code: "RUN_MISMATCH" });
          yield* observe(task);
          const response = yield* controller.evidence(
            {
              projectId: task.projectId,
              request: {
                protocolVersion: 1,
                id: `evidence:${yield* crypto.randomUUIDv4}`,
                type: "workflow.evidence",
                binding: {
                  taskId: task.id,
                  environmentId: task.environmentId,
                  projectId: task.projectId,
                  threadId: task.threadId,
                  executionId: receipt.executionId,
                  runId: run.runId,
                  revision: run.revision,
                  diffDigest: page.diffDigest,
                },
                cursor: page.cursor,
              },
            },
            task.threadId,
          );
          if (
            !response.success ||
            (response.data.kind !== "evidence-details" &&
              response.data.kind !== "evidence-detail-unavailable")
          )
            return yield* new TaskCoordinatorError({ code: "RUNTIME_UNAVAILABLE" });
          return response.data;
        }),
      ),
  };
});

export class TaskCoordinator extends Context.Service<
  TaskCoordinator,
  Effect.Success<ReturnType<typeof make>>
>()("t3/weavra/TaskCoordinator") {}
export const layer = Layer.effect(TaskCoordinator, make());
