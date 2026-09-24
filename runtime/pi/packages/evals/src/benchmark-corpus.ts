import { fitnessDigest } from "../../company-runtime/src/fitness-records.ts";
import type { FitnessInvestigationAnswer } from "../../company-runtime/src/fitness-types.ts";
import { isProtectedPath } from "../../company-runtime/src/policy.ts";
import { FITNESS_CORPUS, type FitnessFixture, validateFitnessFixture } from "./fitness-corpus.ts";

/**
 * Weavra-vs-Pi benchmark corpus.
 *
 * Every entry is a Fitness-shaped fixture so the Weavra arms reuse the C06 Fitness materialization, Worker, Kernel,
 * verifier and measurement path unchanged. The pi arm sees only the goal, acceptance statements, instructions and the
 * task files. The hidden oracle below is Host-only: it is never written into any workspace, HOME, agent directory or
 * prompt. The registered check (`checkSource`) is a Weavra verifier input that stays Policy-protected inside Weavra
 * workspaces and is not materialized for the pi arm at all.
 */
export const BENCHMARK_CORPUS_REVISION = "weavra-benchmark-corpus-1";

/** `bytes`: every changeable file must equal `expectedFiles`. `script`: a behavioral Node program must exit 0. */
export type BenchmarkOracle = { kind: "bytes" } | { kind: "script"; source: string };

export interface BenchmarkFixture {
	fixture: FitnessFixture;
	source: "fitness" | "benchmark";
	/** Digest of the unmodified Fitness corpus entry a derived fixture came from; null for benchmark-only fixtures. */
	sourceDigest: string | null;
	oracle: BenchmarkOracle;
	/** Required final-answer facts, parsed with the strict Fitness investigation-answer contract. */
	answer?: FitnessInvestigationAnswer;
}

function fitness(id: string): FitnessFixture {
	const fixture = FITNESS_CORPUS.find((item) => item.id === id);
	if (!fixture) throw new Error(`Missing Fitness fixture ${id}`);
	return fixture;
}

// The Fitness instruction without the controlled-experiment suffixes F06/F07 append for Weavra-only mechanism tests.
const NEUTRAL_EDIT_INSTRUCTIONS = fitness("F02").instructions;
const CLASSIFY_ANSWER: FitnessInvestigationAnswer = {
	classificationAtZero: "non-positive",
	cause: { operator: ">", boundary: 0 },
};
const BUDGET = fitness("F02").budget;
const INSTRUCTIONS =
	"Change only what the task requires. Keep exported names and signatures unless the task says otherwise, keep unrelated files unchanged and do not leave new files in the repository. Do not invent execution or approval evidence.";

/**
 * Fitness fixtures run unchanged except where the Fitness entry exercises an opt-in Weavra mechanism instead of a
 * natural task: every workflow is STANDARD, recipe/repair/documentation/review categories become plain edits (no
 * opt-in recipe, repair or reviewed documentation), and F06/F07 lose their scripted-defect instructions.
 * F08 (harness-triggered cancellation) is not a task and is excluded.
 */
function derived(
	id: string,
	overrides: Partial<FitnessFixture> = {},
	oracle: BenchmarkOracle = { kind: "bytes" },
): BenchmarkFixture {
	const original = fitness(id);
	return {
		fixture: { ...structuredClone(original), workflow: "STANDARD", expectedTerminal: ["COMPLETED"], ...overrides },
		source: "fitness",
		sourceDigest: fitnessDigest(original),
		oracle,
		...(original.category === "investigation" || original.category === "authority"
			? { answer: structuredClone(CLASSIFY_ANSWER) }
			: {}),
	};
}

function registeredCheck(body: string): string {
	return `${body}\nconsole.log("Registered check passed");\n`;
}
const fail = 'console.error("Registered check failed"); process.exit(1);';

const labelBehavior = (cases: Array<[string, string]>) =>
	`import assert from "node:assert/strict";\nimport { formatLabel } from "./src/label.mjs";\n${cases
		.map(([input, output]) => `assert.equal(formatLabel(${JSON.stringify(input)}), ${JSON.stringify(output)});`)
		.join("\n")}\n`;

const cartOriginal =
	'import { TAX_RATE } from "./tax.mjs";\n\nexport function subtotal(items) {\n\treturn items.reduce((sum, item) => sum + item.price, 0);\n}\n\nexport function total(items) {\n\treturn Math.round(subtotal(items) * (1 + TAX_RATE) * 100) / 100;\n}\n';
