import {
	dynamicWord,
	literal,
	parseCommand,
	type Redirect,
	type SimpleCommand,
	visible,
	type Word,
} from "./command-syntax.ts";
import { isProtectedPath } from "./policy.ts";

/**
 * Local command risk classifier for the interactive `weavra` conversation's shell tool (#5 candidate 1).
 *
 * Where shell commands run in this product, and what this module covers:
 * - Weavra workflow workers have no shell tool. Their tools are the runtime_* file tools, check requests and
 *   submissions (agent-tools.ts); their sessions receive no built-in or extension tools (agent-runner.ts); Policy
 *   denies bash/sh/shell/exec tool ids (policy.ts). This classifier is not used there and does not protect them.
 * - Registered checks are trusted Host configuration executed without a shell (verification.ts,
 *   evaluateRegisteredCheck, process-runner.ts). They are not classified here either.
 * - The parent conversation launched by `weavra` has Pi's built-in `bash` tool. command-guard.ts classifies those
 *   commands with this module before they run.
 *
 * Pure and deterministic: it reads only the command text, never the filesystem, processes, network or a model, and
 * assumes bash/POSIX sh syntax (Pi runs `bash -c`). It judges what the text asks for, not configuration the programs
 * read (Git hooks and config, package scripts, aliases, PATH), so it explains; it is not a sandbox. A category is
 * never a permission, and `reversible` names a local edit of named project files, not a rollback guarantee.
 * Anything it cannot parse completely or does not recognize is `unknown`.
 */
export type CommandRiskCategory = "read_only" | "reversible" | "destructive" | "unknown";

export interface CommandRiskAssessment {
	category: CommandRiskCategory;
	/** Fixed-template explanations. They name recognized programs only, never arguments, paths or other raw text. */
	reasons: string[];
	/** Program names in order of appearance, from the classifier's own vocabulary (others are `(other)`). */
	programs: string[];
}

/** Longer commands are `unknown` without being parsed. */
export const MAX_CLASSIFIED_COMMAND_LENGTH = 65_536;
const MAX_REASONS = 8;
const MAX_PROGRAMS = 16;
/** Wrappers, `find -exec`, `xargs` and `sh -c` nest; deeper nesting is `unknown`. */
const MAX_NESTING = 6;

/** Space-separated word list. */
const words = (list: string): string[] => list.split(" ");

const SEVERITY: Record<CommandRiskCategory, number> = { read_only: 0, reversible: 1, unknown: 2, destructive: 3 };

interface Reason {
	text: string;
	severity: number;
}
interface Verdict {
	category: CommandRiskCategory;
	reasons: readonly Reason[];
}

function verdict(category: CommandRiskCategory, ...texts: string[]): Verdict {
	return { category, reasons: texts.map((text) => ({ text, severity: SEVERITY[category] })) };
}

/** The most severe category wins; reasons keep their own severity so the worst explanations come first. */
function combine(verdicts: ReadonlyArray<Verdict | undefined>): Verdict {
	let category: CommandRiskCategory = "read_only";
	const reasons = new Map<string, number>();
	for (const item of verdicts) {
		if (!item) continue;
		if (SEVERITY[item.category] > SEVERITY[category]) category = item.category;
		for (const reason of item.reasons)
			reasons.set(reason.text, Math.max(reasons.get(reason.text) ?? 0, reason.severity));
	}
	return {
		category,
		reasons: [...reasons].map(([text, severity]) => ({ text, severity })).sort((a, b) => b.severity - a.severity),
	};
}

// ---------------------------------------------------------------------------------------------------------------
// Rules. Every rule is a closed list: anything not listed is `unknown`.
// ---------------------------------------------------------------------------------------------------------------

interface State {
	/** False after `cd` to anywhere that is not a literal relative path inside the project. */
	insideProject: boolean;
}

/** Commands that only read or print, whatever their arguments: no option writes files, runs programs or changes state. */
const READ_ONLY_PROGRAMS = new Set(
	words(
		"cat head tail wc ls pwd echo printf true false : exit basename dirname realpath readlink whoami " +
			"id groups uname nproc printenv locale cut tr nl od hexdump strings rev fold column paste join " +
			"comm expand unexpand tac seq sleep test [ md5 md5sum sha1sum sha224sum sha256sum sha384sum " +
			"sha512sum shasum cksum b2sum stat du df diff cmp grep egrep fgrep jq which type whereis ps pgrep " +
			"uptime who lsof sw_vers vm_stat free",
	),
);
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "yash", "fish", "csh", "tcsh"]);
/** Shells whose `-c` text uses the same syntax, so it can be classified. */
const POSIX_SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "yash"]);
const INTERPRETERS = new Set(
	words(
		"python python2 python3 perl ruby node nodejs deno bun php lua osascript awk gawk mawk nawk " +
			"Rscript tclsh expect pwsh powershell",
	),
);
/**
 * Exact flags that only print a version and exit, per interpreter (package managers may run project-pinned code).
 * Not `python -v` or `ruby -v`: those are verbose modes that go on to run a script from standard input.
 */
const VERSION_PROBES = new Map<string, readonly string[]>([
	["node", ["--version", "-v"]],
	["nodejs", ["--version", "-v"]],
	["python", ["--version", "-V"]],
	["python3", ["--version", "-V"]],
	["ruby", ["--version"]],
	["perl", ["--version", "-v"]],
	["php", ["--version", "-v"]],
]);
const DOWNLOADERS = new Set(["curl", "wget", "fetch", "http", "https", "aria2c"]);
const PROJECT_RUNNERS = new Set(
	words(
		"npm npx pnpm pnpx yarn bunx cargo go make gmake cmake ninja gradle gradlew mvn mvnw pip pip3 " +
			"pipx poetry uv uvx pytest tox nox rake bundle gem composer dotnet swift xcodebuild tsc vitest " +
			"jest mocha eslint prettier biome turbo nx",
	),
);
const COPIERS = new Set(["cp", "mv", "ln", "install", "scp", "rsync"]);
const SIGNALERS = new Set(["kill", "killall", "pkill"]);
const CODE_LOADERS = new Set(["eval", "source", ".", "alias", "unalias", "trap"]);
const DISK_TOOLS = new Set(words("mke2fs mkswap wipefs fdisk sfdisk gdisk sgdisk parted cfdisk blkdiscard"));
/** `mkfs`, `mkfs.ext4`, `newfs_apfs` and similar. */
const DISK_FORMATTER = /^(?:mkfs|newfs)(?:[._][A-Za-z0-9]{1,12})?$/;
const POWER_TOOLS = new Set(["reboot", "shutdown", "halt", "poweroff"]);
/** Absolute program paths in these directories are classified by their name; any other path is `unknown`. */
const SYSTEM_DIRECTORIES = ["/bin/", "/usr/bin/", "/sbin/", "/usr/sbin/", "/usr/local/bin/", "/opt/homebrew/bin/"];
/** Locale/display variables that cannot change which program runs or what it touches. */
const HARMLESS_VARIABLE =
	/^(?:LANG|LANGUAGE|LC_[A-Z]+|TZ|NO_COLOR|FORCE_COLOR|CLICOLOR|CLICOLOR_FORCE|TERM|COLUMNS|LINES|CI)$/;
const PAGER_VARIABLE = /^(?:GIT_PAGER|PAGER|MANPAGER)$/;
const STREAM_SINK = /^\/dev\/(?:null|stdout|stderr|tty|fd\/\d+)$/;
/** Whole disks and partitions (Linux and macOS names). */
const DISK_DEVICE = /^\/dev\/(?:r?disk\d|[shv]d[a-z]|xvd[a-z]|nvme\d|mmcblk\d|md\d|dm-\d)/;

