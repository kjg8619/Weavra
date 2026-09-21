import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseRuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { Run } from "../../../company-runtime/src/contracts.ts";
import type { RuntimeEvent, RuntimeEventSink } from "../../../company-runtime/src/events.ts";
import { registerCompanyRuntime } from "../../../company-runtime/src/extension.ts";
import { CompanyKernel } from "../../../company-runtime/src/kernel.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import * as statusProjection from "../../../company-runtime/src/status.ts";
import { graphViewUI } from "../../../company-runtime/test/graph-view-harness.ts";
import type { ExtensionCommandContext, RegisteredCommand } from "../../src/index.ts";
import { suiteContract } from "./company-contract.ts";
import { createHarness, type Harness } from "./harness.ts";

const key = "weavra.runtime";
let harness: Harness;
let cwd: string;
let agentDir: string;
let blockReview: boolean;
let holdRole: string | undefined;
let shutdowns: Array<() => Promise<void>>;

function input(context: Context): AgentExecutionRequest & { risk: Run["risk"] } {
	const user = context.messages.find((message) => message.role === "user");
	if (!user || user.role !== "user") throw new Error("Missing worker input");
	return JSON.parse(
		typeof user.content === "string"
			? user.content
			: user.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
	);
}
function response(context: Context) {
	const request = input(context);
	if (request.role === "Reviewer")
		return fauxAssistantMessage(
			fauxToolCall("submit_review", {
				runId: request.runId,
				revision: request.revision,
				role: request.role,
				task: request.task.id,
				result: blockReview ? "BLOCK" : "PASS",
				issues: [],
				diffDigest: request.verification.diffDigest,
				evidenceRefs: request.verification.evidenceRefs,
				criteria: request.task.acceptanceCriteria.map((criterion) => ({
					criterionId: criterion.id,
					status: "MET",
					evidenceRefs: request.verification.evidenceRefs,
				})),
			}),
			{ stopReason: "toolUse" },
		);
	const readOnly = request.role === "Executor" && request.scope.risk === "R0";
	const path = request.risk === "R3" ? "src/obsolete.ts" : "src/app.ts";
	if (!context.messages.some((message) => message.role === "toolResult"))
		return fauxAssistantMessage(
			fauxToolCall(
				readOnly ? "runtime_read" : request.risk === "R3" ? "runtime_delete" : "runtime_write",
				readOnly || request.risk === "R3" ? { path } : { path, content: "fixed\n" },
			),
			{ stopReason: "toolUse" },
		);
	return fauxAssistantMessage(
		fauxToolCall("submit_handoff", {
			runId: request.runId,
			revision: request.revision,
			role: request.role,
			task: request.task.id,
			changed_files: readOnly ? [] : [path],
			summary: "Requested work performed",
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
			...(request.role === "Executor"
				? {
						criteria: request.task.acceptanceCriteria.map((criterion) => ({
							criterionId: criterion.id,
							status: "MET",
							explanation: "Done",
						})),
					}
				: {}),
		}),
		{ stopReason: "toolUse" },
	);
}
function host(events?: RuntimeEventSink) {
	const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const hooks = new Map<
		string,
		(event: { type: string; reason?: string }, ctx: ExtensionCommandContext) => Promise<void> | void
	>();
	const statuses = new Map<string, string>([["other-extension", "Other status"]]);
	const updates: Array<string | undefined> = [];
	const setStatus = vi.fn((name: string, text: string | undefined) => {
		if (text === undefined) statuses.delete(name);
		else statuses.set(name, text);
		if (name === key) updates.push(text);
	});
	const notify = vi.fn();
	const select = vi.fn(async () => "Approve once");
	const ctx = {
		cwd,
		mode: "tui",
		hasUI: true,
		isIdle: () => true,
		isProjectTrusted: () => true,
		ui: {
			setStatus,
			notify,
			confirm: async () => true,
			select,
			editor: async (_title: string, prefill?: string) => prefill ?? "",
		},
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
		{ agentDir, createModels: async () => harness.session.modelRuntime, events },
	);
	const emit = async (type: string, reason?: string) => {
		await hooks.get(type)!({ type, reason }, ctx);
	};
	shutdowns.push(() => emit("session_shutdown", "quit"));
	return {
		ctx,
		emit,
		setStatus,
		statuses,
		updates,
		notify,
		select,
		call: (name: string, args = "") => commands.get(name)!.handler(args, ctx),
		finished: async (status: Run["status"]) => {
			await vi.waitFor(
				() => expect(notify).toHaveBeenCalledWith(expect.stringContaining(`Status: ${status}`), expect.any(String)),
				{ timeout: 10_000 },
			);
		},
	};
}
function stored(): Run {
	return (JSON.parse(readFileSync(join(cwd, ".ai/state.json"), "utf8")) as { runs: Run[] }).runs.at(-1)!;
}
beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding" }, { id: "review" }] });
	cwd = join(harness.tempDir, "project");
	agentDir = join(harness.tempDir, "workers");
	for (const path of [agentDir, join(cwd, "src"), join(cwd, "scripts"), join(cwd, ".ai")])
		mkdirSync(path, { recursive: true });
	const config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			files: { allowed_paths: ["src"] },
			verification: {
				checks: [{ id: "regression", kind: "test", executable: process.execPath, args: ["scripts/check.mjs"] }],
			},
		}),
	);
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	writeFileSync(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n");
	writeFileSync(join(cwd, "src/app.ts"), "original\n");
	writeFileSync(join(cwd, "src/obsolete.ts"), "obsolete\n");
	writeFileSync(join(cwd, "scripts/check.mjs"), "console.log('CHECK_PASS');");
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			stdio: "pipe",
			env: { PATH: process.env.PATH, HOME: agentDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		});
	git("init", "-q");
	git("add", "--", ".ai/config.yaml", ".gitignore", "src/app.ts", "src/obsolete.ts", "scripts/check.mjs");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"Status fixture",
	);
	blockReview = false;
	holdRole = undefined;
	shutdowns = [];
	harness.setResponses(
		Array.from({ length: 32 }, () => async (context: Context, options) => {
			if (input(context).role === holdRole) {
				await new Promise<void>((resolve) => {
					if (options?.signal?.aborted) resolve();
					else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
			}
			return response(context);
		}),
	);
});
afterEach(async () => {
	for (const shutdown of shutdowns) await shutdown();
	vi.restoreAllMocks();
	harness.cleanup();
});

