import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";
import { listFiles } from "./list-files.ts";
import type { LspPort, LspSymbol } from "./lsp/types.ts";
import {
	isListablePath,
	isPolicyPath,
	isProtectedPath,
	type PolicyContext,
	type PolicyPathInspector,
} from "./policy.ts";
import { ProcessCleanupError } from "./process-runner.ts";
import {
	CONTEXT_MAX_PACK_BYTES,
	CONTEXT_MAX_REFERENCE_QUERIES,
	CONTEXT_MAX_RELATED_FILES,
	CONTEXT_MAX_SCANNED_FILES,
	CONTEXT_MAX_SNIPPET_BYTES,
	CONTEXT_MAX_SNIPPETS,
	CONTEXT_MAX_SYMBOL_DOCUMENTS,
	CONTEXT_MAX_SYMBOLS,
	TASK_CONTEXT_DOMAIN,
	TASK_CONTEXT_VERSION,
	type TaskContextMode,
	type TaskContextPack,
	type TaskContextRelated,
	type TaskContextRules,
	type TaskContextSnippet,
	type TaskContextSymbol,
} from "./task-context-types.ts";

export * from "./task-context-types.ts";

/** Production LSP surface used by the builder; no drift interface, no mutation capability. */
export type ContextLspPort = Pick<LspPort, "symbols" | "references"> & { readonly cleanupFailed?: boolean };

export interface TaskContextInput {
	cwd: string;
	mode: TaskContextMode;
	/** Host-derived seeds: acceptance scope paths, changed files, previous review issue files. */
	seedPaths: readonly string[];
	/** Task text used only for deterministic literal extraction (goal + acceptance statements). */
	taskText: readonly string[];
	/** Workspace-relative paths that are already known to be relevant (verification/handoff). */
	changedFiles?: readonly string[];
	previousReviewFiles?: readonly string[];
	paths: PolicyPathInspector;
	lsp?: ContextLspPort;
	protectedPaths?: readonly string[];
	/** Declared trusted verifier oracle sources: never included in the pack. */
	verifierSources?: readonly string[];
	/** Frozen policy for listable-path filtering (Host-owned, never worker input). */
	policy: PolicyContext;
	/** Metadata for the configured project instruction file; the body stays in the system context. */
	projectInstruction?: { path: string; digest: string; bytes: number };
	/** Metadata for an explicit inline Host instruction; the body is never copied here. */
	inlineInstruction?: { digest: string; bytes: number };
	/** Host-owned listing bounds; defaults to the workspace root at depth 4. */
	listingRoots?: readonly string[];
	listingDepth?: number;
	signal?: AbortSignal;
}

const FILE_MAX_BYTES = 262144;

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

function sha256Of(value: unknown, domain: string): string {
	return createHash("sha256").update(JSON.stringify({ domain, value })).digest("hex");
}

function canonical(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return path;
	}
}

/** Policy-first filter: secrets and protected paths are excluded before any read or listing. */
export function isContextEligible(
	workspace: string,
	path: string,
	protectedPaths: readonly string[],
	verifierSources: readonly string[],
	policy: PolicyContext,
): boolean {
	if (!isListablePath(path, policy) || !isPolicyPath(path)) return false;
	if (isProtectedPath(path, protectedPaths)) return false;
	if (isProtectedPath(path, verifierSources)) return false;
	if (!policy.allowedPaths.some((root) => path === root || path.startsWith(`${root}/`))) return false;
	// Lexical path safety: the declared path and every parent component must be real directory entries.
	// A symlink that happens to resolve to a safe target is still denied; realpath is never the authority.
	const parts = path.split("/");
	let current = workspace;
	for (const [index, part] of parts.entries()) {
		current = join(current, part);
		let stat: ReturnType<typeof lstatSync>;
		try {
			stat = lstatSync(current);
		} catch {
			return false;
		}
		if (index < parts.length - 1) {
			if (stat.isSymbolicLink() || !stat.isDirectory()) return false;
			continue;
		}
		if (stat.isSymbolicLink() || !stat.isFile() || stat.nlink > 1) return false;
	}
	return canonical(current).startsWith(workspace + sep);
}

