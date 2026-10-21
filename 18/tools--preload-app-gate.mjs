import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const exec = promisify(execFile);
const pk = "/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-18";
const preload = fileURLToPath(import.meta.url);
if (!process.env.BUN_OPTIONS?.includes(preload))
  process.env.BUN_OPTIONS = `${process.env.BUN_OPTIONS ?? ""} --preload ${preload}`.trim();
for (const wt of [
  "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-01",
  "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-18",
  "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-18-before",
]) {
  const { _electron } = await import(`${wt}/app/t3code/apps/desktop/node_modules/playwright-core/index.mjs`);
  const key = Symbol.for("hig18.gated");
  if (_electron[key]) continue;
  const launch = _electron.launch.bind(_electron);
  _electron.launch = async (options) => {
    const gate = await exec("bash", [`${pk}/tools/gate.sh`], { timeout: 610000 });
    await appendFile(`${pk}/logs/evidence-apps.log`, `${gate.stdout}LAUNCH ${options.executablePath}\n`);
    const app = await launch(options);
    const pid = app.process().pid;
    await appendFile(`${pk}/logs/evidence-apps.log`, `SPAWN pid=${pid}\n`);
    const { stdout } = await exec("ps", ["-axo", "pid,command"]);
    const competitors = stdout.split("\n").filter((line) =>
      /\/\.omo\/evidence\/.*\/MacOS\/weavra-desktop(?:\s|$)/.test(line) &&
      !line.includes(options.executablePath));
    if (competitors.length) {
      await app.close();
      throw new Error(`Concurrent evidence launch; closed only task 18 app: ${competitors.join("\n")}`);
    }
    app.once("close", () => { void appendFile(`${pk}/logs/evidence-apps.log`, `CLOSED pid=${pid}\n`); });
    return app;
  };
  _electron[key] = true;
}
