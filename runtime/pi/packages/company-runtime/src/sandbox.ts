import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ProcessResult } from "./process-runner.ts";
import { runProcess } from "./process-runner.ts";

/**
 * Verifier Sandbox (V0.4C): an OS-level boundary for registered verification check processes only.
 * It is integrity/containment for *that* process — not permission, approval, review or completion authority.
 * Workers, LSP, Git and the launcher keep the existing (unsandboxed) execution path.
 */
export const SRT_PACKAGE = "@anthropic-ai/sandbox-runtime";
export const SRT_VERSION = "0.0.76";
export const SANDBOX_POLICY_DOMAIN = "weavra-verifier-sandbox-v2";
const BACKEND_DOMAIN = "weavra-verifier-sandbox-backend-v1";

export type SandboxMode = "disabled" | "required";
export type SandboxStatus = "ENFORCED" | "UNAVAILABLE" | "STALE" | "UNKNOWN";

export interface SandboxBackend {
	/** Pinned package entry and Host-owned target-outcome boundary. */
	cliPath: string;
	packageRoot: string;
	version: string;
	dev: string;
	ino: string;
	mode: string;
	size: string;
	mtimeNs: string;
	ctimeNs: string;
	identityDigest: string;
	driverPath: string;
	boundaryFiles: { path: string; identityDigest: string; contentDigest: string }[];
}

/** Bounded public projection stored in CheckResult; never settings JSON, env, HOME or absolute protected paths. */
export interface SandboxEvidence {
	mode: SandboxMode;
	status: SandboxStatus;
	backend: string;
	backendVersion: string;
	policyDigest: string;
}

export interface SandboxPolicyDigest {
	policyDigest: string;
	networkMode: "deny-all";
	workspaceRead: boolean;
	workspaceWrite: boolean;
	denyReadCount: number;
	denyWriteCount: number;
}

export interface SandboxPolicySnapshot extends SandboxPolicyDigest {
	backend: SandboxBackend;
	/** Canonical (realpath) settings payload; Host-owned and never project-derived. */
	settings: {
		filesystem: { denyRead: string[]; allowRead: string[]; allowWrite: string[]; denyWrite: string[] };
		network: { allowedDomains: string[]; deniedDomains: string[] };
	};
}

export class SandboxUnavailableError extends Error {
	constructor(reason: string) {
		super(`Verifier sandbox unavailable: ${reason}`);
		this.name = "SandboxUnavailableError";
	}
}

function sha256Of(value: unknown, domain: string): string {
	return createHash("sha256").update(JSON.stringify({ domain, value })).digest("hex");
}

function identityOf(path: string) {
	const stat = statSync(path, { bigint: true });
	return {
		dev: stat.dev.toString(),
		ino: stat.ino.toString(),
		mode: stat.mode.toString(),
		size: stat.size.toString(),
		mtimeNs: stat.mtimeNs.toString(),
		ctimeNs: stat.ctimeNs.toString(),
	};
}

function identityDigest(path: string, identity: ReturnType<typeof identityOf>): string {
	return `sha256:${sha256Of({ path, ...identity }, BACKEND_DOMAIN)}`;
}

/** Identity digest of a CLI path; the Host reuses this to freeze and to revalidate the backend. */
export function sandboxBackendIdentity(path: string): string {
	return identityDigest(path, identityOf(path));
}

/** Full backend fingerprint for a CLI path (test/composition seam; no production bypass). */
export function sandboxBackendFingerprint(path: string) {
	const identity = identityOf(path);
	return { ...identity, identityDigest: identityDigest(path, identity) };
}

