import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";

export const CLOUD_UNAVAILABLE_REASON =
  "Hosted Weavra accounts, relay links and cloud services are unavailable. Use a local server, direct pairing, SSH or Tailscale.";

export const hasCloudPublicConfig = false;

function unavailableConfig<A>(): Config.Config<A> {
  return Config.succeed(undefined).pipe(
    Config.mapEffect(() =>
      Effect.fail(
        new Config.ConfigError(
          new Schema.SchemaError(
            new SchemaIssue.InvalidValue({ message: CLOUD_UNAVAILABLE_REASON }),
          ),
        ),
      ),
    ),
  );
}

export const relayUrlConfig = unavailableConfig<string>();
export function resolveRelayClientTracingConfig(): {
  readonly tracesUrl: string;
  readonly tracesDataset: string;
  readonly tracesToken: string;
} | null {
  return null;
}
