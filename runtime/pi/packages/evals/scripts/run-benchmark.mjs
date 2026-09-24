// Weavra-vs-Pi benchmark launcher. Validates arguments and refuses every provider other than the local
// scripted faux provider unless --confirm-paid is passed, before any SDK, credential or provider code loads.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertBenchmarkPaidConfirmation,
	BENCHMARK_USAGE,
	BenchmarkArgsError,
	describeBenchmarkPlan,
	parseBenchmarkArgs,
} from "../src/benchmark-args.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

try {
	const options = parseBenchmarkArgs(args);
	if (options.help) {
		process.stdout.write(BENCHMARK_USAGE);
		process.exit(0);
	}
	assertBenchmarkPaidConfirmation(options);
	if (!options.faux)
		process.stderr.write(
			`WARNING: --confirm-paid given; ${options.provider}/${options.model} may bill you.\n${describeBenchmarkPlan(options).text}\n`,
		);
} catch (error) {
	if (!(error instanceof BenchmarkArgsError)) throw error;
	process.stderr.write(`${error.message}\n\n${BENCHMARK_USAGE}`);
	process.exit(2);
}

const result = spawnSync(process.execPath, [resolve(packageRoot, "src/benchmark-cli.ts"), ...args], {
	stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
