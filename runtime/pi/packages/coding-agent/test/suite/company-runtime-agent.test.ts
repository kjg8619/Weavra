import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import type { SpanOptions, TelemetryContext, TelemetrySpan } from "@earendil-works/pi-telemetry";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";
import { PiAgentExecutor, type PiAgentExecutorOptions } from "../../../company-runtime/src/agent-runner.ts";
import { parseRuntimeConfig } from "../../../company-runtime/src/config.ts";
import type {
	Handoff,
	Review,
	RoleSessionReference,
	VerificationResult,
} from "../../../company-runtime/src/contracts.ts";
import type { RuntimeEvent } from "../../../company-runtime/src/events.ts";
import { CompanyKernel } from "../../../company-runtime/src/kernel.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import { AgentSession } from "../../src/index.ts";
import { contractOf, suiteContract } from "./company-contract.ts";
import { createHarness, type Harness } from "./harness.ts";

const handoff: Handoff = {
	runId: "run-1",
	revision: 0,
	role: "Developer",
	task: "task-1",
	changed_files: ["src/app.ts"],
	summary: "Handle bug",
	assumptions: [],
	tests_run: [],
	known_risks: [],
	unresolved: [],
};
const review: Review = {
	runId: "run-1",
	revision: 0,
	role: "Reviewer",
	task: "task-1",
	result: "PASS",
	issues: [],
	criteria: [{ criterionId: "AC-001", status: "MET", evidenceRefs: ["diff-1"] }],
	evidenceRefs: ["diff-1"],
	diffDigest: "digest-1",
};
const verification: VerificationResult = {
	runId: "run-1",
	revision: 0,
	step: { stepId: "self-check", attempt: 1 },
	diffDigest: "digest-1",
	evidenceRefs: ["diff-1"],
	checks: [],
	reviewContext: {
		diff: "-original\n+fixed",
		evidence: [{ ref: "diff-1", content: "fixture evidence from trusted verifier" }],
	},
};
const submitHandoff = () => fauxAssistantMessage(fauxToolCall("submit_handoff", handoff), { stopReason: "toolUse" });
const submitReview = (result: Review["result"] = "PASS") =>
	fauxAssistantMessage(fauxToolCall("submit_review", { ...review, result }), { stopReason: "toolUse" });
let harness: Harness;
let store: FileStateStore;
let executor: PiAgentExecutor;
let kernel: CompanyKernel;
let options: PiAgentExecutorOptions;
let workspace: string;
let events: RuntimeEvent[];
let workers: AgentSession[];
let dispose: MockInstance<AgentSession["dispose"]>;

async function persistReference(ref: RoleSessionReference) {
	const run = (await store.load("run-1"))!;
	await store.save({ ...run, revision: run.revision + 1, roleSessionRefs: [...run.roleSessionRefs, ref] });
}
function developer(): AgentExecutionRequest {
	return {
		executionMode: "EDIT",
		runId: "run-1",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		role: "Developer",
		profile: "coding",
		task: contractOf(kernel.snapshot),
		onSessionCreated: persistReference,
	};
}
function reviewer(): AgentExecutionRequest {
	return {
		executionMode: "EDIT",
		runId: "run-1",
		revision: 0,
		step: { stepId: "review", attempt: 1 },
		role: "Reviewer",
		profile: "reasoning",
		task: contractOf(kernel.snapshot),
		handoff: structuredClone(handoff),
		verification: structuredClone(verification),
		onSessionCreated: persistReference,
	};
}

beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding-model" }, { id: "review-model" }] });
	workspace = join(harness.tempDir, "workspace");
	const agentDir = join(harness.tempDir, "worker-agent");
	mkdirSync(join(workspace, "src"), { recursive: true });
	mkdirSync(agentDir);
	writeFileSync(join(workspace, "src/app.ts"), "original\n");
	const config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding-model" },
					reasoning: { provider: "faux", model: "review-model" },
				},
			},
			files: { allowed_paths: ["src", ".ai", ".git", "package.json"] },
			verification: { checks: [{ id: "regression", kind: "test", executable: "never-execute", args: [] }] },
		}),
	);
	store = await FileStateStore.open(workspace);
	options = {
		executionContract: { runId: "run-1", mode: "EDIT" },
		cwd: workspace,
		agentDir,
		config,
		modelRuntime: harness.session.modelRuntime,
		audit: store,
		timeoutMs: 3000,
		projectInstructions: "Explicit reviewed project rules",
	};
	executor = await PiAgentExecutor.create(options);
	events = [];
	kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: "run-1",
			task: suiteContract("Fix bug", { taskId: "task-1" }),
			classification: { intent: "bugfix", complexity: "STANDARD", risk: "R1", confidence: null, reason: "Fixture" },
		},
		{
			store,
			agents: executor,
			verifier: {
				verify: async () => {
					throw new Error("S3 does not orchestrate verification");
				},
			},
			events: {
				emit: (event) => {
					events.push(event);
				},
			},
		},
	);
	await kernel.start();
	workers = [];
	const originalPrompt = AgentSession.prototype.prompt;
	vi.spyOn(AgentSession.prototype, "prompt").mockImplementation(function (this: AgentSession, ...args) {
		workers.push(this);
		return originalPrompt.apply(this, args);
	});
	dispose = vi.spyOn(AgentSession.prototype, "dispose");
});
afterEach(async () => {
	vi.restoreAllMocks();
	await store?.close().catch(() => {});
	harness?.cleanup();
});

