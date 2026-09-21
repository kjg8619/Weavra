import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRuntimeConfig, type RuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { RuntimeEvent } from "../../../company-runtime/src/events.ts";
import { HostControlBridge } from "../../../company-runtime/src/host-control.ts";
import type {
	HostControlMutation,
	HostControlPreview,
	HostControlResponse,
	HostControlState,
} from "../../../company-runtime/src/host-control-protocol.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

let harness: Harness;
let cwd: string;
let agentDir: string;
let config: RuntimeConfig;
let bridge: HostControlBridge;
let client: ReturnType<typeof connect>;
let clock: number;
let events: RuntimeEvent[];
const owners: HostControlBridge[] = [];
const goal = "Fix app bug";
const target = "src/app.js";
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
			return this.request({ protocolVersion: 1, id: `hello-${++sequence}`, type: "control.hello" });
		},
		async state(): Promise<HostControlState> {
			const result = await this.request({
				protocolVersion: 1,
				id: `snapshot-${++sequence}`,
				type: "control.snapshot",
			});
			if (!result.success || result.data.kind !== "snapshot")
				throw new Error(`Snapshot unavailable: ${JSON.stringify(result)}`);
			return result.data.state;
		},
	};
}
function workerInput(context: Context): AgentExecutionRequest {
	return JSON.parse(
		getMessageText(context.messages.find((message) => message.role === "user")),
	) as AgentExecutionRequest;
}
const edit = () =>
	fauxAssistantMessage(fauxToolCall("runtime_write", { path: target, content: "fixed\n" }), { stopReason: "toolUse" });
