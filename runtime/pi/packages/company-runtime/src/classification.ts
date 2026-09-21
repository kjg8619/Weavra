import { type Classification, ClassificationSchema, type Role, validateContract, type Workflow } from "./contracts.ts";

export interface ClassificationResult {
	classification: Classification;
	requiresConfirmation: boolean;
}

export type ClassificationHints = Partial<Pick<Classification, "intent" | "complexity" | "risk">>;

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

/** Heuristics for routing, not an action permission check. Unknown goals require host confirmation. */
export function classifyRequest(goal: string, hints: ClassificationHints = {}): ClassificationResult {
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
	let risk: Classification["risk"] = ["question", "analysis", "research", "architecture"].includes(intent)
		? "R0"
		: "R1";
	if (!matched && !hints.intent) risk = "R1";
	if (/dependency|dependencies|package structure|의존성|프로젝트 구조|대규모/i.test(goal)) risk = "R2";
	if (
		/delet|remove file|deploy|production|credential|git\s+(reset|rebase)|force.push|rm\s+-|삭제|배포|프로덕션|자격.?증명|히스토리 변경/i.test(
			goal,
		)
	)
		risk = "R3";
	const detectedRisk = risk;
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
			reason: `Routing heuristic: ${matched?.intent ?? "unrecognized goal"}; detected risk ${detectedRisk}; explicit hints ${Object.keys(hints).join(", ") || "none"}`,
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
