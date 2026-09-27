// Standalone project commands: no SDK session, home bootstrap, or Runtime state writer.
import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseRuntimeConfig } from "./config.ts";
import { gitProjectRoot, projectReadiness } from "./project-readiness.ts";

class ProjectInitError extends Error {}

async function optionalStat(path: string) {
	try {
		return await lstat(path);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
		throw error;
	}
}

/** Publish validated bytes using an exclusive temporary inode and atomic no-replace hardlink. */
export async function initProject(cwd: string, supplied: string): Promise<void> {
	const project = await realpath(cwd);
	if (!(await gitProjectRoot(project))) throw new ProjectInitError("Run project init at a Git project root.");
	const source = resolve(project, supplied);
	let bytes: Buffer;
	try {
		if ((await realpath(dirname(source))) !== dirname(source))
			throw new ProjectInitError("Config source parent must not be a symlink.");
		const handle = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const stat = await handle.stat();
			if (!stat.isFile() || stat.nlink !== 1 || stat.size > 65_536)
				throw new ProjectInitError("Config source must be a regular single-link YAML file of at most 64 KiB.");
			bytes = await handle.readFile();
		} finally {
			await handle.close();
		}
		if (!Buffer.from(bytes.toString("utf8")).equals(bytes))
			throw new ProjectInitError("Config source must be UTF-8.");
		parseRuntimeConfig(bytes.toString("utf8"));
	} catch {
		throw new ProjectInitError(
			"Supply a readable, regular, valid YAML config file (at most 64 KiB); no file was published.",
		);
	}
	const directory = join(project, ".ai");
	const target = join(directory, "config.yaml");
	const existing = await optionalStat(directory);
	if (existing && (!existing.isDirectory() || existing.isSymbolicLink()))
		throw new ProjectInitError("Unsafe .ai directory; no file was published.");
	if (await optionalStat(target)) throw new ProjectInitError(".ai/config.yaml already exists; no overwrite.");
	if (await optionalStat(join(directory, "writer.lock")))
		throw new ProjectInitError("A writer lock exists; inspect it before project init.");
	if (!existing) {
		try {
			await mkdir(directory, { mode: 0o700 });
		} catch (error) {
			if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
		}
	}
	const identity = await lstat(directory);
	if (!identity.isDirectory() || identity.isSymbolicLink())
		throw new ProjectInitError("Unsafe .ai directory; no file was published.");
	let temporary: string | undefined;
	try {
		temporary = join(directory, `.config-${randomUUID()}.tmp`);
		const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		try {
			await handle.writeFile(bytes);
			await handle.sync();
		} finally {
			await handle.close();
		}
		const current = await lstat(directory);
		if (
			current.dev !== identity.dev ||
			current.ino !== identity.ino ||
			current.isSymbolicLink() ||
			(await optionalStat(join(directory, "writer.lock")))
		)
			throw new ProjectInitError("Project directory or writer changed; no file was published.");
		try {
			await link(temporary, target);
		} catch (error) {
			if (error instanceof Error && "code" in error && error.code === "EEXIST")
				throw new ProjectInitError(".ai/config.yaml already exists; no overwrite.");
			throw error;
		}
	} finally {
		if (temporary) await unlink(temporary).catch(() => undefined);
	}
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [command, ...args] = process.argv.slice(2);
	if (command === "init" && args.length === 2 && args[0] === "--config" && args[1]) {
		try {
			await initProject(process.cwd(), args[1]);
			console.log("Published .ai/config.yaml. Run: weavra project doctor");
		} catch (error) {
			console.error(
				`Weavra project: ${error instanceof ProjectInitError ? error.message : "Project init failed; inspect project paths and permissions. No existing config was overwritten."}`,
			);
			process.exitCode = 1;
		}
	} else if (command === "doctor" && (args.length === 0 || (args.length === 1 && args[0] === "--json"))) {
		const result = await projectReadiness(process.cwd());
		if (args[0] === "--json") console.log(JSON.stringify(result));
		else {
			for (const diagnostic of result.diagnostics)
				console.log(`${diagnostic.severity}  ${diagnostic.code}: ${diagnostic.action}`);
			console.log(
				`Result: ${result.ready ? "READY" : "NOT READY"} (local prerequisites only; model authentication and verification not checked)`,
			);
			if (result.configuration)
				console.log(
					`Sandbox: ${result.configuration.sandboxMode}; budget: ${result.configuration.budgetConfigured ? "configured, not a billing cap" : "unlimited (no configured budget)"}.`,
				);
		}
		if (!result.ready) process.exitCode = 1;
	} else {
		console.error("Usage: weavra project init --config <reviewed-yaml-file> | weavra project doctor [--json]");
		process.exitCode = 1;
	}
}
