import { afterEach, describe, expect, it } from "vitest";
import { type ComplexPathFact, compileComplexPlan } from "../src/complex-plan.ts";
import {
	boundLeftovers,
	codePointPrefix,
	deriveRerunDraft,
	type RerunSource,
	rerunFactPaths,
	rerunSource,
} from "../src/complex-rerun.ts";
import type { Run } from "../src/contracts.ts";
import {
	RERUN_LEFTOVER_MAX_BYTES,
	RERUN_LEFTOVER_MAX_PATHS,
	RERUN_MAX_NOTES,
	RERUN_NOTE_MAX_BYTES,
} from "../src/host-control-protocol.ts";
import { buildTaskContract } from "../src/task-contract.ts";
import { cleanStartBlockers } from "../src/workspace.ts";
import {
	type ComplexTaskSpec,
	complexConfig,
	complexHarness,
	complexPlanFor,
	driveComplex,
	FakeFiles,
	takeConsumerIssues,
} from "./complex-fixture.ts";

// V0.8C derivation (COMPLEX_RERUN.md §3–§5) as pure functions over durable Kernel Runs; no disk, Git or model.
afterEach(() => {
	expect(takeConsumerIssues()).toEqual([]);
});

type Harness = ReturnType<typeof complexHarness>;
/** The task's one selected check fails at SELF_CHECK: the task and the Run end BLOCKED/CHECK_FAILED. */
function failCheck(h: Harness, taskId: string): void {
	const verify = h.ports.verifier.verify;
	h.ports.verifier.verify = async (request) => {
		const result = await verify(request);
		if (request.complexContext?.taskId === taskId)
			result.checks[0] = { ...result.checks[0], status: "FAIL", exitCode: 1, reason: "Fake check failed" };
		return result;
	};
}
const INITIAL = { "src/app.ts": "app\n", "src/util.ts": "util\n", "src/gone.ts": "gone\n" };
/** CT-001 COMPLETED; CT-002 BLOCKED by its check after writing every claim; CT-003 never started. */
const THREE_TASKS: ComplexTaskSpec[] = [
	{ claims: [{ path: "src/app.ts", operation: "modify" }], criteria: [1], dependsOn: [] },
	{
		claims: [
			{ path: "src/new.ts", operation: "create" },
			{ path: "src/made.ts", operation: "create" },
			{ path: "src/util.ts", operation: "modify" },
			{ path: "src/gone.ts", operation: "modify" },
		],
		criteria: [1, 2],
		dependsOn: [1],
	},
	{ claims: [], criteria: [2], dependsOn: [1, 2] },
];
async function blocked(specs: ComplexTaskSpec[] = THREE_TASKS, failing = "CT-002") {
	const files = new FakeFiles(INITIAL);
	const { plan, parent } = await complexPlanFor(specs, { files });
	const h = complexHarness({ plan, parent, files });
	failCheck(h, failing);
	const run = await driveComplex(await h.create());
	expect(h.invariantErrors).toEqual([]);
	return run;
}
function source(run: Run): RerunSource {
	const value = rerunSource(run);
	if (!value) throw new Error(`not derivable: ${run.status}`);
	return value;
}
function fact(path: string, kind: ComplexPathFact["kind"], overrides: Partial<ComplexPathFact> = {}): ComplexPathFact {
	return {
		path,
		safe: true,
		kind,
		exactSpelling: true,
		text: kind === "file",
		parentDirectory: kind === "missing",
		...overrides,
	};
}

