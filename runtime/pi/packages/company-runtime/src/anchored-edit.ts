import { createHash, randomBytes } from "node:crypto";

export const ANCHORED_MAX_BYTES = 262144;
export const ANCHORED_EDIT_GUIDANCE =
	"Existing-file edits should prefer an anchored read followed by anchored edit. " +
	"If an anchor is stale, re-read the file. Never guess or reconstruct an anchor.";

export class StaleAnchorError extends Error {
	constructor(reason: string) {
		super(`STALE_ANCHOR: ${reason}. Re-read with anchors:true; never guess or reconstruct an anchor.`);
		this.name = "StaleAnchorError";
	}
}

/**
 * Strict-mutation freshness/precondition failure (receipt, digest, must-not-exist).
 * Recoverable in-session by re-reading; never a Policy, audit or storage failure.
 */
export class StaleMutationError extends StaleAnchorError {
	constructor(reason: string) {
		super(reason);
		this.name = "StaleMutationError";
	}
}

/** Adapter-owned opaque freshness receipt. Not a credential, capability, permission or approval token. */
export function mintReadReceipt(): string {
	return `rr1:${randomBytes(24).toString("hex")}`;
}

export const STRICT_MUTATION_GUIDANCE =
	"Strict mutation mode (freshness/precondition enforcement only; it grants no permission and is not approval): " +
	"to change an existing file, call runtime_read with anchors:true and copy its exact readReceipt, fileDigest and anchor into the mutation; " +
	"never invent, guess or reuse receipts, digests or anchors. " +
	"runtime_edit requires anchor+fileDigest+readReceipt and has no unanchored fallback. " +
	"runtime_write requires operation=create with mustNotExist:true for a new file, or operation=replace with a fresh readReceipt+fileDigest for an existing file; " +
	"create never overwrites an existing file and replace never creates a missing one. " +
	"After any successful mutation, re-read before mutating that file again. " +
	"If a mutation reports a stale precondition, re-read the file with anchors:true and retry in this same session.";

export interface AnchoredReplacement {
	oldText: string;
	newText: string;
	anchor: string;
	fileDigest: string;
}

interface Line {
	line: number;
	start: number;
	end: number;
	text: string;
}

/** Strict, byte-preserving UTF-8, including BOM and exact line endings. No filesystem or SDK dependency. */
export function decodeAnchoredText(bytes: Uint8Array): string {
	const buffer = Buffer.from(bytes);
	const text = buffer.toString("utf8");
	if (buffer.length > ANCHORED_MAX_BYTES || buffer.includes(0) || !Buffer.from(text, "utf8").equals(buffer))
		throw new Error("Anchored operations require bounded non-binary strict UTF-8 text");
	return text;
}

function* lines(text: string): Generator<Line> {
	let start = 0;
	let line = 1;
	while (start < text.length) {
		const newline = text.indexOf("\n", start);
		const end = newline === -1 ? text.length : newline + 1;
		yield { line: line++, start, end, text: text.slice(start, end) };
		start = end;
	}
}

export function fileDigest(text: string): string {
	return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}

/** pathIdentity is the adapter's canonical workspace + literal policy-approved relative path. */
export function makeAnchor(pathIdentity: string, line: number, exactLine: string): string {
	const hash = createHash("sha256")
		.update(JSON.stringify(["weavra-anchor-v1", pathIdentity, line, exactLine]))
		.digest("hex");
	return `a1:L${line}:${hash}`;
}

/** JSON lines preserve escaping; output itself, not just the source file, is bounded to 256 KiB. */
export function snapshotText(pathIdentity: string, text: string): string {
	if (decodeAnchoredText(Buffer.from(text)) !== text) throw new Error("Snapshot must be strict UTF-8");
	const output = [`fileDigest: ${fileDigest(text)}`];
	let size = Buffer.byteLength(output[0]) + 1;
	for (const item of lines(text)) {
		// A long line still exposes its full-line anchor, but never silently presents a preview as full text.
		const preview = item.text.slice(0, 4096);
		const escaped = JSON.stringify(preview).replace(
			/[\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,
			(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
		const row = `${makeAnchor(pathIdentity, item.line, item.text)} ${escaped}${preview.length < item.text.length ? " [line preview truncated]" : ""}`;
		const bytes = Buffer.byteLength(row) + 1;
		if (size + bytes > ANCHORED_MAX_BYTES - 64) {
			output.push("[remaining lines omitted: output limit]");
			break;
		}
		output.push(row);
		size += bytes;
	}
	return output.join("\n");
}

export function verifyAnchor(pathIdentity: string, text: string, anchor: string): Line {
	const match = /^a1:L([1-9][0-9]*):[0-9a-f]{64}$/.exec(anchor);
	if (!match) throw new StaleAnchorError("invalid anchor");
	const number = Number(match[1]);
	for (const item of lines(text)) {
		if (item.line !== number) continue;
		if (makeAnchor(pathIdentity, item.line, item.text) === anchor) return item;
		break;
	}
	throw new StaleAnchorError("line anchor mismatch");
}

/** The exact match must START in the anchored line; it may span subsequent lines. No global/fuzzy fallback. */
export function applyAnchoredReplacement(pathIdentity: string, text: string, input: AnchoredReplacement): string {
	if (decodeAnchoredText(Buffer.from(text)) !== text) throw new Error("Source must be strict UTF-8");
	if (fileDigest(text) !== input.fileDigest) throw new StaleAnchorError("file generation mismatch");
	const target = verifyAnchor(pathIdentity, text, input.anchor);
	if (!input.oldText.length) throw new Error("Anchored oldText must not be empty");
	const index = text.indexOf(input.oldText, target.start);
	if (index < target.start || index >= target.end) throw new StaleAnchorError("oldText not found at anchored line");
	const next = text.indexOf(input.oldText, index + 1);
	if (next !== -1 && next < target.end)
		throw new Error("AMBIGUOUS_ANCHOR: multiple exact matches start in anchored line");
	const replacement = text.slice(0, index) + input.newText + text.slice(index + input.oldText.length);
	if (Buffer.from(replacement).toString("utf8") !== replacement)
		throw new Error("Anchored replacement must be strict UTF-8");
	decodeAnchoredText(Buffer.from(replacement));
	return replacement;
}
