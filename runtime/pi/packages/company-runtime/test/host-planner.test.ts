import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, realpath, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetController } from "../src/budget.ts";
import { classifyRequest } from "../src/classification.ts";
import type { HostControlOptions } from "../src/host-control.ts";
import {
	HOST_CONTROL_COMMANDS,
	HOST_CONTROL_ERROR_CODES,
	HOST_PLANNER_COMMANDS,
	type HostControlResponse,
	type HostPlannerStatus,
} from "../src/host-control-protocol.ts";
import { CompanyKernel } from "../src/kernel.ts";
import { PLANNER_REMINDER, PLANNER_SYSTEM_PROMPT, plannerRequestDigest } from "../src/planner.ts";
import { FileStateStore } from "../src/state-store.ts";
import { testContract } from "./fixture-contract.ts";
import {
	COMPLEX_GOAL,
	CONFIG,
	type Connection,
	DRAFT,
	deferred,
	fauxModels,
	hanging,
	type PlannerProject,
	plannerClient,
	plannerProject,
	planningContext,
	STATEMENTS,
	submission,
	text,
	toolResultTexts,
	userTexts,
} from "./planner-fixture.ts";

// V0.8B Planner over the real Host Control bridge (PLANNER_DRAFT.md §3–§8, #54 L01–L14 at the Runtime boundary).
// The model is the scripted faux provider; nothing here reaches a real provider, credential or network.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let project: PlannerProject | undefined;
let faux: FauxProviderRegistration | undefined;
const bridges = new Set<Connection["bridge"]>();
afterEach(async () => {
	vi.useRealTimers();
	vi.restoreAllMocks();
	for (const bridge of bridges) await bridge.shutdown();
	bridges.clear();
	faux?.unregister();
	faux = undefined;
	await project?.cleanup();
	project = undefined;
});

async function setup(options: { config?: unknown; client?: Partial<HostControlOptions> } = {}) {
	project = await plannerProject(options.config ?? CONFIG);
	const models = await fauxModels();
	faux = models.faux;
	const client = await plannerClient(project, { models: models.runtime, ...options.client });
	bridges.add(client.bridge);
	return { client, faux: models.faux, runtime: models.runtime, project };
}
const failure = (response: HostControlResponse) => (response.success ? null : response.error.code);
async function read(client: Connection, planId: string) {
	return client.mutation({ type: "planner.read", planId });
}
/** A two-task draft whose tasks both cover only AC-001 (INVALID_CRITERIA: AC-002 uncovered). */
const UNCOVERED = { tasks: DRAFT.tasks.map((task) => ({ ...task, criterionIndexes: [1] })) };
const withClaim = (path: string, operation: string) => ({
	tasks: [DRAFT.tasks[0], { ...DRAFT.tasks[1], ownership: [{ path, operation }] }],
});

describe("§7.1 capability and §7.3 snapshot shape", () => {
	it("advertises only plannerContractVersion 1, keeps the commands tuple and accepts the three commands", async () => {
		const { client, faux } = await setup();
		expect(client.hello).toMatchObject({
			success: true,
			data: { kind: "capabilities", capabilities: { plannerContractVersion: 1, complexContractVersion: 2 } },
		});
		// Older Apps decode the advertised tuple strictly, so it stays exactly the V0.8A list.
		if (!client.hello.success || client.hello.data.kind !== "capabilities") throw new Error("capabilities expected");
		expect(client.hello.data.capabilities.commands).toEqual([
			"control.hello",
			"control.snapshot",
			"workflow.prepare",
			"workflow.confirm",
			"workflow.cancel",
			"approval.resolve",
			"browser.inspect",
			"browser.prepare",
			"browser.confirm",
			"facts.prepare",
			"facts.confirm",
		]);
		expect(client.hello.data.capabilities.commands).toEqual(HOST_CONTROL_COMMANDS);
		expect(HOST_PLANNER_COMMANDS).toEqual(["planner.start", "planner.cancel", "planner.read"]);
		// V0.8C appends RERUN_NOT_APPLICABLE after them.
		expect(HOST_CONTROL_ERROR_CODES.slice(-4, -1)).toEqual([
			"PLANNER_BUSY",
			"PLANNER_NOT_FOUND",
			"PLANNER_NOT_READY",
		]);
		// Accepted when requested; a planId is a canonical lowercase UUID.
		const unknown = "00000000-0000-4000-8000-000000000000";
		expect(failure(await client.mutation({ type: "planner.read", planId: unknown }))).toBe("PLANNER_NOT_FOUND");
		for (const planId of ["not-a-uuid", "0000000A-0000-4000-8000-00000000000B"])
			expect(failure(await client.mutation({ type: "planner.cancel", planId }))).toBe("INVALID_REQUEST");
		expect(failure(await client.mutation({ type: "planner.remove", planId: unknown }))).toBe("UNSUPPORTED_COMMAND");
		expect(faux.state.callCount).toBe(0);
	});

	it("keeps every snapshot free of a planner key until a planner.start is accepted (L14)", async () => {
		const { client, faux } = await setup();
		const first = await client.state();
		expect("planner" in first).toBe(false);
		expect(client.lines.at(-1)).not.toContain('"planner"');
		// Refused starts create no planner state, so the snapshot keeps exactly its V0.8A keys.
		expect(failure(await client.start({ goal: "Fix bug in src/app.ts" }))).toBe("UNSUPPORTED_WORKFLOW");
		expect(failure(await client.start({ goal: 42 }))).toBe("INVALID_REQUEST");
		const after = await client.state();
		expect(Object.keys(after)).toEqual(Object.keys(first));
		expect(client.lines.at(-1)).not.toContain('"planner"');
		faux.setResponses([submission(DRAFT)]);
		expect(await client.start()).toMatchObject({ success: true });
		expect((await client.state()).planner).toMatchObject({ schemaVersion: 1 });
	});
});

