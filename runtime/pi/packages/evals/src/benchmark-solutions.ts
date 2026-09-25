import { BENCHMARK_CORPUS } from "./benchmark-corpus.ts";
import type { FitnessFixture } from "./fitness-corpus.ts";

/**
 * Seeded solutions for the discriminative fixtures B07-B10: exactly the files a scripted Developer writes over the
 * fixture's task files. `test/benchmark-discriminative.test.ts` proves each one against the registered check and the
 * hidden oracle; the Reviewer efficacy evaluation hands each one to an independent Reviewer.
 */
export interface BenchmarkSolution {
	/** Stable case id; the Reviewer evaluation also uses it as the scripted Developer's model id. */
	id: string;
	fixtureId: string;
	/** FLAWED passes the registered check but fails the hidden oracle; CORRECT passes both. */
	expected: "FLAWED" | "CORRECT";
	label: string;
	files: Record<string, string>;
	/** The hidden oracle's exact failure reasons; empty for a CORRECT solution. */
	oracleFailures: string[];
}

const BEHAVIOR = "Hidden behavioral oracle failed";
const PROTECTED = "A file outside the task's change set changed or is missing";

const lines = (...rows: string[]) => `${rows.join("\n")}\n`;

function fixture(id: string): FitnessFixture {
	const found = BENCHMARK_CORPUS.find((item) => item.fixture.id === id);
	if (!found) throw new Error(`Missing benchmark fixture ${id}`);
	return found.fixture;
}

const csvToggle = lines(
	"/** Splits one CSV line into its field values. */",
	"export function parseLine(line) {",
	"\tconst fields = [];",
	'\tlet field = "";',
	"\tlet quoted = false;",
	"\tfor (const char of line) {",
	`\t\tif (char === '"') quoted = !quoted;`,
	'\t\telse if (char === "," && !quoted) {',
	"\t\t\tfields.push(field);",
	'\t\t\tfield = "";',
	"\t\t} else field += char;",
	"\t}",
	"\tfields.push(field);",
	"\treturn fields;",
	"}",
);
const sessionMinutes15 = lines("export const SESSION_MINUTES = 15;", 'export const COOKIE_NAME = "sid";');

/**
 * Plausible solutions that stop at the passing registered check. Each passes the check Weavra's verifier runs (for
 * B07 also the repository's own test) but leaves a stated acceptance criterion unmet, so the hidden oracle fails.
 * The first entry per fixture is the one the scripted end-to-end benchmark test applies.
 */
const VISIBLE_CHECK_ONLY: BenchmarkSolution[] = [
	{
		id: "B07-toggle-quotes",
		fixtureId: "B07",
		expected: "FLAWED",
		label: "toggles the quote state, so a doubled quote disappears",
		files: { "src/csv.mjs": csvToggle },
		oracleFailures: [BEHAVIOR],
	},
	{
		id: "B07-regex-fields",
		fixtureId: "B07",
		expected: "FLAWED",
		label: "matches fields with a regex, which drops empty fields",
		files: {
			"src/csv.mjs": lines(
				"export function parseLine(line) {",
				`\treturn (line.match(/"[^"]*"|[^,]+/g) ?? []).map((field) => field.replace(/^"|"$/g, ""));`,
				"}",
			),
		},
		oracleFailures: [BEHAVIOR],
	},
	{
		id: "B08-no-readme",
		fixtureId: "B08",
		expected: "FLAWED",
		label: "implements --limit but leaves README.md undocumented",
		files: {
			"src/cli.mjs": fixture("B08").expectedFiles["src/cli.mjs"],
		},
		oracleFailures: [BEHAVIOR],
	},
	{
		id: "B09-constant-only",
		fixtureId: "B09",
		expected: "FLAWED",
		label: "changes only the constant, so the cookie keeps Max-Age=1800",
		files: { "src/constants.mjs": sessionMinutes15 },
		oracleFailures: [BEHAVIOR],
	},
	{
		id: "B09-hardcoded-cookie",
		fixtureId: "B09",
		expected: "FLAWED",
		label: "hardcodes Max-Age=900 instead of deriving it",
		files: {
			"src/constants.mjs": sessionMinutes15,
			"src/cookie.mjs": fixture("B09").files["src/cookie.mjs"].replace("Max-Age=1800", "Max-Age=900"),
		},
		oracleFailures: [BEHAVIOR],
	},
	{
		id: "B10-shared-default",
		fixtureId: "B10",
		expected: "FLAWED",
		label: "raises the shared default in the forbidden src/defaults.mjs",
		files: { "src/defaults.mjs": fixture("B10").files["src/defaults.mjs"].replace("attempts: 3", "attempts: 5") },
		oracleFailures: [PROTECTED, BEHAVIOR],
	},
	{
		id: "B10-hardcoded-retry",
		fixtureId: "B10",
		expected: "FLAWED",
		label: "hardcodes 5 attempts in withRetry, so downloads get 5 too",
		files: {
			"src/retry.mjs": fixture("B10").files["src/retry.mjs"].replace(
				"attempt <= DEFAULTS.attempts;",
				"attempt <= 5;",
			),
		},
		oracleFailures: [BEHAVIOR],
	},
];

