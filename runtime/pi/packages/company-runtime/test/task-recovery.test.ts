import { once } from "node:events";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TaskRunMetadata } from "../src/contracts.ts";
import { FileStateStore } from "../src/state-store.ts";
import { confirmTask, prepareTask, readTask, taskControlProject } from "./task-control-fixture.ts";

let project: Awaited<ReturnType<typeof taskControlProject>>;
beforeEach(async () => {
	project = await taskControlProject();
});
afterEach(async () => {
	vi.restoreAllMocks();
	await project.cleanup();
});

async function crash(window = "after-accept") {
	const client = await project.start(window);
	const preview = await prepareTask(client, project.prepareFields);
	if (!preview.taskBinding) throw new Error("Missing binding");
	const barrier = client.waitNotice((notice) => notice.kind === "barrier" && notice.name === window);
	const confirming = confirmTask(client, preview).catch(() => undefined);
	await barrier;
	const receipt = await FileStateStore.readTaskReceipt(project.cwd, preview.taskBinding.executionId);
	if (receipt.status !== "FOUND") throw new Error("Missing admitted receipt");
	client.child.kill("SIGKILL");
	await client.exit;
	await confirming;
	return receipt;
}
async function canonicalState() {
	const snapshot = await FileStateStore.readSnapshot(project.cwd);
	if (snapshot.state === undefined) throw new Error("Missing canonical state");
	return snapshot.state;
}
async function bytes() {
	return Promise.all(
		["state.json", "tasks.json", "writer.lock"].map((name) => readFile(join(project.cwd, ".ai", name), "utf8")),
	);
}

it.each(["after-accept", "before-run", "after-run", "before-cleanup-close"])(
	"recovers %s explicitly, preserves history/dirty files and never replays",
	async (window) => {
		const before = await crash(window);
		const dirtyPath = join(project.cwd, "src/value.ts");
		await writeFile(dirtyPath, "user partial changes; do not reset\n");
		const canonical = await canonicalState();
		const client = await project.start("fail-model");
		expect((await client.hello()).taskRecovery).toBe(1);
		const response = await client.mutate({ type: "workflow.recover", metadata: before.admission.metadata });
		const safe = window === "after-accept" || window === "before-cleanup-close";
		expect(response, JSON.stringify(response)).toMatchObject({
			success: true,
			data: { kind: "task-recovery", disposition: "RECOVERED", cleanup: safe ? "CONFIRMED" : "UNCONFIRMED" },
		});
		const after = await readTask(client, before.executionId);
		if (after.status !== "FOUND") throw new Error("Lost receipt");
		expect(after.admission.metadata).toEqual(before.admission.metadata);
		expect(after.admission.acceptedAt).toBe(before.admission.acceptedAt);
		if (before.run) {
			expect(after.run?.runId).toBe(before.run.runId);
			expect(after.run?.status).toBe(window === "before-cleanup-close" ? "COMPLETED" : "INTERRUPTED");
		} else expect(after.admission.outcome.status).toBe("INTERRUPTED_BEFORE_START");
		const settled = await FileStateStore.readSnapshot(project.cwd);
		expect(settled.writerPresent).toBe(!safe);
		expect(settled.state?.runs[0]?.verification).toEqual(canonical.runs[0]?.verification);
		expect(await readFile(dirtyPath, "utf8")).toBe("user partial changes; do not reset\n");
		const repeated = await client.mutate({ type: "workflow.recover", metadata: before.admission.metadata });
		expect(repeated).toMatchObject({
			success: true,
			data: { disposition: "ALREADY_SETTLED", cleanup: safe ? "CONFIRMED" : "UNCONFIRMED", receipt: after },
		});
		expect(await FileStateStore.readSnapshot(project.cwd)).toEqual(settled);
		if (!safe) {
			const proof = await bytes();
			await expect(FileStateStore.recoverDeadOwner(project.cwd)).resolves.toBeUndefined();
			await expect(FileStateStore.open(project.cwd)).rejects.toThrow();
			expect(await bytes()).toEqual(proof);
		}
		expect(client.notices.filter((notice) => ["model-initializing", "provider-use"].includes(notice.kind))).toEqual(
			[],
		);
		for (const notice of client.notices.filter((notice) => notice.kind === "runtime-event"))
			expect(notice.event).toMatchObject({ type: "RunInterrupted" });
	},
);

