import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectComplexExecution } from "../../../company-runtime/src/complex-state.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { Run } from "../../../company-runtime/src/contracts.ts";
import type { RuntimeEvent } from "../../../company-runtime/src/events.ts";
import { HostControlBridge } from "../../../company-runtime/src/host-control.ts";
import type {
	HostControlCapabilities,
	HostControlPreview,
	HostControlResponse,
	HostControlState,
} from "../../../company-runtime/src/host-control-protocol.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import { type ComplexObservation, complexConsumerIssues } from "../../../company-runtime/test/complex-conformance.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

// #16 stage B: COMPLEX sequential execution through the real Host Control confirm path, StandardWorkflow,
// PiAgentExecutor worker tools with Kernel-bound ownership, RegisteredVerifier over real Git and processes, and
// the validating FileStateStore. Faux provider only; no real provider, key or paid token.
// #16 stage C: every control snapshot observed during these real Runs is checked against every #17 App consumer
// rule (company-runtime/test/complex-conformance.ts), alone and against the previous snapshot of the connection.

let harness: Harness;
let cwd: string;
let agentDir: string;
let config: RuntimeConfig;
let clock: number;
let events: RuntimeEvent[];
let client: ReturnType<typeof connect>;
let capabilities: HostControlCapabilities;
let observed: ComplexObservation[];
const owners: HostControlBridge[] = [];
const GOAL = "Refactor the app across multiple modules";
const DRAFT = {
	tasks: [
		{
			title: "Fix the app module",
			goal: "Make src/app.js return the fixed value",
			dependsOnIndexes: [],
			criterionIndexes: [1],
			ownership: [{ path: "src/app.js", operation: "modify" }],
			checkIds: ["regression"],
		},
		{
			title: "Add the extra module",
			goal: "Create src/extra.js",
			dependsOnIndexes: [1],
			criterionIndexes: [1],
			ownership: [{ path: "src/extra.js", operation: "create" }],
			checkIds: ["regression"],
		},
	],
};
const EXISTING_EVENTS = new Set([
	"RunCreated",
	"RunStarted",
	"RunCompleted",
	"RunFailed",
	"RunBlocked",
	"RunCancelled",
	"RunInterrupted",
	"StepStarted",
	"StepCompleted",
	"StepFailed",
	"AgentStarted",
	"AgentCompleted",
	"AgentFailed",
	"AgentSessionCreated",
	"ReviewRequested",
	"ReviewPassed",
	"ReviewRevisionRequested",
	"ReviewBlocked",
	"VerificationStarted",
	"VerificationCompleted",
	"VerificationFailed",
	"ApprovalRequested",
	"ApprovalResolved",
	"ApprovalConsumed",
]);

