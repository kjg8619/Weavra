// Evaluation-only launcher. Never imported by the interactive Runtime or exposed as execution RPC.
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { FITNESS_CORPUS, FITNESS_CORPUS_DIGEST, FITNESS_CORPUS_REVISION } from "../../evals/src/fitness-corpus.ts";
import { createFitnessFauxModels, type FitnessFauxBehavior } from "../../evals/src/fitness-faux.ts";
import { createFitnessTarget, runFitnessMatrix } from "../../evals/src/fitness-runner.ts";
import { compareFitnessRuns, FitnessRecordStore, fitnessDigest, summarizeFitnessRun } from "./fitness-records.ts";
import { prepareLaunch, resolveWeavraHome } from "./launcher-home.ts";

const help = `Usage:
  weavra fitness list [--json]
  weavra fitness targets <provider>
  weavra fitness show <run-id> [--json]
  weavra fitness compare <run-a> <run-b> [--json]
  weavra fitness run <provider/model> --allow-paid --confirm-corpus <digest> --calibration --max-fixtures 2 --max-worker-calls 4 --max-tokens 100000
  weavra fitness run <provider/model> --allow-paid --confirm-corpus <digest> --max-fixtures 10 --max-worker-calls 32 --max-tokens 500000
  weavra fitness faux <GOOD|CONTRACT_VIOLATOR|UNRELIABLE|FALSE_COMPLETER> --max-fixtures 10 --max-worker-calls 32 --max-tokens 500000
Optional: --store-dir <absolute-private-directory>, --max-cost-usd <positive-number>.
Fresh actual evaluation includes F01/F02 integrity calibration in the same full ordered cohort. Semantic failures remain results, not admission failures.
Optional --calibration-id <id> runs only the remaining eight fixtures in a separate PARTIAL cohort; it never imports or reruns the original results.
Actual execution requires strict mutation/trust and required verifier sandbox. Infrastructure failure or unsafe usage stops subsequent calls.
Token limits stop subsequent worker calls; they are not in-flight billing caps. Cost is UNKNOWN; a monetary ceiling admits no call.
No automatic retry, fallback, routing, ranking or transcript persistence. SIGINT/SIGTERM await Runtime cleanup and preserve partial results.\n`;

