import type { PolicyContext, PolicyPathInspector } from "./policy.ts";
import type { AgentExecutionRequest, AgentExecutionResult, AgentExecutor } from "./ports.ts";
import { buildTaskContextPack, type TaskContextMode, type TaskContextPack } from "./task-context.ts";

/**
 * Host-side decorator that attaches a freshly built Task Context Pack to each worker invocation.
 * It performs no provider call, no mutation, no verification and no workflow transition: it only
 * composes advisory context from the current filesystem, so every executor flavour (real Pi worker,
 * faux worker, eval adapter) goes through the same Host composition path.
 */
export interface TaskContextExecutorOptions {
	mode: TaskContextMode;
	cwd: string;
	policy: PolicyContext;
	paths: PolicyPathInspector;
	protectedPaths: readonly string[];
	verifierSources: readonly string[];
}

/** Host-derived seeds per role: Developer gets scope + prior review issues, Reviewer gets scope + evidence. */
export function taskContextSeeds(request: AgentExecutionRequest): string[] {
	const scope = request.task.acceptanceCriteria.flatMap((criterion) => criterion.scope.paths);
	const seeds = new Set<string>(scope.map((path) => path.trim()).filter((path) => path.length > 0));
	if (request.role === "Developer") {
		for (const issue of request.previousReview?.issues ?? [])
			if (typeof issue.file === "string" && issue.file.trim().length > 0) seeds.add(issue.file.trim());
	} else if (request.role === "Reviewer") {
		for (const path of request.handoff.changed_files) if (path.trim()) seeds.add(path.trim());
		for (const path of request.verification.changedFiles ?? []) if (path.trim()) seeds.add(path.trim());
	} else if (request.scope.targetPath) {
		seeds.add(request.scope.targetPath);
	}
	return [...seeds].sort();
}

export function taskContextTaskText(request: AgentExecutionRequest): string[] {
	return [request.task.goal, ...request.task.acceptanceCriteria.map((criterion) => criterion.statement)];
}

export async function buildRequestTaskContext(
	request: AgentExecutionRequest,
	options: TaskContextExecutorOptions,
): Promise<TaskContextPack | undefined> {
	if (options.mode !== "bounded") return undefined;
	return await buildTaskContextPack({
		cwd: options.cwd,
		mode: "bounded",
		seedPaths: taskContextSeeds(request),
		taskText: taskContextTaskText(request),
		paths: options.paths,
		policy: options.policy,
		protectedPaths: options.protectedPaths,
		verifierSources: options.verifierSources,
		...(options.policy.projectInstruction
			? {
					projectInstruction: {
						path: options.policy.projectInstruction.path,
						digest: options.policy.projectInstruction.digest,
						bytes: options.policy.projectInstruction.bytes,
					},
				}
			: {}),
		lsp: request.lsp
			? {
					symbols: request.lsp.symbols.bind(request.lsp),
					references: request.lsp.references.bind(request.lsp),
					cleanupFailed: request.lsp.cleanupFailed,
				}
			: undefined,
	});
}

/** Wraps an inner executor so every invocation carries its own fresh advisory pack. */
export function withTaskContext(inner: AgentExecutor, options: TaskContextExecutorOptions): AgentExecutor {
	return {
		get safeToRelease(): boolean | undefined {
			return inner.safeToRelease;
		},
		async execute(request: AgentExecutionRequest): Promise<AgentExecutionResult> {
			if (options.mode !== "bounded") return await inner.execute(request);
			const pack = await buildRequestTaskContext(request, options);
			return await inner.execute(pack ? { ...request, taskContextPack: pack } : request);
		},
	};
}
