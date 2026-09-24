import { readFileSync } from "node:fs";
import { link, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { capabilityJson } from "../src/capability-catalog.ts";
import {
	assertComplexPlanBinding,
	COMPLEX_PLAN_DIGEST_DOMAIN,
	COMPLEX_PLAN_V1_DIGEST_DOMAIN,
	type ComplexClaimInspector,
	type ComplexPathFact,
	ComplexPlanBindingError,
	compileComplexPlan,
	complexClaimsDenial,
	complexDraftBytes,
	complexPlanDigest,
	maxComplexExecution,
	ownershipPathError,
} from "../src/complex-plan.ts";
import { complexWaves } from "../src/complex-state.ts";
import {
	COMPLEX_DRAFT_MAX_BYTES,
	COMPLEX_EXECUTION_MAX_BYTES,
	COMPLEX_PLAN_MAX_BYTES,
	type ComplexDraft,
	ComplexDraftSchema,
	ComplexEvidenceContextSchema,
	ComplexExecutionSchema,
	ComplexIntegrationSchema,
	type ComplexPlan,
	ComplexPlanSchema,
	type ComplexPlanV1,
	ComplexPlanV1Schema,
	ComplexTaskStateSchema,
	OwnershipClaimSchema,
} from "../src/complex-types.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../src/config.ts";
import type { Risk, TaskContract } from "../src/contracts.ts";
import { taskContractDigest } from "../src/criterion-evidence.ts";
import type { ExecutionMode } from "../src/execution-contract.ts";
import { hostComplexClaimInspector } from "../src/host-workflow.ts";
import { HostWorkflowError } from "../src/host-workflow-error.ts";
import { buildTaskContract } from "../src/task-contract.ts";

/** The historical V0.7B reference fixture (contract v1): read-only history for a v2 Runtime. */
interface ContractFixture {
	parent: TaskContract;
	parentTaskContractDigest: string;
	plan: ComplexPlanV1;
	complexPlanDigest: string;
	complexPlanDigestInput: string;
	preview: {
		goal: string;
		allowedPaths: string[];
		acceptanceCriteria: Array<{ id: string; statement: string; checkIds: string[]; reviewRequired: boolean }>;
		taskContractDigest: string;
	};
}
const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/complex-contract-v1.fixture.json", import.meta.url), "utf8"),
) as ContractFixture;
/** The V0.8A reference fixture (contract v2), shared with the App lane as a copy: two waves of three tasks. */
interface ContractFixtureV2 {
	parent: TaskContract;
	parentTaskContractDigest: string;
	plan: ComplexPlan;
	complexPlanDigest: string;
	complexPlanDigestInput: string;
	waves: string[][];
}
const fixtureV2 = JSON.parse(
	readFileSync(new URL("./fixtures/complex-contract-v2.fixture.json", import.meta.url), "utf8"),
) as ContractFixtureV2;

/**
 * What this v2 Runtime compiles from the V0.7B reference decomposition: the same bytes with `schemaVersion: 2`,
 * `limits.maxParallel: 1` (the default `agents.max_parallel`) and the digest in the v2 domain. A test expectation
 * only; the Runtime never rewrites or re-digests a frozen plan.
 */
function compiledV2(plan: ComplexPlanV1): ComplexPlan {
	const { complexPlanDigest: _historical, ...material } = plan;
	const next = { ...material, schemaVersion: 2 as const, limits: { ...material.limits, maxParallel: 1 } };
	return { ...next, complexPlanDigest: complexPlanDigest(next) };
}

const roots: string[] = [];
afterEach(async () => {
	for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

function complexConfig(overrides: Record<string, unknown> = {}): RuntimeConfig {
	return parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			agents: { max_revision_cycles: 3 },
			files: { allowed_paths: ["src", "test"] },
			verification: {
				checks: [
					{ id: "lint", kind: "lint", executable: "/usr/bin/true", args: [], required: false },
					{ id: "test", kind: "test", executable: "/usr/bin/true", args: [] },
				],
			},
			...overrides,
		}),
	);
}

function parentFor(
	config: RuntimeConfig,
	goal = fixture.parent.goal,
	statements = fixture.parent.acceptanceCriteria.map((criterion) => criterion.statement),
): TaskContract {
	return buildTaskContract({ goal, statements, workflow: "COMPLEX", config, taskId: fixture.parent.id });
}

/** The reference decomposition (§4.2 fixture), as a human would submit it. */
function referenceDraft(): ComplexDraft {
	return {
		tasks: [
			{
				title: "Extract parser",
				goal: "Move parsing into src/parse.ts and keep parseConfig behavior",
				dependsOnIndexes: [],
				criterionIndexes: [1],
				ownership: [
					{ path: "src/config.ts", operation: "modify" },
					{ path: "src/parse.ts", operation: "create" },
				],
				checkIds: ["test"],
			},
			{
				title: "Add validation",
				goal: "Add validateConfig in src/validate.ts rejecting duplicate keys",
				dependsOnIndexes: [1],
				criterionIndexes: [2],
				ownership: [{ path: "src/validate.ts", operation: "create" }],
				checkIds: ["test"],
			},
		],
	};
}

/**
 * The reference decomposition with its Policy-protected `src/config.ts` (built-in `config.*` name) replaced by
 * `src/conf.ts`, which sorts identically; otherwise byte-for-byte the fixture's decomposition.
 */
function baseDraft(): ComplexDraft {
	const draft = referenceDraft();
	draft.tasks[0].ownership[0].path = "src/conf.ts";
	return draft;
}
/** The fixture decomposition with the same substitution, as this v2 Runtime compiles it. */
function basePlan(): ComplexPlan {
	const plan = structuredClone(fixture.plan);
	plan.tasks[0].ownership[0].path = "src/conf.ts";
	return compiledV2(plan);
}

function withTask(index: number, fields: Record<string, unknown>): unknown {
	const draft = baseDraft();
	return { tasks: draft.tasks.map((task, position) => (position === index ? { ...task, ...fields } : task)) };
}

