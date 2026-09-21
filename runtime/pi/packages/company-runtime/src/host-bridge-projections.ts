import { loadRuntimeConfig } from "./config.ts";
import type { Run } from "./contracts.ts";
import { projectEvidencePack } from "./evidence.ts";
import { projectRunGraph } from "./graph.ts";
import type {
	HostBridgeIdentity,
	HostConfigSummary,
	HostEvidenceSummary,
	HostGraphSummary,
	HostRunSummary,
	HostStatusSummary,
} from "./host-bridge-protocol.ts";
import { FileStateStore } from "./state-store.ts";

export interface HostObservation {
	identity: Pick<HostBridgeIdentity, "runId" | "stateRevision" | "projectRevision" | "eventId">;
	status: HostStatusSummary;
	run?: Run;
}

/** Durable source only. No writer acquisition, recovery, derived-file repair or cached fallback. */
export async function readHostObservation(cwd: string, runId?: string): Promise<HostObservation> {
	const emptyIdentity = { runId: null, stateRevision: null, projectRevision: null, eventId: null };
	try {
		const snapshot = await FileStateStore.readSnapshot(cwd);
		const run = runId ? snapshot.state?.runs.find((value) => value.runId === runId) : snapshot.state?.runs.at(-1);
		return {
			identity: {
				runId: run?.runId ?? null,
				stateRevision: run?.revision ?? null,
				projectRevision: snapshot.state?.revision ?? null,
				eventId: run?.eventSequence ? `${run.runId}:${run.eventSequence}` : null,
			},
			status: {
				source: "durable-canonical-state",
				ownerObserved: false,
				state: snapshot.state ? "available" : "missing",
				writerPresent: snapshot.writerPresent,
				run: run ? projectHostRun(run) : null,
			},
			run,
		};
	} catch {
		return {
			identity: emptyIdentity,
			status: {
				source: "durable-canonical-state",
				ownerObserved: false,
				state: "unavailable",
				writerPresent: null,
				run: null,
			},
		};
	}
}

export function projectHostRun(run: Run): HostRunSummary {
	return {
		runId: run.runId,
		status: run.status,
		phase: run.phase,
		workflow: run.workflow,
		risk: run.risk,
		executionMode: run.executionMode ?? null,
		codeRevision: run.revisionCycle,
		currentStep: run.currentStep ? { stepId: run.currentStep.stepId, attempt: run.currentStep.attempt } : null,
		activeAgentCount: run.activeAgents.length,
		taskContractDigest: run.taskContractDigest ?? null,
		createdAt: run.createdAt,
		updatedAt: run.updatedAt,
	};
}

/** Reuse graph semantics, but never copy labels/details/diagnostics/check IDs or paths. */
export function projectHostGraph(run: Run): HostGraphSummary {
	const graph = projectRunGraph(run);
	return {
		runId: graph.runId,
		stateRevision: graph.stateRevision,
		status: graph.status,
		nodes: graph.nodes.map((node) => ({
			id: node.id,
			kind: node.kind,
			status: node.status,
			...(node.stepId ? { stepId: node.stepId } : {}),
			...(node.attempt !== undefined ? { attempt: node.attempt } : {}),
			...(node.role ? { role: node.role } : {}),
			...(node.parentId ? { parentId: node.parentId } : {}),
		})),
		edges: graph.edges.map((edge) => ({ from: edge.from, to: edge.to, kind: edge.kind })),
	};
}

export function projectHostEvidence(run: Run): HostEvidenceSummary {
	const evidence = projectEvidencePack({ run });
	const criteria = { total: 0, met: 0, notMet: 0, unknown: 0 };
	for (const criterion of evidence.taskContract?.criteria ?? []) {
		criteria.total++;
		if (criterion.status === "MET") criteria.met++;
		else if (criterion.status === "UNMET") criteria.notMet++;
		else criteria.unknown++;
	}
	const currentChecks = { total: 0, passed: 0, failed: 0, unavailable: 0, skipped: 0 };
	for (const check of evidence.checks) {
		if (check.revision !== run.revisionCycle) continue;
		currentChecks.total++;
		if (check.status === "PASS") currentChecks.passed++;
		else if (check.status === "FAIL") currentChecks.failed++;
		else if (check.status === "UNAVAILABLE") currentChecks.unavailable++;
		else currentChecks.skipped++;
	}
	const workers = {
		count: evidence.workers.length,
		reportedTokens: evidence.workers.length ? (0 as number | null) : null,
		toolCalls: 0,
	};
	const reviewerContexts = { count: 0, bytes: 0 };
	for (const worker of evidence.workers) {
		workers.toolCalls += worker.toolCalls;
		if (worker.reportedTokens === null) workers.reportedTokens = null;
		else if (workers.reportedTokens !== null) workers.reportedTokens += worker.reportedTokens;
		if (worker.reviewerContext) {
			reviewerContexts.count++;
			reviewerContexts.bytes += worker.reviewerContext.bytes;
		}
	}
	return {
		runId: run.runId,
		status: run.status,
		codeRevision: run.revisionCycle,
		legacyAcceptanceUnknown: evidence.acceptanceLegacyUnknown,
		criteria,
		currentChecks,
		review:
			evidence.review && run.review?.revision === run.revisionCycle
				? { result: evidence.review.result, independent: evidence.review.independent }
				: null,
		workers,
		reviewerContexts,
		failureCategory:
			run.status === "FAILED" ||
			run.status === "BLOCKED" ||
			run.status === "CANCELLED" ||
			run.status === "INTERRUPTED"
				? (evidence.failure?.category ?? "UNKNOWN")
				: null,
	};
}

/** This is current project configuration, not the frozen configuration of a selected Run. */
export async function readHostConfiguration(cwd: string): Promise<HostConfigSummary> {
	const source = "project-config-not-frozen-run-config";
	try {
		const loaded = await loadRuntimeConfig(cwd);
		if (loaded.status === "missing") return { source, status: "missing" };
		const config = loaded.config;
		return {
			source,
			status: "configured",
			modes: {
				workflow: config.runtime.workflow,
				mutation: config.mutation.mode,
				verifierTrust: config.verification.trust.mode,
				verifierSandbox: config.verification.sandbox.mode,
				verificationRepair: config.verification.repair.mode,
				taskContext: config.agents.context_pack.mode,
				impact: config.review.context?.impact ?? "disabled",
				documentation: config.review.context?.documentation?.mode ?? "disabled",
			},
			allowedRootCount: config.files.allowed_paths.length,
			registeredCheckCount: config.verification.checks.length,
			requiredCheckCount: config.verification.checks.filter((check) => check.required).length,
			documentationEntryCount: config.review.context?.documentation?.entries.length ?? 0,
			budgetConfigured: config.budget !== undefined,
		};
	} catch {
		return { source, status: "unavailable" };
	}
}
