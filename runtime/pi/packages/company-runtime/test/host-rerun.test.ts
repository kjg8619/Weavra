import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../src/agent-runner.ts";
import { classifyRequest } from "../src/classification.ts";
import type { Risk, Run } from "../src/contracts.ts";
import type { RuntimeEvent } from "../src/events.ts";
import type { HostControlOptions } from "../src/host-control.ts";
import {
	HOST_CONTROL_COMMANDS,
	HOST_CONTROL_ERROR_CODES,
	HOST_RERUN_COMMANDS,
	HOST_RERUN_DRAFT_MAX_RESPONSE_BYTES,
	type HostControlData,
	type HostControlResponse,
	RERUN_PREPARE_CHECK_CODES,
} from "../src/host-control-protocol.ts";
import { CompanyKernel } from "../src/kernel.ts";
import type { PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import { FileStateStore } from "../src/state-store.ts";
import { GitWorkspace } from "../src/workspace.ts";
import {
	COMPLEX_GOAL,
	type ComplexTaskSpec,
	complexHarness,
	complexPlanFor,
	driveComplex,
	FakeFiles,
	takeConsumerIssues,
} from "./complex-fixture.ts";
import { testContract } from "./fixture-contract.ts";
import { CONFIG, type Connection, deferred, type PlannerProject, plannerClient } from "./planner-fixture.ts";

// V0.8C `workflow.derive` over the real Host Control bridge, a real Git checkout and durable Kernel Runs
// (COMPLEX_RERUN.md §3–§6; the #58 R01–R06 Runtime boundary). No model is called and nothing is resumed.

const INITIAL = { "src/app.ts": "export const app = 1;\n", "src/util.ts": "export const util = 1;\n" };
const STATEMENTS = ["Parsing is modular", "Duplicate keys are rejected"];
/** CT-001 modifies src/app.ts; CT-002 (after CT-001) creates src/new.ts. */
const TWO_TASKS: ComplexTaskSpec[] = [
	{ claims: [{ path: "src/app.ts", operation: "modify" }] },
	{ claims: [{ path: "src/new.ts", operation: "create" }] },
];

interface Project {
	root: string;
	cwd: string;
	agentDir: string;
	git(...args: string[]): string;
}
let project: Project | undefined;
const connections: Connection[] = [];
afterEach(async () => {
	vi.restoreAllMocks();
	for (const connection of connections.splice(0)) await connection.bridge.shutdown();
	if (project) await rm(project.root, { recursive: true, force: true });
	project = undefined;
	expect(takeConsumerIssues()).toEqual([]);
});

/** A Git checkout whose `.ai/` is ignored (or, with `ignoreAi: false`, visible to `git status` beside a committed config). */
async function gitProject(options: { ignoreAi?: boolean } = {}): Promise<Project> {
	const root = await realpath(await mkdtemp(join(tmpdir(), "wv-rerun-")));
	const cwd = join(root, "project");
	const agentDir = join(root, "agent");
	await mkdir(join(cwd, ".ai"), { recursive: true });
	await mkdir(join(cwd, "src"));
	await mkdir(agentDir);
	await writeFile(join(cwd, ".ai/config.yaml"), JSON.stringify(CONFIG));
	await writeFile(join(cwd, ".gitignore"), options.ignoreAi === false ? "" : ".ai/\n");
	for (const [path, content] of Object.entries(INITIAL)) await writeFile(join(cwd, path), content);
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			[
				"-c",
				"user.name=Rerun",
				"-c",
				"user.email=rerun@example.invalid",
				"-c",
				"commit.gpgsign=false",
				"-c",
				"core.hooksPath=/dev/null",
				...args,
			],
			{ cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
		);
	git("init", "-q");
	git("add", "--", ".gitignore", "src", ...(options.ignoreAi === false ? [".ai/config.yaml"] : []));
	git("commit", "-qm", "fixture");
	project = { root, cwd, agentDir, git };
	return project;
}

type Harness = ReturnType<typeof complexHarness>;
/** The task's one selected check fails at SELF_CHECK: the task and the Run end BLOCKED/CHECK_FAILED. */
function failCheck(taskId: string) {
	return (h: Harness) => {
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			const result = await verify(request);
			if (request.complexContext?.taskId === taskId)
				result.checks[0] = { ...result.checks[0], status: "FAIL", exitCode: 1, reason: "Fake check failed" };
			return result;
		};
	};
}
/** A durable COMPLEX Run through the real Kernel and FileStateStore, with scripted workers over in-memory files. */
async function durable(
	cwd: string,
	options: {
		specs?: ComplexTaskSpec[];
		runId?: string;
		files?: Record<string, string>;
		risk?: Risk;
		goal?: string;
		statements?: string[];
		script?: (h: Harness) => void;
		stop?: (run: Run) => boolean;
	} = {},
): Promise<{ run: Run; files: FakeFiles }> {
	const store = await FileStateStore.open(cwd);
	try {
		const files = new FakeFiles(options.files ?? INITIAL);
		const shape = {
			...(options.goal ? { goal: options.goal } : {}),
			...(options.risk ? { risk: options.risk } : {}),
		};
		const { plan, parent } = await complexPlanFor(options.specs ?? TWO_TASKS, {
			files,
			...shape,
			...(options.statements ? { statements: options.statements } : {}),
		});
		const h = complexHarness({ plan, parent, files, ...shape });
		options.script?.(h);
		const kernel = await CompanyKernel.create(
			{ ...h.request(), runId: options.runId ?? "run-1" },
			{ ...h.ports, store: h.consumer.wrap(store) },
			() => 1000,
		);
		return { run: await driveComplex(kernel, options.stop), files };
	} finally {
		await store.close();
	}
}
/** The checkout the source Run left: every in-memory file on disk, the removed initial files gone. */
async function mirror(cwd: string, files: FakeFiles): Promise<void> {
	for (const path of Object.keys(INITIAL)) if (!files.files.has(path)) await rm(join(cwd, path), { force: true });
	for (const [path, file] of files.files) await writeFile(join(cwd, path), file.content);
}
/** A later terminal STANDARD Run, so the COMPLEX Run before it is no longer the latest. */
async function standardRun(cwd: string, runId: string): Promise<Run> {
	const store = await FileStateStore.open(cwd);
	try {
		const kernel = await CompanyKernel.create(
			{
				executionMode: "EDIT",
				runId,
				task: testContract("Fix bug", { taskId: `task-${runId}` }),
				classification: classifyRequest("Fix bug").classification,
			},
			{
				store,
				agents: { execute: async () => Promise.reject(new Error("unused")) },
				verifier: { verify: async () => Promise.reject(new Error("unused")) },
			},
		);
		await kernel.start();
		await kernel.stop("CANCELLED", "Stopped by the test");
		return kernel.snapshot;
	} finally {
		await store.close();
	}
}
async function connect(options: Partial<HostControlOptions> = {}): Promise<Connection> {
	const { cwd, agentDir } = project!;
	const host: PlannerProject = {
		cwd,
		agentDir,
		cleanup: async () => {},
		configure: async (value?: unknown) => writeFile(join(cwd, ".ai/config.yaml"), JSON.stringify(value ?? CONFIG)),
		aiFiles: async () => aiTree(cwd),
	};
	const client = await plannerClient(host, options);
	connections.push(client);
	return client;
}
const failure = (response: HostControlResponse) => (response.success ? null : response.error.code);
const derive = (client: Connection, runId: string, fields: Record<string, unknown> = {}) =>
	client.mutation({ type: "workflow.derive", runId, ...fields });
