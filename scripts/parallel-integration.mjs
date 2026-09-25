// V0.8A #22: parallel COMPLEX waves across the real boundary. The production App ControlTransport, its strict v2 decoder
// and ComplexProjection checks observe the real Runtime executable; workers talk to a scripted loopback model whose
// gates force the interleavings. Every snapshot must pass the App consumer checks; falseCompletion = 0.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  CONTENT,
  Effect,
  connect,
  exists,
  gate,
  handoff,
  makeProject,
  review,
  scenarioRunner,
  scoped,
  settle,
  start,
  waitFor,
  writeModels,
  executable,
  childEnv,
  complexStateConsistent,
} from "./complex-harness.mjs";
import { startScriptedModel } from "./scripted-model-server.mjs";

const exec = promisify(execFile);
const INDEX = 'export { parse } from "./parse.mjs";\nexport { format } from "./format.mjs";\n';
const CONTENTS = { ...CONTENT, "src/index.mjs": INDEX };
const INDEX_TEST = { "test/index.test.mjs": 'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { parse, format } from "../src/index.mjs";\nassert.equal(format(parse(" a, b ")), "a, b");\ntest("index", () => {});\n' };
const GOAL = "Implement the parser, the formatter and an index across multiple modules";
const STATEMENTS = ["parse splits comma-separated text into trimmed items", "format joins items with a comma and a space", "index re-exports parse and format"];
const TASKS = {
  parse: { title: "Add parser", goal: "Create src/parse.mjs exporting parse(text)", criterionIndexes: [1], ownership: [{ path: "src/parse.mjs", operation: "create" }], checkIds: ["test-parse"] },
  format: { title: "Add formatter", goal: "Create src/format.mjs exporting format(items)", criterionIndexes: [2], ownership: [{ path: "src/format.mjs", operation: "create" }], checkIds: ["test-format"] },
  index: { title: "Add index", goal: "Create src/index.mjs re-exporting parse and format", criterionIndexes: [3], ownership: [{ path: "src/index.mjs", operation: "create" }], checkIds: ["test-index"] },
};
/** CT-001 parse and CT-002 format are independent (wave 1); CT-003 index depends on both (wave 2). */
const DRAFT = { tasks: [{ ...TASKS.parse, dependsOnIndexes: [] }, { ...TASKS.format, dependsOnIndexes: [] }, { ...TASKS.index, dependsOnIndexes: [1, 2] }] };
const TWO = { tasks: [{ ...TASKS.parse, dependsOnIndexes: [] }, { ...TASKS.format, dependsOnIndexes: [] }] };
/** Three-task project (parse, format, index); `two` has only the two independent tasks and their checks. */
const project = (name, options = {}) =>
  makeProject(name, { maxParallel: 2, files: INDEX_TEST, extraChecks: [{ id: "test-index", kind: "test", args: ["--test", "test/index.test.mjs"], required: true }], ...options });
const two = (name, options = {}) => makeProject(name, { maxParallel: 2, ...options });

/** Scripted workers over three owned files; `hold` parks a task's first Developer call until released. */
function workers({ hold = {}, overrides = {}, delayMs = 0 } = {}) {
  return async (entry) => {
    const { request, tools, toolResults } = entry;
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const id = request?.complexTask?.task.id ?? "integration";
    const override = await overrides[id]?.(entry);
    if (override) return override;
    if (tools.includes("submit_review")) return review(request, "PASS");
    const claims = request.complexTask.task.ownership;
    if (!toolResults.length && hold[id]) await hold[id](entry);
    if (toolResults.length < claims.length)
      return { tool: "runtime_write", args: { path: claims[toolResults.length].path, content: CONTENTS[claims[toolResults.length].path] } };
    return { tool: "submit_handoff", args: handoff(request, claims.map((claim) => claim.path)) };
  };
}
/** Barrier of N: every first Developer call of the listed tasks must arrive before any returns (proves concurrency). */
function barrier(ids, timeoutMs = 20_000) {
  const arrived = new Set();
  let open;
  const opened = new Promise((resolve) => (open = resolve));
  const hold = Object.fromEntries(
    ids.map((id) => [
      id,
      async () => {
        arrived.add(id);
        if (arrived.size === ids.length) open();
        await Promise.race([opened, new Promise((_, reject) => setTimeout(() => reject(new Error(`barrier: only ${[...arrived]} arrived`)), timeoutMs))]);
      },
    ]),
  );
  return { hold, opened };
}
async function run(name, { model, projectRoot, draft = DRAFT, goal = GOAL, statements = STATEMENTS, during }) {
  await writeModels(model);
  return scoped(
    Effect.gen(function* () {
      const connection = yield* connect(name, projectRoot, 2);
      yield* start(name, connection, { draft, goal, statements });
      const state = yield* settle(name, connection, during && ((snapshot) => during(snapshot, connection)));
      return { state, snapshots: connection.snapshots };
    }),
  );
}
const statuses = (state) => state.complexExecution.tasks.map((row) => row.status);
const { scenario, finish } = scenarioRunner();