/** Facts a project containing only the listed existing text files would report (see the real-filesystem tests). */
function fakeClaims(
	existing: readonly string[] = ["src/conf.ts"],
	overrides: Record<string, Partial<ComplexPathFact>> = {},
): ComplexClaimInspector & { calls: string[][] } {
	const calls: string[][] = [];
	return {
		calls,
		inspect: async (paths) => {
			calls.push([...paths]);
			return {
				protectedPaths: [],
				facts: paths.map((path) => ({
					path,
					safe: true,
					kind: existing.includes(path) ? ("file" as const) : ("missing" as const),
					exactSpelling: true,
					text: existing.includes(path),
					parentDirectory: !existing.includes(path),
					...overrides[path],
				})),
			};
		},
	};
}

interface CompileOptions {
	draft?: unknown;
	config?: RuntimeConfig;
	parent?: TaskContract;
	executionMode?: ExecutionMode;
	risk?: Risk;
	claims?: ComplexClaimInspector;
	planId?: string;
}
function compile(options: CompileOptions = {}): Promise<ComplexPlan> {
	const config = options.config ?? complexConfig();
	return compileComplexPlan({
		planId: options.planId ?? fixture.plan.planId,
		parent: options.parent ?? parentFor(config),
		draft: "draft" in options ? options.draft : baseDraft(),
		config,
		executionMode: options.executionMode ?? "EDIT",
		risk: options.risk ?? "R1",
		claims: options.claims ?? fakeClaims(),
	});
}

async function rejection(promise: Promise<unknown>): Promise<HostWorkflowError> {
	try {
		await promise;
	} catch (error) {
		if (error instanceof HostWorkflowError) return error;
		throw error;
	}
	throw new Error("COMPLEX compilation unexpectedly succeeded");
}

async function project(files: Record<string, string | Buffer> = {}): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "weavra-complex-"));
	roots.push(root);
	await mkdir(join(root, "src"), { recursive: true });
	for (const [path, content] of Object.entries(files)) {
		await mkdir(dirname(join(root, path)), { recursive: true });
		await writeFile(join(root, path), content);
	}
	return root;
}

