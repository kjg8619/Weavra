import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url)), exec = promisify(execFile);
const base = "https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18";
const url = name => `${base}/${name}?raw=true`;
const sha = b => createHash("sha256").update(b).digest("hex");
const json = async path => JSON.parse(await fs.readFile(join(root,path),"utf8"));
const flat = (side, file) => `${side}--${file.replaceAll("/","--")}`;
const [mode,arg] = process.argv.slice(2);
async function index() {
  const pairs = [...(await json("diff/pairs.json")).pairs,...(await json("supplemental/pairs.json")).pairs], images = [];
  for (const pair of pairs) {
    assert.equal(pair.result.dimensionsMatch,true,pair.file);
    assert.equal(pair.result.alphaChannelIntact,true,pair.file);
    for (const side of ["before","after"]) {
      const source = pair.supplemental ? join(root,`measure-${side}`,pair.file.replace(/^forms\//,"")) : join(root,side,"capture",pair.file);
      const bytes = await fs.readFile(source);
      assert.equal(sha(bytes),pair[`${side}Sha256`]);
      images.push({ category:"capture", file:pair.file, name:flat(side,pair.file), source, sha256:sha(bytes) });
    }
  }
  for (const round of ["qa","qa-round-01"])
    for (const check of (await json(`${round}/scenario-receipt.json`)).checks)
      for (const image of check.artifacts.filter(a => a.file.endsWith(".png"))) {
        const source = join(root,round,image.file), bytes = await fs.readFile(source);
        assert.equal(sha(bytes),image.sha256);
        images.push({ category:round,file:image.file,name:flat(round,image.file.replace(/^run-[^/]+\//,"")),source,sha256:sha(bytes) });
      }
  for (const side of ["before","after"]) {
    const measure = await json(`measure-${side}/qa-measure.json`);
    assert.equal(measure.failures.length,0);
    for (const image of measure.screenshots) {
      const source = join(root,`measure-${side}`,image.file), bytes = await fs.readFile(source);
      assert.equal(sha(bytes),image.sha256);
      images.push({ category:`measure-${side}`,file:image.file,name:flat(`measure-${side}`,image.file),source,sha256:sha(bytes) });
    }
  }
  return { pairs,images };
}
function gallery({pairs,images}) {
  const rows = ["# HIG 18 complete image table","","| State | Before | After | Diff / hotspots |","|---|---|---|---|"];
  for (const pair of pairs)
    rows.push(`| \`${pair.file}\` | ![before](${url(flat("before",pair.file))}) | ![after](${url(flat("after",pair.file))}) | ${pair.result.diffRatio} / ${pair.result.hotspots.length} |`);
  rows.push("","## Fresh self-measurement and two acceptance rounds","","| State | Actual packaged app |","|---|---|");
  for (const image of images.filter(i => i.category !== "capture"))
    rows.push(`| \`${image.category}/${image.file}\` | ![actual](${url(image.name)}) |`);
  return rows.join("\n")+"\n";
}
if (mode === "stage") {
  const data = await index(), out = join(arg,"18");
  await fs.mkdir(out,{recursive:true});
  for (const image of data.images) await fs.copyFile(image.source,join(out,image.name));
  const files = [
    "diff/pairs.json","supplemental/pairs.json","measure-summary.json","qa/scenario-receipt.json","qa-round-01/scenario-receipt.json",
    "before/capture/capture-manifest.json","after/capture/capture-manifest.json",
    "measure-before/qa-measure.json","measure-after/qa-measure.json",
    "blocked-status.json","BLOCKER.md","blocked-accept-18.sh",
    "rules-a-j.md","diff-inspection.md","pipeline-18.sh","pipeline-18-final.log",
    "tools/measure-18.mjs","tools/preload-app-gate.mjs","tools/gate.sh","tools/build.sh",
    "logs/focused.log","logs/fmt.log","logs/lint.log","logs/typecheck.log",
    "logs/build-before.log","logs/build-after.log","logs/measure-before.log","logs/measure-after.log",
    "logs/accept-scenarios-01.log","logs/accept-scenarios-02.log",
    "logs/verify-packet-01.log","logs/verify-packet-02.log","logs/evidence-apps.log",
    "publication-head.md","publication-tail.md","publication-body.md","publish-18.mjs",
    "tools/summarize-18.mjs","tools/diff-forms.mjs","logs/parent-lint.log",
  ];
  for (const file of files) await fs.copyFile(join(root,file),join(out,file.replaceAll("/","--")));
  for (const round of ["qa","qa-round-01"]) {
    const receipt=await json(`${round}/scenario-receipt.json`);
    await fs.copyFile(join(root,round,receipt.capture.file),join(out,`${round}--scenario-capture-manifest.json`));
    for (const check of receipt.checks)
      for (const artifact of check.artifacts.filter(a=>!a.file.endsWith(".png"))) {
        const source=join(root,round,artifact.file);
        assert.equal(sha(await fs.readFile(source)),artifact.sha256);
        await fs.copyFile(source,join(out,flat(round,artifact.file.replace(/^run-[^/]+\//,""))));
      }
  }
  await fs.writeFile(join(out,"image-table.md"),gallery(data));
  await fs.writeFile(join(out,"publication-index.json"),JSON.stringify({images:data.images.map(({source,...i})=>i)},null,2));
  console.log(`STAGED images=${data.images.length} pairs=${data.pairs.length}`);
} else if (mode === "body") {
  const data = await index();
  const required = data.pairs.filter(p => (/\/(?:22|28)_/.test(p.file) && !p.file.includes("electron")) ||
    (p.supplemental && /-(?:provider-list|new-form|edited-form)\.png$/.test(p.file)));
  const rows = ["## Before / after","","| State, size, theme | Before | After | Diff / hotspots |","|---|---|---|---|"];
  for (const pair of required)
    rows.push(`| \`${pair.file}\` | ![before](${url(flat("before",pair.file))}) | ![after](${url(flat("after",pair.file))}) | ${pair.result.diffRatio} / ${pair.result.hotspots.length} |`);
  rows.push("",`[Complete image table: all baseline, themed supplemental, form and acceptance states](${base}/image-table.md).`);
  const body = (await fs.readFile(join(root,"publication-head.md"),"utf8")).trimEnd()+"\n\n"+
    rows.join("\n")+"\n\n"+(await fs.readFile(join(root,"publication-tail.md"),"utf8")).trimEnd()+"\n";
  assert.ok(body.length < 65000);
  await fs.writeFile(join(root,"publication-body.md"),body);
  console.log(`BODY chars=${body.length} images=${data.images.length}`);
} else if (mode === "verify-evidence") {
  const data = await index(), checks = []; let next = 0;
  const tableResponse = await fetch(url("image-table.md"),{signal:AbortSignal.timeout(30000)});
  assert.equal(tableResponse.status,200);
  assert.equal(await tableResponse.text(),gallery(data));
  await Promise.all(Array.from({length:4},async()=>{
    while(next < data.images.length) {
      const image=data.images[next++];
      try {
        const r=await fetch(url(image.name),{signal:AbortSignal.timeout(30000)});
        checks.push({name:image.name,status:r.status,sha256:sha(new Uint8Array(await r.arrayBuffer())),expected:image.sha256});
      } catch(error) { checks.push({name:image.name,status:0,error:String(error)}); }
    }
  }));
  const failures=checks.filter(c=>c.status!==200||c.sha256!==c.expected);
  const textLinks=[];
  for (const file of ["BLOCKER.md","blocked-status.json","rules-a-j.md","measure-summary.json","publication-body.md"]) {
    const name=file.replaceAll("/","--"), local=await fs.readFile(join(root,file));
    const response=await fetch(url(name),{signal:AbortSignal.timeout(30000)});
    const actual=sha(new Uint8Array(await response.arrayBuffer()));
    const row={name,status:response.status,sha256:actual,expected:sha(local)};
    textLinks.push(row);
    if(row.status!==200||row.sha256!==row.expected) failures.push(row);
  }
  await fs.writeFile(join(root,"publication-verification.json"),JSON.stringify({evidenceOnly:true,prCreated:false,linked:data.images.length,checks,textLinks,failures},null,2));
  console.log(`VERIFY_EVIDENCE linked=${data.images.length} failures=${failures.length}`);
  process.exitCode=failures.length?1:0;
} else if (mode === "verify") {
  const data = await index(), local = await fs.readFile(join(root,"publication-body.md"),"utf8");
  const pr = JSON.parse((await exec("gh",["pr","view",arg,"--repo","kjg8619/Weavra","--json","body,headRefOid,baseRefName,baseRefOid,isDraft,url"],{maxBuffer:8<<20})).stdout);
  assert.equal(pr.body.trimEnd(),local.trimEnd()); assert.equal(pr.isDraft,false);
  assert.equal(pr.baseRefName,"hig/17-archive-next-step");
  assert.equal(pr.baseRefOid,(await json("before/capture/capture-manifest.json")).revision);
  assert.equal(pr.headRefOid,(await json("after/capture/capture-manifest.json")).revision);
  const tableResponse = await fetch(url("image-table.md"),{signal:AbortSignal.timeout(30000)});
  assert.equal(tableResponse.status,200);
  const table = await tableResponse.text(); assert.equal(table,gallery(data));
  const linked = data.images.filter(i => (pr.body+table).includes(url(i.name)));
  assert.equal(linked.length,data.images.length);
  const checks = []; let next = 0;
  await Promise.all(Array.from({length:4},async()=>{
    while(next < linked.length) {
      const image = linked[next++];
      try {
        const r = await fetch(url(image.name),{signal:AbortSignal.timeout(30000)});
        checks.push({name:image.name,status:r.status,sha256:sha(new Uint8Array(await r.arrayBuffer())),expected:image.sha256});
      } catch(error) { checks.push({name:image.name,status:0,error:String(error)}); }
    }
  }));
  const failures = checks.filter(c=>c.status!==200||c.sha256!==c.expected);
  const imageUrls = new Set(data.images.map(i=>url(i.name)));
  const textUrls = [...new Set([...pr.body.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(m=>m[1]))].filter(u=>!imageUrls.has(u));
  const textLinks = await Promise.all(textUrls.map(async u=>{
    try { const r=await fetch(u,{signal:AbortSignal.timeout(30000)}); await r.arrayBuffer(); return {url:u,status:r.status}; }
    catch(error) { return {url:u,status:0,error:String(error)}; }
  }));
  failures.push(...textLinks.filter(c=>c.status!==200));
  await fs.writeFile(join(root,"publication-verification.json"),JSON.stringify({head:pr.headRefOid,linked:linked.length,checks,textLinks,failures},null,2));
  console.log(`VERIFY ${pr.url} linked=${linked.length} failures=${failures.length}`);
  process.exitCode=failures.length?1:0;
} else throw new Error("Usage: bun publish-18.mjs stage DIR | body | verify PR");
