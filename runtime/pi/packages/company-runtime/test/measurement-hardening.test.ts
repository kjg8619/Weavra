import type {
	SpanAttributes,
	SpanOptions,
	SpanStatus,
	TelemetryContext,
	TelemetrySpan,
} from "@earendil-works/pi-telemetry";
import { describe, expect, it, vi } from "vitest";
import { classifyRequest } from "../src/classification.ts";
import { type CheckRequirement, STANDARD_STEP_IDS } from "../src/contracts.ts";
import { CompanyKernel, type CreateRunRequest } from "../src/kernel.ts";
import { WorkerExecutionError, WorkerMeasurementAccumulator } from "../src/measurement.ts";
import type { WorkerMeasurement } from "../src/measurement-types.ts";
import type { AgentExecutionRequest, AgentExecutionResult, KernelPorts, VerificationRequest } from "../src/ports.ts";
import { withSpan } from "../src/telemetry.ts";
import { testContract } from "./fixture-contract.ts";

const checks: CheckRequirement[] = [{ id: "regression", kind: "test", required: true }];

function workerMeasurement(
	overrides: {
		outcome?: "SUCCEEDED" | "FAILED";
		tokens?: number;
		role?: "Developer" | "Reviewer";
		revision?: number;
	} = {},
): WorkerMeasurement {
	const accumulator = new WorkerMeasurementAccumulator({
		role: overrides.role ?? "Developer",
		profile: "coding",
		revision: overrides.revision ?? 0,
		step: { stepId: "implement", attempt: 1 },
		requestedProvider: "provider",
		requestedModel: "model",
	});
	accumulator.observeAssistant({
		responseId: "r1",
		provider: "provider",
		model: "model",
		usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, totalTokens: overrides.tokens ?? 123 },
		content: [{ type: "toolCall", name: "runtime_edit" }],
	});
	return accumulator.finish(overrides.outcome ?? "SUCCEEDED");
}

function handoff(request: AgentExecutionRequest, task: string) {
	return {
		runId: request.runId,
		revision: request.revision,
		role: "Developer" as const,
		task,
		changed_files: ["src/app.ts"],
		summary: "Fixture",
		assumptions: [],
		tests_run: [],
		known_risks: [],
		unresolved: [],
	};
}

async function fixture(
	agents: (request: AgentExecutionRequest, call: number) => Promise<AgentExecutionResult>,
	budget?: CreateRunRequest["budget"],
): Promise<{ kernel: CompanyKernel; drive: () => Promise<CompanyKernel["snapshot"]> }> {
	const request: CreateRunRequest = {
		executionMode: "EDIT",
		runId: "run-hardening",
		task: testContract("Fix bug", { taskId: "task-1", checkIds: ["regression"] }),
		...(budget ? { budget } : {}),
		classification: classifyRequest("Fix bug").classification,
		checks,
	};
	let calls = 0;
	const ports: KernelPorts = {
		agents: {
			execute: async (input) => agents(input, ++calls),
		},
		verifier: {
			verify: async (input: VerificationRequest) => ({
				runId: input.runId,
				revision: input.revision,
				step: input.step,
				diffDigest: "digest",
				evidenceRefs: ["diff:digest"],
				changedFiles: ["src/app.ts"],
				checks: input.checks.map((check) => ({
					id: check.id,
					kind: check.kind,
					required: check.required,
					runId: input.runId,
					revision: input.revision,
					status: "PASS" as const,
					exitCode: 0,
					reason: "Fixture check",
					evidenceRefs: [`check:${check.id}`],
					diffDigest: "digest",
				})),
			}),
			inspect: async () => ({
				diffDigest: "digest",
				changedFiles: ["src/app.ts"],
				evidenceRefs: ["diff:digest"],
				safe: true,
			}),
		},
		store: {
			load: async () => undefined,
			save: async () => {},
		},
	};
	const kernel = await CompanyKernel.create(request, ports);
	return {
		kernel,
		drive: async () => {
			await kernel.start();
			for (let guard = 0; guard < 32 && kernel.snapshot.status === "RUNNING"; guard += 1) {
				const step = kernel.snapshot.currentStep?.stepId;
				if (!step || !STANDARD_STEP_IDS.includes(step)) throw new Error(`Unexpected step ${step}`);
				await kernel.advance(step);
			}
			return kernel.snapshot;
		},
	};
}

