import { EventEmitter, once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import type { SDKMessage, SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import { fauxProvider, InMemoryCredentialStore, type OAuthCredential } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../src/agent-runner.ts";
import { type ClaudeQuery, resolveHostModelAuth } from "../src/claude-sdk-transport.ts";
import type { ComplexDraft } from "../src/complex-types.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import { CompanyKernel } from "../src/kernel.ts";
import { resolvePlannerRoute } from "../src/model-routing.ts";
import { buildPlanningContext, runPlannerSession } from "../src/planner.ts";
import type { AgentExecutionRequest } from "../src/ports.ts";
import { FileStateStore } from "../src/state-store.ts";
import { buildTaskContract } from "../src/task-contract.ts";

const sdkQuery = vi.hoisted(() => vi.fn<ClaudeQuery>());
vi.mock("@anthropic-ai/claude-agent-sdk", async (load) => {
	const actual = await load<typeof ClaudeSdk>();
	return {
		...actual,
		query: sdkQuery,
		resolveSettings: async () => ({ effective: {}, provenance: {}, sources: [] }),
	};
});

function frame(event: SDKPartialAssistantMessage["event"]): SDKMessage {
	return {
		type: "stream_event",
		event,
		parent_tool_use_id: null,
		uuid: "00000000-0000-0000-0000-000000000002",
		session_id: "fixture",
	};
}
function answer(name: string, args: unknown): SDKMessage[] {
	return [
		frame({
			type: "content_block_start",
			index: 0,
			content_block: { type: "tool_use", id: "call-1", name, input: {} },
		}),
		frame({
			type: "content_block_delta",
			index: 0,
			delta: { type: "input_json_delta", partial_json: JSON.stringify(args) },
		}),
		frame({ type: "content_block_stop", index: 0 }),
		frame({
			type: "message_delta",
			context_management: null,
			delta: { stop_reason: "tool_use", stop_sequence: null, container: null, stop_details: null },
			usage: {
				output_tokens: 4,
				input_tokens: 3,
				cache_creation_input_tokens: 0,
				cache_read_input_tokens: 0,
				fallback_credit: null,
				iterations: null,
				output_tokens_details: null,
				server_tool_use: null,
			},
		}),
		frame({ type: "message_stop" }),
	];
}

let home: string;
let cwd: string;
let agentDir: string;
let runtime: ModelRuntime;
let credentials: InMemoryCredentialStore;
let store: FileStateStore;
const refresh = vi.fn(async (credential: OAuthCredential) => ({ ...credential, expires: Number.MAX_SAFE_INTEGER }));
const derive = vi.fn(async (credential: OAuthCredential) => ({ apiKey: credential.access }));
beforeEach(async () => {
	sdkQuery.mockReset();
	refresh.mockClear();
	derive.mockClear();
	home = await mkdtemp(join(tmpdir(), "claude-host-integration-"));
	cwd = join(home, "project");
	agentDir = join(home, "agent");
	await mkdir(join(cwd, "src"), { recursive: true });
	await mkdir(agentDir);
	credentials = new InMemoryCredentialStore();
	await credentials.modify("anthropic", async () => ({ type: "oauth", access: "expired", refresh: "r", expires: 0 }));
	runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
	const faux = fauxProvider({ provider: "anthropic", models: [{ id: "fixture-model" }] });
	runtime.registerNativeProvider({
		...faux.provider,
		auth: {
			oauth: {
				name: "Synthetic subscription",
				isSubscription: true,
				login: async () => {
					throw new Error("Forbidden login");
				},
				refresh,
				toAuth: derive,
			},
		},
	});
	store = await FileStateStore.open(cwd);
});
afterEach(async () => {
	await store.close();
	await rm(home, { recursive: true, force: true });
	vi.restoreAllMocks();
});

function config(enabled: boolean) {
	return parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "anthropic", model: "fixture-model" },
					reasoning: { provider: "anthropic", model: "fixture-model" },
				},
				claude_code: { enabled },
			},
			files: { allowed_paths: ["src"] },
			verification: { checks: [{ id: "regression", kind: "test", executable: "never-execute", args: [] }] },
		}),
	);
}

async function worker(enabled = true) {
	const selected = config(enabled);
	const executor = await PiAgentExecutor.create({
		executionContract: { runId: "run-1", mode: "EDIT" },
		cwd,
		agentDir,
		config: selected,
		modelRuntime: runtime,
		audit: store,
	});
	const task = buildTaskContract({
		goal: "Create a module",
		statements: ["Create a module"],
		workflow: "STANDARD",
		config: selected,
		taskId: "task-1",
	});
	const kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: "run-1",
			task,
			classification: { intent: "bugfix", complexity: "STANDARD", risk: "R1", confidence: null, reason: "Fixture" },
		},
		{
			store,
			agents: executor,
			verifier: {
				verify: async () => {
					throw new Error("No verifier in this adapter test");
				},
			},
			events: { emit: () => {} },
		},
	);
	await kernel.start();
	const request: AgentExecutionRequest = {
		executionMode: "EDIT",
		runId: "run-1",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		role: "Developer",
		profile: "coding",
		task,
		onSessionCreated: async (reference) => {
			const run = await store.load("run-1");
			if (!run) throw new Error("Missing fixture run");
			await store.save({ ...run, revision: run.revision + 1, roleSessionRefs: [...run.roleSessionRefs, reference] });
		},
	};
	return { executor, request };
}

