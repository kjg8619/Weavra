import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../../../company-runtime/src/agent-runner.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { ApprovalDecision, ApprovalRequest, Run } from "../../../company-runtime/src/contracts.ts";
import type { RuntimeEventSink } from "../../../company-runtime/src/events.ts";
import { registerCompanyRuntime } from "../../../company-runtime/src/extension.ts";
import { projectRunGraph, renderGraphText } from "../../../company-runtime/src/graph.ts";
import type { AgentExecutionRequest, ApprovalPort } from "../../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import { StandardWorkflow } from "../../../company-runtime/src/workflow.ts";
import type { ExtensionCommandContext, RegisteredCommand } from "../../src/index.ts";
import { workflowContract } from "./company-contract.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness;
let cwd: string;
let agentDir: string;
let config: RuntimeConfig;
let reviseUntil: number;
function input(context: Context): AgentExecutionRequest & { risk?: string } {
	const user = context.messages.find((message) => message.role === "user");
	if (!user || user.role !== "user") throw new Error("Missing context");
	return JSON.parse(
		typeof user.content === "string"
			? user.content
			: user.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
	) as AgentExecutionRequest & { risk?: string };
}
function response(context: Context) {
	const request = input(context);
	if (request.role !== "Reviewer") {
		const readOnly = request.role === "Executor" && request.scope.risk === "R0";
		if (request.revision === 0 && !context.messages.some((message) => message.role === "toolResult"))
			return fauxAssistantMessage(
				fauxToolCall(
					readOnly ? "runtime_read" : request.risk === "R3" ? "runtime_delete" : "runtime_write",
					readOnly
						? { path: "src/app.ts" }
						: request.risk === "R3"
							? { path: "src/obsolete.ts" }
							: { path: "src/app.ts", content: "fixed\n" },
				),
				{ stopReason: "toolUse" },
			);
		return fauxAssistantMessage(
			fauxToolCall("submit_handoff", {
				runId: request.runId,
				revision: request.revision,
				role: request.role,
				task: request.task.id,
				changed_files: readOnly ? [] : [request.risk === "R3" ? "src/obsolete.ts" : "src/app.ts"],
				summary: `Implementation cycle ${request.revision}`,
				assumptions: [],
				tests_run: [],
				known_risks: [],
				unresolved: [],
				...(request.role === "Executor"
					? {
							criteria: request.task.acceptanceCriteria.map((criterion) => ({
								criterionId: criterion.id,
								status: "MET",
								explanation: "Requested bounded task performed",
							})),
						}
					: {}),
			}),
			{ stopReason: "toolUse" },
		);
	}
	return fauxAssistantMessage(
		fauxToolCall("submit_review", {
			runId: request.runId,
			revision: request.revision,
			role: "Reviewer",
			task: request.task.id,
			result: request.risk !== "R3" && request.revision < reviseUntil ? "REVISE" : "PASS",
			issues: [],
			criteria: request.task.acceptanceCriteria.map((criterion) => ({
				criterionId: criterion.id,
				status: "MET",
				evidenceRefs: request.verification.evidenceRefs,
			})),
			evidenceRefs: request.verification.evidenceRefs,
			diffDigest: request.verification.diffDigest,
		}),
		{ stopReason: "toolUse" },
	);
}
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd,
		env: { PATH: process.env.PATH, HOME: agentDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		stdio: "pipe",
	}).toString();
