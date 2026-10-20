import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const root="/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-17/supplemental";
const exec=promisify(execFile), sha=b=>createHash("sha256").update(b).digest("hex");
const before=JSON.parse(await fs.readFile(`${root}/before/manifest.json`,"utf8"));
const after=JSON.parse(await fs.readFile(`${root}/after/manifest.json`,"utf8"));
assert.equal(before.failures.length,0);assert.equal(after.failures.length,0);
assert.equal(before.closed,true);assert.equal(after.closed,true);
assert.equal(before.screenshots.length,16);assert.equal(after.screenshots.length,18);
assert.equal(before.revision,"878a9162cd8ce64b39c36531d772cdbd3885b658");
assert.equal(after.revision,"c4e04c655ec393a0641dbafbfa204d9580b992bb");
const pairs=[];
for(const b of before.screenshots) {
  const a=after.screenshots.find(s=>s.file===b.file);assert.ok(a);
  for(const [side,s] of [["before",b],["after",a]])
    assert.equal(sha(await fs.readFile(`${root}/${side}/${s.file}`)),s.sha256);
  const {stdout}=await exec("node",[
    "/Users/kangjingoo/.bun/install/global/node_modules/omo-ai/plugin/skills/visual-qa/scripts/visual-qa.mjs",
    "image-diff",`${root}/before/${b.file}`,`${root}/after/${a.file}`
  ],{maxBuffer:4<<20});
  const result=JSON.parse(stdout);assert.equal(result.dimensionsMatch,true);assert.equal(result.alphaChannelIntact,true);
  pairs.push({file:`archives/${b.file}`,supplemental:true,beforeSha256:b.sha256,afterSha256:a.sha256,result});
}
await fs.writeFile(`${root}/pairs.json`,JSON.stringify({pairs},null,2));
console.log(`SUPPLEMENTAL_DIFF pairs=${pairs.length} EXIT=0`);
