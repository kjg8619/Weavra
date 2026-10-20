import { execFileSync } from "node:child_process";
import path from "node:path";
const target = process.argv[2];
const runner = path.resolve(path.dirname(target), "../..");
const { _electron } = await import(`${runner}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
const launch = _electron.launch.bind(_electron);
const list = () => execFileSync("ps", ["-ww", "-axo", "pid=,command="], { encoding: "utf8" })
  .split("\n").filter((s) => /^\s*\d+\s+\/Users\//.test(s) && s.includes("/.omo/evidence/") && s.includes("/weavra-desktop.app/Contents/"));
_electron.launch = async (...args) => {
  const deadline = Date.now() + 300000;
  while (list().length) {
    if (Date.now() >= deadline) throw Error(`Evidence app gate timed out: ${list().join("\n")}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log("GATE_CLEAR");
  if (list().length) throw Error(`Immediate prelaunch recheck failed: ${list().join("\n")}`);
  console.log("GATE_RECHECK_ZERO");
  const app = await launch(...args);
  const firstWindow = app.firstWindow.bind(app);
  app.firstWindow = async (...windowArgs) => {
    const page = await firstWindow(...windowArgs);
    const evaluate = page.evaluate.bind(page);
    page.evaluate = async (...evaluateArgs) => {
      try {
        return await evaluate(...evaluateArgs);
      } catch (error) {
        const retry = page.getByRole("button", { name: "Try again", exact: true });
        if (!String(error).includes("Readiness timeout: body") || !await retry.isVisible() ||
            !await page.getByText("Primary environment request failed during fetch-session-state (HTTP 500).", { exact: true }).isVisible()) throw error;
        await page.screenshot({ path: `/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-10-fix1-measure/logs/startup-recovery-${Date.now()}.png` });
        console.log("STARTUP_RECOVERY observed fetch-session-state HTTP 500; clicking the actual Try again control");
        await retry.click();
        return evaluate(...evaluateArgs);
      }
    };
    return page;
  };
  return app;
};
// runCases spawns process.execPath. Route that child through this same launch
// guard without patching or changing the shared runner's assertions.
if (target.endsWith("/assert.mjs") && process.argv.includes("--case")) {
  process.execPath = path.join(import.meta.dirname, "bun-guard");
}
process.argv.splice(2, 1);
process.argv[1] = target;
await import(target);
