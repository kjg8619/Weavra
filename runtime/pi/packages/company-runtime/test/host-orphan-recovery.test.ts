import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../src/agent-runner.ts";
import { classifyRequest } from "../src/classification.ts";
import type { Run } from "../src/contracts.ts";
import type { RuntimeEvent } from "../src/events.ts";
import { HostControlBridge } from "../src/host-control.ts";
import type { HostControlPreview, HostControlResponse, HostControlState } from "../src/host-control-protocol.ts";
import { CompanyKernel } from "../src/kernel.ts";
import type { PolicyContext } from "../src/policy.ts";
import { FileStateStore } from "../src/state-store.ts";
import { type ComplexObservation, complexConsumerIssues } from "./complex-conformance.ts";
import {
	type ComplexTaskSpec,
	complexHarness,
	complexPlanFor,
	driveComplex,
	FakeFiles,
	takeConsumerIssues,
} from "./complex-fixture.ts";
import { testContract } from "./fixture-contract.ts";

// A Host killed mid-run leaves its Run active and its writer lock behind. Only `workflow.prepare` recovers it, and only
// when the lock's same-host owner PID provably no longer exists; snapshots and every other lock stay untouched.

const config = {
	schemaVersion: 1,
	models: {
		profiles: { coding: { provider: "faux", model: "coding" }, reasoning: { provider: "faux", model: "review" } },
	},
	agents: { max_revision_cycles: 3 },
	files: { allowed_paths: ["src"] },
	verification: {
		checks: [
			{ id: "lint", kind: "lint", executable: "/usr/bin/true", args: [], required: false },
			{ id: "test", kind: "test", executable: "/usr/bin/true", args: [] },
		],
	},
};
const complexGoal = "Refactor the parser across multiple modules";
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
const TWO_TASKS: ComplexTaskSpec[] = [
	{ claims: [{ path: "src/app.ts", operation: "modify" }] },
	{ claims: [{ path: "src/new.ts", operation: "create" }] },
];

let cwd: string;
const bridges: HostControlBridge[] = [];
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "wv-orphan-"));
	await mkdir(join(cwd, ".ai"));
	await mkdir(join(cwd, "src"));
	await writeFile(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	await writeFile(join(cwd, ".gitignore"), ".ai/\n");
	await writeFile(join(cwd, "src/app.ts"), "export const app = 1;\n");
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			[
				"-c",
				"user.name=Orphan",
				"-c",
				"user.email=orphan@example.invalid",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"core.hooksPath=/dev/null",
				...args,
			],
			{ cwd, stdio: "ignore" },
		);
	git("init", "-q");
	git("add", "--", ".gitignore", "src");
	git("commit", "-qm", "fixture");
});
afterEach(async () => {
	vi.restoreAllMocks();
	for (const bridge of bridges.splice(0)) await bridge.shutdown();
	await rm(cwd, { recursive: true, force: true });
	await rm(`${cwd}-agent`, { recursive: true, force: true });
	expect(takeConsumerIssues()).toEqual([]);
});

/** A PID that belonged to a process which has already exited on this host. */
function deadPid(): number {
	const child = spawnSync(process.execPath, ["-e", ""]);
	if (!child.pid) throw new Error("No child PID");
	return child.pid;
}
/** The lock a writer leaves behind, in the format `FileStateStore.open` writes. */
async function ownerLock(owner: Record<string, unknown>) {
	await writeFile(
		join(cwd, ".ai/writer.lock"),
		JSON.stringify({ schemaVersion: 1, projectPath: await realpath(cwd), token: "orphan-owner", ...owner }),
		{ mode: 0o600 },
	);
}
const deadOwnerLock = () => ownerLock({ pid: deadPid(), hostname: hostname() });
async function aiFiles(): Promise<Record<string, string>> {
	const names = (await readdir(join(cwd, ".ai"))).sort();
	return Object.fromEntries(
		await Promise.all(names.map(async (name) => [name, await readFile(join(cwd, ".ai", name), "utf8")] as const)),
	);
}
const durableRuns = async (): Promise<Run[]> => (await FileStateStore.readSnapshot(cwd)).state?.runs ?? [];

