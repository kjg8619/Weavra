import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseDocument } from "yaml";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const scripts = (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts: Record<string, string> })
	.scripts;
const workflowSource = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
const workflow = parseDocument(workflowSource).toJS() as {
	on: { push: { branches: string[] }; pull_request: { branches: string[] } };
	jobs: Record<string, { steps: Array<{ name: string; run?: string; if?: string }> }>;
};
describe("FIX-01/02 installation and non-mutating CI contract", () => {
	it("installs the Weavra devlop branch, distinguishes main and historical RC, and keeps rebuild guidance", () => {
		const readme = readFileSync(join(root, "README.md"), "utf8");
		expect(readme).toContain("git clone --branch devlop --single-branch");
		expect(readme).toContain("upstream/base Pi");
		expect(readme).toContain("current Weavra development");
		expect(readme).toContain("immutable historical RC baseline");
		expect(readme).toContain("다시 build");
	});
	it("retains all shared checks while removing only Biome write from CI", () => {
		expect(scripts.check).toBe("biome check --write --error-on-warnings . && npm run check:base");
		expect(scripts["check:ci"]).toBe("biome check --error-on-warnings . && npm run check:base");
		expect(scripts["check:base"].split(" && ")).toEqual([
			"npm run check:pinned-deps",
			"npm run check:runtime-deps",
			"npm run check:ts-imports",
			"npm run check:entry-graphs",
			"npm run check:shrinkwrap",
			"npm run check:install-lock:coding-agent",
			"tsgo --noEmit",
			"npm run check:browser-smoke",
		]);
	});
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
	it("runs main/devlop push and PR with isolated tests and a final tracked-source guard", () => {
		expect(workflow.on.push.branches).toEqual(["main", "devlop"]);
		expect(workflow.on.pull_request.branches).toEqual(["main", "devlop"]);
		const steps = workflow.jobs["build-check-test"].steps;
		expect(steps.some((step) => step.run === "npm run check:ci")).toBe(true);
		expect(steps.some((step) => step.run === "bash ./test.sh")).toBe(true);
		expect(steps.at(-1)).toMatchObject({ if: "always()", run: "git diff --exit-code HEAD --" });
		expect(workflowSource).not.toMatch(/git\s+(?:reset|checkout|stash|clean)/);
		expect(readFileSync(join(root, "test.sh"), "utf8")).toMatch(/env -i "\$\{test_env\[@\]\}" npm test/);
	});
	it("hydrates ignored data then builds committed source instead of regenerating tracked catalogs", () => {
		const commands = workflow.jobs["build-check-test"].steps.flatMap((step) => step.run ?? []);
		expect(commands.indexOf("npm run hydrate:model-data")).toBeLessThan(commands.indexOf("npm run build:offline"));
		expect(commands).not.toContain("npm run build");
		const ai = JSON.parse(readFileSync(join(root, "packages/ai/package.json"), "utf8")) as {
			scripts: Record<string, string>;
		};
		expect(ai.scripts["hydrate-model-data"]).toContain("--data-only");
		expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("packages/ai/src/providers/data/");
	});
});
