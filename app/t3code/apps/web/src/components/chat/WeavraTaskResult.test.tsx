import * as NodeAssert from "node:assert/strict";
import { WeavraTask, WeavraTaskId, WeavraControlApproval } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WeavraTaskResult, WeavraTaskResults } from "./WeavraTaskResult";
import type { WeavraTaskController } from "./useWeavraTask";
import { preparedTask, resultFixture, runTask, taskScope } from "./weavraTaskTestFixture";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  approval: vi.fn(),
  navigate: vi.fn(),
  hash: "",
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  createEnvironmentCommand: (_runtime: unknown, options: unknown) => options,
  squashAtomCommandFailure: (failure: unknown) => failure,
}));
vi.mock("@t3tools/client-runtime/state/weavraTask", () => ({ requestWeavraTask: vi.fn() }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { label: string }) =>
    command.label === "chat:weavra-task-approval" ? mocks.approval : mocks.read,
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: ({ select }: { select: (value: { pathname: string; hash: string }) => unknown }) =>
    select({ pathname: "/environment/thread", hash: mocks.hash }),
}));
vi.mock("../ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("../ui/badge", () => ({
  Badge: (props: ComponentProps<"span">) => <span {...props} />,
}));

const decodeTask = Schema.decodeUnknownSync(WeavraTask);
const decodeApproval = Schema.decodeUnknownSync(WeavraControlApproval);
let renderer: ReactTestRenderer;
let props: ComponentProps<typeof WeavraTaskResult>;
function button(label: string) {
  const found = renderer.root
    .findAllByType("button")
    .find((node) => node.children.join("") === label);
  NodeAssert.ok(found);
  return found;
}
function verification() {
  return renderer.root.find((node) => node.props["data-issue-verification"] !== undefined).props[
    "data-issue-verification"
  ];
}
async function render() {
  await act(() => {
    renderer.update(<WeavraTaskResult {...props} />);
  });
}
async function chooseChecks() {
  await act(() => {
    renderer.root.findByType("select").props.onChange({ target: { value: "checks" } });
  });
}

