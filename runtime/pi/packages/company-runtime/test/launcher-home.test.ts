import { spawnSync } from "node:child_process";
import {
	chmod,
	copyFile,
	link,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	readlink,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importConfig, prepareLaunch, resolveWeavraHome, setupWeavra } from "../src/launcher-home.ts";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
let root: string;
let home: string;
let project: string;
let checkout: string;
let launcher: string;
let cli: string;
let bin: string;
let env: NodeJS.ProcessEnv;
const fakeSecret = "FAKE_TEST_TOKEN_NEVER_PRINT_123";
const candidates = ["auth.json", "models.json", "settings.json"] as const;
function agent() {
	return join(home, ".weavra/agent");
}
function piAgent() {
	return join(home, ".pi/agent");
}
function run(args: string[], input = "", extraEnv: NodeJS.ProcessEnv = {}) {
	const result = spawnSync(launcher, args, {
		cwd: project,
		env: { ...env, ...extraEnv },
		input,
		encoding: "utf8",
		timeout: 15000,
	});
	expect(result.error).toBeUndefined();
	expect(result.stdout + result.stderr).not.toContain(fakeSecret);
	return result;
}
async function absent(path: string) {
	await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
}
async function snapshot(path: string): Promise<Record<string, string>> {
	const values: Record<string, string> = {};
	async function visit(path: string): Promise<void> {
		const info = await lstat(path);
		values[path] = String(info.mode);
		if (info.isSymbolicLink()) values[path] += await readlink(path);
		else if (info.isDirectory()) for (const entry of await readdir(path)) await visit(join(path, entry));
		else values[path] += (await readFile(path)).toString("hex");
	}
	await visit(path);
	return values;
}
async function piFiles() {
	await mkdir(piAgent(), { recursive: true });
	await writeFile(join(piAgent(), "auth.json"), JSON.stringify({ faux: { type: "api_key", key: fakeSecret } }));
	await writeFile(join(piAgent(), "models.json"), JSON.stringify({ providers: { faux: { apiKey: fakeSecret } } }));
	await writeFile(
		join(piAgent(), "settings.json"),
		JSON.stringify({ theme: "dark", extensions: ["pi-only"], marker: fakeSecret }),
	);
	await mkdir(join(piAgent(), "sessions"));
	await writeFile(join(piAgent(), "sessions/previous.jsonl"), "user Pi session; keep");
}
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "weavra home ")));
	home = join(root, "user 홈");
	project = join(root, "project");
	checkout = join(root, "fork checkout");
	bin = join(root, "bin");
	launcher = join(checkout, "packages/company-runtime/bin/weavra");
	cli = join(checkout, "packages/coding-agent/dist/bundle/cli.js");
	for (const path of [
		home,
		project,
		bin,
		dirname(launcher),
		dirname(cli),
		join(checkout, "packages/company-runtime/src"),
	])
		await mkdir(path, { recursive: true });
	await copyFile(join(packageRoot, "bin/weavra"), launcher);
	await chmod(launcher, 0o755);
	for (const file of ["launcher-home.ts", "launcher-worktrees.ts"])
		await copyFile(join(packageRoot, "src", file), join(checkout, "packages/company-runtime/src", file));
	await writeFile(join(checkout, "packages/company-runtime/src/extension.ts"), "// fixture\n");
	await symlink(process.execPath, join(bin, "node"));
	await writeFile(
		cli,
		`#!/usr/bin/env node
console.log(JSON.stringify({ cwd: process.cwd(), args: process.argv.slice(2), agentDir: process.env.PI_CODING_AGENT_DIR, sessionDir: process.env.PI_CODING_AGENT_SESSION_DIR ?? null, home: process.env.HOME, marker: process.env.MARKER }));
`,
		{ mode: 0o755 },
	);
	await writeFile(
		join(bin, "pi"),
		`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(join(root, "global-called"))}, 'called');\n`,
		{ mode: 0o755 },
	);
	env = {
		PATH: `${bin}:/usr/bin:/bin`,
		HOME: home,
		MARKER: "preserved",
		PI_CODING_AGENT_DIR: join(home, "old Pi"),
		PI_CODING_AGENT_SESSION_DIR: join(home, "old sessions"),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
	};
});
afterEach(async () => {
	try {
		await absent(join(root, "global-called"));
		await absent(join(project, ".ai"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

describe("Weavra product home paths and first run", () => {
	it("resolves default home without writing and ignores inherited Pi agent/session paths", async () => {
		const paths = await resolveWeavraHome(env);
		expect(paths).toEqual({
			home: join(home, ".weavra"),
			agentDir: agent(),
			piHome: join(home, ".pi"),
			piAgentDir: piAgent(),
		});
		await absent(paths.home);
		const result = run([]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Weavra has not been set up. Run: weavra setup");
		await absent(paths.home);
	});
	it.each(["absolute", "tilde"])(
		"uses custom %s WEAVRA_HOME with spaces/unicode independently of project cwd",
		async (kind) => {
			const custom = join(home, "개인 assistant", "Weavra");
			const override = kind === "tilde" ? "~/개인 assistant/Weavra" : custom;
			const setup = run(["setup"], "", { WEAVRA_HOME: override });
			expect(setup.status, setup.stderr).toBe(0);
			project = root;
			const result = run(["--continue"], "", { WEAVRA_HOME: override });
			expect(result.status, result.stderr).toBe(0);
			expect(JSON.parse(result.stdout).agentDir).toBe(join(custom, "agent"));
			await absent(join(home, ".weavra"));
		},
	);
	it.each(["", "/", "relative/path", "../pi", "/tmp/bad\npath"])("rejects ambiguous WEAVRA_HOME %s", async (value) => {
		expect(run(["setup"], "", { WEAVRA_HOME: value }).status).toBe(1);
		await absent(join(home, ".weavra"));
	});
	it.each(["same", "inside", "parent", "symlink"])("refuses Pi home overlap: %s", async (kind) => {
		await piFiles();
		let override = kind === "same" ? join(home, ".pi") : kind === "inside" ? join(piAgent(), "weavra") : home;
		if (kind === "symlink") {
			override = join(home, "alias");
			await symlink(join(home, ".pi"), override);
		}
		const before = await snapshot(join(home, ".pi"));
		for (const command of ["setup", "doctor"])
			expect(run([command], "yes\nyes\nyes\n", { WEAVRA_HOME: override }).status).toBe(1);
		expect(await snapshot(join(home, ".pi"))).toEqual(before);
	});
	it("rejects a linked agent/session directory rather than letting Pi write into its old home", async () => {
		await piFiles();
		expect(run(["setup"]).status).toBe(0);
		await rm(join(agent(), "sessions"), { recursive: true });
		await symlink(join(piAgent(), "sessions"), join(agent(), "sessions"));
		const before = await snapshot(piAgent());
		expect(run([]).status).toBe(1);
		expect(run(["doctor"]).status).toBe(1);
		expect(await snapshot(piAgent())).toEqual(before);
	});
	it.each([
		{ args: ["--continue"] },
		{ args: ["-c"] },
		{ args: ["--resume"] },
		{ args: ["-r"] },
		{ args: ["--session", "/explicit Pi session.jsonl"] },
		{ args: ["--session-dir", "/explicit session directory"] },
	])("preserves Pi argv but isolates child env: $args", ({ args }) => {
		expect(run(["setup"]).status).toBe(0);
		const result = run(args);
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({
			cwd: project,
			args: ["-e", join(checkout, "packages/company-runtime/src/extension.ts"), ...args],
			agentDir: agent(),
			sessionDir: null,
			home,
			marker: "preserved",
		});
		expect(env.PI_CODING_AGENT_DIR).toBe(join(home, "old Pi"));
	});
	it.each([
		{ args: ["setup", "--continue"] },
		{ args: ["doctor", "--session", "x"] },
		{ args: ["setup", "--worktree", "x"] },
		{ args: ["--worktree", "x", "setup"] },
		{ args: ["--worktree-open", "x", "doctor"] },
		{ args: ["--worktree-list", "setup"] },
		{ args: ["setup", "doctor"] },
	])("rejects ambiguous launcher command combinations: $args", async ({ args }) => {
		expect(run(args).status).toBe(1);
		await absent(join(home, ".weavra"));
	});
	it("uses the real Pi SessionManager under Weavra for continue and cwd partitioning", async () => {
		await piFiles();
		expect(run(["setup"]).status).toBe(0);
		const before = await snapshot(piAgent());
		await writeFile(join(checkout, "package.json"), '{"type":"module"}');
		const manager = fileURLToPath(new URL("../../coding-agent/src/core/session-manager.ts", import.meta.url));
		await writeFile(
			cli,
			`#!${process.execPath}
import { writeFileSync } from 'node:fs';
import { SessionManager } from ${JSON.stringify(manager)};
const args = process.argv.slice(2);
const explicit = args.includes('--session-dir') ? args[args.indexOf('--session-dir') + 1] : undefined;
const session = args.includes('--continue') ? SessionManager.continueRecent(process.cwd(), explicit) : SessionManager.create(process.cwd(), explicit);
if (!args.includes('--continue')) writeFileSync(session.getSessionFile(), JSON.stringify(session.getHeader()) + '\\n');
console.log(JSON.stringify({id:session.getSessionId(), directory:session.getSessionDir(), file:session.getSessionFile()}));
`,
		);
		const created = run([]);
		expect(created.status, created.stderr).toBe(0);
		const original = JSON.parse(created.stdout);
		expect(original.directory.startsWith(`${join(agent(), "sessions")}/`)).toBe(true);
		expect(JSON.parse(run(["--continue"]).stdout).id).toBe(original.id);
		project = join(root, "second project");
		await mkdir(project);
		const second = JSON.parse(run(["--continue"]).stdout);
		expect(second.id).not.toBe(original.id);
		expect(second.directory).not.toBe(original.directory);
		const explicit = join(root, "explicit sessions");
		expect(JSON.parse(run(["--session-dir", explicit]).stdout).directory).toBe(explicit);
		expect(await snapshot(piAgent())).toEqual(before);
		await absent(join(home, "old sessions"));
	});
	it("fails setup preflight before worktree mutation, while worktree-list remains setup-independent", async () => {
		const before = await snapshot(project);
		const result = run(["--worktree", "fix-login"]);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Run: weavra setup");
		expect(await snapshot(project)).toEqual(before);
		await absent(join(root, ".weavra-worktrees"));
		const listing = run(["--worktree-list"]);
		expect(listing.status).toBe(1); // Non-Git source, not a setup requirement.
		expect(listing.stderr).not.toContain("Run: weavra setup");
		await absent(join(home, ".weavra"));
	});
	it("passes reserved prompt text after -- through to Pi", () => {
		expect(run(["setup"]).status).toBe(0);
		expect(JSON.parse(run(["--", "setup", "doctor"]).stdout).args.slice(2)).toEqual(["--", "setup", "doctor"]);
	});
});

describe("explicit setup imports, no overwrite or secret output", () => {
	it("creates only Weavra directories with private modes and is idempotent without a Git repo/build", async () => {
		await rm(cli);
		const first = run(["setup"]);
		expect(first.status, first.stderr).toBe(0);
		expect(first.stdout).toContain("Existing Pi sessions were not imported automatically.");
		for (const path of [
			join(home, ".weavra"),
			agent(),
			...["sessions", "themes", "prompts", "tools", "bin"].map((dir) => join(agent(), dir)),
		])
			expect((await lstat(path)).mode & 0o777).toBe(0o700);
		const before = await snapshot(home);
		expect(run(["setup"]).status).toBe(0);
		expect(await snapshot(home)).toEqual(before);
		await absent(join(home, ".pi"));
	});
	it("lists only three candidates and does not import without explicit consent (including EOF)", async () => {
		await piFiles();
		const before = await snapshot(piAgent());
		const result = run(["setup"]);
		expect(result.status, result.stderr).toBe(0);
		for (const name of candidates) {
			expect(result.stdout).toContain(`[x] ${name}`);
			await absent(join(agent(), name));
		}
		expect(await readdir(join(agent(), "sessions"))).toEqual([]);
		expect(await snapshot(piAgent())).toEqual(before);
	});
	it.each([
		{ answers: "y\nn\nn\n", copied: ["auth.json"] },
		{ answers: "n\ny\nn\n", copied: ["models.json"] },
		{ answers: "n\nn\nyes\n", copied: ["settings.json"] },
		{ answers: "yes\nyes\nyes\n", copied: [...candidates] },
		{ answers: "\nno\nmaybe\n", copied: [] },
	])("imports only explicitly approved files: $copied", async ({ answers, copied }) => {
		await piFiles();
		const before = await snapshot(piAgent());
		const result = run(["setup"], answers);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout.indexOf("WARNING: settings.json")).toBeLessThan(
			result.stdout.indexOf("Import settings.json"),
		);
		for (const name of candidates) {
			if (copied.includes(name)) {
				expect((await readFile(join(agent(), name))).equals(await readFile(join(piAgent(), name)))).toBe(true);
				expect((await lstat(join(agent(), name))).mode & 0o777).toBe(0o600);
				expect((await lstat(join(agent(), name))).nlink).toBe(1);
			} else await absent(join(agent(), name));
		}
		expect(await readdir(join(agent(), "sessions"))).toEqual([]);
		expect(await snapshot(piAgent())).toEqual(before);
	});
	it("SKIPs existing destination bytes/permissions without asking or overwriting", async () => {
		await piFiles();
		expect(run(["setup"], "y\ny\ny\n").status).toBe(0);
		await writeFile(join(agent(), "auth.json"), '{"user":"existing"}');
		const before = await snapshot(home);
		const result = run(["setup"], "y\ny\ny\n");
		expect(result.status).toBe(0);
		for (const name of candidates) expect(result.stdout).toContain(`SKIP ${name}: Weavra destination already exists`);
		expect(result.stdout).not.toContain("Import auth.json into");
		expect(await snapshot(home)).toEqual(before);
	});
	it.each(["file", "directory", "symlink"])("never overwrites an existing destination %s", async (kind) => {
		await piFiles();
		expect(run(["setup"]).status).toBe(0);
		const target = join(agent(), "auth.json");
		if (kind === "directory") await mkdir(target);
		else if (kind === "symlink") await symlink(join(piAgent(), "auth.json"), target);
		else await writeFile(target, "keep even invalid JSON", { mode: 0o600 });
		const before = await snapshot(home);
		const result = run(["setup"], "no\nno\n");
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("SKIP auth.json: Weavra destination already exists");
		expect(await snapshot(home)).toEqual(before);
	});
	it.each(["malformed", "symlink", "hardlink"])(
		"refuses unsafe %s imports without touching Pi or publishing credential bytes",
		async (kind) => {
			await piFiles();
			const source = join(piAgent(), "auth.json");
			if (kind === "malformed") await writeFile(source, `${fakeSecret} invalid`);
			if (kind === "symlink") {
				await rm(source);
				await symlink(join(piAgent(), "models.json"), source);
			}
			if (kind === "hardlink") await link(source, join(piAgent(), "auth-link"));
			const before = await snapshot(piAgent());
			const result = run(["setup"], "y\nn\nn\n");
			if (kind === "malformed") expect(result.status).toBe(1);
			await absent(join(agent(), "auth.json"));
			expect(await snapshot(piAgent())).toEqual(before);
		},
	);
	it("failed publication cleans only its temp and preserves both source and preexisting destination", async () => {
		await piFiles();
		await setupWeavra(
			env,
			async () => false,
			() => {},
		);
		const paths = await resolveWeavraHome(env);
		const before = await snapshot(home);
		await expect(
			importConfig(paths, "auth.json", async () => {
				throw new Error(fakeSecret);
			}),
		).rejects.toThrow("Import failed for auth.json");
		expect(await snapshot(home)).toEqual(before);
		const status = await importConfig(paths, "auth.json", async () => {
			await writeFile(join(agent(), "auth.json"), '{"external":"keep"}', { mode: 0o600 });
		});
		expect(status).toBe("SKIP");
		expect(await readFile(join(agent(), "auth.json"), "utf8")).toBe('{"external":"keep"}');
		expect((await readdir(agent())).some((name) => name.startsWith(".import-"))).toBe(false);
	});
});

describe("read-only doctor", () => {
	it("unconfigured doctor fails without creating anything", async () => {
		const before = await snapshot(home);
		const result = run(["doctor"]);
		expect(result.status).toBe(1);
		expect(result.stdout).toContain("FAIL  Agent directory");
		expect(result.stdout).toContain("Result: NOT READY");
		expect(await snapshot(home)).toEqual(before);
	});
	it("reports local READY and optional missing auth/models/settings as WARN without networking/mutation", async () => {
		expect(run(["setup"]).status).toBe(0);
		const before = await snapshot(home);
		const result = run(["doctor"]);
		expect(result.status, result.stderr).toBe(0);
		for (const item of [
			"Fork-local checkout",
			"Pi build",
			"Weavra extension",
			"Node",
			"Git",
			"Isolation",
			"Agent directory",
			"Default session root",
		])
			expect(result.stdout).toContain(`PASS  ${item}`);
		expect(result.stdout).toContain("WARN  auth.json");
		expect(result.stdout).toContain("Result: READY (local checks only");
		expect(await snapshot(home)).toEqual(before);
	});
	it.each(["auth.json", "models.json", "settings.json"])(
		"invalid %s fails safely without printing parse errors or credentials",
		async (name) => {
			expect(run(["setup"]).status).toBe(0);
			await writeFile(join(agent(), name), `{${fakeSecret}`, { mode: 0o600 });
			const before = await snapshot(home);
			const result = run(["doctor"]);
			expect(result.status).toBe(1);
			expect(result.stdout).toContain(`FAIL  ${name}`);
			expect(await snapshot(home)).toEqual(before);
		},
	);
	it.each(["build", "extension", "git", "permissions", "agent symlink", "auth permissions"])(
		"reports required failure %s without repair",
		async (failure) => {
			await piFiles();
			expect(run(["setup"], "y\ny\nn\n").status).toBe(0);
			if (failure === "build") await rm(cli);
			if (failure === "extension") await rm(join(checkout, "packages/company-runtime/src/extension.ts"));
			if (failure === "git")
				await writeFile(
					join(bin, "git"),
					`#!${process.execPath}\nconsole.error(${JSON.stringify(fakeSecret)});process.exit(1);\n`,
					{ mode: 0o755 },
				);
			if (failure === "permissions") await chmod(agent(), 0o755);
			if (failure === "auth permissions") await chmod(join(agent(), "auth.json"), 0o644);
			if (failure === "agent symlink") {
				await rm(agent(), { recursive: true });
				await symlink(piAgent(), agent());
			}
			const before = await snapshot(home);
			expect(run(["doctor"]).status).toBe(1);
			expect(await snapshot(home)).toEqual(before);
		},
	);
	it("reports configured settings.sessionDir without printing its value and keeps explicit CLI behavior available", async () => {
		expect(run(["setup"]).status).toBe(0);
		await writeFile(join(agent(), "settings.json"), JSON.stringify({ sessionDir: fakeSecret }), { mode: 0o600 });
		const result = run(["doctor"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain("WARN  Session resolution");
	});
	it("prepareLaunch is read-only and missing auth remains usable for Pi /login", async () => {
		expect(run(["setup"]).status).toBe(0);
		const before = await snapshot(home);
		expect(await prepareLaunch(env)).toBe(agent());
		expect(await snapshot(home)).toEqual(before);
	});
});
