import { Type } from "typebox";

const text = Type.String({ minLength: 1, maxLength: 262144 });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const coordinate = Type.Integer({ minimum: 1, maximum: 1_000_000 });
const strict = { additionalProperties: false } as const;

// Pure parameter declarations shared by the actual adapters and descriptive inventory.
// No worker, resource loader, LSP, model or credential initialization belongs here.
export const ACTION_TOOL_SCHEMAS = {
	runtime_read: Type.Object({ path, anchors: Type.Optional(Type.Boolean()) }, strict),
	runtime_search: Type.Object(
		{ paths: Type.Array(path, { minItems: 1, maxItems: 32, uniqueItems: true }), query: text },
		strict,
	),
	runtime_list_files: Type.Object(
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
		strict,
	),
	runtime_write: Type.Object(
		{
			path,
			content: Type.String({ maxLength: 262144 }),
			operation: Type.Optional(Type.Union([Type.Literal("create"), Type.Literal("replace")])),
			mustNotExist: Type.Optional(Type.Boolean()),
			readReceipt: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
			fileDigest: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		},
		strict,
	),
	runtime_edit: Type.Object(
		{
			path,
			oldText: text,
			newText: Type.String({ maxLength: 262144 }),
			anchor: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
			fileDigest: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
			readReceipt: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
		},
		strict,
	),
	runtime_delete: Type.Object({ path }, strict),
	runtime_lsp_diagnostics: Type.Object({ path }, strict),
	runtime_lsp_definition: Type.Object({ path, line: coordinate, column: coordinate }, strict),
	runtime_lsp_references: Type.Object({ path, line: coordinate, column: coordinate }, strict),
	runtime_lsp_symbols: Type.Object({ path }, strict),
} as const;
