import { taskRecipeById } from "./task-recipes.ts";

/**
 * Explicit run-command selections: a reviewed recipe (V0.5B, B3) and the `deep` model intent (#5). Pure Host-side
 * parsing: it never invokes a provider, never loads a skill and never grants anything. `/workflow run <goal>` keeps
 * working unchanged.
 */
export interface WorkflowRunArgument {
	goal: string;
	recipeId?: string;
	/** Explicit per-run choice: this run's Developers use `models.intents.deep`. Never implied by goal text. */
	deep?: true;
}

export class WorkflowRunArgumentError extends Error {
	constructor(reason: string) {
		super(`Invalid run argument: ${reason}`);
		this.name = "WorkflowRunArgumentError";
	}
}

/**
 * Fixed syntax: leading `--recipe <id>` and/or `--deep` followed by the goal. Only leading flags are parsed, so a goal
 * that merely contains the text "--recipe" or "--deep" stays a goal; any other leading flag is rejected, not guessed.
 */
export function parseWorkflowRunArgument(argument: string): WorkflowRunArgument {
	const tokens = argument
		.trim()
		.split(/\s+/)
		.filter((token) => token.length > 0);
	let recipeId: string | undefined;
	let deep = false;
	let index = 0;
	while (index < tokens.length && tokens[index].startsWith("--")) {
		const token = tokens[index];
		if (token === "--deep") {
			if (deep) throw new WorkflowRunArgumentError("duplicate --deep");
			deep = true;
			index += 1;
			continue;
		}
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
	if (recipeId !== undefined && !taskRecipeById(recipeId))
		throw new WorkflowRunArgumentError(`unknown recipe ${recipeId}`);
	return { goal, ...(recipeId !== undefined ? { recipeId } : {}), ...(deep ? { deep: true as const } : {}) };
}
