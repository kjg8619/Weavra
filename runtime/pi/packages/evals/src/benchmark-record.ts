import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { fitnessDigest } from "../../company-runtime/src/fitness-records.ts";

/** Result format version; bump on any incompatible change to the fields below. */
export const BENCHMARK_SCHEMA_VERSION = 2;
/** Harness semantics version: arms, prompt, limits, oracle and metric definitions. */
export const BENCHMARK_HARNESS_VERSION = "weavra-benchmark-2";
export const BENCHMARK_ARMS = ["pi", "weavra", "weavra-advisory"] as const;
export type BenchmarkArm = (typeof BENCHMARK_ARMS)[number];
/** Local scripted provider name; the only provider that runs without `--confirm-paid`. */
export const BENCHMARK_FAUX_PROVIDER = "benchmark-faux";
export const BENCHMARK_FAUX_BEHAVIORS = ["GOOD", "FALSE_COMPLETER"] as const;
export type BenchmarkFauxBehavior = (typeof BENCHMARK_FAUX_BEHAVIORS)[number];
export const BENCHMARK_DEFAULT_WALL_CLOCK_MS = 900_000;
/** Pi turn cap = Weavra's aggregate cap (4 worker invocations x 16 turns in the Fitness executor). */
export const BENCHMARK_PI_MAX_TURNS = 64;
export const BENCHMARK_WEAVRA_MAX_TURNS_PER_WORKER = 16;
/**
 * Weavra arms use the product default revision limit (1), not the Fitness calibration value (0), so a Reviewer
 * REVISE gets the one fix attempt a real run gets. The Fitness budget of 4 worker invocations covers it.
 */
export const BENCHMARK_WEAVRA_MAX_REVISION_CYCLES = 1;

