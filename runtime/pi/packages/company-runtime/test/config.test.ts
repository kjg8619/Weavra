import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRuntimeConfig, parseRuntimeConfig } from "../src/config.ts";

const minimal = {
	schemaVersion: 1,
	models: {
		profiles: { coding: { provider: "faux", model: "coding" }, reasoning: { provider: "faux", model: "review" } },
	},
};
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("runtime config", () => {
	it("keeps complete shipped and README YAML examples aligned with the actual schema", async () => {
		const example = parseRuntimeConfig(await readFile(new URL("../examples/config.yaml", import.meta.url), "utf8"));
		for (const path of ["../../../README.md", "../README.md"]) {
			const document = await readFile(new URL(path, import.meta.url), "utf8");
			// Optional LSP snippets are validated separately in lsp-config.test.ts; full examples stay identical.
			const blocks = [...document.matchAll(/```yaml\n([\s\S]*?)\n```/g)].filter((block) =>
				/^schemaVersion:/m.test(block[1]),
			);
			expect(blocks.length).toBeGreaterThan(0);
			for (const block of blocks) expect(parseRuntimeConfig(block[1])).toEqual(example);
		}
		expect(example.models.profiles.coding.provider).toBe("your-provider");
		expect(example.verification.checks[0].required).toBe(true);
		expect(example.agents.worker_timeout_ms).toBe(180_000);
	});
	it("uses conservative defaults without hardcoded provider models", () => {
		const config = parseRuntimeConfig(JSON.stringify(minimal));
		expect(config.models).toEqual(minimal.models);
		expect(config.runtime.workflow).toBe("adaptive");
		expect(config.agents).toEqual({
			max_parallel: 1,
			max_revision_cycles: 1,
			worker_timeout_ms: 180_000,
			context_pack: { mode: "disabled" },
		});
		expect(config.review.enabled).toBe(true);
		expect(config.risk.approval_required).toEqual(["R3"]);
		expect(config.files.allowed_paths).toEqual([]);
		expect(config.verification.checks).toEqual([]);
	});

	it("parses YAML and applies check defaults without executing or interpolating data", () => {
		const config = parseRuntimeConfig(`schemaVersion: 1
models:
  profiles:
    coding: { provider: faux, model: coding }
    reasoning: { provider: faux, model: review }
runtime: { workflow: STANDARD }
agents: { max_revision_cycles: 0, worker_timeout_ms: 120000 }
files: { allowed_paths: [src, test] }
verification:
  checks:
    - id: regression
      kind: test
      executable: node
      args: ['--test', '$TOKEN', '$(touch marker)']
`);
		expect(config.runtime.workflow).toBe("STANDARD");
		expect(config.agents.max_revision_cycles).toBe(0);
		expect(config.agents.worker_timeout_ms).toBe(120_000);
		expect(config.verification.checks[0]).toMatchObject({
			cwd: ".",
			timeout_ms: 60_000,
			required: true,
			args: ["--test", "$TOKEN", "$(touch marker)"],
		});
	});

	it.each([10_000, 120_000, 180_000, 600_000])("accepts bounded worker timeout %i", (worker_timeout_ms) => {
		const config = parseRuntimeConfig(JSON.stringify({ ...minimal, agents: { worker_timeout_ms } }));
		expect(config.agents.worker_timeout_ms).toBe(worker_timeout_ms);
		expect(config.agents.max_revision_cycles).toBe(1);
	});

	it.each([0, -1, 9_999, 600_001, 10_000.5, "180000", null, true, {}, []])(
		"rejects invalid worker timeout %j",
		(worker_timeout_ms) => {
			expect(() => parseRuntimeConfig(JSON.stringify({ ...minimal, agents: { worker_timeout_ms } }))).toThrow(
				"Invalid runtime config",
			);
		},
	);

	it.each([
		{ review: { enabled: false } },
		{ state: { enabled: false } },
		{ state: { directory: "../elsewhere" } },
		{ risk: { approval_required: [] } },
		{ agents: { max_parallel: 3 } },
		{ agents: { max_revision_cycles: -1 } },
		{ agents: { max_revision_cycles: 4 } },
		{ agents: { max_revision_cycles: 1.5 } },
		{ runtime: { workflow: "UNKNOWN" } },
		{ runtime: { workflow: "standard" } },
		{ schemaVersion: 2 },
		{ models: { profiles: { coding: { provider: "faux", model: "x" } } } },
		{ models: { profiles: { ...minimal.models.profiles, coding: { provider: "faux", model: " " } } } },
		{ credential: "secret-do-not-print" },
		{ files: { allowed_path: ["src"] } },
		{ verification: { checks: [{ id: "x", kind: "test", command: "npm test" }] } },
	])("rejects invalid or policy-weakening configuration: %j", (override) => {
		expect(() => parseRuntimeConfig(JSON.stringify({ ...minimal, ...override }))).toThrow("Invalid runtime config");
	});

	it.each([
		"",
		"null",
		"[]",
		"true",
		"key: [",
		"schemaVersion: 1\nschemaVersion: 1",
		"{}\n---\n{}",
		"key: !unsafe secret",
		"key: &value {}\nother: *value",
		"key: &cycle [*cycle]",
	])("rejects malformed/unsupported YAML: %s", (source) => {
		expect(() => parseRuntimeConfig(source)).toThrow();
	});

	it.each([
		"../secret",
		"/tmp/secret",
		"C:\\secret",
		"C:secret",
		"\\\\host\\secret",
		"src/../../secret",
		"src/*.ts",
		"src\u0000",
	])("rejects non-local paths: %s", (path) => {
		expect(() => parseRuntimeConfig(JSON.stringify({ ...minimal, files: { allowed_paths: [path] } }))).toThrow(
			"workspace-relative",
		);
		expect(() =>
			parseRuntimeConfig(
				JSON.stringify({
					...minimal,
					verification: {
						checks: [
							{
								id: "test",
								kind: "test",
								executable: "node",
								args: [],
								cwd: path,
							},
						],
					},
				}),
			),
		).toThrow("workspace-relative");
	});

	it("rejects duplicate check IDs and unbounded check timeouts", () => {
		const check = { id: "test", kind: "test", executable: "node", args: [] };
		expect(() =>
			parseRuntimeConfig(JSON.stringify({ ...minimal, verification: { checks: [check, check] } })),
		).toThrow("Duplicate");
		for (const timeout_ms of [0, -1, 3_600_001]) {
			expect(() =>
				parseRuntimeConfig(JSON.stringify({ ...minimal, verification: { checks: [{ ...check, timeout_ms }] } })),
			).toThrow();
		}
	});

	it("does not disclose invalid configuration values", () => {
		for (const source of [
			"key: !unsafe secret-do-not-print",
			JSON.stringify({ ...minimal, credential: "secret-do-not-print" }),
		]) {
			expect(() => parseRuntimeConfig(source)).toThrow(/^Invalid runtime (YAML|config):/);
			try {
				parseRuntimeConfig(source);
			} catch (error) {
				expect(String(error)).not.toContain("secret-do-not-print");
			}
		}
		expect(() => parseRuntimeConfig(" ".repeat(65_537))).toThrow("64 KiB");
	});

	it("reports a missing file without creating .ai; reloads existing config read-only", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "company-config-"));
		directories.push(cwd);
		expect(await loadRuntimeConfig(cwd)).toEqual({ status: "missing", path: join(cwd, ".ai/config.yaml") });
		expect(await readdir(cwd)).toEqual([]);
		await mkdir(join(cwd, ".ai"));
		const path = join(cwd, ".ai/config.yaml");
		const source = JSON.stringify(minimal);
		await writeFile(path, source);
		expect((await loadRuntimeConfig(cwd)).status).toBe("configured");
		expect(await readFile(path, "utf8")).toBe(source);
		await writeFile(path, "invalid: true");
		await expect(loadRuntimeConfig(cwd)).rejects.toThrow("Invalid runtime config");
		await rm(path);
		await mkdir(path);
		await expect(loadRuntimeConfig(cwd)).rejects.toThrow("Unable to read");
	});
});
