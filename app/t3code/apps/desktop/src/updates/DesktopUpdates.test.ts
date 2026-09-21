import { assert, it } from "@effect/vitest";
import { APP_UPDATE_UNAVAILABLE_REASON } from "@t3tools/shared/cliRelease";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as DesktopUpdates from "./DesktopUpdates.ts";
import { makeHarness } from "./updatesTestHarness.ts";

it.effect("keeps startup, polling, manual actions and channel changes unavailable", () => {
  const harness = makeHarness();
  return Effect.scoped(
    Effect.gen(function* () {
      const updates = yield* DesktopUpdates.DesktopUpdates;
      const initialState = yield* updates.getState;
      assert.isFalse(initialState.enabled);
      assert.equal(initialState.status, "disabled");
      yield* updates.configure;
      yield* TestClock.adjust(Duration.minutes(20));
      assert.equal(Option.getOrThrow(yield* updates.disabledReason), APP_UPDATE_UNAVAILABLE_REASON);
      assert.equal((yield* updates.check("manual")).checked, false);
      assert.equal((yield* updates.download).accepted, false);
      assert.equal((yield* updates.install).accepted, false);
      assert.equal((yield* updates.installPrepared("1.2.4")).accepted, false);
      const state = yield* updates.setChannel("nightly");
      assert.equal(state.enabled, false);
      assert.equal(state.status, "disabled");
      assert.equal(state.message, APP_UPDATE_UNAVAILABLE_REASON);
      assert.equal(harness.checkCount(), 0);
      assert.equal(harness.downloadCount(), 0);
      assert.equal(harness.quitAndInstalls(), 0);
    }),
  ).pipe(Effect.provide(Layer.merge(TestClock.layer(), harness.layer)));
});
