import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { type FileHandle, lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { hostname } from "node:os";
import { join } from "node:path";
import { type Static, Type } from "typebox";
import { readAnchoredSource } from "./anchored-files.ts";
import { ACTIVE_TASK_STATUSES, complexRunError, settleComplexState } from "./complex-state.ts";
import { type PolicyDecision, PolicyDecisionSchema, type Run, RunSchema, validateContract } from "./contracts.ts";
import { createRuntimeEvent, type EventDeliveryFailure, type RuntimeEvent, type RuntimeEventSink } from "./events.ts";
import { isExecutionMode } from "./execution-contract.ts";
import { OBSERVATION_MAX_BYTES, readRuntimeFile, writeObservationFiles } from "./observation-files.ts";
import type { ActionAudit, ActionOutcome } from "./policy.ts";
import type { StateStore } from "./ports.ts";
import { PROJECT_FACT_LIMIT, type ProjectFact, ProjectFactSchema } from "./project-fact-types.ts";

const counter = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const STATE_MAX_BYTES = 16 * 1024 * 1024;
/** Terminal runs kept inline; older ones move to `.ai/runs/<runId>.json` when a writer opens the store. */
export const INLINE_TERMINAL_RUNS = 20;
/** Run IDs that are safe as archive file names; other runs simply stay inline. */
const ARCHIVE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ActionRecordSchema = Type.Object(
	{
		decision: PolicyDecisionSchema,
		status: Type.Enum(["DENIED", "PREPARED", "SUCCEEDED", "FAILED", "INTERRUPTED"]),
	},
	{ additionalProperties: false },
);
type ActionRecord = Static<typeof ActionRecordSchema>;
const label = Type.String({ minLength: 1, maxLength: 32 });
/** Bounded index entry for an archived terminal run; the archive file is verified against `digest` on every read. */
const ArchivedRunSchema = Type.Object(
	{
		runId: Type.String({ pattern: ARCHIVE_RUN_ID.source }),
		status: label,
		workflow: label,
		risk: label,
		phase: label,
		goal: Type.String({ maxLength: 300 }),
		createdAt: counter,
		updatedAt: counter,
		actions: counter,
		digest: Type.String({ pattern: "^sha256:[0-9a-f]{64}$" }),
	},
	{ additionalProperties: false },
);
export type ArchivedRun = Static<typeof ArchivedRunSchema>;
const RunArchiveSchema = Type.Object(
	{ schemaVersion: Type.Literal(1), run: RunSchema, actions: Type.Array(ActionRecordSchema) },
	{ additionalProperties: false },
);
const StateSchema = Type.Object(
	{
		schemaVersion: Type.Literal(1),
		/** Project storage revision, distinct from each Run.revision and its code revisionCycle. */
		revision: counter,
		runs: Type.Array(RunSchema),
		actions: Type.Array(ActionRecordSchema),
		projectFacts: Type.Optional(Type.Array(ProjectFactSchema, { maxItems: PROJECT_FACT_LIMIT })),
		archivedRuns: Type.Optional(Type.Array(ArchivedRunSchema)),
	},
	{ additionalProperties: false },
);
export type FileRuntimeState = Static<typeof StateSchema>;
const archiveDigest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

/** A dead owner is only provable on this host; EPERM or success means the PID is alive. */
function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code !== "ESRCH";
	}
}

/** Reads a regular single-link file under `.ai` without following links; undefined when absent. */
async function readRuntimeOwnedFile(directories: readonly string[], path: string): Promise<string | undefined> {
	for (const directory of directories) {
		try {
			const stat = await lstat(directory);
			if (!stat.isDirectory() || stat.isSymbolicLink()) throw new StateStoreError("unsafe runtime directory");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
	}
	let handle: FileHandle;
	try {
		handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink !== 1 || stat.size > STATE_MAX_BYTES)
			throw new StateStoreError("unsafe runtime file");
		return await handle.readFile("utf8");
	} finally {
		await handle.close();
	}
}

