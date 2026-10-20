import type { WeavraSnapshotEnvelope } from "@t3tools/contracts";

export type WeavraRunGraph = NonNullable<WeavraSnapshotEnvelope["data"]["graph"]>;
type GraphNode = WeavraRunGraph["nodes"][number];
type GraphEdge = WeavraRunGraph["edges"][number];

/**
 * Card text is 14px (W-15), so the card holds a name line, a status line and
 * up to two wrapped lines; the column header may wrap to two lines.
 */
export const GRAPH_CARD = {
  width: 232,
  height: 104,
  columnGap: 40,
  rowGap: 16,
  header: 44,
  bandGap: 28,
} as const;

export interface WeavraGraphCard {
  node: GraphNode;
  children: GraphNode[];
  column: number;
  band: number;
  row: number;
  x: number;
  y: number;
}
export interface WeavraGraphColumn {
  key: string;
  x: number;
  y: number;
  total: number;
  passed: number;
  running: number;
}
export interface WeavraGraphLink {
  edge: GraphEdge;
  path: string;
  backward: boolean;
}

/**
 * Pure presentation of the Runtime's projection: one column per step kind in
 * first-seen order, one row per attempt, and columns wrapped into bands that
 * fit `availableWidth`. Nothing is inferred, reordered or recomputed from
 * colors; an edge whose ends are not drawn is returned in `otherEdges`.
 */
export function layoutWeavraRunGraph(graph: WeavraRunGraph, availableWidth: number) {
  const { width: cw, height: ch, columnGap, rowGap, header, bandGap } = GRAPH_CARD;
  const ids = new Set(graph.nodes.map((node) => node.id));
  const roots = graph.nodes.filter((node) => !node.parentId || !ids.has(node.parentId));
  const columnKeys: string[] = [];
  const rowsPerColumn = new Map<string, number>();
  const placed = roots.map((node) => {
    const key = node.wave !== undefined ? `wave:${node.wave}` : (node.stepId ?? node.id);
    if (!columnKeys.includes(key)) columnKeys.push(key);
    const row = rowsPerColumn.get(key) ?? 0;
    rowsPerColumn.set(key, row + 1);
    return { node, column: columnKeys.indexOf(key), row };
  });
  const perBand = Math.max(1, Math.floor((availableWidth + columnGap) / (cw + columnGap)));
  const bands = Math.max(1, Math.ceil(columnKeys.length / perBand));
  const bandTops = [0];
  for (let band = 0; band < bands; band++) {
    const rows = Math.max(
      1,
      ...placed
        .filter((card) => Math.floor(card.column / perBand) === band)
        .map((card) => card.row + 1),
    );
    bandTops.push(bandTops[band]! + header + rows * (ch + rowGap) - rowGap + bandGap);
  }
  const origin = (column: number) => ({
    x: (column % perBand) * (cw + columnGap),
    y: bandTops[Math.floor(column / perBand)]!,
  });
  const cards: WeavraGraphCard[] = placed.map((card) => {
    const { x, y } = origin(card.column);
    return {
      ...card,
      band: Math.floor(card.column / perBand),
      children: graph.nodes.filter((child) => child.parentId === card.node.id),
      x,
      y: y + header + card.row * (ch + rowGap),
    };
  });
  const byId = new Map(cards.map((card) => [card.node.id, card]));
  const columns: WeavraGraphColumn[] = columnKeys.map((key, index) => {
    const members = cards.filter((card) => card.column === index);
    return {
      key,
      ...origin(index),
      total: members.length,
      passed: members.filter((card) => card.node.status === "passed").length,
      running: members.filter(
        (card) => card.node.status === "running" || card.node.status === "waiting_approval",
      ).length,
    };
  });
  const links: WeavraGraphLink[] = [];
  const otherEdges: GraphEdge[] = [];
  for (const edge of graph.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) {
      const nested =
        edge.kind === "contains" &&
        graph.nodes.some((node) => node.id === edge.to && node.parentId === edge.from);
      if (!nested) otherEdges.push(edge);
      continue;
    }
    const backward = to.column <= from.column;
    if (to.band === from.band && to.x > from.x) {
      const sx = from.x + cw;
      const sy = from.y + ch / 2;
      const ty = to.y + ch / 2;
      const mid = (sx + to.x) / 2;
      links.push({
        edge,
        backward,
        path: `M ${sx} ${sy} C ${mid} ${sy}, ${mid} ${ty}, ${to.x} ${ty}`,
      });
    } else if (to.y > from.y) {
      const sx = from.x + cw / 2;
      const sy = from.y + ch;
      const tx = to.x + cw / 2;
      const mid = (sy + to.y) / 2;
      links.push({
        edge,
        backward,
        path: `M ${sx} ${sy} C ${sx} ${mid}, ${tx} ${mid}, ${tx} ${to.y}`,
      });
    } else {
      const sx = from.x + cw / 2;
      const tx = to.x + cw / 2;
      const ty = to.y + ch;
      const mid = (from.y + ty) / 2;
      links.push({
        edge,
        backward,
        path: `M ${sx} ${from.y} C ${sx} ${mid}, ${tx} ${mid}, ${tx} ${ty}`,
      });
    }
  }
  const usedColumns = Math.min(perBand, columnKeys.length);
  return {
    cards,
    columns,
    links,
    otherEdges,
    width: Math.max(cw, usedColumns * (cw + columnGap) - columnGap),
    height: bandTops[bands]! - bandGap,
  };
}
