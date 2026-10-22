// Stages, pushes and verifies the todo 22 evidence on the orphan branch hig-evidence/22 (folder 22/).
// Usage: bun tools/publish-22.mjs stage DIR | push DIR | verify PR_NUMBER
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22";
const source = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22";
const branch = "hig-evidence/22";
const remote = "https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/22/22";
const flat = (file) => file.replaceAll("/", "--");
const url = (file) => `${remote}/${encodeURIComponent(flat(file))}`;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = async (file) => JSON.parse(await fs.readFile(`${root}/${file}`, "utf8"));
const git = async (cwd, ...args) => (await exec("git", args, {
  cwd, maxBuffer: 32 << 20, timeout: 1800000, env: { ...process.env, GIT_MASTER: "1" },
})).stdout.trim();
const [mode, arg] = process.argv.slice(2);
// Rules the brief requires for every touched label; target size (a) is recorded, not gated, for copy-only work.
const GATED_RULES = ["ax", "b", "c", "d", "e", "f", "i", "j"];

async function inventory() {
  const verdict = await json("acceptance-verdict.json");
  const after = await json("after/capture/capture-manifest.json");
  const measured = await json("measure-after/measure-summary.json");
  const comparison = await json("measure-after/comparison.json");
  assert.equal(verdict.product, "PASS");
  assert.deepEqual(verdict.closes, ["W-03"]);
  assert.equal(await git(source, "rev-parse", "HEAD"), after.revision);
  assert.equal(await git(source, "status", "--porcelain", "--untracked-files=no"), "");
  for (const directory of ["qa", "qa-round-01"]) {
    const receipt = await json(`${directory}/scenario-receipt.json`);
    assert.equal(receipt.revision, after.revision);
    assert.equal(receipt.asarSha256, after.provenance.asarSha256);
    assert.equal(receipt.cleanup.exited, true);
    assert.ok(receipt.checks.every((check) => check.status === "PASS"));
  }
  assert.equal(measured.head, after.revision);
  assert.equal(measured.diagnostic, false);
  assert.equal(measured.asarSha256, after.provenance.asarSha256);
  assert.equal(measured.summary.byRule.f?.failed ?? 0, 0);
  for (const rule of GATED_RULES)
    assert.equal(comparison.introduced.filter((row) => row.rule === rule).length, 0, `introduced rule ${rule}`);
  assert.equal(comparison.introduced.filter((row) => row.rule === "ax").length + comparison.preexisting.filter((row) => row.rule === "ax").length, 0);
  const ownership = await json("ownership.json");
  assert.equal(ownership.head, after.revision);
  assert.ok(ownership.amendments.every((amendment) => amendment.recorded));
  const files = [];
  async function add(file) {
    const bytes = await fs.readFile(`${root}/${file}`);
    assert.ok(bytes.length < 90 << 20, `${file} is too large for GitHub`);
    files.push({ file, name: flat(file), sha256: hash(bytes), bytes: bytes.length });
  }
  async function scan(directory, pattern = /\.(png|json|md|mjs|py|sh|log)$/) {
    for (const entry of await fs.readdir(`${root}/${directory}`, { withFileTypes: true })) {
      const file = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await scan(file, pattern);
      else if (pattern.test(file)) await add(file);
    }
  }
  for (const directory of ["before/capture", "after/capture", "diff", "qa", "qa-round-01", "regression-21", "tools"]) await scan(directory);
  await scan("delegation", /\.md$/);
  await scan("measure-after", /\.(png|gz)$|measure-summary\.json$|comparison\.json$/);
  await scan("measure-parent", /\.gz$|measure-summary\.json$/);
  for (const file of ["rules-a-j.md", "locale-exceptions.md", "gate-results.json", "lint-comparison.json", "ownership.json",
    "acceptance-verdict.json", "acceptance-verdict-01.json", "acceptance-verdict-02.json", "publication-body.md",
    "fixture-retention.json", "consolidated-request.md", "runner-alias-request.md", "RUNNER-BLOCKER.md"]) await add(file);
  for (const name of ["fmt", "lint", "lint-parent", "typecheck-web", "typecheck-desktop", "tests-focused", "tests-web-all",
    "tests-parent-inherited", "tests-desktop", "runner-harness", "build-before", "build-after", "measure-after",
    "measure-parent", "capture-before", "capture-after", "diff", "accept-scenarios-01", "accept-scenarios-02",
    "verify-packet-01", "verify-packet-02", "diff-check-01", "diff-check-02", "runner-identity", "push-source-01", "regression-21"])
    await add(`logs/${name}.log`);
  assert.equal(new Set(files.map((file) => file.name)).size, files.length);
  return files;
}

async function table() {
  const { pairs } = await json("diff/pairs.json");
  const lines = ["# HIG 22 complete paired image table", "",
    "| State, size, theme, interaction | Parent | Head | Diff JSON |", "|---|---|---|---|"];
  for (const pair of pairs)
    lines.push(`| \`${pair.file}\` | ![before](${url(`before/capture/${pair.file}`)}) | ![after](${url(`after/capture/${pair.file}`)}) | [${pair.result.diffRatio}](${url(`diff/${pair.file.replace(".png", ".json")}`)}) |`);
  lines.push("", "## Rules a-j self-measurement frames (packaged head)", "",
    "Settings pages at both themes, 840/1280/1920, 100% and 150% text, 200% zoom and +40% copy; panels, dialogs and both sidebars.", "",
    "| State | Packaged head |", "|---|---|");
  for (const image of (await json("measure-after/measure-summary.json")).images)
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
  return lines.join("\n") + "\n";
}

