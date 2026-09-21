import { describe, expect, it } from "vitest";
import { parseWorkflowRunArgument, WorkflowRunArgumentError } from "../src/task-recipe-command.ts";

describe("V0.5B workflow run argument parsing", () => {
	it("keeps the manual path unchanged when no recipe flag is present", () => {
		expect(parseWorkflowRunArgument("Fix the greeting typo")).toEqual({ goal: "Fix the greeting typo" });
		expect(parseWorkflowRunArgument("  Fix   the  greeting typo  ")).toEqual({ goal: "Fix the greeting typo" });
		// A goal that merely mentions the flag text is not treated as a recipe selection.
		expect(parseWorkflowRunArgument("Explain what --recipe means")).toEqual({ goal: "Explain what --recipe means" });
	});

	it("resolves reviewed recipe ids explicitly", () => {
		expect(parseWorkflowRunArgument("--recipe bugfix Fix the typo")).toEqual({
			goal: "Fix the typo",
			recipeId: "bugfix",
		});
		expect(parseWorkflowRunArgument("--recipe read-only-investigation Explain the retry loop")).toEqual({
			goal: "Explain the retry loop",
			recipeId: "read-only-investigation",
		});
	});

	it("rejects malformed selections instead of guessing", () => {
		const cases = [
			"",
			"   ",
			"--recipe",
			"--recipe bugfix",
			"--recipe --recipe bugfix goal",
			"--recipe=bugfix goal",
			"--unknown goal",
			"--recipe nope goal",
		];
		for (const argument of cases) expect(() => parseWorkflowRunArgument(argument)).toThrow(WorkflowRunArgumentError);
	});
});
