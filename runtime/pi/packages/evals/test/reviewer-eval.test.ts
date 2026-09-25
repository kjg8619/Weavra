import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentExecutionRequest } from "../../company-runtime/src/ports.ts";
import { DISCRIMINATIVE_SOLUTION_IDS, DISCRIMINATIVE_SOLUTIONS } from "../src/benchmark-solutions.ts";
import {
	createScriptedReviewerModels,
	formatReviewerEvalMarkdown,
	freezeReviewerEvalRecord,
	REVIEWER_EVAL_DEVELOPER_PROVIDER,
	REVIEWER_EVAL_HANDOFF_SUMMARY,
	type ReviewerEvalRecord,
	type ReviewerEvalRun,
	registerScriptedDeveloper,
	runReviewerEval,
	runReviewerEvalCli,
	validateReviewerEvalRecord,
} from "../src/reviewer-eval.ts";
import {
	assertReviewerEvalPaidConfirmation,
	parseReviewerEvalArgs,
	REVIEWER_EVAL_FAUX_PROVIDER,
	ReviewerEvalArgsError,
	type ReviewerEvalFauxVerdict,
} from "../src/reviewer-eval-args.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const FLAWED = "B10-shared-default";
const CORRECT = "B10-correct";

let root: string;
let agentDir: string;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "weavra-reviewer-eval-")));
	agentDir = join(root, "agent");
	mkdirSync(agentDir, { mode: 0o700 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** Both profiles faux: the scripted Developer applies each case, the scripted Reviewer returns `verdict`. */
async function evaluate(verdict: ReviewerEvalFauxVerdict, caseIds: string[], requests: AgentExecutionRequest[] = []) {
	const models = await createScriptedReviewerModels(agentDir, verdict, 256);
	await registerScriptedDeveloper(models, 256);
	return runReviewerEval({
		provider: REVIEWER_EVAL_FAUX_PROVIDER,
		model: verdict,
		models,
		agentDir,
		caseIds,
		repeat: 1,
		wallClockLimitMs: 60_000,
		sandbox: "disabled",
		onRequest: (request) => requests.push(request),
	});
}

const criteria = (status: "MET" | "UNMET") => ["AC-001", "AC-002", "AC-003"].map((id) => ({ id, status }));

describe("Reviewer efficacy evaluation through real SDK and Runtime boundaries (faux providers only)", () => {
	it("a scripted PASS Reviewer lets a flawed handoff complete, and the hidden oracle records the false completion", async () => {
		const requests: AgentExecutionRequest[] = [];
		const record = await evaluate("PASS", [FLAWED, CORRECT], requests);
		expect(record.status).toBe("COMPLETED");
		const [flawed, correct] = record.runs;
		expect(flawed).toMatchObject({
			caseId: FLAWED,
			fixtureId: "B10",
			expected: "FLAWED",
			terminalStatus: "COMPLETED",
			completed: true,
			verdict: "PASS",
			criteria: criteria("MET"),
			oracle: "FAIL",
			oracleFailures: DISCRIMINATIVE_SOLUTIONS.find((solution) => solution.id === FLAWED)!.oracleFailures,
			falseCompletion: true,
			failureCategory: null,
		});
		expect(correct).toMatchObject({
			caseId: CORRECT,
			expected: "CORRECT",
			completed: true,
			verdict: "PASS",
			oracle: "PASS",
			falseCompletion: false,
		});
		expect(record.summary).toMatchObject({
			flawedJudged: 1,
			caught: 0,
			catchRate: 0,
			correctJudged: 1,
			falseAlarms: 0,
			falseAlarmRate: 0,
			noVerdict: 0,
			completed: 2,
			falseCompletions: 1,
		});
		// One scripted Developer (coding profile) and one Reviewer (reasoning profile) session per run, no revision.
		expect(requests.map((request) => `${request.role}:${request.profile}`)).toEqual([
			"Developer:coding",
			"Reviewer:reasoning",
			"Developer:coding",
			"Reviewer:reasoning",
		]);
		const review = requests[1];
		if (review.role !== "Reviewer") throw new Error("expected a Reviewer request");
		// The Reviewer judges the case's actual diff behind the same completion claim every case makes.
		expect(review.handoff).toMatchObject({
			summary: REVIEWER_EVAL_HANDOFF_SUMMARY,
			changed_files: ["src/defaults.mjs"],
		});
		expect(review.verification.reviewContext?.diff).toContain("attempts: 5");
		expect(review.verification.checks.map((check) => [check.id, check.status])).toEqual([["regression", "PASS"]]);
		// Reviewer usage is the Reviewer session's own measurement, never the scripted Developer's.
		expect(flawed.reviewer).toMatchObject({ tokens: { state: "KNOWN" }, modelTurns: 1, toolCalls: 1 });
		expect(flawed.reviewer.tokens.total).toBeGreaterThan(0);
		expect(validateReviewerEvalRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
	}, 60_000);

	it("a scripted REVISE Reviewer blocks the flawed handoff: with revision limit 0 the first verdict decides", async () => {
		const requests: AgentExecutionRequest[] = [];
		const record = await evaluate("REVISE", [FLAWED, CORRECT], requests);
		const [flawed, correct] = record.runs;
		expect(flawed).toMatchObject({
			terminalStatus: "BLOCKED",
			completed: false,
			verdict: "REVISE",
			criteria: criteria("UNMET"),
			issues: { blocker: 0, warning: 1, info: 0 },
			oracle: "FAIL",
			falseCompletion: false,
			failureCategory: "REVIEW",
		});
		// The same verdict on the correct solution is a false alarm; the oracle still passes its files.
		expect(correct).toMatchObject({ completed: false, verdict: "REVISE", oracle: "PASS", falseCompletion: false });
		expect(record.summary).toMatchObject({
			caught: 1,
			catchRate: 1,
			falseAlarms: 1,
			falseAlarmRate: 1,
			completed: 0,
			falseCompletions: 0,
		});
		// No second Developer session after REVISE.
		expect(requests.map((request) => request.role)).toEqual(["Developer", "Reviewer", "Developer", "Reviewer"]);
	}, 60_000);

	it("the CLI writes a schema-valid record and a Markdown row per run for a faux Reviewer", async () => {
		const out = join(root, "results");
		const stdout: string[] = [];
		const stderr: string[] = [];
		const code = await runReviewerEvalCli(
			[
				"--provider",
				REVIEWER_EVAL_FAUX_PROVIDER,
				"--model",
				"REVISE",
				"--cases",
				"B08-no-readme",
				"--sandbox",
				"disabled",
				"--out",
				out,
			],
			{ stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
		);
		expect(code).toBe(0);
		expect(stderr.join("")).toContain("Planned runs: 1 = 1 cases (1 flawed, 0 correct) x 1 repeat.");
		const files = readdirSync(out).sort();
		expect(files).toHaveLength(2);
		const record = validateReviewerEvalRecord(JSON.parse(readFileSync(join(out, files[0]), "utf8")));
		expect(record).toMatchObject({
			status: "COMPLETED",
			reviewer: { provider: REVIEWER_EVAL_FAUX_PROVIDER, model: "REVISE", faux: true },
			settings: { maxRevisionCycles: 0, sandbox: "disabled" },
			cases: [{ id: "B08-no-readme", fixtureId: "B08", expected: "FLAWED" }],
		});
		const markdown = readFileSync(join(out, files[1]), "utf8");
		expect(markdown).toContain("Catch rate 1/1 (100.0%); false-alarm rate 0/0 (n/a); false completions 0/1");
		expect(markdown).toContain(
			"| B08-no-readme | flawed | REVISE | AC-001 UNMET, AC-002 UNMET, AC-003 UNMET | BLOCKED | FAIL |",
		);
		expect(stdout.join("")).toContain(markdown);
	}, 60_000);
});

describe("reviewer evaluation arguments and paid-use refusal", () => {
	it("refuses a real Reviewer provider without --confirm-paid and states the plan", () => {
		const options = parseReviewerEvalArgs(["--provider", "commandcode", "--model", "deepseek/deepseek-v4.1-flash"]);
		expect(options.caseIds).toEqual([...DISCRIMINATIVE_SOLUTION_IDS]);
		expect(() => assertReviewerEvalPaidConfirmation(options)).toThrow(ReviewerEvalArgsError);
		expect(() => assertReviewerEvalPaidConfirmation(options)).toThrow(
			/Refusing to run provider "commandcode" without --confirm-paid[\s\S]*Planned runs: 11 = 11 cases \(7 flawed, 4 correct\) x 1 repeat\./,
		);
		expect(() => assertReviewerEvalPaidConfirmation({ ...options, confirmPaid: true })).not.toThrow();
		const faux = parseReviewerEvalArgs(["--provider", REVIEWER_EVAL_FAUX_PROVIDER, "--model", "PASS"]);
		expect(() => assertReviewerEvalPaidConfirmation(faux)).not.toThrow();
	});

	it.each([
		[["--model", "m"]],
		[["--provider", REVIEWER_EVAL_FAUX_PROVIDER, "--model", "BLOCK"]],
		[["--provider", "p", "--model", "m", "--cases", "B07"]],
		[["--provider", "p", "--model", "m", "--cases", "B07-correct,B07-correct"]],
		[["--provider", "p", "--model", "m", "--repeat", "21"]],
		[["--provider", "p", "--model", "m", "--timeout-ms", "10"]],
		[["--provider", "p", "--model", "m", "--sandbox", "off"]],
		[["--provider", "p", "--model", "m", "--arms", "pi"]],
	])("rejects invalid arguments %j", (argv) => {
		expect(() => parseReviewerEvalArgs(argv)).toThrow(ReviewerEvalArgsError);
	});

	it("the launcher and the CLI both refuse unconfirmed paid use before any output or provider call", async () => {
		const results = join(root, "results");
		const launched = spawnSync(
			process.execPath,
			[
				"scripts/run-reviewer-eval.mjs",
				"--provider",
				"commandcode",
				"--model",
				"deepseek/deepseek-v4.1-flash",
				"--out",
				results,
			],
			{ cwd: PACKAGE_ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
		);
		expect(launched.status).toBe(2);
		expect(launched.stderr).toContain('Refusing to run provider "commandcode" without --confirm-paid');
		expect(launched.stderr).toContain("Cost: UNKNOWN.");
		const stderr: string[] = [];
		const code = await runReviewerEvalCli(["--provider", "commandcode", "--model", "m", "--out", results], {
			stdout: () => {},
			stderr: (text) => stderr.push(text),
		});
		expect(code).toBe(2);
		expect(stderr.join("")).toContain("without --confirm-paid");
		expect(existsSync(results)).toBe(false);
	});
});

function run(overrides: Partial<ReviewerEvalRun>): ReviewerEvalRun {
	const merged: ReviewerEvalRun = {
		sequence: 0,
		caseId: "B07-toggle-quotes",
		fixtureId: "B07",
		expected: "FLAWED",
		repetition: 1,
		terminalStatus: "BLOCKED",
		completed: false,
		verdict: "REVISE",
		criteria: criteria("UNMET"),
		issues: { blocker: 0, warning: 1, info: 0 },
		oracle: "FAIL",
		oracleFailures: ["Hidden behavioral oracle failed"],
		falseCompletion: false,
		failureCategory: "REVIEW",
		timedOut: false,
		durationMs: 10,
		reviewer: {
			tokens: { state: "KNOWN", input: 70, output: 30, total: 100 },
			durationMs: 8,
			modelTurns: 2,
			toolCalls: 2,
		},
		...overrides,
	};
	return {
		...merged,
		completed: merged.terminalStatus === "COMPLETED",
		falseCompletion:
			merged.oracle === "INVALID" ? null : merged.terminalStatus === "COMPLETED" && merged.oracle === "FAIL",
	};
}

const cases = DISCRIMINATIVE_SOLUTIONS.filter((solution) => solution.fixtureId <= "B08").map((solution) => ({
	id: solution.id,
	fixtureId: solution.fixtureId,
	expected: solution.expected,
	digest: `sha256:${"0".repeat(64)}`,
}));
const unknown = { state: "UNKNOWN" as const, input: null, output: null, total: null };
const runs = [
	run({ sequence: 0 }),
	run({
		sequence: 1,
		caseId: "B07-correct",
		expected: "CORRECT",
		terminalStatus: "COMPLETED",
		verdict: "PASS",
		criteria: criteria("MET"),
		oracle: "PASS",
	}),
	run({
		sequence: 2,
		caseId: "B08-no-readme",
		fixtureId: "B08",
		terminalStatus: "COMPLETED",
		verdict: "PASS",
		criteria: criteria("MET"),
		durationMs: 30,
	}),
	run({
		sequence: 3,
		caseId: "B08-correct",
		fixtureId: "B08",
		expected: "CORRECT",
		terminalStatus: "FAILED",
		verdict: null,
		criteria: [],
		oracle: "PASS",
		durationMs: 40,
		reviewer: { tokens: unknown, durationMs: null, modelTurns: null, toolCalls: null },
	}),
];

function record(): ReviewerEvalRecord {
	return freezeReviewerEvalRecord({
		schemaVersion: 1,
		harnessVersion: "weavra-reviewer-eval-1",
		harnessRevision: "UNKNOWN",
		harnessDirty: null,
		id: "00000000-0000-4000-8000-000000000000",
		status: "COMPLETED",
		startedAt: 1,
		completedAt: 2,
		reviewer: { provider: "provider", model: "model", api: "api", faux: false },
		settings: { repeat: 1, wallClockLimitMs: 60000, sandbox: "required", maxRevisionCycles: 0 },
		corpus: { revision: "weavra-benchmark-corpus-2", digest: `sha256:${"1".repeat(64)}` },
		cases,
		runs,
		environment: { platform: "darwin", arch: "arm64", node: "v24.19.0" },
	});
}

describe("reviewer evaluation summary and record schema", () => {
	it("rates catches over flawed runs with a verdict and false alarms over correct runs with a verdict", () => {
		expect(record().summary).toEqual({
			runs: 4,
			flawedRuns: 2,
			flawedJudged: 2,
			caught: 1,
			catchRate: 0.5,
			correctRuns: 2,
			correctJudged: 1,
			falseAlarms: 0,
			falseAlarmRate: 0,
			noVerdict: 1,
			completed: 2,
			falseCompletions: 1,
			medianDurationMs: 20,
			// One run did not report Reviewer usage: the total is UNKNOWN, never a partial sum.
			reviewerTokens: { state: "UNKNOWN", total: null, knownRuns: 3 },
		});
		const markdown = formatReviewerEvalMarkdown(record());
		expect(markdown).toContain(
			"Catch rate 1/2 (50.0%); false-alarm rate 0/1 (0.0%); false completions 1/4; no verdict 1",
		);
		expect(markdown).toContain("| B08-correct | correct | none | n/a | FAILED | PASS | UNKNOWN | n/a | 0.0 s |");
		expect(markdown).toContain(
			"| B08-no-readme | flawed | PASS | AC-001 MET, AC-002 MET, AC-003 MET | COMPLETED | FAIL (false completion) | 100 | 2 (2) | 0.0 s |",
		);
	});

	it("validates the versioned record, its digest and run consistency", () => {
		const valid = record();
		expect(validateReviewerEvalRecord(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
		expect(() => validateReviewerEvalRecord({ ...valid, extra: true })).toThrow("schema");
		const tampered = structuredClone(valid);
		tampered.runs[0].verdict = "PASS";
		expect(() => validateReviewerEvalRecord(tampered)).toThrow("digest");
		expect(() => freezeReviewerEvalRecord({ ...valid, runs: [{ ...runs[2], falseCompletion: false }] })).toThrow(
			"Inconsistent reviewer evaluation run",
		);
		expect(() => freezeReviewerEvalRecord({ ...valid, runs: [{ ...runs[0], expected: "CORRECT" }] })).toThrow(
			"Inconsistent reviewer evaluation run",
		);
		expect(() => freezeReviewerEvalRecord({ ...valid, runs: [{ ...runs[0], caseId: "B09-correct" }] })).toThrow(
			"Inconsistent reviewer evaluation run",
		);
		expect(() => freezeReviewerEvalRecord({ ...valid, status: "RUNNING" })).toThrow("lifecycle");
	});

	it("keeps the scripted Developer apart from any Reviewer target", async () => {
		const models = await createScriptedReviewerModels(agentDir, "PASS", 16);
		await registerScriptedDeveloper(models, 16);
		await expect(
			runReviewerEval({
				provider: REVIEWER_EVAL_DEVELOPER_PROVIDER,
				model: CORRECT,
				models,
				agentDir,
				caseIds: [CORRECT],
				repeat: 1,
				wallClockLimitMs: 60_000,
				sandbox: "disabled",
			}),
		).rejects.toThrow("The Reviewer must not be the scripted Developer");
	});
});
