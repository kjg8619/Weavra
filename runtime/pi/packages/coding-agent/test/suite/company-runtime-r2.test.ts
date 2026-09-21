import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../../../company-runtime/src/agent-runner.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { Review, Run } from "../../../company-runtime/src/contracts.ts";
import type { RuntimeEvent } from "../../../company-runtime/src/events.ts";
import { registerCompanyRuntime } from "../../../company-runtime/src/extension.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import { formatWorkflowReport, StandardWorkflow } from "../../../company-runtime/src/workflow.ts";
import type { ExtensionCommandContext, RegisteredCommand } from "../../src/index.ts";
import { workflowContract } from "./company-contract.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness;
let cwd: string;
let agentDir: string;
let config: RuntimeConfig;
let workflow: StandardWorkflow;
let events: RuntimeEvent[];
let onEvent: ((event: RuntimeEvent) => void) | undefined;
const goal = "Update dependency in package.json and package-lock.json";
const manifests = ["package.json", "package-lock.json"];
const git = (...argv: string[]) =>
	execFileSync("git", argv, {
		cwd,
		env: { PATH: process.env.PATH, HOME: agentDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		stdio: "pipe",
	}).toString();
function input(context: Context): AgentExecutionRequest {
	const user = context.messages.find((message) => message.role === "user");
	if (!user || user.role !== "user") throw new Error("Missing worker input");
	return JSON.parse(
		typeof user.content === "string"
			? user.content
			: user.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
	) as AgentExecutionRequest;
}
const edit = (path: string) =>
	fauxAssistantMessage(fauxToolCall("runtime_edit", { path, oldText: "1.0.0", newText: "2.0.0" }), {
		stopReason: "toolUse",
	});
function handoff(context: Context) {
	const request = input(context);
	expect(request.role).toBe("Developer");
	expect(request).toMatchObject({ risk: "R2", reviewRequired: true });
	return fauxAssistantMessage(
		[
			fauxThinking("PRIVATE_IMPLEMENTATION_REASONING"),
			fauxToolCall("submit_handoff", {
				runId: request.runId,
				revision: request.revision,
				task: request.task.id,
				role: "Developer",
				summary: "Updated fixture dependency metadata without installing anything",
				changed_files: manifests,
				assumptions: [],
				tests_run: [],
				known_risks: [],
				unresolved: [],
			}),
		],
		{ stopReason: "toolUse" },
	);
}
function handoffWithUnresolved(unresolved: string[]) {
	return (context: Context) => {
		const response = handoff(context);
		for (const part of response.content) if (part.type === "toolCall") part.arguments.unresolved = [...unresolved];
		return response;
	};
}
function review(verdict: Review["result"] = "PASS") {
	return (context: Context) => {
		const request = input(context);
		if (request.role !== "Reviewer") throw new Error("Independent Reviewer required");
		expect(request).toMatchObject({ risk: "R2", reviewRequired: true });
		expect(JSON.stringify(context)).not.toContain("PRIVATE_IMPLEMENTATION_REASONING");
		expect(request.verification.changedFiles?.sort()).toEqual([...manifests].sort());
		expect(request.verification.reviewContext?.diff).toContain("2.0.0");
		expect(
			request.verification.reviewContext?.evidence.some((item) => item.content.includes("R2_CHECK_PASSED")),
		).toBe(true);
		expect(context.tools?.map((tool) => tool.name)).toEqual([
			"runtime_read",
			"runtime_search",
			"runtime_list_files",
			"submit_review",
		]);
		return fauxAssistantMessage(
			fauxToolCall("submit_review", {
				runId: request.runId,
				revision: request.revision,
				task: request.task.id,
				role: "Reviewer",
				result: verdict,
				diffDigest: request.verification.diffDigest,
				evidenceRefs: request.verification.evidenceRefs,
				issues: [],
				criteria: request.task.acceptanceCriteria.map((criterion) => ({
					criterionId: criterion.id,
					status: "MET",
					evidenceRefs: request.verification.evidenceRefs,
				})),
			}),
			{ stopReason: "toolUse" },
		);
	};
}
function create(taskGoal = goal, wrongBinding = false) {
	workflow = new StandardWorkflow({
		executionMode: "EDIT",
		cwd,
		goal: taskGoal,
		taskContract: workflowContract(taskGoal, config),
		config,
		events: {
			emit: (event) => {
				events.push(event);
				onEvent?.(event);
			},
		},
		createAgents: async (store, quickScope, r2RunId, _r3Scope, executionContract) => {
			const executor = await PiAgentExecutor.create({
				executionContract,
				cwd,
				agentDir,
				config,
				quickScope,
				r2RunId: wrongBinding ? "other" : r2RunId,
				audit: store,
				modelRuntime: harness.session.modelRuntime,
				timeoutMs: 3000,
			});
			return { executor, policy: executor.policyContext };
		},
	});
	return workflow;
}
function state() {
	return JSON.parse(readFileSync(join(cwd, ".ai/state.json"), "utf8")) as {
		runs: Run[];
		actions: Array<{ status: string; decision: { role: string; risk: string; decision: string } }>;
	};
}
beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding" }, { id: "review" }] });
	cwd = join(harness.tempDir, "project");
	agentDir = join(harness.tempDir, "workers");
	for (const path of ["scripts", ".ai", "src"]) mkdirSync(join(cwd, path), { recursive: true });
	mkdirSync(agentDir);
	config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			files: { allowed_paths: [...manifests, "src", ".ai", ".git"] },
			verification: {
				checks: [
					{
						id: "dependency-check",
						kind: "test",
						executable: process.execPath,
						args: ["scripts/check.mjs", "pass", join(agentDir, "marker")],
						timeout_ms: 3000,
					},
				],
			},
		}),
	);
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	writeFileSync(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n");
	writeFileSync(
		join(cwd, "package.json"),
		JSON.stringify({ private: true, dependencies: { "fixture-library": "1.0.0" } }),
	);
	writeFileSync(
		join(cwd, "package-lock.json"),
		JSON.stringify({ lockfileVersion: 3, packages: { "": { dependencies: { "fixture-library": "1.0.0" } } } }),
	);
	writeFileSync(join(cwd, "src/app.ts"), "original\n");
	writeFileSync(
		join(cwd, "scripts/check.mjs"),
		`import {readFileSync,writeFileSync} from 'node:fs';
const phase=JSON.parse(readFileSync('.ai/state.json','utf8')).runs[0].phase;
for(const path of ['package.json','package-lock.json']) if(!readFileSync(path,'utf8').includes('2.0.0')) process.exit(3);
const mode=process.argv[2];
if(mode==='fail-'+phase) process.exit(7);
if(mode==='mutate-'+phase) writeFileSync('src/app.ts','changed by check');
if(mode==='slow-'+phase){writeFileSync(process.argv[3],'started');setInterval(()=>{},1000);}
console.log('R2_CHECK_PASSED');
`,
	);
	git("init", "-q");
	git("add", "--", ".ai/config.yaml", ".gitignore", ...manifests, "src/app.ts", "scripts/check.mjs");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"R2 baseline",
	);
	events = [];
	onEvent = undefined;
});
afterEach(() => {
	vi.restoreAllMocks();
	harness.cleanup();
});

