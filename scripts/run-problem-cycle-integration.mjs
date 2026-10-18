#!/usr/bin/env node
// Run from the product root with Node >=24:
// WEAVRA_CHROMIUM=/owned/chromium node scripts/run-problem-cycle-integration.mjs \
//   --evidence-dir=/owned/evidence/task8 [--interactive]
// --case=<group-id> runs a focused diagnostic; it cannot report full corpus PASS.
// Default evidence: ./artifacts/problem-cycle/task-8-corpus.json. Use a NEW
// --evidence-dir per invocation; existing reports are never overwritten. No installs or
// builds are performed. Prerequisites: Runtime npm build/offline data snapshot,
// Exception: explicitly selected ordinary-qa-tool-access/device-enabled-inventory
// opts the disposable environment into its existing pinned Device toolchain.
// App pnpm11 dependencies and current App web build, git, owned Chromium.
// --interactive leaves the NORMAL case's actual App/browser open until ENTER,
// then still runs every case and requires all cleanup receipts. No paid models.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { watch } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { startScriptedModel } from "./scripted-model-server.mjs";
import { bounded, Events, openBrowser } from "./problem-cycle-browser.mjs";
import { parseRuntimeConfig } from "../runtime/pi/packages/company-runtime/src/config.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "app/t3code");
const runtime = join(root, "runtime/pi/packages/company-runtime/bin/weavra");
const peers = join(root, "scripts/problem-cycle-peers.mjs");
const args = process.argv.slice(2);
assert.ok(args.every((a) => a === "--interactive" || a.startsWith("--evidence-dir=") || a.startsWith("--case=") || a.startsWith("--attempt=")), "Unknown argument");
const interactive = args.includes("--interactive");
const selectedCase = args.find((a) => a.startsWith("--case="))?.slice(7);
const selectedAttempt = args.find((a) => a.startsWith("--attempt="))?.slice(10);
assert.ok(selectedAttempt === undefined || selectedCase !== undefined, "--attempt requires --case");
const evidenceDir = resolve(args.find((a) => a.startsWith("--evidence-dir="))?.slice(15) ?? join(root, "artifacts/problem-cycle"));
const reportPath = join(evidenceDir, "task-8-corpus.json");
const node = process.execPath;
const exec = promisify(execFile);
const digest = (data) => `sha256:${createHash("sha256").update(data).digest("hex")}`;
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const exists = (path) => access(path).then(() => true, (e) => { if (e.code === "ENOENT") return false; throw e; });
const terminal = (status) => ["COMPLETED", "FAILED", "BLOCKED", "CANCELLED", "INTERRUPTED"].includes(status);
const effectPath = join(app, "packages/contracts/node_modules/effect/dist");
const [Effect, Fiber, Layer, Stream] = await Promise.all(
  ["Effect", "Fiber", "Layer", "Stream"].map((n) => import(`${effectPath}/${n}.js`)),
);
const [{ RpcClient, RpcSerialization }, Socket, NodeSocket, C, fixtureModule] = await Promise.all([
  import(`${effectPath}/unstable/rpc/index.js`), import(`${effectPath}/unstable/socket/Socket.js`),
  import(`${app}/apps/server/node_modules/@effect/platform-node/dist/NodeSocket.js`),
  import(`${app}/packages/contracts/src/index.ts`),
  import(`${root}/runtime/pi/packages/evals/src/weavra-fixtures.ts`),
]);
const fixture = fixtureModule.WEAVRA_EVAL_FIXTURES.find((f) => f.id === "standard-2ac");
assert.ok(fixture);
const sourcePath = "src/greeting.js";
const original = fixture.files[sourcePath];
const fixed = original.replace("Helo,", "Hello,");
assert.notEqual(fixed, original);
const correction = "src/greeting.js contains Helo instead of Hello; locale is not the cause";
let interrupted = false;
const activeFixtures = new Set();
for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => {
  interrupted = true; process.exitCode = 1;
  for (const f of activeFixtures) {
    f.held?.resolve();
    for (const pid of [f.server ? -f.server.pid : null, f.browser?.pid ?? null]) if (pid !== null) {
      try { process.kill(pid, "SIGTERM"); } catch (e) { if (e.code !== "ESRCH") f.row.signalCleanupFailed = true; }
    }
  }
});
const corpus = { schemaVersion: 1, authority: "actual App / Runtime / Kernel", syntheticModel: true,
  selection: selectedCase ?? null, attemptSelection: selectedAttempt ?? null, fullCorpus: selectedCase === undefined,
  realModelQualityClaim: false, startedAt: new Date().toISOString(), verdict: "FAIL", cases: [], cleanup: [],
  limitations: ["Scripted worker/reviewer output proves mechanism, not model quality.",
    "Crash cuts use test-only post-rename barriers; no power-loss durability claim.",
    "Legacy test strips capability advertisement only; it is not an old Runtime binary."],
};
await mkdir(evidenceDir, { recursive: true });
const save = () => writeFile(reportPath, `${JSON.stringify(corpus, null, 2)}\n`, { mode: 0o600 });
// Reserve this invocation's report before starting any owned process. Prior
// failed attempts remain immutable; rerun with a fresh evidence directory.
await writeFile(reportPath, `${JSON.stringify(corpus, null, 2)}\n`, { mode: 0o600, flag: "wx" });
const stagedBefore = (await exec("git", ["diff", "--cached", "--name-only"], { cwd: root })).stdout;
corpus.noStagedFiles = stagedBefore.trim() === "";
const sourceBefore = (await exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root })).stdout;

function identity(task) {
  const receipt = task.execution?.receipt;
  return { environmentId: task.environmentId, projectId: task.projectId, threadId: task.threadId,
    taskId: task.id, taskRevision: task.revision, phase: task.phase, ownership: task.ownership,
    checkout: task.checkout, executionId: task.execution?.binding.executionId ?? null,
    runId: receipt?.status === "FOUND" ? receipt.run?.runId ?? null : null,
    runRevision: receipt?.status === "FOUND" ? receipt.run?.revision ?? null : null,
    runStatus: receipt?.status === "FOUND" ? receipt.run?.status ?? null : null,
    admission: receipt?.status === "FOUND" ? receipt.admission.outcome : null,
    symptomVerification: task.execution?.binding.symptomVerification ?? null };
}
async function token(origin, bootstrap, scope) {
  const response = await fetch(`${origin}/oauth/token`, { method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: C.AuthTokenExchangeGrantType, subject_token: bootstrap,
      subject_token_type: C.AuthEnvironmentBootstrapTokenType, requested_token_type: C.AuthAccessTokenType, scope }),
    signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, "Authenticated token exchange");
  return (await response.json()).access_token;
}
async function mintPairing(f) {
  const result = await exec(node, [join(app, "apps/server/src/bin.ts"), "pair", "--base-dir", f.appHome,
    "--label", "task8-owned-client"], { cwd: f.target, env: f.env, timeout: 30_000 });
  const url = result.stdout.match(/^Pairing URL: (.+)$/m)?.[1]?.trim();
  assert.ok(url); assert.equal(new URL(url).hostname, "127.0.0.1");
  return url;
}
async function connect(f, use, scope = "orchestration:read orchestration:operate terminal:operate") {
  // Static Web mode intentionally ignores dev-auth env. Use a fresh real pairing
  // credential per connection, including the narrowly scoped negative client.
  const pairing = new URL(await mintPairing(f));
  const bootstrap = new URLSearchParams(pairing.hash.slice(1)).get("token");
  assert.ok(bootstrap);
  const bearer = await token(f.origin, bootstrap, scope);
  const response = await fetch(`${f.origin}/api/auth/websocket-ticket`, { method: "POST",
    headers: { authorization: `Bearer ${bearer}` }, signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, "Authenticated WS ticket");
  const url = `${f.origin.replace("http:", "ws:")}/ws?wsTicket=${encodeURIComponent((await response.json()).ticket)}`;
  const constructor = NodeSocket.layerWebSocketConstructor;
  const layer = RpcClient.layerProtocolSocket().pipe(
    Layer.provide(Socket.layerWebSocket(url).pipe(Layer.provide(constructor))),
    Layer.provide(RpcSerialization.layerJson),
  );
  return Effect.runPromise(RpcClient.make(C.WsRpcGroup).pipe(
    Effect.flatMap((client) => Effect.tryPromise({ try: () => use(client), catch: (error) => error })),
    Effect.provide(layer), Effect.scoped,
  ));
}
const rpc = (client, method, input) => Effect.runPromise(client[method](input).pipe(Effect.timeout("60 seconds")));
async function refused(client, method, input, codes) {
  const result = await Effect.runPromise(client[method](input).pipe(Effect.timeout("30 seconds"), Effect.result));
  assert.equal(result._tag, "Failure", `Expected rejection: ${method}`);
  const code = result.failure.code ?? result.failure._tag;
  if (codes) assert.ok(codes.includes(code), `Unexpected rejection category for ${method}: ${code}`);
  return code;
}
async function subscription(f, stream, ready) {
  const feed = new Events();
  const synchronized = feed.wait(ready, "subscription ready", 0);
  const fiber = Effect.runFork(stream.pipe(Stream.runForEach((event) => Effect.sync(() => feed.emit(event)))));
  f.fibers.push(fiber);
  await synchronized;
  return feed;
}

async function makeFixture(label, options, row) {
  const base = await realpath(await mkdtemp(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "w8-")));
  const f = { base, target: join(base, "target"), other: join(base, "other"), home: join(base, "home"),
    appHome: join(base, "app"), bin: join(base, "bin"), fibers: [], children: [], events: new Events(),
    logs: new Events(), arm: null, dropExecution: null, browser: null, servers: [], row, options,
    workerRequests: [], held: null };
  f.env = { PATH: `${f.bin}:${dirname(node)}:${process.env.PATH}`, HOME: f.home,
    TMPDIR: base, WEAVRA_HOME: join(f.home, ".weavra"), CODEX_HOME: join(f.home, ".codex"),
    LANG: "C", LC_ALL: "C", NO_COLOR: "1", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", PI_NO_LOCAL_LLM: "1", AWS_EC2_METADATA_DISABLED: "true" };
  f.git = async (...args) => (await exec("git", ["-c", "user.name=Task8", "-c", "user.email=task8@example.invalid",
    "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args],
    { cwd: f.target, env: f.env, timeout: 20_000 })).stdout;
  f.files = async () => {
    const paths = [...Object.keys(fixture.files), ".gitignore", "package.json"];
    return { head: (await f.git("rev-parse", "HEAD")).trim(),
      status: await f.git("status", "--porcelain=v1", "--untracked-files=all"),
      files: Object.fromEntries(await Promise.all(paths.map(async (p) => [p, digest(await readFile(join(f.target, p)))]))),
      otherSource: digest(await readFile(join(f.other, sourcePath))),
      config: options.projectSetup && !(await exists(join(f.target, ".ai/config.yaml")))
        ? null : digest(await readFile(join(f.target, ".ai/config.yaml"))) };
  };
  f.readState = async () => exists(join(f.target, ".ai/state.json")).then(async (yes) =>
    yes ? JSON.parse(await readFile(join(f.target, ".ai/state.json"), "utf8")) : null);
  f.remember = (task) => {
    f.task = task; row.identities.push(identity(task));
    if (row.baseline && task.execution?.binding.symptomVerification)
      row.baseline.frozenSymptomBinding ??= task.execution.binding.symptomVerification;
    return task;
  };
  f.ref = (task = f.task) => ({ ...f.scope, taskId: task.id });
  f.read = (client) => rpc(client, C.WS_METHODS.weavraTaskRead, f.ref()).then(f.remember);
  f.create = (client) => rpc(client, C.WS_METHODS.weavraTaskCreate,
    { ...f.scope, commandId: randomUUID() }).then(f.remember);
  f.draft = () => ({ goal: fixture.goal, acceptanceStatements: fixture.statements,
    symptomVerification: { criterionIndex: 1, checkId: "eval" }, context: {
      version: 1, packetVersion: 1, authority: "ADVISORY_ONLY", reviewedAt: Date.now(),
      symptom: "greet(Ada) returns Helo, Ada! instead of Hello, Ada!; unchanged node --test test/eval.test.mjs failed.",
      observations: [{ text: "The pre-change registered command failed the greets Ada assertion.",
        provenance: "HOST_OBSERVATION", reference: { kind: "source", path: sourcePath } },
        ...(f.correctedMessage ? [{ text: `Corrected hypothesis: ${correction}.`, provenance: "MODEL",
          reference: { kind: "message", threadId: f.scope.threadId, messageId: f.correctedMessage } }] : [])],
      candidateCause: { kind: "HYPOTHESIS", text: correction }, uncertainties: ["Runtime must independently re-read and verify."],
      sourceReferences: [{ path: sourcePath, digest: digest(original) }],
      constraints: ["Only src/greeting.js may change; preserve greet(name) and punctuation."] } });
  f.prepare = (client, draft = f.draft()) => rpc(client, C.WS_METHODS.weavraTaskPrepare,
    { task: f.ref(), expectedRevision: f.task.revision, draft }).then(f.remember);
  f.confirmInput = () => ({ task: f.ref(), expectedRevision: f.task.revision, commandId: randomUUID() });
  f.confirm = (client) => rpc(client, C.WS_METHODS.weavraTaskConfirm, f.confirmInput()).then(f.remember);
  f.reconcile = (client) => rpc(client, C.WS_METHODS.weavraTaskReconcile, f.ref()).then(f.remember);
  f.observe = (client) => subscription(f, client[C.WS_METHODS.weavraControlObserve]({ projectId: f.scope.projectId }),
    (o) => !o.stale && o.status === "CONNECTED");
  f.complete = async (client, feed, trigger) => {
    const settled = feed.wait((o) => !o.stale && terminal(o.state?.snapshot.status.run?.status) &&
      !o.state.busy && !o.state.snapshot.status.writerPresent, "Runtime terminal AND writer cleanup");
    await trigger();
    const observed = await settled;
    const task = f.row.id === "normal-success"
      ? f.remember((await f.taskFeed.wait((event) =>
          event.kind === "update" && event.task.ownership.state === "released",
          "automatic canonical task completion", 0)).task)
      : await f.reconcile(client);
    assert.equal(task.ownership.state, "released");
    assert.equal(task.execution.receipt.run.runId, observed.state.snapshot.status.run.runId);
    return task;
  };
  f.noRun = async () => {
    const state = await f.readState();
    assert.equal(state?.runs.length ?? 0, 0, "Unexpected Run");
    assert.equal(state?.taskAdmissions?.length ?? 0, 0, "Unexpected admission");
    assert.equal(f.workerRequests.length, 0, "Unexpected worker");
    assert.equal(await exists(join(f.other, ".ai/state.json")), false, "Other checkout acquired canonical state");
  };
  f.stop = async (signal = "SIGTERM") => {
    for (const fiber of f.fibers.splice(0)) await Effect.runPromise(Fiber.interrupt(fiber));
    if (!f.server) return;
    const child = f.server;
    if (child.exitCode === null && child.signalCode === null) {
      process.kill(-child.pid, signal);
      await bounded(child.closed, "owned App group closed", 20_000).catch(async (e) => {
        try { process.kill(-child.pid, "SIGKILL"); } catch (k) { if (k.code !== "ESRCH") throw k; }
        await bounded(child.closed, "forced App group closed", 10_000); throw e;
      });
    }
    f.server = null;
    row.cleanup.push({ appPid: child.pid, signal, closed: true });
  };
  f.start = async (restart = false) => {
    const ready = f.logs.wait((s) => s.includes("Listening on http://"), "App listener ready");
    const child = spawn(node, [join(app, "apps/server/src/bin.ts"), "--mode", "web", "--port", String(f.port),
      "--host", "127.0.0.1", "--base-dir", f.appHome, "--no-browser", f.target],
      { cwd: f.target, env: { ...f.env,
        T3_WEAVRA_CONTROL: "1", T3_WEAVRA_EXECUTABLE: f.runtimeWrapper, T3CODE_LOG_LEVEL: "Debug" },
        detached: true, stdio: ["ignore", "pipe", "pipe"] });
    child.closed = new Promise((res, rej) => { child.once("close", res); child.once("error", rej); });
    f.children.push(child); f.server = child;
    let output = "";
    const onData = (chunk) => { output = (output + chunk).slice(-64_000); f.logs.emit(output); };
    child.stdout.on("data", onData); child.stderr.on("data", onData);
    await Promise.race([ready, child.closed.then(() => { throw new Error("App stopped before readiness"); })]);
    const descriptorResponse = await fetch(`${f.origin}/.well-known/t3/environment`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(descriptorResponse.status, 200);
    const descriptor = await descriptorResponse.json();
    if (restart) assert.equal(descriptor.environmentId, f.scope.environmentId);
    else f.environmentId = descriptor.environmentId;
    assert.equal(descriptor.capabilities.weavraTaskAnalysis, "codex-read-only-v1");
  };
  f.close = async () => {
    const failures = f.row.signalCleanupFailed ? ["signal-cleanup"] : [];
    const cleanup = async (name, fn) => { try { await fn(); } catch { failures.push(name); } };
    await cleanup("browser", async () => { if (f.browser) row.cleanup.push({ browser: await f.browser.stop() }); });
    f.held?.resolve();
    await cleanup("app", () => f.stop());
    await cleanup("model", async () => { if (f.model) await bounded(f.model.close(), "model close", 10_000); });
    // Assert every captured Runtime is gone; never scan or kill unrelated PIDs.
    await cleanup("runtime-pids", async () => {
      const pids = [...new Set(f.events.rows.filter((e) => e.kind === "runtime-start").map((e) => e.pid))];
      for (const pid of pids) {
        let alive = false;
        try { process.kill(pid, 0); alive = true; } catch (e) { if (e.code !== "ESRCH") throw e; }
        assert.equal(alive, false, `Owned Runtime still live: ${pid}`);
      }
      row.cleanup.push({ runtimePids: pids, allExited: true });
    });
    await cleanup("canonical-records", async () => {
      const state = await f.readState();
      row.canonical = { projectRevision: state?.revision ?? null,
        admissions: (state?.taskAdmissions ?? []).map((a) => ({ taskId: a.metadata.binding.taskId,
          executionId: a.metadata.binding.executionId, outcome: a.outcome, cleanup: a.cleanup })),
        runs: (state?.runs ?? []).map((r) => ({ runId: r.runId, revision: r.revision, status: r.status,
          codeRevision: r.revisionCycle, roleSessions: r.roleSessionRefs.map((s) => ({ role: s.role, sessionId: s.sessionId })),
          checks: r.verification.map((v) => ({ revision: v.revision, step: v.step, status: v.status,
            diffDigest: v.diffDigest, evidenceRefs: v.evidenceRefs })),
          reviews: [...(r.reviewHistory ?? []), ...(r.review ? [r.review] : [])]
            .map((v) => ({ revision: v.revision, result: v.result, diffDigest: v.diffDigest })) })),
        policy: (state?.actions ?? []).map((a) => ({ status: a.status, runId: a.decision.runId,
          actionId: a.decision.actionId, role: a.decision.role, decision: a.decision.decision })),
        writerPresent: await exists(join(f.target, ".ai/writer.lock")) };
      row.transportCounts = Object.fromEntries([...new Set(f.events.rows.filter((e) => e.kind === "request").map((e) => e.type))]
        .map((type) => [type, f.events.rows.filter((e) => e.kind === "request" && e.type === type).length]));
      row.workerRequests = f.workerRequests;
      if (options.qaRole) {
        row.qaProtocolMethods = f.events.rows.filter(event => event.kind === "qa-request")
          .map(event => event.method);
        row.qaUnsupportedMethods = f.events.rows.filter(event => event.kind === "qa-unsupported")
          .map(event => event.method);
      }
      if (await exists(join(f.other, sourcePath))) {
        row.finalFiles = await f.files();
        if (f.expectedFiles) assert.deepEqual(row.finalFiles, f.expectedFiles, "No late writes during teardown");
      }
      if (options.mode) assert.ok(row.canonical.runs.every((r) => r.status !== "COMPLETED"), "Negative worker must never complete");
    });
    await cleanup("broker", async () => { if (f.broker) {
      f.broker.closeAllConnections();
      await bounded(new Promise((res, rej) => f.broker.close((e) => e ? rej(e) : res())), "broker close");
    } });
    // Failed records have already been projected above; no raw sessions/prompts
    // are copied out of the private homes. A cleanup error is never a skip.
    if (failures.length === 0)
      await cleanup("fixture-remove", () => rm(base, { recursive: true, force: false }));
    row.cleanup.push({ fixtureRemoved: !(await exists(base)),
      ...(failures.length ? { retainedFixture: base } : {}), failures });
    activeFixtures.delete(f);
    assert.deepEqual(failures, [], "Fixture cleanup must succeed");
  };
  activeFixtures.add(f);
  try {
    for (const dir of [f.home, f.appHome, f.bin, f.target]) await mkdir(dir, { mode: 0o700 });
    row.stage = "broker-setup";
    f.broker = createServer(async (req, res) => {
      try {
        assert.equal(req.method, "POST"); assert.equal(req.url, "/event");
        let text = ""; for await (const chunk of req) { text += chunk; assert.ok(text.length < 65536); }
        const event = JSON.parse(text);
        if (event.kind === "qa-credential") {
          assert.equal(options.qaRole, true, "Analysis fixtures cannot export MCP credentials");
          f.qaCredential = { endpoint: event.endpoint, authorizationHeader: event.authorizationHeader };
          f.events.emit({ kind: "qa-ready" });
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ drop: false }));
          return;
        }
        f.events.emit(event);
        const admission = event.kind === "persisted" && event.admissions.find((a) =>
          a.taskId === f.arm?.taskId && a.executionId === f.arm?.executionId);
        const matches = admission && event.cwd === f.target &&
          ((f.arm.phase === "before-run" && admission.outcome.status === "ACCEPTED" && event.runs.length === 0) ||
           (f.arm.phase === "after-run" && admission.outcome.status === "STARTED" &&
             event.runs.some((r) => r.runId === admission.outcome.runId)));
        if (matches) {
          f.arm = null; // one-shot, disarmed before publishing the barrier
          f.events.emit({ ...event, kind: "persistence-barrier" });
          // Hold the real rename promise until the owning process is killed.
          // Socket closes release this response; nothing touches disk here.
          return;
        }
        const drop = event.kind === "response" && event.type === "workflow.confirm" &&
          event.executionId !== null && event.executionId === f.dropExecution && event.success;
        if (drop) f.dropExecution = null;
        res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ drop }));
      } catch { res.writeHead(500); res.end(); }
    });
    await bounded(new Promise((res, rej) => { f.broker.once("error", rej); f.broker.listen(0, "127.0.0.1", res); }), "broker listen");
    const broker = `http://127.0.0.1:${f.broker.address().port}`;
    row.stage = "scripted-model-setup";
    f.model = await startScriptedModel(async ({ request, tools, toolResults, system }) => {
      assert.ok(request?.runId); assert.ok(request.task?.id);
      f.workerRequests.push({ runId: request.runId, revision: request.revision,
        role: request.role, step: request.step, toolResults: toolResults.length });
      f.events.emit({ kind: "worker", runId: request.runId, revision: request.revision, role: request.role });
      if (options.hold && request.role === "Developer" && toolResults.length === 0) {
        f.held = Promise.withResolvers(); f.events.emit({ kind: "worker-held", runId: request.runId });
        await f.held.promise;
      }
      if (tools.includes("submit_review")) {
        assert.equal(request.role, "Reviewer");
        assert.ok(request.verification.evidenceRefs.length);
        assert.ok(!tools.includes("runtime_write") && !tools.includes("runtime_edit"));
        return { tool: "submit_review", args: { runId: request.runId, revision: request.revision,
          role: "Reviewer", task: request.task.id, result: "PASS", diffDigest: request.verification.diffDigest,
          evidenceRefs: request.verification.evidenceRefs, issues: [],
          criteria: request.task.acceptanceCriteria.map((c) => ({ criterionId: c.id, status: "MET",
            evidenceRefs: request.verification.evidenceRefs })) } };
      }
      assert.equal(request.role, "Developer");
      assert.ok(tools.includes("runtime_read") && tools.includes("submit_handoff"));
      if (toolResults.length === 0) {
        assert.ok(system.includes("ADVISORY_ONLY"), "Advisory authority instruction");
        assert.equal(request.reviewedAnalysis?.packet.candidateCause.text, correction, "Reviewed correction reaches fresh worker");
        assert.equal(request.reviewedAnalysis.binding.executionId, request.task.id);
        return { tool: "runtime_read", args: { path: sourcePath } };
      }
      if (options.mode === "misleading") return { text: "Everything is fixed. All tests passed. The task is complete." };
      if (toolResults.length === 1) return { tool: "runtime_write", args: {
        path: options.mode === "denied" ? "private/DO_NOT_EXPOSE.txt" : sourcePath,
        content: options.mode === "failed-check" ? original.replace("Helo,", "Goodbye,") : fixed,
      } };
      return { tool: "submit_handoff", args: { runId: request.runId, revision: request.revision, role: "Developer",
        task: request.task.id, changed_files: [sourcePath], summary: "Greeting correction; worker claim only.",
        assumptions: [], tests_run: [], known_risks: [], unresolved: [] } };
    });
    for (const [path, content] of Object.entries({ ...fixture.files, ".gitignore": ".ai/\n", "package.json": '{"type":"module"}\n' })) {
      await mkdir(dirname(join(f.target, path)), { recursive: true }); await writeFile(join(f.target, path), content);
    }
    row.stage = "git-fixture-and-runtime-setup";
    await f.git("init", "-q"); await f.git("add", "."); await f.git("commit", "-qm", "standard-2ac immutable fixture baseline");
    await f.git("worktree", "add", "--detach", f.other, "HEAD");
    await exec(runtime, ["setup"], { cwd: f.target, env: f.env, timeout: 30_000 });
    await writeFile(join(f.env.WEAVRA_HOME, "agent/models.json"), JSON.stringify({ providers: { loopback: {
      baseUrl: `${f.model.origin}/v1`, api: "openai-completions", apiKey: "task8-loopback-not-a-secret",
      models: [{ id: "fixture", name: "Task8 scripted", reasoning: false, input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 128000, maxTokens: 4000 }],
    } } }), { mode: 0o600 });
    f.config = { schemaVersion: 1, models: { profiles: {
      coding: { provider: "loopback", model: "fixture" }, reasoning: { provider: "loopback", model: "fixture" },
    } }, runtime: { workflow: "STANDARD" }, agents: { max_revision_cycles: 0 }, files: { allowed_paths: fixture.allowedPaths },
      verification: { trust: { mode: "strict" }, checks: [{ id: "eval", kind: "test", executable: node,
        args: ["--test", "test/eval.test.mjs"], cwd: ".", required: true, timeout_ms: 10_000,
        trust: { files: ["test/eval.test.mjs"] } }] } };
    if (options.evidencePages) {
      const check = f.config.verification.checks[0];
      f.config.verification.checks = Array.from({ length: 26 }, (_, index) => ({
        ...check, id: index === 0 ? check.id : `eval-${index + 1}`,
      }));
    }
    for (const cwd of [f.target, f.other]) {
      await mkdir(join(cwd, ".ai"), { recursive: true });
      await writeFile(join(cwd, ".ai/config.yaml"), JSON.stringify(f.config), { mode: 0o600 });
    }
    // Reuse the exact eval registered executable/argv, not a surrogate oracle.
    row.stage = "unchanged-symptom-failure";
    let baseline;
    try { await exec(node, ["--test", "test/eval.test.mjs"], { cwd: f.target, env: f.env, timeout: 15_000 }); }
    catch (e) { baseline = e; }
    assert.equal(baseline?.code, 1, "Unchanged symptom must FAIL, not setup timeout");
    assert.match(baseline.stdout, /code: 'ERR_ASSERTION'/);
    assert.match(baseline.stdout, /actual: 'Helo, Ada!'/);
    assert.match(baseline.stdout, /expected: 'Hello, Ada!'/);
    assert.match(baseline.stdout, /\bfail 1\b/);
    assert.equal((await f.git("status", "--porcelain=v1")).trim(), "");
    row.baseline = { fixtureId: fixture.id, executable: node, args: f.config.verification.checks[0].args,
      exitCode: 1, symptomAssertionFailed: true, oracleDigest: digest(fixture.files["test/eval.test.mjs"]), sourceDigest: digest(original) };
    f.before = await f.files(); row.baselineFiles = f.before;
    f.peerConfig = join(base, "peer.json");
    await writeFile(f.peerConfig, JSON.stringify({ broker, runtime, cwd: f.target,
      legacy: options.legacy === true, instrument: true,
      qaControlDraft: options.chatControlDraft === true,
      presetModels: options.projectPresets === true }), { mode: 0o600 });
    f.runtimeWrapper = join(f.bin, "runtime");
    f.codex = join(f.bin, "codex");
    await writeFile(f.runtimeWrapper, `#!/bin/sh\nexec ${[node, peers, "--relay", f.peerConfig].map(quote).join(" ")} "$@"\n`, { mode: 0o700 });
    // Project setup uses the actual fixed launcher with raw reviewed YAML stdin, not the control JSON relay.
    if (options.projectSetup) f.runtimeWrapper = runtime;
    await writeFile(f.codex, `#!/bin/sh\nexec ${[node, peers, options.qaRole ? "--codex-qa" : "--codex", f.peerConfig].map(quote).join(" ")} "$@"\n`, { mode: 0o700 });
    const portServer = createServer();
    await new Promise((res, rej) => { portServer.once("error", rej); portServer.listen(0, "127.0.0.1", res); });
    f.port = portServer.address().port;
    await new Promise((res, rej) => portServer.close((e) => e ? rej(e) : res()));
    f.origin = `http://127.0.0.1:${f.port}`;
    row.stage = "app-startup";
    assert.equal(interrupted, false, "Corpus interrupted before App startup");
    await f.start();
    row.stage = "authenticated-two-thread-bootstrap";
    await connect(f, async (client) => {
      const shell = await subscription(f, client[C.ORCHESTRATION_WS_METHODS.subscribeShell]({ requestCompletionMarker: true }), (e) => e.kind === "synchronized");
      const snapshot = shell.rows.find((e) => e.kind === "snapshot").snapshot;
      const project = snapshot.projects.find((p) => p.workspaceRoot === f.target);
      assert.ok(project);
      f.thread = snapshot.threads.find((t) => t.projectId === project.id); assert.ok(f.thread);
      f.scope = { environmentId: f.environmentId, projectId: project.id, threadId: f.thread.id };
      f.otherThread = randomUUID();
      row.fixture = { ...f.scope, otherThreadId: f.otherThread, canonicalCwd: f.target,
        otherCheckout: f.other, otherHead: (await f.git("-C", f.other, "rev-parse", "HEAD")).trim(),
        secondThreadUsesSameCheckout: options.sharedCheckout === true };
      const created = shell.wait((e) => e.kind === "thread-upserted" && e.thread.id === f.otherThread, "second thread created");
      await rpc(client, C.ORCHESTRATION_WS_METHODS.dispatchCommand, { type: "thread.create", commandId: randomUUID(),
        threadId: f.otherThread, projectId: project.id, title: "Task8 second thread", modelSelection: f.thread.modelSelection,
        runtimeMode: f.thread.runtimeMode, interactionMode: "default", branch: null,
        worktreePath: options.sharedCheckout ? null : f.other, createdAt: new Date().toISOString() });
      await created;
      await rpc(client, C.WS_METHODS.serverUpdateSettings, { patch: { providers: { codex: { binaryPath: f.codex } } } });
      await rpc(client, C.WS_METHODS.serverRefreshProviders, { instanceId: f.thread.modelSelection.instanceId,
        cwd: f.target, refreshModels: true });
    });
    return f;
  } catch (error) { await f.close(); throw error; }
}

