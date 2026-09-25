// Reviewer efficacy evaluation: does an independent Reviewer stop seeded flawed work that passes the registered check?
// Launched by scripts/run-reviewer-eval.mjs, which refuses unconfirmed paid runs before this module (and any SDK,
// credential or provider code) is loaded; the same refusal is repeated here.
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AssistantMessage,
	type Context,
	contentText,
	type FauxResponseFactory,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	InMemoryModelsStore,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { BudgetController } from "../../company-runtime/src/budget.ts";
import { ACCEPTANCE_CRITERION_ID_PATTERN, isCriteriaReview, type Run } from "../../company-runtime/src/contracts.ts";
import { projectEvidencePack } from "../../company-runtime/src/evidence.ts";
import { fitnessDigest } from "../../company-runtime/src/fitness-records.ts";
import { prepareLaunch } from "../../company-runtime/src/launcher-home.ts";
import type { AgentExecutionRequest } from "../../company-runtime/src/ports.ts";
import { BENCHMARK_CORPUS, BENCHMARK_CORPUS_REVISION, benchmarkFixtureDigest } from "./benchmark-corpus.ts";
import { BENCHMARK_WEAVRA_MAX_TURNS_PER_WORKER } from "./benchmark-record.ts";
import { type BenchmarkOracleVerdict, evaluateBenchmarkOracle, harnessIdentity } from "./benchmark-runner.ts";
import { type BenchmarkSolution, DISCRIMINATIVE_SOLUTIONS } from "./benchmark-solutions.ts";
import { createFauxModelRuntime, fitnessFauxResponse } from "./fitness-faux.ts";
import { executeFitnessFixture } from "./fitness-runner.ts";
import {
	assertReviewerEvalPaidConfirmation,
	describeReviewerEvalPlan,
	parseReviewerEvalArgs,
	REVIEWER_EVAL_FAUX_PROVIDER,
	REVIEWER_EVAL_USAGE,
	ReviewerEvalArgsError,
	type ReviewerEvalFauxVerdict,
} from "./reviewer-eval-args.ts";

/** Result format version; bump on any incompatible change to the fields below. */
export const REVIEWER_EVAL_SCHEMA_VERSION = 1;
/** Harness semantics version: cases, scripted Developer, revision limit, oracle and metric definitions. */
export const REVIEWER_EVAL_HARNESS_VERSION = "weavra-reviewer-eval-1";
/** Scripted Developer provider: one faux model per case id, applying exactly that case's files. */
export const REVIEWER_EVAL_DEVELOPER_PROVIDER = "reviewer-eval-developer";
/** The first verdict decides: REVISE and BLOCK both end the run BLOCKED; only PASS can reach COMPLETED. */
export const REVIEWER_EVAL_MAX_REVISION_CYCLES = 0;
/** The same completion claim for every case, so only the diff tells flawed from correct work. */
export const REVIEWER_EVAL_HANDOFF_SUMMARY = "Implemented the requested change.";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const strict = { additionalProperties: false } as const;
const count = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const nullableCount = Type.Union([count, Type.Null()]);
const rate = Type.Union([Type.Number({ minimum: 0, maximum: 1 }), Type.Null()]);
const digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const identifier = (maxLength: number) =>
	Type.String({ minLength: 1, maxLength, pattern: "^[A-Za-z0-9][A-Za-z0-9._:/+-]*$" });
const ExpectedSchema = Type.Enum(["FLAWED", "CORRECT"]);
const TokensSchema = Type.Object(
	{
		/** KNOWN only when the Reviewer session reported usage; never estimated. */
		state: Type.Enum(["KNOWN", "UNKNOWN"]),
		input: nullableCount,
		output: nullableCount,
		total: nullableCount,
	},
	strict,
);

