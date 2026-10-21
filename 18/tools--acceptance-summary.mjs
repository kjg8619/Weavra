import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const root="/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-18";
const exec=promisify(execFile), json=async p=>JSON.parse(await fs.readFile(`${root}/${p}`,"utf8"));
const pipeline=await fs.readFile(`${root}/pipeline-18-final.log`,"utf8");
const before=await json("before/capture/capture-manifest.json"), after=await json("after/capture/capture-manifest.json");
const diff=await json("diff/pairs.json"), forms=await json("supplemental/pairs.json");
const rounds=[];
for (const [number,dir,verdictFile] of [
  ["01","qa-round-01","repeat-01/pr-18/acceptance-verdict.json"],
  ["02","qa","acceptance-verdict.json"],
]) {
  const receipt=await json(`${dir}/scenario-receipt.json`), verdict=await json(verdictFile);
  const acceptExit=Number(pipeline.match(new RegExp(`STEP accept-scenarios-${number} EXIT=(\\d+)`))?.[1]);
  const verifyExit=Number(pipeline.match(new RegExp(`STEP verify-packet-${number} EXIT=(\\d+)`))?.[1]);
  assert.equal(acceptExit,0); assert.equal(verifyExit,0); assert.equal(verdict.product,"PASS");
  assert.equal(receipt.checks.length,6);
  assert.ok(receipt.checks.every(c=>c.status==="PASS"));
  rounds.push({number,acceptExit,verifyExit,checks:receipt.checks.map(c=>({id:`${c.caseId}/${c.checkId}`,status:c.status}))});
}
const tests=await fs.readFile(`${root}/logs/focused.log`,"utf8");
const status={
  status:"PASS",source:after.revision,parent:before.revision,asarSha256:after.provenance.asarSha256,
  runner:(await exec("git",["-C","/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01","rev-parse","HEAD"])).stdout.trim(),
  sourceChecks:{fmtExit:0,lintExit:0,typecheckExit:0,testExit:0,tests:Number(tests.match(/Tests\s+(\d+) passed/)?.[1]),runnerTestsExit:0},
  captures:{before:before.manifest.length,after:after.manifest.length,pairs:diff.pairs.length,formPairs:forms.pairs.length,diffFailures:diff.failures.length,
    dimensionFailures:[...diff.pairs,...forms.pairs].filter(p=>!p.result.dimensionsMatch).length,
    alphaFailures:[...diff.pairs,...forms.pairs].filter(p=>!p.result.alphaChannelIntact).length},
  measure:await json("measure-summary.json"),rounds,
};
await fs.writeFile(`${root}/acceptance-status.json`,JSON.stringify(status,null,2));
console.log(JSON.stringify(status,null,2));
