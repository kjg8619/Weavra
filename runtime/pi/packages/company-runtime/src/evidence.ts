import type { BrowserVerificationEvidence } from "./browser-types.ts";
import { activeTaskIdsOf, complexBudget, complexWaves, planMaxParallel } from "./complex-state.ts";
import type {
	CheckGate,
	CleanupStatus,
	ComplexEvidenceContext,
	ComplexExecution,
	ComplexFailureCode,
	ComplexPhase,
	ComplexTaskStatus,
	EvidenceFreshness,
	OwnershipOperation,
	ReviewGate,
} from "./complex-types.ts";
import { isCriteriaReview, isTaskContract, type Run } from "./contracts.ts";
import type { WorkerMeasurement } from "./measurement-types.ts";
import type { ModelIntent } from "./model-routing.ts";
import { displayText, formatModelRoutes } from "./observations.ts";

/**
 * Read-only projection of durable Run state plus the live workflow report. It is never an execution authority,
 * never mutates state and never contains prompts, completions, reasoning text, tool arguments or credentials.
 */
export const EVIDENCE_PACK_VERSION = 1;

export type EvidenceFailureCategory =
	| "PREFLIGHT"
	| "POLICY"
	| "PROVIDER"
	| "TOOL"
	| "BUDGET"
	| "VERIFICATION"
	| "REVIEW"
	| "APPROVAL"
	| "STORAGE"
	| "CLEANUP"
	| "CANCELLED"
	| "UNKNOWN";

export interface EvidencePackInput {
	run: Run;
	report?: {
		changedFiles: string[];
		partialChanges: boolean;
		changesUnknown: boolean;
		error?: string;
	};
}

/**
 * Bounded allowlisted COMPLEX summary (§12), derived from canonical Run data only: frozen identities and digests,
 * ordered task statuses/claims/dependencies, attempt and revision counts, task-local change lists and ledger digests
 * (null when unknown), gate verdicts and freshness, integration gates, the one budget ledger with its usage source,
 * cleanup and closed failure codes. Never prompts, transcripts, raw diffs, file contents, tool arguments or check
 * output, and no free-form metadata.
 */
export interface EvidenceComplexSummary {
	parent: { id: string; digest: string; status: string };
	plan: {
		id: string;
		digest: string;
		/** 2 for V0.8A plans; 1 only on a historical V0.7B Run (sequential, maxParallel 1). */
		schemaVersion: 1 | 2;
		limits: {
			maxWorkerInvocations: number;
			maxReportedTokens: number;
			maxTotalRevisionCycles: number;
			maxParallel: number;
		};
	};
	phase: ComplexPhase;
	/** Every active row in plan order (V0.8A); empty during integration and at TERMINAL. */
	activeTaskIds: string[];
	/** The plan's implementation waves in order: tasks listed together may implement concurrently. */
	waves: string[][];
	tasks: Array<{
		id: string;
		title: string;
		status: ComplexTaskStatus;
		/** 1-based implementation wave of this task. */
		wave: number;
		dependsOn: string[];
		claims: Array<{ path: string; operation: OwnershipOperation }>;
		attempt: number;
		revisionCycle: number;
		maxRevisionCycles: number;
		workerInvocations: number;
		reportedTokens: number | null;
		/** Task-local exact files of the current attempt; `changeDigest` is null when not captured or unknown. */
		changedFiles: string[];
		changesUnknown: boolean;
		changeDigest: string | null;
		selfCheck: CheckGate;
		review: ReviewGate;
		test: CheckGate;
		evidenceFreshness: EvidenceFreshness;
		failureCode: ComplexFailureCode | null;
	}>;
	integration: {
		check: CheckGate;
		review: ReviewGate;
		test: CheckGate;
		workspaceDigest: string | null;
		/** Cumulative Run delta at integration; `changeDigest` is null when not captured or unknown. */
		changedFiles: string[];
		changeDigest: string | null;
		evidenceFreshness: EvidenceFreshness;
		failureCode: ComplexFailureCode | null;
	};
	/** Every started task attempt and the integration record, including revised and failed attempts. */
	attempts: Array<{
		taskId: string | null;
		attempt: number;
		revision: number;
		entryWorkspaceDigest: string | null;
		exitWorkspaceDigest: string | null;
		changedFiles: string[];
		changeDigest: string | null;
		checks: number;
		handoff: boolean;
		review: boolean;
		sessions: number;
		measurements: number;
		failureCode: ComplexFailureCode | null;
	}>;
	/** The one Run ledger against the frozen plan limits; tokens are provider-reported or unavailable, never billing. */
	budget: ComplexExecution["budget"] & { usage: "PROVIDER_REPORTED" | "UNAVAILABLE" };
	cleanup: CleanupStatus;
	partialChanges: boolean;
	changesUnknown: boolean;
	failureCode: ComplexFailureCode | null;
}

