import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
const exec=promisify(execFile);
const root="/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19";
const visual="/Users/kangjingoo/.bun/install/global/node_modules/omo-ai/plugin/skills/visual-qa/scripts/visual-qa.mjs";
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const before=JSON.parse(await fs.readFile(`${root}/measure-before/measurements.json`,"utf8"));
const after=JSON.parse(await fs.readFile(`${root}/measure-after/measurements.json`,"utf8"));
const afterNames=new Set(after.screenshots.map(image=>image.file));
const result={pairs:[],failures:[]};
await fs.mkdir(`${root}/supplemental`);
for(const image of before.screenshots.filter(image=>afterNames.has(image.file))){
  try{
    const a=`${root}/measure-after/${image.file}`,b=`${root}/measure-before/${image.file}`;
    const output=await exec("node",[visual,"image-diff",b,a],{maxBuffer:16<<20});
    const comparison=JSON.parse(output.stdout);
    const pair={file:image.file,beforeSha256:hash(await fs.readFile(b)),afterSha256:hash(await fs.readFile(a)),result:comparison};
    result.pairs.push(pair);
    if(!comparison.dimensionsMatch||!comparison.alphaChannelIntact)result.failures.push({file:image.file,reason:"dimensions or alpha"});
  }catch(error){result.failures.push({file:image.file,error:String(error)});}
}
await fs.writeFile(`${root}/supplemental/pairs.json`,JSON.stringify(result,null,2));
console.log(`SUPPLEMENTAL pairs=${result.pairs.length} failures=${result.failures.length}`);
if(result.failures.length)process.exitCode=1;
