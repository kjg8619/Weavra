import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { APP_UPDATE_UNAVAILABLE_REASON } from "@t3tools/shared/cliRelease";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import { HttpClient } from "effect/unstable/http";
import * as ProcessRunner from "../processRunner.ts";
import {
  ensurePinnedRuntimeInstalled,
  pinnedRuntimePaths,
  PinnedRuntimeInstallError,
} from "./pinnedRuntime.ts";

it.layer(NodeServices.layer)("Weavra pinned runtime", (it) => {
  it.effect("refuses inherited archives without HTTP, extraction or destructive repair", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-release-" });
      const paths = pinnedRuntimePaths(path, baseDir, "1.2.3", "linux");
      yield* fs.makeDirectory(paths.versionDir, { recursive: true });
      const marker = path.join(paths.versionDir, "partial");
      yield* fs.writeFileString(marker, "preserve");
      const requests: string[] = [];
      const error = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version: "1.2.3",
        fs,
        path,
        platform: "linux",
        arch: "x64",
        releaseBaseUrl: "https://github.com/pingdotgg/t3code/releases/download",
        httpClient: HttpClient.make((request) => {
          requests.push(request.url);
          return Effect.die("unexpected HTTP");
        }),
        runner: ProcessRunner.ProcessRunner.of({ run: () => Effect.die("unexpected process") }),
        validate: () => Effect.die("unexpected validation"),
      }).pipe(Effect.flip);
      assert.deepInclude(error, {
        _tag: "PinnedRuntimeInstallError",
        step: APP_UPDATE_UNAVAILABLE_REASON,
      });
      assert.deepEqual(requests, []);
      assert.equal(yield* fs.readFileString(marker), "preserve");
    }),
  );

  it.effect("preserves an installed runtime when local validation fails without replacing it", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const baseDir = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-cached-" });
      const paths = pinnedRuntimePaths(path, baseDir, "1.2.3", "linux");
      yield* fs.makeDirectory(paths.versionDir, { recursive: true });
      yield* fs.writeFileString(paths.entryPath, "existing");
      yield* fs.writeFileString(paths.sentinelPath, "1.2.3\n");
      const error = yield* ensurePinnedRuntimeInstalled({
        baseDir,
        version: "1.2.3",
        fs,
        path,
        platform: "linux",
        arch: "x64",
        httpClient: HttpClient.make(() => Effect.die("unexpected HTTP")),
        runner: ProcessRunner.ProcessRunner.of({ run: () => Effect.die("unexpected process") }),
        validate: () => Effect.fail(new PinnedRuntimeInstallError({ step: "local validation" })),
      }).pipe(Effect.flip);
      assert.deepInclude(error, { _tag: "PinnedRuntimeInstallError", step: "local validation" });
      assert.equal(yield* fs.readFileString(paths.entryPath), "existing");
    }),
  );
});
