import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveDesktopPairingUrl } from "./pairingUrls";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("direct pairing URLs", () => {
  it("keeps LAN pairing on the selected server with credentials in the fragment", () => {
    expect(resolveDesktopPairingUrl("http://192.168.1.44:3773", "PAIRCODE")).toBe(
      "http://192.168.1.44:3773/pair#token=PAIRCODE",
    );
  });
  it("does not send HTTPS or Tailscale pairing credentials to a legacy hosted origin", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.t3.codes");
    const url = new URL(
      resolveDesktopPairingUrl("https://host.tailnet.example.ts.net:3773", "private-token"),
    );
    expect(url.origin).toBe("https://host.tailnet.example.ts.net:3773");
    expect(url.pathname).toBe("/pair");
    expect(url.search).toBe("");
    expect(url.hash).toBe("#token=private-token");
  });
});
