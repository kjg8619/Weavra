// V0.8B #54: the Planner draft across the real boundary (docs/architecture/PLANNER_DRAFT.md §11). The production App
// ControlTransport, its strict decoder and the ComplexProjection/PlannerProjection consumer checks observe the real
// Runtime executable; the Planner and the workers talk to a scripted loopback model. Planning is candidate data only:
// no scenario may start a Run except L01, which the human path (read → prepare → confirm) completes.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONTENT,
  Effect,
  connect,
  gate,
  handoff,
  makeProject,
  review,
  scoped,
  settle,
  start,
  waitFor,
  writeModels,
} from "./complex-harness.mjs";
import { messageText, startScriptedModel } from "./scripted-model-server.mjs";

const appRoot = process.env.WEAVRA_APP_ROOT ?? join(import.meta.dirname, "..");
const { plannerStateConsistent } = await import(join(appRoot, "app/t3code/apps/server/src/weavra/PlannerProjection.ts"));

const GOAL = "Implement the parser and formatter across multiple modules";
const STATEMENTS = ["parse splits comma-separated text into trimmed items", "format joins items with a comma and a space"];
const DRAFT = {
  tasks: [
    { title: "Add parser", goal: "Create src/parse.mjs exporting parse(text)", dependsOnIndexes: [], criterionIndexes: [1], ownership: [{ path: "src/parse.mjs", operation: "create" }], checkIds: ["test-parse"] },
    { title: "Add formatter", goal: "Create src/format.mjs exporting format(items)", dependsOnIndexes: [], criterionIndexes: [2], ownership: [{ path: "src/format.mjs", operation: "create" }], checkIds: ["test-format"] },
  ],
};
const digest = (goal, statements = []) =>
  `sha256:${createHash("sha256").update(JSON.stringify(["weavra-planner-request-v1", goal, statements]), "utf8").digest("hex")}`;
const TERMINAL_RUN = new Set(["BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED", "COMPLETED"]);

/**
 * Scripted peer: the Planner answers from `plan` (one entry per Planner invocation: a draft, `{ text }`, or a function
 * that may wait), and every worker writes its claims, hands off and reviews PASS. `holdWorkers` parks the first
 * Developer call until it resolves, so a scenario can act while a human Run is live.
 */
function scripted(plan = [DRAFT], holdWorkers) {
  const planner = { calls: 0, contexts: [], toolResults: [] };
  let held = false;
  const respond = async (entry) => {
    const { request, tools, toolResults, messages } = entry;
    if (request?.role === "Planner") {
      if (planner.calls === 0) planner.contexts.push(messageText(messages.find((message) => message.role === "user")));
      planner.toolResults = messages.filter((message) => message.role === "tool").map(messageText);
      const step = plan[Math.min(planner.calls, plan.length - 1)];
      planner.calls++;
      assert.deepEqual(tools, ["submit_plan_draft"], "the Planner has exactly one tool");
      const reply = typeof step === "function" ? await step(entry) : step;
      return reply?.text !== undefined || reply?.tool ? reply : { tool: "submit_plan_draft", args: reply };
    }
    if (tools.includes("submit_review")) return review(request, "PASS");
    if (holdWorkers && !held) {
      held = true;
      await holdWorkers();
    }
    const claims = request.complexTask.task.ownership;
    if (toolResults.length < claims.length)
      return { tool: "runtime_write", args: { path: claims[toolResults.length].path, content: CONTENT[claims[toolResults.length].path] } };
    return { tool: "submit_handoff", args: handoff(request, claims.map((claim) => claim.path)) };
  };
  return { respond, planner };
}

