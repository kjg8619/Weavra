import { type DesktopBridge } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { afterEach, beforeEach, vi } from "vite-plus/test";
import { remoteHttpClientLayer } from "@t3tools/client-runtime/rpc";
import { __resetDesktopPrimaryAuthForTests } from "../environments/primary/desktopAuth";

import {
  linkPrimaryEnvironmentToCloud,
  readPrimaryCloudLinkState,
  type CloudLinkTarget,
  unlinkPrimaryEnvironmentFromCloud,
  updatePrimaryCloudPreferences,
} from "./linkEnvironment";

const TARGET: CloudLinkTarget = {
  environmentId: "environment-1",
  label: "Desktop",
  httpBaseUrl: "http://127.0.0.1:3000",
  wsBaseUrl: "ws://127.0.0.1:3000",
};
const decodePreferences = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ publishAgentActivity: Schema.Boolean })),
);

beforeEach(() => {
  vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.t3.codes");
});

afterEach(() => {
  __resetDesktopPrimaryAuthForTests();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("web cloud link environment client", () => {
  it.effect("reads saved link metadata only from the explicit local target", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          linked: true,
          cloudUserId: "user-1",
          relayUrl: "https://relay.t3.codes",
          relayIssuer: "https://relay.t3.codes",
          managedTunnelActive: true,
          publishAgentActivity: false,
        }),
      );
      const state = yield* readPrimaryCloudLinkState({ target: TARGET }).pipe(
        Effect.provide(remoteHttpClientLayer(fetchMock)),
      );
      expect(state?.relayUrl).toBe("https://relay.t3.codes");
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        "http://127.0.0.1:3000/api/connect/link-state",
      ]);
    }),
  );

  it.effect("uses desktop bearer auth rather than browser cookies for the local target", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          linked: false,
          cloudUserId: null,
          relayUrl: null,
          relayIssuer: null,
          managedTunnelActive: false,
          publishAgentActivity: false,
        }),
      );
      vi.stubGlobal("window", {
        location: { origin: "weavra://app" },
        desktopBridge: {
          getLocalEnvironmentBearerToken: vi.fn().mockResolvedValue("desktop-bearer-token"),
        } satisfies Pick<DesktopBridge, "getLocalEnvironmentBearerToken">,
      });
      yield* readPrimaryCloudLinkState({ target: TARGET }).pipe(
        Effect.provide(remoteHttpClientLayer(fetchMock)),
      );
      const request = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      expect(request.credentials).not.toBe("include");
      expect(request.headers.get("authorization")).toBe("Bearer desktop-bearer-token");
    }),
  );

  it.effect("writes publishing preferences only to the explicit local target", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn().mockResolvedValue(
        Response.json({
          linked: true,
          cloudUserId: "user-1",
          relayUrl: "https://relay.t3.codes",
          relayIssuer: "https://relay.t3.codes",
          managedTunnelActive: true,
          publishAgentActivity: true,
        }),
      );
      yield* updatePrimaryCloudPreferences({ target: TARGET, publishAgentActivity: true }).pipe(
        Effect.provide(remoteHttpClientLayer(fetchMock)),
      );
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        "http://127.0.0.1:3000/api/connect/preferences",
      ]);
      expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("POST");
      const body = fetchMock.mock.calls[0]?.[1]?.body;
      expect(
        decodePreferences(
          body instanceof Uint8Array ? new TextDecoder().decode(body) : String(body ?? ""),
        ),
      ).toEqual({ publishAgentActivity: true });
    }),
  );

  it.effect("refuses hosted linking despite saved credentials and legacy configuration", () =>
    Effect.gen(function* () {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      const error = yield* linkPrimaryEnvironmentToCloud({
        target: TARGET,
        clerkToken: "legacy-clerk-token",
        mode: "publish_only",
      }).pipe(Effect.flip);
      expect(error._tag).toBe("CloudEnvironmentLinkError");
      expect(fetchMock).not.toHaveBeenCalled();
    }),
  );

  it.effect("unlinks locally without reusing credentials to contact the inherited relay", () =>
    Effect.gen(function* () {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ ok: true, endpointRuntimeStatus: { status: "disabled" } }),
        );
      yield* unlinkPrimaryEnvironmentFromCloud({
        target: TARGET,
        clerkToken: "legacy-clerk-token",
      }).pipe(Effect.provide(remoteHttpClientLayer(fetchMock)));
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([
        "http://127.0.0.1:3000/api/connect/unlink",
      ]);
      const request = new Request(fetchMock.mock.calls[0]?.[0], fetchMock.mock.calls[0]?.[1]);
      expect([...request.headers.values()].join("\n")).not.toContain("legacy-clerk-token");
    }),
  );
});
