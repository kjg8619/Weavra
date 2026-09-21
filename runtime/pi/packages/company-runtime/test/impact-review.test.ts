import { linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, expect, it } from "vitest";
import { fileDigest } from "../src/anchored-edit.ts";
import { buildImpactReviewPack, changedCurrentRanges, type ImpactReviewInput } from "../src/impact-review.ts";
import { LspFiles } from "../src/lsp/files.ts";
import { normalizeLsp } from "../src/lsp/normalize.ts";
import type { LspLocation, LspPort, LspResult, LspSymbol } from "../src/lsp/types.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";

let cwd: string;
const before = "export function label(v) {\n  return v;\n}\nexport function untouched(v) {\n  return v;\n}\n";
const after = before.replace("return v;", "return v.trim();");
const sourceDigest = fileDigest(after);
const symbols: LspSymbol[] = [
	{
		path: "src/label.ts",
		name: "label",
		kind: 12,
		depth: 0,
		line: 1,
		column: 17,
		endLine: 1,
		endColumn: 22,
		range: { line: 1, column: 1, endLine: 3, endColumn: 2 },
	},
	{
		path: "src/label.ts",
		name: "untouched",
		kind: 12,
		depth: 0,
		line: 4,
		column: 17,
		endLine: 4,
		endColumn: 26,
		range: { line: 4, column: 1, endLine: 6, endColumn: 2 },
	},
];
const at = (path: string): LspLocation => ({ path, line: 1, column: 1, endLine: 1, endColumn: 6 });
function lsp(
	options: {
		status?: LspResult["status"];
		digest?: string;
		symbols?: LspSymbol[];
		references?: LspLocation[];
		mutate?: () => void;
	} = {},
): LspPort {
	const result: LspResult = {
		serverId: "fixture",
		status: options.status ?? "AVAILABLE",
		fileDigest: options.digest ?? sourceDigest,
		reason: "Fixture",
		startedAt: 1,
		finishedAt: 2,
		withheld: 0,
		truncated: 0,
	};
	return {
		symbols: async () => {
			options.mutate?.();
			return { ...result, symbols: options.symbols ?? symbols };
		},
		references: async () => ({
			...result,
			locations: options.references ?? [at("src/caller.ts"), at("test/label.test.ts")],
		}),
		definition: async () => ({ ...result, locations: [] }),
		diagnostics: async () => ({ ...result, diagnostics: [] }),
		close: async () => {},
	};
}
function write(path: string, text: string) {
	mkdirSync(join(cwd, path, ".."), { recursive: true });
	writeFileSync(join(cwd, path), text);
}
async function build(overrides: Partial<ImpactReviewInput> = {}) {
	return buildImpactReviewPack({
		cwd,
		runId: "run",
		revision: 0,
		taskContractDigest: fileDigest("task"),
		generatedAt: 1,
		policy: {
			executionMode: "EDIT",
			executionRunId: "run",
			allowedPaths: ["src", "test"],
			protectedPaths: ["src/protected.ts", "src/rules.md"],
			tools: [{ id: "runtime_read", operation: "read" }],
			configDigest: "config",
		},
		paths: await FilePolicyPathInspector.open(cwd),
		protectedPaths: ["src/protected.ts", "src/rules.md"],
		verifierSources: ["test/oracle.ts"],
		scopePaths: ["src"],
		lsp: lsp(),
		diff: {
			safe: true,
			diffDigest: "diff",
			changedFiles: ["src/label.ts"],
			changedLines: 2,
			evidenceRefs: [],
			diff: JSON.stringify([{ path: "src/label.ts", before, after }]),
		},
		...overrides,
	});
}
beforeEach(() => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-impact-")));
	write("src/label.ts", after);
	write("src/caller.ts", "label('x');\n");
	write("test/label.test.ts", "label('x');\n");
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

async function changed(before: string, after: string, currentSymbols: LspSymbol[], port?: LspPort) {
	write("src/label.ts", after);
	return build({
		lsp: port ?? lsp({ symbols: currentSymbols, digest: fileDigest(after), references: [] }),
		diff: {
			safe: true,
			diffDigest: fileDigest(after),
			changedFiles: ["src/label.ts"],
			changedLines: 1,
			evidenceRefs: [],
			diff: JSON.stringify([{ path: "src/label.ts", before, after }]),
		},
	});
}

it("detects the changed function body, not an unchanged sibling, and identifies caller and test", async () => {
	const pack = await build();
	expect(pack.changedSymbols.map((s) => s.name)).toEqual(["label"]);
	expect(pack.changedSymbols[0]).toMatchObject({
		sourceDigest,
		range: symbols[0].range,
		selection: { line: 1, column: 17 },
	});
	expect(pack.callers.map((r) => r.path)).toEqual(["src/caller.ts", "test/label.test.ts"]);
	expect(pack.relatedTests).toEqual([
		{ path: "test/label.test.ts", reason: "lsp-reference", sourceDigest: fileDigest("label('x');\n") },
	]);
});
it("selects the most specific enclosing nested symbol", async () => {
	const nested = {
		...symbols[0],
		name: "inner",
		kind: 13,
		depth: 1,
		line: 2,
		column: 3,
		endLine: 2,
		endColumn: 8,
		range: { line: 2, column: 3, endLine: 2, endColumn: 19 },
	};
	expect((await build({ lsp: lsp({ symbols: [...symbols, nested] }) })).changedSymbols.map((s) => s.name)).toEqual([
		"inner",
	]);
});
it("separates disjoint edits and represents deletion as a boundary, not a current line", () => {
	expect(changedCurrentRanges("a\nb\nc\nd\ne", "a\nB\nc\nD\ne")).toEqual([
		{ line: 2, column: 1, endLine: 2, endColumn: 2, deletion: false },
		{ line: 4, column: 1, endLine: 4, endColumn: 2, deletion: false },
	]);
	expect(changedCurrentRanges("a\nb\nc", "a\nc")).toEqual([
		{ line: 2, column: 1, endLine: 2, endColumn: 1, deletion: true },
	]);
	expect(changedCurrentRanges("a", "a")).toEqual([]);
});
it("reports unavailable when exact line computation exceeds its finite budget", () => {
	expect(changedCurrentRanges("a\n".repeat(1600), "b\n".repeat(1600))).toBeUndefined();
});
it("canonicalizes LSP order and excludes observation time from content identity", async () => {
	const first = await build(),
		second = await build({
			generatedAt: 99,
			lsp: lsp({ symbols: [...symbols].reverse(), references: [at("test/label.test.ts"), at("src/caller.ts")] }),
		});
	expect(first.digest).toBe(second.digest);
	expect(first.changedSymbols[0].id).toBe(second.changedSymbols[0].id);
});
it("excludes protected, oracle, project instructions, outside-root, symlinks and hardlinks before reading", async () => {
	for (const p of ["src/protected.ts", "src/rules.md", "test/oracle.ts", ".env", ".ai/config.yaml", ".git/config"])
		write(p, "PRIVATE_SENTINEL");
	symlinkSync(join(cwd, ".env"), join(cwd, "src/escape.ts"));
	linkSync(join(cwd, ".env"), join(cwd, "src/hard.ts"));
	const forbidden = [
		"src/protected.ts",
		"src/rules.md",
		"test/oracle.ts",
		".env",
		".ai/config.yaml",
		".git/config",
		"../outside.ts",
		"/tmp/outside.ts",
		"src/escape.ts",
		"src/hard.ts",
	];
	const pack = await build({ lsp: lsp({ references: [...forbidden.map(at), at("src/caller.ts")] }) });
	expect(pack.callers.map((p) => p.path)).toEqual(["src/caller.ts"]);
	for (const value of [...forbidden, "PRIVATE_SENTINEL"]) expect(JSON.stringify(pack)).not.toContain(value);
});
it.each(["STALE", "UNAVAILABLE", "ERROR"] as const)("degrades %s without inventing changed symbols", async (status) => {
	const pack = await build({ lsp: lsp({ status }) });
	expect(pack.changedSymbols).toEqual([]);
	expect(pack.callers).toEqual([]);
	expect(pack.unknowns).toContain("LSP symbols unavailable or stale");
});
it("does not accept a stale source digest even with AVAILABLE status", async () => {
	expect((await build({ lsp: lsp({ digest: fileDigest(before) }) })).changedSymbols).toEqual([]);
});
it("rejects a source changed during the LSP query", async () => {
	expect((await build({ lsp: lsp({ mutate: () => write("src/label.ts", before) }) })).changedSymbols).toEqual([]);
});
it("does not guess body ranges from name selection positions", async () => {
	const selectionOnly = symbols.map(({ range: _range, ...symbol }) => symbol);
	const pack = await build({ lsp: lsp({ symbols: selectionOnly }) });
	expect(pack.changedSymbols).toEqual([]);
	expect(pack.unknowns).toContain("symbol extent unavailable or invalid");
});
it("degrades absent LSP and still offers explicitly heuristic test discovery", async () => {
	const pack = await build({ lsp: undefined });
	expect(pack.changedSymbols).toEqual([]);
	expect(pack.unknowns).toContain("LSP unavailable");
	expect(pack.relatedTests[0].reason).toBe("same-stem");
});
it("trims deterministically below the requested cap and rejects an impossible minimum", async () => {
	const first = await build({ maxBytes: 850 }),
		second = await build({ maxBytes: 850, lsp: lsp({ symbols: [...symbols].reverse() }) });
	expect(Buffer.byteLength(JSON.stringify(first))).toBeLessThanOrEqual(850);
	expect(first.truncated).toBe(true);
	expect(second.digest).toBe(first.digest);
	await expect(build({ maxBytes: 10 })).rejects.toThrow("minimum exceeds");
});
it("propagates cancellation instead of continuing with a falsely usable pack", async () => {
	const abort = new AbortController();
	abort.abort();
	await expect(build({ signal: abort.signal })).rejects.toThrow();
});

it("does not attribute deleted first or last functions to an unchanged surviving sibling", async () => {
	const kept = "function kept() {}";
	const symbol = {
		...symbols[0],
		name: "kept",
		line: 1,
		column: 10,
		endLine: 1,
		endColumn: 14,
		range: { line: 1, column: 1, endLine: 1, endColumn: kept.length + 1 },
	};
	for (const before of [`function gone() {}\n${kept}`, `${kept}\nfunction gone() {}`]) {
		const pack = await changed(before, kept, [symbol]);
		expect(pack.changedSymbols).toEqual([]);
		expect(pack.callers).toEqual([]);
	}
	const original = "function kept() {\n  gone();\n}\n",
		current = "function kept() {\n}\n";
	const pack = await changed(original, current, [
		{ ...symbol, range: { line: 1, column: 1, endLine: 2, endColumn: 2 } },
	]);
	expect(pack.changedSymbols.map((item) => item.name)).toEqual(["kept"]);
});

it("retains safe deletion metadata and same-stem test discovery without a fabricated current symbol", async () => {
	rmSync(join(cwd, "src/label.ts"));
	const pack = await build({
		diff: {
			safe: true,
			diffDigest: "deleted",
			changedFiles: ["src/label.ts"],
			changedLines: 6,
			evidenceRefs: [],
			diff: JSON.stringify([{ path: "src/label.ts", before, after: null }]),
		},
	});
	expect(pack.changedFiles).toEqual(["src/label.ts"]);
	expect(pack.changedSymbols).toEqual([]);
	expect(pack.relatedTests).toEqual([
		{ path: "test/label.test.ts", reason: "same-stem", sourceDigest: fileDigest("label('x');\n") },
	]);
});

it("uses UTF-16 changed extents to distinguish disjoint same-line functions", async () => {
	const original = "function a(){return 1} function b(){return 1}";
	const current = "function a(){return 1} function b(){return 2}";
	const a = {
		...symbols[0],
		name: "a",
		column: 10,
		endColumn: 11,
		range: { line: 1, column: 1, endLine: 1, endColumn: 23 },
	};
	const b = {
		...a,
		name: "b",
		column: 32,
		endColumn: 33,
		range: { line: 1, column: 23, endLine: 1, endColumn: current.length + 1 },
	};
	expect((await changed(original, current, [a, b])).changedSymbols.map((item) => item.name)).toEqual(["b"]);
	const inconsistent = { ...b, range: a.range };
	expect((await changed(original, current, [inconsistent])).changedSymbols).toEqual([]);
});

it("retains scope-priority callers before the global relation cap", async () => {
	write("src/caller.ts", "x".repeat(130));
	write("src/z.ts", "label('z')");
	const locations = Array.from({ length: 64 }, (_, index) => ({
		...at("src/caller.ts"),
		column: index + 1,
		endColumn: index + 2,
	}));
	locations.push(at("src/z.ts"));
	const pack = await build({ scopePaths: ["src/z.ts"], lsp: lsp({ references: locations }) });
	expect(pack.callers[0].path).toBe("src/z.ts");
	expect(pack.callers).toHaveLength(64);
	expect(pack.truncated).toBe(true);
});

it("omits reference targets changed during the query or after an earlier relation was collected", async () => {
	for (const during of ["references", "definition"] as const) {
		write("src/caller.ts", "label('x');\n");
		const port = lsp();
		const query = port[during];
		port[during] = async (request) => {
			write("src/caller.ts", "other('x');\n");
			return query(request);
		};
		const pack = await build({ lsp: port });
		expect(pack.callers.map((item) => item.path)).toEqual(["test/label.test.ts"]);
	}
});

it("removes already-collected symbols when a later query changes their source", async () => {
	const port = lsp();
	port.definition = async () => {
		write("src/label.ts", before);
		return { ...(await lsp().definition({ path: "src/label.ts", line: 1, column: 17 })) };
	};
	const pack = await build({ lsp: port });
	expect(pack.changedSymbols).toEqual([]);
	expect(pack.callers).toEqual([]);
	expect(pack.relatedTests.filter((item) => item.reason === "lsp-reference")).toEqual([]);
});

it("filters excluded listing roots and case aliases of oracle-only exclusions", async () => {
	write(".env", "PRIVATE_SENTINEL");
	write("test/oracle.ts", "PRIVATE_SENTINEL");
	const pack = await build({
		policy: {
			executionMode: "EDIT",
			executionRunId: "run",
			allowedPaths: ["src", "test", ".env"],
			tools: [{ id: "runtime_read", operation: "read" }],
			configDigest: "config",
		},
		lsp: lsp({ references: [at("test/ORACLE.ts"), at("src/caller.ts")] }),
	});
	expect(pack.changedSymbols.map((item) => item.name)).toEqual(["label"]);
	expect(pack.callers.map((item) => item.path)).toEqual(["src/caller.ts"]);
	expect(JSON.stringify(pack)).not.toContain("PRIVATE_SENTINEL");
	expect(JSON.stringify(pack)).not.toContain("ORACLE");
});

it("canonicalizes real LSP normalization before count, byte and nested-child budgets", async () => {
	const files = new LspFiles(
		cwd,
		{
			executionMode: "READ_ONLY",
			executionRunId: "run",
			allowedPaths: ["src"],
			tools: [{ id: "runtime_read", operation: "read" }],
			configDigest: "config",
		},
		await FilePolicyPathInspector.open(cwd),
	);
	const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 20 } };
	const entries = Array.from({ length: 129 }, (_, index) => ({
		name: `s${String(index).padStart(3, "0")}`,
		kind: 12,
		range,
		selectionRange: range,
	}));
	const forward = await normalizeLsp("symbols", entries, "src/label.ts", files);
	expect(forward).toEqual(await normalizeLsp("symbols", [...entries].reverse(), "src/label.ts", files));
	expect(forward.truncated).toBeGreaterThan(0);
	const parent = { name: "parent", kind: 12, range, selectionRange: range };
	expect(await normalizeLsp("symbols", [{ ...parent, children: entries }], "src/label.ts", files)).toEqual(
		await normalizeLsp("symbols", [{ ...parent, children: [...entries].reverse() }], "src/label.ts", files),
	);
	const uri = pathToFileURL(join(cwd, "src/label.ts")).href;
	const references = entries.map((_, index) => ({
		uri,
		range: { start: { line: index, character: 0 }, end: { line: index, character: 1 } },
	}));
	expect(await normalizeLsp("references", references, "src/label.ts", files)).toEqual(
		await normalizeLsp("references", references.reverse(), "src/label.ts", files),
	);
	await expect(
		normalizeLsp(
			"symbols",
			[{ ...parent, selectionRange: { start: { line: 0, character: 21 }, end: { line: 0, character: 22 } } }],
			"src/label.ts",
			files,
		),
	).rejects.toThrow();
});

