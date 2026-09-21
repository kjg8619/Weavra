import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiAgentExecutor } from "../../../company-runtime/src/agent-runner.ts";
import { fileDigest } from "../../../company-runtime/src/anchored-edit.ts";
import { parseRuntimeConfig } from "../../../company-runtime/src/config.ts";
import type { Run } from "../../../company-runtime/src/contracts.ts";
import { taskContractDigest } from "../../../company-runtime/src/criterion-evidence.ts";
import { projectEvidencePack } from "../../../company-runtime/src/evidence.ts";
import { projectRunGraph } from "../../../company-runtime/src/graph.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import { reviewerContextDigest } from "../../../company-runtime/src/reviewer-context.ts";
import type { ReviewerContext } from "../../../company-runtime/src/reviewer-context-types.ts";
import { StandardWorkflow } from "../../../company-runtime/src/workflow.ts";
import { workflowContract } from "./company-contract.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

let harness: Harness;
let cwd: string;
let agentDir: string;
const goal = "Fix the `formatLabel` bug in src/app.ts";
const oracle =
	'import {readFileSync} from "node:fs"; const value=readFileSync("src/app.ts","utf8"); if(value!==\'export const formatLabel = "fixed";\\n\'){console.error("Expected fixed; observed "+value);process.exit(7)}';
const input = (context: Context) =>
	JSON.parse(getMessageText(context.messages.find((message) => message.role === "user"))) as AgentExecutionRequest;
const tool = (name: string, args: Record<string, unknown>) =>
	fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });
function receipt(context: Context) {
	const output = getMessageText(context.messages.at(-1));
	return {
		fileDigest: output.split("\n")[0].slice("fileDigest: ".length),
		anchor: output.split("\n")[1].split(" ")[0],
		readReceipt: output.split("\nreadReceipt: ")[1],
	};
}
function submit(context: Context) {
	const request = input(context);
	if (request.role === "Reviewer")
		return tool("submit_review", {
			runId: request.runId,
			revision: request.revision,
			role: "Reviewer",
			task: request.task.id,
			result: "PASS",
			issues: [],
			diffDigest: request.verification.diffDigest,
			evidenceRefs: request.verification.evidenceRefs,
			criteria: request.task.acceptanceCriteria.map((criterion) => ({
				criterionId: criterion.id,
				status: "MET",
				evidenceRefs: request.verification.evidenceRefs,
			})),
		});
	return tool("submit_handoff", {
		runId: request.runId,
		revision: request.revision,
		role: request.role,
		task: request.task.id,
		changed_files: ["src/app.ts"],
		summary: "Scoped implementation",
		assumptions: [],
		tests_run: [],
		known_risks: [],
		unresolved: [],
	});
}
async function run(
	options: {
		mode?: "disabled" | "self-check-once";
		sandbox?: boolean;
		stillBroken?: boolean;
		budget?: number;
		tokens?: number;
		oldReceipt?: boolean;
		reviewerContext?: "impact" | "documentation" | "both";
		testFails?: boolean;
		tamperReviewer?: (context: ReviewerContext) => void;
	} = {},
) {
	const config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			runtime: { workflow: "STANDARD" },
			files: { allowed_paths: options.reviewerContext ? ["src", "package.json"] : ["src"] },
			mutation: { mode: "strict" },
			agents: { context_pack: { mode: "bounded" } },
			...(options.reviewerContext && options.reviewerContext !== "documentation"
				? {
						code_intelligence: {
							lsp: {
								enabled: true,
								servers: [
									{
										id: "impact-fixture",
										executable: process.execPath,
										args: [
											fileURLToPath(
												new URL("../../../company-runtime/test/fixtures/lsp-server.mjs", import.meta.url),
											),
											"impact",
											join(agentDir, "lsp-trace.jsonl"),
										],
										extensions: [".ts"],
										timeout_ms: 2000,
									},
								],
							},
						},
					}
				: {}),
			budget: { max_worker_invocations: options.budget, max_reported_tokens: options.tokens },
			...(options.reviewerContext
				? {
						review: {
							context: {
								impact: options.reviewerContext === "documentation" ? "disabled" : "bounded",
								...(options.reviewerContext !== "impact"
									? {
											documentation: {
												mode: "bounded",
												manifest: "package.json",
												requested: ["label"],
												entries: [
													{
														id: "label-doc",
														source: { kind: "reviewed-local", reference: "local:label-1.2.3" },
														component: "label",
														version: "1.2.3",
														capturedAt: "2026-01-01T00:00:00.000Z",
														digest: fileDigest("Reviewed label contract DOC_PRIVATE_SENTINEL"),
														reviewStatus: "REVIEWED",
														content: "Reviewed label contract DOC_PRIVATE_SENTINEL",
													},
												],
											},
										}
									: {}),
							},
						},
					}
				: {}),
			verification: {
				repair: { mode: options.mode ?? "self-check-once" },
				trust: { mode: "strict" },
				sandbox: { mode: options.sandbox ? "required" : "disabled" },
				checks: [
					{
						id: "regression",
						kind: "test",
						executable: process.execPath,
						args: ["oracle/check.mjs"],
						trust: { files: ["oracle/check.mjs"] },
						repairable_exit_codes: [7],
					},
				],
			},
		}),
	);
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	if (options.reviewerContext)
		writeFileSync(join(cwd, "package.json"), JSON.stringify({ dependencies: { label: "1.2.3" } }));
	const registeredOracle = options.testFails
		? `import { existsSync, writeFileSync } from "node:fs"; const p=".ai/check-count"; const n=existsSync(p)?Number(readFileSync(p,"utf8"))+1:1;writeFileSync(p,String(n));if(n===3)process.exit(7);${oracle}`
		: oracle;
	if (options.testFails) writeFileSync(join(cwd, "oracle/check.mjs"), registeredOracle);
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
	git("add", "--", "src/app.ts", "oracle/check.mjs", ".ai/config.yaml", ".gitignore");
	if (options.reviewerContext) git("add", "--", "package.json");
	git("commit", "-qm", "Repair fixture");
	const task = workflowContract(goal, config);
	const requests: AgentExecutionRequest[] = [];
	let oldReceipt: ReturnType<typeof receipt>;
	let rejectedOldReceipt = false;
	let callbackError: unknown;
	const responses: Parameters<Harness["setResponses"]>[0] = [
		(context) => {
			requests.push(input(context));
			return tool("runtime_read", { path: "src/app.ts", anchors: true });
		},
		(context) =>
			tool("runtime_edit", { path: "src/app.ts", oldText: "original", newText: "wrong", ...receipt(context) }),
		() => tool("runtime_read", { path: "src/app.ts", anchors: true }),
		(context) => {
			oldReceipt = receipt(context);
			return submit(context);
		},
		(context) => {
			const request = input(context);
			requests.push(request);
			expect(request.role).toBe("Developer");
			expect(request.revision).toBe(1);
			expect(context.messages.some((message) => message.role === "toolResult")).toBe(false);
			expect(request.taskContextPack?.snippets.find((snippet) => snippet.path === "src/app.ts")?.text).toContain(
				"wrong",
			);
			if (request.role !== "Developer") throw new Error("Expected repair Developer");
			expect(request.previousReview).toBeUndefined();
			expect(request.verificationRepair?.parent).toMatchObject({
				fromRevision: 0,
				fromStep: { stepId: "self-check", attempt: 1 },
				toRevision: 1,
				toStep: { stepId: "implement", attempt: 2 },
			});
			expect(request.verificationRepair?.failures[0]).toMatchObject({ id: "regression", exitCode: 7 });
			expect(taskContractDigest(request.task)).toBe(taskContractDigest(task));
			return options.oldReceipt
				? tool("runtime_edit", { path: "src/app.ts", oldText: "wrong", newText: "fixed", ...oldReceipt })
				: tool("runtime_read", { path: "src/app.ts", anchors: true });
		},
		...(options.oldReceipt
			? [
					(context: Context) => {
						expect(getMessageText(context.messages.at(-1))).toContain("STALE_ANCHOR");
						expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe('export const formatLabel = "wrong";\n');
						rejectedOldReceipt = true;
						return tool("runtime_read", { path: "src/app.ts", anchors: true });
					},
				]
			: []),
		(context) => {
			const fresh = receipt(context);
			expect(fresh.readReceipt).not.toBe(oldReceipt.readReceipt);
			return tool("runtime_edit", {
				path: "src/app.ts",
				oldText: "wrong",
				newText: options.stillBroken ? "still-wrong" : "fixed",
				...fresh,
			});
		},
		submit,
		(context) => {
			const request = input(context);
			requests.push(request);
			expect(request.role).toBe("Reviewer");
			expect(request.taskContextPack?.snippets.find((snippet) => snippet.path === "src/app.ts")?.text).toContain(
				"fixed",
			);
			expect(taskContractDigest(request.task)).toBe(taskContractDigest(task));
			return submit(context);
		},
	];
	harness.setResponses(
		responses.map((response) =>
			typeof response !== "function"
				? response
				: (context, callIndex, model, options) => {
						try {
							return response(context, callIndex, model, options);
						} catch (error) {
							callbackError = error;
							throw error;
						}
					},
		),
	);
	const workflow = new StandardWorkflow({
		cwd,
		goal,
		taskContract: task,
		config,
		executionMode: "EDIT",
		createAgents: async (store, quickScope, r2RunId, r3Scope, executionContract) => {
			const executor = await PiAgentExecutor.create({
				cwd,
				agentDir,
				config,
				audit: store,
				quickScope,
				r2RunId,
				r3Scope,
				executionContract,
				modelRuntime: harness.session.modelRuntime,
			});
			return {
				policy: executor.policyContext,
				executor: {
					get safeToRelease() {
						return executor.safeToRelease;
					},
					execute(request) {
						if (request.role === "Reviewer" && request.reviewerContext && options.tamperReviewer) {
							const context = structuredClone(request.reviewerContext);
							options.tamperReviewer(context);
							context.digest = reviewerContextDigest(context);
							return executor.execute({ ...request, reviewerContext: context });
						}
						return executor.execute(request);
					},
				},
			};
		},
	});
	const report = await workflow.execute();
	if (callbackError) throw callbackError;
	expect(readFileSync(join(cwd, "oracle/check.mjs"), "utf8")).toBe(registeredOracle);
	expect(existsSync(join(cwd, ".ai/writer.lock"))).toBe(false);
	const persisted = JSON.parse(readFileSync(join(cwd, ".ai/state.json"), "utf8")) as { runs: Run[] };
	expect(persisted.runs[0]).toEqual(report.run);
	return { report, requests, rejectedOldReceipt, task };
}
beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "coding" }, { id: "review" }] });
	cwd = join(harness.tempDir, "project");
	agentDir = join(harness.tempDir, "workers");
	for (const directory of ["src", "oracle", ".ai"]) mkdirSync(join(cwd, directory), { recursive: true });
	mkdirSync(agentDir);
	writeFileSync(join(cwd, "src/app.ts"), 'export const formatLabel = "original";\n');
	writeFileSync(join(cwd, "oracle/check.mjs"), oracle);
	writeFileSync(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n.ai/check-count\n");
});
afterEach(() => harness.cleanup());

