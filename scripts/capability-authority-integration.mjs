import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import fsp from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import * as Schema from "../app/t3code/apps/server/node_modules/effect/dist/Schema.js";
import { WeavraControlResponse } from "../app/t3code/packages/contracts/src/weavraControl.ts";
import { createWorkerTools, WORKER_FILE_TOOLS, workerDigest } from "../runtime/pi/packages/company-runtime/src/agent-tools.ts";
import { parseRuntimeConfig } from "../runtime/pi/packages/company-runtime/src/config.ts";
import { FilePolicyPathInspector } from "../runtime/pi/packages/company-runtime/src/policy-paths.ts";
import { evaluatePolicy, evaluateRegisteredCheck } from "../runtime/pi/packages/company-runtime/src/policy.ts";
import { buildTaskContract } from "../runtime/pi/packages/company-runtime/src/task-contract.ts";
import { RegisteredVerifier } from "../runtime/pi/packages/company-runtime/src/verification.ts";
import { GitWorkspace } from "../runtime/pi/packages/company-runtime/src/workspace.ts";
import { assertCanComplete } from "../runtime/pi/packages/company-runtime/src/kernel.ts";
import { HostControlBridge } from "../runtime/pi/packages/company-runtime/src/host-control.ts";
import { boundCapabilityInventory } from "../runtime/pi/packages/company-runtime/src/capability-broker.ts";

