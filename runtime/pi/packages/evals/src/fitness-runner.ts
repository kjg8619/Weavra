import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { type FitnessWorkerObserver, PiAgentExecutor } from "../../company-runtime/src/agent-runner.ts";
import { fileDigest } from "../../company-runtime/src/anchored-edit.ts";
import { BudgetController, BudgetDenied } from "../../company-runtime/src/budget.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../../company-runtime/src/config.ts";
import { taskContractDigest } from "../../company-runtime/src/criterion-evidence.ts";
import {
	type FitnessRecordStore,
	fitnessCalibrationState,
	fitnessDigest,
	fitnessEvaluationState,
	fitnessIntegrityReasons,
	freezeFitnessRecord,
	passesFitnessCalibrationFixture,
	safeEndpointIdentity,
	validateFitnessRecord,
} from "../../company-runtime/src/fitness-records.ts";
import {
	type FitnessBudget,
	FitnessBudgetSchema,
	type FitnessFixtureResult,
	type ProviderFitnessRun,
	type ProviderTarget,
	ProviderTargetSchema,
} from "../../company-runtime/src/fitness-types.ts";
import { applyHostWorkflowRecipe, prepareHostWorkflowDraft } from "../../company-runtime/src/host-workflow.ts";
import { WorkerExecutionError, type WorkerMeasurement } from "../../company-runtime/src/measurement.ts";
import type { AgentExecutionRequest, AgentExecutionResult, AgentExecutor } from "../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../company-runtime/src/state-store.ts";
import { buildTaskContract } from "../../company-runtime/src/task-contract.ts";
import { StandardWorkflow } from "../../company-runtime/src/workflow.ts";
import {
	evaluateFitnessOracle,
	FITNESS_CORPUS,
	FITNESS_CORPUS_DIGEST,
	FITNESS_CORPUS_REVISION,
	type FitnessFixture,
	parseFitnessInvestigationAnswer,
} from "./fitness-corpus.ts";

/** Runtime workspace digests use bare SHA-256; record digests name the algorithm. */
function observedDigest(value: string | undefined): string | null {
	const match = value?.match(/^(?:sha256:)?([0-9a-f]{64})$/);
	return match ? `sha256:${match[1]}` : null;
}

const CHECKOUT = fileURLToPath(new URL("../../../", import.meta.url));
const PRIVATE_MARKER = "FITNESS_PRIVATE_BOUNDARY_SENTINEL\n";
const DOC = "label 1.2.3 trims boundary whitespace and preserves letter case.";

function git(cwd: string, args: string[]): string {
	return execFileSync(
		"git",
		[
			"-c",
			"core.hooksPath=/dev/null",
			"-c",
			"core.fsmonitor=false",
			"-c",
			"commit.gpgsign=false",
			"-c",
			"user.name=Fitness",
			"-c",
			"user.email=fitness@invalid",
			...args,
		],
		{
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			env: {
				PATH: process.env.PATH ?? "",
				HOME: cwd,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_OPTIONAL_LOCKS: "0",
			},
		},
	).trim();
}

export function fitnessConfiguration(
	fixture: FitnessFixture,
	provider: string,
	model: string,
	sandbox: "required" | "disabled",
): RuntimeConfig {
	return parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: { profiles: { coding: { provider, model }, reasoning: { provider, model } } },
			runtime: { workflow: fixture.workflow },
			files: { allowed_paths: fixture.allowedPaths },
			mutation: { mode: "strict" },
			project: { instructions: { path: "fixture-context.txt" } },
			agents: {
				max_revision_cycles: 0,
				worker_timeout_ms: fixture.budget.workerTimeoutMs,
				context_pack: { mode: "bounded" },
			},
			budget: {
				max_worker_invocations: fixture.budget.maxWorkerCalls,
				max_reported_tokens: fixture.budget.maxTotalTokens,
			},
			review: {
				context: {
					impact: "bounded",
					...(fixture.category === "documentation"
						? {
								documentation: {
									mode: "bounded",
									manifest: "package.json",
									requested: ["label"],
									entries: [
										{
											id: "label-1.2.3",
											source: { kind: "reviewed-local", reference: "local:label-1.2.3" },
											component: "label",
											version: "1.2.3",
											capturedAt: "2026-01-01T00:00:00.000Z",
											digest: fileDigest(DOC),
											reviewStatus: "REVIEWED",
											content: DOC,
										},
									],
								},
							}
						: {}),
				},
			},
			verification: {
				trust: { mode: "strict" },
				sandbox: { mode: sandbox },
				repair: { mode: fixture.category === "repair" ? "self-check-once" : "disabled" },
				checks: [
					{
						id: "regression",
						kind: "test",
						executable: process.execPath,
						args: ["oracle/check.mjs"],
						timeout_ms: 10000,
						required: true,
						trust: { files: ["oracle/check.mjs"] },
						repairable_exit_codes: fixture.category === "repair" ? [7] : [],
					},
				],
			},
		}),
	);
}

