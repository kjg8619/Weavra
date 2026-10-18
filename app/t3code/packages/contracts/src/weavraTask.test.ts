import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import { ClientOrchestrationCommand, ThreadTurnStartCommand } from "./orchestration.ts";
import { WeavraControlErrorCode } from "./weavraControl.ts";
import {
  WeavraAnalysisContext,
  WeavraTask,
  WeavraTaskId,
  WeavraTaskReceipt,
  WeavraTaskFailureSummary,
  WeavraTaskCreateInput,
  WeavraTaskDraft,
} from "./weavraTask.ts";
import {
  WeavraTaskAnalyzeInput,
  WeavraTaskCommitDirtyBaselineInput,
  WeavraTaskRecoverInput,
  WeavraTaskRpcError,
} from "./weavraTaskRpc.ts";

const digest = `sha256:${"a".repeat(64)}`;
const taskId = "11111111-1111-4111-8111-111111111111";
const executionId = "22222222-2222-4222-8222-222222222222";
const checkout = {
  canonicalCwd: "/project",
  repositoryRoot: "/project",
  headCommit: "a".repeat(40),
  workspaceDigest: digest,
};
const packet = {
  version: 1,
  packetVersion: 1,
  authority: "ADVISORY_ONLY",
  reviewedAt: 100,
  symptom: "The requested value is missing.",
  observations: [
    {
      text: "The source returns an empty value.",
      provenance: "MODEL",
      reference: { kind: "source", path: "src/value.ts" },
    },
  ],
  candidateCause: { kind: "HYPOTHESIS", text: "An early return may discard the value." },
  uncertainties: ["The caller has not been checked."],
  sourceReferences: [{ path: "src/value.ts", digest }],
  constraints: ["Keep unrelated files unchanged."],
};
const task = {
  id: taskId,
  environmentId: "environment",
  projectId: "project",
  threadId: "thread",
  target: { workspaceRoot: "/project", worktreePath: null },
  checkout,
  phase: "analysis",
  revision: 1,
  context: packet,
  execution: null,
  ownership: { generation: 1, state: "analysis" },
  createdAt: "2026-09-27T00:00:00.000Z",
  updatedAt: "2026-09-27T00:00:00.000Z",
};
const decodePacket = Schema.decodeUnknownSync(WeavraAnalysisContext);
const decodeTask = Schema.decodeUnknownSync(WeavraTask);
const decodeReceipt = Schema.decodeUnknownSync(WeavraTaskReceipt);
const decodeFailureSummary = Schema.decodeUnknownSync(WeavraTaskFailureSummary);
const decodeTaskId = Schema.decodeUnknownSync(WeavraTaskId);
const decodeThreadTurnStartCommand = Schema.decodeUnknownSync(ThreadTurnStartCommand);
const decodeClientOrchestrationCommand = Schema.decodeUnknownSync(ClientOrchestrationCommand);
const decodeTaskAnalyzeInput = Schema.decodeUnknownSync(WeavraTaskAnalyzeInput);
const encodeTaskJson = Schema.encodeSync(Schema.fromJsonString(WeavraTask));
const decodeTaskJson = Schema.decodeSync(Schema.fromJsonString(WeavraTask));
const binding = {
  taskId,
  environmentId: task.environmentId,
  projectId: task.projectId,
  threadId: task.threadId,
  checkout,
  executionId,
  packetVersion: 1,
  advisoryDigest: digest,
};
const execution = {
  binding,
  previewId: "preview",
  previewDigest: digest,
  configDigest: digest,
  confirmedProjectRevision: 0,
  confirmCommandId: null,
  receipt: null,
};
const preview = {
  taskBinding: binding,
  configDigest: digest,
  previewId: "preview",
  previewDigest: digest,
  ownerId: "owner-1",
  projectRevision: 0,
  expiresAt: 1000,
  goal: "Fix missing value",
  workflow: "STANDARD",
  executionMode: "EDIT",
  risk: "R1",
  allowedPaths: ["src/value.ts"],
  checks: [{ id: "value", kind: "test", required: true }],
  acceptanceCriteria: [
    { id: "AC-001", statement: "Value is returned", checkIds: ["value"], reviewRequired: true },
  ],
  taskContractDigest: digest,
  recipe: null,
  configuration: {
    mutationMode: "strict",
    verifierTrustMode: "strict",
    verifierSandboxMode: "required",
    contextPackMode: "bounded",
    verificationRepairMode: "disabled",
    lspEnabled: false,
  },
};