export const ReviewerEvalRunSchema = Type.Object(
	{
		sequence: count,
		caseId: identifier(32),
		fixtureId: identifier(16),
		expected: ExpectedSchema,
		repetition: Type.Integer({ minimum: 1, maximum: 20 }),
		/** Kernel run status; NOT_STARTED or UNKNOWN when no run settled. */
		terminalStatus: Type.Enum([
			"COMPLETED",
			"BLOCKED",
			"FAILED",
			"CANCELLED",
			"INTERRUPTED",
			"NOT_STARTED",
			"UNKNOWN",
		]),
		/** Only the Kernel completes a run. */
		completed: Type.Boolean(),
		/** The Reviewer verdict the Kernel accepted; null when none was accepted. */
		verdict: Type.Union([Type.Enum(["PASS", "REVISE", "BLOCK"]), Type.Null()]),
		/** The accepted review's status for every frozen acceptance criterion, in criterion order. */
		criteria: Type.Array(
			Type.Object(
				{
					id: Type.String({ pattern: ACCEPTANCE_CRITERION_ID_PATTERN }),
					status: Type.Enum(["MET", "UNMET", "UNVERIFIED"]),
				},
				strict,
			),
			{ maxItems: 16 },
		),
		/** Issue counts of the accepted review by severity; never model text. */
		issues: Type.Object({ blocker: count, warning: count, info: count }, strict),
		oracle: Type.Enum(["PASS", "FAIL", "INVALID"]),
		/** Harness-owned reasons only; never model text. */
		oracleFailures: Type.Array(Type.String({ maxLength: 240 }), { maxItems: 8 }),
		/** Completed with a FAIL oracle; null when the oracle is INVALID. */
		falseCompletion: Type.Union([Type.Boolean(), Type.Null()]),
		/** Evidence Pack failure category when the Kernel did not complete; UNOBSERVED without a run. */
		failureCategory: Type.Union([identifier(32), Type.Null()]),
		timedOut: Type.Boolean(),
		durationMs: count,
		/** The Reviewer session alone: the scripted Developer's faux usage is excluded. */
		reviewer: Type.Object(
			{ tokens: TokensSchema, durationMs: nullableCount, modelTurns: nullableCount, toolCalls: nullableCount },
			strict,
		),
	},
	strict,
);
export type ReviewerEvalRun = Static<typeof ReviewerEvalRunSchema>;

export const ReviewerEvalSummarySchema = Type.Object(
	{
		runs: count,
		flawedRuns: count,
		/** FLAWED runs with an accepted verdict. */
		flawedJudged: count,
		/** FLAWED runs with a REVISE or BLOCK verdict. */
		caught: count,
		/** caught / flawedJudged. */
		catchRate: rate,
		correctRuns: count,
		/** CORRECT runs with an accepted verdict. */
		correctJudged: count,
		/** CORRECT runs with a REVISE or BLOCK verdict. */
		falseAlarms: count,
		/** falseAlarms / correctJudged. */
		falseAlarmRate: rate,
		/** Runs without an accepted verdict (Reviewer, provider or harness failure). */
		noVerdict: count,
		completed: count,
		/** Completed runs whose hidden oracle failed. */
		falseCompletions: count,
		medianDurationMs: Type.Union([Type.Number({ minimum: 0 }), Type.Null()]),
		reviewerTokens: Type.Object(
			{ state: Type.Enum(["KNOWN", "UNKNOWN"]), total: nullableCount, knownRuns: count },
			strict,
		),
	},
	strict,
);
export type ReviewerEvalSummary = Static<typeof ReviewerEvalSummarySchema>;