describe("planning lifecycle (§3, §5)", () => {
	it("READY after one invocation: exactly as submitted, readable, prepares unchanged; nothing durable (L01)", async () => {
		const { client, faux, project } = await setup();
		const files = await project.aiFiles();
		const entered = deferred();
		const release = deferred();
		faux.setResponses([
			async () => {
				entered.resolve();
				await release.promise;
				return submission(DRAFT);
			},
		]);
		const started = await client.start();
		expect(started).toMatchObject({
			success: true,
			data: { kind: "accepted", requestId: expect.any(String), command: "planner.start", runId: null },
		});
		await entered.promise;
		const running = await client.state();
		expect(running.planner).toEqual({
			schemaVersion: 1,
			planId: expect.stringMatching(UUID),
			status: "RUNNING",
			requestDigest: plannerRequestDigest(COMPLEX_GOAL, STATEMENTS),
			projectRevision: 0,
			current: true,
			startedAt: expect.any(Number),
			finishedAt: null,
			route: { alias: null, profile: "reasoning", provider: "faux", model: "review" },
			usage: { invocations: 1, reportedTokens: 0 },
			taskCount: null,
			failureCode: null,
		} satisfies HostPlannerStatus);
		// Planning is not a Run: no busy owner, no writer lock and no `.ai` write while RUNNING.
		expect(running).toMatchObject({ busy: false, ownedRunId: null, projectRevision: 0 });
		expect(await project.aiFiles()).toEqual(files);
		expect(existsSync(join(project.cwd, ".ai/writer.lock"))).toBe(false);
		release.resolve();
		const ready = (await client.settle()).planner!;
		expect(ready).toMatchObject({ status: "READY", taskCount: 2, failureCode: null, current: true });
		expect(ready.finishedAt).toBeGreaterThanOrEqual(ready.startedAt);
		expect(ready.usage.invocations).toBe(1);
		expect(ready.usage.reportedTokens).toBeGreaterThan(0);
		const response = await read(client, ready.planId);
		expect(response).toEqual(
			expect.objectContaining({
				success: true,
				command: "planner.read",
				data: {
					kind: "planner-draft",
					planId: ready.planId,
					requestDigest: ready.requestDigest,
					projectRevision: 0,
					current: true,
					draft: DRAFT,
				},
			}),
		);
		expect(Buffer.byteLength(client.lines.at(-1)!)).toBeLessThanOrEqual(16384);
		expect(await project.aiFiles()).toEqual(files);
		// The unchanged draft prepares on the first try at the same revision and configuration.
		if (!response.success || response.data.kind !== "planner-draft") throw new Error("draft expected");
		const prepared = await client.mutation({
			type: "workflow.prepare",
			goal: COMPLEX_GOAL,
			acceptanceStatements: STATEMENTS,
			complexDraft: response.data.draft,
		});
		expect(prepared).toMatchObject({ success: true, data: { kind: "prepared", preview: { workflow: "COMPLEX" } } });
		expect(faux.state.callCount).toBe(1);
		expect(client.createModels).toHaveBeenCalledOnce();
		expect(await project.aiFiles()).toEqual(files);
		expect((await client.state()).projectRevision).toBe(0);
	});

	it("sends the Planning Context first, with exactly one tool and the fixed Planner prompt (L13)", async () => {
		const { client, faux } = await setup();
		let seen: { context: Record<string, unknown>; tools?: string[]; system?: string; messages: number } | undefined;
		faux.setResponses([
			(context) => {
				seen = {
					context: planningContext(context),
					tools: context.tools?.map((tool) => tool.name),
					system: context.systemPrompt,
					messages: context.messages.length,
				};
				return submission(DRAFT);
			},
		]);
		await client.start();
		expect((await client.settle()).planner?.status).toBe("READY");
		expect(seen?.tools).toEqual(["submit_plan_draft"]);
		expect(seen?.system).toContain(PLANNER_SYSTEM_PROMPT);
		expect(seen?.messages).toBe(1);
		expect(seen?.context).toMatchObject({
			role: "Planner",
			goal: COMPLEX_GOAL,
			executionMode: "EDIT",
			risk: "R1",
			checks: [
				{ id: "lint", kind: "lint", required: false },
				{ id: "test", kind: "test", required: true },
			],
			fileListing: { files: ["src/app.ts"], truncated: false },
			projectInstructions: null,
			projectFacts: [],
		});
		expect(JSON.stringify(seen?.context)).not.toMatch(/usr\/bin\/true|--test-arg|--secret-arg|config\.yaml/);
	});

	it("a text answer gets the one fixed reminder; a submission after it is READY after 2 invocations", async () => {
		const { client, faux } = await setup();
		let reminder: string | undefined;
		faux.setResponses([
			text(),
			(context) => {
				reminder = userTexts(context).at(-1);
				return submission(DRAFT);
			},
		]);
		await client.start();
		const planner = (await client.settle()).planner!;
		expect(planner).toMatchObject({ status: "READY", usage: { invocations: 2 } });
		expect(reminder).toBe(PLANNER_REMINDER);
		expect(faux.state.callCount).toBe(2);
	});

	it("NO_DRAFT after exactly 2 invocations: text, reminder, text (L04)", async () => {
		const { client, faux } = await setup();
		faux.setResponses([text(), text("Still prose."), submission(DRAFT)]);
		await client.start();
		const planner = (await client.settle()).planner!;
		expect(planner).toMatchObject({
			status: "FAILED",
			failureCode: "NO_DRAFT",
			taskCount: null,
			usage: { invocations: 2 },
		});
		expect(faux.state.callCount).toBe(2);
		expect(faux.getPendingResponseCount()).toBe(1);
		expect(failure(await read(client, planner.planId))).toBe("PLANNER_NOT_READY");
	});

	it("DRAFT_INVALID after text, invalid, invalid: exactly 3 invocations and never a 4th (L07)", async () => {
		const { client, faux, project } = await setup();
		const files = await project.aiFiles();
		let third: Context | undefined;
		faux.setResponses([
			text(),
			submission(UNCOVERED),
			(context) => {
				third = { messages: structuredClone(context.messages) };
				return submission(withClaim("docs/a.md", "create"));
			},
			submission(DRAFT),
		]);
		await client.start();
		const planner = (await client.settle()).planner!;
		expect(planner).toMatchObject({ status: "FAILED", failureCode: "DRAFT_INVALID", usage: { invocations: 3 } });
		expect(faux.state.callCount).toBe(3);
		expect(faux.getPendingResponseCount()).toBe(1);
		// The reminder came first; the one correction answered the failed submission's tool call.
		const roles = third!.messages.map((message) => message.role);
		expect(roles).toEqual(["user", "assistant", "user", "assistant", "toolResult"]);
		expect(userTexts(third!)[1]).toBe(PLANNER_REMINDER);
		const [correction] = toolResultTexts(third!);
		expect(correction).toBe(
			"submit_plan_draft rejected (INVALID_CRITERIA): Acceptance criteria AC-002 are not covered by any task; every parent criterion must be mapped\nNothing was accepted. Correct the draft and call submit_plan_draft once more, alone. This is the only correction.",
		);
		expect(Buffer.byteLength(correction, "utf8")).toBeLessThanOrEqual(2048);
		expect(await project.aiFiles()).toEqual(files);
	});

	it("refuses forged fields with the closed schema, corrects once, then DRAFT_INVALID; no Run or write (L02)", async () => {
		const { client, faux, project } = await setup();
		const files = await project.aiFiles();
		let correction: string | undefined;
		const forged = {
			tasks: DRAFT.tasks.map((task, index) => ({ ...task, id: `CT-00${index + 1}`, status: "COMPLETED" })),
			risk: "R0",
			limits: { maxParallel: 4 },
			complexPlanDigest: `sha256:${"0".repeat(64)}`,
		};
		faux.setResponses([
			submission(forged),
			(context) => {
				correction = toolResultTexts(context).at(-1);
				// A delete claim fits the closed shape but only the R3 grammar may delete.
				return submission(withClaim("src/app.ts", "delete"));
			},
		]);
		await client.start();
		const planner = (await client.settle()).planner!;
		expect(planner).toMatchObject({ status: "FAILED", failureCode: "DRAFT_INVALID", usage: { invocations: 2 } });
		expect(correction).toBe(
			"submit_plan_draft rejected (INVALID_REQUEST): complexDraft does not match the closed COMPLEX draft schema; ids, statuses, digests, limits, Risk and permissions cannot be supplied\nNothing was accepted. Correct the draft and call submit_plan_draft once more, alone. This is the only correction.",
		);
		expect(failure(await read(client, planner.planId))).toBe("PLANNER_NOT_READY");
		const state = await client.state();
		expect(state.snapshot.status.run).toBeNull();
		expect(await project.aiFiles()).toEqual(files);
	});

	it.each([
		[
			"a claim outside the allowed paths",
			withClaim("notes.md", "create"),
			/CT-002 create claim "notes\.md" is denied by current Policy \(R1\/DENY: Target outside allowed paths\)/,
		],
		[
			"a modify of a missing file",
			withClaim("src/missing.ts", "modify"),
			/CT-002 modify claim "src\/missing\.ts" needs an existing bounded strict UTF-8 text file/,
		],
	])(
		"corrects %s with the compiler's claim message; the corrected draft is READY (L03)",
		async (_name, draft, message) => {
			const { client, faux } = await setup();
			let correction: string | undefined;
			faux.setResponses([
				submission(draft),
				(context) => {
					correction = toolResultTexts(context).at(-1);
					return submission(DRAFT);
				},
			]);
			await client.start();
			const planner = (await client.settle()).planner!;
			expect(planner).toMatchObject({ status: "READY", usage: { invocations: 2 } });
			expect(correction).toMatch(/^submit_plan_draft rejected \(INVALID_CRITERIA\): /);
			expect(correction).toMatch(message);
			const response = await read(client, planner.planId);
			expect(response).toMatchObject({ success: true, data: { draft: DRAFT } });
		},
	);

	it("judges raw arguments: a coercible string index is refused, never coerced into the READY draft", async () => {
		const { client, faux } = await setup();
		const coercible = { tasks: [DRAFT.tasks[0], { ...DRAFT.tasks[1], criterionIndexes: ["2"] }] };
		let correction: string | undefined;
		faux.setResponses([
			submission(coercible),
			(context) => {
				correction = toolResultTexts(context).at(-1);
				return submission(DRAFT);
			},
		]);
		await client.start();
		const planner = (await client.settle()).planner!;
		expect(correction).toMatch(
			/^submit_plan_draft rejected \(INVALID_REQUEST\): complexDraft does not match the closed/,
		);
		expect(await read(client, planner.planId)).toMatchObject({ success: true, data: { draft: DRAFT } });
	});

	it("counts an answer with two submissions, or a submission beside another call, as one failed submission", async () => {
		const { client, faux } = await setup();
		let results: string[] = [];
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("submit_plan_draft", DRAFT, { id: "first" }),
					fauxToolCall("submit_plan_draft", DRAFT, { id: "second" }),
				],
				{ stopReason: "toolUse" },
			),
			(context) => {
				results = toolResultTexts(context);
				return submission(DRAFT);
			},
		]);
		await client.start();
		expect((await client.settle()).planner).toMatchObject({ status: "READY", usage: { invocations: 2 } });
		expect(results).toEqual([
			"submit_plan_draft rejected (INVALID_REQUEST): An answer must contain exactly one submit_plan_draft call and no other tool call; this answer had 2 submit_plan_draft call(s) and 0 other call(s)\nNothing was accepted. Correct the draft and call submit_plan_draft once more, alone. This is the only correction.",
			"Not evaluated: submit_plan_draft must be the only tool call of an answer, called exactly once.",
		]);
		// The one correction is spent: a mixed answer next is the second failed submission.
		faux.setResponses([
			fauxAssistantMessage(
				[
					fauxToolCall("submit_plan_draft", DRAFT, { id: "draft" }),
					fauxToolCall("runtime_read", { path: "src/app.ts" }),
				],
				{ stopReason: "toolUse" },
			),
			submission(UNCOVERED),
			submission(DRAFT),
		]);
		await client.start();
		expect((await client.settle()).planner).toMatchObject({
			status: "FAILED",
			failureCode: "DRAFT_INVALID",
			usage: { invocations: 2 },
		});
		expect(faux.getPendingResponseCount()).toBe(1);
	});

	it("treats a call to any other tool name as an answer without a submission", async () => {
		const { client, faux } = await setup();
		let context: Context | undefined;
		faux.setResponses([
			fauxAssistantMessage(fauxToolCall("runtime_list_files", {}), { stopReason: "toolUse" }),
			(value) => {
				context = { messages: structuredClone(value.messages) };
				return submission(DRAFT);
			},
		]);
		await client.start();
		expect((await client.settle()).planner).toMatchObject({ status: "READY", usage: { invocations: 2 } });
		expect(context!.messages.map((message) => message.role)).toEqual(["user", "assistant", "toolResult", "user"]);
		expect(toolResultTexts(context!)).toEqual(["Tool runtime_list_files not found"]);
		expect(userTexts(context!).at(-1)).toBe(PLANNER_REMINDER);
	});
});

