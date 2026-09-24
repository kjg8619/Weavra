import { fork, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PolicyDecision, Run } from "../src/contracts.ts";
import { readHostObservation } from "../src/host-bridge-projections.ts";
import { CompanyKernel } from "../src/kernel.ts";
import { formatHistory } from "../src/observations.ts";
import {
	FileStateStore,
	type FileStateStoreOptions,
	INLINE_TERMINAL_RUNS,
	StateStoreError,
	withFileStateStore,
} from "../src/state-store.ts";
import { isRuntimeOwnedPath } from "../src/workspace.ts";
import { testContract } from "./fixture-contract.ts";

let root: string;
const stores: FileStateStore[] = [];
beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "company-state-"));
});
afterEach(async () => {
	for (const store of stores.splice(0)) await store.close().catch(() => {});
	await rm(root, { recursive: true, force: true });
});
async function openStore(options?: FileStateStoreOptions, path = root) {
	const store = await FileStateStore.open(path, options);
	stores.push(store);
	return store;
}
async function kernel(store: FileStateStore, id = "run-1") {
	return CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: id,
			task: testContract("Fix bug", { taskId: "task-1", statements: ["Regression covered"] }),
			classification: { intent: "bugfix", complexity: "STANDARD", risk: "R1", confidence: null, reason: "Bug fix" },
		},
		{
			store,
			agents: {
				execute: async () => {
					throw new Error("No agent in S2");
				},
			},
			verifier: {
				verify: async () => {
					throw new Error("No verifier in S2");
				},
			},
		},
	);
}
const decision: PolicyDecision = {
	executionMode: "EDIT",
	runId: "run-1",
	actionId: "action-1",
	role: "Developer",
	risk: "R1",
	decision: "ALLOW",
	reason: "Ordinary edit",
	actionDigest: "digest-1",
	configDigest: "config-1",
};
async function json(file: string) {
	return JSON.parse(await readFile(join(root, ".ai", file), "utf8"));
}