/** A STANDARD Run whose owner died mid-implementation, with one action intent still in flight. */
async function standardOrphan(): Promise<Run> {
	const store = await FileStateStore.open(cwd);
	const kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: "orphan-standard",
			task: testContract("Fix bug", { taskId: "task-orphan" }),
			classification: classifyRequest("Fix bug").classification,
		},
		{
			store,
			agents: { execute: async () => Promise.reject(new Error("unused")) },
			verifier: { verify: async () => Promise.reject(new Error("unused")) },
		},
	);
	await kernel.start();
	await store.prepare({
		executionMode: "EDIT",
		runId: "orphan-standard",
		actionId: "in-flight",
		role: "Developer",
		risk: "R1",
		decision: "ALLOW",
		reason: "Ordinary edit",
		actionDigest: "digest",
		configDigest: "config",
	});
	// The owner process dies: its durable Run stays RUNNING and its lock names a PID that no longer exists.
	await store.close();
	await deadOwnerLock();
	return kernel.snapshot;
}
/** A COMPLEX Run whose owner died after CT-001 COMPLETED, while CT-002 was next. */
async function complexOrphan(): Promise<Run> {
	const store = await FileStateStore.open(cwd);
	const files = new FakeFiles({ "src/app.ts": "app\n", "src/util.ts": "util\n" });
	const { plan, parent } = await complexPlanFor(TWO_TASKS, { files });
	const h = complexHarness({ plan, parent, files });
	const kernel = await CompanyKernel.create(h.request(), { ...h.ports, store: h.consumer.wrap(store) }, () => 1000);
	const run = await driveComplex(kernel, (value) => value.complex?.tasks[1].status === "ELIGIBLE");
	await store.close();
	await deadOwnerLock();
	return run;
}

/**
 * The confirmed start runs the real Workflow, Kernel, Git workspace and registered checks; only the worker is scripted
 * to fail, so a new Run exists and ends without any completion claim.
 */
function scriptedWorkers() {
	return vi.spyOn(PiAgentExecutor, "create").mockImplementation(async (options) => {
		const policyContext: PolicyContext = {
			executionMode: options.executionContract.mode,
			executionRunId: options.executionContract.runId,
			tools: [],
			allowedPaths: [...options.config.files.allowed_paths],
			configDigest: "sha256:scripted",
			projectInstruction: null,
			protectedPaths: [],
		};
		return {
			policyContext,
			safeToRelease: true,
			execute: async () => {
				throw new Error("Scripted worker failure");
			},
		} as unknown as PiAgentExecutor;
	});
}

