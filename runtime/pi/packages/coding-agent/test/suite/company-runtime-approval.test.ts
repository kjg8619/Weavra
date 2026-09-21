import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../../../company-runtime/src/agent-runner.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { ApprovalDecision, ApprovalRequest, Review, Run } from "../../../company-runtime/src/contracts.ts";
import type { RuntimeEvent } from "../../../company-runtime/src/events.ts";
import { registerCompanyRuntime } from "../../../company-runtime/src/extension.ts";
import type { AgentExecutionRequest, ApprovalPort } from "../../../company-runtime/src/ports.ts";
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
let requests: ApprovalRequest[];
let approve: ApprovalPort["requestApproval"];
let onEvent: ((event: RuntimeEvent) => void | Promise<void>) | undefined;
const target = "src/obsolete.ts";
const goal = `Delete file ${target}`;
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd,
		env: { PATH: process.env.PATH, HOME: agentDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		stdio: "pipe",
	}).toString();
function answer(request: ApprovalRequest, approved = true): ApprovalDecision {
	return {
		runId: request.runId,
		actionId: request.actionId,
		actionDigest: request.actionDigest,
		configDigest: request.configDigest,
		expiresAt: request.expiresAt,
		approved,
	};
}
function state() {
	return JSON.parse(readFileSync(join(cwd, ".ai/state.json"), "utf8")) as {
		runs: Run[];
		actions: Array<{ status: string; decision: { risk: string; decision: string; actionId: string } }>;
	};
}
function input(context: Context): AgentExecutionRequest {
	const user = context.messages.find((item) => item.role === "user");
	if (!user || user.role !== "user") throw new Error("No user context");
	return JSON.parse(
		typeof user.content === "string"
			? user.content
			: user.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
	) as AgentExecutionRequest;
}
const remove = (path = target) =>
	fauxAssistantMessage(fauxToolCall("runtime_delete", { path }), { stopReason: "toolUse" });
