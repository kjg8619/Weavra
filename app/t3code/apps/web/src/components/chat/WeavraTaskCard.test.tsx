import { CommandId, MessageId, WeavraTaskId, type WeavraTask } from "@t3tools/contracts";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WeavraTaskCard } from "./WeavraTaskCard";
import type { WeavraTaskController } from "./useWeavraTask";
import { preparedTask, taskScope } from "./weavraTaskTestFixture";
import { useProjectControlDrafts } from "./projectControlDraft";

vi.mock("../ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("../ui/input", () => ({ Input: (props: ComponentProps<"input">) => <input {...props} /> }));
vi.mock("../ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));
vi.mock("../ui/badge", () => ({ Badge: (props: ComponentProps<"span">) => <span {...props} /> }));

let renderer: ReactTestRenderer;
let task: WeavraTask;
let controller: WeavraTaskController;
const command = vi.fn<WeavraTaskController["act"]>();
function tree(messages?: ComponentProps<typeof WeavraTaskCard>["messages"]) {
  return (
    <WeavraTaskCard
      controller={controller}
      scope={taskScope(task)}
      supported
      analysisSupported
      connected
      messages={
        messages ?? [
          {
            id: MessageId.make("visible"),
            role: "assistant",
            text: "Possible cause",
            streaming: false,
            turnId: null,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
          {
            id: MessageId.make("hidden"),
            role: "reasoning",
            text: "Private reasoning",
            streaming: false,
            turnId: null,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
        ]
      }
      provider="codex"
    />
  );
}
const button = (label: string) =>
  renderer.root.findAllByType("button").find((node) => node.children.join("") === label)!;
const input = (suffix: string) =>
  renderer.root.findAll(
    (node) =>
      typeof node.props.id === "string" &&
      node.props.id.endsWith(suffix) &&
      (node.type === "textarea" || node.type === "input" || node.type === "select"),
  )[0]!;
const consent = () => renderer.root.findByProps({ type: "checkbox" });

beforeEach(async () => {
  useProjectControlDrafts.setState({ byTask: {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  task = preparedTask();
  command.mockReset().mockResolvedValue(task);
  controller = {
    task,
    tasks: [task],
    ref: { ...taskScope(task), taskId: task.id },
    fresh: true,
    recoverySupported: true,
    canOperate: true,
    busy: false,
    error: null,
    dirtyWorkspace: null,
    setError: vi.fn(),
    route: "followup",
    act: command,
    analyze: vi.fn(),
    followup: vi.fn(),
    refresh: vi.fn(),
    discovered: true,
    chooseFreeCoding: vi.fn(),
  };
  await act(() => {
    renderer = create(tree());
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("dirty workspace refusal", () => {
  const files = [".gitignore", "notes.txt"];
  const render = async (truncated = false) => {
    task = {
      ...task,
      phase: "analysis",
      execution: null,
      ownership: { ...task.ownership, state: "analysis" },
    };
    controller = {
      ...controller,
      task,
      tasks: [task],
      error: "PREPARE_REJECTED (PROJECT_CHANGED): dirty",
      dirtyWorkspace: { reason: "DIRTY_WORKSPACE", files, truncated },
    };
    await act(() => renderer.unmount());
    await act(() => {
      renderer = create(tree());
    });
  };
  const listed = () =>
    renderer.root
      .findByProps({ "data-weavra": "dirty-workspace" })
      .findAllByType("li")
      .map((node) => node.children.join(""));
  const dialogs = () => renderer.root.findAllByProps({ role: "alertdialog" });

  it("lists the two dirty files and commits once only after the confirmation dialog", async () => {
    await render();
    expect(listed()).toEqual(files);
    await act(() => button("이 변경을 기준 커밋에 포함").props.onClick());
    expect(dialogs()).toHaveLength(1);
    expect(command).not.toHaveBeenCalled();
    expect(
      dialogs()[0]!
        .findAllByType("li")
        .map((node) => node.children.join("")),
    ).toEqual(files);
    await act(() => button("커밋하기").props.onClick());
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0]?.[0]).toEqual({
      type: "commitDirtyBaseline",
      input: {
        task: { ...taskScope(task), taskId: task.id },
        expectedRevision: task.revision,
        files,
        consent: true,
      },
    });
  });

  it("sends no command when the confirmation dialog is cancelled", async () => {
    await render();
    await act(() => button("이 변경을 기준 커밋에 포함").props.onClick());
    await act(() => button("취소").props.onClick());
    expect(dialogs()).toHaveLength(0);
    expect(command).not.toHaveBeenCalled();
  });

  it("does not offer the commit when the list is truncated", async () => {
    await render(true);
    expect(button("이 변경을 기준 커밋에 포함").props.disabled).toBe(true);
    expect(
      renderer.root.findAllByProps({ "data-weavra": "dirty-workspace-truncated" }),
    ).toHaveLength(1);
    expect(command).not.toHaveBeenCalled();
  });

  it("copies the file list to the clipboard", async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await render();
    await act(() => button("파일 목록 복사").props.onClick());
    expect(writeText).toHaveBeenCalledWith(".gitignore\nnotes.txt");
    expect(
      renderer.root.findAllByProps({ role: "status" }).map((n) => n.children.join("")),
    ).toContain("파일 목록을 복사했어요.");
    expect(command).not.toHaveBeenCalled();
  });
});

describe("reviewed task handoff", () => {
  it("keeps a current prepared preview reviewable when older same-scope history exists", async () => {
    const previous = task;
    task = { ...task, id: WeavraTaskId.make("00000000-0000-4000-8000-000000000014") };
    controller = {
      ...controller,
      task,
      tasks: [previous, task],
      ref: { ...taskScope(task), taskId: task.id },
    };
    await act(() => renderer.unmount());
    await act(() => {
      renderer = create(tree());
    });
    expect(renderer.root.findAllByProps({ type: "checkbox" })).toHaveLength(1);
    expect(button("Runtime 구현 확인")).toBeDefined();
    expect(command).not.toHaveBeenCalled();
  });

  it("uses the saved goal when a blank override is prepared", async () => {
    const saved = task.execution?.preview?.goal;
    if (!saved) throw new Error("Expected stored preview");
    await act(() => input("-goal").props.onChange({ target: { value: " " } }));
    await act(() => button("검토한 내용으로 구현 준비").props.onClick());
    expect(command).toHaveBeenCalledTimes(1);
    expect(command.mock.calls[0]?.[0]).toMatchObject({
      input: { draft: { goal: saved } },
    });
  });

  it("keeps local edits when the project panel closes and opens again", async () => {
    await act(() =>
      input("-goal").props.onChange({ target: { value: "Implement the local draft" } }),
    );
    await act(() => renderer.unmount());
    await act(() => {
      renderer = create(tree());
    });
    expect(input("-goal").props.value).toBe("Implement the local draft");
    expect(command).not.toHaveBeenCalled();
  });

  it("fills a new task from the current chat candidate without preparing or confirming it", async () => {
    task = { ...task, phase: "analysis", execution: null, context: null };
    controller = { ...controller, task, tasks: [task] };
    const packet = {
      version: 1,
      goal: "Implement the inventory screen",
      symptom: "Inventory is not implemented",
      criteria: ["Items are listed"],
    };
    await act(() => renderer.unmount());
    await act(() => {
      renderer = create(
        tree([
          {
            id: MessageId.make("chat-draft"),
            role: "assistant",
            text: "```weavra-control\n" + JSON.stringify(packet) + "\n```",
            streaming: false,
            turnId: null,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt,
          },
        ]),
      );
    });
    expect(input("-goal").props.value).toBe("Implement the inventory screen");
    expect(input("-criteria").props.value).toBe("Items are listed");
    expect(command).not.toHaveBeenCalled();
  });

  it("reuses same-scope history for a new task without carrying execution approval", async () => {
    const previous = task;
    task = {
      ...task,
      id: WeavraTaskId.make("00000000-0000-4000-8000-000000000012"),
      phase: "analysis",
      execution: null,
      context: null,
    };
    controller = {
      ...controller,
      task,
      tasks: [previous, task],
      ref: { ...taskScope(task), taskId: task.id },
    };
    await act(() => renderer.unmount());
    await act(() => {
      renderer = create(tree());
    });
    expect(input("-goal").props.value).toBe(previous.execution?.preview?.goal);
    expect(input("-criteria").props.value).toBe(
      previous.execution?.preview?.acceptanceCriteria.map((item) => item.statement).join("\n"),
    );
    expect(button("Runtime 구현 확인")).toBeUndefined();
    expect(command).not.toHaveBeenCalled();
  });

  it.each(["absent", "stale", "expired"] as const)(
    "offers no binding choices from an %s preview",
    async (state) => {
      vi.useFakeTimers();
      if (!task.execution?.preview) throw new Error("Expected preview");
      if (state === "absent") {
        task = { ...task, phase: "analysis", execution: null };
      } else if (state === "expired") {
        task = {
          ...task,
          execution: {
            ...task.execution,
            preview: { ...task.execution.preview, expiresAt: 1 },
          },
        };
      }
      controller = { ...controller, task, fresh: state !== "stale" };
      await act(() => renderer.unmount());
      await act(() => {
        renderer = create(tree());
      });
      for (const suffix of ["-symptom-criterion", "-symptom-check"]) {
        const selector = input(suffix);
        expect(selector.props.disabled).toBe(true);
        expect(selector.findAllByType("option").map((node) => node.props.value)).toEqual([""]);
      }
      expect(command).not.toHaveBeenCalled();
    },
  );

  it("offers only preview criteria and required checks, then reprepares the selected binding", async () => {
    if (!task.execution?.preview) throw new Error("Expected preview");
    const preview = task.execution.preview;
    task = {
      ...task,
      execution: {
        ...task.execution,
        preview: {
          ...preview,
          checks: [...preview.checks, { id: "optional-check", kind: "custom", required: false }],
          acceptanceCriteria: [
            ...preview.acceptanceCriteria,
            {
              id: "AC-002",
              statement: "Preserve the neighboring behavior",
              checkIds: ["symptom-test"],
              reviewRequired: true,
            },
          ],
        },
      },
    };
    controller = { ...controller, task };
    await act(() => renderer.unmount());
    await act(() => {
      renderer = create(tree());
    });
    const criteria = input("-symptom-criterion");
    const checks = input("-symptom-check");
    expect(criteria.findAllByType("option").map((node) => node.props.value)).toEqual([
      "",
      "1",
      "2",
    ]);
    expect(checks.findAllByType("option").map((node) => node.props.value)).toEqual([
      "",
      "symptom-test",
    ]);
    await act(() => consent().props.onChange({ target: { checked: true } }));
    await act(() => criteria.props.onChange({ target: { value: "2" } }));
    expect(renderer.root.findAllByProps({ type: "checkbox" })).toHaveLength(0);
    expect(command).not.toHaveBeenCalled();
    await act(() => button("검토한 내용으로 구현 준비").props.onClick());
    const action = command.mock.calls[0]?.[0];
    if (action?.type !== "reprepare") throw new Error("Expected explicit reprepare");
    expect(action.input.draft.symptomVerification).toEqual({
      criterionIndex: 2,
      checkId: "symptom-test",
    });
  });

  it("keeps task and checkout identity in a keyboard-native disclosure", async () => {
    task = { ...task, phase: "analysis" };
    controller = { ...controller, task };
    await act(() => renderer.unmount());
    await act(() => {
      renderer = create(tree());
    });
    const disclosure = renderer.root
      .findAllByType("details")
      .find((node) =>
        node
          .findAllByType("summary")
          .some((summary) => summary.children.join("") === "작업 및 checkout 진단"),
      );
    expect(disclosure).toBeDefined();
    expect(disclosure?.props.open).toBeUndefined();
    expect(
      disclosure?.findAll((node) => node.children.join("").includes(task.checkout.canonicalCwd))
        .length,
    ).toBeGreaterThan(0);
  });

  it("clears both binding fields when criteria change and does not restore them on revert", async () => {
    await act(() => consent().props.onChange({ target: { checked: true } }));
    const original = input("-criteria").props.value;
    await act(() =>
      input("-criteria").props.onChange({
        target: { value: `A different first criterion\n${original}` },
      }),
    );
    expect(input("-symptom-criterion").props.value).toBe("");
    expect(input("-symptom-check").props.value).toBe("");
    expect(input("-symptom-criterion").props.disabled).toBe(true);
    await act(() => input("-criteria").props.onChange({ target: { value: original } }));
    expect(input("-symptom-criterion").props.value).toBe("");
    expect(input("-symptom-check").props.value).toBe("");
    expect(renderer.root.findAllByProps({ type: "checkbox" })).toHaveLength(0);
    expect(command).not.toHaveBeenCalled();
    await act(() => button("검토한 내용으로 구현 준비").props.onClick());
    const action = command.mock.calls[0]?.[0];
    if (action?.type !== "reprepare") throw new Error("Expected explicit reprepare");
    expect(action.input.draft.symptomVerification).toBeUndefined();
  });

  it("shows bounded readable source previews without selecting or adding a finding", async () => {
    const source = {
      id: MessageId.make("opaque-source-id"),
      role: "assistant" as const,
      text: `  Visible proof\n${"한😀".repeat(150)}`,
      streaming: false,
      turnId: null,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
    await act(() => renderer.update(tree([source])));
    const option = renderer.root.findByProps({ value: source.id });
    const label = option.children.join("");
    expect(label).toContain("Visible proof");
    expect(label).not.toContain("\n");
    expect(Array.from(label).length).toBeLessThanOrEqual(135);
    expect(label).not.toMatch(/[\uD800-\uDFFF]/u);
    expect(input("-message").props.value).toBe("");
    expect(command).not.toHaveBeenCalled();

    await act(() => input("-message").props.onChange({ target: { value: source.id } }));
    expect(input("-excerpt").props.value).toBe("");
    expect(button("선택한 관찰 내용 포함").props.disabled).toBe(true);
    expect(command).not.toHaveBeenCalled();
  });

  it("keeps a nonmatching excerpt and adds no finding", async () => {
    await act(() => input("-message").props.onChange({ target: { value: "visible" } }));
    await act(() => input("-excerpt").props.onChange({ target: { value: "Not in that message" } }));
    await act(() => button("선택한 관찰 내용 포함").props.onClick());
    expect(input("-excerpt").props.value).toBe("Not in that message");
    expect(input("-finding-0")).toBeUndefined();
    expect(command).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  });

  it("measures submitted context without counting goal edits or a stale review timestamp", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(9);
    try {
      await act(() => renderer.unmount());
      await act(() => {
        renderer = create(tree());
      });
      const displayedBytes = () =>
        Number(renderer.root.findByType("output").children.join("").match(/^\d+/)?.[0]);
      const initialBytes = displayedBytes();
      clock.mockReturnValue(10);
      await act(() => input("-goal").props.onChange({ target: { value: "A different goal" } }));
      expect(displayedBytes()).toBe(initialBytes);
      clock.mockReturnValue(100);
      await act(() => button("검토한 내용으로 구현 준비").props.onClick());
      const action = command.mock.calls[0]?.[0];
      if (action?.type !== "reprepare") throw new Error("Expected explicit preparation");
      expect(action.input.draft.context.reviewedAt).toBe(100);
      expect(displayedBytes()).toBe(
        new TextEncoder().encode(JSON.stringify(action.input.draft.context)).byteLength,
      );
    } finally {
      clock.mockRestore();
    }
  });

  it("keeps the submitted byte count when the prepared packet version reaches nine", async () => {
    if (!task.context || !task.execution?.preview) throw new Error("Expected prepared fixture");
    const initialBinding = { ...task.execution.binding, packetVersion: 8 };
    task = {
      ...task,
      context: { ...task.context, packetVersion: 8 },
      execution: {
        ...task.execution,
        binding: initialBinding,
        preview: { ...task.execution.preview, taskBinding: initialBinding },
      },
    };
    controller = { ...controller, task };
    await act(() => renderer.update(tree()));
    await act(() => input("-goal").props.onChange({ target: { value: "Reviewed goal" } }));
    await act(() => button("검토한 내용으로 구현 준비").props.onClick());
    const action = command.mock.calls[0]?.[0];
    if (action?.type !== "reprepare" || !task.execution?.preview) {
      throw new Error("Expected prepared response");
    }
    expect(action.input.draft.context.packetVersion).toBe(9);
    const binding = { ...task.execution.binding, packetVersion: 9 };
    task = {
      ...task,
      revision: task.revision + 1,
      context: action.input.draft.context,
      execution: {
        ...task.execution,
        binding,
        preview: { ...task.execution.preview, taskBinding: binding, goal: action.input.draft.goal },
      },
    };
    controller = { ...controller, task };
    await act(() => renderer.update(tree()));
    const displayed = Number(
      renderer.root.findByType("output").children.join("").match(/^\d+/)?.[0],
    );
    expect(displayed).toBe(
      new TextEncoder().encode(JSON.stringify(action.input.draft.context)).byteLength,
    );
  });

  it.each([
    { field: "-sources", value: "[" },
    { field: "-sources", value: "{}" },
    { field: "-goal", value: "x".repeat(2049) },
  ])("keeps invalid $field editable and associates its error", async ({ field, value }) => {
    await act(() => input(field).props.onChange({ target: { value } }));
    await act(() => button("검토한 내용으로 구현 준비").props.onClick());
    const invalid = input(field);
    expect(command).not.toHaveBeenCalled();
    expect(invalid.props.value).toBe(value);
    expect(invalid.props["aria-invalid"]).toBe(true);
    const errorId = `${invalid.props.id}-error`;
    expect(invalid.props["aria-describedby"].split(" ")).toContain(errorId);
    expect(renderer.root.findByProps({ id: errorId })).toBeDefined();
  });

  it("offers explicit abort and new preparation after an unconfirmed handoff drain fails", async () => {
    task = {
      ...task,
      phase: "handoff",
      revision: 4,
      ownership: { state: "draining", generation: 4 },
    };
    controller = { ...controller, task, tasks: [task] };
    await act(() => renderer.update(tree()));
    expect(button("Runtime 구현 확인")).toBeUndefined();
    expect(button("검토한 내용으로 구현 준비")).toBeDefined();
    await act(() => button("통제 작업 중단").props.onClick());
    expect(command).toHaveBeenCalledExactlyOnceWith({
      type: "abort",
      input: {
        task: controller.ref,
        expectedRevision: 4,
      },
    });
  });

  it("never confirms on load and sends only the exact task reference/revision after consent", async () => {
    expect(command).not.toHaveBeenCalled();
    expect(button("Runtime 구현 확인").props.disabled).toBe(true);
    await act(() => consent().props.onChange({ target: { checked: true } }));
    await act(() => button("Runtime 구현 확인").props.onClick());
    expect(command).toHaveBeenCalledOnce();
    expect(command.mock.calls[0]?.[0]).toEqual({
      type: "confirm",
      input: {
        task: controller.ref,
        expectedRevision: task.revision,
        commandId: expect.any(String),
      },
    });
    expect(command.mock.calls[0]?.[0].input).not.toHaveProperty("draft");
    expect(button("Runtime 구현 확인").props.disabled).toBe(true);
  });
  it("edits invalidate consent even if the text is reverted", async () => {
    await act(() => consent().props.onChange({ target: { checked: true } }));
    await act(() => input("-goal").props.onChange({ target: { value: "Changed goal" } }));
    await act(() => input("-goal").props.onChange({ target: { value: "Fix observed failure" } }));
    expect(renderer.root.findAllByProps({ type: "checkbox" })).toHaveLength(0);
    expect(command).not.toHaveBeenCalled();
    await act(() => button("검토한 내용으로 구현 준비").props.onClick());
    const action = command.mock.calls[0]?.[0];
    expect(action?.type).toBe("reprepare");
    if (action?.type !== "reprepare") throw new Error("Expected explicit new attempt");
    expect(action.input.draft.symptomVerification).toEqual({
      criterionIndex: 1,
      checkId: "symptom-test",
    });
    expect(action.input.draft.context.authority).toBe("ADVISORY_ONLY");
  });
  it("does not restore consent across a disconnect/reconnect", async () => {
    await act(() => consent().props.onChange({ target: { checked: true } }));
    controller = { ...controller, fresh: false };
    await act(() => renderer.update(tree()));
    controller = { ...controller, fresh: true };
    await act(() => renderer.update(tree()));
    expect(consent().props.checked).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });
  it("requires new review when the server revision changes", async () => {
    await act(() => consent().props.onChange({ target: { checked: true } }));
    task = { ...task, revision: task.revision + 1 };
    controller = { ...controller, task };
    await act(() => renderer.update(tree()));
    expect(consent().props.checked).toBe(false);
    expect(command).not.toHaveBeenCalled();
  });
  it("blocks mutation callbacks in read-only scope", async () => {
    controller = { ...controller, canOperate: false };
    await act(() => renderer.update(tree()));
    expect(consent().props.disabled).toBe(true);
    await act(() => button("새 스냅샷 준비").props.onClick());
    await act(() => button("Runtime 구현 확인").props.onClick());
    expect(command).not.toHaveBeenCalled();
  });
  it("selects only visible text, preserves MODEL then marks actual manual edits USER", async () => {
    expect(
      renderer.root.findAllByType("option").some((option) => option.props.value === "hidden"),
    ).toBe(false);
    await act(() => input("-message").props.onChange({ target: { value: "visible" } }));
    await act(() => input("-excerpt").props.onChange({ target: { value: "Possible cause" } }));
    await act(() => button("선택한 관찰 내용 포함").props.onClick());
    await act(() => button("검토한 내용으로 구현 준비").props.onClick());
    let action = command.mock.calls.at(-1)?.[0];
    if (action?.type !== "reprepare") throw new Error("Expected reprepare");
    expect(action.input.draft.context.observations[0]).toMatchObject({
      provenance: "MODEL",
      reference: { kind: "message", messageId: "visible" },
    });
    await act(() => input("-finding-0").props.onChange({ target: { value: "Corrected cause" } }));
    await act(() => button("검토한 내용으로 구현 준비").props.onClick());
    action = command.mock.calls.at(-1)?.[0];
    if (action?.type !== "reprepare") throw new Error("Expected reprepare");
    expect(action.input.draft.context.observations[0]?.provenance).toBe("USER");
  });
  it("rejects an oversized packet before crossing the callback boundary", async () => {
    await act(() => input("-symptom").props.onChange({ target: { value: "한".repeat(1000) } }));
    await act(() => input("-hypothesis").props.onChange({ target: { value: "한".repeat(1000) } }));
    await act(() =>
      input("-constraints").props.onChange({
        target: { value: Array(8).fill("한".repeat(250)).join("\n") },
      }),
    );
    await act(() => button("검토한 내용으로 구현 준비").props.onClick());
    expect(command).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
    expect(renderer.root.findByType("output").props["aria-invalid"]).toBe(true);
    expect(input("-symptom").props.value).toBe("한".repeat(1000));
  });
});

describe("explicit interrupted-task recovery", () => {
  async function confirmed() {
    if (!task.execution) throw new Error("Fixture must be prepared");
    task = {
      ...task,
      phase: "attention-required",
      ownership: { ...task.ownership, state: "reconciling" },
      execution: { ...task.execution, confirmCommandId: CommandId.make("confirmed") },
    };
    controller = { ...controller, task };
    await act(() => renderer.update(tree()));
  }
  it("never invokes recovery on mount or refresh and sends only selector/revision explicitly", async () => {
    await confirmed();
    expect(command).not.toHaveBeenCalled();
    expect(button("Runtime 구현 확인")).toBeUndefined();
    await act(() => button("작업 상태 새로고침").props.onClick());
    expect(command.mock.calls[0]?.[0]).toEqual({ type: "reconcile", input: controller.ref });
    command.mockClear();
    await act(() => button("중단된 작업 복구 확인").props.onClick());
    expect(command).toHaveBeenCalledExactlyOnceWith({
      type: "recover",
      input: { task: controller.ref, expectedRevision: task.revision },
    });
  });
  for (const blocked of ["stale", "capability", "read-only", "busy"] as const) {
    it(`disables recovery and callback for ${blocked}`, async () => {
      await confirmed();
      controller = {
        ...controller,
        fresh: blocked !== "stale",
        recoverySupported: blocked !== "capability",
        canOperate: blocked !== "read-only",
        busy: blocked === "busy",
      };
      await act(() => renderer.update(tree()));
      expect(button("중단된 작업 복구 확인").props.disabled).toBe(true);
      await act(() => button("중단된 작업 복구 확인").props.onClick());
      expect(command).not.toHaveBeenCalled();
    });
  }
  it("never offers recovery for unconfirmed or released history", async () => {
    expect(button("중단된 작업 복구 확인")).toBeUndefined();
    await confirmed();
    task = { ...task, phase: "finished", ownership: { ...task.ownership, state: "released" } };
    controller = { ...controller, task };
    await act(() => renderer.update(tree()));
    expect(button("중단된 작업 복구 확인")).toBeUndefined();
    expect(command).not.toHaveBeenCalled();
  });
});

describe("ambiguous goal mode", () => {
  const invalidGoal =
    "PREPARE_REJECTED (INVALID_GOAL): 준비 요청이 거부됐으며 Run 실행을 허용하지 않았어요. 목표만으로는 읽기 전용인지 수정인지 정할 수 없어요.";
  const radios = () => renderer.root.findAllByProps({ type: "radio" });
  const radio = (mode: string) => radios().find((node) => node.props.value === mode)!;
  async function rejectedPrepare(error: string) {
    command.mockResolvedValueOnce(null);
    await act(() =>
      input("-goal").props.onChange({ target: { value: "Look into the login flow" } }),
    );
    await act(() => button("검토한 내용으로 구현 준비").props.onClick());
    expect(command).toHaveBeenCalledTimes(1);
    controller = { ...controller, error };
    await act(() => renderer.update(tree()));
  }

  it("offers the choice only after INVALID_GOAL and sends nothing until a mode is chosen", async () => {
    await rejectedPrepare(
      "PREPARE_REJECTED (INVALID_CRITERIA): 준비 요청이 거부됐으며 Run 실행을 허용하지 않았어요.",
    );
    expect(radios()).toHaveLength(0);
    expect(button("다시 준비")).toBeUndefined();
    controller = { ...controller, error: invalidGoal };
    await act(() => renderer.update(tree()));
    expect(radios()).toHaveLength(2);
    expect(radios().some((node) => node.props.checked)).toBe(false);
    expect(button("다시 준비").props.disabled).toBe(true);
    await act(() => button("다시 준비").props.onClick());
    expect(command).toHaveBeenCalledTimes(1);
    expect(input("-goal").props.value).toBe("Look into the login flow");
  });

  it("keeps the chosen tag visible in the goal and saved draft, then reprepares the same task", async () => {
    await rejectedPrepare(invalidGoal);
    await act(() => radio("edit").props.onChange({ target: { checked: true } }));
    expect(input("-goal").props.value).toBe("[수정] Look into the login flow");
    expect(radio("edit").props.checked).toBe(true);
    await act(() => radio("read-only").props.onChange({ target: { checked: true } }));
    expect(input("-goal").props.value).toBe("[읽기 전용] Look into the login flow");
    await act(() => radio("edit").props.onChange({ target: { checked: true } }));
    expect(button("다시 준비").props.disabled).toBe(false);
    await act(() => button("다시 준비").props.onClick());
    expect(command).toHaveBeenCalledTimes(2);
    const action = command.mock.calls[1]?.[0];
    if (action?.type !== "reprepare") throw new Error("Expected reprepare in the same scope");
    expect(action.input.task).toEqual(controller.ref);
    expect(action.input.draft.goal.startsWith("[수정] ")).toBe(true);
    await act(() => renderer.unmount());
    await act(() => {
      renderer = create(tree());
    });
    expect(input("-goal").props.value).toBe("[수정] Look into the login flow");
  });
});
