import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV_AGENT_DIR, findNodePackageDir, getAgentDir, getPackageDir } from "../src/config.ts";

const directories: string[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("product paths", () => {
	it("does not reuse inherited Pi agent or package directories", () => {
		vi.stubEnv(ENV_AGENT_DIR, undefined);
		vi.stubEnv("WEAVRA_HOME", undefined);
		vi.stubEnv("WEAVRA_PACKAGE_DIR", undefined);
		vi.stubEnv("PI_CODING_AGENT_DIR", join(tmpdir(), "inherited-pi-agent"));
		vi.stubEnv("PI_PACKAGE_DIR", join(tmpdir(), "inherited-pi-package"));
		expect(getAgentDir()).toBe(join(homedir(), ".weavra", "agent"));
		expect(getPackageDir()).not.toBe(process.env.PI_PACKAGE_DIR);
	});

	it("honors canonical agent override before product home, including tilde expansion", () => {
		vi.stubEnv("WEAVRA_HOME", "~/custom-weavra");
		vi.stubEnv(ENV_AGENT_DIR, undefined);
		expect(getAgentDir()).toBe(join(homedir(), "custom-weavra", "agent"));
		vi.stubEnv(ENV_AGENT_DIR, "~/explicit-agent");
		expect(getAgentDir()).toBe(join(homedir(), "explicit-agent"));
	});

	it("honors an explicit product package asset override", () => {
		const directory = mkdtempSync(join(tmpdir(), "weavra-assets-"));
		directories.push(directory);
		vi.stubEnv("WEAVRA_PACKAGE_DIR", directory);
		expect(getPackageDir()).toBe(directory);
	});

	it("skips binary metadata copied into dist when resolving Node package assets", () => {
		const directory = mkdtempSync(join(tmpdir(), "weavra-package-dir-"));
		directories.push(directory);
		const dist = join(directory, "dist");
		const bundle = join(dist, "bundle");
		mkdirSync(bundle, { recursive: true });
		writeFileSync(join(directory, "package.json"), "{}");
		writeFileSync(join(dist, "package.json"), "{}");
		expect(findNodePackageDir(bundle)).toBe(directory);
	});
});
