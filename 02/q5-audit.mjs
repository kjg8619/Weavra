import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(fileURLToPath(import.meta.url));
const old = JSON.parse(await fs.readFile(join(root, "history-before-q5/after/capture/capture-manifest.json"), "utf8"));
const after = JSON.parse(await fs.readFile(join(root, "after/capture/capture-manifest.json"), "utf8"));
const observations = [];
const inventory = new Map();
const regressions = [];
const intersect = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
const hit = (c) => c.visible && c.hits.length === 5 && c.hits.every(Boolean);
for (const row of after.manifest) {
  const previous = old.manifest.find((r) => r.file === row.file);
  const touched = row.controls.filter((c) => c.visible && c.iconControl);
  for (let i = 0; i < touched.length; i++) for (let j = i + 1; j < touched.length; j++) {
    const area = intersect(touched[i].rect, touched[j].rect);
    assert(area <= 0.5, `${row.file}: touched targets overlap, including disabled: ${touched[i].name}/${touched[j].name}`);
  }
  for (const c of row.controls.filter((c) => c.visible && c.iconControl)) {
    assert(c.rect.width >= 36 && c.rect.height >= 36, `${row.file}: ${c.name}`);
    const prior = previous?.controls.find((p) => p.name === c.name && p.visible);
    const item = inventory.get(c.name) ?? { name: c.name, before: [], after: [], files: [], disabled: false };
    const size = `${c.rect.width}x${c.rect.height}`;
    if (!item.after.includes(size)) item.after.push(size);
    const before = prior && `${prior.rect.width}x${prior.rect.height}`;
    if (before && !item.before.includes(before)) item.before.push(before);
    item.files.push(row.file);
    item.disabled ||= c.disabled;
    inventory.set(c.name, item);
    if (hit(c)) for (const sibling of row.controls.filter(hit)) {
      if (c === sibling) continue;
      const area = intersect(c.rect, sibling.rect);
      const oldSibling = previous?.controls.find((p) => p.name === sibling.name && p.visible);
      const previousArea = prior && oldSibling ? intersect(prior.rect, oldSibling.rect) : 0;
      if (area > previousArea + 0.5) regressions.push({ file: row.file, control: c.name, sibling: sibling.name, area, previousArea });
    }
  }
}
const receipt = JSON.parse(await fs.readFile(join(root, "qa/scenario-receipt.json"), "utf8"));
for (const check of receipt.checks) {
  for (const artifact of check.artifacts.filter((a) => a.file.endsWith("observations.json"))) {
    const data = JSON.parse(await fs.readFile(join(root, "qa", artifact.file), "utf8"));
    observations.push({ check: check.checkId, data });
    for (const sample of data.observations.filter((s) => s.label?.endsWith(": icon targets"))) {
      for (const c of sample.result) {
        assert(c.rect.width >= 36 && c.rect.height >= 36, `${sample.label}: ${c.name}`);
        const item = inventory.get(c.name) ?? { name: c.name, before: [], after: [], files: [], disabled: false };
        const size = `${c.rect.width}x${c.rect.height}`;
        if (!item.after.includes(size)) item.after.push(size);
        item.files.push(`scenario/${check.checkId}/${sample.label}`);
        item.disabled ||= c.disabled;
        inventory.set(c.name, item);
      }
    }
  }
}
const result = { revision: after.revision, asarSha256: after.provenance.asarSha256,
  controls: [...inventory.values()], overlapRegressions: regressions, observations,
  scope: "Native icon buttons in todo-2 owned components and shared close/toolbar consumers. Text buttons, media thumbnails, resize rails, and controls implemented exclusively in unmodified components are not icon-control changes.",
};
await fs.writeFile(join(root, "q5-controls.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({ controls: result.controls, overlapRegressions: regressions }, null, 2));
assert.equal(regressions.length, 0, "New overlap involving a touched hit target");
