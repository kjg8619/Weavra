import type { ReactElement } from "react";
import { EnvironmentId, ProjectId, type WeavraObservation } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { visitElements } from "../../test/reactElementTree";

const data = vi.hoisted(() => ({
  phase: "connected",
  observation: null as WeavraObservation | null,
  project: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => AsyncResult.success({ support: "supported", observation: data.observation }),
}));
vi.mock("../../state/weavraObservations", () => ({
  observations: { stateAtom: (...args: unknown[]) => data.read(...args) },
}));
vi.mock("../../state/environments", () => ({
  useEnvironment: () => ({ label: "Synthetic connection", connection: { phase: data.phase } }),
}));
vi.mock("../../state/entities", () => ({
  useProject: (...args: unknown[]) => data.project(...args),
}));
vi.mock("./WeavraControls", () => ({ WeavraControls: "control-fixture" }));
vi.mock("./WeavraFitness", () => ({ WeavraFitness: "fitness-fixture" }));
vi.mock("../ui/badge", () => ({ Badge: "span" }));
vi.mock("./SettingsGroup", () => ({ SettingsGroup: "div" }));
vi.mock("./settingsLayout", () => ({ SettingsSection: "section" }));
import { WeavraSettings } from "./WeavraSettings";

const environmentId = EnvironmentId.make("synthetic-environment");
const projectId = ProjectId.make("synthetic-project");
const workspaceRoot = `/workspace/${"long-path-".repeat(24)}`;
function render() {
  return WeavraSettings({ environmentId, projectId, workspaceRoot });
}
function content(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(content).join("");
  if (node && typeof node === "object" && "props" in node) {
    const element = node as ReactElement<{ children?: unknown }>;
    return content(element.props.children);
  }
  return "";
}
beforeEach(() => {
  data.phase = "connected";
  data.read.mockReset();
  data.project.mockReset().mockReturnValue({ title: "Synthetic project" });
  data.observation = {
    status: "CONNECTED",
    stale: false,
    runtimeVersion: "0.85.1",
    observedAt: 1,
    errorCode: null,
    snapshot: {
      protocolVersion: 1,
      runId: null,
      stateRevision: null,
      projectRevision: null,
      eventId: null,
      timestamp: 1,
      data: {
        status: {
          source: "durable-canonical-state",
          ownerObserved: false,
          state: "missing",
          writerPresent: null,
          run: null,
        },
        graph: null,
        graphAvailable: false,
        evidence: null,
        configuration: { source: "project-config-not-frozen-run-config", status: "missing" },
      },
    },
  };
});
describe("Runtime observation presentation", () => {
  it("retains unknown metadata without inventing a Run as a disconnected snapshot becomes current", () => {
    const observation = data.observation;
    if (!observation) throw new Error("Missing observation fixture");
    const original = structuredClone(observation);
    data.phase = "disconnected";
    render();
    data.phase = "connected";
    const tree = render();
    const details = visitElements(tree, (node) => node.type === "details");
    if (!details) throw new Error("Missing observation disclosure");
    expect(content(details).split(observation.runtimeVersion ?? "").length - 1).toBe(1);
    expect(observation).toEqual(original);
    expect(observation.snapshot?.data.status.run).toBeNull();
    expect(observation.snapshot?.data.status.writerPresent).toBeNull();
    expect(observation.snapshot?.stateRevision).toBeNull();
    expect(data.read.mock.calls).toEqual([
      [environmentId, projectId, workspaceRoot],
      [environmentId, projectId, workspaceRoot],
    ]);
  });
  it("passes the selected project's display name without changing its exact request scope", () => {
    const controls = visitElements(render(), (node) => node.type === "control-fixture");
    expect(controls?.props).toMatchObject({
      environmentId,
      projectId,
      workspaceRoot,
      projectName: "Synthetic project",
    });
    expect(data.project).toHaveBeenCalledOnce();
  });
});
