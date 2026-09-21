import { type Static, Type } from "typebox";

export const ExecutionModeSchema = Type.Enum(["READ_ONLY", "EDIT"]);
export type ExecutionMode = Static<typeof ExecutionModeSchema>;
export interface ExecutionContract {
	readonly runId: string;
	readonly mode: ExecutionMode;
}
export function isExecutionMode(value: unknown): value is ExecutionMode {
	return value === "READ_ONLY" || value === "EDIT";
}

/** A trusted Host grant, not an LLM field, risk label, or inferred permission. */
export function bindExecutionContract(runId: string, mode: ExecutionMode): ExecutionContract {
	if (!runId.trim() || !isExecutionMode(mode)) throw new Error("Explicit execution contract is required");
	return Object.freeze({ runId, mode });
}
export function assertExecutionContract(contract: ExecutionContract | undefined, runId: string, mode: unknown): void {
	if (!contract || !isExecutionMode(mode) || contract.runId !== runId || contract.mode !== mode)
		throw new Error("Execution contract binding mismatch or missing contract");
}

export interface ExecutionProposal {
	mode?: ExecutionMode;
	requiresConfirmation: boolean;
	reason: string;
}
/** Conservative UI proposal only. EDIT requires explicit trusted Host confirmation; unknown is never EDIT. */
export function proposeExecutionMode(goal: string): ExecutionProposal {
	const unknown: ExecutionProposal = {
		requiresConfirmation: true,
		reason: "Ambiguous execution request; clarify READ_ONLY or EDIT in a new run",
	};
	if (!goal.trim() || goal.length > 16384 || /[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(goal))
		return unknown;
	// Quoted code/words/paths are data. Apostrophes inside English words (don't) are not quote delimiters.
	let text = goal.replace(/`[^`\r\n]*`|"[^"\r\n]*"|(?<![\p{L}\p{N}])'[^'\r\n]*'(?![\p{L}\p{N}])/gu, " ");
	if (/[`"]/.test(text) || /(?:^|\s)'/.test(text)) return unknown;
	text = text.replace(/\b(?:fix|implement|add|change|edit|update|refactor|delete|remove)(?:이?라는)\s*단어/gi, " ");
	const blanket =
		/\b(?:do not|don't|never)\s+(?:modify|edit|change|write|delete|remove)\s+(?:any(?:thing|\s+files)?|files|workspace)\b|\bwithout\s+(?:changing|editing|modifying|writing|deleting|removing)\s+(?:any\s+)?(?:files|anything|workspace)\b|(?:수정|삭제|변경)하지\s*(?:말고|마|말아)|변경\s*없이|읽기\s*전용/i.test(
			text,
		);
	text = text.replace(
		/\b(?:do not|don't|never)\s+(?:fix|implement|add|change|edit|update|refactor|modify|write|delete|remove)\b|\bwithout\s+(?:changing|editing|modifying|writing|deleting|removing)\b|(?:수정|변경|삭제|추가|구현)하지\s*(?:말고|마(?:세요)?|말아(?:줘)?)/gi,
		" ",
	);
	const edit =
		/(?:^|[,;.!?]\s*|\b(?:and|then|also|but)\s+)(?:please\s+)?(?:fix|implement|add|change|edit|update|refactor|create|write|correct|delete|remove)\b|(?:수정|구현|추가|변경|삭제)(?:해|하)|고쳐|고치(?:고|라|기)|^파일\s+삭제\s/i.test(
			text.trim(),
		);
	const read =
		/(?:^|[,;.!?]\s*|\b(?:and|then|also|but)\s+)(?:please\s+)?(?:explain|analy[sz]e|inspect|review|describe|what|why|how|tell me|show me|investigate)\b|설명|분석|검토|알려|읽기\s*전용/i.test(
			text.trim(),
		);
	if (edit && (read || blanket)) return unknown;
	if (read && !edit)
		return {
			mode: "READ_ONLY",
			requiresConfirmation: false,
			reason: "Read-only request candidate; no mutation permission",
		};
	if (edit)
		return {
			mode: "EDIT",
			requiresConfirmation: false,
			reason: "Explicit mutation request candidate; Host consent is still required",
		};
	return unknown;
}
export function executionGuidance(mode: ExecutionMode): string {
	return mode === "READ_ONLY"
		? "Execution contract: READ_ONLY. You may inspect and analyze but must not modify workspace files. Mutation tools are intentionally unavailable."
		: "Execution contract: EDIT. Only Policy-allowed mutations are permitted; role restrictions still apply and Reviewer is always read-only. R2 review and R3 human approval remain mandatory where required.";
}
