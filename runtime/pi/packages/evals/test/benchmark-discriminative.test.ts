import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
	type AssistantMessage,
	type Context,
	contentText,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BENCHMARK_CORPUS, type BenchmarkFixture } from "../src/benchmark-corpus.ts";
import { createBenchmarkFauxModels } from "../src/benchmark-faux.ts";
import { BENCHMARK_ARMS, BENCHMARK_FAUX_PROVIDER } from "../src/benchmark-record.ts";
import { evaluateBenchmarkOracle, runBenchmark } from "../src/benchmark-runner.ts";
import { type BenchmarkSolution, DISCRIMINATIVE_SOLUTIONS } from "../src/benchmark-solutions.ts";
import { createFauxModelRuntime, fitnessFauxResponse } from "../src/fitness-faux.ts";

const DISCRIMINATIVE = ["B07", "B08", "B09", "B10"];

function entry(id: string): BenchmarkFixture {
	const found = BENCHMARK_CORPUS.find((item) => item.fixture.id === id);
	if (!found) throw new Error(`missing ${id}`);
	return found;
}

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function workspace(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), "weavra-benchmark-discriminative-"));
	roots.push(root);
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	}
	return root;
}

/** Runs the fixture's registered check the way Weavra's verifier does: `node oracle/check.mjs` in the workspace. */
function registeredCheckStatus(item: BenchmarkFixture, root: string): number | null {
	mkdirSync(join(root, "oracle"));
	writeFileSync(join(root, "oracle/check.mjs"), item.fixture.checkSource);
	return spawnSync(process.execPath, ["oracle/check.mjs"], { cwd: root, stdio: "ignore" }).status;
}

const VISIBLE_CHECK_ONLY = DISCRIMINATIVE_SOLUTIONS.filter((solution) => solution.expected === "FLAWED");
const ALTERNATIVE_SOLUTIONS = DISCRIMINATIVE_SOLUTIONS.filter((solution) => solution.expected === "CORRECT");

/** Test-name tuples: fixture id and label fill the %s placeholders. */
const named = (items: readonly BenchmarkSolution[]): Array<[string, string, BenchmarkSolution]> =>
	items.map((item) => [item.fixtureId, item.label, item]);

describe("discriminative benchmark fixtures B07-B10", () => {
	it("every fixture has a visible-check-only probe and an alternative correct solution", () => {
		expect(VISIBLE_CHECK_ONLY).toHaveLength(7);
		expect([...new Set(VISIBLE_CHECK_ONLY.map((probe) => probe.fixtureId))]).toEqual(DISCRIMINATIVE);
		expect(ALTERNATIVE_SOLUTIONS.map((solution) => solution.fixtureId)).toEqual(DISCRIMINATIVE);
		expect(ALTERNATIVE_SOLUTIONS.every((solution) => solution.oracleFailures.length === 0)).toBe(true);
	});

	it.each(named(VISIBLE_CHECK_ONLY))(
		"%s: a solution that %s passes the registered check but fails the oracle",
		(id, _label, probe) => {
			const item = entry(id);
			const root = workspace({ ...item.fixture.files, ...probe.files });
			expect(evaluateBenchmarkOracle(item, root, item.fixture.files, null)).toEqual({
				verdict: "FAIL",
				failures: probe.oracleFailures,
			});
			expect(registeredCheckStatus(item, root)).toBe(0);
		},
	);

	it.each(named(ALTERNATIVE_SOLUTIONS))(
		"%s: a correct solution that %s passes the check and the oracle",
		(id, _label, solution) => {
			const item = entry(id);
			const root = workspace({ ...item.fixture.files, ...solution.files });
			expect(evaluateBenchmarkOracle(item, root, item.fixture.files, null)).toEqual({
				verdict: "PASS",
				failures: [],
			});
			expect(registeredCheckStatus(item, root)).toBe(0);
		},
	);

	it("leaves room for one Reviewer revision only on these fixtures", () => {
		for (const item of BENCHMARK_CORPUS) {
			const discriminative = DISCRIMINATIVE.includes(item.fixture.id);
			// Developer, Reviewer REVISE, Developer, Reviewer.
			expect(item.fixture.budget.maxWorkerCalls).toBe(4);
			expect(item.fixture.budget.maxTotalTokens).toBe(discriminative ? 300_000 : 100_000);
		}
	});
});