type DerivedDraft = Extract<HostControlData, { kind: "derived-draft" }>;
function derived(response: HostControlResponse): DerivedDraft {
	if (!response.success || response.data.kind !== "derived-draft") throw new Error(JSON.stringify(response));
	return response.data;
}
/** A request with an explicit expected revision (the client helper always sends the current one). */
async function deriveAt(client: Connection, runId: string, expectedProjectRevision: number) {
	const state = await client.state();
	return client.send({
		id: state.nextRequestId,
		ownerId: state.ownerId,
		expectedProjectRevision,
		type: "workflow.derive",
		runId,
	});
}
/** Every byte under `.ai/`, recursively. */
async function aiTree(cwd: string): Promise<Record<string, string>> {
	const entries = await readdir(join(cwd, ".ai"), { recursive: true, withFileTypes: true });
	const files = entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
	return Object.fromEntries(
		await Promise.all(
			files.sort().map(async (file) => [file.slice(cwd.length + 1), (await readFile(file)).toString("base64")]),
		),
	);
}
/** HEAD, the index bytes and the clean-start status, read without refreshing the index. */
async function gitState(p: Project) {
	return {
		head: p.git("rev-parse", "HEAD"),
		index: createHash("sha256")
			.update(await readFile(join(p.cwd, ".git/index")))
			.digest("hex"),
		status: p.git("--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"),
	};
}
async function lock(cwd: string, pid: number): Promise<string> {
	const text = JSON.stringify({
		schemaVersion: 1,
		projectPath: await realpath(cwd),
		token: "other-owner",
		pid,
		hostname: hostname(),
	});
	await writeFile(join(cwd, ".ai/writer.lock"), text, { mode: 0o600 });
	return text;
}
function deadPid(): number {
	const child = spawnSync(process.execPath, ["-e", ""]);
	if (!child.pid) throw new Error("No child PID");
	return child.pid;
}
/** The confirmed start runs the real Workflow, Kernel and Git workspace; only the worker is scripted to fail. */
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
/** R01's source: CT-001 COMPLETED (changed src/app.ts), CT-002 BLOCKED by its check with a partial src/new.ts. */
async function r01(p: Project) {
	const { run, files } = await durable(p.cwd, { script: failCheck("CT-002") });
	expect(run.status).toBe("BLOCKED");
	expect(run.complex?.tasks.map((row) => [row.status, row.failureCode, row.changedFiles])).toEqual([
		["COMPLETED", null, ["src/app.ts"]],
		["BLOCKED", "CHECK_FAILED", ["src/new.ts"]],
	]);
	await mirror(p.cwd, files);
	return run;
}
const VERIFY_TASK_1 = {
	title: "Verify: Task 1",
	goal: "Re-verify without changes: Contribution 1",
	dependsOnIndexes: [],
	criterionIndexes: [1, 2],
	ownership: [],
	checkIds: ["test"],
};

