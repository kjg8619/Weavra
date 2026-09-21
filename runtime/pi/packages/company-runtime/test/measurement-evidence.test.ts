import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BudgetController, BudgetDenied, budgetLimitsFromConfig } from "../src/budget.ts";
import { type Run, RunSchema, validateContract } from "../src/contracts.ts";
import { formatEvidencePack, projectEvidencePack } from "../src/evidence.ts";
import { WorkerMeasurementAccumulator } from "../src/measurement.ts";
import { WorkerMeasurementSchema } from "../src/measurement-types.ts";
import { captureProvenance } from "../src/provenance.ts";
import { ProvenanceSchema } from "../src/provenance-types.ts";
import { graphRun } from "./graph-fixtures.ts";

function measurement(overrides: { totalTokens?: number; source?: "provider" | "unavailable" } = {}) {
	const accumulator = new WorkerMeasurementAccumulator({
		role: "Developer",
		profile: "coding",
		revision: 0,
		step: { stepId: "implement" as const, attempt: 1 },
		requestedProvider: "requested-provider",
		requestedModel: "requested-model",
	});
	accumulator.observeAssistant({
		timestamp: 1,
		provider: "actual-provider",
		model: "actual-model",
		responseModel: "actual-model-2026-01-01",
		providerThinkingLevel: "high",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 2,
			cacheWrite: 1,
			reasoning: 4,
			totalTokens: overrides.totalTokens ?? 18,
		},
		content: [{ type: "toolCall", name: "runtime_read" }],
	});
	if (overrides.source === "unavailable") accumulator.observeAssistant({ timestamp: 2, content: [] });
	return accumulator.finish("SUCCEEDED");
}

describe("V0.3F worker measurement", () => {
	it("aggregates provider usage without double counting reasoning or duplicate messages", () => {
		const accumulator = new WorkerMeasurementAccumulator({
			role: "Reviewer",
			profile: "reasoning",
			revision: 1,
			step: { stepId: "review", attempt: 2 },
			requestedProvider: "p",
			requestedModel: "m",
		});
		const message = {
			responseId: "resp-1",
			provider: "p",
			model: "m",
			usage: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1, reasoning: 4, totalTokens: 18 },
			content: [
				{ type: "toolCall", name: "runtime_read" },
				{ type: "toolCall", name: "runtime_list_files" },
			],
		};
		accumulator.observeAssistant(message);
		accumulator.observeAssistant(message);
		const result = accumulator.finish("SUCCEEDED");
		expect(result.modelTurns).toBe(1);
		expect(result.toolCalls).toBe(2);
		expect(result.toolCallsByName).toEqual({ runtime_list_files: 1, runtime_read: 1 });
		expect(result.usage).toMatchObject({
			source: "provider",
			input: 10,
			output: 5,
			cacheRead: 2,
			cacheWrite: 1,
			reasoning: 4,
			totalTokens: 18,
		});
		// reasoning is a subset of output: provider total must not be recomputed as output + reasoning.
		expect(result.usage.totalTokens).not.toBe(result.usage.output + (result.usage.reasoning ?? 0));
		expect(result.actualProvider).toBe("p");
		expect(result.actualModel).toBe("m");
		expect(result.providerThinkingLevel).toBeUndefined();
	});

	it("marks partial usage as unavailable and keeps identity separate from requested values", () => {
		const result = measurement({ source: "unavailable" });
		expect(result.usage.source).toBe("unavailable");
		expect(result.usage.reasoning).toBeUndefined();
		expect(result.actualProvider).toBe("actual-provider");
		expect(result.actualModel).toBe("actual-model");
		expect(result.requestedProvider).toBe("requested-provider");
		expect(result.responseModel).toBe("actual-model-2026-01-01");
		expect(result.providerThinkingLevel).toBe("high");
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});
});

