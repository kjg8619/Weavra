import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKER_FILE_TOOLS } from "../../company-runtime/src/agent-tools.ts";
import { WorkerMeasurementAccumulator } from "../../company-runtime/src/measurement.ts";
import type { PolicyContext } from "../../company-runtime/src/policy.ts";
import type { AgentExecutionRequest, AgentExecutionResult } from "../../company-runtime/src/ports.ts";
import { WEAVRA_EVAL_FIXTURES } from "../src/weavra-fixtures.ts";
import { runWeavraFixture } from "../src/weavra-harness.ts";

const fixture = WEAVRA_EVAL_FIXTURES.find((item) => item.id === "standard-2ac");
if (!fixture) throw new Error("standard-2ac fixture is missing");

/**
 * Deterministic faux worker: applies the real fixture edit and submits a structured handoff/review.
 * It never touches a provider or the network; the workflow, kernel, verifier, state store and
 * evidence pack are the real ones.
 */
function fauxAgents(cwd: string) {
	return async (input: AgentExecutionRequest): Promise<AgentExecutionResult> => {
		input.signal?.throwIfAborted();
		const accumulator = new WorkerMeasurementAccumulator({
			role: input.role,
			profile: input.profile,
			revision: input.revision,
			step: { stepId: input.step.stepId, attempt: input.step.attempt },
			requestedProvider: "faux",
			requestedModel: "faux-model",
		});
		accumulator.observeAssistant({
			responseId: `faux-${input.role}-${input.revision}`,
			provider: "faux",
			model: "faux-model",
			usage: { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120 },
			content: [{ type: "toolCall", name: input.role === "Reviewer" ? "submit_review" : "runtime_edit" }],
		});
		const measurement = accumulator.finish("SUCCEEDED");
		if (input.role === "Developer") {
			const source = readFileSync(join(cwd, "src/greeting.js"), "utf8");
			writeFileSync(join(cwd, "src/greeting.js"), source.replace("Helo,", "Hello,"));
			return {
				role: "Developer",
				handoff: {
					runId: input.runId,
					revision: input.revision,
					role: "Developer",
					task: input.task.id,
					changed_files: ["src/greeting.js"],
					summary: "Fixed the greeting typo.",
					assumptions: [],
					tests_run: [],
					known_risks: [],
					unresolved: [],
				},
				measurement,
			};
		}
		if (input.role !== "Reviewer") throw new Error(`Unexpected role ${input.role}`);
		const fallback = input.verification.checks.flatMap((check) => check.evidenceRefs)[0];
		return {
			role: "Reviewer",
			review: {
				runId: input.runId,
				revision: input.revision,
				role: "Reviewer",
				task: input.task.id,
				result: "PASS",
				issues: [],
				criteria: input.task.acceptanceCriteria.map((criterion) => {
					const refs = input.verification.checks
						.filter((check) => criterion.verification.checkIds.includes(check.id))
						.flatMap((check) => check.evidenceRefs);
					return {
						criterionId: criterion.id,
						status: "MET" as const,
						evidenceRefs: refs.length > 0 ? refs : [fallback],
					};
				}),
				evidenceRefs: [input.verification.evidenceRefs[0] ?? fallback],
				diffDigest: input.verification.diffDigest,
			},
			measurement,
		};
	};
}

describe("Weavra eval adapter faux end-to-end", () => {
	it("runs standard-2ac through the real runtime path without provider calls", async () => {
		const root = mkdtempSync(join(tmpdir(), "weavra-faux-agentdir-"));
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		const result = await runWeavraFixture(fixture!, {
			agentDir,
			timeoutMs: 60_000,
			createAgents: async ({ cwd, config, args }) => {
				const executionContract = args[4];
				const policy: PolicyContext = {
					executionMode: executionContract.mode,
					executionRunId: executionContract.runId,
					tools: [...WORKER_FILE_TOOLS],
					allowedPaths: [...config.files.allowed_paths],
					protectedPaths: ["test/eval.test.mjs"],
					projectInstruction: null,
					configDigest: "faux-config-digest",
				};
				return { executor: { execute: fauxAgents(cwd) }, policy };
			},
		});
		expect(result.runtimeError).toBeNull();
		expect(result.runtimeStatus).toBe("COMPLETED");
		expect(result.oraclePass).toBe(true);
		expect(result.falseCompletion).toBe(false);
		expect(result.measurementPresent).toBe(true);
		expect(result.taskContractDigest).not.toBeNull();
		expect(result.evidencePack).toContain("AC-001");
		expect(result.evidencePack).toContain("AC-002");
		expect(result.reportedTokens).toBe(240);
		expect(result.toolCalls).toBe(2);
	});
});
