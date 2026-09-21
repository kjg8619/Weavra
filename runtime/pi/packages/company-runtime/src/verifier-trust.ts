import { createHash } from "node:crypto";
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
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RegisteredBrowserCheck } from "./browser-types.ts";
import { isPolicyPath, isProtectedPath } from "./policy.ts";

/**
 * Verifier trust (V0.4B) pins *which* registered program and *which* direct local sources/oracle files the
 * trusted Host froze for this Run. It is integrity pinning only: not a sandbox, not permission, not approval,
 * and it does not replace Policy, R2/R3 review or human approval.
 */
export const VERIFIER_TRUST_MAX_FILES = 64;
export const VERIFIER_TRUST_MAX_FILE_BYTES = 4 * 1024 * 1024;
export const VERIFIER_TRUST_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const VERIFIER_TRUST_DOMAIN = "weavra-verifier-registration-v1";

export type VerifierTrustMode = "compatible" | "strict";
export type VerifierTrustStatus = "VERIFIED" | "UNVERIFIED" | "STALE" | "UNKNOWN";

/** Content digest plus filesystem generation; identical bytes in a recreated file are a different generation. */
export interface VerifierSourceSnapshot {
	path: string;
	sha256: string;
	dev: string;
	ino: string;
	mode: string;
	size: string;
	mtimeNs: string;
	ctimeNs: string;
}

export interface VerifierExecutableSnapshot {
	path: string;
	dev: string;
	ino: string;
	mode: string;
	size: string;
	mtimeNs: string;
	ctimeNs: string;
}

export interface VerifierTrustSnapshot {
	mode: VerifierTrustMode;
	registrationDigest: string;
	executableDigest: string;
	executable: VerifierExecutableSnapshot;
	sources: VerifierSourceSnapshot[];
	runtimeSources?: { root: string; sources: VerifierSourceSnapshot[] };
}

/** Bounded public projection stored in CheckResult/Evidence; never raw contents, env or credentials. */
export interface VerifierTrustEvidence {
	mode: VerifierTrustMode;
	status: VerifierTrustStatus;
	registrationDigest: string;
	executableDigest: string;
	sources: Array<{ path: string; digest: string }>;
}

export interface RegisteredCheckLike {
	id: string;
	kind: string;
	required: boolean;
	executable: string;
	args: readonly string[];
	cwd: string;
	timeout_ms: number;
	trust?: { files?: readonly string[] };
	browser?: RegisteredBrowserCheck;
}

/** Deterministic canonical form: sorted [key, value] pairs, independent of object insertion order. */
export function canonicalEnvironment(environment: Readonly<Record<string, string>>): Array<[string, string]> {
	return Object.entries(environment).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function sha256Of(value: unknown, domain: string): string {
	return createHash("sha256").update(JSON.stringify({ domain, value })).digest("hex");
}

function identity(stat: { dev: bigint; ino: bigint; mode: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }) {
	return {
		dev: stat.dev.toString(),
		ino: stat.ino.toString(),
		mode: stat.mode.toString(),
		size: stat.size.toString(),
		mtimeNs: stat.mtimeNs.toString(),
		ctimeNs: stat.ctimeNs.toString(),
	};
}

/** Literal workspace-relative path safety for a trusted source; built-in protected paths cannot be designated. */
function assertTrustPath(cwd: string, path: string, kind: "direct" | "declared"): string {
	if (!isPolicyPath(path) || isProtectedPath(path))
		throw new Error(`Verifier trust ${kind} source must be an unprotected literal workspace-relative path`);
	// The workspace root itself is Host-provided and trusted; the source's own path chain must be literal.
	const root = realpathSync(cwd);
	if (!lstatSync(root).isDirectory()) throw new Error("Unsafe verifier trust root");
	let current = root;
	const parts = path.split("/");
	for (const [index, part] of parts.entries()) {
		current = join(current, part);
		const stat = lstatSync(current);
		if (stat.isSymbolicLink()) throw new Error("Verifier trust source must not be a symlink");
		if (index < parts.length - 1 && !stat.isDirectory()) throw new Error("Unsafe verifier trust source path");
	}
	const stat = lstatSync(current);
	if (!stat.isFile() || stat.nlink !== 1) throw new Error("Verifier trust source must be a regular single-link file");
	return current;
}

function readBoundedSource(path: string, absolute: string, limit: number): { bytes: Buffer; stat: BigIntStats } {
	const fd = openSync(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const before = fstatSync(fd, { bigint: true });
		if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(limit))
			throw new Error("Verifier trust source exceeds size limit or is unsupported");
		const buffer = Buffer.alloc(Number(before.size) + 1);
		let length = 0;
		while (length < buffer.length) {
			const count = readSync(fd, buffer, length, buffer.length - length, length);
			if (!count) break;
			length += count;
		}
		const after = fstatSync(fd, { bigint: true });
		const pathStat = lstatSync(absolute, { bigint: true });
		if (
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.mode !== before.mode ||
			after.size !== before.size ||
			after.mtimeNs !== before.mtimeNs ||
			after.ctimeNs !== before.ctimeNs ||
			pathStat.dev !== before.dev ||
			pathStat.ino !== before.ino ||
			pathStat.isSymbolicLink()
		)
			throw new Error("Verifier trust source changed while it was read");
		if (length > limit) throw new Error("Verifier trust source exceeds size limit");
		void path;
		return { bytes: buffer.subarray(0, length), stat: after };
	} finally {
		closeSync(fd);
	}
}