describe("COMPLEX contract identity (v2; the V0.7B v1 fixture as history)", () => {
	it("reproduces the V0.8A v2 reference fixture: parent, plan, digest input, digests and waves", async () => {
		const config = complexConfig({ agents: { max_revision_cycles: 3, max_parallel: 2 } });
		const statements = fixtureV2.parent.acceptanceCriteria.map((criterion) => criterion.statement);
		const parent = parentFor(config, fixtureV2.parent.goal, statements);
		expect(parent).toEqual(fixtureV2.parent);
		expect(taskContractDigest(parent)).toBe(fixtureV2.parentTaskContractDigest);
		expect(fixtureV2.parentTaskContractDigest.startsWith("sha256:92eb75bd")).toBe(true);
		const { complexPlanDigest: digest, ...material } = fixtureV2.plan;
		expect(COMPLEX_PLAN_DIGEST_DOMAIN).toBe("weavra-complex-plan-v2");
		expect(capabilityJson([COMPLEX_PLAN_DIGEST_DOMAIN, material])).toBe(fixtureV2.complexPlanDigestInput);
		expect(complexPlanDigest(fixtureV2.plan)).toBe(fixtureV2.complexPlanDigest);
		expect(digest).toBe(fixtureV2.complexPlanDigest);
		expect(fixtureV2.complexPlanDigest.startsWith("sha256:eea6a2bf")).toBe(true);
		expect(assertComplexPlanBinding(fixtureV2.plan, parent, { registeredCheckIds: ["test", "lint"] })).toEqual(
			fixtureV2.plan,
		);
		// Waves come only from declared dependencies, plan order and maxParallel 2.
		expect(complexWaves(fixtureV2.plan)).toEqual(fixtureV2.waves);
		expect(complexWaves(fixtureV2.plan)).toEqual([["CT-001", "CT-002"], ["CT-003"]]);
		// The human decomposition compiles byte-for-byte to the reference plan.
		const plan = await compile({
			config,
			parent,
			planId: fixtureV2.plan.planId,
			claims: fakeClaims([]),
			draft: {
				tasks: fixtureV2.plan.tasks.map((task) => ({
					title: task.title,
					goal: task.goal,
					dependsOnIndexes: task.dependsOn.map((id) => Number(id.slice(3))),
					criterionIndexes: task.criterionIds.map((id) => Number(id.slice(3))),
					ownership: task.ownership,
					checkIds: task.checkIds,
				})),
			},
		});
		expect(JSON.stringify(plan)).toBe(JSON.stringify(fixtureV2.plan));
		const projection = maxComplexExecution(parent, plan);
		expect(Check(ComplexExecutionSchema, projection)).toBe(true);
		expect(projection.activeTaskIds).toEqual(["CT-001", "CT-002"]);
		expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThanOrEqual(COMPLEX_EXECUTION_MAX_BYTES);
	});

	it("keeps the V0.7B v1 fixture's own identity: its v1 digest recomputes, and a v1 plan never executes", () => {
		const config = complexConfig();
		const parent = parentFor(config);
		expect(parent).toEqual(fixture.parent);
		expect(taskContractDigest(parent)).toBe(fixture.parentTaskContractDigest);
		const { complexPlanDigest: digest, ...material } = fixture.plan;
		expect(capabilityJson([COMPLEX_PLAN_V1_DIGEST_DOMAIN, material])).toBe(fixture.complexPlanDigestInput);
		expect(complexPlanDigest(fixture.plan)).toBe(fixture.complexPlanDigest);
		expect(digest).toBe(fixture.complexPlanDigest);
		expect(Buffer.byteLength(JSON.stringify(fixture.plan))).toBeLessThanOrEqual(COMPLEX_PLAN_MAX_BYTES);
		expect(Check(ComplexPlanV1Schema, fixture.plan)).toBe(true);
		expect(Check(ComplexPlanSchema, fixture.plan)).toBe(false);
		// Only v2 plans are bound for execution; the same decomposition compiles to v2 with its own digest.
		expect(() => assertComplexPlanBinding(fixture.plan, parent, { registeredCheckIds: ["test", "lint"] })).toThrow(
			ComplexPlanBindingError,
		);
		const upgraded = compiledV2(fixture.plan);
		expect(upgraded.complexPlanDigest).not.toBe(fixture.complexPlanDigest);
		expect(assertComplexPlanBinding(upgraded, parent, { registeredCheckIds: ["test", "lint"] })).toEqual(upgraded);
	});

	it("compiles the reference decomposition byte-for-byte, except the claim current Policy protects", async () => {
		const config = complexConfig();
		const parent = parentFor(config);
		// `src/config.ts` is a built-in protected name (config.*): lexically valid digest material, never ownership.
		const protectedClaim = await rejection(
			compile({ config, parent, draft: referenceDraft(), claims: fakeClaims(["src/config.ts"]) }),
		);
		expect(protectedClaim.code).toBe("INVALID_CRITERIA");
		expect(protectedClaim.message).toBe(
			'CT-001 modify claim "src/config.ts" is denied by current Policy (R1/DENY: Protected target)',
		);
		const plan = await compile({ config, parent });
		// Same wire bytes as the fixture apart from the substituted path, not only an equal object.
		expect(JSON.stringify(plan)).toBe(JSON.stringify(basePlan()));
		expect(plan.complexPlanDigest).toBe(complexPlanDigest(plan));
	});

	it("reconstructs the parent digest from preview fields (§10.3), never from a pair of digest strings", () => {
		const { preview, plan } = fixture;
		const reconstructed: TaskContract = {
			id: plan.parentTaskId,
			goal: preview.goal,
			acceptanceCriteria: preview.acceptanceCriteria.map(({ id, statement, checkIds, reviewRequired }) => ({
				id,
				statement,
				scope: { paths: preview.allowedPaths },
				verification: { checkIds, reviewRequired },
			})),
			status: "pending",
		};
		expect(taskContractDigest(reconstructed)).toBe(preview.taskContractDigest);
		expect(plan.parentTaskContractDigest).toBe(preview.taskContractDigest);
	});

	it("compiles the same plan from real filesystem facts and the Run's protected paths", async () => {
		const cwd = await project({ "src/conf.ts": "export const conf = {};\n" });
		const config = complexConfig();
		expect(await compile({ config, claims: hostComplexClaimInspector(cwd, config) })).toEqual(basePlan());
	});

	it("keeps task order, canonicalizes set-valued fields and freezes limits from trusted configuration", async () => {
		const config = complexConfig({
			agents: { max_revision_cycles: 1 },
			budget: { max_worker_invocations: 10, max_reported_tokens: 5000 },
			verification: {
				checks: [
					{ id: "b-test", kind: "test", executable: "/usr/bin/true", args: [] },
					{ id: "a-test", kind: "test", executable: "/usr/bin/true", args: [] },
				],
			},
		});
		const parent = parentFor(config, fixture.parent.goal, ["First", "Second", "Third"]);
		const plan = await compile({
			config,
			parent,
			claims: fakeClaims(["src/b.ts", "src/a.ts"]),
			draft: {
				tasks: [
					{
						title: "Later work first",
						goal: "Human order is execution order",
						dependsOnIndexes: [],
						criterionIndexes: [3, 1],
						ownership: [
							{ path: "src/b.ts", operation: "modify" },
							{ path: "src/a.ts", operation: "modify" },
						],
						checkIds: ["b-test", "a-test"],
					},
					{
						title: "Second",
						goal: "Reads",
						dependsOnIndexes: [],
						criterionIndexes: [2],
						ownership: [],
						checkIds: ["a-test"],
					},
					{
						title: "Third",
						goal: "Depends on both",
						dependsOnIndexes: [2, 1],
						criterionIndexes: [2],
						ownership: [],
						checkIds: ["b-test"],
					},
				],
			},
		});
		expect(plan.tasks.map((task) => [task.id, task.title])).toEqual([
			["CT-001", "Later work first"],
			["CT-002", "Second"],
			["CT-003", "Third"],
		]);
		expect(plan.tasks[0]).toMatchObject({
			criterionIds: ["AC-001", "AC-003"],
			ownership: [
				{ path: "src/a.ts", operation: "modify" },
				{ path: "src/b.ts", operation: "modify" },
			],
			checkIds: ["a-test", "b-test"],
			maxRevisionCycles: 1,
		});
		expect(plan.tasks[2].dependsOn).toEqual(["CT-001", "CT-002"]);
		expect(plan.integration).toEqual({
			criterionIds: ["AC-001", "AC-002", "AC-003"],
			checkIds: ["a-test", "b-test"],
			reviewRequired: true,
			finalChecksRequired: true,
		});
		expect(plan.limits).toEqual({
			maxTasks: 8,
			maxWorkerInvocations: 10,
			maxReportedTokens: 5000,
			maxTotalRevisionCycles: 1,
			maxParallel: 1,
		});
		const generous = complexConfig({ budget: { max_worker_invocations: 100, max_reported_tokens: 1_000_000 } });
		expect((await compile({ config: generous })).limits).toMatchObject({
			maxWorkerInvocations: 24,
			maxReportedTokens: 200000,
		});
		const none = await compile({ config: complexConfig({ agents: { max_revision_cycles: 0 } }) });
		expect(none.limits.maxTotalRevisionCycles).toBe(0);
		expect(none.tasks.every((task) => task.maxRevisionCycles === 0)).toBe(true);
		// V0.8A: the frozen wave bound is min(agents.max_parallel, 4); QUICK/STANDARD ignore it.
		for (const maxParallel of [1, 2, 3, 4])
			expect(
				(
					await compile({
						config: complexConfig({ agents: { max_revision_cycles: 3, max_parallel: maxParallel } }),
					})
				).limits.maxParallel,
			).toBe(maxParallel);
	});

	it("proves the largest execution projection is schema-valid and fits for the reference plan", () => {
		const projection = maxComplexExecution(fixture.parent, compiledV2(fixture.plan));
		expect(Check(ComplexExecutionSchema, projection)).toBe(true);
		expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThanOrEqual(COMPLEX_EXECUTION_MAX_BYTES);
		expect(projection.tasks.map((task) => task.changedFiles)).toEqual([
			["src/config.ts", "src/parse.ts"],
			["src/validate.ts"],
		]);
	});
});

