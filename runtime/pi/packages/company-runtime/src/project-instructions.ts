import {
	type BigIntStats,
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	realpathSync,
} from "node:fs";
import { join } from "node:path";
import { decodeAnchoredText, fileDigest } from "./anchored-edit.ts";
import { isPolicyPath, isProtectedPath } from "./policy.ts";
import type { ProjectInstructionSnapshot } from "./project-instruction-types.ts";

export const MAX_INSTRUCTION_BYTES = 65536;

/** Synchronous bounded preflight read: no JS yield/reopen between capture and freshness checks. */
export function snapshotProjectInstructions(
	cwd: string,
	path: string,
	protectedPaths: readonly string[] = [],
): ProjectInstructionSnapshot {
	if (!isPolicyPath(path) || path.length > 4096 || isProtectedPath(path, protectedPaths))
		throw new Error("Project instruction path is invalid or protected");
	const root = realpathSync(cwd);
	const parents: Array<{ path: string; stat: BigIntStats }> = [];
	let current = root;
	const rootStat = lstatSync(root, { bigint: true });
	if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Unsafe instruction workspace");
	parents.push({ path: root, stat: rootStat });
	const parts = path.split("/");
	for (const part of parts.slice(0, -1)) {
		current = join(current, part);
		const stat = lstatSync(current, { bigint: true });
		if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe instruction ancestor");
		parents.push({ path: current, stat });
	}
	const target = join(root, path);
	const selected = lstatSync(target, { bigint: true });
	if (
		!selected.isFile() ||
		selected.isSymbolicLink() ||
		selected.nlink !== 1n ||
		selected.size > BigInt(MAX_INSTRUCTION_BYTES)
	)
		throw new Error("Project instructions require one bounded regular single-link file");
	const fd = openSync(target, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(fd, { bigint: true });
		if (!before.isFile() || before.nlink !== 1n || before.dev !== selected.dev || before.ino !== selected.ino)
			throw new Error("Project instructions changed before read");
		const buffer = Buffer.alloc(MAX_INSTRUCTION_BYTES + 1);
		let length = 0;
		while (length < buffer.length) {
			const count = readSync(fd, buffer, length, buffer.length - length, length);
			if (!count) break;
			length += count;
		}
		if (length > MAX_INSTRUCTION_BYTES)
			throw new Error("Project instructions exceed 64 KiB; truncation is not allowed");
		const content = decodeAnchoredText(buffer.subarray(0, length));
		const after = fstatSync(fd, { bigint: true });
		const named = lstatSync(target, { bigint: true });
		for (const stat of [before, after, named]) {
			if (
				!stat.isFile() ||
				stat.isSymbolicLink() ||
				stat.nlink !== 1n ||
				stat.dev !== selected.dev ||
				stat.ino !== selected.ino ||
				stat.mode !== selected.mode ||
				stat.size !== selected.size ||
				stat.mtimeNs !== selected.mtimeNs ||
				stat.ctimeNs !== selected.ctimeNs
			)
				throw new Error("Project instructions changed during snapshot");
		}
		for (const parent of parents) {
			const stat = lstatSync(parent.path, { bigint: true });
			if (
				!stat.isDirectory() ||
				stat.isSymbolicLink() ||
				stat.dev !== parent.stat.dev ||
				stat.ino !== parent.stat.ino
			)
				throw new Error("Project instruction ancestor changed during snapshot");
		}
		if (realpathSync(root) !== root || realpathSync(target) !== target)
			throw new Error("Project instruction path changed during snapshot");
		return Object.freeze({ path, digest: fileDigest(content), bytes: length, content });
	} finally {
		closeSync(fd);
	}
}
