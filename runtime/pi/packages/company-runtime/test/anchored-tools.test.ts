import { execFileSync } from "node:child_process";
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
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerTools, WORKER_FILE_TOOLS, workerDigest } from "../src/agent-tools.ts";
import { fileDigest, makeAnchor } from "../src/anchored-edit.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import type { PolicyDecision } from "../src/contracts.ts";
import type { ActionAudit, PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import type { AgentExecutionRequest } from "../src/ports.ts";
import { testContract } from "./fixture-contract.ts";

let cwd: string;
let policy: PolicyContext;
let request: AgentExecutionRequest;
let audit: ActionAudit;
let decisions: PolicyDecision[];
let controller: AbortController;
const config = parseRuntimeConfig(
	JSON.stringify({
		schemaVersion: 1,
		models: {
			profiles: { coding: { provider: "faux", model: "coding" }, reasoning: { provider: "faux", model: "coding" } },
		},
		files: { allowed_paths: ["src"] },
	}),
);
let worker: ReturnType<typeof createWorkerTools>;
async function create() {
	worker = createWorkerTools({
		cwd,
		request,
		config,
		policy,
		audit,
		signal: controller.signal,
		paths: await FilePolicyPathInspector.open(cwd),
		assertActive: () => {},
	});
}
async function call(name: string, params: Record<string, unknown>, id = "call") {
	const tool = worker.tools.find((tool) => tool.name === name);
	if (!tool) throw new Error("Tool unavailable");
	const result = await tool.execute(id, params, controller.signal, undefined, {} as ExtensionContext);
	return result.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}
async function anchored(line = 1, path = "src/app.ts") {
	const output = await call("runtime_read", { path, anchors: true });
	return {
		path,
		oldText: "foo()",
		newText: "bar()",
		fileDigest: output.split("\n")[0].slice(12),
		anchor: output.split("\n")[line].split(" ")[0],
	};
}
const bytes = () => readFileSync(join(cwd, "src/app.ts"));
beforeEach(async () => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-anchors-")));
	mkdirSync(join(cwd, "src"));
	writeFileSync(join(cwd, "src/app.ts"), "foo()\nfoo()\n");
	writeFileSync(join(cwd, "src/other.ts"), "foo()\nfoo()\n");
	controller = new AbortController();
	decisions = [];
	audit = {
		prepare: vi.fn(async (decision) => {
			decisions.push(decision);
		}),
		finish: vi.fn(async () => {}),
		assertWritable: vi.fn(async () => {}),
	};
	request = {
		executionMode: "EDIT",
		runId: "run",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		task: testContract("Fix typo in src/app.ts", { taskId: "task", statements: ["fix"], workflow: "QUICK" }),
		role: "Executor",
		profile: "coding",
		scope: { risk: "R1", targetPath: "src/app.ts" },
	};
	policy = {
		executionMode: "EDIT",
		executionRunId: "run",
		tools: WORKER_FILE_TOOLS,
		allowedPaths: ["src", ".ai", "package.json"],
		configDigest: "frozen-policy",
		executorScope: request.scope,
	};
	await create();
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(cwd, { recursive: true, force: true });
});

