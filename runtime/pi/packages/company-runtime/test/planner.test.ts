import { createHash } from "node:crypto";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BudgetController } from "../src/budget.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../src/config.ts";
import { HostWorkflowError } from "../src/host-workflow.ts";
import type { WorkerMeasurement } from "../src/measurement.ts";
import { resolvePlannerRoute } from "../src/model-routing.ts";
import { formatConfiguration } from "../src/observations.ts";
import {
	buildPlanningContext,
	PLANNER_CONTEXT_MAX_BYTES,
	PLANNER_CORRECTION_MAX_BYTES,
	PlannerFailure,
	plannerClassification,
	plannerCorrection,
	plannerCriteria,
	plannerRequestDigest,
} from "../src/planner.ts";
import * as facts from "../src/project-facts.ts";
import { COMPLEX_GOAL, CONFIG, STATEMENTS } from "./planner-fixture.ts";

const config = (value: unknown = CONFIG): RuntimeConfig => parseRuntimeConfig(JSON.stringify(value));
function refusal(action: () => unknown): HostWorkflowError {
	try {
		action();
	} catch (error) {
		if (error instanceof HostWorkflowError) return error;
		throw error;
	}
	throw new Error("expected a HostWorkflowError");
}

describe("§6 request digest", () => {
	it("is sha256 over the UTF-8 JSON of the domain, the goal and the statements exactly as sent", () => {
		const independent = (value: unknown) =>
			`sha256:${createHash("sha256")
				.update(Buffer.from(JSON.stringify(value), "utf8"))
				.digest("hex")}`;
		expect(plannerRequestDigest(COMPLEX_GOAL, STATEMENTS)).toBe(
			independent(["weavra-planner-request-v1", COMPLEX_GOAL, STATEMENTS]),
		);
		// Omitted statements are []; never the goal-as-criterion that prepare derives.
		expect(plannerRequestDigest(COMPLEX_GOAL)).toBe(independent(["weavra-planner-request-v1", COMPLEX_GOAL, []]));
		expect(plannerRequestDigest(COMPLEX_GOAL)).not.toBe(plannerRequestDigest(COMPLEX_GOAL, [COMPLEX_GOAL]));
		// Exactly as sent: whitespace and order are part of the request.
		expect(plannerRequestDigest(COMPLEX_GOAL, [...STATEMENTS].reverse())).not.toBe(
			plannerRequestDigest(COMPLEX_GOAL, STATEMENTS),
		);
		expect(plannerRequestDigest(`${COMPLEX_GOAL} `, STATEMENTS)).not.toBe(
			plannerRequestDigest(COMPLEX_GOAL, STATEMENTS),
		);
		expect(plannerRequestDigest("계획 한국어", ["기준 하나"])).toMatch(/^sha256:[0-9a-f]{64}$/);
		// Fixtures shared with the App (#53), which computes the same digest.
		const goal = "Split the config parser into parse and validate modules";
		expect(
			plannerRequestDigest(goal, [
				"parseConfig keeps its current behavior",
				"validateConfig rejects duplicate keys",
			]),
		).toBe("sha256:29350ea702ea51a4b633fb065b20653d2070a6e744e76f0ac605424e4179f9f6");
		expect(plannerRequestDigest(goal)).toBe(
			"sha256:7e83f534ce4638c8d468a3b44612444054b37f8e66a7f8383c19cee1a3d0842c",
		);
	});
});

describe("§5.1 Planner routing", () => {
	it("uses the reasoning profile without an alias, models.intents.plan when set, and never falls back", () => {
		expect(resolvePlannerRoute(config())).toEqual({
			role: "Planner",
			alias: null,
			profile: "reasoning",
			provider: "faux",
			model: "review",
		});
		const aliased = config({
			...CONFIG,
			models: {
				...CONFIG.models,
				profiles: { ...CONFIG.models.profiles, fast: { provider: "faux", model: "fast" } },
				intents: { plan: "fast" },
			},
		});
		expect(aliased.models.intents).toEqual({ plan: "fast" });
		expect(resolvePlannerRoute(aliased)).toEqual({
			role: "Planner",
			alias: "plan",
			profile: "fast",
			provider: "faux",
			model: "fast",
		});
		expect(() => config({ ...CONFIG, models: { ...CONFIG.models, intents: { plan: "fast" } } })).toThrow(
			"models.intents.plan names profile fast, which is not configured",
		);
		const forged = config();
		forged.models.intents = { plan: "creative" };
		expect(() => resolvePlannerRoute(forged)).toThrow(
			"Model intent plan names unconfigured profile creative; fallback disabled",
		);
		// Configuration view: the Planner route is listed and is never a Run worker.
		expect(formatConfiguration(aliased).split("\n")).toContain(
			"  Planner: plan -> fast (models.intents.plan); Host Control planning drafts only, never a Run worker",
		);
		expect(formatConfiguration(config()).split("\n")).toContain(
			"  Planner: plan -> reasoning (role default; no alias configured); Host Control planning drafts only, never a Run worker",
		);
	});
});