export interface EvidenceWorkerSummary {
	role: string;
	revision: number;
	step: string;
	/** COMPLEX only: the Kernel-assigned task (`CT-00n`) or `integration` this invocation served. */
	task?: string;
	/** #5 routing: the profile used and the configured alias that selected it (null = the role default profile). */
	profile: string;
	modelIntent: ModelIntent | null;
	/** From the frozen configuration mapping; `provider`/`model` below are what the provider actually reported. */
	requestedProvider: string;
	requestedModel: string;
	provider: string;
	model: string;
	responseModel: string | null;
	thinking: string | null;
	outcome: string;
	durationMs: number;
	modelTurns: number;
	toolCalls: number;
	toolCallsByName: Record<string, number>;
	reportedTokens: number | null;
	reviewerContext: WorkerMeasurement["reviewerContext"] | null;
	/** Bounded advisory-context summary only; never snippet text, source text or path lists. */
	contextPack: {
		mode: string;
		digest: string;
		bytes: number;
		relatedFileCount: number;
		symbolCount: number;
		snippetCount: number;
		unknownCount: number;
		truncated: boolean;
	} | null;
}

export interface EvidencePack {
	version: number;
	runId: string;
	status: string;
	goal: string;
	workflow: string;
	risk: string;
	executionMode: string | null;
	taskContract: {
		digest: string | null;
		criteria: Array<{ id: string; statement: string; status: string; evidenceRefs: string[] }>;
	} | null;
	acceptanceLegacyUnknown: boolean;
	workspace: { diffDigest: string | null; changedFiles: string[]; changedLines: number | null };
	checks: Array<{
		id: string;
		kind: string;
		browser?: BrowserVerificationEvidence;
		/** COMPLEX only: the Kernel-assigned task (`CT-00n`) or `integration` this fresh check ran for. */
		task?: string;
		revision: number;
		attempt: number | null;
		diffDigest: string;
		step: string;
		status: string;
		required: boolean;
		exitCode: number | null;
		evidenceRefs: string[];
		trust: {
			mode: string;
			status: string;
			registrationDigest: string;
			executableDigest: string;
			sources: Array<{ path: string; digest: string }>;
		} | null;
		sandbox: {
			mode: string;
			status: string;
			backend: string;
			backendVersion: string;
			policyDigest: string;
		} | null;
	}>;
	verificationRepair: NonNullable<Run["verificationRepair"]> | null;
	lsp: { available: boolean; stale: boolean } | null;
	review: {
		result: string;
		independent: boolean;
		criteria: Array<{ criterionId: string; status: string; evidenceRefs: string[] }>;
	} | null;
	approval: { status: string; target: string } | null;
	failure: { category: EvidenceFailureCategory; reason: string | null } | null;
	partialChanges: boolean;
	cleanup: "confirmed" | "uncertain" | "UNKNOWN";
	workers: EvidenceWorkerSummary[];
	budget: {
		configured: boolean;
		workerInvocations: number;
		reportedTokens: number | null;
		maxWorkerInvocations: number | null;
		maxReportedTokens: number | null;
		exceeded: boolean;
		reason: string | null;
	};
	provenance: {
		runtimeSourceCommit: string | null;
		runtimeSourcePath: string | null;
		cliBundleSha256: string | null;
		cliBundleMtimeMs: number | null;
		cliBundleVersion: string | null;
		targetWorkspaceCommit: string | null;
		configDigest: string | null;
		taskContractDigest: string | null;
		capturedAt: number | null;
	};
	limitations: string[];
	/** Present for COMPLEX Runs with a Host-confirmed plan; absent (never null) for QUICK/STANDARD. */
	complex?: EvidenceComplexSummary;
}

const taskLabel = (context: ComplexEvidenceContext) => context.taskId ?? "integration";

/** Closed COMPLEX failure codes that name a known category; others keep the generic structured mapping. */
const COMPLEX_FAILURE_CATEGORIES: Partial<Record<ComplexFailureCode, EvidenceFailureCategory>> = {
	OWNERSHIP_CONFLICT: "POLICY",
	UNOWNED_PATH: "POLICY",
	POLICY_DENIED: "POLICY",
	CHECK_FAILED: "VERIFICATION",
	CHECK_UNAVAILABLE: "VERIFICATION",
	STALE_EVIDENCE: "VERIFICATION",
	EXTERNAL_MUTATION: "VERIFICATION",
	REVIEW_BLOCKED: "REVIEW",
	REVIEW_MISSING: "REVIEW",
	REVISION_LIMIT: "REVIEW",
	BUDGET_EXHAUSTED: "BUDGET",
	BUDGET_UNKNOWN: "BUDGET",
	APPROVAL_DENIED: "APPROVAL",
	APPROVAL_EXPIRED: "APPROVAL",
	APPROVAL_INVALID: "APPROVAL",
	CANCELLED: "CANCELLED",
	CLEANUP_UNCONFIRMED: "CLEANUP",
	STORAGE_FAILED: "STORAGE",
};

