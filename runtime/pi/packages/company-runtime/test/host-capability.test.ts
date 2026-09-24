import childProcess from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_TOOL_SCHEMAS } from "../src/action-tool-schemas.ts";
import { classifyRequest } from "../src/classification.ts";
import { complexPlanDigest } from "../src/complex-plan.ts";
import { projectComplexExecution } from "../src/complex-state.ts";
import type { ComplexPlan } from "../src/complex-types.ts";
import * as configuration from "../src/config.ts";
import type { Run } from "../src/contracts.ts";
import { taskContractDigest } from "../src/criterion-evidence.ts";
import * as projections from "../src/host-bridge-projections.ts";
import { HostControlBridge } from "../src/host-control.ts";
import {
	HOST_CONTROL_COMMANDS,
	type HostControlCapabilities,
	type HostControlResponse,
	type HostControlState,
} from "../src/host-control-protocol.ts";
import { CompanyKernel } from "../src/kernel.ts";
import * as lsp from "../src/lsp/manager.ts";
import * as facts from "../src/project-facts.ts";
import { FileStateStore } from "../src/state-store.ts";
import { type ComplexObservation, complexConsumerIssues, complexPreviewIssues } from "./complex-conformance.ts";
import {
	type ComplexTaskSpec,
	complexHarness,
	complexPlanFor,
	driveComplex,
	FakeFiles,
	takeConsumerIssues,
} from "./complex-fixture.ts";
import { testContract } from "./fixture-contract.ts";

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

