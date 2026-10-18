import { describe, expect, it } from "@effect/vitest";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { decodeQueuedThreadMessage } from "./thread-outbox-model";
import { decodeThreadOutboxRecord, encodeThreadOutboxRecord } from "./thread-outbox-record";

const identity = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
  messageId: MessageId.make("message-1"),
};
const transport = { ...identity, commandId: CommandId.make("command-1") };
const payload = {
  ...transport,
  text: "Original local content",
  attachments: [],
  createdAt: "2026-10-04T00:00:00.000Z",
};
const command = {
  type: "thread.turn.start",
  commandId: transport.commandId,
  threadId: transport.threadId,
  message: {
    messageId: transport.messageId,
    role: "user",
    text: "Prepared wire content",
    attachments: [],
  },
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: payload.createdAt,
};
const claimed = {
  schemaVersion: 6,
  kind: "message",
  storageIdentity: identity,
  transport,
  delivery: { state: "attempted" },
  message: { ...payload, text: "Newer local edit" },
  original: {
    kind: "claim",
    localSnapshot: payload,
    invocation: { environmentId: identity.environmentId, command },
  },
};

describe("durable outbox record codec", () => {
  it.each([1, 2, 3, 4])("migrates version %i as observed unknown, not a claim", (schemaVersion) => {
    const record = decodeThreadOutboxRecord({
      ...payload,
      schemaVersion,
      delivery: { state: "ready" },
    });
    expect(record.delivery).toEqual({ state: "unknown" });
    expect(record.original).toEqual({ kind: "legacy-observed", localSnapshot: payload });
    expect(decodeThreadOutboxRecord(encodeThreadOutboxRecord(record))).toEqual(record);
  });

  it.each(["ready", "attempted", "unknown"] as const)(
    "retains version5 %s authority without inventing a claim",
    (state) => {
      const record = decodeThreadOutboxRecord({
        ...payload,
        schemaVersion: 5,
        delivery: { state },
      });
      expect(record.delivery).toEqual({ state });
      expect(record.original).toEqual(
        state === "ready" ? undefined : { kind: "legacy-observed", localSnapshot: payload },
      );
    },
  );

  it("round-trips immutable local and wire content separately from newer edits", () => {
    const record = decodeThreadOutboxRecord(claimed);
    expect(decodeThreadOutboxRecord(encodeThreadOutboxRecord(record))).toEqual(claimed);
    expect(() => decodeQueuedThreadMessage(encodeThreadOutboxRecord(record))).toThrow();
  });

  it("preserves exact prepared values instead of applying wire normalization", () => {
    const exact = {
      ...claimed,
      original: {
        ...claimed.original,
        invocation: {
          ...claimed.original.invocation,
          command: { ...command, titleSeed: "  exact title  " },
        },
      },
    };
    expect(
      decodeThreadOutboxRecord(encodeThreadOutboxRecord(decodeThreadOutboxRecord(exact))),
    ).toEqual(exact);
  });

  it("retains a parked terminal marker without a visible payload", () => {
    const { message: _removed, ...rest } = claimed;
    const terminal = { ...rest, kind: "retired", reason: "acknowledged", archivedFor: "account-1" };
    expect(
      decodeThreadOutboxRecord(encodeThreadOutboxRecord(decodeThreadOutboxRecord(terminal))),
    ).toEqual(terminal);
  });

  it("keeps an observed baseline, newer edit and canonical refusal separately", () => {
    const refused = {
      ...claimed,
      original: { kind: "legacy-observed", localSnapshot: payload },
      delivery: {
        state: "refused",
        sourceMessage: {
          id: identity.messageId,
          role: "user",
          text: "Canonical source",
          attachments: [],
          turnId: null,
          streaming: false,
          createdAt: payload.createdAt,
          updatedAt: payload.createdAt,
        },
        refusal: {
          version: 1,
          source: "workspace-ownership",
          requestId: identity.messageId,
          reason: "owned",
          originCommandId: transport.commandId,
          originSequence: 1,
        },
      },
    };
    expect(
      decodeThreadOutboxRecord(encodeThreadOutboxRecord(decodeThreadOutboxRecord(refused))),
    ).toEqual(refused);
    for (const sourceMessage of [
      { ...refused.delivery.sourceMessage, role: "assistant" },
      { ...refused.delivery.sourceMessage, id: "other-message" },
    ]) {
      expect(() =>
        decodeThreadOutboxRecord({
          ...refused,
          delivery: { ...refused.delivery, sourceMessage },
        }),
      ).toThrow();
    }
  });

  it.each([
    { delivery: { state: "ready" } },
    { archivedFor: "account-a", ownerAccountId: "account-b" },
    { archivedFor: "account-a", ownerAccountId: null },
    { original: undefined },
    { transport: { ...transport, environmentId: EnvironmentId.make("foreign") } },
    { storageIdentity: { ...identity, messageId: MessageId.make("foreign") } },
    { original: { ...claimed.original, invocation: { environmentId: "foreign", command } } },
    {
      original: { ...claimed.original, invocation: { environmentId: " environment-1 ", command } },
    },
    {
      original: {
        ...claimed.original,
        invocation: {
          environmentId: identity.environmentId,
          command: { ...command, commandId: "foreign" },
        },
      },
    },
    {
      original: {
        ...claimed.original,
        invocation: {
          environmentId: identity.environmentId,
          command: { ...command, type: "thread.turn.interrupt" },
        },
      },
    },
    { kind: "retired", reason: "confirmed-refusal" },
    { schemaVersion: 7 },
  ])("rejects mismatched or fabricated authority %#", (change) => {
    expect(() => decodeThreadOutboxRecord({ ...claimed, ...change })).toThrow();
  });
});
