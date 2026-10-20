import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-17";
const report = JSON.parse(await fs.readFile(`${root}/measure/qa-measure.json`, "utf8"));
assert.equal(report.failures.length, 0);
assert.ok(!report.error);
const controls = report.rows.filter((row) => row.kind === "control");
const text = report.rows.filter((row) => row.kind === "text");
const geometry = report.rows.filter((row) => row.kind === "geometry");
const focus = controls.filter((row) => row.focusVisible);
const returns = report.rows.filter((row) => row.kind === "return-context");
const escapes = report.rows.filter((row) => row.kind === "escape-focus");
const topmost = report.rows.filter((row) => row.kind === "escape-topmost");
const summary = {
  asarSha256: report.asarSha256,
  rows: report.rows.length,
  screenshots: report.screenshots.length,
  failures: report.failures,
  counters: report.counters,
  minimumTargetWidth: Math.min(...controls.map((row) => row.rect.width)),
  minimumTargetHeight: Math.min(...controls.map((row) => row.rect.height)),
  minimumTextSize: Math.min(...text.map((row) => row.fontSize)),
  minimumTextContrast: Math.min(...[...controls, ...text].map((row) => row.contrast)),
  minimumFocusContrast: Math.min(...focus.map((row) => row.ringContrast)),
  minimumFocusWidth: Math.min(...focus.map((row) => row.outlineWidth)),
  hitMisses: controls.flatMap((row) => row.hits).filter((hit) => !hit).length,
  overlaps: geometry.flatMap((row) => row.overlaps).length,
  orphanOrMidWord: text.filter((row) => row.orphan || row.midWord).length,
  clippedRequiredText: [...controls, ...text].filter((row) =>
    row.textOverflow === "ellipsis" || row.scrollWidth > row.clientWidth + 0.5).length,
  unwantedExternalIntersections: geometry.flatMap((row) => row.external).filter((row) => row.area > 0.5).length,
  contextReturns: returns.length,
  escapeReturns: escapes.length,
  topmostDismissals: topmost.length,
};
assert.equal(summary.contextReturns, 12);
assert.equal(summary.escapeReturns, 24);
assert.ok(escapes.every((row) => row.returned));
await fs.writeFile(`${root}/measure-summary.json`, JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
