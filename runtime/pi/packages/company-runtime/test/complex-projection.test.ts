import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { complexPlanDigest } from "../src/complex-plan.ts";
import { ComplexProjectionError, projectComplexExecution } from "../src/complex-state.ts";
import type { ComplexExecution, ComplexPlan } from "../src/complex-types.ts";
import type { Run, TaskContract } from "../src/contracts.ts";
import { taskContractDigest } from "../src/criterion-evidence.ts";
import type { HostControlPreview } from "../src/host-control-protocol.ts";
import {
	type ComplexObservation,
	complexConsumerIssues,
	complexPreviewIssues,
	observeDurableRun,
} from "./complex-conformance.ts";
import {
	type ComplexTaskSpec,
	complexHarness,
	complexPlanFor,
	driveComplex,
	FakeFiles,
	takeConsumerIssues,
} from "./complex-fixture.ts";

// #16 stage C: the §10.2 Host Control projection is a pure function of one durable COMPLEX Run and its envelope,
// and every rule of the merged #17 App consumer (restated in complex-conformance.ts) holds for it. The negative
// tables prove that restatement rejects each inconsistency the App rejects.

interface ContractFixture {
	parent: TaskContract;
	parentTaskContractDigest: string;
	plan: ComplexPlan;
	complexPlanDigest: string;
	preview: {
		goal: string;
		allowedPaths: string[];
		acceptanceCriteria: Array<{ id: string; statement: string; checkIds: string[]; reviewRequired: boolean }>;
		checks: Array<{ id: string; kind: string; required: boolean }>;
		taskContractDigest: string;
	};
}
const fixture = JSON.parse(
	readFileSync(new URL("./fixtures/complex-contract-v1.fixture.json", import.meta.url), "utf8"),
) as ContractFixture;

const TWO_TASKS: ComplexTaskSpec[] = [
	{ claims: [{ path: "src/app.ts", operation: "modify" }] },
	{ claims: [{ path: "src/new.ts", operation: "create" }] },
];
const envelope = { ownerId: "owner-1", projectRevision: 1 };

beforeEach(() => {
	takeConsumerIssues();
});
afterEach(() => {
	takeConsumerIssues();
});

async function completedTwoTaskRun() {
	const files = new FakeFiles({ "src/app.ts": "app\n", "src/util.ts": "util\n" });
	const { plan, parent } = await complexPlanFor(TWO_TASKS, { files });
	const h = complexHarness({ plan, parent, files });
	const run = await driveComplex(await h.create());
	expect(run.status, run.lastError ?? "").toBe("COMPLETED");
	expect(takeConsumerIssues()).toEqual([]);
	const pick = (predicate: (value: Run) => boolean) => {
		const found = h.saved.find(predicate);
		if (!found) throw new Error("snapshot not found");
		return found;
	};
	return {
		created: pick((value) => value.status === "CREATED"),
		mid: pick(
			(value) => value.complex?.tasks[0].status === "COMPLETED" && value.complex.tasks[1].status === "ELIGIBLE",
		),
		done: run,
	};
}

function observe(run: Run, revision = envelope.projectRevision): ComplexObservation {
	const { observation, issues } = observeDurableRun(run, { ...envelope, projectRevision: revision });
	expect(issues).toEqual([]);
	return structuredClone(observation);
}
const execution = (observation: ComplexObservation): ComplexExecution => {
	const value = observation.state.complexExecution;
	if (!value) throw new Error("projection missing");
	return value;
};
/** Moves one observation to another durable revision consistently (state, projection, graph, envelope). */
function atRevision(observation: ComplexObservation, stateRevision: number): ComplexObservation {
	const next = structuredClone(observation);
	next.state.stateRevision = stateRevision;
	execution(next).stateRevision = stateRevision;
	if (next.state.snapshot.graph) next.state.snapshot.graph.stateRevision = stateRevision;
	if (next.response) next.response.stateRevision = stateRevision;
	return next;
}

