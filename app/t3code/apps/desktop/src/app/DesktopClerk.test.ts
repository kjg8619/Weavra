import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { beforeEach, vi } from "vite-plus/test";

const native = vi.hoisted(() => ({ request: vi.fn(), release: vi.fn() }));
vi.mock("electron", () => ({
  app: { requestSingleInstanceLock: native.request, releaseSingleInstanceLock: native.release },
}));
vi.mock("@clerk/electron", () => {
  throw new Error("inherited Clerk bridge must not initialize");
});
vi.mock("@clerk/electron/storage", () => {
  throw new Error("inherited auth storage must not initialize");
});

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronWindow from "../electron/ElectronWindow.ts";
import * as DesktopClerk from "./DesktopClerk.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

function harness(events: string[]) {
  const environment = {
    appDataDirectory: "/app-data",
    userDataDirName: "weavra-dev",
    path: { join: (...parts: string[]) => parts.join("/") },
  } as unknown as DesktopEnvironment.DesktopEnvironment["Service"];
  const app = {
    setPath: (name: string, value: string) =>
      Effect.sync(() => {
        events.push(`${name}:${value}`);
      }),
    quit: Effect.sync(() => {
      events.push("quit");
    }),
    on: (name: string) =>
      Effect.sync(() => {
        events.push(name);
      }),
  } as unknown as ElectronApp.ElectronApp["Service"];
  const dependencies = Layer.mergeAll(
    Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment),
    Layer.succeed(ElectronApp.ElectronApp, app),
    Layer.succeed(ElectronWindow.ElectronWindow, {} as ElectronWindow.ElectronWindow["Service"]),
  );
  return DesktopClerk.layer.pipe(Layer.provideMerge(dependencies));
}

describe("desktop single instance without hosted auth", () => {
  beforeEach(() => {
    native.request.mockReset();
    native.release.mockReset();
  });
  it.effect(
    "selects the independent profile before taking the lock and releases it with scope",
    () => {
      const events: string[] = [];
      native.request.mockImplementation(() => {
        events.push("lock");
        return true;
      });
      return Effect.gen(function* () {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const instance = yield* DesktopClerk.DesktopClerk;
            yield* instance.configure;
          }).pipe(Effect.provide(harness(events))),
        );
        assert.deepEqual(events, ["userData:/app-data/weavra-dev", "lock", "second-instance"]);
        assert.equal(native.release.mock.calls.length, 1);
      });
    },
  );
  it.effect("quits and interrupts secondary startup without releasing another process lock", () => {
    const events: string[] = [];
    native.request.mockReturnValue(false);
    return Effect.gen(function* () {
      const result = yield* Effect.exit(
        Effect.scoped(
          Effect.gen(function* () {
            const instance = yield* DesktopClerk.DesktopClerk;
            yield* instance.configure;
          }).pipe(Effect.provide(harness(events))),
        ),
      );
      assert.isTrue(Exit.hasInterrupts(result));
      assert.deepEqual(events, ["userData:/app-data/weavra-dev", "quit"]);
      assert.equal(native.release.mock.calls.length, 0);
    });
  });
});