describe("V0.5C real SDK bounded verification repair", () => {
	it("repairs once with fresh sessions, context and receipts, retaining failed evidence and independent review", async () => {
		const { report, requests, rejectedOldReceipt, task } = await run({ oldReceipt: true });
		expect(report.run?.status, report.error).toBe("COMPLETED");
		const state = report.run!;
		expect(rejectedOldReceipt).toBe(true);
		expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe('export const formatLabel = "fixed";\n');
		expect(requests.map((request) => [request.role, request.revision])).toEqual([
			["Developer", 0],
			["Developer", 1],
			["Reviewer", 1],
		]);
		expect(state.roleSessionRefs.map((session) => session.role)).toEqual(["Developer", "Developer", "Reviewer"]);
		expect(new Set(state.roleSessionRefs.map((session) => session.sessionId)).size).toBe(3);
		expect(new Set(state.roleSessionRefs.map((session) => session.sessionFile)).size).toBe(3);
		expect(state.taskContractDigest).toBe(taskContractDigest(task));
		expect(state.budget).toMatchObject({ workerInvocations: 3, exceeded: false });
		expect(state.budget?.reportedTokens).toBe(
			state.workerMeasurements!.reduce((sum, measurement) => sum + measurement.usage.totalTokens, 0),
		);
		expect(state.budget?.reportedTokens).toBeGreaterThan(state.workerMeasurements![0].usage.totalTokens);
		expect(state.workerMeasurements?.map((measurement) => [measurement.role, measurement.revision])).toEqual([
			["Developer", 0],
			["Developer", 1],
			["Reviewer", 1],
		]);
		expect(
			state.verification.map((check) => [check.step?.stepId, check.step?.attempt, check.status, check.exitCode]),
		).toEqual([
			["self-check", 1, "FAIL", 7],
			["self-check", 2, "PASS", 0],
			["test", 2, "PASS", 0],
		]);
		expect(new Set(state.verification.map((check) => check.trust?.registrationDigest)).size).toBe(1);
		const graph = projectRunGraph(state);
		expect(graph.nodes.find((node) => node.id === "self-check:1")?.status).toBe("failed");
		expect(graph.nodes.some((node) => node.id === "review:1")).toBe(false);
		expect(graph.edges).toContainEqual({ from: "self-check:1", to: "implement:2", kind: "next_attempt" });
		expect(graph.nodes.find((node) => node.id === "complete:2")?.status).toBe("passed");
		const pack = projectEvidencePack({ run: state, report });
		expect(pack.checks.map((check) => [check.revision, check.attempt, check.status])).toEqual([
			[0, 1, "FAIL"],
			[1, 2, "PASS"],
			[1, 2, "PASS"],
		]);
		expect(pack.verificationRepair?.attempts[0].diffDigest).toBe(state.verification[0].diffDigest);
		expect(pack.failure).toBeNull();
	});
	it("rebuilds Reviewer impact/docs after repair and persists no raw documentation", async () => {
		const { report, requests, task } = await run({ reviewerContext: "both" });
		expect(report.run?.status, report.error).toBe("COMPLETED");
		expect(requests.slice(0, 2).map((request) => request.reviewerContext)).toEqual([undefined, undefined]);
		const reviewer = requests[2],
			context = reviewer.reviewerContext!;
		expect(context.revision).toBe(1);
		expect(context.taskContractDigest).toBe(taskContractDigest(task));
		expect(context.impact?.diffDigest).toBe(report.run!.verification[1].diffDigest);
		expect(context.impact?.diffDigest).not.toBe(report.run!.verification[0].diffDigest);
		expect(context.impact?.changedSymbols.map((symbol) => [symbol.name, symbol.sourceDigest])).toEqual([
			["formatLabel", fileDigest('export const formatLabel = "fixed";\n')],
		]);
		expect(context.impact?.declarations.map((location) => location.path)).toEqual(["src/app.ts"]);
		expect(context.documentation?.entries[0].status).toBe("MATCHED");
		expect(context.documentation?.entries[0].content).toContain("DOC_PRIVATE_SENTINEL");
		expect(context.taskContextDigest).toBe(reviewer.taskContextPack!.digest);
		expect(context.taskContextDigest).not.toBe(requests[1].taskContextPack!.digest);
		const evidence = projectEvidencePack({ run: report.run!, report });
		expect(evidence.workers[2].reviewerContext?.digest).toBe(context.digest);
		expect(evidence.workers[2].reviewerContext?.documentation?.matchedCount).toBe(1);
		for (const value of [JSON.stringify(evidence), readFileSync(join(cwd, ".ai/state.json"), "utf8")]) {
			expect(value).not.toContain("DOC_PRIVATE_SENTINEL");
			expect(value).not.toContain("local:label-1.2.3");
		}
	});
	it.each([
		"stale-revision",
		"nested-version",
		"nested-digest",
		"unknown-field",
		"stale-content",
		"altered-content",
		"version-mismatch",
	] as const)(
		"rejects correctly outer-hashed %s Reviewer data before opening a Reviewer session or Provider call",
		async (mutation) => {
			const { report, requests } = await run({
				reviewerContext: "both",
				tamperReviewer(context) {
					const pack = context.documentation!,
						item = pack.entries[0];
					if (mutation === "stale-revision") context.revision--;
					else if (mutation === "nested-version") Object.assign(pack, { version: 2 });
					else if (mutation === "unknown-field") Object.assign(item, { command: "PRIVATE_SENTINEL" });
					else if (mutation === "stale-content") {
						item.status = "STALE";
						pack.stale = [item.entry.id];
						pack.unmatched = [item.entry.component];
					} else if (mutation === "altered-content") item.content = "UNREVIEWED_PRIVATE_SENTINEL";
					else if (mutation === "version-mismatch") item.declaredVersion = "2.0.0";
					const { digest: _digest, ...body } = pack;
					pack.digest =
						mutation === "nested-digest"
							? fileDigest("wrong")
							: fileDigest(JSON.stringify(["weavra-documentation-pack-v1", body]));
				},
			});
			expect(report.run?.status).toBe("FAILED");
			expect(requests.map((request) => request.role)).toEqual(["Developer", "Developer"]);
			expect(report.run?.roleSessionRefs.map((ref) => ref.role)).toEqual(["Developer", "Developer"]);
			expect(report.run?.review).toBeUndefined();
		},
	);
	it.each(["impact", "documentation"] as const)(
		"keeps Kernel completion blocked on actual TEST failure with %s context",
		async (reviewerContext) => {
			const { report, requests } = await run({ reviewerContext, testFails: true });
			expect(requests.at(-1)?.reviewerContext).toBeDefined();
			expect(report.run?.review?.result).toBe("PASS");
			expect(report.run?.verification.at(-1)).toMatchObject({
				status: "FAIL",
				exitCode: 7,
				step: { stepId: "test" },
			});
			expect(report.run?.status).toBe("BLOCKED");
			if (reviewerContext === "documentation")
				expect(requests.at(-1)?.reviewerContext?.documentation?.entries[0].status).toBe("MATCHED");
		},
	);
	it.runIf(process.platform === "darwin")(
		"keeps required OS sandbox enforcement for the failed and fresh attempts",
		async () => {
			const { report } = await run({ sandbox: true });
			expect(report.run?.status, report.error).toBe("COMPLETED");
			expect(report.run!.verification.map((check) => check.sandbox?.status)).toEqual([
				"ENFORCED",
				"ENFORCED",
				"ENFORCED",
			]);
			expect(new Set(report.run!.verification.map((check) => check.sandbox?.policyDigest)).size).toBe(1);
		},
	);
	it("does not turn an opt-out verification failure into a second worker", async () => {
		const { report, requests } = await run({ mode: "disabled" });
		expect(report.run?.status).toBe("BLOCKED");
		expect(requests.map((request) => request.revision)).toEqual([0]);
		expect(report.run?.verificationRepair?.attempts).toEqual([]);
	});
	it("retains both failures and stops before Reviewer when the single repair also fails", async () => {
		const { report, requests } = await run({ stillBroken: true });
		expect(report.run?.status).toBe("BLOCKED");
		expect(requests.map((request) => [request.role, request.revision])).toEqual([
			["Developer", 0],
			["Developer", 1],
		]);
		expect(report.run?.verification.map((check) => [check.revision, check.status])).toEqual([
			[0, "FAIL"],
			[1, "FAIL"],
		]);
		expect(report.run?.verificationRepair?.attempts).toHaveLength(1);
		expect(report.run?.review).toBeUndefined();
	});
	it("does not reset the invocation budget when scheduling a repair", async () => {
		const { report, requests } = await run({ budget: 1 });
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.run?.budget).toMatchObject({ workerInvocations: 1, exceeded: true });
		expect(requests.map((request) => request.revision)).toEqual([0]);
		expect(projectEvidencePack({ run: report.run!, report }).failure?.category).toBe("BUDGET");
	});
	it("charges the failed worker's reported tokens before admitting the repair worker", async () => {
		const { report, requests } = await run({ tokens: 12 });
		expect(report.run?.status).toBe("BLOCKED");
		expect(report.run?.budget).toMatchObject({ workerInvocations: 1, exceeded: true });
		expect(report.run?.budget?.reportedTokens).toBe(report.run?.workerMeasurements?.[0].usage.totalTokens);
		expect(report.run?.budget?.reportedTokens).toBeGreaterThanOrEqual(12);
		expect(requests.map((request) => request.revision)).toEqual([0]);
		expect(projectEvidencePack({ run: report.run!, report }).failure?.category).toBe("BUDGET");
	});
});
