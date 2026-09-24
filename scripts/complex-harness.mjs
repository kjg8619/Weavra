// Shared helpers for the COMPLEX boundary corpora (scripts/complex-integration.mjs, scripts/parallel-integration.mjs).
// The production App ControlTransport, its strict decoder and ComplexProjection consumer checks observe the real Runtime
// executable over stdio Host Control; workers talk to a scripted loopback model (scripts/scripted-model-server.mjs).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startScriptedModel } from "./scripted-model-server.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appRoot = process.env.WEAVRA_APP_ROOT ?? root;
export const executable = process.env.T3_WEAVRA_EXECUTABLE ?? join(root, "runtime/pi/packages/company-runtime/bin/weavra");
const serverModules = join(appRoot, "app/t3code/apps/server/node_modules");
const { openControlTransport } = await import(join(appRoot, "app/t3code/apps/server/src/weavra/ControlTransport.ts"));
export const { complexStateConsistent } = await import(join(appRoot, "app/t3code/apps/server/src/weavra/ComplexProjection.ts"));
const NodeServices = await import(join(serverModules, "@effect/platform-node/dist/NodeServices.js"));
export const Effect = await import(join(serverModules, "effect/dist/Effect.js"));

const exec = promisify(execFile);
export const TERMINAL = new Set(["BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED", "COMPLETED"]);
export const PARSE = 'export function parse(text) {\n\treturn text.split(",").map((item) => item.trim());\n}\n';
export const FORMAT = 'export function format(items) {\n\treturn items.join(", ");\n}\n';
export const CONTENT = { "src/parse.mjs": PARSE, "src/format.mjs": FORMAT };
const nodeTest = (name, body) => `import { test } from "node:test";\nimport assert from "node:assert/strict";\n${body}\ntest("${name}", () => {});\n`;
export const childEnv = () =>
  Object.fromEntries(["PATH", "HOME", "WEAVRA_HOME", "TMPDIR", "LANG", "LC_ALL"].map((key) => [key, process.env[key]]).filter(([, value]) => value !== undefined));
export const exists = (path) => access(path).then(() => true, () => false);

