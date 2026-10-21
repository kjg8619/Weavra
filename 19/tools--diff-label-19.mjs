import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19";
const visual = "/Users/kangjingoo/.bun/install/global/node_modules/omo-ai/plugin/skills/visual-qa/scripts/visual-qa.mjs";
const before = JSON.parse(await fs.readFile(`${root}/fix2/before/measurements.json`, "utf8"));
const after = JSON.parse(await fs.readFile(`${root}/fix2/after/measurements.json`, "utf8"));
assert.equal(before.failures.length, 12);
assert.equal(after.failures.length, 0);
const pairs = [];
for (const image of before.screenshots) {
  const head = after.screenshots.find(row => row.file === image.file);
  assert.ok(head);
  const { stdout } = await exec("node", [
    visual, "image-diff",
    `${root}/fix2/before/${image.file}`, `${root}/fix2/after/${image.file}`,
  ], { maxBuffer: 16 << 20 });
  const result = JSON.parse(stdout);
  assert.ok(result.dimensionsMatch);
  assert.ok(result.alphaChannelIntact);
  pairs.push({ file: image.file, beforeSha256: image.sha256, afterSha256: head.sha256, result });
}
await fs.writeFile(`${root}/fix2/pairs.json`, JSON.stringify({ pairs }, null, 2));
console.log(`VARIANT_DIFF pairs=${pairs.length} failures=0`);
