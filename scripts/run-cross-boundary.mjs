#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.env.WEAVRA_CHROMIUM) throw new Error("Set WEAVRA_CHROMIUM to an actual Chromium executable");
const temporary = realpathSync(mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "wx-")));
const home = join(temporary, "home");
const temp = join(temporary, "tmp");
mkdirSync(home, { mode: 0o700 });
mkdirSync(temp, { mode: 0o700 });
try {
  const result = spawnSync(process.execPath, [join(root, "runtime/pi/node_modules/tsx/dist/cli.mjs"), join(root, "scripts/cross-boundary-smoke.mjs")], {
    cwd: root,
    stdio: "inherit",
    env: {
      PATH: process.env.PATH,
      HOME: home,
      TMPDIR: temp,
      WEAVRA_HOME: join(home, ".weavra"),
      WEAVRA_CHROMIUM: realpathSync(process.env.WEAVRA_CHROMIUM),
      T3_WEAVRA_EXECUTABLE: join(root, "runtime/pi/packages/company-runtime/bin/weavra"),
      LANG: "C",
      LC_ALL: "C",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      PI_NO_LOCAL_LLM: "1",
      AWS_EC2_METADATA_DISABLED: "true",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Cross-boundary smoke failed: ${result.status ?? result.signal}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