async function evidence(f, client) {
  const receipt = f.task.execution.receipt;
  assert.equal(receipt.status, "FOUND"); assert.ok(receipt.run);
  const pages = [], records = []; let snapshot = null;
  for (const category of ["criteria", "checks", "changed-files", "trust-sources"]) {
    let cursor = { category, index: 0 };
    for (let n = 0; cursor !== null; n++) {
      assert.ok(n < 20, "Bounded evidence pagination");
      const page = await rpc(client, C.WS_METHODS.weavraTaskEvidence, { task: f.ref(), revision: receipt.run.revision,
        diffDigest: snapshot?.diffDigest ?? null, cursor });
      assert.equal(page.kind, "evidence-details", "Evidence unavailable is not success");
      if (snapshot) assert.deepEqual(page.snapshot, snapshot); else snapshot = page.snapshot;
      assert.equal(snapshot.executionId, receipt.executionId);
      assert.equal(snapshot.runId, receipt.run.runId); assert.equal(snapshot.revision, receipt.run.revision);
      assert.equal(Buffer.byteLength(JSON.stringify(page)) <= 65536, true);
      pages.push(page); records.push(...page.records); cursor = page.nextCursor;
    }
  }
  f.row.evidence = { snapshot, pages, records }; return f.row.evidence;
}
function assertSuccess(f, value) {
  const binding = f.task.execution.binding.symptomVerification;
  assert.equal(f.task.execution.receipt.run.status, "COMPLETED");
  assert.ok(binding); assert.deepEqual(value.pages[0].symptomVerification, binding);
  const criteria = value.records.filter((r) => r.category === "criteria");
  assert.equal(criteria.length, 2);
  assert.ok(criteria.every((r) => r.status === "MET"));
  assert.ok(criteria.some((r) => r.id === binding.criterionId));
  const final = value.records.filter((r) => r.category === "checks" && r.step === "test" && r.id === binding.checkId).at(-1);
  assert.ok(final); assert.equal(final.status, "PASS"); assert.equal(final.required, true);
  assert.equal(final.exitCode, 0); assert.equal(final.revision, value.pages[0].codeRevision);
  assert.equal(final.diffDigest, value.snapshot.diffDigest);
  assert.equal(final.trust.mode, "strict"); assert.equal(final.trust.status, "VERIFIED");
  assert.equal(final.trust.registrationDigest, binding.registrationDigest);
  assert.deepEqual(value.pages[0].review, { result: "PASS", independent: true,
    revision: final.revision, diffDigest: final.diffDigest, criteriaCount: 2 });
  assert.ok(value.records.some((r) => r.category === "checks" && r.step === "self-check" && r.status === "PASS"));
  assert.deepEqual(value.records.filter((r) => r.category === "changed-files").map((r) => r.path), [sourcePath]);
  assert.ok(f.workerRequests.some((r) => r.role === "Developer"));
  assert.ok(f.workerRequests.some((r) => r.role === "Reviewer"));
}

