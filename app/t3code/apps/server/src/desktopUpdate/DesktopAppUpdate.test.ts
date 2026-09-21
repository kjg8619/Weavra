import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { make } from "./DesktopAppUpdate.ts";

it.effect("refuses desktop updates without progress or handoff", () =>
  Effect.gen(function* () {
    const service = yield* make();
    let callbacks = 0;
    const callback = () =>
      Effect.sync(() => {
        callbacks += 1;
      });
    assert.isFalse(service.available);
    assert.equal((yield* service.run(callback).pipe(Effect.flip))._tag, "ServerSelfUpdateError");
    assert.equal(
      (yield* service.commit("saved-token", callback).pipe(Effect.flip))._tag,
      "ServerSelfUpdateError",
    );
    assert.equal(callbacks, 0);
  }),
);
