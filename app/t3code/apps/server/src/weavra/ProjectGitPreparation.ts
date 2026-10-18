import * as NodeCrypto from "node:crypto";
import * as ByteSize from "effect/ByteSize";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";

export class ProjectGitPreparationError extends Schema.TaggedError<ProjectGitPreparationError>()(
  "ProjectGitPreparationError",
  {
    code: Schema.Literals(["UNAVAILABLE", "UNSAFE_PATH", "CHANGED", "CAPACITY"]),
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {}
const isPreparationError = Schema.is(ProjectGitPreparationError);
const MiB = 1024 * 1024;
const excludes = [
  ".weavra-git-bootstrap-*/",
  ".ai/",
  ".omo/",
  ".weavra/",
  ".DS_Store",
  "node_modules/",
  "vendor/",
  "target/",
  "dist/",
  "build/",
  "coverage/",
  ".venv/",
  "venv/",
  ".env",
  ".env.*",
  ".npmrc",
  ".pypirc",
  ".netrc",
  "auth.json",
  "credentials.json",
  "*.pem",
  "*.key",
  "id_rsa",
  "id_ed25519",
] as const;
const identity = (info: FileSystem.File.Info) =>
  JSON.stringify({
    dev: info.dev,
    ino: Option.getOrNull(info.ino),
    mode: info.mode,
    nlink: Option.getOrNull(info.nlink),
    size: ByteSize.toBigInt(info.size).toString(),
    mtime: Option.getOrNull(Option.map(info.mtime, (value) => value.getTime())),
  });

/** Git in a user project under a fixed environment: no global/system config, prompts or locks. */
export const projectGit = Effect.fn("weavra.projectGit")(function* (root: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const env: Record<string, string> = {
    LANG: "C",
    LC_ALL: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_COUNT: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_AUTHOR_NAME: "Weavra",
    GIT_AUTHOR_EMAIL: "weavra@localhost",
    GIT_COMMITTER_NAME: "Weavra",
    GIT_COMMITTER_EMAIL: "weavra@localhost",
  };
  for (const name of ["PATH", "SystemRoot"] as const)
    if (process.env[name] !== undefined) env[name] = process.env[name];
  return Effect.fn("weavra.projectGit.run")(function* (
    args: readonly string[],
    input = "",
    allowFailure = false,
  ) {
    const child = yield* spawner.spawn(
      ChildProcess.make("git", ["--no-optional-locks", ...args], {
        cwd: root,
        env,
        extendEnv: false,
        stdin: input ? Stream.make(Buffer.from(input)) : "ignore",
        stdout: "pipe",
        stderr: "pipe",
        killSignal: "SIGTERM",
        forceKillAfter: Duration.seconds(2),
      }),
    );
    const result = yield* Effect.all(
      {
        out: collectUint8StreamText({ stream: child.stdout, maxBytes: 8 * MiB }),
        err: collectUint8StreamText({ stream: child.stderr, maxBytes: 8 * MiB }),
        code: child.exitCode,
      },
      { concurrency: "unbounded" },
    );
    if (result.out.truncated || result.err.truncated)
      return yield* new ProjectGitPreparationError({ code: "CAPACITY" });
    if (result.out.invalidUtf8)
      return yield* new ProjectGitPreparationError({ code: "UNSAFE_PATH" });
    if (!allowFailure && result.code !== 0)
      return yield* new ProjectGitPreparationError({ code: "UNAVAILABLE" });
    return { code: result.code, stdout: result.out.text };
  }, Effect.scoped);
});

/** Explicit create only. A complete private baseline is published without touching an existing repository. */
export const prepareProjectGit = Effect.fn("weavra.prepareProjectGit")(
  function* (cwd: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.realPath(cwd);
    if ((yield* fs.stat(root)).type !== "Directory")
      return yield* new ProjectGitPreparationError({ code: "UNSAFE_PATH" });
    const git = yield* projectGit(root);
    const existing = Effect.fn("weavra.prepareProjectGit.existing")(function* () {
      const detected = yield* git(["rev-parse", "--git-dir"], "", true);
      if (detected.code !== 0) return null;
      const head = yield* git(["rev-parse", "--verify", "HEAD^{commit}"], "", true);
      return { kind: "existing" as const, headCommit: head.code === 0 ? head.stdout.trim() : null };
    });
    const found = yield* existing();
    if (found) return found;
    for (let directory = root; ; directory = path.dirname(directory)) {
      if (yield* fs.exists(path.join(directory, ".git")))
        return yield* new ProjectGitPreparationError({ code: "UNSAFE_PATH" });
      if (path.dirname(directory) === directory) break;
    }
    const stage = yield* fs.makeTempDirectoryScoped({
      directory: root,
      prefix: ".weavra-git-bootstrap-",
    });
    const privateRoot = path.join(stage, "repository");
    yield* git([
      "init",
      "--quiet",
      "--template=",
      "--object-format=sha1",
      "--initial-branch=main",
      privateRoot,
    ]);
    const privateGit = path.join(privateRoot, ".git");
    yield* fs.makeDirectory(path.join(privateGit, "info"), { recursive: true });
    yield* fs.writeFileString(path.join(privateGit, "info", "exclude"), excludes.join("\n") + "\n");
    const prefix = [
      "--git-dir=" + privateGit,
      "--work-tree=" + root,
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
    ];
    const paths = (yield* git([
      ...prefix,
      "ls-files",
      "--others",
      "--exclude-standard",
      ...excludes.map((pattern) => "--exclude=" + pattern),
      "-z",
    ])).stdout
      .split("\0")
      .filter(Boolean);
    if (paths.length > 50_000) return yield* new ProjectGitPreparationError({ code: "CAPACITY" });
    const fingerprint = Effect.fn("weavra.prepareProjectGit.fingerprint")(function* (name: string) {
      const full = path.join(root, name);
      if (name.split("/").includes("..") || (yield* fs.realPath(full)) !== full)
        return yield* new ProjectGitPreparationError({ code: "UNSAFE_PATH" });
      const before = yield* fs.stat(full);
      if (
        before.type !== "File" ||
        Option.getOrNull(before.nlink) !== 1 ||
        Option.isNone(before.ino)
      )
        return yield* new ProjectGitPreparationError({ code: "UNSAFE_PATH" });
      if (ByteSize.toBigInt(before.size) > BigInt(64 * MiB))
        return yield* new ProjectGitPreparationError({ code: "CAPACITY" });
      const file = yield* fs.open(full, { flag: "r" });
      if ((yield* fs.realPath(full)) !== full || identity(yield* file.stat) !== identity(before))
        return yield* new ProjectGitPreparationError({ code: "CHANGED" });
      const hash = NodeCrypto.createHash("sha256");
      let size = 0;
      for (;;) {
        const chunk = yield* file.readAlloc(64 * 1024);
        if (Option.isNone(chunk)) break;
        size += chunk.value.length;
        if (size > 64 * MiB) return yield* new ProjectGitPreparationError({ code: "CAPACITY" });
        hash.update(chunk.value);
      }
      if (
        identity(yield* file.stat) !== identity(before) ||
        identity(yield* fs.stat(full)) !== identity(before)
      )
        return yield* new ProjectGitPreparationError({ code: "CHANGED" });
      return { size, digest: identity(before) + ":" + hash.digest("hex") };
    }, Effect.scoped);
    const fingerprints = new Map<string, string>();
    let total = 0;
    for (const name of paths) {
      const value = yield* fingerprint(name);
      total += value.size;
      if (total > 512 * MiB) return yield* new ProjectGitPreparationError({ code: "CAPACITY" });
      fingerprints.set(name, value.digest);
    }
    if (paths.length)
      yield* git(
        [...prefix, "--literal-pathspecs", "add", "--pathspec-from-file=-", "--pathspec-file-nul"],
        paths.join("\0") + "\0",
      );
    yield* git([
      ...prefix,
      "commit",
      "--quiet",
      "--allow-empty",
      "--no-verify",
      "-m",
      "Initialize Weavra workspace",
    ]);
    const headCommit = (yield* git([
      ...prefix,
      "rev-parse",
      "--verify",
      "HEAD^{commit}",
    ])).stdout.trim();
    if (!/^[0-9a-f]{40}$/.test(headCommit))
      return yield* new ProjectGitPreparationError({ code: "UNAVAILABLE" });
    if (
      (yield* git([...prefix, "status", "--porcelain=v1", "-z", "--untracked-files=all"]))
        .stdout !== ""
    )
      return yield* new ProjectGitPreparationError({ code: "CHANGED" });
    for (const [name, expected] of fingerprints)
      if ((yield* fingerprint(name)).digest !== expected)
        return yield* new ProjectGitPreparationError({ code: "CHANGED" });
    const raced = yield* existing();
    if (raced) return raced;
    const destination = path.join(root, ".git");
    if (yield* fs.exists(destination))
      return yield* new ProjectGitPreparationError({ code: "UNSAFE_PATH" });
    const published = yield* fs.rename(privateGit, destination).pipe(Effect.result);
    if (published._tag === "Failure") {
      const winner = yield* existing();
      if (winner) return winner;
      return yield* new ProjectGitPreparationError({
        code: "UNAVAILABLE",
        cause: published.failure,
      });
    }
    return { kind: "created" as const, headCommit };
  },
  Effect.timeout("60 seconds"),
  Effect.scoped,
  Effect.mapError((error) =>
    isPreparationError(error)
      ? error
      : new ProjectGitPreparationError({ code: "UNAVAILABLE", cause: error }),
  ),
);