/** A declared acceptance-scope directory: listable, unprotected and inside an allowed root. */
function isContextDirectory(workspace: string, path: string, policy: PolicyContext): boolean {
	if (!isListablePath(path, policy) || !isPolicyPath(path)) return false;
	if (!policy.allowedPaths.some((root) => path === root || path.startsWith(`${root}/`) || root.startsWith(`${path}/`)))
		return false;
	let current = workspace;
	for (const [index, part] of path.split("/").entries()) {
		current = join(current, part);
		try {
			const stat = lstatSync(current);
			if (stat.isSymbolicLink()) return false;
			if (index < path.split("/").length - 1 && !stat.isDirectory()) return false;
			if (index === path.split("/").length - 1) return stat.isDirectory();
		} catch {
			return false;
		}
	}
	return false;
}

/** Bounded project-rule metadata only; the instruction body is never copied into the pack. */
function projectRulesOf(input: TaskContextInput): TaskContextRules {
	if (input.projectInstruction)
		return {
			kind: "configured-file",
			path: input.projectInstruction.path,
			digest: input.projectInstruction.digest,
			bytes: input.projectInstruction.bytes,
		};
	if (input.inlineInstruction)
		return {
			kind: "inline",
			path: null,
			digest: input.inlineInstruction.digest,
			bytes: input.inlineInstruction.bytes,
		};
	return { kind: "none", path: null, digest: null, bytes: null };
}

