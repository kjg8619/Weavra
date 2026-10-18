import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../orchestration/ThreadPlanProgress.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ProcessRunner from "../processRunner.ts";
import { ServerConfig } from "../config.ts";
import * as Ownership from "../workspace/WorkspaceExecutionOwnership.ts";
import * as OwnershipTest from "../workspace/WorkspaceExecutionOwnershipTest.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { writeFakeCli } from "../testUtils/fakeCli.ts";
import { prepareTaskProject } from "./ProjectTaskPreparation.ts";
import { TaskCoordinatorError } from "./TaskCoordinator.ts";
const isTaskError = Schema.is(TaskCoordinatorError);

const system = OrchestrationEngineLive.pipe(
  Layer.provideMerge(OrchestrationProjectionSnapshotQueryLive),
  Layer.provide(OrchestrationProjectionPipelineLive),
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provide(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(Ownership.layer),
  Layer.provide(OwnershipTest.environmentLayer),
  Layer.provideMerge(ProcessRunner.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "weavra-task-preparation-" })),
  Layer.provideMerge(NodeServices.layer),
);
const projectId = ProjectId.make("preparation-project");
const threadId = ThreadId.make("preparation-thread");
const time = "2026-10-16T00:00:00.000Z";
const fakeCli =
  "import{appendFileSync}from'node:fs';" +
  "const args=process.argv.slice(2);appendFileSync('.ai/invocations.jsonl',JSON.stringify(args)+'\\n');" +
  "if(args.join('|')==='project|read|--json'){console.log(JSON.stringify({schemaVersion:1,kind:'error',code:'CONFIG_MISSING',message:'fixture'}));process.exitCode=1;}" +
  "else if(args.join('|')==='project|draft|--json')console.log(JSON.stringify({schemaVersion:1,kind:'draft',projectTypes:['Generic'],workspaceProfile:{schemaVersion:1,kind:'supported',profile:{mode:'default',candidate:false},fileCount:1,totalBytes:1},modelAvailability:{providers:[]},yaml:'models: {}'}));" +
  "else process.exit(42);";
const fixture = Effect.fn("taskPreparationTest.fixture")(function* (configured = true) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const engine = yield* OrchestrationEngineService;
  const ownership = yield* Ownership.WorkspaceExecutionOwnership;
  const base = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-task-preparation-" });
  const cwd = yield* fs.realPath(base);
  yield* fs.writeFileString(path.join(cwd, "README.md"), "fixture source");
  yield* fs.makeDirectory(path.join(cwd, ".ai"));
  if (configured)
    yield* fs.writeFileString(
      path.join(cwd, ".ai", "config.yaml"),
      "preserve existing config bytes",
    );
  const executable = writeFakeCli({ directory: cwd, name: "fixture-runtime", source: fakeCli });
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("create-project"),
    projectId,
    title: "Preparation",
    workspaceRoot: cwd,
    createdAt: time,
  });
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create-thread"),
    projectId,
    threadId,
    title: "Preparation",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdAt: time,
  });
  const input = {
    environmentId: ownership.environmentId,
    projectId,
    threadId,
    commandId: CommandId.make("first-start"),
  };
  const prepare = (value = input) =>
    prepareTaskProject(value).pipe(
      Effect.provideService(HostProcessEnvironment, {
        PATH: process.env.PATH,
        HOME: cwd,
        WEAVRA_HOME: path.join(cwd, "runtime-home"),
        T3_WEAVRA_CONTROL: "1",
        T3_WEAVRA_EXECUTABLE: executable,
      }),
      Effect.provide(Layer.mock(ProviderRegistry)({ getProviders: Effect.succeed([]) })),
    );
  const git = (...args: string[]) =>
    runner
      .run({ command: "git", args: ["-C", cwd, ...args] })
      .pipe(Effect.map((value) => value.stdout));
  return { fs, path, cwd, input, prepare, git, ownership };
});

