import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "../src/config.ts";
import type { PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import {
	buildTaskContextPack,
	CONTEXT_MAX_RELATED_FILES,
	extractLiteralTerms,
	summarizeTaskContextPack,
	TASK_CONTEXT_DOMAIN,
	taskContextPreservationScore,
} from "../src/task-context.ts";

let cwd: string;
let policy: PolicyContext;

const write = (path: string, content: string) => {
	mkdirSync(join(cwd, path, ".."), { recursive: true });
	writeFileSync(join(cwd, path), content);
};

async function build(overrides: Partial<Parameters<typeof buildTaskContextPack>[0]> = {}) {
	const inspector = await FilePolicyPathInspector.open(cwd);
	return await buildTaskContextPack({
		cwd,
		mode: "bounded",
		seedPaths: ["src/service.ts"],
		taskText: ["Rename `formatLabel` usage in src/service.ts"],
		paths: inspector,
		policy,
		protectedPaths: [".env", ".git", ".ai"],
		verifierSources: ["test/oracle.mjs"],
		listingRoots: ["src", "test"],
		...overrides,
	});
}

beforeEach(() => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-context-")));
	write(
		"src/service.ts",
		'import { formatLabel } from "./formatter.ts";\nexport const service = () => formatLabel("x");\n',
	);
	write("src/formatter.ts", "export function formatLabel(value: string): string {\n\treturn value.trim();\n}\n");
	write("test/service.test.ts", 'import { service } from "../src/service.ts";\nservice();\n');
	write("src/other.ts", "export const other = 1;\n");
	write(".env", "TOKEN=SUPER_SECRET_VALUE\n");
	write(".ai/config.yaml", "schemaVersion: 1\n");
	write("test/oracle.mjs", "export const oracle = 'ORACLE_SECRET_MARKER';\n");
	execFileSync("ln", ["-sf", join(cwd, ".env"), join(cwd, "src/link.ts")]);
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["add", "--", "."], { cwd });
	execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=E", "commit", "-qm", "init"], { cwd });
	policy = {
		executionMode: "EDIT",
		executionRunId: "run-1",
		tools: [],
		allowedPaths: ["src", "test"],
		protectedPaths: [".env", ".git", ".ai"],
		configDigest: "config",
	};
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("V0.5A task context pack", () => {
	it("defaults to disabled and validates the mode strictly", () => {
		const base = {
			schemaVersion: 1,
			models: { profiles: { coding: { provider: "p", model: "m" }, reasoning: { provider: "p", model: "m" } } },
		};
		expect(parseRuntimeConfig(JSON.stringify(base)).agents.context_pack).toEqual({ mode: "disabled" });
		expect(
			parseRuntimeConfig(JSON.stringify({ ...base, agents: { context_pack: { mode: "bounded" } } })).agents
				.context_pack,
		).toEqual({ mode: "bounded" });
		expect(() =>
			parseRuntimeConfig(JSON.stringify({ ...base, agents: { context_pack: { mode: "eager" } } })),
		).toThrow();
		expect(() =>
			parseRuntimeConfig(JSON.stringify({ ...base, agents: { context_pack: { mode: "bounded", budget: 99 } } })),
		).toThrow();
	});

	it("returns no pack in disabled mode", async () => {
		expect(await build({ mode: "disabled" })).toBeUndefined();
		expect(summarizeTaskContextPack(undefined)).toMatchObject({ mode: "disabled", digest: null, bytes: 0 });
	});

	it("includes the acceptance seed, same-stem test and literal reference with bounded provenance", async () => {
		const pack = (await build())!;
		const paths = pack.relatedFiles.map((file) => file.path);
		expect(paths).toContain("src/service.ts");
		expect(paths).toContain("test/service.test.ts");
		expect(pack.relatedFiles.find((file) => file.path === "src/service.ts")?.reasons).toContain("acceptance-scope");
		expect(pack.relatedFiles.find((file) => file.path === "test/service.test.ts")?.reasons).toContain(
			"same-stem-test",
		);
		expect(pack.snippets.length).toBeGreaterThan(0);
		for (const snippet of pack.snippets) {
			expect(snippet.path).toMatch(/^(src|test)\//);
			expect(snippet.startLine).toBeGreaterThan(0);
			expect(snippet.endLine).toBeGreaterThanOrEqual(snippet.startLine);
			expect(snippet.fileDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(snippet.snippetDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
		expect(pack.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(pack.truncated).toBe(false);
	});

	it("never includes protected, oracle or symlinked paths in files, snippets or the digest", async () => {
		const pack = (await build())!;
		const serialized = JSON.stringify(pack);
		expect(serialized).not.toContain(".env");
		expect(serialized).not.toContain(".ai/config.yaml");
		expect(serialized).not.toContain("oracle.mjs");
		expect(serialized).not.toContain("link.ts");
		expect(serialized).not.toContain("SUPER_SECRET_VALUE");
		expect(serialized).not.toContain("ORACLE_SECRET_MARKER");
	});

	it("keeps the digest deterministic for the same pack and independent of discovery order", async () => {
		const first = (await build())!;
		const second = (await build({ seedPaths: ["src/service.ts"] }))!;
		expect(second.digest).toBe(first.digest);
		expect(second.digest).not.toContain("rr1:");
		expect(first.relatedFiles.map((file) => file.path)).toEqual(
			[...first.relatedFiles.map((file) => file.path)].sort(),
		);
	});

	it("changes the digest when a selected file's content changes", async () => {
		const before = (await build())!;
		write("src/service.ts", "export const service = 42;\n");
		const after = (await build())!;
		expect(after.digest).not.toBe(before.digest);
	});

	const lspResult = (status: string, extra: Record<string, unknown> = {}) => ({
		serverId: "fixture",
		status,
		reason: "fixture",
		startedAt: 1,
		finishedAt: 2,
		withheld: 0,
		truncated: 0,
		...extra,
	});

	it("adopts AVAILABLE symbols and references with real positions", async () => {
		let symbolQueries = 0;
		let referenceQueries = 0;
		const lsp = {
			symbols: async (request: { path: string }) => {
				symbolQueries += 1;
				return lspResult("AVAILABLE", {
					symbols: [
						{
							path: request.path,
							line: 1,
							column: 17,
							endLine: 1,
							endColumn: 28,
							name: "formatLabel",
							kind: 12,
							depth: 0,
						},
						{
							path: request.path,
							line: 2,
							column: 1,
							endLine: 2,
							endColumn: 5,
							name: "unrelated",
							kind: 13,
							depth: 0,
						},
					],
				}) as never;
			},
			references: async () => {
				referenceQueries += 1;
				return lspResult("AVAILABLE", {
					locations: [
						{ path: "src/service.ts", line: 2, column: 26, endLine: 2, endColumn: 37 },
						{ path: "src/formatter.ts", line: 1, column: 1, endLine: 1, endColumn: 5 },
					],
				}) as never;
			},
		};
		const pack = (await build({ lsp }))!;
		// The fake server reports the same symbol for every queried document, so every entry carries the
		// real position contract (1-based line/column, UTF-16 columns as reported).
		expect(pack.targetSymbols.length).toBeGreaterThan(0);
		for (const symbol of pack.targetSymbols) {
			expect(symbol).toMatchObject({
				name: "formatLabel",
				kind: 12,
				line: 1,
				column: 17,
				endLine: 1,
				endColumn: 28,
				reason: "lsp-symbol",
			});
			expect(symbol.path).toMatch(/^(src|test)\//);
		}
		expect(pack.targetSymbols.every((symbol) => symbol.name !== "unrelated")).toBe(true);
		expect(pack.relatedFiles.find((file) => file.path === "src/formatter.ts")?.reasons).toContain("lsp-reference");
		expect(symbolQueries).toBeGreaterThan(0);
		expect(referenceQueries).toBe(pack.targetSymbols.length);
	});

	it("is order-insensitive for symbols and references", async () => {
		const makeLsp = (reverse: boolean) => ({
			symbols: async (request: { path: string }) =>
				lspResult("AVAILABLE", {
					symbols: [
						{
							path: request.path,
							line: 1,
							column: 17,
							endLine: 1,
							endColumn: 28,
							name: "formatLabel",
							kind: 12,
							depth: 0,
						},
					],
				}) as never,
			references: async () => {
				const locations = [
					{ path: "src/service.ts", line: 2, column: 26, endLine: 2, endColumn: 37 },
					{ path: "src/formatter.ts", line: 1, column: 1, endLine: 1, endColumn: 5 },
				];
				return lspResult("AVAILABLE", { locations: reverse ? locations.reverse() : locations }) as never;
			},
		});
		const forward = (await build({ lsp: makeLsp(false) }))!;
		const reversed = (await build({ lsp: makeLsp(true) }))!;
		expect(reversed.digest).toBe(forward.digest);
		expect(reversed.targetSymbols).toEqual(forward.targetSymbols);
		expect(reversed.relatedFiles).toEqual(forward.relatedFiles);
	});

	it("degrades honestly for every non-AVAILABLE LSP status", async () => {
		const of = (status: string, extra: Record<string, unknown> = {}) => ({
			symbols: async (request: { path: string }) =>
				lspResult(status, {
					symbols: [
						{
							path: request.path,
							line: 1,
							column: 17,
							endLine: 1,
							endColumn: 28,
							name: "formatLabel",
							kind: 12,
							depth: 0,
						},
					],
					...extra,
				}) as never,
			references: async () =>
				lspResult(status, {
					locations: [{ path: "src/formatter.ts", line: 1, column: 1, endLine: 1, endColumn: 5 }],
				}) as never,
		});
		const unavailable = (await build({ lsp: of("UNAVAILABLE") }))!;
		expect(unavailable.targetSymbols).toEqual([]);
		expect(unavailable.unknowns.join(" ")).toContain("lsp symbols unavailable");

		const partial = (await build({ lsp: of("PARTIAL") }))!;
		expect(partial.truncated).toBe(true);
		expect(partial.unknowns.join(" ")).toContain("lsp symbols partial");

		const stale = (await build({ lsp: of("STALE") }))!;
		expect(stale.targetSymbols).toEqual([]);
		expect(stale.unknowns.join(" ")).toContain("lsp symbols stale");

		const errored = (await build({ lsp: of("ERROR") }))!;
		expect(errored.unknowns.join(" ")).toContain("lsp symbols error");

		const withheld = (await build({ lsp: of("AVAILABLE", { withheld: 2 }) }))!;
		expect(withheld.truncated).toBe(true);
		expect(withheld.unknowns.join(" ")).toContain("partially withheld");
	});

	it("filters protected, oracle and symlinked reference paths", async () => {
		execFileSync("ln", ["-sf", join(cwd, ".env"), join(cwd, "src/ref-link.ts")]);
		const lsp = {
			symbols: async (request: { path: string }) =>
				lspResult("AVAILABLE", {
					symbols: [
						{
							path: request.path,
							line: 1,
							column: 17,
							endLine: 1,
							endColumn: 28,
							name: "formatLabel",
							kind: 12,
							depth: 0,
						},
					],
				}) as never,
			references: async () =>
				lspResult("AVAILABLE", {
					locations: [
						{ path: ".env", line: 1, column: 1, endLine: 1, endColumn: 2 },
						{ path: "test/oracle.mjs", line: 1, column: 1, endLine: 1, endColumn: 2 },
						{ path: "src/ref-link.ts", line: 1, column: 1, endLine: 1, endColumn: 2 },
						{ path: "src/formatter.ts", line: 1, column: 1, endLine: 1, endColumn: 5 },
					],
				}) as never,
		};
		const pack = (await build({ lsp }))!;
		const serialized = JSON.stringify(pack);
		expect(serialized).not.toContain(".env");
		expect(serialized).not.toContain("oracle.mjs");
		expect(serialized).not.toContain("ref-link.ts");
		expect(pack.relatedFiles.find((file) => file.path === "src/formatter.ts")?.reasons).toContain("lsp-reference");
	});

	it("keeps symbol document and reference query budgets bounded", async () => {
		const roots = ["src", "test"];
		for (let index = 0; index < 6; index += 1) write(`src/extra${index}.ts`, "export const formatLabel = 1;\n");
		let symbolQueries = 0;
		let referenceQueries = 0;
		const lsp = {
			symbols: async (request: { path: string }) => {
				symbolQueries += 1;
				return lspResult("AVAILABLE", {
					symbols: Array.from({ length: 20 }, () => ({
						path: request.path,
						line: 1,
						column: 17,
						endLine: 1,
						endColumn: 28,
						name: "formatLabel",
						kind: 12,
						depth: 0,
					})),
				}) as never;
			},
			references: async () => {
				referenceQueries += 1;
				return lspResult("AVAILABLE", { locations: [] }) as never;
			},
		};
		const pack = (await build({ lsp, listingRoots: roots }))!;
		expect(symbolQueries).toBeLessThanOrEqual(4);
		expect(referenceQueries).toBeLessThanOrEqual(8);
		expect(pack.targetSymbols.length).toBeLessThanOrEqual(32);
	});

	it("rethrows cleanup failures instead of hiding them as unknowns", async () => {
		const { ProcessCleanupError } = await import("../src/process-runner.ts");
		const cleanupError = {
			symbols: async () => {
				throw new ProcessCleanupError();
			},
			references: async () => lspResult("AVAILABLE", { locations: [] }) as never,
		};
		await expect(build({ lsp: cleanupError })).rejects.toBeInstanceOf(ProcessCleanupError);

		const failed = {
			symbols: async () => lspResult("AVAILABLE", { symbols: [] }) as never,
			references: async () => lspResult("AVAILABLE", { locations: [] }) as never,
			cleanupFailed: true,
		};
		await expect(build({ lsp: failed })).rejects.toBeInstanceOf(ProcessCleanupError);
	});

	it("enforces the related-file and snippet budgets", async () => {
		for (let index = 0; index < 40; index += 1)
			write(`src/gen${String(index).padStart(2, "0")}.ts`, "export const formatLabel = 1;\n");
		await build();
		const pack = (await build({
			seedPaths: [
				"src/service.ts",
				...Array.from({ length: 40 }, (_, index) => `src/gen${String(index).padStart(2, "0")}.ts`),
			],
		}))!;
		expect(pack.relatedFiles.length).toBeLessThanOrEqual(CONTEXT_MAX_RELATED_FILES);
		expect(pack.snippets.length).toBeLessThanOrEqual(12);
		expect(pack.truncated).toBe(true);
		expect(Buffer.byteLength(JSON.stringify(pack), "utf8")).toBeLessThanOrEqual(49152);
	});

	it("derives default listing roots from allowed paths instead of the workspace root", async () => {
		write("docs/note.md", "formatLabel lives here but docs are outside the allowed roots\n");
		const pack = (await build({ listingRoots: undefined }))!;
		const paths = pack.relatedFiles.map((file) => file.path);
		expect(paths.some((path) => path.startsWith("docs/"))).toBe(false);
		expect(paths).toContain("src/service.ts");
	});

	it("degrades to an honest empty pack when no listable allowed root exists", async () => {
		const emptyPolicy: PolicyContext = { ...policy, allowedPaths: [] };
		const pack = (await build({ policy: emptyPolicy, listingRoots: undefined }))!;
		expect(pack.relatedFiles).toEqual([]);
		expect(pack.snippets).toEqual([]);
		expect(pack.targetSymbols).toEqual([]);
		expect(pack.truncated).toBe(false);
		expect(pack.unknowns).toContain("no listable allowed roots");
		expect(pack.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
	});

	it("denies lexical symlink seeds and symlinked parent directories", async () => {
		write("src/real.ts", "export const formatLabel = 1;\n");
		execFileSync("ln", ["-sf", "real.ts", join(cwd, "src/lexical.ts")]);
		mkdirSync(join(cwd, "src/linked-dir"), { recursive: true });
		execFileSync("ln", ["-sfn", "real.ts", join(cwd, "src/linked-dir/inner.ts")]);
		execFileSync("ln", ["-sfn", join(cwd, "src"), join(cwd, "src/dir-link")]);
		const pack = (await build({ seedPaths: ["src/lexical.ts", "src/dir-link/real.ts"] }))!;
		const serialized = JSON.stringify(pack);
		expect(pack.relatedFiles.some((file) => file.path.includes("lexical.ts"))).toBe(false);
		expect(serialized).not.toContain("dir-link");
		// real.ts is a legitimate allowed file; only the symlinked paths must never appear.
		expect(pack.relatedFiles.every((file) => file.path === "src/real.ts" || !file.path.includes("lexical"))).toBe(
			true,
		);
	});

	it("hard-caps the whole canonical pack at 48 KiB with deterministic trimming", async () => {
		for (let index = 0; index < 20; index += 1) {
			const filler = Array.from({ length: 200 }, (_, line) => `// formatLabel line ${line} ${"x".repeat(60)}`).join(
				"\n",
			);
			write(`src/big${String(index).padStart(2, "0")}.ts`, `${filler}\nexport const value = formatLabel;\n`);
		}
		const seeds = Array.from({ length: 20 }, (_, index) => `src/big${String(index).padStart(2, "0")}.ts`);
		const first = (await build({ seedPaths: ["src/service.ts", ...seeds] }))!;
		const second = (await build({ seedPaths: ["src/service.ts", ...seeds] }))!;
		expect(Buffer.byteLength(JSON.stringify(first), "utf8")).toBeLessThanOrEqual(49152);
		expect(first.truncated).toBe(true);
		expect(first.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(second.digest).toBe(first.digest);
	});

	it("never returns an oversized pack even when every entry is a high-priority seed", async () => {
		// Pre-trim pressure: long allowed paths, 24 acceptance seeds, changed/review seeds, big snippets,
		// projectRules metadata and unknown pressure.
		const longRoot = `src/${"very-long-directory-name-".repeat(6)}`;
		const longPolicy: PolicyContext = { ...policy, allowedPaths: ["src", longRoot] };
		mkdirSync(join(cwd, longRoot), { recursive: true });
		const seeds: string[] = [];
		for (let index = 0; index < 24; index += 1) {
			const path = `${longRoot}/service-${String(index).padStart(2, "0")}.ts`;
			write(path, `export const formatLabel = "${"y".repeat(300)}";\n`);
			seeds.push(path);
		}
		const changed = Array.from({ length: 12 }, (_, index) => {
			const path = `${longRoot}/changed-${String(index).padStart(2, "0")}.ts`;
			write(path, "export const formatLabel = 1;\n");
			return path;
		});
		const reviewed = Array.from({ length: 12 }, (_, index) => {
			const path = `${longRoot}/reviewed-${String(index).padStart(2, "0")}.ts`;
			write(path, `// ${"z".repeat(400)} formatLabel\n`);
			return path;
		});
		const pack = (await build({
			policy: longPolicy,
			listingRoots: [longRoot],
			seedPaths: seeds,
			changedFiles: changed,
			previousReviewFiles: reviewed,
			projectInstruction: { path: "AGENTS.md", digest: `sha256:${"a".repeat(64)}`, bytes: 4096 },
		}))!;
		const size = Buffer.byteLength(JSON.stringify(pack), "utf8");
		expect(size).toBeLessThanOrEqual(49152);
		expect(pack.truncated).toBe(true);
		expect(pack.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		// Repeated builds stay deterministic after trimming.
		const again = (await build({
			policy: longPolicy,
			listingRoots: [longRoot],
			seedPaths: seeds,
			changedFiles: changed,
			previousReviewFiles: reviewed,
			projectInstruction: { path: "AGENTS.md", digest: `sha256:${"a".repeat(64)}`, bytes: 4096 },
		}))!;
		expect(again.digest).toBe(pack.digest);
		expect(JSON.stringify(again)).not.toContain("very-long-directory-name-".repeat(20));
	});

	it("ranks acceptance-scope above heuristic relations when trimming", () => {
		expect(taskContextPreservationScore(["acceptance-scope"])).toBeGreaterThan(
			taskContextPreservationScore(["same-stem-test"]),
		);
		expect(taskContextPreservationScore(["acceptance-scope", "same-stem-test"])).toBe(
			taskContextPreservationScore(["acceptance-scope"]),
		);
		expect(taskContextPreservationScore(["changed-file"])).toBeGreaterThan(
			taskContextPreservationScore(["literal-reference"]),
		);
		expect(taskContextPreservationScore([])).toBe(-1);
	});

	it("terminates deterministically when the minimal pack itself cannot fit", async () => {
		const hugePath = `${"p".repeat(60000)}/AGENTS.md`;
		// A metadata shape that cannot fit even as a minimal pack must fail closed, never loop forever.
		await expect(
			build({ projectInstruction: { path: hugePath, digest: `sha256:${"a".repeat(64)}`, bytes: 1 } }),
		).rejects.toThrow("Task context pack exceeds its byte cap even without optional context");
	});

	it("binds project-rule metadata into the pack digest without copying the instruction body", async () => {
		const withRules = (await build({
			projectInstruction: { path: "AGENTS.md", digest: `sha256:${"a".repeat(64)}`, bytes: 12 },
		}))!;
		const otherRules = (await build({
			projectInstruction: { path: "AGENTS.md", digest: `sha256:${"b".repeat(64)}`, bytes: 12 },
		}))!;
		expect(withRules.projectRules).toEqual({
			kind: "configured-file",
			path: "AGENTS.md",
			digest: `sha256:${"a".repeat(64)}`,
			bytes: 12,
		});
		expect(otherRules.digest).not.toBe(withRules.digest);
		expect(JSON.stringify(withRules)).not.toContain("PROJECT_PRIVATE_MARKER");
	});

	it("extracts only deterministic literal terms", () => {
		const terms = extractLiteralTerms([
			"Rename `formatLabel` in src/service.ts",
			"keep camelCaseThing and a plain sentence",
		]);
		expect(terms).toContain("formatLabel");
		expect(terms).toContain("camelCaseThing");
		expect(terms).toContain("service.ts");
		expect(terms.every((term) => term.length >= 3)).toBe(true);
		expect(extractLiteralTerms(["a plain english sentence with no identifiers"])).toEqual([]);
		expect(TASK_CONTEXT_DOMAIN).toBe("weavra-task-context-pack-v1");
		expect(readFileSync(join(cwd, ".env"), "utf8")).toContain("SUPER_SECRET_VALUE");
	});
});
