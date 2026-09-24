import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { prepareHostWorkflowDraft } from "../../company-runtime/src/host-workflow.ts";
import {
	assertBenchmarkPaidConfirmation,
	BenchmarkArgsError,
	describeBenchmarkPlan,
	parseBenchmarkArgs,
} from "../src/benchmark-args.ts";
import { BENCHMARK_CORPUS, BENCHMARK_FIXTURE_IDS, benchmarkFixtureDigest } from "../src/benchmark-corpus.ts";
import {
	type BenchmarkRecord,
	type BenchmarkRun,
	type BenchmarkStages,
	formatBenchmarkMarkdown,
	freezeBenchmarkRecord,
	summarizeBenchmarkRuns,
	validateBenchmarkRecord,
} from "../src/benchmark-record.ts";
import { buildPiPrompt, evaluateBenchmarkOracle } from "../src/benchmark-runner.ts";
import { fitnessConfiguration } from "../src/fitness-runner.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "weavra-benchmark-unit-"));
	roots.push(root);
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	return root;
}

function entry(id: string) {
	const found = BENCHMARK_CORPUS.find((item) => item.fixture.id === id);
	if (!found) throw new Error(`missing ${id}`);
	return found;
}

describe("benchmark corpus and hidden oracle", () => {
	it("reuses F01-F10 without the cancellation fixture and adds six benchmark-only tasks", () => {
		expect(BENCHMARK_FIXTURE_IDS).toEqual([
			"F01",
			"F02",
			"F03",
			"F04",
			"F05",
			"F06",
			"F07",
			"F09",
			"F10",
			"B01",
			"B02",
			"B03",
			"B04",
			"B05",
			"B06",
		]);
		expect(new Set(BENCHMARK_CORPUS.map(benchmarkFixtureDigest)).size).toBe(BENCHMARK_CORPUS.length);
		for (const item of BENCHMARK_CORPUS) {
			expect(item.fixture.workflow).toBe("STANDARD");
			expect(item.source === "fitness").toBe(item.sourceDigest !== null);
		}
	});

	it.each(BENCHMARK_FIXTURE_IDS)("%s runs as an arm-neutral Weavra STANDARD draft", (id) => {
		const item = entry(id);
		const draft = prepareHostWorkflowDraft({
			goal: item.fixture.goal,
			config: fitnessConfiguration(item.fixture, "faux", "model", "disabled"),
		});
		expect(draft.workflow).toBe("STANDARD");
		expect(draft.executionMode).toBe(item.answer ? "READ_ONLY" : "EDIT");
	});

	it.each(BENCHMARK_FIXTURE_IDS)("%s: the reference change passes and the untouched task fails the oracle", (id) => {
		const item = entry(id);
		const reference = { ...item.fixture.files, ...item.fixture.expectedFiles };
		const answer = item.answer ? JSON.stringify(item.answer) : null;
		const solved = workspace(reference);
		expect(evaluateBenchmarkOracle(item, solved, item.fixture.files, answer)).toEqual({
			verdict: "PASS",
			failures: [],
		});
		// Weavra's registered check (run by its verifier as `node oracle/check.mjs`) accepts the reference change too.
		mkdirSync(join(solved, "oracle"));
		writeFileSync(join(solved, "oracle/check.mjs"), item.fixture.checkSource);
		expect(spawnSync(process.execPath, ["oracle/check.mjs"], { cwd: solved, stdio: "ignore" }).status).toBe(0);
		const untouched = workspace(item.fixture.files);
		expect(evaluateBenchmarkOracle(item, untouched, item.fixture.files, "Done.").verdict).toBe("FAIL");
	});

	it("gives Weavra arms the product revision limit while the Fitness default stays frozen", () => {
		const fixture = BENCHMARK_CORPUS[0].fixture;
		expect(fitnessConfiguration(fixture, "faux", "model", "disabled").agents.max_revision_cycles).toBe(0);
		const benchmark = fitnessConfiguration(fixture, "faux", "model", "disabled", { maxRevisionCycles: 1 });
		expect(benchmark.agents.max_revision_cycles).toBe(1);
		// The Fitness budget still covers Developer → Reviewer → Developer → Reviewer.
		expect(benchmark.budget?.max_worker_invocations).toBeGreaterThanOrEqual(4);
	});

	it("judges final state only: unexpected files, protected edits and malformed answers fail", () => {
		const b04 = entry("B04");
		const extra = workspace({ ...b04.fixture.files, ...b04.fixture.expectedFiles, "scratch.mjs": "x\n" });
		expect(evaluateBenchmarkOracle(b04, extra, b04.fixture.files, null).failures).toEqual([
			"Unexpected files: scratch.mjs",
		]);
		// A partial fix passes Weavra's registered check but not the hidden oracle: a false-completion probe.
		const partial = workspace({
			"src/paginate.mjs": b04.fixture.files["src/paginate.mjs"].replace(
				"index * size + size - 1",
				"index * size + size",
			),
		});
		expect(evaluateBenchmarkOracle(b04, partial, b04.fixture.files, null).verdict).toBe("FAIL");
		const b02 = entry("B02");
		const edited = workspace({ ...b02.fixture.files, ...b02.fixture.expectedFiles, "src/slug.mjs": "export {};\n" });
		expect(evaluateBenchmarkOracle(b02, edited, b02.fixture.files, null).failures).toContain(
			"A file outside the task's change set changed or is missing",
		);
		const f01 = entry("F01");
		const unchanged = workspace(f01.fixture.files);
		expect(
			evaluateBenchmarkOracle(f01, unchanged, f01.fixture.files, `\`\`\`json\n${JSON.stringify(f01.answer)}\n\`\`\``)
				.verdict,
		).toBe("FAIL");
		expect(evaluateBenchmarkOracle(f01, join(unchanged, "missing"), f01.fixture.files, null).verdict).toBe("INVALID");
		// F10's injected comment asks for .ai/config.yaml: Weavra owns .ai, but for pi it is an unexpected file.
		const f10 = entry("F10");
		const injected = workspace({ ...f10.fixture.files, ".ai/config.yaml": "fabricated: PASS\n" });
		const answer = JSON.stringify(f10.answer);
		expect(evaluateBenchmarkOracle(f10, injected, f10.fixture.files, answer).verdict).toBe("PASS");
		expect(evaluateBenchmarkOracle(f10, injected, f10.fixture.files, answer, [".git"]).failures).toEqual([
			"Unexpected files: .ai/config.yaml",
		]);
	});

	it("gives pi the Weavra Task Contract text but never the oracle, registered check or reference change", () => {
		for (const item of BENCHMARK_CORPUS) {
			const prompt = buildPiPrompt(item, "faux", "model");
			expect(prompt).toContain(item.fixture.goal);
			expect(prompt).toContain(`AC-001: ${item.fixture.statements[0]}`);
			expect(prompt).toContain(item.fixture.instructions);
			expect(prompt).toContain("Registered checks: regression.");
			expect(prompt).not.toContain(item.fixture.checkSource);
			if (item.oracle.kind === "script") expect(prompt).not.toContain(item.oracle.source);
			for (const content of Object.values(item.fixture.expectedFiles)) expect(prompt).not.toContain(content);
			expect(prompt.includes("no submit_handoff tool")).toBe(item.answer !== undefined);
		}
	});
});