/**
 * Existing direct-source heuristic, shared by Worker protection and the trust snapshot: a non-flag argument
 * that resolves to an existing regular file inside the workspace is a direct verifier source. Missing
 * arguments stay plain argv literals; only explicitly declared trust files may not be missing.
 */
export function resolveDirectVerifierSources(
	cwd: string,
	checkCwd: string,
	executable: string,
	args: readonly string[],
): string[] {
	const sources: string[] = [];
	for (const argument of [executable, ...args]) {
		if (argument.startsWith("-")) continue;
		const candidate = resolve(cwd, checkCwd, argument);
		const inside = relative(cwd, candidate);
		if (!inside || inside.startsWith("..") || inside.includes("\0")) continue;
		const path = inside.split("\\").join("/");
		if (sources.includes(path)) continue;
		try {
			if (lstatSync(candidate).isFile()) sources.push(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		}
	}
	return sources;
}

/**
 * Direct sources plus explicitly declared trust files. Direct candidates keep the historical heuristic
 * (missing arguments stay plain argv literals); declared files are fail-closed and must exist.
 */
export function resolveVerifierTrustSources(cwd: string, check: RegisteredCheckLike): string[] {
	const paths = resolveDirectVerifierSources(cwd, check.cwd, check.executable, check.args);
	if (check.browser) {
		for (const file of BROWSER_IMPLEMENTATION_FILES) {
			const path = relative(cwd, fileURLToPath(new URL(file, import.meta.url)));
			if (path && !path.startsWith("..") && !paths.includes(path)) paths.push(path);
		}
	}
	for (const declared of check.trust?.files ?? []) {
		assertTrustPath(cwd, declared, "declared");
		if (!paths.includes(declared)) paths.push(declared);
	}
	if (paths.length > VERIFIER_TRUST_MAX_FILES) throw new Error("Verifier trust source count exceeds the limit");
	return paths.sort();
}

export function snapshotVerifierSources(cwd: string, paths: readonly string[]): VerifierSourceSnapshot[] {
	const snapshots: VerifierSourceSnapshot[] = [];
	let total = 0;
	for (const path of paths) {
		const absolute = assertTrustPath(cwd, path, "direct");
		const { bytes, stat } = readBoundedSource(path, absolute, VERIFIER_TRUST_MAX_FILE_BYTES);
		total += bytes.length;
		if (total > VERIFIER_TRUST_MAX_TOTAL_BYTES) throw new Error("Verifier trust total size exceeds the limit");
		snapshots.push({
			path,
			sha256: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
			...identity(stat),
		});
	}
	return snapshots;
}

export const BROWSER_IMPLEMENTATION_FILES = [
	"browser-driver.ts",
	"browser-observation.ts",
	"browser-snapshot.ts",
	"browser-types.ts",
	"browser-evidence.ts",
	"verification.ts",
	"process-runner.ts",
	"verifier-trust.ts",
] as const;

/** Host-owned direct implementation sources, separate from the mutable document under test. */
export function snapshotBrowserImplementation() {
	const root = fileURLToPath(new URL("./", import.meta.url));
	return { root, sources: snapshotVerifierSources(root, BROWSER_IMPLEMENTATION_FILES) };
}

/** Frozen resolved executable identity; the Run never re-resolves PATH before execution. */
export function snapshotVerifierExecutable(executable: string): VerifierExecutableSnapshot {
	const resolved = realpathSync(executable);
	const stat = lstatSync(resolved, { bigint: true });
	if (!stat.isFile() || stat.nlink !== 1n) throw new Error("Verifier executable must be a regular single-link file");
	return { path: resolved, ...identity(stat) };
}

/** Actual SHA-256 of the resolved executable's frozen filesystem identity (not a concatenated label). */
export function executableIdentityDigest(executable: VerifierExecutableSnapshot): string {
	return `sha256:${sha256Of(
		{
			path: executable.path,
			dev: executable.dev,
			ino: executable.ino,
			mode: executable.mode,
			size: executable.size,
			mtimeNs: executable.mtimeNs,
			ctimeNs: executable.ctimeNs,
		},
		"weavra-verifier-executable-v1",
	)}`;
}

export function registrationDigestOf(input: {
	check: RegisteredCheckLike;
	executable: VerifierExecutableSnapshot;
	sources: readonly VerifierSourceSnapshot[];
	configDigest: string;
	trustMode: VerifierTrustMode;
	/** The exact filtered environment handed to the check process; hashed canonically, never printed. */
	environment: Readonly<Record<string, string>>;
	runtimeSources?: { root: string; sources: readonly VerifierSourceSnapshot[] };
}): string {
	return `sha256:${sha256Of(
		{
			checkId: input.check.id,
			kind: input.check.kind,
			required: input.check.required,
			executable: input.executable.path,
			executableIdentity: input.executable,
			argv: [...input.check.args],
			cwd: input.check.cwd,
			timeoutMs: input.check.timeout_ms,
			env: canonicalEnvironment(input.environment),
			configDigest: input.configDigest,
			trustMode: input.trustMode,
			sources: input.sources.map((source) => ({ path: source.path, sha256: source.sha256 })),
			...(input.check.browser ? { browser: input.check.browser } : {}),
			...(input.runtimeSources ? { runtimeSources: input.runtimeSources } : {}),
		},
		VERIFIER_TRUST_DOMAIN,
	)}`;
}

/** Re-validates executable identity and every frozen source. Any change, deletion or recreation is stale. */
export function validateVerifierTrust(
	cwd: string,
	snapshot: VerifierTrustSnapshot,
): { ok: boolean; reason?: string; status: VerifierTrustStatus } {
	try {
		const currentExecutable = snapshotVerifierExecutable(snapshot.executable.path);
		if (JSON.stringify(currentExecutable) !== JSON.stringify(snapshot.executable))
			return { ok: false, reason: "Verifier executable changed", status: "STALE" };
		if (
			snapshot.runtimeSources &&
			JSON.stringify(
				snapshotVerifierSources(
					snapshot.runtimeSources.root,
					snapshot.runtimeSources.sources.map((source) => source.path),
				),
			) !== JSON.stringify(snapshot.runtimeSources.sources)
		)
			return { ok: false, reason: "Browser verifier implementation changed", status: "STALE" };
		const current = snapshotVerifierSources(
			cwd,
			snapshot.sources.map((source) => source.path),
		);
		for (const [index, expected] of snapshot.sources.entries()) {
			const actual = current[index];
			if (!actual || actual.path !== expected.path)
				return { ok: false, reason: "Verifier trust source set changed", status: "STALE" };
			if (
				actual.sha256 !== expected.sha256 ||
				JSON.stringify(identityOf(actual)) !== JSON.stringify(identityOf(expected))
			)
				return { ok: false, reason: `Verifier trust source changed: ${expected.path}`, status: "STALE" };
		}
		return { ok: true, status: "VERIFIED" };
	} catch {
		return { ok: false, reason: "Verifier trust source unavailable", status: "STALE" };
	}
}

function identityOf(snapshot: VerifierSourceSnapshot): VerifierSourceSnapshot {
	return { ...snapshot, sha256: snapshot.sha256 };
}

export function verifierTrustEvidence(
	snapshot: VerifierTrustSnapshot,
	status: VerifierTrustStatus,
): VerifierTrustEvidence {
	return {
		mode: snapshot.mode,
		status,
		registrationDigest: snapshot.registrationDigest,
		executableDigest: snapshot.executableDigest,
		sources: snapshot.sources.map((source) => ({ path: source.path, digest: source.sha256 })),
	};
}
