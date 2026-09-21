import * as Effect from "effect/Effect";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  CLOUD_ENDPOINT_RUNTIME_CONFIG,
  CLOUD_LINKED_USER_ID,
  CLOUD_MINT_PUBLIC_KEY,
  PUBLISH_AGENT_ACTIVITY_SECRET,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "./config.ts";

const CLOUD_CLI_DESIRED_LINK_SECRET = "cloud-cli-desired-link";

export const clearPersistedCloudLink = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  yield* Effect.all(
    [
      secrets.remove(CLOUD_CLI_DESIRED_LINK_SECRET),
      secrets.remove("cloud-cli-oauth-token"),
      secrets.remove(CLOUD_LINKED_USER_ID),
      secrets.remove(RELAY_URL_SECRET),
      secrets.remove(RELAY_ISSUER_SECRET),
      secrets.remove(RELAY_ENVIRONMENT_CREDENTIAL_SECRET),
      secrets.remove(CLOUD_MINT_PUBLIC_KEY),
      secrets.remove(CLOUD_ENDPOINT_RUNTIME_CONFIG),
      secrets.remove(PUBLISH_AGENT_ACTIVITY_SECRET),
    ],
    { concurrency: "unbounded" },
  );
});
