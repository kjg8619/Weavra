import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import Constants from "expo-constants";
import {
  CloudPublicConfigMissingError,
  hasCloudPublicConfig,
  hasTracingPublicConfig,
  resolveCloudPublicConfig,
  resolveRelayClerkTokenOptions,
} from "./publicConfig";

vi.mock("expo-constants", () => ({ default: { expoConfig: { extra: {} } } }));
afterEach(() => {
  Constants.expoConfig!.extra = {};
});

describe("mobile hosted authority", () => {
  it.each([
    {},
    { clerk: { publishableKey: "pk_live_inherited" }, relay: { url: "https://relay.t3.codes" } },
    {
      clerk: { publishableKey: "pk_live_inherited", jwtTemplate: "t3-relay" },
      relay: { url: "https://relay.t3.codes" },
      observability: {
        tracesUrl: "https://api.axiom.co/v1/traces",
        tracesDataset: "mobile",
        tracesToken: "inherited",
      },
    },
  ])("does not grant hosted authority from manifest values %#", (extra) => {
    Constants.expoConfig!.extra = extra;
    const config = resolveCloudPublicConfig();
    expect(config.clerk.publishableKey).toBeNull();
    expect(config.clerk.jwtTemplate).toBeNull();
    expect(config.relay.url).toBeNull();
    expect(hasCloudPublicConfig()).toBe(false);
    expect(hasTracingPublicConfig(config)).toBe(false);
    expect(config.observability.tracesToken).toBeNull();
    expect(() => resolveRelayClerkTokenOptions()).toThrowError(CloudPublicConfigMissingError);
  });
});
