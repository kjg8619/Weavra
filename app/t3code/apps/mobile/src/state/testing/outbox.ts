import type { AtomRegistry } from "effect/unstable/reactivity";
import { createThreadOutboxRecordManager } from "../thread-outbox-record-manager";
import {
  decodeThreadOutboxRecord,
  encodeThreadOutboxRecord,
  type ThreadOutboxRecord,
} from "../thread-outbox-record";
import { threadOutboxIdentity, type QueuedThreadMessage } from "../thread-outbox-model";
import type { ThreadOutboxRecordStorage } from "../thread-outbox-storage";

/** Real serialized records; only the native filesystem boundary is substituted. */
export function createOutboxTestFixture(registry: AtomRegistry.AtomRegistry) {
  const files = new Map<string, string>();
  const writes: ThreadOutboxRecord[] = [];
  const gates: Array<(record: ThreadOutboxRecord) => Promise<void>> = [];
  const storage: ThreadOutboxRecordStorage = {
    loadRecords: async () => ({
      records: [...files.values()].map((value) => decodeThreadOutboxRecord(JSON.parse(value))),
      errors: [],
    }),
    readRecord: async (identity) => {
      const value = files.get(threadOutboxIdentity(identity));
      return value === undefined ? null : decodeThreadOutboxRecord(JSON.parse(value));
    },
    writeRecord: async (record) => {
      const gate = gates.shift();
      if (gate) await gate(record);
      files.set(
        threadOutboxIdentity(record.storageIdentity),
        JSON.stringify(encodeThreadOutboxRecord(record)),
      );
      writes.push(record);
    },
  };
  let manager = createThreadOutboxRecordManager({ registry, storage, accountId: null });
  return {
    files,
    writes,
    gates,
    storage,
    get manager() {
      return manager;
    },
    reset: () => {
      files.clear();
      writes.length = 0;
      gates.length = 0;
      manager = createThreadOutboxRecordManager({ registry, storage, accountId: null });
    },
    restart: async () => {
      manager = createThreadOutboxRecordManager({ registry, storage, accountId: null });
      await manager.load();
    },
    admit: async (message: QueuedThreadMessage, owner: string | null = null) => {
      const { delivery: _delivery, storageIdentity: _slot, ...content } = message;
      const record = await manager.enqueueNew(content, owner).committed;
      const projected = manager.messageFor(record);
      if (projected === null) throw new Error("Expected committed projection");
      return projected;
    },
    edit: async (message: QueuedThreadMessage, expected: ThreadOutboxRecord) => {
      const { delivery: _delivery, storageIdentity: _slot, ...content } = message;
      return manager.authority.updateContent(expected, content);
    },
    record: (message: QueuedThreadMessage) => {
      const record = manager.recordFor(message);
      if (record === null) throw new Error("Expected current record");
      return record;
    },
  };
}