const args = process.argv.slice(2);
const command = args.shift();
let tempAgent: string | undefined;
try {
	if (!command || command === "help" || command === "--help") {
		process.stdout.write(help);
	} else {
		const positional: string[] = [];
		const flags = new Map<string, string | true>();
		const boolean = new Set(["--json", "--allow-paid", "--calibration"]);
		const values = new Set([
			"--confirm-corpus",
			"--max-fixtures",
			"--max-worker-calls",
			"--max-tokens",
			"--max-cost-usd",
			"--fixtures",
			"--calibration-id",
			"--store-dir",
		]);
		for (let index = 0; index < args.length; index++) {
			const arg = args[index];
			if (!arg.startsWith("--")) {
				positional.push(arg);
				continue;
			}
			if (flags.has(arg) || (!boolean.has(arg) && !values.has(arg))) throw new Error("Invalid Fitness arguments");
			if (boolean.has(arg)) flags.set(arg, true);
			else {
				const value = args[++index];
				if (!value || value.startsWith("--")) throw new Error("Missing Fitness argument");
				flags.set(arg, value);
			}
		}
		const paths = await resolveWeavraHome(process.env);
		const directory =
			typeof flags.get("--store-dir") === "string"
				? String(flags.get("--store-dir"))
				: join(paths.home, "fitness", fitnessDigest({ project: await realpath(process.cwd()) }).slice(7));
		if (!directory.startsWith("/")) throw new Error("Fitness store must be absolute");
		const output = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
		const readonly = new Set(["list", "show", "compare", "targets"]);
		if (readonly.has(command) && [...flags.keys()].some((flag) => flag !== "--json" && flag !== "--store-dir"))
			throw new Error("Execution flags on read-only Fitness command");
		if (command === "list") {
			if (positional.length) throw new Error("Invalid Fitness list arguments");
			let runs: Awaited<ReturnType<FitnessRecordStore["list"]>> = [];
			try {
				runs = await (await FitnessRecordStore.open(directory)).list();
			} catch (error) {
				// Missing history is not a reason to create directories or authenticate providers.
				try {
					await realpath(directory);
				} catch (missing) {
					if ((missing as NodeJS.ErrnoException).code === "ENOENT") {
						output({
							schemaVersion: 1,
							corpusRevision: FITNESS_CORPUS_REVISION,
							corpusDigest: FITNESS_CORPUS_DIGEST,
							fixtures: FITNESS_CORPUS.map((fixture) => ({
								id: fixture.id,
								category: fixture.category,
								language: fixture.language,
								digest: fitnessDigest(fixture),
								expectedTerminal: fixture.expectedTerminal,
								budget: fixture.budget,
							})),
							runs: [],
						});
						process.exit(0);
					}
				}
				throw error;
			}
			output({
				schemaVersion: 1,
				corpusRevision: FITNESS_CORPUS_REVISION,
				corpusDigest: FITNESS_CORPUS_DIGEST,
				fixtures: FITNESS_CORPUS.map((fixture) => ({
					id: fixture.id,
					category: fixture.category,
					language: fixture.language,
					digest: fitnessDigest(fixture),
					expectedTerminal: fixture.expectedTerminal,
					budget: fixture.budget,
				})),
				runs: runs.map((run) => ({
					...summarizeFitnessRun(run),
					corpusRevision: run.corpusRevision,
					corpusDigest: run.corpusDigest,
					startedAt: run.startedAt,
					completedAt: run.completedAt,
					resultDigest: run.resultDigest,
				})),
			});
		} else if (command === "show" || command === "compare") {
			if (positional.length !== (command === "show" ? 1 : 2)) throw new Error("Invalid Fitness history arguments");
			const store = await FitnessRecordStore.open(directory);
			const first = await store.read(positional[0]);
			output(command === "show" ? first : compareFitnessRuns(first, await store.read(positional[1])));
		} else if (command === "targets") {
			if (positional.length !== 1) throw new Error("Choose an explicit provider for metadata inventory");
			const agentDir = await prepareLaunch(process.env);
			const models = await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: join(agentDir, "models.json"),
				modelsStore: new InMemoryModelsStore(),
				allowModelNetwork: false,
				refreshOnCreate: false,
			});
			const candidates = models.getModels(positional[0]);
			if (candidates.length > 128) throw new Error("Fitness catalog exceeds display bound");
			output({
				targets: candidates.map((model) => createFitnessTarget(models, model.provider, model.id, "required")),
				authentication: "NOT_CHECKED",
				backendIdentity: "UNKNOWN",
			});
		} else if (command === "run" || command === "faux") {
			if (positional.length !== 1) throw new Error("Choose exactly one Fitness target");
			for (const name of ["--max-fixtures", "--max-worker-calls", "--max-tokens"])
				if (!flags.has(name)) throw new Error("Explicit Fitness budgets required");
			const budget = {
				maxFixtures: Number(flags.get("--max-fixtures")),
				maxWorkerCalls: Number(flags.get("--max-worker-calls")),
				maxTotalTokens: Number(flags.get("--max-tokens")),
				...(flags.has("--max-cost-usd") ? { maxCostUsd: Number(flags.get("--max-cost-usd")) } : {}),
			};
			if (flags.has("--calibration") && (flags.has("--calibration-id") || flags.has("--fixtures")))
				throw new Error("Calibration selection cannot be combined with another fixture selection");
			let agentDir: string;
			let models: ModelRuntime;
			let provider: string;
			let model: string;
			if (command === "faux") {
				if (
					!["GOOD", "CONTRACT_VIOLATOR", "UNRELIABLE", "FALSE_COMPLETER"].includes(positional[0]) ||
					flags.has("--allow-paid") ||
					flags.has("--calibration-id") ||
					flags.has("--calibration")
				)
					throw new Error("Invalid faux Fitness contract");
				tempAgent = realpathSync(mkdtempSync(join(tmpdir(), "weavra-fitness-agent-")));
				agentDir = join(tempAgent, "agent");
				mkdirSync(agentDir, { mode: 0o700 });
				provider = "fitness-faux";
				model = positional[0];
				models = await createFitnessFauxModels(agentDir, model as FitnessFauxBehavior);
			} else {
				if (flags.get("--allow-paid") !== true || flags.get("--confirm-corpus") !== FITNESS_CORPUS_DIGEST)
					throw new Error("Explicit paid opt-in and current corpus confirmation required");
				const split = positional[0].indexOf("/");
				if (split <= 0) throw new Error("Expected provider/model");
				provider = positional[0].slice(0, split);
				model = positional[0].slice(split + 1);
				agentDir = await prepareLaunch(process.env);
				models = await ModelRuntime.create({
					authPath: join(agentDir, "auth.json"),
					modelsPath: join(agentDir, "models.json"),
					modelsStore: new InMemoryModelsStore(),
					allowModelNetwork: false,
					refreshOnCreate: false,
				});
			}
			const store = await FitnessRecordStore.open(directory, { create: true });
			const controller = new AbortController();
			const cancel = () => controller.abort();
			process.once("SIGINT", cancel);
			process.once("SIGTERM", cancel);
			try {
				const result = await runFitnessMatrix({
					target: createFitnessTarget(models, provider, model, "required"),
					models,
					agentDir,
					store,
					budget,
					fixtureIds: flags.has("--calibration")
						? ["F01", "F02"]
						: flags.has("--fixtures")
							? String(flags.get("--fixtures")).split(",")
							: FITNESS_CORPUS.slice(flags.has("--calibration-id") ? 2 : 0).map((fixture) => fixture.id),
					kind: command === "faux" ? "FAUX" : "ACTUAL",
					allowPaid: flags.get("--allow-paid") === true,
					calibration: flags.get("--calibration") === true,
					calibrationRecord: flags.has("--calibration-id")
						? await store.read(String(flags.get("--calibration-id")))
						: undefined,
					sandbox: "required",
					signal: controller.signal,
				});
				output(result);
				if (result.status !== "COMPLETED") process.exitCode = 1;
			} finally {
				process.removeListener("SIGINT", cancel);
				process.removeListener("SIGTERM", cancel);
			}
		} else throw new Error("Unknown Fitness command");
	}
} catch {
	process.stderr.write(
		"Weavra Fitness request failed. Check command syntax, local setup, target and bounded calibration record. No automatic retry or fallback was performed.\n",
	);
	process.exitCode = 1;
} finally {
	if (tempAgent) rmSync(tempAgent, { recursive: true, force: true });
}
