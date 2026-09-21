import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, type KeybindingsConfig, type TUI, TuiMainScreen } from "@earendil-works/pi-tui";
import { KeybindingsManager } from "../../coding-agent/src/core/keybindings.ts";
import { VirtualTerminal } from "../../tui/test/virtual-terminal.ts";
import { GraphViewComponent } from "../src/graph-view-component.ts";

type CustomOptions = Parameters<ExtensionCommandContext["ui"]["custom"]>[1];
type CustomFactory<T> = (
	tui: TUI,
	theme: Theme,
	keybindings: KeybindingsManager,
	done: (value: T) => void,
) => (Component & { dispose?(): void }) | Promise<Component & { dispose?(): void }>;

/** Real Pi TUI overlay stack/terminal; only the Extension custom() bridge is simulated. */
export function graphViewUI(bindings: KeybindingsConfig = {}) {
	const terminal = new VirtualTerminal(80, 24);
	const tui = new TuiMainScreen(terminal);
	const keys = new KeybindingsManager(bindings);
	const theme = { fg: (_color: string, text: string) => text } as unknown as Theme;
	const editor = {
		value: "existing draft text",
		render: () => [`Editor: ${editor.value}`],
		handleInput: (text: string) => {
			editor.value += text;
		},
		invalidate: () => {},
	};
	const footer = { render: () => ["Footer: other-status | Weavra COMPLETED"], invalidate: () => {} };
	tui.addChild(editor);
	tui.addChild(footer);
	tui.setFocus(editor);
	tui.start();
	const calls: CustomOptions[] = [];
	let component: GraphViewComponent | undefined;
	let pendingFactory: (() => Promise<void>) | undefined;
	const control = { deferFactory: false, rejectCustom: false };
	const custom = <T>(factory: CustomFactory<T>, options?: CustomOptions): Promise<T> => {
		calls.push(options);
		if (control.rejectCustom) return Promise.reject(new Error("Injected UI failure"));
		return new Promise<T>((resolve, reject) => {
			let closed = false;
			let candidate: (Component & { dispose?(): void }) | undefined;
			const done = (value: T) => {
				if (closed) return;
				closed = true;
				tui.hideOverlay();
				resolve(value);
				candidate?.dispose?.();
			};
			const create = async () => {
				try {
					candidate = await factory(tui, theme, keys, done);
					if (candidate instanceof GraphViewComponent) component = candidate;
					if (closed) return;
					const position =
						typeof options?.overlayOptions === "function" ? options.overlayOptions() : options?.overlayOptions;
					const handle = tui.showOverlay(candidate, position);
					options?.onHandle?.(handle);
				} catch (error) {
					reject(error);
				}
			};
			if (control.deferFactory) pendingFactory = create;
			else void create();
		});
	};
	return {
		terminal,
		tui,
		editor,
		footer,
		keys,
		theme,
		calls,
		control,
		custom,
		get component() {
			return component;
		},
		attach: async () => {
			const create = pendingFactory;
			pendingFactory = undefined;
			await create?.();
		},
		stop: () => {
			component?.dispose();
			tui.stop();
		},
	};
}