describe("§6 wire", () => {
	it("advertises rerunContractVersion 1 beside the unchanged commands tuple and accepts workflow.derive", async () => {
		await gitProject();
		const client = await connect();
		expect(client.hello).toMatchObject({
			success: true,
			data: {
				kind: "capabilities",
				capabilities: { rerunContractVersion: 1, plannerContractVersion: 1, complexContractVersion: 2 },
			},
		});
		if (!client.hello.success || client.hello.data.kind !== "capabilities") throw new Error("capabilities expected");
		// Older Apps decode the advertised tuple strictly, so it stays exactly the V0.8A list.
		expect(client.hello.data.capabilities.commands).toEqual([
			"control.hello",
			"control.snapshot",
			"workflow.prepare",
			"workflow.confirm",
			"workflow.cancel",
			"approval.resolve",
			"browser.inspect",
			"browser.prepare",
			"browser.confirm",
			"facts.prepare",
			"facts.confirm",
		]);
		expect(client.hello.data.capabilities.commands).toEqual(HOST_CONTROL_COMMANDS);
		expect(HOST_RERUN_COMMANDS).toEqual(["workflow.derive"]);
		expect(HOST_CONTROL_ERROR_CODES.at(-1)).toBe("RERUN_NOT_APPLICABLE");
		// `prepareCheck.code` is only ever one of the prepare pipeline's existing codes.
		expect(RERUN_PREPARE_CHECK_CODES).toEqual([
			"INVALID_REQUEST",
			"INVALID_GOAL",
			"UNSUPPORTED_WORKFLOW",
			"INVALID_CRITERIA",
			"RESPONSE_TOO_LARGE",
		]);
		for (const code of RERUN_PREPARE_CHECK_CODES) expect(HOST_CONTROL_ERROR_CODES).toContain(code);
		// Accepted when requested: an empty project has no Run to derive from.
		expect(failure(await derive(client, "run-1"))).toBe("RUN_NOT_FOUND");
		// The mutation envelope with exactly `{ runId }`.
		expect(failure(await client.mutation({ type: "workflow.derive" }))).toBe("INVALID_REQUEST");
		expect(failure(await derive(client, "run 1"))).toBe("INVALID_REQUEST");
		expect(failure(await derive(client, "run-1", { complexDraft: { tasks: [] } }))).toBe("INVALID_REQUEST");
		expect(failure(await derive(client, "run-1", { expectedStateRevision: 1 }))).toBe("INVALID_REQUEST");
		const state = await client.state();
		expect(
			failure(
				await client.send({
					id: state.nextRequestId,
					expectedProjectRevision: 0,
					type: "workflow.derive",
					runId: "x",
				}),
			),
		).toBe("INVALID_REQUEST");
		expect(client.createModels).not.toHaveBeenCalled();
	});
});

