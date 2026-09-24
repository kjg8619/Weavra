import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { r3OverrideCandidate } from "../src/classification.ts";
import { assertComplexPlanBinding, complexPlanDigest } from "../src/complex-plan.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import { taskContractDigest } from "../src/criterion-evidence.ts";
import {
	createHostWorkflow,
	finalizeComplexHostWorkflowPlan,
	finalizeHostWorkflowPlan,
	HostWorkflowError,
	prepareHostWorkflowDraft,
} from "../src/host-workflow.ts";
import { formatPlanPreview } from "../src/plan-preview.ts";

const config = parseRuntimeConfig(`schemaVersion: 1
models:
  profiles:
    coding: { provider: faux, model: coding }
    reasoning: { provider: faux, model: review }
`);

function prepareError(input: Parameters<typeof prepareHostWorkflowDraft>[0]): HostWorkflowError {
	try {
		prepareHostWorkflowDraft(input);
	} catch (error) {
		if (error instanceof HostWorkflowError) return error;
		throw error;
	}
	throw new Error("prepare unexpectedly succeeded");
}

describe("Host workflow preparation for R3 goals", () => {
	it.each([
		"Fix production build warning in src/a.ts",
		"Explain how production deploy works",
		"Delete the old files and add a changelog entry",
		"Delete file ../outside.ts",
	])("refuses unsupported R3 at prepare, before plan editing: %s", (goal) => {
		const error = prepareError({ goal, config });
		expect(error.code).toBe("UNSUPPORTED_WORKFLOW");
		expect(error.message).toMatch(/^Unsupported classification\/workflow: \w+\/R3; /);
		expect(error.message).toContain('"delete file <path>"');
	});

	it("keeps the supported exact deletion at R3 without an override", () => {
		const draft = prepareHostWorkflowDraft({ goal: "Delete file src/obsolete.ts", config });
		expect(draft).toMatchObject({ risk: "R3", workflow: "STANDARD", executionMode: "EDIT" });
		expect(draft.riskOverride).toBeUndefined();
	});

	it.each([
		["Fix production build warning in src/a.ts", "EDIT", "STANDARD", "R1"],
		["Explain how production deploy works", "READ_ONLY", "QUICK", "R0"],
		["Update dependencies used by the deploy script", "EDIT", "STANDARD", "R2"],
	] as const)("prepares %s at its rule-based risk after a confirmed override", (goal, mode, workflow, risk) => {
		const riskOverride = r3OverrideCandidate(goal);
		expect(riskOverride).toEqual({ from: "R3", to: risk });
		const draft = prepareHostWorkflowDraft({ goal, config, riskOverride });
		expect(draft).toMatchObject({ executionMode: mode, workflow, risk, riskOverride: { from: "R3", to: risk } });
		const plan = finalizeHostWorkflowPlan(draft);
		expect(plan.riskOverride).toEqual({ from: "R3", to: risk });
		expect(plan.preview).toMatchObject({ risk, riskOverride: { from: "R3", to: risk } });
		const text = formatPlanPreview(plan.preview);
		expect(text).toContain(`Risk: ${risk}\n  User-confirmed override from R3 (risk keywords only); not an approval`);
	});

	it.each([
		["Delete file src/obsolete.ts", "R1"],
		["Delete file ../outside.ts", "R1"],
		["Fix bug in src/a.ts", "R1"],
		["Fix production build warning in src/a.ts", "R0"],
	] as const)("fails closed for a stale or forged override: %s -> %s", (goal, to) => {
		const error = prepareError({ goal, config, riskOverride: { from: "R3", to } });
		expect(error.code).toBe("UNSUPPORTED_WORKFLOW");
		expect(error.message).toContain("rejected");
	});

	it("shows no override line for an ordinary plan", () => {
		const draft = prepareHostWorkflowDraft({ goal: "Fix bug in src/a.ts", config });
		expect(draft.riskOverride).toBeUndefined();
		expect(formatPlanPreview(finalizeHostWorkflowPlan(draft).preview)).not.toContain("User-confirmed override");
	});

	it("warns in every Plan Preview while the verifier sandbox is disabled", () => {
		const preview = finalizeHostWorkflowPlan(
			prepareHostWorkflowDraft({ goal: "Fix bug in src/a.ts", config }),
		).preview;
		expect(formatPlanPreview(preview)).toContain(
			"Command verifier sandbox: disabled. WARNING: registered checks run unsandboxed",
		);
		expect(formatPlanPreview({ ...preview, verifierSandboxMode: "required" })).not.toContain("WARNING");
	});
});

