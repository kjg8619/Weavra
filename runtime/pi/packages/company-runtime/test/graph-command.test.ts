import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionCommandContext, RegisteredCommand } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../src/agent-runner.ts";
import type { Run } from "../src/contracts.ts";
import { registerCompanyRuntime } from "../src/extension.ts";
import { FileStateStore } from "../src/state-store.ts";
import { StandardWorkflow } from "../src/workflow.ts";
import { GitWorkspace } from "../src/workspace.ts";
import { graphApproval, graphRun, implementingGraphRun } from "./graph-fixtures.ts";

let cwd: string;
function host() {
	const registered = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const models = vi.fn(async () => {
		throw new Error("Provider forbidden");
	});
	const notify = vi.fn();
	const setStatus = vi.fn();
	const ctx = {
		cwd,
		hasUI: true,
		mode: "tui",
		isProjectTrusted: () => true,
		ui: { notify, setStatus },
	} as unknown as ExtensionCommandContext;
	registerCompanyRuntime(
		{
			registerCommand: (name, command) => {
				registered.set(name, command);
			},
			on: () => {},
		},
		{ createModels: models },
	);
	return { ctx, notify, models, setStatus, call: (args = "") => registered.get("graph")!.handler(args, ctx) };
}
async function store(runs: Run[]) {
	await mkdir(join(cwd, ".ai"), { recursive: true });
	await writeFile(join(cwd, ".ai/state.json"), JSON.stringify({ schemaVersion: 1, revision: 1, runs, actions: [] }));
}
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "weavra-graph-"));
	vi.spyOn(FileStateStore, "open").mockImplementation(async () => {
		throw new Error("Graph must not acquire a writer");
	});
	vi.spyOn(StandardWorkflow.prototype, "execute").mockImplementation(async () => {
		throw new Error("Graph must not execute/resume");
	});
	vi.spyOn(PiAgentExecutor, "create").mockImplementation(async () => {
		throw new Error("Graph must not create an Agent");
	});
	vi.spyOn(GitWorkspace, "open").mockImplementation(async () => {
		throw new Error("Graph must not inspect/mutate Git");
	});
});
afterEach(async () => {
	expect(FileStateStore.open).not.toHaveBeenCalled();
	expect(StandardWorkflow.prototype.execute).not.toHaveBeenCalled();
	expect(PiAgentExecutor.create).not.toHaveBeenCalled();
	expect(GitWorkspace.open).not.toHaveBeenCalled();
	vi.restoreAllMocks();
	await rm(cwd, { recursive: true, force: true });
});