function review(request: Extract<AgentExecutionRequest, { role: "Reviewer" }>, result: "PASS" | "REVISE" | "BLOCK") {
	return {
		runId: request.runId,
		revision: request.revision,
		role: "Reviewer" as const,
		task: request.task.id,
		result,
		issues: [],
		criteria: request.task.acceptanceCriteria.map((criterion) => ({
			criterionId: criterion.id,
			status: result === "PASS" ? ("MET" as const) : ("UNMET" as const),
			evidenceRefs: ["diff:digest"],
		})),
		evidenceRefs: ["diff:digest"],
		diffDigest: request.verification.diffDigest,
	};
}

describe("V0.3F hardening: failed worker settlement", () => {
	it("persists a failed invocation measurement, tokens and invocation count with the original reason", async () => {
		const { drive } = await fixture(async (request) => {
			if (request.role === "Developer")
				throw new WorkerExecutionError(
					"Worker provider failed",
					workerMeasurement({ outcome: "FAILED", tokens: 123 }),
				);
			throw new Error("unreachable");
		});
		const run = await drive();
		expect(run.status).toBe("FAILED");
		expect(run.lastError).toBe("Worker provider failed");
		expect(run.workerMeasurements).toHaveLength(1);
		expect(run.workerMeasurements?.[0]).toMatchObject({ outcome: "FAILED", role: "Developer" });
		expect(run.workerMeasurements?.[0].usage).toMatchObject({ source: "provider", totalTokens: 123 });
		expect(run.budget).toMatchObject({ workerInvocations: 1, reportedTokens: 123 });
	});

	it("records an invocation without fabricating zero usage when no measurement exists", async () => {
		const { drive } = await fixture(async () => {
			throw new Error("Worker execution failed (prompt/result)");
		});
		const run = await drive();
		expect(run.status).toBe("FAILED");
		expect(run.workerMeasurements ?? []).toHaveLength(0);
		expect(run.budget).toMatchObject({ workerInvocations: 1, reportedTokens: null });
	});

	it("keeps the measurement when a successful agent result fails runtime validation", async () => {
		const { drive } = await fixture(async (request) => ({
			role: "Developer",
			// Wrong task identity: the Kernel rejects it after the measurement was already spent.
			handoff: handoff(request, "other-task"),
			measurement: workerMeasurement({ tokens: 77 }),
		}));
		const run = await drive();
		expect(["FAILED", "BLOCKED"]).toContain(run.status);
		expect(run.lastError).toContain("Handoff belongs to another task");
		expect(run.workerMeasurements).toHaveLength(1);
		expect(run.workerMeasurements?.[0].usage.totalTokens).toBe(77);
		expect(run.budget).toMatchObject({ workerInvocations: 1, reportedTokens: 77 });
	});
});

