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
export const BENCHMARK_CORPUS_REVISION = "weavra-benchmark-corpus-2";

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

/** File text from its lines, ending with a newline like every other fixture file. */
const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

/**
 * B07-B10 are discriminative: the registered check covers only the most visible part of the task, so stopping at a
 * passing check leaves a stated acceptance criterion unmet. Catching that gap takes a careful implementation or an
 * independent review of every criterion. A Reviewer REVISE costs Weavra four worker sessions, and two sessions already
 * reported up to about 95k tokens in real-model pilots; the Fitness 100k ceiling would stop the revision before its
 * second review. Both arms get this same per-fixture ceiling.
 */
const REVISION_BUDGET = { ...BUDGET, maxTotalTokens: 300_000 };

// B07: the repository's own test, which is also the registered check, covers one of three stated quoting rules.
const csvOriginal = lines(
	"/** Splits one CSV line into its field values. */",
	"export function parseLine(line) {",
	'\treturn line.split(",");',
	"}",
);
const csvTestOriginal = lines(
	'import assert from "node:assert/strict";',
	'import test from "node:test";',
	'import { parseLine } from "../src/csv.mjs";',
	"",
	'test("splits plain fields", () => {',
	'\tassert.deepEqual(parseLine("a,b,c"), ["a", "b", "c"]);',
	"});",
	"",
	'test("keeps commas inside quoted fields", () => {',
	`\tassert.deepEqual(parseLine('"x,y",z'), ["x,y", "z"]);`,
	"});",
);
const csvFixed = lines(
	"/** Splits one CSV line into its field values. */",
	"export function parseLine(line) {",
	"\tconst fields = [];",
	'\tlet field = "";',
	"\tlet quoted = false;",
	"\tfor (let index = 0; index < line.length; index++) {",
	"\t\tconst char = line[index];",
	"\t\tif (quoted) {",
	`\t\t\tif (char !== '"') field += char;`,
	`\t\t\telse if (line[index + 1] === '"') {`,
	`\t\t\t\tfield += '"';`,
	"\t\t\t\tindex++;",
	"\t\t\t} else quoted = false;",
	`\t\t} else if (char === '"') quoted = true;`,
	'\t\telse if (char === ",") {',
	"\t\t\tfields.push(field);",
	'\t\t\tfield = "";',
	"\t\t} else field += char;",
	"\t}",
	"\tfields.push(field);",
	"\treturn fields;",
	"}",
);

// B08: the second, documentation half of the goal is small, explicit and in another file.
const cliOriginal = lines(
	"/** Parses report-cli arguments; unknown options throw. */",
	"export function parseArgs(argv) {",
	"\tconst options = { verbose: false, output: null };",
	"\tfor (let index = 0; index < argv.length; index++) {",
	"\t\tconst arg = argv[index];",
	'\t\tif (arg === "--verbose") options.verbose = true;',
	'\t\telse if (arg === "--output") options.output = argv[++index] ?? null;',
	'\t\telse throw new Error("Unknown option: " + arg);',
	"\t}",
	"\treturn options;",
	"}",
);
const readmeOptions = [
	"- `--verbose`: print progress messages to stderr. Default: off.",
	"- `--output <file>`: write the report to a file instead of stdout. Default: stdout.",
];
const readmeOriginal = lines(
	"# report-cli",
	"",
	"Prints a summary of the JSON records read from stdin.",
	"",
	"## Usage",
	"",
	"    report-cli [options] < records.json",
	"",
	"## Options",
	"",
	...readmeOptions,
	"",
	"## Exit codes",
	"",
	"- `0`: the report was written.",
	"- `1`: invalid arguments or unreadable input.",
);

// B09: one path already reads the constant; the cookie repeats the lifetime as a literal number of seconds.
const constantsOriginal = lines("export const SESSION_MINUTES = 30;", 'export const COOKIE_NAME = "sid";');
const sessionOriginal = lines(
	'import { SESSION_MINUTES } from "./constants.mjs";',
	"",
	"export function createSession(id, now) {",
	"\treturn { id, expiresAt: now + SESSION_MINUTES * 60 * 1000 };",
	"}",
);
const cookieOriginal = lines(
	'import { COOKIE_NAME } from "./constants.mjs";',
	"",
	"export function sessionCookie(id) {",
	'\treturn [COOKIE_NAME + "=" + id, "Max-Age=1800", "Path=/", "HttpOnly"].join("; ");',
	"}",
);

