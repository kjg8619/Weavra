import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

for (const [script, args] of [
	["release.mjs", ["patch"]],
	["publish.mjs", []],
	["publish-release-announcement.mjs", ["--version", "0.85.1", "--bucket", "inherited", "--endpoint", "https://pi.dev"]],
	["release-notes.mjs", ["fix-github-releases"]],
]) {
	test(`${script} cannot publish or mutate an inherited product`, () => {
		const directory = mkdtempSync(join(tmpdir(), "weavra-publication-policy-"));
		try {
			const guard = join(directory, "guard.mjs");
			const calls = join(directory, "calls");
			writeFileSync(guard, `import childProcess from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const forbidden = () => { appendFileSync(${JSON.stringify(calls)}, 'attempt'); throw new Error('External authority attempted'); };
globalThis.fetch = forbidden;
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync']) childProcess[method] = forbidden;
syncBuiltinESMExports();
`);
			const result = spawnSync(process.execPath, ["--import", guard, join(root, "scripts", script), ...args], {
				cwd: root,
				env: { PATH: process.env.PATH, HOME: directory },
				encoding: "utf8",
				timeout: 10_000,
			});
			assert.equal(result.status, 1, result.stderr);
			assert.match(result.stderr, /Weavra/);
			assert.equal(existsSync(calls), false, "No npm, Git, gh, installer or network operation is authorized");
		} finally {
			rmSync(directory, { recursive: true, force: true });
		}
	});
}

test("product independence preserves the original MIT grant and author attribution byte-for-byte", () => {
	const license = readFileSync(join(root, "LICENSE"));
	assert.equal(createHash("sha256").update(license).digest("hex"), "0457f5bcec3b3b211605dfb5d1a49042fd638f3686a410fe099c24a25af13c48");
});