{
  const { hold } = barrier(["CT-001", "CT-002"]);
  await scenario("P01", "two independent Developers are live at once; verification in plan order; wave 2 after", true, {
    model: workers({ hold }),
    run: async (model) => {
      const projectRoot = await project("p01");
      const { state, snapshots } = await run("P01", { model, projectRoot });
      assert.ok(
        snapshots.some((snap) => snap.complexExecution?.activeTaskIds.join() === "CT-001,CT-002" && snap.complexExecution.tasks.slice(0, 2).every((row) => row.status === "IMPLEMENTING")),
        "never observed both wave rows IMPLEMENTING together",
      );
      for (const snap of snapshots) if (snap.complexExecution && snap.complexExecution.tasks[2].status !== "PENDING") assert.deepEqual(snap.complexExecution.tasks.slice(0, 2).map((row) => row.status), ["COMPLETED", "COMPLETED"]);
      const reviews = model.requests.filter((request) => request.role === "Reviewer").map((request) => request.complexTaskId ?? "integration");
      assert.deepEqual(reviews, ["CT-001", "CT-002", "CT-003", "integration"]);
      assert.deepEqual(statuses(state), ["COMPLETED", "COMPLETED", "COMPLETED"]);
      assert.equal(state.complexExecution.budget.workerInvocations, 7);
      assert.equal(await readFile(join(projectRoot, "src/index.mjs"), "utf8"), INDEX);
      return state;
    },
  });
}

{
  const release = gate();
  await scenario("P02/P03", "B hands off first and waits HANDED_OFF; verification is still A then B", true, {
    model: workers({ hold: { "CT-001": async () => { release.reached(); await release.released; } } }),
    run: async (model) => {
      const projectRoot = await two("p02");
      let sawWaiting = false;
      const { state } = await run("P02", {
        model,
        projectRoot,
        draft: TWO,
        statements: STATEMENTS.slice(0, 2),
        goal: "Implement the parser and formatter across multiple modules",
        during: (snapshot) =>
          Effect.sync(() => {
            const rows = snapshot.complexExecution?.tasks;
            if (rows?.[0].status === "IMPLEMENTING" && rows[1].status === "HANDED_OFF") {
              sawWaiting = true;
              assert.equal(model.requests.filter((request) => request.role === "Reviewer").length, 0);
              release.release();
            }
          }),
      });
      release.release();
      assert.ok(sawWaiting, "never observed CT-002 HANDED_OFF while CT-001 was still implementing");
      assert.deepEqual(model.requests.filter((request) => request.role === "Reviewer").map((request) => request.complexTaskId ?? "integration"), ["CT-001", "CT-002", "integration"]);
      return state;
    },
  });
}

{
  const { hold } = barrier(["CT-001", "CT-002"]);
  const parked = gate();
  await scenario("P05", "A writes B's claimed file while B is live: A OWNERSHIP_CONFLICT, B stopped, bytes unchanged", false, {
    model: workers({
      hold: { ...hold, "CT-002": async (entry) => { await hold["CT-002"](entry); parked.reached(); await parked.released; } },
      overrides: { "CT-001": async ({ toolResults, tools }) => (tools.includes("submit_review") || toolResults.length ? undefined : (await hold["CT-001"](), { tool: "runtime_write", args: { path: "src/format.mjs", content: "hijacked\n" } })) },
    }),
    run: async (model) => {
      const projectRoot = await two("p05");
      try {
        const { state } = await run("P05", { model, projectRoot, draft: TWO, statements: STATEMENTS.slice(0, 2), goal: "Implement the parser and formatter across multiple modules" });
        assert.equal(state.snapshot.status.run.status, "BLOCKED");
        assert.deepEqual(state.complexExecution.tasks.map((row) => [row.status, row.failureCode]), [["BLOCKED", "OWNERSHIP_CONFLICT"], ["BLOCKED", "RUN_STOPPED"]]);
        assert.equal(await exists(join(projectRoot, "src/format.mjs")), false);
        assert.equal(state.complexExecution.cleanup, "CONFIRMED");
        assert.equal(state.snapshot.status.writerPresent, false);
        return state;
      } finally {
        parked.release();
      }
    },
  });
}

