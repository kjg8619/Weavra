import { spawn, execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packet = dirname(fileURLToPath(import.meta.url));
const wt = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-02";
const parentWt = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01";
const runner = join(parentWt, "scripts/hig");
const git = (cwd) => execFileSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const head = git(wt);
const parent = git(parentWt);
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const results = [];
async function run(name, command) {
  const child = spawn(process.execPath, [join(packet, "run-command-02.mjs"), name, ...command], { stdio: "inherit" });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  results.push({ name, code });
  await fs.writeFile(join(packet, "hit-summary.json"), JSON.stringify({ head, parent, results }, null, 2));
  if (code !== 0) throw new Error(`${name}: exit ${code}`);
}
const shell = (command) => ["/bin/bash", "-lc", `source /tmp/hig02-env.sh; ${command}`];
const history = join(packet, "history-before-hit");
await fs.mkdir(history);
for (const name of ["after", "diff", "qa", "uploads", "supplemental-diff"]) {
  await fs.rename(join(packet, name), join(history, name));
}
await fs.rename(join(packet, "before/capture"), join(history, "before-capture"));
for (const name of ["attachment-map.json", "publication-body.md", "publication-index.json", "acceptance-verdict.json"]) {
  await fs.copyFile(join(packet, name), join(history, name));
}
await fs.copyFile(join(packet, "../pr-02.md"), join(history, "pr-02.md"));
await run("hit-build", shell(`cd ${quote(join(wt, "app/t3code"))}; T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false pnpm run dist:desktop:artifact --platform mac --target zip --arch arm64 --output-dir ${quote(join(packet, "after/package"))}`));
await run("hit-extract", ["/usr/bin/ditto", "-x", "-k", join(packet, "after/package/Weavra-0.0.42-arm64.zip"), join(packet, "after/app")]);
for (const [side, repo, revision, appRevision] of [
  ["before", parentWt, parent, "bb7649c97402d9a853f91b3a987f9fa48aa970eb"],
  ["after", wt, head, head],
]) {
  await run(`hit-${side}-capture`, shell(`WEAVRA_CAPTURE_REPO=${quote(repo)} WEAVRA_CAPTURE_APP=${quote(join(packet, side, "app/weavra-desktop.app"))} WEAVRA_CAPTURE_OUT=${quote(join(packet, side, "capture"))} bun ${quote(join(runner, "capture.mjs"))} --revision ${revision} --app-revision ${appRevision} --matrix ledger-plus --case 02`));
}
await run("hit-diff", shell(`bun ${quote(join(runner, "diff.mjs"))} --before ${quote(join(packet, "before/capture"))} --after ${quote(join(packet, "after/capture"))} --out ${quote(join(packet, "diff"))}`));
const environment = `WEAVRA_CAPTURE_REPO=${quote(wt)} WEAVRA_CAPTURE_APP=${quote(join(packet, "after/app/weavra-desktop.app"))}`;
await run("hit-measure", shell(`${environment} WEAVRA_MEASURE_OUT=${quote(join(packet, "qa"))} bun ${quote(join(packet, "measure-02.mjs"))}`));
await run("hit-motion", shell(`${environment} WEAVRA_MEASURE_OUT=${quote(join(packet, "qa/motion-clean"))} bun ${quote(join(packet, "motion-02.mjs"))}`));
await run("hit-accept-pr-02", shell(`accept_pr() { ${environment} bun ${quote(join(runner, "assert.mjs"))} --case "$1" --evidence ${quote(join(packet, "qa"))} || return; bun ${quote(join(runner, "assert.mjs"))} --verify-packet ${quote(packet)} || return; git -C ${quote(wt)} diff --check ${parent} ${head}; }; accept_pr 02`));
await run("hit-verify-packet", shell(`bun ${quote(join(runner, "assert.mjs"))} --verify-packet ${quote(packet)}`));
console.log(`HIT_PIPELINE_DONE ${JSON.stringify(results)}`);
