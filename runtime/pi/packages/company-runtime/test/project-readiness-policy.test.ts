import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { evaluateCheckPolicies, projectReadiness } from "../src/project-readiness.ts";

const config = (executable: string, args: readonly string[], cwd?: string) => `schemaVersion: 1
models:
  profiles:
    coding: { provider: faux, model: coding }
    reasoning: { provider: faux, model: reasoning }
files:
  allowed_paths: [src]
verification:
  sandbox: { mode: disabled }
  checks:
    - id: test
      kind: test
      executable: ${JSON.stringify(executable)}
      args: ${JSON.stringify(args)}
      required: true
${cwd ? `      cwd: ${JSON.stringify(cwd)}\n` : ""}`;

let root: string;
let project: string;
let marker: string;

function git(...args: string[]) {
	const result = spawnSync("git", ["-C", project, ...args], { encoding: "utf8" });
	expect(result.status, result.stderr).toBe(0);
}

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "weavra readiness policy "));
	project = join(root, "project");
	marker = join(root, "check-was-invoked");
	await mkdir(join(project, ".ai"), { recursive: true });
	await mkdir(join(project, "src"));
	await writeFile(join(project, "src/main.ts"), "export {};\n");
	git("init", "-q");
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("project readiness registered check policy", () => {
	it("rejects an existing shell executable without invoking it", async () => {
		const yaml = config("/bin/sh", ["-c", `touch ${marker}`]);
		await writeFile(join(project, ".ai/config.yaml"), yaml);
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");

		const result = await projectReadiness(project);

		expect(result.ready).toBe(false);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "CHECK_COMMAND_SHELL_COMMAND",
				severity: "ERROR",
			}),
		);
		expect(await readFile(join(project, ".ai/config.yaml"), "utf8")).toBe(yaml);
		await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("rejects inline execution flags on an existing direct executable", async () => {
		const yaml = config(process.execPath, ["-e", `require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`]);
		await writeFile(join(project, ".ai/config.yaml"), yaml);
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");

		const result = await projectReadiness(project);

		expect(result.ready).toBe(false);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({
				code: "CHECK_COMMAND_INLINE_COMMAND",
				severity: "ERROR",
			}),
		);
		await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("keeps a safe direct executable ready without invoking it", async () => {
		const yaml = config("/usr/bin/true", []);
		await writeFile(join(project, ".ai/config.yaml"), yaml);
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");

		const result = await projectReadiness(project);

		expect(result.ready).toBe(true);
		expect(result.diagnostics.some((item) => item.code.startsWith("CHECK_COMMAND_"))).toBe(false);
		expect(result.workspaceAssessment).toEqual({
			schemaVersion: 1,
			kind: "supported",
			profile: { mode: "default", candidate: false },
			fileCount: 2,
			totalBytes: Buffer.byteLength(yaml) + Buffer.byteLength("export {};\n"),
		});
		expect(await readFile(join(project, ".ai/config.yaml"), "utf8")).toBe(yaml);
		await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
	});

	it("reports a required check whose cwd is protected as denied, matching run-time policy", async () => {
		const yaml = config("/usr/bin/true", [], ".ai");
		await writeFile(join(project, ".ai/config.yaml"), yaml);
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");

		const result = await projectReadiness(project);

		expect(result.ready).toBe(false);
		expect(result.checkPolicies).toEqual([expect.objectContaining({ id: "test", policy: "denied" })]);
		expect(result.diagnostics).toContainEqual(
			expect.objectContaining({ code: "CHECK_POLICY_DENIED:test", severity: "ERROR" }),
		);
	});

	it("keeps a check in an ordinary project directory allowed and ready", async () => {
		const yaml = config("/usr/bin/true", [], "src");
		await writeFile(join(project, ".ai/config.yaml"), yaml);
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");

		const result = await projectReadiness(project);

		expect(result.ready).toBe(true);
		expect(result.checkPolicies).toEqual([expect.objectContaining({ id: "test", policy: "allowed" })]);
	});

	it("denies a check whose cwd is a supplied project protected path", async () => {
		const check = { id: "test", executable: "/usr/bin/true", args: [], cwd: "src" };

		expect(await evaluateCheckPolicies(project, [check])).toEqual([expect.objectContaining({ policy: "allowed" })]);
		expect(await evaluateCheckPolicies(project, [check], ["src"])).toEqual([
			expect.objectContaining({ policy: "denied" }),
		]);
	});

	it("returns the bounded unsupported diagnostic for oversized editable evidence", async () => {
		await writeFile(join(project, "src/opaque.bin"), Buffer.alloc(2 * 1024 * 1024 + 1));
		const yaml = config("/usr/bin/true", []);
		await writeFile(join(project, ".ai/config.yaml"), yaml);
		git("add", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture");

		const result = await projectReadiness(project);

		expect(result.ready).toBe(false);
		expect(result.workspaceAssessment).toMatchObject({
			schemaVersion: 1,
			kind: "unsupported",
			diagnostic: {
				code: "WORKSPACE_EVIDENCE_CAPACITY",
			},
		});
		expect(await readFile(join(project, ".ai/config.yaml"), "utf8")).toBe(yaml);
		await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
	});
});
