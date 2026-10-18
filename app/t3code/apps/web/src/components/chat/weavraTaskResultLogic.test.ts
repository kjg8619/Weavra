import * as NodeAssert from "node:assert/strict";
import { WeavraTask, WeavraExecutionId, type WeavraEvidenceRecord } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  appendTaskEvidence,
  issueVerification,
  taskResultNextAction,
} from "./weavraTaskResultLogic";
import { preparedTask, resultFixture as fixture, runTask } from "./weavraTaskTestFixture";

type Check = Extract<WeavraEvidenceRecord, { category: "checks" }>;
const decodeTask = Schema.decodeUnknownSync(WeavraTask);

describe("task next-action priority", () => {
  const observed = { fresh: true, connected: true, recoverySupported: true };
  const interrupted = () => {
    const task = runTask("INTERRUPTED");
    const execution = task.execution;
    NodeAssert.ok(execution?.receipt?.status === "FOUND");
    return decodeTask({
      ...task,
      phase: "attention-required",
      ownership: { ...task.ownership, state: "runtime" },
      execution: {
        ...execution,
        receipt: {
          ...execution.receipt,
          admission: { ...execution.receipt.admission, cleanup: "UNCONFIRMED" },
        },
      },
    });
  };

  it.each([{ fresh: false }, { connected: false }])(
    "synchronizes before any action when the observation is unavailable: %j",
    (unavailable) => {
      expect(
        taskResultNextAction({ ...observed, ...unavailable, task: runTask("WAITING_APPROVAL") }),
      ).toBe("synchronize");
    },
  );

  it("reconciles unknown delivery rather than suggesting confirmation", () => {
    const task = runTask("RUNNING");
    NodeAssert.ok(task.execution);
    const unknown = decodeTask({
      ...task,
      execution: {
        ...task.execution,
        receipt: { status: "UNKNOWN", executionId: task.execution.binding.executionId },
      },
    });
    expect(taskResultNextAction({ ...observed, task: unknown })).toBe("reconcile");
  });

  it("selects approval inspection only from canonical approval state", () => {
    expect(taskResultNextAction({ ...observed, task: runTask("WAITING_APPROVAL") })).toBe(
      "inspect-approval",
    );
    expect(taskResultNextAction({ ...observed, task: runTask("RUNNING") })).toBe("none");
  });

  it("offers recovery for an owned interruption and inspection when recovery is unsupported", () => {
    const task = interrupted();
    expect(taskResultNextAction({ ...observed, task })).toBe("recover-interruption");
    expect(taskResultNextAction({ ...observed, task, recoverySupported: false })).toBe(
      "inspect-cleanup",
    );
  });

  it("handles an interruption before a Run starts without inventing a Run", () => {
    const task = interrupted();
    NodeAssert.ok(task.execution?.receipt?.status === "FOUND");
    const beforeStart = decodeTask({
      ...task,
      execution: {
        ...task.execution,
        receipt: {
          ...task.execution.receipt,
          run: null,
          admission: {
            ...task.execution.receipt.admission,
            outcome: { status: "INTERRUPTED_BEFORE_START", reasonCode: "OWNER_LOST" },
          },
        },
      },
    });
    expect(taskResultNextAction({ ...observed, task: beforeStart })).toBe("recover-interruption");
  });

  it.each(["COMPLETED", "INTERRUPTED"] as const)(
    "does not offer recovery for released %s work",
    (status) => {
      expect(taskResultNextAction({ ...observed, task: runTask(status) })).toBe("none");
    },
  );

  it("keeps unconfirmed work out of execution recovery", () => {
    expect(taskResultNextAction({ ...observed, task: preparedTask() })).toBe("none");
  });

  it("inspects uncertain cleanup without offering a write or unlock", () => {
    const task = interrupted();
    NodeAssert.ok(task.execution?.receipt?.status === "FOUND");
    NodeAssert.ok(task.execution.receipt.run);
    const completed = decodeTask({
      ...task,
      execution: {
        ...task.execution,
        receipt: {
          ...task.execution.receipt,
          run: { ...task.execution.receipt.run, status: "COMPLETED" },
        },
      },
    });
    expect(taskResultNextAction({ ...observed, task: completed })).toBe("inspect-cleanup");
  });
});

function accept(result: ReturnType<typeof appendTaskEvidence>) {
  if (!result.ok) throw new Error(result.code);
  return result.state;
}