describe("§7.2 classification and criteria", () => {
	it("proceeds exactly for a draftless COMPLEX prepare refusal with a non-R3 Risk", () => {
		expect(plannerClassification(COMPLEX_GOAL, config())).toEqual({ executionMode: "EDIT", risk: "R1" });
		expect(plannerClassification("Explain the architecture across multiple modules", config())).toMatchObject({
			executionMode: "READ_ONLY",
		});
		expect(refusal(() => plannerClassification("Fix bug in src/app.ts", config()))).toMatchObject({
			code: "UNSUPPORTED_WORKFLOW",
			message: "The Planner drafts COMPLEX plans only; this goal selects STANDARD",
		});
		expect(refusal(() => plannerClassification("Fix typo in src/app.ts", config()))).toMatchObject({
			code: "UNSUPPORTED_WORKFLOW",
			message: "The Planner drafts COMPLEX plans only; this goal selects QUICK",
		});
		const complexOnly = config({ ...CONFIG, runtime: { workflow: "COMPLEX" } });
		expect(refusal(() => plannerClassification("delete file src/app.ts", complexOnly))).toMatchObject({
			code: "UNSUPPORTED_WORKFLOW",
			message: "R3 COMPLEX goals are not planned; the Planner never drafts a deletion",
		});
		expect(
			refusal(() => plannerClassification("Explain and fix the parser across multiple modules", config())).code,
		).toBe("INVALID_GOAL");
	});

	it("labels criteria as prepare freezes them and refuses statements prepare would refuse", () => {
		expect(plannerCriteria(COMPLEX_GOAL, STATEMENTS, config())).toEqual([
			{ id: "AC-001", statement: "The parser is split into modules" },
			{ id: "AC-002", statement: "Duplicate keys are rejected" },
		]);
		expect(plannerCriteria(COMPLEX_GOAL, undefined, config())).toEqual([{ id: "AC-001", statement: COMPLEX_GOAL }]);
		expect(plannerCriteria(COMPLEX_GOAL, ["  spaced   out  "], config())).toEqual([
			{ id: "AC-001", statement: "spaced out" },
		]);
		expect(refusal(() => plannerCriteria(COMPLEX_GOAL, ["Same", "same "], config()))).toMatchObject({
			code: "INVALID_REQUEST",
			message: "Duplicate acceptance criteria are not allowed",
		});
		expect(refusal(() => plannerCriteria(`${COMPLEX_GOAL} ${"x".repeat(500)}`, undefined, config())).code).toBe(
			"INVALID_REQUEST",
		);
	});
});

describe("§5.3 correction message", () => {
	it("carries only the Host code and the compiler message, bounded to 2,048 UTF-8 bytes", () => {
		const short = plannerCorrection("INVALID_CRITERIA", 'CT-002 claim "docs/a.md" is denied by current Policy');
		expect(short).toBe(
			'submit_plan_draft rejected (INVALID_CRITERIA): CT-002 claim "docs/a.md" is denied by current Policy\nNothing was accepted. Correct the draft and call submit_plan_draft once more, alone. This is the only correction.',
		);
		for (const unit of ["x", "한", "😀"]) {
			const long = plannerCorrection("INVALID_CRITERIA", unit.repeat(5000));
			expect(Buffer.byteLength(long, "utf8")).toBeLessThanOrEqual(PLANNER_CORRECTION_MAX_BYTES);
			expect(long).toContain(" …(truncated)\nNothing was accepted.");
			// Never a broken code point.
			expect(Buffer.from(long, "utf8").toString("utf8")).toBe(long);
		}
	});
});

