import { type Static, Type } from "typebox";

/** Durable metadata only. Never put the selected file's content into Run/Policy state. */
export const ProjectInstructionMetadataSchema = Type.Object(
	{
		path: Type.String({ minLength: 1, maxLength: 4096 }),
		digest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
		bytes: Type.Integer({ minimum: 0, maximum: 65536 }),
	},
	{ additionalProperties: false },
);
export type ProjectInstructionMetadata = Static<typeof ProjectInstructionMetadataSchema>;
export interface ProjectInstructionSnapshot extends Readonly<ProjectInstructionMetadata> {
	readonly content: string;
}
