import { spawnSync } from "node:child_process";
import { link, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
      args: ['-e', 'throw new Error("${secret}")']
      required: true
budget: { max_worker_invocations: 3 }
`;
let root: string;
let project: string;
let source: string;
let config: string;
function run(args: string[], cwd = project) {
	const result = spawnSync(launcher, args, {
		cwd,
		env: {
			...process.env,
			PATH: `${dirname(process.execPath)}:${process.env.PATH}`,
			HOME: join(root, "unused-home"),
		},
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
