import { describe, expect, it, vi } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { decodeThreadOutboxRecord, encodeThreadOutboxRecord } from "./thread-outbox-record";
import { threadOutboxIdentity, type QueuedThreadMessage } from "./thread-outbox-model";

const storage = vi.hoisted(() => ({
  files: new Map<string, string>(),
  writes: vi.fn(),
  legacy: vi.fn(() => {
    throw new Error("Legacy writer forbidden");
  }),
}));
vi.mock("./thread-outbox-storage", async () => {
  const model = await import("./thread-outbox-model");
  const codec = await import("./thread-outbox-record");
  return {
    flushThreadOutboxWrites: async () => {},
    expoThreadOutboxStorage: {
      load: storage.legacy,
      write: storage.legacy,
      remove: storage.legacy,
      loadRecords: async () => ({
        records: [...storage.files.values()].map((value) =>
          codec.decodeThreadOutboxRecord(JSON.parse(value)),
        ),
        errors: [],
      }),
      readRecord: async (identity: Parameters<typeof model.threadOutboxIdentity>[0]) => {
        const value = storage.files.get(model.threadOutboxIdentity(identity));
        return value === undefined ? null : codec.decodeThreadOutboxRecord(JSON.parse(value));
      },
      writeRecord: async (record: Parameters<typeof codec.encodeThreadOutboxRecord>[0]) => {
        storage.writes(record);
        storage.files.set(
          model.threadOutboxIdentity(record.storageIdentity),
          JSON.stringify(codec.encodeThreadOutboxRecord(record)),
        );
      },
    },
  };
});
import {
  enqueueThreadOutboxMessage,
  confirmThreadOutboxMessageQueued,
  threadOutboxManager,
  updateThreadOutboxMessage,
  flushThreadOutbox,
} from "./thread-outbox";

describe("production singleton cutover", () => {
  it("uses one record authority for fresh admission, CAS editing and retained retirement", async () => {
    // Given copied authority fields must never become fresh-send authority.
    const input: QueuedThreadMessage = {
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("message"),
      commandId: CommandId.make("command"),
      text: "fresh intent",
      attachments: [],
      createdAt: "2026-10-04T00:00:00.000Z",
      delivery: { state: "attempted" },
      storageIdentity: {
        environmentId: EnvironmentId.make("foreign"),
        threadId: ThreadId.make("foreign"),
        messageId: MessageId.make("message"),
      },
    };
    // When all production facade operations share the authoritative record.
    const record = await enqueueThreadOutboxMessage(input).committed;
    const row = threadOutboxManager.messageFor(record);
    if (row === null) throw new Error("Expected committed row");
    expect(await confirmThreadOutboxMessageQueued(row)).toBe(record);
    const edited = await updateThreadOutboxMessage({ ...row, text: "edited" }, record);
    if (edited === null) throw new Error("Expected committed edit");
    await threadOutboxManager.authority.retire(edited.storageIdentity, "discarded");
    await flushThreadOutbox();
    // Then only versioned records were written and the fence remains.
    expect((await import("./thread-outbox")).threadOutboxManager).toBe(threadOutboxManager);
    expect(record).toMatchObject({
      ownerAccountId: null,
      delivery: { state: "ready" },
      storageIdentity: { environmentId: input.environmentId, threadId: input.threadId },
    });
    expect(storage.legacy).not.toHaveBeenCalled();
    expect(storage.writes).toHaveBeenCalledTimes(3);
    const serialized = storage.files.get(threadOutboxIdentity(input));
    if (serialized === undefined) throw new Error("Expected same-slot marker");
    const stored = decodeThreadOutboxRecord(JSON.parse(serialized));
    expect(stored).toMatchObject({
      kind: "retired",
      reason: "discarded",
      retainedMessage: { text: "edited" },
    });
    expect(encodeThreadOutboxRecord(stored).schemaVersion).toBe(6);
  });
});