describe("COMPLEX control projection (#16 stage C)", () => {
	it("projects the reference fixture plan from creation to completion, byte-identical to its frozen material", async () => {
		const files = new FakeFiles({ "src/config.ts": "export const config = {};\n" });
		const h = complexHarness({ plan: fixture.plan, parent: fixture.parent, files });
		const kernel = await h.create();
		const created = kernel.snapshot;
		const projection = projectComplexExecution(created, { ...envelope, stateRevision: created.revision });
		const pending = (id: string) => ({
			id,
			status: "PENDING",
			attempt: 0,
			revisionCycle: 0,
			workerInvocations: 0,
			reportedTokens: 0,
			entryWorkspaceDigest: null,
			exitWorkspaceDigest: null,
			changedFiles: [],
			changesUnknown: false,
			selfCheck: "NOT_RUN",
			review: "NOT_RUN",
			test: "NOT_RUN",
			evidenceFreshness: "NONE",
			failureCode: null,
		});
		expect(projection).toEqual({
			schemaVersion: 1,
			ownerId: "owner-1",
			projectRevision: 1,
			runId: "run-1",
			stateRevision: created.revision,
			parent: fixture.parent,
			plan: fixture.plan,
			phase: "TASK_SEQUENCE",
			activeTaskId: null,
			tasks: [pending("CT-001"), pending("CT-002")],
			integration: {
				check: "NOT_RUN",
				review: "NOT_RUN",
				test: "NOT_RUN",
				workspaceDigest: null,
				evidenceFreshness: "NONE",
				failureCode: null,
			},
			budget: { workerInvocations: 0, reportedTokens: 0, totalRevisionCycles: 0, status: "WITHIN_LIMITS" },
			cleanup: "NOT_REQUESTED",
			partialChanges: false,
			changesUnknown: false,
			failureCode: null,
		});
		// The consumer recomputes both frozen digests directly from the projection.
		expect(taskContractDigest(projection.parent)).toBe(fixture.parentTaskContractDigest);
		expect(complexPlanDigest(projection.plan)).toBe(fixture.complexPlanDigest);
		const run = await driveComplex(kernel);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		// Every durable snapshot of the fixture Run, and every transition between them, satisfies the App consumer.
		expect(h.saved.length).toBeGreaterThan(10);
		expect(takeConsumerIssues()).toEqual([]);
		expect(projectComplexExecution(run, { ...envelope, stateRevision: run.revision })).toMatchObject({
			parent: { ...fixture.parent, status: "completed" },
			plan: fixture.plan,
			phase: "TERMINAL",
			activeTaskId: null,
			integration: { check: "PASS", review: "PASS", test: "PASS", evidenceFreshness: "CURRENT", failureCode: null },
			budget: { workerInvocations: 5, totalRevisionCycles: 0, status: "WITHIN_LIMITS" },
			cleanup: "CONFIRMED",
			failureCode: null,
		});
	});

	it("is a pure function of the Run and envelope: same revision, same canonical data", async () => {
		const { mid } = await completedTwoTaskRun();
		const first = projectComplexExecution(mid, { ownerId: "a", projectRevision: 3, stateRevision: mid.revision });
		const second = projectComplexExecution(structuredClone(mid), {
			ownerId: "b",
			projectRevision: 9,
			stateRevision: mid.revision,
		});
		expect({ ...first, ownerId: "", projectRevision: 0 }).toEqual({ ...second, ownerId: "", projectRevision: 0 });
		// The projection is a copy: mutating it never reaches the durable Run.
		first.tasks[0].status = "FAILED";
		first.parent.acceptanceCriteria[0].scope.paths.push("elsewhere");
		expect(mid.complex?.tasks[0].status).toBe("COMPLETED");
		expect(JSON.stringify(mid.tasks[0])).not.toContain("elsewhere");
	});

	it("fails closed instead of publishing a partial, stale or oversized projection", async () => {
		const { mid } = await completedTwoTaskRun();
		const code = (run: Run, stateRevision = run.revision) => {
			try {
				projectComplexExecution(run, { ...envelope, stateRevision });
				return "PROJECTED";
			} catch (error) {
				return error instanceof ComplexProjectionError ? error.code : "UNEXPECTED";
			}
		};
		expect(code(mid)).toBe("PROJECTED");
		// Another durable revision than the one being projected.
		expect(code(mid, mid.revision + 1)).toBe("STATE_UNAVAILABLE");
		// A COMPLEX Run without a Host-confirmed plan has no projection (never an empty task list).
		const planless = structuredClone(mid);
		delete planless.complex;
		planless.status = "BLOCKED";
		expect(code(planless)).toBe("STATE_UNAVAILABLE");
		// A QUICK/STANDARD Run never has one.
		expect(code({ ...structuredClone(mid), workflow: "STANDARD" })).toBe("STATE_UNAVAILABLE");
		// An internally inconsistent Run is never published.
		const inconsistent = structuredClone(mid);
		inconsistent.complex!.tasks[1].reportedTokens = null;
		inconsistent.complex!.tasks[1].status = "PENDING";
		expect(code(inconsistent)).toBe("STATE_UNAVAILABLE");
	});

	it("reports RESPONSE_TOO_LARGE for a projection over 32,768 bytes, never a truncated parent or plan", async () => {
		const files = new FakeFiles({ "src/app.ts": "app\n" });
		const statements = Array.from({ length: 16 }, (_, index) => `Criterion ${index + 1} holds`);
		const { plan: small, parent: smallParent } = await complexPlanFor(TWO_TASKS, { files, statements });
		// A parent whose scopes alone exceed the projection bound; the Host compiler would never admit its plan.
		const parent = structuredClone(smallParent);
		for (const criterion of parent.acceptanceCriteria)
			criterion.scope.paths = Array.from({ length: 32 }, (_, index) => `area-${index}-${"s".repeat(200)}`);
		const { complexPlanDigest: _stale, ...material } = {
			...small,
			parentTaskContractDigest: taskContractDigest(parent),
		};
		const plan: ComplexPlan = { ...material, complexPlanDigest: complexPlanDigest(material) };
		const h = complexHarness({ plan, parent, files });
		const created = (await h.create()).snapshot;
		expect(() => projectComplexExecution(created, { ...envelope, stateRevision: created.revision })).toThrow(
			expect.objectContaining({ code: "RESPONSE_TOO_LARGE" }),
		);
		// The App-facing observation therefore carries no projection: the consumer marks COMPLEX unavailable.
		expect(takeConsumerIssues().join("\n")).toMatch(/complexExecution unavailable: .*32768/);
	});
});

