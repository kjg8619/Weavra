import { type Static, Type } from "typebox";
import { DocumentationPackSchema } from "./documentation-pack-types.ts";
import { ImpactReviewPackSchema } from "./impact-review-types.ts";

const digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
/** Host-composed advisory data; never a Task Contract, receipt, check, approval or permission. */
export const ReviewerContextSchema = Type.Object(
	{
		version: Type.Literal(1),
		runId: Type.String({ minLength: 1, maxLength: 256 }),
		revision: Type.Integer({ minimum: 0 }),
		taskContractDigest: digest,
		diffDigest: Type.String({ minLength: 1, maxLength: 128 }),
		generatedAt: Type.Integer({ minimum: 0 }),
		taskContextDigest: Type.Union([digest, Type.Null()]),
		impact: Type.Optional(ImpactReviewPackSchema),
		documentation: Type.Optional(DocumentationPackSchema),
		digest,
	},
	{ additionalProperties: false },
);
export type ReviewerContext = Static<typeof ReviewerContextSchema>;
