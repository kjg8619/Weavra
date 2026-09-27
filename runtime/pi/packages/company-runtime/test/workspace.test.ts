import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as filesystem from "node:fs/promises";
import {
	appendFile,
	chmod,
	link,
	lstat,
	mkdir,
	mkdtemp,
	open,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	truncate,
	utimes,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import { GitWorkspace, probeWorkspaceEvidence, WorkspaceEvidenceError } from "../src/workspace.ts";

// Keep real IO; make only the ESM export surface spyable for deterministic read-boundary mutations.
vi.mock("node:fs/promises", async (importOriginal) => ({ ...(await importOriginal<typeof filesystem>()) }));

const MiB = 1024 * 1024;
const mode = "bounded-monorepo";
const directories: string[] = [];
const policy: PolicyContext = {
	executionMode: "EDIT",
	executionRunId: "workspace-test",
	configDigest: "config",
	allowedPaths: ["src"],
	tools: [{ id: "runtime_edit", operation: "edit" }],
};
async function fixture() {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "weavra-evidence-")));
	directories.push(cwd);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
			maxBuffer: 16 * MiB,
		}).toString();
	const put = async (path: string, bytes: string | Buffer) => {
		await mkdir(dirname(join(cwd, path)), { recursive: true });
		await writeFile(join(cwd, path), bytes);
	};
	const commit = () => {
		git("add", "--", ".");
		git(
			"-c",
			"user.name=Fixture",
			"-c",
			"user.email=fixture@invalid",
			"-c",
			"commit.gpgsign=false",
			"commit",
			"-qm",
			"fixture",
		);
	};
	await put("src/app.ts", "original\n");
	git("init", "-q");
	commit();
	return { cwd, git, put, commit };
}
const inspectable = (cwd: string) => GitWorkspace.open(cwd, policy, undefined, mode);
const probe = (cwd: string) => probeWorkspaceEvidence(cwd, { allowedPaths: policy.allowedPaths, evidenceMode: mode });

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