describe("COMPLEX draft shape (INVALID_REQUEST)", () => {
	const task = baseDraft().tasks[1];
	it.each<[string, unknown]>([
		["one task", { tasks: [baseDraft().tasks[0]] }],
		["nine tasks", { tasks: Array.from({ length: 9 }, () => task) }],
		["missing tasks", {}],
		["a non-object draft", "split it"],
		["a null draft", null],
		["a blank title", withTask(0, { title: "   " })],
		["an 81-character title", withTask(0, { title: "t".repeat(81) })],
		["a 301-character goal", withTask(0, { goal: "g".repeat(301) })],
		["eight dependencies", withTask(1, { dependsOnIndexes: [1, 1, 1, 1, 1, 1, 1, 1] })],
		["a zero-based dependency index", withTask(1, { dependsOnIndexes: [0] })],
		["a fractional dependency index", withTask(1, { dependsOnIndexes: [1.5] })],
		["no criteria", withTask(0, { criterionIndexes: [] })],
		["criterion index 17", withTask(0, { criterionIndexes: [17] })],
		[
			"17 claims in one task",
			withTask(0, {
				ownership: Array.from({ length: 17 }, (_, index) => ({ path: `src/f${index}.ts`, operation: "create" })),
			}),
		],
		["no local check", withTask(0, { checkIds: [] })],
		["a non-identifier check", withTask(0, { checkIds: ["unit tests"] })],
		["an empty claim path", withTask(0, { ownership: [{ path: "", operation: "create" }] })],
		[
			"a 257-character claim path",
			withTask(0, { ownership: [{ path: `src/${"a".repeat(253)}`, operation: "create" }] }),
		],
		["a rename claim", withTask(0, { ownership: [{ path: "src/a.ts", operation: "rename" }] })],
		// C23: draft data cannot forge Runtime-issued identity, status, digests, limits, Risk or permission.
		["a forged task ID", withTask(0, { id: "CT-001" })],
		["a forged task status", withTask(0, { status: "COMPLETED" })],
		["a forged review verdict", withTask(0, { review: "PASS" })],
		["a forged revision cap", withTask(0, { maxRevisionCycles: 9 })],
		["a forged Risk", withTask(0, { risk: "R0" })],
		["forged dependency IDs", withTask(1, { dependsOn: ["CT-001"] })],
		[
			"a forged claim grant",
			withTask(0, { ownership: [{ path: "src/config.ts", operation: "modify", granted: true }] }),
		],
		["a forged plan digest", { ...baseDraft(), complexPlanDigest: fixture.complexPlanDigest }],
		["forged limits", { ...baseDraft(), limits: fixture.plan.limits }],
		["a forged plan ID", { ...baseDraft(), planId: fixture.plan.planId }],
	])("rejects %s before any inspection", async (_name, draft) => {
		const claims = fakeClaims();
		expect((await rejection(compile({ draft, claims }))).code).toBe("INVALID_REQUEST");
		expect(claims.calls).toEqual([]);
	});

	it("rejects a draft over 12,288 UTF-8 bytes even when every count is in bounds", async () => {
		const draft = {
			tasks: [0, 1, 2].map((taskIndex) => ({
				...task,
				ownership: Array.from({ length: 16 }, (_, index) => ({
					path: `src/${"a".repeat(240)}-${taskIndex}-${index}.ts`,
					operation: "create" as const,
				})),
			})),
		};
		expect(Check(ComplexDraftSchema, draft)).toBe(true);
		expect(complexDraftBytes(draft)).toBeGreaterThan(COMPLEX_DRAFT_MAX_BYTES);
		const error = await rejection(compile({ draft }));
		expect(error.code).toBe("INVALID_REQUEST");
		expect(error.message).toContain("12288");
	});

	it("rejects a compiled plan over 12,288 UTF-8 bytes although its draft fits", async () => {
		const statements = Array.from({ length: 16 }, (_, index) => `Criterion ${index + 1} holds`);
		const config = complexConfig();
		const parent = parentFor(config, fixture.parent.goal, statements);
		const build = (pad: number): ComplexDraft => ({
			tasks: Array.from({ length: 8 }, (_, taskIndex) => ({
				title: `Task ${taskIndex + 1}`,
				goal: `Contribution ${taskIndex + 1}`,
				dependsOnIndexes: Array.from({ length: taskIndex }, (_, index) => index + 1),
				criterionIndexes: Array.from({ length: 16 }, (_, index) => index + 1),
				ownership: Array.from({ length: 8 }, (_, index) => ({
					path: `src/t${taskIndex}-c${index}-${"p".repeat(pad)}.ts`,
					operation: "create" as const,
				})),
				checkIds: ["test"],
			})),
		});
		let pad = 200;
		while (complexDraftBytes(build(pad)) > COMPLEX_DRAFT_MAX_BYTES) pad--;
		const draft = build(pad);
		expect(complexDraftBytes(draft)).toBeGreaterThan(COMPLEX_DRAFT_MAX_BYTES - 200);
		const claims = fakeClaims([]);
		const error = await rejection(compile({ draft, parent, config, claims }));
		expect(error.code).toBe("INVALID_REQUEST");
		expect(error.message).toContain("compiled plan");
		expect(claims.calls).toEqual([]);
	});

	it("rejects a plan whose largest execution projection cannot fit 32,768 bytes", async () => {
		const allowed = Array.from({ length: 32 }, (_, index) => `area-${index}-${"s".repeat(180)}`);
		const config = complexConfig({ files: { allowed_paths: allowed } });
		const statements = Array.from({ length: 16 }, (_, index) => `Criterion ${index + 1} holds`);
		const parent = parentFor(config, fixture.parent.goal, statements);
		const draft = {
			tasks: [
				{ ...task, dependsOnIndexes: [], criterionIndexes: [1, 2, 3, 4, 5, 6, 7, 8], ownership: [] },
				{ ...task, criterionIndexes: [9, 10, 11, 12, 13, 14, 15, 16], ownership: [] },
			],
		};
		const error = await rejection(compile({ draft, parent, config }));
		expect(error.code).toBe("INVALID_REQUEST");
		expect(error.message).toContain("execution projection");
	});

	it("rejects a plan identity that is not a Runtime-issued lowercase UUID", async () => {
		expect((await rejection(compile({ planId: "PLAN-1" }))).code).toBe("INVALID_REQUEST");
	});
});

