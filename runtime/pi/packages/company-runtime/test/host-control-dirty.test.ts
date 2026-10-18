import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { HOST_DIRTY_WORKSPACE_MAX_FILES } from "../src/host-control-protocol.ts";
import { FileStateStore } from "../src/state-store.ts";
import { confirmTask, prepareTask, taskControlProject } from "./task-control-fixture.ts";

let project: Awaited<ReturnType<typeof taskControlProject>>;
beforeEach(async () => {
	project = await taskControlProject();
});
afterEach(async () => {
	await project.cleanup();
});

it("names the dirty paths of a refused task prepare without writes", async () => {
	const client = await project.start();
	// Not analysis sources: a changed source reference is refused earlier as PLAN_CHANGED.
	await writeFile(join(project.cwd, ".gitignore"), ".ai/\nbuild/\n");
	await writeFile(join(project.cwd, "notes.txt"), "untracked\n");
	const before = await FileStateStore.readSnapshot(project.cwd);

	expect(await client.mutate(project.prepareFields)).toMatchObject({
		success: false,
		command: "workflow.prepare",
		error: {
			code: "PROJECT_CHANGED",
			details: { reason: "DIRTY_WORKSPACE", files: [".gitignore", "notes.txt"], truncated: false },
		},
	});
	expect(await FileStateStore.readSnapshot(project.cwd)).toEqual(before);
	expect(before.writerPresent).toBe(false);
});

it("names the dirty paths of a refused checkout identity read without writes", async () => {
	const client = await project.start();
	// The App reads this identity before every prepare, so a dirty checkout must name its paths here too.
	await writeFile(join(project.cwd, "notes.txt"), "untracked\n");
	await writeFile(join(project.cwd, "src/value.ts"), "export const value = 9;\n");
	const before = await FileStateStore.readSnapshot(project.cwd);

	expect(await client.request({ type: "workflow.checkout" })).toMatchObject({
		success: false,
		command: "workflow.checkout",
		error: {
			code: "PROJECT_CHANGED",
			details: { reason: "DIRTY_WORKSPACE", files: ["notes.txt", "src/value.ts"], truncated: false },
		},
	});
	expect(await FileStateStore.readSnapshot(project.cwd)).toEqual(before);
	expect(before.writerPresent).toBe(false);
});

it("names the dirty paths of a refused task confirm and admits nothing", async () => {
	const client = await project.start();
	const preview = await prepareTask(client, project.prepareFields);
	await writeFile(join(project.cwd, "src/value.ts"), "export const value = 9;\n");

	expect(await confirmTask(client, preview)).toMatchObject({
		success: false,
		command: "workflow.confirm",
		error: {
			code: "PROJECT_CHANGED",
			details: { reason: "DIRTY_WORKSPACE", files: ["src/value.ts"], truncated: false },
		},
	});
	const after = await FileStateStore.readSnapshot(project.cwd);
	expect(after.state?.taskAdmissions ?? []).toEqual([]);
	expect(after.writerPresent).toBe(false);
	expect(client.notices.some((notice) => notice.kind === "model-initializing")).toBe(false);
});

it("bounds the named dirty paths and marks the rest truncated", async () => {
	const client = await project.start();
	const names = Array.from({ length: 60 }, (_, index) => `src/extra-${String(index).padStart(2, "0")}.ts`);
	for (const name of names) await writeFile(join(project.cwd, name), "untracked\n");

	const response = await client.mutate(project.prepareFields);
	expect(response).toMatchObject({
		success: false,
		error: { code: "PROJECT_CHANGED", details: { reason: "DIRTY_WORKSPACE", truncated: true } },
	});
	expect(!response.success && response.error.details?.files).toEqual(names.slice(0, HOST_DIRTY_WORKSPACE_MAX_FILES));
});

it("keeps a clean checkout drift refusal without details", async () => {
	const client = await project.start();
	const response = await client.mutate({
		...project.prepareFields,
		task: { ...project.task, checkout: { ...project.task.checkout, headCommit: "1".repeat(40) } },
	});
	expect(response).toMatchObject({ success: false, error: { code: "PROJECT_CHANGED" } });
	expect(!response.success && "details" in response.error).toBe(false);
});
