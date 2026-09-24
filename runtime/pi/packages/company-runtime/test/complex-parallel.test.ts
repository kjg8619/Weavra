import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { complexWaves } from "../src/complex-state.ts";
import type { ApprovalDecision, ApprovalRequest, Run } from "../src/contracts.ts";
import type { RuntimeEvent } from "../src/events.ts";
import { formatEvidencePack, projectEvidencePack } from "../src/evidence.ts";
import { WorkerExecutionError } from "../src/measurement.ts";
import { formatRunView } from "../src/observations.ts";
import type { AgentExecutionRequest, AgentExecutionResult, VerificationRequest } from "../src/ports.ts";
import { FileStateStore, StateStoreError } from "../src/state-store.ts";
import { formatWeavraStatus } from "../src/status.ts";
import {
	type ComplexTaskSpec,
	complexConfig,
	complexHarness,
	complexPlanFor,
	driveComplex,
	FakeFiles,
	measurement,
	takeConsumerIssues,
} from "./complex-fixture.ts";

// #20 (V0.8A): the Kernel wave scheduler with fake ports and explicit gates, so every interleaving of the race
// corpus (PARALLEL_AGENTS.md §11, P01–P12, P15–P17) is forced, not sampled. Every durable snapshot is checked against
// the durable invariants and every App consumer rule (v2); no worker may be live when a terminal state is written.
afterEach(() => {
	expect(takeConsumerIssues()).toEqual([]);
});

interface Gate {
	promise: Promise<void>;
	resolve: () => void;
}
function deferred(): Gate {
	let resolve!: () => void;
	const promise = new Promise<void>((fulfill) => {
		resolve = fulfill;
	});
	return { promise, resolve };
}
/** The task of an event's Kernel-assigned context, when it has one. */
const eventTask = (event: RuntimeEvent) => ("complexContext" in event ? event.complexContext?.taskId : undefined);
const eventAttempt = (event: RuntimeEvent) => ("complexContext" in event ? event.complexContext?.attempt : undefined);

/** Resolves once the signal aborts; the wave-scoped signal is always present for a wave Developer. */
function aborted(signal: AbortSignal | undefined): Promise<void> {
	return new Promise((resolve) => {
		if (!signal || signal.aborted) resolve();
		else signal.addEventListener("abort", () => resolve(), { once: true });
	});
}

const TERMINAL = new Set(["BLOCKED", "FAILED", "CANCELLED", "INTERRUPTED", "COMPLETED"]);
/** Two independent tasks: one wave with maxParallel 2. */
const INDEPENDENT: ComplexTaskSpec[] = [
	{ claims: [{ path: "src/a.ts", operation: "modify" }], dependsOn: [] },
	{ claims: [{ path: "src/b.ts", operation: "create" }], dependsOn: [] },
];

const taskOf = (request: { complexContext?: { taskId: string | null } }) => request.complexContext?.taskId ?? null;

async function parallel(
	specs: ComplexTaskSpec[] = INDEPENDENT,
	options: {
		maxParallel?: number;
		budget?: Record<string, number>;
		files?: FakeFiles;
		risk?: "R1" | "R3";
		goal?: string;
		statements?: string[];
	} = {},
) {
	const files = options.files ?? new FakeFiles({ "src/a.ts": "a\n", "src/c.ts": "c\n", "src/util.ts": "util\n" });
	const config = complexConfig({
		maxParallel: options.maxParallel ?? 2,
		...(options.risk === "R3" ? { maxRevisionCycles: 0 } : {}),
		...(options.budget ? { budget: options.budget } : {}),
	});
	const { plan, parent } = await complexPlanFor(specs, {
		files,
		config,
		...(options.risk ? { risk: options.risk } : {}),
		...(options.goal ? { goal: options.goal } : {}),
		...(options.statements ? { statements: options.statements } : {}),
	});
	const h = complexHarness({
		plan,
		parent,
		files,
		...(options.risk ? { risk: options.risk } : {}),
		...(options.goal ? { goal: options.goal } : {}),
	});
	// No worker may be live when any terminal state is written (§6); every invocation is tracked until it settles.
	const live = new Set<string>();
	const leaked: string[] = [];
	const save = h.ports.store.save;
	h.ports.store.save = async (run: Run) => {
		if (TERMINAL.has(run.status) && live.size) leaked.push(`${run.status} with live ${[...live].join(", ")}`);
		await save(run);
	};
	const verified: string[] = [];
	const verify = h.ports.verifier.verify;
	h.ports.verifier.verify = async (request: VerificationRequest) => {
		verified.push(`${taskOf(request) ?? "integration"}:${request.step.stepId}@${request.step.attempt}`);
		return verify(request);
	};
	/**
	 * A scripted Developer invocation: a session named after its task attempt (so both interleavings of one plan
	 * produce the same durable state), then `script` with the real Kernel ownership capability.
	 */
	const scripted = (
		request: AgentExecutionRequest,
		script: () => Promise<AgentExecutionResult>,
	): Promise<AgentExecutionResult> => {
		const key = `${taskOf(request)}@${request.complexContext?.attempt}`;
		live.add(key);
		h.calls.push(request);
		return (async () => {
			try {
				await request.onSessionCreated?.({
					role: request.role,
					sessionId: `${request.role}-${key}`,
					sessionFile: `/sessions/${request.role}-${key}.jsonl`,
				});
				return await script();
			} finally {
				live.delete(key);
			}
		})();
	};
	const developed = async (request: AgentExecutionRequest, tokens: number | null = 100) =>
		({ role: "Developer", handoff: await h.develop(request), measurement: measurement(request, tokens) }) as const;
	return { h, plan, files, live, leaked, verified, scripted, developed };
}