const answer = (request: ApprovalRequest, approved = true): ApprovalDecision => ({
	runId: request.runId,
	actionId: request.actionId,
	actionDigest: request.actionDigest,
	configDigest: request.configDigest,
	expiresAt: request.expiresAt,
	approved,
});
function workflow(goal = "Fix bug", approval?: ApprovalPort, failObserver = false) {
	return new StandardWorkflow({
		executionMode: goal.startsWith("Explain") ? "READ_ONLY" : "EDIT",
		cwd,
		goal,
		taskContract: workflowContract(goal, config),
		config,
		approval,
		events: failObserver
			? {
					emit: () => {
						throw new Error("Observer unavailable");
					},
				}
			: undefined,
		createAgents: async (store, quickScope, r2RunId, r3Scope, executionContract) => {
			const executor = await PiAgentExecutor.create({
				executionContract,
				cwd,
				agentDir,
				config,
				quickScope,
				r2RunId,
				r3Scope,
				audit: store,
				modelRuntime: harness.session.modelRuntime,
				timeoutMs: 5000,
			});
			return { executor, policy: executor.policyContext };
		},
	});
}
function host(allowRun = false, events?: RuntimeEventSink) {
	const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const notify = vi.fn();
	const createModels = vi.fn(async () => {
		if (allowRun) return harness.session.modelRuntime;
		throw new Error("Observation commands must never resolve a model");
	});
	const ctx = {
		cwd,
		hasUI: true,
		isIdle: () => true,
		isProjectTrusted: () => true,
		ui: { notify, confirm: async () => true, editor: async (_title: string, prefill?: string) => prefill ?? "" },
	} as unknown as ExtensionCommandContext;
	registerCompanyRuntime(
		{
			registerCommand: (name, command) => {
				commands.set(name, command);
			},
			on: (_name: string, _handler: unknown) => {},
		},
		{ agentDir, createModels, events },
	);
	return {
		notify,
		createModels,
		ctx,
		call: async (name: string, args = "") => {
			await commands.get(name)!.handler(args, ctx);
			return notify.mock.lastCall?.[0] as string;
		},
	};
}
beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding" }, { id: "review" }] });
	cwd = join(harness.tempDir, "project");
	agentDir = join(harness.tempDir, "workers");
	for (const path of ["src", "scripts", ".ai"]) mkdirSync(join(cwd, path), { recursive: true });
	mkdirSync(agentDir);
	config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			agents: { max_revision_cycles: 3 },
			files: { allowed_paths: ["src"] },
			verification: {
				checks: [
					{
						id: "regression",
						kind: "test",
						executable: process.execPath,
						args: ["scripts/check.mjs"],
						timeout_ms: 3000,
					},
				],
			},
		}),
	);
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	writeFileSync(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n");
	writeFileSync(join(cwd, "src/app.ts"), "original\n");
	writeFileSync(join(cwd, "src/obsolete.ts"), "obsolete\n");
	writeFileSync(
		join(cwd, "scripts/check.mjs"),
		"import {readFileSync,existsSync} from 'node:fs'; const run=JSON.parse(readFileSync('.ai/state.json','utf8')).runs.at(-1); if(run.risk==='R3' ? existsSync('src/obsolete.ts') : run.risk!=='R0' && readFileSync('src/app.ts','utf8')!=='fixed\\n') process.exit(7); console.log('CHECK_OUTPUT'); console.error('CHECK_STDERR');",
	);
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
		"Observation fixture baseline",
	);
	reviseUntil = 3;
	harness.setResponses(Array.from({ length: 64 }, () => response));
});
afterEach(() => {
	vi.restoreAllMocks();
	harness.cleanup();
});

