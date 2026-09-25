// Argument contract of the Reviewer efficacy evaluation CLI. Free of SDK imports so the launcher can refuse
// unconfirmed paid runs before any Runtime module, credential or provider is loaded.
import { BENCHMARK_CORPUS } from "./benchmark-corpus.ts";
import { BENCHMARK_DEFAULT_WALL_CLOCK_MS, BENCHMARK_WEAVRA_MAX_TURNS_PER_WORKER } from "./benchmark-record.ts";
import { DISCRIMINATIVE_SOLUTION_IDS, DISCRIMINATIVE_SOLUTIONS } from "./benchmark-solutions.ts";

/** Local scripted Reviewer; the only provider that runs without `--confirm-paid`. */
export const REVIEWER_EVAL_FAUX_PROVIDER = "reviewer-eval-faux";
export const REVIEWER_EVAL_FAUX_VERDICTS = ["PASS", "REVISE"] as const;
export type ReviewerEvalFauxVerdict = (typeof REVIEWER_EVAL_FAUX_VERDICTS)[number];

export interface ReviewerEvalCliOptions {
	/** Reviewer target; the Developer is always the local scripted one. */
	provider: string;
	model: string;
	caseIds: string[];
	repeat: number;
	/** Output directory; undefined lets the CLI choose the ignored package-local default. */
	out: string | undefined;
	wallClockLimitMs: number;
	sandbox: "required" | "disabled";
	confirmPaid: boolean;
	faux: boolean;
	help: boolean;
}

export const REVIEWER_EVAL_USAGE = `Usage: npm run reviewer-eval -- --provider <provider> --model <model> [options]

Hands each seeded solution of the discriminative fixtures B07-B10 (7 flawed, 4 correct) to an independent Weavra
Reviewer. A scripted Developer applies exactly the case's files; only the Reviewer runs on the selected model. The
revision limit is 0, so the first verdict decides. The hidden oracle judges the final files.

Options:
  --provider <id>        Reviewer provider. "${REVIEWER_EVAL_FAUX_PROVIDER}" is the local scripted Reviewer (no network).
  --model <id>           Reviewer model id (for ${REVIEWER_EVAL_FAUX_PROVIDER}: ${REVIEWER_EVAL_FAUX_VERDICTS.join(" or ")}).
  --cases <list|all>     Comma list of case ids (default: all):
                         ${DISCRIMINATIVE_SOLUTION_IDS.join(", ")}.
  --repeat <n>           Repetitions per case, 1..20 (default: 1).
  --out <dir>            Output directory for reviewer-eval-<id>.json/.md (default: packages/evals/.eval/reviewer-eval).
  --timeout-ms <n>       Wall-clock limit per run, 1000..7200000 (default: ${BENCHMARK_DEFAULT_WALL_CLOCK_MS}).
  --sandbox <mode>       Weavra verifier sandbox: required (default) or disabled.
  --confirm-paid         Required for every provider other than ${REVIEWER_EVAL_FAUX_PROVIDER}. Real providers may bill you.
`;

export class ReviewerEvalArgsError extends Error {}

function integer(value: string, min: number, max: number, name: string): number {
	const number = Number(value);
	if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max)
		throw new ReviewerEvalArgsError(`Invalid ${name}: expected an integer between ${min} and ${max}`);
	return number;
}

