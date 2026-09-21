import { afterEach, describe, expect, it, vi } from "vite-plus/test";

const env = vi.hoisted(() => ({ values: {} as Record<string, string> }));
vi.mock("../../scripts/lib/public-config.ts", () => ({ loadRepoEnv: () => env.values }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  env.values = {};
});

describe("independent mobile build authority", () => {
  it.each([
    ["production", "com.weavra.app", "weavra"],
    ["development", "com.weavra.app.dev", "weavra-dev"],
    ["preview", "com.weavra.app.preview", "weavra-preview"],
  ] as const)(
    "isolates %s and refuses inherited OTA and tenant configuration",
    async (variant, id, scheme) => {
      const inherited = {
        APP_VARIANT: variant,
        T3CODE_MOBILE_UPDATES_ENABLED: "1",
        T3CODE_RELAY_URL: "https://relay.t3.codes",
        EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_Y2xlcmsudDMuY29kZXMk",
        EXPO_PUBLIC_CLERK_JWT_TEMPLATE: "t3-relay",
        EXPO_PUBLIC_OTLP_TRACES_URL: "https://api.axiom.co/v1/traces",
        EXPO_PUBLIC_OTLP_TRACES_DATASET: "inherited",
        EXPO_PUBLIC_OTLP_TRACES_TOKEN: "inherited-token",
        T3CODE_ANDROID_GOOGLE_SERVICES_FILE: "/inherited/google-services.json",
      };
      for (const [key, value] of Object.entries(inherited)) vi.stubEnv(key, value);
      env.values = inherited;
      const { default: config } = await import("./app.config");
      expect(config.updates?.enabled).toBe(false);
      expect(config.updates?.checkAutomatically).toBe("NEVER");
      expect(config.updates?.url).toBeUndefined();
      expect(config.owner).toBeUndefined();
      expect(config.extra?.eas).toBeUndefined();
      expect(config.extra?.clerk).toBeUndefined();
      expect(config.extra?.relay).toBeUndefined();
      expect(config.extra?.observability).toBeUndefined();
      expect(config.ios?.appleTeamId).toBeUndefined();
      expect(config.ios?.associatedDomains).toBeUndefined();
      expect(config.android?.googleServicesFile).toBeUndefined();
      expect(
        config.plugins?.some(
          (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "@clerk/expo",
        ),
      ).toBe(false);
      expect(config.ios?.bundleIdentifier).toBe(id);
      expect(config.android?.package).toBe(id);
      expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
        `$(AppIdentifierPrefix)${id}`,
      ]);
      expect(config.scheme).toBe(scheme);
    },
  );

  it("isolates a personal-team build's keychain and extensions", async () => {
    env.values = {
      APP_VARIANT: "development",
      T3CODE_IOS_PERSONAL_TEAM: "1",
      T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID: "com.example.weavra.personal",
    };
    for (const [key, value] of Object.entries(env.values)) vi.stubEnv(key, value);
    const { default: config } = await import("./app.config");
    expect(config.ios?.bundleIdentifier).toBe("com.example.weavra.personal");
    expect(config.ios?.entitlements?.["keychain-access-groups"]).toEqual([
      "$(AppIdentifierPrefix)com.example.weavra.personal",
    ]);
    expect(
      config.plugins?.some(
        (plugin) => (Array.isArray(plugin) ? plugin[0] : plugin) === "expo-widgets",
      ),
    ).toBe(false);
  });
});