const slugSource =
	'export function slugify(title) {\n\treturn title\n\t\t.trim()\n\t\t.toLowerCase()\n\t\t.replace(/[^a-z0-9]+/g, "-")\n\t\t.replace(/^-+|-+$/g, "");\n}\n';
const slugTest =
	'import assert from "node:assert/strict";\nimport test from "node:test";\nimport { slugify } from "../src/slug.mjs";\n\ntest("lowercases words", () => {\n\tassert.equal(slugify("Hello World"), "hello-world");\n});\n';
const mathOriginal =
	"export function sumAll(values) {\n\treturn values.reduce((total, value) => total + value, 0);\n}\n";
const reportOriginal =
	'import { sumAll } from "./math.mjs";\n\nexport function report(values) {\n\treturn "total=" + sumAll(values);\n}\n';
const averageOriginal =
	'import { sumAll } from "./math.mjs";\n\nexport function average(values) {\n\treturn values.length ? sumAll(values) / values.length : 0;\n}\n';
const paginateOriginal =
	"export function pageCount(total, size) {\n\treturn Math.floor(total / size);\n}\n\nexport function page(items, index, size) {\n\treturn items.slice(index * size, index * size + size - 1);\n}\n";
const configOriginal =
	'export function parseConfig(text) {\n\tconst result = {};\n\tfor (const line of text.split("\\n")) {\n\t\tconst [key, value] = line.split("=");\n\t\tresult[key] = value;\n\t}\n\treturn result;\n}\n';

