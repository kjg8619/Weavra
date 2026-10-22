import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const exec = promisify(execFile);
const packet = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22";
const preload = fileURLToPath(import.meta.url);
await mkdir(`${packet}/logs`, { recursive: true });
if (!process.env.BUN_OPTIONS?.includes(preload))
  process.env.BUN_OPTIONS = `${process.env.BUN_OPTIONS ?? ""} --preload ${preload}`.trim();
const { _electron } = await import(
  "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs"
);
const key = Symbol.for("hig22.gated");
if (!_electron[key]) {
  const launch = _electron.launch.bind(_electron);
  _electron.launch = async (options) => {
    const gate = await exec("bash", [
      "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-19/tools/gate.sh",
    ], { timeout: 610000 });
    await appendFile(`${packet}/logs/evidence-apps.log`, `${gate.stdout}LAUNCH ${options.executablePath}\n`);
    const app = await launch(options);
    await app.evaluate(({ app, BrowserWindow }) => {
      app.setActivationPolicy("accessory");
      BrowserWindow.prototype.show = function () { this.showInactive(); };
      BrowserWindow.prototype.focus = function () {};
      app.focus = function () {};
    });
    const pid = app.process().pid;
    await appendFile(`${packet}/logs/evidence-apps.log`, `SPAWN pid=${pid}; inactive display, no OS pointer movement\n`);
    const { stdout } = await exec("ps", ["-axo", "pid,command"]);
    const competitors = stdout.split("\n").filter((line) =>
      /\/\.omo\/evidence\/.*\/MacOS\/weavra-desktop(?:\s|$)/.test(line) &&
      !line.includes(options.executablePath));
    if (competitors.length) {
      await app.close();
      throw new Error(`Concurrent evidence launch; closed only task 22 app: ${competitors.join("\n")}`);
    }
    app.once("close", () => {
      void appendFile(`${packet}/logs/evidence-apps.log`, `CLOSED pid=${pid}\n`);
    });
    return app;
  };
  _electron[key] = true;
}
