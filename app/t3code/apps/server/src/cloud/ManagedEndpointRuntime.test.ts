import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as RelayClient from "@t3tools/shared/relayClient";
import * as ChildProcessSpawner from "effect/unstable/process/ChildProcessSpawner";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";

describe("CloudManagedEndpointRuntime", () => {
  it("classifies Cloudflare connection and warning output", () => {
    expect(
      ManagedEndpointRuntime.classifyRelayClientOutput(
        "2026-06-17T02:00:00Z INF Registered tunnel connection connIndex=0",
      ),
    ).toBe("connected");
    expect(
      ManagedEndpointRuntime.classifyRelayClientOutput(
        "2026-06-17T02:00:00Z ERR Failed to serve tunnel connection",
      ),
    ).toBe("warning");
    expect(
      ManagedEndpointRuntime.classifyRelayClientOutput(
        "2026-06-17T02:00:00Z INF Starting metrics server",
      ),
    ).toBe("debug");
    // FTL (fatal) and PNC (panic) are more severe than ERR and must surface.
    expect(
      ManagedEndpointRuntime.classifyRelayClientOutput(
        "2026-06-17T02:00:00Z FTL Cannot determine default origin certificate path",
      ),
    ).toBe("warning");
    expect(
      ManagedEndpointRuntime.classifyRelayClientOutput("2026-06-17T02:00:00Z PNC runtime panic"),
    ).toBe("warning");
  });

  it.effect("ignores saved connector configuration before acquiring infrastructure", () =>
    Effect.gen(function* () {
      const runtime = yield* ManagedEndpointRuntime.make;
      expect(
        yield* runtime.applyConfig({
          providerKind: "cloudflare_tunnel",
          connectorToken: "saved-token",
          tunnelId: "saved-tunnel",
          tunnelName: "saved-name",
        }),
      ).toEqual({ status: "disabled" });
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.mergeAll(
          Layer.mock(RelayClient.RelayClient)({}),
          Layer.mock(ChildProcessSpawner.ChildProcessSpawner)({}),
          Layer.mock(ServerSecretStore.ServerSecretStore)({}),
        ),
      ),
    ),
  );
});