describe("§4–§5 derivation over a real checkout (R01, R05)", () => {
	it("derives a verification task and a create→modify claim, lists the leftovers and changes nothing", async () => {
		const p = await gitProject();
		const run = await r01(p);
		const client = await connect();
		const before = { ai: await aiTree(p.cwd), git: await gitState(p), state: await client.state() };
		expect(before.state.snapshot.status).toMatchObject({ writerPresent: false, run: { status: "BLOCKED" } });
		const open = vi.spyOn(FileStateStore, "open");
		const recover = vi.spyOn(FileStateStore, "recoverDeadOwner");
		const response = await derive(client, run.runId);
		const line = client.lines.at(-1)!;
		const data = derived(response);
		expect(data).toEqual({
			kind: "derived-draft",
			runId: run.runId,
			sourcePlanDigest: run.complex!.plan.complexPlanDigest,
			sourceStatus: "BLOCKED",
			goal: COMPLEX_GOAL,
			acceptanceStatements: STATEMENTS,
			draft: {
				tasks: [
					VERIFY_TASK_1,
					{
						title: "Task 2",
						goal: "Contribution 2",
						dependsOnIndexes: [1],
						criterionIndexes: [1, 2],
						ownership: [{ path: "src/new.ts", operation: "modify" }],
						checkIds: ["test"],
					},
				],
			},
			prepareCheck: { ok: true, code: null },
			leftovers: { clean: false, paths: ["src/app.ts", "src/new.ts"], truncated: false },
			notes: ["CT-002 claim src/new.ts: create became modify (file exists)"],
		} satisfies DerivedDraft);
		expect(response).toMatchObject({
			success: true,
			command: "workflow.derive",
			projectRevision: before.state.projectRevision,
		});
		expect(Buffer.byteLength(line)).toBeLessThanOrEqual(HOST_RERUN_DRAFT_MAX_RESPONSE_BYTES);
		// Read-only: no model, writer, recovery, `.ai` write, Git change or revision change.
		expect(open).not.toHaveBeenCalled();
		expect(recover).not.toHaveBeenCalled();
		expect(client.createModels).not.toHaveBeenCalled();
		expect(await aiTree(p.cwd)).toEqual(before.ai);
		expect(await gitState(p)).toEqual(before.git);
		const after = await client.state();
		expect(after.projectRevision).toBe(before.state.projectRevision);
		expect(after.stateRevision).toBe(before.state.stateRevision);
		expect(after.snapshot.status).toMatchObject({
			writerPresent: false,
			run: { runId: run.runId, status: "BLOCKED" },
		});
		// The snapshot is unchanged: the same keys and no draft.
		expect(Object.keys(after)).toEqual(Object.keys(before.state));
		expect(client.lines.at(-1)).not.toContain("derived");
		// R05: the same source, files and configuration give byte-identical data, also on another Host.
		expect(JSON.stringify(derived(await derive(client, run.runId)))).toBe(JSON.stringify(data));
		const other = await connect();
		expect(JSON.stringify(derived(await derive(other, run.runId)))).toBe(JSON.stringify(data));
		expect(await aiTree(p.cwd)).toEqual(before.ai);
		expect(await gitState(p)).toEqual(before.git);
		expect(open).not.toHaveBeenCalled();
	});

	it("after the user resolves the leftovers, derive again restores create; the prepared Run is new (R01, R06)", async () => {
		const p = await gitProject();
		const run = await r01(p);
		// The user's own actions: keep task 1's file, discard task 2's partial file.
		p.git("add", "--", "src/app.ts");
		p.git("commit", "-qm", "keep CT-001");
		await rm(join(p.cwd, "src/new.ts"));
		const client = await connect({ createModels: vi.fn(async () => ({}) as ModelRuntime) });
		const data = derived(await derive(client, run.runId));
		expect(data.draft.tasks).toEqual([
			VERIFY_TASK_1,
			{
				title: "Task 2",
				goal: "Contribution 2",
				dependsOnIndexes: [1],
				criterionIndexes: [1, 2],
				ownership: [{ path: "src/new.ts", operation: "create" }],
				checkIds: ["test"],
			},
		]);
		expect(data).toMatchObject({
			notes: [],
			prepareCheck: { ok: true, code: null },
			leftovers: { clean: true, paths: [], truncated: false },
		});
		// The unchanged draft prepares at once, with the same AC IDs for the same statements.
		const prepared = await client.mutation({
			type: "workflow.prepare",
			goal: data.goal,
			acceptanceStatements: data.acceptanceStatements,
			complexDraft: data.draft,
		});
		if (!prepared.success || prepared.data.kind !== "prepared") throw new Error(JSON.stringify(prepared));
		const { preview } = prepared.data;
		const sourceParent = run.tasks[0];
		if (!("acceptanceCriteria" in sourceParent)) throw new Error("parent expected");
		expect(preview.acceptanceCriteria.map((criterion) => [criterion.id, criterion.statement])).toEqual(
			sourceParent.acceptanceCriteria.map((criterion) => [criterion.id, criterion.statement]),
		);
		// New identities: parent, plan and digest are never the source's.
		expect(preview.complexPlan?.parentTaskId).not.toBe(sourceParent.id);
		expect(preview.complexPlan?.planId).not.toBe(run.complex?.plan.planId);
		expect(preview.complexPlan?.complexPlanDigest).not.toBe(data.sourcePlanDigest);
		expect(preview.taskContractDigest).not.toBe(run.taskContractDigest);
		scriptedWorkers();
		const { previewId, previewDigest } = preview;
		expect(await client.mutation({ type: "workflow.confirm", previewId, previewDigest })).toMatchObject({
			success: true,
			data: { kind: "accepted", command: "workflow.confirm" },
		});
		await vi.waitFor(async () => expect((await client.state()).busy).toBe(false), { timeout: 20_000, interval: 20 });
		const runs = (await FileStateStore.readSnapshot(p.cwd)).state?.runs ?? [];
		expect(runs).toHaveLength(2);
		const [history, next] = runs;
		// The source Run stays history, byte for byte; nothing was resumed.
		expect(JSON.stringify(history)).toBe(JSON.stringify(run));
		expect(next.runId).not.toBe(run.runId);
		expect(next.tasks[0].id).toBe(preview.complexPlan?.parentTaskId);
		expect(next.complex?.plan.complexPlanDigest).toBe(preview.complexPlan?.complexPlanDigest);
		// No gate starts PASS and no row is COMPLETED: the source's CT-001 PASS was not carried over.
		expect(next.status).toBe("FAILED");
		expect(next.complex?.tasks.map((row) => [row.status, row.selfCheck, row.review, row.test])).toEqual([
			["FAILED", "NOT_RUN", "NOT_RUN", "NOT_RUN"],
			["BLOCKED", "NOT_RUN", "NOT_RUN", "NOT_RUN"],
		]);
		expect(next.verification).toEqual([]);
		for (const record of next.complexEvidence ?? [])
			expect(record.complexContext.complexPlanDigest).toBe(next.complex?.plan.complexPlanDigest);
		expect(JSON.stringify(next)).not.toContain(data.sourcePlanDigest);
	});

	it("derives from a Run recovered as INTERRUPTED after its owner died, never recovering it itself (R02)", async () => {
		const p = await gitProject();
		const { run: orphan, files } = await durable(p.cwd, {
			stop: (value) => value.complex?.tasks[1].status === "ELIGIBLE",
		});
		expect(orphan.status).toBe("RUNNING");
		await mirror(p.cwd, files);
		await lock(p.cwd, deadPid());
		const client = await connect();
		// Still active and unrecovered: not terminal (row 3), and the derive leaves it exactly as it is.
		const before = await aiTree(p.cwd);
		expect(failure(await derive(client, orphan.runId))).toBe("RERUN_NOT_APPLICABLE");
		expect(await aiTree(p.cwd)).toEqual(before);
		// Only a prepare recovers the dead owner's Run, and answers STALE_PROJECT (STATE_STORE.md).
		expect(failure(await client.mutation({ type: "workflow.prepare", goal: "Fix bug in src/app.ts" }))).toBe(
			"STALE_PROJECT",
		);
		const recovered = (await FileStateStore.readSnapshot(p.cwd)).state?.runs.at(-1);
		expect(recovered?.complex?.tasks.map((row) => [row.status, row.failureCode])).toEqual([
			["COMPLETED", null],
			["INTERRUPTED", "OWNER_LOST"],
		]);
		const data = derived(await derive(client, orphan.runId));
		expect(data.sourceStatus).toBe("INTERRUPTED");
		expect(data.draft.tasks).toEqual([
			VERIFY_TASK_1,
			{
				title: "Task 2",
				goal: "Contribution 2",
				dependsOnIndexes: [1],
				criterionIndexes: [1, 2],
				ownership: [{ path: "src/new.ts", operation: "create" }],
				checkIds: ["test"],
			},
		]);
		expect(data).toMatchObject({
			notes: [],
			prepareCheck: { ok: true, code: null },
			leftovers: { clean: false, paths: ["src/app.ts"], truncated: false },
		});
	});

	it("re-evaluates every unfinished claim against the current file and keeps the graph and indexes", async () => {
		const p = await gitProject();
		const { run, files } = await durable(p.cwd, {
			files: { ...INITIAL, "src/gone.ts": "gone\n" },
			specs: [
				{ claims: [{ path: "src/app.ts", operation: "modify" }], criteria: [1], dependsOn: [] },
				{
					claims: [
						{ path: "src/new.ts", operation: "create" },
						{ path: "src/made.ts", operation: "create" },
						{ path: "src/util.ts", operation: "modify" },
						{ path: "src/gone.ts", operation: "modify" },
					],
					criteria: [1, 2],
					dependsOn: [1],
				},
				{ claims: [], criteria: [2], dependsOn: [1, 2] },
			],
			script: failCheck("CT-002"),
		});
		expect(run.complex?.tasks.map((row) => row.status)).toEqual(["COMPLETED", "BLOCKED", "BLOCKED"]);
		await mirror(p.cwd, files);
		// The user discarded one partial file and deleted a file a later task was to modify.
		await rm(join(p.cwd, "src/new.ts"));
		await rm(join(p.cwd, "src/gone.ts"));
		const client = await connect();
		const data = derived(await derive(client, run.runId));
		expect(data.draft.tasks).toEqual([
			{ ...VERIFY_TASK_1, criterionIndexes: [1] },
			{
				title: "Task 2",
				goal: "Contribution 2",
				dependsOnIndexes: [1],
				criterionIndexes: [1, 2],
				ownership: [
					{ path: "src/gone.ts", operation: "modify" },
					{ path: "src/made.ts", operation: "modify" },
					{ path: "src/new.ts", operation: "create" },
					{ path: "src/util.ts", operation: "modify" },
				],
				checkIds: ["test"],
			},
			{
				title: "Task 3",
				goal: "Contribution 3",
				dependsOnIndexes: [1, 2],
				criterionIndexes: [2],
				ownership: [],
				checkIds: ["test"],
			},
		]);
		expect(data.notes).toEqual([
			"CT-002 claim src/gone.ts: modify target is missing",
			"CT-002 claim src/made.ts: create became modify (file exists)",
		]);
		// The kept modify of a missing file is what prepare refuses.
		expect(data.prepareCheck).toEqual({ ok: false, code: "INVALID_CRITERIA" });
		expect(data.leftovers).toEqual({
			clean: false,
			paths: ["src/app.ts", "src/made.ts", "src/util.ts"],
			truncated: false,
		});
	});

	it("notes a COMPLETED task's files that no longer exist; its verification task still claims nothing", async () => {
		const p = await gitProject();
		const run = await r01(p);
		await rm(join(p.cwd, "src/app.ts"));
		const client = await connect();
		const data = derived(await derive(client, run.runId));
		expect(data.draft.tasks[0]).toEqual(VERIFY_TASK_1);
		expect(data.notes).toEqual([
			"CT-001 completed files missing: src/app.ts; a verification task cannot recreate them",
			"CT-002 claim src/new.ts: create became modify (file exists)",
		]);
		expect(data.leftovers.paths).toEqual(["src/app.ts", "src/new.ts"]);
	});

	it("cuts verification titles and goals on code points; the cut draft still prepares", async () => {
		const p = await gitProject();
		const astral = "\u{1F600}";
		const title = `${"t".repeat(71)}${astral}tail`;
		const goal = `${"g".repeat(272)}${astral}${"r".repeat(20)}`;
		const { run, files } = await durable(p.cwd, {
			specs: [{ ...TWO_TASKS[0], title, goal }, TWO_TASKS[1]],
			script: failCheck("CT-002"),
		});
		expect(run.complex?.plan.tasks[0]).toMatchObject({ title, goal });
		await mirror(p.cwd, files);
		const client = await connect();
		const data = derived(await derive(client, run.runId));
		expect(data.draft.tasks[0]).toMatchObject({
			title: `Verify: ${"t".repeat(71)}`,
			goal: `Re-verify without changes: ${"g".repeat(272)}`,
		});
		expect(data.prepareCheck).toEqual({ ok: true, code: null });
	});

	it("answers the prepare code of the dry run; without a configuration the derive itself is refused", async () => {
		const p = await gitProject();
		const run = await r01(p);
		const client = await connect();
		const configure = (value: unknown) => writeFile(join(p.cwd, ".ai/config.yaml"), JSON.stringify(value));
		// The organization now forces STANDARD: prepare refuses the COMPLEX goal instead of downgrading it.
		await configure({ ...CONFIG, runtime: { workflow: "STANDARD" } });
		const standard = derived(await derive(client, run.runId));
		expect(standard.prepareCheck).toEqual({ ok: false, code: "UNSUPPORTED_WORKFLOW" });
		// The task's check is no longer registered.
		await configure({
			...CONFIG,
			verification: { checks: [{ id: "unit", kind: "test", executable: "/usr/bin/true", args: [] }] },
		});
		expect(derived(await derive(client, run.runId)).prepareCheck).toEqual({ ok: false, code: "INVALID_CRITERIA" });
		await configure(CONFIG);
		const configured = derived(await derive(client, run.runId));
		expect(configured.prepareCheck).toEqual({ ok: true, code: null });
		// The draft itself never depends on the configuration.
		expect(configured.draft).toEqual(standard.draft);
		// Without a configuration there is no dry run to report: the derive is refused, never answered in part.
		const inspect = vi.spyOn(FilePolicyPathInspector, "open");
		await rm(join(p.cwd, ".ai/config.yaml"));
		expect(failure(await derive(client, run.runId))).toBe("CONTROL_UNAVAILABLE");
		expect(inspect).not.toHaveBeenCalled();
	});
});

