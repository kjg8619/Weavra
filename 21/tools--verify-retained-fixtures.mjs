import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-21";
const manifests = [];
for (const side of ["before", "after"])
  manifests.push(`${side}/capture/capture-manifest.json`);
for (const round of ["qa-round-01", "qa"]) {
  const receipt = JSON.parse(await fs.readFile(`${root}/${round}/scenario-receipt.json`, "utf8"));
  assert.equal(receipt.cleanup.exited, true);
  assert.ok(receipt.checks.every(check => check.status === "PASS"));
  manifests.push(`${round}/${receipt.capture.file}`);
}
const retained = new Set();
const checks = [];
for (const file of manifests) {
  const bytes = await fs.readFile(`${root}/${file}`);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.cleanup.exited, true);
  const directories = new Set([manifest.provenance.bundle]);
  for (const isolation of [manifest.isolation, ...manifest.runs.map(run => run.isolation)])
    for (const directory of Object.values(isolation)) directories.add(directory);
  for (const directory of directories) {
    assert.equal(await fs.realpath(directory), directory, `Moved fixture: ${directory}`);
    assert.ok((await fs.stat(directory)).isDirectory(), `Missing fixture: ${directory}`);
    retained.add(directory);
  }
  checks.push({
    file,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    revision: manifest.revision,
    directories: [...directories],
    processesExited: manifest.runs.every(run => run.cleanup.exited),
  });
}
const { stdout } = await promisify(execFile)("ps", ["-axo", "pid,command"]);
const ownedApps = stdout.split("\n").filter(line =>
  line.includes(`${root}/`) && /\/MacOS\/weavra-desktop(?:\s|$)/.test(line));
assert.deepEqual(ownedApps, [], "Owned evidence application still running");
const result = {
  at: new Date().toISOString(),
  status: "PASS",
  cleanup: "Close owned applications only; retain every manifest-referenced directory and bundle.",
  priorConvention: ["pr-19", "pr-20"],
  manifests: checks,
  directories: [...retained].sort(),
  ownedApps,
};
await fs.writeFile(`${root}/fixture-retention.json`, JSON.stringify(result, null, 2));
console.log(`RETENTION_PASS manifests=${checks.length} directories=${retained.size} ownedApps=0`);
