import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec=promisify(execFile);
const root="/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19";
const json=async file=>JSON.parse(await fs.readFile(`${root}/${file}`,"utf8"));
const git=async(path,...args)=>(await exec("git",["-C",path,...args])).stdout.trim();
const before=await json("before/capture/capture-manifest.json");
const after=await json("after/capture/capture-manifest.json");
const measure=await json("measure-after/measurements.json");
const fix=JSON.parse(await fs.readFile(`${root}-fix1-measure/measurements.json`,"utf8"));
const labelBefore=await json("fix2/before/measurements.json");
const labelAfter=await json("fix2/after/measurements.json");
const rounds=await Promise.all(["fix2/qa-round-01","qa"].map(async name=>{
  const receipt=await json(`${name}/scenario-receipt.json`);
  return {name,revision:receipt.revision,checks:receipt.checks.map(c=>({caseId:c.caseId,checkId:c.checkId,status:c.status,assertions:c.assertions.length})),cleanup:receipt.cleanup,counters:receipt.counters};
}));
const status={
  parent:before.revision,head:after.revision,
  runner:"fa5e1dbcfb12fd51c5ac0d9dd0ca7a6e89f91c4a",
  parentAsar:before.provenance.asarSha256,headAsar:after.provenance.asarSha256,
  captures:{before:before.manifest.length,after:after.manifest.length,pairs:(await json("diff/pairs.json")).pairs.length,supplementalPairs:(await json("supplemental/pairs.json")).pairs.length},
  captureProvenance:{before:before.provenance,after:after.provenance},
  measure:{...measure.summary,revision:measure.revision,cleanup:measure.cleanup,counters:measure.counters},
  fix1:fix.summary,
  fix2:{before:labelBefore.summary,after:labelAfter.summary,baselineRevision:labelBefore.revision,revision:labelAfter.revision},
  acceptance:{rounds,verifier:await json("acceptance-verdict.json")},
  commandExits:{focused:0,fmt:0,lint:0,typecheck:0,buildAfter:0,koreanFocusMeasure:0,variantLabelBefore:1,variantLabelAfter:0,measureAfter:0,captureAfter:0,diff:0,supplementalDiff:0,acceptPr19Fix2Round01:0,acceptPr19Fix2Round02:0,verifyPacketFix2Round01:0,verifyPacketFix2Round02:0,diffCheck:0},
};
for(const round of rounds){
  if(round.revision!==after.revision||!round.cleanup.exited||round.checks.some(c=>c.status!=="PASS"))throw new Error(`Incomplete acceptance ${round.name}`);
}
if(status.acceptance.verifier.product!=="PASS"||measure.failures.length||fix.failures.length||fix.revision!==after.revision||fix.asarSha256!==after.provenance.asarSha256)throw new Error("Packet is not accepted");
if(labelBefore.rows.length!==24||labelBefore.failures.length!==12||labelAfter.rows.length!==24||labelAfter.failures.length||labelAfter.revision!==after.revision||labelAfter.asarSha256!==after.provenance.asarSha256)throw new Error("Variant label regression is not proven");
await fs.writeFile(`${root}/acceptance-status.json`,JSON.stringify(status,null,2));
const lines=[
  "# Todo 19 fresh self-measurement",
  "",
  `Head ${status.head}; runner ${status.runner}.`,
  `Parent app.asar ${status.parentAsar}; head app.asar ${status.headAsar}.`,
  `Fresh head measurement: ${measure.summary.rows} rows, ${measure.summary.screenshots} PNGs, zero failures.`,
  "Light/dark, 840x620 / 1280x800 / 1920x1080 CSS viewports, 100/150% text.",
  "Native outer/content/minimum rectangles accompany each screenshot; display clamping is not labelled as a larger native window.",
  "",
  "| Rule | Executed result |","|---|---|",
  `| a | PASS: ${measure.summary.checks["a/target"].total} targets >=36px; ${measure.summary.checks["a/five-point-hit"].total} five-point checks pass. |`,
  `| b | PASS: measured touched labels >=${measure.summary.minimumTextSize}px. |`,
  `| c | PASS: composited text contrast >=${measure.summary.minimumTextContrast.toFixed(5)}:1. |`,
  `| d | PASS: actual imported Korean title, ${fix.summary.koreanContexts} contexts; ${fix.summary.orphans} orphans and ${fix.summary.midWordBreaks} mid-word breaks. Character rectangles and per-word line membership are retained. |`,
  "| e | PASS: selection survives focus-only navigation; System light/dark/light stays selected; opening the editor preserves rendered palette. |",
  `| f | PASS: strict-fit, clipping and horizontal-overflow checks have zero failures; exactly one overflowing scroll owner in each measured pane. |`,
  `| g | PASS: ${fix.summary.focusContexts} Escape/Enter contexts restore the correct opener, keep the route and selection, disable hidden options and activate only the opener on Enter. Full IME/VoiceOver traversal remains Final-wave coverage. |`,
  `| h | PASS: control borders >=${measure.summary.minimumBorderContrast.toFixed(5)}:1, glyph checks >=3:1; visible focus >=2px and >=3:1. |`,
  "| i | PASS: no required-text ellipsis or clipping in measured controls. Optional identity/title disclosures outside these touched controls retain their existing behavior. |",
  "| j | PASS: sibling controls and every variant label text box vs preview/check badge have zero intersection area. New label fixture: 24 labels / 12 contexts; baseline 12 failures, head 0. |",
  "",
  "The imported synthetic theme is reached through Add theme and Theme JSON; no real profile or credential is used.",
  "The launcher uses showInactive and suppresses native activation while preserving renderer DOM focus; it does not exercise or claim native app-focus behavior.",
  "Two ps checks, a bounded competitor wait, a post-launch competitor check and owned app.close are recorded in logs/evidence-apps.log.",
  "The complete universal Q cross-product, 200% zoom, +40% authored copy, VoiceOver/IME and interrupted-motion sequences remain Final-wave checks under the approved amendment.",
  "Fix2 has two fresh accept_pr 19 and two fresh --verify-packet runs, all exit 0 on this revision. Both receipts are retained. The runner is pinned to the fa5e1dbc scripts already merged into hig-19, not the moving shared hig-01 worktree.",
];
await fs.writeFile(`${root}/rules-a-j.md`,lines.join("\n")+"\n");
console.log(`STATUS head=${status.head} checks=${rounds.map(r=>r.checks.length).join("/")} measurementFailures=${measure.failures.length}`);
