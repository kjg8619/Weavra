import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createRuntimeEvent } from "../src/events.ts";
import { projectEvidencePack } from "../src/evidence.ts";
import { projectRunGraph } from "../src/graph.ts";
import { attachHostBridgeStreams, ReadOnlyHostBridge } from "../src/host-bridge.ts";
import {
	HOST_BRIDGE_MAX_REQUEST_BYTES,
	HOST_BRIDGE_MAX_RESPONSE_BYTES,
	type HostBridgeResponse,
	type HostSnapshotSummary,
} from "../src/host-bridge-protocol.ts";
import { CompanyKernel } from "../src/kernel.ts";
import { FileStateStore } from "../src/state-store.ts";
import { testContract } from "./fixture-contract.ts";
import { graphRun } from "./graph-fixtures.ts";

let root: string;
let bridge: ReadOnlyHostBridge;
const stores: FileStateStore[] = [];
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "weavra-host-bridge-"));
	bridge = new ReadOnlyHostBridge({ cwd: root, projectTrusted: true });
});
afterEach(async () => {
	bridge.close();
	for (const store of stores.splice(0)) await store.close();
	await rm(root, { recursive: true, force: true });
});
function client() {
	const lines: string[] = [];
	const connection = bridge.connect((line) => {
		lines.push(line);
		return true;
	});
	let sequence = 0;
	return {
		lines,
		connection,
		async request(type: string, extra: Record<string, unknown> = {}) {
			const id = `request-${++sequence}`;
			await connection.receive(JSON.stringify({ protocolVersion: 1, id, type, ...extra }));
			return lines
				.map((line) => JSON.parse(line) as HostBridgeResponse)
				.find((message) => message.type === "response" && message.id === id)!;
		},
	};
}
// Shape-valid historical snapshots, as in graph-command.test.ts; never inject terminal state through a writer API.
async function persist(run = graphRun()) {
	await mkdir(join(root, ".ai"), { recursive: true });
	await writeFile(
		join(root, ".ai/state.json"),
		JSON.stringify({ schemaVersion: 1, revision: run.revision, runs: [run], actions: [] }),
	);
}
async function activeKernel() {
	const store = await FileStateStore.open(root);
	stores.push(store);
	const kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: "live-run",
			task: testContract("Fix bug", { taskId: "task" }),
			classification: { intent: "bugfix", complexity: "STANDARD", risk: "R1", confidence: null, reason: "Fixture" },
		},
		{
			store,
			events: bridge,
			agents: {
				execute: async () => {
					throw new Error("No worker should be launched by a read");
				},
			},
			verifier: {
				verify: async () => {
					throw new Error("No check should be launched by a read");
				},
			},
		},
	);
	await kernel.start();
	return { store, kernel };
}

it("requires explicit project trust and handshake; refuses control and arbitrary scope without creating state", async () => {
	expect(() => new ReadOnlyHostBridge({ cwd: root, projectTrusted: false })).toThrow(/trusted project/);
	const host = client();
	expect(await host.request("status")).toMatchObject({ success: false, error: { code: "HANDSHAKE_REQUIRED" } });
	expect(await host.request("hello", { protocolVersion: 2 })).toMatchObject({
		success: false,
		error: { code: "UNSUPPORTED_VERSION" },
	});
	expect(await host.request("hello")).toMatchObject({
		success: true,
		data: { readOnly: true, reconnect: "fresh-canonical-snapshot-no-replay" },
	});
	for (const type of ["run", "start", "write", "approval", "cancel", "state-export", "runtime_event"]) {
		expect(await host.request(type)).toMatchObject({ success: false, error: { code: "UNSUPPORTED_COMMAND" } });
	}
	expect(await host.request("snapshot", { cwd: "/outside" })).toMatchObject({
		success: false,
		error: { code: "INVALID_REQUEST" },
	});
	expect(await host.request("current-run", { runId: "../outside" })).toMatchObject({
		success: false,
		error: { code: "INVALID_REQUEST" },
	});
	expect(await host.request("snapshot")).toMatchObject({
		success: true,
		data: { status: { state: "missing", run: null, writerPresent: false } },
	});
	expect(await readdir(root)).toEqual([]);
});

