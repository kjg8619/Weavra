import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-18";
const exec = promisify(execFile), sha = b=>createHash("sha256").update(b).digest("hex");
const before = JSON.parse(await fs.readFile(`${root}/measure-before/qa-measure.json`,"utf8"));
const after = JSON.parse(await fs.readFile(`${root}/measure-after/qa-measure.json`,"utf8"));
assert.equal(before.failures.length,0); assert.equal(after.failures.length,0);
assert.equal(before.cleanup,"app.close completed"); assert.equal(after.cleanup,"app.close completed");
const pairs=[];
for (const b of before.screenshots) {
  const a=after.screenshots.find(s=>s.file===b.file); assert.ok(a,b.file);
  for(const [side,s] of [["before",b],["after",a]])
    assert.equal(sha(await fs.readFile(`${root}/measure-${side}/${s.file}`)),s.sha256);
  const {stdout}=await exec("node",[
    "/Users/kangjingoo/.bun/install/global/node_modules/omo-ai/plugin/skills/visual-qa/scripts/visual-qa.mjs",
    "image-diff",`${root}/measure-before/${b.file}`,`${root}/measure-after/${a.file}`,
  ],{maxBuffer:4<<20});
  const result=JSON.parse(stdout); assert.equal(result.dimensionsMatch,true); assert.equal(result.alphaChannelIntact,true);
  pairs.push({file:`forms/${b.file}`,supplemental:true,beforeSha256:b.sha256,afterSha256:a.sha256,result});
}
await fs.mkdir(`${root}/supplemental`,{recursive:true});
await fs.writeFile(`${root}/supplemental/pairs.json`,JSON.stringify({pairs},null,2));
console.log(`SUPPLEMENTAL_DIFF pairs=${pairs.length} EXIT=0`);
