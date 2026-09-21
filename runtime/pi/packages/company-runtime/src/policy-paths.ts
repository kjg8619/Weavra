import type { Stats } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import { join } from "node:path";
import { type InspectedPath, isPolicyPath, type PolicyPathInspector } from "./policy.ts";

/** Filesystem adapter: reject every symlink (including internal ones) and multiply linked files. */
export class FilePolicyPathInspector implements PolicyPathInspector {
	readonly projectPath: string;
	private constructor(projectPath: string) {
		this.projectPath = projectPath;
	}
	static async open(projectPath: string): Promise<FilePolicyPathInspector> {
		const canonical = await realpath(projectPath);
		if (!(await lstat(canonical)).isDirectory()) throw new Error("Workspace must be a directory");
		return new FilePolicyPathInspector(canonical);
	}
	async inspect(paths: readonly string[]): Promise<InspectedPath[]> {
		const results: InspectedPath[] = [];
		for (const path of paths) {
			let safe = isPolicyPath(path);
			let kind: InspectedPath["kind"] = "missing";
			try {
				if ((await realpath(this.projectPath)) !== this.projectPath) safe = false;
				let current = this.projectPath;
				const parts = path.split("/");
				if (safe)
					for (const [index, part] of parts.entries()) {
						current = join(current, part);
						let stat: Stats;
						try {
							stat = await lstat(current);
						} catch (error) {
							if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
							throw error;
						}
						if (
							stat.isSymbolicLink() ||
							(!stat.isFile() && !stat.isDirectory()) ||
							(stat.isFile() && stat.nlink !== 1)
						) {
							safe = false;
							break;
						}
						if (index < parts.length - 1 && !stat.isDirectory()) {
							safe = false;
							break;
						}
						if (index === parts.length - 1) kind = stat.isDirectory() ? "directory" : "file";
					}
			} catch {
				safe = false;
			}
			results.push({ path, safe, kind });
		}
		return results;
	}
}
