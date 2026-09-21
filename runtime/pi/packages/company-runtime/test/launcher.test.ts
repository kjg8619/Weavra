import { spawnSync } from "node:child_process";
import {
	chmod,
	copyFile,
	cp,
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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const repository = fileURLToPath(new URL("../../../", import.meta.url));
let root: string;
let checkout: string;
let cwd: string;
let bin: string;
let launcher: string;
let extension: string;
let cli: string;

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "weavra launcher ")));
	checkout = join(root, "checkout with spaces");
	cwd = join(root, "my project");
	bin = join(root, "global", "bin");
	launcher = join(checkout, "packages/company-runtime/bin/weavra");
	extension = join(checkout, "packages/company-runtime/src/extension.ts");
	cli = join(checkout, "packages/coding-agent/dist/bundle/cli.js");
	for (const directory of [cwd, bin, dirname(launcher), dirname(cli)]) await mkdir(directory, { recursive: true });
	await copyFile(join(packageRoot, "bin/weavra"), launcher);
	await chmod(launcher, 0o755);
	await cp(join(packageRoot, "src"), dirname(extension), { recursive: true });
	await symlink(join(repository, "node_modules"), join(checkout, "node_modules"));
	await symlink(process.execPath, join(bin, "node"));
	await mkdir(join(root, ".weavra"), { mode: 0o700 });
	await mkdir(join(root, ".weavra/agent"), { mode: 0o700 });
	// A local CLI process fixture, not a Pi build. The real Extension is checked through the public loader below.
	await writeFile(
		cli,
		`#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({cli: process.argv[1], cwd: process.cwd(), args: process.argv.slice(2), marker: process.env.WEAVRA_TEST_MARKER, home: process.env.HOME, agentDir: process.env.PI_CODING_AGENT_DIR})); process.exit(Number(process.env.WEAVRA_TEST_EXIT || 0));\n`,
		{ mode: 0o755 },
	);
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});
function run(args: string[] = [], entry = launcher, env: NodeJS.ProcessEnv = {}) {
	return spawnSync(entry, args, {
		cwd,
		env: {
			PATH: `${bin}:/usr/bin:/bin`,
			HOME: root,
			PI_CODING_AGENT_DIR: join(root, "existing agent dir"),
			WEAVRA_TEST_MARKER: "unchanged",
			...env,
		},
		encoding: "utf8",
		timeout: 10_000,
	});
}
async function globalPi(version = "global-unrelated-version") {
	const program = join(root, "original-pi");
	await writeFile(
		program,
		`#!${process.execPath}\nrequire('node:fs').writeFileSync(${JSON.stringify(join(root, "global-called"))}, 'called'); console.log(${JSON.stringify(version)});\n`,
		{ mode: 0o755 },
	);
	await symlink(program, join(bin, "pi"));
	return program;
}

