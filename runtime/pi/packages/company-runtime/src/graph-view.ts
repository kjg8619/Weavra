import type { GraphEdge, GraphNode, GraphNodeStatus, GraphProjection } from "./graph.ts";

export const GRAPH_NODE_MARKERS: Record<GraphNodeStatus, { symbol: string; label: string }> = {
	passed: { symbol: "✓", label: "PASS" },
	running: { symbol: "●", label: "RUNNING" },
	pending: { symbol: "○", label: "PENDING" },
	revised: { symbol: "↻", label: "REVISE" },
	blocked: { symbol: "!", label: "BLOCKED" },
	failed: { symbol: "×", label: "FAILED" },
	cancelled: { symbol: "-", label: "CANCELLED" },
	waiting_approval: { symbol: "?", label: "WAITING_APPROVAL" },
	unknown: { symbol: "?", label: "UNKNOWN" },
	skipped: { symbol: "·", label: "SKIPPED" },
};
export interface GraphViewRow {
	text: string;
	tone: "normal" | "muted" | "warning";
	/** References to the supplied DTO, never independently inferred execution state. */
	node?: GraphNode;
	edge?: GraphEdge;
}
export interface GraphViewLayout {
	rows: GraphViewRow[];
	wide: boolean;
}
export interface GraphViewContext {
	source: string;
	diagnostics: readonly string[];
}

export function graphViewText(value: string, limit = 1600): string {
	const escaped = value.replace(
		/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
	return escaped.length > limit ? `${escaped.slice(0, limit)} [truncated]` : escaped;
}

/** Pure presentation: keeps every DTO node/status/edge, with no Run, event or scheduler input. */
export function layoutGraphView(graph: GraphProjection, columns: number, context: GraphViewContext): GraphViewLayout {
	const wide = columns >= 64;
	const rows: GraphViewRow[] = [];
	const columnsById = new Map<string, number>();
	let previousId: string | undefined;
	for (const node of graph.nodes) {
		const incoming = graph.edges.filter((edge) => edge.to === node.id);
		// Indentation follows supplied revision/containment edges, not workflow/attempt inference.
		const revision = incoming.find((edge) => edge.kind === "revise" || edge.kind === "next_attempt");
		const indent = node.parentId
			? (columnsById.get(node.parentId) ?? 0) + 2
			: wide
				? Math.min(12, (columnsById.get(incoming[0]?.from ?? "") ?? 0) + (revision ? 4 : 0))
				: 0;
		columnsById.set(node.id, indent);
		for (const edge of incoming) {
			const from = graph.nodes.find((candidate) => candidate.id === edge.from);
			const prefix = " ".repeat(Math.min(indent, columnsById.get(edge.from) ?? 0));
			const relation =
				edge.kind === "revise"
					? "REVISE"
					: edge.kind === "pass"
						? "PASS required"
						: edge.kind === "approved"
							? "approval required"
							: edge.kind === "contains"
								? `inside ${graphViewText(edge.from, 120)} (detail)`
								: edge.kind === "next_attempt"
									? "next attempt (verdict unknown)"
									: "";
			if (wide && !relation && previousId === edge.from) rows.push({ text: `${prefix}  │`, tone: "muted" });
			rows.push({
				text: `${prefix}  ${edge.kind === "contains" ? "├─" : revision ? "└─" : "▼"}${relation ? ` ${relation} →` : ""}${previousId !== edge.from ? ` from ${graphViewText(from?.label ?? edge.from, 200)}` : ""}`,
				tone: "muted",
				edge,
			});
		}
		const marker = GRAPH_NODE_MARKERS[node.status];
		rows.push({
			text: `${" ".repeat(indent)}${marker.symbol} ${graphViewText(node.label)} · ${marker.label}${node.verdict && node.verdict !== marker.label ? ` · ${node.verdict}` : ""}${node.approvalStatus ? ` · ${node.approvalStatus}` : ""}${node.parentId ? ` [inside ${graphViewText(node.parentId, 120)}]` : ""}`,
			tone: "normal",
			node,
		});
		if (node.detail) rows.push({ text: `${" ".repeat(indent + 2)}${graphViewText(node.detail)}`, tone: "muted" });
		if (node.checks?.length)
			rows.push({
				text: `${" ".repeat(indent + 2)}Checks: ${node.checks.map((check) => `${graphViewText(check.id, 80)} ${check.status}`).join(", ")}`,
				tone: "muted",
			});
		previousId = node.id;
	}
	rows.push(
		...[...graph.diagnostics, ...context.diagnostics].map((message) => ({
			text: `Note: ${graphViewText(message)}`,
			tone: "warning" as const,
		})),
	);
	return { rows, wide };
}
