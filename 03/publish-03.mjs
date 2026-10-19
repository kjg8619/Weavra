// Builds the PR 03 publication index, uploads every image as a PR attachment,
// composes the reviewed body, and verifies the published body/URLs/hashes.
// Usage: bun publish-03.mjs index|upload|body|verify <pr-number>
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const root = dirname(fileURLToPath(import.meta.url));
const exec = promisify(execFile);
const gh = join(root, "../pr-02/tools/portable/gh_2.102.0_macOS_arm64/bin/gh");
const repo = "kjg8619/Weavra";
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readJson = async (p) => JSON.parse(await fs.readFile(join(root, p), "utf8"));
const [mode, pr] = process.argv.slice(2);

async function listPngs(dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true }))
    if (entry.isFile() && entry.name.endsWith(".png"))
      out.push(join(entry.parentPath ?? entry.path, entry.name).slice(dir.length + 1));
  return out.sort();
}

if (mode === "index") {
  const images = [];
  const uploads = join(root, "uploads");
  await fs.mkdir(uploads, { recursive: true });
  const add = async (side, category, base, file) => {
    const bytes = await fs.readFile(join(root, base, file));
    const name = `${side}--${category}--${file.replaceAll("/", "--")}`;
    await fs.copyFile(join(root, base, file), join(uploads, name));
    images.push({ side, category, file, sha256: sha(bytes), name, path: join(uploads, name), bytes: bytes.length });
  };
  const pairs = (await readJson("diff/pairs.json")).pairs;
  for (const pair of pairs) {
    await add("before", "capture", "before/capture", pair.file);
    await add("after", "capture", "after/capture", pair.file);
  }
  const supplemental = await listPngs(join(root, "supplemental/after"));
  assert.deepEqual(await listPngs(join(root, "supplemental/before")), supplemental);
  for (const file of supplemental) {
    await add("before", "supplemental", "supplemental/before", file);
    await add("after", "supplemental", "supplemental/after", file);
  }
  const receipt = await readJson("qa/scenario-receipt.json");
  for (const check of receipt.checks)
    for (const artifact of check.artifacts.filter((a) => a.file.endsWith(".png")))
      await add("after", "scenario", "qa", artifact.file);
  const after = await readJson("after/capture/capture-manifest.json");
  const before = await readJson("before/capture/capture-manifest.json");
  await fs.writeFile(join(root, "publication-index.json"), JSON.stringify({
    provenance: { before: { revision: before.revision, asarSha256: before.provenance?.asarSha256 },
      after: { revision: after.revision, asarSha256: after.provenance?.asarSha256 } },
    images,
  }, null, 2));
  console.log(`INDEX images=${images.length} pairs=${pairs.length} supplemental=${supplemental.length}`);
} else if (mode === "upload") {
  const index = await readJson("publication-index.json");
  const mapFile = join(root, "attachment-map.json");
  let map = {};
  try { map = JSON.parse(await fs.readFile(mapFile, "utf8")); } catch (e) { if (e.code !== "ENOENT") throw e; }
  const key = (i) => `${i.side}/${i.category}/${i.file}`;
  const pending = index.images.filter((i) => map[key(i)]?.sha256 !== i.sha256);
  for (let start = 0; start < pending.length; start += 50) {
    const batch = pending.slice(start, start + 50);
    let failure;
    try {
      await exec(gh, ["pr", "edit", pr, "--repo", repo, "--body", "Evidence image upload in progress; the reviewed body replaces this text.",
        ...batch.flatMap((i) => ["--attach", `${i.path}#${key(i)}`])], { maxBuffer: 8 * 1024 * 1024 });
    } catch (error) { failure = error; }
    const body = JSON.parse((await exec(gh, ["pr", "view", pr, "--repo", repo, "--json", "body"], { maxBuffer: 8 * 1024 * 1024 })).stdout).body;
    for (const m of body.matchAll(/!\[([^\]]+)\]\((https:\/\/github\.com\/user-attachments\/assets\/[^)]+)\)/g)) {
      const image = batch.find((i) => key(i) === m[1]);
      if (image) map[m[1]] = { url: m[2], sha256: image.sha256 };
    }
    await fs.writeFile(mapFile, JSON.stringify(map, null, 2));
    console.log(`UPLOADED ${start + batch.length}/${pending.length}`);
    if (failure) throw failure;
    for (const i of batch) assert.equal(map[key(i)]?.sha256, i.sha256, `Missing upload ${key(i)}`);
  }
  console.log("ATTACHMENTS_COMPLETE");
} else if (mode === "body") {
  const index = await readJson("publication-index.json");
  const map = await readJson("attachment-map.json");
  const url = (side, category, file) => {
    const a = map[`${side}/${category}/${file}`];
    const img = index.images.find((i) => i.side === side && i.category === category && i.file === file);
    assert.equal(a?.sha256, img?.sha256, `Unbound ${side}/${category}/${file}`);
    return a.url;
  };
  const head = await fs.readFile(join(root, "publication-head.md"), "utf8");
  const pairs = (await readJson("diff/pairs.json")).pairs;
  const rows = [
    "## Before / after", "",
    "Every primary capture pair (`diff/pairs.json`; Ratio / HS = diffRatio / hotspot count), then the todo-3 supplemental long-path/metadata pairs, then after-only scenario frames from accept round 02. Full hashes: publication-index.json and diff/pairs.json on hig-evidence/03.", "",
    "| State, size, theme, interaction | Before (parent build) | After (this build) | Ratio / HS |", "|---|---|---|---|",
  ];
  for (const p of pairs)
    rows.push(`| \`${p.file.replace(/\.png$/, "")}\` | ![B](${url("before", "capture", p.file)}) | ![A](${url("after", "capture", p.file)}) | ${p.result.diffRatio} / ${p.result.hotspots.length} |`);
  rows.push("", "### Supplemental todo-3 measurements (240-char path, preparation end, metadata)", "",
    "| State | Before | After |", "|---|---|---|");
  for (const f of new Set(index.images.filter((i) => i.category === "supplemental").map((i) => i.file)))
    rows.push(`| \`${f.replace(/\.png$/, "")}\` | ![B](${url("before", "supplemental", f)}) | ![A](${url("after", "supplemental", f)}) |`);
  rows.push("", "### Accepted case-03 scenarios (after build, round 02)", "", "| Scenario frame | After |", "|---|---|");
  for (const i of index.images.filter((i) => i.category === "scenario"))
    rows.push(`| \`${i.file.replace(/^run-[^/]+\/scenarios\//, "").replace(/\.png$/, "")}\` | ![A](${url("after", "scenario", i.file)}) |`);
  const tail = await fs.readFile(join(root, "publication-tail.md"), "utf8");
  const body = `${head.trimEnd()}\n\n${rows.join("\n")}\n\n${tail.trimEnd()}\n`;
  assert.ok(body.length < 65000, `Body too long: ${body.length}`);
  await fs.writeFile(join(root, "publication-body.md"), body);
  console.log(`BODY chars=${body.length} rows=${rows.length}`);
} else if (mode === "verify") {
  const local = await fs.readFile(join(root, "publication-body.md"), "utf8");
  const index = await readJson("publication-index.json");
  const map = await readJson("attachment-map.json");
  const remote = JSON.parse((await exec(gh, ["pr", "view", pr, "--repo", repo, "--json", "body,headRefOid,baseRefName"], { maxBuffer: 8 * 1024 * 1024 })).stdout);
  assert.equal(remote.body.trimEnd(), local.trimEnd(), "Published body differs from reviewed file");
  assert.equal(remote.headRefOid, index.provenance.after.revision);
  assert.equal(remote.baseRefName, "hig/02-foundations");
  const urls = new Map();
  for (const i of index.images) {
    const a = map[`${i.side}/${i.category}/${i.file}`];
    assert.equal(a?.sha256, i.sha256);
    assert.ok(remote.body.includes(a.url), `Missing image in body: ${i.name}`);
    urls.set(a.url, i.sha256);
  }
  const checks = [];
  const list = [...urls];
  let next = 0;
  // GitHub rate-limits anonymous attachment GETs (429); honor Retry-After with a bounded retry count.
  const get = async (u) => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(u, { redirect: "follow", signal: AbortSignal.timeout(20000) });
      if (r.status !== 429 || attempt >= 8) return r;
      await r.arrayBuffer();
      await Bun.sleep(1000 * Math.min(120, Number(r.headers.get("retry-after")) || 15 * 2 ** attempt));
    }
  };
  await Promise.all(Array.from({ length: 2 }, async () => {
    while (next < list.length) {
      const [u, expected] = list[next++];
      try {
        const r = await get(u);
        const bytes = new Uint8Array(await r.arrayBuffer());
        checks.push({ url: u, status: r.status, contentType: r.headers.get("content-type"), sha256: sha(bytes), expectedSha256: expected });
      } catch (error) { checks.push({ url: u, status: 0, error: String(error) }); }
    }
  }));
  const failures = checks.filter((c) => c.status !== 200 || !c.contentType?.startsWith("image/") || c.sha256 !== c.expectedSha256);
  await fs.writeFile(join(root, "publication-verification.json"), JSON.stringify({ head: remote.headRefOid, imageBindings: index.images.length, urls: list.length, failures, checks }, null, 2));
  console.log(`PUBLICATION_VERIFIED bindings=${index.images.length} urls=${list.length} failures=${failures.length}`);
  assert.equal(failures.length, 0);
} else throw new Error("Usage: publish-03.mjs index|upload|body|verify <pr>");
