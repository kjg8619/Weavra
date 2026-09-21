#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

class PublicationUnavailableError extends Schema.TaggedError<PublicationUnavailableError>()(
  "PublicationUnavailableError",
  {},
) {
  override get message(): string {
    return "Weavra publication is unavailable: no independent release infrastructure is configured. Build and inspect local artifacts instead; this command does not publish, announce, tag, push, or modify the checkout.";
  }
}

NodeRuntime.runMain(Effect.fail(new PublicationUnavailableError()));
