import { type Static, Type } from "typebox";

const text = Type.String({ minLength: 1, pattern: "\\S" });
const counter = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const strict = { additionalProperties: false } as const;

/**
 * Host-captured provenance snapshot for one run. Unknown values stay null and render as UNKNOWN;
 * mtime is never presented as a commit, and no credential, prompt or environment value is stored.
 */
export const ProvenanceSchema = Type.Object(
	{
		// Absent member = UNKNOWN; explicit nulls are avoided so TypeBox inference stays shallow.
		runtimeSource: Type.Optional(Type.Object({ path: text, commit: Type.Optional(text) }, strict)),
		cliBundle: Type.Optional(
			Type.Object(
				{ path: text, sha256: text, bytes: counter, mtimeMs: counter, version: Type.Optional(text) },
				strict,
			),
		),
		targetWorkspaceCommit: Type.Optional(text),
		configDigest: Type.Optional(text),
		taskContractDigest: Type.Optional(text),
		// Reviewed recipe that drafted the acceptance criteria; not proof that the frozen AC still match it.
		recipe: Type.Optional(
			Type.Object(
				{
					id: text,
					version: Type.Integer({ minimum: 1 }),
					digest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
				},
				strict,
			),
		),
		capturedAt: counter,
	},
	strict,
);
export type Provenance = Static<typeof ProvenanceSchema>;

export const BudgetStatusSchema = Type.Object(
	{
		configured: Type.Boolean(),
		maxWorkerInvocations: Type.Optional(counter),
		maxReportedTokens: Type.Optional(counter),
		workerInvocations: counter,
		reportedTokens: Type.Union([counter, Type.Null()]),
		exceeded: Type.Boolean(),
		reason: Type.Union([text, Type.Null()]),
	},
	strict,
);
export type BudgetStatusRecord = Static<typeof BudgetStatusSchema>;
