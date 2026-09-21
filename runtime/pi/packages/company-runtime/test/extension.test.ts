import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	discoverAndLoadExtensions,
	type ExtensionCommandContext,
	type ExtensionContext,
	type RegisteredCommand,
	type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerCompanyRuntime } from "../src/extension.ts";

let cwd: string;
const config = `schemaVersion: 1
models:
  profiles:
    coding: { provider: faux, model: coding }
    reasoning: { provider: faux, model: review }
`;
const notify = vi.fn();
const setStatus = vi.fn();
const confirm = vi.fn(async () => false);
// Plan Preview AC editor: default to the current goal as the single criterion line.
const editor = vi.fn(async (_title: string, prefill?: string) => prefill ?? "");
const context = () =>
	({
		cwd,
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		isProjectTrusted: () => true,
		ui: { notify, confirm, editor, setStatus },
	}) as unknown as ExtensionCommandContext;
function commands() {
	const registered = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const on = vi.fn<(event: string, handler: unknown) => void>();
	const models = vi.fn(async () => {
		throw new Error("Must not load a provider in command-only tests");
	});
	registerCompanyRuntime(
		{
			registerCommand: (name, command) => {
				registered.set(name, command);
			},
			on,
		},
		{ createModels: models },
	);
	return {
		registered,
		on,
		models,
		call: (name: string, args = "", ctx = context()) => registered.get(name)!.handler(args, ctx),
	};
}
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "company-extension-"));
	notify.mockReset();
	setStatus.mockReset();
	confirm.mockClear();
	editor.mockClear();
});
afterEach(async () => {
	await rm(cwd, { recursive: true, force: true });
});

