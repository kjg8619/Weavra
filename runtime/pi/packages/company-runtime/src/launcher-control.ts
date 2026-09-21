// Explicit trusted execution owner. Legacy launcher-bridge remains an observer-only process.
import { lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachHostBridgeStreams } from "./host-bridge.ts";
import { HostControlBridge } from "./host-control.ts";
import {
	HOST_CONTROL_MAX_REQUEST_BYTES,
	HOST_CONTROL_MAX_RESPONSE_BYTES,
	type HostControlCapabilities,
} from "./host-control-protocol.ts";
import { doctorWeavra, prepareLaunch, resolveWeavraHome } from "./launcher-home.ts";

try {
	if (process.argv.slice(2).join("\0") !== "--stdio\0--project-trusted\0--control")
		throw new Error("Invalid control invocation");
	const paths = await resolveWeavraHome(process.env);
	let readiness: HostControlCapabilities["readiness"] = "CONFIG_INVALID";
	let agentDir = paths.agentDir;
	try {
		const home = await lstat(paths.home).catch(() => undefined);
		const agent = await lstat(paths.agentDir).catch(() => undefined);
		if (!home || !agent) readiness = "NOT_SETUP";
		else {
			agentDir = await prepareLaunch(process.env);
			const checkout = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
			if ((await doctorWeavra(checkout, process.env, () => {})) === 0) readiness = "READY";
		}
	} catch {
		/* Advertise fixed readiness only; never raw paths, credentials or diagnostics. */
	}
	process.env.PI_CODING_AGENT_DIR = agentDir;
	delete process.env.PI_CODING_AGENT_SESSION_DIR;
	const bridge = await HostControlBridge.create({ cwd: process.cwd(), projectTrusted: true, agentDir, readiness });
	let closing = false;
	const shutdown = () => {
		if (closing) return;
		closing = true;
		void bridge
			.shutdown()
			.catch(() => {
				process.exitCode = 1;
			})
			.finally(() => {
				process.stdin.destroy();
				process.stdout.end();
			});
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
	attachHostBridgeStreams(bridge, process.stdin, process.stdout, shutdown, {
		maxRequestBytes: HOST_CONTROL_MAX_REQUEST_BYTES,
		maxBufferedResponseBytes: HOST_CONTROL_MAX_RESPONSE_BYTES,
	});
} catch {
	process.stderr.write("Weavra control unavailable; no Runtime action was performed.\n");
	process.exitCode = 1;
}