describe("§3 eligibility, in the contract's order and before any project file is read", () => {
	it("RUN_NOT_FOUND unless runId is the latest durable Run; a later non-COMPLEX Run is RERUN_NOT_APPLICABLE", async () => {
		const p = await gitProject();
		const run = await r01(p);
		await standardRun(p.cwd, "later-run");
		const client = await connect();
		const files = await aiTree(p.cwd);
		const inspect = vi.spyOn(FilePolicyPathInspector, "open");
		// Still an eligible BLOCKED COMPLEX Run, but no longer the latest.
		expect(failure(await derive(client, run.runId))).toBe("RUN_NOT_FOUND");
		expect(failure(await derive(client, "unknown-run"))).toBe("RUN_NOT_FOUND");
		expect(failure(await derive(client, "later-run"))).toBe("RERUN_NOT_APPLICABLE");
		// Order: RUN_NOT_FOUND and RERUN_NOT_APPLICABLE come before STALE_PROJECT.
		const revision = (await client.state()).projectRevision;
		expect(failure(await deriveAt(client, run.runId, revision + 1))).toBe("RUN_NOT_FOUND");
		expect(failure(await deriveAt(client, "later-run", revision + 1))).toBe("RERUN_NOT_APPLICABLE");
		expect(inspect).not.toHaveBeenCalled();
		expect(client.createModels).not.toHaveBeenCalled();
		expect(await aiTree(p.cwd)).toEqual(files);
	});

	it("RERUN_NOT_APPLICABLE for a COMPLETED Run, a Run with every row COMPLETED, an R3 Run and an active Run", async () => {
		const p = await gitProject();
		const client = await connect();
		const inspect = vi.spyOn(FilePolicyPathInspector, "open");
		const completed = (await durable(p.cwd, { runId: "run-completed" })).run;
		expect(completed.status).toBe("COMPLETED");
		expect(failure(await derive(client, completed.runId))).toBe("RERUN_NOT_APPLICABLE");
		// BLOCKED by the integration check after every task COMPLETED: nothing is unfinished.
		const integrated = (
			await durable(p.cwd, {
				runId: "run-integration",
				script: (h) => {
					const verify = h.ports.verifier.verify;
					h.ports.verifier.verify = async (request) => {
						const result = await verify(request);
						if (request.complexContext?.scope === "INTEGRATION")
							result.checks[1] = { ...result.checks[1], status: "FAIL", exitCode: 1 };
						return result;
					};
				},
			})
		).run;
		expect(integrated.status).toBe("BLOCKED");
		expect(integrated.complex?.tasks.every((row) => row.status === "COMPLETED")).toBe(true);
		expect(failure(await derive(client, integrated.runId))).toBe("RERUN_NOT_APPLICABLE");
		// A single-delete R3 plan, FAILED with its deletion task unfinished, is never derived.
		const r3 = (
			await durable(p.cwd, {
				runId: "run-r3",
				goal: "Delete file src/obsolete.ts",
				risk: "R3",
				statements: ["The obsolete file is removed"],
				files: { ...INITIAL, "src/obsolete.ts": "old\n" },
				specs: [
					{ claims: [{ path: "src/obsolete.ts", operation: "delete" }], criteria: [1] },
					{ claims: [], criteria: [1] },
				],
				script: (h) => {
					// R3 starts only with an Approval port; the deleting Developer then fails before any request.
					h.ports.approval = { requestApproval: () => new Promise(() => {}) };
					h.ports.agents.execute = async (request) => {
						h.calls.push(request);
						await h.register(request);
						throw new Error("provider exploded");
					};
				},
			})
		).run;
		expect([r3.status, r3.risk, r3.complex?.tasks.map((row) => row.status)]).toEqual([
			"FAILED",
			"R3",
			["FAILED", "BLOCKED"],
		]);
		expect(failure(await derive(client, r3.runId))).toBe("RERUN_NOT_APPLICABLE");
		// A latest Run that is still active (its owner stopped without settling it) is not terminal: row 3 before ACTIVE_RUN.
		const active = (
			await durable(p.cwd, {
				runId: "run-active",
				stop: (value) => value.complex?.tasks[1].status === "ELIGIBLE",
			})
		).run;
		expect(active.status).toBe("RUNNING");
		const dead = await lock(p.cwd, deadPid());
		const files = await aiTree(p.cwd);
		expect(failure(await derive(client, active.runId))).toBe("RERUN_NOT_APPLICABLE");
		expect(failure(await derive(client, r3.runId))).toBe("RUN_NOT_FOUND");
		// Nothing was recovered or settled.
		expect(await aiTree(p.cwd)).toEqual(files);
		expect(await readFile(join(p.cwd, ".ai/writer.lock"), "utf8")).toBe(dead);
		expect((await client.state()).snapshot.status).toMatchObject({
			writerPresent: true,
			run: { runId: "run-active", status: "RUNNING" },
		});
		expect(inspect).not.toHaveBeenCalled();
		expect(client.createModels).not.toHaveBeenCalled();
	});

	it("ACTIVE_RUN while this Host runs a Run, before STALE_PROJECT; derives again once the Host is idle", async () => {
		const p = await gitProject();
		const run = await r01(p);
		const created = deferred();
		const release = deferred();
		const createModels = vi.fn(async (): Promise<ModelRuntime> => {
			created.resolve();
			await release.promise;
			throw new Error("Run start stopped by the test");
		});
		const client = await connect({ createModels });
		const prepared = await client.mutation({ type: "workflow.prepare", goal: "Fix bug in src/app.ts" });
		if (!prepared.success || prepared.data.kind !== "prepared") throw new Error(JSON.stringify(prepared));
		const { previewId, previewDigest } = prepared.data.preview;
		expect(failure(await client.mutation({ type: "workflow.confirm", previewId, previewDigest }))).toBeNull();
		await created.promise;
		const busy = await client.state();
		expect(busy.busy).toBe(true);
		// The latest durable Run is still the eligible source; this Host's execution refuses the derive.
		expect(busy.snapshot.status.run?.runId).toBe(run.runId);
		const inspect = vi.spyOn(FilePolicyPathInspector, "open");
		expect(failure(await derive(client, run.runId))).toBe("ACTIVE_RUN");
		expect(failure(await deriveAt(client, run.runId, busy.projectRevision + 1))).toBe("ACTIVE_RUN");
		expect(inspect).not.toHaveBeenCalled();
		release.resolve();
		await vi.waitFor(async () => expect((await client.state()).busy).toBe(false), { timeout: 5000, interval: 10 });
		expect(derived(await derive(client, run.runId)).runId).toBe(run.runId);
	});

	it("STALE_PROJECT for any other expected revision; nothing is read or written", async () => {
		const p = await gitProject();
		const run = await r01(p);
		const client = await connect();
		const files = await aiTree(p.cwd);
		const inspect = vi.spyOn(FilePolicyPathInspector, "open");
		const revision = (await client.state()).projectRevision;
		for (const stale of [revision - 1, revision + 1])
			expect(failure(await deriveAt(client, run.runId, stale))).toBe("STALE_PROJECT");
		expect(inspect).not.toHaveBeenCalled();
		expect(await aiTree(p.cwd)).toEqual(files);
		expect(derived(await deriveAt(client, run.runId, revision)).runId).toBe(run.runId);
	});

	it("STALE_PROJECT when the project revision moves while the files are read; nothing coherent is claimed", async () => {
		const p = await gitProject();
		const run = await r01(p);
		const client = await connect();
		const original = FilePolicyPathInspector.prototype.inspectOwnership;
		vi.spyOn(FilePolicyPathInspector.prototype, "inspectOwnership").mockImplementationOnce(async function (
			this: FilePolicyPathInspector,
			paths,
		) {
			// Another writer commits a new Run between the eligibility checks and the answer.
			await standardRun(p.cwd, "moved-run");
			return original.call(this, paths);
		});
		expect(failure(await derive(client, run.runId))).toBe("STALE_PROJECT");
		expect(failure(await derive(client, run.runId))).toBe("RUN_NOT_FOUND");
	});

	it("derives while a writer lock is present, live or dead, and never recovers it", async () => {
		const p = await gitProject();
		const run = await r01(p);
		const events: RuntimeEvent[] = [];
		const client = await connect({ events: { emit: (event) => void events.push(event) } });
		const reference = derived(await derive(client, run.runId));
		for (const pid of [process.pid, deadPid()]) {
			const text = await lock(p.cwd, pid);
			const files = await aiTree(p.cwd);
			const seen = await client.state();
			expect(seen.snapshot.status).toMatchObject({ writerPresent: true, run: { status: "BLOCKED" } });
			const open = vi.spyOn(FileStateStore, "open");
			const recover = vi.spyOn(FileStateStore, "recoverDeadOwner");
			expect(JSON.stringify(derived(await derive(client, run.runId)))).toBe(JSON.stringify(reference));
			expect(open).not.toHaveBeenCalled();
			expect(recover).not.toHaveBeenCalled();
			expect(await readFile(join(p.cwd, ".ai/writer.lock"), "utf8")).toBe(text);
			expect(await aiTree(p.cwd)).toEqual(files);
			expect((await client.state()).projectRevision).toBe(seen.projectRevision);
			vi.restoreAllMocks();
		}
		expect(events).toEqual([]);
	});
});

