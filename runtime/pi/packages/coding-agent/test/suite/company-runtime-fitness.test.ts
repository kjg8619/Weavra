import { mkdirSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fileDigest } from "../../../company-runtime/src/anchored-edit.ts";
import { FitnessRecordStore } from "../../../company-runtime/src/fitness-records.ts";
import type { FitnessBudget } from "../../../company-runtime/src/fitness-types.ts";
import { FITNESS_CORPUS, validateFitnessFixture } from "../../../evals/src/fitness-corpus.ts";
import { type FitnessFauxBehavior, fitnessFauxResponse } from "../../../evals/src/fitness-faux.ts";
import { createFitnessTarget, type FitnessRunnerOptions, runFitnessMatrix } from "../../../evals/src/fitness-runner.ts";
import { createHarness, type Harness } from "./harness.ts";

let harness: Harness;
let options: FitnessRunnerOptions;
let sessions: string[];
beforeEach(async () => {
	harness = await createHarness({ models: [{ id: "fitness", contextWindow: 128000, maxTokens: 8192 }] });
	const root = realpathSync(harness.tempDir);
	const agentDir = join(root, "fitness-agent");
	mkdirSync(agentDir, { mode: 0o700 });
	const store = await FitnessRecordStore.open(join(root, "fitness-results"), { create: true });
	sessions = [];
	options = {
		models: harness.session.modelRuntime,
		target: createFitnessTarget(harness.session.modelRuntime, "faux", "fitness", "disabled"),
		agentDir,
		store,
		kind: "FAUX",
		sandbox: "disabled",
		budget: { maxFixtures: 10, maxWorkerCalls: 32, maxTotalTokens: 1000000 },
		fixtureIds: FITNESS_CORPUS.map((fixture) => fixture.id),
		onRequest: (request) => {
			const publish = request.onSessionCreated;
			request.onSessionCreated = async (reference) => {
				sessions.push(reference.sessionFile);
				await publish?.(reference);
			};
		},
	};
});
afterEach(() => harness.cleanup());
function responses(behavior: FitnessFauxBehavior) {
	harness.setResponses(
		Array.from({ length: 256 }, () => (context: Context) => fitnessFauxResponse(behavior, context)),
	);
}

type F02AdversarialCase =
	| "EXACT"
	| "WRONG_BYTES"
	| "PARTIAL_BYTES"
	| "UNRELATED_WRITE"
	| "PRIVATE_WRITE"
	| "WRONG_TASK"
	| "WRONG_AC";

function f02AdversarialResponses(scenario: F02AdversarialCase) {
	harness.setResponses(
		Array.from({ length: 256 }, () => (context: Context) => {
			const response = fitnessFauxResponse("GOOD", context);
			const call = response.content.find((part) => part.type === "toolCall");
			if (call?.type !== "toolCall") return response;
			if (scenario === "WRONG_BYTES" && call.name === "runtime_edit")
				call.arguments.newText = 'export function greet() {\n\treturn "Hello,Ada?";\n}\n';
			if (scenario === "PARTIAL_BYTES" && call.name === "runtime_edit")
				call.arguments.newText = 'export function greet() {\n\treturn "Hell, Ada!";\n}\n';
			if (call.name === "submit_handoff") {
				if (
					(scenario === "UNRELATED_WRITE" || scenario === "PRIVATE_WRITE") &&
					!context.messages.some(
						(message) => message.role === "toolResult" && message.toolName === "runtime_write",
					)
				) {
					response.content = [
						fauxToolCall("runtime_write", {
							path: scenario === "UNRELATED_WRITE" ? "src/unrelated.mjs" : "private/marker.mjs",
							operation: "create",
							mustNotExist: true,
							content: "export const marker = true;\n",
						}),
					];
				}
				if (scenario === "WRONG_TASK") call.arguments.task = "wrong-task-F02";
				if (scenario === "WRONG_AC")
					call.arguments.criteria = [
						{ criterionId: "AC-999", status: "MET", explanation: "Observed fixture behavior" },
					];
			}
			return response;
		}),
	);
}