function complexSummary(run: Run): EvidenceComplexSummary | undefined {
	const state = run.complex;
	const parent = run.tasks[0];
	if (run.workflow !== "COMPLEX" || !state || !parent || !isTaskContract(parent)) return undefined;
	const { plan } = state;
	const records = run.complexEvidence ?? [];
	const record = (taskId: string | null, attempt: number) =>
		records.find((item) => item.complexContext.taskId === taskId && item.complexContext.attempt === attempt);
	const integration = record(null, 1);
	const budget = complexBudget(run, plan);
	const waves = complexWaves(plan);
	return {
		parent: { id: parent.id, digest: plan.parentTaskContractDigest, status: parent.status },
		plan: {
			id: plan.planId,
			digest: plan.complexPlanDigest,
			schemaVersion: plan.schemaVersion,
			limits: {
				maxWorkerInvocations: plan.limits.maxWorkerInvocations,
				maxReportedTokens: plan.limits.maxReportedTokens,
				maxTotalRevisionCycles: plan.limits.maxTotalRevisionCycles,
				maxParallel: planMaxParallel(plan),
			},
		},
		phase: state.phase,
		activeTaskIds: activeTaskIdsOf(state),
		waves,
		tasks: state.tasks.map((row, index) => {
			const task = plan.tasks[index];
			return {
				id: row.id,
				title: task?.title ?? "",
				status: row.status,
				wave: waves.findIndex((wave) => wave.includes(row.id)) + 1,
				dependsOn: [...(task?.dependsOn ?? [])],
				claims: (task?.ownership ?? []).map((claim) => ({ path: claim.path, operation: claim.operation })),
				attempt: row.attempt,
				revisionCycle: row.revisionCycle,
				maxRevisionCycles: task?.maxRevisionCycles ?? 0,
				workerInvocations: row.workerInvocations,
				reportedTokens: row.reportedTokens,
				changedFiles: [...row.changedFiles],
				changesUnknown: row.changesUnknown,
				changeDigest: row.attempt > 0 ? (record(row.id, row.attempt)?.changeDigest ?? null) : null,
				selfCheck: row.selfCheck,
				review: row.review,
				test: row.test,
				evidenceFreshness: row.evidenceFreshness,
				failureCode: row.failureCode,
			};
		}),
		integration: {
			check: state.integration.check,
			review: state.integration.review,
			test: state.integration.test,
			workspaceDigest: state.integration.workspaceDigest,
			changedFiles: [...(integration?.changedFiles ?? [])],
			changeDigest: integration?.changeDigest ?? null,
			evidenceFreshness: state.integration.evidenceFreshness,
			failureCode: state.integration.failureCode,
		},
		attempts: records.map((item) => ({
			taskId: item.complexContext.taskId,
			attempt: item.complexContext.attempt,
			revision: item.revision,
			entryWorkspaceDigest: item.entryWorkspaceDigest,
			exitWorkspaceDigest: item.exitWorkspaceDigest,
			changedFiles: [...item.changedFiles],
			changeDigest: item.changeDigest,
			checks: item.checkRefs.length,
			handoff: item.handoff,
			review: item.review,
			sessions: item.sessionRefs.length,
			measurements: item.measurementIndexes.length,
			failureCode: item.failureCode,
		})),
		budget: { ...budget, usage: budget.reportedTokens === null ? "UNAVAILABLE" : "PROVIDER_REPORTED" },
		cleanup: state.cleanup,
		partialChanges: state.partialChanges,
		changesUnknown: state.changesUnknown,
		failureCode: state.failureCode,
	};
}