it.each([
	"metadata",
	"revision",
	"live",
	"legacy",
	"foreign",
	"unrelated",
	"unproven-cleanup",
	"guard",
	"malformed-pid",
	"wrong-path",
	"eperm",
	"unrelated-live",
])("refuses %s without canonical or writer changes", async (fault) => {
	const receipt = await crash();
	let metadata: TaskRunMetadata = receipt.admission.metadata;
	let revision = (await canonicalState()).revision;
	const lockPath = join(project.cwd, ".ai/writer.lock");
	const lock = JSON.parse(await readFile(lockPath, "utf8"));
	if (fault === "metadata") metadata = { ...metadata, previewDigest: `sha256:${"b".repeat(64)}` };
	if (fault === "revision") revision++;
	if (fault === "live" || fault === "unrelated-live") lock.pid = process.pid;
	if (fault === "malformed-pid") lock.pid = -1;
	if (fault === "wrong-path") lock.projectPath = `${project.cwd}-other`;
	if (fault === "eperm") {
		const kill = process.kill.bind(process);
		vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
			if (pid === lock.pid && signal === 0) throw Object.assign(new Error("Denied"), { code: "EPERM" });
			return kill(pid, signal);
		});
	}
	if (fault === "legacy") delete lock.taskExecutionId;
	if (fault === "foreign") lock.hostname = `${hostname()}-other`;
	if (fault === "unrelated" || fault === "unrelated-live")
		lock.taskExecutionId = "33333333-3333-4333-8333-333333333333";
	if (fault === "unproven-cleanup") {
		const path = join(project.cwd, ".ai/state.json");
		const state = JSON.parse(await readFile(path, "utf8"));
		delete state.taskAdmissions[0].cleanup;
		await writeFile(path, JSON.stringify(state));
	}
	await writeFile(lockPath, JSON.stringify(lock));
	if (fault === "guard") await writeFile(join(project.cwd, ".ai/writer.lock.recovery"), "existing guard");
	const before = await bytes();
	const result = await FileStateStore.recoverTask(project.cwd, metadata, revision);
	expect(result.disposition).toBe("NOT_RECOVERED");
	expect(result.cleanup).toBe("UNCONFIRMED");
	expect(await bytes()).toEqual(before);
});

it.each(["inode", "state"])("rechecks %s at lock replacement rather than trusting Host preflight", async (fault) => {
	const receipt = await crash();
	const revision = (await canonicalState()).revision;
	const lockPath = join(project.cwd, ".ai/writer.lock");
	let injected = false;
	// Existing synchronous failure hook is the deterministic pre-rename boundary.
	const result = await FileStateStore.recoverTask(project.cwd, receipt.admission.metadata, revision, {
		beforeAtomicStep: (file, step) => {
			if (file !== "writer.lock" || step !== "rename") return;
			injected = true;
			if (fault === "inode") {
				writeFileSync(`${lockPath}.replacement`, readFileSync(lockPath));
				renameSync(`${lockPath}.replacement`, lockPath);
			} else {
				const path = join(project.cwd, ".ai/state.json");
				const state = JSON.parse(readFileSync(path, "utf8"));
				state.revision++;
				writeFileSync(path, JSON.stringify(state));
			}
		},
	});
	expect(injected).toBe(true);
	expect(result.disposition).toBe("NOT_RECOVERED");
	expect(await FileStateStore.readTaskReceipt(project.cwd, receipt.executionId)).toEqual(receipt);
});

it.each(["state.json", "tasks.json"] as const)("preserves dead-owner proof after %s failure", async (file) => {
	const receipt = await crash();
	const before = await bytes();
	await expect(
		FileStateStore.recoverTask(project.cwd, receipt.admission.metadata, 1, {
			beforeAtomicStep: (target, step) => {
				if (target === file && step === "rename") throw new Error("Injected failure");
			},
		}),
	).rejects.toThrow();
	expect((await bytes())[2]).toBe(before[2]);
	const current = await canonicalState();
	const result = await FileStateStore.recoverTask(project.cwd, receipt.admission.metadata, current.revision);
	expect(result.cleanup).toBe("CONFIRMED");
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(false);
});