function connect(owner: HostControlBridge) {
	const responses: HostControlResponse[] = [];
	const connection = owner.connect((line) => {
		responses.push(JSON.parse(line) as HostControlResponse);
		return true;
	});
	let sequence = 0;
	return {
		close: () => connection.close(),
		async request(input: unknown) {
			const offset = responses.length;
			await connection.receive(JSON.stringify(input));
			if (!responses[offset]) throw new Error("Control response missing");
			return responses[offset];
		},
		async hello() {
			const result = await this.request({ protocolVersion: 1, id: `hello-${++sequence}`, type: "control.hello" });
			if (result.success && result.data.kind === "capabilities") capabilities = result.data.capabilities;
			return result;
		},
		async state(): Promise<HostControlState> {
			const result = await this.request({
				protocolVersion: 1,
				id: `snapshot-${++sequence}`,
				type: "control.snapshot",
			});
			if (!result.success || result.data.kind !== "snapshot")
				throw new Error(`Snapshot unavailable: ${JSON.stringify(result)}`);
			observed.push({
				capabilities,
				state: result.data.state,
				response: {
					ownerId: result.ownerId,
					runId: result.runId,
					stateRevision: result.stateRevision,
					projectRevision: result.projectRevision,
				},
			});
			return result.data.state;
		},
	};
}
async function mutation(fields: Record<string, unknown>) {
	const state = await client.state();
	const request = {
		protocolVersion: 1,
		id: state.nextRequestId,
		ownerId: state.ownerId,
		expectedProjectRevision: state.projectRevision,
		...fields,
	};
	return { request, response: await client.request(request) };
}
async function start(goal = GOAL, complexDraft: unknown = DRAFT): Promise<HostControlPreview> {
	const prepared = await mutation({ type: "workflow.prepare", goal, complexDraft });
	if (!prepared.response.success || prepared.response.data.kind !== "prepared")
		throw new Error(JSON.stringify(prepared.response));
	const preview = prepared.response.data.preview;
	const confirmed = await mutation({
		type: "workflow.confirm",
		previewId: preview.previewId,
		previewDigest: preview.previewDigest,
	});
	expect(confirmed.response).toMatchObject({ success: true, data: { kind: "accepted", command: "workflow.confirm" } });
	return preview;
}
async function idleState() {
	let state = await client.state();
	await vi.waitFor(
		async () => {
			state = await client.state();
			expect(state.busy).toBe(false);
		},
		{ timeout: 60000, interval: 20 },
	);
	return state;
}
/** Every observed snapshot, checked as the #17 App consumer would before publishing it (alone and in sequence). */
function consumerIssues(): string[] {
	return observed.flatMap((observation, index) =>
		complexConsumerIssues(observation, index ? observed[index - 1] : null).map(
			(issue) => `snapshot ${index}: ${issue}`,
		),
	);
}
async function storedRun(): Promise<Run> {
	const run = (await FileStateStore.readSnapshot(cwd)).state?.runs.at(-1);
	if (!run) throw new Error("No durable run");
	return run;
}
function workerInput(context: Context): AgentExecutionRequest {
	return JSON.parse(
		getMessageText(context.messages.find((message) => message.role === "user")),
	) as AgentExecutionRequest;
}
const write = (path: string, content: string) =>
	fauxAssistantMessage(fauxToolCall("runtime_write", { path, content }), { stopReason: "toolUse" });
function handoff(changed: string[]) {
	return (context: Context) => {
		const input = workerInput(context);
		expect(input.role).toBe("Developer");
		expect(input.complexContext?.scope).toBe("TASK");
		return fauxAssistantMessage(
			fauxToolCall("submit_handoff", {
				runId: input.runId,
				revision: input.revision,
				role: "Developer",
				task: input.task.id,
				changed_files: changed,
				summary: `Contribution for ${input.complexContext?.taskId}`,
				assumptions: [],
				tests_run: [],
				known_risks: [],
				unresolved: [],
			}),
			{ stopReason: "toolUse" },
		);
	};
}
/** Task Reviewer: contribution statuses for exactly the task's mapped criteria; final Reviewer: parent MET. */
function review(context: Context) {
	const input = workerInput(context);
	if (input.role !== "Reviewer") throw new Error("Expected an independent Reviewer");
	const task = input.complexContext?.scope === "TASK";
	const ids = task
		? (input.complexTask?.task.criterionIds ?? [])
		: input.task.acceptanceCriteria.map((item) => item.id);
	if (!task) expect(input.complexIntegration?.tasks.map((item) => item.id)).toEqual(["CT-001", "CT-002"]);
	return fauxAssistantMessage(
		fauxToolCall("submit_review", {
			runId: input.runId,
			revision: input.revision,
			role: "Reviewer",
			task: input.task.id,
			result: "PASS",
			issues: [],
			criteria: ids.map((criterionId) => ({
				criterionId,
				status: task ? "SUPPORTED" : "MET",
				evidenceRefs: input.verification.evidenceRefs,
			})),
			evidenceRefs: input.verification.evidenceRefs,
			diffDigest: input.verification.diffDigest,
		}),
		{ stopReason: "toolUse" },
	);
}
function git(...args: string[]) {
	return execFileSync(
		"git",
		[
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@invalid",
			"-c",
			"commit.gpgsign=false",
			...args,
		],
		{
			cwd,
			stdio: "pipe",
			env: { PATH: process.env.PATH, HOME: agentDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		},
	).toString();
}
async function setup(runtime: Record<string, unknown> = {}, files: Record<string, string> = {}) {
	config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			...runtime,
			files: { allowed_paths: ["src"] },
			verification: {
				checks: [
					{
						id: "regression",
						kind: "test",
						executable: process.execPath,
						args: ["scripts/check.mjs"],
						timeout_ms: 10000,
					},
				],
			},
		}),
	);
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	for (const [path, content] of Object.entries(files)) writeFileSync(join(cwd, path), content);
	git("add", "--", ".ai/config.yaml", ".gitignore", "src", "scripts");
	git("commit", "-qm", "COMPLEX fixture");
	const owner = await HostControlBridge.create({
		cwd,
		projectTrusted: true,
		agentDir,
		createModels: async () => harness.session.modelRuntime,
		now: () => clock,
		approvalTimeoutMs: 30000,
		events: { emit: (event) => void events.push(event) },
	});
	owners.push(owner);
	client = connect(owner);
	await client.hello();
}

beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding" }, { id: "review" }] });
	cwd = join(harness.tempDir, "project");
	agentDir = join(harness.tempDir, "workers");
	for (const path of ["src", "scripts", ".ai"]) mkdirSync(join(cwd, path), { recursive: true });
	mkdirSync(agentDir);
	writeFileSync(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n");
	writeFileSync(join(cwd, "src/app.js"), "original\n");
	writeFileSync(join(cwd, "src/keep.js"), "preserved\n");
	writeFileSync(
		join(cwd, "scripts/check.mjs"),
		"import {existsSync,readFileSync} from 'node:fs'; if(existsSync('src/app.js') && readFileSync('src/app.js','utf8')!=='fixed\\n') process.exit(1); if(existsSync('src/extra.js') && readFileSync('src/extra.js','utf8')!=='extra\\n') process.exit(2); console.log('COMPLEX_CHECK_PASSED');",
	);
	git("init", "-q");
	clock = Date.now();
	events = [];
	observed = [];
});
afterEach(async () => {
	client?.close();
	await Promise.all(owners.splice(0).map((owner) => owner.shutdown()));
	harness.cleanup();
});

describe("COMPLEX sequential Run through Host Control and real adapters (#16)", () => {
	it("confirms a COMPLEX preview and completes two tasks, integration and the final gate", async () => {
		await setup();
		harness.setResponses([
			write("src/app.js", "fixed\n"),
			handoff(["src/app.js"]),
			review,
			write("src/extra.js", "extra\n"),
			handoff(["src/extra.js"]),
			review,
			review,
		]);
		const preview = await start();
		expect(preview.workflow).toBe("COMPLEX");
		const state = await idleState();
		expect(state.startFailure).toBeNull();
		expect(state.snapshot.status).toMatchObject({
			writerPresent: false,
			run: { status: "COMPLETED", workflow: "COMPLEX" },
		});
		const run = await storedRun();
		// V0.8A: contract v2 is advertised and the latest COMPLEX Run is projected, from exactly that durable Run,
		// at the snapshot's own owner/project/state revisions.
		expect(capabilities.complexContractVersion).toBe(2);
		expect(state.complexExecution).toEqual(
			projectComplexExecution(run, {
				ownerId: state.ownerId,
				projectRevision: state.projectRevision,
				stateRevision: run.revision,
			}),
		);
		expect(state.complexExecution).toMatchObject({
			runId: state.snapshot.status.run?.runId,
			stateRevision: state.stateRevision,
			phase: "TERMINAL",
			activeTaskIds: [],
			cleanup: "CONFIRMED",
			integration: { check: "PASS", review: "PASS", test: "PASS", evidenceFreshness: "CURRENT" },
			budget: { workerInvocations: 5, totalRevisionCycles: 0, status: "WITHIN_LIMITS" },
		});
		expect(state.complexExecution?.tasks.map((row) => row.status)).toEqual(["COMPLETED", "COMPLETED"]);
		// Snapshots observed while the real Run advanced all passed every App consumer rule, alone and in sequence.
		expect(observed.filter((item) => item.state.complexExecution).length).toBeGreaterThan(1);
		expect(consumerIssues()).toEqual([]);
		expect(run.lastError).toBeNull();
		expect(run.complex).toMatchObject({
			phase: "TERMINAL",
			cleanup: "CONFIRMED",
			integration: { check: "PASS", review: "PASS", test: "PASS", evidenceFreshness: "CURRENT" },
		});
		expect(run.complex?.plan).toEqual(preview.complexPlan);
		expect(run.complex?.tasks.map((row) => [row.status, row.changedFiles])).toEqual([
			["COMPLETED", ["src/app.js"]],
			["COMPLETED", ["src/extra.js"]],
		]);
		expect(run.taskContractDigest).toBe(preview.taskContractDigest);
		expect(readFileSync(join(cwd, "src/app.js"), "utf8")).toBe("fixed\n");
		expect(readFileSync(join(cwd, "src/extra.js"), "utf8")).toBe("extra\n");
		expect(readFileSync(join(cwd, "src/keep.js"), "utf8")).toBe("preserved\n");
		// Real registered checks, namespaced per task/integration stage, all with Kernel-assigned context.
		expect(run.verification.map((check) => check.evidenceRefs[0])).toEqual([
			`check:${run.runId}:CT-001:self-check:1:regression`,
			`check:${run.runId}:CT-001:test:1:regression`,
			`check:${run.runId}:CT-002:self-check:1:regression`,
			`check:${run.runId}:CT-002:test:1:regression`,
			`check:${run.runId}:integration:self-check:1:regression`,
			`check:${run.runId}:integration:test:1:regression`,
		]);
		expect(
			run.verification.every((check) => check.status === "PASS" && check.stdout?.includes("COMPLEX_CHECK_PASSED")),
		).toBe(true);
		expect(new Set(run.roleSessionRefs.map((ref) => ref.sessionFile)).size).toBe(5);
		expect(run.budget).toMatchObject({ workerInvocations: 5, exceeded: false });
		expect(run.budget?.reportedTokens).toBeGreaterThan(0);
		// Durable Policy intents: every mutation was ALLOWed only inside its own IMPLEMENTING attempt.
		const stored = (await FileStateStore.readSnapshot(cwd)).state!;
		expect(
			stored.actions
				.filter((action) => action.decision.role === "Developer" && action.decision.risk === "R1")
				.map((action) => action.status),
		).toEqual(["SUCCEEDED", "SUCCEEDED"]);
		expect(events.every((event) => EXISTING_EVENTS.has(event.type))).toBe(true);
		expect(events.filter((event) => event.type === "RunCompleted")).toHaveLength(1);
		expect(git("status", "--porcelain")).toContain("src/extra.js");
		expect(git("log", "--oneline")).toContain("COMPLEX fixture");
	});

	it("C03: a later task writing an earlier task's claimed file is denied before any effect", async () => {
		await setup();
		harness.setResponses([
			write("src/app.js", "fixed\n"),
			handoff(["src/app.js"]),
			review,
			write("src/app.js", "stolen\n"),
		]);
		await start();
		const state = await idleState();
		expect(state.snapshot.status).toMatchObject({ writerPresent: false, run: { status: "BLOCKED" } });
		const run = await storedRun();
		expect(run.complex?.tasks.map((row) => [row.status, row.failureCode])).toEqual([
			["COMPLETED", null],
			["BLOCKED", "OWNERSHIP_CONFLICT"],
		]);
		expect(run.complex).toMatchObject({
			failureCode: "OWNERSHIP_CONFLICT",
			cleanup: "CONFIRMED",
			partialChanges: true,
		});
		expect(readFileSync(join(cwd, "src/app.js"), "utf8")).toBe("fixed\n");
		expect(existsSync(join(cwd, "src/extra.js"))).toBe(false);
		// The denial happened before any Policy intent for the conflicting write.
		const stored = (await FileStateStore.readSnapshot(cwd)).state!;
		expect(
			stored.actions.filter((action) => action.decision.role === "Developer" && action.decision.risk === "R1"),
		).toHaveLength(1);
		expect(harness.faux.state.callCount).toBe(4);
		expect(state.complexExecution).toMatchObject({
			phase: "TERMINAL",
			failureCode: "OWNERSHIP_CONFLICT",
			cleanup: "CONFIRMED",
			stateRevision: state.stateRevision,
		});
		expect(consumerIssues()).toEqual([]);
	});

	it("C14: cancel during a later task keeps earlier history, cancels the rest and releases the writer", async () => {
		await setup();
		let entered!: () => void;
		const ready = new Promise<void>((resolve) => {
			entered = resolve;
		});
		harness.setResponses([
			write("src/app.js", "fixed\n"),
			handoff(["src/app.js"]),
			review,
			async (_context: Context, options?: { signal?: AbortSignal }) => {
				entered();
				await new Promise<void>((resolve) => {
					if (options?.signal?.aborted) resolve();
					else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return fauxAssistantMessage("Late output is not completion evidence");
			},
		]);
		await start();
		await ready;
		const live = await client.state();
		expect(live.complexExecution).toMatchObject({ phase: "TASK_SEQUENCE", activeTaskIds: ["CT-002"] });
		const cancelled = await mutation({
			type: "workflow.cancel",
			runId: live.ownedRunId,
			expectedStateRevision: live.stateRevision,
		});
		expect(cancelled.response).toMatchObject({ success: true });
		const state = await idleState();
		expect(state.snapshot.status).toMatchObject({ writerPresent: false, run: { status: "CANCELLED" } });
		const run = await storedRun();
		expect(run.complex).toMatchObject({ phase: "TERMINAL", cleanup: "CONFIRMED", failureCode: "CANCELLED" });
		expect(run.complex?.tasks.map((row) => row.status)).toEqual(["COMPLETED", "CANCELLED"]);
		expect(readFileSync(join(cwd, "src/app.js"), "utf8")).toBe("fixed\n");
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		expect(state.complexExecution).toMatchObject({
			phase: "TERMINAL",
			failureCode: "CANCELLED",
			cleanup: "CONFIRMED",
		});
		expect(state.complexExecution?.tasks.map((row) => row.status)).toEqual(["COMPLETED", "CANCELLED"]);
		expect(consumerIssues()).toEqual([]);
	});
});

describe("COMPLEX confirmation rechecks the live checkout (#16)", () => {
	it("C26: a claim that became infeasible after the preview refuses to start, with no model call or Run", async () => {
		await setup();
		const prepared = await mutation({ type: "workflow.prepare", goal: GOAL, complexDraft: DRAFT });
		if (!prepared.response.success || prepared.response.data.kind !== "prepared")
			throw new Error(JSON.stringify(prepared.response));
		const preview = prepared.response.data.preview;
		// CT-002 claims to create src/extra.js; the clean checkout now already tracks that file.
		writeFileSync(join(cwd, "src/extra.js"), "extra\n");
		git("add", "--", "src/extra.js");
		git("commit", "-qm", "Somebody else created the file");
		await mutation({ type: "workflow.confirm", previewId: preview.previewId, previewDigest: preview.previewDigest });
		const state = await idleState();
		expect(state).toMatchObject({ startFailure: "START_FAILED", preview: null });
		expect(state.snapshot.status).toMatchObject({ writerPresent: false, run: null });
		expect(harness.faux.state.callCount).toBe(0);
		// No Run, no projection; the preview was consumed.
		expect("complexExecution" in state).toBe(false);
		expect(consumerIssues()).toEqual([]);
	});
});

describe("COMPLEX R3 single deletion through Host Control (#16)", () => {
	it("approves the one exact CT-001 deletion, then a read-only task and integration complete", async () => {
		await setup(
			{ runtime: { workflow: "COMPLEX" } },
			{
				"src/obsolete.js": "obsolete\n",
				"scripts/check.mjs":
					"import {existsSync} from 'node:fs'; if(existsSync('src/obsolete.js')) process.exit(3); console.log('COMPLEX_CHECK_PASSED');",
			},
		);
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("runtime_delete", { path: "src/obsolete.js" }), { stopReason: "toolUse" }),
			handoff(["src/obsolete.js"]),
			review,
			handoff([]),
			review,
			review,
		]);
		await start("Delete file src/obsolete.js", {
			tasks: [
				{
					title: "Delete the obsolete file",
					goal: "Remove src/obsolete.js",
					dependsOnIndexes: [],
					criterionIndexes: [1],
					ownership: [{ path: "src/obsolete.js", operation: "delete" }],
					checkIds: ["regression"],
				},
				{
					title: "Confirm nothing depends on it",
					goal: "Read-only confirmation",
					dependsOnIndexes: [1],
					criterionIndexes: [1],
					ownership: [],
					checkIds: ["regression"],
				},
			],
		});
		let approval = (await client.state()).pendingApproval;
		await vi.waitFor(
			async () => {
				approval = (await client.state()).pendingApproval;
				expect(approval).not.toBeNull();
			},
			{ timeout: 30000, interval: 20 },
		);
		expect(existsSync(join(cwd, "src/obsolete.js"))).toBe(true);
		// The waiting snapshot projects CT-001 waiting for the exact Approval while the Run waits.
		const waiting = observed.find((item) => item.state.pendingApproval)?.state;
		expect(waiting?.snapshot.status.run?.status).toBe("WAITING_APPROVAL");
		expect(waiting?.complexExecution).toMatchObject({
			activeTaskIds: ["CT-001"],
			stateRevision: waiting?.stateRevision,
		});
		expect(waiting?.complexExecution?.tasks[0].status).toBe("WAITING_APPROVAL");
		const resolved = await mutation({
			type: "approval.resolve",
			runId: approval!.runId,
			expectedStateRevision: approval!.stateRevision,
			approvalId: approval!.approvalId,
			decision: "approve",
		});
		expect(resolved.response).toMatchObject({ success: true });
		const state = await idleState();
		const run = await storedRun();
		expect(state.snapshot.status.run?.status, run.lastError ?? "").toBe("COMPLETED");
		expect(existsSync(join(cwd, "src/obsolete.js"))).toBe(false);
		expect(run.approvals).toEqual([
			expect.objectContaining({
				status: "CONSUMED",
				request: expect.objectContaining({
					complexContext: expect.objectContaining({ taskId: "CT-001", attempt: 1 }),
				}),
			}),
		]);
		expect(run.complex?.tasks.map((row) => [row.status, row.changedFiles])).toEqual([
			["COMPLETED", ["src/obsolete.js"]],
			["COMPLETED", []],
		]);
		expect(run.revisionCycle).toBe(0);
		const stored = (await FileStateStore.readSnapshot(cwd)).state!;
		expect(
			stored.actions.filter((action) => action.decision.risk === "R3" && action.status === "SUCCEEDED"),
		).toHaveLength(1);
		expect(state.complexExecution).toMatchObject({ phase: "TERMINAL", cleanup: "CONFIRMED", failureCode: null });
		// The waiting and the final revisions were both observed: the cross-snapshot rules ran on real transitions.
		const revisions = new Set(
			observed.filter((item) => item.state.complexExecution).map((item) => item.state.stateRevision),
		);
		expect(revisions.size).toBeGreaterThanOrEqual(2);
		expect(consumerIssues()).toEqual([]);
	});
});