describe("COMPLEX graph, coverage and check references (INVALID_CRITERIA)", () => {
	// C25: no self, forward, duplicate, missing or cyclic dependency, and no automatic topological reordering.
	it.each<[string, unknown, RegExp]>([
		["a self dependency", withTask(1, { dependsOnIndexes: [2] }), /depends on itself/],
		["a forward dependency", withTask(0, { dependsOnIndexes: [2] }), /later task CT-002.*never reordered/],
		["a duplicate dependency", withTask(1, { dependsOnIndexes: [1, 1] }), /more than once/],
		["a missing dependency", withTask(1, { dependsOnIndexes: [5] }), /missing task "CT-005"/],
		[
			"a dependency cycle",
			{
				tasks: [
					{ ...baseDraft().tasks[0], dependsOnIndexes: [2] },
					{ ...baseDraft().tasks[1], dependsOnIndexes: [1] },
				],
			},
			/later task CT-002/,
		],
		// C10: complete parent AC coverage; no unknown or duplicate criterion reference.
		["an uncovered parent criterion", withTask(1, { criterionIndexes: [1] }), /AC-002 are not covered/],
		["an unknown parent criterion", withTask(1, { criterionIndexes: [2, 3] }), /"AC-003".*does not contain/],
		["a duplicate criterion", withTask(1, { criterionIndexes: [2, 2] }), /lists AC-002 more than once/],
		["an unregistered local check", withTask(0, { checkIds: ["test", "unit"] }), /unregistered check "unit"/],
		[
			"a registered check outside the mapped criteria",
			withTask(0, { checkIds: ["lint"] }),
			/"lint" is not mapped to its acceptance criteria \(selectable: test\)/,
		],
		["a duplicate local check", withTask(0, { checkIds: ["test", "test"] }), /more than once/],
	])("rejects %s without inspecting claims", async (_name, draft, message) => {
		const claims = fakeClaims();
		const error = await rejection(compile({ draft, claims }));
		expect(error.code).toBe("INVALID_CRITERIA");
		expect(error.message).toMatch(message);
		expect(claims.calls).toEqual([]);
	});

	it.each<[string, Record<string, unknown>, RegExp]>([
		[
			"more than 16 registrations",
			{
				verification: {
					checks: Array.from({ length: 17 }, (_, index) => ({
						id: index ? `check-${index}` : "test",
						kind: "test",
						executable: "/usr/bin/true",
						args: [],
						required: index === 0,
					})),
				},
			},
			/at most 16 registered checks; 17 are configured and none is truncated/,
		],
		[
			"a registration ID that is not a Host identifier",
			{
				verification: {
					checks: [
						{ id: "test", kind: "test", executable: "/usr/bin/true", args: [] },
						{ id: "unit tests", kind: "test", executable: "/usr/bin/true", args: [], required: false },
					],
				},
			},
			/Host identifier/,
		],
		[
			"no required registered check",
			{
				verification: {
					checks: [{ id: "test", kind: "test", executable: "/usr/bin/true", args: [], required: false }],
				},
			},
			/at least one required registered check/,
		],
		[
			"a parent scope path over 256 UTF-8 bytes",
			{ files: { allowed_paths: [`src/${"한".repeat(90)}`] } },
			/256 UTF-8 bytes/,
		],
	])("fails preflight for %s instead of truncating", async (_name, overrides, message) => {
		const config = complexConfig(overrides);
		const error = await rejection(compile({ config, parent: parentFor(config) }));
		expect(error.code).toBe("INVALID_CRITERIA");
		expect(error.message).toMatch(message);
	});

	it("requires a COMPLEX parent whose every criterion needs independent review", async () => {
		const config = complexConfig();
		const quick = buildTaskContract({
			goal: fixture.parent.goal,
			statements: ["One"],
			workflow: "QUICK",
			config,
			taskId: fixture.parent.id,
		});
		const error = await rejection(compile({ parent: quick, draft: withTask(1, { criterionIndexes: [1] }) }));
		expect(error.code).toBe("INVALID_CRITERIA");
		expect(error.message).toContain("COMPLEX acceptance criteria must require independent review");
	});
});

