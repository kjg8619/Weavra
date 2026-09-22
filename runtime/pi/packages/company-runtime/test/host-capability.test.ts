import childProcess from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_TOOL_SCHEMAS } from "../src/action-tool-schemas.ts";
import * as configuration from "../src/config.ts";
import * as projections from "../src/host-bridge-projections.ts";
import { HostControlBridge } from "../src/host-control.ts";
import {
	HOST_CONTROL_COMMANDS,
	type HostControlResponse,
	type HostControlState,
} from "../src/host-control-protocol.ts";
import * as lsp from "../src/lsp/manager.ts";
import * as facts from "../src/project-facts.ts";
import { FileStateStore } from "../src/state-store.ts";

const source = {
	schemaVersion: 1,
	models: {
		profiles: {
			coding: { provider: "SECRET_PROVIDER", model: "SECRET_MODEL" },
			reasoning: { provider: "SECRET_PROVIDER", model: "SECRET_MODEL" },
		},
	},
	files: { allowed_paths: ["src"] },
};
let cwd: string;
let clock: number;
const bridges: HostControlBridge[] = [];
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "wv-cap-"));
	clock = 100;
});
afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	syncBuiltinESMExports();
	for (const bridge of bridges.splice(0)) await bridge.shutdown();
	await rm(cwd, { recursive: true, force: true });
	await rm(`${cwd}-old`, { recursive: true, force: true });
});
async function configure(value: unknown = source) {
	await mkdir(join(cwd, ".ai"), { recursive: true });
	await writeFile(join(cwd, ".ai/config.yaml"), JSON.stringify(value));
}
async function connect(readiness: "READY" | "NOT_SETUP" = "READY") {
	const createModels = vi.fn(async (): Promise<never> => {
		throw new Error("Model initialization forbidden");
	});
	const bridge = await HostControlBridge.create({
		cwd,
		projectTrusted: true,
		agentDir: join(cwd, "private-agent"),
		readiness,
		now: () => clock,
		createModels,
	});
	bridges.push(bridge);
	const lines: string[] = [];
	const connection = bridge.connect((line) => {
		lines.push(line);
		return true;
	});
	const send = async (input: Record<string, unknown>): Promise<HostControlResponse> => {
		await connection.receive(JSON.stringify({ protocolVersion: 1, id: "snapshot", ...input }));
		return JSON.parse(lines.at(-1)!);
	};
	const hello = await send({ type: "control.hello" });
	const state = async (): Promise<HostControlState> => {
		const response = await send({ type: "control.snapshot" });
		if (!response.success || response.data.kind !== "snapshot") throw new Error(JSON.stringify(response));
		return response.data.state;
	};
	return { bridge, hello, send, state, lines, createModels };
}

