import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root=dirname(fileURLToPath(import.meta.url)),exec=promisify(execFile);
const fixRoot=join(dirname(root),"pr-19-fix1-measure");
const source=file=>file.startsWith("fix1/")?join(fixRoot,file.slice(5)):join(root,file);
const base="https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19";
const url=file=>`${base}/${file}?raw=true`;
const flat=file=>file.replaceAll("/","--");
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const json=async file=>JSON.parse(await fs.readFile(join(root,file),"utf8"));
const [mode,arg]=process.argv.slice(2);
async function inventory() {
  assert.equal((await json("acceptance-verdict.json")).product,"PASS");
  const revision=(await json("after/capture/capture-manifest.json")).revision;
  assert.equal((await json("qa/scenario-receipt.json")).revision,revision);
  assert.equal((await json("measure-after/measurements.json")).failures.length,0);
  const pairs=(await json("diff/pairs.json")).pairs;
  const supplemental=(await json("supplemental/pairs.json")).pairs;
  const images=[];
  async function scan(dir) {
    for(const entry of await fs.readdir(join(root,dir),{withFileTypes:true})){
      const file=`${dir}/${entry.name}`;
      if(entry.isDirectory())await scan(file);
      else if(file.endsWith(".png")) images.push({file,name:flat(file),sha256:sha(await fs.readFile(join(root,file)))});
    }
  }
  for(const dir of ["before/capture","after/capture","measure-before","measure-after","qa","fix2","review"])await scan(dir);
  const labelBefore=await json("fix2/before/measurements.json"),labelAfter=await json("fix2/after/measurements.json");
  assert.equal(labelBefore.rows.length,24);assert.equal(labelBefore.failures.length,12);
  assert.equal(labelAfter.rows.length,24);assert.equal(labelAfter.failures.length,0);
  assert.equal(labelAfter.revision,revision);
  for(const round of ["fix2/qa-round-01","qa"]){
    const receipt=await json(`${round}/scenario-receipt.json`);
    assert.equal(receipt.revision,revision);
    assert.ok(receipt.checks.every(check=>check.status==="PASS"));
  }
  const fix=JSON.parse(await fs.readFile(join(fixRoot,"measurements.json"),"utf8"));
  assert.equal(fix.revision,revision);assert.equal(fix.failures.length,0);
  for(const image of fix.screenshots){
    const file=`fix1/${image.file}`,bytes=await fs.readFile(source(file));
    assert.equal(sha(bytes),image.sha256);
    images.push({file,name:flat(file),sha256:image.sha256});
  }
  return {pairs,supplemental,images,labelPairs:(await json("fix2/pairs.json")).pairs};
}
function gallery(data) {
  const rows=["# HIG 19 complete image table","","| State, size, theme, interaction | Parent | Head | Diff JSON |","|---|---|---|---|"];
  for(const pair of data.pairs)
    rows.push(`| \`${pair.file}\` | ![before](${url(flat(`before/capture/${pair.file}`))}) | ![after](${url(flat(`after/capture/${pair.file}`))}) | [${pair.result.diffRatio}](${url(flat(`diff/${pair.file.replace(".png",".json")}`))}) |`);
  for(const pair of data.supplemental)
    rows.push(`| \`self-measure/${pair.file}\` | ![before](${url(flat(`measure-before/${pair.file}`))}) | ![after](${url(flat(`measure-after/${pair.file}`))}) | [${pair.result.diffRatio}](${url(flat("supplemental/pairs.json"))}) |`);
  rows.push("","## Variant label regression: 14914ad vs b4de3b5d","","| Viewport, text scale and app theme | Defective 14914ad | Fixed b4de3b5d | Measurement / diff |","|---|---|---|---|");
  for(const pair of data.labelPairs)
    rows.push(`| \`${pair.file}\` | ![before](${url(flat(`fix2/before/${pair.file}`))}) | ![after](${url(flat(`fix2/after/${pair.file}`))}) | [zero overlap, ${pair.result.diffRatio}](${url(flat("fix2/pairs.json"))}) |`);
  rows.push("","## Additional text expansion, System and acceptance frames","","| State | Actual packaged app |","|---|---|");
  for(const image of data.images.filter(i=>!i.file.startsWith("before/capture/")&&!i.file.startsWith("after/capture/")))
    rows.push(`| \`${image.file}\` | ![actual](${url(image.name)}) |`);
  return rows.join("\n")+"\n";
}
async function stage(data,destination) {
  const out=join(destination,"19");await fs.mkdir(out,{recursive:true});
  const files=[];
  const finalLogs=new Set([
    "focused.log","fmt.log","lint.log","typecheck.log","accent-stripes.log","diff-check.log",
    "runner-tests.log","build-before.log","build-after.log","measure-before.log","measure-after.log",
    "capture-before.log","capture-after.log","diff.log","supplemental-diff.log","capture-accept.log",
    "accept-scenarios-01.log","accept-scenarios-02.log","verify-packet-01.log","verify-packet-02.log",
    "diff-check-01.log","diff-check-02.log","evidence-apps.log",
    "accept-scenarios-fix1.log","verify-packet-fix1.log","diff-check-fix1.log","capture-fix1.log",
    "variant-label-before-fix2.log","variant-label-after-fix2.log","korean-focus-fix2.log",
    "variant-label-diff-fix2.log",
    "accept-scenarios-fix2-01.log","accept-scenarios-fix2-02.log",
    "verify-packet-fix2-01.log","verify-packet-fix2-02.log",
    "verify-packet-fix2-final.log",
    "diff-check-fix2-01.log","diff-check-fix2-02.log","capture-fix2.log",
  ]);
  async function scan(dir) {
    for(const entry of await fs.readdir(join(root,dir),{withFileTypes:true})){
      const file=`${dir}/${entry.name}`;
      if(entry.isDirectory())await scan(file);
      else if(/\.(?:json|png|md|mjs|sh|log)$/.test(file)&&(dir!=="logs"||finalLogs.has(entry.name)))files.push(file);
    }
  }
  for(const dir of ["before/capture","after/capture","measure-before","measure-after","qa","diff","supplemental","logs","tools","fix2","review"])await scan(dir);
  files.push("fix1/measurements.json","fix1/summary.json","fix1/measure.mjs","fix1/logs/measure.log","fix1/logs/focused-red.log","fix1/logs/build.log",...data.images.filter(image=>image.file.startsWith("fix1/")).map(image=>image.file));
  files.push("rules-a-j.md","acceptance-status.json","acceptance-verdict.json","publication-head.md","publication-tail.md","publication-body.md","publish-19.mjs","diff-inspection.md");
  for(const file of files)await fs.copyFile(source(file),join(out,flat(file)));
  await fs.writeFile(join(out,"image-table.md"),gallery(data));
  await fs.writeFile(join(out,"publication-index.json"),JSON.stringify({images:data.images,files},null,2));
  console.log(`STAGED files=${files.length} images=${data.images.length}`);
}
if(mode==="body"){
  const data=await inventory();
  const rows=["## Before / after","","| State, size, theme, interaction | Before | After | Diff |","|---|---|---|---|"];
  for(const pair of data.pairs.filter(p=>/\/(?:18|19)_/.test(p.file)&&!p.file.includes("electron")))
    rows.push(`| \`${pair.file}\` | ![before](${url(flat(`before/capture/${pair.file}`))}) | ![after](${url(flat(`after/capture/${pair.file}`))}) | [${pair.result.diffRatio}](${url(flat(`diff/${pair.file.replace(".png",".json")}`))}) |`);
  rows.push("",`[Complete image table: all baseline states, both themes, selection/focus/grayscale, imported theme and System switching](${url("image-table.md")}).`);
  const body=(await fs.readFile(join(root,"publication-head.md"),"utf8")).trimEnd()+"\n\n"+rows.join("\n")+"\n\n"+(await fs.readFile(join(root,"publication-tail.md"),"utf8")).trimEnd()+"\n";
  assert.ok(body.length<65000);await fs.writeFile(join(root,"publication-body.md"),body);
  console.log(`BODY chars=${body.length}`);
}else if(mode==="stage"){
  await stage(await inventory(),arg);
}else if(mode==="push"){
  const cwd=arg;
  const git=async(...args)=>(await exec("git",args,{cwd,maxBuffer:16<<20,timeout:1800000})).stdout.trim();
  assert.equal(await git("branch","--show-current"),"hig-evidence/19");
  const files=[...new Set([
    ...(await git("diff","--name-only","HEAD","--","19")).split("\n"),
    ...(await git("diff","--cached","--name-only","--","19")).split("\n"),
    ...(await git("ls-files","--others","--exclude-standard","--","19")).split("\n"),
  ])].filter(Boolean).sort();
  let batch=[],bytes=0,round=0;
  const push=async()=>{
    if(!batch.length)return;
    await git("add","--",...batch);
    await git("commit","-m",`docs(hig): refresh verified todo 19 label fix evidence batch ${++round}`);
    const head=await git("rev-parse","HEAD");
    const result=await exec("git",["-c","http.version=HTTP/2","-c","pack.threads=2","-c","pack.window=0","push","origin","HEAD:refs/heads/hig-evidence/19"],{cwd,maxBuffer:16<<20,timeout:1800000});
    console.log(`BATCH ${round} PUSH_EXIT=0 SHA=${head}`);console.log(result.stderr);
    batch=[];bytes=0;
  };
  for(const file of files){
    const size=(await fs.stat(join(cwd,file))).size;
    if(batch.length&&bytes+size>12*1024*1024)await push();
    batch.push(file);bytes+=size;
  }
  await push();console.log("EVIDENCE_PUBLICATION_DONE");
}else if(mode==="verify"||mode==="verify-evidence"){
  const data=await inventory(),failures=[],checks=[];
  const evidenceHead=(await exec("gh",["api","repos/kjg8619/Weavra/git/ref/heads/hig-evidence/19","--jq",".object.sha"])).stdout.trim();
  const cached=mode==="verify"?await json("verify-evidence-links.json"):null;
  if(cached)assert.equal(cached.evidenceHead,evidenceHead,"Evidence moved after upload verification");
  const response=await fetch(url("image-table.md"),{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200);assert.equal(await response.text(),gallery(data));
  if(mode==="verify"){
    const pr=JSON.parse((await exec("gh",["pr","view",arg,"--repo","kjg8619/Weavra","--json","body,headRefOid,baseRefName,baseRefOid,isDraft,url"],{maxBuffer:8<<20})).stdout);
    assert.equal(pr.body.trimEnd(),(await fs.readFile(join(root,"publication-body.md"),"utf8")).trimEnd());
    assert.equal(pr.isDraft,false);assert.equal(pr.baseRefName,"hig/18-provider-layout");
    assert.equal(pr.baseRefOid,(await json("before/capture/capture-manifest.json")).revision);
    assert.equal(pr.headRefOid,(await json("after/capture/capture-manifest.json")).revision);
    console.log(`PR_METADATA_PASS ${pr.url}`);
  }
  let next=0;
  await Promise.all(Array.from({length:4},async()=>{
    while(next<data.images.length){
      const image=data.images[next++];
      try{
        if(cached){
          const checked=cached.checks.find(row=>row.file===image.file&&row.sha256===image.sha256);
          assert.equal(checked?.status,200,image.file);
          assert.equal(checked?.actual,image.sha256,image.file);
          checks.push({...checked,reusedFrom:"verify-evidence-links.json"});continue;
        }
        const r=await fetch(url(image.name),{signal:AbortSignal.timeout(30000)});
        const actual=sha(new Uint8Array(await r.arrayBuffer()));
        const row={...image,status:r.status,actual};checks.push(row);
        if(row.status!==200||actual!==image.sha256)failures.push(row);
      }catch(error){failures.push({...image,error:String(error)});}
    }
  }));
  const body=await fs.readFile(join(root,"publication-body.md"),"utf8");
  const table=gallery(data);
  for(const image of data.images)assert.ok((body+table).includes(url(image.name)),`Unlinked image ${image.file}`);
  const imageUrls=new Set(data.images.map(i=>url(i.name)));
  const links=[...new Set([...(body+table).matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(m=>m[1]))].filter(u=>!imageUrls.has(u));
  for(const link of links){
    try{
      const prior=cached?.checks.find(row=>row.url===link&&row.status===200);
      if(prior){checks.push({...prior,reusedFrom:"verify-evidence-links.json"});continue;}
      const r=await fetch(link,{signal:AbortSignal.timeout(30000)});await r.arrayBuffer();checks.push({url:link,status:r.status});if(r.status!==200)failures.push({url:link,status:r.status});
    }
    catch(error){failures.push({url:link,error:String(error)});}
  }
  await fs.writeFile(join(root,`${mode}-links.json`),JSON.stringify({evidenceHead,images:data.images.length,checks,failures},null,2));
  console.log(`VERIFY images=${data.images.length} links=${links.length} failures=${failures.length}`);
  process.exitCode=failures.length?1:0;
}else throw new Error("Usage: body | stage DIR | push DIR | verify PR | verify-evidence");