it("replays the same recovery response and restores receipt after response loss without revision churn", async () => {
	const receipt = await crash();
	const client = await project.start("fail-model");
	const state = await client.state();
	const request = {
		id: state.nextRequestId,
		ownerId: state.ownerId,
		expectedProjectRevision: state.projectRevision,
		type: "workflow.recover",
		metadata: receipt.admission.metadata,
	};
	const first = await client.request(request);
	expect(first).toMatchObject({ success: true, data: { disposition: "RECOVERED" } });
	const settled = await FileStateStore.readSnapshot(project.cwd);
	expect(await client.request(request)).toEqual(first);
	await client.stop();
	const restarted = await project.start("fail-model");
	expect(await restarted.mutate({ type: "workflow.recover", metadata: receipt.admission.metadata })).toMatchObject({
		success: true,
		data: { disposition: "ALREADY_SETTLED", cleanup: "CONFIRMED" },
	});
	expect(await FileStateStore.readSnapshot(project.cwd)).toEqual(settled);
	expect(restarted.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
});

it("preserves failed verifier evidence and terminal status with unconfirmed cleanup", async () => {
	const receipt = await crash("failed-before-cleanup");
	const before = await canonicalState();
	expect(receipt.run?.status).toBe("BLOCKED");
	expect(before.runs[0]?.verification.map((check) => check.status)).toEqual(["FAIL"]);
	const lock = (await bytes())[2];
	const result = await FileStateStore.recoverTask(project.cwd, receipt.admission.metadata, before.revision);
	expect(result).toMatchObject({ disposition: "ALREADY_SETTLED", cleanup: "UNCONFIRMED", receipt });
	expect((await FileStateStore.readSnapshot(project.cwd)).state).toEqual(before);
	expect((await bytes())[2]).toBe(lock);
});

it("rechecks canonical CAS immediately before state commit and restores owner proof on drift", async () => {
	const receipt = await crash();
	const originalLock = (await bytes())[2];
	let injected: string | undefined;
	await expect(
		FileStateStore.recoverTask(project.cwd, receipt.admission.metadata, 1, {
			beforeAtomicStep: (file, step) => {
				if (file !== "state.json" || step !== "rename") return;
				const path = join(project.cwd, ".ai/state.json");
				const state = JSON.parse(readFileSync(path, "utf8"));
				state.revision++;
				injected = JSON.stringify(state);
				writeFileSync(path, injected);
			},
		}),
	).rejects.toThrow();
	expect(await readFile(join(project.cwd, ".ai/state.json"), "utf8")).toBe(injected);
	expect((await bytes())[2]).toBe(originalLock);
});

it("restores proven-dead protection on close failure; retry closes without re-interruption", async () => {
	const receipt = await crash();
	const originalLock = (await bytes())[2];
	vi.spyOn(FileStateStore.prototype, "close").mockRejectedValueOnce(new Error("Injected close failure"));
	await expect(FileStateStore.recoverTask(project.cwd, receipt.admission.metadata, 1)).rejects.toThrow(
		"Injected close failure",
	);
	expect((await bytes())[2]).toBe(originalLock);
	const settled = await canonicalState();
	const result = await FileStateStore.recoverTask(project.cwd, receipt.admission.metadata, settled.revision);
	expect(result.cleanup).toBe("CONFIRMED");
	expect((await FileStateStore.readSnapshot(project.cwd)).state).toEqual(settled);
});

it("excludes a concurrent recoverer through the guarded initialization boundary", async () => {
	const receipt = await crash();
	const prototype = FileStateStore.prototype;
	const initialize = Reflect.get(prototype, "initialize");
	if (typeof initialize !== "function") throw new Error("Missing store initialization boundary");
	let entered!: () => void;
	let release!: () => void;
	const ready = new Promise<void>((resolve) => {
		entered = resolve;
	});
	const proceed = new Promise<void>((resolve) => {
		release = resolve;
	});
	Reflect.set(prototype, "initialize", async function (this: FileStateStore) {
		entered();
		await proceed;
		return Reflect.apply(initialize, this, []);
	});
	try {
		const first = FileStateStore.recoverTask(project.cwd, receipt.admission.metadata, 1);
		await ready;
		expect(await FileStateStore.recoverTask(project.cwd, receipt.admission.metadata, 1)).toMatchObject({
			disposition: "NOT_RECOVERED",
		});
		release();
		expect(await first).toMatchObject({ disposition: "RECOVERED", cleanup: "CONFIRMED" });
	} finally {
		release();
		Reflect.set(prototype, "initialize", initialize);
	}
});

it("does not infer detached check cleanup from Host death or cleared activeAgents", async () => {
	await project.cleanup();
	const socketRoot = await mkdtemp(join(tmpdir(), "task-check-"));
	const socketPath = join(socketRoot, "barrier.sock");
	const server = createServer();
	let socket: Socket | undefined;
	let pid: number | undefined;
	const connected = new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.once("connection", (connection) => {
			socket = connection;
			connection.once("data", (data) => {
				pid = Number(data.toString().trim());
				resolve();
			});
		});
	});
	try {
		server.listen(socketPath);
		await once(server, "listening");
		project = await taskControlProject({ checkBarrier: socketPath });
		const client = await project.start();
		const preview = await prepareTask(client, project.prepareFields);
		if (!preview.taskBinding) throw new Error("Missing task binding");
		await confirmTask(client, preview);
		await connected;
		if (!pid || !socket) throw new Error("Check did not reach its registered command barrier");
		const receipt = await FileStateStore.readTaskReceipt(project.cwd, preview.taskBinding.executionId);
		if (receipt.status !== "FOUND") throw new Error("Missing receipt");
		const dirty = await readFile(join(project.cwd, "src/value.ts"), "utf8");
		client.child.kill("SIGKILL");
		await client.exit;
		expect(() => process.kill(pid!, 0)).not.toThrow();
		const restarted = await project.start("fail-model");
		expect(await restarted.mutate({ type: "workflow.recover", metadata: receipt.admission.metadata })).toMatchObject({
			success: true,
			data: { disposition: "RECOVERED", cleanup: "UNCONFIRMED", receipt: { run: { status: "INTERRUPTED" } } },
		});
		const state = await FileStateStore.readSnapshot(project.cwd);
		expect(state.state?.runs[0]?.activeAgents).toEqual([]);
		expect(state.writerPresent).toBe(true);
		expect(() => process.kill(pid!, 0)).not.toThrow();
		expect(
			await restarted.mutate({
				...project.prepareFields,
				task: { ...project.prepareFields.task, taskId: "33333333-3333-4333-8333-333333333333" },
			}),
		).toMatchObject({ success: false });
		expect(await FileStateStore.readSnapshot(project.cwd)).toEqual(state);
		expect(await readFile(join(project.cwd, "src/value.ts"), "utf8")).toBe(dirty);
		const closed = once(socket, "close");
		socket.write("release");
		await closed;
		// Even independently stopping the fixture check does not forge a canonical cleanup attestation.
		expect(await restarted.mutate({ type: "workflow.recover", metadata: receipt.admission.metadata })).toMatchObject({
			success: true,
			data: { disposition: "ALREADY_SETTLED", cleanup: "UNCONFIRMED" },
		});
	} finally {
		if (socket && !socket.destroyed) socket.destroy();
		if (pid) {
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				/* Already exited. */
			}
		}
		await new Promise<void>((resolve) => server.close(() => resolve()));
		await rm(socketRoot, { recursive: true, force: true });
	}
});

