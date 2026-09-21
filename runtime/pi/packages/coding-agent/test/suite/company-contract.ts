import { classifyRequest, selectWorkflow } from "../../../company-runtime/src/classification.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../../../company-runtime/src/config.ts";
import {
	type ExecutorResult,
	isCriteriaHandoff,
	isTaskContract,
	type TaskContract,
	type TaskRecord,
	type Workflow,
} from "../../../company-runtime/src/contracts.ts";
import { buildTaskContract } from "../../../company-runtime/src/task-contract.ts";

export interface SuiteContractOptions {
	statements?: string[];
	workflow?: Workflow;
	checkIds?: string[];
	allowedPaths?: string[];
	taskId?: string;
}

/** Minimal trusted config for fixture contracts; callers pass the same check IDs to the Kernel. */
export function suiteConfig(options: SuiteContractOptions = {}): RuntimeConfig {
	return parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			files: { allowed_paths: options.allowedPaths ?? ["src"] },
			verification: {
				checks: (options.checkIds ?? ["regression"]).map((id) => ({
					id,
					kind: "test",
					executable: "never-execute",
					args: [],
				})),
			},
		}),
	);
}

/** Host-confirmed contract for suite fixtures: production ID assignment and check mapping are reused as-is. */
export function suiteContract(goal: string, options: SuiteContractOptions = {}): TaskContract {
	return buildTaskContract({
		goal,
		statements: options.statements ?? [goal],
		workflow: options.workflow ?? "STANDARD",
		config: suiteConfig(options),
		...(options.taskId ? { taskId: options.taskId } : {}),
	});
}

/** Contract bound to the same classification/config the workflow will select; mirrors extension preflight. */
export function workflowContract(
	goal: string,
	config: RuntimeConfig,
	options: { statements?: string[]; taskId?: string } = {},
): TaskContract {
	const { classification } = classifyRequest(goal);
	const workflow = selectWorkflow(classification, config.runtime.workflow).workflow;
	return buildTaskContract({
		goal,
		statements: options.statements ?? [goal],
		workflow,
		config,
		...(options.taskId ? { taskId: options.taskId } : {}),
	});
}

/** Test-only narrowing for live runs; fails loudly instead of silently ignoring a legacy shape. */
export function contractOf(run: { tasks: TaskRecord[] }): TaskContract {
	const task = run.tasks[0];
	if (!task || !isTaskContract(task)) throw new Error("Suite fixture expected a Task Contract");
	return task;
}

/** Criteria of a live Executor result; legacy statement-based results return undefined. */
export function executorCriteria(result: ExecutorResult | undefined) {
	return result && isCriteriaHandoff(result) ? result.criteria : undefined;
}