describe("COMPLEX preparation over Host Control (#16 stage A)", () => {
	const goal = "Refactor the parser across multiple modules";
	const complexSource = {
		...source,
		agents: { max_revision_cycles: 3 },
		verification: {
			checks: [
				{ id: "lint", kind: "lint", executable: "/usr/bin/true", args: [], required: false },
				{ id: "test", kind: "test", executable: "/usr/bin/true", args: [] },
			],
		},
	};
	const complexDraft = {
		tasks: [
			{
				title: "Extract parser",
				goal: "Move parsing into src/parse.ts",
				dependsOnIndexes: [],
				criterionIndexes: [1],
				ownership: [
					{ path: "src/app.ts", operation: "modify" },
					{ path: "src/parse.ts", operation: "create" },
				],
				checkIds: ["test"],
			},
			{
				title: "Add validation",
				goal: "Reject duplicate keys",
				dependsOnIndexes: [1],
				criterionIndexes: [1],
				ownership: [],
				checkIds: ["test"],
			},
		],
	};
	async function complexClient() {
		await configure(complexSource);
		await writeFile(join(cwd, "src/app.ts"), "export const app = 1;\n");
		const client = await connect();
		const mutation = async (fields: Record<string, unknown>) => {
			const state = await client.state();
			return client.send({
				id: state.nextRequestId,
				ownerId: state.ownerId,
				expectedProjectRevision: state.projectRevision,
				...fields,
			});
		};
		return { ...client, mutation };
	}
	beforeEach(async () => {
		await mkdir(join(cwd, "src"), { recursive: true });
	});

	it("previews the complete bound plan without a writer, Run or model", async () => {
		const client = await complexClient();
		expect(client.hello).toMatchObject({ success: true, data: { kind: "capabilities" } });
		if (!client.hello.success || client.hello.data.kind !== "capabilities") throw new Error("capabilities expected");
		// V0.8A: this Runtime implements exactly contract v2 and advertises it; advertisement authorizes nothing.
		expect(client.hello.data.capabilities.complexContractVersion).toBe(2);
		const response = await client.mutation({ type: "workflow.prepare", goal, complexDraft });
		if (!response.success || response.data.kind !== "prepared") throw new Error(JSON.stringify(response));
		const preview = response.data.preview;
		// Every App preview/prepare-response rule holds for the real preview (complex-conformance.ts).
		expect(
			complexPreviewIssues(preview, { ownerId: client.bridge.ownerId, expectedProjectRevision: 0, complexDraft }),
		).toEqual([]);
		const plan = preview.complexPlan!;
		expect(preview).toMatchObject({ workflow: "COMPLEX", executionMode: "EDIT", risk: "R1", recipe: null });
		expect(plan.tasks.map((task) => [task.id, task.dependsOn, task.criterionIds, task.ownership])).toEqual([
			[
				"CT-001",
				[],
				["AC-001"],
				[
					{ path: "src/app.ts", operation: "modify" },
					{ path: "src/parse.ts", operation: "create" },
				],
			],
			["CT-002", ["CT-001"], ["AC-001"], []],
		]);
		expect(plan.integration).toEqual({
			criterionIds: ["AC-001"],
			checkIds: ["lint", "test"],
			reviewRequired: true,
			finalChecksRequired: true,
		});
		expect(plan.complexPlanDigest).toBe(complexPlanDigest(plan));
		// §10.3: the consumer reconstructs the pending parent from preview fields and recomputes its digest.
		const parentDigest = taskContractDigest({
			id: plan.parentTaskId,
			goal: preview.goal,
			acceptanceCriteria: preview.acceptanceCriteria.map(({ id, statement, checkIds, reviewRequired }) => ({
				id,
				statement,
				scope: { paths: preview.allowedPaths },
				verification: { checkIds, reviewRequired },
			})),
			status: "pending",
		});
		expect(parentDigest).toBe(preview.taskContractDigest);
		expect(plan.parentTaskContractDigest).toBe(preview.taskContractDigest);
		expect(preview.acceptanceCriteria.every((criterion) => criterion.reviewRequired)).toBe(true);
		expect(Buffer.byteLength(client.lines.at(-1)!)).toBeLessThanOrEqual(65536);
		const state = await client.state();
		expect(state.preview).toEqual(preview);
		expect("complexExecution" in state).toBe(false);
		expect(await readdir(join(cwd, ".ai"))).toEqual(["config.yaml"]);
		expect(client.createModels).not.toHaveBeenCalled();
	});

	it.each<[string, Record<string, unknown>, string]>([
		["COMPLEX without a structured plan", { goal }, "UNSUPPORTED_WORKFLOW"],
		["a draft on a STANDARD goal", { goal: "Fix bug in src/app.ts", complexDraft }, "INVALID_REQUEST"],
		[
			"a recipe with a draft",
			{ goal, complexDraft, recipeId: "bugfix", recipeInputs: { reproduction: "x" } },
			"INVALID_REQUEST",
		],
		[
			"a forged task identity",
			{
				goal,
				complexDraft: { tasks: complexDraft.tasks.map((task, index) => ({ ...task, id: `CT-00${index + 1}` })) },
			},
			"INVALID_REQUEST",
		],
		[
			"a forged plan digest",
			{ goal, complexDraft: { ...complexDraft, complexPlanDigest: `sha256:${"0".repeat(64)}` } },
			"INVALID_REQUEST",
		],
		[
			"a draft over 12,288 bytes",
			{
				goal,
				complexDraft: {
					tasks: [0, 1, 2].map((taskIndex) => ({
						...complexDraft.tasks[1],
						dependsOnIndexes: [],
						ownership: Array.from({ length: 16 }, (_, index) => ({
							path: `src/${"a".repeat(240)}-${taskIndex}-${index}.ts`,
							operation: "create",
						})),
					})),
				},
			},
			"INVALID_REQUEST",
		],
		[
			"a self dependency",
			{
				goal,
				complexDraft: { tasks: [complexDraft.tasks[0], { ...complexDraft.tasks[1], dependsOnIndexes: [2] }] },
			},
			"INVALID_CRITERIA",
		],
		[
			"a claim outside allowed paths",
			{
				goal,
				complexDraft: {
					tasks: [
						complexDraft.tasks[0],
						{ ...complexDraft.tasks[1], ownership: [{ path: "docs/a.md", operation: "create" }] },
					],
				},
			},
			"INVALID_CRITERIA",
		],
	])("rejects %s with no preview, writer or Run", async (_name, fields, code) => {
		const client = await complexClient();
		expect(await client.mutation({ type: "workflow.prepare", ...fields })).toMatchObject({
			success: false,
			error: { code },
		});
		expect((await client.state()).preview).toBeNull();
		expect(await readdir(join(cwd, ".ai"))).toEqual(["config.yaml"]);
		expect(client.createModels).not.toHaveBeenCalled();
	});

	it("starts a confirmed COMPLEX preview once; a failing model runtime leaves no writer or Run (#16 stage B)", async () => {
		const client = await complexClient();
		const prepared = await client.mutation({ type: "workflow.prepare", goal, complexDraft });
		if (!prepared.success || prepared.data.kind !== "prepared") throw new Error(JSON.stringify(prepared));
		const { previewId, previewDigest } = prepared.data.preview;
		expect(await client.mutation({ type: "workflow.confirm", previewId, previewDigest })).toMatchObject({
			success: true,
			data: { kind: "accepted", command: "workflow.confirm", runId: null },
		});
		let state = await client.state();
		await vi.waitFor(async () => {
			state = await client.state();
			expect(state.busy).toBe(false);
		});
		expect(state).toMatchObject({ startFailure: "START_FAILED", preview: null, ownedRunId: null });
		expect(state.snapshot.status.run).toBeNull();
		expect(await client.mutation({ type: "workflow.confirm", previewId, previewDigest })).toMatchObject({
			success: false,
			error: { code: "PLAN_CONSUMED" },
		});
		expect(await readdir(join(cwd, ".ai"))).toEqual(["config.yaml"]);
		// COMPLEX confirmation now starts execution: the model runtime is created (and fails in this fixture).
		expect(client.createModels).toHaveBeenCalledOnce();
	});

	it("keeps STANDARD previews and snapshots free of COMPLEX fields", async () => {
		const client = await complexClient();
		const response = await client.mutation({ type: "workflow.prepare", goal: "Fix bug in src/app.ts" });
		if (!response.success || response.data.kind !== "prepared") throw new Error(JSON.stringify(response));
		expect(response.data.preview.workflow).toBe("STANDARD");
		expect("complexPlan" in response.data.preview).toBe(false);
		const state = await client.state();
		expect("complexPlan" in state.preview!).toBe(false);
		expect("complexExecution" in state).toBe(false);
	});
});

