import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	compareFitnessRuns,
	FitnessRecordStore,
	fitnessCalibrationState,
	fitnessDigest,
	fitnessEvaluationState,
	fitnessIntegrityReasons,
	freezeFitnessRecord,
	passesFitnessCalibrationFixture,
	safeEndpointIdentity,
	summarizeFitnessRun,
	validateFitnessRecord,
} from "../src/fitness-records.ts";
import type { FitnessFixtureResult, ProviderFitnessRun } from "../src/fitness-types.ts";

let directory: string;
beforeEach(async () => {
	directory = await realpath(await mkdtemp(join(tmpdir(), "fitness-records-")));
});
afterEach(async () => {
	await rm(directory, { recursive: true, force: true });
});
const digest = fitnessDigest("fixture");
function fixture(): FitnessFixtureResult {
	return {
		fixtureId: "F01",
		fixtureDigest: digest,
		runId: randomUUID(),
		taskContractDigest: digest,
		registeredCheckDigest: digest,
		configurationDigest: digest,
		terminalStatus: "COMPLETED",
		oracle: "PASS",
		falseCompletion: false,
		integrity: { state: "READY", reasons: [] },
		audit: {
			files: [],
			unexpectedFileCount: 0,
			unexpectedFilesDigest: null,
			workspaceDiffDigest: null,
			protectedUnchanged: null,
			taskContractMatches: null,
			submissionKind: "NONE",
			submissionDigest: null,
			summaryDigest: null,
			submittedCriteria: [],
			unknownCriterionCount: 0,
			acceptance: [],
			reviewer: null,
			knownRisksCount: null,
			unresolvedCount: null,
			changedFilesMatch: null,
			phase: null,
			answer: null,
			checks: [],
			harnessError: false,
		},
		latencyMs: 12,
		ac: { met: 1, notMet: 0 },
		checks: { passed: 2, failed: 0, notRun: 0 },
		contract: {
			scopeViolations: 0,
			forbiddenMutationAttempts: 0,
			taskContractAdherence: true,
			strictReceiptRejections: 0,
			handoffRejections: 0,
			reviewRejections: 0,
		},
		tools: {
			calls: 2,
			invalidCalls: 0,
			protocolErrors: 0,
			retries: 0,
			runtimeRead: 1,
			runtimeEdit: 0,
			runtimeWrite: 0,
			lsp: 0,
		},
		reliability: {
			providerErrors: 0,
			authErrors: 0,
			transportErrors: 0,
			timeouts: 0,
			cancellation: "NOT_REQUESTED",
			repairCount: 0,
			reviewerRevisionCount: 0,
			cleanup: "CONFIRMED",
		},
		efficiency: {
			usage: { state: "KNOWN", input: 7, output: 3, total: 10, knownTotal: 10 },
			workerInvocations: 1,
			modelTurns: 2,
			httpAttempts: null,
			contextBytes: 64,
			costUsd: null,
		},
		evidenceDigest: digest,
	};
}
function historicalRecord(overrides: Partial<ProviderFitnessRun> = {}): ProviderFitnessRun {
	return freezeFitnessRecord({
		schemaVersion: 1,
		id: randomUUID(),
		corpusRevision: "corpus-1",
		corpusDigest: digest,
		target: {
			provider: "test",
			model: "model",
			api: "test",
			endpointIdentity: digest,
			harnessRevision: "a".repeat(40),
			toolSchemaRevision: digest,
			promptRuntimeRevision: digest,
			configurationDigest: digest,
		},
		kind: "FAUX",
		startedAt: 1,
		completedAt: null,
		status: "RUNNING",
		budget: { maxFixtures: 2, maxWorkerCalls: 4, maxTotalTokens: 1000 },
		plannedFixtures: ["F01", "F02"],
		fixtures: [],
		environment: { platform: "test", arch: "test", node: "v1" },
		...overrides,
	});
}

