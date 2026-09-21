import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	type KeybindingDefinitions,
	KeybindingsManager,
	type OverlayHandle,
	type TUI,
	TUI_KEYBINDINGS,
	truncateToWidth,
} from "@earendil-works/pi-tui";
import type { GraphNodeStatus, GraphProjection } from "./graph.ts";
import { type GraphViewContext, graphViewText, layoutGraphView } from "./graph-view.ts";

// Viewer-local application defaults. Pi's injected manager/config is never mutated.
// Explicit user bindings replace these defaults, including the optional j/k/q aliases.
export const DEFAULT_APP_KEYBINDINGS = {
	"tui.select.up": { defaultKeys: ["up", "k"], description: "Graph scroll up" },
	"tui.select.down": { defaultKeys: ["down", "j"], description: "Graph scroll down" },
	"tui.select.pageUp": TUI_KEYBINDINGS["tui.select.pageUp"],
	"tui.select.pageDown": TUI_KEYBINDINGS["tui.select.pageDown"],
	"tui.altScreen.top": TUI_KEYBINDINGS["tui.altScreen.top"],
	"tui.altScreen.bottom": TUI_KEYBINDINGS["tui.altScreen.bottom"],
	"tui.select.cancel": { defaultKeys: ["escape", "q", "ctrl+c"], description: "Close Graph viewer only" },
} as const satisfies KeybindingDefinitions;
const colors: Record<GraphNodeStatus, "success" | "accent" | "dim" | "warning" | "error" | "muted"> = {
	passed: "success",
	running: "accent",
	pending: "dim",
	revised: "warning",
	blocked: "warning",
	failed: "error",
	cancelled: "muted",
	waiting_approval: "warning",
	unknown: "warning",
	skipped: "dim",
};

/** Static snapshot component: navigation/close only; no event subscriptions or Runtime references. */
export class GraphViewComponent implements Component {
	private readonly graph: GraphProjection;
	private readonly context: GraphViewContext;
	private readonly theme: Pick<Theme, "fg">;
	private readonly keys: KeybindingsManager;
	private height?: () => number;
	private redraw?: () => void;
	private done?: () => void;
	private offset = 0;
	private pageSize = 1;
	private maxOffset = 0;
	private disposed = false;

	constructor(
		graph: GraphProjection,
		context: GraphViewContext,
		theme: Pick<Theme, "fg">,
		keybindings: KeybindingsManager,
		height: () => number,
		redraw: () => void,
		done: () => void,
	) {
		this.graph = structuredClone(graph);
		this.context = structuredClone(context);
		this.theme = theme;
		this.keys = new KeybindingsManager(DEFAULT_APP_KEYBINDINGS, keybindings.getUserBindings());
		this.height = height;
		this.redraw = redraw;
		this.done = done;
	}
	get scrollOffset(): number {
		return this.offset;
	}
	get isDisposed(): boolean {
		return this.disposed;
	}