describe("V0.8A parallel COMPLEX waves through Host Control and real adapters (#20)", () => {
	/** Two independent tasks: with max_parallel 2 they form one wave. */
	const PARALLEL_DRAFT = {
		tasks: [
			{ ...DRAFT.tasks[0], dependsOnIndexes: [] },
			{ ...DRAFT.tasks[1], dependsOnIndexes: [] },
		],
	};
	const files: Record<string, { path: string; content: string }> = {
		"CT-001": { path: "src/app.js", content: "fixed\n" },
		"CT-002": { path: "src/extra.js", content: "extra\n" },
	};
	/**
	 * One faux dispatcher for every stream call: concurrent Developer sessions pull responses in nondeterministic
	 * order, so each response is chosen from the worker's own task context and conversation turn. Each Developer's
	 * first turn waits until both Developers are live at once and the test releases them.
	 */
	function dispatcher(release: Promise<void>) {
		const live = new Set<string>();
		let bothLive!: () => void;
		const both = new Promise<void>((resolve) => {
			bothLive = resolve;
		});
		const respond = async (context: Context, options?: { signal?: AbortSignal }) => {
			const input = workerInput(context);
			if (input.role === "Reviewer") return review(context);
			const task = input.complexContext?.taskId ?? "";
			if (context.messages.some((message) => message.role === "assistant"))
				return handoff([files[task].path])(context);
			live.add(task);
			if (live.size === 2) bothLive();
			await Promise.race([
				release,
				new Promise<void>((resolve) => {
					if (options?.signal?.aborted) resolve();
					else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
				}),
			]);
			if (options?.signal?.aborted) return fauxAssistantMessage("Late output is not completion evidence");
			return write(files[task].path, files[task].content);
		};
		return { respond, both };
	}

	it("P01 (real adapters): two Developers implement at once, then verification and integration complete", async () => {
		await setup({ agents: { max_parallel: 2, max_revision_cycles: 1 } });
		let release!: () => void;
		const released = new Promise<void>((resolve) => {
			release = resolve;
		});
		const { respond, both } = dispatcher(released);
		harness.setResponses(Array.from({ length: 7 }, () => respond));
		const preview = await start(GOAL, PARALLEL_DRAFT);
		expect(preview.complexPlan?.limits.maxParallel).toBe(2);
		await both;
		// Both Developer sessions are live at once, and the projection reports the wave's two IMPLEMENTING rows.
		const live = await client.state();
		expect(live.complexExecution?.activeTaskIds).toEqual(["CT-001", "CT-002"]);
		expect(live.complexExecution?.tasks.map((row) => row.status)).toEqual(["IMPLEMENTING", "IMPLEMENTING"]);
		release();
		const state = await idleState();
		const run = await storedRun();
		expect(state.snapshot.status, run.lastError ?? "").toMatchObject({
			writerPresent: false,
			run: { status: "COMPLETED" },
		});
		expect(readFileSync(join(cwd, "src/app.js"), "utf8")).toBe("fixed\n");
		expect(readFileSync(join(cwd, "src/extra.js"), "utf8")).toBe("extra\n");
		expect(run.complex?.tasks.map((row) => [row.status, row.changedFiles])).toEqual([
			["COMPLETED", ["src/app.js"]],
			["COMPLETED", ["src/extra.js"]],
		]);
		// Two Developers, two task Reviewers and one final Reviewer on one global ledger.
		expect(run.budget?.workerInvocations).toBe(5);
		// Both Developers started before either handed off; every verification ran after the join, in plan order.
		const implement = events.filter((event) => "step" in event && event.step?.stepId === "implement");
		const started = implement.filter((event) => event.type === "AgentStarted").map((event) => event.sequence);
		const completed = implement.filter((event) => event.type === "AgentCompleted").map((event) => event.sequence);
		expect(started).toHaveLength(2);
		expect(Math.max(...started)).toBeLessThan(Math.min(...completed));
		const verifications = events
			.filter((event) => event.type === "VerificationStarted")
			.map(
				(event) => `${event.complexContext?.taskId ?? "integration"}:${"step" in event ? event.step?.stepId : ""}`,
			);
		expect(verifications).toEqual([
			"CT-001:self-check",
			"CT-001:test",
			"CT-002:self-check",
			"CT-002:test",
			"integration:self-check",
			"integration:test",
		]);
		expect(new Set(events.map((event) => event.sequence)).size).toBe(events.length);
		expect(state.complexExecution).toMatchObject({ phase: "TERMINAL", activeTaskIds: [], cleanup: "CONFIRMED" });
		expect(consumerIssues()).toEqual([]);
	});

	it("P07 (real adapters): a cancel with two live Developers cancels both rows and releases the writer", async () => {
		await setup({ agents: { max_parallel: 2, max_revision_cycles: 1 } });
		const { respond, both } = dispatcher(new Promise<void>(() => {}));
		harness.setResponses(Array.from({ length: 2 }, () => respond));
		await start(GOAL, PARALLEL_DRAFT);
		await both;
		const live = await client.state();
		expect(live.complexExecution?.activeTaskIds).toEqual(["CT-001", "CT-002"]);
		const cancelled = await mutation({
			type: "workflow.cancel",
			runId: live.ownedRunId,
			expectedStateRevision: live.stateRevision,
		});
		expect(cancelled.response).toMatchObject({ success: true });
		const state = await idleState();
		expect(state.snapshot.status).toMatchObject({ writerPresent: false, run: { status: "CANCELLED" } });
		const run = await storedRun();
		expect(run.complex).toMatchObject({ phase: "TERMINAL", cleanup: "CONFIRMED", failureCode: "CANCELLED" });
		expect(run.complex?.tasks.map((row) => [row.status, row.failureCode])).toEqual([
			["CANCELLED", "CANCELLED"],
			["CANCELLED", "CANCELLED"],
		]);
		expect(existsSync(join(cwd, "src/extra.js"))).toBe(false);
		expect(readFileSync(join(cwd, "src/app.js"), "utf8")).toBe("original\n");
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		expect(consumerIssues()).toEqual([]);
	});
});
