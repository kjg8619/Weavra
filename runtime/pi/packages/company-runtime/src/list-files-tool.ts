import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { LIST_MAX_ROOTS, listFiles } from "./list-files.ts";
import { isListablePath, type PolicyContext, type PolicyPathInspector } from "./policy.ts";

export function createListFilesTool(
	cwd: string,
	policy: PolicyContext,
	inspector: PolicyPathInspector,
	signal: AbortSignal,
	action: (
		tool: string,
		paths: string[],
		input: unknown,
		execute: () => Promise<string>,
	) => Promise<{ content: { type: "text"; text: string }[]; details: { actionId: string } }>,
): ToolDefinition {
	return defineTool({
		name: "runtime_list_files",
		label: "Runtime list files",
		executionMode: "sequential",
		description:
			"Discover allowed workspace file paths only. Start with runtime_list_files({}): OMIT path to use configured allowed roots. Never pass '.', '/', '..' or an empty path. Then use read/search/LSP for content. An explicit literal path only narrows allowed roots. maxDepth defaults to 4 (0..4 directory descents). Up to 500 files/64 KiB; entry/root/depth limits are explicitly marked truncated. No shell, symlink traversal or content. Protected paths and node_modules are hidden; generated dirs are not automatically ignored.",
		parameters: Type.Object(
			{
				path: Type.Optional(
					Type.String({
						minLength: 1,
						maxLength: 4096,
						description:
							"Omit for configured allowed roots (recommended first call). Not '.', '/', '..', an absolute path or a glob. Supply only one allowed relative file/directory to narrow discovery.",
					}),
				),
				maxDepth: Type.Optional(Type.Integer({ minimum: 0, maximum: 4 })),
			},
			{ additionalProperties: false },
		),
		execute: async (_id, input) => {
			const params = structuredClone(input);
			const roots =
				params.path === undefined
					? [...new Set(policy.allowedPaths.filter((path) => isListablePath(path, policy)))].sort()
					: [params.path];
			const selected = roots.slice(0, LIST_MAX_ROOTS);
			return action("runtime_list_files", selected, params, async () => {
				const result = await listFiles(cwd, selected, params.maxDepth ?? 4, policy, inspector, signal).catch(() => {
					signal.throwIfAborted();
					throw new Error("File listing unavailable or changed; no results returned");
				});
				if (roots.length > selected.length) {
					result.truncated = true;
					result.reason = "Root/entry/depth/file/byte budget may omit entries; remainder not counted";
				}
				return JSON.stringify(result);
			});
		},
	});
}