async function analyze(f, client) {
  const thread = await subscription(f, client[C.ORCHESTRATION_WS_METHODS.subscribeThread]({
    threadId: f.scope.threadId, requestCompletionMarker: true }), (e) => e.kind === "synchronized");
  for (const [index, prefix] of ["Early hypothesis:", "Corrected hypothesis:"].entries()) {
    const visible = thread.wait((e) => e.kind === "event" && e.event.type === "thread.message-sent" &&
      e.event.payload.role === "assistant" && e.event.payload.text.startsWith(prefix), "exact visible analysis reply");
    await rpc(client, C.WS_METHODS.weavraTaskAnalyze, { task: f.ref(), expectedRevision: f.task.revision,
      commandId: randomUUID(), messageId: randomUUID(), text: index === 0
        ? "Analyze the observed greeting failure without editing." : "Review the original hypothesis against the greeting source and the failing assertion; correct the reviewed cause." });
    const message = (await visible).event.payload;
    if (index === 1) {
      f.correctedMessage = message.messageId;
      f.correctedText = message.text;
    }
    if (f.browser) {
      f.row.stage = `analysis-message-registered-${index + 1}`;
      try {
        await (await f.browser.arm(`() => [...document.querySelectorAll('option')]
          .some(option => option.value === ${JSON.stringify(message.messageId)})`))();
        const preview = await f.browser.evaluate(`(() => {
          const option = [...document.querySelectorAll('option')]
            .find(element => element.value === ${JSON.stringify(message.messageId)});
          return option.textContent.trim();
        })()`);
        assert.ok(preview.includes(prefix), "Source option must expose readable message content");
        assert.ok(Array.from(preview).length <= 135, "Source preview must be bounded");
        f.row.sourcePreviews ??= [];
        f.row.sourcePreviews.push({ messageId: message.messageId, preview });
        f.row.stage = `analysis-visible-${index + 1}`;
        const readerReady = await f.browser.arm(`() => [...document.querySelectorAll('summary')]
          .some(summary => summary.dataset.weavra === 'read-selected-message')`);
        await f.browser.evaluate(`(() => {
          const select = [...document.querySelectorAll('select')].find(element =>
            [...element.options].some(option => option.value === ${JSON.stringify(message.messageId)}));
          if (!select) throw new Error('Exact message source selector absent');
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(message.messageId)});
          select.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await readerReady();
        assert.equal(await f.browser.evaluate(`document.querySelector('[id$="-excerpt"]').value`), "",
          "Selecting a source must not choose an excerpt");
        await f.browser.evaluate(`(() => {
          const summary = [...document.querySelectorAll('summary')]
            .find(element => element.dataset.weavra === 'read-selected-message');
          if (!summary.parentElement.open) summary.click();
          summary.scrollIntoView({ block: 'center' });
        })()`);
        await f.browser.waitText(prefix);
        assert.equal(await f.browser.evaluate("location.pathname"), f.row.visibleConversation.path);
      }
      catch (error) {
        f.row.analysisDom = await f.browser.evaluate(`({
          pathname: location.pathname,
          inDom: document.body.textContent.includes(${JSON.stringify(prefix)}),
          visibleText: document.body.innerText.includes(${JSON.stringify(prefix)}),
          controlledCard: !!document.querySelector('[data-weavra="controlled-task"]'),
          expectedMessageId: ${JSON.stringify(message.messageId)},
          selectedMessageIds: [...document.querySelectorAll('option')].map(option => option.value)
            .filter(value => value.startsWith('assistant:')),
          scroll: [...document.querySelectorAll('div')].filter(element =>
            element.scrollHeight > element.clientHeight + 100 && getComputedStyle(element).overflowY === 'auto')
            .map(element => ({ top: element.scrollTop, height: element.clientHeight, total: element.scrollHeight }))
        })`);
        throw error;
      }
      f.row.stage = "assertions";
    }
    assert.deepEqual(await f.files(), f.before, "Analysis must not edit either checkout");
  }
  const starts = f.events.rows.filter((e) => e.kind === "analysis-request" && e.method === "thread/start");
  assert.ok(starts.length > 0);
  for (const event of starts) {
    assert.equal(event.sandbox, "read-only");
    assert.deepEqual(event.approvalPolicy, { granular: { mcp_elicitations: false,
      request_permissions: false, rules: false, sandbox_approval: false, skill_approval: false } });
  }
  assert.equal(f.events.rows.filter((e) => e.kind === "analysis-request" && e.method === "turn/start").length, 2);
  assert.equal(f.events.rows.filter((event) => event.kind === "analysis-tool-rejected" && event.success === false).length, 2);
  f.row.analysis = { wrongEarlyHypothesisVisible: true, reviewedCorrectionVisible: true,
    controlledReadOnly: true, writes: 0, dynamicToolRequestsDenied: 2,
    transcriptExported: false, navigation: "exact visible-message source reader" };
}

async function dismissMaintenanceNotifications(f) {
  const buttons = `[...document.querySelectorAll('button[data-slot="toast-close"]')]
    .filter(button => {
      const toast = button.closest('[data-position]');
      return toast?.textContent.includes('Update Available:') &&
        [...toast.querySelectorAll('button')].some(action => action.textContent.trim() === 'Update');
    })`;
  const dismissed = await f.browser.arm(`() => ${buttons}.length === 0`);
  const count = await f.browser.evaluate(`(() => {
    const buttons = ${buttons};
    for (const button of buttons) button.click();
    return buttons.length;
  })()`);
  await dismissed();
  f.row.dismissedMaintenanceNotifications = (f.row.dismissedMaintenanceNotifications ?? 0) + count;
}

async function verifyExplicitFindingSelection(f) {
  const excerpt = f.correctedText.slice(0, 200);
  const edited = `Reviewed: ${excerpt}`;
  assert.equal(f.correctedText.includes("Nonmatching QA excerpt"), false);
  const before = f.events.rows.filter(event =>
    event.kind === "request" && event.type === "workflow.prepare").length;
  const fill = (suffix, text) => f.browser.evaluate(`(() => {
    const input = document.querySelector('[data-weavra="controlled-task"] textarea[id$="-${suffix}"]');
    if (!input) throw new Error('Source input missing');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
      .set.call(input, ${JSON.stringify(text)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const rejected = await f.browser.arm(`() => !!document.querySelector('[data-weavra="controlled-task"] [role="alert"]')`);
  await fill("excerpt", "Nonmatching QA excerpt");
  await f.browser.clickAction("include-selected-finding");
  await rejected();
  assert.equal(await f.browser.evaluate(`!!document.querySelector('[id$="-finding-0"]')`), false);
  assert.equal(await f.browser.evaluate(`document.querySelector('[id$="-excerpt"]').value`), "Nonmatching QA excerpt");
  for (const [width, height] of [[1280, 900], [375, 812]]) {
    await f.browser.viewport(width, height);
    await dismissMaintenanceNotifications(f);
    await f.browser.evaluate(`document.querySelector('[data-weavra="controlled-task"] [role="alert"]')
      .scrollIntoView({ block: 'center', behavior: 'instant' })`);
    const path = join(evidenceDir, `${f.row.id}-source-rejected-${width}.png`);
    await f.browser.screenshot(path); f.row.screenshots.push(path);
  }
  const added = await f.browser.arm(`() => document.querySelector('[id$="-finding-0"]')?.value === ${JSON.stringify(excerpt)}`);
  await fill("excerpt", excerpt);
  await f.browser.clickAction("include-selected-finding");
  await added();
  f.row.sourceSelection = [];
  for (const provenance of ["MODEL", "USER"]) {
    if (provenance === "USER") {
      const changed = await f.browser.arm(`() => document.querySelector('label[for$="-finding-0"]')
        ?.textContent.includes(' | 사용자 | ')`);
      await fill("finding-0", edited);
      await changed();
    }
    for (const [width, height] of [[1280, 900], [375, 812]]) {
      await f.browser.viewport(width, height);
      await dismissMaintenanceNotifications(f);
      const observed = await f.browser.evaluate(`(async () => {
        await new Promise(resolve => requestAnimationFrame(resolve));
        const input = document.querySelector('[id$="-finding-0"]');
        const label = document.querySelector('label[for$="-finding-0"]');
        input.focus({ preventScroll: true });
        input.scrollIntoView({ block: 'center', behavior: 'instant' });
        const composerEntry = [...document.querySelectorAll('button')]
          .find(button => button.dataset.weavraAction === 'open-controlled-task');
        if (!composerEntry) throw new Error('Controlled composer entry unavailable');
        const bottom = Math.min(innerHeight, composerEntry.getBoundingClientRect().top);
        for (let parent = input.parentElement; parent; parent = parent.parentElement) {
          if (parent.scrollHeight > parent.clientHeight &&
              /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
            const top = label.getBoundingClientRect().top;
            const end = input.getBoundingClientRect().bottom;
            parent.scrollBy({ top: (top + end) / 2 - bottom / 2, behavior: 'instant' });
            break;
          }
        }
        await new Promise(resolve => requestAnimationFrame(resolve));
        const visible = element => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.bottom <= innerHeight &&
            rect.left >= 0 && rect.right <= innerWidth &&
            [rect.top + 1, rect.bottom - 1].every(y =>
              element.contains(document.elementFromPoint(rect.left + rect.width / 2, y)));
        };
        return { text: input.value, source: label.textContent.trim(),
          inputVisible: visible(input), labelVisible: visible(label),
          inputBounds: input.getBoundingClientRect().toJSON(),
          labelBounds: label.getBoundingClientRect().toJSON() };
      })()`);
      assert.equal(observed.text, provenance === "MODEL" ? excerpt : edited);
      assert.ok(observed.source.includes(` | ${provenance === "USER" ? "사용자" : "모델"} | `));
      assert.ok(observed.source.includes(f.correctedMessage));
      const path = join(evidenceDir, `${f.row.id}-source-${provenance.toLowerCase()}-${width}.png`);
      await f.browser.screenshot(path); f.row.screenshots.push(path);
      f.row.sourceSelection.push({ width, height, provenance, ...observed, screenshot: path });
      assert.equal(observed.inputVisible, true, "Selected finding must be visible, not behind the composer");
      assert.equal(observed.labelVisible, true, "Finding provenance must be visible in the capture");
    }
  }
  assert.equal(f.events.rows.filter(event =>
    event.kind === "request" && event.type === "workflow.prepare").length, before);
  assert.equal(f.workerRequests.length, 0);
  await f.noRun();
  f.expectedSelectedFinding = {
    text: edited, provenance: "USER",
    reference: { kind: "message", threadId: f.scope.threadId, messageId: f.correctedMessage },
  };
  await f.browser.viewport(1280, 900);
}
async function openProjectControlPanel(f) {
  await (await f.browser.arm("() => !!document.querySelector('[aria-label=\"오른쪽 패널 열기/닫기\"]')"))();
  if (await f.browser.evaluate("!!document.querySelector('[aria-label=\"프로젝트 통제 설정\"]')")) return;
  if (await f.browser.evaluate("!!document.querySelector('[data-weavra-action=\"open-controlled-task\"]')")) {
    const opened = await f.browser.arm("() => !!document.querySelector('[aria-label=\"프로젝트 통제 설정\"]')");
    await f.browser.clickAction("open-controlled-task");
    await opened();
    return;
  }
  const content = await f.browser.arm("() => !!document.querySelector('[data-right-panel-surface-content]')");
  if (!await f.browser.evaluate("!!document.querySelector('[data-right-panel-surface-content]')"))
    await f.browser.evaluate("document.querySelector('[aria-label=\"오른쪽 패널 열기/닫기\"]').click()");
  await content();
  const chosen = await f.browser.arm("() => !!document.querySelector('[aria-label=\"프로젝트 통제 설정\"]')");
  if (await f.browser.evaluate("!!document.querySelector('[aria-label=\"패널 추가\"]')")) {
    const menu = await f.browser.arm("() => !!document.querySelector('[role=\"menuitem\"]')");
    await f.browser.evaluate("document.querySelector('[aria-label=\"패널 추가\"]').click()");
    await menu();
  }
  await f.browser.evaluate("Array.from(document.querySelectorAll('button, [role=menuitem]')).find(b => b.textContent.includes('통제 작업')).click()");
  await chosen();
}
async function browserConversation(f) {
  f.row.stage = "browser-start";
  const pairingUrl = await mintPairing(f);
  // Chromium needs the OS home for its macOS network service; browser data still
  // lives exclusively in the fresh --user-data-dir profile below.
  f.browser = await openBrowser({ executable: process.env.WEAVRA_CHROMIUM, home: process.env.HOME,
    profile: join(f.base, "chromium"), headless: !interactive });
  f.row.browserPid = f.browser.pid;
  f.row.stage = "browser-pairing";
  await f.browser.navigate(pairingUrl);
  const path = `/${encodeURIComponent(f.scope.environmentId)}/${encodeURIComponent(f.scope.threadId)}`;
  f.row.stage = "browser-paired-client";
  await (await f.browser.arm(`() => !!document.querySelector('main [role="combobox"]')`))();
  await f.browser.navigate(f.origin + path);
  await openProjectControlPanel(f);
  f.row.stage = "browser-controlled-card";
  await (await f.browser.arm(`() => !!document.querySelector('[data-weavra="controlled-task"]')`))();
  await (await f.browser.arm(`() => [...document.querySelectorAll('[data-weavra="controlled-task"] details')]
    .some(details => details.textContent.includes(${JSON.stringify(f.task.id)}))`))();
  await f.browser.evaluate(`document.querySelectorAll('[data-weavra="controlled-task"] details').forEach(details => {
    if (details.textContent.includes(${JSON.stringify(f.task.id)})) details.querySelector('summary').click();
  })`);
  await f.browser.waitText(f.task.id);
  assert.equal(await f.browser.evaluate("location.pathname"), path);
  f.row.visibleConversation = { environmentId: f.scope.environmentId, threadId: f.scope.threadId, path };
  f.row.stage = "assertions";
}
async function prepareReviewedContextInBrowser(f, client) {
  const draft = f.draft();
  const fields = {
    goal: draft.goal, symptom: draft.context.symptom,
    hypothesis: draft.context.candidateCause.text,
    uncertainties: draft.context.uncertainties.join("\n"),
    constraints: draft.context.constraints.join("\n"),
    criteria: draft.acceptanceStatements.join("\n"),
    sources: JSON.stringify(draft.context.sourceReferences),
  };
  const fill = async (field, value) => f.browser.evaluate(`(() => {
    const element = document.querySelector('[data-weavra="controlled-task"] [id$="-${field}"]');
    if (!element) throw new Error('Missing reviewed context field');
    if (element.disabled) throw new Error('Reviewed context field is disabled');
    const prototype = element.tagName === 'TEXTAREA'
      ? HTMLTextAreaElement.prototype : element.tagName === 'SELECT'
        ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    if (element.tagName !== 'SELECT') element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (element.value !== ${JSON.stringify(value)}) throw new Error('Reviewed field rejected selected value');
  })()`);
  const meter = () => f.browser.evaluate(`(() => {
    const output = document.querySelector('output[data-weavra="advisory-context-size"]');
    if (!output) throw new Error('Missing context meter');
    return { bytes: Number(output.textContent.trim().match(/^\\d+/)?.[0]),
      invalid: output.getAttribute('aria-invalid') === 'true' };
  })()`);
  const prepareCount = () => f.events.rows.filter((event) =>
    event.kind === "request" && event.type === "workflow.prepare").length;
  const invalidSubmit = async (expectedField, width, height) => {
    await dismissMaintenanceNotifications(f);
    await f.browser.evaluate(`(() => {
      const card = document.querySelector('[data-weavra="controlled-task"]');
      const button = [...card.querySelectorAll('button')]
        .find(element => element.dataset.weavraAction === 'prepare-handoff' && !element.disabled);
      if (!button) throw new Error('Prepare control unavailable');
      button.scrollIntoView({ block: 'center' });
      button.focus();
      window.__contextErrorFocus = new Promise(resolve => {
        const observe = event => {
          if (card.contains(event.target) &&
              ['TEXTAREA', 'INPUT', 'OUTPUT'].includes(event.target.tagName)) {
            document.removeEventListener('focusin', observe, true);
            resolve({ id: event.target.id,
              describedBy: event.target.getAttribute('aria-describedby'),
              value: event.target.value });
          }
        };
        document.addEventListener('focusin', observe, true);
      });
    })()`);
    const before = prepareCount();
    await f.browser.press("Enter");
    const focused = await f.browser.evaluate("window.__contextErrorFocus");
    const visibility = await f.browser.evaluate(`(() => {
      const field = document.getElementById(${JSON.stringify(focused.id)});
      const error = document.getElementById(${JSON.stringify(`${focused.id}-error`)});
      const visible = element => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        return rect.top >= 0 && rect.bottom <= innerHeight &&
          rect.left >= 0 && rect.right <= innerWidth &&
          [rect.top + 1, rect.bottom - 1].every(y =>
            element.contains(document.elementFromPoint(rect.left + rect.width / 2, y)));
      };
      return { fieldVisible: visible(field), errorVisible: visible(error),
        fieldBounds: field?.getBoundingClientRect().toJSON(),
        errorBounds: error?.getBoundingClientRect().toJSON() };
    })()`);
    const screenshot = join(evidenceDir, `${f.row.id}-context-${expectedField}-${width}.png`);
    await f.browser.screenshot(screenshot);
    f.row.screenshots.push(screenshot);
    f.row.contextValidation.push({ width, height, expectedField, focused, visibility,
      prepareRequestsBefore: before, prepareRequestsAfter: prepareCount(), screenshot });
    assert.ok(focused.id.endsWith(`-${expectedField}`), "Keyboard submission must focus its invalid field");
    assert.ok(focused.describedBy?.includes(`${focused.id}-error`), "Focused error must be described");
    assert.equal(visibility.fieldVisible, true, "Invalid field must remain visible");
    assert.equal(visibility.errorVisible, true, "Validation explanation must remain visible above the composer");
    assert.equal(prepareCount(), before, "Invalid context must not issue a prepare request");
    assert.equal(f.workerRequests.length, 0);
    await f.noRun();
  };
  for (const [field, value] of Object.entries(fields)) await fill(field, value);
  const beforeGoalEdit = await meter();
  assert.ok(Number.isFinite(beforeGoalEdit.bytes));
  await fill("goal", `${draft.goal} Reviewed separately.`);
  assert.equal((await meter()).bytes, beforeGoalEdit.bytes, "Goal is not advisory context");
  await fill("goal", draft.goal);
  f.row.contextValidation = [];
  for (const [width, height] of [[1280, 900], [768, 1024], [375, 812]]) {
    await f.browser.viewport(width, height);
    await fill("sources", "[");
    await f.browser.evaluate(`(() => {
      const field = document.querySelector('[data-weavra="controlled-task"] [id$="-sources"]');
      field.closest('details').open = false;
    })()`);
    await invalidSubmit("sources", width, height);
    assert.equal(await f.browser.evaluate(`document.querySelector('[id$="-sources"]').value`), "[");
    await fill("sources", fields.sources);
    await fill("symptom", "한".repeat(1000));
    await fill("hypothesis", "한".repeat(1000));
    await fill("constraints", Array(8).fill("한".repeat(250)).join("\n"));
    assert.ok((await meter()).bytes > 8192);
    await invalidSubmit("context", width, height);
    for (const field of ["symptom", "hypothesis", "constraints"]) await fill(field, fields[field]);
  }
  await f.browser.viewport(1280, 900);
  const prepared = await f.browser.arm(`() => !!document.querySelector('[data-weavra="prepared-snapshot"]')`);
  await f.browser.clickAction("prepare-handoff");
  await prepared();
  await f.read(client);
  assert.equal(f.task.phase, "awaiting-confirmation");
  assert.equal(f.task.execution.binding.symptomVerification, undefined,
    "Initial preview must not invent a symptom binding");
  const beforeBinding = prepareCount();
  await f.browser.evaluate(`(() => {
    const field = document.querySelector('[id$="-symptom-criterion"]');
    for (let parent = field.parentElement; parent; parent = parent.parentElement) {
      if (parent.tagName === 'DETAILS' && !parent.open) parent.querySelector('summary').click();
    }
  })()`);
  await fill("symptom-criterion", String(draft.symptomVerification.criterionIndex));
  await fill("symptom-check", draft.symptomVerification.checkId);
  assert.equal(prepareCount(), beforeBinding, "Selection alone must not prepare or launch work");
  assert.equal(await f.browser.evaluate(`!!document.querySelector(
    '[data-weavra="controlled-task"] input[type="checkbox"]')`), false,
    "A changed binding must discard prior snapshot consent");
  for (const [width, height] of [[1280, 900], [375, 812]]) {
    await f.browser.viewport(width, height);
    await f.browser.evaluate(`(() => {
      const field = document.querySelector('[id$="-symptom-criterion"]');
      field.closest('details').open = true;
      field.scrollIntoView({ block: 'center', behavior: 'instant' });
    })()`);
    const screenshot = join(evidenceDir, `${f.row.id}-symptom-binding-${width}.png`);
    await f.browser.screenshot(screenshot);
    f.row.screenshots.push(screenshot);
  }
  await f.browser.viewport(1280, 900);
  const previousTaskId = f.task.id;
  const rebound = await f.browser.arm(`() => !!document.querySelector(
    '[data-weavra="controlled-task"] input[type="checkbox"]')`);
  await f.browser.clickAction("prepare-handoff");
  await rebound();
  const attempts = await rpc(client, C.WS_METHODS.weavraTaskList, f.scope);
  const currentAttempts = attempts.filter(task =>
    task.id !== previousTaskId && task.ownership.state === "analysis" &&
    task.phase === "awaiting-confirmation");
  assert.equal(currentAttempts.length, 1, "Reprepare must create exactly one fresh unconfirmed attempt");
  const previousTask = attempts.find(task => task.id === previousTaskId);
  assert.equal(previousTask.ownership.state, "released");
  assert.equal(previousTask.execution.binding.symptomVerification, undefined,
    "Reprepare must preserve the old unbound preview as history");
  f.remember(currentAttempts[0]);
  assert.equal(prepareCount(), beforeBinding + 1);
  assert.ok(f.task.execution.binding.symptomVerification, "Reprepare must retain the selected symptom binding");
  assert.equal(f.task.execution.binding.symptomVerification.criterionId,
    f.task.execution.preview.acceptanceCriteria[draft.symptomVerification.criterionIndex - 1].id);
  assert.equal(f.task.execution.binding.symptomVerification.checkId, draft.symptomVerification.checkId);
  assert.equal(await f.browser.evaluate(`document.querySelector(
    '[data-weavra="controlled-task"] input[type="checkbox"]').checked`), false,
    "Reprepared binding requires a new acknowledgement");
  f.row.symptomBinding = { selectedFromPreview: true, requiredCheckOnly: true,
    reprepareRequired: true, freshConsentRequired: true };
  assert.equal(f.task.context.symptom, fields.symptom);
  assert.equal(f.task.context.candidateCause.text, fields.hypothesis);
  assert.deepEqual(f.task.context.sourceReferences, draft.context.sourceReferences);
  if (f.expectedSelectedFinding) {
    assert.deepEqual(f.task.context.observations, [f.expectedSelectedFinding]);
  }
  assert.equal((await meter()).bytes, Buffer.byteLength(JSON.stringify(f.task.context)));
  f.row.contextMeter = { bytes: (await meter()).bytes, matchesSubmittedContext: true,
    goalExcluded: true, invalidSubmissionsMadeNoRequests: true };
}

async function visibleEvidence(f) {
  await f.browser.evaluate(`document.querySelector('[data-weavra="controlled-outcome"]').scrollIntoView({block:'start'})`);
  const defaultResult = join(evidenceDir, `${f.row.id}-default-result.png`);
  await f.browser.screenshot(defaultResult);
  f.row.screenshots.push(defaultResult);
  await f.browser.evaluate(`document.querySelectorAll('details').forEach(details => { details.open = true; })`);
  await f.browser.waitText(f.task.id);
  await f.browser.waitText(f.task.execution.receipt.run.runId);
  for (const category of ["criteria", "checks"]) {
    const selected = await f.browser.arm(`() => [...document.querySelectorAll('select')]
      .some(s => [...s.options].some(o => o.value === 'trust-sources') && s.value === ${JSON.stringify(category)})`);
    await f.browser.evaluate(`(() => {
      const select = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'trust-sources'));
      if (!select) throw new Error('Evidence category selector absent');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(category)});
      select.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await selected();
    const loaded = await f.browser.arm(`() => !!document.querySelector('[data-weavra-record="${category}"][data-record-index="1"]')`);
    await f.browser.clickAction("load-evidence"); await loaded();
  }
  await (await f.browser.arm(`() => !!document.querySelector('[data-issue-verification="verified"]')`))();
  await f.browser.evaluate(`document.querySelector('[data-weavra="controlled-outcome"]').scrollIntoView({ block: 'start' })`);
  const screenshot = join(evidenceDir, `${f.row.id}-completed-summary.png`);
  await f.browser.screenshot(screenshot);
  f.row.screenshots.push(screenshot);
  assert.equal(await f.browser.evaluate(`document.querySelector(
    '[data-weavra="controlled-outcome"] [data-next-action]')?.getAttribute('data-next-action')`), "none");
  await f.browser.viewport(375, 812);
  await f.browser.evaluate(`document.querySelector('[data-weavra="controlled-outcome"]')
    .scrollIntoView({ block: 'start', behavior: 'instant' })`);
  const mobileSummary = join(evidenceDir, `${f.row.id}-completed-summary-375.png`);
  await f.browser.screenshot(mobileSummary);
  f.row.screenshots.push(mobileSummary);
  await f.browser.viewport(1280, 900);
  await f.browser.evaluate(`(() => {
    const records = document.querySelectorAll('[data-weavra-record="checks"]');
    if (!records.length) throw new Error('Loaded checks missing');
    records[records.length - 1].scrollIntoView({ block: 'center' });
  })()`);
  const checksShot = join(evidenceDir, `${f.row.id}-completed-checks.png`);
  await f.browser.screenshot(checksShot);
  f.row.screenshots.push(checksShot);
  await f.browser.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.dataset.weavraAction === 'reload-evidence-snapshot');
    if (!button) throw new Error('Evidence reload missing');
    button.scrollIntoView({ block: 'center' });
  })()`);
  const controlsShot = join(evidenceDir, `${f.row.id}-completed-controls.png`);
  await f.browser.screenshot(controlsShot);
  f.row.screenshots.push(controlsShot);
  await completedRunGraph(f);
}
async function completedRunGraph(f) {
  const menu = await f.browser.arm("() => !!document.querySelector('[role=\"menuitem\"]')");
  await f.browser.evaluate("document.querySelector('[aria-label=\"패널 추가\"]').click()");
  await menu();
  const drawn = await f.browser.arm(`() => !!document.querySelector(
    '[data-weavra="run-graph"] [data-weavra-graph-node="complete:1"][data-status="passed"]')`);
  await f.browser.evaluate("Array.from(document.querySelectorAll('[role=menuitem]')).find(b => b.textContent.includes('Run 그래프')).click()");
  await drawn();
  const nodes = await f.browser.evaluate(`[...document.querySelectorAll(
    '[data-weavra="run-graph"] li[data-weavra-graph-node]')].map(n => n.dataset.weavraGraphNode)`);
  assert.deepEqual(nodes.slice(-2), ["test:1", "complete:1"], "Graph keeps the Runtime step order");
  assert.equal(await f.browser.evaluate("document.querySelectorAll('[data-weavra=\"run-graph\"] button').length"), 0,
    "The graph panel is read-only");
  f.row.runGraph = { nodes };
  for (const [width, height] of [[1280, 900], [375, 812]]) {
    await f.browser.viewport(width, height);
    const shot = join(evidenceDir, `${f.row.id}-run-graph-${width}.png`);
    await f.browser.screenshot(shot);
    f.row.screenshots.push(shot);
    assert.equal(await f.browser.evaluate("document.documentElement.scrollWidth"), width);
  }
  await f.browser.viewport(1280, 900);
  await openProjectControlPanel(f);
}
async function unchangedExcept(f, expectedSource, expectedConfig = f.before.config, expectedStatus) {
  const after = await f.files();
  assert.equal(after.head, f.before.head);
  assert.equal(after.otherSource, f.before.otherSource);
  assert.equal(after.config, expectedConfig);
  for (const [path, hash] of Object.entries(f.before.files))
    assert.equal(after.files[path], path === sourcePath ? digest(expectedSource) : hash, `Unexpected write: ${path}`);
  assert.equal(after.status, expectedStatus ?? (expectedSource === original ? "" : ` M ${sourcePath}\n`));
  f.expectedFiles = after;
}
async function verifyControlledTaskFocus(f) {
  const executionCounts = async () => ({
    analysisTurnStarts: f.events.rows.filter((event) =>
      event.kind === "analysis-request" && event.method === "turn/start").length,
    runtimeConfirmations: f.events.rows.filter((event) =>
      event.kind === "request" && event.type === "workflow.confirm").length,
    workerModelRequests: f.workerRequests.length,
    canonicalRuns: (await f.readState()).runs.length,
  });
  const initialCounts = await executionCounts();
  f.row.focus = [];
  f.row.focusControlReachability = [];
  for (const [width, height] of [[1280, 900], [375, 812]]) {
    await f.browser.viewport(width, height);
    for (const key of ["Enter", "Space"]) {
      if (await f.browser.evaluate("!!document.querySelector('[data-weavra=\"controlled-task-details\"]')")) {
        const closed = await f.browser.arm("() => !document.querySelector('[data-weavra=\"controlled-task-details\"]')");
        await f.browser.evaluate("Array.from(document.querySelectorAll('[aria-label=\"오른쪽 패널 열기/닫기\"]')).findLast(b => b.getClientRects().length > 0).click()");
        await closed();
      }
      const before = await executionCounts();
      assert.deepEqual(before, initialCounts, "No execution may occur between focus activations");
      f.row.focusAttempt = { width, height, key, phase: "arming" };
      await f.browser.evaluate(`(() => {
        const entry = [...document.querySelectorAll('button')]
          .find(button => button.dataset.weavraAction === 'open-controlled-task');
        const composer = [...document.querySelectorAll('textarea')]
          .find(element => element.getClientRects().length > 0);
        let scroller = document.querySelector('[data-timeline-row-id]') ??
          document.querySelector('[data-timeline-content-footer]');
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight &&
          ['auto', 'scroll'].includes(getComputedStyle(scroller).overflowY))) {
          scroller = scroller.parentElement;
        }
        if (!entry || !composer || !scroller) throw new Error('Focus QA surface unavailable');
        scroller.scrollTo({ top: 0, behavior: 'instant' });
        const entryRect = entry.getBoundingClientRect();
        if (entryRect.width <= 0 || entryRect.top < 0 || entryRect.bottom > innerHeight) {
          throw new Error('Composer task entry is not visible');
        }
        let resolve;
        const promise = new Promise(done => resolve = done);
        const focused = event => {
          const target = document.querySelector('[data-weavra="controlled-task-details"]');
          if (!target || event.target !== target) return;
          document.removeEventListener('focusin', focused);
          const rect = target.getBoundingClientRect();
          const entryBounds = entry.getBoundingClientRect();
          resolve({
            focused: document.activeElement === target,
            top: rect.top, left: rect.left, right: rect.right,
            composerTop: entryBounds.top, viewportWidth: innerWidth,
            viewportHeight: innerHeight, scrollRange: scroller.scrollHeight - scroller.clientHeight
          });
        };
        document.addEventListener('focusin', focused);
        window.__weavraFocusQa = promise;
        window.__weavraFocusClicks = 0;
        window.__weavraFocusKeys = [];
        const keyboardObservation = new AbortController();
        window.__weavraFocusKeyboardObservation = keyboardObservation;
        document.addEventListener('keydown', event => {
          window.__weavraFocusKeys.push({
            key: event.key, code: event.code, shiftKey: event.shiftKey,
            trusted: event.isTrusted
          });
        }, { capture: true, signal: keyboardObservation.signal });
        entry.addEventListener('click', event => {
          window.__weavraFocusClicks += 1;
          window.__weavraFocusClickTrusted = event.isTrusted;
        }, { once: true });
        composer.focus();
        return true;
      })()`);
      await f.browser.press("Tab", 8);
      const entryReached = await f.browser.evaluate(
        `document.activeElement?.dataset.weavraAction === 'open-controlled-task'`);
      assert.equal(entryReached, true, "Shift+Tab from the composer must reach the task entry");
      f.row.focusAttempt.phase = "keyboard-entry";
      await f.browser.press(key);
      f.row.focusAttempt.phase = "activation-sent";
      let observation;
      try {
        observation = await f.browser.evaluate("window.__weavraFocusQa");
      } catch (error) {
        f.row.focusFailure = await f.browser.evaluate(`(() => {
          const target = document.querySelector('[data-weavra="controlled-task-details"]');
          const active = document.activeElement;
          return {
            clicks: window.__weavraFocusClicks,
            activeTag: active?.tagName,
            activeLabel: active?.getAttribute('aria-label'),
            targetPresent: !!target,
            targetConnected: target?.isConnected,
            targetTop: target?.getBoundingClientRect().top,
            scrolls: [...document.querySelectorAll('div')]
              .filter(element => element.scrollHeight > element.clientHeight &&
                ['auto', 'scroll'].includes(getComputedStyle(element).overflowY))
              .map(element => ({ top: element.scrollTop, height: element.clientHeight,
                total: element.scrollHeight }))
          };
        })()`);
        f.row.focusExceptions = f.browser.exceptions();
        const failureShot = join(evidenceDir, `${f.row.id}-focus-failure-${width}-${key}.png`);
        await f.browser.screenshot(failureShot);
        f.row.screenshots.push(failureShot);
        throw error;
      }
      f.row.focusAttempt.phase = "focus-observed";
      const keyboard = await f.browser.evaluate(`(() => {
        window.__weavraFocusKeyboardObservation.abort();
        return { keys: window.__weavraFocusKeys, clicks: window.__weavraFocusClicks,
          clickTrusted: window.__weavraFocusClickTrusted };
      })()`);
      assert.ok(keyboard.keys.some((event) => event.key === "Tab" && event.shiftKey && event.trusted));
      assert.ok(keyboard.keys.some((event) =>
        event.key === (key === "Space" ? " " : "Enter") && !event.shiftKey && event.trusted));
      assert.equal(keyboard.clicks, 1);
      assert.equal(keyboard.clickTrusted, true);
      assert.equal(observation.focused, true);
      assert.ok(observation.top >= 0 && observation.top < observation.composerTop,
        "Task heading must be visible above the composer");
      assert.ok(observation.left >= 0 && observation.right <= width,
        "Task region must fit the viewport");
      assert.ok(observation.scrollRange > height * 2, "Fixture must exercise a long timeline");
      const screenshot = join(evidenceDir, `${f.row.id}-focus-${width}-${key}.png`);
      await f.browser.screenshot(screenshot);
      const image = await readFile(screenshot);
      assert.equal(image.readUInt32BE(16), width);
      assert.equal(image.readUInt32BE(20), height);
      f.row.screenshots.push(screenshot);
      const after = await executionCounts();
      f.row.focus.push({ width, height, key, inputMethod: "CDP Input.dispatchKeyEvent",
        entryReachedByShiftTab: entryReached, keyboard, before, after, ...observation });
      assert.deepEqual(after, before, "Focus must not start provider or Runtime work");
    }
    const lowerControl = await f.browser.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')]
        .find(element => element.dataset.weavraAction === 'return-to-free-coding');
      const entry = [...document.querySelectorAll('button')]
        .find(element => element.dataset.weavraAction === 'open-controlled-task');
      if (!button || !entry) throw new Error('Expected existing free-return control');
      button.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = button.getBoundingClientRect();
      return { enabled: !button.disabled, top: rect.top, bottom: rect.bottom,
        composerTop: entry.getBoundingClientRect().top };
    })()`);
    f.row.focusControlReachability.push({ width, height, ...lowerControl });
    const lowerShot = join(evidenceDir, `${f.row.id}-return-reachable-${width}.png`);
    await f.browser.screenshot(lowerShot);
    f.row.screenshots.push(lowerShot);
    assert.equal(lowerControl.enabled, true);
    assert.ok(lowerControl.top >= 0 && lowerControl.bottom <= lowerControl.composerTop,
      "The existing free-return control must be reachable above the composer");
  }
  f.row.focusExecutionCounts = { before: initialCounts, after: await executionCounts() };
  assert.deepEqual(f.row.focusExecutionCounts.after, initialCounts);
  await f.browser.viewport(1280, 900);
}

async function runCase(id, name, attempts) {
  if (selectedCase !== undefined && selectedCase !== id) return;
  const selectedAttempts = selectedAttempt === undefined ? attempts : attempts.filter(([label]) => label === selectedAttempt);
  assert.ok(selectedAttempts.length > 0, "Unknown focused attempt");
  const group = { id, name, verdict: "FAIL", attempts: [], identities: [], cleanup: [], screenshots: [] };
  corpus.cases.push(group);
  for (const [label, options, body] of selectedAttempts) {
    const row = { id, label, verdict: "FAIL", identities: [], cleanup: [], screenshots: [], attempts: [] };
    group.attempts.push(row);
    let f;
    try {
      row.stage = "setup";
      assert.equal(interrupted, false, "Corpus interrupted; later cases do not launch");
      f = await makeFixture(label, options, row);
      row.stage = "assertions";
      await body(f);
      row.verdict = "PASS";
    } catch (error) {
      if (row.recoveryStage && f?.browser) {
        try {
          row.recoveryDiagnostics = await f.browser.evaluate(`(() => ({
            addedUploadReady: document.documentElement.dataset.recoveryAddedUpload === 'ready',
            sendHeld: !!window.__heldFailureSend,
            editorFocused: document.activeElement?.getAttribute('contenteditable') === 'true',
            recovered: !!document.querySelector('[data-recovered-message-id]'),
            alertCount: document.querySelectorAll('[role="alert"]').length,
            animations: document.getAnimations().map(animation => ({
              playState: animation.playState,
              pending: animation.pending,
              iterations: String(animation.effect?.getTiming().iterations)
            }))
          }))()`);
        } catch {
          row.recoveryDiagnostics = { unavailable: true };
        }
      }
      row.failure = { name: error.name ?? "Error", stage: row.stage,
        timeout: typeof error.message === "string" && error.message.startsWith("Timeout: ")
          ? error.message.slice(9) : undefined,
        site: typeof error.stack === "string"
          ? [...error.stack.matchAll(/(?:run-problem-cycle-integration|problem-cycle-browser)\.mjs:\d+:\d+/g)].map((m) => m[0])
          : [],
        // Never serialize FiberFailure/request objects or raw child logs.
        assertion: error.code === "ERR_ASSERTION" ? String(error.message).split("\n")[0].slice(0, 200) : "Harness setup/operation failed; inspect locally, no raw transcript exported" };
      if (interactive && f?.browser) {
        console.log(`TASK8_INTERACTIVE_FAILURE origin=${f.origin} pid=${f.browser.pid} fixture=${f.base}; press ENTER after inspection`);
        const input = createInterface({ input: process.stdin });
        await bounded(new Promise((res) => { input.once("line", res); input.once("close", res); }), "interactive failure inspection", 900_000);
        input.close();
      }
    } finally {
      if (f) try { await f.close(); } catch { row.verdict = "FAIL"; row.cleanupFailed = true; }
      delete row.stage;
      await save();
    }
    console.log(`TASK8 ${id}/${label} ${row.verdict}`);
  }
  group.verdict = group.attempts.every((a) => a.verdict === "PASS") ? "PASS" : "FAIL";
  await save();
}

await runCase("normal-success", "Same conversation, reviewed correction, fresh strict symptom check", [["standard-2ac", {}, async (f) => {
  await connect(f, async (client) => {
    await f.create(client);
    for (let index = 0; index < 30; index += 1) {
      f.task = await rpc(client, C.WS_METHODS.weavraTaskFollowup, {
        task: { ...f.scope, taskId: f.task.id }, expectedRevision: f.task.revision,
        commandId: randomUUID(), messageId: randomUUID(),
        text: `Focus QA history ${index + 1}.\n${"Saved context without provider execution. ".repeat(12)}`,
      });
    }
    await browserConversation(f); await analyze(f, client);
    await verifyExplicitFindingSelection(f);
    await prepareReviewedContextInBrowser(f, client);
    assert.equal(f.task.execution.preview.workflow, "STANDARD");
    assert.equal(f.task.execution.binding.checkout.canonicalCwd, f.target);
    const feed = await f.observe(client);
    f.taskFeed = await subscription(f, client[C.WS_METHODS.weavraTaskObserve](f.ref()),
      (event) => event.kind === "synchronized");
    await f.complete(client, feed, () => f.confirm(client));
    assertSuccess(f, await evidence(f, client));
    await unchangedExcept(f, fixed);
    const run = (await f.readState()).runs[0];
    const developer = run.roleSessionRefs.find((s) => s.role === "Developer");
    const reviewer = run.roleSessionRefs.find((s) => s.role === "Reviewer");
    assert.ok(developer && reviewer); assert.notEqual(developer.sessionId, reviewer.sessionId);
    assert.deepEqual(fixture.oracle({ workspace: f.target }), []);
    await visibleEvidence(f);
    await verifyControlledTaskFocus(f);
    f.row.assertions = ["unchanged registered symptom FAIL", "read-only wrong/corrected hypotheses visible",
      "real separate worker/reviewer sessions", "strict fresh SELF_CHECK and TEST", "Kernel COMPLETED",
      "frozen symptom registration matches", "same visible thread", "only intended source changed",
      "keyboard focus reaches controlled task in long desktop/mobile timelines without execution"];
    if (interactive) {
      console.log(`TASK8_INTERACTIVE origin=${f.origin} taskId=${f.task.id}; press ENTER to continue corpus`);
      const input = createInterface({ input: process.stdin });
      await bounded(new Promise((res) => { input.once("line", res); input.once("close", res); }), "interactive review", 900_000);
      input.close();
    }
  });
}]]);

await runCase("ordinary-qa-tool-access", "Normally issued ordinary-provider MCP access preserves device gates", [
  [selectedAttempt === "device-enabled-inventory" ? "device-enabled-inventory"
    : selectedAttempt === "project-control-rules" ? "project-control-rules" : "authenticated-tool-inventory",
    { qaRole: true, projectSetup: selectedAttempt === "project-control-rules",
      chatControlDraft: selectedAttempt === "project-control-rules" }, async (f) => {
    await connect(f, async client => {
      const deviceEnabledProbe = selectedAttempt === "device-enabled-inventory";
      try {
        if (deviceEnabledProbe) {
          // Capabilities are captured when the ordinary provider credential is issued.
          f.row.deviceConfigurationAttempted = true;
          const configured = await Effect.runPromise(
            client[C.WS_METHODS.deviceConfigure]({ enabled: true, agentAccessEnabled: true })
              .pipe(Effect.timeout("5 minutes")),
          );
          f.row.deviceReadiness = {
            hostStatus: configured.hostStatus,
            agentAccessEnabled: configured.agentAccessEnabled,
          };
        }
        const ready = f.events.wait(event => event.kind === "qa-ready", "ordinary QA credential issued");
        await rpc(client, C.ORCHESTRATION_WS_METHODS.dispatchCommand, {
          type: "thread.turn.start", commandId: randomUUID(), threadId: f.scope.threadId,
          message: { messageId: randomUUID(), role: "user", text: "Inspect the built-in QA tool inventory only.", attachments: [] },
          runtimeMode: f.thread.runtimeMode, interactionMode: "default", createdAt: new Date().toISOString(),
        });
        await ready;
        const credential = f.qaCredential;
        assert.equal(credential.endpoint, `${f.origin}/mcp`);
        let sessionId;
        let sequence = 0;
        const headers = () => ({
          Authorization: credential.authorizationHeader, Accept: "application/json, text/event-stream",
          "Content-Type": "application/json", "MCP-Protocol-Version": "2025-06-18",
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        });
        const call = async (method, params) => {
          const id = ++sequence;
          const response = await fetch(credential.endpoint, {
            method: "POST", headers: headers(), body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
            signal: AbortSignal.timeout(30_000),
          });
          assert.equal(response.status, 200, `MCP ${method} transport must succeed`);
          sessionId ??= response.headers.get("mcp-session-id");
          const body = await response.text();
          const replies = response.headers.get("content-type")?.includes("text/event-stream")
            ? body.split("\n").filter(line => line.startsWith("data:")).map(line => JSON.parse(line.slice(5)))
            : [JSON.parse(body)];
          const reply = replies.find(value => value.id === id);
          assert.ok(reply && reply.error === undefined, `MCP ${method} must return its correlated reply`);
          return reply.result;
        };
        try {
          const initialized = await call("initialize", {
            protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "weavra-owned-qa", version: "1.0.0" },
          });
          assert.equal(initialized.protocolVersion, "2025-06-18");
          assert.ok(sessionId);
          const notification = await fetch(credential.endpoint, {
            method: "POST", headers: headers(),
            body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
            signal: AbortSignal.timeout(30_000),
          });
          assert.ok(notification.status === 202 || notification.status === 204);
          await notification.text();
          const inventory = await call("tools/list", {});
          const names = inventory.tools.map(tool => tool.name);
          if (selectedAttempt === "project-control-rules") {
            assert.ok(names.includes("read_project_control"));
            assert.ok(names.includes("save_project_control"));
            const configPath = join(f.target, ".ai/config.yaml");
            const originalConfig = await readFile(configPath);
            const normalizedBefore = parseRuntimeConfig(originalConfig.toString("utf8"));
            const originalHead = (await f.git("rev-parse", "HEAD")).trim();
            try {
              const read = await call("tools/call", { name: "read_project_control", arguments: {} });
              assert.notEqual(read.isError, true);
              const snapshot = read.structuredContent;
              assert.equal(snapshot.result.kind, "read");
              const next = { ...f.config, files: {
                allowed_paths: Array.from(new Set([...f.config.files.allowed_paths, "docs"])),
              } };
              const saved = await call("tools/call", { name: "save_project_control", arguments: {
                targetDigest: snapshot.targetDigest, expectedConfigDigest: snapshot.result.configDigest,
                yaml: JSON.stringify(next),
              } });
              assert.notEqual(saved.isError, true);
              assert.equal(saved.structuredContent.result.kind, "saved");
              const actual = parseRuntimeConfig(await readFile(configPath, "utf8"));
              assert.deepEqual(actual.files.allowed_paths, next.files.allowed_paths);
              assert.deepEqual(actual.models, normalizedBefore.models);
              assert.deepEqual(actual.verification, normalizedBefore.verification);
              const savedBytes = await readFile(configPath);
              const reused = await call("tools/call", { name: "save_project_control", arguments: {
                targetDigest: snapshot.targetDigest, yaml: " \n",
              } });
              assert.notEqual(reused.isError, true);
              assert.deepEqual(await readFile(configPath), savedBytes);
              const stale = await call("tools/call", { name: "save_project_control", arguments: {
                targetDigest: snapshot.targetDigest, expectedConfigDigest: snapshot.result.configDigest,
                yaml: originalConfig.toString("utf8"),
              } });
              assert.equal(stale.isError, true);
              assert.deepEqual(await readFile(configPath), savedBytes);
              assert.equal((await f.git("rev-parse", "HEAD")).trim(), originalHead);
              await f.noRun();
              assert.equal(f.workerRequests.length, 0);
              f.row.projectControlRules = {
                authenticatedOrdinarySession: true, saved: true, blankReuses: true,
                staleRejected: true, protectedSettingsPreserved: true,
                noRun: true, noWorker: true, realLauncher: true,
              };
            } finally {
              await writeFile(configPath, originalConfig);
            }
          }
          assert.ok(names.includes("device_list"), "Production Device toolkit must be discoverable");
          const device = await call("tools/call", { name: "device_list", arguments: {} });
          f.row.qaTools = { normallyIssuedCredential: true, analysisCredentialReused: false,
            protocolVersion: initialized.protocolVersion, names,
            deviceState: device.isError ? "blocked-by-current-capability-or-host" : "inventory-returned",
            deviceResult: device.structuredContent ?? device.content,
            nativeClientVerified: false };
          if (deviceEnabledProbe) assert.notEqual(device.isError, true, "Enabled Device inventory must be available");
          if (selectedAttempt === "project-control-rules") {
            f.browser = await openBrowser({ executable: process.env.WEAVRA_CHROMIUM, home: process.env.HOME,
              profile: join(f.base, "chromium"), headless: true });
            await f.browser.navigate(await mintPairing(f));
            await (await f.browser.arm("() => !!document.querySelector('main [role=combobox]')"))();
            await f.browser.navigate(f.origin + "/" + encodeURIComponent(f.scope.environmentId) + "/" + encodeURIComponent(f.scope.threadId));
            await openProjectControlPanel(f);
            await (await f.browser.arm("() => document.querySelector('[data-weavra-action=start-controlled-task]')?.disabled === false"))();
            const filled = await f.browser.arm("() => document.querySelector('[id$=\"-goal\"]')?.value === 'Fix the greeting implementation'");
            await f.browser.clickAction("start-controlled-task");
            await filled();
            assert.equal(await f.browser.evaluate("document.querySelector('[id$=\"-criteria\"]').value"),
              "The greeting includes Hello\nThe registered greeting test passes");
            assert.equal(await f.browser.evaluate("!!document.querySelector('[data-weavra-action=confirm-implementation]')"), false);
            await f.browser.screenshot(join(evidenceDir, "chat-control-autofill.png"));
            f.row.screenshots.push("chat-control-autofill.png");
            const tasks = await rpc(client, C.WS_METHODS.weavraTaskList, f.scope);
            assert.equal(tasks.length, 1);
            f.remember(tasks[0]);
            const released = await rpc(client, C.WS_METHODS.weavraTaskAbort, {
              task: f.ref(), expectedRevision: f.task.revision,
            });
            assert.equal(released.ownership.state, "released");
            f.row.projectControlRules.chatDraftAutofilled = true;
            f.row.projectControlRules.explicitTaskReleased = true;
          }
          await f.noRun(); await unchangedExcept(f, original);
        } finally {
          if (sessionId) {
            const closed = await fetch(credential.endpoint, { method: "DELETE", headers: headers(),
              signal: AbortSignal.timeout(30_000) });
            f.row.qaMcpCloseStatus = closed.status;
            if (selectedAttempt === "project-control-rules") {
              assert.equal(closed.status, 401, "Controlled takeover must revoke the previous ordinary-provider credential");
              assert.equal((await closed.json()).error, "invalid_mcp_credential");
              f.row.projectControlRules.normalCredentialRevokedOnControl = true;
            } else {
              assert.equal(closed.status, 204, "Owned MCP session must close");
            }
          }
        }
      } finally {
        f.qaCredential = null;
        if (f.row.deviceConfigurationAttempted) {
          const disabled = await rpc(client, C.WS_METHODS.deviceConfigure, {
            enabled: false, agentAccessEnabled: false,
          });
          assert.equal(disabled.hostStatus, "disabled");
          assert.equal(disabled.agentAccessEnabled, false);
          f.row.deviceShutdownConfirmed = true;
        }
      }
    });
  }],
]);

await runCase("paged-issue-assessment", "One explicit action collects every criterion and check page", [
  ["fifty-two-check-records", { evidencePages: true }, async (f) => {
    await connect(f, async client => {
      await f.create(client); await f.prepare(client);
      const feed = await f.observe(client);
      await f.complete(client, feed, () => f.confirm(client));
      assert.equal(f.task.execution.receipt.run.status, "COMPLETED");
      await browserConversation(f);
      const requests = () => f.events.rows.filter(event =>
        event.kind === "request" && event.type === "workflow.evidence").length;
      const before = requests();
      assert.equal(before, 0, "Evidence must not be fetched automatically on mount");
      assert.equal(await f.browser.evaluate(`document.querySelector('[data-issue-verification]')
        ?.getAttribute('data-issue-verification')`), "unverified");
      f.row.assessmentReadiness = await f.browser.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find(button => button.dataset.weavraAction === 'assess-original-issue');
        return { present: !!button, disabled: button?.disabled ?? null,
          nextAction: document.querySelector('[data-next-action]')?.getAttribute('data-next-action') };
      })()`);
      await (await f.browser.arm(`() => [...document.querySelectorAll('button')]
        .some(button => button.dataset.weavraAction === 'assess-original-issue' && !button.disabled)`))();
      const verified = await f.browser.arm(`() => !!document.querySelector('[data-issue-verification="verified"]')`);
      await f.browser.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find(button => button.dataset.weavraAction === 'assess-original-issue' && !button.disabled);
        button.scrollIntoView({ block: 'center', behavior: 'instant' });
        button.focus();
      })()`);
      await f.browser.press("Enter");
      await verified();
      assert.equal(requests() - before, 3, "Two criteria and fifty-two check records require three pages");
      await f.browser.evaluate(`(() => {
        const select = document.querySelector('[data-weavra="controlled-outcome"] select');
        select.value = 'checks';
        select.dispatchEvent(new Event('change', { bubbles: true }));
      })()`);
      await (await f.browser.arm(`() => document.querySelectorAll('[data-weavra-record="checks"]').length === 52`))();
      for (const [width, height] of [[1280, 900], [375, 812]]) {
        await f.browser.viewport(width, height);
        await f.browser.evaluate(`document.querySelector('[data-weavra="controlled-outcome"]')
          .scrollIntoView({ block: 'start', behavior: 'instant' })`);
        const summary = join(evidenceDir, `all-page-assessment-${width}.png`);
        await f.browser.screenshot(summary); f.row.screenshots.push(summary);
        await f.browser.evaluate(`(() => {
          const record = document.querySelector('[data-weavra-record="checks"][data-record-index="52"]');
          const action = [...document.querySelectorAll('button')]
            .find(button => button.dataset.weavraAction === 'assess-original-issue');
          const entry = [...document.querySelectorAll('button')]
            .find(button => button.dataset.weavraAction === 'open-controlled-task');
          record.scrollIntoView({ block: 'center', behavior: 'instant' });
          for (let parent = record.parentElement; parent; parent = parent.parentElement) {
            if (parent.scrollHeight > parent.clientHeight &&
                /auto|scroll/.test(getComputedStyle(parent).overflowY)) {
              const top = record.getBoundingClientRect().top;
              const end = action.getBoundingClientRect().bottom;
              parent.scrollBy({ top: (top + end) / 2 - entry.getBoundingClientRect().top / 2,
                behavior: 'instant' });
              break;
            }
          }
        })()`);
        const last = join(evidenceDir, `all-page-final-record-${width}.png`);
        await f.browser.screenshot(last); f.row.screenshots.push(last);
      }
      const prior = requests();
      await f.browser.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')]
          .find(button => button.dataset.weavraAction === 'assess-original-issue');
        button.focus({ preventScroll: true });
      })()`);
      await f.browser.press("Enter");
      assert.equal(requests(), prior, "Completed assessment must not silently refetch pages");
      f.row.assessment = { explicitOnly: true, requests: prior - before,
        criterionRecords: 2, checkRecords: 52, allPagesRequired: true,
        inputMethod: "trusted CDP Enter", repeatedClickDoesNotRefetch: true };
      await unchangedExcept(f, fixed);
    });
  }],
]);