function controllerFor(task: WeavraTask): WeavraTaskController {
  return {
    task,
    tasks: [task],
    ref: { ...taskScope(task), taskId: task.id },
    fresh: true,
    recoverySupported: true,
    canOperate: true,
    busy: false,
    error: null,
    setError: vi.fn(),
    route: task.phase === "analysis" ? "analysis" : "followup",
    act: vi.fn(),
    analyze: vi.fn(),
    followup: vi.fn(),
    refresh: vi.fn(),
    discovered: true,
    chooseFreeCoding: vi.fn(),
  };
}
function pendingApproval() {
  return decodeApproval({
    approvalId: "approval-1",
    runId: "run-result",
    stateRevision: 9,
    projectRevision: 3,
    risk: "R3",
    operation: "delete-file",
    role: "Developer",
    step: { stepId: "implement", attempt: 1 },
    path: "src/fix.ts",
    bytes: 10,
    preconditionDigest: "b".repeat(64),
    expiresAt: 4102444800000,
    explanation: "Delete the obsolete fixture",
  });
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const fixture = resultFixture();
  props = {
    task: fixture.task,
    fresh: true,
    connected: true,
    canRefresh: true,
    onRefresh: vi.fn(),
  };
  mocks.read
    .mockReset()
    .mockResolvedValueOnce({ _tag: "Success", value: fixture.criteria })
    .mockResolvedValueOnce({ _tag: "Success", value: fixture.checks });
  mocks.navigate.mockReset();
  mocks.approval.mockReset();
  mocks.hash = "";
  await act(() => {
    renderer = create(<WeavraTaskResult {...props} />);
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("canonical result presentation", () => {
  it("invalidates an old approval when its refresh fails", async () => {
    const controller = controllerFor(runTask("WAITING_APPROVAL"));
    mocks.approval
      .mockResolvedValueOnce({ _tag: "Success", value: pendingApproval() })
      .mockResolvedValueOnce({ _tag: "Failure", code: "RUNTIME_UNAVAILABLE" });
    await act(() => {
      renderer.update(<WeavraTaskResults controller={controller} connected />);
    });
    await act(() => {
      button("Inspect pending approval").props.onClick();
    });
    expect(button("Approve deletion once").props.disabled).toBe(false);
    await act(() => {
      button("Inspect pending approval").props.onClick();
    });
    expect(button("Approve deletion once").props.disabled).toBe(true);
    await act(() => {
      button("Approve deletion once").props.onClick();
    });
    expect(controller.act).not.toHaveBeenCalled();
  });
  it("requires a separate explicit decision for the exact pending deletion", async () => {
    const waiting = runTask("WAITING_APPROVAL");
    const controller = controllerFor(waiting);
    const approval = pendingApproval();
    mocks.approval.mockResolvedValue({ _tag: "Success", value: approval });
    await act(() => {
      renderer.update(<WeavraTaskResults controller={controller} connected />);
    });
    expect(controller.act).not.toHaveBeenCalled();
    expect(mocks.approval).not.toHaveBeenCalled();
    await act(() => {
      button("Inspect pending approval").props.onClick();
    });
    expect(mocks.approval.mock.calls[0]?.[0].input).toEqual(controller.ref);
    expect(controller.act).not.toHaveBeenCalled();
    await act(() => {
      button("Reject deletion").props.onClick();
    });
    expect(controller.act).toHaveBeenCalledWith({
      type: "resolveApproval",
      input: {
        task: controller.ref,
        expectedRunId: "run-result",
        expectedStateRevision: 9,
        approvalId: "approval-1",
        decision: "reject",
      },
    });
    expect(button("Approve deletion once").props.disabled).toBe(true);
  });
  it("loads exact task/revision evidence and pins later categories to its digest", async () => {
    const fixture = resultFixture();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(verification()).toBe("unverified");
    await act(() => {
      button("Load canonical evidence").props.onClick();
    });
    expect(mocks.read.mock.calls[0]?.[0]).toEqual({
      environmentId: props.task.environmentId,
      input: {
        task: { ...taskScope(props.task), taskId: props.task.id },
        revision: 9,
        diffDigest: null,
        cursor: { category: "criteria", index: 0 },
      },
    });
    expect(verification()).toBe("unverified");
    await chooseChecks();
    await act(() => {
      button("Load canonical evidence").props.onClick();
    });
    expect(mocks.read.mock.calls[1]?.[0].input.diffDigest).toBe(fixture.checks.snapshot.diffDigest);
    expect(verification()).toBe("verified");
  });
  it("marks cached evidence historical across reconnect until it is explicitly reloaded", async () => {
    await act(() => {
      button("Load canonical evidence").props.onClick();
    });
    await chooseChecks();
    await act(() => {
      button("Load canonical evidence").props.onClick();
    });
    expect(verification()).toBe("verified");
    props = { ...props, fresh: false, connected: false };
    await render();
    expect(verification()).toBe("unverified");
    expect(button("Reload evidence snapshot").props.disabled).toBe(true);
    props = { ...props, fresh: true, connected: true };
    await render();
    expect(verification()).toBe("unverified");
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it("keeps a changed snapshot from being combined with earlier criteria", async () => {
    const fixture = resultFixture();
    mocks.read
      .mockReset()
      .mockResolvedValueOnce({ _tag: "Success", value: fixture.criteria })
      .mockResolvedValueOnce({
        _tag: "Success",
        value: {
          ...fixture.checks,
          snapshot: { ...fixture.checks.snapshot, diffDigest: "e".repeat(64) },
        },
      });
    await act(() => {
      button("Load canonical evidence").props.onClick();
    });
    await chooseChecks();
    await act(() => {
      button("Load canonical evidence").props.onClick();
    });
    expect(verification()).toBe("unverified");
    expect(renderer.root.findAllByProps({ "aria-label": "checks record 1" })).toHaveLength(0);
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain(
      "SNAPSHOT_CHANGED",
    );
  });
  it("shows preflight failure without fabricating or fetching Run evidence", async () => {
    const execution = props.task.execution;
    NodeAssert.ok(execution?.receipt?.status === "FOUND");
    props = {
      ...props,
      task: decodeTask({
        ...props.task,
        execution: {
          ...execution,
          receipt: {
            ...execution.receipt,
            admission: {
              ...execution.receipt.admission,
              outcome: { status: "START_FAILED", reasonCode: "MODEL_UNAVAILABLE" },
            },
            run: null,
          },
        },
      }),
    };
    await render();
    expect(
      renderer.root.findAllByProps({ "aria-label": "Runtime preflight failure" }),
    ).toHaveLength(1);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(
      renderer.root.findAll((node) => node.props["data-issue-verification"] === "verified"),
    ).toHaveLength(0);
  });
  it("restores a history hash without retargeting active task commands", async () => {
    const historical = props.task;
    const active = decodeTask({
      ...preparedTask(),
      id: "33333333-3333-4333-8333-333333333333",
      phase: "analysis",
      execution: null,
    });
    const controller: WeavraTaskController = {
      task: active,
      tasks: [historical, active],
      ref: { ...taskScope(active), taskId: active.id },
      fresh: true,
      recoverySupported: true,
      canOperate: true,
      busy: false,
      error: null,
      setError: vi.fn(),
      route: "analysis",
      act: vi.fn(),
      analyze: vi.fn(),
      followup: vi.fn(),
      refresh: vi.fn(),
      discovered: true,
      chooseFreeCoding: vi.fn(),
    };
    mocks.hash = `#weavra-task-${historical.id}`;
    await act(() => {
      renderer.update(<WeavraTaskResults controller={controller} connected />);
    });
    expect(renderer.root.findByType(WeavraTaskResult).props.task.id).toBe(historical.id);
    expect(button("Refresh canonical outcome").props.disabled).toBe(true);
    expect(controller.ref?.taskId).toBe(active.id);
    expect(controller.act).not.toHaveBeenCalled();
    mocks.hash = `#weavra-task-${WeavraTaskId.make("99999999-9999-4999-8999-999999999999")}`;
    await act(() => {
      renderer.update(<WeavraTaskResults controller={controller} connected />);
    });
    expect(renderer.root.findAllByType(WeavraTaskResult)).toHaveLength(0);
    expect(controller.act).not.toHaveBeenCalled();
  });
});