const ENVIRONMENT_REASON = "sets environment variables that can change which program runs or how it behaves";
const PROTECTED_REASON =
	"writes a path the worker Policy protects (Runtime state, VCS internals, credentials or configuration)";

const tick = (name: string): string => `\`${name}\``;
const WRAPPERS = new Set(["sudo", "doas", "env", "nice", "nohup", "timeout", "exec", "command", "builtin", "xargs"]);
const DESTRUCTIVE_PROGRAMS = new Set(["unlink", "shred", "srm", "truncate", "dd", "diskutil", "crontab"]);
/**
 * Reasons and records name programs only from this classifier's own vocabulary; any other name is `(other)`, so no
 * raw command text (which could be a secret) is copied.
 */
function knownName(name: string): string {
	const known =
		[READ_ONLY_PROGRAMS, SHELLS, INTERPRETERS, DOWNLOADERS, PROJECT_RUNNERS, COPIERS, SIGNALERS, CODE_LOADERS]
			.concat([DISK_TOOLS, POWER_TOOLS, WRAPPERS, DESTRUCTIVE_PROGRAMS])
			.some((set) => set.has(name)) ||
		SPECIAL.has(name) ||
		DISK_FORMATTER.test(name);
	return known ? name : "(other)";
}
const readOnly = (name: string): Verdict => verdict("read_only", `${tick(name)}: read-only inspection`);
const hiddenArguments = (name: string): Verdict =>
	verdict("unknown", `${tick(name)} arguments include expansions or globs that could add options`);
const unclassifiedOptions = (name: string): Verdict =>
	verdict("unknown", `${tick(name)} uses options that are not classified`);

function harmlessAssignment(word: Word): boolean {
	const name = word.assignment ?? "";
	if (HARMLESS_VARIABLE.test(name)) return true;
	return PAGER_VARIABLE.test(name) && !word.dynamic && /^[A-Za-z_]+\+?=(?:cat)?$/.test(word.text);
}

/**
 * A write of one named path: `reversible` only for a literal (or option-safe glob) relative path inside the project
 * that the worker Policy does not protect. `undefined` for an empty name, which no program can open.
 */
