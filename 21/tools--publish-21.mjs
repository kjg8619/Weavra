import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-21";
const source = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-21";
const remote = "https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21";
const flat = file => file.replaceAll("/", "--");
const url = file => `${remote}/${encodeURIComponent(flat(file))}`;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await fs.readFile(`${root}/${file}`, "utf8"));
const git = async (cwd, ...args) => (await exec("git", args, {
  cwd, maxBuffer: 32 << 20, timeout: 1800000,
  env: { ...process.env, GIT_MASTER: "1" },
})).stdout.trim();
const [mode, arg] = process.argv.slice(2);

async function inventory() {
  const verdict = await json("acceptance-verdict.json");
  const after = await json("after/capture/capture-manifest.json");
  const measured = await json("measure-after/observations.json");
  assert.equal(verdict.product, "PASS");
  assert.deepEqual(verdict.closes, ["W-33", "W-34"]);
  assert.equal(await git(source, "rev-parse", "HEAD"), after.revision);
  assert.equal(await git(source, "status", "--porcelain", "--untracked-files=no"), "");
  for (const directory of ["qa", "qa-round-01"]) {
    const receipt = await json(`${directory}/scenario-receipt.json`);
    assert.equal(receipt.revision, after.revision);
    assert.equal(receipt.asarSha256, after.provenance.asarSha256);
    assert.equal(receipt.cleanup.exited, true);
    assert.ok(receipt.checks.every(check => check.status === "PASS"));
  }
  assert.equal(measured.head, after.revision);
  assert.equal(measured.diagnostic, false);
  assert.equal(measured.asarSha256, after.provenance.asarSha256);
  assert.equal(measured.summary.failures, 0);
  assert.equal((await json("ownership.json")).amendmentApplied, true);
  const files = [];
  async function add(file) {
    const bytes = await fs.readFile(`${root}/${file}`);
    files.push({ file, name: flat(file), sha256: hash(bytes), bytes: bytes.length });
  }
  async function scan(directory) {
    for (const entry of await fs.readdir(`${root}/${directory}`, { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await scan(file);
      else if (/\.(png|json|md|mjs|py|sh|log)$/.test(file)) await add(file);
    }
  }
  for (const directory of ["before/capture","after/capture","diff","measure-after","qa","qa-round-01","tools","review","diagnosis-parent","channel-comparison"])
    await scan(directory);
  for (const file of ["rules-a-j.md","W33-DIAGNOSIS.md","gate-results.json","lint-comparison.json",
    "ownership.json","acceptance-verdict.json","acceptance-verdict-01.json",
    "acceptance-verdict-02.json","diff-inspection.md","publication-body.md",
    "fixture-retention.json","packet-recovery.md"]) await add(file);
  for (const name of ["tests-desktop","lint-parent","build-before","build-after","measure-after",
    "capture-before","capture-after","diff","accept-scenarios-01","accept-scenarios-02","verify-packet-01",
    "verify-packet-02","verify-packet-retained","diff-check-01","diff-check-02","runner-identity","evidence-apps","push-source"])
    await add(`logs/${name}.log`);
  await scan("logs/final-ink");
  assert.equal(new Set(files.map(file => file.name)).size, files.length);
  return files;
}

async function table() {
  const { pairs } = await json("diff/pairs.json");
  const lines = ["# HIG 21 complete paired image table", "",
    "| State, size, theme, interaction | Parent | Head | Diff JSON |",
    "|---|---|---|---|"];
  for (const pair of pairs)
    lines.push(`| \`${pair.file}\` | ![before](${url(`before/capture/${pair.file}`)}) | ![after](${url(`after/capture/${pair.file}`)}) | [${pair.result.diffRatio}](${url(`diff/${pair.file.replace(".png",".json")}`)}) |`);
  lines.push("", "## Measured toolbar, both sidebars, focus and explicit fixture action", "",
    "390 geometry is an unsupported-native diagnostic, not a phone-support claim. Required W-33 content parity at 390 is separately verified.", "",
    "| State | Packaged head |", "|---|---|");
  for (const image of (await json("measure-after/observations.json")).images)
    lines.push(`| \`${image.file}\` | ![actual](${url(`measure-after/${image.file}`)}) |`);
  lines.push("", "## Both fresh official acceptance rounds", "");
  async function images(directory) {
    for (const entry of await fs.readdir(`${root}/${directory}`, { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await images(file);
      else if (entry.name.endsWith(".png")) lines.push(`- \`${file}\`: ![acceptance](${url(file)})`);
    }
  }
  await images("qa-round-01"); await images("qa");
  lines.push("", "## Unchanged-parent product diagnosis", "",
    `- [Classification and causal evidence](${url("W33-DIAGNOSIS.md")})`,
    `- [Original repaired-runner results](${url("diagnosis-parent/lead/RUNNER-FIX-RESULTS.md")})`, "");
  await images("diagnosis-parent/probe");
  return lines.join("\n")+"\n";
}

if (mode === "stage") {
  assert.equal(await git(arg,"branch","--show-current"), "hig-evidence/21");
  const files = await inventory(), directory = `${arg}/21`;
  await fs.mkdir(directory, { recursive: true });
  for (const file of files) await fs.copyFile(`${root}/${file.file}`,`${directory}/${file.name}`);
  const gallery = await table();
  await fs.writeFile(`${directory}/image-table.md`,gallery);
  files.push({ file:"image-table.md",name:"image-table.md",sha256:hash(gallery),bytes:Buffer.byteLength(gallery) });
  await fs.writeFile(`${directory}/publication-index.json`,JSON.stringify({files},null,2));
  console.log(`STAGED files=${files.length} PNGs=${files.filter(file=>file.file.endsWith(".png")).length}`);
} else if (mode === "push") {
  assert.equal(await git(arg,"branch","--show-current"), "hig-evidence/21");
  const files = [...new Set([
    ...(await git(arg,"diff","--name-only","--","21")).split("\n"),
    ...(await git(arg,"diff","--cached","--name-only","--","21")).split("\n"),
    ...(await git(arg,"ls-files","--others","--exclude-standard","--","21")).split("\n"),
  ])].filter(Boolean).sort();
  let batch=[],bytes=0,round=0;
  async function publish() {
    if (!batch.length) return;
    await git(arg,"add","--",...batch);
    await git(arg,"commit","-m",`docs(hig): publish verified todo 21 evidence batch ${++round}`);
    const head=await git(arg,"rev-parse","HEAD");
    await git(arg,"-c","http.version=HTTP/2","-c","pack.threads=2","-c","pack.window=0",
      "push","origin","HEAD:refs/heads/hig-evidence/21");
    console.log(`BATCH ${round} PUSH_EXIT=0 SHA=${head}`);
    batch=[];bytes=0;
  }
  for (const file of files) {
    const size=(await fs.stat(`${arg}/${file}`)).size;
    if (batch.length&&bytes+size>12*1024*1024) await publish();
    batch.push(file);bytes+=size;
  }
  await publish();
} else if (mode === "verify") {
  const response=await fetch(url("publication-index.json"),{signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200);
  const {files}=await response.json(),checks=[],failures=[];
  let next=0;
  await Promise.all(Array.from({length:5},async()=>{
    while(next<files.length) {
      const file=files[next++];
      try {
        const result=await fetch(url(file.name),{signal:AbortSignal.timeout(30000)});
        const actual=hash(new Uint8Array(await result.arrayBuffer()));
        checks.push({...file,status:result.status,actual});
        if(result.status!==200||actual!==file.sha256) failures.push({...file,status:result.status,actual});
      } catch(error) { failures.push({...file,error:String(error)}); }
    }
  }));
  const pr=JSON.parse((await exec("gh",["pr","view",arg,"--repo","kjg8619/Weavra","--json",
    "body,headRefOid,baseRefName,baseRefOid,isDraft,url,state"],{maxBuffer:8<<20,timeout:60000})).stdout);
  assert.equal(pr.isDraft,false);assert.equal(pr.state,"OPEN");
  assert.equal(pr.baseRefName,"hig/20-delete-confirmation");
  assert.equal(pr.headRefOid,(await json("after/capture/capture-manifest.json")).revision);
  assert.equal(pr.baseRefOid,(await json("before/capture/capture-manifest.json")).revision);
  const body=await fs.readFile(`${root}/publication-body.md`,"utf8");
  assert.equal(pr.body.trimEnd(),body.trimEnd());
  const gallery=await table();
  const documents=await Promise.all(files.filter(file=>file.file.endsWith(".md")&&file.file!=="image-table.md")
    .map(file=>fs.readFile(`${root}/${file.file}`,"utf8")));
  const links=[...new Set([...(body+gallery+documents.join("\n")).matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(match=>match[1]))];
  const verified=new Set(checks.filter(check=>check.status===200&&check.actual===check.sha256).map(check=>url(check.name)));
  for(const link of links.filter(link=>!verified.has(link))) {
    try {
      const result=await fetch(link,{signal:AbortSignal.timeout(30000)});
      await result.arrayBuffer();checks.push({url:link,status:result.status});
      if(result.status!==200) failures.push({url:link,status:result.status});
    } catch(error) { failures.push({url:link,error:String(error)}); }
  }
  await fs.writeFile(`${root}/verify-links.json`,JSON.stringify({pr,checked:files.length,links:links.length,checks,failures},null,2));
  console.log(`VERIFY files=${files.length} links=${links.length} failures=${failures.length} PR=${pr.url}`);
  process.exitCode=failures.length?1:0;
} else throw new Error("Usage: stage DIR | push DIR | verify PR");