describe("§5.5 failure codes", () => {
	it.each([
		[
			"an unregistered provider",
			{
				...CONFIG,
				models: { profiles: { ...CONFIG.models.profiles, reasoning: { provider: "missing", model: "review" } } },
			},
			{ alias: null, profile: "reasoning", provider: "missing", model: "review" },
		],
		[
			"models.intents.plan naming a profile without a usable model",
			{
				...CONFIG,
				models: {
					profiles: { ...CONFIG.models.profiles, fast: { provider: "faux", model: "absent" } },
					intents: { plan: "fast" },
				},
			},
			{ alias: "plan", profile: "fast", provider: "faux", model: "absent" },
		],
	])(
		"MODEL_UNAVAILABLE for %s: the requested route is reported and no model is called",
		async (_name, config, route) => {
			const { client, faux } = await setup({ config });
			await client.start();
			expect((await client.settle()).planner).toMatchObject({
				status: "FAILED",
				failureCode: "MODEL_UNAVAILABLE",
				route,
				usage: { invocations: 0, reportedTokens: 0 },
			});
			expect(faux.state.callCount).toBe(0);
		},
	);

	it("MODEL_UNAVAILABLE when the model runtime cannot be created", async () => {
		const createModels = vi.fn(async (): Promise<never> => {
			throw new Error("PRIVATE_RUNTIME_ERROR");
		});
		const { client, faux } = await setup({ client: { createModels } });
		await client.start();
		expect((await client.settle()).planner).toMatchObject({ status: "FAILED", failureCode: "MODEL_UNAVAILABLE" });
		expect(createModels).toHaveBeenCalledOnce();
		expect(faux.state.callCount).toBe(0);
		expect(client.lines.join("")).not.toContain("PRIVATE_RUNTIME_ERROR");
	});

	it("CONTEXT_TOO_LARGE before any model runtime or model call; nothing is truncated", async () => {
		const { client, faux, project } = await setup({
			config: { ...CONFIG, project: { instructions: { path: "src/AGENTS.md" } } },
		});
		await writeFile(join(project.cwd, "src/AGENTS.md"), "\u0001".repeat(60_000));
		await client.start();
		expect((await client.settle()).planner).toMatchObject({
			status: "FAILED",
			failureCode: "CONTEXT_TOO_LARGE",
			usage: { invocations: 0, reportedTokens: 0 },
		});
		expect(client.createModels).not.toHaveBeenCalled();
		expect(faux.state.callCount).toBe(0);
	});

	it("TIMEOUT bounds the whole request; the session is aborted and disposed (L05)", async () => {
		const { client, faux, project } = await setup({ client: { plannerTimeoutMs: 250 } });
		const files = await project.aiFiles();
		let signal: AbortSignal | undefined;
		faux.setResponses([
			async (context, options) => {
				signal = options?.signal;
				return hanging()(context, options, faux!.state, faux!.getModel());
			},
		]);
		await client.start();
		const planner = (await client.settle()).planner!;
		expect(planner).toMatchObject({ status: "FAILED", failureCode: "TIMEOUT", usage: { invocations: 1 } });
		expect(signal?.aborted).toBe(true);
		// Disposed: a new request is accepted at once instead of PLANNER_BUSY.
		faux.setResponses([submission(DRAFT)]);
		await vi.waitFor(async () => expect(failure(await client.start())).toBeNull(), { timeout: 5000, interval: 10 });
		expect(await project.aiFiles()).toEqual(files);
	});

	it("TIMEOUT defaults to agents.worker_timeout_ms for the whole request", async () => {
		const { client, faux } = await setup({ config: { ...CONFIG, agents: { worker_timeout_ms: 10_000 } } });
		const entered = deferred();
		faux.setResponses([hanging(() => entered.resolve())]);
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		await client.start();
		await entered.promise;
		await vi.advanceTimersByTimeAsync(9_999);
		expect((await client.state()).planner?.status).toBe("RUNNING");
		await vi.advanceTimersByTimeAsync(1);
		expect((await client.settle()).planner).toMatchObject({ status: "FAILED", failureCode: "TIMEOUT" });
	});

	it.each([
		[
			"an error answer",
			() => fauxAssistantMessage("", { stopReason: "error", errorMessage: "PRIVATE upstream 500" }),
		],
		["a failing provider", () => Promise.reject(new Error("PRIVATE transport failure"))],
		[
			"an answer cut off at the output limit",
			() => fauxAssistantMessage(fauxToolCall("submit_plan_draft", DRAFT), { stopReason: "length" }),
		],
	])("PROVIDER_ERROR for %s, with no reminder or correction", async (_name, answer) => {
		const { client, faux } = await setup();
		faux.setResponses([answer, submission(DRAFT)]);
		await client.start();
		expect((await client.settle()).planner).toMatchObject({
			status: "FAILED",
			failureCode: "PROVIDER_ERROR",
			usage: { invocations: 1 },
		});
		expect(faux.state.callCount).toBe(1);
		expect(client.lines.join("")).not.toContain("PRIVATE");
	});

	it("BUDGET_EXHAUSTED: min(200,000, budget.max_reported_tokens) denies the next reservation", async () => {
		const { client, faux } = await setup({ config: { ...CONFIG, budget: { max_reported_tokens: 50 } } });
		faux.setResponses([text(), submission(DRAFT)]);
		await client.start();
		const planner = (await client.settle()).planner!;
		expect(planner).toMatchObject({ status: "FAILED", failureCode: "BUDGET_EXHAUSTED", usage: { invocations: 1 } });
		expect(planner.usage.reportedTokens).toBeGreaterThanOrEqual(50);
		expect(faux.state.callCount).toBe(1);
	});

	it("BUDGET_UNKNOWN: unreported usage with the token cap denies the next reservation", async () => {
		const { client, faux } = await setup();
		const settle = BudgetController.prototype.recordUsage;
		// The provider reported no usage for the answer (the faux provider always estimates it).
		vi.spyOn(BudgetController.prototype, "recordUsage").mockImplementation(function (
			this: BudgetController,
			role,
			usage,
		) {
			settle.call(this, role, { ...usage, source: "unavailable" });
		});
		faux.setResponses([text(), submission(DRAFT)]);
		await client.start();
		expect((await client.settle()).planner).toMatchObject({
			status: "FAILED",
			failureCode: "BUDGET_UNKNOWN",
			usage: { invocations: 1, reportedTokens: null },
		});
		expect(faux.state.callCount).toBe(1);
	});

	it("STALE: a configuration change while RUNNING ends the request before the next model call (L10)", async () => {
		const { client, faux, project } = await setup();
		faux.setResponses([
			async () => {
				await project.configure({ ...CONFIG, files: { allowed_paths: ["src", "lib"] } });
				return text();
			},
			submission(DRAFT),
		]);
		await client.start();
		const planner = (await client.settle()).planner!;
		expect(planner).toMatchObject({
			status: "FAILED",
			failureCode: "STALE",
			current: false,
			usage: { invocations: 1 },
		});
		expect(faux.state.callCount).toBe(1);
		expect(failure(await read(client, planner.planId))).toBe("PLANNER_NOT_READY");
	});

	it("STALE: a submission after the configuration changed is never validated against it", async () => {
		const { client, faux, project } = await setup();
		faux.setResponses([
			async () => {
				await project.configure({ ...CONFIG, agents: { max_revision_cycles: 1 } });
				return submission(DRAFT);
			},
		]);
		await client.start();
		expect((await client.settle()).planner).toMatchObject({ status: "FAILED", failureCode: "STALE" });
	});

	it("STALE: a project revision commit while RUNNING discards even a valid draft before READY (L10)", async () => {
		const { client, faux } = await setup();
		const entered = deferred();
		const release = deferred();
		faux.setResponses([
			async () => {
				entered.resolve();
				await release.promise;
				return submission(DRAFT);
			},
		]);
		await client.start();
		await entered.promise;
		// Another durable commit (a reviewed fact) moves the project revision; allowed while planning.
		const prepared = await client.mutation({
			type: "facts.prepare",
			sourceRef: "src/app.ts",
			statement: "The app module exports one constant",
		});
		if (!prepared.success || prepared.data.kind !== "fact-prepared") throw new Error(JSON.stringify(prepared));
		const { previewId, previewDigest } = prepared.data.preview;
		expect(await client.mutation({ type: "facts.confirm", previewId, previewDigest })).toMatchObject({
			success: true,
		});
		release.resolve();
		const state = await client.settle();
		expect(state.projectRevision).toBe(1);
		expect(state.planner).toMatchObject({
			status: "FAILED",
			failureCode: "STALE",
			projectRevision: 0,
			current: false,
		});
		expect(failure(await read(client, state.planner!.planId))).toBe("PLANNER_NOT_READY");
	});
});

