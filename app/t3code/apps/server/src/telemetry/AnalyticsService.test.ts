import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { HttpClient } from "effect/unstable/http";
import { make } from "./AnalyticsService.ts";

it.effect("keeps product events local even when inherited analytics flags are enabled", () => {
  let requests = 0;
  const http = HttpClient.make(() => {
    requests += 1;
    return Effect.die("Unexpected analytics request");
  });
  return Effect.gen(function* () {
    const analytics = yield* make;
    yield* analytics.record("server.boot.heartbeat", { mode: "web" });
    yield* analytics.record("client.connected");
    yield* analytics.flush;
    assert.strictEqual(requests, 0);
  }).pipe(
    Effect.provideService(HttpClient.HttpClient, http),
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            T3CODE_TELEMETRY_ENABLED: "true",
            T3CODE_POSTHOG_KEY: "old-project-key",
            T3CODE_POSTHOG_HOST: "https://analytics.example.invalid",
          },
        }),
      ),
    ),
  );
});