/** Model identity is separate from the frozen execution configuration used for paired comparison. */
export function fitnessConfigDigest(config: RuntimeConfig): string {
	const { models: _models, ...execution } = config;
	return fitnessDigest(execution);
}

export function createFitnessTarget(
	models: ModelRuntime,
	provider: string,
	modelId: string,
	sandbox: "required" | "disabled",
): ProviderTarget {
	const model = models.getModel(provider, modelId);
	if (!model) throw new Error("Fitness model unavailable; no fallback");
	const sourceDigest = (paths: string[]) =>
		fitnessDigest(paths.map((path) => ({ path, digest: fileDigest(readFileSync(join(CHECKOUT, path), "utf8")) })));
	const target: ProviderTarget = {
		provider,
		model: model.id,
		api: model.api,
		endpointIdentity: safeEndpointIdentity(model.baseUrl),
		harnessRevision: git(CHECKOUT, ["rev-parse", "HEAD"]),
		toolSchemaRevision: sourceDigest([
			"packages/company-runtime/src/agent-tools.ts",
			"packages/company-runtime/src/anchored-edit.ts",
			"packages/company-runtime/src/contracts.ts",
			"packages/company-runtime/src/list-files-tool.ts",
			"packages/company-runtime/src/lsp/tools.ts",
		]),
		promptRuntimeRevision: sourceDigest([
			"packages/company-runtime/src/agent-runner.ts",
			"packages/company-runtime/src/kernel.ts",
			"packages/company-runtime/src/workflow.ts",
			"packages/company-runtime/src/task-context.ts",
			"packages/company-runtime/src/reviewer-context.ts",
			"packages/evals/src/fitness-runner.ts",
			"packages/evals/src/fitness-corpus.ts",
			"package-lock.json",
		]),
		configurationDigest: fitnessDigest(
			FITNESS_CORPUS.map((fixture) =>
				fitnessConfigDigest(fitnessConfiguration(fixture, provider, modelId, sandbox)),
			),
		),
	};
	if (!Check(ProviderTargetSchema, target)) throw new Error("Unsafe Fitness target identity");
	return target;
}

export interface FitnessRunnerOptions {
	target: ProviderTarget;
	models: ModelRuntime;
	agentDir: string;
	store: FitnessRecordStore;
	budget: FitnessBudget;
	fixtureIds: string[];
	kind: "ACTUAL" | "FAUX";
	/** Actual execution is explicit; API callers cannot bypass the CLI opt-in by omission. */
	allowPaid?: boolean;
	calibration?: boolean;
	calibrationRecord?: ProviderFitnessRun;
	sandbox: "required" | "disabled";
	signal?: AbortSignal;
	/** Deterministic SDK tests may observe requests; no payload is retained by the runner. */
	onRequest?: (request: AgentExecutionRequest) => void;
}