await runCase("rejected-draft-recovery", "Explicit recovery and reload never replay a refused turn",
  ["text", "slash", "mixed", "send-failure", "send-failure-edited", "missing", "storage", "occupied", "concurrent", "disconnected", "route-change"].map(kind => [
  `${kind}-recovery`, { sharedCheckout: true, hold: true, mode: "misleading" }, async (f) => {
    await connect(f, async (client) => {
      await f.create(client); await f.prepare(client);
      const feed = await f.observe(client);
      const held = f.events.wait(event => event.kind === "worker-held", "owner held before mutation");
      await f.confirm(client); await held;
      const thread = await subscription(f, client[C.ORCHESTRATION_WS_METHODS.subscribeThread]({
        threadId: f.otherThread, requestCompletionMarker: true,
      }), event => event.kind === "synchronized");
      const messageId = randomUUID();
      const withAttachments = ["mixed", "send-failure", "send-failure-edited", "missing", "concurrent"].includes(kind);
      const text = kind === "slash" ? "/model" : withAttachments
        ? "Keep [capture](t3-context://v1/image/recovery_image) and its exact context."
        : "Keep this rejected message exactly. Recovery is not Send.";
      const attachments = [];
      const attachmentBytes = withAttachments ? [
        Buffer.from("Exact recovered file bytes.\n한글\n", "utf8"),
        Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=", "base64"),
      ] : [];
      const metadata = [
        { type: "file", name: "recovery-notes.txt", mimeType: "text/plain" },
        { type: "image", name: "recovery-capture.png", mimeType: "image/png" },
      ];
      for (const [index, bytes] of attachmentBytes.entries()) {
        const item = metadata[index];
        const upload = await rpc(client, C.WS_METHODS.attachmentsCreateUploadUrl,
          { ...item, sizeBytes: bytes.length });
        const response = await fetch(new URL(upload.relativeUrl, f.origin), {
          method: "POST", headers: { "Content-Type": item.mimeType }, body: bytes,
        });
        assert.ok(response.ok, "Initial synthetic attachment upload must succeed");
        attachments.push({ ...item, id: upload.attachmentId, sizeBytes: bytes.length });
      }
      const context = withAttachments ? { version: 1, records: [
        { version: 1, contextId: "recovery_preview", kind: "preview-annotation",
          label: "Original capture annotation", annotationId: "original", pageUrl: "https://example.test/",
          pageTitle: "Synthetic recovery page", comment: "Keep exact annotation",
          targetSummary: "One marked region", styleChanges: [], regionCount: 1, strokeCount: 1,
          screenshotContextId: "recovery_image" },
        { version: 1, contextId: "recovery_image", kind: "image", label: "Exact capture",
          attachmentId: attachments[1].id, name: attachments[1].name,
          mimeType: attachments[1].mimeType, sizeBytes: attachments[1].sizeBytes },
        { version: 1, contextId: "recovery_terminal", kind: "terminal", label: "Exact terminal",
          terminalId: "terminal-qa", terminalLabel: "Terminal QA", lineStart: 1, lineEnd: 2,
          text: "first line\nsecond line" },
      ] } : undefined;
      const persisted = thread.wait(event => event.kind === "event" &&
        event.event.type === "thread.message-sent" &&
        event.event.payload.messageId === messageId, "original rejected payload persisted");
      const refusal = thread.wait(event => event.kind === "event" &&
        event.event.type === "thread.activity-appended" &&
        event.event.payload.activity.kind === "provider.turn.start.failed" &&
        event.event.payload.activity.payload?.requestId === messageId, "durable scoped refusal");
      await rpc(client, C.ORCHESTRATION_WS_METHODS.dispatchCommand, {
        type: "thread.turn.start", commandId: randomUUID(), threadId: f.otherThread,
        message: { messageId, role: "user", text, attachments, ...(context ? { context } : {}) },
        runtimeMode: f.thread.runtimeMode, interactionMode: "default",
        createdAt: new Date().toISOString(),
      });
      const originalMessage = (await persisted).event.payload;
      await refusal;
      if (kind === "missing") {
        const { resolveAttachmentPath } = await import(`${app}/apps/server/src/attachmentStore.ts`);
        const assetPath = resolveAttachmentPath({
          attachmentsDir: join(f.appHome, "userdata", "attachments"),
          attachment: originalMessage.attachments[0],
        });
        assert.ok(assetPath?.startsWith(`${f.base}/`), "Missing-asset probe must stay in its owned fixture");
        await rm(assetPath);
      }
      await browserConversation(f);
      const url = `${f.origin}/${encodeURIComponent(f.environmentId)}/${encodeURIComponent(f.otherThread)}`;
      await f.browser.navigate(url);
      await (await f.browser.arm(`() => !!document.querySelector(
        '[data-recover-message-id="${messageId}"]:not(:disabled)')`))();
      const sentCount = () => thread.rows.filter(event =>
        event.kind === "event" && event.event.type === "thread.message-sent").length;
      const before = sentCount();
      if (kind === "disconnected") {
        await f.complete(client, feed, async () => f.held.resolve());
        assert.notEqual(f.task.execution.receipt.run.status, "COMPLETED");
        const disabled = await f.browser.arm(`() => document.querySelector(
          '[data-recover-message-id="${messageId}"]')?.disabled === true`);
        await f.stop(); await disabled();
        for (const [width, height] of [[1280, 900], [375, 812]]) {
          await f.browser.viewport(width, height);
          const screenshot = join(evidenceDir, `recovery-disconnected-${width}.png`);
          await f.browser.screenshot(screenshot); f.row.screenshots.push(screenshot);
        }
        await f.start(true);
        await connect(f, async restarted => {
          const synced = await subscription(f, restarted[C.ORCHESTRATION_WS_METHODS.subscribeThread]({
            threadId: f.otherThread, requestCompletionMarker: true,
          }), event => event.kind === "synchronized");
          const snapshot = synced.rows.find(event => event.kind === "snapshot").snapshot.thread;
          assert.deepEqual(snapshot.messages.filter(message => message.role === "user")
            .map(message => message.id), [messageId], "Reconnect must not replay the refused message");
        });
        await (await f.browser.arm(`() => !!document.querySelector(
          '[data-recover-message-id="${messageId}"]:not(:disabled)')`))();
        assert.equal(await f.browser.evaluate(`!!document.querySelector(
          '[data-recovered-message-id="${messageId}"]')`), false);
        f.row.recoveryFailure = { kind, originalMessageId: messageId,
          disabledWhileDisconnected: true, noReplayAfterRestart: true, explicitRecoveryStillRequired: true };
        await unchangedExcept(f, original);
        return;
      }
      if (["missing", "storage", "occupied", "concurrent"].includes(kind)) {
        let heldAsset;
        const failureVisible = await f.browser.arm(`() => !!document.querySelector(
          '[aria-label="시작되지 않은 메시지"] [role="alert"]')`);
        if (kind === "storage") {
          await f.browser.evaluate(`(() => {
            window.__restoreRecoveryStorage = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function(value, key) {
              if (this.transaction.db.name === 't3code-composer' && this.name === 'authority' &&
                Object.values(value?.records ?? {}).some(record =>
                  record.value?.rejectedTurn?.messageId === ${JSON.stringify(messageId)})) {
                this.transaction.abort();
                throw new DOMException('QA quota refusal', 'QuotaExceededError');
              }
              return window.__restoreRecoveryStorage.call(this, value, key);
            };
          })()`);
        } else if (kind === "concurrent") {
          await f.browser.evaluate(`(() => {
            window.__heldRecoveryRequests = [];
            window.__recoverySend = WebSocket.prototype.send;
            WebSocket.prototype.send = function(data) {
              if (typeof data === 'string' && data.includes('assets.createUrl')) {
                window.__heldRecoveryRequests.push({ socket: this, data });
                document.documentElement.dataset.recoveryRequestHeld = 'true';
                return;
              }
              return window.__recoverySend.call(this, data);
            };
          })()`);
          heldAsset = await f.browser.arm(`() => document.documentElement.dataset.recoveryRequestHeld === 'true'`);
        } else if (kind === "occupied") {
          await f.browser.evaluate(`(() => {
            const editor = document.querySelector('[data-chat-composer-form] [contenteditable="true"]');
            if (!editor) throw new Error('Composer editor unavailable');
            editor.focus();
          })()`);
          const typed = await f.browser.arm(`() => document.querySelector(
            '[data-chat-composer-form] [contenteditable="true"]')?.textContent.includes('Newer human draft must survive.')`);
          await f.browser.typeText("Newer human draft must survive.");
          await typed();
        }
        await f.browser.click("초안으로 복구");
        if (kind === "concurrent") {
          await heldAsset();
          await f.browser.evaluate(`(() => {
            const editor = document.querySelector('[data-chat-composer-form] [contenteditable="true"]');
            if (!editor) throw new Error('Composer editor unavailable');
            editor.focus();
          })()`);
          const typed = await f.browser.arm(`() => document.querySelector(
            '[data-chat-composer-form] [contenteditable="true"]')?.textContent.includes('Newer human draft must survive.')`);
          await f.browser.typeText("Newer human draft must survive.");
          await typed();
          await f.browser.evaluate(`(() => {
            WebSocket.prototype.send = window.__recoverySend;
            for (const request of window.__heldRecoveryRequests) request.socket.send(request.data);
            delete window.__recoverySend;
            delete window.__heldRecoveryRequests;
            delete document.documentElement.dataset.recoveryRequestHeld;
          })()`);
        }
        await failureVisible();
        if (kind === "storage") {
          await f.browser.evaluate(`(() => {
            IDBObjectStore.prototype.put = window.__restoreRecoveryStorage;
            delete window.__restoreRecoveryStorage;
          })()`);
        }
        assert.equal(await f.browser.evaluate(`!!document.querySelector(
          '[data-recovered-message-id="${messageId}"]')`), false);
        assert.equal(sentCount(), before, "Failed recovery must not dispatch");
        if (kind === "occupied" || kind === "concurrent") {
          assert.ok(await f.browser.evaluate(`document.querySelector(
            '[data-chat-composer-form] [contenteditable="true"]').textContent.includes('Newer human draft must survive.')`));
        }
        for (const [width, height] of [[1280, 900], [375, 812]]) {
          await f.browser.viewport(width, height);
          const screenshot = join(evidenceDir, `recovery-${kind}-refused-${width}.png`);
          await f.browser.screenshot(screenshot); f.row.screenshots.push(screenshot);
        }
        f.row.recoveryFailure = { kind, originalMessageId: messageId,
          draftNotReplaced: true, noDispatch: true, refusalStillVisible: true };
        await unchangedExcept(f, original);
        await f.complete(client, feed, async () => f.held.resolve());
        assert.notEqual(f.task.execution.receipt.run.status, "COMPLETED");
        await unchangedExcept(f, original);
        return;
      }
      const recovered = await f.browser.arm(`() => !!document.querySelector(
        '[data-recovered-message-id="${messageId}"]')`);
      await f.browser.click("초안으로 복구");
      await recovered();
      const readDraft = () => f.browser.evaluate(`new Promise((resolve, reject) => {
        const request = indexedDB.open('t3code-composer');
        request.onupgradeneeded = () => request.transaction.abort();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction('authority', 'readonly');
          const stored = transaction.objectStore('authority').get('state');
          let draft;
          stored.onsuccess = () => {
            draft = stored.result?.records[${JSON.stringify(`draftsByThreadKey/${f.scope.environmentId}:${f.otherThread}`)}]?.value;
          };
          transaction.oncomplete = () => { database.close(); resolve(draft); };
          transaction.onabort = () => { database.close(); reject(transaction.error); };
        };
      })`);
      const firstDraft = await readDraft();
      assert.equal(firstDraft.prompt, text);
      assert.equal(firstDraft.rejectedTurn.messageId, messageId);
      assert.deepEqual(firstDraft.rejectedTurn.attachments, originalMessage.attachments ?? []);
      assert.deepEqual(firstDraft.rejectedTurn.context, originalMessage.context);
      assert.equal(sentCount(), before, "Recovery must not dispatch");
      await f.browser.click("초안으로 복구");
      assert.deepEqual((await readDraft()).rejectedTurn, firstDraft.rejectedTurn);
      assert.equal(sentCount(), before, "Duplicate recovery must not dispatch");
      await f.browser.navigate(url);
      await (await f.browser.arm(`() => !!document.querySelector(
        '[data-recovered-message-id="${messageId}"]')`))();
      assert.equal((await readDraft()).prompt, text);
      assert.deepEqual((await readDraft()).rejectedTurn, firstDraft.rejectedTurn);
      assert.equal(sentCount(), before, "Reload must not dispatch");
      for (const [width, height] of [[1280, 900], [375, 812]]) {
        await f.browser.viewport(width, height);
        const screenshot = join(evidenceDir, `recovered-${kind}-draft-${width}.png`);
        await f.browser.screenshot(screenshot);
        f.row.screenshots.push(screenshot);
      }
      await f.browser.viewport(1280, 900);
      if (kind === "route-change") {
        const destination = randomUUID();
        const destinationTitle = "Task8 navigation target";
        const destinationText = "Keep this independent destination draft exactly.";
        await rpc(client, C.ORCHESTRATION_WS_METHODS.dispatchCommand, {
          type: "thread.create", commandId: randomUUID(), threadId: destination,
          projectId: f.scope.projectId, title: destinationTitle,
          modelSelection: f.thread.modelSelection, runtimeMode: f.thread.runtimeMode,
          interactionMode: "default", branch: null, worktreePath: null,
          createdAt: new Date().toISOString(),
        });
        const destinationFeed = await subscription(f,
          client[C.ORCHESTRATION_WS_METHODS.subscribeThread]({
            threadId: destination, requestCompletionMarker: true,
          }), event => event.kind === "synchronized");
        await f.browser.evaluate(`(() => {
          const send = WebSocket.prototype.send;
          window.__routeSend = { send };
          WebSocket.prototype.send = function(data) {
            if (typeof data === 'string' && data.includes('thread.turn.start')) {
              window.__routeSend.held = { socket: this, data };
              document.documentElement.dataset.routeSendHeld = 'true';
              return;
            }
            return send.call(this, data);
          };
          let committed;
          window.__routeCleanup = new Promise(resolve => committed = resolve);
          const put = IDBObjectStore.prototype.put;
          IDBObjectStore.prototype.put = function(value, key) {
            if (this.transaction.db.name === 't3code-composer' && this.name === 'authority' &&
                value?.records?.[${JSON.stringify(`draftsByThreadKey/${f.environmentId}:${f.otherThread}`)}]?.value === null) {
              this.transaction.addEventListener('complete', () => committed(true), { once: true });
            }
            return put.call(this, value, key);
          };
        })()`);
        const held = await f.browser.arm(`() => document.documentElement.dataset.routeSendHeld === 'true'`);
        await f.browser.evaluate(`document.querySelector('[data-testid="composer-editor"]').focus()`);
        await f.browser.press("Enter");
        await held();
        const destinationReady = await f.browser.arm(`() =>
          location.pathname.endsWith('/${destination}') &&
          document.querySelector('[aria-label="대화 경로"]')?.textContent
            .includes(${JSON.stringify(destinationTitle)}) &&
          !!document.querySelector('[data-testid="composer-editor"][contenteditable="true"]')`);
        await (await f.browser.arm(`() => [...document.querySelectorAll('[role="button"]')]
          .some(b => b.textContent.includes(${JSON.stringify(destinationTitle)}))`))();
        await f.browser.evaluate(`(() => {
          const button = [...document.querySelectorAll('[role="button"]')].find(b =>
            b.textContent.includes(${JSON.stringify(destinationTitle)}));
          if (!button) throw new Error('Destination sidebar button unavailable');
          button.click();
        })()`);
        await destinationReady();
        await f.browser.evaluate(`document.querySelector('[data-testid="composer-editor"]').focus()`);
        await f.browser.typeText(destinationText);
        await f.browser.evaluate(`(() => {
          const held = window.__routeSend.held;
          WebSocket.prototype.send = window.__routeSend.send;
          held.socket.send(held.data);
        })()`);
        await f.browser.evaluate("window.__routeCleanup");
        await f.browser.evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
        const visibleDraft = await f.browser.evaluate(
          `document.querySelector('[data-testid="composer-editor"]').textContent`);
        assert.equal(visibleDraft, destinationText);
        f.row.routeChange = { destination, visibleDraft, sourceCleanupCommitted: true, exactDestinationSend: false };
        const routeScreenshot = join(evidenceDir, "recovered-send-route-destination-1280.png");
        await f.browser.screenshot(routeScreenshot);
        f.row.screenshots.push(routeScreenshot);
        const destinationSent = destinationFeed.wait(event => event.kind === "event" &&
          event.event.type === "thread.message-sent" &&
          event.event.payload.text === destinationText, "destination draft remains sendable", undefined, 10_000);
        await f.browser.evaluate(`document.querySelector('[data-testid="composer-editor"]').focus()`);
        await f.browser.press("Enter");
        await destinationSent;
        f.row.routeChange.exactDestinationSend = true;
        await unchangedExcept(f, original);
        await f.complete(client, feed, async () => f.held.resolve());
        assert.notEqual(f.task.execution.receipt.run.status, "COMPLETED");
        await unchangedExcept(f, original);
        return;
      }
      if (kind === "send-failure" || kind === "send-failure-edited") {
        f.row.recoveryStage = "attach-added-image";
        const addedImagePath = join(f.base, "recovery-added.png");
        await writeFile(addedImagePath, attachmentBytes[1]);
        await f.browser.evaluate(`(() => {
          window.__recoveryPreviewUrls = [];
          window.__recoveryRevokedUrls = [];
          window.__originalCreateObjectUrl = URL.createObjectURL;
          window.__originalRevokeObjectUrl = URL.revokeObjectURL;
          URL.createObjectURL = function(blob) {
            const url = window.__originalCreateObjectUrl.call(this, blob);
            if (blob instanceof File && blob.name === 'recovery-added.png')
              window.__recoveryPreviewUrls.push(url);
            return url;
          };
          URL.revokeObjectURL = function(url) {
            window.__recoveryRevokedUrls.push(url);
            return window.__originalRevokeObjectUrl.call(this, url);
          };
          window.__originalUploadSend = XMLHttpRequest.prototype.send;
          XMLHttpRequest.prototype.send = function(body) {
            if (body instanceof File && body.name === 'recovery-added.png') {
              this.addEventListener('load', () => {
                if (this.status >= 200 && this.status < 300)
                  document.documentElement.dataset.recoveryAddedUpload = 'ready';
              }, { once: true });
            }
            return window.__originalUploadSend.call(this, body);
          };
        })()`);
        const addedUpload = await f.browser.arm(`() => document.documentElement.dataset.recoveryAddedUpload === 'ready'`);
        await (await f.browser.arm(`() => !!document.querySelector('[data-chat-composer-form] input[type="file"]')`))();
        await f.browser.setFiles('[data-chat-composer-form] input[type="file"]', [addedImagePath]);
        await addedUpload();
        f.row.recoveryStage = "inspect-added-preview";
        const previewUrl = await f.browser.evaluate("window.__recoveryPreviewUrls[0]");
        assert.ok(previewUrl?.startsWith("blob:"), "Added draft image must own a preview URL");
        assert.equal(await f.browser.evaluate(`fetch(${JSON.stringify(previewUrl)}).then(response => response.ok, () => false)`), true);
        const attachmentDir = join(f.appHome, "userdata", "attachments");
        const pendingNames = async () => (await readdir(attachmentDir)).filter(name => name.startsWith("pending-")).sort();
        const pendingBefore = await pendingNames();
        const nonexistentThreadId = randomUUID();
        await f.browser.evaluate(`(() => {
          window.__recoveryTransportSend = WebSocket.prototype.send;
          WebSocket.prototype.send = function(data) {
            if (typeof data !== 'string' || !data.includes('thread.turn.start'))
              return window.__recoveryTransportSend.call(this, data);
            let messageId;
            const replace = value => {
              if (!value || typeof value !== 'object') return value;
              if (value.type === 'thread.turn.start') {
                messageId = value.message.messageId;
                value.threadId = ${JSON.stringify(nonexistentThreadId)};
              }
              for (const child of Object.values(value)) replace(child);
              return value;
            };
            const changed = data.split('\\n').map(line => line.trim()
              ? JSON.stringify(replace(JSON.parse(line))) : line).join('\\n');
            if (!messageId) return window.__recoveryTransportSend.call(this, data);
            window.__heldFailureSend = { socket: this, data: changed, messageId };
            document.documentElement.dataset.recoveryFailureSendHeld = 'true';
          };
        })()`);
        const sendHeld = await f.browser.arm(`() => document.documentElement.dataset.recoveryFailureSendHeld === 'true'`);
        const optimisticVisible = await f.browser.arm(`() => {
          const id = window.__heldFailureSend?.messageId;
          return !!id && [...document.querySelectorAll('[data-timeline-row-id]')]
            .some(row => row.getAttribute('data-timeline-row-id').includes(id));
        }`);
        await f.browser.evaluate(`document.querySelector('[data-chat-composer-form] [contenteditable="true"]').focus()`);
        f.row.recoveryStage = "hold-send";
        await f.browser.press("Enter"); await sendHeld();
        f.row.recoveryStage = "observe-optimistic-row";
        await optimisticVisible();
        const freshPending = (await pendingNames()).filter(name => !pendingBefore.includes(name));
        assert.equal(freshPending.length, originalMessage.attachments.length,
          "Recovered Send must create its own temporary uploads before dispatch");
        if (kind === "send-failure-edited") {
          const typed = await f.browser.arm(`() => document.querySelector(
            '[data-chat-composer-form] [contenteditable="true"]')?.textContent.includes('Newer draft while Send is pending.')`);
          await f.browser.typeText(" Newer draft while Send is pending.");
          await typed();
        }
        const retainedDisplayText = await f.browser.evaluate(`document.querySelector(
          '[data-chat-composer-form] [contenteditable="true"]').textContent`);
        const cleaned = Promise.withResolvers();
        const inspectPending = async () => {
          try {
            if (JSON.stringify(await pendingNames()) === JSON.stringify(pendingBefore)) cleaned.resolve();
          } catch (error) { cleaned.reject(error); }
        };
        const observer = watch(attachmentDir, () => { void inspectPending(); });
        const cleanupReady = bounded(cleaned.promise, "recovered pending uploads removed after failed Send", 20_000);
        cleanupReady.catch(() => {});
        try {
          f.row.recoveryStage = "release-failed-send";
          const rowRemoved = await f.browser.arm(`() => {
            const id = window.__heldFailureSend?.messageId;
            return !!id && ![...document.querySelectorAll('[data-timeline-row-id]')]
              .some(row => row.getAttribute('data-timeline-row-id').includes(id));
          }`);
          await f.browser.evaluate(`(() => {
            WebSocket.prototype.send = window.__recoveryTransportSend;
            const held = window.__heldFailureSend;
            held.socket.send(held.data);
          })()`);
          await rowRemoved(); await cleanupReady;
          f.row.recoveryStage = "inspect-retained-draft";
          const attemptedMessageId = await f.browser.evaluate("window.__heldFailureSend.messageId");
          assert.notEqual(attemptedMessageId, messageId, "Recovered Send must use a fresh identity");
          const retainedAttempt = { ...firstDraft.rejectedTurn, sendAttempt: attemptedMessageId };
          const retained = await readDraft();
          assert.deepEqual(retained.rejectedTurn, retainedAttempt);
          assert.equal(await f.browser.evaluate(`document.querySelector(
            '[data-chat-composer-form] [contenteditable="true"]').textContent`), retainedDisplayText);
          assert.equal(sentCount(), before, "Rejected dispatch must not persist a new message");
          const previewAlive = await f.browser.evaluate(`fetch(${JSON.stringify(previewUrl)}).then(response => response.ok, () => false)`);
          for (const [width, height] of [[1280, 900], [375, 812]]) {
            f.row.recoveryStage = `failed-send-layout-${width}`;
            await f.browser.viewport(width, height);
            const layout = await f.browser.evaluate(`(async () => {
              const form = document.querySelector('[data-chat-composer-form]');
              await Promise.allSettled(form.getAnimations({ subtree: true })
                .filter(animation => animation.effect?.getTiming().iterations !== Infinity)
                .map(animation => animation.finished));
              await new Promise(resolve => requestAnimationFrame(resolve));
              const editor = form.querySelector('[contenteditable="true"]');
              const footer = form.querySelector('[data-chat-composer-footer="true"]');
              const range = document.createRange();
              range.selectNodeContents(editor);
              return { text: range.getBoundingClientRect().toJSON(),
                footer: footer?.getBoundingClientRect().toJSON() ?? null };
            })()`);
            f.row.failedSendLayouts ??= [];
            f.row.failedSendLayouts.push({ width, height, ...layout });
            const screenshot = join(evidenceDir, `recovered-send-failed-${width}.png`);
            await f.browser.screenshot(screenshot); f.row.screenshots.push(screenshot);
          }
          f.row.failedSend = { pendingUploadsRemoved: true, optimisticRowRemoved: true,
            durableDraftRetained: true, previewAlive, newMessageCount: sentCount() - before,
            attemptedMessageId, attemptFenceRetained: true,
            concurrentEditRetained: kind === "send-failure-edited" };
          assert.equal(previewAlive, true, "Failed recovered Send must preserve the retained draft's image URL");
          await f.browser.navigate(url);
          f.row.recoveryStage = "reload-failed-send";
          await (await f.browser.arm(`() => !!document.querySelector(
            '[data-recovered-message-id="${messageId}"]')`))();
          assert.deepEqual((await readDraft()).rejectedTurn, retainedAttempt);
          if (kind === "send-failure-edited")
            assert.ok((await readDraft()).prompt.includes("Newer draft while Send is pending."));
          assert.equal(sentCount(), before, "Reload after failed Send must not replay");
          f.row.failedSend.noReplayAfterReload = true;
          f.row.recoveryStage = "failed-send-verified";
        } finally {
          observer.close();
          cleaned.reject(new Error("Owned cleanup observer closed"));
        }
        await unchangedExcept(f, original);
        await f.complete(client, feed, async () => f.held.resolve());
        assert.notEqual(f.task.execution.receipt.run.status, "COMPLETED");
        await unchangedExcept(f, original);
        return;
      }
      const retried = thread.wait(event => event.kind === "event" &&
        event.event.type === "thread.message-sent" &&
        event.event.payload.messageId !== messageId, "one new explicitly sent message");
      const retryRefusal = thread.wait(event => event.kind === "event" &&
        event.event.type === "thread.activity-appended" &&
        event.event.payload.activity.kind === "provider.turn.start.failed" &&
        event.event.payload.activity.payload?.requestId !== messageId, "new send still respects owner");
      await f.browser.evaluate(`(() => {
        const editor = document.querySelector('[data-chat-composer-form] [contenteditable="true"]');
        if (!editor) throw new Error('Recovered composer editor unavailable');
        editor.focus();
      })()`);
      await f.browser.press("Enter");
      const retry = await retried;
      await retryRefusal;
      assert.equal(sentCount(), before + 1);
      assert.notEqual(retry.event.payload.messageId, messageId);
      assert.equal(retry.event.payload.text, originalMessage.text);
      const sentAttachments = retry.event.payload.attachments ?? [];
      assert.equal(sentAttachments.length, attachmentBytes.length);
      for (const [index, attachment] of sentAttachments.entries()) {
        const source = originalMessage.attachments[index];
        assert.notEqual(attachment.id, source.id, "Explicit Send must use a fresh transport identity");
        assert.deepEqual({ ...attachment, id: source.id }, source);
        const asset = await rpc(client, C.WS_METHODS.assetsCreateUrl, {
          resource: { _tag: "attachment", attachmentId: attachment.id,
            fileName: attachment.name, mimeType: attachment.mimeType },
        });
        const response = await fetch(new URL(asset.relativeUrl, f.origin));
        assert.ok(response.ok);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), attachmentBytes[index]);
      }
      if (context) {
        const expectedRecords = originalMessage.context.records.map(record =>
          "attachmentId" in record
            ? { ...record, attachmentId: sentAttachments[originalMessage.attachments
                .findIndex(attachment => attachment.id === record.attachmentId)].id }
            : record);
        assert.deepEqual(retry.event.payload.context, { ...originalMessage.context, records: expectedRecords });
      }
      await (await f.browser.arm(`() => !document.querySelector(
        '[data-recovered-message-id="${messageId}"]')`))();
      f.row.recovery = {
        originalMessageId: messageId, retriedMessageId: retry.event.payload.messageId,
        recoveredWithoutDispatch: true, duplicateIdempotent: true, durableReload: true,
        explicitSendOnly: true, ownerStillEnforced: true,
        attachmentCount: sentAttachments.length, exactBytesAndMetadata: true,
        exactContextExceptAttachmentBindings: true,
      };
      await unchangedExcept(f, original);
      await f.complete(client, feed, async () => f.held.resolve());
      assert.notEqual(f.task.execution.receipt.run.status, "COMPLETED");
      await unchangedExcept(f, original);
    });
  }]),
);

