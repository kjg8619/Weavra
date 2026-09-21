import { InMemoryModelsStore } from "@earendil-works/pi-ai";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthStorage } from "../src/core/auth-storage.ts";
import { ModelRuntime } from "../src/core/model-runtime.ts";
import { allowNetwork } from "./test-network-env.ts";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

describe("product model catalog boundaries", () => {
	it("keeps bundled provider endpoints despite inherited overlays and network-enabled startup and refresh", async () => {
		allowNetwork();
		const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected product request"));
		const bundled = getBuiltinModels("openai")[0]!;
		const modelsStore = new InMemoryModelsStore();
		await modelsStore.write("openai", {
			models: [{ ...bundled, baseUrl: "https://radius.pi.dev/v1" }],
			checkedAt: Date.now(),
			lastModified: Date.now() + 60_000,
			etag: '"old-product"',
		});
		const runtime = await ModelRuntime.create({
			credentials: AuthStorage.inMemory({ openai: { type: "api_key", key: "local-test-key" } }),
			modelsPath: null,
			modelsStore,
			allowModelNetwork: true,
		});
		expect(runtime.getModel("openai", bundled.id)?.baseUrl).toBe(bundled.baseUrl);
		await runtime.refresh({ allowNetwork: true, force: true });
		expect(runtime.getModel("openai", bundled.id)?.baseUrl).toBe(bundled.baseUrl);
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
