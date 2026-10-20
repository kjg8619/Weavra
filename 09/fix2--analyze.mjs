import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("./", import.meta.url);
const cells = JSON.parse(await fs.readFile(new URL("measure/sheet.json", root), "utf8"));
assert.equal(cells.length, 24);
const table = [];
for (const [width,height] of [[840,620],[1280,800],[1920,1080]]) {
  for (const scale of [1,1.5]) {
    const group = cells.filter(c => c.width === width && c.height === height && c.scale === scale);
    assert.equal(group.length,4);
    const all = group.flatMap(c => c.perRow);
    const overflow = group.filter(c => c.top.scroll.scrollHeight > c.top.scroll.clientHeight);
    const fit = group.filter(c => c.fitComparison.fits);
    table.push({
      size:`${width}x${height}`, text:`${scale*100}%`, cells:group.length,
      rows:all.length, fullyVisibleRows:all.filter(r=>r.fullyVisible).length,
      hitPoints:all.flatMap(r=>r.hits).length,
      passedHitPoints:all.flatMap(r=>r.hits).filter(Boolean).length,
      firstAtZero:group.every(c=>c.top.scroll.scrollTop===0 && c.top.rows[0].fullyVisible),
      overflowCells:overflow.length,
      scrollMaximum:[...new Set(group.map(c=>c.end.scroll.scrollTop))],
      firstRowTop:[...new Set(group.map(c=>c.top.rows[0].rect.top))],
      scrollportTop:[...new Set(group.map(c=>c.top.scroll.top))],
      fitCells:fit.length,
      fitGeometryUnchanged:fit.every(c=>Object.values(c.fitComparison.delta).every(v=>Math.abs(v)<.01)),
      originalCentringFirstRowClipped:group.filter(c=>!c.fitComparison.originalFirst.fullyVisible).length,
    });
  }
}
assert(table.every(g=>g.rows===g.fullyVisibleRows && g.hitPoints===g.passedHitPoints && g.firstAtZero && g.fitGeometryUnchanged));
const asar = await fs.readFile(new URL("../pr-09/after/app/weavra-desktop.app/Contents/Resources/app.asar",root));
const summary = {
  head:"de4f90da2065bd78c8bd89cfdff8390eea702c20",
  asarSha256:createHash("sha256").update(asar).digest("hex"),
  scriptSha256:createHash("sha256").update(await fs.readFile(new URL("sheet-probe.mjs",root))).digest("hex"),
  dataSha256:createHash("sha256").update(await fs.readFile(new URL("measure/sheet.json",root))).digest("hex"),
  cells:cells.length, rows:cells.flatMap(c=>c.perRow).length,
  passed:true, table,
};
await fs.writeFile(new URL("summary.json",root),JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
