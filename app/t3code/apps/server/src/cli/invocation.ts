import * as Effect from "effect/Effect";

/** `t3` is the locally installed Weavra compatibility binary, never an npm install instruction. */
export const resolveCliCommand = (subcommand: string) => Effect.succeed(`t3 ${subcommand}`);