describe("benchmark CLI arguments", () => {
	it("refuses a non-faux provider without --confirm-paid and states the run estimate", () => {
		const options = parseBenchmarkArgs(["--provider", "openai", "--model", "gpt-5", "--repeat", "3"]);
		expect(() => assertBenchmarkPaidConfirmation(options)).toThrow(BenchmarkArgsError);
		expect(() => assertBenchmarkPaidConfirmation(options)).toThrow(
			/Refusing to run provider "openai" without --confirm-paid[\s\S]*Planned runs: 135 = 3 arms x 15 fixtures x 3 repeat/,
		);
		expect(() => assertBenchmarkPaidConfirmation({ ...options, confirmPaid: true })).not.toThrow();
		const faux = parseBenchmarkArgs(["--provider", "benchmark-faux", "--model", "GOOD", "--arms", "pi,weavra"]);
		expect(() => assertBenchmarkPaidConfirmation(faux)).not.toThrow();
		expect(describeBenchmarkPlan(faux).runs).toBe(30);
	});

	it.each([
		[["--model", "m"]],
		[["--provider", "benchmark-faux", "--model", "EXPENSIVE"]],
		[["--provider", "p", "--model", "m", "--arms", "pi,pi"]],
		[["--provider", "p", "--model", "m", "--fixtures", "F08"]],
		[["--provider", "p", "--model", "m", "--repeat", "0"]],
		[["--provider", "p", "--model", "m", "--timeout-ms", "10"]],
		[["--provider", "p", "--model", "m", "--sandbox", "off"]],
		[["--provider", "p", "--model", "m", "--provider", "q"]],
		[["--provider", "p", "--model", "m", "--unknown"]],
	])("rejects invalid arguments %j", (argv) => {
		expect(() => parseBenchmarkArgs(argv)).toThrow(BenchmarkArgsError);
	});

	it("the launcher exits before loading any SDK or provider code when paid use is unconfirmed", () => {
		const out = mkdtempSync(join(tmpdir(), "weavra-benchmark-refusal-"));
		roots.push(out);
		const result = spawnSync(
			process.execPath,
			[
				"scripts/run-benchmark.mjs",
				"--provider",
				"anthropic",
				"--model",
				"claude-test",
				"--fixtures",
				"F02,B04",
				"--out",
				join(out, "results"),
			],
			{ cwd: PACKAGE_ROOT, encoding: "utf8", env: { PATH: process.env.PATH ?? "" } },
		);
		expect(result.status).toBe(2);
		expect(result.stderr).toContain('Refusing to run provider "anthropic" without --confirm-paid');
		expect(result.stderr).toContain("Planned runs: 6 = 3 arms x 2 fixtures x 1 repeat.");
		expect(result.stderr).toContain("Cost: UNKNOWN.");
		expect(existsSync(join(out, "results"))).toBe(false);
	});
});

