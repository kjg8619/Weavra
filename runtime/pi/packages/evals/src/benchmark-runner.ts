import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	type AgentSession,
	createAgentSessionFromServices,
	createAgentSessionServices,
	type ModelRuntime,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { BudgetController } from "../../company-runtime/src/budget.ts";
import type { Run } from "../../company-runtime/src/contracts.ts";
import { projectEvidencePack } from "../../company-runtime/src/evidence.ts";
import { fitnessDigest } from "../../company-runtime/src/fitness-records.ts";
import { WorkerMeasurementAccumulator } from "../../company-runtime/src/measurement.ts";
import type { AgentExecutionRequest } from "../../company-runtime/src/ports.ts";
import { buildTaskContract, formatAcceptanceCriteria } from "../../company-runtime/src/task-contract.ts";
import {
	BENCHMARK_CORPUS,
	BENCHMARK_CORPUS_REVISION,
	type BenchmarkFixture,
	benchmarkFixtureDigest,
} from "./benchmark-corpus.ts";
import {
	BENCHMARK_ARMS,
	BENCHMARK_FAUX_PROVIDER,
	BENCHMARK_HARNESS_VERSION,
	BENCHMARK_PI_MAX_TURNS,
	BENCHMARK_SCHEMA_VERSION,
	BENCHMARK_WEAVRA_MAX_REVISION_CYCLES,
	type BenchmarkArm,
	type BenchmarkRecord,
	type BenchmarkRun,
	type BenchmarkStages,
	type BenchmarkTerminalStatus,
	freezeBenchmarkRecord,
} from "./benchmark-record.ts";
import { parseFitnessInvestigationAnswer } from "./fitness-corpus.ts";
import {
	auditFitnessWorkspace,
	executeFitnessFixture,
	fitnessConfiguration,
	fitnessGit,
	materializeFitnessWorkspace,
} from "./fitness-runner.ts";
import { isolatedShellCommandPrefix } from "./pi-isolation.ts";

const CHECKOUT = fileURLToPath(new URL("../../../", import.meta.url));
const ORACLE_TIMEOUT_MS = 20_000;

export interface BenchmarkOracleVerdict {
	verdict: "PASS" | "FAIL" | "INVALID";
	failures: string[];
}

/**
 * Hidden Host oracle, identical for every arm. It judges only the final workspace and final answer, never a
 * completion claim. Script oracles run as `node --eval` from the Host after the agent finished, so the oracle
 * source never exists as a file. `baseline` is the arm's materialized workspace (Weavra adds protected control files);
 * `ignoredRoots` are the root directories the arm's runtime owns (Weavra: .ai state and .git; pi: .git only).
 */
export function evaluateBenchmarkOracle(
	entry: BenchmarkFixture,
	workspace: string,
	baseline: Readonly<Record<string, string>>,
	answer: string | null,
	ignoredRoots: readonly string[] = [".ai", ".git"],
): BenchmarkOracleVerdict {
	const failures: string[] = [];
	try {
		const { unexpected, protectedUnchanged } = auditFitnessWorkspace(
			workspace,
			baseline,
			Object.keys(entry.fixture.expectedFiles),
			ignoredRoots,
		);
		if (unexpected.length)
			failures.push(`Unexpected files: ${unexpected.slice(0, 4).join(", ")}${unexpected.length > 4 ? ", ..." : ""}`);
		if (!protectedUnchanged) failures.push("A file outside the task's change set changed or is missing");
		if (entry.oracle.kind === "bytes") {
			for (const [path, expected] of Object.entries(entry.fixture.expectedFiles)) {
				const location = join(workspace, path);
				if (
					lstatSync(location, { throwIfNoEntry: false })?.isFile() !== true ||
					readFileSync(location, "utf8") !== expected
				)
					failures.push(`${path} does not contain the required change`);
			}
		} else {
			const result = spawnSync(process.execPath, ["--input-type=module", "--eval", entry.oracle.source], {
				cwd: workspace,
				stdio: "ignore",
				timeout: ORACLE_TIMEOUT_MS,
				env: { PATH: process.env.PATH ?? "" },
			});
			if (result.error || result.status !== 0) failures.push("Hidden behavioral oracle failed");
		}
		if (entry.answer) {
			const parsed = parseFitnessInvestigationAnswer(answer ?? "");
			if (!parsed || fitnessDigest(parsed) !== fitnessDigest(entry.answer))
				failures.push("Final answer does not state the required facts in the required format");
		}
	} catch {
		return { verdict: "INVALID", failures: ["Hidden oracle could not inspect the final workspace"] };
	}
	return { verdict: failures.length ? "FAIL" : "PASS", failures };
}

