import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRequest } from "../src/classification.ts";
import type { Handoff, Review, Run, VerificationResult } from "../src/contracts.ts";
import { projectEvidencePack } from "../src/evidence.ts";
import { CompanyKernel, type CreateRunRequest } from "../src/kernel.ts";
import type { AgentExecutionRequest, AgentExecutionResult, KernelPorts, VerificationRequest } from "../src/ports.ts";
import { FileStateStore, StateStoreError } from "../src/state-store.ts";
import { testContract } from "./fixture-contract.ts";

const TRUST = `sha256:${"a".repeat(64)}`;
const POLICY = `sha256:${"b".repeat(64)}`;
function fixture(overrides: Partial<CreateRunRequest> = {}) {
	const goal = "Fix bug in src/app.ts";
	const request: CreateRunRequest = {
		runId: "repair-run",
		executionMode: "EDIT",
		workflow: "STANDARD",
		task: testContract(goal, { taskId: "task", checkIds: ["check"] }),
		classification: classifyRequest(goal).classification,
		verificationRepairMode: "self-check-once",
		checks: [
			{
				id: "check",
				kind: "test",
				required: true,
				repairableExitCodes: [7],
				trustRequired: true,
				trustRegistrationDigest: TRUST,
				sandboxRequired: true,
				sandboxPolicyDigest: POLICY,
			},
		],
		...overrides,
	};
	let digest = "diff-0";
	let cleanupConfirmed = true;
	let safe = true;
	const calls: AgentExecutionRequest[] = [];
	const saved: Run[] = [];
	const changedFiles = request.executionMode === "READ_ONLY" ? [] : ["src/app.ts"];
	const verify = (input: VerificationRequest): VerificationResult => ({
		runId: input.runId,
		revision: input.revision,
		step: input.step,
		diffDigest: digest,
		changedFiles,
		integrity: "CLEAN",
		evidenceRefs: [`diff:${digest}`],
		checks: input.checks.map((check) => ({
			id: check.id,
			kind: check.kind,
			required: check.required,
			runId: input.runId,
			revision: input.revision,
			step: input.step,
			diffDigest: digest,
			status: input.revision === 0 ? "FAIL" : "PASS",
			exitCode: input.revision === 0 ? 7 : 0,
			...(input.revision === 0 ? { failureKind: "COMMAND_NONZERO" as const } : {}),
			reason: "Fixture actual outcome",
			evidenceRefs: [`check:${input.revision}:${input.step.stepId}:${check.id}`],
			trust: { mode: "strict", status: "VERIFIED", registrationDigest: TRUST, executableDigest: TRUST, sources: [] },
			sandbox: {
				mode: "required",
				status: "ENFORCED",
				backend: "srt",
				backendVersion: "0.0.76",
				policyDigest: POLICY,
			},
		})),
	});
	const result = (input: AgentExecutionRequest, verdict: Review["result"] = "PASS"): AgentExecutionResult => {
		if (input.role === "Reviewer")
			return {
				role: "Reviewer",
				review: {
					runId: input.runId,
					revision: input.revision,
					role: "Reviewer",
					task: input.task.id,
					result: verdict,
					issues: [],
					diffDigest: input.verification.diffDigest,
					evidenceRefs: input.verification.evidenceRefs,
					criteria: input.task.acceptanceCriteria.map((criterion) => ({
						criterionId: criterion.id,
						status: "MET",
						evidenceRefs: input.verification.evidenceRefs,
					})),
				},
			};
		const handoff: Handoff = {
			runId: input.runId,
			revision: input.revision,
			role: "Developer",
			task: input.task.id,
			changed_files: changedFiles,
			summary: "Implementation",
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
		};
		return input.role === "Developer"
			? { role: "Developer", handoff }
			: {
					role: "Executor",
					handoff: {
						...handoff,
						role: "Executor",
						criteria: input.task.acceptanceCriteria.map((criterion) => ({
							criterionId: criterion.id,
							status: "MET",
							explanation: "Scoped implementation",
						})),
					},
				};
	};
	const ports: KernelPorts = {
		agents: {
			execute: async (input) => {
				calls.push(structuredClone({ ...input, signal: undefined, onSessionCreated: undefined }));
				await input.onSessionCreated?.({
					role: input.role,
					sessionId: `${input.role}-${input.revision}`,
					sessionFile: `/sessions/${input.role}-${input.revision}.jsonl`,
				});
				if (input.role !== "Reviewer") digest = `diff-${input.revision}`;
				return result(input);
			},
		},
		verifier: {
			get safeToRelease() {
				return cleanupConfirmed;
			},
			verify: async (input) => verify(input),
			inspect: async () => ({
				safe,
				diffDigest: digest,
				changedFiles,
				changedLines: 2,
				evidenceRefs: [`diff:${digest}`],
			}),
		},
		store: {
			load: async () => undefined,
			save: async (run) => {
				saved.push(structuredClone(run));
			},
		},
	};
	return {
		request,
		ports,
		calls,
		saved,
		verify,
		result,
		setSafe: (value: boolean) => {
			safe = value;
		},
		setCleanup: (value: boolean) => {
			cleanupConfirmed = value;
		},
		setDigest: (value: string) => {
			digest = value;
		},
		create: () => CompanyKernel.create(request, ports),
	};
}
async function drive(kernel: CompanyKernel, signal?: AbortSignal) {
	await kernel.start();
	for (let guard = 0; kernel.snapshot.status === "RUNNING" && guard < 30; guard++)
		await kernel.advance(kernel.snapshot.currentStep!.stepId, signal);
	return kernel.snapshot;
}

