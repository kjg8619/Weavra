import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import {
  hasCloudPublicConfig,
  relayUrlConfig,
  resolveRelayClientTracingConfig,
} from "./publicConfig.ts";

it.effect("refuses hosted capabilities despite inherited tenant and tracing configuration", () =>
  Effect.gen(function* () {
    assert.isFalse(hasCloudPublicConfig);
    assert.equal((yield* relayUrlConfig.pipe(Effect.flip))._tag, "ConfigError");
    assert.isNull(resolveRelayClientTracingConfig());
  }).pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({
          env: {
            T3CODE_RELAY_URL: "https://relay.example.invalid",
            T3CODE_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS50ZXN0JA==",
            T3CODE_CLERK_CLI_OAUTH_CLIENT_ID: "inherited-client",
            T3CODE_HOSTED_APP_URL: "https://app.example.invalid",
            T3CODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://traces.example.invalid",
            T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "inherited-dataset",
            T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "inherited-token",
          },
        }),
      ),
    ),
  ),
);
