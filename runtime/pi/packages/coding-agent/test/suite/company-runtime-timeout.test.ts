import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../../../company-runtime/src/agent-runner.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { Run } from "../../../company-runtime/src/contracts.ts";
import { registerCompanyRuntime } from "../../../company-runtime/src/extension.ts";
import { CompanyKernel } from "../../../company-runtime/src/kernel.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import { AgentSession, type ExtensionCommandContext, type RegisteredCommand } from "../../src/index.ts";
import { contractOf, suiteContract } from "./company-contract.ts";
import { createHarness, type Harness } from "./harness.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function input(context: Context): AgentExecutionRequest {
	const user = context.messages.find((message) => message.role === "user");
	if (!user || user.role !== "user") throw new Error("Missing worker input");
	return JSON.parse(
		typeof user.content === "string"
			? user.content
			: user.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
	) as AgentExecutionRequest;
}
function submit(request: AgentExecutionRequest) {
	return fauxAssistantMessage(
		fauxToolCall(
			request.role === "Reviewer" ? "submit_review" : "submit_handoff",
			request.role === "Reviewer"
				? {
						runId: request.runId,
						revision: request.revision,
						role: request.role,
						task: request.task.id,
						result: "PASS",
						issues: [],
						diffDigest: request.verification.diffDigest,
						evidenceRefs: request.verification.evidenceRefs,
						criteria: request.task.acceptanceCriteria.map((criterion) => ({
							criterionId: criterion.id,
							status: "MET",
							evidenceRefs: request.verification.evidenceRefs,
						})),
					}
				: {
						runId: request.runId,
						revision: request.revision,
						role: request.role,
						task: request.task.id,
						changed_files: [],
						summary: "Reviewed current source",
						assumptions: [],
						tests_run: [],
						known_risks: [],
						unresolved: [],
					},
		),
		{ stopReason: "toolUse" },
	);
}
let harness: Harness;
let cwd: string;
let agentDir: string;
let config: RuntimeConfig;
let store: FileStateStore | undefined;
let shutdown: (() => Promise<unknown>) | undefined;
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd,
		env: { PATH: process.env.PATH, HOME: agentDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		stdio: "pipe",
	});
beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding" }, { id: "review" }] });
	cwd = join(harness.tempDir, "project");
	agentDir = join(harness.tempDir, "workers");
	for (const dir of [agentDir, join(cwd, "src"), join(cwd, ".ai"), join(cwd, "scripts")])
		mkdirSync(dir, { recursive: true });
	config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			agents: { worker_timeout_ms: 120_000 },
			files: { allowed_paths: ["src"] },
			verification: {
				checks: [{ id: "check", kind: "test", executable: process.execPath, args: ["scripts/check.mjs"] }],
			},
		}),
	);
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	writeFileSync(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n");
	writeFileSync(join(cwd, "src/app.ts"), "original\n");
	writeFileSync(join(cwd, "scripts/check.mjs"), "console.log('CHECK_PASS');");
	git("init", "-q");
	git("add", "--", ".ai/config.yaml", ".gitignore", "src/app.ts", "scripts/check.mjs");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"Timeout fixture",
	);
	store = undefined;
	shutdown = undefined;
});
afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	await shutdown?.();
	await store?.close();
	harness.cleanup();
});
async function direct(role: "Developer" | "Reviewer") {
	store = await FileStateStore.open(cwd);
	const executor = await PiAgentExecutor.create({
		executionContract: { runId: "run", mode: "EDIT" },
		cwd,
		agentDir,
		config,
		modelRuntime: harness.session.modelRuntime,
		audit: store,
	});
	const kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: "run",
			task: suiteContract("Fix bug", { taskId: "task", checkIds: ["check"] }),
			classification: { intent: "bugfix", complexity: "STANDARD", risk: "R1", confidence: null, reason: "Fixture" },
		},
		{
			store,
			agents: executor,
			verifier: {
				verify: async () => {
					throw new Error("Not used");
				},
			},
		},
	);
	await kernel.start();
	const base = {
		executionMode: "EDIT" as const,
		runId: "run",
		revision: 0,
		task: contractOf(kernel.snapshot),
		onSessionCreated: async (ref: Run["roleSessionRefs"][number]) => {
			const run = (await store!.load("run"))!;
			await store!.save({ ...run, revision: run.revision + 1, roleSessionRefs: [...run.roleSessionRefs, ref] });
		},
	};
	const request: AgentExecutionRequest =
		role === "Developer"
			? { ...base, role, profile: "coding", step: { stepId: "implement", attempt: 1 } }
			: {
					...base,
					role,
					profile: "reasoning",
					step: { stepId: "review", attempt: 1 },
					handoff: {
						runId: "run",
						revision: 0,
						role: "Developer",
						task: "task",
						changed_files: [],
						summary: "Fixture",
						assumptions: [],
						tests_run: [],
						known_risks: [],
						unresolved: [],
					},
					verification: {
						runId: "run",
						revision: 0,
						step: { stepId: "self-check", attempt: 1 },
						diffDigest: "digest",
						evidenceRefs: ["diff"],
						checks: [],
						reviewContext: { diff: "", evidence: [{ ref: "diff", content: "Fixture" }] },
					},
				};
	return { executor, request };
}