describe("V0.3F hardening: Reviewer revision settlement", () => {
	it("persists the Reviewer measurement across REVISE and the follow-up revision", async () => {
		let reviewCall = 0;
		const { drive } = await fixture(async (request) => {
			if (request.role === "Developer")
				return {
					role: "Developer",
					handoff: handoff(request, request.task.id),
					measurement: workerMeasurement({ tokens: 100, revision: request.revision }),
				};
			if (request.role !== "Reviewer") throw new Error("unexpected role");
			reviewCall += 1;
			return {
				role: "Reviewer",
				review: review(request, reviewCall === 1 ? "REVISE" : "PASS"),
				measurement: workerMeasurement({ tokens: 50, role: "Reviewer", revision: request.revision }),
			};
		});
		const run = await drive();
		expect(run.status).toBe("COMPLETED");
		expect(run.revisionCycle).toBe(1);
		expect(run.workerMeasurements).toHaveLength(4);
		expect(run.workerMeasurements?.map((entry) => entry.role)).toEqual([
			"Developer",
			"Reviewer",
			"Developer",
			"Reviewer",
		]);
		expect(run.budget).toMatchObject({ workerInvocations: 4, reportedTokens: 300 });
		expect(run.workerMeasurements?.map((entry) => entry.usage.totalTokens)).toEqual([100, 50, 100, 50]);
	});

	it("persists the Reviewer measurement on a terminal BLOCK", async () => {
		const { drive } = await fixture(async (request) => {
			if (request.role === "Developer")
				return { role: "Developer", handoff: handoff(request, request.task.id), measurement: workerMeasurement() };
			if (request.role !== "Reviewer") throw new Error("unexpected role");
			return {
				role: "Reviewer",
				review: review(request, "BLOCK"),
				measurement: workerMeasurement({ tokens: 9, role: "Reviewer" }),
			};
		});
		const run = await drive();
		expect(run.status).toBe("BLOCKED");
		expect(run.reviewHistory).toHaveLength(1);
		expect(run.workerMeasurements).toHaveLength(2);
		expect(run.workerMeasurements?.[1]).toMatchObject({ role: "Reviewer", outcome: "SUCCEEDED" });
		expect(run.budget).toMatchObject({ workerInvocations: 2, reportedTokens: 132 });
	});
});

describe("V0.3F hardening: cancellation after a worker result", () => {
	it("keeps the spent Developer measurement when cancellation arrives with the result", async () => {
		const controller = new AbortController();
		let calls = 0;
		const { kernel } = await fixture(async (request) => {
			calls += 1;
			controller.abort();
			return {
				role: "Developer",
				handoff: handoff(request, request.task.id),
				measurement: workerMeasurement({ tokens: 77 }),
			};
		});
		await kernel.start();
		const step = kernel.snapshot.currentStep?.stepId;
		if (step !== "implement") throw new Error(`Unexpected step ${step}`);
		await kernel.advance(step, controller.signal);
		const run = kernel.snapshot;
		expect(run.status).toBe("CANCELLED");
		expect(calls).toBe(1);
		expect(run.workerMeasurements).toHaveLength(1);
		expect(run.workerMeasurements?.[0].usage.totalTokens).toBe(77);
		expect(run.budget).toMatchObject({ workerInvocations: 1, reportedTokens: 77 });
		// The cancelled result must not become completion authority.
		expect(run.handoff).toBeUndefined();
		expect(run.reviewHistory ?? []).toHaveLength(0);
	});

	it("keeps both measurements when cancellation arrives with the Reviewer result", async () => {
		const controller = new AbortController();
		let calls = 0;
		const { kernel } = await fixture(async (request) => {
			calls += 1;
			if (request.role === "Developer")
				return {
					role: "Developer",
					handoff: handoff(request, request.task.id),
					measurement: workerMeasurement({ tokens: 100 }),
				};
			if (request.role !== "Reviewer") throw new Error(`Unexpected role ${request.role}`);
			controller.abort();
			return {
				role: "Reviewer",
				review: review(request, "PASS"),
				measurement: workerMeasurement({ role: "Reviewer", tokens: 50 }),
			};
		});
		await kernel.start();
		await kernel.advance("implement");
		await kernel.advance("self-check");
		await kernel.advance("review", controller.signal);
		const run = kernel.snapshot;
		expect(run.status).toBe("CANCELLED");
		expect(calls).toBe(2);
		expect(run.workerMeasurements?.map((entry) => entry.usage.totalTokens)).toEqual([100, 50]);
		expect(run.budget).toMatchObject({ workerInvocations: 2, reportedTokens: 150 });
		expect(run.reviewHistory ?? []).toHaveLength(0);
		expect(run.completed ?? []).toHaveLength(0);
		expect(run.review).toBeUndefined();
	});
});

