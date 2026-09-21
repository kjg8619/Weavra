import { type Static, Type } from "typebox";

const strict = { additionalProperties: false } as const;
const digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const path = Type.String({ minLength: 1, maxLength: 4096 });
const position = Type.Integer({ minimum: 1, maximum: 1_000_000 });
const range = { line: position, column: position, endLine: position, endColumn: position };
const ImpactSymbolSchema = Type.Object(
	{
		id: digest,
		path,
		name: Type.String({ maxLength: 256 }),
		kind: Type.Integer({ minimum: 1, maximum: 26 }),
		range: Type.Object(range, strict),
		selection: Type.Object({ line: position, column: position }, strict),
		sourceDigest: digest,
	},
	strict,
);
export type ImpactSymbol = Static<typeof ImpactSymbolSchema>;
const ImpactRelationSchema = Type.Object({ path, ...range, symbolId: digest, sourceDigest: digest }, strict);
export type ImpactRelation = Static<typeof ImpactRelationSchema>;
/** References are not a complete call graph or proof that a location is a call. */
export const ImpactReviewPackSchema = Type.Object(
	{
		version: Type.Literal(1),
		runId: Type.String({ minLength: 1, maxLength: 256 }),
		revision: Type.Integer({ minimum: 0 }),
		taskContractDigest: digest,
		diffDigest: Type.String({ minLength: 1, maxLength: 128 }),
		// Observation time only; excluded from the content digest.
		generatedAt: Type.Integer({ minimum: 0 }),
		changedFiles: Type.Array(path, { maxItems: 32, uniqueItems: true }),
		changedSymbols: Type.Array(ImpactSymbolSchema, { maxItems: 32 }),
		callers: Type.Array(ImpactRelationSchema, { maxItems: 64 }),
		declarations: Type.Array(ImpactRelationSchema, { maxItems: 64 }),
		relatedTests: Type.Array(
			Type.Object(
				{
					path,
					reason: Type.Enum(["lsp-reference", "same-stem", "same-directory", "c01-heuristic"]),
					sourceDigest: digest,
				},
				strict,
			),
			{ maxItems: 24 },
		),
		unknowns: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 32 }),
		truncated: Type.Boolean(),
		digest,
	},
	strict,
);
export type ImpactReviewPack = Static<typeof ImpactReviewPackSchema>;