export async function runAuthorityIntegration({ state, unavailable, project, config: source }) {
  const config = parseRuntimeConfig(JSON.stringify(source));
  const inventory = state.capabilityInventory;
  assert.equal(inventory.status, "CURRENT");
  assert.equal(inventory.entries.find((row) => row.descriptor.name === "runtime_delete").observation.availability, "AVAILABLE");
  const signal = new AbortController().signal;
  const runId = "broker-authority";
  const task = buildTaskContract({ goal: "Verify status", statements: ["Status says Ready"], workflow: "STANDARD", config, taskId: "broker-task" });
  const request = { executionMode: "READ_ONLY", runId, revision: 0, step: { stepId: "implement", attempt: 1 }, task, role: "Developer", profile: "coding" };
  const policy = { executionMode: "READ_ONLY", executionRunId: runId, tools: [...WORKER_FILE_TOOLS, { id: "runtime_delete", operation: "delete" }], allowedPaths: config.files.allowed_paths, configDigest: workerDigest(config) };
  const paths = await FilePolicyPathInspector.open(project);
  // Real adapter/filesystem and Policy; local audit ledger is a deterministic port,
  // not a claim of durable Kernel approval. Durable one-use remains a rerun gate.
  const decisions = [];
  const audit = { prepare: async (decision) => { decisions.push(decision); }, finish: async () => {}, assertWritable: async () => {} };
  const variants = [undefined, inventory, unavailable, { ...inventory, approved: true, enabled: true, permissions: ["*"], readOnlyHint: true }];
  let exposed;
  for (const capabilityInventory of variants) {
    const worker = createWorkerTools({ cwd: project, config, request: { ...request, capabilityInventory }, policy: { ...policy, capabilityInventory }, paths, audit, signal, assertActive: () => {}, capabilityInventory });
    const names = worker.tools.map((tool) => tool.name);
    exposed ??= names;
    assert.deepEqual(names, exposed);
    for (const name of ["runtime_write", "runtime_edit", "runtime_delete", "runtime_lsp_diagnostics", "preview_snapshot", "shell"]) assert.equal(names.includes(name), false);
    const result = await worker.tools.find((tool) => tool.name === "runtime_read").execute("read", { path: "src/status.txt" }, signal, undefined, {});
    assert.equal(result.content[0].text, "Ready\n");
    await assert.rejects(() => worker.tools.find((tool) => tool.name === "runtime_request_check").execute("check", { id: "invented-pass" }, signal, undefined, {}));
    assert.equal(worker.result(), undefined);
    assert.equal(await readFile(join(project, "src/status.txt"), "utf8"), "Ready\n");
    const action = { runId, actionId: "write", actionDigest: "input", role: "Developer", tool: "runtime_write", risk: "R0", paths: ["src/status.txt"], capabilityInventory };
    assert.equal(evaluatePolicy(action, { ...policy, capabilityInventory }, await paths.inspect(action.paths)).decision, "DENY");
    const r2 = { ...action, paths: ["package.json"] };
    const inspected = [{ path: "package.json", kind: "file", safe: true }];
    assert.equal(evaluatePolicy(r2, { ...policy, executionMode: "EDIT", capabilityInventory }, inspected).decision, "REVIEW_REQUIRED");
    assert.equal(evaluatePolicy(r2, { ...policy, executionMode: "EDIT", r2RunId: "foreign", capabilityInventory }, inspected).decision, "DENY");
    assert.equal(evaluatePolicy(r2, { ...policy, executionMode: "EDIT", r2RunId: runId, capabilityInventory }, inspected).decision, "ALLOW");
  }
  assert.ok(decisions.some((decision) => decision.decision === "ALLOW"));
  console.log("ACTUAL adapters/filesystem + DETERMINISTIC sidebands PASS N19–N22/N29: App-decoded AVAILABLE/UNKNOWN/absent never changes tools or READ_ONLY/R2; independently authorized read succeeds");

  let savedGrant;
  let consumed = 0;
  const deletePolicy = { ...policy, executionMode: "EDIT", r3Scope: { runId, targetPath: "src/status.txt" } };
  const attempt = async (alter) => {
    const worker = createWorkerTools({ cwd: project, config, policy: { ...deletePolicy, capabilityInventory: inventory }, paths, audit, signal, assertActive: () => {}, request: {
      ...request, executionMode: "EDIT", capabilityInventory: inventory,
      onApprovalRequested: async (proposal) => {
        const grant = { runId: proposal.runId, actionId: proposal.actionId, actionDigest: proposal.actionDigest, configDigest: proposal.configDigest, approved: true, expiresAt: Date.now() + 60_000 };
        return alter(grant);
      },
      onApprovalConsumed: async () => { consumed++; },
    } });
    return worker.tools.find((tool) => tool.name === "runtime_delete").execute("delete", { path: "src/status.txt" }, signal, undefined, {});
  };
  for (const alter of [
    (g) => ({ ...g, approved: false }), (g) => ({ ...g, expiresAt: 0 }),
    (g) => ({ ...g, runId: "foreign" }), (g) => ({ ...g, actionId: "foreign" }),
    (g) => ({ ...g, actionDigest: "foreign-workspace-input" }), (g) => ({ ...g, configDigest: "foreign-config" }),
  ]) {
    await assert.rejects(() => attempt(alter));
    assert.equal(await readFile(join(project, "src/status.txt"), "utf8"), "Ready\n");
    assert.equal(consumed, 0);
  }
  await attempt((grant) => { savedGrant = grant; return grant; });
  await assert.rejects(() => access(join(project, "src/status.txt")), { code: "ENOENT" });
  assert.equal(consumed, 1);
  await writeFile(join(project, "src/status.txt"), "Ready\n");
  await assert.rejects(() => attempt(() => savedGrant));
  assert.equal(await readFile(join(project, "src/status.txt"), "utf8"), "Ready\n");
  assert.equal(consumed, 1);
  console.log("ACTUAL delete adapter/filesystem + FAUX consent port PASS N15/N16/N22: current exact grant required; denial/expiry/foreign bindings/replayed grant have no effect");

  // Execute a real registered local process that returns FAIL. No provider needed.
  await writeFile(join(project, ".ai/check.mjs"), "process.exitCode = 1;\n");
  const verificationConfig = parseRuntimeConfig(JSON.stringify({ ...source, verification: { checks: [{ id: "local-fail", kind: "test", executable: process.execPath, args: [".ai/check.mjs"], required: true }] } }));
  const verifyPolicy = { ...policy, executionMode: "EDIT", configDigest: workerDigest(verificationConfig), capabilityInventory: inventory };
  const workspace = await GitWorkspace.open(project, verifyPolicy);
  const verifier = await RegisteredVerifier.create(verificationConfig, verifyPolicy, audit, workspace);
  const checks = verifier.trustRequirements.map(({ id, kind, required, trustRequired, trustRegistrationDigest, browser }) => ({ id, kind, required, trustRequired, trustRegistrationDigest, browser }));
  const verifyTask = buildTaskContract({ goal: "Check Ready status", statements: ["Status says Ready"], workflow: "STANDARD", config: verificationConfig, taskId: "negative-task" });
  const handoff = { runId, revision: 0, role: "Developer", task: verifyTask.id, summary: "Broker cannot replace a failing check", changed_files: [], assumptions: [], tests_run: [], known_risks: [], unresolved: [] };
  const result = await verifier.verify({ runId, revision: 0, step: { stepId: "self-check", attempt: 1 }, task: verifyTask, checks, handoff, capabilityInventory: inventory });
  assert.equal(result.checks[0].status, "FAIL", JSON.stringify(result));
  assert.equal(result.checks[0].exitCode, 1, JSON.stringify(result));
  assert.equal(verifier.safeToRelease, true);
  assert.throws(() => assertCanComplete({ executionMode: "EDIT", runId, revision: 0, task: verifyTask, checks, workflow: "STANDARD", risk: "R1", handoff, selfCheck: result, capabilityInventory: inventory }));
  const registered = { id: "local-fail", executable: process.execPath, argv: [".ai/check.mjs"], cwd: ".", timeoutMs: 1000, env: {} };
  const checkAction = { runId, actionId: "verify", actionDigest: "registered" };
  assert.equal(evaluateRegisteredCheck(checkAction, registered, registered, verifyPolicy, true).decision, "ALLOW");
  assert.equal(evaluateRegisteredCheck(checkAction, { ...registered, argv: ["unregistered.mjs"], capabilityInventory: inventory, readOnlyHint: true }, registered, verifyPolicy, true).decision, "DENY");
  console.log("ACTUAL PASS N23: App CURRENT + actual registered Node exit 1 remains FAIL; altered registration denied, absent Reviewer/check evidence cannot COMPLETE");

  await budgetIntegration(project, inventory);
}

