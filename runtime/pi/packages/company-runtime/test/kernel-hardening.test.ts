import { describe, expect, it } from "vitest";
import { classifyRequest } from "../src/classification.ts";
import type { Handoff, Review, Run, VerificationResult } from "../src/contracts.ts";
import type { RuntimeEvent } from "../src/events.ts";
import { CompanyKernel } from "../src/kernel.ts";
import type { AgentExecutionRequest, AgentExecutionResult, KernelPorts, VerificationRequest } from "../src/ports.ts";
import { testContract } from "./fixture-contract.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((complete) => {
		resolve = complete;
	});
	return { promise, resolve };
}
function fixture(quick = false) {
	let digest = "digest-0";
	const goal = quick ? "Fix typo in src/app.ts" : "Fix bug";
	const events: RuntimeEvent[] = [];
	const saved: Run[] = [];
	const verify = (request: VerificationRequest): VerificationResult => ({
		runId: request.runId,
		revision: request.revision,
		step: request.step,
		diffDigest: digest,
		changedFiles: ["src/app.ts"],
		evidenceRefs: ["diff"],
		checks: request.checks.map((check) => ({
			id: check.id,
			kind: check.kind,
			required: check.required,
			runId: request.runId,
			revision: request.revision,
			step: request.step,
			status: "PASS",
			exitCode: 0,
			reason: "Fixture check",
			diffDigest: digest,
			evidenceRefs: ["check"],
		})),
	});
	const result = (request: AgentExecutionRequest, verdict: Review["result"] = "PASS"): AgentExecutionResult => {
		if (request.role === "Reviewer")
			return {
				role: "Reviewer",
				review: {
					runId: request.runId,
					revision: request.revision,
					task: request.task.id,
					role: "Reviewer",
					result: verdict,
					issues: [],
					criteria: request.task.acceptanceCriteria.map((criterion) => ({
						criterionId: criterion.id,
						status: "MET",
						evidenceRefs: ["diff"],
					})),
					evidenceRefs: ["diff"],
					diffDigest: request.verification.diffDigest,
				},
			};
		const handoff: Handoff = {
			runId: request.runId,
			revision: request.revision,
			role: "Developer",
			task: request.task.id,
			changed_files: ["src/app.ts"],
			summary: "Fixture implementation",
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
		};
		return request.role === "Developer"
			? { role: "Developer", handoff }
			: {
					role: "Executor",
					handoff: {
						...handoff,
						role: "Executor",
						criteria: request.task.acceptanceCriteria.map((criterion) => ({
							criterionId: criterion.id,
							status: "MET",
							explanation: "Fixture criterion",
						})),
					},
				};
	};
	const register = (request: AgentExecutionRequest, file?: string) =>
		request.onSessionCreated?.({
			role: request.role,
			sessionId: `${request.role}-${request.revision}`,
			sessionFile: file ?? `/sessions/${request.role}-${request.revision}.jsonl`,
		});
	const ports: KernelPorts = {
		agents: {
			execute: async (request) => {
				await register(request);
				return result(request);
			},
		},
		verifier: {
			verify: async (request) => verify(request),
			inspect: async () => ({
				safe: true,
				changedFiles: ["src/app.ts"],
				changedLines: 2,
				diffDigest: digest,
				evidenceRefs: ["diff"],
			}),
		},
		store: {
			load: async () => undefined,
			save: async (run) => {
				saved.push(structuredClone(run));
			},
		},
		events: {
			emit: (event) => {
				events.push(event);
			},
		},
	};
	return {
		ports,
		result,
		register,
		verify,
		events,
		saved,
		setDigest: (next: string) => {
			digest = next;
		},
		create: () =>
			CompanyKernel.create(
				{
					executionMode: "EDIT",
					runId: "run",
					task: testContract(goal, { taskId: "task", checkIds: ["check"] }),
					classification: classifyRequest(goal).classification,
					checks: [{ id: "check", kind: "test", required: true }],
				},
				ports,
			),
	};
}
async function drive(kernel: CompanyKernel, stop?: string) {
	if (kernel.snapshot.status === "CREATED") await kernel.start();
	while (kernel.snapshot.status === "RUNNING" && kernel.snapshot.currentStep?.stepId !== stop)
		await kernel.advance(kernel.snapshot.currentStep!.stepId);
	return kernel.snapshot;
}

