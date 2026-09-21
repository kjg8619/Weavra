import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Run } from "./contracts.ts";
import { OBSERVATION_FILES, ownedObservationPaths } from "./observation-files.ts";
import { evaluatePolicy, isPolicyPath, type PolicyContext } from "./policy.ts";
import { FilePolicyPathInspector } from "./policy-paths.ts";
import { ProcessCleanupError, resolveExecutable, runProcess, verificationEnvironment } from "./process-runner.ts";
import { changedLineCount } from "./quick.ts";

type FileImage = { mode: number; hash: string; text: string; binary: boolean };
export interface DiffEvidence extends NonNullable<Run["workspace"]> {
	diff: string;
}
const owned = new Set([".ai/state.json", ".ai/tasks.json", ".ai/writer.lock"]);
const hash = (content: string | Buffer) => createHash("sha256").update(content).digest("hex");

/** Full byte/mode snapshots plus Git HEAD/index identity. No stash/reset/checkout/clean/commit. */
export class GitWorkspace {
	readonly cwd: string;
	private readonly git: string;
	private readonly policy: PolicyContext;
	private readonly paths: FilePolicyPathInspector;
	private baseline = new Map<string, FileImage>();
	private head = "";
	private index = "";
	private gitConfig = "";
	private activeCommands = 0;
	private cleanupUncertain = false;
	get safeToRelease(): boolean {
		return this.activeCommands === 0 && !this.cleanupUncertain;
	}
	private constructor(cwd: string, git: string, policy: PolicyContext, paths: FilePolicyPathInspector) {
		this.cwd = cwd;
		this.git = git;
		this.policy = structuredClone(policy);
		this.paths = paths;
	}
	private async command(argv: string[], signal?: AbortSignal): Promise<string> {
		signal?.throwIfAborted();
		if (this.cleanupUncertain) throw new ProcessCleanupError();
		this.activeCommands++;
		try {
			const result = await runProcess({
				executable: this.git,
				argv: ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", ...argv],
				cwd: this.cwd,
				env: verificationEnvironment(),
				timeoutMs: 10000,
				signal,
				maxOutputBytes: 2 * 1024 * 1024,
			}).catch(() => {
				this.cleanupUncertain = true;
				throw new ProcessCleanupError();
			});
			if (!result.cleanupConfirmed) {
				this.cleanupUncertain = true;
				throw new ProcessCleanupError();
			}
			if (result.reason !== "exited" || result.exitCode !== 0) throw new Error("Git evidence collection failed");
			return result.stdout;
		} finally {
			this.activeCommands--;
		}
	}
	private async assertClean(signal?: AbortSignal): Promise<void> {
		const generated = await ownedObservationPaths(this.cwd);
		const status = (await this.command(["status", "--porcelain=v1", "-z", "--untracked-files=all"], signal))
			.split("\0")
			.filter(Boolean);
		for (const entry of status)
			if (!owned.has(entry.slice(3)) && !generated.has(entry.slice(3)))
				throw new Error("Dirty workspace: preserve existing changes; no automatic cleanup was performed");
	}
	static async open(cwd: string, policy: PolicyContext, signal?: AbortSignal): Promise<GitWorkspace> {
		const paths = await FilePolicyPathInspector.open(cwd);
		const git = await resolveExecutable("git", verificationEnvironment().PATH);
		const workspace = new GitWorkspace(paths.projectPath, git, policy, paths);
		if ((await realpath((await workspace.command(["rev-parse", "--show-toplevel"])).trim())) !== workspace.cwd)
			throw new Error("Run must start at the Git project root");
		const tracked = (await workspace.command(["ls-files", "-z"])).split("\0").filter(Boolean);
		const generated = await ownedObservationPaths(workspace.cwd);
		if (tracked.some((path) => owned.has(path) || generated.has(path)))
			throw new Error("Runtime operating files must not be tracked in Git");
		await workspace.assertClean(signal);
		workspace.head = (await workspace.command(["rev-parse", "HEAD"])).trim();
		workspace.index = await workspace.command(["ls-files", "--stage", "-z"]);
		if (/(?:^|\0)160000 /.test(workspace.index)) throw new Error("Submodules are unsupported in the first slice");
		workspace.gitConfig = await workspace.controlHash();
		workspace.baseline = await workspace.images(signal);
		if (policy.r3Scope) {
			const path = policy.r3Scope.targetPath;
			const image = workspace.baseline.get(path);
			if (!tracked.includes(path) || !image || image.binary || Buffer.byteLength(image.text) > 262144)
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
				await paths.inspect([path]),
			);
			if (decision.decision !== "APPROVAL_REQUIRED")
				throw new Error("Unsupported R3 deletion target; protected paths cannot be approved");
		}
		await workspace.assertClean(signal);
		return workspace;
	}
	private async controlHash(): Promise<string> {
		const path = (await this.command(["rev-parse", "--git-path", "config"])).trim();
		return hash(await readFile(resolve(this.cwd, path)));
	}
	private async images(signal?: AbortSignal): Promise<Map<string, FileImage>> {
		const names = new Set(
			(await this.command(["ls-files", "-z", "--cached", "--others", "--exclude-standard"], signal))
				.split("\0")
				.filter((path) => path && !owned.has(path)),
		);
		names.add(".ai/config.yaml");
		for (const path of OBSERVATION_FILES) names.add(path);
		// Include ignored files in explicitly allowed roots so worker writes cannot disappear from evidence.
		const pending = [...this.policy.allowedPaths];
		let scanned = 0;
		while (pending.length) {
			signal?.throwIfAborted();
			const path = pending.pop()!;
			if (++scanned > 10000 || !isPolicyPath(path)) throw new Error("Workspace evidence path/size limit");
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
			} else if (!owned.has(path)) names.add(path);
		}
		for (const path of await ownedObservationPaths(this.cwd)) names.delete(path);
		if (names.size > 5000) throw new Error("Workspace evidence file limit");
		let total = 0;
		const images = new Map<string, FileImage>();
		for (const path of [...names].sort()) {
			signal?.throwIfAborted();
			if (!isPolicyPath(path)) throw new Error("Unsupported Git filename");
			let stat: Stats;
			try {
				stat = await lstat(join(this.cwd, path));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
				throw error;
			}
			if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 2 * 1024 * 1024)
				throw new Error("Unsupported workspace file (link, special file or size)");
			if (!(await this.paths.inspect([path]))[0].safe) throw new Error("Unsafe workspace path");
			const bytes = await readFile(join(this.cwd, path));
			total += bytes.length;
			if (total > 32 * 1024 * 1024) throw new Error("Workspace evidence byte limit");
			images.set(path, {
				mode: stat.mode & 0o777,
				hash: hash(bytes),
				text: bytes.toString("utf8"),
				binary: bytes.includes(0) || !Buffer.from(bytes.toString("utf8")).equals(bytes),
			});
		}
		return images;
	}
	async inspect(signal?: AbortSignal): Promise<DiffEvidence> {
		const images = await this.images(signal);
		const head = (await this.command(["rev-parse", "HEAD"], signal)).trim();
		const index = await this.command(["ls-files", "--stage", "-z"], signal);
		const gitConfig = await this.controlHash();
		const changedFiles = [...new Set([...this.baseline.keys(), ...images.keys()])]
			.filter(
				(path) =>
					this.baseline.get(path)?.hash !== images.get(path)?.hash ||
					this.baseline.get(path)?.mode !== images.get(path)?.mode,
			)
			.sort();
		const changedLines = changedFiles.reduce(
			(total, path) => total + changedLineCount(this.baseline.get(path)?.text ?? "", images.get(path)?.text ?? ""),
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
					before: scopedDeletion ? this.baseline.get(path)!.text : "[outside supported deletion]",
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
			if (decision.decision !== "ALLOW" || this.baseline.get(path)?.binary || images.get(path)?.binary) {
				safe = false;
				changes.push({ path, before: "[protected/unsupported change]", after: null });
				continue;
			}
			changes.push({
				path,
				before: this.baseline.get(path)?.text ?? null,
				after: images.get(path)?.text ?? null,
				beforeMode: this.baseline.get(path)?.mode,
				afterMode: images.get(path)?.mode,
			});
		}
		const diff = JSON.stringify(changes, null, 2);
		if (Buffer.byteLength(diff) > 240000) throw new Error("Diff evidence exceeds review context limit");
		const diffDigest = hash(
			JSON.stringify({
				head,
				index,
				gitConfig,
				files: [...images].map(([path, image]) => [path, image.mode, image.hash]),
			}),
		);
		return { diffDigest, changedFiles, changedLines, evidenceRefs: [`diff:${diffDigest}`], safe, diff };
	}
}