function statuses(run: Run | undefined): string[] {
	return run?.complex?.tasks.map((row) => row.status) ?? [];
}
function codes(run: Run): Array<[string, string | null]> {
	return run.complex?.tasks.map((row) => [row.status, row.failureCode]) ?? [];
}
const developers = (calls: AgentExecutionRequest[]) =>
	calls
		.filter((request) => request.role === "Developer")
		.map((request) => `${taskOf(request)}@${request.complexContext?.attempt}`);

describe("V0.8A wave scheduler (#20, race corpus P01–P12, P15–P17)", () => {
	it("P01: both Developers of a wave are live at once; verification follows in plan order", async () => {
		const p = await parallel();
		expect(complexWaves(p.plan)).toEqual([["CT-001", "CT-002"]]);
		const entered: Record<string, Gate> = { "CT-001": deferred(), "CT-002": deferred() };
		const release = deferred();
		const durations: Record<string, number> = {};
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			return p.scripted(request, async () => {
				const started = performance.now();
				entered[taskOf(request) ?? ""].resolve();
				await release.promise;
				// Model-backed implementation is where the wall-clock time goes.
				await new Promise((resolve) => setTimeout(resolve, 120));
				const result = await p.developed(request);
				durations[taskOf(request) ?? ""] = performance.now() - started;
				return result;
			});
		};
		const kernel = await p.h.create();
		await kernel.start();
		// The wave is decided and persisted before any worker starts.
		expect(kernel.snapshot.complex?.activeTaskIds).toEqual(["CT-001", "CT-002"]);
		expect(statuses(kernel.snapshot)).toEqual(["ELIGIBLE", "ELIGIBLE"]);
		const waveStarted = performance.now();
		const wave = kernel.advance("implement");
		await Promise.all([entered["CT-001"].promise, entered["CT-002"].promise]);
		expect(p.live).toEqual(new Set(["CT-001@1", "CT-002@1"]));
		expect(statuses(kernel.snapshot)).toEqual(["IMPLEMENTING", "IMPLEMENTING"]);
		release.resolve();
		await wave;
		const waveMs = performance.now() - waveStarted;
		// Measured, not claimed: the joined wave took about the slowest implementation, below the serial sum.
		expect(waveMs).toBeLessThan(durations["CT-001"] + durations["CT-002"]);
		expect(statuses(kernel.snapshot)).toEqual(["SELF_CHECK", "HANDED_OFF"]);
		const run = await driveComplex(kernel);
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(p.verified).toEqual([
			"CT-001:self-check@1",
			"CT-001:test@1",
			"CT-002:self-check@1",
			"CT-002:test@1",
			"integration:self-check@1",
			"integration:test@1",
		]);
		// Σ task invocations + 1 final Reviewer.
		expect(run.budget?.workerInvocations).toBe(5);
		expect(p.leaked).toEqual([]);
	});

	it("P02: a row that hands off first waits HANDED_OFF; no check starts until its sibling hands off", async () => {
		const p = await parallel();
		const second = deferred();
		const handedOff = deferred();
		const save = p.h.ports.store.save;
		p.h.ports.store.save = async (run: Run) => {
			await save(run);
			if (statuses(run)[0] === "HANDED_OFF") handedOff.resolve();
		};
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			return p.scripted(request, async () => {
				if (taskOf(request) === "CT-002") await second.promise;
				return p.developed(request);
			});
		};
		const kernel = await p.h.create();
		await kernel.start();
		const wave = kernel.advance("implement");
		await handedOff.promise;
		await new Promise((resolve) => setTimeout(resolve, 20));
		// Implemented and entry-captured, all gates NOT_RUN, no whole-workspace exit digest while B may write.
		expect(statuses(kernel.snapshot)).toEqual(["HANDED_OFF", "IMPLEMENTING"]);
		expect(kernel.snapshot.complex?.tasks[0]).toMatchObject({
			selfCheck: "NOT_RUN",
			review: "NOT_RUN",
			test: "NOT_RUN",
			exitWorkspaceDigest: null,
			changedFiles: ["src/a.ts"],
		});
		expect(kernel.snapshot.complex?.tasks[0].entryWorkspaceDigest).toMatch(/^[0-9a-f]{64}$/);
		expect(p.verified).toEqual([]);
		second.resolve();
		await wave;
		expect(statuses(kernel.snapshot)).toEqual(["SELF_CHECK", "HANDED_OFF"]);
		const run = await driveComplex(kernel);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(p.h.invariantErrors).toEqual([]);
		expect(p.leaked).toEqual([]);
	});

	it("P03: when B hands off before A, verification still runs A then B", async () => {
		const p = await parallel();
		const first = deferred();
		const bHandedOff = deferred();
		const save = p.h.ports.store.save;
		p.h.ports.store.save = async (run: Run) => {
			await save(run);
			if (statuses(run)[1] === "HANDED_OFF") bHandedOff.resolve();
		};
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			return p.scripted(request, async () => {
				if (taskOf(request) === "CT-001") await first.promise;
				return p.developed(request);
			});
		};
		const kernel = await p.h.create();
		await kernel.start();
		const wave = kernel.advance("implement");
		await bHandedOff.promise;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(statuses(kernel.snapshot)).toEqual(["IMPLEMENTING", "HANDED_OFF"]);
		expect(p.verified).toEqual([]);
		first.resolve();
		await wave;
		const run = await driveComplex(kernel);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(p.verified.slice(0, 4)).toEqual([
			"CT-001:self-check@1",
			"CT-001:test@1",
			"CT-002:self-check@1",
			"CT-002:test@1",
		]);
		expect(p.h.calls.filter((request) => request.role === "Reviewer").map((request) => taskOf(request))).toEqual([
			"CT-001",
			"CT-002",
			null,
		]);
		expect(p.leaked).toEqual([]);
	});

	it("P04: a chain A→B beside an independent C runs as wave 1 {A, C}, then wave 2 {B}", async () => {
		const p = await parallel([
			{ claims: [{ path: "src/a.ts", operation: "modify" }], dependsOn: [] },
			{ claims: [{ path: "src/b.ts", operation: "create" }], dependsOn: [1] },
			{ claims: [{ path: "src/c.ts", operation: "modify" }], dependsOn: [] },
		]);
		expect(complexWaves(p.plan)).toEqual([["CT-001", "CT-003"], ["CT-002"]]);
		const run = await driveComplex(await p.h.create());
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(p.h.invariantErrors).toEqual([]);
		const waves = p.h.saved
			.filter((snapshot) => snapshot.complex?.tasks.some((row) => row.status === "IMPLEMENTING"))
			.map((snapshot) => snapshot.complex?.activeTaskIds);
		expect(waves[0]).toEqual(["CT-001", "CT-003"]);
		expect(waves.at(-1)).toEqual(["CT-002"]);
		// B never became active before its declared dependency A COMPLETED, even though C was implementing beside A.
		for (const snapshot of p.h.saved) {
			const rows = snapshot.complex?.tasks ?? [];
			if (rows[1] && rows[1].status !== "PENDING") expect(rows[0].status).toBe("COMPLETED");
		}
		expect(developers(p.h.calls)).toEqual(["CT-001@1", "CT-003@1", "CT-002@1"]);
	});

	it("P05: A writing B's claimed file while both are live blocks A; B is aborted, joined and RUN_STOPPED", async () => {
		const p = await parallel();
		const before = structuredClone([...p.files.files]);
		const bLive = deferred();
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			return p.scripted(request, async () => {
				if (taskOf(request) === "CT-002") {
					bLive.resolve();
					await aborted(request.signal);
					throw new WorkerExecutionError("Worker aborted", measurement(request));
				}
				await bLive.promise;
				// The early exact gate denies the sibling's path before any effect.
				request.ownership?.authorize("src/b.ts", "create");
				p.files.write("src/b.ts", "SHOULD NOT HAPPEN");
				throw new Error("unreachable");
			});
		};
		const run = await driveComplex(await p.h.create());
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.failureCode).toBe("OWNERSHIP_CONFLICT");
		expect(codes(run)).toEqual([
			["BLOCKED", "OWNERSHIP_CONFLICT"],
			["BLOCKED", "RUN_STOPPED"],
		]);
		expect(run.complex?.cleanup).toBe("CONFIRMED");
		expect([...p.files.files]).toEqual(before);
		expect(p.live.size).toBe(0);
		expect(p.leaked).toEqual([]);
		expect(p.verified).toEqual([]);
		// Every started row ends with its own failure events; the sibling names the stop cause.
		const failed = p.h.events.filter((event) => event.type === "AgentFailed");
		expect(failed.map((event) => [eventTask(event), "reason" in event ? event.reason : ""])).toEqual([
			["CT-001", expect.stringContaining("OWNERSHIP_CONFLICT")],
			["CT-002", "Run stopped: CT-001 failed"],
		]);
	});

	it("P06: one row FAILED while its sibling is mid-tool-call: the sibling is aborted and its late effect rejected", async () => {
		const p = await parallel();
		const bMid = deferred();
		let late: unknown;
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			return p.scripted(request, async () => {
				if (taskOf(request) === "CT-002") {
					bMid.resolve();
					await aborted(request.signal);
					// The tool call finishes only after the abort: its effect must not happen or be attributed.
					try {
						request.ownership?.authorize("src/b.ts", "create");
						p.files.write("src/b.ts", "LATE EFFECT");
					} catch (error) {
						late = error;
					}
					throw new WorkerExecutionError("Worker aborted", measurement(request));
				}
				await bMid.promise;
				throw new WorkerExecutionError("Worker provider failed", measurement(request));
			});
		};
		const run = await driveComplex(await p.h.create());
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status).toBe("FAILED");
		expect(run.complex?.failureCode).toBe("WORKER_FAILED");
		expect(codes(run)).toEqual([
			["FAILED", "WORKER_FAILED"],
			["BLOCKED", "RUN_STOPPED"],
		]);
		expect(String(late)).toMatch(/Ownership capability closed; late tool callback rejected/);
		expect(p.files.files.has("src/b.ts")).toBe(false);
		// Both invocations' spend stays recorded in plan order; nothing is hidden.
		expect(run.workerMeasurements?.map((item) => item.complexContext?.taskId)).toEqual(["CT-001", "CT-002"]);
		expect(run.budget?.workerInvocations).toBe(2);
		expect(p.leaked).toEqual([]);
	});

	it("P07: a cancel with two live Developers aborts, joins and cancels both rows with confirmed cleanup", async () => {
		const p = await parallel();
		const entered: Record<string, Gate> = { "CT-001": deferred(), "CT-002": deferred() };
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			return p.scripted(request, async () => {
				entered[taskOf(request) ?? ""].resolve();
				await aborted(request.signal);
				throw new WorkerExecutionError("Worker aborted", measurement(request));
			});
		};
		const kernel = await p.h.create();
		await kernel.start();
		const cancel = new AbortController();
		const wave = kernel.advance("implement", cancel.signal);
		await Promise.all([entered["CT-001"].promise, entered["CT-002"].promise]);
		cancel.abort();
		await wave;
		const run = kernel.snapshot;
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status).toBe("CANCELLED");
		expect(run.complex).toMatchObject({ cleanup: "CONFIRMED", failureCode: "CANCELLED", activeTaskIds: [] });
		expect(codes(run)).toEqual([
			["CANCELLED", "CANCELLED"],
			["CANCELLED", "CANCELLED"],
		]);
		// STOPPING was persisted for every active row in one save, after the join and before the terminal save.
		const stopping = p.h.saved.find((snapshot) => snapshot.complex?.phase === "STOPPING");
		expect(statuses(stopping)).toEqual(["STOPPING", "STOPPING"]);
		expect(stopping?.complex?.cleanup).toBe("PENDING");
		expect(p.live.size).toBe(0);
		expect(p.leaked).toEqual([]);
		expect(p.verified).toEqual([]);
	});

	it("P08: REVISE of A while B is HANDED_OFF: A re-implements alone, B verifies after A at the new digest", async () => {
		const p = await parallel();
		const kernelRef: { statuses?: string[] } = {};
		let kernelSnapshot: () => Run = () => {
			throw new Error("kernel not created");
		};
		let reviews = 0;
		p.h.ports.agents.execute = async (request) => {
			if (request.role === "Reviewer" && taskOf(request) === "CT-001" && reviews++ === 0) {
				p.h.calls.push(request);
				await p.h.register(request);
				return {
					role: "Reviewer",
					contribution: p.h.contribution(request, "REVISE"),
					measurement: measurement(request),
				};
			}
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			if (request.complexContext?.attempt === 2) kernelRef.statuses = statuses(kernelSnapshot());
			return p.scripted(request, () => p.developed(request));
		};
		const kernel = await p.h.create();
		kernelSnapshot = () => kernel.snapshot;
		const run = await driveComplex(kernel);
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(developers(p.h.calls)).toEqual(["CT-001@1", "CT-002@1", "CT-001@2"]);
		// A's revision ran alone while B waited HANDED_OFF (a verification-state wave of one).
		expect(kernelRef.statuses).toEqual(["IMPLEMENTING", "HANDED_OFF"]);
		// B's turn came only after A COMPLETED, at the digest A's revision produced.
		expect(p.verified).toEqual([
			"CT-001:self-check@1",
			"CT-001:self-check@2",
			"CT-001:test@2",
			"CT-002:self-check@1",
			"CT-002:test@1",
			"integration:self-check@1",
			"integration:test@1",
		]);
		const [a, b] = run.complex?.tasks ?? [];
		expect(a).toMatchObject({ status: "COMPLETED", attempt: 2, revisionCycle: 1 });
		expect(b).toMatchObject({ status: "COMPLETED", attempt: 1 });
		const joined = run.complexEvidence?.find(
			(record) => record.complexContext.taskId === "CT-001" && record.complexContext.attempt === 1,
		);
		expect(b.exitWorkspaceDigest).not.toBe(joined?.exitWorkspaceDigest);
		expect(b.exitWorkspaceDigest).toBe(run.complex?.integration.workspaceDigest);
		expect(p.leaked).toEqual([]);
	});

	it("P09: one invocation left for a two-row wave blocks BUDGET_EXHAUSTED before any wave worker starts", async () => {
		const p = await parallel(
			[
				{ claims: [{ path: "src/a.ts", operation: "modify" }], dependsOn: [] },
				{ claims: [{ path: "src/b.ts", operation: "create" }], dependsOn: [1] },
				{ claims: [{ path: "src/c.ts", operation: "modify" }], dependsOn: [1] },
			],
			{ budget: { max_worker_invocations: 3 } },
		);
		expect(complexWaves(p.plan)).toEqual([["CT-001"], ["CT-002", "CT-003"]]);
		const run = await driveComplex(await p.h.create());
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.failureCode).toBe("BUDGET_EXHAUSTED");
		expect(codes(run)).toEqual([
			["COMPLETED", null],
			["BLOCKED", "BUDGET_EXHAUSTED"],
			["BLOCKED", "BUDGET_EXHAUSTED"],
		]);
		// A partial wave never started: neither Developer ran and nothing was counted for them.
		expect(developers(p.h.calls)).toEqual(["CT-001@1"]);
		expect(run.budget?.workerInvocations).toBe(2);
		expect(run.complex?.tasks.slice(1).every((row) => row.attempt === 0 && row.workerInvocations === 0)).toBe(true);
		expect(p.leaked).toEqual([]);
	});

	it("P10: unknown usage from one wave row lets the wave join, then blocks BUDGET_UNKNOWN before the first Reviewer", async () => {
		const p = await parallel();
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			return p.scripted(request, () => p.developed(request, taskOf(request) === "CT-001" ? null : 100));
		};
		const run = await driveComplex(await p.h.create());
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.failureCode).toBe("BUDGET_UNKNOWN");
		expect(codes(run)).toEqual([
			["BLOCKED", "BUDGET_UNKNOWN"],
			["BLOCKED", "RUN_STOPPED"],
		]);
		// Both Developers handed off and joined; no Reviewer ever started.
		expect(developers(p.h.calls)).toEqual(["CT-001@1", "CT-002@1"]);
		expect(p.h.calls.some((request) => request.role === "Reviewer")).toBe(false);
		expect(p.h.saved.some((snapshot) => statuses(snapshot).join() === "HANDED_OFF,HANDED_OFF")).toBe(true);
		expect(run.budget?.reportedTokens).toBeNull();
		expect(run.complex?.tasks[0].reportedTokens).toBeNull();
		expect(p.leaked).toEqual([]);
	});

	it("P11: an external change while the wave is live fails the join capture: EXTERNAL_MUTATION, no verification", async () => {
		const p = await parallel();
		const entered: Record<string, Gate> = { "CT-001": deferred(), "CT-002": deferred() };
		const release = deferred();
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			return p.scripted(request, async () => {
				entered[taskOf(request) ?? ""].resolve();
				await release.promise;
				return p.developed(request);
			});
		};
		const kernel = await p.h.create();
		await kernel.start();
		const wave = kernel.advance("implement");
		await Promise.all([entered["CT-001"].promise, entered["CT-002"].promise]);
		p.files.write("src/util.ts", "external edit\n");
		release.resolve();
		await wave;
		const run = kernel.snapshot;
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.failureCode).toBe("EXTERNAL_MUTATION");
		expect(codes(run)).toEqual([
			["BLOCKED", "EXTERNAL_MUTATION"],
			["BLOCKED", "EXTERNAL_MUTATION"],
		]);
		expect(p.verified).toEqual([]);
		expect(run.complex?.tasks.every((row) => row.changesUnknown)).toBe(true);
		expect(run.workspace?.changedFiles).toContain("src/util.ts");
		expect(p.leaked).toEqual([]);
	});

	it("P12: an integration check failure after every wave blocks and keeps the completed history", async () => {
		const p = await parallel();
		const verify = p.h.ports.verifier.verify;
		p.h.ports.verifier.verify = async (request: VerificationRequest) => {
			const result = await verify(request);
			if (request.complexContext?.scope !== "INTEGRATION") return result;
			return {
				...result,
				checks: result.checks.map((check) =>
					check.id === "test"
						? { ...check, status: "FAIL" as const, exitCode: 1, reason: "Integration broke" }
						: check,
				),
			};
		};
		const run = await driveComplex(await p.h.create());
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.failureCode).toBe("CHECK_FAILED");
		expect(codes(run)).toEqual([
			["COMPLETED", null],
			["COMPLETED", null],
		]);
		expect(run.complex?.integration).toMatchObject({ check: "FAIL", failureCode: "CHECK_FAILED" });
		expect(p.leaked).toEqual([]);
	});

	it("P15: one total event order, per-task causal order and the same final state for both forced interleavings", async () => {
		async function interleaving(first: "CT-001" | "CT-002") {
			const p = await parallel();
			const gates: Record<string, Gate> = { "CT-001": deferred(), "CT-002": deferred() };
			const entered: Record<string, Gate> = { "CT-001": deferred(), "CT-002": deferred() };
			const handedOff = deferred();
			const index = first === "CT-001" ? 0 : 1;
			const save = p.h.ports.store.save;
			p.h.ports.store.save = async (run: Run) => {
				await save(run);
				if (statuses(run)[index] === "HANDED_OFF") handedOff.resolve();
			};
			p.h.ports.agents.execute = async (request) => {
				if (request.role !== "Developer") return p.h.defaultExecute(request);
				return p.scripted(request, async () => {
					entered[taskOf(request) ?? ""].resolve();
					await gates[taskOf(request) ?? ""].promise;
					return p.developed(request);
				});
			};
			const kernel = await p.h.create();
			await kernel.start();
			const wave = kernel.advance("implement");
			await Promise.all([entered["CT-001"].promise, entered["CT-002"].promise]);
			gates[first].resolve();
			await handedOff.promise;
			gates[first === "CT-001" ? "CT-002" : "CT-001"].resolve();
			await wave;
			const run = await driveComplex(kernel);
			expect(run.status, run.lastError ?? "").toBe("COMPLETED");
			expect(p.h.invariantErrors).toEqual([]);
			return { run, events: p.h.events, saved: p.h.saved };
		}
		const forward = await interleaving("CT-001");
		const reverse = await interleaving("CT-002");
		for (const { events, saved } of [forward, reverse]) {
			// Every persisted revision is +1 and every event sequence number strictly increases across tasks.
			expect(saved.map((snapshot) => snapshot.revision)).toEqual(saved.map((_snapshot, position) => position + 1));
			expect(events.map((event) => event.sequence)).toEqual(events.map((_event, position) => position + 1));
			// Per-task causal order of each implementation step.
			for (const taskId of ["CT-001", "CT-002"]) {
				const order = events
					.filter(
						(event) =>
							eventTask(event) === taskId &&
							eventAttempt(event) === 1 &&
							"step" in event &&
							event.step?.stepId === "implement",
					)
					.map((event) => event.type);
				expect(order).toEqual([
					"StepStarted",
					"AgentStarted",
					"AgentSessionCreated",
					"AgentCompleted",
					"StepCompleted",
				]);
			}
		}
		const handoffs = ({ events }: { events: RuntimeEvent[] }) =>
			events
				.filter((event) => event.type === "AgentCompleted" && event.step?.stepId === "implement")
				.map((event) => eventTask(event));
		// The interleavings really differed...
		expect(handoffs(forward)).toEqual(["CT-001", "CT-002"]);
		expect(handoffs(reverse)).toEqual(["CT-002", "CT-001"]);
		// ...but the final durable state is identical; only revisions and timestamps may differ.
		const normalized = (run: Run) => ({ ...run, revision: 0, eventSequence: 0, createdAt: 0, updatedAt: 0 });
		expect(normalized(reverse.run)).toEqual(normalized(forward.run));
	});

	it("P16: maxParallel 1 schedules exactly like V0.7B, adding only a brief HANDED_OFF", async () => {
		const p = await parallel(INDEPENDENT, { maxParallel: 1 });
		expect(p.plan.limits.maxParallel).toBe(1);
		// Even independent tasks run one at a time, each after every earlier task COMPLETED.
		expect(complexWaves(p.plan)).toEqual([["CT-001"], ["CT-002"]]);
		const run = await driveComplex(await p.h.create());
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(p.h.calls.map((request) => [request.role, taskOf(request)])).toEqual([
			["Developer", "CT-001"],
			["Reviewer", "CT-001"],
			["Developer", "CT-002"],
			["Reviewer", "CT-002"],
			["Reviewer", null],
		]);
		expect(p.h.saved.every((snapshot) => (snapshot.complex?.activeTaskIds ?? []).length <= 1)).toBe(true);
		const handedOff = p.h.saved.findIndex((snapshot) => statuses(snapshot)[0] === "HANDED_OFF");
		expect(handedOff).toBeGreaterThan(0);
		expect(statuses(p.h.saved[handedOff + 1])[0]).toBe("SELF_CHECK");
		expect(p.leaked).toEqual([]);
	});

	it("§4 rule 4: a wave handoff whose changed_files differ from the attempt's ledger effects fails; the sibling stops", async () => {
		const p = await parallel();
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			return p.scripted(request, async () => {
				const result = await p.developed(request);
				// CT-002 reports its sibling's file as its own change: never accepted.
				return taskOf(request) === "CT-002"
					? { ...result, handoff: { ...result.handoff, changed_files: ["src/a.ts", "src/b.ts"] } }
					: result;
			});
		};
		const run = await driveComplex(await p.h.create());
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status).toBe("BLOCKED");
		expect(run.lastError).toContain("Handoff changed_files differ from the actual task-local delta");
		expect(codes(run)).toEqual([
			["BLOCKED", "RUN_STOPPED"],
			["BLOCKED", "INVALID_RESULT"],
		]);
		// The row that handed off first keeps its attempt data; no verification ever started.
		expect(run.complex?.tasks[0]).toMatchObject({ attempt: 1, changedFiles: ["src/a.ts"] });
		expect(p.verified).toEqual([]);
		expect(p.leaked).toEqual([]);
	});

	it("§4 rules 4 and 6: an outside change to a row's own claimed file blocks it at handoff or before its turn", async () => {
		// At handoff: the own-claim capture no longer matches the row's own recorded effects.
		const atHandoff = await parallel();
		atHandoff.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return atHandoff.h.defaultExecute(request);
			return atHandoff.scripted(request, async () => {
				const result = await atHandoff.developed(request);
				if (taskOf(request) === "CT-001") atHandoff.files.write("src/a.ts", "outside edit\n");
				return result;
			});
		};
		const blocked = await driveComplex(await atHandoff.h.create());
		expect(atHandoff.h.invariantErrors).toEqual([]);
		expect(codes(blocked)).toEqual([
			["BLOCKED", "EXTERNAL_MUTATION"],
			["BLOCKED", "RUN_STOPPED"],
		]);
		expect(blocked.lastError).toContain("differs from the image CT-001's own effects left");
		expect(atHandoff.verified).toEqual([]);
		// Before its turn: CT-002 waits HANDED_OFF while CT-001 verifies; its file changes; nothing of CT-002 runs.
		const waiting = await parallel();
		const verify = waiting.h.ports.verifier.verify;
		waiting.h.ports.verifier.verify = async (request: VerificationRequest) => {
			const result = await verify(request);
			if (taskOf(request) === "CT-001" && request.step.stepId === "self-check")
				waiting.files.write("src/b.ts", "outside edit\n");
			return result;
		};
		const stale = await driveComplex(await waiting.h.create());
		expect(waiting.h.invariantErrors).toEqual([]);
		expect(stale.status).toBe("BLOCKED");
		expect(stale.complex?.failureCode).toBe("EXTERNAL_MUTATION");
		expect(codes(stale)).toEqual([
			["BLOCKED", "EXTERNAL_MUTATION"],
			["BLOCKED", "RUN_STOPPED"],
		]);
		expect(waiting.verified).toEqual(["CT-001:self-check@1"]);
		expect(waiting.h.calls.some((request) => request.role === "Reviewer")).toBe(false);
	});

	it("§7: failure selection follows plan order, not completion order, and every row keeps its own code", async () => {
		const p = await parallel();
		const bFailed = deferred();
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer") return p.h.defaultExecute(request);
			return p.scripted(request, async () => {
				if (taskOf(request) === "CT-002") {
					bFailed.resolve();
					throw new WorkerExecutionError("Worker provider failed", measurement(request));
				}
				await bFailed.promise;
				await aborted(request.signal);
				// CT-001's typed Policy denial settles after CT-002 already failed: still CT-001's own failure.
				throw new WorkerExecutionError("Policy denied", measurement(request), undefined, "POLICY_DENIED");
			});
		};
		const run = await driveComplex(await p.h.create());
		expect(p.h.invariantErrors).toEqual([]);
		expect(codes(run)).toEqual([
			["BLOCKED", "POLICY_DENIED"],
			["FAILED", "WORKER_FAILED"],
		]);
		// The Run takes the first failure in plan (persisted) order; the later-in-plan failure is not hidden.
		expect(run.status).toBe("BLOCKED");
		expect(run.complex?.failureCode).toBe("POLICY_DENIED");
		expect(p.leaked).toEqual([]);
	});

	it("§6: owner loss mid-wave recovers every unfinished row INTERRUPTED/OWNER_LOST, with no resume", async () => {
		const root = await mkdtemp(join(tmpdir(), "company-complex-wave-"));
		try {
			const p = await parallel();
			const store = await FileStateStore.open(root);
			const entered: Record<string, Gate> = { "CT-001": deferred(), "CT-002": deferred() };
			const release = deferred();
			p.h.ports.agents.execute = async (request) => {
				if (request.role !== "Developer") return p.h.defaultExecute(request);
				return p.scripted(request, async () => {
					entered[taskOf(request) ?? ""].resolve();
					await release.promise;
					return p.developed(request);
				});
			};
			const kernel = await p.h.create({});
			// Route the Kernel's saves through the validating FileStateStore as well as the observing fake store.
			const fake = p.h.ports.store.save;
			p.h.ports.store.save = async (run: Run) => {
				await store.save(run);
				await fake(run);
			};
			await store.save(kernel.snapshot);
			await kernel.start();
			const wave = kernel.advance("implement");
			await Promise.all([entered["CT-001"].promise, entered["CT-002"].promise]);
			expect(statuses(kernel.snapshot)).toEqual(["IMPLEMENTING", "IMPLEMENTING"]);
			// The owner disappears while two Developers are live; a new owner recovers the durable Run.
			await store.close();
			const recovered = await FileStateStore.open(root);
			const run = recovered.snapshot.runs[0];
			p.h.consumer.observe(run);
			expect(run.status).toBe("INTERRUPTED");
			expect(run.complex).toMatchObject({
				phase: "TERMINAL",
				activeTaskIds: [],
				cleanup: "UNCONFIRMED",
				failureCode: "OWNER_LOST",
			});
			expect(codes(run)).toEqual([
				["INTERRUPTED", "OWNER_LOST"],
				["INTERRUPTED", "OWNER_LOST"],
			]);
			// The old Kernel can no longer write; its wave joins and fails on storage, and nothing resumes.
			release.resolve();
			await expect(wave).rejects.toBeInstanceOf(StateStoreError);
			expect(p.live.size).toBe(0);
			await recovered.close();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("shows concurrent tasks honestly in the TUI rows, the footer and the Evidence Pack wave fields", async () => {
		const p = await parallel([
			{ claims: [{ path: "src/a.ts", operation: "modify" }], dependsOn: [] },
			{ claims: [{ path: "src/b.ts", operation: "create" }], dependsOn: [] },
			{ claims: [{ path: "src/c.ts", operation: "modify" }], dependsOn: [1, 2] },
		]);
		const run = await driveComplex(await p.h.create());
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		const live = p.h.saved.find(
			(snapshot) =>
				statuses(snapshot).join() === "IMPLEMENTING,IMPLEMENTING,PENDING" && snapshot.activeAgents.length,
		);
		if (!live) throw new Error("no live wave snapshot");
		const text = formatRunView("workflow", { run: live, source: "stored snapshot" });
		expect(text).toContain("| active CT-001, CT-002");
		expect(text).toContain(
			"Waves (at most 2 implementing at once; verification one task at a time in plan order): 1: CT-001, CT-002 | 2: CT-003",
		);
		expect(text).toMatch(/ {2}CT-001 IMPLEMENTING \| wave 1 \|/);
		expect(text).toMatch(/ {2}CT-002 IMPLEMENTING \| wave 1 \|/);
		expect(text).toMatch(/ {2}CT-003 PENDING \| wave 2 \|/);
		expect(formatWeavraStatus(live, true)).toBe("Weavra · COMPLEX · R1 · CT-001+CT-002 · IMPLEMENT · Developer");
		const waiting = p.h.saved.find((snapshot) => statuses(snapshot).join() === "SELF_CHECK,HANDED_OFF,PENDING");
		if (!waiting) throw new Error("no verification turn snapshot");
		expect(formatRunView("workflow", { run: waiting, source: "stored snapshot" })).toMatch(
			/ {2}CT-002 HANDED_OFF \| wave 1 \| attempt 1/,
		);
		const pack = projectEvidencePack({ run });
		expect(pack.complex).toMatchObject({
			plan: { schemaVersion: 2, limits: { maxParallel: 2 } },
			activeTaskIds: [],
			waves: [["CT-001", "CT-002"], ["CT-003"]],
		});
		expect(pack.complex?.tasks.map((task) => task.wave)).toEqual([1, 1, 2]);
		expect(formatEvidencePack(pack)).toContain(
			"  Waves (max 2 implementing at once; verification one task at a time in plan order): 1: CT-001, CT-002 | 2: CT-003",
		);
	});

	it("P17: an R3 plan freezes maxParallel 1 even with max_parallel 4, and the V0.7B R3 flow is unchanged", async () => {
		const files = new FakeFiles({ "src/obsolete.ts": "old\n", "src/app.ts": "app\n" });
		const p = await parallel(
			[
				{ claims: [{ path: "src/obsolete.ts", operation: "delete" }], criteria: [1] },
				{ claims: [], criteria: [1] },
			],
			{
				maxParallel: 4,
				files,
				risk: "R3",
				goal: "Delete file src/obsolete.ts",
				statements: ["The obsolete file is removed"],
			},
		);
		expect(p.plan.limits).toMatchObject({ maxParallel: 1, maxTotalRevisionCycles: 0 });
		const grant = (request: ApprovalRequest): ApprovalDecision => ({
			runId: request.runId,
			actionId: request.actionId,
			actionDigest: request.actionDigest,
			configDigest: request.configDigest,
			expiresAt: request.expiresAt,
			approved: true,
		});
		p.h.ports.approval = { requestApproval: async (request) => grant(request) };
		p.h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer" || taskOf(request) !== "CT-001") return p.h.defaultExecute(request);
			return p.scripted(request, async () => {
				const decision = await request.onApprovalRequested!(
					{
						runId: request.runId,
						actionId: "delete-1",
						actionDigest: "action-digest",
						configDigest: "config-digest",
						reason: "Delete the preselected file",
						role: "Developer",
						operation: "delete-file",
						path: "src/obsolete.ts",
						preconditionDigest: "precondition",
						bytes: 4,
						step: structuredClone(request.step),
						revision: request.revision,
						...(request.complexContext ? { complexContext: structuredClone(request.complexContext) } : {}),
					},
					request.signal,
				);
				if (!decision.approved) throw new Error("Human approval refused; deletion was not executed");
				request.ownership!.authorize("src/obsolete.ts", "delete");
				files.remove("src/obsolete.ts");
				request.ownership!.recordEffect("src/obsolete.ts", null);
				await request.onApprovalConsumed!("delete-1");
				return {
					role: "Developer",
					handoff: p.h.handoffFor(request, ["src/obsolete.ts"]),
					measurement: measurement(request),
				};
			});
		};
		const run = await driveComplex(await p.h.create());
		expect(p.h.invariantErrors).toEqual([]);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(files.files.has("src/obsolete.ts")).toBe(false);
		expect(run.approvals?.map((record) => record.status)).toEqual(["CONSUMED"]);
		expect(p.h.saved.some((snapshot) => snapshot.status === "WAITING_APPROVAL")).toBe(true);
		expect(p.h.saved.every((snapshot) => (snapshot.complex?.activeTaskIds ?? []).length <= 1)).toBe(true);
		expect(p.leaked).toEqual([]);
	});
});