const strict = { additionalProperties: false } as const;
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullableCount = Type.Union([count, Type.Null()]);
const rate = Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]);
const digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const identifier = (maxLength: number) =>
	Type.String({ minLength: 1, maxLength, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/+-]*$" });
const ArmSchema = Type.Enum([...BENCHMARK_ARMS]);

/** Raw terminal status: Kernel run status for Weavra arms, session end reason for the pi arm. */
export const BenchmarkTerminalStatusSchema = Type.Enum([
	"COMPLETED",
	"BLOCKED",
	"FAILED",
	"CANCELLED",
	"INTERRUPTED",
	"NOT_STARTED",
	"UNKNOWN",
	"STOP",
	"LENGTH",
	"ERROR",
	"ABORTED",
	"TIMEOUT",
	"TURN_LIMIT",
	"TOKEN_LIMIT",
	"HARNESS_ERROR",
]);
export type BenchmarkTerminalStatus = Static<typeof BenchmarkTerminalStatusSchema>;

export const BenchmarkTokensSchema = Type.Object(
	{
		/** KNOWN only when every model response reported usage; never estimated. */
		state: Type.Enum(["KNOWN", "UNKNOWN"]),
		input: nullableCount,
		output: nullableCount,
		total: nullableCount,
	},
	strict,
);

/**
 * Which stage shaped the outcome. Payload-free counts from the Runtime's own observations; null where the arm has
 * no such stage (the pi arm has no Kernel, review, advisory check or recovery budget).
 */
export const BenchmarkStagesSchema = Type.Object(
	{
		/** Tool results the runtime marked as errors. */
		toolErrors: count,
		/** Weavra: errors returned to the model within the correctable budget. */
		recoverableToolErrors: nullableCount,
		/** Weavra: runtime_request_check calls (request-only or advisory). */
		checkRequests: nullableCount,
		/** Weavra: advisory checks that actually ran. */
		advisoryCheckRuns: nullableCount,
		/** Weavra: Reviewer REVISE verdicts that sent the run back to implement. */
		reviewRevisions: nullableCount,
		/** Weavra: the last Reviewer verdict, when a review happened. */
		finalReview: Type.Union([Type.Enum(["PASS", "REVISE", "BLOCK"]), Type.Null()]),
		/** Weavra: Host-authorized verification repair attempts. */
		verificationRepairs: nullableCount,
		/** Weavra: Evidence Pack failure category when the Kernel did not complete; UNOBSERVED without a run. */
		failureCategory: Type.Union([identifier(32), Type.Null()]),
	},
	strict,
);
export type BenchmarkStages = Static<typeof BenchmarkStagesSchema>;

export const BenchmarkRunSchema = Type.Object(
	{
		sequence: count,
		arm: ArmSchema,
		fixtureId: identifier(16),
		fixtureDigest: digest,
		repetition: Type.Integer({ minimum: 1, maximum: 100 }),
		terminalStatus: BenchmarkTerminalStatusSchema,
		claimedCompletion: Type.Boolean(),
		oracle: Type.Enum(["PASS", "FAIL", "INVALID"]),
		oraclePass: Type.Boolean(),
		/** Harness-owned reasons only; never model text. */
		oracleFailures: Type.Array(Type.String({ maxLength: 240 }), { maxItems: 8 }),
		/** Claimed completion with a FAIL oracle; null when the oracle is INVALID. */
		falseCompletion: Type.Union([Type.Boolean(), Type.Null()]),
		timedOut: Type.Boolean(),
		durationMs: count,
		modelTurns: count,
		toolCalls: count,
		workerInvocations: count,
		tokens: BenchmarkTokensSchema,
		stages: BenchmarkStagesSchema,
	},
	strict,
);
export type BenchmarkRun = Static<typeof BenchmarkRunSchema>;

export const BenchmarkArmSummarySchema = Type.Object(
	{
		arm: ArmSchema,
		runs: count,
		claimedCompletions: count,
		claimedCompletionRate: rate,
		oraclePasses: count,
		invalidRuns: count,
		/** Oracle passes over runs whose oracle is not INVALID. */
		oraclePassRate: rate,
		falseCompletions: count,
		/** False completions over claimed completions whose oracle is not INVALID. */
		falseCompletionRate: rate,
		medianDurationMs: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
		tokens: Type.Object({ state: Type.Enum(["KNOWN", "UNKNOWN"]), total: nullableCount, knownRuns: count }, strict),
		/** Sums of the per-run stage counts; null when the arm has no such stage. */
		stages: Type.Object(
			{
				toolErrors: count,
				recoverableToolErrors: nullableCount,
				checkRequests: nullableCount,
				advisoryCheckRuns: nullableCount,
				reviewRevisions: nullableCount,
				verificationRepairs: nullableCount,
				/** Runs per failure category, sorted by category. */
				failureCategories: Type.Array(Type.Object({ category: identifier(32), runs: count }, strict)),
			},
			strict,
		),
	},
	strict,
);
export type BenchmarkArmSummary = Static<typeof BenchmarkArmSummarySchema>;

export const BenchmarkRecordSchema = Type.Object(
	{
		schemaVersion: Type.Literal(BENCHMARK_SCHEMA_VERSION),
		harnessVersion: Type.Literal(BENCHMARK_HARNESS_VERSION),
		/** Git commit of the harness checkout, or UNKNOWN. `harnessDirty` marks uncommitted harness changes. */
		harnessRevision: Type.String({ pattern: "^(?:[0-9a-f]{40}|UNKNOWN)$" }),
		harnessDirty: Type.Union([Type.Boolean(), Type.Null()]),
		id: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
		status: Type.Enum(["RUNNING", "COMPLETED", "CANCELLED", "FAILED"]),
		startedAt: count,
		completedAt: nullableCount,
		target: Type.Object(
			{ provider: identifier(128), model: identifier(256), api: identifier(64), faux: Type.Boolean() },
			strict,
		),
		settings: Type.Object(
			{
				arms: Type.Array(ArmSchema, { minItems: 1, maxItems: BENCHMARK_ARMS.length, uniqueItems: true }),
				repeat: Type.Integer({ minimum: 1, maximum: 100 }),
				wallClockLimitMs: Type.Integer({ minimum: 1000, maximum: 7_200_000 }),
				sandbox: Type.Enum(["required", "disabled"]),
				piMaxTurns: Type.Integer({ minimum: 1, maximum: 1024 }),
				piMaxReportedTokens: Type.Integer({ minimum: 1, maximum: 10_000_000 }),
				weavraMaxRevisionCycles: Type.Integer({ minimum: 0, maximum: 3 }),
			},
			strict,
		),
		corpus: Type.Object({ revision: identifier(128), digest }, strict),
		fixtures: Type.Array(
			Type.Object(
				{
					id: identifier(16),
					digest,
					source: Type.Enum(["fitness", "benchmark"]),
					sourceDigest: Type.Union([digest, Type.Null()]),
					oracle: Type.Enum(["bytes", "script"]),
				},
				strict,
			),
			{ minItems: 1, maxItems: 64 },
		),
		runs: Type.Array(BenchmarkRunSchema, { maxItems: 100_000 }),
		summary: Type.Array(BenchmarkArmSummarySchema, { maxItems: BENCHMARK_ARMS.length }),
		environment: Type.Object({ platform: identifier(64), arch: identifier(64), node: identifier(64) }, strict),
		resultDigest: digest,
	},
	strict,
);
export type BenchmarkRecord = Static<typeof BenchmarkRecordSchema>;

function median(values: readonly number[]): number | null {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Deterministic per-arm aggregation; the record keeps it next to the raw runs it is recomputed from. */
export function summarizeBenchmarkRuns(
	runs: readonly BenchmarkRun[],
	arms: readonly BenchmarkArm[],
): BenchmarkArmSummary[] {
	return arms.map((arm) => {
		const own = runs.filter((run) => run.arm === arm);
		const claimed = own.filter((run) => run.claimedCompletion);
		const judged = own.filter((run) => run.oracle !== "INVALID");
		const claimedJudged = claimed.filter((run) => run.oracle !== "INVALID");
		const falseCompletions = own.filter((run) => run.falseCompletion === true).length;
		const known = own.filter((run) => run.tokens.state === "KNOWN" && run.tokens.total !== null);
		const tokensKnown = own.length > 0 && known.length === own.length;
		return {
			arm,
			runs: own.length,
			claimedCompletions: claimed.length,
			claimedCompletionRate: own.length ? claimed.length / own.length : null,
			oraclePasses: own.filter((run) => run.oraclePass).length,
			invalidRuns: own.length - judged.length,
			oraclePassRate: judged.length ? judged.filter((run) => run.oraclePass).length / judged.length : null,
			falseCompletions,
			falseCompletionRate: claimedJudged.length ? falseCompletions / claimedJudged.length : null,
			medianDurationMs: median(own.map((run) => run.durationMs)),
			tokens: {
				state: tokensKnown ? "KNOWN" : "UNKNOWN",
				total: tokensKnown ? known.reduce((sum, run) => sum + (run.tokens.total ?? 0), 0) : null,
				knownRuns: known.length,
			},
			stages: summarizeStages(own),
		};
	});
}

type CountedStage = Exclude<keyof BenchmarkStages, "finalReview" | "failureCategory" | "toolErrors">;
function summarizeStages(runs: readonly BenchmarkRun[]): BenchmarkArmSummary["stages"] {
	// A stage the arm never has stays null; a stage some runs lacked (for example no run observed) counts as 0.
	const total = (key: CountedStage) =>
		runs.some((run) => run.stages[key] !== null) ? runs.reduce((sum, run) => sum + (run.stages[key] ?? 0), 0) : null;
	const categories = new Map<string, number>();
	for (const run of runs)
		if (run.stages.failureCategory)
			categories.set(run.stages.failureCategory, (categories.get(run.stages.failureCategory) ?? 0) + 1);
	return {
		toolErrors: runs.reduce((sum, run) => sum + run.stages.toolErrors, 0),
		recoverableToolErrors: total("recoverableToolErrors"),
		checkRequests: total("checkRequests"),
		advisoryCheckRuns: total("advisoryCheckRuns"),
		reviewRevisions: total("reviewRevisions"),
		verificationRepairs: total("verificationRepairs"),
		failureCategories: [...categories]
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([category, count]) => ({ category, runs: count })),
	};
}

export function freezeBenchmarkRecord(input: Omit<BenchmarkRecord, "resultDigest" | "summary">): BenchmarkRecord {
	const { resultDigest: _digest, summary: _summary, ...body } = structuredClone(input) as BenchmarkRecord;
	const withSummary = { ...body, summary: summarizeBenchmarkRuns(body.runs, body.settings.arms) };
	return validateBenchmarkRecord({ ...withSummary, resultDigest: fitnessDigest(withSummary) });
}

export function validateBenchmarkRecord(value: unknown): BenchmarkRecord {
	if (!Check(BenchmarkRecordSchema, value)) throw new Error("Invalid benchmark record schema");
	const { resultDigest, ...body } = value;
	if (fitnessDigest(body) !== resultDigest) throw new Error("Invalid benchmark record digest");
	if (fitnessDigest(value.summary) !== fitnessDigest(summarizeBenchmarkRuns(value.runs, value.settings.arms)))
		throw new Error("Benchmark summary does not match its runs");
	if ((value.status === "RUNNING") !== (value.completedAt === null)) throw new Error("Invalid benchmark lifecycle");
	const fixtureIds = new Set(value.fixtures.map((fixture) => fixture.id));
	if (
		value.runs.some(
			(run) =>
				!fixtureIds.has(run.fixtureId) ||
				!value.settings.arms.includes(run.arm) ||
				run.repetition > value.settings.repeat ||
				run.oraclePass !== (run.oracle === "PASS") ||
				run.falseCompletion !== (run.oracle === "INVALID" ? null : run.claimedCompletion && run.oracle === "FAIL"),
		)
	)
		throw new Error("Inconsistent benchmark run");
	return value;
}

const percent = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

/** Markdown summary table per arm; rates follow the definitions in the record schema. */
export function formatBenchmarkMarkdown(record: BenchmarkRecord): string {
	const lines = [
		`# Weavra benchmark ${record.id}`,
		"",
		`- Target: \`${record.target.provider}/${record.target.model}\`${record.target.faux ? " (faux, no provider calls)" : ""}`,
		`- Status: ${record.status}; harness ${record.harnessVersion} at ${record.harnessRevision}${record.harnessDirty ? " (uncommitted changes)" : ""}`,
		`- Fixtures: ${record.fixtures.map((fixture) => fixture.id).join(", ")}; repeat ${record.settings.repeat}; wall-clock limit ${record.settings.wallClockLimitMs} ms per run`,
		"",
		"| Arm | Runs | Claimed completion | Oracle pass | False completions | Median duration | Reported tokens |",
		"|---|---:|---:|---:|---:|---:|---:|",
		...record.summary.map(
			(arm) =>
				`| ${arm.arm} | ${arm.runs} | ${arm.claimedCompletions} (${percent(arm.claimedCompletionRate)}) | ${arm.oraclePasses} (${percent(arm.oraclePassRate)})${arm.invalidRuns ? `, ${arm.invalidRuns} invalid` : ""} | ${arm.falseCompletions} (${percent(arm.falseCompletionRate)} of claims) | ${arm.medianDurationMs === null ? "n/a" : `${(arm.medianDurationMs / 1000).toFixed(1)} s`} | ${arm.tokens.state === "KNOWN" ? String(arm.tokens.total) : `UNKNOWN (${arm.tokens.knownRuns}/${arm.runs} runs reported)`} |`,
		),
		"",
		"| Arm | Tool errors (recovered) | Check requests (advisory runs) | Review REVISE | Verification repairs | Failure categories |",
		"|---|---:|---:|---:|---:|---|",
		...record.summary.map((arm) => {
			const stages = arm.stages;
			const optional = (value: number | null) => (value === null ? "n/a" : String(value));
			return `| ${arm.arm} | ${stages.toolErrors}${stages.recoverableToolErrors === null ? "" : ` (${stages.recoverableToolErrors})`} | ${stages.checkRequests === null ? "n/a" : `${stages.checkRequests} (${optional(stages.advisoryCheckRuns)})`} | ${optional(stages.reviewRevisions)} | ${optional(stages.verificationRepairs)} | ${stages.failureCategories.map((item) => `${item.category} ${item.runs}`).join(", ") || "none"} |`;
		}),
		"",
		"Claimed completion: Weavra Kernel COMPLETED; pi session ended with a normal assistant stop (no error, abort, timeout or limit).",
		"Oracle pass rate excludes INVALID oracle runs. False-completion rate = claimed completions whose hidden oracle failed / judged claimed completions.",
		"Tokens are provider-reported only; UNKNOWN when any response in the arm did not report usage.",
		"",
	];
	return lines.join("\n");
}
