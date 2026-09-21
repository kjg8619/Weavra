import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { resolveCliCommand } from "./invocation.ts";

it.effect(
  "recommends only the installed compatibility binary, never an upstream package runner",
  () =>
    Effect.gen(function* () {
      assert.equal(yield* resolveCliCommand("serve"), "t3 serve");
      assert.equal(yield* resolveCliCommand("connect"), "t3 connect");
    }),
);
