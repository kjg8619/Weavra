import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

for (const prefix of ["", "runtime/pi"]) {
	test(`lockfile review gate remains enforced in ${prefix || "standalone checkout"}`, async (t) => {
		const root = await mkdtemp(join(tmpdir(), "pi-lock-gate-"));
		t.after(() => rm(root, { recursive: true, force: true }));
		const checkout = join(root, prefix);
		await mkdir(join(checkout, "scripts"), { recursive: true });
		await copyFile(new URL("./check-lockfile-commit.mjs", import.meta.url), join(checkout, "scripts/check-lockfile-commit.mjs"));
		const lockfile = join(checkout, "package-lock.json");
		const lock = (version) => JSON.stringify({ packages: { "node_modules/example": { version } } });
		await writeFile(lockfile, lock("1.0.0"));
		const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
		git("init", "-q");
		git("add", "--", ".");
		git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "-c", "commit.gpgsign=false", "commit", "-qm", "baseline");
		await writeFile(lockfile, lock("2.0.0"));
		git("add", "--", lockfile);
		const result = spawnSync(process.execPath, [join(checkout, "scripts/check-lockfile-commit.mjs")], {
			cwd: root,
			env: { ...process.env, PI_ALLOW_LOCKFILE_CHANGE: "" },
			encoding: "utf8",
		});
		assert.equal(result.status, 1, result.stderr);
		assert.match(result.stderr, /example 1\.0\.0 -> 2\.0\.0/);
	});
}
