import { opendir } from "node:fs/promises";
import { join, posix } from "node:path";
import { readAnchoredSource } from "./anchored-files.ts";
import { isListablePath, isProtectedPath, type PolicyContext, type PolicyPathInspector } from "./policy.ts";
import { type RegisteredCheckLike, resolveVerifierTrustSources } from "./verifier-trust.ts";

/**
 * Planner amendment A1 (docs/architecture/PLANNER_DRAFT.md §4.1): for each registered check, the files inside the
 * allowed paths that its own verifier sources import. The Host reads those sources with the bounded strict reader and
 * matches literal relative module specifiers only; nothing is executed or evaluated. Only the resolved target paths
 * reach the Planning Context, never a verifier name, content, assertion, command or argument. A target is advice for
 * a candidate draft and grants nothing: the prepare dry-run and the human review still judge every claim.
 */
export const EXERCISE_SOURCE_MAX_BYTES = 262_144;
export const EXERCISE_MAX_SOURCES = 16;
export const EXERCISES_MAX_PER_CHECK = 16;
export const EXERCISES_MAX_PER_CONTEXT = 64;
/** Entries read from one directory to resolve names in it, as for ownership facts; a larger one is unreadable. */
const EXERCISE_DIRECTORY_MAX_ENTRIES = 65_536;
/** An extensionless specifier resolves to `<name><extension>` or `<name>/index<extension>` with one of these. */
const MODULE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

/** One Planning Context `checks[]` entry: never an executable, argument or verifier source name. */
export interface PlanningCheck {
	id: string;
	kind: string;
	required: boolean;
	exercises: string[];
	/** Present only when the list was cut at 16 per check or 64 per context. */
	exercisesTruncated?: true;
}

type Token =
	| { kind: "name" | "punct"; value: string }
	/** A quoted literal; null when it has an escape or no closing quote on its line, so it is never evaluated. */
	| { kind: "string"; value: string | null }
	/** A number, template or regular expression: never a module specifier. */
	| { kind: "other" };

const OTHER: Token = { kind: "other" };
/** After these names a `/` starts a regular expression; after any other name it is a division. */
const REGEX_AFTER_NAMES = new Set([
	"return",
	"typeof",
	"instanceof",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"case",
	"do",
	"else",
	"yield",
	"await",
	"extends",
]);

function lineEnd(text: string, at: number): number {
	while (at < text.length && !/[\n\r\u2028\u2029]/.test(text[at])) at++;
	return at;
}

function regexAllowed(last: Token | undefined): boolean {
	if (!last) return true;
	if (last.kind === "punct") return last.value !== ")" && last.value !== "]";
	return last.kind === "name" && REGEX_AFTER_NAMES.has(last.value);
}

/** From after the opening slash: the end of a regular expression literal and its flags, or of its line. */
function regexEnd(text: string, at: number): number {
	let inClass = false;
	for (; at < text.length && !/[\n\r\u2028\u2029]/.test(text[at]); at++) {
		const char = text[at];
		if (char === "\\") at++;
		else if (char === "[") inClass = true;
		else if (char === "]") inClass = false;
		else if (char === "/" && !inClass) {
			at++;
			while (at < text.length && /[\w$]/.test(text[at])) at++;
			return at;
		}
	}
	return at;
}

/**
 * A conservative JS/TS lexer. Comments are skipped; strings, templates and regular expressions are single tokens, so
 * text inside them never reads as code, while code inside template substitutions is lexed as code. An ambiguous
 * slash can at worst mislex the rest of its line. Nothing is evaluated.
 */