describe("file StateStore", () => {
	it("persists Kernel snapshots, independent project revisions and matching task projection", async () => {
		const store = await openStore();
		const run = await kernel(store);
		await run.start();
		await store.prepare(decision);
		expect(store.snapshot.revision).toBe(3);
		expect(run.snapshot.revision).toBe(2);
		await store.finish("run-1", "action-1", "SUCCEEDED");
		await run.stop("CANCELLED", "User cancelled");
		const state = await json("state.json");
		const tasks = await json("tasks.json");
		expect(state).toEqual(store.snapshot);
		expect(tasks.revision).toBe(state.revision);
		expect(tasks.blocked[0].id).toBe("task-1");
		expect(state.actions[0]).toEqual({ decision, status: "SUCCEEDED" });
		expect(await readdir(join(root, ".ai"))).toEqual(
			expect.arrayContaining(["state.json", "tasks.json", "writer.lock"]),
		);
		await store.close();
		const reopened = await openStore();
		expect(await reopened.load("run-1")).toEqual(run.snapshot);
		expect(await reopened.load("absent")).toBeUndefined();
	});

	it("isolates supplied and returned objects", async () => {
		const store = await openStore();
		const run = await kernel(store);
		const loaded = (await store.load("run-1"))!;
		loaded.tasks[0].goal = "changed";
		store.snapshot.runs[0].goal = "changed";
		expect(await store.load("run-1")).toEqual(run.snapshot);
	});

	it.each(["CANCELLED", "FAILED", "COMPLETED", "BLOCKED"] as const)(
		"retains terminal %s and allows a fresh run ID",
		async (status) => {
			const store = await openStore();
			const run = await kernel(store);
			await store.save({ ...run.snapshot, revision: 2, status });
			await store.close();
			const reopened = await openStore();
			expect((await reopened.load("run-1"))?.status).toBe(status);
			await kernel(reopened, "run-2");
			expect(reopened.snapshot.runs).toHaveLength(2);
			await expect(kernel(reopened, "run-1")).rejects.toThrow("already exists");
		},
	);

	it.each(["missing", "stale", "corrupt", "same revision wrong contents"])(
		"rebuilds %s tasks only from authoritative state",
		async (mode) => {
			const store = await openStore();
			const run = await kernel(store);
			await store.save({ ...run.snapshot, status: "CANCELLED", revision: 2 });
			await store.close();
			const original = await readFile(join(root, ".ai/state.json"), "utf8");
			const expected = await json("tasks.json");
			if (mode === "missing") await rm(join(root, ".ai/tasks.json"));
			else
				await writeFile(
					join(root, ".ai/tasks.json"),
					mode === "corrupt"
						? "{"
						: JSON.stringify({
								...expected,
								revision: mode === "stale" ? 0 : expected.revision,
								blocked: ["forged"],
							}),
				);
			await openStore();
			expect(await json("tasks.json")).toEqual(expected);
			expect(await readFile(join(root, ".ai/state.json"), "utf8")).toBe(original);
		},
	);

	it.each(["CREATED", "RUNNING", "WAITING_APPROVAL"] as const)(
		"marks stale %s INTERRUPTED without replay; event follows persistence",
		async (status) => {
			const store = await openStore();
			const run = await kernel(store);
			await store.save({ ...run.snapshot, revision: 2, status, activeAgents: ["Developer"] });
			await store.close();
			let emitted = 0;
			const recovered = await openStore({
				now: () => 999,
				events: {
					emit: async (event) => {
						emitted++;
						expect(event.type).toBe("RunInterrupted");
						expect((await json("state.json")).runs[0].status).toBe("INTERRUPTED");
					},
				},
			});
			const snapshot = (await recovered.load("run-1"))!;
			expect(snapshot).toMatchObject({
				status: "INTERRUPTED",
				revision: 3,
				updatedAt: 999,
				activeAgents: [],
				next: [],
			});
			expect(snapshot.tasks[0].status).toBe("blocked");
			expect(emitted).toBe(1);
			expect(recovered.deliveryFailures).toEqual([]);
			await recovered.close();
			await openStore({
				events: {
					emit: () => {
						throw new Error("must not replay");
					},
				},
			});
		},
	);

	it("records interrupted action intent, drops no transcript into state, and isolates sink failure", async () => {
		const store = await openStore();
		await (await kernel(store)).start();
		await store.prepare(decision);
		await store.close();
		const recovered = await openStore({
			events: {
				emit: async () => {
					throw new Error("observer offline");
				},
			},
		});
		expect(recovered.snapshot.actions[0].status).toBe("INTERRUPTED");
		expect(recovered.deliveryFailures).toHaveLength(1);
		expect(Object.keys(recovered.snapshot)).toEqual(["schemaVersion", "revision", "runs", "actions"]);
	});

	it("refuses normalized alias and concurrent process lock acquisition without mutations", async () => {
		await openStore();
		const before = await readFile(join(root, ".ai/writer.lock"), "utf8");
		const alias = `${root}-alias`;
		await symlink(root, alias);
		try {
			await expect(FileStateStore.open(alias)).rejects.toThrow();
		} finally {
			await rm(alias);
		}
		// Exercise the real adapter in a separate Node process, not an in-memory lock registry.
		const script = join(root, "contender.mjs");
		await writeFile(
			script,
			`import { FileStateStore, StateStoreError } from ${JSON.stringify(new URL("../src/state-store.ts", import.meta.url).href)};\ntry { const store = await FileStateStore.open(process.argv[2]); await store.close(); process.exitCode = 1; } catch (e) { process.exitCode = e instanceof StateStoreError && e.stage === 'open/lock' ? 0 : 2; }\n`,
		);
		const code = await new Promise<number | null>((resolve, reject) => {
			const child = fork(script, [root], { stdio: "ignore" });
			child.on("error", reject);
			child.on("exit", resolve);
		});
		expect(code).toBe(0);
		expect(await readFile(join(root, ".ai/writer.lock"), "utf8")).toBe(before);
		expect(await readdir(join(root, ".ai"))).toEqual(["writer.lock"]);
	});

	it("never steals an ambiguous stale lock", async () => {
		const store = await openStore();
		await store.close();
		await writeFile(join(root, ".ai/writer.lock"), "unrecognized owner");
		await expect(openStore()).rejects.toThrow();
		expect(await readFile(join(root, ".ai/writer.lock"), "utf8")).toBe("unrecognized owner");
	});

	it("does not delete a replacement lock and disables future writes", async () => {
		const store = await openStore();
		const run = await kernel(store);
		await writeFile(join(root, ".ai/writer.lock"), JSON.stringify({ token: "other-owner" }));
		await expect(store.assertWritable()).rejects.toMatchObject({ stage: "lock lost" });
		await expect(store.close()).rejects.toMatchObject({ cleanupFailed: true });
		await expect(store.save({ ...run.snapshot, revision: 2 })).rejects.toThrow();
		expect(await json("writer.lock")).toEqual({ token: "other-owner" });
	});

	it.each([
		"{",
		"null",
		'{"schemaVersion":2}',
		'{"schemaVersion":1,"revision":0,"runs":[],"actions":[],"messages":[]}',
	])("rejects corrupt authoritative JSON %s and cleans own lock", async (raw) => {
		await (await openStore()).close();
		await writeFile(join(root, ".ai/state.json"), raw);
		await expect(openStore()).rejects.toThrow();
		expect(await readFile(join(root, ".ai/state.json"), "utf8")).toBe(raw);
		expect(await readdir(join(root, ".ai"))).not.toContain("writer.lock");
	});

	it("rejects orphan projection rather than treating it as authoritative", async () => {
		await (await openStore()).close();
		await writeFile(join(root, ".ai/tasks.json"), "{}");
		await expect(openStore()).rejects.toThrow("missing state.json");
	});

	it.each(["write", "sync", "rename"] as const)(
		"atomic state %s failure preserves prior JSON, removes temp and fails closed",
		async (stage) => {
			let fail = false;
			const store = await openStore({
				beforeAtomicStep: (file, step) => {
					if (fail && file === "state.json" && step === stage) throw new Error("Injected I/O error");
				},
			});
			const run = await kernel(store);
			const before = await readFile(join(root, ".ai/state.json"), "utf8");
			fail = true;
			await expect(run.start()).rejects.toMatchObject({ stage: "state.json", stateCommitted: false });
			expect(await readFile(join(root, ".ai/state.json"), "utf8")).toBe(before);
			expect((await readdir(join(root, ".ai"))).sort()).toEqual(["state.json", "tasks.json", "writer.lock"]);
			await expect(FileStateStore.open(root)).rejects.toThrow();
			await store.close(); // No worker in this fixture; the execution owner now confirms cleanup.
			await expect(store.save({ ...run.snapshot, revision: 3 })).rejects.toThrow();
		},
	);

	it("reports projection partial commit, disables writes and repairs only after explicit owner close", async () => {
		let fail = false;
		const store = await openStore({
			beforeAtomicStep: (file, step) => {
				if (fail && file === "tasks.json" && step === "rename") throw new Error("Disk failure");
			},
		});
		const run = await kernel(store);
		fail = true;
		await expect(run.start()).rejects.toMatchObject({ stateCommitted: true, stage: "tasks.json" });
		expect((await json("state.json")).revision).toBe(2);
		expect((await json("tasks.json")).revision).toBe(1);
		await expect(FileStateStore.open(root)).rejects.toThrow();
		await store.close();
		await openStore();
		expect((await json("state.json")).runs[0].status).toBe("INTERRUPTED");
		expect((await json("tasks.json")).revision).toBe((await json("state.json")).revision);
	});

	it.each(["same revision", "skipped revision", "second run", "terminal overwrite"])(
		"rejects %s and prevents further mutation",
		async (mode) => {
			const store = await openStore();
			const run = await kernel(store);
			const patch: Run = run.snapshot;
			if (mode === "skipped revision") patch.revision = 3;
			if (mode === "second run") patch.runId = "other";
			if (mode === "terminal overwrite") {
				await store.save({ ...patch, revision: 2, status: "CANCELLED" });
				patch.revision = 3;
			}
			await expect(store.save(patch)).rejects.toBeInstanceOf(StateStoreError);
			await expect(store.assertWritable()).rejects.toThrow();
		},
	);

	it("rejects changed policy/config digest within a run", async () => {
		const store = await openStore();
		await (await kernel(store)).start();
		await store.prepare(decision);
		await store.finish(decision.runId, decision.actionId, "SUCCEEDED");
		await expect(store.prepare({ ...decision, actionId: "next", configDigest: "changed-config" })).rejects.toThrow();
		expect(store.snapshot.actions).toHaveLength(1);
		await expect(store.assertWritable()).rejects.toThrow();
	});

	it("rejects concurrent saves rather than losing a revision", async () => {
		const store = await openStore();
		const run = await kernel(store);
		const patch = { ...run.snapshot, revision: 2 };
		const first = store.save(patch);
		await expect(store.save(patch)).rejects.toThrow("concurrent");
		await first;
		expect((await store.load("run-1"))?.revision).toBe(2);
	});

	it("V0.8A: queues concurrent action intents and a Kernel save behind the one in-flight action", async () => {
		const store = await openStore();
		const run = await kernel(store);
		await run.start();
		await store.prepare(decision);
		const order: string[] = [];
		// Two wave workers and the Kernel save queue share one write lane instead of failing as concurrent.
		const second = store
			.prepare({ ...decision, actionId: "action-2", actionDigest: "digest-2" })
			.then(() => order.push("prepare-2"));
		const saved = store.save({ ...run.snapshot, revision: 3 }).then(() => order.push("save"));
		const writable = store.assertWritable().then(() => order.push("writable"));
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(order).toEqual(["writable"]);
		expect(store.snapshot.actions.filter((action) => action.status === "PREPARED")).toHaveLength(1);
		await store.finish("run-1", "action-1", "SUCCEEDED");
		await second;
		await new Promise((resolve) => setTimeout(resolve, 20));
		// The save still waits for the second action's outcome: never a Run write during an in-flight effect.
		expect(order).toEqual(["writable", "prepare-2"]);
		await store.finish("run-1", "action-2", "INTERRUPTED");
		await Promise.all([saved, writable]);
		expect(order).toEqual(["writable", "prepare-2", "save"]);
		expect(store.snapshot.actions.map((action) => action.status)).toEqual(["SUCCEEDED", "INTERRUPTED"]);
		expect((await store.load("run-1"))?.revision).toBe(3);
		await store.assertWritable();
	});

	it.each(["state.json", "tasks.json"])("rejects symlinked %s without writing its destination", async (file) => {
		await (await openStore()).close();
		const outside = join(root, "outside.json");
		await writeFile(outside, "{}");
		await symlink(outside, join(root, ".ai", file));
		await expect(openStore()).rejects.toThrow();
		expect(await readFile(outside, "utf8")).toBe("{}");
	});

	it.each(["return", "cancel", "throw"])("scoped owner cleans lock on %s", async (mode) => {
		const operation = withFileStateStore(root, async (owned) => {
			const run = await kernel(owned);
			await run.start();
			if (mode === "throw") throw new Error("Host failure");
			await run.stop(mode === "cancel" ? "CANCELLED" : "INTERRUPTED", "Owner finished");
		});
		if (mode === "throw") await expect(operation).rejects.toThrow("Host failure");
		else await operation;
		expect(await readdir(join(root, ".ai"))).not.toContain("writer.lock");
		await openStore();
	});

	it("rejects a symlinked runtime directory", async () => {
		await symlink(root, join(root, ".ai"));
		await expect(openStore()).rejects.toThrow();
		expect(await readdir(root)).toEqual([".ai"]);
	});
});