describe("S4 extension and S0 loader/trust regression", () => {
	it("registers six commands including read-only LSP status and unchanged lifecycle/input guards", async () => {
		const host = commands();
		expect([...host.registered.keys()]).toEqual(["lsp", "team", "state", "workflow", "risk", "graph"]);
		expect(host.on.mock.calls.map(([name]) => name)).toEqual([
			"session_start",
			"input",
			"tool_call",
			"user_bash",
			"session_before_switch",
			"session_before_fork",
			"session_before_tree",
			"session_shutdown",
		]);
		expect(host.models).not.toHaveBeenCalled();
		expect(await readdir(cwd)).toEqual([]);
	});
	it.each(["../src/extension.ts", "../"])("loads through the public Pi loader: %s", async (relativePath) => {
		const result = await discoverAndLoadExtensions(
			[fileURLToPath(new URL(relativePath, import.meta.url))],
			cwd,
			join(cwd, "agent"),
		);
		expect(result.errors).toEqual([]);
		expect(result.extensions).toHaveLength(1);
		const extension = result.extensions[0];
		expect([...extension.commands.keys()]).toEqual(["lsp", "team", "state", "workflow", "risk", "graph"]);
		expect(extension.tools.size).toBe(0);
		expect(extension.handlers.size).toBe(8);
		expect(result.runtime.pendingProviderRegistrations).toEqual([]);
		expect(result.runtime.pendingNativeProviderRegistrations).toEqual([]);
		expect(await readdir(cwd)).toEqual([]);
	});
	it.each(["tui", "rpc", "print", "json"] as const)("startup branding is TUI-only: %s", async (mode) => {
		const host = commands();
		const start = host.on.mock.calls.find(([name]) => name === "session_start")![1] as (
			event: SessionStartEvent,
			ctx: ExtensionContext,
		) => void;
		start({ type: "session_start", reason: "startup" }, { ...context(), mode });
		if (mode === "tui") {
			expect(notify).toHaveBeenCalledTimes(1);
			expect(notify).toHaveBeenCalledWith(expect.stringContaining("Weavra Runtime loaded — v0.1 RC1"), "info");
			expect(setStatus).toHaveBeenCalledExactlyOnceWith("weavra.runtime", undefined);
		} else {
			expect(notify).not.toHaveBeenCalled();
			expect(setStatus).not.toHaveBeenCalled();
		}
		expect(host.models).not.toHaveBeenCalled();
		expect(await readdir(cwd)).toEqual([]);
	});
	it.each(["workflow", "state", "team", "risk"])("provides Weavra help without config or state: %s", async (name) => {
		const host = commands();
		await host.call(name, "help");
		const text = notify.mock.calls.at(-1)![0] as string;
		expect(text).toContain("Weavra v0.1 RC1");
		expect(text).toContain(`/${name}`);
		expect(text).not.toMatch(/Company runtime|Personal AI Runtime/);
		if (name === "workflow") {
			for (const term of [
				"QUICK",
				"STANDARD",
				"R0",
				"R1",
				"R2",
				"scoped R3",
				"independent Reviewer",
				"Human Approval",
				"No automatic commit/rollback",
			])
				expect(text).toContain(term);
		}
		expect(host.registered.get(name)!.description).toContain("Weavra");
		expect(host.models).not.toHaveBeenCalled();
		expect(await readdir(cwd)).toEqual([]);
	});
	it("does not auto-discover the package", async () => {
		const result = await discoverAndLoadExtensions([], cwd, join(cwd, "agent"));
		expect(result.extensions).toEqual([]);
		expect(result.errors).toEqual([]);
	});
	it("missing config leaves the project untouched", async () => {
		await commands().call("state");
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("missing"), "warning");
		expect(await readdir(cwd)).toEqual([]);
	});
	it("reads current persisted status without interpreting corrupt state as success", async () => {
		await mkdir(join(cwd, ".ai"));
		await writeFile(join(cwd, ".ai/config.yaml"), config);
		await writeFile(join(cwd, ".ai/state.json"), "corrupt state");
		const host = commands();
		for (const name of ["team", "state", "workflow", "risk", "graph"]) {
			await host.call(name);
			expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("integrity"), "error");
		}
		expect(await readFile(join(cwd, ".ai/state.json"), "utf8")).toBe("corrupt state");
		expect(await readFile(join(cwd, ".ai/config.yaml"), "utf8")).toBe(config);
	});
	it("requires project trust and explicit command approval before providers", async () => {
		await mkdir(join(cwd, ".ai"));
		await writeFile(join(cwd, ".ai/config.yaml"), config);
		const host = commands();
		await host.call("workflow", "run Fix bug in src/a.ts", { ...context(), isProjectTrusted: () => false });
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("not trusted"), "warning");
		await host.call("workflow", "run Fix bug in src/a.ts");
		await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining("declined"), "info"));
		expect(confirm).toHaveBeenCalled();
		expect(editor).toHaveBeenCalled();
		expect(host.models).not.toHaveBeenCalled();
		await host.call("workflow", "cancel");
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("No rollback"), "info");
	});
	it("cancels a pending confirmation through its signal before loading models", async () => {
		await mkdir(join(cwd, ".ai"));
		await writeFile(join(cwd, ".ai/config.yaml"), config);
		const host = commands();
		let entered = false;
		const ctx = context();
		ctx.ui.confirm = async (_title, _message, options) => {
			entered = true;
			return new Promise<boolean>((resolve) => {
				if (options?.signal?.aborted) resolve(false);
				else options?.signal?.addEventListener("abort", () => resolve(false), { once: true });
			});
		};
		await host.call("workflow", "run Fix bug", ctx);
		await vi.waitFor(() => expect(entered).toBe(true));
		await host.call("workflow", "cancel", ctx);
		expect(host.models).not.toHaveBeenCalled();
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Preflight cancelled"), "warning");
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("No rollback"), "info");
	});
	it("shows the effective worker timeout without starting a worker", async () => {
		await mkdir(join(cwd, ".ai"));
		await writeFile(join(cwd, ".ai/config.yaml"), `${config}agents: { worker_timeout_ms: 240000 }\n`);
		const host = commands();
		await host.call("workflow", "config");
		expect(notify).toHaveBeenLastCalledWith(
			expect.stringContaining("Worker timeout: 240000ms per role invocation"),
			"info",
		);
		expect(host.models).not.toHaveBeenCalled();
	});
	it("invalid worker timeout fails before confirmation, models or writer acquisition", async () => {
		await mkdir(join(cwd, ".ai"));
		await writeFile(join(cwd, ".ai/config.yaml"), `${config}agents: { worker_timeout_ms: 600001 }\n`);
		const host = commands();
		await host.call("workflow", "run Fix bug");
		await vi.waitFor(() =>
			expect(notify).toHaveBeenCalledWith(expect.stringContaining("Invalid runtime config"), "error"),
		);
		expect(confirm).not.toHaveBeenCalled();
		expect(host.models).not.toHaveBeenCalled();
		expect(await readdir(join(cwd, ".ai"))).toEqual(["config.yaml"]);
	});

	it.each(["", "status"])("LSP status %j is read-only, disabled by default and never loads Provider", async (args) => {
		const host = commands();
		await host.call("lsp", args);
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("DISABLED"), "info");
		expect(await readdir(cwd)).toEqual([]);
		expect(host.models).not.toHaveBeenCalled();
	});
	it("LSP status resolves configured executable without process start/state mutation", async () => {
		await mkdir(join(cwd, ".ai"));
		const source = `${config}code_intelligence:\n  lsp:\n    enabled: true\n    servers:\n      - id: typescript\n        executable: ${JSON.stringify(process.execPath)}\n        args: []\n        extensions: [.ts]\n`;
		await writeFile(join(cwd, ".ai/config.yaml"), source);
		const host = commands();
		await host.call("lsp", "status");
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("typescript  READY"), "info");
		expect(notify.mock.lastCall?.[0]).toContain("process     stopped");
		expect(await readdir(join(cwd, ".ai"))).toEqual(["config.yaml"]);
		expect(await readFile(join(cwd, ".ai/config.yaml"), "utf8")).toBe(source);
		expect(host.models).not.toHaveBeenCalled();
	});
	it("LSP status enforces trust, UI, and status-only syntax", async () => {
		const host = commands();
		await host.call("lsp", "", { ...context(), isProjectTrusted: () => false });
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("not trusted"), "warning");
		await expect(host.call("lsp", "", { ...context(), hasUI: false })).rejects.toThrow("notification-capable");
		for (const args of ["install typescript", "diagnostics src/app.ts", "rename", "status extra"]) {
			await host.call("lsp", args);
			expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("Usage:"), "warning");
		}
		expect(host.models).not.toHaveBeenCalled();
		expect(await readdir(cwd)).toEqual([]);
	});
	it.each([
		["Explain src/a.ts", "READ_ONLY"],
		["Fix bug in src/a.ts", "EDIT"],
	])("requires explicit Host confirmation of %s as %s", async (goal, mode) => {
		await mkdir(join(cwd, ".ai"));
		await writeFile(join(cwd, ".ai/config.yaml"), config);
		const host = commands();
		const ctx = context();
		let shown = "";
		ctx.ui.confirm = async (_title, body) => {
			shown = body;
			return false;
		};
		await host.call("workflow", `run ${goal}`, ctx);
		await vi.waitFor(() => expect(notify).toHaveBeenCalledWith(expect.stringContaining("declined"), "info"));
		expect(shown).toContain(`Execution contract: ${mode}`);
		expect(shown).toContain("Acceptance criteria");
		expect(host.models).not.toHaveBeenCalled();
		expect(await readdir(join(cwd, ".ai"))).toEqual(["config.yaml"]);
	});
	it("does not confirm or start an ambiguous/mixed execution proposal", async () => {
		await mkdir(join(cwd, ".ai"));
		await writeFile(join(cwd, ".ai/config.yaml"), config);
		const host = commands();
		await host.call("workflow", "run Explain src/a.ts and fix its bug");
		await vi.waitFor(() =>
			expect(notify).toHaveBeenCalledWith(expect.stringContaining("Ambiguous execution request"), "error"),
		);
		expect(confirm).not.toHaveBeenCalled();
		expect(host.models).not.toHaveBeenCalled();
		expect(await readdir(join(cwd, ".ai"))).toEqual(["config.yaml"]);
	});
	it("rejects non-UI modes and a busy parent", async () => {
		const host = commands();
		await expect(host.call("state", "", { ...context(), hasUI: false })).rejects.toThrow("notification-capable UI");
		await host.call("workflow", "run Fix login", { ...context(), isIdle: () => false });
		expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("parent agent"), "warning");
		expect(host.models).not.toHaveBeenCalled();
	});
});