function writeTarget(target: Word, state: State, reason: string, allowGlob: boolean): Verdict | undefined {
	if (target.dynamic || target.tilde || (target.glob && !allowGlob))
		return verdict("unknown", "writes a path that is not a literal project path");
	const text = target.text;
	if (text === "") return undefined;
	if (!state.insideProject) return verdict("unknown", "writes after changing to a directory outside the project");
	if (text.startsWith("/"))
		return DISK_DEVICE.test(text)
			? verdict("destructive", "writes to a disk device")
			: verdict("unknown", "writes outside the project (absolute path)");
	const segments = text.split("/");
	if (segments.includes("..")) return verdict("unknown", "writes outside the project (`..` path)");
	if (target.glob && (!visible(target) || segments.some((segment) => /^\.[*?[]/.test(segment))))
		return verdict("unknown", "writes through a glob that may match hidden or option-like names");
	const relative = segments.filter((segment) => segment !== "" && segment !== ".").join("/");
	if (relative && isProtectedPath(relative)) return verdict("unknown", PROTECTED_REASON);
	return verdict("reversible", reason);
}

function redirectVerdict(redirect: Redirect, state: State): Verdict | undefined {
	const { op, target } = redirect;
	if (op === "<" || op === "<<" || op === "<<-" || op === "<<<" || op === "<&") return undefined;
	if (op === "<>") return verdict("unknown", "opens a file for reading and writing");
	if (!target) return verdict("unknown", "redirection without a target");
	// `>&2`, `2>&1` and `>&-` duplicate or close descriptors; `>& file` writes like `&>`.
	if (op === ">&" && literal(target) && /^(?:\d+|-)$/.test(target.text)) return undefined;
	if (literal(target) && STREAM_SINK.test(target.text)) return undefined;
	return writeTarget(target, state, "output redirection writes a project file", false);
}

type Classifier = (args: Word[], state: State, depth: number, programs: string[]) => Verdict;

interface Resolved {
	verdict: Verdict;
	/** Innermost program after wrappers, for pipeline rules. */
	program: string;
}

function programName(word: Word): string | undefined {
	if (!literal(word) || word.text === "") return undefined;
	const text = word.text;
	if (!text.includes("/")) return text;
	for (const directory of SYSTEM_DIRECTORIES)
		if (text.startsWith(directory) && !text.slice(directory.length).includes("/"))
			return text.slice(directory.length);
	return undefined;
}

function classifyWords(words: Word[], state: State, depth: number, programs: string[]): Resolved {
	const name = programName(words[0]);
	if (name === undefined)
		return { verdict: verdict("unknown", "runs a program by path or by a non-literal name"), program: "" };
	if (programs.length < MAX_PROGRAMS) programs.push(knownName(name));
	if (depth > MAX_NESTING)
		return { verdict: verdict("unknown", "nested commands are too deep to classify"), program: name };
	const args = words.slice(1);
	const unwrapped = unwrap(name, args, state);
	if (unwrapped) {
		if ("verdict" in unwrapped) return { verdict: unwrapped.verdict, program: name };
		if (!args.slice(0, unwrapped.start).every(visible)) return { verdict: hiddenArguments(name), program: name };
		const inner = classifyWords(
			unwrapped.inner ?? args.slice(unwrapped.start),
			unwrapped.state ?? state,
			depth + 1,
			programs,
		);
		return { verdict: combine([unwrapped.extra, inner.verdict]), program: inner.program };
	}
	const special = SPECIAL.get(name);
	if (special) return { verdict: special(args, state, depth, programs), program: name };
	return { verdict: simpleProgram(name, args), program: name };
}

function simpleProgram(name: string, args: Word[]): Verdict {
	const label = tick(knownName(name));
	if (READ_ONLY_PROGRAMS.has(name)) return readOnly(name);
	if (name === "unlink") return verdict("destructive", "`unlink`: deletes a file");
	if (name === "shred" || name === "srm") return verdict("destructive", `${label}: irrecoverably overwrites files`);
	if (name === "truncate") return verdict("destructive", "`truncate`: cuts file contents");
	if (name === "dd") return verdict("destructive", "`dd`: writes raw data and can overwrite files or disks");
	if (DISK_TOOLS.has(name) || DISK_FORMATTER.test(name))
		return verdict("destructive", `${label}: formats, partitions or erases disks`);
	if (POWER_TOOLS.has(name)) return verdict("destructive", `${label}: stops or restarts the machine`);
	if (name === "diskutil")
		return args.some((arg) => /^(?:erase|zero|random|secure|partition|reformat|delete|split|merge)/i.test(arg.text))
			? verdict("destructive", "`diskutil`: formats, partitions or erases disks")
			: verdict("unknown", "`diskutil` manages disks and is not classified");
	if (name === "crontab")
		return args.some((arg) => /^-[A-Za-z]*r/.test(arg.text))
			? verdict("destructive", "`crontab -r`: deletes the crontab")
			: verdict("unknown", "`crontab` changes scheduled jobs");
	if (name === "rsync" && args.some((arg) => /^--(?:delete|remove-source-files)/.test(arg.text)))
		return verdict("destructive", "`rsync --delete`: deletes files at the destination");
	if (args.length === 1 && literal(args[0]) && VERSION_PROBES.get(name)?.includes(args[0].text))
		return verdict("read_only", `${label}: prints its version`);
	if (PROJECT_RUNNERS.has(name))
		return verdict("unknown", `${label} runs project or package code, which is not classified`);
	if (INTERPRETERS.has(name)) return verdict("unknown", `${label} runs code that is not classified`);
	if (DOWNLOADERS.has(name)) return verdict("unknown", `${label} accesses the network and may write files`);
	if (COPIERS.has(name)) return verdict("unknown", `${label} copies or moves files and can overwrite existing ones`);
	if (SIGNALERS.has(name)) return verdict("unknown", `${label} signals or stops processes`);
	if (CODE_LOADERS.has(name)) return verdict("unknown", `${label} runs code from a string or a file`);
	return verdict("unknown", "the program is not a recognized read-only command or reversible local edit");
}

// ---------------------------------------------------------------------------------------------------------------
// Wrappers: the wrapped command is classified; the wrapper may add its own reason.
// ---------------------------------------------------------------------------------------------------------------

/**
 * `start`: index of the wrapped command in `args`. Every word before it (the wrapper's own options and values) must
 * be visible, because an unquoted expansion there could split into a different command.
 */
type Unwrapped = { start: number; inner?: Word[]; extra?: Verdict; state?: State } | { verdict: Verdict };

function unwrap(name: string, args: Word[], state: State): Unwrapped | undefined {
	switch (name) {
		case "sudo":
		case "doas": {
			const elevated = verdict("unknown", `${tick(name)} runs a command with elevated privileges`);
			for (let k = 0; k < args.length; k++) {
				const text = args[k].text;
				if (text === "--") return args.length > k + 1 ? { start: k + 1, extra: elevated } : { verdict: elevated };
				if (!text.startsWith("-")) return { start: k, extra: elevated };
				if (/^-[aCDghpRrTtUu]$/.test(text)) k++;
				else if (
					!/^-[AbEHnPS]+$/.test(text) &&
					!/^--(?:user|group|prompt|close-from|host|chdir|role|type|other-user|command-timeout|preserve-env)(?:=.*)?$/.test(
						text,
					)
				)
					return { verdict: elevated };
			}
			return { verdict: elevated };
		}
		case "env": {
			let k = 0;
			let moved = false;
			for (; k < args.length; k++) {
				const text = args[k].text;
				if (text === "--") {
					k++;
					break;
				}
				if (["-i", "-0", "-", "--ignore-environment", "--null"].includes(text)) continue;
				if (text === "-u" || text === "--unset") k++;
				else if (/^-u./.test(text) || text.startsWith("--unset=")) continue;
				else if (text === "-C" || text === "--chdir") {
					moved = true;
					k++;
				} else if (/^-C./.test(text) || text.startsWith("--chdir=")) moved = true;
				else if (text.startsWith("-")) return { verdict: unclassifiedOptions("env") };
				else break;
			}
			let environment: Verdict | undefined;
			while (k < args.length && args[k].assignment !== undefined) {
				if (!harmlessAssignment(args[k])) environment = verdict("unknown", ENVIRONMENT_REASON);
				k++;
			}
			if (k >= args.length)
				return args.every(visible)
					? { verdict: verdict("read_only", "`env`: prints the environment") }
					: { verdict: hiddenArguments("env") };
			return { start: k, extra: environment, state: moved ? { insideProject: false } : state };
		}
		case "nice": {
			let k = 0;
			while (k < args.length && args[k].text.startsWith("-")) {
				const text = args[k].text;
				if (text === "--") {
					k++;
					break;
				}
				if (text === "-n" || text === "--adjustment") k += 2;
				else if (/^-(?:n.+|\d+)$/.test(text) || text.startsWith("--adjustment=")) k++;
				else return { verdict: unclassifiedOptions("nice") };
			}
			return wrapped("nice", args, k);
		}
		case "nohup":
			return wrapped("nohup", args, args[0]?.text === "--" ? 1 : 0);
		case "timeout": {
			let k = 0;
			while (k < args.length && args[k].text.startsWith("-")) {
				const text = args[k].text;
				if (text === "-s" || text === "-k" || text === "--signal" || text === "--kill-after") k += 2;
				else if (/^-[sk]./.test(text) || /^--(?:signal|kill-after)=/.test(text)) k++;
				else if (["--preserve-status", "--foreground", "-v", "--verbose", "--"].includes(text)) k++;
				else return { verdict: unclassifiedOptions("timeout") };
			}
			// The duration comes first, then the command.
			return wrapped("timeout", args, k + 1);
		}
		case "exec": {
			let k = 0;
			while (k < args.length && /^-[cl]+$/.test(args[k].text)) k++;
			if (args[k]?.text === "-a") k += 2;
			return args.length > k
				? { start: k }
				: { verdict: verdict("unknown", "`exec` without a command changes the shell's file descriptors") };
		}
		case "command":
			if (args[0] && ["-v", "-V"].includes(args[0].text))
				return { verdict: verdict("read_only", "`command -v`: looks up a command") };
			return wrapped("command", args, args[0]?.text === "-p" ? 1 : 0);
		case "builtin":
			return wrapped("builtin", args, 0);
		case "xargs":
			return xargs(args);
		default:
			return undefined;
	}
}

function wrapped(name: string, args: Word[], start: number): Unwrapped {
	return args.length > start
		? { start }
		: { verdict: verdict("unknown", `${tick(name)} without a command is not classified`) };
}

/** `xargs` appends words it reads from input, so the wrapped command also receives arguments that are not visible. */
function xargs(args: Word[]): Unwrapped {
	let replace: string | undefined;
	let k = 0;
	for (; k < args.length; k++) {
		const text = args[k].text;
		if (!text.startsWith("-")) break;
		if (text === "--") {
			k++;
			break;
		}
		if (
			/^-[0prtxo]+$/.test(text) ||
			/^--(?:null|interactive|no-run-if-empty|verbose|exit|open-tty|show-limits)$/.test(text)
		)
			continue;
		if (text === "-I") replace = args[++k]?.text;
		else if (/^-I./.test(text)) replace = text.slice(2);
		else if (text === "-i" || text === "--replace") replace = "{}";
		else if (/^-i./.test(text)) replace = text.slice(2);
		else if (text.startsWith("--replace=")) replace = text.slice(10);
		else if (/^-[adELnPs]$/.test(text)) k++;
		else if (/^-[adeELlnPs]./.test(text) || /^-[el]$/.test(text)) continue;
		else if (/^--(?:arg-file|delimiter|eof|max-lines|max-args|max-procs|max-chars|process-slot-var)=/.test(text))
			continue;
		else return { verdict: unclassifiedOptions("xargs") };
	}
	const command = args
		.slice(k)
		.map((word) => (replace !== undefined && word.text.includes(replace) ? { ...word, dynamic: true } : word));
	const inner = command.length ? command : [{ ...dynamicWord(), text: "echo", dynamic: false }];
	return { start: k, inner: replace !== undefined ? inner : [...inner, dynamicWord()] };
}

// ---------------------------------------------------------------------------------------------------------------
// Commands whose effect depends on their arguments.
// ---------------------------------------------------------------------------------------------------------------

function changeDirectory(name: string, args: Word[], state: State): Verdict {
	const operands = args.filter((arg) => !/^-[LPe@]+$/.test(arg.text) || !literal(arg));
	const target = operands[0];
	const inside =
		name !== "popd" &&
		target !== undefined &&
		literal(target) &&
		target.text !== "-" &&
		!target.text.startsWith("/") &&
		!/^[+-]\d/.test(target.text) &&
		!target.text.split("/").includes("..");
	if (!inside) state.insideProject = false;
	return verdict("read_only", `${tick(name)}: changes the working directory`);
}

/** Writes each operand; option words must be listed, and option values are checked as paths too (conservative). */
function writeCommand(name: string, args: Word[], state: State, reason: string, options: RegExp): Verdict {
	if (!args.every(visible)) return hiddenArguments(name);
	const targets: Word[] = [];
	let parsing = true;
	for (const arg of args) {
		if (parsing && arg.text === "--") parsing = false;
		else if (parsing && arg.text.startsWith("-") && arg.text !== "-") {
			if (!options.test(arg.text)) return unclassifiedOptions(name);
		} else targets.push(arg);
	}
	if (!targets.length)
		return name === "tee"
			? verdict("read_only", "`tee` without files: copies input to output")
			: unclassifiedOptions(name);
	const verdicts = targets.map((target) => writeTarget(target, state, reason, true));
	return verdicts.some(Boolean) ? combine(verdicts) : verdict("unknown", `${tick(name)} has no usable target`);
}

function permissions(name: "chmod" | "chown" | "chgrp", args: Word[], state: State): Verdict {
	const optionLetters = name === "chmod" ? /^-[cfvRhHLPENCiI]+$/ : /^-[cfvRhHLPxn]+$/;
	let recursive = false;
	let reference = false;
	let unclassified = false;
	const operands: Word[] = [];
	let parsing = true;
	for (const arg of args) {
		const text = arg.text;
		if (parsing && literal(arg) && text === "--") parsing = false;
		else if (parsing && literal(arg) && optionLetters.test(text)) recursive ||= text.includes("R");
		else if (parsing && literal(arg) && text.startsWith("--")) {
			if (text === "--recursive") recursive = true;
			else if (text.startsWith("--reference")) reference = true;
			else if (!/^--(?:changes|silent|quiet|verbose|preserve-root|dereference|no-dereference|from=.*)$/.test(text))
				unclassified = true;
		} else operands.push(arg);
	}
	const targets = reference ? operands : operands.slice(1);
	const broad = (target: Word) =>
		!literal(target) ||
		["/", ".", "..", "./", "../", "*"].includes(target.text) ||
		target.text.startsWith("/") ||
		target.text.split("/").includes("..");
	if (recursive && targets.some(broad))
		return verdict(
			"destructive",
			`${tick(`${name} -R`)} on a broad or non-literal path: recursively changes permissions or ownership`,
		);
	if (!args.every(visible)) return hiddenArguments(name);
	if (unclassified) return unclassifiedOptions(name);
	if (recursive)
		return verdict(
			"unknown",
			`${tick(`${name} -R`)}: recursive permission or ownership changes cannot be reversed exactly`,
		);
	if (name !== "chmod") return verdict("unknown", `${tick(name)} changes file ownership`);
	if (!targets.length) return unclassifiedOptions(name);
	const verdicts = targets.map((target) =>
		writeTarget(target, state, "`chmod`: changes the mode of named project files", true),
	);
	return verdicts.some(Boolean) ? combine(verdicts) : unclassifiedOptions(name);
}

function removal(args: Word[]): Verdict {
	const recursive = args.some((arg) => /^-[A-Za-z]*[rR]/.test(arg.text) || arg.text === "--recursive");
	return recursive
		? verdict("destructive", "`rm -r`: deletes files and directories recursively")
		: verdict("destructive", "`rm`: deletes files");
}

function shellCommand(name: string, args: Word[], depth: number, programs: string[]): Verdict {
	const script = verdict("unknown", `${tick(name)} runs a shell script that is not classified`);
	if (!POSIX_SHELLS.has(name)) return script;
	let dashC = false;
	for (let k = 0; k < args.length; k++) {
		const word = args[k];
		const text = word.text;
		if (!visible(word)) return hiddenArguments(name);
		if (/^[-+][oO]$/.test(text)) k++;
		else if (text.startsWith("--")) continue;
		else if (/^[-+][A-Za-z]+$/.test(text)) dashC ||= text.startsWith("-") && text.includes("c");
		else {
			if (!dashC) return script;
			if (!literal(word)) return verdict("unknown", `${tick(`${name} -c`)} command text is not a literal`);
			return combine([
				verdict("unknown", `${tick(`${name} -c`)} runs a nested shell`),
				analyze(text, depth + 1, programs),
			]);
		}
	}
	return script;
}

function setOptions(args: Word[]): Verdict {
	const names = /^(?:pipefail|errexit|nounset|xtrace|verbose|noglob|noclobber)$/;
	for (let k = 0; k < args.length; k++) {
		const text = args[k].text;
		if (!literal(args[k])) return hiddenArguments("set");
		if (text === "--") return verdict("read_only", "`set --`: sets positional parameters");
		if (/^[-+][euxvfC]*o$/.test(text)) {
			if (!names.test(args[++k]?.text ?? "")) return unclassifiedOptions("set");
		} else if (!/^[-+][euxvfC]+$/.test(text)) return unclassifiedOptions("set");
	}
	return verdict("read_only", "`set`: shell options only");
}

function exportCommand(args: Word[]): Verdict {
	const harmless = args.every(
		(arg) =>
			arg.text === "-p" ||
			(arg.assignment !== undefined ? harmlessAssignment(arg) : literal(arg) && HARMLESS_VARIABLE.test(arg.text)),
	);
	return harmless
		? verdict("read_only", "`export`: exports locale or display variables")
		: verdict("unknown", ENVIRONMENT_REASON);
}

function sortCommand(args: Word[]): Verdict {
	if (!args.every(visible)) return hiddenArguments("sort");
	for (const arg of args) {
		if (arg.text === "--") break;
		// `-o`/`--output` writes a file and `--compress-program` runs one; abbreviations and clusters count too.
		if (/^--[oc]/.test(arg.text) || /^-[A-Za-z]*o/.test(arg.text))
			return verdict("unknown", "`sort` with an output file or helper program is not classified");
	}
	return readOnly("sort");
}

/** Plain-object lookups would reach `Object.prototype` (`toString`, `constructor`), so this is a Map. */
const SPECIAL = new Map<string, Classifier>([
	["git", (args) => git(args)],
	["find", (args, state, depth, programs) => find(args, state, depth, programs)],
	["sed", (args, state) => sed(args, state)],
	["rm", (args) => removal(args)],
	["cd", (args, state) => changeDirectory("cd", args, state)],
	["pushd", (args, state) => changeDirectory("pushd", args, state)],
	["popd", (args, state) => changeDirectory("popd", args, state)],
	["set", (args) => setOptions(args)],
	["export", (args) => exportCommand(args)],
	["sort", (args) => sortCommand(args)],
	[
		"uniq",
		(args) =>
			!args.every(visible)
				? hiddenArguments("uniq")
				: args.filter((arg) => !arg.text.startsWith("-")).length > 1
					? verdict("unknown", "`uniq` with an output operand writes a file")
					: readOnly("uniq"),
	],
	[
		"tree",
		(args) =>
			!args.every(visible)
				? hiddenArguments("tree")
				: args.some((arg) => /^-[A-Za-z]*[oR]/.test(arg.text) || /^--o/.test(arg.text))
					? verdict("unknown", "`tree -o/-R` writes output files")
					: readOnly("tree"),
	],
	[
		"file",
		(args) =>
			!args.every(visible)
				? hiddenArguments("file")
				: args.some((arg) => /^-[A-Za-z]*C/.test(arg.text) || /^--c/.test(arg.text))
					? verdict("unknown", "`file -C` writes a compiled magic file")
					: readOnly("file"),
	],
	[
		"date",
		(args) =>
			args.every(
				(arg) =>
					literal(arg) &&
					(arg.text.startsWith("+") ||
						/^(?:-u|-R|--utc|--universal|-I\w*|--iso-8601(?:=\w+)?|--rfc-(?:email|3339=\w+))$/.test(arg.text)),
			)
				? readOnly("date")
				: verdict("unknown", "`date` with these arguments may set the clock"),
	],
	[
		"base64",
		(args) =>
			!args.every(visible)
				? hiddenArguments("base64")
				: args.some((arg) => /^-[A-Za-z]*o/.test(arg.text) || /^--o/.test(arg.text))
					? verdict("unknown", "`base64 -o` writes a file")
					: readOnly("base64"),
	],
	[
		"rg",
		(args) =>
			!args.every(visible)
				? hiddenArguments("rg")
				: args.some((arg) => /^--(?:pre|hostname-bin)(?:=|$)/.test(arg.text))
					? verdict("unknown", "`rg --pre/--hostname-bin` runs another program")
					: readOnly("rg"),
	],
	[
		"mkdir",
		(args, state) =>
			writeCommand(
				"mkdir",
				args,
				state,
				"`mkdir`: creates directories in the project",
				/^(?:-[pvm]+|-m.+|--(?:parents|verbose|mode(?:=.*)?))$/,
			),
	],
	[
		"touch",
		(args, state) =>
			writeCommand(
				"touch",
				args,
				state,
				"`touch`: creates project files or updates their timestamps",
				/^(?:-[acmhf]+|-[dtr].*|--(?:no-create|no-dereference|date|reference|time)(?:=.*)?)$/,
			),
	],
	[
		"tee",
		(args, state) =>
			writeCommand(
				"tee",
				args,
				state,
				"`tee`: writes project files",
				/^(?:-[aip]+|--(?:append|ignore-interrupts|output-error(?:=.*)?))$/,
			),
	],
	[
		"rmdir",
		(args, state) =>
			writeCommand(
				"rmdir",
				args,
				state,
				"`rmdir`: removes empty directories only",
				/^(?:-[pv]+|--(?:parents|verbose|ignore-fail-on-non-empty))$/,
			),
	],
	["chmod", (args, state) => permissions("chmod", args, state)],
	["chown", (args, state) => permissions("chown", args, state)],
	["chgrp", (args, state) => permissions("chgrp", args, state)],
]);
for (const shell of SHELLS)
	SPECIAL.set(shell, (args, _state, depth, programs) => shellCommand(shell, args, depth, programs));

// ---------------------------------------------------------------------------------------------------------------
// find
// ---------------------------------------------------------------------------------------------------------------

const FIND_TESTS_WITHOUT_VALUE = new Set(
	words(
		"-print -print0 -ls -prune -quit -true -false -empty -depth -d -xdev -mount -follow -nouser " +
			"-nogroup -readable -writable -executable -daystart -noleaf -ignore_readdir_race " +
			"-noignore_readdir_race -warn -nowarn -not -a -and -o -or ! ( ) ,",
	),
);
const FIND_TESTS_WITH_VALUE = new Set(
	words(
		"-name -iname -path -ipath -wholename -iwholename -regex -iregex -lname -ilname -type -xtype " +
			"-size -mtime -mmin -atime -amin -ctime -cmin -Btime -Bmin -newer -anewer -cnewer -Bnewer " +
			"-maxdepth -mindepth -perm -user -group -uid -gid -links -inum -samefile -used -fstype -regextype " +
			"-printf -context -flags -files0-from",
	),
);

function find(args: Word[], state: State, depth: number, programs: string[]): Verdict {
	// A starting point from a glob or expansion could be read as `-delete` or `-exec`.
	if (!args.every(visible))
		return combine([
			hiddenArguments("find"),
			has(args, "-delete") ? verdict("destructive", "`find -delete`: deletes matching files") : undefined,
		]);
	let k = 0;
	while (k < args.length && /^-(?:[HLPEXsx]|O\d)$/.test(args[k].text)) k++;
	while (k < args.length && !/^[-!(),]/.test(args[k].text)) k++;
	const verdicts: Verdict[] = [readOnly("find")];
	for (; k < args.length; k++) {
		const text = args[k].text;
		if (text === "-delete") verdicts.push(verdict("destructive", "`find -delete`: deletes matching files"));
		else if (["-exec", "-execdir", "-ok", "-okdir"].includes(text)) {
			let end = k + 1;
			while (end < args.length && args[end].text !== ";" && args[end].text !== "+") end++;
			if (end >= args.length || end === k + 1)
				return combine([...verdicts, verdict("unknown", "`find -exec` without a complete command")]);
			// `{}` becomes each found path: an argument whose value is not visible.
			const inner = args
				.slice(k + 1, end)
				.map((word) => (word.text.includes("{}") ? { ...word, dynamic: true } : word));
			const innerState = text.endsWith("dir") ? { insideProject: false } : { ...state };
			verdicts.push(classifyWords(inner, innerState, depth + 1, programs).verdict);
			k = end;
		} else if (["-fprint", "-fprint0", "-fls", "-fprintf"].includes(text)) {
			verdicts.push(verdict("unknown", "`find -fprint/-fls` writes result files"));
			k += text === "-fprintf" ? 2 : 1;
		} else if (FIND_TESTS_WITH_VALUE.has(text) || /^-newer[aBcmt][aBcmt]$/.test(text)) k++;
		else if (!FIND_TESTS_WITHOUT_VALUE.has(text))
			return combine([...verdicts, verdict("unknown", "`find` expression is not classified")]);
	}
	return combine(verdicts);
}

// ---------------------------------------------------------------------------------------------------------------
// sed: `sed -i` is an in-place edit; the script is checked for commands that run programs or touch other files.
// GNU and BSD sed read the same argv differently, so every reading must be safe.
// ---------------------------------------------------------------------------------------------------------------

type SedScript = "safe" | "unsafe" | "unsupported" | "invalid";
/** Commands of GNU or BSD sed. Any other command character is rejected by both before anything runs. */
const SED_COMMANDS = new Set("{}=:#abcdDeFgGhHilLnNpPqQrRstTvwWxyz");

/**
 * `invalid` is returned only where every sed rejects the script and every earlier command was safe, so the script
 * fails before it could open a file. `unsupported` marks valid-looking syntax this parser does not model.
 */
function sedScript(script: string, bracketAware: boolean): SedScript {
	const n = script.length;
	const at = (index: number): string => script.charAt(index);
	let i = 0;
	let depth = 0;
	const blanks = () => {
		while (at(i) === " " || at(i) === "\t") i++;
	};
	const digits = () => {
		while (/[0-9]/.test(at(i))) i++;
	};
	const bracket = (): boolean => {
		i++;
		if (at(i) === "^") i++;
		if (at(i) === "]") i++;
		while (i < n) {
			const c = at(i);
			if (c === "\n") return false;
			if (c === "[" && [":", "=", "."].includes(at(i + 1))) {
				const close = script.indexOf(`${at(i + 1)}]`, i + 2);
				if (close < 0) return false;
				i = close + 2;
			} else if (c === "]") {
				i++;
				return true;
			} else i++;
		}
		return false;
	};
	/** Reads past the unescaped `delimiter`; false at the end of the script or an unescaped newline. */
	const delimited = (delimiter: string, regex: boolean): boolean => {
		while (i < n) {
			const c = at(i);
			if (c === "\\") i += 2;
			else if (c === "\n") return false;
			else if (c === delimiter) {
				i++;
				return true;
			} else if (regex && bracketAware && c === "[") {
				if (!bracket()) return false;
			} else i++;
		}
		return false;
	};
	const address = (): boolean | "none" => {
		const c = at(i);
		if (/[0-9]/.test(c)) {
			digits();
			if (at(i) === "~") {
				i++;
				digits();
			}
			return true;
		}
		if (c === "$") {
			i++;
			return true;
		}
		if (c !== "/" && c !== "\\") return "none";
		let delimiter = "/";
		if (c === "\\") {
			delimiter = at(i + 1);
			if (delimiter === "" || delimiter === "\n" || delimiter === "\\") return false;
			i++;
		}
		i++;
		if (!delimited(delimiter, true)) return false;
		while (at(i) === "I" || at(i) === "M") i++;
		return true;
	};
	while (i < n) {
		const lead = at(i);
		if (lead === " " || lead === "\t" || lead === "\n" || lead === ";") {
			i++;
			continue;
		}
		const first = address();
		if (first === false) return "invalid";
		if (first === true) {
			blanks();
			if (at(i) === ",") {
				i++;
				blanks();
				if (at(i) === "+" || at(i) === "~") {
					i++;
					if (!/[0-9]/.test(at(i))) return "invalid";
					digits();
				} else if (address() !== true) return "invalid";
			}
		}
		blanks();
		while (at(i) === "!") {
			i++;
			blanks();
		}
		const command = at(i);
		if (command === "" || !SED_COMMANDS.has(command)) return "invalid";
		i++;
		if (command === "e" || command === "r" || command === "R" || command === "w" || command === "W") return "unsafe";
		if (command === "v") return "unsupported";
		if (command === "{") {
			depth++;
			continue;
		}
		if (command === "#") {
			if (first === true) return "invalid";
			while (i < n && at(i) !== "\n") i++;
			continue;
		}
		if (command === ":" || command === "b" || command === "t" || command === "T") {
			if (command === ":" && first === true) return "invalid";
			// Labels end at `;` or a newline here, which can only ever check more text. Labels whose end differs
			// between seds (blanks, `}`) are not modeled.
			blanks();
			const start = i;
			while (i < n && at(i) !== "\n" && at(i) !== ";") i++;
			if (/[\s}]/.test(script.slice(start, i).trimEnd())) return "unsupported";
			continue;
		}
		if (command === "a" || command === "i" || command === "c") {
			if (at(i) === "\\") {
				i++;
				if (at(i) === "\n") i++;
			}
			const end = script.indexOf("\n", i);
			const text = script.slice(i, end < 0 ? n : end);
			// Continued text lines are not modeled; a later line could be a command.
			if (text.endsWith("\\")) return "unsupported";
			i = end < 0 ? n : end + 1;
			continue;
		}
		if (command === "}") {
			if (depth === 0) return "invalid";
			depth--;
		} else if (command === "s" || command === "y") {
			const delimiter = at(i);
			if (delimiter === "" || delimiter === "\n" || delimiter === "\\") return "invalid";
			i++;
			if (!delimited(delimiter, command === "s") || !delimited(delimiter, false)) return "invalid";
			if (command === "s") {
				while (/[gpiImM0-9]/.test(at(i))) i++;
				// `e` runs the pattern space as a command; `w` writes a file.
				if (at(i) === "e" || at(i) === "w") return "unsafe";
			}
		} else if ("qQlL".includes(command)) {
			blanks();
			digits();
		}
		blanks();
		const next = at(i);
		if (next !== "" && next !== ";" && next !== "\n" && next !== "}" && next !== "#") return "invalid";
	}
	return depth === 0 ? "safe" : "invalid";
}