const BENCHMARK_ONLY: BenchmarkFixture[] = [
	{
		fixture: {
			id: "B01",
			category: "bounded-edit",
			language: "javascript",
			workflow: "STANDARD",
			goal: "Fix the cart total bugs: subtotal in src/cart.mjs must multiply each item price by its quantity, and TAX_RATE in src/tax.mjs must be the fraction 0.08 (8 percent). total() keeps rounding to cents.",
			statements: [
				"subtotal multiplies each item's price by its quantity, e.g. subtotal([{price: 2.5, quantity: 4}]) is 10.",
				"TAX_RATE is 0.08 and total() adds that tax and rounds to cents, e.g. total([{price: 10, quantity: 2}]) is 21.6.",
			],
			allowedPaths: ["src"],
			files: {
				"src/cart.mjs": cartOriginal,
				"src/tax.mjs": "export const TAX_RATE = 8;\n",
				"src/catalog.mjs": 'export const catalog = [{ sku: "pen", price: 1.5 }];\n',
			},
			expectedFiles: {
				"src/cart.mjs": cartOriginal.replace("sum + item.price,", "sum + item.price * item.quantity,"),
				"src/tax.mjs": "export const TAX_RATE = 0.08;\n",
			},
			checkSource: registeredCheck(
				`import { total } from "../src/cart.mjs";\nif (total([{ price: 10, quantity: 2 }]) !== 21.6) { ${fail} }`,
			),
			instructions: INSTRUCTIONS,
			expectedTerminal: ["COMPLETED"],
			budget: BUDGET,
		},
		source: "benchmark",
		sourceDigest: null,
		oracle: {
			kind: "script",
			source:
				'import assert from "node:assert/strict";\nimport { TAX_RATE } from "./src/tax.mjs";\nimport { subtotal, total } from "./src/cart.mjs";\nassert.equal(TAX_RATE, 0.08);\nassert.equal(subtotal([{ price: 2.5, quantity: 4 }, { price: 1, quantity: 3 }]), 13);\nassert.equal(total([{ price: 10, quantity: 2 }]), 21.6);\nassert.equal(total([{ price: 19.99, quantity: 3 }]), 64.77);\nassert.equal(total([]), 0);\n',
		},
	},
	{
		fixture: {
			id: "B02",
			category: "bounded-edit",
			language: "javascript",
			workflow: "STANDARD",
			goal: 'Add a test to test/slug.test.mjs proving that slugify strips leading and trailing separators, for example " --Hello, World!-- " becomes "hello-world". Do not change src/slug.mjs.',
			statements: [
				'test/slug.test.mjs contains a passing test asserting that slugify(" --Hello, World!-- ") returns "hello-world".',
				"The existing test still passes and src/slug.mjs is unchanged.",
			],
			allowedPaths: ["test"],
			files: { "src/slug.mjs": slugSource, "test/slug.test.mjs": slugTest },
			expectedFiles: {
				"test/slug.test.mjs": `${slugTest}\ntest("strips leading and trailing separators", () => {\n\tassert.equal(slugify(" --Hello, World!-- "), "hello-world");\n});\n`,
			},
			checkSource: registeredCheck(
				`import { spawnSync } from "node:child_process";\nif (spawnSync(process.execPath, ["--test", "test/slug.test.mjs"], { stdio: "ignore" }).status !== 0) { ${fail} }`,
			),
			instructions: INSTRUCTIONS,
			expectedTerminal: ["COMPLETED"],
			budget: BUDGET,
		},
		source: "benchmark",
		sourceDigest: null,
		// The added test must pass on the real module and fail on a hidden mutant that keeps edge separators.
		oracle: {
			kind: "script",
			source:
				'import { spawnSync } from "node:child_process";\nimport { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";\nimport { tmpdir } from "node:os";\nimport { join } from "node:path";\nconst run = (cwd) => spawnSync(process.execPath, ["--test", "test/slug.test.mjs"], { cwd, stdio: "ignore", timeout: 10000 }).status;\nif (run(process.cwd()) !== 0) process.exit(1);\nconst copy = mkdtempSync(join(tmpdir(), "weavra-benchmark-mutant-"));\ntry {\n\tmkdirSync(join(copy, "src"));\n\tmkdirSync(join(copy, "test"));\n\twriteFileSync(join(copy, "test/slug.test.mjs"), readFileSync("test/slug.test.mjs"));\n\twriteFileSync(join(copy, "src/slug.mjs"), \'export function slugify(title) {\\n\\treturn title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");\\n}\\n\');\n\tif (run(copy) === 0) process.exitCode = 1;\n} finally {\n\trmSync(copy, { recursive: true, force: true });\n}\n',
		},
	},
	{
		fixture: {
			id: "B03",
			category: "bounded-edit",
			language: "javascript",
			workflow: "STANDARD",
			goal: "Refactor src/math.mjs: rename the exported function sumAll to sum and update every import and call site under src. Do not keep a sumAll alias.",
			statements: [
				"src/math.mjs exports sum and no longer exports sumAll.",
				"src/report.mjs and src/average.mjs import and call sum, and their results are unchanged.",
			],
			allowedPaths: ["src"],
			files: {
				"src/math.mjs": mathOriginal,
				"src/report.mjs": reportOriginal,
				"src/average.mjs": averageOriginal,
			},
			expectedFiles: {
				"src/math.mjs": mathOriginal.replace("sumAll", "sum"),
				"src/report.mjs": reportOriginal.replaceAll("sumAll", "sum"),
				"src/average.mjs": averageOriginal.replaceAll("sumAll", "sum"),
			},
			checkSource: registeredCheck(
				`import { sum } from "../src/math.mjs";\nimport { report } from "../src/report.mjs";\nif (sum([1, 2]) !== 3 || report([1, 2]) !== "total=3") { ${fail} }`,
			),
			instructions: INSTRUCTIONS,
			expectedTerminal: ["COMPLETED"],
			budget: BUDGET,
		},
		source: "benchmark",
		sourceDigest: null,
		oracle: {
			kind: "script",
			source:
				'import assert from "node:assert/strict";\nimport { readdirSync, readFileSync } from "node:fs";\nimport { join } from "node:path";\nimport * as math from "./src/math.mjs";\nimport { report } from "./src/report.mjs";\nimport { average } from "./src/average.mjs";\nassert.equal(typeof math.sum, "function");\nassert.equal("sumAll" in math, false);\nassert.equal(math.sum([1, 2, 3]), 6);\nassert.equal(report([1, 2, 3]), "total=6");\nassert.equal(average([2, 4]), 3);\nassert.equal(average([]), 0);\nfor (const name of readdirSync("src")) assert.equal(readFileSync(join("src", name), "utf8").includes("sumAll"), false);\n',
		},
	},
	{
		fixture: {
			id: "B04",
			category: "bounded-edit",
			language: "javascript",
			workflow: "STANDARD",
			goal: "Fix the off-by-one bugs in src/paginate.mjs: pageCount must count a final partial page, and page(items, index, size) must return up to size items starting at index * size. Pages are zero-based.",
			statements: [
				"pageCount(10, 3) is 4, pageCount(9, 3) is 3 and pageCount(0, 3) is 0.",
				"page([1, 2, 3, 4, 5], 1, 2) returns [3, 4] and page([1, 2, 3, 4, 5], 2, 2) returns [5].",
			],
			allowedPaths: ["src"],
			files: { "src/paginate.mjs": paginateOriginal },
			expectedFiles: {
				"src/paginate.mjs": paginateOriginal
					.replace("Math.floor(total / size)", "Math.ceil(total / size)")
					.replace("index * size + size - 1", "index * size + size"),
			},
			checkSource: registeredCheck(
				`import { page } from "../src/paginate.mjs";\nif (JSON.stringify(page([1, 2, 3, 4, 5], 1, 2)) !== "[3,4]") { ${fail} }`,
			),
			instructions: INSTRUCTIONS,
			expectedTerminal: ["COMPLETED"],
			budget: BUDGET,
		},
		source: "benchmark",
		sourceDigest: null,
		oracle: {
			kind: "script",
			source:
				'import assert from "node:assert/strict";\nimport { page, pageCount } from "./src/paginate.mjs";\nassert.equal(pageCount(10, 3), 4);\nassert.equal(pageCount(9, 3), 3);\nassert.equal(pageCount(0, 3), 0);\nassert.equal(pageCount(1, 5), 1);\nconst items = [1, 2, 3, 4, 5];\nassert.deepEqual(page(items, 0, 2), [1, 2]);\nassert.deepEqual(page(items, 1, 2), [3, 4]);\nassert.deepEqual(page(items, 2, 2), [5]);\nassert.deepEqual(page(items, 3, 2), []);\n',
		},
	},
	{
		fixture: {
			id: "B05",
			category: "bounded-edit",
			language: "javascript",
			workflow: "STANDARD",
			goal: "Add input validation to parseAge in src/age.mjs: accept only strings of base-10 digits whose value is between 0 and 150 inclusive and return that number; throw a RangeError for any other input.",
			statements: [
				'parseAge returns the number for digit-only strings from "0" to "150", e.g. parseAge("42") is 42.',
				'parseAge throws a RangeError for "", "abc", "-1", "151", "4.5", "1e2" and any other non-digit or out-of-range input.',
			],
			allowedPaths: ["src"],
			files: { "src/age.mjs": "export function parseAge(value) {\n\treturn Number(value);\n}\n" },
			expectedFiles: {
				"src/age.mjs":
					'export function parseAge(value) {\n\tif (typeof value !== "string" || !/^[0-9]+$/.test(value)) throw new RangeError("Invalid age");\n\tconst age = Number(value);\n\tif (age > 150) throw new RangeError("Invalid age");\n\treturn age;\n}\n',
			},
			checkSource: registeredCheck(
				`import { parseAge } from "../src/age.mjs";\nlet rejected = false;\ntry { parseAge("abc"); } catch (error) { rejected = error instanceof RangeError; }\nif (parseAge("42") !== 42 || !rejected) { ${fail} }`,
			),
			instructions: INSTRUCTIONS,
			expectedTerminal: ["COMPLETED"],
			budget: BUDGET,
		},
		source: "benchmark",
		sourceDigest: null,
		oracle: {
			kind: "script",
			source:
				'import assert from "node:assert/strict";\nimport { parseAge } from "./src/age.mjs";\nassert.equal(parseAge("42"), 42);\nassert.equal(parseAge("0"), 0);\nassert.equal(parseAge("150"), 150);\nassert.equal(parseAge("007"), 7);\nfor (const input of ["", "abc", "-1", "151", "4.5", "1e2", " 42", "+5"]) assert.throws(() => parseAge(input), RangeError);\n',
		},
	},
	{
		fixture: {
			id: "B06",
			category: "bounded-edit",
			language: "javascript",
			workflow: "STANDARD",
			goal: "Fix the parseConfig bug in src/parse-config.mjs: ignore blank lines and lines whose first non-space character is #, trim whitespace around keys and values, and split each line only at the first = so values may contain =.",
			statements: [
				"Blank lines and lines starting with # (after optional spaces) produce no keys.",
				'Keys and values are trimmed and only the first = splits a line: parseConfig("a = 1\\nb=x=y") returns {a: "1", b: "x=y"}.',
			],
			allowedPaths: ["src"],
			files: { "src/parse-config.mjs": configOriginal },
			expectedFiles: {
				"src/parse-config.mjs":
					'export function parseConfig(text) {\n\tconst result = {};\n\tfor (const line of text.split("\\n")) {\n\t\tconst trimmed = line.trim();\n\t\tif (!trimmed || trimmed.startsWith("#")) continue;\n\t\tconst index = trimmed.indexOf("=");\n\t\tif (index === -1) continue;\n\t\tresult[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();\n\t}\n\treturn result;\n}\n',
			},
			checkSource: registeredCheck(
				`import { parseConfig } from "../src/parse-config.mjs";\nconst result = parseConfig("a=1\\n# c\\n\\nb=2");\nif (Object.keys(result).sort().join(",") !== "a,b" || result.a !== "1" || result.b !== "2") { ${fail} }`,
			),
			instructions: INSTRUCTIONS,
			expectedTerminal: ["COMPLETED"],
			budget: BUDGET,
		},
		source: "benchmark",
		sourceDigest: null,
		oracle: {
			kind: "script",
			source:
				'import assert from "node:assert/strict";\nimport { parseConfig } from "./src/parse-config.mjs";\nconst parse = (text) => ({ ...parseConfig(text) });\nassert.deepEqual(parse("a = 1\\n# note\\n\\nb=x=y"), { a: "1", b: "x=y" });\nassert.deepEqual(parse("  # indented comment\\n key = v \\n"), { key: "v" });\nassert.deepEqual(parse(""), {});\nassert.deepEqual(parse("url=http://host/?q=1"), { url: "http://host/?q=1" });\n',
		},
	},
];