it("reconnects from current canonical state without replay, recovery, cancellation or writer acquisition", async () => {
	const first = client();
	await first.request("hello");
	const { store, kernel } = await activeKernel();
	const before = await readFile(join(root, ".ai/state.json"), "utf8");
	const initial = await first.request("snapshot");
	expect(initial).toMatchObject({
		success: true,
		runId: "live-run",
		stateRevision: kernel.snapshot.revision,
		data: {
			status: {
				source: "durable-canonical-state",
				ownerObserved: false,
				writerPresent: true,
				run: { status: "RUNNING", codeRevision: 0, taskContractDigest: kernel.snapshot.taskContractDigest },
			},
		},
	});
	const events = first.lines.map((line) => JSON.parse(line)).filter((message) => message.type === "runtime_event");
	expect(events.map((message) => message.eventId)).toEqual(
		events.map((message) => `live-run:${message.event.sequence}`),
	);
	expect(events.at(-1).stateRevision).toBe(kernel.snapshot.revision);
	first.connection.close();
	expect(kernel.snapshot.status).toBe("RUNNING");
	const second = client();
	await second.request("hello");
	expect(second.lines.map((line) => JSON.parse(line)).filter((message) => message.type === "runtime_event")).toEqual(
		[],
	);
	expect(await second.request("cancel")).toMatchObject({ success: false });
	expect(await second.request("current-run")).toMatchObject({ success: true, data: { status: "RUNNING" } });
	expect(await readFile(join(root, ".ai/state.json"), "utf8")).toBe(before);
	await kernel.stop("CANCELLED", "Host-owned stop, not a bridge command");
	await store.close();
	expect(await second.request("snapshot")).toMatchObject({
		success: true,
		stateRevision: kernel.snapshot.revision,
		data: { status: { writerPresent: false, run: { status: "CANCELLED" } } },
	});
});

it("distinguishes project, Run and code revisions and never falls back for an unknown explicit Run", async () => {
	const { store, kernel } = await activeKernel();
	await store.prepare({
		executionMode: "EDIT",
		runId: "live-run",
		actionId: "audit",
		role: "Developer",
		risk: "R1",
		decision: "ALLOW",
		reason: "Fixture",
		actionDigest: "action",
		configDigest: "config",
	});
	await store.finish("live-run", "audit", "SUCCEEDED");
	const host = client();
	await host.request("hello");
	const response = await host.request("current-run");
	expect(response).toMatchObject({
		stateRevision: kernel.snapshot.revision,
		projectRevision: store.snapshot.revision,
		data: { codeRevision: 0 },
	});
	expect(response.projectRevision).toBeGreaterThan(response.stateRevision!);
	expect(await host.request("snapshot", { runId: "absent" })).toMatchObject({
		success: false,
		error: { code: "RUN_NOT_FOUND" },
	});
});

it("omits source/docs/transcripts/protected paths and preserves UNKNOWN usage in every projection", async () => {
	const marker = "PRIVATE_SOURCE_DOC_PROMPT_TOOL_OUTPUT";
	const run = graphRun();
	run.goal = marker;
	run.tasks[0].goal = marker;
	run.handoff!.summary = marker;
	run.lastError = marker;
	run.roleSessionRefs = [{ role: "Developer", sessionId: "developer", sessionFile: `/protected/${marker}` }];
	for (const check of run.verification) {
		check.reason = marker;
		check.stdout = marker;
		check.stderr = marker;
	}
	run.workerMeasurements = [
		{
			role: "Developer",
			profile: marker,
			revision: 0,
			step: { stepId: "implement", attempt: 1 },
			requestedProvider: marker,
			requestedModel: marker,
			actualProvider: marker,
			actualModel: marker,
			startedAt: 1,
			finishedAt: 2,
			durationMs: 1,
			modelTurns: 1,
			toolCalls: 2,
			toolCallsByName: { [marker]: 2 },
			outcome: "SUCCEEDED",
			usage: { source: "unavailable", input: 42, output: 12, cacheRead: 0, cacheWrite: 0, totalTokens: 54 },
		},
	];
	await persist(run);
	await writeFile(
		join(root, ".ai/config.yaml"),
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: { coding: { provider: marker, model: marker }, reasoning: { provider: marker, model: marker } },
			},
			files: { allowed_paths: [`protected/${marker}`] },
			review: {
				context: {
					impact: "disabled",
					documentation: {
						mode: "bounded",
						manifest: "package.json",
						requested: ["typescript"],
						entries: [
							{
								id: "private-doc",
								component: "typescript",
								version: "1.2.3",
								source: { kind: "reviewed-local", reference: "local:private-doc" },
								capturedAt: "2026-01-01T00:00:00.000Z",
								digest: `sha256:${"0".repeat(64)}`,
								reviewStatus: "REVIEWED",
								content: marker,
							},
						],
					},
				},
			},
		}),
	);
	const host = client();
	await host.request("hello");
	for (const type of ["status", "current-run", "graph", "evidence-summary", "config-summary", "snapshot"]) {
		expect(await host.request(type)).toMatchObject({ success: true });
	}
	expect(await host.request("config-summary")).toMatchObject({
		data: { status: "configured", documentationEntryCount: 1, modes: { documentation: "bounded" } },
	});
	expect(await host.request("evidence-summary")).toMatchObject({
		data: { workers: { count: 1, reportedTokens: null, toolCalls: 2 } },
	});
	bridge.emit({
		schemaVersion: 1,
		runId: "run",
		taskId: marker,
		sequence: 2,
		stateRevision: 2,
		timestamp: 100,
		type: "AgentFailed",
		step: { stepId: "implement", attempt: 1 },
		role: "Developer",
		reason: marker,
		sessionRef: run.roleSessionRefs[0],
	});
	expect(host.lines.join("")).not.toContain(marker);
	expect(host.lines.join("")).not.toContain("/protected/");
});

