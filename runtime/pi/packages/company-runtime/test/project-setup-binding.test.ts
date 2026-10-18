import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { FileStateStore } from "../src/state-store.ts";
import { confirmTask, prepareTask, readCheckout, readTask, taskControlProject } from "./task-control-fixture.ts";

let project: Awaited<ReturnType<typeof taskControlProject>>;
beforeEach(async () => {
	project = await taskControlProject();
	await writeFile(join(project.cwd, ".gitignore"), "");
	execFileSync(
		"git",
		[
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@example.invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-am",
			"Allow unignored project metadata",
		],
		{ cwd: project.cwd, stdio: "pipe" },
	);
});
afterEach(async () => {
	await project.cleanup();
});

it("creates and prepares from untracked config and metadata without ignoring them in Git", async () => {
	await mkdir(join(project.cwd, ".ai/extra"));
	await writeFile(join(project.cwd, ".ai/extra/note"), "runtime metadata");
	const client = await project.start();
	const identity = await readCheckout(client);
	const preview = await prepareTask(client, project.prepareFields);
	expect(preview.taskBinding?.checkout).toEqual(identity);
	expect((await FileStateStore.readSnapshot(project.cwd)).state).toBeUndefined();
});

it("rejects changed untracked configuration after preview as CONFIG_CHANGED without admission", async () => {
	const client = await project.start();
	const preview = await prepareTask(client, project.prepareFields);
	await writeFile(
		join(project.cwd, ".ai/config.yaml"),
		JSON.stringify({ ...project.config, files: { allowed_paths: ["src", "other"] } }),
	);
	expect(await confirmTask(client, preview)).toMatchObject({ success: false, error: { code: "CONFIG_CHANGED" } });
	expect((await FileStateStore.readSnapshot(project.cwd)).state).toBeUndefined();
	expect(client.notices.some((notice) => notice.kind === "provider-use")).toBe(false);
});

it("fails closed on config drift after confirm before provider use while retaining reviewed bytes", async () => {
	const client = await project.start("paused-model");
	const preview = await prepareTask(client, project.prepareFields);
	if (!preview.taskBinding) throw new Error("Missing binding");
	const initialized = client.waitNotice((notice) => notice.kind === "model-initializing");
	await confirmTask(client, preview);
	await initialized;
	const changed = JSON.stringify({ ...project.config, files: { allowed_paths: ["src", "other"] } });
	await writeFile(join(project.cwd, ".ai/config.yaml"), changed);
	const settled = client.waitNotice((notice) => notice.kind === "writer-closed");
	client.child.send("release-model");
	await settled;
	expect(await readTask(client, preview.taskBinding.executionId)).toMatchObject({
		status: "FOUND",
		run: null,
		admission: { outcome: { status: "START_FAILED", reasonCode: "STALE_PREPARATION" } },
	});
	expect(client.notices.some((notice) => notice.kind === "provider-use")).toBe(false);
	expect(await readFile(join(project.cwd, ".ai/config.yaml"), "utf8")).toBe(changed);
});
