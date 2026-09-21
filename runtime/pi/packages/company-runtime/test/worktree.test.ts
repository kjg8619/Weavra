import { spawnSync } from "node:child_process";
import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	realpath,
	rename,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const gitPath = spawnSync("which", ["git"], { encoding: "utf8" }).stdout.trim();
let root: string;
let source: string;
let cwd: string;
let launcher: string;
let cli: string;
let extension: string;
let bin: string;
let head: string;
let index: Buffer;
let env: NodeJS.ProcessEnv;

function git(args: string[], directory = source) {
	const result = spawnSync(gitPath, ["-C", directory, ...args], { env, encoding: "utf8" });
	expect(result.status, result.stderr).toBe(0);
	return result.stdout.trim();
}
function target(name = "fix-login") {
	return join(dirname(source), ".weavra-worktrees", basename(source), name);
}
function run(args = ["--worktree", "fix-login"], extraEnv: NodeJS.ProcessEnv = {}, input?: string) {
	return spawnSync(launcher, args, {
		cwd,
		env: { ...env, ...extraEnv },
		encoding: "utf8",
		input,
		timeout: 10_000,
	});
}
async function absent(path: string) {
	await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
}
async function sourceUnchanged() {
	expect(git(["rev-parse", "HEAD"])).toBe(head);
	expect(git(["symbolic-ref", "HEAD"])).toBe("refs/heads/main");
	expect(await readFile(join(source, "app.txt"), "utf8")).toBe("original\n");
	expect(await readFile(join(source, ".git/index"))).toEqual(index);
	expect(git(["status", "--porcelain=v1", "--untracked-files=all"])).toBe("");
	await absent(join(source, ".ai"));
	await absent(join(source, ".weavra"));
	await absent(join(source, ".weavra-worktrees"));
}
async function noCreation() {
	await absent(target());
	expect(git(["for-each-ref", "--format=%(refname)", "refs/heads/weavra/"])).toBe("");
}