/** Only structured, known signals are mapped; ambiguous failures stay UNKNOWN instead of guessing from text. */
function failureCategory(run: Run, error: string | undefined): EvidenceFailureCategory {
	// COMPLEX: the Kernel's closed failure code is the most precise structured signal.
	const complexCategory = run.complex?.failureCode ? COMPLEX_FAILURE_CATEGORIES[run.complex.failureCode] : undefined;
	if (complexCategory) return complexCategory;
	if (run.budget?.exceeded) return "BUDGET";
	if (run.status === "CANCELLED") return "CANCELLED";
	if (
		run.approvals?.some(
			(record) => record.status === "DENIED" || record.status === "EXPIRED" || record.status === "CANCELLED",
		)
	)
		return "APPROVAL";
	if (
		run.verification.some(
			(check) =>
				check.revision === run.revisionCycle &&
				(check.status === "FAIL" || (check.required && check.status === "UNAVAILABLE")),
		)
	)
		return "VERIFICATION";
	if (run.review && !isCriteriaReview(run.review)) return "UNKNOWN";
	if (run.review?.revision === run.revisionCycle && (run.review.result === "REVISE" || run.review.result === "BLOCK"))
		return "REVIEW";
	const text = (error ?? run.lastError ?? "").trim();
	if (!text) return "UNKNOWN";
	if (text.startsWith("Policy ")) return "POLICY";
	if (text.startsWith("Budget ")) return "BUDGET";
	if (text === "Worker provider failed") return "PROVIDER";
	if (text === "Worker tool failed or was denied" || text === "Worker tool error limit exceeded") return "TOOL";
	if (text.startsWith("Runtime storage failed")) return "STORAGE";
	if (text.includes("cleanup unconfirmed") || text.includes("Resource cleanup unconfirmed")) return "CLEANUP";
	if (text.startsWith("Unsupported classification/workflow")) return "PREFLIGHT";
	return "UNKNOWN";
}

