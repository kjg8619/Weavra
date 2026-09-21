import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeAnchoredText, fileDigest } from "../anchored-edit.ts";
import { evaluatePolicy, isPolicyPath, type PolicyContext } from "../policy.ts";
import type { FilePolicyPathInspector } from "../policy-paths.ts";

export function safeLspText(text: string, limit = 512): string {
	const escaped = text
		.slice(0, limit)
		.replace(
			/[\x00-\x1f\x7f-\x9f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g,
			(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
		);
	return escaped + (text.length > limit ? " [truncated]" : "");
}
export class LspFiles {
	private readonly cwd: string;
	private readonly policy: PolicyContext;
	private readonly inspector: FilePolicyPathInspector;
	constructor(cwd: string, policy: PolicyContext, inspector: FilePolicyPathInspector) {
		this.cwd = cwd;
		this.policy = structuredClone(policy);
		this.inspector = inspector;
	}
	async allowed(path: string): Promise<boolean> {
		if (!isPolicyPath(path) || path.length > 4096 || safeLspText(path, 4096) !== path) return false;
		const decision = evaluatePolicy(
			{
				runId: this.policy.executionRunId,
				actionId: "lsp-read",
				role: "Reviewer",
				tool: "runtime_read",
				risk: "R0",
				paths: [path],
				actionDigest: "lsp-read",
			},
			this.policy,
			await this.inspector.inspect([path]),
		);
		return decision.decision === "ALLOW";
	}
	async fromUri(uri: unknown): Promise<string | undefined> {
		if (typeof uri !== "string" || uri.length > 16384) return undefined;
		try {
			const url = new URL(uri);
			if (url.protocol !== "file:" || url.host || url.search || url.hash) return undefined;
			const path = relative(this.cwd, fileURLToPath(url));
			return (await this.allowed(path)) ? path : undefined;
		} catch {
			return undefined;
		}
	}
	async read(path: string): Promise<{ text: string; digest: string }> {
		if (!(await this.allowed(path))) throw new Error("LSP target denied by file policy");
		const fd = openSync(join(this.cwd, path), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		try {
			const stat = fstatSync(fd);
			if (!stat.isFile() || stat.nlink !== 1 || stat.size > 262144) throw new Error("Unsupported LSP file");
			const buffer = Buffer.alloc(262145);
			let length = 0;
			while (length < buffer.length) {
				const count = readSync(fd, buffer, length, buffer.length - length, length);
				if (!count) break;
				length += count;
			}
			const text = decodeAnchoredText(buffer.subarray(0, length));
			return { text, digest: fileDigest(text) };
		} finally {
			closeSync(fd);
		}
	}
}
export function lspPosition(text: string, line: number, column: number): { line: number; character: number } {
	const lines = text.split(/\r\n|\n|\r/);
	const target = lines[line - 1];
	if (
		!Number.isSafeInteger(line) ||
		!Number.isSafeInteger(column) ||
		line < 1 ||
		column < 1 ||
		target === undefined ||
		column > target.length + 1 ||
		(/[\ud800-\udbff]/.test(target[column - 2] ?? "") && /[\udc00-\udfff]/.test(target[column - 1] ?? ""))
	)
		throw new Error("LSP position outside file (1-based UTF-16 line/column required)");
	return { line: line - 1, character: column - 1 };
}
