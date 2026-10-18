import * as NodeAssert from "node:assert/strict";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import type { LegendListRef } from "@legendapp/list/react";
import { act, useLayoutEffect, type ComponentProps, type ReactNode } from "react";
import { create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { WeavraTaskCard } from "./WeavraTaskCard";
import { useWeavraTaskFocus } from "./MessagesTimeline";
import type { WeavraTaskController } from "./useWeavraTask";
import { preparedTask, resultFixture, taskScope } from "./weavraTaskTestFixture";

vi.mock("../ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("../ui/input", () => ({
  Input: (props: ComponentProps<"input">) => <input {...props} />,
}));
vi.mock("../ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));
vi.mock("../ui/badge", () => ({
  Badge: (props: ComponentProps<"span">) => <span {...props} />,
}));
vi.mock("@pierre/diffs/react", () => ({ FileDiff: () => null }));
vi.mock("@legendapp/list/react", () => ({
  LegendList: () => {
    throw new Error("The hook fixture supplies its typed scroll interface directly.");
  },
}));
vi.mock("../DiffWorkerPoolProvider", () => ({
  DiffWorkerPoolProvider: ({ children }: { children?: ReactNode }) => children,
}));

const stubGlobals = vi.hoisted(() => {
  const stub = () => {
    const ElementStub = class {
      readonly nodeType = 1;
    };
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("Element", ElementStub);
    const storage = {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    };
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", {
      Element: ElementStub,
      localStorage: storage,
      matchMedia: () => ({
        matches: false,
        addEventListener: () => {},
        removeEventListener: () => {},
      }),
      addEventListener: () => {},
      removeEventListener: () => {},
      desktopBridge: undefined,
    });
    vi.stubGlobal("document", {
      documentElement: {
        classList: {
          add: () => {},
          remove: () => {},
          toggle: () => {},
          contains: () => false,
        },
        offsetHeight: 0,
      },
    });
  };
  stub();
  return stub;
});

type ScrollList = Pick<LegendListRef, "scrollToEnd">;
type FocusTarget = Pick<HTMLElement, "focus" | "scrollIntoView" | "isConnected">;
type FocusController = ReturnType<typeof useWeavraTaskFocus>;
type Scope = ReturnType<typeof taskScope>;
type ScrollReceipt = { done: Promise<void>; resolve: () => void };

let renderer: ReactTestRenderer | undefined;
let focusController: FocusController | undefined;
let controller: WeavraTaskController;
let scrollReceipts: ScrollReceipt[];
let targets: FocusTarget[];
let focusedTarget: FocusTarget | null;
let listRef: { current: ScrollList | null };
const scrollToEnd = vi.fn<ScrollList["scrollToEnd"]>();
const command = vi.fn<WeavraTaskController["act"]>();
const analyze = vi.fn<WeavraTaskController["analyze"]>();
const followup = vi.fn<WeavraTaskController["followup"]>();
const navigate = vi.fn<() => void>();
const chooseFreeCoding = vi.fn<() => void>();
const scope = taskScope();

function rendered() {
  NodeAssert.ok(renderer, "Expected a mounted fixture");
  return renderer;
}

function currentFocusController() {
  NodeAssert.ok(focusController, "Expected a committed focus hook");
  return focusController;
}

function targetAt(index: number) {
  const target = targets[index];
  NodeAssert.ok(target, `Expected mounted target ${index}`);
  return target;
}

function receiptAt(index: number) {
  const receipt = scrollReceipts[index];
  NodeAssert.ok(receipt, `Expected scroll receipt ${index}`);
  return receipt;
}

function button(label: string): ReactTestInstance {
  const node = rendered()
    .root.findAllByType("button")
    .find((item) => item.children.join("") === label);
  NodeAssert.ok(node, `Expected button ${label}`);
  return node;
}

function entry() {
  return rendered().root.findByProps({ "data-focus-entry": true });
}

async function requestFocus() {
  await act(() => entry().props.onClick());
}

async function completeScroll(index: number) {
  const receipt = receiptAt(index);
  await act(async () => {
    receipt.resolve();
    await receipt.done;
  });
}

