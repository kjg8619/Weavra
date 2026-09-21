import { describe, expect, it } from "vitest";
import {
	ACCEPTANCE_CRITERION_ID_PATTERN,
	type AcceptanceCriterion,
	type ExecutorHandoff,
	type Handoff,
	MAX_ACCEPTANCE_CRITERIA,
	type Review,
	type TaskContract,
	type VerificationResult,
} from "../src/contracts.ts";
import { assertCriterionIdentity, taskContractDigest } from "../src/criterion-evidence.ts";
import { assertCanComplete, type CompletionEvidence } from "../src/kernel.ts";
import {
	acceptanceStatementsError,
	assertTaskContractBinding,
	buildTaskContract,
	parseAcceptanceStatements,
} from "../src/task-contract.ts";
import { testConfig, testContract } from "./fixture-contract.ts";

const statements = ["Fix the greeting typo.", "Preserve the exported greet(name) API."];

function contract(options: { workflow?: "QUICK" | "STANDARD"; checkIds?: string[] } = {}): TaskContract {
	return testContract("Fix the greeting typo in src/greeting.js", {
		taskId: "task-1",
		statements,
		workflow: options.workflow ?? "STANDARD",
		checkIds: options.checkIds ?? ["regression"],
	});
}

function evidence(overrides: Partial<CompletionEvidence> = {}): CompletionEvidence {
	const task = contract();
	const checks = [{ id: "regression", kind: "test" as const, required: true }];
	const verification = (stepId: "self-check" | "test"): VerificationResult => ({
		runId: "run-1",
		revision: 0,
		step: { stepId, attempt: 1 },
		diffDigest: "digest-1",
		evidenceRefs: ["diff-1"],
		checks: checks.map((check) => ({
			...check,
			runId: "run-1",
			revision: 0,
			status: "PASS" as const,
			exitCode: 0,
			reason: "Executed",
			evidenceRefs: ["check-regression"],
			diffDigest: "digest-1",
		})),
	});
	const handoff: Handoff = {
		runId: "run-1",
		revision: 0,
		role: "Developer",
		task: task.id,
		changed_files: ["src/greeting.js"],
		summary: "Fixed",
		assumptions: [],
		tests_run: [],
		known_risks: [],
		unresolved: [],
	};
	const review: Review = {
		runId: "run-1",
		revision: 0,
		role: "Reviewer",
		task: task.id,
		result: "PASS",
		issues: [],
		criteria: task.acceptanceCriteria.map((criterion) => ({
			criterionId: criterion.id,
			status: "MET" as const,
			evidenceRefs: ["diff-1"],
		})),
		evidenceRefs: ["diff-1"],
		diffDigest: "digest-1",
	};
	return {
		executionMode: "EDIT",
		runId: "run-1",
		revision: 0,
		task,
		taskContractDigest: taskContractDigest(task),
		checks,
		workflow: "STANDARD",
		risk: "R1",
		handoff,
		review,
		selfCheck: verification("self-check"),
		finalCheck: verification("test"),
		workspace: {
			diffDigest: "digest-1",
			changedFiles: ["src/greeting.js"],
			evidenceRefs: ["diff-1"],
			safe: true,
		},
		...overrides,
	};
}