/** The worst reading across both bracket semantics; `invalid` only when both reject the script. */
function sedScriptResult(script: string): SedScript {
	const readings = [sedScript(script, true), sedScript(script, false)];
	for (const result of ["unsafe", "unsupported", "safe"] as const) if (readings.includes(result)) return result;
	return "invalid";
}

interface SedArguments {
	scripts: Word[];
	files: Word[];
	inPlace: boolean;
	scriptFile: boolean;
	invalid: boolean;
}

/**
 * One reading of sed's argv. `separateSuffix`: BSD `-i`/`-I` take the next argument as the backup suffix.
 * `permute`: GNU getopt keeps reading options after operands (not with POSIXLY_CORRECT, never in BSD).
 */
function sedArguments(args: Word[], separateSuffix: boolean, permute: boolean): SedArguments {
	const parsed: SedArguments = { scripts: [], files: [], inPlace: false, scriptFile: false, invalid: false };
	const operands: Word[] = [];
	let explicit = false;
	let options = true;
	for (let k = 0; k < args.length; k++) {
		const word = args[k];
		const text = word.text;
		if (options && text === "--") {
			options = false;
			continue;
		}
		if (options && text.startsWith("--")) {
			const equals = text.indexOf("=");
			const name = equals < 0 ? text : text.slice(0, equals);
			const hasValue = equals >= 0;
			if (name === "--expression") {
				const script = hasValue ? { ...word, text: text.slice(equals + 1) } : args[++k];
				if (script) parsed.scripts.push(script);
				else parsed.invalid = true;
				explicit = true;
			} else if (name === "--file") {
				parsed.scriptFile = true;
				if (!hasValue) k++;
			} else if (name === "--in-place") parsed.inPlace = true;
			else if (name === "--line-length") {
				if (!hasValue) k++;
			} else if (
				!/^--(?:quiet|silent|regexp-extended|separate|unbuffered|null-data|zero-terminated|posix|debug|sandbox|binary|follow-symlinks|help|version)$/.test(
					name,
				)
			)
				parsed.invalid = true;
			continue;
		}
		if (options && text.startsWith("-") && text.length > 1) {
			for (let j = 1; j < text.length; j++) {
				const letter = text[j];
				const rest = text.slice(j + 1);
				if ("nrEsuzab".includes(letter)) continue;
				if (letter === "e") {
					const script = rest ? { ...word, text: rest } : args[++k];
					if (script) parsed.scripts.push(script);
					else parsed.invalid = true;
					explicit = true;
				} else if (letter === "f") {
					parsed.scriptFile = true;
					if (!rest) k++;
				} else if (letter === "l") {
					if (!rest && !separateSuffix) k++;
				} else if (letter === "i" || (letter === "I" && separateSuffix)) {
					parsed.inPlace = true;
					if (!rest && separateSuffix) k++;
				} else parsed.invalid = true;
				break;
			}
			continue;
		}
		if (!permute) options = false;
		operands.push(word);
	}
	if (!explicit) {
		const script = operands.shift();
		if (script) parsed.scripts.push(script);
	}
	parsed.files = operands;
	return parsed;
}

