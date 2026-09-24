import type { Stats } from "node:fs";
import { lstat, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { readAnchoredSource } from "./anchored-files.ts";
import type { ComplexPathFact } from "./complex-plan.ts";
import { type InspectedPath, isPolicyPath, type PolicyPathInspector } from "./policy.ts";

/** Entries read to verify one exact spelling; a larger or unreadable directory fails closed instead. */
const OWNERSHIP_MAX_DIRECTORY_ENTRIES = 65536;

/** Comparison only; filesystem names are never rewritten or Unicode-normalized. */
function foldName(name: string): string {
	return name.normalize("NFC").toLowerCase();
}

/** Exact on-disk names of one directory plus their fold keys; undefined when unreadable or over the bound. */
async function directoryListing(
	path: string,
): Promise<{ names: ReadonlySet<string>; folded: ReadonlySet<string> } | undefined> {
	try {
		const directory = await opendir(path);
		const names = new Set<string>();
		try {
			for (let entry = await directory.read(); entry; entry = await directory.read()) {
				if (names.size >= OWNERSHIP_MAX_DIRECTORY_ENTRIES) return undefined;
				names.add(entry.name);
			}
		} finally {
			await directory.close();
		}
		return { names, folded: new Set([...names].map(foldName)) };
	} catch {
		return undefined;
	}
}

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
	/**
	 * COMPLEX ownership facts: the safety verdict above plus the actual on-disk spelling of every existing
	 * component (a case/Unicode alias is never a second name for one file), bounded strict-UTF-8 text for an
	 * existing file and an existing parent for a missing leaf. Bounded, read-only and never permission.
	 */
	async inspectOwnership(paths: readonly string[]): Promise<ComplexPathFact[]> {
		const inspected = await this.inspect(paths);
		const listings = new Map<string, ReturnType<typeof directoryListing>>();
		const list = (directory: string): ReturnType<typeof directoryListing> => {
			let listing = listings.get(directory);
			if (!listing) {
				listing = directoryListing(join(this.projectPath, directory));
				listings.set(directory, listing);
			}
			return listing;
		};
		const facts: ComplexPathFact[] = [];
		for (const { path, safe, kind } of inspected) {
			const parts = path.split("/");
			let exactSpelling = safe;
			let present = 0;
			if (safe)
				for (const part of parts) {
					const listing = await list(parts.slice(0, present).join("/"));
					if (listing?.names.has(part)) {
						present++;
						continue;
					}
					if (!listing || listing.folded.has(foldName(part))) exactSpelling = false;
					break;
				}
			// A name that resolved only through a case/normalization-insensitive lookup is an alias, not this file.
			if ((kind === "missing") === (present === parts.length)) exactSpelling = false;
			let text = false;
			if (exactSpelling && kind === "file")
				try {
					readAnchoredSource(this.projectPath, path);
					text = true;
				} catch {
					text = false;
				}
			facts.push({
				path,
				safe,
				kind,
				exactSpelling,
				text,
				parentDirectory: exactSpelling && kind === "missing" && present === parts.length - 1,
			});
		}
		return facts;
	}
}