function lex(text: string): Token[] {
	const tokens: Token[] = [];
	/** The brace depth that each open template substitution returns to. */
	const substitutions: number[] = [];
	let depth = 0;
	/** Template characters from `at`: stops after the closing backtick or inside a new `${` substitution. */
	const template = (at: number): number => {
		for (; at < text.length; at++) {
			if (text[at] === "\\") at++;
			else if (text[at] === "`") return at + 1;
			else if (text[at] === "$" && text[at + 1] === "{") {
				substitutions.push(depth++);
				return at + 2;
			}
		}
		return at;
	};
	let at = text.startsWith("#!") ? lineEnd(text, 0) : 0;
	while (at < text.length) {
		const char = text[at];
		const next = text[at + 1];
		if (/\s/.test(char)) at++;
		else if (char === "/" && next === "/") at = lineEnd(text, at);
		else if (char === "/" && next === "*") {
			const end = text.indexOf("*/", at + 2);
			at = end === -1 ? text.length : end + 2;
		} else if (char === '"' || char === "'") {
			let end = at + 1;
			let literal = true;
			for (; end < text.length && text[end] !== char && text[end] !== "\n" && text[end] !== "\r"; end++)
				if (text[end] === "\\") {
					literal = false;
					end++;
				}
			const closed = text[end] === char;
			tokens.push({ kind: "string", value: literal && closed ? text.slice(at + 1, end) : null });
			at = closed ? end + 1 : end;
		} else if (char === "`") {
			tokens.push(OTHER);
			at = template(at + 1);
		} else if (char === "}" && substitutions.at(-1) === depth - 1) {
			depth--;
			substitutions.pop();
			tokens.push(OTHER);
			at = template(at + 1);
		} else if (/[\p{ID_Start}$_]/u.test(char)) {
			let end = at + 1;
			while (end < text.length && /[\p{ID_Continue}$\u200c\u200d]/u.test(text[end])) end++;
			tokens.push({ kind: "name", value: text.slice(at, end) });
			at = end;
		} else if (/[0-9]/.test(char)) {
			let end = at + 1;
			while (end < text.length && /[\w.]/.test(text[end])) end++;
			tokens.push(OTHER);
			at = end;
		} else if (char === "/" && regexAllowed(tokens.at(-1))) {
			at = regexEnd(text, at + 1);
			tokens.push(OTHER);
		} else {
			if (char === "{") depth++;
			else if (char === "}") depth--;
			tokens.push({ kind: "punct", value: char });
			at++;
		}
	}
	return tokens;
}

function isPunct(token: Token | undefined, ...values: string[]): boolean {
	return token?.kind === "punct" && values.includes(token.value);
}

/**
 * An `import`/`export` clause from `start`: bindings, `type`, `*`, `,` and braces up to `from` and a literal. Returns
 * where the scan stopped and the literal, if any. `from` is also a legal binding name, so it ends the clause only at
 * brace depth 0, after the first clause token and before a literal.
 */
function fromClause(tokens: readonly Token[], start: number): [number, Token | undefined] {
	let depth = 0;
	for (let at = start; at < tokens.length; at++) {
		const token = tokens[at];
		if (token.kind === "name") {
			if (token.value === "from" && depth === 0 && at > start && tokens[at + 1]?.kind === "string")
				return [at + 1, tokens[at + 1]];
		} else if (isPunct(token, "{")) depth++;
		else if (isPunct(token, "}") && depth > 0) depth--;
		else if (!isPunct(token, "*", ",")) return [at, undefined];
	}
	return [tokens.length, undefined];
}

/**
 * §4.1 step 2: the relative specifiers of `import … from "…"`, `import "…"`, `export … from "…"`, `import("…")` and
 * `require("…")`, in source order. Only a single- or double-quoted literal without escapes that starts with `./` or
 * `../` counts; bare, absolute and URL specifiers, templates and computed expressions never do.
 */
