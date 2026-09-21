import {
	closeSync,
	constants,
	fstatSync,
	ftruncateSync,
	lstatSync,
	openSync,
	readSync,
	realpathSync,
	unlinkSync,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import {
	ANCHORED_MAX_BYTES,
	type AnchoredReplacement,
	applyAnchoredReplacement,
	decodeAnchoredText,
	fileDigest,
	StaleAnchorError,
	StaleMutationError,
	snapshotText,
} from "./anchored-edit.ts";
import { isPolicyPath } from "./policy.ts";

/** Repeat path safety synchronously after the asynchronous Policy/audit boundary. */
function assertPath(cwd: string, path: string): string {
	if (!isPolicyPath(path) || realpathSync(cwd) !== cwd || !lstatSync(cwd).isDirectory())
		throw new Error("Unsafe anchored path");
	let current = cwd;
	const parts = path.split("/");
	for (const [index, part] of parts.entries()) {
		current = join(current, part);
		const stat = lstatSync(current);
		if (stat.isSymbolicLink() || (index < parts.length - 1 && !stat.isDirectory()))
			throw new Error("Unsafe anchored path");
	}
	return current;
}

/** Read-time filesystem identity. Host-side only; never shown to the model and never a permission. */
export interface AnchoredFileIdentity {
	dev: string;
	ino: string;
	mode: string;
	size: string;
	mtimeNs: string;
	ctimeNs: string;
}

function identityOf(stat: {
	dev: bigint;
	ino: bigint;
	mode: bigint;
	size: bigint;
	mtimeNs: bigint;
	ctimeNs: bigint;
}): AnchoredFileIdentity {
	return {
		dev: stat.dev.toString(),
		ino: stat.ino.toString(),
		mode: stat.mode.toString(),
		size: stat.size.toString(),
		mtimeNs: stat.mtimeNs.toString(),
		ctimeNs: stat.ctimeNs.toString(),
	};
}

export function sameAnchoredIdentity(a: AnchoredFileIdentity, b: AnchoredFileIdentity): boolean {
	return (
		a.dev === b.dev &&
		a.ino === b.ino &&
		a.mode === b.mode &&
		a.size === b.size &&
		a.mtimeNs === b.mtimeNs &&
		a.ctimeNs === b.ctimeNs
	);
}

/** Only a disappeared target/parent is a freshness failure; every other filesystem error stays fatal. */
function staleIfMissing(error: unknown, action: string): never {
	if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT")
		throw new StaleMutationError(`${action} target changed or is missing; re-read before mutating`);
	throw error;
}

function readBounded(fd: number): Buffer {
	const stat = fstatSync(fd);
	if (!stat.isFile() || stat.nlink !== 1 || stat.size > ANCHORED_MAX_BYTES)
		throw new Error("Unsupported anchored file");
	const buffer = Buffer.alloc(ANCHORED_MAX_BYTES + 1);
	let length = 0;
	while (length < buffer.length) {
		const count = readSync(fd, buffer, length, buffer.length - length, length);
		if (!count) break;
		length += count;
	}
	if (length > ANCHORED_MAX_BYTES) throw new Error("Anchored file exceeds size limit");
	return buffer.subarray(0, length);
}

/**
 * Strict read: content and filesystem identity are captured from one bounded snapshot. An unstable read
 * (changed dev/ino/mode/size/mtime/ctime between the two stats, or a path that no longer points at the
 * opened object) never produces a snapshot, so no receipt is issued for it.
 */
export function readAnchoredSnapshot(
	cwd: string,
	path: string,
): { snapshot: string; fileDigest: string; identity: AnchoredFileIdentity } {
	const identity = assertPath(cwd, path);
	const fd = openSync(identity, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(fd, { bigint: true });
		const text = decodeAnchoredText(readBounded(fd));
		const after = fstatSync(fd, { bigint: true });
		const pathStat = lstatSync(identity, { bigint: true });
		if (
			pathStat.dev !== before.dev ||
			pathStat.ino !== before.ino ||
			pathStat.isSymbolicLink() ||
			after.nlink !== 1n ||
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.mode !== before.mode ||
			after.size !== before.size ||
			after.mtimeNs !== before.mtimeNs ||
			after.ctimeNs !== before.ctimeNs
		)
			throw new StaleAnchorError("file changed while it was read");
		return { snapshot: snapshotText(identity, text), fileDigest: fileDigest(text), identity: identityOf(after) };
	} finally {
		closeSync(fd);
	}
}

export function readAnchoredFile(cwd: string, path: string): string {
	return readAnchoredSnapshot(cwd, path).snapshot;
}

/** Called only after Policy ALLOW. No create, truncate-on-open, async gap, or reopen for writing. */
export function editAnchoredFile(
	cwd: string,
	path: string,
	input: AnchoredReplacement,
	signal: AbortSignal,
	expectedIdentity?: AnchoredFileIdentity,
): void {
	signal.throwIfAborted();
	let identity: string;
	try {
		identity = assertPath(cwd, path);
	} catch (error) {
		staleIfMissing(error, "edit");
	}
	let fd: number;
	try {
		fd = openSync(identity, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		staleIfMissing(error, "edit");
	}
	try {
		const before = fstatSync(fd, { bigint: true });
		// Read-time identity binding: identical bytes in a recreated file are still a different generation.
		if (expectedIdentity && !sameAnchoredIdentity(expectedIdentity, identityOf(before)))
			throw new StaleMutationError("edit target is not the file that was read; re-read before mutating");
		const bytes = readBounded(fd);
		const replacement = Buffer.from(applyAnchoredReplacement(identity, decodeAnchoredText(bytes), input));
		// Detect changes during computation, including an external rename replacing the path.
		if (!readBounded(fd).equals(bytes)) throw new StaleAnchorError("file changed before apply");
		const pathStat = (() => {
			try {
				assertPath(cwd, path);
				return lstatSync(identity, { bigint: true });
			} catch (error) {
				staleIfMissing(error, "edit");
			}
		})();
		const after = fstatSync(fd, { bigint: true });
		if (
			pathStat.dev !== before.dev ||
			pathStat.ino !== before.ino ||
			pathStat.isSymbolicLink() ||
			after.nlink !== 1n ||
			after.size !== before.size ||
			after.mode !== before.mode ||
			after.mtimeNs !== before.mtimeNs ||
			after.ctimeNs !== before.ctimeNs
		)
			throw new StaleAnchorError("file identity changed before apply");
		signal.throwIfAborted();
		// No JS yield from validation to effect. POSIX does not provide CAS against uncooperative external writers.
		let written = 0;
		while (written < replacement.length) {
			const count = writeSync(fd, replacement, written, replacement.length - written, written);
			if (!count) throw new Error("Anchored write made no progress");
			written += count;
		}
		ftruncateSync(fd, replacement.length);
	} finally {
		closeSync(fd);
	}
}

/** Same bounded strict-UTF-8 text contract as anchored existing-file reads: NUL and non-round-tripping text are rejected. */
function assertTextContent(content: string): Buffer {
	const bytes = Buffer.from(content, "utf8");
	if (bytes.length > ANCHORED_MAX_BYTES) throw new Error("Anchored content exceeds size limit");
	if (bytes.includes(0)) throw new Error("Anchored content must be bounded non-binary strict UTF-8 text");
	// decodeAnchoredText re-validates size/NUL/round-trip on the byte level; the string comparison also
	// rejects inputs whose UTF-8 encoding is lossy (for example unpaired surrogates).
	if (decodeAnchoredText(bytes) !== content) throw new Error("Anchored content must be strict UTF-8");
	return bytes;
}

/** Parent chain only: the target may not exist yet. No mkdir; every parent must already be a real directory. */
function assertParentPath(cwd: string, path: string): string {
	if (!isPolicyPath(path) || realpathSync(cwd) !== cwd || !lstatSync(cwd).isDirectory())
		throw new Error("Unsafe anchored path");
	const parts = path.split("/");
	let current = cwd;
	for (const [index, part] of parts.entries()) {
		if (index === parts.length - 1) return join(current, part);
		current = join(current, part);
		const stat = lstatSync(current);
		if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Unsafe anchored path");
	}
	throw new Error("Unsafe anchored path");
}

/** Strict create: OS exclusive create only. No overwrite, truncate, append or mkdir; an existing target fails. */
export function createAnchoredFile(cwd: string, path: string, content: string, signal: AbortSignal): void {
	signal.throwIfAborted();
	const bytes = assertTextContent(content);
	const identity = assertParentPath(cwd, path);
	let fd: number;
	try {
		fd = openSync(
			identity,
			constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_NONBLOCK,
			0o600,
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST")
			throw new StaleMutationError("target already exists; strict create never overwrites");
		throw error;
	}
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.nlink !== 1) throw new Error("Unsupported anchored target");
		signal.throwIfAborted();
		let written = 0;
		while (written < bytes.length) {
			const count = writeSync(fd, bytes, written, bytes.length - written, written);
			if (!count) throw new Error("Anchored write made no progress");
			written += count;
		}
	} catch (error) {
		// Never leave a partial file behind for a failed create of a file this process just created.
		closeSync(fd);
		try {
			unlinkSync(identity);
		} catch {
			// Best effort only; the failure below is the authoritative outcome.
		}
		throw error;
	}
	closeSync(fd);
}

/** Strict replace: an existing regular file only. No create fallback and no truncate-on-open. */
export function replaceAnchoredFile(
	cwd: string,
	path: string,
	content: string,
	expectedDigest: string,
	signal: AbortSignal,
	expectedIdentity?: AnchoredFileIdentity,
): void {
	signal.throwIfAborted();
	const bytes = assertTextContent(content);
	let identity: string;
	try {
		identity = assertPath(cwd, path);
	} catch (error) {
		staleIfMissing(error, "replace");
	}
	let fd: number;
	try {
		fd = openSync(identity, constants.O_RDWR | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT")
			throw new StaleMutationError("replace target is missing; strict replace never creates");
		throw error;
	}
	try {
		const before = fstatSync(fd, { bigint: true });
		// Read-time identity binding: recreate-with-identical-bytes is a different generation.
		if (expectedIdentity && !sameAnchoredIdentity(expectedIdentity, identityOf(before)))
			throw new StaleMutationError("replace target is not the file that was read; re-read before replacing");
		// Existing source must still be a bounded, strict UTF-8, single-link regular file at the exact read generation.
		const source = decodeAnchoredText(readBounded(fd));
		if (fileDigest(source) !== expectedDigest)
			throw new StaleMutationError("file changed since the read receipt; re-read before replacing");
		const current = (() => {
			try {
				assertPath(cwd, path);
				return lstatSync(identity, { bigint: true });
			} catch (error) {
				staleIfMissing(error, "replace");
			}
		})();
		const after = fstatSync(fd, { bigint: true });
		if (
			current.dev !== before.dev ||
			current.ino !== before.ino ||
			current.isSymbolicLink() ||
			after.nlink !== 1n ||
			after.size !== before.size ||
			after.mode !== before.mode ||
			after.mtimeNs !== before.mtimeNs ||
			after.ctimeNs !== before.ctimeNs
		)
			throw new StaleMutationError("file identity changed before replace");
		signal.throwIfAborted();
		// No JS yield from validation to effect. POSIX does not provide CAS against uncooperative external writers.
		let written = 0;
		while (written < bytes.length) {
			const count = writeSync(fd, bytes, written, bytes.length - written, written);
			if (!count) throw new Error("Anchored write made no progress");
			written += count;
		}
		ftruncateSync(fd, bytes.length);
	} finally {
		closeSync(fd);
	}
}
