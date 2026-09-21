import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { resolveServerDirectory, ServerLifetime } from "../src/experimental/server.ts";

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("server lifecycle", () => {
	test("uses the isolated product server home and explicit compatibility overrides", () => {
		vi.stubEnv("WEAVRA_SERVER_DIR", undefined);
		vi.stubEnv("PI_SERVER_DIR", undefined);
		vi.stubEnv("WEAVRA_HOME", undefined);
		expect(resolveServerDirectory()).toBe(join(homedir(), ".weavra", "server"));
		vi.stubEnv("WEAVRA_HOME", "~/weavra-custom");
		expect(resolveServerDirectory()).toBe(join(homedir(), "weavra-custom", "server"));
		vi.stubEnv("PI_SERVER_DIR", "/tmp/legacy-explicit-server");
		expect(resolveServerDirectory()).toBe("/tmp/legacy-explicit-server");
		vi.stubEnv("WEAVRA_SERVER_DIR", "/tmp/weavra-server");
		expect(resolveServerDirectory()).toBe("/tmp/weavra-server");
		expect(resolveServerDirectory("/tmp/explicit-server")).toBe("/tmp/explicit-server");
	});

	test("holds a foreground server until explicit shutdown", () => {
		vi.useFakeTimers();
		const retire = vi.fn();
		const lifetime = new ServerLifetime(true);
		lifetime.start(retire);
		vi.advanceTimersByTime(60_000);
		expect(retire).not.toHaveBeenCalled();
		lifetime.stop();
	});

	test("retires an automatic server if no first client arrives", () => {
		vi.useFakeTimers();
		const retire = vi.fn();
		const lifetime = new ServerLifetime(false);
		lifetime.start(retire);
		vi.advanceTimersByTime(10_999);
		expect(retire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(retire).toHaveBeenCalledOnce();
		lifetime.stop();
	});

	test("requires both client and worker demand to disappear", () => {
		vi.useFakeTimers();
		const retire = vi.fn();
		const lifetime = new ServerLifetime(false);
		lifetime.start(retire);
		lifetime.setConnectionCount(1);
		lifetime.setWorkerCount(1);
		lifetime.setConnectionCount(0);
		vi.advanceTimersByTime(10_000);
		expect(retire).not.toHaveBeenCalled();

		lifetime.setWorkerCount(0);
		vi.advanceTimersByTime(999);
		expect(retire).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(retire).toHaveBeenCalledOnce();
		lifetime.stop();
	});
});
