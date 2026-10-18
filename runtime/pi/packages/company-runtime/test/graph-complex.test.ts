import { afterEach, describe, expect, it } from "vitest";
import { projectRunGraph, renderGraphText } from "../src/graph.ts";
import { projectHostGraph } from "../src/host-bridge-projections.ts";
import {
	type ComplexTaskSpec,
	complexConfig,
	complexHarness,
	complexPlanFor,
	driveComplex,
	FakeFiles,
	takeConsumerIssues,
} from "./complex-fixture.ts";

afterEach(() => {
	takeConsumerIssues();
});

// Two independent tasks, then one task that depends on both: waves [CT-001, CT-002] then [CT-003].
const DIAMOND: ComplexTaskSpec[] = [
	{ claims: [{ path: "src/a.ts", operation: "modify" }], dependsOn: [] },
	{ claims: [{ path: "src/b.ts", operation: "create" }], dependsOn: [] },
	{ claims: [{ path: "src/c.ts", operation: "modify" }], dependsOn: [1, 2] },
];

async function diamondRun() {
	const files = new FakeFiles({ "src/a.ts": "a\n", "src/c.ts": "c\n", "src/util.ts": "util\n" });
	const { plan, parent } = await complexPlanFor(DIAMOND, { files, config: complexConfig({ maxParallel: 2 }) });
	const h = complexHarness({ plan, parent, files });
	const run = await driveComplex(await h.create());
	expect(run.status, run.lastError ?? "").toBe("COMPLETED");
	return { run, saved: h.saved };
}

describe("COMPLEX run graph", () => {
	it("draws plan tasks by wave with declared dependencies and stored integration gates", async () => {
		const { run } = await diamondRun();
		const graph = projectRunGraph(run);
		expect(graph.nodes.find((node) => node.id === "complete")?.detail).toBeUndefined();
		expect(graph.nodes.map((node) => [node.id, node.kind, node.status, node.wave])).toEqual([
			["task:CT-001", "task", "passed", 1],
			["task:CT-002", "task", "passed", 1],
			["task:CT-003", "task", "passed", 2],
			["integration:check", "verification", "passed", undefined],
			["integration:review", "review", "passed", undefined],
			["integration:test", "verification", "passed", undefined],
			["complete", "completion", "passed", undefined],
		]);
		expect(graph.edges).toEqual([
			{ from: "task:CT-001", to: "task:CT-003", kind: "sequence" },
			{ from: "task:CT-002", to: "task:CT-003", kind: "sequence" },
			{ from: "task:CT-003", to: "integration:check", kind: "sequence" },
			{ from: "integration:check", to: "integration:review", kind: "pass" },
			{ from: "integration:review", to: "integration:test", kind: "pass" },
			{ from: "integration:test", to: "complete", kind: "pass" },
		]);
		expect(renderGraphText(graph)).toContain("(wave 2)");
	});

	it("projects every durable snapshot without inventing progress the state does not record", async () => {
		const { saved } = await diamondRun();
		let sawParallel = false;
		for (const snapshot of saved) {
			if (!snapshot.complex) continue;
			const graph = projectRunGraph(snapshot);
			for (const row of snapshot.complex.tasks) {
				const node = graph.nodes.find((candidate) => candidate.id === `task:${row.id}`);
				expect(node?.status === "passed").toBe(row.status === "COMPLETED");
			}
			const complete = graph.nodes.find((node) => node.id === "complete");
			expect(complete?.status === "passed").toBe(snapshot.status === "COMPLETED");
			if (graph.nodes.filter((node) => node.kind === "task" && node.status === "running").length > 1)
				sawParallel = true;
		}
		expect(sawParallel).toBe(true);
	});

	it("carries the wave through the host bridge without labels", async () => {
		const { run } = await diamondRun();
		const summary = projectHostGraph(run);
		expect(summary.nodes.find((node) => node.id === "task:CT-003")).toEqual({
			id: "task:CT-003",
			kind: "task",
			status: "passed",
			attempt: 1,
			wave: 2,
		});
		expect(JSON.stringify(summary)).not.toContain("label");
	});

	it("carries the stored run error on the completion node only when the Run is terminal and failed", async () => {
		const files = new FakeFiles({ "src/a.ts": "a\n", "src/c.ts": "c\n", "src/util.ts": "util\n" });
		const { plan, parent } = await complexPlanFor(DIAMOND, { files, config: complexConfig({ maxParallel: 2 }) });
		const h = complexHarness({ plan, parent, files });
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			const result = await verify(request);
			if (request.complexContext?.taskId === "CT-001")
				result.checks[0] = { ...result.checks[0], status: "FAIL", exitCode: 1, reason: "Fake check failed" };
			return result;
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.lastError).toBeTypeOf("string");
		const complete = projectRunGraph(run).nodes.find((node) => node.id === "complete");
		expect(complete?.detail).toBe(run.lastError);
	});
});
