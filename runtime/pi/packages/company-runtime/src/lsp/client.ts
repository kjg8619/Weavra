import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { ProcessCleanupError, verificationEnvironment } from "../process-runner.ts";
import { encodeMessage, LspConnectionError, LspFramer, MAX_BUFFER_BYTES, MAX_PENDING, object } from "./protocol.ts";

interface Pending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	cleanup: () => void;
}
export type LspQuery = "diagnostics" | "definition" | "references" | "symbols";
const METHODS = {
	definition: "textDocument/definition",
	references: "textDocument/references",
	symbols: "textDocument/documentSymbol",
} as const;
const REQUESTS = new Set(["initialize", "shutdown", "textDocument/diagnostic", ...Object.values(METHODS)]);

/** One run-owned stdio connection. No filesystem edit API, shell, global listeners or detached daemon. */
export class LspClient {
	private readonly child: ChildProcessWithoutNullStreams;
	private readonly pending = new Map<number, Pending>();
	private readonly framer = new LspFramer();
	private readonly closed: Promise<void>;
	private didClose = false;
	private failure?: LspConnectionError;
	private closePromise?: Promise<void>;
	private nextId = 0;
	private version = 0;
	private serverRequests = 0;
	private stderr = Buffer.alloc(0);
	private capabilities: Record<string, unknown> = {};
	private current?: { uri: string; version: number };
	private diagnostic?: { items: unknown[]; receivedAt: number };
	private cleanupConfirmed = false;
	get safeToRelease(): boolean {
		return this.cleanupConfirmed;
	}
	get alive(): boolean {
		return !this.failure && !this.didClose && !this.closePromise;
	}
	get pid(): number | undefined {
		return this.child.pid;
	}