if (mode === "stage") {
  assert.equal(await git(arg, "branch", "--show-current"), branch);
  const files = await inventory(), directory = `${arg}/22`;
  await fs.mkdir(directory, { recursive: true });
  for (const file of files) await fs.copyFile(`${root}/${file.file}`, `${directory}/${file.name}`);
  const gallery = await table();
  await fs.writeFile(`${directory}/image-table.md`, gallery);
  files.push({ file: "image-table.md", name: "image-table.md", sha256: hash(gallery), bytes: Buffer.byteLength(gallery) });
  await fs.writeFile(`${directory}/publication-index.json`, JSON.stringify({ files }, null, 2));
  console.log(`STAGED files=${files.length} PNGs=${files.filter((file) => file.file.endsWith(".png")).length}`);
} else if (mode === "push") {
  assert.equal(await git(arg, "branch", "--show-current"), branch);
  const files = [...new Set([
    ...(await git(arg, "diff", "--name-only", "--", "22")).split("\n"),
    ...(await git(arg, "diff", "--cached", "--name-only", "--", "22")).split("\n"),
    ...(await git(arg, "ls-files", "--others", "--exclude-standard", "--", "22")).split("\n"),
  ])].filter(Boolean).sort();
  let batch = [], bytes = 0, round = 0;
  async function publish() {
    if (!batch.length) return;
    await git(arg, "add", "--", ...batch);
    await git(arg, "commit", "-m", `docs(hig): publish verified todo 22 evidence batch ${++round}`);
    const head = await git(arg, "rev-parse", "HEAD");
    await git(arg, "-c", "http.version=HTTP/2", "-c", "pack.threads=2", "-c", "pack.window=0",
      "push", "origin", `HEAD:refs/heads/${branch}`);
    console.log(`BATCH ${round} PUSH_EXIT=0 SHA=${head}`);
    batch = []; bytes = 0;
  }
  for (const file of files) {
    const size = (await fs.stat(`${arg}/${file}`)).size;
    if (batch.length && bytes + size > 12 * 1024 * 1024) await publish();
    batch.push(file); bytes += size;
  }
  await publish();
} else if (mode === "verify") {
  const response = await fetch(url("publication-index.json"), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const { files } = await response.json(), checks = [], failures = [];
  let next = 0;
  await Promise.all(Array.from({ length: 5 }, async () => {
    while (next < files.length) {
      const file = files[next++];
      try {
        const result = await fetch(url(file.name), { signal: AbortSignal.timeout(60000) });
        const actual = hash(new Uint8Array(await result.arrayBuffer()));
        checks.push({ ...file, status: result.status, actual });
        if (result.status !== 200 || actual !== file.sha256) failures.push({ ...file, status: result.status, actual });
      } catch (error) { failures.push({ ...file, error: String(error) }); }
    }
  }));
  const pr = JSON.parse((await exec("gh", ["pr", "view", arg, "--repo", "kjg8619/Weavra", "--json",
    "body,headRefOid,baseRefName,baseRefOid,isDraft,url,state,title"], { maxBuffer: 8 << 20, timeout: 60000 })).stdout);
  assert.equal(pr.isDraft, false); assert.equal(pr.state, "OPEN");
  assert.equal(pr.title, "fix(web): complete Korean copy on audited work surfaces");
  assert.equal(pr.baseRefName, "hig/21-adaptive-chat");
  assert.equal(pr.headRefOid, (await json("after/capture/capture-manifest.json")).revision);
  assert.equal(pr.baseRefOid, (await json("before/capture/capture-manifest.json")).revision);
  const body = await fs.readFile(`${root}/publication-body.md`, "utf8");
  assert.equal(pr.body.trimEnd(), body.trimEnd());
  const gallery = await table();
  const documents = await Promise.all(files.filter((file) => file.file.endsWith(".md") && file.file !== "image-table.md")
    .map((file) => fs.readFile(`${root}/${file.file}`, "utf8")));
  const links = [...new Set([...(body + gallery + documents.join("\n")).matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((match) => match[1]))];
  const verified = new Set(checks.filter((check) => check.status === 200 && check.actual === check.sha256).map((check) => url(check.name)));
  for (const link of links.filter((link) => !verified.has(link))) {
    try {
      const result = await fetch(link, { signal: AbortSignal.timeout(30000) });
      await result.arrayBuffer(); checks.push({ url: link, status: result.status });
      if (result.status !== 200) failures.push({ url: link, status: result.status });
    } catch (error) { failures.push({ url: link, error: String(error) }); }
  }
  await fs.writeFile(`${root}/verify-links.json`, JSON.stringify({ pr, checked: files.length, links: links.length, checks, failures }, null, 2));
  console.log(`VERIFY files=${files.length} links=${links.length} failures=${failures.length} PR=${pr.url}`);
  process.exitCode = failures.length ? 1 : 0;
} else if (mode === "compact") {
  // observations.json exceeds GitHub's 100 MB file limit: publish it gzipped plus a small summary.
  for (const directory of ["measure-after", "measure-parent"]) {
    const bytes = await fs.readFile(`${root}/${directory}/observations.json`);
    const observations = JSON.parse(bytes);
    await fs.writeFile(`${root}/${directory}/observations.json.gz`, gzipSync(bytes, { level: 9 }));
    const { measurements, failures, rows, ...rest } = observations;
    await fs.writeFile(`${root}/${directory}/measure-summary.json`, JSON.stringify({
      ...rest, observationsSha256: hash(bytes), measurementCount: measurements?.length, failureCount: failures?.length,
    }, null, 2));
    console.log(`COMPACT ${directory} sha256=${hash(bytes)}`);
  }
} else throw new Error("Usage: compact | stage DIR | push DIR | verify PR");