async function existingWorktree() {
	const result = run();
	expect(result.status, result.stderr).toBe(0);
	await rm(join(root, "pi-started"));
	await rm(join(root, "git-calls.jsonl"));
}
async function snapshot(paths: string[]) {
	const files: Record<string, string> = {};
	async function visit(path: string): Promise<void> {
		const stat = await lstat(path);
		files[path] = String(stat.mode);
		if (stat.isSymbolicLink()) files[path] += await readlink(path);
		else if (stat.isDirectory()) for (const entry of await readdir(path)) await visit(join(path, entry));
		else files[path] += (await readFile(path)).toString("hex");
	}
	for (const path of paths) await visit(path);
	return files;
}
async function readOnlyCalls() {
	const calls = (await readFile(join(root, "git-calls.jsonl"), "utf8"))
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as string[]);
	for (const args of calls) {
		const command = args.filter(
			(arg, i) => arg !== "-c" && arg !== "-C" && args[i - 1] !== "-c" && args[i - 1] !== "-C",
		)[0];
		expect(["check-ref-format", "rev-parse", "symbolic-ref", "ls-files", "worktree"]).toContain(command);
		if (command === "worktree")
			expect(args.slice(args.indexOf("worktree"))).toEqual(["worktree", "list", "--porcelain", "-z"]);
		if (command === "symbolic-ref") expect(args.at(-1)).toBe("HEAD");
	}
}

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "weavra worktree ")));
	source = join(root, "user project");
	cwd = source;
	const checkout = join(root, "weavra source checkout");
	launcher = join(checkout, "packages/company-runtime/bin/weavra");
	extension = join(checkout, "packages/company-runtime/src/extension.ts");
	cli = join(checkout, "packages/coding-agent/dist/bundle/cli.js");
	bin = join(root, "bin");
	for (const path of [source, bin, dirname(launcher), dirname(extension), dirname(cli)]) {
		await mkdir(path, { recursive: true });
	}
	env = {
		PATH: `${bin}:/usr/bin:/bin`,
		HOME: root,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		PI_CODING_AGENT_DIR: join(root, "agent directory"),
		WEAVRA_MARKER: "unchanged environment",
	};
	await symlink(process.execPath, join(bin, "node"));
	await copyFile(join(packageRoot, "bin/weavra"), launcher);
	await copyFile(join(packageRoot, "src/launcher-worktrees.ts"), join(dirname(extension), "launcher-worktrees.ts"));
	await copyFile(join(packageRoot, "src/launcher-home.ts"), join(dirname(extension), "launcher-home.ts"));
	await mkdir(join(root, ".weavra"), { mode: 0o700 });
	await mkdir(join(root, ".weavra/agent"), { mode: 0o700 });
	await chmod(launcher, 0o755);
	await writeFile(extension, "// Launcher path fixture; Runtime behavior uses the existing faux suites.\n");
	// This executable checks the process boundary, not actual Pi/Provider behavior.
	await writeFile(
		cli,
		`#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(join(root, "pi-started"))}, 'started');
if (process.env.WRITE_STATE) {
  fs.mkdirSync('.ai');
  fs.writeFileSync('.ai/state.json', JSON.stringify({status: process.env.OUTCOME}));
}
console.log(JSON.stringify({cli: process.argv[1], cwd: process.cwd(), args: process.argv.slice(2),
  marker: process.env.WEAVRA_MARKER, home: process.env.HOME, agentDir: process.env.PI_CODING_AGENT_DIR}));
if (process.env.ECHO_STDIN) { process.stdout.write(fs.readFileSync(0)); process.stderr.write('Pi stderr\\n'); }
if (process.env.SIGNAL_EXIT) process.kill(process.pid, process.env.SIGNAL_EXIT);
process.exit(Number(process.env.PI_EXIT || 0));
`,
		{ mode: 0o755 },
	);
	await writeFile(
		join(bin, "pi"),
		`#!${process.execPath}
require('node:fs').writeFileSync(${JSON.stringify(join(root, "global-called"))}, 'called');
process.exit(99);
`,
		{ mode: 0o755 },
	);
	git(["init", "-b", "main"]);
	git(["config", "user.name", "Weavra Test"]);
	git(["config", "user.email", "weavra@example.invalid"]);
	await writeFile(join(source, "app.txt"), "original\n");
	git(["add", "app.txt"]);
	git(["-c", "commit.gpgsign=false", "commit", "-m", "fixture baseline"]);
	head = git(["rev-parse", "HEAD"]);
	index = await readFile(join(source, ".git/index"));
	// Audit every launcher Git argv and inject failures without real providers or user files.
	await writeFile(
		join(bin, "git"),
		`#!${process.execPath}
const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const args = process.argv.slice(2);
const log = ${JSON.stringify(join(root, "git-calls.jsonl"))};
const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\\n').map(JSON.parse) : [];
fs.appendFileSync(log, JSON.stringify(args) + '\\n');
const command = args.filter((arg, i) => arg !== '-c' && arg !== '-C' && args[i - 1] !== '-c' && args[i - 1] !== '-C')[0];
const added = calls.some(call => call.includes('worktree') && call.includes('add'));
const fault = process.env.GIT_FAULT;
if (command === 'worktree' && args.includes('list') && fault?.startsWith('list-')) {
  if (fault === 'list-error') process.exit(128);
  if (fault === 'list-malformed') { process.stdout.write('worktree broken\\0\\0'); process.exit(0); }
  let output = spawnSync(${JSON.stringify(gitPath)}, args, {encoding: 'utf8'}).stdout;
  const record = output.split('\\0\\0').find(block => block.includes('branch refs/heads/weavra/fix-login'));
  if (fault === 'list-duplicate') output += record + '\\0\\0';
  if (fault === 'list-foreign') output = output.split('\\0\\0')[0] + '\\0\\0worktree ' + process.env.FAKE_WORKTREE_PATH + '\\0HEAD ${head}\\0branch refs/heads/weavra/fix-login\\0\\0';
  if (fault === 'list-wrong-branch') output = output.replace('branch refs/heads/other', 'branch refs/heads/weavra/fix-login');
  if (fault === 'list-changed' && calls.filter(call => call.includes('list')).length > 0) output = output.replace('branch refs/heads/weavra/fix-login', 'branch refs/heads/weavra/different');
  process.stdout.write(output); process.exit(0);
}
if ((fault === 'status' && command === 'status') ||
    (fault === 'root' && args.includes('--show-toplevel')) ||
    (fault === 'head' && args.includes('HEAD^{commit}')) ||
    (fault === 'branch' && args.includes('--symbolic-full-name')) ||
    (fault === 'refs' && command === 'show-ref') ||
    (fault === 'add' && command === 'worktree') ||
    (fault === 'post-status' && added && command === 'status') ||
    (fault === 'post-head' && added && args.includes('HEAD^{commit}'))) {
  console.error('injected Git failure: ' + fault); process.exit(128);
}
if (fault === 'pre-branch-change' && command === 'show-ref') {
  spawnSync(${JSON.stringify(gitPath)}, ['-C', ${JSON.stringify(source)}, 'symbolic-ref', 'HEAD', 'refs/heads/other']);
}
const result = spawnSync(${JSON.stringify(gitPath)}, args, {stdio: 'inherit'});
if (command === 'worktree' && result.status === 0) {
  if (fault === 'post-branch-change') spawnSync(${JSON.stringify(gitPath)}, ['-C', ${JSON.stringify(source)}, 'symbolic-ref', 'HEAD', 'refs/heads/other']);
  if (fault === 'post-head-change') spawnSync(${JSON.stringify(gitPath)}, ['-C', ${JSON.stringify(source)}, 'update-ref', 'refs/heads/main', process.env.OTHER_HEAD]);
  if (fault === 'target-dirty') fs.writeFileSync(${JSON.stringify(join(target(), "unexpected"))}, 'external change');
  if (fault === 'partial-add') process.exit(128);
}
process.exit(result.status === null ? 128 : result.status);
`,
		{ mode: 0o755 },
	);
});
afterEach(async () => {
	await absent(join(root, "global-called"));
	try {
		const calls = (await readFile(join(root, "git-calls.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as string[]);
		for (const args of calls) {
			const command = args.filter(
				(arg, i) => arg !== "-c" && arg !== "-C" && args[i - 1] !== "-c" && args[i - 1] !== "-C",
			)[0];
			expect([
				"check-ref-format",
				"rev-parse",
				"status",
				"show-ref",
				"worktree",
				"symbolic-ref",
				"ls-files",
			]).toContain(command);
			if (command === "worktree") {
				const operation = args.slice(args.indexOf("worktree") + 1);
				if (operation[0] === "list") expect(operation).toEqual(["list", "--porcelain", "-z"]);
				else expect(operation.slice(0, 2)).toEqual(["add", "-b"]);
			}
		}
	} catch (error) {
		if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
	}
	// Only the disposable test-owned root is removed, after preservation assertions.
	await rm(root, { recursive: true, force: true });
});

describe("Weavra isolated worktree launcher (POSIX)", () => {
	it("creates a clean branch at frozen HEAD outside the source and execs only fork-local Pi with exact argv/env/stdio", async () => {
		const args = [
			"--model",
			"provider/model with spaces",
			"--worktree",
			"fix-login",
			"--",
			"",
			"$(touch marker); *",
			"--worktree",
			"literal prompt",
		];
		const result = run(args, { ECHO_STDIN: "1" }, "unchanged input\n");
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout.split("\n")[0])).toEqual({
			cli,
			cwd: target(),
			args: ["-e", extension, ...args.slice(0, 2), ...args.slice(4)],
			marker: env.WEAVRA_MARKER,
			home: root,
			agentDir: join(root, ".weavra/agent"),
		});
		expect(result.stdout.endsWith("unchanged input\n")).toBe(true);
		expect(result.stderr).toContain(
			`Weavra worktree created\nBranch: weavra/fix-login\nPath: ${target()}\nBase: ${head}\n`,
		);
		expect(result.stderr).toContain("Pi stderr");
		expect(git(["rev-parse", "HEAD"], target())).toBe(head);
		expect(git(["symbolic-ref", "HEAD"], target())).toBe("refs/heads/weavra/fix-login");
		expect(git(["status", "--porcelain"], target())).toBe("");
		expect(await readFile(join(target(), "app.txt"), "utf8")).toBe("original\n");
		const calls = (await readFile(join(root, "git-calls.jsonl"), "utf8"))
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line) as string[]);
		expect(
			calls.filter((args) => args.includes("worktree")).map((args) => args.slice(args.indexOf("worktree"))),
		).toEqual([["worktree", "add", "-b", "weavra/fix-login", target(), head]]);
		await sourceUnchanged();
	});
	it("resolves the canonical source root from a symlinked subdirectory and npm-style launcher link", async () => {
		await mkdir(join(source, "subdirectory"));
		await symlink(source, join(root, "project alias"));
		cwd = join(root, "project alias/subdirectory");
		const linked = join(bin, "weavra");
		await symlink(launcher, linked);
		launcher = linked;
		const result = run(["--worktree", "Fix_1.2-login"], { CDPATH: root });
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ cli, cwd: target("Fix_1.2-login") });
		await sourceUnchanged();
	});
	it("also accepts a clean linked worktree as the source without changing its checkout", async () => {
		const linked = join(root, "existing worktree");
		git(["worktree", "add", "-b", "existing", linked, head]);
		cwd = linked;
		const result = run();
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout).cwd).toBe(join(root, ".weavra-worktrees/existing worktree/fix-login"));
		expect(git(["symbolic-ref", "HEAD"], linked)).toBe("refs/heads/existing");
		expect(git(["rev-parse", "HEAD"], linked)).toBe(head);
		await sourceUnchanged();
	});
	it.each([".weavra-worktrees", "user project\n"])(
		"rejects a source path that would nest or ambiguously resolve the target: %s",
		async (name) => {
			const renamed = join(root, name);
			await rename(source, renamed);
			source = renamed;
			cwd = renamed;
			const result = run();
			expect(result.status).toBe(1);
			expect(result.stderr).toMatch(/outside the source repository|must not contain line breaks/);
			await noCreation();
			await sourceUnchanged();
		},
	);
	it("supports a detached source HEAD without attaching or moving it", () => {
		git(["checkout", "--detach", head]);
		const result = run();
		expect(result.status, result.stderr).toBe(0);
		expect(git(["rev-parse", "--symbolic-full-name", "HEAD"])).toBe("HEAD");
		expect(git(["rev-parse", "HEAD"])).toBe(head);
	});
	it.each(["tracked", "staged", "untracked"])("rejects a %s dirty source without altering changes", async (kind) => {
		const path = join(source, kind === "untracked" ? "new file" : "app.txt");
		await writeFile(path, "user changes\n");
		if (kind === "staged") git(["add", "app.txt"]);
		const before = await readFile(join(source, ".git/index"));
		const result = run();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"Weavra: source workspace has uncommitted changes.\nCommit or clean them before creating an isolated worktree.\nNo stash/reset was performed.",
		);
		expect(await readFile(path, "utf8")).toBe("user changes\n");
		expect(await readFile(join(source, ".git/index"))).toEqual(before);
		expect(git(["rev-parse", "HEAD"])).toBe(head);
		expect(git(["symbolic-ref", "HEAD"])).toBe("refs/heads/main");
		await noCreation();
		await absent(join(root, "pi-started"));
	});
	it("refuses an existing branch without reuse or deletion", async () => {
		git(["branch", "weavra/fix-login"]);
		expect(run().stderr).toContain("branch already exists");
		expect(git(["rev-parse", "weavra/fix-login"])).toBe(head);
		await absent(target());
		await sourceUnchanged();
	});
	it.each(["empty directory", "nonempty directory", "file", "dangling symlink"])(
		"preserves an existing target %s",
		async (kind) => {
			await mkdir(dirname(target()), { recursive: true });
			if (kind.includes("directory")) {
				await mkdir(target());
				if (kind === "nonempty directory") await writeFile(join(target(), "user-data"), "keep");
			} else if (kind === "file") await writeFile(target(), "keep");
			else await symlink(join(root, "absent"), target());
			const before = await lstat(target());
			const result = run();
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("target already exists");
			expect((await lstat(target())).ino).toBe(before.ino);
			if (kind === "nonempty directory") expect(await readFile(join(target(), "user-data"), "utf8")).toBe("keep");
			if (kind === "file") expect(await readFile(target(), "utf8")).toBe("keep");
			expect(git(["for-each-ref", "refs/heads/weavra/"])).toBe("");
			await sourceUnchanged();
		},
	);
	it.each(["../escape", "a/b", "a b", "a;touch-marker", "한글", ".", "..", "a..b", "a.lock", "trailing.", ".hidden"])(
		"rejects unsafe or Git-invalid name %s",
		async (name) => {
			expect(run(["--worktree", name]).status).toBe(1);
			await absent(join(root, ".weavra-worktrees"));
			await absent(join(root, "pi-started"));
			await sourceUnchanged();
		},
	);
	it.each([
		{ args: ["--worktree"] },
		{ args: ["--worktree", ""] },
		{ args: ["--worktree", "--model", "x"] },
		{ args: ["--worktree", "a", "--worktree", "b"] },
	])("rejects missing/duplicate worktree names: $args", async ({ args }) => {
		expect(run(args).status).toBe(1);
		await noCreation();
	});
	it.each([
		"root",
		"head",
		"branch",
		"status",
		"refs",
		"add",
		"post-status",
		"post-head",
		"partial-add",
		"target-dirty",
	])("fails closed on Git failure or invalid postcondition: %s", async (fault) => {
		const result = run(undefined, { GIT_FAULT: fault });
		expect(result.status, result.stderr).toBe(1);
		expect(result.stderr).not.toContain("Weavra worktree created");
		await absent(join(root, "pi-started"));
		if (["post-status", "post-head", "partial-add", "target-dirty"].includes(fault)) {
			expect(git(["rev-parse", "weavra/fix-login"])).toBe(head);
			expect((await lstat(target())).isDirectory()).toBe(true);
		} else if (fault === "add") expect((await lstat(target())).isDirectory()).toBe(true);
		else await noCreation();
		await sourceUnchanged();
	});
	it.each(["pre-branch-change", "post-branch-change", "post-head-change"])(
		"detects external source checkout changes without trying to restore them: %s",
		async (fault) => {
			const other = git([
				"-c",
				"commit.gpgsign=false",
				"commit-tree",
				`${head}^{tree}`,
				"-p",
				head,
				"-m",
				"other commit",
			]);
			git(["branch", "other", head]);
			const result = run(undefined, { GIT_FAULT: fault, OTHER_HEAD: other });
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("source HEAD or branch changed");
			expect(result.stderr).not.toContain("Weavra worktree created");
			await absent(join(root, "pi-started"));
			if (fault === "post-head-change") expect(git(["rev-parse", "HEAD"])).toBe(other);
			else expect(git(["symbolic-ref", "HEAD"])).toBe("refs/heads/other");
			if (fault.startsWith("post")) expect(git(["rev-parse", "HEAD"], target())).toBe(head);
			else await noCreation();
		},
	);
	it.each(["non-Git", "unborn"])("rejects a %s source", async (kind) => {
		cwd = join(root, "not initialized");
		await mkdir(cwd);
		if (kind === "unborn") git(["init", "-b", "main"], cwd);
		expect(run().status).toBe(1);
		await absent(join(root, "pi-started"));
		await absent(join(root, ".weavra-worktrees"));
	});
	it("rejects symlinked worktree parents pointing into the source", async () => {
		await symlink(source, join(root, ".weavra-worktrees"));
		expect(run().stderr).toContain("must not be a symlink");
		await absent(join(source, basename(source)));
		await sourceUnchanged();
	});
	it("preserves a non-directory worktree parent", async () => {
		const parent = join(root, ".weavra-worktrees");
		await writeFile(parent, "user data");
		expect(run().status).toBe(1);
		expect(await readFile(parent, "utf8")).toBe("user data");
		expect(git(["for-each-ref", "refs/heads/weavra/"])).toBe("");
		await sourceUnchanged();
	});
	it("rejects Git directory redirection without touching either repository", async () => {
		expect(run(undefined, { GIT_WORK_TREE: root }).stderr).toContain("unset GIT_WORK_TREE");
		await noCreation();
		await sourceUnchanged();
	});
	it("does not execute checkout hooks or rewrite the source index", async () => {
		await writeFile(
			join(source, ".git/hooks/post-checkout"),
			`#!/bin/sh\nprintf changed > '${join(source, "app.txt")}'\n`,
			{ mode: 0o755 },
		);
		expect(run().status).toBe(0);
		await sourceUnchanged();
	});
	it("fails before creating anything if the local Pi build is missing", async () => {
		await rm(cli);
		const result = run();
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("fork-local Pi build is missing");
		expect(result.stderr).toContain("No global Pi fallback");
		await noCreation();
		await sourceUnchanged();
	});
	it.each([
		{ outcome: "COMPLETED", code: "0" },
		{ outcome: "BLOCKED", code: "0" },
		{ outcome: "CANCELLED", code: "0" },
		{ outcome: "FAILED", code: "23" },
		{ outcome: "CANCELLED", code: "0", signal: "SIGTERM" },
		{ outcome: "CANCELLED", code: "0", signal: "SIGINT" },
	])(
		"leaves branch/worktree and worktree-local .ai intact after CLI outcome $outcome/$code/$signal",
		async ({ outcome, code, signal }) => {
			const result = run(undefined, { OUTCOME: outcome, WRITE_STATE: "1", PI_EXIT: code, SIGNAL_EXIT: signal });
			if (signal) expect(result.signal).toBe(signal);
			else expect(result.status).toBe(Number(code));
			expect(git(["rev-parse", "weavra/fix-login"])).toBe(head);
			expect(git(["worktree", "list", "--porcelain"])).toContain(`worktree ${target()}\n`);
			expect(JSON.parse(await readFile(join(target(), ".ai/state.json"), "utf8"))).toEqual({ status: outcome });
			await sourceUnchanged();
		},
	);
});

