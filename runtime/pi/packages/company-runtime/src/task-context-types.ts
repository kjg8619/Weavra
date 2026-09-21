/**
 * Task Context Pack types and budgets (V0.5A, C01). Leaf module: no filesystem, provider or policy adapter
 * imports, so Kernel/Policy ports can reference the pack type without pulling an adapter into their graph.
 */
/**
 * Task Context Pack (V0.5A, C01): Host-selected bounded starting context for a worker invocation.
 * It is advisory context only — never permission, approval, verification evidence, mutation receipt
 * or completion authority. Policy filtering happens before any content access, and the pack is rebuilt
 * from the current workspace for every invocation (no persistent cache).
 */
export const TASK_CONTEXT_DOMAIN = "weavra-task-context-pack-v1";
export const TASK_CONTEXT_VERSION = 1;
export const CONTEXT_MAX_SCANNED_FILES = 64;
export const CONTEXT_MAX_RELATED_FILES = 24;
export const CONTEXT_MAX_SYMBOLS = 32;
export const CONTEXT_MAX_SNIPPETS = 12;
export const CONTEXT_MAX_SNIPPET_BYTES = 4096;
export const CONTEXT_MAX_PACK_BYTES = 49152;
export const CONTEXT_MAX_SYMBOL_DOCUMENTS = 4;
export const CONTEXT_MAX_REFERENCE_QUERIES = 8;

export type TaskContextMode = "disabled" | "bounded";

/** Preservation score used by budget trimming: higher survives longer; a relation uses its strongest reason. */
export function taskContextPreservationScore(reasons: readonly string[]): number {
	const scores: Record<string, number> = {
		"acceptance-scope": 5,
		"changed-file": 4,
		"previous-review": 3,
		"lsp-reference": 2,
		"literal-reference": 1,
		"same-stem-test": 0,
	};
	return reasons.length ? Math.max(...reasons.map((reason) => scores[reason] ?? -1)) : -1;
}

export interface TaskContextSymbol {
	name: string;
	path: string;
	/** LSP symbol kind (number, unchanged from the server contract). */
	kind: number;
	/** 1-based UTF-16 position, exactly as reported by the LSP server. */
	line: number;
	column: number;
	endLine: number;
	endColumn: number;
	reason: "lsp-symbol";
}

export interface TaskContextRelated {
	path: string;
	reasons: string[];
}

export interface TaskContextSnippet {
	path: string;
	startLine: number;
	endLine: number;
	fileDigest: string;
	snippetDigest: string;
	text: string;
}

export interface TaskContextRules {
	path: string | null;
	digest: string | null;
	bytes: number | null;
	kind: "configured-file" | "inline" | "none";
}

export interface TaskContextPack {
	version: number;
	digest: string;
	mode: "bounded";
	targetSymbols: TaskContextSymbol[];
	relatedFiles: TaskContextRelated[];
	projectRules: TaskContextRules;
	snippets: TaskContextSnippet[];
	unknowns: string[];
	truncated: boolean;
}

/** Production LSP surface used by the builder; no drift interface, no mutation capability. */
