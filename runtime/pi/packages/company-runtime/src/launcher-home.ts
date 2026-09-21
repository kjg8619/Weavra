// Launcher-only product paths/setup/doctor. Never imported by Runtime or Extension.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { access, link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const files = ["auth.json", "models.json", "settings.json"] as const;
type ImportFile = (typeof files)[number];
const directories = ["sessions", "themes", "prompts", "tools", "bin"] as const;
const maxFileBytes = 1024 * 1024;
export interface WeavraHome {
	home: string;
	agentDir: string;
	piHome: string;
	piAgentDir: string;
}
class ProductHomeError extends Error {}
function fail(message: string): never {
	throw new ProductHomeError(message);
}
function display(value: string): string {
	return value.replace(
		/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
}
async function stat(path: string): Promise<Stats | undefined> {
	try {
		return await lstat(path);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}
function overlaps(a: string, b: string): boolean {
	return a === sep || b === sep || a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
}
/** Resolve existing ancestors without creating directories, including symlink aliases to Pi. */
async function canonical(path: string): Promise<string> {
	if (await stat(path)) return realpath(path);
	const parent = dirname(path);
	if (parent === path) fail("Cannot resolve product home");
	return join(await canonical(parent), path.slice(parent.length));
}
export async function resolveWeavraHome(env: NodeJS.ProcessEnv = process.env): Promise<WeavraHome> {
	const userHome = env.HOME || homedir();
	if (!isAbsolute(userHome) || /[\r\n\0]/.test(userHome)) fail("HOME must be an absolute path without line breaks");
	const requested = env.WEAVRA_HOME ?? join(userHome, ".weavra");
	const expanded =
		requested === "~" ? userHome : requested.startsWith("~/") ? join(userHome, requested.slice(2)) : requested;
	if (!isAbsolute(expanded) || /[\r\n\0]/.test(expanded))
		fail("WEAVRA_HOME must be an absolute path (or ~/path) without line breaks");
	const home = resolve(expanded);
	const piHome = join(resolve(userHome), ".pi");
	const canonicalHome = await canonical(home);
	if (overlaps(home, piHome) || overlaps(canonicalHome, await canonical(piHome)))
		fail("Isolation: WEAVRA_HOME must not overlap ~/.pi");
	// An inherited custom Pi agent dir is ignored, but must not alias our new home.
	if (env.PI_CODING_AGENT_DIR) {
		const inherited = env.PI_CODING_AGENT_DIR.startsWith("~/")
			? join(userHome, env.PI_CODING_AGENT_DIR.slice(2))
			: resolve(env.PI_CODING_AGENT_DIR);
		// Re-entering weavra from its own child is valid. Other Pi homes remain protected.
		if (
			(await canonical(inherited)) !== join(canonicalHome, "agent") &&
			overlaps(canonicalHome, await canonical(inherited))
		)
			fail("Isolation: WEAVRA_HOME overlaps the inherited Pi agent directory");
	}
	return { home, agentDir: join(home, "agent"), piHome, piAgentDir: join(piHome, "agent") };
}
async function privateDirectory(path: string): Promise<void> {
	const info = await stat(path);
	if (!info) fail("Weavra has not been set up. Run: weavra setup");
	if (!info.isDirectory() || info.isSymbolicLink()) fail("Weavra directories must be real directories, not symlinks");
	if ((info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()))
		fail("Weavra directory permissions must be private (0700); inspect permissions manually");
	await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
}
async function productDirectories(paths: WeavraHome): Promise<void> {
	await privateDirectory(paths.home);
	await privateDirectory(paths.agentDir);
	for (const name of directories)
		if (await stat(join(paths.agentDir, name))) await privateDirectory(join(paths.agentDir, name));
}
async function readJson(path: string): Promise<{ bytes: Buffer; value: Record<string, unknown>; mode: number }> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = await handle.stat();
		if (!before.isFile() || before.nlink !== 1 || before.size > maxFileBytes) fail("Unsafe JSON file");
		const bytes = await handle.readFile();
		if (bytes.length > maxFileBytes || !Buffer.from(bytes.toString("utf8")).equals(bytes))
			fail("Unsupported JSON file");
		const value: unknown = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
		if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected a JSON object");
		return { bytes, value: value as Record<string, unknown>, mode: before.mode };
	} finally {
		await handle.close();
	}
}
/** Checks only; child Pi still owns authentication and sessions. No bootstrap writes here. */
export async function prepareLaunch(env: NodeJS.ProcessEnv = process.env): Promise<string> {
	const paths = await resolveWeavraHome(env);
	await productDirectories(paths);
	for (const name of files) {
		const path = join(paths.agentDir, name);
		if (!(await stat(path))) continue;
		try {
			const info = await readJson(path);
			if ((info.mode & 0o077) !== 0 && name === "auth.json") fail("auth.json permissions must be private (0600)");
		} catch {
			fail(`Unsafe, unreadable or invalid ${name}; run weavra doctor. No repair was performed`);
		}
	}
	return realpath(paths.agentDir);
}
async function ensureDirectory(path: string): Promise<void> {
	if (!(await stat(path))) {
		const parent = dirname(path);
		if (!(await stat(parent))) await ensureDirectory(parent);
		try {
			await mkdir(path, { mode: 0o700 });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	await privateDirectory(path);
}
/** Test hook only at the publication boundary; never configurable by env/CLI/Worker. */
export async function importConfig(
	paths: WeavraHome,
	name: ImportFile,
	beforePublish?: () => Promise<void>,
): Promise<"IMPORTED" | "SKIP"> {
	if (!files.includes(name)) fail("Unsupported import candidate");
	await productDirectories(paths);
	const target = join(paths.agentDir, name);
	if (await stat(target)) return "SKIP";
	let temporary: string | undefined;
	try {
		// Source parents may be user-managed aliases; source leaf must be an ordinary file.
		const { bytes } = await readJson(join(paths.piAgentDir, name));
		const identity = await lstat(paths.agentDir);
		temporary = join(paths.agentDir, `.import-${randomUUID()}.tmp`);
		const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		try {
			await handle.writeFile(bytes);
			await handle.sync();
		} finally {
			await handle.close();
		}
		await beforePublish?.();
		await productDirectories(paths);
		const now = await lstat(paths.agentDir);
		if (now.dev !== identity.dev || now.ino !== identity.ino) fail("Destination directory changed");
		// rename() overwrites on POSIX. link() atomically publishes without replacing an existing target.
		try {
			await link(temporary, target);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "EEXIST") return "SKIP";
			throw error;
		}
		return "IMPORTED";
	} catch {
		return fail(`Import failed for ${name}; source and existing destination were not overwritten`);
	} finally {
		if (temporary)
			await unlink(temporary).catch(() => {
				/* Never remove a user target on cleanup failure. */
			});
	}
}
export async function setupWeavra(
	env: NodeJS.ProcessEnv,
	confirm: (name: ImportFile) => Promise<boolean>,
	output: (line: string) => void,
): Promise<void> {
	const paths = await resolveWeavraHome(env);
	await ensureDirectory(paths.home);
	await ensureDirectory(paths.agentDir);
	for (const name of directories) await ensureDirectory(join(paths.agentDir, name));
	output(`Weavra home: ${display(paths.home)}\nAgent directory: ${display(paths.agentDir)}`);
	output("Existing Pi sessions were not imported automatically.");
	output("Existing Pi configuration candidates (read-only; presence only, not selected):");
	const candidates: ImportFile[] = [];
	for (const name of files) {
		let available = false;
		try {
			const info = await stat(join(paths.piAgentDir, name));
			available = !!info?.isFile() && !info.isSymbolicLink() && info.nlink === 1;
		} catch {
			/* Unreadable Pi configuration is not an import authorization. */
		}
		output(`[${available ? "x" : " "}] ${name}`);
		if (available) candidates.push(name);
	}
	for (const name of candidates) {
		if (await stat(join(paths.agentDir, name))) {
			output(`SKIP ${name}: Weavra destination already exists`);
			continue;
		}
		if (name === "settings.json")
			output(
				"WARNING: settings.json may contain Pi-specific extensions, paths, sessionDir, or commands. Import only after reviewing it; paths are not rewritten.",
			);
		if (!(await confirm(name))) {
			output(`SKIP ${name}: no consent`);
			continue;
		}
		output(`${await importConfig(paths, name)} ${name}`);
	}
	output(
		"Weavra setup complete. Run: weavra doctor\nUse Weavra /login if authentication is not configured. No Pi files were changed.",
	);
}
export async function doctorWeavra(
	checkout: string,
	env: NodeJS.ProcessEnv,
	output: (line: string) => void,
): Promise<number> {
	let failed = false;
	const report = (status: "PASS" | "WARN" | "FAIL", label: string, detail: string) => {
		failed ||= status === "FAIL";
		output(`${status}  ${label}: ${display(detail)}`);
	};
	output("Weavra Doctor");
	for (const [label, path, directory, executable] of [
		["Fork-local checkout", checkout, true, false],
		["Pi build", join(checkout, "packages/coding-agent/dist/bundle/cli.js"), false, true],
		["Weavra extension", join(checkout, "packages/company-runtime/src/extension.ts"), false, false],
	] as const) {
		try {
			const info = await stat(path);
			if (!info || (directory ? !info.isDirectory() : !info.isFile())) throw new Error();
			await access(path, constants.R_OK | (executable ? constants.X_OK : 0));
			report("PASS", label, path);
		} catch {
			report("FAIL", label, "missing or inaccessible; no global Pi fallback");
		}
	}
	const [major, minor, patch] = process.versions.node.split(".").map(Number);
	report(
		major > 22 || (major === 22 && (minor > 19 || (minor === 19 && patch >= 0))) ? "PASS" : "FAIL",
		"Node",
		process.versions.node,
	);
	const git = spawnSync("git", ["--version"], {
		env: {
			PATH: env.PATH,
			LANG: env.LANG,
			LC_ALL: env.LC_ALL,
			GIT_CONFIG_NOSYSTEM: "1",
			GIT_CONFIG_GLOBAL: "/dev/null",
		},
		stdio: ["ignore", "pipe", "pipe"],
		encoding: "utf8",
		timeout: 5000,
		maxBuffer: 4096,
	});
	const version =
		git.status === 0 && !git.error ? /^git version (\d+\.\d+(?:\.\d+)?)/.exec(git.stdout)?.[1] : undefined;
	report(version ? "PASS" : "FAIL", "Git", version ?? "unavailable");
	try {
		const paths = await resolveWeavraHome(env);
		report("PASS", "WEAVRA_HOME", paths.home);
		report("PASS", "Effective agent dir", paths.agentDir);
		report(
			"PASS",
			"Isolation",
			"distinct from ~/.pi; inherited Pi agent/session environment is not used by the child",
		);
		try {
			await productDirectories(paths);
			report("PASS", "Agent directory", "private, readable and writable");
		} catch {
			report(
				"FAIL",
				"Agent directory",
				"not set up, unsafe, or inaccessible; run weavra setup / inspect permissions",
			);
		}
		let settings: Record<string, unknown> | undefined;
		for (const name of files) {
			try {
				const path = join(paths.agentDir, name);
				if (!(await stat(path))) {
					report(
						"WARN",
						name,
						name === "auth.json"
							? "not present; use Weavra /login or explicit setup import"
							: "not present (optional)",
					);
					continue;
				}
				// Do not follow a linked product parent to read foreign credentials.
				await privateDirectory(paths.home);
				await privateDirectory(paths.agentDir);
				const result = await readJson(path);
				if (name === "auth.json" && (result.mode & 0o077) !== 0)
					report("FAIL", name, "permissions must be 0600; no chmod performed");
				else
					report("PASS", name, "present, readable JSON object (content not displayed; credentials not validated)");
				if (name === "settings.json") settings = result.value;
			} catch {
				report("FAIL", name, "unsafe, unreadable or invalid JSON (content not displayed)");
			}
		}
		report("PASS", "Default session root", join(paths.agentDir, "sessions"));
		if (settings?.sessionDir)
			report(
				"WARN",
				"Session resolution",
				"settings.sessionDir is configured; review it manually (value not displayed)",
			);
		else
			report(
				"PASS",
				"Session resolution",
				"agent/sessions/<encoded-cwd>; --session-dir still has CLI precedence; explicit project settings may override the default",
			);
		output("No auth refresh, Provider/network call, session creation, chmod or repair was performed.");
	} catch {
		report("FAIL", "Isolation / paths", "invalid WEAVRA_HOME or overlap with Pi; no directories created");
	}
	output(`Result: ${failed ? "NOT READY" : "READY (local checks only; Provider readiness not verified)"}`);
	return failed ? 1 : 0;
}

// No imported Pi API: even doctor/setup outside a Git project cannot initialize user sessions.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	try {
		const [command, ...extra] = process.argv.slice(2);
		if (extra.length || !["setup", "doctor", "launch"].includes(command)) fail("Usage: weavra setup | weavra doctor");
		if (command === "launch") process.stdout.write(await prepareLaunch());
		else if (command === "doctor")
			process.exitCode = await doctorWeavra(
				resolve(dirname(fileURLToPath(import.meta.url)), "../../.."),
				process.env,
				console.log,
			);
		else {
			const reader = createInterface({ input: process.stdin, terminal: false });
			const answers = reader[Symbol.asyncIterator]();
			try {
				await setupWeavra(
					process.env,
					async (name) => {
						process.stdout.write(`Import ${name} into Weavra? [y/N] `);
						const answer = await answers.next();
						return !answer.done && /^(y|yes)$/i.test(answer.value.trim());
					},
					console.log,
				);
			} finally {
				reader.close();
			}
		}
	} catch (error) {
		// Never forward JSON.parse/fs errors: they may embed credential bytes or arbitrary filenames.
		console.error(
			`Weavra: ${error instanceof ProductHomeError ? error.message : "Product home operation failed; inspect paths/permissions. No automatic repair or Pi fallback."}`,
		);
		process.exitCode = 1;
	}
}
