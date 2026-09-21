import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  CloudPublicConfigMissingError,
  hasCloudPublicConfig,
  resolveCloudPublicConfig,
  resolveRelayClerkTokenOptions,
  resolveRelayTracingConfig,
} from "./publicConfig";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("independent hosted-service policy", () => {
  it("refuses complete inherited tenant and tracing configuration without a network request", () => {
    const fetch = vi.fn(() => {
      throw new Error("Unexpected network request");
    });
    vi.stubGlobal("fetch", fetch);
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_live_${btoa("clerk.t3.codes$")}`);
    vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "t3-relay");
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.t3.codes");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_URL", "https://collector.example.test/v1/traces");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_DATASET", "inherited");
    vi.stubEnv("VITE_RELAY_OTLP_TRACES_TOKEN", "inherited-token");
    expect(hasCloudPublicConfig()).toBe(false);
    expect(resolveCloudPublicConfig().relayUrl).toBeNull();
    expect(resolveRelayTracingConfig()).toBeNull();
    expect(() => resolveRelayClerkTokenOptions()).toThrow(CloudPublicConfigMissingError);
    expect(fetch).not.toHaveBeenCalled();
  });
});
