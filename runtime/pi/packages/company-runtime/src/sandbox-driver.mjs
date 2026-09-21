import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

// A dedicated process isolates SRT's singleton and cleanup from every other run.
// Only this driver writes the outer FD 3. The sandbox supervisor has a separate pipe.
const [settingsPath, executable, ...argv] = process.argv.slice(2);
let interrupted = false;
let child;
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => {
		interrupted = true;
		child?.kill(signal);
	});
}
let report;
try {
	const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
	if (process.platform === "linux") {
		// bwrap normally closes extra descriptors. Preserve exactly the supervisor report pipe;
		// sandbox-target closes it at the actual registered-program spawn boundary.
		const wrapper = join(dirname(settingsPath), "bwrap-outcome");
		writeFileSync(wrapper, '#!/bin/sh\nexec bwrap --preserve-fds 1 "$@"\n', { mode: 0o700, flag: "wx" });
		settings.bwrapPath = wrapper;
	}
	await SandboxManager.initialize(settings);
	const source = readFileSync(new URL("./sandbox-target.mjs", import.meta.url), "utf8");
	const command = [process.execPath, "--input-type=module", "-e", source, executable, ...argv]
		.map((argument) => `'${argument.replaceAll("'", "'\\''")}'`)
		.join(" ");
	const wrapped = await SandboxManager.wrapWithSandbox(command);
	if (interrupted) throw new Error("Cancelled before sandbox launch");
	let targetOutput = "";
	let targetBytes = 0;
	let streamFailed = false;
	child = spawn(wrapped, { shell: true, stdio: ["ignore", "inherit", "inherit", "pipe"] });
	const outcome = child.stdio[3];
	outcome.on("data", (chunk) => {
		targetBytes += chunk.length;
		if (targetBytes > 1024) {
			streamFailed = true;
			child.kill("SIGTERM");
		} else targetOutput += chunk.toString("utf8");
	});
	outcome.on("error", () => {
		streamFailed = true;
		child.kill("SIGTERM");
	});
	child.on("error", () => {
		streamFailed = true;
	});
	const boundary = await new Promise((resolve) => child.once("close", (exitCode, signal) => resolve({ exitCode, signal })));
	SandboxManager.cleanupAfterCommand();
	if (!interrupted && !streamFailed) report = { version: 1, boundary, target: JSON.parse(targetOutput) };
} catch {
	// A missing/invalid report is infrastructure failure, never a synthetic target exit.
} finally {
	try {
		await SandboxManager.reset();
	} catch {
		report = undefined;
	}
}
if (report && !interrupted) writeSync(3, JSON.stringify(report));