/** Backend freshness: the same CLI filesystem object must still exist. Recreate/replace is STALE. */
export function validateSandboxBackend(snapshot: SandboxBackend): { ok: boolean; reason?: string } {
	try {
		if (snapshot.boundaryFiles[0]?.path !== snapshot.driverPath)
			return { ok: false, reason: "Verifier sandbox outcome driver changed" };
		const current = identityOf(snapshot.cliPath);
		for (const key of ["dev", "ino", "mode", "size", "mtimeNs", "ctimeNs"] as const)
			if (current[key] !== snapshot[key]) return { ok: false, reason: `Verifier sandbox backend ${key} changed` };
		if (identityDigest(snapshot.cliPath, current) !== snapshot.identityDigest)
			return { ok: false, reason: "Verifier sandbox backend identity digest changed" };
		for (const file of snapshot.boundaryFiles) {
			if (
				sandboxBackendIdentity(file.path) !== file.identityDigest ||
				createHash("sha256").update(readFileSync(file.path)).digest("hex") !== file.contentDigest
			)
				return { ok: false, reason: "Verifier sandbox outcome boundary changed" };
		}
		return { ok: true };
	} catch {
		return { ok: false, reason: "Verifier sandbox backend is unavailable" };
	}
}

export interface SandboxBackendProbe {
	ok: boolean;
	reason?: string;
}

/**
 * Host-owned no-op probe: proves the OS backend really initializes before any worker model interaction.
 * It never runs project code or oracle files and never falls back to an unsandboxed process.
 */
export async function probeSandboxBackend(snapshot: SandboxPolicySnapshot): Promise<SandboxBackendProbe> {
	try {
		const { result, status } = await runSandboxedCheck({
			snapshot,
			executable: process.execPath,
			argv: ["-e", "process.exit(0)"],
			cwd: snapshot.settings.filesystem.allowRead[0],
			env: { PATH: "/usr/bin:/bin" },
			timeoutMs: 30000,
		});
		// The probe exercises the same target-outcome boundary as every registered check.
		if (status !== "ENFORCED" || result.reason !== "exited" || result.exitCode !== 0)
			return {
				ok: false,
				reason: `Verifier sandbox backend probe failed (${result.reason} exit ${result.exitCode ?? "none"}): ${(result.stderr || result.stdout || "").trim().slice(0, 300)}`,
			};
		if (!result.cleanupConfirmed) return { ok: false, reason: "Verifier sandbox backend probe cleanup unconfirmed" };
		if (!validateSandboxBackend(snapshot.backend).ok)
			return { ok: false, reason: "Verifier sandbox backend changed during the probe" };
		return { ok: true };
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : "Verifier sandbox probe failed" };
	}
}

/**
 * Host-frozen backend: the SRT CLI entry resolved from the installed package, exact-version checked.
 * Missing package, unreadable metadata, wrong version or a missing CLI entry all fail closed.
 */
export function resolveSandboxBackend(): SandboxBackend {
	const require = createRequire(import.meta.url);
	let packageJsonPath: string;
	try {
		packageJsonPath = require.resolve(`${SRT_PACKAGE}/package.json`);
	} catch {
		throw new SandboxUnavailableError(`${SRT_PACKAGE} is not installed`);
	}
	const packageRoot = dirname(packageJsonPath);
	const metadata = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
		version?: string;
		bin?: Record<string, string>;
	};
	if (metadata.version !== SRT_VERSION)
		throw new SandboxUnavailableError(
			`${SRT_PACKAGE} version ${metadata.version ?? "unknown"} is not ${SRT_VERSION}`,
		);
	const entry = metadata.bin?.srt;
	if (!entry) throw new SandboxUnavailableError(`${SRT_PACKAGE} exposes no srt CLI entry`);
	const cliPath = realpathSync(join(packageRoot, entry));
	const identity = identityOf(cliPath);
	const driverPath = fileURLToPath(new URL("./sandbox-driver.mjs", import.meta.url));
	const boundaryFiles = [
		driverPath,
		fileURLToPath(new URL("./sandbox-target.mjs", import.meta.url)),
		require.resolve(SRT_PACKAGE),
	].map((path) => ({
		path,
		identityDigest: sandboxBackendIdentity(path),
		contentDigest: createHash("sha256").update(readFileSync(path)).digest("hex"),
	}));
	return {
		cliPath,
		packageRoot,
		version: metadata.version,
		...identity,
		identityDigest: identityDigest(cliPath, identity),
		driverPath,
		boundaryFiles,
	};
}