const SED_READINGS: ReadonlyArray<[separateSuffix: boolean, permute: boolean]> = [
	[false, true], // GNU sed
	[false, false], // GNU sed with POSIXLY_CORRECT
	[true, false], // BSD/macOS sed
];

/** `undefined`: this sed rejects the command before it could change anything. */
function sedReading(parsed: SedArguments, state: State): Verdict | undefined {
	if (parsed.invalid) return unclassifiedOptions("sed");
	if (parsed.scriptFile) return verdict("unknown", "`sed -f` reads its script from a file");
	if (!parsed.scripts.length) return verdict("unknown", "`sed` without a script is not classified");
	if (!parsed.scripts.every(literal)) return verdict("unknown", "`sed` script is not a literal");
	// sed joins -e scripts with newlines and compiles them in order.
	const script = sedScriptResult(parsed.scripts.map((word) => word.text).join("\n"));
	if (script === "unsafe")
		return verdict("unknown", "`sed` script can run commands or read or write other files (e, r, w)");
	if (script === "unsupported") return verdict("unknown", "`sed` script is not classified");
	if (script === "invalid") return undefined;
	if (!parsed.inPlace) return verdict("read_only", "`sed` without -i: prints to standard output");
	const edits = parsed.files.map((file) =>
		writeTarget(
			file,
			state,
			"`sed -i`: in-place edit of named project files (recoverable only through version control or backups)",
			true,
		),
	);
	// Without input files `sed -i` refuses to run, and a safe script opened nothing.
	return edits.some(Boolean) ? combine(edits) : undefined;
}

