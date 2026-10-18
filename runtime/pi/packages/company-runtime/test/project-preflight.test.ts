import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { assessProjectWorkspace } from "../src/project-preflight.ts";

const MiB = 1024 * 1024;
const roots: string[] = [];

async function fixture() {
	const cwd = await mkdtemp(join(tmpdir(), "weavra-project-preflight-"));
	roots.push(cwd);
	const put = async (path: string, content: string | Buffer) => {
		const absolute = join(cwd, path);
		await mkdir(dirname(absolute), { recursive: true });
		await writeFile(absolute, content);
	};
	const git = (args: string[]) =>
		execFileSync("git", args, {
			cwd,
			env: {
				PATH: process.env.PATH,
				GIT_CONFIG_NOSYSTEM: "1",
				GIT_CONFIG_GLOBAL: "/dev/null",
				GIT_OPTIONAL_LOCKS: "0",
			},
			stdio: "ignore",
		});
	await put("src/app.ts", "source\n");
	git(["init", "-q"]);
	return {
		cwd,
		put,
		async commit() {
			git(["add", "--", "."]);
			git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"]);
		},
	};
}

async function workspaceSnapshot(cwd: string) {
	return {
		entries: (await readdir(cwd)).sort(),
		index: await readFile(join(cwd, ".git/index")),
		config: await readFile(join(cwd, ".git/config")),
		status: execFileSync(
			"git",
			[
				"--no-optional-locks",
				"-c",
				"core.fsmonitor=false",
				"-c",
				"core.hooksPath=/dev/null",
				"status",
				"--porcelain",
			],
			{
				cwd,
				env: {
					PATH: process.env.PATH,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
					GIT_OPTIONAL_LOCKS: "0",
				},
				encoding: "utf8",
			},
		),
	};
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(roots.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

it("returns current default capture statistics without changing the workspace", async () => {
	const { cwd, commit } = await fixture();
	await commit();
	const before = await workspaceSnapshot(cwd);

	const result = await assessProjectWorkspace(cwd, ["src"]);

	expect(result).toEqual({
		schemaVersion: 1,
		kind: "supported",
		profile: { mode: "default", candidate: false },
		fileCount: 1,
		totalBytes: Buffer.byteLength("source\n"),
	});
	expect(await workspaceSnapshot(cwd)).toEqual(before);
});

it("proposes bounded-monorepo after the default cap and counts regular and opaque assets", async () => {
	const { cwd, put, commit } = await fixture();
	for (let index = 0; index < 17; index++) await put(`assets/chunk-${index}.bin`, Buffer.alloc(2 * MiB, 0x61));
	await put("assets/readme.txt", "asset text\n");
	await put("assets/texture.bin", Buffer.from([0, 255, 1, 0]));
	const checkScript = `#!/bin/sh\nprintf invoked > "${join(cwd, "check-invoked")}"\n`;
	await put("checks/never-run", checkScript);
	await chmod(join(cwd, "checks/never-run"), 0o755);
	const config = [
		"schemaVersion: 1",
		"verification:",
		"  checks:",
		"    - id: no-run",
		"      kind: test",
		"      executable: ./checks/never-run",
		"      args: []",
		"      required: true",
		"",
	].join("\n");
	await put(".ai/config.yaml", config);
	await commit();
	const allowedPaths = ["src"];
	const before = await workspaceSnapshot(cwd);
	const fetch = vi.spyOn(globalThis, "fetch");

	const result = await assessProjectWorkspace(cwd, allowedPaths);

	expect(result).toEqual({
		schemaVersion: 1,
		kind: "supported",
		profile: { mode: "bounded-monorepo", candidate: true },
		fileCount: 22,
		totalBytes:
			Buffer.byteLength("source\n") +
			17 * 2 * MiB +
			Buffer.byteLength("asset text\n") +
			4 +
			Buffer.byteLength(checkScript) +
			Buffer.byteLength(config),
	});
	expect(allowedPaths).toEqual(["src"]);
	expect(await workspaceSnapshot(cwd)).toEqual(before);
	await expect(readFile(join(cwd, "check-invoked"))).rejects.toMatchObject({ code: "ENOENT" });
	expect(fetch).not.toHaveBeenCalled();
});

it("does not report success when an editable binary exceeds the fixed file limit", async () => {
	const { cwd, put, commit } = await fixture();
	await put("src/opaque.bin", Buffer.concat([Buffer.from([0]), Buffer.alloc(2 * MiB, 0x61)]));
	await commit();
	const before = await workspaceSnapshot(cwd);

	const result = await assessProjectWorkspace(cwd, ["src"]);

	expect(result).toMatchObject({
		kind: "unsupported",
		diagnostic: { code: "WORKSPACE_EVIDENCE_CAPACITY" },
	});
	expect(await workspaceSnapshot(cwd)).toEqual(before);
});