it.effect(
  "prepares Git once while preserving existing configuration and avoiding task/model execution",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      assert.isFalse(yield* test.fs.exists(test.path.join(test.cwd, ".git")));

      const cwd = yield* test.prepare();
      yield* test.prepare();

      assert.equal(cwd, test.cwd);
      assert.equal((yield* test.git("rev-list", "--count", "HEAD")).trim(), "1");
      assert.equal(
        yield* test.fs.readFileString(test.path.join(test.cwd, ".ai", "config.yaml")),
        "preserve existing config bytes",
      );
      assert.isFalse(yield* test.fs.exists(test.path.join(test.cwd, ".ai", "invocations.jsonl")));
      assert.equal(
        (yield* (yield* ProjectionSnapshotQuery).getCommandReadModel()).weavraTasks?.length ?? 0,
        0,
      );
    }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect(
  "rejects foreign selectors and reused unrelated commands before any repository mutation",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture();
      for (const input of [
        { ...test.input, environmentId: EnvironmentId.make("foreign") },
        { ...test.input, projectId: ProjectId.make("foreign") },
        { ...test.input, threadId: ThreadId.make("foreign") },
        { ...test.input, commandId: CommandId.make("create-project") },
      ]) {
        const result = yield* test.prepare(input).pipe(Effect.result);
        assert.equal(result._tag, "Failure");
        assert.isFalse(yield* test.fs.exists(test.path.join(test.cwd, ".git")));
      }
    }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("does not snapshot an active writer and works after its exact release", () =>
  Effect.gen(function* () {
    const test = yield* fixture();
    const token = yield* test.ownership.acquireIndependent({ cwd: test.cwd, kind: "write" });
    const denied = yield* test.prepare().pipe(Effect.result);
    assert.equal(denied._tag, "Failure");
    if (denied._tag === "Failure") {
      assert.ok(isTaskError(denied.failure));
      if (isTaskError(denied.failure))
        assert.equal(denied.failure.code, "PROJECT_PREPARATION_BUSY");
    }
    assert.isFalse(yield* test.fs.exists(test.path.join(test.cwd, ".git")));
    yield* test.ownership.release(token);

    yield* test.prepare();

    assert.equal((yield* test.git("rev-list", "--count", "HEAD")).trim(), "1");
    assert.equal((yield* test.ownership.activeOperations).length, 0);
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect("serializes simultaneous first preparation for the same canonical directory", () =>
  Effect.gen(function* () {
    const test = yield* fixture();
    yield* Effect.all([test.prepare(), test.prepare()], { concurrency: "unbounded" });
    assert.equal((yield* test.git("rev-list", "--count", "HEAD")).trim(), "1");
    assert.equal((yield* test.ownership.activeOperations).length, 0);
  }).pipe(Effect.scoped, Effect.provide(system)),
);

it.effect(
  "keeps a completed baseline without saving an unauthenticated model draft or repeating commits",
  () =>
    Effect.gen(function* () {
      const test = yield* fixture(false);
      for (const commandId of ["first-start", "explicit-retry"]) {
        const result = yield* test
          .prepare({ ...test.input, commandId: CommandId.make(commandId) })
          .pipe(Effect.result);
        assert.equal(result._tag, "Failure");
        if (result._tag === "Failure") {
          assert.ok(isTaskError(result.failure));
          if (isTaskError(result.failure))
            assert.equal(result.failure.code, "PROJECT_NOT_CONFIGURED");
        }
      }
      assert.equal((yield* test.git("rev-list", "--count", "HEAD")).trim(), "1");
      assert.isFalse(yield* test.fs.exists(test.path.join(test.cwd, ".ai", "config.yaml")));
      const requests = (yield* test.fs.readFileString(
        test.path.join(test.cwd, ".ai", "invocations.jsonl"),
      ))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      assert.deepStrictEqual(requests, [
        ["project", "read", "--json"],
        ["project", "draft", "--json"],
        ["project", "read", "--json"],
        ["project", "draft", "--json"],
      ]);
    }).pipe(Effect.scoped, Effect.provide(system)),
);
