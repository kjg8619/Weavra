// Launcher-only, read-only Git discovery. Never imported by the Runtime/Extension.
// Node's native TypeScript support keeps this independent of the fork-local Pi build.
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

interface Worktree {
	path: string;
	head?: string;
	branch?: string;
	bare: boolean;
	detached: boolean;
	prunable: boolean;
	locked: boolean;
}

function git(cwd: string, args: string[]): string {
	const result = spawnSync(
		"git",
		["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-C", cwd, ...args],
		{
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 10_000,
			maxBuffer: 8 * 1024 * 1024,
		},
	);
	if (result.error || result.status !== 0 || !result.stdout) throw new Error(`Git ${args[0]} inspection failed`);
	const text = result.stdout.toString("utf8");
	if (!Buffer.from(text).equals(result.stdout)) throw new Error("Git returned unsupported non-UTF-8 data");
	return text;
}

function line(text: string): string {
	const value = text.endsWith("\n") ? text.slice(0, -1) : text;
	if (!value || /[\r\n\0]/.test(value)) throw new Error("unsupported or ambiguous Git path/metadata");
	return value;
}

function commonRepository(cwd: string): string {
	return realpathSync(resolve(cwd, line(git(cwd, ["rev-parse", "--git-common-dir"]))));
}

function registeredWorktrees(cwd: string): Worktree[] {
	// -z preserves spaces, quotes and control characters without Git/shell re-parsing.
	const output = git(cwd, ["worktree", "list", "--porcelain", "-z"]);
	if (!output.endsWith("\0\0")) throw new Error("malformed Git worktree list");
	return output
		.slice(0, -2)
		.split("\0\0")
		.map((block) => {
			const fields = new Map<string, string>();
			for (const field of block.split("\0")) {
				const separator = field.indexOf(" ");
				const key = separator < 0 ? field : field.slice(0, separator);
				const value = separator < 0 ? "" : field.slice(separator + 1);
				if (
					fields.has(key) ||
					!["worktree", "HEAD", "branch", "bare", "detached", "locked", "prunable"].includes(key)
				)
					throw new Error("malformed Git worktree record");
				fields.set(key, value);
			}
			const path = fields.get("worktree");
			if (!block.startsWith("worktree ") || !path || !isAbsolute(path))
				throw new Error("invalid registered worktree path");
			return {
				path,
				head: fields.get("HEAD"),
				branch: fields.get("branch"),
				bare: fields.has("bare"),
				detached: fields.has("detached"),
				prunable: fields.has("prunable"),
				locked: fields.has("locked"),
			};
		});
}

function inspect(worktree: Worktree, common: string): string {
	if (worktree.prunable) throw new Error("registered worktree is prunable");
	if (
		worktree.bare ||
		worktree.detached ||
		!worktree.branch ||
		!worktree.head ||
		!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(worktree.head)
	)
		throw new Error("broken registered worktree metadata");
	if (/[\r\n]/.test(worktree.path)) throw new Error("worktree path must not contain line breaks");
	if (!lstatSync(worktree.path).isDirectory()) throw new Error("worktree path is not a directory (or is a symlink)");
	const path = realpathSync(worktree.path);
	if (realpathSync(line(git(path, ["rev-parse", "--show-toplevel"]))) !== path)
		throw new Error("registered path is not the Git worktree root");
	if (commonRepository(path) !== common) throw new Error("worktree belongs to a different common repository");
	if (line(git(path, ["symbolic-ref", "HEAD"])) !== worktree.branch)
		throw new Error("registered worktree branch mismatch");
	if (line(git(path, ["rev-parse", "--verify", "HEAD^{commit}"])) !== worktree.head)
		throw new Error("registered worktree HEAD mismatch");
	const gitDir = realpathSync(line(git(path, ["rev-parse", "--absolute-git-dir"])));
	if (gitDir !== common) {
		// A copied .git file must not impersonate another linked worktree's metadata.
		const backlinkFile = join(gitDir, "gitdir");
		const stat = lstatSync(backlinkFile);
		if (!stat.isFile() || stat.size > 65536) throw new Error("invalid worktree Git metadata backlink");
		const backlink = line(readFileSync(backlinkFile, "utf8"));
		if (realpathSync(resolve(gitDir, backlink)) !== realpathSync(join(path, ".git")))
			throw new Error("worktree Git metadata backlink mismatch");
	}
	// Validate the index, but do not refresh it or require a clean working tree.
	git(path, ["ls-files", "--stage", "-z"]);
	return path;
}

