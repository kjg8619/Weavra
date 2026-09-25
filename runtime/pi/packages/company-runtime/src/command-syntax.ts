/**
 * Conservative bash/POSIX sh syntax for the command guard's classifier (command-risk.ts). Pure: text in, structure
 * out. Constructs it does not model (control flow, substitutions, functions, arrays, unterminated quotes or
 * here-documents, ...) are reported as `unsupported`, which the classifier turns into at least `unknown`.
 */

/** Quotes and substitutions inside substitutions; deeper nesting is unsupported syntax. */
const MAX_SKIP_NESTING = 64;

// ---------------------------------------------------------------------------------------------------------------
// Lexer: a conservative bash subset. Unsupported constructs are recorded and force at least `unknown`.
// ---------------------------------------------------------------------------------------------------------------

export interface Word {
	/** Text after quote removal. Exact only when `literal(word)`; expansions contribute nothing. */
	text: string;
	/** Parameter expansion, substitution, ANSI-C/locale string or brace expansion: the value is not visible. */
	dynamic: boolean;
	/** Unquoted glob characters: a pattern that may match several names. */
	glob: boolean;
	/** Leading unquoted `~`: a home-relative path. */
	tilde: boolean;
	/** Any quoting or escaping: never a reserved word. */
	quoted: boolean;
	/** Variable name of a leading unquoted `NAME=` or `NAME+=`. */
	assignment?: string;
}