await runCase("wrong-thread-checkout", "Task cannot be hijacked by another thread or retargeted checkout", [["identity-mismatch", {}, async (f) => {
  await connect(f, async (client) => {
    await f.create(client); await f.prepare(client);
    const otherRef = { ...f.ref(), threadId: f.otherThread };
    await refused(client, C.WS_METHODS.weavraTaskRead, otherRef, ["TARGET_CHANGED"]);
    await refused(client, C.WS_METHODS.weavraTaskConfirm, { ...f.confirmInput(), task: otherRef }, ["TARGET_CHANGED"]);
    await refused(client, C.WS_METHODS.weavraTaskCancel, { task: otherRef, expectedRunId: "not-a-Run", expectedStateRevision: 1 }, ["TARGET_CHANGED"]);
    const change = await Effect.runPromise(client[C.ORCHESTRATION_WS_METHODS.dispatchCommand]({ type: "thread.meta.update",
      commandId: randomUUID(), threadId: f.scope.threadId, worktreePath: f.other }).pipe(Effect.result));
    if (change._tag === "Success") {
      await refused(client, C.WS_METHODS.weavraTaskRead, f.ref(), ["TARGET_CHANGED"]);
      await refused(client, C.WS_METHODS.weavraTaskConfirm, f.confirmInput(), ["TARGET_CHANGED"]);
    } else f.row.retargetRejectedAtCommand = true;
    await f.noRun(); await unchangedExcept(f, original);
    f.row.assertions = ["cross-thread read/confirm/cancel rejected", "different real Git worktree cannot hijack task", "zero worker/admission/Run", "both checkout bytes unchanged"];
  });
}]]);

await runCase("competing-provider-settings-terminal", "Exclusive checkout ownership across managed writers", [
  ["terminal-already-open", { sharedCheckout: true }, async (f) => {
    await connect(f, async (client) => {
      const terminal = { threadId: f.otherThread, terminalId: "task8-terminal" };
      await rpc(client, C.WS_METHODS.terminalOpen, { ...terminal, cwd: f.target });
      await f.create(client); await f.prepare(client);
      await refused(client, C.WS_METHODS.weavraTaskConfirm, f.confirmInput(), ["TERMINAL_ACTIVE"]);
      await f.noRun(); await unchangedExcept(f, original);
      await rpc(client, C.WS_METHODS.terminalClose, terminal);
      f.row.assertions = ["active terminal refused handoff without killing user terminal", "no Runtime admission", "no workspace changes"];
    });
  }],
  ...[true, false].map(sharedCheckout => [
    sharedCheckout ? "runtime-owner" : "sibling-runtime-owner",
    { sharedCheckout, hold: true, mode: "misleading" }, async (f) => {
    await connect(f, async (client) => {
      if (!sharedCheckout) {
        assert.notEqual(f.target, f.other);
        assert.equal((await f.git("rev-parse", "--path-format=absolute", "--git-common-dir")).trim(),
          (await f.git("-C", f.other, "rev-parse", "--path-format=absolute", "--git-common-dir")).trim());
      }
      await f.create(client); await f.prepare(client); const feed = await f.observe(client);
      const held = f.events.wait((e) => e.kind === "worker-held", "exact worker held before any file tool");
      await f.confirm(client); await held;
      await f.reconcile(client);
      await browserConversation(f);
      await (await f.browser.arm(`() => [...document.querySelectorAll('button')]
        .some(button => button.dataset.weavraAction === 'recover-interrupted-task' && !button.disabled)`))();
      const busyResponse = f.events.wait((event) => event.kind === "response" &&
        event.type === "workflow.recover" && !event.success, "live owner refuses explicit recovery");
      const busyGuidance = await f.browser.arm(`() => document.body.innerText.includes('RECOVERY_BUSY')`);
      await f.browser.clickAction("recover-interrupted-task");
      await busyResponse;
      await busyGuidance();
      assert.equal(await f.browser.evaluate("document.body.innerText.includes('중단을 기록했어요.')"), false);
      assert.equal((await f.readState()).runs[0].status, "RUNNING");
      for (const [width, height] of [[1280, 900], [375, 812]]) {
        await f.browser.viewport(width, height);
        await f.browser.evaluate(`document.querySelector('[data-weavra="controlled-task"] [role="alert"]').scrollIntoView({ block: 'center' })`);
        const path = join(evidenceDir, `${f.row.label}-live-recovery-rejected-${width}.png`);
        await f.browser.screenshot(path);
        const image = await readFile(path);
        assert.equal(image.readUInt32BE(16), width);
        assert.equal(image.readUInt32BE(20), height);
        f.row.screenshots.push(path);
      }
      const state = feed.rows.filter((o) => !o.stale && o.state).at(-1).state;
      await refused(client, C.WS_METHODS.weavraControl, { projectId: f.scope.projectId, request: {
        protocolVersion: 1, id: state.nextRequestId, ownerId: state.ownerId,
        expectedProjectRevision: state.projectRevision, type: "workflow.prepare", goal: fixture.goal } }, ["STATE_UNAVAILABLE"]);
      await refused(client, C.WS_METHODS.projectsWriteFile, { cwd: f.target, relativePath: sourcePath, contents: "unintended" });
      await refused(client, C.WS_METHODS.terminalOpen, { threadId: f.otherThread, terminalId: "task8-competing", cwd: f.target });
      const thread = await subscription(f, client[C.ORCHESTRATION_WS_METHODS.subscribeThread]({
        threadId: f.otherThread, requestCompletionMarker: true }), (e) => e.kind === "synchronized");
      const commandId = randomUUID();
      const messageId = randomUUID();
      // The public thread stream excludes internal turn-start request events.
      const accepted = thread.wait((e) => e.kind === "event" && e.event.type === "thread.message-sent" &&
        e.event.commandId === commandId && e.event.payload.messageId === messageId,
        "competing user message persisted");
      const providerStartsBefore = f.events.rows.filter(event =>
        event.kind === "analysis-request" && ["thread/start", "turn/start"].includes(event.method)).length;
      const denied = thread.wait(event => event.kind === "event" &&
        event.event.type === "thread.activity-appended" &&
        event.event.payload.threadId === f.otherThread &&
        event.event.payload.activity.kind === "provider.turn.start.failed" &&
        event.event.payload.activity.payload?.requestId === messageId,
        "persisted client-visible ownership refusal");
      await rpc(client, C.ORCHESTRATION_WS_METHODS.dispatchCommand, { type: "thread.turn.start", commandId,
        threadId: f.otherThread, message: { messageId, role: "user", text: "Change the greeting now", attachments: [] },
        runtimeMode: f.thread.runtimeMode, interactionMode: "default", createdAt: new Date().toISOString() });
      await accepted;
      const refusal = (await denied).event.payload.activity;
      const decoded = C.decodeWorkspaceTurnStartRefusalPayload(refusal.payload);
      assert.equal(decoded._tag, "Some", "Refusal must use the bounded public contract");
      assert.equal(decoded.value.originCommandId, commandId);
      assert.equal(refusal.id, C.makeWorkspaceTurnStartRefusalIdentity(f.otherThread, messageId).activityId);
      assert.equal(JSON.stringify(refusal.payload).includes(f.task.id), false,
        "Competing client must not receive the owner's task identity");
      assert.equal(f.events.rows.filter(event =>
        event.kind === "analysis-request" && ["thread/start", "turn/start"].includes(event.method)).length,
        providerStartsBefore, "Persisted refusal must precede all provider work");
      f.row.clientRefusal = { messageId, commandId, activityId: refusal.id,
        reason: decoded.value.reason, persistedCorrelation: true, noProviderStart: true,
        sharedCheckout, sharedGitCommonDir: true };
      await unchangedExcept(f, original);
      await f.complete(client, feed, async () => f.held.resolve());
      assert.notEqual(f.task.execution.receipt.run.status, "COMPLETED");
      assert.equal(f.events.rows.filter((e) => e.kind === "analysis-request" && e.method === "turn/start").length, 0);
      assert.equal(f.events.rows.filter((e) => e.kind === "request" && e.type === "workflow.confirm").length, 1);
      await unchangedExcept(f, original);
      f.row.assertions = ["provider/settings/file-save/terminal rejected during Runtime ownership", "only one real Run", "no competing edits or provider turn", "misleading owner never completes"];
    });
  }]),
]);

await runCase("project-setup", "Explicit in-app project setup without Git mutation or model use", [["review-and-save", { projectSetup: true }, async (f) => {
  await rm(join(f.target, ".ai/config.yaml"));
  await writeFile(join(f.target, ".gitignore"), "");
  await f.git("add", ".gitignore");
  await f.git("commit", "-qm", "Unignored setup fixture");
  const head = (await f.git("rev-parse", "HEAD")).trim();
  await connect(f, async (client) => {
    await refused(client, C.WS_METHODS.weavraTaskCreate, { ...f.scope, commandId: randomUUID() }, ["PROJECT_NOT_CONFIGURED"]);
  });
  await connect(f, async (client) => {
    await refused(client, C.WS_METHODS.weavraProjectSetup, { scope: f.scope, action: "draft" }, ["EnvironmentAuthorizationError"]);
  }, "orchestration:read");
  const pairingUrl = await mintPairing(f);
  f.browser = await openBrowser({ executable: process.env.WEAVRA_CHROMIUM, home: process.env.HOME,
    profile: join(f.base, "chromium"), headless: true });
  await f.browser.navigate(pairingUrl);
  await (await f.browser.arm(`() => !!document.querySelector('main [role="combobox"]')`))();
  await f.browser.navigate(`${f.origin}/${encodeURIComponent(f.scope.environmentId)}/${encodeURIComponent(f.scope.threadId)}`);
  await openProjectControlPanel(f);
  await (await f.browser.arm(`() => [...document.querySelectorAll('button')].some(b => b.dataset.weavraAction === 'start-controlled-task' && !b.disabled)`))();
  await (await f.browser.arm(`() => [...document.querySelectorAll('button')].some(b => b.dataset.weavraAction === 'set-up-project' && !b.disabled)`))();
  await f.noRun();
  const capture = async (state) => {
    for (const width of [1280, 375]) for (const theme of ["light", "dark"]) {
      await f.browser.viewport(width, 900);
      await f.browser.evaluate(`document.documentElement.classList.toggle('dark', ${theme === "dark"})`);
      await f.browser.evaluate(`document.querySelector('[data-weavra="controlled-task"]').scrollIntoView({block:'start'})`);
      assert.equal(await f.browser.evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
      const file = `${state}-${width}-${theme}.png`;
      await f.browser.screenshot(join(evidenceDir, file));
      f.row.screenshots.push(file);
      if (state === "setup-review") {
        await f.browser.evaluate(`(() => {
          const button = [...document.querySelectorAll('button')].find(b => b.dataset.weavraAction === 'save-project-setup');
          button.scrollIntoView({block:'center'});
        })()`);
        const actions = `${state}-actions-${width}-${theme}.png`;
        await f.browser.screenshot(join(evidenceDir, actions));
        f.row.screenshots.push(actions);
        assert.equal(await f.browser.evaluate(`(() => {
          const button = [...document.querySelectorAll('button')].find(b => b.dataset.weavraAction === 'save-project-setup');
          const r = button.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          // Disabled buttons deliberately use pointer-events:none; their own action row is the hit target.
          return button.parentElement.contains(hit);
        })()`), true, "Save must be reachable without composer overlap");
      }
    }
    await f.browser.viewport(1280, 900);
  };
  await capture("setup-missing");
  const draftReady = await f.browser.arm(`() => !!document.querySelector('textarea[id$="-yaml"]')`);
  await f.browser.clickAction("set-up-project");
  await draftReady();
  assert.equal(await f.browser.evaluate(`document.querySelector('[data-weavra="claude-code-consent"]').checked`), false);
  assert.equal(await f.browser.evaluate(`document.querySelector('[data-weavra="evidence-profile"]').value`), "default");
  assert.equal(await exists(join(f.target, ".ai/config.yaml")), false);
  assert.equal(await f.browser.evaluate(`(() => {
    const save = [...document.querySelectorAll('button')].find(b => b.dataset.weavraAction === 'save-project-setup');
    return !!save && save.disabled;
  })()`), true);
  await capture("setup-review");
  const reviewedConfig = structuredClone(f.config);
  delete reviewedConfig.verification.checks[0].required;
  reviewedConfig.verification.checks[0].repairable_exit_codes = [1];
  const reviewed = JSON.stringify(reviewedConfig, null, 2);
  await f.browser.evaluate(`(() => {
    const field = document.querySelector('textarea[id$="-yaml"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, ${JSON.stringify(reviewed)});
    field.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-review"]').click()`);
  const saved = await f.browser.arm(`() => !!document.querySelector('[data-weavra-action="initialize-runtime-home"]')`);
  await f.browser.clickAction("save-project-setup");
  await saved();
  const initialized = await f.browser.arm(`() => !!document.querySelector('[data-weavra="project-setup-status"][data-result-kind="initialized"][aria-busy="false"]')`);
  await f.browser.clickAction("initialize-runtime-home");
  await initialized();
  const ready = await f.browser.arm(`() => !!document.querySelector('[data-weavra="project-setup-status"][data-ready="true"]')`);
  await f.browser.clickAction("recheck-project-setup");
  await ready();
  assert.equal(await readFile(join(f.target, ".ai/config.yaml"), "utf8"), reviewed);
  assert.equal((await f.git("rev-parse", "HEAD")).trim(), head);
  assert.equal(await f.git("status", "--porcelain"), "?? .ai/\n");
  await capture("setup-ready");
  const editable = await f.browser.arm(`() => {
    const input = document.querySelector('[data-weavra="model-coding-id"]');
    return !!input && !input.disabled;
  }`);
  await f.browser.clickAction("edit-project-setup");
  await editable();
  assert.equal(await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-yaml"]').value`), reviewed);
  assert.deepEqual(await f.browser.evaluate(`(() => {
    const setup = document.querySelector('[data-weavra="project-setup-status"]');
    return {
      sandbox: setup.querySelector('select:has(option[value="disabled"])').value,
      required: setup.querySelector('fieldset input[type="checkbox"]').checked,
    };
  })()`), { sandbox: "disabled", required: true });
  const modelEdited = await f.browser.arm(`() => document.querySelector('[data-weavra="project-setup-yaml"]').value.includes('edited-fixture')`);
  await f.browser.evaluate(`(() => {
    const input = document.querySelector('[data-weavra="model-coding-id"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'edited-fixture');
    input.dispatchEvent(new Event('input', {bubbles:true}));
  })()`);
  await modelEdited();
  const modelSaved = await f.browser.arm(`() => !!document.querySelector('[data-result-kind="saved"][aria-busy="false"]')`);
  await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-review"]').click()`);
  await f.browser.clickAction("update-project-setup");
  await modelSaved();
  const afterModel = parseRuntimeConfig(await readFile(join(f.target, ".ai/config.yaml"), "utf8"));
  assert.equal(afterModel.models.profiles.coding.model, "edited-fixture");
  assert.equal(afterModel.verification.sandbox.mode, "disabled");
  assert.equal(afterModel.verification.checks[0].required, true);
  const checkEditable = await f.browser.arm(`() => {
    const input = document.querySelector('[data-weavra="project-check-id"]');
    return !!input && !input.disabled;
  }`);
  await f.browser.clickAction("edit-project-setup");
  await checkEditable();
  await f.browser.evaluate(`(() => {
    window.__setupCheckInput = document.querySelector('[data-weavra="project-check-id"]');
    window.__setupCheckInput.focus();
    window.__setupCheckInput.select();
  })()`);
  let renamedId = "";
  for (const part of ["eval-", "renamed"]) {
    renamedId += part;
    const rendered = await f.browser.arm(`() => document.querySelector('[data-weavra="project-setup-yaml"]').value.includes(${JSON.stringify(renamedId)})`);
    await f.browser.typeText(part);
    await rendered();
    assert.equal(await f.browser.evaluate(`window.__setupCheckInput.isConnected && document.activeElement === window.__setupCheckInput`), true,
      "Editing a check ID must keep the same focused input mounted");
  }
  const renameSaved = await f.browser.arm(`() => !!document.querySelector('[data-result-kind="saved"][aria-busy="false"]')`);
  await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-review"]').click()`);
  await f.browser.clickAction("update-project-setup");
  await renameSaved();
  const renamedConfig = parseRuntimeConfig(await readFile(join(f.target, ".ai/config.yaml"), "utf8"));
  assert.equal(renamedConfig.verification.checks[0].id, "eval-renamed");
  assert.deepEqual(renamedConfig.verification.checks[0].trust.files, f.config.verification.checks[0].trust.files);
  assert.deepEqual(renamedConfig.verification.checks[0].repairable_exit_codes, [1]);
  f.row.safeReedit = { omittedSandboxPreserved: true, omittedRequiredShown: true,
    renamedAdvancedFieldsPreserved: true, typingFocusPreserved: true };
  await connect(f, async (client) => {
    const read = await rpc(client, C.WS_METHODS.weavraProjectSetup, { scope: f.scope, action: "read" });
    assert.equal(read.result.kind, "read");
    const updated = await rpc(client, C.WS_METHODS.weavraProjectSetup, {
      scope: f.scope, action: "update", targetDigest: read.targetDigest,
      expectedConfigDigest: read.result.configDigest, yaml: reviewed + "\n",
    });
    assert.equal(updated.result.kind, "saved");
    const stale = await rpc(client, C.WS_METHODS.weavraProjectSetup, {
      scope: f.scope, action: "update", targetDigest: read.targetDigest,
      expectedConfigDigest: read.result.configDigest, yaml: reviewed,
    });
    assert.equal(stale.result.kind, "error");
    assert.equal(stale.result.code, "STALE_CONFIG");
    assert.equal(await readFile(join(f.target, ".ai/config.yaml"), "utf8"), reviewed + "\n");
    const current = await rpc(client, C.WS_METHODS.weavraProjectSetup, { scope: f.scope, action: "read" });
    const restored = await rpc(client, C.WS_METHODS.weavraProjectSetup, {
      scope: f.scope, action: "update", targetDigest: current.targetDigest,
      expectedConfigDigest: current.result.configDigest, yaml: reviewed,
    });
    assert.equal(restored.result.kind, "saved");
  });
  await connect(f, async (client) => {
    const draft = await rpc(client, C.WS_METHODS.weavraProjectSetup, { scope: f.scope, action: "draft" });
    const refusedOverwrite = await rpc(client, C.WS_METHODS.weavraProjectSetup, {
      scope: f.scope, action: "save", targetDigest: draft.targetDigest, yaml: reviewed + "\n",
    });
    assert.equal(refusedOverwrite.result.kind, "error");
    assert.equal(await readFile(join(f.target, ".ai/config.yaml"), "utf8"), reviewed);
  });
  const started = await f.browser.arm(`() => [...document.querySelectorAll('button')].some(b => b.dataset.weavraAction === 'prepare-handoff')`);
  await f.browser.clickAction("start-controlled-task");
  await started();
  await connect(f, async (client) => {
    const tasks = await rpc(client, C.WS_METHODS.weavraTaskList, f.scope);
    assert.equal(tasks.length, 1);
    f.remember(tasks[0]);
    await f.noRun();
    await rpc(client, C.WS_METHODS.weavraTaskAbort, { task: f.ref(), expectedRevision: f.task.revision });
  });
  f.row.assertions = ["actual missing-config card and setup button", "no writes before explicit reviewed Save",
    "actual launcher JSON and YAML stdin boundary", "read-only principal denied", "doctor READY",
    "atomic no-overwrite", "untracked .ai config permits task creation", "Git HEAD unchanged", "no model requests"];
}]]);

await runCase("project-presets", "Automatic Balanced defaults and deliberate preset changes without model execution", [
  ["balanced-default-and-quality-selection", { projectSetup: true, projectPresets: true }, async (f) => {
    await rm(join(f.target, ".ai/config.yaml"));
    await writeFile(join(f.target, "package.json"), JSON.stringify({
      type: "module", scripts: { test: "node --test test/eval.test.mjs" },
    }));
    await f.git("add", "package.json");
    await f.git("commit", "-qm", "Preset setup fixture");
    const head = (await f.git("rev-parse", "HEAD")).trim();
    f.browser = await openBrowser({ executable: process.env.WEAVRA_CHROMIUM, home: process.env.HOME,
      profile: join(f.base, "chromium"), headless: true });
    await f.browser.navigate(await mintPairing(f));
    await (await f.browser.arm(`() => !!document.querySelector('main [role="combobox"]')`))();
    await f.browser.navigate(`${f.origin}/${encodeURIComponent(f.scope.environmentId)}/${encodeURIComponent(f.scope.threadId)}`);
    await openProjectControlPanel(f);
    await (await f.browser.arm(`() => document.querySelector('[data-weavra="project-preset"]')?.value.startsWith('balanced:') &&
      !document.querySelector('[data-weavra="project-preset"]').disabled`))();
    assert.equal(await exists(join(f.target, ".ai/config.yaml")), false, "Automatic preparation does not save");
    assert.equal(await f.browser.evaluate(`!!document.querySelector('[data-weavra="project-setup-review"]')`), false);
    assert.equal(await f.browser.evaluate(`document.querySelector('[data-weavra="project-preset"] option:checked').textContent.includes('gpt-5.6-sol')`), true);
    const capture = async (state) => {
      for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
        await f.browser.viewport(width, 900, width === 390 ? 3 : 1);
        await f.browser.evaluate(`document.documentElement.classList.toggle('dark', ${theme === "dark"})`);
        await f.browser.evaluate(`document.querySelector('[data-weavra="project-defaults"]').scrollIntoView({block:'center'})`);
        assert.equal(await f.browser.evaluate(`document.documentElement.scrollWidth > innerWidth`), false);
        const geometry = await f.browser.evaluate(`(() => {
          const button = document.querySelector('[data-weavra-action="prepare-project-defaults"]');
          if (!button) return null;
          button.scrollIntoView({block:'center'});
          const rect = button.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom,
            hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === button };
        })()`);
        if (geometry) assert.equal(geometry.hit, true, "Preset setup action is reachable");
        const file = `preset-${state}-${width}-${theme}.png`;
        await f.browser.screenshot(join(evidenceDir, file));
        f.row.screenshots.push(file);
        (f.row.presetGeometry ??= []).push({ state, width, theme, geometry });
      }
    };
    await capture("balanced");
    await f.browser.evaluate(`(() => {
      const field = document.querySelector('[data-weavra="project-preset"]');
      const speed = [...field.options].find(option => option.value.startsWith('speed:') && !option.disabled);
      if (!speed) throw new Error('Speed candidate absent');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(field, speed.value);
      field.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    assert.equal(await f.browser.evaluate(`document.querySelector('[data-weavra="project-preset"] option:checked').textContent.includes('gpt-5.3-codex-spark')`), true);
    assert.equal(await exists(join(f.target, ".ai/config.yaml")), false);
    await capture("speed");
    await f.browser.evaluate(`(() => {
      const field = document.querySelector('[data-weavra="project-preset"]');
      const quality = [...field.options].find(option => option.value.startsWith('quality:') && !option.disabled);
      if (!quality) throw new Error('Quality candidate absent');
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(field, quality.value);
      field.dispatchEvent(new Event('change', {bubbles:true}));
    })()`);
    assert.equal(await exists(join(f.target, ".ai/config.yaml")), false, "Preset selection is local only");
    await capture("quality");
    const ready = await f.browser.arm(`() => !!document.querySelector('[data-weavra="project-setup-status"][data-ready][aria-busy="false"]')`);
    await f.browser.clickAction("prepare-project-defaults");
    await ready();
    const config = parseRuntimeConfig(await readFile(join(f.target, ".ai/config.yaml"), "utf8"));
    assert.equal(config.models.profiles.coding.model, "gpt-6-astra");
    assert.equal(config.models.profiles.reasoning.model, "gpt-6-astra");
    assert.equal(config.models.claude_code?.enabled ?? false, false);
    assert.equal(await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-status"]').dataset.ready`), "true");
    assert.equal((await f.git("rev-parse", "HEAD")).trim(), head);
    await f.noRun();
    assert.equal(f.workerRequests.length, 0);
    f.row.assertions = ["actual automatic Balanced draft", "all presets use eligible synthetic provider/static Runtime intersection",
      "no save or model call on render/selection", "intentional Quality save then initialize/doctor",
      "unchanged Git HEAD", "no Run/worker", "desktop and true compact-DPR light/dark action hit tests"];
  }],
  ["non-git-discovery", { projectSetup: true }, async (f) => {
    const heldGit = join(f.base, "held-git");
    await rename(join(f.target, ".git"), heldGit);
    try {
      await connect(f, async (client) => {
        assert.deepEqual(await rpc(client, C.WS_METHODS.weavraTaskList, f.scope), []);
        assert.equal(await exists(join(f.target, ".git")), false);
      });
      f.browser = await openBrowser({ executable: process.env.WEAVRA_CHROMIUM, home: process.env.HOME,
        profile: join(f.base, "chromium"), headless: true });
      await f.browser.navigate(await mintPairing(f));
      await (await f.browser.arm(`() => !!document.querySelector('main [role="combobox"]')`))();
      await f.browser.navigate(`${f.origin}/${encodeURIComponent(f.scope.environmentId)}/${encodeURIComponent(f.scope.threadId)}`);
      await openProjectControlPanel(f);
      await (await f.browser.arm(`() => document.querySelector('button[data-weavra-action="start-controlled-task"]')?.disabled === false`))();
      assert.equal(await f.browser.evaluate(`document.body.innerText.includes('INTERNAL_ERROR')`), false);
      await f.browser.screenshot(join(evidenceDir, "non-git-discovery.png"));
      f.row.screenshots.push("non-git-discovery.png");
      await f.noRun();
      assert.equal(f.workerRequests.length, 0);
      assert.equal(await exists(join(f.target, ".git")), false);
      f.row.assertions = ["non-Git scope-bound list succeeds without initialization", "execution requires explicit first start",
        "actual initial UI is discovered, not infinite loading/INTERNAL_ERROR", "no Git initialization or model request"];
    } finally {
      await rename(heldGit, join(f.target, ".git"));
    }
  }],
]);

