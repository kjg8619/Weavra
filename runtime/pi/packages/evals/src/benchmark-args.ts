// Argument contract of the Weavra-vs-Pi benchmark CLI. Free of SDK imports so the launcher can refuse
// unconfirmed paid runs before any Runtime module, credential or provider is loaded.
import { BENCHMARK_CORPUS, BENCHMARK_FIXTURE_IDS } from "./benchmark-corpus.ts";
import {
	BENCHMARK_ARMS,
	BENCHMARK_DEFAULT_WALL_CLOCK_MS,
	BENCHMARK_FAUX_BEHAVIORS,
	BENCHMARK_FAUX_PROVIDER,
	BENCHMARK_PI_MAX_TURNS,
	BENCHMARK_WEAVRA_MAX_TURNS_PER_WORKER,
	type BenchmarkArm,
} from "./benchmark-record.ts";

export interface BenchmarkCliOptions {
	provider: string;
	model: string;
	arms: BenchmarkArm[];
	fixtureIds: string[];
	repeat: number;
	/** Output directory; undefined lets the CLI choose the ignored package-local default. */
	out: string | undefined;
	wallClockLimitMs: number;
	sandbox: "required" | "disabled";
	confirmPaid: boolean;
	faux: boolean;
	help: boolean;
}

export const BENCHMARK_USAGE = `Usage: npm run benchmark -- --provider <provider> --model <model> [options]

Compares plain Pi with Weavra STANDARD on the same fixtures, model and wall-clock limit.

Options:
  --provider <id>        Model provider. "${BENCHMARK_FAUX_PROVIDER}" is the local scripted provider (no network).
  --model <id>           Model id (for ${BENCHMARK_FAUX_PROVIDER}: ${BENCHMARK_FAUX_BEHAVIORS.join(" or ")}).
  --arms <list>          Comma list of ${BENCHMARK_ARMS.join(", ")} (default: all).
  --fixtures <list|all>  Comma list of ${BENCHMARK_FIXTURE_IDS.join(", ")} (default: all).
  --repeat <n>           Repetitions per arm and fixture, 1..100 (default: 1).
  --out <dir>            Output directory for benchmark-<id>.json/.md (default: packages/evals/.eval/benchmark).
  --timeout-ms <n>       Wall-clock limit per run, 1000..7200000 (default: ${BENCHMARK_DEFAULT_WALL_CLOCK_MS}).
  --sandbox <mode>       Weavra verifier sandbox: required (default) or disabled.
  --confirm-paid         Required for every provider other than ${BENCHMARK_FAUX_PROVIDER}. Real providers may bill you.
`;

export class BenchmarkArgsError extends Error {}

function list(value: string, allowed: readonly string[], name: string): string[] {
	const items = value.split(",").map((item) => item.trim());
	if (!items.length || items.some((item) => !allowed.includes(item)) || new Set(items).size !== items.length)
		throw new BenchmarkArgsError(`Invalid ${name}: expected a comma list of ${allowed.join(", ")}`);
	return items;
}

function integer(value: string, min: number, max: number, name: string): number {
	const number = Number(value);
	if (!/^[0-9]+$/.test(value) || !Number.isSafeInteger(number) || number < min || number > max)
		throw new BenchmarkArgsError(`Invalid ${name}: expected an integer between ${min} and ${max}`);
	return number;
}

