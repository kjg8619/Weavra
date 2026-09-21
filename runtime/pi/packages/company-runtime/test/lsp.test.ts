import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LspClient } from "../src/lsp/client.ts";
import { lspPosition } from "../src/lsp/files.ts";
import { inspectLspServers, LspManager } from "../src/lsp/manager.ts";
import { encodeMessage, LspFramer, MAX_BUFFER_BYTES } from "../src/lsp/protocol.ts";
import type { LspConfig } from "../src/lsp/types.ts";
import type { PolicyContext } from "../src/policy.ts";

const fixture = fileURLToPath(new URL("./fixtures/lsp-server.mjs", import.meta.url));
let root: string, cwd: string, trace: string;
let managers: LspManager[];
const policy: PolicyContext = {
	executionMode: "READ_ONLY",
	executionRunId: "lsp",
	tools: [{ id: "runtime_read", operation: "read" }],
	allowedPaths: ["src", ".ai", ".git", ".env", "credentials"],
	configDigest: "test",
};
const request = { path: "src/한글.ts", line: 1, column: 2 };
function events(): Array<{
	pid: number;
	event: string;
	applied?: boolean;
	errorCode?: number;
	credentialsFiltered?: boolean;
	mutationDisabled?: boolean;
	position?: { line: number; character: number };
	text?: string;
	version?: number;
}> {
	return existsSync(trace)
		? readFileSync(trace, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line))
		: [];
}
function configuration(mode = "normal", timeout = 2000): LspConfig {
	return {
		enabled: true,
		servers: [
			{
				id: "fake",
				executable: process.execPath,
				args: [fixture, mode, trace, join(root, "crash-marker")],
				extensions: [".ts"],
				timeout_ms: timeout,
			},
		],
	};
}
async function manager(mode = "normal", timeout = 2000) {
	const value = await LspManager.create(cwd, configuration(mode, timeout), policy);
	managers.push(value);
	return value;
}
beforeEach(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "weavra-lsp-")));
	cwd = join(root, "workspace");
	trace = join(root, "trace.jsonl");
	managers = [];
	for (const dir of ["src", ".ai", ".git", "credentials"]) mkdirSync(join(cwd, dir), { recursive: true });
	for (const path of [
		"src/한글.ts",
		"src/target.ts",
		".ai/config.yaml",
		".git/config",
		".env",
		"credentials/token",
		"disallowed.ts",
	])
		writeFileSync(join(cwd, path), "const value = 1;\nvalue;\n");
	writeFileSync(join(root, "outside.ts"), "outside");
	symlinkSync(join(cwd, "src/target.ts"), join(cwd, "src/link.ts"));
});
afterEach(async () => {
	for (const value of managers) {
		await value.close();
		expect(value.safeToRelease).toBe(true);
	}
	for (const pid of new Set(events().map((event) => event.pid))) expect(() => process.kill(pid, 0)).toThrow();
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe("bounded JSON-RPC framing", () => {
	it("supports split headers/bodies and multiple UTF-8 messages", () => {
		const message = { jsonrpc: "2.0", id: 1, result: "한글😀" };
		const frame = encodeMessage(message);
		const parser = new LspFramer();
		const output: unknown[] = [];
		for (const byte of Buffer.concat([frame, frame])) output.push(...parser.push(Buffer.from([byte])));
		expect(output).toEqual([message, message]);
	});
	it.each([
		"Content-Length: -1",
		"Content-Length: +2",
		"Content-Length: 01",
		"Content-Length: 1.2",
		"Content-Length: nope",
		"Content-Length: 3\r\nContent-Length: 3",
		"Other: 3",
		"Content-Length: 999999999",
	])("rejects malformed/bounded header %s", (header) => {
		expect(() => new LspFramer().push(Buffer.from(`${header}\r\n\r\n{} `))).toThrow("LSP");
	});
	it.each(["{", "[]", '{"jsonrpc":"1.0"}', "null"])("rejects malformed JSON/envelope %s", (body) => {
		expect(() =>
			new LspFramer().push(Buffer.from(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)),
		).toThrow("PROTOCOL");
	});
	it("bounds headers, receive buffer and burst message count", () => {
		expect(() => new LspFramer().push(Buffer.alloc(4097, 65))).toThrow();
		expect(() => new LspFramer().push(Buffer.alloc(MAX_BUFFER_BYTES + 1))).toThrow("LIMIT");
		expect(() =>
			new LspFramer().push(
				Buffer.concat(Array.from({ length: 257 }, () => encodeMessage({ jsonrpc: "2.0", id: 1, result: null }))),
			),
		).toThrow("LIMIT");
	});
});

describe("run-scoped real stdio LSP", () => {
	it("lazily initializes, reuses one server, and shuts down/exits without orphan processes", async () => {
		vi.stubEnv("WEAVRA_TEST_SECRET", "not-inherited");
		const lsp = await manager();
		expect(events()).toEqual([]);
		const diagnostics = await lsp.diagnostics(request);
		expect(diagnostics.status).toBe("AVAILABLE");
		expect(diagnostics.diagnostics.map((item) => [item.line, item.column])).toEqual([
			[1, 1],
			[2, 1],
		]);
		expect(diagnostics.diagnostics[0]).toMatchObject({ path: request.path, severity: "error", code: "2322" });
		expect(diagnostics.diagnostics[0].message).toContain("\\u001b\\u202e");
		expect(diagnostics.reason).toContain("not a code-quality PASS/FAIL");
		expect((await lsp.definition(request)).locations).toEqual([
			{ path: "src/target.ts", line: 1, column: 1, endLine: 1, endColumn: 4 },
		]);
		expect((await lsp.references(request)).locations).toHaveLength(1);
		expect((await lsp.symbols(request)).symbols.map((item) => item.name)).toEqual(["inner", "漢字"]);
		expect(events().filter((event) => event.event === "start")).toHaveLength(1);
		expect(events().find((event) => event.event === "textDocument/definition")?.position).toEqual({
			line: 0,
			character: 1,
		});
		expect(events().find((event) => event.event === "capabilities")?.mutationDisabled).toBe(true);
		expect(events().find((event) => event.event === "start")?.credentialsFiltered).toBe(true);
		await lsp.close();
		await lsp.close();
		expect(events().map((event) => event.event)).toEqual(
			expect.arrayContaining(["initialize", "initialized", "shutdown", "exit"]),
		);
		await expect(lsp.symbols(request)).rejects.toThrow("closed");
	});
	it("uses fresh disk text and monotonic document versions for every request", async () => {
		const lsp = await manager();
		await lsp.symbols(request);
		writeFileSync(join(cwd, request.path), "const changed = 2;\n");
		await lsp.symbols(request);
		const docs = events().filter((event) => event.event === "document");
		expect(docs.map((doc) => doc.version)).toEqual([1, 2]);
		expect(docs[1].text).toContain("changed");
	});
	it("filters workspace escapes, protected/disallowed paths, remote URI and symlink results", async () => {
		const lsp = await manager("filtered");
		for (const query of [lsp.definition.bind(lsp), lsp.references.bind(lsp)]) {
			const result = await query(request);
			expect(result.status).toBe("PARTIAL");
			expect(result.withheld).toBe(8);
			expect(result.locations.map((location) => location.path)).toEqual(["src/target.ts"]);
			expect(JSON.stringify(result)).not.toMatch(/DO_NOT_LEAK|\.env|credentials|outside\.ts|file:\/\//);
		}
		const symbols = await lsp.symbols(request);
		expect(symbols.symbols).toEqual([]);
		expect(symbols.withheld).toBe(1);
		expect(JSON.stringify(symbols)).not.toContain("DO_NOT_LEAK");
	});
	it.each([".env", ".ai/config.yaml", "disallowed.ts", "src/link.ts", "../outside.ts"])(
		"denies input %s before spawn",
		async (path) => {
			const lsp = await manager();
			await expect(lsp.diagnostics({ path })).rejects.toThrow("denied");
			expect(events()).toEqual([]);
		},
	);
	it.each([
		{ line: 0, column: 1 },
		{ line: 1, column: 0 },
		{ line: 99, column: 1 },
		{ line: 1, column: 999 },
		{ line: 1.5, column: 1 },
	])("rejects invalid position %j before spawn", async (position) => {
		const lsp = await manager();
		await expect(lsp.definition({ ...request, ...position })).rejects.toThrow("position");
		expect(events()).toEqual([]);
	});
	it("defines columns as UTF-16 and rejects splitting a surrogate pair", () => {
		expect(lspPosition("漢😀x\r\nlast", 1, 4)).toEqual({ line: 0, character: 3 });
		expect(lspPosition("漢😀x\r\nlast", 2, 5)).toEqual({ line: 1, character: 4 });
		expect(() => lspPosition("漢😀x", 1, 3)).toThrow();
	});
	it("reports missing executable as UNAVAILABLE without starting/installing", async () => {
		const config = configuration();
		config.servers[0].executable = "weavra-nonexistent-language-server";
		const lsp = await LspManager.create(cwd, config, policy);
		managers.push(lsp);
		expect((await lsp.diagnostics(request)).status).toBe("UNAVAILABLE");
		expect(events()).toEqual([]);
		expect(await inspectLspServers(config)).toMatchObject([{ status: "UNAVAILABLE", process: "stopped" }]);
	});
	it("does not report a directory as a READY executable", async () => {
		const config = configuration();
		config.servers[0].executable = cwd;
		expect(await inspectLspServers(config)).toMatchObject([{ status: "UNAVAILABLE", process: "stopped" }]);
		const lsp = await LspManager.create(cwd, config, policy);
		managers.push(lsp);
		expect((await lsp.diagnostics(request)).status).toBe("UNAVAILABLE");
		expect(events()).toEqual([]);
	});
	it.each(["init-timeout", "request-timeout", "push-none", "push-stale"])(
		"%s times out without crash retry",
		async (mode) => {
			const lsp = await manager(mode, 250);
			const result = await lsp.diagnostics(request);
			expect(result.status).toBe("ERROR");
			expect(result.reason).toContain("TIMEOUT");
			expect(events().filter((event) => event.event === "start")).toHaveLength(1);
		},
	);
	it.each(["bad-length", "bad-json", "bad-error", "bad-method", "oversize", "bad-range"])(
		"%s fails closed without retry",
		async (mode) => {
			const lsp = await manager(mode);
			const result = await lsp.definition(request);
			expect(result.status).toBe("ERROR");
			expect(result.locations).toEqual([]);
			expect(events().filter((event) => event.event === "start")).toHaveLength(1);
		},
	);
	it.each(["crash-once", "crash-always", "closed-once"])(
		"typed %s is retried at most once then disposed",
		async (mode) => {
			const lsp = await manager(mode);
			const result = await lsp.diagnostics(request);
			expect(result.status).toBe(mode === "crash-always" ? "ERROR" : "AVAILABLE");
			expect(events().filter((event) => event.event === "start")).toHaveLength(2);
		},
	);
	it.each(["push-empty", "push-error"])("%s is PARTIAL, never invented PASS or complete diagnostics", async (mode) => {
		const result = await (await manager(mode)).diagnostics(request);
		expect(result.status).toBe("PARTIAL");
		expect(result.diagnostics).toHaveLength(mode === "push-empty" ? 0 : 1);
	});
	it("clean pull diagnostics mean query AVAILABLE, not code PASS", async () => {
		const result = await (await manager("clean")).diagnostics(request);
		expect(result.status).toBe("AVAILABLE");
		expect(result.diagnostics).toEqual([]);
	});
	it("bounds diagnostic counts and messages with explicit truncation", async () => {
		const result = await (await manager("many")).diagnostics(request);
		expect(result.status).toBe("PARTIAL");
		expect(result.truncated).toBeGreaterThan(0);
		expect(result.diagnostics.length).toBeLessThanOrEqual(128);
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(16384);
	});
	it("rejects workspace/applyEdit and unknown mutation requests without changing workspace bytes", async () => {
		const before = readFileSync(join(cwd, request.path));
		const lsp = await manager("apply-edit");
		await lsp.symbols(request);
		// Both rejection responses arrive asynchronously; wait for each of them instead of racing the second.
		await vi.waitFor(() => {
			const trace = events();
			expect(trace.some((event) => event.applied === false)).toBe(true);
			expect(trace.some((event) => event.errorCode === -32601)).toBe(true);
		});
		expect(readFileSync(join(cwd, request.path))).toEqual(before);
	});
	it("file change during query returns STALE without results or retry", async () => {
		const lsp = await manager("slow");
		const operation = lsp.definition(request);
		await vi.waitFor(() => expect(events().some((event) => event.event === "textDocument/definition")).toBe(true));
		writeFileSync(join(cwd, request.path), "external\n");
		const result = await operation;
		expect(result.status).toBe("STALE");
		expect(result.locations).toEqual([]);
		expect(readFileSync(join(cwd, request.path), "utf8")).toBe("external\n");
	});
	it("cancellation during initialize terminates the process without retry", async () => {
		const lsp = await manager("init-timeout");
		const controller = new AbortController();
		const operation = lsp.diagnostics({ ...request, signal: controller.signal });
		const rejected = expect(operation).rejects.toThrow();
		await vi.waitFor(() => expect(events().some((event) => event.event === "initialize")).toBe(true));
		controller.abort();
		await rejected;
		expect(lsp.safeToRelease).toBe(true);
		expect(events().filter((event) => event.event === "start")).toHaveLength(1);
	});
	it("close cancels an active request and refuses parallel query growth", async () => {
		const lsp = await manager("request-timeout");
		const operation = lsp.diagnostics(request);
		const rejected = expect(operation).rejects.toThrow();
		await expect(lsp.symbols(request)).rejects.toThrow("already active");
		await vi.waitFor(() => expect(events().some((event) => event.event === "textDocument/diagnostic")).toBe(true));
		await lsp.close();
		await rejected;
	});
	it.each(["ignore-shutdown", "descendant"])("cleanup escalates and reaps %s process group", async (mode) => {
		const lsp = await manager(mode);
		await lsp.symbols(request);
		if (mode === "descendant")
			await vi.waitFor(() => expect(events().filter((event) => event.event === "start")).toHaveLength(2));
		await lsp.close();
		expect(lsp.safeToRelease).toBe(true);
	});
	it("caps pending transport requests and exposes no rename/codeAction method", async () => {
		const client = new LspClient(cwd, process.execPath, [fixture, "request-timeout", trace]);
		try {
			await client.initialize(cwd, 2000, new AbortController().signal);
			for (const method of [
				"textDocument/rename",
				"textDocument/prepareRename",
				"textDocument/codeAction",
				"workspace/symbol",
				"textDocument/formatting",
			])
				await expect(client.request(method, {}, 2000)).rejects.toMatchObject({ code: "UNAVAILABLE" });
			const controller = new AbortController();
			const pending = Array.from({ length: 16 }, () =>
				client.request("textDocument/documentSymbol", {}, 2000, controller.signal).catch((error: unknown) => error),
			);
			await expect(client.request("textDocument/documentSymbol", {}, 2000)).rejects.toMatchObject({ code: "LIMIT" });
			controller.abort();
			await Promise.all(pending);
		} finally {
			await client.close();
			expect(client.safeToRelease).toBe(true);
		}
	});
});
