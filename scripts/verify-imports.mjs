#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sources = [
  { name: "pi", prefix: "runtime/pi", source: "19184e387733dd3558dffff874c58a8e67748e40", imported: "89d917c312f52c028a3f7d5183ba602faef19dd1", tree: "b7bb09f505ce3f604e401ca1e70d376cdbbca9cd" },
  { name: "t3code", prefix: "app/t3code", source: "f6ff0ae0f1ae0f54aee055c64b82dd8e2b9eebdf", imported: "8fdde3c574c7ad7919810c67d1ab86de0f18ddc6", tree: "9d2146522f03104f605b421828582464e97cb610" },
];
for (const source of sources) {
  const tree = `${source.imported}:${source.prefix}`;
  const actualTree = execFileSync("git", ["rev-parse", tree], { cwd: root, encoding: "utf8" }).trim();
  assert.equal(actualTree, source.tree, `${source.name}: source tree object identity changed`);
  const actual = execFileSync("git", ["ls-tree", "-r", tree], { cwd: root, maxBuffer: 8 * 1024 * 1024 });
  const expected = readFileSync(join(root, "docs/migration", `${source.name}-source-manifest.txt`));
  assert.deepEqual(actual, expected, `${source.name}: path/mode/blob/symlink manifest changed`);
  const entries = actual.toString("utf8").trimEnd().split("\n").length;
  console.log(`PASS ${source.name}@${source.source}: ${entries} entries; import ${source.imported}; tree ${actualTree}`);
}
console.log("Import commits remain exact; later compatibility changes are separate history.");