describe("V0.5C Kernel repair admission", () => {
	it.each([
		[
			"missing positive attribution",
			(result: VerificationResult) => {
				delete result.checks[0].failureKind;
			},
		],
		[
			"unknown integrity",
			(result: VerificationResult) => {
				delete result.integrity;
			},
		],
		[
			"failed integrity",
			(result: VerificationResult) => {
				result.integrity = "BLOCKED";
			},
		],
		[
			"unregistered failure code",
			(result: VerificationResult) => {
				result.checks[0].exitCode = 1;
			},
		],
		[
			"signal exit",
			(result: VerificationResult) => {
				result.checks[0].exitCode = null;
			},
		],
		[
			"stale oracle generation",
			(result: VerificationResult) => {
				result.checks[0].trust!.status = "STALE";
			},
		],
		[
			"wrong original registration",
			(result: VerificationResult) => {
				result.checks[0].trust!.registrationDigest = POLICY;
			},
		],
		[
			"sandbox infrastructure failure",
			(result: VerificationResult) => {
				result.checks[0].sandbox!.status = "UNAVAILABLE";
			},
		],
		[
			"wrong sandbox policy",
			(result: VerificationResult) => {
				result.checks[0].sandbox!.policyDigest = TRUST;
			},
		],
		[
			"stale check attempt",
			(result: VerificationResult) => {
				result.checks[0].step!.attempt = 2;
			},
		],
		[
			"missing failed evidence",
			(result: VerificationResult) => {
				result.checks[0].evidenceRefs = [];
			},
		],
	] as const)("never repairs %s", async (_name, mutate) => {
		const f = fixture();
		f.ports.verifier.verify = async (input) => {
			const result = f.verify(input);
			mutate(result);
			return result;
		};
		const state = await drive(await f.create());
		expect(state.status).toBe("BLOCKED");
		expect(f.calls.map((call) => call.role)).toEqual(["Developer"]);
		expect(state.verificationRepair?.attempts).toEqual([]);
	});
	it("vetoes repair when an optional check has an infrastructure failure", async () => {
		const f = fixture();
		f.request.checks!.push({ ...f.request.checks![0], id: "optional", required: false });
		f.ports.verifier.verify = async (input) => {
			const result = f.verify(input);
			Object.assign(result.checks[1], { status: "UNAVAILABLE", exitCode: null });
			delete result.checks[1].failureKind;
			return result;
		};
		const state = await drive(await f.create());
		expect(state.status).toBe("BLOCKED");
		expect(state.verificationRepair?.attempts).toEqual([]);
		expect(f.calls).toHaveLength(1);
	});
	it.each(["unsafe workspace", "changed diff", "cleanup unconfirmed", "cancelled"])(
		"does not schedule repair after %s",
		async (failure) => {
			const f = fixture();
			const controller = new AbortController();
			f.ports.verifier.verify = async (input) => {
				const result = f.verify(input);
				if (failure === "unsafe workspace") f.setSafe(false);
				if (failure === "changed diff") f.setDigest("external-change");
				if (failure === "cleanup unconfirmed") f.setCleanup(false);
				if (failure === "cancelled") controller.abort();
				return result;
			};
			const state = await drive(await f.create(), controller.signal);
			expect(state.status).toBe(failure === "cancelled" ? "CANCELLED" : "BLOCKED");
			expect(state.verificationRepair?.attempts).toEqual([]);
			expect(f.calls).toHaveLength(1);
		},
	);
	it.each(["READ_ONLY", "R2", "R3", "QUICK"])("does not authorize repair in %s", async (scope) => {
		const f = fixture();
		if (scope === "READ_ONLY") {
			f.request.executionMode = "READ_ONLY";
			f.ports.verifier.inspect = async () => ({
				safe: true,
				diffDigest: "diff-0",
				changedFiles: [],
				evidenceRefs: ["diff:diff-0"],
			});
		}
		if (scope === "R2") f.request.classification.risk = "R2";
		if (scope === "R3") {
			f.request.classification.risk = "R3";
			f.request.task = testContract("Delete src/obsolete.ts", { taskId: "task", checkIds: ["check"] });
		}
		if (scope === "QUICK") {
			f.request.workflow = "QUICK";
			f.request.classification = classifyRequest("Fix typo in src/app.ts").classification;
			f.request.task = testContract("Fix typo in src/app.ts", {
				taskId: "task",
				checkIds: ["check"],
				workflow: "QUICK",
			});
		}
		const state = await drive(await f.create());
		expect(state.status).not.toBe("COMPLETED");
		expect(state.verificationRepair?.attempts).toEqual([]);
		expect(f.calls.length).toBeLessThanOrEqual(1);
	});
	it("fails storage before launching the new worker if the repair link cannot be persisted", async () => {
		const f = fixture();
		const save = f.ports.store.save;
		f.ports.store.save = async (run) => {
			if (run.verificationRepair?.attempts.length) throw new Error("storage unavailable");
			await save(run);
		};
		await expect(drive(await f.create())).rejects.toThrow("storage unavailable");
		expect(f.calls).toHaveLength(1);
		expect(f.saved.at(-1)?.verification[0].status).toBe("FAIL");
	});
	it("keeps unknown token usage and denies the repair rather than resetting its budget", async () => {
		const f = fixture({ budget: { maxReportedTokens: 100 } });
		const state = await drive(await f.create());
		expect(state.status).toBe("BLOCKED");
		expect(state.budget).toMatchObject({ workerInvocations: 1, reportedTokens: null, exceeded: true });
		expect(f.calls).toHaveLength(1);
	});
});

