import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { ensurePinnedRuntimeInstalled, pinnedRuntimePaths } from "./pinnedRuntime.ts";

it.layer(NodeServices.layer)("independent pinned runtime", (it) => {
  it.effect("refuses missing or incomplete runtimes without deleting local files", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-pinned-" });
      const paths = pinnedRuntimePaths(path, baseDir, "1.2.3", "linux");
      const input = {
        baseDir,
        version: "1.2.3",
        fs,
        path,
        platform: "linux" as const,
        validate: () => Effect.die("An incomplete runtime must never be executed"),
      };
      assert.strictEqual(
        (yield* ensurePinnedRuntimeInstalled(input).pipe(Effect.flip))._tag,
        "PinnedRuntimeInstallError",
      );
      assert.isFalse(yield* fs.exists(paths.versionDir));
      yield* fs.makeDirectory(paths.versionDir, { recursive: true });
      yield* fs.writeFileString(paths.entryPath, "local-unfinished-binary");
      assert.strictEqual(
        (yield* ensurePinnedRuntimeInstalled(input).pipe(Effect.flip))._tag,
        "PinnedRuntimeInstallError",
      );
      assert.strictEqual(yield* fs.readFileString(paths.entryPath), "local-unfinished-binary");
      assert.isFalse(yield* fs.exists(paths.sentinelPath));
    }),
  );
  it.effect("validates an explicitly provisioned complete local runtime", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-pinned-local-" });
      const paths = pinnedRuntimePaths(path, baseDir, "1.2.3", "linux");
      yield* fs.makeDirectory(paths.versionDir, { recursive: true });
      yield* fs.writeFileString(paths.entryPath, "local-binary");
      yield* fs.writeFileString(paths.sentinelPath, "1.2.3\n");
      let validated = false;
      const result = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version: "1.2.3",
        fs,
        path,
        platform: "linux",
        validate: (runtime) =>
          Effect.sync(() => {
            assert.deepStrictEqual(runtime, paths);
            validated = true;
          }),
      });
      assert.isTrue(validated);
      assert.deepStrictEqual(result, paths);
    }),
  );
});