describe("Weavra existing worktree open and read-only discovery", () => {
	it.each([
		{ args: [] },
		{ args: ["--continue"] },
		{ args: ["-c"] },
		{ args: ["--resume"] },
		{ args: ["-r"] },
		{ args: ["--session", "session id or /path with spaces.jsonl"] },
		{ args: ["--model", "provider/model", "--", "", "$(touch marker); *", "--worktree-open", "literal"] },
	])("opens after create/exit with exact Pi session argv: $args", async ({ args }) => {
		await existingWorktree();
		const before = await snapshot([source, target()]);
		const result = run(["--worktree-open", "fix-login", ...args]);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			cli,
			cwd: target(),
			args: ["-e", extension, ...args],
			marker: env.WEAVRA_MARKER,
			home: root,
			agentDir: join(root, ".weavra/agent"),
		});
		expect(result.stderr).toContain("Weavra worktree opened");
		expect(await snapshot([source, target()])).toEqual(before);
		await readOnlyCalls();
		await sourceUnchanged();
	});
	it("allows dirty source and worktree, preserves staged/unstaged/untracked data and .ai, and does not call status", async () => {
		await existingWorktree();
		for (const path of [source, target()]) {
			await writeFile(join(path, "app.txt"), "staged work\n");
			git(["add", "app.txt"], path);
			await writeFile(join(path, "app.txt"), "unstaged work\n");
			await writeFile(join(path, "untracked"), "keep\n");
			await mkdir(join(path, ".ai"));
			await writeFile(join(path, ".ai/state.json"), "user state, not a registry\n");
		}
		const before = await snapshot([source, target()]);
		const result = run(["--worktree-open", "fix-login", "--continue"], { GIT_FAULT: "status" });
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout).cwd).toBe(target());
		expect(await snapshot([source, target()])).toEqual(before);
		expect(git(["rev-parse", "HEAD"])).toBe(head);
		expect(git(["symbolic-ref", "HEAD"])).toBe("refs/heads/main");
		await readOnlyCalls();
	});
	it("opens the current committed worktree HEAD without reverting to the creation base", async () => {
		await existingWorktree();
		await writeFile(join(target(), "app.txt"), "committed work\n");
		git(["add", "app.txt"], target());
		git(["-c", "commit.gpgsign=false", "commit", "-m", "user work"], target());
		const currentHead = git(["rev-parse", "HEAD"], target());
		expect(currentHead).not.toBe(head);
		const before = await snapshot([source, target()]);
		expect(run(["--worktree-open", "fix-login"]).status).toBe(0);
		expect(await snapshot([source, target()])).toEqual(before);
		await sourceUnchanged();
	});
	it("uses the registered location after a user move, not the default directory formula", async () => {
		await existingWorktree();
		const moved = join(root, 'moved worktree "quote"');
		git(["worktree", "move", target(), moved]);
		const result = run(["--worktree-open", "fix-login"]);
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout).cwd).toBe(moved);
		await absent(target());
		await sourceUnchanged();
	});
	it("discovers from another linked worktree and a source subdirectory", async () => {
		await existingWorktree();
		const other = join(root, "other checkout");
		git(["worktree", "add", "-b", "other", other, head]);
		await mkdir(join(other, "subdir"));
		cwd = join(other, "subdir");
		expect(run(["--worktree-open", "fix-login"]).status).toBe(0);
		const listing = run(["--worktree-list"]);
		expect(listing.status).toBe(0);
		expect(listing.stdout).toContain(`fix-login\tweavra/fix-login\t${target()}\tOK`);
		expect(listing.stdout).not.toContain("other checkout");
		await sourceUnchanged();
	});
	it.each(["../escape", "a/b", "a b", "한글", ".", "..", "a..b", "a.lock", "trailing.", ".hidden"])(
		"rejects invalid open name %s without creation",
		async (name) => {
			expect(run(["--worktree-open", name]).status).toBe(1);
			await noCreation();
			await absent(join(root, "pi-started"));
		},
	);
	it.each([
		{ args: ["--worktree-open"] },
		{ args: ["--worktree-open", ""] },
		{ args: ["--worktree-open", "--continue"] },
		{ args: ["--worktree", "a", "--worktree-open", "b"] },
		{ args: ["--worktree-open", "a", "--worktree", "b"] },
		{ args: ["--worktree-open", "a", "--worktree-open", "a"] },
		{ args: ["--worktree-list", "--worktree-open", "a"] },
		{ args: ["--worktree-list", "--worktree-list"] },
		{ args: ["--worktree-list", "--continue"] },
	])("rejects missing/conflicting options: $args", async ({ args }) => {
		expect(run(args).status).toBe(1);
		await noCreation();
		await absent(join(root, "pi-started"));
	});
	it.each(["absent", "branch only", "wrong branch at expected path"])(
		"does not create/reuse a %s worktree",
		async (kind) => {
			if (kind === "branch only") git(["branch", "weavra/fix-login"]);
			if (kind === "wrong branch at expected path") git(["worktree", "add", "-b", "other", target(), head]);
			const before = await snapshot([source]);
			const result = run(["--worktree-open", "fix-login"]);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("found 0");
			expect(await snapshot([source])).toEqual(before);
			await absent(join(root, "pi-started"));
			await readOnlyCalls();
		},
	);
	it.each(["missing", "gitfile missing", "gitfile broken", "corrupt index", "symlink"])(
		"refuses broken registered worktree: %s",
		async (kind) => {
			await existingWorktree();
			if (kind === "missing" || kind === "symlink") {
				const saved = join(root, "saved worktree");
				await rename(target(), saved);
				if (kind === "symlink") await symlink(saved, target());
			} else if (kind === "gitfile missing") await rm(join(target(), ".git"));
			else if (kind === "gitfile broken") await writeFile(join(target(), ".git"), "invalid Git metadata\n");
			else {
				const gitDir = git(["rev-parse", "--absolute-git-dir"], target());
				await writeFile(join(gitDir, "index"), "corrupt index\n");
			}
			const before = await snapshot([source]);
			const result = run(["--worktree-open", "fix-login"]);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("No repair or cleanup was performed");
			await absent(join(root, "pi-started"));
			expect(await snapshot([source])).toEqual(before);
			expect(git(["for-each-ref", "refs/heads/weavra/fix-login"])).not.toBe("");
			await readOnlyCalls();
		},
	);
	it.each(["list-error", "list-malformed", "list-duplicate", "list-wrong-branch", "list-changed"])(
		"fails closed on failed/ambiguous/forged/changing Git list: %s",
		async (fault) => {
			await existingWorktree();
			if (fault === "list-wrong-branch") {
				git(["branch", "other"]);
				git(["symbolic-ref", "HEAD", "refs/heads/other"], target());
			}
			const before = await snapshot([source, target()]);
			const result = run(["--worktree-open", "fix-login"], { GIT_FAULT: fault });
			expect(result.status, result.stderr).toBe(1);
			expect(result.stderr).not.toContain("Weavra worktree opened");
			await absent(join(root, "pi-started"));
			expect(await snapshot([source, target()])).toEqual(before);
			await readOnlyCalls();
		},
	);
	it("does not mistake another repository at the same path and branch for the registered worktree", async () => {
		await existingWorktree();
		await rename(target(), join(root, "saved checkout"));
		git(["clone", "--no-local", source, target()]);
		git(["checkout", "-b", "weavra/fix-login"], target());
		const result = run(["--worktree-open", "fix-login"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("different common repository");
		await absent(join(root, "pi-started"));
		await sourceUnchanged();
	});
	it("rejects a foreign repository even when its path is injected as a registered row", async () => {
		const foreign = join(root, "foreign repository");
		git(["clone", "--no-local", source, foreign]);
		git(["checkout", "-b", "weavra/fix-login"], foreign);
		const result = run(["--worktree-open", "fix-login"], { GIT_FAULT: "list-foreign", FAKE_WORKTREE_PATH: foreign });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("different common repository");
		await absent(join(root, "pi-started"));
		await noCreation();
		await sourceUnchanged();
	});
	it("rejects a forged registered path sharing the correct repository and branch but not the backlink", async () => {
		await existingWorktree();
		const impostor = join(root, "impostor");
		await mkdir(impostor);
		await copyFile(join(target(), ".git"), join(impostor, ".git"));
		const result = run(["--worktree-open", "fix-login"], { GIT_FAULT: "list-foreign", FAKE_WORKTREE_PATH: impostor });
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("metadata backlink mismatch");
		await absent(join(root, "pi-started"));
		await sourceUnchanged();
	});
	it("does not confuse a copied .git pointer with the registration backlink", async () => {
		await existingWorktree();
		const other = join(root, "other checkout");
		git(["worktree", "add", "-b", "other", other, head]);
		await copyFile(join(other, ".git"), join(target(), ".git"));
		git(["symbolic-ref", "HEAD", "refs/heads/weavra/fix-login"], other);
		// Git now has two records with the same branch; the launcher must not select either.
		expect(run(["--worktree-open", "fix-login"]).status).toBe(1);
		await absent(join(root, "pi-started"));
		await sourceUnchanged();
	});
	it("lists only Weavra refs read-only, without Pi build/Extension, state or session access", async () => {
		await existingWorktree();
		git(["worktree", "add", "-b", "other", join(root, "not weavra"), head]);
		await writeFile(join(target(), "app.txt"), "work in progress\n");
		await writeFile(join(source, "untracked"), "source dirty\n");
		await rm(cli);
		await rm(extension);
		const before = await snapshot([source, target()]);
		const result = run(["--worktree-list"]);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toBe(`NAME\tBRANCH\tPATH\tSTATUS\nfix-login\tweavra/fix-login\t${target()}\tOK\n`);
		expect(result.stderr).toBe("");
		await absent(join(root, "pi-started"));
		expect(await snapshot([source, target()])).toEqual(before);
		await readOnlyCalls();
	});
	it("lists missing/prunable entries without pruning and normal locked entries remain openable", async () => {
		await existingWorktree();
		git(["worktree", "lock", target()]);
		expect(run(["--worktree-open", "fix-login"]).status).toBe(0);
		expect(run(["--worktree-list"]).stdout).toContain("\tLOCKED\n");
		git(["worktree", "unlock", target()]);
		await rename(target(), join(root, "saved checkout"));
		const before = await snapshot([source]);
		const result = run(["--worktree-list"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("\tPRUNABLE\n");
		expect(await snapshot([source])).toEqual(before);
		await absent(target());
		await readOnlyCalls();
	});
	it.each(["list-error", "list-malformed"])(
		"does not report a successful list on Git discovery failure: %s",
		async (fault) => {
			const before = await snapshot([source]);
			const result = run(["--worktree-list"], { GIT_FAULT: fault });
			expect(result.status).toBe(1);
			expect(result.stdout).toBe("");
			expect(await snapshot([source])).toEqual(before);
			await absent(join(root, "pi-started"));
			await readOnlyCalls();
		},
	);
	it("escapes externally registered paths in list output instead of emitting terminal controls", async () => {
		await existingWorktree();
		const moved = join(root, "tab\tline\n\u001b[31m");
		git(["worktree", "move", target(), moved]);
		const result = run(["--worktree-list"]);
		expect(result.status).toBe(0);
		expect(result.stdout.trim().split("\n")).toHaveLength(2);
		expect(result.stdout).toContain("tab\\tline\\n\\u001b[31m");
		expect(result.stdout).not.toContain("\u001b");
		expect(result.stdout).toContain("\tBROKEN\n");
		expect(run(["--worktree-open", "fix-login"]).status).toBe(1);
		await absent(join(root, "pi-started"));
	});
	it("passes open/list spellings after -- to Pi without launcher interpretation", async () => {
		const args = ["--", "--worktree-open", "fix-login", "--worktree-list"];
		const result = run(args);
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ cwd: source, args: ["-e", extension, ...args] });
		await noCreation();
	});
	it("rejects repository redirection for both open and list", async () => {
		for (const args of [["--worktree-open", "fix-login"], ["--worktree-list"]]) {
			const result = run(args, { GIT_COMMON_DIR: source });
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("unset GIT_COMMON_DIR");
		}
		await absent(join(root, "pi-started"));
		await noCreation();
	});
	it("empty listing is successful and non-Git discovery fails without mutation", async () => {
		expect(run(["--worktree-list"]).stdout).toBe("NAME\tBRANCH\tPATH\tSTATUS\n");
		cwd = root;
		expect(run(["--worktree-list"]).status).toBe(1);
		expect(run(["--worktree-open", "fix-login"]).status).toBe(1);
		await noCreation();
		await absent(join(root, "pi-started"));
	});
	it("open still fails before starting any Pi if its local build is absent; create remains create-only", async () => {
		await existingWorktree();
		const before = await snapshot([source, target()]);
		expect(run().stderr).toContain("branch already exists");
		await rm(cli);
		const result = run(["--worktree-open", "fix-login", "--continue"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("No global Pi fallback");
		await absent(join(root, "pi-started"));
		expect(await snapshot([source, target()])).toEqual(before);
	});
	it.each([{ code: "23" }, { code: "0", signal: "SIGTERM" }])(
		"preserves open stdio/exit/signal and leaves the worktree: $code/$signal",
		async ({ code, signal }) => {
			await existingWorktree();
			const result = run(
				["--worktree-open", "fix-login"],
				{ PI_EXIT: code, SIGNAL_EXIT: signal, ECHO_STDIN: "1" },
				"stdin bytes\n",
			);
			if (signal) expect(result.signal).toBe(signal);
			else expect(result.status).toBe(Number(code));
			expect(result.stdout).toContain("stdin bytes\n");
			expect(result.stderr).toContain("Pi stderr");
			expect(git(["rev-parse", "HEAD"], target())).toBe(head);
			await sourceUnchanged();
		},
	);
});
