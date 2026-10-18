import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { parse } from "yaml";
import { parseRuntimeConfig } from "../src/config.ts";
import { initProjectYaml } from "../src/launcher-project.ts";
import { evaluatePolicy, type PolicyContext } from "../src/policy.ts";
import { draftProject } from "../src/project-draft.ts";
import { cleanStartBlockers, GitWorkspace, readCheckoutIdentity } from "../src/workspace.ts";

const roots: string[] = [];
const policy: PolicyContext = {
	executionMode: "EDIT",
	executionRunId: "setup-test",
	configDigest: "config",
	allowedPaths: ["src", ".ai"],
	tools: [
		{ id: "runtime_write", operation: "write" },
		{ id: "runtime_edit", operation: "edit" },
	],
};
const valid = JSON.stringify({
	schemaVersion: 1,
	models: {
		profiles: { coding: { provider: "faux", model: "coding" }, reasoning: { provider: "faux", model: "review" } },
	},
	files: { allowed_paths: ["src"] },
	verification: { checks: [{ id: "test", kind: "test", executable: "node", args: ["--version"] }] },
});
async function fixture() {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "weavra-setup-")));
	roots.push(cwd);
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", ...args],
			{ cwd, env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" } },
		).toString();
	const put = async (path: string, text = "") => {
		await mkdir(dirname(join(cwd, path)), { recursive: true });
		await writeFile(join(cwd, path), text);
	};
	git("init", "-q");
	await put("src/main.txt", "original");
	git("add", ".");
	git("commit", "-qm", "fixture");
	return { cwd, git, put };
}
afterEach(async () => {
	await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it.each([
	["Node", { "package.json": '{"scripts":{"test":"node --test","lint":"eslint ."}}' }, ["node-test", "node-lint"]],
	["Python", { "pyproject.toml": '[project]\ndependencies = ["pytest>=8"]\n' }, ["python-test"]],
	["Python", { "pytest.ini": "[pytest]\n" }, ["python-test"]],
	["Go", { "go.mod": "module example.invalid/project\n" }, ["go-test"]],
	["Rust", { "Cargo.toml": '[package]\nname="example"\n' }, ["rust-test"]],
	["Godot", { "project.godot": "[application]\n" }, []],
	["Generic", {}, []],
] as const)("drafts %s from project files without executing commands", async (kind, files, checks) => {
	const { cwd, put, git } = await fixture();
	for (const [path, text] of Object.entries(files)) await put(path, text);
	const before = git("status", "--porcelain");
	const draft = await draftProject(cwd);
	const data = parse(draft.yaml);
	expect(draft.projectTypes).toEqual([kind]);
	expect(data.files.allowed_paths).toContain("src");
	expect(data.verification.checks.map((check: { id: string }) => check.id)).toEqual(checks);
	expect(() => parseRuntimeConfig(draft.yaml)).toThrow();
	expect(git("status", "--porcelain")).toBe(before);
});

it("infers the lockfile package manager and leaves missing or placeholder checks empty", async () => {
	const { cwd, put } = await fixture();
	await put("package.json", '{"scripts":{"test":"echo \\"Error: no test specified\\" && exit 1","lint":"eslint ."}}');
	await put("pnpm-lock.yaml");
	const data = parse((await draftProject(cwd)).yaml);
	expect(data.verification.checks).toEqual([
		{ id: "node-lint", kind: "lint", executable: "pnpm", args: ["run", "lint"], required: false },
	]);
});

it("does not invent pytest for a Python project without pytest evidence or follow manifest links", async () => {
	const { cwd, put } = await fixture();
	await put("pyproject.toml", '[project]\nname="example"\n');
	expect(parse((await draftProject(cwd)).yaml).verification.checks).toEqual([]);
	await symlink("/not-a-project/package.json", join(cwd, "package.json"));
	expect((await draftProject(cwd)).projectTypes).toEqual(["Python"]);
});

it.each(["untracked", "modified"] as const)(
	"admits %s config and metadata but preserves content-bound config evidence",
	async (kind) => {
		const { cwd, put, git } = await fixture();
		await put(".ai/config.yaml", valid);
		await put(".ai/notes.md", "before");
		if (kind === "modified") {
			git("add", ".ai/config.yaml", ".ai/notes.md");
			git("commit", "-qm", "reviewed config");
			await put(".ai/config.yaml", `${valid}\n`);
			await put(".ai/notes.md", "modified");
		}
		const before = await readCheckoutIdentity(cwd, { allowedPaths: ["src"] });
		const workspace = await GitWorkspace.open(cwd, policy);
		await put(".ai/state.json", "runtime-owned");
		await put(".ai/cache/result", "runtime metadata");
		await put(".ai/notes.md", "after");
		expect(await readCheckoutIdentity(cwd, { allowedPaths: ["src"] })).toEqual(before);
		expect(await workspace.inspect()).toMatchObject({ safe: true, changedFiles: [] });
		await put(".ai/config.yaml", `${valid}\n# changed\n`);
		expect((await readCheckoutIdentity(cwd, { allowedPaths: ["src"] })).workspaceDigest).not.toBe(
			before.workspaceDigest,
		);
		expect(await workspace.inspect()).toMatchObject({ safe: false, changedFiles: [".ai/config.yaml"] });
	},
);

it.each(["src/main.txt", "untracked.txt", ".ai-other/file", "nested/.ai/file"])(
	"refuses dirt outside root metadata: %s",
	async (path) => {
		const { cwd, put } = await fixture();
		await put(".ai/config.yaml", valid);
		await put(path, "dirty");
		await expect(readCheckoutIdentity(cwd, { allowedPaths: ["src"] })).rejects.toThrow("Dirty workspace");
	},
);

it("checks both rename sides rather than hiding a source moved into .ai", () => {
	expect(cleanStartBlockers("R  .ai/moved\0src/main.txt\0?? .ai/extra\0", new Set())).toEqual(["src/main.txt"]);
	expect(cleanStartBlockers("R  src/main.txt\0.ai/moved\0", new Set())).toEqual(["src/main.txt"]);
});

it.each([".ai/config.yaml", ".ai/state.json", ".ai/arbitrary/file"])(
	"denies worker writes under %s even when allowed_paths includes .ai",
	(path) => {
		for (const tool of ["runtime_write", "runtime_edit"]) {
			expect(
				evaluatePolicy(
					{
						runId: "setup-test",
						actionId: "write",
						actionDigest: "digest",
						role: "Developer",
						risk: "R1",
						tool,
						paths: [path],
					},
					policy,
					[{ path, safe: true, kind: "file" }],
				).decision,
			).toBe("DENY");
		}
	},
);

it("publishes valid reviewed bytes once, refuses invalid input and concurrent overwrite", async () => {
	const { cwd } = await fixture();
	await expect(initProjectYaml(cwd, "invalid: true")).rejects.toThrow();
	const outcomes = await Promise.allSettled([initProjectYaml(cwd, valid), initProjectYaml(cwd, valid)]);
	expect(outcomes.map((item) => item.status).sort()).toEqual(["fulfilled", "rejected"]);
	await expect(initProjectYaml(cwd, `${valid}\n`)).rejects.toThrow("이미 있어요");
	expect(await readFile(join(cwd, ".ai/config.yaml"), "utf8")).toBe(valid);
});

it("serves draft and explicit stdin save with doctor JSON through the launcher without Git mutation", async () => {
	const { cwd, put, git } = await fixture();
	await put("package.json", '{"scripts":{"test":"node --test"}}');
	git("add", "package.json");
	git("commit", "-qm", "manifest");
	const head = git("rev-parse", "HEAD");
	const launcher = fileURLToPath(new URL("../bin/weavra", import.meta.url));
	const options = {
		cwd,
		env: { PATH: process.env.PATH, HOME: join(cwd, "empty-home") },
		encoding: "utf8" as const,
		timeout: 20000,
	};
	const draft = spawnSync(launcher, ["project", "draft", "--json"], options);
	expect(draft.status, draft.stderr).toBe(0);
	expect(JSON.parse(draft.stdout)).toMatchObject({ kind: "draft", projectTypes: ["Node"] });
	const saved = spawnSync(launcher, ["project", "init", "--stdin", "--json"], { ...options, input: valid });
	expect(saved.status, saved.stderr).toBe(0);
	expect(JSON.parse(saved.stdout)).toMatchObject({ kind: "saved", readiness: { ready: true } });
	const again = spawnSync(launcher, ["project", "init", "--stdin", "--json"], { ...options, input: valid });
	expect(again.status).toBe(1);
	expect(JSON.parse(again.stdout).kind).toBe("error");
	expect(git("rev-parse", "HEAD")).toBe(head);
	expect(git("status", "--porcelain")).toBe("?? .ai/\n");
});