describe("S5D observations around the real STANDARD/QUICK/R3 slice", () => {
	it.each([
		{ goal: "Explain src/app.ts", workflow: "QUICK", risk: "R0" },
		{ goal: "Fix typo in src/app.ts", workflow: "QUICK", risk: "R1" },
		{ goal: "Fix bug", workflow: "STANDARD", risk: "R1" },
		{ goal: "Update dependency in src/app.ts", workflow: "STANDARD", risk: "R2" },
	])(
		"V0.2A reconstructs $workflow/$risk after Host reload without Provider/writer calls",
		async ({ goal, workflow: kind, risk }) => {
			reviseUntil = 0;
			const report = await workflow(goal).execute();
			expect(report.run?.status, report.error).toBe("COMPLETED");
			const before = readFileSync(join(cwd, ".ai/state.json"), "utf8");
			const calls = harness.faux.state.callCount;
			const opens = vi.spyOn(FileStateStore, "open");
			const reader = host();
			const text = await reader.call("graph", report.run!.runId);
			expect(text).toContain(`${kind} / ${risk} / COMPLETED`);
			expect(text).toContain(renderGraphText(projectRunGraph(report.run)));
			expect(await host().call("graph", "latest")).toBe(text);
			expect(reader.createModels).not.toHaveBeenCalled();
			expect(harness.faux.state.callCount).toBe(calls);
			expect(opens).not.toHaveBeenCalled();
			expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);
	it.each(["Explain src/app.ts", "Fix bug", "Delete file src/obsolete.ts"])(
		"V0.2A queries live snapshot at RuntimeEvent boundaries without replay: %s",
		async (goal) => {
			reviseUntil = goal === "Fix bug" ? 1 : 0;
			let owner: ReturnType<typeof host>;
			const phases = new Set<string>();
			const opens = vi.spyOn(FileStateStore, "open");
			owner = host(true, {
				emit: async (event) => {
					const before = readFileSync(join(cwd, ".ai/state.json"), "utf8");
					const calls = harness.faux.state.callCount;
					const opened = opens.mock.calls.length;
					const text = await owner.call("graph", "latest");
					if (event.type === "RunCreated") expect(text).toContain("preflight in progress");
					else {
						const run = (JSON.parse(before) as { runs: Run[] }).runs.at(-1)!;
						expect(text).toContain(renderGraphText(projectRunGraph(run)));
						expect(text).toContain("Source: live Kernel");
						phases.add(run.status === "WAITING_APPROVAL" ? "APPROVAL" : run.phase);
					}
					expect(harness.faux.state.callCount).toBe(calls);
					expect(opens).toHaveBeenCalledTimes(opened);
					expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
				},
			});
			owner.ctx.ui.select = async () => "Approve once";
			await owner.call("workflow", `run ${goal}`);
			await vi.waitFor(
				() => expect(owner.notify).toHaveBeenCalledWith(expect.stringContaining("Status: COMPLETED"), "info"),
				{ timeout: 10000 },
			);
			expect(phases).toContain("IMPLEMENT");
			expect(phases).toContain("SELF_CHECK");
			expect(phases).toContain("COMPLETE");
			if (goal.startsWith("Delete")) expect(phases).toContain("APPROVAL");
			const graph = await owner.call("graph");
			expect(graph).not.toContain("Observer delivery failures");
			expect(opens).toHaveBeenCalledTimes(1);
		},
	);
	it.each([false, true])("V0.2A keeps R3 approval and mutation distinct after approval=%s", async (approved) => {
		const report = await workflow("Delete file src/obsolete.ts", {
			requestApproval: async (request) => answer(request, approved),
		}).execute();
		expect(report.run?.status).toBe(approved ? "COMPLETED" : "BLOCKED");
		const text = await host().call("graph");
		expect(text).toContain(`[Human Approval #1] ${approved ? "PASS (CONSUMED)" : "BLOCKED (DENIED)"}`);
		expect(text).toContain(`[Mutation #1] ${approved ? "PASS" : "SKIPPED"}`);
		expect(report.run?.phase).toBe(approved ? "COMPLETE" : "IMPLEMENT");
	});
	it("V0.2A cancels a live Worker without graph queries executing or resuming it", async () => {
		let entered = false;
		harness.setResponses([
			async (_context, options) => {
				entered = true;
				await new Promise<void>((resolve) => {
					if (options?.signal?.aborted) resolve();
					else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return fauxAssistantMessage("late");
			},
		]);
		const owner = host(true);
		await owner.call("workflow", "run Fix bug");
		await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000, interval: 25 });
		const before = readFileSync(join(cwd, ".ai/state.json"), "utf8");
		const calls = harness.faux.state.callCount;
		const opens = vi.spyOn(FileStateStore, "open");
		expect(await owner.call("graph")).toContain("[Developer #1] RUNNING");
		expect(opens).not.toHaveBeenCalled();
		expect(harness.faux.state.callCount).toBe(calls);
		expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
		await owner.call("workflow", "cancel");
		const text = await host().call("graph");
		expect(text).toContain("[Developer #1] CANCELLED");
		expect(text).toContain("[Complete #1] SKIPPED");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it("V0.2A preserves historical PASS but shows a real stale-evidence BLOCK at COMPLETE", async () => {
		reviseUntil = 0;
		const owner = host(true, {
			emit: (event) => {
				if (event.type === "StepStarted" && event.step.stepId === "complete")
					writeFileSync(join(cwd, "src/stale.ts"), "external change\n");
			},
		});
		await owner.call("workflow", "run Fix bug");
		await vi.waitFor(
			() => expect(owner.notify).toHaveBeenCalledWith(expect.stringContaining("Status: BLOCKED"), "warning"),
			{ timeout: 10000 },
		);
		const text = await host().call("graph");
		expect(text).toContain("[Reviewer #1] PASS");
		expect(text).toContain("[Complete #1] BLOCKED");
		expect(text).toContain("review is stale");
	});
	it("honors configured three revision cycles and preserves every accepted review/handoff/check step", async () => {
		const report = await workflow().execute();
		expect(report.run?.status).toBe("COMPLETED");
		expect(report.run?.maxRevisionCycles).toBe(3);
		expect(report.run?.revisionCycle).toBe(3);
		expect(report.run?.reviewHistory?.map((review) => review.result)).toEqual(["REVISE", "REVISE", "REVISE", "PASS"]);
		expect(report.run?.handoff?.summary).toBe("Implementation cycle 3");
		expect(report.run?.roleSessionRefs).toHaveLength(8);
		expect(report.run?.verification.map((check) => check.step)).toEqual([
			{ stepId: "self-check", attempt: 1 },
			{ stepId: "self-check", attempt: 2 },
			{ stepId: "self-check", attempt: 3 },
			{ stepId: "self-check", attempt: 4 },
			{ stepId: "test", attempt: 4 },
		]);
		const reader = host();
		const calls = harness.faux.state.callCount;
		const before = readFileSync(join(cwd, ".ai/state.json"), "utf8");
		expect(await reader.call("workflow", "history")).toContain(report.run!.runId);
		expect(await reader.call("workflow", "config")).toContain("STANDARD 3");
		expect(await reader.call("state", `checks ${report.run!.runId}`)).toContain("self-check@4");
		expect(await reader.call("state", `check 5 ${report.run!.runId}`)).toContain("CHECK_STDERR");
		expect(await reader.call("state", "review")).toContain("REVISE | code revision 2");
		expect(await reader.call("state", "decisions")).toContain(`review:${report.run!.runId}:3`);
		expect(await reader.call("team")).toContain("4 session(s)");
		const graph = await reader.call("graph");
		expect(graph).toContain("-- REVISE --> [Developer #2]");
		expect(graph).toContain("[Reviewer #4] PASS");
		expect(graph).toContain("[Complete #4] PASS");
		expect(reader.createModels).not.toHaveBeenCalled();
		expect(harness.faux.state.callCount).toBe(calls);
		expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it("configured revision exhaustion preserves the terminal REVISE instead of fabricating PASS", async () => {
		reviseUntil = 4;
		const report = await workflow().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.run?.reviewHistory?.map((review) => review.result)).toEqual([
			"REVISE",
			"REVISE",
			"REVISE",
			"REVISE",
		]);
		expect(report.run?.roleSessionRefs).toHaveLength(8);
		const graph = await host().call("graph");
		expect(graph).toContain("[Reviewer #4] BLOCKED (review REVISE)");
		expect(graph).not.toContain("Developer #5");
	});
	it.each(["QUICK", "R3"])("keeps %s at zero revisions despite STANDARD's config value three", async (kind) => {
		const report = await workflow(kind === "QUICK" ? "Fix typo in src/app.ts" : "Delete file src/obsolete.ts", {
			requestApproval: async (request) => answer(request),
		}).execute();
		expect(report.run?.status).toBe("COMPLETED");
		expect(report.run?.maxRevisionCycles).toBe(0);
		expect(report.run?.revisionCycle).toBe(0);
	});
	it("exports checks and operational decisions without changing state or invalidating the next baseline", async () => {
		reviseUntil = 0;
		const first = await workflow().execute();
		expect(first.run?.status).toBe("COMPLETED");
		const reader = host();
		const before = readFileSync(join(cwd, ".ai/state.json"), "utf8");
		expect(await reader.call("state", "export")).toContain("2 file(s) updated");
		expect(await reader.call("state", "export")).toContain("0 file(s) updated");
		expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
		const log = JSON.parse(readFileSync(join(cwd, ".ai/logs/checks.json"), "utf8")) as {
			payload: { sourceRevision: number; checks: Array<{ step: { stepId: string }; stdout: string }> };
		};
		expect(log.payload.checks.map((check) => check.step.stepId)).toEqual(["self-check", "test"]);
		expect(log.payload.checks[0].stdout).toContain("CHECK_OUTPUT");
		expect(readFileSync(join(cwd, ".ai/decisions.md"), "utf8")).toContain(`review:${first.run!.runId}:0`);
		git("add", "--", "src/app.ts");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-m",
			"Accepted fixture change",
		);
		const second = await workflow("Explain src/app.ts").execute();
		expect(second.run?.status).toBe("COMPLETED");
		expect(second.run?.workflow).toBe("QUICK");
		const history = await reader.call("workflow", "history");
		expect(history).toContain(first.run!.runId);
		expect(history).toContain(second.run!.runId);
		expect(await reader.call("state", first.run!.runId)).toContain("Workflow: STANDARD");
	});
	it("observes stored state with invalid/missing config and does not use exported files as authority", async () => {
		reviseUntil = 0;
		await workflow().execute();
		const reader = host();
		await reader.call("state", "export");
		rmSync(join(cwd, ".ai/config.yaml"));
		writeFileSync(join(cwd, ".ai/decisions.md"), "MANUAL TEXT CLAIMING FAILURE");
		writeFileSync(join(cwd, ".ai/logs/checks.json"), "invalid");
		expect(await reader.call("state")).toContain("Status: COMPLETED");
		expect(await reader.call("state")).toContain("no live filesystem/check refresh");
		expect(await reader.call("workflow", "config")).toContain("missing");
		expect(reader.createModels).not.toHaveBeenCalled();
	});
	it("can query another owner's pending approval without invalidating it or exporting over its lock", async () => {
		let entered = false;
		const owner = workflow("Delete file src/obsolete.ts", {
			requestApproval: async (request, signal) => {
				entered = true;
				await new Promise<void>((resolve) => {
					if (signal?.aborted) resolve();
					else signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return answer(request, false);
			},
		});
		const job = owner.execute();
		await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000, interval: 25 });
		const before = readFileSync(join(cwd, ".ai/state.json"), "utf8");
		const reader = host();
		expect(await reader.call("state")).toContain("WAITING_APPROVAL");
		expect(await reader.call("risk")).toContain("Human approval: PENDING");
		expect(await reader.call("graph")).toContain(
			"[Human Approval #1] WAITING_APPROVAL (PENDING) [inside implement:1]",
		);
		expect(await reader.call("state", "export")).toContain("active/unconfirmed writer");
		expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
		expect(reader.createModels).not.toHaveBeenCalled();
		owner.cancel();
		const report = await job;
		expect(report.run?.status).toBe("CANCELLED");
		expect(existsSync(join(cwd, "src/obsolete.ts"))).toBe(true);
	});
	it("records observer failures as diagnostics, not failed checks or successful event delivery", async () => {
		reviseUntil = 0;
		const report = await workflow("Fix bug", undefined, true).execute();
		expect(report.run?.status).toBe("COMPLETED");
		expect(report.diagnostics?.[0]).toContain("Observer delivery failures");
	});
	it("unknown run/check/page produces a useful error and never selects another run", async () => {
		reviseUntil = 0;
		await workflow().execute();
		const reader = host();
		expect(await reader.call("state", "missing-id")).toContain("Unknown run ID");
		expect(await reader.call("state", "check 0")).toContain("positive");
		expect(await reader.call("state", "check 999")).toContain("out of range");
		expect(await reader.call("workflow", "history 999")).toContain("out of range");
		expect(await reader.call("state", "help")).toContain("/state export");
		expect(reader.createModels).not.toHaveBeenCalled();
	});
	it("reports local persistence failure separately from the durable active snapshot and never repairs on query", async () => {
		reviseUntil = 0;
		const save = FileStateStore.prototype.save;
		vi.spyOn(FileStateStore.prototype, "save").mockImplementation(function (this: FileStateStore, run) {
			if (run.status === "COMPLETED") throw new Error("Injected completion save failure");
			return save.call(this, run);
		});
		const reader = host(true);
		await reader.call("workflow", "run Fix bug");
		await vi.waitFor(
			() => expect(reader.notify).toHaveBeenCalledWith(expect.stringContaining("Status: FAILED"), "warning"),
			{ timeout: 5000 },
		);
		const before = readFileSync(join(cwd, ".ai/state.json"), "utf8");
		const durable = JSON.parse(before) as { runs: Run[] };
		expect(durable.runs[0].status).toBe("RUNNING");
		const output = await reader.call("state");
		expect(output).toContain("Status: FAILED");
		expect(output).toContain("Durable status: RUNNING");
		const graph = await reader.call("graph");
		expect(graph).toContain("STANDARD / R1 / FAILED");
		expect(graph).toContain("[Complete #1] FAIL");
		expect(graph).toContain("Durable status: RUNNING");
		expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
	});
	it("state corruption is never hidden by a previous successful local command result", async () => {
		reviseUntil = 0;
		const reader = host(true);
		await reader.call("workflow", "run Fix bug");
		await vi.waitFor(
			() => expect(reader.notify).toHaveBeenCalledWith(expect.stringContaining("Status: COMPLETED"), "info"),
			{ timeout: 5000 },
		);
		writeFileSync(join(cwd, ".ai/state.json"), "CORRUPTED");
		expect(await reader.call("state")).toContain("integrity");
		expect(await reader.call("graph")).toContain("integrity");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		expect(reader.createModels).toHaveBeenCalledTimes(1);
	});
});
