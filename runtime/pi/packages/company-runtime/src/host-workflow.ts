import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiAgentExecutor } from "./agent-runner.ts";
import { isSupportedR3Goal } from "./approval.ts";
import { classifyRequest, type RiskOverride, selectWorkflow } from "./classification.ts";
import { type ComplexClaimInspector, compileComplexPlan, parseComplexDraft } from "./complex-plan.ts";
import type { ComplexDraft, ComplexPlan } from "./complex-types.ts";
import type { RuntimeConfig } from "./config.ts";
import type { Risk, TaskContract, Workflow } from "./contracts.ts";
import { type ExecutionMode, proposeExecutionMode } from "./execution-contract.ts";
import { HostWorkflowError } from "./host-workflow-error.ts";
import { workflowModelRoutes } from "./model-routing.ts";
import type { PlanPreview } from "./plan-preview.ts";
import { FilePolicyPathInspector } from "./policy-paths.ts";
import { resolveProjectProtectedPaths } from "./project-protection.ts";
import { acceptanceStatementsError, buildTaskContract } from "./task-contract.ts";
import { compileTaskRecipe, TaskRecipeError } from "./task-recipe-compiler.ts";
import { StandardWorkflow, type WorkflowOptions } from "./workflow.ts";

export { HostWorkflowError } from "./host-workflow-error.ts";

/**
 * COMPLEX was selected but no structured decomposition plan came with the goal. Same existing Host Control code
 * (UNSUPPORTED_WORKFLOW) and message; the type lets a free-text Host (the TUI) say where a plan is prepared.
 */
export class ComplexPlanRequiredError extends HostWorkflowError {
	constructor(risk: Risk) {
		super(
			"UNSUPPORTED_WORKFLOW",
			`Unsupported classification/workflow: COMPLEX/${risk}; COMPLEX requires a structured decomposition plan (complexDraft); no downgrade performed`,
		);
	}
}

export interface HostWorkflowDraft {
	goal: string;
	config: RuntimeConfig;
	executionMode: ExecutionMode;
	workflow: Workflow;
	risk: Risk;
	/** User-confirmed keyword-only R3 override (TUI only); not an approval and adds no tools. */
	riskOverride?: RiskOverride;
	statements: string[];
	recipe?: { id: string; version: number; digest: string };
	/** Shape-checked structured COMPLEX proposal; present iff workflow is COMPLEX. Draft data, never authority. */
	complexDraft?: ComplexDraft;
	/** Explicit per-run user choice (TUI `--deep` only): Developers use `models.intents.deep`. Never automatic. */
	deep?: true;
}

export interface HostWorkflowPlan extends HostWorkflowDraft {
	taskContract: TaskContract;
	/** Present iff workflow is COMPLEX: the immutable Host-compiled plan bound to `taskContract`. */
	complexPlan?: ComplexPlan;
	preview: PlanPreview;
}