/** A git project with parse/format tests, registered checks and the scripted loopback model profiles. */
export async function makeProject(name, { extraChecks = [], workflow = "adaptive", budget, files = {}, maxParallel } = {}) {
  const project = join(process.env.HOME, name);
  await mkdir(join(project, "src"), { recursive: true });
  await mkdir(join(project, "test"), { recursive: true });
  await mkdir(join(project, ".ai"), { mode: 0o700 });
  await writeFile(join(project, ".gitignore"), ".ai/\n");
  await writeFile(join(project, "src/README.md"), "Parser and formatter modules.\n");
  await writeFile(join(project, "test/parse.test.mjs"), nodeTest("parse", 'import { parse } from "../src/parse.mjs";\nassert.deepEqual(parse(" a, b ,c "), ["a", "b", "c"]);'));
  await writeFile(join(project, "test/format.test.mjs"), nodeTest("format", 'import { format } from "../src/format.mjs";\nassert.equal(format(["a", "b"]), "a, b");'));
  for (const [path, content] of Object.entries(files)) await writeFile(join(project, path), content);
  const git = (...args) => exec("git", ["-c", "user.name=Integration", "-c", "user.email=it@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: project });
  await git("init", "-q");
  await git("add", "--", ".gitignore", "src", "test");
  await git("commit", "-qm", "fixture");
  await exec(executable, ["setup"], { cwd: project, input: "" });
  await writeFile(
    join(project, ".ai/config.yaml"),
    JSON.stringify({
      schemaVersion: 1,
      models: { profiles: { coding: { provider: "loopback", model: "fixture" }, reasoning: { provider: "loopback", model: "fixture" } } },
      runtime: { workflow },
      files: { allowed_paths: ["src"] },
      ...(maxParallel ? { agents: { max_parallel: maxParallel } } : {}),
      ...(budget ? { budget } : {}),
      verification: {
        checks: [
          { id: "test-format", kind: "test", executable: process.execPath, args: ["--test", "test/format.test.mjs"], required: true },
          { id: "test-parse", kind: "test", executable: process.execPath, args: ["--test", "test/parse.test.mjs"], required: true },
          ...extraChecks.map((check) => ({ ...check, executable: process.execPath })),
        ],
      },
    }),
    { mode: 0o600 },
  );
  return project;
}

export const handoff = (request, changed) => ({
  runId: request.runId,
  revision: request.revision,
  role: "Developer",
  task: request.task.id,
  changed_files: changed,
  summary: "Scripted contribution",
  assumptions: [],
  tests_run: [],
  known_risks: [],
  unresolved: [],
});
export const review = (request, result, status) => {
  const refs = request.verification.evidenceRefs;
  const task = request.complexTask?.task;
  return {
    tool: "submit_review",
    args: {
      runId: request.runId,
      revision: request.revision,
      role: "Reviewer",
      task: request.task.id,
      result,
      diffDigest: request.verification.diffDigest,
      evidenceRefs: refs,
      issues: result === "PASS" ? [] : [{ severity: "warning", file: null, description: "Scripted revision request", recommendation: "Revise once" }],
      criteria: task
        ? task.criterionIds.map((criterionId) => ({ criterionId, status: status ?? "SUPPORTED", evidenceRefs: refs }))
        : request.task.acceptanceCriteria.map((criterion) => ({ criterionId: criterion.id, status: status ?? "MET", evidenceRefs: refs })),
    },
  };
};

export async function writeModels(model) {
  await writeFile(
    join(process.env.WEAVRA_HOME, "agent/models.json"),
    JSON.stringify({
      providers: {
        loopback: {
          baseUrl: `${model.origin}/v1`,
          api: "openai-completions",
          apiKey: "loopback-fixture-not-a-secret",
          models: [{ id: "fixture", name: "Scripted loopback", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4000 }],
        },
      },
    }),
    { mode: 0o600 },
  );
}

/** One checked App observer over one Runtime connection: every snapshot must pass the App consumer rules. */
const observer = (name, transport, capabilities) => {
  let previous = null;
  const snapshots = [];
  const snapshot = () =>
    transport.exchange({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.snapshot" }).pipe(
      Effect.map((response) => {
        assert.equal(response.success, true, `${name}: ${JSON.stringify(response)}`);
        const state = response.data.state;
        assert.ok(complexStateConsistent(state, capabilities, previous), `${name}: App consumer rejected ${JSON.stringify(state.complexExecution ?? null).slice(0, 3000)}`);
        previous = state;
        snapshots.push(state);
        return state;
      }),
    );
  const mutate = (input) =>
    snapshot().pipe(Effect.flatMap((state) => transport.exchange({ protocolVersion: 1, id: state.nextRequestId, ownerId: state.ownerId, expectedProjectRevision: state.projectRevision, ...input })));
  return { snapshot, mutate, snapshots };
};
export const connect = (name, project, version = 2) =>
  Effect.gen(function* () {
    const transport = yield* openControlTransport(executable, project, childEnv());
    const hello = yield* transport.exchange({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.hello" });
    assert.equal(hello.success, true, JSON.stringify(hello));
    assert.equal(hello.data.capabilities.complexContractVersion, version, `${name}: Runtime must advertise COMPLEX contract v${version}`);
    return { transport, capabilities: hello.data.capabilities, ...observer(name, transport, hello.data.capabilities) };
  });
export const start = (name, connection, { draft, goal, statements }) =>
  Effect.gen(function* () {
    const prepared = yield* connection.mutate({ type: "workflow.prepare", goal, acceptanceStatements: statements, complexDraft: draft });
    assert.equal(prepared.success, true, `${name}: ${JSON.stringify(prepared)}`);
    assert.equal(prepared.data.preview.workflow, "COMPLEX");
    const accepted = yield* connection.mutate({ type: "workflow.confirm", previewId: prepared.data.preview.previewId, previewDigest: prepared.data.preview.previewDigest });
    assert.equal(accepted.success, true, `${name}: ${JSON.stringify(accepted)}`);
  });
export const settle = (name, connection, during) =>
  Effect.gen(function* () {
    const deadline = Date.now() + 120_000;
    for (;;) {
      const state = yield* connection.snapshot();
      if (during) yield* during(state);
      const status = state.snapshot.status.run?.status;
      if (!state.busy && status && TERMINAL.has(status)) return state;
      assert.ok(Date.now() < deadline, `${name}: Run did not settle`);
      yield* Effect.sleep("40 millis");
    }
  });
export const waitFor = (name, connection, predicate) =>
  Effect.gen(function* () {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const state = yield* connection.snapshot();
      if (predicate(state)) return state;
      assert.ok(Date.now() < deadline, `${name}: condition not reached`);
      yield* Effect.sleep("40 millis");
    }
  });
export const scoped = (effect) => Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));

/** A pending model response the scenario releases explicitly (the worker stays live until then). */
export function gate() {
  let release;
  let reached;
  const released = new Promise((resolve) => (release = resolve));
  const arrived = new Promise((resolve) => (reached = resolve));
  return { release: () => release(), reached: () => reached(), released, arrived };
}

/** Runs scenarios with a fresh scripted model each; counts completions for the falseCompletion assertion. */
export function scenarioRunner() {
  const results = [];
  let completions = 0;
  const scenario = async (id, title, expectCompleted, body) => {
    const started = Date.now();
    const model = await startScriptedModel(body.model);
    try {
      const state = await body.run(model);
      const status = state.snapshot.status.run.status;
      if (status === "COMPLETED") completions++;
      assert.equal(status === "COMPLETED", expectCompleted, `${id}: unexpected ${status}`);
      results.push(`PASS ${id} ${title} → ${status} (${Date.now() - started} ms, model calls ${model.requests.length})`);
      console.log(results.at(-1));
    } finally {
      await model.close();
    }
  };
  const finish = (expectedCompletions, label = "COMPLEX") => {
    assert.equal(completions, expectedCompletions, `exactly the ${expectedCompletions} positive controls may complete`);
    console.log(`${label} INTEGRATION PASS: ${results.length} scenarios; falseCompletion=0; paid provider requests=0`);
  };
  return { scenario, finish };
}