{
  const { hold, opened } = barrier(["CT-001", "CT-002"]);
  const parked = gate();
  await scenario("P07", "cancel with two live Developers: both CANCELLED after join, writer released", false, {
    model: workers({ hold: { "CT-001": async (e) => { await hold["CT-001"](e); await parked.released; }, "CT-002": async (e) => { await hold["CT-002"](e); await parked.released; } } }),
    run: async (model) => {
      const projectRoot = await project("p07");
      let cancelled = false;
      try {
        const { state } = await run("P07", {
          model,
          projectRoot,
          during: (snapshot, connection) =>
            Effect.gen(function* () {
              if (cancelled || snapshot.complexExecution?.activeTaskIds.length !== 2) return;
              yield* Effect.promise(() => opened);
              const current = yield* connection.snapshot();
              const response = yield* connection.mutate({ type: "workflow.cancel", runId: current.ownedRunId, expectedStateRevision: current.stateRevision });
              assert.equal(response.success, true, JSON.stringify(response));
              cancelled = true;
            }),
        });
        assert.equal(state.snapshot.status.run.status, "CANCELLED");
        assert.deepEqual(statuses(state), ["CANCELLED", "CANCELLED", "CANCELLED"]);
        assert.equal(state.complexExecution.cleanup, "CONFIRMED");
        assert.equal(state.snapshot.status.writerPresent, false);
        return state;
      } finally {
        parked.release();
      }
    },
  });
}

await scenario("P09", "a two-row wave with one invocation left is BLOCKED before any wave worker starts", false, {
  model: workers(),
  run: async (model) => {
    const projectRoot = await two("p09", { budget: { max_worker_invocations: 1 } });
    const { state } = await run("P09", { model, projectRoot, draft: TWO, statements: STATEMENTS.slice(0, 2), goal: "Implement the parser and formatter across multiple modules" });
    assert.equal(state.snapshot.status.run.status, "BLOCKED");
    assert.equal(state.complexExecution.budget.status, "EXHAUSTED");
    assert.equal(model.requests.length, 0, "no worker may start when the whole wave cannot be reserved");
    return state;
  },
});

{
  const { hold, opened } = barrier(["CT-001", "CT-002"]);
  const parked = gate();
  await scenario("P13", "a second App connection mid-wave sees both live rows consistently; closing the owner cancels without replay", false, {
    model: workers({ hold: { "CT-001": async (e) => { await hold["CT-001"](e); await parked.released; }, "CT-002": async (e) => { await hold["CT-002"](e); await parked.released; } } }),
    run: async (model) => {
      const projectRoot = await project("p13");
      await writeModels(model);
      try {
        return await scoped(
          Effect.gen(function* () {
            const observer = yield* connect("P13 observer", projectRoot, 2);
            yield* Effect.gen(function* () {
              const owner = yield* connect("P13 owner", projectRoot, 2);
              yield* start("P13", owner, { draft: DRAFT, goal: GOAL, statements: STATEMENTS });
              yield* waitFor("P13 owner", owner, (state) => state.complexExecution?.activeTaskIds.length === 2);
              yield* Effect.promise(() => opened);
              const seen = yield* observer.snapshot();
              assert.equal(seen.ownedRunId, null);
              assert.deepEqual(seen.complexExecution.activeTaskIds, ["CT-001", "CT-002"]);
            }).pipe(Effect.scoped);
            parked.release();
            const final = yield* settle("P13 observer", observer);
            assert.equal(final.snapshot.status.run.status, "CANCELLED");
            assert.deepEqual(statuses(final), ["CANCELLED", "CANCELLED", "CANCELLED"]);
            return final;
          }),
        );
      } finally {
        parked.release();
      }
    },
  });
}

