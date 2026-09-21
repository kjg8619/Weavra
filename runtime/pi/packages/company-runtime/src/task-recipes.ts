import { validateContract } from "./contracts.ts";
import { type TaskRecipeDefinition, TaskRecipeDefinitionSchema, taskRecipeDigest } from "./task-recipe-types.ts";

/**
 * Built-in reviewed recipe registry (V0.5B). Recipes ship as versioned data in the Runtime source; there is
 * no filesystem discovery, remote download, npm install or hook execution, and no automatic loading.
 */
const DEFINITIONS: readonly TaskRecipeDefinition[] = [
	{
		schemaVersion: 1,
		id: "bugfix",
		version: 1,
		title: "Bug Fix",
		description: "Fix a described reproduction while preserving existing behaviour and regression coverage.",
		supportedExecutionModes: ["EDIT"],
		fields: [
			{ name: "reproduction", label: "Reproduction condition", required: true },
			{ name: "expected", label: "Expected behaviour", required: true },
			{ name: "preserve", label: "Behaviour to preserve", required: true },
			{ name: "regression", label: "Regression coverage", required: true },
		],
		criteriaTemplates: [
			{ key: "reproduction", template: "Fix the described reproduction condition: {{reproduction}}" },
			{ key: "expected", template: "Result matches the expected behaviour: {{expected}}" },
			{ key: "preserve", template: "Preserve existing behaviour outside the fix: {{preserve}}" },
			{ key: "regression", template: "Add or maintain regression coverage: {{regression}}" },
		],
		advisoryNotes: ["Reviewed Host template; the confirmed acceptance criteria remain authoritative."],
	},
	{
		schemaVersion: 1,
		id: "safe-refactor",
		version: 1,
		title: "Safe Refactor",
		description: "Improve internal structure without changing external behaviour or mutating outside scope.",
		supportedExecutionModes: ["EDIT"],
		fields: [
			{ name: "target", label: "Refactor target", required: true },
			{ name: "behaviour", label: "External behaviour that must not change", required: true },
			{ name: "scope", label: "Scope that may change", required: true },
			{ name: "regression", label: "Existing regression to keep", required: true },
		],
		criteriaTemplates: [
			{ key: "target", template: "Refactor the internal structure of: {{target}}" },
			{ key: "behaviour", template: "External behaviour stays unchanged: {{behaviour}}" },
			{ key: "scope", template: "Mutate nothing outside the stated scope: {{scope}}" },
			{ key: "regression", template: "Keep the existing regression coverage passing: {{regression}}" },
		],
	},
	{
		schemaVersion: 1,
		id: "test-addition",
		version: 1,
		title: "Test Addition",
		description: "Add coverage for a stated condition without changing production behaviour unnecessarily.",
		supportedExecutionModes: ["EDIT"],
		fields: [
			{ name: "condition", label: "Condition to cover", required: true },
			{ name: "target", label: "Target under test", required: true },
			{ name: "baseline", label: "Existing baseline to keep", required: true },
			{ name: "coverage", label: "Coverage to add", required: true },
		],
		criteriaTemplates: [
			{ key: "condition", template: "Cover the stated condition: {{condition}}" },
			{ key: "target", template: "Coverage targets: {{target}}" },
			{ key: "baseline", template: "Existing baseline stays valid: {{baseline}}" },
			{ key: "coverage", template: "Added or improved coverage: {{coverage}}" },
		],
	},
	{
		schemaVersion: 1,
		id: "read-only-investigation",
		version: 1,
		title: "Read-only Investigation",
		description: "Investigate and explain only; no mutation, and recommendations are proposals.",
		supportedExecutionModes: ["READ_ONLY"],
		fields: [
			{ name: "observations", label: "Observed facts", required: true },
			{ name: "possible_causes", label: "Possible causes", required: true },
			{ name: "unknowns", label: "Not yet verified", required: true },
			{ name: "requested_recommendation", label: "Recommendation requested", required: true },
		],
		criteriaTemplates: [
			{ key: "observations", template: "Summarise the observed facts: {{observations}}" },
			{ key: "possible_causes", template: "Distinguish possible causes: {{possible_causes}}" },
			{ key: "unknowns", template: "State what remains unverified: {{unknowns}}" },
			{
				key: "requested_recommendation",
				template: "Propose (do not implement) the requested recommendation: {{requested_recommendation}}",
			},
		],
		advisoryNotes: ["Read-only investigation: no mutation is permitted for this recipe."],
	},
];

const REGISTRY = new Map<string, { definition: TaskRecipeDefinition; digest: string }>();
for (const raw of DEFINITIONS) {
	const definition = validateContract(TaskRecipeDefinitionSchema, structuredClone(raw) as unknown);
	REGISTRY.set(definition.id, { definition, digest: taskRecipeDigest(definition) });
}

export function listTaskRecipes(): Array<{ id: string; version: number; title: string; digest: string }> {
	return [...REGISTRY.values()].map(({ definition, digest }) => ({
		id: definition.id,
		version: definition.version,
		title: definition.title,
		digest,
	}));
}

/** Editor prefill for recipe inputs: declared fields only, empty values, unknown ids stay an empty object. */
export function recipeInputTemplate(id: string): string {
	const entry = taskRecipeById(id);
	if (!entry) return "{}";
	return JSON.stringify(Object.fromEntries(entry.definition.fields.map((field) => [field.name, ""])), null, 2);
}

export function taskRecipeById(id: string): { definition: TaskRecipeDefinition; digest: string } | undefined {
	const entry = REGISTRY.get(id);
	return entry ? { definition: structuredClone(entry.definition), digest: entry.digest } : undefined;
}