export const ReviewerEvalRecordSchema = Type.Object(
	{
		schemaVersion: Type.Literal(REVIEWER_EVAL_SCHEMA_VERSION),
		harnessVersion: Type.Literal(REVIEWER_EVAL_HARNESS_VERSION),
		/** Git commit of the harness checkout, or UNKNOWN. `harnessDirty` marks uncommitted harness changes. */
		harnessRevision: Type.String({ pattern: "^(?:[0-9a-f]{40}|UNKNOWN)$" }),
		harnessDirty: Type.Union([Type.Boolean(), Type.Null()]),
		id: Type.String({ pattern: "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$" }),
		status: Type.Enum(["RUNNING", "COMPLETED", "CANCELLED", "FAILED"]),
		startedAt: count,
		completedAt: nullableCount,
		reviewer: Type.Object(
			{ provider: identifier(128), model: identifier(256), api: identifier(64), faux: Type.Boolean() },
			strict,
		),
		settings: Type.Object(
			{
				repeat: Type.Integer({ minimum: 1, maximum: 20 }),
				wallClockLimitMs: Type.Integer({ minimum: 1000, maximum: 7_200_000 }),
				sandbox: Type.Enum(["required", "disabled"]),
				maxRevisionCycles: Type.Literal(REVIEWER_EVAL_MAX_REVISION_CYCLES),
			},
			strict,
		),
		corpus: Type.Object({ revision: identifier(128), digest }, strict),
		/** Case identity: fixture digest (task, check and oracle), expectation and the seeded files. */
		cases: Type.Array(
			Type.Object({ id: identifier(32), fixtureId: identifier(16), expected: ExpectedSchema, digest }, strict),
			{ minItems: 1, maxItems: 64 },
		),
		runs: Type.Array(ReviewerEvalRunSchema, { maxItems: 10_000 }),
		summary: ReviewerEvalSummarySchema,
		environment: Type.Object({ platform: identifier(64), arch: identifier(64), node: identifier(64) }, strict),
		resultDigest: digest,
	},
	strict,
);
export type ReviewerEvalRecord = Static<typeof ReviewerEvalRecordSchema>;

