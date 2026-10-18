import * as NodeCrypto from "node:crypto";
import {
  WeavraProjectSetupError,
  WeavraProjectSetupInput,
  WeavraProjectSetupOutput,
  type WeavraProjectSetupResult,
} from "@t3tools/contracts";
import { HostProcessEnvironment } from "@t3tools/shared/hostProcess";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { WorkspaceExecutionOwnership } from "../workspace/WorkspaceExecutionOwnership.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { recommendProjectModels } from "./ProjectModelRecommendation.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";

const decodeInput = Schema.decodeUnknownEffect(WeavraProjectSetupInput);
const decodeOutput = Schema.decodeEffect(Schema.fromJsonString(WeavraProjectSetupOutput), {
  onExcessProperty: "error",
});
const encodeUpdateInput = Schema.encodeSync(
  Schema.fromJsonString(
    Schema.Struct({ yaml: Schema.String, expectedConfigDigest: Schema.String }),
  ),
);
const encodeTrialCheckInput = Schema.encodeSync(
  Schema.fromJsonString(Schema.Struct({ checkId: Schema.String, consent: Schema.Literal(true) })),
);

export const projectSetupTargetDigest = (target: {
  readonly projectId: string;
  readonly canonicalCwd: string;
  readonly repositoryRoot: string;
  readonly target: { readonly workspaceRoot: string; readonly worktreePath: string | null };
}) =>
  `sha256:${NodeCrypto.createHash("sha256")
    .update(
      JSON.stringify([target.projectId, target.canonicalCwd, target.repositoryRoot, target.target]),
    )
    .digest("hex")}`;

