import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall, type Model } from "@earendil-works/pi-ai";
import type { SpanOptions, TelemetryContext, TelemetrySpan } from "@earendil-works/pi-telemetry";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PiAgentExecutor } from "../../../company-runtime/src/agent-runner.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { Run } from "../../../company-runtime/src/contracts.ts";
import { registerCompanyRuntime } from "../../../company-runtime/src/extension.ts";
import type { PolicyContext } from "../../../company-runtime/src/policy.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import { StandardWorkflow } from "../../../company-runtime/src/workflow.ts";
import type { ExtensionCommandContext, RegisteredCommand } from "../../src/index.ts";
import { workflowContract } from "./company-contract.ts";
import { createHarness, type Harness } from "./harness.ts";

// Issue #5, candidate 3: model intent profiles over the existing profiles, with faux providers only.
const profiles = {
	coding: { provider: "faux", model: "coding" },
	reasoning: { provider: "faux", model: "review" },
	fast: { provider: "faux", model: "fast" },
	creative: { provider: "faux", model: "creative" },
};
// Every alias names a profile that differs from its role default, so each mapping is observable.
const intents = { simple: "fast", standard: "creative", review: "coding", deep: "reasoning" };

let harness: Harness;
let agentDir: string;
/** The model each provider call actually used, by the worker role of its prompt. */
let calls: Array<{ role: string; model: string }>;

function runtimeConfig(models: Record<string, unknown>): RuntimeConfig {
	return parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models,
			files: { allowed_paths: ["src"] },
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
}

function workerRequest(context: Context): AgentExecutionRequest {
	const user = context.messages.find((message) => message.role === "user");
	if (!user || user.role !== "user") throw new Error("Missing worker request");
	return JSON.parse(
		typeof user.content === "string"
			? user.content
			: user.content
					.filter((part) => part.type === "text")
					.map((part) => part.text)
					.join(""),
	) as AgentExecutionRequest;
}

