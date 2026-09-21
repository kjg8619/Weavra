import { assert, it } from "@effect/vitest";
import { formatCliCommand } from "./invocation.ts";

it("suggests a local executable rather than a package installer", () => {
  assert.equal(formatCliCommand("arbitrary-command"), "weavra-server arbitrary-command");
});
