#!/usr/bin/env node
// Opt-in, paid: one bounded 2-task COMPLEX Run executed by a REAL provider/model through the real Runtime executable,
// observed by the production App ControlTransport, its strict decoder and consumer checks. Uses the caller's own
// WEAVRA_HOME model configuration and credentials; nothing here copies or prints them.
//
//   node runtime/pi/node_modules/tsx/dist/cli.mjs scripts/complex-live-smoke.mjs \
//     --provider <provider> --model <model> --confirm-paid
//
// At most 5 worker invocations under the COMPLEX 200,000 reported-token cap. The throwaway project is kept for
// inspection and its path is printed. Not part of CI.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";

const { values } = parseArgs({ options: { provider: { type: "string" }, model: { type: "string" }, "confirm-paid": { type: "boolean" } } });
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

const project = join(await realpath(await mkdtemp(join(tmpdir(), "weavra-complex-live-"))), "project");
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
const draft = {
  tasks: [
    { title: "Add parser", goal: "Create src/parse.mjs exporting parse(text): split on commas, trim items, and return [] for empty text", dependsOnIndexes: [], criterionIndexes: [1], ownership: [{ path: "src/parse.mjs", operation: "create" }], checkIds: ["test-parse"] },
    { title: "Add formatter", goal: "Create src/format.mjs exporting format(items) that joins items with a comma and a space", dependsOnIndexes: [1], criterionIndexes: [2], ownership: [{ path: "src/format.mjs", operation: "create" }], checkIds: ["test-format"] },
  ],
};
const env = Object.fromEntries(["PATH", "HOME", "WEAVRA_HOME", "TMPDIR", "LANG", "LC_ALL"].map((key) => [key, process.env[key]]).filter(([, value]) => value !== undefined));
const started = Date.now();
const result = await Effect.runPromise(
  Effect.gen(function* () {
    const transport = yield* openControlTransport(executable, project, env);
    const hello = yield* transport.exchange({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.hello" });
    assert.equal(hello.success, true, JSON.stringify(hello));
    const capabilities = hello.data.capabilities;
    assert.equal(capabilities.complexContractVersion, 2, "Runtime must advertise COMPLEX contract v2");
    let previous = null;
    let checked = 0;
    const snapshot = () =>
      transport.exchange({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.snapshot" }).pipe(
        Effect.map((response) => {
          assert.equal(response.success, true, JSON.stringify(response));
          const state = response.data.state;
          assert.ok(complexStateConsistent(state, capabilities, previous), `App consumer rejected ${JSON.stringify(state.complexExecution ?? null).slice(0, 3000)}`);
          if (state.complexExecution) checked++;
          previous = state;
          return state;
        }),
      );
    const mutate = (input) =>
      snapshot().pipe(Effect.flatMap((state) => transport.exchange({ protocolVersion: 1, id: state.nextRequestId, ownerId: state.ownerId, expectedProjectRevision: state.projectRevision, ...input })));
    const prepared = yield* mutate({
      type: "workflow.prepare",
      goal: "Implement the parser and formatter across multiple modules",
      acceptanceStatements: ["parse splits comma-separated text into trimmed items and returns [] for empty text", "format joins items with a comma and a space"],
      complexDraft: draft,
    });
    assert.equal(prepared.success, true, JSON.stringify(prepared));
    const accepted = yield* mutate({ type: "workflow.confirm", previewId: prepared.data.preview.previewId, previewDigest: prepared.data.preview.previewDigest });
    assert.equal(accepted.success, true, JSON.stringify(accepted));
    const deadline = Date.now() + 20 * 60_000;
    for (;;) {
      const state = yield* snapshot();
      const status = state.snapshot.status.run?.status;
      if (!state.busy && status && TERMINAL.has(status)) return { state, checked };
      assert.ok(Date.now() < deadline, "live smoke exceeded 20 minutes");
      yield* Effect.sleep("500 millis");
    }
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
const execution = result.state.complexExecution;
console.log(
  JSON.stringify(
    {
      target: `${values.provider}/${values.model}`,
      project,
      status: result.state.snapshot.status.run.status,
      durationSeconds: Math.round((Date.now() - started) / 1000),
      checkedSnapshots: result.checked,
      tasks: execution.tasks.map((row) => ({ id: row.id, status: row.status, attempt: row.attempt, invocations: row.workerInvocations, reportedTokens: row.reportedTokens, failureCode: row.failureCode, gates: [row.selfCheck, row.review, row.test] })),
      integration: execution.integration,
      budget: execution.budget,
      cleanup: execution.cleanup,
      failureCode: execution.failureCode,
      files: { parse: await readFile(join(project, "src/parse.mjs"), "utf8").catch(() => null), format: await readFile(join(project, "src/format.mjs"), "utf8").catch(() => null) },
    },
    null,
    2,
  ),
);