describe("Host workflow preparation for COMPLEX (#16 stage A)", () => {
	const goal = "Refactor the parser across multiple modules";
	const complexConfig = (runtime: Record<string, unknown> = {}) =>
		parseRuntimeConfig(
			JSON.stringify({
				schemaVersion: 1,
				models: {
					profiles: {
						coding: { provider: "faux", model: "coding" },
						reasoning: { provider: "faux", model: "review" },
					},
				},
				...runtime,
				agents: { max_revision_cycles: 2 },
				files: { allowed_paths: ["src"] },
				verification: {
					checks: [
						{ id: "lint", kind: "lint", executable: "/usr/bin/true", args: [], required: false },
						{ id: "test", kind: "test", executable: "/usr/bin/true", args: [] },
					],
				},
			}),
		);
	const draft = (title = "Extract parser") => ({
		tasks: [
			{
				title,
				goal: "Move parsing into src/parse.ts",
				dependsOnIndexes: [],
				criterionIndexes: [1],
				ownership: [
					{ path: "src/parse.ts", operation: "create" },
					{ path: "src/app.ts", operation: "modify" },
				],
				checkIds: ["test"],
			},
			{
				title: "Add validation",
				goal: "Reject duplicate keys",
				dependsOnIndexes: [1],
				criterionIndexes: [1, 2],
				ownership: [],
				checkIds: ["test"],
			},
		],
	});
	const statements = ["Parsing lives in src/parse.ts", "Duplicate keys are rejected"];
	const roots: string[] = [];
	afterEach(async () => {
		for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
	});
	async function project(): Promise<string> {
		const root = await mkdtemp(join(tmpdir(), "weavra-host-complex-"));
		roots.push(root);
		await mkdir(join(root, "src"));
		await writeFile(join(root, "src/app.ts"), "export const app = 1;\n");
		return root;
	}

	it("requires a structured plan for COMPLEX instead of downgrading or inventing one", () => {
		const error = prepareError({ goal, config: complexConfig() });
		expect(error.code).toBe("UNSUPPORTED_WORKFLOW");
		expect(error.message).toBe(
			"Unsupported classification/workflow: COMPLEX/R1; COMPLEX requires a structured decomposition plan (complexDraft); no downgrade performed",
		);
		// A COMPLEX classification is never run by a configured STANDARD organization, draft or not.
		for (const complexDraft of [undefined, draft()]) {
			const downgrade = prepareError({
				goal,
				config: complexConfig({ runtime: { workflow: "STANDARD" } }),
				complexDraft,
			});
			expect(downgrade.code).toBe("UNSUPPORTED_WORKFLOW");
			expect(downgrade.message).toBe("Unsupported classification/workflow: COMPLEX/R1; no downgrade performed");
		}
	});

	it.each([
		["STANDARD", "Fix bug in src/app.ts"],
		["QUICK", "Explain how the parser works"],
	])("rejects a draft on %s with INVALID_REQUEST", (workflow, standardGoal) => {
		const error = prepareError({ goal: standardGoal, config: complexConfig(), complexDraft: draft() });
		expect(error.code).toBe("INVALID_REQUEST");
		expect(error.message).toContain(`this goal selects ${workflow}`);
	});

	it("rejects a malformed draft shape at prepare and accepts the trusted COMPLEX selection", () => {
		expect(prepareError({ goal, config: complexConfig(), complexDraft: { tasks: [], limits: {} } }).code).toBe(
			"INVALID_REQUEST",
		);
		const selected = prepareHostWorkflowDraft({
			goal: "Fix bug in src/app.ts",
			config: complexConfig({ runtime: { workflow: "COMPLEX" } }),
			complexDraft: draft(),
		});
		expect(selected).toMatchObject({ workflow: "COMPLEX", risk: "R1", executionMode: "EDIT", complexDraft: draft() });
		expect(() => finalizeHostWorkflowPlan(selected)).toThrow(HostWorkflowError);
	});

	it("freezes a review-required parent once and previews the complete bound plan without side effects", async () => {
		const cwd = await project();
		const before = await readdir(cwd, { recursive: true });
		const prepared = prepareHostWorkflowDraft({
			goal,
			config: complexConfig(),
			complexDraft: draft(`Extract ${String.fromCharCode(0x1b)}[31mparser`),
		});
		const plan = await finalizeComplexHostWorkflowPlan(prepared, statements, { cwd });
		const complex = plan.complexPlan!;
		expect(plan.taskContract.acceptanceCriteria.every((criterion) => criterion.verification.reviewRequired)).toBe(
			true,
		);
		expect(complex.parentTaskId).toBe(plan.taskContract.id);
		expect(complex.parentTaskContractDigest).toBe(taskContractDigest(plan.taskContract));
		expect(complex.complexPlanDigest).toBe(complexPlanDigest(complex));
		expect(assertComplexPlanBinding(complex, plan.taskContract, { registeredCheckIds: ["lint", "test"] })).toEqual(
			complex,
		);
		expect(complex.tasks[0].ownership).toEqual([
			{ path: "src/app.ts", operation: "modify" },
			{ path: "src/parse.ts", operation: "create" },
		]);
		expect(complex.limits).toEqual({
			maxTasks: 8,
			maxWorkerInvocations: 24,
			maxReportedTokens: 200000,
			maxTotalRevisionCycles: 2,
		});
		expect(plan.preview).toMatchObject({ workflow: "COMPLEX", complexPlan: complex });
		const text = formatPlanPreview(plan.preview);
		for (const line of [
			"Workflow: COMPLEX",
			`COMPLEX plan ${complex.planId} ${complex.complexPlanDigest} (parent ${plan.taskContract.id} ${complex.parentTaskContractDigest}):`,
			"  CT-001 Extract U+001B[31mparser",
			"    Goal: Move parsing into src/parse.ts",
			"    Depends on: none",
			"    Owned files: modify src/app.ts; create src/parse.ts",
			"  CT-002 Add validation",
			"    Depends on: CT-001",
			"    Criteria: AC-001, AC-002",
			"    Owned files: none (read-only contribution)",
			"    Local checks (mandatory, run fresh before and after an independent task review): test",
			"    Local revision cycles: at most 2",
			"  Integration after every task COMPLETED: fresh checks lint, test, a new independent final review of AC-001, AC-002, then fresh final checks",
			"  Limits: 8 tasks; 24 worker invocations; 200000 provider-reported tokens (not a billing cap); 2 total revision cycles",
			"Roles: Developer -> independent Reviewer for each task, then a new independent final Reviewer (no Planner/Lead)",
			"Verification repair: not used by COMPLEX (a failed task SELF_CHECK or TEST blocks the Run; no repair cycle)",
			"Plan confirmation is not an approval or permission token; R3 deletion still requires separate one-time human approval.",
		])
			expect(text.split("\n")).toContain(line);
		expect(text).toContain("Owned files are exclusive responsibility, not permission");
		expect(text).not.toContain(String.fromCharCode(0x1b));
		expect(await readdir(cwd, { recursive: true })).toEqual(before);
	});

	it("maps compiler rejections to existing prepare codes before any Run exists", async () => {
		const cwd = await project();
		const prepared = prepareHostWorkflowDraft({ goal, config: complexConfig(), complexDraft: draft() });
		const failure = async (value: typeof prepared, criteria = statements) => {
			try {
				await finalizeComplexHostWorkflowPlan(value, criteria, { cwd });
			} catch (error) {
				if (error instanceof HostWorkflowError) return error.code;
				throw error;
			}
			return "PREPARED";
		};
		expect(await failure(prepared)).toBe("PREPARED");
		expect(await failure(prepared, [statements[0]])).toBe("INVALID_CRITERIA");
		expect(await failure(prepared, [])).toBe("INVALID_CRITERIA");
		const outside = structuredClone(prepared);
		outside.complexDraft!.tasks[1].ownership = [{ path: "docs/notes.md", operation: "create" }];
		expect(await failure(outside)).toBe("INVALID_CRITERIA");
		const standard = prepareHostWorkflowDraft({ goal: "Fix bug in src/app.ts", config: complexConfig() });
		expect(await failure(standard)).toBe("INVALID_REQUEST");
	});

	it("refuses to start a confirmed COMPLEX plan before any model, writer or Run exists", async () => {
		const cwd = await project();
		const plan = await finalizeComplexHostWorkflowPlan(
			prepareHostWorkflowDraft({ goal, config: complexConfig(), complexDraft: draft() }),
			statements,
			{ cwd },
		);
		const createModels = vi.fn(async (): Promise<never> => {
			throw new Error("Model initialization forbidden");
		});
		const failure = await createHostWorkflow({
			cwd,
			plan,
			agentDir: join(cwd, "agent"),
			signal: new AbortController().signal,
			createModels,
		}).catch((error: unknown) => error);
		expect(failure).toBeInstanceOf(HostWorkflowError);
		expect(failure).toMatchObject({ code: "UNSUPPORTED_WORKFLOW" });
		expect(createModels).not.toHaveBeenCalled();
		expect(await readdir(cwd)).toEqual(["src"]);
	});

	it("keeps QUICK/STANDARD previews free of any COMPLEX plan", () => {
		for (const standardGoal of ["Fix bug in src/app.ts", "Explain how the parser works"]) {
			const plan = finalizeHostWorkflowPlan(
				prepareHostWorkflowDraft({ goal: standardGoal, config: complexConfig() }),
			);
			expect("complexPlan" in plan).toBe(false);
			expect("complexPlan" in plan.preview).toBe(false);
			expect("complexDraft" in plan).toBe(false);
			expect(formatPlanPreview(plan.preview)).not.toContain("COMPLEX");
		}
	});
});
