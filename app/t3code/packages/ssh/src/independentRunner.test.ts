import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { buildRemoteT3RunnerScript } from "./tunnel.ts";

const decodeArguments = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.String)),
);

const runShell = (script: string, args: string[], env: Record<string, string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make("/bin/sh", ["-s", "--", ...args], {
        env,
        detached: false,
        stdin: Stream.make(new TextEncoder().encode(script)),
      }),
    );
    const [stdout, code] = yield* Effect.all(
      [child.stdout.pipe(Stream.decodeText(), Stream.mkString), child.exitCode],
      { concurrency: "unbounded" },
    );
    return { stdout, code };
  }).pipe(Effect.timeout("5 seconds"));

describe.skipIf(HostProcessPlatform.defaultValue() === "win32")(
  "independent remote runtime",
  () => {
    it.live("refuses missing runtimes without invoking a downloader", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-ssh-" });
        const bin = path.join(root, "bin");
        const marker = path.join(root, "network-attempt");
        yield* fs.makeDirectory(bin);
        for (const name of ["curl", "wget"]) {
          const executable = path.join(bin, name);
          yield* fs.writeFileString(
            executable,
            '#!/bin/sh\nprintf attempted > "$NETWORK_MARKER"\nexit 1\n',
          );
          yield* fs.chmod(executable, 0o755);
        }
        const result = yield* runShell(
          buildRemoteT3RunnerScript({ archiveVersion: "1.2.3" }),
          ["--version"],
          { HOME: root, PATH: `${bin}:/usr/bin:/bin`, NETWORK_MARKER: marker },
        );
        assert.strictEqual(result.code, 1);
        assert.isFalse(yield* fs.exists(marker));
        assert.isFalse(yield* fs.exists(path.join(root, ".t3")));
        assert.isFalse(yield* fs.exists(path.join(root, ".weavra", "app", "runtime")));
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
    );

    it.live("runs an explicit source checkout without provisioning", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-source-ssh-" });
        const source = path.join(root, "server.mjs");
        yield* fs.writeFileString(
          source,
          "process.stdout.write(JSON.stringify(process.argv.slice(2)));\n",
        );
        const result = yield* runShell(
          buildRemoteT3RunnerScript({ nodeScriptPath: source }),
          ["auth", "pairing", "create"],
          { HOME: root, PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin` },
        );
        assert.strictEqual(result.code, 0);
        assert.deepStrictEqual(decodeArguments(result.stdout), ["auth", "pairing", "create"]);
        assert.isFalse(yield* fs.exists(path.join(root, ".t3")));
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
    );

    it.live("runs an explicitly provisioned runtime from the canonical app home", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-provisioned-ssh-" });
        const appHome = path.join(root, "explicit-app");
        const runtime = path.join(appHome, "runtime", "versions", "1.2.3");
        yield* fs.makeDirectory(runtime, { recursive: true });
        const executable = path.join(runtime, "weavra-server");
        yield* fs.writeFileString(executable, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
        yield* fs.chmod(executable, 0o755);
        yield* fs.writeFileString(path.join(runtime, ".install-complete"), "1.2.3\n");
        const result = yield* runShell(
          buildRemoteT3RunnerScript({ archiveVersion: "1.2.3" }),
          ["auth", "pairing", "create", "argument with spaces"],
          { HOME: root, WEAVRA_APP_HOME: appHome, PATH: "/usr/bin:/bin" },
        );
        assert.strictEqual(result.code, 0);
        assert.strictEqual(result.stdout, "auth\npairing\ncreate\nargument with spaces\n");
        assert.isFalse(yield* fs.exists(path.join(root, ".t3")));
      }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
    );
  },
);