export function relativeModuleSpecifiers(text: string): string[] {
	const tokens = lex(text);
	const specifiers: string[] = [];
	const accept = (token: Token | undefined) => {
		if (token?.kind === "string" && token.value !== null && /^\.\.?\//.test(token.value))
			specifiers.push(token.value);
	};
	/** Tokens before this index already belong to an earlier clause, so every clause is scanned once. */
	let scanned = 0;
	for (const [at, token] of tokens.entries()) {
		// A member such as `loader.import(…)`, `import.meta` or `require.resolve(…)` is not module syntax.
		if (token.kind !== "name" || isPunct(tokens[at - 1], ".")) continue;
		const call = isPunct(tokens[at + 1], "(") && tokens[at + 2]?.kind === "string";
		if (token.value === "require" && call && isPunct(tokens[at + 3], ")")) accept(tokens[at + 2]);
		// An import call may pass options after its specifier.
		else if (token.value === "import" && call && isPunct(tokens[at + 3], ")", ",")) accept(tokens[at + 2]);
		else if (token.value === "import" && tokens[at + 1]?.kind === "string") accept(tokens[at + 1]);
		else if ((token.value === "import" || token.value === "export") && at >= scanned) {
			const [end, specifier] = fromClause(tokens, at + 1);
			scanned = end;
			accept(specifier);
		}
	}
	return specifiers;
}

/** A project-relative entry for resolution: unsafe is a symlink, a multiply linked file or an unreadable parent. */
type EntryKind = "missing" | "file" | "directory" | "unsafe";

/** Exact entry names of one directory, read once; over the bound it is unreadable instead. */
async function directoryNames(path: string): Promise<ReadonlySet<string>> {
	const directory = await opendir(path);
	const names = new Set<string>();
	try {
		for (let entry = await directory.read(); entry; entry = await directory.read()) {
			if (names.size >= EXERCISE_DIRECTORY_MAX_ENTRIES) throw new Error("Directory exceeds the entry bound");
			names.add(entry.name);
		}
	} finally {
		await directory.close();
	}
	return names;
}

/**
 * Entry kinds by exact name: a parent directory is listed once, and only an entry that exists there gets the Policy
 * path inspection (no symlink anywhere on the path, one regular single-link file). Work grows with the referenced
 * directories and existing files, not with the number of specifiers.
 */
function entryKinds(projectPath: string, inspector: PolicyPathInspector): (path: string) => Promise<EntryKind> {
	const inspected = new Map<string, Promise<EntryKind>>();
	const listed = new Map<string, Promise<ReadonlySet<string> | "missing" | "unsafe">>();
	const inspect = (path: string) => {
		let kind = inspected.get(path);
		if (!kind) {
			kind = inspector.inspect([path]).then(
				([fact]): EntryKind => (fact?.safe ? fact.kind : "unsafe"),
				(): EntryKind => "unsafe",
			);
			inspected.set(path, kind);
		}
		return kind;
	};
	const names = (directory: string) => {
		let result = listed.get(directory);
		if (!result) {
			result = (async () => {
				// The project root is the Host's canonical path; every inspection below rechecks it.
				const kind = directory === "." ? "directory" : await inspect(directory);
				if (kind !== "directory") return kind === "missing" ? "missing" : "unsafe";
				return directoryNames(join(projectPath, directory)).catch(() => "unsafe" as const);
			})();
			listed.set(directory, result);
		}
		return result;
	};
	return async (path) => {
		const entries = await names(posix.dirname(path));
		if (typeof entries === "string") return entries;
		return entries.has(posix.basename(path)) ? inspect(path) : "missing";
	};
}

/**
 * §4.1 step 3: the specifier against its source's directory, as a normalized project-relative POSIX path, if `keep`
 * accepts it. An explicit extension is kept as written, whether or not the file exists (a missing file is a `create`
 * target). An extensionless name resolves to the one existing regular file among `<name><extension>` and
 * `<name>/index<extension>`. Undefined when the path leaves the project, names a directory or an unsafe entry, carries
 * URL syntax (`?`, `#`, `%`), or an extensionless name matches none or several files.
 */
async function resolveSpecifier(
	source: string,
	specifier: string,
	keep: (path: string) => boolean,
	kindOf: (path: string) => Promise<EntryKind>,
): Promise<string | undefined> {
	const name = specifier.slice(specifier.lastIndexOf("/") + 1);
	if (name === "" || name === "." || name === ".." || /[?#%]/.test(specifier)) return undefined;
	const path = posix.normalize(posix.join(posix.dirname(source), specifier));
	if (path === ".." || path.startsWith("../")) return undefined;
	if (posix.extname(name)) {
		if (!keep(path)) return undefined;
		const kind = await kindOf(path);
		return kind === "file" || kind === "missing" ? path : undefined;
	}
	const files = MODULE_EXTENSIONS.map((extension) => `${path}${extension}`);
	const indexes = MODULE_EXTENSIONS.map((extension) => `${path}/index${extension}`);
	// A match that the filter drops anyway needs no filesystem lookup.
	if (!files.some(keep) && !indexes.some(keep)) return undefined;
	const kind = await kindOf(path);
	if (kind === "unsafe") return undefined;
	const matches: string[] = [];
	for (const candidate of kind === "directory" ? [...files, ...indexes] : files) {
		const candidateKind = await kindOf(candidate);
		if (candidateKind === "unsafe") return undefined;
		if (candidateKind === "file") matches.push(candidate);
	}
	return matches.length === 1 && keep(matches[0]) ? matches[0] : undefined;
}

/** §4.1 step 1: the check's direct verifier sources and declared trust files, without the browser implementation. */
export function checkExerciseSources(projectPath: string, check: RegisteredCheckLike): string[] {
	return resolveVerifierTrustSources(projectPath, check.browser ? { ...check, browser: undefined } : check);
}

/**
 * §4.1 step 2: one source read as the trust snapshot reads it (an unprotected literal path without symlinks, one
 * regular single-link file) with the bounded strict UTF-8 reader. A source that cannot be read safely contributes
 * nothing; its check gets fewer exercises and planning continues.
 */
function sourceSpecifiers(projectPath: string, source: string): string[] {
	if (isProtectedPath(source)) return [];
	try {
		const { text } = readAnchoredSource(projectPath, source, EXERCISE_SOURCE_MAX_BYTES);
		return [...new Set(relativeModuleSpecifiers(text))];
	} catch {
		return [];
	}
}

function resolvedOrNone(resolve: () => string[]): string[] {
	try {
		return resolve();
	} catch {
		return [];
	}
}

/**
 * The Planning Context `checks`: `id`, `kind`, `required` and the A1 `exercises` of every registered check, in
 * configuration order. A target is kept only inside the allowed paths and listable under the planner's Policy
 * (`isListablePath`: not protected, not `.ai`), and never when it is a verifier source of any check (step 4). Each
 * list is deduplicated and sorted in JavaScript default order, then cut at 16 per check and 64 per context, and a
 * cut list is marked `exercisesTruncated: true` (step 5). Deterministic for the same files and configuration.
 */
export async function planningChecks(input: {
	projectPath: string;
	checks: readonly RegisteredCheckLike[];
	policy: Pick<PolicyContext, "allowedPaths" | "protectedPaths">;
	inspector: PolicyPathInspector;
	signal: AbortSignal;
}): Promise<PlanningCheck[]> {
	const { projectPath, policy, inspector, signal } = input;
	const verifierSources = new Set(
		input.checks.flatMap((check) => resolvedOrNone(() => resolveVerifierTrustSources(projectPath, check))),
	);
	const keep = (path: string) => isListablePath(path, policy) && !verifierSources.has(path);
	const kindOf = entryKinds(projectPath, inspector);
	const scanned = new Map<string, string[]>();
	let remaining = EXERCISES_MAX_PER_CONTEXT;
	const checks: PlanningCheck[] = [];
	for (const check of input.checks) {
		const targets = new Set<string>();
		const sources = resolvedOrNone(() => checkExerciseSources(projectPath, check));
		for (const source of sources.slice(0, EXERCISE_MAX_SOURCES)) {
			let specifiers = scanned.get(source);
			if (!specifiers) {
				signal.throwIfAborted();
				specifiers = sourceSpecifiers(projectPath, source);
				scanned.set(source, specifiers);
			}
			for (const specifier of specifiers) {
				signal.throwIfAborted();
				const target = await resolveSpecifier(source, specifier, keep, kindOf);
				if (target !== undefined) targets.add(target);
			}
		}
		const sorted = [...targets].sort();
		const exercises = sorted.slice(0, Math.min(EXERCISES_MAX_PER_CHECK, remaining));
		remaining -= exercises.length;
		checks.push({
			id: check.id,
			kind: check.kind,
			required: check.required,
			exercises,
			...(exercises.length < sorted.length ? { exercisesTruncated: true as const } : {}),
		});
	}
	signal.throwIfAborted();
	return checks;
}
