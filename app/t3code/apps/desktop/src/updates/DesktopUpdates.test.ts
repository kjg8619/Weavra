import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { vi } from "vite-plus/test";

// An accidentally restored transport import must fail before it can contact any feed.
vi.mock("electron-updater", () => {
  throw new Error("product updater transport is unavailable");
});

import * as DesktopUpdates from "./DesktopUpdates.ts";
import { makeHarness } from "./updatesTestHarness.ts";

describe("DesktopUpdates unavailable capability", () => {
  it.effect(
    "refuses startup, manual, channel, download, and prepared-install actions despite legacy flags",
    () => {
      const harness = makeHarness();
      return Effect.scoped(
        Effect.gen(function* () {
          const updates = yield* DesktopUpdates.DesktopUpdates;
          const initial = yield* updates.getState;
          assert.equal(initial.status, "disabled");
          assert.isFalse(initial.enabled);
          assert.equal(initial.currentVersion, "1.2.3");
          yield* updates.configure;
          yield* TestClock.adjust("10 minutes");
          const check = yield* updates.check("menu");
          assert.isFalse(check.checked);
          assert.equal(check.state.status, "disabled");
          const channel = yield* updates.setChannel("nightly");
          assert.isFalse(channel.enabled);
          assert.equal(channel.channel, initial.channel);
          for (const action of [
            updates.download,
            updates.install,
            updates.installPrepared("9.9.9"),
          ]) {
            const result = yield* action;
            assert.isFalse(result.accepted);
            assert.isFalse(result.completed);
            assert.equal(result.state.status, "disabled");
            assert.isNull(result.state.downloadedVersion);
            assert.isFalse(result.state.canRetry);
          }
          assert.deepEqual(
            yield* updates.disabledReason,
            Option.some(DesktopUpdates.UNAVAILABLE_REASON),
          );
          assert.isFalse(yield* updates.isActionActive);
          assert.isFalse(yield* updates.isInstallActive);
          assert.deepEqual(harness.sentStates, [initial]);
        }),
      ).pipe(Effect.provide(harness.layer.pipe(Layer.provideMerge(TestClock.layer()))));
    },
  );
});
