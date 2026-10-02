import type {
  WeavraEvidenceCursor,
  WeavraEvidenceRecord,
  WeavraTask,
  WeavraTaskEvidenceResult,
} from "@t3tools/contracts";

export type EvidenceCategory = WeavraEvidenceCursor["category"];
export interface TaskEvidenceState {
  readonly latest: WeavraTaskEvidenceResult;
  readonly records: readonly WeavraEvidenceRecord[];
  readonly complete: readonly EvidenceCategory[];
  readonly next: Partial<Record<EvidenceCategory, WeavraEvidenceCursor | null>>;
  readonly unavailable: Partial<
    Record<
      EvidenceCategory,
      WeavraTaskEvidenceResult & {
        kind: "evidence-detail-unavailable";
      }
    >
  >;
}

function evidenceMatchesTask(task: WeavraTask, page: WeavraTaskEvidenceResult): boolean {
  const execution = task.execution;
  const receipt = execution?.receipt;
  return (
    receipt?.status === "FOUND" &&
    receipt.run !== null &&
    receipt.executionId === execution?.binding.executionId &&
    page.snapshot.executionId === receipt.executionId &&
    page.snapshot.runId === receipt.run.runId &&
    page.snapshot.revision === receipt.run.revision &&
    page.outcome.status === receipt.run.status
  );
}

export function appendTaskEvidence(
  task: WeavraTask,
  state: TaskEvidenceState | null,
  page: WeavraTaskEvidenceResult,
):
  | { ok: true; state: TaskEvidenceState }
  | { ok: false; code: "SNAPSHOT_CHANGED" | "PAGE_MISMATCH" } {
  if (
    !evidenceMatchesTask(task, page) ||
    (state && state.latest.snapshot.diffDigest !== page.snapshot.diffDigest)
  )
    return { ok: false, code: "SNAPSHOT_CHANGED" };
  if (state && !evidenceMatchesTask(task, state.latest))
    return { ok: false, code: "SNAPSHOT_CHANGED" };
  const category = page.cursor.category;
  const records = state?.records ?? [];
  if (
    page.cursor.index !== records.filter((record) => record.category === category).length ||
    state?.complete.includes(category) ||
    state?.unavailable[category]
  )
    return { ok: false, code: "PAGE_MISMATCH" };
  if (page.kind === "evidence-detail-unavailable") {
    return {
      ok: true,
      state: {
        latest: page,
        records,
        complete: state?.complete ?? [],
        next: { ...state?.next, [category]: null },
        unavailable: { ...state?.unavailable, [category]: page },
      },
    };
  }
  return {
    ok: true,
    state: {
      latest: page,
      records: [...records, ...page.records],
      complete:
        page.nextCursor === null ? [...(state?.complete ?? []), category] : (state?.complete ?? []),
      next: { ...state?.next, [category]: page.nextCursor },
      unavailable: state?.unavailable ?? {},
    },
  };
}

export type IssueVerification =
  | { status: "verified" }
  | {
      status: "unverified";
      reason:
        | "RUN_NOT_COMPLETED"
        | "NO_SYMPTOM_BINDING"
        | "STALE_OR_MISSING_EVIDENCE"
        | "BINDING_CHANGED"
        | "EVIDENCE_INCOMPLETE"
        | "CRITERION_UNVERIFIED"
        | "FINAL_CHECK_UNVERIFIED"
        | "REGISTRATION_UNVERIFIED"
        | "REVIEW_UNVERIFIED";
    };

export function issueVerification(
  task: WeavraTask,
  state: TaskEvidenceState | null,
  fresh: boolean,
): IssueVerification {
  const receipt = task.execution?.receipt;
  if (receipt?.status !== "FOUND" || receipt.run?.status !== "COMPLETED")
    return { status: "unverified", reason: "RUN_NOT_COMPLETED" };
  const binding = receipt.admission.metadata.binding.symptomVerification;
  if (!binding) return { status: "unverified", reason: "NO_SYMPTOM_BINDING" };
  if (!fresh || !state || !evidenceMatchesTask(task, state.latest))
    return { status: "unverified", reason: "STALE_OR_MISSING_EVIDENCE" };
  const page = state.latest;
  const observedBinding = page.symptomVerification;
  if (
    observedBinding?.criterionId !== binding.criterionId ||
    observedBinding.checkId !== binding.checkId ||
    observedBinding.registrationDigest !== binding.registrationDigest
  )
    return { status: "unverified", reason: "BINDING_CHANGED" };
  if (!state.complete.includes("criteria") || !state.complete.includes("checks"))
    return { status: "unverified", reason: "EVIDENCE_INCOMPLETE" };
  const criterion = state.records
    .filter((record) => record.category === "criteria")
    .find((record) => record.id === binding.criterionId);
  if (criterion?.status !== "MET") return { status: "unverified", reason: "CRITERION_UNVERIFIED" };
  // Verification records are append-only. An older PASS cannot hide the final attempt.
  const check = state.records
    .filter((record) => record.category === "checks")
    .findLast((record) => record.id === binding.checkId && record.step === "test");
  if (
    !check ||
    check.status !== "PASS" ||
    !check.required ||
    check.revision !== page.codeRevision ||
    check.diffDigest !== page.snapshot.diffDigest
  )
    return { status: "unverified", reason: "FINAL_CHECK_UNVERIFIED" };
  if (
    check.trust?.status !== "VERIFIED" ||
    check.trust.registrationDigest !== binding.registrationDigest
  )
    return { status: "unverified", reason: "REGISTRATION_UNVERIFIED" };
  if (
    page.review?.result !== "PASS" ||
    !page.review.independent ||
    page.review.revision !== page.codeRevision ||
    page.review.diffDigest !== page.snapshot.diffDigest
  )
    return { status: "unverified", reason: "REVIEW_UNVERIFIED" };
  return { status: "verified" };
}