function respond(context: Context, _options: unknown, _state: unknown, model: Model<string>) {
	const request = workerRequest(context);
	calls.push({ role: request.role, model: model.id });
	if (request.role === "Reviewer")
		return fauxAssistantMessage(
			fauxToolCall("submit_review", {
				runId: request.runId,
				revision: request.revision,
				role: "Reviewer",
				task: request.task.id,
				result: "PASS",
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
	if (!context.messages.some((message) => message.role === "toolResult"))
		return fauxAssistantMessage(fauxToolCall("runtime_write", { path: "src/app.ts", content: "fixed\n" }), {
			stopReason: "toolUse",
		});
	return fauxAssistantMessage(
		fauxToolCall("submit_handoff", {
			runId: request.runId,
			revision: request.revision,
			role: request.role,
			task: request.task.id,
			changed_files: ["src/app.ts"],
			summary: "Fixed",
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
			...(request.role === "Executor"
				? {
						criteria: request.task.acceptanceCriteria.map((criterion) => ({
							criterionId: criterion.id,
							status: "MET",
							explanation: "Requested bounded change performed",
						})),
					}
				: {}),
		}),
		{ stopReason: "toolUse" },
	);
}

/** A fresh clean Git project per run: a completed run leaves src/app.ts changed. */
function project(name: string, config: RuntimeConfig): string {
	const cwd = join(harness.tempDir, name);
	for (const directory of ["src", "scripts", ".ai"]) mkdirSync(join(cwd, directory), { recursive: true });
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	writeFileSync(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n");
	writeFileSync(join(cwd, "src/app.ts"), "original\n");
	writeFileSync(
		join(cwd, "scripts/check.mjs"),
		'import {readFileSync} from "node:fs"; if (readFileSync("src/app.ts","utf8") !== "fixed\\n") process.exit(7);',
	);
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			[
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@invalid",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{
				cwd,
				stdio: "pipe",
				env: {
					PATH: process.env.PATH,
					HOME: harness.tempDir,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
				},
			},
		);
	git("init", "-q");
	git("add", "--", ".ai/config.yaml", ".gitignore", "src/app.ts", "scripts/check.mjs");
	git("commit", "-qm", "Model intent fixture");
	return cwd;
}

/** Programmatic Host path: the same StandardWorkflow and PiAgentExecutor the TUI and Host Control use. */
async function execute(
	cwd: string,
	config: RuntimeConfig,
	goal: string,
	options: { deep?: boolean; telemetry?: TelemetryContext } = {},
) {
	const policies: PolicyContext[] = [];
	const callsBefore = harness.faux.state.callCount;
	calls = [];
	const report = await new StandardWorkflow({
		executionMode: "EDIT",
		cwd,
		goal,
		taskContract: workflowContract(goal, config, { taskId: "task-1" }),
		config,
		createAgents: async (store, quickScope, r2RunId, r3Scope, executionContract) => {
			const executor = await PiAgentExecutor.create({
				executionContract,
				cwd,
				agentDir,
				config,
				quickScope,
				r2RunId,
				r3Scope,
				audit: store,
				modelRuntime: harness.session.modelRuntime,
				timeoutMs: 5000,
				...(options.deep ? { deep: true } : {}),
				...(options.telemetry ? { telemetry: options.telemetry } : {}),
			});
			policies.push(executor.policyContext);
			return { executor, policy: executor.policyContext };
		},
	}).execute();
	return { report, run: report.run, policy: policies[0], providerCalls: harness.faux.state.callCount - callsBefore };
}

/** TUI path through the registered `/workflow` command, then `/workflow status` and `/state evidence`. */
async function tui(cwd: string, command: string) {
	const commands = new Map<string, Omit<RegisteredCommand, "name" | "sourceInfo">>();
	const hooks = new Map<string, () => Promise<unknown>>();
	const notices: string[] = [];
	let preview = "";
	let settle!: () => void;
	const finished = new Promise<void>((resolve) => {
		settle = resolve;
	});
	const createModels = vi.fn(async () => harness.session.modelRuntime);
	const callsBefore = harness.faux.state.callCount;
	calls = [];
	registerCompanyRuntime(
		{
			registerCommand: (name, registered) => {
				commands.set(name, registered);
			},
			on: (name: string, handler: unknown) => {
				hooks.set(name, handler as () => Promise<unknown>);
			},
		},
		{ agentDir, createModels },
	);
	const ctx = {
		cwd,
		hasUI: true,
		isIdle: () => true,
		isProjectTrusted: () => true,
		ui: {
			notify: (message: string) => {
				notices.push(message);
				if (!message.includes("preflight started")) settle();
			},
			editor: async (_title: string, prefill: string) => prefill,
			confirm: async (_title: string, text: string) => {
				// Preview happens before any model runtime, provider call or durable Run.
				expect(createModels).not.toHaveBeenCalled();
				expect(harness.faux.state.callCount).toBe(callsBefore);
				expect(existsSync(join(cwd, ".ai/state.json"))).toBe(false);
				preview = text;
				return true;
			},
		},
	} as unknown as ExtensionCommandContext;
	const call = async (name: string, args: string) => {
		await commands.get(name)!.handler(args, ctx);
		return notices.at(-1) ?? "";
	};
	await commands.get("workflow")!.handler(command, ctx);
	await finished;
	const outcome = notices.at(-1) ?? "";
	// Waits for the owned workflow to settle; the views below then read the stored Run.
	await hooks.get("session_shutdown")!();
	const run: Run | undefined = (await FileStateStore.readSnapshot(cwd)).state?.runs.at(-1);
	return {
		run,
		preview,
		outcome,
		modelsCreated: createModels.mock.calls.length,
		providerCalls: harness.faux.state.callCount - callsBefore,
		status: run ? await call("workflow", "status") : "",
		evidence: run ? await call("state", "evidence") : "",
	};
}

/** Distinct role:model pairs the provider actually served, in call order. */
const served = () => [...new Set(calls.map((call) => `${call.role}:${call.model}`))];
const recorded = (run?: Run) =>
	(run?.workerMeasurements ?? []).map(({ role, profile, modelIntent, requestedModel, actualModel }) => ({
		role,
		profile,
		...(modelIntent ? { modelIntent } : {}),
		requestedModel,
		actualModel,
	}));
const policyShape = (policy: PolicyContext) => ({ ...policy, executionRunId: "run", configDigest: "config" });

beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding" }, { id: "review" }, { id: "fast" }, { id: "creative" }] });
	agentDir = join(harness.tempDir, "workers");
	mkdirSync(agentDir);
	calls = [];
	harness.setResponses(Array.from({ length: 48 }, () => respond));
});
afterEach(() => {
	vi.restoreAllMocks();
	harness.cleanup();
});

describe("#5 model intent profiles through the real adapter (faux only)", () => {
	it("keeps today's routing, measurements and call count when no alias is configured", async () => {
		const plain = runtimeConfig({ profiles });
		expect("intents" in plain.models).toBe(false);
		const quick = await execute(project("plain-quick", plain), plain, "Fix typo in src/app.ts");
		expect(quick.run?.status, quick.report.error).toBe("COMPLETED");
		expect(served()).toEqual(["Executor:coding"]);
		expect(recorded(quick.run)).toEqual([
			{ role: "Executor", profile: "coding", requestedModel: "coding", actualModel: "coding" },
		]);
		const standard = await execute(project("plain-standard", plain), plain, "Fix bug");
		expect(standard.run?.status, standard.report.error).toBe("COMPLETED");
		expect(served()).toEqual(["Developer:coding", "Reviewer:review"]);
		expect(recorded(standard.run)).toEqual([
			{ role: "Developer", profile: "coding", requestedModel: "coding", actualModel: "coding" },
			{ role: "Reviewer", profile: "reasoning", requestedModel: "review", actualModel: "review" },
		]);
		expect(standard.run?.workerMeasurements?.some((measurement) => "modelIntent" in measurement)).toBe(false);
	});

	it("routes each role through its alias without changing contract, risk, Policy, calls or completion", async () => {
		const plain = runtimeConfig({ profiles });
		const aliased = runtimeConfig({ profiles, intents });
		const quick = await execute(project("aliased-quick", aliased), aliased, "Fix typo in src/app.ts");
		expect(quick.run?.status, quick.report.error).toBe("COMPLETED");
		expect(served()).toEqual(["Executor:fast"]);
		expect(recorded(quick.run)).toEqual([
			{ role: "Executor", profile: "fast", modelIntent: "simple", requestedModel: "fast", actualModel: "fast" },
		]);
		const baseline = await execute(project("baseline", plain), plain, "Fix bug");
		const routed = await execute(project("aliased-standard", aliased), aliased, "Fix bug");
		expect(served()).toEqual(["Developer:creative", "Reviewer:coding"]);
		expect(recorded(routed.run)).toEqual([
			{
				role: "Developer",
				profile: "creative",
				modelIntent: "standard",
				requestedModel: "creative",
				actualModel: "creative",
			},
			{
				role: "Reviewer",
				profile: "coding",
				modelIntent: "review",
				requestedModel: "coding",
				actualModel: "coding",
			},
		]);
		// Model choice is not authority: the same frozen contract, classification, Policy, review and outcome.
		for (const result of [baseline, routed]) {
			expect(result.run?.status, result.report.error).toBe("COMPLETED");
			expect(result.run?.review?.result).toBe("PASS");
		}
		const identity = (result: typeof baseline) => ({
			taskContractDigest: result.run?.taskContractDigest,
			workflow: result.run?.workflow,
			risk: result.run?.risk,
			executionMode: result.run?.executionMode,
			roles: result.run?.roleSessionRefs.map((ref) => ref.role),
			checks: result.run?.verification.map((check) => [check.step?.stepId, check.id, check.status]),
			providerCalls: result.providerCalls,
		});
		expect(identity(routed)).toEqual(identity(baseline));
		expect(policyShape(routed.policy)).toEqual(policyShape(baseline.policy));
	});

	it("uses deep only for an explicit --deep TUI run and shows the routing in preview, status and evidence", async () => {
		const aliased = runtimeConfig({ profiles, intents });
		const ordinary = await tui(project("tui-ordinary", aliased), "run Fix bug");
		expect(ordinary.run?.status, ordinary.outcome).toBe("COMPLETED");
		expect(served()).toEqual(["Developer:creative", "Reviewer:coding"]);
		expect(ordinary.run?.workerMeasurements?.map((measurement) => measurement.modelIntent)).toEqual([
			"standard",
			"review",
		]);
		expect(ordinary.preview).toContain(
			"  Developer: standard -> creative -> faux/creative (models.intents.standard)",
		);
		expect(ordinary.preview).not.toContain("deep");

		const deep = await tui(project("tui-deep", aliased), "run --deep Fix bug");
		expect(deep.run?.status, deep.outcome).toBe("COMPLETED");
		expect(served()).toEqual(["Developer:review", "Reviewer:coding"]);
		expect(recorded(deep.run)).toEqual([
			{
				role: "Developer",
				profile: "reasoning",
				modelIntent: "deep",
				requestedModel: "review",
				actualModel: "review",
			},
			{
				role: "Reviewer",
				profile: "coding",
				modelIntent: "review",
				requestedModel: "coding",
				actualModel: "coding",
			},
		]);
		expect(deep.preview).toContain(
			"  Developer: deep -> reasoning -> faux/review (models.intents.deep; explicit --deep for this run)",
		);
		expect(deep.preview).toContain("  Reviewer: review -> coding -> faux/coding (models.intents.review)");
		for (const view of [deep.status, deep.evidence]) {
			expect(view).toContain(
				"  Developer: deep -> reasoning (models.intents.deep; explicit --deep for this run) -> requested faux/review; actual faux/review | 1 invocation(s)",
			);
			expect(view).toContain(
				"  Reviewer: review -> coding (models.intents.review) -> requested faux/coding; actual faux/coding | 1 invocation(s)",
			);
		}
		// The same criteria, risk and review requirement as the ordinary run of the same goal.
		expect(deep.run?.tasks[0]).toMatchObject({
			acceptanceCriteria: [{ id: "AC-001", verification: { checkIds: ["regression"], reviewRequired: true } }],
		});
		expect({ risk: deep.run?.risk, workflow: deep.run?.workflow }).toEqual({
			risk: ordinary.run?.risk,
			workflow: ordinary.run?.workflow,
		});
	});

	it("refuses --deep before any model runtime, provider call or Run when it cannot apply", async () => {
		const plain = runtimeConfig({ profiles });
		const aliased = runtimeConfig({ profiles, intents });
		for (const [name, config, command, reason] of [
			[
				"deep-unmapped",
				plain,
				"run --deep Fix bug",
				"--deep needs models.intents.deep naming a configured profile in .ai/config.yaml; deep is never selected automatically and has no fallback",
			],
			[
				"deep-quick",
				aliased,
				"run --deep Fix typo in src/app.ts",
				"this goal selects QUICK (one Executor, no Developer); no downgrade or fallback performed",
			],
		] as const) {
			const cwd = project(name, config);
			const result = await tui(cwd, command);
			expect(result.outcome).toContain(reason);
			expect(result.run).toBeUndefined();
			expect(result.preview).toBe("");
			expect(result.modelsCreated).toBe(0);
			expect(result.providerCalls).toBe(0);
			expect(existsSync(join(cwd, ".ai/state.json"))).toBe(false);
		}
	});

	it("fails an unavailable aliased profile before execution without falling back", async () => {
		for (const [name, creative, alias, reason] of [
			[
				"missing-model",
				{ provider: "faux", model: "missing-model" },
				{ review: "creative" },
				"Worker model unavailable for Reviewer review -> creative; fallback disabled",
			],
			[
				"missing-provider",
				{ provider: "missing-provider", model: "creative" },
				{ standard: "creative" },
				"Worker profile/provider unavailable for Developer standard -> creative; fallback disabled",
			],
		] as const) {
			const config = runtimeConfig({ profiles: { ...profiles, creative }, intents: alias });
			const cwd = project(name, config);
			const result = await execute(cwd, config, "Fix bug");
			expect(result.report.error).toBe(reason);
			expect(result.run).toBeUndefined();
			expect(result.providerCalls).toBe(0);
			expect(calls).toEqual([]);
			expect((await FileStateStore.readSnapshot(cwd)).state?.runs ?? []).toEqual([]);
		}
		// Authentication of only the aliased profile's model is missing: still refused before any Run.
		const aliased = runtimeConfig({ profiles, intents: { review: "fast" } });
		const runtime = harness.session.modelRuntime;
		const getAuth = runtime.getAuth.bind(runtime);
		vi.spyOn(runtime, "getAuth").mockImplementation(async (model, overrides) =>
			model.id === "fast" ? undefined : getAuth(model, overrides),
		);
		const cwd = project("missing-auth", aliased);
		const auth = await execute(cwd, aliased, "Fix bug");
		expect(auth.report.error).toBe(
			"Worker authentication unavailable for Reviewer review -> fast; fallback disabled",
		);
		expect(auth.run).toBeUndefined();
		expect(auth.providerCalls).toBe(0);
		expect((await FileStateStore.readSnapshot(cwd)).state?.runs ?? []).toEqual([]);
	});

	it("binds deep to explicit Developer runs only and keeps the Policy identical", async () => {
		const aliased = runtimeConfig({ profiles, intents });
		const cwd = project("policy", aliased);
		const store = await FileStateStore.open(cwd);
		try {
			const base = {
				executionContract: { runId: "run-1", mode: "EDIT" as const },
				cwd,
				agentDir,
				config: aliased,
				audit: store,
				modelRuntime: harness.session.modelRuntime,
				timeoutMs: 5000,
			};
			const ordinary = await PiAgentExecutor.create(base);
			const deep = await PiAgentExecutor.create({ ...base, deep: true });
			expect(deep.policyContext).toEqual(ordinary.policyContext);
			await expect(
				PiAgentExecutor.create({ ...base, config: runtimeConfig({ profiles }), deep: true }),
			).rejects.toThrow("Model intent deep is not configured (models.intents.deep)");
			await expect(
				PiAgentExecutor.create({ ...base, deep: true, quickScope: { risk: "R1", targetPath: "src/app.ts" } }),
			).rejects.toThrow("Model intent deep routes Developers; a QUICK run has none");
			expect(harness.faux.state.callCount).toBe(0);
		} finally {
			await store.close();
		}
	});

	it("starts worker spans with the routed profile, alias and requested model", async () => {
		const starts: Array<Record<string, unknown>> = [];
		const span = {
			startSpan: async <T>(_options: SpanOptions, callback: (value: TelemetrySpan) => T | Promise<T>) =>
				await callback(span as unknown as TelemetrySpan),
			addEvent: () => {},
			setAttributes: () => {},
			setStatus: () => {},
		};
		const telemetry: TelemetryContext = {
			startSpan: async <T>(options: SpanOptions, callback: (value: TelemetrySpan) => T | Promise<T>) => {
				if (options.name === "weavra.worker") starts.push(options.attributes ?? {});
				return await callback(span as unknown as TelemetrySpan);
			},
		};
		const aliased = runtimeConfig({ profiles, intents });
		const result = await execute(project("telemetry", aliased), aliased, "Fix bug", { deep: true, telemetry });
		expect(result.run?.status, result.report.error).toBe("COMPLETED");
		expect(starts).toEqual([
			{
				role: "Developer",
				profile: "reasoning",
				modelIntent: "deep",
				revision: 0,
				provider: "faux",
				model: "review",
			},
			{ role: "Reviewer", profile: "coding", modelIntent: "review", revision: 0, provider: "faux", model: "coding" },
		]);
	});
});
