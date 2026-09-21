import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type * as Scope from "effect/Scope";
import * as Electron from "electron";
import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";

// Keep the internal service identifier; no Clerk tenant or SDK is initialized.
export class DesktopClerk extends Context.Service<
  DesktopClerk,
  {
    readonly configure: Effect.Effect<
      void,
      never,
      ElectronApp.ElectronApp | ElectronWindow.ElectronWindow | Scope.Scope
    >;
  }
>()("@t3tools/desktop/app/DesktopClerk") {}

const make = Effect.gen(function* () {
  const electronApp = yield* ElectronApp.ElectronApp;
  const userDataPath = yield* DesktopAppIdentity.resolveUserDataPath;
  // The lock creates userData, so establish the independent profile first.
  yield* electronApp.setPath("userData", userDataPath);
  const isPrimary = yield* Effect.acquireRelease(
    Effect.sync(() => Electron.app.requestSingleInstanceLock()),
    (acquired) =>
      Effect.sync(() => {
        if (acquired) Electron.app.releaseSingleInstanceLock();
      }),
  );
  return DesktopClerk.of({
    configure: Effect.gen(function* () {
      const app = yield* ElectronApp.ElectronApp;
      if (!isPrimary) {
        yield* app.quit;
        return yield* Effect.interrupt;
      }
      const window = yield* ElectronWindow.ElectronWindow;
      const context = yield* Effect.context<never>();
      const runPromise = Effect.runPromiseWith(context);
      yield* app.on("second-instance", () => {
        void runPromise(
          Effect.gen(function* () {
            const current = yield* window.currentMainOrFirst;
            if (Option.isSome(current)) yield* window.reveal(current.value);
          }),
        );
      });
    }),
  });
});

export const layer = Layer.effect(DesktopClerk, make);