const remove = () => fauxAssistantMessage(fauxToolCall("runtime_delete", { path: target }), { stopReason: "toolUse" });
function handoff(context: Context) {
	const input = workerInput(context);
	return fauxAssistantMessage(
		fauxToolCall("submit_handoff", {
			runId: input.runId,
			revision: input.revision,
			role: "Developer",
			task: input.task.id,
			changed_files: [target],
			summary: "Requested change performed",
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
		}),
		{ stopReason: "toolUse" },
	);
}
function review(context: Context) {
	const input = workerInput(context);
	if (input.role !== "Reviewer") throw new Error("Expected independent Reviewer");
	return fauxAssistantMessage(
		fauxToolCall("submit_review", {
			runId: input.runId,
			revision: input.revision,
			role: "Reviewer",
			task: input.task.id,
			result: "PASS",
			issues: [],
			criteria: input.task.acceptanceCriteria.map((criterion) => ({
				criterionId: criterion.id,
				status: "MET",
				evidenceRefs: input.verification.evidenceRefs,
			})),
			evidenceRefs: input.verification.evidenceRefs,
			diffDigest: input.verification.diffDigest,
		}),
		{ stopReason: "toolUse" },
	);
}
function pausedWorker() {
	let entered!: () => void;
	const ready = new Promise<void>((resolve) => {
		entered = resolve;
	});
	return {
		ready,
		response: async (_context: Context, options?: { signal?: AbortSignal }) => {
			entered();
			await new Promise<void>((resolve) => {
				if (options?.signal?.aborted) resolve();
				else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
			});
			return fauxAssistantMessage("Late output is not completion evidence");
		},
	};
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
function checkpoint() {
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	git("add", "--", ".ai/config.yaml", ".gitignore", target, "src/keep.js", "scripts/check.mjs");
	git("commit", "-qm", "Control fixture");
}
async function createOwner() {
	const owner = await HostControlBridge.create({
		cwd,
		projectTrusted: true,
		agentDir,
		createModels: async () => harness.session.modelRuntime,
		now: () => clock,
		approvalTimeoutMs: 30000,
		events: {
			emit: (event) => {
				events.push(event);
			},
		},
	});
	owners.push(owner);
	return owner;
}
async function mutation(
	fields:
		| Omit<HostControlMutation, "protocolVersion" | "id" | "ownerId" | "expectedProjectRevision">
		| Record<string, unknown>,
) {
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
async function prepare(requestGoal = goal): Promise<HostControlPreview> {
	const result = await mutation({ type: "workflow.prepare", goal: requestGoal });
	if (!result.response.success || result.response.data.kind !== "prepared")
		throw new Error(JSON.stringify(result.response));
	return result.response.data.preview;
}
async function start(requestGoal = goal) {
	const preview = await prepare(requestGoal);
	const result = await mutation({
		type: "workflow.confirm",
		previewId: preview.previewId,
		previewDigest: preview.previewDigest,
	});
	expect(result.response).toMatchObject({ success: true, data: { kind: "accepted", command: "workflow.confirm" } });
	return result;
}
async function idleState() {
	let state = await client.state();
	await vi.waitFor(
		async () => {
			state = await client.state();
			expect(state.busy).toBe(false);
		},
		{ timeout: 30000, interval: 20 },
	);
	return state;
}
async function pendingApproval() {
	let state = await client.state();
	await vi.waitFor(
		async () => {
			state = await client.state();
			expect(state.pendingApproval).not.toBeNull();
		},
		{ timeout: 30000, interval: 20 },
	);
	return state.pendingApproval!;
}
beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding" }, { id: "review" }] });
	cwd = join(harness.tempDir, "project");
	agentDir = join(harness.tempDir, "workers");
	for (const path of ["src", "scripts", ".ai"]) mkdirSync(join(cwd, path), { recursive: true });
	mkdirSync(agentDir);
	config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			runtime: { workflow: "STANDARD" },
			files: { allowed_paths: ["src", "scripts"] },
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
	writeFileSync(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n");
	writeFileSync(join(cwd, target), "original\n");
	writeFileSync(join(cwd, "src/keep.js"), "preserved\n");
	writeFileSync(
		join(cwd, "scripts/check.mjs"),
		`import {existsSync,readFileSync} from 'node:fs'; if(existsSync('${target}') && readFileSync('${target}','utf8')!=='fixed\\n') process.exit(1); console.log('REAL_CHECK_PASSED');`,
	);
	git("init", "-q");
	checkpoint();
	clock = Date.now();
	events = [];
	bridge = await createOwner();
	client = connect(bridge);
	await client.hello();
});
afterEach(async () => {
	client?.close();
	await Promise.all(owners.splice(0).map((owner) => owner.shutdown()));
	harness.cleanup();
});

describe("C07 trusted prepare/confirm and canonical execution", () => {
	it("prepares criteria and plan without a writer, check or Provider call", async () => {
		const preview = await prepare();
		expect(preview).toMatchObject({
			workflow: "STANDARD",
			risk: "R1",
			executionMode: "EDIT",
			allowedPaths: ["src", "scripts"],
			acceptanceCriteria: [{ id: "AC-001", statement: goal, checkIds: ["regression"], reviewRequired: true }],
		});
		expect(harness.faux.state.callCount).toBe(0);
		expect(existsSync(join(cwd, ".ai/state.json"))).toBe(false);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it("confirms the exact contract and converges to independently checked COMPLETE", async () => {
		harness.setResponses([edit(), handoff, review]);
		const preview = await prepare();
		await mutation({ type: "workflow.confirm", previewId: preview.previewId, previewDigest: preview.previewDigest });
		const state = await idleState();
		expect(state.snapshot.status).toMatchObject({
			writerPresent: false,
			run: { status: "COMPLETED", taskContractDigest: preview.taskContractDigest },
		});
		expect(state.snapshot.evidence).toMatchObject({
			currentChecks: { passed: 2 },
			review: { result: "PASS", independent: true },
		});
		expect(readFileSync(join(cwd, target), "utf8")).toBe("fixed\n");
	});
	it("requires preparation rather than accepting a caller-minted plan identity", async () => {
		expect(
			(
				await mutation({
					type: "workflow.confirm",
					previewId: "invented",
					previewDigest: `sha256:${"0".repeat(64)}`,
				})
			).response,
		).toMatchObject({ success: false, error: { code: "PLAN_NOT_FOUND" } });
		expect(harness.faux.state.callCount).toBe(0);
	});
	it("rejects an expired preview and removes it from actionable observation", async () => {
		const preview = await prepare();
		clock = preview.expiresAt;
		expect((await client.state()).preview).toBeNull();
		expect(
			(
				await mutation({
					type: "workflow.confirm",
					previewId: preview.previewId,
					previewDigest: preview.previewDigest,
				})
			).response,
		).toMatchObject({ success: false, error: { code: "PLAN_EXPIRED" } });
	});
	it("rejects changed configuration and invalidates its old preview", async () => {
		const preview = await prepare();
		config.files.allowed_paths = ["src"];
		writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
		expect((await client.state()).preview).toBeNull();
		expect(
			(
				await mutation({
					type: "workflow.confirm",
					previewId: preview.previewId,
					previewDigest: preview.previewDigest,
				})
			).response,
		).toMatchObject({ success: false, error: { code: "CONFIG_CHANGED" } });
		expect(harness.faux.state.callCount).toBe(0);
	});
	it("rejects stale project revision without acquiring a writer", async () => {
		expect((await mutation({ type: "workflow.prepare", goal, expectedProjectRevision: 42 })).response).toMatchObject({
			success: false,
			error: { code: "STALE_PROJECT" },
		});
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it("returns the same duplicate confirmation receipt and starts exactly one Run", async () => {
		harness.setResponses([edit(), handoff, review]);
		const accepted = await start();
		expect(await client.request(accepted.request)).toEqual(accepted.response);
		await idleState();
		expect(events.filter((event) => event.type === "RunCreated")).toHaveLength(1);
		expect((await FileStateStore.readSnapshot(cwd)).state?.runs).toHaveLength(1);
		expect(
			(await mutation({ ...accepted.request, id: (await client.state()).nextRequestId })).response,
		).toMatchObject({ success: false, error: { code: "PLAN_CONSUMED" } });
	});
	it("rejects another start while the existing Developer owns the writer", async () => {
		const blocked = pausedWorker();
		harness.setResponses([edit(), blocked.response]);
		await start();
		await blocked.ready;
		expect((await mutation({ type: "workflow.prepare", goal })).response).toMatchObject({
			success: false,
			error: { code: "ACTIVE_RUN" },
		});
		expect(events.filter((event) => event.type === "RunCreated")).toHaveLength(1);
	});
	it("rejects unreviewed recipes without contacting a Provider", async () => {
		expect(
			(await mutation({ type: "workflow.prepare", goal, recipeId: "invented", recipeInputs: {} })).response,
		).toMatchObject({ success: false, error: { code: "INVALID_RECIPE" } });
		expect(harness.faux.state.callCount).toBe(0);
	});
	it("allows recipe drafting and user prose edits but Runtime assigns IDs and checks", async () => {
		const response = (
			await mutation({
				type: "workflow.prepare",
				goal,
				recipeId: "bugfix",
				recipeInputs: {
					reproduction: "wrong result",
					expected: "fixed result",
					preserve: "other behavior",
					regression: "registered check",
				},
				acceptanceStatements: ["User reviewed the exact expected result"],
			})
		).response;
		expect(response).toMatchObject({
			success: true,
			data: {
				kind: "prepared",
				preview: {
					recipe: { id: "bugfix" },
					acceptanceCriteria: [
						{
							id: "AC-001",
							statement: "User reviewed the exact expected result",
							checkIds: ["regression"],
							reviewRequired: true,
						},
					],
				},
			},
		});
	});
	it("keeps protected deletion denied by real preflight Policy", async () => {
		await start("Delete file .ai/config.yaml");
		const state = await idleState();
		expect(state.startFailure).toBe("START_FAILED");
		expect(state.snapshot.status.run).toBeNull();
		expect(harness.faux.state.callCount).toBe(0);
		expect(existsSync(join(cwd, ".ai/config.yaml"))).toBe(true);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
});

describe("C07 cancellation is acceptance then resource settlement", () => {
	it.each(["Developer", "Reviewer"] as const)(
		"cancels live %s and preserves partial edits until canonical writer release",
		async (role) => {
			const blocked = pausedWorker();
			harness.setResponses(role === "Developer" ? [edit(), blocked.response] : [edit(), handoff, blocked.response]);
			await start();
			await blocked.ready;
			const state = await client.state();
			const result = await mutation({
				type: "workflow.cancel",
				runId: state.ownedRunId,
				expectedStateRevision: state.stateRevision,
			});
			expect(result.response).toMatchObject({ success: true, data: { kind: "accepted" } });
			expect(await client.request(result.request)).toEqual(result.response);
			const final = await idleState();
			expect(final.snapshot.status).toMatchObject({
				writerPresent: false,
				run: { status: "CANCELLED", activeAgentCount: 0 },
			});
			expect(readFileSync(join(cwd, target), "utf8")).toBe("fixed\n");
			expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		},
	);
	it("cancels a real active check process before releasing the writer", async () => {
		const marker = join(agentDir, "check.pid");
		writeFileSync(
			join(cwd, "scripts/check.mjs"),
			`import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},String(process.pid)); setInterval(()=>{},1000);`,
		);
		checkpoint();
		harness.setResponses([edit(), handoff]);
		await start();
		await vi.waitFor(() => expect(existsSync(marker)).toBe(true), { timeout: 30000, interval: 20 });
		const pid = Number(readFileSync(marker, "utf8"));
		const state = await client.state();
		expect(
			(
				await mutation({
					type: "workflow.cancel",
					runId: state.ownedRunId,
					expectedStateRevision: state.stateRevision,
				})
			).response.success,
		).toBe(true);
		const final = await idleState();
		expect(final.snapshot.status).toMatchObject({ writerPresent: false, run: { status: "CANCELLED" } });
		expect(() => process.kill(pid, 0)).toThrow();
		expect(readFileSync(join(cwd, target), "utf8")).toBe("fixed\n");
	});
	it("rejects cancellation of terminal or foreign Runs instead of fabricating CANCELLED", async () => {
		harness.setResponses([edit(), handoff, review]);
		await start();
		const final = await idleState();
		expect(
			(
				await mutation({
					type: "workflow.cancel",
					runId: final.ownedRunId,
					expectedStateRevision: final.stateRevision,
				})
			).response,
		).toMatchObject({ success: false, error: { code: "TERMINAL_RUN" } });
		expect(
			(await mutation({ type: "workflow.cancel", runId: "forged", expectedStateRevision: final.stateRevision }))
				.response,
		).toMatchObject({ success: false, error: { code: "RUN_NOT_FOUND" } });
		expect((await client.state()).snapshot.status.run?.status).toBe("COMPLETED");
	});
	it("disconnects a client without cancelling or releasing its live owner", async () => {
		const blocked = pausedWorker();
		harness.setResponses([edit(), blocked.response]);
		await start();
		await blocked.ready;
		const before = await client.state();
		client.close();
		client = connect(bridge);
		await client.hello();
		const after = await client.state();
		expect(after).toMatchObject({
			ownerId: before.ownerId,
			ownedRunId: before.ownedRunId,
			busy: true,
			snapshot: { status: { writerPresent: true, run: { status: "RUNNING" } } },
		});
		await mutation({ type: "workflow.cancel", runId: after.ownedRunId, expectedStateRevision: after.stateRevision });
		expect((await idleState()).snapshot.status.run?.status).toBe("CANCELLED");
	});
});

describe("C07 existing scoped R3 approval", () => {
	it("approves once, consumes the exact Runtime grant, then requires independent completion evidence", async () => {
		harness.setResponses([remove(), handoff, review]);
		await start(`Delete file ${target}`);
		const approval = await pendingApproval();
		expect(existsSync(join(cwd, target))).toBe(true);
		const result = await mutation({
			type: "approval.resolve",
			runId: approval.runId,
			expectedStateRevision: approval.stateRevision,
			approvalId: approval.approvalId,
			decision: "approve",
		});
		expect(result.response).toMatchObject({ success: true, data: { kind: "accepted" } });
		expect(await client.request(result.request)).toEqual(result.response);
		const final = await idleState();
		expect(final.snapshot.status).toMatchObject({ writerPresent: false, run: { status: "COMPLETED" } });
		const stored = (await FileStateStore.readSnapshot(cwd)).state!;
		expect(stored.runs[0].approvals?.map((record) => record.status)).toEqual(["CONSUMED"]);
		expect(
			stored.actions.filter((action) => action.decision.risk === "R3" && action.status === "SUCCEEDED"),
		).toHaveLength(1);
		expect(existsSync(join(cwd, target))).toBe(false);
		expect(readFileSync(join(cwd, "src/keep.js"), "utf8")).toBe("preserved\n");
		expect(final.snapshot.evidence).toMatchObject({
			currentChecks: { passed: 2 },
			review: { result: "PASS", independent: true },
		});
	});
	it("rejects the pending action without deletion, checks or completion", async () => {
		harness.setResponses([remove(), handoff]);
		await start(`Delete file ${target}`);
		const approval = await pendingApproval();
		await mutation({
			type: "approval.resolve",
			runId: approval.runId,
			expectedStateRevision: approval.stateRevision,
			approvalId: approval.approvalId,
			decision: "reject",
		});
		const final = await idleState();
		expect(final.snapshot.status.run?.status).toBe("BLOCKED");
		expect((await FileStateStore.readSnapshot(cwd)).state?.runs[0].approvals?.[0].status).toBe("DENIED");
		expect(existsSync(join(cwd, target))).toBe(true);
		expect(final.snapshot.evidence?.currentChecks.total).toBe(0);
		expect(
			(
				await mutation({
					type: "approval.resolve",
					runId: approval.runId,
					expectedStateRevision: final.stateRevision,
					approvalId: approval.approvalId,
					decision: "approve",
				})
			).response,
		).toMatchObject({ success: false, error: { code: "TERMINAL_RUN" } });
	});
	it.each(["revision", "run", "approval"] as const)(
		"rejects a foreign or stale %s binding while leaving the pending grant unchanged",
		async (field) => {
			harness.setResponses([remove(), handoff]);
			await start(`Delete file ${target}`);
			const approval = await pendingApproval();
			const response = (
				await mutation({
					type: "approval.resolve",
					runId: field === "run" ? "forged" : approval.runId,
					expectedStateRevision: approval.stateRevision - (field === "revision" ? 1 : 0),
					approvalId: field === "approval" ? "forged" : approval.approvalId,
					decision: "approve",
				})
			).response;
			expect(response).toMatchObject({
				success: false,
				error: {
					code: field === "revision" ? "STALE_RUN" : field === "run" ? "RUN_NOT_FOUND" : "APPROVAL_NOT_PENDING",
				},
			});
			expect(existsSync(join(cwd, target))).toBe(true);
			expect((await client.state()).pendingApproval?.approvalId).toBe(approval.approvalId);
		},
	);
	it("rejects expired approval and never expands the approved action payload", async () => {
		harness.setResponses([remove(), handoff]);
		await start(`Delete file ${target}`);
		const approval = await pendingApproval();
		expect(
			(
				await mutation({
					type: "approval.resolve",
					runId: approval.runId,
					expectedStateRevision: approval.stateRevision,
					approvalId: approval.approvalId,
					decision: "approve",
					path: "src/keep.js",
					scope: "all",
				})
			).response,
		).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
		clock = approval.expiresAt;
		expect(
			(
				await mutation({
					type: "approval.resolve",
					runId: approval.runId,
					expectedStateRevision: approval.stateRevision,
					approvalId: approval.approvalId,
					decision: "approve",
				})
			).response,
		).toMatchObject({ success: false, error: { code: "APPROVAL_EXPIRED" } });
		expect(existsSync(join(cwd, target))).toBe(true);
	});
});

describe("C07 closed authority and replay boundary", () => {
	it.each(["write", "edit", "pass", "complete", "set-policy", "task-contract"])(
		"has no %s authority command",
		async (type) => {
			expect(
				await client.request({ protocolVersion: 1, id: "attack", type, path: ".ai/state.json", content: "FORGED" }),
			).toMatchObject({ success: false, error: { code: "UNSUPPORTED_COMMAND" } });
			expect(harness.faux.state.callCount).toBe(0);
			expect(existsSync(join(cwd, ".ai/state.json"))).toBe(false);
		},
	);
	it("rejects forged Policy and Task Contract fields even on a valid preparation", async () => {
		for (const field of ["risk", "scope", "checks", "taskContract", "policy", "review", "complete"]) {
			expect((await mutation({ type: "workflow.prepare", goal, [field]: "forged" })).response).toMatchObject({
				success: false,
				error: { code: "INVALID_REQUEST" },
			});
		}
		expect(harness.faux.state.callCount).toBe(0);
	});
	it("rejects payload-conflicting reuse and permanently rejects an evicted request ID", async () => {
		const first = await mutation({ type: "workflow.prepare", goal });
		expect(await client.request({ ...first.request, goal: "Different task" })).toMatchObject({
			success: false,
			error: { code: "REQUEST_ID_REUSED" },
		});
		for (let index = 0; index < 64; index++) await mutation({ type: "workflow.prepare", goal });
		expect(await client.request(first.request)).toMatchObject({ success: false, error: { code: "REQUEST_EXPIRED" } });
		expect(harness.faux.state.callCount).toBe(0);
	});
	it("rejects prior-owner mutations after a real owner restart", async () => {
		const preview = await prepare();
		const old = await client.state();
		await bridge.shutdown();
		bridge = await createOwner();
		client = connect(bridge);
		await client.hello();
		expect(
			await client.request({
				protocolVersion: 1,
				id: old.nextRequestId,
				ownerId: old.ownerId,
				expectedProjectRevision: old.projectRevision,
				type: "workflow.confirm",
				previewId: preview.previewId,
				previewDigest: preview.previewDigest,
			}),
		).toMatchObject({ success: false, error: { code: "OWNER_CHANGED" } });
		expect(harness.faux.state.callCount).toBe(0);
	});
	it("rejects replaced project identity and oversized or malformed input", async () => {
		expect((await mutation({ type: "workflow.prepare", goal: "x".repeat(2049) })).response).toMatchObject({
			success: false,
			error: { code: "INVALID_REQUEST" },
		});
		expect(await client.request({ protocolVersion: 2, id: "wrong-version", type: "control.snapshot" })).toMatchObject(
			{ success: false, error: { code: "UNSUPPORTED_VERSION" } },
		);
		renameSync(cwd, `${cwd}-old`);
		mkdirSync(cwd);
		expect(await client.request({ protocolVersion: 1, id: "changed-root", type: "control.snapshot" })).toMatchObject({
			success: false,
			error: { code: "PROJECT_CHANGED" },
		});
	});
	it("projects no source, raw verifier arguments or Provider credentials", async () => {
		const secret = "C07_PRIVATE_CREDENTIAL_MARKER";
		const source = "C07_PROTECTED_SOURCE_MARKER";
		config.verification.checks[0].args.push(secret);
		checkpoint();
		writeFileSync(join(agentDir, "auth.json"), secret);
		writeFileSync(join(cwd, ".ai/private-source"), source);
		const prepared = await prepare();
		const observed = await client.state();
		expect(JSON.stringify({ prepared, observed })).not.toContain(secret);
		expect(JSON.stringify({ prepared, observed })).not.toContain(source);
	});
});
