import { describe, expect, it, vi } from "vitest";
import { classifyRequest } from "../src/classification.ts";
import {
	type Handoff,
	type Review,
	type Run,
	STANDARD_STEP_IDS,
	STANDARD_STEP_PHASES,
	type StepId,
	type VerificationResult,
} from "../src/contracts.ts";
import { taskContractDigest } from "../src/criterion-evidence.ts";
import type { RuntimeEvent } from "../src/events.ts";
import { assertCanComplete, CompanyKernel, type CompletionEvidence, type CreateRunRequest } from "../src/kernel.ts";
import type { AgentExecutionRequest, AgentExecutionResult, KernelPorts, VerificationRequest } from "../src/ports.ts";
import { contractOf, testContract } from "./fixture-contract.ts";

function agentResult(request: AgentExecutionRequest, verdict: Review["result"] = "PASS"): AgentExecutionResult {
	if (request.role === "Developer")
		return {
			role: "Developer",
			handoff: {
				runId: request.runId,
				revision: request.revision,
				role: "Developer",
				task: request.task.id,
				changed_files: ["src/login.ts"],
				summary: "Fixed token handling",
				assumptions: [],
				tests_run: [],
				known_risks: [],
				unresolved: [],
			},
		};
	if (request.role !== "Reviewer") throw new Error("STANDARD fixture cannot execute an Executor");
	return {
		role: "Reviewer",
		review: {
			runId: request.runId,
			revision: request.revision,
			role: "Reviewer",
			task: request.task.id,
			result: verdict,
			issues: [],
			criteria: request.task.acceptanceCriteria.map((criterion) => ({
				criterionId: criterion.id,
				status: "MET",
				evidenceRefs: ["diff-proof"],
			})),
			evidenceRefs: ["diff-proof"],
			diffDigest: request.verification.diffDigest,
		},
	};
}

function verificationResult(request: VerificationRequest): VerificationResult {
	return {
		runId: request.runId,
		revision: request.revision,
		step: request.step,
		diffDigest: `diff-${request.revision}`,
		evidenceRefs: ["diff-proof"],
		checks: request.checks.map((check) => ({
			id: check.id,
			kind: check.kind,
			required: check.required,
			runId: request.runId,
			revision: request.revision,
			status: "PASS",
			exitCode: 0,
			reason: "Fake check passed",
			evidenceRefs: [`check-${check.id}`],
			diffDigest: `diff-${request.revision}`,
		})),
	};
}

function fixture() {
	const request: CreateRunRequest = {
		executionMode: "EDIT",
		runId: "run-1",
		task: testContract("Fix login error", {
			taskId: "task-1",
			statements: ["Expired token returns 401"],
			checkIds: ["regression"],
		}),
		classification: classifyRequest("Fix login error").classification,
		checks: [{ id: "regression", kind: "test", required: true }],
	};
	const saved: Run[] = [];
	const events: RuntimeEvent[] = [];
	const agents = { execute: vi.fn<KernelPorts["agents"]["execute"]>(async (request) => agentResult(request)) };
	const verifier = {
		verify: vi.fn<KernelPorts["verifier"]["verify"]>(async (request) => verificationResult(request)),
	};
	const store = {
		load: vi.fn<KernelPorts["store"]["load"]>(async () => undefined),
		save: vi.fn<KernelPorts["store"]["save"]>(async (state) => {
			saved.push(structuredClone(state));
		}),
	};
	const sink = {
		emit: vi.fn<(event: RuntimeEvent) => void | Promise<void>>((event) => {
			events.push(event);
		}),
	};
	const ports = { agents, verifier, store, events: sink } satisfies KernelPorts;
	return {
		request,
		saved,
		events,
		ports,
		agents,
		verifier,
		store,
		sink,
		create: () => CompanyKernel.create(request, ports, () => 1000),
	};
}

function deferredPromise<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((fulfill) => {
		resolve = fulfill;
	});
	return { promise, resolve };
}

