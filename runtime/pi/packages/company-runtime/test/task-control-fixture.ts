import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseRuntimeConfig } from "../src/config.ts";
import type { TaskPreparation } from "../src/contracts.ts";
import type { HostControlPreview, HostControlResponse } from "../src/host-control-protocol.ts";
import { FileStateStore } from "../src/state-store.ts";

export const sourceDigest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
interface Notice {
	kind: string;
	[key: string]: unknown;
}
function isNotice(value: unknown): value is Notice {
	return value !== null && typeof value === "object" && "kind" in value && typeof value.kind === "string";
}

/** Owns one actual Runtime stdio entry, with only a no-network model factory and exact test barriers injected. */
export function startTaskControl(cwd: string, home: string, mode = "success") {
	const child = fork(
		fileURLToPath(new URL("../src/launcher-control.ts", import.meta.url)),
		["--stdio", "--project-trusted", "--control"],
		{
			cwd,
			execArgv: ["--import", fileURLToPath(new URL("./fixtures/task-control-preload.ts", import.meta.url))],
			stdio: ["pipe", "pipe", "pipe", "ipc"],
			env: {
				PATH: process.env.PATH,
				HOME: home,
				WEAVRA_HOME: join(home, ".weavra"),
				WEAVRA_TASK_TEST_MODE: mode,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
			},
		},
	);
	assert.ok(child.stdin && child.stdout && child.stderr);
	const input = child.stdin;
	const notices: Notice[] = [];
	const noticeWaiters = new Set<{
		predicate: (notice: Notice) => boolean;
		resolve: (notice: Notice) => void;
		reject: (error: Error) => void;
	}>();
	const pending = new Map<
		string,
		{ resolve: (response: HostControlResponse) => void; reject: (error: Error) => void }
	>();
	let stderr = "";
	let exited = false;
	let sequence = 0;
	const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		child.once("exit", (code, signal) => {
			exited = true;
			const failure = new Error(`Owned stdio Host exited: ${code}/${signal}; ${stderr}`);
			for (const waiter of pending.values()) waiter.reject(failure);
			for (const waiter of noticeWaiters) waiter.reject(failure);
			resolve({ code, signal });
		});
	});
	child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
		stderr = (stderr + chunk).slice(-8192);
	});
	child.on("message", (value) => {
		if (!isNotice(value)) return;
		notices.push(value);
		for (const waiter of noticeWaiters) if (waiter.predicate(value)) waiter.resolve(value);
	});
	const lines = createInterface({ input: child.stdout });
	lines.on("line", (line) => {
		const response: HostControlResponse = JSON.parse(line);
		if (response.id) pending.get(response.id)?.resolve(response);
	});
	const request = (fields: Record<string, unknown>): Promise<HostControlResponse> => {
		const id = typeof fields.id === "string" ? fields.id : `read-${++sequence}`;
		return new Promise((resolve, reject) => {
			const signal = AbortSignal.timeout(20000);
			const finish = () => {
				signal.removeEventListener("abort", abort);
				pending.delete(id);
			};
			const abort = () => {
				finish();
				reject(new Error(`Stdio request deadline: ${id}; ${stderr}`));
			};
			pending.set(id, {
				resolve: (response) => {
					finish();
					resolve(response);
				},
				reject: (error) => {
					finish();
					reject(error);
				},
			});
			signal.addEventListener("abort", abort, { once: true });
			input.write(`${JSON.stringify({ protocolVersion: 1, ...fields, id })}\n`);
		});
	};
	const state = async () => {
		const response = await request({ type: "control.snapshot" });
		assert.ok(response.success && response.data.kind === "snapshot", JSON.stringify(response));
		return response.data.state;
	};
	return {
		child,
		notices,
		request,
		state,
		exit,
		async hello() {
			const response = await request({ type: "control.hello" });
			assert.ok(response.success && response.data.kind === "capabilities", JSON.stringify(response));
			assert.equal(response.data.capabilities.readiness, "READY");
			assert.equal(response.data.capabilities.taskBinding, 1);
			assert.equal(response.data.capabilities.analysisContext, 1);
			assert.equal(response.data.capabilities.evidenceDetails, 1);
			assert.equal(response.data.capabilities.checkoutIdentity, 1);
			return response.data.capabilities;
		},
		async mutate(fields: Record<string, unknown>) {
			const current = await state();
			return request({
				id: current.nextRequestId,
				ownerId: current.ownerId,
				expectedProjectRevision: current.projectRevision,
				...fields,
			});
		},
		async waitNotice(predicate: (notice: Notice) => boolean): Promise<Notice> {
			const previous = notices.find(predicate);
			if (previous) return previous;
			return new Promise((resolve, reject) => {
				const signal = AbortSignal.timeout(20000);
				const finish = () => {
					noticeWaiters.delete(waiter);
					signal.removeEventListener("abort", abort);
				};
				const abort = () => {
					finish();
					reject(new Error(`Stdio event deadline; ${stderr}`));
				};
				const waiter = {
					predicate,
					resolve: (value: Notice) => {
						finish();
						resolve(value);
					},
					reject: (error: Error) => {
						finish();
						reject(error);
					},
				};
				noticeWaiters.add(waiter);
				signal.addEventListener("abort", abort, { once: true });
			});
		},
		async stop() {
			if (!exited) {
				child.kill("SIGCONT");
				child.kill("SIGTERM");
			}
			const result = await exit;
			lines.close();
			for (const notice of notices)
				if (notice.kind === "harness-root" && typeof notice.path === "string")
					await rm(notice.path, { recursive: true, force: true });
			return result;
		},
	};
}
export type TaskControlClient = ReturnType<typeof startTaskControl>;
export function taskReceipt(response: HostControlResponse) {
	assert.ok(response.success && response.data.kind === "task-receipt", JSON.stringify(response));
	return response.data.receipt;
}

