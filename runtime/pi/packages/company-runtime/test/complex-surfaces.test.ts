import { afterEach, describe, expect, it } from "vitest";
import type { Run } from "../src/contracts.ts";
import { formatEvidencePack, projectEvidencePack } from "../src/evidence.ts";
import { GraphProjectionError, projectRunGraph, renderGraphText } from "../src/graph.ts";
import { projectHostEvidence, projectHostGraph, projectHostRun } from "../src/host-bridge-projections.ts";
import { formatConfiguration, formatHistory, formatRunView } from "../src/observations.ts";
import { formatWeavraStatus } from "../src/status.ts";
import {
	type ComplexTaskSpec,
	complexConfig,
	complexHarness,
	complexPlanFor,
	driveComplex,
	FakeFiles,
	measurement,
	takeConsumerIssues,
} from "./complex-fixture.ts";
import { graphRun } from "./graph-fixtures.ts";

// #16 stage C: honest local surfaces for COMPLEX Runs. TUI status/history/team/review/config, the footer, the
// graph and the Evidence Pack render the parent with ordered task rows and integration gates from durable state;
// none presents one task as the Run outcome, invents a transition or copies prompts, prose, diffs or check output.

afterEach(() => {
	expect(takeConsumerIssues()).toEqual([]);
});

const TWO_TASKS: ComplexTaskSpec[] = [
	{ claims: [{ path: "src/app.ts", operation: "modify" }] },
	{ claims: [{ path: "src/new.ts", operation: "create" }] },
];

type Harness = ReturnType<typeof complexHarness>;
async function scenario(customize?: (h: Harness) => void) {
	const files = new FakeFiles({ "src/app.ts": "app\n", "src/util.ts": "util\n" });
	const { plan, parent } = await complexPlanFor(TWO_TASKS, { files });
	const h = complexHarness({ plan, parent, files });
	customize?.(h);
	const run = await driveComplex(await h.create());
	const find = (predicate: (value: Run) => boolean) => {
		const found = h.saved.find(predicate);
		if (!found) throw new Error("snapshot not found");
		return found;
	};
	return { h, run, find };
}
/** CT-001's first contribution review asks for one revision; everything else passes. */
const revised = () =>
	scenario((h) => {
		let reviews = 0;
		h.ports.agents.execute = async (request) => {
			if (request.role === "Reviewer" && request.complexContext?.taskId === "CT-001" && reviews++ === 0) {
				h.calls.push(request);
				await h.register(request);
				return {
					role: "Reviewer",
					contribution: h.contribution(request, "REVISE"),
					measurement: measurement(request),
				};
			}
			return h.defaultExecute(request);
		};
	});
/** C08: both tasks COMPLETED, then the first integration check fails. */
const integrationBlocked = () =>
	scenario((h) => {
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			const result = await verify(request);
			if (request.complexContext?.scope === "INTEGRATION")
				result.checks[1] = { ...result.checks[1], status: "FAIL", exitCode: 1 };
			return result;
		};
	});
/** C03: CT-002 requests CT-001's claimed file. */
const ownershipConflict = () =>
	scenario((h) => {
		h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer" || request.complexContext?.taskId !== "CT-002")
				return h.defaultExecute(request);
			h.calls.push(request);
			await h.register(request);
			request.ownership?.authorize("src/app.ts", "replace");
			throw new Error("unreachable");
		};
	});