describe("BudgetController usage settlement", () => {
	it("recordUsage settles exactly like record", () => {
		const measurement = (source: "provider" | "unavailable", totalTokens: number) =>
			({ usage: { source, input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens } }) as WorkerMeasurement;
		const denial = (budget: BudgetController) => {
			try {
				budget.reserve("Planner");
				return null;
			} catch (error) {
				return (error as Error).message;
			}
		};
		for (const sequence of [
			[
				["provider", 10],
				["provider", 5],
				["provider", 1],
			],
			[
				["unavailable", 0],
				["provider", 5],
			],
			[
				["provider", 300],
				["provider", 1],
			],
		] as const) {
			const left = new BudgetController({ maxWorkerInvocations: 3, maxReportedTokens: 200 });
			const right = new BudgetController({ maxWorkerInvocations: 3, maxReportedTokens: 200 });
			for (const [source, tokens] of sequence) {
				const denied = denial(left);
				expect(denial(right)).toBe(denied);
				if (denied) break;
				left.record("Planner", measurement(source, tokens));
				right.recordUsage("Planner", { source, totalTokens: tokens });
				expect(right.status).toEqual(left.status);
			}
			expect(denial(right)).toBe(denial(left));
			expect(right.status).toEqual(left.status);
		}
	});
});