/** Canonical Host path: existing paths resolve to realpath; missing tails append to the nearest existing ancestor. */
export function canonicalHostPath(path: string): string {
	let current = path;
	const tail: string[] = [];
	for (;;) {
		try {
			return [realpathSync(current), ...tail.reverse()].join(sep);
		} catch {
			const parent = dirname(current);
			if (parent === current) return path;
			tail.push(current.slice(parent.length + 1));
			current = parent;
		}
	}
}

/**
 * Fixed Host-owned sandbox policy. Network is deny-all, workspace write is allowed for tool compatibility,
 * protected and trusted oracle paths are write-denied, and protected/secret paths stay read-denied even
 * inside the workspace allow-read carve-out.
 */
export function buildSandboxPolicy(input: {
	workspace: string;
	/** Canonical workspace-relative paths the verifier may read (trusted oracle/sources). */
	trustedSources: readonly string[];
	/** Canonical workspace-relative paths denied for read+write (project instruction, .git/.ai, .env, credentials). */
	protectedPaths: readonly string[];
	/** Test seam: replace the frozen backend identity so digest binding can be verified without touching node_modules. */
	identityOverrideForTest?: string;
}): SandboxPolicySnapshot {
	const workspace = canonicalHostPath(input.workspace);
	// Workspace-relative policy entries resolve against the canonical workspace root; absolute entries stay as-is.
	const resolvePolicyPath = (path: string) => canonicalHostPath(path.startsWith("/") ? path : join(workspace, path));
	const protect = [...new Set(input.protectedPaths.map(resolvePolicyPath))].sort();
	const settings = {
		filesystem: {
			// denyRead broad (HOME), then allowRead the workspace carve-out, while specific protected paths stay denied.
			denyRead: [...protect, canonicalHostPath(tmpdir()), canonicalHostPath(process.env.HOME ?? "")]
				.filter(Boolean)
				.sort(),
			// Host-owned system read roots: required to execute the resolved verifier program itself.
			// These are constants, never project config; HOME and Host secrets stay denied below.
			allowRead: [
				workspace,
				...[
					dirname(dirname(process.execPath)),
					"/usr",
					"/lib",
					"/lib64",
					"/etc/ld.so.cache",
					"/opt/hostedtoolcache",
				].filter((path) => existsSync(path)),
			],
			allowWrite: [workspace],
			// denyWrite wins over allowWrite: oracle sources and protected paths are never writable.
			denyWrite: [...protect, ...input.trustedSources.map(resolvePolicyPath)].sort(),
		},
		network: { allowedDomains: [] as string[], deniedDomains: [] as string[] },
	};
	const resolvedBackend = resolveSandboxBackend();
	const backend = input.identityOverrideForTest
		? { ...resolvedBackend, identityDigest: input.identityOverrideForTest }
		: resolvedBackend;
	// The digest binds the exact canonical settings and the backend identity, not a summary of them.
	const policyDigest = `sha256:${sha256Of(
		{
			schema: "v2",
			backend: {
				package: SRT_PACKAGE,
				version: backend.version,
				identityDigest: backend.identityDigest,
				boundaryFiles: backend.boundaryFiles,
			},
			canonicalSettings: {
				filesystem: {
					denyRead: [...settings.filesystem.denyRead].sort(),
					allowRead: [...settings.filesystem.allowRead].sort(),
					allowWrite: [...settings.filesystem.allowWrite].sort(),
					denyWrite: [...settings.filesystem.denyWrite].sort(),
				},
				network: {
					allowedDomains: [...settings.network.allowedDomains].sort(),
					deniedDomains: [...settings.network.deniedDomains].sort(),
				},
			},
		},
		SANDBOX_POLICY_DOMAIN,
	)}`;
	return {
		backend,
		settings,
		policyDigest,
		networkMode: "deny-all",
		workspaceRead: true,
		workspaceWrite: true,
		denyReadCount: settings.filesystem.denyRead.length,
		denyWriteCount: settings.filesystem.denyWrite.length,
	};
}