function Fixture({
  currentScope = scope,
  showTarget = true,
  connected = true,
  supported = true,
  entryBlockedReason = null,
}: {
  currentScope?: Scope | null;
  showTarget?: boolean;
  connected?: boolean;
  supported?: boolean;
  entryBlockedReason?: string | null;
}) {
  const key = currentScope ? JSON.stringify(currentScope) : null;
  const { attachTarget, requestFocus: activateFocus } = useWeavraTaskFocus({
    scope: key,
    listRef,
    onNavigate: navigate,
  });
  useLayoutEffect(() => {
    focusController = { attachTarget, requestFocus: activateFocus };
  });
  return (
    <>
      {currentScope ? (
        <button type="button" data-focus-entry onClick={activateFocus}>
          Controlled task
        </button>
      ) : null}
      {currentScope && showTarget ? (
        <div
          key={key}
          ref={attachTarget}
          data-weavra-task-focus-target
          role="region"
          aria-label="통제 작업 상세"
          tabIndex={-1}
        >
          <WeavraTaskCard
            controller={controller}
            scope={currentScope}
            supported={supported}
            analysisSupported
            connected={connected}
            messages={[]}
            provider="codex"
            entryBlockedReason={entryBlockedReason}
          />
        </div>
      ) : null}
    </>
  );
}

async function mount(props: ComponentProps<typeof Fixture> = {}) {
  await act(() => {
    renderer = create(<Fixture {...props} />, {
      createNodeMock(element) {
        const props = element.props;
        if (
          typeof props !== "object" ||
          props === null ||
          !("data-weavra-task-focus-target" in props) ||
          props["data-weavra-task-focus-target"] !== true
        )
          return null;
        const target: FocusTarget = {
          isConnected: true,
          scrollIntoView: vi.fn<FocusTarget["scrollIntoView"]>(),
          focus: vi.fn<FocusTarget["focus"]>(() => {
            focusedTarget = target;
          }),
        };
        targets.push(target);
        return target;
      },
    });
  });
}

beforeEach(() => {
  stubGlobals();
  renderer = undefined;
  focusController = undefined;
  scrollReceipts = [];
  targets = [];
  focusedTarget = null;
  navigate.mockReset();
  chooseFreeCoding.mockReset();
  scrollToEnd.mockReset().mockImplementation(() => {
    let resolve: (() => void) | undefined;
    const done = new Promise<void>((complete) => {
      resolve = complete;
    });
    NodeAssert.ok(resolve, "Promise executor must supply its completion signal");
    scrollReceipts.push({ done, resolve });
    return done;
  });
  listRef = { current: { scrollToEnd } };
  const task = preparedTask();
  command.mockReset().mockResolvedValue(task);
  analyze.mockReset().mockResolvedValue(false);
  followup.mockReset().mockResolvedValue(false);
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
    analyze,
    followup,
    refresh: vi.fn(),
    discovered: true,
    chooseFreeCoding,
  };
});

afterEach(async () => {
  if (renderer) {
    const current = renderer;
    await act(() => current.unmount());
  }
  vi.unstubAllGlobals();
});