function sed(args: Word[], state: State): Verdict {
	if (!args.every(visible)) return hiddenArguments("sed");
	const readings = SED_READINGS.map(([separateSuffix, permute]) =>
		sedReading(sedArguments(args, separateSuffix, permute), state),
	);
	return readings.some(Boolean)
		? combine(readings)
		: verdict("unknown", "every sed would reject this command; not classified");
}

// ---------------------------------------------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------------------------------------------

/** No option of these subcommands writes files or runs programs from the command line. */
const GIT_READ_ONLY = new Set(
	words(
		"status blame annotate ls-files ls-tree cat-file describe show-ref for-each-ref " +
			"merge-base name-rev count-objects var check-ignore check-attr check-mailmap cherry help version " +
			"verify-commit verify-tag rev-parse",
	),
);
/** Subcommands this classifier knows by name; others appear as `(other)` in reasons. */
const GIT_KNOWN = new Set(
	words(
		"grep branch tag remote stash worktree config add restore checkout switch reset clean push rm filter-branch ls-remote " +
			"filter-repo update-ref reflog commit merge rebase pull fetch clone init mv submodule gc prune cherry-pick " +
			"revert am apply bisect notes replace lfs archive format-patch fsck repack maintenance sparse-checkout",
	),
);
const gitName = (sub: string): string =>
	`git ${GIT_READ_ONLY.has(sub) || GIT_DIFF_LIKE.has(sub) || GIT_KNOWN.has(sub) ? sub : "(other)"}`;