describe("COMPLEX TUI status, history and footer (#16 stage C)", () => {
	it("/workflow status and /state show the parent, ordered task rows and integration gates", async () => {
		const { find } = await revised();
		// CT-002 attempt 1 runs while the global work cycle is 1: its step attempt is the task attempt.
		const mid = find((value) => value.complex?.tasks[1].status === "REVIEW");
		for (const command of ["workflow", "state"] as const) {
			const text = formatRunView(command, { run: mid, source: "stored snapshot" });
			expect(text).toContain("Workflow: COMPLEX | Final Reviewer: not performed");
			expect(text).toContain("Review: final not performed; task contribution reviews 2");
			expect(text).toContain("Step: review@1 (task CT-002); work cycles 1/3 across tasks");
			expect(text).toContain("Verification repair: not used by COMPLEX");
			expect(text).toContain(
				"COMPLEX parent parent-1 [inProgress] | Run RUNNING | phase TASK_SEQUENCE | active CT-002",
			);
			expect(text).toContain("a COMPLETED task is a verified contribution, not Run completion");
			expect(text).toMatch(
				/ {2}CT-001 COMPLETED \| attempt 2, revisions 1\/2 \| self-check PASS, review PASS, test PASS \| evidence (STALE|CURRENT) \| changed 1\/1 claimed \| failure none \| Task 1\n/,
			);
			expect(text).toMatch(
				/ {2}CT-002 REVIEW \| attempt 1, revisions 0\/2 \| self-check PASS, review NOT_RUN, test NOT_RUN \| evidence CURRENT \| changed 1\/1 claimed \| failure none \| Task 2 \| after CT-001\n/,
			);
			expect(text).toContain(
				"  Integration: first checks NOT_RUN, final review NOT_RUN, final checks NOT_RUN | workspace not captured | evidence NONE | failure none",
			);
			expect(text).toMatch(
				/Budget \(one Run ledger\): invocations 5\/24; reported tokens 500\/200000 \(provider-reported\); work cycles 1\/3/,
			);
			expect(text).not.toContain("Reviewer revisions");
		}
	});

	it("keeps a Run whose tasks all COMPLETED but whose integration failed visibly BLOCKED everywhere", async () => {
		const { run } = await integrationBlocked();
		expect(run.status).toBe("BLOCKED");
		const text = formatRunView("workflow", { run, source: "stored snapshot" });
		expect(text).toContain("Status: BLOCKED");
		expect(text).toContain("COMPLEX parent parent-1 [blocked] | Run BLOCKED | phase TERMINAL | active none");
		expect(text).toMatch(/ {2}CT-001 COMPLETED \|.*\| Task 1/);
		expect(text).toMatch(/ {2}CT-002 COMPLETED \|.*\| Task 2/);
		expect(text).toContain("  Integration: first checks FAIL, final review NOT_RUN, final checks NOT_RUN");
		expect(text).toContain("Run failure CHECK_FAILED");
		expect(text).not.toMatch(/Status: COMPLETED|\[completed\]/);
		expect(formatWeavraStatus(run, false)).toBe("Weavra · BLOCKED");
		const history = formatHistory({ revision: 9, runs: [run], actions: [] });
		expect(history).toContain("  COMPLEX parent parent-1 [blocked] | Run BLOCKED | phase TERMINAL | active none");
		expect(history).toContain("    CT-001 COMPLETED | attempt 1 | failure none | Task 1");
		expect(history).toContain("    Integration: first checks FAIL, final review NOT_RUN, final checks NOT_RUN");
	});

	it("history lists inline COMPLEX task rows, points archived COMPLEX Runs to /state and leaves STANDARD rows alone", async () => {
		const { run } = await scenario();
		const standard = graphRun();
		const history = formatHistory({
			revision: 12,
			runs: [standard, run],
			actions: [],
			archivedRuns: [
				{
					runId: "archived-complex",
					status: "COMPLETED",
					workflow: "COMPLEX",
					risk: "R1",
					phase: "COMPLETE",
					goal: "Older COMPLEX Run",
					updatedAt: 1,
				},
			],
		});
		expect(history).toContain("    CT-002 COMPLETED | attempt 1 | failure none | Task 2");
		expect(history).toContain("  COMPLEX task rows: /state archived-complex");
		const standardOnly = formatHistory({ revision: 1, runs: [standard], actions: [] });
		expect(standardOnly).not.toContain("COMPLEX");
		expect(standardOnly.split("\n")).toHaveLength(5);
	});

	it("names only executable COMPLEX roles and lists task contribution reviews separately from the final review", async () => {
		const { run } = await revised();
		const team = formatRunView("team", { run, source: "stored snapshot" });
		expect(team).toMatch(/Developer \(coding\): inactive; 3 session\(s\)/);
		expect(team).toMatch(/Reviewer \(reasoning\): inactive; 4 session\(s\)/);
		// No Lead row: V0.7B COMPLEX never executes a Lead or Planner session.
		expect(team).not.toMatch(/Lead \(reasoning\)/);
		expect(team).toContain("no Lead/Planner");
		const review = formatRunView("state", { run, source: "stored snapshot" }, "review");
		expect(review).toContain("Final integration review history: 1 recorded result(s)");
		expect(review).toContain("Task contribution reviews: 3 recorded");
		expect(review).toMatch(/CT-001@1 REVISE \| code revision 0/);
		expect(review).toMatch(/CT-001@2 PASS \| code revision 1/);
		expect(review).toMatch(/CT-002@1 PASS \| code revision 1/);
		expect(review).toMatch(/ {2}SUPPORTED: AC-001; evidence diff:[0-9a-f]{64}\n/);
	});

	it("the footer names the active task or integration stage, and only the Run outcome at the end", async () => {
		const { run, find } = await scenario();
		const implementing = find(
			(value) => value.complex?.tasks[1].status === "IMPLEMENTING" && value.activeAgents.includes("Developer"),
		);
		expect(formatWeavraStatus(implementing, true)).toBe("Weavra · COMPLEX · R1 · CT-002 · IMPLEMENT · Developer");
		const integration = find((value) => value.complex?.phase === "FINAL_REVIEW");
		expect(formatWeavraStatus(integration, true)).toMatch(/^Weavra · COMPLEX · R1 · FINAL_REVIEW · REVIEW/);
		expect(formatWeavraStatus(run, false)).toBe("Weavra · COMPLETED");
		// A live STANDARD footer is unchanged: no task or integration segment.
		expect(formatWeavraStatus({ ...graphRun(), status: "RUNNING" }, true)).toBe("Weavra · STANDARD · R1 · COMPLETE");
	});

	it("config states that COMPLEX needs a structured plan through Host Control", () => {
		const text = formatConfiguration(complexConfig());
		expect(text).toContain(
			"COMPLEX runs only from a structured task plan prepared and confirmed through Host Control (App); /workflow run does not accept one",
		);
		expect(text).toContain("COMPLEX min(3, limit) per Run, at most 2 per task");
		expect(text).not.toContain("COMPLEX execution unsupported");
	});
});

