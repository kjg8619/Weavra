import type { Run, TaskAdmission } from "./contracts.ts";
import { projectEvidencePack } from "./evidence.ts";
import type {
	HostEvidenceCategory,
	HostEvidenceCheckRecord,
	HostEvidenceCompleteness,
	HostEvidenceCriterionRecord,
	HostEvidenceCursor,
	HostEvidenceDetailsPage,
	HostEvidenceDetailsUnavailable,
	HostEvidenceRecord,
	HostEvidenceTrustSourceRecord,
} from "./host-control-protocol.ts";
import { HOST_EVIDENCE_PAGE_RECORD_LIMIT } from "./host-control-protocol.ts";

export class EvidenceDetailsCursorError extends Error {}
export class EvidenceDetailsResponseTooLargeError extends Error {}

export interface EvidenceDetailsProjectionInput {
	run: Run;
	source: "inline" | "archive";
	writerPresent: boolean | null;
	admission?: TaskAdmission;
	cursor: HostEvidenceCursor;
	fits: (data: HostEvidenceDetailsPage | HostEvidenceDetailsUnavailable) => boolean;
}

const terminalStatuses = new Set(["BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED", "COMPLETED"]);

function completeness(run: Run): HostEvidenceCompleteness {
	const contract = run.tasks[0];
	const workspace = run.workspace;
	const criteriaAvailable = contract !== undefined && "acceptanceCriteria" in contract;
	const checksAvailable = run.taskContractDigest !== undefined;
	const changedFilesAvailable = workspace !== undefined;
	const checksWithoutTrust = run.verification.filter((check) => check.trust === undefined).length;
	const trustSources = run.verification.flatMap((check) => check.trust?.sources ?? []);
	const trustAvailable = checksAvailable && checksWithoutTrust === 0;
	const trustPartial = checksAvailable && checksWithoutTrust > 0 && checksWithoutTrust < run.verification.length;
	return {
		criteria: {
			availability: criteriaAvailable ? "available" : "unavailable",
			total: criteriaAvailable ? contract.acceptanceCriteria.length : null,
		},
		checks: {
			availability: checksAvailable ? "available" : "unavailable",
			total: checksAvailable ? run.verification.length : null,
			required: checksAvailable ? run.verification.filter((check) => check.required).length : null,
		},
		changedFiles: {
			availability: changedFilesAvailable ? "available" : "unavailable",
			total: workspace ? workspace.changedFiles.length : null,
		},
		trustSources: {
			availability: trustAvailable ? "available" : trustPartial ? "partial" : "unavailable",
			total: trustAvailable || trustPartial ? trustSources.length : null,
			checksWithoutTrust,
		},
		review: { availability: run.review === undefined ? "unavailable" : "available" },
	};
}

function criterionRecords(run: Run): HostEvidenceCriterionRecord[] | null {
	const pack = projectEvidencePack({ run });
	if (!pack.taskContract) return null;
	return pack.taskContract.criteria.map((criterion, index) => ({
		category: "criteria",
		index,
		id: criterion.id,
		statement: criterion.statement,
		status: criterion.status,
		evidenceRefs: [...criterion.evidenceRefs],
	}));
}

function checkRecords(run: Run): HostEvidenceCheckRecord[] | null {
	if (run.taskContractDigest === undefined) return null;
	return projectEvidencePack({ run }).checks.map((check, index) => ({
		category: "checks",
		index,
		id: check.id,
		kind: check.kind,
		revision: check.revision,
		attempt: check.attempt,
		step: check.step,
		diffDigest: check.diffDigest,
		status: check.status,
		required: check.required,
		exitCode: check.exitCode,
		evidenceRefs: [...check.evidenceRefs],
		trust: check.trust
			? {
					mode: check.trust.mode,
					status: check.trust.status,
					registrationDigest: check.trust.registrationDigest,
					executableDigest: check.trust.executableDigest,
					sourceCount: check.trust.sources.length,
				}
			: null,
		sandbox: check.sandbox ? { ...check.sandbox } : null,
	}));
}

function changedFileRecords(run: Run): HostEvidenceRecord[] | null {
	if (!run.workspace) return null;
	return run.workspace.changedFiles.map((path, index) => ({ category: "changed-files", index, path }));
}

function trustSourceRecords(run: Run): HostEvidenceTrustSourceRecord[] | null {
	if (run.taskContractDigest === undefined) return null;
	if (run.verification.length > 0 && run.verification.every((check) => check.trust === undefined)) return null;
	let index = 0;
	return run.verification.flatMap((check, checkIndex) =>
		(check.trust?.sources ?? []).map((source, sourceIndex) => ({
			category: "trust-sources" as const,
			index: index++,
			checkIndex,
			checkId: check.id,
			sourceIndex,
			path: source.path,
			digest: source.digest,
		})),
	);
}

