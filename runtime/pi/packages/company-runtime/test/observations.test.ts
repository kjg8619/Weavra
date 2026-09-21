import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "../src/config.ts";
import type { Run } from "../src/contracts.ts";
import { taskContractDigest } from "../src/criterion-evidence.ts";
import {
	decisionEntries,
	displayText,
	formatConfiguration,
	formatHistory,
	formatRunView,
	type ObservationState,
	pageNumber,
} from "../src/observations.ts";
import { FileStateStore } from "../src/state-store.ts";
import { testContract } from "./fixture-contract.ts";

function run(): Run {
	return {
		schemaVersion: 1,
		revision: 1,
		eventSequence: 0,
		currentStep: { stepId: "complete", attempt: 2 },
		runId: "run",
		goal: "Fix bug",
		status: "COMPLETED",
		phase: "COMPLETE",
		workflow: "STANDARD",
		classification: {
			intent: "bugfix",
			complexity: "STANDARD",
			risk: "R1",
			confidence: null,
			reason: "Ordinary change",
		},
		risk: "R1",
		currentTask: "task",
		tasks: [
			testContract("Fix bug", {
				taskId: "task",
				statements: ["Fix bug"],
				checkIds: ["check"],
			}),
		],
		taskContractDigest: taskContractDigest(
			testContract("Fix bug", { taskId: "task", statements: ["Fix bug"], checkIds: ["check"] }),
		),
		acceptance: [
			{
				criterionId: "AC-001",
				status: "MET",
				evidenceRefs: ["diff"],
				revision: 1,
				diffDigest: "digest",
			},
		],
		activeAgents: [],
		completed: ["task"],
		next: [],
		roleSessionRefs: [
			{ role: "Developer", sessionId: "dev", sessionFile: "/sessions/dev" },
			{ role: "Reviewer", sessionId: "review", sessionFile: "/sessions/review" },
		],
		revisionCycle: 1,
		maxRevisionCycles: 3,
		workspace: { safe: true, diffDigest: "digest", changedFiles: ["src/app.ts"], evidenceRefs: ["diff"] },
		verification: [
			{
				id: "check",
				runId: "run",
				revision: 1,
				kind: "test",
				required: true,
				status: "PASS",
				exitCode: 0,
				reason: "Executed",
				evidenceRefs: ["check-ref"],
				diffDigest: "digest",
				step: { stepId: "test", attempt: 2 },
				startedAt: 1000,
				finishedAt: 2000,
				stdout: "OUT\n",
				stderr: "",
			},
		],
		lastError: null,
		createdAt: 1000,
		updatedAt: 2000,
	};
}
function source(): ObservationState {
	return { revision: 2, runs: [run()], actions: [] };
}
const directories: string[] = [];
afterEach(async () => {
	for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function directory() {
	const path = await mkdtemp(join(tmpdir(), "runtime-observations-"));
	directories.push(path);
	return path;
}

describe("pure bounded command views", () => {
	it.each(["state", "workflow", "team", "risk"] as const)(
		"%s shows source/status without promoting recorded evidence to live checks",
		(command) => {
			const state = source();
			const before = structuredClone(state);
			const output = formatRunView(command, { run: state.runs[0], state, source: "stored snapshot" });
			expect(output).toContain("Source: stored snapshot; no live filesystem/check refresh");
			expect(output).toContain("Status: COMPLETED");
			expect(output).toContain("Workflow: STANDARD");
			expect(state).toEqual(before);
		},
	);
	it("has role-specific session details without opening Pi transcripts", () => {
		expect(formatRunView("team", { run: run(), source: "stored" })).toContain("dev → /sessions/dev");
	});
	it("distinguishes check stage/attempt, actual output and absent older metadata", () => {
		const state = source();
		expect(formatRunView("state", { run: state.runs[0], state, source: "stored" }, "checks")).toContain("test@2");
		const detail = formatRunView("state", { run: state.runs[0], source: "stored" }, "check", 1);
		expect(detail).toContain("stdout:\nOUT\n");
		expect(detail).toContain("Evidence: check-ref");
		expect(detail).toContain("exit 0");
		const old = run();
		delete old.verification[0].step;
		expect(formatRunView("state", { run: old, source: "stored" }, "checks")).toContain("step not recorded");
	});
	it.each(["0", "-1", "1.2", "abc", "1000000"])("rejects invalid page/check selector %s", (value) => {
		expect(() => pageNumber(value)).toThrow();
	});
	it("rejects unknown pages and check numbers instead of falling back to latest", () => {
		expect(() => formatHistory(source(), 2)).toThrow("range");
		expect(() => formatRunView("state", { run: run(), source: "stored" }, "check", 2)).toThrow("range");
	});
	it("paginates history in reverse creation order", () => {
		const state = source();
		state.runs = Array.from({ length: 13 }, (_, index) => ({ ...run(), runId: `run-${index}` }));
		const first = formatHistory(state);
		const second = formatHistory(state, 2);
		expect(first).toContain("Page 1/2");
		expect(first.indexOf("run-12")).toBeLessThan(first.indexOf("run-11"));
		expect(first).not.toContain("run-0 |");
		expect(second).toContain("run-0 |");
	});
	it("retains stable IDs for classification/review/approval/policy/outcome projections", () => {
		const state = source();
		const value = state.runs[0];
		value.reviewHistory = [0, 1].map((revision) => ({
			runId: value.runId,
			revision,
			role: "Reviewer",
			task: "task",
			result: revision === 0 ? "REVISE" : "PASS",
			issues: [],
			criteria: [{ criterionId: "AC-001", status: "MET", evidenceRefs: ["diff"] }],
			evidenceRefs: ["diff"],
			diffDigest: "digest",
		}));
		const entries = decisionEntries(value, state.actions);
		expect(entries.map((entry) => entry.id)).toEqual([
			"classification:run",
			"review:run:0",
			"review:run:1",
			"outcome:run",
		]);
		expect(formatRunView("state", { run: value, state, source: "stored" }, "review")).toContain(
			"REVISE | code revision 0",
		);
	});
	it("escapes terminal/bidi/control injection and bounds display", () => {
		const value = run();
		value.goal = "evil\u001b[2J\nStatus: FORGED\u202e";
		value.verification[0].stdout = "\u001b[31m".repeat(6000);
		const summary = formatRunView("state", { run: value, source: "stored" });
		expect(summary).not.toContain("\u001b");
		expect(summary).not.toContain("\u202e");
		expect(summary).toContain("\\u000aStatus: FORGED");
		expect(formatRunView("state", { run: value, source: "stored" }, "check").length).toBeLessThan(32500);
		expect(displayText("x".repeat(10000))).toContain("truncated");
	});
	it("does not claim a foreign stored active session is locally cancellable", () => {
		const value = run();
		value.status = "RUNNING";
		value.activeAgents = ["Developer"];
		const text = formatRunView("team", { run: value, source: "stored snapshot" });
		expect(text).toContain("liveness unconfirmed");
		expect(text).toContain("owning Pi session to cancel");
	});
	it("config inspection describes effective revision limits without resolving providers", () => {
		const config = parseRuntimeConfig(
			JSON.stringify({
				schemaVersion: 1,
				models: {
					profiles: {
						coding: { provider: "absent", model: "coding" },
						reasoning: { provider: "absent", model: "review" },
					},
				},
				agents: { max_revision_cycles: 3 },
			}),
		);
		expect(formatConfiguration(config)).toContain("STANDARD 3");
		expect(formatConfiguration(config)).toContain("QUICK/R3 0");
	});
});

describe("read-only StateStore observation", () => {
	it("creates no .ai directory when state is missing", async () => {
		const cwd = await directory();
		expect(await FileStateStore.readSnapshot(cwd)).toEqual({
			state: undefined,
			writerPresent: false,
			tasksCurrent: false,
		});
		expect(await readdir(cwd)).toEqual([]);
	});
	it("queries an active writer without locking, recovering, repairing or invalidating approval", async () => {
		const cwd = await directory();
		const store = await FileStateStore.open(cwd);
		try {
			const created = {
				...run(),
				executionMode: "EDIT" as const,
				status: "CREATED" as const,
				phase: "PREFLIGHT" as const,
				tasks: [{ ...run().tasks[0], status: "pending" as const }],
			};
			await store.save(created);
			const before = await readFile(join(cwd, ".ai/state.json"), "utf8");
			await writeFile(join(cwd, ".ai/tasks.json"), "broken projection");
			const snapshot = await FileStateStore.readSnapshot(cwd);
			expect(snapshot.writerPresent).toBe(true);
			expect(snapshot.state?.runs[0].status).toBe("CREATED");
			expect(snapshot.tasksCurrent).toBe(false);
			expect(await readFile(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
			expect(await readFile(join(cwd, ".ai/tasks.json"), "utf8")).toBe("broken projection");
			await store.assertWritable();
		} finally {
			await store.close();
		}
	});
	it("reads valid snapshots while the owned writer atomically replaces state", async () => {
		const cwd = await directory();
		const store = await FileStateStore.open(cwd);
		try {
			await store.save({ ...run(), executionMode: "EDIT", status: "CREATED", phase: "PREFLIGHT" });
			const writes = (async () => {
				for (let index = 0; index < 12; index++) {
					const current = store.snapshot.runs[0];
					await store.save({ ...current, revision: current.revision + 1, status: "RUNNING", phase: "IMPLEMENT" });
				}
			})();
			const reads = (async () => {
				for (let index = 0; index < 12; index++) {
					const snapshot = await FileStateStore.readSnapshot(cwd);
					expect(snapshot.state?.runs[0].runId).toBe("run");
					expect(snapshot.writerPresent).toBe(true);
				}
			})();
			await Promise.all([writes, reads]);
			expect(store.snapshot.runs[0].revision).toBe(13);
			await expect(store.exportViews()).rejects.toThrow("terminal");
			expect(await readdir(join(cwd, ".ai"))).not.toContain("decisions.md");
		} finally {
			await store.close();
		}
	});
	it("does not perform interruption recovery on an abandoned active snapshot or export-only open", async () => {
		const cwd = await directory();
		const store = await FileStateStore.open(cwd);
		await store.save({ ...run(), executionMode: "EDIT", status: "CREATED", phase: "PREFLIGHT" });
		await store.close();
		const before = await readFile(join(cwd, ".ai/state.json"), "utf8");
		expect((await FileStateStore.readSnapshot(cwd)).state?.runs[0].status).toBe("CREATED");
		await expect(FileStateStore.open(cwd, { recoverInterrupted: false })).rejects.toThrow();
		expect(await readFile(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
		const recovery = await FileStateStore.open(cwd);
		try {
			expect(recovery.snapshot.runs[0].status).toBe("INTERRUPTED");
		} finally {
			await recovery.close();
		}
	});
	it.each(["corrupt", "orphan", "symlink"])("fails closed on %s state without modifying it", async (mode) => {
		const cwd = await directory();
		await mkdir(join(cwd, ".ai"));
		if (mode === "corrupt") await writeFile(join(cwd, ".ai/state.json"), "corrupt state");
		if (mode === "orphan") await writeFile(join(cwd, ".ai/tasks.json"), "{}");
		if (mode === "symlink") {
			const outside = join(await directory(), "data");
			await writeFile(outside, JSON.stringify(source()));
			await symlink(outside, join(cwd, ".ai/state.json"));
		}
		await expect(FileStateStore.readSnapshot(cwd)).rejects.toThrow("integrity");
		expect(await readdir(join(cwd, ".ai"))).not.toContain("writer.lock");
	});
});

describe("V0.3E task contract observation", () => {
	it("shows Host-assigned criteria with recorded results instead of legacy statements", () => {
		const state = source();
		state.runs[0].acceptance = [
			{
				criterionId: "AC-001",
				status: "MET",
				evidenceRefs: ["check:run:self-check:1:check"],
				revision: 1,
				diffDigest: "digest",
			},
		];
		const view = formatRunView("state", { run: state.runs[0], state, source: "fixture" });
		expect(view).toContain("acceptance criteria (Host-assigned IDs)");
		expect(view).toContain("AC-001: Fix bug");
		expect(view).toContain("-> MET");
		expect(view).toContain("check:run:self-check:1:check");
		expect(view).toContain("Task Contract digest: sha256:");
	});
	it("never fabricates acceptance criteria for a legacy run", () => {
		const state = source();
		const legacy = state.runs[0];
		legacy.tasks = [{ id: "task", goal: "Fix bug", requirements: ["Fix bug"], status: "completed" }];
		legacy.taskContractDigest = undefined;
		legacy.acceptance = undefined;
		const view = formatRunView("state", { run: legacy, state, source: "fixture" });
		expect(view).toContain("Acceptance criteria: UNKNOWN (legacy)");
		expect(view).toContain("Legacy requirement: Fix bug");
		expect(view).toContain("Task Contract digest: UNKNOWN (legacy");
		expect(view).not.toContain("AC-001");
	});
});