async function connect() {
	const events: RuntimeEvent[] = [];
	const createModels = vi.fn(async () => ({}) as ModelRuntime);
	const bridge = await HostControlBridge.create({
		cwd,
		projectTrusted: true,
		agentDir: `${cwd}-agent`,
		readiness: "READY",
		createModels,
		events: { emit: (event) => void events.push(event) },
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
	if (!hello.success || hello.data.kind !== "capabilities") throw new Error(JSON.stringify(hello));
	const capabilities = hello.data.capabilities;
	/** One full control observation through the real request/response path. */
	const observe = async (): Promise<ComplexObservation> => {
		const response = await send({ type: "control.snapshot" });
		if (!response.success || response.data.kind !== "snapshot") throw new Error(JSON.stringify(response));
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
	};
	const state = async (): Promise<HostControlState> => (await observe()).state;
	const mutation = async (fields: Record<string, unknown>) => {
		const current = await state();
		return send({
			id: current.nextRequestId,
			ownerId: current.ownerId,
			expectedProjectRevision: current.projectRevision,
			...fields,
		});
	};
	const prepare = async (fields: Record<string, unknown>): Promise<HostControlPreview> => {
		const response = await mutation({ type: "workflow.prepare", ...fields });
		if (!response.success || response.data.kind !== "prepared") throw new Error(JSON.stringify(response));
		return response.data.preview;
	};
	/** Confirms the preview and waits for the owned execution to settle. */
	const confirm = async (preview: HostControlPreview): Promise<HostControlState> => {
		const accepted = await mutation({
			type: "workflow.confirm",
			previewId: preview.previewId,
			previewDigest: preview.previewDigest,
		});
		expect(accepted).toMatchObject({ success: true, data: { kind: "accepted", command: "workflow.confirm" } });
		let settled = await state();
		await vi.waitFor(
			async () => {
				settled = await state();
				expect(settled.busy).toBe(false);
			},
			{ timeout: 20_000 },
		);
		return settled;
	};
	return { bridge, events, createModels, send, observe, state, mutation, prepare, confirm };
}

describe("Host prepare recovery of a provably dead same-host owner", () => {
	it("keeps the orphan visible to snapshots; a prepare recovers it with STALE_PROJECT; the next prepare and confirm start a new Run", async () => {
		const orphan = await standardOrphan();
		const before = await FileStateStore.readSnapshot(cwd);
		const revision = before.state!.revision;
		const files = await aiFiles();
		const client = await connect();
		// control.snapshot stays read-only: the orphan, its lock and every byte under .ai survive repeated reads.
		for (let read = 0; read < 3; read++) {
			const seen = await client.state();
			expect(seen).toMatchObject({ projectRevision: revision, ownedRunId: null, busy: false, preview: null });
			expect(seen.snapshot.status).toMatchObject({
				writerPresent: true,
				run: { runId: orphan.runId, status: "RUNNING" },
			});
		}
		expect(await aiFiles()).toEqual(files);
		expect(client.events).toEqual([]);
		// Settling the dead owner's Run moves the revision the client sent: STALE_PROJECT, and nothing is prepared.
		expect(await client.mutation({ type: "workflow.prepare", goal: "Fix bug in src/app.ts" })).toMatchObject({
			success: false,
			error: { code: "STALE_PROJECT" },
		});
		const recovered = (await durableRuns()).find((run) => run.runId === orphan.runId)!;
		expect(recovered).toMatchObject({
			status: "INTERRUPTED",
			revision: orphan.revision + 1,
			activeAgents: [],
			lastError: "Previous owner stopped; inspect workspace and start a new run. No automatic resume.",
		});
		expect((await FileStateStore.readSnapshot(cwd)).state?.actions.map((action) => action.status)).toEqual([
			"INTERRUPTED",
		]);
		// The dead owner's lock is gone and the recovery released its own; no recovery guard remains.
		expect((await readdir(join(cwd, ".ai"))).sort()).toEqual(["config.yaml", "state.json", "tasks.json"]);
		expect(client.events).toEqual([
			expect.objectContaining({ type: "RunInterrupted", runId: orphan.runId, stateRevision: recovered.revision }),
		]);
		const idle = await client.state();
		expect(idle).toMatchObject({ projectRevision: revision + 1, preview: null });
		expect(idle.snapshot.status).toMatchObject({
			writerPresent: false,
			run: { runId: orphan.runId, status: "INTERRUPTED" },
		});
		// The next prepare runs normally at the recovered revision; the guarded confirm start then creates a new Run.
		const preview = await client.prepare({ goal: "Fix bug in src/app.ts" });
		expect(preview).toMatchObject({ workflow: "STANDARD", projectRevision: revision + 1 });
		expect(client.events).toHaveLength(1);
		scriptedWorkers();
		const settled = await client.confirm(preview);
		expect(client.createModels).toHaveBeenCalledOnce();
		expect(settled).toMatchObject({ startFailure: null, preview: null });
		expect(settled.snapshot.status).toMatchObject({ writerPresent: false, run: { status: "FAILED" } });
		const runs = await durableRuns();
		expect(runs.map((run) => [run.runId === orphan.runId, run.status])).toEqual([
			[true, "INTERRUPTED"],
			[false, "FAILED"],
		]);
		// Nothing was resumed: the orphan is exactly its recovered record.
		expect(runs[0]).toEqual(recovered);
		expect(runs[1].lastError).toBe("Scripted worker failure");
	});

	it("recovers a COMPLEX orphan: unfinished rows INTERRUPTED/OWNER_LOST, COMPLETED rows kept, one consistent transition", async () => {
		const orphan = await complexOrphan();
		expect(orphan.complex?.tasks.map((row) => row.status)).toEqual(["COMPLETED", "ELIGIBLE"]);
		const client = await connect();
		const active = await client.observe();
		expect(active.state.snapshot.status).toMatchObject({ writerPresent: true, run: { status: "RUNNING" } });
		expect(active.state.complexExecution).toMatchObject({ phase: "TASK_SEQUENCE", activeTaskIds: ["CT-002"] });
		expect(complexConsumerIssues(active)).toEqual([]);
		expect(await client.mutation({ type: "workflow.prepare", goal: complexGoal, complexDraft })).toMatchObject({
			success: false,
			error: { code: "STALE_PROJECT" },
		});
		const recovered = await client.observe();
		expect(recovered.state).toMatchObject({ projectRevision: active.state.projectRevision + 1, preview: null });
		expect(recovered.state.snapshot.status).toMatchObject({
			writerPresent: false,
			run: { runId: orphan.runId, status: "INTERRUPTED" },
		});
		expect(recovered.state.complexExecution).toMatchObject({
			phase: "TERMINAL",
			activeTaskIds: [],
			cleanup: "UNCONFIRMED",
			failureCode: "OWNER_LOST",
			partialChanges: true,
			changesUnknown: true,
		});
		expect(recovered.state.complexExecution?.tasks.map((row) => [row.status, row.failureCode])).toEqual([
			["COMPLETED", null],
			["INTERRUPTED", "OWNER_LOST"],
		]);
		// For the App consumer the recovery is an allowed later revision of the same Run; nothing is resumed.
		expect(complexConsumerIssues(recovered, active)).toEqual([]);
		expect(client.events).toEqual([
			expect.objectContaining({
				type: "RunInterrupted",
				runId: orphan.runId,
				complexBinding: {
					parentTaskContractDigest: orphan.complex?.plan.parentTaskContractDigest,
					complexPlanDigest: orphan.complex?.plan.complexPlanDigest,
				},
			}),
		]);
		const history = (await durableRuns())[0];
		expect(history.complex?.tasks[0]).toEqual(orphan.complex?.tasks[0]);
		const preview = await client.prepare({ goal: complexGoal, complexDraft });
		expect(preview).toMatchObject({ workflow: "COMPLEX", projectRevision: recovered.state.projectRevision });
		scriptedWorkers();
		expect(await client.confirm(preview)).toMatchObject({ startFailure: null, preview: null });
		// A new COMPLEX Run started under a new writer; its scripted worker failure settles it with confirmed cleanup.
		const settled = await client.observe();
		expect(settled.state.snapshot.status.run?.runId).not.toBe(orphan.runId);
		expect(settled.state.snapshot.status).toMatchObject({
			writerPresent: false,
			run: { workflow: "COMPLEX", status: "FAILED" },
		});
		expect(settled.state.complexExecution).toMatchObject({
			phase: "TERMINAL",
			cleanup: "CONFIRMED",
			failureCode: "WORKER_FAILED",
		});
		expect(complexConsumerIssues(settled, recovered)).toEqual([]);
		expect((await durableRuns())[0]).toEqual(history);
	});

	it.each<[string, () => Promise<void>]>([
		["an owner that is still alive", () => ownerLock({ pid: process.pid, hostname: hostname() })],
		["an owner on another host", () => ownerLock({ pid: deadPid(), hostname: `${hostname()}-other` })],
		["an older lock without a hostname", () => ownerLock({ pid: deadPid() })],
		["a PID that cannot be signalled", () => ownerLock({ pid: 1, hostname: hostname() })],
		["an invalid PID", () => ownerLock({ pid: -1, hostname: hostname() })],
		["an unreadable lock", () => writeFile(join(cwd, ".ai/writer.lock"), "not a lock")],
		[
			"another recoverer's guard",
			async () => {
				await deadOwnerLock();
				await writeFile(join(cwd, ".ai/writer.lock.recovery"), "other recoverer");
			},
		],
	])("keeps %s: prepare fails WRITER_PRESENT exactly as before and writes nothing", async (_name, lock) => {
		const orphan = await standardOrphan();
		await rm(join(cwd, ".ai/writer.lock"));
		await lock();
		const files = await aiFiles();
		const client = await connect();
		expect(await client.mutation({ type: "workflow.prepare", goal: "Fix bug in src/app.ts" })).toMatchObject({
			success: false,
			error: { code: "WRITER_PRESENT" },
		});
		expect(await aiFiles()).toEqual(files);
		expect(client.events).toEqual([]);
		const seen = await client.state();
		expect(seen.preview).toBeNull();
		expect(seen.snapshot.status).toMatchObject({
			writerPresent: true,
			run: { runId: orphan.runId, status: "RUNNING" },
		});
	});

	it("keeps an active Run without any writer lock: no owner to prove dead, prepare fails ACTIVE_RUN", async () => {
		const orphan = await standardOrphan();
		await rm(join(cwd, ".ai/writer.lock"));
		const files = await aiFiles();
		const client = await connect();
		expect(await client.mutation({ type: "workflow.prepare", goal: "Fix bug in src/app.ts" })).toMatchObject({
			success: false,
			error: { code: "ACTIVE_RUN" },
		});
		expect(await aiFiles()).toEqual(files);
		expect((await client.state()).snapshot.status).toMatchObject({
			writerPresent: false,
			run: { runId: orphan.runId, status: "RUNNING" },
		});
	});

	it("never recovers for a stale expected revision; recovers only at the revision the client saw", async () => {
		await standardOrphan();
		const files = await aiFiles();
		const client = await connect();
		const seen = await client.state();
		const prepareAt = async (expectedProjectRevision: number) =>
			client.send({
				id: (await client.state()).nextRequestId,
				ownerId: seen.ownerId,
				expectedProjectRevision,
				type: "workflow.prepare",
				goal: "Fix bug in src/app.ts",
			});
		for (const stale of [seen.projectRevision - 1, seen.projectRevision + 1])
			expect(await prepareAt(stale)).toMatchObject({ success: false, error: { code: "STALE_PROJECT" } });
		expect(await aiFiles()).toEqual(files);
		expect(client.events).toEqual([]);
		// The same answer at the seen revision, but now the recovery is done and the next prepare succeeds.
		expect(await prepareAt(seen.projectRevision)).toMatchObject({ success: false, error: { code: "STALE_PROJECT" } });
		expect(client.events.map((event) => event.type)).toEqual(["RunInterrupted"]);
		expect(await client.prepare({ goal: "Fix bug in src/app.ts" })).toMatchObject({
			projectRevision: seen.projectRevision + 1,
		});
	});

	it("releases a dead owner's lock over an idle project in the same prepare: no revision change, no STALE_PROJECT", async () => {
		const store = await FileStateStore.open(cwd);
		const kernel = await CompanyKernel.create(
			{
				executionMode: "EDIT",
				runId: "finished",
				task: testContract("Fix bug", { taskId: "task-finished" }),
				classification: classifyRequest("Fix bug").classification,
			},
			{
				store,
				agents: { execute: async () => Promise.reject(new Error("unused")) },
				verifier: { verify: async () => Promise.reject(new Error("unused")) },
			},
		);
		await kernel.start();
		await kernel.stop("CANCELLED", "Owner finished");
		// Killed after its terminal save but before releasing the lock: nothing is left to settle.
		await store.close();
		await deadOwnerLock();
		const state = await readFile(join(cwd, ".ai/state.json"), "utf8");
		const client = await connect();
		const seen = await client.state();
		expect(seen.snapshot.status).toMatchObject({ writerPresent: true, run: { status: "CANCELLED" } });
		expect(await client.prepare({ goal: "Fix bug in src/app.ts" })).toMatchObject({
			projectRevision: seen.projectRevision,
		});
		expect(await readFile(join(cwd, ".ai/state.json"), "utf8")).toBe(state);
		expect((await readdir(join(cwd, ".ai"))).sort()).toEqual(["config.yaml", "state.json", "tasks.json"]);
		expect(client.events).toEqual([]);
	});
});