await runCase("optional-control-layout", "Ordinary chat stays primary and project control opens voluntarily in the right panel", [
  ["ordinary-chat-and-project-panel", { projectSetup: true }, async (f) => {
    const initialHead = (await f.git("rev-parse", "HEAD")).trim();
    f.browser = await openBrowser({ executable: process.env.WEAVRA_CHROMIUM, home: process.env.HOME,
      profile: join(f.base, "chromium"), headless: true });
    await f.browser.navigate(await mintPairing(f));
    await (await f.browser.arm("() => !!document.querySelector('main [role=combobox]')"))();
    await f.browser.navigate(f.origin + "/" + encodeURIComponent(f.scope.environmentId) + "/" + encodeURIComponent(f.scope.threadId));
    await (await f.browser.arm("() => !!document.querySelector('[aria-label=\"오른쪽 패널 열기/닫기\"]')"))();
    assert.equal(await f.browser.evaluate("!!document.querySelector('[data-weavra=controlled-task]')"), false);
    const launcher = await f.browser.arm("() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('통제 작업'))");
    await f.browser.evaluate("document.querySelector('[aria-label=\"오른쪽 패널 열기/닫기\"]').click()");
    await launcher();
    const panel = await f.browser.arm("() => !!document.querySelector('[aria-label=\"프로젝트 통제 설정\"] [data-weavra=controlled-task]')");
    await f.browser.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('통제 작업')).click()");
    await panel();
    for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
      await f.browser.viewport(width, 900, width === 390 ? 3 : 1);
      await f.browser.evaluate("document.documentElement.classList.toggle('dark', " + (theme === "dark") + ")");
      assert.equal(await f.browser.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
      const file = "optional-control-panel-" + width + "-" + theme + ".png";
      await f.browser.screenshot(join(evidenceDir, file));
      f.row.screenshots.push(file);
    }
    await f.noRun();
    assert.equal(f.workerRequests.length, 0);
    assert.equal((await f.git("rev-parse", "HEAD")).trim(), initialHead);
    f.row.assertions = ["no mandatory control card in ordinary transcript", "voluntary right-panel project control",
      "desktop and compact light/dark without horizontal overflow", "no task, Run or worker on panel selection"];
  }],
]);

await runCase("complex-run-graph", "A stored COMPLEX run draws parallel tasks by wave in the read-only Run graph", [
  ["parallel-wave-snapshot", { projectSetup: true }, async (f) => {
    const runtimePackage = join(root, "runtime/pi/packages/company-runtime");
    await promisify(execFile)(process.execPath, [join(root, "runtime/pi/node_modules/vitest/dist/cli.js"), "--run",
      "test/zz-seed-complex-graph.test.ts"], { cwd: runtimePackage, env: { ...process.env, WEAVRA_COMPLEX_SEED_DIR: f.target } });
    f.browser = await openBrowser({ executable: process.env.WEAVRA_CHROMIUM, home: process.env.HOME,
      profile: join(f.base, "chromium"), headless: true });
    await f.browser.navigate(await mintPairing(f));
    await (await f.browser.arm("() => !!document.querySelector('main [role=combobox]')"))();
    await f.browser.navigate(f.origin + "/" + encodeURIComponent(f.scope.environmentId) + "/" + encodeURIComponent(f.scope.threadId));
    await (await f.browser.arm("() => !!document.querySelector('[aria-label=\"오른쪽 패널 열기/닫기\"]')"))();
    const entry = await f.browser.arm("() => Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('Run 그래프'))");
    await f.browser.evaluate("document.querySelector('[aria-label=\"오른쪽 패널 열기/닫기\"]').click()");
    await entry();
    const drawn = await f.browser.arm(`() => document.querySelectorAll('[data-weavra="run-graph"] li[data-weavra-graph-node^="task:"]').length === 3`);
    await f.browser.evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Run 그래프')).click()");
    await drawn();
    const running = await f.browser.evaluate(`[...document.querySelectorAll('[data-weavra="run-graph"] li[data-status="running"]')].map(n => n.dataset.weavraGraphNode)`);
    assert.deepEqual(running, ["task:CT-001", "task:CT-002"], "Both first-wave tasks are drawn as running in parallel");
    assert.equal(await f.browser.evaluate("document.querySelectorAll('[data-weavra=\"run-graph\"] button').length"), 0);
    f.row.runGraph = { running };
    for (const width of [1280, 375]) {
      await f.browser.viewport(width, 900);
      await f.browser.evaluate("document.documentElement.classList.add('dark')");
      assert.equal(await f.browser.evaluate("document.documentElement.scrollWidth"), width);
      const file = join(evidenceDir, `complex-run-graph-${width}.png`);
      await f.browser.screenshot(file);
      f.row.screenshots.push(file);
    }
    assert.equal(f.workerRequests.length, 0);
  }],
]);

await runCase("automatic-git-preparation", "Explicit first start prepares local Git and defaults without model execution", [
  ...[false, true].map(generic => [generic ? "generic-first-start-without-git-or-config" : "first-start-without-git-or-config", { projectSetup: true, projectPresets: true }, async (f) => {
    const heldGit = join(f.base, "original-git");
    const oldConfig = await readFile(join(f.target, ".ai/config.yaml"), "utf8");
    const oldPackage = await readFile(join(f.target, "package.json"), "utf8");
    await rename(join(f.target, ".git"), heldGit);
    let published = false;
    try {
      await rm(join(f.target, ".ai/config.yaml"));
      if (generic) await rm(join(f.target, "package.json"));
      else await writeFile(join(f.target, "package.json"), JSON.stringify({ type: "module", scripts: { test: "node --test test/eval.test.mjs" } }));
      await connect(f, async client => {
        assert.deepEqual(await rpc(client, C.WS_METHODS.weavraTaskList, f.scope), []);
        await refused(client, C.WS_METHODS.weavraTaskCreate, { ...f.scope, commandId: randomUUID() }, ["EnvironmentAuthorizationError"]);
      }, "orchestration:read");
      assert.equal(await exists(join(f.target, ".git")), false, "Read-only clients cannot initialize Git");
      f.browser = await openBrowser({ executable: process.env.WEAVRA_CHROMIUM, home: process.env.HOME,
        profile: join(f.base, "chromium"), headless: true });
      await f.browser.navigate(await mintPairing(f));
      await (await f.browser.arm("() => !!document.querySelector('main [role=combobox]')"))();
      await f.browser.navigate(f.origin + "/" + encodeURIComponent(f.scope.environmentId) + "/" + encodeURIComponent(f.scope.threadId));
      await openProjectControlPanel(f);
      await (await f.browser.arm("() => document.querySelector('[data-weavra-action=start-controlled-task]')?.disabled === false"))();
      assert.equal(await exists(join(f.target, ".git")), false, "Opening the task surface is non-mutating");
      assert.equal(await exists(join(f.target, ".ai/config.yaml")), false);
      const editor = await f.browser.arm("() => !!document.querySelector('[data-weavra-action=prepare-handoff]')");
      await f.browser.clickAction("start-controlled-task");
      await editor();
      published = true;
      const head = (await f.git("rev-parse", "HEAD")).trim();
      assert.equal((await f.git("rev-list", "--count", "HEAD")).trim(), "1");
      assert.equal((await f.git("rev-list", "--parents", "-n", "1", "HEAD")).trim().split(" ").length, 1);
      assert.equal(await f.git("remote"), "");
      assert.equal(await f.git("status", "--porcelain=v1"), "");
      const config = parseRuntimeConfig(await readFile(join(f.target, ".ai/config.yaml"), "utf8"));
      assert.equal(config.models.profiles.coding.model, "gpt-5.6-sol");
      assert.equal(config.models.claude_code?.enabled ?? false, false);
      await connect(f, async client => {
        const tasks = await rpc(client, C.WS_METHODS.weavraTaskList, f.scope);
        assert.equal(tasks.length, 1);
        f.remember(tasks[0]);
        assert.equal(f.task.phase, "analysis");
        assert.equal(f.task.checkout.headCommit, head);
        await f.noRun();
        const repeated = await rpc(client, C.WS_METHODS.weavraTaskCreate,
          { ...f.scope, commandId: f.task.createCommandId });
        assert.equal(repeated.id, f.task.id);
        assert.equal((await f.git("rev-list", "--count", "HEAD")).trim(), "1");
      });
      for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
        await f.browser.viewport(width, 900, width === 390 ? 3 : 1);
        await f.browser.evaluate("document.documentElement.classList.toggle('dark', " + (theme === "dark") + ")");
        await f.browser.evaluate("document.querySelector('[data-weavra=controlled-task]').scrollIntoView({block:'start'})");
        assert.equal(await f.browser.evaluate("document.documentElement.scrollWidth > innerWidth"), false);
        const file = "automatic-git-analysis-" + (generic ? "generic-" : "node-") + width + "-" + theme + ".png";
        await f.browser.screenshot(join(evidenceDir, file));
        f.row.screenshots.push(file);
      }
      await connect(f, async client => {
        const aborted = await rpc(client, C.WS_METHODS.weavraTaskAbort,
          { task: f.ref(), expectedRevision: f.task.revision });
        assert.equal(aborted.ownership.state, "released");
      });
      assert.equal(f.workerRequests.length, 0);
      assert.equal(f.events.rows.some(event => event.kind === "analysis-request" && event.method === "turn/start"), false);
      f.row.automaticGit = { generic, head, commits: 1, remoteCount: 0, defaultModel: config.models.profiles.coding.model,
        taskCreated: true, repeatedTaskIdPreserved: true, noWorker: true, explicitlyReleased: true };
      f.row.assertions = ["no mutation on discovery/read-only principal", "explicit first start creates one local baseline",
        "Balanced config generated and initialized", "real Runtime checkout binds actual new HEAD", "same command does not add a commit/task",
        "no model request or remote", "desktop/compact light/dark UI", "analysis task explicitly released"];
    } finally {
      if (published) await rm(join(f.target, ".git"), { recursive: true });
      else if (await exists(join(f.target, ".git"))) await rm(join(f.target, ".git"), { recursive: true });
      await writeFile(join(f.target, "package.json"), oldPackage);
      await writeFile(join(f.target, ".ai/config.yaml"), oldConfig);
      await rename(heldGit, join(f.target, ".git"));
    }
  }]),
  ["existing-staged-and-remote-preserved", {}, async (f) => {
    await writeFile(join(f.target, "human.txt"), "human staged fixture\n");
    await f.git("add", "--", "human.txt");
    await f.git("remote", "add", "origin", "https://example.invalid/preserve.git");
    const before = { head: (await f.git("rev-parse", "HEAD")).trim(),
      index: await readFile(join(f.target, ".git/index")), config: await readFile(join(f.target, ".git/config")),
      staged: await f.git("diff", "--cached", "--name-only") };
    await connect(f, async client => {
      await refused(client, C.WS_METHODS.weavraTaskCreate, { ...f.scope, commandId: randomUUID() }, ["TARGET_CHANGED"]);
      await f.noRun();
    });
    assert.equal((await f.git("rev-parse", "HEAD")).trim(), before.head);
    assert.deepEqual(await readFile(join(f.target, ".git/index")), before.index);
    assert.deepEqual(await readFile(join(f.target, ".git/config")), before.config);
    assert.equal(await f.git("diff", "--cached", "--name-only"), before.staged);
    assert.equal(await readFile(join(f.target, "human.txt"), "utf8"), "human staged fixture\n");
    f.row.assertions = ["existing HEAD/index/remote/config exact-byte preservation", "human staged file not committed or reset", "no model/run"];
  }],
]);

await runCase("dirty-state", "Dirty admission fails closed without repair", [["untracked-input", {}, async (f) => {
  await writeFile(join(f.target, "untracked.txt"), "human change\n");
  await connect(f, async (client) => {
    await refused(client, C.WS_METHODS.weavraTaskCreate, { ...f.scope, commandId: randomUUID() }, ["TARGET_CHANGED"]);
    await f.noRun();
    await unchangedExcept(f, original, f.before.config, "?? untracked.txt\n");
    assert.equal(await readFile(join(f.target, "untracked.txt"), "utf8"), "human change\n");
    f.row.noTaskReason = "dirty checkout rejected before task creation";
    f.row.assertions = ["no task/Run/worker", "human dirty file preserved", "no stash/reset/cleanup"];
  });
}]]);

await runCase("changed-source-config", "Consent invalidation for changed source or configuration", [
  ["source-after-preview", {}, async (f) => {
    await connect(f, async (client) => {
      await f.create(client); await f.prepare(client);
      const changed = `${original}// external human observation\n`;
      await writeFile(join(f.target, sourcePath), changed);
      await refused(client, C.WS_METHODS.weavraTaskConfirm, f.confirmInput());
      await f.noRun(); await unchangedExcept(f, changed);
      assert.equal(f.task.context.sourceReferences[0].digest, digest(original));
      f.row.assertions = ["stale source hash not refreshed", "confirm refused", "external edit retained", "no worker"];
    });
  }],
  ["config-after-preview", {}, async (f) => {
    await connect(f, async (client) => {
      await f.create(client); await f.prepare(client);
      const changed = JSON.stringify({ ...f.config, agents: { max_revision_cycles: 1 } });
      await writeFile(join(f.target, ".ai/config.yaml"), changed);
      await refused(client, C.WS_METHODS.weavraTaskConfirm, f.confirmInput());
      await f.noRun(); await unchangedExcept(f, original, digest(changed));
      f.row.assertions = ["changed config invalidates preview", "no admission/worker", "changed config retained"];
    });
  }],
]);

await runCase("misleading-worker-success", "Worker prose is not completion evidence", [["success-prose-only", { mode: "misleading" }, async (f) => {
  await connect(f, async (client) => {
    await f.create(client); await f.prepare(client); const feed = await f.observe(client);
    await f.complete(client, feed, () => f.confirm(client));
    assert.equal(f.task.execution.receipt.run.status, "FAILED");
    await unchangedExcept(f, original);
    assert.equal(f.workerRequests.some((r) => r.role === "Reviewer"), false);
    const state = await f.readState(); assert.equal(state.runs.length, 1);
    assert.equal(state.runs[0].review, undefined);
    f.row.assertions = ["real worker reads source then claims success without handoff", "Kernel FAILED", "no forged check/review", "original defect retained"];
  });
}]]);

await runCase("failed-required-check", "Failing registered check blocks and preserves failed evidence", [["bad-edit", { mode: "failed-check" }, async (f) => {
  await connect(f, async (client) => {
    await f.create(client); await f.prepare(client); const feed = await f.observe(client);
    await f.complete(client, feed, () => f.confirm(client));
    assert.equal(f.task.execution.receipt.run.status, "BLOCKED");
    const value = await evidence(f, client);
    const failed = value.records.filter((r) => r.category === "checks" && r.id === "eval" && r.status === "FAIL");
    assert.ok(failed.length > 0); assert.equal(failed[0].exitCode, 1);
    assert.equal(failed[0].trust.mode, "strict"); assert.equal(failed[0].trust.status, "VERIFIED");
    assert.equal(f.workerRequests.some((r) => r.role === "Reviewer"), false);
    await unchangedExcept(f, original.replace("Helo,", "Goodbye,"));
    f.row.assertions = ["required real node test FAIL retained", "Kernel BLOCKED", "no independent PASS invented", "bad partial change retained", "oracle unchanged"];
  });
}]]);

await runCase("missing-permissions", "Authenticated App scope and worker Policy remain real", [["scope-and-policy", { mode: "denied" }, async (f) => {
  await connect(f, async (client) => {
    await f.create(client); await f.prepare(client);
    await connect(f, (readOnly) => refused(readOnly, C.WS_METHODS.weavraTaskConfirm, f.confirmInput(), ["EnvironmentAuthorizationError"]), "orchestration:read");
    await f.noRun(); await unchangedExcept(f, original);
    const feed = await f.observe(client);
    await f.complete(client, feed, () => f.confirm(client));
    // Policy denial is a fatal worker failure, unlike a failed required check.
    assert.equal(f.task.execution.receipt.run.status, "FAILED");
    const state = await f.readState();
    assert.ok(state.actions.some((a) => a.status === "DENIED" && a.decision.role === "Developer"));
    await unchangedExcept(f, original);
    f.row.assertions = ["read-only OAuth scope cannot confirm", "actual worker protected-path write denied by Policy", "durable denial", "no unauthorized file change"];
  });
}]]);

await runCase("lost-confirm-response", "Accepted confirmation response loss does not replay implementation", [["drop-exact-response", {}, async (f) => {
  let confirming;
  await connect(f, async (client) => {
    await f.create(client); await f.prepare(client);
    const executionId = f.task.execution.binding.executionId;
    f.dropExecution = executionId;
    const lost = f.events.wait((e) => e.kind === "confirm-response-dropped" && e.executionId === executionId, "exact confirm response dropped");
    const completed = f.events.wait((e) => e.kind === "persisted" && e.admissions.some((a) => a.executionId === executionId) &&
      e.runs.some((r) => r.status === "COMPLETED"), "actual Kernel completion after lost response");
    const cleaned = f.events.wait((e) => e.kind === "writer-closed" && e.cwd === f.target &&
      e.executionIds.includes(executionId), "exact execution writer released after completion");
    confirming = f.confirm(client).then(() => ({ returned: true }), () => ({ returned: false }));
    await lost; await completed; await cleaned;
    assert.equal(await exists(join(f.target, ".ai/writer.lock")), false);
    assert.equal((await f.readState()).taskAdmissions.find(a =>
      a.metadata.binding.executionId === executionId).cleanup, "CONFIRMED");
    // Graceful App shutdown cancels the pending transport but cannot invent an
    // outcome; the actual canonical Run has already completed independently.
    await f.stop(); await bounded(confirming, "lost confirm caller settled");
  });
  f.arm = null;
  const config = JSON.parse(await readFile(f.peerConfig, "utf8"));
  await writeFile(f.peerConfig, JSON.stringify({ ...config, instrument: false }));
  await f.start(true);
  await connect(f, async (client) => {
    const old = identity(f.task); await f.reconcile(client);
    assert.equal(f.task.id, old.taskId); assert.equal(f.task.execution.binding.executionId, old.executionId);
    assertSuccess(f, await evidence(f, client));
    assert.equal(f.task.ownership.state, "released");
    assert.equal(f.events.rows.filter((e) => e.kind === "request" && e.type === "workflow.confirm").length, 1);
    assert.equal((await f.readState()).runs.length, 1);
    await unchangedExcept(f, fixed);
    f.row.assertions = ["exact actual accepted response dropped", "actual Kernel completed without fabricated receipt", "App restart reconciled same task/execution/Run", "one confirm, one Run, no replay"];
  });
}]]);

