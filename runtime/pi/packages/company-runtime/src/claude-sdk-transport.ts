import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { isAbsolute, join, relative, sep } from "node:path";
import {
	createSdkMcpServer,
	type Options,
	query,
	resolveSettings,
	type SDKMessage,
	type SDKPartialAssistantMessage,
	type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import {
	type Api,
	type AssistantMessage,
	type AuthResult,
	calculateCost,
	createAssistantMessageEventStream,
	type Model,
	type Tool,
} from "@earendil-works/pi-ai";
import type { AgentSession, ModelRuntime } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { decideProviderTransport } from "./provider-permission.ts";

type Stream = AgentSession["agent"]["streamFunction"];
export type ClaudeQuery = (input: {
	prompt: AsyncIterable<SDKUserMessage>;
	options: Options;
}) => AsyncIterable<SDKMessage> & { close(): void };
type TransportCode = "CREDENTIAL_MISSING" | "CLAUDE_CODE_DISABLED" | "SDK_PROTOCOL" | "SDK_SETTINGS" | "SDK_CLEANUP";

export class ClaudeTransportError extends Error {
	readonly code: TransportCode;
	constructor(code: TransportCode, message: string, cause?: unknown) {
		super(message, { cause });
		this.name = "ClaudeTransportError";
		this.code = code;
	}
}

/** Metadata chooses the lane; only the resolver's actual selection can authorize API-key use. */
export async function resolveHostModelAuth(input: {
	runtime: ModelRuntime;
	model: Model<Api>;
	claudeCodeEnabled: boolean;
	signal?: AbortSignal;
}): Promise<{ kind: "api"; auth: AuthResult } | { kind: "official-claude-sdk" }> {
	const { runtime, model, signal } = input;
	signal?.throwIfAborted();
	if (model.provider === "anthropic") {
		const stored = (await runtime.listCredentials({ signal })).find((entry) => entry.providerId === "anthropic");
		const kind = stored?.type ?? (await runtime.checkAuth("anthropic", { signal }))?.type ?? "missing";
		const decision = decideProviderTransport("anthropic", kind, input.claudeCodeEnabled);
		switch (decision.kind) {
			case "blocked":
				throw new ClaudeTransportError(decision.code, decision.message);
			case "official-claude-sdk":
				return { kind: "official-claude-sdk" };
			case "api":
				break;
		}
	} else if (!(await runtime.checkAuth(model.provider, { signal }))) {
		throw new ClaudeTransportError("CREDENTIAL_MISSING", "모델 인증을 확인할 수 없어요.");
	}
	const auth = await runtime.getAuth(model, {
		signal,
		...(model.provider === "anthropic" ? { requiredAuthType: "api_key" as const } : {}),
	});
	if (!auth || (model.provider === "anthropic" && !auth.auth.apiKey))
		throw new ClaudeTransportError("CREDENTIAL_MISSING", "모델 API 키 인증을 확인할 수 없어요.");
	return { kind: "api", auth };
}

const SERVER = "weavra";
const PREFIX = `mcp__${SERVER}__`;
const DENIED = "이 도구는 Host에서만 실행해요. 다음 Host 결과를 기다려 주세요.";
const ArgumentsSchema = Type.Record(Type.String(), Type.Unknown());

/** Public MCP protocol handlers preserve TypeBox JSON Schema without a second schema implementation. */
export function createHostToolServer(tools: readonly Tool[]) {
	const server = createSdkMcpServer({ name: SERVER, version: "1.0.0" });
	server.instance.server.registerCapabilities({ tools: {} });
	server.instance.server.fallbackRequestHandler = async (request) => {
		switch (request.method) {
			case "tools/list":
				return {
					tools: tools.map((tool) => ({
						name: tool.name,
						description: tool.description,
						inputSchema: tool.parameters,
						_meta: { "anthropic/alwaysLoad": true },
					})),
				};
			case "tools/call":
				return { isError: true, content: [{ type: "text", text: DENIED }] };
			default:
				throw new ClaudeTransportError("SDK_PROTOCOL", "허용하지 않은 MCP 요청이에요.");
		}
	};
	return server;
}

/** One session's transport and cleanup ownership; never registers or changes a shared provider/runtime. */
export function createHostModelTransport(input: {
	runtime: ModelRuntime;
	claudeCodeEnabled: boolean;
	cwd: string;
	agentDir: string;
	fallback: Stream;
	query?: ClaudeQuery;
}) {
	const active = new Map<AbortController, Promise<void>>();
	let cleanupFailure: ClaudeTransportError | undefined;
	const stream: Stream = async (model, context, options) => {
		if (cleanupFailure) throw cleanupFailure;
		if (model.provider !== "anthropic") return input.fallback(model, context, options);
		const selection = await resolveHostModelAuth({
			runtime: input.runtime,
			model,
			claudeCodeEnabled: input.claudeCodeEnabled,
			signal: options?.signal,
		});
		if (selection.kind === "api") {
			// An explicit API key pins the already restricted resolution through Pi's normal request path.
			return input.fallback(
				selection.auth.auth.baseUrl ? { ...model, baseUrl: selection.auth.auth.baseUrl } : model,
				context,
				{
					...options,
					apiKey: selection.auth.auth.apiKey,
					headers: { ...selection.auth.auth.headers, ...options?.headers },
					env: { ...selection.auth.env, ...options?.env },
				},
			);
		}
		const events = createAssistantMessageEventStream();
		const controller = new AbortController();
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			timestamp: Date.now(),
			stopReason: "pending",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
		};
		const task = (async () => {
			let sdk: ReturnType<ClaudeQuery> | undefined;
			const children = new Map<ChildProcess, Promise<void>>();
			let closed = false;
			let directory: string | undefined;
			let server: ReturnType<typeof createHostToolServer> | undefined;
			let failure: unknown;
			let failed = false;
			let complete = false;
			const closeQuery = () => {
				try {
					if (sdk && !closed) {
						closed = true;
						sdk.close();
					}
				} catch (cause) {
					cleanupFailure = new ClaudeTransportError(
						"SDK_CLEANUP",
						"Claude 프로세스 종료를 확인하지 못했어요.",
						cause,
					);
				}
				// If construction/close failed, there is no SDK shutdown path to own these exact children.
				if (!sdk || cleanupFailure) {
					for (const child of children.keys()) {
						if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
					}
				}
			};
			const abort = () => {
				controller.abort(options?.signal?.reason);
				closeQuery();
			};
			options?.signal?.addEventListener("abort", abort, { once: true });
			controller.signal.addEventListener("abort", closeQuery, { once: true });
			try {
				options?.signal?.throwIfAborted();
				const [cwd, agentDir] = await Promise.all([realpath(input.cwd), realpath(input.agentDir)]);
				const rel = relative(cwd, agentDir);
				if (rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)))
					throw new ClaudeTransportError("SDK_SETTINGS", "Claude 실행 디렉터리는 프로젝트 밖이어야 해요.");
				directory = await mkdtemp(join(agentDir, "claude-transport-"));
				// Managed startup executors cannot be disabled by user-level flags. Refuse before spawning.
				const settings = await resolveSettings({ cwd: directory, settingSources: [] });
				if (settings.sources.some((source) => source.source === "managed" && Object.keys(source.settings).length))
					throw new ClaudeTransportError(
						"SDK_SETTINGS",
						"관리형 Claude 설정이 있는 환경에서는 Host 격리를 보장할 수 없어요.",
					);
				const tools = context.tools ?? [];
				server = createHostToolServer(tools);
				const env: Record<string, string> = {};
				for (const key of [
					"PATH",
					"HOME",
					"USER",
					"LOGNAME",
					"LANG",
					"LC_ALL",
					"TMPDIR",
					"TEMP",
					"TMP",
					"SystemRoot",
				]) {
					const value = process.env[key];
					if (value !== undefined) env[key] = value;
				}
				controller.signal.throwIfAborted();
				const first = context.messages[0];
				const prompt =
					context.messages.length === 1 && first?.role === "user"
						? typeof first.content === "string"
							? first.content
							: first.content
									.map((part) => {
										if (part.type !== "text")
											throw new ClaudeTransportError(
												"SDK_PROTOCOL",
												"Runtime Claude 입력은 텍스트여야 해요.",
											);
										return part.text;
									})
									.join("\n")
						: JSON.stringify({ history: context.messages });
				sdk = (input.query ?? query)({
					prompt: (async function* (): AsyncGenerator<SDKUserMessage> {
						yield {
							type: "user",
							message: { role: "user", content: prompt },
							parent_tool_use_id: null,
							session_id: "prompt",
						};
					})(),
					options: {
						model: model.id,
						cwd: directory,
						env,
						abortController: controller,
						spawnClaudeCodeProcess: (spawnOptions) => {
							controller.signal.throwIfAborted();
							const child = spawn(spawnOptions.command, spawnOptions.args, {
								cwd: spawnOptions.cwd,
								env: spawnOptions.env,
								signal: spawnOptions.signal,
								stdio: ["pipe", "pipe", "pipe"],
								windowsHide: true,
							});
							child.stderr.resume();
							child.once("error", (cause) => {
								failed = true;
								failure = cause;
							});
							// SDK close() schedules graceful termination; only close confirms exit AND closed stdio.
							children.set(child, new Promise<void>((resolve) => child.once("close", () => resolve())));
							return child;
						},
						systemPrompt: context.systemPrompt,
						tools: [],
						allowedTools: [],
						canUseTool: async () => ({ behavior: "deny", message: DENIED }),
						permissionMode: "dontAsk",
						hooks: {},
						settings: { disableAllHooks: true, autoMemoryEnabled: false, autoCompactEnabled: false },
						settingSources: [],
						skills: [],
						agents: {},
						plugins: [],
						strictMcpConfig: true,
						mcpServers: { [SERVER]: server },
						persistSession: false,
						enableFileCheckpointing: false,
						includePartialMessages: true,
						maxTurns: 1,
					},
				});
				events.push({ type: "start", partial: output });
				const indexes = new Map<number, number>();
				const json = new Map<number, string>();
				const ids = new Set<string>();
				for await (const message of sdk) {
					controller.signal.throwIfAborted();
					if (message.type === "assistant" && message.error)
						throw new ClaudeTransportError("SDK_PROTOCOL", "Claude 응답이 실패했어요.");
					if (message.type !== "stream_event") {
						if (message.type === "result")
							throw new ClaudeTransportError("SDK_PROTOCOL", "Claude 스트림이 완결되지 않았어요.");
						continue;
					}
					if (message.parent_tool_use_id !== null)
						throw new ClaudeTransportError("SDK_PROTOCOL", "하위 에이전트 호출은 허용하지 않아요.");
					const event: SDKPartialAssistantMessage["event"] = message.event;
					switch (event.type) {
						case "message_start":
							output.responseId = event.message.id;
							output.responseModel = event.message.model;
							output.usage.input = event.message.usage.input_tokens;
							output.usage.cacheRead = event.message.usage.cache_read_input_tokens ?? 0;
							output.usage.cacheWrite = event.message.usage.cache_creation_input_tokens ?? 0;
							break;
						case "content_block_start": {
							const block = event.content_block;
							const index = output.content.length;
							indexes.set(event.index, index);
							switch (block.type) {
								case "text":
									output.content.push({ type: "text", text: "" });
									events.push({ type: "text_start", contentIndex: index, partial: output });
									if (block.text) {
										output.content[index] = { type: "text", text: block.text };
										events.push({
											type: "text_delta",
											contentIndex: index,
											delta: block.text,
											partial: output,
										});
									}
									break;
								case "thinking":
									output.content.push({ type: "thinking", thinking: "" });
									events.push({ type: "thinking_start", contentIndex: index, partial: output });
									if (block.thinking) {
										output.content[index] = { type: "thinking", thinking: block.thinking };
										events.push({
											type: "thinking_delta",
											contentIndex: index,
											delta: block.thinking,
											partial: output,
										});
									}
									break;
								case "redacted_thinking":
									output.content.push({
										type: "thinking",
										thinking: "",
										redacted: true,
										thinkingSignature: block.data,
									});
									events.push({ type: "thinking_start", contentIndex: index, partial: output });
									break;
								case "tool_use": {
									const tool = tools.find((candidate) => `${PREFIX}${candidate.name}` === block.name);
									if (!tool || ids.has(block.id) || !Check(ArgumentsSchema, block.input))
										throw new ClaudeTransportError("SDK_PROTOCOL", "허용되지 않거나 중복된 도구 호출이에요.");
									ids.add(block.id);
									output.content.push({
										type: "toolCall",
										id: block.id,
										name: tool.name,
										arguments: block.input,
									});
									json.set(event.index, "");
									events.push({ type: "toolcall_start", contentIndex: index, partial: output });
									break;
								}
								default:
									throw new ClaudeTransportError("SDK_PROTOCOL", "지원하지 않는 Claude 응답 블록이에요.");
							}
							break;
						}
						case "content_block_delta": {
							const index = indexes.get(event.index);
							const block = index === undefined ? undefined : output.content[index];
							if (index === undefined || !block)
								throw new ClaudeTransportError("SDK_PROTOCOL", "Claude 블록 순서가 잘못됐어요.");
							const delta = event.delta;
							if (delta.type === "text_delta" && block.type === "text") {
								block.text += delta.text;
								events.push({ type: "text_delta", contentIndex: index, delta: delta.text, partial: output });
							} else if (delta.type === "thinking_delta" && block.type === "thinking") {
								block.thinking += delta.thinking;
								events.push({
									type: "thinking_delta",
									contentIndex: index,
									delta: delta.thinking,
									partial: output,
								});
							} else if (delta.type === "input_json_delta" && block.type === "toolCall") {
								json.set(event.index, (json.get(event.index) ?? "") + delta.partial_json);
								events.push({
									type: "toolcall_delta",
									contentIndex: index,
									delta: delta.partial_json,
									partial: output,
								});
							} else if (delta.type === "signature_delta" && block.type === "thinking") {
								block.thinkingSignature = (block.thinkingSignature ?? "") + delta.signature;
							} else {
								throw new ClaudeTransportError("SDK_PROTOCOL", "Claude 블록 내용이 맞지 않아요.");
							}
							break;
						}
						case "content_block_stop": {
							const index = indexes.get(event.index);
							const block = index === undefined ? undefined : output.content[index];
							if (index === undefined || !block)
								throw new ClaudeTransportError("SDK_PROTOCOL", "Claude 블록 종료가 잘못됐어요.");
							switch (block.type) {
								case "text":
									events.push({ type: "text_end", contentIndex: index, content: block.text, partial: output });
									break;
								case "thinking":
									events.push({
										type: "thinking_end",
										contentIndex: index,
										content: block.thinking,
										partial: output,
									});
									break;
								case "toolCall": {
									const encoded = json.get(event.index);
									const args: unknown = encoded ? JSON.parse(encoded) : block.arguments;
									if (!Check(ArgumentsSchema, args))
										throw new ClaudeTransportError("SDK_PROTOCOL", "도구 인자는 JSON 객체여야 해요.");
									block.arguments = args;
									events.push({ type: "toolcall_end", contentIndex: index, toolCall: block, partial: output });
									break;
								}
							}
							indexes.delete(event.index);
							break;
						}
						case "message_delta":
							output.usage.output = event.usage.output_tokens;
							output.usage.input = event.usage.input_tokens ?? output.usage.input;
							output.usage.cacheRead = event.usage.cache_read_input_tokens ?? output.usage.cacheRead;
							output.usage.cacheWrite = event.usage.cache_creation_input_tokens ?? output.usage.cacheWrite;
							output.stopReason =
								event.delta.stop_reason === "tool_use"
									? "toolUse"
									: event.delta.stop_reason === "max_tokens"
										? "length"
										: event.delta.stop_reason === "end_turn" || event.delta.stop_reason === "stop_sequence"
											? "stop"
											: "error";
							break;
						case "message_stop":
							complete = true;
							break;
					}
					if (complete) {
						closeQuery();
						break;
					}
				}
				if (
					!complete ||
					indexes.size ||
					output.stopReason === "pending" ||
					output.stopReason === "error" ||
					(ids.size > 0 && output.stopReason !== "toolUse")
				)
					throw new ClaudeTransportError("SDK_PROTOCOL", "Claude 응답이 정상적으로 종료되지 않았어요.");
			} catch (cause) {
				failed = true;
				failure = cause;
			} finally {
				closeQuery();
				try {
					await Promise.all(children.values());
					await server?.instance.close();
					if (directory) await rm(directory, { recursive: true, force: true });
				} catch (cause) {
					cleanupFailure = new ClaudeTransportError("SDK_CLEANUP", "Claude 실행 자원을 정리하지 못했어요.", cause);
				}
				options?.signal?.removeEventListener("abort", abort);
				controller.signal.removeEventListener("abort", closeQuery);
			}
			output.usage.totalTokens =
				output.usage.input + output.usage.output + output.usage.cacheRead + output.usage.cacheWrite;
			calculateCost(model, output.usage);
			if (failed || cleanupFailure || controller.signal.aborted) {
				output.stopReason = controller.signal.aborted ? "aborted" : "error";
				output.errorMessage =
					cleanupFailure?.message ??
					(failure instanceof ClaudeTransportError ? failure.message : "Claude 요청이 중단되거나 실패했어요.");
				events.push({ type: "error", reason: output.stopReason, error: output });
			} else {
				const reason =
					output.stopReason === "toolUse" ? "toolUse" : output.stopReason === "length" ? "length" : "stop";
				events.push({ type: "done", reason, message: output });
			}
			events.end();
		})();
		active.set(controller, task);
		void task.then(() => active.delete(controller));
		return events;
	};
	return {
		stream,
		async close(): Promise<void> {
			for (const controller of active.keys()) controller.abort();
			await Promise.all(active.values());
			if (cleanupFailure) throw cleanupFailure;
		},
	};
}
