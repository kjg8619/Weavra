import { taskRecipeById } from "./task-recipes.ts";

/**
 * Explicit recipe selection for the run command (V0.5B, B3). Pure Host-side parsing: it never invokes a
 * provider, never loads a skill and never grants anything. `/workflow run <goal>` keeps working unchanged.
 */
export interface WorkflowRunArgument {
	goal: string;
	recipeId?: string;
}

export class WorkflowRunArgumentError extends Error {
	constructor(reason: string) {
		super(`Invalid run argument: ${reason}`);
		this.name = "WorkflowRunArgumentError";
	}
}

/**
 * Fixed syntax: leading `--recipe <id>` followed by the goal. Only leading flags are parsed, so a goal that
 * merely contains the text "--recipe" stays a goal; any other leading flag is rejected instead of guessed.
 */
export function parseWorkflowRunArgument(argument: string): WorkflowRunArgument {
	const tokens = argument
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 0);
	let recipeId: string | undefined;
	let index = 0;
	while (index < tokens.length && tokens[index].startsWith("--")) {
		const token = tokens[index];
		if (token !== "--recipe") throw new WorkflowRunArgumentError(`unknown flag ${token}`);
		if (recipeId !== undefined) throw new WorkflowRunArgumentError("duplicate --recipe");
		const value = tokens[index + 1];
		if (value === undefined || value.startsWith("--"))
			throw new WorkflowRunArgumentError("--recipe requires a recipe id");
		if (value.includes("=")) throw new WorkflowRunArgumentError("use --recipe <id> without =");
		recipeId = value;
		index += 2;
	}
	const goal = tokens.slice(index).join(" ").trim();
	if (!goal) throw new WorkflowRunArgumentError("a goal is required");
	if (recipeId !== undefined) {
		if (!taskRecipeById(recipeId)) throw new WorkflowRunArgumentError(`unknown recipe ${recipeId}`);
		return { goal, recipeId };
	}
	return { goal };
}
