#!/usr/bin/env node
// Opt-in, paid (V0.8C #58): a REAL provider/model runs a 2-task sequential COMPLEX Run, which this script cancels once
// the first task COMPLETED and the second is implementing (a user stopping halfway). Then the V0.8C path: workflow.derive
// (deterministic, read-only) → the script plays the user and commits the completed task's files and discards the rest →
// derive again (clean) → workflow.prepare of the derived draft → confirm → the new Run, again with the real model:
// the completed task is re-verified as a read-only verification task and the unfinished one is implemented.
// Observed by the production App ControlTransport, its strict decoder and the ComplexProjection consumer checks. Uses
// the caller's own WEAVRA_HOME model configuration and credentials; nothing here copies or prints them.
//
//   node runtime/pi/node_modules/tsx/dist/cli.mjs scripts/rerun-live-smoke.mjs \
//     --provider <provider> --model <model> --confirm-paid
//
// Both Runs are bounded by the COMPLEX limits. The throwaway project is kept for inspection and its path is printed.
// Not part of CI.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    model: { type: "string" },
    "confirm-paid": { type: "boolean" },
  },
});
const maxParallel = 1;
if (!values.provider || !values.model) throw new Error("Usage: --provider <provider> --model <model> --confirm-paid");
if (!values["confirm-paid"]) throw new Error(`Refusing a paid run for ${values.provider}/${values.model} without --confirm-paid`);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = process.env.WEAVRA_APP_ROOT ?? root;
const executable = process.env.T3_WEAVRA_EXECUTABLE ?? join(root, "runtime/pi/packages/company-runtime/bin/weavra");
const serverModules = join(appRoot, "app/t3code/apps/server/node_modules");
const { openControlTransport } = await import(join(appRoot, "app/t3code/apps/server/src/weavra/ControlTransport.ts"));
const { complexStateConsistent } = await import(join(appRoot, "app/t3code/apps/server/src/weavra/ComplexProjection.ts"));
const NodeServices = await import(join(serverModules, "@effect/platform-node/dist/NodeServices.js"));
const Effect = await import(join(serverModules, "effect/dist/Effect.js"));
const exec = promisify(execFile);
const TERMINAL = new Set(["BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED", "COMPLETED"]);

