import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import * as NodeServices from "../app/t3code/apps/server/node_modules/@effect/platform-node/dist/NodeServices.js";
import * as Effect from "../app/t3code/apps/server/node_modules/effect/dist/Effect.js";
import * as Schema from "../app/t3code/apps/server/node_modules/effect/dist/Schema.js";
import { openControlTransport } from "../app/t3code/apps/server/src/weavra/ControlTransport.ts";
import { WeavraControlResponse, WEAVRA_CONTROL_COMMANDS } from "../app/t3code/packages/contracts/src/weavraControl.ts";
import { makeCapabilityInventoryTracker } from "../app/t3code/packages/client-runtime/src/state/capabilityInventory.ts";
import { ACTION_TOOL_SCHEMAS } from "../runtime/pi/packages/company-runtime/src/action-tool-schemas.ts";
import { capabilityDigest } from "../runtime/pi/packages/company-runtime/src/capability-catalog.ts";
import { runAppIntegration } from "./capability-app-integration.mjs";
import { runAuthorityIntegration } from "./capability-authority-integration.mjs";
import { runCompatibility } from "./capability-compatibility.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const executable = process.env.T3_WEAVRA_EXECUTABLE;
assert.equal(executable, join(root, "runtime/pi/packages/company-runtime/bin/weavra"));
const exec = promisify(execFile);
const project = join(process.env.HOME, "project");
await mkdir(join(project, "src"), { recursive: true });
await mkdir(join(project, ".ai"), { mode: 0o700 });
await writeFile(join(project, "src/status.txt"), "Ready\n");
await writeFile(join(project, ".gitignore"), ".ai/\n");
const git = (...args) => exec("git", ["-c", "user.name=Broker integration", "-c", "user.email=broker@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: project });
await git("init", "-q");
await git("add", ".");
await git("commit", "-qm", "owned capability fixture");
const configPath = join(project, ".ai/config.yaml");
const sentinels = ["BROKER_PROVIDER_SENTINEL", "BROKER_MODEL_SENTINEL", "BROKER_ARG_SENTINEL", "BROKER_TOKEN_SENTINEL", "BROKER_ENDPOINT_SENTINEL", "BROKER_DOCUMENT_SENTINEL"];
const lspExecutable = join(process.env.HOME, "broker-lsp");
await writeFile(lspExecutable, "#!/usr/bin/env node\nthrow new Error('LSP must not start during discovery');\n", { mode: 0o700 });
const config = {
  schemaVersion: 1,
  models: { profiles: { coding: { provider: sentinels[0], model: sentinels[1] }, reasoning: { provider: sentinels[0], model: sentinels[1] } } },
  files: { allowed_paths: ["src", "package.json"] },
  code_intelligence: { lsp: { enabled: true, servers: [{ id: "local", executable: lspExecutable, args: [sentinels[2]], extensions: [".ts"] }] } },
};
const ledger = join(process.env.HOME, "broker-ledger.jsonl");
const wire = join(process.env.HOME, "broker-wire.jsonl");
const stderr = join(process.env.HOME, "broker-stderr.log");
for (const file of [ledger, wire, stderr]) await writeFile(file, "");
const env = {
  ...Object.fromEntries(["PATH", "HOME", "WEAVRA_HOME", "TMPDIR", "LANG", "LC_ALL"].map((key) => [key, process.env[key]])),
  NODE_OPTIONS: `--import=${pathToFileURL(join(root, "scripts/capability-observation-guard.mjs"))}`,
  WEAVRA_BROKER_LEDGER: ledger, WEAVRA_BROKER_WIRE: wire, WEAVRA_BROKER_STDERR: stderr,
  OPENAI_API_KEY: sentinels[3],
};
// Positive controls run separately. They must fail before any real network/process/file read.
for (const [kind, source] of [
  ["network", "await fetch('https://example.invalid')"],
  ["child-process", "(await import('node:child_process')).spawnSync('must-not-execute')"],
  ["credential-or-resource-probe", "(await import('node:fs')).readFileSync('/missing/auth.json')"],
  ["network", "await (await import('node:dns/promises')).resolve4('example.invalid')"],
  ["credential-or-resource-probe", "await import('./skills/never-load.mjs')"],
]) {
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", source], { env: { ...env, WEAVRA_BROKER_GUARD_PROBE: "1" }, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`BROKER_OBSERVATION_FORBIDDEN_${kind}`));
}
const controls = (await readFile(ledger, "utf8")).trim().split("\n").map(JSON.parse);
assert.deepEqual(controls.filter((row) => row.type === "forbidden").map((row) => row.kind), ["network", "child-process", "credential-or-resource-probe", "network", "credential-or-resource-probe"]);
for (const file of [ledger, wire, stderr]) await writeFile(file, "");

const decode = Schema.decodeUnknownSync(WeavraControlResponse, { onExcessProperty: "error" });
const observation = (state, capabilities) => ({ status: "CONNECTED", stale: false, state, capabilities, observedAt: Date.now(), errorCode: null });
let actual;
await Effect.runPromise(Effect.gen(function* () {
  const transport = yield* openControlTransport(executable, project, env);
  const hello = yield* transport.exchange({ protocolVersion: 1, id: randomUUID(), type: "control.hello" });
  assert.equal(hello.success, true);
  const capabilities = hello.data.capabilities;
  assert.equal(capabilities.readiness, "NOT_SETUP");
  assert.deepEqual(capabilities.commands, [...WEAVRA_CONTROL_COMMANDS]);
  assert.equal(capabilities.commands.length, 11);
  const snapshot = () => transport.exchange({ protocolVersion: 1, id: randomUUID(), type: "control.snapshot" }).pipe(Effect.map((response) => {
    assert.equal(response.success, true, JSON.stringify(response));
    assert.equal(response.data.kind, "snapshot");
    decode(response);
    return response.data.state;
  }));
  const missing = yield* snapshot();
  assert.equal(missing.capabilityInventory.status, "UNKNOWN");
  assert.equal(missing.capabilityInventory.reason, "CONFIG_UNAVAILABLE");
  assert.deepEqual(yield* Effect.promise(() => readdir(join(project, ".ai"))), []);
  yield* Effect.promise(() => writeFile(configPath, JSON.stringify(config)));
  const first = yield* snapshot();
  const tracker = makeCapabilityInventoryTracker();
  assert.equal(tracker.receive(observation(first, capabilities), performance.now()).status, "NEEDS_REFRESH");
  const second = yield* snapshot();
  assert.equal(tracker.receive(observation(second, capabilities), performance.now()).status, "CURRENT");
  const inventory = second.capabilityInventory;
  assert.equal(inventory.ownerId, capabilities.ownerId);
  assert.equal(inventory.ownerId, second.ownerId);
  assert.equal(inventory.projectRevision, second.projectRevision);
  assert.equal(inventory.brokerEpoch, first.capabilityInventory.brokerEpoch);
  assert.equal(inventory.generation, first.capabilityInventory.generation + 1);
  assert.equal(inventory.coverage, "RUNTIME_ACTION_TOOLS");
  assert.equal(inventory.total, 10);
  assert.equal(inventory.omitted, 0);
  assert.deepEqual(inventory.entries.map((row) => row.descriptor.id), Object.keys(ACTION_TOOL_SCHEMAS).map((name) => `weavra.worker.${name}`).sort());
  for (const { descriptor, requirements, observation: row } of inventory.entries) {
    const { fingerprint, ...plain } = descriptor;
    assert.equal(descriptor.schemaDigest, capabilityDigest(ACTION_TOOL_SCHEMAS[descriptor.name]));
    assert.equal(fingerprint, capabilityDigest({ descriptor: plain, requirements }));
    assert.equal(row.observedAt, inventory.observedAt);
    assert.equal(row.availability, descriptor.name.startsWith("runtime_lsp_") ? "UNKNOWN" : "AVAILABLE");
    assert.equal(row.reason, descriptor.name.startsWith("runtime_lsp_") ? "LSP_NOT_OBSERVED" : "DEFINITION_PRESENT");
  }
  assert.equal(second.snapshot.status.run, null);
  assert.equal(second.snapshot.evidence, null);
  assert.equal(second.pendingApproval, null);
  assert.equal(second.snapshot.configuration.registeredCheckCount, 0);
  assert.ok(Buffer.byteLength(JSON.stringify(inventory)) <= 16_384);
  actual = { state: second, capabilities, observation: observation(second, capabilities) };
  const foreignApproval = yield* transport.exchange({
    protocolVersion: 1, id: "foreign-owner:1", ownerId: "foreign-owner",
    expectedProjectRevision: second.projectRevision, type: "approval.resolve",
    runId: "foreign-run", expectedStateRevision: 0, approvalId: "copied-approval", decision: "approve",
  });
  assert.equal(foreignApproval.success, false);
  assert.equal(foreignApproval.error.code, "OWNER_CHANGED");
  assert.equal(yield* Effect.promise(() => readFile(join(project, "src/status.txt"), "utf8")), "Ready\n");
  yield* Effect.promise(() => unlink(lspExecutable));
  const disappeared = yield* snapshot();
  assert.equal(disappeared.capabilityInventory.generation, inventory.generation + 1);
  assert.deepEqual(disappeared.capabilityInventory.entries.map((row) => row.descriptor), inventory.entries.map((row) => row.descriptor));
  assert.ok(disappeared.capabilityInventory.entries.filter((row) => row.descriptor.name.startsWith("runtime_lsp_")).every((row) => row.observation.availability === "UNKNOWN" && row.observation.reason === "LSP_NOT_OBSERVED"));
  yield* Effect.promise(() => writeFile(configPath, "BROKER_TOKEN_SENTINEL: ["));
  const invalid = yield* snapshot();
  actual.unavailable = invalid.capabilityInventory;
  assert.equal(invalid.capabilityInventory.generation, disappeared.capabilityInventory.generation + 1);
  assert.equal(invalid.capabilityInventory.status, "UNKNOWN");
  assert.equal(invalid.capabilityInventory.reason, "CONFIG_UNAVAILABLE");
  assert.deepEqual(invalid.capabilityInventory.entries, []);
  assert.equal(tracker.receive(observation(invalid, capabilities), performance.now()).status, "UNKNOWN");
  yield* Effect.promise(() => unlink(configPath));
  assert.equal((yield* snapshot()).capabilityInventory.status, "UNKNOWN");
  assert.deepEqual(yield* Effect.promise(() => readdir(join(project, ".ai"))), []);
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.timeout("30 seconds")));
console.log("ACTUAL PASS N05/N06/N12/N13/N25/N28: production stdio → strict App transport; 10 definitions, bound scope, generation, digest, config failures, no setup");

// Explicit setup is not discovery. Startup doctor may inspect private configuration;
// only snapshot windows below are counted as Broker-triggered activation.
await exec(executable, ["setup"], { cwd: project });
await writeFile(configPath, JSON.stringify(config));
await writeFile(join(process.env.WEAVRA_HOME, "agent/auth.json"), JSON.stringify({ fixture: { type: "api_key", key: sentinels[3] } }), { mode: 0o600 });
await writeFile(join(process.env.WEAVRA_HOME, "agent/models.json"), JSON.stringify({ providers: { fixture: { baseUrl: `https://${sentinels[4]}.invalid`, apiKey: sentinels[3], models: [] } } }), { mode: 0o600 });
await writeFile(join(project, "src/private.txt"), sentinels[5]);
await git("add", "src/private.txt");
await git("commit", "-qm", "bounded non-secret leakage sentinel");
const app = await runAppIntegration({ executable, project, env, configPath, config, actual, sentinels });
await runCompatibility({ env });
await runAuthorityIntegration({ ...actual, project, config });

const events = (await readFile(ledger, "utf8")).trim().split("\n").map(JSON.parse);
assert.deepEqual(events.filter((row) => row.type === "forbidden"), []);
assert.equal(events.filter((row) => row.type === "window-start").length, events.filter((row) => row.type === "window-end").length);
assert.ok(events.some((row) => row.type === "window-start"));
const payloads = await readFile(wire, "utf8");
for (const line of payloads.trim().split("\n")) {
  assert.ok(Buffer.byteLength(line + "\n") <= 65_536);
  const response = decode(JSON.parse(line));
  if (response.success && response.data.kind === "snapshot") {
    const text = JSON.stringify(response.data.state.capabilityInventory);
    for (const sentinel of sentinels) assert.equal(text.includes(sentinel), false);
  }
}
for (const text of [payloads, await readFile(stderr, "utf8"), JSON.stringify(actual), JSON.stringify(app)]) {
  for (const sentinel of sentinels) assert.equal(text.includes(sentinel), false, "private sentinel escaped");
}
assert.ok(events.filter((row) => row.type === "request").every((row) => ["control.hello", "control.snapshot", "facts.prepare", "approval.resolve"].includes(row.command)));
console.log(`ACTUAL PASS N14/N20/N25/N28: ${events.filter((row) => row.type === "window-start").length} snapshot windows plus observation idle intervals; intercepted Node network/child-process/credential-resource API attempts=0; positive controls=5; no paid inference`);
console.log("CAPABILITY CROSS-BOUNDARY PASS (actual Runtime/App/filesystem; injected adversarial states separately labelled)");
