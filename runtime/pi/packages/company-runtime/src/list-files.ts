import type { BigIntStats } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { isListablePath, type PolicyContext, type PolicyPathInspector } from "./policy.ts";

export const LIST_MAX_FILES = 500;
export const LIST_MAX_BYTES = 65536;
export const LIST_MAX_ENTRIES = 4096;
export const LIST_MAX_ROOTS = 32;
export interface FileListing {
	files: string[];
	truncated: boolean;
	reason?: string;
}

/** Names only, no subprocess/content/stat output. Called after the registered list Policy/audit gate. */
export async function listFiles(
	cwd: string,
	roots: readonly string[],
	maxDepth: number,
	policy: PolicyContext,
	inspector: PolicyPathInspector,
	signal: AbortSignal,
): Promise<FileListing> {
	if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 4) throw new Error("Listing depth must be 0..4");
	if (!roots.length || roots.length > LIST_MAX_ROOTS || roots.some((path) => !isListablePath(path, policy)))
		throw new Error("Listing root denied");
	const project = await realpath(cwd);
	const directories = new Map<string, BigIntStats>();
	const files = new Set<string>();
	let entries = 0,
		visits = 0,
		bytes = 256,
		truncated = false,
		stopped = false;
	const visit = async (path: string, depth: number): Promise<void> => {
		signal.throwIfAborted();
		if (stopped || !isListablePath(path, policy)) return;
		if (++visits > LIST_MAX_ENTRIES) {
			truncated = true;
			stopped = true;
			return;
		}
		const fact = (await inspector.inspect([path]))[0];
		if (!fact?.safe) return;
		let stat: BigIntStats;
		try {
			stat = await lstat(join(project, path), { bigint: true });
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
			throw error;
		}
		if (stat.isSymbolicLink()) return;
		if (stat.isFile()) {
			if (stat.nlink !== 1n || files.has(path)) return;
			const size = Buffer.byteLength(JSON.stringify(path)) + 1;
			if (files.size >= LIST_MAX_FILES || bytes + size > LIST_MAX_BYTES) {
				truncated = true;
				stopped = true;
				return;
			}
			files.add(path);
			bytes += size;
			return;
		}
		if (!stat.isDirectory()) return;
		if (depth > maxDepth) {
			truncated = true;
			return;
		}
		const absolute = join(project, path);
		const previous = directories.get(path);
		if (previous && (previous.dev !== stat.dev || previous.ino !== stat.ino))
			throw new Error("Listing directory changed");
		directories.set(path, stat);
		const directory = await opendir(absolute);
		const names: string[] = [];
		try {
			for (;;) {
				signal.throwIfAborted();
				const entry = await directory.read();
				if (!entry) break;
				if (++entries > LIST_MAX_ENTRIES) {
					// A partial readdir prefix is OS-order dependent. Omit this incomplete directory, never sort an arbitrary prefix.
					truncated = true;
					stopped = true;
					return;
				}
				if (!entry.isSymbolicLink() && isListablePath(`${path}/${entry.name}`, policy)) names.push(entry.name);
			}
		} finally {
			await directory.close();
		}
		const after = await lstat(absolute, { bigint: true });
		if (after.isSymbolicLink() || !after.isDirectory() || after.dev !== stat.dev || after.ino !== stat.ino)
			throw new Error("Listing directory changed");
		for (const name of names.sort()) {
			await visit(`${path}/${name}`, depth + 1);
			if (stopped) break;
		}
	};
	for (const root of [...new Set(roots)].sort()) {
		await visit(root, 0);
		if (stopped) break;
	}
	// Reinspect all returned names and traversed directories before releasing the result.
	for (const [path, before] of directories) {
		signal.throwIfAborted();
		const fact = (await inspector.inspect([path]))[0];
		const after = await lstat(join(project, path), { bigint: true });
		if (!fact?.safe || fact.kind !== "directory" || after.dev !== before.dev || after.ino !== before.ino)
			throw new Error("Listing directory changed before result");
	}
	const result: string[] = [];
	for (const path of [...files].sort()) {
		signal.throwIfAborted();
		const fact = (await inspector.inspect([path]))[0];
		if (fact?.safe && fact.kind === "file" && isListablePath(path, policy)) result.push(path);
		else truncated = true;
	}
	signal.throwIfAborted();
	return {
		files: result,
		truncated,
		...(truncated
			? { reason: "Depth, entry, file or byte limit reached, or entries changed; remainder not counted" }
			: {}),
	};
}
