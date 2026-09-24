import { Check } from "typebox/value";
import { afterEach, describe, expect, it } from "vitest";
import { ComplexOwnershipDenied } from "../src/complex-ownership.ts";
import { ComplexPlanBindingError } from "../src/complex-plan.ts";
import { COMPLEX_FAILURE_CODES, ComplexParentSchema } from "../src/complex-types.ts";
import {
	ACCEPTANCE_CRITERION_ID_PATTERN,
	type ApprovalDecision,
	type ApprovalRequest,
	MAX_ACCEPTANCE_CRITERIA,
	MAX_ACCEPTANCE_STATEMENT_LENGTH,
	type Run,
} from "../src/contracts.ts";
import { assertCanCompleteComplex, CompanyKernel } from "../src/kernel.ts";
import { WorkerExecutionError } from "../src/measurement.ts";
import type { AgentExecutionRequest, AgentExecutionResult } from "../src/ports.ts";
import {
	type ComplexTaskSpec,
	complexConfig,
	complexHarness,
	complexPlanFor,
	contextOf,
	driveComplex,
	FakeFiles,
	measurement,
	takeConsumerIssues,
} from "./complex-fixture.ts";

// #16 stage B: the Kernel COMPLEX task machine with fake ports. The fixture store checks every persisted
// snapshot against the durable COMPLEX invariants (the #17 consumer rules); `invariantErrors` must stay empty.
// #16 stage C: every durable snapshot of every scenario is also projected for Host Control and must pass every
// App consumer rule, alone and against the previous snapshot of the same Run (complex-conformance.ts).
afterEach(() => {
	expect(takeConsumerIssues()).toEqual([]);
});

const EXISTING_EVENTS = new Set([
	"RunCreated",
	"RunStarted",
	"RunCompleted",
	"RunFailed",
	"RunBlocked",
	"RunCancelled",
	"RunInterrupted",
	"StepStarted",
	"StepCompleted",
	"StepFailed",
	"AgentStarted",
	"AgentCompleted",
	"AgentFailed",
	"AgentSessionCreated",
	"ReviewRequested",
	"ReviewPassed",
	"ReviewRevisionRequested",
	"ReviewBlocked",
	"VerificationStarted",
	"VerificationCompleted",
	"VerificationFailed",
	"ApprovalRequested",
	"ApprovalResolved",
	"ApprovalConsumed",
]);

const TWO_TASKS: ComplexTaskSpec[] = [
	{ claims: [{ path: "src/app.ts", operation: "modify" }] },
	{ claims: [{ path: "src/new.ts", operation: "create" }] },
];

async function harness(
	specs: ComplexTaskSpec[] = TWO_TASKS,
	options: Parameters<typeof complexPlanFor>[1] & { files?: FakeFiles } = {},
) {
	const files = options.files ?? new FakeFiles({ "src/app.ts": "app\n", "src/util.ts": "util\n" });
	const { plan, parent } = await complexPlanFor(specs, { ...options, files });
	return complexHarness({
		plan,
		parent,
		files,
		...(options.risk ? { risk: options.risk } : {}),
		...(options.goal ? { goal: options.goal } : {}),
		...(options.executionMode ? { executionMode: options.executionMode } : {}),
	});
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((fulfill) => {
		resolve = fulfill;
	});
	return { promise, resolve };
}

function row(run: Run, index: number) {
	const value = run.complex?.tasks[index];
	if (!value) throw new Error("missing COMPLEX row");
	return value;
}

function taskOf(request: AgentExecutionRequest): string | null {
	return request.complexContext?.taskId ?? null;
}