describe("V0.3F budget controller", () => {
	it("is explicitly unlimited by default and maps config keys", () => {
		const unlimited = new BudgetController({});
		expect(unlimited.status.configured).toBe(false);
		unlimited.reserve("Developer");
		expect(unlimited.status.workerInvocations).toBe(1);
		expect(budgetLimitsFromConfig(undefined)).toBeUndefined();
		expect(budgetLimitsFromConfig({})).toBeUndefined();
		expect(budgetLimitsFromConfig({ max_worker_invocations: 2, max_reported_tokens: 100 })).toEqual({
			maxWorkerInvocations: 2,
			maxReportedTokens: 100,
		});
	});

	it("counts invocations before the model call and denies exactly at the limit", () => {
		const budget = new BudgetController({ maxWorkerInvocations: 2 });
		budget.reserve("Developer");
		budget.record("Developer", measurement());
		budget.reserve("Reviewer");
		budget.record("Reviewer", measurement());
		expect(() => budget.reserve("Developer")).toThrow(BudgetDenied);
		expect(budget.status).toMatchObject({ exceeded: true, workerInvocations: 2 });
		expect(budget.status.reason).toContain("Budget exhausted");
	});

	it("denies the next invocation after reported tokens reach the limit and records in-flight overage", () => {
		const budget = new BudgetController({ maxReportedTokens: 20 });
		budget.reserve("Developer");
		budget.record("Developer", measurement({ totalTokens: 25 }));
		expect(budget.status.reportedTokens).toBe(25);
		expect(budget.status.exceeded).toBe(true);
		expect(() => budget.reserve("Reviewer")).toThrow("Budget token limit reached");
	});

	it("fails closed when a token budget is configured but previous usage was unavailable", () => {
		const budget = new BudgetController({ maxReportedTokens: 1_000 });
		budget.reserve("Developer");
		budget.record("Developer", measurement({ source: "unavailable" }));
		expect(budget.status.reportedTokens).toBeNull();
		expect(() => budget.reserve("Reviewer")).toThrow("Budget accounting unavailable");
	});

	it("treats an adapter that reports no measurement as unavailable instead of zero", () => {
		const budget = new BudgetController({ maxReportedTokens: 1_000 });
		budget.reserve("Developer");
		budget.recordUnavailable();
		expect(budget.status.reportedTokens).toBeNull();
		expect(() => budget.reserve("Reviewer")).toThrow(BudgetDenied);
	});
});

