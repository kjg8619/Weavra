import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyRequest } from "../src/classification.ts";
import type { Handoff, PolicyDecision, Run, VerificationResult } from "../src/contracts.ts";
import { taskContractDigest } from "../src/criterion-evidence.ts";
import { assertCanComplete, CompanyKernel, type CompletionEvidence } from "../src/kernel.ts";
import { evaluatePolicy, executePolicyAction, type PolicyAction, type PolicyContext } from "../src/policy.ts";
import { FileStateStore } from "../src/state-store.ts";
import { testContract } from "./fixture-contract.ts";

const context: PolicyContext = {
	executionMode: "EDIT",
	executionRunId: "run",
	tools: [
		{ id: "write", operation: "write" },
		{ id: "read", operation: "read" },
	],
	allowedPaths: ["package.json", "src", ".ai", ".git"],
	configDigest: "config",
	r2RunId: "run",
};
const action: PolicyAction = {
	runId: "run",
	actionId: "action",
	actionDigest: "input",
	role: "Developer",
	tool: "write",
	risk: "R1",
	paths: ["package.json"],
};
const inspected = [{ path: "package.json", safe: true, kind: "file" as const }];
function evidence(): CompletionEvidence {
	const task = testContract("Update dependency", {
		taskId: "task",
		statements: ["Update dependency"],
		checkIds: ["regression"],
	});
	const handoff: Handoff = {
		runId: "run",
		revision: 0,
		task: "task",
		role: "Developer",
		summary: "Updated manifest",
		changed_files: ["package.json"],
		tests_run: [],
		assumptions: [],
		known_risks: [],
		unresolved: [],
	};
	const verification: VerificationResult = {
		runId: "run",
		revision: 0,
		step: { stepId: "self-check", attempt: 1 },
		diffDigest: "digest",
		evidenceRefs: ["diff"],
		checks: [
			{
				id: "regression",
				kind: "test",
				required: true,
				runId: "run",
				revision: 0,
				diffDigest: "digest",
				status: "PASS",
				exitCode: 0,
				reason: "Executed",
				evidenceRefs: ["check"],
			},
		],
	};
	return {
		executionMode: "EDIT",
		runId: "run",
		task,
		taskContractDigest: taskContractDigest(task),
		handoff,
		revision: 0,
		workflow: "STANDARD",
		risk: "R2",
		checks: [{ id: "regression", kind: "test", required: true }],
		selfCheck: verification,
		finalCheck: { ...structuredClone(verification), step: { stepId: "test", attempt: 1 } },
		workspace: { safe: true, diffDigest: "digest", changedFiles: ["package.json"], evidenceRefs: ["diff"] },
		developerSession: { role: "Developer", sessionId: "developer", sessionFile: "/sessions/developer.jsonl" },
		reviewerSession: { role: "Reviewer", sessionId: "reviewer", sessionFile: "/sessions/reviewer.jsonl" },
		review: {
			runId: "run",
			revision: 0,
			task: "task",
			role: "Reviewer",
			result: "PASS",
			diffDigest: "digest",
			evidenceRefs: ["diff"],
			issues: [],
			criteria: [{ criterionId: "AC-001", status: "MET", evidenceRefs: ["diff"] }],
		},
	};
}

describe("S5B R2 execution binding", () => {
	it("permits registered dependency mutation only with this run's mandatory review binding", () => {
		expect(evaluatePolicy(action, context, inspected)).toMatchObject({
			risk: "R2",
			decision: "ALLOW",
			reason: expect.stringContaining("mandatory independent"),
		});
		expect(evaluatePolicy(action, { ...context, r2RunId: undefined }, inspected).decision).toBe("REVIEW_REQUIRED");
	});
	it.each(["other-run", "other-role", "quick", "protected", "outside", "symlink", "unknown-tool", "R3", "UNKNOWN"])(
		"cannot widen R2 binding via %s",
		(mode) => {
			const request = structuredClone(action);
			const policy = structuredClone(context);
			const paths = structuredClone(inspected);
			if (mode === "other-run") request.runId = "other";
			if (mode === "other-role") request.role = "Executor";
			if (mode === "quick") policy.executorScope = { risk: "R1", targetPath: "package.json" };
			if (mode === "protected") {
				request.paths = [".ai/config.yaml"];
				paths[0].path = ".ai/config.yaml";
			}
			if (mode === "outside") {
				request.paths = ["outside/file.ts"];
				paths[0].path = "outside/file.ts";
			}
			if (mode === "symlink") paths[0].safe = false;
			if (mode === "unknown-tool") request.tool = "bash";
			if (mode === "R3" || mode === "UNKNOWN") request.risk = mode;
			expect(evaluatePolicy(request, policy, paths).decision).not.toBe("ALLOW");
		},
	);
	it("Reviewer remains read-only in a bound R2 run", () => {
		expect(evaluatePolicy({ ...action, role: "Reviewer" }, context, inspected).decision).toBe("DENY");
		expect(
			evaluatePolicy({ ...action, role: "Reviewer", tool: "read", risk: "R0" }, context, inspected).decision,
		).toBe("ALLOW");
	});
});