function handoff(context: Context) {
	const request = input(context);
	expect(request).toMatchObject({ role: "Developer", risk: "R3", approvalRequired: true, targetPath: target });
	return fauxAssistantMessage(
		fauxToolCall("submit_handoff", {
			runId: request.runId,
			revision: request.revision,
			role: "Developer",
			task: request.task.id,
			changed_files: [target],
			summary: "Deleted the selected file after consent",
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
		}),
		{ stopReason: "toolUse" },
	);
}
function review(verdict: Review["result"] = "PASS") {
	return (context: Context) => {
		const request = input(context);
		if (request.role !== "Reviewer") throw new Error("Independent review required");
		expect(request.verification.changedFiles).toEqual([target]);
		expect(request.verification.reviewContext?.diff).toContain("obsolete source");
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
				role: "Reviewer",
				task: request.task.id,
				result: verdict,
				issues: [],
				criteria: request.task.acceptanceCriteria.map((criterion) => ({
					criterionId: criterion.id,
					status: "MET",
					evidenceRefs: request.verification.evidenceRefs,
				})),
				evidenceRefs: request.verification.evidenceRefs,
				diffDigest: request.verification.diffDigest,
			}),
			{ stopReason: "toolUse" },
		);
	};
}
function create(options: { goal?: string; noApproval?: boolean; timeout?: number } = {}) {
	workflow = new StandardWorkflow({
		executionMode: options.goal?.startsWith("Explain") ? "READ_ONLY" : "EDIT",
		cwd,
		goal: options.goal ?? goal,
		taskContract: workflowContract(options.goal ?? goal, config),
		config,
		approvalTimeoutMs: options.timeout ?? 1500,
		approval: options.noApproval
			? undefined
			: {
					requestApproval: async (request, signal) => {
						requests.push(structuredClone(request));
						return approve(request, signal);
					},
				},
		events: {
			emit: async (event) => {
				events.push(event);
				await onEvent?.(event);
			},
		},
		createAgents: async (store, quickScope, r2RunId, r3Scope, executionContract) => {
			const executor = await PiAgentExecutor.create({
				executionContract,
				cwd,
				agentDir,
				config,
				quickScope,
				r2RunId,
				r3Scope,
				modelRuntime: harness.session.modelRuntime,
				audit: store,
				timeoutMs: 4000,
			});
			return { executor, policy: executor.policyContext };
		},
	});
	return workflow;
}
function checkMode(mode: string) {
	config.verification.checks[0].args[1] = mode;
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	git("add", "--", ".ai/config.yaml");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"Check mode fixture",
	);
}
beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding" }, { id: "review" }] });
	cwd = join(harness.tempDir, "project");
	agentDir = join(harness.tempDir, "workers");
	for (const path of ["src", "scripts", ".ai"]) mkdirSync(join(cwd, path), { recursive: true });
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
			files: { allowed_paths: ["src", "scripts", "package.json", ".ai", ".git"] },
			verification: {
				checks: [
					{
						id: "check",
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
	writeFileSync(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\nsrc/ignored.ts\n");
	writeFileSync(join(cwd, target), "obsolete source\n");
	writeFileSync(join(cwd, "src/keep.ts"), "keep\n");
	writeFileSync(join(cwd, "package.json"), "{}\n");
	writeFileSync(
		join(cwd, "scripts/check.mjs"),
		`import {existsSync,readFileSync,writeFileSync} from 'node:fs';
if(existsSync('${target}')) process.exit(2);
const phase=JSON.parse(readFileSync('.ai/state.json','utf8')).runs[0].phase;
if(process.argv[2]==='fail-'+phase) process.exit(7);
if(process.argv[2]==='mutate-'+phase) writeFileSync('src/keep.ts','changed by check');
if(process.argv[2]==='slow-'+phase){writeFileSync(process.argv[3],'started');setInterval(()=>{},1000);}
console.log('R3_CHECK_PASSED');
`,
	);
	git("init", "-q");
	git("add", "--", ".ai/config.yaml", ".gitignore", target, "src/keep.ts", "package.json", "scripts/check.mjs");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"R3 baseline",
	);
	events = [];
	requests = [];
	onEvent = undefined;
	approve = async (request) => answer(request);
});
afterEach(() => {
	vi.restoreAllMocks();
	harness.cleanup();
});

describe("S5C human-approved single-file deletion", () => {
	// RC-05: calling runtime_delete requests consent; the Developer must not wait for a separate approval tool.
	it.each(["approve", "deny", "timeout"])(
		"RC-05 R3 prompt/tool contract initiates approval before deletion: %s",
		async (mode) => {
			let authorityEntered = false;
			approve = async (request, signal) => {
				expect(state().runs[0]).toMatchObject({ status: "WAITING_APPROVAL", phase: "IMPLEMENT" });
				expect(state().runs[0].approvals?.[0]).toMatchObject({ status: "PENDING", request });
				expect(request.path).toBe(target);
				expect(request.actionDigest).not.toBe("");
				expect(request.configDigest).not.toBe("");
				expect(request.expiresAt).toBeGreaterThan(Date.now());
				expect(existsSync(join(cwd, target))).toBe(true);
				expect(state().actions).toEqual([]);
				authorityEntered = true;
				if (mode === "timeout")
					await new Promise<void>((resolve) => {
						if (signal?.aborted) resolve();
						else signal?.addEventListener("abort", () => resolve(), { once: true });
					});
				return answer(request, mode !== "deny");
			};
			harness.setResponses([
				(context) => {
					expect(input(context)).toMatchObject({ role: "Developer", risk: "R3", targetPath: target });
					expect(context.systemPrompt).toContain(
						"You have no authority to approve actions, bypass approval, or control the workflow.",
					);
					expect(context.systemPrompt).toContain(
						"calling runtime_delete requests explicit human approval through the Runtime",
					);
					expect(context.systemPrompt).toContain("Do not claim approval was granted before the tool confirms it.");
					expect(context.systemPrompt).not.toContain("approval, or workflow control is available");
					expect(context.systemPrompt).not.toContain("No approval-request or destructive tools are available");
					expect(context.tools?.map((tool) => tool.name)).toEqual([
						"runtime_read",
						"runtime_search",
						"runtime_list_files",
						"runtime_request_check",
						"submit_handoff",
						"runtime_delete",
					]);
					expect(context.tools?.find((tool) => tool.name === "runtime_delete")?.description).toContain(
						"Calling this tool requests explicit human approval",
					);
					expect(requests).toEqual([]);
					expect(state().runs[0].approvals ?? []).toEqual([]);
					expect(existsSync(join(cwd, target))).toBe(true);
					return remove();
				},
				(context) => {
					expect(mode).toBe("approve");
					expect(context.messages.at(-1)).toMatchObject({
						role: "toolResult",
						toolName: "runtime_delete",
						isError: false,
					});
					expect(JSON.stringify(context.messages.at(-1))).toContain("Approved file deleted");
					expect(state().runs[0].approvals?.[0].status).toBe("CONSUMED");
					expect(existsSync(join(cwd, target))).toBe(false);
					return handoff(context);
				},
				(context) => {
					expect(context.systemPrompt).toContain("This STANDARD/R3 Reviewer is read-only");
					expect(context.systemPrompt).not.toContain("calling runtime_delete requests");
					return review()(context);
				},
			]);
			const report = await create({ timeout: mode === "timeout" ? 500 : 1500 }).execute();
			expect(authorityEntered).toBe(true);
			expect(requests).toHaveLength(1);
			expect(report.run?.status).toBe(mode === "approve" ? "COMPLETED" : "BLOCKED");
			expect(report.run?.approvals?.[0].status).toBe(
				mode === "approve" ? "CONSUMED" : mode === "deny" ? "DENIED" : "EXPIRED",
			);
			expect(existsSync(join(cwd, target))).toBe(mode !== "approve");
			expect(readFileSync(join(cwd, "src/keep.ts"), "utf8")).toBe("keep\n");
			expect(events.some((event) => event.type === "RunCompleted")).toBe(mode === "approve");
			expect(report.run?.verification.map((check) => check.status)).toEqual(
				mode === "approve" ? ["PASS", "PASS"] : [],
			);
			expect(harness.faux.state.callCount).toBe(mode === "approve" ? 3 : 1);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);

	it("RC-05 cannot grant approval by adding an affirmative tool argument", async () => {
		harness.setResponses([
			fauxAssistantMessage(fauxToolCall("runtime_delete", { path: target, approved: true }), {
				stopReason: "toolUse",
			}),
		]);
		const report = await create().execute();
		expect(report.run?.status).toBe("FAILED");
		expect(requests).toEqual([]);
		expect(existsSync(join(cwd, target))).toBe(true);
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
	});

	it.each([
		{ task: "Explain src/keep.ts", workflow: "QUICK", risk: "R0" },
		{ task: "Fix typo in src/keep.ts", workflow: "QUICK", risk: "R1" },
		{ task: "Fix bug", workflow: "STANDARD", risk: "R1" },
		{ task: "Update dependency in package.json", workflow: "STANDARD", risk: "R2" },
	])(
		"RC-05 $workflow/$risk exposes neither a destructive tool nor an approval-request path",
		async ({ task, workflow: selected, risk }) => {
			let inspected = false;
			harness.setResponses([
				(context) => {
					expect(context.systemPrompt).toContain("No approval-request or destructive tools are available to you.");
					expect(context.systemPrompt).not.toContain("calling runtime_delete requests");
					expect(context.tools?.map((tool) => tool.name)).not.toContain("runtime_delete");
					expect(context.tools?.map((tool) => tool.name).some((name) => /approv|consent/.test(name))).toBe(false);
					inspected = true;
					return remove();
				},
			]);
			const report = await create({ goal: task }).execute();
			expect(inspected).toBe(true);
			expect(report.run).toMatchObject({ workflow: selected, risk, status: "FAILED" });
			expect(requests).toEqual([]);
			expect(report.run?.verification).toEqual([]);
			expect(existsSync(join(cwd, target))).toBe(true);
			expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		},
	);

	it("persists WAITING_APPROVAL, executes exactly once, then independently reviews/tests before COMPLETE", async () => {
		approve = async (request) => {
			expect(existsSync(join(cwd, target))).toBe(true);
			expect(state().runs[0].status).toBe("WAITING_APPROVAL");
			expect(state().runs[0].approvals?.[0].status).toBe("PENDING");
			expect(state().actions).toEqual([]);
			return answer(request);
		};
		harness.setResponses([remove(), handoff, review()]);
		const report = await create().execute();
		expect(report.error).toBeUndefined();
		expect(report.run).toMatchObject({ workflow: "STANDARD", risk: "R3", status: "COMPLETED" });
		expect(requests).toHaveLength(1);
		expect(report.run?.approvals?.[0].status).toBe("CONSUMED");
		expect(report.run?.verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
		expect(report.run?.roleSessionRefs.map((ref) => ref.role)).toEqual(["Developer", "Reviewer"]);
		expect(existsSync(join(cwd, target))).toBe(false);
		expect(readFileSync(join(cwd, "src/keep.ts"), "utf8")).toBe("keep\n");
		expect(state().actions.filter((action) => action.decision.risk === "R3")).toEqual([
			expect.objectContaining({ status: "SUCCEEDED" }),
		]);
		expect(events.filter((event) => event.type.startsWith("Approval")).map((event) => event.type)).toEqual([
			"ApprovalRequested",
			"ApprovalResolved",
			"ApprovalConsumed",
		]);
		expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
		expect(formatWorkflowReport(report)).toContain("Human approval: CONSUMED");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["deny", "unavailable", "foreign", "expired", "cancel"])(
		"%s approval never executes deletion",
		async (mode) => {
			approve = async (request, signal) => {
				if (mode === "unavailable") throw new Error("No UI");
				if (mode === "foreign") return { ...answer(request), actionDigest: "other" };
				if (mode === "cancel") workflow.cancel();
				if (mode === "expired")
					await new Promise<void>((resolve) => {
						if (signal?.aborted) resolve();
						else signal?.addEventListener("abort", () => resolve(), { once: true });
					});
				return answer(request, mode !== "deny");
			};
			harness.setResponses([remove(), handoff]);
			const report = await create({ timeout: mode === "expired" ? 40 : 1500 }).execute();
			expect(report.run?.status).toBe(mode === "cancel" ? "CANCELLED" : "BLOCKED");
			expect(existsSync(join(cwd, target))).toBe(true);
			expect(state().actions).toEqual([]);
			expect(report.run?.verification).toEqual([]);
			expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);
	it("ignores a late affirmative response from a non-cooperative authority", async () => {
		let release!: (value: ApprovalDecision) => void;
		approve = async () =>
			new Promise<ApprovalDecision>((resolve) => {
				release = resolve;
			});
		harness.setResponses([remove()]);
		const report = await create({ timeout: 500 }).execute();
		expect(requests).toHaveLength(1);
		expect(report.run?.approvals?.[0].status).toBe("EXPIRED");
		release(answer(requests[0]));
		await Promise.resolve();
		expect(existsSync(join(cwd, target))).toBe(true);
		expect(state().actions).toEqual([]);
	});
	it.each(["target", "config", "symlink"])(
		"rechecks %s after approval without deleting a changed target",
		async (mode) => {
			approve = async (request) => {
				if (mode === "target") writeFileSync(join(cwd, target), "changed while waiting\n");
				if (mode === "config")
					writeFileSync(
						join(cwd, ".ai/config.yaml"),
						JSON.stringify({ ...config, files: { allowed_paths: ["src"] } }),
					);
				if (mode === "symlink") {
					renameSync(join(cwd, target), join(agentDir, "original.ts"));
					symlinkSync(join(agentDir, "original.ts"), join(cwd, target));
				}
				return answer(request);
			};
			harness.setResponses([remove()]);
			const report = await create().execute();
			expect(["FAILED", "CANCELLED"]).toContain(report.run?.status);
			expect(existsSync(join(cwd, target))).toBe(true);
			expect(events.some((event) => event.type === "ApprovalConsumed")).toBe(false);
		},
	);
	it("expires consent during result persistence before the file operation", async () => {
		onEvent = async (event) => {
			if (event.type === "ApprovalResolved") {
				expect(event.approved).toBe(true);
				await new Promise((resolve) => setTimeout(resolve, 600));
			}
		};
		harness.setResponses([remove()]);
		const report = await create({ timeout: 500 }).execute();
		expect(events.some((event) => event.type === "ApprovalResolved" && event.approved)).toBe(true);
		expect(report.run?.status).not.toBe("COMPLETED");
		expect(existsSync(join(cwd, target))).toBe(true);
		expect(state().actions.every((action) => action.status !== "SUCCEEDED")).toBe(true);
	});
	it("does not reuse approval for a repeated delete call", async () => {
		harness.setResponses([remove(), remove(), handoff]);
		const report = await create().execute();
		expect(report.run?.status).toBe("FAILED");
		expect(requests).toHaveLength(1);
		expect(
			state()
				.actions.filter((action) => action.decision.risk === "R3")
				.map((action) => action.status),
		).toEqual(["SUCCEEDED", "DENIED"]);
		expect(report.partialChanges).toBe(true);
	});
	it("does not accept an executed deletion if its consumption acknowledgement is omitted", async () => {
		const execute = PiAgentExecutor.prototype.execute;
		vi.spyOn(PiAgentExecutor.prototype, "execute").mockImplementation(function (this: PiAgentExecutor, request) {
			return execute.call(
				this,
				request.role === "Developer" ? { ...request, onApprovalConsumed: async () => {} } : request,
			);
		});
		harness.setResponses([remove(), handoff]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.partialChanges).toBe(true);
		expect(report.run?.verification).toEqual([]);
	});
	it("cannot skip approval by submitting a handoff and relying on checks", async () => {
		harness.setResponses([handoff]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(requests).toEqual([]);
		expect(report.run?.verification).toEqual([]);
		expect(existsSync(join(cwd, target))).toBe(true);
	});
	it.each(["src/keep.ts", ".ai/config.yaml", "package.json", "../outside.ts"])(
		"cannot request deletion of another/protected target %s",
		async (path) => {
			harness.setResponses([remove(path)]);
			const report = await create().execute();
			expect(report.run?.status).toBe("FAILED");
			expect(requests).toEqual([]);
			expect(existsSync(join(cwd, target))).toBe(true);
		},
	);
	it.each([".ai/config.yaml", ".git/config", "package.json", "src", "src/ignored.ts"])(
		"refuses unsupported initial deletion %s before an Agent or approval",
		async (path) => {
			if (path === "src/ignored.ts") writeFileSync(join(cwd, path), "ignored user file");
			const report = await create({ goal: `Delete file ${path}` }).execute();
			expect(report.run).toBeUndefined();
			expect(harness.faux.state.callCount).toBe(0);
			expect(requests).toEqual([]);
		},
	);
	it.each(["runtime_write", "runtime_edit", "bash"])("R3 Developer does not acquire %s", async (tool) => {
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall(tool, { path: target, content: "NO", oldText: "obsolete", newText: "NO", command: "false" }),
				{ stopReason: "toolUse" },
			),
		]);
		const report = await create().execute();
		expect(report.run?.status).toBe("FAILED");
		expect(requests).toEqual([]);
		expect(existsSync(join(cwd, target))).toBe(true);
	});
	it.each(["BLOCK", "REVISE"] as const)(
		"human consent is not Reviewer %s approval or a retry permission",
		async (verdict) => {
			harness.setResponses([remove(), handoff, review(verdict)]);
			const report = await create().execute();
			expect(report.run?.status).toBe("BLOCKED");
			expect(report.run?.roleSessionRefs).toHaveLength(2);
			expect(report.run?.revisionCycle).toBe(0);
			expect(report.partialChanges).toBe(true);
			expect(report.run?.verification).toHaveLength(1);
		},
	);
	it.each(["SELF_CHECK", "TEST"])("required %s failure prevents completion after approved deletion", async (phase) => {
		checkMode(`fail-${phase}`);
		harness.setResponses([remove(), handoff, review()]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.partialChanges).toBe(true);
		expect(report.run?.verification.at(-1)?.status).toBe("FAIL");
	});
	it("stale final diff cannot complete even with consumed consent and PASS", async () => {
		checkMode("mutate-TEST");
		harness.setResponses([remove(), handoff, review()]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.partialChanges).toBe(true);
		expect(report.run?.approvals?.[0].status).toBe("CONSUMED");
	});
	it("provider failure after deletion preserves partial-change and approval evidence", async () => {
		harness.setResponses([
			remove(),
			() => {
				throw new Error("Faux failure");
			},
		]);
		const report = await create().execute();
		expect(report.run?.status).toBe("FAILED");
		expect(report.partialChanges).toBe(true);
		expect(report.run?.approvals?.[0].status).toBe("CONSUMED");
		expect(existsSync(join(cwd, target))).toBe(false);
	});
	it.each(["intent", "consumed", "complete"])("%s persistence failure never reports COMPLETE", async (stage) => {
		if (stage === "intent") {
			const prepare = FileStateStore.prototype.prepare;
			vi.spyOn(FileStateStore.prototype, "prepare").mockImplementation(function (this: FileStateStore, decision) {
				if (decision.risk === "R3" && decision.decision === "ALLOW") throw new Error("Disk full");
				return prepare.call(this, decision);
			});
		} else {
			const save = FileStateStore.prototype.save;
			vi.spyOn(FileStateStore.prototype, "save").mockImplementation(function (this: FileStateStore, run) {
				if (
					stage === "complete"
						? run.status === "COMPLETED"
						: run.approvals?.some((record) => record.status === "CONSUMED")
				)
					throw new Error("Disk full");
				return save.call(this, run);
			});
		}
		harness.setResponses([remove(), handoff, review()]);
		const report = await create().execute();
		expect(report.run?.status).toBe("FAILED");
		expect(existsSync(join(cwd, target))).toBe(stage === "intent");
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
	});
	it("cancels during an active final check, preserving the approved partial deletion", async () => {
		checkMode("slow-TEST");
		harness.setResponses([remove(), handoff, review()]);
		const job = create().execute();
		await vi.waitFor(() => expect(existsSync(join(agentDir, "marker"))).toBe(true), {
			timeout: 30_000,
			interval: 25,
		});
		workflow.cancel();
		const report = await job;
		expect(report.run?.status).toBe("CANCELLED");
		expect(report.partialChanges).toBe(true);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["dirty", "no-port", "explicit-quick", "unsupported"])(
		"refuses %s R3 preflight without asking for consent",
		async (mode) => {
			if (mode === "dirty") writeFileSync(join(cwd, target), "USER_CHANGE");
			if (mode === "explicit-quick") config.runtime.workflow = "QUICK";
			const report = await create({
				noApproval: mode === "no-port",
				goal: mode === "unsupported" ? "Deploy production" : goal,
			}).execute();
			expect(report.run).toBeUndefined();
			expect(harness.faux.state.callCount).toBe(0);
			expect(requests).toEqual([]);
		},
	);
	it("Host shutdown dismisses a pending approval; status remains queryable and no deletion occurs", async () => {
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const hooks = new Map<string, () => Promise<unknown>>();
		const notify = vi.fn();
		let entered = false;
		const ctx = {
			cwd,
			hasUI: true,
			isIdle: () => true,
			isProjectTrusted: () => true,
			ui: {
				notify,
				confirm: async () => true,
				editor: async (_title: string, prefill?: string) => prefill ?? "",
				select: async (_title: string, _choices: string[], options?: { signal?: AbortSignal }) => {
					entered = true;
					await new Promise<void>((resolve) => {
						if (options?.signal?.aborted) resolve();
						else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
					});
					return undefined;
				},
			},
		} as unknown as ExtensionCommandContext;
		registerCompanyRuntime(
			{
				registerCommand: (name, command) => {
					commands.set(name, command);
				},
				on: (name: string, handler: unknown) => {
					hooks.set(name, handler as () => Promise<unknown>);
				},
			},
			{ agentDir, createModels: async () => harness.session.modelRuntime },
		);
		harness.setResponses([remove()]);
		await commands.get("workflow")!.handler(`run ${goal}`, ctx);
		await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000, interval: 25 });
		for (const name of ["workflow", "state", "team", "risk"]) {
			await commands.get(name)!.handler("", ctx);
			expect(notify.mock.lastCall?.[0]).toContain("WAITING_APPROVAL");
			expect(notify.mock.lastCall?.[0]).toContain("Human approval: PENDING");
		}
		await hooks.get("session_shutdown")!();
		expect(state().runs[0].status).toBe("CANCELLED");
		expect(state().runs[0].approvals?.[0].status).toBe("CANCELLED");
		expect(existsSync(join(cwd, target))).toBe(true);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["Deny", "Approve once"])("Host selection %s is explicit and defaults to denial", async (choice) => {
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const notify = vi.fn();
		let pendingAtSelection = false;
		const select = vi.fn(async (_title: string, choices: string[]) => {
			expect(choices).toEqual(["Deny", "Approve once"]);
			expect(state().runs[0].status).toBe("WAITING_APPROVAL");
			expect(state().runs[0].approvals?.[0].status).toBe("PENDING");
			expect(existsSync(join(cwd, target))).toBe(true);
			pendingAtSelection = true;
			return choice;
		});
		const ctx = {
			cwd,
			hasUI: true,
			isIdle: () => true,
			isProjectTrusted: () => true,
			ui: {
				notify,
				select,
				confirm: async () => true,
				editor: async (_title: string, prefill?: string) => prefill ?? "",
			},
		} as unknown as ExtensionCommandContext;
		registerCompanyRuntime(
			{
				registerCommand: (name, command) => {
					commands.set(name, command);
				},
				on: (_name: string, _handler: unknown) => {},
			},
			{ agentDir, createModels: async () => harness.session.modelRuntime },
		);
		harness.setResponses([remove(), handoff, review()]);
		await commands.get("workflow")!.handler(`run ${goal}`, ctx);
		await vi.waitFor(
			() =>
				expect(notify).toHaveBeenCalledWith(
					expect.stringContaining(choice === "Deny" ? "Status: BLOCKED" : "Status: COMPLETED"),
					choice === "Deny" ? "warning" : "info",
				),
			{ timeout: 5000 },
		);
		expect(select).toHaveBeenCalledOnce();
		expect(pendingAtSelection).toBe(true);
		expect(existsSync(join(cwd, target))).toBe(choice === "Deny");
		await commands.get("state")!.handler("", ctx);
		expect(notify.mock.lastCall?.[0]).toContain(`Human approval: ${choice === "Deny" ? "DENIED" : "CONSUMED"}`);
	});
});