describe("S5B STANDARD/R2 with actual file Policy/checks and independent faux review", () => {
	it.each([goal, "Fix dependency typo in package.json"])(
		"selects STANDARD before execution for %s and completes only after review",
		async (taskGoal) => {
			harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review()]);
			const report = await create(taskGoal).execute();
			expect(report.error).toBeUndefined();
			expect(report.run).toMatchObject({ workflow: "STANDARD", risk: "R2", status: "COMPLETED", revisionCycle: 0 });
			expect(report.run?.roleSessionRefs.map((ref) => ref.role)).toEqual(["Developer", "Reviewer"]);
			expect(new Set(report.run?.roleSessionRefs.map((ref) => ref.sessionId)).size).toBe(2);
			expect(report.run?.verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
			expect(report.run?.review?.diffDigest).toBe(report.run?.workspace?.diffDigest);
			expect(state().runs[0]).toEqual(report.run);
			expect(state().actions.filter((item) => item.decision.role === "Developer")).toEqual([
				expect.objectContaining({
					status: "SUCCEEDED",
					decision: expect.objectContaining({ risk: "R2", decision: "ALLOW" }),
				}),
				expect.objectContaining({
					status: "SUCCEEDED",
					decision: expect.objectContaining({ risk: "R2", decision: "ALLOW" }),
				}),
			]);
			expect(events.flatMap((event) => (event.type === "StepStarted" ? [event.step.stepId] : []))).toEqual([
				"implement",
				"self-check",
				"review",
				"test",
				"complete",
			]);
			expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
			expect(formatWorkflowReport(report)).toContain("Review enforcement: REQUIRED (STANDARD/R2)");
			expect(formatWorkflowReport(report)).toContain("Risk: R2");
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);
	// RC-04: actual mutation/SELF_CHECK followed by malformed review must remain retryable, without a new role/attempt.
	it("RC-04 corrects malformed evidence in the same Reviewer session before Kernel PASS and COMPLETE", async () => {
		harness.setResponses([
			edit(manifests[0]),
			edit(manifests[1]),
			handoff,
			(context) => {
				const request = input(context);
				if (request.role !== "Reviewer") throw new Error("Reviewer required");
				const trusted = [
					...new Set([
						...request.verification.evidenceRefs,
						...request.verification.checks.flatMap((check) => check.evidenceRefs),
					]),
				];
				expect(request).toMatchObject({ trustedEvidenceRefs: trusted });
				const response = review()(context);
				for (const part of response.content)
					if (part.type === "toolCall") part.arguments.evidenceRefs = [request.verification.diffDigest];
				return response;
			},
			(context) => {
				expect(context.messages.at(-1)).toMatchObject({
					role: "toolResult",
					toolName: "submit_review",
					isError: true,
				});
				expect(JSON.stringify(context.messages.at(-1))).toContain("trustedEvidenceRefs");
				const current = state().runs[0];
				expect(current).toMatchObject({ phase: "REVIEW", status: "RUNNING", revisionCycle: 0 });
				expect(current.review).toBeUndefined();
				expect(current.verification.map((check) => check.status)).toEqual(["PASS"]);
				expect(current.roleSessionRefs.map((ref) => ref.role)).toEqual(["Developer", "Reviewer"]);
				expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
				expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
				return review()(context);
			},
		]);
		const report = await create().execute();
		expect(report.error).toBeUndefined();
		expect(report.run).toMatchObject({
			workflow: "STANDARD",
			risk: "R2",
			phase: "COMPLETE",
			status: "COMPLETED",
			revisionCycle: 0,
		});
		expect(report.run?.roleSessionRefs).toHaveLength(2);
		expect(report.run?.reviewHistory).toHaveLength(1);
		expect(report.run?.review?.result).toBe("PASS");
		expect(report.run?.review?.diffDigest).toBe(report.run?.workspace?.diffDigest);
		expect(report.run?.verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
		expect(state().runs[0]).toEqual(report.run);
		expect(
			state()
				.actions.filter((action) => action.decision.role === "Developer")
				.map((action) => action.status),
		).toEqual(["SUCCEEDED", "SUCCEEDED"]);
		expect(events.filter((event) => event.type === "AgentSessionCreated")).toHaveLength(2);
		expect(events.filter((event) => event.type === "RunCompleted")).toHaveLength(1);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});

	// RC-04: downstream obligations must be corrected before accepting the immutable Developer handoff.
	it.each([
		"Independent Reviewer PASS is required and remains pending.",
		"Independent Reviewer PASS is required",
		"SELF_CHECK is required.",
		"TEST is required.",
		"Human Approval is required.",
	])(
		"RC-04 rejects downstream unresolved %s, then completes only after resubmission and independent review",
		async (obligation) => {
			harness.setResponses([
				edit(manifests[0]),
				edit(manifests[1]),
				(context) => {
					expect(context.systemPrompt).toContain("Runtime-owned obligations enforced by Kernel/Workflow");
					expect(context.systemPrompt).toContain("Never hide real blockers");
					return handoffWithUnresolved([obligation])(context);
				},
				(context) => {
					expect(context.messages.at(-1)).toMatchObject({
						role: "toolResult",
						toolName: "submit_handoff",
						isError: true,
					});
					expect(JSON.stringify(context.messages.at(-1))).toContain(
						"Handoff unresolved validation failed: unresolved[0]",
					);
					expect(JSON.stringify(context.messages.at(-1))).toContain(
						"Keep every real implementation/requirement problem",
					);
					const current = state().runs[0];
					expect(current).toMatchObject({ phase: "IMPLEMENT", status: "RUNNING", revisionCycle: 0 });
					expect(current.handoff).toBeUndefined();
					expect(current.verification).toEqual([]);
					expect(current.roleSessionRefs.map((ref) => ref.role)).toEqual(["Developer"]);
					expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
					return handoff(context);
				},
				review(),
			]);
			const report = await create().execute();
			expect(report.error).toBeUndefined();
			expect(report.run).toMatchObject({ status: "COMPLETED", phase: "COMPLETE", risk: "R2", revisionCycle: 0 });
			expect(report.run?.handoff?.unresolved).toEqual([]);
			expect(report.run?.review?.result).toBe("PASS");
			expect(report.run?.verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
			expect(report.run?.roleSessionRefs.map((ref) => ref.role)).toEqual(["Developer", "Reviewer"]);
			expect(new Set(report.run?.roleSessionRefs.map((ref) => ref.sessionId)).size).toBe(2);
			expect(events.filter((event) => event.type === "AgentSessionCreated")).toHaveLength(2);
			expect(events.filter((event) => event.type === "RunCompleted")).toHaveLength(1);
			expect(state().runs[0]).toEqual(report.run);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);

	it.each([
		"Required dependency migration is not implemented.",
		"TEST is required because the new dependency API is not implemented.",
		"Independent Reviewer PASS is required and remains pending. The migration is incomplete.",
		"Human Approval was denied; the required deletion was not executed.",
		"A later independent review is still needed.",
	])("RC-04 preserves real or ambiguous unresolved text and blocks despite Reviewer PASS: %s", async (problem) => {
		harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoffWithUnresolved([problem]), review()]);
		const report = await create().execute();
		expect(report.run).toMatchObject({ status: "BLOCKED", phase: "COMPLETE", risk: "R2" });
		expect(report.error).toBe("Handoff has the wrong task or unresolved work");
		expect(report.run?.handoff?.unresolved).toEqual([problem]);
		expect(report.run?.review?.result).toBe("PASS");
		expect(report.run?.verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
		expect(report.partialChanges).toBe(true);
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		expect(state().runs[0]).toEqual(report.run);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});

	it("RC-04 mixed submission retries without dropping the actual blocker", async () => {
		const blocker = "Required dependency migration is not implemented.";
		harness.setResponses([
			edit(manifests[0]),
			edit(manifests[1]),
			handoffWithUnresolved([blocker, "SELF_CHECK is required."]),
			(context) => {
				expect(context.messages.at(-1)).toMatchObject({ role: "toolResult", isError: true });
				expect(JSON.stringify(context.messages.at(-1))).toContain("unresolved[1]");
				expect(state().runs[0].handoff).toBeUndefined();
				return handoffWithUnresolved([blocker])(context);
			},
			review(),
		]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.error).toContain("unresolved work");
		expect(report.run?.handoff?.unresolved).toEqual([blocker]);
		expect(report.run?.review?.result).toBe("PASS");
		expect(report.run?.verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
	});

	it("RC-04 Kernel still rejects a known obligation if a custom adapter bypasses submit validation", async () => {
		const execute = PiAgentExecutor.prototype.execute;
		const obligation = "Independent Reviewer PASS is required and remains pending.";
		vi.spyOn(PiAgentExecutor.prototype, "execute").mockImplementation(async function (
			this: PiAgentExecutor,
			request,
		) {
			const result = await execute.call(this, request);
			if (result.role === "Developer") result.handoff.unresolved = [obligation];
			return result;
		});
		harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review()]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.run?.handoff?.unresolved).toEqual([obligation]);
		expect(report.run?.review?.result).toBe("PASS");
		expect(report.run?.verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
		expect(report.error).toContain("unresolved work");
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
	});

	it("REVISE requires fresh Developer and Reviewer sessions for the next attempt", async () => {
		harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review("REVISE"), handoff, review()]);
		const report = await create().execute();
		expect(report.run?.status).toBe("COMPLETED");
		expect(report.run?.revisionCycle).toBe(1);
		expect(new Set(report.run?.roleSessionRefs.map((ref) => ref.sessionId)).size).toBe(4);
		expect(report.run?.verification.map((check) => check.revision)).toEqual([0, 1, 1]);
	});
	it.each(["BLOCK", "REVISE"] as const)("terminal %s never runs final TEST or emits completion", async (verdict) => {
		harness.setResponses([
			edit(manifests[0]),
			edit(manifests[1]),
			handoff,
			review(verdict),
			...(verdict === "REVISE" ? [handoff, review("REVISE")] : []),
		]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.partialChanges).toBe(true);
		expect(
			events.some(
				(event) => event.type === "RunCompleted" || (event.type === "StepStarted" && event.step.stepId === "test"),
			),
		).toBe(false);
	});
	it.each(["model", "auth"])("missing Reviewer %s prevents the first mutation", async (mode) => {
		if (mode === "model") config.models.profiles.reasoning.model = "missing";
		else {
			const auth = harness.session.modelRuntime.getAuth.bind(harness.session.modelRuntime);
			vi.spyOn(harness.session.modelRuntime, "getAuth").mockImplementation(async (model, options) =>
				model.id === "review" ? undefined : auth(model, options),
			);
		}
		const report = await create().execute();
		expect(report.run).toBeUndefined();
		expect(harness.faux.state.callCount).toBe(0);
		expect(git("diff")).toBe("");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["natural-language", "missing-reference", "reused-session", "provider-failure", "stale-review"])(
		"Reviewer %s cannot satisfy the R2 obligation",
		async (mode) => {
			if (mode === "missing-reference" || mode === "reused-session") {
				const execute = PiAgentExecutor.prototype.execute;
				vi.spyOn(PiAgentExecutor.prototype, "execute").mockImplementation(function (
					this: PiAgentExecutor,
					request,
				) {
					const persist = request.onSessionCreated;
					if (request.role === "Reviewer")
						request = {
							...request,
							onSessionCreated:
								mode === "missing-reference"
									? async () => {}
									: async (reference) => {
											await persist?.({
												...reference,
												sessionId: state().runs[0].roleSessionRefs[0].sessionId,
											});
										},
						};
					return execute.call(this, request);
				});
			}
			harness.setResponses([
				edit(manifests[0]),
				edit(manifests[1]),
				handoff,
				mode === "natural-language"
					? fauxAssistantMessage("PASS done")
					: mode === "provider-failure"
						? () => {
								throw new Error("Faux Reviewer error");
							}
						: mode === "stale-review"
							? (context) => {
									const response = review()(context);
									for (const part of response.content)
										if (part.type === "toolCall") part.arguments.diffDigest = "stale";
									return response;
								}
							: review(),
			]);
			const report = await create().execute();
			expect(["FAILED", "BLOCKED"]).toContain(report.run?.status);
			expect(report.partialChanges).toBe(true);
			expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		},
	);
	it("cannot reuse the previous attempt's Reviewer registration after REVISE", async () => {
		const execute = PiAgentExecutor.prototype.execute;
		vi.spyOn(PiAgentExecutor.prototype, "execute").mockImplementation(function (this: PiAgentExecutor, request) {
			return execute.call(
				this,
				request.role === "Reviewer" && request.revision === 1
					? { ...request, onSessionCreated: async () => {} }
					: request,
			);
		});
		harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review("REVISE"), handoff, review()]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.run?.revisionCycle).toBe(1);
		expect(report.run?.roleSessionRefs).toHaveLength(3);
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
	});
	it.each(["SELF_CHECK", "TEST"])("required %s failure remains blocked despite R2 permission", async (phase) => {
		config.verification.checks[0].args[1] = `fail-${phase}`;
		harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review()]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.run?.verification.at(-1)?.status).toBe("FAIL");
		expect(report.partialChanges).toBe(true);
	});
	it.each(["test", "complete"])("invalidates Review PASS when code changes at %s", async (step) => {
		onEvent = (event) => {
			if (event.type === "StepStarted" && event.step.stepId === step) writeFileSync(join(cwd, "src/app.ts"), "late");
		};
		harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review()]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.partialChanges).toBe(true);
	});
	it("final TEST mutation cannot reuse R2 PASS", async () => {
		config.verification.checks[0].args[1] = "mutate-TEST";
		harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review()]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.error).toContain("review");
	});
	it.each(["implement", "self-check", "review", "test", "complete"])(
		"cancels R2 at %s with no completion",
		async (step) => {
			onEvent = (event) => {
				if (event.type === "StepStarted" && event.step.stepId === step) workflow.cancel();
			};
			harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review()]);
			const report = await create().execute();
			expect(report.run?.status).toBe("CANCELLED");
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
			expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		},
	);
	it("cancels a live Reviewer after R2 partial changes and disposes before unlock", async () => {
		let entered = false;
		harness.setResponses([
			edit(manifests[0]),
			edit(manifests[1]),
			handoff,
			async (_context, options) => {
				entered = true;
				await new Promise<void>((resolve) => {
					if (options?.signal?.aborted) resolve();
					else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return fauxAssistantMessage("late");
			},
		]);
		const job = create().execute();
		await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000, interval: 25 });
		await expect(FileStateStore.open(cwd)).rejects.toThrow();
		workflow.cancel();
		const report = await job;
		expect(report.run?.status).toBe("CANCELLED");
		expect(report.partialChanges).toBe(true);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it("cancels a live final check and preserves R2 review/state without completing", async () => {
		config.verification.checks[0].args[1] = "slow-TEST";
		harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review()]);
		const job = create().execute();
		await vi.waitFor(() => expect(existsSync(join(agentDir, "marker"))).toBe(true), {
			timeout: 30_000,
			interval: 25,
		});
		workflow.cancel();
		const report = await job;
		expect(report.run?.status).toBe("CANCELLED");
		expect(report.run?.review?.result).toBe("PASS");
		expect(report.run?.verification.at(-1)?.status).toBe("FAIL");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["tracked", "staged", "untracked"])("refuses %s dirty R2 baseline before mutation", async (kind) => {
		const path = kind === "untracked" ? "src/user.ts" : "package.json";
		writeFileSync(join(cwd, path), "USER_CHANGE");
		if (kind === "staged") git("add", "--", path);
		const before = git("status", "--porcelain");
		const report = await create().execute();
		expect(report.error).toContain("Dirty workspace");
		expect(harness.faux.state.callCount).toBe(0);
		expect(git("status", "--porcelain")).toBe(before);
	});
	it.each([".ai/config.yaml", ".git/config", "../outside.ts"])(
		"R2 does not authorize protected/escaping target %s",
		async (path) => {
			harness.setResponses([
				fauxAssistantMessage(fauxToolCall("runtime_write", { path, content: "forbidden" }), {
					stopReason: "toolUse",
				}),
			]);
			const report = await create().execute();
			expect(report.run?.status).toBe("FAILED");
			expect(state().actions[0].status).toBe("DENIED");
			expect(git("diff")).toBe("");
		},
	);
	it.each(["Deploy production dependency", "Update dependency architecture", "Delete dependency files"])(
		"still refuses unsupported %s",
		async (taskGoal) => {
			const report = await create(taskGoal).execute();
			expect(report.run).toBeUndefined();
			expect(report.error).toContain("Unsupported");
			expect(harness.faux.state.callCount).toBe(0);
		},
	);
	it("does not grant an execution binding to a different run", async () => {
		const report = await create(goal, true).execute();
		expect(report.error).toContain("binding");
		expect(harness.faux.state.callCount).toBe(0);
	});
	it("R1 STANDARD cannot silently acquire R2 action permission", async () => {
		harness.setResponses([edit(manifests[0])]);
		const report = await create("Fix a bug").execute();
		expect(report.error).toContain("R2 requires a new STANDARD/R2 run");
		expect(report.run?.status).toBe("FAILED");
		expect(state().actions[0]).toMatchObject({
			status: "DENIED",
			decision: { risk: "R2", decision: "REVIEW_REQUIRED" },
		});
		expect(git("diff")).toBe("");
	});
	it("does not publish completion when saving R2 COMPLETE fails", async () => {
		const save = FileStateStore.prototype.save;
		vi.spyOn(FileStateStore.prototype, "save").mockImplementation(function (this: FileStateStore, run) {
			if (run.status === "COMPLETED") throw new Error("Disk full");
			return save.call(this, run);
		});
		harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review()]);
		const report = await create().execute();
		expect(report.run?.status).toBe("FAILED");
		expect(report.partialChanges).toBe(true);
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
	});
	it("command composition supplies the binding and stored status reports mandatory R2 review", async () => {
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const notify = vi.fn();
		const ctx = {
			cwd,
			hasUI: true,
			isIdle: () => true,
			isProjectTrusted: () => true,
			ui: { notify, confirm: async () => true, editor: async (_title: string, prefill?: string) => prefill ?? "" },
		} as unknown as ExtensionCommandContext;
		const register = () =>
			registerCompanyRuntime(
				{
					registerCommand: (name, command) => {
						commands.set(name, command);
					},
					on: (_event: string, _handler: unknown) => {},
				},
				{ agentDir, createModels: async () => harness.session.modelRuntime },
			);
		register();
		harness.setResponses([edit(manifests[0]), edit(manifests[1]), handoff, review()]);
		await commands.get("workflow")!.handler(`run ${goal}`, ctx);
		await vi.waitFor(
			() => expect(notify).toHaveBeenCalledWith(expect.stringContaining("Status: COMPLETED"), "info"),
			{ timeout: 5000 },
		);
		register();
		for (const name of ["workflow", "team", "state", "risk"]) {
			await commands.get(name)!.handler("", ctx);
			expect(notify.mock.lastCall?.[0]).toContain("Review enforcement: REQUIRED (STANDARD/R2)");
			expect(notify.mock.lastCall?.[0]).toContain("Review: PASS");
		}
	});
});
