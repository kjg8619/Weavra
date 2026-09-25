#!/usr/bin/env node
// Opt-in, paid (V0.8B #54): a REAL provider/model drafts a COMPLEX plan as the Planner (PLANNER_DRAFT.md), and the
// unchanged human path runs it: planner.start → READY → planner.read → workflow.prepare of the draft exactly as read
// (standing in for a human who accepts it) → workflow.confirm → terminal Run. Observed by the production App
// ControlTransport, its strict decoder and the ComplexProjection/PlannerProjection consumer checks. Uses the caller's
// own WEAVRA_HOME model configuration and credentials; nothing here copies or prints them.
//
//   node runtime/pi/node_modules/tsx/dist/cli.mjs scripts/planner-live-smoke.mjs \
//     --provider <provider> --model <model> --confirm-paid [--max-parallel 2] [--explicit-paths]
//
// The Planning Context lists file names inside the allowed paths only; it never shows check commands or test contents.
// --explicit-paths names the modules the registered checks import in the acceptance statements, as a user would.
//
// Planning is at most 3 invocations; the Run is bounded by the COMPLEX limits. The throwaway project is kept for
// inspection and its path is printed. Not part of CI.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const { values } = parseArgs({
  options: {
    provider: { type: "string" },
    model: { type: "string" },
    "confirm-paid": { type: "boolean" },
    "max-parallel": { type: "string" },
    "explicit-paths": { type: "boolean" },
  },
});
const maxParallel = Number(values["max-parallel"] ?? "1");
if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 4) throw new Error("--max-parallel must be an integer from 1 to 4");
if (!values.provider || !values.model) throw new Error("Usage: --provider <provider> --model <model> --confirm-paid");
if (!values["confirm-paid"]) throw new Error(`Refusing a paid run for ${values.provider}/${values.model} without --confirm-paid`);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = process.env.WEAVRA_APP_ROOT ?? root;
const executable = process.env.T3_WEAVRA_EXECUTABLE ?? join(root, "runtime/pi/packages/company-runtime/bin/weavra");
const serverModules = join(appRoot, "app/t3code/apps/server/node_modules");
const { openControlTransport } = await import(join(appRoot, "app/t3code/apps/server/src/weavra/ControlTransport.ts"));
const { complexStateConsistent } = await import(join(appRoot, "app/t3code/apps/server/src/weavra/ComplexProjection.ts"));
const { plannerStateConsistent } = await import(join(appRoot, "app/t3code/apps/server/src/weavra/PlannerProjection.ts"));
const NodeServices = await import(join(serverModules, "@effect/platform-node/dist/NodeServices.js"));
const Effect = await import(join(serverModules, "effect/dist/Effect.js"));
const exec = promisify(execFile);
const TERMINAL = new Set(["BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED", "COMPLETED"]);

const project = join(await realpath(await mkdtemp(join(tmpdir(), "weavra-planner-live-"))), "project");
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
const STATEMENTS = values["explicit-paths"]
  ? ["src/parse.mjs exports parse(text): it splits comma-separated text into trimmed items and returns [] for empty text", "src/format.mjs exports format(items): it joins items with a comma and a space"]
  : ["parse splits comma-separated text into trimmed items and returns [] for empty text", "format joins items with a comma and a space"];