/** Deterministic Host-side planning only; no models, workers, checks or writer are created. */
export function prepareHostWorkflowDraft(input: {
	goal: string;
	config: RuntimeConfig;
	riskOverride?: RiskOverride;
	/** Untrusted `workflow.prepare.complexDraft`; required for COMPLEX and rejected for QUICK/STANDARD. */
	complexDraft?: unknown;
	/** Explicit per-run `deep` model intent for Developers (TUI `--deep`); Host Control never sets it. */
	deep?: boolean;
}): HostWorkflowDraft {
	const { goal, config, riskOverride, complexDraft, deep } = input;
	// Refused before any dialog, model or Run: deep is never selected automatically and has no fallback.
	if (deep && !config.models.intents?.deep)
		throw new HostWorkflowError(
			"INVALID_REQUEST",
			"--deep needs models.intents.deep naming a configured profile in .ai/config.yaml; deep is never selected automatically and has no fallback",
		);
	const proposal = proposeExecutionMode(goal);
	if (proposal.requiresConfirmation || !proposal.mode) throw new HostWorkflowError("INVALID_GOAL", proposal.reason);
	try {
		const { classification, requiresConfirmation } = classifyRequest(goal, {}, riskOverride);
		const selection = selectWorkflow(classification, config.runtime.workflow);
		// A COMPLEX classification is never silently run by a configured QUICK/STANDARD organization.
		if (requiresConfirmation || (classification.complexity === "COMPLEX" && selection.workflow !== "COMPLEX"))
			throw new HostWorkflowError(
				"UNSUPPORTED_WORKFLOW",
				`Unsupported classification/workflow: ${classification.complexity}/${classification.risk}; no downgrade performed`,
			);
		// Refuse before plan editing/confirmation instead of after it (the run would refuse the same goal).
		if (classification.risk === "R3" && !(proposal.mode === "EDIT" && isSupportedR3Goal(goal)))
			throw new HostWorkflowError(
				"UNSUPPORTED_WORKFLOW",
				`Unsupported classification/workflow: ${classification.complexity}/R3; the only supported R3 action is "delete file <path>" (one safe relative path); no downgrade performed`,
			);
		// COMPLEX runs only an explicit bounded decomposition; heuristic free-text decomposition is never invented.
		if (selection.workflow === "COMPLEX" && complexDraft === undefined)
			throw new ComplexPlanRequiredError(classification.risk);
		if (selection.workflow !== "COMPLEX" && complexDraft !== undefined)
			throw new HostWorkflowError(
				"INVALID_REQUEST",
				`complexDraft is accepted only when COMPLEX is selected; this goal selects ${selection.workflow}`,
			);
		if (selection.workflow === "QUICK" && ["R2", "R3"].includes(classification.risk))
			throw new HostWorkflowError("UNSUPPORTED_WORKFLOW", "R2/R3 cannot run as QUICK; STANDARD is required");
		if (deep && selection.workflow === "QUICK")
			throw new HostWorkflowError(
				"UNSUPPORTED_WORKFLOW",
				"--deep routes this run's Developers to models.intents.deep; this goal selects QUICK (one Executor, no Developer); no downgrade or fallback performed",
			);
		return {
			goal,
			config: structuredClone(config),
			executionMode: proposal.mode,
			workflow: selection.workflow,
			risk: classification.risk,
			// Copy only the validated fields; classifyRequest already bound `to` to the rule-based risk.
			...(riskOverride ? { riskOverride: { from: riskOverride.from, to: riskOverride.to } } : {}),
			statements: [goal],
			...(selection.workflow === "COMPLEX" ? { complexDraft: parseComplexDraft(complexDraft) } : {}),
			...(deep ? { deep: true as const } : {}),
		};
	} catch (error) {
		if (error instanceof HostWorkflowError) throw error;
		throw new HostWorkflowError(
			"UNSUPPORTED_WORKFLOW",
			error instanceof Error ? error.message : "Unsupported classification/workflow; no downgrade performed",
		);
	}
}

/** Reviewed recipe data only drafts criteria; it never grants scope, checks or authority. */
export function applyHostWorkflowRecipe(
	draft: HostWorkflowDraft,
	input: { recipeId: string; inputs: Record<string, unknown> },
): HostWorkflowDraft {
	if (draft.workflow !== "STANDARD")
		throw new HostWorkflowError(
			"INVALID_RECIPE",
			`recipe ${input.recipeId} needs the STANDARD acceptance-criteria step; QUICK runs take a goal only. No run was created.`,
		);
	try {
		const compiled = compileTaskRecipe({
			...input,
			executionMode: draft.executionMode,
			allowedPaths: draft.config.files.allowed_paths,
			registeredCheckIds: draft.config.verification.checks
				.filter((check) => check.required)
				.map((check) => check.id),
		});
		return {
			...draft,
			statements: compiled.statements,
			recipe: { id: compiled.recipe.id, version: compiled.recipe.version, digest: compiled.recipe.digest },
		};
	} catch (error) {
		throw new HostWorkflowError(
			"INVALID_RECIPE",
			error instanceof TaskRecipeError ? error.message : "recipe inputs must be a JSON object",
		);
	}
}