/** Every snapshot also passes the App's PlannerProjection rules, with this connection's own start bookkeeping. */
function planning(connection) {
  let started = false;
  let previous = null;
  const snapshot = () =>
    connection.snapshot().pipe(
      Effect.map((state) => {
        assert.ok(plannerStateConsistent(state, connection.capabilities, previous, started), `App PlannerProjection rejected ${JSON.stringify(state.planner ?? null)}`);
        previous = state;
        return state;
      }),
    );
  const send = (input) =>
    Effect.gen(function* () {
      if (input.type === "planner.start") started = true;
      const response = yield* connection.mutate(input);
      yield* snapshot();
      return response;
    });
  const until = (predicate, timeoutMs = 60_000) =>
    Effect.gen(function* () {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const state = yield* snapshot();
        if (predicate(state)) return state;
        assert.ok(Date.now() < deadline, "planner condition not reached");
        yield* Effect.sleep("40 millis");
      }
    });
  const startPlanning = (goal = GOAL, statements = STATEMENTS) =>
    Effect.gen(function* () {
      const accepted = yield* send({ type: "planner.start", goal, ...(statements ? { acceptanceStatements: statements } : {}) });
      assert.equal(accepted.success, true, JSON.stringify(accepted));
      assert.deepEqual([accepted.data.kind, accepted.data.command, accepted.data.runId], ["accepted", "planner.start", null]);
      return yield* until((state) => state.planner !== undefined);
    });
  const settled = (timeoutMs) => until((state) => state.planner && state.planner.status !== "RUNNING", timeoutMs);
  return { snapshot, send, until, startPlanning, settled };
}

// Scenario runner: only L01 may complete a Run (falseCompletion = 0 means no other Run completes, or starts).
const results = [];
let completions = 0;
async function scenario(id, title, body) {
  const started = Date.now();
  const script = scripted(body.plan, body.holdWorkers);
  const model = await startScriptedModel(script.respond);
  try {
    const outcome = await body.run(model, script.planner);
    if (outcome.run === "COMPLETED") completions++;
    results.push(`PASS ${id} ${title} → ${outcome.label} (${Date.now() - started} ms, Planner calls ${script.planner.calls}, model calls ${model.requests.length})`);
    console.log(results.at(-1));
  } finally {
    await model.close();
  }
}
const inScope = (effect) => scoped(effect);
const project = async (name, options) => {
  const root = await makeProject(name, options);
  return root;
};
const noRun = (state) => assert.equal(state.snapshot.status.run, null, "planning must never start a Run");
async function setConfig(root, change) {
  const path = join(root, ".ai/config.yaml");
  const config = JSON.parse(await readFile(path, "utf8"));
  change(config);
  await writeFile(path, JSON.stringify(config), { mode: 0o600 });
}

// L01 (+L13, L14): start → READY → read → prepare → confirm → COMPLETED; planning itself is not durable.
await scenario("L01", "a READY draft is read, prepared unchanged on the first try, confirmed and completed", {
  run: async (model, planner) => {
    const root = await project("l01", { maxParallel: 2 });
    await writeModels(model);
    return inScope(
      Effect.gen(function* () {
        const connection = yield* connect("L01", root);
        assert.equal(connection.capabilities.plannerContractVersion, 1);
        const p = planning(connection);
        const before = yield* p.snapshot();
        assert.equal("planner" in before, false, "L14: no planner key before any planner.start");
        yield* p.startPlanning();
        const ready = yield* p.settled();
        const status = ready.planner;
        assert.equal(status.status, "READY", JSON.stringify(status));
        assert.deepEqual([status.taskCount, status.usage.invocations, status.current, status.failureCode], [2, 1, true, null]);
        assert.equal(status.requestDigest, digest(GOAL, STATEMENTS));
        assert.equal(status.projectRevision, before.projectRevision);
        assert.equal(ready.projectRevision, before.projectRevision, "planning changed no project revision");
        assert.equal(ready.snapshot.status.writerPresent, false, "planning takes no writer lock");
        noRun(ready);
        const read = yield* p.send({ type: "planner.read", planId: status.planId });
        assert.equal(read.success, true, JSON.stringify(read));
        assert.deepEqual([read.data.kind, read.data.planId, read.data.current], ["planner-draft", status.planId, true]);
        assert.deepEqual(read.data.draft, DRAFT);
        // L13: the Planning Context lists names only, inside the allowed paths; no .ai or .git names; within bounds.
        const context = JSON.parse(planner.contexts[0]);
        assert.equal(context.role, "Planner");
        assert.ok(Buffer.byteLength(planner.contexts[0], "utf8") <= 196_608);
        assert.ok(context.fileListing.files.length > 0 && context.fileListing.files.every((file) => file.startsWith("src/")), JSON.stringify(context.fileListing));
        assert.ok(!JSON.stringify(context).includes(".ai/") && !JSON.stringify(context).includes(".git/"));
        assert.ok(context.checks.every((check) => Object.keys(check).sort().join() === "exercises,id,kind,required"), "checks carry no commands");
        // Amendment A1 (#65): each check names the modules its test imports; no verifier path such as test/… appears.
        assert.deepEqual(
          Object.fromEntries(context.checks.map((check) => [check.id, check.exercises])),
          { "test-format": ["src/format.mjs"], "test-parse": ["src/parse.mjs"] },
          JSON.stringify(context.checks),
        );
        assert.ok(!planner.contexts[0].includes("test/"), "the Planning Context names no verifier path");
        // The human path, unchanged: prepare recompiles the loaded draft, confirm starts the Run.
        yield* start("L01", connection, { draft: read.data.draft, goal: GOAL, statements: STATEMENTS });
        const final = yield* settle("L01", connection);
        assert.equal(final.snapshot.status.run.status, "COMPLETED");
        assert.equal("planner" in final, false, "a successful confirm clears planner state");
        return { run: "COMPLETED", label: "COMPLETED" };
      }),
    );
  },
});