describe("R2 Kernel completion", () => {
	it("accepts current independent PASS and live required verification evidence", () => {
		expect(() => assertCanComplete(evidence())).not.toThrow();
	});
	it.each([
		(e: CompletionEvidence) => {
			e.workflow = "QUICK";
		},
		(e: CompletionEvidence) => {
			e.risk = "R3";
		},
		(e: CompletionEvidence) => {
			e.developerSession = undefined;
		},
		(e: CompletionEvidence) => {
			e.reviewerSession = undefined;
		},
		(e: CompletionEvidence) => {
			e.reviewerSession!.sessionId = e.developerSession!.sessionId;
		},
		(e: CompletionEvidence) => {
			e.reviewerSession!.sessionFile = e.developerSession!.sessionFile;
		},
		(e: CompletionEvidence) => {
			e.reviewerSession!.role = "Developer";
		},
		(e: CompletionEvidence) => {
			e.review = undefined;
		},
		(e: CompletionEvidence) => {
			e.review!.result = "REVISE";
		},
		(e: CompletionEvidence) => {
			e.review!.result = "BLOCK";
		},
		(e: CompletionEvidence) => {
			e.review!.revision++;
		},
		(e: CompletionEvidence) => {
			e.review!.diffDigest = "stale";
		},
		(e: CompletionEvidence) => {
			e.workspace = undefined;
		},
		(e: CompletionEvidence) => {
			e.workspace!.diffDigest = "changed";
		},
		(e: CompletionEvidence) => {
			e.workspace!.safe = false;
		},
		(e: CompletionEvidence) => {
			e.checks = [];
			e.selfCheck!.checks = [];
			e.finalCheck!.checks = [];
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.checks[0].status = "FAIL";
		},
		(e: CompletionEvidence) => {
			e.handoff!.unresolved.push("unfinished");
		},
	])("rejects omitted/forged/stale R2 evidence %i", (mutate) => {
		const value = evidence();
		mutate(value);
		expect(() => assertCanComplete(value)).toThrow();
	});
});

const directories: string[] = [];
const stores: FileStateStore[] = [];
afterEach(async () => {
	for (const store of stores.splice(0)) await store.close().catch(() => {});
	for (const cwd of directories.splice(0)) await rm(cwd, { recursive: true, force: true });
});
async function storeFixture(risk: "R1" | "R2" = "R2") {
	const cwd = await mkdtemp(join(tmpdir(), "company-r2-store-"));
	directories.push(cwd);
	const store = await FileStateStore.open(cwd);
	stores.push(store);
	const kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: "run",
			task: { ...evidence().task, status: "pending" },
			classification: { ...classifyRequest("Update dependency").classification, risk },
			checks: evidence().checks,
		},
		{
			store,
			agents: {
				execute: async () => {
					throw new Error("No SDK in storage unit test");
				},
			},
			verifier: {
				verify: async () => {
					throw new Error("No check in storage unit test");
				},
				inspect: async () => evidence().workspace!,
			},
		},
	);
	await kernel.start();
	const run: Run = {
		...kernel.snapshot,
		revision: kernel.snapshot.revision + 1,
		activeAgents: ["Developer"],
		roleSessionRefs: [evidence().developerSession!],
	};
	await store.save(run);
	return store;
}
describe("durable R2 intent enforcement", () => {
	it("persists the R2 Developer intent and result under the owned running run", async () => {
		const store = await storeFixture();
		const execute = vi.fn(async () => "done");
		const result = await executePolicyAction(action, context, {
			audit: store,
			paths: { inspect: async () => inspected },
			execute,
		});
		expect(result.decision.risk).toBe("R2");
		expect(execute).toHaveBeenCalledOnce();
		expect(store.snapshot.actions[0].status).toBe("SUCCEEDED");
	});
	it("a run ID binding alone cannot authorize a durable R1 owner", async () => {
		const store = await storeFixture("R1");
		const execute = vi.fn(async () => "must not run");
		await expect(
			executePolicyAction(action, context, { audit: store, paths: { inspect: async () => inspected }, execute }),
		).rejects.toThrow();
		expect(execute).not.toHaveBeenCalled();
		expect(store.snapshot.actions).toEqual([]);
	});
	it.each(["risk", "workflow"])("cannot downgrade persisted R2 %s", async (field) => {
		const store = await storeFixture();
		const run = store.snapshot.runs[0];
		await expect(
			store.save({
				...run,
				revision: run.revision + 1,
				...(field === "risk" ? { risk: "R1" } : { workflow: "QUICK" }),
			}),
		).rejects.toThrow();
	});
	it.each(["session", "phase", "role", "run"])(
		"refuses a forged R2 intent with missing/wrong %s before executor invocation",
		async (mode) => {
			const store = await storeFixture();
			const run = store.snapshot.runs[0];
			if (mode === "session") await store.save({ ...run, revision: run.revision + 1, roleSessionRefs: [] });
			if (mode === "phase")
				await store.save({
					...run,
					revision: run.revision + 1,
					phase: "TEST",
					currentStep: { stepId: "test", attempt: 1 },
				});
			const decision: PolicyDecision = {
				...evaluatePolicy(action, context, inspected),
				...(mode === "role" ? { role: "Reviewer" } : {}),
				...(mode === "run" ? { runId: "other" } : {}),
			};
			const execute = vi.fn();
			await expect(
				(async () => {
					await store.prepare(decision);
					execute();
				})(),
			).rejects.toThrow();
			expect(execute).not.toHaveBeenCalled();
			expect(store.snapshot.actions).toEqual([]);
		},
	);
});