/** A PID that belonged to a process which has already exited on this host. */
function deadPid(): number {
	const child = spawnSync(process.execPath, ["-e", ""]);
	if (!child.pid) throw new Error("No child PID");
	return child.pid;
}
async function writeLock(owner: Record<string, unknown>) {
	await mkdir(join(root, ".ai"), { recursive: true });
	await writeFile(join(root, ".ai/writer.lock"), JSON.stringify(owner));
}

describe("stale writer lock recovery", () => {
	it("recovers a same-host lock whose owner process no longer exists", async () => {
		const pid = deadPid();
		await writeLock({
			schemaVersion: 1,
			projectPath: await realpath(root),
			token: "dead",
			pid,
			hostname: hostname(),
		});
		const store = await openStore();
		expect(store.recoveredStaleLock).toEqual({ pid });
		const lock = await json("writer.lock");
		expect(lock).toMatchObject({ pid: process.pid, hostname: hostname() });
		expect(lock.token).not.toBe("dead");
		expect(await readdir(join(root, ".ai"))).not.toContain("writer.lock.recovery");
	});

	it.each([
		["a live owner", async () => ({ pid: process.pid, hostname: hostname(), projectPath: await realpath(root) })],
		[
			"another host",
			async () => ({ pid: deadPid(), hostname: `${hostname()}-other`, projectPath: await realpath(root) }),
		],
		["the older format without a hostname", async () => ({ pid: deadPid(), projectPath: await realpath(root) })],
		["another project", async () => ({ pid: deadPid(), hostname: hostname(), projectPath: "/elsewhere" })],
		["an invalid PID", async () => ({ pid: -1, hostname: hostname(), projectPath: await realpath(root) })],
	])("keeps a lock held by %s untouched", async (_name, owner) => {
		await writeLock({ schemaVersion: 1, token: "kept", ...(await owner()) });
		const before = await readFile(join(root, ".ai/writer.lock"), "utf8");
		await expect(openStore()).rejects.toMatchObject({ stage: "open/lock" });
		expect(await readFile(join(root, ".ai/writer.lock"), "utf8")).toBe(before);
		expect(await readdir(join(root, ".ai"))).toEqual(["writer.lock"]);
	});

	it("does not recover while another recovery guard exists", async () => {
		await writeLock({
			schemaVersion: 1,
			projectPath: await realpath(root),
			token: "dead",
			pid: deadPid(),
			hostname: hostname(),
		});
		await writeFile(join(root, ".ai/writer.lock.recovery"), "other recoverer");
		await expect(openStore()).rejects.toMatchObject({ stage: "open/lock" });
		expect(await readFile(join(root, ".ai/writer.lock.recovery"), "utf8")).toBe("other recoverer");
		expect(await json("writer.lock")).toMatchObject({ token: "dead" });
	});
});