describe("Company Runtime S3 SDK adapter (faux only)", () => {
	it("executes Developer edit/write through S2, submits handoff, persists reference and ordered lifecycle events", async () => {
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("runtime_edit", { path: "src/app.ts", oldText: "original", newText: "fixed" }),
				{ stopReason: "toolUse" },
			),
			fauxAssistantMessage(fauxToolCall("runtime_write", { path: "src/new.ts", content: "new code" }), {
				stopReason: "toolUse",
			}),
			submitHandoff(),
		]);
		const result = await kernel.advance("implement");
		expect(result.status).toBe("RUNNING");
		expect(result.currentStep?.stepId).toBe("self-check");
		expect(readFileSync(join(workspace, "src/app.ts"), "utf8")).toBe("fixed\n");
		expect(readFileSync(join(workspace, "src/new.ts"), "utf8")).toBe("new code");
		expect(store.snapshot.actions.map((item) => item.status)).toEqual(["SUCCEEDED", "SUCCEEDED"]);
		expect(result.roleSessionRefs).toHaveLength(1);
		expect(result.roleSessionRefs[0].sessionId).toBe(workers[0].sessionId);
		expect(existsSync(result.roleSessionRefs[0].sessionFile)).toBe(true);
		expect(events.filter((event) => event.type.startsWith("Agent")).map((event) => event.type)).toEqual([
			"AgentStarted",
			"AgentSessionCreated",
			"AgentCompleted",
		]);
		expect(events.map((event) => event.sequence)).toEqual(events.map((_event, index) => index + 1));
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("creates independent Developer/Reviewer sessions, profiles and explicit review material without implicit reasoning", async () => {
		const contexts: Context[] = [];
		harness.setResponses([
			(context) => {
				contexts.push(context);
				return fauxAssistantMessage(
					[fauxThinking("DEVELOPER_PRIVATE_REASONING"), fauxToolCall("submit_handoff", handoff)],
					{ stopReason: "toolUse" },
				);
			},
			(context) => {
				contexts.push(context);
				return fauxAssistantMessage(fauxToolCall("runtime_read", { path: "src/app.ts" }), {
					stopReason: "toolUse",
				});
			},
			fauxAssistantMessage(fauxToolCall("runtime_search", { paths: ["src/app.ts"], query: "original" }), {
				stopReason: "toolUse",
			}),
			submitReview(),
		]);
		await executor.execute(developer());
		const result = await executor.execute(reviewer());
		expect(result).toMatchObject({ role: "Reviewer", review });
		expect(workers).toHaveLength(2);
		expect(workers[0]).not.toBe(workers[1]);
		expect(workers[0].sessionId).not.toBe(workers[1].sessionId);
		expect(workers[0].resourceLoader).not.toBe(workers[1].resourceLoader);
		expect(workers.map((worker) => worker.model?.id)).toEqual(["coding-model", "review-model"]);
		expect(JSON.stringify(contexts[1])).toContain("fixture evidence from trusted verifier");
		expect(JSON.stringify(contexts[1])).toContain("-original");
		expect(JSON.stringify(contexts[1])).not.toContain("DEVELOPER_PRIVATE_REASONING");
		expect(JSON.stringify(store.snapshot)).not.toContain("DEVELOPER_PRIVATE_REASONING");
		expect(contexts[1].tools?.map((tool) => tool.name).sort()).toEqual([
			"runtime_list_files",
			"runtime_read",
			"runtime_search",
			"submit_review",
		]);
		expect(
			workers[1].messages.some(
				(message) => message.role === "toolResult" && JSON.stringify(message.content).includes("original"),
			),
		).toBe(true);
		expect(dispose).toHaveBeenCalledTimes(2);
	});

	it.each(["PASS", "REVISE", "BLOCK"] as const)("accepts structured Reviewer %s", async (result) => {
		harness.setResponses([submitReview(result)]);
		expect(await executor.execute(reviewer())).toMatchObject({ role: "Reviewer", review: { ...review, result } });
	});

	// RC-04: evidence mistakes must be tool errors, not accepted results or terminal worker failures.
	it.each([
		["unknown top-level", { evidenceRefs: ["invented"] }],
		["filename", { evidenceRefs: ["src/app.ts"] }],
		["diffDigest", { evidenceRefs: ["digest-1"] }],
		["description", { evidenceRefs: ["fixture evidence from trusted verifier"] }],
		["nonexact reference", { evidenceRefs: [" diff-1 "] }],
		["missing top-level", { evidenceRefs: [] }],
		["unknown criterion", { criteria: [{ criterionId: "AC-001", status: "MET", evidenceRefs: ["invented"] }] }],
		["missing PASS criterion evidence", { criteria: [{ criterionId: "AC-001", status: "MET", evidenceRefs: [] }] }],
	])("RC-04 rejects %s then accepts exact references in the same Reviewer session", async (_name, invalid) => {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("submit_review", { ...review, ...invalid }), { stopReason: "toolUse" }),
			(context) => {
				const error = context.messages.at(-1);
				expect(error).toMatchObject({ role: "toolResult", toolName: "submit_review", isError: true });
				expect(JSON.stringify(error)).toContain("Review evidence validation failed");
				expect(JSON.stringify(error)).toContain("diff-1");
				expect(dispose).not.toHaveBeenCalled();
				expect(workers).toHaveLength(1);
				return submitReview();
			},
		]);
		expect(await executor.execute(reviewer())).toMatchObject({ role: "Reviewer", review });
		expect(workers).toHaveLength(1);
		expect(harness.faux.state.callCount).toBe(2);
		expect(store.snapshot.runs[0].roleSessionRefs).toHaveLength(1);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(executor.safeToRelease).toBe(true);
	});

	it("RC-04 supplies the exact deduplicated union, including check-only references", async () => {
		const request = reviewer();
		if (request.role !== "Reviewer") throw new Error("Reviewer required");
		request.verification.checks = [
			{
				id: "regression",
				runId: "run-1",
				revision: 0,
				kind: "test",
				status: "PASS",
				required: true,
				exitCode: 0,
				reason: "Fixture",
				evidenceRefs: ["diff-1", "check-1"],
				diffDigest: "digest-1",
			},
		];
		request.verification.reviewContext!.evidence.push({ ref: "check-1", content: "Check passed" });
		request.handoff.tests_run = ["untrusted-handoff-ref"];
		const expected = {
			...review,
			evidenceRefs: ["check-1"],
			criteria: [{ ...review.criteria[0], evidenceRefs: ["check-1"] }],
		};
		harness.setResponses([
			(context) => {
				const message = context.messages.find((item) => item.role === "user");
				if (!message || message.role !== "user") throw new Error("Missing JSON input");
				const content =
					typeof message.content === "string"
						? message.content
						: message.content
								.filter((part) => part.type === "text")
								.map((part) => part.text)
								.join("");
				expect(JSON.parse(content).trustedEvidenceRefs).toEqual(["diff-1", "check-1"]);
				expect(context.systemPrompt).toContain("copy only exact strings from trustedEvidenceRefs");
				expect(context.systemPrompt).toContain("same session");
				return fauxAssistantMessage(fauxToolCall("submit_review", expected), { stopReason: "toolUse" });
			},
		]);
		expect(await executor.execute(request)).toMatchObject({ role: "Reviewer", review: expected });
	});

	it.each(["REVISE", "BLOCK"] as const)(
		"RC-04 preserves %s evidence policy while allowing correction",
		async (result) => {
			const valid = {
				...review,
				result,
				criteria: [{ criterionId: "AC-001", status: "UNVERIFIED", evidenceRefs: [] }],
			};
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("submit_review", { ...valid, evidenceRefs: [] }), {
					stopReason: "toolUse",
				}),
				(context) => {
					expect(context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true });
					return fauxAssistantMessage(
						fauxToolCall("submit_review", {
							...valid,
							criteria: [{ ...valid.criteria[0], evidenceRefs: ["unknown"] }],
						}),
						{ stopReason: "toolUse" },
					);
				},
				(context) => {
					expect(context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true });
					return fauxAssistantMessage(fauxToolCall("submit_review", valid), { stopReason: "toolUse" });
				},
			]);
			expect(await executor.execute(reviewer())).toMatchObject({ role: "Reviewer", review: valid });
			expect(workers).toHaveLength(1);
		},
	);

	it.each([
		["task goal text", { task: "Fix bug" }],
		["runId", { runId: "other-run" }],
		["revision", { revision: 7 }],
		["diffDigest", { diffDigest: "stale-digest" }],
	])("corrects a wrong review %s in the same Reviewer session", async (_field, wrong) => {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("submit_review", { ...review, ...wrong }), { stopReason: "toolUse" }),
			(context) => {
				const error = context.messages.at(-1);
				expect(error).toMatchObject({ role: "toolResult", toolName: "submit_review", isError: true });
				expect(JSON.stringify(error)).toContain("Review identity validation failed");
				expect(JSON.stringify(error)).toContain("diffDigest: digest-1");
				expect(context.systemPrompt).not.toContain("unresolved contains only task requirements");
				expect(dispose).not.toHaveBeenCalled();
				expect(workers).toHaveLength(1);
				return submitReview();
			},
		]);
		expect(await executor.execute(reviewer())).toMatchObject({ role: "Reviewer", review });
		expect(workers).toHaveLength(1);
		expect(harness.faux.state.callCount).toBe(2);
		expect(store.snapshot.actions).toEqual([]);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(executor.safeToRelease).toBe(true);
	});

	it.each(["no-resubmission", "turn-limit", "identity-loop", "cancel", "forbidden-tool", "mixed-submit"])(
		"RC-04 retry does not bypass %s termination",
		async (mode) => {
			const controller = new AbortController();
			const runner =
				mode === "turn-limit"
					? await PiAgentExecutor.create({ ...options, maxTurns: 1 })
					: mode === "identity-loop"
						? await PiAgentExecutor.create({ ...options, maxTurns: 2 })
						: executor;
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("submit_review", { ...review, evidenceRefs: ["unknown"] }), {
					stopReason: "toolUse",
				}),
				() => {
					if (mode === "cancel") controller.abort();
					if (mode === "no-resubmission") return fauxAssistantMessage("PASS done");
					if (mode === "identity-loop")
						return fauxAssistantMessage(fauxToolCall("submit_review", { ...review, revision: 9 }), {
							stopReason: "toolUse",
						});
					if (mode === "forbidden-tool")
						return fauxAssistantMessage(
							fauxToolCall("runtime_write", { path: "src/app.ts", content: "forbidden" }),
							{ stopReason: "toolUse" },
						);
					if (mode === "mixed-submit")
						return fauxAssistantMessage(
							[fauxToolCall("submit_review", review), fauxToolCall("runtime_read", { path: "src/app.ts" })],
							{ stopReason: "toolUse" },
						);
					return submitReview();
				},
			]);
			await expect(runner.execute({ ...reviewer(), signal: controller.signal })).rejects.toThrow(
				mode === "identity-loop" ? "Worker turn limit exceeded" : undefined,
			);
			expect(workers).toHaveLength(1);
			expect(dispose).toHaveBeenCalledTimes(1);
			expect(runner.safeToRelease).toBe(true);
			expect(readFileSync(join(workspace, "src/app.ts"), "utf8")).toBe("original\n");
		},
	);

	// RC-04: only known Developer submission mistakes are recoverable, not execution/Policy failures.
	it.each([
		" Reviewer PASS pending ",
		"SELF-CHECK needed!",
		"final TEST remains pending",
		"Human Approval is still pending.",
	])("RC-04 corrects a whole-entry obligation variant in the same Developer session: %s", async (obligation) => {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("submit_handoff", { ...handoff, unresolved: [obligation] }), {
				stopReason: "toolUse",
			}),
			(context) => {
				expect(context.messages.at(-1)).toMatchObject({
					role: "toolResult",
					toolName: "submit_handoff",
					isError: true,
				});
				expect(JSON.stringify(context.messages.at(-1))).toContain("Handoff unresolved validation failed");
				expect(dispose).not.toHaveBeenCalled();
				return submitHandoff();
			},
		]);
		expect(await executor.execute(developer())).toMatchObject({ role: "Developer", handoff });
		expect(workers).toHaveLength(1);
		expect(store.snapshot.runs[0].roleSessionRefs).toHaveLength(1);
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it.each([
		["task goal text", { task: "Fix bug" }],
		["runId", { runId: "other-run" }],
		["revision", { revision: 7 }],
	])("corrects a wrong handoff %s in the same Developer session", async (_field, wrong) => {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("submit_handoff", { ...handoff, ...wrong }), { stopReason: "toolUse" }),
			(context) => {
				const error = context.messages.at(-1);
				expect(error).toMatchObject({ role: "toolResult", toolName: "submit_handoff", isError: true });
				expect(JSON.stringify(error)).toContain("Handoff identity validation failed");
				expect(JSON.stringify(error)).toContain("task: task-1");
				expect(JSON.stringify(error)).toContain("the task id, not the goal text");
				expect(context.systemPrompt).toContain(
					"For example, 'Independent Reviewer PASS is required and remains pending.' is not unresolved implementation",
				);
				expect(dispose).not.toHaveBeenCalled();
				expect(workers).toHaveLength(1);
				return submitHandoff();
			},
		]);
		expect(await executor.execute(developer())).toMatchObject({ role: "Developer", handoff });
		expect(workers).toHaveLength(1);
		expect(harness.faux.state.callCount).toBe(2);
		expect(store.snapshot.runs[0].roleSessionRefs).toHaveLength(1);
		expect(store.snapshot.actions).toEqual([]);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(executor.safeToRelease).toBe(true);
	});

	it("does not consume an unrelated Policy denial after a correctable identity error", async () => {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("submit_handoff", { ...handoff, runId: "other-run" }), {
				stopReason: "toolUse",
			}),
			(context) => {
				expect(JSON.stringify(context.messages.at(-1))).toContain("Handoff identity validation failed");
				return fauxAssistantMessage(fauxToolCall("runtime_write", { path: ".ai/state.json", content: "x" }), {
					stopReason: "toolUse",
				});
			},
			submitHandoff(),
		]);
		await expect(executor.execute(developer())).rejects.toThrow();
		expect(store.snapshot.actions.some((action) => action.status === "DENIED")).toBe(true);
		expect(readFileSync(join(workspace, "src/app.ts"), "utf8")).toBe("original\n");
		expect(harness.faux.state.callCount).toBe(2);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(executor.safeToRelease).toBe(true);
	});

	it("keeps a provider error fatal after a correctable identity error", async () => {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("submit_handoff", { ...handoff, revision: 3 }), { stopReason: "toolUse" }),
			fauxAssistantMessage("", { stopReason: "error", errorMessage: "provider exploded" }),
		]);
		await expect(executor.execute(developer())).rejects.toThrow("Worker provider failed");
		expect(store.snapshot.actions).toEqual([]);
		expect(dispose).toHaveBeenCalledTimes(1);
		expect(executor.safeToRelease).toBe(true);
	});

	it.each(["no-resubmission", "turn-limit", "identity-loop", "cancel", "timeout", "forbidden-tool", "mixed-submit"])(
		"RC-04 handoff correction does not bypass %s termination",
		async (mode) => {
			const controller = new AbortController();
			const runner = await PiAgentExecutor.create({
				...options,
				maxTurns: mode === "turn-limit" ? 1 : mode === "identity-loop" ? 2 : 32,
				timeoutMs: mode === "timeout" ? 250 : 3000,
			});
			harness.setResponses([
				fauxAssistantMessage(
					fauxToolCall("submit_handoff", { ...handoff, unresolved: ["Independent Reviewer PASS is required"] }),
					{ stopReason: "toolUse" },
				),
				async (_context, streamOptions) => {
					if (mode === "cancel") controller.abort();
					if (mode === "timeout")
						await new Promise<void>((resolve) => {
							if (streamOptions?.signal?.aborted) resolve();
							else streamOptions?.signal?.addEventListener("abort", () => resolve(), { once: true });
						});
					if (mode === "no-resubmission") return fauxAssistantMessage("Done");
					if (mode === "identity-loop")
						return fauxAssistantMessage(fauxToolCall("submit_handoff", { ...handoff, task: "Fix bug" }), {
							stopReason: "toolUse",
						});
					if (mode === "forbidden-tool")
						return fauxAssistantMessage(
							fauxToolCall("runtime_write", { path: ".ai/state.json", content: "forbidden" }),
							{ stopReason: "toolUse" },
						);
					if (mode === "mixed-submit")
						return fauxAssistantMessage(
							[fauxToolCall("submit_handoff", handoff), fauxToolCall("runtime_read", { path: "src/app.ts" })],
							{ stopReason: "toolUse" },
						);
					return submitHandoff();
				},
			]);
			await expect(runner.execute({ ...developer(), signal: controller.signal })).rejects.toThrow(
				mode === "timeout" ? "timed out" : mode === "identity-loop" ? "Worker turn limit exceeded" : undefined,
			);
			expect(workers).toHaveLength(1);
			expect(dispose).toHaveBeenCalledTimes(1);
			expect(runner.safeToRelease).toBe(true);
			expect(readFileSync(join(workspace, "src/app.ts"), "utf8")).toBe("original\n");
		},
	);

	it.each(["R0", "R1"] as const)(
		"RC-04 Developer feedback does not rewrite QUICK/%s Executor unresolved",
		async (risk) => {
			const scope = { risk, targetPath: risk === "R0" ? null : "src/app.ts" };
			const executionMode = risk === "R0" ? "READ_ONLY" : "EDIT";
			const runner = await PiAgentExecutor.create({
				...options,
				quickScope: scope,
				executionContract: { runId: "run-1", mode: executionMode },
			});
			const result = {
				...handoff,
				role: "Executor",
				unresolved: ["SELF_CHECK is required."],
				criteria: [{ criterionId: "AC-001", status: "MET", explanation: "Fixture" }],
			};
			harness.setResponses([
				(context) => {
					expect(context.systemPrompt).toContain(
						"unresolved contains only task requirements or implementation problems you could not finish",
					);
					expect(context.systemPrompt).toContain("Never hide real blockers");
					expect(context.systemPrompt).toContain("Runtime-owned obligations");
					expect(context.systemPrompt).toContain(
						"Report every frozen acceptance criterion exactly once by its exact ID in criteria[] with its status",
					);
					expect(context.systemPrompt).not.toContain("'Required input validation is not implemented.' is.");
					return fauxAssistantMessage(fauxToolCall("submit_handoff", result), { stopReason: "toolUse" });
				},
			]);
			expect(
				await runner.execute({ ...developer(), executionMode, role: "Executor", profile: "coding", scope }),
			).toMatchObject({
				role: "Executor",
				handoff: result,
			});
			expect(harness.faux.state.callCount).toBe(1);
		},
	);

	it.each([
		"../outside.ts",
		"absolute",
		".ai/state.json",
		".ai/config.yaml",
		".git/config",
		"src/.env",
		"src/policy.ts",
		"package.json",
	])("blocks child mutation %s without a parent tool hook", async (path) => {
		if (path === "absolute") path = join(harness.tempDir, "outside.ts");
		const before = readFileSync(join(workspace, ".ai/state.json"), "utf8");
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("runtime_write", { path, content: "forbidden" }), { stopReason: "toolUse" }),
			submitHandoff(),
		]);
		const result = await kernel.advance("implement");
		expect(result.status).toBe("FAILED");
		expect(store.snapshot.actions).toHaveLength(1);
		expect(store.snapshot.actions[0].status).toBe("DENIED");
		expect(readFileSync(join(workspace, "src/app.ts"), "utf8")).toBe("original\n");
		expect(readFileSync(join(workspace, ".ai/state.json"), "utf8")).not.toBe("forbidden");
		expect(before).not.toBe("forbidden");
		expect(workers[0].resourceLoader.getExtensions().extensions).toEqual([]);
		expect(events.some((event) => event.type === "AgentFailed")).toBe(true);
		expect(events.some((event) => event.type === "AgentCompleted")).toBe(false);
	});

	it.each(["runtime_write", "runtime_edit", "bash", "write"])("Reviewer cannot execute %s", async (tool) => {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall(tool, { path: "src/app.ts", content: "forbidden", command: "false" }), {
				stopReason: "toolUse",
			}),
		]);
		await expect(executor.execute(reviewer())).rejects.toThrow();
		expect(store.snapshot.actions).toEqual([]);
		expect(readFileSync(join(workspace, "src/app.ts"), "utf8")).toBe("original\n");
	});

	it.each([
		{ ...handoff, role: "Reviewer" },
		{ ...handoff, summary: undefined },
		{ ...handoff, task: undefined },
	])("rejects malformed handoff schema %j", async (bad) => {
		harness.setResponses([fauxAssistantMessage(fauxToolCall("submit_handoff", bad), { stopReason: "toolUse" })]);
		await expect(executor.execute(developer())).rejects.toThrow();
		expect(dispose).toHaveBeenCalledTimes(1);
	});
	it.each([
		{ ...review, role: "Developer" },
		{ ...review, result: "DONE" },
		{ ...review, diffDigest: undefined },
	])("rejects malformed review schema %j", async (bad) => {
		harness.setResponses([fauxAssistantMessage(fauxToolCall("submit_review", bad), { stopReason: "toolUse" })]);
		await expect(executor.execute(reviewer())).rejects.toThrow();
	});
	it("rejects natural-language completion and mixed submit/mutation batches", async () => {
		harness.setResponses([fauxAssistantMessage("PASS. Done.")]);
		await expect(executor.execute(developer())).rejects.toThrow();
		const fresh = await PiAgentExecutor.create(options);
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("submit_handoff", handoff),
					fauxToolCall("runtime_write", { path: "src/app.ts", content: "forbidden" }),
				],
				{ stopReason: "toolUse" },
			),
		]);
		await expect(fresh.execute(developer())).rejects.toThrow();
		expect(readFileSync(join(workspace, "src/app.ts"), "utf8")).toBe("original\n");
		expect(store.snapshot.actions).toEqual([]);
	});

	it("uses only explicit resources despite project/global extensions, skills, prompts and SYSTEM files", async () => {
		for (const dir of [join(workspace, ".pi"), options.agentDir]) {
			mkdirSync(join(dir, "extensions"), { recursive: true });
			mkdirSync(join(dir, "skills", "trap"), { recursive: true });
			mkdirSync(join(dir, "prompts"), { recursive: true });
			writeFileSync(join(dir, "extensions", "company.ts"), `throw new Error('COMPANY_RECURSION_TRAP');`);
			writeFileSync(join(dir, "skills/trap/SKILL.md"), "---\nname: trap\ndescription: trap\n---\nRESOURCE_TRAP");
			writeFileSync(join(dir, "prompts/trap.md"), "RESOURCE_TRAP");
			writeFileSync(join(dir, "SYSTEM.md"), "RESOURCE_TRAP");
			writeFileSync(join(dir, "APPEND_SYSTEM.md"), "RESOURCE_TRAP");
			writeFileSync(join(dir, "AGENTS.md"), "RESOURCE_TRAP");
		}
		writeFileSync(join(workspace, "AGENTS.md"), "RESOURCE_TRAP");
		harness.setResponses([submitHandoff()]);
		await executor.execute(developer());
		const loader = workers[0].resourceLoader;
		expect(loader.getExtensions().extensions).toEqual([]);
		expect(loader.getExtensions().errors).toEqual([]);
		expect(loader.getSkills().skills).toEqual([]);
		expect(loader.getPrompts().prompts).toEqual([]);
		expect(loader.getAgentsFiles().agentsFiles).toEqual([]);
		expect(workers[0].systemPrompt).toContain("Explicit reviewed project rules");
		expect(workers[0].systemPrompt).not.toContain("RESOURCE_TRAP");
	});

	it.each(["profile", "provider", "model", "auth"])(
		"fails %s preflight without creating/prompting a worker or fallback",
		async (mode) => {
			const config = structuredClone(options.config);
			if (mode === "profile") Reflect.deleteProperty(config.models.profiles, "reasoning");
			if (mode === "provider") config.models.profiles.reasoning.provider = "missing-provider";
			if (mode === "model") config.models.profiles.reasoning.model = "missing-model";
			if (mode === "auth") vi.spyOn(options.modelRuntime, "getAuth").mockResolvedValue(undefined);
			await expect(PiAgentExecutor.create({ ...options, config })).rejects.toThrow();
			expect(workers).toEqual([]);
			expect(harness.faux.state.callCount).toBe(0);
		},
	);
	it("rechecks authentication immediately before execution", async () => {
		vi.spyOn(options.modelRuntime, "checkAuth").mockResolvedValue(undefined);
		await expect(executor.execute(developer())).rejects.toThrow();
		expect(workers).toEqual([]);
		expect(harness.faux.state.callCount).toBe(0);
	});
	it("does not prompt if session reference persistence fails", async () => {
		await expect(
			executor.execute({
				...developer(),
				onSessionCreated: async () => {
					throw new Error("Disk failure");
				},
			}),
		).rejects.toThrow();
		expect(workers).toEqual([]);
		expect(harness.faux.state.callCount).toBe(0);
		expect(dispose).toHaveBeenCalledTimes(1);
	});
	it("requires explicit fresh review material, not references alone", async () => {
		const request = reviewer();
		if (request.role === "Reviewer") delete request.verification.reviewContext;
		await expect(executor.execute(request)).rejects.toThrow("explicit material");
		expect(workers).toEqual([]);
	});
	it("records registered check requests without executing a verifier or fabricating evidence", async () => {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("runtime_request_check", { id: "regression" }), { stopReason: "toolUse" }),
			submitHandoff(),
		]);
		await executor.execute(developer());
		expect(JSON.stringify(workers[0].messages)).toContain("UNAVAILABLE");
		expect(store.snapshot.actions).toEqual([]);
	});

	it.each(["abort", "timeout"])(
		"handles %s, rejects late result, disposes and prevents subsequent roles/actions",
		async (mode) => {
			const controller = new AbortController();
			const runner = mode === "timeout" ? await PiAgentExecutor.create({ ...options, timeoutMs: 250 }) : executor;
			let started!: () => void;
			const entered = new Promise<void>((resolve) => {
				started = resolve;
			});
			harness.setResponses([
				async (_context, streamOptions) => {
					started();
					await new Promise<void>((resolve) => {
						if (streamOptions?.signal?.aborted) resolve();
						else streamOptions?.signal?.addEventListener("abort", () => resolve(), { once: true });
					});
					return fauxAssistantMessage(fauxToolCall("runtime_write", { path: "src/app.ts", content: "late" }), {
						stopReason: "toolUse",
					});
				},
			]);
			const pending = runner.execute({ ...developer(), signal: controller.signal });
			await Promise.race([entered, pending]);
			if (mode === "abort") controller.abort();
			await expect(pending).rejects.toThrow(mode === "timeout" ? "timed out" : "aborted");
			await expect(runner.execute(reviewer())).rejects.toThrow("run stopped");
			expect(store.snapshot.actions).toEqual([]);
			expect(readFileSync(join(workspace, "src/app.ts"), "utf8")).toBe("original\n");
			expect(workers).toHaveLength(1);
			expect(dispose).toHaveBeenCalledTimes(1);
		},
	);
	it("aborts from Kernel signal without COMPLETE or next role", async () => {
		const controller = new AbortController();
		harness.setResponses([
			() => {
				controller.abort();
				return submitHandoff();
			},
		]);
		const result = await kernel.advance("implement", controller.signal);
		expect(result.status).toBe("CANCELLED");
		expect(events.some((event) => event.type === "RunCompleted" || event.type === "AgentCompleted")).toBe(false);
		await expect(kernel.advance("review")).rejects.toThrow();
		expect(workers).toHaveLength(1);
	});
	it("denies symlink escape through the actual SDK tool", async () => {
		const target = join(harness.tempDir, "outside.ts");
		writeFileSync(target, "untouched");
		symlinkSync(target, join(workspace, "src/link.ts"));
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("runtime_write", { path: "src/link.ts", content: "forbidden" }), {
				stopReason: "toolUse",
			}),
		]);
		await expect(executor.execute(developer())).rejects.toThrow();
		expect(readFileSync(target, "utf8")).toBe("untouched");
		expect(store.snapshot.actions[0].status).toBe("DENIED");
	});
	it("does not run later tools in a batch after a denial", async () => {
		harness.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("runtime_write", { path: ".ai/state.json", content: "forbidden" }),
					fauxToolCall("runtime_write", { path: "src/app.ts", content: "late" }),
				],
				{ stopReason: "toolUse" },
			),
		]);
		await expect(executor.execute(developer())).rejects.toThrow();
		expect(store.snapshot.actions).toHaveLength(1);
		expect(readFileSync(join(workspace, "src/app.ts"), "utf8")).toBe("original\n");
	});
	it("blocks actual mutation on policy persistence failure", async () => {
		vi.spyOn(store, "prepare").mockRejectedValue(new Error("Disk failure"));
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("runtime_write", { path: "src/app.ts", content: "forbidden" }), {
				stopReason: "toolUse",
			}),
		]);
		await expect(executor.execute(developer())).rejects.toThrow();
		expect(readFileSync(join(workspace, "src/app.ts"), "utf8")).toBe("original\n");
		expect(store.snapshot.actions).toEqual([]);
	});
	it("bounds turns and disables provider/agent retries", async () => {
		const runner = await PiAgentExecutor.create({ ...options, maxTurns: 1 });
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("runtime_read", { path: "src/app.ts" }), { stopReason: "toolUse" }),
			submitHandoff(),
		]);
		await expect(runner.execute(developer())).rejects.toThrow("turn limit");
		expect(workers[0].autoRetryEnabled).toBe(false);
		expect(workers[0].autoCompactionEnabled).toBe(false);
		expect(workers[0].agent.toolExecution).toBe("sequential");
	});
	it("refuses concurrent roles while a worker is running", async () => {
		let release!: () => void;
		let started!: () => void;
		const entered = new Promise<void>((resolve) => {
			started = resolve;
		});
		const wait = new Promise<void>((resolve) => {
			release = resolve;
		});
		harness.setResponses([
			async () => {
				started();
				await wait;
				return submitHandoff();
			},
		]);
		const first = executor.execute(developer());
		await Promise.race([entered, first]);
		try {
			await expect(executor.execute(reviewer())).rejects.toThrow("already active");
		} finally {
			release();
			await first;
		}
		expect(workers).toHaveLength(1);
	});
	it("rejects agent directories and transcript symlinks inside the workspace", async () => {
		const local = join(workspace, "..agent");
		mkdirSync(local);
		await expect(PiAgentExecutor.create({ ...options, agentDir: local })).rejects.toThrow("outside");
		mkdirSync(join(options.agentDir, "sessions"));
		symlinkSync(join(workspace, ".ai"), join(options.agentDir, "sessions/company-runtime"));
		await expect(executor.execute(developer())).rejects.toThrow("session creation");
		expect(harness.faux.state.callCount).toBe(0);
	});
	it("rejects unknown check requests instead of executing arbitrary checks", async () => {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("runtime_request_check", { id: "unregistered" }), { stopReason: "toolUse" }),
		]);
		await expect(executor.execute(developer())).rejects.toThrow();
		expect(store.snapshot.actions).toEqual([]);
	});
	it("does not start a provider request when cancelled during SDK prompt preflight", async () => {
		const controller = new AbortController();
		const spy = vi.spyOn(AgentSession.prototype, "prompt");
		const prompt = spy.getMockImplementation()!;
		spy.mockImplementation(function (this: AgentSession, ...args) {
			controller.abort();
			return prompt.apply(this, args);
		});
		harness.setResponses([submitHandoff()]);
		await expect(executor.execute({ ...developer(), signal: controller.signal })).rejects.toThrow();
		expect(harness.faux.state.callCount).toBe(0);
		expect(store.snapshot.actions).toEqual([]);
		expect(dispose).toHaveBeenCalledTimes(1);
	});
	it("carries a bounded task context pack into the worker prompt as advisory context", async () => {
		const prompts: string[] = [];
		const spy = vi.spyOn(AgentSession.prototype, "prompt");
		const original = spy.getMockImplementation()!;
		spy.mockImplementation(function (this: AgentSession, ...args) {
			prompts.push(String(args[0]));
			return original.apply(this, args);
		});
		const pack = {
			version: 1,
			digest: `sha256:${"a".repeat(64)}`,
			mode: "bounded" as const,
			targetSymbols: [],
			relatedFiles: [{ path: "src/app.ts", reasons: ["acceptance-scope"] }],
			projectRules: { kind: "none" as const, path: null, digest: null, bytes: null },
			snippets: [
				{
					path: "src/app.ts",
					startLine: 1,
					endLine: 1,
					fileDigest: `sha256:${"b".repeat(64)}`,
					snippetDigest: `sha256:${"c".repeat(64)}`,
					text: "original",
				},
			],
			unknowns: [],
			truncated: false,
		};
		let systemPrompt = "";
		harness.setResponses([
			(context) => {
				systemPrompt = context.systemPrompt ?? "";
				return submitHandoff();
			},
		]);
		await executor.execute({ ...developer(), taskContextPack: pack });
		const withPack = prompts.at(-1)!;
		expect(withPack).toContain('"taskContextPack"');
		expect(systemPrompt).toContain("advisory starting context");
		expect(systemPrompt).toContain("cannot replace a receipt");
		expect(withPack).not.toContain("onSessionCreated");
		expect(withPack).not.toContain("AbortSignal");
		expect(withPack).not.toContain('"lsp"');
		expect(withPack).not.toContain("PROJECT_PRIVATE_MARKER");

		systemPrompt = "";
		harness.setResponses([
			(context) => {
				systemPrompt = context.systemPrompt ?? "";
				return submitHandoff();
			},
		]);
		await executor.execute(developer());
		const withoutPack = prompts.at(-1)!;
		expect(withoutPack).not.toContain("taskContextPack");
		expect(systemPrompt).not.toContain("advisory starting context");
	});

	it("fails closed when a task context pack pushes the worker prompt past the limit", async () => {
		harness.setResponses([submitHandoff()]);
		const huge = {
			version: 1,
			digest: `sha256:${"a".repeat(64)}`,
			mode: "bounded" as const,
			targetSymbols: [],
			relatedFiles: [],
			projectRules: { kind: "none" as const, path: null, digest: null, bytes: null },
			snippets: [
				{
					path: "src/app.ts",
					startLine: 1,
					endLine: 1,
					fileDigest: "d",
					snippetDigest: "e",
					text: "x".repeat(600000),
				},
			],
			unknowns: [],
			truncated: false,
		};
		await expect(executor.execute({ ...developer(), taskContextPack: huge })).rejects.toThrow();
	});

	it("tells workers that verifier trust sources are protected oracle inputs", async () => {
		mkdirSync(join(workspace, "test"), { recursive: true });
		writeFileSync(join(workspace, "test/oracle.mjs"), "console.log('oracle');\n");
		const strict = parseRuntimeConfig(
			JSON.stringify({
				schemaVersion: 1,
				models: {
					profiles: {
						coding: { provider: "faux", model: "coding-model" },
						reasoning: { provider: "faux", model: "review-model" },
					},
				},
				files: { allowed_paths: ["src", "test"] },
				verification: {
					trust: { mode: "strict" },
					checks: [
						{
							id: "regression",
							kind: "test",
							executable: process.execPath,
							args: ["test/oracle.mjs"],
							trust: { files: ["test/oracle.mjs"] },
						},
					],
				},
			}),
		);
		const runner = await PiAgentExecutor.create({ ...options, config: strict });
		let captured = "";
		harness.setResponses([
			(context) => {
				captured = context.systemPrompt ?? "";
				return submitReview();
			},
		]);
		await runner.execute(reviewer());
		expect(captured).toContain("Verifier trust sources are Host-owned protected oracle inputs");
		expect(captured).toContain("test/oracle.mjs");
		expect(captured).toContain("do not read, search, list, navigate with LSP, edit, write or delete them");
		expect(captured).toContain("never for protected project instructions or verifier trust sources");
	});

	it("starts the worker span with the requested profile provider/model and the actual identity at the end", async () => {
		const starts: Array<{ name: string; attributes: Record<string, unknown> }> = [];
		const ends: Array<Record<string, unknown>> = [];
		const span = {
			startSpan: async <T>(_options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) =>
				await callback(span as unknown as TelemetrySpan),
			addEvent: () => {},
			setAttributes: (attributes: Record<string, unknown>) => {
				ends.push(attributes);
			},
			setStatus: () => {},
		};
		const telemetry: TelemetryContext = {
			startSpan: async <T>(options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) => {
				starts.push({ name: options.name, attributes: options.attributes ?? {} });
				return await callback(span as unknown as TelemetrySpan);
			},
		};
		const runner = await PiAgentExecutor.create({ ...options, telemetry });
		harness.setResponses([submitHandoff()]);
		await runner.execute(developer());
		expect(starts).toHaveLength(1);
		expect(starts[0].name).toBe("weavra.worker");
		expect(starts[0].attributes).toEqual({
			role: "Developer",
			profile: "coding",
			revision: 0,
			provider: "faux",
			model: "coding-model",
		});
		expect(ends[0]).toMatchObject({ outcome: "SUCCEEDED", actualProvider: "faux", actualModel: "coding-model" });
	});

	it("keeps the worker result when the telemetry context and span methods fail", async () => {
		const telemetry: TelemetryContext = {
			startSpan: async <T>(_options: SpanOptions, callback: (span: TelemetrySpan) => T | Promise<T>) => {
				await callback({
					startSpan: async () => undefined,
					addEvent: () => {
						throw new Error("telemetry down");
					},
					setAttributes: () => {
						throw new Error("telemetry down");
					},
					setStatus: () => {
						throw new Error("telemetry down");
					},
				} as unknown as TelemetrySpan);
				throw new Error("flush failed");
			},
		};
		const runner = await PiAgentExecutor.create({ ...options, telemetry });
		harness.setResponses([submitHandoff()]);
		await expect(runner.execute(developer())).resolves.toMatchObject({ role: "Developer" });
		expect(harness.faux.state.callCount).toBe(1);
	});

	it("rejects pre-aborted input without a session or tool execution", async () => {
		await expect(executor.execute({ ...developer(), signal: AbortSignal.abort() })).rejects.toThrow();
		await expect(executor.execute(reviewer())).rejects.toThrow();
		expect(workers).toEqual([]);
		expect(store.snapshot.actions).toEqual([]);
	});
});
