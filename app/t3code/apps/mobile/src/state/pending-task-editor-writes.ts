import {
  threadOutboxManager,
  updateThreadOutboxMessage,
  type QueuedThreadMessage,
} from "./thread-outbox";
import type { ThreadOutboxRecord } from "./thread-outbox-record";
import { threadOutboxStorageIdentity } from "./thread-outbox-model";
import { getComposerDraftSnapshot, sameComposerDraftState } from "./use-composer-drafts";

const pendingWrites = new Map<string, Promise<ThreadOutboxRecord | null>>();

/** Keep the actual predecessor result even after its map entry disappears. */
export function capturePendingTaskEditorWriteBaseline(
  message: QueuedThreadMessage,
): Promise<ThreadOutboxRecord | null> {
  return (
    pendingWrites.get(threadOutboxStorageIdentity(message)) ??
    Promise.resolve(threadOutboxManager.recordFor(message))
  );
}

export function flushPendingTaskEditorWrite(input: {
  readonly message: QueuedThreadMessage;
  readonly baseline: Promise<ThreadOutboxRecord | null>;
  readonly draftKey: string;
}): Promise<boolean> {
  const snapshot = getComposerDraftSnapshot(input.draftKey);
  const write = input.baseline.then((expected) =>
    expected === null ? null : updateThreadOutboxMessage(input.message, expected),
  );
  const key = threadOutboxStorageIdentity(input.message);
  pendingWrites.set(key, write);
  const settled = () => {
    if (pendingWrites.get(key) === write) pendingWrites.delete(key);
  };
  void write.then(settled, settled);
  return write.then(
    (record) =>
      record !== null && sameComposerDraftState(snapshot, getComposerDraftSnapshot(input.draftKey)),
  );
}