/** Digest-checked archive read; a missing, changed or mismatched archive is an integrity error. */
async function loadArchive(project: string, entry: ArchivedRun): Promise<{ run: Run; actions: ActionRecord[] }> {
	const directory = join(project, ".ai");
	const text = await readRuntimeOwnedFile(
		[directory, join(directory, "runs")],
		join(directory, "runs", `${entry.runId}.json`),
	).catch(() => undefined);
	if (text === undefined || archiveDigest(text) !== entry.digest) throw new StateStoreError("archived run integrity");
	const archive = validateContract(RunArchiveSchema, JSON.parse(text));
	if (archive.run.runId !== entry.runId || archive.actions.some((action) => action.decision.runId !== entry.runId))
		throw new StateStoreError("archived run integrity");
	return { run: archive.run, actions: archive.actions };
}
type StateFile = "state.json" | "tasks.json";
export interface FileStateStoreOptions {
	now?: () => number;
	events?: RuntimeEventSink;
	/** Export-only ownership refuses active snapshots and skips recovery/projection repair. */
	recoverInterrupted?: boolean;
	/** Deterministic I/O failure injection for tests, not an execution/policy hook. */
	beforeAtomicStep?: (
		file: StateFile | "decisions.md" | "logs/checks.json",
		step: "write" | "sync" | "rename",
	) => void;
}
export class StateStoreError extends Error {
	readonly stage: string;
	readonly stateCommitted: boolean;
	cleanupFailed = false;
	constructor(stage: string, stateCommitted = false) {
		super(`Runtime storage failed (${stage}); further writes are disabled`);
		this.stage = stage;
		this.stateCommitted = stateCommitted;
	}
}
function active(run: Run): boolean {
	return ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run.status);
}
function assertState(value: unknown): FileRuntimeState {
	const state = validateContract(StateSchema, value);
	const runIds = new Set(state.runs.map((run) => run.runId));
	const facts = state.projectFacts ?? [];
	if (
		new Set(facts.map((fact) => fact.id)).size !== facts.length ||
		new Set(facts.map((fact) => fact.sourceRef)).size !== facts.length
	)
		throw new Error("Conflicting project facts");
	if (runIds.size !== state.runs.length || state.runs.filter(active).length > 1) throw new Error("Conflicting runs");
	const archived = state.archivedRuns ?? [];
	if (
		new Set(archived.map((entry) => entry.runId)).size !== archived.length ||
		archived.some((entry) => runIds.has(entry.runId))
	)
		throw new Error("Conflicting archived runs");
	for (const run of state.runs) {
		const taskIds = new Set(run.tasks.map((task) => task.id));
		if (taskIds.size !== run.tasks.length || !taskIds.has(run.currentTask) || run.revision < 1)
			throw new Error("Invalid run identity");
		// COMPLEX identity/state invariants hold for every stored snapshot, not only for fresh saves.
		const complex = complexRunError(run);
		if (complex) throw new Error(`Invalid COMPLEX run state: ${complex}`);
	}
	const actionIds = new Set<string>();
	for (const action of state.actions) {
		const id = JSON.stringify([action.decision.runId, action.decision.actionId]);
		if (
			actionIds.has(id) ||
			!runIds.has(action.decision.runId) ||
			(action.status === "DENIED") !== (action.decision.decision !== "ALLOW")
		)
			throw new Error("Invalid action record");
		actionIds.add(id);
	}
	if (state.actions.filter((action) => action.status === "PREPARED").length > 1) throw new Error("Concurrent actions");
	return state;
}
function projection(state: FileRuntimeState) {
	const tasks = state.runs.flatMap((run) => run.tasks.map((task) => ({ runId: run.runId, ...task })));
	return {
		schemaVersion: 1,
		revision: state.revision,
		pending: tasks.filter((task) => task.status === "pending"),
		inProgress: tasks.filter((task) => task.status === "inProgress"),
		completed: tasks.filter((task) => task.status === "completed"),
		blocked: tasks.filter((task) => task.status === "blocked"),
	};
}

/** Local cooperative single writer. The owner must close in finally after workers have stopped. */
export class FileStateStore implements StateStore, ActionAudit {
	readonly projectPath: string;
	private readonly directory: string;
	private readonly lockPath: string;
	private readonly token = randomUUID();
	private readonly options: FileStateStoreOptions;
	private lockIdentity?: { dev: number; ino: number };
	private directoryIdentity?: { dev: number; ino: number };
	private state: FileRuntimeState = { schemaVersion: 1, revision: 0, runs: [], actions: [] };
	private closed = false;
	private closing?: Promise<void>;
	private busy = false;
	private readonly eventFailures: EventDeliveryFailure[] = [];
	/** Set when open removed a lock whose same-host owner PID no longer exists. */
	recoveredStaleLock?: { pid: number };

