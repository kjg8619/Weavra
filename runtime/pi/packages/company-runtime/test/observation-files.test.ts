import { execFileSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { appendFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { classifyRequest } from "../src/classification.ts";
import { CompanyKernel } from "../src/kernel.ts";
import { isOwnedObservation, OBSERVATION_FILES, ownedObservationPaths } from "../src/observation-files.ts";
import type { PolicyContext } from "../src/policy.ts";
import { FileStateStore, type FileStateStoreOptions } from "../src/state-store.ts";
import { GitWorkspace } from "../src/workspace.ts";
import { testContract } from "./fixture-contract.ts";

const directories: string[] = [];
const stores: FileStateStore[] = [];
afterEach(async () => {
	for (const store of stores.splice(0)) await store.close().catch(() => {});
	for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function fixture(options?: FileStateStoreOptions) {
	const cwd = await mkdtemp(join(tmpdir(), "runtime-exports-"));
	directories.push(cwd);
	await mkdir(join(cwd, "src"));
	await mkdir(join(cwd, ".ai"));
	await writeFile(join(cwd, "src/app.ts"), "original\n");
	await writeFile(join(cwd, ".ai/config.yaml"), "fixture config");
	await writeFile(join(cwd, ".gitignore"), ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n");
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			env: { PATH: process.env.PATH, HOME: cwd, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
			stdio: "pipe",
		}).toString();
	git("init", "-q");
	git("add", "--", "src/app.ts", ".ai/config.yaml", ".gitignore");
	git(
		"-c",
		"user.name=Fixture",
		"-c",
		"user.email=fixture@invalid",
		"-c",
		"commit.gpgsign=false",
		"commit",
		"-m",
		"Export baseline",
	);
	const store = await FileStateStore.open(cwd, options);
	stores.push(store);
	const kernel = await CompanyKernel.create(
		{
			executionMode: "EDIT",
			runId: "run",
			task: testContract("Fix bug <script>\n# forged", {
				taskId: "task",
				statements: ["Fix bug"],
				checkIds: [],
			}),
			classification: classifyRequest("Fix bug").classification,
		},
		{
			store,
			agents: {
				execute: async (request) =>
					request.role === "Developer"
						? {
								role: "Developer",
								handoff: {
									runId: request.runId,
									revision: request.revision,
									role: "Developer",
									task: "task",
									changed_files: [],
									summary: "Fixture summary",
									assumptions: [],
									tests_run: [],
									known_risks: [],
									unresolved: [],
								},
							}
						: {
								role: "Reviewer",
								review: {
									runId: request.runId,
									revision: request.revision,
									role: "Reviewer",
									task: "task",
									result: "PASS",
									issues: [],
									criteria: [{ criterionId: "AC-001", status: "MET", evidenceRefs: ["fixture-evidence"] }],
									evidenceRefs: ["fixture-evidence"],
									diffDigest: "fixture-digest",
								},
							},
			},
			verifier: {
				verify: async (request) => ({
					runId: request.runId,
					revision: request.revision,
					step: request.step,
					diffDigest: "fixture-digest",
					evidenceRefs: ["fixture-evidence"],
					checks: [],
				}),
			},
		},
	);
	await kernel.start();
	while (kernel.snapshot.status === "RUNNING") await kernel.advance(kernel.snapshot.currentStep!.stepId);
	const policy: PolicyContext = {
		executionMode: "EDIT",
		executionRunId: "run",
		configDigest: "config",
		tools: [{ id: "runtime_edit", operation: "edit" }],
		allowedPaths: ["src", ".ai"],
	};
	return { cwd, store, git, policy };
}

describe("explicit owned observation exports", () => {
	it("exports deterministic projections without changing authority, then performs a no-op refresh", async () => {
		const { cwd, store } = await fixture();
		const before = await readFile(join(cwd, ".ai/state.json"), "utf8");
		const revision = store.snapshot.revision;
		expect((await store.exportViews()).updated).toBe(2);
		expect((await store.exportViews()).updated).toBe(0);
		expect(store.snapshot.revision).toBe(revision);
		expect(await readFile(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
		for (const path of OBSERVATION_FILES)
			expect(isOwnedObservation(path, await readFile(join(cwd, path), "utf8"))).toBe(true);
		const decisions = await readFile(join(cwd, ".ai/decisions.md"), "utf8");
		expect(decisions).toContain("classification:run");
		expect(decisions).toContain("review:run:0");
		expect(decisions).not.toContain("<script>");
		expect(decisions).not.toContain("\n# forged");
	});
	it("export-only open does not repair an existing tasks projection", async () => {
		const { cwd, store } = await fixture();
		await store.close();
		await writeFile(join(cwd, ".ai/tasks.json"), "USER_EDITED_PROJECTION");
		const exporter = await FileStateStore.open(cwd, { recoverInterrupted: false });
		stores.push(exporter);
		await exporter.exportViews();
		expect(await readFile(join(cwd, ".ai/tasks.json"), "utf8")).toBe("USER_EDITED_PROJECTION");
		expect((await FileStateStore.readSnapshot(cwd)).tasksCurrent).toBe(false);
	});
	it.each(["manual", "modified"])("never overwrites %s decisions", async (mode) => {
		const { cwd, store } = await fixture();
		if (mode === "modified") await store.exportViews();
		if (mode === "manual") await writeFile(join(cwd, ".ai/decisions.md"), "Human technical decisions\n");
		else await appendFile(join(cwd, ".ai/decisions.md"), "Human addition\n");
		const before = await readFile(join(cwd, ".ai/decisions.md"), "utf8");
		await expect(store.exportViews()).rejects.toThrow("manual or modified");
		expect(await readFile(join(cwd, ".ai/decisions.md"), "utf8")).toBe(before);
	});
	it("refuses symlinked logs without touching the external directory", async () => {
		const { cwd, store } = await fixture();
		const outside = await mkdtemp(join(tmpdir(), "runtime-export-outside-"));
		directories.push(outside);
		await symlink(outside, join(cwd, ".ai/logs"));
		await expect(store.exportViews()).rejects.toThrow();
		expect(await readdir(outside)).toEqual([]);
		expect(existsSync(join(cwd, ".ai/decisions.md"))).toBe(false);
	});
	it("reports partial projection failure while source state stays unchanged and retry is idempotent", async () => {
		let fail = true;
		const { cwd, store } = await fixture({
			beforeAtomicStep: (file, step) => {
				if (fail && file === "logs/checks.json" && step === "rename")
					throw new Error("Injected projection failure");
			},
		});
		const before = await readFile(join(cwd, ".ai/state.json"), "utf8");
		await expect(store.exportViews()).rejects.toThrow("Injected");
		expect(await readFile(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
		expect(store.snapshot.runs[0].status).toBe("COMPLETED");
		expect(await readdir(join(cwd, ".ai/logs"))).toEqual([]);
		fail = false;
		expect((await store.exportViews()).updated).toBe(1);
	});
	it("will not replace a destination changed immediately before rename", async () => {
		let project = "";
		const { cwd, store } = await fixture({
			beforeAtomicStep: (file, step) => {
				if (file === "decisions.md" && step === "rename")
					writeFileSync(join(project, ".ai/decisions.md"), "USER_NOTES");
			},
		});
		project = cwd;
		await expect(store.exportViews()).rejects.toThrow("changed before rename");
		expect(await readFile(join(cwd, ".ai/decisions.md"), "utf8")).toBe("USER_NOTES");
		expect((await readdir(join(cwd, ".ai"))).some((name) => name.endsWith(".tmp"))).toBe(false);
	});
});

describe("Git evidence ownership boundary", () => {
	it("excludes only intact generated views, not manual edits, and never changes gitignore", async () => {
		const { cwd, store, policy, git } = await fixture();
		const before = await GitWorkspace.open(cwd, policy);
		const original = await before.inspect();
		const ignore = await readFile(join(cwd, ".gitignore"), "utf8");
		await store.exportViews();
		expect((await before.inspect()).diffDigest).toBe(original.diffDigest);
		expect(git("status", "--porcelain")).toContain(".ai/decisions.md");
		await GitWorkspace.open(cwd, policy);
		await appendFile(join(cwd, ".ai/decisions.md"), "User change\n");
		const changed = await before.inspect();
		expect(changed.changedFiles).toContain(".ai/decisions.md");
		expect(changed.safe).toBe(false);
		expect(await readFile(join(cwd, ".gitignore"), "utf8")).toBe(ignore);
		await expect(GitWorkspace.open(cwd, policy)).rejects.toThrow("Dirty workspace");
	});
	it("does not exclude manually authored tracked decisions", async () => {
		const { cwd, store, policy, git } = await fixture();
		await store.close();
		await writeFile(join(cwd, ".ai/decisions.md"), "Manual architectural decision\n");
		git("add", "--", ".ai/decisions.md");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-m",
			"Manual decision fixture",
		);
		const workspace = await GitWorkspace.open(cwd, policy);
		await appendFile(join(cwd, ".ai/decisions.md"), "More user notes\n");
		expect((await workspace.inspect()).changedFiles).toContain(".ai/decisions.md");
	});
	it("refuses tracked generated views rather than hiding their git changes", async () => {
		const { cwd, store, policy, git } = await fixture();
		await store.exportViews();
		git("add", "--", ".ai/decisions.md");
		await expect(GitWorkspace.open(cwd, policy)).rejects.toThrow("must not be tracked");
	});
	it("detects manual edits to checks output even when Git ignores it", async () => {
		const { cwd, store, policy, git } = await fixture();
		await appendFile(join(cwd, ".gitignore"), ".ai/logs/checks.json\n");
		git("add", "--", ".gitignore");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-m",
			"Ignored view fixture",
		);
		await store.exportViews();
		const workspace = await GitWorkspace.open(cwd, policy);
		await appendFile(join(cwd, ".ai/logs/checks.json"), "manual change\n");
		const result = await workspace.inspect();
		expect(result.changedFiles).toContain(".ai/logs/checks.json");
		expect(result.safe).toBe(false);
	});
	it("does not use malformed exports as state authority", async () => {
		const { cwd, store } = await fixture();
		await store.exportViews();
		const before = await FileStateStore.readSnapshot(cwd);
		await writeFile(join(cwd, ".ai/logs/checks.json"), '{"status":"COMPLETED"}');
		expect((await ownedObservationPaths(cwd)).has(".ai/logs/checks.json")).toBe(false);
		expect((await FileStateStore.readSnapshot(cwd)).state).toEqual(before.state);
	});
});
