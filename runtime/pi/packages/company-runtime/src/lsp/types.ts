import { type Static, Type } from "typebox";

const strict = { additionalProperties: false } as const;
const position = Type.Integer({ minimum: 1, maximum: 1_000_000 });
export const LspStatusSchema = Type.Enum(["AVAILABLE", "UNAVAILABLE", "PARTIAL", "STALE", "ERROR"]);
export type LspStatus = Static<typeof LspStatusSchema>;
export const LspDiagnosticSchema = Type.Object(
	{
		path: Type.String({ maxLength: 4096 }),
		severity: Type.Enum(["error", "warning", "info", "hint", "unknown"]),
		line: position,
		column: position,
		endLine: position,
		endColumn: position,
		code: Type.Optional(Type.String({ maxLength: 256 })),
		source: Type.Optional(Type.String({ maxLength: 512 })),
		message: Type.String({ maxLength: 4096 }),
	},
	strict,
);
export type LspDiagnostic = Static<typeof LspDiagnosticSchema>;
export const LspEvidenceSchema = Type.Object(
	{
		serverId: Type.String({ maxLength: 64 }),
		status: LspStatusSchema,
		diagnostics: Type.Array(LspDiagnosticSchema, { maxItems: 128 }),
		diffDigest: Type.String(),
		startedAt: Type.Integer({ minimum: 0 }),
		finishedAt: Type.Integer({ minimum: 0 }),
		evidenceRef: Type.String(),
		reason: Type.String({ maxLength: 1024 }),
		withheld: Type.Integer({ minimum: 0 }),
		truncated: Type.Integer({ minimum: 0 }),
	},
	strict,
);
export type LspEvidence = Static<typeof LspEvidenceSchema>;

export interface LspFileRequest {
	path: string;
	signal?: AbortSignal;
}
/** Both coordinates are 1-based; columns count UTF-16 code units, as negotiated with the server. */
export interface LspPositionRequest extends LspFileRequest {
	line: number;
	column: number;
}
export interface LspLocation {
	path: string;
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
}
export interface LspSymbol extends LspLocation {
	name: string;
	kind: number;
	depth: number;
	/** Full symbol extent; line/column above remain the navigation selection position. */
	range?: Omit<LspLocation, "path">;
}
export interface LspResult {
	serverId: string;
	status: LspStatus;
	reason: string;
	fileDigest?: string;
	startedAt: number;
	finishedAt: number;
	withheld: number;
	truncated: number;
}
export interface LspDiagnosticsResult extends LspResult {
	diagnostics: LspDiagnostic[];
}
export interface LspLocationsResult extends LspResult {
	locations: LspLocation[];
}
export interface LspSymbolsResult extends LspResult {
	symbols: LspSymbol[];
}
export interface LspPort {
	diagnostics(request: LspFileRequest): Promise<LspDiagnosticsResult>;
	definition(request: LspPositionRequest): Promise<LspLocationsResult>;
	references(request: LspPositionRequest): Promise<LspLocationsResult>;
	symbols(request: LspFileRequest): Promise<LspSymbolsResult>;
	readonly safeToRelease?: boolean;
	/** A failed cleanup forbids further workspace work even while a run is still active. */
	readonly cleanupFailed?: boolean;
	close(): Promise<void>;
}
export interface LspServerConfig {
	id: string;
	executable: string;
	args: string[];
	extensions: string[];
	timeout_ms: number;
}
export interface LspConfig {
	enabled: boolean;
	servers: LspServerConfig[];
}
export interface LspServerStatus {
	id: string;
	extensions: string[];
	status: "READY" | "UNAVAILABLE";
	process: "stopped" | "running";
}
export const LSP_READ_TOOLS = [
	{ id: "runtime_lsp_diagnostics", operation: "read" },
	{ id: "runtime_lsp_definition", operation: "read" },
	{ id: "runtime_lsp_references", operation: "read" },
	{ id: "runtime_lsp_symbols", operation: "read" },
] as const;
