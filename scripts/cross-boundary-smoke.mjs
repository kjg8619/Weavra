import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import * as NodeServices from "../app/t3code/apps/server/node_modules/@effect/platform-node/dist/NodeServices.js";
import * as Effect from "../app/t3code/apps/server/node_modules/effect/dist/Effect.js";
import * as Schedule from "../app/t3code/apps/server/node_modules/effect/dist/Schedule.js";
import * as Deferred from "../app/t3code/apps/server/node_modules/effect/dist/Deferred.js";
import * as Fiber from "../app/t3code/apps/server/node_modules/effect/dist/Fiber.js";
import { observeBridge } from "../app/t3code/apps/server/src/weavra/BridgeTransport.ts";
import { openControlTransport } from "../app/t3code/apps/server/src/weavra/ControlTransport.ts";
import { readFitness } from "../app/t3code/apps/server/src/weavra/FitnessReader.ts";
import { parseRuntimeConfig } from "../runtime/pi/packages/company-runtime/src/config.ts";
import { browserDigest } from "../runtime/pi/packages/company-runtime/src/browser-types.ts";
import { RegisteredVerifier } from "../runtime/pi/packages/company-runtime/src/verification.ts";
import { GitWorkspace } from "../runtime/pi/packages/company-runtime/src/workspace.ts";
import { buildTaskContract } from "../runtime/pi/packages/company-runtime/src/task-contract.ts";

