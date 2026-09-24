import { describe, expect, it } from "vitest";
import { isR3DeletionGrammar, isSupportedR3Goal, selectR3Scope } from "../src/approval.ts";
import { classifyRequest, type RiskOverride, r3OverrideCandidate, selectWorkflow } from "../src/classification.ts";
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

describe("R3 deletion keyword precision", () => {
	it.each([
		["Fix the delete button bug", "R1"],
		["Implement soft delete for users", "R1"],
		["Implement soft delete for records", "R1"],
		["Fix delete endpoint returning stale records", "R1"],
		["Delete typo in src/app.ts", "R1"],
		["Explain how the delete endpoint works", "R0"],
		["Remove unused import in src/a.ts", "R1"],
		["Remove the data-testid attribute from src/a.tsx and add a label", "R1"],
		["Do not delete anything; explain the delete flow", "R0"],
		["삭제하지 말고 삭제 로직을 설명해줘", "R0"],
		["삭제 버튼 버그를 수정해줘", "R1"],
	])("does not treat a non-target deletion word as R3: %s", (goal, risk) => {
		expect(classifyRequest(goal).classification.risk).toBe(risk);
	});

	it.each([
		"Delete the old files",
		"Remove unused directories and add a note",
		"Deleting stale records in the cleanup script",
		"Remove all branches",
		"Drop and delete database tables",
		"Delete dependency files",
		"Remove all old log files",
		"Delete the stale feature branches",
		"rm -rf build",
		"rm old files",
		"Fix typo in src/app.ts and delete src/obsolete.ts",
		"파일 삭제 a.txt",
		"오래된 브랜치를 삭제",
		"임시 파일들을 지워줘",
		"src/old.ts를 삭제해줘",
		"Deploy to production",
		"Rotate the credential file",
		"git reset the branch",
		"배포 스크립트 수정",
	])("keeps deletion targets and non-deletion R3 keywords at R3: %s", (goal) => {
		expect(classifyRequest(goal).classification.risk).toBe("R3");
	});

	it.each(["Delete file src/obsolete.ts", "Remove file src/obsolete.ts", "파일 삭제 src/obsolete.ts"])(
		"keeps the exact supported grammar at R3 with a scope: %s",
		(goal) => {
			expect(classifyRequest(goal).classification.risk).toBe("R3");
			expect(isSupportedR3Goal(goal)).toBe(true);
			expect(selectR3Scope(goal, "run")).toEqual({ runId: "run", targetPath: "src/obsolete.ts" });
		},
	);

	it("separates the grammar shape from a supported Policy path", () => {
		expect(isR3DeletionGrammar("Delete file ../outside.ts")).toBe(true);
		expect(isSupportedR3Goal("Delete file ../outside.ts")).toBe(false);
		expect(isR3DeletionGrammar("Delete the old files")).toBe(false);
		expect(isSupportedR3Goal("Delete the old files")).toBe(false);
	});
});

describe("user-confirmed R3 risk override", () => {
	it.each([
		["Explain how production deploy works", "R0", "QUICK"],
		["Fix production build warning in src/a.ts", "R1", "STANDARD"],
		["Upgrade dependencies used by the deploy script", "R2", "STANDARD"],
		["Delete the old files and add a changelog entry", "R1", "STANDARD"],
	] as const)("returns keyword-only R3 exactly to its rule-based risk: %s", (goal, baseRisk, complexity) => {
		expect(classifyRequest(goal).classification.risk).toBe("R3");
		const override = r3OverrideCandidate(goal);
		expect(override).toEqual({ from: "R3", to: baseRisk });
		const { classification } = classifyRequest(goal, {}, override);
		expect(classification).toMatchObject({ risk: baseRisk, complexity });
		expect(classification.reason).toContain("detected risk R3");
		expect(classification.reason).toContain(`user-confirmed risk override R3→${baseRisk}`);
	});

	it.each([
		["Delete file src/obsolete.ts", "exact deletion grammar"],
		["Delete file ../outside.ts", "exact deletion grammar"],
		["Fix bug in src/a.ts", "not R3"],
		["Deploy to production", "unknown intent"],
		["Design the production system architecture", "COMPLEX"],
	])("offers no override for %s (%s)", (goal) => {
		expect(r3OverrideCandidate(goal)).toBeUndefined();
	});

	it.each([
		["Delete file src/obsolete.ts", "R1", "exact deletion grammar always keeps R3"],
		["Delete file ../outside.ts", "R1", "exact deletion grammar always keeps R3"],
		["Fix bug in src/a.ts", "R1", "only a goal detected as R3"],
		["Fix production build warning in src/a.ts", "R0", "rule-based risk R1"],
		["Fix production build warning in src/a.ts", "R2", "rule-based risk R1"],
		["Fix production build warning in src/a.ts", "R3", "rule-based risk R1"],
		["Upgrade dependencies used by the deploy script", "R1", "rule-based risk R2"],
	] as const)("fails closed for a stale or forged override: %s -> %s", (goal, to, message) => {
		expect(() => classifyRequest(goal, {}, { from: "R3", to })).toThrow(message);
	});

	it("rejects a forged source risk and never lets hints lower the result", () => {
		const goal = "Fix production build warning in src/a.ts";
		const forged = JSON.parse('{"from":"R2","to":"R1"}') as RiskOverride;
		expect(() => classifyRequest(goal, {}, forged)).toThrow("only a goal detected as R3");
		expect(classifyRequest(goal, { risk: "R0" }, { from: "R3", to: "R1" }).classification.risk).toBe("R1");
		expect(classifyRequest(goal, { risk: "R3" }, { from: "R3", to: "R1" }).classification.risk).toBe("R3");
		expect(classifyRequest(goal).classification.reason).not.toContain("override");
	});
});