describe("V0.5C fresh attempt isolation", () => {
	it.each(["Developer missing", "Developer reused", "Reviewer missing", "Reviewer reused"])(
		"rejects a repaired run with %s session identity",
		async (failure) => {
			const f = fixture();
			const execute = f.ports.agents.execute;
			f.ports.agents.execute = async (input) => {
				if (input.revision !== 1 || !failure.startsWith(input.role)) return execute(input);
				return execute({
					...input,
					onSessionCreated: failure.endsWith("missing")
						? undefined
						: async (reference) => {
								await input.onSessionCreated?.({
									...reference,
									sessionId: "Developer-0",
									sessionFile: "/sessions/Developer-0.jsonl",
								});
							},
				});
			};
			const state = await drive(await f.create());
			expect(["BLOCKED", "FAILED"]).toContain(state.status);
			expect(state.verificationRepair?.attempts).toHaveLength(1);
			expect(state.verification.some((check) => check.step?.stepId === "test")).toBe(false);
		},
	);
	it.each(["self-check", "review"] as const)(
		"rejects an earlier revision returned as fresh %s evidence",
		async (stage) => {
			const f = fixture();
			if (stage === "self-check")
				f.ports.verifier.verify = async (input) => {
					const result = f.verify(input);
					if (input.revision === 1) result.revision = 0;
					return result;
				};
			else {
				const execute = f.ports.agents.execute;
				f.ports.agents.execute = async (input) => {
					const result = await execute(input);
					if (result.role === "Reviewer") result.review.revision = 0;
					return result;
				};
			}
			const state = await drive(await f.create());
			expect(state.status).toBe("BLOCKED");
			expect(state.verificationRepair?.attempts).toHaveLength(1);
			expect(state.verification.some((check) => check.step?.stepId === "test")).toBe(false);
		},
	);
	it("does not repair TEST failures after independent review", async () => {
		const f = fixture();
		f.ports.verifier.verify = async (input) => {
			const result = f.verify(input);
			for (const check of result.checks)
				Object.assign(
					check,
					input.step.stepId === "test"
						? { status: "FAIL", exitCode: 7, failureKind: "COMMAND_NONZERO" }
						: { status: "PASS", exitCode: 0 },
				);
			return result;
		};
		const state = await drive(await f.create());
		expect(state.status).toBe("BLOCKED");
		expect(state.verificationRepair?.attempts).toEqual([]);
		expect(f.calls.map((call) => call.role)).toEqual(["Developer", "Reviewer"]);
	});
	it("keeps genuine Reviewer revisions separate from the one verification repair", async () => {
		const f = fixture({ maxRevisionCycles: 1 });
		const execute = f.ports.agents.execute;
		f.ports.agents.execute = async (input) => {
			const result = await execute(input);
			return input.role === "Reviewer" && input.revision === 1 ? f.result(input, "REVISE") : result;
		};
		const state = await drive(await f.create());
		expect(state.status, state.lastError ?? "").toBe("COMPLETED");
		expect(state.revisionCycle).toBe(2);
		expect(state.reviewHistory?.map((review) => [review.revision, review.result])).toEqual([
			[1, "REVISE"],
			[2, "PASS"],
		]);
		expect(f.calls.filter((call) => call.role === "Developer").map((call) => call.revision)).toEqual([0, 1, 2]);
		expect(state.budget?.workerInvocations).toBe(5);
	});
	it.each(["Worker provider failed", "Worker authentication failed", "Policy R0/DENY: protected oracle"])(
		"does not reschedule after %s in the repair worker",
		async (message) => {
			const f = fixture();
			const execute = f.ports.agents.execute;
			f.ports.agents.execute = async (input) => {
				const result = await execute(input);
				if (input.revision === 1) throw new Error(message);
				return result;
			};
			const state = await drive(await f.create());
			expect(state.status).toBe("FAILED");
			expect(f.calls.map((call) => call.revision)).toEqual([0, 1]);
			expect(state.verificationRepair?.attempts).toHaveLength(1);
			if (message === "Worker provider failed")
				expect(projectEvidencePack({ run: state }).failure?.category).toBe("PROVIDER");
		},
	);
});