async function crash(f, phase) {
  await connect(f, async (client) => {
    await f.create(client); await f.prepare(client);
    const taskId = f.task.id, executionId = f.task.execution.binding.executionId;
    const barrier = f.events.wait((e) => e.kind === "persistence-barrier" &&
      e.admissions.some((a) => a.taskId === taskId && a.executionId === executionId), `armed ${phase} persistence barrier`);
    f.arm = { phase, taskId, executionId };
    const confirming = f.confirm(client).catch(() => null);
    const observed = await barrier;
    const state = await f.readState();
    const admission = state.taskAdmissions.find((a) => a.metadata.binding.executionId === executionId);
    assert.equal(admission.metadata.binding.taskId, taskId);
    assert.equal(admission.outcome.status, phase === "before-run" ? "ACCEPTED" : "STARTED");
    assert.equal(state.runs.length, phase === "before-run" ? 0 : 1);
    if (phase === "after-run") assert.equal(state.runs[0].runId, admission.outcome.runId);
    assert.equal(observed.projectRevision, state.revision);
    assert.deepEqual(observed.runs, state.runs.map((r) => ({ runId: r.runId, revision: r.revision, status: r.status })));
    assert.ok(f.events.rows.some((e) => e.kind === "runtime-start" && e.pid === observed.pid));
    f.row.barrier = observed;
    f.row.preRestartStateDigest = digest(JSON.stringify(state));
    assert.equal(f.workerRequests.length, 0, "Crash cut precedes first worker");
    await unchangedExcept(f, original);
    const runtimeExited = f.events.wait((e) => e.kind === "runtime-exit" && e.pid === observed.pid,
      "captured Runtime process exited", 0);
    await f.stop("SIGKILL");
    process.kill(observed.pid, "SIGKILL");
    await runtimeExited;
    await bounded(confirming, "crashed confirm caller settled");
  });
  f.arm = null;
  const config = JSON.parse(await readFile(f.peerConfig, "utf8"));
  await writeFile(f.peerConfig, JSON.stringify({ ...config, instrument: false }));
  await f.start(true);
  await connect(f, async (client) => {
    await f.reconcile(client);
    const receipt = f.task.execution.receipt;
    assert.equal(receipt.status, "FOUND");
    assert.equal(receipt.admission.outcome.status, phase === "before-run" ? "ACCEPTED" : "STARTED");
    if (phase === "before-run") assert.equal(receipt.run, null);
    else {
      assert.equal(receipt.run.runId, f.row.barrier.runs[0].runId);
      assert.equal(receipt.run.revision, f.row.barrier.runs[0].revision);
      assert.notEqual(receipt.run.status, "COMPLETED");
    }
    assert.notEqual(f.task.ownership.state, "released");
    assert.equal(digest(JSON.stringify(await f.readState())), f.row.preRestartStateDigest, "Read-only reconciliation must not settle or repair canonical state");
    await refused(client, C.WS_METHODS.weavraTaskAbort, { task: f.ref(), expectedRevision: f.task.revision }, ["ALREADY_CONFIRMED"]);
    await refused(client, C.WS_METHODS.projectsWriteFile, { cwd: f.target, relativePath: sourcePath, contents: "unintended" });
    await unchangedExcept(f, original);
    assert.equal(f.workerRequests.length, 0);
    assert.equal(f.events.rows.filter((e) => e.kind === "request" && e.type === "workflow.confirm").length, 1);
    const beforeRecovery = identity(f.task);
    await browserConversation(f);
    await (await f.browser.arm(`() => [...document.querySelectorAll('button')]
      .some(button => button.dataset.weavraAction === 'recover-interrupted-task' && !button.disabled)`))();
    const recoveryResponse = f.events.wait((event) => event.kind === "response" &&
      event.type === "workflow.recover" && event.success && event.dataKind === "task-recovery",
      "explicit UI recovery response");
    const displayed = await f.browser.arm(phase === "before-run"
      ? `() => !!document.querySelector('[data-weavra="controlled-task"][data-weavra-task-ownership="released"][data-weavra-run-status="INTERRUPTED_BEFORE_START"]')`
      : `() => !!document.querySelector('[data-weavra="controlled-task"][data-weavra-task-ownership="reconciling"][data-weavra-run-status="INTERRUPTED"]')`);
    await f.browser.clickAction("recover-interrupted-task");
    await recoveryResponse;
    await displayed();
    await f.read(client);
    const recovered = f.task.execution.receipt;
    assert.equal(recovered.status, "FOUND");
    assert.equal(f.task.id, beforeRecovery.taskId);
    assert.equal(recovered.executionId, beforeRecovery.executionId);
    assert.deepEqual(recovered.admission.metadata, receipt.admission.metadata);
    assert.equal(recovered.run?.runId ?? null, receipt.run?.runId ?? null);
    assert.equal(recovered.run?.status ?? recovered.admission.outcome.status,
      phase === "before-run" ? "INTERRUPTED_BEFORE_START" : "INTERRUPTED");
    assert.equal(f.task.ownership.state, phase === "before-run" ? "released" : "reconciling");
    assert.equal(await exists(join(f.target, ".ai/writer.lock")), phase !== "before-run");
    if (phase === "after-run") {
      assert.equal(recovered.admission.cleanup, "UNCONFIRMED");
      await refused(client, C.WS_METHODS.projectsWriteFile,
        { cwd: f.target, relativePath: sourcePath, contents: "unintended" });
    }
    const settled = await f.readState();
    await f.reconcile(client);
    assert.deepEqual(await f.readState(), settled, "Refresh after recovery remains read-only");
    assert.equal(f.events.rows.filter((event) => event.kind === "request" && event.type === "workflow.confirm").length, 1);
    assert.equal(f.events.rows.filter((event) => event.kind === "request" && event.type === "workflow.recover").length, 1);
    assert.equal(f.workerRequests.length, 0, "Recovery never starts a worker");
    for (const [width, height] of [[1280, 900], [375, 812]]) {
      await f.browser.viewport(width, height);
      await f.browser.evaluate(`document.querySelector('[data-weavra="controlled-task"]').scrollIntoView({ block: 'start' })`);
      const path = join(evidenceDir, `recovered-${phase}-${width}.png`);
      await f.browser.screenshot(path);
      const image = await readFile(path);
      assert.equal(image.readUInt32BE(16), width);
      assert.equal(image.readUInt32BE(20), height);
      assert.equal(await f.browser.evaluate("document.documentElement.scrollWidth"), width);
      f.row.screenshots.push(path);
      const actionNames = phase === "before-run"
        ? ["start-controlled-task", "return-to-free-coding"]
        : ["refresh-task-state", "recover-interrupted-task"];
      await f.browser.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(b =>
          b.dataset.weavraAction === ${JSON.stringify(actionNames.at(-1))});
        if (!button) throw new Error('Recovery action absent');
        button.scrollIntoView({ block: 'center' });
      })()`);
      // Start is intentionally disabled while project settings are still being read.
      await (await f.browser.arm(`() => document.querySelector(
        '[data-weavra="project-setup-status"]')?.getAttribute('aria-busy') !== 'true'`))();
      (f.row.setupSettled ??= []).push(width);
      const actionShot = join(evidenceDir, `recovered-${phase}-actions-${width}.png`);
      await f.browser.screenshot(actionShot);
      const hitTests = await f.browser.evaluate(`(${JSON.stringify(actionNames)}).map(name => {
        const button = [...document.querySelectorAll('button')].find(b => b.dataset.weavraAction === name);
        const rect = button.getBoundingClientRect();
        return { name, top: rect.top, bottom: rect.bottom,
          visible: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest('button') === button };
      })`);
      assert.ok(hitTests.every(result => result.visible), JSON.stringify(hitTests));
      (f.row.actionGeometry ??= []).push({ width, hitTests });
      f.row.screenshots.push(actionShot);
    }
    await unchangedExcept(f, original);
    f.row.userRecovery = { explicitUi: true, cleanup: recovered.admission.cleanup,
      released: f.task.ownership.state === "released", replayed: false };
    f.row.assertions = ["exact durable cut before first worker", "same receipt/task/execution/Run on real App restart",
      "no auto-confirm/replay", "managed writes quarantined", "read-only canonical state unchanged",
      "App abort cannot bypass uncertain cleanup", "explicit same-thread recovery",
      "safe pre-execution release; post-Run unconfirmed cleanup stays protected", "desktop/mobile recovery state"];
    if (interactive) {
      console.log(`TASK8_RECOVERY_INSPECT phase=${phase} origin=${f.origin} pid=${f.browser.pid} fixture=${f.base}; press ENTER after inspection`);
      const input = createInterface({ input: process.stdin });
      await bounded(new Promise((resolve) => { input.once("line", resolve); input.once("close", resolve); }),
        "manual recovery inspection", 900_000);
      input.close();
    }
  });
}
await runCase("restart-before-after-run-persistence", "Actual App/Runtime death at exact persistence barriers", [
  ["before-run", {}, (f) => crash(f, "before-run")], ["after-run", {}, (f) => crash(f, "after-run")],
]);

await runCase("disconnected-stale-evidence", "Visible historical outcome cannot remain issue-verified offline", [["real-disconnect", {}, async (f) => {
  let finalTask;
  await connect(f, async (client) => {
    await f.create(client); await browserConversation(f); await f.prepare(client); const feed = await f.observe(client);
    await f.complete(client, feed, () => f.confirm(client));
    assertSuccess(f, await evidence(f, client)); finalTask = identity(f.task);
    await visibleEvidence(f);
    await refused(client, C.WS_METHODS.weavraTaskEvidence, { task: f.ref(), revision: finalTask.runRevision - 1,
      diffDigest: f.row.evidence.snapshot.diffDigest, cursor: { category: "checks", index: 0 } }, ["RUN_MISMATCH"]);
    const historical = await f.browser.arm(`() => !!document.querySelector('[data-weavra-outcome-freshness="historical"]') &&
      !document.querySelector('[data-issue-verification="verified"]')`);
    await f.stop(); await historical();
    await (await f.browser.arm(`() => !!document.querySelector('[data-issue-verification="unverified"]')`))();
    for (const [width, height] of [[1280, 900], [375, 812]]) {
      await f.browser.viewport(width, height);
      await f.browser.evaluate(`document.querySelector('[data-weavra="controlled-outcome"]').scrollIntoView({ block: 'start' })`);
      const screenshot = join(evidenceDir, `task8-disconnected-${width}.png`);
      await f.browser.screenshot(screenshot); f.row.screenshots.push(screenshot);
      assert.equal(await f.browser.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(b => b.dataset.weavraAction === 'reload-evidence-snapshot');
        if (!button) throw new Error('Historical evidence reload missing');
        button.scrollIntoView({ block: 'center' });
        return button.disabled;
      })()`), true);
      const disabledShot = join(evidenceDir, `task8-disconnected-controls-${width}.png`);
      await f.browser.screenshot(disabledShot);
      const image = await readFile(disabledShot);
      assert.equal(image.readUInt32BE(16), width);
      assert.equal(image.readUInt32BE(20), height);
      f.row.screenshots.push(disabledShot);
    }
  });
  await f.start(true);
  await connect(f, async (client) => {
    await f.reconcile(client);
    assert.equal(f.task.id, finalTask.taskId); assert.equal(f.task.execution.receipt.run.runId, finalTask.runId);
    assert.equal(f.task.execution.receipt.run.revision, finalTask.runRevision);
    assertSuccess(f, await evidence(f, client));
    assert.equal(f.events.rows.filter((e) => e.kind === "request" && e.type === "workflow.confirm").length, 1);
    await unchangedExcept(f, fixed);
    f.row.assertions = ["actual browser visible same task/Run", "stale revision evidence RPC rejected",
      "actual disconnect removes verified claim", "restarted App restores exact canonical identity", "inspection does not re-execute"];
  });
}]]);

await runCase("legacy-runtime-capability-absent", "No unsupported controlled implementation fallback", [["capabilities-stripped", { legacy: true }, async (f) => {
  await connect(f, async (client) => {
    await f.create(client);
    await refused(client, C.WS_METHODS.weavraTaskPrepare, { task: f.ref(), expectedRevision: f.task.revision, draft: f.draft() }, ["RUNTIME_UNAVAILABLE"]);
    assert.equal(f.events.rows.some((e) => e.kind === "request" && e.type === "workflow.prepare"), false);
    await f.noRun(); await unchangedExcept(f, original);
    f.row.assertions = ["actual hello only loses taskBinding/analysisContext/evidenceDetails advertisements",
      "App refuses unsupported task prepare", "no fallback provider or worker", "no canonical state or checkout writes"];
  });
}]]);

// Todo 22 App-facing flows: each opens the owned App with a fresh pairing, drives the real
// controlled-task surfaces and captures 1280/375 light plus 1280 dark.
async function openTaskPanel(f) {
  f.browser = await openBrowser({ executable: process.env.WEAVRA_CHROMIUM, home: process.env.HOME,
    profile: join(f.base, "chromium"), headless: true });
  await f.browser.navigate(await mintPairing(f));
  await (await f.browser.arm(`() => !!document.querySelector('main [role="combobox"]')`))();
  await f.browser.navigate(`${f.origin}/${encodeURIComponent(f.scope.environmentId)}/${encodeURIComponent(f.scope.threadId)}`);
  await openProjectControlPanel(f);
  await (await f.browser.arm(`() => !!document.querySelector('[data-weavra="controlled-task"]')`))();
}
async function revealInPanel(f, selector, block = "center") {
  return f.browser.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) throw new Error('Capture target missing: ' + ${JSON.stringify(selector)});
    for (let parent = element.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName === 'DETAILS' && !parent.open) parent.open = true;
    element.scrollIntoView({ block: ${JSON.stringify(block)}, behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height, top: rect.top, left: rect.left };
  })()`);
}
async function captureWidthsAndDark(f, name, selector, block = "center") {
  for (const [width, theme] of [[1280, "light"], [375, "light"], [1280, "dark"]]) {
    await f.browser.viewport(width, 900);
    await f.browser.evaluate(`document.documentElement.classList.toggle('dark', ${theme === "dark"})`);
    await dismissMaintenanceNotifications(f);
    const rect = await revealInPanel(f, selector, block);
    assert.ok(rect.width > 0 && rect.height > 0, `${name} target must be rendered at ${width}`);
    assert.equal(await f.browser.evaluate("document.documentElement.scrollWidth > innerWidth"), false,
      `${name} must not overflow horizontally at ${width}`);
    const file = join(evidenceDir, `${f.row.id}-${name}-${width}-${theme}.png`);
    await f.browser.screenshot(file);
    f.row.screenshots.push(file);
  }
  await f.browser.evaluate("document.documentElement.classList.remove('dark')");
  await f.browser.viewport(1280, 900);
}
const fillTaskField = (f, field, value) => f.browser.evaluate(`(() => {
  const element = document.querySelector('[data-weavra="controlled-task"] [id$="-${field}"]');
  if (!element) throw new Error('Missing task field ${field}');
  if (element.disabled) throw new Error('Task field ${field} is disabled');
  const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
})()`);
// The card enables its actions only once the observation stream has delivered a fresh task, so a
// case that clicks right after opening the browser must wait for that state (bounded).
async function enabledAction(f, action, timeoutMs = 60_000) {
  const ready = (await f.browser.arm(`() => document.querySelector(${JSON.stringify(`button[data-weavra-action="${action}"]`)})?.disabled === false`))();
  let timer;
  const expired = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Action ${action} stayed disabled`)), timeoutMs); });
  try { await Promise.race([ready, expired]); }
  catch (error) {
    f.row.disabledActionDom = await f.browser.evaluate(`(() => ({
      present: !!document.querySelector(${JSON.stringify(`button[data-weavra-action="${action}"]`)}),
      card: document.querySelector('[data-weavra="controlled-task"]')?.innerText.slice(0, 2000) }))()`);
    throw error;
  }
  finally { clearTimeout(timer); }
}
const prepareRequests = (f) => f.events.rows.filter((event) =>
  event.kind === "request" && event.type === "workflow.prepare").length;

await runCase("goal-mode-choice", "INVALID_GOAL offers a visible read-only/edit choice and re-prepares with the tag", [
  ["ambiguous-goal-edit-tag", {}, async (f) => {
    // Starts with an edit verb and asks for analysis: the Runtime refuses it as ambiguous.
    const ambiguous = `${fixture.goal} 그리고 원인을 분석해 주세요`;
    await connect(f, async (client) => {
      await f.create(client);
      await browserConversation(f);
      const draft = f.draft();
      const fields = { goal: ambiguous, symptom: draft.context.symptom,
        hypothesis: draft.context.candidateCause.text, uncertainties: draft.context.uncertainties.join("\n"),
        constraints: draft.context.constraints.join("\n"), criteria: draft.acceptanceStatements.join("\n"),
        sources: JSON.stringify(draft.context.sourceReferences) };
      for (const [field, value] of Object.entries(fields)) await fillTaskField(f, field, value);
      await enabledAction(f, "prepare-handoff");
      const before = prepareRequests(f);
      const chooser = await f.browser.arm(`() => !!document.querySelector('[data-weavra="controlled-task"] [data-weavra="goal-mode"]')`);
      await f.browser.clickAction("prepare-handoff");
      await chooser();
      assert.equal(prepareRequests(f), before + 1, "The ambiguous goal reached the Runtime once");
      const refusal = await f.browser.evaluate(`(() => {
        const card = document.querySelector('[data-weavra="controlled-task"]');
        const chooser = card.querySelector('[data-weavra="goal-mode"]');
        return { text: card.innerText,
          radios: [...chooser.querySelectorAll('input[type="radio"]')].map(radio => ({
            value: radio.value, label: radio.parentElement.textContent.trim(), checked: radio.checked })),
          reprepareDisabled: chooser.querySelector('[data-weavra-action="reprepare-with-goal-mode"]').disabled,
          goal: card.querySelector('[id$="-goal"]').value };
      })()`);
      assert.ok(refusal.text.includes("INVALID_GOAL"), "Refusal code is shown");
      assert.ok(refusal.text.includes("목표만으로는 읽기 전용인지 수정인지 정할 수 없어요."));
      assert.ok(refusal.text.includes("이 목표를 어떻게 다룰까요?"));
      assert.deepEqual(refusal.radios.map((radio) => radio.label), ["읽기 전용 조사", "수정 작업"]);
      assert.ok(refusal.radios.every((radio) => !radio.checked), "No mode is guessed");
      assert.equal(refusal.reprepareDisabled, true, "다시 준비 needs an explicit choice");
      assert.equal(refusal.goal, ambiguous, "No hidden tag before a choice");
      await f.noRun();
      await captureWidthsAndDark(f, "invalid-goal-choice", '[data-weavra="goal-mode"]');
      const tagged = await f.browser.arm(`() => document.querySelector('[data-weavra="controlled-task"] [id$="-goal"]')?.value === ${JSON.stringify(`[수정] ${ambiguous}`)}`);
      await f.browser.evaluate(`document.querySelector('[data-weavra="goal-mode"] input[type="radio"][value="edit"]').click()`);
      await tagged();
      assert.equal(await f.browser.evaluate(`document.querySelector('[data-weavra-action="reprepare-with-goal-mode"]').disabled`), false);
      assert.equal(prepareRequests(f), before + 1, "Choosing a mode alone sends nothing");
      await captureWidthsAndDark(f, "edit-chosen", '[data-weavra="goal-mode"]');
      const prepared = await f.browser.arm(`() => !!document.querySelector('[data-weavra="prepared-snapshot"]')`);
      await f.browser.clickAction("reprepare-with-goal-mode");
      await prepared();
      assert.equal(prepareRequests(f), before + 2, "다시 준비 resends exactly once");
      await f.read(client);
      assert.equal(f.task.phase, "awaiting-confirmation");
      assert.equal(f.task.execution.preview.goal, `[수정] ${ambiguous}`, "Runtime prepared the visibly tagged goal");
      await captureWidthsAndDark(f, "edit-prepared", '[data-weavra="prepared-snapshot"]');
      await f.noRun();
      f.row.goalMode = { refusal: { radios: refusal.radios, reprepareDisabled: refusal.reprepareDisabled },
        resentGoal: f.task.execution.preview.goal, prepareRequests: prepareRequests(f) - before };
      await rpc(client, C.WS_METHODS.weavraTaskAbort, { task: f.ref(), expectedRevision: f.task.revision });
    });
    f.row.assertions = ["real Runtime INVALID_GOAL refusal shows two unselected mode radios", "다시 준비 disabled until a choice",
      "수정 작업 adds a visible [수정] tag in the goal field", "다시 준비 sends one prepare whose preview goal starts with [수정]",
      "no Run or worker"];
  }],
]);

await runCase("check-policy-preflight", "Setup shows per-check policy badges and a user-applied allowed-form fix", [
  ["shell-check-fix", { projectSetup: true }, async (f) => {
    await mkdir(join(f.target, "scripts"), { recursive: true });
    await writeFile(join(f.target, "scripts/check.sh"), "#!/bin/sh\nexec node --test test/eval.test.mjs\n", { mode: 0o755 });
    await f.git("add", "scripts/check.sh");
    await f.git("commit", "-qm", "Shell-registered check fixture");
    const head = (await f.git("rev-parse", "HEAD")).trim();
    const config = structuredClone(f.config);
    Object.assign(config.verification.checks[0], { executable: "bash", args: ["scripts/check.sh"],
      trust: { files: ["test/eval.test.mjs", "scripts/check.sh"] } });
    const deniedYaml = JSON.stringify(config, null, 2);
    await writeFile(join(f.target, ".ai/config.yaml"), deniedYaml, { mode: 0o600 });
    await connect(f, async (client) => {
      const read = await rpc(client, C.WS_METHODS.weavraProjectSetup, { scope: f.scope, action: "read" });
      assert.equal(read.result.kind, "read");
      const policy = read.result.checkPolicies?.find((entry) => entry.id === "eval");
      assert.equal(policy?.policy, "denied");
      assert.equal(policy.suggestion?.executable, "scripts/check.sh");
      const doctor = await rpc(client, C.WS_METHODS.weavraProjectSetup, { scope: f.scope, action: "doctor" });
      assert.equal(doctor.result.kind, "doctor");
      assert.equal(doctor.result.ready, false);
      assert.ok(doctor.result.diagnostics.some((d) => d.code.startsWith("CHECK_POLICY_DENIED")));
      f.row.preflight = { readPolicy: policy, doctorReady: doctor.result.ready,
        diagnostics: doctor.result.diagnostics.map((d) => d.code) };
    });
    await openTaskPanel(f);
    await (await f.browser.arm(`() => document.querySelector('[data-weavra-action="set-up-project"]')?.disabled === false`))();
    const deniedRow = await f.browser.arm(`() => !!document.querySelector('[data-weavra-action="fix-check-policy"]')`);
    await f.browser.clickAction("set-up-project");
    await deniedRow();
    const badge = await f.browser.evaluate(`(() => {
      const row = document.querySelector('[data-weavra-action="fix-check-policy"]').closest('[data-weavra="check-policy"]');
      return { policy: row.dataset.policy, badge: row.querySelector('span').textContent.trim(),
        action: row.querySelector('[data-weavra-action="fix-check-policy"]').textContent.trim(), text: row.innerText };
    })()`);
    assert.equal(badge.policy, "denied");
    assert.ok(badge.badge.startsWith("정책에 막힘: "), "Denied badge names the policy block");
    assert.equal(badge.action, "허용 형태로 고치기");
    assert.ok(badge.text.includes("scripts/check.sh"), "Suggested allowed form is shown before applying");
    await captureWidthsAndDark(f, "policy-denied", '[data-weavra-action="fix-check-policy"]');
    await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-review"]').click()`);
    assert.equal(await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-review"]').checked`), true);
    const fixedRow = await f.browser.arm(`() => !!document.querySelector('[data-weavra="check-policy"][data-policy="fixed"]')`);
    await f.browser.clickAction("fix-check-policy");
    await fixedRow();
    const patched = parseRuntimeConfig(await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-yaml"]').value`));
    assert.equal(patched.verification.checks[0].executable, "scripts/check.sh");
    assert.deepEqual(patched.verification.checks[0].args, []);
    assert.equal(await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-review"]').checked`), false,
      "Applying a fix requires a fresh review");
    assert.equal(await readFile(join(f.target, ".ai/config.yaml"), "utf8"), deniedYaml, "The fix is not saved without the user");
    await captureWidthsAndDark(f, "policy-fixed", '[data-weavra="check-policy"][data-policy="fixed"]');
    await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-review"]').click()`);
    const saved = await f.browser.arm(`() => !!document.querySelector('[data-weavra="project-setup-status"][data-result-kind="saved"][aria-busy="false"]')`);
    await f.browser.clickAction("update-project-setup");
    await saved();
    if (await f.browser.evaluate(`document.querySelector('[data-weavra="project-setup-status"]').dataset.ready`) !== "true") {
      const ready = await f.browser.arm(`() => !!document.querySelector('[data-weavra="project-setup-status"][data-ready="true"][aria-busy="false"]')`);
      await f.browser.clickAction("recheck-project-setup");
      await ready();
    }
    const savedConfig = parseRuntimeConfig(await readFile(join(f.target, ".ai/config.yaml"), "utf8"));
    assert.equal(savedConfig.verification.checks[0].executable, "scripts/check.sh");
    await captureWidthsAndDark(f, "doctor-ready", '[data-weavra="project-setup-status"]', "start");
    await connect(f, async (client) => {
      const read = await rpc(client, C.WS_METHODS.weavraProjectSetup, { scope: f.scope, action: "read" });
      assert.equal(read.result.checkPolicies?.find((entry) => entry.id === "eval")?.policy, "allowed");
    });
    assert.equal((await f.git("rev-parse", "HEAD")).trim(), head);
    await f.noRun();
    f.row.policyFix = { badge: badge.badge, action: badge.action, savedExecutable: savedConfig.verification.checks[0].executable,
      doctorReady: true };
    f.row.assertions = ["real Runtime read/doctor report CHECK_POLICY_DENIED for a bash-registered check",
      "row badge 정책에 막힘 with 허용 형태로 고치기 and visible suggestion", "fix patches YAML locally and clears review",
      "explicit reviewed save then doctor ready", "policy now allowed", "Git HEAD unchanged, no Run or worker"];
  }],
]);

await runCase("failed-result-next-action", "A blocked Run shows its failure reason and next action in place", [
  ["failed-check-reason", { mode: "failed-check" }, async (f) => {
    await connect(f, async (client) => {
      await f.create(client); await f.prepare(client); const feed = await f.observe(client);
      await f.complete(client, feed, () => f.confirm(client));
      assert.equal(f.task.execution.receipt.run.status, "BLOCKED");
      await unchangedExcept(f, original.replace("Helo,", "Goodbye,"));
      await openTaskPanel(f);
      await (await f.browser.arm(`() => !!document.querySelector('[data-weavra="task-failure"]')`))();
      await revealInPanel(f, '[data-weavra="task-failure"]');
      const initialReason = await f.browser.evaluate(`document.querySelector('[data-weavra="task-failure-reason"]').textContent`);
      // The reason flips as soon as the first (checks) page arrives, while the criteria page and the
      // switch to the checks category are still pending; wait for the finished inspection instead.
      const loaded = await f.browser.arm(`() => document.querySelector('[data-weavra="task-failure-reason"]')?.textContent === 'eval 종료 코드 1' &&
        document.querySelectorAll('[data-weavra-record="checks"]').length > 0 &&
        document.querySelector('[data-weavra-action="show-failure-evidence"]')?.disabled === false`);
      await enabledAction(f, "show-failure-evidence");
      await f.browser.clickAction("show-failure-evidence");
      let loadTimer;
      await Promise.race([loaded(), new Promise((_, reject) => { loadTimer = setTimeout(() =>
        reject(new Error("증거 보기 did not finish loading check records")), 60_000); })])
        .finally(() => clearTimeout(loadTimer));
      const shown = await f.browser.evaluate(`(() => {
        const section = document.querySelector('[data-weavra="task-failure"]');
        return { text: section.innerText, reason: section.querySelector('[data-weavra="task-failure-reason"]').textContent,
          actions: [...section.querySelectorAll('button')].map(button => ({ action: button.dataset.weavraAction,
            label: button.textContent.trim(), disabled: button.disabled })),
          completedActions: !!document.querySelector('[data-weavra="task-completed-actions"]'),
          checkRecords: document.querySelectorAll('[data-weavra-record="checks"]').length,
          outputTail: section.querySelector('[data-weavra="task-failure-output"]')?.textContent ?? null };
      })()`);
      assert.ok(shown.text.includes("검사 실패"), "Failure kind is titled");
      // Runtime-masked tail of the real failing `node --test` run; labels are App-added, the body is Runtime-bounded.
      assert.ok(shown.outputTail, "Failure block shows the check output tail");
      const tails = shown.outputTail.split(/^\[(?:stderr|stdout)\]\n/m).filter(Boolean).map((part) => part.replace(/\n$/, ""));
      assert.ok(tails.length >= 1 && tails.length <= 2, "Output tail has one or two labelled streams");
      assert.ok(tails.reduce((sum, part) => sum + Buffer.byteLength(part), 0) <= 2048, "Output tail stays within 2 KiB");
      assert.ok(tails.reduce((sum, part) => sum + part.split("\n").length, 0) <= 20, "Output tail stays within 20 lines");
      assert.match(shown.outputTail, /not ok|AssertionError|ERR_ASSERTION|fail/i, "Output tail carries the real failure");
      assert.equal(shown.text.includes("검사 출력 본문은 증거 레코드에 포함되지 않아요"), false);
      assert.equal(shown.reason, "eval 종료 코드 1");
      assert.deepEqual(shown.actions.map((a) => a.label), ["증거 보기"], "Check failure offers evidence as the next action");
      assert.equal(shown.completedActions, false, "Completed-only actions stay hidden");
      assert.ok(shown.checkRecords > 0, "증거 보기 loaded the failed check records");
      await captureWidthsAndDark(f, "failed-check", '[data-weavra="task-failure"]');
      f.row.failure = { initialReason, reason: shown.reason, actions: shown.actions, checkRecords: shown.checkRecords,
        outputTail: shown.outputTail };
      assert.equal(f.workerRequests.some((r) => r.role === "Reviewer"), false);
    });
    f.row.assertions = ["real BLOCKED Run with failing required node check", "result shows 검사 실패 and 'eval 종료 코드 1'",
      "next action 증거 보기 loads check evidence", "failure block shows the bounded check output tail (<=20 lines, <=2 KiB)",
      "no completed-run actions on a failed Run"];
  }],
]);

await runCase("completed-handoff", "A completed Run shows reported usage, its own Run diff and copies a PR draft", [
  ["completed-diff-and-pr-draft", {}, async (f) => {
    await connect(f, async (client) => {
      await f.create(client); await f.prepare(client); const feed = await f.observe(client);
      await f.complete(client, feed, () => f.confirm(client));
      assert.equal(f.task.execution.receipt.run.status, "COMPLETED");
      await unchangedExcept(f, fixed);
      const runId = f.task.execution.receipt.run.runId;
      await openTaskPanel(f);
      await (await f.browser.arm(`() => !!document.querySelector('[data-weavra="task-completed-actions"]')`))();
      await (await f.browser.arm(`() => !!document.querySelector('[data-weavra="task-run-usage"]')`))();
      const usage = await f.browser.evaluate(`document.querySelector('[data-weavra="task-run-usage"]').textContent`);
      assert.match(usage, /^(보고된 토큰 [\d,]+|토큰 보고 없음) · 도구 호출 \S+ · worker \S+$/);
      assert.equal(await f.browser.evaluate(`!!document.querySelector('[data-weavra="task-failure"]')`), false);
      const labels = await f.browser.evaluate(`[...document.querySelectorAll('[data-weavra="task-completed-actions"] button')]
        .map(button => button.textContent.trim())`);
      assert.deepEqual(labels, ["변경 보기", "PR 설명 초안 복사"]);
      await captureWidthsAndDark(f, "completed-result", '[data-weavra="task-run-usage"]');
      await f.browser.evaluate(`(() => {
        window.__weavraPrDraft = null;
        Object.defineProperty(navigator, 'clipboard', { configurable: true,
          value: { writeText: async text => { window.__weavraPrDraft = text; } } });
      })()`);
      const copied = await f.browser.arm(`() => typeof window.__weavraPrDraft === 'string'`);
      await f.browser.clickAction("copy-pr-draft");
      await copied();
      const draft = await f.browser.evaluate("window.__weavraPrDraft");
      assert.ok(draft.includes("## 수용 기준"), "PR draft has the criteria section");
      assert.ok(draft.includes("MET"), "PR draft carries criterion verdicts");
      assert.ok(draft.includes(runId), "PR draft names the Run");
      assert.ok(draft.includes(sourcePath), "PR draft lists the changed file");
      // An unrelated change in the second thread's own checkout must never appear in this Run's diff.
      const unrelatedPath = "src/other-thread-change.js";
      await writeFile(join(f.other, unrelatedPath), "export const otherThreadOnly = true;\n");
      const changedLine = fixed.split("\n").find((line) => !original.split("\n").includes(line));
      assert.ok(changedLine);
      // FileDiff paints into shadow roots, so read the Run diff section's text through them.
      const runDiffText = `(() => { const root = document.querySelector('[data-weavra="run-diff"]'); if (!root) return '';
        const parts = []; const walk = (node) => { parts.push(node.textContent ?? '');
          for (const element of node.querySelectorAll('*')) if (element.shadowRoot) walk(element.shadowRoot); };
        walk(root); return parts.join('\\n'); })()`;
      const runDiffShown = await f.browser.arm(`() => ${runDiffText}.includes(${JSON.stringify(changedLine)})`);
      await f.browser.clickAction("show-run-diff");
      await runDiffShown();
      const runDiffFiles = await f.browser.evaluate(`[...document.querySelectorAll('[data-weavra="run-diff-file"]')]
        .map(node => node.getAttribute('data-path'))`);
      assert.deepEqual(runDiffFiles, [sourcePath], "Run diff lists exactly the Run's changed file");
      const shownText = await f.browser.evaluate(runDiffText);
      assert.ok(shownText.includes(sourcePath), "Run diff names the Run's changed file");
      assert.ok(shownText.includes(changedLine), "Run diff shows the Run's changed line");
      assert.equal(shownText.includes(unrelatedPath), false, "Run diff omits the other thread's change");
      assert.equal(await f.browser.evaluate(`!!document.querySelector('[data-weavra="run-diff-refused"]')`), false);
      await captureWidthsAndDark(f, "run-diff", '[data-weavra="run-diff"]', "start");
      f.row.completedHandoff = { usage, labels, prDraft: draft.slice(0, 4000),
        runDiff: { files: runDiffFiles, changedLine, unrelatedPath, unrelatedShown: false } };
    });
    f.row.assertions = ["real COMPLETED Run", "result shows Runtime-reported usage line",
      "변경 보기 shows the Run's own base..result diff: exactly the changed file and its changed line",
      "a change in the other thread's checkout does not appear in the Run diff",
      "PR 설명 초안 복사 writes a draft with ## 수용 기준, MET, Run id and changed file", "no failure section on a completed Run"];
  }],
]);

// G3 App-facing flows (todos 15/31, 26, 27). The browser records every WebSocket frame it sends so a
// cancelled consent can be proven to send nothing to the App server.
async function recordSentFrames(f) {
  await f.browser.evaluate(`(() => {
    if (window.__weavraSent) return;
    window.__weavraSent = [];
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) { window.__weavraSent.push(String(data)); return send.call(this, data); };
  })()`);
}
const sentFrames = (f, ...needles) => f.browser.evaluate(`window.__weavraSent.filter(frame =>
  ${JSON.stringify(needles)}.every(needle => frame.includes(needle))).length`);
async function bounded60(wait, label, f) {
  let timer;
  try {
    return await Promise.race([wait, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 60_000); })]);
  } catch (error) {
    // Keep the visible card text (no transcript) so a stalled wait names what the user saw.
    if (f?.browser) f.row.stalledWait = { label, card: await f.browser.evaluate(`document.querySelector('[data-weavra="controlled-task"]')?.innerText.slice(0, 2000) ?? null`).catch(() => null) };
    throw error;
  } finally { clearTimeout(timer); }
}

