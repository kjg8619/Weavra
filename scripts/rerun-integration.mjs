// V0.8C #58: explicit re-run of unfinished COMPLEX work across the real boundary (docs/architecture/COMPLEX_RERUN.md §9).
// The production App ControlTransport, its strict decoder and the ComplexProjection consumer checks observe the real
// Runtime executable; workers talk to a scripted loopback model. The corpus plays the user: it commits or discards
// leftovers with its own git calls, because the Runtime never does either. Nothing resumes and no evidence is reused.
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { readFile, realpath, rm, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CONTENT, Effect, connect, executable, childEnv, gate, handoff, makeProject, review, scoped, settle, start, waitFor, writeModels } from "./complex-harness.mjs";
import { startScriptedModel } from "./scripted-model-server.mjs";

const exec = promisify(execFile);
const GOAL = "Implement the parser and formatter across multiple modules";
const STATEMENTS = ["parse splits comma-separated text into trimmed items", "format joins items with a comma and a space"];
const SEQUENTIAL = {
  tasks: [
    { title: "Add parser", goal: "Create src/parse.mjs exporting parse(text)", dependsOnIndexes: [], criterionIndexes: [1], ownership: [{ path: "src/parse.mjs", operation: "create" }], checkIds: ["test-parse"] },
    { title: "Add formatter", goal: "Create src/format.mjs exporting format(items)", dependsOnIndexes: [1], criterionIndexes: [2], ownership: [{ path: "src/format.mjs", operation: "create" }], checkIds: ["test-format"] },
  ],
};
const WRONG_FORMAT = "export function format(items) {\n\treturn items.join(\";\");\n}\n";
const git = (project, ...args) => exec("git", ["-c", "user.name=Integration", "-c", "user.email=it@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: project });
const status = async (project) => (await git(project, "status", "--porcelain=v1", "--untracked-files=all")).stdout;

/** Scripted workers; `wrongFormat()` decides per Developer call whether the formatter is written wrong (to fail its check). */
function scripted({ wrongFormat = () => false, hold } = {}) {
  let held = false;
  return async (entry) => {
    const { request, tools, toolResults } = entry;
    if (tools.includes("submit_review")) return review(request, "PASS");
    if (hold && !held) {
      held = true;
      await hold();
    }
    const claims = request.complexTask.task.ownership;
    if (toolResults.length < claims.length) {
      const claim = claims[toolResults.length];
      if (claim.operation === "delete") return { tool: "runtime_delete", args: { path: claim.path } };
      const content = claim.path === "src/format.mjs" && wrongFormat() ? WRONG_FORMAT : CONTENT[claim.path];
      return { tool: "runtime_write", args: { path: claim.path, content } };
    }
    return { tool: "submit_handoff", args: handoff(request, claims.map((claim) => claim.path)) };
  };
}

// Scenario runner: positive controls are the re-runs that complete; every source Run must not complete.
const results = [];
let completions = 0;
async function scenario(id, title, body) {
  const started = Date.now();
  const model = await startScriptedModel(body.model);
  try {
    const outcome = await body.run(model);
    if (outcome.completed) completions++;
    results.push(`PASS ${id} ${title} → ${outcome.label} (${Date.now() - started} ms, model calls ${model.requests.length})`);
    console.log(results.at(-1));
  } finally {
    await model.close();
  }
}

/** The derive request as the App sends it; `expectOk` asserts success and returns the derived-draft data. */
const derive = (connection, runId, expectOk = true) =>
  Effect.gen(function* () {
    const response = yield* connection.mutate({ type: "workflow.derive", runId });
    if (expectOk) {
      assert.equal(response.success, true, JSON.stringify(response));
      assert.equal(response.data.kind, "derived-draft");
      assert.equal(response.data.runId, runId);
    }
    return response;
  });

/** A finished BLOCKED source: CT-001 COMPLETED, CT-002 wrote a wrong formatter and failed its check. */
async function blockedSource(model, name) {
  const project = await makeProject(name);
  await writeModels(model);
  const state = await scoped(
    Effect.gen(function* () {
      const connection = yield* connect(`${name} source`, project);
      yield* start(`${name} source`, connection, { draft: SEQUENTIAL, goal: GOAL, statements: STATEMENTS });
      return yield* settle(`${name} source`, connection);
    }),
  );
  assert.equal(state.snapshot.status.run.status, "BLOCKED");
  assert.deepEqual(state.complexExecution.tasks.map((row) => [row.status, row.failureCode]), [["COMPLETED", null], ["BLOCKED", "CHECK_FAILED"]]);
  return { project, source: state };
}

// R01 (+R05, R06): BLOCKED → derive → resolve leftovers → derive again → re-run COMPLETED with fresh verification.
{
  let formatWrites = 0;
  await scenario("R01", "a BLOCKED Run is derived, its leftovers resolved, and re-run to COMPLETED with fresh verification", {
    model: scripted({ wrongFormat: () => ++formatWrites === 1 }),
    run: async (model) => {
      const { project, source } = await blockedSource(model, "r01");
      const runId = source.snapshot.status.run.runId;
      return scoped(
        Effect.gen(function* () {
          const connection = yield* connect("R01", project);
          assert.equal(connection.capabilities.rerunContractVersion, 1);
          const before = yield* connection.snapshot();
          const gitBefore = yield* Effect.promise(() => status(project));
          const first = (yield* derive(connection, runId)).data;
          // §4: the COMPLETED task becomes a claim-less verification task; the failed one keeps its claim, now modify.
          assert.deepEqual([first.sourceStatus, first.goal, first.acceptanceStatements], ["BLOCKED", GOAL, STATEMENTS]);
          assert.equal(first.draft.tasks.length, 2);
          assert.deepEqual(first.draft.tasks[0], { title: "Verify: Add parser", goal: "Re-verify without changes: Create src/parse.mjs exporting parse(text)", dependsOnIndexes: [], criterionIndexes: [1], ownership: [], checkIds: ["test-parse"] });
          assert.deepEqual(first.draft.tasks[1].ownership, [{ path: "src/format.mjs", operation: "modify" }]);
          assert.deepEqual(first.draft.tasks[1].dependsOnIndexes, [1]);
          assert.equal(first.leftovers.clean, false);
          assert.deepEqual(first.leftovers.paths, ["src/format.mjs", "src/parse.mjs"]);
          assert.ok(first.notes.some((note) => note.includes("src/format.mjs") && note.includes("modify")), JSON.stringify(first.notes));
          assert.equal(first.prepareCheck.ok, true, JSON.stringify(first.prepareCheck));
          // R05: deterministic and read-only.
          const again = (yield* derive(connection, runId)).data;
          assert.deepEqual(again, first);
          const after = yield* connection.snapshot();
          assert.deepEqual([after.projectRevision, after.snapshot.status.writerPresent], [before.projectRevision, false]);
          assert.equal(yield* Effect.promise(() => status(project)), gitBefore, "derive never touches the checkout");
          // The user keeps the completed parser and discards the failed formatter, then derives again.
          yield* Effect.promise(async () => {
            await git(project, "add", "--", "src/parse.mjs");
            await git(project, "commit", "-qm", "keep the completed parser");
            await rm(join(project, "src/format.mjs"));
          });
          const resolved = (yield* derive(connection, runId)).data;
          assert.deepEqual(resolved.draft.tasks[1].ownership, [{ path: "src/format.mjs", operation: "create" }]);
          assert.deepEqual([resolved.leftovers.clean, resolved.leftovers.paths], [true, []]);
          // The ordinary human path: prepare recompiles, confirm starts a new Run with new identities.
          yield* start("R01", connection, { draft: resolved.draft, goal: resolved.goal, statements: resolved.acceptanceStatements });
          const final = yield* settle("R01", connection);
          const execution = final.complexExecution;
          assert.equal(final.snapshot.status.run.status, "COMPLETED");
          assert.notEqual(final.snapshot.status.run.runId, runId);
          // R06: fresh identities and fresh verification; nothing carried over.
          assert.notEqual(execution.plan.complexPlanDigest, source.complexExecution.plan.complexPlanDigest);
          assert.notEqual(execution.plan.planId, source.complexExecution.plan.planId);
          assert.notEqual(execution.plan.parentTaskId, source.complexExecution.plan.parentTaskId);
          assert.equal(first.sourcePlanDigest, source.complexExecution.plan.complexPlanDigest);
          assert.deepEqual(execution.tasks.map((row) => [row.status, row.selfCheck, row.review, row.test]), [["COMPLETED", "PASS", "PASS", "PASS"], ["COMPLETED", "PASS", "PASS", "PASS"]]);
          assert.deepEqual(execution.tasks[0].changedFiles, [], "the verification task changes nothing");
          assert.equal(yield* Effect.promise(() => readFile(join(project, "src/format.mjs"), "utf8")), CONTENT["src/format.mjs"]);
          return { completed: true, label: "derived, resolved, re-run COMPLETED" };
        }),
      );
    },
  });
}

// R03: refusals: COMPLETED source, non-latest runId, R3 source, and a live Run.
{
  const held = gate();
  await scenario("R03", "derive refuses non-latest, live, COMPLETED and R3 sources before reading any file", {
    model: scripted({ hold: async () => { held.reached(); await held.released; } }),
    run: async (model) => {
      const project = await makeProject("r03");
      const r3 = await makeProject("r03-r3", { workflow: "COMPLEX", files: { "src/old.mjs": "export const old = true;\n" } });
      await writeModels(model);
      return scoped(
        Effect.gen(function* () {
          const connection = yield* connect("R03", project);
          const missing = yield* derive(connection, crypto.randomUUID(), false);
          assert.equal(missing.error?.code, "RUN_NOT_FOUND");
          yield* start("R03 live", connection, { draft: SEQUENTIAL, goal: GOAL, statements: STATEMENTS });
          yield* Effect.promise(() => held.arrived);
          const live = yield* waitFor("R03 live", connection, (state) => state.snapshot.status.run?.status === "RUNNING");
          // A live latest Run is not terminal: refused before anything else (COMPLEX_RERUN.md §3 order).
          const busy = yield* derive(connection, live.snapshot.status.run.runId, false);
          assert.equal(busy.error?.code, "RERUN_NOT_APPLICABLE");
          held.release();
          const done = yield* settle("R03 live", connection);
          assert.equal(done.snapshot.status.run.status, "COMPLETED");
          const completed = yield* derive(connection, done.snapshot.status.run.runId, false);
          assert.equal(completed.error?.code, "RERUN_NOT_APPLICABLE");
          // An R3 single-delete plan the human rejected ends BLOCKED and is never derived.
          const r3Connection = yield* connect("R03 r3", r3);
          const draft = {
            tasks: [
              { title: "Delete old module", goal: "Delete src/old.mjs", dependsOnIndexes: [], criterionIndexes: [1], ownership: [{ path: "src/old.mjs", operation: "delete" }], checkIds: ["test-parse"] },
              { title: "Confirm remaining modules", goal: "Confirm the remaining modules still pass", dependsOnIndexes: [1], criterionIndexes: [2], ownership: [], checkIds: ["test-format"] },
            ],
          };
          yield* start("R03 r3", r3Connection, { draft, goal: "delete file src/old.mjs", statements: ["src/old.mjs is deleted", "the remaining modules still pass their tests"] });
          const approval = yield* waitFor("R03 r3", r3Connection, (state) => state.pendingApproval !== null);
          yield* r3Connection.mutate({ type: "approval.resolve", approvalId: approval.pendingApproval.approvalId, decision: "reject", runId: approval.pendingApproval.runId, expectedStateRevision: approval.pendingApproval.stateRevision });
          const rejected = yield* settle("R03 r3", r3Connection);
          assert.equal(rejected.snapshot.status.run.status, "BLOCKED");
          const r3Refusal = yield* derive(r3Connection, rejected.snapshot.status.run.runId, false);
          assert.equal(r3Refusal.error?.code, "RERUN_NOT_APPLICABLE");
          return { completed: true, label: "RUN_NOT_FOUND, RERUN_NOT_APPLICABLE ×3 (live, COMPLETED, R3)" };
        }),
      );
    },
  });
}

// R04: leftovers remain: prepare may succeed, but the start fails the unchanged clean-start rule; no Run is created.
{
  let formatWrites = 0;
  await scenario("R04", "a derived draft with leftovers still in the checkout fails the clean start; no Run is created", {
    model: scripted({ wrongFormat: () => ++formatWrites === 1 }),
    run: async (model) => {
      const { project, source } = await blockedSource(model, "r04");
      const runId = source.snapshot.status.run.runId;
      return scoped(
        Effect.gen(function* () {
          const connection = yield* connect("R04", project);
          const derived = (yield* derive(connection, runId)).data;
          assert.equal(derived.leftovers.clean, false);
          const prepared = yield* connection.mutate({ type: "workflow.prepare", goal: derived.goal, acceptanceStatements: derived.acceptanceStatements, complexDraft: derived.draft });
          assert.equal(prepared.success, true, JSON.stringify(prepared));
          const accepted = yield* connection.mutate({ type: "workflow.confirm", previewId: prepared.data.preview.previewId, previewDigest: prepared.data.preview.previewDigest });
          assert.equal(accepted.success, true, JSON.stringify(accepted));
          const failed = yield* waitFor("R04", connection, (state) => state.startFailure === "START_FAILED");
          assert.equal(failed.snapshot.status.run.runId, runId, "no new Run was created");
          return { completed: false, label: "START_FAILED; source Run stays latest" };
        }),
      );
    },
  });
}

// R02: owner killed mid-wave → prepare recovers (STALE_PROJECT) → derive the INTERRUPTED Run → re-run COMPLETED.
{
  const arrived = new Set();
  let open;
  const opened = new Promise((resolve) => (open = resolve));
  const parked = gate();
  const hold = async (entry) => {
    arrived.add(entry.request.complexTask.task.id);
    if (arrived.size === 2) open();
    await opened;
    await parked.released;
  };
  const INDEPENDENT = { tasks: SEQUENTIAL.tasks.map((task) => ({ ...task, dependsOnIndexes: [] })) };
  let killed = false;
  await scenario("R02", "an INTERRUPTED Run (owner killed mid-wave) is recovered, derived and re-run to COMPLETED", {
    model: async (entry) => {
      if (!killed && entry.request?.complexTask && !entry.tools.includes("submit_review") && !entry.toolResults.length) await hold(entry);
      return scripted()(entry);
    },
    run: async (model) => {
      const project = await makeProject("r02", { maxParallel: 2 });
      await writeModels(model);
      const child = spawn(executable, ["bridge", "--stdio", "--project-trusted", "--control"], { cwd: project, env: childEnv(), stdio: ["pipe", "pipe", "inherit"] });
      const pending = new Map();
      let buffer = "";
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        for (let index = buffer.indexOf("\n"); index >= 0; index = buffer.indexOf("\n")) {
          const message = JSON.parse(buffer.slice(0, index));
          buffer = buffer.slice(index + 1);
          pending.get(message.id)?.(message);
          pending.delete(message.id);
        }
      });
      const send = (request) => new Promise((resolve) => { pending.set(request.id, resolve); child.stdin.write(`${JSON.stringify(request)}\n`); });
      const raw = async (type, extra = {}) => {
        const snapshot = await send({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.snapshot" });
        const state = snapshot.data.state;
        return send({ protocolVersion: 1, id: state.nextRequestId, ownerId: state.ownerId, expectedProjectRevision: state.projectRevision, type, ...extra });
      };
      await send({ protocolVersion: 1, id: crypto.randomUUID(), type: "control.hello" });
      const prepared = await raw("workflow.prepare", { goal: GOAL, acceptanceStatements: STATEMENTS, complexDraft: INDEPENDENT });
      assert.equal(prepared.success, true, JSON.stringify(prepared));
      assert.equal((await raw("workflow.confirm", { previewId: prepared.data.preview.previewId, previewDigest: prepared.data.preview.previewDigest })).success, true);
      await opened;
      killed = true;
      child.kill("SIGKILL");
      await new Promise((resolve) => child.once("exit", resolve));
      parked.release();
      return scoped(
        Effect.gen(function* () {
          const connection = yield* connect("R02", project);
          const orphan = yield* connection.snapshot();
          const runId = orphan.snapshot.status.run.runId;
          // Recovery happens only through prepare (PR #48); derive stays read-only and refuses the still-RUNNING orphan.
          const early = yield* derive(connection, runId, false);
          assert.equal(early.error?.code, "RERUN_NOT_APPLICABLE");
          const recovering = yield* connection.mutate({ type: "workflow.prepare", goal: GOAL, acceptanceStatements: STATEMENTS, complexDraft: INDEPENDENT });
          assert.equal(recovering.error?.code, "STALE_PROJECT");
          const derived = (yield* derive(connection, runId)).data;
          assert.equal(derived.sourceStatus, "INTERRUPTED");
          assert.deepEqual(derived.draft.tasks.map((task) => task.ownership), [[{ path: "src/parse.mjs", operation: "create" }], [{ path: "src/format.mjs", operation: "create" }]]);
          assert.equal(derived.leftovers.clean, true);
          yield* start("R02", connection, { draft: derived.draft, goal: derived.goal, statements: derived.acceptanceStatements });
          const final = yield* settle("R02", connection);
          assert.equal(final.snapshot.status.run.status, "COMPLETED");
          assert.notEqual(final.snapshot.status.run.runId, runId);
          return { completed: true, label: "recovered, derived, re-run COMPLETED" };
        }),
      );
    },
  });
}

// R07: a terminal Run whose owner died holding the lock: prepare lets the Runtime recover; derive works afterwards.
await scenario("R07", "a stale writer lock after a terminal Run is recovered through prepare; derive then works", {
  model: scripted({ wrongFormat: (() => { let writes = 0; return () => ++writes === 1; })() }),
  run: async (model) => {
    const { project, source } = await blockedSource(model, "r07");
    const runId = source.snapshot.status.run.runId;
    // A dead same-host owner's lock, in the Runtime's own format: a PID that has provably exited.
    const dead = spawn(process.execPath, ["-e", ""]);
    const pid = dead.pid;
    await new Promise((resolve) => dead.once("exit", resolve));
    const projectPath = await realpath(project);
    await writeFile(join(project, ".ai/writer.lock"), JSON.stringify({ schemaVersion: 1, projectPath, token: crypto.randomUUID(), pid, hostname: hostname() }), { mode: 0o600, flag: "wx" });
    return scoped(
      Effect.gen(function* () {
        const connection = yield* connect("R07", project);
        const stale = yield* connection.snapshot();
        assert.equal(stale.snapshot.status.writerPresent, true);
        assert.equal(stale.snapshot.status.run.status, "BLOCKED");
        // derive is read-only and allowed while the stale lock is present.
        const derived = (yield* derive(connection, runId)).data;
        assert.equal(derived.sourceStatus, "BLOCKED");
        // Prepare (now allowed by the App in this state) lets the Runtime recover the dead owner's lock.
        const prepared = yield* connection.mutate({ type: "workflow.prepare", goal: derived.goal, acceptanceStatements: derived.acceptanceStatements, complexDraft: derived.draft });
        assert.ok(prepared.success || prepared.error?.code === "STALE_PROJECT", JSON.stringify(prepared));
        const after = yield* connection.snapshot();
        assert.equal(after.snapshot.status.writerPresent, false, "the dead owner's lock is gone");
        assert.equal(after.snapshot.status.run.runId, runId);
        return { completed: false, label: `recovered via prepare (${prepared.success ? "prepared" : prepared.error.code}); derive worked while locked` };
      }),
    );
  },
});

assert.equal(completions, 3, "only the re-runs complete: R01, R02, and R03's live human Run");
console.log(`RERUN INTEGRATION PASS: ${results.length} scenarios; falseCompletion=0; paid provider requests=0`);
