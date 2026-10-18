// Task8-only transports. No Run/check/review state is constructed here.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(import.meta.url);
const json = async (path) => JSON.parse(await fs.readFile(path, "utf8"));
async function post(config, event) {
  const response = await fetch(`${config.broker}/event`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(event), signal: AbortSignal.timeout(120_000),
  });
  assert.equal(response.status, 200, "Task8 instrumentation broker failed");
  return response.json();
}
// Preserve data, errors, return value and all nonmatching operations. The original
// rename finishes BEFORE observation/gating. Only the selected Runtime imports us.
if (process.env.WEAVRA_TASK8_HOOK) {
  const config = await json(process.env.WEAVRA_TASK8_HOOK);
  // The selected Runtime has consumed the hook; its children must not inherit it.
  delete process.env.NODE_OPTIONS;
  delete process.env.WEAVRA_TASK8_HOOK;
  assert.equal(process.cwd(), config.cwd);
  assert.equal(await fs.realpath(config.cwd), config.cwd);
  const rename = fs.rename;
  fs.rename = async (...args) => {
    const result = await rename(...args);
    if (String(args[1]) !== `${config.cwd}/.ai/state.json`) return result;
    const state = await json(`${config.cwd}/.ai/state.json`);
    const admissions = (state.taskAdmissions ?? []).map((a) => ({
      taskId: a.metadata.binding.taskId, executionId: a.metadata.binding.executionId,
      outcome: a.outcome, cleanup: a.cleanup, admittedProjectRevision: a.metadata.admittedProjectRevision,
    }));
    const runs = state.runs.map((r) => ({ runId: r.runId, revision: r.revision, status: r.status }));
    await post(config, { kind: "persisted", pid: process.pid, cwd: config.cwd,
      projectRevision: state.revision, admissions, runs });
    return result;
  };
  const unlink = fs.unlink;
  fs.unlink = async (...args) => {
    const result = await unlink(...args);
    if (String(args[0]) === `${config.cwd}/.ai/writer.lock`) {
      const state = await json(`${config.cwd}/.ai/state.json`);
      await post(config, { kind: "writer-closed", pid: process.pid, cwd: config.cwd,
        executionIds: (state.taskAdmissions ?? []).map(admission => admission.metadata.binding.executionId) });
    }
    return result;
  };
  syncBuiltinESMExports();
} else if (process.argv[2] === "--relay") {
  const config = await json(process.argv[3]);
  const runtimeArgs = process.argv.slice(4);
  assert.equal(process.cwd(), config.cwd);
  const control = runtimeArgs.join(" ") === "bridge --stdio --project-trusted --control";
  // A launcher-scoped env, not inherited global NODE_OPTIONS. The production
  // verifier's own filtered environment remains untouched.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.WEAVRA_TASK8_HOOK;
  if (control && config.instrument) {
    env.NODE_OPTIONS = `--import=${JSON.stringify(here)}`;
    env.WEAVRA_TASK8_HOOK = process.argv[3];
  }
  const child = spawn(config.runtime, runtimeArgs, { env, stdio: ["pipe", "pipe", "inherit"] });
  const requests = new Map();
  const previews = new Map();
  let input = Buffer.alloc(0), output = Buffer.alloc(0);
  let inputWork = Promise.resolve(), outputWork = Promise.resolve();
  const frame = (data, pending, consume) => {
    pending = Buffer.concat([pending, data]);
    for (;;) {
      const i = pending.indexOf(10);
      if (i < 0) return pending;
      consume(pending.subarray(0, i + 1));
      pending = pending.subarray(i + 1);
    }
  };
  await post(config, { kind: "runtime-start", pid: child.pid, relayPid: process.pid, control });
  process.stdin.on("data", (data) => {
    input = frame(data, input, (bytes) => {
      inputWork = inputWork.then(async () => {
        const request = JSON.parse(bytes.toString("utf8"));
        const preview = previews.get(request.previewId);
        const executionId = request.type === "workflow.confirm" &&
          preview?.previewDigest === request.previewDigest ? preview.executionId : null;
        requests.set(request.id, { type: request.type, executionId });
        await post(config, { kind: "request", pid: child.pid, type: request.type,
          id: request.id, executionId });
        child.stdin.write(bytes); // no reserialization of noninjected traffic
      });
      inputWork.catch(() => process.exit(1));
    });
  });
  child.stdout.on("data", (data) => {
    output = frame(data, output, (bytes) => {
      outputWork = outputWork.then(async () => {
        const reply = JSON.parse(bytes.toString("utf8"));
        const request = requests.get(reply.id);
        if (reply.success && reply.data?.kind === "prepared" && reply.data.preview.taskBinding) {
          const p = reply.data.preview;
          previews.set(p.previewId, { previewDigest: p.previewDigest,
            executionId: p.taskBinding.executionId });
        }
        const disposition = await post(config, { kind: "response", pid: child.pid,
          id: reply.id, type: request?.type ?? null, executionId: request?.executionId ?? null,
          success: reply.success === true, dataKind: reply.data?.kind ?? null });
        if (disposition.drop === true) {
          assert.equal(request?.type, "workflow.confirm");
          assert.ok(request.executionId);
          assert.equal(reply.success, true);
          assert.equal(reply.data.kind, "accepted");
          await post(config, { kind: "confirm-response-dropped", pid: child.pid,
            id: reply.id, executionId: request.executionId });
          return;
        }
        if (config.legacy && request?.type === "control.hello" && reply.success) {
          assert.equal(reply.data.kind, "capabilities");
          assert.equal(reply.data.capabilities.taskBinding, 1);
          delete reply.data.capabilities.taskBinding;
          delete reply.data.capabilities.analysisContext;
          delete reply.data.capabilities.evidenceDetails;
          process.stdout.write(`${JSON.stringify(reply)}\n`);
        } else process.stdout.write(bytes);
      });
      outputWork.catch(() => process.exit(1));
    });
  });
  process.stdin.once("end", () => void inputWork.then(() => {
    if (input.length) child.stdin.write(input);
    child.stdin.end();
  }));
  child.once("error", () => process.exit(1));
  child.once("close", (code, signal) => void outputWork.then(async () => {
    if (output.length) process.stdout.write(output);
    await post(config, { kind: "runtime-exit", pid: child.pid, code, signal });
    process.exitCode = code ?? 1;
    process.stdin.destroy();
  }));
  for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => child.kill(signal));
} else if (process.argv[2] === "--codex" || process.argv[2] === "--codex-qa") {
  const config = await json(process.argv[3]);
  const args = process.argv.slice(4);
  const ordinaryQa = process.argv[2] === "--codex-qa";
  const qaEndpoint = args.find(arg => arg.startsWith("mcp_servers.t3-code.url="))
    ?.slice("mcp_servers.t3-code.url=".length);
  if (args.includes("--version")) {
    console.log("codex-cli 1.0.0");
  } else if (args.includes("exec")) {
    for await (const _ of process.stdin) { /* drain title-only invocation */ }
    const output = args[args.indexOf("--output-last-message") + 1];
    assert.ok(output);
    await fs.writeFile(output, JSON.stringify({ title: "Greeting investigation" }));
  } else {
    let sequence = 0;
    const threadId = `${ordinaryQa ? "qa" : "analysis"}-${process.pid}`;
    const send = (value) => process.stdout.write(`${JSON.stringify(value)}\n`);
    const toolProbes = new Map();
    for await (const line of createInterface({ input: process.stdin })) {
      const request = JSON.parse(line);
      if (request.id === undefined) continue;
      if (toolProbes.has(request.id)) {
        const { turnId, item } = toolProbes.get(request.id);
        toolProbes.delete(request.id);
        assert.equal(request.error, undefined, "Dynamic tool rejection must use its typed response");
        assert.equal(request.result?.success, false, "Controlled analysis must deny dynamic tools");
        await post(config, { kind: "analysis-tool-rejected", threadId, turnId, success: false });
        send({ method: "item/completed", params: { completedAtMs: 1, item, threadId, turnId } });
        send({ method: "turn/completed", params: { threadId,
          turn: { completedAt: 1, id: turnId, items: [item], status: "completed" } } });
        continue;
      }
      const p = request.params ?? {};
      // Whitelist observations; never log raw prompts, requests, or credentials.
      await post(config, { kind: ordinaryQa ? "qa-request" : "analysis-request", method: request.method,
        ...(request.method === "thread/start" || request.method === "thread/resume"
          ? { sandbox: p.sandbox, approvalPolicy: p.approvalPolicy } : {}),
        ...(request.method === "turn/start" ? { sandboxPolicy: p.sandboxPolicy } : {}) });
      let result;
      switch (request.method) {
        case "initialize": result = { codexHome: process.env.CODEX_HOME,
          platformFamily: "unix", platformOs: process.platform, userAgent: "task8-scripted" }; break;
        case "config/read": result = { config: {
          features: Object.fromEntries(["apps", "plugins", "hooks", "codex_hooks", "plugin_hooks",
            "skill_mcp_dependency_install"].map((f) => [f, !args.some((a, i) => a === "--disable" && args[i + 1] === f)])),
          mcp_servers: ordinaryQa && qaEndpoint ? { "t3-code": {
            url: qaEndpoint, bearer_token_env_var: "T3_MCP_BEARER_TOKEN", enabled: true,
          } } : {},
        }, origins: {}, layers: [] }; break;
        case "account/read": result = { account: { type: "apiKey" }, requiresOpenaiAuth: false }; break;
        case "account/rateLimits/read": result = { rateLimits: null, rateLimitsByLimitId: null }; break;
        case "config/mcpServer/reload":
          assert.equal(ordinaryQa, true, "Controlled analysis must not reload an MCP catalog");
          assert.ok(qaEndpoint && process.env.T3_MCP_BEARER_TOKEN);
          result = {};
          break;
        case "skills/list": result = { data: [] }; break;
        case "model/list": result = { data: (config.presetModels
          ? ["gpt-5.3-codex-spark", "gpt-5.6-sol", "gpt-6-astra"]
          : ["gpt-5.3-codex"]).map(model => ({ defaultReasoningEffort: "medium", description: "fixture",
          displayName: model, hidden: false, id: model, isDefault: true,
          model, supportedReasoningEfforts: [{ description: "fixture", reasoningEffort: "medium" }] })),
          nextCursor: null }; break;
        case "thread/start": case "thread/resume": result = {
          approvalPolicy: p.approvalPolicy, approvalsReviewer: p.approvalsReviewer,
          cwd: p.cwd ?? process.cwd(), model: p.model ?? "gpt-5.3-codex", modelProvider: "openai",
          sandbox: { type: "readOnly", networkAccess: false }, thread: {
            cliVersion: "1.0.0", createdAt: 1, cwd: p.cwd ?? process.cwd(), ephemeral: false,
            id: threadId, modelProvider: "openai", preview: "", sessionId: `session-${process.pid}`,
            source: "cli", status: { type: "idle" }, turns: [], updatedAt: 1,
          },
        }; break;
        case "turn/start": {
          if (ordinaryQa) {
            assert.ok(qaEndpoint, "Ordinary QA requires a normally issued MCP endpoint");
            assert.ok(process.env.T3_MCP_BEARER_TOKEN, "Ordinary QA requires a normally issued credential");
            const turnId = `${threadId}-turn-${++sequence}`;
            send({ id: request.id, result: { turn: { id: turnId, items: [], status: "inProgress" } } });
            send({ method: "turn/started", params: { threadId, turn: { id: turnId, items: [], status: "inProgress" } } });
            // This credential goes only to the private fixture broker, never stdout or a report.
            await post(config, { kind: "qa-credential", endpoint: qaEndpoint,
              authorizationHeader: `Bearer ${process.env.T3_MCP_BEARER_TOKEN}` });
            const text = config.qaControlDraft
              ? "```weavra-control\n" + JSON.stringify({
                  version: 1, goal: "Fix the greeting implementation",
                  symptom: "The greeting omits a letter",
                  criteria: ["The greeting includes Hello", "The registered greeting test passes"],
                  constraints: ["Preserve the registered test"],
                }) + "\n```"
              : "Owned QA tool session ready.";
            const item = { id: `${turnId}-message`, type: "agentMessage", text };
            send({ method: "item/completed", params: { completedAtMs: 1, item, threadId, turnId } });
            send({ method: "turn/completed", params: { threadId,
              turn: { completedAt: 1, id: turnId, items: [item], status: "completed" } } });
            continue;
          }
          assert.deepEqual(p.sandboxPolicy, { type: "readOnly", networkAccess: false });
          const turnId = `${threadId}-turn-${++sequence}`;
          const text = sequence === 1
            ? "Early hypothesis: a locale setting causes the greeting failure. This is unverified."
            : "Corrected hypothesis: src/greeting.js contains Helo instead of Hello; locale is not the cause. Runtime must re-read the source and run the registered check.";
          const item = { id: `${turnId}-message`, type: "agentMessage", text };
          send({ id: request.id, result: { turn: { id: turnId, items: [], status: "inProgress" } } });
          send({ method: "turn/started", params: { threadId, turn: { id: turnId, items: [], status: "inProgress" } } });
          const probeId = `${turnId}-external-tool`;
          toolProbes.set(probeId, { turnId, item });
          send({ id: probeId, method: "item/tool/call", params: {
            callId: probeId, threadId, turnId, tool: "fixture_external_tool", arguments: {},
          } });
          continue;
        }
        case "turn/interrupt": result = {}; break;
        default:
          if (ordinaryQa) await post(config, { kind: "qa-unsupported", method: request.method });
          throw new Error(`Unsupported scripted ${ordinaryQa ? "QA" : "analysis"} method: ${request.method}`);
      }
      send({ id: request.id, result });
    }
  }
} else {
  throw new Error("Task8 peer requires --relay/--codex/--codex-qa, or the isolated Runtime hook environment");
}