// B10: the one-line fix is the shared default the goal forbids changing; the real fix threads a count through withRetry.
const defaultsOriginal = lines(
	"/** Shared network defaults; other services import this module too. */",
	"export const DEFAULTS = Object.freeze({ attempts: 3, timeoutMs: 5000 });",
);
const retryOriginal = lines(
	'import { DEFAULTS } from "./defaults.mjs";',
	"",
	"/** Calls task until it resolves, at most DEFAULTS.attempts times, and rethrows the last error. */",
	"export async function withRetry(task) {",
	"\tlet lastError;",
	"\tfor (let attempt = 1; attempt <= DEFAULTS.attempts; attempt++) {",
	"\t\ttry {",
	"\t\t\treturn await task(attempt);",
	"\t\t} catch (error) {",
	"\t\t\tlastError = error;",
	"\t\t}",
	"\t}",
	"\tthrow lastError;",
	"}",
);
const uploadOriginal = lines(
	'import { withRetry } from "./retry.mjs";',
	"",
	"export function upload(send, file) {",
	"\treturn withRetry(() => send(file));",
	"}",
);
const downloadOriginal = lines(
	'import { withRetry } from "./retry.mjs";',
	"",
	"export function download(fetchFile, name) {",
	"\treturn withRetry(() => fetchFile(name));",
	"}",
);

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
	{
		fixture: {
			id: "B07",
			category: "bounded-edit",
			language: "javascript",
			workflow: "STANDARD",
			goal: "Fix the CSV parsing bug in parseLine in src/csv.mjs so it follows the standard quoting rules: a field wrapped in double quotes may contain commas and loses its wrapping quotes, two consecutive double quotes inside a quoted field stand for one literal double quote, and every empty field is kept, including leading, trailing, consecutive and empty quoted fields.",
			statements: [
				`A quoted field keeps its commas and loses its wrapping quotes: parseLine('"x,y",z') returns ["x,y", "z"].`,
				`Inside a quoted field two double quotes stand for one literal double quote: parseLine('"say ""hi""",ok') returns ['say "hi"', "ok"].`,
				`Every empty field is kept: parseLine(",a,,") returns ["", "a", "", ""] and parseLine('"",b') returns ["", "b"].`,
			],
			allowedPaths: ["src", "test"],
			files: { "src/csv.mjs": csvOriginal, "test/csv.test.mjs": csvTestOriginal },
			expectedFiles: {
				"src/csv.mjs": csvFixed,
				"test/csv.test.mjs": `${csvTestOriginal}${lines(
					"",
					'test("turns two double quotes into one literal quote", () => {',
					`\tassert.deepEqual(parseLine('"say ""hi""",ok'), ['say "hi"', "ok"]);`,
					"});",
					"",
					'test("keeps every empty field", () => {',
					`\tassert.deepEqual(parseLine(',a,,""'), ["", "a", "", ""]);`,
					"});",
				)}`,
			},
			// The project's test command: exactly the weak test the agent can see and run.
			checkSource: registeredCheck(
				`import { spawnSync } from "node:child_process";\nif (spawnSync(process.execPath, ["--test", "test/csv.test.mjs"], { stdio: "ignore" }).status !== 0) { ${fail} }`,
			),
			instructions: INSTRUCTIONS,
			expectedTerminal: ["COMPLETED"],
			budget: REVISION_BUDGET,
		},
		source: "benchmark",
		sourceDigest: null,
		oracle: {
			kind: "script",
			source: lines(
				'import assert from "node:assert/strict";',
				'import { parseLine } from "./src/csv.mjs";',
				'assert.deepEqual(parseLine("a,b,c"), ["a", "b", "c"]);',
				'assert.deepEqual(parseLine("plain"), ["plain"]);',
				`assert.deepEqual(parseLine('"x,y",z'), ["x,y", "z"]);`,
				`assert.deepEqual(parseLine('a,"b,c",d'), ["a", "b,c", "d"]);`,
				`assert.deepEqual(parseLine('"say ""hi""",ok'), ['say "hi"', "ok"]);`,
				`assert.deepEqual(parseLine('"a ""b"", c",d'), ['a "b", c', "d"]);`,
				`assert.deepEqual(parseLine('""""'), ['"']);`,
				'assert.deepEqual(parseLine(",a,,"), ["", "a", "", ""]);',
				`assert.deepEqual(parseLine('"",b'), ["", "b"]);`,
				`assert.deepEqual(parseLine('a,""'), ["a", ""]);`,
				'assert.deepEqual(parseLine("a,"), ["a", ""]);',
			),
		},
	},
	{
		fixture: {
			id: "B08",
			category: "bounded-edit",
			language: "javascript",
			workflow: "STANDARD",
			goal: "Add a --limit option to parseArgs in src/cli.mjs and document it. --limit <n> sets options.limit to the number n, which must be a positive whole number; a missing or invalid value throws a RangeError, and options.limit is 20 when the flag is absent. Document --limit in the Options section of README.md like the existing options, including its default.",
			statements: [
				'parseArgs(["--limit", "5"]).limit is 5 and parseArgs([]).limit is 20; --verbose and --output keep working, alone or together with --limit.',
				'parseArgs throws a RangeError when the --limit value is missing or is not a positive whole number, e.g. "0", "-2", "2.5" or "abc".',
				"The Options section of README.md documents --limit <n> like the existing options, including its default of 20.",
			],
			allowedPaths: ["src", "README.md"],
			files: { "src/cli.mjs": cliOriginal, "README.md": readmeOriginal },
			expectedFiles: {
				"src/cli.mjs": cliOriginal
					.replace("output: null };", "output: null, limit: 20 };")
					.replace(
						'\t\telse throw new Error("Unknown option: " + arg);\n',
						lines(
							'\t\telse if (arg === "--limit") {',
							"\t\t\tconst value = argv[++index];",
							"\t\t\tif (value === undefined || !/^[0-9]+$/.test(value) || Number(value) < 1)",
							'\t\t\t\tthrow new RangeError("--limit must be a positive whole number");',
							"\t\t\toptions.limit = Number(value);",
							'\t\t} else throw new Error("Unknown option: " + arg);',
						),
					),
				"README.md": readmeOriginal.replace(
					readmeOptions[1],
					`${readmeOptions[1]}\n- \`--limit <n>\`: include at most n records; n must be a positive whole number. Default: 20.`,
				),
			},
			checkSource: registeredCheck(
				`import { parseArgs } from "../src/cli.mjs";\nif (parseArgs(["--limit", "5"]).limit !== 5) { ${fail} }`,
			),
			instructions: INSTRUCTIONS,
			expectedTerminal: ["COMPLETED"],
			budget: REVISION_BUDGET,
		},
		source: "benchmark",
		sourceDigest: null,
		oracle: {
			kind: "script",
			source: lines(
				'import assert from "node:assert/strict";',
				'import { readFileSync } from "node:fs";',
				'import { parseArgs } from "./src/cli.mjs";',
				'assert.equal(parseArgs(["--limit", "5"]).limit, 5);',
				'assert.equal(parseArgs(["--limit", "1"]).limit, 1);',
				"const defaults = parseArgs([]);",
				"assert.equal(defaults.limit, 20);",
				"assert.equal(defaults.verbose, false);",
				"assert.equal(defaults.output, null);",
				'const all = parseArgs(["--verbose", "--limit", "100", "--output", "out.txt"]);',
				"assert.equal(all.verbose, true);",
				"assert.equal(all.limit, 100);",
				'assert.equal(all.output, "out.txt");',
				'for (const value of ["0", "-2", "2.5", "abc", ""]) assert.throws(() => parseArgs(["--limit", value]), RangeError);',
				'assert.throws(() => parseArgs(["--limit"]), RangeError);',
				'assert.throws(() => parseArgs(["--unknown"]));',
				'const readme = readFileSync("README.md", "utf8").split("\\n");',
				`for (const kept of ${JSON.stringify(["## Options", ...readmeOptions, "## Exit codes"])}) assert.ok(readme.includes(kept));`,
				'const start = readme.indexOf("## Options");',
				'const end = readme.findIndex((line, index) => index > start && line.startsWith("## "));',
				'const section = readme.slice(start + 1, end).join("\\n");',
				'assert.ok(section.includes("--limit"));',
				"assert.match(section, /\\b20\\b/);",
			),
		},
	},
	{
		fixture: {
			id: "B09",
			category: "bounded-edit",
			language: "javascript",
			workflow: "STANDARD",
			goal: "Fix the session lifetime bug: sessions must last 15 minutes instead of 30. Set SESSION_MINUTES in src/constants.mjs to 15 and derive every session lifetime in src from SESSION_MINUTES, so the server-side expiry and the session cookie always agree.",
			statements: [
				'SESSION_MINUTES in src/constants.mjs is 15 and createSession(id, now) returns expiresAt = now + 15 minutes in milliseconds, e.g. createSession("a", 0).expiresAt is 900000.',
				'sessionCookie(id) sets Max-Age=900 (15 minutes in seconds), e.g. sessionCookie("a") returns "sid=a; Max-Age=900; Path=/; HttpOnly".',
				"Both lifetimes are derived from SESSION_MINUTES: changing only that constant changes the expiry and the cookie Max-Age together, with no second hardcoded lifetime.",
			],
			allowedPaths: ["src"],
			files: {
				"src/constants.mjs": constantsOriginal,
				"src/session.mjs": sessionOriginal,
				"src/cookie.mjs": cookieOriginal,
			},
			expectedFiles: {
				"src/constants.mjs": lines(
					"export const SESSION_MINUTES = 15;",
					"export const SESSION_SECONDS = SESSION_MINUTES * 60;",
					'export const COOKIE_NAME = "sid";',
				),
				"src/session.mjs": sessionOriginal
					.replace("{ SESSION_MINUTES }", "{ SESSION_SECONDS }")
					.replace("SESSION_MINUTES * 60 * 1000", "SESSION_SECONDS * 1000"),
				"src/cookie.mjs": cookieOriginal
					.replace("{ COOKIE_NAME }", "{ COOKIE_NAME, SESSION_SECONDS }")
					.replace('"Max-Age=1800"', '"Max-Age=" + SESSION_SECONDS'),
			},
			checkSource: registeredCheck(
				`import { createSession } from "../src/session.mjs";\nif (createSession("a", 0).expiresAt !== 900000) { ${fail} }`,
			),
			instructions: INSTRUCTIONS,
			expectedTerminal: ["COMPLETED"],
			budget: REVISION_BUDGET,
		},
		source: "benchmark",
		sourceDigest: null,
		// Derivation is judged by behavior: in a copy with SESSION_MINUTES = 7, both lifetimes must follow.
		oracle: {
			kind: "script",
			source: lines(
				'import assert from "node:assert/strict";',
				'import { spawnSync } from "node:child_process";',
				'import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";',
				'import { tmpdir } from "node:os";',
				'import { join } from "node:path";',
				'import { SESSION_MINUTES } from "./src/constants.mjs";',
				'import { sessionCookie } from "./src/cookie.mjs";',
				'import { createSession } from "./src/session.mjs";',
				"assert.equal(SESSION_MINUTES, 15);",
				'const session = createSession("a", 1000);',
				'assert.equal(session.id, "a");',
				"assert.equal(session.expiresAt, 901000);",
				'assert.equal(sessionCookie("abc"), "sid=abc; Max-Age=900; Path=/; HttpOnly");',
				'const copy = mkdtempSync(join(tmpdir(), "weavra-benchmark-mutant-"));',
				"try {",
				'\tcpSync("src", join(copy, "src"), { recursive: true });',
				'\tconst path = join(copy, "src/constants.mjs");',
				'\tconst original = readFileSync(path, "utf8");',
				'\tconst mutated = original.replace(/(\\bSESSION_MINUTES\\s*=\\s*)15\\b/, (_, head) => head + "7");',
				"\tassert.notEqual(mutated, original);",
				"\twriteFileSync(path, mutated);",
				`\tconst probe = ${JSON.stringify(
					lines(
						'import { sessionCookie } from "./src/cookie.mjs";',
						'import { createSession } from "./src/session.mjs";',
						'if (createSession("a", 0).expiresAt !== 420000) process.exit(1);',
						'if (sessionCookie("a") !== "sid=a; Max-Age=420; Path=/; HttpOnly") process.exit(1);',
					),
				)};`,
				'\tconst result = spawnSync(process.execPath, ["--input-type=module", "--eval", probe], { cwd: copy, stdio: "ignore", timeout: 10000 });',
				"\tassert.equal(result.status, 0);",
				"} finally {",
				"\trmSync(copy, { recursive: true, force: true });",
				"}",
			),
		},
	},
	{
		fixture: {
			id: "B10",
			category: "bounded-edit",
			language: "javascript",
			workflow: "STANDARD",
			goal: "Fix the flaky upload bug: upload in src/upload.mjs must make up to 5 attempts before giving up, while download in src/download.mjs keeps making at most 3. src/defaults.mjs is shared with other services, so do not change it.",
			statements: [
				"upload(send, file) calls send up to 5 times and resolves with the first successful result, e.g. when send fails 4 times and then succeeds; after 5 failed attempts it rejects with the last error.",
				"download(fetchFile, name) still calls fetchFile at most 3 times before rejecting with the last error.",
				"src/defaults.mjs is unchanged, so DEFAULTS.attempts stays 3 for the other services that import it.",
			],
			allowedPaths: ["src"],
			files: {
				"src/defaults.mjs": defaultsOriginal,
				"src/retry.mjs": retryOriginal,
				"src/upload.mjs": uploadOriginal,
				"src/download.mjs": downloadOriginal,
			},
			// download.mjs may change as long as it keeps 3 attempts; the reference makes that count explicit.
			expectedFiles: {
				"src/retry.mjs": retryOriginal
					.replace("at most DEFAULTS.attempts times,", "at most attempts times (DEFAULTS.attempts unless given),")
					.replace("withRetry(task)", "withRetry(task, attempts = DEFAULTS.attempts)")
					.replace("attempt <= DEFAULTS.attempts;", "attempt <= attempts;"),
				"src/upload.mjs": lines(
					'import { withRetry } from "./retry.mjs";',
					"",
					"const UPLOAD_ATTEMPTS = 5;",
					"",
					"export function upload(send, file) {",
					"\treturn withRetry(() => send(file), UPLOAD_ATTEMPTS);",
					"}",
				),
				"src/download.mjs": lines(
					'import { DEFAULTS } from "./defaults.mjs";',
					'import { withRetry } from "./retry.mjs";',
					"",
					"export function download(fetchFile, name) {",
					"\treturn withRetry(() => fetchFile(name), DEFAULTS.attempts);",
					"}",
				),
			},
			checkSource: registeredCheck(
				`import { upload } from "../src/upload.mjs";\nlet calls = 0;\nconst send = async () => { calls++; if (calls < 5) throw new Error("flaky"); return "stored"; };\nif ((await upload(send, "report.csv").catch(() => null)) !== "stored") { ${fail} }`,
			),
			instructions: INSTRUCTIONS,
			expectedTerminal: ["COMPLETED"],
			budget: REVISION_BUDGET,
		},
		source: "benchmark",
		sourceDigest: null,
		// The forbidden file is guarded by the shared final-state audit: it is not in expectedFiles.
		oracle: {
			kind: "script",
			source: lines(
				'import assert from "node:assert/strict";',
				'import { DEFAULTS } from "./src/defaults.mjs";',
				'import { download } from "./src/download.mjs";',
				'import { upload } from "./src/upload.mjs";',
				"const flaky = (failures) => {",
				"\tconst probe = { calls: 0 };",
				"\tprobe.task = async (value) => {",
				"\t\tprobe.calls++;",
				'\t\tif (probe.calls <= failures) throw new Error("failure " + probe.calls);',
				'\t\treturn "ok:" + value;',
				"\t};",
				"\treturn probe;",
				"};",
				"let probe = flaky(4);",
				'assert.equal(await upload(probe.task, "f"), "ok:f");',
				"assert.equal(probe.calls, 5);",
				"probe = flaky(99);",
				'await assert.rejects(upload(probe.task, "f"), { message: "failure 5" });',
				"assert.equal(probe.calls, 5);",
				"probe = flaky(2);",
				'assert.equal(await download(probe.task, "n"), "ok:n");',
				"assert.equal(probe.calls, 3);",
				"probe = flaky(99);",
				'await assert.rejects(download(probe.task, "n"), { message: "failure 3" });',
				"assert.equal(probe.calls, 3);",
				"assert.equal(DEFAULTS.attempts, 3);",
			),
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