describe("/graph read-only observation boundary", () => {
	it.each(["", "latest", "run"])(
		"renders stored terminal state for selector %s without config/models/lock/repair",
		async (selector) => {
			await store([graphRun()]);
			await writeFile(join(cwd, ".ai/tasks.json"), "broken projection - keep");
			await writeFile(join(cwd, ".ai/config.yaml"), "invalid config - must not load");
			const before = await readFile(join(cwd, ".ai/state.json"));
			const reader = host();
			await reader.call(selector);
			expect(reader.notify).toHaveBeenLastCalledWith(expect.stringContaining("STANDARD / R1 / COMPLETED"), "info");
			expect(reader.notify.mock.lastCall?.[0]).toContain("no repair was performed");
			expect(reader.models).not.toHaveBeenCalled();
			expect(reader.setStatus).not.toHaveBeenCalled();
			expect(await readFile(join(cwd, ".ai/state.json"))).toEqual(before);
			expect(await readFile(join(cwd, ".ai/tasks.json"), "utf8")).toBe("broken projection - keep");
			expect(await readFile(join(cwd, ".ai/config.yaml"), "utf8")).toBe("invalid config - must not load");
			expect(await readdir(join(cwd, ".ai"))).toEqual(["config.yaml", "state.json", "tasks.json"]);
		},
	);
	it("a fresh Extension after reload reconstructs the same graph using state.json alone", async () => {
		await store([graphRun("STANDARD", "R2", 1)]);
		const first = host();
		await first.call();
		const second = host();
		await second.call();
		expect(second.notify.mock.lastCall?.[0]).toBe(first.notify.mock.lastCall?.[0]);
		expect(second.notify.mock.lastCall?.[0]).toContain("-- REVISE --> [Developer #2]");
		expect(await readdir(join(cwd, ".ai"))).toEqual(["state.json"]);
	});
	it("selects exact run IDs, not the latest fallback, and never resumes on action-like arguments", async () => {
		const first = graphRun();
		first.runId = "first";
		first.handoff!.runId = "first";
		first.review!.runId = "first";
		for (const check of first.verification) check.runId = "first";
		await store([first, graphRun("QUICK", "R0")]);
		const reader = host();
		await reader.call("latest");
		expect(reader.notify.mock.lastCall?.[0]).toContain("QUICK / R0");
		await reader.call("first");
		expect(reader.notify.mock.lastCall?.[0]).toContain("STANDARD / R1");
		for (const arg of ["absent", "fir", "export", "resume"]) {
			await reader.call(arg);
			expect(reader.notify).toHaveBeenLastCalledWith(expect.stringContaining("Unknown run ID"), "warning");
		}
		await reader.call("retry implement:1");
		expect(reader.notify).toHaveBeenLastCalledWith(expect.stringContaining("/graph [latest|runId]"), "warning");
		expect(reader.models).not.toHaveBeenCalled();
	});
	it.each([false, true])(
		"reads another owner's WAITING_APPROVAL without lock creation or approval changes (writer: %s)",
		async (writer) => {
			const run = implementingGraphRun("R3");
			run.status = "WAITING_APPROVAL";
			run.approvals = [graphApproval("PENDING")];
			await store([run]);
			if (writer) await writeFile(join(cwd, ".ai/writer.lock"), "another owner");
			const before = await readFile(join(cwd, ".ai/state.json"));
			const names = await readdir(join(cwd, ".ai"));
			const reader = host();
			await reader.call();
			expect(reader.notify.mock.lastCall?.[0]).toContain(
				"[Human Approval #1] WAITING_APPROVAL (PENDING) [inside implement:1]",
			);
			expect(reader.notify.mock.lastCall?.[0]).toContain(
				writer ? "not proof of a live worker" : "liveness is unconfirmed",
			);
			expect(await readFile(join(cwd, ".ai/state.json"))).toEqual(before);
			expect(await readdir(join(cwd, ".ai"))).toEqual(names);
			if (writer) expect(await readFile(join(cwd, ".ai/writer.lock"), "utf8")).toBe("another owner");
			expect(reader.models).not.toHaveBeenCalled();
		},
	);
	it.each(["json", "missing fields", "conflicting phase", "missing optional evidence", "orphan"])(
		"fails safely for %s without repairing",
		async (failure) => {
			const run = graphRun();
			if (failure === "conflicting phase") run.phase = "IMPLEMENT";
			if (failure === "missing optional evidence") {
				delete run.review;
				delete run.reviewHistory;
				delete run.handoff;
				run.verification = [];
			}
			await store([run]);
			if (failure === "json") await writeFile(join(cwd, ".ai/state.json"), "corrupt");
			if (failure === "missing fields")
				await writeFile(join(cwd, ".ai/state.json"), '{"runs":[{"status":"COMPLETED"}]}');
			if (failure === "orphan") {
				await rm(join(cwd, ".ai/state.json"));
				await writeFile(join(cwd, ".ai/tasks.json"), "{}");
			}
			const names = await readdir(join(cwd, ".ai"));
			const before = await Promise.all(names.map((name) => readFile(join(cwd, ".ai", name))));
			const reader = host();
			await reader.call();
			const output = reader.notify.mock.lastCall?.[0] as string;
			expect(output).toMatch(/integrity|Graph unavailable|UNKNOWN/);
			expect(output).not.toContain("] PASS");
			expect(await readdir(join(cwd, ".ai"))).toEqual(names);
			expect(await Promise.all(names.map((name) => readFile(join(cwd, ".ai", name))))).toEqual(before);
		},
	);
	it("does not hide corrupt source behind a previously rendered terminal graph", async () => {
		await store([graphRun()]);
		const reader = host();
		await reader.call();
		expect(reader.notify.mock.lastCall?.[0]).toContain("COMPLETED");
		await writeFile(join(cwd, ".ai/state.json"), "corrupt");
		await reader.call();
		expect(reader.notify.mock.lastCall?.[0]).toContain("integrity");
		expect(reader.notify.mock.lastCall?.[0]).not.toContain("COMPLETED");
	});
	it("missing state and help create no .ai directory", async () => {
		const reader = host();
		await reader.call();
		expect(reader.notify.mock.lastCall?.[0]).toContain("state missing");
		await reader.call("help");
		expect(reader.notify.mock.lastCall?.[0]).toContain("V0.2A");
		expect(reader.models).not.toHaveBeenCalled();
		expect(await readdir(cwd)).toEqual([]);
	});
	it("requires project trust and notification-capable UI before reading state", async () => {
		const read = vi.spyOn(FileStateStore, "readSnapshot");
		const reader = host();
		reader.ctx.isProjectTrusted = () => false;
		await reader.call();
		expect(reader.notify.mock.lastCall?.[0]).toContain("not trusted");
		reader.ctx.hasUI = false;
		await expect(reader.call()).rejects.toThrow("notification-capable UI");
		expect(read).not.toHaveBeenCalled();
		expect(reader.models).not.toHaveBeenCalled();
	});
});