describe("V0.3F hardening: telemetry isolation", () => {
	const attributes: SpanAttributes = { role: "Developer", profile: "coding", revision: 0, provider: "p", model: "m" };
	const spanOk = (overrides: Partial<TelemetrySpan> = {}): TelemetrySpan => ({
		startSpan: async <T>(_options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) =>
			await callback(spanOk()),
		addEvent: () => {},
		setAttributes: () => {},
		setStatus: () => {},
		...overrides,
	});

	it("runs the work exactly once when startSpan throws before the callback", async () => {
		const work = vi.fn(async () => "result");
		const telemetry: TelemetryContext = {
			startSpan: async () => {
				throw new Error("exporter down");
			},
		};
		await expect(withSpan(telemetry, "weavra.worker", attributes, work)).resolves.toBe("result");
		expect(work).toHaveBeenCalledTimes(1);
	});

	it("keeps the successful result when telemetry throws after the callback settled", async () => {
		const work = vi.fn(async () => "result");
		const telemetry: TelemetryContext = {
			startSpan: async <T>(_options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) => {
				await callback(spanOk());
				throw new Error("flush failed");
			},
		};
		await expect(withSpan(telemetry, "weavra.worker", attributes, work)).resolves.toBe("result");
		expect(work).toHaveBeenCalledTimes(1);
	});

	it("preserves the original work error when telemetry also fails", async () => {
		const work = vi.fn(async () => {
			throw new Error("provider exploded");
		});
		const telemetry: TelemetryContext = {
			startSpan: async <T>(_options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) => {
				try {
					return await callback(spanOk());
				} catch {
					throw new Error("telemetry masked the failure");
				}
			},
		};
		await expect(withSpan(telemetry, "weavra.worker", attributes, work)).rejects.toThrow("provider exploded");
		expect(work).toHaveBeenCalledTimes(1);
	});

	it("ignores failing span methods and runs work once when the adapter never calls back", async () => {
		const work = vi.fn(async () => "result");
		const failingSpan = spanOk({
			setAttributes: () => {
				throw new Error("setAttributes failed");
			},
			setStatus: () => {
				throw new Error("setStatus failed");
			},
		});
		const telemetry: TelemetryContext = {
			startSpan: async <T>(_options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) =>
				await callback(failingSpan),
		};
		await expect(
			withSpan(telemetry, "weavra.worker", attributes, work, () => ({
				status: { status: "ok" } as SpanStatus,
				attributes: { outcome: "SUCCEEDED" },
			})),
		).resolves.toBe("result");
		expect(work).toHaveBeenCalledTimes(1);

		const ignoring: TelemetryContext = { startSpan: async <T>(_options: SpanOptions) => "bogus" as T };
		await expect(withSpan(ignoring, "weavra.worker", attributes, work)).resolves.toBe("result");
		expect(work).toHaveBeenCalledTimes(2);
	});

	it("never lets the telemetry adapter replace the work result", async () => {
		const work = vi.fn(async () => "real-result");
		const tampering: TelemetryContext = {
			startSpan: async <T>(_options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) => {
				await callback(spanOk());
				return "tampered-result" as T;
			},
		};
		await expect(withSpan(tampering, "weavra.worker", attributes, work)).resolves.toBe("real-result");
		expect(work).toHaveBeenCalledTimes(1);

		const undefinedReturn: TelemetryContext = {
			startSpan: async <T>(_options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) => {
				await callback(spanOk());
				return undefined as T;
			},
		};
		await expect(withSpan(undefinedReturn, "weavra.worker", attributes, work)).resolves.toBe("real-result");
		expect(work).toHaveBeenCalledTimes(2);
	});

	it("never lets the telemetry adapter mask a failing work result", async () => {
		const work = vi.fn(async () => {
			throw new Error("provider exploded");
		});
		const swallowing: TelemetryContext = {
			startSpan: async <T>(_options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) => {
				try {
					await callback(spanOk());
				} catch {
					// An adapter that swallows the callback error must not turn it into success.
				}
				return "tampered-success" as T;
			},
		};
		await expect(withSpan(swallowing, "weavra.worker", attributes, work)).rejects.toThrow("provider exploded");
		expect(work).toHaveBeenCalledTimes(1);
	});
});
