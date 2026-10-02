import { createHash } from "node:crypto";
import { type BigIntStats, constants, type Stats } from "node:fs";
import { lstat, open, readdir, readFile, readlink, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { CheckoutIdentity, Run } from "./contracts.ts";
import { OBSERVATION_FILES, ownedObservationPaths } from "./observation-files.ts";
import { evaluatePolicy, isPolicyPath, type PolicyContext } from "./policy.ts";
import { FilePolicyPathInspector } from "./policy-paths.ts";
import type { ComplexWorkspaceImages, WorkspaceFileImage } from "./ports.ts";
import { ProcessCleanupError, resolveExecutable, runProcess, verificationEnvironment } from "./process-runner.ts";
import { changedLineCount } from "./quick.ts";

type Fingerprint = { mode: number; length: number; hash: string };
type FileImage =
	| (Fingerprint & { kind: "text"; text: string })
	| (Fingerprint & { kind: "opaque" })
	| (Fingerprint & { kind: "symlink" });
type Capture = { images: Map<string, FileImage>; head: string; index: string; gitConfig: string };
function captureDigest(capture: Capture, evidenceMode?: WorkspaceEvidenceOptions["evidenceMode"]): string {
	return hash(
		JSON.stringify({
			head: capture.head,
			index: capture.index,
			gitConfig: capture.gitConfig,
			files: [...capture.images].map(([path, image]) =>
				evidenceMode ? [path, image.kind, image.mode, image.length, image.hash] : [path, image.mode, image.hash],
			),
		}),
	);
}
export interface WorkspaceEvidenceOptions {
	readonly allowedPaths: readonly string[];
	readonly evidenceMode?: "bounded-monorepo";
}
/** Capacity is finite-profile exhaustion; unsupported is a path/type/Git shape; unavailable is IO or cancellation. */
export class WorkspaceEvidenceError extends Error {
	readonly kind: "capacity" | "unsupported" | "unavailable";
	constructor(kind: WorkspaceEvidenceError["kind"], message: string, cause?: unknown) {
		super(message, { cause });
		this.name = "WorkspaceEvidenceError";
		this.kind = kind;
	}
}
const MiB = 1024 * 1024;
const defaultLimits = { output: 2 * MiB, files: 5000, bytes: 32 * MiB, file: 2 * MiB } as const;
const monorepoLimits = { output: 8 * MiB, files: 50000, bytes: 512 * MiB, file: 64 * MiB } as const;
const textOf = (image: FileImage | undefined): string | undefined => (image?.kind === "text" ? image.text : undefined);
const sameIdentity = (a: BigIntStats, b: BigIntStats): boolean =>
	a.dev === b.dev &&
	a.ino === b.ino &&
	a.mode === b.mode &&
	a.nlink === b.nlink &&
	a.size === b.size &&
	a.mtimeNs === b.mtimeNs &&
	a.ctimeNs === b.ctimeNs;

/** One finite capture, including Git subprocesses. Cancellation never returns a partial image map. */
async function boundedCapture<T>(signal: AbortSignal | undefined, action: (signal: AbortSignal) => Promise<T>) {
	const controller = new AbortController();
	const timeout = setTimeout(
		() => controller.abort(new WorkspaceEvidenceError("capacity", "Workspace evidence capture deadline")),
		60000,
	);
	const combined = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
	try {
		combined.throwIfAborted();
		const result = await action(combined);
		combined.throwIfAborted();
		return result;
	} finally {
		clearTimeout(timeout);
	}
}
export interface DiffEvidence extends NonNullable<Run["workspace"]> {
	diff: string;
}
const owned = new Set([".ai/state.json", ".ai/tasks.json", ".ai/writer.lock", ".ai/writer.lock.recovery"]);
/** Runtime-owned: canonical state, projection, lock/recovery guard and immutable terminal-run archives. */
export const isRuntimeOwnedPath = (path: string): boolean =>
	owned.has(path) || /^\.ai\/runs\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.json$/.test(path);
const hash = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");
/** The clean-start status command; `workflow.derive` lists leftovers with exactly this one (COMPLEX_RERUN.md §5). */
const CLEAN_START_STATUS = ["status", "--porcelain=v1", "-z", "--untracked-files=all"] as const;

/**
 * The paths of `git status --porcelain=v1 -z` output that fail the clean-start check, sorted and unique: every
 * entry's path, and the original path of a rename or copy (the next field, without a status prefix), except
 * Runtime-owned and generated observation paths.
 */
export function cleanStartBlockers(status: string, generated: ReadonlySet<string>): string[] {
	const fields = status.split("\0");
	const paths = new Set<string>();
	for (let index = 0; index < fields.length; index++) {
		const entry = fields[index];
		if (!entry) continue;
		paths.add(entry.slice(3));
		if (/[RC]/.test(entry.slice(0, 2)) && fields[index + 1]) paths.add(fields[++index]);
	}
	return [...paths].filter((path) => !isRuntimeOwnedPath(path) && !generated.has(path)).sort();
}

/** Git under the fixed Runtime flags: no optional locks, fsmonitor or hooks, the verification environment. */
function runGit(
	git: string,
	cwd: string,
	argv: readonly string[],
	signal?: AbortSignal,
	maxOutputBytes = defaultLimits.output,
) {
	return runProcess({
		executable: git,
		argv: ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...argv],
		cwd,
		env: verificationEnvironment(),
		timeoutMs: 10000,
		signal,
		maxOutputBytes,
	});
}

