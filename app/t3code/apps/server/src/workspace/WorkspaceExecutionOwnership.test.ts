import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  DEFAULT_TERMINAL_ID,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ProviderDriverKind,
  type ProviderRuntimeEvent,
  ThreadId,
  TurnId,
  WeavraTask,
  WeavraAnalysisContext,
  WEAVRA_CONTROL_COMMANDS,
} from "@t3tools/contracts";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../config.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import {
  SqlitePersistenceMemory,
  makeSqlitePersistenceLive,
} from "../persistence/Layers/Sqlite.ts";
import * as ProcessRunner from "../processRunner.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspaceFileSystem from "./WorkspaceFileSystem.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import * as OwnershipTest from "./WorkspaceExecutionOwnershipTest.ts";
import * as Ownership from "./WorkspaceExecutionOwnership.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import type { PtyExitEvent } from "../terminal/PtyAdapter.ts";
import * as RuntimeController from "../weavra/RuntimeController.ts";
import * as VcsProvisioning from "../vcs/VcsProvisioningService.ts";
import * as ReviewService from "../review/ReviewService.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { writeFakeCli } from "../testUtils/fakeCli.ts";

const projectId = ProjectId.make("ownership-project");
const threadId = ThreadId.make("ownership-thread");
const time = "2026-09-27T00:00:00.000Z";
const decodeTask = Schema.decodeUnknownSync(WeavraTask);
const decodePacket = Schema.decodeUnknownSync(WeavraAnalysisContext);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

const engineLayer = OrchestrationEngineLive.pipe(
  Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
  Layer.provide(OrchestrationProjectionPipelineLive),
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
);

const makeSystemLayer = (databasePath?: string) =>
  Layer.mergeAll(
    engineLayer,
    WorkspaceFileSystem.layer.pipe(
      Layer.provideMerge(WorkspaceEntries.layer),
      Layer.provideMerge(WorkspacePaths.layer),
      Layer.provideMerge(VcsDriverRegistry.layer.pipe(Layer.provide(VcsProcess.layer))),
    ),
  ).pipe(
    Layer.provideMerge(Ownership.layer),
    Layer.provide(OwnershipTest.environmentLayer),
    Layer.provideMerge(ProcessRunner.layer),
    Layer.provide(databasePath ? makeSqlitePersistenceLive(databasePath) : SqlitePersistenceMemory),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "weavra-ownership-" })),
    Layer.provide(NodeServices.layer),
  );
const systemLayer = makeSystemLayer();

const seedTask = Effect.fn("ownershipTest.seedTask")(function* (
  cwd: string,
  worktreePath: string | null = null,
) {
  const engine = yield* OrchestrationEngineService;
  const ownership = yield* Ownership.WorkspaceExecutionOwnership;
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("ownership-project-create"),
    projectId,
    title: "Ownership",
    workspaceRoot: cwd,
    createdAt: time,
  });
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make("ownership-thread-create"),
    projectId,
    threadId,
    title: "Ownership",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath,
    createdAt: time,
  });
  const task = decodeTask({
    id: "33333333-3333-4333-8333-333333333333",
    environmentId: ownership.environmentId,
    projectId,
    threadId,
    target: { workspaceRoot: cwd, worktreePath },
    checkout: {
      canonicalCwd: worktreePath ?? cwd,
      repositoryRoot: worktreePath ?? cwd,
      headCommit: "a".repeat(40),
      workspaceDigest: `sha256:${"a".repeat(64)}`,
    },
    phase: "analysis",
    revision: 1,
    context: null,
    execution: null,
    ownership: { generation: 1, state: "analysis" },
    createdAt: time,
    updatedAt: time,
  });
  yield* engine.dispatch({
    type: "thread.weavra-task.set",
    commandId: CommandId.make("ownership-task-create"),
    threadId,
    expectedRevision: null,
    expectedOwnershipGeneration: 0,
    task,
  });
  return task;
});