describe("canonical task outcome evidence", () => {
  it("rejects evidence from another execution, Run or state revision", () => {
    const { task, checks } = fixture();
    for (const snapshot of [
      {
        ...checks.snapshot,
        executionId: WeavraExecutionId.make("99999999-9999-4999-8999-999999999999"),
      },
      { ...checks.snapshot, runId: "another-run" },
      { ...checks.snapshot, revision: 10 },
    ]) {
      expect(appendTaskEvidence(task, null, { ...checks, snapshot })).toEqual({
        ok: false,
        code: "SNAPSHOT_CHANGED",
      });
    }
  });
  it("does not resolve an unchecked criterion even with a passing check", () => {
    const { task, criteria, checks } = fixture();
    const records = criteria.records.map((record) =>
      record.category === "criteria" ? { ...record, status: "UNVERIFIED" as const } : record,
    );
    const state = accept(
      appendTaskEvidence(
        task,
        accept(appendTaskEvidence(task, null, { ...criteria, records })),
        checks,
      ),
    );
    expect(issueVerification(task, state, true)).toEqual({
      status: "unverified",
      reason: "CRITERION_UNVERIFIED",
    });
  });
  it("requires the evidence binding to match the frozen admission binding", () => {
    const { task, criteria, checks } = fixture();
    NodeAssert.ok(checks.symptomVerification);
    for (const symptomVerification of [
      null,
      { ...checks.symptomVerification, criterionId: "AC-002" },
      { ...checks.symptomVerification, checkId: "reused-name" },
      { ...checks.symptomVerification, registrationDigest: `sha256:${"f".repeat(64)}` },
    ]) {
      const state = accept(
        appendTaskEvidence(task, accept(appendTaskEvidence(task, null, criteria)), {
          ...checks,
          symptomVerification,
        }),
      );
      expect(issueVerification(task, state, true)).toEqual({
        status: "unverified",
        reason: "BINDING_CHANGED",
      });
    }
  });
  it("verifies only the bound current final check and independent review", () => {
    const { task, criteria, checks } = fixture();
    const state = accept(
      appendTaskEvidence(task, accept(appendTaskEvidence(task, null, criteria)), checks),
    );
    expect(issueVerification(task, state, true)).toEqual({ status: "verified" });
    expect(issueVerification(task, state, false)).toEqual({
      status: "unverified",
      reason: "STALE_OR_MISSING_EVIDENCE",
    });
  });
  it("keeps a build-only completion without a symptom binding unverified", () => {
    const { task, criteria, checks, check } = fixture(false);
    const state = accept(
      appendTaskEvidence(task, accept(appendTaskEvidence(task, null, criteria)), {
        ...checks,
        records: [{ ...check, kind: "build" }],
      }),
    );
    expect(issueVerification(task, state, true)).toEqual({
      status: "unverified",
      reason: "NO_SYMPTOM_BINDING",
    });
  });
  it("does not let advisory completion prose override a failed canonical Run", () => {
    const { task, criteria } = fixture();
    NodeAssert.ok(task.execution?.receipt?.status === "FOUND");
    NodeAssert.ok(task.execution.receipt.run);
    const failed = decodeTask({
      ...task,
      context: {
        ...task.context,
        candidateCause: { kind: "HYPOTHESIS", text: "Everything is fixed and complete" },
      },
      execution: {
        ...task.execution,
        receipt: {
          ...task.execution.receipt,
          run: { ...task.execution.receipt.run, status: "FAILED" },
        },
      },
    });
    expect(issueVerification(failed, null, true)).toEqual({
      status: "unverified",
      reason: "RUN_NOT_COMPLETED",
    });
    expect(appendTaskEvidence(failed, null, criteria)).toEqual({
      ok: false,
      code: "SNAPSHOT_CHANGED",
    });
  });
  for (const [name, alter] of [
    ["missing", () => []],
    ["failed", (check: Check) => [{ ...check, status: "FAIL" as const }]],
    ["stale revision", (check: Check) => [{ ...check, revision: 1 }]],
    ["stale diff", (check: Check) => [{ ...check, diffDigest: "e".repeat(64) }]],
    ["self-check only", (check: Check) => [{ ...check, step: "self-check" }]],
    ["optional", (check: Check) => [{ ...check, required: false }]],
  ] as const) {
    it(`does not resolve with ${name} symptom evidence`, () => {
      const { task, criteria, checks, check } = fixture();
      const records = alter(check);
      const state = accept(
        appendTaskEvidence(task, accept(appendTaskEvidence(task, null, criteria)), {
          ...checks,
          completeness: {
            ...checks.completeness,
            checks: {
              availability: "available",
              total: records.length,
              required: records.filter((record) => record.required).length,
            },
          },
          records,
        }),
      );
      expect(issueVerification(task, state, true)).toEqual({
        status: "unverified",
        reason: "FINAL_CHECK_UNVERIFIED",
      });
    });
  }
  it("rejects a reused check ID whose registration changed", () => {
    const { task, criteria, checks, check } = fixture();
    NodeAssert.ok(check.trust);
    const state = accept(
      appendTaskEvidence(task, accept(appendTaskEvidence(task, null, criteria)), {
        ...checks,
        records: [
          { ...check, trust: { ...check.trust, registrationDigest: `sha256:${"c".repeat(64)}` } },
        ],
      }),
    );
    expect(issueVerification(task, state, true)).toEqual({
      status: "unverified",
      reason: "REGISTRATION_UNVERIFIED",
    });
  });
  it("does not resolve while later check pages can contain a failed final attempt", () => {
    const { task, criteria, checks, check } = fixture();
    const metadata = {
      ...checks,
      completeness: {
        ...checks.completeness,
        checks: { availability: "available" as const, total: 2, required: 2 },
      },
    };
    const first = accept(
      appendTaskEvidence(
        task,
        accept(
          appendTaskEvidence(task, null, {
            ...criteria,
            completeness: metadata.completeness,
          }),
        ),
        {
          ...metadata,
          nextCursor: { category: "checks", index: 1 },
        },
      ),
    );
    expect(issueVerification(task, first, true)).toEqual({
      status: "unverified",
      reason: "EVIDENCE_INCOMPLETE",
    });
    const final = accept(
      appendTaskEvidence(task, first, {
        ...metadata,
        cursor: { category: "checks", index: 1 },
        records: [{ ...check, index: 1, attempt: 2, status: "FAIL", exitCode: 1 }],
        nextCursor: null,
      }),
    );
    expect(issueVerification(task, final, true)).toEqual({
      status: "unverified",
      reason: "FINAL_CHECK_UNVERIFIED",
    });
  });
  it("rejects page gaps, duplicate pages and changed snapshot identity", () => {
    const { task, criteria, checks } = fixture();
    const state = accept(appendTaskEvidence(task, null, criteria));
    expect(appendTaskEvidence(task, state, criteria)).toEqual({ ok: false, code: "PAGE_MISMATCH" });
    expect(
      appendTaskEvidence(task, state, { ...checks, cursor: { category: "checks", index: 1 } }),
    ).toEqual({ ok: false, code: "PAGE_MISMATCH" });
    expect(
      appendTaskEvidence(task, state, {
        ...checks,
        snapshot: { ...checks.snapshot, diffDigest: "e".repeat(64) },
      }),
    ).toEqual({ ok: false, code: "SNAPSHOT_CHANGED" });
  });
  it("retains unavailable evidence as unknown rather than an empty completed category", () => {
    const { task, metadata } = fixture();
    const state = accept(
      appendTaskEvidence(task, null, {
        ...metadata,
        kind: "evidence-detail-unavailable",
        cursor: { category: "checks", index: 0 },
        recordIndex: 0,
        reason: "CATEGORY_UNAVAILABLE",
        completeness: {
          ...metadata.completeness,
          checks: { availability: "unavailable", total: null, required: null },
        },
      }),
    );
    expect(state.latest.completeness.checks.total).toBeNull();
    expect(state.complete).not.toContain("checks");
    expect(state.unavailable.checks?.reason).toBe("CATEGORY_UNAVAILABLE");
  });
  it("requires a matching fresh independent review", () => {
    const { task, criteria, checks } = fixture();
    const state = accept(
      appendTaskEvidence(task, accept(appendTaskEvidence(task, null, criteria)), {
        ...checks,
        review: {
          ...checks.review,
          result: "PASS",
          independent: false,
          revision: 2,
          diffDigest: checks.snapshot.diffDigest,
          criteriaCount: 1,
        },
      }),
    );
    expect(issueVerification(task, state, true)).toEqual({
      status: "unverified",
      reason: "REVIEW_UNVERIFIED",
    });
  });
});