describe("§7.2 refusals make no model call (L08)", () => {
	/** A STANDARD Run whose owner stopped without releasing; `lock` decides what the owner left behind. */
	async function orphan(cwd: string, lock: "dead" | "none") {
		const store = await FileStateStore.open(cwd);
		const kernel = await CompanyKernel.create(
			{
				executionMode: "EDIT",
				runId: "orphan-run",
				task: testContract("Fix bug", { taskId: "task-orphan" }),
				classification: classifyRequest("Fix bug").classification,
			},
			{
				store,
				agents: { execute: async () => Promise.reject(new Error("unused")) },
				verifier: { verify: async () => Promise.reject(new Error("unused")) },
			},
		);
		await kernel.start();
		await store.close();
		if (lock === "dead") {
			const child = spawnSync(process.execPath, ["-e", ""]);
			await writeFile(
				join(cwd, ".ai/writer.lock"),
				JSON.stringify({
					schemaVersion: 1,
					projectPath: await realpath(cwd),
					token: "orphan-owner",
					pid: child.pid,
					hostname: hostname(),
				}),
				{ mode: 0o600 },
			);
		}
	}

	it.each<[string, Record<string, unknown>, string]>([
		["a goal that selects STANDARD", { goal: "Fix bug in src/app.ts" }, "UNSUPPORTED_WORKFLOW"],
		["a goal that selects QUICK", { goal: "Fix typo in src/app.ts" }, "UNSUPPORTED_WORKFLOW"],
		["an ambiguous goal", { goal: "Explain and fix the parser across multiple modules" }, "INVALID_GOAL"],
		["a missing goal", { goal: undefined }, "INVALID_REQUEST"],
		["an unknown field", { complexDraft: DRAFT }, "INVALID_REQUEST"],
		[
			"17 statements",
			{ acceptanceStatements: Array.from({ length: 17 }, (_, index) => `C${index}`) },
			"INVALID_REQUEST",
		],
		["a statement over 500 characters", { acceptanceStatements: ["x".repeat(501)] }, "INVALID_REQUEST"],
		["duplicate statements", { acceptanceStatements: ["Same criterion", "same  criterion"] }, "INVALID_REQUEST"],
		[
			"a goal-only criterion over 500 characters",
			{ goal: `${COMPLEX_GOAL} ${"y".repeat(480)}`, acceptanceStatements: undefined },
			"INVALID_REQUEST",
		],
	])("refuses %s", async (_name, fields, code) => {
		const { client, faux, project } = await setup();
		const files = await project.aiFiles();
		expect(failure(await client.start(fields))).toBe(code);
		expect(client.createModels).not.toHaveBeenCalled();
		expect(faux.state.callCount).toBe(0);
		expect("planner" in (await client.state())).toBe(false);
		expect(await project.aiFiles()).toEqual(files);
	});

	it("refuses an R3 COMPLEX goal with UNSUPPORTED_WORKFLOW", async () => {
		const { client, faux } = await setup({ config: { ...CONFIG, runtime: { workflow: "COMPLEX" } } });
		expect(failure(await client.start({ goal: "delete file src/app.ts", acceptanceStatements: undefined }))).toBe(
			"UNSUPPORTED_WORKFLOW",
		);
		expect(client.createModels).not.toHaveBeenCalled();
		expect(faux.state.callCount).toBe(0);
	});

	it("refuses a stale expected revision with STALE_PROJECT", async () => {
		const { client, faux } = await setup();
		const state = await client.state();
		const response = await client.send({
			id: state.nextRequestId,
			ownerId: state.ownerId,
			expectedProjectRevision: state.projectRevision + 1,
			type: "planner.start",
			goal: COMPLEX_GOAL,
		});
		expect(failure(response)).toBe("STALE_PROJECT");
		expect(client.createModels).not.toHaveBeenCalled();
		expect(faux.state.callCount).toBe(0);
	});

	it("recovers a provably dead owner like prepare: STALE_PROJECT, then a start at the recovered revision", async () => {
		const { client, faux, project } = await setup();
		await orphan(project.cwd, "dead");
		const seen = await client.state();
		expect(seen.snapshot.status).toMatchObject({ writerPresent: true, run: { status: "RUNNING" } });
		expect(failure(await client.start())).toBe("STALE_PROJECT");
		expect(client.createModels).not.toHaveBeenCalled();
		const recovered = await client.state();
		expect(recovered.projectRevision).toBe(seen.projectRevision + 1);
		expect(recovered.snapshot.status).toMatchObject({ writerPresent: false, run: { status: "INTERRUPTED" } });
		expect("planner" in recovered).toBe(false);
		faux.setResponses([submission(DRAFT)]);
		expect(failure(await client.start())).toBeNull();
		expect((await client.settle()).planner).toMatchObject({
			status: "READY",
			projectRevision: recovered.projectRevision,
		});
	});

	it("refuses an active Run with ACTIVE_RUN and a live writer with WRITER_PRESENT", async () => {
		const { client, faux, project } = await setup();
		const store = await FileStateStore.open(project.cwd);
		expect(failure(await client.start())).toBe("WRITER_PRESENT");
		await store.close();
		await orphan(project.cwd, "none");
		expect(failure(await client.start())).toBe("ACTIVE_RUN");
		expect(client.createModels).not.toHaveBeenCalled();
		expect(faux.state.callCount).toBe(0);
	});

	it("refuses PLANNER_BUSY while planning runs and while a Run execution is in progress on this Host", async () => {
		const release = deferred();
		const created = deferred();
		let runtime: Awaited<ReturnType<typeof fauxModels>>["runtime"] | undefined;
		const createModels = vi.fn(async () => {
			if (createModels.mock.calls.length > 1) {
				created.resolve();
				await release.promise;
				throw new Error("Run start stopped by the test");
			}
			return runtime!;
		});
		const context = await setup({ client: { createModels } });
		runtime = context.runtime;
		const { client, faux } = context;
		const entered = deferred();
		faux.setResponses([hanging(() => entered.resolve())]);
		expect(failure(await client.start())).toBeNull();
		await entered.promise;
		expect(failure(await client.start())).toBe("PLANNER_BUSY");
		const planId = (await client.state()).planner!.planId;
		await client.mutation({ type: "planner.cancel", planId });
		await client.settle((planner) => planner?.status === "CANCELLED");
		// A Run execution owned by this Host: the start is refused before idleness or classification.
		const prepared = await client.mutation({ type: "workflow.prepare", goal: "Fix bug in src/app.ts" });
		if (!prepared.success || prepared.data.kind !== "prepared") throw new Error(JSON.stringify(prepared));
		const { previewId, previewDigest } = prepared.data.preview;
		await vi.waitFor(
			async () =>
				expect(failure(await client.mutation({ type: "workflow.confirm", previewId, previewDigest }))).toBeNull(),
			{ timeout: 5000, interval: 10 },
		);
		await created.promise;
		expect((await client.state()).busy).toBe(true);
		expect(failure(await client.start())).toBe("PLANNER_BUSY");
		release.resolve();
		await vi.waitFor(async () => expect((await client.state()).busy).toBe(false), { timeout: 5000, interval: 10 });
		expect(faux.state.callCount).toBe(1);
	});
});

