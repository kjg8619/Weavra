import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  buildConnectCliClerkAuthorizeUrl,
  connectCliAuthRoutesEnabled,
  connectCliSignInRedirectUrl,
  hasConnectCliAuthConfig,
} from "./connectCliAuth";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("disabled hosted CLI authorization", () => {
  it("does not create an OAuth redirect from legacy complete configuration", () => {
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_live_${btoa("clerk.t3.codes$")}`);
    vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "t3-relay");
    vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.t3.codes");
    vi.stubEnv("VITE_CLERK_CLI_OAUTH_CLIENT_ID", "inherited-client");
    vi.stubEnv("VITE_HOSTED_APP_CHANNEL", "nightly");
    const request = { state: "state", challenge: "challenge", loopbackPort: 34338 };
    const currentHref = "http://localhost:3773/connect#state=state&challenge=challenge&port=34338";
    expect(hasConnectCliAuthConfig()).toBe(false);
    expect(connectCliAuthRoutesEnabled()).toBe(false);
    expect(buildConnectCliClerkAuthorizeUrl(request)).toBeNull();
    expect(connectCliSignInRedirectUrl(request, currentHref)).toBe(currentHref);
  });
});
