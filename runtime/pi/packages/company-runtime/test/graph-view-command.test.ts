import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../src/agent-runner.ts";
import type { Run } from "../src/contracts.ts";
import { registerCompanyRuntime } from "../src/extension.ts";
import * as projection from "../src/graph.ts";
import { FileStateStore } from "../src/state-store.ts";
import { StandardWorkflow } from "../src/workflow.ts";
import { GitWorkspace } from "../src/workspace.ts";
import { graphApproval, graphRun, implementingGraphRun } from "./graph-fixtures.ts";
import { graphViewUI } from "./graph-view-harness.ts";

let cwd: string;
let ui: ReturnType<typeof graphViewUI>;
function host() {
	const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const hooks = new Map<string, (event: { type: string; reason?: string }, ctx: ExtensionCommandContext) => unknown>();
	const models = vi.fn(async () => {
		throw new Error("Provider forbidden");
	});
	const notify = vi.fn();
	const setStatus = vi.fn();
	const setEditorText = vi.fn();
	const setEditorComponent = vi.fn();
	const setFooter = vi.fn();
	const setHeader = vi.fn();
	const ctx = {
		cwd,
		mode: "tui",
		hasUI: true,
		isProjectTrusted: () => true,
		ui: { notify, setStatus, setEditorText, setEditorComponent, setFooter, setHeader, custom: ui.custom },
	} as unknown as ExtensionCommandContext;
	registerCompanyRuntime(
		{
			registerCommand: (name, command) => {
				commands.set(name, command);
			},
			on: (name: string, handler: unknown) => {
				hooks.set(name, handler as NonNullable<ReturnType<typeof hooks.get>>);
			},
		},
		{ createModels: models },
	);
	return {
		ctx,
		models,
		notify,
		setStatus,
		setEditorText,
		setEditorComponent,
		setFooter,
		setHeader,
		call: (args = "view") => commands.get("graph")!.handler(args, ctx),
		emit: (type: string, reason?: string) => hooks.get(type)!({ type, reason }, ctx),
	};
}
async function store(run = graphRun()) {
	await mkdir(join(cwd, ".ai"), { recursive: true });
	await writeFile(
		join(cwd, ".ai/state.json"),
		JSON.stringify({ schemaVersion: 1, revision: 1, runs: [run], actions: [] }),
	);
}
async function open(reader: ReturnType<typeof host>, selector = "view") {
	const done = reader.call(selector);
	await vi.waitFor(() => expect(ui.tui.hasOverlay()).toBe(true));
	await ui.terminal.waitForRender();
	return { done };
}
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "weavra-viewer-"));
	ui = graphViewUI();
	vi.spyOn(FileStateStore, "open").mockImplementation(async () => {
		throw new Error("Graph must not acquire writer");
	});
	vi.spyOn(StandardWorkflow.prototype, "execute").mockImplementation(async () => {
		throw new Error("Graph must not execute Runtime");
	});
	vi.spyOn(PiAgentExecutor, "create").mockImplementation(async () => {
		throw new Error("Graph must not invoke Provider");
	});
	vi.spyOn(GitWorkspace, "open").mockImplementation(async () => {
		throw new Error("Graph must not invoke Git");
	});
});
afterEach(async () => {
	try {
		ui?.stop();
		expect(FileStateStore.open).not.toHaveBeenCalled();
		expect(StandardWorkflow.prototype.execute).not.toHaveBeenCalled();
		expect(PiAgentExecutor.create).not.toHaveBeenCalled();
		expect(GitWorkspace.open).not.toHaveBeenCalled();
	} finally {
		vi.restoreAllMocks();
		await rm(cwd, { recursive: true, force: true });
	}
});

