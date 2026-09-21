import { describe, expect, it } from "vitest";
import { classifyRequest, selectWorkflow } from "../src/classification.ts";
import type { ExecutorHandoff, QuickScope, Run, VerificationResult } from "../src/contracts.ts";
import { taskContractDigest } from "../src/criterion-evidence.ts";
import { assertCanComplete, type CompletionEvidence } from "../src/kernel.ts";
import { evaluatePolicy } from "../src/policy.ts";
import { assertQuickWorkspace, changedLineCount, QUICK_MAX_CHANGED_LINES, selectQuickScope } from "../src/quick.ts";
import { testContract } from "./fixture-contract.ts";

function evidence(risk: "R0" | "R1" = "R1"): CompletionEvidence {
	const changedFiles = risk === "R0" ? [] : ["src/app.ts"];
	const requirement = risk === "R0" ? "Explain src/app.ts" : "Correct label";
	const handoff: ExecutorHandoff = {
		runId: "run",
		revision: 0,
		role: "Executor",
		task: "task",
		changed_files: [...changedFiles],
		summary: risk === "R0" ? "Explained source behavior" : "Corrected spelling",
		assumptions: [],
		tests_run: [],
		known_risks: [],
		unresolved: [],
		criteria: [
			{
				criterionId: "AC-001",
				status: "MET",
				explanation: "Label spelling corrected in the named source file",
			},
		],
	};
	const selfCheck: VerificationResult = {
		runId: "run",
		revision: 0,
		step: { stepId: "self-check", attempt: 1 },
		diffDigest: "digest",
		evidenceRefs: ["diff:digest"],
		changedFiles: [...changedFiles],
		checks: [
			{
				id: "test",
				kind: "test",
				required: true,
				runId: "run",
				revision: 0,
				status: "PASS",
				exitCode: 0,
				reason: "Executed",
				evidenceRefs: ["check:test"],
				diffDigest: "digest",
			},
		],
	};
	const task = testContract(risk === "R0" ? requirement : "Fix typo in src/app.ts", {
		taskId: "task",
		checkIds: ["test"],
		workflow: "QUICK",
	});
	return {
		executionMode: risk === "R0" ? "READ_ONLY" : "EDIT", // Explicit grants for these two test scenarios.
		workflow: "QUICK",
		risk,
		executorDigest: "digest",
		quickScope: { risk, targetPath: risk === "R0" ? null : "src/app.ts" },
		workspace: {
			safe: true,
			diffDigest: "digest",
			evidenceRefs: ["diff:digest"],
			changedFiles: [...changedFiles],
			changedLines: risk === "R0" ? 0 : 2,
		},
		runId: "run",
		revision: 0,
		task,
		taskContractDigest: taskContractDigest(task),
		checks: [{ id: "test", kind: "test", required: true }],
		handoff,
		selfCheck,
		finalCheck: { ...structuredClone(selfCheck), step: { stepId: "test", attempt: 1 } },
	};
}

describe("QUICK routing and fixed scope", () => {
	it.each([
		"Fix typo in src/app.ts",
		"작은 설정 수정 ui/settings.json",
		"Add a small change in src/app.ts",
		"Explain src/app.ts",
	])("selects a small R0/R1 organization for %s", (goal) => {
		const result = classifyRequest(goal);
		expect(result.requiresConfirmation).toBe(false);
		expect(selectWorkflow(result.classification)).toEqual({ workflow: "QUICK", roles: ["Executor"] });
		expect(selectQuickScope(goal, result.classification).risk).toBe(goal.startsWith("Explain") ? "R0" : "R1");
	});
	it.each([
		"Fix typo",
		"Fix typo in src/a.ts and src/b.ts",
		"Fix typo in ../escape.ts",
		"Fix typo in /outside.ts",
		"Refactor one file src/app.ts",
		"Fix typo in production src/app.ts",
		"Fix dependency typo in package.json",
		"Fix architecture typo in src/app.ts",
	])("refuses unsafe/unclear QUICK scope: %s", (goal) => {
		expect(() => selectQuickScope(goal, classifyRequest(goal).classification)).toThrow();
	});
	it.each(["R2", "R3"] as const)("never chooses an Executor for %s even with explicit QUICK", (risk) => {
		const { classification } = classifyRequest("Fix typo in src/app.ts", { risk });
		expect(selectWorkflow(classification, "QUICK").roles).toEqual(["Developer", "Reviewer"]);
		expect(() => selectQuickScope("Fix typo in src/app.ts", classification)).toThrow();
	});
	it("counts the conservative changed span without another diff engine", () => {
		expect(changedLineCount("a\nb\nc\n", "a\nx\nc\n")).toBe(2);
		expect(changedLineCount("same", "same")).toBe(0);
		expect(changedLineCount("before", "x\n".repeat(101))).toBeGreaterThan(QUICK_MAX_CHANGED_LINES);
	});
	it.each([
		{ risk: "R0", targetPath: null },
		{ risk: "R1", targetPath: "src/target.ts" },
	] satisfies QuickScope[])("Policy denies mutations outside %j even without SDK tool visibility", (executorScope) => {
		const decision = evaluatePolicy(
			{
				runId: "run",
				actionId: "action",
				actionDigest: "digest",
				role: "Executor",
				tool: "write",
				risk: "R1",
				paths: ["src/other.ts"],
			},
			{
				tools: [{ id: "write", operation: "write" }],
				allowedPaths: ["src"],
				configDigest: "config",
				executorScope,
				executionMode: "EDIT",
				executionRunId: "run",
			},
			[{ path: "src/other.ts", safe: true, kind: "file" }],
		);
		expect(decision.decision).toBe("DENY");
	});
});