describe("COMPLEX exact-file ownership", () => {
	it.each<[string, string]>([
		["a glob", "src/*.ts"],
		["a character class", "src/[ab].ts"],
		["a brace pattern", "src/{a,b}.ts"],
		["a question mark", "src/a?.ts"],
		["a trailing-slash subtree", "src/"],
		["the root", "."],
		["a dot component", "./src/a.ts"],
		["a parent component", "src/../a.ts"],
		["an empty component", "src//a.ts"],
		["an absolute path", "/etc/hosts"],
		["a drive prefix", "C:/src/a.ts"],
		["a backslash", "src\\a.ts"],
		["a control character", `src/a${String.fromCharCode(1)}.ts`],
		["a NUL", `src/a${String.fromCharCode(0)}.ts`],
		["a bidi override", `src/${String.fromCharCode(0x202e)}st.ts`],
		["a bidi isolate", `src/${String.fromCharCode(0x2066)}a.ts`],
		["a lone surrogate", `src/${String.fromCharCode(0xd800)}.ts`],
		["more than 256 UTF-8 bytes", `src/${"한".repeat(90)}`],
	])("rejects %s lexically (C26)", async (_name, path) => {
		expect(ownershipPathError(path)).toBeDefined();
		const claims = fakeClaims();
		const error = await rejection(
			compile({ draft: withTask(1, { ownership: [{ path, operation: "create" }] }), claims }),
		);
		expect(error.code).toBe("INVALID_CRITERIA");
		expect(claims.calls).toEqual([]);
	});

	it("accepts exact literal spellings lexically without treating them as permission", () => {
		for (const path of [
			"src/config.ts",
			"a",
			"docs/read me.md",
			`src/caf${String.fromCharCode(0xe9)}.ts`,
			"src/a:b.ts",
		])
			expect(ownershipPathError(path)).toBeUndefined();
	});

	it.each<[string, unknown, RegExp]>([
		[
			"a path claimed by two tasks",
			withTask(1, { ownership: [{ path: "src/parse.ts", operation: "create" }] }),
			/claimed by CT-001 and CT-002/,
		],
		[
			"one path claimed with different operations",
			withTask(1, { ownership: [{ path: "src/conf.ts", operation: "create" }] }),
			/exclusive even with different operations/,
		],
		[
			"one path claimed twice by a task",
			withTask(1, {
				ownership: [
					{ path: "src/v.ts", operation: "create" },
					{ path: "src/v.ts", operation: "modify" },
				],
			}),
			/again by the same task/,
		],
		[
			"a case alias",
			withTask(1, { ownership: [{ path: "src/Parse.ts", operation: "create" }] }),
			/case or Unicode aliases/,
		],
		[
			"a Unicode normalization alias",
			{
				tasks: [
					{
						...baseDraft().tasks[0],
						ownership: [{ path: `src/caf${String.fromCharCode(0xe9)}.ts`, operation: "create" }],
					},
					{
						...baseDraft().tasks[1],
						ownership: [{ path: `src/cafe${String.fromCharCode(0x301)}.ts`, operation: "create" }],
					},
				],
			},
			/case or Unicode aliases/,
		],
		[
			"an overlapping subtree claim",
			withTask(1, { ownership: [{ path: "src/conf.ts/inner.ts", operation: "create" }] }),
			/overlap; only exact files/,
		],
		[
			"more than 64 claims across the plan",
			{
				tasks: Array.from({ length: 5 }, (_, taskIndex) => ({
					...baseDraft().tasks[1],
					dependsOnIndexes: [],
					criterionIndexes: taskIndex ? [2] : [1],
					ownership: Array.from({ length: 13 }, (_, index) => ({
						path: `src/t${taskIndex}-${index}.ts`,
						operation: "create",
					})),
				})),
			},
			/claims 65 files; at most 64/,
		],
	])("rejects %s without inspection (C26)", async (_name, draft, message) => {
		const claims = fakeClaims();
		const error = await rejection(compile({ draft, claims }));
		expect(error.code).toBe("INVALID_CRITERIA");
		expect(error.message).toMatch(message);
		expect(claims.calls).toEqual([]);
	});

	it("requires READ_ONLY plans to claim nothing and then performs no inspection", async () => {
		const claims = fakeClaims();
		const error = await rejection(compile({ executionMode: "READ_ONLY", claims }));
		expect(error.code).toBe("INVALID_CRITERIA");
		expect(error.message).toContain("READ_ONLY");
		const readOnly = {
			tasks: baseDraft().tasks.map((task) => ({ ...task, ownership: [] })),
		};
		const plan = await compile({ executionMode: "READ_ONLY", draft: readOnly, claims });
		expect(plan.tasks.every((task) => task.ownership.length === 0)).toBe(true);
		expect(claims.calls).toEqual([]);
	});

	it("rejects delete claims outside the supported R3 deletion", async () => {
		const error = await rejection(
			compile({ draft: withTask(1, { ownership: [{ path: "src/old.ts", operation: "delete" }] }) }),
		);
		expect(error.code).toBe("INVALID_CRITERIA");
		expect(error.message).toContain('R3 "delete file <path>" goal');
	});

	it("fails closed when claim facts cannot be inspected", async () => {
		const claims: ComplexClaimInspector = {
			inspect: async () => {
				throw new Error("EACCES");
			},
		};
		const error = await rejection(compile({ claims }));
		expect(error.code).toBe("INVALID_CRITERIA");
		expect(error.message).toContain("no ownership was admitted");
	});
});

describe("COMPLEX claims against the real filesystem and current Policy", () => {
	async function realProject(): Promise<{ cwd: string; config: RuntimeConfig }> {
		const cwd = await project({
			"src/conf.ts": "export const conf = {};\n",
			"src/config.ts": "export const config = {};\n",
			"src/binary.bin": Buffer.from([0x61, 0x00, 0x62]),
			"src/hard-a.ts": "linked\n",
			"src/.env": "SECRET=1\n",
			"src/package.json": "{}\n",
			"src/AGENTS.md": "instructions\n",
			"src/dir/inner.ts": "inner\n",
			"test/check.mjs": "process.exit(0);\n",
			"docs/readme.md": "docs\n",
			[`src/caf${String.fromCharCode(0xe9)}.ts`]: "cafe\n",
		});
		await link(join(cwd, "src/hard-a.ts"), join(cwd, "src/hard-b.ts"));
		await symlink(join(cwd, "src/config.ts"), join(cwd, "src/alias.ts"));
		const config = complexConfig({
			project: { instructions: { path: "src/AGENTS.md" } },
			verification: {
				checks: [
					{ id: "lint", kind: "lint", executable: "/usr/bin/true", args: [], required: false },
					{ id: "test", kind: "test", executable: process.execPath, args: ["test/check.mjs"] },
				],
			},
		});
		return { cwd, config };
	}

	it.each<[string, { path: string; operation: "modify" | "create" | "delete" }, RegExp]>([
		["a directory (subtree) claim", { path: "src/dir", operation: "modify" }, /is a directory/],
		[
			"modify of a missing file",
			{ path: "src/missing.ts", operation: "modify" },
			/needs an existing bounded strict UTF-8 text file/,
		],
		[
			"modify of a binary file",
			{ path: "src/binary.bin", operation: "modify" },
			/needs an existing bounded strict UTF-8 text file/,
		],
		["create of an existing file", { path: "src/dir/inner.ts", operation: "create" }, /already exists/],
		["a built-in protected config name", { path: "src/config.ts", operation: "modify" }, /Protected target/],
		[
			"create without a parent directory",
			{ path: "src/new/a.ts", operation: "create" },
			/no existing parent directory/,
		],
		["a symlink", { path: "src/alias.ts", operation: "modify" }, /not a safe project file/],
		["a multiply linked file", { path: "src/hard-a.ts", operation: "modify" }, /not a safe project file/],
		["a case alias of an existing file", { path: "src/Config.ts", operation: "create" }, /spelling|already exists/],
		[
			"a Unicode alias of an existing file",
			{ path: `src/cafe${String.fromCharCode(0x301)}.ts`, operation: "create" },
			/spelling|already exists/,
		],
		["a protected credential file", { path: "src/.env", operation: "modify" }, /Protected target/],
		["a trusted verifier source", { path: "test/check.mjs", operation: "modify" }, /Protected target/],
		["the project instruction file", { path: "src/AGENTS.md", operation: "modify" }, /Protected target/],
		["a file outside allowed paths", { path: "docs/readme.md", operation: "modify" }, /outside allowed paths/],
		["a dependency file in an R1 Run", { path: "src/package.json", operation: "modify" }, /R2\/REVIEW_REQUIRED/],
	])("rejects %s (C26)", async (_name, claim, message) => {
		const { cwd, config } = await realProject();
		const error = await rejection(
			compile({
				config,
				parent: parentFor(config),
				draft: withTask(1, { ownership: [claim] }),
				claims: hostComplexClaimInspector(cwd, config),
			}),
		);
		expect(error.code).toBe("INVALID_CRITERIA");
		expect(error.message).toMatch(message);
	});

	it("admits a dependency file only in an R2 Run, where independent review stays bound", async () => {
		const { cwd, config } = await realProject();
		const plan = await compile({
			config,
			parent: parentFor(config),
			risk: "R2",
			draft: withTask(1, { ownership: [{ path: "src/package.json", operation: "modify" }] }),
			claims: hostComplexClaimInspector(cwd, config),
		});
		expect(plan.tasks[1].ownership).toEqual([{ path: "src/package.json", operation: "modify" }]);
	});

	it("re-evaluates feasibility at admission with fresh facts (reusable after preparation)", async () => {
		const { cwd, config } = await realProject();
		const claims = hostComplexClaimInspector(cwd, config);
		const plan = await compile({ config, parent: parentFor(config), claims });
		const input = {
			plan,
			config,
			executionMode: "EDIT" as const,
			risk: "R1" as const,
			goal: fixture.parent.goal,
			claims,
		};
		expect(await complexClaimsDenial(input)).toBeUndefined();
		await writeFile(join(cwd, "src/parse.ts"), "created meanwhile\n");
		expect(await complexClaimsDenial(input)).toMatch(/CT-001 create claim "src\/parse.ts" already exists/);
	});
});

