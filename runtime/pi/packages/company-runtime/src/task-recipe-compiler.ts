import { isPolicyPath, isProtectedPath } from "./policy.ts";
import {
	TASK_RECIPE_MAX_FIELD_BYTES,
	TASK_RECIPE_MAX_INPUT_BYTES,
	type TaskRecipeDefinition,
	type TaskRecipeDraft,
} from "./task-recipe-types.ts";
import { taskRecipeById } from "./task-recipes.ts";

/**
 * Host-side deterministic compiler: reviewed recipe data + user-supplied inputs -> acceptance-criteria draft.
 * The draft is not a Task Contract, grants no scope and registers no checks; it only prefills the existing
 * acceptance-criteria confirmation step.
 */
export class TaskRecipeError extends Error {
	constructor(reason: string) {
		super(`Task recipe rejected: ${reason}`);
		this.name = "TaskRecipeError";
	}
}

export interface TaskRecipeCompileInput {
	recipeId: string;
	/** User-supplied values; data only, never authority. */
	inputs: Record<string, unknown>;
	executionMode: "EDIT" | "READ_ONLY";
	/** Host-frozen allowed paths; the recipe may narrow but never widen them. */
	allowedPaths: readonly string[];
	/** Registered required check ids from the frozen config; recipes never invent checks. */
	registeredCheckIds: readonly string[];
}

function requireText(value: unknown, field: string): string {
	if (typeof value !== "string") throw new TaskRecipeError(`field ${field} must be a string`);
	const trimmed = value.trim();
	if (!trimmed) throw new TaskRecipeError(`field ${field} must not be blank`);
	if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(trimmed))
		throw new TaskRecipeError(`field ${field} contains control characters`);
	if (Buffer.byteLength(trimmed, "utf8") > TASK_RECIPE_MAX_FIELD_BYTES)
		throw new TaskRecipeError(`field ${field} exceeds ${TASK_RECIPE_MAX_FIELD_BYTES} bytes`);
	return trimmed;
}

function compileStatements(definition: TaskRecipeDefinition, values: Record<string, string>): string[] {
	return definition.criteriaTemplates.map((criterion) =>
		criterion.template.replace(/\{\{([a-z0-9_]+)\}\}/g, (_match, key: string) => {
			const value = values[key];
			if (value === undefined)
				throw new TaskRecipeError(`template ${criterion.key} references unknown field ${key}`);
			return value;
		}),
	);
}

export function compileTaskRecipe(input: TaskRecipeCompileInput): TaskRecipeDraft {
	const entry = taskRecipeById(input.recipeId);
	if (!entry) throw new TaskRecipeError(`unknown recipe ${input.recipeId}`);
	const { definition, digest } = entry;
	if (!definition.supportedExecutionModes.includes(input.executionMode))
		throw new TaskRecipeError(`recipe ${definition.id} does not support execution mode ${input.executionMode}`);
	if (!input.inputs || typeof input.inputs !== "object" || Array.isArray(input.inputs))
		throw new TaskRecipeError("inputs must be a JSON object");
	if (Buffer.byteLength(JSON.stringify(input.inputs), "utf8") > TASK_RECIPE_MAX_INPUT_BYTES)
		throw new TaskRecipeError(`inputs exceed ${TASK_RECIPE_MAX_INPUT_BYTES} bytes`);

	const known = new Set(definition.fields.map((field) => field.name));
	for (const key of Object.keys(input.inputs))
		if (!known.has(key)) throw new TaskRecipeError(`unknown field ${key} for recipe ${definition.id}`);

	const values: Record<string, string> = {};
	for (const field of definition.fields) {
		const raw = input.inputs[field.name];
		if (raw === undefined) {
			if (field.required) throw new TaskRecipeError(`missing required field ${field.name}`);
			continue;
		}
		values[field.name] = requireText(raw, field.name);
	}

	const scopePaths = [...new Set(input.allowedPaths)].sort();
	if (!scopePaths.length) throw new TaskRecipeError("no allowed path is configured for the recipe scope");
	for (const path of scopePaths) {
		if (!isPolicyPath(path) || isProtectedPath(path))
			throw new TaskRecipeError(`allowed path ${path} is not a safe policy path`);
	}
	const checkIds = [...new Set(input.registeredCheckIds)].sort();
	if (!checkIds.length) throw new TaskRecipeError("no registered required check is configured");

	return {
		recipe: { id: definition.id, version: definition.version, digest, title: definition.title },
		statements: compileStatements(definition, values),
		scopePaths,
		checkIds,
		advisoryNotes: [...(definition.advisoryNotes ?? [])],
	};
}
