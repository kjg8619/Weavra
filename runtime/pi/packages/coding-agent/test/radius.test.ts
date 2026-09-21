import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { allowNetwork } from "./test-network-env.ts";

function radiusOAuthCredential(gatewayBaseUrl: string) {
	return {
		type: "oauth" as const,
		access: "access-token",
		refresh: "refresh-token",
		expires: Date.now() + 60 * 60 * 1000,
		gatewayConfig: radiusConfig(gatewayBaseUrl),
	};
}

function radiusConfig(baseUrl: string) {
	return {
		baseUrl,
		models: [
			{
				id: "auto",
				name: "Radius Auto",
				reasoning: false,
				input: ["text" as const],
				cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0.2 },
				contextWindow: 128000,
				maxTokens: 16384,
			},
		],
	};
}

let tempDir: string;

beforeEach(() => {
	allowNetwork();
	tempDir = join(tmpdir(), `pi-test-radius-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
	vi.restoreAllMocks();
	if (tempDir && existsSync(tempDir)) rmSync(tempDir, { recursive: true });
});

describe("Radius provider", () => {
	it("ignores inherited Radius credentials and catalog authority during startup and forced refresh", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network request"));
		const modelsStore = new InMemoryModelsStore();
		const oldCredential = radiusOAuthCredential("https://radius.pi.dev/v1");
		await modelsStore.write("radius", {
			models: oldCredential.gatewayConfig.models.map((model) => ({
				...model,
				api: "pi-messages" as const,
				provider: "radius",
				baseUrl: "https://radius.pi.dev/v1",
			})),
			checkedAt: Date.now(),
		});
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({ radius: { ...oldCredential, expires: 0 } }),
			modelsStore,
			modelsPath: null,
			allowModelNetwork: true,
		});
		await runtime.refresh({ allowNetwork: true, force: true });
		expect(runtime.getProvider("radius")).toBeUndefined();
		expect(runtime.getModels("radius")).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("supports custom Radius gateways from models.json", async () => {
		const fetchSpy = vi
			.spyOn(globalThis, "fetch")
			.mockImplementation(
				async () => new Response(JSON.stringify(radiusConfig("http://localhost:8788/v1")), { status: 200 }),
			);
		const modelsPath = join(tempDir, "models.json");
		writeFileSync(
			modelsPath,
			JSON.stringify({
				providers: { "radius-dev": { name: "Radius (dev)", baseUrl: "http://localhost:8788", oauth: "radius" } },
			}),
		);
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({
				"radius-dev": {
					type: "oauth",
					access: "access-token",
					refresh: "refresh-token",
					expires: Date.now() + 60 * 60 * 1000,
				},
			}),
			modelsStore: new InMemoryModelsStore(),
			modelsPath,
			allowModelNetwork: true,
		});

		expect(runtime.getModel("radius-dev", "auto")).toMatchObject({
			api: "pi-messages",
			baseUrl: "http://localhost:8788/v1",
		});
		expect(runtime.getProvider("radius-dev")?.name).toBe("Radius (dev)");
		expect(fetchSpy.mock.calls.map(([url]) => String(url))).toEqual(["http://localhost:8788/v1/config"]);
		expect(fetchSpy.mock.calls[0]?.[1]?.headers).toMatchObject({ authorization: "Bearer access-token" });
	});

	it("does not restore an old Radius tenant catalog into an explicitly configured custom gateway", async () => {
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network request"));
		const modelsPath = join(tempDir, "models.json");
		writeFileSync(
			modelsPath,
			JSON.stringify({
				providers: {
					radius: { baseUrl: "https://gateway.example.test", oauth: "radius" },
				},
			}),
		);
		const modelsStore = new InMemoryModelsStore();
		const oldCredential = radiusOAuthCredential("https://radius.pi.dev/v1");
		await modelsStore.write("radius", {
			models: oldCredential.gatewayConfig.models.map((model) => ({
				...model,
				api: "pi-messages" as const,
				provider: "radius",
				baseUrl: "https://radius.pi.dev/v1",
			})),
			source: "https://radius.pi.dev/v1/config",
		});
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({ radius: oldCredential }),
			modelsStore,
			modelsPath,
			allowModelNetwork: false,
		});
		expect(runtime.getModels("radius")).toEqual([]);
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("requires baseUrl for custom Radius gateways", async () => {
		const modelsPath = join(tempDir, "models.json");
		writeFileSync(modelsPath, JSON.stringify({ providers: { "radius-dev": { oauth: "radius" } } }));
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory(),
			modelsStore: new InMemoryModelsStore(),
			modelsPath,
			allowModelNetwork: false,
		});

		expect(runtime.getError()).toContain('"baseUrl" is required when "oauth" is set');
	});
});
