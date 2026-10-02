import {
  CommandId,
  WeavraTask,
  type WeavraCanonicalRunStatus,
  type WeavraEvidenceDetailsPage,
  type WeavraEvidenceRecord,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const digest = `sha256:${"a".repeat(64)}`;
const decodeTask = Schema.decodeUnknownSync(WeavraTask);
export function preparedTask(): WeavraTask {
  const checkout = {
    canonicalCwd: "/tmp/controlled-checkout",
    repositoryRoot: "/tmp/controlled-checkout",
    headCommit: "b".repeat(40),
    workspaceDigest: digest,
  };
  const binding = {
    taskId: "11111111-1111-4111-8111-111111111111",
    environmentId: "environment",
    projectId: "project",
    threadId: "thread",
    checkout,
    executionId: "22222222-2222-4222-8222-222222222222",
    packetVersion: 1,
    advisoryDigest: digest,
    symptomVerification: {
      criterionId: "AC-001",
      checkId: "symptom-test",
      registrationDigest: digest,
    },
  };
  return decodeTask({
    id: binding.taskId,
    environmentId: binding.environmentId,
    projectId: binding.projectId,
    threadId: binding.threadId,
    target: { workspaceRoot: checkout.repositoryRoot, worktreePath: null },
    checkout,
    phase: "awaiting-confirmation",
    revision: 3,
    context: {
      version: 1,
      packetVersion: 1,
      authority: "ADVISORY_ONLY",
      reviewedAt: 1,
      symptom: "Observed failure",
      observations: [],
      candidateCause: { kind: "HYPOTHESIS", text: "Candidate cause" },
      uncertainties: [],
      sourceReferences: [],
      constraints: [],
    },
    execution: {
      binding,
      previewId: "preview-1",
      previewDigest: digest,
      configDigest: digest,
      confirmedProjectRevision: 1,
      confirmCommandId: null,
      receipt: null,
      preview: {
        taskBinding: binding,
        previewId: "preview-1",
        previewDigest: digest,
        configDigest: digest,
        ownerId: "owner",
        projectRevision: 1,
        expiresAt: 4102444800000,
        goal: "Fix observed failure",
        workflow: "STANDARD",
        executionMode: "EDIT",
        risk: "R1",
        allowedPaths: ["src/fix.ts"],
        checks: [{ id: "symptom-test", kind: "custom", required: true }],
        acceptanceCriteria: [
          {
            id: "AC-001",
            statement: "The observed failure is fixed",
            checkIds: ["symptom-test"],
            reviewRequired: true,
          },
        ],
        taskContractDigest: digest,
        recipe: null,
        modelRoutes: [
          {
            role: "Developer",
            intent: "standard",
            source: "config",
            profile: "coding",
            provider: "faux",
            model: "implementation",
          },
          {
            role: "Reviewer",
            intent: "review",
            source: "config",
            profile: "reasoning",
            provider: "faux",
            model: "independent",
          },
        ],
        configuration: {
          mutationMode: "strict",
          verifierTrustMode: "strict",
          verifierSandboxMode: "required",
          contextPackMode: "bounded",
          verificationRepairMode: "disabled",
          lspEnabled: false,
        },
      },
    },
    ownership: { generation: 2, state: "analysis" },
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: "2026-09-28T00:00:00.000Z",
  });
}

export function resultFixture(bound = true) {
  const original = preparedTask();
  const execution = original.execution;
  if (execution === null) throw new Error("Prepared fixture requires execution metadata");
  const { symptomVerification, ...unbound } = execution.binding;
  const binding = bound ? execution.binding : unbound;
  const task = decodeTask({
    ...original,
    phase: "finished",
    revision: 10,
    ownership: { generation: 9, state: "released" },
    execution: {
      ...execution,
      binding,
      confirmCommandId: CommandId.make("confirmed"),
      preview: execution.preview ? { ...execution.preview, taskBinding: binding } : null,
      receipt: {
        status: "FOUND",
        executionId: binding.executionId,
        admission: {
          metadata: {
            binding,
            previewDigest: execution.previewDigest,
            configDigest: execution.configDigest,
            confirmedProjectRevision: 1,
            admittedProjectRevision: 2,
          },
          outcome: { status: "STARTED", runId: "run-result" },
          acceptedAt: 1,
          updatedAt: 2,
        },
        run: { runId: "run-result", status: "COMPLETED", revision: 9 },
      },
    },
  });
  const digest = "d".repeat(64);
  const metadata = {
    snapshot: {
      executionId: binding.executionId,
      runId: "run-result",
      revision: 9,
      diffDigest: digest,
    },
    completeness: {
      criteria: { availability: "available", total: 1 },
      checks: { availability: "available", total: 1, required: 1 },
      changedFiles: { availability: "available", total: 1 },
      trustSources: { availability: "available", total: 1, checksWithoutTrust: 0 },
      review: { availability: "available" },
    },
    source: "inline",
    outcome: { status: "COMPLETED", terminal: true },
    ownership: { writerPresent: false, cleanup: "confirmed" },
    codeRevision: 2,
    changedLines: 3,
    symptomVerification: bound ? (symptomVerification ?? null) : null,
    review: {
      result: "PASS",
      independent: true,
      revision: 2,
      diffDigest: digest,
      criteriaCount: 1,
    },
  } satisfies Omit<WeavraEvidenceDetailsPage, "kind" | "cursor" | "records" | "nextCursor">;
  const check: Extract<WeavraEvidenceRecord, { category: "checks" }> = {
    category: "checks",
    index: 0,
    id: "symptom-test",
    kind: "custom",
    revision: 2,
    attempt: 1,
    step: "test",
    diffDigest: digest,
    status: "PASS",
    required: true,
    exitCode: 0,
    evidenceRefs: ["check:final"],
    trust: {
      mode: "strict",
      status: "VERIFIED",
      registrationDigest: `sha256:${"a".repeat(64)}`,
      executableDigest: `sha256:${"b".repeat(64)}`,
      sourceCount: 1,
    },
    sandbox: null,
  };
  const criteria: WeavraEvidenceDetailsPage = {
    ...metadata,
    kind: "evidence-details",
    cursor: { category: "criteria", index: 0 },
    records: [
      {
        category: "criteria",
        index: 0,
        id: "AC-001",
        statement: "The observed failure is fixed",
        status: "MET",
        evidenceRefs: ["check:final"],
      },
    ],
    nextCursor: null,
  };
  const checks: WeavraEvidenceDetailsPage = {
    ...metadata,
    kind: "evidence-details",
    cursor: { category: "checks", index: 0 },
    records: [check],
    nextCursor: null,
  };
  return { task, metadata, check, criteria, checks };
}

export function taskScope(task = preparedTask()) {
  return { environmentId: task.environmentId, projectId: task.projectId, threadId: task.threadId };
}

export function runTask(status: typeof WeavraCanonicalRunStatus.Type = "COMPLETED"): WeavraTask {
  const task = preparedTask();
  const execution = task.execution;
  if (execution === null) throw new Error("Prepared fixture requires execution metadata");
  const terminal = ["COMPLETED", "BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED"].includes(status);
  return decodeTask({
    ...task,
    phase: terminal ? "finished" : "running",
    revision: 10,
    ownership: { generation: 9, state: terminal ? "released" : "runtime" },
    execution: {
      ...execution,
      confirmCommandId: CommandId.make("confirmed"),
      receipt: {
        status: "FOUND",
        executionId: execution.binding.executionId,
        admission: {
          metadata: {
            binding: execution.binding,
            previewDigest: execution.previewDigest,
            configDigest: execution.configDigest,
            confirmedProjectRevision: execution.confirmedProjectRevision,
            admittedProjectRevision: execution.confirmedProjectRevision + 1,
          },
          outcome: { status: "STARTED", runId: "run-result" },
          acceptedAt: 1,
          updatedAt: 2,
        },
        run: { runId: "run-result", status, revision: 9 },
      },
    },
  });
}
