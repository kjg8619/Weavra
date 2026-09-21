import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CompanyKernel } from "../src/kernel.ts";
import {
	evaluatePolicy,
	executePolicyAction,
	type InspectedPath,
	type PolicyAction,
	type PolicyContext,
} from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import { FileStateStore } from "../src/state-store.ts";
import { testContract } from "./fixture-contract.ts";

const context: PolicyContext = {
	executionMode: "EDIT",
	executionRunId: "run-1",
	tools: [
		{ id: "read", operation: "read" },
		{ id: "search", operation: "search" },
		{ id: "write", operation: "write" },
		{ id: "edit", operation: "edit" },
	],
	allowedPaths: ["src", "test", "package.json"],
	configDigest: "config-1",
};
const action: PolicyAction = {
	runId: "run-1",
	actionId: "action-1",
	role: "Developer",
	risk: "R1",
	tool: "edit",
	paths: ["src/app.ts"],
	actionDigest: "complete-input-digest",
};
function facts(paths: readonly string[] = action.paths): InspectedPath[] {
	return paths.map((path) => ({ path, safe: true, kind: "file" }));
}

describe("pure execution policy", () => {
	it.each(["read", "search", "write", "edit"])(
		"allows registered R0/R1 %s and raises mutation minimum risk",
		(tool) => {
			const result = evaluatePolicy({ ...action, risk: "R0", tool }, context, facts());
			expect(result.decision).toBe("ALLOW");
			expect(result.risk).toBe(tool === "read" || tool === "search" ? "R0" : "R1");
		},
	);
	it.each([
		["R2", "REVIEW_REQUIRED"],
		["R3", "APPROVAL_REQUIRED"],
		["UNKNOWN", "DENY"],
	] as const)("does not authorize %s", (risk, decision) => {
		expect(evaluatePolicy({ ...action, risk }, context, facts()).decision).toBe(decision);
	});
	it.each(["Reviewer", "Lead"] as const)("denies %s mutations, permits registered reads", (role) => {
		expect(evaluatePolicy({ ...action, role }, context, facts()).decision).toBe("DENY");
		expect(evaluatePolicy({ ...action, role, tool: "read", risk: "R0" }, context, facts()).decision).toBe("ALLOW");
	});
	it.each(["unknown", "bash", "sh", "shell", "exec"])(
		"denies unregistered/arbitrary %s even when disguised as a read registration",
		(tool) => {
			const config =
				tool === "unknown"
					? context
					: { ...context, tools: [...context.tools, { id: tool, operation: "read" as const }] };
			expect(evaluatePolicy({ ...action, tool }, config, facts()).decision).toBe("DENY");
		},
	);
	it.each([
		"/etc/passwd",
		"../other",
		"src/../app.ts",
		"src//app.ts",
		"src/./app.ts",
		"C:/secret",
		"src\\app.ts",
		"src/*",
		"src/a\u0000",
		"src/ app.ts",
		"src-other/app.ts",
	])("denies invalid/outside literal path %s", (path) => {
		expect(evaluatePolicy({ ...action, paths: [path] }, context, facts([path])).decision).toBe("DENY");
	});
	it.each([
		"src/.git/config",
		"src/.git",
		"src/.ai/state.json",
		"src/.ai/config.yaml",
		"src/.pi/extensions/a.ts",
		"src/.env",
		"src/.env.local",
		"src/.ENV.production",
		"src/secrets/token",
		"src/credentials.json",
		"src/auth.json",
		"src/id_rsa",
		"src/server.key",
		"src/.npmrc",
		"src/policy.ts",
		"src/config.yaml",
		"src/config.ts",
		"src/policy-paths.ts",
	])("protects %s from reads as well as writes", (path) => {
		for (const tool of ["read", "edit"])
			expect(evaluatePolicy({ ...action, tool, paths: [path] }, context, facts([path])).decision).toBe("DENY");
	});
	it("protects additional runtime source/config paths regardless of allowlist", () => {
		expect(evaluatePolicy(action, { ...context, protectedPaths: ["src/app.ts"] }, facts()).decision).toBe("DENY");
	});
	it.each(["package.json", "src/package-lock.json", "src/pyproject.toml", "src/go.mod"])(
		"raises dependency change %s to R2",
		(path) => {
			expect(evaluatePolicy({ ...action, paths: [path] }, context, facts([path]))).toMatchObject({
				risk: "R2",
				decision: "REVIEW_REQUIRED",
			});
		},
	);
	it("denies empty allowlist, malformed config, missing/duplicate targets and forged inspection order", () => {
		expect(evaluatePolicy(action, { ...context, allowedPaths: [] }, facts()).decision).toBe("DENY");
		expect(evaluatePolicy(action, { ...context, allowedPaths: ["../src"] }, facts()).decision).toBe("DENY");
		expect(
			evaluatePolicy(action, { ...context, tools: [...context.tools, context.tools[0]] }, facts()).decision,
		).toBe("DENY");
		expect(evaluatePolicy({ ...action, paths: [] }, context, []).decision).toBe("DENY");
		expect(evaluatePolicy({ ...action, paths: [...action.paths, ...action.paths] }, context, facts()).decision).toBe(
			"DENY",
		);
		expect(evaluatePolicy(action, context, facts(["test/other.ts"])).decision).toBe("DENY");
	});
	it.each([
		{ safe: false, kind: "file" },
		{ safe: true, kind: "directory" },
	] as const)("requires safe concrete files, not an unchecked recursive search root: %j", (patch) => {
		expect(evaluatePolicy(action, context, [{ path: action.paths[0], ...patch }]).decision).toBe("DENY");
	});
	it("allows new files for mutations but not missing reads", () => {
		const inspected: InspectedPath[] = [{ path: action.paths[0], safe: true, kind: "missing" }];
		expect(evaluatePolicy(action, context, inspected).decision).toBe("ALLOW");
		expect(evaluatePolicy({ ...action, tool: "read" }, context, inspected).decision).toBe("DENY");
	});
});

