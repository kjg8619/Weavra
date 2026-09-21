import { CLI_DISTRIBUTION_UNAVAILABLE_REASON } from "@t3tools/shared/cliRelease";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import type * as Path from "effect/Path";
import * as Schema from "effect/Schema";

export interface PinnedRuntimePaths {
  readonly versionDir: string;
  readonly entryPath: string;
  readonly sentinelPath: string;
}

export function pinnedRuntimeCommand(paths: PinnedRuntimePaths): {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
} {
  return { command: paths.entryPath, args: [] };
}

export function pinnedRuntimeVersionsDir(path: Path.Path, baseDir: string): string {
  return path.join(baseDir, "runtime", "versions");
}

export function pinnedRuntimePaths(
  path: Path.Path,
  baseDir: string,
  version: string,
  platform: NodeJS.Platform,
): PinnedRuntimePaths {
  const versionDir = path.join(pinnedRuntimeVersionsDir(path, baseDir), version);
  return {
    versionDir,
    entryPath: path.join(versionDir, platform === "win32" ? "weavra-server.exe" : "weavra-server"),
    sentinelPath: path.join(versionDir, ".install-complete"),
  };
}

export class PinnedRuntimeInstallError extends Schema.TaggedError<PinnedRuntimeInstallError>()(
  "PinnedRuntimeInstallError",
  {
    step: Schema.String,
    exitCode: Schema.optional(Schema.Number),
    stdoutLength: Schema.optional(Schema.Number),
    stderrLength: Schema.optional(Schema.Number),
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.exitCode === undefined
      ? `Pinned runtime install failed while ${this.step}.`
      : `Pinned runtime install failed while ${this.step} (exit code ${this.exitCode}).`;
  }
}

export class PinnedRuntimePreflightBlockedError extends Schema.TaggedError<PinnedRuntimePreflightBlockedError>()(
  "PinnedRuntimePreflightBlockedError",
  { version: Schema.String, reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

export type PinnedRuntimeProgress =
  | { readonly stage: "download"; readonly received: number; readonly total: number | undefined }
  | { readonly stage: "verify" | "extract" | "validate" | "cached" };

interface PinnedRuntimeInstallInput {
  readonly baseDir: string;
  readonly version: string;
  readonly fs: FileSystem.FileSystem;
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  readonly validate: (
    paths: PinnedRuntimePaths,
  ) => Effect.Effect<void, PinnedRuntimeInstallError | PinnedRuntimePreflightBlockedError>;
  readonly onProgress?: (progress: PinnedRuntimeProgress) => void;
}

/** Only explicitly provisioned, complete independent runtimes can be reused. */
export const ensurePinnedRuntimeInstalled = Effect.fn("cloud.pinned_runtime.ensure_installed")(
  function* (input: PinnedRuntimeInstallInput) {
    const paths = pinnedRuntimePaths(input.path, input.baseDir, input.version, input.platform);
    const [entryExists, sentinel] = yield* Effect.all([
      input.fs.exists(paths.entryPath),
      input.fs.readFileString(paths.sentinelPath).pipe(Effect.option),
    ]).pipe(
      Effect.mapError(
        (cause) =>
          new PinnedRuntimeInstallError({
            step: "checking the pinned runtime",
            cause,
          }),
      ),
    );
    if (!entryExists || Option.isNone(sentinel) || sentinel.value.trim() !== input.version) {
      return yield* new PinnedRuntimeInstallError({ step: CLI_DISTRIBUTION_UNAVAILABLE_REASON });
    }
    input.onProgress?.({ stage: "cached" });
    yield* input.validate(paths);
    return paths;
  },
);