export function projectEvidencePack(input: EvidencePackInput): EvidencePack {
	const { run } = input;
	const report = input.report;
	const task = run.tasks[0];
	const contract = task && isTaskContract(task) ? task : null;
	const acceptance = new Map((run.acceptance ?? []).map((entry) => [entry.criterionId, entry]));
	const complex = complexSummary(run);
	// COMPLEX persists its own cleanup settlement; a local report error still withholds "confirmed".
	const cleanup: EvidencePack["cleanup"] =
		report?.changesUnknown === true
			? "uncertain"
			: report && run.status === "COMPLETED" && !report.error
				? "confirmed"
				: complex?.cleanup === "UNCONFIRMED"
					? "uncertain"
					: complex?.cleanup === "CONFIRMED" && !report?.error
						? "confirmed"
						: "UNKNOWN";
	const limitations: string[] = [];
	if (!contract) limitations.push("Legacy run: acceptance criteria and measurements were not recorded");
	if (!run.workerMeasurements?.length && contract) limitations.push("No worker measurement recorded for this run");
	if (!run.provenance) limitations.push("No provenance snapshot recorded for this run");
	if (cleanup === "uncertain")
		limitations.push("Resource cleanup unconfirmed; do not treat this as a clean completion");
	if (run.workspace?.changedLines === undefined) limitations.push("Changed line count unknown");
	if (run.executionMode === undefined) limitations.push("Execution contract not recorded (legacy run)");
	if (run.verification.some((check) => check.kind === "browser"))
		limitations.push(
			"Browser checks cover one local static document at capture time, not visual correctness, a live session, or an OS network sandbox",
		);
	const lspChecks = run.verification.flatMap((check) => check.evidenceRefs.filter((ref) => ref.startsWith("lsp:")));
	return {
		version: EVIDENCE_PACK_VERSION,
		runId: run.runId,
		status: run.status,
		goal: run.goal,
		workflow: run.workflow,
		risk: run.risk,
		executionMode: run.executionMode ?? null,
		taskContract: contract
			? {
					digest: run.taskContractDigest ?? null,
					criteria: contract.acceptanceCriteria.map((criterion) => ({
						id: criterion.id,
						statement: criterion.statement,
						status: acceptance.get(criterion.id)?.status ?? "UNKNOWN",
						evidenceRefs: acceptance.get(criterion.id)?.evidenceRefs ?? [],
					})),
				}
			: null,
		acceptanceLegacyUnknown: contract === null,
		workspace: {
			diffDigest: run.workspace?.diffDigest ?? null,
			changedFiles: run.workspace?.changedFiles ?? [],
			changedLines: run.workspace?.changedLines ?? null,
		},
		checks: run.verification.map((check) => ({
			id: check.id,
			kind: check.kind,
			...(check.browser ? { browser: structuredClone(check.browser) } : {}),
			...(check.complexContext ? { task: taskLabel(check.complexContext) } : {}),
			revision: check.revision,
			attempt: check.step?.attempt ?? null,
			diffDigest: check.diffDigest,
			step: check.step?.stepId ?? "unrecorded",
			status: check.status,
			required: check.required,
			exitCode: check.exitCode,
			evidenceRefs: [...check.evidenceRefs],
			// Bounded trust projection only: no raw contents, env, credentials or absolute executable paths.
			trust: check.trust
				? {
						mode: check.trust.mode,
						status: check.trust.status,
						registrationDigest: check.trust.registrationDigest,
						executableDigest: check.trust.executableDigest,
						sources: check.trust.sources.map((source) => ({ path: source.path, digest: source.digest })),
					}
				: null,
			sandbox: check.sandbox
				? {
						mode: check.sandbox.mode,
						status: check.sandbox.status,
						backend: check.sandbox.backend,
						backendVersion: check.sandbox.backendVersion,
						policyDigest: check.sandbox.policyDigest,
					}
				: null,
		})),
		verificationRepair: run.verificationRepair ? structuredClone(run.verificationRepair) : null,
		lsp: lspChecks.length
			? { available: true, stale: (run.workspace?.evidenceRefs ?? []).some((ref) => ref.startsWith("stale:")) }
			: null,
		review: run.review
			? isCriteriaReview(run.review)
				? {
						result: run.review.result,
						independent:
							(run.roleSessionRefs ?? []).filter((ref) => ref.role === "Reviewer").length > 0 &&
							new Set((run.roleSessionRefs ?? []).map((ref) => ref.sessionId)).size ===
								(run.roleSessionRefs ?? []).length,
						criteria: run.review.criteria.map((item) => ({
							criterionId: item.criterionId,
							status: item.status,
							evidenceRefs: [...item.evidenceRefs],
						})),
					}
				: { result: run.review.result, independent: false, criteria: [] }
			: null,
		approval: run.approvals?.length
			? { status: run.approvals[0].status, target: run.approvals[0].request.path }
			: null,
		failure: ["COMPLETED"].includes(run.status)
			? null
			: { category: failureCategory(run, report?.error), reason: report?.error ?? run.lastError ?? null },
		partialChanges:
			report?.partialChanges ??
			(complex
				? complex.partialChanges
				: run.status !== "COMPLETED" && (run.workspace?.changedFiles.length ?? 0) > 0),
		cleanup,
		workers: (run.workerMeasurements ?? []).map((measurement) => ({
			reviewerContext: measurement.reviewerContext
				? {
						digest: measurement.reviewerContext.digest,
						bytes: measurement.reviewerContext.bytes,
						...(measurement.reviewerContext.impact
							? {
									impact: {
										digest: measurement.reviewerContext.impact.digest,
										bytes: measurement.reviewerContext.impact.bytes,
										changedSymbolCount: measurement.reviewerContext.impact.changedSymbolCount,
										callerCount: measurement.reviewerContext.impact.callerCount,
										testCount: measurement.reviewerContext.impact.testCount,
										truncated: measurement.reviewerContext.impact.truncated,
									},
								}
							: {}),
						...(measurement.reviewerContext.documentation
							? {
									documentation: {
										digest: measurement.reviewerContext.documentation.digest,
										bytes: measurement.reviewerContext.documentation.bytes,
										matchedCount: measurement.reviewerContext.documentation.matchedCount,
										staleCount: measurement.reviewerContext.documentation.staleCount,
										unmatchedCount: measurement.reviewerContext.documentation.unmatchedCount,
										truncated: measurement.reviewerContext.documentation.truncated,
									},
								}
							: {}),
					}
				: null,
			contextPack: measurement.contextPack
				? {
						mode: measurement.contextPack.mode,
						digest: measurement.contextPack.digest,
						bytes: measurement.contextPack.bytes,
						relatedFileCount: measurement.contextPack.relatedFileCount,
						symbolCount: measurement.contextPack.symbolCount,
						snippetCount: measurement.contextPack.snippetCount,
						unknownCount: measurement.contextPack.unknownCount,
						truncated: measurement.contextPack.truncated,
					}
				: null,
			role: measurement.role,
			revision: measurement.revision,
			step: `${measurement.step.stepId}@${measurement.step.attempt}`,
			...(measurement.complexContext ? { task: taskLabel(measurement.complexContext) } : {}),
			profile: measurement.profile,
			modelIntent: measurement.modelIntent ?? null,
			requestedProvider: measurement.requestedProvider,
			requestedModel: measurement.requestedModel,
			provider: measurement.actualProvider,
			model: measurement.actualModel,
			responseModel: measurement.responseModel ?? null,
			thinking: measurement.providerThinkingLevel ?? null,
			outcome: measurement.outcome,
			durationMs: measurement.durationMs,
			modelTurns: measurement.modelTurns,
			toolCalls: measurement.toolCalls,
			toolCallsByName: measurement.toolCallsByName,
			reportedTokens: measurement.usage.source === "provider" ? measurement.usage.totalTokens : null,
		})),
		budget: {
			configured: run.budget?.configured ?? false,
			workerInvocations: run.budget?.workerInvocations ?? 0,
			reportedTokens: run.budget?.reportedTokens ?? null,
			maxWorkerInvocations: run.budget?.maxWorkerInvocations ?? null,
			maxReportedTokens: run.budget?.maxReportedTokens ?? null,
			exceeded: run.budget?.exceeded ?? false,
			reason: run.budget?.reason ?? null,
		},
		provenance: {
			runtimeSourceCommit: run.provenance?.runtimeSource?.commit ?? null,
			runtimeSourcePath: run.provenance?.runtimeSource?.path ?? null,
			cliBundleSha256: run.provenance?.cliBundle?.sha256 ?? null,
			cliBundleMtimeMs: run.provenance?.cliBundle?.mtimeMs ?? null,
			cliBundleVersion: run.provenance?.cliBundle?.version ?? null,
			targetWorkspaceCommit: run.provenance?.targetWorkspaceCommit ?? null,
			configDigest: run.provenance?.configDigest ?? null,
			taskContractDigest: run.provenance?.taskContractDigest ?? null,
			capturedAt: run.provenance?.capturedAt ?? null,
		},
		limitations,
		...(complex ? { complex } : {}),
	};
}