describe("terminal-run archive", () => {
	async function terminalRuns(store: FileStateStore, count: number) {
		for (let index = 0; index < count; index++) {
			const run = await kernel(store, `run-${index}`);
			await run.start();
			await store.prepare({ ...decision, runId: `run-${index}`, actionId: `action-${index}` });
			await store.finish(`run-${index}`, `action-${index}`, "SUCCEEDED");
			await run.stop("CANCELLED", "Fixture");
		}
	}
	const archiveText = (runId: string) => readFile(join(root, ".ai/runs", `${runId}.json`), "utf8");
	const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

	it("moves terminal runs beyond the inline limit, with their actions, behind a digest index", async () => {
		const first = await openStore();
		await terminalRuns(first, INLINE_TERMINAL_RUNS + 2);
		await first.close();
		const store = await openStore();
		const state = store.snapshot;
		expect(state.runs.map((run) => run.runId)).toEqual(
			Array.from({ length: INLINE_TERMINAL_RUNS }, (_, index) => `run-${index + 2}`),
		);
		expect(state.actions.some((action) => ["run-0", "run-1"].includes(action.decision.runId))).toBe(false);
		expect(state.archivedRuns?.map((entry) => entry.runId)).toEqual(["run-0", "run-1"]);
		const text = await archiveText("run-0");
		expect(state.archivedRuns?.[0]).toMatchObject({ status: "CANCELLED", actions: 1, digest: digest(text) });
		const archived = await FileStateStore.readArchivedRun(root, "run-0");
		expect(archived?.run.runId).toBe("run-0");
		expect(archived?.actions).toEqual([
			{ decision: { ...decision, runId: "run-0", actionId: "action-0" }, status: "SUCCEEDED" },
		]);
		expect(JSON.stringify(await json("tasks.json"))).not.toContain('"run-0"');
		expect(await FileStateStore.readArchivedRun(root, "run-5")).toBeUndefined();
		// Host bridge lookups and history see archived runs; the newest run is still inline.
		expect((await readHostObservation(root, "run-0")).run?.runId).toBe("run-0");
		expect((await readHostObservation(root)).run?.runId).toBe(`run-${INLINE_TERMINAL_RUNS + 1}`);
		const history = formatHistory(state, 3);
		expect(history).toContain(`Page 3/3 (${INLINE_TERMINAL_RUNS + 2} records)`);
		expect(history).toMatch(/run-0 \| STANDARD\/R1 \| CANCELLED\/IMPLEMENT \| \S+ \| archived\n {2}Fix bug/);
		// Exports still cover the whole history.
		await store.exportViews();
		const decisions = await readFile(join(root, ".ai/decisions.md"), "utf8");
		expect(decisions).toContain("## Run run-0\n");
		expect(decisions).toContain(`## Run run-${INLINE_TERMINAL_RUNS + 1}\n`);
	});

	it("reuses a byte-identical archive after a crash between the archive and the state commit", async () => {
		const first = await openStore();
		await terminalRuns(first, INLINE_TERMINAL_RUNS + 1);
		await first.close();
		await expect(
			openStore({
				beforeAtomicStep: (file, step) => {
					if (file === "state.json" && step === "rename") throw new Error("crash");
				},
			}),
		).rejects.toThrow();
		const written = await archiveText("run-0");
		expect((await json("state.json")).runs[0].runId).toBe("run-0");
		const store = await openStore();
		expect(store.snapshot.archivedRuns).toMatchObject([{ runId: "run-0", digest: digest(written) }]);
		expect(await archiveText("run-0")).toBe(written);
	});

	it("refuses a changed archive on read and a conflicting archive on write", async () => {
		const first = await openStore();
		await terminalRuns(first, INLINE_TERMINAL_RUNS + 1);
		await first.close();
		await mkdir(join(root, ".ai/runs"), { recursive: true });
		await writeFile(join(root, ".ai/runs/run-0.json"), "{}");
		await expect(openStore()).rejects.toMatchObject({ stage: "archive conflict" });
		await rm(join(root, ".ai/runs/run-0.json"));
		await (await openStore()).close();
		await writeFile(
			join(root, ".ai/runs/run-0.json"),
			(await archiveText("run-0")).replace("CANCELLED", "COMPLETED"),
		);
		await expect(FileStateStore.readArchivedRun(root, "run-0")).rejects.toMatchObject({
			stage: "archived run integrity",
		});
	});

	it("treats archives and the recovery guard as Runtime-owned workspace files only", () => {
		expect(isRuntimeOwnedPath(".ai/runs/0b5c7f4e-1d2a-4c8e-9f00-123456789abc.json")).toBe(true);
		expect(isRuntimeOwnedPath(".ai/writer.lock.recovery")).toBe(true);
		for (const path of [".ai/runs/../state.json", ".ai/runs/nested/x.json", ".ai/runs/.x.tmp", ".ai/other.json"])
			expect(isRuntimeOwnedPath(path)).toBe(false);
	});
});
