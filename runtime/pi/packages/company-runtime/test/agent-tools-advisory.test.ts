import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkerTools, trustedReviewEvidenceRefs, WORKER_FILE_TOOLS } from "../src/agent-tools.ts";
import { classifyRequest } from "../src/classification.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../src/config.ts";
import type { Run } from "../src/contracts.ts";
import { projectEvidencePack } from "../src/evidence.ts";
import { CompanyKernel } from "../src/kernel.ts";
import type { ActionAudit, PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import type {
	AdvisoryCheckPort,
	AdvisoryCheckResult,
	AgentExecutionRequest,
	AgentExecutionResult,
	KernelPorts,
} from "../src/ports.ts";
import { RegisteredVerifier } from "../src/verification.ts";
import { GitWorkspace } from "../src/workspace.ts";
import { testContract } from "./fixture-contract.ts";

let cwd: string;
beforeEach(() => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "wv-advisory-default-")));
	mkdirSync(join(cwd, "src"));
	mkdirSync(join(cwd, "test"));
	writeFileSync(join(cwd, "src/app.ts"), "export const app = 1;\n");
	writeFileSync(join(cwd, "test/acceptance.test.mjs"), 'console.log("ACCEPTANCE OK");\n');
	execFileSync("git", ["init", "-q"], { cwd });
	execFileSync("git", ["add", "--", "."], { cwd });
	execFileSync("git", ["-c", "user.email=e@x", "-c", "user.name=E", "commit", "-qm", "init"], { cwd });
});
afterEach(() => {
	vi.restoreAllMocks();
	rmSync(cwd, { recursive: true, force: true });
});

function configOf(advisory_checks?: Record<string, unknown>): RuntimeConfig {
	return parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "reasoning" },
				},
			},
			files: { allowed_paths: ["src"] },
			verification: {
				checks: [
					{
						id: "acceptance",
						kind: "test",
						executable: process.execPath,
						args: ["--test", "test/acceptance.test.mjs"],
						required: true,
					},
				],
				...(advisory_checks ? { advisory_checks } : {}),
			},
		}),
	);
}
const policyOf = (config: RuntimeConfig): PolicyContext => ({
	executionMode: "EDIT",
	executionRunId: "run-1",
	tools: [...WORKER_FILE_TOOLS],
	allowedPaths: [...config.files.allowed_paths],
	protectedPaths: ["test/acceptance.test.mjs"],
	configDigest: "frozen",
});
const noAudit = { prepare: async () => {}, finish: async () => {}, assertWritable: async () => {} };
const text = (result: { content: Array<{ type: string; text?: string }> }) =>
	result.content.map((part) => part.text ?? "").join("");
const passed = (stdout = "CHECK_PASSED"): AdvisoryCheckResult => ({
	id: "acceptance",
	status: "PASSED",
	exitCode: 0,
	reason: "Check exited",
	durationMs: 5,
	stdout,
	stderr: "",
	workspaceChanged: false,
});

async function workerTools(request: AgentExecutionRequest, config: RuntimeConfig, audit: ActionAudit = noAudit) {
	const signal = new AbortController().signal;
	const worker = createWorkerTools({
		cwd,
		request,
		config,
		policy: policyOf(config),
		paths: await FilePolicyPathInspector.open(cwd),
		audit,
		signal,
		assertActive: () => {},
	});
	const tool = worker.tools.find((candidate) => candidate.name === "runtime_request_check");
	const requestCheck = async () => {
		if (!tool) throw new Error("runtime_request_check is not exposed");
		return await tool.execute("call", { id: "acceptance" }, signal, undefined, {} as ExtensionContext);
	};
	return { worker, tool, requestCheck };
}
function developerRequest(port?: AdvisoryCheckPort): AgentExecutionRequest {
	return {
		executionMode: "EDIT",
		runId: "run-1",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		task: testContract("Fix src/app.ts", { taskId: "task-1", checkIds: ["acceptance"] }),
		role: "Developer",
		profile: "coding",
		...(port ? { advisoryChecks: port } : {}),
	};
}