async function drive(kernel: CompanyKernel, stopBefore?: StepId): Promise<Run> {
	if (kernel.snapshot.status === "CREATED") await kernel.start();
	for (let count = 0; count < 25 && kernel.snapshot.status === "RUNNING"; count++) {
		const step = kernel.snapshot.currentStep;
		if (!step || step.stepId === stopBefore) break;
		await kernel.advance(step.stepId);
	}
	return kernel.snapshot;
}

describe("STANDARD pure Kernel", () => {
	it("performs the fixed sequence and emits ordered events only after saving state", async () => {
		const f = fixture();
		f.sink.emit.mockImplementation((event) => {
			expect(f.saved.at(-1)?.revision).toBe(event.stateRevision);
			expect(f.saved.at(-1)?.eventSequence).toBeGreaterThanOrEqual(event.sequence);
			f.events.push(event);
		});
		const kernel = await f.create();
		expect(kernel.snapshot).toMatchObject({ status: "CREATED", phase: "PREFLIGHT", currentStep: null });
		await kernel.start();
		for (const stepId of STANDARD_STEP_IDS) {
			expect(kernel.snapshot.currentStep).toEqual({ stepId, attempt: 1 });
			expect(kernel.snapshot.phase).toBe(STANDARD_STEP_PHASES[stepId]);
			await kernel.advance(stepId);
		}
		expect(kernel.snapshot.status).toBe("COMPLETED");
		expect(kernel.snapshot.tasks[0].status).toBe("completed");
		expect(f.agents.execute.mock.calls.map(([request]) => request.role)).toEqual(["Developer", "Reviewer"]);
		expect(f.events.map((event) => event.type)).toEqual([
			"RunCreated",
			"RunStarted",
			"StepStarted",
			"AgentStarted",
			"AgentCompleted",
			"StepCompleted",
			"StepStarted",
			"VerificationStarted",
			"VerificationCompleted",
			"StepCompleted",
			"StepStarted",
			"ReviewRequested",
			"AgentStarted",
			"AgentCompleted",
			"ReviewPassed",
			"StepCompleted",
			"StepStarted",
			"VerificationStarted",
			"VerificationCompleted",
			"StepCompleted",
			"StepStarted",
			"StepCompleted",
			"RunCompleted",
		]);
		expect(f.events.map((event) => event.sequence)).toEqual(f.events.map((_, index) => index + 1));
		for (const event of f.events) {
			expect(event).toMatchObject({ runId: "run-1", taskId: "task-1", timestamp: 1000 });
			if ("step" in event) {
				expect(
					f.saved.some(
						(state) =>
							state.currentStep?.stepId === event.step.stepId &&
							state.currentStep.attempt === event.step.attempt,
					),
				).toBe(true);
				if (event.type === "StepStarted") {
					expect(f.saved.find((state) => state.revision === event.stateRevision)?.currentStep).toEqual(event.step);
				}
			}
		}
	});

	it("returns REVISE to Developer with stable IDs and a new attempt, then completes", async () => {
		const f = fixture();
		f.agents.execute.mockImplementation(async (request) =>
			agentResult(request, request.revision === 0 ? "REVISE" : "PASS"),
		);
		const kernel = await f.create();
		expect((await drive(kernel)).status).toBe("COMPLETED");
		expect(kernel.snapshot.revisionCycle).toBe(1);
		expect(
			f.events.filter((event) => event.type === "StepStarted").map((event) => ("step" in event ? event.step : null)),
		).toEqual([
			{ stepId: "implement", attempt: 1 },
			{ stepId: "self-check", attempt: 1 },
			{ stepId: "review", attempt: 1 },
			{ stepId: "implement", attempt: 2 },
			{ stepId: "self-check", attempt: 2 },
			{ stepId: "review", attempt: 2 },
			{ stepId: "test", attempt: 2 },
			{ stepId: "complete", attempt: 2 },
		]);
		expect(f.agents.execute.mock.calls[2][0]).toMatchObject({
			role: "Developer",
			profile: "coding",
			previousReview: { result: "REVISE", revision: 0 },
		});
		expect(f.events.filter((event) => event.type === "ReviewRevisionRequested")).toHaveLength(1);
	});

	it.each([0, 1, 3])("blocks at revision limit %i without starting another Developer", async (limit) => {
		const f = fixture();
		f.request.maxRevisionCycles = limit;
		f.agents.execute.mockImplementation(async (request) => agentResult(request, "REVISE"));
		const kernel = await f.create();
		expect((await drive(kernel)).status).toBe("BLOCKED");
		expect(kernel.snapshot.lastError).toContain("Revision limit");
		expect(f.agents.execute).toHaveBeenCalledTimes(2 * (limit + 1));
		expect(f.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});

	it("BLOCK stops at review and never runs final verification", async () => {
		const f = fixture();
		f.agents.execute.mockImplementation(async (request) => agentResult(request, "BLOCK"));
		const kernel = await f.create();
		expect((await drive(kernel)).status).toBe("BLOCKED");
		expect(f.verifier.verify).toHaveBeenCalledTimes(1);
		expect(f.events.slice(-3).map((event) => event.type)).toEqual(["ReviewBlocked", "StepCompleted", "RunBlocked"]);
	});

	it("rejects invalid transitions without writes or events", async () => {
		const f = fixture();
		const kernel = await f.create();
		await expect(kernel.advance("implement")).rejects.toThrow("Invalid transition");
		await kernel.start();
		const writes = f.saved.length;
		const events = f.events.length;
		await expect(kernel.start()).rejects.toThrow("Invalid transition");
		await expect(kernel.advance("review")).rejects.toThrow("Invalid transition");
		expect(f.saved).toHaveLength(writes);
		expect(f.events).toHaveLength(events);
		await drive(kernel);
		await expect(kernel.advance("complete")).rejects.toThrow("Invalid transition");
	});

	it("enforces Reviewer for an R2 QUICK request in the abstract workflow", async () => {
		const f = fixture();
		f.request.classification.risk = "R2";
		f.request.workflow = "QUICK";
		f.agents.execute.mockImplementation(async (request) => {
			await request.onSessionCreated?.({
				role: request.role,
				sessionId: `${request.role}-${request.revision}`,
				sessionFile: `/sessions/${request.role}-${request.revision}.jsonl`,
			});
			return agentResult(request);
		});
		const kernel = await CompanyKernel.create(f.request, {
			...f.ports,
			verifier: {
				...f.verifier,
				inspect: async () => ({
					safe: true,
					diffDigest: "diff-0",
					changedFiles: ["src/login.ts"],
					evidenceRefs: ["diff-proof"],
				}),
			},
		});
		expect(kernel.snapshot.workflow).toBe("STANDARD");
		await drive(kernel);
		expect(f.agents.execute.mock.calls.map(([request]) => request.role)).toEqual(["Developer", "Reviewer"]);
		expect(kernel.snapshot.status).toBe("COMPLETED");
	});

	it.each(["QUICK", "COMPLEX", "R3"] as const)("does not enable unsupported execution: %s", async (value) => {
		const f = fixture();
		if (value === "R3") f.request.classification.risk = "R3";
		else f.request.workflow = value;
		if (value === "QUICK") {
			// QUICK now requires live inspection; this S1 fake intentionally cannot supply it.
			f.request.task.goal = "Fix typo in src/login.ts";
			f.request.classification = classifyRequest(f.request.task.goal).classification;
		}
		const kernel = await f.create();
		expect((await kernel.start()).status).toBe("BLOCKED");
		expect(f.agents.execute).not.toHaveBeenCalled();
		expect(f.verifier.verify).not.toHaveBeenCalled();
	});

	it.each(["FAIL", "SKIPPED", "UNAVAILABLE"] as const)(
		"blocks a required %s check and retains its outcome",
		async (status) => {
			const f = fixture();
			f.verifier.verify.mockImplementation(async (request) => {
				const result = verificationResult(request);
				result.checks[0].status = status;
				result.checks[0].exitCode = status === "FAIL" ? 1 : null;
				return result;
			});
			const kernel = await f.create();
			expect((await drive(kernel)).status).toBe("BLOCKED");
			expect(kernel.snapshot.verification[0].status).toBe(status);
			expect(f.agents.execute).toHaveBeenCalledTimes(1);
			expect(f.events.slice(-3).map((event) => event.type)).toEqual([
				"VerificationFailed",
				"StepFailed",
				"RunBlocked",
			]);
		},
	);

	it("rejects omitted checks rather than treating an empty result as success", async () => {
		const f = fixture();
		f.verifier.verify.mockImplementation(async (request) => ({ ...verificationResult(request), checks: [] }));
		expect((await drive(await f.create())).status).toBe("BLOCKED");
	});

	it("allows an unavailable optional check with a reason", async () => {
		const f = fixture();
		f.request.checks = [{ id: "optional", kind: "build", required: false }];
		// The Host maps criteria to required checks only; an optional check stays outside the contract mapping.
		f.request.task = testContract("Fix login error", {
			taskId: "task-1",
			statements: ["Expired token returns 401"],
			checkIds: [],
		});
		f.verifier.verify.mockImplementation(async (request) => {
			const result = verificationResult(request);
			Object.assign(result.checks[0], {
				status: "UNAVAILABLE",
				exitCode: null,
				reason: "No build command",
				evidenceRefs: [],
			});
			return result;
		});
		expect((await drive(await f.create())).status).toBe("COMPLETED");
	});

	it("does not complete when final verification changed the reviewed diff", async () => {
		const f = fixture();
		f.verifier.verify.mockImplementation(async (request) => {
			const result = verificationResult(request);
			if (request.step.stepId === "test") {
				result.diffDigest = "new-diff";
				result.checks.forEach((check) => {
					check.diffDigest = "new-diff";
				});
			}
			return result;
		});
		const kernel = await f.create();
		expect((await drive(kernel)).status).toBe("BLOCKED");
		expect(kernel.snapshot.lastError).toContain("another review");
		expect(f.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});

	it.each(["run", "revision", "step"])("rejects verifier results from another %s", async (field) => {
		const f = fixture();
		f.verifier.verify.mockImplementation(async (request) => {
			const result = verificationResult(request);
			if (field === "run") result.runId = "other";
			if (field === "revision") result.revision++;
			if (field === "step") result.step = { stepId: "test", attempt: 99 };
			return result;
		});
		expect((await drive(await f.create())).status).toBe("BLOCKED");
	});

	it("marks agent exceptions as failure, never completion", async () => {
		const f = fixture();
		f.agents.execute.mockRejectedValue(new Error("Fake agent failed"));
		const kernel = await f.create();
		expect((await drive(kernel)).status).toBe("FAILED");
		expect(f.events.slice(-3).map((event) => event.type)).toEqual(["AgentFailed", "StepFailed", "RunFailed"]);
	});

	it.each(["throw", "reject"])("isolates sink %s from success and failure semantics", async (mode) => {
		for (const failAgent of [false, true]) {
			const f = fixture();
			f.sink.emit.mockImplementation(() => {
				if (mode === "throw") throw new Error("Observer failed");
				return Promise.reject(new Error("Observer failed"));
			});
			if (failAgent) f.agents.execute.mockRejectedValue(new Error("Agent failed"));
			const kernel = await f.create();
			const state = await drive(kernel);
			expect(state.status).toBe(failAgent ? "FAILED" : "COMPLETED");
			expect(kernel.deliveryFailures).toHaveLength(state.eventSequence);
			expect(f.saved.at(-1)?.status).toBe(state.status);
		}
	});

	it("supports an absent sink and isolates mutable snapshot, store and observer copies", async () => {
		const f = fixture();
		f.store.save.mockImplementation(async (state) => {
			contractOf(state).acceptanceCriteria = [];
		});
		const kernel = await CompanyKernel.create(f.request, { ...f.ports, events: undefined });
		contractOf(kernel.snapshot).acceptanceCriteria.length = 0;
		f.request.task.acceptanceCriteria.length = 0;
		expect((await drive(kernel)).status).toBe("COMPLETED");
		expect(contractOf(kernel.snapshot).acceptanceCriteria).toHaveLength(1);
	});

	it("isolates observer and executor mutation from guards", async () => {
		const f = fixture();
		f.sink.emit.mockImplementation((event) => {
			if ("review" in event) event.review.result = "BLOCK";
			if ("step" in event) event.step.attempt = 99;
		});
		f.agents.execute.mockImplementation(async (request) => {
			const result = agentResult(request);
			request.task.acceptanceCriteria = [];
			request.step.attempt = 99;
			return result;
		});
		const kernel = await f.create();
		expect((await drive(kernel)).status).toBe("COMPLETED");
		expect(contractOf(kernel.snapshot)).toMatchObject({
			acceptanceCriteria: [expect.objectContaining({ id: "AC-001", statement: "Expired token returns 401" })],
		});
		expect(kernel.snapshot.currentStep?.attempt).toBe(1);
	});

	it("blocks a failed final check even after Reviewer PASS", async () => {
		const f = fixture();
		f.verifier.verify.mockImplementation(async (request) => {
			const result = verificationResult(request);
			if (request.step.stepId === "test") Object.assign(result.checks[0], { status: "FAIL", exitCode: 1 });
			return result;
		});
		const kernel = await f.create();
		expect((await drive(kernel)).status).toBe("BLOCKED");
		expect(f.events.some((event) => event.type === "ReviewPassed")).toBe(true);
		expect(f.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});

	it("does not ignore optional check failures", async () => {
		const f = fixture();
		f.request.checks = [{ id: "optional", kind: "test", required: false }];
		f.verifier.verify.mockImplementation(async (request) => {
			const result = verificationResult(request);
			Object.assign(result.checks[0], { status: "FAIL", exitCode: 1 });
			return result;
		});
		expect((await drive(await f.create())).status).toBe("BLOCKED");
	});

	it("rejects malformed agent output without advancing the workflow", async () => {
		const f = fixture();
		f.agents.execute.mockImplementation(async (request) => {
			const result = agentResult(request);
			if (result.role === "Developer") result.handoff.summary = "";
			return result;
		});
		expect((await drive(await f.create())).status).toBe("FAILED");
		expect(f.verifier.verify).not.toHaveBeenCalled();
	});

	it("does not execute a port when saving StepStarted fails", async () => {
		const f = fixture();
		const kernel = await f.create();
		await kernel.start();
		f.store.save.mockRejectedValue(new Error("disk full"));
		await expect(kernel.advance("implement")).rejects.toThrow("disk full");
		expect(kernel.snapshot.status).toBe("FAILED");
		expect(f.agents.execute).not.toHaveBeenCalled();
		await expect(kernel.advance("implement")).rejects.toThrow("Invalid transition");
	});

	it("never emits RunCompleted if its state cannot be saved", async () => {
		const f = fixture();
		const kernel = await f.create();
		await drive(kernel, "complete");
		f.store.save.mockImplementation(async (state) => {
			if (state.status === "COMPLETED") throw new Error("disk full");
			f.saved.push(state);
		});
		await expect(kernel.advance("complete")).rejects.toThrow("disk full");
		expect(kernel.snapshot.status).toBe("FAILED");
		expect(f.events.some((event) => event.type === "RunCompleted")).toBe(false);
		expect(f.saved.at(-1)?.status).toBe("RUNNING");
	});

	it("refuses duplicate IDs and malformed requests before starting an agent", async () => {
		const f = fixture();
		const existing = (await f.create()).snapshot;
		f.store.save.mockClear();
		f.store.load.mockResolvedValue(existing);
		await expect(f.create()).rejects.toThrow("already exists");
		expect(f.store.save).not.toHaveBeenCalled();
		f.store.load.mockResolvedValue(undefined);
		f.request.maxRevisionCycles = -1;
		await expect(f.create()).rejects.toThrow("Revision limit");
		expect(f.agents.execute).not.toHaveBeenCalled();
	});

	it("rejects concurrent advances and ignores a late result after cancellation", async () => {
		const f = fixture();
		const entered = deferredPromise<void>();
		const deferred = deferredPromise<AgentExecutionResult>();
		f.agents.execute.mockImplementation(async () => {
			entered.resolve();
			return deferred.promise;
		});
		const kernel = await f.create();
		await kernel.start();
		const controller = new AbortController();
		const pending = kernel.advance("implement", controller.signal);
		await entered.promise;
		await expect(kernel.advance("implement")).rejects.toThrow("Invalid transition");
		controller.abort();
		deferred.resolve(agentResult(f.agents.execute.mock.calls[0][0]));
		expect((await pending).status).toBe("CANCELLED");
		expect(f.events.some((event) => event.type === "AgentCompleted")).toBe(false);
		expect(f.events.at(-1)?.type).toBe("RunCancelled");
	});

	it("records interrupted state at a step boundary without resuming work", async () => {
		const f = fixture();
		const kernel = await f.create();
		await kernel.start();
		expect((await kernel.stop("INTERRUPTED", "Host detached")).status).toBe("INTERRUPTED");
		expect(f.events.at(-1)?.type).toBe("RunInterrupted");
		expect(f.agents.execute).not.toHaveBeenCalled();
		await expect(kernel.start()).rejects.toThrow("Invalid transition");
	});
});

function completionFixture(): CompletionEvidence {
	const f = fixture();
	const task = f.request.task;
	const handoff: Handoff = {
		runId: "run-1",
		revision: 0,
		role: "Developer",
		task: task.id,
		summary: "Fixed",
		changed_files: ["src/login.ts"],
		assumptions: [],
		tests_run: [],
		known_risks: [],
		unresolved: [],
	};
	const selfCheck = verificationResult({
		runId: "run-1",
		revision: 0,
		step: { stepId: "self-check", attempt: 1 },
		task,
		handoff,
		checks: f.request.checks ?? [],
	});
	const finalCheck = {
		...structuredClone(selfCheck),
		step: { stepId: "test", attempt: 1 },
	} satisfies VerificationResult;
	const result = agentResult({
		executionMode: "EDIT",
		runId: "run-1",
		revision: 0,
		step: { stepId: "review", attempt: 1 },
		task,
		role: "Reviewer",
		profile: "reasoning",
		handoff,
		verification: selfCheck,
	});
	if (result.role !== "Reviewer") throw new Error("Invalid test fixture");
	return {
		executionMode: "EDIT",
		runId: "run-1",
		revision: 0,
		task,
		taskContractDigest: taskContractDigest(task),
		checks: f.request.checks ?? [],
		handoff,
		review: result.review,
		selfCheck,
		finalCheck,
	};
}

describe("completion guard", () => {
	it("accepts only a matching independent PASS with current evidence", () => {
		expect(() => assertCanComplete(completionFixture())).not.toThrow();
	});
	it.each([
		(e: CompletionEvidence) => {
			e.review = undefined;
		},
		(e: CompletionEvidence) => {
			e.finalCheck = undefined;
		},
		(e: CompletionEvidence) => {
			e.selfCheck = undefined;
		},
		(e: CompletionEvidence) => {
			e.handoff = undefined;
		},
		(e: CompletionEvidence) => {
			e.review!.result = "REVISE";
		},
		(e: CompletionEvidence) => {
			e.review!.result = "BLOCK";
		},
		(e: CompletionEvidence) => {
			e.review!.runId = "other";
		},
		(e: CompletionEvidence) => {
			e.review!.revision = 1;
		},
		(e: CompletionEvidence) => {
			e.review!.task = "other";
		},
		(e: CompletionEvidence) => {
			e.review!.criteria = [];
		},
		(e: CompletionEvidence) => {
			e.review!.criteria[0].status = "UNVERIFIED";
		},
		(e: CompletionEvidence) => {
			e.review!.criteria[0].evidenceRefs = [];
		},
		(e: CompletionEvidence) => {
			e.review!.evidenceRefs = ["invented"];
		},
		(e: CompletionEvidence) => {
			e.review!.issues.push({
				severity: "blocker",
				file: null,
				description: "Missing requirement",
				recommendation: "Revise",
			});
		},
		(e: CompletionEvidence) => {
			e.handoff!.unresolved.push("unfinished");
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.checks = [];
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.checks[0].required = false;
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.checks[0].exitCode = 1;
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.checks[0].evidenceRefs = [];
		},
		(e: CompletionEvidence) => {
			e.finalCheck!.step.attempt = 2;
		},
	])("rejects incomplete, stale or fabricated evidence %#", (mutate) => {
		const evidence = completionFixture();
		mutate(evidence);
		expect(() => assertCanComplete(evidence)).toThrow();
	});
});
