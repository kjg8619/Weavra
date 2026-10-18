import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { parseRuntimeConfig } from "./config.ts";
import { gitProjectRoot } from "./project-readiness.ts";
import { FileStateStore, StateStoreError } from "./state-store.ts";

export type ProjectConfigErrorCode =
	| "INVALID_CONFIG"
	| "CONFIG_MISSING"
	| "STALE_CONFIG"
	| "WORKSPACE_BUSY"
	| "UNSAFE_PATH";

export class ProjectConfigError extends Error {
	readonly code: ProjectConfigErrorCode;

	constructor(code: ProjectConfigErrorCode, message: string, cause?: unknown) {
		super(message, { cause });
		this.name = "ProjectConfigError";
		this.code = code;
	}
}

const MAX_CONFIG_BYTES = 65_536;
const sameIdentity = (
	a: { dev: bigint; ino: bigint; mode: bigint; size: bigint; nlink: bigint; mtimeNs: bigint; ctimeNs: bigint },
	b: { dev: bigint; ino: bigint; mode: bigint; size: bigint; nlink: bigint; mtimeNs: bigint; ctimeNs: bigint },
) =>
	a.dev === b.dev &&
	a.ino === b.ino &&
	a.mode === b.mode &&
	a.size === b.size &&
	a.nlink === b.nlink &&
	a.mtimeNs === b.mtimeNs &&
	a.ctimeNs === b.ctimeNs;

/** Reads the existing project YAML without creating project state, locks, or files. */
export async function readProjectConfig(cwd: string): Promise<{ yaml: string; configDigest: `sha256:${string}` }> {
	let root: string;
	let rootIdentity: { dev: bigint; ino: bigint };
	try {
		root = await realpath(cwd);
		const rootStat = await lstat(root, { bigint: true });
		if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
			throw new ProjectConfigError("UNSAFE_PATH", "Project root must be a real directory");
		rootIdentity = { dev: rootStat.dev, ino: rootStat.ino };
		if (!(await gitProjectRoot(root)))
			throw new ProjectConfigError("UNSAFE_PATH", "Project path must be the Git working-tree root");
	} catch (error) {
		if (error instanceof ProjectConfigError) throw error;
		throw new ProjectConfigError("UNSAFE_PATH", "Unable to bind project path to its Git root", error);
	}

	const aiPath = join(root, ".ai");
	const configPath = join(aiPath, "config.yaml");
	try {
		const directoryBefore = await lstat(aiPath, { bigint: true });
		if (!directoryBefore.isDirectory() || directoryBefore.isSymbolicLink())
			throw new ProjectConfigError("UNSAFE_PATH", ".ai must be a real directory");
		const handle = await open(configPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const before = await handle.stat({ bigint: true });
			if (!before.isFile() || before.nlink !== 1n)
				throw new ProjectConfigError("UNSAFE_PATH", "Config must be an ordinary single-link file");
			if (before.size > BigInt(MAX_CONFIG_BYTES))
				throw new ProjectConfigError("INVALID_CONFIG", "Project config exceeds 64 KiB");
			const bytes = Buffer.alloc(MAX_CONFIG_BYTES + 1);
			let length = 0;
			while (length < bytes.length) {
				const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
				if (bytesRead === 0) break;
				length += bytesRead;
			}
			if (length > MAX_CONFIG_BYTES) throw new ProjectConfigError("INVALID_CONFIG", "Project config exceeds 64 KiB");
			const after = await handle.stat({ bigint: true });
			const named = await lstat(configPath, { bigint: true });
			const directoryAfter = await lstat(aiPath, { bigint: true });
			const rootAfter = await lstat(root, { bigint: true });
			if (
				!sameIdentity(before, after) ||
				!sameIdentity(before, named) ||
				!rootAfter.isDirectory() ||
				rootAfter.isSymbolicLink() ||
				rootIdentity.dev !== rootAfter.dev ||
				rootIdentity.ino !== rootAfter.ino ||
				!directoryAfter.isDirectory() ||
				directoryAfter.isSymbolicLink() ||
				directoryBefore.dev !== directoryAfter.dev ||
				directoryBefore.ino !== directoryAfter.ino ||
				(await realpath(root)) !== root
			)
				throw new ProjectConfigError("STALE_CONFIG", "Project config changed while being read");

			let yaml: string;
			try {
				yaml = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length));
			} catch (error) {
				throw new ProjectConfigError("INVALID_CONFIG", "Project config is not valid UTF-8", error);
			}
			try {
				parseRuntimeConfig(yaml);
			} catch (error) {
				throw new ProjectConfigError("INVALID_CONFIG", "Project config is invalid", error);
			}
			const configDigest = `sha256:${createHash("sha256").update(bytes.subarray(0, length)).digest("hex")}` as const;
			return { yaml, configDigest };
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (error instanceof ProjectConfigError) throw error;
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			throw new ProjectConfigError("CONFIG_MISSING", "Project config does not exist", error);
		if (error instanceof Error && "code" in error && error.code === "ELOOP")
			throw new ProjectConfigError("UNSAFE_PATH", "Project config path contains a symbolic link", error);
		throw new ProjectConfigError("UNSAFE_PATH", "Unable to read project config safely", error);
	}
}

