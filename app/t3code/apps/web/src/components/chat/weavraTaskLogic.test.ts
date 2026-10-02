import { MessageId, ThreadId, type WeavraTask } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import {
  buildTaskDraft,
  selectedMessageFinding,
  taskConfirmBlocker,
  taskDraftFields,
  taskMatchesScope,
  taskSendRoute,
  taskStatus,
} from "./weavraTaskLogic";
import { preparedTask, taskScope } from "./weavraTaskTestFixture";

describe("controlled handoff draft", () => {
  it("round-trips the reviewed symptom binding without inventing a registration digest", () => {
    const draft = buildTaskDraft(taskDraftFields(preparedTask()), 2, 123);
    expect(draft.symptomVerification).toEqual({ criterionIndex: 1, checkId: "symptom-test" });
    expect(draft.context).toMatchObject({
      authority: "ADVISORY_ONLY",
      packetVersion: 2,
      reviewedAt: 123,
      sourceReferences: [],
      observations: [],
    });
    expect(draft).not.toHaveProperty("checkout");
    expect(draft).not.toHaveProperty("executionId");
  });
  it("retains a missing criterion mapping as invalid rather than silently dropping the binding", () => {
    const fields = taskDraftFields(preparedTask());
    expect(() => buildTaskDraft({ ...fields, symptomCriterion: "" }, 2, 1)).toThrow();
    expect(() => buildTaskDraft({ ...fields, symptomCheck: "" }, 2, 1)).toThrow();
  });
  it("rejects excessive fields and UTF-8 bytes without truncating", () => {
    const fields = taskDraftFields(preparedTask());
    expect(() => buildTaskDraft({ ...fields, symptom: "a".repeat(1001) }, 2, 1)).toThrow();
    expect(() =>
      buildTaskDraft({ ...fields, constraints: Array(9).fill("constraint").join("\n") }, 2, 1),
    ).toThrow();
    expect(() =>
      buildTaskDraft(
        {
          ...fields,
          symptom: "한".repeat(1000),
          hypothesis: "한".repeat(1000),
          constraints: Array(8).fill("한".repeat(250)).join("\n"),
        },
        2,
        1,
      ),
    ).toThrow();
    expect(fields.symptom).toBe("Observed failure");
  });
  it("rejects malformed or fabricated source metadata instead of filling missing digests", () => {
    const fields = taskDraftFields(preparedTask());
    expect(() => buildTaskDraft({ ...fields, sources: '[{"path":"src/fix.ts"}]' }, 2, 1)).toThrow();
    expect(() =>
      buildTaskDraft({ ...fields, sources: '[{"path":"../secret","digest":"sha256:bad"}]' }, 2, 1),
    ).toThrow();
  });
  it("requires explicit visible findings and retains source provenance", () => {
    const finding = selectedMessageFinding({
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("visible"),
      role: "assistant",
      text: "Hypothesis, not verifier evidence",
    });
    expect(finding.provenance).toBe("MODEL");
    expect(finding.reference).toEqual({
      kind: "message",
      threadId: "thread",
      messageId: "visible",
    });
    expect(() =>
      selectedMessageFinding({
        threadId: ThreadId.make("thread"),
        messageId: MessageId.make("visible"),
        role: "user",
        text: "x".repeat(501),
      }),
    ).toThrow();
  });
});

describe("controlled consent and ownership", () => {
  const admission = () => ({
    task: preparedTask(),
    fresh: true,
    canOperate: true,
    edited: false,
    reviewed: true,
    now: 100,
  });
  it("admits only fresh explicit unchanged consent", () => {
    expect(taskConfirmBlocker(admission())).toBeNull();
    for (const override of [
      { fresh: false },
      { canOperate: false },
      { edited: true },
      { reviewed: false },
      { now: 4102444800000 },
    ])
      expect(taskConfirmBlocker({ ...admission(), ...override })).not.toBeNull();
  });
  it("blocks missing frozen models/checks and non-confirmable phases", () => {
    const task = preparedTask();
    const execution = task.execution!;
    const { modelRoutes: _routes, ...previewWithoutRoutes } = execution.preview!;
    expect(
      taskConfirmBlocker({
        ...admission(),
        task: { ...task, execution: { ...execution, preview: previewWithoutRoutes } },
      }),
    ).not.toBeNull();
    expect(
      taskConfirmBlocker({
        ...admission(),
        task: {
          ...task,
          execution: { ...execution, preview: { ...execution.preview!, checks: [] } },
        },
      }),
    ).not.toBeNull();
    expect(
      taskConfirmBlocker({ ...admission(), task: { ...task, phase: "attention-required" } }),
    ).not.toBeNull();
  });
  it("never routes known ownership to free execution on capability loss", () => {
    const input = {
      supported: true,
      discovered: true,
      fresh: true,
      canOperate: true,
      task: preparedTask(),
    };
    expect(taskSendRoute(input)).toBe("followup");
    for (const override of [
      { supported: false },
      { discovered: false },
      { fresh: false },
      { canOperate: false },
    ])
      expect(taskSendRoute({ ...input, ...override })).toBe("blocked");
    expect(taskSendRoute({ ...input, task: { ...input.task, phase: "analysis" } })).toBe(
      "analysis",
    );
    expect(taskSendRoute({ ...input, task: null })).toBe("free");
    expect(taskSendRoute({ ...input, supported: false, discovered: false, task: null })).toBe(
      "free",
    );
  });
  it("does not mistake finished phase or model findings for canonical completion", () => {
    const task: WeavraTask = {
      ...preparedTask(),
      phase: "finished",
      ownership: { generation: 3, state: "released" },
    };
    expect(taskStatus(task)).not.toContain("COMPLETED");
    expect(taskMatchesScope(task, taskScope())).toBe(true);
    expect(taskMatchesScope(task, { ...taskScope(), threadId: ThreadId.make("other") })).toBe(
      false,
    );
  });
});
