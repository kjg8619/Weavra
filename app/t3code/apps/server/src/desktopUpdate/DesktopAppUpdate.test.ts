import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { APP_UPDATE_UNAVAILABLE_REASON } from "@t3tools/shared/cliRelease";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as ServerConfig from "../config.ts";
import * as DesktopTelemetryReceiver from "../resourceTelemetry/DesktopTelemetryReceiver.ts";
import * as DesktopAppUpdate from "./DesktopAppUpdate.ts";

it.layer(NodeServices.layer)("Weavra desktop update authority", (it) => {
  it.effect("refuses checks and commits even when a desktop control channel exists", () =>
    Effect.gen(function* () {
      const base = yield* ServerConfig.ServerConfig.pipe(
        Effect.provide(ServerConfig.layerTest(process.cwd(), { prefix: "weavra-update-" })),
      );
      const requests: string[] = [];
      const service = yield* DesktopAppUpdate.make().pipe(
        Effect.provide(
          Layer.mergeAll(
            ServerConfig.layer({ ...base, mode: "desktop", desktopTelemetryControlFd: 5 }),
            DesktopTelemetryReceiver.layerTest({
              requestDesktopUpdate: (id) => Effect.sync(() => void requests.push(id)),
              commitDesktopUpdate: (id) => Effect.sync(() => void requests.push(id)),
            }),
          ),
        ),
      );
      expect(service.available).toBe(false);
      expect((yield* Effect.flip(service.run(() => Effect.void))).reason).toBe(
        APP_UPDATE_UNAVAILABLE_REASON,
      );
      expect((yield* Effect.flip(service.commit("cached-vendor-update"))).reason).toBe(
        APP_UPDATE_UNAVAILABLE_REASON,
      );
      expect(requests).toEqual([]);
    }),
  );
});
