import type { Run } from "./contracts.ts";
import {
	HOST_RUN_DIFF_FILE_MAX_BYTES,
	HOST_RUN_DIFF_TOTAL_MAX_BYTES,
	type HostEvidenceRunDiffRecord,
	type HostRunDiffRefusal,
} from "./host-control-protocol.ts";
import { changedLineCount } from "./quick.ts";
import { type RunResultImage, readRunResultImages, type WorkspaceEvidenceOptions } from "./workspace.ts";

export type RunDiffRead =
	| { kind: "files"; records: HostEvidenceRunDiffRecord[] }
	| { kind: "refused"; reason: HostRunDiffRefusal };

const CONTEXT_LINES = 3;
/** Lines with their terminator, so a missing final newline is a real difference. */
const lines = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const escapes: Record<string, string> = { '"': '\\"', "\\": "\\\\", "\t": "\\t", "\n": "\\n" };
/** Git's C-style quoting for names holding a quote, a backslash or a control character. */
const gitPath = (prefix: string, path: string): string =>
	/["\\\x00-\x1f\x7f]/.test(path)
		? `"${`${prefix}${path}`.replace(
				/["\\\x00-\x1f\x7f]/g,
				(c) => escapes[c] ?? `\\${c.charCodeAt(0).toString(8).padStart(3, "0")}`,
			)}"`
		: `${prefix}${path}`;

/**
 * One-hunk unified patch over the changed span the Runtime already counts (`changedLineCount`): common leading and
 * trailing lines are context, everything between is removed then added. Correct, not minimal.
 */
export function unifiedPatch(path: string, before: RunResultImage | null, after: RunResultImage | null): string {
	const out = [`diff --git ${gitPath("a/", path)} ${gitPath("b/", path)}`];
	if (!before && after) out.push(`new file mode ${after.mode}`);
	else if (before && !after) out.push(`deleted file mode ${before.mode}`);
	else if (before && after && before.mode !== after.mode)
		out.push(`old mode ${before.mode}`, `new mode ${after.mode}`);
	const left = lines(before?.text ?? "");
	const right = lines(after?.text ?? "");
	let start = 0;
	while (start < left.length && start < right.length && left[start] === right[start]) start++;
	let endLeft = left.length;
	let endRight = right.length;
	while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
		endLeft--;
		endRight--;
	}
	if (start === endLeft && start === endRight) return `${out.join("\n")}\n`;
	out.push(
		before ? `--- ${gitPath("a/", path)}` : "--- /dev/null",
		after ? `+++ ${gitPath("b/", path)}` : "+++ /dev/null",
	);
	const from = Math.max(0, start - CONTEXT_LINES);
	const trailing = Math.min(CONTEXT_LINES, left.length - endLeft);
	const oldCount = endLeft + trailing - from;
	const newCount = endRight + trailing - from;
	out.push(`@@ -${oldCount ? from + 1 : from},${oldCount} +${newCount ? from + 1 : from},${newCount} @@`);
	const body: string[] = [];
	const emit = (marker: string, line: string) =>
		body.push(line.endsWith("\n") ? `${marker}${line}` : `${marker}${line}\n\\ No newline at end of file\n`);
	for (const line of left.slice(from, start)) emit(" ", line);
	for (const line of left.slice(start, endLeft)) emit("-", line);
	for (const line of right.slice(start, endRight)) emit("+", line);
	for (const line of left.slice(endLeft, endLeft + trailing)) emit(" ", line);
	return `${out.join("\n")}\n${body.join("")}`;
}

/**
 * Display-only Run change for the recorded revision: the recorded changed files, base (staged Git blob) against
 * result (the current workspace, accepted only when its capture digest equals the recorded `diffDigest`). The base is
 * accepted only when it reproduces the recorded changed-line count. Read-only; never a completion or review input.
 */
export async function readRunDiff(
	cwd: string,
	options: WorkspaceEvidenceOptions,
	workspace: NonNullable<Run["workspace"]>,
	signal?: AbortSignal,
): Promise<RunDiffRead> {
	// A HEAD/index/config change means the staged blobs are not the Run's base.
	if (workspace.changedLines == null || !workspace.safe) return { kind: "refused", reason: "DIFF_UNVERIFIED" };
	const images = await readRunResultImages(cwd, options, workspace.diffDigest, workspace.changedFiles, signal);
	if (!images) return { kind: "refused", reason: "DIFF_STALE" };
	return runDiffRecords(workspace.changedFiles, images, workspace.changedLines);
}

/** Bounded records for already digest-checked images; refused unless they reproduce `recordedLines`. */
export function runDiffRecords(
	changedFiles: readonly string[],
	images: ReadonlyMap<string, { before: RunResultImage | null; after: RunResultImage | null }>,
	recordedLines: number,
): RunDiffRead {
	let changedLines = 0;
	let total = 0;
	const records: HostEvidenceRunDiffRecord[] = [];
	for (const [index, path] of changedFiles.entries()) {
		const image = images.get(path);
		if (!image || (!image.before && !image.after)) return { kind: "refused", reason: "DIFF_UNVERIFIED" };
		const { before, after } = image;
		changedLines += changedLineCount(before?.text ?? "", after?.text ?? "");
		const change = !before ? "added" : !after ? "deleted" : "modified";
		if ((before && before.text === null) || (after && after.text === null)) {
			records.push({ category: "run-diff", index, path, change, patch: null, omitted: "NOT_TEXT" });
			continue;
		}
		const patch = unifiedPatch(path, before, after);
		const bytes = Buffer.byteLength(JSON.stringify(patch));
		if (bytes > HOST_RUN_DIFF_FILE_MAX_BYTES) {
			records.push({ category: "run-diff", index, path, change, patch: null, omitted: "DIFF_TOO_LARGE" });
			continue;
		}
		total += bytes;
		records.push({ category: "run-diff", index, path, change, patch, omitted: null });
	}
	if (changedLines !== recordedLines) return { kind: "refused", reason: "DIFF_UNVERIFIED" };
	if (total > HOST_RUN_DIFF_TOTAL_MAX_BYTES) return { kind: "refused", reason: "DIFF_TOO_LARGE" };
	return { kind: "files", records };
}