/**
 * Read-only leftover listing for `workflow.derive` (COMPLEX_RERUN.md §5): the start check's status command and
 * filters from the project root, without opening a workspace, a writer or a baseline. Null when Git cannot answer
 * (the project is not its Git root, or the process failed, timed out or was not confirmed stopped): the state is then
 * unknown, never clean.
 */
export async function readCleanStartBlockers(project: string, signal?: AbortSignal): Promise<string[] | null> {
	try {
		const cwd = await realpath(project);
		const git = await resolveExecutable("git", verificationEnvironment().PATH);
		const read = async (argv: readonly string[]): Promise<string> => {
			const result = await runGit(git, cwd, argv, signal);
			if (!result.cleanupConfirmed || result.reason !== "exited" || result.exitCode !== 0)
				throw new Error("Git status unavailable");
			return result.stdout;
		};
		if ((await realpath((await read(["rev-parse", "--show-toplevel"])).trim())) !== cwd) return null;
		const generated = await ownedObservationPaths(cwd);
		return cleanStartBlockers(await read(CLEAN_START_STATUS), generated);
	} catch {
		return null;
	}
}

/** Shared read-only collector. It holds link admission, never a reusable evidence baseline or writer. */
class WorkspaceEvidenceCollector {
	readonly cwd: string;
	private readonly git: string;
	readonly paths: FilePolicyPathInspector;
	readonly options: WorkspaceEvidenceOptions;
	private readonly limits: typeof defaultLimits | typeof monorepoLimits;
	private readonly admittedLinks = new Set<string>();
	private activeCommands = 0;
	private cleanupUncertain = false;
	get safeToRelease(): boolean {
		return this.activeCommands === 0 && !this.cleanupUncertain;
	}
	private constructor(git: string, paths: FilePolicyPathInspector, options: WorkspaceEvidenceOptions) {
		this.cwd = paths.projectPath;
		this.git = git;
		this.paths = paths;
		this.options = structuredClone(options);
		this.limits = options.evidenceMode ? monorepoLimits : defaultLimits;
	}
	static async create(cwd: string, options: WorkspaceEvidenceOptions): Promise<WorkspaceEvidenceCollector> {
		const frozen = structuredClone(options);
		if (frozen.evidenceMode !== undefined && frozen.evidenceMode !== "bounded-monorepo")
			throw new WorkspaceEvidenceError("unsupported", "Unsupported workspace evidence mode");
		const paths = await FilePolicyPathInspector.open(cwd);
		const git = await resolveExecutable("git", verificationEnvironment().PATH);
		return new WorkspaceEvidenceCollector(git, paths, frozen);
	}
	private async command(argv: string[], signal?: AbortSignal): Promise<string> {
		signal?.throwIfAborted();
		if (this.cleanupUncertain) throw new ProcessCleanupError();
		this.activeCommands++;
		try {
			const result = await runGit(this.git, this.cwd, argv, signal, this.limits.output).catch(() => {
				this.cleanupUncertain = true;
				throw new ProcessCleanupError();
			});
			if (!result.cleanupConfirmed) {
				this.cleanupUncertain = true;
				throw new ProcessCleanupError();
			}
			signal?.throwIfAborted();
			if (result.reason !== "exited" || result.exitCode !== 0)
				throw new WorkspaceEvidenceError(
					result.reason === "output-limit" ? "capacity" : "unavailable",
					"Git evidence collection failed",
				);
			return result.stdout;
		} finally {
			this.activeCommands--;
		}
	}
	async assertClean(signal?: AbortSignal): Promise<void> {
		const generated = await ownedObservationPaths(this.cwd);
		if (cleanStartBlockers(await this.command([...CLEAN_START_STATUS], signal), generated).length)
			throw new Error("Dirty workspace: preserve existing changes; no automatic cleanup was performed");
	}
	async initialize(signal: AbortSignal): Promise<string> {
		if ((await realpath((await this.command(["rev-parse", "--show-toplevel"], signal)).trim())) !== this.cwd)
			throw new WorkspaceEvidenceError("unsupported", "Run must start at the Git project root");
		const index = await this.command(["ls-files", "--stage", "-z"], signal);
		const entries = index.split("\0").filter(Boolean);
		if (entries.length > this.limits.files)
			throw new WorkspaceEvidenceError("capacity", "Workspace evidence file limit");
		const generated = await ownedObservationPaths(this.cwd);
		for (const entry of entries) {
			const match = /^(\d{6}) [a-f0-9]+ ([0-3])\t(.+)$/.exec(entry);
			if (!match || match[2] !== "0")
				throw new WorkspaceEvidenceError("unsupported", "Unsupported staged index entry");
			const [, mode, , path] = match;
			if (mode === "160000")
				throw new WorkspaceEvidenceError("unsupported", "Submodules are unsupported in the first slice");
			if (isRuntimeOwnedPath(path) || generated.has(path))
				throw new WorkspaceEvidenceError("unsupported", "Runtime operating files must not be tracked in Git");
			if (this.options.evidenceMode && mode === "120000" && !this.editable(path)) this.admittedLinks.add(path);
		}
		return index;
	}
	private async controlHash(signal: AbortSignal): Promise<string> {
		const path = (await this.command(["rev-parse", "--git-path", "config"], signal)).trim();
		return hash(await readFile(resolve(this.cwd, path)));
	}
	private editable(path: string): boolean {
		return this.options.allowedPaths.some((root) => path === root || path.startsWith(`${root}/`));
	}
	/** Validate ancestors before touching the leaf, including when the leaf is missing or is an admitted link. */
	private async ancestors(path: string): Promise<Array<{ path: string; stat: BigIntStats }> | undefined> {
		const ancestors: Array<{ path: string; stat: BigIntStats }> = [];
		let current = this.cwd;
		for (const part of ["", ...path.split("/").slice(0, -1)]) {
			current = join(current, part);
			let stat: BigIntStats;
			try {
				stat = await lstat(current, { bigint: true });
			} catch (error) {
				if (error instanceof Error && "code" in error && error.code === "ENOENT") return undefined;
				throw error;
			}
			if (!stat.isDirectory() || stat.isSymbolicLink())
				throw new WorkspaceEvidenceError("unsupported", "Unsafe workspace path");
			ancestors.push({ path: current, stat });
		}
		return ancestors;
	}
	private async assertAncestors(ancestors: Array<{ path: string; stat: BigIntStats }>): Promise<void> {
		for (const { path, stat } of ancestors) {
			const current = await lstat(path, { bigint: true });
			if (!current.isDirectory() || current.dev !== stat.dev || current.ino !== stat.ino)
				throw new WorkspaceEvidenceError("unavailable", "Workspace ancestor changed during capture");
		}
	}
	private async images(signal: AbortSignal): Promise<Map<string, FileImage>> {
		const names = new Set(
			(await this.command(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], signal))
				.split("\0")
				.filter((path) => path && !isRuntimeOwnedPath(path)),
		);
		names.add(".ai/config.yaml");
		for (const path of OBSERVATION_FILES) names.add(path);
		// Include ignored files in explicitly allowed roots so worker writes cannot disappear from evidence.
		const pending = [...this.options.allowedPaths];
		let scanned = 0;
		while (pending.length) {
			signal?.throwIfAborted();
			const path = pending.pop()!;
			if (++scanned > 10000) throw new WorkspaceEvidenceError("capacity", "Workspace evidence path/size limit");
			if (!isPolicyPath(path)) throw new WorkspaceEvidenceError("unsupported", "Workspace evidence path/size limit");
			const ancestors = await this.ancestors(path);
			if (!ancestors) continue;
			let stat: Stats;
			try {
				stat = await lstat(join(this.cwd, path));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			if (stat.isDirectory() && !stat.isSymbolicLink()) {
				if (path.split("/").some((part) => [".git", ".ai", ".pi", "node_modules"].includes(part))) continue;
				for (const name of await readdir(join(this.cwd, path))) pending.push(`${path}/${name}`);
				const current = await lstat(join(this.cwd, path));
				if (!current.isDirectory() || current.dev !== stat.dev || current.ino !== stat.ino)
					throw new WorkspaceEvidenceError("unavailable", "Workspace directory changed during capture");
			} else if (!isRuntimeOwnedPath(path)) names.add(path);
			await this.assertAncestors(ancestors);
		}
		for (const path of await ownedObservationPaths(this.cwd)) names.delete(path);
		if (names.size > this.limits.files) throw new WorkspaceEvidenceError("capacity", "Workspace evidence file limit");
		let total = 0;
		let retained = 0;
		const buffer = Buffer.alloc(64 * 1024);
		const images = new Map<string, FileImage>();
		for (const path of [...names].sort()) {
			signal?.throwIfAborted();
			// Git names are literal, not tool/glob inputs. Observe out-of-scope route names such as [slug].tsx
			// without widening Policy, allowed-root traversal, retained text or claimed-file authority.
			const opaqueLiteral =
				this.options.evidenceMode &&
				!this.editable(path) &&
				!/[\\:\x00-\x1f\x7f]/.test(path) &&
				!path.startsWith("/") &&
				path.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && part.trim() === part);
			if (!isPolicyPath(path) && !opaqueLiteral)
				throw new WorkspaceEvidenceError("unsupported", "Unsupported Git filename");
			const ancestors = await this.ancestors(path);
			if (!ancestors) continue;
			const absolute = join(this.cwd, path);
			let stat: BigIntStats;
			try {
				stat = await lstat(absolute, { bigint: true });
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			if (stat.isSymbolicLink() && this.admittedLinks.has(path)) {
				if (stat.nlink !== 1n) throw new WorkspaceEvidenceError("unsupported", "Unsupported linked symlink");
				if (stat.size > 4096n) throw new WorkspaceEvidenceError("capacity", "Workspace link target limit");
				const target = await readlink(absolute, { encoding: "buffer" });
				if (target.length > 4096) throw new WorkspaceEvidenceError("capacity", "Workspace link target limit");
				if (BigInt(target.length) !== stat.size || !sameIdentity(stat, await lstat(absolute, { bigint: true })))
					throw new WorkspaceEvidenceError("unavailable", "Workspace link changed during capture");
				await this.assertAncestors(ancestors);
				images.set(path, {
					kind: "symlink",
					mode: Number(stat.mode & 0o777n),
					length: target.length,
					hash: hash(target),
				});
				continue;
			}
			if (!stat.isFile() || stat.nlink !== 1n)
				throw new WorkspaceEvidenceError("unsupported", "Unsupported workspace file (link, special file or size)");
			const retain = !this.options.evidenceMode || this.editable(path);
			const maxFile = retain ? 2 * MiB : this.limits.file;
			if (stat.size > BigInt(maxFile))
				throw new WorkspaceEvidenceError("capacity", "Unsupported workspace file (link, special file or size)");
			const handle = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
			try {
				const before = await handle.stat({ bigint: true });
				if (!sameIdentity(stat, before))
					throw new WorkspaceEvidenceError("unavailable", "Workspace file changed before capture");
				const digest = createHash("sha256");
				const chunks: Buffer[] = [];
				let length = 0;
				while (true) {
					signal.throwIfAborted();
					const { bytesRead } = await handle.read(buffer, 0, buffer.length, length);
					if (!bytesRead) break;
					length += bytesRead;
					total += bytesRead;
					if (length > maxFile || total > this.limits.bytes)
						throw new WorkspaceEvidenceError("capacity", "Workspace evidence byte limit");
					if (BigInt(length) > before.size)
						throw new WorkspaceEvidenceError("unavailable", "Workspace file grew during capture");
					const bytes = buffer.subarray(0, bytesRead);
					digest.update(bytes);
					if (retain) chunks.push(Buffer.from(bytes));
				}
				if (
					BigInt(length) !== before.size ||
					!sameIdentity(before, await handle.stat({ bigint: true })) ||
					!sameIdentity(before, await lstat(absolute, { bigint: true }))
				)
					throw new WorkspaceEvidenceError("unavailable", "Workspace file changed during capture");
				await this.assertAncestors(ancestors);
				const fingerprint = { mode: Number(before.mode & 0o777n), length, hash: digest.digest("hex") };
				const bytes = retain ? Buffer.concat(chunks, length) : undefined;
				const text = bytes?.toString("utf8");
				if (bytes && text !== undefined && !bytes.includes(0) && Buffer.from(text).equals(bytes)) {
					retained += length;
					if (retained > 32 * MiB)
						throw new WorkspaceEvidenceError("capacity", "Workspace evidence retained text limit");
					images.set(path, { kind: "text", ...fingerprint, text });
				} else images.set(path, { kind: "opaque", ...fingerprint });
			} finally {
				await handle.close();
			}
		}
		signal.throwIfAborted();
		return images;
	}
	async capture(signal: AbortSignal): Promise<Capture> {
		const head = (await this.command(["rev-parse", "HEAD"], signal)).trim();
		const index = await this.command(["ls-files", "--stage", "-z"], signal);
		const gitConfig = await this.controlHash(signal);
		const images = await this.images(signal);
		if (
			head !== (await this.command(["rev-parse", "HEAD"], signal)).trim() ||
			index !== (await this.command(["ls-files", "--stage", "-z"], signal)) ||
			gitConfig !== (await this.controlHash(signal))
		)
			throw new WorkspaceEvidenceError("unavailable", "Git identity changed during capture");
		return { images, head, index, gitConfig };
	}
}