describe("V0.5C durable repair provenance", () => {
	it.each(["disable mode", "remove parent", "rewrite parent", "erase failed evidence"])(
		"rejects an attempted %s without changing durable history",
		async (mutation) => {
			const root = await mkdtemp(join(tmpdir(), "company-repair-state-"));
			const store = await FileStateStore.open(root);
			try {
				const f = fixture();
				f.ports.store = store;
				const kernel = await f.create();
				await kernel.start();
				await kernel.advance("implement");
				await kernel.advance("self-check");
				const original = kernel.snapshot;
				expect(original.verificationRepair?.attempts).toHaveLength(1);
				const changed = structuredClone(original);
				changed.revision++;
				if (mutation === "disable mode") changed.verificationRepair!.mode = "disabled";
				if (mutation === "remove parent") changed.verificationRepair!.attempts = [];
				if (mutation === "rewrite parent") changed.verificationRepair!.attempts[0].evidenceRefs = ["forged"];
				if (mutation === "erase failed evidence") changed.verification = [];
				await expect(store.save(changed)).rejects.toBeInstanceOf(StateStoreError);
				const persisted = JSON.parse(await readFile(join(root, ".ai/state.json"), "utf8")) as { runs: Run[] };
				expect(persisted.runs).toEqual([original]);
			} finally {
				await store.close();
				await rm(root, { recursive: true, force: true });
			}
		},
	);
});