describe("COMPLEX graph (#16 stage C)", () => {
	it("never unrolls task attempts into one single-task chain or invents a transition", async () => {
		const { h, run } = await revised();
		// Before stage C a revised COMPLEX snapshot read as "inconsistent step/phase/attempt"; now every one projects.
		for (const snapshot of h.saved) {
			const graph = projectRunGraph(snapshot);
			expect(graph.nodes).toHaveLength(1);
			expect(graph.edges).toEqual([]);
			expect(graph.nodes[0]).toMatchObject({
				id: "preflight",
				kind: "preflight",
				label: "COMPLEX sequential run (task graph unavailable)",
			});
			expect(graph.nodes[0].status).not.toBe("passed");
			expect(graph.status).toBe(snapshot.status);
			expect(graph.stateRevision).toBe(snapshot.revision);
			expect(projectHostGraph(snapshot).nodes).toEqual([
				{ id: "preflight", kind: "preflight", status: graph.nodes[0].status },
			]);
		}
		const text = renderGraphText(projectRunGraph(run));
		expect(text).toContain("COMPLEX / R1 / COMPLETED");
		expect(text).toContain("[COMPLEX sequential run (task graph unavailable)] UNKNOWN");
		expect(text).toContain("/workflow status and /state show the ordered task rows and integration gates");
		expect(text).not.toMatch(/Complete #|Developer #|PASS required/);
	});

	it("keeps stopped outcomes and refuses an inconsistent COMPLEX snapshot", async () => {
		const { run } = await integrationBlocked();
		const graph = projectRunGraph(run);
		expect(graph.nodes[0]).toMatchObject({ status: "blocked", detail: run.lastError });
		const tampered = structuredClone(run);
		tampered.complex!.tasks[0].status = "PENDING";
		expect(() => projectRunGraph(tampered)).toThrow(GraphProjectionError);
		expect(() => projectRunGraph(tampered)).toThrow("inconsistent COMPLEX state");
	});
});

describe("COMPLEX Evidence Pack (#16 stage C)", () => {
	it("adds a bounded allowlisted summary derived only from the canonical Run", async () => {
		const { run } = await revised();
		const pack = projectEvidencePack({ run });
		const complex = pack.complex;
		const plan = run.complex!.plan;
		expect(complex).toBeDefined();
		expect(Object.keys(complex!).sort()).toEqual([
			"activeTaskId",
			"attempts",
			"budget",
			"changesUnknown",
			"cleanup",
			"failureCode",
			"integration",
			"parent",
			"partialChanges",
			"phase",
			"plan",
			"tasks",
		]);
		expect(complex).toMatchObject({
			parent: { id: "parent-1", digest: plan.parentTaskContractDigest, status: "completed" },
			plan: {
				id: plan.planId,
				digest: plan.complexPlanDigest,
				limits: { maxWorkerInvocations: 24, maxReportedTokens: 200000, maxTotalRevisionCycles: 3 },
			},
			phase: "TERMINAL",
			activeTaskId: null,
			budget: {
				workerInvocations: 7,
				reportedTokens: 700,
				totalRevisionCycles: 1,
				status: "WITHIN_LIMITS",
				usage: "PROVIDER_REPORTED",
			},
			cleanup: "CONFIRMED",
			partialChanges: false,
			changesUnknown: false,
			failureCode: null,
		});
		expect(complex!.tasks[0]).toEqual({
			id: "CT-001",
			title: "Task 1",
			status: "COMPLETED",
			dependsOn: [],
			claims: [{ path: "src/app.ts", operation: "modify" }],
			attempt: 2,
			revisionCycle: 1,
			maxRevisionCycles: 2,
			workerInvocations: 4,
			reportedTokens: 400,
			changedFiles: ["src/app.ts"],
			changesUnknown: false,
			changeDigest: run.complexEvidence!.find(
				(record) => record.complexContext.taskId === "CT-001" && record.complexContext.attempt === 2,
			)!.changeDigest,
			selfCheck: "PASS",
			review: "PASS",
			test: "PASS",
			evidenceFreshness: "STALE",
			failureCode: null,
		});
		expect(complex!.tasks[0].changeDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		expect(complex!.tasks[1]).toMatchObject({
			id: "CT-002",
			dependsOn: ["CT-001"],
			claims: [{ path: "src/new.ts", operation: "create" }],
		});
		expect(complex!.integration).toMatchObject({
			check: "PASS",
			review: "PASS",
			test: "PASS",
			changedFiles: ["src/app.ts", "src/new.ts"],
			evidenceFreshness: "CURRENT",
			failureCode: null,
		});
		expect(complex!.integration.changeDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		// Revised attempts stay history; the integration record comes last.
		expect(complex!.attempts.map((attempt) => [attempt.taskId, attempt.attempt, attempt.revision])).toEqual([
			["CT-001", 1, 0],
			["CT-001", 2, 1],
			["CT-002", 1, 1],
			[null, 1, 1],
		]);
		// Every check and worker is attributed to its Kernel-assigned task or integration context.
		expect(new Set(pack.checks.map((check) => check.task))).toEqual(new Set(["CT-001", "CT-002", "integration"]));
		expect(pack.workers.map((worker) => worker.task)).toEqual([
			"CT-001",
			"CT-001",
			"CT-001",
			"CT-001",
			"CT-002",
			"CT-002",
			"integration",
		]);
		expect(pack.cleanup).toBe("confirmed");
		const text = formatEvidencePack(pack);
		expect(text).toContain(
			`COMPLEX parent parent-1 ${plan.parentTaskContractDigest} [completed]; plan ${plan.planId}`,
		);
		expect(text).toContain("  CT-001 COMPLETED | Task 1 | after none | claims modify src/app.ts");
		expect(text).toContain(
			"    attempt 2, revisions 1/2, invocations 4, reported tokens 400 | changed src/app.ts (sha256:",
		);
		expect(text).toContain("  Attempts: 4 recorded");
		expect(text).toContain("    CT-001@1 work cycle 0: entry ");
		expect(text).toContain("  Integration: first checks PASS, final review PASS, final checks PASS");
		expect(text).toContain(
			"  Budget: invocations 7/24, reported tokens 700/200000 (provider-reported), work cycles 1/3; WITHIN_LIMITS",
		);
		expect(text).toContain("not Run completion");
		expect(text).toMatch(/Check test \(CT-001 self-check #1, revision 0, required\): PASS/);
		expect(text).toMatch(/Developer implement@1 \[CT-001\] rev 0/);
	});

	it("never carries check output, worker prose, file contents or tool arguments", async () => {
		const { run } = await scenario((h) => {
			const verify = h.ports.verifier.verify;
			h.ports.verifier.verify = async (request) => {
				const result = await verify(request);
				result.checks = result.checks.map((check) => ({
					...check,
					stdout: "CHECK_STDOUT_SENTINEL",
					stderr: "CHECK_STDERR_SENTINEL",
				}));
				return result;
			};
		});
		expect(run.verification.every((check) => check.stdout === "CHECK_STDOUT_SENTINEL")).toBe(true);
		const pack = projectEvidencePack({ run });
		const serialized = `${JSON.stringify(pack)}\n${formatEvidencePack(pack)}`;
		for (const secret of ["CHECK_STDOUT_SENTINEL", "CHECK_STDERR_SENTINEL", "Implemented CT-0", "CT-001@1\\n"])
			expect(serialized).not.toContain(secret);
		expect(JSON.stringify(pack.complex)).not.toMatch(/summary|stdout|stderr|prompt|arguments|content/);
	});

	it("maps closed failure codes to existing categories and leaves QUICK/STANDARD packs and summaries unchanged", async () => {
		const conflict = (await ownershipConflict()).run;
		expect(conflict.complex?.failureCode).toBe("OWNERSHIP_CONFLICT");
		expect(projectEvidencePack({ run: conflict }).failure?.category).toBe("POLICY");
		expect(projectHostEvidence(conflict).failureCategory).toBe("POLICY");
		const blocked = (await integrationBlocked()).run;
		expect(projectEvidencePack({ run: blocked }).failure?.category).toBe("VERIFICATION");
		expect(projectEvidencePack({ run: blocked }).complex?.integration).toMatchObject({
			check: "FAIL",
			failureCode: "CHECK_FAILED",
		});
		const standard = graphRun();
		const pack = projectEvidencePack({ run: standard });
		expect("complex" in pack).toBe(false);
		expect(pack.checks.every((check) => !("task" in check))).toBe(true);
		// The ordinary bridge summaries of a COMPLEX Run keep exactly the existing fields.
		expect(Object.keys(projectHostEvidence(blocked)).sort()).toEqual(
			Object.keys(projectHostEvidence(standard)).sort(),
		);
		expect(Object.keys(projectHostRun(blocked)).sort()).toEqual(Object.keys(projectHostRun(standard)).sort());
	});
});
