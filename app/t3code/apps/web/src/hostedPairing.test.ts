import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  hasHostedPairingRequest,
  isHostedStaticApp,
  readHostedPairingRequest,
} from "./hostedPairing";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("direct pairing without a hosted deployment", () => {
  it("does not let inherited deployment flags bypass local authentication", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.t3.codes");
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");
    vi.stubEnv("VITE_HTTP_URL", "");
    vi.stubEnv("VITE_WS_URL", "");
    expect(isHostedStaticApp(new URL("https://app.t3.codes/"))).toBe(false);
    expect(isHostedStaticApp(new URL("https://nightly.app.t3.codes/"))).toBe(false);
    expect(isHostedStaticApp(new URL("http://localhost:3773/"))).toBe(false);
  });
  it("keeps explicitly supplied direct pairing credentials and prefers the fragment", () => {
    const url = new URL(
      "http://localhost:3773/pair?host=https%3A%2F%2Fhost.example.test&token=query&label=Work#token=fragment",
    );
    expect(readHostedPairingRequest(url)).toEqual({
      host: "https://host.example.test",
      token: "fragment",
      label: "Work",
    });
    expect(
      hasHostedPairingRequest(new URL("http://localhost:3773/pair?host=host.example.test")),
    ).toBe(false);
    expect(hasHostedPairingRequest(new URL("http://localhost:3773/pair#token=fragment"))).toBe(
      false,
    );
  });
});
