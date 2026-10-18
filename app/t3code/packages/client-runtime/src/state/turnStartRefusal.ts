import {
  OrchestrationThreadActivity,
  decodeWorkspaceTurnStartRefusalPayload,
  makeWorkspaceTurnStartRefusalIdentity,
  type ScopedThreadRef,
  type WorkspaceTurnStartRefusalPayload,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const decodeActivity = Schema.decodeUnknownOption(OrchestrationThreadActivity, {
  onExcessProperty: "error",
});

// Both scopes come from enclosing client state/connection, never the payload.
// A decoded refusal reports a persisted denial; it grants no execution permission.
export function decodeTurnStartRefusal(
  expectedScope: ScopedThreadRef,
  sourceScope: ScopedThreadRef,
  activity: unknown,
): WorkspaceTurnStartRefusalPayload | null {
  if (
    expectedScope.environmentId !== sourceScope.environmentId ||
    expectedScope.threadId !== sourceScope.threadId
  ) {
    return null;
  }
  const decodedActivity = decodeActivity(activity);
  if (Option.isNone(decodedActivity)) return null;
  const value = decodedActivity.value;
  if (
    value.kind !== "provider.turn.start.failed" ||
    value.tone !== "error" ||
    value.turnId !== null
  ) {
    return null;
  }
  const refusal = decodeWorkspaceTurnStartRefusalPayload(value.payload);
  if (Option.isNone(refusal)) return null;
  const identity = makeWorkspaceTurnStartRefusalIdentity(
    expectedScope.threadId,
    refusal.value.requestId,
  );
  return value.id === identity.activityId ? refusal.value : null;
}
