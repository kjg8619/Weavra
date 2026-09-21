import childProcess from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printHelp } from "../src/cli/args.ts";
import { APP_NAME, APP_TITLE, ENV_AGENT_DIR, PRODUCT_VERSION, VERSION } from "../src/config.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { shareSession } from "../src/modes/interactive/session-share.ts";
import { handlePackageCommand } from "../src/package-manager-cli.ts";

let directory: string;
let oldExitCode: typeof process.exitCode;
beforeEach(() => {
	directory = mkdtempSync(join(tmpdir(), "weavra-independence-"));
	vi.stubEnv(ENV_AGENT_DIR, directory);
	vi.stubEnv("PI_OFFLINE", undefined);
	vi.stubEnv("PI_SKIP_VERSION_CHECK", undefined);
	oldExitCode = process.exitCode;
	process.exitCode = undefined;
});
afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	process.exitCode = oldExitCode;
	rmSync(directory, { recursive: true, force: true });
});

describe("Weavra product independence", () => {
	it("identifies the current product and help without claiming an internal package release", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		printHelp();
		const help = log.mock.calls.flat().join("\n");
		expect(APP_NAME).toBe("weavra");
		expect(APP_TITLE).toBe("Weavra");
		expect(help).toContain("Weavra");
		expect(help).toContain("weavra update");
		expect(help).not.toMatch(/\bPi\b|π|\bpi update\b|pi\.dev/);
		expect(PRODUCT_VERSION).toContain("Weavra development");
		expect(PRODUCT_VERSION).toContain(`runtime ${VERSION}`);
		expect(PRODUCT_VERSION).not.toBe(VERSION);
	});

	it("sets a Weavra terminal title with the session and working directory", () => {
		const setTitle = vi.fn();
		const context = {
			sessionManager: { getCwd: () => "/workspace/example", getSessionName: () => "Review" },
			ui: { terminal: { setTitle } },
		};
		const prototype = InteractiveMode.prototype as unknown as { updateTerminalTitle(this: typeof context): void };
		prototype.updateTerminalTitle.call(context);
		expect(setTitle).toHaveBeenCalledWith("Weavra - Review - example");
	});

	it("never contacts a product version/release service or activates an inherited installer on update", async () => {
		const fetch = vi.fn(() => {
			throw new Error("Network is forbidden");
		});
		vi.stubGlobal("fetch", fetch);
		const spawn = vi.spyOn(childProcess, "spawn");
		const spawnSync = vi.spyOn(childProcess, "spawnSync");
		vi.stubEnv("PI_MANAGED_INSTALL_ROOT", directory);
		vi.stubEnv("PI_INSTALLER_API_BASE", "https://pi.dev/api/installer/releases");
		vi.stubEnv("PI_PACKAGE_DIR", join(directory, "releases", VERSION));
		const marker = join(directory, "current-version");
		writeFileSync(marker, "historical-release\n");
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		for (const args of [["update"], ["update", "--self", "--force"], ["update", "weavra"]]) {
			expect(await handlePackageCommand(args)).toBe(true);
		}
		expect(log.mock.calls.flat().join("\n")).toContain("https://github.com/kjg8619/Weavra");
		expect(log.mock.calls.flat().join("\n")).not.toMatch(/up to date|Updated Weavra|pi\.dev/);
		expect(fetch).not.toHaveBeenCalled();
		expect(spawn).not.toHaveBeenCalled();
		expect(spawnSync).not.toHaveBeenCalled();
		expect(readFileSync(marker, "utf8")).toBe("historical-release\n");
		expect(process.exitCode).toBeUndefined();
	});

	it("runs normal interactive startup services without any Pi product network request", async () => {
		const fetch = vi.fn(() => {
			throw new Error("Unexpected network");
		});
		vi.stubGlobal("fetch", fetch);
		const modelRuntime = await ModelRuntime.create({ credentials: AuthStorage.inMemory(), modelsPath: null });
		// Only terminal mounting/input are replaced; the normal online catalog/startup dispatch runs.
		const stop = new Error("input boundary reached");
		const context = {
			init: async () => {},
			version: VERSION,
			options: {},
			session: { modelRuntime },
			updateAvailableProviderCount: async () => {},
			checkForPackageUpdates: async () => [],
			checkTmuxKeyboardSetup: async () => undefined,
			maybeWarnAboutAnthropicSubscriptionAuth: async () => {},
			getUserInput: async () => {
				throw stop;
			},
		};
		await expect(InteractiveMode.prototype.run.call(context as unknown as InteractiveMode)).rejects.toBe(stop);
		await modelRuntime.refresh({ allowNetwork: true, force: true });
		expect(fetch).not.toHaveBeenCalled();
	});

	it("rejects remote sharing without touching credentials, session data, network or gh", async () => {
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const spawn = vi.spyOn(childProcess, "spawn");
		const spawnSync = vi.spyOn(childProcess, "spawnSync");
		const showError = vi.fn();
		const context = new Proxy(
			{ showError },
			{
				get(target, key) {
					if (key !== "showError") throw new Error(`Private data accessed: ${String(key)}`);
					return target.showError;
				},
			},
		);
		await shareSession(context);
		expect(showError.mock.calls.flat().join(" ")).toContain("/export");
		expect(fetch).not.toHaveBeenCalled();
		expect(spawn).not.toHaveBeenCalled();
		expect(spawnSync).not.toHaveBeenCalled();
	});
});