describe("planner.cancel and planner.read", () => {
	it("cancel while RUNNING: CANCELLED at once and the late submission is ignored (L06)", async () => {
		const { client, faux, project } = await setup();
		const files = await project.aiFiles();
		const entered = deferred();
		const release = deferred();
		let signal: AbortSignal | undefined;
		faux.setResponses([
			async (_context, options) => {
				signal = options?.signal;
				entered.resolve();
				// A non-cooperative provider: it answers only after the Host cancelled.
				await release.promise;
				return submission(DRAFT);
			},
		]);
		await client.start();
		await entered.promise;
		const planId = (await client.state()).planner!.planId;
		expect(await client.mutation({ type: "planner.cancel", planId })).toMatchObject({
			success: true,
			data: { kind: "accepted", command: "planner.cancel", runId: null },
		});
		const cancelled = (await client.state()).planner!;
		expect(cancelled).toMatchObject({ status: "CANCELLED", failureCode: null, taskCount: null });
		expect(cancelled.finishedAt).toEqual(expect.any(Number));
		expect(signal?.aborted).toBe(true);
		release.resolve();
		// Until the session is disposed the Host stays busy; afterwards confirm reaches its own preview check.
		await vi.waitFor(
			async () =>
				expect(
					failure(
						await client.mutation({
							type: "workflow.confirm",
							previewId: "none",
							previewDigest: `sha256:${"0".repeat(64)}`,
						}),
					),
				).toBe("PLAN_NOT_FOUND"),
			{ timeout: 5000, interval: 10 },
		);
		// The late answer landed on a disposed request: still CANCELLED, never READY, nothing readable.
		expect((await client.state()).planner).toEqual(cancelled);
		expect(failure(await read(client, planId))).toBe("PLANNER_NOT_READY");
		expect(faux.state.callCount).toBe(1);
		// A new start replaces it.
		faux.setResponses([submission(DRAFT)]);
		expect(failure(await client.start())).toBeNull();
		expect(failure(await read(client, planId))).toBe("PLANNER_NOT_FOUND");
		expect(failure(await client.mutation({ type: "planner.cancel", planId }))).toBe("PLANNER_NOT_FOUND");
		expect((await client.settle()).planner?.status).toBe("READY");
		expect(faux.state.callCount).toBe(2);
		expect(await project.aiFiles()).toEqual(files);
	});

	it("answers PLANNER_NOT_FOUND and PLANNER_NOT_READY for every non-applicable request", async () => {
		const { client, faux } = await setup();
		const unknown = "00000000-0000-4000-8000-000000000000";
		expect(failure(await client.mutation({ type: "planner.cancel", planId: unknown }))).toBe("PLANNER_NOT_FOUND");
		expect(failure(await read(client, unknown))).toBe("PLANNER_NOT_FOUND");
		const entered = deferred();
		const release = deferred();
		faux.setResponses([
			async () => {
				entered.resolve();
				await release.promise;
				return text();
			},
			text(),
		]);
		await client.start();
		await entered.promise;
		const planId = (await client.state()).planner!.planId;
		expect(failure(await read(client, planId))).toBe("PLANNER_NOT_READY");
		expect(failure(await read(client, unknown))).toBe("PLANNER_NOT_FOUND");
		expect(failure(await client.mutation({ type: "planner.cancel", planId: unknown }))).toBe("PLANNER_NOT_FOUND");
		release.resolve();
		expect((await client.settle()).planner).toMatchObject({ status: "FAILED", failureCode: "NO_DRAFT" });
		expect(failure(await read(client, planId))).toBe("PLANNER_NOT_READY");
		// Only RUNNING can be cancelled.
		expect(failure(await client.mutation({ type: "planner.cancel", planId }))).toBe("PLANNER_NOT_FOUND");
		faux.setResponses([submission(DRAFT)]);
		await client.start();
		const ready = (await client.settle()).planner!;
		expect(failure(await client.mutation({ type: "planner.cancel", planId: ready.planId }))).toBe(
			"PLANNER_NOT_FOUND",
		);
		expect(failure(await read(client, ready.planId))).toBeNull();
	});

	it("cancels RUNNING planning when the owner connection closes, not when another does (L12)", async () => {
		const { client, faux, project } = await setup();
		const files = await project.aiFiles();
		const owner = await plannerClient(project, {}, client.bridge);
		const other = await plannerClient(project, {}, client.bridge);
		const entered = deferred();
		let signal: AbortSignal | undefined;
		faux.setResponses([
			async (context, options) => {
				signal = options?.signal;
				entered.resolve();
				return hanging()(context, options, faux!.state, faux!.getModel());
			},
		]);
		expect(failure(await owner.start())).toBeNull();
		await entered.promise;
		other.connection.close();
		expect((await client.state()).planner?.status).toBe("RUNNING");
		owner.connection.close();
		expect((await client.state()).planner).toMatchObject({ status: "CANCELLED", failureCode: null });
		expect(signal?.aborted).toBe(true);
		expect(await project.aiFiles()).toEqual(files);
	});

	it("cancels RUNNING planning on Host shutdown and waits for the session to be disposed", async () => {
		const { client, faux, project } = await setup();
		const entered = deferred();
		let signal: AbortSignal | undefined;
		faux.setResponses([
			async (context, options) => {
				signal = options?.signal;
				entered.resolve();
				return hanging()(context, options, faux!.state, faux!.getModel());
			},
		]);
		await client.start();
		await entered.promise;
		await client.bridge.shutdown();
		expect(signal?.aborted).toBe(true);
		expect(faux.state.callCount).toBe(1);
		expect((await readdir(join(project.cwd, ".ai"))).sort()).toEqual(["config.yaml"]);
	});
});