	handleInput(data: string): void {
		if (this.disposed) return;
		if (this.keys.matches(data, "tui.select.cancel")) {
			const done = this.done;
			this.dispose();
			done?.();
			return;
		}
		let next = this.offset;
		if (this.keys.matches(data, "tui.select.up")) next--;
		else if (this.keys.matches(data, "tui.select.down")) next++;
		else if (this.keys.matches(data, "tui.select.pageUp")) next -= this.pageSize;
		else if (this.keys.matches(data, "tui.select.pageDown")) next += this.pageSize;
		else if (this.keys.matches(data, "tui.altScreen.top")) next = 0;
		else if (this.keys.matches(data, "tui.altScreen.bottom")) next = this.maxOffset;
		next = Math.max(0, Math.min(this.maxOffset, next));
		if (next !== this.offset) {
			this.offset = next;
			this.redraw?.();
		}
	}
	render(width: number): string[] {
		if (this.disposed) return [];
		const columns = Math.max(0, Math.min(1000, Math.floor(width) || 0));
		const rows = Math.max(0, Math.min(40, Math.floor(this.height?.() ?? 0) - 2));
		if (!columns || !rows) return [];
		const closeHint = `${this.keys.getKeys("tui.select.cancel").join("/") || "unbound"} close`;
		if (columns < 36 || rows < 10) {
			this.pageSize = 1;
			this.maxOffset = 0;
			this.offset = 0;
			return ["Terminal is too small for Weavra Graph Viewer.", "Resize or use /graph for text output.", closeHint]
				.slice(0, rows)
				.map((line) => truncateToWidth(line, columns));
		}
		try {
			const inside = columns - 2;
			const layout = layoutGraphView(this.graph, inside, this.context);
			this.pageSize = rows - 7;
			this.maxOffset = Math.max(0, layout.rows.length - this.pageSize);
			this.offset = Math.min(this.offset, this.maxOffset);
			const content = [
				this.theme.fg("accent", `${this.graph.workflow} · ${this.graph.risk} · ${this.graph.status}`),
				`Run ${graphViewText(this.graph.runId)} · revision ${this.graph.stateRevision}`,
				this.theme.fg("dim", `Static snapshot · ${graphViewText(this.context.source)} · not a live check`),
			];
			const visible = layout.rows.slice(this.offset, this.offset + this.pageSize);
			for (const row of visible)
				content.push(
					this.theme.fg(
						row.node
							? colors[row.node.status]
							: row.tone === "warning"
								? "warning"
								: row.tone === "muted"
									? "dim"
									: "text",
						row.text,
					),
				);
			for (let index = visible.length; index < this.pageSize; index++) content.push("");
			const keys = (id: Parameters<KeybindingsManager["getKeys"]>[0]) =>
				this.keys.getKeys(id).join("/") || "unbound";
			content.push(
				this.theme.fg(
					"muted",
					columns < 64
						? `${keys("tui.select.cancel")} close · ${keys("tui.select.up")}/${keys("tui.select.down")} scroll`
						: `${keys("tui.select.up")} ${keys("tui.select.down")} · ${keys("tui.select.pageUp")}/${keys("tui.select.pageDown")} · ${keys("tui.altScreen.top")}/${keys("tui.altScreen.bottom")} · ${keys("tui.select.cancel")} close`,
				),
				this.theme.fg(
					"dim",
					`Lines ${layout.rows.length ? this.offset + 1 : 0}-${Math.min(layout.rows.length, this.offset + this.pageSize)}/${layout.rows.length} · Read-only; no node actions`,
				),
			);
			const title = truncateToWidth(" Weavra Graph ", inside, "", true);
			return [
				this.theme.fg("border", `┌${title.replace(/ +$/, (spaces) => "─".repeat(spaces.length))}┐`),
				...content.map(
					(line) =>
						this.theme.fg("border", "│") +
						truncateToWidth(` ${line}`, inside, "…", true) +
						this.theme.fg("border", "│"),
				),
				this.theme.fg("border", `└${"─".repeat(inside)}┘`),
			];
		} catch {
			// Rendering/theme errors must not crash Pi or affect the Runtime.
			return ["Weavra Graph Viewer unavailable.", "Close and use /graph for text output.", closeHint]
				.slice(0, rows)
				.map((line) => truncateToWidth(line, columns));
		}
	}
	invalidate(): void {
		/* Styles/layout are rebuilt from the current theme/size on each render. */
	}
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.done = undefined;
		this.redraw = undefined;
		this.height = undefined;
	}
}

/** One transient owner, also cancellable while the read or custom factory is pending. */
export class GraphViewSession {
	private component?: GraphViewComponent;
	private finishUI?: () => void;
	private handle?: OverlayHandle;
	private resolveClosed!: () => void;
	private readonly closedPromise: Promise<void>;
	private closedValue = false;
	constructor() {
		this.closedPromise = new Promise((resolve) => {
			this.resolveClosed = resolve;
		});
	}
	get closed(): boolean {
		return this.closedValue;
	}
	close(): void {
		if (this.closedValue) return;
		this.closedValue = true;
		this.component?.dispose();
		try {
			this.finishUI?.();
		} catch {
			// Best effort for a broken UI; lifecycle must still cancel/clean up the Runtime.
			try {
				this.handle?.hide();
			} catch {
				/* No execution side effects. */
			}
		} finally {
			this.finishUI = undefined;
			this.handle = undefined;
			this.resolveClosed();
		}
	}
	async show(ctx: ExtensionCommandContext, graph: GraphProjection, context: GraphViewContext): Promise<void> {
		if (this.closed) return;
		try {
			const showing = ctx.ui.custom<void>(
				(tui: TUI, theme, keybindings, done) => {
					this.finishUI = () => done();
					this.component = new GraphViewComponent(
						graph,
						context,
						theme,
						keybindings,
						() => tui.terminal.rows,
						() => tui.requestRender(),
						() => this.close(),
					);
					if (this.closed) this.component.dispose();
					return this.component;
				},
				{
					overlay: true,
					overlayOptions: { anchor: "center", width: "96%", maxHeight: "100%", margin: 1 },
					onHandle: (handle) => {
						if (this.closed) {
							// A delayed factory may attach after lifecycle close. Finish it immediately.
							try {
								if (this.finishUI) this.finishUI();
								else handle.hide();
							} catch {
								handle.hide();
							}
							this.finishUI = undefined;
						} else this.handle = handle;
					},
				},
			);
			await Promise.race([showing, this.closedPromise]);
		} finally {
			this.close();
		}
	}
}