export async function taskControlProject(options: { checkBarrier?: string } = {}) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "weavra-task-control-")));
	const cwd = join(root, "project");
	const home = join(root, "home");
	for (const path of [
		cwd,
		home,
		join(home, ".weavra"),
		join(home, ".weavra/agent"),
		join(cwd, ".ai"),
		join(cwd, "src"),
		join(cwd, "checks"),
	])
		await mkdir(path, { mode: 0o700 });
	const config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "review" },
				},
			},
			runtime: { workflow: "STANDARD" },
			agents: { context_pack: { mode: "bounded" } },
			files: { allowed_paths: ["src"] },
			verification: {
				trust: { mode: "strict" },
				checks: [
					{
						id: "symptom",
						kind: "test",
						executable: process.execPath,
						args: ["checks/check.mjs"],
						timeout_ms: 3000,
					},
				],
			},
		}),
	);
	const original = "export const value = 0;\n";
	await writeFile(join(cwd, ".gitignore"), ".ai/\n");
	await writeFile(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	await writeFile(join(cwd, "src/value.ts"), original);
	await writeFile(
		join(cwd, "checks/check.mjs"),
		options.checkBarrier
			? `import { connect } from 'node:net'; const socket = connect(${JSON.stringify(options.checkBarrier)}); socket.on('connect', () => socket.write(String(process.pid) + '\\n')); socket.on('data', () => socket.end()); socket.on('close', () => process.exit(0));`
			: "import { readFileSync } from 'node:fs'; if (readFileSync('src/value.ts','utf8') !== 'export const value = 1;\\n') process.exit(1);\n",
	);
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			[
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@example.invalid",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{
				cwd,
				stdio: "pipe",
				env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
			},
		);
	git("init", "-q");
	git("add", "--", ".gitignore", "src", "checks");
	git("commit", "-qm", "Disposable task binding fixture");
	const task: TaskPreparation = {
		taskId: "11111111-1111-4111-8111-111111111111",
		environmentId: "environment",
		projectId: "project",
		threadId: " thread ",
		checkout: {
			canonicalCwd: cwd,
			repositoryRoot: cwd,
			headCommit: "0".repeat(40),
			workspaceDigest: `sha256:${"0".repeat(64)}`,
		},
		analysisContext: {
			version: 1,
			packetVersion: 1,
			authority: "ADVISORY_ONLY",
			reviewedAt: 100,
			symptom: "Value is zero",
			observations: [
				{ text: "Zero observed", provenance: "MODEL", reference: { kind: "source", path: "src/value.ts" } },
				{
					text: "Visible finding",
					provenance: "USER",
					reference: { kind: "message", threadId: " thread ", messageId: " message " },
				},
			],
			candidateCause: { kind: "HYPOTHESIS", text: "A constant may be incorrect" },
			uncertainties: [],
			sourceReferences: [{ path: "src/value.ts", digest: sourceDigest(original) }],
			constraints: [],
		},
		symptomVerification: { criterionIndex: 1, checkId: "symptom" },
	};
	const clients: TaskControlClient[] = [];
	return {
		root,
		cwd,
		home,
		config,
		task,
		prepareFields: {
			type: "workflow.prepare",
			goal: "Fix `value` bug in src/value.ts",
			acceptanceStatements: ["Value is one"],
			task,
		},
		async start(mode = "success") {
			const client = startTaskControl(cwd, home, mode);
			clients.push(client);
			await client.hello();
			if (task.checkout.headCommit === "0".repeat(40)) task.checkout = await readCheckout(client);
			return client;
		},
		async cleanup() {
			for (const client of clients) await client.stop();
			await rm(root, { recursive: true, force: true });
		},
	};
}

export async function prepareTask(
	client: TaskControlClient,
	fields: Record<string, unknown>,
): Promise<HostControlPreview> {
	const response = await client.mutate(fields);
	assert.ok(response.success && response.data.kind === "prepared", JSON.stringify(response));
	assert.ok(response.data.preview.taskBinding);
	return response.data.preview;
}
export function confirmTask(client: TaskControlClient, preview: HostControlPreview) {
	return client.mutate({
		type: "workflow.confirm",
		previewId: preview.previewId,
		previewDigest: preview.previewDigest,
		expectedProjectRevision: preview.projectRevision,
	});
}
export async function readTask(client: TaskControlClient, executionId: string) {
	return taskReceipt(await client.request({ type: "workflow.receipt", executionId }));
}
export async function readCheckout(client: TaskControlClient) {
	const response = await client.request({ type: "workflow.checkout" });
	assert.ok(response.success && response.data.kind === "checkout-identity", JSON.stringify(response));
	return response.data.checkout;
}
export async function durableTask(cwd: string, preview: HostControlPreview) {
	assert.ok(preview.taskBinding);
	const snapshot = await FileStateStore.readSnapshot(cwd);
	const receipt = await FileStateStore.readTaskReceipt(cwd, preview.taskBinding.executionId);
	const lock = snapshot.writerPresent ? JSON.parse(await readFile(join(cwd, ".ai/writer.lock"), "utf8")) : null;
	return { snapshot, receipt, lock };
}
