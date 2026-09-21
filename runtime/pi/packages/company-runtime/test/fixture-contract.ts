import { parseRuntimeConfig, type RuntimeConfig } from "../src/config.ts";
import { isTaskContract, type TaskContract, type TaskRecord, type Workflow } from "../src/contracts.ts";
import { buildTaskContract } from "../src/task-contract.ts";

export interface TestContractOptions {
	statements?: string[];
	workflow?: Workflow;
	checkIds?: string[];
	allowedPaths?: string[];
	taskId?: string;
}

/** Minimal trusted config for fixture contracts; callers pass the same check IDs to the Kernel. */
export function testConfig(options: TestContractOptions = {}): RuntimeConfig {
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

/** Host-confirmed contract for tests: production ID assignment and check mapping are reused as-is. */
export function testContract(goal: string, options: TestContractOptions = {}): TaskContract {
	return buildTaskContract({
		goal,
		statements: options.statements ?? [goal],
		workflow: options.workflow ?? "STANDARD",
		config: testConfig(options),
		...(options.taskId ? { taskId: options.taskId } : {}),
	});
}

/** Test-only narrowing for live runs; fails loudly instead of silently ignoring a legacy shape. */
export function contractOf(run: { tasks: TaskRecord[] }): TaskContract {
	const task = run.tasks[0];
	if (!task || !isTaskContract(task)) throw new Error("Test fixture expected a Task Contract");
	return task;
}