// L02: forged fields, then a delete claim: DRAFT_INVALID after exactly 2 invocations; no Run, no write.
await scenario("L02", "forged fields and a delete claim are refused; FAILED/DRAFT_INVALID", {
  plan: [
    { tasks: DRAFT.tasks.map((task, index) => ({ ...task, id: `CT-00${index + 1}`, status: "COMPLETED", risk: "R0" })) },
    { tasks: [{ ...DRAFT.tasks[0], ownership: [{ path: "src/parse.mjs", operation: "delete" }] }, DRAFT.tasks[1]] },
  ],
  run: async (model, planner) => {
    const root = await project("l02");
    await writeModels(model);
    return inScope(
      Effect.gen(function* () {
        const connection = yield* connect("L02", root);
        const p = planning(connection);
        const before = yield* p.snapshot();
        yield* p.startPlanning();
        const done = yield* p.settled();
        assert.deepEqual([done.planner.status, done.planner.failureCode, done.planner.usage.invocations], ["FAILED", "DRAFT_INVALID", 2]);
        assert.equal(planner.calls, 2);
        assert.equal(done.projectRevision, before.projectRevision);
        noRun(done);
        const read = yield* p.send({ type: "planner.read", planId: done.planner.planId });
        assert.equal(read.error?.code, "PLANNER_NOT_READY");
        return { label: "FAILED/DRAFT_INVALID" };
      }),
    );
  },
});

// L03: a claim outside the allowed paths gets one bounded correction; the corrected draft is READY.
await scenario("L03", "an out-of-scope claim gets one bounded correction; the corrected draft is READY", {
  plan: [{ tasks: [{ ...DRAFT.tasks[0], ownership: [{ path: "docs/parse.md", operation: "create" }] }, DRAFT.tasks[1]] }, DRAFT],
  run: async (model, planner) => {
    const root = await project("l03");
    await writeModels(model);
    return inScope(
      Effect.gen(function* () {
        const connection = yield* connect("L03", root);
        const p = planning(connection);
        yield* p.startPlanning();
        const done = yield* p.settled();
        assert.deepEqual([done.planner.status, done.planner.usage.invocations], ["READY", 2]);
        const text = planner.toolResults.at(-1);
        assert.ok(Buffer.byteLength(text, "utf8") <= 2048, `correction is ${Buffer.byteLength(text, "utf8")} bytes`);
        noRun(done);
        return { label: "READY after one correction" };
      }),
    );
  },
});

// L04: text only, twice: FAILED/NO_DRAFT after exactly 2 invocations (one reminder).
await scenario("L04", "two text-only answers end FAILED/NO_DRAFT after one reminder", {
  plan: [{ text: "I would split it into two tasks." }, { text: "Still thinking." }],
  run: async (model, planner) => {
    const root = await project("l04");
    await writeModels(model);
    return inScope(
      Effect.gen(function* () {
        const connection = yield* connect("L04", root);
        const p = planning(connection);
        yield* p.startPlanning();
        const done = yield* p.settled();
        assert.deepEqual([done.planner.status, done.planner.failureCode, done.planner.usage.invocations, planner.calls], ["FAILED", "NO_DRAFT", 2, 2]);
        noRun(done);
        return { label: "FAILED/NO_DRAFT" };
      }),
    );
  },
});