export function parseReviewerEvalArgs(argv: readonly string[]): ReviewerEvalCliOptions {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	const valued = ["--provider", "--model", "--cases", "--repeat", "--out", "--timeout-ms", "--sandbox"];
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--confirm-paid" || arg === "--help" || arg === "-h") {
			const flag = arg === "-h" ? "--help" : arg;
			if (flags.has(flag)) throw new ReviewerEvalArgsError(`Duplicate ${arg}`);
			flags.add(flag);
			continue;
		}
		if (!valued.includes(arg)) throw new ReviewerEvalArgsError(`Unknown argument ${arg}`);
		const value = argv[++index];
		if (value === undefined || value.startsWith("--") || !value.trim())
			throw new ReviewerEvalArgsError(`Missing value for ${arg}`);
		if (values.has(arg)) throw new ReviewerEvalArgsError(`Duplicate ${arg}`);
		values.set(arg, value.trim());
	}
	const help = flags.has("--help");
	const provider = values.get("--provider") ?? "";
	const model = values.get("--model") ?? "";
	if (!help && (!provider || !model)) throw new ReviewerEvalArgsError("--provider and --model are required");
	const faux = provider === REVIEWER_EVAL_FAUX_PROVIDER;
	if (faux && !(REVIEWER_EVAL_FAUX_VERDICTS as readonly string[]).includes(model))
		throw new ReviewerEvalArgsError(
			`${REVIEWER_EVAL_FAUX_PROVIDER} models are ${REVIEWER_EVAL_FAUX_VERDICTS.join(", ")}`,
		);
	const sandbox = values.get("--sandbox") ?? "required";
	if (sandbox !== "required" && sandbox !== "disabled")
		throw new ReviewerEvalArgsError("Invalid --sandbox: expected required or disabled");
	const cases = values.get("--cases") ?? "all";
	const caseIds = cases === "all" ? [...DISCRIMINATIVE_SOLUTION_IDS] : cases.split(",").map((item) => item.trim());
	if (caseIds.some((id) => !DISCRIMINATIVE_SOLUTION_IDS.includes(id)) || new Set(caseIds).size !== caseIds.length)
		throw new ReviewerEvalArgsError(
			`Invalid --cases: expected all or a comma list of ${DISCRIMINATIVE_SOLUTION_IDS.join(", ")}`,
		);
	return {
		provider,
		model,
		caseIds,
		repeat: integer(values.get("--repeat") ?? "1", 1, 20, "--repeat"),
		out: values.get("--out"),
		wallClockLimitMs: integer(
			values.get("--timeout-ms") ?? String(BENCHMARK_DEFAULT_WALL_CLOCK_MS),
			1000,
			7_200_000,
			"--timeout-ms",
		),
		sandbox,
		confirmPaid: flags.has("--confirm-paid"),
		faux,
		help,
	};
}

/** Human-readable run count and bounds. Cost stays UNKNOWN: no pricing is assumed. */
export function describeReviewerEvalPlan(options: ReviewerEvalCliOptions): { runs: number; text: string } {
	const runs = options.caseIds.length * options.repeat;
	const selected = DISCRIMINATIVE_SOLUTIONS.filter((solution) => options.caseIds.includes(solution.id));
	const flawed = selected.filter((solution) => solution.expected === "FLAWED").length;
	const fixtures = BENCHMARK_CORPUS.filter((entry) =>
		selected.some((solution) => solution.fixtureId === entry.fixture.id),
	);
	const timeout = Math.max(...fixtures.map((entry) => entry.fixture.budget.workerTimeoutMs));
	const text = [
		`Planned runs: ${runs} = ${options.caseIds.length} cases (${flawed} flawed, ${options.caseIds.length - flawed} correct) x ${options.repeat} repeat.`,
		`Reviewer: ${options.provider}/${options.model}${options.faux ? " (local scripted faux provider; no network, no cost)" : ""}. Developer: scripted, local, no provider calls.`,
		`Each run is limited to ${options.wallClockLimitMs} ms wall clock and one Reviewer session of <= ${BENCHMARK_WEAVRA_MAX_TURNS_PER_WORKER} turns and ${timeout} ms. ` +
			`Upper bound on Reviewer model responses: ${runs * BENCHMARK_WEAVRA_MAX_TURNS_PER_WORKER}. Tokens are not capped. Cost: UNKNOWN.`,
	].join("\n");
	return { runs, text };
}

/** Refuses every non-faux Reviewer provider unless `--confirm-paid` was passed. */
export function assertReviewerEvalPaidConfirmation(options: ReviewerEvalCliOptions): void {
	if (options.faux || options.confirmPaid) return;
	throw new ReviewerEvalArgsError(
		`Refusing to run provider "${options.provider}" without --confirm-paid: real providers may bill you.\n${describeReviewerEvalPlan(options).text}`,
	);
}
