import {
  AuthRelayReadScope,
  AuthRelayWriteScope,
  EnvironmentCloudEndpointUnavailableError,
  type EnvironmentCloudLinkStateResult,
  type EnvironmentCloudRelayConfigResult,
  EnvironmentHttpApi,
  EnvironmentHttpInternalServerError,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { requireEnvironmentScope } from "../auth/http.ts";
import * as ManagedEndpointRuntime from "./ManagedEndpointRuntime.ts";
import { clearPersistedCloudLink } from "./CliState.ts";
import {
  CLOUD_LINKED_USER_ID,
  PUBLISH_AGENT_ACTIVITY_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "./config.ts";
import { CLOUD_UNAVAILABLE_REASON } from "./publicConfig.ts";

const decoder = new TextDecoder();
const encoder = new TextEncoder();

interface CloudHttpDependencies {
  readonly secrets: ServerSecretStore.ServerSecretStore["Service"];
  readonly endpointRuntime: ManagedEndpointRuntime.CloudManagedEndpointRuntime["Service"];
}

const failEnvironmentCloudInternalError =
  (message: string) =>
  (cause: unknown): Effect.Effect<never, EnvironmentHttpInternalServerError> =>
    Effect.logError(message, { cause }).pipe(
      Effect.flatMap(() => Effect.fail(new EnvironmentHttpInternalServerError({ message }))),
    );

const readCloudLinkState = Effect.fn("environment.cloud.readLinkState")(function* (
  dependencies: CloudHttpDependencies,
) {
  const [cloudUserId, relayUrl, relayIssuer, publishAgentActivity] = yield* Effect.all(
    [
      dependencies.secrets.get(CLOUD_LINKED_USER_ID),
      dependencies.secrets.get(RELAY_URL_SECRET),
      dependencies.secrets.get(RELAY_ISSUER_SECRET),
      dependencies.secrets.get(PUBLISH_AGENT_ACTIVITY_SECRET),
    ],
    { concurrency: 4 },
  );
  return {
    // Saved metadata is not evidence of an active hosted connection. In particular,
    // a persisted connector credential must never imply a running tunnel.
    linked: Option.isSome(cloudUserId),
    cloudUserId: Option.isSome(cloudUserId) ? decoder.decode(cloudUserId.value) : null,
    relayUrl: Option.isSome(relayUrl) ? decoder.decode(relayUrl.value) : null,
    relayIssuer: Option.isSome(relayIssuer) ? decoder.decode(relayIssuer.value) : null,
    managedTunnelActive: false,
    publishAgentActivity: Option.isSome(publishAgentActivity)
      ? decoder.decode(publishAgentActivity.value) === "true"
      : false,
  } satisfies EnvironmentCloudLinkStateResult;
});

const cloudLinkStateHandler = Effect.fn("environment.cloud.linkState")(
  function* (dependencies: CloudHttpDependencies) {
    yield* requireEnvironmentScope(AuthRelayReadScope);
    return yield* readCloudLinkState(dependencies);
  },
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not read environment relay configuration."),
  ),
);

const cloudUnlinkHandler = Effect.fn("environment.cloud.unlink")(
  function* (dependencies: CloudHttpDependencies) {
    yield* requireEnvironmentScope(AuthRelayWriteScope);
    const endpointRuntimeStatus = yield* dependencies.endpointRuntime.applyConfig(null);
    yield* clearPersistedCloudLink;
    return { ok: true, endpointRuntimeStatus } satisfies EnvironmentCloudRelayConfigResult;
  },
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not remove environment relay configuration."),
  ),
);

const cloudPreferencesHandler = Effect.fn("environment.cloud.preferences")(
  function* (
    dependencies: CloudHttpDependencies,
    payload: { readonly publishAgentActivity: boolean },
  ) {
    yield* requireEnvironmentScope(AuthRelayWriteScope);
    yield* dependencies.secrets.set(
      PUBLISH_AGENT_ACTIVITY_SECRET,
      encoder.encode(String(payload.publishAgentActivity)),
    );
    return yield* readCloudLinkState(dependencies);
  },
  Effect.catchIf(
    ServerSecretStore.isSecretStoreError,
    failEnvironmentCloudInternalError("Could not persist environment cloud preferences."),
  ),
);

const unavailable = Effect.fail(
  new EnvironmentCloudEndpointUnavailableError({
    message: CLOUD_UNAVAILABLE_REASON,
    endpointRuntimeStatus: { status: "disabled" },
  }),
);
const unavailableRelayWrite = requireEnvironmentScope(AuthRelayWriteScope).pipe(
  Effect.andThen(unavailable),
);

export const connectHttpApiLayer = HttpApiBuilder.group(
  EnvironmentHttpApi,
  "connect",
  Effect.fnUntraced(function* (handlers) {
    const dependencies: CloudHttpDependencies = {
      secrets: yield* ServerSecretStore.ServerSecretStore,
      endpointRuntime: yield* ManagedEndpointRuntime.CloudManagedEndpointRuntime,
    };
    return handlers
      .handle("linkProof", () => unavailableRelayWrite)
      .handle("relayConfig", () => unavailableRelayWrite)
      .handle("linkState", () => cloudLinkStateHandler(dependencies))
      .handle("unlink", () => cloudUnlinkHandler(dependencies))
      .handle("preferences", ({ payload }) => cloudPreferencesHandler(dependencies, payload))
      .handle("health", () => unavailable)
      .handle("mintCredential", () => unavailable)
      .handle("t3MintCredential", () => unavailable);
  }),
);