describe("Host-only capability observation", () => {
	it("keeps the protocol and commands intact, publishes fresh generations, and does not persist inventory", async () => {
		await configure();
		const client = await connect();
		expect(client.hello).toMatchObject({
			protocolVersion: 1,
			success: true,
			data: { kind: "capabilities", capabilities: { commands: HOST_CONTROL_COMMANDS } },
		});
		const first = await client.state();
		expect(first.capabilityInventory).toMatchObject({
			ownerId: client.bridge.ownerId,
			projectRevision: first.projectRevision,
			status: "CURRENT",
			generation: 1,
			observedAt: 100,
			total: 10,
		});
		clock = 90;
		const second = await client.state();
		expect(second.capabilityInventory).toMatchObject({
			generation: 2,
			observedAt: 90,
			brokerEpoch: first.capabilityInventory!.brokerEpoch,
		});
		expect(await readdir(join(cwd, ".ai"))).toEqual(["config.yaml"]);
		expect(client.createModels).not.toHaveBeenCalled();
		expect(await client.send({ type: "control.snapshot", protocolVersion: 2 })).toMatchObject({
			success: false,
			error: { code: "UNSUPPORTED_VERSION" },
		});
		expect(await client.send({ type: "capability.execute" })).toMatchObject({
			success: false,
			error: { code: "UNSUPPORTED_COMMAND" },
		});
		expect(await client.send({ type: "control.snapshot", capabilityInventory: { approved: true } })).toMatchObject({
			success: false,
			error: { code: "INVALID_REQUEST" },
		});
		const other = await connect();
		const replacement = await other.state();
		expect(replacement.capabilityInventory!.brokerEpoch).not.toBe(first.capabilityInventory!.brokerEpoch);
		expect(
			await other.send({
				type: "approval.resolve",
				id: `${client.bridge.ownerId}:1`,
				ownerId: client.bridge.ownerId,
				expectedProjectRevision: 0,
				runId: "run",
				expectedStateRevision: 0,
				approvalId: "copied",
				decision: "approve",
			}),
		).toMatchObject({ success: false, error: { code: "OWNER_CHANGED" } });
	});
	it("keeps missing/invalid/removed config typed without setup, credential, model, LSP or network effects", async () => {
		const spawn = vi.spyOn(childProcess, "spawn");
		syncBuiltinESMExports();
		const fetch = vi.spyOn(globalThis, "fetch");
		const inspect = vi.spyOn(lsp, "inspectLspServers");
		const manager = vi.spyOn(lsp.LspManager, "create");
		vi.stubEnv("OPENAI_API_KEY", "CREDENTIAL_SENTINEL");
		const client = await connect("NOT_SETUP");
		const missing = await client.state();
		expect(missing.capabilityInventory).toMatchObject({
			status: "UNKNOWN",
			reason: "CONFIG_UNAVAILABLE",
			generation: 1,
			observedAt: 100,
			entries: [],
			total: null,
		});
		expect(existsSync(join(cwd, ".ai"))).toBe(false);
		await configure({
			...source,
			code_intelligence: {
				lsp: {
					enabled: true,
					servers: [
						{
							id: "PRIVATE_LSP",
							executable: "/missing/LSP_SENTINEL",
							args: ["ARG_SENTINEL"],
							extensions: [".ts"],
						},
					],
				},
			},
		});
		const enabled = await client.state();
		expect(
			enabled
				.capabilityInventory!.entries.filter((row) => row.descriptor.name.startsWith("runtime_lsp_"))
				.every(
					(row) => row.observation.availability === "UNKNOWN" && row.observation.reason === "LSP_NOT_OBSERVED",
				),
		).toBe(true);
		vi.stubEnv("OPENAI_API_KEY", undefined);
		const noCredential = await client.state();
		expect(noCredential.capabilityInventory!.entries.map((row) => row.descriptor)).toEqual(
			enabled.capabilityInventory!.entries.map((row) => row.descriptor),
		);
		await writeFile(join(cwd, ".ai/config.yaml"), "ENV_TOKEN_RAW_ERROR_SENTINEL: [");
		expect((await client.state()).capabilityInventory).toMatchObject({
			generation: 4,
			reason: "CONFIG_UNAVAILABLE",
			entries: [],
			total: null,
		});
		await rm(join(cwd, ".ai/config.yaml"));
		expect((await client.state()).capabilityInventory).toMatchObject({
			generation: 5,
			reason: "CONFIG_UNAVAILABLE",
			entries: [],
		});
		expect(client.lines.join("")).not.toMatch(/SECRET_PROVIDER|SECRET_MODEL|SENTINEL|PRIVATE_LSP/);
		for (const effect of [spawn, fetch, inspect, manager, client.createModels]) expect(effect).not.toHaveBeenCalled();
		expect(await readdir(join(cwd, ".ai"))).toEqual([]);
	});
	it("compares complete config during sampling, not only the LSP flag, and never promotes last-good on failure", async () => {
		await configure();
		const client = await connect();
		expect((await client.state()).capabilityInventory!.status).toBe("CURRENT");
		vi.spyOn(facts, "loadProjectFactProjection").mockImplementationOnce(async () => {
			await configure({ ...source, files: { allowed_paths: ["other"] } });
			return () => [];
		});
		const changed = await client.state();
		expect(changed.capabilityInventory).toMatchObject({
			generation: 2,
			status: "NEEDS_REFRESH",
			reason: "SOURCE_CHANGED",
			entries: [],
			total: null,
		});
		expect((await client.state()).capabilityInventory).toMatchObject({ generation: 3, status: "CURRENT" });
		vi.spyOn(facts, "loadProjectFactProjection").mockImplementationOnce(async () => {
			await rm(join(cwd, ".ai/config.yaml"));
			return () => [];
		});
		expect((await client.state()).capabilityInventory).toMatchObject({
			generation: 4,
			status: "UNKNOWN",
			reason: "CONFIG_UNAVAILABLE",
			entries: [],
		});
	});
	it("uses the existing bounded coherence retries for project changes and preserves root failures", async () => {
		await configure();
		const client = await connect();
		let revision = 0;
		const samples = vi.spyOn(projections, "readHostObservation");
		vi.spyOn(FileStateStore, "readSnapshot").mockImplementation(async () => ({
			state: { schemaVersion: 1, revision: revision++, runs: [], actions: [] },
			writerPresent: false,
			tasksCurrent: true,
		}));
		expect(await client.send({ type: "control.snapshot" })).toMatchObject({
			success: false,
			error: { code: "STATE_UNAVAILABLE" },
		});
		expect(samples).toHaveBeenCalledTimes(3); // Initial attempt and the existing two coherence retries.
		vi.restoreAllMocks();
		const afterFailure = await client.state();
		expect(afterFailure.capabilityInventory).toMatchObject({ generation: 4, status: "CURRENT" });
		const original = configuration.loadRuntimeConfig;
		let count = 0;
		vi.spyOn(configuration, "loadRuntimeConfig").mockImplementation(async (root) => {
			const loaded = await original(root);
			if (++count === 2) {
				await rename(cwd, `${cwd}-old`);
				await mkdir(cwd);
			}
			return loaded;
		});
		expect(await client.send({ type: "control.snapshot" })).toMatchObject({
			success: false,
			error: { code: "PROJECT_CHANGED" },
		});
	});
	it("drops only whole inventory rows under UTF-8 response pressure, preserving canonical facts and empty-header failure", async () => {
		await configure();
		const client = await connect();
		// Synthetic canonical-state pressure, not a claim of accepted Project Fact registration.
		const rows = [
			{
				id: "fixture",
				statement: "한".repeat(20700),
				sourceRef: "fixture",
				sourceDigest: `sha256:${"0".repeat(64)}`,
				reviewedAt: 0,
				status: "VALID" as const,
			},
		];
		vi.spyOn(facts, "loadProjectFactProjection").mockResolvedValue(() => rows);
		const limited = await client.state();
		expect(limited.projectFacts.entries).toEqual(rows);
		expect(limited.capabilityInventory!.omitted).toBeGreaterThan(0);
		expect(limited.capabilityInventory!.total).toBe(10);
		expect(limited.capabilityInventory!.omitted + limited.capabilityInventory!.entries.length).toBe(10);
		expect(Buffer.byteLength(client.lines.at(-1)!)).toBeLessThanOrEqual(65536);
		const fullIds = Object.keys(ACTION_TOOL_SCHEMAS)
			.map((name) => `weavra.worker.${name}`)
			.sort();
		expect(limited.capabilityInventory!.entries.map((entry) => entry.descriptor.id)).toEqual(
			fullIds.slice(0, limited.capabilityInventory!.entries.length),
		);
		rows[0].statement = "한".repeat(22000);
		expect(await client.send({ type: "control.snapshot" })).toMatchObject({
			success: false,
			error: { code: "RESPONSE_TOO_LARGE" },
		});
		expect(await readFile(join(cwd, ".ai/config.yaml"), "utf8")).toBe(JSON.stringify(source));
	});
});
