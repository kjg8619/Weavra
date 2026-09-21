import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, expect, it, vi } from "vitest";
import { attachHostBridgeStreams } from "../src/host-bridge.ts";
import { HostControlBridge } from "../src/host-control.ts";
import { HOST_CONTROL_MAX_REQUEST_BYTES, HOST_CONTROL_MAX_RESPONSE_BYTES } from "../src/host-control-protocol.ts";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

it("keeps a control connection usable when one bounded reply fills the pipe buffer", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "weavra-control-stream-"));
	const bridge = await HostControlBridge.create({
		cwd,
		projectTrusted: true,
		agentDir: join(cwd, "agent"),
		readiness: "NOT_SETUP",
	});
	const input = new PassThrough();
	const frames: string[] = [];
	let release: (() => void) | undefined;
	const output = new Writable({
		highWaterMark: 1,
		write(chunk, _encoding, callback) {
			frames.push(String(chunk));
			release = callback;
		},
	});
	cleanups.push(async () => {
		input.destroy();
		output.destroy();
		await bridge.shutdown();
		await rm(cwd, { recursive: true, force: true });
	});
	let closed = false;
	attachHostBridgeStreams(
		bridge,
		input,
		output,
		() => {
			closed = true;
		},
		{
			maxRequestBytes: HOST_CONTROL_MAX_REQUEST_BYTES,
			maxBufferedResponseBytes: HOST_CONTROL_MAX_RESPONSE_BYTES,
		},
	);
	input.write(`${JSON.stringify({ protocolVersion: 1, id: "hello", type: "control.hello" })}\n`);
	await vi.waitFor(() => expect(frames).toHaveLength(1));
	expect(closed).toBe(false);
	expect(JSON.parse(frames[0])).toMatchObject({ success: true, data: { kind: "capabilities" } });
	release?.();
	input.write(`${JSON.stringify({ protocolVersion: 1, id: "snapshot", type: "control.snapshot" })}\n`);
	await vi.waitFor(() => expect(frames).toHaveLength(2));
	expect(JSON.parse(frames[1])).toMatchObject({ success: true, data: { kind: "snapshot", state: { busy: false } } });
	expect(closed).toBe(false);
	release?.();
});

it("closes malformed UTF-8 input without turning replacement characters into a command", async () => {
	const cwd = await mkdtemp(join(tmpdir(), "weavra-control-utf8-"));
	const bridge = await HostControlBridge.create({
		cwd,
		projectTrusted: true,
		agentDir: join(cwd, "agent"),
		readiness: "NOT_SETUP",
	});
	const input = new PassThrough();
	const output = new PassThrough();
	cleanups.push(async () => {
		input.destroy();
		output.destroy();
		await bridge.shutdown();
		await rm(cwd, { recursive: true, force: true });
	});
	let closed = false;
	attachHostBridgeStreams(
		bridge,
		input,
		output,
		() => {
			closed = true;
		},
		{ maxRequestBytes: HOST_CONTROL_MAX_REQUEST_BYTES },
	);
	input.write(Buffer.from([123, 255, 125, 10]));
	await vi.waitFor(() => expect(closed).toBe(true));
	expect(output.read()).toBeNull();
});