describe("controlled task preparation errors", () => {
  const decode = Schema.decodeUnknownSync(WeavraTaskRpcError);
  const encode = Schema.encodeSync(WeavraTaskRpcError);
  const encodeJson = Schema.encodeSync(Schema.fromJsonString(WeavraTaskRpcError));
  const decodeJson = Schema.decodeSync(Schema.fromJsonString(WeavraTaskRpcError));
  const legacy = { _tag: "WeavraTaskRpcError", code: "PREPARE_REJECTED" };

  it("round-trips legacy rejection without inventing a preparation reason", () => {
    const error = decodeJson(encodeJson(decode(legacy)));
    expect(error).toBeInstanceOf(WeavraTaskRpcError);
    expect(encode(error)).toEqual(legacy);
    expect(error).not.toHaveProperty("prepareReason");
  });

  it("round-trips every existing Runtime code and each bounded preview reason", () => {
    const reasons = [
      ...WeavraControlErrorCode.literals.map((code) => ({ kind: "runtime", code })),
      ...["INVALID_PREVIEW", "STANDARD_REQUIRED", "BINDING_MISMATCH"].map((code) => ({
        kind: "preview",
        code,
      })),
    ];
    for (const prepareReason of reasons) {
      const value = { ...legacy, prepareReason };
      expect(encode(decodeJson(encodeJson(decode(value))))).toEqual(value);
    }
  });

  it("rejects malformed, open-ended, and cross-kind preparation reasons", () => {
    for (const prepareReason of [
      null,
      "INVALID_GOAL",
      {},
      { kind: "runtime" },
      { code: "INVALID_GOAL" },
      { kind: "other", code: "INVALID_GOAL" },
      { kind: "runtime", code: "UNREGISTERED_CODE" },
      { kind: "runtime", code: "INVALID_PREVIEW" },
      { kind: "preview", code: "INVALID_GOAL" },
      { kind: "preview", code: "UNREGISTERED_CODE" },
      { kind: "runtime", code: "INVALID_GOAL", message: "private Runtime text" },
      { kind: "runtime", code: "INVALID_GOAL", details: { path: "/private" } },
      { kind: "preview", code: "INVALID_PREVIEW", payload: {} },
    ]) {
      expect(() => decode({ ...legacy, prepareReason })).toThrow();
    }
  });

  it("carries dirty workspace paths only on a runtime PROJECT_CHANGED reason", () => {
    const details = { reason: "DIRTY_WORKSPACE", files: ["a.txt", "b.txt"], truncated: false };
    const value = {
      ...legacy,
      prepareReason: { kind: "runtime", code: "PROJECT_CHANGED", details },
    };
    expect(encode(decodeJson(encodeJson(decode(value))))).toEqual(value);
    for (const prepareReason of [
      { kind: "runtime", code: "BUSY", details },
      { kind: "preview", code: "INVALID_PREVIEW", details },
      { kind: "runtime", code: "PROJECT_CHANGED", details: { ...details, files: [""] } },
    ]) {
      expect(() => decode({ ...legacy, prepareReason })).toThrow();
    }
  });

  it("requires explicit consent and a bounded reviewed list to commit a dirty baseline", () => {
    const decodeInput = Schema.decodeUnknownSync(WeavraTaskCommitDirtyBaselineInput);
    const input = {
      task: {
        environmentId: "environment",
        projectId: "project",
        threadId: "thread",
        taskId,
      },
      expectedRevision: 2,
      files: ["a.txt"],
      consent: true,
    };
    expect(decodeInput(input)).toEqual(input);
    for (const invalid of [
      { ...input, consent: false },
      { ...input, files: [] },
      { ...input, files: Array.from({ length: 51 }, (_, i) => `f${i}`) },
    ]) {
      expect(() => decodeInput(invalid)).toThrow();
    }
  });

  it("allows reasons only on PREPARE_REJECTED and preserves all legacy error codes", () => {
    const prepareReason = { kind: "runtime", code: "BUSY" } as const;
    for (const code of WeavraTaskRpcError.fields.code.literals) {
      const value = { _tag: "WeavraTaskRpcError", code };
      expect(encode(decode(value))).toEqual(value);
      if (code === "PREPARE_REJECTED") continue;
      expect(() => decode({ ...value, prepareReason })).toThrow();
      expect(() => new WeavraTaskRpcError({ code, prepareReason })).toThrow();
    }
  });
});

