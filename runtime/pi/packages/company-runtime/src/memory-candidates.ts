import { createHash } from "node:crypto";
import type { Run } from "./contracts.ts";
import { PROJECT_FACT_LIMIT, type ProjectFact } from "./project-fact-types.ts";
import { POLICY_BLOCKED_CHECK_REASON } from "./verification.ts";

export const MEMORY_CANDIDATE_KINDS = ["policy_denied", "check_failed", "review_revise"] as const;
export type MemoryCandidateKind = (typeof MEMORY_CANDIDATE_KINDS)[number];
/**
 * A deterministic rule suggestion derived from a recorded Run outcome. It is never a fact: nothing reads it as
 * worker context, and only an explicit `facts.prepare` + `facts.confirm` of a reviewed source can persist a fact.
 * `sourceRef` (`run:<runId>#<id>`) is that fact source: Runtime re-derives this candidate from the recorded Run
 * and binds the fact to the Run record's digest.
 */
export interface MemoryCandidate {
	id: string;
	source: { runId: string; kind: MemoryCandidateKind };
	statement: string;
	evidenceRef: string;
	sourceRef: string;
}

const FAILURE_STATUSES: readonly Run["status"][] = ["BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED"];
// Only plain identifiers and project-relative paths enter a statement; anything else is dropped, never escaped.
const label = (value: string | null) => (value !== null && /^[A-Za-z0-9._:/-]{1,128}$/.test(value) ? value : null);

/** Newest Run first: a repeated failure keeps one candidate per (kind, subject), sourced from its latest Run. */
export function deriveMemoryCandidates(
	runs: readonly Run[],
	facts: readonly Pick<ProjectFact, "statement">[] = [],
): MemoryCandidate[] {
	const known = new Set(facts.map((fact) => fact.statement));
	const candidates = new Map<string, MemoryCandidate>();
	for (const run of [...runs].reverse()) {
		if (!FAILURE_STATUSES.includes(run.status)) continue;
		const add = (kind: MemoryCandidateKind, subject: string, statement: string, evidenceRef: string) => {
			const id = `sha256:${createHash("sha256")
				.update(JSON.stringify([kind, subject]))
				.digest("hex")}`;
			if (candidates.size >= PROJECT_FACT_LIMIT || candidates.has(id) || known.has(statement)) return;
			candidates.set(id, {
				id,
				source: { runId: run.runId, kind },
				statement,
				evidenceRef,
				sourceRef: `run:${run.runId}#${id}`,
			});
		};
		for (const check of run.verification) {
			const checkId = label(check.id);
			if (!checkId) continue;
			const evidenceRef = check.evidenceRefs[0] ?? `check:${run.runId}:${checkId}`;
			if (check.reason === POLICY_BLOCKED_CHECK_REASON)
				add(
					"policy_denied",
					checkId,
					`검사 ${checkId}는 실행 정책에 막혀 실행되지 않았으므로 정책이 허용하는 명령 형태로 등록해야 한다.`,
					evidenceRef,
				);
			else if (check.status === "FAIL")
				add(
					"check_failed",
					checkId,
					`검사 ${checkId}가 실패로 기록되었으므로 작업을 마치기 전에 이 검사를 통과시켜야 한다.`,
					evidenceRef,
				);
		}
		for (const review of [...(run.reviewHistory ?? []), ...(run.review ? [run.review] : [])]) {
			if (review.result !== "REVISE") continue;
			const evidenceRef = `review:${run.runId}:${review.revision}`;
			const files = [...new Set(review.issues.map((issue) => label(issue.file)))].filter((file) => file !== null);
			if (files.length === 0)
				add(
					"review_revise",
					"",
					"리뷰가 수정 요청(REVISE)을 남겼으므로 같은 작업은 리뷰 지적을 반영한 뒤에 완료해야 한다.",
					evidenceRef,
				);
			for (const file of files)
				add(
					"review_revise",
					file,
					`파일 ${file}의 변경은 리뷰에서 수정 요청(REVISE)을 받았으므로 다음 작업에서 그 지적을 먼저 확인해야 한다.`,
					evidenceRef,
				);
		}
	}
	return [...candidates.values()];
}
