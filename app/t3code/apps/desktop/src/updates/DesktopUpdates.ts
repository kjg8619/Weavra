import type {
  DesktopUpdateState,
  DesktopUpdateChannel,
  DesktopUpdateCheckResult,
  DesktopUpdateActionResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import type * as Scope from "effect/Scope";
import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as IpcChannels from "../ipc/channels.ts";
import { createInitialDesktopUpdateState } from "./updateMachine.ts";

export const UNAVAILABLE_REASON =
  "Weavra updates are unavailable because no independent release service is configured.";
export type DesktopUpdateConfigureError = never;
export type DesktopUpdateSetChannelError = never;

export class DesktopUpdates extends Context.Service<
  DesktopUpdates,
  {
    readonly getState: Effect.Effect<DesktopUpdateState>;
    readonly isActionActive: Effect.Effect<boolean>;
    readonly isInstallActive: Effect.Effect<boolean>;
    readonly subscribe: Effect.Effect<
      { readonly latest: DesktopUpdateState; readonly changes: Stream.Stream<DesktopUpdateState> },
      never,
      Scope.Scope
    >;
    readonly emitState: Effect.Effect<void>;
    readonly disabledReason: Effect.Effect<Option.Option<string>>;
    readonly configure: Effect.Effect<void, DesktopUpdateConfigureError, Scope.Scope>;
    readonly setChannel: (
      channel: DesktopUpdateChannel,
    ) => Effect.Effect<DesktopUpdateState, DesktopUpdateSetChannelError>;
    readonly check: (reason: string) => Effect.Effect<DesktopUpdateCheckResult>;
    readonly download: Effect.Effect<DesktopUpdateActionResult>;
    readonly install: Effect.Effect<DesktopUpdateActionResult>;
    readonly installPrepared: (
      expectedVersion: string,
    ) => Effect.Effect<DesktopUpdateActionResult & { readonly failed: boolean }>;
  }
>()("@t3tools/desktop/updates/DesktopUpdates") {}

/** No feed, flags, cached download, or remote request grants release authority. */
const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const window = yield* ElectronWindow.ElectronWindow;
  const state: DesktopUpdateState = {
    ...createInitialDesktopUpdateState(
      environment.appVersion,
      environment.runtimeInfo,
      environment.defaultDesktopSettings.updateChannel,
    ),
    enabled: false,
    status: "disabled",
    message: UNAVAILABLE_REASON,
  };
  const emitState = window.sendAll(IpcChannels.UPDATE_STATE_CHANNEL, state);
  const refused = { accepted: false, completed: false, state };
  return DesktopUpdates.of({
    getState: Effect.succeed(state),
    isActionActive: Effect.succeed(false),
    isInstallActive: Effect.succeed(false),
    subscribe: Effect.succeed({ latest: state, changes: Stream.empty }),
    emitState,
    disabledReason: Effect.succeed(Option.some(UNAVAILABLE_REASON)),
    configure: emitState,
    setChannel: () => Effect.succeed(state),
    check: () => Effect.succeed({ checked: false, state }),
    download: Effect.succeed(refused),
    install: Effect.succeed(refused),
    installPrepared: () => Effect.succeed({ ...refused, failed: true }),
  });
});

export const layer = Layer.effect(DesktopUpdates, make);