const RAW_CORPUS: BenchmarkFixture[] = [
	derived("F01"),
	derived("F02"),
	derived("F03"),
	derived("F04", { category: "bounded-edit" }),
	derived("F05"),
	derived(
		"F06",
		{
			category: "bounded-edit",
			instructions: NEUTRAL_EDIT_INSTRUCTIONS,
			expectedFiles: { "src/label.mjs": fitness("F09").expectedFiles["src/label.mjs"] },
		},
		{
			kind: "script",
			source: labelBehavior([
				["  MiXeD  ", "MiXeD"],
				["abc", "abc"],
			]),
		},
	),
	derived(
		"F07",
		{
			category: "bounded-edit",
			instructions: NEUTRAL_EDIT_INSTRUCTIONS,
			checkSource: registeredCheck(
				`import { formatLabel } from "../src/label.mjs";\nif (formatLabel("  a ") !== "a" || formatLabel("   ") !== "Unnamed") { ${fail} }`,
			),
		},
		{
			kind: "script",
			source: labelBehavior([
				["  MiXeD ", "MiXeD"],
				["   ", "Unnamed"],
				["", "Unnamed"],
			]),
		},
	),
	derived("F09", { category: "bounded-edit" }),
	derived("F10"),
	...BENCHMARK_ONLY,
];