/** Exactly the visible text reaches the program. */
export const literal = (word: Word): boolean => !word.dynamic && !word.glob && !word.tilde;
/** Expands to its visible text or to names that cannot begin with `-`, so it cannot smuggle in an option. */
export const visible = (word: Word): boolean => !word.dynamic && (!word.glob || /^[^*?[-]/.test(word.text));

export type RedirectOp = ">" | ">>" | ">|" | "&>" | "&>>" | ">&" | "<" | "<>" | "<&" | "<<" | "<<-" | "<<<";
export interface Redirect {
	op: RedirectOp;
	target?: Word;
}
type Token =
	| { kind: "word"; word: Word }
	| { kind: "op"; op: ";" | "&&" | "||" | "|" | "&" | "(" | ")" }
	| { kind: "redirect"; redirect: Redirect };

const BOUNDARY = "|&;<>()";
export const dynamicWord = (): Word => ({ text: "", dynamic: true, glob: false, tilde: false, quoted: false });

function lex(source: string, unsupported: Set<string>): Token[] {
	const tokens: Token[] = [];
	const heredocs: Array<{ delimiter: string; stripTabs: boolean; expands: boolean }> = [];
	const n = source.length;
	const at = (index: number): string => source.charAt(index);
	let i = 0;
	let nesting = 0;
	const nested = (): boolean => {
		if (nesting < MAX_SKIP_NESTING) return true;
		unsupported.add("deeply nested quoting");
		return false;
	};

	/** Index just past the `)` that closes the `(` at `open`, honoring quotes and nesting. */
	const skipParens = (open: number): number => {
		if (!nested()) return n;
		nesting++;
		let depth = 0;
		let j = open;
		try {
			while (j < n) {
				const c = at(j);
				if (c === "\\") j += 2;
				else if (c === "'") {
					const end = source.indexOf("'", j + 1);
					if (end < 0) break;
					j = end + 1;
				} else if (c === '"') j = skipDouble(j);
				else if (c === "`") j = skipBacktick(j);
				else {
					if (c === "(") depth++;
					else if (c === ")" && --depth === 0) return j + 1;
					j++;
				}
			}
			unsupported.add("unterminated substitution");
			return n;
		} finally {
			nesting--;
		}
	};
	/** Index just past the `"` that closes the one at `open`. */
	const skipDouble = (open: number): number => {
		if (!nested()) return n;
		nesting++;
		let j = open + 1;
		try {
			while (j < n) {
				const c = at(j);
				if (c === "\\") j += 2;
				else if (c === '"') return j + 1;
				else if (c === "$" && at(j + 1) === "(") j = skipParens(j + 1);
				else if (c === "`") j = skipBacktick(j);
				else j++;
			}
			unsupported.add("unterminated quote");
			return n;
		} finally {
			nesting--;
		}
	};
	const skipBacktick = (open: number): number => {
		let j = open + 1;
		while (j < n) {
			const c = at(j);
			if (c === "\\") j += 2;
			else if (c === "`") return j + 1;
			else j++;
		}
		unsupported.add("unterminated command substitution");
		return n;
	};
	/** `${...}` starting at `{`; nested substitutions are recorded. */
	const skipBraces = (open: number): number => {
		if (!nested()) return n;
		nesting++;
		let depth = 0;
		let j = open;
		try {
			while (j < n) {
				const c = at(j);
				if (c === "\\") j += 2;
				else if (c === "'") {
					const end = source.indexOf("'", j + 1);
					if (end < 0) break;
					j = end + 1;
				} else if (c === '"') j = skipDouble(j);
				else if (c === "$" && at(j + 1) === "(") {
					unsupported.add("command substitution");
					j = skipParens(j + 1);
				} else if (c === "`") {
					unsupported.add("command substitution");
					j = skipBacktick(j);
				} else {
					if (c === "{") depth++;
					else if (c === "}" && --depth === 0) return j + 1;
					j++;
				}
			}
			unsupported.add("unterminated parameter expansion");
			return n;
		} finally {
			nesting--;
		}
	};
	/** At `$`: consumes an expansion and returns true, or returns false for a literal `$`. */
	const expansion = (): boolean => {
		const next = at(i + 1);
		if (next === "(") {
			unsupported.add(at(i + 2) === "(" ? "arithmetic expansion" : "command substitution");
			i = skipParens(i + 1);
			return true;
		}
		if (next === "{") {
			i = skipBraces(i + 1);
			return true;
		}
		if (/[A-Za-z_]/.test(next)) {
			i += 2;
			while (i < n && /[A-Za-z0-9_]/.test(at(i))) i++;
			return true;
		}
		if (next !== "" && "0123456789@*#?$!-".includes(next)) {
			i += 2;
			return true;
		}
		return false;
	};
	const readDouble = (word: Word): void => {
		i++;
		while (i < n) {
			const c = at(i);
			if (c === '"') {
				i++;
				return;
			}
			if (c === "\\") {
				const next = at(i + 1);
				if (next === "\n") i += 2;
				else if (next !== "" && '$`"\\'.includes(next)) {
					word.text += next;
					i += 2;
				} else {
					word.text += "\\";
					i++;
				}
			} else if (c === "$") {
				if (expansion()) word.dynamic = true;
				else {
					word.text += "$";
					i++;
				}
			} else if (c === "`") {
				unsupported.add("command substitution");
				i = skipBacktick(i);
				word.dynamic = true;
			} else {
				word.text += c;
				i++;
			}
		}
		unsupported.add("unterminated quote");
		word.dynamic = true;
	};
	const readWord = (): Word => {
		const word: Word = { text: "", dynamic: false, glob: false, tilde: false, quoted: false };
		// Unquoted characters as written; quoted text and expansions become NUL, for brace-expansion detection.
		let skeleton = "";
		let plain = true;
		let bracket = false;
		const quotedFrom = (index: number) => {
			skeleton += "\0".repeat(Math.max(1, word.text.length - index));
		};
		while (i < n) {
			const c = at(i);
			if (c === " " || c === "\t" || c === "\n" || BOUNDARY.includes(c)) break;
			const before = word.text.length;
			if (c === "\\") {
				if (at(i + 1) === "\n") {
					i += 2;
					continue;
				}
				word.quoted = true;
				plain = false;
				word.text += at(i + 1);
				i += 2;
				quotedFrom(before);
			} else if (c === "'") {
				word.quoted = true;
				plain = false;
				const end = source.indexOf("'", i + 1);
				if (end < 0) {
					unsupported.add("unterminated quote");
					word.dynamic = true;
					i = n;
					break;
				}
				word.text += source.slice(i + 1, end);
				i = end + 1;
				quotedFrom(before);
			} else if (c === '"') {
				word.quoted = true;
				plain = false;
				readDouble(word);
				quotedFrom(before);
			} else if (c === "$" && at(i + 1) === "'") {
				// ANSI-C quoting: the value is not decoded, so it is not visible.
				word.quoted = true;
				word.dynamic = true;
				plain = false;
				let j = i + 2;
				while (j < n && at(j) !== "'") j += at(j) === "\\" ? 2 : 1;
				if (j >= n) unsupported.add("unterminated quote");
				i = Math.min(j + 1, n);
				quotedFrom(before);
			} else if (c === "$" && at(i + 1) === '"') {
				// Locale translation: read as a double-quoted string whose value is not visible.
				word.quoted = true;
				word.dynamic = true;
				plain = false;
				i++;
				readDouble(word);
				quotedFrom(before);
			} else if (c === "$") {
				plain = false;
				if (expansion()) {
					word.dynamic = true;
					quotedFrom(before);
				} else {
					word.text += "$";
					skeleton += "$";
					i++;
				}
			} else if (c === "`") {
				unsupported.add("command substitution");
				i = skipBacktick(i);
				word.dynamic = true;
				plain = false;
				quotedFrom(before);
			} else if (
				c === "=" &&
				plain &&
				word.assignment === undefined &&
				/^[A-Za-z_][A-Za-z0-9_]*\+?$/.test(word.text)
			) {
				word.assignment = word.text.replace(/\+$/, "");
				word.text += "=";
				skeleton += "=";
				plain = false;
				i++;
			} else {
				if (c === "~" && word.text === "" && !word.quoted) word.tilde = true;
				if (c === "*" || c === "?") word.glob = true;
				if (c === "[") bracket = true;
				if (c === "]" && bracket) word.glob = true;
				word.text += c;
				skeleton += c;
				i++;
			}
		}
		// Brace expansion (`{a,b}`, `{1..3}`) turns one word into several, possibly into options.
		if (/\{[^{}]*(?:,|\.\.)[^{}]*\}/.test(skeleton)) word.dynamic = true;
		return word;
	};
	const redirect = (op: RedirectOp): void => {
		i += op === "&>" || op === "&>>" ? 0 : op.length;
		while (at(i) === " " || at(i) === "\t") i++;
		const start = at(i);
		if (start === "" || start === "\n" || BOUNDARY.includes(start)) {
			unsupported.add("redirection without a target");
			tokens.push({ kind: "redirect", redirect: { op } });
			return;
		}
		const target = readWord();
		if (op === "<<" || op === "<<-") {
			if (target.dynamic || target.text === "") unsupported.add("unusual here-document delimiter");
			else heredocs.push({ delimiter: target.text, stripTabs: op === "<<-", expands: !target.quoted });
			tokens.push({ kind: "redirect", redirect: { op } });
			return;
		}
		tokens.push({ kind: "redirect", redirect: { op, target } });
	};
	const redirection = (): void => {
		const c = at(i);
		const next = at(i + 1);
		if (next === "(") {
			unsupported.add("process substitution");
			i = skipParens(i + 1);
			tokens.push({ kind: "word", word: dynamicWord() });
			return;
		}
		if (c === "<") {
			const third = at(i + 2);
			if (next === "<") redirect(third === "<" ? "<<<" : third === "-" ? "<<-" : "<<");
			else redirect(next === "&" ? "<&" : next === ">" ? "<>" : "<");
		} else redirect(next === ">" ? ">>" : next === "|" ? ">|" : next === "&" ? ">&" : ">");
	};
	/** After an unquoted newline, here-document bodies are data until their delimiter line. */
	const heredocBodies = (): void => {
		for (const document of heredocs.splice(0)) {
			let closed = false;
			while (i < n) {
				const end = source.indexOf("\n", i);
				const line = source.slice(i, end < 0 ? n : end);
				i = end < 0 ? n : end + 1;
				if ((document.stripTabs ? line.replace(/^\t+/, "") : line) === document.delimiter) {
					closed = true;
					break;
				}
				if (document.expands && (line.includes("`") || line.includes("$(")))
					unsupported.add("command substitution in a here-document");
			}
			if (!closed) unsupported.add("unterminated here-document");
		}
	};

	while (i < n) {
		const c = at(i);
		if (c === " " || c === "\t") i++;
		else if (c === "\\" && at(i + 1) === "\n") i += 2;
		else if (c === "\n") {
			i++;
			tokens.push({ kind: "op", op: ";" });
			heredocBodies();
		} else if (c === "#") {
			while (i < n && at(i) !== "\n") i++;
		} else if (c === ";") {
			if (at(i + 1) === ";" || at(i + 1) === "&") {
				unsupported.add("case statement");
				i += at(i + 2) === "&" ? 3 : 2;
			} else i++;
			tokens.push({ kind: "op", op: ";" });
		} else if (c === "&") {
			if (at(i + 1) === "&") {
				tokens.push({ kind: "op", op: "&&" });
				i += 2;
			} else if (at(i + 1) === ">") {
				const append = at(i + 2) === ">";
				i += append ? 3 : 2;
				redirect(append ? "&>>" : "&>");
			} else {
				tokens.push({ kind: "op", op: "&" });
				i++;
			}
		} else if (c === "|") {
			if (at(i + 1) === "|") {
				tokens.push({ kind: "op", op: "||" });
				i += 2;
			} else {
				tokens.push({ kind: "op", op: "|" });
				i += at(i + 1) === "&" ? 2 : 1;
			}
		} else if (c === "(") {
			if (at(i + 1) === "(") {
				unsupported.add("arithmetic command");
				i = skipParens(i);
			} else {
				tokens.push({ kind: "op", op: "(" });
				i++;
			}
		} else if (c === ")") {
			tokens.push({ kind: "op", op: ")" });
			i++;
		} else if (c === "<" || c === ">") redirection();
		else {
			let j = i;
			while (/[0-9]/.test(at(j))) j++;
			if (j > i && (at(j) === "<" || at(j) === ">")) {
				// A leading file descriptor number belongs to the redirection that follows it.
				i = j;
				redirection();
			} else tokens.push({ kind: "word", word: readWord() });
		}
	}
	if (heredocs.length) unsupported.add("unterminated here-document");
	return tokens;
}

// ---------------------------------------------------------------------------------------------------------------
// Parser: lists of pipelines of simple commands. Control flow and function definitions are unsupported.
// ---------------------------------------------------------------------------------------------------------------

export interface SimpleCommand {
	assignments: Word[];
	words: Word[];
	redirects: Redirect[];
}
export type Pipeline = SimpleCommand[];

/** The rest of the segment is still an ordinary command (`then rm x`). */
const PREFIX_KEYWORDS = new Set(["if", "then", "else", "elif", "while", "until", "do"]);
const CLOSING_KEYWORDS = new Set(["fi", "done", "esac"]);
/** The rest of the segment is not an ordinary command (`for f in *`). */
const CLAUSE_KEYWORDS = new Set(["for", "select", "case", "function", "coproc", "[[", "]]"]);

function parse(tokens: readonly Token[], unsupported: Set<string>): Pipeline[] {
	const pipelines: Pipeline[] = [];
	let pipeline: SimpleCommand[] = [];
	let command: SimpleCommand = { assignments: [], words: [], redirects: [] };
	let expectCommand = false;
	let skipping = false;
	let parens = 0;
	let braces = 0;
	/** A `)` or `}` just closed a group, which may itself be piped or joined (`(cd x && ls) | wc -l`). */
	let closed = false;
	const empty = () => !command.words.length && !command.assignments.length && !command.redirects.length;
	const endCommand = () => {
		if (!empty()) pipeline.push(command);
		command = { assignments: [], words: [], redirects: [] };
	};
	const endPipeline = () => {
		endCommand();
		if (pipeline.length) pipelines.push(pipeline);
		pipeline = [];
	};
	for (const token of tokens) {
		const afterGroup = closed;
		closed = false;
		if (token.kind === "op") {
			if (token.op === ";" || token.op === "&") {
				if (expectCommand && empty()) unsupported.add("incomplete command list");
				endPipeline();
				expectCommand = false;
				skipping = false;
			} else if (token.op === "&&" || token.op === "||") {
				if (empty() && !pipeline.length && !afterGroup) unsupported.add("incomplete command list");
				endPipeline();
				expectCommand = true;
				skipping = false;
			} else if (token.op === "|") {
				if (empty() && !afterGroup) unsupported.add("incomplete pipeline");
				endCommand();
				expectCommand = true;
				skipping = false;
			} else if (token.op === "(") {
				if (empty() && !skipping) parens++;
				else unsupported.add("parenthesis outside command position");
				endCommand();
			} else {
				endCommand();
				if (parens === 0) unsupported.add("unbalanced parenthesis");
				else parens--;
				closed = true;
			}
			continue;
		}
		if (skipping) continue;
		if (token.kind === "redirect") {
			command.redirects.push(token.redirect);
			expectCommand = false;
			continue;
		}
		const word = token.word;
		if (!command.words.length && !command.assignments.length && !word.quoted && literal(word)) {
			const keyword = word.text;
			if (keyword === "{") {
				braces++;
				continue;
			}
			if (keyword === "}") {
				if (braces === 0) unsupported.add("unbalanced brace group");
				else braces--;
				endCommand();
				closed = true;
				continue;
			}
			// Negation and timing prefixes change neither the command nor its effect.
			if (keyword === "!" || keyword === "time") continue;
			if (PREFIX_KEYWORDS.has(keyword) || CLOSING_KEYWORDS.has(keyword)) {
				unsupported.add("shell control flow");
				continue;
			}
			if (CLAUSE_KEYWORDS.has(keyword)) {
				unsupported.add("shell control flow");
				skipping = true;
				continue;
			}
		}
		if (!command.words.length && word.assignment !== undefined) command.assignments.push(word);
		else command.words.push(word);
		expectCommand = false;
	}
	endPipeline();
	if (expectCommand) unsupported.add("incomplete command list");
	if (parens || braces) unsupported.add("unbalanced grouping");
	return pipelines;
}

/** Splits a command into pipelines of simple commands and names every unsupported construct it met. */
export function parseCommand(source: string): { pipelines: Pipeline[]; unsupported: Set<string> } {
	const unsupported = new Set<string>();
	const pipelines = parse(lex(source, unsupported), unsupported);
	return { pipelines, unsupported };
}