it("enforces document, symbol and relation-query budgets before further LSP work", async () => {
	const lines = Array.from({ length: 40 }, (_, index) => `export function f${index}() { return 1; }`);
	const after = `${lines.join("\n")}\n`,
		before = after.replaceAll("return 1", "return 0");
	const changes = Array.from({ length: 5 }, (_, index) => ({ path: `src/change${index}.ts`, before, after }));
	for (const change of changes) write(change.path, change.after);
	const queries = { documents: [] as string[], references: 0, definition: 0 };
	const port = lsp({ digest: fileDigest(after), references: [] });
	port.symbols = async ({ path }) => {
		queries.documents.push(path);
		return {
			...(await lsp({ digest: fileDigest(after) }).symbols({ path })),
			symbols: lines.map((text, index) => ({
				path,
				name: `f${index}`,
				kind: 12,
				depth: 0,
				line: index + 1,
				column: 17,
				endLine: index + 1,
				endColumn: 18 + String(index).length,
				range: { line: index + 1, column: 1, endLine: index + 1, endColumn: text.length + 1 },
			})),
		};
	};
	for (const kind of ["references", "definition"] as const) {
		const query = port[kind];
		port[kind] = (request) => {
			queries[kind]++;
			return query(request);
		};
	}
	const pack = await build({
		lsp: port,
		diff: {
			safe: true,
			diffDigest: "many-symbols",
			changedFiles: changes.map((item) => item.path),
			changedLines: 200,
			evidenceRefs: [],
			diff: JSON.stringify(changes),
		},
	});
	expect(queries).toEqual({ documents: changes.slice(0, 4).map((item) => item.path), references: 8, definition: 8 });
	expect(pack.changedSymbols).toHaveLength(32);
	expect(pack.truncated).toBe(true);
});

