import { describe, expect, it } from "vite-plus/test";
import { layoutWeavraRunGraph, type WeavraRunGraph } from "./weavraRunGraphLayout";

const graph = (nodes: WeavraRunGraph["nodes"], edges: WeavraRunGraph["edges"]): WeavraRunGraph =>
  ({ runId: "run", stateRevision: 1, status: "RUNNING", nodes, edges }) as WeavraRunGraph;

describe("layoutWeavraRunGraph", () => {
  it("places steps in columns, attempts in rows, and nests approvals", () => {
    const layout = layoutWeavraRunGraph(
      graph(
        [
          { id: "implement:1", kind: "agent", status: "passed", stepId: "implement", attempt: 1 },
          { id: "approval:1", kind: "approval", status: "passed", parentId: "implement:1" },
          { id: "review:1", kind: "review", status: "revised", stepId: "review", attempt: 1 },
          { id: "implement:2", kind: "agent", status: "running", stepId: "implement", attempt: 2 },
        ],
        [
          { from: "implement:1", to: "approval:1", kind: "contains" },
          { from: "implement:1", to: "review:1", kind: "sequence" },
          { from: "review:1", to: "implement:2", kind: "revise" },
        ],
      ),
      1000,
    );
    expect(layout.cards.map((c) => [c.node.id, c.column, c.row])).toEqual([
      ["implement:1", 0, 0],
      ["review:1", 1, 0],
      ["implement:2", 0, 1],
    ]);
    expect(layout.cards[0]?.children.map((child) => child.id)).toEqual(["approval:1"]);
    expect(layout.columns.map((c) => [c.key, c.total, c.passed, c.running])).toEqual([
      ["implement", 2, 1, 1],
      ["review", 1, 0, 0],
    ]);
    expect(layout.links.map((l) => [l.edge.kind, l.backward])).toEqual([
      ["sequence", false],
      ["revise", true],
    ]);
    expect(layout.otherEdges).toEqual([]);
  });

  it("wraps columns into bands that fit a narrow panel", () => {
    const steps = (["implement", "self-check", "review"] as const).map(
      (stepId) =>
        ({ id: `${stepId}:1`, kind: "agent", status: "passed", stepId, attempt: 1 }) as const,
    );
    const { cards, width } = layoutWeavraRunGraph(
      graph(steps, [
        { from: "implement:1", to: "self-check:1", kind: "sequence" },
        { from: "self-check:1", to: "review:1", kind: "sequence" },
      ]),
      320,
    );
    expect(new Set(cards.map((card) => card.x))).toEqual(new Set([0]));
    expect(cards.map((card) => card.y)).toEqual(
      [...cards.map((card) => card.y)].toSorted((a, b) => a - b),
    );
    expect(width).toBeLessThanOrEqual(320);
  });

  it("stacks parallel COMPLEX tasks in their wave column before the integration gates", () => {
    const layout = layoutWeavraRunGraph(
      graph(
        [
          { id: "task:CT-001", kind: "task", status: "passed", wave: 1 },
          { id: "task:CT-002", kind: "task", status: "running", wave: 1 },
          { id: "task:CT-003", kind: "task", status: "pending", wave: 2 },
          { id: "integration:check", kind: "verification", status: "pending" },
        ],
        [
          { from: "task:CT-001", to: "task:CT-003", kind: "sequence" },
          { from: "task:CT-002", to: "task:CT-003", kind: "sequence" },
          { from: "task:CT-003", to: "integration:check", kind: "sequence" },
        ],
      ),
      1000,
    );
    expect(layout.cards.map((c) => [c.node.id, c.column, c.row])).toEqual([
      ["task:CT-001", 0, 0],
      ["task:CT-002", 0, 1],
      ["task:CT-003", 1, 0],
      ["integration:check", 2, 0],
    ]);
    expect(layout.columns.map((c) => [c.key, c.total, c.passed, c.running])).toEqual([
      ["wave:1", 2, 1, 1],
      ["wave:2", 1, 0, 0],
      ["integration:check", 1, 0, 0],
    ]);
    expect(layout.links.every((link) => !link.backward)).toBe(true);
  });

  it("keeps an edge to an undrawn node visible instead of dropping it", () => {
    const dangling = { from: "a", to: "gone", kind: "approved" } as const;
    const stray = { from: "a", to: "b", kind: "contains" } as const;
    const { otherEdges } = layoutWeavraRunGraph(
      graph(
        [
          { id: "a", kind: "agent", status: "failed" },
          { id: "b", kind: "verification", status: "skipped" },
        ],
        [dangling, stray],
      ),
      1000,
    );
    expect(otherEdges).toEqual([dangling]);
  });

  it("draws a node whose parent is missing as its own card", () => {
    const { cards } = layoutWeavraRunGraph(
      graph([{ id: "m", kind: "mutation", status: "unknown", parentId: "gone" }], []),
      1000,
    );
    expect(cards.map((card) => card.node.id)).toEqual(["m"]);
  });
});