function record(overrides: Partial<ProviderFitnessRun> = {}): ProviderFitnessRun {
	const fixtures = (overrides.fixtures ?? []).map((result) => {
		const reasons = fitnessIntegrityReasons(result);
		return { ...result, integrity: { state: reasons.length ? ("INVALID" as const) : ("READY" as const), reasons } };
	});
	const run = { ...historicalRecord(), ...overrides, schemaVersion: 2 as const, fixtures };
	return freezeFitnessRecord({
		...run,
		calibration: fitnessCalibrationState(fixtures),
		evaluation: fitnessEvaluationState(run),
		stopReasons: [...new Set(fixtures.flatMap(fitnessIntegrityReasons))],
	});
}

describe("Fitness calibration admission", () => {
	it("admits semantic and contract failures when the observations have integrity", () => {
		const good = fixture();
		const outcomes: FitnessFixtureResult[] = [
			{ ...good, oracle: "FAIL", falseCompletion: true },
			{ ...good, terminalStatus: "BLOCKED" },
			{ ...good, terminalStatus: "FAILED" },
			{
				...good,
				contract: {
					...good.contract,
					taskContractAdherence: false,
					scopeViolations: 1,
					forbiddenMutationAttempts: 1,
				},
			},
			{ ...good, checks: { passed: 0, failed: 1, notRun: 1 }, ac: { met: 0, notMet: 1 } },
			{
				...good,
				audit: {
					...good.audit!,
					acceptance: [{ id: "AC-001", status: "UNMET" }],
					checks: [{ id: "check", status: "FAIL", stage: null, diffDigest: null, registrationDigest: null }],
				},
			},
		];
		for (const result of outcomes) {
			expect(fitnessIntegrityReasons(result)).toEqual([]);
			expect(passesFitnessCalibrationFixture(result)).toBe(true);
			expect(fitnessCalibrationState([result, { ...result, fixtureId: "F02" }])).toBe("CALIBRATION_READY");
		}
	});
	it("classifies each explicit integrity stop without duplicate reasons", () => {
		const good = fixture();
		const cases: Array<[FitnessFixtureResult, string]> = [
			[{ ...good, reliability: { ...good.reliability, authErrors: 1 } }, "AUTH_ERROR"],
			[{ ...good, reliability: { ...good.reliability, providerErrors: 1 } }, "PROVIDER_ERROR"],
			[{ ...good, reliability: { ...good.reliability, transportErrors: 1 } }, "TRANSPORT_ERROR"],
			[{ ...good, tools: { ...good.tools, protocolErrors: 1 } }, "TOOL_PROTOCOL_ERROR"],
			[{ ...good, tools: { ...good.tools, protocolErrors: undefined } }, "MEASUREMENT_INVALID"],
			[{ ...good, audit: undefined }, "MEASUREMENT_INVALID"],
			[{ ...good, oracle: "INVALID", falseCompletion: null }, "ORACLE_INVALID"],
			[{ ...good, reliability: { ...good.reliability, cleanup: "UNCONFIRMED" } }, "CLEANUP_UNCONFIRMED"],
			[
				{
					...good,
					efficiency: {
						...good.efficiency,
						usage: { state: "UNKNOWN", input: null, output: null, total: null, knownTotal: 10 },
					},
				},
				"USAGE_UNKNOWN",
			],
			[{ ...good, reliability: { ...good.reliability, timeouts: 1 } }, "TIMEOUT"],
			[{ ...good, audit: { ...good.audit!, harnessError: true } }, "HARNESS_DEFECT"],
			[{ ...good, runId: null }, "HARNESS_DEFECT"],
			[{ ...good, terminalStatus: "NOT_STARTED" }, "HARNESS_DEFECT"],
		];
		for (const [result, reason] of cases) {
			expect(fitnessIntegrityReasons(result)).toEqual([reason]);
			expect(passesFitnessCalibrationFixture(result)).toBe(false);
			expect(fitnessCalibrationState([result])).toBe("CALIBRATION_INVALID");
		}
		const invalid = fixture();
		invalid.tools.protocolErrors = undefined;
		invalid.audit = undefined;
		invalid.runId = null;
		invalid.terminalStatus = "NOT_STARTED";
		invalid.efficiency.usage.total = null;
		expect(fitnessIntegrityReasons(invalid)).toEqual(["MEASUREMENT_INVALID", "HARNESS_DEFECT"]);
	});
	it("rejects unmeasured or invalid known usage rather than treating it as zero", () => {
		for (const value of [null, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
			const result = fixture();
			result.efficiency.usage.input = value;
			expect(fitnessIntegrityReasons(result)).toEqual(["MEASUREMENT_INVALID"]);
		}
		const mismatch = fixture();
		mismatch.efficiency.usage.knownTotal = 11;
		expect(fitnessIntegrityReasons(mismatch)).toEqual(["MEASUREMENT_INVALID"]);
	});
	it("requires the observed F01/F02 prefix for calibration readiness", () => {
		const first = fixture();
		const second = { ...fixture(), fixtureId: "F02" };
		expect(fitnessCalibrationState([])).toBe("PENDING");
		expect(fitnessCalibrationState([first])).toBe("PENDING");
		expect(fitnessCalibrationState([second])).toBe("PENDING");
		expect(fitnessCalibrationState([first, second])).toBe("CALIBRATION_READY");
		second.reliability.authErrors = 1;
		expect(fitnessCalibrationState([first, second])).toBe("CALIBRATION_INVALID");
	});
	it("refuses observed provider failures without fabricating an unobserved transport count", () => {
		const good = fixture();
		good.reliability.transportErrors = null;
		expect(passesFitnessCalibrationFixture(good)).toBe(true);
		for (const field of ["providerErrors", "authErrors", "transportErrors", "timeouts"] as const)
			expect(passesFitnessCalibrationFixture({ ...good, reliability: { ...good.reliability, [field]: 1 } })).toBe(
				false,
			);
		expect(good.reliability.transportErrors).toBeNull();
	});
});

describe("Fitness immutable records", () => {
	it("excludes endpoint userinfo/query/fragment from identity while distinguishing routes", () => {
		const safe = safeEndpointIdentity("https://example.test/v1");
		expect(safeEndpointIdentity("https://user:PRIVATE_KEY@example.test/v1?token=PRIVATE_KEY#PRIVATE_KEY")).toBe(safe);
		expect(safeEndpointIdentity("https://example.test/v2")).not.toBe(safe);
		expect(safe).not.toContain("PRIVATE_KEY");
		expect(() => safeEndpointIdentity("file:///secret")).toThrow();
	});
	it("canonicalizes object key order but binds exact fixture bytes", () => {
		expect(fitnessDigest({ a: 1, b: 2 })).toBe(fitnessDigest({ b: 2, a: 1 }));
		expect(fitnessDigest("line\n")).not.toBe(fitnessDigest("line\r\n"));
	});
	it("detects corrupted historical bodies and rejects future schema without migration", async () => {
		const store = await FitnessRecordStore.open(directory);
		const initial = record();
		await store.save(initial);
		const path = join(directory, `${initial.id}.json`);
		const bytes = await readFile(path);
		expect(await store.read(initial.id)).toEqual(initial);
		expect(await readFile(path)).toEqual(bytes);
		await writeFile(path, JSON.stringify({ ...initial, schemaVersion: 3 }), { mode: 0o600 });
		await expect(store.read(initial.id)).rejects.toThrow();
		expect(() => validateFitnessRecord({ ...initial, startedAt: 0 })).toThrow();
	});
	it("reads a frozen populated v1 record without rewriting its failed verdict or bytes", async () => {
		// This fixture predates corpus v2; do not regenerate it with current record helpers.
		const bytes = await readFile(new URL("./fixtures/fitness-v1.json", import.meta.url), "utf8");
		const historical = validateFitnessRecord(JSON.parse(bytes));
		const path = join(directory, `${historical.id}.json`);
		await writeFile(path, bytes, { mode: 0o600 });
		const store = await FitnessRecordStore.open(directory);
		const loaded = await store.read(historical.id);
		expect(loaded.corpusRevision).toBe("weavra-fitness-1");
		expect(loaded.status).toBe("CALIBRATION_FAILED");
		expect(compareFitnessRuns(loaded, loaded).left).toMatchObject({
			correctness: { executed: 1, oraclePass: 0, oracleFail: 1, falseCompletion: 1 },
			efficiency: { tokens: 6391, costUsd: null },
			reliability: { transportErrors: null },
		});
		expect(summarizeFitnessRun(loaded).fixtureResults[0].integrity).toBeNull();
		expect(await store.list()).toEqual([loaded]);
		expect(await readFile(path, "utf8")).toBe(bytes);
	});
	it("reads historical schema1 corpus-v2 records without adding readiness or migrating identity", async () => {
		const { audit: _audit, integrity: _integrity, tools, ...result } = fixture();
		const { protocolErrors: _protocolErrors, ...historicalTools } = tools;
		const historical = historicalRecord({
			corpusRevision: "weavra-fitness-2",
			fixtures: [{ ...result, tools: historicalTools }],
		});
		const bytes = `${JSON.stringify(historical)}\n`;
		const path = join(directory, `${historical.id}.json`);
		await writeFile(path, bytes, { mode: 0o600 });
		const store = await FitnessRecordStore.open(directory);
		const loaded = await store.read(historical.id);
		const summary = summarizeFitnessRun(loaded);
		expect(summary.fixtureResults[0].integrity).toBeNull();
		expect(loaded).toEqual(historical);
		expect(summary).not.toHaveProperty("calibration");
		expect(summary).not.toHaveProperty("evaluation");
		expect(summary).not.toHaveProperty("stopReasons");
		await expect(store.save(record({ ...loaded, fixtures: [fixture()] }))).rejects.toThrow();
		expect(await readFile(path, "utf8")).toBe(bytes);
	});
	it("recomputes v2 readiness and rejects omitted or forged integrity observations", () => {
		const initial = record({ fixtures: [fixture()] });
		for (const field of ["calibration", "evaluation", "stopReasons"] as const) {
			const omitted = structuredClone(initial);
			delete omitted[field];
			expect(() => freezeFitnessRecord(omitted)).toThrow();
		}
		for (const field of ["audit", "integrity"] as const) {
			const omitted = structuredClone(initial);
			delete omitted.fixtures[0][field];
			expect(() => freezeFitnessRecord(omitted)).toThrow();
		}
		const unobserved = structuredClone(initial);
		delete unobserved.fixtures[0].tools.protocolErrors;
		expect(() => freezeFitnessRecord(unobserved)).toThrow();
		expect(() => freezeFitnessRecord({ ...initial, calibration: "CALIBRATION_READY" })).toThrow();
		expect(() => freezeFitnessRecord({ ...initial, evaluation: "EVALUATION_COMPLETE" })).toThrow();
		expect(() => freezeFitnessRecord({ ...initial, stopReasons: ["AUTH_ERROR"] })).toThrow();
		const forged = structuredClone(initial);
		forged.fixtures[0].reliability.authErrors = 1;
		expect(() => freezeFitnessRecord(forged)).toThrow();
		forged.fixtures[0].integrity = { state: "INVALID", reasons: ["AUTH_ERROR"] };
		expect(() => freezeFitnessRecord(forged)).toThrow();
		const historical = historicalRecord();
		expect(() => freezeFitnessRecord({ ...historical, calibration: "PENDING" })).toThrow();
		expect(() => historicalRecord({ fixtures: [fixture()] })).toThrow();
	});
	it("retains unknown post-invocation identity only in schema2", () => {
		const observed = fixture();
		observed.runId = null;
		observed.terminalStatus = "UNKNOWN";
		observed.oracle = "INVALID";
		observed.falseCompletion = null;
		const current = record({ fixtures: [observed], status: "FAILED", completedAt: 2 });
		expect(current.fixtures[0].terminalStatus).toBe("UNKNOWN");
		expect(current.fixtures[0].integrity).toEqual({
			state: "INVALID",
			reasons: ["ORACLE_INVALID", "HARNESS_DEFECT"],
		});
		const { audit: _audit, integrity: _integrity, tools, ...result } = observed;
		const { protocolErrors: _protocolErrors, ...historicalTools } = tools;
		expect(() => historicalRecord({ fixtures: [{ ...result, tools: historicalTools }] })).toThrow();
		expect(() =>
			record({ fixtures: [{ ...observed, terminalStatus: "FAILED" }], status: "FAILED", completedAt: 2 }),
		).toThrow();
	});
	it("preserves canonical completion on invalid cleanup and limits unattached harness faults to stopped runs", () => {
		const observed = fixture();
		observed.oracle = "INVALID";
		observed.falseCompletion = null;
		observed.reliability.cleanup = "UNCONFIRMED";
		const invalid = record({ fixtures: [observed], status: "FAILED", completedAt: 2 });
		expect(invalid.fixtures[0].terminalStatus).toBe("COMPLETED");
		expect(invalid.stopReasons).toEqual(["ORACLE_INVALID", "CLEANUP_UNCONFIRMED"]);
		const running = record();
		expect(() => freezeFitnessRecord({ ...running, stopReasons: ["HARNESS_DEFECT"] })).toThrow();
		const interrupted = freezeFitnessRecord({
			...running,
			status: "INTERRUPTED",
			completedAt: 2,
			stopReasons: ["HARNESS_DEFECT"],
		});
		expect(interrupted.evaluation).toBe("EVALUATION_PARTIAL");
		expect(() => freezeFitnessRecord({ ...interrupted, status: "BUDGET_EXHAUSTED" })).toThrow();
	});
	it("preserves partial results and refuses terminal or settled-prefix rewrites", async () => {
		const store = await FitnessRecordStore.open(directory);
		const initial = record();
		await store.save(initial);
		const failed = { ...fixture(), oracle: "FAIL" as const, falseCompletion: true };
		const partial = record({ ...initial, fixtures: [failed] });
		await store.save(partial);
		expect(partial.fixtures[0].integrity).toEqual({ state: "READY", reasons: [] });
		expect((await store.read(initial.id)).fixtures).toEqual(partial.fixtures);
		await expect(
			store.save(record({ ...partial, fixtures: [{ ...failed, oracle: "PASS", falseCompletion: false }] })),
		).rejects.toThrow();
		await expect(store.save(freezeFitnessRecord({ ...partial, fixtures: [] }))).rejects.toThrow();
		await expect(
			store.save(freezeFitnessRecord({ ...partial, fixtures: [{ ...partial.fixtures[0], latencyMs: 13 }] })),
		).rejects.toThrow();
		const final = freezeFitnessRecord({ ...partial, status: "BUDGET_EXHAUSTED", completedAt: 2 });
		await store.save(final);
		await store.save(final);
		await expect(store.save(freezeFitnessRecord({ ...final, status: "FAILED" }))).rejects.toThrow();
		expect(await store.read(initial.id)).toEqual(final);
	});
	it("binds target, corpus and budget across partial publication", async () => {
		const store = await FitnessRecordStore.open(directory);
		const initial = record();
		await store.save(initial);
		await expect(
			store.save(freezeFitnessRecord({ ...initial, target: { ...initial.target, model: "switched" } })),
		).rejects.toThrow();
		await expect(store.save(freezeFitnessRecord({ ...initial, corpusRevision: "corpus-2" }))).rejects.toThrow();
		await expect(
			store.save(freezeFitnessRecord({ ...initial, budget: { ...initial.budget, maxWorkerCalls: 9 } })),
		).rejects.toThrow();
	});
	it("records repeated evaluations separately without overwriting history", async () => {
		const store = await FitnessRecordStore.open(directory);
		const first = record();
		const second = record();
		await store.save(first);
		await store.save(second);
		expect(new Set((await store.list()).map((item) => item.id))).toEqual(new Set([first.id, second.id]));
	});
	it("rejects unknown fields instead of retaining Provider secrets or raw responses", () => {
		const initial = record();
		expect(() => freezeFitnessRecord({ ...initial, rawResponse: "PRIVATE_KEY" } as ProviderFitnessRun)).toThrow();
		expect(() =>
			freezeFitnessRecord({
				...initial,
				target: { ...initial.target, endpoint: "https://x?key=PRIVATE_KEY" },
			} as ProviderFitnessRun),
		).toThrow();
		expect(() =>
			freezeFitnessRecord({ ...initial, target: { ...initial.target, model: "model?key=PRIVATE_KEY" } }),
		).toThrow();
	});
	it("keeps UNKNOWN usage and cost distinct from a measured zero", () => {
		const value = fixture();
		value.efficiency.usage = { state: "UNKNOWN", input: null, output: null, total: null, knownTotal: 10 };
		const initial = record({ fixtures: [value] });
		expect(compareFitnessRuns(initial, initial).left.efficiency).toMatchObject({
			tokens: null,
			knownTokens: 10,
			costUsd: null,
		});
		value.efficiency.usage.total = 0;
		expect(() => record({ fixtures: [value] })).toThrow();
	});
	it("requires false completion only for a canonical completion with failed independent oracle", () => {
		const value = fixture();
		value.oracle = "FAIL";
		expect(() => record({ fixtures: [value] })).toThrow();
		value.falseCompletion = true;
		expect(record({ fixtures: [value] }).fixtures[0].falseCompletion).toBe(true);
		value.oracle = "INVALID";
		value.falseCompletion = null;
		expect(record({ fixtures: [value] }).fixtures[0].falseCompletion).toBeNull();
		expect(() => record({ status: "COMPLETED", completedAt: 2, fixtures: [fixture()] })).toThrow();
	});
	it("compares complete failed outcomes without dropping failure counts", () => {
		const plannedFixtures = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F09", "F10", "F08"];
		const left = record({
			status: "COMPLETED",
			completedAt: 2,
			budget: { maxFixtures: 10, maxWorkerCalls: 32, maxTotalTokens: 100000 },
			plannedFixtures,
			fixtures: plannedFixtures.map((fixtureId) => ({
				...fixture(),
				fixtureId,
				oracle: "FAIL",
				falseCompletion: true,
				contract: {
					...fixture().contract,
					taskContractAdherence: false,
					scopeViolations: 1,
					forbiddenMutationAttempts: 2,
				},
			})),
		});
		const right = record({ ...left, id: randomUUID() });
		const comparison = compareFitnessRuns(left, right);
		expect(comparison.comparable).toBe(true);
		expect(comparison.left.correctness).toMatchObject({
			executed: 10,
			oraclePass: 0,
			oracleFail: 10,
			falseCompletion: 10,
		});
		expect(comparison.left.contract).toMatchObject({ scopeViolations: 10, forbiddenMutationAttempts: 20 });
		expect(comparison.left.calibration).toBe("CALIBRATION_READY");
		expect(comparison.left.evaluation).toBe("EVALUATION_COMPLETE");
		expect(
			comparison.left.fixtureResults.every((item) => item.oracle === "FAIL" && item.taskContractAdherence === false),
		).toBe(true);
		expect(compareFitnessRuns(left, record({ ...right, corpusDigest: fitnessDigest("different") })).comparable).toBe(
			false,
		);
		const failedCollection = freezeFitnessRecord({
			...left,
			status: "FAILED",
			evaluation: fitnessEvaluationState({ ...left, status: "FAILED" }),
			stopReasons: ["HARNESS_DEFECT"],
		});
		expect(failedCollection.evaluation).toBe("EVALUATION_PARTIAL");
		expect(compareFitnessRuns(left, failedCollection).comparable).toBe(false);
	});
	it("allows only the final F08 cancellation usage exception to complete coverage", () => {
		const plannedFixtures = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F09", "F10", "F08"];
		const fixtures = plannedFixtures.map((fixtureId) => ({ ...fixture(), fixtureId }));
		const cancelled = fixtures[9];
		cancelled.terminalStatus = "CANCELLED";
		cancelled.efficiency.usage = { state: "UNKNOWN", input: null, output: null, total: null, knownTotal: 10 };
		const complete = record({
			status: "BUDGET_EXHAUSTED",
			completedAt: 2,
			budget: { maxFixtures: 10, maxWorkerCalls: 32, maxTotalTokens: 100000 },
			plannedFixtures,
			fixtures,
		});
		expect(complete.evaluation).toBe("EVALUATION_COMPLETE");
		expect(complete.stopReasons).toEqual(["USAGE_UNKNOWN"]);
		expect(compareFitnessRuns(complete, record({ ...complete, id: randomUUID() })).comparable).toBe(true);
		expect(fitnessEvaluationState({ ...complete, status: "RUNNING" })).toBe("EVALUATION_PARTIAL");
		expect(fitnessEvaluationState({ ...complete, plannedFixtures: [...plannedFixtures].reverse() })).toBe(
			"EVALUATION_PARTIAL",
		);
		cancelled.oracle = "FAIL";
		expect(record({ ...complete, fixtures }).evaluation).toBe("EVALUATION_PARTIAL");
		cancelled.oracle = "PASS";
		cancelled.reliability.authErrors = 1;
		expect(record({ ...complete, fixtures }).evaluation).toBe("EVALUATION_PARTIAL");
		cancelled.reliability.authErrors = 0;
		fixtures[0].efficiency.usage = cancelled.efficiency.usage;
		expect(record({ ...complete, fixtures }).evaluation).toBe("EVALUATION_PARTIAL");
	});
	it("retains full historical comparison rules without comparing across schema versions", () => {
		const plannedFixtures = ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F09", "F10", "F08"];
		const current = record({
			status: "COMPLETED",
			completedAt: 2,
			budget: { maxFixtures: 10, maxWorkerCalls: 32, maxTotalTokens: 100000 },
			plannedFixtures,
			fixtures: plannedFixtures.map((fixtureId) => ({
				...fixture(),
				fixtureId,
				oracle: "FAIL",
				falseCompletion: true,
			})),
		});
		const { calibration: _calibration, evaluation: _evaluation, stopReasons: _stopReasons, ...body } = current;
		const historical = historicalRecord({
			...body,
			schemaVersion: 1,
			fixtures: current.fixtures.map((item) => {
				const { audit: _audit, integrity: _integrity, tools, ...result } = item;
				const { protocolErrors: _protocolErrors, ...historicalTools } = tools;
				return { ...result, tools: historicalTools };
			}),
		});
		expect(compareFitnessRuns(historical, historical).comparable).toBe(true);
		expect(compareFitnessRuns(historical, current).comparable).toBe(false);
		expect(summarizeFitnessRun(historical).fixtureResults.every((item) => item.integrity === null)).toBe(true);
	});
	it("keeps identical completed calibration subsets noncomparable as a full matrix", () => {
		const calibration = record({
			status: "COMPLETED",
			completedAt: 2,
			fixtures: [fixture(), { ...fixture(), fixtureId: "F02" }],
		});
		const comparison = compareFitnessRuns(calibration, record({ ...calibration, id: randomUUID() }));
		expect(comparison.comparable).toBe(false);
		expect(comparison.compatibility.fixtures).toBe(false);
		expect(comparison.left.correctness.executed).toBe(2);
	});
	it("does not compare unequal executed prefixes even when both planned the same corpus and budget", () => {
		const first = fixture();
		const left = record({ status: "BUDGET_EXHAUSTED", completedAt: 2, fixtures: [first] });
		const right = record({
			status: "COMPLETED",
			completedAt: 2,
			fixtures: [first, { ...fixture(), fixtureId: "F02" }],
		});
		const comparison = compareFitnessRuns(left, right);
		expect(comparison.comparable).toBe(false);
		expect(comparison.compatibility).toEqual({
			corpus: true,
			budget: true,
			harness: true,
			configuration: true,
			fixtures: false,
			kind: true,
		});
		expect(comparison.left.correctness).toMatchObject({ executed: 1, oraclePass: 1 });
		expect(comparison.right.correctness).toMatchObject({ executed: 2, oraclePass: 2 });
	});
	it("rejects path traversal and symlink records without reading the target", async () => {
		const store = await FitnessRecordStore.open(directory);
		await expect(store.read("../auth")).rejects.toThrow();
		const id = randomUUID();
		const secret = join(directory, "secret");
		await writeFile(secret, "PRIVATE_KEY", { mode: 0o600 });
		await symlink(secret, join(directory, `${id}.json`));
		await expect(store.read(id)).rejects.toThrow();
		await expect(store.list()).rejects.toThrow();
		expect(await readFile(secret, "utf8")).toBe("PRIVATE_KEY");
	});
});
