import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfig } from "./config.ts";
import { resolveVerifierTrustSources } from "./verifier-trust.ts";

function inside(root: string, path: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** The same Host-owned program/oracle protections apply before workers exist and during execution. */
export async function resolveProjectProtectedPaths(
	cwd: string,
	config: RuntimeConfig,
	additional: readonly string[] = [],
): Promise<string[]> {
	const protectedPaths = [...additional];
	for (const check of config.verification.checks) protectedPaths.push(...resolveVerifierTrustSources(cwd, check));
	for (const server of config.code_intelligence?.lsp.enabled ? config.code_intelligence.lsp.servers : []) {
		for (const argument of [server.executable, ...server.args]) {
			if (argument.startsWith("-")) continue;
			const path = resolve(cwd, ".", argument);
			if (!inside(cwd, path)) continue;
			try {
				if ((await lstat(path)).isFile()) protectedPaths.push(relative(cwd, path).split("\\").join("/"));
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}
	}
	const runtimeSource = await realpath(fileURLToPath(new URL("./", import.meta.url)));
	if (inside(cwd, runtimeSource)) {
		const sourcePath = relative(cwd, runtimeSource).split("\\").join("/");
		if (!sourcePath) throw new Error("Runtime source cannot be the worker workspace root");
		protectedPaths.push(sourcePath);
	}
	return protectedPaths;
}
