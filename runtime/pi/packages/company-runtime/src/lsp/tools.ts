import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ACTION_TOOL_SCHEMAS } from "../action-tool-schemas.ts";
import type { LspPort } from "./types.ts";

export function createLspTools(
	port: LspPort,
	action: (
		tool: string,
		paths: string[],
		input: unknown,
		execute: () => Promise<string>,
	) => Promise<{ content: { type: "text"; text: string }[]; details: { actionId: string } }>,
	signal: AbortSignal,
): ToolDefinition[] {
	return [
		defineTool({
			name: "runtime_lsp_diagnostics",
			label: "LSP diagnostics",
			executionMode: "sequential",
			description:
				"Read advisory diagnostics for one allowed file. AVAILABLE means query answered, not PASS. Push snapshots are PARTIAL. If STALE, re-query; never guess. Does not replace required process checks.",
			parameters: ACTION_TOOL_SCHEMAS.runtime_lsp_diagnostics,
			execute: async (_id, input) => {
				const params = structuredClone(input);
				return action("runtime_lsp_diagnostics", [params.path], params, async () =>
					JSON.stringify(await port.diagnostics({ ...params, signal })),
				);
			},
		}),
		defineTool({
			name: "runtime_lsp_definition",
			label: "LSP definition",
			executionMode: "sequential",
			description:
				"Read definition locations. line and column are 1-based; column counts UTF-16 code units. Unsafe/out-of-policy results are withheld. STALE requires a new query. No mutation.",
			parameters: ACTION_TOOL_SCHEMAS.runtime_lsp_definition,
			execute: async (_id, input) => {
				const params = structuredClone(input);
				return action("runtime_lsp_definition", [params.path], params, async () =>
					JSON.stringify(await port.definition({ ...params, signal })),
				);
			},
		}),
		defineTool({
			name: "runtime_lsp_references",
			label: "LSP references",
			executionMode: "sequential",
			description:
				"Read references including the declaration. line/column are 1-based UTF-16 positions. Unsafe/out-of-policy results are withheld. STALE requires a new query. No mutation.",
			parameters: ACTION_TOOL_SCHEMAS.runtime_lsp_references,
			execute: async (_id, input) => {
				const params = structuredClone(input);
				return action("runtime_lsp_references", [params.path], params, async () =>
					JSON.stringify(await port.references({ ...params, signal })),
				);
			},
		}),
		defineTool({
			name: "runtime_lsp_symbols",
			label: "LSP document symbols",
			executionMode: "sequential",
			description:
				"Read symbols for one explicit allowed document only. No workspace-wide symbol search, rename or edits. Positions are 1-based UTF-16. STALE requires a new query.",
			parameters: ACTION_TOOL_SCHEMAS.runtime_lsp_symbols,
			execute: async (_id, input) => {
				const params = structuredClone(input);
				return action("runtime_lsp_symbols", [params.path], params, async () =>
					JSON.stringify(await port.symbols({ ...params, signal })),
				);
			},
		}),
	];
}
