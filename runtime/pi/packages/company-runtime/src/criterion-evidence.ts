import { createHash } from "node:crypto";
import {
	ACCEPTANCE_CRITERION_ID_PATTERN,
	type AcceptanceCriterion,
	type AcceptanceResult,
	type Review,
	type TaskContract,
	type VerificationResult,
} from "./contracts.ts";

const criterionIdPattern = new RegExp(ACCEPTANCE_CRITERION_ID_PATTERN);

/** Kernel integrity check: sequential Host-assigned IDs, no gaps, duplicates or foreign IDs. */
export function assertCriterionIdentity(criteria: readonly AcceptanceCriterion[]): void {
	criteria.forEach((criterion, index) => {
		const expected = `AC-${String(index + 1).padStart(3, "0")}`;
		if (!criterionIdPattern.test(criterion.id) || criterion.id !== expected)
			throw new Error("Acceptance criterion IDs must be sequential Host-assigned IDs");
	});
}

/** Canonical digest of the frozen contract. Lifecycle status is not part of it; no credentials are included. */
export function taskContractDigest(contract: TaskContract): string {
	const { id, goal, acceptanceCriteria } = contract;
	return `sha256:${createHash("sha256").update(JSON.stringify({ id, goal, acceptanceCriteria })).digest("hex")}`;
}

/** Reviewer-owned results for the projection; the Reviewer judges IDs, never statements. */
export function acceptanceResultsFromReview(review: Review): AcceptanceResult[] {
	return review.criteria.map((item) => ({
		criterionId: item.criterionId,
		status: item.status,
		evidenceRefs: [...item.evidenceRefs],
		revision: review.revision,
		diffDigest: review.diffDigest,
	}));
}

/** Verifier-owned evidence mapping for QUICK Executor results; model prose is never the evidence source. */
export function acceptanceResultsFromChecks(
	contract: TaskContract,
	criteria: ReadonlyArray<{ criterionId: string; status: AcceptanceResult["status"] }>,
	verification: VerificationResult,
): AcceptanceResult[] {
	return criteria.map((item) => {
		const criterion = contract.acceptanceCriteria.find((entry) => entry.id === item.criterionId);
		const evidenceRefs = [
			...new Set(
				(criterion?.verification.checkIds ?? []).flatMap(
					(id) => verification.checks.find((check) => check.id === id)?.evidenceRefs ?? [],
				),
			),
		];
		return {
			criterionId: item.criterionId,
			status: item.status,
			evidenceRefs,
			revision: verification.revision,
			diffDigest: verification.diffDigest,
		};
	});
}
