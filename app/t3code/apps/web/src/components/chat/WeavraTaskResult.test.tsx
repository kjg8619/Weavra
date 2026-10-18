import * as NodeAssert from "node:assert/strict";
import {
  WeavraTask,
  WeavraTaskId,
  WeavraControlApproval,
  type WeavraEvidenceDetailsPage,
  type WeavraEvidenceRecord,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { selectThreadRightPanelState, useRightPanelStore } from "../../rightPanelStore";
import type { RunDiffRecord } from "./WeavraRunDiff";
import { WeavraTaskResult, WeavraTaskResults } from "./WeavraTaskResult";
import { useProjectControlDrafts } from "./projectControlDraft";
import { useWeavraTask, type WeavraTaskController } from "./useWeavraTask";
import { preparedTask, resultFixture, runTask, taskScope } from "./weavraTaskTestFixture";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  approval: vi.fn(),
  command: vi.fn(),
  list: vi.fn(),
  navigate: vi.fn(),
  observation: {} as unknown,
  weavraAtom: { label: "weavra-observation" },
  weavra: {} as unknown,
  toast: vi.fn(),
  hash: "",
}));
vi.mock("../ui/toast", () => ({ toastManager: { add: mocks.toast } }));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) => (atom === mocks.weavraAtom ? mocks.weavra : mocks.observation),
}));
vi.mock("../../state/weavraObservations", () => ({
  observations: { stateAtom: () => mocks.weavraAtom },
}));
vi.mock("../../state/session", () => ({
  useEnvironmentSessionState: () => ({
    data: { authenticated: true, scopes: ["orchestration:operate"] },
    hasError: false,
    isPending: false,
  }),
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
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: { label: string }) =>
    ({
      "chat:weavra-task-approval": mocks.approval,
      "chat:weavra-task": mocks.command,
      "chat:weavra-task-list": mocks.list,
    })[command.label] ?? mocks.read,
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
vi.mock("@pierre/diffs/react", () => ({
  FileDiff: (props: { fileDiff: { name: string } }) => (
    <output data-file-diff={props.fileDiff.name} />
  ),
}));
vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: (props: { children: ReactNode }) => props.children,
}));
vi.mock("../../hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));

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
    dirtyWorkspace: null,
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
  mocks.command.mockReset();
  mocks.list.mockReset();
  mocks.hash = "";
  mocks.weavra = AsyncResult.initial();
  useProjectControlDrafts.setState({ byTask: {} });
  await act(() => {
    renderer = create(<WeavraTaskResult {...props} />);
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("canonical result presentation", () => {
  it("assesses every criterion/check page and does not hide a later failed final check", async () => {
    const fixture = resultFixture();
    const completeness = {
      ...fixture.metadata.completeness,
      checks: { availability: "available" as const, total: 2, required: 2 },
    };
    mocks.read
      .mockReset()
      .mockResolvedValueOnce({ _tag: "Success", value: { ...fixture.criteria, completeness } })
      .mockResolvedValueOnce({
        _tag: "Success",
        value: {
          ...fixture.checks,
          completeness,
          nextCursor: { category: "checks", index: 1 },
        },
      })
      .mockResolvedValueOnce({
        _tag: "Success",
        value: {
          ...fixture.checks,
          completeness,
          cursor: { category: "checks", index: 1 },
          records: [{ ...fixture.check, index: 1, attempt: 2, status: "FAIL", exitCode: 1 }],
        },
      });
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => {
      await button("원래 문제 검증 상태 확인").props.onClick();
    });
    expect(mocks.read.mock.calls.map(([request]) => request.input.cursor)).toEqual([
      { category: "criteria", index: 0 },
      { category: "checks", index: 0 },
      { category: "checks", index: 1 },
    ]);
    expect(mocks.read.mock.calls[1]?.[0].input.diffDigest).toBe(fixture.checks.snapshot.diffDigest);
    expect(mocks.read.mock.calls[2]?.[0].input.diffDigest).toBe(fixture.checks.snapshot.diffDigest);
    expect(verification()).toBe("unverified");
  });

  it("stops assessment after a disconnect instead of fetching another category", async () => {
    const fixture = resultFixture();
    let resolvePage: (value: { _tag: "Success"; value: typeof fixture.criteria }) => void;
    const page = new Promise<{ _tag: "Success"; value: typeof fixture.criteria }>((resolve) => {
      resolvePage = resolve;
    });
    mocks.read.mockReset().mockReturnValueOnce(page);
    let assessment: Promise<void> | undefined;
    await act(() => {
      assessment = button("원래 문제 검증 상태 확인").props.onClick();
    });
    expect(mocks.read).toHaveBeenCalledOnce();
    props = { ...props, fresh: false, connected: false };
    await render();
    await act(async () => {
      resolvePage({ _tag: "Success", value: fixture.criteria });
      await assessment;
    });
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(verification()).toBe("unverified");
  });

  it("stops assessment when criterion detail is unavailable", async () => {
    const fixture = resultFixture();
    const { records: _records, nextCursor: _nextCursor, ...page } = fixture.criteria;
    mocks.read.mockReset().mockResolvedValueOnce({
      _tag: "Success",
      value: {
        ...page,
        kind: "evidence-detail-unavailable",
        completeness: {
          ...page.completeness,
          criteria: { availability: "unavailable", total: null },
        },
        reason: "CATEGORY_UNAVAILABLE",
        recordIndex: 0,
      },
    });
    await act(async () => {
      await button("원래 문제 검증 상태 확인").props.onClick();
    });
    expect(mocks.read).toHaveBeenCalledOnce();
    expect(verification()).toBe("unverified");
  });

  it("prioritizes synchronization over pending approval without dispatching either action", async () => {
    const controller = controllerFor(runTask("WAITING_APPROVAL"));
    controller.fresh = false;
    await act(() => {
      renderer.update(<WeavraTaskResults controller={controller} connected={false} />);
    });
    expect(renderer.root.findByProps({ "data-next-action": "synchronize" })).toBeDefined();
    expect(controller.act).not.toHaveBeenCalled();
    expect(mocks.approval).not.toHaveBeenCalled();
    controller.fresh = true;
    await act(() => {
      renderer.update(<WeavraTaskResults controller={controller} connected />);
    });
    expect(renderer.root.findByProps({ "data-next-action": "inspect-approval" })).toBeDefined();
    expect(controller.act).not.toHaveBeenCalled();
    expect(mocks.approval).not.toHaveBeenCalled();
  });

  it("keeps unconfirmed cleanup distinct from a completed Run without invoking recovery", async () => {
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
            admission: { ...execution.receipt.admission, cleanup: "UNCONFIRMED" },
          },
        },
      }),
    };
    await render();
    expect(renderer.root.findByProps({ "data-next-action": "inspect-cleanup" })).toBeDefined();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(props.onRefresh).not.toHaveBeenCalled();
  });

  it("projects the bounded failure contract without promoting failure prose to completion", async () => {
    const execution = props.task.execution;
    NodeAssert.ok(execution?.receipt?.status === "FOUND");
    props = {
      ...props,
      task: decodeTask({
        ...props.task,
        failureSummary: { code: "CHECK_FAILED", nextAction: "REVIEW_CHECK_FAILURE" },
        execution: {
          ...execution,
          receipt: {
            ...execution.receipt,
            admission: { ...execution.receipt.admission, cleanup: "CONFIRMED" },
            run: { runId: "run-result", status: "FAILED", revision: 9 },
          },
        },
      }),
    };
    await render();
    expect(renderer.root.findByProps({ "data-weavra-result": "goal-plan-result" })).toBeDefined();
    expect(renderer.root.findByProps({ "data-next-action": "none" })).toBeDefined();
    expect(renderer.root.findAllByProps({ "data-issue-verification": "verified" })).toHaveLength(0);
    const runIdentityDisclosure = renderer.root
      .findAllByType("details")
      .find(
        (node) =>
          node.findAll((child) => child.children.join("").includes("Run run-result")).length > 0,
      );
    expect(runIdentityDisclosure).toBeDefined();
    expect(runIdentityDisclosure?.props.open).toBeUndefined();
    await act(() => button("원래 문제 검증 상태 확인").props.onClick());
    expect(verification()).toBe("unverified");
  });

  it("keeps missing failure summaries grounded in the canonical Run status", async () => {
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
            run: { runId: "run-result", status: "FAILED", revision: 9 },
          },
        },
      }),
    };
    await render();
    expect(renderer.root.findByProps({ "data-next-action": "none" })).toBeDefined();
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  });

  it("invalidates an old approval when its refresh fails", async () => {
    const controller = controllerFor(runTask("WAITING_APPROVAL"));
    mocks.approval
      .mockResolvedValueOnce({ _tag: "Success", value: pendingApproval() })
      .mockResolvedValueOnce({ _tag: "Failure", code: "RUNTIME_UNAVAILABLE" });
    await act(() => {
      renderer.update(<WeavraTaskResults controller={controller} connected />);
    });
    await act(() => {
      button("대기 중인 승인 확인").props.onClick();
    });
    expect(button("이번 삭제만 승인").props.disabled).toBe(false);
    await act(() => {
      button("대기 중인 승인 확인").props.onClick();
    });
    expect(button("이번 삭제만 승인").props.disabled).toBe(true);
    await act(() => {
      button("이번 삭제만 승인").props.onClick();
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
      button("대기 중인 승인 확인").props.onClick();
    });
    expect(mocks.approval.mock.calls[0]?.[0].input).toEqual(controller.ref);
    expect(controller.act).not.toHaveBeenCalled();
    await act(() => {
      button("삭제 거부").props.onClick();
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
    expect(button("이번 삭제만 승인").props.disabled).toBe(true);
  });
  it("loads exact task/revision evidence and pins later categories to its digest", async () => {
    const fixture = resultFixture();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(verification()).toBe("unverified");
    await act(() => {
      button("Runtime 증거 불러오기").props.onClick();
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
      button("Runtime 증거 불러오기").props.onClick();
    });
    expect(mocks.read.mock.calls[1]?.[0].input.diffDigest).toBe(fixture.checks.snapshot.diffDigest);
    expect(verification()).toBe("verified");
  });
  it("marks cached evidence historical across reconnect until it is explicitly reloaded", async () => {
    await act(() => {
      button("Runtime 증거 불러오기").props.onClick();
    });
    await chooseChecks();
    await act(() => {
      button("Runtime 증거 불러오기").props.onClick();
    });
    expect(verification()).toBe("verified");
    props = { ...props, fresh: false, connected: false };
    await render();
    expect(verification()).toBe("unverified");
    expect(button("증거 스냅샷 다시 불러오기").props.disabled).toBe(true);
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
      button("Runtime 증거 불러오기").props.onClick();
    });
    await chooseChecks();
    await act(() => {
      button("Runtime 증거 불러오기").props.onClick();
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
      renderer.root.findByProps({ "data-weavra": "controlled-outcome" }).props[
        "data-weavra-start-failure"
      ],
    ).toBe("MODEL_UNAVAILABLE");
    expect(renderer.root.findAllByProps({ "aria-label": "Runtime 사전 검사 실패" })).toHaveLength(
      1,
    );
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
      dirtyWorkspace: null,
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
    expect(button("Runtime 결과 새로고침").props.disabled).toBe(true);
    expect(renderer.root.findByProps({ "data-next-action": "inspect-history" })).toBeDefined();
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

function observeEvidence(
  evidence: { runId: string; workers: Record<string, number | null> } | null,
) {
  mocks.weavra = AsyncResult.success({
    support: "supported",
    observation: { stale: false, snapshot: { data: { evidence } } },
  });
}
const usageLines = () => renderer.root.findAllByProps({ "data-weavra": "task-run-usage" });

describe("reported Run usage", () => {
  it("shows the reported token, tool call and worker counts for this Run", async () => {
    observeEvidence({
      runId: "run-result",
      workers: { count: 2, reportedTokens: 1234, toolCalls: 7 },
    });
    await render();
    expect(usageLines()).toHaveLength(1);
    expect(usageLines()[0]?.children.join("")).toBe("보고된 토큰 1,234 · 도구 호출 7 · worker 2");
  });

  it("says no tokens were reported instead of estimating them", async () => {
    observeEvidence({
      runId: "run-result",
      workers: { count: 1, reportedTokens: null, toolCalls: 0 },
    });
    await render();
    expect(usageLines()[0]?.children.join("")).toBe("토큰 보고 없음 · 도구 호출 0 · worker 1");
  });

  it("hides usage when the snapshot has no evidence or belongs to another Run", async () => {
    observeEvidence(null);
    await render();
    expect(usageLines()).toHaveLength(0);
    observeEvidence({
      runId: "run-other",
      workers: { count: 2, reportedTokens: 1234, toolCalls: 7 },
    });
    await render();
    expect(usageLines()).toHaveLength(0);
  });
});

describe("completed Run diff and PR description", () => {
  const runDiffPage = (records: RunDiffRecord[]): WeavraEvidenceDetailsPage => {
    const { metadata } = resultFixture();
    return {
      ...metadata,
      completeness: {
        ...metadata.completeness,
        changedFiles: { availability: "available", total: records.length },
      },
      kind: "evidence-details",
      cursor: { category: "run-diff", index: 0 },
      records,
      nextCursor: null,
    };
  };
  const runDiffFiles = () =>
    renderer.root
      .findAllByProps({ "data-weavra": "run-diff-file" })
      .map((node) => node.props["data-path"]);

  it("shows this Run's own base..result patch instead of the thread diff panel", async () => {
    const ref = scopeThreadRef(props.task.environmentId, props.task.threadId);
    useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
    mocks.read.mockReset().mockResolvedValueOnce({
      _tag: "Success",
      value: runDiffPage([
        {
          category: "run-diff",
          index: 0,
          path: "src/fix.ts",
          change: "modified",
          patch:
            "diff --git a/src/fix.ts b/src/fix.ts\n--- a/src/fix.ts\n+++ b/src/fix.ts\n@@ -1,1 +1,1 @@\n-broken\n+fixed\n",
          omitted: null,
        },
        {
          category: "run-diff",
          index: 1,
          path: "src/huge.ts",
          change: "added",
          patch: null,
          omitted: "DIFF_TOO_LARGE",
        },
      ]),
    });
    await act(async () => {
      await button("변경 보기").props.onClick();
    });
    expect(mocks.read.mock.calls.map(([request]) => request.input.cursor)).toEqual([
      { category: "run-diff", index: 0 },
    ]);
    expect(runDiffFiles()).toEqual(["src/fix.ts", "src/huge.ts"]);
    expect(
      renderer.root.findAllByType("output").map((node) => node.props["data-file-diff"]),
    ).toEqual(["src/fix.ts"]);
    expect(textOf(renderer.root.findByProps({ "data-weavra": "run-diff" }))).toContain(
      "표시 한도(32 KiB)",
    );
    const panel = selectThreadRightPanelState(useRightPanelStore.getState().byThreadKey, ref);
    expect(panel.isOpen).toBe(false);
    await act(async () => {
      await button("변경 보기").props.onClick();
    });
    expect(mocks.read).toHaveBeenCalledOnce();
  });

  it("names a refused Run diff instead of showing a partial or thread change", async () => {
    const { metadata } = resultFixture();
    mocks.read.mockReset().mockResolvedValueOnce({
      _tag: "Success",
      value: {
        ...metadata,
        completeness: {
          ...metadata.completeness,
          changedFiles: { availability: "available", total: 1 },
        },
        kind: "evidence-detail-unavailable",
        cursor: { category: "run-diff", index: 0 },
        reason: "DIFF_STALE",
        recordIndex: 0,
      },
    });
    await act(async () => {
      await button("변경 보기").props.onClick();
    });
    expect(runDiffFiles()).toEqual([]);
    expect(textOf(renderer.root.findByProps({ "data-weavra": "run-diff-refused" }))).toContain(
      "DIFF_STALE",
    );
  });

  it("copies a Korean PR draft built from the Run's evidence pages", async () => {
    const fixture = resultFixture();
    const changedFiles: WeavraEvidenceDetailsPage = {
      ...fixture.metadata,
      kind: "evidence-details",
      cursor: { category: "changed-files", index: 0 },
      records: [{ category: "changed-files", index: 0, path: "src/fix.ts" }],
      nextCursor: null,
    };
    mocks.read
      .mockReset()
      .mockResolvedValueOnce({ _tag: "Success", value: fixture.criteria })
      .mockResolvedValueOnce({ _tag: "Success", value: fixture.checks })
      .mockResolvedValueOnce({ _tag: "Success", value: changedFiles });
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    mocks.toast.mockReset();
    await act(async () => {
      await button("PR 설명 초안 복사").props.onClick();
    });
    expect(mocks.read.mock.calls.map(([request]) => request.input.cursor.category)).toEqual([
      "criteria",
      "checks",
      "changed-files",
    ]);
    expect(writeText).toHaveBeenCalledOnce();
    const draft: string = writeText.mock.calls[0]?.[0];
    expect(draft).toContain("## 목표\nFix observed failure");
    expect(draft).toContain("## 수용 기준\n- MET `AC-001` The observed failure is fixed");
    expect(draft).toContain("| `symptom-test` | 0 | PASS |");
    expect(draft).toContain("## 독립 검토\nPASS · 독립 검토 예");
    expect(draft).toContain("## 변경 파일\n- `src/fix.ts`");
    expect(draft).toContain("Weavra Run `run-result` · 상태 revision 9 · 코드 revision 2");
    expect(draft).not.toContain("일부 기록만");
    expect(mocks.toast).toHaveBeenCalledWith({
      type: "success",
      title: "PR 설명 초안을 복사했어요",
    });
    await act(async () => {
      await button("PR 설명 초안 복사").props.onClick();
    });
    expect(mocks.read).toHaveBeenCalledTimes(3);
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it("offers neither action for a Run that did not complete", async () => {
    props = { ...props, task: failedTask("FAILED", "CHECK_FAILED") };
    await render();
    expect(hasButton("변경 보기")).toBe(false);
    expect(hasButton("PR 설명 초안 복사")).toBe(false);
    expect(renderer.root.findAllByProps({ "data-weavra": "task-completed-actions" })).toHaveLength(
      0,
    );
  });
});

type CheckRecord = Extract<WeavraEvidenceRecord, { category: "checks" }>;
type CriterionRecord = Extract<WeavraEvidenceRecord, { category: "criteria" }>;
const failureSection = () => renderer.root.findByProps({ "data-weavra": "task-failure" });
const failureKind = () => failureSection().props["data-weavra-failure"];
const failureReason = () =>
  renderer.root.findByProps({ "data-weavra": "task-failure-reason" }).children.join("");
const hasButton = (label: string) =>
  renderer.root.findAllByType("button").some((node) => node.children.join("") === label);
function textOf(node: ReactTestInstance): string {
  return node.children.map((child) => (typeof child === "string" ? child : textOf(child))).join("");
}
function failedTask(
  status: "BLOCKED" | "FAILED" | "INTERRUPTED",
  code: "RUN_BLOCKED" | "RUN_FAILED" | "CHECK_FAILED" | "RUN_INTERRUPTED",
) {
  const task = runTask(status);
  const execution = task.execution;
  NodeAssert.ok(execution?.receipt?.status === "FOUND");
  const nextAction = {
    RUN_BLOCKED: "REVIEW_BLOCKED_RUN",
    RUN_FAILED: "REVIEW_RUN_FAILURE",
    CHECK_FAILED: "REVIEW_CHECK_FAILURE",
    RUN_INTERRUPTED: "REVIEW_INTERRUPTED_RUN",
  } as const;
  return decodeTask({
    ...task,
    failureSummary: { code, nextAction: nextAction[code] },
    execution: {
      ...execution,
      receipt: {
        ...execution.receipt,
        admission: { ...execution.receipt.admission, cleanup: "CONFIRMED" },
      },
    },
  });
}
const criterion = (status: CriterionRecord["status"]): CriterionRecord => ({
  category: "criteria",
  index: 0,
  id: "AC-001",
  statement: "The observed failure is fixed",
  status,
  evidenceRefs: [],
});
/** Queues one checks page then one criteria page for the failed Run, as "증거 보기" requests them. */
function failurePages(
  status: "BLOCKED" | "FAILED",
  input: {
    check: CheckRecord;
    criterion: CriterionRecord;
    review?: WeavraEvidenceDetailsPage["review"];
  },
) {
  const metadata = {
    ...resultFixture().metadata,
    outcome: { status, terminal: true },
    review: input.review ?? null,
    symptomVerification: null,
  };
  const checks: WeavraEvidenceDetailsPage = {
    ...metadata,
    kind: "evidence-details",
    cursor: { category: "checks", index: 0 },
    records: [input.check],
    nextCursor: null,
  };
  const criteria: WeavraEvidenceDetailsPage = {
    ...metadata,
    kind: "evidence-details",
    cursor: { category: "criteria", index: 0 },
    records: [input.criterion],
    nextCursor: null,
  };
  mocks.read
    .mockReset()
    .mockResolvedValueOnce({ _tag: "Success", value: checks })
    .mockResolvedValueOnce({ _tag: "Success", value: criteria });
}

describe("failure reason and next action", () => {
  it("names the policy-blocked check and opens the project setup panel to fix it", async () => {
    const fixture = resultFixture();
    props = { ...props, task: failedTask("BLOCKED", "RUN_BLOCKED") };
    failurePages("BLOCKED", {
      check: {
        ...fixture.check,
        id: "test-groups",
        step: "self-check",
        status: "UNAVAILABLE",
        exitCode: null,
        trust: null,
        sandbox: null,
        evidenceRefs: ["check:run-result:self-check:1:test-groups"],
      },
      criterion: criterion("UNVERIFIED"),
    });
    await render();
    expect(failureKind()).toBe("blocked");
    expect(hasButton("설정에서 검사 고치기")).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
    await act(async () => {
      await button("증거 보기").props.onClick();
    });
    expect(mocks.read.mock.calls.map(([request]) => request.input.cursor)).toEqual([
      { category: "checks", index: 0 },
      { category: "criteria", index: 0 },
    ]);
    expect(failureKind()).toBe("policy");
    expect(failureReason()).toContain("검사 test-groups가 실행 정책에 막혔어요:");
    expect(renderer.root.findByType("select").props.value).toBe("checks");
    expect(renderer.root.findAllByProps({ "data-weavra-record": "checks" })).toHaveLength(1);
    const toggle = { disabled: false, click: vi.fn() };
    const status = {
      querySelector: vi.fn((selector: string) =>
        selector.includes("set-up-project") ? toggle : null,
      ),
      scrollIntoView: vi.fn(),
    };
    vi.stubGlobal("document", {
      querySelector: vi.fn((selector: string) =>
        selector === '[data-weavra="project-setup-status"]' ? status : null,
      ),
    });
    await act(() => button("설정에서 검사 고치기").props.onClick());
    expect(toggle.click).toHaveBeenCalledOnce();
    expect(status.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(failureSection().findByProps({ role: "status" }).children.join("")).toContain(
      "프로젝트 설정 패널을 열었어요",
    );
    expect(props.onRefresh).not.toHaveBeenCalled();
  });

  it("shows the failed check's exit code and scrolls to its evidence record", async () => {
    const fixture = resultFixture();
    const row = { focus: vi.fn(), scrollIntoView: vi.fn() };
    props = { ...props, task: failedTask("FAILED", "CHECK_FAILED") };
    failurePages("FAILED", {
      check: { ...fixture.check, status: "FAIL", exitCode: 1, attempt: 2 },
      criterion: { ...criterion("UNMET"), evidenceRefs: ["check:final"] },
    });
    await act(() => renderer.unmount());
    await act(() => {
      renderer = create(<WeavraTaskResult {...props} />, {
        createNodeMock: (element) =>
          (element.props as Record<string, unknown>)["data-weavra-record"] === undefined
            ? null
            : row,
      });
    });
    expect(failureKind()).toBe("failed");
    expect(hasButton("설정에서 검사 고치기")).toBe(false);
    await act(async () => {
      await button("증거 보기").props.onClick();
    });
    expect(failureKind()).toBe("check");
    expect(failureReason()).toBe("symptom-test 종료 코드 1");
    expect(textOf(failureSection())).toContain("출력 참조: check:final");
    expect(renderer.root.findByType("select").props.value).toBe("checks");
    expect(row.scrollIntoView).toHaveBeenCalledWith({ block: "center" });
    expect(hasButton("증거 보기")).toBe(true);
    expect(hasButton("수정 요청 반영해 다시 준비")).toBe(false);
  });

  it("shows the Runtime output tail of a failed check instead of the no-output note", async () => {
    const fixture = resultFixture();
    props = { ...props, task: failedTask("FAILED", "CHECK_FAILED") };
    failurePages("FAILED", {
      check: {
        ...fixture.check,
        status: "FAIL",
        exitCode: 1,
        stderrTail: "AssertionError: expected Hello",
        stdoutTail: "not ok 1 - greets",
      },
      criterion: criterion("UNMET"),
    });
    await render();
    await act(async () => {
      await button("증거 보기").props.onClick();
    });
    expect(failureKind()).toBe("check");
    expect(
      renderer.root.findByProps({ "data-weavra": "task-failure-output" }).children.join(""),
    ).toBe("[stderr]\nAssertionError: expected Hello\n[stdout]\nnot ok 1 - greets");
    expect(textOf(failureSection())).not.toContain(
      "검사 출력 본문은 증거 레코드에 포함되지 않아요",
    );
  });

  it("shows the Runtime REVISE reason summary when the review carries one", async () => {
    const fixture = resultFixture();
    props = { ...props, task: failedTask("FAILED", "RUN_FAILED") };
    failurePages("FAILED", {
      check: { ...fixture.check, status: "PASS" },
      criterion: criterion("UNMET"),
      review: {
        result: "REVISE",
        independent: true,
        revision: 2,
        diffDigest: "d".repeat(64),
        criteriaCount: 1,
        reviseSummary: "[blocker] src/app.ts: Greeting is wrong -> Use Hello",
      },
    });
    await render();
    await act(async () => {
      await button("증거 보기").props.onClick();
    });
    expect(failureKind()).toBe("revise");
    expect(textOf(failureSection())).toContain(
      "검토 수정 이유: [blocker] src/app.ts: Greeting is wrong -> Use Hello",
    );
    expect(textOf(failureSection())).not.toContain("검토 의견 원문은");
  });

  it("summarizes a REVISE review and seeds a new attempt with the revision request", async () => {
    const fixture = resultFixture();
    const failed = failedTask("FAILED", "RUN_FAILED");
    const controller = controllerFor(failed);
    const created = decodeTask({
      ...preparedTask(),
      id: "33333333-3333-4333-8333-333333333333",
      phase: "analysis",
      revision: 1,
      execution: null,
      ownership: { generation: 10, state: "analysis" },
    });
    const command = vi.fn<WeavraTaskController["act"]>().mockResolvedValue(created);
    controller.act = command;
    failurePages("FAILED", {
      check: { ...fixture.check, status: "PASS" },
      criterion: criterion("UNMET"),
      review: {
        result: "REVISE",
        independent: true,
        revision: 2,
        diffDigest: "d".repeat(64),
        criteriaCount: 1,
      },
    });
    await act(() => {
      renderer.update(<WeavraTaskResults controller={controller} connected />);
    });
    expect(failureKind()).toBe("failed");
    await act(async () => {
      await button("증거 보기").props.onClick();
    });
    expect(failureKind()).toBe("revise");
    expect(failureReason()).toContain("수정을 요청했어요(REVISE)");
    expect(textOf(failureSection())).toContain("AC-001 미충족: The observed failure is fixed");
    expect(
      renderer.root.findByProps({ "data-weavra-record": "criteria" }).props["data-record-index"],
    ).toBe(1);
    expect(button("수정 요청 반영해 다시 준비").props.disabled).toBe(false);
    expect(command).not.toHaveBeenCalled();
    await act(async () => {
      await button("수정 요청 반영해 다시 준비").props.onClick();
    });
    expect(command).toHaveBeenCalledOnce();
    expect(command.mock.calls[0]?.[0]).toMatchObject({
      type: "create",
      input: {
        environmentId: failed.environmentId,
        projectId: failed.projectId,
        threadId: failed.threadId,
      },
    });
    const draft =
      useProjectControlDrafts.getState().byTask[
        JSON.stringify([created.environmentId, created.projectId, created.threadId, created.id])
      ];
    expect(draft?.goal).toBe("Fix observed failure");
    expect(draft?.criteria).toBe("The observed failure is fixed");
    expect(draft?.constraints).toContain("이전 Run run-result 검토 결과 REVISE");
    expect(draft?.constraints).toContain("AC-001 미충족: The observed failure is fixed");
    expect(failureSection().findByProps({ role: "status" }).children.join("")).toContain(
      "새 통제 작업을 만들고",
    );
  });

  it("explains an interrupted Run without offering a settings or reprepare action", async () => {
    props = { ...props, task: failedTask("INTERRUPTED", "RUN_INTERRUPTED") };
    await render();
    expect(failureKind()).toBe("interrupted");
    expect(failureReason()).toContain("실행이 중단됐어요 (RUN_INTERRUPTED)");
    expect(hasButton("증거 보기")).toBe(true);
    expect(hasButton("설정에서 검사 고치기")).toBe(false);
    expect(hasButton("수정 요청 반영해 다시 준비")).toBe(false);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("updates the failure summary from the observed task without a manual refresh", async () => {
    const running = runTask("RUNNING");
    mocks.list.mockResolvedValue({ _tag: "Success", value: [running] });
    const observe = (task: WeavraTask) => {
      mocks.observation = AsyncResult.success({
        support: "supported",
        connection: "CONNECTED",
        stale: false,
        task,
        errorCode: null,
      });
    };
    observe(running);
    function Live() {
      const controller = useWeavraTask({
        scope: taskScope(running),
        environmentId: running.environmentId,
        supported: true,
        analysisSupported: true,
        recoverySupported: true,
        connected: true,
      });
      return <WeavraTaskResults controller={controller} connected />;
    }
    await act(() => {
      renderer.update(<Live />);
    });
    expect(renderer.root.findByType(WeavraTaskResult).props.task.id).toBe(running.id);
    expect(renderer.root.findAllByProps({ "data-weavra": "task-failure" })).toHaveLength(0);
    observe(decodeTask({ ...failedTask("BLOCKED", "RUN_BLOCKED"), revision: 11 }));
    await act(() => {
      renderer.update(<Live />);
    });
    expect(failureKind()).toBe("blocked");
    expect(failureReason()).toContain("Runtime이 실행을 차단했어요 (RUN_BLOCKED)");
    expect(hasButton("증거 보기")).toBe(true);
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("renders no failure section for a completed Run, even after loading evidence", async () => {
    expect(renderer.root.findAllByProps({ "data-weavra": "task-failure" })).toHaveLength(0);
    await act(() => {
      button("Runtime 증거 불러오기").props.onClick();
    });
    await chooseChecks();
    await act(() => {
      button("Runtime 증거 불러오기").props.onClick();
    });
    expect(verification()).toBe("verified");
    expect(renderer.root.findAllByProps({ "data-weavra": "task-failure" })).toHaveLength(0);
    expect(hasButton("증거 보기")).toBe(false);
  });
});