it("never turns observed completion into state authority", async () => {
	const { kernel } = await activeKernel();
	const host = client();
	await host.request("hello");
	const before = await readFile(join(root, ".ai/state.json"), "utf8");
	bridge.emit(createRuntimeEvent(kernel.snapshot, 900, { type: "RunCompleted" }));
	expect(await host.request("current-run")).toMatchObject({ data: { status: "RUNNING" } });
	expect(await readFile(join(root, ".ai/state.json"), "utf8")).toBe(before);
});

it.each(["corrupt", "orphan", "symlink"] as const)(
	"refuses %s canonical source without stale cache, recovery or repair",
	async (mode) => {
		await persist();
		const host = client();
		await host.request("hello");
		expect(await host.request("current-run")).toMatchObject({ data: { status: "COMPLETED" } });
		const path = join(root, ".ai/state.json");
		if (mode === "corrupt") await writeFile(path, "{}");
		else {
			const prior = await readFile(path, "utf8");
			if (mode === "orphan") await writeFile(join(root, ".ai/tasks.json"), "{}");
			await rm(path);
			if (mode === "symlink") {
				const other = join(root, "other.json");
				await writeFile(other, prior);
				await symlink(other, path);
			}
		}
		const files = await readdir(join(root, ".ai"));
		expect(await host.request("snapshot")).toMatchObject({ success: false, error: { code: "STATE_UNAVAILABLE" } });
		expect(await host.request("status")).toMatchObject({
			data: { state: "unavailable", writerPresent: null, run: null },
		});
		expect(await readdir(join(root, ".ai"))).toEqual(files);
	},
);

it("rejects contradictory graphs rather than reusing a previously successful graph", async () => {
	const run = graphRun();
	await persist(run);
	const host = client();
	await host.request("hello");
	expect(await host.request("graph")).toMatchObject({ success: true });
	await persist({ ...run, revision: 2, phase: "IMPLEMENT" });
	expect(await host.request("graph")).toMatchObject({ success: false, error: { code: "GRAPH_UNAVAILABLE" } });
	expect(await host.request("snapshot")).toMatchObject({ data: { graph: null, graphAvailable: false } });
});

it("bounds oversized requests and whole responses without leaking a partial oversized identity", async () => {
	const host = client();
	await host.request("hello");
	await host.connection.receive(" ".repeat(HOST_BRIDGE_MAX_REQUEST_BYTES + 1));
	expect(host.connection.closed).toBe(true);
	const run = graphRun();
	run.runId = "large".repeat(15000);
	await persist(run);
	const second = client();
	await second.request("hello");
	expect(await second.request("current-run")).toMatchObject({
		success: false,
		runId: null,
		error: { code: "RESPONSE_TOO_LARGE" },
	});
	expect(Buffer.byteLength(second.lines.at(-1)!)).toBeLessThanOrEqual(HOST_BRIDGE_MAX_RESPONSE_BYTES);
	expect(second.lines.at(-1)).not.toContain("largelarge");
});

