import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HOST_RUN_DIFF_FILE_MAX_BYTES, HOST_RUN_DIFF_TOTAL_MAX_BYTES } from "../src/host-control-protocol.ts";
import type { PolicyContext } from "../src/policy.ts";
import { readRunDiff, runDiffRecords, unifiedPatch } from "../src/run-diff.ts";
import { GitWorkspace } from "../src/workspace.ts";

const policy: PolicyContext = {
	executionMode: "EDIT",
	executionRunId: "run-diff-test",
	configDigest: "config",
	allowedPaths: ["src"],
	tools: [{ id: "runtime_edit", operation: "edit" }],
};
const directories: string[] = [];
afterEach(async () => {
	await Promise.all(directories.splice(0).map((cwd) => rm(cwd, { recursive: true, force: true })));
});

async function repository(files: Record<string, string>) {
	const cwd = await realpath(await mkdtemp(join(tmpdir(), "weavra-run-diff-")));
	directories.push(cwd);
	const put = async (path: string, text: string) => {
		await mkdir(dirname(join(cwd, path)), { recursive: true });
		await writeFile(join(cwd, path), text);
	};
	for (const [path, text] of Object.entries(files)) await put(path, text);
	const git = (...args: string[]) =>
		execFileSync("git", args, {
			cwd,
			env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" },
		});
	git("init", "-q");
	git("add", "--", ".");
	git("-c", "user.name=F", "-c", "user.email=f@invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "base");
	return { cwd, put };
}
const text = (value: string) => ({ mode: "100644", text: value });
const options = { allowedPaths: policy.allowedPaths };

describe("unified Run patch", () => {
	it("keeps up to three context lines around the changed span and marks a missing final newline", () => {
		expect(unifiedPatch("src/a.ts", text("1\n2\n3\n4\n5\n6\n"), text("1\n2\n3\n4\nfive\n6\n"))).toBe(
			"diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -2,5 +2,5 @@\n 2\n 3\n 4\n-5\n+five\n 6\n",
		);
		expect(unifiedPatch("src/a.ts", text("a"), text("a\n"))).toBe(
			"diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+a\n",
		);
	});

	it("writes new, deleted, mode-only and quoted names like Git", () => {
		expect(unifiedPatch("src/n.ts", null, text("x\n"))).toBe(
			"diff --git a/src/n.ts b/src/n.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/n.ts\n@@ -0,0 +1,1 @@\n+x\n",
		);
		expect(unifiedPatch("src/d.ts", text("x\n"), null)).toBe(
			"diff --git a/src/d.ts b/src/d.ts\ndeleted file mode 100644\n--- a/src/d.ts\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-x\n",
		);
		expect(unifiedPatch("src/m.sh", text("x\n"), { mode: "100755", text: "x\n" })).toBe(
			"diff --git a/src/m.sh b/src/m.sh\nold mode 100644\nnew mode 100755\n",
		);
		expect(unifiedPatch('src/q"t.ts', null, text("")).split("\n")[0]).toBe(
			'diff --git "a/src/q\\"t.ts" "b/src/q\\"t.ts"',
		);
	});
});

describe("bounded Run diff records", () => {
	it("omits one oversized or non-text file and refuses an unproven base or an oversized total", () => {
		const big = `${"x".repeat(HOST_RUN_DIFF_FILE_MAX_BYTES)}\n`;
		const images = new Map([
			["src/big.ts", { before: null, after: text(big) }],
			["src/bin", { before: { mode: "100644", text: null }, after: { mode: "100644", text: null } }],
			["src/a.ts", { before: text("a\n"), after: text("b\n") }],
		]);
		const read = runDiffRecords(["src/a.ts", "src/big.ts", "src/bin"], images, 3);
		expect(read).toMatchObject({
			kind: "files",
			records: [
				{ index: 0, path: "src/a.ts", change: "modified", omitted: null },
				{ index: 1, path: "src/big.ts", change: "added", patch: null, omitted: "DIFF_TOO_LARGE" },
				{ index: 2, path: "src/bin", change: "modified", patch: null, omitted: "NOT_TEXT" },
			],
		});
		expect(runDiffRecords(["src/a.ts"], images, 3)).toEqual({ kind: "refused", reason: "DIFF_UNVERIFIED" });
		expect(runDiffRecords(["src/missing.ts"], images, 0)).toEqual({ kind: "refused", reason: "DIFF_UNVERIFIED" });
		const part = `${"y".repeat(HOST_RUN_DIFF_FILE_MAX_BYTES / 2)}\n`;
		const many = Array.from(
			{ length: HOST_RUN_DIFF_TOTAL_MAX_BYTES / (HOST_RUN_DIFF_FILE_MAX_BYTES / 2) + 1 },
			(_, i) => [`src/${i}.ts`, { before: null, after: text(part) }] as const,
		);
		expect(
			runDiffRecords(
				many.map(([path]) => path),
				new Map(many),
				many.length,
			),
		).toEqual({
			kind: "refused",
			reason: "DIFF_TOO_LARGE",
		});
	});
});

describe("Run diff from the workspace", () => {
	it("serves base..result only while the workspace is exactly the recorded result", async () => {
		const { cwd, put } = await repository({ "src/a.ts": "one\ntwo\n", "src/gone.ts": "bye\n", "README.md": "r\n" });
		const workspace = await GitWorkspace.open(cwd, policy);
		await put("src/a.ts", "one\nTWO\n");
		await put("src/new.ts", "fresh\n");
		await rm(join(cwd, "src/gone.ts"));
		const evidence = await workspace.inspect();
		expect(evidence.changedFiles).toEqual(["src/a.ts", "src/gone.ts", "src/new.ts"]);
		const read = await readRunDiff(cwd, options, evidence);
		expect(read).toEqual({
			kind: "files",
			records: [
				{
					category: "run-diff",
					index: 0,
					path: "src/a.ts",
					change: "modified",
					patch: unifiedPatch("src/a.ts", text("one\ntwo\n"), text("one\nTWO\n")),
					omitted: null,
				},
				{
					category: "run-diff",
					index: 1,
					path: "src/gone.ts",
					change: "deleted",
					patch: unifiedPatch("src/gone.ts", text("bye\n"), null),
					omitted: null,
				},
				{
					category: "run-diff",
					index: 2,
					path: "src/new.ts",
					change: "added",
					patch: unifiedPatch("src/new.ts", null, text("fresh\n")),
					omitted: null,
				},
			],
		});
		expect(await readRunDiff(cwd, options, { ...evidence, changedLines: (evidence.changedLines ?? 0) + 1 })).toEqual({
			kind: "refused",
			reason: "DIFF_UNVERIFIED",
		});
		expect(await readRunDiff(cwd, options, { ...evidence, safe: false })).toEqual({
			kind: "refused",
			reason: "DIFF_UNVERIFIED",
		});
		await put("README.md", "unrelated\n");
		expect(await readRunDiff(cwd, options, evidence)).toEqual({ kind: "refused", reason: "DIFF_STALE" });
		await put("README.md", "r\n");
		expect(await readRunDiff(cwd, options, evidence)).toEqual(read);
	});
});