describe("bounded-monorepo workspace evidence", () => {
	it("preserves the default digest and policy authority; probe leaves no runtime files or reusable baseline", async () => {
		const { cwd, git } = await fixture();
		const before = await readdir(cwd);
		const index = await readFile(join(cwd, ".git/index"));
		const workspace = await GitWorkspace.open(cwd, policy);
		const snapshot = await workspace.inspect();
		const image = await lstat(join(cwd, "src/app.ts"));
		const hash = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
		expect(snapshot.diffDigest).toBe(
			hash(
				JSON.stringify({
					head: git("rev-parse", "HEAD").trim(),
					index: git("ls-files", "--stage", "-z"),
					gitConfig: hash(await readFile(join(cwd, ".git/config"))),
					files: [["src/app.ts", image.mode & 0o777, hash("original\n")]],
				}),
			),
		);
		expect(await probe(cwd)).toEqual({ fileCount: 1, totalBytes: 9 });
		expect(await readdir(cwd)).toEqual(before);
		expect(await readFile(join(cwd, ".git/index"))).toEqual(index);
		expect(git("status", "--porcelain")).toBe("");
	});

	it("admits an index over 2 MiB independently of entry and regular-byte limits", async () => {
		const { cwd, git, put, commit } = await fixture();
		const prefix = Array.from({ length: 4 }, (_, index) => `${index}${"a".repeat(199)}`).join("/");
		for (let index = 0; index < 2500; index++)
			await put(`${prefix}/${String(index).padStart(4, "0")}${"b".repeat(70)}`, "x");
		commit();
		expect(Buffer.byteLength(git("ls-files", "--stage", "-z"))).toBeGreaterThan(2 * MiB);
		await expect(GitWorkspace.open(cwd, policy)).rejects.toMatchObject({ kind: "capacity" });
		expect(await probe(cwd)).toEqual({ fileCount: 2501, totalBytes: 2509 });
		expect((await (await inspectable(cwd)).inspect()).safe).toBe(true);
	}, 60000);

	it("admits over 5000 small files independently of Git output and regular-byte limits", async () => {
		const { cwd, git, put, commit } = await fixture();
		for (let index = 0; index < 5001; index++) await put(`vendor/f${index}`, "x");
		commit();
		expect(Buffer.byteLength(git("ls-files", "--stage", "-z"))).toBeLessThan(2 * MiB);
		await expect(GitWorkspace.open(cwd, policy)).rejects.toMatchObject({ kind: "capacity" });
		expect(await probe(cwd)).toEqual({ fileCount: 5002, totalBytes: 5010 });
		expect((await (await inspectable(cwd)).inspect()).safe).toBe(true);
	}, 60000);

	it("hashes over 32 MiB outside editable scope without retaining it as review text", async () => {
		const { cwd, put, commit } = await fixture();
		for (let index = 0; index < 17; index++) await put(`vendor/f${index}`, Buffer.alloc(2 * MiB, "x"));
		commit();
		await expect(GitWorkspace.open(cwd, policy)).rejects.toMatchObject({ kind: "capacity" });
		expect(await probe(cwd)).toEqual({ fileCount: 18, totalBytes: 34 * MiB + 9 });
		const workspace = await inspectable(cwd);
		const before = await workspace.inspect();
		await put("vendor/f0", Buffer.alloc(2 * MiB, "y"));
		const after = await workspace.inspect();
		expect(after).toMatchObject({ safe: false, changedFiles: ["vendor/f0"], changedLines: 0 });
		expect(after.diffDigest).not.toBe(before.diffDigest);
		expect(after.diff.length).toBeLessThan(200);
	});

	it("admits literal bracket route names only as opaque out-of-scope evidence, never as tool paths", async () => {
		const { cwd, put, commit } = await fixture();
		await put("vendor/routes/[slug].tsx", "OUTSIDE_SOURCE");
		commit();
		await expect(GitWorkspace.open(cwd, policy)).rejects.toThrow("Unsupported Git filename");
		const workspace = await inspectable(cwd);
		const before = await workspace.inspect();
		expect(before.safe).toBe(true);
		expect((await (await FilePolicyPathInspector.open(cwd)).inspect(["vendor/routes/[slug].tsx"]))[0].safe).toBe(
			false,
		);
		await expect(workspace.claimImages(["vendor/routes/[slug].tsx"])).rejects.toThrow();
		await put("vendor/routes/[slug].tsx", "CHANGED_SOURCE");
		const after = await workspace.inspect();
		expect(after).toMatchObject({ safe: false, changedFiles: ["vendor/routes/[slug].tsx"], changedLines: 0 });
		expect(after.diffDigest).not.toBe(before.diffDigest);
		expect(after.diff).not.toContain("SOURCE");
		await put("src/[slug].tsx", "inside");
		await expect(workspace.inspect()).rejects.toMatchObject({ kind: "unsupported" });
	});

	it("freezes allowed paths before asynchronous collection starts", async () => {
		const { cwd, put, commit } = await fixture();
		await put("vendor/text", "before");
		commit();
		const mutable = { ...policy, allowedPaths: ["src"] };
		const pending = GitWorkspace.open(cwd, mutable, undefined, mode);
		mutable.allowedPaths.push("vendor");
		const workspace = await pending;
		await put("vendor/text", "after");
		expect(await workspace.inspect()).toMatchObject({ safe: false, changedLines: 0 });
	});

	it.each(["growth", "replacement", "cancellation"] as const)(
		"rejects %s at an exact regular-file read boundary rather than issuing partial evidence",
		async (change) => {
			const { cwd } = await fixture();
			const workspace = await inspectable(cwd);
			const controller = new AbortController();
			const target = join(cwd, "src/app.ts");
			const originalOpen = filesystem.open;
			let intercepted = false;
			vi.spyOn(filesystem, "open").mockImplementation(async (...args) => {
				const handle = await originalOpen(...args);
				if (args[0] === target) {
					const reader = vi.spyOn(handle, "read");
					reader.mockImplementationOnce(async (...args) => {
						reader.mockRestore();
						const result = await handle.read(...args);
						intercepted = true;
						if (change === "growth") await appendFile(target, "grew");
						if (change === "replacement") {
							await rm(target);
							await writeFile(target, "original\n");
						}
						if (change === "cancellation") controller.abort();
						return result;
					});
				}
				return handle;
			});
			await expect(workspace.inspect(controller.signal)).rejects.toThrow();
			expect(intercepted).toBe(true);
			expect(workspace.safeToRelease).toBe(true);
		},
	);

	it("keeps the 240000-byte review diff bound instead of converting oversized edits to opaque success", async () => {
		const { cwd, put } = await fixture();
		const workspace = await inspectable(cwd);
		await put("src/app.ts", "a".repeat(240001));
		await expect(workspace.inspect()).rejects.toThrow("Diff evidence exceeds review context limit");
	});

	it("rehashes all 25 MiB of an opaque binary despite same size and restored mtime", async () => {
		const { cwd, put, commit } = await fixture();
		await put("vendor/tool", Buffer.alloc(25 * MiB));
		commit();
		await expect(GitWorkspace.open(cwd, policy)).rejects.toMatchObject({ kind: "capacity" });
		const workspace = await inspectable(cwd);
		const before = await workspace.inspect();
		const target = join(cwd, "vendor/tool");
		const stat = await lstat(target);
		const handle = await open(target, "r+");
		try {
			await handle.write(Buffer.from("OPAQUE_SECRET"), 0, 13, 24 * MiB);
		} finally {
			await handle.close();
		}
		await utimes(target, stat.atime, stat.mtime);
		const after = await workspace.inspect();
		expect(after).toMatchObject({ safe: false, changedFiles: ["vendor/tool"], changedLines: 0 });
		expect(after.diffDigest).not.toBe(before.diffDigest);
		expect(after.diff).not.toContain("OPAQUE_SECRET");
		expect(workspace.safeToRelease).toBe(true);
	});

	it.each(["external", "dangling"] as const)(
		"admits only baseline tracked %s links without following their targets",
		async (kind) => {
			const { cwd, commit } = await fixture();
			const outside = await mkdtemp(join(tmpdir(), "weavra-link-target-"));
			directories.push(outside);
			const target = join(outside, "private");
			if (kind === "external") await writeFile(target, "NEVER_READ_TARGET");
			await symlink(target, join(cwd, "vendor-link"));
			commit();
			await expect(GitWorkspace.open(cwd, policy)).rejects.toMatchObject({ kind: "unsupported" });
			const workspace = await inspectable(cwd);
			const before = await workspace.inspect();
			expect(await probe(cwd)).toEqual({ fileCount: 2, totalBytes: 9 });
			expect(before.safe).toBe(true);
			if (kind === "external") await writeFile(target, "TARGET_CHANGED_WITHOUT_LINK_CHANGE");
			expect((await workspace.inspect()).diffDigest).toBe(before.diffDigest);
			expect((await (await FilePolicyPathInspector.open(cwd)).inspect(["vendor-link"]))[0].safe).toBe(false);
			await expect(workspace.claimImages(["vendor-link"])).rejects.toThrow();
		},
	);

	it.each(["retarget", "delete", "regular"] as const)(
		"makes a baseline link %s unsafe with a changed digest",
		async (change) => {
			const { cwd, commit, put } = await fixture();
			await symlink("/missing/external", join(cwd, "vendor-link"));
			commit();
			const workspace = await inspectable(cwd);
			const before = await workspace.inspect();
			await rm(join(cwd, "vendor-link"));
			if (change === "retarget") await symlink("/missing/different", join(cwd, "vendor-link"));
			if (change === "regular") await put("vendor-link", "/missing/external");
			const after = await workspace.inspect();
			expect(after).toMatchObject({ safe: false, changedFiles: ["vendor-link"], changedLines: 0 });
			expect(after.diffDigest).not.toBe(before.diffDigest);
			expect(after.diff).not.toContain("/missing/");
		},
	);

	it.each(["new link", "allowed link", "linked ancestor", "hardlink", "special"] as const)(
		"rejects %s without extending worker or evidence authority",
		async (kind) => {
			const { cwd, put, commit } = await fixture();
			if (kind === "allowed link") {
				await symlink("app.ts", join(cwd, "src/link"));
				commit();
				await expect(inspectable(cwd)).rejects.toMatchObject({ kind: "unsupported" });
				await expect(probe(cwd)).rejects.toMatchObject({ kind: "unsupported" });
				return;
			}
			const workspace = await inspectable(cwd);
			if (kind === "new link") await symlink("src/app.ts", join(cwd, "new-link"));
			if (kind === "hardlink") await link(join(cwd, "src/app.ts"), join(cwd, "alias"));
			if (kind === "linked ancestor") {
				await put("elsewhere/file", "outside");
				await rm(join(cwd, "src"), { recursive: true });
				await symlink("elsewhere", join(cwd, "src"));
			}
			if (kind === "special") execFileSync("mkfifo", [join(cwd, "src/pipe")]);
			await expect(workspace.inspect()).rejects.toMatchObject({ kind: "unsupported" });
		},
	);

	it.each(["text", "mode", "ignored allowed", "new untracked", "config", "HEAD", "index", "git config"] as const)(
		"includes %s changes in the full evidence universe",
		async (kind) => {
			const { cwd, put, commit, git } = await fixture();
			await put("outside.txt", "outside original");
			await put(".gitignore", "src/ignored\n");
			await put("src/ignored", "ignored original");
			await put(".ai/config.yaml", "original config");
			commit();
			const workspace = await inspectable(cwd);
			const before = await workspace.inspect();
			if (kind === "text") await put("outside.txt", "outside modified");
			if (kind === "mode") await chmod(join(cwd, "outside.txt"), 0o755);
			if (kind === "ignored allowed") await put("src/ignored", "ignored modified");
			if (kind === "new untracked") await put("src/new.ts", "new");
			if (kind === "config") await appendFile(join(cwd, ".ai/config.yaml"), "\nchanged");
			if (kind === "HEAD")
				git(
					"-c",
					"user.name=Fixture",
					"-c",
					"user.email=f@x",
					"-c",
					"commit.gpgsign=false",
					"commit",
					"--allow-empty",
					"-qm",
					"head drift",
				);
			if (kind === "index") git("update-index", "--chmod=+x", "src/app.ts");
			if (kind === "git config") git("config", "core.filemode", "false");
			const after = await workspace.inspect();
			expect(after.diffDigest).not.toBe(before.diffDigest);
			expect(after.safe).toBe(["ignored allowed", "new untracked"].includes(kind));
			expect(after.changedFiles.length).toBeGreaterThan(0);
			if (kind === "text") expect(after.diff).not.toContain("outside modified");
		},
	);

	it.each([
		"editable file",
		"opaque file",
		"regular total",
		"retained total",
		"allowed traversal",
		"file count",
	] as const)(
		"fails closed rather than returning partial safe evidence at the %s limit",
		async (kind) => {
			const { cwd, put } = await fixture();
			const workspace = await inspectable(cwd);
			if (kind === "editable file") await put("src/large", Buffer.alloc(2 * MiB + 1, "a"));
			if (kind === "opaque file") {
				await put("vendor/large", "");
				await truncate(join(cwd, "vendor/large"), 64 * MiB + 1);
			}
			if (kind === "regular total")
				for (let index = 0; index < 9; index++) {
					await put(`vendor/f${index}`, "");
					await truncate(join(cwd, `vendor/f${index}`), 60 * MiB);
				}
			if (kind === "retained total")
				for (let index = 0; index < 17; index++) await put(`src/f${index}`, Buffer.alloc(2 * MiB, "a"));
			if (kind === "allowed traversal") for (let index = 0; index < 10001; index++) await put(`src/f${index}`, "");
			if (kind === "file count") for (let index = 0; index < 50001; index++) await put(`vendor/f${index}`, "");
			await expect(workspace.inspect()).rejects.toMatchObject({ kind: "capacity" });
			await expect(probe(cwd)).rejects.toMatchObject({ kind: "capacity" });
			expect(workspace.safeToRelease).toBe(true);
		},
		60000,
	);

	it("rejects staged submodules, unmerged entries and tracked runtime files in the shared probe", async () => {
		for (const kind of ["submodule", "unmerged", "runtime"] as const) {
			const { cwd, git, put } = await fixture();
			if (kind === "submodule")
				git("update-index", "--add", "--cacheinfo", `160000,${git("rev-parse", "HEAD").trim()},module`);
			if (kind === "unmerged") {
				const blob = git("rev-parse", "HEAD:src/app.ts").trim();
				execFileSync("git", ["update-index", "--index-info"], {
					cwd,
					input: `0 ${"0".repeat(40)}\tsrc/app.ts\n100644 ${blob} 1\tsrc/app.ts\n100644 ${blob} 2\tsrc/app.ts\n`,
				});
			}
			if (kind === "runtime") {
				await put(".ai/state.json", "{}");
				git("add", "--", ".ai/state.json");
			}
			await expect(probe(cwd)).rejects.toMatchObject({ kind: "unsupported" });
		}
	});

	it("rejects Git output beyond the fixed 8 MiB profile with confirmed process cleanup", async () => {
		const { cwd, git } = await fixture();
		const blob = git("rev-parse", "HEAD:src/app.ts").trim();
		const prefix = Array.from({ length: 4 }, (_, index) => `${index}${"a".repeat(199)}`).join("/");
		const input = Array.from(
			{ length: 10000 },
			(_, index) => `100644 ${blob}\t${prefix}/${String(index).padStart(5, "0")}${"b".repeat(70)}\n`,
		).join("");
		expect(Buffer.byteLength(input)).toBeGreaterThan(8 * MiB);
		execFileSync("git", ["update-index", "--index-info"], { cwd, input });
		await expect(probe(cwd)).rejects.toMatchObject({ kind: "capacity" });
	});

	it("enforces the total capture deadline without returning a partial result", async () => {
		const { cwd } = await fixture();
		vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
		try {
			const rejected = expect(probe(cwd)).rejects.toMatchObject({ kind: "capacity" });
			await vi.advanceTimersByTimeAsync(60000);
			await rejected;
		} finally {
			vi.useRealTimers();
		}
	});

	it("types unavailable and cancellation failures without publishing counts", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "weavra-not-git-"));
		directories.push(cwd);
		await expect(probe(cwd)).rejects.toBeInstanceOf(WorkspaceEvidenceError);
		await expect(probe(cwd)).rejects.toMatchObject({ kind: "unavailable" });
		const controller = new AbortController();
		controller.abort();
		await expect(
			probeWorkspaceEvidence(cwd, { allowedPaths: [], evidenceMode: mode }, controller.signal),
		).rejects.toMatchObject({ kind: "unavailable" });
	});
});
