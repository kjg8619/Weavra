import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerTools, WORKER_FILE_TOOLS } from "../src/agent-tools.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import type { PolicyDecision } from "../src/contracts.ts";
import type { ActionAudit, PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import type { AgentExecutionRequest } from "../src/ports.ts";
import { testContract } from "./fixture-contract.ts";

function configOf(mutation?: "compatible" | "strict") {
	return parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "coding" },
				},
			},
			files: { allowed_paths: ["src", "docs 한글"] },
			...(mutation ? { mutation: { mode: mutation } } : {}),
		}),
	);
}

let cwd: string;
let policy: PolicyContext;
let request: AgentExecutionRequest;
let audit: ActionAudit;
let decisions: PolicyDecision[];
let controller: AbortController;
let onPrepare: (() => void) | undefined;
let worker: ReturnType<typeof createWorkerTools>;

const bytes = (path = "src/app.ts") => readFileSync(join(cwd, path));

async function create(mutation?: "compatible" | "strict") {
	worker = createWorkerTools({
		cwd,
		request,
		config: configOf(mutation),
		policy,
		audit,
		signal: controller.signal,
		paths: await FilePolicyPathInspector.open(cwd),
		assertActive: () => {},
	});
}

async function call(name: string, params: Record<string, unknown>, id = "call") {
	const tool = worker.tools.find((candidate) => candidate.name === name);
	if (!tool) throw new Error("Tool unavailable");
	const result = await tool.execute(id, params, controller.signal, undefined, {} as ExtensionContext);
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

/** Strict read: returns the exact tokens the model must copy into the mutation. */
async function strictRead(path = "src/app.ts") {
	const output = await call("runtime_read", { path, anchors: true });
	const [digestLine, firstRow] = output.split("\n");
	return {
		fileDigest: digestLine.slice("fileDigest: ".length),
		readReceipt: output.split("\nreadReceipt: ")[1],
		anchor: firstRow.split(" ")[0],
		line: (number: number) => output.split("\n")[number].split(" ")[0],
		raw: output,
	};
}

beforeEach(async () => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-strict-")));
	mkdirSync(join(cwd, "src"));
	mkdirSync(join(cwd, "docs 한글"));
	writeFileSync(join(cwd, "src/app.ts"), "foo()\nfoo()\n");
	writeFileSync(join(cwd, "src/other.ts"), "foo()\nfoo()\n");
	controller = new AbortController();
	decisions = [];
	onPrepare = undefined;
	audit = {
		prepare: vi.fn(async (decision) => {
			decisions.push(decision);
			const hook = onPrepare;
			onPrepare = undefined;
			hook?.();
		}),
		finish: vi.fn(async () => {}),
		assertWritable: vi.fn(async () => {}),
	};
	request = {
		executionMode: "EDIT",
		runId: "run",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		task: testContract("Fix typo in src/app.ts", { taskId: "task", statements: ["fix"], workflow: "STANDARD" }),
		role: "Developer",
		profile: "coding",
	};
	policy = {
		executionMode: "EDIT",
		executionRunId: "run",
		tools: WORKER_FILE_TOOLS,
		allowedPaths: ["src", "docs 한글"],
		configDigest: "frozen-policy",
	};
	await create();
});

afterEach(() => {
	vi.restoreAllMocks();
	rmSync(cwd, { recursive: true, force: true });
});

describe("V0.4A mutation mode configuration", () => {
	it("keeps compatible as the default and accepts exactly two modes", () => {
		expect(configOf().mutation).toEqual({ mode: "compatible" });
		expect(configOf("compatible").mutation).toEqual({ mode: "compatible" });
		expect(configOf("strict").mutation).toEqual({ mode: "strict" });
		expect(() =>
			parseRuntimeConfig(
				JSON.stringify({
					schemaVersion: 1,
					models: {
						profiles: { coding: { provider: "p", model: "m" }, reasoning: { provider: "p", model: "m" } },
					},
					mutation: { mode: "paranoid" },
				}),
			),
		).toThrow();
		expect(() =>
			parseRuntimeConfig(
				JSON.stringify({
					schemaVersion: 1,
					models: {
						profiles: { coding: { provider: "p", model: "m" }, reasoning: { provider: "p", model: "m" } },
					},
					mutation: { mode: "strict", extra: true },
				}),
			),
		).toThrow();
	});
});

