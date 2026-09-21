import type { RuntimeConfig } from "./config.ts";
import type { AcceptanceCriterion, Risk, Workflow } from "./contracts.ts";
import type { ExecutionMode } from "./execution-contract.ts";

export interface PlanPreview {
	goal: string;
	workflow: Workflow;
	executionMode: ExecutionMode;
	risk: Risk;
	acceptanceCriteria: readonly AcceptanceCriterion[];
	allowedPaths: readonly string[];
	checks: RuntimeConfig["verification"]["checks"];
	projectInstructionPath: string | null;
	lspEnabled: boolean;
	mutationMode: "compatible" | "strict";
	verifierTrustMode: "compatible" | "strict";
	verifierTrustSources: readonly string[];
	verifierSandboxMode: "disabled" | "required";
	contextPackMode: "disabled" | "bounded";
	verificationRepairMode: "disabled" | "self-check-once";
	/** Bounded reviewed-recipe metadata; never the raw recipe inputs and never an authority. */
	recipe?: { id: string; version: number; digest: string };
}

/** Host-side display only. Confirming this plan is neither an approval nor a permission token. */
export function formatPlanPreview(plan: PlanPreview): string {
	return [
		`Goal: ${plan.goal}`,
		...(plan.recipe ? [`Recipe: ${plan.recipe.id}@${plan.recipe.version} ${plan.recipe.digest}`] : []),
		`Workflow: ${plan.workflow}`,
		`Execution contract: ${plan.executionMode}`,
		`Risk: ${plan.risk}`,
		"Acceptance criteria (Host-assigned IDs; workers judge and report by ID, never by prose):",
		...plan.acceptanceCriteria.map(
			(criterion) =>
				`  ${criterion.id} ${criterion.statement} [checks: ${criterion.verification.checkIds.join(", ") || "none"}; review: ${criterion.verification.reviewRequired ? "required" : "not required"}]`,
		),
		`Allowed paths: ${plan.allowedPaths.length ? plan.allowedPaths.join(", ") : "(none configured)"}`,
		`Planned checks (command checks are trusted local programs and may mutate files; ${plan.verifierSandboxMode === "required" ? "command OS sandbox required" : "commands not sandboxed"}):`,
		...plan.checks.map((check) =>
			check.kind === "browser"
				? `  ${check.id} (browser)${check.required ? " required" : " optional"}: ${check.browser.documentIdentity} ${check.browser.target.selector} ${JSON.stringify(check.browser.assertion)}; fresh isolated capture, strict verifier trust, no automatic repair`
				: `  ${check.id} (${check.kind})${check.required ? " required" : " optional"}: ${check.executable} ${check.args.join(" ")}`,
		),
		`Roles: ${plan.workflow === "QUICK" ? "Executor" : "Developer -> independent Reviewer"}`,
		`Project instruction: ${plan.projectInstructionPath ? `${plan.projectInstructionPath} (configured; frozen prompt context, not readable by workers)` : "none"}`,
		`LSP: ${plan.lspEnabled ? "enabled (trusted local program, not sandboxed)" : "disabled"}`,
		`Mutation mode: ${plan.mutationMode}${plan.mutationMode === "strict" ? " (strict freshness/precondition enforcement for existing files; not a permission and not approval)" : ""}`,
		`Command verifier trust: ${plan.verifierTrustMode}${plan.verifierTrustMode === "strict" ? " (frozen registration + trusted source integrity pinning; sources are protected from workers; not a sandbox)" : " (not strictly pinned)"}`,
		`Command verifier sandbox: ${plan.verifierSandboxMode === "required" ? "required (network denied; Host-owned fixed policy; not a sandbox for workers and not approval)" : "disabled"}`,
		...(plan.checks.some((check) => check.kind === "browser")
			? [
					"Browser checks: private HOME/profile/CDP pipe and guarded local-static GET; not an OS sandbox. Historical observations are not verification.",
				]
			: []),
		`Task context pack: ${plan.contextPackMode === "bounded" ? "bounded (Host-selected advisory context; policy-filtered; not permission, approval, evidence or mutation freshness)" : "disabled"}`,
		`Verification repair: ${plan.verificationRepairMode} (maximum one fresh attempt; STANDARD/EDIT/R1 SELF_CHECK only; original policy and cumulative budget retained)`,
		...(plan.verificationRepairMode === "self-check-once"
			? plan.checks
					.filter((check) => check.repairable_exit_codes?.length)
					.map(
						(check) => `  Repair-eligible normal exits: ${check.id}: ${check.repairable_exit_codes!.join(", ")}`,
					)
			: []),
		...(plan.verifierTrustSources.length
			? ["Trusted verifier sources:", ...plan.verifierTrustSources.map((path) => `  ${path}`)]
			: []),
		"Plan confirmation is not an approval or permission token; R3 deletion still requires separate one-time human approval.",
		"No automatic rollback, commit, merge or cleanup.",
	].join("\n");
}
