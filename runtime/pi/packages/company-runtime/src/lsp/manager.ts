import { stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PolicyContext } from "../policy.ts";
import { FilePolicyPathInspector } from "../policy-paths.ts";
import { ProcessCleanupError, resolveExecutable, verificationEnvironment } from "../process-runner.ts";
import { LspClient, type LspQuery } from "./client.ts";
import { safeServerCommand } from "./config.ts";
import { LspFiles, lspPosition } from "./files.ts";
import { normalizeLsp } from "./normalize.ts";
import { LspConnectionError } from "./protocol.ts";
import type {
	LspConfig,
	LspDiagnosticsResult,
	LspFileRequest,
	LspLocationsResult,
	LspPort,
	LspPositionRequest,
	LspServerStatus,
	LspSymbolsResult,
} from "./types.ts";

async function resolveServer(executable: string, args: readonly string[]): Promise<string> {
	if (!safeServerCommand(executable, args)) throw new LspConnectionError("UNAVAILABLE");
	const resolved = await resolveExecutable(executable, verificationEnvironment().PATH);
	if (!(await stat(resolved)).isFile()) throw new LspConnectionError("UNAVAILABLE");
	return resolved;
}
export async function inspectLspServers(config?: LspConfig): Promise<LspServerStatus[]> {
	if (!config?.enabled) return [];
	return Promise.all(
		config.servers.map(async (server): Promise<LspServerStatus> => {
			let available = true;
			try {
				await resolveServer(server.executable, server.args);
			} catch {
				available = false;
			}
			return {
				id: server.id,
				extensions: [...server.extensions],
				status: available ? "READY" : "UNAVAILABLE",
				process: "stopped",
			};
		}),
	);
}