describe("§5 leftovers", () => {
	it("lists exactly what fails the clean start: Runtime-owned and generated observation paths are excluded", async () => {
		const p = await gitProject({ ignoreAi: false });
		const run = await r01(p);
		// Runtime-owned: state, projection, lock, recovery guard and archives. Generated: an owned decisions view.
		await lock(p.cwd, deadPid());
		await writeFile(join(p.cwd, ".ai/writer.lock.recovery"), "guard");
		await mkdir(join(p.cwd, ".ai/runs"));
		await writeFile(join(p.cwd, ".ai/runs/old-run.json"), "{}");
		const body = "# Runtime operational decisions\n";
		await writeFile(
			join(p.cwd, ".ai/decisions.md"),
			`<!-- pi-company-runtime decisions v1 ${createHash("sha256").update(body).digest("hex")} -->\n${body}`,
		);
		// Not Runtime-owned: a user note and a hand-edited check log.
		await writeFile(join(p.cwd, ".ai/notes.md"), "mine\n");
		await mkdir(join(p.cwd, ".ai/logs"));
		await writeFile(join(p.cwd, ".ai/logs/checks.json"), "{}\n");
		const status = p.git("--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all");
		for (const path of [".ai/state.json", ".ai/tasks.json", ".ai/writer.lock", ".ai/runs/old-run.json"])
			expect(status).toContain(path);
		const client = await connect();
		const data = derived(await derive(client, run.runId));
		expect(data.leftovers).toEqual({
			clean: false,
			paths: [".ai/logs/checks.json", ".ai/notes.md", "src/app.ts", "src/new.ts"],
			truncated: false,
		});
		// Resolved in the user's own tools: then the checkout is clean for the start check.
		p.git("add", "--", "src/app.ts", ".ai/notes.md", ".ai/logs/checks.json");
		p.git("commit", "-qm", "keep");
		await rm(join(p.cwd, "src/new.ts"));
		expect(derived(await derive(client, run.runId)).leftovers).toEqual({ clean: true, paths: [], truncated: false });
	});

	it("agrees with the start check itself; a staged rename lists both names", async () => {
		const p = await gitProject();
		const run = await r01(p);
		p.git("add", "--", "src/app.ts");
		p.git("commit", "-qm", "keep CT-001");
		await rm(join(p.cwd, "src/new.ts"));
		const policy: PolicyContext = {
			executionMode: "EDIT",
			executionRunId: "start-check",
			configDigest: "config",
			tools: [],
			allowedPaths: ["src"],
		};
		const client = await connect();
		expect(derived(await derive(client, run.runId)).leftovers).toEqual({ clean: true, paths: [], truncated: false });
		await expect(GitWorkspace.open(p.cwd, policy)).resolves.toBeInstanceOf(GitWorkspace);
		p.git("mv", "--", "src/util.ts", "src/moved.ts");
		expect(derived(await derive(client, run.runId)).leftovers).toEqual({
			clean: false,
			paths: ["src/moved.ts", "src/util.ts"],
			truncated: false,
		});
		await expect(GitWorkspace.open(p.cwd, policy)).rejects.toThrow("Dirty workspace");
	});

	it("keeps at most 200 sorted paths and marks the rest truncated", async () => {
		const p = await gitProject();
		const run = await r01(p);
		await mkdir(join(p.cwd, "src/extra"));
		const extra = Array.from({ length: 201 }, (_, index) => `src/extra/f${String(index).padStart(3, "0")}`);
		for (const path of extra) await writeFile(join(p.cwd, path), "x\n");
		const client = await connect();
		const { leftovers } = derived(await derive(client, run.runId));
		const all = ["src/app.ts", ...extra, "src/new.ts"];
		expect(leftovers).toEqual({ clean: false, paths: all.slice(0, 200), truncated: true });
	});

	it("keeps at most 16,384 bytes of names and marks the rest truncated", async () => {
		const p = await gitProject();
		const run = await r01(p);
		// 200-byte names sort before src/app.ts: 81 fit in 16,384 bytes, the 82nd does not.
		const long = Array.from({ length: 90 }, (_, index) => `src/${String(index).padStart(3, "0")}${"x".repeat(193)}`);
		for (const path of long) await writeFile(join(p.cwd, path), "x\n");
		expect(long.every((path) => Buffer.byteLength(path) === 200)).toBe(true);
		const client = await connect();
		const { leftovers } = derived(await derive(client, run.runId));
		expect(leftovers).toEqual({ clean: false, paths: long.slice(0, 81), truncated: true });
		expect(leftovers.paths.join("").length).toBeLessThanOrEqual(16384);
	});

	it("is unknown, never clean, when Git cannot answer; the draft is still derived", async () => {
		const p = await gitProject();
		const run = await r01(p);
		const client = await connect();
		const reference = derived(await derive(client, run.runId));
		const unknown = { clean: null, paths: [], truncated: false };
		// No repository at all.
		await rename(join(p.cwd, ".git"), join(p.root, "git-away"));
		const without = derived(await derive(client, run.runId));
		expect(without.leftovers).toEqual(unknown);
		expect(JSON.stringify({ ...without, leftovers: reference.leftovers })).toBe(JSON.stringify(reference));
		// A repository whose root is not the project: its status names describe another root.
		execFileSync("git", ["init", "-q"], { cwd: p.root, stdio: "ignore" });
		expect(derived(await derive(client, run.runId)).leftovers).toEqual(unknown);
		await rm(join(p.root, ".git"), { recursive: true, force: true });
		await rename(join(p.root, "git-away"), join(p.cwd, ".git"));
		expect(derived(await derive(client, run.runId)).leftovers).toEqual(reference.leftovers);
	});
});