describe("§3 rows 2–5: the durable source", () => {
	it("derives from BLOCKED, CANCELLED, FAILED and INTERRUPTED COMPLEX Runs with an unfinished row", async () => {
		const run = await blocked();
		expect(run.complex?.tasks.map((row) => row.status)).toEqual(["COMPLETED", "BLOCKED", "BLOCKED"]);
		for (const status of ["BLOCKED", "CANCELLED", "FAILED", "INTERRUPTED"] as const)
			expect(rerunSource({ ...run, status })).toMatchObject({
				runId: run.runId,
				status,
				parent: run.tasks[0],
				state: run.complex,
			});
	});

	it.each<[string, (run: Run) => Run]>([
		["a STANDARD Run", (run) => ({ ...run, workflow: "STANDARD" })],
		["a COMPLEX Run without a Host-confirmed plan", (run) => ({ ...run, complex: undefined })],
		["a COMPLEX Run with more than its parent", (run) => ({ ...run, tasks: [run.tasks[0], run.tasks[0]] })],
		["a COMPLETED Run", (run) => ({ ...run, status: "COMPLETED" })],
		["a CREATED Run", (run) => ({ ...run, status: "CREATED" })],
		["a RUNNING Run", (run) => ({ ...run, status: "RUNNING" })],
		["a Run waiting for Approval", (run) => ({ ...run, status: "WAITING_APPROVAL" })],
		[
			"a Run whose every row is COMPLETED",
			(run) => ({
				...run,
				complex: run.complex && {
					...run.complex,
					tasks: run.complex.tasks.map((row) => ({ ...row, status: "COMPLETED" as const })),
				},
			}),
		],
		["an R3 Run", (run) => ({ ...run, risk: "R3" })],
	])("never derives %s", async (_name, change) => {
		expect(rerunSource(change(await blocked()))).toBeUndefined();
	});
});

