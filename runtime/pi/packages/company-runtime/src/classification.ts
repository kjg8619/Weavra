import { isR3DeletionGrammar } from "./approval.ts";
import {
	type Classification,
	ClassificationSchema,
	type Risk,
	type Role,
	validateContract,
	type Workflow,
} from "./contracts.ts";

export interface ClassificationResult {
	classification: Classification;
	requiresConfirmation: boolean;
}

export type ClassificationHints = Partial<Pick<Classification, "intent" | "complexity" | "risk">>;

/** Host-confirmed return of keyword-only R3 to the rule-based risk. Not an approval, permission or tool grant. */
export interface RiskOverride {
	from: "R3";
	to: Risk;
}

const intentRules: Array<{ intent: Classification["intent"]; pattern: RegExp }> = [
	{ intent: "bugfix", pattern: /bug|fix.*error|regression|오류|버그|고장/i },
	{ intent: "refactor", pattern: /refactor|리팩터|리팩토/i },
	{ intent: "architecture", pattern: /architecture|system design|아키텍처|시스템 설계/i },
	{ intent: "research", pattern: /research|compare|investigate options|조사|비교/i },
	{ intent: "creative", pattern: /brainstorm|creative|ideat|아이디어|창작/i },
	{
		intent: "maintenance",
		pattern:
			/^(?:(?:delete|remove) file|파일 삭제) |typo|maintenance|dependency|dependencies|upgrade|small (?:change|setting)|simple (?:change|setting)|오타|유지보수|의존성|업데이트|작은 (?:변경|설정|수정)|한 파일/i,
	},
	{ intent: "implementation", pattern: /implement|add|build|구현|추가|만들/i },
	{ intent: "analysis", pattern: /analy[sz]|inspect|분석|검토/i },
	{ intent: "question", pattern: /what|why|how|explain|설명|무엇|왜|어떻게|알려줘|알려주세요|\?$/i },
];
const risks = ["R0", "R1", "R2", "R3"] as const;
/**
 * Deletion is R3 only when it targets files, directories, branches or stored data: optional determiners, at most
 * one other modifier ("log files", "dependency files"), then the target noun; a slash path is also a file target.
 * "Fix the delete button" or "soft delete for records" stay ordinary. Deploy/production/credential/history stay broad.
 */
const r3Rules = [
	/\b(?:delet(?:e|es|ing)|remov(?:e|es|ing)|rm)\s+(?:(?:the|this|that|these|those|all|any|old|unused|stale|obsolete|temp|temporary)\s+)*(?:(?:(?!(?:for|in|on|of|from|to|with|by|at|as|into|onto|and|or|but|if|when|that|which)\b)[\w-]+\s+)?(?:files?|director(?:y|ies)|folders?|branch(?:es)?|data|databases?|tables?|records?)(?![\w-])|\S*\/)/i,
	/\brm\s+-/i,
	/(?:파일|폴더|디렉터리|디렉토리|브랜치|데이터|레코드|테이블)(?:들)?(?:을|를)?\s*(?:삭제|지워|지우)|\S*\/\S*\s*(?:삭제|지워|지우)/,
	/deploy|production|credential|git\s+(reset|rebase)|force.push|배포|프로덕션|자격.?증명|히스토리 변경/i,
];

interface Routing {
	matched: (typeof intentRules)[number] | undefined;
	intent: Classification["intent"];
	complexity: Classification["complexity"];
	/** Rule-based risk before the R3 keyword check. */
	baseRisk: Exclude<Risk, "R3">;
	detectedRisk: Risk;
}

