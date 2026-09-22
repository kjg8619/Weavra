#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporary = realpathSync(mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "wc-")));
for (const name of ["home", "tmp"]) mkdirSync(join(temporary, name), { mode: 0o700 });
try {
  const result = spawnSync(process.execPath, [
    join(root, "runtime/pi/node_modules/tsx/dist/cli.mjs"),
    "--tsconfig", join(root, "app/t3code/apps/web/tsconfig.json"),
    join(root, "scripts/capability-boundary-smoke.mjs"),
  ], {
    cwd: root, stdio: "inherit",
    env: {
      PATH: process.env.PATH, HOME: join(temporary, "home"), TMPDIR: join(temporary, "tmp"),
      WEAVRA_HOME: join(temporary, "home/.weavra"),
      T3_WEAVRA_EXECUTABLE: join(root, "runtime/pi/packages/company-runtime/bin/weavra"),
      ...(process.env.WEAVRA_BROKER_CAPTURE ? { WEAVRA_BROKER_CAPTURE: resolve(process.env.WEAVRA_BROKER_CAPTURE) } : {}),
      LANG: "C", LC_ALL: "C", TZ: "UTC", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0", PI_NO_LOCAL_LLM: "1", AWS_EC2_METADATA_DISABLED: "true",
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Capability boundary failed: ${result.status ?? result.signal}`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