/** Replaces the existing config only when its exact bytes still match the supplied digest. */
export async function updateProjectConfig(
	cwd: string,
	expectedConfigDigest: `sha256:${string}`,
	yaml: string,
): Promise<{ yaml: string; configDigest: `sha256:${string}` }> {
	const bytes = Buffer.from(yaml, "utf8");
	if (bytes.length > MAX_CONFIG_BYTES) throw new ProjectConfigError("INVALID_CONFIG", "Project config exceeds 64 KiB");
	try {
		if (new TextDecoder("utf-8", { fatal: true }).decode(bytes) !== yaml)
			throw new ProjectConfigError("INVALID_CONFIG", "Project config is not valid UTF-8");
		parseRuntimeConfig(yaml);
	} catch (error) {
		if (error instanceof ProjectConfigError) throw error;
		throw new ProjectConfigError("INVALID_CONFIG", "Project config is invalid", error);
	}

	let store: FileStateStore | undefined;
	let temporary: string | undefined;
	try {
		try {
			store = await FileStateStore.open(cwd, { recoverInterrupted: false });
		} catch (error) {
			if (error instanceof StateStoreError)
				throw new ProjectConfigError("WORKSPACE_BUSY", "Project state is not writable", error);
			throw error;
		}
		await store.assertWritable();
		const generation = store.snapshot.revision;
		const root = await realpath(cwd);
		const rootBefore = await lstat(root, { bigint: true });
		const directory = join(root, ".ai");
		const directoryBefore = await lstat(directory, { bigint: true });
		if (
			!rootBefore.isDirectory() ||
			rootBefore.isSymbolicLink() ||
			!directoryBefore.isDirectory() ||
			directoryBefore.isSymbolicLink()
		)
			throw new ProjectConfigError("UNSAFE_PATH", "Project config directories must be real directories");
		const current = await readProjectConfig(root);
		if (current.configDigest !== expectedConfigDigest)
			throw new ProjectConfigError("STALE_CONFIG", "Project config no longer matches the expected digest");

		const configPath = join(directory, "config.yaml");
		const original = await lstat(configPath, { bigint: true });
		if (!original.isFile() || original.isSymbolicLink() || original.nlink !== 1n)
			throw new ProjectConfigError("UNSAFE_PATH", "Config must be an ordinary single-link file");
		temporary = join(directory, `.config.yaml.${randomUUID()}.tmp`);
		const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		try {
			await handle.writeFile(bytes);
			await handle.sync();
		} finally {
			await handle.close();
		}

		await store.assertWritable();
		const rootAfter = await lstat(root, { bigint: true });
		const directoryAfter = await lstat(directory, { bigint: true });
		const configAfter = await lstat(configPath, { bigint: true });
		if (
			store.snapshot.revision !== generation ||
			rootBefore.dev !== rootAfter.dev ||
			rootBefore.ino !== rootAfter.ino ||
			!rootAfter.isDirectory() ||
			rootAfter.isSymbolicLink() ||
			directoryBefore.dev !== directoryAfter.dev ||
			directoryBefore.ino !== directoryAfter.ino ||
			!directoryAfter.isDirectory() ||
			directoryAfter.isSymbolicLink() ||
			!sameIdentity(original, configAfter) ||
			(await realpath(root)) !== root
		)
			throw new ProjectConfigError("STALE_CONFIG", "Project paths or generation changed before update");
		const latest = await readProjectConfig(root);
		if (latest.configDigest !== expectedConfigDigest)
			throw new ProjectConfigError("STALE_CONFIG", "Project config changed before update");
		await rename(temporary, configPath);
		temporary = undefined;
		const configDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
		return { yaml, configDigest };
	} catch (error) {
		if (error instanceof ProjectConfigError) throw error;
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			throw new ProjectConfigError("CONFIG_MISSING", "Project config does not exist", error);
		if (error instanceof Error && "code" in error && error.code === "ELOOP")
			throw new ProjectConfigError("UNSAFE_PATH", "Project config path contains a symbolic link", error);
		throw new ProjectConfigError("UNSAFE_PATH", "Unable to update project config safely", error);
	} finally {
		if (temporary) await unlink(temporary).catch(() => undefined);
		await store?.close();
	}
}
