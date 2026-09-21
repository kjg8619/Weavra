import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { vi } from "vite-plus/test";
import { APP_UPDATE_UNAVAILABLE_REASON } from "@t3tools/shared/cliRelease";

const { transport } = vi.hoisted(() => ({
  transport: {
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    setFeedURL: vi.fn(),
  },
}));
vi.mock("electron-updater", () => ({ autoUpdater: transport }));
import * as ElectronUpdater from "./ElectronUpdater.ts";

it.effect(
  "rejects vendor checks, downloads and cached installs before the Electron transport",
  () =>
    Effect.gen(function* () {
      const updater = yield* ElectronUpdater.ElectronUpdater;
      yield* updater.setFeedURL({ provider: "github", owner: "pingdotgg", repo: "t3code" });
      const check = yield* Effect.flip(updater.checkForUpdates);
      const download = yield* Effect.flip(updater.downloadUpdate);
      const install = yield* Effect.flip(
        updater.quitAndInstall({ isSilent: true, isForceRunAfter: true }),
      );
      assert.equal(check.cause, APP_UPDATE_UNAVAILABLE_REASON);
      assert.equal(download.cause, APP_UPDATE_UNAVAILABLE_REASON);
      assert.equal(install.cause, APP_UPDATE_UNAVAILABLE_REASON);
      assert.equal(transport.checkForUpdates.mock.calls.length, 0);
      assert.equal(transport.downloadUpdate.mock.calls.length, 0);
      assert.equal(transport.quitAndInstall.mock.calls.length, 0);
    }).pipe(Effect.provide(ElectronUpdater.layer)),
);
