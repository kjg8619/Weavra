import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyRequest } from "../src/classification.ts";
import type { PolicyDecision, Run } from "../src/contracts.ts";
import type { RuntimeEvent } from "../src/events.ts";
import { CompanyKernel } from "../src/kernel.ts";
import { FileStateStore, type FileStateStoreOptions, StateStoreError } from "../src/state-store.ts";
import {
	type ComplexTaskSpec,
	complexHarness,
	complexPlanFor,
	driveComplex,
	FakeFiles,
	measurement,
	takeConsumerIssues,
} from "./complex-fixture.ts";
import { testContract } from "./fixture-contract.ts";

// #16 stage B (B7): durable COMPLEX validation, the COMPLEX branches of the durable R2/mutation gates, and
// interrupted-owner recovery on the real FileStateStore.

let root: string;
const stores: FileStateStore[] = [];
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "company-complex-state-"));
});
afterEach(async () => {
	for (const store of stores.splice(0)) await store.close().catch(() => {});
	await rm(root, { recursive: true, force: true });
	// #16 stage C: every durable snapshot the Kernel saved through the real store, and every transition between
	// them (including owner-loss recovery observed below), satisfies the App consumer rules.
	expect(takeConsumerIssues()).toEqual([]);
});
async function openStore(options?: FileStateStoreOptions) {
	const store = await FileStateStore.open(root, options);
	stores.push(store);
	return store;
}

const TWO_TASKS: ComplexTaskSpec[] = [
	{ claims: [{ path: "src/app.ts", operation: "modify" }] },
	{ claims: [{ path: "src/new.ts", operation: "create" }] },
];

async function durable(options: { specs?: ComplexTaskSpec[]; goal?: string; risk?: "R1" | "R2" } = {}) {
	const store = await openStore();
	const files = new FakeFiles({ "src/app.ts": "app\n", "src/util.ts": "util\n" });
	const { plan, parent } = await complexPlanFor(options.specs ?? TWO_TASKS, {
		files,
		...(options.goal ? { goal: options.goal } : {}),
		...(options.risk ? { risk: options.risk } : {}),
	});
	const h = complexHarness({ plan, parent, files, ...(options.goal ? { goal: options.goal } : {}) });
	const kernel = await CompanyKernel.create(h.request(), { ...h.ports, store: h.consumer.wrap(store) }, () => 1000);
	return { store, h, kernel };
}

function decision(risk: "R1" | "R2", actionId = "action-1"): PolicyDecision {
	return {
		executionMode: "EDIT",
		runId: "run-1",
		actionId,
		role: "Developer",
		risk,
		decision: "ALLOW",
		reason: "Registered ordinary file mutation",
		actionDigest: `digest-${actionId}`,
		configDigest: "config-1",
		projectInstructionDigest: null,
	};
}

