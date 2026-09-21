import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { findNodePackageDir, getAgentDir, getPackageDir } from "../src/config.ts";

let tempDir: string | undefined;
afterEach(() => {
	vi.unstubAllEnvs();
	if (tempDir) rmSync(tempDir, { recursive: true, force: true });
	tempDir = undefined;
});

describe("runtime paths", () => {
	test("skips binary metadata copied into dist", () => {
		tempDir = mkdtempSync(join(tmpdir(), "weavra-package-dir-"));
		const distDir = join(tempDir, "dist");
		const bundleDir = join(distDir, "bundle");
		mkdirSync(bundleDir, { recursive: true });
		writeFileSync(join(tempDir, "package.json"), "{}");
		writeFileSync(join(distDir, "package.json"), "{}");
		expect(findNodePackageDir(bundleDir)).toBe(tempDir);
	});

	test("never uses inherited Pi home or package overrides", () => {
		tempDir = mkdtempSync(join(tmpdir(), "weavra-home-"));
		vi.stubEnv("HOME", tempDir);
		vi.stubEnv("USERPROFILE", tempDir);
		vi.stubEnv("WEAVRA_HOME", undefined);
		vi.stubEnv("WEAVRA_CODING_AGENT_DIR", undefined);
		vi.stubEnv("WEAVRA_PACKAGE_DIR", undefined);
		vi.stubEnv("PI_CODING_AGENT_DIR", join(tempDir, ".pi", "agent"));
		vi.stubEnv("PI_PACKAGE_DIR", join(tempDir, "foreign-package"));
		expect(getAgentDir()).toBe(join(tempDir, ".weavra", "agent"));
		expect(getPackageDir()).not.toBe(join(tempDir, "foreign-package"));
	});

	test("resolves explicit Weavra home and agent override precedence", () => {
		tempDir = mkdtempSync(join(tmpdir(), "weavra-home-"));
		vi.stubEnv("WEAVRA_HOME", tempDir);
		vi.stubEnv("WEAVRA_CODING_AGENT_DIR", undefined);
		expect(getAgentDir()).toBe(join(tempDir, "agent"));
		vi.stubEnv("WEAVRA_CODING_AGENT_DIR", join(tempDir, "custom-agent"));
		expect(getAgentDir()).toBe(join(tempDir, "custom-agent"));
	});
});
