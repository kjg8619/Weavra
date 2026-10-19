import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";

const root = dirname(fileURLToPath(import.meta.url));
const [name, ...command] = process.argv.slice(2);
if (!name || !/^[a-z0-9-]+$/.test(name) || !command.length)
  throw new Error("Usage: run-command.mjs NAME EXECUTABLE [ARGS...]");
await fs.mkdir(join(root, "commands"), { recursive: true });
const log = join(root, "commands", `${name}.log`);
const stream = createWriteStream(log, { flags: "wx" });
const completeLog = finished(stream);
const startedAt = new Date().toISOString();
console.log(`START ${name}: ${JSON.stringify(command)}`);
const child = spawn(command[0], command.slice(1), {
  cwd: "/Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-03",
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
});
for (const output of [child.stdout, child.stderr])
  output.on("data", (bytes) => {
    stream.write(bytes);
    process.stdout.write(bytes);
  });
const result = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", (code, signal) => resolve({ code, signal }));
});
stream.end();
await completeLog;
await fs.writeFile(join(root, "commands", `${name}.json`), JSON.stringify({
  name, command, startedAt, completedAt: new Date().toISOString(), log, ...result,
}, null, 2));
console.log(`RESULT ${name} exit=${result.code} signal=${result.signal}`);
process.exitCode = result.code ?? 1;
