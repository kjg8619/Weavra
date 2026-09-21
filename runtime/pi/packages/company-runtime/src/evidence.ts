import type { BrowserVerificationEvidence } from "./browser-types.ts";
import { isCriteriaReview, isTaskContract, type Run } from "./contracts.ts";
import type { WorkerMeasurement } from "./measurement-types.ts";
import { displayText } from "./observations.ts";

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

export interface EvidenceWorkerSummary {
	role: string;
	revision: number;
	step: string;
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
}

/** Only structured, known signals are mapped; ambiguous failures stay UNKNOWN instead of guessing from text. */
function failureCategory(run: Run, error: string | undefined): EvidenceFailureCategory {
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
	if (text === "Worker tool failed or was denied") return "TOOL";
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
	const cleanup: EvidencePack["cleanup"] =
		report?.changesUnknown === true
			? "uncertain"
			: report && run.status === "COMPLETED" && !report.error
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
			report?.partialChanges ?? (run.status !== "COMPLETED" && (run.workspace?.changedFiles.length ?? 0) > 0),
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
	};
}

const unknown = (value: unknown): string => (value === null || value === undefined ? "UNKNOWN" : String(value));

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
			`Check ${displayText(check.id)} (${check.step} #${check.attempt ?? "unknown"}, revision ${check.revision}${check.required ? ", required" : ""}${check.kind === "browser" ? ", browser" : ""}): ${check.status}${check.exitCode === null ? "" : ` exit ${check.exitCode}`}`,
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
			`  ${worker.role} ${worker.step} rev ${worker.revision}: ${worker.provider}/${worker.model}` +
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
	lines.push(
		`Partial changes: ${pack.partialChanges ? "yes" : "no"}; cleanup: ${pack.cleanup}`,
		`Failure: ${pack.failure ? `${pack.failure.category}${pack.failure.reason ? `: ${displayText(pack.failure.reason)}` : ""}` : "none (completed)"}`,
		`Provenance: runtime ${unknown(pack.provenance.runtimeSourceCommit)} (${unknown(pack.provenance.runtimeSourcePath)}); CLI bundle ${unknown(pack.provenance.cliBundleSha256)}${pack.provenance.cliBundleMtimeMs === null ? "" : ` mtime ${new Date(pack.provenance.cliBundleMtimeMs).toISOString()}`} version ${unknown(pack.provenance.cliBundleVersion)}; target HEAD ${unknown(pack.provenance.targetWorkspaceCommit)}; config ${unknown(pack.provenance.configDigest)}; contract ${unknown(pack.provenance.taskContractDigest)}; captured ${pack.provenance.capturedAt === null ? "UNKNOWN" : new Date(pack.provenance.capturedAt).toISOString()}`,
	);
	for (const limitation of pack.limitations) lines.push(`Limitation: ${displayText(limitation)}`);
	return lines.join("\n");
}
