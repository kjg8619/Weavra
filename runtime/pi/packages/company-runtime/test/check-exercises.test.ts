import { chmod, link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RegisteredBrowserCheck } from "../src/browser-types.ts";
import {
	checkExerciseSources,
	EXERCISE_SOURCE_MAX_BYTES,
	type PlanningCheck,
	planningChecks,
	relativeModuleSpecifiers,
} from "../src/check-exercises.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import { buildPlanningContext, PLANNER_CONTEXT_MAX_BYTES } from "../src/planner.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import { resolveVerifierTrustSources } from "../src/verifier-trust.ts";
import { COMPLEX_GOAL, CONFIG, STATEMENTS } from "./planner-fixture.ts";

// Planner amendment A1, check exercise targets (#65, docs/architecture/PLANNER_DRAFT.md §4.1).

/** The #54 corpus fixture test, byte for byte. */
const PARSE_TEST =
	'import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { parse } from "../src/parse.mjs";\nassert.deepEqual(parse(" a, b ,c "), ["a", "b", "c"]);\ntest("parse", () => {});\n';

describe("§4.1 step 2: relative module specifiers", () => {
	it("matches every import, export, dynamic import and require form, in source order", () => {
		const source = [
			"#!/usr/bin/env node",
			'import a from "./a.mjs";',
			"import { b, c as d } from '../b.mjs';",
			'import * as ns from "./c.mjs"',
			'import e, {\n\tf,\n\tg as h,\n} from "./e.mjs";',
			'import type { T } from "./t.ts";',
			'import "./side.mjs";',
			"import './side-single.mjs'",
			'export * from "./star.mjs";',
			'export * as named from "./star-named.mjs";',
			'export { g } from "./g.mjs";',
			'export type { U } from "./u.ts";',
			'const dynamic = await import("./dynamic.mjs");',
			"const data = await import('./data.json', { with: { type: 'json' } });",
			'const required = require("./required.cjs");',
			"const parent = require('../parent');",
			'import from from "./from-default.mjs";',
			'import { from } from "./from-named.mjs";',
			'import json from "./attributes.json" with { type: "json" };',
			// biome-ignore lint/suspicious/noTemplateCurlyInString: scanned source text, not a JS placeholder
			"const inTemplate = `${require('./in-substitution.mjs')}`;",
		].join("\n");
		expect(relativeModuleSpecifiers(source)).toEqual([
			"./a.mjs",
			"../b.mjs",
			"./c.mjs",
			"./e.mjs",
			"./t.ts",
			"./side.mjs",
			"./side-single.mjs",
			"./star.mjs",
			"./star-named.mjs",
			"./g.mjs",
			"./u.ts",
			"./dynamic.mjs",
			"./data.json",
			"./required.cjs",
			"../parent",
			"./from-default.mjs",
			"./from-named.mjs",
			"./attributes.json",
			"./in-substitution.mjs",
		]);
		expect(relativeModuleSpecifiers(PARSE_TEST)).toEqual(["../src/parse.mjs"]);
	});

	it("rejects bare, absolute and URL specifiers, template strings and computed or escaped literals", () => {
		const rejected = [
			// Bare.
			'import { test } from "node:test";',
			'import _ from "lodash";',
			'const pkg = require("lodash");',
			'await import("@scope/pkg");',
			'import "#internal";',
			'import "bare-module.mjs";',
			'require(".");',
			'require("..");',
			// Absolute and URL.
			'import "/abs/x.mjs";',
			'import "file:///x.mjs";',
			'await import("https://example.com/x.mjs");',
			// Template strings.
			"await import(`./template.mjs`);",
			"require(`./template`);",
			// biome-ignore lint/suspicious/noTemplateCurlyInString: scanned source text, not a JS placeholder
			"await import(`./${name}.mjs`);",
			// Computed and escaped.
			'require("./computed" + suffix);',
			"require(path);",
			'require("./\\x61.mjs");',
		];
		for (const source of rejected) expect(relativeModuleSpecifiers(source), source).toEqual([]);
	});

	it("never matches inside comments, strings, templates or regular expressions, nor member calls", () => {
		const source = [
			'// import "./line-comment.mjs"',
			'/* require("./block-comment.mjs") */',
			"const quoted = 'import x from \"./in-string.mjs\"';",
			'const template = `import("./in-template.mjs")`;',
			'const pattern = /["\'](\\.\\/in-regex)["\']/; import "./after-regex.mjs";',
			'const ratio = total / count; import "./after-division.mjs";',
			'loader.import("./member.mjs");',
			'module.require("./module-member.mjs");',
			'import.meta.resolve("./meta.mjs");',
			'require.resolve("./resolve.mjs");',
			'vi.mock("../src/mocked.mjs");',
			'export const from = "./not-a-module.mjs";',
			"export { a, b };",
		].join("\n");
		expect(relativeModuleSpecifiers(source)).toEqual(["./after-regex.mjs", "./after-division.mjs"]);
	});
});

