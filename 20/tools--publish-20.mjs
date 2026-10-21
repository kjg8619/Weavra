import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-20";
const remote = "https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20";
const flat = file => file.replaceAll("/", "--");
const url = file => `${remote}/${flat(file)}?raw=true`;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const json = async file => JSON.parse(await fs.readFile(`${root}/${file}`, "utf8"));
const [mode, arg] = process.argv.slice(2);
async function inventory() {
  assert.equal((await json("acceptance-verdict.json")).product, "PASS");
  const after = await json("after/capture/capture-manifest.json");
  assert.equal((await json("qa/scenario-receipt.json")).revision, after.revision);
  assert.equal((await json("qa-round-01/scenario-receipt.json")).revision, after.revision);
  assert.equal((await json("measure-after/measurements.json")).head, after.revision);
  assert.equal((await json("measure-after/summary.json")).failures, 0);
  assert.equal((await json("state44-regression/receipt.json")).rows.length, 8);
  const files = [];
  async function scan(dir) {
    for (const entry of await fs.readdir(`${root}/${dir}`, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await scan(file);
      else if (/\.(png|json|md|mjs|sh|log)$/.test(file)) {
        const bytes = await fs.readFile(`${root}/${file}`);
        files.push({ file, name: flat(file), sha256: hash(bytes), bytes: bytes.length });
      }
    }
  }
  for (const dir of ["before/capture", "after/capture", "diff", "measure-after", "state44-regression", "qa", "qa-round-01", "tools"]) await scan(dir);
  for (const file of ["rules-a-j.md", "acceptance-status.json", "acceptance-verdict.json", "acceptance-verdict-01.json", "acceptance-verdict-02.json", "diff-inspection.md", "publication-body.md"]) {
    const bytes = await fs.readFile(`${root}/${file}`);
    files.push({ file, name: flat(file), sha256: hash(bytes), bytes: bytes.length });
  }
  const logs = ["tests", "fmt", "lint", "typecheck-web", "typecheck-contracts", "diff-check", "runner-tests", "build-before", "build-after", "measure-after", "state44-regression", "capture-before", "capture-after", "diff", "accept-scenarios-01", "accept-scenarios-02", "verify-packet-01", "verify-packet-02", "diff-check-01", "diff-check-02", "evidence-apps"];
  for (const name of logs) {
    const file = `logs/${name}.log`, bytes = await fs.readFile(`${root}/${file}`);
    files.push({ file, name: flat(file), sha256: hash(bytes), bytes: bytes.length });
  }
  return files;
}
async function table() {
  const { pairs } = await json("diff/pairs.json");
  const lines = ["# HIG 20 complete before / after table", "", "| State, size, theme, interaction | Parent | Head | Diff JSON |", "|---|---|---|---|"];
  for (const pair of pairs) lines.push(`| \`${pair.file}\` | ![before](${url(`before/capture/${pair.file}`)}) | ![after](${url(`after/capture/${pair.file}`)}) | [${pair.result.diffRatio}](${url(`diff/${pair.file.replace(".png", ".json")}`)}) |`);
  lines.push("", "## Supplemental deletion, focus, keyboard and archive evidence", "", "| State | Actual packaged app |", "|---|---|");
  const measured = await json("measure-after/measurements.json");
  for (const image of measured.screenshots) lines.push(`| \`${image.file}\` | ![actual](${url(`measure-after/${image.file}`)}) |`);
  lines.push("", "## Both official acceptance rounds", "", "| Scenario artifact | Actual packaged app |", "|---|---|");
  async function scenarioImages(dir) {
    for (const entry of await fs.readdir(`${root}/${dir}`, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await scenarioImages(file);
      else if (entry.name.endsWith(".png")) lines.push(`| \`${file}\` | ![acceptance](${url(file)}) |`);
    }
  }
  await scenarioImages("qa-round-01");
  await scenarioImages("qa");
  lines.push("", "## Earlier stack state-44 regression", "");
  for (const row of (await json("state44-regression/receipt.json")).rows) lines.push(`- Todo ${row.number}, ${row.width}x${row.height}: ![exact target Confirm action](${url(`state44-regression/${row.file}`)})`);
  return lines.join("\n") + "\n";
}
if (mode === "stage") {
  const files = await inventory(), dest = `${arg}/20`;
  await fs.mkdir(dest, { recursive: true });
  for (const file of files) await fs.copyFile(`${root}/${file.file}`, `${dest}/${file.name}`);
  const gallery = await table();
  await fs.writeFile(`${dest}/image-table.md`, gallery);
  files.push({ file: "image-table.md", name: "image-table.md", sha256: hash(gallery), bytes: Buffer.byteLength(gallery) });
  await fs.writeFile(`${dest}/publication-index.json`, JSON.stringify({ files }, null, 2));
  console.log(`STAGED files=${files.length} PNGs=${files.filter(f => f.file.endsWith(".png")).length}`);
} else if (mode === "push") {
  const git = async (...args) => (await exec("git", args, { cwd: arg, maxBuffer: 16 << 20, timeout: 1800000, env: { ...process.env, GIT_MASTER: "1" } })).stdout.trim();
  assert.equal(await git("branch", "--show-current"), "hig-evidence/20");
  const files = [...new Set([...(await git("diff", "--name-only", "--", "20")).split("\n"), ...(await git("diff", "--cached", "--name-only", "--", "20")).split("\n"), ...(await git("ls-files", "--others", "--exclude-standard", "--", "20")).split("\n")])].filter(Boolean).sort();
  let batch = [], bytes = 0, round = 0;
  async function push() {
    if (!batch.length) return;
    await git("add", "--", ...batch);
    await git("commit", "-m", `docs(hig): publish verified todo 20 evidence batch ${++round}`);
    const head = await git("rev-parse", "HEAD");
    await git("-c", "http.version=HTTP/2", "-c", "pack.threads=2", "-c", "pack.window=0", "push", "origin", "HEAD:refs/heads/hig-evidence/20");
    console.log(`BATCH ${round} PUSH_EXIT=0 SHA=${head}`);
    batch = []; bytes = 0;
  }
  for (const file of files) {
    const size = (await fs.stat(`${arg}/${file}`)).size;
    if (batch.length && bytes + size > 12 * 1024 * 1024) await push();
    batch.push(file); bytes += size;
  }
  await push();
} else if (mode === "verify") {
  const response = await fetch(url("publication-index.json"), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const { files } = await response.json(), failures = [], checks = [];
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < files.length) {
      const file = files[next++];
      try {
        const r = await fetch(url(file.name), { signal: AbortSignal.timeout(30000) });
        const actual = hash(new Uint8Array(await r.arrayBuffer()));
        checks.push({ ...file, status: r.status, actual });
        if (r.status !== 200 || actual !== file.sha256) failures.push({ ...file, status: r.status, actual });
      } catch (error) { failures.push({ ...file, error: String(error) }); }
    }
  }));
  const pr = JSON.parse((await exec("gh", ["pr", "view", arg, "--repo", "kjg8619/Weavra", "--json", "body,headRefOid,baseRefName,baseRefOid,isDraft,url"], { maxBuffer: 8 << 20 })).stdout);
  assert.equal(pr.isDraft, false);
  assert.equal(pr.baseRefName, "hig/19-theme-selection");
  assert.equal(pr.headRefOid, (await json("after/capture/capture-manifest.json")).revision);
  assert.equal(pr.baseRefOid, (await json("before/capture/capture-manifest.json")).revision);
  const body = await fs.readFile(`${root}/publication-body.md`, "utf8");
  assert.equal(pr.body.trimEnd(), body.trimEnd());
  const gallery = await table();
  const links = [...new Set([...(body + gallery).matchAll(/\]\((https:\/\/[^)]+)\)/g)].map(match => match[1]))];
  const verified = new Set(checks.filter(check => check.status === 200 && check.actual === check.sha256).map(check => url(check.name)));
  for (const link of links.filter(link => !verified.has(link))) {
    try {
      const r = await fetch(link, { signal: AbortSignal.timeout(30000) }); await r.arrayBuffer();
      checks.push({ url: link, status: r.status });
      if (r.status !== 200) failures.push({ url: link, status: r.status });
    } catch (error) { failures.push({ url: link, error: String(error) }); }
  }
  await fs.writeFile(`${root}/verify-links.json`, JSON.stringify({ pr, checked: files.length, links: links.length, checks, failures }, null, 2));
  console.log(`VERIFY files=${files.length} links=${links.length} failures=${failures.length} PR=${pr.url}`);
  process.exitCode = failures.length ? 1 : 0;
} else throw new Error("Usage: stage DIR | push DIR | verify PR");