/** Bounded strict read with before/after identity validation; an unstable read yields no snippet. */
export function readStableText(path: string): { text: string; digest: string } | undefined {
	let fd: number;
	try {
		fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch {
		return undefined;
	}
	try {
		const before = fstatSync(fd, { bigint: true });
		if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(FILE_MAX_BYTES)) return undefined;
		const buffer = Buffer.alloc(Number(before.size) + 1);
		let length = 0;
		while (length < buffer.length) {
			const count = readSync(fd, buffer, length, buffer.length - length, length);
			if (!count) break;
			length += count;
		}
		const after = fstatSync(fd, { bigint: true });
		const current = lstatSync(path, { bigint: true });
		if (
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.size !== before.size ||
			after.mtimeNs !== before.mtimeNs ||
			after.ctimeNs !== before.ctimeNs ||
			current.dev !== before.dev ||
			current.ino !== before.ino
		)
			return undefined;
		const bytes = buffer.subarray(0, length);
		if (bytes.includes(0)) return undefined;
		const text = bytes.toString("utf8");
		if (Buffer.from(text, "utf8").compare(bytes) !== 0) return undefined;
		return { text, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
	} catch {
		return undefined;
	} finally {
		closeSync(fd);
	}
}

/** Deterministic literal terms: backticked/quoted identifiers, path stems and code-like tokens only. */
export function extractLiteralTerms(taskText: readonly string[]): string[] {
	const terms = new Set<string>();
	for (const raw of taskText) {
		for (const match of raw.matchAll(/`([^`\n]{1,64})`/g)) terms.add(match[1].trim());
		for (const match of raw.matchAll(/"([^"\n]{1,64})"/g)) terms.add(match[1].trim());
		for (const match of raw.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*\.[A-Za-z0-9_.]+)\b/g)) terms.add(match[1]);
		for (const match of raw.matchAll(/\b(\w+\.(?:ts|tsx|js|mjs|cjs|json|md)\b)/g)) terms.add(match[1]);
		for (const match of raw.matchAll(/\b([a-z][a-z0-9]*(?:[A-Z][A-Za-z0-9]*)+)\b/g)) terms.add(match[1]);
	}
	return [...terms]
		.map((term) => term.replace(/^\.\//, "").trim())
		.filter((term) => term.length >= 3)
		.sort()
		.slice(0, 16);
}

function relatedTestCandidates(seed: string, discovered: readonly string[]): string[] {
	const stem = seed.replace(/\.[^.]+$/, "");
	const base = stem.split("/").pop() ?? stem;
	return discovered
		.filter((path) => path !== seed && !path.endsWith(seed))
		.filter(
			(path) =>
				/\.(?:test|spec)\.[^.]+$/.test(path) &&
				(path.includes(base) || path.startsWith("test/") || path.startsWith("tests/")),
		)
		.sort()
		.slice(0, CONTEXT_MAX_RELATED_FILES);
}

function snippetOf(text: string, fileDigest: string, path: string, term: string): TaskContextSnippet | undefined {
	const lines = text.split("\n");
	const index = lines.findIndex((line) => line.includes(term));
	if (index < 0) return undefined;
	const start = Math.max(0, index - 2);
	const end = Math.min(lines.length, index + 3);
	const slice = lines.slice(start, end);
	let snippetText = slice.join("\n");
	while (Buffer.byteLength(snippetText, "utf8") > CONTEXT_MAX_SNIPPET_BYTES && slice.length > 1) {
		slice.pop();
		snippetText = slice.join("\n");
	}
	return {
		path,
		startLine: start + 1,
		endLine: start + slice.length,
		fileDigest,
		snippetDigest: `sha256:${createHash("sha256").update(snippetText, "utf8").digest("hex")}`,
		text: snippetText,
	};
}

/**
 * Builds the bounded pack from the current workspace. Returns undefined in disabled mode.
 * No provider call, no mutation, no cache: the caller supplies already-derived seeds.
 */
export async function buildTaskContextPack(input: TaskContextInput): Promise<TaskContextPack | undefined> {
	if (input.mode !== "bounded") return undefined;
	const workspace = canonical(input.cwd);
	const protectedPaths = [...(input.protectedPaths ?? [])];
	const verifierSources = [...(input.verifierSources ?? [])];
	const policy = input.policy;
	const unknowns: string[] = [];
	let truncated = false;

	const roots = (input.listingRoots ?? policy.allowedPaths.filter((path) => isListablePath(path, policy)))
		.filter((path) => isListablePath(path, policy))
		.filter((path, index, all) => all.indexOf(path) === index)
		.sort();
	if (!roots.length) {
		// Honest empty pack: an absent listable root is not a permission change and must not fail the run.
		const emptyBody = {
			version: TASK_CONTEXT_VERSION,
			mode: "bounded" as const,
			targetSymbols: [],
			relatedFiles: [],
			snippets: [],
			unknowns: ["no listable allowed roots"],
			truncated: false,
			projectRules: projectRulesOf(input),
		};
		return { ...emptyBody, digest: `sha256:${sha256Of(emptyBody, TASK_CONTEXT_DOMAIN)}` };
	}
	const listed = await listFiles(
		workspace,
		roots,
		input.listingDepth ?? 4,
		input.policy,
		input.paths,
		input.signal ?? new AbortController().signal,
	);
	const eligible = listed.files.filter((path) =>
		isContextEligible(workspace, path, protectedPaths, verifierSources, policy),
	);
	// Policy-filtered files are not truncation; only the Host scan budget dropping eligible files is.
	if (listed.truncated || eligible.length > CONTEXT_MAX_SCANNED_FILES) truncated = true;
	const discovered = eligible.slice(0, CONTEXT_MAX_SCANNED_FILES);

	const related = new Map<string, Set<string>>();
	const addRelated = (path: string, reason: string) => {
		if (!isContextEligible(workspace, path, protectedPaths, verifierSources, policy)) return;
		const reasons = related.get(path) ?? new Set<string>();
		reasons.add(reason);
		related.set(path, reasons);
	};
	// A seed is either an eligible file or a directory (acceptance scope usually names an allowed root);
	// directories contribute listing roots and their discovered files become acceptance-scope relations.
	const seedDirectories: string[] = [];
	const seeds: string[] = [];
	for (const path of [...new Set([...input.seedPaths, ...(input.changedFiles ?? [])])].sort()) {
		if (input.seedPaths.includes(path) && isContextDirectory(workspace, path, policy)) {
			seedDirectories.push(path);
			continue;
		}
		if (isContextEligible(workspace, path, protectedPaths, verifierSources, policy)) seeds.push(path);
	}
	for (const root of seedDirectories) roots.push(root);
	for (const seed of seeds) {
		addRelated(seed, input.seedPaths.includes(seed) ? "acceptance-scope" : "changed-file");
		for (const candidate of relatedTestCandidates(seed, discovered)) addRelated(candidate, "same-stem-test");
	}
	for (const path of discovered) {
		if (related.size >= CONTEXT_MAX_RELATED_FILES) {
			truncated = true;
			break;
		}
		if (seedDirectories.some((root) => path.startsWith(`${root}/`))) addRelated(path, "acceptance-scope");
	}
	for (const path of input.previousReviewFiles ?? []) addRelated(path, "previous-review");

	const terms = extractLiteralTerms(input.taskText);
	for (const path of discovered) {
		if (related.size >= CONTEXT_MAX_RELATED_FILES) break;
		const absolute = join(workspace, path);
		const read = readStableText(absolute);
		if (!read) {
			unknowns.push(`unreadable or unstable file: ${path}`);
			continue;
		}
		if (terms.some((term) => read.text.includes(term)) && !related.has(path)) addRelated(path, "literal-reference");
	}

	const targetSymbols: TaskContextSymbol[] = [];
	const snippets: TaskContextSnippet[] = [];
	const relatedPaths = [...related.keys()].sort().slice(0, CONTEXT_MAX_RELATED_FILES);
	if (related.size > relatedPaths.length) truncated = true;
	for (const path of relatedPaths) {
		const read = readStableText(join(workspace, path));
		if (!read) {
			unknowns.push(`unstable read for snippet: ${path}`);
			continue;
		}
		const term = terms.find((candidate) => read.text.includes(candidate));
		if (!term) continue;
		if (snippets.length >= CONTEXT_MAX_SNIPPETS) {
			truncated = true;
			break;
		}
		const snippet = snippetOf(read.text, read.digest, path, term);
		if (snippet) snippets.push(snippet);
	}

	if (input.lsp) {
		const lsp = input.lsp;
		const assertLspClean = () => {
			if (lsp.cleanupFailed === true) throw new ProcessCleanupError();
		};
		const symbolDocuments = relatedPaths.slice(0, CONTEXT_MAX_SYMBOL_DOCUMENTS);
		const candidates: Array<TaskContextSymbol> = [];
		for (const path of symbolDocuments) {
			assertLspClean();
			let result: Awaited<ReturnType<LspPort["symbols"]>>;
			try {
				result = await lsp.symbols({ path, signal: input.signal });
			} catch (error) {
				if (error instanceof ProcessCleanupError) throw error;
				unknowns.push(`lsp symbols error for ${path}`);
				continue;
			}
			if (result.status !== "AVAILABLE") {
				unknowns.push(`lsp symbols ${result.status.toLowerCase()} for ${path}`);
				if (result.status === "PARTIAL") truncated = true;
				continue;
			}
			if (result.withheld > 0 || result.truncated > 0) {
				truncated = true;
				unknowns.push(`lsp symbols partially withheld for ${path}`);
			}
			for (const symbol of result.symbols as LspSymbol[]) {
				if (!terms.includes(symbol.name)) continue;
				candidates.push({
					name: symbol.name,
					path: symbol.path,
					kind: symbol.kind,
					line: symbol.line,
					column: symbol.column,
					endLine: symbol.endLine,
					endColumn: symbol.endColumn,
					reason: "lsp-symbol",
				});
			}
		}
		// Canonical order before any budget or digest decision: identical semantics must not depend on
		// the order a language server returned symbols in.
		candidates.sort(
			(a, b) =>
				a.path.localeCompare(b.path) ||
				a.line - b.line ||
				a.column - b.column ||
				a.name.localeCompare(b.name) ||
				a.kind - b.kind,
		);
		for (const symbol of candidates) {
			if (targetSymbols.length >= CONTEXT_MAX_SYMBOLS) {
				truncated = true;
				break;
			}
			targetSymbols.push(symbol);
		}

		let referenceQueries = 0;
		for (const symbol of targetSymbols) {
			if (referenceQueries >= CONTEXT_MAX_REFERENCE_QUERIES) {
				truncated = true;
				unknowns.push("lsp reference query budget reached");
				break;
			}
			assertLspClean();
			referenceQueries += 1;
			let result: Awaited<ReturnType<LspPort["references"]>>;
			try {
				result = await lsp.references({
					path: symbol.path,
					line: symbol.line,
					column: symbol.column,
					signal: input.signal,
				});
			} catch (error) {
				if (error instanceof ProcessCleanupError) throw error;
				unknowns.push(`lsp references error for ${symbol.name}`);
				continue;
			}
			if (result.status !== "AVAILABLE") {
				unknowns.push(`lsp references ${result.status.toLowerCase()} for ${symbol.name}`);
				if (result.status === "PARTIAL") truncated = true;
				continue;
			}
			if (result.withheld > 0 || result.truncated > 0) {
				truncated = true;
				unknowns.push(`lsp references partially withheld for ${symbol.name}`);
			}
			const locations = [...result.locations].sort(
				(a, b) =>
					a.path.localeCompare(b.path) ||
					a.line - b.line ||
					a.column - b.column ||
					a.endLine - b.endLine ||
					a.endColumn - b.endColumn,
			);
			for (const location of locations) {
				// LSP output is not a permission source: every referenced path is re-validated.
				if (!isContextEligible(workspace, location.path, protectedPaths, verifierSources, policy)) continue;
				addRelated(location.path, "lsp-reference");
			}
		}
	}

	const projectRules = projectRulesOf(input);
	const heuristicReasons = new Set(["same-stem-test", "literal-reference", "lsp-reference"]);
	// Trimming keeps the strongest reason of each relation, so a seed that is also a same-stem test
	// survives like a seed (see taskContextPreservationScore).
	const preservationScore = taskContextPreservationScore;
	const finalize = (parts: {
		symbols: TaskContextSymbol[];
		related: TaskContextRelated[];
		snippets: TaskContextSnippet[];
		unknownList: string[];
		truncatedFlag: boolean;
	}): TaskContextPack => {
		const body = {
			version: TASK_CONTEXT_VERSION,
			mode: "bounded" as const,
			targetSymbols: parts.symbols,
			relatedFiles: parts.related,
			projectRules,
			snippets: parts.snippets,
			unknowns: parts.unknownList,
			truncated: parts.truncatedFlag,
		};
		return { ...body, digest: `sha256:${sha256Of(body, TASK_CONTEXT_DOMAIN)}` };
	};
	// Recompute after LSP enrichment so discovered references appear in the final pack.
	const finalRelatedPaths = [...related.keys()].sort().slice(0, CONTEXT_MAX_RELATED_FILES);
	if (related.size > finalRelatedPaths.length) truncated = true;
	const relatedEntries: TaskContextRelated[] = finalRelatedPaths.map((path) => ({
		path,
		reasons: [...related.get(path)!].sort(),
	}));
	let pack = finalize({
		symbols: targetSymbols.slice(0, CONTEXT_MAX_SYMBOLS),
		related: relatedEntries,
		snippets: [...snippets].sort((a, b) => a.path.localeCompare(b.path) || a.startLine - b.startLine),
		unknownList: [...new Set(unknowns)].sort().slice(0, 32),
		truncatedFlag: truncated,
	});
	const fits = (candidate: TaskContextPack) =>
		Buffer.byteLength(JSON.stringify(candidate), "utf8") <= CONTEXT_MAX_PACK_BYTES;
	if (!fits(pack)) {
		// The 48 KiB cap covers the whole canonical pack. Trimming order is deterministic:
		// heuristic snippets -> symbols -> heuristic-only relations -> unknowns.
		let symbols = pack.targetSymbols;
		let relatedFiles = pack.relatedFiles;
		let snippets = pack.snippets;
		let unknownList = pack.unknowns;
		for (;;) {
			pack = finalize({ symbols, related: relatedFiles, snippets, unknownList, truncatedFlag: true });
			if (fits(pack)) break;
			const heuristicSnippet = [...snippets].reverse().find((snippet) => {
				const entry = relatedFiles.find((file) => file.path === snippet.path);
				return entry ? entry.reasons.every((reason) => heuristicReasons.has(reason)) : false;
			});
			if (heuristicSnippet) {
				snippets = snippets.filter((snippet) => snippet !== heuristicSnippet);
				continue;
			}
			if (snippets.length) {
				snippets = snippets.slice(0, -1);
				continue;
			}
			if (symbols.length) {
				symbols = symbols.slice(0, -1);
				continue;
			}
			// Advisory metadata yields to the output cap: drop the lowest-priority relation, deterministic
			// tie-break is reverse lexical order, so the same input always trims to the same pack.
			const ranked = [...relatedFiles].sort(
				(a, b) => preservationScore(a.reasons) - preservationScore(b.reasons) || b.path.localeCompare(a.path),
			);
			if (ranked.length) {
				relatedFiles = relatedFiles.filter((file) => file !== ranked[0]);
				continue;
			}
			if (unknownList.length > 1) {
				// Strictly decreasing so the loop always terminates; the next iteration reaches the
				// minimal fallback or the explicit bounded error.
				unknownList = [unknownList[0]];
				continue;
			}
			// Everything selectable is gone: degrade to the minimal valid pack instead of returning an
			// oversized one. Only an impossible metadata shape may still exceed the cap here.
			const minimal = finalize({
				symbols: [],
				related: [],
				snippets: [],
				unknownList: ["context entries omitted: output limit"],
				truncatedFlag: true,
			});
			if (Buffer.byteLength(JSON.stringify(minimal), "utf8") > CONTEXT_MAX_PACK_BYTES)
				throw new Error("Task context pack exceeds its byte cap even without optional context");
			return minimal;
		}
		const trimmedPack = finalize({ symbols, related: relatedFiles, snippets, unknownList, truncatedFlag: true });
		// Successful returns always satisfy the cap; this makes the invariant explicit in code.
		if (Buffer.byteLength(JSON.stringify(trimmedPack), "utf8") > CONTEXT_MAX_PACK_BYTES)
			throw new Error("Task context pack exceeds its byte cap");
		return trimmedPack;
	}
	if (Buffer.byteLength(JSON.stringify(pack), "utf8") > CONTEXT_MAX_PACK_BYTES)
		throw new Error("Task context pack exceeds its byte cap");
	return pack;
}

/** Bounded observation summary; contains no snippet text and no absolute paths. */
export function summarizeTaskContextPack(pack: TaskContextPack): {
	mode: "bounded";
	digest: string;
	bytes: number;
	relatedFileCount: number;
	symbolCount: number;
	snippetCount: number;
	unknownCount: number;
	truncated: boolean;
};
export function summarizeTaskContextPack(pack: undefined): {
	mode: "disabled";
	digest: null;
	bytes: number;
	relatedFileCount: number;
	symbolCount: number;
	snippetCount: number;
	unknownCount: number;
	truncated: boolean;
};
export function summarizeTaskContextPack(pack: TaskContextPack | undefined): {
	mode: TaskContextMode;
	digest: string | null;
	bytes: number;
	relatedFileCount: number;
	symbolCount: number;
	snippetCount: number;
	unknownCount: number;
	truncated: boolean;
} {
	if (!pack) {
		return {
			mode: "disabled",
			digest: null,
			bytes: 0,
			relatedFileCount: 0,
			symbolCount: 0,
			snippetCount: 0,
			unknownCount: 0,
			truncated: false,
		};
	}
	return {
		mode: "bounded",
		digest: pack.digest,
		bytes: Buffer.byteLength(JSON.stringify(pack), "utf8"),
		relatedFileCount: pack.relatedFiles.length,
		symbolCount: pack.targetSymbols.length,
		snippetCount: pack.snippets.length,
		unknownCount: pack.unknowns.length,
		truncated: pack.truncated,
	};
}
