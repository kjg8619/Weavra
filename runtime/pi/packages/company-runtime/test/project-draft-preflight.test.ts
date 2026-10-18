import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { parse } from "yaml";
import { draftProject } from "../src/project-draft.ts";

const roots: string[] = [];
async function fixture() {
	const cwd = await mkdtemp(join(tmpdir(), "weavra-godot-draft-"));
	roots.push(cwd);
	const put = async (path: string, content: string | Buffer) => {
		const absolute = join(cwd, path);
		await mkdir(join(absolute, ".."), { recursive: true });
		await writeFile(absolute, content);
	};
	const git = (args: string[]) =>
		execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args], {
			cwd,
			env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		});
	git(["init", "-q"]);
	const existingConfig = "fixture-owned: unchanged\n";
	await put("project.godot", '[application]\nconfig/name="Fixture"\nconfig/features=PackedStringArray("4.3")\n');
	await put("game/player.gd", "extends Node\n");
	await put("docs/notes.md", "Design notes\n");
	await put("README.md", "Fixture\n");
	await put("assets/font.bin", Buffer.alloc(3 * 1024 * 1024, 0x7f));
	await put(".ai/config.yaml", existingConfig);
	git(["add", "."]);
	git(["commit", "-qm", "fixture"]);
	return { cwd, put, git, existingConfig };
}

afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("proposes conservative Godot edit roots and an unexecuted argv check", async () => {
	const { cwd, git, existingConfig } = await fixture();
	const before = git(["status", "--porcelain"]).toString();
	const draft = await draftProject(cwd);
	const data = parse(draft.yaml);
	expect(draft.workspaceProfile).toMatchObject({
		schemaVersion: 1,
		kind: "supported",
		profile: { mode: "bounded-monorepo", candidate: true },
		fileCount: 6,
	});
	if (draft.workspaceProfile.kind === "supported")
		expect(draft.workspaceProfile.totalBytes).toBeGreaterThan(3 * 1024 * 1024);
	expect(data.workspace.evidence.mode).toBe("bounded-monorepo");
	expect(data.files.allowed_paths).toEqual(["docs", "game", "project.godot", "README.md"]);
	expect(data.verification.checks).toEqual([
		{
			id: "godot-editor-import",
			kind: "test",
			executable: "godot",
			args: ["--headless", "--path", ".", "--editor", "--quit"],
			required: true,
		},
	]);
	expect(draft.yaml).toContain("아직 명령을 실행하지 않았어요.");
	expect(draft.yaml).toContain("bounded-monorepo는 기존 유한 프로필 후보예요.");
	expect(await readFile(join(cwd, "assets/font.bin"))).toHaveLength(3 * 1024 * 1024);
	expect(await readFile(join(cwd, ".ai/config.yaml"), "utf8")).toBe(existingConfig);
	expect(git(["status", "--porcelain"]).toString()).toBe(before);
});

it("does not propose a Godot check without supported project feature metadata", async () => {
	const { cwd, put } = await fixture();
	await put("project.godot", '[application]\nconfig/name="Fixture"\n');
	const draft = await draftProject(cwd);
	expect(parse(draft.yaml).verification.checks).toEqual([]);
});