function records(run: Run, category: HostEvidenceCategory): HostEvidenceRecord[] | null {
	switch (category) {
		case "criteria":
			return criterionRecords(run);
		case "checks":
			return checkRecords(run);
		case "changed-files":
			return changedFileRecords(run);
		case "trust-sources":
			return trustSourceRecords(run);
	}
}

export function projectHostEvidenceDetails(
	input: EvidenceDetailsProjectionInput,
): HostEvidenceDetailsPage | HostEvidenceDetailsUnavailable {
	const { run, cursor } = input;
	const pack = projectEvidencePack({ run });
	const binding = run.taskBinding?.binding;
	const workspace = run.workspace;
	const diffDigest = workspace?.diffDigest;
	if (!binding || !workspace || !diffDigest || !/^[0-9a-f]{64}$/.test(diffDigest))
		throw new EvidenceDetailsCursorError("Bound Run evidence identity unavailable");
	let cleanup = pack.cleanup;
	if (input.admission) {
		const admission = input.admission;
		if (
			admission.outcome.status !== "STARTED" ||
			admission.outcome.runId !== run.runId ||
			JSON.stringify(admission.metadata) !== JSON.stringify(run.taskBinding)
		)
			throw new EvidenceDetailsCursorError("Task cleanup admission does not match the bound Run");
		// Durable task settlement survives Host restart; a terminal status or absent writer alone does not prove it.
		cleanup =
			pack.cleanup === "uncertain" || admission.cleanup === "UNCONFIRMED"
				? "uncertain"
				: admission.cleanup === "CONFIRMED" &&
						terminalStatuses.has(run.status) &&
						run.activeAgents.length === 0 &&
						input.writerPresent === false
					? "confirmed"
					: "UNKNOWN";
	}
	const available = records(run, cursor.category);
	const base = {
		snapshot: {
			executionId: binding.executionId,
			runId: run.runId,
			revision: run.revision,
			diffDigest,
		},
		completeness: completeness(run),
		source: input.source,
		outcome: { status: run.status, terminal: terminalStatuses.has(run.status) },
		ownership: { writerPresent: input.writerPresent, cleanup },
		codeRevision: run.revisionCycle,
		changedLines: workspace.changedLines ?? null,
		symptomVerification: binding.symptomVerification ?? null,
		review:
			pack.review && run.review
				? {
						result: pack.review.result,
						independent: pack.review.independent,
						revision: run.review.revision,
						diffDigest: run.review.diffDigest,
						criteriaCount: pack.review.criteria.length,
					}
				: null,
		cursor: { ...cursor },
	};
	if (!available) {
		const unavailable: HostEvidenceDetailsUnavailable = {
			kind: "evidence-detail-unavailable",
			...base,
			reason: "CATEGORY_UNAVAILABLE",
			recordIndex: cursor.index,
		};
		if (!input.fits(unavailable)) throw new EvidenceDetailsResponseTooLargeError();
		return unavailable;
	}
	if (cursor.index > available.length || (available.length > 0 && cursor.index === available.length))
		throw new EvidenceDetailsCursorError("Evidence cursor is outside the category");
	const pageRecords: HostEvidenceRecord[] = [];
	let next = cursor.index;
	while (next < available.length && pageRecords.length < HOST_EVIDENCE_PAGE_RECORD_LIMIT) {
		const record = available[next];
		if (!record) throw new EvidenceDetailsCursorError("Evidence cursor is outside the category");
		const candidateRecords = [...pageRecords, record];
		const candidate: HostEvidenceDetailsPage = {
			kind: "evidence-details",
			...base,
			records: candidateRecords,
			nextCursor: next + 1 < available.length ? { category: cursor.category, index: next + 1 } : null,
		};
		if (!input.fits(candidate)) {
			if (pageRecords.length === 0) {
				const unavailable: HostEvidenceDetailsUnavailable = {
					kind: "evidence-detail-unavailable",
					...base,
					reason: "RECORD_TOO_LARGE",
					recordIndex: next,
				};
				if (!input.fits(unavailable)) throw new EvidenceDetailsResponseTooLargeError();
				return unavailable;
			}
			break;
		}
		pageRecords.push(record);
		next++;
	}
	const page: HostEvidenceDetailsPage = {
		kind: "evidence-details",
		...base,
		records: pageRecords,
		nextCursor: next < available.length ? { category: cursor.category, index: next } : null,
	};
	if (!input.fits(page)) throw new EvidenceDetailsResponseTooLargeError();
	return page;
}
