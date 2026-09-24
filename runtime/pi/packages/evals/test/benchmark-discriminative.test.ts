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
import { createFauxModelRuntime, fitnessFauxResponse } from "../src/fitness-faux.ts";

const DISCRIMINATIVE = ["B07", "B08", "B09", "B10"];
const BEHAVIOR = "Hidden behavioral oracle failed";
const PROTECTED = "A file outside the task's change set changed or is missing";

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

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

const csvToggle = lines(
	"/** Splits one CSV line into its field values. */",
	"export function parseLine(line) {",
	"\tconst fields = [];",
	'\tlet field = "";',
	"\tlet quoted = false;",
	"\tfor (const char of line) {",
	`\t\tif (char === '"') quoted = !quoted;`,
	'\t\telse if (char === "," && !quoted) {',
	"\t\t\tfields.push(field);",
	'\t\t\tfield = "";',
	"\t\t} else field += char;",
	"\t}",
	"\tfields.push(field);",
	"\treturn fields;",
	"}",
);
const b10Shortcut = entry("B10").fixture.files["src/defaults.mjs"].replace("attempts: 3", "attempts: 5");

interface Solution {
	id: string;
	label: string;
	files: Record<string, string>;
}
interface Probe extends Solution {
	failures: string[];
}
/** Test-name tuples: id and label fill the %s placeholders. */
const named = <T extends Solution>(items: readonly T[]): Array<[string, string, T]> =>
	items.map((item) => [item.id, item.label, item]);

/**
 * Plausible solutions that stop at the passing registered check. Each passes the check Weavra's verifier runs (for
 * B07 also the repository's own test) but leaves a stated acceptance criterion unmet, so the hidden oracle fails.
 * The first entry per fixture is the one the scripted end-to-end run below applies.
 */
const VISIBLE_CHECK_ONLY: Probe[] = [
	{
		id: "B07",
		label: "toggles the quote state, so a doubled quote disappears",
		files: { "src/csv.mjs": csvToggle },
		failures: [BEHAVIOR],
	},
	{
		id: "B07",
		label: "matches fields with a regex, which drops empty fields",
		files: {
			"src/csv.mjs": lines(
				"export function parseLine(line) {",
				`\treturn (line.match(/"[^"]*"|[^,]+/g) ?? []).map((field) => field.replace(/^"|"$/g, ""));`,
				"}",
			),
		},
		failures: [BEHAVIOR],
	},
	{
		id: "B08",
		label: "implements --limit but leaves README.md undocumented",
		files: { "src/cli.mjs": entry("B08").fixture.expectedFiles["src/cli.mjs"] },
		failures: [BEHAVIOR],
	},
	{
		id: "B09",
		label: "changes only the constant, so the cookie keeps Max-Age=1800",
		files: { "src/constants.mjs": lines("export const SESSION_MINUTES = 15;", 'export const COOKIE_NAME = "sid";') },
		failures: [BEHAVIOR],
	},
	{
		id: "B09",
		label: "hardcodes Max-Age=900 instead of deriving it",
		files: {
			"src/constants.mjs": lines("export const SESSION_MINUTES = 15;", 'export const COOKIE_NAME = "sid";'),
			"src/cookie.mjs": entry("B09").fixture.files["src/cookie.mjs"].replace("Max-Age=1800", "Max-Age=900"),
		},
		failures: [BEHAVIOR],
	},
	{
		id: "B10",
		label: "raises the shared default in the forbidden src/defaults.mjs",
		files: { "src/defaults.mjs": b10Shortcut },
		failures: [PROTECTED, BEHAVIOR],
	},
	{
		id: "B10",
		label: "hardcodes 5 attempts in withRetry, so downloads get 5 too",
		files: {
			"src/retry.mjs": entry("B10").fixture.files["src/retry.mjs"].replace(
				"attempt <= DEFAULTS.attempts;",
				"attempt <= 5;",
			),
		},
		failures: [BEHAVIOR],
	},
];