describe("durable COMPLEX runs", () => {
	it("persists every COMPLEX snapshot through the validating store and reloads it unchanged", async () => {
		const { store, kernel, h } = await durable();
		const run = await driveComplex(kernel);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(h.invariantErrors).toEqual([]);
		// Every durable save through the real store was projected and App-checked (afterEach asserts no issue).
		expect(h.consumer.projected).toEqual(Array.from({ length: run.revision }, (_, index) => index + 1));
		await store.close();
		const reopened = await openStore();
		expect(await reopened.load("run-1")).toEqual(run);
		const tasks = JSON.parse(await readFile(join(root, ".ai/tasks.json"), "utf8"));
		expect(tasks.completed.map((task: { id: string }) => task.id)).toEqual([run.tasks[0].id]);
	});

	it.each([
		[
			"plan",
			(run: Run) => {
				run.complex!.plan.tasks[0].title = "Edited after confirmation";
			},
		],
		[
			"parent",
			(run: Run) => {
				run.tasks[0].goal = "Another goal";
			},
		],
		[
			"row regression",
			(run: Run) => {
				run.complex!.tasks[0].attempt = 0;
			},
		],
		[
			"PENDING re-entry",
			(run: Run) => {
				run.complex!.tasks[1].status = "PENDING";
			},
		],
		[
			"finished row",
			(run: Run) => {
				run.complex!.tasks[0].reportedTokens = 1;
			},
		],
		[
			"active task identity",
			(run: Run) => {
				run.complex!.activeTaskId = null;
			},
		],
		[
			"terminal phase while running",
			(run: Run) => {
				run.complex!.phase = "TERMINAL";
			},
		],
		["missing context", (run: Run) => void delete run.verification[0].complexContext],
		[
			"budget regression",
			(run: Run) => {
				run.budget!.workerInvocations = 1;
			},
		],
		[
			"revision drift",
			(run: Run) => {
				run.revisionCycle = 1;
			},
		],
		["removed COMPLEX state", (run: Run) => void delete run.complex],
		[
			"completion without integration",
			(run: Run) => {
				run.status = "COMPLETED";
				run.complex!.phase = "TERMINAL";
				run.complex!.activeTaskId = null;
				run.complex!.tasks[1].status = "COMPLETED";
				run.tasks[0].status = "completed";
			},
		],
	])("rejects immutable or inconsistent drift: %s (C27, C36)", async (_name, mutate) => {
		const { store, kernel } = await durable();
		const run = await driveComplex(kernel, (value) => value.complex?.tasks[1].status === "ELIGIBLE");
		const drift = structuredClone(run);
		drift.revision++;
		mutate(drift);
		await expect(store.save(drift)).rejects.toBeInstanceOf(StateStoreError);
		const reopened = await (async () => {
			await store.close().catch(() => {});
			return openStore();
		})();
		expect(reopened.snapshot.runs[0].complex?.plan.tasks[0].title).toBe("Task 1");
	});

	it("keeps QUICK/STANDARD records free of COMPLEX identity", async () => {
		const store = await openStore();
		const kernel = await CompanyKernel.create(
			{
				executionMode: "EDIT",
				runId: "standard",
				task: testContract("Fix bug", { taskId: "task-1" }),
				classification: classifyRequest("Fix bug").classification,
			},
			{
				store,
				agents: { execute: async () => Promise.reject(new Error("unused")) },
				verifier: { verify: async () => Promise.reject(new Error("unused")) },
			},
		);
		await kernel.start();
		const run = kernel.snapshot;
		await expect(
			store.save({
				...run,
				revision: run.revision + 1,
				roleSessionRefs: [
					{
						role: "Developer",
						sessionId: "s",
						sessionFile: "/s",
						complexContext: {
							parentTaskContractDigest: `sha256:${"0".repeat(64)}`,
							complexPlanDigest: `sha256:${"1".repeat(64)}`,
							scope: "INTEGRATION",
							taskId: null,
							attempt: 1,
						},
					},
				],
			}),
		).rejects.toBeInstanceOf(StateStoreError);
	});
});

