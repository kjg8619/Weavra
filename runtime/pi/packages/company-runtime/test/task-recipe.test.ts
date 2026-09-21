import { describe, expect, it } from "vitest";
import { compileTaskRecipe, TaskRecipeError } from "../src/task-recipe-compiler.ts";
import { TASK_RECIPE_DIGEST_DOMAIN, taskRecipeDigest } from "../src/task-recipe-types.ts";
import { listTaskRecipes, taskRecipeById } from "../src/task-recipes.ts";

const ALLOWED = ["src", "test"];
const CHECKS = ["regression"];

const inputs = (overrides: Record<string, unknown> = {}) => ({
	reproduction: "greet('') returns 'Hello, !'",
	expected: "greet('') returns 'Hello, !'",
	preserve: "all other greeting outputs",
	regression: "test/greeting.test.mjs stays green",
	...overrides,
});

describe("V0.5B built-in reviewed recipes", () => {
	it("ships exactly the four reviewed built-ins with version and digest", () => {
		expect(
			listTaskRecipes()
				.map((recipe) => recipe.id)
				.sort(),
		).toEqual(["bugfix", "read-only-investigation", "safe-refactor", "test-addition"]);
		for (const recipe of listTaskRecipes()) {
			expect(recipe.version).toBeGreaterThanOrEqual(1);
			expect(recipe.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
			expect(recipe.title.length).toBeGreaterThan(0);
		}
	});

	it("keeps the digest canonical and change-sensitive", () => {
		const bugfix = taskRecipeById("bugfix")!;
		expect(taskRecipeDigest(bugfix.definition)).toBe(bugfix.digest);
		// Re-serialize with a different key order: same semantics, same digest.
		const reordered = JSON.parse(
			JSON.stringify({
				advisoryNotes: bugfix.definition.advisoryNotes,
				criteriaTemplates: bugfix.definition.criteriaTemplates,
				fields: bugfix.definition.fields,
				description: bugfix.definition.description,
				title: bugfix.definition.title,
				supportedExecutionModes: bugfix.definition.supportedExecutionModes,
				version: bugfix.definition.version,
				id: bugfix.definition.id,
				schemaVersion: bugfix.definition.schemaVersion,
			}),
		);
		expect(taskRecipeDigest(reordered)).toBe(bugfix.digest);
		expect(taskRecipeDigest({ ...bugfix.definition, version: 2 })).not.toBe(bugfix.digest);
		expect(taskRecipeDigest({ ...bugfix.definition, id: "bugfix-2" })).not.toBe(bugfix.digest);
		expect(
			taskRecipeDigest({
				...bugfix.definition,
				criteriaTemplates: [{ key: "reproduction", template: "Different: {{reproduction}}" }],
			}),
		).not.toBe(bugfix.digest);
		expect(TASK_RECIPE_DIGEST_DOMAIN).toBe("weavra-task-recipe-v1");
	});

	it("compiles deterministic drafts for every built-in recipe", () => {
		const bugfix = compileTaskRecipe({
			recipeId: "bugfix",
			inputs: inputs(),
			executionMode: "EDIT",
			allowedPaths: ALLOWED,
			registeredCheckIds: CHECKS,
		});
		expect(bugfix.recipe).toMatchObject({ id: "bugfix", version: 1 });
		expect(bugfix.statements).toHaveLength(4);
		expect(bugfix.statements[0]).toContain("greet('') returns 'Hello, !'");
		expect(bugfix.scopePaths).toEqual([...ALLOWED].sort());
		expect(bugfix.checkIds).toEqual([...CHECKS]);
		expect(
			compileTaskRecipe({
				recipeId: "bugfix",
				inputs: inputs(),
				executionMode: "EDIT",
				allowedPaths: ["test", "src"],
				registeredCheckIds: CHECKS,
			}).statements,
		).toEqual(bugfix.statements);

		const refactor = compileTaskRecipe({
			recipeId: "safe-refactor",
			inputs: {
				target: "src/formatter.ts",
				behaviour: "formatLabel output",
				scope: "src/formatter.ts only",
				regression: "existing formatter tests",
			},
			executionMode: "EDIT",
			allowedPaths: ALLOWED,
			registeredCheckIds: CHECKS,
		});
		expect(refactor.statements).toHaveLength(4);

		const tests = compileTaskRecipe({
			recipeId: "test-addition",
			inputs: {
				condition: "empty name",
				target: "greet",
				baseline: "existing tests",
				coverage: "empty-name boundary",
			},
			executionMode: "EDIT",
			allowedPaths: ALLOWED,
			registeredCheckIds: CHECKS,
		});
		expect(tests.statements).toHaveLength(4);

		const investigation = compileTaskRecipe({
			recipeId: "read-only-investigation",
			inputs: {
				observations: "logs show a retry loop",
				possible_causes: "timeout or stale state",
				unknowns: "whether the retry is bounded",
				requested_recommendation: "propose a bounded retry",
			},
			executionMode: "READ_ONLY",
			allowedPaths: ALLOWED,
			registeredCheckIds: CHECKS,
		});
		expect(investigation.statements.join(" ")).toContain("do not implement");
	});

	it("rejects unknown recipes, fields, blanks, types, overlong values and malformed shapes", () => {
		const attempt = (overrides: Record<string, unknown>) =>
			compileTaskRecipe({
				recipeId: "bugfix",
				executionMode: "EDIT",
				allowedPaths: ALLOWED,
				registeredCheckIds: CHECKS,
				inputs: inputs(overrides),
				...((overrides as { __top?: object }).__top ?? {}),
			} as never);
		expect(() => attempt({ __top: { recipeId: "nope" } })).toThrow(TaskRecipeError);
		expect(() => attempt({ __top: { inputs: "not-json" } })).toThrow(TaskRecipeError);
		expect(() => attempt({ __top: { inputs: ["array"] } })).toThrow(TaskRecipeError);
		expect(() => attempt({ unexpected: "field" })).toThrow(/unknown field/);
		expect(() => attempt({ reproduction: "   " })).toThrow(/must not be blank/);
		expect(() => attempt({ reproduction: 42 })).toThrow(/must be a string/);
		expect(() => attempt({ reproduction: "x".repeat(5000) })).toThrow(/exceeds/);
		expect(() => attempt({ reproduction: "bad\u0000value" })).toThrow(/control characters/);
		const missing = inputs();
		delete (missing as Record<string, unknown>).preserve;
		expect(() =>
			compileTaskRecipe({
				recipeId: "bugfix",
				inputs: missing,
				executionMode: "EDIT",
				allowedPaths: ALLOWED,
				registeredCheckIds: CHECKS,
			}),
		).toThrow(/missing required field preserve/);
	});

	it("refuses execution-mode, scope and check expansion", () => {
		const base = {
			inputs: inputs(),
			allowedPaths: ALLOWED,
			registeredCheckIds: CHECKS,
		};
		// bugfix is EDIT-only; READ_ONLY must be rejected rather than upgraded.
		expect(() => compileTaskRecipe({ ...base, recipeId: "bugfix", executionMode: "READ_ONLY" })).toThrow(
			/does not support execution mode READ_ONLY/,
		);
		// read-only-investigation must never run as EDIT.
		expect(() =>
			compileTaskRecipe({
				recipeId: "read-only-investigation",
				inputs: {
					observations: "a",
					possible_causes: "b",
					unknowns: "c",
					requested_recommendation: "d",
				},
				executionMode: "EDIT",
				allowedPaths: ALLOWED,
				registeredCheckIds: CHECKS,
			}),
		).toThrow(/does not support execution mode EDIT/);
		// The draft can never widen scope beyond the frozen allowed paths or invent checks.
		const draft = compileTaskRecipe({ ...base, recipeId: "bugfix", executionMode: "EDIT" });
		expect(draft.scopePaths.every((path) => ALLOWED.includes(path))).toBe(true);
		expect(draft.checkIds.every((id) => CHECKS.includes(id))).toBe(true);
		expect(() => compileTaskRecipe({ ...base, recipeId: "bugfix", executionMode: "EDIT", allowedPaths: [] })).toThrow(
			/no allowed path is configured/,
		);
		expect(() =>
			compileTaskRecipe({
				...base,
				recipeId: "bugfix",
				executionMode: "EDIT",
				allowedPaths: ["/etc"],
			}),
		).toThrow(/not a safe policy path/);
		expect(() =>
			compileTaskRecipe({ ...base, recipeId: "bugfix", executionMode: "EDIT", registeredCheckIds: [] }),
		).toThrow(/no registered required check/);
	});
});