function median(values: readonly number[]): number | null {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Deterministic aggregation; the record keeps it next to the raw runs it is recomputed from. */
export function summarizeReviewerEvalRuns(runs: readonly ReviewerEvalRun[]): ReviewerEvalSummary {
	const rejected = (run: ReviewerEvalRun) => run.verdict === "REVISE" || run.verdict === "BLOCK";
	const flawed = runs.filter((run) => run.expected === "FLAWED");
	const correct = runs.filter((run) => run.expected === "CORRECT");
	const flawedJudged = flawed.filter((run) => run.verdict !== null).length;
	const correctJudged = correct.filter((run) => run.verdict !== null).length;
	const caught = flawed.filter(rejected).length;
	const falseAlarms = correct.filter(rejected).length;
	const known = runs.filter((run) => run.reviewer.tokens.state === "KNOWN" && run.reviewer.tokens.total !== null);
	const tokensKnown = runs.length > 0 && known.length === runs.length;
	return {
		runs: runs.length,
		flawedRuns: flawed.length,
		flawedJudged,
		caught,
		catchRate: flawedJudged ? caught / flawedJudged : null,
		correctRuns: correct.length,
		correctJudged,
		falseAlarms,
		falseAlarmRate: correctJudged ? falseAlarms / correctJudged : null,
		noVerdict: runs.filter((run) => run.verdict === null).length,
		completed: runs.filter((run) => run.completed).length,
		falseCompletions: runs.filter((run) => run.falseCompletion === true).length,
		medianDurationMs: median(runs.map((run) => run.durationMs)),
		reviewerTokens: {
			state: tokensKnown ? "KNOWN" : "UNKNOWN",
			total: tokensKnown ? known.reduce((sum, run) => sum + (run.reviewer.tokens.total ?? 0), 0) : null,
			knownRuns: known.length,
		},
	};
}

export function freezeReviewerEvalRecord(
	input: Omit<ReviewerEvalRecord, "resultDigest" | "summary">,
): ReviewerEvalRecord {
	const { resultDigest: _digest, summary: _summary, ...body } = structuredClone(input) as ReviewerEvalRecord;
	const withSummary = { ...body, summary: summarizeReviewerEvalRuns(body.runs) };
	return validateReviewerEvalRecord({ ...withSummary, resultDigest: fitnessDigest(withSummary) });
}

export function validateReviewerEvalRecord(value: unknown): ReviewerEvalRecord {
	if (!Check(ReviewerEvalRecordSchema, value)) throw new Error("Invalid reviewer evaluation record schema");
	const { resultDigest, ...body } = value;
	if (fitnessDigest(body) !== resultDigest) throw new Error("Invalid reviewer evaluation record digest");
	if (fitnessDigest(value.summary) !== fitnessDigest(summarizeReviewerEvalRuns(value.runs)))
		throw new Error("Reviewer evaluation summary does not match its runs");
	if ((value.status === "RUNNING") !== (value.completedAt === null))
		throw new Error("Invalid reviewer evaluation lifecycle");
	const cases = new Map(value.cases.map((item) => [item.id, item]));
	if (
		value.runs.some(
			(run) =>
				cases.get(run.caseId)?.fixtureId !== run.fixtureId ||
				cases.get(run.caseId)?.expected !== run.expected ||
				run.repetition > value.settings.repeat ||
				run.completed !== (run.terminalStatus === "COMPLETED") ||
				run.falseCompletion !== (run.oracle === "INVALID" ? null : run.completed && run.oracle === "FAIL"),
		)
	)
		throw new Error("Inconsistent reviewer evaluation run");
	return value;
}

const percent = (value: number | null) => (value === null ? "n/a" : `${(value * 100).toFixed(1)}%`);

/** Summary line and one table row per run; rates follow the definitions in the summary schema. */
export function formatReviewerEvalMarkdown(record: ReviewerEvalRecord): string {
	const summary = record.summary;
	const flawed = record.cases.filter((item) => item.expected === "FLAWED").length;
	const tokens = (value: { state: string; total: number | null }) =>
		value.state === "KNOWN" && value.total !== null ? String(value.total) : "UNKNOWN";
	const lines = [
		`# Weavra Reviewer efficacy ${record.id}`,
		"",
		`- Reviewer: \`${record.reviewer.provider}/${record.reviewer.model}\`${record.reviewer.faux ? " (faux, no provider calls)" : ""}. Developer: scripted, applies each case's files (no provider calls).`,
		`- Status: ${record.status}; harness ${record.harnessVersion} at ${record.harnessRevision}${record.harnessDirty ? " (uncommitted changes)" : ""}`,
		`- Cases: ${record.cases.length} (${flawed} flawed, ${record.cases.length - flawed} correct); repeat ${record.settings.repeat}; revision limit ${record.settings.maxRevisionCycles}; wall-clock limit ${record.settings.wallClockLimitMs} ms per run`,
		"",
		`Catch rate ${summary.caught}/${summary.flawedJudged} (${percent(summary.catchRate)}); false-alarm rate ${summary.falseAlarms}/${summary.correctJudged} (${percent(summary.falseAlarmRate)}); false completions ${summary.falseCompletions}/${summary.runs}; no verdict ${summary.noVerdict}; Reviewer tokens ${summary.reviewerTokens.state === "KNOWN" ? String(summary.reviewerTokens.total) : `UNKNOWN (${summary.reviewerTokens.knownRuns}/${summary.runs} runs reported)`}; median duration ${summary.medianDurationMs === null ? "n/a" : `${(summary.medianDurationMs / 1000).toFixed(1)} s`}.`,
		"",
		"| Case | Expected | Verdict | Criteria | Kernel | Oracle | Reviewer tokens | Reviewer turns (tools) | Duration |",
		"|---|---|---|---|---|---|---:|---:|---:|",
		...record.runs.map((run) => {
			const name = `${run.caseId}${record.settings.repeat > 1 ? ` #${run.repetition}` : ""}`;
			const criteria = run.criteria.map((item) => `${item.id} ${item.status}`).join(", ") || "n/a";
			const turns =
				run.reviewer.modelTurns === null ? "n/a" : `${run.reviewer.modelTurns} (${run.reviewer.toolCalls})`;
			return `| ${name} | ${run.expected.toLowerCase()} | ${run.verdict ?? "none"} | ${criteria} | ${run.terminalStatus} | ${run.oracle}${run.falseCompletion ? " (false completion)" : ""} | ${tokens(run.reviewer.tokens)} | ${turns} | ${(run.durationMs / 1000).toFixed(1)} s |`;
		}),
		"",
		"Catch rate = FLAWED runs with a REVISE or BLOCK verdict / FLAWED runs with a verdict. False-alarm rate = CORRECT runs with a REVISE or BLOCK verdict / CORRECT runs with a verdict.",
		"False completion = Kernel COMPLETED with a FAIL hidden oracle. Reviewer tokens are the Reviewer session's provider-reported usage; the scripted Developer is excluded.",
		"",
	];
	return lines.join("\n");
}

const tool = (name: string, args: Record<string, unknown>) =>
	fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

/** The Runtime's worker prompt: the JSON request in the first user message. */
function workerRequest(context: Context): AgentExecutionRequest | null {
	const first = context.messages.find((message) => message.role === "user");
	return JSON.parse(first ? contentText(first.content) : "null") as AgentExecutionRequest | null;
}

/**
 * Scripted Developer for one case: lists files, reads and edits exactly the case's files through the Worker tools
 * (anchored read, receipt-bound edit, Policy), then hands off with the shared completion claim.
 */
export function scriptedDeveloperResponse(context: Context, caseId: string): AssistantMessage {
	const solution = DISCRIMINATIVE_SOLUTIONS.find((item) => item.id === caseId);
	const entry = solution && BENCHMARK_CORPUS.find((item) => item.fixture.id === solution.fixtureId);
	if (!solution || !entry) throw new Error("Unknown scripted Developer case");
	if (workerRequest(context)?.role !== "Developer") throw new Error("The scripted Developer only implements");
	const response = fitnessFauxResponse("GOOD", context, [{ ...entry.fixture, expectedFiles: solution.files }]);
	return {
		...response,
		content: response.content.map((part) =>
			part.type === "toolCall" && part.name === "submit_handoff"
				? { ...part, arguments: { ...part.arguments, summary: REVIEWER_EVAL_HANDOFF_SUMMARY } }
				: part,
		),
	};
}

/** Scripted Reviewer: PASS marks every criterion MET; REVISE marks every criterion UNMET with one warning. */
export function scriptedReviewerResponse(verdict: ReviewerEvalFauxVerdict, context: Context): AssistantMessage {
	const request = workerRequest(context);
	if (request?.role !== "Reviewer") throw new Error("The scripted Reviewer only reviews");
	const refs = request.verification.evidenceRefs;
	return tool("submit_review", {
		runId: request.runId,
		revision: request.revision,
		role: "Reviewer",
		task: request.task.id,
		result: verdict,
		diffDigest: request.verification.diffDigest,
		evidenceRefs: refs,
		issues:
			verdict === "PASS"
				? []
				: [
						{
							severity: "warning",
							file: null,
							description: "Scripted revision request",
							recommendation: "Revise the change",
						},
					],
		criteria: request.task.acceptanceCriteria.map((criterion) => ({
			criterionId: criterion.id,
			status: verdict === "PASS" ? "MET" : "UNMET",
			evidenceRefs: refs,
		})),
	});
}

/** Adds the scripted Developer (one faux model per case id) to the model runtime that serves the Reviewer. */
export async function registerScriptedDeveloper(models: ModelRuntime, responses: number): Promise<void> {
	const faux = fauxProvider({
		provider: REVIEWER_EVAL_DEVELOPER_PROVIDER,
		models: DISCRIMINATIVE_SOLUTIONS.map((solution) => ({ id: solution.id, contextWindow: 128000, maxTokens: 8192 })),
	});
	const respond: FauxResponseFactory = (context, _options, _state, model) =>
		scriptedDeveloperResponse(context, model.id);
	faux.setResponses(Array.from({ length: responses }, () => respond));
	models.registerNativeProvider(faux.provider);
	await models.refresh({ providers: [REVIEWER_EVAL_DEVELOPER_PROVIDER], allowNetwork: false });
}

/** Local scripted Reviewer runtime for tests and no-cost CLI runs; add the Developer with registerScriptedDeveloper. */
export function createScriptedReviewerModels(
	agentDir: string,
	verdict: ReviewerEvalFauxVerdict,
	responses: number,
): Promise<ModelRuntime> {
	return createFauxModelRuntime(agentDir, {
		provider: REVIEWER_EVAL_FAUX_PROVIDER,
		modelId: verdict,
		respond: (context) => scriptedReviewerResponse(verdict, context),
		responses,
	});
}

export interface ReviewerEvalOptions {
	/** Reviewer target. The runtime must also serve the scripted Developer (registerScriptedDeveloper). */
	provider: string;
	model: string;
	models: ModelRuntime;
	/** Trusted Weavra worker agent directory. */
	agentDir: string;
	caseIds: readonly string[];
	repeat: number;
	wallClockLimitMs: number;
	sandbox: "required" | "disabled";
	signal?: AbortSignal;
	/** Every frozen record, partial and final, so an interrupted evaluation keeps its completed runs. */
	onRecord?: (record: ReviewerEvalRecord) => void | Promise<void>;
	/** Deterministic tests may observe worker requests; nothing is retained. */
	onRequest?: (request: AgentExecutionRequest) => void;
}

type CaseOutcome = Omit<ReviewerEvalRun, "sequence" | "repetition">;

/** One STANDARD run through the real Worker SDK, Policy, verifier and Kernel; the hidden oracle judges the result. */
async function runCase(solution: BenchmarkSolution, options: ReviewerEvalOptions): Promise<CaseOutcome> {
	const entry = BENCHMARK_CORPUS.find((item) => item.fixture.id === solution.fixtureId)!;
	const timeout = AbortSignal.timeout(options.wallClockLimitMs);
	const observed: { run?: Run; oracle?: BenchmarkOracleVerdict } = {};
	const startedAt = Date.now();
	const result = await executeFitnessFixture(
		entry.fixture,
		{
			target: { provider: REVIEWER_EVAL_DEVELOPER_PROVIDER, model: solution.id },
			reviewer: { provider: options.provider, model: options.model },
			models: options.models,
			agentDir: options.agentDir,
			sandbox: options.sandbox,
			signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
			onRequest: options.onRequest,
			maxRevisionCycles: REVIEWER_EVAL_MAX_REVISION_CYCLES,
			observeWorkspace: ({ workspace, run, baseline }) => {
				observed.run = run;
				observed.oracle = evaluateBenchmarkOracle(entry, workspace, baseline, null);
			},
		},
		new BudgetController({
			maxWorkerInvocations: entry.fixture.budget.maxWorkerCalls,
			maxReportedTokens: entry.fixture.budget.maxTotalTokens,
		}),
	);
	const durationMs = Math.max(0, Date.now() - startedAt);
	const run = observed.run;
	const oracle = observed.oracle ?? { verdict: "INVALID", failures: ["The harness failed before the oracle"] };
	const review = run?.reviewHistory?.at(-1) ?? run?.review;
	const criteria = review && isCriteriaReview(review) ? review.criteria : [];
	const sessions = run?.workerMeasurements?.filter((measurement) => measurement.role === "Reviewer") ?? [];
	const known = sessions.length > 0 && sessions.every((measurement) => measurement.usage.source === "provider");
	const sum = (value: (measurement: (typeof sessions)[number]) => number) =>
		sessions.reduce((total, measurement) => total + value(measurement), 0);
	const completed = result.terminalStatus === "COMPLETED";
	return {
		caseId: solution.id,
		fixtureId: solution.fixtureId,
		expected: solution.expected,
		terminalStatus: result.terminalStatus,
		completed,
		verdict: review?.result ?? null,
		criteria: criteria
			.map((item) => ({ id: item.criterionId, status: item.status }))
			.sort((left, right) => left.id.localeCompare(right.id)),
		issues: {
			blocker: review?.issues.filter((issue) => issue.severity === "blocker").length ?? 0,
			warning: review?.issues.filter((issue) => issue.severity === "warning").length ?? 0,
			info: review?.issues.filter((issue) => issue.severity === "info").length ?? 0,
		},
		oracle: oracle.verdict,
		oracleFailures: oracle.failures.slice(0, 8).map((failure) => failure.slice(0, 240)),
		falseCompletion: oracle.verdict === "INVALID" ? null : completed && oracle.verdict === "FAIL",
		failureCategory: !run
			? "UNOBSERVED"
			: run.status === "COMPLETED"
				? null
				: (projectEvidencePack({ run }).failure?.category ?? "UNKNOWN"),
		timedOut: timeout.aborted,
		durationMs,
		reviewer: {
			tokens: {
				state: known ? "KNOWN" : "UNKNOWN",
				input: known ? sum((measurement) => measurement.usage.input) : null,
				output: known ? sum((measurement) => measurement.usage.output) : null,
				total: known ? sum((measurement) => measurement.usage.totalTokens) : null,
			},
			durationMs: sessions.length ? sum((measurement) => measurement.durationMs) : null,
			modelTurns: sessions.length ? sum((measurement) => measurement.modelTurns) : null,
			toolCalls: sessions.length ? sum((measurement) => measurement.toolCalls) : null,
		},
	};
}

export async function runReviewerEval(options: ReviewerEvalOptions): Promise<ReviewerEvalRecord> {
	const solutions = options.caseIds.map((id) => {
		const solution = DISCRIMINATIVE_SOLUTIONS.find((item) => item.id === id);
		if (!solution) throw new Error(`Unknown reviewer evaluation case ${id}`);
		return solution;
	});
	if (!solutions.length || new Set(options.caseIds).size !== solutions.length)
		throw new Error("Invalid reviewer evaluation selection");
	if (options.provider === REVIEWER_EVAL_DEVELOPER_PROVIDER)
		throw new Error("The Reviewer must not be the scripted Developer");
	const model = options.models.getModel(options.provider, options.model);
	if (!model) throw new Error("Reviewer model unavailable; no fallback");
	const harness = harnessIdentity();
	let record = freezeReviewerEvalRecord({
		schemaVersion: REVIEWER_EVAL_SCHEMA_VERSION,
		harnessVersion: REVIEWER_EVAL_HARNESS_VERSION,
		harnessRevision: harness.revision,
		harnessDirty: harness.dirty,
		id: randomUUID(),
		status: "RUNNING",
		startedAt: Date.now(),
		completedAt: null,
		reviewer: {
			provider: options.provider,
			model: model.id,
			api: model.api,
			faux: options.provider === REVIEWER_EVAL_FAUX_PROVIDER,
		},
		settings: {
			repeat: options.repeat,
			wallClockLimitMs: options.wallClockLimitMs,
			sandbox: options.sandbox,
			maxRevisionCycles: REVIEWER_EVAL_MAX_REVISION_CYCLES,
		},
		corpus: {
			revision: BENCHMARK_CORPUS_REVISION,
			digest: fitnessDigest(BENCHMARK_CORPUS.map(benchmarkFixtureDigest)),
		},
		cases: solutions.map((solution) => {
			const entry = BENCHMARK_CORPUS.find((item) => item.fixture.id === solution.fixtureId)!;
			return {
				id: solution.id,
				fixtureId: solution.fixtureId,
				expected: solution.expected,
				digest: fitnessDigest({
					fixture: benchmarkFixtureDigest(entry),
					expected: solution.expected,
					files: solution.files,
				}),
			};
		}),
		runs: [],
		environment: { platform: process.platform, arch: process.arch, node: process.version },
	});
	await options.onRecord?.(record);
	let status: ReviewerEvalRecord["status"] = "COMPLETED";
	try {
		for (let repetition = 1; repetition <= options.repeat; repetition++)
			for (const solution of solutions) {
				if (options.signal?.aborted) break;
				const outcome = await runCase(solution, options);
				record = freezeReviewerEvalRecord({
					...record,
					runs: [...record.runs, { sequence: record.runs.length, repetition, ...outcome }],
				});
				await options.onRecord?.(record);
			}
	} catch {
		status = "FAILED";
	}
	if (status === "COMPLETED" && options.signal?.aborted) status = "CANCELLED";
	record = freezeReviewerEvalRecord({ ...record, status, completedAt: Date.now() });
	await options.onRecord?.(record);
	return record;
}

export interface ReviewerEvalCliIo {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	signal?: AbortSignal;
}

function writeAtomic(path: string, content: string): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, content, { mode: 0o600 });
	renameSync(temporary, path);
}