describe("controlled task contracts", () => {
  it("requires canonical UUID task identities", () => {
    expect(decodeTaskId(taskId)).toBe(taskId);
    expect(() => decodeTaskId("task-1")).toThrow();
  });

  it("keeps controlled analysis authority out of generic client turn commands", () => {
    const command = {
      type: "thread.turn.start",
      commandId: "turn",
      threadId: "thread",
      message: {
        messageId: "message",
        role: "user",
        text: "Analyze only",
        attachments: [],
      },
      runtimeMode: "full-access",
      interactionMode: "default",
      controlledAnalysis: { taskId, expectedRevision: 1 },
      createdAt: task.createdAt,
    };
    expect(decodeThreadTurnStartCommand(command).controlledAnalysis).toEqual({
      taskId,
      expectedRevision: 1,
    });
    expect("controlledAnalysis" in decodeClientOrchestrationCommand(command)).toBe(false);
    expect(
      decodeTaskAnalyzeInput({
        task: {
          environmentId: task.environmentId,
          projectId: task.projectId,
          threadId: task.threadId,
          taskId,
        },
        commandId: "analysis",
        messageId: "analysis-message",
        text: "Analyze only",
        expectedRevision: 1,
      }),
    ).toMatchObject({ expectedRevision: 1, text: "Analyze only" });
  });

  it("round-trips a complete presentation while decoding legacy tasks additively", () => {
    const legacy = { ...task, phase: "awaiting-confirmation", execution };
    expect(decodeTask(legacy)).toEqual(legacy);
    const current = { ...legacy, createCommandId: "create", execution: { ...execution, preview } };
    const serialized = encodeTaskJson(decodeTask(current));
    expect(decodeTaskJson(serialized)).toEqual(current);
  });

  it("accepts only bounded failure codes and next actions", () => {
    expect(
      decodeFailureSummary({ code: "CHECK_FAILED", nextAction: "REVIEW_CHECK_FAILURE" }),
    ).toEqual({ code: "CHECK_FAILED", nextAction: "REVIEW_CHECK_FAILURE" });
    expect(() =>
      decodeFailureSummary({
        code: "CHECK_FAILED",
        nextAction: "REVIEW_RUN_FAILURE",
      }),
    ).toThrow();
    expect(() =>
      decodeFailureSummary({
        code: "RUN_FAILED",
        nextAction: "REVIEW_RUN_FAILURE",
        reason: "raw stack or argv",
      }),
    ).toThrow();
  });

  it("stores failure summaries only after canonical terminal cleanup", () => {
    const receipt = {
      status: "FOUND",
      executionId,
      admission: {
        metadata: {
          binding,
          previewDigest: digest,
          configDigest: digest,
          confirmedProjectRevision: 0,
          admittedProjectRevision: 1,
        },
        outcome: { status: "STARTED", runId: "run" },
        acceptedAt: 1,
        updatedAt: 2,
        cleanup: "CONFIRMED",
      },
      run: { runId: "run", status: "FAILED", revision: 1 },
    };
    const summary = { code: "RUN_FAILED", nextAction: "REVIEW_RUN_FAILURE" };
    const settled = {
      ...task,
      phase: "finished",
      ownership: { generation: 1, state: "released" },
      execution: { ...execution, confirmCommandId: "confirm", receipt },
      failureSummary: summary,
    };
    expect(decodeTask(settled).failureSummary).toEqual(summary);
    expect(() =>
      decodeTask({
        ...settled,
        execution: {
          ...settled.execution,
          receipt: {
            ...receipt,
            admission: { ...receipt.admission, cleanup: "UNCONFIRMED" },
          },
        },
      }),
    ).toThrow();
  });

  it("rejects preview presentations detached from the execution binding", () => {
    for (const patch of [
      { previewId: "other" },
      { configDigest: `sha256:${"b".repeat(64)}` },
      { projectRevision: 1 },
      { taskBinding: { ...binding, executionId: "33333333-3333-4333-8333-333333333333" } },
      { workflow: "QUICK" },
    ]) {
      expect(() =>
        decodeTask({ ...task, execution: { ...execution, preview: { ...preview, ...patch } } }),
      ).toThrow();
    }
  });

  it("persists exact prepared model routes without inventing legacy routes", () => {
    const modelRoutes = [
      {
        role: "Developer",
        intent: "standard",
        source: "config",
        profile: "creative",
        provider: "executor-provider",
        model: "executor-model",
      },
      {
        role: "Reviewer",
        intent: "review",
        source: "default",
        profile: "reasoning",
        provider: "review-provider",
        model: "review-model",
      },
    ];
    const current = {
      ...task,
      execution: { ...execution, preview: { ...preview, modelRoutes } },
    };
    expect(decodeTaskJson(encodeTaskJson(decodeTask(current)))).toEqual(current);
    expect(
      decodeTask({ ...task, execution: { ...execution, preview } }).execution?.preview,
    ).not.toHaveProperty("modelRoutes");
    expect(() =>
      decodeTask({
        ...task,
        execution: {
          ...execution,
          preview: { ...preview, modelRoutes: [...modelRoutes].reverse() },
        },
      }),
    ).toThrow();
  });

  it("accepts only selectors and a deduplication key for public creation", () => {
    const decode = Schema.decodeUnknownSync(WeavraTaskCreateInput);
    const input = {
      environmentId: "environment",
      projectId: "project",
      threadId: "thread",
      commandId: "create",
    };
    expect(decode(input)).toEqual(input);
    for (const patch of [
      { cwd: "/other" },
      { taskId },
      { executionId },
      { runId: "run" },
      { generation: 1 },
    ])
      expect(() => decode({ ...input, ...patch })).toThrow();
  });

  it("accepts a reviewed symptom proposal but never a registration digest from the client", () => {
    const decode = Schema.decodeUnknownSync(WeavraTaskDraft);
    const input = {
      context: packet,
      goal: "Fix missing value",
      acceptanceStatements: ["Value is returned"],
      symptomVerification: { criterionIndex: 1, checkId: "value" },
    };
    expect(decode(input)).toEqual(input);
    expect(() =>
      decode({
        ...input,
        symptomVerification: { ...input.symptomVerification, registrationDigest: digest },
      }),
    ).toThrow();
    expect(() =>
      decode({ ...input, symptomVerification: { criterionIndex: 2, checkId: "value" } }),
    ).toThrow();
  });

  it("round-trips selected advisory findings without promoting provenance", () => {
    expect(decodePacket(packet)).toEqual(packet);
    expect(() => decodePacket({ ...packet, authority: "VERIFIED" })).toThrow();
    expect(() =>
      decodePacket({
        ...packet,
        observations: [{ ...packet.observations[0], provenance: "REGISTERED_VERIFIER" }],
      }),
    ).toThrow();
    expect(() => decodePacket({ ...packet, tools: ["write"] })).toThrow();
  });

  it("rejects each field limit and malformed source reference", () => {
    for (const patch of [
      { symptom: "x".repeat(1001) },
      { symptom: "\ud83d\ude00".repeat(501) },
      { observations: Array.from({ length: 9 }, () => packet.observations[0]) },
      { observations: [{ ...packet.observations[0], text: "x".repeat(501) }] },
      { candidateCause: { kind: "HYPOTHESIS", text: "x".repeat(1001) } },
      { uncertainties: ["x".repeat(251)] },
      { uncertainties: Array.from({ length: 9 }, () => "unknown") },
      { constraints: ["x".repeat(251)] },
      { constraints: Array.from({ length: 9 }, () => "constraint") },
      {
        sourceReferences: Array.from({ length: 9 }, (_, index) => ({
          path: `src/${index}`,
          digest,
        })),
      },
      { sourceReferences: [{ path: "../secret", digest }] },
      { sourceReferences: [{ path: "/absolute", digest }] },
      { sourceReferences: [{ path: "src/value.ts", digest: "not-a-digest" }] },
      { sourceReferences: [{ path: "src/value.ts", digest, lines: { start: 3, end: 2 } }] },
      { sourceReferences: [] },
    ]) {
      expect(() => decodePacket({ ...packet, ...patch })).toThrow();
    }
  });

  it("rejects whole UTF-8 packets above 8 KiB rather than truncating", () => {
    const oversized = {
      ...packet,
      observations: Array.from({ length: 8 }, () => ({
        ...packet.observations[0],
        text: "한".repeat(500),
      })),
    };
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(8192);
    expect(() => decodePacket(oversized)).toThrow();
  });

  it("keeps App finished separate from canonical completion", () => {
    expect(decodeTask({ ...task, phase: "finished" }).execution).toBeNull();
    expect(() => decodeTask({ ...task, runStatus: "COMPLETED" })).toThrow();
  });

  it("counts padded message identifiers without normalizing the packet", () => {
    const messagePacket = (messageId: string) => ({
      ...packet,
      observations: [
        {
          text: "A visible message",
          provenance: "USER",
          reference: { kind: "message", threadId: " thread ", messageId },
        },
      ],
    });
    const bounded = messagePacket(" message ");
    expect(decodePacket(bounded)).toEqual(bounded);
    const oversized = messagePacket(" ".repeat(9000) + "m");
    expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(8192);
    expect(() => decodePacket(oversized)).toThrow();
    expect(() => decodeTask({ ...task, context: bounded })).toThrow();
  });

  it("rejects cross-thread observation references", () => {
    expect(() =>
      decodeTask({
        ...task,
        context: {
          ...packet,
          observations: [
            {
              text: "A visible message",
              provenance: "USER",
              reference: { kind: "message", threadId: "other-thread", messageId: "message" },
            },
          ],
        },
      }),
    ).toThrow();
  });

  it("represents unknown receipt explicitly without inventing a Run", () => {
    expect(decodeReceipt({ status: "UNKNOWN", executionId })).toEqual({
      status: "UNKNOWN",
      executionId,
    });
    expect(() => decodeReceipt({ status: "UNKNOWN", executionId, runId: "invented" })).toThrow();
  });

  it("does not expose internal task updates to client orchestration", () => {
    const decode = Schema.decodeUnknownSync(ClientOrchestrationCommand);
    expect(() =>
      decode({
        type: "thread.weavra-task.set",
        commandId: "client-completion",
        threadId: "thread",
        expectedRevision: null,
        expectedOwnershipGeneration: 0,
        task,
      }),
    ).toThrow();
  });
});

it("accepts only an exact recovery selector and App revision, never client Runtime authority", () => {
  const decode = Schema.decodeUnknownSync(WeavraTaskRecoverInput);
  const input = {
    task: { taskId, environmentId: "environment", projectId: "project", threadId: "thread" },
    expectedRevision: 1,
  };
  expect(decode(input)).toEqual(input);
  for (const extra of [
    { cwd: "/foreign" },
    { metadata: {} },
    { runId: "foreign" },
    { executionId },
  ]) {
    expect(() => decode({ ...input, ...extra })).toThrow();
    expect(() => decode({ ...input, task: { ...input.task, ...extra } })).toThrow();
  }
});