it.each([
	[HOST_BRIDGE_MAX_REQUEST_BYTES - 1, true],
	[HOST_BRIDGE_MAX_REQUEST_BYTES, false],
] as const)("counts LF inside the announced byte budget for a %i-byte JSONL body", async (bytes, accepted) => {
	const input = new PassThrough();
	const output = new PassThrough();
	let wire = "";
	output.on("data", (chunk: Buffer) => {
		wire += chunk.toString("utf8");
	});
	const finished = new Promise<void>((resolve) => {
		attachHostBridgeStreams(bridge, input, output, resolve);
	});
	input.end(`${JSON.stringify({ protocolVersion: 1, id: "boundary", type: "hello" }).padEnd(bytes)}\n`);
	await finished;
	if (accepted) expect(JSON.parse(wire)).toMatchObject({ id: "boundary", success: true });
	else expect(wire).toBe("");
});

it("isolates throwing/backpressured clients from real Kernel persistence and other observers", async () => {
	const bad = bridge.connect((line) => {
		if (JSON.parse(line).type === "runtime_event") throw new Error("Closed client");
		return true;
	});
	await bad.receive(JSON.stringify({ protocolVersion: 1, id: "hello", type: "hello" }));
	const slow = bridge.connect(() => false);
	await slow.receive(JSON.stringify({ protocolVersion: 1, id: "hello", type: "hello" }));
	const good = client();
	await good.request("hello");
	const { kernel } = await activeKernel();
	expect(bad.closed).toBe(true);
	expect(slow.closed).toBe(true);
	expect(kernel.snapshot.status).toBe("RUNNING");
	expect(await good.request("current-run")).toMatchObject({ data: { status: "RUNNING" } });
});

it("bounds pending work and connection count, and can release client slots without touching Runtime", async () => {
	const connections = Array.from({ length: 8 }, () => client());
	expect(() => client()).toThrow(/connection limit/);
	connections[0].connection.close();
	const next = client();
	const work = Array.from({ length: 9 }, (_, id) =>
		next.connection.receive(JSON.stringify({ protocolVersion: 1, id: `q-${id}`, type: "hello" })),
	);
	await Promise.all(work);
	expect(next.connection.closed).toBe(true);
	expect(next.lines.map((line) => JSON.parse(line))).toContainEqual(
		expect.objectContaining({ success: false, error: { code: "BUSY" } }),
	);
	expect(await readdir(root)).toEqual([]);
});

it("frames split LF/CRLF records and drains an unterminated EOF request before disconnect", async () => {
	const input = new PassThrough();
	const output = new PassThrough();
	let wire = "";
	output.on("data", (chunk: Buffer) => {
		wire += chunk.toString("utf8");
	});
	let done!: () => void;
	const finished = new Promise<void>((resolve) => {
		done = resolve;
	});
	attachHostBridgeStreams(bridge, input, output, done);
	const hello = JSON.stringify({ protocolVersion: 1, id: "hello", type: "hello" });
	input.write(hello.slice(0, 13));
	input.write(`${hello.slice(13)}\r\n`);
	input.end(JSON.stringify({ protocolVersion: 1, id: "snapshot", type: "snapshot" }));
	await finished;
	expect(
		wire
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line)),
	).toEqual([
		expect.objectContaining({ id: "hello", success: true }),
		expect.objectContaining({
			id: "snapshot",
			success: true,
			data: expect.objectContaining({ status: expect.objectContaining({ state: "missing" }) }),
		}),
	]);
	input.destroy();
	output.destroy();
});

it("cuts off a frame exceeding the byte bound before parsing or creating project state", async () => {
	const input = new PassThrough();
	const output = new PassThrough();
	const connection = attachHostBridgeStreams(bridge, input, output);
	input.write(Buffer.alloc(HOST_BRIDGE_MAX_REQUEST_BYTES + 1, 32));
	expect(connection.closed).toBe(true);
	expect(await readdir(root)).toEqual([]);
	input.destroy();
	output.destroy();
});

it("keeps historical usage unknown and counts verification only for the current code revision", async () => {
	await persist(graphRun("STANDARD", "R1", 1));
	const host = client();
	await host.request("hello");
	expect(await host.request("evidence-summary")).toMatchObject({
		data: {
			codeRevision: 1,
			currentChecks: { total: 2, passed: 2 },
			workers: { count: 0, reportedTokens: null },
			criteria: { total: 1, met: 0, unknown: 1 },
		},
	});
});