describe("V0.4A strict read receipts", () => {
	it("returns an opaque receipt bound to the file digest and never reuses token values", async () => {
		await create("strict");
		const first = await strictRead();
		expect(first.raw).toContain(`fileDigest: ${first.fileDigest}`);
		expect(first.fileDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(first.readReceipt).toMatch(/^rr1:[0-9a-f]{48}$/);
		const second = await strictRead();
		expect(second.readReceipt).not.toBe(first.readReceipt);
		expect(second.fileDigest).toBe(first.fileDigest);
	});

	it("does not add a receipt in compatible mode", async () => {
		expect(await call("runtime_read", { path: "src/app.ts", anchors: true })).not.toContain("readReceipt");
	});
});

describe("V0.4A strict runtime_edit", () => {
	it("edits the anchored line with receipt, digest and anchor", async () => {
		await create("strict");
		const read = await strictRead();
		await call("runtime_edit", {
			path: "src/app.ts",
			oldText: "foo()",
			newText: "bar()",
			anchor: read.line(2),
			fileDigest: read.fileDigest,
			readReceipt: read.readReceipt,
		});
		expect(bytes().toString()).toBe("foo()\nbar()\n");
	});

	it("rejects a mutation without a receipt and writes nothing", async () => {
		await create("strict");
		const read = await strictRead();
		await expect(
			call("runtime_edit", {
				path: "src/app.ts",
				oldText: "foo()",
				newText: "bar()",
				anchor: read.line(1),
				fileDigest: read.fileDigest,
			}),
		).rejects.toThrow("requires anchor, fileDigest and readReceipt");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});

	it("never falls back to the legacy unanchored edit", async () => {
		await create("strict");
		await expect(call("runtime_edit", { path: "src/app.ts", oldText: "foo()", newText: "bar()" })).rejects.toThrow(
			"requires anchor, fileDigest and readReceipt",
		);
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});

	it("rejects fabricated receipts even when the digest and anchor are correct", async () => {
		await create("strict");
		const read = await strictRead();
		await expect(
			call("runtime_edit", {
				path: "src/app.ts",
				oldText: "foo()",
				newText: "bar()",
				anchor: read.line(1),
				fileDigest: read.fileDigest,
				readReceipt: `rr1:${"0".repeat(48)}`,
			}),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});

	it("rejects a receipt issued for another path", async () => {
		await create("strict");
		const other = await strictRead("src/other.ts");
		await expect(
			call("runtime_edit", {
				path: "src/app.ts",
				oldText: "foo()",
				newText: "bar()",
				anchor: other.line(1),
				fileDigest: other.fileDigest,
				readReceipt: other.readReceipt,
			}),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
		expect(bytes("src/other.ts").toString()).toBe("foo()\nfoo()\n");
	});

	it("keeps only the latest receipt per path", async () => {
		await create("strict");
		const first = await strictRead();
		const second = await strictRead();
		await expect(
			call("runtime_edit", {
				path: "src/app.ts",
				oldText: "foo()",
				newText: "bar()",
				anchor: first.line(1),
				fileDigest: first.fileDigest,
				readReceipt: first.readReceipt,
			}),
		).rejects.toThrow("STALE_ANCHOR");
		await call("runtime_edit", {
			path: "src/app.ts",
			oldText: "foo()",
			newText: "bar()",
			anchor: second.line(1),
			fileDigest: second.fileDigest,
			readReceipt: second.readReceipt,
		});
		expect(bytes().toString()).toBe("bar()\nfoo()\n");
	});

	it("requires a fresh read after a successful mutation", async () => {
		await create("strict");
		const read = await strictRead();
		const params = {
			path: "src/app.ts",
			oldText: "foo()",
			newText: "bar()",
			anchor: read.line(1),
			fileDigest: read.fileDigest,
			readReceipt: read.readReceipt,
		};
		await call("runtime_edit", params);
		expect(bytes().toString()).toBe("bar()\nfoo()\n");
		// The same receipt must not authorize a second mutation.
		await expect(call("runtime_edit", { ...params, anchor: read.line(2) })).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("bar()\nfoo()\n");
		const reread = await strictRead();
		await call("runtime_edit", {
			path: "src/app.ts",
			oldText: "foo()",
			newText: "baz()",
			anchor: reread.line(2),
			fileDigest: reread.fileDigest,
			readReceipt: reread.readReceipt,
		});
		expect(bytes().toString()).toBe("bar()\nbaz()\n");
	});

	it("treats an external change after the read as stale and preserves the external bytes", async () => {
		await create("strict");
		const read = await strictRead();
		writeFileSync(join(cwd, "src/app.ts"), "external()\nfoo()\n");
		await expect(
			call("runtime_edit", {
				path: "src/app.ts",
				oldText: "foo()",
				newText: "bar()",
				anchor: read.line(1),
				fileDigest: read.fileDigest,
				readReceipt: read.readReceipt,
			}),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("external()\nfoo()\n");
	});
});

describe("V0.4A strict runtime_write create", () => {
	it("creates a new file without a receipt", async () => {
		await create("strict");
		await call("runtime_write", {
			path: "src/new.ts",
			content: "created\n",
			operation: "create",
			mustNotExist: true,
		});
		expect(bytes("src/new.ts").toString()).toBe("created\n");
	});

	it("never overwrites an existing file and leaves its bytes untouched", async () => {
		await create("strict");
		await expect(
			call("runtime_write", {
				path: "src/app.ts",
				content: "replacement\n",
				operation: "create",
				mustNotExist: true,
			}),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});

	it("rejects create without mustNotExist or with replace-only fields", async () => {
		await create("strict");
		await expect(call("runtime_write", { path: "src/new.ts", content: "x", operation: "create" })).rejects.toThrow(
			"mustNotExist",
		);
		const read = await strictRead();
		await expect(
			call("runtime_write", {
				path: "src/new.ts",
				content: "x",
				operation: "create",
				mustNotExist: true,
				readReceipt: read.readReceipt,
				fileDigest: read.fileDigest,
			}),
		).rejects.toThrow("must not carry readReceipt or fileDigest");
		expect(() => bytes("src/new.ts")).toThrow();
	});

	it("fails the exclusive create when an external process wins the race", async () => {
		await create("strict");
		onPrepare = () => writeFileSync(join(cwd, "src/race.ts"), "external\n");
		await expect(
			call("runtime_write", { path: "src/race.ts", content: "weavra\n", operation: "create", mustNotExist: true }),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes("src/race.ts").toString()).toBe("external\n");
	});

	it("does not create parent directories", async () => {
		await create("strict");
		await expect(
			call("runtime_write", { path: "src/missing/new.ts", content: "x", operation: "create", mustNotExist: true }),
		).rejects.toThrow();
		expect(() => bytes("src/missing/new.ts")).toThrow();
	});
});

describe("V0.4A strict runtime_write replace", () => {
	it("replaces an existing file with a fresh receipt and digest", async () => {
		await create("strict");
		const read = await strictRead();
		await call("runtime_write", {
			path: "src/app.ts",
			content: "replaced\n",
			operation: "replace",
			readReceipt: read.readReceipt,
			fileDigest: read.fileDigest,
		});
		expect(bytes().toString()).toBe("replaced\n");
	});

	it("rejects replace without a receipt and without operation", async () => {
		await create("strict");
		await expect(call("runtime_write", { path: "src/app.ts", content: "x" })).rejects.toThrow(
			"requires operation create or replace",
		);
		await expect(
			call("runtime_write", {
				path: "src/app.ts",
				content: "x",
				operation: "replace",
				fileDigest: "sha256:0",
			}),
		).rejects.toThrow("no current read receipt");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});

	it("rejects mustNotExist on replace and mismatched digests", async () => {
		await create("strict");
		const read = await strictRead();
		await expect(
			call("runtime_write", {
				path: "src/app.ts",
				content: "x",
				operation: "replace",
				mustNotExist: true,
				readReceipt: read.readReceipt,
				fileDigest: read.fileDigest,
			}),
		).rejects.toThrow("must not carry mustNotExist");
		await expect(
			call("runtime_write", {
				path: "src/app.ts",
				content: "x",
				operation: "replace",
				readReceipt: read.readReceipt,
				fileDigest: `sha256:${"0".repeat(64)}`,
			}),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});

	it("never creates a missing replace target", async () => {
		await create("strict");
		await expect(
			call("runtime_write", {
				path: "src/gone.ts",
				content: "x",
				operation: "replace",
				readReceipt: "rr1:missing",
				fileDigest: `sha256:${"0".repeat(64)}`,
			}),
		).rejects.toThrow("no current read receipt");
		expect(() => bytes("src/gone.ts")).toThrow();
	});

	it("treats an external change between read and replace as stale and preserves the bytes", async () => {
		await create("strict");
		const read = await strictRead();
		onPrepare = () => writeFileSync(join(cwd, "src/app.ts"), "external\n");
		await expect(
			call("runtime_write", {
				path: "src/app.ts",
				content: "weavra\n",
				operation: "replace",
				readReceipt: read.readReceipt,
				fileDigest: read.fileDigest,
			}),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("external\n");
	});

	it("requires a fresh read after a successful replace", async () => {
		await create("strict");
		const read = await strictRead();
		const params = {
			path: "src/app.ts",
			content: "replaced\n",
			operation: "replace",
			readReceipt: read.readReceipt,
			fileDigest: read.fileDigest,
		};
		await call("runtime_write", params);
		await expect(call("runtime_write", params)).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("replaced\n");
	});
});

describe("V0.4A compatible mode regression", () => {
	it("keeps legacy write replacement and unanchored exact edit", async () => {
		await call("runtime_write", { path: "src/app.ts", content: "legacy\n" });
		expect(bytes().toString()).toBe("legacy\n");
		await call("runtime_write", { path: "src/app.ts", content: "only()\n" });
		await call("runtime_edit", { path: "src/app.ts", oldText: "only()", newText: "bar()" });
		expect(bytes().toString()).toBe("bar()\n");
	});

	it("rejects strict-only fields outside strict mode", async () => {
		await expect(call("runtime_write", { path: "src/app.ts", content: "x", operation: "replace" })).rejects.toThrow(
			"require mutation.mode: strict",
		);
		await expect(
			call("runtime_edit", { path: "src/app.ts", oldText: "foo()", newText: "bar()", readReceipt: "rr1:x" }),
		).rejects.toThrow("readReceipt requires mutation.mode: strict");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});
});

describe("V0.4A strict text fidelity and paths", () => {
	it("preserves BOM, CRLF, tabs, CJK, emoji and long lines through strict replace", async () => {
		await create("strict");
		const original = `\ufeff漢字\t\x1b\r\n한글 😀\r\n${"x".repeat(5000)}\r\n`;
		writeFileSync(join(cwd, "src/text.ts"), original);
		const read = await strictRead("src/text.ts");
		await call("runtime_write", {
			path: "src/text.ts",
			content: original.replace("한글 😀", "한글 🎉"),
			operation: "replace",
			readReceipt: read.readReceipt,
			fileDigest: read.fileDigest,
		});
		expect(bytes("src/text.ts").toString("utf8")).toBe(original.replace("한글 😀", "한글 🎉"));
	});

	it("keeps strict mutation inside the QUICK/R1 single-file scope", async () => {
		request = {
			executionMode: "EDIT",
			runId: "run",
			revision: 0,
			step: { stepId: "implement", attempt: 1 },
			task: testContract("Fix typo in src/app.ts", { taskId: "task", statements: ["fix"], workflow: "QUICK" }),
			role: "Executor",
			profile: "coding",
			scope: { risk: "R1", targetPath: "src/new.ts" },
		};
		policy = { ...policy, executorScope: request.scope };
		await create("strict");
		await call("runtime_write", {
			path: "src/new.ts",
			content: "created\n",
			operation: "create",
			mustNotExist: true,
		});
		expect(bytes("src/new.ts").toString()).toBe("created\n");
		await expect(
			call("runtime_write", { path: "src/other.ts", content: "x", operation: "create", mustNotExist: true }),
		).rejects.toThrow("Policy R1/DENY");
	});

	it("turns a deleted edit target into consumable stale instead of a filesystem error", async () => {
		await create("strict");
		const read = await strictRead();
		rmSync(join(cwd, "src/app.ts"));
		await expect(
			call(
				"runtime_edit",
				{
					path: "src/app.ts",
					oldText: "foo()",
					newText: "bar()",
					anchor: read.line(1),
					fileDigest: read.fileDigest,
					readReceipt: read.readReceipt,
				},
				"del-edit",
			),
		).rejects.toThrow("STALE_ANCHOR");
		expect(() => bytes()).toThrow();
		expect(worker.consumeStaleAnchorError("runtime_edit", "del-edit")).toBe(true);
	});

	it("turns a deleted replace target into stale and keeps it missing", async () => {
		await create("strict");
		const read = await strictRead();
		rmSync(join(cwd, "src/app.ts"));
		await expect(
			call(
				"runtime_write",
				{
					path: "src/app.ts",
					content: "weavra\n",
					operation: "replace",
					readReceipt: read.readReceipt,
					fileDigest: read.fileDigest,
				},
				"del-replace",
			),
		).rejects.toThrow("STALE_ANCHOR");
		expect(() => bytes()).toThrow();
		expect(worker.consumeStaleAnchorError("runtime_write", "del-replace")).toBe(true);
	});

	it("invalidates an old receipt after delete plus identical-byte recreation (edit)", async () => {
		await create("strict");
		const read = await strictRead();
		const original = bytes().toString();
		rmSync(join(cwd, "src/app.ts"));
		writeFileSync(join(cwd, "src/app.ts"), original);
		await expect(
			call("runtime_edit", {
				path: "src/app.ts",
				oldText: "foo()",
				newText: "bar()",
				anchor: read.line(1),
				fileDigest: read.fileDigest,
				readReceipt: read.readReceipt,
			}),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe(original);
	});

	it("invalidates an old receipt after delete plus identical-byte recreation (replace)", async () => {
		await create("strict");
		const read = await strictRead();
		const original = bytes().toString();
		rmSync(join(cwd, "src/app.ts"));
		writeFileSync(join(cwd, "src/app.ts"), original);
		await expect(
			call("runtime_write", {
				path: "src/app.ts",
				content: "weavra\n",
				operation: "replace",
				readReceipt: read.readReceipt,
				fileDigest: read.fileDigest,
			}),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe(original);
	});

	it("accepts a fresh receipt for the recreated file", async () => {
		await create("strict");
		const stale = await strictRead();
		rmSync(join(cwd, "src/app.ts"));
		writeFileSync(join(cwd, "src/app.ts"), "foo()\nfoo()\n");
		const fresh = await strictRead();
		expect(fresh.readReceipt).not.toBe(stale.readReceipt);
		await call("runtime_edit", {
			path: "src/app.ts",
			oldText: "foo()",
			newText: "bar()",
			anchor: fresh.line(2),
			fileDigest: fresh.fileDigest,
			readReceipt: fresh.readReceipt,
		});
		expect(bytes().toString()).toBe("foo()\nbar()\n");
	});

	it("rejects NUL content in strict create without creating the target", async () => {
		await create("strict");
		await expect(
			call("runtime_write", {
				path: "src/nul.ts",
				content: "hello\u0000world",
				operation: "create",
				mustNotExist: true,
			}),
		).rejects.toThrow("strict UTF-8");
		expect(() => bytes("src/nul.ts")).toThrow();
	});

	it("rejects NUL content in strict replace and keeps the original bytes", async () => {
		await create("strict");
		const read = await strictRead();
		await expect(
			call("runtime_write", {
				path: "src/app.ts",
				content: "hello\u0000world",
				operation: "replace",
				readReceipt: read.readReceipt,
				fileDigest: read.fileDigest,
			}),
		).rejects.toThrow("strict UTF-8");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});

	it("rejects lossy surrogate content in strict create and replace", async () => {
		await create("strict");
		await expect(
			call("runtime_write", {
				path: "src/lossy.ts",
				content: "x\ud800y",
				operation: "create",
				mustNotExist: true,
			}),
		).rejects.toThrow("strict UTF-8");
		expect(() => bytes("src/lossy.ts")).toThrow();
		const read = await strictRead();
		await expect(
			call("runtime_write", {
				path: "src/app.ts",
				content: "x\ud800y",
				operation: "replace",
				readReceipt: read.readReceipt,
				fileDigest: read.fileDigest,
			}),
		).rejects.toThrow("strict UTF-8");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});

	it("supports strict anchored edit on space and non-ASCII paths", async () => {
		await create("strict");
		writeFileSync(join(cwd, "docs 한글/문서.md"), "foo()\n");
		const read = await strictRead("docs 한글/문서.md");
		await call("runtime_edit", {
			path: "docs 한글/문서.md",
			oldText: "foo()",
			newText: "bar()",
			anchor: read.line(1),
			fileDigest: read.fileDigest,
			readReceipt: read.readReceipt,
		});
		expect(bytes("docs 한글/문서.md").toString()).toBe("bar()\n");
	});
});

describe("V0.5A context pack is not mutation authority", () => {
	it("rejects pack digests presented as a strict read receipt", async () => {
		await create("strict");
		const read = await strictRead();
		const packDigest = `sha256:${"a".repeat(64)}`;
		const packSnippetDigest = `sha256:${"b".repeat(64)}`;
		const attempt = async (receipt: string) =>
			await call(
				"runtime_edit",
				{
					path: "src/app.ts",
					oldText: "foo()",
					newText: "bar()",
					anchor: read.line(1),
					fileDigest: read.fileDigest,
					readReceipt: receipt,
				},
				`pack-${receipt.slice(7, 11)}`,
			);
		await expect(attempt(packDigest)).rejects.toThrow("STALE_ANCHOR");
		await expect(attempt(packSnippetDigest)).rejects.toThrow("STALE_ANCHOR");
		// A file digest or anchor from the pack cannot stand in for the receipt either.
		await expect(
			call(
				"runtime_edit",
				{
					path: "src/app.ts",
					oldText: "foo()",
					newText: "bar()",
					anchor: read.line(1),
					fileDigest: packDigest,
					readReceipt: packDigest,
				},
				"pack-digest-only",
			),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
		// The real path still works: fresh anchored read -> fresh receipt -> edit.
		const fresh = await strictRead();
		await call("runtime_edit", {
			path: "src/app.ts",
			oldText: "foo()",
			newText: "bar()",
			anchor: fresh.line(1),
			fileDigest: fresh.fileDigest,
			readReceipt: fresh.readReceipt,
		});
		expect(bytes().toString()).toBe("bar()\nfoo()\n");
	});

	it("rejects pack digests presented as a strict replace receipt", async () => {
		await create("strict");
		const fresh = await strictRead();
		const packDigest = `sha256:${"c".repeat(64)}`;
		await expect(
			call(
				"runtime_write",
				{
					path: "src/app.ts",
					content: "replaced\n",
					operation: "replace",
					readReceipt: packDigest,
					fileDigest: fresh.fileDigest,
				},
				"pack-replace",
			),
		).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
		await call("runtime_write", {
			path: "src/app.ts",
			content: "replaced\n",
			operation: "replace",
			readReceipt: fresh.readReceipt,
			fileDigest: fresh.fileDigest,
		});
		expect(bytes().toString()).toBe("replaced\n");
	});
});