it("retains unconfirmed canonical lifecycle proof when its own projection commit fails before Git or Run", async () => {
	const client = await project.start("fail-cleanup-entry-projection");
	const preview = await prepareTask(client, project.prepareFields);
	if (!preview.taskBinding) throw new Error("Missing task binding");
	const settled = client.waitNotice((notice) => notice.kind === "workflow-settled");
	await confirmTask(client, preview);
	await settled;
	const receipt = await readTask(client, preview.taskBinding.executionId);
	expect(receipt).toMatchObject({
		status: "FOUND",
		run: null,
		admission: { outcome: { status: "ACCEPTED" }, cleanup: "UNCONFIRMED" },
	});
	expect(client.notices.some((notice) => notice.kind === "provider-use")).toBe(false);
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(true);
	if (receipt.status !== "FOUND") throw new Error("Missing canonical admission");
	client.child.kill("SIGKILL");
	await client.exit;
	const current = await canonicalState();
	const result = await FileStateStore.recoverTask(project.cwd, receipt.admission.metadata, current.revision);
	expect(result).toMatchObject({
		disposition: "RECOVERED",
		cleanup: "UNCONFIRMED",
		receipt: { run: null, admission: { outcome: { status: "INTERRUPTED_BEFORE_START" }, cleanup: "UNCONFIRMED" } },
	});
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(true);
});