describe("RC-04 bounded worker timeout with real SDK and virtual elapsed time", () => {
	it.each(["Developer", "Reviewer"] as const)(
		"%s succeeds after 60 seconds under the frozen configured budget",
		async (role) => {
			const { executor, request } = await direct(role);
			const entered = deferred<void>();
			const release = deferred<void>();
			let signal: AbortSignal | undefined;
			harness.setResponses([
				async (context, options) => {
					signal = options?.signal;
					entered.resolve();
					await release.promise;
					return submit(input(context));
				},
			]);
			// Neither external config mutation nor the previous 60s default may change this invocation's limit.
			config.agents.worker_timeout_ms = 10_000;
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			const job = executor.execute(request);
			await entered.promise;
			try {
				await vi.advanceTimersByTimeAsync(90_000);
				expect(signal?.aborted).toBe(false);
				expect(executor.safeToRelease).toBe(false);
			} finally {
				release.resolve();
			}
			expect((await job).role).toBe(role);
			expect(executor.safeToRelease).toBe(true);
		},
	);

	it("omitted config defaults to 180 seconds, not the old 60 seconds", async () => {
		config = parseRuntimeConfig(JSON.stringify({ ...config, agents: { max_parallel: 1, max_revision_cycles: 1 } }));
		expect(config.agents.worker_timeout_ms).toBe(180_000);
		const { executor, request } = await direct("Developer");
		const entered = deferred<void>();
		const release = deferred<void>();
		let signal: AbortSignal | undefined;
		harness.setResponses([
			async (context, options) => {
				signal = options?.signal;
				entered.resolve();
				await release.promise;
				return submit(input(context));
			},
		]);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const job = executor.execute(request);
		await entered.promise;
		try {
			await vi.advanceTimersByTimeAsync(179_999);
			expect(signal?.aborted).toBe(false);
		} finally {
			release.resolve();
		}
		expect((await job).role).toBe("Developer");
	});

	it.each(["late-result", "late-tool", "user-cancel"])(
		"configured deadline rejects %s and waits for a non-cooperative Provider",
		async (mode) => {
			const { executor, request } = await direct("Developer");
			const controller = new AbortController();
			const entered = deferred<void>();
			const release = deferred<void>();
			let signal: AbortSignal | undefined;
			let settled = false;
			harness.setResponses([
				async (context, options) => {
					signal = options?.signal;
					entered.resolve();
					await release.promise;
					return mode === "late-tool"
						? fauxAssistantMessage(fauxToolCall("runtime_write", { path: "src/app.ts", content: "LATE" }), {
								stopReason: "toolUse",
							})
						: submit(input(context));
				},
			]);
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
			const job = executor
				.execute({ ...request, signal: controller.signal })
				.catch((error: unknown) => error)
				.finally(() => {
					settled = true;
				});
			await entered.promise;
			try {
				await vi.advanceTimersByTimeAsync(119_999);
				expect(signal?.aborted).toBe(false);
				if (mode === "user-cancel") {
					controller.abort();
					expect(signal?.aborted).toBe(true);
				}
				await vi.advanceTimersByTimeAsync(1);
				expect(signal?.aborted).toBe(true);
				expect(settled).toBe(false);
				expect(executor.safeToRelease).toBe(false);
				await expect(FileStateStore.open(cwd)).rejects.toThrow();
			} finally {
				release.resolve();
			}
			const error = await job;
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toBe(mode === "user-cancel" ? "Worker aborted" : "Worker timed out");
			expect(executor.safeToRelease).toBe(true);
			expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe("original\n");
			expect(store!.snapshot.actions).toEqual([]);
			await expect(executor.execute(request)).rejects.toThrow("run stopped");
		},
	);

	it("uses one total execution budget across Provider turns, not a per-turn inactivity timeout", async () => {
		const { executor, request } = await direct("Developer");
		const first = deferred<void>();
		const second = deferred<void>();
		const releaseFirst = deferred<void>();
		const releaseSecond = deferred<void>();
		let signal: AbortSignal | undefined;
		harness.setResponses([
			async (_context, options) => {
				signal = options?.signal;
				first.resolve();
				await releaseFirst.promise;
				return fauxAssistantMessage(fauxToolCall("runtime_read", { path: "src/app.ts" }), {
					stopReason: "toolUse",
				});
			},
			async (context) => {
				second.resolve();
				await releaseSecond.promise;
				return submit(input(context));
			},
		]);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		const job = executor.execute(request).catch((error: unknown) => error);
		await first.promise;
		try {
			await vi.advanceTimersByTimeAsync(90_000);
			releaseFirst.resolve();
			await second.promise;
			expect(signal?.aborted).toBe(false);
			await vi.advanceTimersByTimeAsync(30_000);
			expect(signal?.aborted).toBe(true);
		} finally {
			releaseFirst.resolve();
			releaseSecond.resolve();
		}
		expect(await job).toMatchObject({ message: "Worker timed out" });
		expect(store!.snapshot.actions.map((action) => action.status)).toEqual(["SUCCEEDED"]);
	});

	it("rejects invalid config even when a trusted Host timeout override is present", async () => {
		store = await FileStateStore.open(cwd);
		config.agents.worker_timeout_ms = 600_001;
		await expect(
			PiAgentExecutor.create({
				executionContract: { runId: "run", mode: "EDIT" },
				cwd,
				agentDir,
				config,
				audit: store,
				modelRuntime: harness.session.modelRuntime,
				timeoutMs: 1000,
			}),
		).rejects.toThrow("Invalid runtime contract");
		expect(harness.faux.state.callCount).toBe(0);
	});

	it.each(["timeout", "cancel", "session_before_switch", "reload", "quit"])(
		"Extension propagates config; %s signals immediately and retains the lease until SDK cleanup",
		async (mode) => {
			const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
			const hooks = new Map<string, () => Promise<unknown>>();
			const notify = vi.fn();
			const completed = deferred<void>();
			const ctx = {
				cwd,
				hasUI: true,
				isIdle: () => true,
				isProjectTrusted: () => true,
				ui: {
					notify,
					confirm: async () => true,
					editor: async (_title: string, prefill?: string) => prefill ?? "",
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
			shutdown = hooks.get("session_shutdown");
			const create = PiAgentExecutor.create;
			const creation = vi.spyOn(PiAgentExecutor, "create");
			creation.mockImplementation(async (options) => {
				store = options.audit as FileStateStore;
				expect(options.timeoutMs).toBe(120_000);
				expect(options.config.agents.worker_timeout_ms).toBe(120_000);
				const executor = await create(options);
				const execute = executor.execute.bind(executor);
				vi.spyOn(executor, "execute").mockImplementation(async (request) => {
					vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
					try {
						return await execute(request);
					} finally {
						vi.useRealTimers();
					}
				});
				return executor;
			});
			const entered = deferred<void>();
			const releaseProvider = deferred<void>();
			const cleanupEntered = deferred<void>();
			const releaseCleanup = deferred<void>();
			let signal: AbortSignal | undefined;
			harness.setResponses([
				async (_context, options) => {
					signal = options?.signal;
					entered.resolve();
					await releaseProvider.promise;
					return fauxAssistantMessage(fauxToolCall("runtime_write", { path: "src/app.ts", content: "LATE" }), {
						stopReason: "toolUse",
					});
				},
			]);
			const abort = AgentSession.prototype.abort;
			vi.spyOn(AgentSession.prototype, "abort").mockImplementation(async function (this: AgentSession) {
				cleanupEntered.resolve();
				await releaseCleanup.promise;
				return abort.call(this);
			});
			notify.mockImplementation((text: string) => {
				if (text.includes("Status: FAILED") || text.includes("Status: CANCELLED")) completed.resolve();
			});
			await commands.get("workflow")!.handler("run Update dependency in src/app.ts", ctx);
			await entered.promise;
			let cancellation: Promise<unknown> | undefined;
			try {
				await vi.advanceTimersByTimeAsync(90_000);
				expect(signal?.aborted).toBe(false);
				if (mode === "timeout") await vi.advanceTimersByTimeAsync(30_000);
				else {
					cancellation =
						mode === "cancel"
							? commands.get("workflow")!.handler("cancel", ctx)
							: hooks.get(mode === "reload" || mode === "quit" ? "session_shutdown" : mode)!();
					expect(signal?.aborted).toBe(true);
					await vi.advanceTimersByTimeAsync(30_000);
				}
				expect(signal?.aborted).toBe(true);
				expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
				releaseProvider.resolve();
				await cleanupEntered.promise;
				await expect(FileStateStore.open(cwd)).rejects.toThrow();
				expect(store!.snapshot.runs[0]).toMatchObject({ phase: "IMPLEMENT", status: "RUNNING", verification: [] });
				expect(store!.snapshot.runs[0].roleSessionRefs.map((ref) => ref.role)).toEqual(["Developer"]);
				expect(store!.snapshot.actions).toEqual([]);
			} finally {
				releaseProvider.resolve();
				releaseCleanup.resolve();
			}
			await completed.promise;
			await cancellation;
			await shutdown!();
			expect(creation).toHaveBeenCalledTimes(1);
			const run = store!.snapshot.runs[0];
			expect(run.status).toBe(mode === "timeout" ? "FAILED" : "CANCELLED");
			expect(run.lastError).toBe(mode === "timeout" ? "Worker timed out" : "Run cancelled");
			expect(run.risk).toBe("R2");
			expect(run.review).toBeUndefined();
			expect(run.verification).toEqual([]);
			expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe("original\n");
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);
});