it.effect("rejects a file save when the durable checkout owner is unresolved", () =>
  Effect.gen(function* () {
    // Given an actual task event and ownership projection in SQLite.
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-owned-save-" });
    const cwd = yield* fs.realPath(directory);
    yield* Effect.gen(function* () {
      yield* seedTask(cwd);
      const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;

      // When a raw-cwd save reaches the production filesystem service.
      const result = yield* Effect.result(
        files.writeFile({ cwd, relativePath: "late/new.txt", contents: "must not land" }),
      );

      // Then ownership prevents even the parent-directory effect.
      assert.equal(result._tag, "Failure");
      assert.isFalse(yield* fs.exists(`${cwd}/late`));
    }).pipe(Effect.provide(systemLayer));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("admits only provider transport for the exact analysis generation", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const fs = yield* FileSystem.FileSystem;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    const task = yield* seedTask(cwd);

    const nestedWrite = yield* ownership
      .withTaskAnalysis(
        task.id,
        task.revision,
        ownership.withFreshOperation(
          { cwd, kind: "provider", threadId },
          ownership.withOperation(
            { cwd, kind: "write", threadId },
            fs.writeFileString(`${cwd}/forbidden.txt`, "forbidden"),
          ),
        ),
      )
      .pipe(Effect.result);
    const stale = yield* ownership
      .withTaskAnalysis(
        task.id,
        task.revision + 1,
        ownership.withFreshOperation({ cwd, kind: "provider", threadId }, Effect.void),
      )
      .pipe(Effect.result);
    yield* ownership.withTaskAnalysis(
      task.id,
      task.revision,
      ownership.withFreshOperation({ cwd, kind: "provider", threadId }, Effect.void),
    );

    assert.equal(nestedWrite._tag, "Failure");
    assert.equal(stale._tag, "Failure");
    assert.isFalse(yield* fs.exists(`${cwd}/forbidden.txt`));
    assert.equal((yield* ownership.activeOperations).length, 0);
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

const repository = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const process = yield* ProcessRunner.ProcessRunner;
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-ownership-repo-" });
  const cwd = yield* fs.realPath(directory);
  const result = yield* process.run({ command: "git", args: ["-C", cwd, "init", "-q"] });
  assert.equal(result.code, 0);
  return cwd;
});

it.effect(
  "repository preparation rejects overlapping active writes without changing their admission",
  () =>
    Effect.gen(function* () {
      const cwd = yield* repository;
      const ownership = yield* Ownership.WorkspaceExecutionOwnership;
      for (const kind of ["write", "terminal", "provider"] as const) {
        const token = yield* ownership.acquireIndependent({ cwd, kind });
        const denied = yield* ownership
          .withFreshOperation({ cwd, kind: "git", exclusive: true }, Effect.void)
          .pipe(Effect.result);
        assert.equal(denied._tag, "Failure");
        assert.equal((yield* ownership.activeOperations).length, 1);
        yield* ownership.release(token);
      }
      assert.equal((yield* ownership.activeOperations).length, 0);
    }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("holds exclusive repository preparation until its exact completion signal", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    const entered = yield* Deferred.make<void>();
    const finish = yield* Deferred.make<void>();
    const preparing = yield* ownership
      .withFreshOperation(
        { cwd, kind: "git", exclusive: true },
        Effect.gen(function* () {
          yield* Deferred.succeed(entered, undefined);
          yield* Deferred.await(finish);
        }),
      )
      .pipe(Effect.forkScoped);
    yield* Deferred.await(entered);
    for (const kind of ["write", "terminal", "provider", "git"] as const) {
      const denied = yield* ownership
        .withFreshOperation({ cwd, kind }, Effect.void)
        .pipe(Effect.result);
      assert.equal(denied._tag, "Failure");
    }
    yield* Deferred.succeed(finish, undefined);
    yield* Fiber.join(preparing);
    yield* ownership.withFreshOperation({ cwd, kind: "write" }, Effect.void);
    assert.equal((yield* ownership.activeOperations).length, 0);
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("holds file-save admission through refresh and rejects a queued late save", () =>
  Effect.gen(function* () {
    // Given a real filesystem save parked inside its final refresh effect.
    const cwd = yield* repository;
    const fs = yield* FileSystem.FileSystem;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    const entries = yield* WorkspaceEntries.WorkspaceEntries;
    const entered = yield* Deferred.make<void>();
    const finish = yield* Deferred.make<void>();
    const files = yield* WorkspaceFileSystem.make.pipe(
      Effect.provideService(WorkspaceEntries.WorkspaceEntries, {
        ...entries,
        refresh: (root) =>
          entries
            .refresh(root)
            .pipe(
              Effect.andThen(Deferred.succeed(entered, undefined)),
              Effect.andThen(Deferred.await(finish)),
            ),
      }),
    );
    const save = yield* files
      .writeFile({
        cwd,
        relativePath: "accepted.txt",
        contents: "accepted",
      })
      .pipe(Effect.forkScoped);
    yield* Deferred.await(entered);
    const task = yield* seedTask(cwd);
    yield* ownership.closeAdmission(task.id);

    // When handoff attempts to drain the admitted save.
    const drained = yield* Deferred.make<void>();
    const draining = yield* ownership.drain(task.id).pipe(
      Effect.tap(() => Deferred.succeed(drained, undefined)),
      Effect.forkScoped,
    );
    const premature = yield* ownership.markRuntime(task.id).pipe(Effect.flip);
    const late = yield* files
      .writeFile({
        cwd,
        relativePath: "late.txt",
        contents: "late",
      })
      .pipe(Effect.result);

    // Then the generation cannot transfer until refresh returns.
    assert.equal(premature.reason, "not-drained");
    assert.isFalse(yield* Deferred.isDone(drained));
    assert.equal(late._tag, "Failure");
    assert.isFalse(yield* fs.exists(`${cwd}/late.txt`));
    yield* Deferred.succeed(finish, undefined);
    yield* Fiber.join(save);
    yield* Fiber.join(draining);
    const running = yield* ownership.markRuntime(task.id);
    assert.equal(running.ownership.state, "runtime");
    assert.equal(running.phase, "handoff");
    assert.equal(running.ownership.generation, 3);
    assert.equal(yield* fs.readFileString(`${cwd}/accepted.txt`), "accepted");
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("reuses an admitted token for nested final effects after admission closes", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const fs = yield* FileSystem.FileSystem;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    const token = yield* ownership.acquireIndependent({ cwd, kind: "write" });
    const task = yield* seedTask(cwd);
    yield* ownership.closeAdmission(task.id);

    yield* ownership.use(
      token,
      ownership.withOperation(
        { cwd, kind: "write" },
        fs.writeFileString(`${cwd}/nested.txt`, "final effect"),
      ),
    );

    const active = yield* ownership.activeOperations;
    assert.equal(active.length, 1);
    assert.equal(active[0]?.generation, 0);
    yield* ownership.release(token);
    yield* ownership.drain(task.id);
    yield* ownership.markRuntime(task.id);
    assert.equal(yield* fs.readFileString(`${cwd}/nested.txt`), "final effect");
    assert.equal((yield* ownership.use(token, Effect.void).pipe(Effect.flip)).reason, "stale");
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("collides symlink and nested targets while an unrelated checkout remains usable", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const fs = yield* FileSystem.FileSystem;
    const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;
    const aliasRoot = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-alias-" });
    const unrelated = yield* repository;
    yield* fs.makeDirectory(`${cwd}/nested`);
    yield* fs.symlink(cwd, `${aliasRoot}/alias`);
    const task = yield* seedTask(cwd);

    const outcomes = yield* Effect.forEach([`${aliasRoot}/alias`, `${cwd}/nested`], (root) =>
      files
        .writeFile({ cwd: root, relativePath: "denied.txt", contents: "denied" })
        .pipe(Effect.result),
    );
    yield* files.writeFile({ cwd: unrelated, relativePath: "allowed.txt", contents: "allowed" });

    assert.deepStrictEqual(
      outcomes.map((result) => result._tag),
      ["Failure", "Failure"],
    );
    assert.equal(yield* fs.readFileString(`${unrelated}/allowed.txt`), "allowed");
    assert.isFalse(yield* fs.exists(`${cwd}/nested/denied.txt`));
    yield* (yield* OrchestrationEngineService).dispatch({
      type: "thread.meta.update",
      commandId: CommandId.make("alias-target"),
      threadId,
      worktreePath: `${aliasRoot}/alias`,
    });
    const invalidated = yield* (yield* Ownership.WorkspaceExecutionOwnership)
      .closeAdmission(task.id)
      .pipe(Effect.flip);
    assert.equal(invalidated.reason, "target-changed");
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("invalidates a drain proof on every task projection generation update", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    const task = yield* seedTask(cwd);
    const closed = yield* ownership.closeAdmission(task.id);
    yield* ownership.drain(task.id);

    yield* ownership.updateTask({
      type: "thread.weavra-task.set",
      commandId: CommandId.make("metadata-after-drain"),
      threadId,
      expectedRevision: closed.revision,
      expectedOwnershipGeneration: closed.ownership.generation,
      task: { ...closed, revision: 3, ownership: { state: "draining", generation: 3 } },
    });

    assert.equal((yield* ownership.markRuntime(task.id).pipe(Effect.flip)).reason, "not-drained");
    yield* ownership.drain(task.id);
    const running = yield* ownership.markRuntime(task.id);
    const query = yield* ProjectionSnapshotQuery;
    const snapshot = yield* query.getSnapshot();
    assert.equal(running.ownership.generation, 4);
    assert.equal(snapshot.weavraOwnership?.[0]?.generation, 4);
    assert.equal(snapshot.weavraTasks?.[0]?.ownership.state, "runtime");
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("refuses another thread's provider without silently stopping it", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    const other = yield* ownership.acquireIndependent({
      cwd,
      kind: "provider",
      threadId: "other-thread",
    });
    let stopped = false;
    yield* ownership.registerProviderStop(
      other,
      Effect.sync(() => {
        stopped = true;
      }),
    );
    const task = yield* seedTask(cwd);
    yield* ownership.closeAdmission(task.id);

    const result = yield* ownership.drain(task.id).pipe(Effect.flip);

    assert.equal(result.reason, "provider-conflict");
    assert.isFalse(stopped);
    yield* ownership.release(other);
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("holds Runtime handoff until controlled analysis provider cleanup finishes", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    const task = yield* seedTask(cwd);
    const stopCalled = yield* Deferred.make<void>();
    const finishCleanup = yield* Deferred.make<void>();
    const provider = yield* ownership.withTaskAnalysis(
      task.id,
      task.revision,
      ownership.acquireIndependent({ cwd, kind: "provider", threadId }),
    );
    yield* ownership.registerProviderStop(
      provider,
      Deferred.succeed(stopCalled, undefined).pipe(
        Effect.andThen(Deferred.await(finishCleanup)),
        Effect.andThen(ownership.release(provider)),
      ),
    );
    yield* ownership.closeAdmission(task.id);
    const draining = yield* ownership.drain(task.id).pipe(Effect.forkScoped);

    yield* Deferred.await(stopCalled);
    assert.equal(draining.pollUnsafe(), undefined);
    assert.equal((yield* ownership.markRuntime(task.id).pipe(Effect.flip)).reason, "not-drained");
    yield* Deferred.succeed(finishCleanup, undefined);
    yield* Fiber.join(draining);

    assert.equal((yield* ownership.markRuntime(task.id)).ownership.state, "runtime");
    assert.equal((yield* ownership.activeOperations).length, 0);
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("retains a published provider completion through its late checkpoint effects", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    const fs = yield* FileSystem.FileSystem;
    yield* ownership.registerEventConsumer("fixture-checkpoint", ["turn.completed"]);
    const provider = yield* ownership.acquireIndependent({ cwd, kind: "provider", threadId });
    yield* ownership.registerProviderStop(provider, ownership.release(provider));
    const event: ProviderRuntimeEvent = {
      type: "turn.completed",
      eventId: EventId.make("completion"),
      provider: ProviderDriverKind.make("codex"),
      threadId,
      turnId: TurnId.make("turn"),
      createdAt: time,
      payload: { state: "completed" },
    };
    yield* ownership.retainProviderEvent(event);
    const task = yield* seedTask(cwd);
    yield* ownership.closeAdmission(task.id);
    const draining = yield* ownership.drain(task.id).pipe(Effect.forkScoped);

    const beforeCheckpoint = yield* ownership.markRuntime(task.id).pipe(Effect.flip);
    yield* ownership.withProviderEvent(
      "fixture-checkpoint",
      event,
      ownership.withOperation(
        { cwd, kind: "checkpoint" },
        fs.writeFileString(`${cwd}/checkpoint-effect`, "captured"),
      ),
    );
    yield* Fiber.join(draining);

    assert.equal(beforeCheckpoint.reason, "not-drained");
    assert.equal((yield* ownership.markRuntime(task.id)).ownership.state, "runtime");
    assert.equal(yield* fs.readFileString(`${cwd}/checkpoint-effect`), "captured");
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("keeps unresolved ownership blocked after SQLite and service restart", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-ownership-restart-" });
    const cwd = yield* fs.realPath(directory);
    const databasePath = `${cwd}/state.sqlite`;
    const taskId = yield* Effect.scoped(
      Effect.gen(function* () {
        const task = yield* seedTask(cwd);
        const ownership = yield* Ownership.WorkspaceExecutionOwnership;
        yield* ownership.reconcile(task.id);
        return task.id;
      }).pipe(Effect.provide(makeSystemLayer(databasePath))),
    );

    yield* Effect.scoped(
      Effect.gen(function* () {
        const ownership = yield* Ownership.WorkspaceExecutionOwnership;
        const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;
        const denied = yield* files
          .writeFile({
            cwd,
            relativePath: "restart-write",
            contents: "denied",
          })
          .pipe(Effect.result);
        assert.equal(denied._tag, "Failure");
        assert.equal((yield* ownership.taskById(taskId)).ownership.state, "reconciling");
        assert.equal((yield* ownership.activeOperations).length, 0);
      }).pipe(Effect.provide(makeSystemLayer(databasePath))),
    );
    assert.isFalse(yield* fs.exists(`${cwd}/restart-write`));
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("refuses a live nested PTY until its actual exit without killing human work", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const fs = yield* FileSystem.FileSystem;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    yield* fs.makeDirectory(`${cwd}/nested`);
    const exits = new Set<(event: PtyExitEvent) => void>();
    const writes: string[] = [];
    const kills: Array<string | undefined> = [];
    const terminal = yield* TerminalManager.makeWithOptions({
      logsDir: `${cwd}/terminal-logs`,
      processTable: Effect.succeed([]),
      ptyAdapter: {
        spawn: () =>
          Effect.succeed({
            pid: 900_001,
            write: (data) => {
              writes.push(data);
            },
            resize: () => {},
            kill: (signal) => {
              kills.push(signal);
            },
            onData: () => () => {},
            onExit: (listener) => {
              exits.add(listener);
              return () => {
                exits.delete(listener);
              };
            },
          }),
      },
    });
    yield* terminal.open({ threadId, terminalId: DEFAULT_TERMINAL_ID, cwd: `${cwd}/nested` });
    const exited = yield* Deferred.make<void>();
    yield* terminal.subscribe((event) =>
      event.type === "exited"
        ? Deferred.succeed(exited, undefined).pipe(Effect.asVoid)
        : Effect.void,
    );
    const task = yield* seedTask(cwd);
    yield* ownership.closeAdmission(task.id);

    const conflict = yield* ownership.drain(task.id).pipe(Effect.flip);
    const input = yield* terminal
      .write({
        threadId,
        terminalId: DEFAULT_TERMINAL_ID,
        data: "must not run\n",
      })
      .pipe(Effect.result);

    assert.equal(conflict.reason, "terminal-active");
    assert.equal(input._tag, "Failure");
    assert.deepStrictEqual(writes, []);
    assert.deepStrictEqual(kills, []);
    for (const listener of exits) listener({ exitCode: 0, signal: 0 });
    yield* Deferred.await(exited);
    yield* ownership.drain(task.id);
    assert.equal((yield* ownership.markRuntime(task.id)).ownership.state, "runtime");
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("requires exact Runtime cleanup and absent writer beyond terminal Run status", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const fs = yield* FileSystem.FileSystem;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    const crypto = yield* Crypto.Crypto;
    const task = yield* seedTask(cwd);
    const packet = decodePacket({
      version: 1,
      packetVersion: 1,
      authority: "ADVISORY_ONLY",
      reviewedAt: 1,
      symptom: "Fixture",
      observations: [],
      candidateCause: null,
      uncertainties: [],
      sourceReferences: [],
      constraints: [],
    });
    const bytes = yield* crypto.digest(
      "SHA-256",
      new TextEncoder().encode(stableStringify({ domain: "weavra.analysis-context.v1", packet })),
    );
    const digest = `sha256:${"a".repeat(64)}`;
    const prepared = decodeTask({
      ...task,
      context: packet,
      revision: 2,
      ownership: { generation: 2, state: "analysis" },
      execution: {
        binding: {
          taskId: task.id,
          environmentId: ownership.environmentId,
          projectId,
          threadId,
          checkout: task.checkout,
          executionId: "44444444-4444-4444-8444-444444444444",
          packetVersion: 1,
          advisoryDigest: `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`,
        },
        previewId: "preview",
        previewDigest: digest,
        configDigest: digest,
        confirmedProjectRevision: 0,
        confirmCommandId: "confirm",
        receipt: null,
      },
    });
    yield* ownership.updateTask({
      type: "thread.weavra-task.set",
      commandId: CommandId.make("confirm-intent"),
      threadId,
      expectedRevision: 1,
      expectedOwnershipGeneration: 1,
      task: prepared,
    });
    yield* ownership.closeAdmission(task.id);
    yield* ownership.drain(task.id);
    const running = yield* ownership.markRuntime(task.id);
    assert.ok(running.execution);
    const execution = running.execution;
    const finished = decodeTask({
      ...running,
      phase: "finished",
      revision: 5,
      ownership: { generation: 5, state: "runtime" },
      execution: {
        ...execution,
        receipt: {
          status: "FOUND",
          executionId: execution.binding.executionId,
          admission: {
            metadata: {
              binding: execution.binding,
              previewDigest: digest,
              configDigest: digest,
              confirmedProjectRevision: 0,
              admittedProjectRevision: 1,
            },
            outcome: { status: "STARTED", runId: "run" },
            acceptedAt: 1,
            updatedAt: 2,
          },
          run: { runId: "run", status: "COMPLETED", revision: 2 },
        },
      },
    });
    yield* ownership.updateTask({
      type: "thread.weavra-task.set",
      commandId: CommandId.make("terminal-receipt"),
      threadId,
      expectedRevision: 4,
      expectedOwnershipGeneration: 4,
      task: finished,
    });
    const evidence: Ownership.RuntimeCleanupEvidence = {
      executionId: execution.binding.executionId,
      runtimeIdle: false,
      activeAgentCount: 1,
      writerPresent: false,
    };

    const beforeCleanup = yield* ownership
      .releaseAfterCleanup(task.id, Effect.succeed(evidence))
      .pipe(Effect.flip);
    yield* fs.makeDirectory(`${cwd}/.ai`);
    yield* fs.writeFileString(`${cwd}/.ai/writer.lock`, "fixture Runtime still owns its writer");
    const idle = { ...evidence, runtimeIdle: true, activeAgentCount: 0 };
    const beforeWriterRelease = yield* ownership
      .releaseAfterCleanup(task.id, Effect.succeed(idle))
      .pipe(Effect.flip);
    yield* fs.remove(`${cwd}/.ai/writer.lock`);
    const released = yield* ownership.releaseAfterCleanup(task.id, Effect.succeed(idle));

    assert.equal(beforeCleanup.reason, "cleanup-unproven");
    assert.equal(beforeWriterRelease.reason, "cleanup-unproven");
    assert.equal(released.ownership.state, "released");
    assert.equal(released.ownership.generation, 6);
    yield* (yield* WorkspaceFileSystem.WorkspaceFileSystem).writeFile({
      cwd,
      relativePath: "free-again",
      contents: "free",
    });
    assert.equal(yield* fs.readFileString(`${cwd}/free-again`), "free");
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect(
  "keeps Settings observation available but denies owned-checkout mutations before stdio",
  () =>
    Effect.gen(function* () {
      const cwd = yield* repository;
      const fs = yield* FileSystem.FileSystem;
      const ownership = yield* Ownership.WorkspaceExecutionOwnership;
      const task = yield* seedTask(cwd);
      const executable = writeFakeCli({
        directory: cwd,
        name: "ownership-control",
        source: `
import { createInterface } from "node:readline";
import { appendFileSync } from "node:fs";
const ownerId="fixture-owner";
const capabilities={authority:"Runtime/Kernel",control:"workflow-control-v1",ownerId,
commands:${encodeJson(WEAVRA_CONTROL_COMMANDS)},maxRequestBytes:32768,maxResponseBytes:65536,
resultLimit:64,previewTtlMs:300000,runtimeVersion:"0.85.1",readiness:"READY",recipes:[]};
const snapshot={status:{source:"durable-canonical-state",ownerObserved:false,state:"missing",writerPresent:false,run:null},
graph:null,graphAvailable:false,evidence:null,configuration:{source:"project-config-not-frozen-run-config",status:"missing"}};
const state={ownerId,nextRequestId:"fixture-owner:1",projectRevision:0,stateRevision:null,
ownedRunId:null,busy:false,cancelling:false,startFailure:null,preview:null,browserPreview:null,
factPreview:null,projectFacts:{status:"available",entries:[]},pendingApproval:null,snapshot};
for await(const line of createInterface({input:process.stdin})){
 const request=JSON.parse(line);
 const data=request.type==="control.hello"?{kind:"capabilities",capabilities}:
 request.type==="control.snapshot"?{kind:"snapshot",state}:null;
 if(data===null)appendFileSync("mutations",request.type+"\\n");
 process.stdout.write(JSON.stringify({protocolVersion:1,type:"control_response",id:request.id,
 command:request.type,ownerId,runId:null,stateRevision:null,projectRevision:0,eventId:null,timestamp:1,
 success:data!==null,...(data===null?{error:{code:"INVALID_REQUEST"}}:{data})})+"\\n");
}
`,
      });
      const controller = yield* RuntimeController.make().pipe(
        Effect.provideService(HostProcessEnvironment, {
          PATH: process.env.PATH,
          T3_WEAVRA_EXECUTABLE: executable,
          T3_WEAVRA_CONTROL: "1",
        }),
      );
      const connected = yield* Deferred.make<void>();
      yield* controller.observe(projectId).pipe(
        Stream.runForEach((observation) =>
          observation.status === "CONNECTED" && !observation.stale
            ? Deferred.succeed(connected, undefined)
            : Effect.void,
        ),
        Effect.forkScoped({ startImmediately: true }),
      );
      yield* Deferred.await(connected);
      const command = {
        projectId,
        request: {
          protocolVersion: 1 as const,
          id: "fixture-owner:1",
          ownerId: "fixture-owner",
          expectedProjectRevision: 0,
          type: "workflow.prepare" as const,
          goal: "Fixture",
        },
      };

      for (let attempt = 0; attempt < 10; attempt++) {
        const denied = yield* controller.command(command).pipe(Effect.flip);
        assert.equal(denied.code, "STATE_UNAVAILABLE");
      }
      assert.isFalse(yield* fs.exists(`${cwd}/mutations`));
      const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;
      const escapedControl = yield* ownership
        .withTaskControl(
          task.id,
          ownership.withControlOperation(cwd, { type: "workflow.prepare" }, () =>
            files.writeFile({ cwd, relativePath: "control-escape", contents: "denied" }),
          ),
        )
        .pipe(Effect.result);
      assert.equal(escapedControl._tag, "Failure");
      assert.isFalse(yield* fs.exists(`${cwd}/control-escape`));
      yield* ownership.withTaskControl(task.id, controller.command(command));
      assert.equal(yield* fs.readFileString(`${cwd}/mutations`), "workflow.prepare\n");
      const prematureConfirm = yield* ownership
        .withTaskControl(
          task.id,
          controller.command({
            projectId,
            request: {
              protocolVersion: 1,
              id: "fixture-owner:1",
              ownerId: "fixture-owner",
              expectedProjectRevision: 0,
              type: "workflow.confirm",
              previewId: "preview",
              previewDigest: `sha256:${"a".repeat(64)}`,
            },
          }),
        )
        .pipe(Effect.flip);
      assert.ok(prematureConfirm._tag === "WeavraControlTransportError");
      assert.equal(prematureConfirm.code, "STATE_UNAVAILABLE");
      yield* ownership.releaseAnalysis(task.id);
      const ordinary = yield* controller.command(command);

      assert.isFalse(ordinary.success);
      assert.equal(
        yield* fs.readFileString(`${cwd}/mutations`),
        "workflow.prepare\nworkflow.prepare\n",
      );
    }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("keeps a controlled thread blocked when its target moves", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const moved = yield* repository;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    yield* seedTask(cwd);

    const denied = yield* ownership
      .withFreshOperation({ cwd: moved, kind: "provider", threadId }, Effect.void)
      .pipe(Effect.flip);
    yield* ownership.withFreshOperation(
      { cwd: moved, kind: "write", threadId: "unrelated-thread" },
      Effect.void,
    );

    assert.equal(denied.reason, "target-changed");
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

it.effect("rejects an old queued admission even after the controlled owner releases", () =>
  Effect.gen(function* () {
    const cwd = yield* repository;
    const fs = yield* FileSystem.FileSystem;
    const ownership = yield* Ownership.WorkspaceExecutionOwnership;
    const admission = yield* ownership.captureAdmission(cwd);
    const eventSequence = yield* (yield* OrchestrationEngineService).latestSequence;
    const previousTarget = yield* repository;
    const origin = yield* ownership.acquireIndependent({
      cwd: previousTarget,
      kind: "write",
      threadId,
      eventSequence,
    });
    const task = yield* seedTask(cwd);
    yield* ownership.closeAdmission(task.id);
    yield* ownership.drain(task.id);
    yield* ownership.releaseAnalysis(task.id);

    const stale = yield* ownership
      .withFreshOperation(
        { cwd, kind: "write", admission },
        fs.writeFileString(`${cwd}/stale`, "must not run"),
      )
      .pipe(Effect.flip);
    yield* (yield* WorkspaceFileSystem.WorkspaceFileSystem).writeFile({
      cwd,
      relativePath: "new",
      contents: "new request",
    });

    assert.equal(stale.reason, "stale");
    const oldEvent = yield* ownership
      .withFreshOperation(
        { cwd, kind: "write", eventSequence },
        fs.writeFileString(`${cwd}/old-event`, "must not run"),
      )
      .pipe(Effect.flip);
    assert.equal(oldEvent.reason, "stale");
    for (const operation of [
      ownership.withFreshOperation({ cwd, kind: "write", threadId }, Effect.void),
      ownership.withOperation({ cwd, kind: "git", sharedGitMetadata: true }, Effect.void),
    ]) {
      const descendant = yield* ownership.use(origin, operation).pipe(Effect.flip);
      assert.equal(descendant.reason, "stale");
    }
    yield* ownership.release(origin);
    assert.isFalse(yield* fs.exists(`${cwd}/old-event`));
    assert.isFalse(yield* fs.exists(`${cwd}/stale`));
    assert.equal(yield* fs.readFileString(`${cwd}/new`), "new request");
  }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
);

for (const history of ["available", "unavailable"] as const) {
  it.effect(`fences released sibling ownership using the original sequence (${history})`, () =>
    Effect.gen(function* () {
      const cwd = yield* repository;
      const fs = yield* FileSystem.FileSystem;
      const runner = yield* ProcessRunner.ProcessRunner;
      const ownership = yield* Ownership.WorkspaceExecutionOwnership;
      const engine = yield* OrchestrationEngineService;
      const outside = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "weavra-released-sibling-" }),
      );
      const linked = `${outside}/linked`;
      for (const args of [
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@localhost",
          "commit",
          "--allow-empty",
          "-qm",
          "Fixture",
        ],
        ["worktree", "add", "--detach", linked, "HEAD"],
      ]) {
        assert.equal((yield* runner.run({ command: "git", args: ["-C", cwd, ...args] })).code, 0);
      }
      const originSequence = yield* engine.latestSequence;
      const task = yield* seedTask(cwd, linked);
      const released = yield* ownership.releaseAnalysis(task.id);
      assert.equal(released.ownership.state, "released");
      if (history === "unavailable") yield* fs.remove(linked, { recursive: true });

      let callbacks = 0;
      const denied = yield* ownership
        .withFreshOperation(
          {
            cwd,
            kind: "write",
            threadId: "ordinary-sibling-thread",
            sharedGitMetadata: true,
            eventSequence: originSequence,
          },
          Effect.sync(() => {
            callbacks++;
          }),
        )
        .pipe(Effect.flip);
      assert.equal(denied.reason, history === "available" ? "stale" : "unavailable");
      assert.equal(callbacks, 0);

      // Ordinary sibling file writes do not touch shared Git metadata.
      yield* ownership.withFreshOperation(
        { cwd, kind: "write", threadId: "ordinary-sibling-thread", eventSequence: originSequence },
        fs.writeFileString(`${cwd}/ordinary-after-release.txt`, "allowed"),
      );
      yield* ownership.withFreshOperation(
        {
          cwd,
          kind: "write",
          threadId: "ordinary-sibling-thread",
          sharedGitMetadata: true,
          eventSequence: yield* engine.latestSequence,
        },
        Effect.sync(() => {
          callbacks++;
        }),
      );
      if (history === "available") {
        const unrelated = yield* repository;
        yield* ownership.withFreshOperation(
          {
            cwd: unrelated,
            kind: "write",
            threadId: "unrelated-thread",
            sharedGitMetadata: true,
            eventSequence: originSequence,
          },
          Effect.void,
        );
      }
      assert.equal(callbacks, 1);
      assert.equal(yield* fs.readFileString(`${cwd}/ordinary-after-release.txt`), "allowed");
      assert.deepStrictEqual(yield* ownership.activeOperations, []);
    }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
  );
}

for (const operation of ["file-save", "repository-init"] as const) {
  it.effect(`rejects shared metadata ${operation} while a linked checkout is owned`, () =>
    Effect.gen(function* () {
      const cwd = yield* repository;
      const fs = yield* FileSystem.FileSystem;
      const runner = yield* ProcessRunner.ProcessRunner;
      const ownership = yield* Ownership.WorkspaceExecutionOwnership;
      const files = yield* WorkspaceFileSystem.WorkspaceFileSystem;
      const outside = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "weavra-linked-owned-" }),
      );
      const linked = `${outside}/linked`;
      for (const args of [
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@localhost",
          "commit",
          "--allow-empty",
          "-qm",
          "Fixture",
        ],
        ["worktree", "add", "--detach", linked, "HEAD"],
      ]) {
        const result = yield* runner.run({ command: "git", args: ["-C", cwd, ...args] });
        assert.equal(result.code, 0);
      }
      const task = yield* seedTask(cwd, linked);
      yield* ownership.closeAdmission(task.id);
      yield* ownership.drain(task.id);
      yield* ownership.markRuntime(task.id);
      const originalConfig = yield* fs.readFileString(`${cwd}/.git/config`);

      yield* files.writeFile({
        cwd,
        relativePath: "ordinary.txt",
        contents: "allowed sibling save",
      });
      const provisioning = yield* VcsProvisioning.make;
      const result =
        operation === "file-save"
          ? yield* files
              .writeFile({
                cwd,
                relativePath: ".git/config",
                contents: `${originalConfig}\n[task3]\n mutation = true\n`,
              })
              .pipe(Effect.result)
          : yield* provisioning.initRepository({ cwd, kind: "git" }).pipe(Effect.result);

      assert.equal(result._tag, "Failure");
      assert.equal(yield* fs.readFileString(`${cwd}/.git/config`), originalConfig);
      assert.equal(yield* fs.readFileString(`${cwd}/ordinary.txt`), "allowed sibling save");
    }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
  );
}

for (const location of ["owned", "sibling"] as const) {
  it.effect(`reviews untracked files read-only in the ${location} checkout`, () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const runner = yield* ProcessRunner.ProcessRunner;
      const ownership = yield* Ownership.WorkspaceExecutionOwnership;
      const parent = yield* fs.realPath(
        yield* fs.makeTempDirectoryScoped({ prefix: "weavra-review-owned-" }),
      );
      const cwd = `${parent}/main`;
      const linked = `${parent}/linked`;
      yield* fs.makeDirectory(cwd);
      for (const args of [
        ["init", "-q"],
        [
          "-c",
          "user.name=Fixture",
          "-c",
          "user.email=fixture@localhost",
          "commit",
          "--allow-empty",
          "-qm",
          "Fixture",
        ],
        ["worktree", "add", "--detach", linked, "HEAD"],
      ]) {
        const result = yield* runner.run({ command: "git", args: ["-C", cwd, ...args] });
        assert.equal(result.code, 0);
      }
      yield* fs.writeFileString(`${cwd}/untracked.txt`, "main untracked\n");
      yield* fs.writeFileString(`${linked}/untracked.txt`, "linked untracked\n");
      const task = yield* seedTask(cwd, linked);
      yield* ownership.closeAdmission(task.id);
      yield* ownership.drain(task.id);
      yield* ownership.markRuntime(task.id);
      const reviewContext = yield* Layer.build(
        ReviewService.layer.pipe(
          Layer.provide(GitVcsDriver.layer),
          Layer.provide(VcsProcess.layer),
          Layer.provide(ServerConfig.layerTest(parent, { prefix: "weavra-review-config-" })),
        ),
      );
      const review = yield* ReviewService.ReviewService.pipe(Effect.provide(reviewContext));
      const metadata = Effect.gen(function* () {
        const files = new Map<string, Uint8Array>();
        const visit = Effect.fnUntraced(function* (
          directory: string,
        ): Effect.fn.Return<void, never> {
          for (const name of (yield* fs.readDirectory(directory).pipe(Effect.orDie)).toSorted()) {
            const path = `${directory}/${name}`;
            const stat = yield* fs.stat(path).pipe(Effect.orDie);
            if (stat.type === "Directory") yield* visit(path);
            else if (stat.type === "File")
              files.set(path, yield* fs.readFile(path).pipe(Effect.orDie));
          }
        });
        yield* visit(`${cwd}/.git`);
        return files;
      });
      const before = yield* metadata;

      const result = yield* review.getDiffPreview({
        cwd: location === "owned" ? linked : cwd,
        baseRef: "HEAD",
      });

      assert.ok(
        result.sources.some(
          (source) =>
            source.kind === "working-tree" &&
            source.files?.some((file) => file.path === "untracked.txt"),
        ),
      );
      assert.deepStrictEqual(yield* metadata, before);
    }).pipe(Effect.provide(Layer.mergeAll(systemLayer, NodeServices.layer))),
  );
}
