import { appAtomRegistry } from "./atom-registry";
import { createThreadOutboxRecordManager } from "./thread-outbox-record-manager";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import type { ThreadOutboxRecord } from "./thread-outbox-record";
import { expoThreadOutboxStorage, flushThreadOutboxWrites } from "./thread-outbox-storage";

export * from "./thread-outbox-model";

export const threadOutboxManager = createThreadOutboxRecordManager({
  registry: appAtomRegistry,
  storage: expoThreadOutboxStorage,
  accountId: null,
});

export async function flushThreadOutbox(): Promise<void> {
  await threadOutboxManager.flush();
  await flushThreadOutboxWrites();
}

/** Fresh user intent never imports delivery or immutable lineage authority. */
export function threadOutboxContent(message: QueuedThreadMessage) {
  const { delivery: _delivery, storageIdentity: _identity, ...content } = message;
  return content;
}

export function enqueueThreadOutboxMessage(message: QueuedThreadMessage) {
  return threadOutboxManager.enqueueNew(threadOutboxContent(message), null);
}

export function confirmThreadOutboxMessageQueued(message: QueuedThreadMessage) {
  return threadOutboxManager.confirmQueued(message);
}

export function updateThreadOutboxMessage(
  message: QueuedThreadMessage,
  expected: ThreadOutboxRecord,
): Promise<ThreadOutboxRecord | null> {
  const content = threadOutboxContent(message);
  return expected.transport.environmentId === message.environmentId
    ? threadOutboxManager.authority.updateContent(expected, content)
    : threadOutboxManager.authority.retargetReady(expected, content);
}
