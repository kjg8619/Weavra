import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	ANCHORED_MAX_BYTES,
	applyAnchoredReplacement,
	decodeAnchoredText,
	fileDigest,
	makeAnchor,
	snapshotText,
	verifyAnchor,
} from "../src/anchored-edit.ts";

const path = "/workspace/src/app.ts";
function edit(text: string, line: number, oldText: string, newText = "fixed") {
	const anchor = snapshotText(path, text).split("\n")[line].split(" ")[0];
	return applyAnchoredReplacement(path, text, { oldText, newText, anchor, fileDigest: fileDigest(text) });
}

describe("V0.3A pure anchored text contract", () => {
	it.each(["foo()\nfoo()\n", "汉字 한글 😀\r\n끝", "\ufeffBOM\n", "", "x".repeat(ANCHORED_MAX_BYTES)])(
		"identical input yields identical snapshot, digest and anchors (%#)",
		(text) => {
			expect(snapshotText(path, text)).toBe(snapshotText(path, text));
			expect(fileDigest(text)).toBe(fileDigest(text));
			expect(decodeAnchoredText(Buffer.from(text))).toBe(text);
		},
	);
	it.each(["foo()\n", "foo()\r\n", "foo()", "changed\n"])("binds exact line bytes: %j", (line) => {
		const variants = ["foo()\n", "foo()\r\n", "foo()", "changed\n"];
		for (const other of variants.filter((value) => value !== line)) {
			expect(makeAnchor(path, 1, line)).not.toBe(makeAnchor(path, 1, other));
			expect(fileDigest(line)).not.toBe(fileDigest(other));
		}
	});
	it("binds line identity, path and workspace, but leaves unrelated line anchors unchanged", () => {
		const anchor = makeAnchor(path, 1, "foo()\n");
		expect(anchor).not.toBe(makeAnchor(path, 2, "foo()\n"));
		expect(anchor).not.toBe(makeAnchor("/workspace/src/other.ts", 1, "foo()\n"));
		expect(anchor).not.toBe(makeAnchor("/other-workspace/src/app.ts", 1, "foo()\n"));
		expect(snapshotText(path, "foo()\nother\n").split("\n")[1]).toContain(anchor);
		expect(snapshotText(path, "foo()\nchanged\n").split("\n")[1]).toContain(anchor);
	});
	it("edits duplicates elsewhere using only the selected line", () => {
		expect(edit("foo()\nfoo()\n", 2, "foo()")).toBe("foo()\nfixed\n");
	});
	it("supports exact multiline matches starting within the anchored line", () => {
		expect(edit("  foo()\r\nbar()\r\n", 1, "foo()\r\nbar()", "한글😀")).toBe("  한글😀\r\n");
	});
	it.each(["foo() foo()\n", "aaaa\n"])("rejects multiple starts, including overlaps: %j", (text) => {
		expect(() => edit(text, 1, text.startsWith("a") ? "aa" : "foo()")).toThrow("AMBIGUOUS_ANCHOR");
	});
	it("does not find oldText at a different line or fuzzy-match it", () => {
		expect(() => edit("not here\nfoo()\n", 1, "foo()")).toThrow("STALE_ANCHOR");
		expect(() => edit("foo ()\n", 1, "foo()")).toThrow("STALE_ANCHOR");
	});
	it("rejects invalid/moved/fabricated anchors before any location fallback", () => {
		for (const anchor of [
			"fake",
			`a1:L01:${"0".repeat(64)}`,
			makeAnchor(path, 9, "foo()\n"),
			makeAnchor(path, 1, "wrong"),
		])
			expect(() => verifyAnchor(path, "foo()\n", anchor)).toThrow("STALE_ANCHOR");
	});
	it("verifies full generation before line anchor", () => {
		expect(() =>
			applyAnchoredReplacement(path, "foo()\nexternal\n", {
				oldText: "foo()",
				newText: "fixed",
				anchor: "fake",
				fileDigest: fileDigest("foo()\n"),
			}),
		).toThrow("file generation mismatch");
	});
	it("escapes controls, bidi, backslashes and line separators without changing tokens", () => {
		const text = '汉字\t\x1b[31m\x7f\x85\u202e\u2066\u2028\\"\r\n';
		const snapshot = snapshotText(path, text);
		expect(snapshot).not.toMatch(/[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u202e\u2066]/);
		const row = snapshot.split("\n")[1];
		expect(row.split(" ")[0]).toBe(makeAnchor(path, 1, text));
		expect(JSON.parse(row.slice(row.indexOf(" ") + 1))).toBe(text);
	});
	it("bounds many-line output, retains complete tokens and marks omissions", () => {
		const snapshot = snapshotText(path, "x\n".repeat(ANCHORED_MAX_BYTES / 2));
		expect(Buffer.byteLength(snapshot)).toBeLessThanOrEqual(ANCHORED_MAX_BYTES);
		expect(snapshot).toContain("[remaining lines omitted: output limit]");
	});
	it("bounds long-line preview while permitting edits beyond the preview", () => {
		const text = `${"x".repeat(ANCHORED_MAX_BYTES - 6)}foo()\n`;
		expect(snapshotText(path, text)).toContain("[line preview truncated]");
		expect(edit(text, 1, "foo()", "bar()")).toBe(text.replace("foo()", "bar()"));
	});
	it("accepts exact byte boundary and rejects source/replacement overflow", () => {
		const text = "x".repeat(ANCHORED_MAX_BYTES);
		expect(edit(text, 1, text, "y".repeat(ANCHORED_MAX_BYTES))).toHaveLength(ANCHORED_MAX_BYTES);
		expect(() => snapshotText(path, `${text}x`)).toThrow("bounded");
		expect(() => edit(text, 1, text, `${text}x`)).toThrow("bounded");
		expect(() => snapshotText(path, "한".repeat(ANCHORED_MAX_BYTES / 3 + 1))).toThrow("bounded");
	});
	it.each([Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]), Buffer.from([0xe3, 0x81]), Buffer.from("binary\0data")])(
		"rejects invalid UTF-8 or binary bytes (%#)",
		(bytes) => expect(() => decodeAnchoredText(bytes)).toThrow("strict UTF-8"),
	);
	it.each(["\0", "\ud800"])("rejects unsafe replacement %j", (replacement) => {
		expect(() => edit("foo()\n", 1, "foo()", replacement)).toThrow("UTF-8");
	});
	it("keeps the domain helper independent of filesystem, Pi and provider imports", () => {
		const source = readFileSync(new URL("../src/anchored-edit.ts", import.meta.url), "utf8");
		expect([...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1])).toEqual(["node:crypto"]);
		expect(source).not.toMatch(/\b(?:import|require)\s*\(/);
	});
});
