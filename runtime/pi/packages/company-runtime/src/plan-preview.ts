import type { RiskOverride } from "./classification.ts";
import type { ComplexPlan } from "./complex-types.ts";
import type { RuntimeConfig } from "./config.ts";
import type { AcceptanceCriterion, Risk, Workflow } from "./contracts.ts";
import type { ExecutionMode } from "./execution-contract.ts";
import { SANDBOX_DISABLED_WARNING } from "./sandbox-advice.ts";

export interface PlanPreview {
	goal: string;
	workflow: Workflow;
	executionMode: ExecutionMode;
	risk: Risk;
	/** User-confirmed keyword-only R3 override; display only, never an approval or a tool grant. */
	riskOverride?: RiskOverride;
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
	/** Present iff workflow is COMPLEX: the complete immutable plan bound to this parent. Not an approval. */
	complexPlan?: ComplexPlan;
}

/** Render untrusted plan text without letting control, bidi or invisible characters restyle the preview. */
function displayText(text: string): string {
	let display = "";
	for (let index = 0; index < text.length; index++) {
		const code = text.charCodeAt(index);
		// C0/C1 controls plus zero-width, line/paragraph separator, bidi, word-joiner and BOM code points.
		const invisible =
			code <= 0x1f ||
			(code >= 0x7f && code <= 0x9f) ||
			(code >= 0x200b && code <= 0x200f) ||
			(code >= 0x2028 && code <= 0x202e) ||
			(code >= 0x2060 && code <= 0x206f) ||
			code === 0xfeff;
		display += invisible ? `U+${code.toString(16).toUpperCase().padStart(4, "0")}` : text[index];
	}
	return display;
}

function formatComplexPlan(plan: ComplexPlan): string[] {
	const { limits, integration } = plan;
	return [
		`COMPLEX plan ${plan.planId} ${plan.complexPlanDigest} (parent ${plan.parentTaskId} ${plan.parentTaskContractDigest}):`,
		"  Tasks run one at a time in this exact order, each only after every earlier task COMPLETED; no Planner/Lead, parallel work, reordering, retry or reassignment.",
		...plan.tasks.flatMap((task) => [
			`  ${task.id} ${displayText(task.title)}`,
			`    Goal: ${displayText(task.goal)}`,
			`    Depends on: ${task.dependsOn.join(", ") || "none"}`,
			`    Criteria: ${task.criterionIds.join(", ")}`,
			`    Owned files: ${task.ownership.length ? task.ownership.map((claim) => `${claim.operation} ${claim.path}`).join("; ") : "none (read-only contribution)"}`,
			`    Local checks (mandatory, run fresh before and after an independent task review): ${task.checkIds.join(", ")}`,
			`    Local revision cycles: at most ${task.maxRevisionCycles}`,
		]),
		`  Integration after every task COMPLETED: fresh checks ${integration.checkIds.join(", ")}, a new independent final review of ${integration.criterionIds.join(", ")}, then fresh final checks`,
		`  Limits: ${limits.maxTasks} tasks; ${limits.maxWorkerInvocations} worker invocations; ${limits.maxReportedTokens} provider-reported tokens (not a billing cap); ${limits.maxTotalRevisionCycles} total revision cycles`,
		"  Owned files are exclusive responsibility, not permission: Policy, R2 review and R3 approval still apply, and unclaimed files are denied. The plan cannot change after confirmation.",
	];
}

/** Host-side display only. Confirming this plan is neither an approval nor a permission token. */
export function formatPlanPreview(plan: PlanPreview): string {
	const complex = plan.complexPlan;
	return [
		`Goal: ${plan.goal}`,
		...(plan.recipe ? [`Recipe: ${plan.recipe.id}@${plan.recipe.version} ${plan.recipe.digest}`] : []),
		`Workflow: ${plan.workflow}`,
		`Execution contract: ${plan.executionMode}`,
		`Risk: ${plan.risk}`,
		...(plan.riskOverride
			? [
					`  User-confirmed override from ${plan.riskOverride.from} (risk keywords only); not an approval and no delete/shell/deploy tools are added`,
				]
			: []),
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
		...(complex ? formatComplexPlan(complex) : []),
		`Roles: ${plan.workflow === "QUICK" ? "Executor" : complex ? "Developer -> independent Reviewer for each task, then a new independent final Reviewer (no Planner/Lead)" : "Developer -> independent Reviewer"}`,
		`Project instruction: ${plan.projectInstructionPath ? `${plan.projectInstructionPath} (configured; frozen prompt context, not readable by workers)` : "none"}`,
		`LSP: ${plan.lspEnabled ? "enabled (trusted local program, not sandboxed)" : "disabled"}`,
		`Mutation mode: ${plan.mutationMode}${plan.mutationMode === "strict" ? " (strict freshness/precondition enforcement for existing files; not a permission and not approval)" : ""}`,
		`Command verifier trust: ${plan.verifierTrustMode}${plan.verifierTrustMode === "strict" ? " (frozen registration + trusted source integrity pinning; sources are protected from workers; not a sandbox)" : " (not strictly pinned)"}`,
		`Command verifier sandbox: ${plan.verifierSandboxMode === "required" ? "required (network denied; Host-owned fixed policy; not a sandbox for workers and not approval)" : `disabled. ${SANDBOX_DISABLED_WARNING}`}`,
		...(plan.checks.some((check) => check.kind === "browser")
			? [
					"Browser checks: private HOME/profile/CDP pipe and guarded local-static GET; not an OS sandbox. Historical observations are not verification.",
				]
			: []),
		`Task context pack: ${plan.contextPackMode === "bounded" ? "bounded (Host-selected advisory context; policy-filtered; not permission, approval, evidence or mutation freshness)" : "disabled"}`,
		complex
			? "Verification repair: not used by COMPLEX (a failed task SELF_CHECK or TEST blocks the Run; no repair cycle)"
			: `Verification repair: ${plan.verificationRepairMode} (maximum one fresh attempt; STANDARD/EDIT/R1 SELF_CHECK only; original policy and cumulative budget retained)`,
		...(!complex && plan.verificationRepairMode === "self-check-once"
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
