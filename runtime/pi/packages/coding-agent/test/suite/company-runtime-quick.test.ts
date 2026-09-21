import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../../../company-runtime/src/agent-runner.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { ExecutorHandoff, Run } from "../../../company-runtime/src/contracts.ts";
import type { RuntimeEvent } from "../../../company-runtime/src/events.ts";
import { registerCompanyRuntime } from "../../../company-runtime/src/extension.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import { formatWorkflowReport, StandardWorkflow } from "../../../company-runtime/src/workflow.ts";
import { AgentSession, type ExtensionCommandContext, type RegisteredCommand } from "../../src/index.ts";
import { executorCriteria, workflowContract } from "./company-contract.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

let harness: Harness;
let cwd: string;
let agentDir: string;
let config: RuntimeConfig;
let workflow: StandardWorkflow;
let events: RuntimeEvent[];
let onEvent: ((event: RuntimeEvent) => void) | undefined;
const goal = "Fix typo in src/app.ts";
function input(context: Context): Extract<AgentExecutionRequest, { role: "Executor" }> {
	const user = context.messages.find((message) => message.role === "user");
	if (!user || user.role !== "user") throw new Error("No user input");
	const text =
		typeof user.content === "string"
			? user.content
			: user.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("");
	const request = JSON.parse(text) as AgentExecutionRequest;
	if (request.role !== "Executor") throw new Error("QUICK must not create another role");
	return request;
}
const write = (path = "src/app.ts", content = "fixed\n") =>
	fauxAssistantMessage(fauxToolCall("runtime_write", { path, content }), { stopReason: "toolUse" });
function handoff(context: Context, override: Partial<ExecutorHandoff> = {}) {
	const request = input(context);
	return fauxAssistantMessage(
		fauxToolCall("submit_handoff", {
			runId: request.runId,
			revision: request.revision,
			role: "Executor",
			task: request.task.id,
			summary: "Structured task result",
			changed_files: request.scope.risk === "R0" ? [] : ["src/app.ts"],
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
			criteria: request.task.acceptanceCriteria.map((criterion) => ({
				criterionId: criterion.id,
				status: "MET",
				explanation: "Named source inspected; requested spelling corrected or explained",
			})),
			...override,
		}),
		{ stopReason: "toolUse" },
	);
}
const submit = (context: Context) => handoff(context);
function create(taskGoal = goal) {
	workflow = new StandardWorkflow({
		executionMode: taskGoal.startsWith("Explain") ? "READ_ONLY" : "EDIT",
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
		createAgents: async (store, quickScope, _r2RunId, _r3Scope, executionContract) => {
			const executor = await PiAgentExecutor.create({
				executionContract,
				cwd,
				agentDir,
				config,
				quickScope,
				modelRuntime: harness.session.modelRuntime,
				audit: store,
				timeoutMs: 3000,
			});
			return { executor, policy: executor.policyContext };
		},
	});
	return workflow;
}
const git = (...argv: string[]) =>
	execFileSync("git", argv, {
		cwd,
		env: { PATH: process.env.PATH, HOME: agentDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		stdio: "pipe",
	}).toString();
function state() {
	return JSON.parse(readFileSync(join(cwd, ".ai/state.json"), "utf8")) as {
		runs: Run[];
		actions: Array<{ status: string; decision: { role: string; decision: string; risk: string } }>;
	};
}
beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding" }] });
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
					reasoning: { provider: "unavailable-reviewer", model: "missing" },
				},
			},
			files: { allowed_paths: ["src", "package.json", ".ai", "scripts"] },
			verification: {
				checks: [
					{
						id: "regression",
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
	writeFileSync(join(cwd, "src/app.ts"), "original\n");
	writeFileSync(join(cwd, "package.json"), "{}\n");
	writeFileSync(
		join(cwd, "scripts/check.mjs"),
		`import {readFileSync,writeFileSync} from 'node:fs';
const phase=JSON.parse(readFileSync('.ai/state.json','utf8')).runs[0].phase;
const mode=process.argv[2];
if(mode==='fail-'+phase) process.exit(7);
if(mode==='mutate-'+phase) writeFileSync('src/app.ts','changed by check\\n');
if(mode==='expand-'+phase) writeFileSync('src/other.ts','unexpected\\n');
if(mode==='slow-'+phase) {writeFileSync(process.argv[3],'started'); setInterval(()=>{},1000);}
console.log('CHECK_PASSED');
`,
	);
	git("init", "-q");
	git("add", "--", ".ai/config.yaml", ".gitignore", "src/app.ts", "scripts/check.mjs", "package.json");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"QUICK baseline",
	);
	events = [];
	onEvent = undefined;
});
afterEach(() => {
	vi.restoreAllMocks();
	harness.cleanup();
});