describe("anchored runtime tools through the existing Policy/audit gate", () => {
	it("keeps the tool registry and mutation operations unchanged", () => {
		expect(WORKER_FILE_TOOLS).toEqual([
			{ id: "runtime_read", operation: "read" },
			{ id: "runtime_search", operation: "search" },
			{ id: "runtime_list_files", operation: "list" },
			{ id: "runtime_write", operation: "write" },
			{ id: "runtime_edit", operation: "edit" },
		]);
		expect(worker.tools.find((tool) => tool.name === "runtime_edit")?.description).toContain(
			"Never guess or reconstruct an anchor",
		);
	});
	it("keeps legacy read bytes and exact edit behavior, including duplicate rejection", async () => {
		const original = "\ufeff漢字\t\x1b\r\nfoo()\r\n";
		writeFileSync(join(cwd, "src/app.ts"), original);
		expect(await call("runtime_read", { path: "src/app.ts" })).toBe(original);
		expect(await call("runtime_read", { path: "src/app.ts", anchors: false })).toBe(original);
		await call("runtime_edit", { path: "src/app.ts", oldText: "foo()", newText: "bar()" });
		expect(bytes().toString()).toBe(original.replace("foo()", "bar()"));
		writeFileSync(join(cwd, "src/app.ts"), "foo()\nfoo()\n");
		await expect(call("runtime_edit", { path: "src/app.ts", oldText: "foo()", newText: "bar()" })).rejects.toThrow(
			"unique exact match",
		);
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});
	it("keeps runtime_write capable of replacing an existing file", async () => {
		await call("runtime_write", { path: "src/app.ts", content: "legacy write" });
		expect(bytes().toString()).toBe("legacy write");
	});
	it.each(["anchor", "fileDigest"])("rejects partial preconditions (%s) as input error", async (field) => {
		const params: Record<string, unknown> = await anchored();
		delete params[field];
		const before = bytes();
		await expect(call("runtime_edit", params)).rejects.toThrow("supplied together");
		expect(bytes()).toEqual(before);
		expect(audit.finish).toHaveBeenCalledTimes(1); // read only
	});
	it.each([1, 2])("edits only the selected occurrence at line %s with R1 audit", async (line) => {
		const params = await anchored(line);
		await call("runtime_edit", params);
		expect(bytes().toString()).toBe(line === 1 ? "bar()\nfoo()\n" : "foo()\nbar()\n");
		expect(decisions.at(-1)).toMatchObject({ role: "Executor", risk: "R1", decision: "ALLOW" });
		expect(audit.finish).toHaveBeenLastCalledWith("run", expect.any(String), "SUCCEEDED");
	});
	it("supports anchored unique edits", async () => {
		writeFileSync(join(cwd, "src/app.ts"), "foo()\n");
		await call("runtime_edit", await anchored());
		expect(bytes().toString()).toBe("bar()\n");
	});
	it.each(["digest", "anchor", "fabricated", "oldText", "other path", "other workspace", "ambiguous"])(
		"rejects %s without mutating any bytes",
		async (mode) => {
			if (mode === "ambiguous") writeFileSync(join(cwd, "src/app.ts"), "foo() foo()\n");
			const params = await anchored();
			if (mode === "digest") params.fileDigest = fileDigest("other");
			if (mode === "anchor") params.anchor = makeAnchor(join(cwd, params.path), 1, "old\n");
			if (mode === "fabricated") params.anchor = "invented";
			if (mode === "oldText") params.oldText = "missing";
			if (mode === "other path") params.anchor = (await anchored(1, "src/other.ts")).anchor;
			if (mode === "other workspace") params.anchor = makeAnchor(`/another/${params.path}`, 1, "foo()\n");
			const before = bytes();
			await expect(call("runtime_edit", params)).rejects.toThrow(
				mode === "ambiguous" ? "AMBIGUOUS_ANCHOR" : "STALE_ANCHOR",
			);
			expect(bytes()).toEqual(before);
			expect(audit.finish).toHaveBeenLastCalledWith("run", expect.any(String), "FAILED");
			expect(worker.consumeStaleAnchorError("runtime_read", "call")).toBe(false);
			expect(worker.consumeStaleAnchorError("runtime_edit", "call")).toBe(mode !== "ambiguous");
			expect(worker.consumeStaleAnchorError("runtime_edit", "call")).toBe(false);
		},
	);
	it("external-process race fixture preserves external bytes after anchored read", async () => {
		const params = await anchored(2);
		const external = "foo()\nfoo()\nexternal change\n";
		const source = join(cwd, "external.txt");
		writeFileSync(source, external);
		execFileSync("/bin/cp", [source, join(cwd, "src/app.ts")]);
		await expect(call("runtime_edit", params)).rejects.toThrow("file generation mismatch");
		expect(bytes().toString()).toBe(external);
	});
	it("re-reads after durable ALLOW, not before audit persistence yields", async () => {
		const params = await anchored();
		audit.prepare = async (decision) => {
			expect(decision.decision).toBe("ALLOW");
			await Promise.resolve();
			writeFileSync(join(cwd, "src/app.ts"), "externally changed during audit\n");
		};
		await expect(call("runtime_edit", params)).rejects.toThrow("STALE_ANCHOR");
		expect(bytes().toString()).toBe("externally changed during audit\n");
	});
	it.each(["symlink", "hardlink", "parent symlink", "invalid UTF-8", "binary", "oversize"])(
		"rejects unsafe anchored read/edit: %s",
		async (mode) => {
			const params = await anchored();
			if (mode === "symlink") {
				rmSync(join(cwd, params.path));
				symlinkSync("other.ts", join(cwd, params.path));
			}
			if (mode === "hardlink") linkSync(join(cwd, params.path), join(cwd, "alias"));
			if (mode === "parent symlink") {
				symlinkSync(join(cwd, "src"), join(cwd, "alias"));
				params.path = "alias/app.ts";
				policy.allowedPaths = ["alias"];
				policy.executorScope = { risk: "R1", targetPath: params.path };
				await create();
			}
			if (mode === "invalid UTF-8") writeFileSync(join(cwd, params.path), Buffer.from([0xff]));
			if (mode === "binary") writeFileSync(join(cwd, params.path), Buffer.from([0]));
			if (mode === "oversize") writeFileSync(join(cwd, params.path), "x".repeat(262145));
			const before = bytes();
			await expect(call("runtime_read", { path: params.path, anchors: true })).rejects.toThrow();
			await expect(call("runtime_edit", params)).rejects.toThrow();
			expect(bytes()).toEqual(before);
		},
	);
	it.each([".ai/state.json", "outside.ts", "../escape.ts", "src/other.ts"])(
		"Policy DENY precedes stale checks for %s",
		async (path) => {
			const before = bytes();
			await expect(
				call("runtime_edit", { path, oldText: "foo()", newText: "bar()", anchor: "fake", fileDigest: "fake" }),
			).rejects.toThrow("Policy R1/DENY");
			expect(bytes()).toEqual(before);
			expect(audit.finish).not.toHaveBeenCalled();
			expect(worker.consumeStaleAnchorError("runtime_edit", "call")).toBe(false);
		},
	);
	it.each(["before request", "during intent", "before apply"])("cancellation %s makes no mutation", async (when) => {
		const params = await anchored();
		const before = bytes();
		if (when === "before request") controller.abort();
		if (when === "during intent")
			audit.prepare = async () => {
				controller.abort();
			};
		if (when === "before apply")
			audit.assertWritable = async () => {
				controller.abort();
			};
		await expect(call("runtime_edit", params)).rejects.toThrow();
		expect(bytes()).toEqual(before);
	});
	it("never downgrades audit finish failure to a recoverable stale error", async () => {
		const params = await anchored();
		params.fileDigest = "stale";
		audit.finish = async () => {
			throw new Error("disk failure");
		};
		await expect(call("runtime_edit", params)).rejects.toThrow("disk failure");
		expect(worker.consumeStaleAnchorError("runtime_edit", "call")).toBe(false);
	});
	it("binds complete preconditions, text, step and revision in deterministic action digests without content logging", async () => {
		const params = await anchored();
		params.fileDigest = "stale";
		for (let index = 0; index < 2; index++)
			await expect(call("runtime_edit", params)).rejects.toThrow("STALE_ANCHOR");
		expect(decisions.at(-1)?.actionDigest).toBe(decisions.at(-2)?.actionDigest);
		const original = decisions.at(-1)?.actionDigest;
		expect(original).toBe(
			workerDigest({
				executionContract: { runId: "run", mode: "EDIT" },
				projectInstructionDigest: null,
				tool: "runtime_edit",
				paths: [params.path],
				input: params,
				step: request.step,
				revision: request.revision,
			}),
		);
		for (const field of ["anchor", "fileDigest", "oldText", "newText"] as const) {
			await expect(call("runtime_edit", { ...params, [field]: `${params[field]}changed` })).rejects.toThrow();
			expect(decisions.at(-1)?.actionDigest).not.toBe(original);
		}
		request.revision = 1;
		request.step = { stepId: "implement", attempt: 2 };
		await expect(call("runtime_edit", params)).rejects.toThrow();
		expect(decisions.at(-1)?.actionDigest).not.toBe(original);
		expect(Object.keys(decisions.at(-1)!)).toEqual([
			"runId",
			"actionId",
			"role",
			"projectInstructionDigest",
			"risk",
			"decision",
			"reason",
			"actionDigest",
			"configDigest",
			"executionMode",
		]);
	});
	it("keeps Reviewer read-only even with anchored reads", async () => {
		request = {
			...request,
			role: "Reviewer",
			profile: "reasoning",
			handoff: {
				runId: "run",
				task: "task",
				revision: 0,
				role: "Developer",
				summary: "done",
				changed_files: [],
				assumptions: [],
				tests_run: [],
				known_risks: [],
				unresolved: [],
			},
			verification: {
				runId: "run",
				revision: 0,
				step: { stepId: "self-check", attempt: 1 },
				diffDigest: "diff",
				evidenceRefs: ["ref"],
				checks: [],
			},
		};
		policy.executorScope = undefined;
		await create();
		expect(worker.tools.map((tool) => tool.name)).toEqual([
			"runtime_read",
			"runtime_search",
			"runtime_list_files",
			"submit_review",
		]);
		expect(await call("runtime_read", { path: "src/app.ts", anchors: true })).toContain("fileDigest:");
		await expect(call("runtime_edit", await anchored())).rejects.toThrow("Tool unavailable");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});
	it.each(["protected", "disallowed"])(
		"STANDARD path checks independently reject %s targets before freshness",
		async (mode) => {
			request = { ...request, role: "Developer", profile: "coding" };
			policy.executorScope = undefined;
			if (mode === "protected") policy.protectedPaths = ["src/app.ts"];
			else policy.allowedPaths = ["src/other.ts"];
			await create();
			await expect(
				call("runtime_edit", {
					path: "src/app.ts",
					oldText: "foo()",
					newText: "bar()",
					anchor: "fake",
					fileDigest: "fake",
				}),
			).rejects.toThrow(mode === "protected" ? "Protected target" : "outside allowed paths");
			expect(bytes().toString()).toBe("foo()\nfoo()\n");
			expect(audit.finish).not.toHaveBeenCalled();
		},
	);
	it("rechecks links after the last asynchronous Policy path inspection", async () => {
		const params = await anchored();
		audit.assertWritable = async () => {
			linkSync(join(cwd, params.path), join(cwd, "late-link"));
		};
		await expect(call("runtime_edit", params)).rejects.toThrow("Unsupported anchored file");
		expect(bytes().toString()).toBe("foo()\nfoo()\n");
	});
	it("honors the file and replacement byte limit at the filesystem boundary", async () => {
		writeFileSync(join(cwd, "src/app.ts"), "x".repeat(262144));
		const params = { ...(await anchored()), oldText: "x".repeat(262144), newText: "y".repeat(262144) };
		await call("runtime_edit", params);
		expect(bytes()).toEqual(Buffer.from("y".repeat(262144)));
		const next = { ...(await anchored()), oldText: "y".repeat(262144), newText: "z".repeat(262145) };
		await expect(call("runtime_edit", next)).rejects.toThrow();
		expect(bytes()).toEqual(Buffer.from("y".repeat(262144)));
	});
	it("keeps bound STANDARD/R2 edits R2 and unbound dependency edits REVIEW_REQUIRED", async () => {
		request = { ...request, role: "Developer", profile: "coding" };
		policy.executorScope = undefined;
		policy.r2RunId = request.runId;
		await create();
		await call("runtime_edit", await anchored());
		expect(decisions.at(-1)).toMatchObject({ risk: "R2", decision: "ALLOW" });
		writeFileSync(join(cwd, "package.json"), "foo()\n");
		policy.r2RunId = undefined;
		await create();
		const params = await anchored(1, "package.json");
		await expect(call("runtime_edit", params)).rejects.toThrow("R2/REVIEW_REQUIRED");
		expect(readFileSync(join(cwd, "package.json"), "utf8")).toBe("foo()\n");
	});
});
