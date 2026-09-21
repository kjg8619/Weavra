import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { WEAVRA_EVAL_FIXTURES } from "../src/weavra-fixtures.ts";
import { materializeFixture } from "../src/weavra-harness.ts";

const roots: string[] = [];
function fixtureRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "weavra-eval-test-"));
	roots.push(root);
	return root;
}

describe("V0.3F Weavra eval adapter (deterministic)", () => {
	it("materializes isolated Git fixtures with a trusted config and required check", () => {
		const fixture = WEAVRA_EVAL_FIXTURES[0];
		const root = fixtureRoot();
		const { cwd, config } = materializeFixture(fixture, root, { provider: "faux", model: "model" });
		expect(readFileSync(join(cwd, "src/greeting.js"), "utf8")).toContain("Hello");
		expect(config.verification.checks.map((check) => check.id)).toEqual(["eval"]);
		expect(config.files.allowed_paths).toEqual(["src"]);
		// Oracle is Host-owned and satisfied on the pristine read-only fixture.
		expect(fixture.oracle({ workspace: cwd, status: "COMPLETED" })).toEqual([]);
	});

	it("keeps the oracle independent from Runtime completion claims (false completion fails)", () => {
		const editFixtures = WEAVRA_EVAL_FIXTURES.filter(
			(fixture) => fixture.id.endsWith("edit") || fixture.id === "standard-2ac",
		);
		for (const fixture of editFixtures) {
			const root = fixtureRoot();
			const { cwd } = materializeFixture(fixture, root, { provider: "faux", model: "model" });
			// Pristine workspace: a COMPLETED claim must still fail the Host oracle.
			const failures = fixture.oracle({ workspace: cwd, status: "COMPLETED" });
			expect(failures.length).toBeGreaterThan(0);
			// Applying the expected mutation satisfies the oracle without any agent involvement.
			// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture content holds a literal ${name} placeholder
			writeFileSync(join(cwd, "src/greeting.js"), "export function greet(name) {\n\treturn `Hello, ${name}!`;\n}\n");
			expect(fixture.oracle({ workspace: cwd, status: "COMPLETED" })).toEqual([]);
		}
	});

	it("flags the incomplete fixture as a false-completion probe", () => {
		const fixture = WEAVRA_EVAL_FIXTURES.find((entry) => entry.id === "standard-incomplete");
		expect(fixture).toBeDefined();
		const root = fixtureRoot();
		const { cwd } = materializeFixture(fixture!, root, { provider: "faux", model: "model" });
		// Typo fixed but rename missing: Runtime could claim COMPLETED while the oracle still fails.
		// biome-ignore lint/suspicious/noTemplateCurlyInString: fixture content holds a literal ${name} placeholder
		writeFileSync(join(cwd, "src/greeting.js"), "export function greet(name) {\n\treturn `Hello, ${name}!`;\n}\n");
		const failures = fixture!.oracle({ workspace: cwd, status: "COMPLETED" });
		expect(failures.join(" ")).toContain("welcome");
	});

	it("covers read-only, QUICK and STANDARD comparison targets", () => {
		expect(WEAVRA_EVAL_FIXTURES).toHaveLength(6);
		expect(WEAVRA_EVAL_FIXTURES.filter((fixture) => fixture.workflow === "QUICK")).toHaveLength(4);
		expect(WEAVRA_EVAL_FIXTURES.filter((fixture) => fixture.workflow === "STANDARD")).toHaveLength(2);
	});
});

process.on("exit", () => {
	for (const root of roots) rmSync(root, { recursive: true, force: true });
});