describe("/graph view official overlay bridge and read-only lifecycle", () => {
	it.each(["view", "view latest", "view run"])(
		"%s uses exactly the ASCII projection and preserves state/editor/footer/status",
		async (selector) => {
			await store();
			await writeFile(join(cwd, ".ai/config.yaml"), "invalid; never load");
			await writeFile(join(cwd, ".ai/tasks.json"), "broken; never repair");
			const names = await readdir(join(cwd, ".ai"));
			const before = await Promise.all(names.map((name) => readFile(join(cwd, ".ai", name))));
			const projected = vi.spyOn(projection, "projectRunGraph");
			const reader = host();
			await reader.call("latest");
			const ascii = projected.mock.results[0].value;
			const { done } = await open(reader, selector);
			expect(projected).toHaveBeenCalledTimes(2);
			expect(projected.mock.results[1].value).toEqual(ascii);
			expect(ui.calls[0]).toMatchObject({ overlay: true, overlayOptions: { anchor: "center", width: "96%" } });
			expect(ui.terminal.getViewport().join("\n")).toContain("Weavra Graph");
			ui.terminal.sendInput("\r");
			ui.terminal.sendInput("r");
			expect(ui.editor.value).toBe("existing draft text");
			ui.terminal.sendInput("q");
			await done;
			await ui.terminal.waitForRender();
			expect(ui.tui.hasOverlay()).toBe(false);
			expect(ui.component?.isDisposed).toBe(true);
			const screen = ui.terminal.getViewport().join("\n");
			expect(screen).toContain("Editor: existing draft text");
			expect(screen).toContain("Footer: other-status | Weavra COMPLETED");
			expect(reader.models).not.toHaveBeenCalled();
			for (const method of [
				reader.setStatus,
				reader.setEditorText,
				reader.setEditorComponent,
				reader.setFooter,
				reader.setHeader,
			])
				expect(method).not.toHaveBeenCalled();
			expect(await readdir(join(cwd, ".ai"))).toEqual(names);
			expect(await Promise.all(names.map((name) => readFile(join(cwd, ".ai", name))))).toEqual(before);
			ui.terminal.sendInput("!");
			expect(ui.editor.value).toBe("existing draft text!");
		},
	);
	it("Escape closes only the viewer, and a new Host reconstructs stored R3 state after reload", async () => {
		const run = implementingGraphRun("R3");
		run.status = "WAITING_APPROVAL";
		run.approvals = [graphApproval("PENDING")];
		await store(run);
		await writeFile(join(cwd, ".ai/writer.lock"), "other owner");
		const before = await readFile(join(cwd, ".ai/state.json"));
		let showing = await open(host());
		const first = ui.component?.render(76);
		ui.terminal.sendInput("\u001b");
		await showing.done;
		showing = await open(host());
		expect(ui.component?.render(76)).toEqual(first);
		expect(first?.join("\n")).toContain("WAITING_APPROVAL");
		ui.terminal.sendInput("q");
		await showing.done;
		expect(await readFile(join(cwd, ".ai/state.json"))).toEqual(before);
		expect(await readFile(join(cwd, ".ai/writer.lock"), "utf8")).toBe("other owner");
	});
	it.each([
		"session_before_switch",
		"session_before_fork",
		"session_before_tree",
		"session_shutdown",
		"session_start",
	])("%s closes and disposes the overlay without leaving late input/redraw handlers", async (event) => {
		await store();
		const reader = host();
		const { done } = await open(reader);
		await reader.emit(event, event === "session_shutdown" ? "reload" : undefined);
		await done;
		expect(ui.tui.hasOverlay()).toBe(false);
		const redraw = vi.spyOn(ui.tui, "requestRender");
		ui.component?.handleInput("j");
		ui.component?.invalidate();
		expect(ui.component?.render(76)).toEqual([]);
		expect(redraw).not.toHaveBeenCalled();
		expect(reader.models).not.toHaveBeenCalled();
	});
	it("lifecycle close while readSnapshot is pending prevents a late overlay/error notification", async () => {
		await store();
		const snapshot = await FileStateStore.readSnapshot(cwd);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const read = vi.spyOn(FileStateStore, "readSnapshot").mockImplementationOnce(async () => {
			await gate;
			return snapshot;
		});
		const reader = host();
		const done = reader.call();
		expect(read).toHaveBeenCalledTimes(1);
		await reader.emit("session_shutdown", "reload");
		release();
		await done;
		expect(ui.calls).toEqual([]);
		expect(reader.notify).not.toHaveBeenCalled();
	});
	it("a factory attached after lifecycle close is immediately hidden and inert", async () => {
		await store();
		ui.control.deferFactory = true;
		const reader = host();
		const done = reader.call();
		await vi.waitFor(() => expect(ui.calls).toHaveLength(1));
		await reader.emit("session_shutdown", "reload");
		await done;
		await ui.attach();
		expect(ui.component?.isDisposed).toBe(true);
		expect(ui.tui.hasOverlay()).toBe(false);
		expect(ui.component?.render(76)).toEqual([]);
	});
	it("does not leave a reservation after failed custom UI creation", async () => {
		await store();
		const reader = host();
		ui.control.rejectCustom = true;
		await reader.call();
		expect(reader.notify).toHaveBeenLastCalledWith(expect.stringContaining("Weavra command failed"), "error");
		ui.control.rejectCustom = false;
		const { done } = await open(reader);
		ui.terminal.sendInput("q");
		await done;
	});
	it("a failing close UI cannot block lifecycle cleanup", async () => {
		await store();
		const reader = host();
		const { done } = await open(reader);
		vi.spyOn(ui.tui, "hideOverlay").mockImplementation(() => {
			throw new Error("UI close failed");
		});
		await reader.emit("session_shutdown", "quit");
		await done;
		expect(ui.component?.isDisposed).toBe(true);
		expect(ui.tui.hasOverlay()).toBe(false);
	});
	it("rejects duplicate viewers, non-TUI requests and invalid arguments before loading state", async () => {
		await store();
		const reader = host();
		const read = vi.spyOn(FileStateStore, "readSnapshot");
		reader.ctx.mode = "rpc";
		await reader.call();
		expect(reader.notify.mock.lastCall?.[0]).toContain("requires TUI");
		expect(read).not.toHaveBeenCalled();
		reader.ctx.mode = "tui";
		await reader.call("view latest retry");
		expect(read).not.toHaveBeenCalled();
		reader.ctx.isProjectTrusted = () => false;
		await reader.call();
		expect(read).not.toHaveBeenCalled();
		reader.ctx.isProjectTrusted = () => true;
		const { done } = await open(reader);
		await reader.call();
		expect(reader.notify.mock.lastCall?.[0]).toContain("already open");
		expect(ui.calls).toHaveLength(1);
		ui.terminal.sendInput("q");
		await done;
	});
	it("missing, unknown or malformed state opens no overlay and is never repaired", async () => {
		const reader = host();
		await reader.call();
		expect(ui.calls).toEqual([]);
		expect(await readdir(cwd)).toEqual([]);
		await store();
		await reader.call("view absent");
		expect(reader.notify.mock.lastCall?.[0]).toContain("Unknown run ID");
		await writeFile(join(cwd, ".ai/state.json"), "corrupt");
		await reader.call();
		expect(reader.notify.mock.lastCall?.[0]).toContain("integrity");
		expect(ui.calls).toEqual([]);
		expect(await readdir(join(cwd, ".ai"))).toEqual(["state.json"]);
		expect(await readFile(join(cwd, ".ai/state.json"), "utf8")).toBe("corrupt");
	});
	it("keeps the opened snapshot static while external state changes, then refreshes on a new open", async () => {
		await store();
		const reader = host();
		let showing = await open(reader);
		const before = ui.component?.render(76);
		const run: Run = { ...graphRun(), status: "CANCELLED" };
		await store(run);
		expect(ui.component?.render(76)).toEqual(before);
		ui.terminal.sendInput("q");
		await showing.done;
		showing = await open(reader);
		expect(ui.component?.render(76).join("\n")).toContain("CANCELLED");
		ui.terminal.sendInput("q");
		await showing.done;
	});
});
