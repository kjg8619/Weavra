import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Run, RunSchema, validateContract } from "../../company-runtime/src/contracts.ts";
import { evaluateFitnessOracle, FITNESS_CORPUS, parseFitnessInvestigationAnswer } from "../src/fitness-corpus.ts";

const fixture = FITNESS_CORPUS.find((item) => item.id === "F01")!;
const correct = '{"classificationAtZero":"non-positive","cause":{"operator":">","boundary":0}}';
let workspace: string;
beforeEach(() => {
	workspace = mkdtempSync(join(tmpdir(), "fitness-oracle-"));
	for (const [path, content] of Object.entries(fixture.files)) {
		mkdirSync(dirname(join(workspace, path)), { recursive: true });
		writeFileSync(join(workspace, path), content);
	}
	mkdirSync(join(workspace, "oracle"));
	writeFileSync(join(workspace, "oracle/check.mjs"), fixture.checkSource);
});
afterEach(() => rmSync(workspace, { recursive: true, force: true }));

function run(summary: string): Run {
	return validateContract(RunSchema, {
		schemaVersion: 1,
		runId: "oracle-case",
		revision: 0,
		eventSequence: 0,
		currentStep: null,
		goal: fixture.goal,
		status: "COMPLETED",
		phase: "COMPLETE",
		workflow: "QUICK",
		executionMode: "READ_ONLY",
		classification: { intent: "question", complexity: "QUICK", risk: "R0", confidence: 1, reason: "Frozen fixture" },
		risk: "R0",
		currentTask: "fixture",
		tasks: [
			{
				id: "fixture",
				goal: fixture.goal,
				status: "completed",
				acceptanceCriteria: [
					{
						id: "AC-001",
						statement: fixture.statements[0],
						scope: { paths: fixture.allowedPaths },
						verification: { checkIds: ["regression"], reviewRequired: false },
					},
				],
			},
		],
		activeAgents: [],
		completed: ["fixture"],
		next: [],
		roleSessionRefs: [],
		revisionCycle: 0,
		verification: [],
		lastError: null,
		createdAt: 1,
		updatedAt: 1,
		executorResult: {
			runId: "oracle-case",
			revision: 0,
			role: "Executor",
			task: "fixture",
			changed_files: [],
			summary,
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
			criteria: [{ criterionId: "AC-001", status: "MET", explanation: "Final answer facts are in summary." }],
		},
	});
}
const facts = {
	providerActive: true,
	forbiddenAttempts: 0,
	baselinePaths: [...Object.keys(fixture.files), "oracle/check.mjs"],
};

// These cases assess the host answer oracle, not a claim that synthetic submissions passed the Kernel.
describe("F01 deterministic answer contract", () => {
	it.each([
		["correct facts", correct, "PASS"],
		[
			"equivalent key order, whitespace and number representation",
			' { "cause": {"boundary":0e0, "operator":">"}, "classificationAtZero":"non-positive" } ',
			"PASS",
		],
		["wrong boundary", '{"classificationAtZero":"non-positive","cause":{"operator":">","boundary":1}}', "FAIL"],
		[
			"right conclusion with wrong cause",
			'{"classificationAtZero":"non-positive","cause":{"operator":">=","boundary":0}}',
			"FAIL",
		],
		[
			"wrong conclusion with correct comparison keywords",
			'{"classificationAtZero":"positive","cause":{"operator":">","boundary":0}}',
			"FAIL",
		],
		[
			"irrelevant exact-fact keyword stuffing",
			"Keywords: classify(0)=non-positive strict greater. Unrelated weather forecast.",
			"FAIL",
		],
	])("judges %s using the independent semantic oracle", (_name, summary, expected) => {
		const check = spawnSync(process.execPath, ["oracle/check.mjs"], { cwd: workspace });
		expect(check.status).toBe(0);
		expect(evaluateFitnessOracle(fixture, workspace, run(summary), true, facts)).toBe(expected);
	});
	it.each([
		[
			"duplicate keys concealing a wrong operator",
			'{"classificationAtZero":"non-positive","cause":{"operator":">=","operator":">","boundary":0}}',
		],
		[
			"escaped duplicate keys",
			'{"classificationAtZero":"positive","\\u0063lassificationAtZero":"non-positive","cause":{"operator":">","boundary":0}}',
		],
		[
			"additional keyword prose",
			'{"classificationAtZero":"non-positive","cause":{"operator":">","boundary":0},"explanation":"strict greater"}',
		],
		["missing cause", '{"classificationAtZero":"non-positive"}'],
		["stringified boundary", '{"classificationAtZero":"non-positive","cause":{"operator":">","boundary":"0"}}'],
		[
			"out-of-contract boundary",
			'{"classificationAtZero":"non-positive","cause":{"operator":">","boundary":1000001}}',
		],
		["trailing commentary", `${correct} correct`],
		["Markdown wrapper", `\u0060\u0060\u0060json\n${correct}\n\u0060\u0060\u0060`],
		["oversized document", `${" ".repeat(2048)}${correct}`],
	])("rejects %s without a prose or keyword fallback", (_name, summary) => {
		expect(parseFitnessInvestigationAnswer(summary)).toBeNull();
		expect(evaluateFitnessOracle(fixture, workspace, run(summary), true, facts)).toBe("FAIL");
	});
	it("records proven missing source as FAIL, not unavailable oracle evidence", () => {
		rmSync(join(workspace, "src/classify.mjs"));
		expect(evaluateFitnessOracle(fixture, workspace, run(correct), true, facts)).toBe("FAIL");
	});
	it("rejects an unrelated file even with correct answer and unchanged source", () => {
		writeFileSync(join(workspace, "src/unrelated.mjs"), "export const unrelated = true;\n");
		expect(evaluateFitnessOracle(fixture, workspace, run(correct), true, facts)).toBe("FAIL");
	});
	it("keeps unavailable Run and uncertain cleanup INVALID rather than provider failures", () => {
		expect(evaluateFitnessOracle(fixture, workspace, undefined, true, facts)).toBe("INVALID");
		expect(evaluateFitnessOracle(fixture, workspace, run(correct), false, facts)).toBe("INVALID");
	});
});
