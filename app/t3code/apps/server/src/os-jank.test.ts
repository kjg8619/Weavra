import * as NodeOS from "node:os";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import { assert, it } from "@effect/vitest";

import { hydratePosixHome, resolveBaseDir } from "./os-jank.ts";

it("hydrates HOME for minimal service environments from the user account", () => {
  const env: NodeJS.ProcessEnv = {};

  hydratePosixHome(env);

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("hydrates HOME independently of a blank process HOME", () => {
  const originalHome = process.env.HOME;
  const env: NodeJS.ProcessEnv = { HOME: " " };

  try {
    process.env.HOME = " ";
    hydratePosixHome(env);
  } finally {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
  }

  assert.equal(env.HOME, NodeOS.userInfo().homedir);
});

it("preserves an explicitly configured HOME", () => {
  const env: NodeJS.ProcessEnv = { HOME: "/custom/home" };

  hydratePosixHome(env, () => {
    throw new Error("HOME lookup should not run");
  });

  assert.equal(env.HOME, "/custom/home");
});

it.effect("isolates default app state while preserving explicit homes and raw precedence", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const cases: ReadonlyArray<{
      env: Record<string, string>;
      raw?: string;
      expected: string;
    }> = [
      { env: {}, expected: path.join(NodeOS.homedir(), ".weavra", "app") },
      { env: { WEAVRA_HOME: "/product" }, expected: path.resolve("/product/app") },
      {
        env: { WEAVRA_APP_HOME: "/canonical", T3CODE_HOME: "/legacy" },
        expected: path.resolve("/canonical"),
      },
      {
        env: { WEAVRA_APP_HOME: "/canonical", T3CODE_HOME: "/legacy" },
        raw: "/explicit",
        expected: path.resolve("/explicit"),
      },
      { env: { T3CODE_HOME: "/legacy" }, expected: path.resolve("/legacy") },
    ];
    for (const { env, raw, expected } of cases) {
      const actual = yield* resolveBaseDir(raw).pipe(
        Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
      );
      assert.equal(actual, expected);
    }
  }).pipe(Effect.provide(NodeServices.layer)),
);
