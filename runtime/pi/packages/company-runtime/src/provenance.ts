import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provenance } from "./provenance-types.ts";

const gitTimeoutMs = 5_000;

function git(cwd: string, args: string[]): string | null {
	try {
		return execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-C", cwd, ...args], {
			stdio: ["ignore", "pipe", "ignore"],
			timeout: gitTimeoutMs,
			encoding: "utf8",
			env: { PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		}).trim();
	} catch {
		return null;
	}
}

/** Walks up from a path to the containing Git checkout root; returns null when the source is not a checkout. */
function checkoutRoot(start: string): string | null {
	let current = start;
	for (let depth = 0; depth < 12; depth += 1) {
		if (existsSync(join(current, ".git"))) return current;
		const parent = dirname(current);
		if (parent === current) return null;
		current = parent;
	}
	return null;
}

export interface CaptureProvenanceInput {
	/** Target project workspace under work. */
	cwd: string;
	configDigest?: string;
	taskContractDigest?: string;
	/** Host-selected reviewed recipe used to draft the acceptance criteria, frozen at run start. */
	recipe?: { id: string; version: number; digest: string };
	now?: () => number;
}

/**
 * One Host-owned snapshot taken at run start; nothing is refreshed mid-run and unknown values stay null.
 * The Runtime source checkout is resolved from this module's own location, not from the target project.
 */
export function captureProvenance(input: CaptureProvenanceInput): Provenance {
	const now = input.now ?? Date.now;
	const runtimeSourcePath = dirname(fileURLToPath(new URL(".", import.meta.url)));
	const checkout = checkoutRoot(runtimeSourcePath);
	const commit = checkout ? git(checkout, ["rev-parse", "HEAD"]) : null;
	let cliBundle: Provenance["cliBundle"];
	if (checkout) {
		const bundlePath = join(checkout, "packages", "coding-agent", "dist", "bundle", "cli.js");
		if (existsSync(bundlePath)) {
			const stat = statSync(bundlePath);
			const versionPath = join(checkout, "packages", "coding-agent", "package.json");
			let version: string | null = null;
			try {
				const parsed: unknown = JSON.parse(readFileSync(versionPath, "utf8"));
				if (parsed && typeof parsed === "object" && "version" in parsed && typeof parsed.version === "string")
					version = parsed.version;
			} catch {
				version = null;
			}
			cliBundle = {
				path: bundlePath,
				sha256: createHash("sha256").update(readFileSync(bundlePath)).digest("hex"),
				bytes: stat.size,
				mtimeMs: Math.floor(stat.mtimeMs),
				version: version ?? undefined,
			};
		}
	}
	const targetHead = git(input.cwd, ["rev-parse", "HEAD"]);
	return {
		...(checkout ? { runtimeSource: { path: checkout, ...(commit ? { commit } : {}) } } : {}),
		...(cliBundle ? { cliBundle } : {}),
		...(targetHead ? { targetWorkspaceCommit: targetHead } : {}),
		...(input.configDigest ? { configDigest: input.configDigest } : {}),
		...(input.taskContractDigest ? { taskContractDigest: input.taskContractDigest } : {}),
		...(input.recipe ? { recipe: structuredClone(input.recipe) } : {}),
		capturedAt: now(),
	};
}
