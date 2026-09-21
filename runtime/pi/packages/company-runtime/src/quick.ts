import { type Classification, type QuickScope, QuickScopeSchema, type Run, validateContract } from "./contracts.ts";
import { isPolicyPath } from "./policy.ts";

export const QUICK_MAX_CHANGED_LINES = 100;

/** Conservative command scope, not an LLM plan or permission grant. */
export function selectQuickScope(goal: string, classification: Classification): QuickScope {
	if (
		classification.complexity !== "QUICK" ||
		!["R0", "R1"].includes(classification.risk) ||
		/architecture|refactor|multiple modules|large.scale|아키텍처|리팩터|리팩토|다수 모듈|대규모/i.test(goal)
	)
		throw new Error(
			"QUICK scope unsupported; STANDARD classification/review required (R2/R3 execution remains disabled)",
		);
	if (classification.risk === "R0") return { risk: "R0", targetPath: null };
	// Quoted paths preserve spaces/Unicode. Only unquoted sentence punctuation is a delimiter, not path data.
	const tokens = [...goal.matchAll(/`([^`\r\n]+)`|"([^"\r\n]+)"|'([^'\r\n]+)'|(\S+)/g)].map((match) => {
		const quoted = match[1] ?? match[2] ?? match[3];
		if (quoted !== undefined) return quoted;
		let token = match[4].replace(/[.,:;!?]$/, "");
		if (token.startsWith("(") && token.endsWith(")")) token = token.slice(1, -1);
		if (/\.[a-z0-9]+$/i.test(token) && /^[`'"]|[`",;]/.test(token))
			throw new Error("Ambiguous QUICK path quoting/list; quote one literal relative path");
		return token;
	});
	const candidates = [...new Set(tokens.filter((word) => /\.[a-z0-9]+$/i.test(word)))];
	if (candidates.length !== 1 || !isPolicyPath(candidates[0]))
		throw new Error(
			"QUICK R1 requires exactly one explicit relative file path in the goal; use STANDARD for broader work",
		);
	return { risk: "R1", targetPath: candidates[0] };
}

/** Conservative changed span: common prefix/suffix trimmed, remaining removed+added lines counted. */
export function changedLineCount(before: string, after: string): number {
	if (before === after) return 0;
	const left = before.split("\n");
	const right = after.split("\n");
	let start = 0;
	let endLeft = left.length;
	let endRight = right.length;
	while (start < endLeft && start < endRight && left[start] === right[start]) start++;
	while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
		endLeft--;
		endRight--;
	}
	return endLeft + endRight - 2 * start;
}

/** Reuses verifier-owned workspace evidence; no second digest/evidence system. */
export function assertQuickWorkspace(scope: QuickScope, workspace: NonNullable<Run["workspace"]>): void {
	validateContract(QuickScopeSchema, scope);
	if (
		!workspace.safe ||
		workspace.changedLines === undefined ||
		workspace.changedLines > QUICK_MAX_CHANGED_LINES ||
		(scope.risk === "R0"
			? scope.targetPath !== null || workspace.changedFiles.length !== 0
			: !scope.targetPath ||
				!isPolicyPath(scope.targetPath) ||
				workspace.changedFiles.length > 1 ||
				workspace.changedFiles.some((path) => path !== scope.targetPath))
	)
		throw new Error(
			"QUICK scope exceeded or evidence unavailable; inspect partial changes and rerun as STANDARD (no automatic switch)",
		);
}