let root: string;
let store: FileStateStore;
let paths: FilePolicyPathInspector;
let failingFile: "state.json" | "tasks.json" | undefined;
beforeEach(async () => {
	failingFile = undefined;
	root = await mkdtemp(join(tmpdir(), "company-policy-"));
	await mkdir(join(root, "src"));
	await writeFile(join(root, "src/app.ts"), "original");
	paths = await FilePolicyPathInspector.open(root);
	store = await FileStateStore.open(root, {
		beforeAtomicStep: (file, step) => {
			if (file === failingFile && step === "write") throw new Error("Injected disk failure");
		},
	});
	const kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: action.runId,
			task: testContract("Fix bug", { taskId: "task-1", statements: ["Regression covered"] }),
			classification: { intent: "bugfix", complexity: "STANDARD", risk: "R1", confidence: null, reason: "Bug fix" },
		},
		{
			store,
			agents: {
				execute: async () => {
					throw new Error("No agent");
				},
			},
			verifier: {
				verify: async () => {
					throw new Error("No verifier");
				},
			},
		},
	);
	await kernel.start();
});
afterEach(async () => {
	await store?.close().catch(() => {});
	await rm(root, { recursive: true, force: true });
});

describe("filesystem path adapter and execution gate", () => {
	it.each(["outside", "internal", "dangling", "ancestor"])(
		"rejects %s symlinks including not-yet-created leaves",
		async (mode) => {
			const target = mode === "outside" ? tmpdir() : mode === "dangling" ? join(root, "absent") : join(root, "src");
			await symlink(target, join(root, "src/link"));
			const file = mode === "ancestor" ? "src/link/new/deep/file.ts" : "src/link";
			expect((await paths.inspect([file]))[0].safe).toBe(false);
		},
	);
	it("rejects hardlinks and non-directory ancestors; permits missing ordinary nested files", async () => {
		await link(join(root, "src/app.ts"), join(root, "src/alias.ts"));
		expect((await paths.inspect(["src/alias.ts"]))[0].safe).toBe(false);
		expect((await paths.inspect(["src/app.ts/child"]))[0].safe).toBe(false);
		expect(await paths.inspect(["src/new/deep/file.ts"])).toEqual([
			{ path: "src/new/deep/file.ts", safe: true, kind: "missing" },
		]);
	});
	it.each(["R2", "R3", "UNKNOWN"] as const)("persists %s denial and calls executor zero times", async (risk) => {
		let calls = 0;
		const result = await executePolicyAction({ ...action, risk }, context, {
			paths,
			audit: store,
			execute: async () => {
				calls++;
			},
		});
		expect(result.decision.decision).not.toBe("ALLOW");
		expect(calls).toBe(0);
		expect(store.snapshot.actions[0].status).toBe("DENIED");
	});
	it.each(["bash", "unknown"])("does not call denied %s executor", async (tool) => {
		let calls = 0;
		await executePolicyAction({ ...action, tool }, context, {
			paths,
			audit: store,
			execute: async () => {
				calls++;
			},
		});
		expect(calls).toBe(0);
	});
	it("records intent before execution and result after; no input contents or output copied", async () => {
		const result = await executePolicyAction(action, context, {
			paths,
			audit: store,
			execute: async (bound) => {
				expect(bound).toEqual(action);
				const saved = JSON.parse(await readFile(join(root, ".ai/state.json"), "utf8"));
				expect(saved.actions[0].status).toBe("PREPARED");
				return "private-output";
			},
		});
		expect(result.value).toBe("private-output");
		expect(store.snapshot.actions[0].status).toBe("SUCCEEDED");
		expect(JSON.stringify(store.snapshot)).not.toContain("private-output");
	});
	it("rechecks paths after persistence and denies a symlink swap", async () => {
		let calls = 0;
		await expect(
			executePolicyAction(action, context, {
				paths,
				audit: {
					prepare: async (decision) => {
						await store.prepare(decision);
						await rm(join(root, "src/app.ts"));
						await symlink(join(root, "outside"), join(root, "src/app.ts"));
					},
					finish: store.finish.bind(store),
					assertWritable: store.assertWritable.bind(store),
				},
				execute: async () => {
					calls++;
				},
			}),
		).rejects.toThrow("Target changed");
		expect(calls).toBe(0);
		expect(store.snapshot.actions[0].status).toBe("FAILED");
	});
	it("fails closed if intent persistence fails", async () => {
		let calls = 0;
		await store.close();
		await expect(
			executePolicyAction(action, context, {
				paths,
				audit: store,
				execute: async () => {
					calls++;
				},
			}),
		).rejects.toThrow();
		expect(calls).toBe(0);
	});
	it.each(["state.json", "tasks.json"] as const)("blocks executor when intent %s write fails", async (file) => {
		failingFile = file;
		let calls = 0;
		await expect(
			executePolicyAction(action, context, {
				paths,
				audit: store,
				execute: async () => {
					calls++;
				},
			}),
		).rejects.toMatchObject({ stage: file, stateCommitted: file === "tasks.json" });
		expect(calls).toBe(0);
		await expect(store.assertWritable()).rejects.toThrow();
	});
	it.each(["state.json", "tasks.json"] as const)(
		"does not report success or run another action after result %s failure",
		async (file) => {
			let calls = 0;
			const ports = {
				paths,
				audit: store,
				execute: async () => {
					calls++;
					failingFile = file;
					return "done";
				},
			};
			await expect(executePolicyAction(action, context, ports)).rejects.toMatchObject({
				stage: file,
				stateCommitted: file === "tasks.json",
			});
			await expect(executePolicyAction({ ...action, actionId: "next" }, context, ports)).rejects.toThrow();
			expect(calls).toBe(1);
		},
	);
	it("blocks execution after ownership loss between intent and execution", async () => {
		let calls = 0;
		await expect(
			executePolicyAction(action, context, {
				paths,
				audit: {
					prepare: async (decision) => {
						await store.prepare(decision);
						await rm(join(root, ".ai/writer.lock"));
					},
					finish: store.finish.bind(store),
					assertWritable: store.assertWritable.bind(store),
				},
				execute: async () => {
					calls++;
				},
			}),
		).rejects.toThrow();
		expect(calls).toBe(0);
	});
	it("records executor failure and refuses duplicate action IDs", async () => {
		let calls = 0;
		const ports = {
			paths,
			audit: store,
			execute: async () => {
				calls++;
				throw new Error("fake failure");
			},
		};
		await expect(executePolicyAction(action, context, ports)).rejects.toThrow("fake failure");
		expect(store.snapshot.actions[0].status).toBe("FAILED");
		await expect(executePolicyAction(action, context, ports)).rejects.toThrow();
		expect(calls).toBe(1);
	});
	it("records cancellation and rejects late success without replay", async () => {
		const controller = new AbortController();
		await expect(
			executePolicyAction(
				action,
				context,
				{
					paths,
					audit: store,
					execute: async () => {
						controller.abort();
						return "late";
					},
				},
				controller.signal,
			),
		).rejects.toThrow();
		expect(store.snapshot.actions[0].status).toBe("INTERRUPTED");
	});
	it("does not execute or create an intent when already cancelled", async () => {
		let calls = 0;
		await expect(
			executePolicyAction(
				action,
				context,
				{
					paths,
					audit: store,
					execute: async () => {
						calls++;
					},
				},
				AbortSignal.abort(),
			),
		).rejects.toThrow();
		expect(calls).toBe(0);
		expect(store.snapshot.actions).toHaveLength(0);
	});
});