describe("COMPLEX execution projection over Host Control (#16 stage C)", () => {
	const TWO_TASKS: ComplexTaskSpec[] = [
		{ claims: [{ path: "src/app.ts", operation: "modify" }] },
		{ claims: [{ path: "src/new.ts", operation: "create" }] },
	];
	afterEach(() => {
		takeConsumerIssues();
	});
	/** A durable COMPLEX Run in `cwd` through the real validating FileStateStore; every save is App-checked. */
	async function durableComplex(options: { stop?: (run: Run) => boolean; statements?: string[] } = {}) {
		const store = await FileStateStore.open(cwd);
		const files = new FakeFiles({ "src/app.ts": "app\n", "src/util.ts": "util\n" });
		const { plan, parent } = await complexPlanFor(TWO_TASKS, {
			files,
			...(options.statements ? { statements: options.statements } : {}),
		});
		const h = complexHarness({ plan, parent, files });
		const kernel = await CompanyKernel.create(h.request(), { ...h.ports, store: h.consumer.wrap(store) }, () => 1000);
		const run = await driveComplex(kernel, options.stop);
		return { store, h, run, kernel };
	}
	/** One full control observation through the real request/response path. */
	async function observation(client: Awaited<ReturnType<typeof connect>>): Promise<ComplexObservation> {
		if (!client.hello.success || client.hello.data.kind !== "capabilities") throw new Error("capabilities expected");
		const capabilities: HostControlCapabilities = client.hello.data.capabilities;
		const response = await client.send({ type: "control.snapshot" });
		if (!response.success || response.data.kind !== "snapshot") throw new Error(JSON.stringify(response));
		expect(Buffer.byteLength(client.lines.at(-1)!)).toBeLessThanOrEqual(65536);
		return {
			capabilities,
			state: response.data.state,
			response: {
				ownerId: response.ownerId,
				runId: response.runId,
				stateRevision: response.stateRevision,
				projectRevision: response.projectRevision,
			},
		};
	}
	const latestRun = async (): Promise<Run> => {
		const run = (await FileStateStore.readSnapshot(cwd)).state?.runs.at(-1);
		if (!run) throw new Error("no durable run");
		return run;
	};

	it("advertises contract v2 and projects the latest COMPLEX Run at the snapshot's exact revisions", async () => {
		const { store, h, run } = await durableComplex();
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		await store.close();
		expect(h.consumer.issues).toEqual([]);
		expect(h.consumer.projected).toHaveLength(run.revision);
		const client = await connect();
		const first = await observation(client);
		expect(first.capabilities.complexContractVersion).toBe(2);
		const { state } = first;
		const stored = await latestRun();
		expect(state.stateRevision).toBe(stored.revision);
		expect(state.complexExecution).toEqual(
			projectComplexExecution(stored, {
				ownerId: client.bridge.ownerId,
				projectRevision: state.projectRevision,
				stateRevision: stored.revision,
			}),
		);
		expect(state.complexExecution).toMatchObject({
			ownerId: state.ownerId,
			projectRevision: state.projectRevision,
			stateRevision: state.stateRevision,
			runId: state.snapshot.status.run?.runId,
			phase: "TERMINAL",
			cleanup: "CONFIRMED",
		});
		// Historical and unowned: the projection belongs to the latest Run, not to an owned execution.
		expect(state.ownedRunId).toBeNull();
		expect(Buffer.byteLength(JSON.stringify(state.complexExecution))).toBeLessThanOrEqual(32768);
		expect(complexConsumerIssues(first)).toEqual([]);
		// An unchanged Run is observed again with byte-identical canonical data.
		const second = await observation(client);
		expect(complexConsumerIssues(second, first)).toEqual([]);
		expect(second.state.complexExecution).toEqual(state.complexExecution);
		// The ordinary read-only summary keeps its existing fields and values; task detail lives only in the DTO.
		expect(JSON.stringify(state.snapshot)).not.toMatch(/CT-00\d|complexExecution|complexContext/);
		expect(Object.keys(state.snapshot.status.run ?? {}).sort()).toEqual([
			"activeAgentCount",
			"codeRevision",
			"createdAt",
			"currentStep",
			"executionMode",
			"phase",
			"risk",
			"runId",
			"status",
			"taskContractDigest",
			"updatedAt",
			"workflow",
		]);
		expect(state.snapshot.graph?.nodes).toEqual([{ id: "preflight", kind: "preflight", status: "unknown" }]);
	});

	it("projects historical, unowned and recovered COMPLEX Runs, and never one from an older Run", async () => {
		const { store } = await durableComplex({
			stop: (run) => run.complex?.tasks[1].status === "ELIGIBLE",
		});
		// The owner stops without cleanup: the durable Run stays RUNNING until the next writer recovers it.
		await store.close();
		const client = await connect();
		const active = await observation(client);
		expect(active.state.snapshot.status.run).toMatchObject({ status: "RUNNING", workflow: "COMPLEX" });
		expect(active.state.complexExecution).toMatchObject({ phase: "TASK_SEQUENCE", activeTaskIds: ["CT-002"] });
		expect(active.state.ownedRunId).toBeNull();
		expect(complexConsumerIssues(active)).toEqual([]);
		const recovering = await FileStateStore.open(cwd);
		const recovered = await observation(client);
		expect(recovered.state.snapshot.status.run?.status).toBe("INTERRUPTED");
		expect(recovered.state.complexExecution).toMatchObject({
			phase: "TERMINAL",
			activeTaskIds: [],
			cleanup: "UNCONFIRMED",
			failureCode: "OWNER_LOST",
			stateRevision: recovered.state.stateRevision,
		});
		expect(recovered.state.complexExecution?.tasks.map((row) => row.status)).toEqual(["COMPLETED", "INTERRUPTED"]);
		// Recovery is an allowed transition of the same Run for the consumer.
		expect(complexConsumerIssues(recovered, active)).toEqual([]);
		// A later STANDARD Run replaces the latest Run: no projection, no stale one from the COMPLEX Run.
		const kernel = await CompanyKernel.create(
			{
				executionMode: "EDIT",
				runId: "standard-after-complex",
				task: testContract("Fix bug", { taskId: "task-standard" }),
				classification: classifyRequest("Fix bug").classification,
			},
			{
				store: recovering,
				agents: { execute: async () => Promise.reject(new Error("unused")) },
				verifier: { verify: async () => Promise.reject(new Error("unused")) },
			},
		);
		await kernel.start();
		await recovering.close();
		const replaced = await observation(client);
		expect(replaced.state.snapshot.status.run).toMatchObject({
			runId: "standard-after-complex",
			workflow: "STANDARD",
		});
		expect("complexExecution" in replaced.state).toBe(false);
		expect(complexConsumerIssues(replaced, recovered)).toEqual([]);
	});

	it("never publishes a partial projection: planless or oversized latest COMPLEX Runs fail closed", async () => {
		// A COMPLEX Run without a Host-confirmed plan (refused before execution) has no projection to publish.
		const legacy = await FileStateStore.open(cwd);
		const goal = "Refactor the parser across multiple modules";
		const planless = await CompanyKernel.create(
			{
				executionMode: "EDIT",
				runId: "planless-complex",
				task: testContract(goal, { taskId: "task-planless" }),
				classification: classifyRequest(goal).classification,
				workflow: "COMPLEX",
			},
			{
				store: legacy,
				agents: { execute: async () => Promise.reject(new Error("unused")) },
				verifier: { verify: async () => Promise.reject(new Error("unused")) },
			},
		);
		expect((await planless.start()).status).toBe("BLOCKED");
		await legacy.close();
		const first = await connect();
		expect(await first.send({ type: "control.snapshot" })).toMatchObject({
			success: false,
			error: { code: "STATE_UNAVAILABLE" },
		});
		// A projection over 32,768 bytes (a parent the Host compiler would never admit) is RESPONSE_TOO_LARGE.
		const files = new FakeFiles({ "src/app.ts": "app\n", "src/util.ts": "util\n" });
		const statements = Array.from({ length: 16 }, (_, index) => `Criterion ${index + 1} holds`);
		const { plan: small, parent: smallParent } = await complexPlanFor(TWO_TASKS, { files, statements });
		const parent = structuredClone(smallParent);
		for (const criterion of parent.acceptanceCriteria)
			criterion.scope.paths = Array.from({ length: 32 }, (_, index) => `area-${index}-${"s".repeat(200)}`);
		const { complexPlanDigest: _stale, ...material } = {
			...small,
			parentTaskContractDigest: taskContractDigest(parent),
		};
		const plan: ComplexPlan = { ...material, complexPlanDigest: complexPlanDigest(material) };
		const store = await FileStateStore.open(cwd);
		const h = complexHarness({ plan, parent, files });
		await CompanyKernel.create(h.request(), { ...h.ports, store }, () => 1000);
		await store.close();
		const client = await connect();
		expect(await client.send({ type: "control.snapshot" })).toMatchObject({
			success: false,
			error: { code: "RESPONSE_TOO_LARGE" },
		});
		expect(client.lines.join("")).not.toContain("complexExecution");
	});

	it("drops only whole inventory rows under response pressure and never shortens the projection", async () => {
		await configure();
		const { store } = await durableComplex();
		await store.close();
		const client = await connect();
		const baseline = await observation(client);
		expect(baseline.state.capabilityInventory?.omitted).toBe(0);
		const lineBytes = Buffer.byteLength(client.lines.at(-1)!);
		const inventoryBytes = Buffer.byteLength(JSON.stringify(baseline.state.capabilityInventory));
		const rows = [
			{
				id: "fixture",
				statement: "",
				sourceRef: "fixture",
				sourceDigest: `sha256:${"0".repeat(64)}`,
				reviewedAt: 0,
				status: "VALID" as const,
			},
		];
		vi.spyOn(facts, "loadProjectFactProjection").mockResolvedValue(() => rows);
		const entryBytes = Buffer.byteLength(JSON.stringify(rows[0])) + 1;
		// Synthetic canonical-state pressure (3-byte characters), not an accepted Project Fact registration.
		rows[0].statement = "한".repeat(Math.ceil((65536 - lineBytes - entryBytes + 600) / 3));
		const pressured = await observation(client);
		expect(pressured.state.capabilityInventory!.omitted).toBeGreaterThan(0);
		expect(pressured.state.complexExecution).toEqual(baseline.state.complexExecution);
		expect(complexConsumerIssues(pressured, baseline)).toEqual([]);
		rows[0].statement = "한".repeat(Math.ceil((65536 - lineBytes - entryBytes + inventoryBytes + 600) / 3));
		expect(await client.send({ type: "control.snapshot" })).toMatchObject({
			success: false,
			error: { code: "RESPONSE_TOO_LARGE" },
		});
	});
});
