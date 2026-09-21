import {
	linkSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "../src/config.ts";
import { evaluatePolicy, isDependencyPath, isProtectedPath, type PolicyContext } from "../src/policy.ts";
import { MAX_INSTRUCTION_BYTES, snapshotProjectInstructions } from "../src/project-instructions.ts";

let cwd: string;
beforeEach(() => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-context-")));
	mkdirSync(join(cwd, "src"));
});
afterEach(() => {
	rmSync(cwd, { recursive: true, force: true });
});
const minimal = {
	schemaVersion: 1,
	models: {
		profiles: { coding: { provider: "faux", model: "coding" }, reasoning: { provider: "faux", model: "review" } },
	},
};
const parse = (path: string) => parseRuntimeConfig(JSON.stringify({ ...minimal, project: { instructions: { path } } }));

describe("one Host-selected project instruction snapshot", () => {
	it("validates both README instruction snippets without adding worker file permissions", () => {
		for (const path of ["../../../README.md", "../README.md"]) {
			const document = readFileSync(new URL(path, import.meta.url), "utf8");
			const blocks = [...document.matchAll(/```yaml\n([\s\S]*?)\n```/g)].filter((block) =>
				/^project:/m.test(block[1]),
			);
			expect(blocks).toHaveLength(1);
			const config = parseRuntimeConfig(
				`schemaVersion: 1\nmodels: ${JSON.stringify(minimal.models)}\n${blocks[0][1]}`,
			);
			expect(config.project?.instructions.path).toBe("AGENTS.md");
			expect(config.files.allowed_paths).toEqual([]);
		}
	});
	it("defaults to no selected file and does not require extending worker allowed_paths", () => {
		expect(parseRuntimeConfig(JSON.stringify(minimal))).not.toHaveProperty("project");
		expect(parse("AGENTS.md").project?.instructions.path).toBe("AGENTS.md");
		expect(parse("AGENTS.md").files.allowed_paths).toEqual([]);
	});
	it.each([
		"../outside.md",
		"/outside.md",
		".ai/config.yaml",
		".env",
		"src/credentials.txt",
		"src/*.md",
		"src/../AGENTS.md",
		"src//rules.md",
		"src/./rules.md",
		"C:\\rules.md",
	])("rejects unsafe config path %s", (path) => {
		expect(() => parse(path)).toThrow();
		expect(() => snapshotProjectInstructions(cwd, path)).toThrow();
	});
	it("rejects multiple files, automatic discovery, and unknown instruction settings", () => {
		for (const instructions of [{ paths: ["AGENTS.md"] }, { path: ["AGENTS.md"] }, { path: "AGENTS.md", auto: true }])
			expect(() => parseRuntimeConfig(JSON.stringify({ ...minimal, project: { instructions } }))).toThrow();
	});
	it.each(["AGENTS.md", "src/한글 규칙.md"])("captures deterministic exact UTF-8 bytes for %s", (path) => {
		const text = "\ufeff# 프로젝트 규칙\r\nUse strict checks.\r\n";
		writeFileSync(join(cwd, path), text);
		const a = snapshotProjectInstructions(cwd, path);
		const b = snapshotProjectInstructions(cwd, path);
		expect(a).toEqual(b);
		expect(a.content).toBe(text);
		expect(a.bytes).toBe(Buffer.byteLength(text));
		expect(Object.isFrozen(a)).toBe(true);
		writeFileSync(join(cwd, path), text.replaceAll("\r\n", "\n"));
		expect(snapshotProjectInstructions(cwd, path).digest).not.toBe(a.digest);
		expect(a.content).toBe(text); // Current run retains A; next preflight sees B.
	});
	it.each(["missing", "directory", "file-link", "ancestor-link", "hardlink", "nul", "invalid-utf8", "oversize"])(
		"fails closed for %s",
		(mode) => {
			let path = "AGENTS.md";
			if (mode === "directory") mkdirSync(join(cwd, path));
			else if (mode !== "missing")
				writeFileSync(
					join(cwd, path),
					mode === "nul"
						? "rules\0"
						: mode === "invalid-utf8"
							? Buffer.from([0xff])
							: mode === "oversize"
								? "x".repeat(MAX_INSTRUCTION_BYTES + 1)
								: "rules",
				);
			if (mode === "file-link") {
				symlinkSync(join(cwd, path), join(cwd, "alias.md"));
				path = "alias.md";
			}
			if (mode === "ancestor-link") {
				writeFileSync(join(cwd, "src/rules.md"), "rules");
				symlinkSync(join(cwd, "src"), join(cwd, "alias"));
				path = "alias/rules.md";
			}
			if (mode === "hardlink") linkSync(join(cwd, path), join(cwd, "alias.md"));
			expect(() => snapshotProjectInstructions(cwd, path)).toThrow();
		},
	);
	it("accepts exact 64 KiB but never truncates larger content, including multibyte text", () => {
		writeFileSync(join(cwd, "AGENTS.md"), "x".repeat(MAX_INSTRUCTION_BYTES));
		expect(snapshotProjectInstructions(cwd, "AGENTS.md").bytes).toBe(MAX_INSTRUCTION_BYTES);
		writeFileSync(join(cwd, "AGENTS.md"), "한".repeat(22000));
		expect(() => snapshotProjectInstructions(cwd, "AGENTS.md")).toThrow();
	});
	it("honors additional Host protections and canonical Unicode aliases", () => {
		writeFileSync(join(cwd, "src/rules.md"), "private host rules");
		expect(() => snapshotProjectInstructions(cwd, "src/rules.md", ["src/rules.md"])).toThrow("protected");
		expect(isProtectedPath("src/re\u0301gles.md", ["src/régles.md"])).toBe(true);
		expect(isProtectedPath("src/RULES.md", ["src/rules.md"])).toBe(true);
	});
	it("keeps snapshot helper free of SDK/provider loading and auto-discovery", () => {
		const source = readFileSync(new URL("../src/project-instructions.ts", import.meta.url), "utf8");
		expect(source).not.toMatch(/pi-coding-agent|child_process|readdir|DefaultResourceLoader/);
	});
});