it("retains bounded partial locations as incomplete advisory context, not unavailable evidence", async () => {
	const pack = await build({ lsp: lsp({ status: "PARTIAL" }) });
	expect(pack.changedSymbols.map((item) => item.name)).toEqual(["label"]);
	expect(pack.callers.map((item) => item.path)).toEqual(["src/caller.ts", "test/label.test.ts"]);
	expect(pack.truncated).toBe(true);
});

it("deduplicates changed symbols and retains only explicit fields from related interface locations", async () => {
	write("src/api.ts", "export interface Label { run(): string; }\n");
	let queries = 0;
	const port = lsp({ symbols: [symbols[0], { ...symbols[0] }] });
	port.definition = async (request) => {
		queries++;
		return {
			...(await lsp().definition(request)),
			locations: [Object.assign(at("src/api.ts"), { rawSource: "PRIVATE_SENTINEL" })],
		};
	};
	const pack = await build({ lsp: port });
	expect(pack.changedSymbols.map((symbol) => symbol.name)).toEqual(["label"]);
	expect(queries).toBe(1);
	expect(pack.declarations).toEqual([
		{
			...at("src/api.ts"),
			symbolId: pack.changedSymbols[0].id,
			sourceDigest: fileDigest("export interface Label { run(): string; }\n"),
		},
	]);
	expect(JSON.stringify(pack)).not.toContain("PRIVATE_SENTINEL");
});
