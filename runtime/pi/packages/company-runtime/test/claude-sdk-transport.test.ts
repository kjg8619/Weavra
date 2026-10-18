import { EventEmitter, once } from "node:events";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type * as ClaudeSdk from "@anthropic-ai/claude-agent-sdk";
import { resolveSettings, type SDKMessage, type SDKPartialAssistantMessage } from "@anthropic-ai/claude-agent-sdk";
import {
	fauxAssistantMessage,
	fauxProvider,
	InMemoryCredentialStore,
	type OAuthCredential,
	Type,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type ClaudeQuery,
	createHostModelTransport,
	createHostToolServer,
	resolveHostModelAuth,
} from "../src/claude-sdk-transport.ts";

vi.mock("@anthropic-ai/claude-agent-sdk", async (load) => {
	const actual = await load<typeof ClaudeSdk>();
	return { ...actual, resolveSettings: vi.fn(async () => ({ effective: {}, provenance: {}, sources: [] })) };
});

function frame(event: SDKPartialAssistantMessage["event"]): SDKMessage {
	return {
		type: "stream_event",
		event,
		parent_tool_use_id: null,
		uuid: "00000000-0000-0000-0000-000000000001",
		session_id: "fixture",
	};
}

function answer(name?: string, args: Record<string, unknown> = {}): SDKMessage[] {
	return [
		frame({
			type: "content_block_start",
			index: 0,
			content_block: name
				? { type: "tool_use", id: "call-1", name, input: {} }
				: { type: "text", text: "", citations: null },
		}),
		frame({
			type: "content_block_delta",
			index: 0,
			delta: name
				? { type: "input_json_delta", partial_json: JSON.stringify(args) }
				: { type: "text_delta", text: "complete" },
		}),
		frame({ type: "content_block_stop", index: 0 }),
		frame({
			type: "message_delta",
			context_management: null,
			delta: {
				stop_reason: name ? "tool_use" : "end_turn",
				stop_sequence: null,
				container: null,
				stop_details: null,
			},
			usage: {
				output_tokens: 7,
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

function fakeQuery(messages = answer()) {
	const close = vi.fn();
	const query = vi.fn<ClaudeQuery>(() => ({
		async *[Symbol.asyncIterator]() {
			yield* messages;
		},
		close,
	}));
	return { query, close };
}

async function account(kind: "api_key" | "oauth" = "oauth") {
	const credentials = new InMemoryCredentialStore();
	await credentials.modify("anthropic", async () =>
		kind === "api_key"
			? { type: "api_key", key: "synthetic-key" }
			: { type: "oauth", access: "expired", refresh: "r", expires: 0 },
	);
	const runtime = await ModelRuntime.create({ credentials, modelsPath: null, refreshOnCreate: false });
	const faux = fauxProvider({ provider: "anthropic", models: [{ id: "fixture-model" }] });
	const refresh = vi.fn(async (credential: OAuthCredential) => ({ ...credential, expires: Number.MAX_SAFE_INTEGER }));
	const derive = vi.fn(async (credential: OAuthCredential) => ({ apiKey: credential.access }));
	runtime.registerNativeProvider({
		...faux.provider,
		auth: {
			apiKey: {
				name: "Synthetic",
				check: async ({ credential }) => (credential?.key ? { type: "api_key" } : undefined),
				resolve: async ({ credential }) => (credential?.key ? { auth: { apiKey: credential.key } } : undefined),
			},
			oauth: {
				name: "Synthetic",
				isSubscription: true,
				login: async () => {
					throw new Error("Forbidden login");
				},
				refresh,
				toAuth: derive,
			},
		},
	});
	return { runtime, credentials, model: faux.getModel(), faux, refresh, derive };
}

let home: string;
let cwd: string;
let agentDir: string;
const transports: ReturnType<typeof createHostModelTransport>[] = [];
beforeEach(async () => {
	home = await mkdtemp(join(tmpdir(), "claude-transport-test-"));
	cwd = join(home, "project");
	agentDir = join(home, "agent");
	await mkdir(cwd);
	await mkdir(agentDir);
	vi.mocked(resolveSettings).mockResolvedValue({ effective: {}, provenance: {}, sources: [] });
});
afterEach(async () => {
	for (const transport of transports.splice(0)) await transport.close();
	await rm(home, { recursive: true, force: true });
	vi.restoreAllMocks();
});

function transport(runtime: ModelRuntime, query: ClaudeQuery, enabled = true) {
	const result = createHostModelTransport({
		runtime,
		query,
		cwd,
		agentDir,
		claudeCodeEnabled: enabled,
		fallback: (model, context, options) => runtime.streamSimple(model, context, options),
	});
	transports.push(result);
	return result;
}

describe("official SDK transport authority", () => {
	it("exposes unchanged TypeBox schemas but denies every MCP execution", async () => {
		const parameters = Type.Object({ path: Type.String() }, { additionalProperties: false });
		const server = createHostToolServer([{ name: "runtime_write", description: "write", parameters }]);
		const messages = new EventEmitter();
		const connection: Parameters<typeof server.instance.connect>[0] = {
			start: async () => {},
			send: async (message) => {
				messages.emit("response", message);
			},
			close: async () => {},
		};
		await server.instance.connect(connection);
		try {
			const listing = once(messages, "response", { signal: AbortSignal.timeout(3000) });
			connection.onmessage?.({ jsonrpc: "2.0", id: 1, method: "tools/list" });
			expect((await listing)[0]).toMatchObject({
				result: { tools: [{ name: "runtime_write", inputSchema: parameters }] },
			});
			const denied = once(messages, "response", { signal: AbortSignal.timeout(3000) });
			connection.onmessage?.({
				jsonrpc: "2.0",
				id: 2,
				method: "tools/call",
				params: { name: "runtime_write", arguments: { path: "/not-permitted" } },
			});
			expect((await denied)[0]).toMatchObject({ result: { isError: true } });
		} finally {
			await server.instance.close();
		}
	});

	it("normalizes streamed custom calls and closes the child before releasing the Pi result", async () => {
		const { runtime, model, refresh, derive } = await account();
		const sdk = fakeQuery(answer("mcp__weavra__runtime_write", { path: "src/new.ts", content: "new" }));
		const selected = transport(runtime, sdk.query);
		const stream = await selected.stream(model, {
			systemPrompt: "trusted",
			messages: [{ role: "user", content: "request", timestamp: 1 }],
			tools: [
				{
					name: "runtime_write",
					description: "write",
					parameters: Type.Object({ path: Type.String(), content: Type.String() }),
				},
			],
		});
		const events = [];
		for await (const event of stream) events.push(event.type);
		const result = await stream.result();
		expect(result.content).toEqual([
			{ type: "toolCall", id: "call-1", name: "runtime_write", arguments: { path: "src/new.ts", content: "new" } },
		]);
		expect(events).toEqual(["start", "toolcall_start", "toolcall_delta", "toolcall_end", "done"]);
		expect(result.stopReason).toBe("toolUse");
		expect(sdk.close).toHaveBeenCalledTimes(1);
		expect(refresh).not.toHaveBeenCalled();
		expect(derive).not.toHaveBeenCalled();
		expect(await readdir(agentDir)).toEqual([]);
		const call = sdk.query.mock.calls[0]?.[0];
		expect(call?.options).toMatchObject({
			model: model.id,
			tools: [],
			hooks: {},
			settingSources: [],
			skills: [],
			agents: {},
			plugins: [],
			strictMcpConfig: true,
			persistSession: false,
			enableFileCheckpointing: false,
			maxTurns: 1,
			settings: { disableAllHooks: true, autoMemoryEnabled: false, autoCompactEnabled: false },
		});
		expect(call?.options.env).not.toHaveProperty("ANTHROPIC_API_KEY");
		expect(call?.options.env).not.toHaveProperty("CLAUDE_CODE_OAUTH_TOKEN");
	});

	it("rejects SDK built-in calls instead of exposing them as Host tools", async () => {
		const { runtime, model } = await account();
		const sdk = fakeQuery(answer("Write", { file_path: "src/uncontrolled.ts", content: "bad" }));
		const result = await (await transport(runtime, sdk.query).stream(model, { messages: [] })).result();
		expect(result.stopReason).toBe("error");
		expect(result.content).toEqual([]);
		expect(sdk.close).toHaveBeenCalledTimes(1);
	});

	it("rejects opt-in absence before getAuth, SDK startup or raw provider dispatch", async () => {
		const { runtime, model, refresh, derive } = await account();
		const auth = vi.spyOn(runtime, "getAuth");
		const raw = vi.spyOn(runtime, "streamSimple");
		const sdk = fakeQuery();
		await expect(transport(runtime, sdk.query, false).stream(model, { messages: [] })).rejects.toMatchObject({
			code: "CLAUDE_CODE_DISABLED",
		});
		expect(auth).not.toHaveBeenCalled();
		expect(raw).not.toHaveBeenCalled();
		expect(sdk.query).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		expect(derive).not.toHaveBeenCalled();
	});

	it("rejects a credential swap at actual selection with zero OAuth refresh or dispatch", async () => {
		const { runtime, credentials, model, refresh, derive } = await account("api_key");
		const list = runtime.listCredentials.bind(runtime);
		vi.spyOn(runtime, "listCredentials").mockImplementationOnce(async (options) => {
			const metadata = await list(options);
			await credentials.modify("anthropic", async () => ({
				type: "oauth",
				access: "expired",
				refresh: "r",
				expires: 0,
			}));
			return metadata;
		});
		const raw = vi.spyOn(runtime, "streamSimple");
		const sdk = fakeQuery();
		await expect(transport(runtime, sdk.query, false).stream(model, { messages: [] })).rejects.toMatchObject({
			code: "auth",
		});
		expect(raw).not.toHaveBeenCalled();
		expect(sdk.query).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
		expect(derive).not.toHaveBeenCalled();
	});

	it("retains normal API-key streaming with no SDK use", async () => {
		const { runtime, model, faux, refresh } = await account("api_key");
		const keys: Array<string | undefined> = [];
		faux.setResponses([
			(_context, options) => {
				keys.push(options?.apiKey);
				return fauxAssistantMessage("api result");
			},
		]);
		const sdk = fakeQuery();
		const result = await (await transport(runtime, sdk.query, false).stream(model, { messages: [] })).result();
		expect(result.stopReason).toBe("stop");
		expect(keys).toEqual(["synthetic-key"]);
		expect(sdk.query).not.toHaveBeenCalled();
		expect(refresh).not.toHaveBeenCalled();
	});

	it("cleans an aborted SDK request without cancelling an independent session", async () => {
		const { runtime, model } = await account();
		const entered = new EventEmitter();
		const started = once(entered, "started", { signal: AbortSignal.timeout(3000) });
		const close = vi.fn();
		const hanging: ClaudeQuery = ({ options }) => ({
			async *[Symbol.asyncIterator]() {
				const signal = options.abortController?.signal;
				if (!signal) throw new Error("Missing cancellation");
				const aborted = once(signal, "abort", { signal: AbortSignal.timeout(3000) });
				entered.emit("started");
				await aborted;
				yield frame({ type: "message_stop" });
			},
			close,
		});
		const controller = new AbortController();
		const first = transport(runtime, hanging);
		const pending = await first.stream(model, { messages: [] }, { signal: controller.signal });
		await started;
		const secondSdk = fakeQuery();
		const second = transport(runtime, secondSdk.query);
		controller.abort();
		const independent = await (await second.stream(model, { messages: [] })).result();
		expect((await pending.result()).stopReason).toBe("aborted");
		expect(independent.stopReason).toBe("stop");
		expect(close).toHaveBeenCalledTimes(1);
		expect(secondSdk.close).toHaveBeenCalledTimes(1);
	});

	it("closes on an SDK iterator error without releasing any tool call", async () => {
		const { runtime, model } = await account();
		const close = vi.fn();
		const broken: ClaudeQuery = () => ({
			async *[Symbol.asyncIterator]() {
				yield frame({
					type: "content_block_start",
					index: 0,
					content_block: { type: "text", text: "", citations: null },
				});
				throw new Error("synthetic SDK failure");
			},
			close,
		});
		const result = await (await transport(runtime, broken).stream(model, { messages: [] })).result();
		expect(result.stopReason).toBe("error");
		expect(close).toHaveBeenCalledTimes(1);
		expect(await readdir(agentDir)).toEqual([]);
	});

	for (const outcome of ["success", "error", "abort"] as const) {
		it(`joins the actual fake subprocess before releasing a ${outcome} result`, async () => {
			const { runtime, model } = await account();
			const entered = new EventEmitter();
			const started = once(entered, "started", { signal: AbortSignal.timeout(5000) });
			const lifecycle: string[] = [];
			const controller = new AbortController();
			const fake: ClaudeQuery = ({ options }) => {
				const spawn = options.spawnClaudeCodeProcess;
				if (!spawn || !options.abortController) throw new Error("Missing process ownership");
				const child = spawn({
					command: process.execPath,
					args: ["-e", 'process.stdout.write("READY\\n");process.stdin.resume()'],
					cwd: agentDir,
					env: { PATH: process.env.PATH },
					signal: options.abortController.signal,
				});
				child.on("exit", () => lifecycle.push("exit"));
				const ready = once(child.stdout, "data", { signal: AbortSignal.timeout(5000) });
				return {
					async *[Symbol.asyncIterator]() {
						await ready;
						const stopped =
							outcome === "abort"
								? once(controller.signal, "abort", { signal: AbortSignal.timeout(5000) })
								: undefined;
						entered.emit("started");
						if (stopped) await stopped;
						if (outcome === "error") throw new Error("Synthetic SDK failure");
						yield* answer();
					},
					close: () => {
						lifecycle.push("close-request");
						child.stdin.end();
					},
				};
			};
			const stream = await transport(runtime, fake).stream(model, { messages: [] }, { signal: controller.signal });
			await started;
			if (outcome === "abort") controller.abort();
			const result = await stream.result();
			lifecycle.push("result");
			expect(result.stopReason).toBe(outcome === "success" ? "stop" : outcome === "abort" ? "aborted" : "error");
			expect(lifecycle).toEqual(["close-request", "exit", "result"]);
			expect(await readdir(agentDir)).toEqual([]);
		});
	}

	it("does not resolve OAuth auth when the explicit SDK lane is selected", async () => {
		const { runtime, model, refresh, derive } = await account();
		expect(await resolveHostModelAuth({ runtime, model, claudeCodeEnabled: true })).toEqual({
			kind: "official-claude-sdk",
		});
		expect(refresh).not.toHaveBeenCalled();
		expect(derive).not.toHaveBeenCalled();
	});
});
