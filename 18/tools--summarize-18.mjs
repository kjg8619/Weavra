import * as fs from "node:fs/promises";
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-18";
const report = JSON.parse(await fs.readFile(`${root}/measure-after/qa-measure.json`,"utf8"));
const computed = report.rows.filter(r=>r.kind==="computed");
const controls = computed.filter(r=>r.tag==="BUTTON"&&r.role!=="switch");
const icons = controls.filter(r=>r.iconOnly);
const text = computed.filter(r=>r.text||r.tag==="INPUT");
const summary = {
  revision:report.revision, asarSha256:report.asarSha256,
  scriptSha256:report.scriptSha256, nativeSample:report.screenshots[0]?.native,
  rows:report.rows.length, frames:report.screenshots.length,
  failures:report.failures.map(f=>({name:f.name,context:[f.theme,f.width,f.scale,f.state],target:f.row?.name,value:f.row?.icons,error:f.error})),
  error:report.error, cleanup:report.cleanup, counters:report.counters,
  minTextContrast:Math.min(...text.map(r=>r.contrast)),
  minIconContrast:Math.min(...controls.flatMap(r=>r.icons)),
  minExplanatorySize:Math.min(...computed.filter(r=>["P","LABEL"].includes(r.tag)).map(r=>r.fontSize)),
  minIconWidth:Math.min(...icons.map(r=>r.rect.width)), minIconHeight:Math.min(...icons.map(r=>r.rect.height)),
  minTextButtonHeight:Math.min(...controls.filter(r=>!r.iconOnly).map(r=>r.rect.height)),
  minFocusWidth:Math.min(...controls.filter(r=>r.focusVisible).map(r=>r.outline)),
  minFocusContrast:Math.min(...controls.filter(r=>r.focusVisible).map(r=>r.outlineContrast)),
  checks:Object.fromEntries([...new Set(report.rows.map(r=>r.check).filter(Boolean))].map(key=>[key,{
    total:report.rows.filter(r=>r.check===key).length,failed:report.rows.filter(r=>r.check===key&&!r.pass).length,
  }])),
};
await fs.writeFile(`${root}/measure-summary.json`,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary,null,2));
