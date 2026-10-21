import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as fs from "node:fs/promises";
const exec = promisify(execFile);
const root = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19";
const visual = "/Users/kangjingoo/.bun/install/global/node_modules/omo-ai/plugin/skills/visual-qa/scripts/visual-qa.mjs";
const files = [
  "840x620/light/100-default.png",
  "840x620/light/100-other-focused.png",
  "840x620/dark/150-other-focused.png",
  "1920x1080/dark/100-other-focused.png",
];
const pairs = [];
for (const file of files) {
  const result = await exec("node", [
    visual, "image-diff", `${root}/measure-rule-a-original/${file}`,
    `${root}/measure-rule-a-after/${file}`,
  ], { maxBuffer: 16 << 20 });
  pairs.push({ file, result: JSON.parse(result.stdout) });
}
await fs.writeFile(`${root}/rule-a-paint-diff.json`, JSON.stringify({ pairs }, null, 2));
console.log(JSON.stringify(pairs.map(({ file, result }) => ({
  file, dimensionsMatch: result.dimensionsMatch, diffRatio: result.diffRatio,
  alphaChannelIntact: result.alphaChannelIntact,
}))));