	constructor(privateRoot: string, executable: string, args: readonly string[]) {
		if (process.platform === "win32") throw new LspConnectionError("UNAVAILABLE");
		this.child = spawn(executable, [...args], {
			cwd: privateRoot,
			env: verificationEnvironment(),
			shell: false,
			detached: true,
			stdio: ["pipe", "pipe", "pipe"],
		});
		this.closed = new Promise((resolve) =>
			this.child.once("close", () => {
				this.didClose = true;
				this.fail(new LspConnectionError("CLOSED"));
				resolve();
			}),
		);
		this.child.on("error", () => this.fail(new LspConnectionError("UNAVAILABLE")));
		this.child.on("exit", () => {
			this.fail(new LspConnectionError("EXITED"));
			// Also stop descendants which inherited pipes after the server exited.
			this.kill("SIGKILL");
		});
		this.child.stdin.on("error", () => this.fail(new LspConnectionError("CLOSED")));
		this.child.stdout.on("error", () => this.fail(new LspConnectionError("CLOSED")));
		this.child.stdout.on("end", () => this.fail(new LspConnectionError("CLOSED")));
		this.child.stderr.on("error", () => this.fail(new LspConnectionError("CLOSED")));
		this.child.stderr.on("data", (chunk: Buffer) => {
			this.stderr = Buffer.concat([this.stderr, chunk.subarray(0, Math.max(0, 16384 - this.stderr.length))]);
		});
		this.child.stdout.on("data", (chunk: Buffer) => {
			if (this.failure) return;
			try {
				for (const message of this.framer.push(chunk)) this.receive(message, privateRoot);
			} catch (error) {
				this.fail(error instanceof LspConnectionError ? error : new LspConnectionError("PROTOCOL"));
				this.kill("SIGTERM");
			}
		});
	}
	private fail(error: LspConnectionError): void {
		this.failure ??= error;
		for (const pending of this.pending.values()) {
			pending.cleanup();
			pending.reject(this.failure);
		}
		this.pending.clear();
	}
	private send(message: object): void {
		if (this.failure) throw this.failure;
		const bytes = encodeMessage(message);
		if (this.child.stdin.writableLength + bytes.length > MAX_BUFFER_BYTES) throw new LspConnectionError("LIMIT");
		this.child.stdin.write(bytes);
	}
	private receive(message: Record<string, unknown>, root: string): void {
		if ("method" in message && typeof message.method !== "string") throw new LspConnectionError("PROTOCOL");
		if (typeof message.method === "string") {
			if ("result" in message || "error" in message) throw new LspConnectionError("PROTOCOL");
			if ("id" in message) {
				if (!(typeof message.id === "string" || Number.isSafeInteger(message.id)) || ++this.serverRequests > 256)
					throw new LspConnectionError("PROTOCOL");
				let result: unknown;
				if (message.method === "workspace/applyEdit")
					result = { applied: false, failureReason: "Weavra LSP is read-only" };
				else if (message.method === "workspace/configuration") {
					const items = object(message.params).items;
					if (!Array.isArray(items) || items.length > 64) throw new LspConnectionError("PROTOCOL");
					result = items.map(() => null);
				} else if (message.method === "workspace/workspaceFolders")
					result = [{ uri: pathToFileURL(root).href, name: "workspace" }];
				else if (message.method === "window/workDoneProgress/create") result = null;
				else {
					this.send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not supported" } });
					return;
				}
				this.send({ jsonrpc: "2.0", id: message.id, result });
			} else if (message.method === "textDocument/publishDiagnostics") {
				const params = object(message.params);
				if (typeof params.uri !== "string" || !Array.isArray(params.diagnostics))
					throw new LspConnectionError("PROTOCOL");
				if (
					this.current?.uri === params.uri &&
					(params.version === undefined || params.version === this.current.version)
				)
					this.diagnostic = { items: params.diagnostics, receivedAt: Date.now() };
			}
			return;
		}
		if (!Number.isSafeInteger(message.id) || "result" in message === "error" in message)
			throw new LspConnectionError("PROTOCOL");
		const id = message.id as number;
		const pending = this.pending.get(id);
		if (!pending) throw new LspConnectionError("PROTOCOL");
		if ("error" in message) {
			const error = object(message.error);
			if (!Number.isInteger(error.code) || typeof error.message !== "string")
				throw new LspConnectionError("PROTOCOL");
		}
		this.pending.delete(id);
		pending.cleanup();
		if ("error" in message) pending.reject(new LspConnectionError("RPC"));
		else pending.resolve(message.result);
	}
	request(method: string, params: unknown, timeoutMs: number, signal?: AbortSignal): Promise<unknown> {
		if (!REQUESTS.has(method)) return Promise.reject(new LspConnectionError("UNAVAILABLE"));
		if (this.failure) return Promise.reject(this.failure);
		if (signal?.aborted)
			return Promise.reject(
				new LspConnectionError(signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED"),
			);
		if (this.pending.size >= MAX_PENDING) return Promise.reject(new LspConnectionError("LIMIT"));
		const id = ++this.nextId;
		return new Promise((resolve, reject) => {
			const abort = () =>
				this.fail(new LspConnectionError(signal?.reason?.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED"));
			const timer = setTimeout(() => this.fail(new LspConnectionError("TIMEOUT")), timeoutMs);
			this.pending.set(id, {
				resolve,
				reject,
				cleanup: () => {
					clearTimeout(timer);
					signal?.removeEventListener("abort", abort);
				},
			});
			signal?.addEventListener("abort", abort, { once: true });
			try {
				this.send({ jsonrpc: "2.0", id, method, params });
			} catch (error) {
				this.fail(error instanceof LspConnectionError ? error : new LspConnectionError("CLOSED"));
			}
		});
	}
	async initialize(root: string, timeoutMs: number, signal: AbortSignal): Promise<void> {
		const result = object(
			await this.request(
				"initialize",
				{
					processId: process.pid,
					// TypeScript servers honor this opt-out; no client-side install or typing acquisition path exists.
					initializationOptions: { disableAutomaticTypingAcquisition: true },
					rootUri: pathToFileURL(root).href,
					workspaceFolders: [{ uri: pathToFileURL(root).href, name: "workspace" }],
					capabilities: {
						general: { positionEncodings: ["utf-16"] },
						workspace: { applyEdit: false, configuration: true, workspaceFolders: true },
						textDocument: {
							synchronization: { dynamicRegistration: false },
							definition: { linkSupport: true },
							references: {},
							documentSymbol: { hierarchicalDocumentSymbolSupport: true },
							diagnostic: {},
							publishDiagnostics: { versionSupport: true },
						},
					},
				},
				timeoutMs,
				signal,
			),
		);
		this.capabilities = object(result.capabilities);
		if (this.capabilities.positionEncoding !== undefined && this.capabilities.positionEncoding !== "utf-16")
			throw new LspConnectionError("UNAVAILABLE");
		this.send({ jsonrpc: "2.0", method: "initialized", params: {} });
	}
	async query(
		kind: LspQuery,
		uri: string,
		text: string,
		languageId: string,
		timeoutMs: number,
		signal: AbortSignal,
		position?: { line: number; character: number },
	): Promise<{ value: unknown; partial: boolean }> {
		this.current = { uri, version: ++this.version };
		this.diagnostic = undefined;
		this.send({
			jsonrpc: "2.0",
			method: "textDocument/didOpen",
			params: { textDocument: { ...this.current, languageId, text } },
		});
		try {
			if (kind === "diagnostics") {
				if (this.capabilities.diagnosticProvider) {
					const report = object(
						await this.request("textDocument/diagnostic", { textDocument: { uri } }, timeoutMs, signal),
					);
					if (report.kind !== "full" || !Array.isArray(report.items)) throw new LspConnectionError("PROTOCOL");
					return { value: report.items, partial: false };
				}
				// Push has no completion acknowledgement. Never call a quiet/empty store AVAILABLE or PASS.
				const deadline = Date.now() + timeoutMs;
				while (Date.now() < deadline) {
					if (signal.aborted)
						throw new LspConnectionError(signal.reason?.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED");
					if (this.failure) throw this.failure;
					// Notifications update this field while the request yields; undo TS's initial undefined narrowing.
					const diagnostic = this.diagnostic as { items: unknown[]; receivedAt: number } | undefined;
					if (diagnostic && Date.now() - diagnostic.receivedAt >= 200)
						return { value: diagnostic.items, partial: true };
					await delay(20);
				}
				throw new LspConnectionError("TIMEOUT");
			}
			const capability = {
				definition: "definitionProvider",
				references: "referencesProvider",
				symbols: "documentSymbolProvider",
			}[kind];
			if (!this.capabilities[capability]) throw new LspConnectionError("UNAVAILABLE");
			return {
				value: await this.request(
					METHODS[kind],
					{
						textDocument: { uri },
						...(position ? { position } : {}),
						...(kind === "references" ? { context: { includeDeclaration: true } } : {}),
					},
					timeoutMs,
					signal,
				),
				partial: false,
			};
		} finally {
			this.current = undefined;
			this.diagnostic = undefined;
			if (!this.failure)
				this.send({ jsonrpc: "2.0", method: "textDocument/didClose", params: { textDocument: { uri } } });
		}
	}
	private kill(signal: NodeJS.Signals): boolean {
		if (!this.child.pid) return true;
		try {
			process.kill(-this.child.pid, signal);
			return true;
		} catch (error) {
			return (error as NodeJS.ErrnoException).code === "ESRCH";
		}
	}
	close(): Promise<void> {
		this.closePromise ??= this.dispose();
		return this.closePromise;
	}
	private async dispose(): Promise<void> {
		if (!this.failure) {
			try {
				await this.request("shutdown", null, 250);
				this.send({ jsonrpc: "2.0", method: "exit" });
			} catch {
				/* Escalate below. */
			}
		}
		await Promise.race([this.closed, delay(100)]);
		if (!this.didClose) {
			this.kill("SIGTERM");
			await Promise.race([this.closed, delay(200)]);
		}
		let killed = this.kill("SIGKILL");
		for (let attempt = 0; attempt < 80; attempt++) {
			let gone = !this.child.pid;
			if (this.child.pid) {
				try {
					process.kill(-this.child.pid, 0);
				} catch (error) {
					gone = (error as NodeJS.ErrnoException).code === "ESRCH";
				}
			}
			if (this.didClose && gone && killed) {
				this.cleanupConfirmed = true;
				break;
			}
			killed = this.kill("SIGKILL");
			await delay(25);
		}
		this.fail(new LspConnectionError("CLOSED"));
		if (!this.cleanupConfirmed) throw new ProcessCleanupError();
	}
}
