// Test-only preload. Startup/doctor and explicit execution are outside the measured
// interval: arm on control.snapshot stdin, including idle time after its response.
// Only a subsequent explicit non-snapshot command suspends observation guards.
import fs from "node:fs";
import fsp from "node:fs/promises";
import cp from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dns from "node:dns";
import dnsPromises from "node:dns/promises";
import { registerHooks, syncBuiltinESMExports } from "node:module";

const append = fs.appendFileSync.bind(fs);
const record = (event) => append(process.env.WEAVRA_BROKER_LEDGER, JSON.stringify({ pid: process.pid, ...event }) + "\n");
let active = process.env.WEAVRA_BROKER_GUARD_PROBE === "1";
let input = "";
let output = "";
const emit = process.stdin.emit;
process.stdin.emit = function (event, ...args) {
  if (event === "data") {
    input += args[0].toString();
    let end;
    while ((end = input.indexOf("\n")) >= 0) {
      const line = input.slice(0, end);
      input = input.slice(end + 1);
      try {
        const request = JSON.parse(line);
        record({ type: "request", command: request.type });
        active = request.type === "control.snapshot";
        if (active) record({ type: "window-start" });
      } catch { /* Invalid requests remain the production decoder's responsibility. */ }
    }
  }
  return emit.call(this, event, ...args);
};
const stdout = process.stdout.write.bind(process.stdout);
process.stdout.write = function (chunk, ...args) {
  append(process.env.WEAVRA_BROKER_WIRE, chunk);
  output += chunk.toString();
  let end;
  while ((end = output.indexOf("\n")) >= 0) {
    const line = output.slice(0, end);
    output = output.slice(end + 1);
    try {
      const response = JSON.parse(line);
      if (response.command === "control.snapshot") record({ type: "window-end" });
    } catch { /* Captured wire is checked by the harness. */ }
  }
  return stdout(chunk, ...args);
};
const stderr = process.stderr.write.bind(process.stderr);
process.stderr.write = function (chunk, ...args) {
  append(process.env.WEAVRA_BROKER_STDERR, chunk);
  return stderr(chunk, ...args);
};
function blocked(kind) {
  record({ type: "forbidden", kind });
  throw new Error(`BROKER_OBSERVATION_FORBIDDEN_${kind}`);
}
function wrap(object, name, kind, predicate = () => true) {
  const original = object[name];
  if (typeof original !== "function") return;
  object[name] = function (...args) {
    if (active && predicate(args)) return blocked(kind);
    return Reflect.apply(original, this, args);
  };
}
wrap(globalThis, "fetch", "network");
for (const module of [http, https]) for (const method of ["request", "get"]) wrap(module, method, "network");
wrap(net.Socket.prototype, "connect", "network");
wrap(tls, "connect", "network");
for (const module of [dns, dnsPromises, dns.Resolver.prototype, dnsPromises.Resolver.prototype]) {
  for (const method of ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "reverse"]) wrap(module, method, "network");
}
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) wrap(cp, method, "child-process");
const sensitive = ([path]) => String(path).startsWith(process.env.WEAVRA_HOME + "/") || /(?:auth\.json|credentials|models\.json|settings\.json|\.env(?:\.|\/|$)|\.aws(?:\/|$)|\.ssh(?:\/|$)|(?:skills|extensions|plugins)(?:\/|$))/i.test(String(path));
for (const method of ["readFile", "open", "openAsBlob", "access", "stat", "lstat", "readdir", "opendir", "readlink", "realpath", "watch", "watchFile", "glob"]) {
  wrap(fs, method, "credential-or-resource-probe", sensitive);
  wrap(fs, `${method}Sync`, "credential-or-resource-probe", sensitive);
  wrap(fsp, method, "credential-or-resource-probe", sensitive);
}
wrap(fs, "existsSync", "credential-or-resource-probe", sensitive);
wrap(fs, "createReadStream", "credential-or-resource-probe", sensitive);
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (active && sensitive([specifier])) blocked("credential-or-resource-probe");
    const resolved = nextResolve(specifier, context);
    if (active && sensitive([resolved.url])) blocked("credential-or-resource-probe");
    return resolved;
  },
});
syncBuiltinESMExports();
record({ type: "guard-ready" });