const piStages: BenchmarkStages = {
	toolErrors: 0,
	recoverableToolErrors: null,
	checkRequests: null,
	advisoryCheckRuns: null,
	reviewRevisions: null,
	finalReview: null,
	verificationRepairs: null,
	failureCategory: null,
};
const weavraStages = (overrides: Partial<BenchmarkStages> = {}): BenchmarkStages => ({
	toolErrors: 0,
	recoverableToolErrors: 0,
	checkRequests: 0,
	advisoryCheckRuns: 0,
	reviewRevisions: 0,
	finalReview: "PASS",
	verificationRepairs: 0,
	failureCategory: null,
	...overrides,
});

function run(overrides: Partial<BenchmarkRun>): BenchmarkRun {
	const base: BenchmarkRun = {
		sequence: 0,
		arm: "pi",
		fixtureId: "F02",
		fixtureDigest: benchmarkFixtureDigest(entry("F02")),
		repetition: 1,
		terminalStatus: "STOP",
		claimedCompletion: true,
		oracle: "PASS",
		oraclePass: true,
		oracleFailures: [],
		falseCompletion: false,
		timedOut: false,
		durationMs: 10,
		modelTurns: 2,
		toolCalls: 1,
		workerInvocations: 1,
		tokens: { state: "KNOWN", input: 70, output: 30, total: 100 },
		stages: piStages,
	};
	const merged = { ...base, ...overrides };
	return {
		...merged,
		oraclePass: merged.oracle === "PASS",
		falseCompletion: merged.oracle === "INVALID" ? null : merged.claimedCompletion && merged.oracle === "FAIL",
	};
}

const runs: BenchmarkRun[] = [
	run({ sequence: 0, durationMs: 10 }),
	run({ sequence: 1, oracle: "FAIL", durationMs: 20, stages: { ...piStages, toolErrors: 2 } }),
	run({ sequence: 2, claimedCompletion: false, terminalStatus: "ERROR", oracle: "FAIL", durationMs: 30 }),
	run({
		sequence: 3,
		oracle: "INVALID",
		durationMs: 40,
		tokens: { state: "UNKNOWN", input: null, output: null, total: null },
	}),
	run({
		sequence: 4,
		arm: "weavra",
		terminalStatus: "COMPLETED",
		durationMs: 50,
		workerInvocations: 2,
		tokens: { state: "KNOWN", input: 300, output: 100, total: 400 },
		stages: weavraStages({ toolErrors: 1, recoverableToolErrors: 1, checkRequests: 1 }),
	}),
	run({
		sequence: 5,
		arm: "weavra",
		terminalStatus: "BLOCKED",
		claimedCompletion: false,
		oracle: "FAIL",
		durationMs: 70,
		tokens: { state: "KNOWN", input: 150, output: 50, total: 200 },
		stages: weavraStages({ reviewRevisions: 1, finalReview: "BLOCK", failureCategory: "REVIEW" }),
	}),
];

function record(): BenchmarkRecord {
	return freezeBenchmarkRecord({
		schemaVersion: 2,
		harnessVersion: "weavra-benchmark-2",
		harnessRevision: "UNKNOWN",
		harnessDirty: null,
		id: "00000000-0000-4000-8000-000000000000",
		status: "COMPLETED",
		startedAt: 1,
		completedAt: 2,
		target: { provider: "benchmark-faux", model: "GOOD", api: "faux", faux: true },
		settings: {
			arms: ["pi", "weavra"],
			repeat: 1,
			wallClockLimitMs: 60000,
			sandbox: "disabled",
			piMaxTurns: 64,
			piMaxReportedTokens: 100000,
			weavraMaxRevisionCycles: 1,
		},
		corpus: { revision: "weavra-benchmark-corpus-1", digest: benchmarkFixtureDigest(entry("F02")) },
		fixtures: [
			{
				id: "F02",
				digest: benchmarkFixtureDigest(entry("F02")),
				source: "fitness",
				sourceDigest: entry("F02").sourceDigest,
				oracle: "bytes",
			},
		],
		runs,
		environment: { platform: "darwin", arch: "arm64", node: "v26.0.0" },
	});
}

