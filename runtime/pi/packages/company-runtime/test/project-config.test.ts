import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectConfigError, readProjectConfig, updateProjectConfig } from "../src/project-config.ts";
import { FileStateStore } from "../src/state-store.ts";

const yaml = `schemaVersion: 1
models:
  profiles:
    coding: { provider: faux, model: coding }
    reasoning: { provider: faux, model: reasoning }
`;
const projects: string[] = [];

async function project(): Promise<string> {
	const cwd = await mkdtemp(join(tmpdir(), "project-config-"));
	projects.push(cwd);
	execFileSync("git", ["init", "-q", cwd]);
	return cwd;
}

afterEach(async () => {
	await Promise.all(projects.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

describe("readProjectConfig", () => {
	it("reports missing config without creating project files", async () => {
		const cwd = await project();
		await expect(readProjectConfig(cwd)).rejects.toMatchObject({
			name: "ProjectConfigError",
			code: "CONFIG_MISSING",
		});
		expect(await readFile(join(cwd, ".git", "HEAD"), "utf8")).toContain("ref:");
		await expect(readFile(join(cwd, ".ai"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("reads exact UTF-8 bytes and hashes them without rewriting", async () => {
		const cwd = await project();
		await mkdir(join(cwd, ".ai"));
		const path = join(cwd, ".ai", "config.yaml");
		const exact = Buffer.from(`${yaml}# exact trailing bytes \n`, "utf8");
		await writeFile(path, exact);
		const result = await readProjectConfig(cwd);
		expect(result).toEqual({
			yaml: exact.toString("utf8"),
			configDigest: `sha256:${createHash("sha256").update(exact).digest("hex")}`,
		});
		expect(await readFile(path)).toEqual(exact);
	});

	it("rejects non-Git roots and unsafe .ai directories", async () => {
		const cwd = await project();
		const nested = join(cwd, "nested");
		await mkdir(nested);
		await expect(readProjectConfig(nested)).rejects.toMatchObject({ code: "UNSAFE_PATH" });
		const outside = await mkdtemp(join(tmpdir(), "project-config-outside-"));
		projects.push(outside);
		await symlink(outside, join(cwd, ".ai"));
		await expect(readProjectConfig(cwd)).rejects.toMatchObject({ code: "UNSAFE_PATH" });
	});

	it("rejects config symlinks and hardlinks", async () => {
		const cwd = await project();
		await mkdir(join(cwd, ".ai"));
		const path = join(cwd, ".ai", "config.yaml");
		const outside = join(cwd, "outside.yaml");
		await writeFile(outside, yaml);
		await symlink(outside, path);
		await expect(readProjectConfig(cwd)).rejects.toMatchObject({ code: "UNSAFE_PATH" });
		await rm(path);
		await link(outside, path);
		await expect(readProjectConfig(cwd)).rejects.toMatchObject({ code: "UNSAFE_PATH" });
	});

	it("rejects malformed, invalid UTF-8, and oversized config", async () => {
		const cwd = await project();
		await mkdir(join(cwd, ".ai"));
		const path = join(cwd, ".ai", "config.yaml");
		for (const contents of [Buffer.from("schemaVersion: ["), Buffer.from([0xff]), Buffer.alloc(65_537, 0x20)]) {
			await writeFile(path, contents);
			await expect(readProjectConfig(cwd)).rejects.toBeInstanceOf(ProjectConfigError);
			await expect(readProjectConfig(cwd)).rejects.toMatchObject({ code: "INVALID_CONFIG" });
		}
	});
});

describe("updateProjectConfig", () => {
	it("replaces exact config bytes and releases its writer lease", async () => {
		const cwd = await project();
		await mkdir(join(cwd, ".ai"));
		const path = join(cwd, ".ai", "config.yaml");
		await writeFile(path, yaml);
		const before = await readProjectConfig(cwd);
		const updated = `${yaml}# updated\n`;
		const result = await updateProjectConfig(cwd, before.configDigest, updated);
		expect(result).toEqual({
			yaml: updated,
			configDigest: `sha256:${createHash("sha256").update(updated).digest("hex")}`,
		});
		expect(await readFile(path, "utf8")).toBe(updated);
		await expect(readFile(join(cwd, ".ai", "writer.lock"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("allows only one concurrent update using the same digest", async () => {
		const cwd = await project();
		await mkdir(join(cwd, ".ai"));
		await writeFile(join(cwd, ".ai", "config.yaml"), yaml);
		const before = await readProjectConfig(cwd);
		const results = await Promise.allSettled([
			updateProjectConfig(cwd, before.configDigest, `${yaml}# first\n`),
			updateProjectConfig(cwd, before.configDigest, `${yaml}# second\n`),
		]);
		expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
		expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
	});

	it("rejects invalid and stale updates without changing existing bytes", async () => {
		const cwd = await project();
		await mkdir(join(cwd, ".ai"));
		const path = join(cwd, ".ai", "config.yaml");
		const original = Buffer.from(`${yaml}# preserved\n`);
		await writeFile(path, original);
		const before = await readProjectConfig(cwd);
		await expect(updateProjectConfig(cwd, before.configDigest, "schemaVersion: [")).rejects.toMatchObject({
			code: "INVALID_CONFIG",
		});
		await expect(updateProjectConfig(cwd, "sha256:stale", yaml)).rejects.toMatchObject({ code: "STALE_CONFIG" });
		expect(await readFile(path)).toEqual(original);
	});

	it("rejects live and stale writer locks without recovering either", async () => {
		const cwd = await project();
		await mkdir(join(cwd, ".ai"));
		const path = join(cwd, ".ai", "config.yaml");
		await writeFile(path, yaml);
		const digest = (await readProjectConfig(cwd)).configDigest;
		const live = await FileStateStore.open(cwd);
		try {
			await expect(updateProjectConfig(cwd, digest, `${yaml}# denied\n`)).rejects.toMatchObject({
				code: "WORKSPACE_BUSY",
			});
		} finally {
			await live.close();
		}
		const lockPath = join(cwd, ".ai", "writer.lock");
		await writeFile(
			lockPath,
			JSON.stringify({
				schemaVersion: 1,
				projectPath: cwd,
				token: "stale",
				pid: 2_000_000_000,
				hostname: "elsewhere",
			}),
			{ flag: "wx" },
		);
		await expect(updateProjectConfig(cwd, digest, `${yaml}# denied\n`)).rejects.toMatchObject({
			code: "WORKSPACE_BUSY",
		});
		expect(await readFile(path, "utf8")).toBe(yaml);
		expect(await readFile(lockPath, "utf8")).toContain('"token":"stale"');
	});

	it("rejects active runtime state without changing it", async () => {
		const cwd = await project();
		await mkdir(join(cwd, ".ai"));
		const directory = join(cwd, ".ai");
		const configPath = join(directory, "config.yaml");
		const statePath = join(directory, "state.json");
		await writeFile(configPath, yaml);
		const run = {
			schemaVersion: 1,
			revision: 0,
			eventSequence: 0,
			currentStep: null,
			runId: "run-active",
			goal: "Fix login",
			status: "RUNNING",
			phase: "IMPLEMENT",
			workflow: "STANDARD",
			classification: {
				intent: "bugfix",
				complexity: "STANDARD",
				risk: "R1",
				confidence: null,
				reason: "Explicit bug report",
			},
			risk: "R1",
			currentTask: "task-1",
			tasks: [
				{ id: "task-1", goal: "Fix login", requirements: ["Expired tokens return 401"], status: "in_progress" },
			],
			activeAgents: [],
			completed: [],
			next: ["Implement"],
			roleSessionRefs: [],
			revisionCycle: 0,
			verification: [],
			lastError: null,
			createdAt: 1,
			updatedAt: 1,
		};
		const state = Buffer.from(JSON.stringify({ schemaVersion: 1, revision: 1, runs: [run], actions: [] }));
		await writeFile(statePath, state);
		const digest = (await readProjectConfig(cwd)).configDigest;
		await expect(updateProjectConfig(cwd, digest, `${yaml}# denied\n`)).rejects.toMatchObject({
			code: "WORKSPACE_BUSY",
		});
		expect(await readFile(statePath)).toEqual(state);
		expect(await readFile(configPath, "utf8")).toBe(yaml);
		await expect(readFile(join(directory, "writer.lock"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("preserves existing state and projection bytes", async () => {
		const cwd = await project();
		await mkdir(join(cwd, ".ai"));
		const directory = join(cwd, ".ai");
		const configPath = join(directory, "config.yaml");
		const statePath = join(directory, "state.json");
		const tasksPath = join(directory, "tasks.json");
		await writeFile(configPath, yaml);
		const state = Buffer.from('{"schemaVersion":1,"revision":0,"runs":[],"actions":[],"projectFacts":[]}\n');
		const projection = Buffer.from('{"schemaVersion":1,"revision":0,"tasks":[]}\n');
		await writeFile(statePath, state);
		await writeFile(tasksPath, projection);
		const digest = (await readProjectConfig(cwd)).configDigest;
		await updateProjectConfig(cwd, digest, `${yaml}# next\n`);
		expect(await readFile(statePath)).toEqual(state);
		expect(await readFile(tasksPath)).toEqual(projection);
	});
});
