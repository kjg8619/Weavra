import { CommandId, MessageId, type WeavraTask } from "@t3tools/contracts";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WeavraTaskCard } from "./WeavraTaskCard";
import type { WeavraTaskController } from "./useWeavraTask";
import { preparedTask, taskScope } from "./weavraTaskTestFixture";

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
function tree() {
  return (
    <WeavraTaskCard
      controller={controller}
      scope={taskScope(task)}
      supported
      analysisSupported
      connected
      messages={[
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
      ]}
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
  vi.unstubAllGlobals();
});

describe("reviewed task handoff", () => {
  it("offers explicit abort and new preparation after an unconfirmed handoff drain fails", async () => {
    task = {
      ...task,
      phase: "handoff",
      revision: 4,
      ownership: { state: "draining", generation: 4 },
    };
    controller = { ...controller, task, tasks: [task] };
    await act(() => renderer.update(tree()));
    expect(button("Confirm Runtime implementation")).toBeUndefined();
    expect(button("Prepare reviewed handoff")).toBeDefined();
    await act(() => button("Stop controlled task").props.onClick());
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
    expect(button("Confirm Runtime implementation").props.disabled).toBe(true);
    await act(() => consent().props.onChange({ target: { checked: true } }));
    await act(() => button("Confirm Runtime implementation").props.onClick());
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
    expect(button("Confirm Runtime implementation").props.disabled).toBe(true);
  });
  it("edits invalidate consent even if the text is reverted", async () => {
    await act(() => consent().props.onChange({ target: { checked: true } }));
    await act(() => input("-goal").props.onChange({ target: { value: "Changed goal" } }));
    await act(() => input("-goal").props.onChange({ target: { value: "Fix observed failure" } }));
    expect(renderer.root.findAllByProps({ type: "checkbox" })).toHaveLength(0);
    expect(command).not.toHaveBeenCalled();
    await act(() => button("Prepare reviewed handoff").props.onClick());
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
    await act(() => button("Prepare new snapshot").props.onClick());
    await act(() => button("Confirm Runtime implementation").props.onClick());
    expect(command).not.toHaveBeenCalled();
  });
  it("selects only visible text, preserves MODEL then marks actual manual edits USER", async () => {
    expect(
      renderer.root.findAllByType("option").some((option) => option.props.value === "hidden"),
    ).toBe(false);
    await act(() => input("-message").props.onChange({ target: { value: "visible" } }));
    await act(() => input("-excerpt").props.onChange({ target: { value: "Possible cause" } }));
    await act(() => button("Include selected finding").props.onClick());
    await act(() => button("Prepare reviewed handoff").props.onClick());
    let action = command.mock.calls.at(-1)?.[0];
    if (action?.type !== "reprepare") throw new Error("Expected reprepare");
    expect(action.input.draft.context.observations[0]).toMatchObject({
      provenance: "MODEL",
      reference: { kind: "message", messageId: "visible" },
    });
    await act(() => input("-finding-0").props.onChange({ target: { value: "Corrected cause" } }));
    await act(() => button("Prepare reviewed handoff").props.onClick());
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
    await act(() => button("Prepare reviewed handoff").props.onClick());
    expect(command).not.toHaveBeenCalled();
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
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
    expect(button("Confirm Runtime implementation")).toBeUndefined();
    await act(() => button("Refresh task state").props.onClick());
    expect(command.mock.calls[0]?.[0]).toEqual({ type: "reconcile", input: controller.ref });
    command.mockClear();
    await act(() => button("Recover interrupted task").props.onClick());
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
      expect(button("Recover interrupted task").props.disabled).toBe(true);
      await act(() => button("Recover interrupted task").props.onClick());
      expect(command).not.toHaveBeenCalled();
    });
  }
  it("never offers recovery for unconfirmed or released history", async () => {
    expect(button("Recover interrupted task")).toBeUndefined();
    await confirmed();
    task = { ...task, phase: "finished", ownership: { ...task.ownership, state: "released" } };
    controller = { ...controller, task };
    await act(() => renderer.update(tree()));
    expect(button("Recover interrupted task")).toBeUndefined();
    expect(command).not.toHaveBeenCalled();
  });
});
