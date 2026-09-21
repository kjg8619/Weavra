// Dedicated observer process. Never imports Pi, opens a writer, recovers a Run or starts workers.
import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachHostBridgeStreams, ReadOnlyHostBridge } from "./host-bridge.ts";
import type { HostBridgeCapabilities } from "./host-bridge-protocol.ts";
import { doctorWeavra, resolveWeavraHome } from "./launcher-home.ts";

try {
	if (process.argv.slice(2).join("\0") !== "--stdio\0--project-trusted") throw new Error("Invalid bridge invocation");
	let readiness: HostBridgeCapabilities["readiness"] = "CONFIG_INVALID";
	try {
		const paths = await resolveWeavraHome();
		const parents = await Promise.all(
			[paths.home, paths.agentDir].map((path) =>
				lstat(path).catch((error: NodeJS.ErrnoException) => {
					if (error.code === "ENOENT") return undefined;
					throw error;
				}),
			),
		);
		if (parents.some((parent) => parent === undefined)) readiness = "NOT_SETUP";
		else if (
			(await doctorWeavra(resolve(dirname(fileURLToPath(import.meta.url)), "../../.."), process.env, () => {})) === 0
		)
			readiness = "READY";
	} catch {
		// Fixed enum only: no config paths, credential bytes or doctor diagnostics on either wire.
	}
	const bridge = new ReadOnlyHostBridge({
		cwd: process.cwd(),
		projectTrusted: true,
		handshake: { transport: "stdio", observationMode: "snapshots-only", readiness },
	});
	attachHostBridgeStreams(bridge, process.stdin, process.stdout, () => {
		bridge.close();
		process.stdin.destroy();
		// Flush the last response on EOF; no process.exit() and no ownership outside these streams.
		process.stdout.end();
	});
} catch {
	process.stderr.write("Weavra bridge unavailable; no Runtime action was performed.\n");
	process.exitCode = 1;
}