	private constructor(projectPath: string, options: FileStateStoreOptions) {
		this.projectPath = projectPath;
		this.directory = join(projectPath, ".ai");
		this.lockPath = join(this.directory, "writer.lock");
		this.options = options;
	}
	static async open(projectPath: string, options: FileStateStoreOptions = {}): Promise<FileStateStore> {
		const canonical = await realpath(projectPath);
		if (!(await lstat(canonical)).isDirectory()) throw new StateStoreError("workspace");
		const store = new FileStateStore(canonical, options);
		try {
			await mkdir(store.directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "EEXIST") throw error;
			});
			const directory = await lstat(store.directory);
			if (!directory.isDirectory() || directory.isSymbolicLink()) throw new StateStoreError("directory");
			store.directoryIdentity = { dev: directory.dev, ino: directory.ino };
			const createLock = () =>
				open(store.lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
			let lock: FileHandle;
			try {
				lock = await createLock();
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "EEXIST" || !(await store.recoverStaleLock())) throw error;
				lock = await createLock();
			}
			try {
				const identity = await lock.stat();
				store.lockIdentity = { dev: identity.dev, ino: identity.ino };
				await lock.writeFile(
					JSON.stringify({
						schemaVersion: 1,
						projectPath: canonical,
						token: store.token,
						pid: process.pid,
						hostname: hostname(),
					}),
				);
				await lock.sync();
			} finally {
				await lock.close();
			}
			await store.initialize();
			return store;
		} catch (error) {
			const failure = error instanceof StateStoreError ? error : new StateStoreError("open/lock");
			store.closed = true;
			try {
				await store.releaseLock();
			} catch {
				failure.cleanupFailed = true;
			}
			throw failure;
		}
	}
	/**
	 * Removes a lock only when its same-host owner PID provably no longer exists. A recovery guard created with
	 * O_EXCL excludes concurrent recoverers; normal openers never touch an existing lock, so no fresh lock is removed.
	 * Locks without a hostname (older format), other hosts, live or unverifiable owners and a leftover guard are kept.
	 */
	private async recoverStaleLock(): Promise<boolean> {
		const guardPath = join(this.directory, "writer.lock.recovery");
		let guard: FileHandle;
		try {
			guard = await open(guardPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		} catch {
			return false;
		}
		try {
			await guard.writeFile(JSON.stringify({ pid: process.pid, hostname: hostname(), token: this.token }));
			let stale: { dev: number; ino: number; pid: number } | undefined;
			try {
				const handle = await open(this.lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
				try {
					const stat = await handle.stat();
					if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) return false;
					const owner: unknown = JSON.parse(await handle.readFile("utf8"));
					if (
						owner &&
						typeof owner === "object" &&
						"schemaVersion" in owner &&
						owner.schemaVersion === 1 &&
						"projectPath" in owner &&
						owner.projectPath === this.projectPath &&
						"hostname" in owner &&
						owner.hostname === hostname() &&
						"pid" in owner &&
						typeof owner.pid === "number" &&
						Number.isSafeInteger(owner.pid) &&
						owner.pid > 0 &&
						!processAlive(owner.pid)
					)
						stale = { dev: stat.dev, ino: stat.ino, pid: owner.pid };
				} finally {
					await handle.close();
				}
			} catch {
				return false;
			}
			if (!stale) return false;
			const current = await lstat(this.lockPath);
			if (current.dev !== stale.dev || current.ino !== stale.ino) return false;
			await unlink(this.lockPath);
			this.recoveredStaleLock = { pid: stale.pid };
			return true;
		} finally {
			await guard.close();
			await unlink(guardPath);
		}
	}
	/** Final-use canonical validation for advisory inputs; no recovery, migration or lock mutation. */
	static readProjectFacts(projectPath: string): ProjectFact[] {
		return (
			assertState(JSON.parse(readAnchoredSource(projectPath, ".ai/state.json", OBSERVATION_MAX_BYTES).text))
				.projectFacts ?? []
		);
	}
	/** Reads a point-in-time atomic source snapshot without acquiring/stealing a writer or repairing projections. */
	static async readSnapshot(
		projectPath: string,
	): Promise<{ state?: FileRuntimeState; writerPresent: boolean; tasksCurrent: boolean }> {
		try {
			const project = await realpath(projectPath);
			const text = await readRuntimeFile(project, ".ai/state.json");
			let tasks: string | undefined;
			try {
				tasks = await readRuntimeFile(project, ".ai/tasks.json");
			} catch {
				tasks = "[unavailable projection]";
			}
			if (text === undefined && tasks !== undefined) throw new Error("Missing state source");
			const state = text === undefined ? undefined : structuredClone(assertState(JSON.parse(text)));
			let writerPresent = false;
			try {
				await lstat(join(project, ".ai/writer.lock"));
				writerPresent = true;
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			let tasksCurrent = false;
			try {
				tasksCurrent =
					!!state &&
					tasks !== undefined &&
					JSON.stringify(JSON.parse(tasks)) === JSON.stringify(projection(state));
			} catch {
				/* Never recover on a read. */
			}
			return { state, writerPresent, tasksCurrent };
		} catch {
			throw new StateStoreError("read snapshot integrity");
		}
	}
	async exportViews() {
		if (
			this.busy ||
			this.closed ||
			this.state.revision === 0 ||
			this.state.runs.some(active) ||
			this.state.actions.some((action) => action.status === "PREPARED")
		)
			throw new Error("Export requires an idle writer and terminal runs; no recovery/resume is performed");
		this.busy = true;
		try {
			const snapshot = this.snapshot;
			// Exports cover all history: archived runs are digest-checked and placed before the inline ones.
			const archives: Array<{ run: Run; actions: ActionRecord[] }> = [];
			for (const entry of snapshot.archivedRuns ?? []) archives.push(await loadArchive(this.projectPath, entry));
			return await writeObservationFiles(
				this,
				{
					revision: snapshot.revision,
					runs: [...archives.map((archive) => archive.run), ...snapshot.runs],
					actions: [...archives.flatMap((archive) => archive.actions), ...snapshot.actions],
				},
				this.options.beforeAtomicStep,
			);
		} finally {
			this.busy = false;
		}
	}
	get snapshot(): FileRuntimeState {
		return structuredClone(this.state);
	}
	get deliveryFailures(): EventDeliveryFailure[] {
		return structuredClone(this.eventFailures);
	}

	private async assertDirectory(): Promise<void> {
		const stat = await lstat(this.directory);
		if (
			!stat.isDirectory() ||
			stat.isSymbolicLink() ||
			stat.dev !== this.directoryIdentity?.dev ||
			stat.ino !== this.directoryIdentity.ino ||
			(await realpath(this.projectPath)) !== this.projectPath
		)
			throw new StateStoreError("directory changed");
	}
	private async checkOwnership(): Promise<void> {
		if (this.closed) throw new StateStoreError("closed");
		await this.assertDirectory();
		const handle = await open(this.lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const stat = await handle.stat();
			if (
				!stat.isFile() ||
				stat.nlink !== 1 ||
				stat.dev !== this.lockIdentity?.dev ||
				stat.ino !== this.lockIdentity.ino
			)
				throw new StateStoreError("lock lost");
			const owner: unknown = JSON.parse(await handle.readFile("utf8"));
			if (!owner || typeof owner !== "object" || !("token" in owner) || owner.token !== this.token)
				throw new StateStoreError("lock lost");
		} finally {
			await handle.close();
		}
	}
	async assertWritable(): Promise<void> {
		try {
			await this.checkOwnership();
			const persisted = await this.readJson("state.json");
			if (
				(persisted !== undefined || this.state.revision > 0) &&
				JSON.stringify(persisted) !== JSON.stringify(this.state)
			)
				throw new StateStoreError("authoritative state changed outside the writer");
		} catch (error) {
			await this.fail(error);
		}
	}
	private async releaseLock(): Promise<void> {
		if (!this.lockIdentity) return;
		await this.assertDirectory();
		const stat = await lstat(this.lockPath);
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			stat.dev !== this.lockIdentity.dev ||
			stat.ino !== this.lockIdentity.ino
		)
			throw new StateStoreError("lock replacement; manual inspection required");
		// Never remove another owner's lock, even if the inode was modified in place.
		const handle = await open(this.lockPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const opened = await handle.stat();
			if (
				!opened.isFile() ||
				opened.nlink !== 1 ||
				opened.dev !== this.lockIdentity.dev ||
				opened.ino !== this.lockIdentity.ino
			)
				throw new StateStoreError("lock replacement; manual inspection required");
			const content = await handle.readFile("utf8");
			if (content) {
				const owner: unknown = JSON.parse(content);
				if (!owner || typeof owner !== "object" || !("token" in owner) || owner.token !== this.token)
					throw new StateStoreError("lock owner changed");
			}
		} finally {
			await handle.close();
		}
		await unlink(this.lockPath);
		this.lockIdentity = undefined;
	}
	async close(): Promise<void> {
		if (this.busy) throw new Error("Storage operation still in flight");
		if (this.closing) return this.closing;
		this.closed = true;
		this.closing = this.releaseLock()
			.catch((error: unknown) => {
				const failure = error instanceof StateStoreError ? error : new StateStoreError("lock cleanup");
				failure.cleanupFailed = true;
				throw failure;
			})
			.finally(() => {
				this.closing = undefined;
			});
		return this.closing;
	}
	private async fail(error: unknown): Promise<never> {
		this.closed = true;
		// A failed save can occur inside a live SDK tool. Only the execution owner knows when
		// workers/processes have stopped. Disable mutations now, but defer lease release to close().
		throw error instanceof StateStoreError ? error : new StateStoreError("I/O or invalid state");
	}
	private async readJson(file: StateFile): Promise<unknown | undefined> {
		await this.checkOwnership();
		let handle: FileHandle;
		try {
			handle = await open(
				join(this.directory, file),
				constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
			);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.nlink !== 1 || stat.size > 16 * 1024 * 1024)
				throw new StateStoreError("unsafe state file");
			return JSON.parse(await handle.readFile("utf8")) as unknown;
		} finally {
			await handle.close();
		}
	}
	private async atomicReplace(file: StateFile, value: unknown, beforeRename?: () => void): Promise<void> {
		const content = `${JSON.stringify(value, null, 2)}\n`;
		if (Buffer.byteLength(content, "utf8") > 16 * 1024 * 1024) throw new StateStoreError("state size limit");
		await this.checkOwnership();
		const target = join(this.directory, file);
		try {
			const stat = await lstat(target);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new StateStoreError("unsafe target");
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
		const temporary = join(this.directory, `.${file}.${randomUUID()}.tmp`);
		const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		try {
			try {
				this.options.beforeAtomicStep?.(file, "write");
				await handle.writeFile(content);
				this.options.beforeAtomicStep?.(file, "sync");
				await handle.sync();
			} finally {
				await handle.close();
			}
			await this.checkOwnership();
			this.options.beforeAtomicStep?.(file, "rename");
			beforeRename?.();
			await rename(temporary, target);
			// File data is flushed before rename. Directory fsync/power-loss durability is not promised.
		} finally {
			await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
		}
	}
	private async commit(next: FileRuntimeState, beforeStateRename?: () => void): Promise<void> {
		next.revision = this.state.revision + 1;
		assertState(next);
		try {
			await this.atomicReplace("state.json", next, beforeStateRename);
		} catch {
			throw new StateStoreError("state.json", false);
		}
		this.state = structuredClone(next);
		try {
			await this.atomicReplace("tasks.json", projection(next));
		} catch {
			throw new StateStoreError("tasks.json", true);
		}
	}
	private async initialize(): Promise<void> {
		const raw = await this.readJson("state.json");
		if (raw !== undefined) this.state = structuredClone(assertState(raw));
		else {
			// Orphan projection is evidence of missing source, never a replacement source of truth.
			if ((await this.readJson("tasks.json")) !== undefined) throw new StateStoreError("missing state.json");
			return;
		}
		const next = structuredClone(this.state);
		if (
			this.options.recoverInterrupted === false &&
			(next.runs.some(active) || next.actions.some((action) => action.status === "PREPARED"))
		)
			throw new StateStoreError("active run; recovery disabled");
		const events: RuntimeEvent[] = [];
		for (const run of next.runs)
			if (active(run)) {
				// COMPLEX: completed contribution rows stay historical; every unfinished row and running gate is
				// interrupted by owner loss with unknown changes and unconfirmed cleanup. Never replayed.
				if (run.complex)
					run.complex = settleComplexState(run.complex, {
						taskStatus: "INTERRUPTED",
						failureCode: "OWNER_LOST",
						cancelled: false,
						ownerLost: true,
						cleanup: "UNCONFIRMED",
						partialChanges: true,
						changesUnknown: true,
					});
				run.status = "INTERRUPTED";
				run.revision++;
				run.eventSequence++;
				run.updatedAt = (this.options.now ?? Date.now)();
				run.activeAgents = [];
				if (run.approvals)
					run.approvals = run.approvals.map((record) =>
						record.status === "PENDING" || record.status === "APPROVED"
							? { ...record, status: "INTERRUPTED" }
							: record,
					);
				run.next = [];
				run.lastError = "Previous owner stopped; inspect workspace and start a new run. No automatic resume.";
				run.tasks = run.tasks.map((task) => (task.status === "completed" ? task : { ...task, status: "blocked" }));
				events.push(createRuntimeEvent(run, run.eventSequence, { type: "RunInterrupted", reason: run.lastError }));
			}
		for (const action of next.actions) if (action.status === "PREPARED") action.status = "INTERRUPTED";
		if (this.options.recoverInterrupted !== false) await this.archiveTerminalRuns(next);
		if (JSON.stringify(next) !== JSON.stringify(this.state)) await this.commit(next);
		else {
			if (this.options.recoverInterrupted === false) return;
			let tasks: unknown;
			try {
				tasks = await this.readJson("tasks.json");
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
			}
			if (JSON.stringify(tasks) !== JSON.stringify(projection(this.state)))
				await this.atomicReplace("tasks.json", projection(this.state));
		}
		for (const event of events) {
			try {
				await this.options.events?.emit(structuredClone(event));
			} catch {
				this.eventFailures.push({ sequence: event.sequence, type: event.type });
			}
		}
	}
	/**
	 * Moves terminal runs beyond the newest INLINE_TERMINAL_RUNS (with their actions) to immutable archive files, then
	 * lets the caller commit the smaller state. Archive files are written first, so a crash leaves an unreferenced but
	 * byte-identical archive that the next open reuses; terminal runs never change.
	 */
	private async archiveTerminalRuns(next: FileRuntimeState): Promise<void> {
		const terminal = next.runs.filter((run) => !active(run) && ARCHIVE_RUN_ID.test(run.runId));
		const selected = terminal.slice(0, Math.max(0, terminal.length - INLINE_TERMINAL_RUNS));
		if (!selected.length) return;
		const archived = next.archivedRuns ?? [];
		for (const run of selected) {
			const actions = next.actions.filter((action) => action.decision.runId === run.runId);
			archived.push({
				runId: run.runId,
				status: run.status,
				workflow: run.workflow,
				risk: run.risk,
				phase: run.phase,
				goal: run.goal.slice(0, 300),
				createdAt: run.createdAt,
				updatedAt: run.updatedAt,
				actions: actions.length,
				digest: await this.writeArchive(run, actions),
			});
		}
		const moved = new Set(selected.map((run) => run.runId));
		next.runs = next.runs.filter((run) => !moved.has(run.runId));
		next.actions = next.actions.filter((action) => !moved.has(action.decision.runId));
		next.archivedRuns = archived;
	}
	private async writeArchive(run: Run, actions: ActionRecord[]): Promise<string> {
		const content = `${JSON.stringify({ schemaVersion: 1, run, actions }, null, 2)}\n`;
		if (Buffer.byteLength(content, "utf8") > STATE_MAX_BYTES) throw new StateStoreError("archive size limit");
		const digest = archiveDigest(content);
		await this.checkOwnership();
		const directory = join(this.directory, "runs");
		await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
			if (error.code !== "EEXIST") throw error;
		});
		const target = join(directory, `${run.runId}.json`);
		const existing = await readRuntimeOwnedFile([this.directory, directory], target);
		if (existing !== undefined) {
			if (archiveDigest(existing) !== digest) throw new StateStoreError("archive conflict");
			return digest;
		}
		const temporary = join(directory, `.${run.runId}.${randomUUID()}.tmp`);
		const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		try {
			try {
				await handle.writeFile(content);
				await handle.sync();
			} finally {
				await handle.close();
			}
			await this.checkOwnership();
			await rename(temporary, target);
		} finally {
			await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
		}
		return digest;
	}
	/** Read-only lookup of an archived terminal run through the canonical index; no lock, repair or migration. */
	static async readArchivedRun(
		projectPath: string,
		runId: string,
	): Promise<{ run: Run; actions: ActionRecord[] } | undefined> {
		const { state } = await FileStateStore.readSnapshot(projectPath);
		const entry = state?.archivedRuns?.find((item) => item.runId === runId);
		return entry ? loadArchive(await realpath(projectPath), entry) : undefined;
	}
	private async mutate(change: (next: FileRuntimeState) => void, beforeStateRename?: () => void): Promise<void> {
		if (this.closed || this.busy) throw new StateStoreError("closed or concurrent operation");
		this.busy = true;
		try {
			await this.assertWritable();
			const next = structuredClone(this.state);
			change(next);
			await this.commit(next, beforeStateRename);
		} catch (error) {
			await this.fail(error);
		} finally {
			this.busy = false;
		}
	}
	/** Host review only; never exposed as a worker tool or Kernel permission. */
	async saveProjectFact(fact: ProjectFact, expectedRevision: number, assertFresh: () => void): Promise<void> {
		fact = structuredClone(validateContract(ProjectFactSchema, fact));
		await this.mutate((next) => {
			if (
				next.revision !== expectedRevision ||
				next.runs.some(active) ||
				next.actions.some((action) => action.status === "PREPARED")
			)
				throw new Error("Project facts require the exact idle project revision");
			assertFresh();
			const facts = next.projectFacts ?? [];
			const index = facts.findIndex((item) => item.sourceRef === fact.sourceRef);
			if (index >= 0) {
				if (facts[index].id !== fact.id) throw new Error("Fact identity cannot change on re-review");
				facts[index] = fact;
			} else {
				if (facts.length >= PROJECT_FACT_LIMIT) throw new Error("Project fact capacity reached");
				facts.push(fact);
			}
			next.projectFacts = facts;
		}, assertFresh);
	}
	async load(runId: string): Promise<Run | undefined> {
		await this.assertWritable();
		return structuredClone(this.state.runs.find((run) => run.runId === runId));
	}
	async save(run: Run): Promise<void> {
		run = structuredClone(run);
		await this.mutate((next) => {
			validateContract(RunSchema, run);
			const index = next.runs.findIndex((item) => item.runId === run.runId);
			const previous = next.runs[index];
			if (previous && JSON.stringify(previous.projectInstruction) !== JSON.stringify(run.projectInstruction))
				throw new Error("Project instruction metadata cannot change within a run");
			if (previous && previous.verificationRepair?.mode !== run.verificationRepair?.mode)
				throw new Error("Verification repair mode cannot change within a run");
			const repairAttempts = run.verificationRepair?.attempts ?? [];
			for (const [index, attempt] of (previous?.verificationRepair?.attempts ?? []).entries())
				if (JSON.stringify(attempt) !== JSON.stringify(repairAttempts[index]))
					throw new Error("Verification repair history cannot be removed or rewritten");
			if (run.verificationRepair?.mode === "self-check-once" && previous) {
				if (
					previous.taskContractDigest !== run.taskContractDigest ||
					previous.verification.some(
						(check, index) => JSON.stringify(check) !== JSON.stringify(run.verification[index]),
					)
				)
					throw new Error("Repair must preserve the original Task Contract and failed evidence");
			}
			for (const attempt of repairAttempts) {
				if (
					run.verificationRepair?.mode !== "self-check-once" ||
					run.workflow !== "STANDARD" ||
					run.executionMode !== "EDIT" ||
					run.risk !== "R1" ||
					attempt.toRevision !== attempt.fromRevision + 1 ||
					attempt.toRevision > run.revisionCycle ||
					attempt.fromStep.attempt !== attempt.fromRevision + 1 ||
					attempt.toStep.attempt !== attempt.toRevision + 1 ||
					attempt.taskContractDigest !== run.taskContractDigest ||
					attempt.failedCheckIds.some(
						(id) =>
							!run.verification.some(
								(check) =>
									check.id === id &&
									check.revision === attempt.fromRevision &&
									check.step?.stepId === "self-check" &&
									check.step.attempt === attempt.fromStep.attempt &&
									check.status === "FAIL" &&
									check.kind !== "browser" &&
									check.failureKind === "COMMAND_NONZERO" &&
									check.diffDigest === attempt.diffDigest,
							),
					)
				)
					throw new Error("Invalid verification repair parent evidence");
				if (
					!previous?.verificationRepair?.attempts.length &&
					(previous?.status !== "RUNNING" ||
						previous.currentStep?.stepId !== "self-check" ||
						previous.revisionCycle !== attempt.fromRevision ||
						run.currentStep?.stepId !== "implement" ||
						run.currentStep.attempt !== attempt.toStep.attempt ||
						run.revisionCycle !== attempt.toRevision)
				)
					throw new Error("Repair must link a failed SELF_CHECK to one fresh implementation attempt");
			}
			if (
				(!isExecutionMode(run.executionMode) && (!previous || active(run))) ||
				(previous && previous.executionMode !== run.executionMode)
			)
				throw new Error(
					"New runs need an explicit immutable execution contract; legacy permission cannot be inferred",
				);
			if (
				previous?.risk === "R3" &&
				previous.r3Scope &&
				(run.risk !== "R3" ||
					// Explicit COMPLEX branch: the same single deletion obligation, never a relabelled STANDARD run.
					run.workflow !== previous.workflow ||
					(run.workflow !== "STANDARD" && run.workflow !== "COMPLEX") ||
					JSON.stringify(run.r3Scope) !== JSON.stringify(previous.r3Scope))
			)
				throw new Error("R3 scope/approval obligation cannot change");
			const approvals = run.approvals ?? [];
			if (
				approvals.length > 1 ||
				approvals.some(
					(record) =>
						!run.r3Scope || record.request.runId !== run.runId || record.request.path !== run.r3Scope.targetPath,
				)
			)
				throw new Error("Invalid approval ledger");
			for (const record of approvals) {
				const old = previous?.approvals?.find((item) => item.request.actionId === record.request.actionId);
				if (!old && record.status !== "PENDING") throw new Error("Approval must first be persisted pending");
				if (
					old &&
					(JSON.stringify(old.request) !== JSON.stringify(record.request) ||
						(old.status !== record.status &&
							!(
								old.status === "PENDING" &&
								["APPROVED", "DENIED", "EXPIRED", "CANCELLED", "INTERRUPTED"].includes(record.status)
							) &&
							!(old.status === "APPROVED" && ["CONSUMED", "CANCELLED", "INTERRUPTED"].includes(record.status))))
				)
					throw new Error("Approval mutation/replay");
				if (
					record.status === "CONSUMED" &&
					!next.actions.some(
						(action) =>
							action.status === "SUCCEEDED" &&
							action.decision.runId === run.runId &&
							action.decision.actionId === record.request.actionId &&
							action.decision.actionDigest === record.request.actionDigest &&
							action.decision.configDigest === record.request.configDigest &&
							action.decision.risk === "R3",
					)
				)
					throw new Error("Approval consumption requires successful durable action evidence");
			}
			if (
				previous?.approvals?.some(
					(old) => !approvals.some((record) => record.request.actionId === old.request.actionId),
				)
			)
				throw new Error("Approval history cannot be removed");
			if (
				previous?.risk === "R2" &&
				(previous.workflow === "STANDARD" || previous.workflow === "COMPLEX") &&
				(run.risk !== "R2" || run.workflow !== previous.workflow || run.quickScope !== undefined)
			)
				throw new Error("A persisted R2 review obligation cannot be downgraded");
			const complex = complexRunError(run, previous);
			if (complex) throw new Error(`Invalid COMPLEX run state: ${complex}`);
			if (run.revision !== (previous?.revision ?? 0) + 1 || (previous && !active(previous)))
				throw new Error("Stale revision or terminal run; resume is unsupported");
			if (!previous && (run.status !== "CREATED" || next.runs.some(active)))
				throw new Error("Project already has an active run");
			if (next.actions.some((action) => action.status === "PREPARED")) throw new Error("Action still in flight");
			if (index < 0) next.runs.push(run);
			else next.runs[index] = run;
		});
	}
	async prepare(decision: PolicyDecision): Promise<void> {
		decision = structuredClone(decision);
		await this.mutate((next) => {
			validateContract(PolicyDecisionSchema, decision);
			const owner = next.runs.find((run) => run.runId === decision.runId);
			if ((owner?.projectInstruction?.digest ?? null) !== (decision.projectInstructionDigest ?? null))
				throw new Error("Policy project instruction digest differs from the persisted run");
			if (!isExecutionMode(owner?.executionMode) || decision.executionMode !== owner.executionMode)
				throw new Error("Policy execution contract differs from the persisted run");
			if (
				decision.decision === "ALLOW" &&
				owner.executionMode === "READ_ONLY" &&
				decision.role !== "Verifier" &&
				decision.risk !== "R0"
			)
				throw new Error("READ_ONLY worker action cannot mutate");
			if (
				!next.runs.some((run) => run.runId === decision.runId && run.status === "RUNNING") ||
				next.actions.some(
					(item) =>
						item.status === "PREPARED" ||
						(item.decision.runId === decision.runId &&
							(item.decision.actionId === decision.actionId ||
								item.decision.configDigest !== decision.configDigest)),
				)
			)
				throw new Error("Action requires a running owner, a fresh ID and the same frozen configuration");
			if (decision.decision === "ALLOW" && (decision.risk === "R2" || decision.risk === "R3")) {
				const run = next.runs.find((run) => run.runId === decision.runId);
				// COMPLEX: the attempt is the active task attempt (§10.1), not revisionCycle + 1.
				const implementing = run?.complex?.tasks.find((row) => ACTIVE_TASK_STATUSES.has(row.status));
				if (
					!run ||
					run.risk !== decision.risk ||
					!(run.workflow === "STANDARD" || (run.workflow === "COMPLEX" && run.complex)) ||
					run.quickScope ||
					run.phase !== "IMPLEMENT" ||
					run.currentStep?.stepId !== "implement" ||
					(run.workflow === "COMPLEX"
						? implementing?.status !== "IMPLEMENTING" || run.currentStep.attempt !== implementing.attempt
						: run.currentStep.attempt !== run.revisionCycle + 1) ||
					decision.role !== "Developer" ||
					!run.activeAgents.includes("Developer") ||
					run.roleSessionRefs.at(-1)?.role !== "Developer"
				)
					throw new Error("R2 intent requires a persisted STANDARD/R2 Developer session and review obligation");
			}
			if (decision.decision === "ALLOW" && decision.role === "Developer" && decision.risk !== "R0") {
				// COMPLEX mutation intent exists only inside the one IMPLEMENTING task attempt with its Developer session.
				const run = next.runs.find((run) => run.runId === decision.runId);
				const implementing = run?.complex?.tasks.find((row) => ACTIVE_TASK_STATUSES.has(row.status));
				if (
					run?.workflow === "COMPLEX" &&
					(!run.complex ||
						implementing?.status !== "IMPLEMENTING" ||
						run.currentStep?.stepId !== "implement" ||
						run.currentStep.attempt !== implementing.attempt ||
						!run.activeAgents.includes("Developer") ||
						run.roleSessionRefs.at(-1)?.role !== "Developer")
				)
					throw new Error(
						"COMPLEX mutation intent requires the active IMPLEMENTING task attempt and its Developer",
					);
			}
			if (decision.decision === "ALLOW" && decision.risk === "R3") {
				const run = next.runs.find((run) => run.runId === decision.runId)!;
				const grant = run.approvals?.find(
					(record) => record.request.actionId === decision.actionId && record.status === "APPROVED",
				);
				if (
					!grant ||
					!run.r3Scope ||
					grant.request.path !== run.r3Scope.targetPath ||
					grant.request.actionDigest !== decision.actionDigest ||
					grant.request.configDigest !== decision.configDigest ||
					grant.request.revision !== run.revisionCycle ||
					grant.request.step.stepId !== "implement" ||
					grant.request.step.attempt !== run.currentStep?.attempt ||
					grant.request.expiresAt <= (this.options.now ?? Date.now)()
				)
					throw new Error("R3 intent requires exact unexpired persisted human approval");
			}
			next.actions.push({ decision, status: decision.decision === "ALLOW" ? "PREPARED" : "DENIED" });
		});
	}
	async finish(runId: string, actionId: string, outcome: ActionOutcome): Promise<void> {
		await this.mutate((next) => {
			const action = next.actions.find(
				(item) => item.decision.runId === runId && item.decision.actionId === actionId,
			);
			if (!action || action.status !== "PREPARED") throw new Error("No pending action");
			action.status = outcome;
		});
	}
}

/** Scope must await worker cancellation/termination before returning; never release a live worker's lock. */
export async function withFileStateStore<T>(
	projectPath: string,
	operation: (store: FileStateStore) => Promise<T>,
	options?: FileStateStoreOptions,
): Promise<T> {
	const store = await FileStateStore.open(projectPath, options);
	try {
		return await operation(store);
	} finally {
		await store.close();
	}
}
