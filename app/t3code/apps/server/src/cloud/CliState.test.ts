import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { ServerConfig } from "../config.ts";
import * as CliState from "./CliState.ts";
import {
  CLOUD_ENDPOINT_RUNTIME_CONFIG,
  CLOUD_LINKED_USER_ID,
  CLOUD_MINT_PUBLIC_KEY,
  PUBLISH_AGENT_ACTIVITY_SECRET,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "./config.ts";

const persistedCloudLinkSecrets = [
  "cloud-cli-desired-link",
  "cloud-cli-oauth-token",
  CLOUD_LINKED_USER_ID,
  RELAY_URL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  CLOUD_MINT_PUBLIC_KEY,
  CLOUD_ENDPOINT_RUNTIME_CONFIG,
  PUBLISH_AGENT_ACTIVITY_SECRET,
] as const;

const makeTestLayer = () =>
  ServerSecretStore.layer.pipe(
    Layer.provide(
      ServerConfig.layerTest(process.cwd(), {
        prefix: "t3-cloud-cli-state-test-",
      }),
    ),
  );

it.layer(NodeServices.layer)("CliState", (it) => {
  it.effect("clears owned hosted credentials without deleting unrelated local secrets", () =>
    Effect.gen(function* () {
      const secrets = yield* ServerSecretStore.ServerSecretStore;
      yield* secrets.set("local-environment-secret", new TextEncoder().encode("local-value"));

      for (const name of persistedCloudLinkSecrets) {
        yield* secrets.set(name, new TextEncoder().encode(name));
      }
      yield* CliState.clearPersistedCloudLink;

      const retained = yield* secrets.get("local-environment-secret");
      assert.isTrue(Option.isSome(retained));
      assert.deepEqual(Option.getOrThrow(retained), new TextEncoder().encode("local-value"));
      for (const name of persistedCloudLinkSecrets) {
        assert.isTrue(Option.isNone(yield* secrets.get(name)));
      }
    }).pipe(Effect.provide(makeTestLayer())),
  );
});
