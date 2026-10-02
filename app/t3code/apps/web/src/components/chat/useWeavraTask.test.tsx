import { CommandId, ThreadId, WeavraTaskId, type WeavraTask } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { useWeavraTask } from "./useWeavraTask";
import { preparedTask, runTask, taskScope } from "./weavraTaskTestFixture";
import { buildTaskDraft, taskDraftFields } from "./weavraTaskLogic";

const mocks = vi.hoisted(() => ({
  observation: {} as unknown,
  scopes: ["orchestration:operate"],
  list: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => mocks.observation }));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../state/session", () => ({
  useEnvironmentSessionState: () => ({
    data: { authenticated: true, scopes: mocks.scopes },
    hasError: false,
    isPending: false,
  }),
}));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { label: string }) =>
    command.label === "chat:weavra-task-list" ? mocks.list : mocks.execute,
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  createEnvironmentCommand: (_runtime: unknown, options: unknown) => options,
  squashAtomCommandFailure: (failure: unknown) => failure,
}));
vi.mock("@t3tools/client-runtime/state/weavraTask", () => ({
  createEnvironmentWeavraTaskStateAtoms: () => ({ stateAtom: () => ({}) }),
  isFreshWeavraTaskObservation: (state: { support: string; connection: string; stale: boolean }) =>
    state.support === "supported" && state.connection === "CONNECTED" && !state.stale,
  requestWeavraTask: vi.fn(),
}));

let renderer: ReactTestRenderer;
let controller: ReturnType<typeof useWeavraTask>;
let props: Parameters<typeof useWeavraTask>[0];
function Probe() {
  const value = useWeavraTask(props);
  useLayoutEffect(() => {
    controller = value;
  });
  return null;
}
async function render() {
  await act(() => {
    renderer.update(<Probe />);
  });
}