// L05: the model never answers: FAILED/TIMEOUT at worker_timeout_ms; the Host keeps answering snapshots meanwhile.
{
  const never = gate();
  await scenario("L05", "a model that never answers ends FAILED/TIMEOUT; snapshots keep working", {
    plan: [async () => { await never.released; return DRAFT; }],
    run: async (model) => {
      const root = await project("l05");
      await setConfig(root, (config) => (config.agents = { ...(config.agents ?? {}), worker_timeout_ms: 10_000 }));
      await writeModels(model);
      try {
        return await inScope(
          Effect.gen(function* () {
            const connection = yield* connect("L05", root);
            const p = planning(connection);
            yield* p.startPlanning();
            const running = yield* p.snapshot();
            assert.equal(running.planner.status, "RUNNING");
            const done = yield* p.settled(40_000);
            assert.deepEqual([done.planner.status, done.planner.failureCode], ["FAILED", "TIMEOUT"]);
            assert.ok(done.planner.finishedAt - done.planner.startedAt >= 10_000);
            noRun(done);
            return { label: "FAILED/TIMEOUT" };
          }),
        );
      } finally {
        never.release();
      }
    },
  });
}

// L06: cancel while RUNNING; the late submission is ignored.
{
  const held = gate();
  await scenario("L06", "cancel while RUNNING is CANCELLED; the late submission is ignored", {
    plan: [async () => { held.reached(); await held.released; return DRAFT; }],
    run: async (model, planner) => {
      const root = await project("l06");
      await writeModels(model);
      return inScope(
        Effect.gen(function* () {
          const connection = yield* connect("L06", root);
          const p = planning(connection);
          const running = yield* p.startPlanning();
          yield* Effect.promise(() => held.arrived);
          const cancelled = yield* p.send({ type: "planner.cancel", planId: running.planner.planId });
          assert.deepEqual([cancelled.success, cancelled.data?.command, cancelled.data?.runId], [true, "planner.cancel", null]);
          const done = yield* p.settled();
          assert.equal(done.planner.status, "CANCELLED");
          held.release();
          yield* Effect.sleep("500 millis");
          const after = yield* p.snapshot();
          assert.deepEqual([after.planner.status, after.planner.finishedAt], ["CANCELLED", done.planner.finishedAt]);
          const read = yield* p.send({ type: "planner.read", planId: running.planner.planId });
          assert.equal(read.error?.code, "PLANNER_NOT_READY");
          const again = yield* p.send({ type: "planner.cancel", planId: running.planner.planId });
          assert.equal(again.error?.code, "PLANNER_NOT_FOUND");
          assert.equal(planner.calls, 1);
          noRun(after);
          return { label: "CANCELLED" };
        }),
      );
    },
  });
}

// L07: text, invalid, invalid: FAILED/DRAFT_INVALID after exactly 3 invocations; never a 4th.
await scenario("L07", "reminder then correction then failure stops at exactly 3 invocations", {
  plan: [
    { text: "Here is my thinking." },
    { tasks: [DRAFT.tasks[0]] },
    { tasks: [DRAFT.tasks[0]] },
    DRAFT,
  ],
  run: async (model, planner) => {
    const root = await project("l07");
    await writeModels(model);
    return inScope(
      Effect.gen(function* () {
        const connection = yield* connect("L07", root);
        const p = planning(connection);
        yield* p.startPlanning();
        const done = yield* p.settled();
        assert.deepEqual([done.planner.status, done.planner.failureCode, done.planner.usage.invocations, planner.calls], ["FAILED", "DRAFT_INVALID", 3, 3]);
        noRun(done);
        return { label: "FAILED/DRAFT_INVALID at 3" };
      }),
    );
  },
});