/** Fixed launcher commands only. Cwd and executable are server-owned, reviewed YAML travels over stdin. */
export const setupProject = Effect.fn("weavra.setupProject")(function* (
  raw: WeavraProjectSetupInput,
) {
  const input = yield* decodeInput(raw).pipe(
    Effect.mapError(() => new WeavraProjectSetupError({ code: "INVALID_PAYLOAD" })),
  );
  const ownership = yield* WorkspaceExecutionOwnership;
  const path = yield* Path.Path;
  const environment = yield* HostProcessEnvironment;
  const executable = environment.T3_WEAVRA_EXECUTABLE;
  if (!executable || !path.isAbsolute(executable) || environment.T3_WEAVRA_CONTROL !== "1")
    return yield* new WeavraProjectSetupError({ code: "UNAVAILABLE" });
  if (input.scope.environmentId !== ownership.environmentId)
    return yield* new WeavraProjectSetupError({ code: "TARGET_CHANGED" });
  const resolveTarget = Effect.fn("weavra.setupProject.resolveTarget")(function* () {
    const checkout = yield* ownership.resolveTarget(input.scope.threadId).pipe(Effect.result);
    if (checkout._tag === "Success") {
      if (checkout.success.projectId !== input.scope.projectId)
        return yield* new WeavraProjectSetupError({ code: "TARGET_CHANGED" });
      return checkout.success;
    }
    // Configuration is project metadata, not execution admission. A normal
    // conversation may configure a new folder without creating Git or a task.
    if (
      checkout.failure.reason !== "target-changed" ||
      input.action === "doctor" ||
      input.action === "initialize"
    )
      return yield* new WeavraProjectSetupError({ code: "TARGET_CHANGED" });
    const query = yield* ProjectionSnapshotQuery;
    const fs = yield* FileSystem.FileSystem;
    const thread = yield* query
      .getThreadShellById(input.scope.threadId)
      .pipe(Effect.mapError(() => new WeavraProjectSetupError({ code: "TARGET_CHANGED" })));
    if (Option.isNone(thread) || thread.value.projectId !== input.scope.projectId)
      return yield* new WeavraProjectSetupError({ code: "TARGET_CHANGED" });
    const project = yield* query
      .getProjectShellById(input.scope.projectId)
      .pipe(Effect.mapError(() => new WeavraProjectSetupError({ code: "TARGET_CHANGED" })));
    if (Option.isNone(project))
      return yield* new WeavraProjectSetupError({ code: "TARGET_CHANGED" });
    const target = {
      workspaceRoot: project.value.workspaceRoot,
      worktreePath: thread.value.worktreePath,
    };
    const canonicalCwd = yield* fs
      .realPath(target.worktreePath ?? target.workspaceRoot)
      .pipe(Effect.mapError(() => new WeavraProjectSetupError({ code: "TARGET_CHANGED" })));
    const info = yield* fs
      .stat(canonicalCwd)
      .pipe(Effect.mapError(() => new WeavraProjectSetupError({ code: "TARGET_CHANGED" })));
    if (info.type !== "Directory")
      return yield* new WeavraProjectSetupError({ code: "TARGET_CHANGED" });
    return {
      environmentId: input.scope.environmentId,
      projectId: input.scope.projectId,
      threadId: input.scope.threadId,
      target,
      canonicalCwd,
      repositoryRoot: canonicalCwd,
    };
  });
  const selected = yield* resolveTarget();
  const targetDigest = projectSetupTargetDigest(selected);
  if (
    (input.action === "save" || input.action === "update" || input.action === "trial-check") &&
    input.targetDigest !== targetDigest
  )
    return yield* new WeavraProjectSetupError({ code: "TARGET_CHANGED" });
  const operation = Effect.gen(function* () {
    if (projectSetupTargetDigest(yield* resolveTarget()) !== targetDigest)
      return yield* new WeavraProjectSetupError({ code: "TARGET_CHANGED" });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const env: Record<string, string> = {};
    for (const key of ["PATH", "HOME", "WEAVRA_HOME", "LANG", "LC_ALL", "SystemRoot"] as const) {
      if (environment[key] !== undefined) env[key] = environment[key];
    }
    const child = yield* spawner
      .spawn(
        ChildProcess.make(
          executable,
          input.action === "draft"
            ? ["project", "draft", "--json"]
            : input.action === "read"
              ? ["project", "read", "--json"]
              : input.action === "doctor"
                ? ["project", "doctor", "--app-json"]
                : input.action === "initialize"
                  ? ["project", "initialize", "--json"]
                  : input.action === "save"
                    ? ["project", "init", "--stdin", "--json"]
                    : input.action === "trial-check"
                      ? ["project", "trial-check", "--stdin", "--json"]
                      : ["project", "update", "--stdin", "--json"],
          {
            cwd: selected.canonicalCwd,
            env,
            extendEnv: false,
            stdin:
              input.action === "save"
                ? Stream.make(Buffer.from(input.yaml))
                : input.action === "update"
                  ? Stream.make(
                      Buffer.from(
                        encodeUpdateInput({
                          yaml: input.yaml,
                          expectedConfigDigest: input.expectedConfigDigest,
                        }),
                      ),
                    )
                  : input.action === "trial-check"
                    ? Stream.make(
                        Buffer.from(
                          encodeTrialCheckInput({ checkId: input.checkId, consent: input.consent }),
                        ),
                      )
                    : "ignore",
            stdout: "pipe",
            stderr: "pipe",
            killSignal: "SIGTERM",
            forceKillAfter: Duration.seconds(2),
          },
        ),
      )
      .pipe(Effect.mapError(() => new WeavraProjectSetupError({ code: "UNAVAILABLE" })));
    yield* child.stderr.pipe(Stream.runDrain, Effect.ignore, Effect.forkScoped);
    const buffer = Buffer.alloc(128 * 1024);
    let length = 0;
    yield* child.stdout.pipe(
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          if (length + chunk.length > buffer.length)
            return yield* new WeavraProjectSetupError({ code: "INVALID_PAYLOAD" });
          buffer.set(chunk, length);
          length += chunk.length;
        }),
      ),
      Effect.mapError(() => new WeavraProjectSetupError({ code: "INVALID_PAYLOAD" })),
    );
    const exit = yield* child.exitCode.pipe(
      Effect.mapError(() => new WeavraProjectSetupError({ code: "UNAVAILABLE" })),
    );
    const text = yield* Effect.try({
      try: () => new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, length)),
      catch: () => new WeavraProjectSetupError({ code: "INVALID_PAYLOAD" }),
    });
    const result = yield* decodeOutput(text).pipe(
      Effect.mapError(() => new WeavraProjectSetupError({ code: "INVALID_PAYLOAD" })),
    );
    const expectedExit =
      result.kind === "error" || (result.kind === "doctor" && !result.ready) ? 1 : 0;
    if (
      exit !== expectedExit ||
      (result.kind !== "error" &&
        result.kind !==
          (input.action === "draft"
            ? "draft"
            : input.action === "read"
              ? "read"
              : input.action === "doctor"
                ? "doctor"
                : input.action === "initialize"
                  ? "initialized"
                  : input.action === "trial-check"
                    ? "trial-check"
                    : "saved"))
    )
      return yield* new WeavraProjectSetupError({ code: "INVALID_PAYLOAD" });
    if (projectSetupTargetDigest(yield* resolveTarget()) !== targetDigest)
      return yield* new WeavraProjectSetupError({ code: "TARGET_CHANGED" });
    if (result.kind === "draft") {
      const registry = yield* ProviderRegistry;
      const proposed = recommendProjectModels(result, yield* registry.getProviders);
      return {
        targetDigest,
        result: proposed.draft,
        recommendation: proposed.recommendation,
        presets: proposed.presets,
      } satisfies WeavraProjectSetupResult;
    }
    return { targetDigest, result } satisfies WeavraProjectSetupResult;
  }).pipe(
    Effect.timeout("75 seconds"),
    Effect.catchTag("TimeoutError", () =>
      Effect.fail(new WeavraProjectSetupError({ code: "UNAVAILABLE" })),
    ),
    Effect.scoped,
  );
  return yield* ownership
    .withFreshOperation(
      { cwd: selected.canonicalCwd, kind: "write", threadId: input.scope.threadId },
      operation,
    )
    .pipe(
      Effect.catchTag("WorkspaceOwnershipError", () =>
        Effect.fail(new WeavraProjectSetupError({ code: "WORKSPACE_BUSY" })),
      ),
    );
});
