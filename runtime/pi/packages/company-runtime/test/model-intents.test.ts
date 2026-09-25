import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRuntimeConfig, type RuntimeConfig } from "../src/config.ts";
import { type Run, RunSchema, validateContract } from "../src/contracts.ts";
import { taskContractDigest } from "../src/criterion-evidence.ts";
import { formatEvidencePack, projectEvidencePack } from "../src/evidence.ts";
import { finalizeHostWorkflowPlan, HostWorkflowError, prepareHostWorkflowDraft } from "../src/host-workflow.ts";
import { type WorkerMeasurement, WorkerMeasurementSchema } from "../src/measurement-types.ts";
import { type ModelIntent, resolveModelRoute, workflowModelRoutes } from "../src/model-routing.ts";
import { formatConfiguration, formatRunView } from "../src/observations.ts";
import { formatPlanPreview } from "../src/plan-preview.ts";
import { parseWorkflowRunArgument, WorkflowRunArgumentError } from "../src/task-recipe-command.ts";
import { graphRun } from "./graph-fixtures.ts";

// Issue #5, candidate 3: model intent profiles are a thin alias layer over models.profiles.
const profiles = {
	coding: { provider: "faux", model: "coding" },
	reasoning: { provider: "faux", model: "review" },
	fast: { provider: "faux", model: "fast" },
	creative: { provider: "faux", model: "creative" },
};
function config(models: Record<string, unknown> = { profiles }): RuntimeConfig {
	return parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models,
			files: { allowed_paths: ["src"] },
			verification: { checks: [{ id: "test", kind: "test", executable: "never-execute", args: [] }] },
		}),
	);
}
const aliased = () =>
	config({ profiles, intents: { simple: "fast", standard: "creative", review: "coding", deep: "reasoning" } });

function prepareError(input: Parameters<typeof prepareHostWorkflowDraft>[0]): HostWorkflowError {
	try {
		prepareHostWorkflowDraft(input);
	} catch (error) {
		if (error instanceof HostWorkflowError) return error;
		throw error;
	}
	throw new Error("prepare unexpectedly succeeded");
}