describe("Weavra Status Projection on the actual Extension/Kernel/SDK (faux only)", () => {
	it.each(["q", "\u001b"])(
		"V0.2B closing the viewer with %s does not cancel the live Worker or alter its footer",
		async (key) => {
			holdRole = "Developer";
			const owner = host();
			const ui = graphViewUI();
			owner.ctx.ui.custom = ui.custom;
			try {
				await owner.call("workflow", "run Fix bug");
				await vi.waitFor(() => expect(harness.faux.state.callCount).toBe(1), { timeout: 10000 });
				const before = readFileSync(join(cwd, ".ai/state.json"), "utf8");
				const statuses = [...owner.statuses];
				const providerCalls = harness.faux.state.callCount;
				const opens = vi.spyOn(FileStateStore, "open");
				const showing = owner.call("graph", "view");
				await vi.waitFor(() => expect(ui.tui.hasOverlay()).toBe(true), { timeout: 30_000, interval: 25 });
				await ui.terminal.waitForRender();
				ui.terminal.sendInput("\r");
				ui.terminal.sendInput(key);
				await showing;
				expect(stored().status).toBe("RUNNING");
				expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
				expect([...owner.statuses]).toEqual(statuses);
				expect(ui.editor.value).toBe("existing draft text");
				expect(opens).not.toHaveBeenCalled();
				expect(harness.faux.state.callCount).toBe(providerCalls);
				await owner.call("workflow", "cancel");
				expect(stored().status).toBe("CANCELLED");
				expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
			} finally {
				await owner.emit("session_shutdown", "quit");
				ui.stop();
			}
		},
	);
	it.each([false, true])(
		"V0.2B reload disposes the viewer before Runtime cleanup (UI close failure: %s)",
		async (failClose) => {
			holdRole = "Developer";
			const owner = host();
			const ui = graphViewUI();
			owner.ctx.ui.custom = ui.custom;
			try {
				await owner.call("workflow", "run Fix bug");
				await vi.waitFor(() => expect(harness.faux.state.callCount).toBe(1), { timeout: 10000 });
				const showing = owner.call("graph", "view latest");
				await vi.waitFor(() => expect(ui.tui.hasOverlay()).toBe(true), { timeout: 30_000, interval: 25 });
				if (failClose)
					vi.spyOn(ui.tui, "hideOverlay").mockImplementation(() => {
						throw new Error("UI close failed");
					});
				await owner.emit("session_shutdown", "reload");
				await showing;
				expect(ui.tui.hasOverlay()).toBe(false);
				expect(ui.component?.isDisposed).toBe(true);
				expect(ui.component?.render(76)).toEqual([]);
				expect(stored().status).toBe("CANCELLED");
				expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
				expect(owner.statuses.get("other-extension")).toBe("Other status");
			} finally {
				await owner.emit("session_shutdown", "quit");
				ui.stop();
			}
		},
	);
	it.each([
		{ goal: "Explain src/app.ts", workflow: "QUICK", risk: "R0", role: "Executor" },
		{ goal: "Fix typo in src/app.ts", workflow: "QUICK", risk: "R1", role: "Executor" },
		{ goal: "Fix bug", workflow: "STANDARD", risk: "R1", role: "Developer" },
		{ goal: "Update dependency in src/app.ts", workflow: "STANDARD", risk: "R2", role: "Developer" },
	])("projects $workflow/$risk transitions without reconstructing events", async ({ goal, workflow, risk, role }) => {
		const events: RuntimeEvent[] = [];
		const owner = host({
			emit: (event) => {
				events.push(event);
			},
		});
		await owner.emit("session_start", "startup");
		await owner.call("workflow", `run ${goal}`);
		await owner.finished("COMPLETED");
		const prefix = `Weavra · ${workflow} · ${risk}`;
		const expected = [
			`${prefix} · IMPLEMENT`,
			`${prefix} · IMPLEMENT · ${role}`,
			`${prefix} · SELF_CHECK`,
			...(workflow === "STANDARD" ? [`${prefix} · REVIEW`, `${prefix} · REVIEW · Reviewer`] : []),
			`${prefix} · TEST`,
			`${prefix} · COMPLETE`,
			"Weavra · COMPLETED",
		];
		expect(owner.updates.filter((text) => text !== undefined)).toEqual(expected);
		expect(owner.statuses.get(key)).toBe("Weavra · COMPLETED");
		expect(owner.statuses.get("other-extension")).toBe("Other status");
		expect(owner.setStatus.mock.calls.every(([name]) => name === key)).toBe(true);
		expect(events.at(-1)?.type).toBe("RunCompleted");
		expect(events.length).toBeGreaterThan(expected.length);
		expect(stored().verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
		expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).not.toContain("Weavra");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		const count = owner.setStatus.mock.calls.length;
		for (const name of ["workflow", "state", "team", "risk"]) await owner.call(name);
		expect(owner.setStatus).toHaveBeenCalledTimes(count);
	});

	it.each(["Approve once", "Deny"])("R3 displays APPROVAL before the human answer: %s", async (answer) => {
		const owner = host();
		owner.select.mockImplementation(async () => {
			expect(owner.statuses.get(key)).toBe("Weavra · STANDARD · R3 · APPROVAL · Developer");
			expect(stored()).toMatchObject({ status: "WAITING_APPROVAL", phase: "IMPLEMENT" });
			expect(existsSync(join(cwd, "src/obsolete.ts"))).toBe(true);
			return answer;
		});
		await owner.call("workflow", "run Delete file src/obsolete.ts");
		const status = answer === "Approve once" ? "COMPLETED" : "BLOCKED";
		await owner.finished(status);
		expect(owner.statuses.get(key)).toBe(`Weavra · ${status}`);
		expect(owner.select).toHaveBeenCalledTimes(1);
		expect(existsSync(join(cwd, "src/obsolete.ts"))).toBe(answer !== "Approve once");
	});

	it("shows BLOCKED, not stale REVIEW/Reviewer, after independent rejection", async () => {
		blockReview = true;
		const owner = host();
		await owner.call("workflow", "run Fix bug");
		await owner.finished("BLOCKED");
		expect(owner.statuses.get(key)).toBe("Weavra · BLOCKED");
		expect(owner.updates).not.toContain("Weavra · STANDARD · R1 · TEST");
	});

	it.each(["Executor", "Developer", "Reviewer"])(
		"cancel clears active %s to the actual CANCELLED outcome",
		async (role) => {
			holdRole = role;
			const owner = host();
			await owner.call("workflow", role === "Executor" ? "run Explain src/app.ts" : "run Fix bug");
			await vi.waitFor(() => expect(stored().roleSessionRefs.at(-1)?.role).toBe(role), { timeout: 10_000 });
			const count = owner.setStatus.mock.calls.length;
			await owner.call("state");
			expect(owner.setStatus).toHaveBeenCalledTimes(count);
			await owner.call("workflow", "cancel");
			expect(stored().status).toBe("CANCELLED");
			expect(owner.statuses.get(key)).toBe("Weavra · CANCELLED");
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);

	it.each(["session_shutdown", "session_before_switch", "session_before_fork", "session_before_tree"])(
		"%s detaches the footer before cleanup; late events cannot restore stale status",
		async (hook) => {
			holdRole = "Developer";
			const owner = host();
			await owner.call("workflow", "run Fix bug");
			await vi.waitFor(() => expect(stored().roleSessionRefs).toHaveLength(1), { timeout: 10_000 });
			const count = owner.updates.length;
			const leaving = owner.emit(hook, "reload");
			expect(owner.statuses.has(key)).toBe(false);
			await leaving;
			expect(stored().status).toBe("CANCELLED");
			expect(owner.updates.slice(count)).toEqual([undefined]);
			await owner.emit("session_start", "reload");
			await owner.call("state");
			expect(owner.statuses.has(key)).toBe(false);
			expect(owner.statuses.get("other-extension")).toBe("Other status");
			holdRole = undefined;
			await owner.call("workflow", "run Explain src/app.ts");
			await owner.finished("COMPLETED");
			expect(owner.statuses.get(key)).toBe("Weavra · COMPLETED");
		},
	);

	it("a new rejected preflight removes the previous terminal label", async () => {
		const owner = host();
		await owner.call("workflow", "run Explain src/app.ts");
		await owner.finished("COMPLETED");
		await owner.call("workflow", "run Fix typo in src/app.ts and delete src/obsolete.ts");
		await vi.waitFor(() =>
			expect(owner.notify).toHaveBeenCalledWith(expect.stringContaining("Unsupported classification"), "warning"),
		);
		expect(owner.statuses.has(key)).toBe(false);
	});

	it.each([false, true])(
		"stored active state (writer present: %s) is never promoted to a live footer",
		async (writer) => {
			const store = await FileStateStore.open(cwd);
			try {
				const kernel = await CompanyKernel.create(
					{
						executionMode: "EDIT",
						runId: "stored-run",
						task: suiteContract("Fix bug", { taskId: "task", checkIds: ["regression"] }),
						classification: {
							intent: "bugfix",
							complexity: "STANDARD",
							risk: "R1",
							confidence: null,
							reason: "Fixture",
						},
					},
					{
						store,
						agents: {
							execute: async () => {
								throw new Error("No worker should run");
							},
						},
						verifier: {
							verify: async () => {
								throw new Error("No check should run");
							},
						},
					},
				);
				await kernel.start();
				if (!writer) await store.close();
				const before = readFileSync(join(cwd, ".ai/state.json"), "utf8");
				const reader = host();
				reader.statuses.set(key, "Weavra · STANDARD · R1 · IMPLEMENT · Developer");
				await reader.emit("session_start", "reload");
				await reader.call("state");
				expect(reader.statuses.has(key)).toBe(false);
				expect(reader.notify).toHaveBeenLastCalledWith(
					expect.stringContaining(writer ? "not proof of a live worker" : "liveness is unconfirmed"),
					"info",
				);
				expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
				expect(harness.faux.state.callCount).toBe(0);
			} finally {
				await store.close();
			}
		},
	);

	it.each(["status", "observer", "both", "format"])(
		"%s failures do not change successful execution or cleanup",
		async (failure) => {
			const owner = host(
				failure === "observer" || failure === "both"
					? {
							emit: async () => {
								throw new Error("Observer failed");
							},
						}
					: undefined,
			);
			if (failure === "status" || failure === "both")
				owner.setStatus.mockImplementation(() => {
					throw new Error("Footer failed");
				});
			if (failure === "format")
				vi.spyOn(statusProjection, "formatWeavraStatus").mockImplementation(() => {
					throw new Error("Format failed");
				});
			await owner.call("workflow", "run Fix bug");
			await owner.finished("COMPLETED");
			expect(stored().status).toBe("COMPLETED");
			expect(stored().verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
			expect(stored().review?.result).toBe("PASS");
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
			if (failure === "observer" || failure === "both")
				expect(owner.notify).toHaveBeenCalledWith(expect.stringContaining("Observer delivery failures"), "info");
		},
	);

	it("does not publish TUI status for an RPC-hosted workflow", async () => {
		const owner = host();
		owner.ctx.mode = "rpc";
		await owner.call("workflow", "run Explain src/app.ts");
		await owner.finished("COMPLETED");
		expect(owner.setStatus).not.toHaveBeenCalled();
	});

	it("a failed status clear cannot interrupt lifecycle cancellation", async () => {
		holdRole = "Developer";
		const owner = host();
		await owner.call("workflow", "run Fix bug");
		await vi.waitFor(() => expect(stored().roleSessionRefs).toHaveLength(1), { timeout: 10_000 });
		owner.setStatus.mockImplementation(() => {
			throw new Error("Clear failed");
		});
		const count = owner.setStatus.mock.calls.length;
		await owner.emit("session_shutdown", "reload");
		expect(stored().status).toBe("CANCELLED");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		expect(owner.setStatus).toHaveBeenCalledTimes(count + 1);
	});

	it("reconciles a final cleanup failure even when the last event was RunCompleted", async () => {
		const close = FileStateStore.prototype.close;
		vi.spyOn(FileStateStore.prototype, "close").mockImplementation(async function (this: FileStateStore) {
			await close.call(this);
			throw new Error("Injected cleanup failure");
		});
		const owner = host();
		await owner.call("workflow", "run Fix bug");
		await owner.finished("COMPLETED");
		expect(owner.updates).toContain("Weavra · COMPLETED");
		expect(owner.statuses.get(key)).toBe("Weavra · ATTENTION · /state");
		expect(owner.notify).toHaveBeenCalledWith(expect.stringContaining("Lock cleanup failed"), "warning");
	});

	it("reconciles persistence failure without requiring a terminal event", async () => {
		const save = FileStateStore.prototype.save;
		vi.spyOn(FileStateStore.prototype, "save").mockImplementation(function (this: FileStateStore, run) {
			if (run.status === "COMPLETED") throw new Error("State persistence failed");
			return save.call(this, run);
		});
		const owner = host();
		await owner.call("workflow", "run Fix bug");
		await owner.finished("FAILED");
		expect(stored().status).toBe("RUNNING");
		expect(owner.statuses.get(key)).toBe("Weavra · FAILED");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
});