describe("controlled task focus lifecycle", () => {
  it("waits for virtualized scrolling and preserves the real card's consent", async () => {
    await mount();
    const checkbox = rendered().root.findByProps({ type: "checkbox" });
    await act(() => checkbox.props.onChange({ target: { checked: true } }));
    expect(button("Runtime 구현 확인").props.disabled).toBe(false);

    await requestFocus();
    expect(scrollToEnd).toHaveBeenCalledExactlyOnceWith({ animated: false });
    expect(navigate).toHaveBeenCalledOnce();
    expect(focusedTarget).toBeNull();
    await completeScroll(0);

    const target = targetAt(0);
    expect(focusedTarget).toBe(target);
    expect(target.scrollIntoView).toHaveBeenCalledExactlyOnceWith({
      block: "start",
      behavior: "instant",
    });
    expect(target.focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
    expect(rendered().root.findByProps({ type: "checkbox" }).props.checked).toBe(true);
    expect(button("Runtime 구현 확인").props.disabled).toBe(false);
    expect(command).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(followup).not.toHaveBeenCalled();
    expect(chooseFreeCoding).not.toHaveBeenCalled();
  });

  it("focuses a late-mounted card only after both mount and scroll completion", async () => {
    await mount({ showTarget: false });
    await requestFocus();
    await completeScroll(0);
    expect(focusedTarget).toBeNull();
    await act(() => rendered().update(<Fixture />));
    expect(focusedTarget).toBe(targetAt(0));
    expect(command).not.toHaveBeenCalled();
  });

  it("does not focus a card detached before scrolling completes", async () => {
    await mount();
    const target = targetAt(0);
    await requestFocus();
    await act(() => rendered().update(<Fixture showTarget={false} />));
    await completeScroll(0);
    expect(focusedTarget).toBeNull();
    expect(target.focus).not.toHaveBeenCalled();
  });

  it("discards completion after unmount and rejects a retained old handler", async () => {
    await mount();
    const target = targetAt(0);
    const oldRequest = currentFocusController().requestFocus;
    await requestFocus();
    const current = rendered();
    await act(() => current.unmount());
    renderer = undefined;
    await completeScroll(0);
    oldRequest();
    expect(target.focus).not.toHaveBeenCalled();
    expect(focusedTarget).toBeNull();
    expect(scrollToEnd).toHaveBeenCalledOnce();
  });

  for (const field of ["environmentId", "projectId", "threadId"] as const) {
    it(`discards an old ${field} scope and its retained handler`, async () => {
      await mount();
      const oldTarget = targetAt(0);
      const oldRequest = currentFocusController().requestFocus;
      await requestFocus();
      const nextScope = taskScope(preparedTask());
      if (field === "environmentId") {
        nextScope.environmentId = EnvironmentId.make(`${nextScope.environmentId}-next`);
      } else if (field === "projectId") {
        nextScope.projectId = ProjectId.make(`${nextScope.projectId}-next`);
      } else {
        nextScope.threadId = ThreadId.make(`${nextScope.threadId}-next`);
      }
      await act(() => rendered().update(<Fixture currentScope={nextScope} />));
      await act(() => oldRequest());
      await completeScroll(0);
      expect(focusedTarget).toBeNull();
      expect(oldTarget.focus).not.toHaveBeenCalled();
      expect(targetAt(1).focus).not.toHaveBeenCalled();
      expect(scrollToEnd).toHaveBeenCalledOnce();
      await requestFocus();
      await completeScroll(1);
      expect(focusedTarget).toBe(targetAt(1));
      expect(command).not.toHaveBeenCalled();
    });
  }

  it("ignores a superseded scroll completion", async () => {
    await mount();
    await requestFocus();
    await requestFocus();
    await completeScroll(0);
    expect(focusedTarget).toBeNull();
    await completeScroll(1);
    expect(focusedTarget).toBe(targetAt(0));
    expect(targetAt(0).focus).toHaveBeenCalledOnce();
    expect(command).not.toHaveBeenCalled();
  });

  it("does not offer a draft-only target or honor a retained server-scope handler", async () => {
    await mount();
    const oldRequest = currentFocusController().requestFocus;
    await requestFocus();
    await act(() => rendered().update(<Fixture currentScope={null} />));
    await act(() => oldRequest());
    await completeScroll(0);
    expect(rendered().root.findAllByProps({ "data-focus-entry": true })).toHaveLength(0);
    expect(focusedTarget).toBeNull();
    expect(scrollToEnd).toHaveBeenCalledOnce();
    expect(command).not.toHaveBeenCalled();
  });

  for (const barrier of [
    "disconnected",
    "unsupported",
    "read-only",
    "undiscovered",
    "queued",
    "attachments-context",
  ] as const) {
    it(`can inspect the card without bypassing the ${barrier} entry barrier`, async () => {
      controller = {
        ...controller,
        task: null,
        tasks: [],
        ref: null,
        route: "free",
        canOperate: barrier !== "read-only",
        discovered: barrier !== "undiscovered",
      };
      await mount({
        connected: barrier !== "disconnected",
        supported: barrier !== "unsupported",
        entryBlockedReason:
          barrier === "queued"
            ? "통제 작업 전에 대기 중인 메시지를 제거해 주세요."
            : barrier === "attachments-context"
              ? "통제 작업 전에 첨부 파일과 참고 자료를 제거해 주세요."
              : null,
      });
      expect(button("통제 작업 시작").props.disabled).toBe(true);
      await requestFocus();
      await completeScroll(0);
      expect(focusedTarget).toBe(targetAt(0));
      expect(button("통제 작업 시작").props.disabled).toBe(true);
      expect(command).not.toHaveBeenCalled();
      expect(analyze).not.toHaveBeenCalled();
      expect(followup).not.toHaveBeenCalled();
    });
  }

  it("keeps explicit free return available without selecting it during focus", async () => {
    const task = resultFixture().task;
    controller = {
      ...controller,
      task,
      tasks: [task],
      ref: { ...taskScope(task), taskId: task.id },
      chooseFreeCoding: () => {
        chooseFreeCoding();
        controller = { ...controller, route: "free" };
      },
    };
    await mount();
    await requestFocus();
    await completeScroll(0);
    expect(chooseFreeCoding).not.toHaveBeenCalled();
    expect(button("자유 작업으로 돌아가기").props.disabled).toBe(false);
    await act(() => {
      button("자유 작업으로 돌아가기").props.onClick();
      rendered().update(<Fixture />);
    });
    expect(controller.route).toBe("free");
    expect(chooseFreeCoding).toHaveBeenCalledOnce();
    expect(command).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    expect(followup).not.toHaveBeenCalled();
  });
});