describe("COMPLEX R3 is one exact deletion followed by read-only work (§7.2)", () => {
	const goal = "Delete file src/obsolete.ts";
	async function r3(draft: unknown, options: Partial<CompileOptions> = {}) {
		const cwd = await project({ "src/obsolete.ts": "obsolete\n", "src/keep.ts": "keep\n" });
		const config = complexConfig();
		return compile({
			config,
			parent: parentFor(config, goal, ["src/obsolete.ts no longer exists"]),
			risk: "R3",
			draft,
			claims: hostComplexClaimInspector(cwd, config),
			...options,
		});
	}
	const deletion = (path = "src/obsolete.ts") => ({
		tasks: [
			{ ...baseDraft().tasks[0], criterionIndexes: [1], ownership: [{ path, operation: "delete" }] },
			{ ...baseDraft().tasks[1], criterionIndexes: [1], ownership: [] },
		],
	});

	it("admits the grammar-derived target in CT-001 with a read-only successor and no revisions", async () => {
		const plan = await r3(deletion());
		expect(plan.tasks.map((task) => task.ownership)).toEqual([
			[{ path: "src/obsolete.ts", operation: "delete" }],
			[],
		]);
		expect(plan.limits.maxTotalRevisionCycles).toBe(0);
		expect(plan.tasks.every((task) => task.maxRevisionCycles === 0)).toBe(true);
	});

	it.each<[string, unknown, Partial<CompileOptions>]>([
		["a different delete target", deletion("src/keep.ts"), {}],
		[
			"the deletion outside CT-001",
			{
				tasks: [
					{ ...baseDraft().tasks[0], criterionIndexes: [1], ownership: [] },
					{
						...baseDraft().tasks[1],
						criterionIndexes: [1],
						ownership: [{ path: "src/obsolete.ts", operation: "delete" }],
					},
				],
			},
			{},
		],
		[
			"any other claim",
			{
				tasks: [
					deletion().tasks[0],
					{ ...deletion().tasks[1], ownership: [{ path: "src/keep.ts", operation: "modify" }] },
				],
			},
			{},
		],
		["no deletion at all", { tasks: deletion().tasks.map((task) => ({ ...task, ownership: [] })) }, {}],
		["a READ_ONLY contract", deletion(), { executionMode: "READ_ONLY" }],
	])("rejects %s", async (_name, draft, options) => {
		const error = await rejection(r3(draft, options));
		expect(error.code).toBe("INVALID_CRITERIA");
		expect(error.message).toMatch(/R3 COMPLEX/);
	});

	it("rejects an R3 Run whose goal is not the exact deletion grammar and a missing target", async () => {
		const config = complexConfig();
		const generic = await rejection(
			compile({
				config,
				parent: parentFor(config, "Delete old files", ["Old files are gone"]),
				risk: "R3",
				draft: deletion(),
			}),
		);
		expect(generic.message).toContain('exact "delete file <path>" goal');
		const cwd = await project();
		const missing = await rejection(
			compile({
				config,
				parent: parentFor(config, goal, ["Gone"]),
				risk: "R3",
				draft: deletion(),
				claims: hostComplexClaimInspector(cwd, config),
			}),
		);
		expect(missing.code).toBe("INVALID_CRITERIA");
		expect(missing.message).toContain("needs an existing bounded strict UTF-8 text file");
	});
});