async function budgetIntegration(project, inventory) {
  const decode = Schema.decodeUnknownSync(WeavraControlResponse, { onExcessProperty: "error" });
  let modelCalls = 0;
  const host = await HostControlBridge.create({ cwd: project, projectTrusted: true, agentDir: join(process.env.WEAVRA_HOME, "agent"), readiness: "READY", createModels: async () => { modelCalls++; throw new Error("forbidden"); } });
  try {
    const handle = host.handle.bind(host);
    let pressure = 0;
    let headerOverflow = false;
    let canonical;
    // DETERMINISTIC canonical graph pressure. Production Host serialization and
    // App decoder are real; no oversized invalid Fact is passed off as App-valid.
    host.handle = async (...args) => {
      const response = await handle(...args);
      if (response.success && response.data.kind === "snapshot" && pressure) {
        response.data.state.snapshot.graph = { runId: "pressure", stateRevision: 0, status: "BLOCKED", nodes: Array.from({ length: pressure }, (_, i) => ({ id: `node-${i}-${"x".repeat(110)}`, kind: "verification", status: "blocked" })), edges: [] };
        response.data.state.snapshot.graphAvailable = true;
        const state = response.data.state;
        const digest = `sha256:${"0".repeat(64)}`;
        state.projectFacts = { status: "available", entries: Array.from({ length: 16 }, (_, i) => ({ id: `fact-${i}`, sourceRef: `src/fact-${i}.txt`, sourceDigest: digest, reviewedAt: 1, status: "VALID", statement: "한".repeat(500) })) };
        state.pendingApproval = { approvalId: "approval", runId: "pressure", stateRevision: 0, projectRevision: state.projectRevision, risk: "R3", operation: "delete-file", role: "Developer", step: { stepId: "implement", attempt: 1 }, path: "src/status.txt", bytes: 6, preconditionDigest: "0".repeat(64), expiresAt: Date.now() + 60_000, explanation: "Synthetic pressure, not a real grant." };
        state.preview = { previewId: "preview", previewDigest: digest, ownerId: state.ownerId, projectRevision: state.projectRevision, expiresAt: Date.now() + 60_000, goal: "Synthetic byte pressure", workflow: "STANDARD", executionMode: "EDIT", risk: "R3", allowedPaths: ["src"], checks: [{ id: "required", kind: "test", required: true }], acceptanceCriteria: [{ id: "criterion", statement: "Must remain unchanged", checkIds: ["required"], reviewRequired: true }], taskContractDigest: digest, recipe: null, configuration: { mutationMode: "compatible", verifierTrustMode: "compatible", verifierSandboxMode: "disabled", contextPackMode: "disabled", verificationRepairMode: "disabled", lspEnabled: true } };
        state.snapshot.status.run = { runId: "pressure", status: "BLOCKED", phase: "SELF_CHECK", workflow: "STANDARD", risk: "R3", executionMode: "EDIT", codeRevision: 0, currentStep: { stepId: "self-check", attempt: 1 }, activeAgentCount: 0, taskContractDigest: digest, createdAt: 1, updatedAt: 1 };
        state.snapshot.evidence = { runId: "pressure", status: "BLOCKED", codeRevision: 0, legacyAcceptanceUnknown: false, criteria: { total: 1, met: 0, notMet: 1, unknown: 0 }, currentChecks: { total: 1, passed: 0, failed: 1, unavailable: 0, skipped: 0 }, review: { result: "BLOCK", independent: true }, workers: { count: 1, reportedTokens: 0, toolCalls: 0 }, reviewerContexts: { count: 0, bytes: 0 }, failureCategory: "VERIFICATION" };
        if (headerOverflow) {
          const empty = { ...state.capabilityInventory, entries: [], omitted: state.capabilityInventory.total };
          const header = { ...response, data: { ...response.data, state: { ...state, capabilityInventory: empty } } };
          const padding = 65_537 - Buffer.byteLength(JSON.stringify(header) + "\n");
          assert.ok(padding > 0);
          state.pendingApproval.explanation += "x".repeat(padding);
          const { capabilityInventory: removed, ...withoutInventory } = state;
          assert.ok(Buffer.byteLength(JSON.stringify({ ...response, data: { ...response.data, state: withoutInventory } }) + "\n") <= 65_536);
        }
        canonical = structuredClone(response.data.state);
        delete canonical.capabilityInventory;
      }
      return response;
    };
    const lines = [];
    const connection = host.connect((line) => { lines.push(line); return true; });
    await connection.receive(JSON.stringify({ protocolVersion: 1, id: "hello", type: "control.hello" }));
    const snapshot = async () => { await connection.receive(JSON.stringify({ protocolVersion: 1, id: "pressure", type: "control.snapshot" })); return decode(JSON.parse(lines.at(-1))); };
    const original = await snapshot();
    assert.equal(original.success, true, JSON.stringify(original));
    const bytes = Buffer.byteLength(JSON.stringify(original.data.state.capabilityInventory));
    assert.ok(bytes <= 16_384);
    // Inject one change between real Host config reads, without replacing Host logic.
    const configPath = join(project, ".ai/config.yaml");
    const source = await readFile(configPath, "utf8");
    const open = fsp.open;
    let changedOnce = false;
    fsp.open = async (...args) => {
      const file = await open(...args);
      if (String(args[0]) === configPath && !changedOnce) {
        const read = file.readFile.bind(file);
        file.readFile = async (...readArgs) => {
          const value = await read(...readArgs);
          changedOnce = true;
          const changed = JSON.parse(source);
          changed.files.allowed_paths.push("other");
          await writeFile(configPath, JSON.stringify(changed));
          return value;
        };
      }
      return file;
    };
    syncBuiltinESMExports();
    try {
      const changed = await snapshot();
      assert.equal(changed.success, true, JSON.stringify(changed));
      assert.equal(changed.data.state.capabilityInventory.status, "NEEDS_REFRESH");
      assert.equal(changed.data.state.capabilityInventory.reason, "SOURCE_CHANGED");
      assert.deepEqual(changed.data.state.capabilityInventory.entries, []);
      assert.equal(changed.data.state.capabilityInventory.generation, original.data.state.capabilityInventory.generation + 1);
    } finally {
      fsp.open = open;
      syncBuiltinESMExports();
      await writeFile(configPath, source);
    }
    assert.equal(changedOnce, true);
    assert.equal((await snapshot()).data.state.capabilityInventory.status, "CURRENT");
    console.log("DETERMINISTIC source race / ACTUAL Host→App decode PASS N12: complete config change gives SOURCE_CHANGED, no mixed CURRENT or hidden retry");
    // Choose pressure from actual serialized sizes, not an OS/timing-dependent constant.
    pressure = 1;
    await snapshot();
    const nodeBytes = Buffer.byteLength(JSON.stringify(canonical.snapshot.graph.nodes[0])) + 1;
    const fixed = Buffer.byteLength(lines.at(-1)) - nodeBytes - bytes;
    pressure = Math.floor((65_536 - fixed - 2000) / nodeBytes);
    const limited = await snapshot();
    assert.equal(limited.success, true, JSON.stringify(limited));
    const inv = limited.data.state.capabilityInventory;
    assert.ok(inv.omitted > 0);
    assert.equal(inv.total, 10);
    assert.equal(inv.omitted + inv.entries.length, 10);
    assert.deepEqual(inv.entries.map((row) => row.descriptor.id), inventory.entries.slice(0, inv.entries.length).map((row) => row.descriptor.id));
    const { capabilityInventory: ignored, ...preserved } = limited.data.state;
    assert.deepEqual(preserved, canonical); // includes approval/preview/facts/evidence/workflow
    assert.ok(Buffer.byteLength(lines.at(-1)) <= 65_536);
    pressure = 1;
    headerOverflow = true;
    const tooLarge = await snapshot();
    assert.equal(tooLarge.success, false);
    assert.equal(tooLarge.error.code, "RESPONSE_TOO_LARGE");
    const firstRows = { ...inventory, entries: inventory.entries.slice(0, 3), omitted: 7 };
    const limit = Buffer.byteLength(JSON.stringify(firstRows));
    assert.deepEqual(boundCapabilityInventory(inventory, limit), firstRows);
    assert.equal(boundCapabilityInventory(inventory, limit - 1).entries.length, 2);
    assert.equal(boundCapabilityInventory(inventory, 1), null);
    assert.equal(modelCalls, 0);
    console.log("DETERMINISTIC PASS N24/N28: Host whole-row pressure → App-valid decode; exact omissions/order; all non-Broker state preserved; empty-header RESPONSE_TOO_LARGE; ModelRuntime factory calls=0");
  } finally { await host.shutdown(); }
}