/**
 * Exact task text for the pi arm: the same goal, the same Host-numbered acceptance criteria and registered check IDs
 * as the frozen Weavra Task Contract, and the same project instructions Weavra receives as project context.
 */
export function buildPiPrompt(entry: BenchmarkFixture, provider: string, model: string): string {
	const config = fitnessConfiguration(entry.fixture, provider, model, "disabled");
	const contract = buildTaskContract({
		goal: entry.fixture.goal,
		statements: entry.fixture.statements,
		workflow: "STANDARD",
		config,
	});
	const checks = [...new Set(contract.acceptanceCriteria.flatMap((criterion) => criterion.verification.checkIds))];
	const handoff = `${entry.fixture.goal}\n${entry.fixture.instructions}`.includes("submit_handoff");
	return [
		"You are working in a Git repository in the current working directory. Complete the task below, then end your turn with a short final reply.",
		"",
		"Task:",
		entry.fixture.goal,
		"",
		"Acceptance criteria:",
		...formatAcceptanceCriteria(contract),
		"",
		"Project instructions:",
		entry.fixture.instructions,
		"",
		`Registered checks: ${checks.join(", ")}. The evaluation harness runs its own checks after this session ends; no check command is available to you in this session.`,
		...(handoff
			? [
					"This session has no submit_handoff tool: wherever the task or instructions mention the submit_handoff summary, give exactly that content as your entire final reply.",
				]
			: []),
	].join("\n");
}

interface ArmContext {
	provider: string;
	model: string;
	models: ModelRuntime;
	agentDir: string;
	sandbox: "required" | "disabled";
	signal: AbortSignal;
	timeout: AbortSignal;
	onRequest?: (request: AgentExecutionRequest) => void;
	onPiSession?: (observation: PiSessionObservation) => void;
}

export interface PiSessionObservation {
	root: string;
	workspace: string;
	home: string;
	agentDir: string;
	prompt: string;
	session: AgentSession;
}

type ArmOutcome = Omit<
	BenchmarkRun,
	"sequence" | "arm" | "fixtureId" | "fixtureDigest" | "repetition" | "durationMs" | "oraclePass" | "falseCompletion"
>;

function lastAssistantStop(session: AgentSession): string | undefined {
	for (let index = session.messages.length - 1; index >= 0; index--) {
		const message = session.messages[index];
		if (message.role === "assistant") return message.stopReason;
	}
	return undefined;
}

