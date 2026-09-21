import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseRuntimeConfig } from "../src/config.ts";

const minimal = {
	schemaVersion: 1,
	models: {
		profiles: { coding: { provider: "faux", model: "coding" }, reasoning: { provider: "faux", model: "review" } },
	},
};
const server = {
	id: "typescript",
	executable: "typescript-language-server",
	args: ["--stdio"],
	extensions: [".ts", ".tsx", ".js", ".jsx"],
};
const parse = (lsp: unknown) => parseRuntimeConfig(JSON.stringify({ ...minimal, code_intelligence: { lsp } }));
describe("explicit, default-disabled LSP configuration", () => {
	it("validates both README opt-in snippets as additions to existing complete config", () => {
		for (const path of ["../../../README.md", "../README.md"]) {
			const document = readFileSync(new URL(path, import.meta.url), "utf8");
			const blocks = [...document.matchAll(/```yaml\n([\s\S]*?)\n```/g)].filter((block) =>
				/^code_intelligence:/m.test(block[1]),
			);
			expect(blocks).toHaveLength(1);
			const config = parseRuntimeConfig(
				`schemaVersion: 1\nmodels: ${JSON.stringify(minimal.models)}\n${blocks[0][1]}`,
			);
			expect(config.code_intelligence?.lsp).toEqual({ enabled: true, servers: [{ ...server, timeout_ms: 10000 }] });
			expect(config.verification.checks).toEqual([]); // The opt-in snippet cannot synthesize required checks.
		}
	});
	it("keeps absent config/digest material unchanged and starts no implicit server", () => {
		expect(parseRuntimeConfig(JSON.stringify(minimal))).not.toHaveProperty("code_intelligence");
		expect(parse({}).code_intelligence?.lsp).toEqual({ enabled: false, servers: [] });
	});
	it("normalizes explicit registrations without shell strings, auto discovery or install", () => {
		expect(parse({ enabled: true, servers: [server] }).code_intelligence?.lsp.servers[0]).toEqual({
			...server,
			timeout_ms: 10000,
		});
	});
	it.each([
		{ enabled: true },
		{ enabled: "true", servers: [server] },
		{ enabled: true, servers: [server, { ...server, extensions: [".py"] }] },
		{ enabled: true, servers: [server, { ...server, id: "another" }] },
		...[
			{ executable: "typescript-language-server --stdio" },
			{ executable: "bash", args: ["script.sh"] },
			{ executable: "node", args: ["-e", "process.exit()"] },
			{ executable: "npx", args: ["typescript-language-server"] },
			{ command: "typescript-language-server --stdio" },
			{ env: { SECRET: "hidden" } },
			{ timeout_ms: 0 },
			{ timeout_ms: 60001 },
			{ timeout_ms: 1.5 },
			{ extensions: ["ts"] },
			{ extensions: [".ts", ".ts"] },
			{ extensions: [".TS"] },
			{ id: "unsafe\nname" },
			{ args: ["\0"] },
		].map((override) => ({ enabled: true, servers: [{ ...server, ...override }] })),
	])("rejects ambiguous/unsafe configuration %#", (lsp) => {
		expect(() => parse(lsp)).toThrow();
	});
});