function route(goal: string, hints: ClassificationHints): Routing {
	if (!goal.trim()) throw new Error("A non-empty goal is required");
	const matched = intentRules.find((rule) => rule.pattern.test(goal));
	const intent = hints.intent ?? matched?.intent ?? "analysis";
	const complexity =
		hints.complexity ??
		(intent === "architecture" ||
		/architecture|system design|large.scale|multiple modules|아키텍처|시스템 설계|대규모|다수 모듈/i.test(goal)
			? "COMPLEX"
			: intent === "question" ||
					/typo|오타|small (?:change|setting)|simple (?:change|setting)|(?:single|one) file|작은 (?:변경|설정|수정)|한 파일/i.test(
						goal,
					)
				? "QUICK"
				: "STANDARD");
	let baseRisk: Exclude<Risk, "R3"> = ["question", "analysis", "research", "architecture"].includes(intent)
		? "R0"
		: "R1";
	if (!matched && !hints.intent) baseRisk = "R1";
	if (/dependency|dependencies|package structure|의존성|프로젝트 구조|대규모/i.test(goal)) baseRisk = "R2";
	const detectedRisk = r3Rules.some((rule) => rule.test(goal)) ? "R3" : baseRisk;
	return { matched, intent, complexity, baseRisk, detectedRisk };
}

/**
 * Host UI offer only: a keyword-only R3 goal (never the exact deletion grammar) that could run at its
 * rule-based risk after explicit user confirmation. Unknown-intent or COMPLEX goals get no offer.
 */
export function r3OverrideCandidate(goal: string): RiskOverride | undefined {
	if (!goal.trim() || isR3DeletionGrammar(goal)) return undefined;
	const { matched, complexity, baseRisk, detectedRisk } = route(goal, {});
	if (detectedRisk !== "R3" || !matched || complexity === "COMPLEX") return undefined;
	return { from: "R3", to: baseRisk };
}

/** Heuristics for routing, not an action permission check. Unknown goals require host confirmation. */
export function classifyRequest(
	goal: string,
	hints: ClassificationHints = {},
	riskOverride?: RiskOverride,
): ClassificationResult {
	const { matched, intent, complexity, baseRisk, detectedRisk } = route(goal, hints);
	let risk: Classification["risk"] = detectedRisk;
	if (riskOverride) {
		// Fail closed: a stale or forged override is an error, never silently applied or ignored.
		const rejection =
			riskOverride.from !== "R3" || detectedRisk !== "R3"
				? "only a goal detected as R3 can be overridden"
				: isR3DeletionGrammar(goal)
					? "the exact deletion grammar always keeps R3"
					: riskOverride.to !== baseRisk
						? `the override must return to the rule-based risk ${baseRisk}`
						: undefined;
		if (rejection)
			throw new Error(
				`Risk override ${String(riskOverride.from)}→${String(riskOverride.to)} rejected: ${rejection}; no downgrade performed`,
			);
		risk = baseRisk;
	}
	if (hints.risk && risks.indexOf(hints.risk) > risks.indexOf(risk)) risk = hints.risk;
	// Validate explicit hints too, including an unknown risk that must not silently disappear.
	validateContract(ClassificationSchema, {
		intent,
		complexity,
		risk: hints.risk ?? risk,
		confidence: null,
		reason: "Input hints",
	});
	return {
		classification: {
			intent,
			complexity,
			risk,
			confidence: null,
			reason: `Routing heuristic: ${matched?.intent ?? "unrecognized goal"}; detected risk ${detectedRisk}; explicit hints ${Object.keys(hints).join(", ") || "none"}${riskOverride ? `; user-confirmed risk override R3→${baseRisk} (no delete/shell/deploy tools)` : ""}`,
		},
		requiresConfirmation: !matched && !hints.intent,
	};
}

export interface WorkflowSelection {
	workflow: Workflow;
	roles: Role[];
}

/** R2/R3 cannot select a reviewer-free QUICK organization, even with an explicit override. */
export function selectWorkflow(
	classification: Classification,
	requested: Workflow | "adaptive" = "adaptive",
): WorkflowSelection {
	validateContract(ClassificationSchema, classification);
	let workflow = requested === "adaptive" ? classification.complexity : requested;
	if (workflow === "QUICK" && (classification.risk === "R2" || classification.risk === "R3")) workflow = "STANDARD";
	switch (workflow) {
		case "QUICK":
			return { workflow, roles: ["Executor"] };
		case "STANDARD":
			return { workflow, roles: ["Developer", "Reviewer"] };
		case "COMPLEX":
			return { workflow, roles: ["Lead", "Developer", "Reviewer"] };
		default:
			throw new Error("Unknown workflow");
	}
}