const unknown = (value: unknown): string => (value === null || value === undefined ? "UNKNOWN" : String(value));

/** COMPLEX section of the human-readable pack: parent, ordered tasks, attempts, integration, budget, cleanup. */
function formatComplexSummary(complex: EvidenceComplexSummary): string[] {
	const files = (paths: readonly string[]) =>
		paths.length ? paths.map((path) => displayText(path)).join(", ") : "none";
	const change = (paths: readonly string[], digest: string | null, changesUnknown = false) =>
		`${files(paths)}${changesUnknown ? " + UNKNOWN" : ""} (${digest ?? "digest UNKNOWN"})`;
	const lines = [
		`COMPLEX parent ${displayText(complex.parent.id)} ${complex.parent.digest} [${complex.parent.status}]; plan ${complex.plan.id} ${complex.plan.digest}${complex.plan.schemaVersion === 1 ? " (V0.7B v1)" : ""}; phase ${complex.phase}; active ${complex.activeTaskIds.join(", ") || "none"}`,
		`  Waves (max ${complex.plan.limits.maxParallel} implementing at once; verification one task at a time in plan order): ${complex.waves.map((wave, index) => `${index + 1}: ${wave.join(", ")}`).join(" | ")}`,
		"  A task COMPLETED is a verified contribution at its own workspace, not Run completion; the Run status is the outcome.",
	];
	for (const task of complex.tasks)
		lines.push(
			`  ${task.id} ${task.status} | wave ${task.wave} | ${displayText(task.title, 80)} | after ${task.dependsOn.join(", ") || "none"} | claims ${task.claims.map((claim) => `${claim.operation} ${displayText(claim.path)}`).join(", ") || "none (read-only)"}`,
			`    attempt ${task.attempt}, revisions ${task.revisionCycle}/${task.maxRevisionCycles}, invocations ${task.workerInvocations}, reported tokens ${unknown(task.reportedTokens)} | changed ${change(task.changedFiles, task.changeDigest, task.changesUnknown)} | self-check ${task.selfCheck}, review ${task.review}, test ${task.test} | evidence ${task.evidenceFreshness} | failure ${task.failureCode ?? "none"}`,
		);
	const integration = complex.integration;
	lines.push(
		`  Integration: first checks ${integration.check}, final review ${integration.review}, final checks ${integration.test} | workspace ${unknown(integration.workspaceDigest)} | changed ${change(integration.changedFiles, integration.changeDigest)} | evidence ${integration.evidenceFreshness} | failure ${integration.failureCode ?? "none"}`,
		`  Attempts: ${complex.attempts.length} recorded (revised and failed attempts stay history, never reusable success)`,
		...complex.attempts.map(
			(attempt) =>
				`    ${attempt.taskId ?? "integration"}@${attempt.attempt} work cycle ${attempt.revision}: entry ${unknown(attempt.entryWorkspaceDigest)} exit ${unknown(attempt.exitWorkspaceDigest)} | changed ${change(attempt.changedFiles, attempt.changeDigest)} | checks ${attempt.checks}, handoff ${attempt.handoff ? "yes" : "no"}, review ${attempt.review ? "yes" : "no"}, sessions ${attempt.sessions}, measurements ${attempt.measurements} | failure ${attempt.failureCode ?? "none"}`,
		),
		`  Budget: invocations ${complex.budget.workerInvocations}/${complex.plan.limits.maxWorkerInvocations}, reported tokens ${unknown(complex.budget.reportedTokens)}/${complex.plan.limits.maxReportedTokens} (${complex.budget.usage === "PROVIDER_REPORTED" ? "provider-reported" : "usage unavailable"}), work cycles ${complex.budget.totalRevisionCycles}/${complex.plan.limits.maxTotalRevisionCycles}; ${complex.budget.status}`,
		`  Cleanup ${complex.cleanup}; partial changes ${complex.partialChanges ? "yes" : "no"}${complex.changesUnknown ? " (unknown)" : ""}; Run failure ${complex.failureCode ?? "none"}; no rollback`,
	);
	return lines;
}