await runCase("fact-candidate-confirm", "A failed check's rule candidate is dismissed/restored locally and confirmed into a project fact", [
  ["check-failed-candidate", { mode: "failed-check" }, async (f) => {
    const statement = "검사 eval가 실패로 기록되었으므로 작업을 마치기 전에 이 검사를 통과시켜야 한다.";
    const controlRequests = (type) => f.events.rows.filter((e) => e.kind === "request" && e.type === type).length;
    const row = `[...document.querySelectorAll('[data-weavra="fact-candidate"]')].find(row => row.textContent.includes(${JSON.stringify(statement)}))`;
    const clickInRow = (action) => f.browser.evaluate(`(() => {
      const row = ${row};
      if (!row) throw new Error('Candidate row missing');
      const button = row.querySelector('[data-weavra-action="${action}"]');
      if (!button || button.disabled) throw new Error('${action} unavailable');
      button.click();
    })()`);
    await connect(f, async (client) => {
      await f.create(client); await f.prepare(client); const feed = await f.observe(client);
      await f.complete(client, feed, () => f.confirm(client));
      assert.equal(f.task.execution.receipt.run.status, "BLOCKED");
      const runId = f.task.execution.receipt.run.runId;
      const factsBefore = feed.rows.at(-1).state.projectFacts;
      assert.equal(factsBefore.entries.some((fact) => fact.statement === statement), false, "No fact before consent");
      await openTaskPanel(f);
      await (await f.browser.arm(`() => !!(${row})`))();
      const shown = await f.browser.evaluate(`(() => ({
        title: document.querySelector('[data-weavra="fact-candidates"] h3').textContent,
        text: (${row}).innerText,
        labels: [...(${row}).querySelectorAll('button')].map(button => button.textContent.trim()) }))()`);
      assert.equal(shown.title, "이번 실행에서 배운 규칙 후보");
      assert.ok(shown.text.includes("근거: "), "Candidate names its evidence");
      assert.deepEqual(shown.labels, ["확인", "무시"]);
      await captureWidthsAndDark(f, "candidate", '[data-weavra="fact-candidates"]');
      // 무시 hides locally only; the reverse action shows it again. Neither touches facts.
      const hidden = await f.browser.arm(`() => !(${row}) && !!document.querySelector('[data-weavra-action="restore-fact-candidates"]')`);
      await clickInRow("dismiss-fact-candidate");
      await hidden();
      const restoreLabel = await f.browser.evaluate(`document.querySelector('[data-weavra-action="restore-fact-candidates"]').textContent.trim()`);
      assert.match(restoreLabel, /^숨긴 후보 \d+개 다시 보기$/);
      assert.ok(await f.browser.evaluate(`Object.keys(localStorage).some(key => key.startsWith('weavra:fact-candidates:dismissed:v1:') &&
        localStorage.getItem(key).includes('sha256:'))`), "Dismissal is stored in this browser");
      await captureWidthsAndDark(f, "candidate-hidden", '[data-weavra="fact-candidates"]');
      const restored = await f.browser.arm(`() => !!(${row})`);
      await f.browser.clickAction("restore-fact-candidates");
      await restored();
      assert.equal(controlRequests("facts.prepare") + controlRequests("facts.confirm"), 0, "Dismiss/restore write nothing");
      // 확인 runs the existing consent: facts.prepare, the explicit dialog, then one facts.confirm.
      await (await f.browser.arm(`() => (${row})?.querySelector('[data-weavra-action="confirm-fact-candidate"]')?.disabled === false`))();
      const dialog = `[...document.querySelectorAll('[role="alertdialog"]')].find(d => d.textContent.includes('검토한 참고용 사실을 기록할까요'))`;
      const asked = await f.browser.arm(`() => !!(${dialog})`);
      await clickInRow("confirm-fact-candidate");
      await bounded60(asked(), "Fact consent dialog did not open");
      assert.equal(controlRequests("facts.prepare"), 1, "One facts.prepare before consent");
      assert.equal(controlRequests("facts.confirm"), 0, "Nothing confirmed before consent");
      const consent = await f.browser.evaluate(`(${dialog}).innerText`);
      assert.ok(consent.includes(`run:${runId}#sha256:`), "Consent names the Run-backed source");
      assert.ok(consent.includes(statement), "Consent shows the statement");
      await captureWidthsAndDark(f, "fact-consent", '[role="alertdialog"]');
      const stored = feed.wait((o) => !o.stale && o.state?.projectFacts.entries.some((fact) =>
        fact.status === "VALID" && fact.statement === statement), "confirmed fact in the observed snapshot");
      await f.browser.evaluate(`[...(${dialog}).querySelectorAll('button')].find(button => button.textContent.trim() === 'Confirm').click()`);
      const observed = await bounded60(stored, "Confirmed fact not observed");
      assert.equal(controlRequests("facts.confirm"), 1, "Exactly one facts.confirm after consent");
      const fact = observed.state.projectFacts.entries.find((entry) => entry.statement === statement);
      assert.equal(fact.status, "VALID");
      const persisted = JSON.stringify(await f.readState());
      assert.ok(persisted.includes(statement) && persisted.includes(`run:${runId}#sha256:`), "Fact persisted in canonical state");
      await (await f.browser.arm(`() => !(${row})`))();
      f.row.factCandidate = { runId, statement, restoreLabel, fact,
        controlRequests: { prepare: controlRequests("facts.prepare"), confirm: controlRequests("facts.confirm") } };
    });
    f.row.assertions = ["real BLOCKED Run yields the check_failed rule candidate in the control panel",
      "무시 hides it locally and 숨긴 후보 다시 보기 restores it with no facts command",
      "확인 sends one facts.prepare, shows the consent dialog with the run: source, and only Confirm sends one facts.confirm",
      "the fact is VALID in the observed projectFacts snapshot and persisted in .ai/state.json", "the confirmed candidate is no longer offered"];
  }],
]);

await runCase("dirty-baseline-commit", "A dirty prepare lists the files and commits exactly them only after consent", [
  ["two-dirty-files", {}, async (f) => {
    const dirtyFiles = ["human-notes/a.txt", "human-notes/b.txt"];
    const method = C.WS_METHODS.weavraTaskCommitDirtyBaseline;
    await connect(f, async (client) => {
      await f.create(client);
      await browserConversation(f);
      const draft = f.draft();
      const fields = { goal: draft.goal, symptom: draft.context.symptom,
        hypothesis: draft.context.candidateCause.text, uncertainties: draft.context.uncertainties.join("\n"),
        constraints: draft.context.constraints.join("\n"), criteria: draft.acceptanceStatements.join("\n"),
        sources: JSON.stringify(draft.context.sourceReferences) };
      for (const [field, value] of Object.entries(fields)) await fillTaskField(f, field, value);
      await mkdir(join(f.target, "human-notes"), { recursive: true });
      for (const file of dirtyFiles) await writeFile(join(f.target, file), `human change ${file}\n`);
      const head = (await f.git("rev-parse", "HEAD")).trim();
      await recordSentFrames(f);
      await enabledAction(f, "prepare-handoff");
      const refused = await f.browser.arm(`() => !!document.querySelector('[data-weavra="dirty-workspace"]')`);
      await f.browser.clickAction("prepare-handoff");
      await bounded60(refused(), "Dirty refusal with the file list did not appear", f);
      const listed = await f.browser.evaluate(`[...document.querySelectorAll('[data-weavra="dirty-workspace"] li')].map(li => li.textContent.trim())`);
      assert.deepEqual(listed, dirtyFiles, "Refusal lists exactly the dirty files");
      assert.equal(await f.browser.evaluate(`!!document.querySelector('[data-weavra="dirty-workspace-truncated"]')`), false);
      await f.read(client);
      assert.equal(f.task.phase, "analysis", "Refused prepare leaves an unprepared analysis task");
      await f.noRun();
      await captureWidthsAndDark(f, "dirty-refusal", '[data-weavra="dirty-workspace"]');
      await enabledAction(f, "include-dirty-in-baseline");
      const dialog = await f.browser.arm(`() => !!document.querySelector('[data-weavra="dirty-baseline-confirm"]')`);
      await f.browser.clickAction("include-dirty-in-baseline");
      await dialog();
      await captureWidthsAndDark(f, "dirty-consent", '[data-weavra="dirty-baseline-confirm"]');
      const closed = await f.browser.arm(`() => !document.querySelector('[data-weavra="dirty-baseline-confirm"]')`);
      await f.browser.clickAction("cancel-dirty-baseline");
      await closed();
      assert.equal(await sentFrames(f, method), 0, "Cancel sends no command");
      assert.equal((await f.git("rev-parse", "HEAD")).trim(), head, "Cancel commits nothing");
      assert.equal(await f.git("status", "--porcelain=v1", "--untracked-files=all"), "?? human-notes/a.txt\n?? human-notes/b.txt\n");
      await enabledAction(f, "include-dirty-in-baseline");
      const reopened = await f.browser.arm(`() => !!document.querySelector('[data-weavra="dirty-baseline-confirm"]')`);
      await f.browser.clickAction("include-dirty-in-baseline");
      await reopened();
      const committed = await f.browser.arm(`() => !!document.querySelector('[data-weavra="dirty-baseline-committed"]')`);
      await f.browser.clickAction("confirm-dirty-baseline");
      await bounded60(committed(), "Baseline commit did not complete", f);
      assert.equal(await sentFrames(f, method), 1, "커밋하기 sends exactly one command");
      const newHead = (await f.git("rev-parse", "HEAD")).trim();
      assert.notEqual(newHead, head);
      assert.equal((await f.git("rev-parse", "HEAD^")).trim(), head, "One commit on top of the old HEAD");
      assert.equal((await f.git("log", "-1", "--format=%s")).trim(), "Weavra: 작업 시작 전 기준 커밋");
      assert.deepEqual((await f.git("show", "--name-only", "--format=", "HEAD")).trim().split("\n"), dirtyFiles,
        "The commit contains exactly the two files");
      assert.equal(await f.git("status", "--porcelain=v1", "--untracked-files=all"), "", "Checkout is clean");
      const status = await f.browser.evaluate(`document.querySelector('[data-weavra="dirty-baseline-committed"]').textContent`);
      assert.ok(status.includes(newHead.slice(0, 12)), "Status names the new baseline commit");
      await captureWidthsAndDark(f, "baseline-committed", '[data-weavra="dirty-baseline-committed"]');
      await f.read(client);
      assert.equal(f.task.checkout.headCommit, newHead, "Task is re-bound to the new HEAD");
      const before = prepareRequests(f);
      await enabledAction(f, "prepare-handoff");
      const prepared = await f.browser.arm(`() => !!document.querySelector('[data-weavra="prepared-snapshot"]')`);
      await f.browser.clickAction("prepare-handoff");
      await bounded60(prepared(), "Prepare after the baseline commit did not succeed", f);
      assert.equal(prepareRequests(f), before + 1);
      await f.read(client);
      assert.equal(f.task.phase, "awaiting-confirmation");
      await f.noRun();
      f.row.dirtyBaseline = { listed, oldHead: head, newHead, sentCommitCommands: 1 };
      await rpc(client, C.WS_METHODS.weavraTaskAbort, { task: f.ref(), expectedRevision: f.task.revision });
    });
    f.row.assertions = ["prepare with 2 uncommitted files is refused with exactly those files listed",
      "이 변경을 기준 커밋에 포함 then 취소 sends 0 commit commands and leaves HEAD/status unchanged",
      "커밋하기 sends 1 command; fixture git log/show/status prove one commit of exactly the 2 files on the old HEAD",
      "prepare again succeeds (awaiting-confirmation), no Run or worker"];
  }],
]);

await runCase("setup-trial-check", "Setup trial-runs a saved check only after consent and flags an output overflow", [
  ["trial-pass-and-output-limit", { projectSetup: true }, async (f) => {
    const marker = join(f.base, "trial-runs.log");
    await mkdir(join(f.target, "scripts"), { recursive: true });
    await writeFile(join(f.target, "scripts/trial-pass.sh"), `#!/bin/sh\necho run >> ${quote(marker)}\necho trial-ok\n`, { mode: 0o755 });
    // 400 lines of 51 bytes = 20400 bytes, above the 16 KiB verifier output limit.
    await writeFile(join(f.target, "scripts/trial-loud.sh"),
      `#!/bin/sh\ni=0\nwhile [ $i -lt 400 ]; do echo ${"x".repeat(50)}; i=$((i+1)); done\n`, { mode: 0o755 });
    await f.git("add", "scripts");
    await f.git("commit", "-qm", "Trial check fixtures");
    const config = structuredClone(f.config);
    const extra = (id, file) => ({ id, kind: "test", executable: file, args: [], cwd: ".", required: false,
      timeout_ms: 10_000, trust: { files: [file] } });
    config.verification.checks.push(extra("trial-pass", "scripts/trial-pass.sh"), extra("trial-loud", "scripts/trial-loud.sh"));
    const savedYaml = JSON.stringify(config, null, 2);
    await writeFile(join(f.target, ".ai/config.yaml"), savedYaml, { mode: 0o600 });
    await connect(f, async (client) => {
      const read = await rpc(client, C.WS_METHODS.weavraProjectSetup, { scope: f.scope, action: "read" });
      assert.equal(read.result.kind, "read");
      for (const id of ["trial-pass", "trial-loud"])
        assert.equal(read.result.checkPolicies?.find((entry) => entry.id === id)?.policy, "allowed", `${id} policy`);
    });
    const trialRow = (id) => `[...document.querySelectorAll('[data-weavra="check-trial"]')].find(trial =>
      trial.parentElement.querySelector('[data-weavra="project-check-id"]')?.value === ${JSON.stringify(id)})`;
    const clickTrial = (id, action) => f.browser.evaluate(`(() => {
      const button = (${trialRow(id)})?.querySelector('[data-weavra-action="${action}"]');
      if (!button || button.disabled) throw new Error('${action} unavailable for ${id}');
      button.click();
    })()`);
    const runs = async () => (await exists(marker)) ? (await readFile(marker, "utf8")).split("\n").filter(Boolean).length : 0;
    await openTaskPanel(f);
    await recordSentFrames(f);
    await (await f.browser.arm(`() => document.querySelector('[data-weavra-action="set-up-project"]')?.disabled === false`))();
    const trials = await f.browser.arm(`() => (${trialRow("trial-pass")})?.querySelector('[data-weavra-action="trial-check"]')?.disabled === false &&
      !!(${trialRow("trial-loud")})`);
    await f.browser.clickAction("set-up-project");
    await bounded60(trials(), "시험 실행 did not appear for the saved allowed checks");
    assert.equal(await f.browser.evaluate(`(${trialRow("trial-pass")}).querySelector('[data-weavra-action="trial-check"]').textContent.trim()`), "시험 실행");
    const trialFrames = () => sentFrames(f, C.WS_METHODS.weavraProjectSetup, '"trial-check"');
    await clickTrial("trial-pass", "trial-check");
    const consent = await f.browser.evaluate(`(${trialRow("trial-pass")}).querySelector('[data-weavra="check-trial-consent"]').textContent`);
    assert.equal(consent, "이 명령을 지금 한 번 실행해요: scripts/trial-pass.sh");
    await captureWidthsAndDark(f, "trial-consent", '[data-weavra="check-trial-consent"]');
    await clickTrial("trial-pass", "cancel-trial-check");
    assert.equal(await f.browser.evaluate(`!!(${trialRow("trial-pass")}).querySelector('[data-weavra="check-trial-consent"]')`), false);
    assert.equal(await trialFrames(), 0, "취소 sends no trial request");
    assert.equal(await runs(), 0, "취소 runs nothing");
    const passed = await f.browser.arm(`() => (${trialRow("trial-pass")})?.dataset.outcome === 'passed'`);
    await clickTrial("trial-pass", "trial-check");
    await clickTrial("trial-pass", "confirm-trial-check");
    await bounded60(passed(), "Passing trial result did not appear");
    const passView = await f.browser.evaluate(`(() => { const row = ${trialRow("trial-pass")};
      return { badge: row.querySelector('[data-weavra="check-trial-badge"]').textContent.trim(),
        warning: !!row.querySelector('[data-weavra="check-trial-warning"]'), text: row.innerText }; })()`);
    assert.equal(passView.badge, "통과");
    assert.equal(passView.warning, false);
    assert.ok(passView.text.includes("trial-ok"), "stdout tail is shown");
    assert.equal(await trialFrames(), 1, "실행 sends exactly one trial request");
    assert.equal(await runs(), 1, "The check ran exactly once");
    await captureWidthsAndDark(f, "trial-passed", '[data-weavra="check-trial-badge"]');
    const overflow = await f.browser.arm(`() => (${trialRow("trial-loud")})?.dataset.outcome === 'output-limit'`);
    await clickTrial("trial-loud", "trial-check");
    await clickTrial("trial-loud", "confirm-trial-check");
    await bounded60(overflow(), "Output-limit trial result did not appear");
    const loudView = await f.browser.evaluate(`(() => { const row = ${trialRow("trial-loud")};
      return { badge: row.querySelector('[data-weavra="check-trial-badge"]').textContent.trim(),
        warning: row.querySelector('[data-weavra="check-trial-warning"]')?.textContent.trim() ?? null }; })()`);
    assert.equal(loudView.badge, "출력 초과");
    assert.equal(loudView.warning, "실행 전에 고쳐야 해요");
    await captureWidthsAndDark(f, "trial-output-limit", '[data-weavra="check-trial-warning"]');
    assert.equal(await readFile(join(f.target, ".ai/config.yaml"), "utf8"), savedYaml, "Trial runs never change the saved config");
    assert.equal(await f.git("status", "--porcelain=v1", "--untracked-files=all"), "", "Trial runs leave the checkout clean");
    await f.noRun();
    f.row.trialCheck = { consent, pass: passView.badge, overflow: loudView, trialRequests: await trialFrames(), passRuns: await runs() };
    f.row.assertions = ["시험 실행 shows the one-time consent with the exact command", "취소 sends no request and runs nothing",
      "실행 runs once and shows 통과 with the stdout tail", "a 20400-byte check shows 출력 초과 and 실행 전에 고쳐야 해요",
      "saved config and checkout unchanged, no Run or worker"];
  }],
]);

try {
  const stagedAfter = (await exec("git", ["diff", "--cached", "--name-only"], { cwd: root })).stdout;
  assert.equal(stagedAfter, stagedBefore, "Harness must not stage anything");
  const sourceAfter = (await exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root })).stdout;
  const withoutEvidence = (value) => value.split("\n").filter((line) => !line.slice(3).startsWith("artifacts/problem-cycle/")).join("\n");
  assert.equal(withoutEvidence(sourceAfter), withoutEvidence(sourceBefore), "Product source tree changed during corpus");
  assert.deepEqual(corpus.cases.map(({ id }) => id), selectedCase === undefined ? [
    "normal-success", "ordinary-qa-tool-access", "paged-issue-assessment", "rejected-draft-recovery",
    "wrong-thread-checkout", "competing-provider-settings-terminal", "project-setup", "project-presets", "optional-control-layout", "complex-run-graph", "automatic-git-preparation", "dirty-state",
    "changed-source-config", "misleading-worker-success", "failed-required-check", "missing-permissions",
    "lost-confirm-response", "restart-before-after-run-persistence", "disconnected-stale-evidence",
    "legacy-runtime-capability-absent", "goal-mode-choice", "check-policy-preflight", "failed-result-next-action",
    "completed-handoff", "fact-candidate-confirm", "dirty-baseline-commit", "setup-trial-check",
  ] : [selectedCase], "Every registered case must run exactly once in declaration order");
  const passed = !interrupted && corpus.cases.every((c) => c.verdict === "PASS");
  corpus.verdict = passed ? (selectedCase === undefined ? "PASS" : "FOCUSED_PASS") : "FAIL";
  corpus.completedAt = new Date().toISOString();
  corpus.cleanup = corpus.cases.flatMap((c) => c.attempts.map((a) => ({ caseId: c.id, label: a.label,
    receipt: a.cleanup, passed: !a.cleanupFailed && a.cleanup.some((r) => r.fixtureRemoved === true) })));
  assert.ok(corpus.cleanup.every((r) => r.passed), "Every attempt needs a cleanup receipt");
  // Full canonical failure histories are summarized even when the group failed;
  // never replace a failed attempt with the next attempt's PASS.
  await save();
  if (!passed) process.exitCode = 1;
} catch {
  corpus.verdict = "FAIL"; corpus.finalizationFailure = true; await save(); process.exitCode = 1;
}
console.log(`TASK8_CORPUS ${corpus.verdict} ${reportPath}`);