describe("default-on STANDARD Developer advisory checks", () => {
	it("runs through the trusted port with the default config and refuses after three runs", async () => {
		const port = { advise: vi.fn(async () => passed()) };
		const { worker, requestCheck } = await workerTools(developerRequest(port), configOf());
		expect(worker.advisoryRunLimit).toBe(3);
		for (let run = 0; run < 3; run++) expect((await requestCheck()).details).toMatchObject({ advisory: true });
		const refused = await requestCheck();
		expect(port.advise).toHaveBeenCalledTimes(3);
		expect(text(refused)).toContain("advisory run budget exhausted");
		expect(refused.details).toMatchObject({ status: "UNAVAILABLE", advisory: false });
	});

	it("cuts the tool output to 16 KiB and keeps the advisory label and the output tail", async () => {
		const stdout = `${"é".repeat(20_000)}TAIL_MARKER`;
		const { requestCheck } = await workerTools(developerRequest({ advise: async () => passed(stdout) }), configOf());
		const output = text(await requestCheck());
		expect(Buffer.byteLength(output)).toBeLessThanOrEqual(16_384);
		expect(output).toContain("ADVISORY ONLY: acceptance PASSED");
		expect(output).toContain("[advisory output truncated to 16384 bytes]");
		expect(output.endsWith("TAIL_MARKER")).toBe(true);
		expect(output).not.toContain("\uFFFD");
	});

	it("gives the Reviewer no check tool", async () => {
		const verification = {
			runId: "run-1",
			revision: 0,
			step: { stepId: "self-check" as const, attempt: 1 },
			diffDigest: "digest",
			evidenceRefs: ["diff:digest"],
			checks: [],
		};
		const { tool } = await workerTools(
			{
				executionMode: "EDIT",
				runId: "run-1",
				revision: 0,
				step: { stepId: "review", attempt: 1 },
				task: testContract("Fix src/app.ts", { taskId: "task-1", checkIds: ["acceptance"] }),
				role: "Reviewer",
				profile: "reasoning",
				handoff: {
					runId: "run-1",
					revision: 0,
					role: "Developer",
					task: "task-1",
					changed_files: [],
					summary: "fixture",
					assumptions: [],
					tests_run: [],
					known_risks: [],
					unresolved: [],
				},
				verification,
			},
			configOf(),
		);
		expect(tool).toBeUndefined();
	});

	it("does not expose the tool when advisory_checks.enabled is false", async () => {
		const port = { advise: vi.fn(async () => passed()) };
		const { worker, tool } = await workerTools(developerRequest(port), configOf({ enabled: false }));
		expect(tool).toBeUndefined();
		expect(worker.advisoryRunLimit).toBe(0);
		expect(port.advise).not.toHaveBeenCalled();
	});

	it("leaves the evidence pack checks unchanged after advisory runs", async () => {
		const runOnce = async (advisoryRuns: number): Promise<Run> => {
			const config = configOf();
			const policy = policyOf(config);
			const audit = {
				prepare: vi.fn(async () => {}),
				finish: vi.fn(async () => {}),
				assertWritable: async () => {},
			};
			const verifier = await RegisteredVerifier.create(config, policy, audit, await GitWorkspace.open(cwd, policy));
			const execute = async (request: AgentExecutionRequest): Promise<AgentExecutionResult> => {
				if (request.role === "Reviewer") {
					const refs = trustedReviewEvidenceRefs(request.verification);
					return {
						role: "Reviewer",
						review: {
							runId: request.runId,
							revision: request.revision,
							role: "Reviewer",
							task: request.task.id,
							result: "PASS",
							issues: [],
							criteria: request.task.acceptanceCriteria.map((criterion) => ({
								criterionId: criterion.id,
								status: "MET" as const,
								evidenceRefs: refs,
							})),
							evidenceRefs: refs,
							diffDigest: request.verification.diffDigest,
						},
					};
				}
				if (request.role !== "Developer") throw new Error("STANDARD fixture cannot execute an Executor");
				writeFileSync(join(cwd, "src/app.ts"), `export const app = ${advisoryRuns + 2};\n`);
				const { requestCheck } = await workerTools({ ...request, advisoryChecks: verifier }, config, audit);
				for (let run = 0; run < advisoryRuns; run++) {
					const result = await requestCheck();
					expect(result.details).toMatchObject({ status: "PASSED", advisory: true });
					expect(text(result)).toContain("ADVISORY ONLY");
				}
				return {
					role: "Developer",
					handoff: {
						runId: request.runId,
						revision: request.revision,
						role: "Developer",
						task: request.task.id,
						changed_files: ["src/app.ts"],
						summary: "fixture",
						assumptions: [],
						tests_run: [],
						known_risks: [],
						unresolved: [],
					},
				};
			};
			const ports: KernelPorts = {
				agents: { execute },
				verifier,
				store: { load: async () => undefined, save: async () => {} },
			};
			const kernel = await CompanyKernel.create(
				{
					executionMode: "EDIT",
					runId: "run-1",
					task: testContract("Fix src/app.ts", { taskId: "task-1", checkIds: ["acceptance"] }),
					classification: classifyRequest("Fix src/app.ts").classification,
					checks: [{ id: "acceptance", kind: "test", required: true }],
				},
				ports,
			);
			await kernel.start();
			for (let guard = 0; guard < 16 && kernel.snapshot.status === "RUNNING"; guard++) {
				const step = kernel.snapshot.currentStep?.stepId;
				if (!step) break;
				await kernel.advance(step);
			}
			// Advisory runs are audited process actions but never verification records.
			expect(audit.prepare).toHaveBeenCalledTimes(advisoryRuns + 2);
			writeFileSync(join(cwd, "src/app.ts"), "export const app = 1;\n");
			return kernel.snapshot;
		};
		const baseline = await runOnce(0);
		const advised = await runOnce(2);
		expect(baseline.status).toBe("COMPLETED");
		expect(advised.status).toBe("COMPLETED");
		expect(advised.verification).toHaveLength(baseline.verification.length);
		const baselinePack = projectEvidencePack({ run: baseline });
		const advisedPack = projectEvidencePack({ run: advised });
		expect(advisedPack.checks).toHaveLength(baselinePack.checks.length);
		expect(JSON.stringify(advised)).not.toContain("ADVISORY");
		expect(JSON.stringify(advisedPack)).not.toContain("ADVISORY");
	});
});
