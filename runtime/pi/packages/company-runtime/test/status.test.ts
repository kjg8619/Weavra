import { describe, expect, it } from "vitest";
import type { Run } from "../src/contracts.ts";
import { formatWeavraStatus } from "../src/status.ts";

function run(patch: Partial<Run> = {}): Run {
	return {
		schemaVersion: 1,
		revision: 1,
		eventSequence: 1,
		currentStep: { stepId: "implement", attempt: 1 },
		runId: "run",
		goal: "Fix bug",
		status: "RUNNING",
		phase: "IMPLEMENT",
		workflow: "STANDARD",
		classification: { intent: "bugfix", complexity: "STANDARD", risk: "R1", confidence: null, reason: "Fixture" },
		risk: "R1",
		currentTask: "task",
		tasks: [{ id: "task", goal: "Fix bug", requirements: ["Fix bug"], status: "inProgress" }],
		activeAgents: ["Developer"],
		completed: [],
		next: ["implement"],
		roleSessionRefs: [],
		revisionCycle: 0,
		verification: [],
		lastError: null,
		createdAt: 1,
		updatedAt: 1,
		...patch,
	};
}

describe("Weavra status is a snapshot projection, not a Run state machine", () => {
	it("has no run label without a Kernel snapshot", () => {
		expect(formatWeavraStatus(undefined, true)).toBeUndefined();
		expect(formatWeavraStatus(undefined, false, "preflight failure")).toBeUndefined();
	});
	it.each(["R0", "R1"] as const)("formats QUICK %s with its actual active role", (risk) => {
		expect(formatWeavraStatus(run({ workflow: "QUICK", risk, activeAgents: ["Executor"] }), true)).toBe(
			`Weavra · QUICK · ${risk} · IMPLEMENT · Executor`,
		);
	});
	it.each(["IMPLEMENT", "SELF_CHECK", "REVIEW", "TEST", "COMPLETE"] as const)(
		"uses snapshot phase %s without replaying events",
		(phase) => {
			expect(formatWeavraStatus(run({ phase, activeAgents: [] }), true)).toBe(`Weavra · STANDARD · R1 · ${phase}`);
		},
	);
	it("projects WAITING_APPROVAL without changing the stored IMPLEMENT phase", () => {
		const snapshot = run({ risk: "R3", status: "WAITING_APPROVAL" });
		const before = structuredClone(snapshot);
		expect(formatWeavraStatus(snapshot, true)).toBe("Weavra · STANDARD · R3 · APPROVAL · Developer");
		expect(snapshot).toEqual(before);
	});
	it.each(["COMPLETED", "BLOCKED", "CANCELLED", "FAILED", "INTERRUPTED"] as const)(
		"terminal %s never carries a stale phase/active role",
		(status) => {
			expect(formatWeavraStatus(run({ status }), false)).toBe(`Weavra · ${status}`);
		},
	);
	it.each(["CREATED", "RUNNING", "WAITING_APPROVAL"] as const)(
		"does not present %s as live without the local execution owner",
		(status) => {
			expect(formatWeavraStatus(run({ status }), false)).toBe("Weavra · UNCONFIRMED · /state");
		},
	);
	it("does not mask a cleanup/report failure with a COMPLETED snapshot", () => {
		expect(formatWeavraStatus(run({ status: "COMPLETED" }), false, "Lock cleanup failed")).toBe(
			"Weavra · ATTENTION · /state",
		);
	});
	it("keeps a normal terminal failure when the report agrees with the Kernel", () => {
		expect(formatWeavraStatus(run({ status: "CANCELLED", lastError: "Run cancelled" }), false, "Run cancelled")).toBe(
			"Weavra · CANCELLED",
		);
	});
});
