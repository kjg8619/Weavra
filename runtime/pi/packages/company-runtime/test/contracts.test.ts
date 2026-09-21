import type { Static, TSchema } from "typebox";
import { describe, expect, it } from "vitest";
import {
	CheckResultSchema,
	HandoffSchema,
	LegacyTaskSchema,
	PolicyDecisionSchema,
	ReviewSchema,
	RunSchema,
	validateContract,
} from "../src/contracts.ts";

const task = {
	id: "task-1",
	goal: "Fix login",
	requirements: ["Expired tokens return 401"],
	status: "pending",
} satisfies Static<typeof LegacyTaskSchema>;
const check = {
	id: "regression",
	runId: "run-1",
	revision: 0,
	kind: "test",
	status: "PASS",
	required: true,
	exitCode: 0,
	reason: "Regression test passed",
	evidenceRefs: ["check-1"],
	diffDigest: "diff-1",
} satisfies Static<typeof CheckResultSchema>;
const handoff = {
	runId: "run-1",
	revision: 0,
	role: "Developer",
	task: "task-1",
	changed_files: ["src/login.ts"],
	summary: "Handle expired tokens",
	assumptions: [],
	tests_run: ["check-1"],
	known_risks: [],
	unresolved: [],
} satisfies Static<typeof HandoffSchema>;
const review = {
	runId: "run-1",
	revision: 0,
	role: "Reviewer",
	task: "task-1",
	result: "PASS",
	issues: [],
	criteria: [{ criterionId: "AC-001", status: "MET", evidenceRefs: ["check-1"] }],
	evidenceRefs: ["check-1"],
	diffDigest: "diff-1",
} satisfies Static<typeof ReviewSchema>;
const policy = {
	runId: "run-1",
	actionId: "action-1",
	role: "Developer",
	risk: "R1",
	decision: "ALLOW",
	reason: "Allowed code edit",
	actionDigest: "action-digest",
	configDigest: "config-digest",
} satisfies Static<typeof PolicyDecisionSchema>;
const run = {
	schemaVersion: 1,
	revision: 0,
	eventSequence: 0,
	currentStep: null,
	runId: "run-1",
	goal: "Fix login",
	status: "CREATED",
	phase: "PREFLIGHT",
	workflow: "STANDARD",
	classification: {
		intent: "bugfix",
		complexity: "STANDARD",
		risk: "R1",
		confidence: null,
		reason: "Explicit bug report",
	},
	risk: "R1",
	currentTask: "task-1",
	tasks: [task],
	activeAgents: [],
	completed: [],
	next: ["Implement"],
	roleSessionRefs: [],
	revisionCycle: 0,
	verification: [],
	lastError: null,
	createdAt: 1,
	updatedAt: 1,
} satisfies Static<typeof RunSchema>;
const examples: Array<{ name: string; schema: TSchema; value: Record<string, unknown> }> = [
	{ name: "LegacyTask", schema: LegacyTaskSchema, value: task },
	{ name: "CheckResult", schema: CheckResultSchema, value: check },
	{ name: "Handoff", schema: HandoffSchema, value: handoff },
	{ name: "Review", schema: ReviewSchema, value: review },
	{ name: "PolicyDecision", schema: PolicyDecisionSchema, value: policy },
	{ name: "Run", schema: RunSchema, value: run },
];

describe("S0 data contracts", () => {
	it.each(examples)("validates $name without mutating it", ({ schema, value }) => {
		const before = structuredClone(value);
		expect(validateContract(schema, value)).toEqual(before);
		expect(value).toEqual(before);
	});

	it.each(examples)("rejects unknown or missing fields in $name", ({ schema, value }) => {
		expect(() => validateContract(schema, { ...value, unexpected: true })).toThrow();
		for (const key of Object.keys(value)) {
			const incomplete = { ...value };
			delete incomplete[key];
			expect(() => validateContract(schema, incomplete)).toThrow();
		}
		expect(() => validateContract(schema, "Done")).toThrow();
	});

	it("rejects a Developer review, unsupported results and missing evidence identifiers", () => {
		for (const patch of [
			{ role: "Developer" },
			{ result: "DONE" },
			{ diffDigest: "" },
			{ criteria: [] },
			{ revision: -1 },
		]) {
			expect(() => validateContract(ReviewSchema, { ...review, ...patch })).toThrow();
		}
		expect(() => validateContract(HandoffSchema, { ...handoff, role: "Reviewer" })).toThrow();
		expect(() => validateContract(HandoffSchema, { ...handoff, tests_run: [{ status: "PASS" }] })).toThrow();
	});

	it("accepts REVISE and BLOCK without interpreting them as completion", () => {
		for (const result of ["REVISE", "BLOCK"] as const) {
			expect(validateContract(ReviewSchema, { ...review, result }).result).toBe(result);
		}
		for (const status of ["FAIL", "SKIPPED", "UNAVAILABLE"] as const) {
			expect(validateContract(CheckResultSchema, { ...check, status, exitCode: null }).status).toBe(status);
		}
	});

	it("rejects unsupported run versions, nested fields, invalid counters and classifications", () => {
		for (const patch of [
			{ schemaVersion: 2 },
			{ revision: 0.5 },
			{ revisionCycle: -1 },
			{ updatedAt: Infinity },
			{ activeAgents: ["Developer", "Developer"] },
			{ workflow: "UNKNOWN" },
			{ classification: { ...run.classification, confidence: 1.1 } },
			{ tasks: [{ ...task, secretlyCompleted: true }] },
		]) {
			expect(() => validateContract(RunSchema, { ...run, ...patch })).toThrow();
		}
		expect(() => validateContract(PolicyDecisionSchema, { ...policy, risk: "R4" })).toThrow();
	});
});