describe("durable COMPLEX mutation gates", () => {
	it("refuses a Developer mutation intent while the task is only ELIGIBLE", async () => {
		const { store, kernel } = await durable();
		await kernel.start();
		expect(kernel.snapshot.complex?.tasks[0].status).toBe("ELIGIBLE");
		// ELIGIBLE is a scheduling decision, not permission: no mutation intent before IMPLEMENTING.
		await expect(store.prepare(decision("R1", "early"))).rejects.toThrow();
		expect(store.snapshot.actions).toEqual([]);
	});

	it("records the durable intent during the attempt and refuses it after the attempt settled", async () => {
		const { store, kernel, h } = await durable();
		h.ports.agents.execute = async (request) => {
			if (request.role === "Developer" && request.complexContext?.taskId === "CT-001") {
				h.calls.push(request);
				await h.register(request);
				await store.prepare(decision("R1"));
				await store.finish("run-1", "action-1", "SUCCEEDED");
				return { role: "Developer", handoff: await h.develop(request), measurement: measurement(request) };
			}
			return h.defaultExecute(request);
		};
		await driveComplex(kernel, (run) => run.complex?.tasks[0].status === "SELF_CHECK");
		expect(store.snapshot.actions.map((action) => action.status)).toEqual(["SUCCEEDED"]);
		await expect(store.prepare(decision("R1", "late"))).rejects.toThrow();
	});

	it("binds an R2 intent to the active COMPLEX task attempt (explicit COMPLEX branch)", async () => {
		const { store, kernel, h } = await durable({
			goal: "Refactor dependency handling across multiple modules",
			risk: "R2",
		});
		expect(kernel.snapshot.risk).toBe("R2");
		h.ports.agents.execute = async (request) => {
			if (request.role === "Developer" && request.complexContext?.taskId === "CT-001") {
				h.calls.push(request);
				await h.register(request);
				await store.prepare(decision("R2"));
				await store.finish("run-1", "action-1", "SUCCEEDED");
				return { role: "Developer", handoff: await h.develop(request), measurement: measurement(request) };
			}
			return h.defaultExecute(request);
		};
		const run = await driveComplex(kernel);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		expect(store.snapshot.actions[0]).toMatchObject({ status: "SUCCEEDED", decision: { risk: "R2" } });
		// A persisted R2 COMPLEX review obligation cannot be downgraded.
		await expect(store.save({ ...run, revision: run.revision + 1, workflow: "STANDARD" })).rejects.toThrow();
	});
});

describe("COMPLEX recovery after owner loss (B7)", () => {
	it("interrupts every unfinished row, keeps COMPLETED history and never replays", async () => {
		const { store, kernel, h } = await durable();
		await driveComplex(kernel, (run) => run.complex?.tasks[1].status === "ELIGIBLE");
		await store.close();
		const events: RuntimeEvent[] = [];
		const recovered = await openStore({ events: { emit: (event) => void events.push(event) } });
		const run = recovered.snapshot.runs[0];
		// The recovered snapshot is a consistent later revision of the same Run for the App consumer.
		h.consumer.observe(run);
		expect(run.status).toBe("INTERRUPTED");
		expect(run.complex).toMatchObject({
			phase: "TERMINAL",
			activeTaskId: null,
			cleanup: "UNCONFIRMED",
			failureCode: "OWNER_LOST",
			partialChanges: true,
			changesUnknown: true,
		});
		expect(run.complex?.tasks.map((row) => [row.status, row.failureCode])).toEqual([
			["COMPLETED", null],
			["INTERRUPTED", "OWNER_LOST"],
		]);
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({
			type: "RunInterrupted",
			complexBinding: {
				parentTaskContractDigest: run.complex?.plan.parentTaskContractDigest,
				complexPlanDigest: run.complex?.plan.complexPlanDigest,
			},
		});
		await recovered.close();
		const again: RuntimeEvent[] = [];
		await openStore({ events: { emit: (event) => void again.push(event) } });
		expect(again).toEqual([]);
	});

	it("settles a gate that was RUNNING when the owner was lost as UNAVAILABLE", async () => {
		const { store, kernel, h } = await durable();
		const verify = h.ports.verifier.verify;
		h.ports.verifier.verify = async (request) => {
			if (request.step.stepId === "self-check") {
				// The owner disappears mid-check: the lease is released and every later write fails.
				await store.close();
				throw new Error("owner lost");
			}
			return verify(request);
		};
		await kernel.start();
		await kernel.advance("implement");
		await expect(kernel.advance("self-check")).rejects.toBeInstanceOf(StateStoreError);
		const recovered = await openStore();
		const run = recovered.snapshot.runs[0];
		h.consumer.observe(run);
		expect(run.status).toBe("INTERRUPTED");
		expect(run.complex?.tasks[0]).toMatchObject({
			status: "INTERRUPTED",
			failureCode: "OWNER_LOST",
			selfCheck: "UNAVAILABLE",
		});
		expect(run.complex?.tasks[1]).toMatchObject({ status: "INTERRUPTED", failureCode: "OWNER_LOST" });
	});
});
