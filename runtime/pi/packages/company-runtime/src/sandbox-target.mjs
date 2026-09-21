import { spawn } from "node:child_process";
import { writeSync } from "node:fs";

// FD 3 belongs to this Host-owned supervisor. The registered target inherits only stdio 0–2.
// Neither target stdout/stderr nor a shell exit code is an outcome report.
let spawnFailed = false;
try {
	const child = spawn(process.argv[1], process.argv.slice(2), {
		shell: false,
		stdio: ["ignore", "inherit", "inherit"],
	});
	child.once("error", () => {
		spawnFailed = true;
	});
	child.once("close", (exitCode, signal) => {
		writeSync(3, JSON.stringify({ version: 1, kind: spawnFailed ? "unavailable" : signal ? "signal" : "exited", exitCode, signal }));
	});
} catch {
	writeSync(3, JSON.stringify({ version: 1, kind: "unavailable", exitCode: null, signal: null }));
}