describe("§6 response bound", () => {
	it("refuses a whole response line over 49,152 bytes with RESPONSE_TOO_LARGE; nothing else is shortened", async () => {
		const p = await gitProject();
		const run = await r01(p);
		// Names of control characters stay within the §5 bounds (8,700 bytes) but JSON-escape to about 50 KB.
		const names = Array.from(
			{ length: 60 },
			(_, index) => `src/${String(index).padStart(3, "0")}${"\u0001".repeat(138)}`,
		);
		for (const path of names) await writeFile(join(p.cwd, path), "x\n");
		const client = await connect();
		const files = await aiTree(p.cwd);
		const response = await derive(client, run.runId);
		expect(failure(response)).toBe("RESPONSE_TOO_LARGE");
		expect(response).toMatchObject({ command: "workflow.derive" });
		// The refused answer would have fit the general 65,536-byte transport bound: the 49,152-byte bound decides.
		expect(Buffer.byteLength(client.lines.at(-1)!)).toBeLessThan(1024);
		expect(await aiTree(p.cwd)).toEqual(files);
		for (const path of names) await rm(join(p.cwd, path));
		const data = derived(await derive(client, run.runId));
		expect(data.leftovers.paths).toEqual(["src/app.ts", "src/new.ts"]);
		expect(Buffer.byteLength(client.lines.at(-1)!)).toBeLessThanOrEqual(HOST_RERUN_DRAFT_MAX_RESPONSE_BYTES);
	});
});
