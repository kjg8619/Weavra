import {
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorkerTools } from "../src/agent-tools.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import type { PolicyDecision } from "../src/contracts.ts";
import { LIST_MAX_BYTES, LIST_MAX_ENTRIES, listFiles } from "../src/list-files.ts";
import { evaluatePolicy, type PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import type { AgentExecutionRequest } from "../src/ports.ts";
import { testContract } from "./fixture-contract.ts";

let cwd: string, policy: PolicyContext, paths: FilePolicyPathInspector;
const put = (path: string) => {
	mkdirSync(dirname(join(cwd, path)), { recursive: true });
	writeFileSync(join(cwd, path), "CONTENT_MUST_NOT_BE_RETURNED");
};
beforeEach(async () => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-list-")));
	mkdirSync(join(cwd, "src"));
	policy = {
		executionMode: "READ_ONLY",
		executionRunId: "run",
		configDigest: "fixed",
		allowedPaths: ["src"],
		tools: [
			{ id: "runtime_read", operation: "read" },
			{ id: "runtime_search", operation: "search" },
			{ id: "runtime_list_files", operation: "list" },
		],
	};
	paths = await FilePolicyPathInspector.open(cwd);
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));
const list = (roots: readonly string[] = ["src"], depth = 4, signal = new AbortController().signal) =>
	listFiles(cwd, roots, depth, policy, paths, signal);
