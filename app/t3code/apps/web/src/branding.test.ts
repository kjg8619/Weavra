import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { WEAVRA_PRODUCT_NAME, WEAVRA_PRODUCT_VERSION } from "@t3tools/shared/product";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("product and build identity isolation", () => {
  it("does not take product identity from an inherited desktop bridge or hosted channel", async () => {
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");
    vi.stubEnv("APP_VERSION", "0.0.42-nightly.20260921.7");
    vi.stubGlobal("window", {
      desktopBridge: {
        getAppBranding: () => ({
          baseName: "T3 Code",
          stageLabel: "Alpha",
          displayName: "T3 Code (Alpha)",
        }),
      },
    });
    const branding = await import("./branding");
    expect(branding.APP_DISPLAY_NAME).toBe(WEAVRA_PRODUCT_NAME);
    expect(branding.APP_VERSION).toBe("0.0.42-nightly.20260921.7");
    expect(branding.APP_VERSION).not.toBe(WEAVRA_PRODUCT_VERSION);
  });
});