/**
 * Read-only capacity/type preflight using execution's collector and fixed limits. No clean-start requirement,
 * writer, Run, check/model invocation or returned baseline. All failures are typed, including IO/cancellation.
 */
export async function probeWorkspaceEvidence(
	cwd: string,
	options: WorkspaceEvidenceOptions,
	signal?: AbortSignal,
): Promise<{ fileCount: number; totalBytes: number }> {
	try {
		return await boundedCapture(signal, async (signal) => {
			const collector = await WorkspaceEvidenceCollector.create(cwd, options);
			const index = await collector.initialize(signal);
			const capture = await collector.capture(signal);
			if (capture.index !== index)
				throw new WorkspaceEvidenceError("unavailable", "Workspace index changed during capture");
			return {
				fileCount: capture.images.size,
				totalBytes: [...capture.images.values()].reduce(
					(total, image) => total + (image.kind === "symlink" ? 0 : image.length),
					0,
				),
			};
		});
	} catch (error) {
		if (error instanceof WorkspaceEvidenceError) throw error;
		throw new WorkspaceEvidenceError("unavailable", "Workspace evidence unavailable", error);
	}
}

/** Exact clean checkout identity using the execution collector; no writer, baseline or check execution. */
export async function readCheckoutIdentity(
	cwd: string,
	options: WorkspaceEvidenceOptions,
	signal?: AbortSignal,
): Promise<CheckoutIdentity> {
	return boundedCapture(signal, async (signal) => {
		const collector = await WorkspaceEvidenceCollector.create(cwd, options);
		const index = await collector.initialize(signal);
		await collector.assertClean(signal);
		const capture = await collector.capture(signal);
		if (capture.index !== index)
			throw new WorkspaceEvidenceError("unavailable", "Workspace index changed during capture");
		await collector.assertClean(signal);
		return {
			canonicalCwd: collector.cwd,
			repositoryRoot: collector.cwd,
			headCommit: capture.head,
			workspaceDigest: `sha256:${captureDigest(capture, options.evidenceMode)}`,
		};
	});
}

