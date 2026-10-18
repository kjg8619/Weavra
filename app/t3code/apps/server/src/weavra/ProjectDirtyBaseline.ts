import * as NodeURL from "node:url";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { projectGit } from "./ProjectGitPreparation.ts";

export class ProjectDirtyBaselineError extends Schema.TaggedError<ProjectDirtyBaselineError>()(
  "ProjectDirtyBaselineError",
  {
    code: Schema.Literals([
      "CONSENT_REQUIRED",
      "UNSAFE_PATH",
      "DIRTY_SET_CHANGED",
      "HEAD_CHANGED",
      "UNAVAILABLE",
    ]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
const isBaselineError = Schema.is(ProjectDirtyBaselineError);

export const DIRTY_BASELINE_COMMIT_MESSAGE = "Weavra: 작업 시작 전 기준 커밋";
const isProjectMetadata = (file: string) => file === ".ai" || file.startsWith(".ai/");
// Commit and verification flags: no hooks, signing, fsmonitor or path magic.
const flags = [
  "--literal-pathspecs",
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "commit.gpgSign=false",
];
/** The Runtime clean-start status parse: every entry path plus both sides of a rename/copy, minus `.ai/`. */
function dirtyPaths(status: string): string[] {
  const fields = status.split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < fields.length; index++) {
    const entry = fields[index];
    if (!entry) continue;
    paths.add(entry.slice(3));
    const original = fields[index + 1];
    if (/[RC]/.test(entry.slice(0, 2)) && original) {
      paths.add(original);
      index++;
    }
  }
  return [...paths].filter((file) => !isProjectMetadata(file)).toSorted();
}

/**
 * Explicit consent only. Commits exactly the reviewed dirty paths of the user's own project
 * checkout, after re-reading its status; any difference refuses with nothing staged or committed.
 * Never pushes, amends or moves another ref.
 */
export const commitDirtyBaseline = Effect.fn("weavra.commitDirtyBaseline")(
  function* (input: {
    readonly cwd: string;
    readonly files: readonly string[];
    readonly consent: boolean;
    /** The task's bound HEAD. A dirty checkout has no clean identity, so this is what still binds it. */
    readonly expectedHead: string;
    /** Weavra-owned roots (App home, the running server's own source) that must never be committed. */
    readonly protectedRoots: readonly string[];
  }) {
    if (input.consent !== true)
      return yield* new ProjectDirtyBaselineError({ code: "CONSENT_REQUIRED" });
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const files = [...new Set(input.files)].toSorted();
    if (
      files.length === 0 ||
      files.length !== input.files.length ||
      files.some(
        (file) =>
          !file ||
          isProjectMetadata(file) ||
          path.isAbsolute(file) ||
          file.split("/").some((part) => part === ".." || part === ".git"),
      )
    )
      return yield* new ProjectDirtyBaselineError({ code: "UNSAFE_PATH" });
    const root = yield* fs.realPath(input.cwd);
    const inside = (child: string, parent: string) => {
      const relative = path.relative(parent, child);
      return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
    };
    const ownSource = path.dirname(NodeURL.fileURLToPath(import.meta.url));
    for (const raw of [...input.protectedRoots, ownSource]) {
      const guarded = yield* fs.realPath(raw).pipe(Effect.orElseSucceed(() => path.resolve(raw)));
      if (inside(root, guarded) || inside(guarded, root))
        return yield* new ProjectDirtyBaselineError({ code: "UNSAFE_PATH" });
    }
    const git = yield* projectGit(root);
    const top = (yield* git(["rev-parse", "--show-toplevel"])).stdout.trim();
    if ((yield* fs.realPath(top)) !== root)
      return yield* new ProjectDirtyBaselineError({ code: "UNSAFE_PATH" });
    const head = () =>
      git(["rev-parse", "--verify", "HEAD^{commit}"]).pipe(
        Effect.map((result) => result.stdout.trim()),
      );
    if ((yield* head()) !== input.expectedHead)
      return yield* new ProjectDirtyBaselineError({ code: "HEAD_CHANGED" });
    const status = () =>
      git([...flags, "status", "--porcelain=v1", "-z", "--untracked-files=all"]).pipe(
        Effect.map((result) => dirtyPaths(result.stdout)),
      );
    const before = yield* status();
    if (before.length !== files.length || before.some((file, index) => file !== files[index]))
      return yield* new ProjectDirtyBaselineError({ code: "DIRTY_SET_CHANGED" });
    yield* git([...flags, "add", "--all", "--", ...files]);
    // A pathspec commit records only these paths even if something else was already staged.
    yield* git([
      ...flags,
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      DIRTY_BASELINE_COMMIT_MESSAGE,
      "--",
      ...files,
    ]);
    const headCommit = yield* head();
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(headCommit))
      return yield* new ProjectDirtyBaselineError({ code: "UNAVAILABLE" });
    const after = new Set(yield* status());
    if (files.some((file) => after.has(file)))
      return yield* new ProjectDirtyBaselineError({ code: "UNAVAILABLE" });
    return { headCommit };
  },
  Effect.timeout("60 seconds"),
  Effect.mapError((error) =>
    isBaselineError(error)
      ? error
      : new ProjectDirtyBaselineError({ code: "UNAVAILABLE", cause: error }),
  ),
);