/** Returns the process exit code: 0 completed, 1 evaluation not completed, 2 invalid or refused invocation. */
export async function runReviewerEvalCli(argv: readonly string[], io: ReviewerEvalCliIo): Promise<number> {
	let options: ReturnType<typeof parseReviewerEvalArgs>;
	try {
		options = parseReviewerEvalArgs(argv);
		if (options.help) {
			io.stdout(REVIEWER_EVAL_USAGE);
			return 0;
		}
		assertReviewerEvalPaidConfirmation(options);
	} catch (error) {
		if (!(error instanceof ReviewerEvalArgsError)) throw error;
		io.stderr(`${error.message}\n\n${REVIEWER_EVAL_USAGE}`);
		return 2;
	}
	const plan = describeReviewerEvalPlan(options);
	io.stderr(`${plan.text}\n`);
	const out = resolve(options.out ?? join(PACKAGE_ROOT, ".eval", "reviewer-eval"));
	mkdirSync(out, { recursive: true, mode: 0o700 });
	// Upper bound of scripted responses: every run has one Developer and one Reviewer session of <= 16 turns each.
	const responses = plan.runs * BENCHMARK_WEAVRA_MAX_TURNS_PER_WORKER;
	let temporary: string | undefined;
	try {
		let agentDir: string;
		let models: ModelRuntime;
		if (options.faux) {
			temporary = realpathSync(mkdtempSync(join(tmpdir(), "weavra-reviewer-eval-agent-")));
			agentDir = join(temporary, "agent");
			mkdirSync(agentDir, { mode: 0o700 });
			models = await createScriptedReviewerModels(agentDir, options.model as ReviewerEvalFauxVerdict, responses);
		} else {
			// Same trusted Weavra auth/models scope as `weavra fitness run` and the benchmark; no fallback model.
			agentDir = await prepareLaunch(process.env);
			models = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: join(agentDir, "models.json"),
				modelsStore: new InMemoryModelsStore(),
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
		}
		// The Developer is always scripted and local; only the Reviewer uses the selected provider.
		await registerScriptedDeveloper(models, responses);
		const record = await runReviewerEval({
			provider: options.provider,
			model: options.model,
			models,
			agentDir,
			caseIds: options.caseIds,
			repeat: options.repeat,
			wallClockLimitMs: options.wallClockLimitMs,
			sandbox: options.sandbox,
			signal: io.signal,
			onRecord: (current) => {
				writeAtomic(join(out, `reviewer-eval-${current.id}.json`), `${JSON.stringify(current, null, 2)}\n`);
				writeAtomic(join(out, `reviewer-eval-${current.id}.md`), formatReviewerEvalMarkdown(current));
				io.stderr(`[reviewer-eval] ${current.runs.length}/${plan.runs} runs recorded (${current.status})\n`);
			},
		});
		io.stdout(formatReviewerEvalMarkdown(record));
		io.stdout(
			`\nResults: ${join(out, `reviewer-eval-${record.id}.json`)}\n         ${join(out, `reviewer-eval-${record.id}.md`)}\n`,
		);
		return record.status === "COMPLETED" ? 0 : 1;
	} finally {
		if (temporary) rmSync(temporary, { recursive: true, force: true });
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const controller = new AbortController();
	const cancel = () => controller.abort();
	process.once("SIGINT", cancel);
	process.once("SIGTERM", cancel);
	try {
		process.exitCode = await runReviewerEvalCli(process.argv.slice(2), {
			stdout: (text) => process.stdout.write(text),
			stderr: (text) => process.stderr.write(text),
			signal: controller.signal,
		});
	} catch {
		// Never forward raw errors: provider/auth failures may embed credential bytes or arbitrary paths.
		process.stderr.write(
			"Weavra reviewer evaluation failed. Check command syntax, local setup and the selected target. No automatic retry or fallback was performed.\n",
		);
		process.exitCode = 1;
	} finally {
		process.removeListener("SIGINT", cancel);
		process.removeListener("SIGTERM", cancel);
	}
}
