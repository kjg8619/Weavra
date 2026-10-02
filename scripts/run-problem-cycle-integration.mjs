#!/usr/bin/env node
// Run from the product root with Node >=24:
// WEAVRA_CHROMIUM=/owned/chromium node scripts/run-problem-cycle-integration.mjs \
//   --evidence-dir=/owned/evidence/task8 [--interactive]
// --case=<group-id> runs a focused diagnostic; it cannot report full corpus PASS.
// Default evidence: ./artifacts/problem-cycle/task-8-corpus.json. Use a NEW
// --evidence-dir per invocation; existing reports are never overwritten. No installs or
// builds are performed. Prerequisites: Runtime npm build/offline data snapshot,
// App pnpm11 dependencies and current App web build, git, owned Chromium.
// --interactive leaves the NORMAL case's actual App/browser open until ENTER,
// then still runs every case and requires all cleanup receipts. No paid models.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import { startScriptedModel } from "./scripted-model-server.mjs";
import { bounded, Events, openBrowser } from "./problem-cycle-browser.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(root, "app/t3code");
const runtime = join(root, "runtime/pi/packages/company-runtime/bin/weavra");
const peers = join(root, "scripts/problem-cycle-peers.mjs");
const args = process.argv.slice(2);
assert.ok(args.every((a) => a === "--interactive" || a.startsWith("--evidence-dir=") || a.startsWith("--case=")), "Unknown argument");
const interactive = args.includes("--interactive");
const selectedCase = args.find((a) => a.startsWith("--case="))?.slice(7);
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
  selection: selectedCase ?? null, fullCorpus: selectedCase === undefined,
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
  const constructor = Layer.succeed(Socket.WebSocketConstructor,
    (u, protocols) => new NodeSocket.NodeWS.WebSocket(u, protocols));
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
      config: digest(await readFile(join(f.target, ".ai/config.yaml"))) };
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
    const task = await f.reconcile(client);
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
      legacy: options.legacy === true, instrument: true }), { mode: 0o600 });
    f.runtimeWrapper = join(f.bin, "runtime");
    f.codex = join(f.bin, "codex");
    await writeFile(f.runtimeWrapper, `#!/bin/sh\nexec ${[node, peers, "--relay", f.peerConfig].map(quote).join(" ")} "$@"\n`, { mode: 0o700 });
    await writeFile(f.codex, `#!/bin/sh\nexec ${[node, peers, "--codex", f.peerConfig].map(quote).join(" ")} "$@"\n`, { mode: 0o700 });
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
    if (index === 1) f.correctedMessage = message.messageId;
    if (f.browser) {
      f.row.stage = `analysis-message-registered-${index + 1}`;
      try {
        await (await f.browser.arm(`() => [...document.querySelectorAll('option')]
          .some(option => option.value === ${JSON.stringify(message.messageId)})`))();
        f.row.stage = `analysis-visible-${index + 1}`;
        const readerReady = await f.browser.arm(`() => [...document.querySelectorAll('summary')]
          .some(summary => summary.textContent.trim() === 'Read selected visible message')`);
        await f.browser.evaluate(`(() => {
          const select = [...document.querySelectorAll('select')].find(element =>
            [...element.options].some(option => option.value === ${JSON.stringify(message.messageId)}));
          if (!select) throw new Error('Exact message source selector absent');
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, ${JSON.stringify(message.messageId)});
          select.dispatchEvent(new Event('change', { bubbles: true }));
        })()`);
        await readerReady();
        await f.browser.evaluate(`(() => {
          const summary = [...document.querySelectorAll('summary')]
            .find(element => element.textContent.trim() === 'Read selected visible message');
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
          controlledCard: !!document.querySelector('[aria-label="Controlled task"]'),
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
  f.row.stage = "browser-controlled-card";
  await f.browser.waitText("Controlled task");
  await f.browser.waitText(f.task.id);
  assert.equal(await f.browser.evaluate("location.pathname"), path);
  f.row.visibleConversation = { environmentId: f.scope.environmentId, threadId: f.scope.threadId, path };
  f.row.stage = "assertions";
}
async function visibleEvidence(f) {
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
    const loaded = await f.browser.arm(`() => !!document.querySelector('[aria-label="${category} record 1"]')`);
    await f.browser.click("Load canonical evidence"); await loaded();
  }
  await f.browser.waitText("Original issue verified for this Run");
  await f.browser.evaluate(`document.querySelector('[aria-label="Controlled outcome"]').scrollIntoView({ block: 'start' })`);
  const screenshot = join(evidenceDir, `${f.row.id}-completed-summary.png`);
  await f.browser.screenshot(screenshot);
  f.row.screenshots.push(screenshot);
  await f.browser.evaluate(`(() => {
    const records = document.querySelectorAll('[aria-label^="checks record"]');
    if (!records.length) throw new Error('Loaded checks missing');
    records[records.length - 1].scrollIntoView({ block: 'center' });
  })()`);
  const checksShot = join(evidenceDir, `${f.row.id}-completed-checks.png`);
  await f.browser.screenshot(checksShot);
  f.row.screenshots.push(checksShot);
  await f.browser.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Reload evidence snapshot');
    if (!button) throw new Error('Evidence reload missing');
    button.scrollIntoView({ block: 'center' });
  })()`);
  const controlsShot = join(evidenceDir, `${f.row.id}-completed-controls.png`);
  await f.browser.screenshot(controlsShot);
  f.row.screenshots.push(controlsShot);
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
async function runCase(id, name, attempts) {
  if (selectedCase !== undefined && selectedCase !== id) return;
  const group = { id, name, verdict: "FAIL", attempts: [], identities: [], cleanup: [], screenshots: [] };
  corpus.cases.push(group);
  for (const [label, options, body] of attempts) {
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
    await f.create(client); await browserConversation(f); await analyze(f, client);
    await f.prepare(client);
    assert.equal(f.task.execution.preview.workflow, "STANDARD");
    assert.equal(f.task.execution.binding.checkout.canonicalCwd, f.target);
    const feed = await f.observe(client);
    await f.complete(client, feed, () => f.confirm(client));
    assertSuccess(f, await evidence(f, client));
    await unchangedExcept(f, fixed);
    const run = (await f.readState()).runs[0];
    const developer = run.roleSessionRefs.find((s) => s.role === "Developer");
    const reviewer = run.roleSessionRefs.find((s) => s.role === "Reviewer");
    assert.ok(developer && reviewer); assert.notEqual(developer.sessionId, reviewer.sessionId);
    assert.deepEqual(fixture.oracle({ workspace: f.target }), []);
    await visibleEvidence(f);
    f.row.assertions = ["unchanged registered symptom FAIL", "read-only wrong/corrected hypotheses visible",
      "real separate worker/reviewer sessions", "strict fresh SELF_CHECK and TEST", "Kernel COMPLETED",
      "frozen symptom registration matches", "same visible thread", "only intended source changed"];
    if (interactive) {
      console.log(`TASK8_INTERACTIVE origin=${f.origin} taskId=${f.task.id}; press ENTER to continue corpus`);
      const input = createInterface({ input: process.stdin });
      await bounded(new Promise((res) => { input.once("line", res); input.once("close", res); }), "interactive review", 900_000);
      input.close();
    }
  });
}]]);

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
  ["runtime-owner", { sharedCheckout: true, hold: true, mode: "misleading" }, async (f) => {
    await connect(f, async (client) => {
      await f.create(client); await f.prepare(client); const feed = await f.observe(client);
      const held = f.events.wait((e) => e.kind === "worker-held", "exact worker held before any file tool");
      await f.confirm(client); await held;
      await f.reconcile(client);
      await browserConversation(f);
      await (await f.browser.arm(`() => [...document.querySelectorAll('button')]
        .some(button => button.textContent.trim() === 'Recover interrupted task' && !button.disabled)`))();
      const busyResponse = f.events.wait((event) => event.kind === "response" &&
        event.type === "workflow.recover" && !event.success, "live owner refuses explicit recovery");
      const busyGuidance = await f.browser.arm(`() => document.body.innerText.includes('RECOVERY_BUSY')`);
      await f.browser.click("Recover interrupted task");
      await busyResponse;
      await busyGuidance();
      assert.equal(await f.browser.evaluate("document.body.innerText.includes('Interruption recorded.')"), false);
      assert.equal((await f.readState()).runs[0].status, "RUNNING");
      for (const [width, height] of [[1280, 900], [375, 812]]) {
        await f.browser.viewport(width, height);
        await f.browser.evaluate(`document.querySelector('[aria-label="Controlled task"] [role="alert"]').scrollIntoView({ block: 'center' })`);
        const path = join(evidenceDir, `live-recovery-rejected-${width}.png`);
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
      // Subscribe to the production reactor's denial before dispatch. There is
      // one competing event in this isolated App; no no-op receipt bus is used.
      const denied = f.logs.wait((s) => s.includes("provider command reactor failed to process event") &&
        s.includes("thread.turn-start-requested"), "production provider ownership rejection");
      await rpc(client, C.ORCHESTRATION_WS_METHODS.dispatchCommand, { type: "thread.turn.start", commandId,
        threadId: f.otherThread, message: { messageId, role: "user", text: "Change the greeting now", attachments: [] },
        runtimeMode: f.thread.runtimeMode, interactionMode: "default", createdAt: new Date().toISOString() });
      await accepted; await denied;
      await unchangedExcept(f, original);
      await f.complete(client, feed, async () => f.held.resolve());
      assert.notEqual(f.task.execution.receipt.run.status, "COMPLETED");
      assert.equal(f.events.rows.filter((e) => e.kind === "analysis-request" && e.method === "turn/start").length, 0);
      assert.equal(f.events.rows.filter((e) => e.kind === "request" && e.type === "workflow.confirm").length, 1);
      await unchangedExcept(f, original);
      f.row.assertions = ["provider/settings/file-save/terminal rejected during Runtime ownership", "only one real Run", "no competing edits or provider turn", "misleading owner never completes"];
    });
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
      .some(button => button.textContent.trim() === 'Recover interrupted task' && !button.disabled)`))();
    const recoveryResponse = f.events.wait((event) => event.kind === "response" &&
      event.type === "workflow.recover" && event.success && event.dataKind === "task-recovery",
      "explicit UI recovery response");
    const displayed = await f.browser.arm(phase === "before-run"
      ? `() => document.body.innerText.includes('INTERRUPTED_BEFORE_START') && document.body.innerText.includes('ownership released')`
      : `() => document.body.innerText.includes('Run INTERRUPTED') && document.body.innerText.includes('Cleanup is not verified')`);
    await f.browser.click("Recover interrupted task");
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
      await f.browser.evaluate(`document.querySelector('[aria-label="Controlled task"]').scrollIntoView({ block: 'start' })`);
      const path = join(evidenceDir, `recovered-${phase}-${width}.png`);
      await f.browser.screenshot(path);
      const image = await readFile(path);
      assert.equal(image.readUInt32BE(16), width);
      assert.equal(image.readUInt32BE(20), height);
      assert.equal(await f.browser.evaluate("document.documentElement.scrollWidth"), width);
      f.row.screenshots.push(path);
      const actionNames = phase === "before-run"
        ? ["Start controlled task", "Return to free coding"]
        : ["Refresh task state", "Recover interrupted task"];
      await f.browser.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(b =>
          b.textContent.trim() === ${JSON.stringify(actionNames.at(-1))});
        if (!button) throw new Error('Recovery action absent');
        button.scrollIntoView({ block: 'center' });
      })()`);
      const actionShot = join(evidenceDir, `recovered-${phase}-actions-${width}.png`);
      await f.browser.screenshot(actionShot);
      const hitTests = await f.browser.evaluate(`(${JSON.stringify(actionNames)}).map(name => {
        const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === name);
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
    const historical = await f.browser.arm(`() => document.body.innerText.includes('Historical outcome; reconnect') &&
      !document.body.innerText.includes('Original issue verified for this Run')`);
    await f.stop(); await historical();
    await f.browser.waitText("Original issue unverified");
    for (const [width, height] of [[1280, 900], [375, 812]]) {
      await f.browser.viewport(width, height);
      await f.browser.evaluate(`document.querySelector('[aria-label="Controlled outcome"]').scrollIntoView({ block: 'start' })`);
      const screenshot = join(evidenceDir, `task8-disconnected-${width}.png`);
      await f.browser.screenshot(screenshot); f.row.screenshots.push(screenshot);
      assert.equal(await f.browser.evaluate(`(() => {
        const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Reload evidence snapshot');
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

try {
  const stagedAfter = (await exec("git", ["diff", "--cached", "--name-only"], { cwd: root })).stdout;
  assert.equal(stagedAfter, stagedBefore, "Harness must not stage anything");
  const sourceAfter = (await exec("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: root })).stdout;
  const withoutEvidence = (value) => value.split("\n").filter((line) => !line.slice(3).startsWith("artifacts/problem-cycle/")).join("\n");
  assert.equal(withoutEvidence(sourceAfter), withoutEvidence(sourceBefore), "Product source tree changed during corpus");
  assert.equal(corpus.cases.length, selectedCase === undefined ? 12 : 1);
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
