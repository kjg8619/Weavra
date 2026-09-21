import { join } from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiAgentExecutor } from "./agent-runner.ts";
import { classifyRequest, selectWorkflow } from "./classification.ts";
import type { RuntimeConfig } from "./config.ts";
import type { Risk, TaskContract } from "./contracts.ts";
import { type ExecutionMode, proposeExecutionMode } from "./execution-contract.ts";
import type { HostControlErrorCode } from "./host-control-protocol.ts";
import type { PlanPreview } from "./plan-preview.ts";
import { acceptanceStatementsError, buildTaskContract } from "./task-contract.ts";
import { compileTaskRecipe, TaskRecipeError } from "./task-recipe-compiler.ts";
import { StandardWorkflow, type WorkflowOptions } from "./workflow.ts";

export class HostWorkflowError extends Error {
	readonly code: HostControlErrorCode;

	constructor(code: HostControlErrorCode, message: string) {
		super(message);
		this.name = "HostWorkflowError";
		this.code = code;
	}
}

export interface HostWorkflowDraft {
	goal: string;
	config: RuntimeConfig;
	executionMode: ExecutionMode;
	workflow: "QUICK" | "STANDARD";
	risk: Risk;
	statements: string[];
	recipe?: { id: string; version: number; digest: string };
}

export interface HostWorkflowPlan extends HostWorkflowDraft {
	taskContract: TaskContract;
	preview: PlanPreview;
}

/** Deterministic Host-side planning only; no models, workers, checks or writer are created. */
export function prepareHostWorkflowDraft(input: { goal: string; config: RuntimeConfig }): HostWorkflowDraft {
	const { goal, config } = input;
	const proposal = proposeExecutionMode(goal);
	if (proposal.requiresConfirmation || !proposal.mode) throw new HostWorkflowError("INVALID_GOAL", proposal.reason);
	try {
		const { classification, requiresConfirmation } = classifyRequest(goal);
		if (requiresConfirmation || classification.complexity === "COMPLEX")
			throw new HostWorkflowError(
				"UNSUPPORTED_WORKFLOW",
				`Unsupported classification/workflow: ${classification.complexity}/${classification.risk}; no downgrade performed`,
			);
		const selection = selectWorkflow(classification, config.runtime.workflow);
		if (selection.workflow === "COMPLEX")
			throw new HostWorkflowError(
				"UNSUPPORTED_WORKFLOW",
				`Unsupported classification/workflow: ${selection.workflow}/${classification.risk}; no downgrade performed`,
			);
		if (selection.workflow === "QUICK" && ["R2", "R3"].includes(classification.risk))
			throw new HostWorkflowError("UNSUPPORTED_WORKFLOW", "R2/R3 cannot run as QUICK; STANDARD is required");
		return {
			goal,
			config: structuredClone(config),
			executionMode: proposal.mode,
			workflow: selection.workflow,
			risk: classification.risk,
			statements: [goal],
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

/** Snapshot the user-reviewed data before the Host asks for explicit plan confirmation. */
export function finalizeHostWorkflowPlan(
	draft: HostWorkflowDraft,
	statements: readonly string[] = draft.statements,
): HostWorkflowPlan {
	const statementsError = acceptanceStatementsError(statements);
	if (statementsError) throw new HostWorkflowError("INVALID_CRITERIA", statementsError);
	const snapshot = structuredClone({ ...draft, statements: [...statements] });
	const { goal, config, workflow, executionMode, risk, recipe } = snapshot;
	let taskContract: TaskContract;
	try {
		taskContract = buildTaskContract({ goal, statements: snapshot.statements, workflow, config });
	} catch (error) {
		throw new HostWorkflowError(
			"INVALID_CRITERIA",
			error instanceof Error ? error.message : "Invalid acceptance criteria",
		);
	}
	return {
		...snapshot,
		taskContract,
		preview: {
			goal,
			workflow,
			executionMode,
			risk,
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
		},
	};
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

/** Call only after affirmative Host confirmation; execution still belongs to StandardWorkflow. */
export async function createHostWorkflow(options: CreateHostWorkflowOptions): Promise<StandardWorkflow> {
	const { cwd, agentDir, signal } = options;
	signal.throwIfAborted();
	const { goal, executionMode } = options.plan;
	const { config, taskContract, recipe } = structuredClone({
		config: options.plan.config,
		taskContract: options.plan.taskContract,
		recipe: options.plan.recipe,
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
			});
			return { executor, policy: executor.policyContext };
		},
	});
}
