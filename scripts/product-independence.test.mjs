#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, globSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const baseline = "8447f9843e0b2d468554e0062abbe6b98a81ba13";
const launcher = join(root, "runtime/pi/packages/company-runtime/bin/weavra");
const forbiddenGuidance = /\bpi update\b|Pi installer|earendil-works\/pi releases?|T3 Code updater|pingdotgg[^\n]*release/i;

// Intercept before any CLI module loads. Every attempted connection is recorded even
// if production catches the error. No real provider or product-vendor request occurs.
const networkPreload = `
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';
const blocked = (transport, destination, method) => {
  const value = String(destination ?? 'unknown');
  let safe = value;
  try { const u = new URL(value); safe = u.origin + u.pathname; } catch {}
  const kind = /pi\\.dev|earendil-works|pingdotgg|t3\\.codes|posthog|u\\.expo\\.dev/.test(safe) ? 'product-vendor' : 'provider-or-third-party';
  appendFileSync(process.env.WEAVRA_NETWORK_LOG, JSON.stringify({ transport, destination: safe, kind, method }) + '\\n');
  throw new Error('Independence test blocked network: ' + safe);
};
globalThis.fetch = async (input) => blocked('fetch', typeof input === 'string' || input instanceof URL ? input : input.url);
for (const [name, module] of [['http', http], ['https', https]]) {
  for (const method of ['request', 'get']) module[method] = (input, options) => blocked(name + '.' + method, typeof input === 'object' && !(input instanceof URL) ? input.hostname ?? input.host : input, method === 'get' ? 'GET' : options?.method ?? input?.method ?? 'GET');
}
const originalConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const input = args[0];
  // Local IPC is not an external destination. TCP remains blocked, including
  // loopback: this smoke sends no model prompt and needs no provider endpoint.
  const options = Array.isArray(input) ? input[0] : input;
  if (typeof options === 'string' && !/^\\d+$/.test(options)) return originalConnect.apply(this, args);
  if (options && typeof options === 'object' && options.path) return originalConnect.apply(this, args);
  return blocked('tcp', typeof options === 'object' ? options.host ?? options.hostname ?? 'localhost' : args[1] ?? 'localhost');
};
tls.connect = (input) => blocked('tls', typeof input === 'object' ? input.host ?? input.servername : input);
syncBuiltinESMExports();
`;

function fixture() {
  const temporary = realpathSync(mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "wi-")));
  const home = join(temporary, "home");
  mkdirSync(home, { mode: 0o700 });
  const log = join(temporary, "network.jsonl");
  writeFileSync(log, "");
  const preload = join(temporary, "network.mjs");
  writeFileSync(preload, networkPreload);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: temporary,
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    NO_COLOR: "1",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    AWS_EC2_METADATA_DISABLED: "true",
    PI_NO_LOCAL_LLM: "1",
    WEAVRA_NETWORK_LOG: log,
    NODE_OPTIONS: `--import=${pathToFileURL(preload).href}`,
  };
  const calls = () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { temporary, home, env, calls, close: () => rmSync(temporary, { recursive: true, force: true }) };
}

