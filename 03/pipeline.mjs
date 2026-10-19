import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const wt = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-03";
const qa = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/scripts/hig";
const before = "54df7a601c8715d48f9d09a0b3e023de392c7e45";
const branch = "hig/03-runtime-truth";
const files = ["WeavraControls.tsx", "WeavraSettings.tsx", "CapabilityInventory.tsx", "WeavraControls.test.tsx", "WeavraSettings.test.tsx"].map((f) => "apps/web/src/components/settings/" + f).concat("apps/web/src/components/onboarding/WelcomeWizard.tsx").join(" ");
const results = [];
const run = async (name, args, extraEnv = {}) => {
  const child = spawn("bun", [join(root, "run-command.mjs"), name, ...args], { cwd: wt, env: { ...process.env, ...extraEnv }, stdio: "inherit" });
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  results.push({ name, code });
  await fs.writeFile(join(root, "pipeline-summary.json"), JSON.stringify({ before, results }, null, 2));
  if (code !== 0) throw new Error(`${name} exited ${code}`);
};
const head = async () => {
  const p = spawn("git", ["rev-parse", "HEAD"], { cwd: wt, stdio: ["ignore", "pipe", "inherit"] });
  let out = ""; for await (const b of p.stdout) out += b; return out.trim();
};
async function build(side) {
  const destination = join(root, side);
  await fs.mkdir(join(destination, "package"), { recursive: true });
  await fs.mkdir(join(destination, "app"), { recursive: true });
  await run(`build-${side}`, ["bash", "-c", `cd app/t3code && T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false pnpm run dist:desktop:artifact --platform mac --target zip --arch arm64 --output-dir '${destination}/package'`]);
  const archives = (await fs.readdir(join(destination, "package"))).filter((f) => f.endsWith("-arm64.zip"));
  if (archives.length !== 1) throw new Error(`Expected one ZIP: ${archives}`);
  await run(`extract-${side}`, ["/usr/bin/ditto", "-x", "-k", join(destination, "package", archives[0]), join(destination, "app")]);
  const apps = (await fs.readdir(join(destination, "app"))).filter((f) => f.endsWith(".app"));
  if (apps.length !== 1) throw new Error(`Expected one app: ${apps}`);
  return join(destination, "app", apps[0]);
}
const capture = (side, app, revision) => run(`capture-${side}`, ["bun", join(qa, "capture.mjs"), "--revision", revision, "--matrix", "ledger-plus", "--case", "03"], { WEAVRA_CAPTURE_REPO: wt, WEAVRA_CAPTURE_APP: app, WEAVRA_CAPTURE_OUT: join(root, side, "capture") });

const after = await head();
await run("focused-tests", ["bash", "-c", "cd app/t3code/apps/web && pnpm exec vp test run --project unit src/components/settings/WeavraControls.test.tsx src/components/settings/CapabilityInventory.test.tsx src/components/settings/WeavraSettings.test.tsx"]);
await run("format", ["bash", "-c", `cd app/t3code && pnpm exec vp fmt --check ${files}`]);
await run("lint", ["bash", "-c", `cd app/t3code && pnpm exec vp lint ${files}`]);
await run("typecheck", ["bash", "-c", "cd app/t3code && pnpm --filter @t3tools/web typecheck"]);
await run("switch-parent", ["git", "switch", "--detach", before]);
try {
  const app = await build("before");
  await capture("before", app, before);
} finally {
  await run("restore-head", ["git", "switch", branch]);
}
if ((await head()) !== after) throw new Error("head moved");
const app = await build("after");
await capture("after", app, after);
await run("diff", ["bun", join(qa, "diff.mjs"), "--before", join(root, "before/capture"), "--after", join(root, "after/capture"), "--out", join(root, "diff")]);
await run("supplemental-before", ["bun", join(root, "measure-runtime.mjs"), "before"]);
await run("supplemental-after", ["bun", join(root, "measure-runtime.mjs"), "after"]);
const env = { WEAVRA_CAPTURE_REPO: wt, WEAVRA_CAPTURE_APP: app };
for (const round of ["01", "02"]) {
  await run(`accept-scenarios-${round}`, ["bun", join(qa, "assert.mjs"), "--case", "03", "--evidence", join(root, "qa")], env);
  await run(`accept-packet-${round}`, ["bun", join(qa, "assert.mjs"), "--verify-packet", root]);
  await run(`diff-check-${round}`, ["git", "diff", "--check", before, after]);
  await run(`verify-packet-${round}`, ["bun", join(qa, "assert.mjs"), "--verify-packet", root]);
  if (round === "01") {
    const archive = join(root, "repeat-01/pr-03");
    await fs.mkdir(archive, { recursive: true });
    for (const name of ["before/capture", "after/capture", "diff", "qa"]) await fs.cp(join(root, name), join(archive, name), { recursive: true });
    await fs.copyFile(join(root, "acceptance-verdict.json"), join(archive, "acceptance-verdict.json"));
  }
}
console.log(`PIPELINE_DONE ${JSON.stringify(results)}`);
