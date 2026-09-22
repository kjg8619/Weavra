import { type Static, Type } from "typebox";

export const PROJECT_FACT_LIMIT = 16;
const digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
export const ProjectFactSchema = Type.Object(
	{
		id: Type.String({ pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$" }),
		statement: Type.String({ minLength: 1, maxLength: 500 }),
		sourceRef: Type.String({ minLength: 1, maxLength: 256 }),
		sourceDigest: digest,
		/** Host-only generation binding; never a permission or model-visible receipt. */
		sourceGeneration: digest,
		reviewedAt: Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
	},
	{ additionalProperties: false },
);
export type ProjectFact = Static<typeof ProjectFactSchema>;
export interface ProjectFactSummary {
	id: string;
	statement: string | null;
	sourceRef: string;
	sourceDigest: string;
	reviewedAt: number;
	status: "VALID" | "STALE";
}
export interface ProjectFactsProjection {
	status: "available" | "unavailable";
	entries: ProjectFactSummary[];
}