/** Human-readable summary. Estimated cost is UNKNOWN unless a trusted price source exists; today it never does. */
export function formatEvidencePack(pack: EvidencePack): string {
	const lines = [
		`Evidence Pack (read-only projection; not an execution authority)`,
		`Run: ${displayText(pack.runId)} | ${pack.status} | workflow ${pack.workflow} | risk ${pack.risk} | contract ${unknown(pack.executionMode)}`,
		`Goal: ${displayText(pack.goal)}`,
		`Task Contract: ${unknown(pack.taskContract?.digest)}`,
	];
	if (pack.taskContract)
		for (const criterion of pack.taskContract.criteria)
			lines.push(
				`  ${criterion.id} [${criterion.status}] ${displayText(criterion.statement)}` +
					(criterion.evidenceRefs.length
						? `; evidence: ${criterion.evidenceRefs.map((ref) => displayText(ref)).join(", ")}`
						: "; evidence: none recorded"),
			);
	else lines.push("  Acceptance criteria: UNKNOWN (legacy)");
	if (pack.complex) lines.push(...formatComplexSummary(pack.complex));
	lines.push(
		`Workspace: diff ${unknown(pack.workspace.diffDigest)}; changed files ${pack.workspace.changedFiles.length ? pack.workspace.changedFiles.map((path) => displayText(path)).join(", ") : "none recorded"}; changed lines ${unknown(pack.workspace.changedLines)}`,
	);
	lines.push(
		`Verification repair: ${
			pack.verificationRepair
				? `${pack.verificationRepair.mode}; used ${pack.verificationRepair.attempts.length}/1`
				: "UNKNOWN (not recorded)"
		}`,
	);
	for (const repair of pack.verificationRepair?.attempts ?? [])
		lines.push(
			`  Failed SELF_CHECK #${repair.fromStep.attempt} (revision ${repair.fromRevision}) -> Developer #${repair.toStep.attempt} (revision ${repair.toRevision}); parent diff ${displayText(repair.diffDigest)}; checks ${repair.failedCheckIds.map((id) => displayText(id)).join(", ")}`,
		);
	for (const check of pack.checks) {
		lines.push(
			`Check ${displayText(check.id)} (${check.task ? `${check.task} ` : ""}${check.step} #${check.attempt ?? "unknown"}, revision ${check.revision}${check.required ? ", required" : ""}${check.kind === "browser" ? ", browser" : ""}): ${check.status}${check.exitCode === null ? "" : ` exit ${check.exitCode}`}`,
		);
		lines.push(
			check.sandbox
				? `  Verifier sandbox: ${check.sandbox.status} (${check.sandbox.backend} ${check.sandbox.backendVersion}); policy ${check.sandbox.policyDigest.slice(0, 20)}…; network denied`
				: check.kind === "browser"
					? "  Browser isolation: private HOME/profile/CDP pipe; not an OS sandbox"
					: "  Verifier sandbox: UNKNOWN (disabled or legacy)",
		);
		lines.push(
			check.trust
				? `  Verifier trust: ${check.trust.status} (${check.trust.mode}); registration ${check.trust.registrationDigest.slice(0, 20)}…; trusted sources ${check.trust.sources.length}`
				: "  Verifier trust: UNKNOWN (legacy)",
		);
		if (check.browser)
			lines.push(
				`  Browser document: ${displayText(check.browser.documentIdentity)}; source ${check.browser.documentDigest}`,
				`  Assertion: ${check.browser.assertion.type} on ${displayText(check.browser.target.selector)}; registration ${check.browser.registrationDigest}`,
				`  Fresh capture: ${check.browser.captureId} at ${new Date(check.browser.capturedAt).toISOString()}; evidence ${check.browser.browserEvidenceDigest}; cleanup ${check.browser.cleanup}`,
			);
	}
	lines.push(
		`LSP advisory evidence: ${pack.lsp ? (pack.lsp.stale ? "present (stale)" : "present") : "none recorded"}`,
	);
	lines.push(
		pack.review
			? `Reviewer: ${pack.review.result}; independent sessions: ${pack.review.independent ? "yes" : "no/UNKNOWN"}; criteria ${pack.review.criteria.length}`
			: "Reviewer: not required or not recorded",
	);
	lines.push(
		pack.approval
			? `R3 approval: ${pack.approval.status} on ${displayText(pack.approval.target)}`
			: "R3 approval: not applicable",
	);
	lines.push(
		`Budget: ${pack.budget.configured ? `invocations ${pack.budget.workerInvocations}/${unknown(pack.budget.maxWorkerInvocations)}, reported tokens ${unknown(pack.budget.reportedTokens)}/${unknown(pack.budget.maxReportedTokens)}` : "not configured (explicit unlimited)"}${pack.budget.exceeded ? `; EXCEEDED: ${displayText(pack.budget.reason ?? "reason unavailable")}` : ""}`,
	);
	lines.push(`Estimated cost: UNKNOWN (no trusted price source for this provider/model)`);
	if (!pack.workers.length) lines.push("Workers: no measurement recorded");
	for (const worker of pack.workers)
		lines.push(
			`  ${worker.role} ${worker.step}${worker.task ? ` [${worker.task}]` : ""} rev ${worker.revision}: ${worker.provider}/${worker.model}` +
				`${worker.responseModel ? ` (response ${worker.responseModel})` : ""} thinking ${unknown(worker.thinking)} | ${worker.outcome} ${worker.durationMs}ms | turns ${worker.modelTurns} | tools ${worker.toolCalls}${
					Object.keys(worker.toolCallsByName).length
						? ` (${Object.entries(worker.toolCallsByName)
								.map(([name, count]) => `${name}:${count}`)
								.join(", ")})`
						: ""
				} | reported tokens ${unknown(worker.reportedTokens)}`,
		);
	for (const worker of pack.workers)
		lines.push(
			`  ${worker.role} context: ${
				worker.contextPack
					? `bounded ${worker.contextPack.digest.slice(0, 20)}… | files ${worker.contextPack.relatedFileCount} | symbols ${worker.contextPack.symbolCount} | snippets ${worker.contextPack.snippetCount} | bytes ${worker.contextPack.bytes} | unknowns ${worker.contextPack.unknownCount} | truncated ${worker.contextPack.truncated ? "yes" : "no"}`
					: "disabled"
			}`,
		);
	for (const worker of pack.workers) {
		const context = worker.reviewerContext;
		if (context)
			lines.push(
				`  Reviewer advisory context: ${context.digest} | bytes ${context.bytes}`,
				`    Impact: ${context.impact ? `${context.impact.digest} | symbols ${context.impact.changedSymbolCount} | references ${context.impact.callerCount} | tests ${context.impact.testCount} | truncated ${context.impact.truncated}` : "disabled"}`,
				`    Documentation: ${context.documentation ? `${context.documentation.digest} | matched ${context.documentation.matchedCount} | stale ${context.documentation.staleCount} | unmatched ${context.documentation.unmatchedCount} | truncated ${context.documentation.truncated}` : "disabled"}`,
				"    Context only; not verification evidence or completion authority.",
			);
	}
	if (pack.workers.length)
		lines.push(
			...formatModelRoutes(
				pack.workflow,
				pack.workers.map((worker) => ({
					role: worker.role,
					profile: worker.profile,
					...(worker.modelIntent ? { modelIntent: worker.modelIntent } : {}),
					requestedProvider: worker.requestedProvider,
					requestedModel: worker.requestedModel,
					actualProvider: worker.provider,
					actualModel: worker.model,
				})),
			),
		);
	lines.push(
		`Partial changes: ${pack.partialChanges ? "yes" : "no"}; cleanup: ${pack.cleanup}`,
		`Failure: ${pack.failure ? `${pack.failure.category}${pack.failure.reason ? `: ${displayText(pack.failure.reason)}` : ""}` : "none (completed)"}`,
		`Provenance: runtime ${unknown(pack.provenance.runtimeSourceCommit)} (${unknown(pack.provenance.runtimeSourcePath)}); CLI bundle ${unknown(pack.provenance.cliBundleSha256)}${pack.provenance.cliBundleMtimeMs === null ? "" : ` mtime ${new Date(pack.provenance.cliBundleMtimeMs).toISOString()}`} version ${unknown(pack.provenance.cliBundleVersion)}; target HEAD ${unknown(pack.provenance.targetWorkspaceCommit)}; config ${unknown(pack.provenance.configDigest)}; contract ${unknown(pack.provenance.taskContractDigest)}; captured ${pack.provenance.capturedAt === null ? "UNKNOWN" : new Date(pack.provenance.capturedAt).toISOString()}`,
	);
	for (const limitation of pack.limitations) lines.push(`Limitation: ${displayText(limitation)}`);
	return lines.join("\n");
}