describe("COMPLEX positive controls", () => {
	it("runs two tasks sequentially, then integration, and completes once with one global budget", async () => {
		const h = await harness();
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(run.complex).toMatchObject({
			phase: "TERMINAL",
			activeTaskIds: [],
			cleanup: "CONFIRMED",
			partialChanges: false,
			changesUnknown: false,
			failureCode: null,
			integration: { check: "PASS", review: "PASS", test: "PASS", evidenceFreshness: "CURRENT", failureCode: null },
		});
		// C40: task 1's PASS history went STALE after task 2 changed the workspace; integration ran fresh.
		expect(run.complex?.tasks.map((item) => [item.status, item.attempt, item.evidenceFreshness])).toEqual([
			["COMPLETED", 1, "STALE"],
			["COMPLETED", 1, "CURRENT"],
		]);
		expect(run.complex?.integration.workspaceDigest).toBe(h.files.digest);
		expect(run.tasks).toHaveLength(1);
		expect(run.tasks[0].status).toBe("completed");
		expect(run.completed).toEqual([run.tasks[0].id]);
		expect(h.calls.map((request) => [request.role, taskOf(request)])).toEqual([
			["Developer", "CT-001"],
			["Reviewer", "CT-001"],
			["Developer", "CT-002"],
			["Reviewer", "CT-002"],
			["Reviewer", null],
		]);
		// The parent stays unchanged beside the bounded task input; other tasks' claims are "not yours".
		expect(h.calls[2].task).toEqual({ ...run.tasks[0], status: "inProgress" });
		expect(h.calls[2].complexTask?.otherClaims).toEqual([
			{ taskId: "CT-001", path: "src/app.ts", operation: "modify" },
		]);
		// One global ledger: 2 per task plus the unattributed final Reviewer.
		expect(run.budget).toMatchObject({ workerInvocations: 5, reportedTokens: 500, exceeded: false });
		expect(run.complex?.tasks.map((item) => [item.workerInvocations, item.reportedTokens])).toEqual([
			[2, 200],
			[2, 200],
		]);
		expect(run.workerMeasurements?.every((item) => item.complexContext !== undefined)).toBe(true);
		expect(run.roleSessionRefs.every((ref) => ref.complexContext !== undefined)).toBe(true);
		expect(run.complexEvidence).toHaveLength(3);
		expect(run.complexReviews?.map((review) => review.complexContext.taskId)).toEqual(["CT-001", "CT-002"]);
		expect(run.review && "criteria" in run.review ? run.review.complexContext : undefined).toEqual(
			contextOf(run, null),
		);
		// C24 positive: the same check ID in two tasks never collides.
		const refs = run.verification.filter((check) => check.id === "test").map((check) => check.evidenceRefs[0]);
		expect(new Set(refs).size).toBe(refs.length);
		expect(refs).toContain("check:run-1:CT-001:self-check:1:test");
		expect(refs).toContain("check:run-1:CT-002:self-check:1:test");
		expect(refs).toContain("check:run-1:integration:test:1:test");
		// Verifier ran exactly the task subset, then the complete frozen list for integration.
		expect(run.verification.map((check) => [check.complexContext?.taskId ?? "integration", check.id])).toEqual([
			["CT-001", "test"],
			["CT-001", "test"],
			["CT-002", "test"],
			["CT-002", "test"],
			["integration", "lint"],
			["integration", "test"],
			["integration", "lint"],
			["integration", "test"],
		]);
		// No new event type; lifecycle events bind the plan, step events carry the task context.
		expect(h.events.every((event) => EXISTING_EVENTS.has(event.type))).toBe(true);
		for (const event of h.events) {
			if (event.type.startsWith("Run")) {
				expect("complexBinding" in event && event.complexBinding).toEqual({
					parentTaskContractDigest: run.complex?.plan.parentTaskContractDigest,
					complexPlanDigest: run.complex?.plan.complexPlanDigest,
				});
				expect("complexContext" in event).toBe(false);
			} else expect("complexContext" in event && event.complexContext).toBeTruthy();
			expect(event.taskId).toBe(run.tasks[0].id);
		}
		expect(h.events.at(-1)?.type).toBe("RunCompleted");
		// ELIGIBLE is a persisted scheduling decision before any worker, for every task.
		expect(h.saved.some((snapshot) => snapshot.complex?.tasks[0].status === "ELIGIBLE")).toBe(true);
		expect(
			h.saved.some(
				(snapshot) =>
					snapshot.complex?.tasks[0].status === "COMPLETED" && snapshot.complex.tasks[1].status === "ELIGIBLE",
			),
		).toBe(true);
	});

	it("runs eight tasks within the 24-invocation ceiling", async () => {
		const specs = Array.from({ length: 8 }, (_, index) => ({
			claims: [{ path: `src/file-${index + 1}.ts`, operation: "create" as const }],
		}));
		const h = await harness(specs);
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(run.complex?.tasks.every((item) => item.status === "COMPLETED")).toBe(true);
		expect(run.budget?.workerInvocations).toBe(17);
		expect(run.complexEvidence).toHaveLength(9);
	});

	it("allows one permitted local revision with a fresh attempt, sessions and evidence", async () => {
		const h = await harness();
		let reviews = 0;
		h.ports.agents.execute = async (request) => {
			if (request.role === "Reviewer" && taskOf(request) === "CT-001" && reviews++ === 0) {
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
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(row(run, 0)).toMatchObject({ attempt: 2, revisionCycle: 1, workerInvocations: 4 });
		expect(run.revisionCycle).toBe(1);
		const second = h.calls.find((request) => request.role === "Developer" && request.complexContext?.attempt === 2);
		expect(second?.step).toEqual({ stepId: "implement", attempt: 2 });
		// `revision` is the captured global work cycle, which the accepted REVISE advanced.
		expect(second?.revision).toBe(1);
		expect(second?.complexTask?.previousReview).toMatchObject({ result: "REVISE", complexContext: { attempt: 1 } });
		expect(
			run.complexEvidence?.map((record) => [record.complexContext.taskId, record.complexContext.attempt]),
		).toEqual([
			["CT-001", 1],
			["CT-001", 2],
			["CT-002", 1],
			[null, 1],
		]);
		expect(new Set(run.roleSessionRefs.map((ref) => ref.sessionId)).size).toBe(run.roleSessionRefs.length);
	});

	it("completes a genuine READ_ONLY decomposition without claims or changes", async () => {
		const h = await harness([{ claims: [] }, { claims: [] }], {
			goal: "Explain the architecture across multiple modules",
			executionMode: "READ_ONLY",
		});
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(run.complex?.tasks.map((item) => item.changedFiles)).toEqual([[], []]);
		expect(run.workspace?.changedFiles).toEqual([]);
	});
});

describe("COMPLEX task failures (C01–C07, C21, C24, C28, C29)", () => {
	it("C01: a failing Developer fails the task and Run, blocks every later task, and never integrates", async () => {
		const h = await harness();
		h.ports.agents.execute = async (request) => {
			h.calls.push(request);
			await h.register(request);
			throw new Error("provider exploded");
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("FAILED");
		expect(run.complex).toMatchObject({ phase: "TERMINAL", cleanup: "CONFIRMED", failureCode: "WORKER_FAILED" });
		expect(run.complex?.tasks.map((item) => [item.status, item.failureCode])).toEqual([
			["FAILED", "WORKER_FAILED"],
			["BLOCKED", "DEPENDENCY_NOT_COMPLETED"],
		]);
		expect(run.complex?.integration.check).toBe("NOT_RUN");
		expect(h.saved.some((snapshot) => snapshot.complex?.phase === "STOPPING")).toBe(true);
		expect(h.events.map((event) => event.type).slice(-3)).toEqual(["AgentFailed", "StepFailed", "RunFailed"]);
		expect(h.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});

	it("C02: a predecessor that is not COMPLETED blocks its successor even when its output file exists", async () => {
		const h = await harness([
			{ claims: [{ path: "src/new.ts", operation: "create" }] },
			{ claims: [{ path: "src/app.ts", operation: "modify" }] },
		]);
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
		expect(h.files.files.has("src/new.ts")).toBe(true);
		expect(h.calls.some((request) => taskOf(request) === "CT-002")).toBe(false);
		expect(run.complex?.tasks.map((item) => [item.status, item.failureCode, item.selfCheck])).toEqual([
			["BLOCKED", "CHECK_FAILED", "FAIL"],
			["BLOCKED", "DEPENDENCY_NOT_COMPLETED", "NOT_RUN"],
		]);
		expect(row(run, 0).changedFiles).toEqual(["src/new.ts"]);
		expect(run.complex?.partialChanges).toBe(true);
	});

	it.each([
		["C03", "src/app.ts", "OWNERSHIP_CONFLICT"],
		["C04", "src/util.ts", "UNOWNED_PATH"],
	] as const)("%s: task 2 writing %s is denied before any effect (%s)", async (_row, path, code) => {
		const h = await harness();
		h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer" || taskOf(request) !== "CT-002") return h.defaultExecute(request);
			h.calls.push(request);
			await h.register(request);
			request.ownership?.authorize(path, "replace");
			h.files.write(path, "SHOULD NOT HAPPEN");
			throw new Error("unreachable");
		};
		const before = h.files.files.get(path);
		const kernel = await h.create();
		const run = await driveComplex(kernel);
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.failureCode).toBe(code);
		expect(row(run, 1)).toMatchObject({ status: "BLOCKED", failureCode: code });
		expect(row(run, 0).status).toBe("COMPLETED");
		expect(h.files.files.get(path)).toEqual(path === "src/app.ts" ? { content: "CT-001@1\n", mode: 0o644 } : before);
		expect(run.approvals ?? []).toEqual([]);
		expect(h.calls.filter((request) => taskOf(request) === "CT-002")).toHaveLength(1);
	});

	it("C04: a bypass mutation of an unclaimed file is caught by the expected-image ledger", async () => {
		const h = await harness();
		h.ports.agents.execute = async (request) => {
			if (request.role === "Developer" && taskOf(request) === "CT-001") h.files.write("src/util.ts", "bypass\n");
			return h.defaultExecute(request);
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(row(run, 0)).toMatchObject({ status: "BLOCKED", failureCode: "EXTERNAL_MUTATION", changesUnknown: true });
		expect(h.files.files.get("src/util.ts")?.content).toBe("bypass\n");
		expect(run.workspace?.changedFiles).toContain("src/util.ts");
	});

	it("C05: an old check digest substituted after mutation is STALE_EVIDENCE, never task success", async () => {
		const h = await harness();
		const baseline = h.files.digest;
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			const result = await verify(request);
			if (request.complexContext?.taskId === "CT-001" && request.step.stepId === "test") {
				result.diffDigest = baseline;
				for (const check of result.checks) check.diffDigest = baseline;
			}
			return result;
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(row(run, 0)).toMatchObject({ status: "BLOCKED", failureCode: "STALE_EVIDENCE", test: "STALE" });
		expect(h.calls.some((request) => taskOf(request) === "CT-002")).toBe(false);
	});

	it.each(["digest", "attempt"])("C06: a task review from another %s is STALE_EVIDENCE", async (mode) => {
		const h = await harness();
		h.ports.agents.execute = async (request) => {
			if (request.role !== "Reviewer" || taskOf(request) !== "CT-001") return h.defaultExecute(request);
			h.calls.push(request);
			await h.register(request);
			const contribution = h.contribution(request);
			const context = contribution.complexContext;
			if (mode === "digest") contribution.diffDigest = "0".repeat(64);
			else if (context.scope === "TASK") contribution.complexContext = { ...context, attempt: 2 };
			return { role: "Reviewer", contribution, measurement: measurement(request) };
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(row(run, 0)).toMatchObject({ status: "BLOCKED", failureCode: "STALE_EVIDENCE", review: "STALE" });
		expect(row(run, 0).test).toBe("NOT_RUN");
	});

	it.each(["reused", "missing"])("C07: a %s Reviewer session is REVIEW_MISSING", async (mode) => {
		const h = await harness();
		h.ports.agents.execute = async (request) => {
			if (request.role !== "Reviewer" || taskOf(request) !== "CT-001") return h.defaultExecute(request);
			h.calls.push(request);
			if (mode === "reused") await h.register(request, "Developer-1");
			return { role: "Reviewer", contribution: h.contribution(request), measurement: measurement(request) };
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(row(run, 0)).toMatchObject({ failureCode: "REVIEW_MISSING", review: "UNAVAILABLE" });
	});

	it("C21: earlier task changes remain honest partial changes when a later task fails", async () => {
		const h = await harness();
		h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer" || taskOf(request) !== "CT-002") return h.defaultExecute(request);
			h.calls.push(request);
			await h.register(request);
			await h.develop(request);
			throw new Error("tool I/O failed after a permitted effect");
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("FAILED");
		expect(run.complex).toMatchObject({ partialChanges: true, changesUnknown: false });
		expect(row(run, 0).status).toBe("COMPLETED");
		expect(row(run, 1)).toMatchObject({ status: "FAILED", changedFiles: ["src/new.ts"], changesUnknown: false });
		expect(run.workspace?.changedFiles).toEqual(["src/app.ts", "src/new.ts"]);
	});

	it("C24: evidence copied from another task with an identical check ID is rejected", async () => {
		const h = await harness();
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			const result = await verify(request);
			if (request.complexContext?.taskId === "CT-002")
				result.checks[0].evidenceRefs = [`check:${request.runId}:CT-001:${request.step.stepId}:1:test`];
			return result;
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(row(run, 1)).toMatchObject({ status: "BLOCKED", failureCode: "STALE_EVIDENCE", selfCheck: "STALE" });
	});

	it("C28: SELF_CHECK FAIL blocks with the STANDARD repair flag requested; no hidden repair cycle", async () => {
		const h = await harness();
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			const result = await verify(request);
			result.checks[0] = {
				...result.checks[0],
				status: "FAIL",
				exitCode: 1,
				failureKind: "COMMAND_NONZERO",
			};
			return result;
		};
		const run = await driveComplex(await h.create({ verificationRepairMode: "self-check-once" }));
		expect(h.invariantErrors).toEqual([]);
		expect(run.verificationRepair).toEqual({ mode: "disabled", attempts: [] });
		expect(run.status).toBe("BLOCKED");
		expect(row(run, 0)).toMatchObject({ failureCode: "CHECK_FAILED", selfCheck: "FAIL" });
		expect(run.revisionCycle).toBe(0);
		expect(h.events.some((event) => event.type === "VerificationRepairScheduled")).toBe(false);
	});

	it("C29: a task TEST that mutates the workspace blocks and keeps the changed bytes", async () => {
		const h = await harness();
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			if (request.complexContext?.taskId === "CT-001" && request.step.stepId === "test")
				h.files.write("src/util.ts", "written by a check\n");
			return verify(request);
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(row(run, 0)).toMatchObject({ failureCode: "STALE_EVIDENCE", test: "STALE", changesUnknown: true });
		expect(h.files.files.get("src/util.ts")?.content).toBe("written by a check\n");
		expect(h.calls.some((request) => taskOf(request) === "CT-002")).toBe(false);
	});
});

describe("COMPLEX integration, completion and guards (C08, C09, C11, C30, C36, C37, C40, C41)", () => {
	it("C08: an integration check FAIL after all task successes blocks and keeps task history", async () => {
		const h = await harness();
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			const result = await verify(request);
			if (request.complexContext?.scope === "INTEGRATION")
				result.checks[1] = { ...result.checks[1], status: "FAIL", exitCode: 1 };
			return result;
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.tasks.map((item) => item.status)).toEqual(["COMPLETED", "COMPLETED"]);
		expect(run.complex?.integration).toMatchObject({ check: "FAIL", failureCode: "CHECK_FAILED" });
		expect(run.tasks[0].status).toBe("blocked");
		expect(h.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});

	it("C09: completion cannot be requested before integration, and the guard rejects missing integration", async () => {
		const h = await harness();
		const kernel = await h.create();
		await kernel.start();
		const writes = h.saved.length;
		await expect(kernel.advance("complete")).rejects.toThrow("Invalid transition");
		await expect(kernel.advance("self-check")).rejects.toThrow("Invalid transition");
		expect(h.saved).toHaveLength(writes);
		const run = kernel.snapshot;
		expect(() =>
			assertCanCompleteComplex({
				run,
				plan: h.request().complexPlan!,
				checks: h.checks,
				liveDigest: h.files.digest,
				liveChangedFiles: [],
				ledgerDigest: h.files.digest,
				resourcesConfirmed: true,
			}),
		).toThrow("lacks validated local success");
	});

	it("C11: a final review citing prose instead of registered evidence cannot complete", async () => {
		const h = await harness();
		h.ports.agents.execute = async (request) => {
			if (request.role !== "Reviewer" || request.complexContext?.scope !== "INTEGRATION")
				return h.defaultExecute(request);
			h.calls.push(request);
			await h.register(request);
			const review = h.finalReview(request);
			review.criteria[0].evidenceRefs = ["worker says it passes"];
			return { role: "Reviewer", review, measurement: measurement(request) };
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.integration).toMatchObject({ review: "STALE", failureCode: "STALE_EVIDENCE" });
	});

	it("C11: a contribution PASS without every mapped criterion SUPPORTED is rejected", async () => {
		const h = await harness();
		h.ports.agents.execute = async (request) => {
			if (request.role !== "Reviewer" || taskOf(request) !== "CT-001") return h.defaultExecute(request);
			h.calls.push(request);
			await h.register(request);
			const contribution = h.contribution(request);
			contribution.criteria[0].status = "UNVERIFIED";
			return { role: "Reviewer", contribution, measurement: measurement(request) };
		};
		const run = await driveComplex(await h.create());
		expect(row(run, 0)).toMatchObject({ status: "BLOCKED", failureCode: "INVALID_RESULT" });
	});

	it("C30: a final TEST that changes the reviewed digest is STALE_EVIDENCE", async () => {
		const h = await harness();
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			if (request.complexContext?.scope === "INTEGRATION" && request.step.stepId === "test")
				h.files.write("src/app.ts", "changed during final test\n");
			return verify(request);
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.integration).toMatchObject({ test: "STALE", failureCode: "STALE_EVIDENCE" });
	});

	it("C37: an old integration capture supplied as the final TEST is rejected", async () => {
		const h = await harness();
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			if (request.complexContext?.scope === "INTEGRATION" && request.step.stepId === "test")
				return verify({ ...request, step: { stepId: "self-check", attempt: 1 } });
			return verify(request);
		};
		const run = await driveComplex(await h.create());
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.integration).toMatchObject({ test: "STALE", failureCode: "STALE_EVIDENCE" });
	});

	it.each(["REVISE", "BLOCK", "UNVERIFIED"] as const)(
		"C41: final Reviewer %s blocks with no hidden integration repair",
		async (mode) => {
			const h = await harness();
			h.ports.agents.execute = async (request) => {
				if (request.role !== "Reviewer" || request.complexContext?.scope !== "INTEGRATION")
					return h.defaultExecute(request);
				h.calls.push(request);
				await h.register(request);
				const review = h.finalReview(request, mode === "UNVERIFIED" ? "PASS" : mode);
				if (mode === "UNVERIFIED") review.criteria[1].status = "UNVERIFIED";
				return { role: "Reviewer", review, measurement: measurement(request) };
			};
			const run = await driveComplex(await h.create());
			expect(h.invariantErrors).toEqual([]);
			expect(run.status).toBe("BLOCKED");
			expect(run.complex?.integration).toMatchObject({
				review: mode === "UNVERIFIED" ? "UNAVAILABLE" : mode,
				failureCode: "REVIEW_BLOCKED",
			});
			expect(h.calls.filter((request) => request.role === "Developer")).toHaveLength(2);
			expect(run.review?.result).toBe(mode === "UNVERIFIED" ? "PASS" : mode);
		},
	);

	it("C36: a tampered plan or another parent is refused at Run creation", async () => {
		const h = await harness();
		const tampered = structuredClone(h.request().complexPlan!);
		tampered.tasks[0].title = "Changed after confirmation";
		await expect(h.create({ complexPlan: tampered })).rejects.toMatchObject({ code: "PLAN_MISMATCH" });
		const other = { ...h.request().task, goal: "Another parent goal across multiple modules" };
		await expect(h.create({ task: other })).rejects.toBeInstanceOf(ComplexPlanBindingError);
		await expect(h.create({ task: other })).rejects.toMatchObject({ code: "PARENT_MISMATCH" });
		await expect(h.create({ workflow: "STANDARD" })).rejects.toThrow("requires the COMPLEX workflow");
		expect(h.saved).toHaveLength(0);
	});
});

describe("COMPLEX budget and revisions (C12, C13, C31)", () => {
	it("C12: the invocation cap blocks before the next worker", async () => {
		const h = await harness(TWO_TASKS, { config: complexConfig({ budget: { max_worker_invocations: 3 } }) });
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(h.calls).toHaveLength(3);
		expect(row(run, 1)).toMatchObject({ failureCode: "BUDGET_EXHAUSTED", review: "NOT_RUN", workerInvocations: 1 });
		expect(run.budget).toMatchObject({ workerInvocations: 3, exceeded: true });
	});

	it("C12: a settled token overage blocks the next worker", async () => {
		const h = await harness(TWO_TASKS, { config: complexConfig({ budget: { max_reported_tokens: 250 } }) });
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(h.calls).toHaveLength(3);
		expect(row(run, 1).failureCode).toBe("BUDGET_EXHAUSTED");
	});

	it("C12: an overage settled by the last Reviewer still blocks completion", async () => {
		const h = await harness(TWO_TASKS, { config: complexConfig({ budget: { max_reported_tokens: 450 } }) });
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(h.calls).toHaveLength(5);
		expect(run.complex?.integration).toMatchObject({ review: "PASS", test: "PASS", failureCode: "BUDGET_EXHAUSTED" });
		expect(h.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});

	it("uses exactly the last permitted invocation and still completes", async () => {
		const h = await harness(TWO_TASKS, { config: complexConfig({ budget: { max_worker_invocations: 5 } }) });
		const run = await driveComplex(await h.create());
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(run.budget).toMatchObject({ workerInvocations: 5, exceeded: false });
	});

	it.each(["task", "last"])(
		"C31: unknown usage (%s worker) blocks before the next worker or completion",
		async (mode) => {
			const h = await harness();
			h.ports.agents.execute = async (request) => {
				const result = await h.defaultExecute(request);
				const unmeasured =
					mode === "task"
						? request.role === "Developer" && taskOf(request) === "CT-002"
						: request.complexContext?.scope === "INTEGRATION";
				return unmeasured ? ({ ...result, measurement: undefined } as AgentExecutionResult) : result;
			};
			const run = await driveComplex(await h.create());
			expect(h.invariantErrors).toEqual([]);
			expect(run.status).toBe("BLOCKED");
			expect(run.budget?.reportedTokens).toBeNull();
			if (mode === "task") {
				expect(row(run, 1)).toMatchObject({ failureCode: "BUDGET_UNKNOWN", reportedTokens: null });
				expect(h.calls).toHaveLength(3);
			} else expect(run.complex?.integration.failureCode).toBe("BUDGET_UNKNOWN");
		},
	);

	it("C13: REVISE beyond the local cap is REVISION_LIMIT with no extra attempt", async () => {
		const h = await harness();
		h.ports.agents.execute = async (request) => {
			if (request.role !== "Reviewer" || taskOf(request) !== "CT-001") return h.defaultExecute(request);
			h.calls.push(request);
			await h.register(request);
			return {
				role: "Reviewer",
				contribution: h.contribution(request, "REVISE"),
				measurement: measurement(request),
			};
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(row(run, 0)).toMatchObject({
			status: "BLOCKED",
			failureCode: "REVISION_LIMIT",
			attempt: 3,
			revisionCycle: 2,
			review: "REVISE",
		});
		expect(h.calls.filter((request) => request.role === "Developer")).toHaveLength(3);
		expect(run.revisionCycle).toBe(2);
	});

	it("C13: REVISE beyond the total cap is REVISION_LIMIT even with local allowance left", async () => {
		const h = await harness(TWO_TASKS, { config: complexConfig({ maxRevisionCycles: 1 }) });
		const revised = new Set<string>();
		h.ports.agents.execute = async (request) => {
			const task = taskOf(request);
			if (request.role !== "Reviewer" || !task || revised.has(task)) return h.defaultExecute(request);
			revised.add(task);
			h.calls.push(request);
			await h.register(request);
			return {
				role: "Reviewer",
				contribution: h.contribution(request, "REVISE"),
				measurement: measurement(request),
			};
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(row(run, 0)).toMatchObject({ status: "COMPLETED", attempt: 2, revisionCycle: 1 });
		expect(row(run, 1)).toMatchObject({ status: "BLOCKED", failureCode: "REVISION_LIMIT", attempt: 1 });
		expect(run.revisionCycle).toBe(1);
	});
});

describe("COMPLEX cancellation, cleanup and persistence (C14, C15, C32, C33, C34, C35, C42)", () => {
	it("C14/C35: cancel during implementation ignores the late PASS and rejects concurrent advances", async () => {
		const h = await harness();
		const entered = deferred<void>();
		const release = deferred<void>();
		let late: AgentExecutionRequest | undefined;
		h.ports.agents.execute = async (request) => {
			h.calls.push(request);
			await h.register(request);
			late = request;
			entered.resolve();
			await release.promise;
			return { role: "Developer", handoff: await h.develop(request), measurement: measurement(request) };
		};
		const kernel = await h.create();
		await kernel.start();
		const controller = new AbortController();
		const pending = kernel.advance("implement", controller.signal);
		await entered.promise;
		await expect(kernel.advance("implement")).rejects.toThrow("Invalid transition");
		controller.abort();
		release.resolve();
		const run = await pending;
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("CANCELLED");
		expect(run.complex?.tasks.map((item) => [item.status, item.failureCode])).toEqual([
			["CANCELLED", "CANCELLED"],
			["CANCELLED", "CANCELLED"],
		]);
		expect(run.complex?.cleanup).toBe("CONFIRMED");
		expect(h.events.some((event) => event.type === "AgentCompleted")).toBe(false);
		expect(h.events.at(-1)?.type).toBe("RunCancelled");
		// The capability closed when the invocation settled: a late callback can neither authorize nor record.
		expect(() => late?.ownership?.authorize("src/app.ts", "replace")).toThrow("closed");
		expect(h.calls).toHaveLength(1);
	});

	it.each(["task", "final"])("C15: cancel during the %s review publishes no PASS and no completion", async (mode) => {
		const h = await harness();
		const controller = new AbortController();
		h.ports.agents.execute = async (request) => {
			const target =
				request.role === "Reviewer" &&
				(mode === "task" ? taskOf(request) === "CT-001" : request.complexContext?.scope === "INTEGRATION");
			const result = await h.defaultExecute(request);
			if (target) controller.abort();
			return result;
		};
		const kernel = await h.create();
		await kernel.start();
		while (kernel.snapshot.status === "RUNNING" && !controller.signal.aborted)
			await kernel.advance(kernel.snapshot.currentStep!.stepId, controller.signal);
		const run = kernel.snapshot;
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("CANCELLED");
		if (mode === "task") expect(row(run, 0)).toMatchObject({ status: "CANCELLED", review: "UNAVAILABLE" });
		else expect(run.complex?.integration.review).toBe("UNAVAILABLE");
		expect(
			h.events.some(
				(event) =>
					event.type === "ReviewPassed" &&
					event.complexContext?.scope === (mode === "task" ? "TASK" : "INTEGRATION"),
			),
		).toBe(false);
		expect(run.budget?.workerInvocations).toBe(mode === "task" ? 2 : 5);
	});

	it("C32: cancel during integration checks leaves no running gate and no completion", async () => {
		const h = await harness();
		const controller = new AbortController();
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			if (request.complexContext?.scope === "INTEGRATION") controller.abort();
			return verify(request);
		};
		const kernel = await h.create();
		await kernel.start();
		while (kernel.snapshot.status === "RUNNING")
			await kernel.advance(kernel.snapshot.currentStep!.stepId, controller.signal);
		const run = kernel.snapshot;
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("CANCELLED");
		expect(run.complex?.integration).toMatchObject({ check: "UNAVAILABLE", failureCode: "CANCELLED" });
		expect(run.complex?.tasks.map((item) => item.status)).toEqual(["COMPLETED", "COMPLETED"]);
	});

	it("C42: a cancel racing the final successful task check wins before success; spend is recorded once", async () => {
		const h = await harness();
		const controller = new AbortController();
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			const result = await verify(request);
			if (request.complexContext?.taskId === "CT-001" && request.step.stepId === "test") controller.abort();
			return result;
		};
		const kernel = await h.create();
		await kernel.start();
		while (kernel.snapshot.status === "RUNNING")
			await kernel.advance(kernel.snapshot.currentStep!.stepId, controller.signal);
		const run = kernel.snapshot;
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("CANCELLED");
		expect(row(run, 0)).toMatchObject({ status: "CANCELLED", test: "UNAVAILABLE" });
		expect(row(run, 1).status).toBe("CANCELLED");
		expect(run.budget?.workerInvocations).toBe(2);
		expect(h.calls.some((request) => taskOf(request) === "CT-002")).toBe(false);
	});

	it("C33: unconfirmed cleanup is INTERRUPTED with cleanup UNCONFIRMED, never a clean terminal", async () => {
		const h = await harness();
		h.settlement.lsp = false;
		h.ports.agents.execute = async (request) => {
			await h.register(request);
			throw new Error("worker died");
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("INTERRUPTED");
		expect(run.complex).toMatchObject({
			cleanup: "UNCONFIRMED",
			failureCode: "CLEANUP_UNCONFIRMED",
			changesUnknown: true,
			partialChanges: true,
		});
		expect(row(run, 0)).toMatchObject({ status: "INTERRUPTED", failureCode: "CLEANUP_UNCONFIRMED" });
	});

	it("C33: completion refuses unconfirmed cleanup", async () => {
		const h = await harness();
		const kernel = await h.create();
		await driveComplex(kernel, (run) => run.complex?.phase === "COMPLETING");
		h.settlement.agents = false;
		const run = await driveComplex(kernel);
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("INTERRUPTED");
		expect(run.complex?.cleanup).toBe("UNCONFIRMED");
		expect(h.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});

	it("C34: a failed completion write emits no RunCompleted and leaves the older durable snapshot", async () => {
		const h = await harness();
		const kernel = await h.create();
		await driveComplex(kernel, (run) => run.complex?.phase === "COMPLETING");
		h.control.failWhen = (run) => run.status === "COMPLETED";
		await expect(kernel.advance("complete")).rejects.toThrow("disk full");
		expect(kernel.snapshot.status).toBe("FAILED");
		expect(h.saved.at(-1)?.status).toBe("RUNNING");
		expect(h.saved.at(-1)?.complex?.phase).toBe("COMPLETING");
		expect(h.events.some((event) => event.type === "RunCompleted")).toBe(false);
		await expect(kernel.advance("complete")).rejects.toThrow("Invalid transition");
	});

	it("fails a malformed worker measurement honestly, keeping the spend as unknown usage", async () => {
		const h = await harness();
		h.ports.agents.execute = async (request) => {
			const result = await h.defaultExecute(request);
			return request.role === "Developer" && result.measurement
				? { ...result, measurement: { ...result.measurement, durationMs: -1 } }
				: result;
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("FAILED");
		expect(row(run, 0)).toMatchObject({
			status: "FAILED",
			failureCode: "INVALID_RESULT",
			reportedTokens: null,
			workerInvocations: 1,
			changedFiles: ["src/app.ts"],
		});
		expect(run.budget).toMatchObject({ workerInvocations: 1, reportedTokens: null });
	});

	it("stops at a step boundary: cancel settles every unfinished row", async () => {
		const h = await harness();
		const kernel = await h.create();
		await driveComplex(kernel, (run) => run.complex?.tasks[1].status === "ELIGIBLE");
		const run = await kernel.stop("CANCELLED", "User cancelled");
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("CANCELLED");
		expect(run.complex?.tasks.map((item) => item.status)).toEqual(["COMPLETED", "CANCELLED"]);
		expect(run.complex?.partialChanges).toBe(true);
	});
});

describe("COMPLEX external mutation and admission (C20)", () => {
	it.each(["file", "head"])("C20: an external %s mutation between tasks is EXTERNAL_MUTATION", async (mode) => {
		const h = await harness();
		const kernel = await h.create();
		await driveComplex(kernel, (run) => run.complex?.tasks[1].status === "ELIGIBLE");
		if (mode === "file") h.files.write("src/util.ts", "external\n");
		else h.files.head = "head-1";
		const run = await driveComplex(kernel);
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(row(run, 1)).toMatchObject({ status: "BLOCKED", failureCode: "EXTERNAL_MUTATION", attempt: 0 });
		expect(row(run, 0).status).toBe("COMPLETED");
		expect(h.calls.some((request) => taskOf(request) === "CT-002")).toBe(false);
	});

	it("refuses to start without live capture, settlement or a clean baseline", async () => {
		const missing = await harness();
		const { images: _images, ...verifier } = missing.ports.verifier;
		const kernel = await CompanyKernel.create(missing.request(), { ...missing.ports, verifier });
		const run = await kernel.start();
		expect(missing.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.failureCode).toBe("RUN_STOPPED");
		const { resources: _resources, ...unsettled } = missing.ports;
		const unconfirmed = await (
			await CompanyKernel.create({ ...missing.request(), runId: "run-2" }, unsettled)
		).start();
		expect(unconfirmed.status).toBe("INTERRUPTED");
		expect(unconfirmed.complex?.cleanup).toBe("UNCONFIRMED");
		const dirty = await harness();
		dirty.files.write("src/util.ts", "dirty\n");
		const blocked = await (await dirty.create()).start();
		expect(blocked.status).toBe("BLOCKED");
		expect(blocked.complex?.failureCode).toBe("EXTERNAL_MUTATION");
		expect(dirty.calls).toHaveLength(0);
	});
});

describe("COMPLEX R3 single deletion (C16, C17, C18, C32, C39)", () => {
	const GOAL = "Delete file src/obsolete.ts";
	const grant = (request: ApprovalRequest, approved = true): ApprovalDecision => ({
		runId: request.runId,
		actionId: request.actionId,
		actionDigest: request.actionDigest,
		configDigest: request.configDigest,
		expiresAt: request.expiresAt,
		approved,
	});
	/** CT-001 requests the one exact Approval, deletes through its capability, consumes; CT-002 is read-only. */
	async function r3(answer: (request: ApprovalRequest) => Promise<ApprovalDecision> | undefined) {
		const files = new FakeFiles({ "src/obsolete.ts": "old\n", "src/app.ts": "app\n" });
		const h = await harness(
			[
				{ claims: [{ path: "src/obsolete.ts", operation: "delete" }], criteria: [1] },
				{ claims: [], criteria: [1] },
			],
			{ files, goal: GOAL, risk: "R3", statements: ["The obsolete file is removed"] },
		);
		const replays: string[] = [];
		let lateRequest: AgentExecutionRequest | undefined;
		const afterGrant: { hook?: () => void } = {};
		h.ports.approval = {
			requestApproval: (request) => answer(request) ?? new Promise<ApprovalDecision>(() => {}),
		};
		h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer" || taskOf(request) !== "CT-001") return h.defaultExecute(request);
			h.calls.push(request);
			await h.register(request);
			lateRequest = request;
			const proposal = {
				runId: request.runId,
				actionId: "delete-1",
				actionDigest: "action-digest",
				configDigest: "config-digest",
				reason: "Delete the preselected file",
				role: "Developer" as const,
				operation: "delete-file" as const,
				path: "src/obsolete.ts",
				preconditionDigest: "precondition",
				bytes: 4,
				step: structuredClone(request.step),
				revision: request.revision,
				...(request.complexContext ? { complexContext: structuredClone(request.complexContext) } : {}),
			};
			const decision = await request.onApprovalRequested!(proposal, request.signal);
			if (!decision.approved) throw new Error("Human approval refused; deletion was not executed");
			await request.onApprovalRequested!({ ...proposal, actionId: "delete-2" }).catch((error: Error) => {
				replays.push(error.message);
			});
			afterGrant.hook?.();
			request.ownership!.authorize("src/obsolete.ts", "delete");
			files.remove("src/obsolete.ts");
			request.ownership!.recordEffect("src/obsolete.ts", null);
			await request.onApprovalConsumed!("delete-1");
			return {
				role: "Developer",
				handoff: h.handoffFor(request, ["src/obsolete.ts"]),
				measurement: measurement(request),
			};
		};
		return { h, files, replays, afterGrant, late: () => lateRequest };
	}

	it("completes the one exact task deletion followed by a read-only task", async () => {
		const { h, files, replays } = await r3((request) => Promise.resolve(grant(request)));
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(files.files.has("src/obsolete.ts")).toBe(false);
		expect(run.approvals).toEqual([
			expect.objectContaining({
				status: "CONSUMED",
				request: expect.objectContaining({ complexContext: contextOf(run, "CT-001") }),
			}),
		]);
		expect(replays).toEqual(["Approval proposal identity mismatch or replay"]);
		expect(run.complex?.plan.limits.maxTotalRevisionCycles).toBe(0);
		expect(
			h.saved.some(
				(snapshot) =>
					snapshot.status === "WAITING_APPROVAL" && snapshot.complex?.tasks[0].status === "WAITING_APPROVAL",
			),
		).toBe(true);
	});

	it("C16/C18: a pending Approval waits, then expires without deletion or a next task", async () => {
		const { h, files } = await r3(() => undefined);
		const run = await driveComplex(await h.create({ approvalTimeoutMs: 20 }));
		expect(h.invariantErrors).toEqual([]);
		expect(h.saved.some((snapshot) => snapshot.status === "WAITING_APPROVAL")).toBe(true);
		expect(run.status).toBe("BLOCKED");
		expect(row(run, 0)).toMatchObject({ status: "BLOCKED", failureCode: "APPROVAL_EXPIRED" });
		expect(run.approvals?.[0].status).toBe("EXPIRED");
		expect(files.files.has("src/obsolete.ts")).toBe(true);
		expect(h.calls.some((request) => taskOf(request) === "CT-002")).toBe(false);
	});

	it("C17: a human reject blocks without deletion", async () => {
		const { h, files } = await r3((request) => Promise.resolve(grant(request, false)));
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(row(run, 0).failureCode).toBe("APPROVAL_DENIED");
		expect(files.files.has("src/obsolete.ts")).toBe(true);
	});

	it("C18: expiry after the persisted grant but before the effect blocks and cannot be replayed", async () => {
		const { h, files, afterGrant } = await r3((request) => Promise.resolve(grant(request)));
		afterGrant.hook = () => {
			throw new WorkerExecutionError(
				"Deletion target changed or approval expired; action was not executed",
				undefined,
				undefined,
				"APPROVAL_EXPIRED",
			);
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(row(run, 0).failureCode).toBe("APPROVAL_EXPIRED");
		expect(run.approvals?.[0].status).toBe("INTERRUPTED");
		expect(files.files.has("src/obsolete.ts")).toBe(true);
	});

	it("C32: cancel during the Approval wait ends CANCELLED; a late approval cannot reactivate the task", async () => {
		const controller = new AbortController();
		const { h, files, late } = await r3(() => {
			setTimeout(() => controller.abort(), 5);
			return undefined;
		});
		const kernel = await h.create();
		await kernel.start();
		while (kernel.snapshot.status === "RUNNING")
			await kernel.advance(kernel.snapshot.currentStep!.stepId, controller.signal);
		const run = kernel.snapshot;
		expect(h.invariantErrors).toEqual([]);
		expect(run.status).toBe("CANCELLED");
		expect(run.approvals?.[0].status).toBe("CANCELLED");
		expect(files.files.has("src/obsolete.ts")).toBe(true);
		const request = late();
		await expect(
			request!.onApprovalRequested!({
				runId: run.runId,
				actionId: "delete-3",
				actionDigest: "action-digest",
				configDigest: "config-digest",
				reason: "late",
				role: "Developer",
				operation: "delete-file",
				path: "src/obsolete.ts",
				preconditionDigest: "precondition",
				bytes: 4,
				step: { stepId: "implement", attempt: 1 },
				revision: 0,
			}),
		).rejects.toThrow("not available");
	});

	it("C39: a failed consumption save after the deletion keeps the deletion and never replays", async () => {
		const { h, files } = await r3((request) => Promise.resolve(grant(request)));
		h.control.failWhen = (run) => run.approvals?.[0]?.status === "CONSUMED";
		const kernel = await h.create();
		await kernel.start();
		await expect(kernel.advance("implement")).rejects.toThrow("disk full");
		expect(files.files.has("src/obsolete.ts")).toBe(false);
		expect(h.saved.at(-1)).toMatchObject({
			status: "RUNNING",
			approvals: [expect.objectContaining({ status: "APPROVED" })],
		});
		expect(kernel.snapshot.status).toBe("FAILED");
		await expect(kernel.advance("implement")).rejects.toThrow("Invalid transition");
		expect(h.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});
});

describe("closed failure code surface", () => {
	it("keeps the leaf COMPLEX bounds in sync with the Task Contract bounds", () => {
		const criterion = (index: number) => ({
			id: `AC-${String(index + 1).padStart(3, "0")}`,
			statement: "s".repeat(MAX_ACCEPTANCE_STATEMENT_LENGTH),
			scope: { paths: ["src"] },
			verification: { checkIds: ["test"], reviewRequired: true },
		});
		const parent = (count: number) => ({
			id: "parent",
			goal: "goal",
			acceptanceCriteria: Array.from({ length: count }, (_, index) => criterion(index)),
			status: "pending",
		});
		expect(Check(ComplexParentSchema, parent(MAX_ACCEPTANCE_CRITERIA))).toBe(true);
		expect(Check(ComplexParentSchema, parent(MAX_ACCEPTANCE_CRITERIA + 1))).toBe(false);
		const long = parent(1);
		long.acceptanceCriteria[0].statement += "s";
		expect(Check(ComplexParentSchema, long)).toBe(false);
		const id = parent(1);
		id.acceptanceCriteria[0].id = "AC-1";
		expect(Check(ComplexParentSchema, id)).toBe(false);
		expect(new RegExp(ACCEPTANCE_CRITERION_ID_PATTERN).test("AC-001")).toBe(true);
	});

	it("keeps the frozen code list unchanged", () => {
		expect(COMPLEX_FAILURE_CODES).toHaveLength(25);
		expect(new ComplexOwnershipDenied("UNOWNED_PATH", "x").code).toBe("UNOWNED_PATH");
		expect(new WorkerExecutionError("x", undefined, undefined, "POLICY_DENIED").denial).toBe("POLICY_DENIED");
	});
});