describe("Claude SDK through Runtime tools and Policy", () => {
	it("executes a streamed write exactly once on the Host after SDK cleanup", async () => {
		const { executor, request } = await worker();
		const closedBeforeWrite: boolean[] = [];
		const prompts: unknown[] = [];
		const replies = [
			answer("mcp__weavra__runtime_write", { path: "src/new.ts", content: "host-owned" }),
			answer("mcp__weavra__submit_handoff", {
				runId: "run-1",
				revision: 0,
				role: "Developer",
				task: "task-1",
				changed_files: ["src/new.ts"],
				summary: "Created module",
				assumptions: [],
				tests_run: [],
				known_risks: [],
				unresolved: [],
			}),
		];
		sdkQuery.mockImplementation(({ prompt }) => {
			const messages = replies.shift();
			if (!messages) throw new Error("Unexpected SDK model turn");
			return {
				async *[Symbol.asyncIterator]() {
					for await (const message of prompt) {
						if (typeof message.message.content !== "string") throw new Error("Expected serialized Host input");
						const parsed: unknown = JSON.parse(message.message.content);
						prompts.push(parsed);
					}
					yield* messages;
				},
				close: () => {
					closedBeforeWrite.push(!existsSync(join(cwd, "src/new.ts")));
				},
			};
		});

		const result = await executor.execute(request);

		expect(result).toMatchObject({ handoff: { changed_files: ["src/new.ts"] } });
		expect(await readFile(join(cwd, "src/new.ts"), "utf8")).toBe("host-owned");
		expect(store.snapshot.actions.filter((action) => action.status === "SUCCEEDED")).toHaveLength(1);
		expect(closedBeforeWrite).toEqual([true, false]);
		expect(sdkQuery).toHaveBeenCalledTimes(2);
		expect(prompts[0]).toMatchObject({ runId: "run-1", role: "Developer", task: { id: "task-1" } });
		expect(prompts[1]).toMatchObject({
			history: expect.arrayContaining([
				expect.objectContaining({ role: "toolResult", toolName: "runtime_write", isError: false }),
			]),
		});
		expect(refresh).not.toHaveBeenCalled();
		expect(derive).not.toHaveBeenCalled();
		expect(executor.safeToRelease).toBe(true);
	});

	it("lets the official CLI own authentication without a legacy Runtime OAuth credential", async () => {
		await credentials.delete("anthropic");
		expect(await runtime.listCredentials()).toEqual([]);
		sdkQuery.mockImplementation(() => ({
			async *[Symbol.asyncIterator]() {
				yield* answer("mcp__weavra__submit_handoff", {
					runId: "run-1",
					revision: 0,
					role: "Developer",
					task: "task-1",
					changed_files: [],
					summary: "Synthetic transport-only handoff",
					assumptions: [],
					tests_run: [],
					known_risks: [],
					unresolved: [],
				});
			},
			close() {},
		}));
		const { executor, request } = await worker(true);

		const result = await executor.execute(request);

		expect(result).toMatchObject({ handoff: { changed_files: [] } });
		expect(sdkQuery).toHaveBeenCalledTimes(1);
		expect(refresh).not.toHaveBeenCalled();
		expect(derive).not.toHaveBeenCalled();
		expect(executor.safeToRelease).toBe(true);
	});

	it("keeps a forbidden SDK-requested write behind existing Runtime Policy", async () => {
		const { executor, request } = await worker();
		const close = vi.fn();
		sdkQuery.mockImplementation(() => ({
			async *[Symbol.asyncIterator]() {
				yield* answer("mcp__weavra__runtime_write", { path: "outside.ts", content: "forbidden" });
			},
			close,
		}));

		await expect(executor.execute(request)).rejects.toBeInstanceOf(Error);

		expect(existsSync(join(cwd, "outside.ts"))).toBe(false);
		expect(store.snapshot.actions.some((action) => action.status === "SUCCEEDED")).toBe(false);
		expect(close).toHaveBeenCalledTimes(1);
		expect(executor.safeToRelease).toBe(true);
	});

	it("rejects worker OAuth without opt-in before any auth resolution or SDK call", async () => {
		const auth = vi.spyOn(runtime, "getAuth");
		await expect(worker(false)).rejects.toMatchObject({ name: "WorkerModelUnavailableError" });
		expect(auth).not.toHaveBeenCalled();
		expect(sdkQuery).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		expect(derive).not.toHaveBeenCalled();
	});

	it("rejects an anthropic config with claude_code disabled with CLAUDE_CODE_DISABLED and allows it only when enabled", async () => {
		const model = runtime.getModel("anthropic", "fixture-model");
		if (!model) throw new Error("Missing fixture model");
		const disabled = config(false);
		expect(disabled.models.claude_code.enabled).toBe(false);
		await expect(
			resolveHostModelAuth({ runtime, model, claudeCodeEnabled: disabled.models.claude_code.enabled }),
		).rejects.toMatchObject({
			name: "ClaudeTransportError",
			code: "CLAUDE_CODE_DISABLED",
			message: "Claude 구독 계정은 Claude Code 사용을 명시적으로 켜야 해요.",
		});
		await expect(worker(false)).rejects.toMatchObject({
			name: "WorkerModelUnavailableError",
			message: "Claude 구독 계정은 Claude Code 사용을 명시적으로 켜야 해요.",
		});
		await expect(
			resolveHostModelAuth({ runtime, model, claudeCodeEnabled: config(true).models.claude_code.enabled }),
		).resolves.toEqual({ kind: "official-claude-sdk" });
		expect(sdkQuery).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});

	it("cancels a live SDK request and confirms cleanup before releasing the worker", async () => {
		const { executor, request } = await worker();
		const entered = new EventEmitter();
		const started = once(entered, "started", { signal: AbortSignal.timeout(3000) });
		const close = vi.fn();
		sdkQuery.mockImplementation(({ options }) => ({
			async *[Symbol.asyncIterator]() {
				const signal = options.abortController?.signal;
				if (!signal) throw new Error("Missing cancellation");
				const stopped = once(signal, "abort", { signal: AbortSignal.timeout(3000) });
				entered.emit("started");
				await stopped;
				yield frame({ type: "message_stop" });
			},
			close,
		}));
		const controller = new AbortController();
		const pending = executor.execute({ ...request, signal: controller.signal });
		const failure = expect(pending).rejects.toBeInstanceOf(Error);
		await started;
		controller.abort();
		await failure;
		expect(close).toHaveBeenCalledTimes(1);
		expect(store.snapshot.actions).toEqual([]);
		expect(executor.safeToRelease).toBe(true);
	});

	it("retains the project lease when SDK cleanup cannot be confirmed", async () => {
		const { executor, request } = await worker();
		sdkQuery.mockImplementation(() => ({
			async *[Symbol.asyncIterator]() {
				yield* answer("mcp__weavra__runtime_write", { path: "src/new.ts", content: "never" });
			},
			close: () => {
				throw new Error("Synthetic child cleanup failure");
			},
		}));
		await expect(executor.execute(request)).rejects.toThrow("cleanup unconfirmed");
		expect(existsSync(join(cwd, "src/new.ts"))).toBe(false);
		expect(executor.safeToRelease).toBe(false);
	});
});