describe("App consumer restatement rejects inconsistent observations (#16 stage C)", () => {
	type Base = "created" | "mid" | "done";
	const single: Array<[string, Base, (observation: ComplexObservation) => void, RegExp]> = [
		[
			"an unknown field",
			"done",
			(o) => {
				(execution(o) as unknown as Record<string, unknown>).extra = 1;
			},
			/unknown field/,
		],
		[
			"null instead of an absent projection",
			"mid",
			(o) => {
				(o.state as unknown as Record<string, unknown>).complexExecution = null;
			},
			/expected an object/,
		],
		[
			"no projection for a latest COMPLEX Run",
			"mid",
			(o) => {
				delete o.state.complexExecution;
			},
			/needs it/,
		],
		[
			"a projection without advertisement",
			"mid",
			(o) => {
				o.capabilities = {};
			},
			/unadvertised/,
		],
		[
			"a projection for a STANDARD latest Run",
			"mid",
			(o) => {
				o.state.snapshot.status.run!.workflow = "STANDARD";
			},
			/envelope must equal/,
		],
		[
			"another stateRevision",
			"mid",
			(o) => {
				execution(o).stateRevision += 1;
			},
			/envelope must equal/,
		],
		[
			"another owner",
			"mid",
			(o) => {
				execution(o).ownerId = "owner-2";
			},
			/envelope must equal/,
		],
		[
			"another project revision",
			"mid",
			(o) => {
				execution(o).projectRevision += 1;
			},
			/envelope must equal/,
		],
		[
			"another Run",
			"mid",
			(o) => {
				execution(o).runId = "run-2";
			},
			/envelope must equal/,
		],
		[
			"unknown PENDING tokens",
			"created",
			(o) => {
				execution(o).tasks[1].reportedTokens = null;
			},
			/PENDING/,
		],
		[
			"a PENDING row with an attempt",
			"created",
			(o) => {
				execution(o).tasks[0].attempt = 1;
			},
			/PENDING/,
		],
		[
			"an attempt that skips revisionCycle + 1",
			"done",
			(o) => {
				execution(o).tasks[0].attempt = 2;
			},
			/revisionCycle \+ 1/,
		],
		[
			"unsorted changed files",
			"done",
			(o) => {
				execution(o).tasks[0].changedFiles = ["src/z.ts", "src/app.ts"];
			},
			/unique ascending/,
		],
		[
			"a changed file outside the task claims",
			"done",
			(o) => {
				execution(o).tasks[0].changedFiles = ["src/other.ts"];
			},
			/outside the task claims/,
		],
		[
			"a noncanonical changed path",
			"done",
			(o) => {
				execution(o).tasks[0].changedFiles = ["src/../x.ts"];
			},
			/invalid item/,
		],
		[
			"a parent completed before the Run",
			"mid",
			(o) => {
				execution(o).parent.status = "completed";
			},
			/parent completed/,
		],
		[
			"a tampered parent",
			"mid",
			(o) => {
				execution(o).parent.goal += "!";
			},
			/another parent digest/,
		],
		[
			"a tampered plan",
			"mid",
			(o) => {
				execution(o).plan.tasks[0].title = "Edited";
			},
			/does not recompute/,
		],
		[
			"TERMINAL while the Run runs",
			"mid",
			(o) => {
				execution(o).phase = "TERMINAL";
			},
			/phase TERMINAL iff/,
		],
		[
			"two active rows",
			"mid",
			(o) => {
				execution(o).tasks[0].status = "TEST";
			},
			/at most one active row/,
		],
		[
			"a wrong active task",
			"mid",
			(o) => {
				execution(o).activeTaskId = "CT-001";
			},
			/activeTaskId/,
		],
		[
			"an Approval wait while the Run runs",
			"mid",
			(o) => {
				execution(o).tasks[1].status = "WAITING_APPROVAL";
			},
			/waits for Approval/,
		],
		[
			"integration during the task sequence",
			"mid",
			(o) => {
				execution(o).integration.check = "PASS";
			},
			/during the task sequence/,
		],
		[
			"UNKNOWN budget with known tokens",
			"mid",
			(o) => {
				execution(o).budget.status = "UNKNOWN";
			},
			/UNKNOWN iff/,
		],
		[
			"tokens at the cap within limits",
			"mid",
			(o) => {
				execution(o).budget.reportedTokens = execution(o).plan.limits.maxReportedTokens;
			},
			/must be EXHAUSTED/,
		],
		[
			"an unattributed invocation beyond the final Reviewer",
			"mid",
			(o) => {
				execution(o).budget.workerInvocations += 2;
			},
			/global ledger/,
		],
		[
			"revision cycles that do not sum",
			"mid",
			(o) => {
				execution(o).budget.totalRevisionCycles = 1;
			},
			/must sum/,
		],
		[
			"a clean terminal outcome without confirmed cleanup",
			"done",
			(o) => {
				execution(o).cleanup = "PENDING";
			},
			/CONFIRMED/,
		],
		[
			"completion without current integration evidence",
			"done",
			(o) => {
				execution(o).integration.evidenceFreshness = "STALE";
			},
			/Run COMPLETED without/,
		],
		[
			"a COMPLETED row without its review PASS",
			"done",
			(o) => {
				execution(o).tasks[0].review = "REVISE";
			},
			/COMPLETED without PASS/,
		],
		[
			"a RUNNING gate at TERMINAL",
			"done",
			(o) => {
				execution(o).integration.test = "RUNNING";
			},
			/RUNNING gate/,
		],
		[
			"a graph of another revision",
			"mid",
			(o) => {
				o.state.snapshot.graph!.stateRevision += 1;
			},
			/graph identity/,
		],
		[
			"a response envelope of another revision",
			"mid",
			(o) => {
				o.response!.stateRevision = (o.response!.stateRevision ?? 0) + 1;
			},
			/envelope must match/,
		],
	];
	it.each(single)("rejects %s", async (_name, base, mutate, expected) => {
		const runs = await completedTwoTaskRun();
		const observation = observe(runs[base]);
		expect(complexConsumerIssues(observation)).toEqual([]);
		mutate(observation);
		expect(complexConsumerIssues(observation).join("\n")).toMatch(expected);
	});

	it("accepts a replacement Run without merging, and rejects every inconsistent transition of one Run", async () => {
		const { mid, done } = await completedTwoTaskRun();
		const before = observe(mid);
		const after = observe(done);
		expect(complexConsumerIssues(after, before)).toEqual([]);
		// Equal state is observed again without advancing anything.
		expect(complexConsumerIssues(observe(done), after)).toEqual([]);
		// A new Run replaces the projection, even at a lower durable revision.
		const replacement = observe(mid);
		for (const target of [
			replacement.state.snapshot.status.run!,
			execution(replacement),
			replacement.state.snapshot.graph!,
			replacement.state.snapshot.evidence!,
		])
			target.runId = "run-2";
		replacement.response!.runId = "run-2";
		expect(complexConsumerIssues(replacement, after)).toEqual([]);
		const unknownUsage = structuredClone(before);
		execution(unknownUsage).budget.reportedTokens = null;
		execution(unknownUsage).budget.status = "UNKNOWN";
		const later = execution(after).stateRevision + 1;
		// [name, previous accepted observation, next observation, mutation of next, expected rejection]
		const transitions: Array<
			[string, ComplexObservation, ComplexObservation, (next: ComplexObservation) => void, RegExp]
		> = [
			[
				"changed data at the same stateRevision",
				before,
				structuredClone(before),
				(o) => {
					execution(o).tasks[0].evidenceFreshness = "STALE";
				},
				/same stateRevision/,
			],
			["a phase regression", after, atRevision(before, later), () => {}, /phase regressed/],
			[
				"decreasing reported tokens",
				before,
				atRevision(before, later),
				(o) => {
					execution(o).budget.reportedTokens = (execution(o).budget.reportedTokens ?? 1) - 1;
				},
				/tokens decreased/,
			],
			[
				"unknown usage becoming known",
				unknownUsage,
				atRevision(before, later),
				() => {},
				/unknown usage became known/,
			],
			[
				"a PENDING re-entry",
				before,
				atRevision(before, later),
				(o) => {
					const value = execution(o);
					value.tasks[1] = { ...structuredClone(value.tasks[1]), status: "PENDING" };
					value.activeTaskId = null;
				},
				/re-entered PENDING/,
			],
			[
				"a changed plan",
				before,
				atRevision(before, later),
				(o) => {
					execution(o).plan.tasks[1].goal = "Another contribution";
				},
				/plan changed/,
			],
			[
				"a finished row changing status",
				after,
				atRevision(after, later),
				(o) => {
					Object.assign(execution(o).tasks[0], { status: "BLOCKED", failureCode: "CHECK_FAILED" });
				},
				/finished row changed status/,
			],
			[
				"a changed terminal failure code",
				after,
				atRevision(after, later),
				(o) => {
					execution(o).failureCode = "CHECK_FAILED";
				},
				/TERMINAL failure code/,
			],
			[
				"a terminal Run changing its outcome",
				after,
				atRevision(after, later),
				(o) => {
					o.state.snapshot.status.run!.status = "BLOCKED";
				},
				/terminal Run changed its outcome/,
			],
		];
		for (const [name, previous, next, mutate, expected] of transitions) {
			mutate(next);
			expect(complexConsumerIssues(next, previous).join("\n"), name).toMatch(expected);
		}
	});
});