function deferred<A>() {
  let complete: (value: A) => void;
  const promise = new Promise<A>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: (value: A) => complete(value) };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const task = preparedTask();
  props = {
    scope: taskScope(task),
    environmentId: task.environmentId,
    supported: true,
    analysisSupported: true,
    recoverySupported: true,
    connected: true,
  };
  mocks.scopes = ["orchestration:operate"];
  mocks.observation = AsyncResult.success({
    support: "supported",
    connection: "CONNECTED",
    stale: false,
    task,
    errorCode: null,
  });
  mocks.list.mockReset().mockResolvedValue({ _tag: "Success", value: [task] });
  mocks.execute.mockReset().mockResolvedValue({ _tag: "Success", value: task });
  await act(() => {
    renderer = create(<Probe />);
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("task-scoped client composition", () => {
  it("binds cancellation to the selected Run and its current state revision", async () => {
    const running = runTask("RUNNING");
    mocks.list.mockResolvedValue({ _tag: "Success", value: [running] });
    mocks.observation = AsyncResult.success({
      support: "supported",
      connection: "CONNECTED",
      stale: false,
      task: running,
      errorCode: null,
    });
    mocks.execute.mockResolvedValue({ _tag: "Success", value: running });
    await act(() => controller.refresh());
    const task = { ...taskScope(running), taskId: running.id };
    await act(async () => {
      expect(
        await controller.act({
          type: "cancel",
          input: { task, expectedRunId: "another-run", expectedStateRevision: 9 },
        }),
      ).toBeNull();
      expect(
        await controller.act({
          type: "cancel",
          input: { task, expectedRunId: "run-result", expectedStateRevision: 8 },
        }),
      ).toBeNull();
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    await act(async () => {
      await controller.act({
        type: "cancel",
        input: { task, expectedRunId: "run-result", expectedStateRevision: 9 },
      });
    });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0]?.[0].input).toMatchObject({
      type: "cancel",
      input: { task, expectedRunId: "run-result", expectedStateRevision: 9 },
    });
  });
  it("keeps completed task followups append-only until explicit free coding", async () => {
    const completed = runTask();
    mocks.list.mockResolvedValue({ _tag: "Success", value: [completed] });
    mocks.observation = AsyncResult.success({
      support: "supported",
      connection: "CONNECTED",
      stale: false,
      task: completed,
      errorCode: null,
    });
    mocks.execute.mockResolvedValue({ _tag: "Success", value: completed });
    await act(() => controller.refresh());
    expect(controller.route).toBe("followup");
    await act(async () => {
      expect(await controller.followup("Inspect the recorded result")).toBe(true);
    });
    expect(mocks.execute.mock.calls[0]?.[0].input.type).toBe("followup");
    await act(() => controller.chooseFreeCoding());
    expect(controller.route).toBe("free");
    expect(mocks.execute).toHaveBeenCalledOnce();
    props = { ...props, connected: false };
    await render();
    expect(controller.route).toBe("blocked");
  });
  it("retains historical results without changing the active task target", async () => {
    const historical = runTask();
    const active: WeavraTask = {
      ...preparedTask(),
      id: WeavraTaskId.make("33333333-3333-4333-8333-333333333333"),
      execution: null,
      phase: "analysis",
      createdAt: "2026-09-28T00:01:00.000Z",
    };
    mocks.list.mockResolvedValue({ _tag: "Success", value: [historical, active] });
    mocks.observation = AsyncResult.success({
      support: "supported",
      connection: "CONNECTED",
      stale: false,
      task: active,
      errorCode: null,
    });
    await act(() => controller.refresh());
    expect(controller.tasks.map((task) => task.id)).toEqual([historical.id, active.id]);
    expect(controller.task?.id).toBe(active.id);
    expect(controller.ref?.taskId).toBe(active.id);
    await act(() => controller.chooseFreeCoding());
    expect(controller.route).toBe("analysis");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("blocks free sends until creation and association discovery settle", async () => {
    mocks.list.mockResolvedValue({ _tag: "Success", value: [] });
    await act(() => controller.refresh());
    expect(controller.route).toBe("free");
    const response = deferred<unknown>();
    mocks.execute.mockReturnValue(response.promise);
    let command: Promise<WeavraTask | null> | undefined;
    await act(() => {
      command = controller.act({
        type: "create",
        input: { ...taskScope(), commandId: CommandId.make("create-with-barrier") },
      });
    });
    try {
      expect(controller.busy).toBe(true);
      expect(controller.route).toBe("blocked");
      expect(controller.discovered).toBe(false);
    } finally {
      await act(async () => {
        response.resolve({ _tag: "Failure", code: "RUNTIME_UNAVAILABLE" });
        await command;
      });
    }
    expect(controller.route).toBe("free");
    expect(mocks.list).toHaveBeenCalledTimes(3);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("keeps repreparation blocked while the old task is released", async () => {
    const original = preparedTask();
    const released: WeavraTask = {
      ...original,
      revision: 4,
      phase: "finished",
      ownership: { generation: 3, state: "released" },
    };
    const replacement: WeavraTask = {
      ...original,
      id: WeavraTaskId.make("33333333-3333-4333-8333-333333333333"),
      revision: 1,
      phase: "analysis",
      execution: null,
      ownership: { generation: 4, state: "analysis" },
    };
    const response = deferred<unknown>();
    mocks.execute.mockReturnValue(response.promise);
    mocks.list.mockResolvedValue({ _tag: "Success", value: [released, replacement] });
    let command: Promise<WeavraTask | null> | undefined;
    await act(() => {
      command = controller.act({
        type: "reprepare",
        input: {
          task: { ...taskScope(), taskId: original.id },
          expectedRevision: original.revision,
          commandId: CommandId.make("replace-task"),
          draft: buildTaskDraft(taskDraftFields(original), 2, 1),
        },
      });
    });
    mocks.observation = AsyncResult.success({
      support: "supported",
      connection: "CONNECTED",
      stale: false,
      task: released,
      errorCode: null,
    });
    await render();
    try {
      expect(controller.busy).toBe(true);
      expect(controller.route).toBe("blocked");
      expect(controller.discovered).toBe(false);
    } finally {
      await act(async () => {
        response.resolve({ _tag: "Success", value: replacement });
        await command;
      });
    }
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("rediscovers a replacement after failed preparation before allowing sends", async () => {
    const original = preparedTask();
    const released: WeavraTask = {
      ...original,
      revision: 4,
      phase: "finished",
      ownership: { generation: 3, state: "released" },
    };
    const replacement: WeavraTask = {
      ...original,
      id: WeavraTaskId.make("33333333-3333-4333-8333-333333333333"),
      revision: 2,
      phase: "analysis",
      execution: null,
      ownership: { generation: 5, state: "analysis" },
    };
    const response = deferred<unknown>();
    const discovery = deferred<unknown>();
    mocks.execute.mockReturnValue(response.promise);
    mocks.list.mockReturnValue(discovery.promise);
    let command: Promise<WeavraTask | null> | undefined;
    await act(() => {
      command = controller.act({
        type: "reprepare",
        input: {
          task: { ...taskScope(), taskId: original.id },
          expectedRevision: original.revision,
          commandId: CommandId.make("failed-replacement"),
          draft: buildTaskDraft(taskDraftFields(original), 2, 1),
        },
      });
    });
    mocks.observation = AsyncResult.success({
      support: "supported",
      connection: "CONNECTED",
      stale: false,
      task: released,
      errorCode: null,
    });
    await render();
    await act(async () => {
      response.resolve({ _tag: "Failure", code: "PREPARE_REJECTED" });
      await command;
    });
    expect(controller.route).toBe("blocked");
    expect(controller.discovered).toBe(false);
    expect(mocks.list).toHaveBeenCalledTimes(2);
    props = { ...props, supported: false };
    await render();
    expect(controller.route).toBe("blocked");
    await act(() => {
      discovery.resolve({ _tag: "Success", value: [released] });
    });
    expect(controller.route).toBe("blocked");
    mocks.list.mockResolvedValue({ _tag: "Success", value: [released, replacement] });
    mocks.observation = AsyncResult.success({
      support: "supported",
      connection: "CONNECTED",
      stale: false,
      task: replacement,
      errorCode: null,
    });
    props = { ...props, supported: true };
    await render();
    expect(controller.task?.id).toBe(replacement.id);
    expect(controller.route).toBe("analysis");
    expect(controller.error).toContain("PREPARE_REJECTED");
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("preserves local draft free sends and queues without task discovery", async () => {
    const calls = mocks.list.mock.calls.length;
    props = { ...props, scope: null };
    await render();
    expect(controller.route).toBe("free");
    expect(controller.task).toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(calls);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("retires a command response across reconnect without replaying it", async () => {
    let finish!: (value: unknown) => void;
    mocks.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let result!: Promise<boolean>;
    await act(() => {
      result = controller.followup("Before disconnect");
    });
    props = { ...props, connected: false };
    await render();
    expect(controller.route).toBe("blocked");
    props = { ...props, connected: true };
    await render();
    await act(async () => {
      finish({ _tag: "Success", value: preparedTask() });
      expect(await result).toBe(false);
    });
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("restores task identity without any executing command", () => {
    expect(controller.task?.id).toBe(preparedTask().id);
    expect(controller.fresh).toBe(true);
    expect(mocks.list).toHaveBeenCalledWith({
      environmentId: props.environmentId,
      input: props.scope,
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("blocks stale revision and foreign selector commands before dispatch", async () => {
    const task = { ...taskScope(), taskId: preparedTask().id };
    await act(async () => {
      expect(
        await controller.act({
          type: "confirm",
          input: { task, commandId: CommandId.make("old-consent"), expectedRevision: 2 },
        }),
      ).toBeNull();
      expect(
        await controller.act({
          type: "abort",
          input: { task: { ...task, threadId: ThreadId.make("foreign") }, expectedRevision: 3 },
        }),
      ).toBeNull();
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("records a bound followup even if ownership releases at the server", async () => {
    const released = {
      ...preparedTask(),
      revision: 4,
      phase: "finished",
      ownership: { generation: 3, state: "released" },
    };
    mocks.execute.mockResolvedValue({ _tag: "Success", value: released });
    await act(async () => {
      expect(await controller.followup("Save for later")).toBe(true);
    });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0]?.[0]).toMatchObject({
      environmentId: props.environmentId,
      input: {
        type: "followup",
        input: {
          task: { ...props.scope, taskId: preparedTask().id },
          text: "Save for later",
          expectedRevision: 3,
        },
      },
    });
    expect(controller.task?.ownership.state).toBe("released");
  });
  it("disables known ownership across capability loss and read-only scope", async () => {
    props = { ...props, supported: false };
    await render();
    expect(controller.route).toBe("blocked");
    await act(async () => {
      expect(await controller.followup("Do not run")).toBe(false);
    });
    props = { ...props, supported: true };
    mocks.scopes = ["orchestration:read"];
    await render();
    expect(controller.route).toBe("blocked");
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it("rejects a retained observation for another task even at a higher revision", async () => {
    mocks.observation = AsyncResult.success({
      support: "supported",
      connection: "CONNECTED",
      stale: false,
      task: {
        ...preparedTask(),
        id: WeavraTaskId.make("33333333-3333-4333-8333-333333333333"),
        revision: 100,
      },
      errorCode: null,
    });
    await render();
    expect(controller.task?.id).toBe(preparedTask().id);
    expect(controller.fresh).toBe(false);
    expect(controller.route).toBe("blocked");
  });
  it("discards an in-flight response after navigating to another thread", async () => {
    let finish!: (value: unknown) => void;
    mocks.execute.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let result!: Promise<boolean>;
    await act(() => {
      result = controller.followup("Old thread");
    });
    props = { ...props, scope: { ...taskScope(), threadId: ThreadId.make("new-thread") } };
    mocks.list.mockResolvedValue({ _tag: "Success", value: [] });
    await render();
    await act(async () => {
      finish({ _tag: "Success", value: preparedTask() });
      expect(await result).toBe(false);
    });
    expect(controller.task).toBeNull();
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  it("allows explicit stale reconciliation but never stale confirmation", async () => {
    mocks.observation = AsyncResult.success({
      support: "supported",
      connection: "ERROR",
      stale: true,
      task: preparedTask(),
      errorCode: "STATE_UNAVAILABLE",
    });
    await render();
    const task = { ...taskScope(), taskId: preparedTask().id };
    await act(async () => {
      expect(
        await controller.act({
          type: "confirm",
          input: { task, commandId: CommandId.make("confirm"), expectedRevision: 3 },
        }),
      ).toBeNull();
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    await act(async () => {
      await controller.act({ type: "reconcile", input: task });
    });
    expect(mocks.execute.mock.calls[0]?.[0].input.type).toBe("reconcile");
  });
  it("deduplicates simultaneous clicks and never routes analysis through followup", async () => {
    const task = { ...preparedTask(), phase: "analysis" };
    mocks.list.mockResolvedValue({ _tag: "Success", value: [task] });
    mocks.observation = AsyncResult.success({
      support: "supported",
      connection: "CONNECTED",
      stale: false,
      task,
      errorCode: null,
    });
    await render();
    await act(async () => {
      await Promise.all([controller.analyze("Investigate"), controller.analyze("Duplicate")]);
    });
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(mocks.execute.mock.calls[0]?.[0].input.type).toBe("analyze");
  });
});

describe("recovery mutation fences", () => {
  async function interrupted() {
    const task = {
      ...runTask("INTERRUPTED"),
      phase: "attention-required" as const,
      ownership: { generation: 8, state: "reconciling" as const },
    };
    mocks.list.mockResolvedValue({ _tag: "Success", value: [task] });
    mocks.observation = AsyncResult.success({
      support: "supported",
      connection: "CONNECTED",
      stale: false,
      task,
      errorCode: null,
    });
    mocks.execute.mockResolvedValue({ _tag: "Success", value: task });
    await act(() => controller.refresh());
    return task;
  }
  it("keeps recovery explicit, selected-task scoped and independent of refresh", async () => {
    const task = await interrupted();
    expect(mocks.execute).not.toHaveBeenCalled();
    await act(async () => {
      expect(
        await controller.act({
          type: "recover",
          input: {
            task: {
              ...taskScope(task),
              taskId: WeavraTaskId.make("44444444-4444-4444-8444-444444444444"),
            },
            expectedRevision: task.revision,
          },
        }),
      ).toBeNull();
    });
    expect(mocks.execute).not.toHaveBeenCalled();
    await act(async () => {
      await controller.act({
        type: "recover",
        input: { task: { ...taskScope(task), taskId: task.id }, expectedRevision: task.revision },
      });
    });
    expect(mocks.execute.mock.calls[0]?.[0].input.type).toBe("recover");
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
  for (const fence of ["capability", "disconnected", "read-only", "stale-revision"] as const) {
    it(`does not dispatch recovery past ${fence}`, async () => {
      const task = await interrupted();
      if (fence === "capability") props = { ...props, recoverySupported: false };
      if (fence === "disconnected") props = { ...props, connected: false };
      if (fence === "read-only") mocks.scopes = ["orchestration:read"];
      await render();
      await act(async () => {
        expect(
          await controller.act({
            type: "recover",
            input: {
              task: { ...taskScope(task), taskId: task.id },
              expectedRevision: task.revision + (fence === "stale-revision" ? 1 : 0),
            },
          }),
        ).toBeNull();
      });
      expect(mocks.execute).not.toHaveBeenCalled();
    });
  }
  it("retires in-flight recovery after capability loss and never retries it", async () => {
    const task = await interrupted();
    const response = deferred<unknown>();
    mocks.execute.mockReturnValue(response.promise);
    let pending: Promise<WeavraTask | null> | undefined;
    await act(() => {
      pending = controller.act({
        type: "recover",
        input: { task: { ...taskScope(task), taskId: task.id }, expectedRevision: task.revision },
      });
    });
    props = { ...props, recoverySupported: false };
    await render();
    await act(async () => {
      response.resolve({ _tag: "Success", value: { ...task, revision: 999 } });
      expect(await pending).toBeNull();
    });
    expect(controller.task?.revision).toBe(task.revision);
    expect(mocks.execute).toHaveBeenCalledOnce();
  });
});