const env = Object.fromEntries(["PATH", "HOME", "WEAVRA_HOME", "TMPDIR", "LANG", "LC_ALL"].map((key) => [key, process.env[key]]).filter(([, value]) => value !== undefined));
const started = Date.now();
const result = await Effect.runPromise(
  Effect.gen(function* () {
    const transport = yield* openControlTransport(executable, project, env);
    const hello = yield* transport.exchange({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.hello" });
    assert.equal(hello.success, true, JSON.stringify(hello));
    const capabilities = hello.data.capabilities;
    assert.equal(capabilities.complexContractVersion, 2, "Runtime must advertise COMPLEX contract v2");
    assert.equal(capabilities.plannerContractVersion, 1, "Runtime must advertise the Planner");
    let previous = null;
    let started = false;
    let checked = 0;
    const snapshot = () =>
      transport.exchange({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.snapshot" }).pipe(
        Effect.map((response) => {
          assert.equal(response.success, true, JSON.stringify(response));
          const state = response.data.state;
          assert.ok(complexStateConsistent(state, capabilities, previous), `App consumer rejected ${JSON.stringify(state.complexExecution ?? null).slice(0, 3000)}`);
          assert.ok(plannerStateConsistent(state, capabilities, previous, started), `App PlannerProjection rejected ${JSON.stringify(state.planner ?? null)}`);
          checked++;
          previous = state;
          return state;
        }),
      );
    const mutate = (input) =>
      snapshot().pipe(Effect.flatMap((state) => transport.exchange({ protocolVersion: 1, id: state.nextRequestId, ownerId: state.ownerId, expectedProjectRevision: state.projectRevision, ...input })));
    started = true;
    const accepted = yield* mutate({ type: "planner.start", goal: GOAL, acceptanceStatements: STATEMENTS });
    assert.equal(accepted.success, true, JSON.stringify(accepted));
    const planningStarted = Date.now();
    let planned;
    for (const deadline = Date.now() + 10 * 60_000; ; ) {
      const state = yield* snapshot();
      if (state.planner && state.planner.status !== "RUNNING") {
        planned = state;
        break;
      }
      assert.ok(Date.now() < deadline, "planning exceeded 10 minutes");
      yield* Effect.sleep("500 millis");
    }
    const planner = { ...planned.planner, seconds: Math.round((Date.now() - planningStarted) / 1000) };
    if (planner.status !== "READY") return { planner, run: null, checked };
    const read = yield* mutate({ type: "planner.read", planId: planner.planId });
    assert.equal(read.success, true, JSON.stringify(read));
    const draft = read.data.draft;
    // A human who accepts the proposal unchanged: prepare recompiles it and confirm starts the Run.
    const prepared = yield* mutate({ type: "workflow.prepare", goal: GOAL, acceptanceStatements: STATEMENTS, complexDraft: draft });
    assert.equal(prepared.success, true, JSON.stringify(prepared));
    const confirmed = yield* mutate({ type: "workflow.confirm", previewId: prepared.data.preview.previewId, previewDigest: prepared.data.preview.previewDigest });
    assert.equal(confirmed.success, true, JSON.stringify(confirmed));
    for (const deadline = Date.now() + 20 * 60_000; ; ) {
      const state = yield* snapshot();
      const status = state.snapshot.status.run?.status;
      if (!state.busy && status && TERMINAL.has(status)) return { planner, draft, run: state, checked };
      assert.ok(Date.now() < deadline, "the Run exceeded 20 minutes");
      yield* Effect.sleep("500 millis");
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
const execution = result.run?.complexExecution;
console.log(
  JSON.stringify(
    {
      target: `${values.provider}/${values.model}`,
      maxParallel,
      explicitPaths: values["explicit-paths"] === true,
      project,
      durationSeconds: Math.round((Date.now() - started) / 1000),
      checkedSnapshots: result.checked,
      planner: {
        status: result.planner.status,
        failureCode: result.planner.failureCode,
        seconds: result.planner.seconds,
        invocations: result.planner.usage.invocations,
        reportedTokens: result.planner.usage.reportedTokens,
        route: result.planner.route,
        taskCount: result.planner.taskCount,
      },
      draft: result.draft ?? null,
      run: result.run
        ? {
            status: result.run.snapshot.status.run.status,
            tasks: execution.tasks.map((row) => ({ id: row.id, status: row.status, attempt: row.attempt, invocations: row.workerInvocations, reportedTokens: row.reportedTokens, failureCode: row.failureCode, gates: [row.selfCheck, row.review, row.test] })),
            integration: execution.integration,
            budget: execution.budget,
            cleanup: execution.cleanup,
            failureCode: execution.failureCode,
          }
        : null,
    },
    null,
    2,
  ),
);