describe("§4.1 exercises in the Planning Context", () => {
	let root: string;
	let cwd: string;
	beforeEach(async () => {
		root = await realpath(await mkdtemp(join(tmpdir(), "wv-exercises-")));
		cwd = join(root, "project");
		await mkdir(join(cwd, ".ai"), { recursive: true });
		await mkdir(join(cwd, "src"), { recursive: true });
		await mkdir(join(cwd, "test"), { recursive: true });
	});
	afterEach(async () => {
		await rm(root, { recursive: true, force: true });
	});
	const write = async (entries: Record<string, string | Buffer>) => {
		for (const [path, content] of Object.entries(entries)) {
			await mkdir(dirname(join(cwd, path)), { recursive: true });
			await writeFile(join(cwd, path), content);
		}
	};
	/** A registered `node --test <files>` check. */
	const nodeTest = (id: string, ...files: string[]) => ({
		id,
		kind: "test",
		executable: process.execPath,
		args: ["--test", ...files],
	});
	const imports = (...specifiers: string[]) =>
		`${specifiers.map((specifier) => `import "${specifier}";`).join("\n")}\ntest("x", () => {});\n`;
	const configWith = (checks: unknown[], extra: Record<string, unknown> = {}) =>
		parseRuntimeConfig(JSON.stringify({ ...CONFIG, verification: { checks }, ...extra }));
	const context = async (checks: unknown[], extra?: Record<string, unknown>) => {
		const built = await buildPlanningContext({
			cwd,
			goal: COMPLEX_GOAL,
			acceptanceStatements: STATEMENTS,
			config: configWith(checks, extra),
			executionMode: "EDIT",
			risk: "R1",
			signal: new AbortController().signal,
		});
		const value = JSON.parse(built.prompt);
		return { prompt: built.prompt, bytes: built.bytes, checks: value.checks as PlanningCheck[], value };
	};
	const exercises = async (checks: unknown[], extra?: Record<string, unknown>) =>
		Object.fromEntries((await context(checks, extra)).checks.map((check) => [check.id, check.exercises]));

	it("names src/parse.mjs for node --test test/parse.test.mjs, whether or not the module exists (#65)", async () => {
		await write({ "test/parse.test.mjs": PARSE_TEST });
		const check = nodeTest("test-parse", "test/parse.test.mjs");
		const missing = await context([check]);
		expect(missing.checks).toEqual([
			{ id: "test-parse", kind: "test", required: true, exercises: ["src/parse.mjs"] },
		]);
		expect(missing.value.fileListing).toEqual({ files: [], truncated: false });
		// An existing module is the same target (a "modify" claim instead of "create").
		await write({ "src/parse.mjs": "export function parse() {}\n" });
		const existing = await context([check]);
		expect(existing.checks).toEqual(missing.checks);
		expect(existing.value.fileListing).toEqual({ files: ["src/parse.mjs"], truncated: false });
	});

	it("keeps only targets inside the allowed paths that the listing Policy allows", async () => {
		await write({
			"src/AGENTS.md": "Keep modules small.\n",
			"test/scope.test.mjs": imports(
				"../src/kept.mjs",
				"../lib/outside.mjs",
				"../src/secrets/token.mjs",
				"../src/.ai/state.mjs",
				"../src/.env.mjs",
				"../src/key.pem",
				"../src/config.mjs",
				"../src/AGENTS.md",
				"../src/node_modules/pkg/index.mjs",
				"./helper.mjs",
				"../../elsewhere.mjs",
				"../test/../src/normalized.mjs",
			),
		});
		const checks = [nodeTest("scope", "test/scope.test.mjs")];
		const instructions = { project: { instructions: { path: "src/AGENTS.md" } } };
		expect(await exercises(checks, instructions)).toEqual({ scope: ["src/kept.mjs", "src/normalized.mjs"] });
		// The allowed paths decide: a configured lib/ root admits its target.
		expect(await exercises(checks, { ...instructions, files: { allowed_paths: ["src", "lib"] } })).toEqual({
			scope: ["lib/outside.mjs", "src/kept.mjs", "src/normalized.mjs"],
		});
	});

	it("never names a verifier source, such as a test helper another verifier source imports", async () => {
		await write({
			"src/parse.test.mjs":
				'import "node:test";\nimport "bare-module.mjs";\nimport "./parse.mjs";\nimport "./test-helper.mjs";\n',
			"src/test-helper.mjs": 'export { util } from "./util.mjs";\n',
			"test/format.test.mjs": 'import "../src/format.mjs";\nimport "../src/parse.test.mjs";\n',
		});
		const checks = [
			{ ...nodeTest("colocated", "src/parse.test.mjs"), trust: { files: ["src/test-helper.mjs"] } },
			nodeTest("format", "test/format.test.mjs"),
		];
		// The declared helper is scanned as a source, and neither it nor the other check's test is ever a target.
		const expected = { colocated: ["src/parse.mjs", "src/util.mjs"], format: ["src/format.mjs"] };
		expect(await exercises(checks)).toEqual(expected);
		// Even a Policy context that did not protect the verifier sources never names them.
		const inspector = await FilePolicyPathInspector.open(cwd);
		const direct = await planningChecks({
			projectPath: inspector.projectPath,
			checks: configWith(checks).verification.checks,
			policy: { allowedPaths: ["src"], protectedPaths: [] },
			inspector,
			signal: new AbortController().signal,
		});
		expect(Object.fromEntries(direct.map((check) => [check.id, check.exercises]))).toEqual(expected);
	});

	it("resolves an extensionless specifier to exactly one module file or index file", async () => {
		await write({
			"src/one.ts": "",
			"src/two.ts": "",
			"src/two.js": "",
			"src/lib/index.ts": "",
			"src/both.mjs": "",
			"src/both/index.js": "",
			"src/data": "an extensionless file is never a candidate\n",
			"src/data.ts": "",
			"src/indexes/index.ts": "",
			"src/indexes/index.mjs": "",
			"test/resolve.test.mjs": imports(
				"../src/one",
				// Exact spelling on every filesystem: a case alias of src/one.ts is no match.
				"../src/ONE",
				"../src/none",
				"../src/two",
				"../src/lib",
				"../src/both",
				"../src/data",
				"../src/indexes",
			),
		});
		expect(await exercises([nodeTest("resolve", "test/resolve.test.mjs")])).toEqual({
			resolve: ["src/data.ts", "src/lib/index.ts", "src/one.ts"],
		});
	});

	it("drops URL syntax, directories, symlinks and multiply linked targets", async () => {
		await write({
			"src/real.mjs": "",
			"src/dir.mjs/keep": "",
			"src/hard.mjs": "",
			"outside/inner.mjs": "",
			"test/unsafe.test.mjs": imports(
				"../src/real.mjs",
				"../src/raw.mjs?raw",
				"../src/fragment.mjs#x",
				"../src/space%20name.mjs",
				"../src/dir.mjs",
				"../src/alias.mjs",
				"../src/hard.mjs",
				"../src/linked/inner.mjs",
				"../src/linked/inner",
				"./",
			),
		});
		await symlink(join(cwd, "src/real.mjs"), join(cwd, "src/alias.mjs"));
		await link(join(cwd, "src/hard.mjs"), join(cwd, "src/hard-twin.mjs"));
		await symlink(join(cwd, "outside"), join(cwd, "src/linked"));
		expect(await exercises([nodeTest("unsafe", "test/unsafe.test.mjs")])).toEqual({ unsafe: ["src/real.mjs"] });
	});

	it("cuts at 16 per check and 64 per context and marks only a cut list exercisesTruncated", async () => {
		const modules = (prefix: string, count: number) =>
			Array.from({ length: count }, (_, index) => `../src/${prefix}-${String(index).padStart(2, "0")}.mjs`);
		await write({
			"test/seventeen.test.mjs": imports(...modules("s", 17).reverse()),
			"test/empty.test.mjs": 'import { test } from "node:test";\n',
			...Object.fromEntries(
				[1, 2, 3, 4, 5].map((index) => [`test/c${index}.test.mjs`, imports(...modules(`c${index}`, 16))]),
			),
		});
		const one = await context([nodeTest("seventeen", "test/seventeen.test.mjs")]);
		expect(one.checks).toEqual([
			{
				id: "seventeen",
				kind: "test",
				required: true,
				// Sorted before the cut: the first 16 in default order, never the first 16 imported.
				exercises: modules("s", 16).map((path) => path.slice(3)),
				exercisesTruncated: true,
			},
		]);
		const many = await context([
			...[1, 2, 3, 4, 5].map((index) => nodeTest(`c${index}`, `test/c${index}.test.mjs`)),
			nodeTest("empty", "test/empty.test.mjs"),
		]);
		expect(many.checks.map((check) => [check.id, check.exercises.length, check.exercisesTruncated])).toEqual([
			["c1", 16, undefined],
			["c2", 16, undefined],
			["c3", 16, undefined],
			["c4", 16, undefined],
			["c5", 0, true],
			["empty", 0, undefined],
		]);
		// Exactly 16 is not a cut: the key is absent, not false.
		expect(many.checks.filter((check) => "exercisesTruncated" in check).map((check) => check.id)).toEqual(["c5"]);
		expect(many.checks[0].exercises).toEqual(modules("c1", 16).map((path) => path.slice(3)));
		expect(many.bytes).toBeLessThanOrEqual(PLANNER_CONTEXT_MAX_BYTES);
	});

	it("skips a source it cannot read safely; its check gets fewer exercises and planning continues", async () => {
		const padded = (specifier: string, bytes: number) => {
			const head = `import "${specifier}";\n`;
			return `${head}${"/".repeat(bytes - head.length - 1)}\n`;
		};
		await write({
			"test/good.test.mjs": imports("../src/from-good.mjs"),
			"test/exact.test.mjs": padded("../src/from-exact.mjs", EXERCISE_SOURCE_MAX_BYTES),
			"test/oversized.test.mjs": padded("../src/from-oversized.mjs", EXERCISE_SOURCE_MAX_BYTES + 1),
			"test/binary.test.mjs": Buffer.concat([Buffer.from(imports("../src/from-binary.mjs")), Buffer.from([0])]),
			"test/hard.test.mjs": imports("../src/from-hard-link.mjs"),
			"test/real/linked.test.mjs": imports("../../src/from-symlinked-directory.mjs"),
			"test/locked.test.mjs": imports("../src/from-locked.mjs"),
			"test/config.test.mjs": imports("../src/from-protected-name.mjs"),
		});
		await link(join(cwd, "test/hard.test.mjs"), join(cwd, "test/hard-twin.mjs"));
		await symlink(join(cwd, "test/real"), join(cwd, "test/alias"));
		await chmod(join(cwd, "test/locked.test.mjs"), 0o000);
		const sources = [
			"test/good.test.mjs",
			"test/exact.test.mjs",
			"test/oversized.test.mjs",
			"test/binary.test.mjs",
			"test/hard.test.mjs",
			"test/alias/linked.test.mjs",
			"test/locked.test.mjs",
			"test/config.test.mjs",
		];
		try {
			const check = nodeTest("mixed", ...sources);
			// Each source is a direct verifier source the Policy protects, readable or not.
			expect(checkExerciseSources(cwd, configWith([check]).verification.checks[0])).toEqual([...sources].sort());
			const { checks } = await context([check, nodeTest("other", "test/good.test.mjs")]);
			// Root may read a mode-000 file; every other reason holds for any user.
			const locked = process.getuid?.() === 0 ? ["src/from-locked.mjs"] : [];
			expect(checks).toEqual([
				{
					id: "mixed",
					kind: "test",
					required: true,
					exercises: ["src/from-exact.mjs", "src/from-good.mjs", ...locked],
				},
				{ id: "other", kind: "test", required: true, exercises: ["src/from-good.mjs"] },
			]);
		} finally {
			await chmod(join(cwd, "test/locked.test.mjs"), 0o600);
		}
	});

	it("never carries a verifier path, command, argument or file content, and is deterministic", async () => {
		const oracle = (module: string, marker: string) =>
			`import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { run } from "${module}";\n// ${marker}\ntest("oracle", () => assert.equal(run(), "${marker}"));\n`;
		await write({
			"test/zeta.test.mjs": oracle("../src/zeta.mjs", "ORACLE_EXPECTED_ZETA"),
			"test/alpha.test.mjs": `${oracle("../src/alpha.mjs", "ORACLE_EXPECTED_ALPHA")}import "../src/zeta.mjs";\n`,
			"test/helpers/shared.mjs": 'export const shared = "HELPER_CONTENT_MARKER";\n',
		});
		const checks = [
			{
				...nodeTest("unit", "test/zeta.test.mjs", "test/alpha.test.mjs"),
				trust: { files: ["test/helpers/shared.mjs"] },
			},
		];
		const first = await context(checks);
		expect(first.checks).toEqual([
			{ id: "unit", kind: "test", required: true, exercises: ["src/alpha.mjs", "src/zeta.mjs"] },
		]);
		expect(first.prompt).not.toMatch(
			/test\/|\.test\.mjs|helpers|ORACLE_EXPECTED|HELPER_CONTENT|assert|node:test|--test|trust/,
		);
		expect(first.prompt).not.toContain(process.execPath);
		// Byte-identical for the same files and configuration, whatever the argument order.
		expect((await context(checks)).prompt).toBe(first.prompt);
		const reordered = [{ ...checks[0], args: ["--test", "test/alpha.test.mjs", "test/zeta.test.mjs"] }];
		expect((await context(reordered)).prompt).toBe(first.prompt);
	});

	it("scans the direct sources and declared trust files, never the Host's browser implementation files", async () => {
		await write({ "test/declared.json": "{}\n", "test/unit.test.mjs": imports("../src/unit.mjs") });
		const [command] = configWith([
			{ ...nodeTest("unit", "test/unit.test.mjs"), trust: { files: ["test/declared.json"] } },
		]).verification.checks;
		expect(checkExerciseSources(cwd, command)).toEqual(resolveVerifierTrustSources(cwd, command));
		expect(checkExerciseSources(cwd, command)).toEqual(["test/declared.json", "test/unit.test.mjs"]);
		// A project that contains the Runtime source: its browser check trusts the Host's implementation files.
		const runtimeRoot = fileURLToPath(new URL("..", import.meta.url));
		const browser = {
			id: "page",
			kind: "browser",
			required: true,
			executable: process.execPath,
			args: [],
			cwd: ".",
			timeout_ms: 15_000,
			trust: { files: [] },
			browser: {} as RegisteredBrowserCheck,
		};
		expect(resolveVerifierTrustSources(runtimeRoot, browser)).toEqual(
			expect.arrayContaining(["src/browser-driver.ts", "src/verification.ts", "src/verifier-trust.ts"]),
		);
		expect(checkExerciseSources(runtimeRoot, browser)).toEqual([]);
	});
});
