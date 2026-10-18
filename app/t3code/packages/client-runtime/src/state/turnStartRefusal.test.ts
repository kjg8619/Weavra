import {
  CommandId,
  EnvironmentId,
  EventId,
  MessageId,
  ThreadId,
  TurnId,
  makeWorkspaceTurnAdmissionClaimIdentity,
  makeWorkspaceTurnStartRefusalIdentity,
  type OrchestrationThreadActivity,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { decodeTurnStartRefusal } from "./turnStartRefusal.ts";

const scope: ScopedThreadRef = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const requestId = MessageId.make("message-1");
const payload = {
  version: 1,
  source: "workspace-ownership",
  requestId,
  reason: "owned",
  originCommandId: CommandId.make("original-command"),
  originSequence: 7,
} as const;

function makeActivity(
  overrides: Partial<OrchestrationThreadActivity> = {},
): OrchestrationThreadActivity {
  return {
    id: makeWorkspaceTurnStartRefusalIdentity(scope.threadId, requestId).activityId,
    tone: "error",
    kind: "provider.turn.start.failed",
    summary: "Turn was not started",
    payload,
    turnId: null,
    sequence: 9,
    createdAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

describe("decodeTurnStartRefusal", () => {
  it("returns only bounded refusal fields from a matching enclosing scope", () => {
    expect(decodeTurnStartRefusal(scope, { ...scope }, makeActivity())).toEqual(payload);
    expect(
      decodeTurnStartRefusal(
        scope,
        scope,
        makeActivity({ summary: "Untrusted display text", sequence: 20 }),
      ),
    ).toEqual(payload);
  });

  it("rejects a foreign environment even with the same thread, message and activity id", () => {
    const foreignScope = {
      ...scope,
      environmentId: EnvironmentId.make("environment-2"),
    };
    expect(decodeTurnStartRefusal(scope, foreignScope, makeActivity())).toBeNull();
    expect(decodeTurnStartRefusal(foreignScope, scope, makeActivity())).toBeNull();
  });

  it("rejects a foreign enclosing thread even when its payload matches", () => {
    const foreignScope = { ...scope, threadId: ThreadId.make("thread-2") };
    expect(decodeTurnStartRefusal(scope, foreignScope, makeActivity())).toBeNull();
    expect(decodeTurnStartRefusal(foreignScope, scope, makeActivity())).toBeNull();
    const foreignActivity = makeActivity({
      id: makeWorkspaceTurnStartRefusalIdentity(foreignScope.threadId, requestId).activityId,
    });
    expect(decodeTurnStartRefusal(scope, scope, foreignActivity)).toBeNull();
    expect(decodeTurnStartRefusal(foreignScope, foreignScope, foreignActivity)).toEqual(payload);
  });

  it("rejects wrong, foreign-message and cross-kind activity ids", () => {
    for (const id of [
      EventId.make("arbitrary-id"),
      makeWorkspaceTurnStartRefusalIdentity(scope.threadId, MessageId.make("message-2")).activityId,
      makeWorkspaceTurnAdmissionClaimIdentity(scope.threadId, requestId, { kind: "initial" })
        .activityId,
    ]) {
      expect(decodeTurnStartRefusal(scope, scope, makeActivity({ id }))).toBeNull();
    }
    expect(
      decodeTurnStartRefusal(
        scope,
        scope,
        makeActivity({ payload: { ...payload, requestId: MessageId.make("message-2") } }),
      ),
    ).toBeNull();
  });

  it("rejects unrelated kinds, tones and post-start turn identities", () => {
    for (const activity of [
      makeActivity({ kind: "provider.turn.failed" }),
      makeActivity({ kind: "provider.turn.admission.claimed" }),
      makeActivity({ kind: "provider.turn.compaction.continuation" }),
      makeActivity({ tone: "info" }),
      makeActivity({ tone: "approval" }),
      makeActivity({ turnId: TurnId.make("started-turn") }),
    ]) {
      expect(decodeTurnStartRefusal(scope, scope, activity)).toBeNull();
    }
  });

  it("rejects malformed activities instead of treating them as authority", () => {
    for (const activity of [
      null,
      [],
      "failed",
      {},
      { ...makeActivity(), id: "" },
      { ...makeActivity(), turnId: undefined },
      { ...makeActivity(), payload: undefined },
      { ...makeActivity(), sequence: -1 },
      { ...makeActivity(), environmentId: scope.environmentId },
      ...Object.keys(makeActivity())
        .filter((key) => key !== "sequence")
        .map((missing) =>
          Object.fromEntries(Object.entries(makeActivity()).filter(([key]) => key !== missing)),
        ),
    ]) {
      expect(decodeTurnStartRefusal(scope, scope, activity)).toBeNull();
    }
  });

  it("rejects malformed, excess, foreign-scope and cross-kind payload fields", () => {
    for (const invalid of [
      null,
      [],
      {},
      { ...payload, version: 2 },
      { ...payload, source: "provider" },
      { ...payload, source: "workspace-admission" },
      { ...payload, reason: "unknown" },
      { ...payload, requestId: "" },
      { ...payload, originCommandId: "" },
      { ...payload, originSequence: -1 },
      { ...payload, originSequence: 1.5 },
      { ...payload, originSequence: "7" },
      { ...payload, detail: "private detail" },
      { ...payload, cwd: "/private/workspace" },
      { ...payload, cause: {} },
      { ...payload, taskId: "foreign-task" },
      { ...payload, environmentId: "environment-2" },
      { ...payload, threadId: "thread-2" },
      { ...payload, attempt: { kind: "initial" } },
      { ...payload, parentClaimId: "claim-1" },
      ...Object.keys(payload).map((missing) =>
        Object.fromEntries(Object.entries(payload).filter(([key]) => key !== missing)),
      ),
    ]) {
      expect(decodeTurnStartRefusal(scope, scope, makeActivity({ payload: invalid }))).toBeNull();
    }
  });

  it("does not cross-match delimiter-like thread and message identifiers", () => {
    const firstScope = { ...scope, threadId: ThreadId.make("a:b") };
    const secondScope = { ...scope, threadId: ThreadId.make("a") };
    const firstMessageId = MessageId.make("c");
    const secondMessageId = MessageId.make("b:c");
    const activity = makeActivity({
      id: makeWorkspaceTurnStartRefusalIdentity(firstScope.threadId, firstMessageId).activityId,
      payload: { ...payload, requestId: firstMessageId },
    });
    expect(decodeTurnStartRefusal(firstScope, firstScope, activity)).toEqual({
      ...payload,
      requestId: firstMessageId,
    });
    expect(
      decodeTurnStartRefusal(secondScope, secondScope, {
        ...activity,
        payload: { ...payload, requestId: secondMessageId },
      }),
    ).toBeNull();
  });

  it("preserves original correlation across duplicate delivery and new envelope sequences", () => {
    const activity = makeActivity();
    const duplicate = { ...activity, sequence: 100, createdAt: "2026-10-03T00:01:00.000Z" };
    expect(decodeTurnStartRefusal(scope, scope, activity)).toEqual(payload);
    expect(decodeTurnStartRefusal(scope, scope, duplicate)).toEqual(payload);
    expect(decodeTurnStartRefusal(scope, scope, activity)).toEqual(
      decodeTurnStartRefusal(scope, scope, duplicate),
    );
  });
});