export function parseBenchmarkArgs(argv: readonly string[]): BenchmarkCliOptions {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	const valued = ["--provider", "--model", "--arms", "--fixtures", "--repeat", "--out", "--timeout-ms", "--sandbox"];
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--confirm-paid" || arg === "--help" || arg === "-h") {
			if (flags.has(arg)) throw new BenchmarkArgsError(`Duplicate ${arg}`);
			flags.add(arg === "-h" ? "--help" : arg);
			continue;
		}
		if (!valued.includes(arg)) throw new BenchmarkArgsError(`Unknown argument ${arg}`);
		const value = argv[++index];
		if (value === undefined || value.startsWith("--") || !value.trim())
			throw new BenchmarkArgsError(`Missing value for ${arg}`);
		if (values.has(arg)) throw new BenchmarkArgsError(`Duplicate ${arg}`);
		values.set(arg, value.trim());
	}
	const help = flags.has("--help");
	const provider = values.get("--provider") ?? "";
	const model = values.get("--model") ?? "";
	if (!help && (!provider || !model)) throw new BenchmarkArgsError("--provider and --model are required");
	const faux = provider === BENCHMARK_FAUX_PROVIDER;
	if (faux && !(BENCHMARK_FAUX_BEHAVIORS as readonly string[]).includes(model))
		throw new BenchmarkArgsError(`${BENCHMARK_FAUX_PROVIDER} models are ${BENCHMARK_FAUX_BEHAVIORS.join(", ")}`);
	const sandbox = values.get("--sandbox") ?? "required";
	if (sandbox !== "required" && sandbox !== "disabled")
		throw new BenchmarkArgsError("Invalid --sandbox: expected required or disabled");
	const fixtures = values.get("--fixtures") ?? "all";
	return {
		provider,
		model,
		arms: list(values.get("--arms") ?? BENCHMARK_ARMS.join(","), BENCHMARK_ARMS, "--arms") as BenchmarkArm[],
		fixtureIds: fixtures === "all" ? [...BENCHMARK_FIXTURE_IDS] : list(fixtures, BENCHMARK_FIXTURE_IDS, "--fixtures"),
		repeat: integer(values.get("--repeat") ?? "1", 1, 100, "--repeat"),
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

/** Human-readable run-count and upper-bound estimate. Cost stays UNKNOWN: no pricing is assumed. */
export function describeBenchmarkPlan(options: BenchmarkCliOptions): { runs: number; text: string } {
	const runs = options.arms.length * options.fixtureIds.length * options.repeat;
	const selected = BENCHMARK_CORPUS.filter((entry) => options.fixtureIds.includes(entry.fixture.id));
	const workerCalls = Math.max(...selected.map((entry) => entry.fixture.budget.maxWorkerCalls));
	const tokens = Math.max(...selected.map((entry) => entry.fixture.budget.maxTotalTokens));
	const weavraArms = options.arms.filter((arm) => arm !== "pi").length;
	const maxResponses =
		options.fixtureIds.length *
		options.repeat *
		((options.arms.includes("pi") ? BENCHMARK_PI_MAX_TURNS : 0) +
			weavraArms * workerCalls * BENCHMARK_WEAVRA_MAX_TURNS_PER_WORKER);
	const text = [
		`Planned runs: ${runs} = ${options.arms.length} arms x ${options.fixtureIds.length} fixtures x ${options.repeat} repeat.`,
		`Target: ${options.provider}/${options.model}${options.faux ? " (local scripted faux provider; no network, no cost)" : ""}.`,
		`Each run is limited to ${options.wallClockLimitMs} ms wall clock. Upper bound on model responses: ${maxResponses} ` +
			`(pi <= ${BENCHMARK_PI_MAX_TURNS} turns/run; Weavra <= ${workerCalls} workers x ${BENCHMARK_WEAVRA_MAX_TURNS_PER_WORKER} turns/run).`,
		`Per-run token ceiling: ${tokens} provider-reported tokens; it stops further calls and is not a billing hard cap. Cost: UNKNOWN.`,
	].join("\n");
	return { runs, text };
}

/** Refuses every non-faux provider unless `--confirm-paid` was passed. */
export function assertBenchmarkPaidConfirmation(options: BenchmarkCliOptions): void {
	if (options.faux || options.confirmPaid) return;
	throw new BenchmarkArgsError(
		`Refusing to run provider "${options.provider}" without --confirm-paid: real providers may bill you.\n${describeBenchmarkPlan(options).text}`,
	);
}
