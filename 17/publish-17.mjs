// PR 12 publication convention: separate evidence branch, full image table, remote hash checks.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
const root = dirname(fileURLToPath(import.meta.url)), exec = promisify(execFile);
const repo = "kjg8619/Weavra";
const base = "https://github.com/kjg8619/Weavra/blob/hig-evidence/17/17";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const json = async (p) => JSON.parse(await fs.readFile(join(root, p), "utf8"));
const flat = (side, file) => `${side}--${file.replaceAll("/", "--")}`;
const url = (name) => `${base}/${name}?raw=true`;
const [mode, arg] = process.argv.slice(2);
async function index() {
  const pairs = [...(await json("diff/pairs.json")).pairs,
    ...(await json("supplemental/pairs.json")).pairs], images = [];
  for (const pair of pairs) {
    assert.equal(pair.result.dimensionsMatch, true, pair.file);
    assert.equal(pair.result.alphaChannelIntact, true, pair.file);
    for (const side of ["before", "after"]) {
      const source = pair.supplemental
        ? join(root, "supplemental", side, pair.file.replace(/^archives\//, ""))
        : join(root, side, "capture", pair.file);
      const bytes = await fs.readFile(source);
      assert.equal(sha(bytes), pair[`${side}Sha256`]);
      images.push({ category: "capture", side, file: pair.file, source,
        name: flat(side, pair.file), sha256: sha(bytes) });
    }
  }
  for (const check of (await json("qa/scenario-receipt.json")).checks)
    for (const a of check.artifacts.filter((a) => a.file.endsWith(".png"))) {
      const source = join(root, "qa", a.file), bytes = await fs.readFile(source);
      const file = a.file.replace(/^run-[^/]+\//, "");
      assert.equal(sha(bytes), a.sha256);
      images.push({ category: "scenario", file, source, name: flat("scenario", file), sha256: sha(bytes) });
    }
  for (const check of (await json("qa-round-01/scenario-receipt.json")).checks)
    for (const a of check.artifacts.filter((a) => a.file.endsWith(".png"))) {
      const source = join(root, "qa-round-01", a.file), bytes = await fs.readFile(source);
      const file = a.file.replace(/^run-[^/]+\//, "");
      assert.equal(sha(bytes), a.sha256);
      images.push({ category: "scenario-round-01", file, source,
        name: flat("scenario-round-01", file), sha256: sha(bytes) });
    }
  const measure = await json("measure/qa-measure.json");
  assert.equal(measure.failures.length, 0); assert.ok(!measure.error);
  for (const s of measure.screenshots) {
    const source = join(root, "measure", s.file), bytes = await fs.readFile(source);
    assert.equal(sha(bytes), s.sha256);
    images.push({ category: "measure", file: s.file, source, name: flat("measure", s.file), sha256: sha(bytes) });
  }
  return { pairs, images };
}
function gallery(pairs, images) {
  const rows = ["# HIG 17 complete image table", "",
    "| State | Before | After | Ratio / hotspots |", "|---|---|---|---|"];
  for (const p of pairs)
    rows.push(`| \`${p.file}\` | ![before](${url(flat("before", p.file))}) | ![after](${url(flat("after", p.file))}) | ${p.result.diffRatio} / ${p.result.hotspots.length} |`);
  rows.push("", "## Packaged scenarios and self-measurement", "", "| State | After |", "|---|---|");
  for (const i of images.filter((i) => i.category !== "capture"))
    rows.push(`| \`${i.category}/${i.file}\` | ![after](${url(i.name)}) |`);
  return rows.join("\n") + "\n";
}
if (mode === "stage") {
  const { pairs, images } = await index(), out = join(arg, "17");
  await fs.mkdir(out, { recursive: true });
  for (const i of images) await fs.copyFile(i.source, join(out, i.name));
  for (const f of ["diff/pairs.json", "qa/scenario-receipt.json", "measure/qa-measure.json",
    "draft-review.md", "rules-a-j.md", "diff-inspection.md",
    "after/capture/capture-manifest.json", "before/capture/capture-manifest.json", "acceptance-verdict.json",
    "pipeline-17-final.log", "carry-forward.md", "measure-summary.json",
    "logs/accept-scenarios-01.log", "logs/accept-scenarios-02.log",
    "logs/verify-packet-01.log", "logs/verify-packet-02.log",
    "logs/focused.log", "logs/fmt.log", "logs/lint.log", "logs/typecheck.log",
    "logs/build-before.log", "logs/build-after.log", "logs/measure.log", "logs/harness-tests.log",
    "source-checks.json", "supplemental/pairs.json", "supplemental/before/manifest.json", "supplemental/after/manifest.json",
    "qa-round-01/scenario-receipt.json", "repeat-01/pr-17/acceptance-verdict.json",
    "logs/parent-lint.log", "logs/accent-stripes.log", "tools/measure-17.mjs", "tools/preload-app-gate.mjs",
    "tools/gate.sh", "tools/summarize-measure.mjs", "tools/diff-archives.mjs", "pipeline-17.sh", "publish-17.mjs",
    "tools/measure-17-fix1.mjs", "pipeline-17-fix1.sh", "pipeline-17-fix1.log",
    "logs/measure-fix1.log", "logs/accept-fix1.log", "logs/verify-fix1.log"])
    await fs.copyFile(join(root, f), join(out, f.replaceAll("/", "--")));
  for (const round of ["qa", "qa-round-01"]) {
    const receipt = await json(`${round}/scenario-receipt.json`);
    await fs.copyFile(join(root, round, receipt.capture.file),
      join(out, `${round}--scenario-capture-manifest.json`));
  }
  await fs.copyFile(
    "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-17-fix1-measure/border-matrix.json",
    join(out, "fix1--border-matrix.json"));
  await fs.writeFile(join(out, "publication-index.json"),
    JSON.stringify({ images: images.map(({ source, ...i }) => i) }, null, 2));
  await fs.writeFile(join(out, "image-table.md"), gallery(pairs, images));
  console.log(`STAGED images=${images.length}`);
} else if (mode === "body") {
  const { pairs, images } = await index();
  const required = pairs.filter((p) => p.supplemental ||
    (p.file.split("/").at(-1).startsWith("27_") && !p.file.includes("electron")));
  const rows = ["## Before / after", "", "| State, size, theme | Before | After | Ratio / hotspots |",
    "|---|---|---|---|"];
  for (const p of required)
    rows.push(`| \`${p.file}\` | ![before](${url(flat("before", p.file))}) | ![after](${url(flat("after", p.file))}) | ${p.result.diffRatio} / ${p.result.hotspots.length} |`);
  rows.push("", `[Complete image table: every capture pair, scenario and a-j frame](${base}/image-table.md).`);
  const body = (await fs.readFile(join(root, "publication-head.md"), "utf8")).trimEnd() +
    "\n\n" + rows.join("\n") + "\n\n" + (await fs.readFile(join(root, "publication-tail.md"), "utf8")).trimEnd() + "\n";
  assert.ok(body.length < 65000);
  await fs.writeFile(join(root, "publication-body.md"), body);
  console.log(`BODY chars=${body.length} required=${required.length} images=${images.length}`);
} else if (mode === "verify") {
  const { pairs, images } = await index();
  const local = await fs.readFile(join(root, "publication-body.md"), "utf8");
  const remote = JSON.parse((await exec("gh", ["pr", "view", arg, "--repo", repo, "--json",
    "body,headRefOid,baseRefName,baseRefOid,isDraft,url"], { maxBuffer: 8 << 20 })).stdout);
  assert.equal(remote.body.trimEnd(), local.trimEnd());
  assert.equal(remote.baseRefName, "hig/16-connection-action");
  assert.equal(remote.isDraft, false);
  assert.equal(remote.baseRefOid, (await json("before/capture/capture-manifest.json")).revision);
  assert.equal(remote.headRefOid, (await json("after/capture/capture-manifest.json")).revision);
  const response = await fetch(url("image-table.md"), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const table = await response.text(); assert.equal(table, gallery(pairs, images));
  const linked = images.filter((i) => (remote.body + table).includes(url(i.name))), checks = [];
  assert.equal(linked.length, images.length);
  let next = 0;
  await Promise.all(Array.from({ length: 4 }, async () => {
    while (next < linked.length) {
      const i = linked[next++];
      try {
        const r = await fetch(url(i.name), { signal: AbortSignal.timeout(30000) });
        checks.push({ name: i.name, status: r.status, sha256: sha(new Uint8Array(await r.arrayBuffer())), expected: i.sha256 });
      } catch (error) { checks.push({ name: i.name, status: 0, error: String(error) }); }
    }
  }));
  const failures = checks.filter((c) => c.status !== 200 || c.sha256 !== c.expected);
  const imageUrls = new Set(images.map((i) => url(i.name)));
  const textUrls = [...new Set([...remote.body.matchAll(/\]\((https:\/\/[^)]+)\)/g)].map((m) => m[1]))]
    .filter((u) => !imageUrls.has(u));
  const textLinks = await Promise.all(textUrls.map(async (u) => {
    try { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); await r.arrayBuffer(); return { url: u, status: r.status }; }
    catch (error) { return { url: u, status: 0, error: String(error) }; }
  }));
  failures.push(...textLinks.filter((c) => c.status !== 200));
  await fs.writeFile(join(root, "publication-verification.json"),
    JSON.stringify({ head: remote.headRefOid, linked: linked.length, failures, checks, textLinks }, null, 2));
  console.log(`VERIFY ${remote.url} linked=${linked.length} failures=${failures.length}`);
  process.exitCode = failures.length ? 1 : 0;
} else throw new Error("Usage: bun publish-17.mjs stage DIR | body | verify PR");