describe("discriminative fixtures through real SDK and Runtime boundaries (faux provider only)", () => {
	let root: string;
	let agentDir: string;
	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "weavra-benchmark-discriminative-e2e-")));
		agentDir = join(root, "agent");
		mkdirSync(agentDir, { mode: 0o700 });
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	it("the scripted good model completes and passes the hidden oracle on every arm", async () => {
		const record = await runBenchmark({
			provider: BENCHMARK_FAUX_PROVIDER,
			model: "GOOD",
			models: await createBenchmarkFauxModels(agentDir, "GOOD", 4096),
			agentDir,
			arms: [...BENCHMARK_ARMS],
			fixtureIds: DISCRIMINATIVE,
			repeat: 1,
			wallClockLimitMs: 60_000,
			sandbox: "disabled",
		});
		expect(record.status).toBe("COMPLETED");
		expect(record.runs).toHaveLength(BENCHMARK_ARMS.length * DISCRIMINATIVE.length);
		for (const run of record.runs)
			expect(run).toMatchObject({
				terminalStatus: run.arm === "pi" ? "STOP" : "COMPLETED",
				claimedCompletion: true,
				oracle: "PASS",
				falseCompletion: false,
			});
		expect(record.summary.map((arm) => [arm.arm, arm.oraclePassRate, arm.falseCompletions])).toEqual([
			["pi", 1, 0],
			["weavra", 1, 0],
			["weavra-advisory", 1, 0],
		]);
	}, 120_000);

	it("the registered check alone does not stop a visible-check-only solution: only review of the criteria can", async () => {
		const probes = DISCRIMINATIVE.map((id) => VISIBLE_CHECK_ONLY.find((probe) => probe.fixtureId === id)!);
		// The scripted Weavra Developer applies the probe instead of the reference; the scripted Reviewer passes it.
		const partial = probes.map((probe) => ({ ...entry(probe.fixtureId).fixture, expectedFiles: probe.files }));
		const tool = (name: string, args: Record<string, unknown>) =>
			fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
		const respond = (context: Context): AssistantMessage => {
			if (context.tools?.some((item) => item.name === "submit_handoff" || item.name === "submit_review"))
				return fitnessFauxResponse("GOOD", context, partial);
			const first = context.messages.find((message) => message.role === "user");
			const prompt = first ? contentText(first.content) : "";
			const fixture = partial.find((item) => prompt.includes(item.goal));
			if (!fixture) throw new Error("Unknown faux benchmark task");
			const written = context.messages.filter(
				(message) => message.role === "toolResult" && message.toolName === "write" && !message.isError,
			).length;
			const targets = Object.entries(fixture.expectedFiles);
			if (written < targets.length)
				return tool("write", { path: targets[written][0], content: targets[written][1] });
			return fauxAssistantMessage("Done: the requested change is complete.");
		};
		const record = await runBenchmark({
			provider: BENCHMARK_FAUX_PROVIDER,
			model: "GOOD",
			models: await createFauxModelRuntime(agentDir, {
				provider: BENCHMARK_FAUX_PROVIDER,
				modelId: "GOOD",
				respond,
			}),
			agentDir,
			arms: ["pi", "weavra"],
			fixtureIds: DISCRIMINATIVE,
			repeat: 1,
			wallClockLimitMs: 60_000,
			sandbox: "disabled",
		});
		expect(record.runs).toHaveLength(2 * DISCRIMINATIVE.length);
		for (const run of record.runs) {
			const probe = probes.find((item) => item.fixtureId === run.fixtureId)!;
			expect(run).toMatchObject({
				terminalStatus: run.arm === "pi" ? "STOP" : "COMPLETED",
				claimedCompletion: true,
				oracle: "FAIL",
				oracleFailures: probe.oracleFailures,
				falseCompletion: true,
			});
			// COMPLETED means both fresh verifier runs of the registered check passed; the scripted Reviewer was the last gate.
			if (run.arm === "weavra") expect(run.stages).toMatchObject({ reviewRevisions: 0, finalReview: "PASS" });
		}
	}, 120_000);
});