function display(value: string): string {
	// Preserve table rows even for externally registered paths with tabs/control codes.
	return JSON.stringify(value)
		.slice(1, -1)
		.replace(
			/[\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,
			(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
}

try {
	const [mode, name, ...extra] = process.argv.slice(2);
	if ((mode !== "open" && mode !== "list") || extra.length || (mode === "list" && name !== undefined))
		throw new Error("invalid worktree discovery invocation");
	for (const variable of [
		"GIT_DIR",
		"GIT_WORK_TREE",
		"GIT_COMMON_DIR",
		"GIT_INDEX_FILE",
		"GIT_OBJECT_DIRECTORY",
		"GIT_ALTERNATE_OBJECT_DIRECTORIES",
		"GIT_NAMESPACE",
	])
		if (process.env[variable]) throw new Error(`unset ${variable} before worktree discovery`);
	const cwd = process.cwd();
	if (mode === "open") {
		if (!name || !/^[A-Za-z0-9._-]+$/.test(name)) throw new Error("invalid worktree name");
		git(cwd, ["check-ref-format", "--branch", `weavra/${name}`]);
	}
	const source = realpathSync(line(git(cwd, ["rev-parse", "--show-toplevel"])));
	const common = commonRepository(source);
	const worktrees = registeredWorktrees(source);
	if (mode === "open") {
		const branch = `refs/heads/weavra/${name}`;
		const matches = worktrees.filter((worktree) => worktree.branch === branch);
		if (matches.length !== 1)
			throw new Error(`expected exactly one registered worktree for ${branch}; found ${matches.length}`);
		const worktree = matches[0];
		if (worktrees.filter((entry) => entry.path === worktree.path).length !== 1)
			throw new Error("ambiguous registered worktree path");
		const path = inspect(worktree, common);
		// Refuse changes during inspection rather than repairing or selecting another path.
		const current = registeredWorktrees(source).filter(
			(entry) => entry.branch === branch || entry.path === worktree.path,
		);
		if (
			commonRepository(source) !== common ||
			current.length !== 1 ||
			JSON.stringify(current[0]) !== JSON.stringify(worktree)
		)
			throw new Error("worktree registration changed during inspection");
		if (inspect(current[0], common) !== path) throw new Error("worktree path changed during inspection");
		process.stderr.write(
			`Weavra worktree opened\nBranch: ${display(branch.slice("refs/heads/".length))}\nPath: ${display(path)}\n`,
		);
		process.stdout.write(path);
	} else {
		const rows = ["NAME\tBRANCH\tPATH\tSTATUS"];
		for (const worktree of worktrees.filter((entry) => entry.branch?.startsWith("refs/heads/weavra/"))) {
			let status = "OK";
			if (worktrees.filter((entry) => entry.branch === worktree.branch || entry.path === worktree.path).length !== 1)
				status = "AMBIGUOUS";
			else if (worktree.prunable) status = "PRUNABLE";
			else {
				try {
					inspect(worktree, common);
					if (worktree.locked) status = "LOCKED";
				} catch (error) {
					status =
						error instanceof Error && "code" in error && error.code === "ENOENT" ? "MISSING/BROKEN" : "BROKEN";
				}
			}
			rows.push(
				[
					worktree.branch!.slice("refs/heads/weavra/".length),
					worktree.branch!.slice("refs/heads/".length),
					worktree.path,
					status,
				]
					.map(display)
					.join("\t"),
			);
		}
		if (commonRepository(source) !== common) throw new Error("source common repository changed during discovery");
		process.stdout.write(`${rows.join("\n")}\n`);
	}
} catch (error) {
	process.stderr.write(
		`Weavra: ${display(error instanceof Error ? error.message : "worktree discovery failed")}. No repair or cleanup was performed.\n`,
	);
	process.exitCode = 1;
}
