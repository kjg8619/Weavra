// Weavra-vs-Pi benchmark CLI. Launched by scripts/run-benchmark.mjs, which refuses unconfirmed paid runs before
// this module (and any SDK, credential or provider code) is loaded; the same refusal is repeated here.
import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { prepareLaunch } from "../../company-runtime/src/launcher-home.ts";
import {
	assertBenchmarkPaidConfirmation,
	BENCHMARK_USAGE,
	BenchmarkArgsError,
	describeBenchmarkPlan,
	parseBenchmarkArgs,
} from "./benchmark-args.ts";
import { createBenchmarkFauxModels } from "./benchmark-faux.ts";
import { type BenchmarkFauxBehavior, formatBenchmarkMarkdown } from "./benchmark-record.ts";
import { runBenchmark } from "./benchmark-runner.ts";

const PACKAGE_ROOT = fileURLToPath(new URL("../", import.meta.url));
// Upper bound of scripted responses one faux run can consume (pi <= 64 turns; Weavra <= 4 workers x 16 turns).
const FAUX_RESPONSES_PER_RUN = 128;

export interface BenchmarkCliIo {
	stdout: (text: string) => void;
	stderr: (text: string) => void;
	signal?: AbortSignal;
}

function writeAtomic(path: string, content: string): void {
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, content, { mode: 0o600 });
	renameSync(temporary, path);
}

/** Returns the process exit code: 0 completed, 1 benchmark not completed, 2 invalid or refused invocation. */
export async function runBenchmarkCli(argv: readonly string[], io: BenchmarkCliIo): Promise<number> {
	let options: ReturnType<typeof parseBenchmarkArgs>;
	try {
		options = parseBenchmarkArgs(argv);
		if (options.help) {
			io.stdout(BENCHMARK_USAGE);
			return 0;
		}
		assertBenchmarkPaidConfirmation(options);
	} catch (error) {
		if (!(error instanceof BenchmarkArgsError)) throw error;
		io.stderr(`${error.message}\n\n${BENCHMARK_USAGE}`);
		return 2;
	}
	const plan = describeBenchmarkPlan(options);
	io.stderr(`${plan.text}\n`);
	const out = resolve(options.out ?? join(PACKAGE_ROOT, ".eval", "benchmark"));
	mkdirSync(out, { recursive: true, mode: 0o700 });
	let temporary: string | undefined;
	try {
		let agentDir: string;
		let models: ModelRuntime;
		if (options.faux) {
			temporary = realpathSync(mkdtempSync(join(tmpdir(), "weavra-benchmark-agent-")));
			agentDir = join(temporary, "agent");
			mkdirSync(agentDir, { mode: 0o700 });
			models = await createBenchmarkFauxModels(
				agentDir,
				options.model as BenchmarkFauxBehavior,
				plan.runs * FAUX_RESPONSES_PER_RUN,
			);
		} else {
			// Same trusted Weavra auth/models scope as `weavra fitness run`; no fallback model or provider.
			agentDir = await prepareLaunch(process.env);
			models = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: join(agentDir, "models.json"),
				modelsStore: new InMemoryModelsStore(),
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
		}
		const record = await runBenchmark({
			provider: options.provider,
			model: options.model,
			models,
			agentDir,
			arms: options.arms,
			fixtureIds: options.fixtureIds,
			repeat: options.repeat,
			wallClockLimitMs: options.wallClockLimitMs,
			sandbox: options.sandbox,
			signal: io.signal,
			onRecord: (current) => {
				writeAtomic(join(out, `benchmark-${current.id}.json`), `${JSON.stringify(current, null, 2)}\n`);
				writeAtomic(join(out, `benchmark-${current.id}.md`), formatBenchmarkMarkdown(current));
				io.stderr(`[benchmark] ${current.runs.length}/${plan.runs} runs recorded (${current.status})\n`);
			},
		});
		io.stdout(formatBenchmarkMarkdown(record));
		io.stdout(
			`\nResults: ${join(out, `benchmark-${record.id}.json`)}\n         ${join(out, `benchmark-${record.id}.md`)}\n`,
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
		process.exitCode = await runBenchmarkCli(process.argv.slice(2), {
			stdout: (text) => process.stdout.write(text),
			stderr: (text) => process.stderr.write(text),
			signal: controller.signal,
		});
	} catch {
		// Never forward raw errors: provider/auth failures may embed credential bytes or arbitrary paths.
		process.stderr.write(
			"Weavra benchmark failed. Check command syntax, local setup and the selected target. No automatic retry or fallback was performed.\n",
		);
		process.exitCode = 1;
	} finally {
		process.removeListener("SIGINT", cancel);
		process.removeListener("SIGTERM", cancel);
	}
}
