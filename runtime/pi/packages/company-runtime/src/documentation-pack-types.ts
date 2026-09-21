import { type Static, Type } from "typebox";

const strict = { additionalProperties: false } as const;
const identifier = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9@][A-Za-z0-9@._/-]*$" });
const timestamp = Type.String({ maxLength: 32, pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$" });
const digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const metadata = {
	id: identifier,
	source: Type.Object(
		{
			kind: Type.Literal("reviewed-local"),
			reference: Type.String({ minLength: 1, maxLength: 512, pattern: "^[^\\s\\x00-\\x1f]+$" }),
		},
		strict,
	),
	component: identifier,
	version: Type.String({ minLength: 1, maxLength: 128 }),
	capturedAt: timestamp,
	digest,
	reviewStatus: Type.Enum(["REVIEWED", "STALE", "UNREVIEWED"]),
	validUntil: Type.Optional(timestamp),
};
export const DocumentationEntrySchema = Type.Object({ ...metadata, content: Type.String({ maxLength: 8192 }) }, strict);
export type DocumentationEntry = Static<typeof DocumentationEntrySchema>;
export const DocumentationConfigSchema = Type.Object(
	{
		mode: Type.Enum(["disabled", "bounded"]),
		manifest: Type.String({ minLength: 1, maxLength: 4096 }),
		requested: Type.Array(identifier, { maxItems: 16, uniqueItems: true }),
		entries: Type.Array(DocumentationEntrySchema, { maxItems: 16 }),
	},
	strict,
);
export type DocumentationConfig = Static<typeof DocumentationConfigSchema>;
const DocumentationMatchSchema = Type.Object(
	{
		entry: Type.Object(metadata, strict),
		status: Type.Enum(["MATCHED", "VERSION_MISMATCH", "STALE", "UNAVAILABLE", "UNKNOWN"]),
		declaredVersion: Type.Union([Type.String({ maxLength: 128 }), Type.Null()]),
		manifestDigest: Type.Union([digest, Type.Null()]),
		/** Present only for MATCHED reviewed bytes. Still data, never instructions or authority. */
		content: Type.Optional(Type.String({ maxLength: 8192 })),
	},
	strict,
);
export type DocumentationMatch = Static<typeof DocumentationMatchSchema>;
export type DocumentationStatus = DocumentationMatch["status"];
export const DocumentationPackSchema = Type.Object(
	{
		version: Type.Literal(1),
		requested: Type.Array(identifier, { maxItems: 16, uniqueItems: true }),
		entries: Type.Array(DocumentationMatchSchema, { maxItems: 16 }),
		unmatched: Type.Array(identifier, { maxItems: 16, uniqueItems: true }),
		stale: Type.Array(identifier, { maxItems: 16, uniqueItems: true }),
		/** Exact declarations, not installed/resolved versions or latest upstream docs. */
		versionSource: Type.Literal("npm-package-json-declaration"),
		truncated: Type.Boolean(),
		digest,
	},
	strict,
);
export type DocumentationPack = Static<typeof DocumentationPackSchema>;
