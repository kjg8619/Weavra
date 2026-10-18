import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as ProcessRunner from "../processRunner.ts";
import { DIRTY_BASELINE_COMMIT_MESSAGE, commitDirtyBaseline } from "./ProjectDirtyBaseline.ts";

const services = ProcessRunner.layer.pipe(Layer.provideMerge(NodeServices.layer));
const fixture = Effect.fn("dirtyBaselineTest.fixture")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const runner = yield* ProcessRunner.ProcessRunner;
  const base = yield* fs.makeTempDirectoryScoped({ prefix: "weavra-dirty-baseline-test-" });
  const project = yield* fs.realPath(base).pipe(Effect.map((real) => path.join(real, "project")));
  yield* fs.makeDirectory(project);
  const git = Effect.fn("dirtyBaselineTest.git")(function* (...args: string[]) {
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
  const write = (name: string, content: string) =>
    fs.writeFileString(path.join(project, name), content);
  yield* git("init", "--quiet", "--initial-branch=main");
  yield* write("tracked.txt", "one\n");
  yield* fs.makeDirectory(path.join(project, ".ai"));
  yield* write(".ai/config.yaml", "version: 1\n");
  yield* git("add", "--all");
  yield* git("commit", "--quiet", "-m", "initial");
  const head = (yield* git("rev-parse", "HEAD")).trim();
  // A hook that would leave evidence if hooks ran.
  yield* fs.makeDirectory(path.join(project, ".git", "hooks"), { recursive: true });
  yield* write(".git/hooks/pre-commit", "#!/bin/sh\ntouch hook-ran\n");
  yield* fs.chmod(path.join(project, ".git", "hooks", "pre-commit"), 0o755);
  return { fs, path, project, git, write, head };
});
const commit = (
  f: { readonly project: string; readonly head: string },
  files: readonly string[],
  consent = true,
) =>
  commitDirtyBaseline({
    cwd: f.project,
    files,
    consent,
    expectedHead: f.head,
    protectedRoots: [],
  }).pipe(Effect.result);

it.effect("commits exactly the two reviewed dirty files and leaves the checkout clean", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.write("tracked.txt", "two\n");
    yield* f.write("new file.txt", "fresh\n");
    const result = yield* commit(f, ["tracked.txt", "new file.txt"]);
    assert.equal(result._tag, "Success");
    const headCommit = result._tag === "Success" ? result.success.headCommit : "";
    assert.equal(headCommit, (yield* f.git("rev-parse", "HEAD")).trim());
    assert.equal((yield* f.git("rev-parse", "HEAD^")).trim(), f.head);
    assert.equal((yield* f.git("log", "-1", "--format=%s")).trim(), DIRTY_BASELINE_COMMIT_MESSAGE);
    assert.deepStrictEqual(
      (yield* f.git("show", "--name-only", "--format=", "HEAD")).trim().split("\n").toSorted(),
      ["new file.txt", "tracked.txt"],
    );
    assert.equal(yield* f.git("status", "--porcelain=v1", "--untracked-files=all"), "");
    assert.equal(yield* f.fs.exists(f.path.join(f.project, "hook-ran")), false);
    assert.equal(yield* f.git("remote"), "");
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("refuses a changed dirty set and commits or stages nothing", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.write("tracked.txt", "two\n");
    yield* f.write("new file.txt", "fresh\n");
    yield* f.write("late.txt", "appeared after review\n");
    const result = yield* commit(f, ["tracked.txt", "new file.txt"]);
    assert.equal(result._tag, "Failure");
    assert.equal(result._tag === "Failure" ? result.failure.code : null, "DIRTY_SET_CHANGED");
    const fewer = yield* commit(f, ["tracked.txt", "new file.txt", "late.txt", "gone.txt"]);
    assert.equal(fewer._tag === "Failure" ? fewer.failure.code : null, "DIRTY_SET_CHANGED");
    assert.equal((yield* f.git("rev-parse", "HEAD")).trim(), f.head);
    assert.equal(yield* f.git("diff", "--cached", "--name-only"), "");
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("never commits .ai paths, even when they are dirty", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.write(".ai/config.yaml", "version: 2\n");
    yield* f.write("tracked.txt", "two\n");
    const refused = yield* commit(f, ["tracked.txt", ".ai/config.yaml"]);
    assert.equal(refused._tag === "Failure" ? refused.failure.code : null, "UNSAFE_PATH");
    assert.equal((yield* f.git("rev-parse", "HEAD")).trim(), f.head);
    // The reviewed list excludes .ai/, exactly like the Runtime refusal; .ai/ stays uncommitted.
    yield* f.git("add", ".ai/config.yaml");
    const result = yield* commit(f, ["tracked.txt"]);
    assert.equal(result._tag, "Success");
    assert.deepStrictEqual(
      (yield* f.git("show", "--name-only", "--format=", "HEAD")).trim().split("\n"),
      ["tracked.txt"],
    );
    assert.match(yield* f.git("status", "--porcelain=v1"), /\.ai\/config\.yaml/);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("refuses without consent and inside a protected Weavra root", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.write("tracked.txt", "two\n");
    const declined = yield* commit(f, ["tracked.txt"], false);
    assert.equal(declined._tag === "Failure" ? declined.failure.code : null, "CONSENT_REQUIRED");
    const guarded = yield* commitDirtyBaseline({
      cwd: f.project,
      files: ["tracked.txt"],
      consent: true,
      expectedHead: f.head,
      protectedRoots: [f.path.dirname(f.project)],
    }).pipe(Effect.result);
    assert.equal(guarded._tag === "Failure" ? guarded.failure.code : null, "UNSAFE_PATH");
    assert.equal((yield* f.git("rev-parse", "HEAD")).trim(), f.head);
    assert.match(yield* f.git("status", "--porcelain=v1"), /tracked\.txt/);
  }).pipe(Effect.scoped, Effect.provide(services)),
);

it.effect("refuses when HEAD moved away from the task's bound commit", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* f.write("tracked.txt", "two\n");
    yield* f.git("commit", "--quiet", "--no-verify", "-am", "moved elsewhere");
    const moved = (yield* f.git("rev-parse", "HEAD")).trim();
    yield* f.write("tracked.txt", "three\n");
    const result = yield* commit(f, ["tracked.txt"]);
    assert.equal(result._tag === "Failure" ? result.failure.code : null, "HEAD_CHANGED");
    assert.equal((yield* f.git("rev-parse", "HEAD")).trim(), moved);
    assert.equal(yield* f.git("diff", "--cached", "--name-only"), "");
  }).pipe(Effect.scoped, Effect.provide(services)),
);