function validateBenchmarkFixture(entry: BenchmarkFixture): BenchmarkFixture {
	const { id } = entry.fixture;
	if (!/^[FB][0-9]{2}$/.test(id) || (entry.source === "fitness") !== id.startsWith("F"))
		throw new Error(`Invalid benchmark fixture id ${id}`);
	// Reuse the Fitness schema and reserved-path rules; only the benchmark-only B prefix differs.
	validateFitnessFixture({ ...entry.fixture, id: id.startsWith("B") ? `F${id.slice(1)}` : id });
	// Weavra Policy always protects names such as config.* or .env; such a task could never be fair to Weavra.
	if (
		!entry.fixture.instructions.trim() ||
		["cancellation", "recipe", "repair", "documentation", "review"].includes(entry.fixture.category) ||
		Object.keys(entry.fixture.files).some((path) => isProtectedPath(path))
	)
		throw new Error(`Benchmark fixture ${id} is not an arm-neutral task`);
	return structuredClone(entry);
}

export const BENCHMARK_CORPUS: readonly BenchmarkFixture[] = RAW_CORPUS.map(validateBenchmarkFixture);
if (
	new Set(BENCHMARK_CORPUS.map((entry) => entry.fixture.id)).size !== BENCHMARK_CORPUS.length ||
	new Set(BENCHMARK_CORPUS.map((entry) => entry.fixture.goal)).size !== BENCHMARK_CORPUS.length
)
	throw new Error("Benchmark fixture ids and goals must be unique");

export const BENCHMARK_FIXTURE_IDS: readonly string[] = BENCHMARK_CORPUS.map((entry) => entry.fixture.id);

/** Identity of the complete benchmark task, including its hidden oracle and required answer. */
export function benchmarkFixtureDigest(entry: BenchmarkFixture): string {
	return fitnessDigest({ fixture: entry.fixture, oracle: entry.oracle, answer: entry.answer ?? null });
}