// L08: every refusal happens before any model call.
await scenario("L08", "stale, non-COMPLEX, R3, busy and foreign-writer starts are refused with zero Planner calls", {
  plan: [async () => assert.fail("no Planner call may happen in L08")],
  run: async (model, planner) => {
    const root = await project("l08");
    const r3 = await project("l08-r3", { workflow: "COMPLEX", files: { "src/old.mjs": "export const old = true;\n" } });
    await writeModels(model);
    return inScope(
      Effect.gen(function* () {
        const connection = yield* connect("L08", root);
        const p = planning(connection);
        const state = yield* p.snapshot();
        const refuse = (input, expectedProjectRevision) =>
          connection.transport.exchange({ protocolVersion: 1, id: state.nextRequestId, ownerId: state.ownerId, expectedProjectRevision, ...input });
        const stale = yield* refuse({ type: "planner.start", goal: GOAL, acceptanceStatements: STATEMENTS }, state.projectRevision + 1);
        assert.equal(stale.error?.code, "STALE_PROJECT");
        const standard = yield* p.send({ type: "planner.start", goal: "Fix the typo in src/README.md" });
        assert.equal(standard.error?.code, "UNSUPPORTED_WORKFLOW");
        const r3Connection = yield* connect("L08 R3", r3);
        const r3Planning = planning(r3Connection);
        const deletion = yield* r3Planning.send({ type: "planner.start", goal: "delete file src/old.mjs" });
        assert.equal(deletion.error?.code, "UNSUPPORTED_WORKFLOW");
        assert.equal(planner.calls, 0);
        return { label: "all refused before any model call" };
      }),
    );
  },
});

// L08b: an execution on this Host answers PLANNER_BUSY; a second Host sees the writer and refuses too.
{
  const held = gate();
  await scenario("L08b", "a live Run refuses planning: PLANNER_BUSY on its Host, WRITER_PRESENT/ACTIVE_RUN on another", {
    plan: [async () => assert.fail("no Planner call may happen in L08b")],
    holdWorkers: async () => {
      held.reached();
      await held.released;
    },
    run: async (model, planner) => {
      const root = await project("l08b");
      await writeModels(model);
      const script = model;
      return inScope(
        Effect.gen(function* () {
          const owner = yield* connect("L08b owner", root);
          yield* start("L08b", owner, { draft: DRAFT, goal: GOAL, statements: STATEMENTS });
          yield* Effect.promise(() => held.arrived);
          yield* waitFor("L08b", owner, (state) => state.snapshot.status.run?.status === "RUNNING");
          const busy = yield* planning(owner).send({ type: "planner.start", goal: GOAL, acceptanceStatements: STATEMENTS });
          assert.equal(busy.error?.code, "PLANNER_BUSY");
          const other = yield* connect("L08b other", root);
          const foreign = yield* planning(other).send({ type: "planner.start", goal: GOAL, acceptanceStatements: STATEMENTS });
          assert.ok(["WRITER_PRESENT", "ACTIVE_RUN"].includes(foreign.error?.code), JSON.stringify(foreign.error));
          assert.equal(planner.calls, 0);
          held.release();
          const final = yield* settle("L08b", owner);
          assert.equal(script.requests.filter((request) => request.role === "Planner").length, 0);
          return { run: final.snapshot.status.run.status, label: `refused; the human Run ${final.snapshot.status.run.status}` };
        }),
      );
    },
  });
}

// L09: confirm while RUNNING is PLANNER_BUSY; prepare is allowed; the Run does not start.
{
  const held = gate();
  await scenario("L09", "confirm while planning is PLANNER_BUSY and starts nothing", {
    plan: [async () => { held.reached(); await held.released; return DRAFT; }],
    run: async (model) => {
      const root = await project("l09");
      await writeModels(model);
      return inScope(
        Effect.gen(function* () {
          const connection = yield* connect("L09", root);
          const p = planning(connection);
          yield* p.startPlanning();
          yield* Effect.promise(() => held.arrived);
          const prepared = yield* p.send({ type: "workflow.prepare", goal: GOAL, acceptanceStatements: STATEMENTS, complexDraft: DRAFT });
          assert.equal(prepared.success, true, JSON.stringify(prepared));
          const confirmed = yield* p.send({ type: "workflow.confirm", previewId: prepared.data.preview.previewId, previewDigest: prepared.data.preview.previewDigest });
          assert.equal(confirmed.error?.code, "PLANNER_BUSY");
          held.release();
          const done = yield* p.settled();
          assert.equal(done.planner.status, "READY");
          noRun(done);
          return { label: "PLANNER_BUSY; no Run" };
        }),
      );
    },
  });
}