it("contains accidentally asynchronous Host callback failures without affecting a real Kernel", async () => {
	const asynchronous = bridge.connect((async () => {
		throw new Error("Async writer rejected");
	}) as unknown as (line: string) => boolean);
	await asynchronous.receive(JSON.stringify({ protocolVersion: 1, id: "hello", type: "hello" }));
	expect(asynchronous.closed).toBe(true);
	const closing = bridge.connect(
		() => true,
		async () => {
			throw new Error("Async teardown rejected");
		},
	);
	closing.close();
	const { kernel } = await activeKernel();
	expect(kernel.snapshot.status).toBe("RUNNING");
});

it("permanently closes the observation server without stopping or recovering its Runtime", async () => {
	const { kernel } = await activeKernel();
	const before = await readFile(join(root, ".ai/state.json"), "utf8");
	bridge.close();
	expect(() => client()).toThrow(/bridge is closed/);
	expect(kernel.snapshot.status).toBe("RUNNING");
	expect((await FileStateStore.readSnapshot(root)).writerPresent).toBe(true);
	expect(await readFile(join(root, ".ai/state.json"), "utf8")).toBe(before);
});

it("negotiates bounded client metadata only on hello and rejects malformed JSON without executing a command", async () => {
	const host = client();
	await host.connection.receive("{broken");
	expect(JSON.parse(host.lines.at(-1)!)).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
	expect(await host.request("hello", { clientName: "t3code", capabilities: ["snapshots-only"] })).toMatchObject({
		success: true,
		data: {
			runtimeVersion: expect.stringMatching(/^\d+\.\d+\.\d+/),
			transport: "in-process",
			observationMode: "runtime-events",
		},
	});
	expect(await host.request("snapshot", { clientName: "t3code" })).toMatchObject({
		success: false,
		error: { code: "INVALID_REQUEST" },
	});
	expect(await host.request("hello", { capabilities: ["start"] })).toMatchObject({
		success: false,
		error: { code: "INVALID_REQUEST" },
	});
	expect(await readdir(root)).toEqual([]);
});

it("keeps duplicate and out-of-order observations separate from monotonic canonical Run revisions", async () => {
	const { kernel } = await activeKernel();
	const host = client();
	await host.request("hello");
	const before = await host.request("snapshot");
	const observation = createRuntimeEvent(kernel.snapshot, 900, { type: "RunCompleted" });
	bridge.emit(observation);
	bridge.emit(observation);
	bridge.emit({ ...observation, sequence: 899, stateRevision: 0 });
	const unchanged = await host.request("snapshot");
	expect(unchanged).toMatchObject({
		stateRevision: before.stateRevision,
		eventId: before.eventId,
		data: { status: { run: { status: "RUNNING" } } },
	});
	await kernel.stop("CANCELLED", "Fixture owner transition");
	const after = await host.request("snapshot");
	expect(after.stateRevision).toBeGreaterThan(before.stateRevision!);
	expect(after).toMatchObject({ data: { status: { run: { status: "CANCELLED" } } } });
});

it("preserves Runtime revision-loop graph and current-revision evidence semantics without copying private details", async () => {
	const run = graphRun("STANDARD", "R1", 1);
	await persist(run);
	const host = client();
	await host.request("hello");
	const response = await host.request("snapshot");
	expect(response.success).toBe(true);
	if (!response.success) throw new Error("Expected snapshot");
	const snapshot = response.data as HostSnapshotSummary;
	const graph = projectRunGraph(run);
	expect(snapshot.graph?.edges).toEqual(graph.edges);
	expect(snapshot.graph?.nodes.map(({ id, status }) => ({ id, status }))).toEqual(
		graph.nodes.map(({ id, status }) => ({ id, status })),
	);
	expect(snapshot.graph?.edges).toContainEqual({ from: "review:1", to: "implement:2", kind: "revise" });
	const evidence = projectEvidencePack({ run });
	expect(snapshot.evidence?.currentChecks.total).toBe(
		evidence.checks.filter((check) => check.revision === run.revisionCycle).length,
	);
	expect(snapshot.evidence?.currentChecks.passed).toBe(2);
	expect(snapshot.evidence?.criteria.unknown).toBe(1);
	expect(snapshot.evidence?.review?.result).toBe(evidence.review?.result);
	expect(snapshot.evidence?.workers.reportedTokens).toBeNull();
});