const positives = [
	"pom.xml",
	"module-a/pom.xml",
	"build.gradle",
	"build.gradle.kts",
	"settings.gradle",
	"settings.gradle.kts",
	"gradle.properties",
	"gradle/libs.versions.toml",
	"module-a/gradle/libs.versions.toml",
	"gradle/wrapper/gradle-wrapper.properties",
	".mvn/wrapper/maven-wrapper.properties",
];
const negatives = [
	"pom.xml.bak",
	"build.gradle.txt",
	"my-build.gradle.notes",
	"docs/pom.xml.md",
	"libs.versions.toml",
	"wrapper/gradle-wrapper.properties",
	".mvn/other.properties",
];
describe("JVM dependency/build minimum risk", () => {
	it.each(positives)("treats %s and case variants as minimum R2 only for mutations", (path) => {
		expect(isDependencyPath(path)).toBe(true);
		expect(isDependencyPath(path.toUpperCase())).toBe(true);
		const policy: PolicyContext = {
			executionMode: "EDIT",
			executionRunId: "run",
			configDigest: "config",
			allowedPaths: [path],
			tools: [
				{ id: "edit", operation: "edit" },
				{ id: "read", operation: "read" },
				{ id: "list", operation: "list" },
			],
		};
		const action = {
			runId: "run",
			actionId: "a",
			actionDigest: "input",
			role: "Developer" as const,
			tool: "edit",
			risk: "R1" as const,
			paths: [path],
		};
		const inspected = [{ path, safe: true, kind: "file" as const }];
		expect(evaluatePolicy(action, policy, inspected)).toMatchObject({ risk: "R2", decision: "REVIEW_REQUIRED" });
		expect(evaluatePolicy(action, { ...policy, r2RunId: "run" }, inspected)).toMatchObject({
			risk: "R2",
			decision: "ALLOW",
		});
		expect(
			evaluatePolicy(action, { ...policy, executionMode: "READ_ONLY", r2RunId: "run" }, inspected),
		).toMatchObject({ risk: "R2", decision: "DENY" });
		for (const tool of ["read", "list"])
			expect(
				evaluatePolicy({ ...action, tool, risk: "R0" }, { ...policy, executionMode: "READ_ONLY" }, inspected),
			).toMatchObject({ risk: "R0", decision: "ALLOW" });
	});
	it.each(negatives)("does not broaden dependency classification to %s", (path) =>
		expect(isDependencyPath(path)).toBe(false),
	);
});
