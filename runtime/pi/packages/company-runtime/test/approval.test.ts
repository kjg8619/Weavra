import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { awaitApproval, selectR3Scope } from "../src/approval.ts";
import { classifyRequest } from "../src/classification.ts";
import type { ApprovalDecision, ApprovalRequest } from "../src/contracts.ts";
import { CompanyKernel } from "../src/kernel.ts";
import { evaluatePolicy, executePolicyAction, type PolicyAction, type PolicyContext } from "../src/policy.ts";
import { FileStateStore } from "../src/state-store.ts";
import { testContract } from "./fixture-contract.ts";

function request(): ApprovalRequest {
	return {
		runId: "run",
		actionId: "action",
		actionDigest: "input",
		configDigest: "config",
		role: "Developer",
		operation: "delete-file",
		path: "src/obsolete.ts",
		preconditionDigest: "fingerprint",
		bytes: 10,
		reason: "Delete selected tracked text file",
		step: { stepId: "implement", attempt: 1 },
		revision: 0,
		expiresAt: Date.now() + 10000,
	};
}
function decision(value: ApprovalRequest, approved = true): ApprovalDecision {
	return {
		runId: value.runId,
		actionId: value.actionId,
		actionDigest: value.actionDigest,
		configDigest: value.configDigest,
		expiresAt: value.expiresAt,
		approved,
	};
}
const action: PolicyAction = {
	runId: "run",
	actionId: "action",
	actionDigest: "input",
	role: "Developer",
	tool: "runtime_delete",
	risk: "R3",
	paths: ["src/obsolete.ts"],
};
const context: PolicyContext = {
	executionMode: "EDIT",
	executionRunId: "run",
	tools: [
		{ id: "runtime_delete", operation: "delete" },
		{ id: "write", operation: "write" },
	],
	allowedPaths: ["src", "package.json", ".ai", ".git"],
	configDigest: "config",
	r3Scope: { runId: "run", targetPath: "src/obsolete.ts" },
};
const inspected = [{ path: "src/obsolete.ts", safe: true, kind: "file" as const }];

describe("S5C bounded human approval", () => {
	it.each(["Delete file src/obsolete.ts", "Remove file src/obsolete.ts", "파일 삭제 src/obsolete.ts"])(
		"recognizes only the bounded action %s",
		(goal) => {
			expect(selectR3Scope(goal, "run")).toEqual(context.r3Scope);
			expect(classifyRequest(goal).classification.risk).toBe("R3");
		},
	);
	it.each([
		"Delete all files",
		"Delete file ../outside.ts",
		"Delete file /outside.ts",
		"Deploy production",
		"Delete file src/*.ts",
		"Delete file src/a.ts src/b.ts",
	])("refuses unsupported R3 scope: %s", (goal) => {
		expect(selectR3Scope(goal, "run")).toBeUndefined();
	});
	it("only accepts exact bound unexpired affirmative consent", async () => {
		const value = request();
		const result = await awaitApproval(value, {
			requestApproval: async (copy) => {
				copy.path = "mutated UI copy";
				return decision(value);
			},
		});
		expect(result.status).toBe("APPROVED");
		expect(value.path).toBe("src/obsolete.ts");
	});
	it.each(["runId", "actionId", "actionDigest", "configDigest", "expiresAt", "approved"] as const)(
		"rejects changed decision binding %s",
		async (key) => {
			const value = request();
			const answer = decision(value);
			if (key === "expiresAt") answer.expiresAt++;
			else if (key === "approved") answer.approved = false;
			else answer[key] = "other";
			expect((await awaitApproval(value, { requestApproval: async () => answer })).status).toBe("DENIED");
		},
	);
	it("treats unavailable or throwing UI as denial", async () => {
		expect(
			(
				await awaitApproval(request(), {
					requestApproval: async () => {
						throw new Error("UI unavailable");
					},
				})
			).status,
		).toBe("DENIED");
	});
	it("does not call the authority for pre-cancelled requests", async () => {
		const approve = vi.fn(async (value: ApprovalRequest) => decision(value));
		expect((await awaitApproval(request(), { requestApproval: approve }, AbortSignal.abort())).status).toBe(
			"CANCELLED",
		);
		expect(approve).not.toHaveBeenCalled();
	});
	it("expires a non-cooperative UI and ignores a later approval", async () => {
		const value = { ...request(), expiresAt: Date.now() + 30 };
		let release!: (result: ApprovalDecision) => void;
		const late = new Promise<ApprovalDecision>((resolve) => {
			release = resolve;
		});
		const result = await awaitApproval(value, { requestApproval: async () => late });
		expect(result.status).toBe("EXPIRED");
		release(decision(value));
		await late;
		expect(result.decision.approved).toBe(false);
	});
	it("cancels a pending UI and dismisses its signal", async () => {
		const controller = new AbortController();
		let uiSignal: AbortSignal | undefined;
		const result = await awaitApproval(
			request(),
			{
				requestApproval: async (value, signal) => {
					uiSignal = signal;
					controller.abort();
					return decision(value);
				},
			},
			controller.signal,
		);
		expect(result.status).toBe("CANCELLED");
		expect(uiSignal?.aborted).toBe(true);
	});
});