const exec = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.env.T3_WEAVRA_EXECUTABLE;
assert.equal(executable, join(root, "runtime/pi/packages/company-runtime/bin/weavra"));
const chromium = process.env.WEAVRA_CHROMIUM;
assert.ok(chromium, "WEAVRA_CHROMIUM must identify an actual Chromium executable");
const project = join(process.env.HOME, "project");
await mkdir(join(project, "src"), { recursive: true });
await mkdir(join(project, ".ai"), { mode: 0o700 });
await writeFile(join(project, ".gitignore"), ".ai/\n");
await writeFile(join(project, "src/status.html"), '<p id="status">Ready</p>\n');
const git = (...args) => exec("git", ["-c", "user.name=Consolidation", "-c", "user.email=smoke@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: project });
await git("init", "-q");
await git("add", "--", ".gitignore", "src/status.html");
await git("commit", "-qm", "owned smoke project");
await exec(executable, ["setup"], { cwd: project, input: "" });
let document = "Ready";
let modelRequests = 0;
const pendingModelResponses = new Set();
const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/status") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`<html><head><title>Owned consolidation fixture</title><link rel="icon" href="data:,"></head><body><p id="status">${document}</p></body></html>`);
  } else if (request.method === "POST" && request.url === "/v1/chat/completions") {
    modelRequests++;
    request.resume();
    pendingModelResponses.add(response);
    response.on("close", () => pendingModelResponses.delete(response));
    // Deliberately pending local inference peer: cancellation must stop the actual Runtime worker.
  } else {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const configPath = join(project, ".ai/config.yaml");
const configData = {
  schemaVersion: 1,
  models: { profiles: { coding: { provider: "consolidation-local", model: "fixture" }, reasoning: { provider: "consolidation-local", model: "fixture" } } },
  runtime: { workflow: "STANDARD" },
  files: { allowed_paths: ["src"] },
  verification: { checks: [] },
};
await writeFile(configPath, JSON.stringify(configData), { mode: 0o600 });
await writeFile(join(process.env.WEAVRA_HOME, "agent/models.json"), JSON.stringify({ providers: { "consolidation-local": {
  baseUrl: `${origin}/v1`, api: "openai-completions", apiKey: "owned-loopback-fixture-not-a-secret",
  models: [{ id: "fixture", name: "Owned loopback fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32000, maxTokens: 1000 }],
} } }), { mode: 0o600 });
const childEnv = Object.fromEntries(["PATH", "HOME", "WEAVRA_HOME", "TMPDIR", "LANG", "LC_ALL"].map((key) => [key, process.env[key]]).filter(([, value]) => value !== undefined));
try {
  const observed = JSON.parse((await exec(executable, ["browser", "observe", "--url", `${origin}/status`, "--executable", chromium, "--local-test-app", "--selector", "#status", "--save-candidate", "--json"], { cwd: project })).stdout);
  assert.equal(observed.authority, "CANDIDATE_ONLY");
  assert.equal(observed.observation.target.value, "Ready");
  console.log("PASS actual isolated Chromium candidate: CANDIDATE_ONLY");
  await Effect.runPromise(Effect.gen(function* () {
    const connected = yield* Deferred.make();
    const observer = yield* observeBridge(executable, project, childEnv, null, (update) => {
      if (update.status === "CONNECTED") return Deferred.succeed(connected, update);
      return Effect.void;
    }).pipe(Effect.forkScoped);
    const observation = yield* Deferred.await(connected).pipe(Effect.timeout("20 seconds"));
    assert.equal(observation.snapshot.data.status.run, null);
    assert.equal(observation.snapshot.data.status.writerPresent, false);
    yield* Fiber.interrupt(observer);
    console.log("PASS T3 production BridgeTransport → actual executable hello/snapshot");
    const transport = yield* openControlTransport(executable, project, childEnv);
    const hello = yield* transport.exchange({ protocolVersion: 1, id: randomUUID(), type: "control.hello" });
    assert.equal(hello.success, true);
    assert.equal(hello.data.capabilities.authority, "Runtime/Kernel");
    assert.equal(hello.data.capabilities.readiness, "READY");
    const snapshot = () => transport.exchange({ protocolVersion: 1, id: randomUUID(), type: "control.snapshot" }).pipe(Effect.map((response) => {
      assert.equal(response.success, true);
      assert.equal(response.data.kind, "snapshot");
      return response.data.state;
    }));
    const mutate = (input) => snapshot().pipe(Effect.flatMap((state) => transport.exchange({ protocolVersion: 1, id: state.nextRequestId, ownerId: state.ownerId, expectedProjectRevision: state.projectRevision, ...input })));
    const registration = { candidateId: observed.candidateId, expectedCandidateDigest: observed.candidateDigest, checkId: "browser-status", origin, documentIdentity: `${origin}/status`, target: { selector: "#status" }, assertion: { type: "text_equals", expected: "Ready" }, freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 15000 } };
    const prepared = yield* mutate({ type: "browser.prepare", registration });
    assert.equal(prepared.success, true, JSON.stringify(prepared));
    assert.equal(prepared.data.kind, "browser-prepared");
    assert.equal(parseRuntimeConfig(yield* Effect.promise(() => readFile(configPath, "utf8"))).verification.checks.length, 0);
    // A new reviewed draft invalidates the old preview; no client-side digest is authoritative.
    const replacement = yield* mutate({ type: "browser.prepare", registration: { ...registration, assertion: { type: "text_contains", expected: "Ready" } } });
    assert.equal(replacement.success, true);
    const stale = yield* mutate({ type: "browser.confirm", previewId: prepared.data.preview.previewId, previewDigest: prepared.data.preview.previewDigest });
    assert.equal(stale.success, false);
    assert.equal(stale.error.code, "PLAN_NOT_FOUND");
    const registered = yield* mutate({ type: "browser.confirm", previewId: replacement.data.preview.previewId, previewDigest: replacement.data.preview.previewDigest });
    assert.equal(registered.success, true, JSON.stringify(registered));
    assert.equal(registered.data.kind, "browser-registered");
    const state = yield* snapshot();
    assert.equal(state.snapshot.status.run, null);
    assert.equal(state.snapshot.status.writerPresent, false);
    console.log("PASS T3 production ControlTransport → hello/snapshot/browser prepare/invalidation/confirm; REGISTERED, NOT VERIFIED");
    const history = yield* readFitness(executable, project, childEnv, { projectId: "consolidation", command: "list" });
    assert.equal(history.command, "list");
    assert.deepEqual(history.data.runs, []);
    console.log("PASS T3 production FitnessReader → actual read-only Runtime CLI");
    const workflowA = yield* mutate({ type: "workflow.prepare", goal: "Fix bug in status rendering" });
    assert.equal(workflowA.success, true, JSON.stringify(workflowA));
    const workflowB = yield* mutate({ type: "workflow.prepare", goal: "Fix bug in status rendering without unrelated changes" });
    assert.equal(workflowB.success, true);
    const oldPlan = yield* mutate({ type: "workflow.confirm", previewId: workflowA.data.preview.previewId, previewDigest: workflowA.data.preview.previewDigest });
    assert.equal(oldPlan.success, false);
    assert.equal(oldPlan.error.code, "PLAN_NOT_FOUND");
    const accepted = yield* mutate({ type: "workflow.confirm", previewId: workflowB.data.preview.previewId, previewDigest: workflowB.data.preview.previewDigest });
    assert.equal(accepted.success, true, JSON.stringify(accepted));
    assert.equal(accepted.data.kind, "accepted");
    const running = yield* snapshot().pipe(Effect.repeat({ until: (value) => value.snapshot.status.run?.status === "RUNNING" && value.ownedRunId !== null, schedule: Schedule.spaced("25 millis") }), Effect.timeout("20 seconds"));
    const cancelled = yield* mutate({ type: "workflow.cancel", runId: running.ownedRunId, expectedStateRevision: running.stateRevision });
    assert.equal(cancelled.success, true, JSON.stringify(cancelled));
    const final = yield* snapshot().pipe(Effect.repeat({ until: (value) => !value.busy, schedule: Schedule.spaced("25 millis") }), Effect.timeout("20 seconds"));
    assert.equal(final.snapshot.status.run.status, "CANCELLED");
    assert.equal(final.snapshot.status.writerPresent, false);
    console.log("PASS actual Runtime workflow prepare/invalidation/confirm/cancel; canonical CANCELLED, writer released");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.timeout("90 seconds")));

  const config = parseRuntimeConfig(await readFile(configPath, "utf8"));
  const runId = "consolidation-browser-proof";
  const policy = { executionMode: "EDIT", executionRunId: runId, tools: [], allowedPaths: ["src"], configDigest: browserDigest(config) };
  const intents = new Map();
  const audit = {
    prepare: async (decision) => { assert.equal(decision.decision, "ALLOW"); intents.set(decision.actionId, "PREPARED"); },
    assertWritable: async () => { assert.ok([...intents.values()].includes("PREPARED")); },
    finish: async (_runId, actionId, status) => { assert.equal(intents.get(actionId), "PREPARED"); intents.set(actionId, status); },
  };
  const workspace = await GitWorkspace.open(project, policy);
  const verifier = await RegisteredVerifier.create(config, policy, audit, workspace);
  const checks = verifier.trustRequirements.map(({ id, kind, required, trustRequired, trustRegistrationDigest, browser }) => ({ id, kind, required, trustRequired, trustRegistrationDigest, browser }));
  const task = buildTaskContract({ goal: "Verify owned local document", statements: ["The registered status is Ready"], workflow: "STANDARD", config, taskId: "consolidation-task" });
  const request = { runId, revision: 0, step: { stepId: "self-check", attempt: 1 }, task, checks, handoff: { runId, revision: 0, role: "Developer", task: task.id, summary: "Owned fixture", changed_files: [], assumptions: [], tests_run: [], known_risks: [], unresolved: [] } };
  const first = await verifier.verify(request);
  assert.equal(first.checks[0].status, "PASS", JSON.stringify(first));
  const second = await verifier.verify({ ...request, step: { stepId: "test", attempt: 1 } });
  assert.equal(second.checks[0].status, "PASS", JSON.stringify(second));
  assert.notEqual(first.checks[0].browser.captureId, second.checks[0].browser.captureId);
  document = "Broken";
  const broken = await verifier.verify({ ...request, step: { stepId: "test", attempt: 2 } });
  assert.equal(broken.checks[0].status, "FAIL", JSON.stringify(broken));
  assert.notEqual(broken.checks[0].browser.captureId, observed.candidateId);
  assert.equal(verifier.safeToRelease, true);
  assert.ok([...intents.values()].every((status) => status !== "PREPARED"));
  console.log("PASS RegisteredVerifier actual Chromium fresh self-check/test captures; retained Ready candidate + fresh Broken = FAIL");
  console.log(`CROSS-BOUNDARY PASS; paid provider requests=0; owned pending loopback requests=${modelRequests}`);
} finally {
  for (const response of pendingModelResponses) response.destroy();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