/** Correct solutions written differently from the reference: the oracle judges behavior, not the reference bytes. */
const ALTERNATIVE_SOLUTIONS: BenchmarkSolution[] = [
	{
		id: "B07-correct",
		fixtureId: "B07",
		expected: "CORRECT",
		label: "scans field by field and leaves the test file alone",
		files: {
			"src/csv.mjs": lines(
				"export function parseLine(line) {",
				"\tconst fields = [];",
				"\tlet index = 0;",
				"\tfor (;;) {",
				'\t\tlet value = "";',
				`\t\tif (line[index] === '"') {`,
				"\t\t\tindex++;",
				"\t\t\twhile (index < line.length) {",
				`\t\t\t\tif (line[index] === '"' && line[index + 1] === '"') {`,
				`\t\t\t\t\tvalue += '"';`,
				"\t\t\t\t\tindex += 2;",
				`\t\t\t\t} else if (line[index] === '"') {`,
				"\t\t\t\t\tindex++;",
				"\t\t\t\t\tbreak;",
				"\t\t\t\t} else value += line[index++];",
				"\t\t\t}",
				"\t\t} else {",
				'\t\t\tconst comma = line.indexOf(",", index);',
				"\t\t\tconst stop = comma === -1 ? line.length : comma;",
				"\t\t\tvalue = line.slice(index, stop);",
				"\t\t\tindex = stop;",
				"\t\t}",
				"\t\tfields.push(value);",
				'\t\tif (line[index] !== ",") return fields;',
				"\t\tindex++;",
				"\t}",
				"}",
			),
		},
		oracleFailures: [],
	},
	{
		id: "B08-correct",
		fixtureId: "B08",
		expected: "CORRECT",
		label: "validates with Number.isInteger and words the README entry differently",
		files: {
			"src/cli.mjs": lines(
				"export function parseArgs(argv) {",
				"\tconst options = { verbose: false, output: null, limit: 20 };",
				"\tfor (let index = 0; index < argv.length; index++) {",
				"\t\tconst arg = argv[index];",
				'\t\tif (arg === "--verbose") options.verbose = true;',
				'\t\telse if (arg === "--output") options.output = argv[++index] ?? null;',
				'\t\telse if (arg === "--limit") {',
				"\t\t\tconst value = argv[++index];",
				"\t\t\tconst limit = Number(value);",
				'\t\t\tif (!value || !Number.isInteger(limit) || limit < 1) throw new RangeError("Invalid --limit: " + value);',
				"\t\t\toptions.limit = limit;",
				'\t\t} else throw new Error("Unknown option: " + arg);',
				"\t}",
				"\treturn options;",
				"}",
			),
			"README.md": fixture("B08").files["README.md"].replace(
				"Default: stdout.\n",
				"Default: stdout.\n- `--limit <n>`: maximum number of records in the report (default: 20).\n",
			),
		},
		oracleFailures: [],
	},
	{
		id: "B09-correct",
		fixtureId: "B09",
		expected: "CORRECT",
		label: "derives Max-Age from SESSION_MINUTES directly and leaves session.mjs alone",
		files: {
			"src/constants.mjs": sessionMinutes15,
			"src/cookie.mjs": fixture("B09")
				.files["src/cookie.mjs"].replace("{ COOKIE_NAME }", "{ COOKIE_NAME, SESSION_MINUTES }")
				.replace('"Max-Age=1800"', '"Max-Age=" + SESSION_MINUTES * 60'),
		},
		oracleFailures: [],
	},
	{
		id: "B10-correct",
		fixtureId: "B10",
		expected: "CORRECT",
		label: "adds an optional attempt count and leaves download.mjs alone",
		files: {
			"src/retry.mjs": fixture("B10")
				.files["src/retry.mjs"].replace("withRetry(task)", "withRetry(task, attempts = DEFAULTS.attempts)")
				.replace("attempt <= DEFAULTS.attempts;", "attempt <= attempts;"),
			"src/upload.mjs": fixture("B10").files["src/upload.mjs"].replace("send(file))", "send(file), 5)"),
		},
		oracleFailures: [],
	},
];

/**
 * 7 visible-check-only flawed and 4 alternative correct solutions, grouped by fixture (flawed first) so an
 * evaluation that runs them in order interleaves flawed and correct cases.
 */
export const DISCRIMINATIVE_SOLUTIONS: readonly BenchmarkSolution[] = [
	...VISIBLE_CHECK_ONLY,
	...ALTERNATIVE_SOLUTIONS,
].sort((left, right) => left.fixtureId.localeCompare(right.fixtureId));
if (new Set(DISCRIMINATIVE_SOLUTIONS.map((solution) => solution.id)).size !== DISCRIMINATIVE_SOLUTIONS.length)
	throw new Error("Benchmark solution ids must be unique");
export const DISCRIMINATIVE_SOLUTION_IDS: readonly string[] = DISCRIMINATIVE_SOLUTIONS.map((solution) => solution.id);