/** Plain Pi SDK session: default coding tools, fresh isolated HOME/agent dir, no extensions, skills or AGENTS files. */
async function runPiArm(entry: BenchmarkFixture, context: ArmContext): Promise<ArmOutcome> {
	const root = realpathSync(mkdtempSync(join(tmpdir(), `weavra-benchmark-pi-${entry.fixture.id}-`)));
	const workspace = join(root, "workspace");
	const home = join(root, "home");
	const agentDir = join(home, ".pi", "agent");
	const measurement = new WorkerMeasurementAccumulator({
		role: "Developer",
		profile: "coding",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		requestedProvider: context.provider,
		requestedModel: context.model,
	});
	let session: AgentSession | undefined;
	let terminalStatus: BenchmarkTerminalStatus = "HARNESS_ERROR";
	let oracle: BenchmarkOracleVerdict = { verdict: "INVALID", failures: ["The pi arm did not reach the oracle"] };
	let toolErrors = 0;
	try {
		mkdirSync(workspace, { mode: 0o700 });
		mkdirSync(agentDir, { recursive: true, mode: 0o700 });
		materializeFitnessWorkspace(workspace, entry.fixture.files, `Benchmark ${entry.fixture.id}`);
		const model = context.models.getModel(context.provider, context.model);
		if (!model) throw new Error("Benchmark model unavailable; no fallback");
		const services = await createAgentSessionServices({
			cwd: workspace,
			agentDir,
			modelRuntime: context.models,
			// Provider-facing settings mirror the Weavra worker session: no automatic retry or compaction.
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: false },
				retry: { enabled: false, provider: { maxRetries: 0 } },
				shellCommandPrefix: isolatedShellCommandPrefix(home),
			}),
			resourceLoaderOptions: {
				noExtensions: true,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
			},
		});
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(workspace),
			model,
		});
		const active = created.session;
		session = active;
		if (
			created.modelFallbackMessage ||
			active.model?.id !== model.id ||
			active.model.provider !== model.provider ||
			active.extensionRunner.getExtensionPaths().length !== 0
		)
			throw new Error("The pi arm must start on the selected model without extensions");
		const prompt = buildPiPrompt(entry, context.provider, context.model);
		context.onPiSession?.({ root, workspace, home, agentDir, prompt, session: active });
		let limit: BenchmarkTerminalStatus | undefined;
		let aborting: Promise<void> | undefined;
		const stop = (reason: BenchmarkTerminalStatus) => {
			limit ??= reason;
			aborting ??= active.abort();
		};
		let turns = 0;
		let reported = 0;
		const unsubscribe = active.subscribe((event) => {
			if (event.type === "tool_execution_end" && event.isError) toolErrors++;
			if (event.type === "turn_start" && ++turns > BENCHMARK_PI_MAX_TURNS) stop("TURN_LIMIT");
			if (event.type === "message_end" && event.message.role === "assistant") {
				measurement.observeAssistant(event.message);
				reported += event.message.usage?.totalTokens ?? 0;
				// Like Weavra's run budget, the ceiling blocks the next model call; a final reply still counts.
				if (reported >= entry.fixture.budget.maxTotalTokens && event.message.stopReason === "toolUse")
					stop("TOKEN_LIMIT");
			}
		});
		const onAbort = () => stop(context.timeout.aborted ? "TIMEOUT" : "CANCELLED");
		context.signal.addEventListener("abort", onAbort, { once: true });
		let threw = false;
		try {
			if (context.signal.aborted) onAbort();
			else await active.prompt(prompt);
		} catch {
			threw = true;
		} finally {
			context.signal.removeEventListener("abort", onAbort);
			unsubscribe();
			await aborting;
		}
		const stopReason = lastAssistantStop(active);
		terminalStatus =
			limit ??
			(threw || stopReason === "error"
				? "ERROR"
				: stopReason === "stop"
					? "STOP"
					: stopReason === "length"
						? "LENGTH"
						: stopReason === "aborted"
							? "ABORTED"
							: "UNKNOWN");
		oracle = evaluateBenchmarkOracle(entry, workspace, entry.fixture.files, active.getLastAssistantText() ?? null, [
			".git",
		]);
	} catch {
		terminalStatus = "HARNESS_ERROR";
		oracle = { verdict: "INVALID", failures: ["The pi arm harness failed before the oracle"] };
	} finally {
		try {
			session?.dispose();
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	}
	const settled = measurement.finish(terminalStatus === "STOP" ? "SUCCEEDED" : "FAILED");
	const known = settled.usage.source === "provider";
	return {
		terminalStatus,
		// A normal assistant stop is the only completion claim a plain Pi session can make.
		claimedCompletion: terminalStatus === "STOP",
		oracle: oracle.verdict,
		oracleFailures: oracle.failures,
		timedOut: context.timeout.aborted,
		modelTurns: settled.modelTurns,
		toolCalls: settled.toolCalls,
		workerInvocations: settled.modelTurns > 0 ? 1 : 0,
		tokens: {
			state: known ? "KNOWN" : "UNKNOWN",
			input: known ? settled.usage.input : null,
			output: known ? settled.usage.output : null,
			total: known ? settled.usage.totalTokens : null,
		},
		// A plain Pi session has no Kernel, review, advisory check or recovery budget.
		stages: {
			toolErrors,
			recoverableToolErrors: null,
			checkRequests: null,
			advisoryCheckRuns: null,
			reviewRevisions: null,
			finalReview: null,
			verificationRepairs: null,
			failureCategory: null,
		},
	};
}

/** Kernel-side stage outcome of a settled Weavra run; the Evidence Pack category explains a non-COMPLETED end. */
function runStages(
	run: Run,
): Pick<BenchmarkStages, "reviewRevisions" | "finalReview" | "verificationRepairs" | "failureCategory"> {
	// The Kernel appends every review, including the current one, to reviewHistory.
	const reviews = run.reviewHistory ?? [];
	return {
		reviewRevisions: reviews.filter((review) => review.result === "REVISE").length,
		finalReview: reviews.at(-1)?.result ?? run.review?.result ?? null,
		verificationRepairs: run.verificationRepair?.attempts.length ?? 0,
		failureCategory:
			run.status === "COMPLETED" ? null : (projectEvidencePack({ run }).failure?.category ?? "UNKNOWN"),
	};
}

