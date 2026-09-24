import { describe, expect, it } from "vitest";
import { r3OverrideCandidate } from "../src/classification.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import { finalizeHostWorkflowPlan, HostWorkflowError, prepareHostWorkflowDraft } from "../src/host-workflow.ts";
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