describe("Planner shares the same transport guard", () => {
	for (const enabled of [false, true]) {
		it(`routes Planner with explicit Claude opt-in ${enabled}`, async () => {
			const selected = config(enabled);
			const signal = new AbortController().signal;
			const context = await buildPlanningContext({
				cwd,
				goal: "Refactor across multiple modules",
				config: selected,
				executionMode: "EDIT",
				risk: "R1",
				signal,
			});
			const draft: ComplexDraft = {
				tasks: [1, 2].map((index) => ({
					title: `Module ${index}`,
					goal: `Inspect module ${index}`,
					dependsOnIndexes: [],
					criterionIndexes: [1],
					ownership: [],
					checkIds: ["regression"],
				})),
			};
			const close = vi.fn();
			sdkQuery.mockImplementation(() => ({
				async *[Symbol.asyncIterator]() {
					yield* answer("mcp__weavra__submit_plan_draft", draft);
				},
				close,
			}));
			const auth = vi.spyOn(runtime, "getAuth");
			const validate = vi.fn(async () => ({ ok: true as const, draft }));
			const pending = runPlannerSession({
				cwd,
				agentDir,
				route: resolvePlannerRoute(selected),
				modelRuntime: runtime,
				context,
				maxReportedTokens: 200_000,
				signal,
				assertCurrent: async () => {},
				validate,
			});

			if (enabled) {
				expect(await pending).toEqual(draft);
				expect(validate).toHaveBeenCalledTimes(1);
				expect(close).toHaveBeenCalledTimes(1);
			} else {
				await expect(pending).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
				expect(sdkQuery).not.toHaveBeenCalled();
				expect(validate).not.toHaveBeenCalled();
			}
			expect(auth).not.toHaveBeenCalled();
			expect(refresh).not.toHaveBeenCalled();
			expect(derive).not.toHaveBeenCalled();
		});
	}
});