/** Existing Weavra STANDARD path through the Fitness executor (real Worker SDK, Policy, Kernel and verifier). */
async function runWeavraArm(entry: BenchmarkFixture, advisory: boolean, context: ArmContext): Promise<ArmOutcome> {
	const observed: { oracle?: BenchmarkOracleVerdict; run?: Run } = {};
	const tools = { errors: 0, recoverable: 0, checkRequests: 0, advisoryRuns: 0 };
	const result = await executeFitnessFixture(
		entry.fixture,
		{
			target: { provider: context.provider, model: context.model },
			models: context.models,
			agentDir: context.agentDir,
			sandbox: context.sandbox,
			signal: context.signal,
			onRequest: context.onRequest,
			advisory,
			maxRevisionCycles: BENCHMARK_WEAVRA_MAX_REVISION_CYCLES,
			observeToolResult: (event) => {
				if (event.isError) tools.errors++;
				if (event.recoverable) tools.recoverable++;
				if (event.name === "runtime_request_check") tools.checkRequests++;
				if (event.advisoryCheck) tools.advisoryRuns++;
			},
			observeWorkspace: ({ workspace, run, baseline }) => {
				observed.run = run;
				observed.oracle = evaluateBenchmarkOracle(
					entry,
					workspace,
					baseline,
					run?.executorResult?.summary ?? run?.handoff?.summary ?? null,
				);
			},
		},
		new BudgetController({
			maxWorkerInvocations: entry.fixture.budget.maxWorkerCalls,
			maxReportedTokens: entry.fixture.budget.maxTotalTokens,
		}),
	);
	const oracle = observed.oracle ?? {
		verdict: "INVALID",
		failures: ["The Weavra arm harness failed before the oracle"],
	};
	const usage = result.efficiency.usage;
	return {
		terminalStatus: result.terminalStatus,
		// Only the Kernel decides completion; COMPLETED is the Weavra completion claim.
		claimedCompletion: result.terminalStatus === "COMPLETED",
		oracle: oracle.verdict,
		oracleFailures: oracle.failures,
		timedOut: context.timeout.aborted,
		modelTurns: result.efficiency.modelTurns,
		toolCalls: result.tools.calls,
		workerInvocations: result.efficiency.workerInvocations,
		tokens: { state: usage.state, input: usage.input, output: usage.output, total: usage.total },
		stages: {
			toolErrors: tools.errors,
			recoverableToolErrors: tools.recoverable,
			checkRequests: tools.checkRequests,
			advisoryCheckRuns: tools.advisoryRuns,
			...(observed.run
				? runStages(observed.run)
				: { reviewRevisions: null, finalReview: null, verificationRepairs: null, failureCategory: "UNOBSERVED" }),
		},
	};
}

export interface BenchmarkRunnerOptions {
	provider: string;
	model: string;
	/** One model runtime shared by every arm: same provider, model and credentials. */
	models: ModelRuntime;
	/** Trusted Weavra worker agent directory; the pi arm always gets a fresh empty one instead. */
	agentDir: string;
	arms: readonly BenchmarkArm[];
	fixtureIds: readonly string[];
	repeat: number;
	wallClockLimitMs: number;
	sandbox: "required" | "disabled";
	signal?: AbortSignal;
	/** Every frozen record, partial and final, so interrupted benchmarks keep their completed runs. */
	onRecord?: (record: BenchmarkRecord) => void | Promise<void>;
	/** Deterministic tests may observe Weavra worker requests; nothing is retained. */
	onRequest?: (request: AgentExecutionRequest) => void;
	/** Deterministic tests may observe the isolated pi session before its prompt. */
	onPiSession?: (observation: PiSessionObservation) => void;
}

function harnessIdentity(): { revision: string; dirty: boolean | null } {
	try {
		const revision = fitnessGit(CHECKOUT, ["rev-parse", "HEAD"]);
		return {
			revision: /^[0-9a-f]{40}$/.test(revision) ? revision : "UNKNOWN",
			dirty: fitnessGit(CHECKOUT, ["status", "--porcelain", "--untracked-files=normal", "--", "."]) !== "",
		};
	} catch {
		return { revision: "UNKNOWN", dirty: null };
	}
}