/** Full byte/mode snapshots plus Git HEAD/index identity. No stash/reset/checkout/clean/commit. */
export class GitWorkspace {
	readonly cwd: string;
	private readonly collector: WorkspaceEvidenceCollector;
	private readonly policy: PolicyContext;
	private readonly paths: FilePolicyPathInspector;
	private baseline = new Map<string, FileImage>();
	private head = "";
	private index = "";
	private gitConfig = "";
	get safeToRelease(): boolean {
		return this.collector.safeToRelease;
	}
	private constructor(collector: WorkspaceEvidenceCollector, policy: PolicyContext) {
		this.collector = collector;
		this.cwd = collector.cwd;
		this.paths = collector.paths;
		this.policy = structuredClone(policy);
	}
	static async open(
		cwd: string,
		policy: PolicyContext,
		signal?: AbortSignal,
		evidenceMode?: WorkspaceEvidenceOptions["evidenceMode"],
	): Promise<GitWorkspace> {
		policy = structuredClone(policy);
		return boundedCapture(signal, async (signal) => {
			const collector = await WorkspaceEvidenceCollector.create(cwd, {
				allowedPaths: policy.allowedPaths,
				evidenceMode,
			});
			const workspace = new GitWorkspace(collector, policy);
			const index = await collector.initialize(signal);
			await collector.assertClean(signal);
			const capture = await collector.capture(signal);
			if (index !== capture.index)
				throw new WorkspaceEvidenceError("unavailable", "Workspace index changed during capture");
			workspace.head = capture.head;
			workspace.index = capture.index;
			workspace.gitConfig = capture.gitConfig;
			workspace.baseline = capture.images;
			if (policy.r3Scope) {
				const path = policy.r3Scope.targetPath;
				const image = workspace.baseline.get(path);
				if (
					!index.split("\0").some((entry) => entry.endsWith(`\t${path}`)) ||
					image?.kind !== "text" ||
					image.length > 262144
				)
					throw new Error("R3 deletion requires an existing Git-tracked text file");
				const decision = evaluatePolicy(
					{
						runId: policy.r3Scope.runId,
						actionId: "preflight",
						actionDigest: "preflight",
						role: "Developer",
						tool: "runtime_delete",
						risk: "R3",
						paths: [path],
					},
					policy,
					await workspace.paths.inspect([path]),
				);
				if (decision.decision !== "APPROVAL_REQUIRED")
					throw new Error("Unsupported R3 deletion target; protected paths cannot be approved");
			}
			await collector.assertClean(signal);
			return workspace;
		});
	}
	private capture(signal?: AbortSignal): Promise<Capture> {
		return boundedCapture(signal, (signal) => this.collector.capture(signal));
	}
	async inspect(signal?: AbortSignal): Promise<DiffEvidence> {
		return this.evidence(await this.capture(signal));
	}
	/**
	 * COMPLEX expected-image ledger input: one capture, evaluated exactly like `inspect`, plus the byte hash and
	 * permission bits of every requested file and every changed file (null when absent). No checks, no Git write.
	 */
	async complexImages(paths: readonly string[], signal?: AbortSignal): Promise<ComplexWorkspaceImages> {
		const capture = await this.capture(signal);
		const { diffDigest, safe, changedFiles } = await this.evidence(capture);
		const images: ComplexWorkspaceImages["images"] = {};
		for (const path of new Set([...paths, ...changedFiles])) {
			const image = capture.images.get(path);
			images[path] = image ? { hash: image.hash, mode: image.mode } : null;
		}
		return { diffDigest, safe, changedFiles, images };
	}
	/**
	 * V0.8A own-claim capture at a task handoff: the byte hash and permission bits of exactly the given claimed files
	 * (null when absent), read without Git and without a whole-workspace digest, because concurrent siblings may still
	 * be writing their own files. Unsafe or unsupported files fail closed.
	 */
	async claimImages(
		paths: readonly string[],
		signal?: AbortSignal,
	): Promise<Record<string, WorkspaceFileImage | null>> {
		const images: Record<string, WorkspaceFileImage | null> = {};
		for (const path of paths) {
			signal?.throwIfAborted();
			if (!isPolicyPath(path) || isRuntimeOwnedPath(path)) throw new Error("Unsupported claimed path");
			let stat: Stats;
			try {
				stat = await lstat(join(this.cwd, path));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
				images[path] = null;
				continue;
			}
			if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024)
				throw new Error("Unsupported workspace file (link, special file or size)");
			if (!(await this.paths.inspect([path]))[0].safe) throw new Error("Unsafe workspace path");
			images[path] = { hash: hash(await readFile(join(this.cwd, path))), mode: stat.mode & 0o777 };
		}
		return images;
	}
	private async evidence(capture: Capture): Promise<DiffEvidence> {
		const { images, head, index, gitConfig } = capture;
		const changedFiles = [...new Set([...this.baseline.keys(), ...images.keys()])]
			.filter(
				(path) =>
					this.baseline.get(path)?.hash !== images.get(path)?.hash ||
					this.baseline.get(path)?.mode !== images.get(path)?.mode ||
					this.baseline.get(path)?.kind !== images.get(path)?.kind ||
					this.baseline.get(path)?.length !== images.get(path)?.length,
			)
			.sort();
		const changedLines = changedFiles.reduce(
			(total, path) =>
				total + changedLineCount(textOf(this.baseline.get(path)) ?? "", textOf(images.get(path)) ?? ""),
			0,
		);
		let safe = head === this.head && index === this.index && gitConfig === this.gitConfig;
		if (head !== this.head || index !== this.index || gitConfig !== this.gitConfig)
			changedFiles.push(".git (HEAD/index/config changed)");
		const changes: Array<{
			path: string;
			before: string | null;
			after: string | null;
			beforeMode?: number;
			afterMode?: number;
		}> = [];
		for (const path of changedFiles) {
			const before = this.baseline.get(path);
			const after = images.get(path);
			if ((before && before.kind !== "text") || (after && after.kind !== "text")) {
				safe = false;
				changes.push({ path, before: "[protected/unsupported change]", after: null });
				continue;
			}
			if (this.policy.r3Scope) {
				const inspected = await this.paths.inspect([path]);
				const scopedDeletion =
					path === this.policy.r3Scope.targetPath &&
					this.baseline.has(path) &&
					!images.has(path) &&
					inspected[0]?.safe &&
					inspected[0].kind === "missing";
				if (!scopedDeletion) safe = false;
				changes.push({
					path,
					before: scopedDeletion ? (textOf(before) ?? null) : "[outside supported deletion]",
					after: null,
					beforeMode: this.baseline.get(path)?.mode,
				});
				continue;
			}
			const decision = evaluatePolicy(
				{
					runId: this.policy.executionRunId,
					actionId: "evidence",
					role: "Developer",
					tool: "runtime_edit",
					risk: this.policy.r2RunId ? "R2" : "R1",
					paths: [path],
					actionDigest: "evidence",
				},
				this.policy,
				await this.paths.inspect([path]),
			);
			if (decision.decision !== "ALLOW") {
				safe = false;
				changes.push({ path, before: "[protected/unsupported change]", after: null });
				continue;
			}
			changes.push({
				path,
				before: textOf(before) ?? null,
				after: textOf(after) ?? null,
				beforeMode: this.baseline.get(path)?.mode,
				afterMode: images.get(path)?.mode,
			});
		}
		const diff = JSON.stringify(changes, null, 2);
		if (Buffer.byteLength(diff) > 240000) throw new Error("Diff evidence exceeds review context limit");
		const diffDigest = captureDigest(capture, this.collector.options.evidenceMode);
		return { diffDigest, changedFiles, changedLines, evidenceRefs: [`diff:${diffDigest}`], safe, diff };
	}
}