describe("S6 evidence identity and finalization races", () => {
	it.each(["review", "verification", "session-file"])(
		"rejects prior-attempt %s even after a valid REVISE",
		async (mode) => {
			const f = fixture();
			let oldReview: Review | undefined;
			f.ports.agents.execute = async (request) => {
				await f.register(
					request,
					mode === "session-file" && request.role === "Reviewer" && request.revision === 1
						? "/sessions/Reviewer-0.jsonl"
						: undefined,
				);
				const result = f.result(request, request.revision === 0 ? "REVISE" : "PASS");
				if (result.role === "Reviewer" && request.revision === 0) oldReview = structuredClone(result.review);
				if (mode === "review" && result.role === "Reviewer" && request.revision === 1)
					result.review = { ...oldReview!, result: "PASS" };
				return result;
			};
			f.ports.verifier.verify = async (request) => {
				const result = f.verify(request);
				if (mode === "verification" && request.revision === 1) {
					result.revision = 0;
					result.checks[0].revision = 0;
				}
				return result;
			};
			const run = await drive(await f.create());
			expect(["BLOCKED", "FAILED"]).toContain(run.status);
			expect(f.events.some((event) => event.type === "RunCompleted")).toBe(false);
		},
	);
	it.each([false, true])("stale live digest blocks %s QUICK completion", async (quick) => {
		const f = fixture(quick);
		const kernel = await f.create();
		await drive(kernel, "test");
		f.setDigest("changed-after-review-or-executor");
		const run = await drive(kernel);
		expect(run.status).toBe("BLOCKED");
		expect(f.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});
	it("rejects check evidence for a different attempt despite matching digest", async () => {
		const f = fixture();
		f.ports.verifier.verify = async (request) => {
			const result = f.verify(request);
			result.checks[0].step = { stepId: request.step.stepId, attempt: 99 };
			return result;
		};
		expect((await drive(await f.create())).status).toBe("BLOCKED");
	});
	it("same-turn Provider result and abort does not publish AgentCompleted", async () => {
		const f = fixture();
		const controller = new AbortController();
		f.ports.agents.execute = async (request) => {
			await f.register(request);
			const result = f.result(request);
			controller.abort();
			return result;
		};
		const kernel = await f.create();
		await kernel.start();
		expect((await kernel.advance("implement", controller.signal)).status).toBe("CANCELLED");
		expect(f.events.some((event) => event.type === "AgentCompleted" || event.type === "RunCompleted")).toBe(false);
	});
	it("unconfirmed cleanup cannot be disguised as a successful port result", async () => {
		const f = fixture();
		f.ports.agents = {
			safeToRelease: false,
			execute: async (request) => {
				await f.register(request);
				return f.result(request);
			},
		};
		expect((await drive(await f.create())).status).toBe("BLOCKED");
		expect(f.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});
	it("cancel before the completion commit is accepted", async () => {
		const f = fixture();
		const kernel = await f.create();
		await drive(kernel, "complete");
		expect((await kernel.advance("complete", AbortSignal.abort())).status).toBe("CANCELLED");
		expect(f.events.some((event) => event.type === "RunCompleted")).toBe(false);
	});
	it("documents the terminal commit boundary: a later cancel does not roll back an already accepted commit", async () => {
		const f = fixture();
		const kernel = await f.create();
		await drive(kernel, "complete");
		const entered = deferred<void>();
		const release = deferred<void>();
		const controller = new AbortController();
		f.ports.store.save = async (run) => {
			if (run.status === "COMPLETED") {
				entered.resolve();
				await release.promise;
			}
			f.saved.push(structuredClone(run));
		};
		const pending = kernel.advance("complete", controller.signal);
		await entered.promise;
		expect(f.events.some((event) => event.type === "RunCompleted")).toBe(false);
		controller.abort();
		release.resolve();
		const result = await pending;
		expect(result.status).toBe("COMPLETED");
		expect(f.saved.at(-1)?.status).toBe("COMPLETED");
		expect(f.events.at(-1)?.type).toBe("RunCompleted");
	});
	it("observer failure after terminal persistence is a delivery diagnostic, not inferred rollback", async () => {
		const f = fixture();
		f.ports.events = {
			emit: (event) => {
				if (event.type === "RunCompleted") throw new Error("Observer lost");
				f.events.push(event);
			},
		};
		const kernel = await f.create();
		expect((await drive(kernel)).status).toBe("COMPLETED");
		expect(kernel.deliveryFailures).toEqual([expect.objectContaining({ type: "RunCompleted" })]);
	});
});