/** Read-only unless `--output` (or an abbreviation) writes the result to a file. */
const GIT_DIFF_LIKE = new Set([
	"log",
	"show",
	"diff",
	"diff-tree",
	"diff-index",
	"diff-files",
	"range-diff",
	"whatchanged",
	"shortlog",
	"rev-list",
]);
const GIT_BRANCH_LISTING =
	/^(?:-a|--all|-r|--remotes|-v|-vv|--verbose|-l|--list|--show-current|--(?:no-)?contains(?:=.*)?|--(?:no-)?merged(?:=.*)?|--points-at(?:=.*)?|--sort=.*|--format=.*|--column(?:=.*)?|--no-column|--color(?:=.*)?|--no-color|-i|--ignore-case|--abbrev=.*|--no-abbrev|-q|--quiet|--omit-empty)$/;
const GIT_TAG_LISTING =
	/^(?:-l|--list|-n\d*|--(?:no-)?contains(?:=.*)?|--points-at(?:=.*)?|--(?:no-)?merged(?:=.*)?|--sort=.*|--format=.*|--column(?:=.*)?|--no-column|--color(?:=.*)?|-i|--ignore-case)$/;

const has = (args: readonly Word[], ...texts: string[]) => args.some((arg) => texts.includes(arg.text));
/** A short option cluster (`-fd`) containing `letter`. */
const cluster = (args: readonly Word[], letter: string) =>
	args.some((arg) => /^-[A-Za-z]+$/.test(arg.text) && arg.text.slice(1).includes(letter));

function git(args: Word[]): Verdict {
	let k = 0;
	for (; k < args.length; k++) {
		const text = args[k].text;
		if (!text.startsWith("-")) break;
		if (text === "-c" || text.startsWith("--config-env") || text.startsWith("--exec-path"))
			return verdict("unknown", "`git -c/--exec-path` overrides configuration, which can run programs");
		if (["--version", "--help", "-v", "-h"].includes(text)) return readOnly("git");
		if (text === "-C" || text === "--git-dir" || text === "--work-tree" || text === "--namespace") k++;
		else if (
			!/^(?:--no-pager|-P|-p|--paginate|--no-optional-locks|--literal-pathspecs|--glob-pathspecs|--noglob-pathspecs|--icase-pathspecs|--no-replace-objects|--bare|--no-lazy-fetch|--no-advice|--(?:git-dir|work-tree|namespace)=.*)$/.test(
				text,
			)
		)
			return unclassifiedOptions("git");
	}
	// Option values and the subcommand itself: an unquoted expansion here could add `-c` or another subcommand.
	if (!args.slice(0, k + 1).every(visible)) return hiddenArguments("git");
	const subcommand = args[k];
	if (!subcommand) return readOnly("git");
	const rest = args.slice(k + 1);
	const sub = subcommand.text;
	const name = tick(gitName(sub));
	if (GIT_READ_ONLY.has(sub)) return verdict("read_only", `${name}: read-only inspection`);
	const result = gitSubcommand(sub, rest);
	if (rest.every(visible)) return result;
	// Hidden arguments can add options, so only a destructive finding survives next to the `unknown` verdict.
	const hidden = hiddenArguments(gitName(sub));
	return result.category === "destructive" ? combine([hidden, result]) : hidden;
}