async function executeFixture(
	fixture: FitnessFixture,
	options: FitnessRunnerOptions,
	budget: BudgetController,
): Promise<FitnessFixtureResult> {
	const startedAt = Date.now();
	const root = realpathSync(mkdtempSync(join(tmpdir(), `weavra-fitness-${fixture.id}-`)));
	const cwd = join(root, "workspace");
	const config = fitnessConfiguration(fixture, options.target.provider, options.target.model, options.sandbox);
	const configurationDigest = fitnessConfigDigest(config);
	const measurements: WorkerMeasurement[] = [];
	let invocations = 0;
	let providerActive = false;
	let cleanup = true;
	let workspaceReady = false;
	let contextBytes = 0;
	let invalidCalls = 0;
	let protocolErrors = 0;
	let receiptRejections = 0;
	let handoffRejections = 0;
	let reviewRejections = 0;
	let forbiddenAttempts = 0;
	let scopeViolations = 0;
	let retries = 0;
	let providerErrors = 0;
	let authErrors = 0;
	let transportErrors: number | null = null;
	let timeouts = 0;
	let workflow: StandardWorkflow | undefined;
	let sdk: PiAgentExecutor | undefined;
	let taskDigest: string | null = null;
	let observedResult: FitnessFixtureResult | undefined;
	const retryable = new Set<string>();
	const observer: FitnessWorkerObserver = {
		providerActivity: () => {
			providerActive = true;
			if (fixture.category === "cancellation") workflow?.cancel();
		},
		protocolError: () => {
			protocolErrors++;
		},
		context: (bytes) => {
			contextBytes += bytes;
		},
		providerError: (kind) => {
			if (kind === "AUTH") authErrors++;
			else if (kind === "TIMEOUT") timeouts++;
			else if (kind === "TRANSPORT") transportErrors = (transportErrors ?? 0) + 1;
			else providerErrors++;
		},
		toolResult: (event) => {
			if (retryable.delete(event.name)) retries++;
			if (event.isError) invalidCalls++;
			if (event.staleReceipt) receiptRejections++;
			if (event.submissionRejected && event.name === "submit_handoff") handoffRejections++;
			if (event.submissionRejected && event.name === "submit_review") reviewRejections++;
			if (event.staleReceipt || event.submissionRejected) retryable.add(event.name);
			if (event.policyDenied && ["runtime_edit", "runtime_write", "runtime_delete"].includes(event.name))
				forbiddenAttempts++;
		},
	};
	const base = (): FitnessFixtureResult => ({
		fixtureId: fixture.id,
		fixtureDigest: fitnessDigest(fixture),
		runId: null,
		taskContractDigest: taskDigest,
		registeredCheckDigest: fitnessDigest({
			checks: config.verification.checks,
			source: fileDigest(fixture.checkSource),
		}),
		configurationDigest,
		terminalStatus: invocations > 0 ? "UNKNOWN" : "NOT_STARTED",
		oracle: "INVALID",
		falseCompletion: null,
		audit: {
			files: Object.entries(fixture.files).map(([path, text]) => ({
				path,
				initialDigest: fileDigest(text),
				finalDigest: null,
				state: "UNAVAILABLE",
			})),
			unexpectedFileCount: null,
			unexpectedFilesDigest: null,
			workspaceDiffDigest: null,
			protectedUnchanged: null,
			taskContractMatches: null,
			submissionKind: "NONE",
			submissionDigest: null,
			summaryDigest: null,
			submittedCriteria: [],
			unknownCriterionCount: 0,
			acceptance: [],
			reviewer: null,
			knownRisksCount: null,
			unresolvedCount: null,
			changedFilesMatch: null,
			phase: null,
			answer: null,
			checks: [],
			harnessError: false,
		},
		latencyMs: Math.max(0, Date.now() - startedAt),
		ac: { met: null, notMet: null },
		checks: { passed: 0, failed: 0, notRun: 2 },
		contract: {
			scopeViolations,
			forbiddenMutationAttempts: forbiddenAttempts,
			taskContractAdherence: null,
			strictReceiptRejections: receiptRejections,
			handoffRejections,
			reviewRejections,
		},
		tools: {
			calls: 0,
			invalidCalls,
			protocolErrors,
			retries,
			runtimeRead: 0,
			runtimeEdit: 0,
			runtimeWrite: 0,
			lsp: 0,
		},
		reliability: {
			providerErrors,
			authErrors,
			transportErrors,
			timeouts,
			cancellation: fixture.category === "cancellation" ? "NOT_REACHED" : "NOT_REQUESTED",
			repairCount: 0,
			reviewerRevisionCount: 0,
			cleanup: cleanup ? "CONFIRMED" : "UNCONFIRMED",
		},
		efficiency: {
			usage: { state: "UNKNOWN", input: null, output: null, total: null, knownTotal: 0 },
			workerInvocations: invocations,
			modelTurns: 0,
			httpAttempts: null,
			contextBytes,
			costUsd: null,
		},
		evidenceDigest: fitnessDigest({ fixture: fixture.id, stage: "preflight" }),
	});
	function settleMetrics(result: FitnessFixtureResult): FitnessFixtureResult {
		const count = (name: string) => measurements.reduce((sum, item) => sum + (item.toolCallsByName[name] ?? 0), 0);
		result.tools.calls = measurements.reduce((sum, item) => sum + item.toolCalls, 0);
		result.tools.runtimeRead = count("runtime_read");
		result.tools.runtimeEdit = count("runtime_edit");
		result.tools.runtimeWrite = count("runtime_write");
		result.tools.lsp = [
			"runtime_lsp_diagnostics",
			"runtime_lsp_definition",
			"runtime_lsp_references",
			"runtime_lsp_symbols",
		].reduce((sum, name) => sum + count(name), 0);
		const known =
			measurements.length === invocations &&
			invocations > 0 &&
			measurements.every((item) => item.usage.source === "provider");
		const cacheRead = measurements.reduce((sum, item) => sum + item.usage.cacheRead, 0);
		const cacheWrite = measurements.reduce((sum, item) => sum + item.usage.cacheWrite, 0);
		const reasoning = measurements.every((item) => item.usage.reasoning !== undefined)
			? measurements.reduce((sum, item) => sum + (item.usage.reasoning ?? 0), 0)
			: null;
		const total = measurements.reduce((sum, item) => sum + item.usage.totalTokens, 0);
		result.efficiency.usage = {
			state: known ? "KNOWN" : "UNKNOWN",
			input: known ? measurements.reduce((sum, item) => sum + item.usage.input, 0) : null,
			output: known ? measurements.reduce((sum, item) => sum + item.usage.output, 0) : null,
			total: known ? total : null,
			knownTotal: total,
			// SDK normalization loses absent-versus-zero detail provenance. Preserve positive
			// observations, but do not promote initialized zeros to measured upstream zeros.
			cacheRead: known && cacheRead > 0 ? cacheRead : null,
			cacheWrite: known && cacheWrite > 0 ? cacheWrite : null,
			reasoning: known && reasoning !== null && reasoning > 0 ? reasoning : null,
			detailSource: "SDK_NORMALIZED",
		};
		result.efficiency.modelTurns = measurements.reduce((sum, item) => sum + item.modelTurns, 0);
		const reasons = fitnessIntegrityReasons(result);
		result.integrity = { state: reasons.length ? "INVALID" : "READY", reasons };
		result.evidenceDigest = fitnessDigest({
			runId: result.runId,
			contract: result.taskContractDigest,
			oracle: result.oracle,
			audit: result.audit,
			integrity: result.integrity,
		});
		return result;
	}
	try {
		mkdirSync(join(cwd, ".ai"), { recursive: true, mode: 0o700 });
		const baseline = {
			...fixture.files,
			"oracle/check.mjs": fixture.checkSource,
			"fixture-context.txt": fixture.instructions,
			"private/marker.txt": PRIVATE_MARKER,
			".ai/config.yaml": JSON.stringify(config),
		};
		for (const [path, content] of Object.entries(baseline)) {
			mkdirSync(dirname(join(cwd, path)), { recursive: true, mode: 0o700 });
			writeFileSync(join(cwd, path), content, { mode: 0o600, flag: "wx" });
		}
		git(cwd, ["init", "-q"]);
		git(cwd, ["add", "--", ...Object.keys(baseline)]);
		git(cwd, ["commit", "-qm", `Fitness ${FITNESS_CORPUS_REVISION} ${fixture.id}`]);
		workspaceReady = true;
		let draft = prepareHostWorkflowDraft({ goal: fixture.goal, config });
		if (fixture.category === "recipe")
			draft = applyHostWorkflowRecipe(draft, {
				recipeId: "bugfix",
				inputs: {
					reproduction: "formatLabel returns untrimmed or blank input",
					expected: "trim whitespace and return Unnamed for blank input",
					preserve: "letter case and exported function API",
					regression: "registered protected regression check",
				},
			});
		const task = buildTaskContract({
			goal: fixture.goal,
			statements: fixture.statements,
			workflow: draft.workflow,
			config,
			taskId: `fitness-${FITNESS_CORPUS_REVISION}-${fixture.id}`,
		});
		taskDigest = taskContractDigest(task);
		workflow = new StandardWorkflow({
			cwd,
			goal: fixture.goal,
			taskContract: task,
			executionMode: draft.executionMode,
			config,
			recipe: draft.recipe,
			signal: options.signal,
			createAgents: async (store, quickScope, r2RunId, r3Scope, executionContract) => {
				sdk = await PiAgentExecutor.create({
					cwd,
					config,
					agentDir: options.agentDir,
					modelRuntime: options.models,
					audit: store,
					executionContract,
					quickScope,
					r2RunId,
					r3Scope,
					sessionPersistence: "memory",
					fitnessObserver: observer,
					maxTurns: 16,
				});
				const executor = sdk;
				const guarded: AgentExecutor = {
					get safeToRelease() {
						return executor.safeToRelease;
					},
					async execute(request): Promise<AgentExecutionResult> {
						budget.reserve(request.role);
						invocations++;
						retryable.clear();
						let measurement: WorkerMeasurement | undefined;
						try {
							options.onRequest?.(request);
							const result = await executor.execute(request);
							measurement = result.measurement;
							return result;
						} catch (error) {
							if (error instanceof WorkerExecutionError) measurement = error.measurement;
							throw error;
						} finally {
							if (measurement) {
								measurements.push(measurement);
								budget.record(request.role, measurement);
							} else budget.recordUnavailable();
						}
					},
				};
				return { executor: guarded, policy: executor.policyContext };
			},
		});
		const report = await workflow.execute();
		const snapshot = await FileStateStore.readSnapshot(cwd);
		const run = snapshot.state?.runs.at(-1);
		cleanup = sdk?.safeToRelease !== false && !snapshot.writerPresent;
		const result = base();
		observedResult = result;
		result.runId = run?.runId ?? null;
		result.taskContractDigest = run?.taskContractDigest ?? taskDigest;
		result.terminalStatus =
			run && ["COMPLETED", "BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(run.status)
				? (run.status as FitnessFixtureResult["terminalStatus"])
				: invocations > 0
					? "UNKNOWN"
					: "NOT_STARTED";
		const audit = result.audit!;
		audit.phase = run?.phase ?? null;
		audit.workspaceDiffDigest = observedDigest(run?.workspace?.diffDigest);
		audit.taskContractMatches = run ? run.taskContractDigest === taskDigest : null;
		const submission = run?.executorResult ?? run?.handoff;
		audit.submissionKind = run?.executorResult ? "EXECUTOR" : run?.handoff ? "HANDOFF" : "NONE";
		audit.submissionDigest = submission ? fitnessDigest(submission) : null;
		audit.summaryDigest = submission ? fitnessDigest(submission.summary) : null;
		audit.answer =
			submission && (fixture.category === "investigation" || fixture.category === "authority")
				? parseFitnessInvestigationAnswer(submission.summary)
				: null;
		audit.knownRisksCount = submission?.known_risks.length ?? null;
		audit.unresolvedCount = submission?.unresolved.length ?? null;
		audit.changedFilesMatch =
			submission && run?.workspace
				? fitnessDigest([...submission.changed_files].sort()) ===
					fitnessDigest([...run.workspace.changedFiles].sort())
				: null;
		const criterionIds = new Set(task.acceptanceCriteria.map((item) => item.id));
		if (submission && "criteria" in submission) {
			audit.submittedCriteria = submission.criteria
				.filter((item) => criterionIds.has(item.criterionId))
				.map((item) => ({ id: item.criterionId, status: item.status }));
			audit.unknownCriterionCount = submission.criteria.length - audit.submittedCriteria.length;
		}
		audit.acceptance = (run?.acceptance ?? [])
			.filter((item) => criterionIds.has(item.criterionId))
			.map((item) => ({ id: item.criterionId, status: item.status }));
		audit.reviewer = run?.review?.result ?? null;
		result.ac = run?.acceptance
			? {
					met: run.acceptance.filter((item) => item.status === "MET").length,
					notMet: run.acceptance.filter((item) => item.status !== "MET").length,
				}
			: { met: null, notMet: null };
		const checks = run?.verification ?? [];
		result.checks = {
			passed: checks.filter((item) => item.status === "PASS").length,
			failed: checks.filter((item) => item.status === "FAIL").length,
			notRun: Math.max(0, 2 - checks.filter((item) => item.status === "PASS" || item.status === "FAIL").length),
		};
		audit.checks = checks.map((item) => ({
			id: item.id,
			status: item.status,
			stage: item.step?.stepId ?? null,
			diffDigest: observedDigest(item.diffDigest),
			registrationDigest: item.trust?.registrationDigest ?? null,
		}));
		audit.harnessError = checks.some(
			(item) =>
				item.status === "UNAVAILABLE" || item.status === "SKIPPED" || observedDigest(item.diffDigest) === null,
		);
		result.reliability.repairCount = run?.verificationRepair?.attempts.length ?? 0;
		result.reliability.reviewerRevisionCount =
			run?.reviewHistory?.filter((item) => item.result === "REVISE").length ?? 0;
		result.reliability.cancellation =
			fixture.category !== "cancellation"
				? "NOT_REQUESTED"
				: !providerActive
					? "NOT_REACHED"
					: run?.status === "CANCELLED" && cleanup
						? "CANCELLED"
						: "FAILED";
		for (const file of audit.files) {
			const path = join(cwd, file.path);
			const stat = lstatSync(path, { throwIfNoEntry: false });
			file.state = !stat ? "MISSING" : stat.isFile() ? "PRESENT" : "NON_REGULAR";
			file.finalDigest = stat?.isFile()
				? `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
				: null;
		}
		const unexpected: string[] = [];
		const directories = [""];
		while (directories.length) {
			const directory = directories.pop()!;
			for (const entry of readdirSync(join(cwd, directory), { withFileTypes: true })) {
				if (!directory && (entry.name === ".ai" || entry.name === ".git")) continue;
				const path = directory ? `${directory}/${entry.name}` : entry.name;
				if (entry.isDirectory()) directories.push(path);
				else if (!entry.isFile() || !Object.hasOwn(baseline, path)) unexpected.push(path);
			}
		}
		audit.unexpectedFileCount = unexpected.length;
		audit.unexpectedFilesDigest = fitnessDigest(unexpected.sort());
		const protectedUnchanged = Object.entries(baseline)
			.filter(([path]) => !Object.hasOwn(fixture.expectedFiles, path))
			.every(([path, text]) => {
				const location = join(cwd, path);
				return (
					lstatSync(location, { throwIfNoEntry: false })?.isFile() === true &&
					readFileSync(location).equals(Buffer.from(text, "utf8"))
				);
			});
		audit.protectedUnchanged = protectedUnchanged;
		scopeViolations = report.changedFiles.filter(
			(path) => !fixture.allowedPaths.some((allowed) => path === allowed || path.startsWith(`${allowed}/`)),
		).length;
		result.contract.scopeViolations = scopeViolations;
		let oracle = evaluateFitnessOracle(fixture, cwd, run, cleanup, {
			providerActive,
			forbiddenAttempts,
			baselinePaths: Object.keys(baseline),
		});
		if (oracle !== "INVALID" && (!protectedUnchanged || scopeViolations > 0)) oracle = "FAIL";
		if (
			run?.status !== "COMPLETED" &&
			(audit.harnessError ||
				invocations === 0 ||
				providerErrors + authErrors + timeouts + (transportErrors ?? 0) > 0)
		)
			oracle = "INVALID";
		result.oracle = oracle;
		result.falseCompletion = oracle === "INVALID" ? null : result.terminalStatus === "COMPLETED" && oracle === "FAIL";
		result.contract.taskContractAdherence = !run
			? null
			: !audit.taskContractMatches ||
					!protectedUnchanged ||
					scopeViolations > 0 ||
					forbiddenAttempts > 0 ||
					audit.changedFilesMatch === false ||
					(audit.unresolvedCount ?? 0) > 0 ||
					(run.quickScope?.risk === "R1" && (audit.knownRisksCount ?? 0) > 0) ||
					audit.submittedCriteria.some((item) => item.status !== "MET") ||
					(!submission && handoffRejections > 0)
				? false
				: run.acceptance
					? run.acceptance.every((item) => item.status === "MET")
					: null;
	} catch {
		cleanup = sdk?.safeToRelease !== false && (!workspaceReady || !existsSync(join(cwd, ".ai/writer.lock")));
		const result = observedResult ?? base();
		result.audit!.harnessError = true;
		result.oracle = "INVALID";
		result.falseCompletion = null;
		result.reliability.cleanup = cleanup ? "CONFIRMED" : "UNCONFIRMED";
		observedResult = result;
	} finally {
		// Never destroy a workspace while a retained writer/resource may still own it.
		if (cleanup && !existsSync(join(cwd, ".ai/writer.lock"))) {
			try {
				rmSync(root, { recursive: true, force: true });
			} catch {
				observedResult ??= base();
				observedResult.audit!.harnessError = true;
				observedResult.reliability.cleanup = "UNCONFIRMED";
				observedResult.oracle = "INVALID";
				observedResult.falseCompletion = null;
			}
		}
	}
	return settleMetrics(observedResult ?? base());
}

export async function runFitnessMatrix(options: FitnessRunnerOptions): Promise<ProviderFitnessRun> {
	if (!Check(FitnessBudgetSchema, options.budget) || !Check(ProviderTargetSchema, options.target))
		throw new Error("Invalid Fitness run contract");
	const currentTarget = createFitnessTarget(
		options.models,
		options.target.provider,
		options.target.model,
		options.sandbox,
	);
	if (fitnessDigest(currentTarget) !== fitnessDigest(options.target))
		throw new Error("Fitness target changed before execution");
	if (options.kind === "FAUX" && !options.target.api.startsWith("faux:"))
		throw new Error("FAUX runs require a local faux transport");
	if (
		!options.fixtureIds.length ||
		options.fixtureIds.length > 64 ||
		new Set(options.fixtureIds).size !== options.fixtureIds.length
	)
		throw new Error("Invalid Fitness fixture selection");
	const fixtures = options.fixtureIds.map((id) => {
		const fixture = FITNESS_CORPUS.find((item) => item.id === id);
		if (!fixture) throw new Error("Unknown Fitness fixture");
		return fixture;
	});
	if (options.kind === "ACTUAL") {
		if (!options.allowPaid || options.sandbox !== "required")
			throw new Error("Actual Fitness needs explicit paid opt-in and required verifier sandbox");
		if (git(CHECKOUT, ["status", "--porcelain", "--untracked-files=normal"]))
			throw new Error("Actual Fitness requires a clean committed harness");
		if (options.calibration) {
			if (options.fixtureIds.join(",") !== "F01,F02" || options.budget.maxFixtures !== 2)
				throw new Error("Calibration is exactly F01,F02");
		} else if (options.calibrationRecord) {
			const prior = validateFitnessRecord(options.calibrationRecord);
			if (
				prior.schemaVersion !== 2 ||
				prior.kind !== "ACTUAL" ||
				prior.status !== "COMPLETED" ||
				prior.calibration !== "CALIBRATION_READY" ||
				prior.corpusDigest !== FITNESS_CORPUS_DIGEST ||
				fitnessDigest(prior.target) !== fitnessDigest(options.target) ||
				prior.plannedFixtures.join(",") !== "F01,F02" ||
				prior.fixtures.length !== 2 ||
				prior.fixtures.some((item) => !passesFitnessCalibrationFixture(item)) ||
				options.fixtureIds.join(",") !==
					FITNESS_CORPUS.slice(2)
						.map((item) => item.id)
						.join(",")
			)
				throw new Error("Exact-target v2 integrity calibration required for a separate remaining-fixture cohort");
		} else if (options.fixtureIds.join(",") !== FITNESS_CORPUS.map((item) => item.id).join(",")) {
			throw new Error("Fresh actual evaluation requires the complete ordered corpus, including F01/F02");
		}
	}
	const ledger = new BudgetController({
		maxWorkerInvocations: options.budget.maxWorkerCalls,
		maxReportedTokens: options.budget.maxTotalTokens,
	});
	let record = freezeFitnessRecord({
		schemaVersion: 2,
		id: randomUUID(),
		corpusRevision: FITNESS_CORPUS_REVISION,
		corpusDigest: FITNESS_CORPUS_DIGEST,
		target: options.target,
		kind: options.kind,
		startedAt: Date.now(),
		completedAt: null,
		status: "RUNNING",
		calibration: "PENDING",
		evaluation: "EVALUATION_PARTIAL",
		stopReasons: [],
		budget: options.budget,
		plannedFixtures: options.fixtureIds,
		fixtures: [],
		environment: { platform: process.platform, arch: process.arch, node: process.version },
	});
	await options.store.save(record);
	let status: ProviderFitnessRun["status"] = "COMPLETED";
	let matrixDefect = false;
	try {
		for (const fixture of fixtures) {
			if (options.signal?.aborted) {
				status = "CANCELLED";
				break;
			}
			// Cost is UNKNOWN: a requested monetary ceiling cannot be proven safe, so admit no call.
			if (
				options.budget.maxCostUsd !== undefined ||
				record.fixtures.length >= options.budget.maxFixtures ||
				ledger.status.exceeded ||
				ledger.status.workerInvocations >= options.budget.maxWorkerCalls ||
				ledger.status.reportedTokens === null ||
				(ledger.status.reportedTokens ?? 0) >= options.budget.maxTotalTokens
			) {
				status = "BUDGET_EXHAUSTED";
				break;
			}
			const result = await executeFixture(fixture, options, ledger);
			const collected = [...record.fixtures, result];
			record = freezeFitnessRecord({
				...record,
				fixtures: collected,
				calibration: fitnessCalibrationState(collected),
				stopReasons: [...new Set(collected.flatMap((item) => item.integrity!.reasons))],
			});
			await options.store.save(record);
			if (!passesFitnessCalibrationFixture(result)) {
				status =
					result.reliability.cleanup === "UNCONFIRMED"
						? "FAILED"
						: result.efficiency.usage.state === "UNKNOWN"
							? "BUDGET_EXHAUSTED"
							: options.calibration
								? "CALIBRATION_FAILED"
								: "FAILED";
				break;
			}
			if (options.signal?.aborted) {
				status = "CANCELLED";
				break;
			}
			if (ledger.status.exceeded) {
				status = "BUDGET_EXHAUSTED";
				break;
			}
		}
	} catch (error) {
		status = error instanceof BudgetDenied ? "BUDGET_EXHAUSTED" : "FAILED";
		matrixDefect = !(error instanceof BudgetDenied);
	}
	const settled = {
		...record,
		status,
		completedAt: Date.now(),
		stopReasons: [...new Set([...(record.stopReasons ?? []), ...(matrixDefect ? ["HARNESS_DEFECT" as const] : [])])],
	};
	record = freezeFitnessRecord({ ...settled, evaluation: fitnessEvaluationState(settled) });
	await options.store.save(record);
	return record;
}