function measurement(
	role: WorkerMeasurement["role"],
	route: { profile: string; model: string; actual?: string; modelIntent?: ModelIntent },
): WorkerMeasurement {
	return validateContract(WorkerMeasurementSchema, {
		role,
		profile: route.profile,
		...(route.modelIntent ? { modelIntent: route.modelIntent } : {}),
		revision: 0,
		step: { stepId: role === "Reviewer" ? "review" : "implement", attempt: 1 },
		requestedProvider: "faux",
		requestedModel: route.model,
		actualProvider: "faux",
		actualModel: route.actual ?? route.model,
		startedAt: 1,
		finishedAt: 2,
		durationMs: 1,
		modelTurns: 1,
		toolCalls: 1,
		toolCallsByName: { submit_handoff: 1 },
		usage: { source: "provider", input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
		outcome: "SUCCEEDED",
	});
}
function measuredRun(workflow: "QUICK" | "STANDARD", workerMeasurements: WorkerMeasurement[]): Run {
	return validateContract(RunSchema, { ...graphRun(workflow, "R1", 0), workerMeasurements });
}

describe("#5 model intent config and deterministic role routing", () => {
	it("keeps today's routing and normalized config when no alias is configured", () => {
		const plain = config();
		expect(plain.models).toEqual({ profiles });
		expect("intents" in plain.models).toBe(false);
		expect(workflowModelRoutes(plain, "QUICK")).toEqual([
			{
				role: "Executor",
				intent: "simple",
				source: "default",
				profile: "coding",
				provider: "faux",
				model: "coding",
			},
		]);
		for (const workflow of ["STANDARD", "COMPLEX"] as const)
			expect(workflowModelRoutes(plain, workflow)).toEqual([
				{
					role: "Developer",
					intent: "standard",
					source: "default",
					profile: "coding",
					provider: "faux",
					model: "coding",
				},
				{
					role: "Reviewer",
					intent: "review",
					source: "default",
					profile: "reasoning",
					provider: "faux",
					model: "review",
				},
			]);
	});

	it("maps each alias to exactly its role and leaves unset aliases at the role default", () => {
		const value = aliased();
		expect(value.models.intents).toEqual({
			simple: "fast",
			standard: "creative",
			review: "coding",
			deep: "reasoning",
		});
		expect(resolveModelRoute(value, "Executor")).toMatchObject({ intent: "simple", source: "config", model: "fast" });
		expect(resolveModelRoute(value, "Developer")).toMatchObject({
			intent: "standard",
			source: "config",
			profile: "creative",
			model: "creative",
		});
		expect(resolveModelRoute(value, "Reviewer")).toMatchObject({
			intent: "review",
			source: "config",
			model: "coding",
		});
		// The explicit per-run deep choice moves only Developers.
		expect(resolveModelRoute(value, "Developer", true)).toMatchObject({
			intent: "deep",
			source: "config",
			profile: "reasoning",
			model: "review",
		});
		expect(resolveModelRoute(value, "Reviewer", true)).toMatchObject({ intent: "review", model: "coding" });
		expect(resolveModelRoute(value, "Executor", true)).toMatchObject({ intent: "simple", model: "fast" });
		const reviewOnly = config({ profiles, intents: { review: "fast" } });
		expect(workflowModelRoutes(reviewOnly, "QUICK")[0]).toMatchObject({ source: "default", profile: "coding" });
		expect(workflowModelRoutes(reviewOnly, "STANDARD").map(({ source, profile }) => [source, profile])).toEqual([
			["default", "coding"],
			["config", "fast"],
		]);
	});

	it("rejects an alias naming an unconfigured profile and unknown alias or profile names", () => {
		const base = { coding: profiles.coding, reasoning: profiles.reasoning };
		expect(() => config({ profiles: base, intents: { simple: "fast" } })).toThrow(
			"Invalid runtime config: models.intents.simple names profile fast, which is not configured in models.profiles",
		);
		for (const intents of [
			{ planner: "coding" },
			{ simple: "turbo" },
			{ simple: { provider: "faux", model: "fast" } },
			{ deep: "" },
		])
			expect(() => config({ profiles, intents })).toThrow(/^Invalid runtime config: check schemaVersion/);
		// A programmatic config that bypasses the parser still fails instead of choosing another model.
		const forged = config({ profiles: base });
		forged.models.intents = { review: "fast" };
		expect(() => resolveModelRoute(forged, "Reviewer")).toThrow(
			"Model intent review names unconfigured profile fast; fallback disabled",
		);
	});

	it("validates the README intents snippet as a complete models block", () => {
		const document = readFileSync(new URL("../README.md", import.meta.url), "utf8");
		const blocks = [...document.matchAll(/```yaml\n([\s\S]*?)\n```/g)].filter((block) =>
			/^ {2}intents:/m.test(block[1]),
		);
		expect(blocks).toHaveLength(1);
		const value = parseRuntimeConfig(`schemaVersion: 1\n${blocks[0][1]}`);
		expect(
			workflowModelRoutes(value, "QUICK").map(({ intent, source, profile }) => [intent, source, profile]),
		).toEqual([["simple", "config", "fast"]]);
		expect(
			workflowModelRoutes(value, "STANDARD").map(({ intent, source, profile }) => [intent, source, profile]),
		).toEqual([
			["standard", "default", "coding"],
			["review", "config", "reasoning"],
		]);
		expect(resolveModelRoute(value, "Developer", true)).toMatchObject({ intent: "deep", profile: "reasoning" });
	});

	it("never selects deep automatically and refuses deep without models.intents.deep", () => {
		const value = aliased();
		for (const workflow of ["QUICK", "STANDARD", "COMPLEX"] as const)
			expect(workflowModelRoutes(value, workflow).map((route) => route.intent)).not.toContain("deep");
		expect(() => resolveModelRoute(config(), "Developer", true)).toThrow(
			"Model intent deep is not configured (models.intents.deep); it is never selected automatically",
		);
	});

	it("parses --deep only as an explicit leading run flag", () => {
		expect(parseWorkflowRunArgument("--deep Fix bug")).toEqual({ goal: "Fix bug", deep: true });
		expect(parseWorkflowRunArgument("--deep --recipe bugfix Fix bug")).toEqual({
			goal: "Fix bug",
			recipeId: "bugfix",
			deep: true,
		});
		expect(parseWorkflowRunArgument("--recipe bugfix --deep Fix bug")).toEqual({
			goal: "Fix bug",
			recipeId: "bugfix",
			deep: true,
		});
		// Goal text never implies the flag.
		expect(parseWorkflowRunArgument("Explain what --deep means")).toEqual({ goal: "Explain what --deep means" });
		expect(parseWorkflowRunArgument("Fix the deep link parser")).toEqual({ goal: "Fix the deep link parser" });
		for (const argument of ["--deep", "--deep --deep Fix bug", "--deep=true Fix bug", "--deeper Fix bug"])
			expect(() => parseWorkflowRunArgument(argument)).toThrow(WorkflowRunArgumentError);
	});
});

describe("#5 Host planning and Plan Preview", () => {
	it("previews alias -> profile -> provider/model and where each route came from", () => {
		const quick = formatPlanPreview(
			finalizeHostWorkflowPlan(prepareHostWorkflowDraft({ goal: "Fix typo in src/a.ts", config: aliased() }))
				.preview,
		).split("\n");
		expect(quick).toContain(
			"Models (alias -> profile -> provider/model; fixed per role, no automatic selection or fallback; never changes contract, risk, Policy or review):",
		);
		expect(quick).toContain("  Executor: simple -> fast -> faux/fast (models.intents.simple)");
		expect(quick.filter((line) => /^ {2}(Executor|Developer|Reviewer): /.test(line))).toHaveLength(1);
		const standard = formatPlanPreview(
			finalizeHostWorkflowPlan(prepareHostWorkflowDraft({ goal: "Fix bug in src/a.ts", config: config() })).preview,
		).split("\n");
		expect(standard).toContain("  Developer: standard -> coding -> faux/coding (role default; no alias configured)");
		expect(standard).toContain("  Reviewer: review -> reasoning -> faux/review (role default; no alias configured)");
	});

	it("uses models.intents.deep only for an explicit deep STANDARD plan and refuses it otherwise before any Run", () => {
		const goal = "Fix bug in src/a.ts";
		const ordinary = finalizeHostWorkflowPlan(prepareHostWorkflowDraft({ goal, config: aliased() }));
		expect(ordinary.deep).toBeUndefined();
		expect(ordinary.preview.modelRoutes.map((route) => route.intent)).toEqual(["standard", "review"]);
		const deep = finalizeHostWorkflowPlan(prepareHostWorkflowDraft({ goal, config: aliased(), deep: true }));
		expect(deep.deep).toBe(true);
		const text = formatPlanPreview(deep.preview).split("\n");
		expect(text).toContain(
			"  Developer: deep -> reasoning -> faux/review (models.intents.deep; explicit --deep for this run)",
		);
		expect(text).toContain("  Reviewer: review -> coding -> faux/coding (models.intents.review)");
		const missing = prepareError({ goal, config: config(), deep: true });
		expect(missing.code).toBe("INVALID_REQUEST");
		expect(missing.message).toBe(
			"--deep needs models.intents.deep naming a configured profile in .ai/config.yaml; deep is never selected automatically and has no fallback",
		);
		for (const quickGoal of ["Fix typo in src/a.ts", "Explain src/a.ts"]) {
			const quick = prepareError({ goal: quickGoal, config: aliased(), deep: true });
			expect(quick.code).toBe("UNSUPPORTED_WORKFLOW");
			expect(quick.message).toContain("this goal selects QUICK (one Executor, no Developer)");
		}
	});

	it("never changes the Task Contract, risk, workflow, execution mode or checks", () => {
		const goal = "Fix bug in src/a.ts";
		const plans = [
			prepareHostWorkflowDraft({ goal, config: config() }),
			prepareHostWorkflowDraft({ goal, config: aliased() }),
			prepareHostWorkflowDraft({ goal, config: aliased(), deep: true }),
		].map((draft) => finalizeHostWorkflowPlan(draft));
		const identity = plans.map((plan) => ({
			workflow: plan.workflow,
			risk: plan.risk,
			executionMode: plan.executionMode,
			checks: plan.preview.checks,
			allowedPaths: plan.preview.allowedPaths,
			criteria: plan.taskContract.acceptanceCriteria,
			digest: taskContractDigest({ ...plan.taskContract, id: "same-task" }),
		}));
		expect(identity[1]).toEqual(identity[0]);
		expect(identity[2]).toEqual(identity[0]);
		expect(identity[0]).toMatchObject({ workflow: "STANDARD", risk: "R1", executionMode: "EDIT" });
	});
});

describe("#5 recorded routing in status, /team, /workflow config and the Evidence Pack", () => {
	it("shows the recorded alias/profile with requested and actual provider/model per role", () => {
		const run = measuredRun("STANDARD", [
			measurement("Developer", { profile: "reasoning", model: "review", modelIntent: "deep" }),
			measurement("Reviewer", { profile: "coding", model: "coding", modelIntent: "review" }),
			measurement("Reviewer", { profile: "coding", model: "coding", actual: "coding-2026", modelIntent: "review" }),
		]);
		const expected = [
			"Models (recorded per role; alias -> profile -> requested provider/model; actual as reported; no fallback):",
			"  Developer: deep -> reasoning (models.intents.deep; explicit --deep for this run) -> requested faux/review; actual faux/review | 1 invocation(s)",
			"  Reviewer: review -> coding (models.intents.review) -> requested faux/coding; actual faux/coding | 1 invocation(s)",
			"  Reviewer: review -> coding (models.intents.review) -> requested faux/coding; actual faux/coding-2026 | 1 invocation(s)",
		];
		const status = formatRunView("workflow", { run, source: "stored snapshot" }).split("\n");
		for (const line of expected) expect(status).toContain(line);
		const team = formatRunView("team", { run, source: "stored snapshot" });
		expect(team).toContain("Developer (deep -> reasoning): inactive");
		expect(team).toContain("Reviewer (review -> coding): inactive");
		const pack = projectEvidencePack({ run });
		expect(pack.workers[0]).toMatchObject({
			role: "Developer",
			profile: "reasoning",
			modelIntent: "deep",
			requestedProvider: "faux",
			requestedModel: "review",
			provider: "faux",
			model: "review",
		});
		const evidence = formatEvidencePack(pack).split("\n");
		for (const line of expected) expect(evidence).toContain(line);
	});

	it("labels measurements without an alias as role defaults and missing invocations honestly", () => {
		const standard = measuredRun("STANDARD", [measurement("Developer", { profile: "coding", model: "coding" })]);
		const status = formatRunView("state", { run: standard, source: "stored snapshot" }).split("\n");
		expect(status).toContain(
			"  Developer: standard -> coding (role default; no alias configured) -> requested faux/coding; actual faux/coding | 1 invocation(s)",
		);
		expect(status).toContain("  Reviewer: no invocation recorded");
		const team = formatRunView("team", { run: standard, source: "stored snapshot" });
		expect(team).toContain("Developer (coding): inactive");
		expect(team).toContain("Reviewer (profile not recorded): inactive");
		expect(projectEvidencePack({ run: standard }).workers[0].modelIntent).toBeNull();
		const quick = measuredRun("QUICK", [
			measurement("Executor", { profile: "fast", model: "fast", modelIntent: "simple" }),
		]);
		const quickStatus = formatRunView("workflow", { run: quick, source: "stored snapshot" });
		expect(quickStatus).toContain(
			"  Executor: simple -> fast (models.intents.simple) -> requested faux/fast; actual faux/fast | 1 invocation(s)",
		);
		expect(quickStatus).not.toMatch(/^ {2}(Developer|Reviewer): /m);
	});

	it("accepts only the four aliases in a measurement and keeps older measurements valid", () => {
		const legacy = measurement("Developer", { profile: "coding", model: "coding" });
		expect("modelIntent" in legacy).toBe(false);
		expect(validateContract(WorkerMeasurementSchema, legacy)).toEqual(legacy);
		expect(() => validateContract(WorkerMeasurementSchema, { ...legacy, modelIntent: "planner" })).toThrow();
	});

	it("lists aliases in /workflow config without resolving providers", () => {
		const aliasedText = formatConfiguration(aliased()).split("\n");
		for (const line of [
			"fast: faux/fast (models.intents: simple)",
			"creative: faux/creative (models.intents: standard)",
			"Model intents (fixed per role; no automatic selection or fallback):",
			"  Executor: simple -> fast (models.intents.simple)",
			"  Developer: standard -> creative (models.intents.standard)",
			"  Reviewer: review -> coding (models.intents.review)",
			"  deep: reasoning; only for STANDARD Developers of an explicit /workflow run --deep <goal>",
		])
			expect(aliasedText).toContain(line);
		const plainText = formatConfiguration(config()).split("\n");
		for (const line of [
			"fast: faux/fast (not auto-selected)",
			"  Developer: standard -> coding (role default; no alias configured)",
			"  deep: not configured; /workflow run --deep is refused",
		])
			expect(plainText).toContain(line);
	});
});
