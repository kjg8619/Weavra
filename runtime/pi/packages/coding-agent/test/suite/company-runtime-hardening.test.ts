import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../../../company-runtime/src/agent-runner.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { ApprovalRequest, Run } from "../../../company-runtime/src/contracts.ts";
import type { RuntimeEvent } from "../../../company-runtime/src/events.ts";
import { registerCompanyRuntime } from "../../../company-runtime/src/extension.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import * as processes from "../../../company-runtime/src/process-runner.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import { RegisteredVerifier } from "../../../company-runtime/src/verification.ts";
import { StandardWorkflow } from "../../../company-runtime/src/workflow.ts";
import { AgentSession, type ExtensionCommandContext, type RegisteredCommand } from "../../src/index.ts";
import { workflowContract } from "./company-contract.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness;
let cwd: string;
let agentDir: string;
let config: RuntimeConfig;
let workflow: StandardWorkflow;
let store: FileStateStore | undefined;
let executor: PiAgentExecutor | undefined;
let events: RuntimeEvent[];
let failureRole: string | undefined;
let failureMode: string | undefined;
let pause: string | undefined;
let entered: boolean;
let pauseReady: (() => void) | undefined;
let order: string[];
let workers: AgentSession[];
let cleanupHooks: Array<() => Promise<unknown>>;
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}
function input(context: Context): AgentExecutionRequest & { risk?: string } {
	const user = context.messages.find((message) => message.role === "user");
	if (!user || user.role !== "user") throw new Error("No worker context");
	return JSON.parse(
		typeof user.content === "string"
			? user.content
			: user.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
	) as AgentExecutionRequest & { risk?: string };
}
function submit(request: AgentExecutionRequest & { risk?: string }) {
	if (request.role === "Reviewer")
		return fauxAssistantMessage(
			fauxToolCall("submit_review", {
				runId: request.runId,
				revision: request.revision,
				role: "Reviewer",
				task: request.task.id,
				result: "PASS",
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
	return fauxAssistantMessage(
		fauxToolCall("submit_handoff", {
			runId: request.runId,
			revision: request.revision,
			role: request.role,
			task: request.task.id,
			changed_files: [request.risk === "R3" ? "src/obsolete.ts" : "src/app.ts"],
			summary: "Structured fixture result",
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
			...(request.role === "Executor"
				? {
						criteria: request.task.acceptanceCriteria.map((criterion) => ({
							criterionId: criterion.id,
							status: "MET",
							explanation: "Fixture change",
						})),
					}
				: {}),
		}),
		{ stopReason: "toolUse" },
	);
}
async function respond(context: Context, options?: { signal?: AbortSignal }) {
	const request = input(context);
	if (request.role !== "Reviewer" && !context.messages.some((message) => message.role === "toolResult"))
		return fauxAssistantMessage(
			fauxToolCall(
				request.risk === "R3" ? "runtime_delete" : "runtime_write",
				request.risk === "R3" ? { path: "src/obsolete.ts" } : { path: "src/app.ts", content: "fixed\n" },
			),
			{ stopReason: "toolUse" },
		);
	if (pause === request.role) {
		entered = true;
		pauseReady?.();
		await new Promise<void>((resolve) => {
			if (options?.signal?.aborted) resolve();
			else
				options?.signal?.addEventListener(
					"abort",
					() => {
						order.push("cancel");
						resolve();
					},
					{ once: true },
				);
		});
		return submit(request);
	}
	if (failureRole === request.role) {
		if (failureMode === "connection") throw new Error("Faux connection failed");
		if (failureMode === "natural") return fauxAssistantMessage("Done. PASS.");
		if (failureMode === "malformed")
			return fauxAssistantMessage(
				fauxToolCall(request.role === "Reviewer" ? "submit_review" : "submit_handoff", {
					summary: "missing identity",
				}),
				{ stopReason: "toolUse" },
			);
		return fauxAssistantMessage("Partial streamed response before interruption", { stopReason: "aborted" });
	}
	return submit(request);
}
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd,
		env: { PATH: process.env.PATH, HOME: agentDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		stdio: "pipe",
	}).toString();
const grant = (request: ApprovalRequest) => ({
	runId: request.runId,
	actionId: request.actionId,
	actionDigest: request.actionDigest,
	configDigest: request.configDigest,
	expiresAt: request.expiresAt,
	approved: true,
});
function create(goal = "Fix bug") {
	workflow = new StandardWorkflow({
		executionMode: "EDIT",
		cwd,
		goal,
		taskContract: workflowContract(goal, config),
		config,
		approval: { requestApproval: async (request) => grant(request) },
		events: {
			emit: (event) => {
				events.push(event);
			},
		},
		createAgents: async (owned, quickScope, r2RunId, r3Scope, executionContract) => {
			store = owned;
			executor = await PiAgentExecutor.create({
				executionContract,
				cwd,
				agentDir,
				config,
				quickScope,
				r2RunId,
				r3Scope,
				modelRuntime: harness.session.modelRuntime,
				audit: owned,
				timeoutMs: 5000,
			});
			return { executor, policy: executor.policyContext };
		},
	});
	return workflow;
}
function state() {
	return JSON.parse(readFileSync(join(cwd, ".ai/state.json"), "utf8")) as {
		runs: Run[];
		actions: Array<{ status: string }>;
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
			files: { allowed_paths: ["src"] },
			verification: {
				checks: [
					{
						id: "check",
						kind: "test",
						executable: process.execPath,
						args: ["scripts/check.mjs", "pass", join(agentDir, "check-ready")],
						timeout_ms: 5000,
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
		"import {existsSync,readFileSync,writeFileSync} from 'node:fs'; const run=JSON.parse(readFileSync('.ai/state.json','utf8')).runs.at(-1); if(run.risk==='R3'?existsSync('src/obsolete.ts'):readFileSync('src/app.ts','utf8')!=='fixed\\n')process.exit(7); if(process.argv[2]==='slow'){writeFileSync(process.argv[3],'ready');setInterval(()=>{},1000);} console.log('CHECK_PASS');",
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
		"S6 fixture baseline",
	);
	events = [];
	workers = [];
	cleanupHooks = [];
	store = undefined;
	executor = undefined;
	failureRole = undefined;
	failureMode = undefined;
	pause = undefined;
	entered = false;
	pauseReady = undefined;
	order = [];
	harness.setResponses(Array.from({ length: 64 }, () => respond));
	const prompt = AgentSession.prototype.prompt;
	vi.spyOn(AgentSession.prototype, "prompt").mockImplementation(function (this: AgentSession, ...args) {
		workers.push(this);
		return prompt.apply(this, args);
	});
});
afterEach(async () => {
	vi.restoreAllMocks();
	for (const cleanup of cleanupHooks) await cleanup();
	for (const worker of workers) {
		await worker.abort();
		worker.dispose();
	}
	if (store) await store.close().catch(() => {});
	chmodSync(join(cwd, "src"), 0o755);
	harness.cleanup();
});

describe("S6 Provider result failure boundaries (faux only)", () => {
	it.each(
		["Developer", "Reviewer", "Executor"].flatMap((role) =>
			["connection", "natural", "malformed", "stream-aborted"].map((mode) => ({ role, mode })),
		),
	)("$role $mode never completes after partial mutation", async ({ role, mode }) => {
		failureRole = role;
		failureMode = mode;
		const report = await create(role === "Executor" ? "Fix typo in src/app.ts" : "Fix bug").execute();
		expect(report.run?.status).toBe("FAILED");
		expect(report.partialChanges).toBe(true);
		expect(report.changedFiles).toEqual(["src/app.ts"]);
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		expect(executor?.safeToRelease).toBe(true);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["auth", "model"])(
		"late Reviewer %s failure cannot reuse completed Developer work as success",
		async (mode) => {
			const execute = PiAgentExecutor.prototype.execute;
			vi.spyOn(PiAgentExecutor.prototype, "execute").mockImplementation(function (this: PiAgentExecutor, request) {
				if (request.role === "Reviewer") {
					if (mode === "auth") vi.spyOn(harness.session.modelRuntime, "getAuth").mockResolvedValue(undefined);
					else vi.spyOn(harness.session.modelRuntime, "getModel").mockReturnValue(undefined);
				}
				return execute.call(this, request);
			});
			const report = await create().execute();
			expect(report.run?.status).toBe("FAILED");
			expect(report.partialChanges).toBe(true);
			expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		},
	);
	it("waits for a non-cooperative Provider and rejects its late mutation after cancellation", async () => {
		const late = deferred<void>();
		harness.setResponses([
			async () => {
				entered = true;
				await late.promise;
				return fauxAssistantMessage(fauxToolCall("runtime_write", { path: "src/app.ts", content: "LATE" }), {
					stopReason: "toolUse",
				});
			},
		]);
		let settled = false;
		const job = create()
			.execute()
			.then((result) => {
				settled = true;
				return result;
			});
		await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000, interval: 25 });
		workflow.cancel();
		await new Promise((resolve) => setTimeout(resolve, 30));
		try {
			expect(settled).toBe(false);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
		} finally {
			late.resolve();
			await job;
		}
		const report = await job;
		expect(report.run?.status).toBe("CANCELLED");
		expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe("original\n");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it("cancellation during SDK cleanup wins over an already submitted structured result", async () => {
		const wait = deferred<void>();
		const abort = AgentSession.prototype.abort;
		vi.spyOn(AgentSession.prototype, "abort").mockImplementation(async function (this: AgentSession) {
			entered = true;
			await wait.promise;
			return abort.call(this);
		});
		const job = create().execute();
		await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000, interval: 25 });
		workflow.cancel();
		try {
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
		} finally {
			wait.resolve();
			await job;
		}
		const report = await job;
		expect(report.run?.status).toBe("CANCELLED");
		expect(report.run?.roleSessionRefs).toHaveLength(1);
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
	});
});

describe("S6 ownership must outlive resource cleanup", () => {
	it.each(["R1", "R3"])(
		"holds the %s failed writer through SDK cleanup after effect/result-save failure",
		async (risk) => {
			let fail = false;
			const open = FileStateStore.open.bind(FileStateStore);
			vi.spyOn(FileStateStore, "open").mockImplementation((path, options) =>
				open(path, {
					...options,
					beforeAtomicStep: (file, step) => {
						if (fail && file === "state.json" && step === "rename") throw new Error("Result persistence failed");
					},
				}),
			);
			const finish = FileStateStore.prototype.finish;
			vi.spyOn(FileStateStore.prototype, "finish").mockImplementation(function (this: FileStateStore, ...args) {
				if (args[2] === "SUCCEEDED") fail = true;
				return finish.apply(this, args);
			});
			const wait = deferred<void>();
			const abort = AgentSession.prototype.abort;
			vi.spyOn(AgentSession.prototype, "abort").mockImplementation(async function (this: AgentSession) {
				entered = true;
				await wait.promise;
				return abort.call(this);
			});
			const job = create(risk === "R3" ? "Delete file src/obsolete.ts" : "Fix bug").execute();
			await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000, interval: 25 });
			try {
				if (risk === "R3") expect(existsSync(join(cwd, "src/obsolete.ts"))).toBe(false);
				else expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe("fixed\n");
				expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
				await expect(open(cwd)).rejects.toThrow();
			} finally {
				wait.resolve();
				await job;
			}
			const report = await job;
			expect(report.run?.status).toBe("FAILED");
			expect(report.partialChanges).toBe(true);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
			expect(state().actions[0].status).toBe("PREPARED");
			if (risk === "R3") expect(state().runs[0].approvals?.[0].status).toBe("APPROVED");
		},
	);
	it.each(["abort", "dispose"] as const)(
		"SDK %s failure retains the lease and prevents another role",
		async (method) => {
			if (method === "abort")
				vi.spyOn(AgentSession.prototype, "abort").mockRejectedValue(new Error("Cleanup error"));
			else
				vi.spyOn(AgentSession.prototype, "dispose").mockImplementation(() => {
					throw new Error("Dispose error");
				});
			const report = await create().execute();
			expect(report.run?.status).toBe("FAILED");
			expect(executor?.safeToRelease).toBe(false);
			expect(report.error).toContain("cleanup unconfirmed");
			expect(report.changesUnknown).toBe(true);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
			await expect(FileStateStore.open(cwd)).rejects.toThrow();
			expect(report.run?.roleSessionRefs).toHaveLength(1);
		},
	);
	it.each(["false-result", "throw", "cancel-throw", "git-preflight"])(
		"unconfirmed process outcome retains the lock: %s",
		async (mode) => {
			const real = processes.runProcess;
			vi.spyOn(processes, "runProcess").mockImplementation(async (request) => {
				const match =
					mode === "git-preflight"
						? request.argv.includes("--show-toplevel")
						: request.argv.includes("scripts/check.mjs");
				if (!match) return real(request);
				if (mode === "throw" || mode === "cancel-throw") {
					if (mode === "cancel-throw") workflow.cancel();
					throw new Error("Process cleanup threw");
				}
				return {
					exitCode: 0,
					stdout: "",
					stderr: "",
					startedAt: Date.now(),
					finishedAt: Date.now(),
					reason: "exited",
					cleanupConfirmed: false,
				};
			});
			const report = await create().execute();
			expect(report.run?.status).not.toBe("COMPLETED");
			expect(report.error).toContain("lock retained");
			expect(report.changesUnknown).toBe(true);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
			await expect(FileStateStore.open(cwd)).rejects.toThrow();
		},
	);
	it("check completion racing cancellation cannot fabricate PASS", async () => {
		const real = processes.runProcess;
		vi.spyOn(processes, "runProcess").mockImplementation(async (request) => {
			const result = await real(request);
			if (request.argv.includes("scripts/check.mjs")) workflow.cancel();
			return result;
		});
		const report = await create().execute();
		expect(report.run?.status).toBe("CANCELLED");
		expect(report.run?.verification[0].status).toBe("FAIL");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it("result-save failure plus cancellation is not retried as a second audit finish", async () => {
		const finish = FileStateStore.prototype.finish;
		const spy = vi.spyOn(FileStateStore.prototype, "finish").mockImplementation(function (
			this: FileStateStore,
			...args
		) {
			const record = this.snapshot.actions.find((item) => item.decision.actionId === args[1]);
			if (record?.decision.role === "Verifier") {
				workflow.cancel();
				throw new Error("Finish persistence failed");
			}
			return finish.apply(this, args);
		});
		const report = await create().execute();
		expect(report.run?.status).not.toBe("COMPLETED");
		const verifierId = store!.snapshot.actions.find((item) => item.decision.role === "Verifier")!.decision.actionId;
		expect(spy.mock.calls.filter((call) => call[1] === verifierId)).toHaveLength(1);
	});
	it.skipIf(process.getuid?.() === 0)(
		"an effect failure after human approval is not recorded as consumed consent",
		async () => {
			const owner = new StandardWorkflow({
				executionMode: "EDIT",
				cwd,
				goal: "Delete file src/obsolete.ts",
				taskContract: workflowContract("Delete file src/obsolete.ts", config),
				config,
				approval: {
					requestApproval: async (request) => {
						chmodSync(join(cwd, "src"), 0o555);
						return grant(request);
					},
				},
				createAgents: async (owned, quickScope, r2RunId, r3Scope, executionContract) => {
					store = owned;
					const runner = await PiAgentExecutor.create({
						executionContract,
						cwd,
						agentDir,
						config,
						quickScope,
						r2RunId,
						r3Scope,
						audit: owned,
						modelRuntime: harness.session.modelRuntime,
					});
					return { executor: runner, policy: runner.policyContext };
				},
			});
			try {
				const report = await owner.execute();
				expect(report.run?.status).toBe("FAILED");
				expect(existsSync(join(cwd, "src/obsolete.ts"))).toBe(true);
				expect(report.run?.approvals?.[0].status).toBe("INTERRUPTED");
				expect(state().actions[0].status).toBe("FAILED");
			} finally {
				chmodSync(join(cwd, "src"), 0o755);
			}
		},
	);
});

const lifecycleCases = ["Developer", "Reviewer", "check", "approval"].flatMap((phase) =>
	["session_before_switch", "session_before_fork", "session_before_tree", "reload", "quit", "cancel"].map((event) => ({
		phase,
		event,
	})),
);
describe("S6 lifecycle cleanup ordering", () => {
	it.each(lifecycleCases)(
		"$event during $phase: cancel → termination → terminal state → unlock",
		async ({ phase, event }) => {
			pause = phase;
			const ready = deferred<void>();
			pauseReady = () => ready.resolve();
			if (phase === "check") {
				config.verification.checks[0].args[1] = "slow";
				writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
				git("add", "--", ".ai/config.yaml");
				git(
					"-c",
					"user.name=Fixture",
					"-c",
					"user.email=fixture@invalid",
					"-c",
					"commit.gpgsign=false",
					"commit",
					"-m",
					"Slow check fixture",
				);
			}
			const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
			const hooks = new Map<string, () => Promise<unknown>>();
			const notify = vi.fn();
			const ctx = {
				cwd,
				hasUI: true,
				isIdle: () => true,
				isProjectTrusted: () => true,
				ui: {
					notify,
					confirm: async () => true,
					editor: async (_title: string, prefill?: string) => prefill ?? "",
					select: async (_title: string, _items: string[], options?: { signal?: AbortSignal }) => {
						entered = true;
						pauseReady?.();
						await new Promise<void>((resolve) => {
							if (options?.signal?.aborted) resolve();
							else
								options?.signal?.addEventListener(
									"abort",
									() => {
										order.push("cancel");
										resolve();
									},
									{ once: true },
								);
						});
						return undefined;
					},
				},
			} as unknown as ExtensionCommandContext;
			registerCompanyRuntime(
				{
					registerCommand: (name, command) => {
						commands.set(name, command);
					},
					on: (name: string, handler: unknown) => {
						hooks.set(name, handler as () => Promise<unknown>);
					},
				},
				{ agentDir, createModels: async () => harness.session.modelRuntime },
			);
			cleanupHooks.push(() => hooks.get("session_shutdown")!());
			const dispose = AgentSession.prototype.dispose;
			vi.spyOn(AgentSession.prototype, "dispose").mockImplementation(function (this: AgentSession) {
				dispose.call(this);
				order.push("worker-ended");
			});
			const verify = RegisteredVerifier.prototype.verify;
			vi.spyOn(RegisteredVerifier.prototype, "verify").mockImplementation(async function (
				this: RegisteredVerifier,
				request,
			) {
				request.signal?.addEventListener("abort", () => order.push("cancel"), { once: true });
				const result = await verify.call(this, request);
				order.push("process-ended");
				return result;
			});
			const save = FileStateStore.prototype.save;
			vi.spyOn(FileStateStore.prototype, "save").mockImplementation(async function (this: FileStateStore, run) {
				await save.call(this, run);
				if (run.status === "CANCELLED") order.push("terminal-state");
			});
			const close = FileStateStore.prototype.close;
			vi.spyOn(FileStateStore.prototype, "close").mockImplementation(async function (this: FileStateStore) {
				await close.call(this);
				order.push("unlock");
			});
			await commands
				.get("workflow")!
				.handler(`run ${phase === "approval" ? "Delete file src/obsolete.ts" : "Fix bug"}`, ctx);
			// Await the fixture's actual pause, not an unrelated one-second polling deadline.
			// The enclosing test deadline and afterEach cancellation still bound failed startup.
			if (phase === "check") await vi.waitFor(() => expect(existsSync(join(agentDir, "check-ready"))).toBe(true));
			else await ready.promise;
			order.length = 0;
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
			if (event === "cancel") await commands.get("workflow")!.handler("cancel", ctx);
			else await hooks.get(event === "reload" || event === "quit" ? "session_shutdown" : event)!();
			const end = phase === "check" ? "process-ended" : "worker-ended";
			expect(order.indexOf("cancel")).toBeGreaterThanOrEqual(0);
			expect(order.indexOf(end)).toBeGreaterThan(order.indexOf("cancel"));
			expect(order.indexOf("terminal-state")).toBeGreaterThan(order.indexOf(end));
			expect(order.indexOf("unlock")).toBeGreaterThan(order.indexOf("terminal-state"));
			expect(state().runs[0].status).toBe("CANCELLED");
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
			if (phase === "approval") expect(existsSync(join(cwd, "src/obsolete.ts"))).toBe(true);
		},
	);
});
