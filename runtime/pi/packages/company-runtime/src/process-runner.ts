import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { Readable } from "node:stream";

export async function resolveExecutable(executable: string, path: string): Promise<string> {
	const candidates = isAbsolute(executable)
		? [executable]
		: executable.includes("/")
			? []
			: path
					.split(delimiter)
					.filter(isAbsolute)
					.map((directory) => join(directory, executable));
	for (const candidate of candidates) {
		try {
			await access(candidate, constants.X_OK);
			return await realpath(candidate);
		} catch {
			/* Try the next explicit PATH entry. */
		}
	}
	throw new Error("Registered executable is unavailable");
}

/** The owner must retain its writer lease when a process may still be alive. */
export class ProcessCleanupError extends Error {
	constructor() {
		super("Process cleanup unconfirmed; retain project lock for manual inspection");
	}
}

export interface ProcessRequest {
	executable: string;
	argv: readonly string[];
	cwd: string;
	env: Readonly<Record<string, string>>;
	timeoutMs: number;
	signal?: AbortSignal;
	maxOutputBytes?: number;
	/** Host-only bounded outcome channel, separate from untrusted program stdout/stderr. */
	controlFd?: boolean;
}
export interface ProcessResult {
	exitCode: number | null;
	stdout: string;
	stderr: string;
	startedAt: number;
	finishedAt: number;
	reason: "exited" | "unavailable" | "cancelled" | "timeout" | "output-limit" | "background-process" | "stream-error";
	cleanupConfirmed: boolean;
	controlOutput?: string;
}

/** POSIX process-group supervision; no shell, inherited credentials, detached background service or retry. */
export async function runProcess(request: ProcessRequest): Promise<ProcessResult> {
	request.signal?.throwIfAborted();
	if (process.platform === "win32") throw new Error("S4 process supervision requires POSIX");
	const startedAt = Date.now();
	return new Promise((resolve) => {
		let stdout = Buffer.alloc(0);
		let stderr = Buffer.alloc(0);
		let bytes = 0;
		let controlOutput = "";
		let controlBytes = 0;
		let reason: ProcessResult["reason"] = "exited";
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const child = spawn(request.executable, [...request.argv], {
			cwd: request.cwd,
			env: { ...request.env },
			shell: false,
			detached: true,
			stdio: ["ignore", "pipe", "pipe", request.controlFd ? "pipe" : "ignore"],
		});
		const kill = (signal: NodeJS.Signals) => {
			if (child.pid)
				try {
					process.kill(-child.pid, signal);
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") return false;
				}
			return true;
		};
		const stop = (why: ProcessResult["reason"]) => {
			if (reason !== "exited") return;
			reason = why;
			kill("SIGTERM");
			killTimer = setTimeout(() => kill("SIGKILL"), 200);
		};
		const abort = () => stop("cancelled");
		const timer = setTimeout(() => stop("timeout"), request.timeoutMs);
		request.signal?.addEventListener("abort", abort, { once: true });
		if (request.signal?.aborted) abort();
		const collect = (chunk: Buffer, target: "stdout" | "stderr") => {
			const limit = request.maxOutputBytes ?? 16384;
			const remaining = Math.max(0, limit - bytes);
			bytes += chunk.length;
			if (target === "stdout") stdout = Buffer.concat([stdout, chunk.subarray(0, remaining)]);
			else stderr = Buffer.concat([stderr, chunk.subarray(0, remaining)]);
			if (bytes > limit) stop("output-limit");
		};
		child.stdout!.on("data", (chunk: Buffer) => collect(chunk, "stdout"));
		child.stderr!.on("data", (chunk: Buffer) => collect(chunk, "stderr"));
		child.stdout!.on("error", () => stop("stream-error"));
		child.stderr!.on("error", () => stop("stream-error"));
		const control = child.stdio[3];
		if (request.controlFd && control instanceof Readable) {
			control.on("data", (chunk: Buffer) => {
				controlBytes += chunk.length;
				if (controlBytes > 2048) stop("output-limit");
				else controlOutput += chunk.toString("utf8");
			});
			control.on("error", () => stop("stream-error"));
		}
		child.on("error", () => {
			reason = "unavailable";
		});
		// Terminate any descendants left behind by a command that exits early.
		child.on("exit", () => {
			if (child.pid)
				try {
					process.kill(-child.pid, 0);
					if (reason === "exited") reason = "background-process";
				} catch {
					/* Group already exited. */
				}
			kill("SIGKILL");
		});
		child.on("close", async (exitCode) => {
			clearTimeout(timer);
			if (killTimer) clearTimeout(killTimer);
			request.signal?.removeEventListener("abort", abort);
			let cleanupConfirmed = kill("SIGKILL");
			if (child.pid)
				for (let attempt = 0; attempt < 80; attempt++) {
					try {
						process.kill(-child.pid, 0);
						cleanupConfirmed = false;
					} catch (error) {
						cleanupConfirmed = (error as NodeJS.ErrnoException).code === "ESRCH";
						if (cleanupConfirmed) break;
					}
					await new Promise((done) => setTimeout(done, 25));
				}
			if (request.signal?.aborted && reason === "exited") reason = "cancelled";
			resolve({
				exitCode: reason === "unavailable" ? null : exitCode,
				stdout: stdout.toString("utf8"),
				stderr: stderr.toString("utf8"),
				startedAt,
				finishedAt: Date.now(),
				reason,
				cleanupConfirmed,
				...(request.controlFd ? { controlOutput } : {}),
			});
		});
	});
}

/** Deliberately does not inherit HOME, NODE_OPTIONS, provider keys, npm tokens, proxies or arbitrary env. */
export function verificationEnvironment(): Record<string, string> {
	return {
		PATH: process.env.PATH ?? "/usr/bin:/bin",
		LANG: "C.UTF-8",
		LC_ALL: "C",
		CI: "1",
		NO_COLOR: "1",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
	};
}
