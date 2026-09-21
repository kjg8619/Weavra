import { createHash } from "node:crypto";
import { type Static, Type } from "typebox";
import { validateContract } from "./contracts.ts";

/**
 * Task Recipe (V0.5B, C03) is reviewed, versioned Host-side **data** that drafts acceptance criteria.
 * It is not a planner, worker, skill runtime, plugin, permission, approval or verification evidence, and
 * the definition schema cannot carry executables, shell commands, installs, hooks or tool grants.
 */
export const TASK_RECIPE_SCHEMA_VERSION = 1;
export const TASK_RECIPE_DIGEST_DOMAIN = "weavra-task-recipe-v1";
export const TASK_RECIPE_MAX_FIELD_BYTES = 4096;
export const TASK_RECIPE_MAX_INPUT_BYTES = 16384;

const text = Type.String({ minLength: 1, pattern: "\\S" });
const strict = { additionalProperties: false } as const;

export const TaskRecipeFieldSchema = Type.Object(
	{
		name: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z][a-z0-9_]*$" }),
		label: text,
		required: Type.Boolean(),
	},
	strict,
);

export const TaskRecipeCriterionTemplateSchema = Type.Object(
	{ key: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z][a-z0-9_]*$" }), template: text },
	strict,
);

/** Reviewed recipe definition: data only, no execution surface. */
export const TaskRecipeDefinitionSchema = Type.Object(
	{
		schemaVersion: Type.Literal(TASK_RECIPE_SCHEMA_VERSION),
		id: Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z][a-z0-9-]*$" }),
		version: Type.Integer({ minimum: 1, maximum: 999 }),
		title: text,
		description: text,
		supportedExecutionModes: Type.Array(Type.Union([Type.Literal("EDIT"), Type.Literal("READ_ONLY")]), {
			minItems: 1,
			maxItems: 2,
			uniqueItems: true,
		}),
		fields: Type.Array(TaskRecipeFieldSchema, { minItems: 1, maxItems: 12 }),
		criteriaTemplates: Type.Array(TaskRecipeCriterionTemplateSchema, { minItems: 1, maxItems: 12 }),
		advisoryNotes: Type.Optional(Type.Array(text, { maxItems: 8 })),
	},
	strict,
);

export type TaskRecipeDefinition = Static<typeof TaskRecipeDefinitionSchema>;

/** Host-side intermediate: still not a Task Contract until the user confirms it. */
export interface TaskRecipeDraft {
	recipe: { id: string; version: number; digest: string; title: string };
	statements: string[];
	scopePaths: string[];
	checkIds: string[];
	advisoryNotes: string[];
}

function canonical(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(canonical);
	if (value && typeof value === "object")
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([key, entry]) => [key, canonical(entry)]),
		);
	return value;
}

/** Canonical recipe digest; provenance only, never permission or verification evidence. */
export function taskRecipeDigest(definition: TaskRecipeDefinition): string {
	const validated = validateContract(TaskRecipeDefinitionSchema, structuredClone(definition));
	return `sha256:${createHash("sha256")
		.update(JSON.stringify({ domain: TASK_RECIPE_DIGEST_DOMAIN, recipe: canonical(validated) }))
		.digest("hex")}`;
}