describe("bounded Node filesystem discovery", () => {
	it("lists allowed nested regular names only in deterministic lexical order", async () => {
		for (const path of ["src/z.ts", "src/b/한 글.ts", "src/a.ts", "test/hidden.ts", "package.json"]) put(path);
		const expected = { files: ["src/a.ts", "src/b/한 글.ts", "src/z.ts"], truncated: false };
		expect(await list()).toEqual(expected);
		expect(await list()).toEqual(expected);
		expect(JSON.stringify(await list())).not.toContain("CONTENT_MUST_NOT_BE_RETURNED");
		expect(JSON.stringify(await list())).not.toContain(cwd);
	});
	it("supports explicit file roots and de-duplicates overlapping allowed roots", async () => {
		put("src/a.ts");
		put("src/nested/b.ts");
		expect((await list(["src/a.ts"])).files).toEqual(["src/a.ts"]);
		expect((await list(["src", "src/nested"])).files).toEqual(["src/a.ts", "src/nested/b.ts"]);
	});
	it.each([0, 1, 4])("bounds maxDepth %s and makes omitted descendants explicit", async (depth) => {
		put("src/root.ts");
		put("src/a/b/c/d/e/deep.ts");
		const result = await list(["src"], depth);
		expect(result.files).toEqual(["src/root.ts"]);
		expect(result.truncated).toBe(true);
	});
	it.each([-1, 5, 1.5])(
		"rejects invalid depth %s",
		async (depth) => await expect(list(["src"], depth)).rejects.toThrow("0..4"),
	);
	it("hides all protected paths, node_modules and selected instructions before descending", async () => {
		for (const dir of [
			".git",
			".ai",
			".pi",
			".ssh",
			".aws",
			".azure",
			".config",
			"credentials",
			"secrets",
			"node_modules",
		])
			put(`src/${dir}/hidden.ts`);
		for (const name of [
			".env",
			".env.local",
			"auth.json",
			"id_rsa",
			".npmrc",
			"server.key",
			"config.ts",
			"policy.ts",
			"rules.md",
		])
			put(`src/${name}`);
		put("src/allowed.ts");
		policy.protectedPaths = ["src/rules.md"];
		expect((await list()).files).toEqual(["src/allowed.ts"]);
	});
	it("does not implement gitignore or silently hide generated dirs inside explicit allowed paths", async () => {
		for (const name of ["dist", "build", "coverage", "target"]) put(`${name}/artifact.txt`);
		writeFileSync(join(cwd, ".gitignore"), "dist/\nbuild/\ncoverage/\ntarget/\n");
		policy.allowedPaths = ["dist", "build", "coverage", "target"];
		expect((await list(policy.allowedPaths)).files).toEqual([
			"build/artifact.txt",
			"coverage/artifact.txt",
			"dist/artifact.txt",
			"target/artifact.txt",
		]);
	});
	it("never follows file/directory symlinks and omits multiply-linked files", async () => {
		put("outside/private.ts");
		put("src/a.ts");
		symlinkSync(join(cwd, "outside"), join(cwd, "src/link"));
		symlinkSync(join(cwd, "outside/private.ts"), join(cwd, "src/alias.ts"));
		linkSync(join(cwd, "src/a.ts"), join(cwd, "src/hard.ts"));
		expect((await list()).files).toEqual([]);
	});
	it("bounds the number of files and distinguishes an exact boundary from truncation", async () => {
		for (let index = 0; index < 500; index++) put(`src/${String(index).padStart(4, "0")}.ts`);
		expect((await list()).truncated).toBe(false);
		put("src/0500.ts");
		const result = await list();
		expect(result.files).toHaveLength(500);
		expect(result.truncated).toBe(true);
		expect(result.files[0]).toBe("src/0000.ts");
		expect(result.files.at(-1)).toBe("src/0499.ts");
	});
	it("bounds actual UTF-8 JSON output for long Unicode paths", async () => {
		const prefix = `src/${"한".repeat(60)}/${"字".repeat(60)}/${"a".repeat(200)}/${"b".repeat(200)}`;
		for (let index = 0; index < 200; index++) put(`${prefix}/${index}.ts`);
		const result = await list();
		expect(result.truncated).toBe(true);
		expect(result.files.length).toBeGreaterThan(0);
		expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(LIST_MAX_BYTES);
	});
	it("bounds enumeration itself and omits an incomplete OS-order directory rather than leaking an arbitrary prefix", async () => {
		for (let index = 0; index <= LIST_MAX_ENTRIES; index++) put(`src/${index}.ts`);
		const result = await list();
		expect(result.files).toEqual([]);
		expect(result.truncated).toBe(true);
	});
	it.each([".", "/", "..", "src/../outside", "test", "src/.ai", "src/node_modules", "src/*.ts"])(
		"denies broader/unsafe root %s",
		async (root) => {
			await expect(list([root])).rejects.toThrow("denied");
		},
	);
	it("filters unsafe output names and cancels without partial results", async () => {
		put("src/unsafe\u202e.ts");
		put("src/a.ts");
		expect((await list()).files).toEqual(["src/a.ts"]);
		await expect(list(["src"], 4, AbortSignal.abort())).rejects.toThrow();
		const controller = new AbortController();
		let calls = 0;
		await expect(
			listFiles(
				cwd,
				["src"],
				4,
				policy,
				{
					inspect: async (targets) => {
						if (++calls === 2) controller.abort();
						return paths.inspect(targets);
					},
				},
				controller.signal,
			),
		).rejects.toThrow();
	});
	it("does not widen read/search directory permissions and has no shell/process import", () => {
		for (const tool of ["runtime_read", "runtime_search", "runtime_list_files"]) {
			const decision = evaluatePolicy(
				{ runId: "run", actionId: "a", actionDigest: "input", role: "Reviewer", tool, risk: "R0", paths: ["src"] },
				policy,
				[{ path: "src", safe: true, kind: "directory" }],
			);
			expect(decision.decision).toBe(tool === "runtime_list_files" ? "ALLOW" : "DENY");
		}
		expect(readFileSync(new URL("../src/list-files.ts", import.meta.url), "utf8")).not.toMatch(
			/child_process|spawn|execFile|readFile/,
		);
	});
	it("uses the real worker Policy/audit gate as R0 and denies out-of-scope input before traversal", async () => {
		put("src/a.ts");
		put("test/hidden.ts");
		const decisions: PolicyDecision[] = [];
		const request: AgentExecutionRequest = {
			runId: "run",
			executionMode: "READ_ONLY",
			revision: 0,
			step: { stepId: "implement", attempt: 1 },
			task: testContract("Explain", { taskId: "task", statements: ["Explain"], workflow: "QUICK" }),
			role: "Executor",
			profile: "coding",
			scope: { risk: "R0", targetPath: null },
		};
		const worker = createWorkerTools({
			cwd,
			request,
			config: parseRuntimeConfig(
				JSON.stringify({
					schemaVersion: 1,
					models: {
						profiles: {
							coding: { provider: "faux", model: "coding" },
							reasoning: { provider: "faux", model: "review" },
						},
					},
				}),
			),
			policy,
			paths,
			signal: new AbortController().signal,
			assertActive: () => {},
			audit: {
				prepare: async (decision) => {
					decisions.push(decision);
				},
				finish: async () => {},
				assertWritable: async () => {},
			},
		});
		const tool = worker.tools.find((item) => item.name === "runtime_list_files")!;
		const result = await tool.execute("a", {}, undefined, undefined, {} as ExtensionContext);
		expect(result.content).toEqual([
			{ type: "text", text: JSON.stringify({ files: ["src/a.ts"], truncated: false }) },
		]);
		expect(decisions[0]).toMatchObject({ risk: "R0", decision: "ALLOW", executionMode: "READ_ONLY" });
		await expect(tool.execute("b", { path: "test" }, undefined, undefined, {} as ExtensionContext)).rejects.toThrow(
			"DENY",
		);
	});
});