const project = join(await realpath(await mkdtemp(join(tmpdir(), "weavra-rerun-live-"))), "project");
await mkdir(join(project, "src"), { recursive: true });
await mkdir(join(project, "test"), { recursive: true });
await mkdir(join(project, ".ai"), { mode: 0o700 });
await writeFile(join(project, ".gitignore"), ".ai/\n");
await writeFile(join(project, "src/README.md"), "Parser and formatter modules.\n");
const nodeTest = (name, body) => `import { test } from "node:test";\nimport assert from "node:assert/strict";\n${body}\ntest("${name}", () => {});\n`;
await writeFile(join(project, "test/parse.test.mjs"), nodeTest("parse", 'import { parse } from "../src/parse.mjs";\nassert.deepEqual(parse(" a, b ,c "), ["a", "b", "c"]);\nassert.deepEqual(parse(""), []);'));
await writeFile(join(project, "test/format.test.mjs"), nodeTest("format", 'import { format } from "../src/format.mjs";\nassert.equal(format(["a", "b"]), "a, b");\nassert.equal(format([]), "");'));
const git = (...args) => exec("git", ["-c", "user.name=Smoke", "-c", "user.email=smoke@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: project });
await git("init", "-q");
await git("add", "--", ".gitignore", "src", "test");
await git("commit", "-qm", "fixture");
await writeFile(
  join(project, ".ai/config.yaml"),
  JSON.stringify({
    schemaVersion: 1,
    models: { profiles: { coding: { provider: values.provider, model: values.model }, reasoning: { provider: values.provider, model: values.model } } },
    runtime: { workflow: "adaptive" },
    ...(maxParallel > 1 ? { agents: { max_parallel: maxParallel } } : {}),
    files: { allowed_paths: ["src"] },
    verification: {
      checks: [
        { id: "test-format", kind: "test", executable: process.execPath, args: ["--test", "test/format.test.mjs"], required: true },
        { id: "test-parse", kind: "test", executable: process.execPath, args: ["--test", "test/parse.test.mjs"], required: true },
      ],
    },
  }),
  { mode: 0o600 },
);
const GOAL = "Implement the parser and formatter across multiple modules";
const STATEMENTS = ["src/parse.mjs exports parse(text): it splits comma-separated text into trimmed items and returns [] for empty text", "src/format.mjs exports format(items): it joins items with a comma and a space"];
const SEQUENTIAL = {
  tasks: [
    { title: "Add parser", goal: "Create src/parse.mjs exporting parse(text): split on commas, trim items, and return [] for empty text", dependsOnIndexes: [], criterionIndexes: [1], ownership: [{ path: "src/parse.mjs", operation: "create" }], checkIds: ["test-parse"] },
    { title: "Add formatter", goal: "Create src/format.mjs exporting format(items) that joins items with a comma and a space", dependsOnIndexes: [1], criterionIndexes: [2], ownership: [{ path: "src/format.mjs", operation: "create" }], checkIds: ["test-format"] },
  ],
};
const env = Object.fromEntries(["PATH", "HOME", "WEAVRA_HOME", "TMPDIR", "LANG", "LC_ALL"].map((key) => [key, process.env[key]]).filter(([, value]) => value !== undefined));
const started = Date.now();
const rows = (state) => state.complexExecution?.tasks.map((row) => ({ id: row.id, status: row.status, attempt: row.attempt, invocations: row.workerInvocations, reportedTokens: row.reportedTokens, failureCode: row.failureCode, gates: [row.selfCheck, row.review, row.test], changedFiles: row.changedFiles }));
const result = await Effect.runPromise(
  Effect.gen(function* () {
    const transport = yield* openControlTransport(executable, project, env);
    const hello = yield* transport.exchange({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.hello" });
    assert.equal(hello.success, true, JSON.stringify(hello));
    const capabilities = hello.data.capabilities;
    assert.equal(capabilities.rerunContractVersion, 1, "Runtime must advertise the V0.8C re-run");
    let previous = null;
    let checked = 0;
    const snapshot = () =>
      transport.exchange({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.snapshot" }).pipe(
        Effect.map((response) => {
          assert.equal(response.success, true, JSON.stringify(response));
          const state = response.data.state;
          assert.ok(complexStateConsistent(state, capabilities, previous), `App consumer rejected ${JSON.stringify(state.complexExecution ?? null).slice(0, 3000)}`);
          checked++;
          previous = state;
          return state;
        }),
      );
    const mutate = (input) =>
      snapshot().pipe(Effect.flatMap((state) => transport.exchange({ protocolVersion: 1, id: state.nextRequestId, ownerId: state.ownerId, expectedProjectRevision: state.projectRevision, ...input })));
    const settle = (label) =>
      Effect.gen(function* () {
        for (const deadline = Date.now() + 20 * 60_000; ; ) {
          const state = yield* snapshot();
          const status = state.snapshot.status.run?.status;
          if (!state.busy && status && TERMINAL.has(status)) return state;
          assert.ok(Date.now() < deadline, `${label} exceeded 20 minutes`);
          yield* Effect.sleep("500 millis");
        }
      });
    // 1. The source Run with the real model; cancel once CT-001 COMPLETED and CT-002 is implementing.
    const prepared = yield* mutate({ type: "workflow.prepare", goal: GOAL, acceptanceStatements: STATEMENTS, complexDraft: SEQUENTIAL });
    assert.equal(prepared.success, true, JSON.stringify(prepared));
    assert.equal((yield* mutate({ type: "workflow.confirm", previewId: prepared.data.preview.previewId, previewDigest: prepared.data.preview.previewDigest })).success, true);
    let cancelled = false;
    for (const deadline = Date.now() + 20 * 60_000; !cancelled; ) {
      const state = yield* snapshot();
      const tasks = state.complexExecution?.tasks ?? [];
      const status = state.snapshot.status.run?.status;
      if (status && TERMINAL.has(status) && !state.busy) break;
      if (tasks[0]?.status === "COMPLETED" && tasks[1]?.status === "IMPLEMENTING" && state.ownedRunId) {
        const response = yield* mutate({ type: "workflow.cancel", runId: state.ownedRunId, expectedStateRevision: state.stateRevision });
        if (response.success) cancelled = true;
        else assert.ok(["STALE_RUN", "STALE_PROJECT"].includes(response.error.code), JSON.stringify(response));
      }
      assert.ok(Date.now() < deadline, "the source Run exceeded 20 minutes");
      yield* Effect.sleep("250 millis");
    }
    const source = yield* settle("source Run");
    const sourceRunId = source.snapshot.status.run.runId;
    if (!cancelled) return { source, checked, note: "the source Run ended before the cancel point; nothing to re-run" };
    // 2. Derive (read-only), then play the user: keep the completed task's files, discard everything else.
    const first = yield* mutate({ type: "workflow.derive", runId: sourceRunId });
    assert.equal(first.success, true, JSON.stringify(first));
    const keep = new Set(source.complexExecution.tasks.filter((row) => row.status === "COMPLETED").flatMap((row) => row.changedFiles));
    const tracked = new Set((yield* Effect.promise(() => git("ls-files"))).stdout.split("\n").filter(Boolean));
    const resolution = { committed: [], discarded: [] };
    for (const path of first.data.leftovers.paths) {
      if (keep.has(path)) {
        yield* Effect.promise(() => git("add", "--", path));
        resolution.committed.push(path);
      } else if (tracked.has(path)) {
        yield* Effect.promise(() => git("checkout", "--", path));
        resolution.discarded.push(path);
      } else {
        yield* Effect.promise(() => rm(join(project, path), { force: true }));
        resolution.discarded.push(path);
      }
    }
    if (resolution.committed.length) yield* Effect.promise(() => git("commit", "-qm", "keep the completed task's work"));
    const derived = yield* mutate({ type: "workflow.derive", runId: sourceRunId });
    assert.equal(derived.success, true, JSON.stringify(derived));
    assert.equal(derived.data.leftovers.clean, true, JSON.stringify(derived.data.leftovers));
    assert.equal(derived.data.prepareCheck.ok, true, JSON.stringify(derived.data.prepareCheck));
    // 3. The ordinary human path with the derived draft, again with the real model.
    const rePrepared = yield* mutate({ type: "workflow.prepare", goal: derived.data.goal, acceptanceStatements: derived.data.acceptanceStatements, complexDraft: derived.data.draft });
    assert.equal(rePrepared.success, true, JSON.stringify(rePrepared));
    assert.equal((yield* mutate({ type: "workflow.confirm", previewId: rePrepared.data.preview.previewId, previewDigest: rePrepared.data.preview.previewDigest })).success, true);
    const rerun = yield* settle("re-run");
    assert.notEqual(rerun.snapshot.status.run.runId, sourceRunId);
    return { source, first: first.data, resolution, derived: derived.data, rerun, checked };
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
console.log(
  JSON.stringify(
    {
      target: `${values.provider}/${values.model}`,
      project,
      durationSeconds: Math.round((Date.now() - started) / 1000),
      checkedSnapshots: result.checked,
      note: result.note ?? null,
      source: { status: result.source.snapshot.status.run.status, tasks: rows(result.source), budget: result.source.complexExecution?.budget },
      derive: result.first
        ? {
            sourceStatus: result.first.sourceStatus,
            tasks: result.first.draft.tasks.map((task) => ({ title: task.title, ownership: task.ownership, checkIds: task.checkIds })),
            leftoversBefore: result.first.leftovers,
            notes: result.first.notes,
            resolution: result.resolution,
            leftoversAfter: result.derived.leftovers,
            prepareCheck: result.derived.prepareCheck,
          }
        : null,
      rerun: result.rerun
        ? { status: result.rerun.snapshot.status.run.status, tasks: rows(result.rerun), integration: result.rerun.complexExecution.integration, budget: result.rerun.complexExecution.budget, cleanup: result.rerun.complexExecution.cleanup }
        : null,
    },
    null,
    2,
  ),
);
