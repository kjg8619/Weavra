import { execFileSync } from "node:child_process";
import {
	chmodSync,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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
import { StandardWorkflow } from "../../../company-runtime/src/workflow.ts";
import { AgentSession, type ExtensionCommandContext, type RegisteredCommand } from "../../src/index.ts";
import { workflowContract } from "./company-contract.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness;
let cwd: string;
let agentDir: string;
let config: RuntimeConfig;
let workflow: StandardWorkflow;
let events: RuntimeEvent[];
let onEvent: ((event: RuntimeEvent) => void | Promise<void>) | undefined;
const git = (...args: string[]) =>
	execFileSync("git", args, {
		cwd,
		env: { PATH: process.env.PATH, HOME: agentDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		stdio: "pipe",
	}).toString();
function input(context: Context): AgentExecutionRequest {
	const message = context.messages.find((message) => message.role === "user");
	if (!message || message.role !== "user") throw new Error("Missing worker input");
	const text =
		typeof message.content === "string"
			? message.content
			: message.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join("");
	return JSON.parse(text) as AgentExecutionRequest;
}
const edit = (content = "fixed\n") =>
	fauxAssistantMessage(fauxToolCall("runtime_write", { path: "src/app.js", content }), { stopReason: "toolUse" });
function handoff(context: Context) {
	const request = input(context);
	return fauxAssistantMessage(
		[
			fauxThinking("DEVELOPER_PRIVATE_REASONING"),
			fauxToolCall("submit_handoff", {
				runId: request.runId,
				revision: request.revision,
				role: "Developer",
				task: request.task.id,
				changed_files: ["src/app.js"],
				summary: "Fix implemented",
				assumptions: [],
				tests_run: [],
				known_risks: [],
				unresolved: [],
			}),
		],
		{ stopReason: "toolUse" },
	);
}
function review(result: Review["result"] = "PASS") {
	return (context: Context) => {
		const request = input(context);
		if (request.role !== "Reviewer") throw new Error("Expected independent Reviewer");
		expect(JSON.stringify(context)).not.toContain("DEVELOPER_PRIVATE_REASONING");
		expect(request.verification.reviewContext?.diff).toContain("fixed");
		expect(request.verification.reviewContext?.evidence.some((item) => item.content.includes("CHECK_PASSED"))).toBe(
			true,
		);
		expect(request.verification.changedFiles).toEqual(["src/app.js"]);
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
				result,
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
function create(goal = "Fix app bug", options: { timeoutMs?: number } = {}) {
	workflow = new StandardWorkflow({
		executionMode: "EDIT",
		cwd,
		goal,
		taskContract: workflowContract(goal, config),
		config,
		events: {
			emit: async (event) => {
				events.push(event);
				await onEvent?.(event);
			},
		},
		createAgents: async (store, _quickScope, _r2RunId, _r3Scope, executionContract) => {
			const executor = await PiAgentExecutor.create({
				executionContract,
				cwd,
				agentDir,
				config,
				modelRuntime: harness.session.modelRuntime,
				audit: store,
				timeoutMs: options.timeoutMs ?? 3000,
			});
			return { executor, policy: executor.policyContext };
		},
	});
	return workflow;
}
function checkpoint() {
	git("add", "--", ".ai/config.yaml", ".gitignore", "src/app.js", "scripts/check.mjs");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"Fixture baseline",
	);
}
function checkScript(source: string) {
	writeFileSync(join(cwd, "scripts/check.mjs"), source);
	checkpoint();
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
			files: { allowed_paths: ["src", "scripts"] },
			verification: {
				checks: [
					{
						id: "regression",
						kind: "test",
						executable: process.execPath,
						args: ["scripts/check.mjs"],
						timeout_ms: 3000,
					},
				],
			},
		}),
	);
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	writeFileSync(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n");
	writeFileSync(join(cwd, "src/app.js"), "original\n");
	writeFileSync(
		join(cwd, "scripts/check.mjs"),
		"import {readFileSync} from 'node:fs'; if(readFileSync('src/app.js','utf8') !== 'fixed\\n') process.exit(1); console.log('CHECK_PASSED');",
	);
	git("init", "-q");
	checkpoint();
	events = [];
	onEvent = undefined;
});
afterEach(() => {
	vi.restoreAllMocks();
	harness.cleanup();
});

