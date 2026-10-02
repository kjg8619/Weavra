import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  WeavraTask,
  WeavraAnalysisContext,
  type WeavraTaskSetCommand,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Crypto from "effect/Crypto";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as Stream from "effect/Stream";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { ServerConfig } from "../../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../../persistence/Layers/OrchestrationEventStore.ts";
import { makeSqlitePersistenceLive } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationEngineLive } from "./OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "./ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { projectWeavraTask } from "./WeavraTaskProjection.ts";

const projectId = ProjectId.make("project");
const threadId = ThreadId.make("thread");
const time = "2026-09-27T00:00:00.000Z";
const decodeTask = Schema.decodeUnknownSync(WeavraTask);
const decodeContext = Schema.decodeUnknownSync(WeavraAnalysisContext);
const initialTask = decodeTask({
  id: "11111111-1111-4111-8111-111111111111",
  environmentId: "environment",
  projectId,
  threadId,
  target: { workspaceRoot: "/project", worktreePath: null },
  checkout: {
    canonicalCwd: "/project",
    repositoryRoot: "/project",
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
const create: WeavraTaskSetCommand = {
  type: "thread.weavra-task.set",
  commandId: CommandId.make("task-create"),
  threadId,
  expectedRevision: null,
  expectedOwnershipGeneration: 0,
  task: initialTask,
};

function systemLayer(databasePath: string) {
  return Layer.mergeAll(
    OrchestrationEngineLive.pipe(
      Layer.provide(OrchestrationProjectionSnapshotQueryLive),
      Layer.provide(OrchestrationProjectionPipelineLive),
    ),
    OrchestrationProjectionSnapshotQueryLive,
  ).pipe(
    Layer.provide(ThreadBackgroundLiveness.layer),
    Layer.provide(ThreadPlanProgress.layer),
    Layer.provide(OrchestrationEventStoreLive),
    Layer.provide(OrchestrationCommandReceiptRepositoryLive),
    Layer.provide(RepositoryIdentityResolver.layer),
    Layer.provideMerge(makeSqlitePersistenceLive(databasePath)),
    Layer.provide(ServerConfig.layerTest("/project", { prefix: "weavra-task-contract-" })),
    Layer.provide(NodeServices.layer),
  );
}

const seed = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("project-create"),
    projectId,
    title: "Project",
    workspaceRoot: "/project",
    createdAt: time,
  });
  for (const id of [threadId, ThreadId.make("other-thread")]) {
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create-${id}`),
      threadId: id,
      projectId,
      title: "Thread",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt: time,
    });
  }
});

it.effect("persists one task and exact receipts across SQLite close and reload", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-task-sqlite-" });
    const databasePath = path.join(directory, "state.sqlite");
    const settingsPath = path.join(directory, "settings.json");
    yield* fs.writeFileString(settingsPath, '{"unrelated":"keep"}');
    const first = yield* Effect.scoped(
      Effect.gen(function* () {
        yield* seed;
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        const sql = yield* SqlClient.SqlClient;
        const receipt = yield* engine.dispatch(create);
        const duplicate = yield* engine.dispatch(create);
        assert.deepStrictEqual(duplicate, receipt);
        const snapshot = yield* query.getSnapshot();
        assert.deepStrictEqual(snapshot.weavraTasks, [initialTask]);
        const events = yield* sql<{ readonly count: number }>`
          SELECT count(*) AS count FROM orchestration_events WHERE event_type = 'thread.weavra-task-set'
        `;
        assert.equal(events[0]?.count, 1);
        return receipt;
      }).pipe(Effect.provide(systemLayer(databasePath))),
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        assert.deepStrictEqual(yield* engine.dispatch(create), first);
        const snapshot = yield* query.getCommandReadModel();
        assert.deepStrictEqual(snapshot.weavraTasks, [initialTask]);
        assert.deepStrictEqual(snapshot.weavraOwnership, [
          {
            environmentId: initialTask.environmentId,
            canonicalCwd: "/project",
            generation: 1,
            taskId: initialTask.id,
            state: "analysis",
            pendingExecutionId: null,
          },
        ]);
        yield* Effect.log("TASK_SQLITE_QA", {
          taskId: snapshot.weavraTasks?.[0]?.id,
          generation: snapshot.weavraOwnership?.[0]?.generation,
          duplicateSequence: first.sequence,
          reloaded: true,
        });
      }).pipe(Effect.provide(systemLayer(databasePath))),
    );
    assert.equal(yield* fs.readFileString(settingsPath), '{"unrelated":"keep"}');
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("rejects same-command binding conflicts and stale ownership without false success", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-task-cas-" });
    yield* Effect.scoped(
      Effect.gen(function* () {
        yield* seed;
        const engine = yield* OrchestrationEngineService;
        const query = yield* ProjectionSnapshotQuery;
        const accepted = yield* engine.dispatch(create);
        assert.equal(
          (yield* Effect.result(
            engine.dispatch({ ...create, commandId: CommandId.make("create-thread") }),
          ))._tag,
          "Failure",
        );
        for (const task of [
          decodeTask({ ...initialTask, id: "33333333-3333-4333-8333-333333333333" }),
          decodeTask({
            ...initialTask,
            checkout: { ...initialTask.checkout, canonicalCwd: "/elsewhere" },
          }),
          decodeTask({ ...initialTask, phase: "preparing" }),
        ]) {
          const result = yield* Effect.result(engine.dispatch({ ...create, task }));
          assert.equal(result._tag, "Failure");
        }
        assert.deepStrictEqual(yield* engine.dispatch(create), accepted);
        for (const task of [
          decodeTask({ ...initialTask, id: "44444444-4444-4444-8444-444444444444" }),
          decodeTask({
            ...initialTask,
            id: "55555555-5555-4555-8555-555555555555",
            threadId: "other-thread",
          }),
        ]) {
          const result = yield* Effect.result(
            engine.dispatch({
              ...create,
              commandId: CommandId.make(`contender-${task.id}`),
              threadId: task.threadId,
              task,
            }),
          );
          assert.equal(result._tag, "Failure");
        }
        const update: WeavraTaskSetCommand = {
          ...create,
          commandId: CommandId.make("handoff"),
          expectedRevision: 1,
          expectedOwnershipGeneration: 1,
          task: decodeTask({
            ...initialTask,
            revision: 2,
            phase: "attention-required",
            ownership: { generation: 2, state: "reconciling" },
          }),
        };
        const results = yield* Effect.all(
          [
            Effect.result(engine.dispatch(update)),
            Effect.result(
              engine.dispatch({ ...update, commandId: CommandId.make("stale-interruption") }),
            ),
          ],
          { concurrency: "unbounded" },
        );
        assert.deepStrictEqual(results.map((result) => result._tag).sort(), ["Failure", "Success"]);
        assert.deepStrictEqual(
          (yield* query.getSnapshot()).weavraTasks?.map((task) => ({
            id: task.id,
            revision: task.revision,
            generation: task.ownership.generation,
          })),
          [{ id: initialTask.id, revision: 2, generation: 2 }],
        );
        const sql = yield* SqlClient.SqlClient;
        const events = yield* Stream.runCollect(engine.readEvents(0));
        const event = Array.from(events).find((entry) => entry.type === "thread.weavra-task-set");
        assert.ok(event?.type === "thread.weavra-task-set");
        const staleProjection = {
          ...event,
          payload: {
            ...event.payload,
            expectedRevision: 2,
            expectedOwnershipGeneration: 99,
            task: decodeTask({
              ...update.task,
              revision: 3,
              ownership: { generation: 3, state: "reconciling" },
            }),
          },
        };
        assert.equal(
          (yield* Effect.result(sql.withTransaction(projectWeavraTask(staleProjection))))._tag,
          "Failure",
        );
        assert.equal((yield* query.getSnapshot()).weavraTasks?.[0]?.revision, 2);
        for (const otherThread of [threadId, ThreadId.make("other-thread")]) {
          const duplicate = yield* Effect.result(sql`
            INSERT INTO projection_weavra_tasks
              (task_id, environment_id, project_id, thread_id, canonical_cwd, phase,
               ownership_state, revision, generation, task_json)
            SELECT '66666666-6666-4666-8666-666666666666', environment_id, project_id, ${otherThread},
              canonical_cwd, phase, ownership_state, revision, generation,
              json_set(task_json, '$.id', '66666666-6666-4666-8666-666666666666', '$.threadId', ${otherThread})
            FROM projection_weavra_tasks
          `);
          assert.equal(duplicate._tag, "Failure");
        }
      }).pipe(Effect.provide(systemLayer(path.join(directory, "state.sqlite")))),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect(
  "freezes confirmation and reloads a finished task with a noncompleted Runtime outcome",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const crypto = yield* Crypto.Crypto;
      const directory = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-task-binding-" });
      const databasePath = path.join(directory, "state.sqlite");
      const context = decodeContext({
        version: 1,
        packetVersion: 1,
        authority: "ADVISORY_ONLY",
        reviewedAt: 100,
        symptom: "Observed failure",
        observations: [],
        candidateCause: { kind: "HYPOTHESIS", text: "Candidate cause" },
        uncertainties: [],
        sourceReferences: [],
        constraints: [],
      });
      const bytes = yield* crypto.digest(
        "SHA-256",
        new TextEncoder().encode(
          stableStringify({ domain: "weavra.analysis-context.v1", packet: context }),
        ),
      );
      const advisoryDigest = `sha256:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      const digest = `sha256:${"b".repeat(64)}`;
      const confirming = decodeTask({
        ...initialTask,
        context,
        revision: 2,
        phase: "handoff",
        ownership: { generation: 2, state: "draining" },
        execution: {
          binding: {
            taskId: initialTask.id,
            environmentId: initialTask.environmentId,
            projectId,
            threadId,
            checkout: initialTask.checkout,
            executionId: "22222222-2222-4222-8222-222222222222",
            packetVersion: 1,
            advisoryDigest,
            symptomVerification: {
              criterionId: "AC-001",
              checkId: "symptom",
              registrationDigest: digest,
            },
          },
          previewId: "preview",
          previewDigest: digest,
          configDigest: digest,
          confirmedProjectRevision: 4,
          confirmCommandId: "confirm",
          receipt: null,
        },
      });
      assert.ok(confirming.execution !== null);
      const execution = confirming.execution;
      const finished = decodeTask({
        ...confirming,
        phase: "finished",
        revision: 3,
        ownership: { generation: 3, state: "released" },
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
                confirmedProjectRevision: 4,
                admittedProjectRevision: 5,
              },
              outcome: { status: "STARTED", runId: "canonical-run" },
              acceptedAt: 101,
              updatedAt: 102,
            },
            run: { runId: "canonical-run", status: "CANCELLED", revision: 7 },
          },
        },
      });
      yield* Effect.scoped(
        Effect.gen(function* () {
          yield* seed;
          const engine = yield* OrchestrationEngineService;
          yield* engine.dispatch({ ...create, task: decodeTask({ ...initialTask, context }) });
          const confirm: WeavraTaskSetCommand = {
            ...create,
            commandId: CommandId.make("confirm"),
            expectedRevision: 1,
            expectedOwnershipGeneration: 1,
            task: confirming,
          };
          const first = yield* engine.dispatch(confirm);
          assert.deepStrictEqual(yield* engine.dispatch(confirm), first);
          const changed = decodeTask({
            ...confirming,
            revision: 3,
            ownership: { generation: 3, state: "draining" },
            context: { ...context, symptom: "Changed after confirmation" },
          });
          assert.equal(
            (yield* Effect.result(
              engine.dispatch({
                ...confirm,
                commandId: CommandId.make("rewrite-confirmed-packet"),
                expectedRevision: 2,
                expectedOwnershipGeneration: 2,
                task: changed,
              }),
            ))._tag,
            "Failure",
          );
          yield* engine.dispatch({
            ...confirm,
            commandId: CommandId.make("finish"),
            expectedRevision: 2,
            expectedOwnershipGeneration: 2,
            task: finished,
          });
        }).pipe(Effect.provide(systemLayer(databasePath))),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const query = yield* ProjectionSnapshotQuery;
          const engine = yield* OrchestrationEngineService;
          const snapshot = yield* query.getSnapshot();
          assert.deepStrictEqual(snapshot.weavraTasks, [finished]);
          assert.equal(snapshot.weavraOwnership?.[0]?.generation, 3);
          assert.equal(snapshot.weavraOwnership?.[0]?.taskId, null);
          const next = decodeTask({
            ...initialTask,
            id: "77777777-7777-4777-8777-777777777777",
            ownership: { generation: 4, state: "analysis" },
          });
          yield* engine.dispatch({
            ...create,
            commandId: CommandId.make("new-task"),
            expectedOwnershipGeneration: 3,
            task: next,
          });
          assert.equal((yield* query.getSnapshot()).weavraOwnership?.[0]?.generation, 4);
        }).pipe(Effect.provide(systemLayer(databasePath))),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
);