export async function runBenchmark(options: BenchmarkRunnerOptions): Promise<BenchmarkRecord> {
	const entries = options.fixtureIds.map((id) => {
		const entry = BENCHMARK_CORPUS.find((item) => item.fixture.id === id);
		if (!entry) throw new Error(`Unknown benchmark fixture ${id}`);
		return entry;
	});
	if (
		!entries.length ||
		new Set(options.fixtureIds).size !== entries.length ||
		!options.arms.length ||
		new Set(options.arms).size !== options.arms.length ||
		options.arms.some((arm) => !BENCHMARK_ARMS.includes(arm))
	)
		throw new Error("Invalid benchmark selection");
	const model = options.models.getModel(options.provider, options.model);
	if (!model) throw new Error("Benchmark model unavailable; no fallback");
	const harness = harnessIdentity();
	let record = freezeBenchmarkRecord({
		schemaVersion: BENCHMARK_SCHEMA_VERSION,
		harnessVersion: BENCHMARK_HARNESS_VERSION,
		harnessRevision: harness.revision,
		harnessDirty: harness.dirty,
		id: randomUUID(),
		status: "RUNNING",
		startedAt: Date.now(),
		completedAt: null,
		target: {
			provider: options.provider,
			model: model.id,
			api: model.api,
			faux: options.provider === BENCHMARK_FAUX_PROVIDER,
		},
		settings: {
			arms: [...options.arms],
			repeat: options.repeat,
			wallClockLimitMs: options.wallClockLimitMs,
			sandbox: options.sandbox,
			piMaxTurns: BENCHMARK_PI_MAX_TURNS,
			piMaxReportedTokens: Math.max(...entries.map((entry) => entry.fixture.budget.maxTotalTokens)),
			weavraMaxRevisionCycles: BENCHMARK_WEAVRA_MAX_REVISION_CYCLES,
		},
		corpus: {
			revision: BENCHMARK_CORPUS_REVISION,
			digest: fitnessDigest(BENCHMARK_CORPUS.map(benchmarkFixtureDigest)),
		},
		fixtures: entries.map((entry) => ({
			id: entry.fixture.id,
			digest: benchmarkFixtureDigest(entry),
			source: entry.source,
			sourceDigest: entry.sourceDigest,
			oracle: entry.oracle.kind,
		})),
		runs: [],
		environment: { platform: process.platform, arch: process.arch, node: process.version },
	});
	await options.onRecord?.(record);
	// Arm order rotates per fixture and repetition so no arm systematically runs first against a provider.
	const plan = Array.from({ length: options.repeat }, (_, index) => index + 1).flatMap((repetition) =>
		entries.flatMap((entry, index) => {
			const offset = (index + repetition - 1) % options.arms.length;
			return [...options.arms.slice(offset), ...options.arms.slice(0, offset)].map((arm) => ({
				arm,
				entry,
				repetition,
			}));
		}),
	);
	let status: BenchmarkRecord["status"] = "COMPLETED";
	try {
		for (const step of plan) {
			if (options.signal?.aborted) break;
			const timeout = AbortSignal.timeout(options.wallClockLimitMs);
			const context: ArmContext = {
				provider: options.provider,
				model: options.model,
				models: options.models,
				agentDir: options.agentDir,
				sandbox: options.sandbox,
				signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
				timeout,
				onRequest: options.onRequest,
				onPiSession: options.onPiSession,
			};
			const startedAt = Date.now();
			const outcome =
				step.arm === "pi"
					? await runPiArm(step.entry, context)
					: await runWeavraArm(step.entry, step.arm === "weavra-advisory", context);
			const run: BenchmarkRun = {
				sequence: record.runs.length,
				arm: step.arm,
				fixtureId: step.entry.fixture.id,
				fixtureDigest: benchmarkFixtureDigest(step.entry),
				repetition: step.repetition,
				...outcome,
				oracleFailures: outcome.oracleFailures.slice(0, 8).map((failure) => failure.slice(0, 240)),
				oraclePass: outcome.oracle === "PASS",
				falseCompletion:
					outcome.oracle === "INVALID" ? null : outcome.claimedCompletion && outcome.oracle === "FAIL",
				durationMs: Math.max(0, Date.now() - startedAt),
			};
			record = freezeBenchmarkRecord({ ...record, runs: [...record.runs, run] });
			await options.onRecord?.(record);
		}
	} catch {
		status = "FAILED";
	}
	if (status === "COMPLETED" && options.signal?.aborted) status = "CANCELLED";
	record = freezeBenchmarkRecord({ ...record, status, completedAt: Date.now() });
	await options.onRecord?.(record);
	return record;
}