function gitSubcommand(sub: string, rest: Word[]): Verdict {
	const name = tick(gitName(sub));
	if (GIT_DIFF_LIKE.has(sub) || (sub === "reflog" && !["expire", "delete"].includes(rest[0]?.text ?? ""))) {
		return rest.some((arg) => /^--ou/.test(arg.text))
			? verdict("unknown", `${tick(`${gitName(sub)} --output`)} writes a file`)
			: verdict("read_only", `${name}: read-only inspection`);
	}
	switch (sub) {
		case "reflog":
			return verdict("destructive", "`git reflog expire/delete`: removes recovery history");
		case "grep":
			return rest.some((arg) => /^-O/.test(arg.text) || /^--op/.test(arg.text))
				? verdict("unknown", "`git grep -O` runs a pager program")
				: verdict("read_only", `${name}: read-only inspection`);
		case "branch":
			if (has(rest, "--delete") || cluster(rest, "d") || cluster(rest, "D"))
				return verdict("destructive", "`git branch --delete`: deletes branches");
			if (has(rest, "--force") || cluster(rest, "f"))
				return verdict("destructive", "`git branch --force`: resets a branch");
			return rest.every((arg) => GIT_BRANCH_LISTING.test(arg.text)) ||
				(has(rest, "-l", "--list") &&
					rest.every((arg) => !arg.text.startsWith("-") || GIT_BRANCH_LISTING.test(arg.text)))
				? verdict("read_only", "`git branch`: lists branches")
				: verdict("unknown", "`git branch` changes branches (not classified)");
		case "tag":
			if (has(rest, "--delete") || cluster(rest, "d"))
				return verdict("destructive", "`git tag --delete`: deletes tags");
			if (has(rest, "--force") || cluster(rest, "f"))
				return verdict("destructive", "`git tag --force`: moves an existing tag");
			return rest.every((arg) => GIT_TAG_LISTING.test(arg.text)) ||
				(has(rest, "-l", "--list") &&
					rest.every((arg) => !arg.text.startsWith("-") || GIT_TAG_LISTING.test(arg.text)))
				? verdict("read_only", "`git tag`: lists tags")
				: verdict("unknown", "`git tag` creates tags (not classified)");
		case "remote":
			return rest.every((arg) => arg.text === "-v" || arg.text === "--verbose") ||
				["get-url", "show"].includes(rest[0]?.text ?? "")
				? verdict("read_only", "`git remote`: lists remotes")
				: verdict("unknown", "`git remote` changes remote configuration (not classified)");
		case "stash":
			if (["list", "show"].includes(rest[0]?.text ?? ""))
				return rest.some((arg) => /^--ou/.test(arg.text))
					? verdict("unknown", "`git stash list/show --output` writes a file")
					: verdict("read_only", "`git stash list/show`: read-only inspection");
			if (["drop", "clear"].includes(rest[0]?.text ?? ""))
				return verdict("destructive", "`git stash drop/clear`: deletes stashed changes");
			return verdict("unknown", "`git stash` moves working-tree changes (not classified)");
		case "worktree":
			if (rest[0]?.text === "list") return verdict("read_only", "`git worktree list`: read-only inspection");
			if (rest[0]?.text === "remove") return verdict("destructive", "`git worktree remove`: deletes a working tree");
			return verdict("unknown", "`git worktree` changes working trees (not classified)");
		case "config":
			return gitConfig(rest);
		case "add":
			return has(rest, "-n", "--dry-run")
				? verdict("read_only", "`git add --dry-run`: read-only inspection")
				: verdict("reversible", "`git add`: stages changes in the index (undo with git restore --staged)");
		case "restore":
			return (has(rest, "--staged") || cluster(rest, "S")) && !(has(rest, "--worktree") || cluster(rest, "W"))
				? verdict("reversible", "`git restore --staged`: unstages changes")
				: verdict("destructive", "`git restore`: discards working-tree changes");
		case "checkout":
			return has(rest, "--", ".", "--force", "--patch", "--ours", "--theirs") ||
				cluster(rest, "f") ||
				cluster(rest, "p")
				? verdict("destructive", "`git checkout` of paths or with --force: discards working-tree changes")
				: verdict("unknown", "`git checkout` switches branches or restores files (not classified)");
		case "switch":
			return has(rest, "--force", "--discard-changes", "--force-create") || cluster(rest, "f") || cluster(rest, "C")
				? verdict("destructive", "`git switch --force/-C`: discards changes or resets a branch")
				: verdict("unknown", "`git switch` changes the checked-out branch (not classified)");
		case "reset": {
			if (has(rest, "--hard")) return verdict("destructive", "`git reset --hard`: discards uncommitted changes");
			const others = rest.filter((arg) => arg.text !== "-q" && arg.text !== "--quiet");
			return !others.length || others[0].text === "--"
				? verdict("reversible", "`git reset`: unstages changes")
				: verdict("unknown", "`git reset` moves HEAD or unstages (not classified)");
		}
		case "clean":
			return has(rest, "--dry-run") || cluster(rest, "n")
				? verdict("read_only", "`git clean --dry-run`: lists untracked files")
				: verdict("destructive", "`git clean`: deletes untracked files");
		case "push":
			return has(rest, "--force", "--force-if-includes", "--mirror", "--delete", "--prune") ||
				rest.some((arg) => arg.text.startsWith("--force-with-lease") || /^[+:]/.test(arg.text)) ||
				cluster(rest, "f") ||
				cluster(rest, "d")
				? verdict("destructive", "`git push` with force, delete or mirror: overwrites or deletes remote history")
				: verdict("unknown", "`git push` publishes commits to a remote (not classified)");
		case "rm":
			if (has(rest, "-n", "--dry-run")) return verdict("read_only", "`git rm --dry-run`: read-only inspection");
			return has(rest, "--cached")
				? verdict("reversible", "`git rm --cached`: unstages files and keeps them on disk")
				: verdict("destructive", "`git rm`: deletes tracked files");
		case "filter-branch":
		case "filter-repo":
			return verdict("destructive", `${name}: rewrites repository history`);
		case "update-ref":
			return has(rest, "-d")
				? verdict("destructive", "`git update-ref -d`: deletes a ref")
				: verdict("unknown", "`git update-ref` moves a ref (not classified)");
		default:
			return verdict("unknown", `${name} is not a recognized read-only command or reversible local edit`);
	}
}

function gitConfig(rest: Word[]): Verdict {
	const first = rest[0]?.text ?? "";
	if (first === "get" || first === "list") return verdict("read_only", "`git config`: reads configuration");
	if (
		["set", "unset", "rename-section", "remove-section", "edit"].includes(first) ||
		has(
			rest,
			"--add",
			"--unset",
			"--unset-all",
			"--replace-all",
			"--rename-section",
			"--remove-section",
			"-e",
			"--edit",
		)
	)
		return verdict("unknown", "`git config` writes configuration, which can make Git run programs");
	if (
		has(
			rest,
			"--get",
			"--get-all",
			"--get-regexp",
			"--get-urlmatch",
			"-l",
			"--list",
			"--get-color",
			"--get-colorbool",
		)
	)
		return verdict("read_only", "`git config`: reads configuration");
	const positional: Word[] = [];
	for (let k = 0; k < rest.length; k++) {
		const text = rest[k].text;
		if (["--file", "-f", "--blob", "--default", "--type", "--comment"].includes(text)) k++;
		else if (!text.startsWith("-")) positional.push(rest[k]);
	}
	return positional.length === 1
		? verdict("read_only", "`git config`: reads configuration")
		: verdict("unknown", "`git config` writes configuration, which can make Git run programs");
}

// ---------------------------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------------------------

function simpleCommand(command: SimpleCommand, state: State, depth: number, programs: string[]): Resolved {
	const verdicts: Array<Verdict | undefined> = command.redirects.map((redirect) => redirectVerdict(redirect, state));
	if (!command.words.length) {
		if (command.assignments.length)
			verdicts.push(
				command.assignments.every(harmlessAssignment)
					? verdict("read_only", "assigns locale or display variables")
					: verdict("unknown", "assigns shell variables that later commands may use"),
			);
		const result = combine(verdicts);
		return {
			verdict: result.reasons.length ? result : verdict("read_only", "redirection only: nothing runs"),
			program: "",
		};
	}
	if (!command.assignments.every(harmlessAssignment)) verdicts.push(verdict("unknown", ENVIRONMENT_REASON));
	const resolved = classifyWords(command.words, state, depth, programs);
	return { verdict: combine([...verdicts, resolved.verdict]), program: resolved.program };
}

function analyze(command: string, depth: number, programs: string[]): Verdict {
	if (command.length > MAX_CLASSIFIED_COMMAND_LENGTH) return verdict("unknown", "command is too long to classify");
	if (command.includes("\0")) return verdict("unknown", "command contains a NUL character");
	if (depth > MAX_NESTING) return verdict("unknown", "nested commands are too deep to classify");
	const { pipelines, unsupported } = parseCommand(command);
	const state: State = { insideProject: true };
	const verdicts: Verdict[] = [];
	for (const pipeline of pipelines) {
		const names: string[] = [];
		for (const item of pipeline) {
			const resolved = simpleCommand(item, state, depth, programs);
			verdicts.push(resolved.verdict);
			names.push(resolved.program);
		}
		const download = names.findIndex((name) => DOWNLOADERS.has(name));
		if (download >= 0 && names.slice(download + 1).some((name) => SHELLS.has(name) || INTERPRETERS.has(name)))
			verdicts.push(verdict("destructive", "pipes downloaded content into a shell or interpreter"));
	}
	for (const what of unsupported)
		verdicts.push(verdict("unknown", `unsupported shell syntax (${what}) is not classified`));
	return verdicts.length ? combine(verdicts) : verdict("read_only", "empty command: nothing runs");
}

/**
 * Classifies one shell command text. Deterministic and side-effect free; never throws for any string input.
 * The result explains the command; it grants nothing.
 */
export function classifyCommand(command: string): CommandRiskAssessment {
	const programs: string[] = [];
	const result = analyze(command, 0, programs);
	// Unknown/destructive explanations are what a person must weigh; read-only notes would only add noise.
	const floor = SEVERITY[result.category] >= SEVERITY.unknown ? SEVERITY.unknown : 0;
	const reasons = result.reasons.filter((reason) => reason.severity >= floor).map((reason) => reason.text);
	return {
		category: result.category,
		reasons:
			reasons.length > MAX_REASONS
				? [...reasons.slice(0, MAX_REASONS - 1), `${reasons.length - MAX_REASONS + 1} more reasons omitted`]
				: reasons,
		programs: programs.slice(0, MAX_PROGRAMS),
	};
}
