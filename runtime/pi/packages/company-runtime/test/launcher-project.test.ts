import { spawnSync } from "node:child_process";
import {
	chmod,
	link,
	lstat,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	symlink,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { CompanyKernel } from "../src/kernel.ts";
import { FileStateStore } from "../src/state-store.ts";
import { testContract } from "./fixture-contract.ts";

const launcher = fileURLToPath(new URL("../bin/weavra", import.meta.url));
const secret = "PRIVATE_CONFIG_TEST_SECRET";
const valid = `schemaVersion: 1
models:
  profiles:
    coding: { provider: faux, model: coding }
    reasoning: { provider: faux, model: reasoning }
verification:
  sandbox: { mode: disabled }
  checks:
    - id: test
      kind: test
      executable: node
      args: ['--version']
      required: true
budget: { max_worker_invocations: 3 }
`;
let root: string;
let project: string;
let source: string;
let config: string;
function run(args: string[], cwd = project, input?: string, extraEnv: NodeJS.ProcessEnv = {}) {
	const result = spawnSync(launcher, args, {
		cwd,
		env: {
			...process.env,
			PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
			HOME: join(root, "unused-home"),
			...extraEnv,
		},
		input,
		encoding: "utf8",
		timeout: 15000,
	});
	expect(result.error).toBeUndefined();
	expect(result.stdout + result.stderr).not.toContain(secret);
	return result;
}
function git(...args: string[]) {
	const result = spawnSync("git", ["-C", project, ...args], { encoding: "utf8" });
	expect(result.status, result.stderr).toBe(0);
}
async function absent(path: string) {
	await expect(lstat(path)).rejects.toMatchObject({ code: "ENOENT" });
}
beforeEach(async () => {
	root = await realpath(await mkdtemp(join(tmpdir(), "weavra project ")));
	project = join(root, "project");
	source = join(root, "reviewed.yaml");
	config = join(project, ".ai/config.yaml");
	await mkdir(project);
	await writeFile(source, valid);
	git("init", "-q");
});
afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("standalone project onboarding launcher", () => {
	it("returns exact saved bytes and digest for the App first-save contract", async () => {
		const created = run(["project", "init", "--stdin", "--json"], project, valid);
		expect(created.status, created.stderr).toBe(0);
		const result = JSON.parse(created.stdout);
		expect(result).toMatchObject({ schemaVersion: 1, kind: "saved", yaml: valid });
		expect(result.configDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
		const reread = JSON.parse(run(["project", "read", "--json"]).stdout);
		expect(result.configDigest).toBe(reread.configDigest);
		await absent(join(root, "unused-home"));
	});
	it("requires an explicit reviewed YAML file without home setup or a Runtime build", async () => {
		const missing = run(["project", "init"]);
		expect(missing.status).toBe(1);
		await absent(join(project, ".ai"));
		const created = run(["project", "init", "--config", source]);
		expect(created.status, created.stderr).toBe(0);
		expect(await readFile(config, "utf8")).toBe(valid);
		expect((await lstat(config)).mode & 0o777).toBe(0o600);
		await absent(join(root, "unused-home"));
	});
	it("refuses invalid YAML before creating .ai and never discloses config bytes", async () => {
		await writeFile(source, `schemaVersion: 1\ncredential: ${secret}\n`);
		expect(run(["project", "init", "--config", source]).status).toBe(1);
		await absent(join(project, ".ai"));
	});
	it.each(["file", "directory", "symlink"])("refuses existing %s config without replacement", async (kind) => {
		await mkdir(join(project, ".ai"));
		if (kind === "directory") await mkdir(config);
		else if (kind === "symlink") await symlink(source, config);
		else await writeFile(config, "original");
		const before = await lstat(config);
		expect(run(["project", "init", "--config", source]).status).toBe(1);
		expect((await lstat(config)).ino).toBe(before.ino);
		expect(await readdir(join(project, ".ai"))).toEqual(["config.yaml"]);
	});
	it.each(["symlink", "directory", "hardlink"])("refuses unsafe %s source without publication", async (kind) => {
		if (kind === "symlink") {
			const target = join(root, "actual.yaml");
			await writeFile(target, valid);
			await rm(source);
			await symlink(target, source);
		} else if (kind === "directory") {
			await rm(source);
			await mkdir(source);
		} else await link(source, join(root, "alias.yaml"));
		expect(run(["project", "init", "--config", source]).status).toBe(1);
		await absent(join(project, ".ai"));
	});
	it("refuses a source under a symlinked parent directory", async () => {
		const alias = join(root, "alias");
		await symlink(root, alias);
		expect(run(["project", "init", "--config", join(alias, "reviewed.yaml")]).status).toBe(1);
		await absent(join(project, ".ai"));
	});
	it("refuses a linked .ai directory and an existing writer lock", async () => {
		const foreign = join(root, "foreign");
		await mkdir(foreign);
		await symlink(foreign, join(project, ".ai"));
		expect(run(["project", "init", "--config", source]).status).toBe(1);
		await absent(join(foreign, "config.yaml"));
		await rm(join(project, ".ai"));
		await mkdir(join(project, ".ai"));
		await writeFile(join(project, ".ai/writer.lock"), "active");
		expect(run(["project", "init", "--config", source]).status).toBe(1);
		await absent(config);
	});
	it("requires exactly the Git root and never initializes a repository", async () => {
		const nested = join(project, "nested");
		await mkdir(nested);
		expect(run(["project", "init", "--config", source], nested).status).toBe(1);
		expect(run(["project", "init", "--config", source], root).status).toBe(1);
		await absent(join(project, ".ai"));
	});
	it("doctor is read-only for missing prerequisites and emits stable JSON diagnostics", async () => {
		const before = await readdir(project);
		const result = run(["project", "doctor", "--json"]);
		expect(result.status).toBe(1);
		const report = JSON.parse(result.stdout);
		expect(report.schemaVersion).toBe(1);
		expect(report.ready).toBe(false);
		expect(report.diagnostics).toContainEqual(expect.objectContaining({ code: "CONFIG_MISSING", severity: "ERROR" }));
		expect(report.diagnostics).toContainEqual(
			expect.objectContaining({ code: "GIT_HEAD_MISSING", severity: "ERROR" }),
		);
		expect(await readdir(project)).toEqual(before);
		await absent(join(root, "unused-home"));
	});
	it("reads config through bounded JSON and preserves the legacy doctor JSON shape", async () => {
		expect(run(["project", "init", "--config", source]).status).toBe(0);
		const read = run(["project", "read", "--json"]);
		expect(read.status, read.stderr).toBe(0);
		const report = JSON.parse(read.stdout);
		expect(report).toMatchObject({ schemaVersion: 1, kind: "read", yaml: valid });
		expect(report.configDigest).toMatch(/^sha256:[0-9a-f]{64}$/);

		const legacy = run(["project", "doctor", "--json"]);
		const app = run(["project", "doctor", "--app-json"]);
		expect(JSON.parse(legacy.stdout)).not.toHaveProperty("kind");
		expect(JSON.parse(app.stdout)).toMatchObject({ kind: "doctor", schemaVersion: 1 });
	});
	it("updates only the matching config digest and preserves stale config", async () => {
		expect(run(["project", "init", "--config", source]).status).toBe(0);
		const initial = JSON.parse(run(["project", "read", "--json"]).stdout);
		const changed = valid.replace("max_worker_invocations: 3", "max_worker_invocations: 4");
		const saved = run(
			["project", "update", "--stdin", "--json"],
			project,
			JSON.stringify({ yaml: changed, expectedConfigDigest: initial.configDigest }),
		);
		expect(saved.status, saved.stderr).toBe(0);
		expect(JSON.parse(saved.stdout)).toMatchObject({ schemaVersion: 1, kind: "saved", yaml: changed });
		expect(await readFile(config, "utf8")).toBe(changed);

		const stale = run(
			["project", "update", "--stdin", "--json"],
			project,
			JSON.stringify({ yaml: valid, expectedConfigDigest: initial.configDigest }),
		);
		expect(stale.status).toBe(1);
		expect(JSON.parse(stale.stdout)).toMatchObject({ kind: "error", code: "STALE_CONFIG" });
		expect(await readFile(config, "utf8")).toBe(changed);
	});
	it("does not execute registered checks while reading, updating, or reporting readiness", async () => {
		const bin = join(root, "bin");
		const marker = join(root, "check-ran");
		const executable = join(bin, "weavra-check-marker");
		await mkdir(bin);
		await writeFile(executable, `#!/bin/sh\nprintf called > '${marker}'\n`);
		await chmod(executable, 0o700);
		const configured = valid
			.replace("executable: node", "executable: weavra-check-marker")
			.replace("args: ['--version']", "args: []");
		await writeFile(source, configured);
		expect(run(["project", "init", "--config", source]).status).toBe(0);
		const initial = JSON.parse(run(["project", "read", "--json"]).stdout);
		const updated = configured.replace("max_worker_invocations: 3", "max_worker_invocations: 4");
		const result = run(
			["project", "update", "--stdin", "--json"],
			project,
			JSON.stringify({ yaml: updated, expectedConfigDigest: initial.configDigest }),
			{ PATH: `${dirname(process.execPath)}:${bin}:${process.env.PATH}` },
		);
		expect(result.status, result.stderr).toBe(0);
		await absent(marker);
	});
	it("rejects oversized and non-strict update JSON without changing config", async () => {
		expect(run(["project", "init", "--config", source]).status).toBe(0);
		const original = await readFile(config, "utf8");
		const oversized = run(["project", "update", "--stdin", "--json"], project, " ".repeat(65_537));
		expect(oversized.status).toBe(1);
		expect(JSON.parse(oversized.stdout)).toMatchObject({ kind: "error" });
		const extra = run(
			["project", "update", "--stdin", "--json"],
			project,
			JSON.stringify({ yaml: valid, expectedConfigDigest: `sha256:${"0".repeat(64)}`, cwd: root }),
		);
		expect(extra.status).toBe(1);
		expect(JSON.parse(extra.stdout)).toMatchObject({ kind: "error" });
		expect(await readFile(config, "utf8")).toBe(original);
	});
	it("explicitly initializes only Weavra directories and imports no Pi auth", async () => {
		const home = join(root, "unused-home");
		const piAgent = join(home, ".pi/agent");
		await mkdir(piAgent, { recursive: true });
		for (const name of ["auth.json", "models.json", "settings.json"])
			await writeFile(join(piAgent, name), `{"secret":"${secret}"}`);

		const result = run(["project", "initialize", "--json"]);
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout)).toEqual({ schemaVersion: 1, kind: "initialized" });
		expect((await lstat(join(home, ".weavra/agent"))).isDirectory()).toBe(true);
		for (const name of ["auth.json", "models.json", "settings.json"]) {
			await absent(join(home, ".weavra/agent", name));
			expect(await readFile(join(piAgent, name), "utf8")).toContain(secret);
		}
	});
	it("doctor distinguishes non-Git cwd and dirty workspace from project configuration", async () => {
		expect(run(["project", "doctor", "--json"], root).status).toBe(1);
		const noGit = JSON.parse(run(["project", "doctor", "--json"], root).stdout);
		expect(noGit.diagnostics).toContainEqual(expect.objectContaining({ code: "GIT_PROJECT_ROOT_REQUIRED" }));
		await writeFile(join(project, "untracked.txt"), "keep");
		const dirty = JSON.parse(run(["project", "doctor", "--json"]).stdout);
		expect(dirty.diagnostics).toContainEqual(expect.objectContaining({ code: "WORKSPACE_DIRTY" }));
		expect(await readFile(join(project, "untracked.txt"), "utf8")).toBe("keep");
	});
	it("doctor reports a clean configured project without executing registered commands", async () => {
		expect(run(["project", "init", "--config", source]).status).toBe(0);
		git("add", ".ai/config.yaml");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
		const before = await readFile(config, "utf8");
		const result = run(["project", "doctor", "--json"]);
		expect(result.status, result.stderr).toBe(0);
		const report = JSON.parse(result.stdout);
		expect(report.ready).toBe(true);
		expect(report.configuration).toMatchObject({
			requiredChecks: 1,
			sandboxMode: "disabled",
			maxWorkerInvocations: 3,
		});
		expect(await readFile(config, "utf8")).toBe(before);
		expect(await readdir(join(project, ".ai"))).toEqual(["config.yaml"]);
	});
	it("doctor blocks a missing required executable and a writer without altering either", async () => {
		await mkdir(join(project, ".ai"));
		await writeFile(config, valid.replace("executable: node", "executable: unavailable-weavra-check"));
		await writeFile(join(project, ".ai/writer.lock"), "active");
		const result = run(["project", "doctor", "--json"]);
		expect(result.status).toBe(1);
		const codes = JSON.parse(result.stdout).diagnostics.map((diagnostic: { code: string }) => diagnostic.code);
		expect(codes).toContain("CHECK_EXECUTABLE_UNAVAILABLE");
		expect(codes).toContain("WRITER_LOCK_PRESENT");
		expect(await readdir(join(project, ".ai"))).toEqual(["config.yaml", "writer.lock"]);
	});
	it.each([false, true])("doctor checks evidence capacity with monorepo opt-in %s", async (monorepo) => {
		const reviewed = valid + (monorepo ? "workspace:\n  evidence:\n    mode: bounded-monorepo\n" : "");
		await writeFile(source, reviewed);
		expect(run(["project", "init", "--config", source]).status).toBe(0);
		await writeFile(join(project, "vendor.bin"), Buffer.alloc(2 * 1024 * 1024 + 1));
		if (monorepo) await symlink(join(root, "missing-target"), join(project, "vendor-link"));
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");

		const result = run(["project", "doctor", "--json"]);
		const report = JSON.parse(result.stdout);
		expect(result.status).toBe(monorepo ? 0 : 1);
		expect(report.ready).toBe(monorepo);
		if (!monorepo)
			expect(report.diagnostics).toContainEqual(
				expect.objectContaining({ code: "WORKSPACE_EVIDENCE_CAPACITY", severity: "ERROR" }),
			);
		expect(await readFile(config, "utf8")).toBe(reviewed);
		expect(await readdir(join(project, ".ai"))).toEqual(["config.yaml"]);
		await absent(join(root, "unused-home"));
	});
	it("doctor reports unsupported tracked evidence without following a link", async () => {
		expect(run(["project", "init", "--config", source]).status).toBe(0);
		await symlink(join(root, "missing-target"), join(project, "vendor-link"));
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");

		const result = run(["project", "doctor", "--json"]);
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
			expect.objectContaining({ code: "WORKSPACE_EVIDENCE_UNSUPPORTED", severity: "ERROR" }),
		);
		expect(await readdir(join(project, ".ai"))).toEqual(["config.yaml"]);
		await absent(join(root, "missing-target"));
		await absent(join(root, "unused-home"));
	});
	it("doctor rejects invalid configuration and missing required registrations", async () => {
		await mkdir(join(project, ".ai"));
		await writeFile(config, "invalid: true");
		const invalid = run(["project", "doctor", "--json"]);
		expect(JSON.parse(invalid.stdout).diagnostics).toContainEqual(
			expect.objectContaining({ code: "CONFIG_INVALID" }),
		);
		await writeFile(config, valid.replace(/verification:[\s\S]*?budget:/, "verification: { checks: [] }\nbudget:"));
		const missing = run(["project", "doctor", "--json"]);
		expect(JSON.parse(missing.stdout).diagnostics).toContainEqual(
			expect.objectContaining({ code: "REQUIRED_CHECK_MISSING" }),
		);
	});
	it("doctor reports a missing check directory without executing a check", async () => {
		await mkdir(join(project, ".ai"));
		await writeFile(config, valid.replace("required: true", "cwd: nonexistent\n      required: true"));
		const result = run(["project", "doctor", "--json"]);
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
			expect.objectContaining({ code: "CHECK_WORKDIR_UNAVAILABLE" }),
		);
	});
	describe("check execution policy verdicts", () => {
		const commit = () => {
			git("add", ".");
			git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
		};
		const configure = async (executable: string, args: string) => {
			await writeFile(
				source,
				valid
					.replace("executable: node", `executable: ${executable}`)
					.replace("args: ['--version']", `args: ${args}`),
			);
			expect(run(["project", "init", "--config", source]).status).toBe(0);
		};

		it("denies a shell-wrapped project script and suggests the script itself without running it", async () => {
			const marker = join(root, "script-ran");
			await mkdir(join(project, "tools"));
			await writeFile(join(project, "tools/t.sh"), `printf called > '${marker}'\n`);
			await configure("bash", "['tools/t.sh']");
			commit();

			const result = run(["project", "doctor", "--app-json"]);
			expect(result.status).toBe(1);
			const report = JSON.parse(result.stdout);
			expect(report.ready).toBe(false);
			expect(report.checkPolicies).toEqual([
				{
					id: "test",
					policy: "denied",
					reason: "SHELL_COMMAND",
					suggestion: { executable: "tools/t.sh", args: [], note: expect.any(String) },
				},
			]);
			expect(report.diagnostics).toContainEqual(
				expect.objectContaining({ code: "CHECK_POLICY_DENIED:test", severity: "ERROR" }),
			);
			const read = JSON.parse(run(["project", "read", "--json"]).stdout);
			expect(read.checkPolicies).toEqual(report.checkPolicies);
			await absent(marker);
		});

		it("allows a direct package-manager check and keeps doctor ready", async () => {
			const bin = join(root, "bin");
			const marker = join(root, "pnpm-ran");
			await mkdir(bin);
			await writeFile(join(bin, "pnpm"), `#!/bin/sh\nprintf called > '${marker}'\n`);
			await chmod(join(bin, "pnpm"), 0o700);
			const env = { PATH: `${dirname(process.execPath)}:${bin}:${process.env.PATH}` };
			await configure("pnpm", "['test']");
			commit();

			const result = run(["project", "doctor", "--app-json"], project, undefined, env);
			expect(result.status, result.stdout).toBe(0);
			const report = JSON.parse(result.stdout);
			expect(report.ready).toBe(true);
			expect(report.checkPolicies).toEqual([{ id: "test", policy: "allowed", reason: expect.any(String) }]);
			await absent(marker);
		});

		it("keeps doctor not ready for a disallowed absolute shell executable", async () => {
			await configure("/bin/bash", "[]");
			commit();

			const result = run(["project", "doctor", "--app-json"]);
			expect(result.status).toBe(1);
			const report = JSON.parse(result.stdout);
			expect(report.ready).toBe(false);
			expect(report.checkPolicies).toEqual([{ id: "test", policy: "denied", reason: "SHELL_COMMAND" }]);
		});

		const toolScript = async (path: string) => {
			const marker = join(root, "tool-ran");
			await writeFile(path, `#!/bin/sh\nprintf called > '${marker}'\n`);
			await chmod(path, 0o755);
			return marker;
		};

		it("allows a registered in-project tools/check.sh and keeps doctor ready without running it", async () => {
			await mkdir(join(project, "tools"));
			const marker = await toolScript(join(project, "tools/check.sh"));
			await configure("tools/check.sh", "[]");
			commit();

			const result = run(["project", "doctor", "--app-json"]);
			expect(result.status, result.stdout).toBe(0);
			const report = JSON.parse(result.stdout);
			expect(report.ready).toBe(true);
			expect(report.checkPolicies).toEqual([{ id: "test", policy: "allowed", reason: expect.any(String) }]);
			await absent(marker);
		});

		const configureInSub = async (executable: string) => {
			await mkdir(join(project, "sub"));
			await writeFile(
				source,
				valid
					.replace("executable: node", `executable: ${executable}`)
					.replace("args: ['--version']", "args: []")
					.replace("required: true", "cwd: sub\n      required: true"),
			);
			expect(run(["project", "init", "--config", source]).status).toBe(0);
		};

		it("resolves a relative script from the check cwd, not the project root", async () => {
			await configureInSub("tools/t.sh");
			await mkdir(join(project, "sub/tools"));
			const marker = await toolScript(join(project, "sub/tools/t.sh"));
			commit();

			const result = run(["project", "doctor", "--app-json"]);
			expect(result.status, result.stdout).toBe(0);
			const report = JSON.parse(result.stdout);
			expect(report.ready).toBe(true);
			expect(report.checkPolicies).toEqual([{ id: "test", policy: "allowed", reason: expect.any(String) }]);
			await absent(join(project, "tools"));
			await absent(marker);
		});

		it("rejects a parent-relative script from the check cwd", async () => {
			await configureInSub("../tools/t.sh");
			await mkdir(join(project, "tools"));
			const marker = await toolScript(join(project, "tools/t.sh"));
			await writeFile(join(project, "sub/.keep"), "");
			commit();

			const result = run(["project", "doctor", "--app-json"]);
			expect(result.status).toBe(1);
			const report = JSON.parse(result.stdout);
			expect(report.diagnostics).toContainEqual(
				expect.objectContaining({ code: "CHECK_EXECUTABLE_UNAVAILABLE", severity: "ERROR" }),
			);
			expect(report.checkPolicies).toEqual([{ id: "test", policy: "denied", reason: "EXECUTABLE_UNAVAILABLE" }]);
			await absent(marker);
		});

		it("rejects a parent-relative script outside the project", async () => {
			const marker = await toolScript(join(root, "x.sh"));
			await configure("../x.sh", "[]");
			commit();

			const result = run(["project", "doctor", "--app-json"]);
			expect(result.status).toBe(1);
			const report = JSON.parse(result.stdout);
			expect(report.ready).toBe(false);
			expect(report.diagnostics).toContainEqual(
				expect.objectContaining({ code: "CHECK_EXECUTABLE_UNAVAILABLE", severity: "ERROR" }),
			);
			expect(report.checkPolicies).toEqual([{ id: "test", policy: "denied", reason: "EXECUTABLE_UNAVAILABLE" }]);
			await absent(marker);
		});

		it("rejects an in-project script symlink that escapes the project", async () => {
			const marker = await toolScript(join(root, "outside.sh"));
			await mkdir(join(project, "tools"));
			await symlink(join(root, "outside.sh"), join(project, "tools/check.sh"));
			await configure("tools/check.sh", "[]");
			commit();

			const result = run(["project", "doctor", "--app-json"]);
			expect(result.status).toBe(1);
			const report = JSON.parse(result.stdout);
			expect(report.ready).toBe(false);
			expect(report.diagnostics).toContainEqual(
				expect.objectContaining({ code: "CHECK_EXECUTABLE_UNAVAILABLE", severity: "ERROR" }),
			);
			expect(report.checkPolicies).toEqual([{ id: "test", policy: "denied", reason: "EXECUTABLE_UNAVAILABLE" }]);
			await absent(marker);
		});

		it("reports a check whose cwd is a project protected path as denied in read and save", async () => {
			// guide is protected only through project.instructions.path, the input a real Run adds; built-in patterns allow it.
			await mkdir(join(project, "guide"));
			await writeFile(join(project, "guide/README.md"), "guide\n");
			await writeFile(
				source,
				`${valid.replace("required: true", "cwd: guide\n      required: true")}project:\n  instructions: { path: guide }\n`,
			);
			expect(run(["project", "init", "--config", source]).status).toBe(0);
			commit();
			const denied = [{ id: "test", policy: "denied", reason: expect.any(String) }];

			const read = JSON.parse(run(["project", "read", "--json"]).stdout);
			expect(read.checkPolicies).toEqual(denied);
			const saved = run(
				["project", "update", "--stdin", "--json"],
				project,
				JSON.stringify({ yaml: read.yaml, expectedConfigDigest: read.configDigest }),
			);
			expect(saved.status, saved.stdout + saved.stderr).toBe(0);
			const report = JSON.parse(saved.stdout);
			expect(report.kind).toBe("saved");
			expect(report.readiness.checkPolicies).toEqual(denied);
			expect(JSON.parse(run(["project", "read", "--json"]).stdout).checkPolicies).toEqual(denied);
		});
	});
	describe("trial check", () => {
		const configureScript = async (body: string) => {
			await mkdir(join(project, "tools"));
			await writeFile(join(project, "tools/check.sh"), `#!/bin/sh\n${body}\n`);
			await chmod(join(project, "tools/check.sh"), 0o755);
			await writeFile(
				source,
				valid.replace("executable: node", "executable: tools/check.sh").replace("args: ['--version']", "args: []"),
			);
			expect(run(["project", "init", "--config", source]).status).toBe(0);
		};
		const trial = (checkId = "test", extra: Record<string, unknown> = { consent: true }) =>
			run(["project", "trial-check", "--stdin", "--json"], project, JSON.stringify({ checkId, ...extra }));

		it("runs the saved check once and reports its exit code without writing evidence", async () => {
			await configureScript("printf 'trial output'\nexit 3");
			const before = await readdir(join(project, ".ai"));

			const result = trial();
			expect(result.status, result.stdout).toBe(0);
			expect(JSON.parse(result.stdout)).toEqual({
				schemaVersion: 1,
				kind: "trial-check",
				checkId: "test",
				exitCode: 3,
				durationMs: expect.any(Number),
				outputBytes: 12,
				truncated: false,
				timedOut: false,
				stdoutTail: "trial output",
			});
			expect(await readdir(join(project, ".ai"))).toEqual(before);
		});

		it("marks 20 KiB of output truncated and returns at most a 2 KiB tail", async () => {
			await configureScript("head -c 20480 /dev/zero | tr '\\0' a");

			const result = trial();
			expect(result.status, result.stdout).toBe(0);
			const report = JSON.parse(result.stdout);
			expect(report).toMatchObject({ kind: "trial-check", truncated: true, timedOut: false });
			expect(report.outputBytes).toBeGreaterThanOrEqual(16384);
			expect(Buffer.byteLength(report.stdoutTail)).toBeLessThanOrEqual(2048);
		});

		it("refuses a check denied by execution policy without running it", async () => {
			const marker = join(root, "denied-ran");
			await mkdir(join(project, "tools"));
			await writeFile(join(project, "tools/t.sh"), `printf called > '${marker}'\n`);
			await writeFile(
				source,
				valid
					.replace("executable: node", "executable: bash")
					.replace("args: ['--version']", "args: ['tools/t.sh']"),
			);
			expect(run(["project", "init", "--config", source]).status).toBe(0);

			const result = trial();
			expect(result.status).toBe(1);
			expect(JSON.parse(result.stdout)).toMatchObject({ kind: "error", code: "CHECK_POLICY_DENIED" });
			await absent(marker);
		});

		it("rejects an unknown check ID and non-strict input", async () => {
			await configureScript("exit 0");
			expect(JSON.parse(trial("missing").stdout)).toMatchObject({ kind: "error", code: "CHECK_NOT_FOUND" });
			const extra = run(
				["project", "trial-check", "--stdin", "--json"],
				project,
				JSON.stringify({ checkId: "test", consent: true, force: true }),
			);
			expect(extra.status).toBe(1);
			expect(JSON.parse(extra.stdout)).toMatchObject({ kind: "error" });
		});

		it.each([
			["missing", {}],
			["false", { consent: false }],
			["non-boolean", { consent: "true" }],
		])("refuses %s consent without running the check", async (_label, extra) => {
			const marker = join(root, "consent-ran");
			await configureScript(`printf called > '${marker}'`);

			const result = trial("test", extra);
			expect(result.status).toBe(1);
			expect(JSON.parse(result.stdout)).toMatchObject({ kind: "error", code: "TRIAL_CHECK_CONSENT_REQUIRED" });
			await absent(marker);
		});

		it("refuses while a Run holds the writer lock without running the check", async () => {
			const marker = join(root, "writer-ran");
			await configureScript(`printf called > '${marker}'`);
			await writeFile(join(project, ".ai/writer.lock"), "active");

			const result = trial();
			expect(result.status).toBe(1);
			expect(JSON.parse(result.stdout)).toMatchObject({ kind: "error", code: "TRIAL_CHECK_WRITER_ACTIVE" });
			await absent(marker);

			await rm(join(project, ".ai/writer.lock"));
			expect(trial().status).toBe(0);
			expect(await readFile(marker, "utf8")).toBe("called");
		});
	});

	describe("draft check candidates", () => {
		const draft = (env: NodeJS.ProcessEnv = {}) => {
			const result = run(["project", "draft", "--json"], project, undefined, env);
			expect(result.status, result.stdout + result.stderr).toBe(0);
			const report = JSON.parse(result.stdout);
			return { report, checks: parse(report.yaml).verification.checks };
		};
		const godotTool = async (mode: number) => {
			const marker = join(root, "tool-ran");
			await writeFile(join(project, "project.godot"), "[application]\n");
			await mkdir(join(project, "tools"));
			await writeFile(join(project, "tools/check.sh"), `#!/bin/sh\nprintf called > '${marker}'\n`);
			await chmod(join(project, "tools/check.sh"), mode);
			return marker;
		};

		it("drafts pnpm test as required and lint as optional from the lockfile without running them", async () => {
			const bin = join(root, "bin");
			const marker = join(root, "pnpm-ran");
			await mkdir(bin);
			await writeFile(join(bin, "pnpm"), `#!/bin/sh\nprintf called > '${marker}'\n`);
			await chmod(join(bin, "pnpm"), 0o700);
			await writeFile(
				join(project, "package.json"),
				JSON.stringify({ scripts: { test: "vitest run", lint: "eslint ." } }),
			);
			await writeFile(join(project, "pnpm-lock.yaml"), "");

			const { report, checks } = draft({ PATH: `${dirname(process.execPath)}:${bin}:${process.env.PATH}` });
			expect(checks).toEqual([
				{ id: "node-test", kind: "test", executable: "pnpm", args: ["run", "test"], required: true },
				{ id: "node-lint", kind: "lint", executable: "pnpm", args: ["run", "lint"], required: false },
			]);
			expect(report.notes).toEqual([]);
			await absent(marker);
		});

		it("drafts an executable Godot tool script with a shebang as a direct check", async () => {
			const marker = await godotTool(0o755);

			const { report, checks } = draft();
			expect(checks).toEqual([
				{ id: "godot-check", kind: "custom", executable: "tools/check.sh", args: [], required: false },
			]);
			expect(report.notes).toEqual([]);
			await absent(marker);
		});

		it("leaves a non-executable Godot tool script out with a NOT_EXECUTABLE note", async () => {
			const marker = await godotTool(0o644);

			const { report, checks } = draft();
			expect(checks).toEqual([]);
			expect(report.notes).toEqual(["NOT_EXECUTABLE:tools/check.sh", "NO_CHECK_CANDIDATES"]);
			await absent(marker);
		});

		it("drafts no checks for an empty project and notes NO_CHECK_CANDIDATES", async () => {
			const { report, checks } = draft();
			expect(checks).toEqual([]);
			expect(report.notes).toEqual(["NO_CHECK_CANDIDATES"]);
		});

		it("moves a candidate the execution policy denies into notes with its reason", async () => {
			const bin = join(root, "bin");
			await mkdir(bin);
			await symlink(process.execPath, join(bin, "node"));
			await writeFile(join(project, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));
			await writeFile(join(project, "yarn.lock"), "");

			const { report, checks } = draft({ PATH: `${bin}:/usr/bin:/bin` });
			expect(checks).toEqual([]);
			expect(report.notes).toEqual(["EXECUTABLE_UNAVAILABLE:node-test", "NO_CHECK_CANDIDATES"]);
		});

		it("never recommends an anthropic provider in the draft or its model availability", async () => {
			await writeFile(join(project, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }));

			const { report } = draft();
			const profiles = parse(report.yaml).models.profiles;
			expect(Object.values(profiles)).toEqual([
				{ provider: "", model: "" },
				{ provider: "", model: "" },
			]);
			expect(report.modelAvailability.providers.map((entry: { provider: string }) => entry.provider)).not.toContain(
				"anthropic",
			);
			expect(JSON.stringify(report)).not.toMatch(/anthropic|claude/i);
		});
	});

	it("exposes no anthropic login path through the weavra launcher", async () => {
		const sources = [
			launcher,
			...(await readdir(fileURLToPath(new URL("../src", import.meta.url))))
				.filter((name) => /^launcher-.*\.ts$/.test(name))
				.map((name) => fileURLToPath(new URL(`../src/${name}`, import.meta.url))),
		];
		expect(sources.length).toBeGreaterThan(1);
		for (const path of sources) expect(await readFile(path, "utf8"), path).not.toMatch(/anthropic|claude/i);
		// Only these Pi subcommands bypass the Extension; Pi `auth` has no login subcommand.
		expect(await readFile(launcher, "utf8")).toContain(
			'install|remove|uninstall|update|list|config|auth) exec "$PI" "$@" ;;',
		);
		const login = run(["project", "login", "anthropic"]);
		expect(login.status).toBe(1);
		expect(login.stderr).toContain("Usage: weavra project");
	});
	it("doctor rejects an active Run without a writer lock and leaves state unchanged", async () => {
		expect(run(["project", "init", "--config", source]).status).toBe(0);
		await writeFile(join(project, ".gitignore"), ".ai/\n");
		git("add", ".gitignore");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");
		expect(JSON.parse(run(["project", "doctor", "--json"]).stdout).ready).toBe(true);
		const store = await FileStateStore.open(project);
		try {
			await CompanyKernel.create(
				{
					executionMode: "EDIT",
					runId: "orphan-run",
					task: testContract("Fix parser", { taskId: "task-1", statements: ["Parser works"] }),
					classification: {
						intent: "bugfix",
						complexity: "STANDARD",
						risk: "R1",
						confidence: null,
						reason: "Fixture",
					},
				},
				{
					store,
					agents: {
						execute: async () => {
							throw new Error("No worker may run");
						},
					},
					verifier: {
						verify: async () => {
							throw new Error("No check may run");
						},
					},
				},
			);
		} finally {
			await store.close();
		}
		await absent(join(project, ".ai/writer.lock"));
		const before = await readFile(join(project, ".ai/state.json"), "utf8");
		const result = run(["project", "doctor", "--json"]);
		expect(result.status).toBe(1);
		expect(JSON.parse(result.stdout).diagnostics).toContainEqual(
			expect.objectContaining({ code: "ACTIVE_RUN_PRESENT", severity: "ERROR" }),
		);
		expect(await readFile(join(project, ".ai/state.json"), "utf8")).toBe(before);
		await absent(join(project, ".ai/writer.lock"));
	});
});
