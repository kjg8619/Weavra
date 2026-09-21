import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WORKER_FILE_TOOLS } from "../../company-runtime/src/agent-tools.ts";
import { WorkerMeasurementAccumulator } from "../../company-runtime/src/measurement.ts";
import type { AgentExecutionRequest, AgentExecutionResult } from "../../company-runtime/src/ports.ts";
import { summarizeTaskContextPack } from "../../company-runtime/src/task-context.ts";
import { WEAVRA_EVAL_FIXTURES } from "../src/weavra-fixtures.ts";
import { runWeavraFixture } from "../src/weavra-harness.ts";

const fixture = WEAVRA_EVAL_FIXTURES.find((item) => item.id === "standard-2ac");
if (!fixture) throw new Error("standard-2ac fixture is missing");

/** Bounded context summary shape as reported for a delivered pack. */
type ContextSummary = {
	mode: string;
	digest: string | null;
	bytes: number;
	relatedFileCount: number;
	symbolCount: number;
	snippetCount: number;
	unknownCount: number;
	truncated: boolean;
};

/** Deterministic faux worker that reports the pack summary it actually received. */
function fauxAgents(cwd: string) {
	const summaries: ContextSummary[] = [];
	const packs: Array<AgentExecutionRequest["taskContextPack"]> = [];
	const executor = {
		async execute(input: AgentExecutionRequest): Promise<AgentExecutionResult> {
			packs.push(input.taskContextPack);
			if (input.taskContextPack) summaries.push(summarizeTaskContextPack(input.taskContextPack));
			const accumulator = new WorkerMeasurementAccumulator(
				{
					role: input.role,
					profile: input.profile,
					revision: input.revision,
					step: { stepId: input.step.stepId, attempt: input.step.attempt },
					requestedProvider: "faux",
					requestedModel: "faux-model",
				},
				Date.now,
				input.taskContextPack ? summarizeTaskContextPack(input.taskContextPack) : undefined,
			);
			accumulator.observeAssistant({
				responseId: `faux-${input.role}`,
				provider: "faux",
				model: "faux-model",
				usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: 15 },
				content: [{ type: "toolCall", name: "runtime_read" }],
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
						summary: "Fixed typo",
						assumptions: [],
						tests_run: [],
						known_risks: [],
						unresolved: [],
					},
					measurement,
				};
			}
			if (input.role !== "Reviewer") throw new Error(`unexpected role ${input.role}`);
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
					criteria: input.task.acceptanceCriteria.map((criterion) => ({
						criterionId: criterion.id,
						status: "MET" as const,
						evidenceRefs: [input.verification.evidenceRefs[0] ?? fallback],
					})),
					evidenceRefs: [input.verification.evidenceRefs[0] ?? fallback],
					diffDigest: input.verification.diffDigest,
				},
				measurement,
			};
		},
	};
	return { executor, summaries, packs };
}

async function runWith(contextPack: "disabled" | "bounded") {
	const root = mkdtempSync(join(tmpdir(), `weavra-ab-${contextPack}-`));
	try {
		const agentDir = join(root, "agent");
		mkdirSync(agentDir, { recursive: true });
		const state: {
			summaries: ContextSummary[];
			packs: Array<AgentExecutionRequest["taskContextPack"]>;
		} = {
			summaries: [],
			packs: [],
		};
		const result = await runWeavraFixture(fixture!, {
			agentDir,
			timeoutMs: 60_000,
			contextPack,
			createAgents: async ({ cwd, config, args }) => {
				const contract = args[4];
				const policy = {
					executionMode: contract.mode,
					executionRunId: contract.runId,
					tools: [...WORKER_FILE_TOOLS],
					allowedPaths: [...config.files.allowed_paths],
					protectedPaths: ["test/eval.test.mjs"],
					projectInstruction: null,
					configDigest: "faux-config-digest",
				};
				const faux = fauxAgents(cwd);
				state.summaries = faux.summaries;
				state.packs = faux.packs;
				return { executor: faux.executor, policy };
			},
		});
		return { result, ...state };
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

describe("V0.5A deterministic context A/B", () => {
	it("compares disabled and bounded context through the production composition path", async () => {
		const disabled = await runWith("disabled");
		const bounded = await runWith("bounded");
		for (const run of [disabled, bounded]) {
			expect(run.result.runtimeStatus).toBe("COMPLETED");
			expect(run.result.oraclePass).toBe(true);
			expect(run.result.falseCompletion).toBe(false);
		}
		// Authority equivalence: identical oracle outcome and required checks in both modes.
		expect(disabled.result.changedFiles).toEqual(bounded.result.changedFiles);
		expect(disabled.packs.every((pack) => pack === undefined)).toBe(true);
		expect(disabled.summaries).toHaveLength(0);
		expect(bounded.packs.every((pack) => pack !== undefined)).toBe(true);
		expect(bounded.summaries.length).toBeGreaterThanOrEqual(2);
		const first = bounded.summaries[0];
		for (const summary of bounded.summaries) {
			expect(summary.mode).toBe("bounded");
			expect(summary.bytes).toBeLessThanOrEqual(49152);
			expect(summary.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
		}
		expect(first.bytes).toBeGreaterThan(0);
		// Real measured numbers, no invented token savings.
		console.log(
			`[ab] bounded summaries: ${bounded.summaries
				.map(
					(summary) =>
						`${summary.relatedFileCount}f/${summary.symbolCount}s/${summary.snippetCount}sn/${summary.bytes}B`,
				)
				.join(" ")}`,
		);
	});
});
