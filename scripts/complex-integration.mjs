// V0.7B #18: COMPLEX Runs end to end across the real boundary. The production App ControlTransport, its strict
// decoder and its consumer consistency checks (ComplexProjection) observe the real Runtime executable over stdio Host
// Control, with real git, filesystem, Policy, RegisteredVerifier and Kernel. Workers talk to a scripted loopback model
// (no paid provider). Every snapshot of every scenario must pass the App consumer checks; no negative scenario may
// reach COMPLETED (falseCompletion = 0).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { startScriptedModel } from "./scripted-model-server.mjs";

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
const PARSE = 'export function parse(text) {\n\treturn text.split(",").map((item) => item.trim());\n}\n';
const FORMAT = 'export function format(items) {\n\treturn items.join(", ");\n}\n';
const CONTENT = { "src/parse.mjs": PARSE, "src/format.mjs": FORMAT };
const nodeTest = (name, body) => `import { test } from "node:test";\nimport assert from "node:assert/strict";\n${body}\ntest("${name}", () => {});\n`;
const GOAL = "Implement the parser and formatter across multiple modules";
const STATEMENTS = ["parse splits comma-separated text into trimmed items", "format joins items with a comma and a space"];
const DRAFT = {
  tasks: [
    { title: "Add parser", goal: "Create src/parse.mjs exporting parse(text)", dependsOnIndexes: [], criterionIndexes: [1], ownership: [{ path: "src/parse.mjs", operation: "create" }], checkIds: ["test-parse"] },
    { title: "Add formatter", goal: "Create src/format.mjs exporting format(items)", dependsOnIndexes: [1], criterionIndexes: [2], ownership: [{ path: "src/format.mjs", operation: "create" }], checkIds: ["test-format"] },
  ],
};
const childEnv = () =>
  Object.fromEntries(["PATH", "HOME", "WEAVRA_HOME", "TMPDIR", "LANG", "LC_ALL"].map((key) => [key, process.env[key]]).filter(([, value]) => value !== undefined));

