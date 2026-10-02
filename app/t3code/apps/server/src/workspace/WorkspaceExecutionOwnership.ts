import {
  CommandId,
  WeavraTaskRunMetadata,
  type ProviderRuntimeEvent,
  type ThreadId,
  type WeavraTask,
  type WeavraTaskId,
  type WeavraTaskSetCommand,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { ServerEnvironment } from "../environment/ServerEnvironment.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import {
  listWeavraOwnership,
  listWeavraTasks,
} from "../orchestration/Layers/WeavraTaskProjection.ts";
import { ProcessRunner } from "../processRunner.ts";

export class WorkspaceOwnershipError extends Schema.TaggedError<WorkspaceOwnershipError>()(
  "WorkspaceOwnershipError",
  {
    cwd: Schema.String,
    reason: Schema.Literals([
      "owned",
      "stale",
      "unavailable",
      "terminal-active",
      "provider-conflict",
      "not-drained",
      "cleanup-unproven",
      "target-changed",
    ]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Workspace '${this.cwd}': ${this.detail}`;
  }
}

export interface WorkspaceAdmission {
  readonly cwd: string;
  readonly paths: ReadonlyArray<string>;
  readonly generations: ReadonlyArray<{ readonly cwd: string; readonly generation: number }>;
}

export interface WorkspaceOperationInput {
  readonly cwd: string;
  readonly kind:
    | "write"
    | "git"
    | "checkpoint"
    | "provider"
    | "provider-admission"
    | "terminal"
    | "control";
  readonly threadId?: string;
  /** Worktree operations affect both their repository metadata and destination. */
  readonly additionalPaths?: ReadonlyArray<string>;
  readonly sharedGitMetadata?: boolean;
  /** An actual file target, not its enclosing checkout (ordinary sibling saves stay free). */
  readonly sharedMetadataTarget?: string;
  /** Captured before a command enters a queue, never supplied by a network client. */
  readonly admission?: WorkspaceAdmission;
  /** Durable orchestration-event fence for commands already waiting in a reactor queue. */
  readonly eventSequence?: number;
}

export interface WorkspaceOperationToken {
  readonly id: symbol;
  readonly cwd: string;
  readonly generation: number;
}

interface Operation {
  readonly token: WorkspaceOperationToken;
  readonly input: WorkspaceOperationInput;
  readonly paths: ReadonlyArray<string>;
  readonly commonDir: string | null;
  readonly controlledAnalysis?: {
    readonly taskId: WeavraTaskId;
    readonly generation: number;
  };
  readonly done: Deferred.Deferred<void>;
  references: number;
  stop?: Effect.Effect<void, WorkspaceOwnershipError>;
}

/** A fresh Runtime observation after worker cleanup, not a terminal Run status. */
export interface RuntimeCleanupEvidence {
  readonly executionId: string;
  readonly runtimeIdle: boolean;
  readonly activeAgentCount: number;
  readonly writerPresent: boolean;
}

const currentOperations = Context.Reference<ReadonlyArray<WorkspaceOperationToken>>(
  "t3/workspace/currentOperations",
  { defaultValue: () => [] },
);
const currentTaskControl = Context.Reference<
  { readonly taskId: WeavraTaskId; readonly generation: number } | undefined
>("t3/workspace/currentTaskControl", { defaultValue: () => undefined });
const currentTaskAnalysis = Context.Reference<
  | {
      readonly taskId: WeavraTaskId;
      readonly generation: number;
      readonly expectedRevision: number;
    }
  | undefined
>("t3/workspace/currentTaskAnalysis", { defaultValue: () => undefined });

// allow: SIZE_OK - one admission mutex owns the durable CAS and all operation reference counts.
export const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* SqlClient.SqlClient;
  const environmentId = yield* (yield* ServerEnvironment).getEnvironmentId;
  const crypto = yield* Crypto.Crypto;
  const processes = yield* ProcessRunner;
  const mutex = yield* Semaphore.make(1);
  const operations = new Map<WorkspaceOperationToken, Operation>();
  const consumers = new Map<string, ReadonlySet<ProviderRuntimeEvent["type"]>>();
  const events = new Map<string, WorkspaceOperationToken>();
  const drainedGenerations = new Map<WeavraTaskId, number>();
  const fail = (cwd: string, reason: WorkspaceOwnershipError["reason"], detail: string) =>
    new WorkspaceOwnershipError({ cwd, reason, detail });
  const unavailable = (cwd: string) => (cause: unknown) =>
    new WorkspaceOwnershipError({
      cwd,
      reason: "unavailable",
      detail: "Ownership could not be established.",
      cause,
    });
  const owners = listWeavraOwnership.pipe(
    Effect.provideService(SqlClient.SqlClient, sql),
    Effect.map((rows) => rows.filter((row) => row.environmentId === environmentId)),
    Effect.mapError(unavailable("")),
  );
  const tasks = listWeavraTasks.pipe(
    Effect.provideService(SqlClient.SqlClient, sql),
    Effect.map((rows) => rows.filter((row) => row.environmentId === environmentId)),
    Effect.mapError(unavailable("")),
  );
  const inside = (parent: string, child: string) => {
    const relative = path.relative(parent, child);
    return (
      relative === "" ||
      (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`))
    );
  };
  const overlaps = (left: string, right: string) => inside(left, right) || inside(right, left);

  // Missing destinations are resolved through their nearest existing ancestor before mkdir.
  const canonicalize = Effect.fn("WorkspaceOwnership.canonicalize")(function* (
    cwd: string,
  ): Effect.fn.Return<string, WorkspaceOwnershipError> {
    const absolute = path.resolve(cwd);
    return yield* fs
      .realPath(absolute)
      .pipe(
        Effect.catch((error) =>
          error.reason._tag === "NotFound" && path.dirname(absolute) !== absolute
            ? canonicalize(path.dirname(absolute)).pipe(
                Effect.map((parent) => path.join(parent, path.basename(absolute))),
              )
            : Effect.fail(unavailable(cwd)(error)),
        ),
      );
  });
  const commonDirectory = Effect.fn("WorkspaceOwnership.commonDirectory")(function* (cwd: string) {
    const result = yield* processes
      .run({
        command: "git",
        args: ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
        timeout: "10 seconds",
      })
      .pipe(Effect.mapError(unavailable(cwd)));
    return result.code === 0 ? yield* canonicalize(result.stdout.trim()) : null;
  });
  const taskById = Effect.fn("WorkspaceOwnership.taskById")(function* (taskId: WeavraTaskId) {
    const task = (yield* tasks).find((entry) => entry.id === taskId);
    if (!task) return yield* fail("", "stale", "The controlled task no longer exists.");
    return task;
  });
  const resolveTarget = Effect.fn("WorkspaceOwnership.resolveTarget")(function* (
    threadId: ThreadId,
  ) {
    const query = yield* ProjectionSnapshotQuery;
    const thread = yield* query.getThreadShellById(threadId).pipe(Effect.mapError(unavailable("")));
    if (Option.isNone(thread))
      return yield* fail("", "target-changed", "The thread is unavailable.");
    const project = yield* query
      .getProjectShellById(thread.value.projectId)
      .pipe(Effect.mapError(unavailable("")));
    if (Option.isNone(project))
      return yield* fail("", "target-changed", "The project is unavailable.");
    const target = {
      workspaceRoot: project.value.workspaceRoot,
      worktreePath: thread.value.worktreePath,
    };
    const canonicalCwd = yield* canonicalize(target.worktreePath ?? target.workspaceRoot);
    const projectRoot = yield* canonicalize(target.workspaceRoot);
    const commonDir = yield* commonDirectory(canonicalCwd);
    if (commonDir === null || commonDir !== (yield* commonDirectory(projectRoot)))
      return yield* fail(
        canonicalCwd,
        "target-changed",
        "The checkout is not in the selected project's repository.",
      );
    // Runtime's checkout identity names this worktree's toplevel, not the
    // project's original worktree. Common-directory membership was checked above.
    const top = yield* processes
      .run({
        command: "git",
        args: ["-C", canonicalCwd, "rev-parse", "--show-toplevel"],
      })
      .pipe(Effect.mapError(unavailable(canonicalCwd)));
    if (top.code !== 0)
      return yield* fail(canonicalCwd, "target-changed", "The checkout root is unavailable.");
    const repositoryRoot = yield* canonicalize(top.stdout.trim());
    return {
      environmentId,
      projectId: project.value.id,
      threadId,
      target,
      canonicalCwd,
      repositoryRoot,
    };
  });
  const release = (token: WorkspaceOperationToken) =>
    mutex.withPermit(
      Effect.gen(function* () {
        const operation = operations.get(token);
        if (!operation) return;
        operation.references--;
        if (operation.references === 0) {
          operations.delete(token);
          yield* Deferred.succeed(operation.done, undefined);
        }
      }),
    );
  const captureAdmission = Effect.fn("WorkspaceOwnership.captureAdmission")(function* (
    cwd: string,
    additionalPaths: ReadonlyArray<string> = [],
  ) {
    const observed = yield* owners;
    const canonicalCwd = yield* canonicalize(cwd);
    const paths = [canonicalCwd, ...(yield* Effect.forEach(additionalPaths, canonicalize))];
    return {
      cwd: canonicalCwd,
      paths,
      generations: observed
        .filter((owner) => paths.some((target) => overlaps(owner.canonicalCwd, target)))
        .map((owner) => ({ cwd: owner.canonicalCwd, generation: owner.generation })),
    } satisfies WorkspaceAdmission;
  });
  const inheritOrigin = Effect.fn("WorkspaceOwnership.inheritOrigin")(function* (
    input: WorkspaceOperationInput,
  ) {
    const inherited = yield* currentOperations;
    const origin = inherited
      .map((token) => operations.get(token))
      .findLast((operation) => operation?.input.eventSequence !== undefined);
    return {
      ...input,
      ...(input.eventSequence === undefined && origin?.input.eventSequence !== undefined
        ? { eventSequence: origin.input.eventSequence }
        : {}),
      ...(input.threadId === undefined && origin?.input.threadId !== undefined
        ? { threadId: origin.input.threadId }
        : {}),
    };
  });
  const acquire = Effect.fn("WorkspaceOwnership.acquire")(function* (
    request: WorkspaceOperationInput,
  ) {
    const input = yield* inheritOrigin(request);
    const admission =
      input.admission ?? (yield* captureAdmission(input.cwd, input.additionalPaths));
    const paths = yield* Effect.forEach(
      [input.cwd, ...(input.additionalPaths ?? [])],
      canonicalize,
    );
    const cwd = paths[0] ?? path.resolve(input.cwd);
    let commonDir = input.sharedGitMetadata ? yield* commonDirectory(cwd) : null;
    if (input.sharedMetadataTarget !== undefined) {
      const target = yield* canonicalize(input.sharedMetadataTarget);
      const fromCwd = yield* commonDirectory(cwd);
      if (fromCwd !== null && inside(fromCwd, target)) {
        commonDir = fromCwd;
      } else {
        let parent = path.dirname(target);
        while (!(yield* fs.exists(parent).pipe(Effect.mapError(unavailable(parent))))) {
          const ancestor = path.dirname(parent);
          if (ancestor === parent)
            return yield* fail(cwd, "unavailable", "The metadata target has no accessible parent.");
          parent = ancestor;
        }
        const fromTarget = yield* commonDirectory(parent);
        if (fromTarget !== null && inside(fromTarget, target)) commonDir = fromTarget;
      }
    }
    const inherited = yield* currentOperations;
    const analysis = yield* currentTaskAnalysis;
    return yield* mutex.withPermit(
      Effect.gen(function* () {
        const parent = inherited
          .map((token) => operations.get(token))
          .find(
            (operation) =>
              operation !== undefined &&
              paths.every((target) => operation.paths.some((root) => inside(root, target))),
          );
        if (
          (analysis !== undefined || parent?.controlledAnalysis !== undefined) &&
          input.kind !== "provider" &&
          input.kind !== "provider-admission"
        )
          return yield* fail(
            cwd,
            "owned",
            "Controlled analysis authority admits provider transport only.",
          );
        if (parent && (commonDir === null || parent.commonDir === commonDir)) {
          parent.references++;
          return parent.token;
        }
        if (analysis !== undefined) {
          const task = yield* taskById(analysis.taskId);
          if (
            task.revision !== analysis.expectedRevision ||
            task.ownership.generation !== analysis.generation ||
            task.ownership.state !== "analysis" ||
            task.phase !== "analysis" ||
            task.execution?.confirmCommandId != null ||
            task.threadId !== input.threadId ||
            task.checkout.canonicalCwd !== cwd ||
            paths.length !== 1 ||
            input.sharedGitMetadata === true ||
            input.sharedMetadataTarget !== undefined
          )
            return yield* fail(
              cwd,
              "stale",
              "Controlled analysis authority no longer matches the active task.",
            );
          const token: WorkspaceOperationToken = {
            id: Symbol("task-analysis-provider"),
            cwd,
            generation: task.ownership.generation,
          };
          operations.set(token, {
            token,
            input,
            paths,
            commonDir: null,
            controlledAnalysis: {
              taskId: task.id,
              generation: task.ownership.generation,
            },
            references: 1,
            done: yield* Deferred.make<void>(),
          });
          return token;
        }
        if (input.threadId !== undefined) {
          const bindings = yield* sql<{ readonly canonicalCwd: string }>`
            SELECT canonical_cwd AS "canonicalCwd" FROM projection_weavra_tasks
            WHERE environment_id = ${environmentId} AND thread_id = ${input.threadId}
              AND ownership_state <> 'released'
          `.pipe(Effect.mapError(unavailable(cwd)));
          if (
            bindings.some(
              (binding) => !paths.some((target) => overlaps(binding.canonicalCwd, target)),
            )
          )
            return yield* fail(
              cwd,
              "target-changed",
              "This thread still owns a different controlled checkout. Reconcile that task before changing its target.",
            );
        }
        const rows = yield* owners;
        if (input.eventSequence !== undefined) {
          const changes = yield* sql<{ readonly cwd: string; readonly threadId: string }>`
            SELECT DISTINCT json_extract(payload_json, '$.task.checkout.canonicalCwd') AS cwd,
              json_extract(payload_json, '$.task.threadId') AS "threadId"
            FROM orchestration_events
            WHERE sequence > ${input.eventSequence} AND event_type = 'thread.weavra-task-set'
              AND json_extract(payload_json, '$.task.environmentId') = ${environmentId}
          `.pipe(Effect.mapError(unavailable(cwd)));
          if (
            changes.some(
              (change) =>
                !parent?.paths.some((root) => overlaps(root, change.cwd)) &&
                (change.threadId === input.threadId ||
                  paths.some((target) => overlaps(change.cwd, target))),
            )
          )
            return yield* fail(
              cwd,
              "stale",
              "This queued command predates an ownership generation change.",
            );
        }
        const currentGenerations = rows.filter((owner) =>
          paths.some((target) => overlaps(owner.canonicalCwd, target)),
        );
        if (
          !parent &&
          (paths.length !== admission.paths.length ||
            paths.some((target, index) => target !== admission.paths[index]) ||
            currentGenerations.length !== admission.generations.length ||
            currentGenerations.some(
              (owner) =>
                !admission.generations.some(
                  (observed) =>
                    observed.cwd === owner.canonicalCwd && observed.generation === owner.generation,
                ),
            ))
        )
          return yield* fail(
            cwd,
            "stale",
            "Ownership changed while this operation was queued. Submit a new request.",
          );
        for (const owner of rows) {
          if (owner.state === "released") continue;
          // An admitted operation may finish in its own checkout after admission closes.
          // Expanding into a sibling's shared Git metadata still needs a separate admission.
          if (parent?.paths.some((root) => overlaps(root, owner.canonicalCwd))) continue;
          if (
            paths.some((target) => overlaps(owner.canonicalCwd, target)) ||
            (commonDir !== null && commonDir === (yield* commonDirectory(owner.canonicalCwd)))
          )
            return yield* fail(
              cwd,
              "owned",
              `Controlled task '${owner.taskId}' owns this checkout (${owner.state}).`,
            );
        }
        const token: WorkspaceOperationToken = {
          id: parent?.token.id ?? Symbol(input.kind),
          cwd,
          generation:
            parent?.token.generation ??
            rows.find((row) => row.canonicalCwd === cwd)?.generation ??
            0,
        };
        operations.set(token, {
          token,
          input,
          paths,
          commonDir,
          references: 1,
          done: yield* Deferred.make<void>(),
        });
        return token;
      }),
    );
  });
  const use = <A, E, R>(token: WorkspaceOperationToken, effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const inherited = yield* currentOperations;
      return yield* Effect.acquireUseRelease(
        mutex.withPermit(
          Effect.gen(function* () {
            const operation = operations.get(token);
            if (!operation)
              return yield* fail(token.cwd, "stale", "The operation token has expired.");
            operation.references++;
          }),
        ),
        () => effect.pipe(Effect.provideService(currentOperations, [...inherited, token])),
        () => release(token),
      );
    });
  const withOperation = <A, E, R>(input: WorkspaceOperationInput, effect: Effect.Effect<A, E, R>) =>
    Effect.acquireUseRelease(acquire(input), (token) => use(token, effect), release);
  const acquireIndependent = (input: WorkspaceOperationInput) =>
    inheritOrigin(input).pipe(
      Effect.flatMap((request) =>
        acquire(request).pipe(Effect.provideService(currentOperations, [])),
      ),
    );
  const withFreshOperation = <A, E, R>(
    input: WorkspaceOperationInput,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.acquireUseRelease(acquireIndependent(input), (token) => use(token, effect), release);
  /** Retain the admitted operation before handing work to another queue/fiber. */
  const bind = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    Effect.gen(function* () {
      const inherited = yield* currentOperations;
      const token = inherited.findLast((candidate) => operations.has(candidate));
      if (!token) return effect;
      const operation = operations.get(token);
      if (!operation) return effect;
      operation.references++;
      return use(token, effect).pipe(Effect.ensuring(release(token)));
    });

  const setTask = (command: WeavraTaskSetCommand) =>
    Effect.gen(function* () {
      if (command.task.environmentId !== environmentId)
        return yield* fail(
          command.task.checkout.canonicalCwd,
          "target-changed",
          "The task belongs to another server environment.",
        );
      const engine = yield* OrchestrationEngineService;
      return yield* engine
        .dispatch(command)
        .pipe(Effect.mapError(unavailable(command.task.checkout.canonicalCwd)));
    });
  const transition = Effect.fn("WorkspaceOwnership.transition")(function* (
    task: WeavraTask,
    state: WeavraTask["ownership"]["state"],
  ) {
    const next: WeavraTask = {
      ...task,
      phase:
        state === "released"
          ? "finished"
          : state === "runtime"
            ? task.phase
            : state === "draining"
              ? "handoff"
              : "attention-required",
      revision: task.revision + 1,
      ownership: { generation: task.ownership.generation + 1, state },
      updatedAt: DateTime.formatIso(yield* DateTime.now),
    };
    yield* setTask({
      type: "thread.weavra-task.set",
      commandId: CommandId.make(`ownership:${yield* crypto.randomUUIDv4}`),
      threadId: task.threadId,
      expectedRevision: task.revision,
      expectedOwnershipGeneration: task.ownership.generation,
      task: next,
    });
    return next;
  });
  const relevant = Effect.fn("WorkspaceOwnership.relevant")(function* (task: WeavraTask) {
    const commonDir = yield* commonDirectory(task.checkout.canonicalCwd);
    return [...operations.values()].filter(
      (operation) =>
        operation.paths.some((cwd) => overlaps(cwd, task.checkout.canonicalCwd)) ||
        (commonDir !== null && operation.commonDir === commonDir),
    );
  });
  const assertTarget = Effect.fn("WorkspaceOwnership.assertTarget")(function* (task: WeavraTask) {
    const selected = yield* resolveTarget(task.threadId);
    if (
      selected.canonicalCwd !== task.checkout.canonicalCwd ||
      selected.repositoryRoot !== task.checkout.repositoryRoot ||
      selected.target.worktreePath !== task.target.worktreePath ||
      selected.target.workspaceRoot !== task.target.workspaceRoot
    )
      return yield* fail(
        task.checkout.canonicalCwd,
        "target-changed",
        "The thread's selected checkout changed.",
      );
  });
  const closeAdmission = (taskId: WeavraTaskId) =>
    mutex.withPermit(
      Effect.gen(function* () {
        const task = yield* taskById(taskId);
        if (task.ownership.state === "draining") return task;
        if (task.ownership.state !== "analysis")
          return yield* fail(
            task.checkout.canonicalCwd,
            "stale",
            "Only an analysis owner can begin handoff.",
          );
        yield* assertTarget(task);
        return yield* transition(task, "draining");
      }),
    );
  const drain = Effect.fn("WorkspaceOwnership.drain")(function* (taskId: WeavraTaskId) {
    const task = yield* taskById(taskId);
    if (task.ownership.state !== "draining")
      return yield* fail(task.checkout.canonicalCwd, "stale", "Close admission before draining.");
    const active = yield* relevant(task);
    if (active.some((operation) => operation.input.kind === "terminal"))
      return yield* fail(
        task.checkout.canonicalCwd,
        "terminal-active",
        "Close the active terminal before handing off this checkout.",
      );
    if (
      active.some(
        (operation) =>
          (operation.input.kind === "provider" || operation.input.kind === "provider-admission") &&
          operation.input.threadId !== task.threadId,
      )
    )
      return yield* fail(
        task.checkout.canonicalCwd,
        "provider-conflict",
        "Another thread has a live provider in this checkout. Stop it explicitly.",
      );
    if (
      active.some(
        (operation) =>
          operation.input.kind === "control" && operation.input.threadId !== task.threadId,
      )
    )
      return yield* fail(
        task.checkout.canonicalCwd,
        "not-drained",
        "An existing Settings Runtime execution has not finished cleanup.",
      );
    // No admission mutex is held while stopping processes or waiting on their final effects.
    for (const operation of active) {
      if (operation.input.kind !== "provider") continue;
      if (!operation.stop)
        return yield* fail(
          task.checkout.canonicalCwd,
          "not-drained",
          "Provider startup or cleanup has not settled.",
        );
      yield* operation.stop;
    }
    // Published events and queue continuations retain their operation here. Draining
    // a global worker would unnecessarily wait for unrelated checkouts.
    for (const operation of yield* relevant(task)) yield* Deferred.await(operation.done);
    yield* mutex.withPermit(
      Effect.gen(function* () {
        const current = yield* taskById(taskId);
        if (
          current.ownership.state !== "draining" ||
          current.ownership.generation !== task.ownership.generation ||
          (yield* relevant(current)).length !== 0
        )
          return yield* fail(
            task.checkout.canonicalCwd,
            "stale",
            "The task changed while draining. Drain the current generation.",
          );
        drainedGenerations.set(task.id, task.ownership.generation);
      }),
    );
  });
  const markRuntime = (taskId: WeavraTaskId) =>
    mutex.withPermit(
      Effect.gen(function* () {
        const task = yield* taskById(taskId);
        if (
          task.ownership.state !== "draining" ||
          drainedGenerations.get(taskId) !== task.ownership.generation ||
          (yield* relevant(task)).length !== 0
        )
          return yield* fail(
            task.checkout.canonicalCwd,
            "not-drained",
            "Managed operations have not drained.",
          );
        yield* assertTarget(task);
        const gitDir = yield* processes
          .run({
            command: "git",
            args: ["-C", task.checkout.canonicalCwd, "rev-parse", "--absolute-git-dir"],
          })
          .pipe(Effect.mapError(unavailable(task.checkout.canonicalCwd)));
        if (gitDir.code !== 0)
          return yield* fail(
            task.checkout.canonicalCwd,
            "unavailable",
            "Git checkout is unavailable.",
          );
        for (const name of [
          "MERGE_HEAD",
          "REBASE_HEAD",
          "CHERRY_PICK_HEAD",
          "REVERT_HEAD",
          "rebase-apply",
          "rebase-merge",
        ]) {
          if (
            yield* fs
              .exists(path.join(gitDir.stdout.trim(), name))
              .pipe(Effect.mapError(unavailable(task.checkout.canonicalCwd)))
          )
            return yield* fail(
              task.checkout.canonicalCwd,
              "not-drained",
              "Finish the active Git operation before handoff.",
            );
        }
        if (
          yield* fs
            .exists(path.join(task.checkout.canonicalCwd, ".ai", "writer.lock"))
            .pipe(Effect.mapError(unavailable(task.checkout.canonicalCwd)))
        )
          return yield* fail(
            task.checkout.canonicalCwd,
            "cleanup-unproven",
            "An existing Runtime writer has not been reconciled.",
          );
        return yield* transition(task, "runtime");
      }),
    );
  const releaseAfterCleanup = <E, R>(
    taskId: WeavraTaskId,
    probe: Effect.Effect<RuntimeCleanupEvidence, E, R>,
  ) =>
    Effect.gen(function* () {
      const before = yield* taskById(taskId);
      const evidence = yield* probe;
      return yield* mutex.withPermit(
        Effect.gen(function* () {
          const task = yield* taskById(taskId);
          const receipt = task.execution?.receipt;
          const terminalReceipt =
            receipt?.status === "FOUND" &&
            (receipt.run !== null
              ? ["COMPLETED", "CANCELLED", "FAILED", "BLOCKED", "INTERRUPTED"].includes(
                  receipt.run.status,
                )
              : ["START_FAILED", "INTERRUPTED_BEFORE_START"].includes(
                  receipt.admission.outcome.status,
                ));
          if (
            task.revision !== before.revision ||
            !terminalReceipt ||
            (receipt?.status === "FOUND" && receipt.admission.cleanup === "UNCONFIRMED") ||
            task.execution?.binding.executionId !== evidence.executionId ||
            !evidence.runtimeIdle ||
            evidence.activeAgentCount !== 0 ||
            evidence.writerPresent ||
            (yield* relevant(task)).length !== 0 ||
            (yield* fs
              .exists(path.join(task.checkout.canonicalCwd, ".ai", "writer.lock"))
              .pipe(Effect.mapError(unavailable(task.checkout.canonicalCwd))))
          )
            return yield* fail(
              task.checkout.canonicalCwd,
              "cleanup-unproven",
              "Runtime cleanup and writer release must both be observed for this exact execution.",
            );
          return yield* transition(task, "released");
        }),
      );
    });
  const registerEventConsumer = (
    name: string,
    types: ReadonlyArray<ProviderRuntimeEvent["type"]>,
  ) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        consumers.set(name, new Set(types));
      }),
      () =>
        Effect.sync(() => {
          consumers.delete(name);
        }),
    );
  const retainProviderEvent = Effect.fn("WorkspaceOwnership.retainProviderEvent")(function* (
    event: ProviderRuntimeEvent,
  ) {
    yield* mutex.withPermit(
      Effect.gen(function* () {
        const parent = [...operations.values()].find(
          (operation) =>
            operation.input.kind === "provider" && operation.input.threadId === event.threadId,
        );
        if (!parent) return;
        for (const [consumer, types] of consumers) {
          if (!types.has(event.type)) continue;
          const key = `${consumer}:${event.eventId}`;
          if (events.has(key)) continue;
          const token = { ...parent.token, id: Symbol(key) };
          operations.set(token, {
            token,
            input: { ...parent.input, kind: "checkpoint" },
            paths: parent.paths,
            commonDir: parent.commonDir,
            ...(parent.controlledAnalysis !== undefined
              ? { controlledAnalysis: parent.controlledAnalysis }
              : {}),
            references: 1,
            done: yield* Deferred.make<void>(),
          });
          events.set(key, token);
        }
      }),
    );
  });
  const withProviderEvent = <A, E, R>(
    consumer: string,
    event: ProviderRuntimeEvent,
    effect: Effect.Effect<A, E, R>,
  ) =>
    Effect.suspend(() => {
      const key = `${consumer}:${event.eventId}`;
      const token = events.get(key);
      if (!token) return effect;
      return use(token, effect).pipe(
        Effect.ensuring(
          Effect.sync(() => {
            events.delete(key);
          }).pipe(Effect.andThen(release(token))),
        ),
      );
    });
  const withControlOperation = <A, E, R>(
    cwd: string,
    request: {
      readonly type: string;
      readonly runId?: string;
      readonly metadata?: WeavraTaskRunMetadata;
    },
    run: (task: WeavraTask | undefined) => Effect.Effect<A, E, R>,
  ) =>
    Effect.gen(function* () {
      const authority = yield* currentTaskControl;
      if (authority === undefined) {
        if (request.type === "workflow.recover")
          return yield* fail(cwd, "owned", "Recovery requires explicit confirmed task authority.");
        return yield* withFreshOperation({ cwd, kind: "write" }, run(undefined));
      }
      const canonicalCwd = yield* canonicalize(cwd);
      return yield* Effect.acquireUseRelease(
        mutex.withPermit(
          Effect.gen(function* () {
            const task = yield* taskById(authority.taskId);
            if (
              task.ownership.generation !== authority.generation ||
              task.checkout.canonicalCwd !== canonicalCwd ||
              task.ownership.state === "released"
            )
              return yield* fail(cwd, "stale", "The task-control authority is stale.");
            switch (request.type) {
              case "workflow.prepare":
                if (
                  !["analysis", "draining"].includes(task.ownership.state) ||
                  task.execution?.confirmCommandId != null
                )
                  return yield* fail(cwd, "owned", "Preparation is closed for this execution.");
                break;
              case "workflow.confirm":
                if (task.ownership.state !== "runtime" || task.execution?.confirmCommandId == null)
                  return yield* fail(
                    cwd,
                    "not-drained",
                    "Persist confirmation intent and transfer ownership before confirming.",
                  );
                break;
              case "workflow.recover": {
                const receipt = task.execution?.receipt;
                if (
                  task.ownership.state !== "reconciling" ||
                  task.execution?.confirmCommandId == null ||
                  receipt?.status !== "FOUND" ||
                  request.metadata === undefined ||
                  !Schema.toEquivalence(WeavraTaskRunMetadata)(
                    request.metadata,
                    receipt.admission.metadata,
                  )
                )
                  return yield* fail(
                    cwd,
                    "target-changed",
                    "Recovery requires this task's confirmed, known execution in reconciliation.",
                  );
                break;
              }
              case "workflow.cancel":
              case "approval.resolve": {
                const receipt = task.execution?.receipt;
                if (
                  request.runId === undefined ||
                  !["runtime", "reconciling"].includes(task.ownership.state) ||
                  receipt?.status !== "FOUND" ||
                  receipt.run?.runId !== request.runId
                )
                  return yield* fail(
                    cwd,
                    "target-changed",
                    "The control request does not name this task's observed Run.",
                  );
                break;
              }
              default:
                return yield* fail(
                  cwd,
                  "owned",
                  "This mutation is unrelated to the controlled task.",
                );
            }
            const token: WorkspaceOperationToken = {
              id: Symbol("task-control"),
              cwd: canonicalCwd,
              generation: authority.generation,
            };
            operations.set(token, {
              token,
              input: { cwd: canonicalCwd, kind: "control", threadId: task.threadId },
              paths: [canonicalCwd],
              commonDir: null,
              references: 1,
              done: yield* Deferred.make<void>(),
            });
            return { task, token };
          }),
        ),
        // Control admission must not become a nested App filesystem/provider write permit.
        ({ task }) => run(task),
        ({ token }) => release(token),
      );
    });
  return {
    environmentId,
    canonicalize,
    commonDirectory,
    resolveTarget,
    acquire,
    acquireIndependent,
    release,
    use,
    withOperation,
    withFreshOperation,
    bind,
    taskById,
    closeAdmission,
    drain,
    markRuntime,
    releaseAfterCleanup,
    reconcile: (taskId: WeavraTaskId) =>
      mutex.withPermit(
        Effect.gen(function* () {
          const task = yield* taskById(taskId);
          if (task.ownership.state === "released")
            return yield* fail(
              task.checkout.canonicalCwd,
              "stale",
              "This task has already released ownership.",
            );
          return yield* transition(task, "reconciling");
        }),
      ),
    releaseAnalysis: (taskId: WeavraTaskId) =>
      mutex.withPermit(
        Effect.gen(function* () {
          const task = yield* taskById(taskId);
          if (
            task.execution?.confirmCommandId != null ||
            !["analysis", "draining"].includes(task.ownership.state) ||
            (yield* relevant(task)).length !== 0
          )
            return yield* fail(
              task.checkout.canonicalCwd,
              "cleanup-unproven",
              "Only an unconfirmed, drained analysis can release without Runtime cleanup.",
            );
          return yield* transition(task, "released");
        }),
      ),
    /** Task 4 may update preparation/receipts, but ownership transitions use the methods above. */
    updateTask: (command: WeavraTaskSetCommand) =>
      mutex.withPermit(
        Effect.gen(function* () {
          const previous = (yield* tasks).find((task) => task.id === command.task.id);
          if (previous && previous.ownership.state !== command.task.ownership.state)
            return yield* fail(
              command.task.checkout.canonicalCwd,
              "stale",
              "Use the ownership transition API.",
            );
          if (
            (yield* owners).some(
              (owner) =>
                owner.state !== "released" &&
                owner.taskId !== command.task.id &&
                overlaps(owner.canonicalCwd, command.task.checkout.canonicalCwd),
            )
          )
            return yield* fail(
              command.task.checkout.canonicalCwd,
              "owned",
              "Another controlled task owns this checkout.",
            );
          const selected = yield* resolveTarget(command.threadId);
          if (
            selected.canonicalCwd !== command.task.checkout.canonicalCwd ||
            selected.repositoryRoot !== command.task.checkout.repositoryRoot
          )
            return yield* fail(
              selected.canonicalCwd,
              "target-changed",
              "The selected checkout has changed.",
            );
          return yield* setTask(command);
        }),
      ),
    registerProviderStop: (
      token: WorkspaceOperationToken,
      stop: Effect.Effect<void, WorkspaceOwnershipError>,
    ) =>
      Effect.sync(() => {
        const operation = operations.get(token);
        if (operation) operation.stop = stop;
      }),
    registerEventConsumer,
    retainProviderEvent,
    withProviderEvent,
    captureAdmission,
    withControlOperation,
    /** Persist any task update first; this authority binds the exact current generation. */
    withTaskControl: <A, E, R>(taskId: WeavraTaskId, effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const task = yield* taskById(taskId);
        yield* assertTarget(task);
        return yield* effect.pipe(
          Effect.provideService(currentTaskControl, {
            taskId,
            generation: task.ownership.generation,
          }),
        );
      }),
    withTaskAnalysis: <A, E, R>(
      taskId: WeavraTaskId,
      expectedRevision: number,
      effect: Effect.Effect<A, E, R>,
    ) =>
      Effect.gen(function* () {
        const task = yield* taskById(taskId);
        yield* assertTarget(task);
        if (
          task.revision !== expectedRevision ||
          task.phase !== "analysis" ||
          task.ownership.state !== "analysis" ||
          task.execution?.confirmCommandId != null
        )
          return yield* fail(
            task.checkout.canonicalCwd,
            "stale",
            "Only the current unconfirmed analysis task may run a provider turn.",
          );
        return yield* effect.pipe(
          Effect.provideService(currentTaskAnalysis, {
            taskId,
            generation: task.ownership.generation,
            expectedRevision,
          }),
        );
      }),
    analysisAuthority: currentTaskAnalysis,
    activeAnalysisForThread: (threadId: ThreadId) =>
      tasks.pipe(
        Effect.map((values) =>
          values.find(
            (task) =>
              task.threadId === threadId &&
              task.phase === "analysis" &&
              task.ownership.state === "analysis" &&
              task.execution?.confirmCommandId == null,
          ),
        ),
      ),
    activeOperations: Effect.sync(() =>
      [...operations.values()].map(({ token, input, references }) => ({
        cwd: token.cwd,
        generation: token.generation,
        kind: input.kind,
        threadId: input.threadId,
        references,
      })),
    ),
  };
});

export class WorkspaceExecutionOwnership extends Context.Service<
  WorkspaceExecutionOwnership,
  Effect.Success<typeof make>
>()("t3/workspace/WorkspaceExecutionOwnership") {}

export const layer = Layer.effect(WorkspaceExecutionOwnership, make);