describe("R3 Policy cannot inherit R2 or general write permissions", () => {
	it("requires approval by default; accepts only the supported scoped deletion with a live grant", () => {
		expect(evaluatePolicy(action, context, inspected).decision).toBe("APPROVAL_REQUIRED");
		expect(
			evaluatePolicy(action, { ...context, r3Approval: decision(request()) }, inspected, Date.now()).decision,
		).toBe("ALLOW");
	});
	it.each([
		"expired",
		"other-run",
		"other-action",
		"other-input",
		"other-config",
		"role",
		"r2",
		"quick",
		"write",
		"protected",
		"dependency",
		"missing",
		"unsafe",
	])("denies %s despite affirmative approval", (mode) => {
		const value = request();
		const policy = { ...structuredClone(context), r3Approval: decision(value) };
		const attempt = structuredClone(action);
		const paths: Array<{ path: string; safe: boolean; kind: "file" | "missing" }> = structuredClone(inspected);
		if (mode === "expired") policy.r3Approval.expiresAt = 0;
		if (mode === "other-run") attempt.runId = "other";
		if (mode === "other-action") attempt.actionId = "other";
		if (mode === "other-input") attempt.actionDigest = "other";
		if (mode === "other-config") policy.configDigest = "other";
		if (mode === "role") attempt.role = "Reviewer";
		if (mode === "r2") policy.r2RunId = "run";
		if (mode === "quick") policy.executorScope = { risk: "R1", targetPath: "src/obsolete.ts" };
		if (mode === "write") attempt.tool = "write";
		if (mode === "protected" || mode === "dependency") {
			const path = mode === "protected" ? ".ai/config.yaml" : "package.json";
			policy.r3Scope!.targetPath = path;
			attempt.paths = [path];
			paths[0].path = path;
		}
		if (mode === "missing") paths[0].kind = "missing";
		if (mode === "unsafe") paths[0].safe = false;
		expect(evaluatePolicy(attempt, policy, paths, Date.now()).decision).not.toBe("ALLOW");
	});
});