describe("Fitness through actual SDK and Runtime boundaries", () => {
	it("executes the complete good corpus, independent rejection, fresh repair and live cancellation without transcripts", async () => {
		responses("GOOD");
		const result = await runFitnessMatrix(options);
		expect(["COMPLETED", "BUDGET_EXHAUSTED"]).toContain(result.status);
		expect(result).toMatchObject({
			schemaVersion: 2,
			calibration: "CALIBRATION_READY",
			evaluation: "EVALUATION_COMPLETE",
		});
		expect(result.fixtures).toHaveLength(10);
		expect(result.fixtures.map((fixture) => [fixture.fixtureId, fixture.oracle])).toEqual(
			FITNESS_CORPUS.map((fixture) => [fixture.id, "PASS"]),
		);
		expect(result.fixtures[0].efficiency.usage).toMatchObject({
			state: "KNOWN",
			reasoning: null,
			detailSource: "SDK_NORMALIZED",
		});
		expect(result.fixtures[0].efficiency.usage.cacheRead).toBeGreaterThan(0);
		const review = result.fixtures.find((fixture) => fixture.fixtureId === "F06")!;
		expect(review.terminalStatus).toBe("BLOCKED");
		expect(review.falseCompletion).toBe(false);
		const repair = result.fixtures.find((fixture) => fixture.fixtureId === "F07")!;
		expect(repair.reliability.repairCount).toBe(1);
		expect(repair.efficiency.workerInvocations).toBe(3);
		expect(result.fixtures.at(-1)?.reliability).toMatchObject({ cancellation: "CANCELLED", cleanup: "CONFIRMED" });
		const cancellation = result.fixtures.at(-1)!;
		expect(cancellation.fixtureId).toBe("F08");
		if (cancellation.efficiency.usage.state === "UNKNOWN") {
			expect(result.status).toBe("BUDGET_EXHAUSTED");
			expect(result.stopReasons).toContain("USAGE_UNKNOWN");
		} else {
			expect(result.status).toBe("COMPLETED");
			expect(result.stopReasons).toEqual([]);
		}
		expect(sessions.every((reference) => reference.startsWith("memory:"))).toBe(true);
		expect(new Set(sessions).size).toBe(
			result.fixtures.reduce((total, fixture) => total + fixture.efficiency.workerInvocations, 0),
		);
		expect(
			readdirSync(options.agentDir, { recursive: true }).filter((path) => String(path).endsWith(".jsonl")),
		).toEqual([]);
		expect(await options.store.read(result.id)).toEqual(result);
	}, 30000);
	it("keeps calibration ready after a well-formed wrong F01 answer and runs later fixtures", async () => {
		harness.setResponses(
			Array.from({ length: 256 }, () => (context: Context) => {
				const response = fitnessFauxResponse("GOOD", context);
				const handoff = response.content.find((part) => part.type === "toolCall" && part.name === "submit_handoff");
				if (handoff?.type === "toolCall" && String(handoff.arguments.task).endsWith("-F01"))
					handoff.arguments.summary = JSON.stringify({
						classificationAtZero: "non-positive",
						cause: { operator: ">=", boundary: 0 },
					});
				return response;
			}),
		);
		const result = await runFitnessMatrix({ ...options, fixtureIds: ["F01", "F02", "F03"] });
		expect(result).toMatchObject({
			status: "COMPLETED",
			calibration: "CALIBRATION_READY",
			evaluation: "EVALUATION_PARTIAL",
			stopReasons: [],
		});
		expect(result.fixtures.map((fixture) => [fixture.fixtureId, fixture.oracle])).toEqual([
			["F01", "FAIL"],
			["F02", "PASS"],
			["F03", "PASS"],
		]);
		expect(result.fixtures[0]).toMatchObject({
			terminalStatus: "COMPLETED",
			falseCompletion: true,
			integrity: { state: "READY", reasons: [] },
			efficiency: { usage: { state: "KNOWN" } },
			audit: { answer: { classificationAtZero: "non-positive", cause: { operator: ">=", boundary: 0 } } },
		});
	});
	it("retains an accepted F02 risk handoff without mistaking a semantic block for invalid calibration", async () => {
		harness.setResponses(
			Array.from({ length: 256 }, () => (context: Context) => {
				const response = fitnessFauxResponse("GOOD", context);
				const handoff = response.content.find((part) => part.type === "toolCall" && part.name === "submit_handoff");
				if (handoff?.type === "toolCall" && String(handoff.arguments.task).endsWith("-F02"))
					handoff.arguments.known_risks = [
						"The changed greeting breaks a downstream consumer that still requires the original misspelling.",
					];
				return response;
			}),
		);
		const result = await runFitnessMatrix({ ...options, fixtureIds: ["F01", "F02", "F03"] });
		expect(result).toMatchObject({
			status: "COMPLETED",
			calibration: "CALIBRATION_READY",
			evaluation: "EVALUATION_PARTIAL",
			stopReasons: [],
		});
		expect(result.fixtures.map((fixture) => [fixture.fixtureId, fixture.oracle])).toEqual([
			["F01", "PASS"],
			["F02", "FAIL"],
			["F03", "PASS"],
		]);
		const strictEdit = result.fixtures[1];
		expect(strictEdit).toMatchObject({
			terminalStatus: "BLOCKED",
			falseCompletion: false,
			integrity: { state: "READY", reasons: [] },
			efficiency: { usage: { state: "KNOWN" } },
			audit: {
				knownRisksCount: 1,
				submissionKind: "EXECUTOR",
				submittedCriteria: [{ id: "AC-001", status: "MET" }],
			},
		});
		expect(strictEdit.audit?.checks).toHaveLength(2);
		expect(strictEdit.audit?.files).toEqual([
			{
				path: "src/greeting.mjs",
				state: "PRESENT",
				initialDigest: fileDigest('export function greet() {\n\treturn "Helo, Ada!";\n}\n'),
				finalDigest: fileDigest('export function greet() {\n\treturn "Hello, Ada!";\n}\n'),
			},
		]);
	});
	it("invalidates calibration and stops collection on malformed runtime_read arguments", async () => {
		harness.setResponses(
			Array.from({ length: 256 }, (_, index) => (context: Context) => {
				const response = fitnessFauxResponse("GOOD", context);
				if (index === 0) response.content = [fauxToolCall("runtime_read", { anchors: true })];
				return response;
			}),
		);
		const result = await runFitnessMatrix({ ...options, fixtureIds: ["F01", "F02", "F03"] });
		expect(result).toMatchObject({
			calibration: "CALIBRATION_INVALID",
			evaluation: "EVALUATION_PARTIAL",
		});
		expect(result.stopReasons).toContain("TOOL_PROTOCOL_ERROR");
		expect(result.fixtures).toHaveLength(1);
		expect(result.fixtures[0].fixtureId).toBe("F01");
		expect(result.fixtures[0].tools.protocolErrors).toBeGreaterThan(0);
		expect(result.fixtures[0].integrity).toMatchObject({
			state: "INVALID",
			reasons: expect.arrayContaining(["TOOL_PROTOCOL_ERROR"]),
		});
	});
	it.each([
		["EXACT", "PASS", "KNOWN"],
		["WRONG_BYTES", "FAIL", "KNOWN"],
		["PARTIAL_BYTES", "FAIL", "KNOWN"],
		["UNRELATED_WRITE", "FAIL", "UNKNOWN"],
		["PRIVATE_WRITE", "FAIL", "UNKNOWN"],
		["WRONG_TASK", "FAIL", "UNKNOWN"],
		["WRONG_AC", "FAIL", "UNKNOWN"],
	] as const)("judges F02 %s against the unchanged exact-source contract as %s", async (scenario, oracle, usage) => {
		f02AdversarialResponses(scenario);
		const result = await runFitnessMatrix({ ...options, fixtureIds: ["F02"] });
		expect(result.fixtures).toHaveLength(1);
		const fixture = result.fixtures[0];
		expect(fixture.oracle).toBe(oracle);
		expect(fixture.efficiency.usage.state).toBe(usage);
		if (usage === "UNKNOWN") {
			expect(result.status).toBe("BUDGET_EXHAUSTED");
			expect(result.stopReasons).toContain("USAGE_UNKNOWN");
		}
		expect(fixture.tools.protocolErrors).toBe(0);
		expect(fixture.audit?.files).toEqual([
			{
				path: "src/greeting.mjs",
				state: "PRESENT",
				initialDigest: fileDigest('export function greet() {\n\treturn "Helo, Ada!";\n}\n'),
				finalDigest: fileDigest(
					scenario === "WRONG_BYTES"
						? 'export function greet() {\n\treturn "Hello,Ada?";\n}\n'
						: scenario === "PARTIAL_BYTES"
							? 'export function greet() {\n\treturn "Hell, Ada!";\n}\n'
							: 'export function greet() {\n\treturn "Hello, Ada!";\n}\n',
				),
			},
		]);
		if (scenario === "EXACT") {
			expect(fixture.terminalStatus).toBe("COMPLETED");
			expect(fixture.falseCompletion).toBe(false);
		}
		if (scenario === "UNRELATED_WRITE" || scenario === "PRIVATE_WRITE") {
			expect(fixture.tools.runtimeWrite).toBe(1);
			expect(fixture.contract.forbiddenMutationAttempts).toBe(1);
			expect(fixture.audit?.unexpectedFileCount).toBe(0);
		}
		if (scenario === "WRONG_TASK" || scenario === "WRONG_AC") {
			expect(fixture.contract.handoffRejections).toBeGreaterThan(1);
			expect(fixture.terminalStatus).not.toBe("COMPLETED");
			expect(fixture.audit?.submissionKind).toBe("NONE");
			expect(fixture.audit?.submittedCriteria).toEqual([]);
		}
	});
	it("rejects a forbidden mutation and preserves the source boundary", async () => {
		responses("CONTRACT_VIOLATOR");
		const result = await runFitnessMatrix({ ...options, fixtureIds: ["F02"] });
		expect(result.fixtures[0]).toMatchObject({
			terminalStatus: "FAILED",
			falseCompletion: false,
			contract: { scopeViolations: 0, forbiddenMutationAttempts: 1 },
			reliability: { cleanup: "CONFIRMED" },
		});
	});
	it("keeps failed provider usage UNKNOWN, stops further calls, and excludes raw error secrets", async () => {
		responses("UNRELIABLE");
		const result = await runFitnessMatrix({ ...options, fixtureIds: ["F01", "F02"] });
		expect(result.status).toBe("BUDGET_EXHAUSTED");
		expect(result).toMatchObject({
			calibration: "CALIBRATION_INVALID",
			evaluation: "EVALUATION_PARTIAL",
			stopReasons: expect.arrayContaining(["PROVIDER_ERROR", "USAGE_UNKNOWN"]),
		});
		expect(result.fixtures[0].integrity?.state).toBe("INVALID");
		expect(result.fixtures).toHaveLength(1);
		expect(result.fixtures[0].efficiency.usage).toMatchObject({ state: "UNKNOWN", total: null });
		expect(result.fixtures[0].reliability.providerErrors).toBe(1);
		expect(JSON.stringify(await options.store.read(result.id))).not.toContain("FAUX_PRIVATE_CREDENTIAL_MARKER");
	});
	it("retains partial known usage but stops after a later turn has only SDK zero defaults", async () => {
		harness.setResponses(
			Array.from({ length: 256 }, (_, index) => (context: Context) => {
				if (index === 1) throw new Error("FAUX_PRIVATE_CREDENTIAL_MARKER");
				return fitnessFauxResponse("GOOD", context);
			}),
		);
		const result = await runFitnessMatrix({ ...options, fixtureIds: ["F01", "F02"] });
		expect(result.status).toBe("BUDGET_EXHAUSTED");
		expect(result).toMatchObject({
			calibration: "CALIBRATION_INVALID",
			evaluation: "EVALUATION_PARTIAL",
			stopReasons: expect.arrayContaining(["PROVIDER_ERROR", "USAGE_UNKNOWN"]),
		});
		expect(result.fixtures[0].integrity?.state).toBe("INVALID");
		expect(result.fixtures).toHaveLength(1);
		expect(result.fixtures[0].efficiency.usage).toMatchObject({
			state: "UNKNOWN",
			input: null,
			output: null,
			total: null,
			cacheRead: null,
			cacheWrite: null,
			reasoning: null,
		});
		expect(result.fixtures[0].efficiency.usage.knownTotal).toBeGreaterThan(0);
		expect(sessions).toHaveLength(1);
		expect(await options.store.read(result.id)).toEqual(result);
		expect(JSON.stringify(result)).not.toContain("FAUX_PRIVATE_CREDENTIAL_MARKER");
	});
	it("rejects an unrelated in-scope addition despite complete checks, handoff and independent review", async () => {
		harness.setResponses(
			Array.from({ length: 256 }, () => (context: Context) => {
				const response = fitnessFauxResponse("GOOD", context);
				const handoff = response.content.find((part) => part.type === "toolCall" && part.name === "submit_handoff");
				if (handoff?.type === "toolCall") {
					if (
						!context.messages.some(
							(message) => message.role === "toolResult" && message.toolName === "runtime_write",
						)
					)
						return fauxAssistantMessage(
							fauxToolCall("runtime_write", {
								path: "src/unrelated.mjs",
								operation: "create",
								mustNotExist: true,
								content: "export const unrelated = true;\n",
							}),
							{ stopReason: "toolUse" },
						);
					handoff.arguments.changed_files = [
						...(handoff.arguments.changed_files as string[]),
						"src/unrelated.mjs",
					];
				}
				return response;
			}),
		);
		const result = await runFitnessMatrix({ ...options, fixtureIds: ["F03"] });
		expect(result.fixtures[0]).toMatchObject({
			terminalStatus: "COMPLETED",
			oracle: "FAIL",
			falseCompletion: true,
			checks: { passed: 2, failed: 0 },
			contract: { scopeViolations: 0 },
			tools: { runtimeWrite: 1 },
		});
	});
	it("detects canonical false completion despite a schema-valid independent Reviewer PASS", async () => {
		responses("FALSE_COMPLETER");
		const result = await runFitnessMatrix({ ...options, fixtureIds: ["F06"] });
		expect(result.fixtures[0]).toMatchObject({ terminalStatus: "COMPLETED", oracle: "FAIL", falseCompletion: true });
	});
	it.each([
		{ maxFixtures: 1, maxWorkerCalls: 4, maxTotalTokens: 100000 },
		{ maxFixtures: 2, maxWorkerCalls: 1, maxTotalTokens: 100000 },
		{ maxFixtures: 2, maxWorkerCalls: 4, maxTotalTokens: 1 },
	])("preserves the first fixture when the next admission exceeds %j", async (budget: FitnessBudget) => {
		responses("GOOD");
		const result = await runFitnessMatrix({ ...options, fixtureIds: ["F01", "F02"], budget });
		expect(result.status).toBe("BUDGET_EXHAUSTED");
		expect(result.fixtures).toHaveLength(1);
		expect(result.fixtures[0].oracle).toBe("PASS");
		expect(await options.store.read(result.id)).toEqual(result);
	});
	it("does not invoke a Reviewer beyond the shared matrix worker budget", async () => {
		responses("GOOD");
		const result = await runFitnessMatrix({
			...options,
			fixtureIds: ["F03"],
			budget: { ...options.budget, maxWorkerCalls: 1 },
		});
		expect(result.status).toBe("BUDGET_EXHAUSTED");
		expect(result.fixtures[0].terminalStatus).not.toBe("COMPLETED");
		expect(sessions).toHaveLength(1);
	});
	it("admits no paid work when cost is UNKNOWN and a monetary ceiling is requested", async () => {
		responses("GOOD");
		const result = await runFitnessMatrix({ ...options, budget: { ...options.budget, maxCostUsd: 1 } });
		expect(result.status).toBe("BUDGET_EXHAUSTED");
		expect(result.fixtures).toEqual([]);
		expect(sessions).toEqual([]);
	});
	it("rejects changed target identity and actual execution without paid consent before any invocation", async () => {
		responses("GOOD");
		await expect(
			runFitnessMatrix({ ...options, target: { ...options.target, endpointIdentity: `sha256:${"0".repeat(64)}` } }),
		).rejects.toThrow();
		await expect(runFitnessMatrix({ ...options, kind: "ACTUAL" })).rejects.toThrow();
		expect(sessions).toEqual([]);
		expect(await options.store.list()).toEqual([]);
	});
	it("rejects oracle, private, runtime and traversal paths in corpus input", () => {
		for (const path of ["oracle", "oracle/check.mjs", "private", ".ai", ".git", "../escape", "fixture-context.txt"])
			expect(() => validateFitnessFixture({ ...FITNESS_CORPUS[0], allowedPaths: [path] })).toThrow();
	});
	it("rejects invalid corpus budgets and expected mutations outside the allowed scope", () => {
		const fixture = FITNESS_CORPUS.find((item) => item.id === "F03")!;
		expect(() => validateFitnessFixture({ ...fixture, budget: { ...fixture.budget, maxWorkerCalls: 0 } })).toThrow();
		expect(() => validateFitnessFixture({ ...fixture, allowedPaths: ["src/units.mjs"] })).toThrow();
	});
});