/** Freeze the user-reviewed statements into the pending parent Task Contract, once. */
function freezeHostParent(
	draft: HostWorkflowDraft,
	statements: readonly string[],
): { snapshot: HostWorkflowDraft; taskContract: TaskContract } {
	const statementsError = acceptanceStatementsError(statements);
	if (statementsError) throw new HostWorkflowError("INVALID_CRITERIA", statementsError);
	const snapshot = structuredClone({ ...draft, statements: [...statements] });
	const { goal, config, workflow } = snapshot;
	try {
		return { snapshot, taskContract: buildTaskContract({ goal, statements: snapshot.statements, workflow, config }) };
	} catch (error) {
		throw new HostWorkflowError(
			"INVALID_CRITERIA",
			error instanceof Error ? error.message : "Invalid acceptance criteria",
		);
	}
}

function hostPlanPreview(
	snapshot: HostWorkflowDraft,
	taskContract: TaskContract,
	complexPlan?: ComplexPlan,
): PlanPreview {
	const { goal, config, workflow, executionMode, risk, riskOverride, recipe } = snapshot;
	return {
		goal,
		workflow,
		executionMode,
		risk,
		...(riskOverride ? { riskOverride } : {}),
		// The same deterministic routing the adapter preflights and executes; display data, never a grant.
		modelRoutes: workflowModelRoutes(config, workflow, snapshot.deep === true),
		acceptanceCriteria: taskContract.acceptanceCriteria,
		allowedPaths: config.files.allowed_paths,
		checks: config.verification.checks,
		projectInstructionPath: config.project?.instructions.path ?? null,
		lspEnabled: config.code_intelligence?.lsp.enabled === true,
		mutationMode: config.mutation.mode,
		verifierTrustMode: config.verification.trust.mode,
		verifierSandboxMode: config.verification.sandbox.mode,
		contextPackMode: config.agents.context_pack.mode,
		verificationRepairMode: config.verification.repair.mode,
		...(recipe ? { recipe } : {}),
		verifierTrustSources: [...new Set(config.verification.checks.flatMap((check) => check.trust.files))].sort(),
		...(complexPlan ? { complexPlan } : {}),
	};
}

/** Snapshot the user-reviewed data before the Host asks for explicit plan confirmation. */
export function finalizeHostWorkflowPlan(
	draft: HostWorkflowDraft,
	statements: readonly string[] = draft.statements,
): HostWorkflowPlan {
	if (draft.workflow === "COMPLEX")
		throw new HostWorkflowError(
			"UNSUPPORTED_WORKFLOW",
			"Unsupported classification/workflow: COMPLEX plans are compiled with Host path inspection (finalizeComplexHostWorkflowPlan); no downgrade performed",
		);
	const { snapshot, taskContract } = freezeHostParent(draft, statements);
	return { ...snapshot, taskContract, preview: hostPlanPreview(snapshot, taskContract) };
}

/**
 * Real Host adapters for the pure COMPLEX compiler: exact-spelling facts from `FilePolicyPathInspector` and the
 * protected paths the Run's Policy receives (verifier/LSP sources, Runtime source, project instruction).
 * Read-only and bounded; opened only when the compiler asks for claim facts.
 */
export function hostComplexClaimInspector(cwd: string, config: RuntimeConfig): ComplexClaimInspector {
	return {
		inspect: async (paths) => {
			const inspector = await FilePolicyPathInspector.open(cwd);
			const protectedPaths = await resolveProjectProtectedPaths(inspector.projectPath, config);
			if (config.project) protectedPaths.push(config.project.instructions.path);
			return { facts: await inspector.inspectOwnership(paths), protectedPaths };
		},
	};
}

/**
 * COMPLEX preparation: freeze the parent once (every AC review-required), then compile and bind the immutable
 * plan (INVALID_REQUEST for shape/bytes, INVALID_CRITERIA for graph/coverage/ownership/check/limit). Side-effect
 * free: bounded read-only path inspection only, no model, check, writer, Approval or durable Run.
 */
