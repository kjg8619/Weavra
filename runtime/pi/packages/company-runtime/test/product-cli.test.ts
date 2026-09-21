import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const launcher = resolve(import.meta.dirname, "../bin/weavra");
let directory: string;
let home: string;
let project: string;
const privateAuth = JSON.stringify({ inherited: { apiKey: "PRIVATE_PI_TOKEN_NEVER_IMPORT" } });
const candidateState = JSON.stringify({ authority: "CANDIDATE_ONLY", status: "UNVERIFIED", owner: "Kernel" });

beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "weavra-product-cli-"));
	home = join(directory, "home");
	project = join(directory, "project");
	mkdirSync(join(home, ".pi", "agent"), { recursive: true });
	mkdirSync(join(project, ".ai"), { recursive: true });
	writeFileSync(join(home, ".pi", "agent", "auth.json"), privateAuth);
	writeFileSync(join(project, ".ai", "state.json"), candidateState);
	writeFileSync(
		join(directory, "network-guard.mjs"),
		`import { appendFileSync } from 'node:fs';
globalThis.fetch = () => { appendFileSync(${JSON.stringify(join(directory, "requests"))}, 'request'); throw new Error('Unexpected product network'); };
`,
	);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("canonical Weavra CLI product boundary", () => {
	for (const args of [["--help"], ["--version"], ["update"], ["setup"], ["doctor"]]) {
		it(`${args.join(" ")} stays source-local without importing Pi auth or acquiring completion authority`, () => {
			const options = {
				cwd: project,
				encoding: "utf8" as const,
				timeout: 20_000,
				env: {
					PATH: process.env.PATH,
					HOME: home,
					USERPROFILE: home,
					NO_COLOR: "1",
					NODE_OPTIONS: `--import=${join(directory, "network-guard.mjs")}`,
					PI_CODING_AGENT_DIR: join(home, ".pi", "agent"),
					PI_CODING_AGENT_SESSION_DIR: join(home, ".pi", "sessions"),
					PI_MANAGED_INSTALL_ROOT: join(home, ".pi"),
					PI_INSTALLER_API_BASE: "https://pi.dev/api/installer/releases",
				},
			};
			if (args[0] === "doctor") expect(spawnSync(launcher, ["setup"], options).status).toBe(0);
			const result = spawnSync(launcher, args, options);
			expect(result.status, result.stderr).toBe(0);
			const output = result.stdout + result.stderr;
			expect(output).toContain("Weavra");
			expect(output).not.toContain("PRIVATE_PI_TOKEN_NEVER_IMPORT");
			expect(readFileSync(join(home, ".pi", "agent", "auth.json"), "utf8")).toBe(privateAuth);
			expect(readFileSync(join(project, ".ai", "state.json"), "utf8")).toBe(candidateState);
			expect(existsSync(join(directory, "requests"))).toBe(false);
			if (args[0] === "--help" || args[0] === "--version") {
				expect(output).not.toMatch(/\bPi\b|π|pi\.dev/);
			}
			if (args[0] === "--version") expect(output).toMatch(/^Weavra development \(runtime [^)]+\)\s*$/);
			if (args[0] === "update") expect(output).not.toMatch(/up to date|Updated Weavra/);
			if (args[0] === "setup") {
				expect(existsSync(join(home, ".weavra", "agent"))).toBe(true);
				const auth = join(home, ".weavra", "agent", "auth.json");
				if (existsSync(auth)) expect(readFileSync(auth, "utf8")).not.toContain("PRIVATE_PI_TOKEN_NEVER_IMPORT");
			}
		});
	}
});
