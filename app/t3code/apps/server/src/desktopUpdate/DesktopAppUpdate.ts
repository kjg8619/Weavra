import {
  ServerSelfUpdateError,
  type ServerSelfUpdateProgressStage,
  type ServerSelfUpdateResult,
} from "@t3tools/contracts";
import { CLI_DISTRIBUTION_UNAVAILABLE_REASON } from "@t3tools/shared/cliRelease";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export class DesktopAppUpdate extends Context.Service<
  DesktopAppUpdate,
  {
    readonly available: boolean;
    readonly run: (
      reportProgress: (
        stage: ServerSelfUpdateProgressStage,
      ) => Effect.Effect<void, ServerSelfUpdateError>,
    ) => Effect.Effect<ServerSelfUpdateResult, ServerSelfUpdateError>;
    readonly commit: (
      requestId: string,
      onHandoffAccepted?: () => Effect.Effect<void>,
    ) => Effect.Effect<never, ServerSelfUpdateError>;
  }
>()("t3/desktopUpdate/DesktopAppUpdate") {}

export const make = Effect.fn("desktopUpdate.desktopAppUpdate.make")(() =>
  Effect.succeed(
    DesktopAppUpdate.of({
      available: false,
      run: () =>
        Effect.fail(new ServerSelfUpdateError({ reason: CLI_DISTRIBUTION_UNAVAILABLE_REASON })),
      commit: () =>
        Effect.fail(new ServerSelfUpdateError({ reason: CLI_DISTRIBUTION_UNAVAILABLE_REASON })),
    }),
  ),
);
export const layer = Layer.effect(DesktopAppUpdate, make());