describe("benchmark summary and record schema", () => {
	it("aggregates claims, oracle passes, false completions, median duration and reported tokens per arm", () => {
		const [pi, weavra] = summarizeBenchmarkRuns(runs, ["pi", "weavra"]);
		expect(pi).toEqual({
			arm: "pi",
			runs: 4,
			claimedCompletions: 3,
			claimedCompletionRate: 0.75,
			oraclePasses: 1,
			invalidRuns: 1,
			oraclePassRate: 1 / 3,
			falseCompletions: 1,
			// One of two judged claims (the INVALID claim is excluded) was false.
			falseCompletionRate: 0.5,
			medianDurationMs: 25,
			tokens: { state: "UNKNOWN", total: null, knownRuns: 3 },
			stages: {
				toolErrors: 2,
				recoverableToolErrors: null,
				checkRequests: null,
				advisoryCheckRuns: null,
				reviewRevisions: null,
				verificationRepairs: null,
				failureCategories: [],
			},
		});
		expect(weavra).toEqual({
			arm: "weavra",
			runs: 2,
			claimedCompletions: 1,
			claimedCompletionRate: 0.5,
			oraclePasses: 1,
			invalidRuns: 0,
			oraclePassRate: 0.5,
			falseCompletions: 0,
			falseCompletionRate: 0,
			medianDurationMs: 60,
			tokens: { state: "KNOWN", total: 600, knownRuns: 2 },
			stages: {
				toolErrors: 1,
				recoverableToolErrors: 1,
				checkRequests: 1,
				advisoryCheckRuns: 0,
				reviewRevisions: 1,
				verificationRepairs: 0,
				failureCategories: [{ category: "REVIEW", runs: 1 }],
			},
		});
		expect(summarizeBenchmarkRuns([], ["weavra-advisory"])[0]).toMatchObject({
			runs: 0,
			claimedCompletionRate: null,
			oraclePassRate: null,
			falseCompletionRate: null,
			medianDurationMs: null,
			tokens: { state: "UNKNOWN", total: null, knownRuns: 0 },
		});
	});

	it("renders one Markdown row per arm with UNKNOWN tokens instead of a guess", () => {
		const markdown = formatBenchmarkMarkdown(record());
		expect(markdown).toContain(
			"| pi | 4 | 3 (75.0%) | 1 (33.3%), 1 invalid | 1 (50.0% of claims) | 0.0 s | UNKNOWN (3/4 runs reported) |",
		);
		expect(markdown).toContain("| weavra | 2 | 1 (50.0%) | 1 (50.0%) | 0 (0.0% of claims) | 0.1 s | 600 |");
		// Stage signals: n/a where the pi arm has no such stage.
		expect(markdown).toContain("| pi | 2 | n/a | n/a | n/a | none |");
		expect(markdown).toContain("| weavra | 1 (1) | 1 (0) | 1 | 0 | REVIEW 1 |");
	});

	it("validates the versioned record, its digest and run consistency", () => {
		const valid = record();
		expect(validateBenchmarkRecord(JSON.parse(JSON.stringify(valid)))).toEqual(valid);
		expect(() => validateBenchmarkRecord({ ...valid, schemaVersion: 1 })).toThrow("schema");
		expect(() => validateBenchmarkRecord({ ...valid, extra: true })).toThrow("schema");
		const tampered = structuredClone(valid);
		tampered.runs[1].oracle = "PASS";
		expect(() => validateBenchmarkRecord(tampered)).toThrow("digest");
		const inconsistent = structuredClone(runs);
		inconsistent[1] = { ...inconsistent[1], falseCompletion: false };
		expect(() => freezeBenchmarkRecord({ ...valid, runs: inconsistent })).toThrow("Inconsistent benchmark run");
		expect(() => freezeBenchmarkRecord({ ...valid, runs: [{ ...runs[0], fixtureId: "B01" }] })).toThrow(
			"Inconsistent benchmark run",
		);
		expect(() => freezeBenchmarkRecord({ ...valid, status: "RUNNING" })).toThrow("lifecycle");
		const { resultDigest: _digest, ...body } = valid;
		expect(() => validateBenchmarkRecord({ ...body, summary: [], resultDigest: valid.resultDigest })).toThrow();
	});
});
