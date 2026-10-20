import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { selectActiveRightPanel, useRightPanelStore } from "../../rightPanelStore";
import { WeavraRunGraphPanel } from "./WeavraRunGraphPanel";
import type { WeavraRunGraph } from "./weavraRunGraphLayout";

const mocks = vi.hoisted(() => ({
  result: undefined as unknown,
  navigate: vi.fn(),
  groups: [] as unknown[],
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => mocks.result }));
vi.mock("../../state/weavraObservations", () => ({
  observations: { stateAtom: () => ({}) },
}));
vi.mock("../../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: "connected" } }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useParams: ({ select }: { select: (params: Record<string, string>) => unknown }) =>
    select({ environmentId: "env", threadId: "thread" }),
}));
vi.mock("../settings/useSettingsProjectGroups", () => ({
  useSettingsProjectGroups: () => mocks.groups,
}));
vi.mock("../ui/badge", () => ({
  Badge: (props: ComponentProps<"span">) => <span {...props} />,
}));
vi.mock("../ui/button", () => ({
  Button: ({ variant, ...props }: ComponentProps<"button"> & { variant?: string }) => (
    <button data-variant={variant} {...props} />
  ),
}));

const threadRef = scopeThreadRef(EnvironmentId.make("env"), ThreadId.make("thread"));
let renderer: ReactTestRenderer;

function render(status: WeavraRunGraph["status"], nodes: WeavraRunGraph["nodes"]) {
  mocks.result = AsyncResult.success({
    support: "supported",
    observation: {
      stale: false,
      snapshot: {
        data: {
          status: { run: { workflow: "COMPLEX", risk: "R1", status } },
          graph: { runId: "run", stateRevision: 1, status, nodes, edges: [] },
          evidence: { runId: "run", failureCategory: status === "BLOCKED" ? "REVIEW" : null },
        },
      },
    },
  });
  act(() => {
    renderer = create(
      <WeavraRunGraphPanel
        environmentId={EnvironmentId.make("env")}
        projectId={ProjectId.make("project")}
        workspaceRoot="/workspace"
      />,
    );
  });
}

const resultLinks = () =>
  renderer.root.findAll(
    (node) =>
      node.type === "button" && node.props["data-weavra-action"] === "graph-open-task-result",
  );
const text = () => JSON.stringify(renderer.toJSON());

const steps: WeavraRunGraph["nodes"] = [
  { id: "review:1", kind: "review", status: "blocked", stepId: "review", attempt: 1 },
  { id: "complete:1", kind: "completion", status: "blocked", stepId: "complete", attempt: 1 },
];

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.groups = [
    { projectKey: "other-key", memberProjects: [{ environmentId: "other-env", id: "project" }] },
    { projectKey: "project-key", memberProjects: [{ environmentId: "env", id: "project" }] },
  ];
  useRightPanelStore.setState({ byThreadKey: {}, userActionRevisionByThreadKey: {} });
});
afterEach(() => {
  act(() => renderer.unmount());
});

it("links a blocked Run's completion card to the result surface", () => {
  render("BLOCKED", steps);
  const links = resultLinks();
  expect(links).toHaveLength(1);
  const completion = renderer.root.find(
    (node) => node.type === "li" && node.props["data-weavra-graph-node"] === "complete:1",
  );
  expect(completion.findAll((node) => node === links[0])).toHaveLength(1);
  expect(text()).toContain("검토 차단");
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef)).toBeNull();
  act(() => links[0]!.props.onClick());
  expect(selectActiveRightPanel(useRightPanelStore.getState().byThreadKey, threadRef)).toBe(
    "control",
  );
});

it("keeps the link reachable when a failed Run has no completion node", () => {
  render("FAILED", [steps[0]!]);
  expect(resultLinks()).toHaveLength(1);
  expect(
    renderer.root.findAll((node) => node.props["data-weavra"] === "run-graph-failure"),
  ).toHaveLength(1);
});

it("shows no failure link for a completed Run", () => {
  render(
    "COMPLETED",
    steps.map((node) => ({ ...node, status: "passed" })),
  );
  expect(resultLinks()).toHaveLength(0);
  expect(text()).not.toContain("결과 화면에서 확인");
});

function renderEmpty(result: unknown) {
  mocks.result = result;
  act(() => {
    renderer = create(
      <WeavraRunGraphPanel
        environmentId={EnvironmentId.make("env")}
        projectId={ProjectId.make("project")}
        workspaceRoot="/workspace"
      />,
    );
  });
}
const settingsButtons = () =>
  renderer.root.findAll(
    (node) =>
      node.type === "button" && node.props["data-weavra-action"] === "graph-open-project-settings",
  );

it("sends a project without a snapshot to its own settings without any other request", () => {
  renderEmpty(AsyncResult.success({ support: "supported", observation: undefined }));
  expect(text()).toContain("스냅샷이 아직 없어서");
  const buttons = settingsButtons();
  expect(buttons).toHaveLength(1);
  act(() => buttons[0]!.props.onClick());
  expect(mocks.navigate).toHaveBeenCalledTimes(1);
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: "/projects/$projectKey",
    params: { projectKey: "project-key" },
  });
});

it("offers no settings link when the project has no logical group", () => {
  mocks.groups = [];
  renderEmpty(AsyncResult.success({ support: "supported", observation: undefined }));
  expect(settingsButtons()).toHaveLength(0);
  expect(text()).toContain("아무것도 실행하지 않아요");
});

it("keeps an unsupported environment read-only and explains it in an in-app disclosure", () => {
  renderEmpty(AsyncResult.success({ support: "unsupported", observation: undefined }));
  expect(settingsButtons()).toHaveLength(0);
  const toggle = renderer.root.find(
    (node) => node.type === "button" && node.props["aria-expanded"] !== undefined,
  );
  expect(toggle.props["aria-expanded"]).toBe(false);
  expect(text()).not.toContain("서버가 통제 작업 관찰을 지원하지 않아서");
  act(() => toggle.props.onClick());
  expect(
    renderer.root.find(
      (node) => node.type === "button" && node.props["aria-expanded"] !== undefined,
    ).props["aria-expanded"],
  ).toBe(true);
  expect(text()).toContain("서버가 통제 작업 관찰을 지원하지 않아서");
  expect(mocks.navigate).not.toHaveBeenCalled();
});