describe("Frozen-plan binding guard for admission, each task and completion", () => {
	const parent = fixture.parent;
	const recompute = (plan: ComplexPlan): ComplexPlan => ({ ...plan, complexPlanDigest: complexPlanDigest(plan) });
	function mismatch(plan: unknown, contract: TaskContract = parent, registeredCheckIds?: string[]) {
		try {
			assertComplexPlanBinding(plan, contract, registeredCheckIds ? { registeredCheckIds } : {});
		} catch (error) {
			if (error instanceof ComplexPlanBindingError) return error.code;
			throw error;
		}
		return "BOUND";
	}
	const plan = () => compiledV2(fixture.plan);

	it.each<[string, () => unknown, TaskContract | undefined, string[] | undefined, string]>([
		["an untouched plan", plan, undefined, ["lint", "test"], "BOUND"],
		[
			"a changed title with the old digest",
			() => ({ ...plan(), tasks: [{ ...plan().tasks[0], title: "Other" }, plan().tasks[1]] }),
			undefined,
			undefined,
			"PLAN_MISMATCH",
		],
		[
			"a forged digest",
			() => ({ ...plan(), complexPlanDigest: `sha256:${"0".repeat(64)}` }),
			undefined,
			undefined,
			"PLAN_MISMATCH",
		],
		["an extra field", () => ({ ...plan(), approved: true }), undefined, undefined, "PLAN_MISMATCH"],
		[
			"a historical v1 plan (never executed)",
			() => structuredClone(fixture.plan),
			undefined,
			undefined,
			"PLAN_MISMATCH",
		],
		[
			"a recomputed maxParallel above the bound",
			() => recompute({ ...plan(), limits: { ...plan().limits, maxParallel: 5 } }),
			undefined,
			undefined,
			"PLAN_MISMATCH",
		],
		[
			"a recomputed forward edge",
			() => recompute({ ...plan(), tasks: [{ ...plan().tasks[0], dependsOn: ["CT-002"] }, plan().tasks[1]] }),
			undefined,
			undefined,
			"PLAN_MISMATCH",
		],
		[
			"a recomputed shared claim",
			() =>
				recompute({
					...plan(),
					tasks: [
						plan().tasks[0],
						{ ...plan().tasks[1], ownership: [{ path: "src/config.ts", operation: "modify" }] },
					],
				}),
			undefined,
			undefined,
			"PLAN_MISMATCH",
		],
		[
			"a recomputed dropped criterion",
			() => recompute({ ...plan(), tasks: [plan().tasks[0], { ...plan().tasks[1], criterionIds: ["AC-001"] }] }),
			undefined,
			undefined,
			"PLAN_MISMATCH",
		],
		["different registrations", plan, undefined, ["test"], "PLAN_MISMATCH"],
		[
			"a changed parent statement",
			plan,
			{
				...parent,
				acceptanceCriteria: [
					{ ...parent.acceptanceCriteria[0], statement: "Changed" },
					parent.acceptanceCriteria[1],
				],
			},
			undefined,
			"PARENT_MISMATCH",
		],
		["a different parent identity", plan, { ...parent, id: "other-parent" }, undefined, "PARENT_MISMATCH"],
		[
			"a parent without review-required criteria",
			plan,
			{
				...parent,
				acceptanceCriteria: parent.acceptanceCriteria.map((criterion) => ({
					...criterion,
					verification: { ...criterion.verification, reviewRequired: false },
				})),
			},
			undefined,
			"PARENT_MISMATCH",
		],
	])("reports %s", (_name, value, contract, registrations, expected) => {
		expect(mismatch(value(), contract ?? parent, registrations)).toBe(expected);
	});

	it("ignores parent lifecycle status, which is not part of the frozen identity", () => {
		expect(mismatch(plan(), { ...parent, status: "inProgress" })).toBe("BOUND");
	});
});

describe("Closed COMPLEX wire shapes", () => {
	const pendingRow = {
		id: "CT-001",
		status: "PENDING",
		attempt: 0,
		revisionCycle: 0,
		workerInvocations: 0,
		reportedTokens: 0,
		entryWorkspaceDigest: null,
		exitWorkspaceDigest: null,
		changedFiles: [],
		changesUnknown: false,
		selfCheck: "NOT_RUN",
		review: "NOT_RUN",
		test: "NOT_RUN",
		evidenceFreshness: "NONE",
		failureCode: null,
	};
	const context = {
		parentTaskContractDigest: fixture.parentTaskContractDigest,
		complexPlanDigest: fixture.complexPlanDigest,
		scope: "TASK",
		taskId: "CT-002",
		attempt: 3,
	};
	const examples: Array<[string, TSchema, Record<string, unknown>]> = [
		["OwnershipClaim", OwnershipClaimSchema, { path: "src/a.ts", operation: "create" }],
		["ComplexDraft", ComplexDraftSchema, { ...baseDraft() }],
		["ComplexPlan", ComplexPlanSchema, { ...fixtureV2.plan }],
		["ComplexPlanV1", ComplexPlanV1Schema, { ...fixture.plan }],
		["ComplexTaskState", ComplexTaskStateSchema, pendingRow],
		[
			"ComplexIntegration",
			ComplexIntegrationSchema,
			{
				check: "NOT_RUN",
				review: "NOT_RUN",
				test: "NOT_RUN",
				workspaceDigest: null,
				evidenceFreshness: "NONE",
				failureCode: null,
			},
		],
		["ComplexEvidenceContext", ComplexEvidenceContextSchema, context],
		["ComplexExecution", ComplexExecutionSchema, { ...maxComplexExecution(fixtureV2.parent, fixtureV2.plan) }],
	];

	it.each(examples)("accepts a valid %s and rejects unknown or missing fields", (_name, schema, value) => {
		expect(Check(schema, value)).toBe(true);
		expect(Check(schema, { ...value, forged: true })).toBe(false);
		for (const key of Object.keys(value)) {
			const incomplete = { ...value };
			delete incomplete[key];
			expect(Check(schema, incomplete)).toBe(false);
		}
	});

	it("binds TASK context to a plan task at attempt 1-3 and INTEGRATION to no task at attempt 1", () => {
		const integration = { ...context, scope: "INTEGRATION", taskId: null, attempt: 1 };
		expect(Check(ComplexEvidenceContextSchema, integration)).toBe(true);
		for (const value of [
			{ ...context, taskId: null },
			{ ...context, attempt: 4 },
			{ ...context, attempt: 0 },
			{ ...context, taskId: "CT-009" },
			{ ...integration, attempt: 2 },
			{ ...integration, taskId: "CT-001" },
		])
			expect(Check(ComplexEvidenceContextSchema, value)).toBe(false);
	});

	it("keeps task-state counters within the §6 bounds and null usage distinct from zero", () => {
		expect(Check(ComplexTaskStateSchema, { ...pendingRow, reportedTokens: null })).toBe(true);
		for (const patch of [
			{ attempt: 4 },
			{ revisionCycle: 3 },
			{ workerInvocations: 7 },
			{ reportedTokens: -1 },
			{ entryWorkspaceDigest: `sha256:${"0".repeat(64)}` },
			{ changedFiles: ["src/a.ts", "src/a.ts"] },
			{ status: "DONE" },
			{ failureCode: "UNKNOWN" },
		])
			expect(Check(ComplexTaskStateSchema, { ...pendingRow, ...patch })).toBe(false);
	});
});