describe("§4 derivation", () => {
	it("lists completed rows' changed files and every other row's claims, once, in plan order", async () => {
		const derivable = source(await blocked());
		expect(derivable.state.tasks[0].changedFiles).toEqual(["src/app.ts"]);
		expect(rerunFactPaths(derivable)).toEqual([
			"src/app.ts",
			"src/gone.ts",
			"src/made.ts",
			"src/new.ts",
			"src/util.ts",
		]);
	});

	it("maps every row and claim of the §4 tables, keeps graph and indexes, and notes only fixed templates", async () => {
		const run = await blocked();
		const before = JSON.stringify(run);
		const derivable = source(run);
		const derived = deriveRerunDraft(derivable, [
			fact("src/app.ts", "file"),
			fact("src/gone.ts", "missing"),
			fact("src/made.ts", "file"),
			fact("src/new.ts", "missing"),
			fact("src/util.ts", "file"),
		]);
		const parent = derivable.parent;
		expect(derived.goal).toBe(parent.goal);
		expect(derived.acceptanceStatements).toEqual(["Parsing is modular", "Duplicate keys are rejected"]);
		expect(parent.acceptanceCriteria.map((criterion) => criterion.id)).toEqual(["AC-001", "AC-002"]);
		expect(derived.draft).toEqual({
			tasks: [
				// COMPLETED: a read-only verification task with the same criteria, checks and dependencies.
				{
					title: "Verify: Task 1",
					goal: "Re-verify without changes: Contribution 1",
					dependsOnIndexes: [],
					criterionIndexes: [1],
					ownership: [],
					checkIds: ["test"],
				},
				// BLOCKED: the same task; create → modify only where a regular file now exists.
				{
					title: "Task 2",
					goal: "Contribution 2",
					dependsOnIndexes: [1],
					criterionIndexes: [1, 2],
					ownership: [
						{ path: "src/gone.ts", operation: "modify" },
						{ path: "src/made.ts", operation: "modify" },
						{ path: "src/new.ts", operation: "create" },
						{ path: "src/util.ts", operation: "modify" },
					],
					checkIds: ["test"],
				},
				// Never started (BLOCKED/DEPENDENCY_NOT_COMPLETED): unchanged, both dependencies kept 1-based.
				{
					title: "Task 3",
					goal: "Contribution 3",
					dependsOnIndexes: [1, 2],
					criterionIndexes: [2],
					ownership: [],
					checkIds: ["test"],
				},
			],
		});
		expect(derived.notes).toEqual([
			"CT-002 claim src/gone.ts: modify target is missing",
			"CT-002 claim src/made.ts: create became modify (file exists)",
		]);
		// The source is only read.
		expect(JSON.stringify(run)).toBe(before);
	});

	it("maps a FAILED row like every other unfinished row: same task, claims re-evaluated", async () => {
		const files = new FakeFiles(INITIAL);
		const specs: ComplexTaskSpec[] = [
			{ claims: [{ path: "src/app.ts", operation: "modify" }] },
			{ claims: [{ path: "src/new.ts", operation: "create" }] },
		];
		const { plan, parent } = await complexPlanFor(specs, { files });
		const h = complexHarness({ plan, parent, files });
		// CT-002's Developer writes its file, then its tool I/O fails: the task and the Run are FAILED.
		h.ports.agents.execute = async (request) => {
			if (request.role !== "Developer" || request.complexContext?.taskId !== "CT-002")
				return h.defaultExecute(request);
			h.calls.push(request);
			await h.register(request);
			await h.develop(request);
			throw new Error("tool I/O failed after a permitted effect");
		};
		const run = await driveComplex(await h.create());
		expect(h.invariantErrors).toEqual([]);
		expect([run.status, run.complex?.tasks.map((row) => [row.status, row.changedFiles])]).toEqual([
			"FAILED",
			[
				["COMPLETED", ["src/app.ts"]],
				["FAILED", ["src/new.ts"]],
			],
		]);
		const derived = deriveRerunDraft(source(run), [fact("src/app.ts", "file"), fact("src/new.ts", "file")]);
		expect(derived.draft.tasks[1]).toEqual({
			title: "Task 2",
			goal: "Contribution 2",
			dependsOnIndexes: [1],
			criterionIndexes: [1, 2],
			ownership: [{ path: "src/new.ts", operation: "modify" }],
			checkIds: ["test"],
		});
		expect(derived.notes).toEqual(["CT-002 claim src/new.ts: create became modify (file exists)"]);
	});

	it("notes completed files that no longer exist; the verification task still claims nothing", async () => {
		const derivable = source(await blocked());
		const derived = deriveRerunDraft(derivable, [
			fact("src/app.ts", "missing"),
			fact("src/gone.ts", "file"),
			fact("src/made.ts", "missing"),
			fact("src/new.ts", "missing"),
			fact("src/util.ts", "file"),
		]);
		expect(derived.notes).toEqual([
			"CT-001 completed files missing: src/app.ts; a verification task cannot recreate them",
		]);
		expect(derived.draft.tasks[0].ownership).toEqual([]);
		expect(derived.draft.tasks[1].ownership.map((claim) => claim.operation)).toEqual([
			"modify",
			"create",
			"create",
			"modify",
		]);
	});

	it("changes a claim only on positive evidence of a regular file; anything else keeps the source claim", async () => {
		const derivable = source(await blocked());
		const derived = deriveRerunDraft(derivable, [
			// A directory, an unsafe path, a case alias and an unknown fact are never "a regular file".
			fact("src/app.ts", "directory"),
			fact("src/made.ts", "missing", { safe: false }),
			fact("src/new.ts", "file", { exactSpelling: false }),
			fact("src/util.ts", "directory"),
		]);
		expect(derived.draft.tasks[1].ownership).toEqual([
			{ path: "src/gone.ts", operation: "modify" },
			{ path: "src/made.ts", operation: "create" },
			{ path: "src/new.ts", operation: "create" },
			{ path: "src/util.ts", operation: "modify" },
		]);
		expect(derived.notes).toEqual([
			"CT-001 completed files missing: src/app.ts; a verification task cannot recreate them",
			"CT-002 claim src/gone.ts: modify target is missing",
			"CT-002 claim src/util.ts: modify target is missing",
		]);
	});

	it("cuts verification titles to 80 and goals to 300 UTF-16 characters, never inside a code point", async () => {
		const run = await blocked();
		const derivable = source(run);
		const astral = "\u{1F600}";
		// "Verify: " is 8 characters: 71 + 8 = 79, so the pair at 80–81 does not fit and is dropped whole.
		derivable.state.plan.tasks[0].title = `${"t".repeat(71)}${astral}tail`;
		// "Re-verify without changes: " is 27 characters: 272 + 27 = 299.
		derivable.state.plan.tasks[0].goal = `${"g".repeat(272)}${astral}rest`;
		const [verification] = deriveRerunDraft(derivable, [fact("src/app.ts", "file")]).draft.tasks;
		expect(verification.title).toBe(`Verify: ${"t".repeat(71)}`);
		expect(verification.title).toHaveLength(79);
		expect(verification.goal).toBe(`Re-verify without changes: ${"g".repeat(272)}`);
		expect(verification.goal).toHaveLength(299);
		// With room for the whole pair it stays, and the cut lands exactly on the bound.
		derivable.state.plan.tasks[0].title = `${"t".repeat(70)}${astral}tail`;
		expect(deriveRerunDraft(derivable, []).draft.tasks[0].title).toBe(`Verify: ${"t".repeat(70)}${astral}`);
		expect(deriveRerunDraft(derivable, []).draft.tasks[0].title).toHaveLength(80);
		// Short text is not cut.
		derivable.state.plan.tasks[0].title = "Parse";
		expect(deriveRerunDraft(derivable, []).draft.tasks[0].title).toBe("Verify: Parse");
		// A re-run of a re-run: an already prefixed verification task keeps each prefix once.
		derivable.state.plan.tasks[0].title = "Verify: Parse";
		derivable.state.plan.tasks[0].goal = "Re-verify without changes: Create src/parse.mjs";
		expect(deriveRerunDraft(derivable, []).draft.tasks[0]).toMatchObject({
			title: "Verify: Parse",
			goal: "Re-verify without changes: Create src/parse.mjs",
		});
		// Unfinished rows keep their title and goal exactly.
		expect(deriveRerunDraft(derivable, []).draft.tasks[1]).toMatchObject({ title: "Task 2", goal: "Contribution 2" });
	});

	it("bounds notes: at most 16 of at most 200 UTF-8 bytes, cut on a code point and never silently", async () => {
		const long = `src/${"é".repeat(120)}.ts`;
		const claims = Array.from({ length: 16 }, (_, index) => ({
			path: `src/c${String(index).padStart(2, "0")}.ts`,
			operation: "create" as const,
		}));
		const files = new FakeFiles({ ...INITIAL, [long]: "x\n" });
		const specs: ComplexTaskSpec[] = [
			{ claims: [{ path: long, operation: "modify" }], criteria: [1, 2], dependsOn: [] },
			{ claims, criteria: [1, 2], dependsOn: [1] },
		];
		const { plan, parent } = await complexPlanFor(specs, { files });
		const h = complexHarness({ plan, parent, files });
		failCheck(h, "CT-002");
		const derivable = source(await driveComplex(await h.create()));
		const derived = deriveRerunDraft(derivable, [
			fact(long, "missing"),
			...claims.map((claim) => fact(claim.path, "file")),
		]);
		expect(derived.notes).toHaveLength(RERUN_MAX_NOTES);
		for (const note of derived.notes)
			expect(Buffer.byteLength(note, "utf8")).toBeLessThanOrEqual(RERUN_NOTE_MAX_BYTES);
		// 17 notes: the first 15 and the count of the rest.
		expect(derived.notes.at(-1)).toBe("2 more notes omitted");
		expect(derived.notes[1]).toBe("CT-002 claim src/c00.ts: create became modify (file exists)");
		const [first] = derived.notes;
		expect(first.startsWith("CT-001 completed files missing: src/é")).toBe(true);
		expect(first.endsWith("…")).toBe(true);
		expect(Buffer.byteLength(first, "utf8")).toBeGreaterThan(RERUN_NOTE_MAX_BYTES - 2);
		expect(first).not.toContain("�");
	});

	it("is byte-identical for the same source and facts", async () => {
		const derivable = source(await blocked());
		const facts = [fact("src/app.ts", "file"), fact("src/made.ts", "file"), fact("src/new.ts", "missing")];
		const first = JSON.stringify(deriveRerunDraft(derivable, facts));
		expect(JSON.stringify(deriveRerunDraft(structuredClone(derivable), structuredClone(facts)))).toBe(first);
	});

	it("a Run of a derived draft starts with no evidence; the verification task runs fresh and changes nothing", async () => {
		const derivable = source(await blocked());
		const derived = deriveRerunDraft(derivable, [
			fact("src/app.ts", "file"),
			fact("src/gone.ts", "file"),
			fact("src/made.ts", "missing"),
			fact("src/new.ts", "missing"),
			fact("src/util.ts", "file"),
		]);
		const config = complexConfig();
		// A new prepare: a new parent and plan identity from the same goal and statements.
		const parent = buildTaskContract({
			goal: derived.goal,
			statements: derived.acceptanceStatements,
			workflow: "COMPLEX",
			config,
		});
		const files = new FakeFiles({ "src/app.ts": "CT-001@1\n", "src/util.ts": "util\n", "src/gone.ts": "gone\n" });
		const plan = await compileComplexPlan({
			planId: "00000000-0000-4000-8000-000000000002",
			parent,
			draft: derived.draft,
			config,
			executionMode: "EDIT",
			risk: "R1",
			claims: {
				inspect: async (paths) => ({
					facts: paths.map((path) => fact(path, files.files.has(path) ? "file" : "missing")),
					protectedPaths: [],
				}),
			},
		});
		expect(parent.id).not.toBe(derivable.parent.id);
		expect(plan.parentTaskContractDigest).not.toBe(derivable.state.plan.parentTaskContractDigest);
		expect(plan.complexPlanDigest).not.toBe(derivable.state.plan.complexPlanDigest);
		const h = complexHarness({ plan, parent, files });
		const run = await driveComplex(await h.create({ runId: "run-2" }));
		expect(h.invariantErrors).toEqual([]);
		expect(run.status, run.lastError ?? "").toBe("COMPLETED");
		// No gate starts PASS: the first durable save has every row PENDING with nothing run and no evidence.
		expect(h.saved[0].complex?.tasks.map((row) => [row.status, row.selfCheck, row.review, row.test])).toEqual([
			["PENDING", "NOT_RUN", "NOT_RUN", "NOT_RUN"],
			["PENDING", "NOT_RUN", "NOT_RUN", "NOT_RUN"],
			["PENDING", "NOT_RUN", "NOT_RUN", "NOT_RUN"],
		]);
		expect(h.saved[0].verification).toEqual([]);
		// The verification task ran its own Developer, self-check, contribution review and test in the new context.
		const verification = h.calls.filter((request) => request.complexContext?.taskId === "CT-001");
		expect(verification.map((request) => request.role)).toEqual(["Developer", "Reviewer"]);
		expect(
			verification.every((request) => request.complexContext?.complexPlanDigest === plan.complexPlanDigest),
		).toBe(true);
		expect(
			run.verification
				.filter((check) => check.complexContext?.taskId === "CT-001")
				.map((check) => check.step?.stepId),
		).toEqual(["self-check", "test"]);
		expect(run.complex?.tasks[0]).toMatchObject({ status: "COMPLETED", changedFiles: [] });
		// Nothing refers to the source Run.
		expect(JSON.stringify(run)).not.toContain(derivable.runId);
		expect(JSON.stringify(run)).not.toContain(derivable.state.plan.complexPlanDigest);
	});
});