describe("V0.3F provenance", () => {
	it("captures runtime checkout, CLI bundle and digests, and leaves unknown values absent", async () => {
		const provenance = captureProvenance({
			cwd: process.cwd(),
			configDigest: "config-digest",
			taskContractDigest: `sha256:${"a".repeat(64)}`,
		});
		expect(provenance.runtimeSource?.path).toBeDefined();
		expect(provenance.runtimeSource?.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(provenance.cliBundle?.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(provenance.cliBundle?.bytes).toBeGreaterThan(0);
		expect(provenance.cliBundle?.version).toBeDefined();
		expect(provenance.configDigest).toBe("config-digest");
		expect(provenance.targetWorkspaceCommit).toMatch(/^[0-9a-f]{40}$/);

		const temp = await mkdtemp(join(tmpdir(), "weavra-provenance-"));
		try {
			const noGit = captureProvenance({ cwd: temp });
			expect(noGit.targetWorkspaceCommit).toBeUndefined();
			expect(noGit.configDigest).toBeUndefined();
			expect(noGit.runtimeSource?.commit).toBeDefined();
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	});
});

function completedRun(): Run {
	const run = graphRun("STANDARD", "R1", 0);
	return validateContract(RunSchema, {
		...run,
		provenance: {
			runtimeSource: { path: "/checkout", commit: "b".repeat(40) },
			cliBundle: { path: "/checkout/cli.js", sha256: "c".repeat(64), bytes: 10, mtimeMs: 1, version: "0.85.1" },
			configDigest: "config-digest",
			...(run.taskContractDigest ? { taskContractDigest: run.taskContractDigest } : {}),
			capturedAt: 1,
		},
		budget: {
			configured: true,
			maxWorkerInvocations: 4,
			workerInvocations: 2,
			reportedTokens: 123,
			exceeded: false,
			reason: null,
		},
		workerMeasurements: [
			{
				role: "Developer",
				profile: "coding",
				revision: 0,
				step: { stepId: "implement", attempt: 1 },
				requestedProvider: "commandcode",
				requestedModel: "deepseek/deepseek-v4.1-flash",
				actualProvider: "commandcode",
				actualModel: "deepseek/deepseek-v4.1-flash",
				responseModel: "deepseek-v4.1-flash-2026-09",
				providerThinkingLevel: "medium",
				startedAt: 1,
				finishedAt: 2,
				durationMs: 1,
				modelTurns: 3,
				toolCalls: 2,
				toolCallsByName: { runtime_read: 1, runtime_edit: 1 },
				usage: {
					source: "provider",
					input: 1,
					output: 2,
					cacheRead: 3,
					cacheWrite: 0,
					totalTokens: 6,
					reasoning: 1,
				},
				outcome: "SUCCEEDED",
			},
		],
	});
}

describe("V0.3F evidence pack", () => {
	it("projects a completed run without becoming an authority and renders unknown cost honestly", () => {
		const run = completedRun();
		const pack = projectEvidencePack({
			run,
			report: { changedFiles: ["src/app.ts"], partialChanges: false, changesUnknown: false },
		});
		expect(pack.status).toBe("COMPLETED");
		expect(pack.failure).toBeNull();
		expect(pack.cleanup).toBe("confirmed");
		expect(pack.taskContract?.criteria.map((criterion) => criterion.id)).toEqual(["AC-001"]);
		expect(pack.workers).toHaveLength(1);
		expect(pack.workers[0]).toMatchObject({ role: "Developer", thinking: "medium", reportedTokens: 6 });
		expect(pack.budget).toMatchObject({ configured: true, workerInvocations: 2, reportedTokens: 123 });
		expect(pack.provenance.runtimeSourceCommit).toBe("b".repeat(40));
		const text = formatEvidencePack(pack);
		expect(text).toContain("Estimated cost: UNKNOWN");
		expect(text).toContain("AC-001");
		expect(text).toContain("Developer implement@1");
		expect(text).toContain("not an execution authority");
		expect(text).not.toContain("$0.00");
	});

	it("keeps legacy runs honest instead of fabricating criteria or measurements", () => {
		const legacy = validateContract(RunSchema, {
			...graphRun("QUICK", "R1", 0),
			tasks: [{ id: "task", goal: "Goal", requirements: ["Goal"], status: "completed" }],
		});
		const pack = projectEvidencePack({ run: legacy });
		expect(pack.acceptanceLegacyUnknown).toBe(true);
		expect(pack.taskContract).toBeNull();
		expect(pack.workers).toEqual([]);
		expect(pack.budget.configured).toBe(false);
		expect(pack.limitations.join(" ")).toContain("Legacy run");
		const text = formatEvidencePack(pack);
		expect(text).toContain("Acceptance criteria: UNKNOWN (legacy)");
		expect(text).not.toContain("AC-001");
	});

	it.each([
		["provider failure", { status: "FAILED" as const, lastError: "Worker provider failed" }, "PROVIDER"],
		["tool failure", { status: "FAILED" as const, lastError: "Worker tool failed or was denied" }, "TOOL"],
		["policy denial", { status: "FAILED" as const, lastError: "Policy R0/DENY: Protected target" }, "POLICY"],
		[
			"budget denial",
			{ status: "BLOCKED" as const, lastError: "Budget exhausted: worker invocation limit 1 reached" },
			"BUDGET",
		],
		[
			"storage failure",
			{ status: "FAILED" as const, lastError: "Runtime storage failed (state.json); further writes are disabled" },
			"STORAGE",
		],
		["unclassified failure", { status: "FAILED" as const, lastError: "something else" }, "UNKNOWN"],
	])("classifies %s from structured state only", (_name, patch, expected) => {
		const run = validateContract(RunSchema, { ...graphRun("STANDARD", "R1", 0), ...patch });
		const pack = projectEvidencePack({ run });
		expect(pack.failure?.category).toBe(expected);
	});

	it("marks cleanup uncertain without claiming a clean completion", () => {
		const run = completedRun();
		const pack = projectEvidencePack({
			run,
			report: {
				changedFiles: ["src/app.ts"],
				partialChanges: true,
				changesUnknown: true,
				error: "Resource cleanup unconfirmed",
			},
		});
		expect(pack.cleanup).toBe("uncertain");
		expect(pack.partialChanges).toBe(true);
		expect(formatEvidencePack(pack)).toContain("cleanup: uncertain");
	});
});

describe("V0.5A context pack measurement summary", () => {
	const identity = {
		role: "Developer" as const,
		profile: "coding",
		revision: 0,
		step: { stepId: "implement" as const, attempt: 1 },
		requestedProvider: "faux",
		requestedModel: "coding",
	};
	const summary = {
		mode: "bounded" as const,
		digest: `sha256:${"a".repeat(64)}`,
		bytes: 8120,
		relatedFileCount: 4,
		symbolCount: 2,
		snippetCount: 3,
		unknownCount: 1,
		truncated: false,
	};

	it("preserves the delivered pack summary for every outcome", () => {
		for (const outcome of ["SUCCEEDED", "FAILED", "CANCELLED"] as const) {
			const accumulator = new WorkerMeasurementAccumulator(identity, Date.now, summary);
			const measurement = accumulator.finish(outcome);
			expect(measurement.outcome).toBe(outcome);
			expect(measurement.contextPack).toEqual(summary);
			// Bounded metadata only: no snippet text, source text or path lists.
			expect(JSON.stringify(measurement)).not.toContain("src/");
		}
	});

	it("omits the summary when no pack was delivered and accepts legacy measurements", () => {
		const measurement = new WorkerMeasurementAccumulator(identity).finish("SUCCEEDED");
		expect(measurement.contextPack).toBeUndefined();
		const legacy = structuredClone(measurement);
		expect(validateContract(WorkerMeasurementSchema, legacy)).toEqual(legacy);
		const withContext = structuredClone(measurement);
		withContext.contextPack = summary;
		expect(validateContract(WorkerMeasurementSchema, withContext).contextPack).toEqual(summary);
		expect(() =>
			validateContract(WorkerMeasurementSchema, { ...withContext, contextPack: { ...summary, mode: "disabled" } }),
		).toThrow();
	});
});

describe("V0.5A context projections", () => {
	it("projects a bounded context summary per worker without raw context", () => {
		const run = graphRun("STANDARD", "R1", 0);
		const measurement = validateContract(WorkerMeasurementSchema, {
			role: "Developer",
			profile: "coding",
			revision: 0,
			step: { stepId: "implement", attempt: 1 },
			requestedProvider: "commandcode",
			requestedModel: "deepseek/deepseek-v4.1-flash",
			actualProvider: "commandcode",
			actualModel: "deepseek/deepseek-v4.1-flash",
			startedAt: 1,
			finishedAt: 2,
			durationMs: 1,
			modelTurns: 3,
			toolCalls: 2,
			toolCallsByName: { runtime_read: 2 },
			usage: { source: "unavailable", input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
			outcome: "SUCCEEDED",
			contextPack: {
				mode: "bounded",
				digest: `sha256:${"a".repeat(64)}`,
				bytes: 8120,
				relatedFileCount: 4,
				symbolCount: 2,
				snippetCount: 3,
				unknownCount: 1,
				truncated: false,
			},
		});
		const pack = projectEvidencePack({
			run: { ...run, workerMeasurements: [measurement] } as never,
			report: { changedFiles: [], partialChanges: false, changesUnknown: false } as never,
		});
		const text = formatEvidencePack(pack);
		expect(text).toContain("Developer context: bounded sha256:aaaaaaaaaaaaa…");
		expect(text).toContain("files 4");
		expect(text).toContain("truncated no");
		expect(JSON.stringify(pack.workers)).not.toContain("src/");
		// Legacy measurements without a context summary still project.
		const legacy = structuredClone(measurement);
		delete legacy.contextPack;
		const legacyPack = projectEvidencePack({
			run: { ...run, workerMeasurements: [legacy] } as never,
			report: { changedFiles: [], partialChanges: false, changesUnknown: false } as never,
		});
		expect(formatEvidencePack(legacyPack)).toContain("Developer context: disabled");
	});
});

describe("V0.5B recipe provenance", () => {
	it("records a reviewed recipe and stays backward compatible", async () => {
		const temp = await mkdtemp(join(tmpdir(), "weavra-recipe-prov-"));
		try {
			const recipe = { id: "bugfix", version: 1, digest: `sha256:${"c".repeat(64)}` };
			const provenance = captureProvenance({ cwd: temp, configDigest: "config", recipe });
			expect(provenance.recipe).toEqual(recipe);
			expect(captureProvenance({ cwd: temp }).recipe).toBeUndefined();
			// Historical records without the field stay valid.
			const legacy = structuredClone(provenance);
			delete legacy.recipe;
			expect(validateContract(ProvenanceSchema, legacy).recipe).toBeUndefined();
			// Malformed recipe metadata is rejected at the contract boundary.
			expect(() =>
				validateContract(ProvenanceSchema, { ...provenance, recipe: { id: "bugfix", version: 0, digest: "x" } }),
			).toThrow();
		} finally {
			await rm(temp, { recursive: true, force: true });
		}
	});
});