describe("Weavra fork-local launcher (POSIX)", () => {
	it.each([
		{ args: [] },
		{ args: ["--help"] },
		{ args: ["--version"] },
		{ args: ["--model", "example/provider model", "--thinking", "high"] },
		{
			args: [
				"--no-extensions",
				"-e",
				"./other extension.ts",
				"--",
				"",
				"@file with spaces.ts",
				"$(touch marker); *",
			],
		},
	])("uses the local CLI without global Pi, preserves cwd/argv and isolates agent dir: $args", ({ args }) => {
		const result = run(args);
		expect(result.error).toBeUndefined();
		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");
		expect(JSON.parse(result.stdout)).toEqual({
			cli,
			cwd,
			args: ["-e", extension, ...args],
			marker: "unchanged",
			home: root,
			agentDir: join(root, ".weavra/agent"),
		});
	});
	it.each(["0.1.0", "999.0.0"])("never invokes a global Pi, even with a different version: %s", async (version) => {
		const baseline = run(["--version"]).stdout;
		const program = await globalPi(version);
		const before = await readFile(program, "utf8");
		const result = run(["--version"]);
		expect(result.status).toBe(0);
		expect(result.stdout).toBe(baseline);
		await expect(readFile(join(root, "global-called"))).rejects.toMatchObject({ code: "ENOENT" });
		expect(await readlink(join(bin, "pi"))).toBe(program);
		expect(await readFile(program, "utf8")).toBe(before);
		// The user's pi command still works independently and returns its own version.
		expect(run(["--version"], join(bin, "pi")).stdout.trim()).toBe(version);
	});
	it("resolves npm-style chained symlinks and a symlinked checkout from another project", async () => {
		const alias = join(root, "checkout alias");
		await symlink(checkout, alias);
		const first = join(root, "linked launcher");
		await symlink(join(alias, "packages/company-runtime/bin/weavra"), first);
		const linked = join(bin, "weavra");
		await symlink("../../linked launcher", linked);
		const result = run([], linked, { CDPATH: root });
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ cli, cwd, args: ["-e", extension] });
	});
	it("ignores CDPATH when invoked through a relative launcher path", () => {
		const result = run([], relative(cwd, launcher), { CDPATH: root });
		expect(result.status).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ cli, cwd, args: ["-e", extension] });
	});
	it("registers six commands including read-only LSP status through the public Pi loader", async () => {
		const result = run();
		expect(result.status).toBe(0);
		const { args } = JSON.parse(result.stdout) as { args: string[] };
		const loaded = await discoverAndLoadExtensions([args[1]], cwd, join(root, "agent"));
		expect(loaded.errors).toEqual([]);
		expect(loaded.extensions).toHaveLength(1);
		expect([...loaded.extensions[0].commands.keys()].sort()).toEqual([
			"graph",
			"lsp",
			"risk",
			"state",
			"team",
			"workflow",
		]);
		for (const command of loaded.extensions[0].commands.values()) expect(command.description).toContain("Weavra");
	});
	it("returns the local Pi exit code", () => {
		expect(run([], launcher, { WEAVRA_TEST_EXIT: "23" }).status).toBe(23);
	});
	it("exec replaces the wrapper so signals terminate the local CLI directly", async () => {
		await writeFile(cli, "#!/usr/bin/env node\nprocess.kill(process.pid, 'SIGTERM');\n");
		const result = run();
		expect(result.signal).toBe("SIGTERM");
	});
	it("preserves stdin, stdout and stderr", async () => {
		await writeFile(
			cli,
			"#!/usr/bin/env node\nprocess.stdin.pipe(process.stdout); process.stderr.write('local stderr');\n",
		);
		const result = spawnSync(launcher, [], {
			cwd,
			env: { PATH: `${bin}:/usr/bin:/bin`, HOME: root },
			input: "unchanged stdin\n",
			encoding: "utf8",
			timeout: 10_000,
		});
		expect(result.status).toBe(0);
		expect(result.stdout).toBe("unchanged stdin\n");
		expect(result.stderr).toBe("local stderr");
	});
	it.each(["missing", "directory", "not-executable"])(
		"fails fast on a %s local build; never falls back to global Pi",
		async (failure) => {
			await globalPi();
			if (failure === "not-executable") await chmod(cli, 0o644);
			else {
				await rm(cli);
				if (failure === "directory") await mkdir(cli);
			}
			const result = run(["--help"]);
			expect(result.status).toBe(1);
			expect(result.stderr).toContain("Weavra: fork-local Pi build is missing or not executable");
			expect(result.stderr).toContain(cli);
			expect(result.stderr).toContain("npm install --ignore-scripts && npm run build");
			expect(result.stderr).toContain("No global Pi fallback");
			expect(result.stdout).toBe("");
			await expect(readFile(join(root, "global-called"))).rejects.toMatchObject({ code: "ENOENT" });
		},
	);
	it("does not fall back after the local CLI fails", async () => {
		await globalPi();
		expect(run([], launcher, { WEAVRA_TEST_EXIT: "42" }).status).toBe(42);
		await expect(readFile(join(root, "global-called"))).rejects.toMatchObject({ code: "ENOENT" });
	});
	it("reports an incomplete or relocated launcher before starting any CLI", async () => {
		const relocated = join(bin, "weavra");
		await copyFile(launcher, relocated);
		await chmod(relocated, 0o755);
		const result = run([], relocated);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain("Weavra: extension not found or unreadable");
		expect(result.stderr).toContain("npm link");
		expect(result.stdout).toBe("");
	});
	it("keeps the local CLI path aligned with the coding-agent bin contract and exposes only weavra", async () => {
		const metadata = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
		const pi = JSON.parse(await readFile(join(repository, "packages/coding-agent/package.json"), "utf8"));
		expect(metadata.bin).toEqual({ weavra: "bin/weavra" });
		expect(metadata.private).toBe(true);
		expect(cli).toBe(join(checkout, "packages/coding-agent", pi.bin.pi));
	});
	it("actual npm link in an isolated prefix adds only weavra and preserves the existing pi symlink", async () => {
		const program = await globalPi();
		const before = await readFile(program, "utf8");
		const result = spawnSync(
			"npm",
			["link", "--workspace", "packages/company-runtime", "--ignore-scripts", "--offline"],
			{
				cwd: repository,
				env: { ...process.env, npm_config_prefix: join(root, "global") },
				encoding: "utf8",
				timeout: 30_000,
			},
		);
		expect(result.error).toBeUndefined();
		expect(result.status, result.stderr).toBe(0);
		expect(await realpath(join(bin, "weavra"))).toBe(join(packageRoot, "bin/weavra"));
		expect((await readdir(bin)).sort()).toEqual(["node", "pi", "weavra"]);
		expect(await readlink(join(bin, "pi"))).toBe(program);
		expect(await readFile(program, "utf8")).toBe(before);
		expect(run([], join(bin, "pi")).stdout.trim()).toBe("global-unrelated-version");
	});
});