describe("S5A QUICK: same SDK/Policy/Git/Verifier with one Executor", () => {
	it.each([false, true])("V0.3A anchored second occurrence through QUICK/R1 (external stale=%s)", async (stale) => {
		writeFileSync(join(cwd, "src/app.ts"), "foo()\nfoo()\n");
		git("add", "src/app.ts");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-m",
			"Duplicate baseline",
		);
		const read = () =>
			fauxAssistantMessage(fauxToolCall("runtime_read", { path: "src/app.ts", anchors: true }), {
				stopReason: "toolUse",
			});
		const anchoredEdit = (context: Context) => {
			expect(context.systemPrompt).toContain(
				"Existing-file edits should prefer an anchored read followed by anchored edit.",
			);
			expect(context.systemPrompt).toContain("Never guess or reconstruct an anchor.");
			const output = getMessageText(context.messages.at(-1));
			const rows = output.split("\n");
			return fauxAssistantMessage(
				fauxToolCall("runtime_edit", {
					path: "src/app.ts",
					oldText: "foo()",
					newText: "bar()",
					fileDigest: rows[0].slice(12),
					anchor: rows[2].split(" ")[0],
				}),
				{ stopReason: "toolUse" },
			);
		};
		harness.setResponses([
			read(),
			(context) => {
				if (stale) writeFileSync(join(cwd, "src/app.ts"), "foo()\nfoo()\nexternal\n");
				return anchoredEdit(context);
			},
			...(stale
				? [
						(context: Context) => {
							expect(getMessageText(context.messages.at(-1))).toContain("STALE_ANCHOR");
							expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe("foo()\nfoo()\nexternal\n");
							return read(); // Explicit model choice, not a Runtime retry loop.
						},
						anchoredEdit,
					]
				: []),
			submit,
		]);
		const report = await create().execute();
		expect(report.error).toBeUndefined();
		expect(report.run?.status).toBe("COMPLETED");
		expect(report.run?.roleSessionRefs.map((ref) => ref.role)).toEqual(["Executor"]);
		expect(report.run?.verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
		expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe(`foo()\nbar()\n${stale ? "external\n" : ""}`);
		expect(
			state()
				.actions.filter((action) => action.decision.role === "Executor")
				.map((action) => [action.status, action.decision.risk]),
		).toEqual(
			stale
				? [
						["SUCCEEDED", "R0"],
						["FAILED", "R1"],
						["SUCCEEDED", "R0"],
						["SUCCEEDED", "R1"],
					]
				: [
						["SUCCEEDED", "R0"],
						["SUCCEEDED", "R1"],
					],
		);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["R0", "R1"])(
		"completes %s with one coding session, both checks and no Reviewer authentication",
		async (risk) => {
			const sessions: AgentSession[] = [];
			const original = AgentSession.prototype.prompt;
			vi.spyOn(AgentSession.prototype, "prompt").mockImplementation(function (this: AgentSession, ...args) {
				sessions.push(this);
				return original.apply(this, args);
			});
			const dispose = vi.spyOn(AgentSession.prototype, "dispose");
			harness.setResponses(
				risk === "R0"
					? [
							fauxAssistantMessage(fauxToolCall("runtime_read", { path: "src/app.ts" }), {
								stopReason: "toolUse",
							}),
							(context) => {
								expect(
									context.tools?.some((tool) => ["runtime_write", "runtime_edit"].includes(tool.name)),
								).toBe(false);
								return submit(context);
							},
						]
					: [write(), submit],
			);
			const report = await create(risk === "R0" ? "Explain src/app.ts" : goal).execute();
			expect(report.error).toBeUndefined();
			expect(report.run?.status).toBe("COMPLETED");
			expect(report.run?.workflow).toBe("QUICK");
			expect(report.run?.risk).toBe(risk);
			expect(report.run?.review).toBeUndefined();
			expect(report.run?.roleSessionRefs.map((ref) => ref.role)).toEqual(["Executor"]);
			expect(sessions).toHaveLength(1);
			expect(sessions[0].model?.id).toBe("coding");
			expect(dispose).toHaveBeenCalledTimes(1);
			expect(report.run?.verification.map((check) => [check.status, check.exitCode])).toEqual([
				["PASS", 0],
				["PASS", 0],
			]);
			expect(
				report.run?.verification.every(
					(check) =>
						check.stdout?.includes("CHECK_PASSED") && check.diffDigest === report.run?.workspace?.diffDigest,
				),
			).toBe(true);
			expect(report.changedFiles).toEqual(risk === "R0" ? [] : ["src/app.ts"]);
			expect(report.partialChanges).toBe(false);
			expect(state().runs[0]).toEqual(report.run);
			expect(state().actions.map((action) => action.decision.role)).toEqual(["Executor", "Verifier", "Verifier"]);
			expect(events.map((event) => event.type)).toEqual([
				"RunCreated",
				"RunStarted",
				"StepStarted",
				"AgentStarted",
				"AgentSessionCreated",
				"AgentCompleted",
				"StepCompleted",
				"StepStarted",
				"VerificationStarted",
				"VerificationCompleted",
				"StepCompleted",
				"StepStarted",
				"VerificationStarted",
				"VerificationCompleted",
				"StepCompleted",
				"StepStarted",
				"StepCompleted",
				"RunCompleted",
			]);
			expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index + 1));
			for (const event of events)
				if ("step" in event) {
					expect(event.step.attempt).toBe(1);
					expect(event.step.stepId).not.toBe("review");
				}
			expect(formatWorkflowReport(report)).toContain("Workflow: QUICK | Reviewer: not required");
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);
	it.each(["R0", "R1"] as const)(
		"RC-01 known-risk finding completes only read-only R0, not mutation R1 (%s)",
		async (risk) => {
			const knownRisks = ["Existing code does not handle division by zero"];
			const submitWithRisk = (context: Context) => handoff(context, { known_risks: knownRisks });
			harness.setResponses(
				risk === "R0"
					? [
							fauxAssistantMessage(fauxToolCall("runtime_read", { path: "src/app.ts" }), {
								stopReason: "toolUse",
							}),
							submitWithRisk,
						]
					: [write(), submitWithRisk],
			);
			const report = await create(risk === "R0" ? "Explain src/app.ts" : goal).execute();
			expect(report.run?.workflow).toBe("QUICK");
			expect(report.run?.risk).toBe(risk);
			expect(report.run?.phase).toBe("COMPLETE");
			expect(report.run?.status).toBe(risk === "R0" ? "COMPLETED" : "BLOCKED");
			expect(report.run?.executorResult?.known_risks).toEqual(knownRisks);
			expect(report.run?.executorResult?.unresolved).toEqual([]);
			expect(executorCriteria(report.run?.executorResult)?.map((item) => item.status)).toEqual(["MET"]);
			expect(report.run?.roleSessionRefs.map((ref) => ref.role)).toEqual(["Executor"]);
			expect(report.run?.review).toBeUndefined();
			expect(report.run?.verification.map((check) => [check.step?.stepId, check.status, check.exitCode])).toEqual([
				["self-check", "PASS", 0],
				["test", "PASS", 0],
			]);
			expect(report.run?.executorDigest).toBe(report.run?.workspace?.diffDigest);
			expect(report.changedFiles).toEqual(risk === "R0" ? [] : ["src/app.ts"]);
			expect(report.partialChanges).toBe(risk === "R1");
			if (risk === "R0") {
				expect(report.error).toBeUndefined();
				expect(git("status", "--porcelain")).toBe("");
				expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe("original\n");
			} else {
				expect(report.error).toContain("STANDARD required");
				expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe("fixed\n");
			}
			expect(events.some((event) => event.type === "RunCompleted")).toBe(risk === "R0");
			expect(events.some((event) => event.type === "RunBlocked")).toBe(risk === "R1");
			expect(state().runs[0]).toEqual(report.run);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);
	it.each(["SELF_CHECK", "TEST"])(
		"required failure in %s blocks completion and retains partial edits",
		async (phase) => {
			config.verification.checks[0].args[1] = `fail-${phase}`;
			harness.setResponses([write(), submit]);
			const report = await create().execute();
			expect(report.run?.status).toBe("BLOCKED");
			expect(report.run?.verification.at(-1)?.status).toBe("FAIL");
			expect(report.partialChanges).toBe(true);
			expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		},
	);
	it.each(["test", "complete"])("stale digest at %s never completes", async (step) => {
		onEvent = (event) => {
			if (event.type === "StepStarted" && event.step.stepId === step)
				writeFileSync(join(cwd, "src/app.ts"), "late\n");
		};
		harness.setResponses([write(), submit]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.error).toMatch(/stale|digest/);
		expect(report.partialChanges).toBe(true);
	});
	it.each(["SELF_CHECK", "TEST"])("%s mutation invalidates Executor digest without another session", async (phase) => {
		config.verification.checks[0].args[1] = `mutate-${phase}`;
		harness.setResponses([write(), submit]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.error).toContain("digest");
		expect(report.run?.roleSessionRefs).toHaveLength(1);
	});
	it("cannot complete after a Policy denial even for an optional check", async () => {
		config.verification.checks.push({
			id: "denied",
			kind: "test",
			required: false,
			executable: "/bin/sh",
			args: ["scripts/check.mjs"],
			cwd: ".",
			timeout_ms: 1000,
			trust: { files: [] },
		});
		harness.setResponses([write(), submit]);
		const report = await create().execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.run?.verification.at(-1)?.status).toBe("FAIL");
		expect(state().actions.at(-1)?.status).toBe("DENIED");
	});
	it("R0 cannot finish if a registered check mutates the workspace", async () => {
		config.verification.checks[0].args[1] = "mutate-SELF_CHECK";
		harness.setResponses([submit]);
		const report = await create("Explain src/app.ts").execute();
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.partialChanges).toBe(true);
		expect(report.run?.verification[0].status).toBe("FAIL");
	});
	it.each(["src/other.ts", ".ai/state.json", "scripts/check.mjs"])(
		"applies Policy to Executor mutation of %s",
		async (path) => {
			harness.setResponses([write(path), submit]);
			const report = await create().execute();
			expect(report.run?.status).toBe("FAILED");
			expect(state().actions[0].status).toBe("DENIED");
			expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe("original\n");
			expect(report.run?.verification).toEqual([]);
		},
	);
	it("R0 has no write tool and cannot turn itself into R1", async () => {
		harness.setResponses([write(), submit]);
		const report = await create("Explain src/app.ts").execute();
		expect(report.run?.status).toBe("FAILED");
		expect(git("diff")).toBe("");
	});
	it("action-level dependency escalation refuses QUICK even when the goal omitted dependency keywords", async () => {
		harness.setResponses([write("package.json", '{"version":"2"}')]);
		const report = await create("Fix typo in package.json").execute();
		expect(report.run?.status).toBe("FAILED");
		expect(state().actions[0]).toMatchObject({
			status: "DENIED",
			decision: { risk: "R2", decision: "REVIEW_REQUIRED" },
		});
		expect(git("diff")).toBe("");
	});
	it.each(["Fix dependency typo in package.json", "Fix production typo in src/app.ts", "Delete typo in src/app.ts"])(
		"rejects elevated explicitly QUICK goal %s before Provider use",
		async (taskGoal) => {
			config.runtime.workflow = "QUICK";
			const report = await create(taskGoal).execute();
			expect(report.run).toBeUndefined();
			expect(report.error).toContain("Unsupported");
			expect(harness.faux.state.callCount).toBe(0);
		},
	);
	it.each(["tracked", "staged", "untracked"])("refuses %s dirty workspace without cleanup", async (kind) => {
		const path = kind === "untracked" ? "src/user.ts" : "src/app.ts";
		writeFileSync(join(cwd, path), "USER_CHANGE");
		if (kind === "staged") git("add", "--", path);
		const before = git("status", "--porcelain");
		const report = await create().execute();
		expect(report.error).toContain("Dirty workspace");
		expect(harness.faux.state.callCount).toBe(0);
		expect(git("status", "--porcelain")).toBe(before);
	});
	it("reports partial mutation on Provider failure", async () => {
		harness.setResponses([
			write(),
			() => {
				throw new Error("Faux failure");
			},
		]);
		const report = await create().execute();
		expect(report.run?.status).toBe("FAILED");
		expect(report.partialChanges).toBe(true);
		expect(report.changedFiles).toEqual(["src/app.ts"]);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["implement", "self-check", "test", "complete"])(
		"cancels at %s and never emits completion",
		async (step) => {
			onEvent = (event) => {
				if (event.type === "StepStarted" && event.step.stepId === step) workflow.cancel();
			};
			harness.setResponses([write(), submit]);
			const report = await create().execute();
			expect(report.run?.status).toBe("CANCELLED");
			expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);
	it.each(["SELF_CHECK", "TEST"])("cancels an active %s process before releasing the writer", async (phase) => {
		config.verification.checks[0].args[1] = `slow-${phase}`;
		harness.setResponses([write(), submit]);
		const job = create().execute();
		await vi.waitFor(() => expect(existsSync(join(agentDir, "marker"))).toBe(true), {
			timeout: 30_000,
			interval: 25,
		});
		await expect(FileStateStore.open(cwd)).rejects.toThrow();
		workflow.cancel();
		const report = await job;
		expect(report.run?.status).toBe("CANCELLED");
		expect(report.run?.verification.at(-1)?.status).toBe("FAIL");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["lines", "files"])(
		"blocks expanded %s scope and recommends STANDARD, without hot-switching",
		async (kind) => {
			if (kind === "files")
				onEvent = (event) => {
					if (event.type === "AgentCompleted") writeFileSync(join(cwd, "src/other.ts"), "expanded\n");
				};
			harness.setResponses([write("src/app.ts", kind === "lines" ? "changed\n".repeat(110) : "fixed\n"), submit]);
			const report = await create().execute();
			expect(report.run?.status).toBe("BLOCKED");
			expect(report.error).toContain("STANDARD");
			expect(report.partialChanges).toBe(true);
			expect(report.run?.roleSessionRefs.map((ref) => ref.role)).toEqual(["Executor"]);
		},
	);
	it.each(["natural-language", "unmet", "missing", "wrong-role", "blocker", "changed-files"])(
		"does not complete with %s Executor output",
		async (mode) => {
			harness.setResponses([
				write(),
				(context) => {
					if (mode === "natural-language") return fauxAssistantMessage("Done. PASS.");
					if (mode === "wrong-role")
						return handoff(context, { role: "Developer" } as unknown as Partial<ExecutorHandoff>);
					if (mode === "blocker") return handoff(context, { unresolved: ["not finished"] });
					if (mode === "changed-files") return handoff(context, { changed_files: [] });
					return handoff(context, {
						criteria:
							mode === "missing" ? [] : [{ criterionId: "AC-001", status: "UNMET", explanation: "Not done" }],
					});
				},
			]);
			const report = await create().execute();
			expect(["BLOCKED", "FAILED"]).toContain(report.run?.status);
			expect(report.partialChanges).toBe(true);
			expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		},
	);
	it("never records completion when the final state save fails", async () => {
		const save = FileStateStore.prototype.save;
		vi.spyOn(FileStateStore.prototype, "save").mockImplementation(function (this: FileStateStore, run) {
			if (run.status === "COMPLETED") throw new Error("Disk full");
			return save.call(this, run);
		});
		harness.setResponses([write(), submit]);
		const report = await create().execute();
		expect(report.run?.status).toBe("FAILED");
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
		expect(report.partialChanges).toBe(true);
	});
	it("commands show active/stored QUICK role/risk and lifecycle cleanup cancels a live Executor", async () => {
		const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
		const hooks = new Map<string, () => Promise<unknown>>();
		const notify = vi.fn();
		const context = {
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
					on: (name: string, hook: unknown) => {
						hooks.set(name, hook as () => Promise<unknown>);
					},
				},
				{ agentDir, createModels: async () => harness.session.modelRuntime },
			);
		register();
		let entered = false;
		harness.setResponses([
			write(),
			async (_context, options) => {
				entered = true;
				await new Promise<void>((resolve) => {
					if (options?.signal?.aborted) resolve();
					else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return fauxAssistantMessage("late");
			},
		]);
		await commands.get("workflow")!.handler(`run ${goal}`, context);
		await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000, interval: 25 });
		for (const name of ["workflow", "team", "state", "risk"]) {
			await commands.get(name)!.handler("", context);
			const output = notify.mock.lastCall?.[0] as string;
			expect(output).toContain("Workflow: QUICK | Reviewer: not required");
			expect(output).toContain("Agent: Executor");
			expect(output).toContain("Risk: R1");
		}
		await hooks.get("session_shutdown")!();
		expect(state().runs[0].status).toBe("CANCELLED");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		register();
		await commands.get("state")!.handler("", context);
		expect(notify.mock.lastCall?.[0]).toContain("Workflow: QUICK | Reviewer: not required");
		expect(notify.mock.lastCall?.[0]).toContain("Partial changes exist: yes");
	});
});
