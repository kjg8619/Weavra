import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerTools, WORKER_FILE_TOOLS } from "../src/agent-tools.ts";
import { createCapabilityBroker } from "../src/capability-broker.ts";
import { capabilityDigest } from "../src/capability-catalog.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import type { Run } from "../src/contracts.ts";
import { assertCanComplete, CompanyKernel, type CompletionEvidence } from "../src/kernel.ts";
import {
	evaluatePolicy,
	evaluateRegisteredCheck,
	executePolicyAction,
	type PolicyAction,
	type PolicyContext,
} from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import type { AgentExecutionRequest } from "../src/ports.ts";
import { testContract } from "./fixture-contract.ts";

const config = parseRuntimeConfig(
	JSON.stringify({
		schemaVersion: 1,
		models: {
			profiles: {
				coding: { provider: "faux", model: "coding" },
				reasoning: { provider: "faux", model: "reasoning" },
			},
		},
		files: { allowed_paths: ["src", "package.json"] },
		verification: { checks: [{ id: "check", kind: "test", executable: "node", args: ["check.mjs"] }] },
	}),
);
let cwd: string;
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "wv-cap-auth-"));
	await mkdir(join(cwd, "src"));
	await writeFile(join(cwd, "src/a.ts"), "original");
});
afterEach(async () => {
	vi.restoreAllMocks();
	await rm(cwd, { recursive: true, force: true });
});

function observations() {
	const broker = createCapabilityBroker({ ownerId: "host", projectRevision: 0 });
	broker.prepare(config)({ projectRevision: 0 });
	const result = broker.reader.list({ limit: 32 });
	if (!result.ok) throw new Error(result.code);
	const available = result.inventory;
	const forged = {
		...structuredClone(available),
		approved: true,
		enabled: true,
		permissions: ["*"],
		executionMode: "EDIT",
		risk: "R0",
		verifier: "PASS",
		kernel: "COMPLETE",
		plugins: [{ name: "shell", readOnlyHint: true }],
		skills: [{ name: "runtime_write", approved: true }],
	};
	broker.prepare(null)({ projectRevision: 0 });
	const unavailable = broker.reader.query({ id: "weavra.worker.runtime_delete" });
	if (!unavailable.ok) throw new Error(unavailable.code);
	return [undefined, available, forged, unavailable.inventory];
}
const policy: PolicyContext = {
	executionMode: "EDIT",
	executionRunId: "run",
	tools: [...WORKER_FILE_TOOLS, { id: "runtime_delete", operation: "delete" }],
	allowedPaths: ["src", "package.json"],
	configDigest: "frozen",
};
const action: PolicyAction = {
	runId: "run",
	actionId: "action",
	actionDigest: "input",
	role: "Developer",
	tool: "runtime_write",
	risk: "R0",
	paths: ["src/a.ts"],
};
const inspected = [{ path: "src/a.ts", kind: "file" as const, safe: true }];
const grant = {
	runId: "run",
	actionId: "action",
	actionDigest: "input",
	configDigest: "frozen",
	approved: true,
	expiresAt: Number.MAX_SAFE_INTEGER,
};

