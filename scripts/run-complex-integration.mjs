#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Isolated HOME/TMPDIR/git config for the COMPLEX Runtime→App corpora; the scripted model listens on loopback only.
// Runs the sequential (V0.7B), parallel (V0.8A) and Planner (V0.8B) corpora by default; `complex`, `parallel` or
// `planner` selects one. WEAVRA_APP_ROOT, when set, points the harness at another checkout's App (split worktrees).
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const corpora = process.argv[2] ? [process.argv[2]] : ["complex", "parallel", "planner"];
for (const corpus of corpora) if (!["complex", "parallel", "planner"].includes(corpus)) throw new Error(`Unknown corpus: ${corpus}`);
// Darwin Unix sockets have a small path limit; canonical /private/tmp also avoids alias mismatches.
const temporary = realpathSync(mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "wc-")));
const home = join(temporary, "home");
const temp = join(temporary, "tmp");
mkdirSync(home, { mode: 0o700 });
mkdirSync(temp, { mode: 0o700 });
try {
  for (const corpus of corpora) {
    const result = spawnSync(process.execPath, [join(root, "runtime/pi/node_modules/tsx/dist/cli.mjs"), join(root, `scripts/${corpus}-integration.mjs`)], {
      cwd: root,
      stdio: "inherit",
      env: {
        PATH: process.env.PATH,
        HOME: home,
        TMPDIR: temp,
        WEAVRA_HOME: join(home, ".weavra"),
        T3_WEAVRA_EXECUTABLE: join(root, "runtime/pi/packages/company-runtime/bin/weavra"),
        ...(process.env.WEAVRA_APP_ROOT ? { WEAVRA_APP_ROOT: process.env.WEAVRA_APP_ROOT } : {}),
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
    if (result.status !== 0) throw new Error(`${corpus} integration corpus failed: ${result.status ?? result.signal}`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
