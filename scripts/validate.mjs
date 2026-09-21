#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scope = process.argv[2];
if (scope !== "pi" && scope !== "t3") throw new Error("Usage: node scripts/validate.mjs pi|t3");
// Darwin Unix sockets have a small path limit; canonical /private/tmp also avoids alias mismatches.
const temporary = realpathSync(mkdtempSync(join(process.platform === "darwin" ? "/tmp" : tmpdir(), "wv-")));
const home = join(temporary, "home");
const temp = join(temporary, "tmp");
mkdirSync(home);
mkdirSync(temp);
writeFileSync(join(temporary, "npmrc"), "");
const env = {
  PATH: process.env.PATH,
  HOME: home,
  USERPROFILE: home,
  TMPDIR: temp,
  TMP: temp,
  TEMP: temp,
  XDG_CONFIG_HOME: join(home, ".config"),
  XDG_CACHE_HOME: join(home, ".cache"),
  LANG: "C",
  LC_ALL: "C",
  TZ: "UTC",
  CI: "1",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_EDITOR: "true",
  GIT_SEQUENCE_EDITOR: "true",
  NPM_CONFIG_USERCONFIG: join(temporary, "npmrc"),
  NPM_CONFIG_CACHE: join(temporary, "npm-cache"),
  PI_NO_LOCAL_LLM: "1",
  AWS_EC2_METADATA_DISABLED: "true",
};
const cwd = join(root, scope === "pi" ? "runtime/pi" : "app/t3code");
const commands = scope === "pi" ? [
  ["npm", "run", "check"],
  ["npm", "run", "check:ci"],
  ["npm", "run", "check:shrinkwrap"],
  ["npm", "run", "check:install-lock:coding-agent"],
  ["node", "--test", "../../scripts/product-independence.test.mjs"],
  ["npm", "test"],
  ["bash", "./test.sh"],
  ["bash", "-n", "packages/company-runtime/bin/weavra"],
  ["git", "diff", "--check"],
] : [
  ["pnpm", "exec", "vp", "run", "-r", "--concurrency-limit", "1", "test"],
  ["pnpm", "--filter", "@t3tools/contracts", "exec", "vp", "test", "run", "src/weavraControl.test.ts", "src/weavra.test.ts"],
  ["pnpm", "--filter", "t3", "exec", "vp", "test", "run", "src/weavra/RuntimeController.test.ts", "src/weavra/ControlTransport.test.ts"],
  ["pnpm", "--filter", "@t3tools/client-runtime", "exec", "vp", "test", "run", "src/state/weavraControl.test.ts", "src/state/weavra.test.ts"],
  ["pnpm", "--filter", "@t3tools/web", "exec", "vp", "test", "run", "src/components/settings/WeavraControls.test.tsx", "src/confirmDialog.test.ts"],
  ["pnpm", "typecheck"],
  ["pnpm", "lint"],
  ["pnpm", "fmt:check"],
  ["pnpm", "knip:check"],
  ["pnpm", "build"],
  ["git", "diff", "--check"],
];
try {
  for (const [command, ...args] of commands) {
    console.log(`\nVALIDATE ${scope}: ${command} ${args.join(" ")}`);
    const result = spawnSync(command, args, { cwd, env, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.status ?? result.signal}`);
  }
  console.log(`VALIDATE ${scope}: ALL GATES PASS`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