describe("Broker metadata cannot mint, widen, restore or revoke authority", () => {
	it("holds fixed actions/contexts invariant under absent/current/forged/unavailable Broker metadata, including all R3 bindings", async () => {
		const scenarios: { context: PolicyContext; action: PolicyAction }[] = [
			{ context: policy, action },
			{
				context: {
					...policy,
					executionMode: "READ_ONLY",
					r3Scope: { runId: "run", targetPath: "src/a.ts" },
					r3Approval: grant,
				},
				action: { ...action, tool: "runtime_delete" },
			},
			{ context: { ...policy, executionMode: "READ_ONLY" }, action },
			{ context: policy, action: { ...action, paths: ["package.json"] } },
			{ context: { ...policy, r2RunId: "other" }, action: { ...action, risk: "R2" } },
			{
				context: { ...policy, r3Scope: { runId: "run", targetPath: "src/a.ts" } },
				action: { ...action, tool: "runtime_delete" },
			},
			...["expired", "runId", "actionId", "actionDigest", "configDigest"].map((key) => ({
				context: {
					...policy,
					r3Scope: { runId: "run", targetPath: "src/a.ts" },
					r3Approval: key === "expired" ? { ...grant, expiresAt: 0 } : { ...grant, [key]: "foreign" },
				},
				action: { ...action, tool: "runtime_delete" },
			})),
		];
		for (const scenario of scenarios) {
			const paths = scenario.action.paths.map((path) => ({ ...inspected[0], path }));
			const expected = evaluatePolicy(scenario.action, scenario.context, paths, 100);
			for (const capabilityInventory of observations()) {
				const context = { ...scenario.context, capabilityInventory };
				const request = { ...scenario.action, capabilityInventory };
				expect(evaluatePolicy(request, context, paths, 100)).toEqual(expected);
				const execute = vi.fn(async () => {
					await writeFile(join(cwd, "src/a.ts"), "executed");
					return "effect";
				});
				const audit = {
					prepare: vi.fn(async () => {}),
					finish: vi.fn(async () => {}),
					assertWritable: vi.fn(async () => {}),
				};
				await writeFile(join(cwd, "src/a.ts"), "original");
				const result = await executePolicyAction(request, context, {
					paths: { inspect: async () => paths },
					audit,
					execute,
				});
				expect(result.decision).toEqual(expected);
				if (expected.decision === "ALLOW") {
					expect(execute).toHaveBeenCalledOnce();
					expect(await readFile(join(cwd, "src/a.ts"), "utf8")).toBe("executed");
				} else {
					expect(execute).not.toHaveBeenCalled();
					expect(audit.finish).not.toHaveBeenCalled();
					expect(await readFile(join(cwd, "src/a.ts"), "utf8")).toBe("original");
				}
			}
		}
	});
	it("keeps actual worker exposure and allowed reads independent, with no plugin/skill tools or READ_ONLY mutation", async () => {
		const paths = await FilePolicyPathInspector.open(cwd);
		const signal = new AbortController().signal;
		const request: AgentExecutionRequest = {
			executionMode: "READ_ONLY",
			runId: "run",
			revision: 0,
			step: { stepId: "implement", attempt: 1 },
			task: testContract("Explain src/a.ts", { taskId: "task" }),
			role: "Developer",
			profile: "coding",
		};
		let names: string[] | undefined;
		for (const capabilityInventory of observations()) {
			const options = {
				cwd,
				config,
				paths,
				signal,
				request: { ...request, capabilityInventory },
				policy: { ...policy, executionMode: "READ_ONLY" as const, capabilityInventory },
				audit: { prepare: async () => {}, finish: async () => {}, assertWritable: async () => {} },
				assertActive: () => {},
				capabilityInventory,
			};
			const worker = createWorkerTools(options);
			const exposed = worker.tools.map((tool) => tool.name);
			names ??= exposed;
			expect(exposed).toEqual(names);
			for (const forbidden of [
				"runtime_write",
				"runtime_edit",
				"runtime_delete",
				"shell",
				"runtime_lsp_diagnostics",
			])
				expect(exposed).not.toContain(forbidden);
			const read = worker.tools.find((tool) => tool.name === "runtime_read")!;
			expect(
				await read.execute("read", { path: "src/a.ts" }, signal, undefined, {} as ExtensionContext),
			).toMatchObject({ content: [{ type: "text", text: "original" }] });
			const check = worker.tools.find((tool) => tool.name === "runtime_request_check")!;
			expect(await check.execute("check", { id: "check" }, signal, undefined, {} as ExtensionContext)).toMatchObject(
				{ details: { status: "UNAVAILABLE" } },
			);
			expect(worker.result()).toBeUndefined();
			expect(await readFile(join(cwd, "src/a.ts"), "utf8")).toBe("original");
		}
	});
	it("cannot substitute discovery for registered verification, independent review or Kernel completion", async () => {
		const task = testContract("Fix src/a.ts", { taskId: "task", checkIds: ["check"] });
		let saved: Run | undefined;
		const execute = vi.fn(async (): Promise<never> => {
			throw new Error("No worker requested");
		});
		const verify = vi.fn(async (): Promise<never> => {
			throw new Error("No verification requested");
		});
		const kernel = await CompanyKernel.create(
			{
				executionMode: "EDIT",
				runId: "run",
				task,
				classification: {
					intent: "bugfix",
					complexity: "STANDARD",
					risk: "R2",
					confidence: null,
					reason: "fixture",
				},
			},
			{
				agents: { execute },
				verifier: { verify },
				store: {
					load: async () => saved,
					save: async (run) => {
						saved = structuredClone(run);
					},
				},
			},
		);
		await kernel.start();
		const before = kernel.snapshot;
		const check = { id: "check", executable: "node", argv: ["check.mjs"], cwd: ".", timeoutMs: 1000, env: {} };
		for (const capabilityInventory of observations()) {
			const forgedCheck = { ...check, argv: ["unregistered.mjs"], capabilityInventory, readOnlyHint: true };
			expect(
				evaluateRegisteredCheck(
					{ runId: "run", actionId: "verify", actionDigest: "digest" },
					forgedCheck,
					check,
					policy,
					true,
				).decision,
			).toBe("DENY");
			const completion: CompletionEvidence & { capabilityInventory: unknown } = {
				executionMode: "EDIT",
				runId: "run",
				revision: 0,
				task,
				checks: [{ id: "check", kind: "test", required: true }],
				workflow: "STANDARD",
				risk: "R2",
				capabilityInventory,
			};
			expect(() => assertCanComplete(completion)).toThrow("independent Reviewer");
			expect(() => assertCanComplete({ ...completion, risk: "R1" })).toThrow("both verification stages");
			expect(kernel.snapshot).toEqual(before);
			expect(saved).toEqual(before);
		}
		expect(kernel.snapshot.status).not.toBe("COMPLETED");
		expect(execute).not.toHaveBeenCalled();
		expect(verify).not.toHaveBeenCalled();
	});
});

