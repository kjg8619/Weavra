import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
for (const [name, args] of [
  ["release.mjs", ["patch"]],
  ["publish.mjs", []],
  ["publish.mjs", ["--dry-run"]],
  ["publish-release-announcement.mjs", ["--version", "0.85.1"]],
  ["publish-model-catalog.mjs", ["--input", "catalog", "--bucket", "legacy", "--endpoint", "https://upstream.invalid"]],
  ["release-notes.mjs", ["fix-github-releases"]],
]) {
  test(`${name} ${args.join(" ")} refuses before network or checkout mutation`, () => {
    const root = mkdtempSync(join(tmpdir(), "weavra-publication-"));
    try {
      const home = join(root, "home");
      mkdirSync(home);
      const sentinel = join(root, "package.json");
      writeFileSync(sentinel, '{"name":"fixture","version":"1.2.3"}\n');
      const guard = join(root, "no-network.mjs");
      writeFileSync(guard, `import { syncBuiltinESMExports } from "node:module";
import childProcess from "node:child_process";
import http from "node:http";
import https from "node:https";
import net from "node:net";
const deny = () => { process.stderr.write("FORBIDDEN_EXTERNAL_OPERATION\\n"); process.exit(97); };
for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[key] = deny;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = deny;
globalThis.fetch = deny;
syncBuiltinESMExports();
`);
      const before = readFileSync(sentinel, "utf8");
      const result = spawnSync(process.execPath, ["--import", guard, resolve(scriptsDir, name), ...args], {
        cwd: root,
        encoding: "utf8",
        timeout: 10000,
        env: { ...process.env, HOME: home, USERPROFILE: home },
      });
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /unavailable/i);
      assert.doesNotMatch(result.stderr, /FORBIDDEN_EXTERNAL_OPERATION/);
      assert.equal(readFileSync(sentinel, "utf8"), before);
      assert.deepEqual(readdirSync(home), []);
      assert.deepEqual(readdirSync(root).sort(), ["home", "no-network.mjs", "package.json"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}
