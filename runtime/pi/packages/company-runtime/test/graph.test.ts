import { describe, expect, it } from "vitest";
import type { Run } from "../src/contracts.ts";
import { projectRunGraph, renderGraphText } from "../src/graph.ts";
import { graphApproval, graphRun, implementingGraphRun } from "./graph-fixtures.ts";

function freeze(value: unknown): void {
	if (!value || typeof value !== "object") return;
	Object.freeze(value);
	for (const child of Object.values(value)) freeze(child);
}

describe("V0.2A pure read-only DAG projection", () => {
	it.each([
		{ workflow: "QUICK", risk: "R0" },
		{ workflow: "QUICK", risk: "R1" },
		{ workflow: "STANDARD", risk: "R1" },
		{ workflow: "STANDARD", risk: "R2" },
	] as const)("projects $workflow/$risk from a terminal snapshot alone", ({ workflow, risk }) => {
		const run = graphRun(workflow, risk);
		freeze(run);
		const graph = projectRunGraph(run);
		expect(graph).toMatchObject({ runId: "run", workflow, risk, status: "COMPLETED" });
		expect(graph.nodes.map((node) => node.id)).toEqual([
			"implement:1",
			"self-check:1",
			...(workflow === "STANDARD" ? ["review:1"] : []),
			"test:1",
			"complete:1",
		]);
		expect(graph.nodes.every((node) => node.status === "passed")).toBe(true);
		expect(graph.nodes[0].role).toBe(workflow === "QUICK" ? "Executor" : "Developer");
		expect(graph.edges).toHaveLength(graph.nodes.length - 1);
		expect(renderGraphText(graph)).toContain(`${workflow} / ${risk} / COMPLETED`);
		expect(renderGraphText(graph)).not.toContain("Scheduler");
	});
	it.each([1, 2, 3])("unrolls %s revisions with a forward REVISE edge and no unexecuted old TEST", (revisions) => {
		const graph = projectRunGraph(graphRun("STANDARD", "R2", revisions));
		expect(graph.nodes).toHaveLength(revisions * 3 + 5);
		for (let attempt = 1; attempt <= revisions; attempt++) {
			expect(graph.nodes.find((node) => node.id === `review:${attempt}`)).toMatchObject({
				status: "revised",
				verdict: "REVISE",
			});
			expect(graph.edges).toContainEqual({
				from: `review:${attempt}`,
				to: `implement:${attempt + 1}`,
				kind: "revise",
			});
			expect(graph.nodes.some((node) => node.id === `test:${attempt}`)).toBe(false);
		}
		expect(graph.edges).toContainEqual({
			from: `review:${revisions + 1}`,
			to: `test:${revisions + 1}`,
			kind: "pass",
		});
		const positions = new Map(graph.nodes.map((node, index) => [node.id, index]));
		for (const edge of graph.edges) expect(positions.get(edge.from)!).toBeLessThan(positions.get(edge.to)!);
	});
	it("has deterministic node/edge/check ordering without mutating or retaining snapshot references", () => {
		const run = graphRun("STANDARD", "R1", 2);
		const before = structuredClone(run);
		const first = projectRunGraph(run);
		run.reviewHistory?.reverse();
		run.verification.reverse();
		expect(projectRunGraph(run)).toEqual(first);
		expect(renderGraphText(projectRunGraph(JSON.parse(JSON.stringify(before))))).toBe(renderGraphText(first));
		first.nodes[0].label = "external edit";
		first.nodes.find((node) => node.checks)?.checks?.splice(0);
		expect(projectRunGraph(before).nodes[0].label).toBe("Developer #1");
		expect(before.verification).toHaveLength(4);
	});
	it("distinguishes pending preflight and terminal preflight rejection", () => {
		const run = implementingGraphRun();
		run.currentStep = null;
		run.phase = "PREFLIGHT";
		run.status = "CREATED";
		expect(projectRunGraph(run).nodes.every((node) => node.status === "pending")).toBe(true);
		run.status = "BLOCKED";
		run.lastError = "Missing preflight requirement";
		const graph = projectRunGraph(run);
		expect(graph.nodes[0]).toMatchObject({ id: "preflight", status: "blocked" });
		expect(graph.nodes.slice(1).every((node) => node.status === "skipped")).toBe(true);
	});
	it.each(["CANCELLED", "FAILED", "BLOCKED", "INTERRUPTED"] as const)(
		"shows %s on the stopped step and skips future steps",
		(status) => {
			const run = implementingGraphRun();
			run.status = status;
			const graph = projectRunGraph(run);
			expect(graph.nodes[0].status).toBe(
				status === "CANCELLED"
					? "cancelled"
					: status === "FAILED"
						? "failed"
						: status === "BLOCKED"
							? "blocked"
							: "unknown",
			);
			expect(graph.nodes.slice(1).every((node) => node.status === "skipped")).toBe(true);
		},
	);
	it("keeps recorded Reviewer/check PASS while showing stale-evidence BLOCK at COMPLETE", () => {
		const run = graphRun();
		run.status = "BLOCKED";
		run.lastError = "Workspace changed after final checks; review is stale";
		const graph = projectRunGraph(run);
		expect(graph.nodes.find((node) => node.id === "review:1")).toMatchObject({ status: "passed", verdict: "PASS" });
		expect(graph.nodes.find((node) => node.id === "complete:1")).toMatchObject({
			status: "blocked",
			detail: run.lastError,
		});
		expect(renderGraphText(graph)).toContain("review is stale");
	});
	it.each(["BLOCK", "REVISE"] as const)(
		"retains terminal Reviewer verdict %s, without fabricating another attempt",
		(verdict) => {
			const run = graphRun();
			run.status = "BLOCKED";
			run.phase = "REVIEW";
			run.currentStep = { stepId: "review", attempt: 1 };
			run.review!.result = verdict;
			run.verification.pop();
			const graph = projectRunGraph(run);
			expect(graph.nodes.find((node) => node.id === "review:1")).toMatchObject({ status: "blocked", verdict });
			expect(graph.nodes.at(-1)?.status).toBe("skipped");
			expect(graph.nodes.some((node) => node.id === "implement:2")).toBe(false);
		},
	);
	it.each(["FAIL", "UNAVAILABLE", "SKIPPED"] as const)(
		"normalizes required check %s without changing its recorded result",
		(status) => {
			const run = graphRun();
			run.status = "BLOCKED";
			run.phase = "TEST";
			run.currentStep = { stepId: "test", attempt: 1 };
			run.verification[1].status = status;
			run.verification[1].exitCode = status === "FAIL" ? 7 : null;
			const graph = projectRunGraph(run);
			expect(graph.nodes.find((node) => node.id === "test:1")).toMatchObject({
				status: status === "FAIL" ? "failed" : "blocked",
				checks: [{ status }],
			});
			expect(run.verification[1].status).toBe(status);
		},
	);
	it("does not promote PASS check data persisted during a cancelled step to step completion", () => {
		const run = graphRun();
		run.phase = "TEST";
		run.currentStep = { stepId: "test", attempt: 1 };
		run.status = "CANCELLED";
		expect(projectRunGraph(run).nodes.find((node) => node.id === "test:1")).toMatchObject({
			status: "cancelled",
			checks: [{ status: "PASS" }],
		});
	});
	it.each(["PENDING", "APPROVED", "CONSUMED", "DENIED", "EXPIRED", "CANCELLED", "INTERRUPTED"] as const)(
		"R3 approval %s is a projection detail inside IMPLEMENT",
		(approval) => {
			const run = implementingGraphRun("R3");
			run.approvals = [graphApproval(approval)];
			run.status =
				approval === "PENDING"
					? "WAITING_APPROVAL"
					: ["DENIED", "EXPIRED"].includes(approval)
						? "BLOCKED"
						: approval === "CANCELLED"
							? "CANCELLED"
							: "RUNNING";
			const before = structuredClone(run);
			const graph = projectRunGraph(run);
			const node = graph.nodes.find((node) => node.id === "approval:1")!;
			expect(node).toMatchObject({
				kind: "approval",
				parentId: "implement:1",
				stepId: "implement",
				approvalStatus: approval,
			});
			expect(node.status).toBe(
				approval === "PENDING"
					? "waiting_approval"
					: ["APPROVED", "CONSUMED"].includes(approval)
						? "passed"
						: ["DENIED", "EXPIRED"].includes(approval)
							? "blocked"
							: approval === "CANCELLED"
								? "cancelled"
								: "unknown",
			);
			expect(graph.nodes.find((node) => node.id === "mutation:1")?.status).toBe(
				approval === "CONSUMED"
					? "passed"
					: ["DENIED", "EXPIRED"].includes(approval)
						? "skipped"
						: ["CANCELLED", "INTERRUPTED"].includes(approval)
							? "unknown"
							: "pending",
			);
			expect(graph.edges).toContainEqual({ from: "implement:1", to: "approval:1", kind: "contains" });
			expect(graph.edges).toContainEqual({ from: "approval:1", to: "mutation:1", kind: "approved" });
			expect(run).toEqual(before);
		},
	);
	it("preserves a consumed mutation after failure and treats unconsumed approval as unconfirmed", () => {
		const run = implementingGraphRun("R3");
		run.status = "FAILED";
		run.approvals = [graphApproval("CONSUMED")];
		expect(projectRunGraph(run).nodes.find((node) => node.kind === "mutation")?.status).toBe("passed");
		run.approvals[0].status = "APPROVED";
		expect(projectRunGraph(run).nodes.find((node) => node.kind === "mutation")?.status).toBe("unknown");
	});
	it("rebuilds a complete R3 terminal graph using only the serialized Run", () => {
		const graph = projectRunGraph(JSON.parse(JSON.stringify(graphRun("STANDARD", "R3"))));
		expect(graph.nodes.every((node) => node.status === "passed")).toBe(true);
		expect(graph.nodes.map((node) => node.id)).toEqual([
			"implement:1",
			"approval:1",
			"mutation:1",
			"self-check:1",
			"review:1",
			"test:1",
			"complete:1",
		]);
	});
	it("missing historical/step metadata becomes UNKNOWN, not reconstructed event history", () => {
		const run = graphRun("STANDARD", "R1", 1);
		delete run.handoff;
		delete run.review;
		delete run.reviewHistory;
		for (const check of run.verification) delete check.step;
		const graph = projectRunGraph(run);
		expect(graph.status).toBe("COMPLETED");
		expect(graph.nodes.every((node) => node.status === "unknown")).toBe(true);
		expect(graph.edges).toContainEqual({ from: "review:1", to: "implement:2", kind: "next_attempt" });
		expect(graph.edges.some((edge) => edge.kind === "revise")).toBe(false);
		expect(graph.diagnostics.join("\n")).toContain("incomplete/conflicting");
	});
	it.each([
		{ label: "missing fields", mutate: () => ({ runId: "run", status: "COMPLETED" }) },
		{ label: "phase mismatch", mutate: (run: Run) => ({ ...run, phase: "IMPLEMENT" }) },
		{
			label: "attempt mismatch",
			mutate: (run: Run) => ({ ...run, currentStep: { stepId: "complete", attempt: 2 } }),
		},
		{ label: "unbounded attempts", mutate: (run: Run) => ({ ...run, revisionCycle: Number.MAX_SAFE_INTEGER }) },
		{
			label: "wrong check owner",
			mutate: (run: Run) => {
				run.verification[0].runId = "other";
				return run;
			},
		},
		{
			label: "wrong review owner",
			mutate: (run: Run) => {
				run.review!.task = "other";
				return run;
			},
		},
		{
			label: "duplicate checks",
			mutate: (run: Run) => {
				run.verification.push(run.verification[0]);
				return run;
			},
		},
		{
			label: "duplicate reviews",
			mutate: (run: Run) => {
				run.reviewHistory!.push(run.review!);
				return run;
			},
		},
		{
			label: "missing PASS evidence",
			mutate: (run: Run) => {
				run.verification[0].exitCode = null;
				return run;
			},
		},
	])("fails safely for $label", ({ mutate }) => {
		expect(() => projectRunGraph(mutate(graphRun()))).toThrow("Graph unavailable");
	});
	it.each(["role", "scope", "approval"])(
		"rejects contradictory %s metadata instead of showing another workflow",
		(kind) => {
			const run = graphRun();
			if (kind === "role") run.executorResult = graphRun("QUICK").executorResult;
			if (kind === "scope") run.quickScope = { risk: "R0", targetPath: null };
			if (kind === "approval") run.approvals = [graphApproval("CONSUMED")];
			expect(() => projectRunGraph(run)).toThrow("Graph unavailable");
		},
	);
	it("does not invent a COMPLEX/Lead execution graph", () => {
		const run = implementingGraphRun();
		run.workflow = "COMPLEX";
		run.status = "BLOCKED";
		run.phase = "PREFLIGHT";
		run.currentStep = null;
		const graph = projectRunGraph(run);
		expect(graph.nodes).toHaveLength(1);
		expect(graph.edges).toEqual([]);
		expect(graph.nodes[0].role).toBeUndefined();
	});
	it("bounds text and escapes data-driven terminal controls and fake headings", () => {
		const run = graphRun();
		run.status = "BLOCKED";
		run.lastError = `\u001b[2J\nFORGED\u202e${"x".repeat(40000)}`;
		const text = renderGraphText(projectRunGraph(run));
		expect(text).not.toContain("\u001b");
		expect(text).not.toContain("\u202e");
		expect(text).toContain("\\u000aFORGED");
		expect(text).toContain("truncated");
		expect(text.length).toBeLessThan(32500);
	});
});
