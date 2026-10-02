import { readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostEvidenceCursor } from "../src/host-control-protocol.ts";
import { FileStateStore } from "../src/state-store.ts";
import { readCheckoutIdentity } from "../src/workspace.ts";
import {
	confirmTask,
	durableTask,
	prepareTask,
	readCheckout,
	readTask,
	sourceDigest,
	startTaskControl,
	taskControlProject,
	taskReceipt,
} from "./task-control-fixture.ts";

let project: Awaited<ReturnType<typeof taskControlProject>>;
beforeEach(async () => {
	project = await taskControlProject();
});
afterEach(async () => {
	await project.cleanup();
});

it("returns the execution collector identity over stdio and uses it for task preparation", async () => {
	const expected = await readCheckoutIdentity(project.cwd, {
		allowedPaths: project.config.files.allowed_paths,
	});
	const client = await project.start();
	expect(project.task.checkout).toEqual(expected);
	expect(await readCheckout(client)).toEqual(expected);
	const preview = await prepareTask(client, project.prepareFields);
	expect(preview.taskBinding?.checkout).toEqual(expected);
	expect(preview.modelRoutes).toEqual([
		{
			role: "Developer",
			intent: "standard",
			source: "default",
			profile: "coding",
			provider: "faux",
			model: "coding",
		},
		{
			role: "Reviewer",
			intent: "review",
			source: "default",
			profile: "reasoning",
			provider: "faux",
			model: "review",
		},
	]);
	const state = await FileStateStore.readSnapshot(project.cwd);
	expect(state.state).toBeUndefined();
	expect(state.writerPresent).toBe(false);
	expect(client.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
});

it("previews explicit STANDARD and QUICK routes from normalized config without invoking models", async () => {
	await writeFile(
		join(project.cwd, ".ai/config.yaml"),
		JSON.stringify({
			...project.config,
			models: {
				profiles: project.config.models.profiles,
				intents: { simple: "reasoning", standard: "reasoning", review: "coding" },
			},
			runtime: { workflow: "adaptive" },
		}),
	);
	const client = await project.start();
	const standard = await prepareTask(client, project.prepareFields);
	expect(standard.modelRoutes).toEqual([
		{
			role: "Developer",
			intent: "standard",
			source: "config",
			profile: "reasoning",
			provider: "faux",
			model: "review",
		},
		{
			role: "Reviewer",
			intent: "review",
			source: "config",
			profile: "coding",
			provider: "faux",
			model: "coding",
		},
	]);
	const response = await client.mutate({ type: "workflow.prepare", goal: "Fix typo in src/value.ts" });
	expect(Buffer.byteLength(JSON.stringify(response)) + 1).toBeLessThanOrEqual(65_536);
	expect(response).toMatchObject({
		success: true,
		data: {
			kind: "prepared",
			preview: {
				workflow: "QUICK",
				modelRoutes: [
					{
						role: "Executor",
						intent: "simple",
						source: "config",
						profile: "reasoning",
						provider: "faux",
						model: "review",
					},
				],
			},
		},
	});
	const state = await FileStateStore.readSnapshot(project.cwd);
	expect(state.state).toBeUndefined();
	expect(state.writerPresent).toBe(false);
	expect(client.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
});

it("rejects checkout authority fields, dirty workspaces, and root drift without side effects", async () => {
	const client = await project.start();
	expect(await client.request({ type: "workflow.checkout", cwd: project.cwd })).toMatchObject({
		success: false,
		error: { code: "INVALID_REQUEST" },
	});
	await writeFile(join(project.cwd, "src/value.ts"), "export const value = 9;\n");
	expect(await client.request({ type: "workflow.checkout" })).toMatchObject({
		success: false,
		error: { code: "PROJECT_CHANGED" },
	});
	await writeFile(join(project.cwd, "src/value.ts"), "export const value = 0;\n");
	const moved = `${project.cwd}-moved`;
	await rename(project.cwd, moved);
	try {
		expect(await client.request({ type: "workflow.checkout" })).toMatchObject({
			success: false,
			error: { code: "PROJECT_CHANGED" },
		});
	} finally {
		await rename(moved, project.cwd);
	}
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(false);
	expect(client.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
});

it("refuses checkout capture while the current task owns the writer", async () => {
	const client = await project.start("paused-model");
	const preview = await prepareTask(client, project.prepareFields);
	await confirmTask(client, preview);
	await client.waitNotice((notice) => notice.kind === "model-initializing");
	expect(await client.request({ type: "workflow.checkout" })).toMatchObject({
		success: false,
		error: { code: "ACTIVE_RUN" },
	});
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(true);
	client.child.send("release-model");
	await client.waitNotice((notice) => notice.kind === "writer-closed");
});

it("fails closed when configuration changes during checkout capture", async () => {
	const client = startTaskControl(project.cwd, project.home, "checkout-config-drift");
	try {
		await client.hello();
		const response = client.request({ type: "workflow.checkout" });
		await client.waitNotice((notice) => notice.kind === "barrier" && notice.name === "checkout-config-drift");
		await writeFile(
			join(project.cwd, ".ai/config.yaml"),
			JSON.stringify({ ...project.config, files: { allowed_paths: ["src", "other"] } }),
		);
		client.child.kill("SIGCONT");
		expect(await response).toMatchObject({ success: false, error: { code: "CONFIG_CHANGED" } });
		expect(client.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
	} finally {
		await writeFile(join(project.cwd, ".ai/config.yaml"), JSON.stringify(project.config));
		await client.stop();
	}
});

it("fails closed when canonical state changes during checkout capture", async () => {
	const client = startTaskControl(project.cwd, project.home, "checkout-state-drift");
	try {
		await client.hello();
		const response = client.request({ type: "workflow.checkout" });
		await client.waitNotice((notice) => notice.kind === "barrier" && notice.name === "checkout-state-drift");
		await writeFile(join(project.cwd, ".ai/tasks.json"), "[]");
		client.child.kill("SIGCONT");
		expect(await response).toMatchObject({ success: false, error: { code: "STATE_UNAVAILABLE" } });
		expect(client.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
	} finally {
		await rm(join(project.cwd, ".ai/tasks.json"), { force: true });
		await client.stop();
	}
});

it("durably accepts before any Run, transfers the same writer, and completes through actual stdio", async () => {
	const client = await project.start("paused-model");
	const preview = await prepareTask(client, project.prepareFields);
	const binding = preview.taskBinding;
	if (!binding) throw new Error("Missing task binding");
	expect(binding.executionId).toMatch(/^[0-9a-f-]{36}$/);
	expect(binding.symptomVerification?.criterionId).toBe("AC-001");
	expect(preview.configDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(false);
	const accepted = await confirmTask(client, preview);
	expect(accepted).toMatchObject({
		success: true,
		projectRevision: 1,
		data: {
			kind: "accepted",
			taskReceipt: {
				status: "FOUND",
				executionId: binding.executionId,
				run: null,
				admission: { outcome: { status: "ACCEPTED" } },
			},
		},
	});
	await client.waitNotice((notice) => notice.kind === "model-initializing");
	const admitted = await durableTask(project.cwd, preview);
	expect(admitted.snapshot.state?.runs).toEqual([]);
	expect(admitted.snapshot.state?.revision).toBe(1);
	expect(admitted.snapshot.writerPresent).toBe(true);
	expect(await readTask(client, binding.executionId)).toMatchObject({
		status: "FOUND",
		run: null,
		admission: {
			metadata: { confirmedProjectRevision: 0, admittedProjectRevision: 1 },
			outcome: { status: "ACCEPTED" },
		},
	});
	client.child.send("release-model");
	await client.waitNotice((notice) => notice.kind === "writer-closed");
	const final = await readTask(client, binding.executionId);
	expect(final).toMatchObject({
		status: "FOUND",
		run: { status: "COMPLETED" },
		admission: { outcome: { status: "STARTED" } },
	});
	expect(client.notices.find((notice) => notice.kind === "run-lock")?.lock).toEqual(admitted.lock);
	const stored = (await FileStateStore.readSnapshot(project.cwd)).state;
	expect(stored?.runs).toHaveLength(1);
	expect(stored?.runs[0].taskBinding?.binding).toEqual(binding);
	expect(stored?.runs[0].verification.map((check) => [check.status, check.trust?.registrationDigest])).toEqual([
		["PASS", binding.symptomVerification?.registrationDigest],
		["PASS", binding.symptomVerification?.registrationDigest],
	]);
	const workers = client.notices.filter((notice) => notice.kind === "provider-use");
	expect(workers.map((worker) => worker.role)).toEqual(["Developer", "Developer", "Reviewer"]);
	expect(
		workers.every((worker) => worker.taskId === binding.executionId && worker.privateReasoningPresent === false),
	).toBe(true);
	expect(workers[0].packet).toEqual(project.task.analysisContext);
	expect(workers[2].packet).toEqual(project.task.analysisContext);
	expect(workers[2].historical).toBe(true);
	expect(workers[2].sources).toContainEqual({
		path: "src/value.ts",
		fileDigest: sourceDigest("export const value = 1;\n"),
	});
	expect(workers[2].contextDigest).not.toBe(workers[0].contextDigest);
	expect(workers[0].tools).toEqual([
		"runtime_read",
		"runtime_search",
		"runtime_list_files",
		"runtime_write",
		"runtime_edit",
		"runtime_request_check",
		"submit_handoff",
	]);
	expect(workers[0].projectFacts).toEqual([]);
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(false);
	expect(await readFile(join(project.cwd, "src/value.ts"), "utf8")).toBe("export const value = 1;\n");
});

it("reads every canonical evidence category without mutation and rejects stale or foreign bindings", async () => {
	const client = await project.start();
	const preview = await prepareTask(client, project.prepareFields);
	const binding = preview.taskBinding;
	if (!binding) throw new Error("Missing task binding");
	await confirmTask(client, preview);
	await client.waitNotice((notice) => notice.kind === "writer-closed");
	const receipt = await readTask(client, binding.executionId);
	if (receipt.status !== "FOUND" || !receipt.run) throw new Error("Missing completed bound Run");
	const requestBinding = {
		taskId: binding.taskId,
		environmentId: binding.environmentId,
		projectId: binding.projectId,
		threadId: binding.threadId,
		executionId: binding.executionId,
		runId: receipt.run.runId,
		revision: receipt.run.revision,
		diffDigest: null as string | null,
	};
	const before = await readFile(join(project.cwd, ".ai/state.json"), "utf8");
	const providerUses = client.notices.filter((notice) => notice.kind === "provider-use").length;
	let snapshot: { executionId: string; runId: string; revision: number; diffDigest: string } | undefined;
	const counts: Record<string, number> = {};
	for (const category of ["criteria", "checks", "changed-files", "trust-sources"] as const) {
		let cursor: HostEvidenceCursor | null = { category, index: 0 };
		counts[category] = 0;
		while (cursor) {
			const response = await client.request({
				type: "workflow.evidence",
				binding: { ...requestBinding, diffDigest: snapshot?.diffDigest ?? null },
				cursor,
			});
			expect(Buffer.byteLength(JSON.stringify(response)) + 1).toBeLessThanOrEqual(65_536);
			expect(response).toMatchObject({ success: true, data: { kind: "evidence-details" } });
			if (!response.success || response.data.kind !== "evidence-details") throw new Error("Missing evidence page");
			expect(response.data.ownership).toEqual({ writerPresent: false, cleanup: "confirmed" });
			snapshot ??= response.data.snapshot;
			expect(response.data.snapshot).toEqual(snapshot);
			counts[category] += response.data.records.length;
			cursor = response.data.nextCursor;
		}
	}
	expect(snapshot).toMatchObject({
		executionId: binding.executionId,
		runId: receipt.run.runId,
		revision: receipt.run.revision,
	});
	expect(counts).toMatchObject({ criteria: 1, checks: 2, "changed-files": 1 });
	expect(counts["trust-sources"]).toBeGreaterThanOrEqual(2);
	if (!snapshot) throw new Error("Missing evidence snapshot");
	for (const [patch, code] of [
		[{ projectId: "foreign-project" }, "RUN_NOT_OWNED"],
		[{ revision: receipt.run.revision - 1 }, "STALE_RUN"],
		[{ diffDigest: "0".repeat(64) }, "STALE_RUN"],
	] as const) {
		expect(
			await client.request({
				type: "workflow.evidence",
				binding: { ...requestBinding, diffDigest: snapshot.diffDigest, ...patch },
				cursor: { category: "checks", index: 0 },
			}),
		).toMatchObject({ success: false, error: { code } });
	}
	expect(
		await client.request({
			type: "workflow.evidence",
			binding: { ...requestBinding, diffDigest: snapshot.diffDigest },
			cursor: { category: "checks", index: 999 },
		}),
	).toMatchObject({ success: false, error: { code: "INVALID_REQUEST" } });
	expect(
		await client.request({
			type: "workflow.evidence",
			binding: {
				...requestBinding,
				executionId: "99999999-9999-4999-8999-999999999999",
				diffDigest: snapshot.diffDigest,
			},
			cursor: { category: "checks", index: 0 },
		}),
	).toMatchObject({ success: false, error: { code: "RUN_NOT_FOUND" } });
	expect(await readFile(join(project.cwd, ".ai/state.json"), "utf8")).toBe(before);
	expect(client.notices.filter((notice) => notice.kind === "provider-use")).toHaveLength(providerUses);
});

it("budgets large multibyte pages against the actual stdio response envelope", async () => {
	const client = await project.start();
	const preview = await prepareTask(client, project.prepareFields);
	const binding = preview.taskBinding;
	if (!binding) throw new Error("Missing binding");
	await confirmTask(client, preview);
	await client.waitNotice((notice) => notice.kind === "writer-closed");
	const state = (await FileStateStore.readSnapshot(project.cwd)).state;
	const run = state?.runs[0];
	if (!state || !run?.workspace) throw new Error("Missing fixture Run");
	// Synthetic historical rows exercise the real read-only transport, not actual filesystem changes.
	run.workspace.changedFiles = Array.from({ length: 120 }, (_, index) => `src/${"界".repeat(600)}/${index}.ts`);
	await writeFile(join(project.cwd, ".ai/state.json"), JSON.stringify(state));
	const before = await readFile(join(project.cwd, ".ai/state.json"), "utf8");
	let cursor: HostEvidenceCursor | null = { category: "changed-files", index: 0 };
	let count = 0;
	let maxBytes = 0;
	let byteLimited = false;
	while (cursor) {
		const response = await client.request({
			type: "workflow.evidence",
			binding: {
				taskId: binding.taskId,
				environmentId: binding.environmentId,
				projectId: binding.projectId,
				threadId: binding.threadId,
				executionId: binding.executionId,
				runId: run.runId,
				revision: run.revision,
				diffDigest: run.workspace.diffDigest,
			},
			cursor,
		});
		if (!response.success || response.data.kind !== "evidence-details") throw new Error("Missing page");
		const bytes = Buffer.byteLength(JSON.stringify(response)) + 1;
		expect(bytes).toBeLessThanOrEqual(65536);
		maxBytes = Math.max(maxBytes, bytes);
		count += response.data.records.length;
		byteLimited ||= response.data.nextCursor !== null && response.data.records.length < 50;
		if (response.data.nextCursor) expect(response.data.nextCursor.index).toBeGreaterThan(cursor.index);
		cursor = response.data.nextCursor;
	}
	expect(count).toBe(120);
	expect(maxBytes).toBeGreaterThan(60000);
	expect(byteLimited).toBe(true);
	expect(await readFile(join(project.cwd, ".ai/state.json"), "utf8")).toBe(before);
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(false);
});

it("resolves duplicates and conflicting same-task prepares without replay across a Host restart", async () => {
	const client = await project.start();
	const preview = await prepareTask(client, project.prepareFields);
	if (!preview.taskBinding) throw new Error("Missing binding");
	await confirmTask(client, preview);
	await client.waitNotice((notice) => notice.kind === "writer-closed");
	const first = await readTask(client, preview.taskBinding.executionId);
	expect(taskReceipt(await confirmTask(client, preview))).toEqual(first);
	expect(taskReceipt(await client.mutate(project.prepareFields))).toEqual(first);
	expect(await client.mutate({ ...project.prepareFields, goal: "Fix another bug" })).toMatchObject({
		success: false,
		error: { code: "PLAN_CHANGED" },
	});
	await client.stop();
	const restarted = await project.start("fail-model");
	const before = await readFile(join(project.cwd, ".ai/state.json"), "utf8");
	expect(await readTask(restarted, preview.taskBinding.executionId)).toEqual(first);
	expect(taskReceipt(await restarted.mutate(project.prepareFields))).toEqual(first);
	expect(await readTask(restarted, "99999999-9999-4999-8999-999999999999")).toEqual({
		status: "UNKNOWN",
		executionId: "99999999-9999-4999-8999-999999999999",
	});
	expect(await readFile(join(project.cwd, ".ai/state.json"), "utf8")).toBe(before);
	expect(restarted.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
});

it.each(["source", "config", "registration"] as const)(
	"rejects %s drift after preview without admission or worker use",
	async (kind) => {
		const client = await project.start();
		const preview = await prepareTask(client, project.prepareFields);
		switch (kind) {
			case "source":
				await writeFile(join(project.cwd, "src/value.ts"), "export const value = 9;\n");
				break;
			case "config":
				await writeFile(
					join(project.cwd, ".ai/config.yaml"),
					JSON.stringify({ ...project.config, files: { allowed_paths: ["src", "other"] } }),
				);
				break;
			case "registration": {
				const path = join(project.cwd, "checks/check.mjs");
				const source = await readFile(path, "utf8");
				await rm(path);
				await writeFile(path, source);
				break;
			}
		}
		expect(await confirmTask(client, preview)).toMatchObject({
			success: false,
			error: {
				code: kind === "config" ? "CONFIG_CHANGED" : kind === "registration" ? "PLAN_CHANGED" : "PROJECT_CHANGED",
			},
		});
		const state = await FileStateStore.readSnapshot(project.cwd);
		expect(state.state?.taskAdmissions).toBeUndefined();
		expect(state.writerPresent).toBe(false);
		expect(client.notices.some((notice) => notice.kind === "provider-use")).toBe(false);
	},
);

it("rejects model-route drift after preview before admission or provider invocation", async () => {
	const client = await project.start();
	const preview = await prepareTask(client, project.prepareFields);
	expect(preview.modelRoutes?.map(({ provider, model }) => `${provider}/${model}`)).toEqual([
		"faux/coding",
		"faux/review",
	]);
	await writeFile(
		join(project.cwd, ".ai/config.yaml"),
		JSON.stringify({
			...project.config,
			models: {
				...project.config.models,
				profiles: {
					...project.config.models.profiles,
					reasoning: { provider: "faux", model: "changed-review" },
				},
			},
		}),
	);
	expect(await confirmTask(client, preview)).toMatchObject({
		success: false,
		error: { code: "CONFIG_CHANGED" },
	});
	const state = await FileStateStore.readSnapshot(project.cwd);
	expect(state.state?.taskAdmissions).toBeUndefined();
	expect(state.writerPresent).toBe(false);
	expect(client.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
	expect(client.notices.some((notice) => notice.kind === "provider-use")).toBe(false);
});

it.each(["source", "config", "registration"] as const)(
	"settles admitted %s drift as START_FAILED before a Run exists",
	async (kind) => {
		const client = await project.start("paused-model");
		const preview = await prepareTask(client, project.prepareFields);
		if (!preview.taskBinding) throw new Error("Missing binding");
		await confirmTask(client, preview);
		await client.waitNotice((notice) => notice.kind === "model-initializing");
		if (kind === "source") await writeFile(join(project.cwd, "src/value.ts"), "export const value = 9;\n");
		else if (kind === "config")
			await writeFile(
				join(project.cwd, ".ai/config.yaml"),
				JSON.stringify({ ...project.config, files: { allowed_paths: ["src", "other"] } }),
			);
		else await writeFile(join(project.cwd, "checks/check.mjs"), "process.exit(0);\n");
		client.child.send("release-model");
		await client.waitNotice((notice) => notice.kind === "writer-closed");
		expect(await readTask(client, preview.taskBinding.executionId)).toMatchObject({
			status: "FOUND",
			run: null,
			admission: { outcome: { status: "START_FAILED", reasonCode: "STALE_PREPARATION" } },
		});
		expect((await FileStateStore.readSnapshot(project.cwd)).state?.runs).toEqual([]);
		expect(client.notices.some((notice) => notice.kind === "provider-use")).toBe(false);
	},
);

it("records model initialization failure without a fabricated Run", async () => {
	const client = await project.start("fail-model");
	const preview = await prepareTask(client, project.prepareFields);
	if (!preview.taskBinding) throw new Error("Missing binding");
	expect(await confirmTask(client, preview)).toMatchObject({ success: true, data: { kind: "accepted" } });
	await client.waitNotice((notice) => notice.kind === "writer-closed");
	expect(await readTask(client, preview.taskBinding.executionId)).toMatchObject({
		status: "FOUND",
		run: null,
		admission: { outcome: { status: "START_FAILED", reasonCode: "MODEL_UNAVAILABLE" } },
	});
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(false);
});

it("records a worker initialization failure and releases the admitted writer", async () => {
	const client = await project.start("paused-model");
	const preview = await prepareTask(client, project.prepareFields);
	if (!preview.taskBinding) throw new Error("Missing binding");
	await confirmTask(client, preview);
	await client.waitNotice((notice) => notice.kind === "model-initializing");
	await rm(join(project.home, ".weavra/agent"), { recursive: true });
	client.child.send("release-model");
	await client.waitNotice((notice) => notice.kind === "writer-closed");
	expect(await readTask(client, preview.taskBinding.executionId)).toMatchObject({
		status: "FOUND",
		run: null,
		admission: { outcome: { status: "START_FAILED", reasonCode: "INITIALIZATION_FAILED" } },
	});
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(false);
});

it.each(["provider", "model"] as const)(
	"records unavailable executor %s after model-runtime initialization",
	async (field) => {
		const config = structuredClone(project.config);
		config.models.profiles.coding[field] = "unavailable-fixture-model";
		await writeFile(join(project.cwd, ".ai/config.yaml"), JSON.stringify(config));
		const client = await project.start();
		const preview = await prepareTask(client, project.prepareFields);
		if (!preview.taskBinding) throw new Error("Missing binding");
		await confirmTask(client, preview);
		await client.waitNotice((notice) => notice.kind === "writer-closed");
		expect(await readTask(client, preview.taskBinding.executionId)).toMatchObject({
			status: "FOUND",
			run: null,
			admission: { outcome: { status: "START_FAILED", reasonCode: "MODEL_UNAVAILABLE" } },
		});
		expect(client.notices.some((notice) => notice.kind === "provider-use")).toBe(false);
		expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(false);
	},
);

it("rejects external canonical-state changes rather than treating them as its own admission revision", async () => {
	const client = await project.start("paused-model");
	const preview = await prepareTask(client, project.prepareFields);
	if (!preview.taskBinding) throw new Error("Missing binding");
	await confirmTask(client, preview);
	await client.waitNotice((notice) => notice.kind === "model-initializing");
	const path = join(project.cwd, ".ai/state.json");
	const state = (await FileStateStore.readSnapshot(project.cwd)).state;
	if (!state) throw new Error("Missing admission");
	await writeFile(path, JSON.stringify({ ...state, revision: state.revision + 1 }));
	client.child.send("release-model");
	await client.waitNotice((notice) => notice.kind === "workflow-settled");
	expect(await readTask(client, preview.taskBinding.executionId)).toMatchObject({
		status: "FOUND",
		run: null,
		admission: { outcome: { status: "ACCEPTED" } },
	});
	expect(client.notices.some((notice) => notice.kind === "provider-use")).toBe(false);
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(true);
	client.child.kill("SIGKILL");
	await client.exit;
	const restarted = await project.start("fail-model");
	const orphan = await readTask(restarted, preview.taskBinding.executionId);
	if (orphan.status !== "FOUND") throw new Error("Missing orphan admission");
	expect(await restarted.mutate({ type: "workflow.recover", metadata: orphan.admission.metadata })).toMatchObject({
		success: true,
		data: { kind: "task-recovery", disposition: "RECOVERED", cleanup: "CONFIRMED" },
	});
	expect(await readTask(restarted, preview.taskBinding.executionId)).toMatchObject({
		status: "FOUND",
		run: null,
		admission: { outcome: { status: "INTERRUPTED_BEFORE_START", reasonCode: "OWNER_LOST" } },
	});
});

it("rejects malformed packets and padded execution identities without normalization or a writer", async () => {
	const client = await project.start();
	for (const task of [
		{ ...project.task, taskId: ` ${project.task.taskId} ` },
		{ ...project.task, threadId: "other-thread" },
		{ ...project.task, analysisContext: { ...project.task.analysisContext, tools: ["write"] } },
		{
			...project.task,
			analysisContext: {
				...project.task.analysisContext,
				observations: [
					{
						text: "Visible input",
						provenance: "USER",
						reference: { kind: "message", threadId: " thread ", messageId: `${" ".repeat(9000)}message` },
					},
				],
			},
		},
	]) {
		expect(await client.mutate({ ...project.prepareFields, task })).toMatchObject({
			success: false,
			error: { code: "INVALID_REQUEST" },
		});
	}
	expect(
		await client.request({ type: "workflow.receipt", executionId: " 22222222-2222-4222-8222-222222222222 " }),
	).toMatchObject({
		success: false,
		error: { code: "INVALID_REQUEST" },
	});
	expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(false);
	expect(client.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
});

it("accepts the exact aggregate UTF-8 request limit and closes one byte above it", async () => {
	const client = await project.start();
	const state = await client.state();
	const request = {
		protocolVersion: 1,
		id: state.nextRequestId,
		ownerId: state.ownerId,
		expectedProjectRevision: state.projectRevision,
		...project.prepareFields,
		task: { ...project.task, environmentId: "" },
	};
	const available = 32768 - 1 - Buffer.byteLength(JSON.stringify(request));
	request.task.environmentId = "한".repeat(Math.floor(available / 3)) + "x".repeat(available % 3);
	expect(Buffer.byteLength(JSON.stringify(request)) + 1).toBe(32768);
	expect(await client.request(request)).toMatchObject({ success: true, data: { kind: "prepared" } });
	request.id = (await client.state()).nextRequestId;
	request.task.environmentId += "x";
	expect(Buffer.byteLength(JSON.stringify(request)) + 1).toBe(32769);
	await expect(client.request(request)).rejects.toThrow();
	expect((await client.exit).code).toBe(0);
	expect((await FileStateStore.readSnapshot(project.cwd)).state).toBeUndefined();
});

it("closes malformed UTF-8 on the actual stdio entry without interpreting replacement characters", async () => {
	const client = await project.start();
	client.child.stdin?.write(Buffer.from([123, 255, 125, 10]));
	expect((await client.exit).code).toBe(0);
	expect((await FileStateStore.readSnapshot(project.cwd)).state).toBeUndefined();
	expect(client.notices.some((notice) => notice.kind === "provider-use")).toBe(false);
});

it.each(["fail-accept-projection", "fail-run-projection"])(
	"retains canonical receipt and recovery proof when %s follows state.json commit",
	async (mode) => {
		const client = await project.start(mode);
		const preview = await prepareTask(client, project.prepareFields);
		if (!preview.taskBinding) throw new Error("Missing binding");
		const response = await confirmTask(client, preview);
		if (mode === "fail-accept-projection")
			expect(response).toMatchObject({ success: false, error: { code: "CONTROL_UNAVAILABLE" } });
		else {
			expect(response).toMatchObject({ success: true, data: { kind: "accepted" } });
			await client.waitNotice((notice) => notice.kind === "workflow-settled");
		}
		const before = await readTask(client, preview.taskBinding.executionId);
		expect(before).toMatchObject({
			status: "FOUND",
			admission: { outcome: { status: mode === "fail-accept-projection" ? "ACCEPTED" : "STARTED" } },
		});
		expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(true);
		expect(client.notices.some((notice) => notice.kind === "provider-use")).toBe(false);
		client.child.kill("SIGKILL");
		await client.exit;
		const restarted = await project.start("fail-model");
		if (before.status !== "FOUND") throw new Error("Missing orphan admission");
		// A task-associated UNCONFIRMED writer cannot be bypassed through generic prepare recovery.
		if (mode === "fail-run-projection") {
			const snapshot = await FileStateStore.readSnapshot(project.cwd);
			expect(await restarted.mutate(project.prepareFields)).toMatchObject({
				success: true,
				data: { kind: "task-receipt", receipt: before },
			});
			expect(
				await restarted.mutate({
					...project.prepareFields,
					task: { ...project.prepareFields.task, taskId: "33333333-3333-4333-8333-333333333333" },
				}),
			).toMatchObject({ success: false });
			expect(await FileStateStore.readSnapshot(project.cwd)).toEqual(snapshot);
		}
		expect(await restarted.mutate({ type: "workflow.recover", metadata: before.admission.metadata })).toMatchObject({
			success: true,
			data: {
				kind: "task-recovery",
				disposition: "RECOVERED",
				cleanup: mode === "fail-accept-projection" ? "CONFIRMED" : "UNCONFIRMED",
			},
		});
		const recovered = await readTask(restarted, preview.taskBinding.executionId);
		if (mode === "fail-accept-projection")
			expect(recovered).toMatchObject({ run: null, admission: { outcome: { status: "INTERRUPTED_BEFORE_START" } } });
		else expect(recovered).toMatchObject({ run: { status: "INTERRUPTED" } });
		expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(mode === "fail-run-projection");
	},
);

it("rechecks analysis at the first provider-use boundary after session persistence", async () => {
	const client = await project.start("late-source");
	const preview = await prepareTask(client, project.prepareFields);
	if (!preview.taskBinding) throw new Error("Missing binding");
	await confirmTask(client, preview);
	await client.waitNotice((notice) => notice.kind === "writer-closed");
	expect(await readTask(client, preview.taskBinding.executionId)).toMatchObject({
		status: "FOUND",
		run: { status: "FAILED" },
	});
	expect(client.notices.filter((notice) => notice.kind === "provider-use")).toEqual([]);
});

it("cannot turn advisory claims into fresh check evidence or completion", async () => {
	const client = await project.start("forged-pass");
	project.task.analysisContext.observations = [
		{
			text: "Tests passed",
			provenance: "HOST_OBSERVATION",
			reference: { kind: "message", threadId: " thread ", messageId: " visible " },
		},
	];
	const preview = await prepareTask(client, project.prepareFields);
	if (!preview.taskBinding) throw new Error("Missing binding");
	await confirmTask(client, preview);
	await client.waitNotice((notice) => notice.kind === "writer-closed");
	expect(await readTask(client, preview.taskBinding.executionId)).toMatchObject({
		status: "FOUND",
		run: { status: "BLOCKED" },
	});
	const run = (await FileStateStore.readSnapshot(project.cwd)).state?.runs[0];
	expect(run?.verification.map((check) => check.status)).toEqual(["FAIL"]);
	expect(run?.roleSessionRefs.map((ref) => ref.role)).toEqual(["Developer"]);
});

describe("actual process death and explicit dead-owner recovery", () => {
	it.each(["before-accept", "after-accept", "before-run", "after-run", "after-cleanup"])(
		"preserves the exact receipt at %s and never replays",
		async (window) => {
			const client = await project.start(window);
			const preview = await prepareTask(client, project.prepareFields);
			if (!preview.taskBinding) throw new Error("Missing binding");
			const confirming = confirmTask(client, preview).catch(() => undefined);
			await client.waitNotice((notice) => notice.kind === "barrier" && notice.name === window);
			client.child.kill("SIGKILL");
			expect((await client.exit).signal).toBe("SIGKILL");
			const response = await confirming;
			if (window === "before-accept" || window === "after-accept") expect(response).toBeUndefined();
			else expect(response).toMatchObject({ success: true, data: { kind: "accepted" } });
			const restarted = await project.start("fail-model");
			const before = await FileStateStore.readSnapshot(project.cwd);
			const receipt = await readTask(restarted, preview.taskBinding.executionId);
			if (window === "before-accept") expect(receipt.status).toBe("UNKNOWN");
			else
				expect(receipt).toMatchObject({
					status: "FOUND",
					admission: {
						outcome: { status: window === "after-accept" || window === "before-run" ? "ACCEPTED" : "STARTED" },
					},
				});
			expect(await FileStateStore.readSnapshot(project.cwd)).toEqual(before);
			if (window === "after-cleanup") {
				expect(receipt).toMatchObject({ run: { status: "COMPLETED" } });
				expect(before.writerPresent).toBe(false);
			} else {
				expect(before.writerPresent).toBe(true);
				expect(JSON.parse(await readFile(join(project.cwd, ".ai/writer.lock"), "utf8")).taskExecutionId).toBe(
					preview.taskBinding.executionId,
				);
				const metadata =
					receipt.status === "FOUND"
						? receipt.admission.metadata
						: {
								binding: preview.taskBinding,
								previewDigest: preview.previewDigest,
								configDigest: preview.configDigest,
								confirmedProjectRevision: preview.projectRevision,
								admittedProjectRevision: preview.projectRevision + 1,
							};
				const recovery = await restarted.mutate({ type: "workflow.recover", metadata });
				expect(recovery).toMatchObject({
					success: true,
					data: {
						kind: "task-recovery",
						disposition: window === "before-accept" ? "NOT_RECOVERED" : "RECOVERED",
						cleanup: window === "after-accept" ? "CONFIRMED" : "UNCONFIRMED",
						...(window === "before-accept" ? { reason: "UNKNOWN_ADMISSION" } : {}),
					},
				});
				const recovered = await readTask(restarted, preview.taskBinding.executionId);
				if (window === "before-accept") expect(recovered.status).toBe("UNKNOWN");
				else if (window === "after-run") expect(recovered).toMatchObject({ run: { status: "INTERRUPTED" } });
				else
					expect(recovered).toMatchObject({
						status: "FOUND",
						run: null,
						admission: { outcome: { status: "INTERRUPTED_BEFORE_START", reasonCode: "OWNER_LOST" } },
					});
				// UNKNOWN cannot be recovered; entered execution cannot infer descendant cleanup from PID death.
				expect((await FileStateStore.readSnapshot(project.cwd)).writerPresent).toBe(window !== "after-accept");
				expect(await readdir(join(project.cwd, ".ai"))).not.toContain("writer.lock.recovery");
			}
			expect(restarted.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
			expect((await FileStateStore.readSnapshot(project.cwd)).state?.runs.length ?? 0).toBe(
				window === "after-run" || window === "after-cleanup" ? 1 : 0,
			);
		},
	);
});