describe("§6 current and §8 interactions", () => {
	it("computes current on every snapshot and read; a non-current READY draft stays readable (L11)", async () => {
		const { client, faux, project } = await setup();
		faux.setResponses([submission(DRAFT)]);
		await client.start();
		const ready = (await client.settle()).planner!;
		expect(ready.current).toBe(true);
		await project.configure({ ...CONFIG, agents: { max_revision_cycles: 1 } });
		expect((await client.state()).planner).toMatchObject({ status: "READY", current: false });
		expect(await read(client, ready.planId)).toMatchObject({ success: true, data: { current: false, draft: DRAFT } });
		await project.configure(CONFIG);
		expect((await client.state()).planner?.current).toBe(true);
		// A project revision commit: never current again for this request.
		const prepared = await client.mutation({
			type: "facts.prepare",
			sourceRef: "src/app.ts",
			statement: "App is one module",
		});
		if (!prepared.success || prepared.data.kind !== "fact-prepared") throw new Error(JSON.stringify(prepared));
		const { previewId, previewDigest } = prepared.data.preview;
		await client.mutation({ type: "facts.confirm", previewId, previewDigest });
		const moved = await client.state();
		expect(moved.projectRevision).toBe(1);
		expect(moved.planner).toMatchObject({ status: "READY", current: false, projectRevision: 0 });
		const stale = await read(client, ready.planId);
		expect(stale).toMatchObject({ success: true, data: { current: false, projectRevision: 0, draft: DRAFT } });
		// Prepare recompiles the loaded draft at the current revision regardless.
		expect(
			await client.mutation({
				type: "workflow.prepare",
				goal: COMPLEX_GOAL,
				acceptanceStatements: STATEMENTS,
				complexDraft: DRAFT,
			}),
		).toMatchObject({ success: true, data: { kind: "prepared", preview: { projectRevision: 1 } } });
	});

	it("allows workflow.prepare while RUNNING and refuses workflow.confirm with PLANNER_BUSY (L09)", async () => {
		const { client, faux } = await setup();
		const entered = deferred();
		faux.setResponses([hanging(() => entered.resolve())]);
		await client.start();
		await entered.promise;
		const prepared = await client.mutation({
			type: "workflow.prepare",
			goal: COMPLEX_GOAL,
			acceptanceStatements: STATEMENTS,
			complexDraft: DRAFT,
		});
		if (!prepared.success || prepared.data.kind !== "prepared") throw new Error(JSON.stringify(prepared));
		const { previewId, previewDigest } = prepared.data.preview;
		expect(failure(await client.mutation({ type: "workflow.confirm", previewId, previewDigest }))).toBe(
			"PLANNER_BUSY",
		);
		const state = await client.state();
		// No implicit cancel, no Run and the preview is still unconsumed.
		expect(state).toMatchObject({ busy: false, ownedRunId: null, preview: { previewId } });
		expect(state.planner?.status).toBe("RUNNING");
		expect(state.snapshot.status.run).toBeNull();
		expect(client.createModels).toHaveBeenCalledOnce();
	});

	it("drops the planner state on a successful workflow.confirm", async () => {
		const { client, faux } = await setup();
		faux.setResponses([submission(DRAFT)]);
		await client.start();
		const ready = (await client.settle()).planner!;
		const prepared = await client.mutation({
			type: "workflow.prepare",
			goal: COMPLEX_GOAL,
			acceptanceStatements: STATEMENTS,
			complexDraft: DRAFT,
		});
		if (!prepared.success || prepared.data.kind !== "prepared") throw new Error(JSON.stringify(prepared));
		const { previewId, previewDigest } = prepared.data.preview;
		expect(await client.mutation({ type: "workflow.confirm", previewId, previewDigest })).toMatchObject({
			success: true,
			data: { kind: "accepted", command: "workflow.confirm" },
		});
		expect("planner" in (await client.state())).toBe(false);
		expect(failure(await read(client, ready.planId))).toBe("PLANNER_NOT_FOUND");
		await vi.waitFor(async () => expect((await client.state()).busy).toBe(false), { timeout: 20_000, interval: 20 });
		expect("planner" in (await client.state())).toBe(false);
	});

	it("replaces a READY, FAILED or CANCELLED state with a new start, including an unread draft", async () => {
		const { client, faux } = await setup();
		faux.setResponses([submission(DRAFT)]);
		await client.start();
		const ready = (await client.settle()).planner!;
		faux.setResponses([text(), text()]);
		await client.start();
		const failed = (await client.settle()).planner!;
		expect(failed).toMatchObject({ status: "FAILED", failureCode: "NO_DRAFT" });
		expect(failed.planId).not.toBe(ready.planId);
		expect(failure(await read(client, ready.planId))).toBe("PLANNER_NOT_FOUND");
		const entered = deferred();
		faux.setResponses([hanging(() => entered.resolve())]);
		await client.start();
		await entered.promise;
		const running = (await client.state()).planner!;
		await client.mutation({ type: "planner.cancel", planId: running.planId });
		faux.setResponses([submission(DRAFT)]);
		await vi.waitFor(async () => expect(failure(await client.start())).toBeNull(), { timeout: 5000, interval: 10 });
		const replaced = (await client.settle()).planner!;
		expect(replaced).toMatchObject({ status: "READY" });
		expect(new Set([ready.planId, failed.planId, running.planId, replaced.planId]).size).toBe(4);
	});
});
