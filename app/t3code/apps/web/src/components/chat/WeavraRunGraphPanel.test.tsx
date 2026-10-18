import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { selectActiveRightPanel, useRightPanelStore } from "../../rightPanelStore";
import { WeavraRunGraphPanel } from "./WeavraRunGraphPanel";
import type { WeavraRunGraph } from "./weavraRunGraphLayout";

const mocks = vi.hoisted(() => ({ result: undefined as unknown }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => mocks.result }));
vi.mock("../../state/weavraObservations", () => ({
  observations: { stateAtom: () => ({}) },
}));
vi.mock("../../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: "connected" } }),
}));
vi.mock("@tanstack/react-router", () => ({
  useParams: ({ select }: { select: (params: Record<string, string>) => unknown }) =>
    select({ environmentId: "env", threadId: "thread" }),
}));
vi.mock("../ui/badge", () => ({
  Badge: (props: ComponentProps<"span">) => <span {...props} />,
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