{
  // P14: kill -9 the owning Runtime Host mid-wave. A raw stdio client owns the Run so the harness holds the PID.
  const { hold, opened } = barrier(["CT-001", "CT-002"]);
  const parked = gate();
  const scripted = workers({ hold: { "CT-001": async (e) => { await hold["CT-001"](e); await parked.released; }, "CT-002": async (e) => { await hold["CT-002"](e); await parked.released; } } });
  /** The Run ID of every model request, in arrival order. */
  const runIds = [];
  await scenario("P14", "owner killed mid-wave: the orphan stays visible read-only; a prepare recovers it INTERRUPTED/OWNER_LOST (STALE_PROJECT, no resume); the next prepare's new Run completes", true, {
    model: (entry) => {
      runIds.push(entry.request?.runId);
      return scripted(entry);
    },
    run: async (model) => {
      const projectRoot = await project("p14");
      await writeModels(model);
      const child = spawn(executable, ["bridge", "--stdio", "--project-trusted", "--control"], { cwd: projectRoot, env: childEnv(), stdio: ["pipe", "pipe", "inherit"] });
      const pending = new Map();
      let buffer = "";
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 1);
          const message = JSON.parse(line);
          pending.get(message.id)?.(message);
          pending.delete(message.id);
        }
      });
      const send = (request) => new Promise((resolve) => { pending.set(request.id, resolve); child.stdin.write(`${JSON.stringify(request)}\n`); });
      const raw = async (type, extra = {}) => {
        if (type === "control.hello" || type === "control.snapshot") return send({ protocolVersion: 1, id: crypto.randomUUID(), type });
        const snapshot = await send({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.snapshot" });
        const state = snapshot.data.state;
        return send({ protocolVersion: 1, id: state.nextRequestId, ownerId: state.ownerId, expectedProjectRevision: state.projectRevision, type, ...extra });
      };
      assert.equal((await raw("control.hello")).data.capabilities.complexContractVersion, 2);
      const prepared = await raw("workflow.prepare", { goal: GOAL, acceptanceStatements: STATEMENTS, complexDraft: DRAFT });
      assert.equal(prepared.success, true, JSON.stringify(prepared));
      assert.equal((await raw("workflow.confirm", { previewId: prepared.data.preview.previewId, previewDigest: prepared.data.preview.previewDigest })).success, true);
      await opened;
      const orphanRequests = runIds.length;
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      parked.release();
      return scoped(
        Effect.gen(function* () {
          // Every snapshot below passes the App consumer checks, including the recovery transition.
          const next = yield* connect("P14 new Host", projectRoot, 2);
          const seen = yield* next.snapshot();
          const orphanId = seen.snapshot.status.run.runId;
          assert.equal(seen.snapshot.status.run.status, "RUNNING");
          assert.equal(seen.snapshot.status.writerPresent, true);
          assert.equal(seen.ownedRunId, null);
          assert.deepEqual(statuses(seen), ["IMPLEMENTING", "IMPLEMENTING", "PENDING"]);
          // control.snapshot stays read-only: reading again changes nothing.
          const reread = yield* next.snapshot();
          assert.deepEqual([reread.projectRevision, reread.stateRevision, reread.snapshot.status.writerPresent], [seen.projectRevision, seen.stateRevision, true]);
          // workflow.prepare recovers the provably dead same-host owner. That moves the revision the client sent, so it
          // answers STALE_PROJECT and prepares nothing.
          const recovering = yield* next.mutate({ type: "workflow.prepare", goal: GOAL, acceptanceStatements: STATEMENTS, complexDraft: DRAFT });
          assert.equal(recovering.success, false, JSON.stringify(recovering));
          assert.equal(recovering.error.code, "STALE_PROJECT");
          const recovered = yield* next.snapshot();
          assert.equal(recovered.projectRevision, seen.projectRevision + 1);
          assert.equal(recovered.snapshot.status.run.runId, orphanId);
          assert.equal(recovered.snapshot.status.run.status, "INTERRUPTED");
          assert.equal(recovered.snapshot.status.writerPresent, false);
          assert.equal(recovered.preview, null);
          assert.deepEqual(recovered.complexExecution.tasks.map((row) => [row.status, row.failureCode]), Array(3).fill(["INTERRUPTED", "OWNER_LOST"]));
          assert.equal(recovered.complexExecution.cleanup, "UNCONFIRMED");
          // The next prepare runs normally at the recovered revision, and its preview echoes the revision it was sent.
          const prepared = yield* next.mutate({ type: "workflow.prepare", goal: GOAL, acceptanceStatements: STATEMENTS, complexDraft: DRAFT });
          assert.equal(prepared.success, true, JSON.stringify(prepared));
          const preview = prepared.data.preview;
          assert.equal(preview.projectRevision, recovered.projectRevision);
          const accepted = yield* next.mutate({ type: "workflow.confirm", previewId: preview.previewId, previewDigest: preview.previewDigest });
          assert.equal(accepted.success, true, JSON.stringify(accepted));
          const final = yield* settle("P14 new Host", next);
          const runId = final.snapshot.status.run.runId;
          assert.notEqual(runId, orphanId);
          assert.deepEqual(statuses(final), ["COMPLETED", "COMPLETED", "COMPLETED"]);
          // Nothing resumed: after the kill every model request belongs to the new Run, and the orphan keeps its recovery.
          assert.ok(runIds.slice(orphanRequests).every((id) => id === runId), `requests after the kill: ${runIds.slice(orphanRequests)}`);
          const durable = JSON.parse(yield* Effect.promise(() => readFile(join(projectRoot, ".ai/state.json"), "utf8")));
          const orphan = durable.runs.find((run) => run.runId === orphanId);
          assert.equal(orphan.status, "INTERRUPTED");
          assert.deepEqual(orphan.complex.tasks.map((row) => [row.status, row.failureCode]), Array(3).fill(["INTERRUPTED", "OWNER_LOST"]));
          console.log(`   P14 orphan after kill: run RUNNING, rows ${statuses(seen).join("/")}, writerPresent true; prepare → ${recovering.error.code} with the Run ${recovered.snapshot.status.run.status} (${statuses(recovered).join("/")}), writer free; next prepare's new Run ${final.snapshot.status.run.status}`);
          return final;
        }),
      );
    },
  });
}