describe("§5 leftovers", () => {
	it("parses the clean-start status: every entry, both names of a rename, minus Runtime-owned and generated paths", () => {
		const status = [
			" M src/app.ts",
			"?? src/new.ts",
			"R  src/renamed.ts",
			"src/original.ts",
			"C  src/copy.ts",
			"src/source.ts",
			" D src/deleted.ts",
			"?? .ai/state.json",
			"?? .ai/tasks.json",
			"?? .ai/writer.lock",
			"?? .ai/writer.lock.recovery",
			"?? .ai/runs/run-1.json",
			"?? .ai/decisions.md",
			"?? .ai/logs/checks.json",
			"?? .ai/notes.md",
			"?? src/app.ts",
			"",
		].join("\0");
		expect(cleanStartBlockers(status, new Set([".ai/decisions.md"]))).toEqual([
			".ai/logs/checks.json",
			".ai/notes.md",
			"src/app.ts",
			"src/copy.ts",
			"src/deleted.ts",
			"src/new.ts",
			"src/original.ts",
			"src/renamed.ts",
			"src/source.ts",
		]);
		expect(cleanStartBlockers("", new Set())).toEqual([]);
		expect(cleanStartBlockers(["?? .ai/state.json", "?? .ai/runs/old.json", ""].join("\0"), new Set())).toEqual([]);
	});

	it("is unknown, never clean, when Git could not answer or its answer cannot be named", () => {
		const unknown = { clean: null, paths: [], truncated: false };
		expect(boundLeftovers(null)).toEqual(unknown);
		// A dirty answer always names a path: an empty name (never printed by Git) or a first name over the whole
		// byte bound cannot be listed, so the state is reported unknown rather than dirty without a name.
		expect(boundLeftovers(["src/a.ts", ""])).toEqual(unknown);
		expect(boundLeftovers(["b".repeat(RERUN_LEFTOVER_MAX_BYTES + 1)])).toEqual(unknown);
		expect(boundLeftovers(["a", "b".repeat(RERUN_LEFTOVER_MAX_BYTES + 1)])).toEqual({
			clean: false,
			paths: ["a"],
			truncated: true,
		});
		expect(boundLeftovers([])).toEqual({ clean: true, paths: [], truncated: false });
		expect(boundLeftovers(["src/b.ts", "src/a.ts", "src/b.ts"])).toEqual({
			clean: false,
			paths: ["src/a.ts", "src/b.ts"],
			truncated: false,
		});
	});

	it("keeps at most 200 sorted paths", () => {
		const paths = Array.from(
			{ length: RERUN_LEFTOVER_MAX_PATHS + 1 },
			(_, index) => `f${String(index).padStart(3, "0")}`,
		);
		expect(boundLeftovers(paths.slice(0, RERUN_LEFTOVER_MAX_PATHS))).toMatchObject({
			clean: false,
			truncated: false,
		});
		const bounded = boundLeftovers([...paths].reverse());
		expect(bounded).toEqual({ clean: false, paths: paths.slice(0, RERUN_LEFTOVER_MAX_PATHS), truncated: true });
	});

	it("keeps at most 16,384 UTF-8 bytes of names, cut at the first name that does not fit", () => {
		// 64 names of 256 bytes each (2-byte characters) are exactly 16,384 bytes.
		const names = Array.from({ length: 64 }, (_, index) => `${String(index).padStart(2, "0")}${"é".repeat(127)}`);
		expect(names.every((name) => Buffer.byteLength(name, "utf8") === 256)).toBe(true);
		expect(boundLeftovers(names)).toEqual({ clean: false, paths: names, truncated: false });
		const over = boundLeftovers([...names, "zz"]);
		expect(over).toEqual({ clean: false, paths: names, truncated: true });
		expect(over.paths.reduce((total, name) => total + Buffer.byteLength(name, "utf8"), 0)).toBe(
			RERUN_LEFTOVER_MAX_BYTES,
		);
		// A long name that does not fit ends the list, even if shorter names follow it in order.
		expect(boundLeftovers(["a", "b".repeat(RERUN_LEFTOVER_MAX_BYTES), "c"])).toEqual({
			clean: false,
			paths: ["a"],
			truncated: true,
		});
	});

	it("cuts on code points within the UTF-16 bound", () => {
		expect(codePointPrefix("abcdef", 4)).toBe("abcd");
		expect(codePointPrefix("ab\u{1F600}c", 3)).toBe("ab");
		expect(codePointPrefix("ab\u{1F600}c", 4)).toBe("ab\u{1F600}");
		expect(codePointPrefix("abc", 80)).toBe("abc");
		expect(codePointPrefix("", 5)).toBe("");
	});
});
