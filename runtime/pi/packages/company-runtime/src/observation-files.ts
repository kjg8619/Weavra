import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { type FileHandle, lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { decisionEntries, displayText, type ObservationState } from "./observations.ts";

export const OBSERVATION_FILES = Object.freeze([".ai/decisions.md", ".ai/logs/checks.json"] as const);
export type ObservationFile = (typeof OBSERVATION_FILES)[number];
export type RuntimeReadFile = ObservationFile | ".ai/state.json" | ".ai/tasks.json";
export const OBSERVATION_MAX_BYTES = 16 * 1024 * 1024;
const checksum = (text: string) => createHash("sha256").update(text).digest("hex");

/** Safe read of fixed private runtime paths. No mkdir, lock acquisition, repair or recovery. */
export async function readRuntimeFile(project: string, file: RuntimeReadFile): Promise<string | undefined> {
	const directories = [join(project, ".ai"), ...(file === ".ai/logs/checks.json" ? [join(project, ".ai/logs")] : [])];
	const identities: Stats[] = [];
	try {
		for (const directory of directories) {
			const stat = await lstat(directory);
			if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe runtime observation directory");
			identities.push(stat);
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	let handle: FileHandle;
	try {
		handle = await open(join(project, file), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
	try {
		const stat = await handle.stat();
		// A concurrent atomic rename may unlink the already-open old snapshot; never accept hard links.
		if (!stat.isFile() || stat.nlink > 1 || stat.size > OBSERVATION_MAX_BYTES)
			throw new Error("Unsafe or oversized runtime observation file");
		const text = await handle.readFile("utf8");
		if (Buffer.byteLength(text) > OBSERVATION_MAX_BYTES) throw new Error("Runtime observation size limit");
		for (const [index, directory] of directories.entries()) {
			const current = await lstat(directory);
			if (
				!current.isDirectory() ||
				current.isSymbolicLink() ||
				current.dev !== identities[index].dev ||
				current.ino !== identities[index].ino
			)
				throw new Error("Runtime observation directory changed");
		}
		return text;
	} finally {
		await handle.close();
	}
}

/** Ownership/checksum protects accidental edits, not malicious same-user forgery. Never used as authority. */
export function isOwnedObservation(file: ObservationFile, content: string): boolean {
	if (file === ".ai/decisions.md") {
		const match = /^<!-- pi-company-runtime decisions v1 ([a-f0-9]{64}) -->\n/.exec(content);
		return !!match && checksum(content.slice(match[0].length)) === match[1];
	}
	try {
		const data = JSON.parse(content) as { owner?: unknown; checksum?: unknown; payload?: unknown } | null;
		return (
			data !== null &&
			typeof data === "object" &&
			data.owner === "pi-company-runtime/checks/v1" &&
			data.payload !== undefined &&
			Object.keys(data).length === 3 &&
			data.checksum === checksum(JSON.stringify(data.payload)) &&
			`${JSON.stringify(data, null, 2)}\n` === content
		);
	} catch {
		return false;
	}
}
export async function ownedObservationPaths(project: string): Promise<Set<string>> {
	const owned = new Set<string>();
	for (const path of OBSERVATION_FILES) {
		const text = await readRuntimeFile(project, path);
		if (text !== undefined && isOwnedObservation(path, text)) owned.add(path);
	}
	return owned;
}
function markdown(value: string): string {
	return displayText(value, OBSERVATION_MAX_BYTES)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/([\\`*_{}[\]()#+!|~])/g, "\\$1");
}
export function renderObservationFiles(state: ObservationState): Record<ObservationFile, string> {
	const sourceDigest = checksum(JSON.stringify(state));
	const actions = new Map<string, ObservationState["actions"][number][]>();
	for (const action of state.actions) {
		const group = actions.get(action.decision.runId);
		if (group) group.push(action);
		else actions.set(action.decision.runId, [action]);
	}
	const body = [
		"# Runtime operational decisions",
		"",
		"Generated projection of .ai/state.json, not technical ADRs, approval authority or an event replay log.",
		"Do not edit this generated file. Export again to refresh; manual files are never overwritten.",
		`Source revision: ${state.revision}`,
		`Source SHA-256: ${sourceDigest}`,
		"",
		...state.runs.flatMap((run) => [
			`## Run ${markdown(run.runId)}`,
			...decisionEntries(run, actions.get(run.runId) ?? []).flatMap((entry) => [
				`### ${markdown(entry.id)}`,
				`- Kind: ${entry.kind}`,
				`- Result: ${markdown(entry.summary)}`,
				...entry.details.map((line) => `- ${markdown(line)}`),
				"",
			]),
		]),
	].join("\n");
	const payload = {
		schemaVersion: 1,
		sourceRevision: state.revision,
		sourceDigest,
		note: "Derived check evidence only; never read for execution, approval or completion. No transcripts.",
		checks: state.runs.flatMap((run) => run.verification.map((check, index) => ({ record: index + 1, ...check }))),
	};
	return {
		".ai/decisions.md": `<!-- pi-company-runtime decisions v1 ${checksum(body)} -->\n${body}`,
		".ai/logs/checks.json": `${JSON.stringify({ owner: "pi-company-runtime/checks/v1", checksum: checksum(JSON.stringify(payload)), payload }, null, 2)}\n`,
	};
}

/** Called only by the owned StateStore's exclusive export scope, after all runs are terminal. */
export async function writeObservationFiles(
	owner: { projectPath: string; assertWritable(): Promise<void> },
	state: ObservationState,
	beforeStep?: (file: "decisions.md" | "logs/checks.json", step: "write" | "sync" | "rename") => void,
): Promise<{ sourceRevision: number; updated: number; paths: readonly ObservationFile[] }> {
	await owner.assertWritable();
	const outputs = renderObservationFiles(state);
	for (const path of OBSERVATION_FILES) {
		if (Buffer.byteLength(outputs[path]) > OBSERVATION_MAX_BYTES)
			throw new Error("Export exceeds runtime view size limit");
		const old = await readRuntimeFile(owner.projectPath, path);
		if (old !== undefined && !isOwnedObservation(path, old))
			throw new Error(`Export refused: ${path} is manual or modified; preserve it and resolve ownership explicitly`);
	}
	await mkdir(join(owner.projectPath, ".ai/logs"), { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
		if (error.code !== "EEXIST") throw error;
	});
	const directories = [join(owner.projectPath, ".ai"), join(owner.projectPath, ".ai/logs")];
	const stats = await Promise.all(directories.map((path) => lstat(path)));
	if (stats.some((stat) => !stat.isDirectory() || stat.isSymbolicLink())) throw new Error("Unsafe export directory");
	const assertDirectories = async () => {
		await owner.assertWritable();
		for (const [index, directory] of directories.entries()) {
			const stat = await lstat(directory);
			if (
				!stat.isDirectory() ||
				stat.isSymbolicLink() ||
				stat.dev !== stats[index].dev ||
				stat.ino !== stats[index].ino
			)
				throw new Error("Export directory changed");
		}
	};
	let updated = 0;
	for (const path of OBSERVATION_FILES) {
		await assertDirectories();
		const previous = await readRuntimeFile(owner.projectPath, path);
		if (previous === outputs[path]) continue;
		if (previous !== undefined && !isOwnedObservation(path, previous)) throw new Error("Export target was modified");
		const target = join(owner.projectPath, path);
		const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`);
		const relative = path === ".ai/decisions.md" ? "decisions.md" : "logs/checks.json";
		const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		try {
			try {
				beforeStep?.(relative, "write");
				await assertDirectories();
				await file.writeFile(outputs[path]);
				beforeStep?.(relative, "sync");
				await file.sync();
			} finally {
				await file.close();
			}
			beforeStep?.(relative, "rename");
			await assertDirectories();
			if ((await readRuntimeFile(owner.projectPath, path)) !== previous)
				throw new Error("Export target changed before rename");
			await rename(temporary, target);
			updated++;
		} finally {
			await unlink(temporary).catch((error: NodeJS.ErrnoException) => {
				if (error.code !== "ENOENT") throw error;
			});
		}
	}
	return { sourceRevision: state.revision, updated, paths: [...OBSERVATION_FILES] };
}