/** Lazy, run-scoped reuse. Runtime is sequential; concurrent queries fail rather than growing a queue. */
export class LspManager implements LspPort {
	private readonly cwd: string;
	private readonly config: LspConfig;
	private readonly files: LspFiles;
	private readonly resolved = new Map<string, string>();
	private readonly clients = new Map<string, LspClient>();
	private readonly owned = new Set<LspClient>();
	private readonly stopped = new AbortController();
	private inFlight?: Promise<LspDiagnosticsResult & LspLocationsResult & LspSymbolsResult>;
	private closing?: Promise<void>;
	private cleanupFault = false;
	get cleanupFailed(): boolean {
		return this.cleanupFault;
	}
	get safeToRelease(): boolean {
		return !this.inFlight && [...this.owned].every((client) => client.safeToRelease);
	}
	get status(): LspServerStatus[] {
		return this.config.servers.map((server) => ({
			id: server.id,
			extensions: [...server.extensions],
			status: this.resolved.has(server.id) ? "READY" : "UNAVAILABLE",
			process: this.clients.get(server.id)?.alive ? "running" : "stopped",
		}));
	}
	private constructor(cwd: string, config: LspConfig, files: LspFiles) {
		this.cwd = cwd;
		this.config = structuredClone(config);
		this.files = files;
	}
	static async create(cwd: string, config: LspConfig, policy: PolicyContext): Promise<LspManager> {
		const paths = await FilePolicyPathInspector.open(cwd);
		const manager = new LspManager(paths.projectPath, config, new LspFiles(paths.projectPath, policy, paths));
		if (config.enabled)
			for (const server of config.servers) {
				try {
					manager.resolved.set(server.id, await resolveServer(server.executable, server.args));
				} catch {
					/* Report UNAVAILABLE without spawn/install. */
				}
			}
		return manager;
	}
	diagnostics(request: LspFileRequest): Promise<LspDiagnosticsResult> {
		return this.run("diagnostics", request);
	}
	definition(request: LspPositionRequest): Promise<LspLocationsResult> {
		return this.run("definition", request);
	}
	references(request: LspPositionRequest): Promise<LspLocationsResult> {
		return this.run("references", request);
	}
	symbols(request: LspFileRequest): Promise<LspSymbolsResult> {
		return this.run("symbols", request);
	}
	private async run(kind: LspQuery, request: LspFileRequest | LspPositionRequest) {
		if (this.cleanupFault) throw new ProcessCleanupError();
		if (this.stopped.signal.aborted) throw new Error("LSP manager closed");
		if (this.inFlight) throw new Error("LSP query already active");
		const operation = this.query(kind, { ...request });
		this.inFlight = operation;
		try {
			return await operation;
		} finally {
			this.inFlight = undefined;
		}
	}
	private async query(
		kind: LspQuery,
		request: LspFileRequest | LspPositionRequest,
	): Promise<LspDiagnosticsResult & LspLocationsResult & LspSymbolsResult> {
		request.signal?.throwIfAborted();
		const startedAt = Date.now();
		const before = await this.files.read(request.path); // Policy/path denial happens before server selection/spawn.
		request.signal?.throwIfAborted();
		this.stopped.signal.throwIfAborted();
		const position = "line" in request ? lspPosition(before.text, request.line, request.column) : undefined;
		const server = this.config.enabled
			? this.config.servers.find((item) => item.extensions.includes(extname(request.path).toLowerCase()))
			: undefined;
		const base: LspDiagnosticsResult & LspLocationsResult & LspSymbolsResult = {
			serverId: server?.id ?? "unconfigured",
			status: "UNAVAILABLE",
			reason: "LSP disabled, unrouted or executable unavailable",
			fileDigest: before.digest,
			startedAt,
			finishedAt: startedAt,
			withheld: 0,
			truncated: 0,
			diagnostics: [],
			locations: [],
			symbols: [],
		};
		if (!server || !this.resolved.has(server.id)) return { ...base, finishedAt: Date.now() };
		const timeout = AbortSignal.timeout(server.timeout_ms);
		const signal = AbortSignal.any([timeout, this.stopped.signal, ...(request.signal ? [request.signal] : [])]);
		for (let attempt = 0; attempt < 2; attempt++) {
			let client = this.clients.get(server.id);
			try {
				if (signal.aborted) throw new LspConnectionError(timeout.aborted ? "TIMEOUT" : "CANCELLED");
				if (attempt && (await this.files.read(request.path)).digest !== before.digest)
					return {
						...base,
						status: "STALE",
						reason: "File changed before crash retry; re-query",
						finishedAt: Date.now(),
					};
				if (!client) {
					client = new LspClient(this.cwd, this.resolved.get(server.id)!, server.args);
					this.clients.set(server.id, client);
					this.owned.add(client);
					await client.initialize(this.cwd, server.timeout_ms, signal);
				}
				const extension = extname(request.path).toLowerCase();
				const languageId =
					(
						{
							".ts": "typescript",
							".tsx": "typescriptreact",
							".js": "javascript",
							".jsx": "javascriptreact",
							".py": "python",
							".rs": "rust",
							".go": "go",
						} as Record<string, string>
					)[extension] ?? extension.slice(1);
				const response = await client.query(
					kind,
					pathToFileURL(join(this.cwd, request.path)).href,
					before.text,
					languageId,
					server.timeout_ms,
					signal,
					position,
				);
				const normalized = await normalizeLsp(kind, response.value, request.path, this.files);
				let fresh = false;
				try {
					fresh = (await this.files.read(request.path)).digest === before.digest;
				} catch {
					/* Deleted/replaced/unsafe files are stale. */
				}
				if (signal.aborted) throw new LspConnectionError(timeout.aborted ? "TIMEOUT" : "CANCELLED");
				if (!fresh)
					return {
						...base,
						status: "STALE",
						reason: "File changed during LSP query; re-query",
						finishedAt: Date.now(),
					};
				const partial = response.partial || normalized.withheld > 0 || normalized.truncated > 0;
				return {
					...base,
					...normalized,
					status: partial ? "PARTIAL" : "AVAILABLE",
					reason: response.partial
						? "Push snapshot; completeness unconfirmed (not PASS/FAIL)"
						: partial
							? "Results withheld by policy or truncated (not PASS/FAIL)"
							: "Query answered; not a code-quality PASS/FAIL",
					finishedAt: Date.now(),
				};
			} catch (error) {
				if (client) {
					try {
						await client.close();
					} catch {
						this.cleanupFault = true;
						throw new ProcessCleanupError();
					}
					this.clients.delete(server.id);
					this.owned.delete(client); // Confirmed retired processes need no lifetime retention.
				}
				if (request.signal?.aborted) request.signal.throwIfAborted();
				if (this.stopped.signal.aborted) throw new LspConnectionError("CANCELLED");
				if (error instanceof ProcessCleanupError) throw error;
				if (
					!timeout.aborted &&
					attempt === 0 &&
					error instanceof LspConnectionError &&
					["CLOSED", "EXITED"].includes(error.code)
				)
					continue;
				return {
					...base,
					status: error instanceof LspConnectionError && error.code === "UNAVAILABLE" ? "UNAVAILABLE" : "ERROR",
					reason: timeout.aborted
						? "LSP TIMEOUT"
						: error instanceof LspConnectionError
							? error.message
							: "LSP query failed",
					finishedAt: Date.now(),
				};
			}
		}
		throw new Error("Unreachable LSP retry state");
	}
	close(): Promise<void> {
		this.closing ??= this.dispose();
		return this.closing;
	}
	private async dispose(): Promise<void> {
		this.stopped.abort();
		try {
			await this.inFlight;
		} catch {
			/* The query owns its error; cleanup is checked below. */
		}
		await Promise.allSettled([...this.owned].map((client) => client.close()));
		if (!this.safeToRelease) {
			this.cleanupFault = true;
			throw new ProcessCleanupError();
		}
	}
}