describe("COMPLEX preview restatement (#16 stage C)", () => {
	const preview = (): HostControlPreview => ({
		previewId: "preview-1",
		previewDigest: `sha256:${"a".repeat(64)}`,
		ownerId: "owner-1",
		projectRevision: 4,
		expiresAt: 1,
		goal: fixture.preview.goal,
		workflow: "COMPLEX",
		executionMode: "EDIT",
		risk: "R1",
		allowedPaths: structuredClone(fixture.preview.allowedPaths),
		checks: structuredClone(fixture.preview.checks),
		acceptanceCriteria: structuredClone(fixture.preview.acceptanceCriteria),
		taskContractDigest: fixture.preview.taskContractDigest,
		recipe: null,
		configuration: {
			mutationMode: "compatible",
			verifierTrustMode: "compatible",
			verifierSandboxMode: "disabled",
			contextPackMode: "disabled",
			verificationRepairMode: "disabled",
			lspEnabled: false,
		},
		complexPlan: structuredClone(fixture.plan),
	});
	type Echo = { ownerId: string; expectedProjectRevision: number; complexDraft?: unknown };
	const request: Echo = { ownerId: "owner-1", expectedProjectRevision: 4, complexDraft: {} };

	it("accepts the reference preview and the prepare echo", () => {
		expect(complexPreviewIssues(preview(), request)).toEqual([]);
	});

	it.each<[string, (value: HostControlPreview) => void, RegExp, Echo]>([
		[
			"a recipe on a COMPLEX preview",
			(value) => {
				value.recipe = { id: "bugfix", version: 1, digest: value.previewDigest };
			},
			/no recipe/,
			request,
		],
		[
			"claims on a READ_ONLY plan",
			(value) => {
				value.executionMode = "READ_ONLY";
			},
			/READ_ONLY plans claim no files/,
			request,
		],
		[
			"integration checks that are not every preview check",
			(value) => {
				value.checks.pop();
			},
			/every preview check ID/,
			request,
		],
		[
			"a parent that does not recompute",
			(value) => {
				value.goal = "Another goal";
			},
			/parent does not recompute/,
			request,
		],
		[
			"a plan without the COMPLEX workflow",
			(value) => {
				value.workflow = "STANDARD";
			},
			/required iff COMPLEX/,
			request,
		],
		[
			"a COMPLEX preview without its plan",
			(value) => {
				delete value.complexPlan;
			},
			/required iff COMPLEX/,
			request,
		],
		[
			"another owner",
			(value) => {
				value.ownerId = "owner-2";
			},
			/echo the request ownerId/,
			request,
		],
		[
			"another project revision",
			(value) => {
				value.projectRevision = 5;
			},
			/echo expectedProjectRevision/,
			request,
		],
		[
			"a COMPLEX preview for a request without a draft",
			() => {},
			/never downgraded/,
			{ ownerId: "owner-1", expectedProjectRevision: 4 },
		],
	])("rejects %s", (_name, mutate, expected, echo) => {
		const value = preview();
		mutate(value);
		expect(complexPreviewIssues(value, echo).join("\n")).toMatch(expected);
	});
});