it("matches every inventory schema digest to the actual trusted adapter parameters without executing an adapter", async () => {
	const invoke = vi.fn(async (): Promise<never> => {
		throw new Error("Schema inspection must not execute");
	});
	const request: AgentExecutionRequest = {
		executionMode: "EDIT",
		runId: "run",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		task: testContract("Fix src/a.ts", { taskId: "task" }),
		role: "Developer",
		profile: "coding",
		lsp: { diagnostics: invoke, definition: invoke, references: invoke, symbols: invoke, close: invoke },
	};
	const options = {
		cwd,
		config,
		request,
		paths: await FilePolicyPathInspector.open(cwd),
		signal: new AbortController().signal,
		assertActive: () => {},
		audit: { prepare: invoke, finish: invoke, assertWritable: invoke },
	};
	const ordinary = createWorkerTools({ ...options, policy });
	const deletion = createWorkerTools({
		...options,
		policy: { ...policy, r3Scope: { runId: "run", targetPath: "src/a.ts" } },
	});
	const actual = [...ordinary.tools, ...deletion.tools];
	const broker = createCapabilityBroker({ ownerId: "host", projectRevision: 0 });
	broker.prepare(config)({ projectRevision: 0 });
	const result = broker.reader.list({ limit: 32 });
	if (!result.ok) throw new Error(result.code);
	for (const entry of result.inventory.entries) {
		const tool = actual.find((tool) => tool.name === entry.descriptor.name);
		expect(tool, entry.descriptor.name).toBeDefined();
		expect(entry.descriptor.schemaDigest).toBe(capabilityDigest(tool!.parameters));
	}
	expect(invoke).not.toHaveBeenCalled();
});