export function sandboxEvidence(snapshot: SandboxPolicySnapshot, status: SandboxStatus): SandboxEvidence {
	return {
		mode: "required",
		status,
		backend: "srt",
		backendVersion: snapshot.backend.version,
		policyDigest: snapshot.policyDigest,
	};
}

/**
 * Runs one registered check inside the frozen sandbox. Settings live outside the workspace, are mode 0600,
 * have an unpredictable name, are used only for this invocation and are removed afterwards.
 * A Host-owned supervisor reports actual target exit on a dedicated pipe not inherited by the target.
 */
export async function runSandboxedCheck(input: {
	snapshot: SandboxPolicySnapshot;
	executable: string;
	argv: readonly string[];
	cwd: string;
	env: Record<string, string>;
	timeoutMs: number;
	signal?: AbortSignal;
}): Promise<{ result: ProcessResult; status: SandboxStatus }> {
	let target: { kind: "exited" | "signal" | "unavailable"; exitCode: number | null } | undefined;
	const backendState = validateSandboxBackend(input.snapshot.backend);
	if (!backendState.ok)
		return {
			result: {
				reason: "unavailable" as const,
				exitCode: null,
				stdout: "",
				stderr: "",
				startedAt: Date.now(),
				finishedAt: Date.now(),
				cleanupConfirmed: true,
			},
			status: "UNAVAILABLE" as SandboxStatus,
		};
	const directory = mkdtempSync(join(tmpdir(), "weavra-sandbox-"));
	const settingsPath = join(directory, "settings.json");
	try {
		writeFileSync(settingsPath, JSON.stringify(input.snapshot.settings), { mode: 0o600 });
		const result = await runProcess({
			executable: process.execPath,
			argv: [input.snapshot.backend.driverPath, settingsPath, input.executable, ...input.argv],
			cwd: input.cwd,
			env: input.env,
			timeoutMs: input.timeoutMs,
			signal: input.signal,
			controlFd: true,
		});
		if (result.reason === "exited" && result.exitCode === 0 && result.cleanupConfirmed) {
			try {
				const report: unknown = JSON.parse(result.controlOutput ?? "");
				if (report && typeof report === "object" && "version" in report && report.version === 1) {
					const boundary = "boundary" in report ? report.boundary : undefined;
					const outcome = "target" in report ? report.target : undefined;
					if (
						boundary &&
						typeof boundary === "object" &&
						"exitCode" in boundary &&
						boundary.exitCode === 0 &&
						"signal" in boundary &&
						boundary.signal === null &&
						outcome &&
						typeof outcome === "object" &&
						"version" in outcome &&
						outcome.version === 1 &&
						"kind" in outcome &&
						"exitCode" in outcome &&
						"signal" in outcome
					) {
						if (
							outcome.kind === "exited" &&
							Number.isInteger(outcome.exitCode) &&
							typeof outcome.exitCode === "number" &&
							outcome.exitCode >= 0 &&
							outcome.exitCode <= 255 &&
							outcome.signal === null
						)
							target = { kind: "exited", exitCode: outcome.exitCode };
						else if (
							outcome.kind === "signal" &&
							outcome.exitCode === null &&
							typeof outcome.signal === "string" &&
							outcome.signal.startsWith("SIG")
						)
							target = { kind: "signal", exitCode: null };
						else if (outcome.kind === "unavailable" && outcome.exitCode === null)
							target = { kind: "unavailable", exitCode: null };
					}
				}
			} catch {
				// Missing, truncated or duplicate frames are not target evidence.
			}
		}
		const status: SandboxStatus = !validateSandboxBackend(input.snapshot.backend).ok
			? "STALE"
			: target && target.kind !== "unavailable"
				? "ENFORCED"
				: "UNAVAILABLE";
		return {
			result: {
				...result,
				exitCode: target?.exitCode ?? null,
				reason: result.reason === "exited" && !target ? "unavailable" : result.reason,
			},
			status,
		};
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
}