describe("V0.3E acceptance criteria", () => {
	it("keeps the plan preview, boundaries and ID assignment Host-owned and deterministic", () => {
		expect(parseAcceptanceStatements("  Fix   typo \n\nPreserve API\n")).toEqual(["Fix typo", "Preserve API"]);
		expect(acceptanceStatementsError([])).toBeDefined();
		expect(acceptanceStatementsError(["ok", "  ok  "])).toBeDefined();
		expect(acceptanceStatementsError([" ".repeat(3)])).toBeDefined();
		expect(
			acceptanceStatementsError(Array.from({ length: MAX_ACCEPTANCE_CRITERIA + 1 }, (_, i) => `AC ${i}`)),
		).toBeDefined();
		expect(acceptanceStatementsError(statements)).toBeUndefined();

		const built = contract();
		expect(built.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(["AC-001", "AC-002"]);
		expect(built.acceptanceCriteria[0].id).toMatch(new RegExp(ACCEPTANCE_CRITERION_ID_PATTERN));
		expect(built.acceptanceCriteria.every((criterion) => criterion.verification.reviewRequired)).toBe(true);
		expect(
			built.acceptanceCriteria.every((criterion) => criterion.verification.checkIds.join() === "regression"),
		).toBe(true);
		const quick = buildTaskContract({
			goal: built.goal,
			statements,
			workflow: "QUICK",
			config: testConfig({ checkIds: ["regression"] }),
			taskId: "task-1",
		});
		expect(quick.acceptanceCriteria.every((criterion) => !criterion.verification.reviewRequired)).toBe(true);
		const withoutChecks = buildTaskContract({
			goal: built.goal,
			statements,
			workflow: "STANDARD",
			config: testConfig({ checkIds: [] }),
			taskId: "task-1",
		});
		expect(withoutChecks.acceptanceCriteria[0].verification.checkIds).toEqual([]);
		// Requirement statements are not identity: duplicate statements are rejected before ID assignment.
		expect(() =>
			buildTaskContract({
				goal: built.goal,
				statements: ["Same", "same"],
				workflow: "STANDARD",
				config: testConfig(),
				taskId: "task-1",
			}),
		).toThrow("Duplicate acceptance criteria");
	});

	it("binds criteria to registered checks, workflow review semantics and sequential IDs", () => {
		const built = contract();
		expect(() =>
			assertTaskContractBinding(built, { workflow: "STANDARD", config: testConfig({ checkIds: ["other"] }) }),
		).toThrow("unregistered check");
		expect(() =>
			assertTaskContractBinding(built, { workflow: "QUICK", config: testConfig({ checkIds: ["regression"] }) }),
		).toThrow("QUICK cannot satisfy review-required acceptance criteria");
		const quick = testContract("Fix typo", { workflow: "QUICK", checkIds: ["regression"] });
		expect(() =>
			assertTaskContractBinding(quick, { workflow: "STANDARD", config: testConfig({ checkIds: ["regression"] }) }),
		).toThrow("must require independent review");
		const tampered: AcceptanceCriterion[] = [
			{ ...built.acceptanceCriteria[0], id: "AC-002" },
			built.acceptanceCriteria[1],
		];
		expect(() => assertCriterionIdentity(tampered)).toThrow("sequential Host-assigned IDs");
	});

	it("digest covers the frozen contract identity but not lifecycle status", () => {
		const built = contract();
		expect(taskContractDigest(built)).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(taskContractDigest({ ...built, status: "completed" })).toBe(taskContractDigest(built));
		expect(
			taskContractDigest({
				...built,
				acceptanceCriteria: [{ ...built.acceptanceCriteria[0], statement: "Changed" }, built.acceptanceCriteria[1]],
			}),
		).not.toBe(taskContractDigest(built));
		expect(JSON.stringify(built)).not.toContain("apiKey");
	});
});

describe("V0.3E acceptance completion guard", () => {
	it.each([
		[
			"one criterion UNMET",
			(e: CompletionEvidence) => {
				e.review!.criteria[1].status = "UNMET";
			},
		],
		[
			"one criterion UNVERIFIED",
			(e: CompletionEvidence) => {
				e.review!.criteria[1].status = "UNVERIFIED";
			},
		],
		[
			"missing criterion result",
			(e: CompletionEvidence) => {
				e.review!.criteria = [e.review!.criteria[0]];
			},
		],
		[
			"duplicate criterion result",
			(e: CompletionEvidence) => {
				e.review!.criteria = [e.review!.criteria[0], e.review!.criteria[0]];
			},
		],
		[
			"unknown criterion ID",
			(e: CompletionEvidence) => {
				e.review!.criteria = [{ ...e.review!.criteria[0], criterionId: "AC-999" }, e.review!.criteria[1]];
			},
		],
		[
			"mapped required check did not pass",
			(e: CompletionEvidence) => {
				e.task = {
					...e.task,
					acceptanceCriteria: e.task.acceptanceCriteria.map((criterion) => ({
						...criterion,
						verification: { ...criterion.verification, checkIds: ["missing-check"] },
					})),
				};
				e.taskContractDigest = taskContractDigest(e.task);
			},
		],
		[
			"criterion evidence missing after PASS",
			(e: CompletionEvidence) => {
				e.review!.criteria[0].evidenceRefs = [];
			},
		],
		[
			"Task Contract changed after confirmation",
			(e: CompletionEvidence) => {
				e.taskContractDigest = `sha256:${"0".repeat(64)}`;
			},
		],
		[
			"stale revision evidence",
			(e: CompletionEvidence) => {
				e.review!.revision = 1;
			},
		],
		[
			"stale diff evidence",
			(e: CompletionEvidence) => {
				e.review!.diffDigest = "digest-2";
			},
		],
	])("refuses COMPLETED when %s", (_name, mutate) => {
		const fixture = evidence();
		mutate(fixture);
		expect(() => assertCanComplete(fixture)).toThrow();
	});

	it("refuses a QUICK completion whose criteria require independent review", () => {
		const fixture = evidence();
		const quick = testContract("Fix typo in src/greeting.js", {
			taskId: "task-1",
			statements: ["Fix the greeting typo."],
			workflow: "QUICK",
			checkIds: ["regression"],
		});
		const executor: ExecutorHandoff = {
			runId: "run-1",
			revision: 0,
			role: "Executor",
			task: quick.id,
			changed_files: ["src/greeting.js"],
			summary: "Fixed",
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
			criteria: [{ criterionId: "AC-001", status: "MET", explanation: "Done" }],
		};
		const reviewRequired: TaskContract = {
			...quick,
			acceptanceCriteria: quick.acceptanceCriteria.map((criterion) => ({
				...criterion,
				verification: { ...criterion.verification, reviewRequired: true },
			})),
		};
		const result = {
			...fixture,
			task: reviewRequired,
			taskContractDigest: taskContractDigest(reviewRequired),
			workflow: "QUICK" as const,
			quickScope: { risk: "R1" as const, targetPath: "src/greeting.js" },
			workspace: { ...fixture.workspace!, changedLines: 2 },
			handoff: executor,
			review: undefined,
			executorDigest: "digest-1",
			checkIds: ["regression"],
		};
		expect(() => assertCanComplete(result)).toThrow("review-required acceptance criteria");
	});
});