function cli(args, env) {
  const result = spawnSync(launcher, args, { cwd: root, env, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
  assert.ifError(result.error);
  const text = result.stdout + result.stderr;
  assert.doesNotMatch(text, forbiddenGuidance, `Forbidden guidance: weavra ${args.join(" ")}`);
  return { ...result, text };
}

async function rpcState(env) {
  const child = spawn(launcher, ["--mode", "rpc", "--no-session", "--no-extensions", "--no-skills", "--no-prompt-templates"], {
    cwd: root, env, stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let buffer = "";
  const result = new Promise((resolveState, reject) => {
    child.on("error", reject);
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      while (buffer.includes("\n")) {
        const end = buffer.indexOf("\n");
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let value;
        try { value = JSON.parse(line); } catch { continue; }
        if (value.id === "independence-state") resolveState(value);
      }
    });
    child.on("exit", (code, signal) => reject(new Error(`RPC exited before response: ${code ?? signal}\n${stderr}`)));
  });
  const closed = new Promise((resolveExit) => child.on("close", (code, signal) => resolveExit({ code, signal })));
  const timer = setTimeout(() => child.kill("SIGTERM"), 30_000);
  try {
    child.stdin.write(`${JSON.stringify({ id: "independence-state", type: "get_state" })}\n`);
    const state = await result;
    assert.equal(state.success, true, JSON.stringify(state));
    assert.equal(state.data.isStreaming, false);
    child.stdin.end();
    const exit = await closed;
    assert.equal(exit.code, 0, stderr);
    assert.doesNotMatch(stderr, forbiddenGuidance);
    return state;
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await closed;
  }
}

test("licenses, notice and immutable migration records retain original attribution", () => {
  for (const file of ["runtime/pi/LICENSE", "app/t3code/LICENSE", "NOTICE.md", "docs/migration/SPLIT_REPOSITORY_BASELINE.md", "docs/migration/pi-source-manifest.txt", "docs/migration/t3code-source-manifest.txt"]) {
    const original = execFileSync("git", ["show", `${baseline}:${file}`], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
    assert.deepEqual(readFileSync(join(root, file)), original, `${file}: attribution or historical baseline changed`);
  }
});

test("actual Weavra CLI owns help, version, home and source update without inherited network", { timeout: 120_000 }, async () => {
  const f = fixture();
  try {
    const legacy = join(f.home, ".pi", "agent");
    mkdirSync(legacy, { recursive: true, mode: 0o700 });
    const legacyAuth = join(legacy, "auth.json");
    const sentinel = "{ deliberately invalid legacy credentials: never load or modify }\n";
    writeFileSync(legacyAuth, sentinel, { mode: 0o600 });
    const isolatedEnv = { ...f.env, PI_CODING_AGENT_DIR: legacy, PI_CODING_AGENT_SESSION_DIR: join(legacy, "sessions") };
    const setup = cli(["setup"], isolatedEnv);
    assert.equal(setup.status, 0, setup.text);
    assert.ok(existsSync(join(f.home, ".weavra", "agent")));
    assert.equal(readFileSync(legacyAuth, "utf8"), sentinel);
    const help = cli(["--help"], isolatedEnv);
    assert.equal(help.status, 0, help.text);
    assert.match(help.stdout, /weavra/i);
    assert.doesNotMatch(help.stdout, /Usage:\s*\n\s*pi\b|default: ~\/\.pi\/agent|pi\.dev\/session/);
    const version = cli(["--version"], isolatedEnv);
    assert.equal(version.status, 0, version.text);
    assert.equal(version.stdout.trim(), "Weavra development");
    const doctor = cli(["doctor"], isolatedEnv);
    assert.equal(doctor.status, 0, doctor.text);
    assert.match(doctor.stdout, /Weavra Doctor/);
    const update = cli(["update"], { ...isolatedEnv, PI_TELEMETRY: "1", PI_MANAGED_INSTALL_ROOT: join(f.temporary, "legacy-installer"), PI_INSTALLER_API_BASE: "https://pi.dev/api/installer" });
    assert.equal(update.status, 1, update.text);
    assert.match(update.text, /Weavra[\s\S]*(?:development|source)/i);
    assert.match(update.text, /self[- ]update/i);
    const state = await rpcState(isolatedEnv);
    assert.equal(state.command, "get_state");
    assert.equal(readFileSync(legacyAuth, "utf8"), sentinel);
    assert.deepEqual(f.calls(), [], "Startup/update attempted an external connection; provider requests are separately classified and no inference was requested");
    console.log("CLI evidence: Weavra help; Weavra development; local source-update guidance; setup/doctor; real RPC get_state; intercepted network attempts=0; paid inference=0");
  } finally {
    f.close();
  }
});

test("inherited package coordinates cannot publish even when lifecycle scripts are bypassed", { timeout: 120_000 }, () => {
  const f = fixture();
  try {
    const runtimeRoot = join(root, "runtime/pi");
    const { workspaces } = JSON.parse(readFileSync(join(runtimeRoot, "package.json"), "utf8"));
    const manifests = [...new Set(workspaces.flatMap((pattern) => globSync(pattern, { cwd: runtimeRoot })))]
      .map((directory) => join(runtimeRoot, directory, "package.json"))
      .filter(existsSync);
    manifests.push(join(root, "app/t3code/apps/server/package.json"));
    const npmrc = join(f.temporary, "npmrc");
    writeFileSync(npmrc, "//registry.example.invalid/:_authToken=owned-test-token\n", { mode: 0o600 });
    const globalNpmrc = join(f.temporary, "global-npmrc");
    writeFileSync(globalNpmrc, "");
    const env = {
      ...f.env,
      NPM_CONFIG_USERCONFIG: npmrc,
      NPM_CONFIG_GLOBALCONFIG: globalNpmrc,
      NPM_CONFIG_CACHE: join(f.temporary, "npm-cache"),
      NPM_CONFIG_UPDATE_NOTIFIER: "false",
      NPM_CONFIG_FETCH_RETRIES: "0",
      NPM_CONFIG_FETCH_TIMEOUT: "1000",
    };
    for (const [index, manifest] of manifests.entries()) {
      // Copy only metadata: a failed guard cannot clean/build the real workspace.
      const directory = join(f.temporary, `package-${index}`);
      mkdirSync(directory);
      writeFileSync(join(directory, "package.json"), readFileSync(manifest));
      const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", [
        "publish", "--ignore-scripts", "--registry=https://registry.example.invalid",
      ], {
        cwd: directory, env, encoding: "utf8", timeout: 15_000,
        shell: process.platform === "win32",
      });
      assert.notEqual(result.status, 0, manifest);
      assert.match(result.stderr ?? "", /\bEPRIVATE\b/, `${manifest}\n${result.stderr}`);
    }
    // npm itself probes registry metadata before EPRIVATE when its lifecycle guard
    // is explicitly bypassed. The preload blocks these probes before connection;
    // neither a publication request nor another destination is acceptable.
    const attempts = f.calls();
    assert.ok(attempts.every((call) => call.method === "GET" && call.destination === "registry.example.invalid"), JSON.stringify(attempts));
    console.log(`Publication evidence: ${manifests.length} package coordinates refused with EPRIVATE; npm metadata probes intercepted=${attempts.length}; publication requests=0`);
  } finally {
    f.close();
  }
});

test("actual RPC profiling honors isolated and explicitly selected agent homes", { timeout: 120_000 }, () => {
  const f = fixture();
  try {
    const ambientExtensions = join(f.home, ".weavra", "agent", "extensions");
    const selected = join(f.temporary, "selected-agent");
    const selectedExtensions = join(selected, "extensions");
    mkdirSync(ambientExtensions, { recursive: true });
    mkdirSync(selectedExtensions, { recursive: true });
    const ambientMarker = join(f.temporary, "ambient-loaded");
    const selectedMarker = join(f.temporary, "selected-loaded");
    for (const [directory, marker] of [[ambientExtensions, ambientMarker], [selectedExtensions, selectedMarker]]) {
      writeFileSync(join(directory, "profile-probe.ts"),
        `import { writeFileSync } from "node:fs";\nexport default function () { writeFileSync(${JSON.stringify(marker)}, "loaded"); }\n`);
    }
    const profile = join(root, "runtime/pi/scripts/profile-coding-agent-node.mjs");
    const args = [profile, "--mode", "rpc", "--runtime", "node", "--skip-build", "--runs", "1",
      "--profile-dir", join(f.temporary, "profiles")];
    const isolated = spawnSync(process.execPath, [...args, "--isolated-agent-dir"], {
      cwd: join(root, "runtime/pi"), env: f.env, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(isolated.status, 0, isolated.stderr);
    assert.equal(existsSync(ambientMarker), false, "Isolated profiling loaded the ambient profile");
    const explicit = spawnSync(process.execPath, [...args, "--agent-dir", selected], {
      cwd: join(root, "runtime/pi"), env: f.env, encoding: "utf8", timeout: 30_000,
    });
    assert.equal(explicit.status, 0, explicit.stderr);
    assert.equal(existsSync(selectedMarker), true, "Explicit profiling did not load the selected profile");
    assert.equal(existsSync(ambientMarker), false, "Explicit profiling loaded the ambient profile");
    assert.deepEqual(f.calls(), []);
    console.log("Profiler evidence: real RPC get_state succeeds in isolated and selected homes; ambient extension never loaded; network attempts=0");
  } finally {
    f.close();
  }
});
