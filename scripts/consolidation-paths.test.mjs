import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
test("nested Pi source archive retains a standalone package root, not the containing product", () => {
  const temporary = mkdtempSync(join(tmpdir(), "weavra-archive-test-"));
  try {
    const archive = join(temporary, "source.tar.gz");
    execFileSync("bash", ["scripts/create-source-archive.sh", "--version", "0.85.1", "--ref", "HEAD", "--out", archive], {
      cwd: join(root, "runtime/pi"), stdio: "inherit",
    });
    const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }).trim().split("\n");
    const packageEntry = entries.find((entry) => /^[^/]+\/package\.json$/.test(entry));
    assert.ok(packageEntry, "archive must expose the standalone Pi package root");
    const prefix = packageEntry.slice(0, -"package.json".length);
    assert.ok(entries.includes(`${prefix}packages/company-runtime/bin/weavra`));
    assert.ok(!entries.some((entry) => entry.startsWith(`${prefix}app/`) || entry.startsWith(`${prefix}runtime/`)));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