async function makeProject(name, { extraChecks = [], workflow = "adaptive", budget, files = {} } = {}) {
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

const handoff = (request, changed) => ({
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
const review = (request, result, status) => {
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

/** Default scripted workers: owned writes/deletes then handoff; reviews over the Runtime's own evidence refs. */
function scripted(overrides = {}) {
  return async (entry) => {
    const { request, tools, toolResults } = entry;
    const override = await overrides[request?.complexTask?.task.id ?? "integration"]?.(entry);
    if (override) return override;
    if (tools.includes("submit_review")) return review(request, "PASS");
    const claims = request.complexTask.task.ownership;
    if (toolResults.length < claims.length) {
      const claim = claims[toolResults.length];
      return claim.operation === "delete"
        ? { tool: "runtime_delete", args: { path: claim.path } }
        : { tool: "runtime_write", args: { path: claim.path, content: CONTENT[claim.path] } };
    }
    return { tool: "submit_handoff", args: handoff(request, claims.map((claim) => claim.path)) };
  };
}

async function writeModels(model) {
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
const connect = (name, project) =>
  Effect.gen(function* () {
    const transport = yield* openControlTransport(executable, project, childEnv());
    const hello = yield* transport.exchange({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.hello" });
    assert.equal(hello.success, true, JSON.stringify(hello));
    assert.equal(hello.data.capabilities.complexContractVersion, 2, `${name}: Runtime must advertise COMPLEX contract v2`);
    return { transport, capabilities: hello.data.capabilities, ...observer(name, transport, hello.data.capabilities) };
  });
const start = (name, connection, { draft = DRAFT, goal = GOAL, statements = STATEMENTS } = {}) =>
  Effect.gen(function* () {
    const prepared = yield* connection.mutate({ type: "workflow.prepare", goal, acceptanceStatements: statements, complexDraft: draft });
    assert.equal(prepared.success, true, `${name}: ${JSON.stringify(prepared)}`);
    assert.equal(prepared.data.preview.workflow, "COMPLEX");
    const accepted = yield* connection.mutate({ type: "workflow.confirm", previewId: prepared.data.preview.previewId, previewDigest: prepared.data.preview.previewDigest });
    assert.equal(accepted.success, true, `${name}: ${JSON.stringify(accepted)}`);
  });
const settle = (name, connection, during) =>
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
const waitFor = (name, connection, predicate) =>
  Effect.gen(function* () {
    const deadline = Date.now() + 60_000;
    for (;;) {
      const state = yield* connection.snapshot();
      if (predicate(state)) return state;
      assert.ok(Date.now() < deadline, `${name}: condition not reached`);
      yield* Effect.sleep("40 millis");
    }
  });
const scoped = (effect) => Effect.runPromise(effect.pipe(Effect.scoped, Effect.provide(NodeServices.layer)));
async function run(name, { model, project, draft, goal, statements, during }) {
  await writeModels(model);
  return scoped(
    Effect.gen(function* () {
      const connection = yield* connect(name, project);
      yield* start(name, connection, { draft, goal, statements });
      const state = yield* settle(name, connection, during && ((snapshot) => during(snapshot, connection)));
      return { state, snapshots: connection.snapshots };
    }),
  );
}
/** A pending model response the scenario releases explicitly (the worker stays live until then). */
function gate() {
  let release;
  let reached;
  const released = new Promise((resolve) => (release = resolve));
  const arrived = new Promise((resolve) => (reached = resolve));
  return { release: () => release(), reached: () => reached(), released, arrived };
}
const exists = (path) => access(path).then(() => true, () => false);

const results = [];
let completions = 0;
async function scenario(id, title, expectCompleted, body) {
  const started = Date.now();
  const model = await startScriptedModel(body.model ?? scripted());
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
}

await scenario("P1", "two-task sequential COMPLEX completes with fresh integration", true, {
  run: async (model) => {
    const project = await makeProject("p1");
    const { state, snapshots } = await run("P1", { model, project });
    const execution = state.complexExecution;
    assert.equal(execution.phase, "TERMINAL");
    assert.deepEqual(execution.tasks.map((row) => row.status), ["COMPLETED", "COMPLETED"]);
    assert.deepEqual([execution.integration.check, execution.integration.review, execution.integration.test], ["PASS", "PASS", "PASS"]);
    assert.equal(execution.cleanup, "CONFIRMED");
    assert.equal(execution.budget.workerInvocations, 5);
    assert.equal(state.snapshot.status.writerPresent, false);
    assert.equal(await readFile(join(project, "src/parse.mjs"), "utf8"), PARSE);
    assert.equal(await readFile(join(project, "src/format.mjs"), "utf8"), FORMAT);
    for (const snap of snapshots) if (snap.complexExecution && snap.complexExecution.tasks[1].status !== "PENDING") assert.equal(snap.complexExecution.tasks[0].status, "COMPLETED");
    assert.deepEqual(model.requests.map((request) => `${request.role}:${request.step?.stepId}`), [
      "Developer:implement", "Developer:implement", "Reviewer:review",
      "Developer:implement", "Developer:implement", "Reviewer:review",
      "Reviewer:review",
    ]);
    return state;
  },
});

{
  let reviews = 0;
  let writes = 0;
  await scenario("P2", "one permitted local REVISE, fresh attempt, then completion", true, {
    model: scripted({
      "CT-001": ({ request, tools, toolResults }) => {
        if (tools.includes("submit_review")) return ++reviews === 1 ? review(request, "REVISE", "UNSUPPORTED") : undefined;
        if (toolResults.length === 0) return { tool: "runtime_write", args: { path: "src/parse.mjs", content: ++writes === 1 ? PARSE : `// revised\n${PARSE}` } };
        return { tool: "submit_handoff", args: handoff(request, ["src/parse.mjs"]) };
      },
    }),
    run: async (model) => {
      const project = await makeProject("p2");
      const { state } = await run("P2", { model, project });
      const execution = state.complexExecution;
      assert.deepEqual(execution.tasks.map((row) => [row.status, row.attempt, row.revisionCycle]), [["COMPLETED", 2, 1], ["COMPLETED", 1, 0]]);
      assert.equal(execution.budget.totalRevisionCycles, 1);
      assert.equal(execution.budget.workerInvocations, 7);
      return state;
    },
  });
}

await scenario("P3", "genuine READ_ONLY decomposition completes without changes", true, {
  run: async (model) => {
    const project = await makeProject("p3", { files: { "src/parse.mjs": PARSE, "src/format.mjs": FORMAT } });
    const draft = { tasks: DRAFT.tasks.map((task) => ({ ...task, ownership: [] })) };
    const { state } = await run("P3", { model, project, draft, goal: "Analyze the parser and formatter architecture across multiple modules" });
    assert.equal(state.snapshot.status.run.executionMode, "READ_ONLY");
    assert.deepEqual(state.complexExecution.tasks.map((row) => row.changedFiles.length), [0, 0]);
    assert.equal(state.complexExecution.partialChanges, false);
    return state;
  },
});

for (const decision of ["approve", "reject"]) {
  await scenario(decision === "approve" ? "P4/C16" : "C17", `R3 one-file delete task with human ${decision}`, decision === "approve", {
    run: async (model) => {
      const project = await makeProject(`r3-${decision}`, { workflow: "COMPLEX", files: { "src/old.mjs": "export const old = true;\n", "src/parse.mjs": PARSE, "src/format.mjs": FORMAT } });
      const draft = {
        tasks: [
          { title: "Delete old module", goal: "Delete src/old.mjs", dependsOnIndexes: [], criterionIndexes: [1], ownership: [{ path: "src/old.mjs", operation: "delete" }], checkIds: ["test-parse"] },
          { title: "Confirm remaining modules", goal: "Confirm the remaining modules still pass", dependsOnIndexes: [1], criterionIndexes: [2], ownership: [], checkIds: ["test-format"] },
        ],
      };
      let waited = false;
      let resolved = false;
      const { state } = await run(`R3 ${decision}`, {
        model,
        project,
        draft,
        goal: "delete file src/old.mjs",
        statements: ["src/old.mjs is deleted", "the remaining modules still pass their tests"],
        during: (snapshot, connection) =>
          Effect.gen(function* () {
            if (resolved || !snapshot.pendingApproval) return;
            waited = true;
            assert.equal(snapshot.snapshot.status.run.status, "WAITING_APPROVAL");
            assert.equal(snapshot.complexExecution.tasks[0].status, "WAITING_APPROVAL");
            assert.equal(snapshot.complexExecution.tasks[1].status, "PENDING");
            const response = yield* connection.mutate({ type: "approval.resolve", runId: snapshot.pendingApproval.runId, expectedStateRevision: snapshot.pendingApproval.stateRevision, approvalId: snapshot.pendingApproval.approvalId, decision });
            assert.equal(response.success, true, JSON.stringify(response));
            resolved = true;
          }),
      });
      assert.equal(waited, true, "R3 Run never waited for approval");
      if (decision === "approve") {
        assert.equal(await exists(join(project, "src/old.mjs")), false);
        assert.deepEqual(state.complexExecution.tasks.map((row) => row.status), ["COMPLETED", "COMPLETED"]);
      } else {
        assert.equal(await exists(join(project, "src/old.mjs")), true);
        assert.equal(state.snapshot.status.run.status, "BLOCKED");
        assert.deepEqual(state.complexExecution.tasks.map((row) => [row.status, row.failureCode]).slice(0, 1), [["BLOCKED", "APPROVAL_DENIED"]]);
        assert.equal(state.complexExecution.tasks[1].status, "BLOCKED");
      }
      return state;
    },
  });
}

await scenario("C03", "task B writing task A's claimed file is denied before any effect", false, {
  model: scripted({ "CT-002": ({ toolResults, tools }) => (tools.includes("submit_review") || toolResults.length ? undefined : { tool: "runtime_write", args: { path: "src/parse.mjs", content: "hijacked\n" } }) }),
  run: async (model) => {
    const project = await makeProject("c03");
    const { state } = await run("C03", { model, project });
    assert.equal(state.snapshot.status.run.status, "BLOCKED");
    assert.deepEqual(state.complexExecution.tasks.map((row) => [row.status, row.failureCode]), [["COMPLETED", null], ["BLOCKED", "OWNERSHIP_CONFLICT"]]);
    assert.equal(await readFile(join(project, "src/parse.mjs"), "utf8"), PARSE);
    assert.equal(state.complexExecution.integration.check, "NOT_RUN");
    assert.equal(state.complexExecution.partialChanges, true);
    return state;
  },
});

await scenario("C04", "writing an unclaimed file is denied before any effect", false, {
  model: scripted({ "CT-001": ({ toolResults, tools }) => (tools.includes("submit_review") || toolResults.length ? undefined : { tool: "runtime_write", args: { path: "src/README.md", content: "rewritten\n" } }) }),
  run: async (model) => {
    const project = await makeProject("c04");
    const { state } = await run("C04", { model, project });
    assert.deepEqual(state.complexExecution.tasks.map((row) => row.status), ["BLOCKED", "BLOCKED"]);
    assert.equal(state.complexExecution.tasks[0].failureCode, "UNOWNED_PATH");
    assert.equal(await readFile(join(project, "src/README.md"), "utf8"), "Parser and formatter modules.\n");
    return state;
  },
});

await scenario("C01/C21", "a failing task check blocks; the successor never runs; partial changes kept", false, {
  model: scripted({
    "CT-001": ({ request, tools, toolResults }) =>
      tools.includes("submit_review") ? undefined : toolResults.length ? { tool: "submit_handoff", args: handoff(request, ["src/parse.mjs"]) } : { tool: "runtime_write", args: { path: "src/parse.mjs", content: "export function parse() {\n\treturn [];\n}\n" } },
  }),
  run: async (model) => {
    const project = await makeProject("c01");
    const { state } = await run("C01", { model, project });
    assert.deepEqual(state.complexExecution.tasks.map((row) => row.status), ["BLOCKED", "BLOCKED"]);
    assert.equal(state.complexExecution.tasks[0].failureCode, "CHECK_FAILED");
    assert.equal(state.complexExecution.tasks[0].selfCheck, "FAIL");
    assert.equal(model.requests.filter((request) => request.role === "Reviewer").length, 0);
    assert.equal(state.complexExecution.partialChanges, true);
    return state;
  },
});

await scenario("C07", "a task Reviewer that never submits a review", false, {
  model: scripted({ "CT-001": ({ tools }) => (tools.includes("submit_review") ? { text: "Looks good to me." } : undefined) }),
  run: async (model) => {
    const project = await makeProject("c07");
    const { state } = await run("C07", { model, project });
    assert.notEqual(state.complexExecution.tasks[0].status, "COMPLETED");
    assert.equal(state.complexExecution.tasks[1].status === "COMPLETED", false);
    assert.equal(model.requests.filter((request) => request.complexTaskId === "CT-002").length, 0);
    // A worker that ends without its structured submission is a worker fault (FAILED), never a fabricated verdict.
    assert.equal(state.snapshot.status.run.status, "FAILED");
    assert.deepEqual([state.complexExecution.tasks[0].status, state.complexExecution.tasks[0].failureCode, state.complexExecution.tasks[0].review], ["FAILED", "WORKER_FAILED", "UNAVAILABLE"]);
    return state;
  },
});

await scenario("C08", "integration check failure after every task succeeded", false, {
  run: async (model) => {
    // An optional registered check only integration runs (task checks select mapped required checks only).
    const project = await makeProject("c08", { extraChecks: [{ id: "lint", kind: "lint", args: ["test/lint.mjs"], required: false }], files: { "test/lint.mjs": "process.exit(1);\n" } });
    const { state } = await run("C08", { model, project });
    assert.deepEqual(state.complexExecution.tasks.map((row) => row.status), ["COMPLETED", "COMPLETED"]);
    assert.equal(state.complexExecution.integration.check, "FAIL");
    assert.equal(state.complexExecution.integration.failureCode, "CHECK_FAILED");
    assert.equal(state.complexExecution.integration.review, "NOT_RUN");
    return state;
  },
});

await scenario("C12", "global worker budget exhausted before the next worker", false, {
  run: async (model) => {
    const project = await makeProject("c12", { budget: { max_worker_invocations: 3 } });
    const { state } = await run("C12", { model, project });
    assert.equal(state.complexExecution.budget.status, "EXHAUSTED");
    assert.equal(state.complexExecution.budget.workerInvocations, 3);
    return state;
  },
});

{
  const held = gate();
  await scenario("C14/C32", "cancel while a later task's Developer is live", false, {
    model: scripted({
      "CT-002": async ({ tools }) => {
        if (tools.includes("submit_review")) return undefined;
        held.reached();
        await held.released;
        return { text: "late" };
      },
    }),
    run: async (model) => {
      const project = await makeProject("c14");
      let cancelled = false;
      try {
        const { state } = await run("C14", {
          model,
          project,
          during: (snapshot, connection) =>
            Effect.gen(function* () {
              if (cancelled || snapshot.complexExecution?.activeTaskIds?.join() !== "CT-002") return;
              yield* Effect.promise(() => held.arrived);
              // The worker is now parked on the model: take the revision the cancel must fence against.
              const current = yield* connection.snapshot();
              const response = yield* connection.mutate({ type: "workflow.cancel", runId: current.ownedRunId, expectedStateRevision: current.stateRevision });
              assert.equal(response.success, true, JSON.stringify(response));
              cancelled = true;
            }),
        });
        assert.equal(state.snapshot.status.run.status, "CANCELLED");
        assert.deepEqual(state.complexExecution.tasks.map((row) => row.status), ["COMPLETED", "CANCELLED"]);
        assert.equal(state.complexExecution.cleanup, "CONFIRMED");
        assert.equal(state.snapshot.status.writerPresent, false);
        return state;
      } finally {
        held.release();
      }
    },
  });
}

{
  const held = gate();
  await scenario("C20", "an external change to a completed task's file blocks the next capture", false, {
    model: scripted({
      "CT-002": async ({ tools, toolResults }) => {
        if (tools.includes("submit_review") || toolResults.length) return undefined;
        held.reached();
        await held.released;
        return undefined;
      },
    }),
    run: async (model) => {
      const project = await makeProject("c20");
      let tampered = false;
      try {
        const { state } = await run("C20", {
          model,
          project,
          during: (snapshot) =>
            Effect.gen(function* () {
              if (tampered || snapshot.complexExecution?.activeTaskIds?.join() !== "CT-002") return;
              yield* Effect.promise(() => held.arrived);
              yield* Effect.promise(() => writeFile(join(project, "src/parse.mjs"), "// external edit\n"));
              tampered = true;
              held.release();
            }),
        });
        assert.equal(state.snapshot.status.run.status, "BLOCKED");
        assert.equal(state.complexExecution.tasks[1].failureCode, "EXTERNAL_MUTATION");
        assert.equal(await readFile(join(project, "src/parse.mjs"), "utf8"), "// external edit\n");
        return state;
      } finally {
        held.release();
      }
    },
  });
}

{
  const held = gate();
  await scenario("C19", "a second App connection mid-run sees an unowned, consistent projection; closing the owner cancels without replay", false, {
    model: scripted({
      "CT-002": async ({ tools }) => {
        if (tools.includes("submit_review")) return undefined;
        held.reached();
        await held.released;
        return { text: "late" };
      },
    }),
    run: async (model) => {
      const project = await makeProject("c19");
      await writeModels(model);
      try {
        return await scoped(
          Effect.gen(function* () {
            // A second, independent App connection (its own Runtime Host process) that never owns the Run.
            const observerConnection = yield* connect("C19 observer", project);
            yield* Effect.gen(function* () {
              const owner = yield* connect("C19 owner", project);
              yield* start("C19", owner);
              yield* waitFor("C19 owner", owner, (state) => state.complexExecution?.activeTaskIds?.join() === "CT-002");
              yield* Effect.promise(() => held.arrived);
              const seen = yield* observerConnection.snapshot();
              assert.equal(seen.ownedRunId, null);
              assert.equal(seen.snapshot.status.run.status, "RUNNING");
              assert.deepEqual(seen.complexExecution.activeTaskIds, ["CT-002"]);
            }).pipe(Effect.scoped);
            // The owner's connection closed: its Host shut down and cancelled the Run it owned. Nothing resumes.
            held.release();
            const final = yield* settle("C19 observer", observerConnection);
            assert.equal(final.snapshot.status.run.status, "CANCELLED");
            assert.deepEqual(final.complexExecution.tasks.map((row) => row.status), ["COMPLETED", "CANCELLED"]);
            assert.equal(final.snapshot.status.writerPresent, false);
            return final;
          }),
        );
      } finally {
        held.release();
      }
    },
  });
}

assert.equal(completions, 4, "exactly the four positive controls may complete");
console.log(`COMPLEX INTEGRATION PASS: ${results.filter((line) => line.startsWith("PASS")).length} scenarios; falseCompletion=0; paid provider requests=0`);