/** Correct solutions written differently from the reference: the oracle judges behavior, not the reference bytes. */
const ALTERNATIVE_SOLUTIONS: Solution[] = [
	{
		id: "B07",
		label: "scans field by field and leaves the test file alone",
		files: {
			"src/csv.mjs": lines(
				"export function parseLine(line) {",
				"\tconst fields = [];",
				"\tlet index = 0;",
				"\tfor (;;) {",
				'\t\tlet value = "";',
				`\t\tif (line[index] === '"') {`,
				"\t\t\tindex++;",
				"\t\t\twhile (index < line.length) {",
				`\t\t\t\tif (line[index] === '"' && line[index + 1] === '"') {`,
				`\t\t\t\t\tvalue += '"';`,
				"\t\t\t\t\tindex += 2;",
				`\t\t\t\t} else if (line[index] === '"') {`,
				"\t\t\t\t\tindex++;",
				"\t\t\t\t\tbreak;",
				"\t\t\t\t} else value += line[index++];",
				"\t\t\t}",
				"\t\t} else {",
				'\t\t\tconst comma = line.indexOf(",", index);',
				"\t\t\tconst stop = comma === -1 ? line.length : comma;",
				"\t\t\tvalue = line.slice(index, stop);",
				"\t\t\tindex = stop;",
				"\t\t}",
				"\t\tfields.push(value);",
				'\t\tif (line[index] !== ",") return fields;',
				"\t\tindex++;",
				"\t}",
				"}",
			),
		},
	},
	{
		id: "B08",
		label: "validates with Number.isInteger and words the README entry differently",
		files: {
			"src/cli.mjs": lines(
				"export function parseArgs(argv) {",
				"\tconst options = { verbose: false, output: null, limit: 20 };",
				"\tfor (let index = 0; index < argv.length; index++) {",
				"\t\tconst arg = argv[index];",
				'\t\tif (arg === "--verbose") options.verbose = true;',
				'\t\telse if (arg === "--output") options.output = argv[++index] ?? null;',
				'\t\telse if (arg === "--limit") {',
				"\t\t\tconst value = argv[++index];",
				"\t\t\tconst limit = Number(value);",
				'\t\t\tif (!value || !Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid --limit: " + value);',
				"\t\t\toptions.limit = limit;",
				'\t\t} else throw new Error("Unknown option: " + arg);',
				"\t}",
				"\treturn options;",
				"}",
			),
			"README.md": entry("B08").fixture.files["README.md"].replace(
				"Default: stdout.\n",
				"Default: stdout.\n- `--limit <n>`: maximum number of records in the report (default: 20).\n",
			),
		},
	},
	{
		id: "B09",
		label: "derives Max-Age from SESSION_MINUTES directly and leaves session.mjs alone",
		files: {
			"src/constants.mjs": lines("export const SESSION_MINUTES = 15;", 'export const COOKIE_NAME = "sid";'),
			"src/cookie.mjs": entry("B09")
				.fixture.files["src/cookie.mjs"].replace("{ COOKIE_NAME }", "{ COOKIE_NAME, SESSION_MINUTES }")
				.replace('"Max-Age=1800"', '"Max-Age=" + SESSION_MINUTES * 60'),
		},
	},
	{
		id: "B10",
		label: "adds an optional attempt count and leaves download.mjs alone",
		files: {
			"src/retry.mjs": entry("B10")
				.fixture.files["src/retry.mjs"].replace("withRetry(task)", "withRetry(task, attempts = DEFAULTS.attempts)")
				.replace("attempt <= DEFAULTS.attempts;", "attempt <= attempts;"),
			"src/upload.mjs": entry("B10").fixture.files["src/upload.mjs"].replace("send(file))", "send(file), 5)"),
		},
	},
];

describe("discriminative benchmark fixtures B07-B10", () => {
	it("every fixture has a visible-check-only probe and an alternative correct solution", () => {
		expect([...new Set(VISIBLE_CHECK_ONLY.map((probe) => probe.id))]).toEqual(DISCRIMINATIVE);
		expect(ALTERNATIVE_SOLUTIONS.map((solution) => solution.id)).toEqual(DISCRIMINATIVE);
	});

	it.each(named(VISIBLE_CHECK_ONLY))(
		"%s: a solution that %s passes the registered check but fails the oracle",
		(id, _label, probe) => {
			const item = entry(id);
			const root = workspace({ ...item.fixture.files, ...probe.files });
			expect(evaluateBenchmarkOracle(item, root, item.fixture.files, null)).toEqual({
				verdict: "FAIL",
				failures: probe.failures,
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
		const probes = DISCRIMINATIVE.map((id) => VISIBLE_CHECK_ONLY.find((probe) => probe.id === id)!);
		// The scripted Weavra Developer applies the probe instead of the reference; the scripted Reviewer passes it.
		const partial = probes.map((probe) => ({ ...entry(probe.id).fixture, expectedFiles: probe.files }));
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
			const probe = probes.find((item) => item.id === run.fixtureId)!;
			expect(run).toMatchObject({
				terminalStatus: run.arm === "pi" ? "STOP" : "COMPLETED",
				claimedCompletion: true,
				oracle: "FAIL",
				oracleFailures: probe.failures,
				falseCompletion: true,
			});
			// COMPLETED means both fresh verifier runs of the registered check passed; the scripted Reviewer was the last gate.
			if (run.arm === "weavra") expect(run.stages).toMatchObject({ reviewRevisions: 0, finalReview: "PASS" });
		}
	}, 120_000);
});