describe.each(["R0", "R1"] as const)("QUICK/%s Kernel completion guard", (risk) => {
	it("accepts complete structured requirements and both real-evidence stages without review", () => {
		expect(() => assertCanComplete(evidence(risk))).not.toThrow();
	});
	it("allows informational known risks only for read-only R0, otherwise requires STANDARD", () => {
		// RC-01: explaining existing code can report a risk without leaving the explanation unfinished.
		const value = evidence(risk);
		value.handoff!.known_risks = ["Existing code does not handle division by zero"];
		if (risk === "R0") expect(() => assertCanComplete(value)).not.toThrow();
		else expect(() => assertCanComplete(value)).toThrow("STANDARD required");
	});
	it("rejects a missing frozen digest or a changed Task Contract despite valid checks", () => {
		const missing = evidence(risk);
		delete missing.taskContractDigest;
		expect(() => assertCanComplete(missing)).toThrow();
		const changed = evidence(risk);
		changed.task.acceptanceCriteria[0].statement = "A different requirement";
		expect(() => assertCanComplete(changed)).toThrow();
	});
	it.each([
		(e: CompletionEvidence) => {
			e.handoff = undefined;
		},
		(e: CompletionEvidence) => {
			e.selfCheck = undefined;
		},
		(e: CompletionEvidence) => {
			e.finalCheck = undefined;
		},
		(e: CompletionEvidence) => {
			e.workspace = undefined;
		},
		(e: CompletionEvidence) => {
			e.quickScope = undefined;
		},
		(e: CompletionEvidence) => {
			e.handoff!.unresolved = ["unfinished"];
		},
		(e: CompletionEvidence) => {
			if (e.handoff?.role === "Executor") e.handoff.criteria[0].status = "UNMET";
		},
		(e: CompletionEvidence) => {
			if (e.handoff?.role === "Executor") e.handoff.criteria = [];
		},
		(e: CompletionEvidence) => {
			if (e.handoff?.role === "Executor") e.handoff.criteria[0].criterionId = "AC-999";
		},
		(e: CompletionEvidence) => {
			if (e.handoff?.role === "Executor") e.handoff.criteria[0].status = "UNVERIFIED";
		},
		(e: CompletionEvidence) => {
			e.handoff!.changed_files = ["src/unreported.ts"];
		},
		(e: CompletionEvidence) => {
			e.workspace!.safe = false;
		},
		(e: CompletionEvidence) => {
			e.workspace!.diffDigest = "stale";
		},
		(e: CompletionEvidence) => {
			e.workspace!.changedLines = 101;
		},
		(e: CompletionEvidence) => {
			e.workspace!.changedFiles.push("src/other.ts");
		},
		(e: CompletionEvidence) => {
			e.selfCheck!.checks[0].status = "FAIL";
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.checks[0].status = "FAIL";
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.checks[0].status = "SKIPPED";
			e.finalCheck!.checks[0].exitCode = null;
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.checks[0].evidenceRefs = [];
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.checks[0].exitCode = 1;
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.step.attempt = 2;
		},
		(e: CompletionEvidence) => {
			e.revision = 1;
		},
		(e: CompletionEvidence) => {
			e.workflow = "STANDARD";
		},
	])("rejects incomplete/stale/expanded evidence %i", (mutate) => {
		const value = evidence(risk);
		if (risk === "R0") value.handoff!.known_risks = ["Informational finding in existing code"];
		mutate(value);
		expect(() => assertCanComplete(value)).toThrow();
	});
	it("R0 scope rejects even one changed file", () => {
		expect(() =>
			assertQuickWorkspace({ risk: "R0", targetPath: null }, evidence().workspace as NonNullable<Run["workspace"]>),
		).toThrow();
	});
});
