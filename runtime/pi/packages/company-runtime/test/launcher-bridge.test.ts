import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { HostBridgeResponse } from "../src/host-bridge-protocol.ts";
import { implementingGraphRun } from "./graph-fixtures.ts";

const launcher = fileURLToPath(new URL("../bin/weavra", import.meta.url));
let root: string;
let project: string;
let env: NodeJS.ProcessEnv;
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "weavra-bridge-process-"));
	project = join(root, "project with spaces");
	await mkdir(project);
	env = {
		PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
		HOME: root,
		WEAVRA_HOME: join(root, "private-home"),
	};
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
const hello = JSON.stringify({
	protocolVersion: 1,
	id: "hello",
	type: "hello",
	clientName: "t3code",
	capabilities: ["snapshots-only"],
});
const snapshot = JSON.stringify({ protocolVersion: 1, id: "snapshot", type: "snapshot" });

it("serves exact standalone argv and drains EOF without creating a product home, session or Runtime state", async () => {
	const result = spawnSync(launcher, ["bridge", "--stdio", "--project-trusted"], {
		cwd: project,
		env,
		input: `${hello}\r\n${snapshot}`,
		encoding: "utf8",
		timeout: 10000,
		maxBuffer: 131072,
	});
	expect(result.status).toBe(0);
	expect(result.stderr).toBe("");
	const responses = result.stdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(responses).toEqual([
		expect.objectContaining({
			id: "hello",
			success: true,
			data: expect.objectContaining({
				transport: "stdio",
				observationMode: "snapshots-only",
				readiness: "NOT_SETUP",
				readOnly: true,
			}),
		}),
		expect.objectContaining({
			id: "snapshot",
			success: true,
			data: expect.objectContaining({
				status: {
					source: "durable-canonical-state",
					ownerObserved: false,
					state: "missing",
					writerPresent: false,
					run: null,
				},
			}),
		}),
	]);
	expect(await readdir(project)).toEqual([]);
	expect(await readdir(root)).toEqual(["project with spaces"]);
});

it("refuses a missing explicit project trust flag and mixed Pi or control arguments", async () => {
	for (const args of [
		["bridge", "--stdio"],
		["bridge", "--stdio", "--project-trusted", "start"],
		["--worktree-list", "bridge"],
	]) {
		const result = spawnSync(launcher, args, { cwd: project, env, encoding: "utf8", timeout: 5000 });
		expect(result.status).not.toBe(0);
		expect(result.stdout).toBe("");
	}
	expect(await readdir(project)).toEqual([]);
});

it("reports invalid local config as a fixed readiness code without printing credential bytes", async () => {
	const agent = join(env.WEAVRA_HOME!, "agent");
	await mkdir(env.WEAVRA_HOME!, { mode: 0o700 });
	await mkdir(agent, { mode: 0o700 });
	const secret = "FAKE_CREDENTIAL_NOT_FOR_WIRE";
	await writeFile(join(agent, "auth.json"), `{${secret}`, { mode: 0o600 });
	const result = spawnSync(launcher, ["bridge", "--stdio", "--project-trusted"], {
		cwd: project,
		env,
		input: hello,
		encoding: "utf8",
		timeout: 10000,
	});
	expect(result.status).toBe(0);
	expect(JSON.parse(result.stdout)).toMatchObject({ success: true, data: { readiness: "CONFIG_INVALID" } });
	expect(result.stdout + result.stderr).not.toContain(secret);
	expect(await readFile(join(agent, "auth.json"), "utf8")).toBe(`{${secret}`);
});

it("kills only the observer child and reconnects to fresh durable state without owner recovery", async () => {
	await mkdir(join(project, ".ai"));
	const run = implementingGraphRun();
	const source = join(project, ".ai/state.json");
	await writeFile(source, JSON.stringify({ schemaVersion: 1, revision: 1, runs: [run], actions: [] }));
	await writeFile(join(project, ".ai/writer.lock"), "fixture-owner-lease");
	const before = await readFile(source, "utf8");
	const child = spawn(launcher, ["bridge", "--stdio", "--project-trusted"], {
		cwd: project,
		env,
		stdio: ["pipe", "pipe", "pipe"],
	});
	const closed = once(child, "close");
	try {
		let buffer = "";
		const response = new Promise<HostBridgeResponse>((resolve, reject) => {
			child.on("error", reject);
			child.stdout.on("data", (chunk: Buffer) => {
				buffer += chunk.toString("utf8");
				while (true) {
					const newline = buffer.indexOf("\n");
					if (newline < 0) break;
					const message = JSON.parse(buffer.slice(0, newline)) as HostBridgeResponse;
					buffer = buffer.slice(newline + 1);
					if (message.id === "snapshot") resolve(message);
				}
			});
		});
		child.stdin.write(`${hello}\n${snapshot}\n`);
		expect(await response).toMatchObject({
			data: { status: { run: { status: "RUNNING" }, writerPresent: true, ownerObserved: false } },
		});
	} finally {
		child.kill("SIGTERM");
		await closed;
	}
	expect(await readFile(source, "utf8")).toBe(before);
	expect(await readFile(join(project, ".ai/writer.lock"), "utf8")).toBe("fixture-owner-lease");
	// Simulate a separately persisted owner observation, not a bridge command or inferred event.
	run.revision = 2;
	run.eventSequence = 2;
	await writeFile(source, JSON.stringify({ schemaVersion: 1, revision: 2, runs: [run], actions: [] }));
	const resumed = spawnSync(launcher, ["bridge", "--stdio", "--project-trusted"], {
		cwd: project,
		env,
		input: `${hello}\n${snapshot}\n`,
		encoding: "utf8",
		timeout: 10000,
	});
	expect(resumed.status).toBe(0);
	const messages = resumed.stdout
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	expect(messages.map((message) => message.type)).toEqual(["response", "response"]);
	expect(messages[1]).toMatchObject({
		stateRevision: 2,
		projectRevision: 2,
		eventId: "run:2",
		data: { status: { run: { status: "RUNNING" } } },
	});
});