// L10: a configuration change while RUNNING ends FAILED/STALE; the draft is not readable.
{
  const held = gate();
  await scenario("L10", "a config change while RUNNING ends FAILED/STALE", {
    plan: [async () => { held.reached(); await held.released; return DRAFT; }],
    run: async (model) => {
      const root = await project("l10");
      await writeModels(model);
      return inScope(
        Effect.gen(function* () {
          const connection = yield* connect("L10", root);
          const p = planning(connection);
          const running = yield* p.startPlanning();
          yield* Effect.promise(() => held.arrived);
          yield* Effect.promise(() => setConfig(root, (config) => (config.agents = { ...(config.agents ?? {}), max_parallel: 2 })));
          held.release();
          const done = yield* p.settled();
          assert.deepEqual([done.planner.status, done.planner.failureCode], ["FAILED", "STALE"]);
          const read = yield* p.send({ type: "planner.read", planId: running.planner.planId });
          assert.equal(read.error?.code, "PLANNER_NOT_READY");
          noRun(done);
          return { label: "FAILED/STALE" };
        }),
      );
    },
  });
}

// L11: a change after READY makes the draft non-current; prepare re-validates the loaded draft.
await scenario("L11", "a change after READY marks the draft non-current; prepare re-validates it", {
  run: async (model) => {
    const root = await project("l11");
    await writeModels(model);
    return inScope(
      Effect.gen(function* () {
        const connection = yield* connect("L11", root);
        const p = planning(connection);
        yield* p.startPlanning();
        const ready = yield* p.settled();
        assert.deepEqual([ready.planner.status, ready.planner.current], ["READY", true]);
        // Drop the formatter check the draft selects: the draft is readable but no longer current, and prepare refuses it.
        yield* Effect.promise(() =>
          setConfig(root, (config) => (config.verification.checks = config.verification.checks.filter((check) => check.id !== "test-format"))),
        );
        const stale = yield* p.until((state) => state.planner.current === false);
        assert.equal(stale.planner.status, "READY");
        const read = yield* p.send({ type: "planner.read", planId: ready.planner.planId });
        assert.deepEqual([read.success, read.data?.current], [true, false]);
        const prepared = yield* p.send({ type: "workflow.prepare", goal: GOAL, acceptanceStatements: STATEMENTS, complexDraft: read.data.draft });
        assert.equal(prepared.success, false, "prepare re-validates a non-current draft");
        noRun(stale);
        return { label: "non-current; prepare refused" };
      }),
    );
  },
});

// L12: the owner connection closes while RUNNING: the Host exits, planning ends, nothing durable remains.
{
  const held = gate();
  await scenario("L12", "closing the owner connection while RUNNING leaves no planner state and no durable change", {
    plan: [async () => { held.reached(); await held.released; return DRAFT; }],
    run: async (model, planner) => {
      const root = await project("l12");
      await writeModels(model);
      const before = await inScope(
        Effect.gen(function* () {
          const connection = yield* connect("L12", root);
          const p = planning(connection);
          const running = yield* p.startPlanning();
          yield* Effect.promise(() => held.arrived);
          return running;
        }),
      );
      held.release();
      return inScope(
        Effect.gen(function* () {
          const connection = yield* connect("L12 again", root);
          const state = yield* planning(connection).snapshot();
          assert.equal("planner" in state, false, "a new Host has no planner state");
          assert.equal(state.projectRevision, before.projectRevision);
          assert.equal(state.snapshot.status.writerPresent, false);
          assert.equal(planner.calls, 1, "the closed Host made no further Planner call");
          noRun(state);
          return { label: "no planner state; nothing durable" };
        }),
      );
    },
  });
}

assert.equal(completions, 2, "only the positive controls complete a Run: L01 (a Planner draft the human prepared and confirmed) and L08b (the human Run the refusals ran beside)");
console.log(`PLANNER INTEGRATION PASS: ${results.length} scenarios; falseCompletion=0; paid provider requests=0`);
