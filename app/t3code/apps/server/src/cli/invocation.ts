import * as Effect from "effect/Effect";

/** No public npm distribution is assumed for this source product. */
export function formatCliCommand(subcommand: string): string {
  return `weavra-server ${subcommand}`;
}

export const resolveCliCommand = (subcommand: string) =>
  Effect.succeed(formatCliCommand(subcommand));
