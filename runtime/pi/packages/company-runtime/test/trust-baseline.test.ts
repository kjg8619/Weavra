import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scripts = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> })
	.scripts;
describe("FIX-01/02 installation and non-mutating CI contract", () => {
	it("non-write Biome fails an unformatted fixture without fixing its bytes", () => {
		const cwd = mkdtempSync(join(tmpdir(), "weavra-ci-format-"));
		try {
			const source = "export const example={value:1};\n";
			writeFileSync(join(cwd, "fixture.js"), source);
			const args = scripts["check:ci"].split(" && ")[0].split(" ").slice(1);
			const result = spawnSync(join(root, "node_modules/.bin/biome"), args, {
				cwd,
				encoding: "utf8",
				timeout: 10000,
			});
			expect(result.error).toBeUndefined();
			expect(result.status).not.toBe(0);
			expect(result.stdout + result.stderr).toContain("format");
			expect(readFileSync(join(cwd, "fixture.js"), "utf8")).toBe(source);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
