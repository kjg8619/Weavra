import { KeybindingsManager, TUI_KEYBINDINGS, visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { type GraphNodeStatus, type GraphProjection, projectRunGraph } from "../src/graph.ts";
import { GRAPH_NODE_MARKERS, layoutGraphView } from "../src/graph-view.ts";
import { GraphViewComponent } from "../src/graph-view-component.ts";
import { graphApproval, graphRun, implementingGraphRun } from "./graph-fixtures.ts";

const context = { source: "stored project revision 1", diagnostics: ["Snapshot only; no live check"] };
function component(graph = projectRunGraph(graphRun("STANDARD", "R2", 3)), userBindings = {}) {
	const size = { rows: 24 };
	const redraw = vi.fn();
	const done = vi.fn();
	const theme = { fg: vi.fn((_color: string, text: string) => text) };
	const keys = new KeybindingsManager(TUI_KEYBINDINGS, userBindings);
	const view = new GraphViewComponent(graph, context, theme, keys, () => size.rows, redraw, done);
	return { view, size, redraw, done, theme, keys };
}
function sameModel(graph: GraphProjection, width: number) {
	const before = structuredClone(graph);
	const layout = layoutGraphView(graph, width, context);
	expect(layout.rows.flatMap((row) => (row.node ? [row.node] : []))).toEqual(graph.nodes);
	expect(layout.rows.flatMap((row) => (row.edge ? [JSON.stringify(row.edge)] : [])).sort()).toEqual(
		graph.edges.map((edge) => JSON.stringify(edge)).sort(),
	);
	expect(graph).toEqual(before);
	return layout.rows.map((row) => row.text).join("\n");
}

describe("V0.2B layout reuses the exact V0.2A DTO", () => {
	it.each([
		{ workflow: "QUICK", risk: "R0", revision: 0 },
		{ workflow: "QUICK", risk: "R1", revision: 0 },
		{ workflow: "STANDARD", risk: "R1", revision: 0 },
		{ workflow: "STANDARD", risk: "R2", revision: 0 },
		{ workflow: "STANDARD", risk: "R2", revision: 1 },
		{ workflow: "STANDARD", risk: "R1", revision: 3 },
	] as const)(
		"preserves node IDs/statuses and edges for $workflow/$risk attempt history $revision",
		({ workflow, risk, revision }) => {
			const graph = projectRunGraph(graphRun(workflow, risk, revision));
			for (const width of [38, 76, 120]) {
				const text = sameModel(graph, width);
				expect(text).toContain("✓");
				if (workflow === "QUICK") expect(text).not.toContain("Reviewer");
				else expect(text).toContain("Reviewer #1");
				if (revision) {
					expect(text).toContain("└─ REVISE →");
					expect(text).toContain("Developer #2");
				}
			}
		},
	);
	it.each(["PENDING", "APPROVED", "CONSUMED", "DENIED", "EXPIRED"] as const)(
		"keeps R3 %s and mutation separate inside IMPLEMENT",
		(status) => {
			const run = implementingGraphRun("R3");
			run.approvals = [graphApproval(status)];
			run.status =
				status === "PENDING" ? "WAITING_APPROVAL" : ["DENIED", "EXPIRED"].includes(status) ? "BLOCKED" : "RUNNING";
			const graph = projectRunGraph(run);
			const text = sameModel(graph, 76);
			expect(text).toContain(`· ${status}`);
			expect(text).toContain("[inside implement:1]");
			if (status === "APPROVED") expect(text).toContain("○ Mutation #1 · PENDING");
			if (status === "CONSUMED") expect(text).toContain("✓ Mutation #1 · PASS");
			if (status === "PENDING") expect(text).toContain("? Human Approval #1 · WAITING_APPROVAL");
		},
	);
	it.each(["BLOCKED", "FAILED", "CANCELLED"] as const)(
		"displays terminal %s without re-inferring workflow state",
		(status) => {
			const run = implementingGraphRun();
			run.status = status;
			const graph = projectRunGraph(run);
			const text = sameModel(graph, 76);
			expect(text).toContain(status);
			expect(text).toContain("· Complete #1 · SKIPPED");
		},
	);
	it("keeps historical PASS and stale COMPLETE BLOCK, plus UNKNOWN results", () => {
		const run = graphRun();
		run.status = "BLOCKED";
		run.lastError = "Workspace changed after final checks; review is stale";
		let text = sameModel(projectRunGraph(run), 76);
		expect(text).toContain("✓ Reviewer #1 · PASS");
		expect(text).toContain("! Complete #1 · BLOCKED");
		expect(text).toContain("review is stale");
		delete run.review;
		delete run.reviewHistory;
		run.verification = [];
		text = sameModel(projectRunGraph(run), 38);
		expect(text).toContain("? Reviewer #1 · UNKNOWN");
	});
	it("uses only supplied edges, not inferred node order or attempt numbers", () => {
		const graph = projectRunGraph(graphRun());
		graph.edges = [];
		const layout = layoutGraphView(graph, 100, context);
		expect(layout.rows.some((row) => row.edge)).toBe(false);
		expect(layout.rows.some((row) => /▼|│|└/.test(row.text))).toBe(false);
	});
	it("has explicit non-color markers for all normalized states", () => {
		expect(
			Object.fromEntries(Object.entries(GRAPH_NODE_MARKERS).map(([status, marker]) => [status, marker.symbol])),
		).toEqual({
			passed: "✓",
			running: "●",
			pending: "○",
			revised: "↻",
			blocked: "!",
			failed: "×",
			cancelled: "-",
			waiting_approval: "?",
			unknown: "?",
			skipped: "·",
		});
	});
});

describe("read-only Graph TUI component", () => {
	it.each([0, 1, 12, 35, 36, 48, 76, 120])(
		"bounds all lines at width %s, including long CJK labels/run IDs and diagnostics",
		(width) => {
			const graph = projectRunGraph(graphRun());
			graph.runId = "界".repeat(1000);
			graph.nodes[0].label = `long\n\u001b[31m${"界".repeat(1000)}`;
			graph.diagnostics.push(`path/${"segment/".repeat(500)}\u202e`);
			const { view } = component(graph);
			const lines = view.render(width);
			for (const line of lines) {
				expect(visibleWidth(line)).toBeLessThanOrEqual(width);
				// truncateToWidth may emit neutral SGR resets; source-supplied escapes must not survive.
				expect(line.replaceAll("\u001b[0m", "")).not.toContain("\u001b");
				expect(line).not.toContain("\u202e");
			}
			expect(lines.length).toBeLessThanOrEqual(22);
			if (width >= 36) expect(lines[0]).toContain("Weavra Graph");
			view.dispose();
		},
	);
	it("shows too-small guidance and handles height/width resize without stale scroll bounds", () => {
		const { view, size } = component();
		view.render(76);
		view.handleInput("\u001b[F");
		expect(view.scrollOffset).toBeGreaterThan(0);
		size.rows = 6;
		expect(view.render(76).join("\n")).toContain("Terminal is too small for Weavra Graph Viewer.");
		expect(view.scrollOffset).toBe(0);
		size.rows = 18;
		view.render(40);
		view.handleInput("\u001b[F");
		size.rows = 40;
		for (const line of view.render(120)) expect(visibleWidth(line)).toBeLessThanOrEqual(120);
		view.dispose();
	});
	it("supports up/k down/j pages Home/End and clamps both boundaries", () => {
		const { view, size, redraw } = component();
		size.rows = 16;
		view.render(76);
		view.handleInput("k");
		expect(view.scrollOffset).toBe(0);
		expect(redraw).not.toHaveBeenCalled();
		view.handleInput("j");
		expect(view.scrollOffset).toBe(1);
		view.handleInput("\u001b[B");
		expect(view.scrollOffset).toBe(2);
		view.handleInput("\u001b[A");
		expect(view.scrollOffset).toBe(1);
		view.handleInput("\u001b[6~");
		expect(view.scrollOffset).toBeGreaterThan(2);
		view.handleInput("\u001b[5~");
		expect(view.scrollOffset).toBe(1);
		view.handleInput("\u001b[F");
		const end = view.scrollOffset;
		view.handleInput("j");
		expect(view.scrollOffset).toBe(end);
		view.handleInput("\u001b[H");
		expect(view.scrollOffset).toBe(0);
		view.dispose();
	});
	it.each(["q", "\u001b"])("%s closes once; all late input/render/invalidate calls are inert", (key) => {
		const { view, redraw, done } = component();
		view.render(76);
		view.handleInput(key);
		expect(done).toHaveBeenCalledTimes(1);
		expect(view.isDisposed).toBe(true);
		view.handleInput("j");
		view.handleInput(key);
		view.invalidate();
		expect(view.render(76)).toEqual([]);
		expect(redraw).not.toHaveBeenCalled();
		expect(done).toHaveBeenCalledTimes(1);
	});
	it("Enter and action-like input cannot run, retry, approve, cancel or resume", () => {
		const { view, redraw, done } = component();
		view.render(76);
		for (const data of ["\r", "r", "a", "d", "c", "run", "retry", "approve", "cancel", "resume"])
			view.handleInput(data);
		expect(view.scrollOffset).toBe(0);
		expect(redraw).not.toHaveBeenCalled();
		expect(done).not.toHaveBeenCalled();
		view.dispose();
	});
	it("respects user keybindings and does not mutate the injected Pi manager", () => {
		const { view, keys, done } = component(undefined, {
			"tui.select.up": ["u"],
			"tui.select.down": ["d"],
			"tui.select.cancel": ["x"],
		});
		const before = keys.getResolvedBindings();
		expect(view.render(20).join("\n")).toContain("x close");
		view.render(76);
		view.handleInput("j");
		view.handleInput("q");
		expect(view.scrollOffset).toBe(0);
		expect(done).not.toHaveBeenCalled();
		view.handleInput("d");
		expect(view.scrollOffset).toBe(1);
		view.handleInput("u");
		expect(view.scrollOffset).toBe(0);
		view.handleInput("x");
		expect(done).toHaveBeenCalledTimes(1);
		expect(keys.getResolvedBindings()).toEqual(before);
	});
	it("rebuilds theme colors at render time and falls back without crashing if the theme fails", () => {
		const { view, theme } = component();
		view.render(76);
		expect(theme.fg).toHaveBeenCalledWith("success", expect.stringContaining("✓"));
		for (const [color] of theme.fg.mock.calls)
			expect(["success", "accent", "dim", "warning", "error", "muted", "text", "border"]).toContain(color);
		theme.fg.mockImplementation(() => {
			throw new Error("broken theme");
		});
		view.invalidate();
		expect(view.render(76).join("\n")).toContain("Viewer unavailable");
		view.dispose();
	});
	it("captures a static graph copy; input DTO changes and late events do not update it", () => {
		const graph = projectRunGraph(graphRun());
		const { view, redraw } = component(graph);
		const before = view.render(76);
		graph.nodes[0].status = "failed";
		graph.nodes[0].label = "late update";
		expect(view.render(76)).toEqual(before);
		expect(redraw).not.toHaveBeenCalled();
		view.dispose();
	});
	it.each(Object.keys(GRAPH_NODE_MARKERS) as GraphNodeStatus[])(
		"renders status %s with its textual meaning in a colorless terminal",
		(status) => {
			const graph = projectRunGraph(graphRun());
			graph.nodes = [{ id: "display-only", kind: "agent", label: "Node", status }];
			graph.edges = [];
			const { view } = component(graph);
			expect(view.render(76).join("\n")).toContain(
				`${GRAPH_NODE_MARKERS[status].symbol} Node · ${GRAPH_NODE_MARKERS[status].label}`,
			);
			view.dispose();
		},
	);
});
