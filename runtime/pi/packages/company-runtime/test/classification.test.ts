import { describe, expect, it } from "vitest";
import { classifyRequest, selectWorkflow } from "../src/classification.ts";
import type { Classification } from "../src/contracts.ts";

describe("host-independent classification", () => {
	it.each([
		["Explain this function", "question", "QUICK", "R0"],
		["Analyze the code", "analysis", "STANDARD", "R0"],
		["로그인 500 오류를 수정해줘", "bugfix", "STANDARD", "R1"],
		["Implement pagination", "implementation", "STANDARD", "R1"],
		["Refactor the parser", "refactor", "STANDARD", "R1"],
		["Compare parser options", "research", "STANDARD", "R0"],
		["Design the system architecture", "architecture", "COMPLEX", "R0"],
		["Brainstorm feature ideas", "creative", "STANDARD", "R1"],
		["Fix a typo", "maintenance", "QUICK", "R1"],
		["Upgrade dependencies", "maintenance", "STANDARD", "R2"],
		["배포하고 production 데이터를 삭제", "analysis", "STANDARD", "R3"],
	])("classifies %s with traceable, non-probabilistic rules", (goal, intent, complexity, risk) => {
		const result = classifyRequest(goal);
		expect(result.classification).toMatchObject({ intent, complexity, risk, confidence: null });
		expect(result.classification.reason).toContain("Routing heuristic");
	});

	it("requires confirmation for unknown intent rather than inventing confidence", () => {
		expect(classifyRequest("please handle this")).toMatchObject({
			requiresConfirmation: true,
			classification: { risk: "R1", confidence: null },
		});
		expect(
			classifyRequest("please handle this", { intent: "bugfix", complexity: "STANDARD" }).requiresConfirmation,
		).toBe(false);
		expect(() => classifyRequest(" ")).toThrow();
	});

	it("allows explicit routing but never lowers a detected risk", () => {
		expect(classifyRequest("Deploy to production", { intent: "maintenance", risk: "R0" }).classification.risk).toBe(
			"R3",
		);
		expect(classifyRequest("Fix a typo", { risk: "R2" }).classification.risk).toBe("R2");
	});

	it.each(["R2", "R3"] as const)("forces Reviewer for %s even when QUICK is requested", (risk) => {
		const classification = classifyRequest("Fix a typo", { risk }).classification;
		expect(classification.complexity).toBe("QUICK");
		expect(selectWorkflow(classification, "QUICK")).toEqual({
			workflow: "STANDARD",
			roles: ["Developer", "Reviewer"],
		});
	});

	it("selects only the required roles without constructing an agent", () => {
		const classification: Classification = classifyRequest("Fix a typo").classification;
		expect(selectWorkflow(classification)).toEqual({ workflow: "QUICK", roles: ["Executor"] });
		expect(selectWorkflow(classification, "STANDARD").roles).toEqual(["Developer", "Reviewer"]);
		expect(selectWorkflow(classification, "COMPLEX").roles).toEqual(["Lead", "Developer", "Reviewer"]);
	});
});
