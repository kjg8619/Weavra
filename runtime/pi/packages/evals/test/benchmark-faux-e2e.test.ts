import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AssistantMessage, type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runBenchmarkCli } from "../src/benchmark-cli.ts";
import { BENCHMARK_CORPUS, BENCHMARK_FIXTURE_IDS } from "../src/benchmark-corpus.ts";
import { benchmarkFauxResponse, createBenchmarkFauxModels } from "../src/benchmark-faux.ts";
import {
	BENCHMARK_ARMS,
	BENCHMARK_FAUX_PROVIDER,
	type BenchmarkArm,
	type BenchmarkFauxBehavior,
	formatBenchmarkMarkdown,
	validateBenchmarkRecord,
} from "../src/benchmark-record.ts";
import { type BenchmarkRunnerOptions, type PiSessionObservation, runBenchmark } from "../src/benchmark-runner.ts";
import { createFauxModelRuntime } from "../src/fitness-faux.ts";

let root: string;
let agentDir: string;
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "weavra-benchmark-e2e-")));
	agentDir = join(root, "agent");
	mkdirSync(agentDir, { mode: 0o700 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

async function benchmark(
	behavior: BenchmarkFauxBehavior,
	arms: BenchmarkArm[],
	fixtureIds: string[],
	extra: Partial<BenchmarkRunnerOptions> = {},
) {
	return runBenchmark({
		provider: BENCHMARK_FAUX_PROVIDER,
		model: behavior,
		models: await createBenchmarkFauxModels(agentDir, behavior, 4096),
		agentDir,
		arms,
		fixtureIds,
		repeat: 1,
		wallClockLimitMs: 60_000,
		sandbox: "disabled",
		...extra,
	});
}

/** Every regular file under `directory` whose bytes contain `needle`. */
function filesContaining(directory: string, needle: string): string[] {
	const found: string[] = [];
	for (const entry of readdirSync(directory, { recursive: true, encoding: "utf8" })) {
		const path = join(directory, entry);
		if (lstatSync(path).isFile() && readFileSync(path, "utf8").includes(needle)) found.push(path);
	}
	return found;
}

describe("Weavra-vs-Pi benchmark through real SDK and Runtime boundaries (faux provider only)", () => {
	it("pi arm: scripted work that satisfies the task passes the hidden oracle", async () => {
		const record = await benchmark("GOOD", ["pi"], ["F01", "F02", "B04"]);
		expect(record.status).toBe("COMPLETED");
		for (const run of record.runs)
			expect(run).toMatchObject({
				arm: "pi",
				terminalStatus: "STOP",
				claimedCompletion: true,
				oracle: "PASS",
				oraclePass: true,
				falseCompletion: false,
				timedOut: false,
				workerInvocations: 1,
				tokens: { state: "KNOWN" },
			});
		expect(record.runs.map((run) => [run.fixtureId, run.modelTurns, run.toolCalls])).toEqual([
			["F01", 2, 1],
			["F02", 2, 1],
			["B04", 2, 1],
		]);
		expect(record.summary[0]).toMatchObject({ runs: 3, oraclePasses: 3, falseCompletions: 0 });
		expect(record.summary[0].tokens.total).toBeGreaterThan(0);
		expect(validateBenchmarkRecord(record)).toEqual(record);
	}, 60_000);

	it("pi arm: claiming completion without doing the work is a false completion", async () => {
		const record = await benchmark("FALSE_COMPLETER", ["pi"], ["F01", "B04"]);
		for (const run of record.runs)
			expect(run).toMatchObject({
				terminalStatus: "STOP",
				claimedCompletion: true,
				oracle: "FAIL",
				oraclePass: false,
				falseCompletion: true,
				modelTurns: 1,
				toolCalls: 0,
			});
		expect(record.summary[0]).toMatchObject({ falseCompletions: 2, falseCompletionRate: 1 });
	}, 60_000);

	it("weavra arms: the Kernel COMPLETED path passes the hidden oracle, with and without advisory checks", async () => {
		const record = await benchmark("GOOD", ["weavra", "weavra-advisory"], ["F03", "B03"]);
		expect(record.runs).toHaveLength(4);
		for (const run of record.runs)
			expect(run).toMatchObject({
				terminalStatus: "COMPLETED",
				claimedCompletion: true,
				oracle: "PASS",
				falseCompletion: false,
				workerInvocations: 2,
				tokens: { state: "KNOWN" },
			});
		// Arm order rotates per fixture so neither arm always runs first.
		expect(record.runs.map((run) => run.arm)).toEqual(["weavra", "weavra-advisory", "weavra-advisory", "weavra"]);
		// Stage signals come from the Runtime's own observations: one real advisory run only where enabled.
		for (const run of record.runs)
			expect(run.stages).toEqual({
				toolErrors: 0,
				recoverableToolErrors: 0,
				checkRequests: run.arm === "weavra-advisory" ? 1 : 0,
				advisoryCheckRuns: run.arm === "weavra-advisory" ? 1 : 0,
				reviewRevisions: 0,
				finalReview: "PASS",
				verificationRepairs: 0,
				failureCategory: null,
			});
		expect(formatBenchmarkMarkdown(record)).toContain("| weavra-advisory | 0 (0) | 2 (2) | 0 | 0 | none |");
	}, 60_000);

	it("the same false completer is not completed by the Weavra Kernel", async () => {
		const record = await benchmark("FALSE_COMPLETER", ["weavra"], ["B04"]);
		expect(record.runs[0]).toMatchObject({ claimedCompletion: false, oracle: "FAIL", falseCompletion: false });
		expect(record.runs[0].terminalStatus).not.toBe("COMPLETED");
		// The stage that stopped it is named, not inferred from the terminal status alone.
		expect(record.runs[0].stages.failureCategory).not.toBeNull();
	}, 60_000);

	it("runs every fixture on every arm with the scripted good model", async () => {
		const record = await benchmark("GOOD", [...BENCHMARK_ARMS], [...BENCHMARK_FIXTURE_IDS]);
		expect(record.status).toBe("COMPLETED");
		expect(record.runs).toHaveLength(BENCHMARK_ARMS.length * BENCHMARK_FIXTURE_IDS.length);
		expect(record.runs.filter((run) => !run.oraclePass || !run.claimedCompletion)).toEqual([]);
		expect(record.summary.map((arm) => [arm.arm, arm.oraclePassRate, arm.falseCompletions])).toEqual([
			["pi", 1, 0],
			["weavra", 1, 0],
			["weavra-advisory", 1, 0],
		]);
	}, 180_000);

	it("keeps the hidden oracle and registered check unreadable from every arm", async () => {
		const b04 = BENCHMARK_CORPUS.find((entry) => entry.fixture.id === "B04")!;
		if (b04.oracle.kind !== "script") throw new Error("B04 uses a behavioral oracle");
		// Only the hidden oracle calls pageCount(1, 5); only the registered check prints this marker.
		const oracleMarker = "pageCount(1, 5)";
		const checkMarker = "Registered check passed";
		expect(b04.oracle.source).toContain(oracleMarker);
		expect(b04.fixture.checkSource).toContain(checkMarker);
		const shellResults: string[] = [];
		const weavraListings: string[] = [];
		const sessions: PiSessionObservation[] = [];
		const leaks: string[] = [];
		const tool = (name: string, args: Record<string, unknown>) =>
			fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
		const respond = (context: Context): AssistantMessage => {
			// Nothing a model receives (system prompt, task, tool results) may carry either source. The scripted
			// assistant's own grep command names the markers, so assistant messages are excluded.
			const seen = JSON.stringify([
				context.systemPrompt,
				context.messages.filter((message) => message.role !== "assistant"),
			]);
			if (seen.includes(oracleMarker) || seen.includes(checkMarker)) leaks.push("model context");
			const results = context.messages.filter((message) => message.role === "toolResult");
			const text = (message: (typeof results)[number]) =>
				message.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");
			if (context.tools?.some((item) => item.name === "submit_handoff")) {
				// While the Weavra worker is live, its workspace holds the protected check but never the hidden oracle.
				for (const name of readdirSync(realpathSync(tmpdir())))
					if (name.startsWith("weavra-fitness-B04-"))
						leaks.push(...filesContaining(join(realpathSync(tmpdir()), name), oracleMarker));
				if (!results.length) return tool("runtime_list_files", {});
				weavraListings.push(text(results[0]));
				// Policy denies the protected verifier input and ends the worker; its bytes never reach the model.
				return tool("runtime_read", { path: "oracle/check.mjs" });
			}
			if (!results.length)
				return tool("bash", {
					command: `ls -a; cd .. && grep -rlF -e '${oracleMarker}' -e '${checkMarker}' . "$HOME"; echo "grep-exit=$?"`,
				});
			shellResults.push(...results.map(text));
			return fauxAssistantMessage("Done.");
		};
		const models = await createFauxModelRuntime(agentDir, {
			provider: BENCHMARK_FAUX_PROVIDER,
			modelId: "GOOD",
			respond,
		});
		const record = await runBenchmark({
			provider: BENCHMARK_FAUX_PROVIDER,
			model: "GOOD",
			models,
			agentDir,
			arms: ["pi", "weavra"],
			fixtureIds: ["B04"],
			repeat: 1,
			wallClockLimitMs: 60_000,
			sandbox: "disabled",
			onPiSession: (observation) => {
				sessions.push(observation);
				leaks.push(
					...filesContaining(observation.root, oracleMarker),
					...filesContaining(observation.root, checkMarker),
				);
			},
		});
		// pi: Pi's own bash sees only the task files; nothing under the run root or its HOME holds either source.
		expect(sessions).toHaveLength(1);
		expect(sessions[0].prompt).not.toContain(oracleMarker);
		expect(shellResults.join("\n")).toContain("grep-exit=1");
		expect(shellResults.join("\n")).not.toContain("oracle");
		// Weavra: the registered check is a Policy-protected verifier input, absent from listings and unreadable.
		expect(weavraListings).toHaveLength(1);
		expect(weavraListings[0]).toContain("src/paginate.mjs");
		expect(weavraListings[0]).not.toContain("oracle");
		expect(leaks).toEqual([]);
		const pi = record.runs.find((run) => run.arm === "pi")!;
		expect(pi).toMatchObject({ claimedCompletion: true, oracle: "FAIL", falseCompletion: true });
		expect(record.runs.find((run) => run.arm === "weavra")).toMatchObject({
			terminalStatus: "FAILED",
			claimedCompletion: false,
		});
	}, 60_000);

	it("the CLI writes a schema-valid JSON result and a Markdown summary for a faux run", async () => {
		const out = join(root, "results");
		const stdout: string[] = [];
		const stderr: string[] = [];
		const code = await runBenchmarkCli(
			[
				"--provider",
				BENCHMARK_FAUX_PROVIDER,
				"--model",
				"GOOD",
				"--arms",
				"pi,weavra",
				"--fixtures",
				"F02",
				"--sandbox",
				"disabled",
				"--out",
				out,
			],
			{ stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) },
		);
		expect(code).toBe(0);
		expect(stderr.join("")).toContain("Planned runs: 2 = 2 arms x 1 fixtures x 1 repeat.");
		const files = readdirSync(out).sort();
		expect(files).toHaveLength(2);
		const record = validateBenchmarkRecord(JSON.parse(readFileSync(join(out, files[0]), "utf8")));
		expect(record).toMatchObject({ status: "COMPLETED", target: { provider: BENCHMARK_FAUX_PROVIDER, faux: true } });
		expect(record.fixtures).toEqual([expect.objectContaining({ id: "F02", source: "fitness", oracle: "bytes" })]);
		expect(readFileSync(join(out, files[1]), "utf8")).toContain("| pi | 1 | 1 (100.0%) | 1 (100.0%) |");
		expect(stdout.join("")).toContain("| weavra | 1 | 1 (100.0%) | 1 (100.0%) |");
	}, 60_000);

	it("scripted faux responses cover both arms without a provider", () => {
		// A Weavra-shaped context without a user request is rejected rather than guessed.
		expect(() => benchmarkFauxResponse("GOOD", { messages: [] })).toThrow("Unknown faux benchmark task");
	});
});