/** Developer model calls of a run: wall-clock span, summed call time, and whether calls of different tasks overlapped. */
function implementationPhase(requests) {
  const calls = requests.filter((request) => request.role === "Developer");
  assert.ok(calls.length > 0 && calls.every((call) => call.endedAt !== null), "every Developer call must have ended");
  const span = Math.max(...calls.map((call) => call.endedAt)) - Math.min(...calls.map((call) => call.startedAt));
  const busy = calls.reduce((sum, call) => sum + call.endedAt - call.startedAt, 0);
  const overlapped = calls.some((a) => calls.some((b) => a.complexTaskId !== b.complexTaskId && a.startedAt < b.endedAt && b.startedAt < a.endedAt));
  return { span, busy, overlapped };
}

{
  // Speedup: identical 2-task plans with a fixed model latency, serial (max_parallel 1) vs one wave of two.
  // Only implementation runs concurrently, so the saving is bounded by the Developer time, and the whole-run wall clock
  // of two separate runs is reported, not asserted: on a shared CI runner its noise can exceed the saving. The asserted
  // measurement is within each run: the wave's implementation wall clock is below the serial sum of its Developer calls,
  // and the serial run never overlaps them.
  const timings = {};
  for (const maxParallel of [1, 2])
    await scenario(`P01-speed-${maxParallel}`, `wall clock with a 400 ms model latency, max_parallel ${maxParallel}`, true, {
      model: workers({ delayMs: 400 }),
      run: async (model) => {
        const projectRoot = await two(`speed-${maxParallel}`, { maxParallel });
        const started = Date.now();
        const { state } = await run(`speed ${maxParallel}`, { model, projectRoot, draft: TWO, statements: STATEMENTS.slice(0, 2), goal: "Implement the parser and formatter across multiple modules" });
        timings[maxParallel] = { run: Date.now() - started, ...implementationPhase(model.requests) };
        return state;
      },
    });
  const [serial, wave] = [timings[1], timings[2]];
  const ms = (value) => Math.round(value);
  console.log(`   speed: whole run serial ${serial.run} ms, one wave of two ${wave.run} ms, ratio ${(wave.run / serial.run).toFixed(2)} (reported, not asserted)`);
  console.log(
    `   implementation: serial span ${ms(serial.span)} ms for ${ms(serial.busy)} ms of Developer calls; wave span ${ms(wave.span)} ms for ${ms(wave.busy)} ms, ratio ${(wave.span / wave.busy).toFixed(2)}`,
  );
  assert.equal(serial.overlapped, false, "max_parallel 1 must never overlap Developer calls of different tasks");
  assert.equal(wave.overlapped, true, "the wave's two Developers must overlap");
  assert.ok(wave.span < wave.busy, "the wave's implementation wall clock must be below the serial sum of its Developer calls");
}

finish(5, "PARALLEL");
