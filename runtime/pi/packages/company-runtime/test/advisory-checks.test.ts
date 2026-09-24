import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerTools, WORKER_FILE_TOOLS } from "../src/agent-tools.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../src/config.ts";
import type { PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import type { AdvisoryCheckPort, AdvisoryCheckResult, AgentExecutionRequest } from "../src/ports.ts";
import { testContract } from "./fixture-contract.ts";

const base = {
	schemaVersion: 1,
	models: {
		profiles: {
			coding: { provider: "faux", model: "coding" },
			reasoning: { provider: "faux", model: "reasoning" },
		},
	},
	files: { allowed_paths: ["src"] },
	verification: { checks: [{ id: "check", kind: "test", executable: "node", args: ["check.mjs"] }] },
};
function configWith(advisory?: Record<string, unknown>): RuntimeConfig {
	return parseRuntimeConfig(
		JSON.stringify({ ...base, verification: { ...base.verification, ...(advisory ? { advisory } : {}) } }),
	);
}
const passed: AdvisoryCheckResult = {
	id: "check",
	status: "PASSED",
	exitCode: 0,
	reason: "Check exited",
	durationMs: 5,
	stdout: "CHECK_PASSED",
	stderr: "",
	workspaceChanged: false,
};

let cwd: string;
beforeEach(async () => {
	cwd = await mkdtemp(join(tmpdir(), "wv-advisory-"));
	await mkdir(join(cwd, "src"));
	await writeFile(join(cwd, "src/a.ts"), "original");
});
afterEach(async () => {
	vi.restoreAllMocks();
	await rm(cwd, { recursive: true, force: true });
});

async function developerTools(
	options: { config?: RuntimeConfig; mode?: "EDIT" | "READ_ONLY"; r3?: boolean; port?: AdvisoryCheckPort | null } = {},
) {
	const config = options.config ?? configWith({ mode: "developer", max_runs: 2 });
	const mode = options.mode ?? "EDIT";
	const port: AdvisoryCheckPort | undefined =
		options.port === null ? undefined : (options.port ?? { advise: vi.fn(async () => structuredClone(passed)) });
	const policy: PolicyContext = {
		executionMode: mode,
		executionRunId: "run",
		tools: [...WORKER_FILE_TOOLS, ...(options.r3 ? [{ id: "runtime_delete", operation: "delete" as const }] : [])],
		allowedPaths: ["src"],
		configDigest: "frozen",
		...(options.r3 ? { r3Scope: { runId: "run", targetPath: "src/a.ts" } } : {}),
	};
	const request: AgentExecutionRequest = {
		executionMode: mode,
		runId: "run",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		task: testContract("Fix src/a.ts", { taskId: "task", checkIds: ["check"] }),
		role: "Developer",
		profile: "coding",
		...(port ? { advisoryChecks: port } : {}),
	};
	const signal = new AbortController().signal;
	const worker = createWorkerTools({
		cwd,
		request,
		config,
		policy,
		paths: await FilePolicyPathInspector.open(cwd),
		audit: { prepare: async () => {}, finish: async () => {}, assertWritable: async () => {} },
		signal,
		assertActive: () => {},
	});
	const tool = worker.tools.find((candidate) => candidate.name === "runtime_request_check")!;
	const requestCheck = (id = "check") => tool.execute("call", { id }, signal, undefined, {} as ExtensionContext);
	return { worker, tool, port, signal, requestCheck };
}
const text = (result: { content: Array<{ type: string; text?: string }> }) =>
	result.content.map((part) => part.text ?? "").join("");

describe("opt-in Developer advisory checks", () => {
	it("runs a registered check through the trusted port and labels the output advisory", async () => {
		const { worker, tool, port, signal, requestCheck } = await developerTools();
		expect(worker.advisoryRunLimit).toBe(2);
		expect(tool.description).toContain("ADVISORY output only (at most 2 runs");
		const result = await requestCheck();
		expect(port?.advise).toHaveBeenCalledWith({
			runId: "run",
			revision: 0,
			step: { stepId: "implement", attempt: 1 },
			checkId: "check",
			signal,
		});
		expect(text(result)).toContain("ADVISORY ONLY: check PASSED (exit 0)");
		expect(text(result)).toContain("not verification evidence and cannot be cited as PASS");
		expect(text(result)).toContain("Advisory runs left in this attempt: 1");
		expect(text(result)).toContain("CHECK_PASSED");
		expect(result.details).toEqual({ id: "check", status: "PASSED", exitCode: 0, advisory: true });
	});

	it("stops at the per-attempt limit without calling the verifier again", async () => {
		const { port, requestCheck } = await developerTools();
		await requestCheck();
		await requestCheck();
		const limited = await requestCheck();
		expect(port?.advise).toHaveBeenCalledTimes(2);
		expect(text(limited)).toContain("advisory run limit (2) for this attempt is reached");
		expect(limited.details).toMatchObject({ status: "UNAVAILABLE", advisory: false });
	});

	it.each([
		["no advisory configuration", { config: configWith() }],
		["disabled mode", { config: configWith({ mode: "disabled" }) }],
		["READ_ONLY contract", { mode: "READ_ONLY" as const }],
		["R3 deletion run", { r3: true }],
		["missing trusted port", { port: null }],
	])("keeps request-only checks for %s", async (_name, options) => {
		const { worker, port, requestCheck } = await developerTools(options);
		expect(worker.advisoryRunLimit).toBe(0);
		expect(text(await requestCheck())).toContain("request recorded in Pi session");
		if (port) expect(port.advise).not.toHaveBeenCalled();
	});

	it("keeps verifier failures fatal and an unknown check ID correctable", async () => {
		const failing = await developerTools({
			port: {
				advise: async () => {
					throw new Error("audit unavailable");
				},
			},
		});
		await expect(failing.requestCheck()).rejects.toThrow("audit unavailable");
		expect(failing.worker.fatalToolError()).toBe("Worker tool failed or was denied");

		const unknown = await developerTools();
		await expect(unknown.requestCheck("unregistered")).rejects.toThrow("Unknown check ID");
		expect(unknown.port?.advise).not.toHaveBeenCalled();
		expect(unknown.worker.fatalToolError()).toBeUndefined();
	});

	it("parses opt-in configuration without changing absent configuration", () => {
		expect("advisory" in configWith().verification).toBe(false);
		expect(configWith({ mode: "developer" }).verification.advisory).toEqual({ mode: "developer", max_runs: 5 });
		for (const invalid of [
			{ mode: "developer", max_runs: 0 },
			{ mode: "developer", max_runs: 21 },
			{ mode: "always" },
		])
			expect(() => configWith(invalid)).toThrow("Invalid runtime config");
	});
});