describe("§4 Planning Context", () => {
	let root: string;
	let cwd: string;
	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "wv-plan-ctx-")));
		cwd = join(root, "project");
		await mkdir(join(cwd, ".ai"), { recursive: true });
		await mkdir(join(cwd, "src/nested"), { recursive: true });
		await mkdir(join(cwd, "src/node_modules/pkg"), { recursive: true });
		await mkdir(join(cwd, "src/.ai"), { recursive: true });
		for (const [path, content] of Object.entries({
			"src/app.ts": "export const app = 1;\n",
			"src/nested/util.ts": "SECRET_FILE_CONTENT\n",
			"src/.env": "TOKEN=abc\n",
			"src/key.pem": "-----BEGIN PRIVATE KEY-----\n",
			"src/credentials.json": "{}\n",
			"src/node_modules/pkg/index.js": "module.exports = 1;\n",
			"src/.ai/state.json": "{}\n",
			"src/oracle.test.ts": "trusted verifier source\n",
			"src/AGENTS.md": "Always keep modules small.\n",
			"docs.md": "outside allowed paths\n",
		}))
			await writeFile(join(cwd, path), content);
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await rm(root, { recursive: true, force: true });
	});
	const contextConfig = () =>
		config({
			...CONFIG,
			project: { instructions: { path: "src/AGENTS.md" } },
			verification: {
				trust: { mode: "strict" },
				checks: [
					{ id: "lint", kind: "lint", executable: "/usr/bin/true", args: ["--secret-arg"], required: false },
					{
						id: "test",
						kind: "test",
						executable: "/usr/bin/true",
						args: ["--test-arg"],
						trust: { files: ["src/oracle.test.ts"] },
					},
				],
			},
		});
	const build = (value: RuntimeConfig = contextConfig(), statements: string[] | null = STATEMENTS) =>
		buildPlanningContext({
			cwd,
			goal: COMPLEX_GOAL,
			...(statements ? { acceptanceStatements: statements } : {}),
			config: value,
			executionMode: "EDIT",
			risk: "R1",
			signal: new AbortController().signal,
		});

	it("is one bounded JSON object with role Planner, names only and no .ai, protected, secret or command data (L13)", async () => {
		const context = await build();
		expect(context.bytes).toBe(Buffer.byteLength(context.prompt, "utf8"));
		expect(context.bytes).toBeLessThanOrEqual(PLANNER_CONTEXT_MAX_BYTES);
		const value = JSON.parse(context.prompt);
		expect(Object.keys(value)).toEqual([
			"role",
			"goal",
			"acceptanceCriteria",
			"executionMode",
			"risk",
			"planRules",
			"checks",
			"allowedPaths",
			"fileListing",
			"projectInstructions",
			"projectFacts",
		]);
		expect(value).toMatchObject({
			role: "Planner",
			goal: COMPLEX_GOAL,
			acceptanceCriteria: [
				{ id: "AC-001", statement: "The parser is split into modules" },
				{ id: "AC-002", statement: "Duplicate keys are rejected" },
			],
			executionMode: "EDIT",
			risk: "R1",
			// id, kind, required and the A1 exercises only: never an executable, argument or verifier source.
			checks: [
				{ id: "lint", kind: "lint", required: false, exercises: [] },
				{ id: "test", kind: "test", required: true, exercises: [] },
			],
			allowedPaths: ["src"],
			// The runtime_list_files rules: .ai/, protected paths, instructions, trust sources and node_modules are absent.
			fileListing: { files: ["src/app.ts", "src/nested/util.ts"], truncated: false },
			projectInstructions: { path: "src/AGENTS.md", content: "Always keep modules small.\n" },
			projectFacts: [],
		});
		expect(value.planRules).toHaveLength(10);
		// Amendment A1 (#65): one plan rule prefers a check's exercises for the claims of its criteria.
		expect(value.planRules).toContain(
			'Each check\'s exercises lists files inside allowedPaths that the check imports. Prefer those paths when choosing claims for the criteria that check verifies: a missing path is a "create" claim and an existing one is "modify".',
		);
		expect(context.prompt).not.toMatch(
			/SECRET_FILE_CONTENT|TOKEN=|PRIVATE KEY|--secret-arg|--test-arg|\/usr\/bin\/true|trusted verifier|outside allowed|state\.json/,
		);
		// Deterministic: the same sources give byte-identical contexts.
		expect((await build()).prompt).toBe(context.prompt);
		// Without statements the goal is the only criterion, as in prepare.
		expect(JSON.parse((await build(contextConfig(), null)).prompt).acceptanceCriteria).toEqual([
			{ id: "AC-001", statement: COMPLEX_GOAL },
		]);
	});

	it("states READ_ONLY as zero claims and the frozen maxParallel", async () => {
		const parallel = config({ ...CONFIG, agents: { max_parallel: 3 } });
		const context = await buildPlanningContext({
			cwd,
			goal: "Explain the architecture across multiple modules",
			config: parallel,
			executionMode: "READ_ONLY",
			risk: "R0",
			signal: new AbortController().signal,
		});
		const rules: string[] = JSON.parse(context.prompt).planRules;
		expect(rules).toContain("This request is READ_ONLY: every task has ownership [] (zero claims).");
		expect(rules).toContain(
			"At most 3 task(s) implement at the same time; a task waits for the tasks it depends on.",
		);
	});

	it("keeps the listing bounds of runtime_list_files and marks truncation explicitly", async () => {
		await mkdir(join(cwd, "src/many"));
		for (let index = 0; index < 520; index++)
			await writeFile(join(cwd, `src/many/file-${String(index).padStart(4, "0")}.ts`), "x\n");
		const value = JSON.parse((await build()).prompt);
		expect(value.fileListing.files).toHaveLength(500);
		expect(value.fileListing.truncated).toBe(true);
		expect(value.fileListing.reason).toMatch(/limit reached/);
		// Depth above 4 is not listed.
		await mkdir(join(cwd, "src/a/b/c/d/e"), { recursive: true });
		await writeFile(join(cwd, "src/a/b/c/d/e/deep.ts"), "x\n");
		await rm(join(cwd, "src/many"), { recursive: true });
		const deep = JSON.parse((await build()).prompt).fileListing;
		expect(deep.files).not.toContain("src/a/b/c/d/e/deep.ts");
		expect(deep.truncated).toBe(true);
	});

	it("includes VALID facts only and rechecks them like workers", async () => {
		const rows = [
			{
				id: "f1",
				statement: "Parser lives in src",
				sourceRef: "src/app.ts",
				sourceDigest: `sha256:${"1".repeat(64)}`,
				reviewedAt: 1,
				status: "VALID" as const,
			},
			{
				id: "f2",
				statement: null,
				sourceRef: "src/nested/util.ts",
				sourceDigest: `sha256:${"2".repeat(64)}`,
				reviewedAt: 2,
				status: "STALE" as const,
			},
		];
		vi.spyOn(facts, "loadProjectFactProjection").mockResolvedValue(() => structuredClone(rows));
		const context = await build();
		expect(JSON.parse(context.prompt).projectFacts).toEqual([rows[0]]);
		expect(context.factsCurrent()).toBe(true);
		rows[0].status = "STALE" as never;
		expect(context.factsCurrent()).toBe(false);
	});

	it("fails CONTEXT_TOO_LARGE over 196,608 bytes and for instructions it cannot capture, never truncating", async () => {
		// 60,000 control characters are valid UTF-8 text but escape to 360,000 JSON bytes.
		await writeFile(join(cwd, "src/AGENTS.md"), "\u0001".repeat(60_000));
		const large = await build().catch((error: unknown) => error);
		expect(large).toBeInstanceOf(PlannerFailure);
		expect(large).toMatchObject({ code: "CONTEXT_TOO_LARGE" });
		expect((large as Error).message).toMatch(/^The Planning Context is \d+ UTF-8 bytes; the limit is 196608$/);
		await writeFile(join(cwd, "src/AGENTS.md"), "x".repeat(70_000));
		await expect(build()).rejects.toMatchObject({ code: "CONTEXT_TOO_LARGE" });
		await rm(join(cwd, "src/AGENTS.md"));
		await expect(build()).rejects.toMatchObject({ code: "CONTEXT_TOO_LARGE" });
	});
});
