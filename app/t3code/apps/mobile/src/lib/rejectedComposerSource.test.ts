import { describe, expect, it } from "vite-plus/test";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ThreadId,
  makeWorkspaceTurnStartRefusalIdentity,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { selectRejectedComposerSource } from "./rejectedComposerSource";

const scope = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const messageId = MessageId.make("original");
const message: OrchestrationMessage = {
  id: messageId,
  role: "user",
  text: "  /original\n",
  turnId: null,
  streaming: false,
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
};
const refusal = {
  version: 1,
  source: "workspace-ownership",
  requestId: messageId,
  reason: "target-changed",
  originCommandId: CommandId.make("command"),
  originSequence: 8,
};
const activity: OrchestrationThreadActivity = {
  id: makeWorkspaceTurnStartRefusalIdentity(scope.threadId, messageId).activityId,
  kind: "provider.turn.start.failed",
  tone: "error",
  summary: "not authority",
  turnId: null,
  sequence: 9,
  createdAt: "2026-10-04T00:00:00.000Z",
  payload: refusal,
};
const source = { scope, synchronized: true, messages: [message], activities: [activity] };

describe("native rejected composer source", () => {
  it("selects the exact original message using correlated persisted refusal evidence", () => {
    const selected = selectRejectedComposerSource({ scope, messageId, source });
    expect(selected?.message).toBe(message);
    expect(selected?.refusal).toEqual(activity.payload);
    expect(selected?.environmentId).toBe(scope.environmentId);
    expect(selected?.threadId).toBe(scope.threadId);
  });

  it.each([
    "unsynchronized",
    "absent",
    "role",
    "environment",
    "thread",
    "identity",
    "request",
  ] as const)("returns no recovery source when %s evidence is invalid", (invalid) => {
    const changed = {
      ...source,
      synchronized: invalid !== "unsynchronized",
      scope: {
        environmentId:
          invalid === "environment" ? EnvironmentId.make("foreign") : scope.environmentId,
        threadId: invalid === "thread" ? ThreadId.make("foreign") : scope.threadId,
      },
      messages: invalid === "role" ? [{ ...message, role: "assistant" as const }] : [message],
      activities:
        invalid === "absent"
          ? []
          : [
              {
                ...activity,
                id:
                  invalid === "identity"
                    ? makeWorkspaceTurnStartRefusalIdentity(ThreadId.make("foreign"), messageId)
                        .activityId
                    : activity.id,
                payload:
                  invalid === "request"
                    ? { ...refusal, requestId: MessageId.make("foreign") }
                    : activity.payload,
              },
            ],
    };

    expect(selectRejectedComposerSource({ scope, messageId, source: changed })).toBeNull();
  });
});
