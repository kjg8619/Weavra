import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { vi } from "vite-plus/test";
import * as ProcessRunner from "../processRunner.ts";
import { prepareProjectGit } from "./ProjectGitPreparation.ts";

const services = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));
const encodeFixtureString = Schema.encodeSync(Schema.fromJsonString(Schema.String));
const fixture = Effect.fn("gitPreparationTest.fixture")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const base = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-git-preparation-test-" });
  const project = path.join(base, "project");
  yield* fs.makeDirectory(project);
  const git = Effect.fn("gitPreparationTest.git")(function* (...args: string[]) {
    const result = yield* runner.run({
      command: "git",
      cwd: project,
      args: ["--no-optional-locks", ...args],
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_COUNT: "0",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@localhost",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@localhost",
      },
    });
    assert.equal(result.code, 0);
    return result.stdout;
  });
  const temporary = fs
    .readDirectory(project)
    .pipe(Effect.map((names) => names.filter((name) => name.startsWith(".weavra-git-bootstrap-"))));
  return { fs, path, runner, base, project, git, temporary };
});

it.effect("publishes one clean local baseline respecting ignores and literal file names", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.fs.makeDirectory(f.path.join(f.project, "src"));
    yield* f.fs.makeDirectory(f.path.join(f.project, ".omo"));
    yield* f.fs.writeFileString(
      f.path.join(f.project, "src", "-entry\nname.js"),
      "export const value = 1;\n",
    );
    yield* f.fs.writeFileString(f.path.join(f.project, ".gitignore"), "ignored.txt\n");
    yield* f.fs.writeFileString(f.path.join(f.project, "ignored.txt"), "ignored fixture");
    yield* f.fs.writeFileString(f.path.join(f.project, ".env"), "fixture-only");
    yield* f.fs.writeFileString(f.path.join(f.project, ".omo", "state.json"), "{}");
    const result = yield* prepareProjectGit(f.project);
    assert.equal(result.kind, "created");
    assert.match(result.headCommit ?? "", /^[0-9a-f]{40}$/);
    assert.equal((yield* f.git("rev-list", "--count", "HEAD")).trim(), "1");
    assert.deepStrictEqual((yield* f.git("ls-files", "-z")).split("\0").filter(Boolean), [
      ".gitignore",
      "src/-entry\nname.js",
    ]);
    assert.equal(yield* f.git("status", "--porcelain=v1", "--untracked-files=all"), "");
    assert.equal(yield* f.git("remote"), "");
    assert.equal(yield* f.fs.readFileString(f.path.join(f.project, ".gitignore")), "ignored.txt\n");
    assert.deepStrictEqual(yield* f.temporary, []);
    assert.deepStrictEqual(yield* prepareProjectGit(f.project), {
      kind: "existing",
      headCommit: result.headCommit,
    });
    assert.equal((yield* f.git("rev-list", "--count", "HEAD")).trim(), "1");
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("creates an empty baseline for a genuinely empty non-Git folder", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    assert.equal((yield* prepareProjectGit(f.project)).kind, "created");
    assert.equal(yield* f.git("ls-files"), "");
    assert.equal((yield* f.git("rev-list", "--count", "HEAD")).trim(), "1");
    assert.equal(yield* f.git("status", "--porcelain=v1"), "");
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("preserves existing HEAD, index, dirty content and remote config exactly", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.git("init", "--quiet");
    yield* f.fs.writeFileString(f.path.join(f.project, "tracked.txt"), "original");
    yield* f.git("add", "--", "tracked.txt");
    yield* f.git(
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "-qm",
      "baseline",
    );
    yield* f.fs.writeFileString(f.path.join(f.project, "tracked.txt"), "human dirty content");
    yield* f.fs.writeFileString(f.path.join(f.project, "staged.txt"), "human staged content");
    yield* f.git("add", "--", "staged.txt");
    yield* f.git("remote", "add", "origin", "https://example.invalid/preserve.git");
    const head = (yield* f.git("rev-parse", "HEAD")).trim();
    const index = yield* f.fs.readFile(f.path.join(f.project, ".git", "index"));
    const config = yield* f.fs.readFile(f.path.join(f.project, ".git", "config"));
    assert.deepStrictEqual(yield* prepareProjectGit(f.project), {
      kind: "existing",
      headCommit: head,
    });
    assert.equal((yield* f.git("rev-parse", "HEAD")).trim(), head);
    assert.deepStrictEqual(yield* f.fs.readFile(f.path.join(f.project, ".git", "index")), index);
    assert.deepStrictEqual(yield* f.fs.readFile(f.path.join(f.project, ".git", "config")), config);
    assert.equal(
      yield* f.fs.readFileString(f.path.join(f.project, "tracked.txt")),
      "human dirty content",
    );
    assert.equal((yield* f.git("diff", "--cached", "--name-only")).trim(), "staged.txt");
    assert.deepStrictEqual(yield* f.temporary, []);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("does not commit an existing unborn repository or overwrite its staged content", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.git("init", "--quiet");
    yield* f.fs.writeFileString(f.path.join(f.project, "staged.txt"), "human");
    yield* f.git("add", "--", "staged.txt");
    const index = yield* f.fs.readFile(f.path.join(f.project, ".git", "index"));
    assert.deepStrictEqual(yield* prepareProjectGit(f.project), {
      kind: "existing",
      headCommit: null,
    });
    assert.deepStrictEqual(yield* f.fs.readFile(f.path.join(f.project, ".git", "index")), index);
    assert.deepStrictEqual(yield* f.temporary, []);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("recognizes an ancestor repository without nested Git initialization", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.git("init", "--quiet");
    const nested = f.path.join(f.project, "nested");
    yield* f.fs.makeDirectory(nested);
    assert.deepStrictEqual(yield* prepareProjectGit(nested), {
      kind: "existing",
      headCommit: null,
    });
    assert.isFalse(yield* f.fs.exists(f.path.join(nested, ".git")));
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("refuses unproven existing metadata without reinitializing or removing it", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.fs.makeDirectory(f.path.join(f.project, ".git"));
    assert.equal((yield* prepareProjectGit(f.project).pipe(Effect.flip)).code, "UNSAFE_PATH");
    assert.equal((yield* f.fs.stat(f.path.join(f.project, ".git"))).type, "Directory");
    assert.deepStrictEqual(yield* f.temporary, []);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

for (const kind of ["symlink", "hardlink"] as const)
  it.effect("refuses " + kind + " without publication or source changes", () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      const outside = f.path.join(f.base, "outside.txt");
      yield* f.fs.writeFileString(outside, "source fixture");
      if (kind === "symlink") yield* f.fs.symlink(outside, f.path.join(f.project, "linked.txt"));
      else yield* f.fs.link(outside, f.path.join(f.project, "linked.txt"));
      assert.equal((yield* prepareProjectGit(f.project).pipe(Effect.flip)).code, "UNSAFE_PATH");
      assert.isFalse(yield* f.fs.exists(f.path.join(f.project, ".git")));
      assert.equal(yield* f.fs.readFileString(outside), "source fixture");
      assert.deepStrictEqual(yield* f.temporary, []);
    }).pipe(Effect.scoped, Effect.provide(services)),
  );

it.effect("bounds oversized candidates before publication", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    const oversized = f.path.join(f.project, "oversized.bin");
    yield* f.fs.writeFileString(oversized, "");
    yield* f.fs.truncate(oversized, 64 * 1024 * 1024 + 1);
    assert.equal((yield* prepareProjectGit(f.project).pipe(Effect.flip)).code, "CAPACITY");
    assert.isFalse(yield* f.fs.exists(f.path.join(f.project, ".git")));
    assert.deepStrictEqual(yield* f.temporary, []);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("publishes one baseline under simultaneous preparation and remains repeat-safe", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.fs.writeFileString(f.path.join(f.project, "source.txt"), "fixture");
    const results = yield* Effect.all(
      [
        prepareProjectGit(f.project).pipe(Effect.result),
        prepareProjectGit(f.project).pipe(Effect.result),
      ],
      { concurrency: "unbounded" },
    );
    assert.equal(
      results.filter((result) => result._tag === "Success" && result.success.kind === "created")
        .length,
      1,
    );
    assert.equal((yield* f.git("rev-list", "--count", "HEAD")).trim(), "1");
    const head = (yield* f.git("rev-parse", "HEAD")).trim();
    assert.deepStrictEqual(yield* prepareProjectGit(f.project), {
      kind: "existing",
      headCommit: head,
    });
    assert.equal(yield* f.git("status", "--porcelain=v1"), "");
    assert.deepStrictEqual(yield* f.temporary, []);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("keeps the folder non-Git after a private commit failure and permits a clean retry", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.fs.writeFileString(f.path.join(f.project, "source.txt"), "fixture");
    const realGit = (yield* f.runner.run({ command: "which", args: ["git"] })).stdout.trim();
    const bin = f.path.join(f.base, "bin");
    yield* f.fs.makeDirectory(bin);
    yield* f.fs.writeFileString(
      f.path.join(bin, "git"),
      "#!" +
        process.execPath +
        "\n" +
        "const {spawnSync}=require('node:child_process');const args=process.argv.slice(2);if(args.includes('commit'))process.exit(37);" +
        "const r=spawnSync(" +
        encodeFixtureString(realGit) +
        ",args,{env:process.env,stdio:'inherit'});process.exit(r.status??1);\n",
      { mode: 0o700 },
    );
    yield* Effect.addFinalizer(() => Effect.sync(() => vi.unstubAllEnvs()));
    vi.stubEnv("PATH", bin + ":" + process.env.PATH);
    assert.equal((yield* prepareProjectGit(f.project).pipe(Effect.flip)).code, "UNAVAILABLE");
    assert.isFalse(yield* f.fs.exists(f.path.join(f.project, ".git")));
    assert.deepStrictEqual(yield* f.temporary, []);
    assert.equal(yield* f.fs.readFileString(f.path.join(f.project, "source.txt")), "fixture");
    vi.unstubAllEnvs();
    assert.equal((yield* prepareProjectGit(f.project)).kind, "created");
    assert.equal((yield* f.git("rev-list", "--count", "HEAD")).trim(), "1");
  }).pipe(Effect.scoped, Effect.provide(services)),
);