export async function finalizeComplexHostWorkflowPlan(
	draft: HostWorkflowDraft,
	statements: readonly string[],
	options: { cwd: string },
): Promise<HostWorkflowPlan> {
	if (draft.workflow !== "COMPLEX" || draft.complexDraft === undefined)
		throw new HostWorkflowError("INVALID_REQUEST", "A COMPLEX plan needs the COMPLEX workflow and a complexDraft");
	const { snapshot, taskContract } = freezeHostParent(draft, statements);
	const complexPlan = await compileComplexPlan({
		planId: randomUUID(),
		parent: taskContract,
		draft: snapshot.complexDraft,
		config: snapshot.config,
		executionMode: snapshot.executionMode,
		risk: snapshot.risk,
		claims: hostComplexClaimInspector(options.cwd, snapshot.config),
	});
	return { ...snapshot, taskContract, complexPlan, preview: hostPlanPreview(snapshot, taskContract, complexPlan) };
}

export interface CreateHostWorkflowOptions {
	cwd: string;
	plan: HostWorkflowPlan;
	agentDir: string;
	signal: AbortSignal;
	events?: WorkflowOptions["events"];
	approval?: WorkflowOptions["approval"];
	approvalTimeoutMs?: number;
	createModels?: (signal: AbortSignal) => Promise<ModelRuntime>;
	startGuard?: WorkflowOptions["startGuard"];
}

/**
 * Call only after affirmative Host confirmation; execution still belongs to StandardWorkflow. A COMPLEX plan runs
 * only with its frozen Host-compiled plan, which the Workflow revalidates before any writer or Run exists.
 */
export async function createHostWorkflow(options: CreateHostWorkflowOptions): Promise<StandardWorkflow> {
	const { cwd, agentDir, signal } = options;
	signal.throwIfAborted();
	if ((options.plan.workflow === "COMPLEX") !== (options.plan.complexPlan !== undefined))
		throw new HostWorkflowError(
			options.plan.workflow === "COMPLEX" ? "UNSUPPORTED_WORKFLOW" : "INVALID_REQUEST",
			`Unsupported classification/workflow: ${options.plan.workflow}/${options.plan.risk}; a COMPLEX plan runs only as COMPLEX with its confirmed plan; no model, writer or Run was created`,
		);
	const { goal, executionMode, deep } = options.plan;
	const { config, taskContract, recipe, riskOverride, complexPlan } = structuredClone({
		config: options.plan.config,
		taskContract: options.plan.taskContract,
		recipe: options.plan.recipe,
		riskOverride: options.plan.riskOverride,
		complexPlan: options.plan.complexPlan,
	});
	const models = options.createModels
		? await options.createModels(signal)
		: await ModelRuntime.create({
				authPath: join(agentDir, "auth.json"),
				modelsPath: join(agentDir, "models.json"),
				allowModelNetwork: false,
				signal,
			});
	return new StandardWorkflow({
		cwd,
		goal,
		taskContract,
		executionMode,
		...(recipe ? { recipe } : {}),
		...(riskOverride ? { riskOverride } : {}),
		...(complexPlan ? { complexPlan } : {}),
		config,
		signal,
		events: options.events,
		approval: options.approval,
		approvalTimeoutMs: options.approvalTimeoutMs,
		startGuard: options.startGuard,
		createAgents: async (store, quickScope, r2RunId, r3Scope, executionContract) => {
			const executor = await PiAgentExecutor.create({
				executionContract,
				cwd,
				agentDir,
				config,
				timeoutMs: config.agents.worker_timeout_ms,
				modelRuntime: models,
				audit: store,
				quickScope,
				r2RunId,
				r3Scope,
				// V0.8A: a COMPLEX wave runs up to its frozen maxParallel Developers at once; otherwise one worker.
				maxConcurrentWorkers: complexPlan?.limits.maxParallel ?? 1,
				// The user-confirmed per-run model choice only; it changes no contract, Policy or authority.
				...(deep ? { deep: true } : {}),
			});
			return { executor, policy: executor.policyContext };
		},
	});
}