const directories: string[] = [];
const stores: FileStateStore[] = [];
afterEach(async () => {
	for (const store of stores.splice(0)) await store.close().catch(() => {});
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
async function fixture(now?: () => number) {
	const cwd = await mkdtemp(join(tmpdir(), "company-approval-store-"));
	directories.push(cwd);
	const store = await FileStateStore.open(cwd, { now });
	stores.push(store);
	const goal = "Delete file src/obsolete.ts";
	const kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: "run",
			task: testContract(goal, { taskId: "task", checkIds: ["check"] }),
			classification: classifyRequest(goal).classification,
			checks: [{ id: "check", kind: "test", required: true }],
		},
		{
			store,
			agents: {
				execute: async () => {
					throw new Error("Unit test");
				},
			},
			verifier: {
				verify: async () => {
					throw new Error("Unit test");
				},
				inspect: async () => ({ safe: true, diffDigest: "diff", changedFiles: [], evidenceRefs: ["diff"] }),
			},
			approval: { requestApproval: async (value) => decision(value) },
		},
	);
	await kernel.start();
	const run = kernel.snapshot;
	await store.save({
		...run,
		revision: run.revision + 1,
		activeAgents: ["Developer"],
		roleSessionRefs: [{ role: "Developer", sessionId: "developer", sessionFile: "/sessions/developer" }],
	});
	const value = request();
	let current = store.snapshot.runs[0];
	await store.save({
		...current,
		revision: current.revision + 1,
		status: "WAITING_APPROVAL",
		approvals: [{ request: value, status: "PENDING" }],
	});
	current = store.snapshot.runs[0];
	await store.save({
		...current,
		revision: current.revision + 1,
		status: "RUNNING",
		approvals: [{ request: value, status: "APPROVED" }],
	});
	return { store, value, cwd };
}
describe("durable one-use approval", () => {
	it("requires a successful action before consumption and rejects replay", async () => {
		const { store, value } = await fixture();
		const execute = vi.fn(async () => "deleted");
		await executePolicyAction(
			action,
			{ ...context, r3Approval: decision(value) },
			{ audit: store, paths: { inspect: async () => inspected }, execute },
		);
		const run = store.snapshot.runs[0];
		await store.save({ ...run, revision: run.revision + 1, approvals: [{ request: value, status: "CONSUMED" }] });
		await expect(
			executePolicyAction(
				action,
				{ ...context, r3Approval: decision(value) },
				{ audit: store, paths: { inspect: async () => inspected }, execute },
			),
		).rejects.toThrow();
		expect(execute).toHaveBeenCalledOnce();
	});
	it("durable prepare rejects expired consent even if a caller submits ALLOW", async () => {
		let clock = Date.now();
		const { store, value } = await fixture(() => clock);
		const allowed = evaluatePolicy(action, { ...context, r3Approval: decision(value) }, inspected, Date.now());
		clock = value.expiresAt + 1;
		const execute = vi.fn();
		await expect(
			(async () => {
				await store.prepare(allowed);
				execute();
			})(),
		).rejects.toThrow();
		expect(execute).not.toHaveBeenCalled();
	});
	it("durable prepare rejects mismatched action digests despite a valid grant", async () => {
		const { store, value } = await fixture();
		const allowed = evaluatePolicy(action, { ...context, r3Approval: decision(value) }, inspected, Date.now());
		await expect(store.prepare({ ...allowed, actionDigest: "different" })).rejects.toThrow();
		expect(store.snapshot.actions).toEqual([]);
	});
	it("cannot invent consumption without durable execution evidence", async () => {
		const { store, value } = await fixture();
		const run = store.snapshot.runs[0];
		await expect(
			store.save({ ...run, revision: run.revision + 1, approvals: [{ request: value, status: "CONSUMED" }] }),
		).rejects.toThrow();
	});
	it.each(["path", "digest", "remove", "downgrade"])("cannot rewrite approval ledger: %s", async (mode) => {
		const { store, value } = await fixture();
		const run = store.snapshot.runs[0];
		const changed = structuredClone(value);
		if (mode === "path") changed.path = "src/other.ts";
		if (mode === "digest") changed.actionDigest = "other";
		await expect(
			store.save({
				...run,
				revision: run.revision + 1,
				risk: mode === "downgrade" ? "R2" : "R3",
				approvals: mode === "remove" ? [] : [{ request: changed, status: "APPROVED" }],
			}),
		).rejects.toThrow();
	});
	it("interrupts outstanding grants on reopen instead of reusing them", async () => {
		const { store, cwd } = await fixture();
		await store.close();
		const reopened = await FileStateStore.open(cwd);
		stores.push(reopened);
		expect(reopened.snapshot.runs[0].status).toBe("INTERRUPTED");
		expect(reopened.snapshot.runs[0].approvals?.[0].status).toBe("INTERRUPTED");
	});
});
