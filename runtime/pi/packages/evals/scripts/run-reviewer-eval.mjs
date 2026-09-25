// Reviewer efficacy evaluation launcher. Validates arguments and refuses every Reviewer provider other than the local
// scripted faux provider unless --confirm-paid is passed, before any SDK, credential or provider code loads.
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	assertReviewerEvalPaidConfirmation,
	describeReviewerEvalPlan,
	parseReviewerEvalArgs,
	REVIEWER_EVAL_USAGE,
	ReviewerEvalArgsError,
} from "../src/reviewer-eval-args.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

try {
	const options = parseReviewerEvalArgs(args);
	if (options.help) {
		process.stdout.write(REVIEWER_EVAL_USAGE);
		process.exit(0);
	}
	assertReviewerEvalPaidConfirmation(options);
	if (!options.faux)
		process.stderr.write(
			`WARNING: --confirm-paid given; ${options.provider}/${options.model} may bill you.\n${describeReviewerEvalPlan(options).text}\n`,
		);
} catch (error) {
	if (!(error instanceof ReviewerEvalArgsError)) throw error;
	process.stderr.write(`${error.message}\n\n${REVIEWER_EVAL_USAGE}`);
	process.exit(2);
}

const result = spawnSync(process.execPath, [resolve(packageRoot, "src/reviewer-eval.ts"), ...args], {
	stdio: "inherit",
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