describe("S4 STANDARD vertical slice: real Git/checks and independent faux SDK sessions", () => {
	it("persists actual PASS evidence and completes once, with independent sessions and ordered events", async () => {
		const dispose = vi.spyOn(AgentSession.prototype, "dispose");
		harness.setResponses([edit(), handoff, review()]);
		const result = await create().execute();
		expect(result.error).toBeUndefined();
		expect(result.run?.status).toBe("COMPLETED");
		expect(result.run?.verification.map((check) => check.status)).toEqual(["PASS", "PASS"]);
		expect(
			result.run?.verification.every(
				(check) =>
					check.exitCode === 0 && check.stdout?.includes("CHECK_PASSED") && check.finishedAt! >= check.startedAt!,
			),
		).toBe(true);
		expect(result.run?.review?.diffDigest).toBe(result.run?.workspace?.diffDigest);
		expect(result.changedFiles).toEqual(["src/app.js"]);
		expect(result.partialChanges).toBe(false);
		expect(new Set(result.run?.roleSessionRefs.map((ref) => ref.sessionId)).size).toBe(2);
		expect(dispose).toHaveBeenCalledTimes(2);
		expect(events.flatMap((event) => (event.type === "StepStarted" ? [event.step.stepId] : []))).toEqual([
			"implement",
			"self-check",
			"review",
			"test",
			"complete",
		]);
		expect(events.filter((event) => event.runId === result.run?.runId).map((event) => event.sequence)).toEqual(
			events.filter((event) => event.runId === result.run?.runId).map((_, index) => index + 1),
		);
		const stored = JSON.parse(readFileSync(join(cwd, ".ai/state.json"), "utf8")) as {
			runs: Run[];
			actions: Array<{ status: string; decision: { role: string } }>;
		};
		expect(stored.runs[0]).toEqual(result.run);
		expect(
			stored.actions.filter((action) => action.decision.role === "Verifier").map((action) => action.status),
		).toEqual(["SUCCEEDED", "SUCCEEDED"]);
		expect(JSON.stringify(stored)).not.toContain("DEVELOPER_PRIVATE_REASONING");
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it.each(["COMPLETED", "BLOCKED", "CANCELLED"] as const)(
		"runs the unchanged faux SDK workflow in a launcher-created worktree and preserves it after %s",
		async (outcome) => {
			const source = cwd;
			const sourceHead = git("rev-parse", "HEAD");
			const sourceBranch = git("symbolic-ref", "HEAD");
			const sourceIndex = readFileSync(join(source, ".git/index"));
			const checkout = join(harness.tempDir, "launcher checkout");
			const launcher = join(checkout, "packages/company-runtime/bin/weavra");
			const cli = join(checkout, "packages/coding-agent/dist/bundle/cli.js");
			for (const directory of [
				"packages/company-runtime/bin",
				"packages/company-runtime/src",
				"packages/coding-agent/dist/bundle",
			])
				mkdirSync(join(checkout, directory), { recursive: true });
			copyFileSync(new URL("../../../company-runtime/bin/weavra", import.meta.url), launcher);
			copyFileSync(
				new URL("../../../company-runtime/src/launcher-home.ts", import.meta.url),
				join(checkout, "packages/company-runtime/src/launcher-home.ts"),
			);
			mkdirSync(join(agentDir, ".weavra"), { mode: 0o700 });
			mkdirSync(join(agentDir, ".weavra/agent"), { mode: 0o700 });
			chmodSync(launcher, 0o755);
			writeFileSync(join(checkout, "packages/company-runtime/src/extension.ts"), "// CLI path fixture\n");
			// Only the CLI process is a fixture. Below, actual SDK/faux workers, Git checks,
			// Policy and StateStore run at the cwd selected by the production launcher.
			writeFileSync(cli, `#!${process.execPath}\nconsole.log(process.cwd());\n`, { mode: 0o755 });
			cwd = execFileSync(launcher, ["--worktree", "lifecycle"], {
				cwd: source,
				env: { PATH: process.env.PATH, HOME: agentDir, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
				encoding: "utf8",
				stdio: "pipe",
			}).trim();
			expect(cwd).toBe(join(realpathSync(harness.tempDir), ".weavra-worktrees/project/lifecycle"));
			expect(git("status", "--porcelain")).toBe("");
			harness.setResponses([edit(), handoff, review(outcome === "BLOCKED" ? "BLOCK" : "PASS")]);
			if (outcome === "CANCELLED")
				onEvent = (event) => {
					if (event.type === "StepStarted" && event.step.stepId === "review") workflow.cancel();
				};
			const report = await create().execute();
			expect(report.run?.status, report.error).toBe(outcome);
			expect(readFileSync(join(cwd, "src/app.js"), "utf8")).toBe("fixed\n");
			const stored = JSON.parse(readFileSync(join(cwd, ".ai/state.json"), "utf8")) as { runs: Run[] };
			expect(stored.runs[0].status).toBe(outcome);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
			expect(git("symbolic-ref", "HEAD").trim()).toBe("refs/heads/weavra/lifecycle");
			expect(git("rev-parse", "HEAD")).toBe(sourceHead);
			expect(git("-C", source, "worktree", "list", "--porcelain")).toContain(`worktree ${cwd}\n`);
			expect(git("-C", source, "rev-parse", "HEAD")).toBe(sourceHead);
			expect(git("-C", source, "symbolic-ref", "HEAD")).toBe(sourceBranch);
			expect(readFileSync(join(source, ".git/index"))).toEqual(sourceIndex);
			expect(git("-C", source, "status", "--porcelain")).toBe("");
			expect(readFileSync(join(source, "src/app.js"), "utf8")).toBe("original\n");
			expect(existsSync(join(source, ".ai/state.json"))).toBe(false);
		},
	);
	it("REVISE repeats Developer/SELF_CHECK/independent review once, then tests the current revision", async () => {
		harness.setResponses([
			edit(),
			handoff,
			review("REVISE"),
			(context) => {
				expect(input(context).role).toBe("Developer");
				expect(JSON.stringify(input(context))).toContain("REVISE");
				return handoff(context);
			},
			review(),
		]);
		const result = await create().execute();
		expect(result.run?.status).toBe("COMPLETED");
		expect(result.run?.revisionCycle).toBe(1);
		expect(result.run?.roleSessionRefs).toHaveLength(4);
		expect(result.run?.verification.map((check) => check.revision)).toEqual([0, 1, 1]);
	});
	it.each(["BLOCK", "REVISE"] as const)("never runs final TEST/COMPLETE after terminal %s", async (verdict) => {
		harness.setResponses(
			verdict === "BLOCK"
				? [edit(), handoff, review("BLOCK")]
				: [edit(), handoff, review("REVISE"), handoff, review("REVISE")],
		);
		const result = await create().execute();
		expect(result.run?.status).toBe("BLOCKED");
		expect(result.partialChanges).toBe(true);
		expect(result.changedFiles).toEqual(["src/app.js"]);
		expect(
			events.some(
				(event) => event.type === "RunCompleted" || (event.type === "StepStarted" && event.step?.stepId === "test"),
			),
		).toBe(false);
	});
	it.each(["tracked", "staged", "untracked", "runtime-config"])(
		"refuses pre-existing %s changes before any worker session",
		async (kind) => {
			const file =
				kind === "runtime-config" ? ".ai/config.yaml" : kind === "untracked" ? "src/new.js" : "src/app.js";
			writeFileSync(join(cwd, file), "USER_CHANGE");
			if (kind === "staged") git("add", "--", file);
			const status = git("status", "--porcelain");
			const result = await create().execute();
			expect(result.error).toContain("Dirty workspace");
			expect(result.run).toBeUndefined();
			expect(harness.faux.state.callCount).toBe(0);
			expect(git("status", "--porcelain")).toBe(status);
			expect(readFileSync(join(cwd, file), "utf8")).toBe("USER_CHANGE");
		},
	);
	it.each([
		"Explain production credentials",
		"Fix typo",
		"Design large-scale architecture",
		"Update dependency architecture",
		"Deploy production",
	])("rejects unsupported goal %s without downgrade", async (goal) => {
		const result = await create(goal).execute();
		expect(result.run).toBeUndefined();
		expect(result.error).toMatch(/Unsupported|QUICK R1 requires/);
		expect(harness.faux.state.callCount).toBe(0);
	});
	it.each(["failure", "timeout", "unavailable", "shell", "eval"])(
		"records non-PASS %s verification, preserving edits",
		async (mode) => {
			if (mode === "failure") checkScript("console.error('CHECK_FAILED'); process.exit(7);");
			if (mode === "timeout") {
				checkScript("setInterval(() => {}, 1000);");
				config.verification.checks[0].timeout_ms = 100;
			}
			if (mode === "unavailable") config.verification.checks[0].executable = "/does/not/exist";
			if (mode === "shell") {
				config.verification.checks[0].executable = "/bin/sh";
				config.verification.checks[0].args = ["scripts/check.mjs"];
			}
			if (mode === "eval") config.verification.checks[0].args = ["--eval", "process.exit(0)"];
			harness.setResponses([edit(), handoff]);
			const result = await create().execute();
			expect(result.run?.status).toBe("BLOCKED");
			expect(result.run?.verification[0].status).toBe(
				["unavailable", "shell", "eval"].includes(mode) ? "UNAVAILABLE" : "FAIL",
			);
			expect(result.partialChanges).toBe(true);
			expect(result.run?.roleSessionRefs).toHaveLength(1);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);
	it.each(["test", "complete"])("invalidates PASS if workspace changes at %s boundary", async (step) => {
		onEvent = (event) => {
			if (event.type === "StepStarted" && event.step?.stepId === step)
				writeFileSync(join(cwd, "src/new.js"), "AFTER_REVIEW");
		};
		harness.setResponses([edit(), handoff, review()]);
		const result = await create().execute();
		expect(result.run?.status).toBe("BLOCKED");
		expect(result.changedFiles).toContain("src/new.js");
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
	});
	it("invalidates PASS when final TEST itself mutates code", async () => {
		checkScript(
			"import {readFileSync,writeFileSync} from 'node:fs'; const state=JSON.parse(readFileSync('.ai/state.json','utf8')); if(state.runs[0].phase==='TEST') writeFileSync('src/new.js','LATE'); console.log('CHECK_PASSED');",
		);
		harness.setResponses([edit(), handoff, review()]);
		const result = await create().execute();
		expect(result.run?.status).toBe("BLOCKED");
		expect(result.error).toContain("diff");
		expect(result.partialChanges).toBe(true);
	});
	it.each(["implement", "self-check", "review", "test", "complete"])(
		"cancels at %s without COMPLETE or automatic rollback",
		async (step) => {
			onEvent = (event) => {
				if (event.type === "StepStarted" && event.step?.stepId === step) workflow.cancel();
			};
			harness.setResponses([edit(), handoff, review()]);
			const result = await create().execute();
			expect(result.run?.status).toBe("CANCELLED");
			expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
			expect(result.partialChanges).toBe(step !== "implement");
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);
	it.each(["SELF_CHECK", "TEST"])(
		"cancels a live %s check and awaits process cleanup before releasing the lock",
		async (phase) => {
			checkScript(
				`import {readFileSync,writeFileSync} from 'node:fs'; if(JSON.parse(readFileSync('.ai/state.json','utf8')).runs[0].phase==='${phase}') {writeFileSync('src/check-started','yes'); setTimeout(()=>writeFileSync('src/late','NO'),500); setInterval(()=>{},1000);} else console.log('CHECK_PASSED');`,
			);
			harness.setResponses([edit(), handoff, review()]);
			const job = create().execute();
			await vi.waitFor(() => expect(existsSync(join(cwd, "src/check-started"))).toBe(true), {
				timeout: 30_000,
				interval: 25,
			});
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(true);
			workflow.cancel();
			const result = await job;
			expect(result.run?.status).toBe("CANCELLED");
			expect(result.run?.verification.at(-1)?.status).toBe("FAIL");
			await new Promise((resolve) => setTimeout(resolve, 600));
			expect(existsSync(join(cwd, "src/late"))).toBe(false);
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
		},
	);
	it("provider failure after mutation reports partial changes instead of rollback or completion", async () => {
		harness.setResponses([
			edit(),
			() => {
				throw new Error("Provider failure");
			},
		]);
		const result = await create().execute();
		expect(result.run?.status).toBe("FAILED");
		expect(result.partialChanges).toBe(true);
		expect(result.changedFiles).toEqual(["src/app.js"]);
		expect(result.run?.verification).toEqual([]);
	});
	it.each(["Developer", "Reviewer"])("cancels a live %s provider after partial edits", async (role) => {
		let entered = false;
		const wait = async (_context: Context, options?: { signal?: AbortSignal }) => {
			entered = true;
			await new Promise<void>((resolve) => {
				if (options?.signal?.aborted) resolve();
				else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
			});
			return fauxAssistantMessage("late result");
		};
		harness.setResponses(role === "Developer" ? [edit(), wait] : [edit(), handoff, wait]);
		const job = create().execute();
		await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000, interval: 25 });
		workflow.cancel();
		const result = await job;
		expect(result.run?.status).toBe("CANCELLED");
		expect(result.partialChanges).toBe(true);
		expect(result.run?.workspace?.changedFiles).toEqual(["src/app.js"]);
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
	it("does not publish COMPLETE when its authoritative save fails", async () => {
		const save = FileStateStore.prototype.save;
		vi.spyOn(FileStateStore.prototype, "save").mockImplementation(function (this: FileStateStore, run) {
			if (run.status === "COMPLETED") throw new Error("Completion persistence failure");
			return save.call(this, run);
		});
		harness.setResponses([edit(), handoff, review()]);
		const result = await create().execute();
		expect(result.run?.status).toBe("FAILED");
		expect(result.partialChanges).toBe(true);
		expect(events.some((event) => event.type === "RunCompleted")).toBe(false);
	});
	it("detects a check corrupting authoritative state instead of overwriting it as success", async () => {
		checkScript(
			"import {writeFileSync} from 'node:fs'; writeFileSync('.ai/state.json','EXTERNAL_CORRUPTION'); console.log('CHECK_PASSED');",
		);
		harness.setResponses([edit(), handoff]);
		const result = await create().execute();
		expect(result.run?.status).toBe("FAILED");
		expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe("EXTERNAL_CORRUPTION");
		expect(result.partialChanges).toBe(true);
	});
	it("preserves check exit/output evidence when subsequent diff capture encounters a symlink", async () => {
		checkScript(
			"import {symlinkSync} from 'node:fs'; symlinkSync('app.js','src/link.js'); console.log('CHECK_PASSED');",
		);
		harness.setResponses([edit(), handoff]);
		const result = await create().execute();
		expect(result.run?.status).toBe("FAILED");
		expect(result.changesUnknown).toBe(true);
		expect(result.run?.verification[0]).toMatchObject({ exitCode: 0, status: "FAIL", stdout: "CHECK_PASSED\n" });
	});
	it("rejects a symlinked registered cwd before spawning a check", async () => {
		config.verification.checks[0].cwd = "src/check-dir";
		onEvent = (event) => {
			if (event.type === "StepStarted" && event.step?.stepId === "self-check")
				symlinkSync(agentDir, join(cwd, "src/check-dir"));
		};
		harness.setResponses([edit(), handoff]);
		const result = await create().execute();
		expect(result.run?.status).toBe("FAILED");
		expect(result.run?.verification).toEqual([]);
		expect(result.changesUnknown).toBe(true);
	});
	it.each(["session_before_switch", "session_before_fork", "session_before_tree", "reload", "quit", "command-cancel"])(
		"Host %s waits for worker cleanup and keeps status/cancel usable",
		async (lifecycle) => {
			const handlers = new Map<
				string,
				(event: { type: string; reason?: string }, context: ExtensionCommandContext) => Promise<unknown>
			>();
			const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
			const notify = vi.fn();
			const context = {
				cwd,
				hasUI: true,
				isIdle: () => true,
				isProjectTrusted: () => true,
				ui: {
					notify,
					confirm: async () => true,
					editor: async (_title: string, prefill?: string) => prefill ?? "",
				},
			} as unknown as ExtensionCommandContext;
			registerCompanyRuntime(
				{
					registerCommand: (name, command) => {
						commands.set(name, command);
					},
					on: (event: string, handler: unknown) => {
						handlers.set(
							event,
							handler as (
								event: { type: string; reason?: string },
								context: ExtensionCommandContext,
							) => Promise<unknown>,
						);
					},
				},
				{ agentDir, createModels: async () => harness.session.modelRuntime },
			);
			let entered = false;
			harness.setResponses([
				edit(),
				async (_context, options) => {
					entered = true;
					await new Promise<void>((resolve) => {
						if (options?.signal?.aborted) resolve();
						else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
					});
					return fauxAssistantMessage("late");
				},
			]);
			await commands.get("workflow")!.handler("run Fix app bug", context);
			await vi.waitFor(() => expect(entered).toBe(true), { timeout: 30_000, interval: 25 });
			for (const name of ["state", "team", "risk", "workflow"])
				await commands.get(name)!.handler(name === "workflow" ? "status" : "", context);
			expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("IMPLEMENT"), "info");
			await commands.get("workflow")!.handler("run Fix duplicate bug", context);
			expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("already active"), "warning");
			expect(await handlers.get("input")!({ type: "input" }, context)).toEqual({ action: "handled" });
			expect(await handlers.get("tool_call")!({ type: "tool_call" }, context)).toMatchObject({ block: true });
			expect(await handlers.get("user_bash")!({ type: "user_bash" }, context)).toMatchObject({
				result: { exitCode: 1 },
			});
			if (lifecycle === "command-cancel") await commands.get("workflow")!.handler("cancel", context);
			else {
				const type = lifecycle === "reload" || lifecycle === "quit" ? "session_shutdown" : lifecycle;
				await handlers.get(type)!({ type, reason: lifecycle }, context);
			}
			expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
			const state = JSON.parse(readFileSync(join(cwd, ".ai/state.json"), "utf8")) as { runs: Run[] };
			expect(state.runs[0].status).toBe("CANCELLED");
			expect(readFileSync(join(cwd, "src/app.js"), "utf8")).toBe("fixed\n");
			expect(await handlers.get("input")!({ type: "input" }, context)).toEqual({ action: "continue" });
		},
	);
	it("denies attempts to rewrite a registered check script", async () => {
		harness.setResponses([
			fauxAssistantMessage(
				fauxToolCall("runtime_write", { path: "scripts/check.mjs", content: "process.exit(0)" }),
				{ stopReason: "toolUse" },
			),
		]);
		const result = await create().execute();
		expect(result.run?.status).toBe("FAILED");
		expect(git("diff")).toBe("");
	});
	it("blocks duplicate project ownership while a live worker is running", async () => {
		harness.setResponses([
			async (_context, options) => {
				await new Promise<void>((resolve) => {
					if (options?.signal?.aborted) resolve();
					else options?.signal?.addEventListener("abort", () => resolve(), { once: true });
				});
				return fauxAssistantMessage("late");
			},
		]);
		const job = create().execute();
		await vi.waitFor(() => expect(harness.faux.state.callCount).toBe(1), { timeout: 30_000, interval: 25 });
		await expect(FileStateStore.open(cwd)).rejects.toThrow();
		workflow.cancel();
		await job;
		expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	});
});
