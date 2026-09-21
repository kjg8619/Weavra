import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("keeps Kernel, Policy and Graph import graphs free of Pi, UI, provider and filesystem adapters", () => {
	const sourceRoot = fileURLToPath(new URL("../src/", import.meta.url));
	const pending = [
		"kernel.ts",
		"classification.ts",
		"ports.ts",
		"events.ts",
		"policy.ts",
		"graph.ts",
		"graph-view.ts",
	].map((name) => resolve(sourceRoot, name));
	const visited = new Set<string>();
	while (pending.length) {
		const path = pending.pop()!;
		if (visited.has(path)) continue;
		visited.add(path);
		const source = readFileSync(path, "utf8");
		expect(source).not.toMatch(/\b(?:import|require)\s*\(/);
		for (const match of source.matchAll(/\bfrom\s+["']([^"']+)["']/g)) {
			const specifier = match[1];
			if (specifier.startsWith(".")) {
				const target = resolve(dirname(path), specifier);
				expect(target).not.toBe(resolve(sourceRoot, "extension.ts"));
				expect(target).not.toBe(resolve(sourceRoot, "config.ts"));
				pending.push(target);
			} else {
				// node:crypto is a deterministic pure module (hashing for the frozen Task Contract digest); no I/O or host coupling.
				expect(["typebox", "typebox/value", "node:crypto"]).toContain(specifier);
			}
		}
	}
	expect(visited.has(resolve(sourceRoot, "contracts.ts"))).toBe(true);
});
