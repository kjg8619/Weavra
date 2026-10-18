import { prepareTurnAttachments, type PreparedTurnAttachments } from "../lib/attachmentUpload";
import { appAtomRegistry } from "./atom-registry";
import { threadOutboxManager, updateThreadOutboxMessage } from "./thread-outbox";
import { threadOutboxStorageIdentity, type QueuedThreadMessage } from "./thread-outbox-model";
import type { ThreadOutboxRecord } from "./thread-outbox-record";
import { hasPendingEditorDraft } from "./thread-outbox-removal";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";

export function canPrepareQueuedMessage(record: ThreadOutboxRecord): boolean {
  const message = threadOutboxManager.messageFor(record);
  return (
    message !== null &&
    threadOutboxManager.canPrepare(record) &&
    !appAtomRegistry.get(editingQueuedMessageIdsAtom)[threadOutboxStorageIdentity(message)] &&
    !hasPendingEditorDraft(message)
  );
}

/** Retained quarantine cannot block an independent eligible record behind it. */
export function firstEligibleOutboxMessage(queue: ReadonlyArray<QueuedThreadMessage>) {
  return queue.find((message) => {
    const record = threadOutboxManager.recordFor(message);
    return record !== null && canPrepareQueuedMessage(record);
  });
}

export async function prepareQueuedMessageAttachments(
  queuedMessage: QueuedThreadMessage,
  supportsImageUploads = false,
  scopeCurrent: () => boolean = () => true,
): Promise<
  | {
      readonly status: "ready";
      readonly prepared: PreparedTurnAttachments;
      readonly persistedMessage: QueuedThreadMessage;
      readonly record: ThreadOutboxRecord;
    }
  | { readonly status: "abandoned" }
> {
  const initial = threadOutboxManager.recordFor(queuedMessage);
  if (initial === null || !canPrepareQueuedMessage(initial) || !scopeCurrent())
    return { status: "abandoned" };
  let record = initial;
  let persistedMessage = queuedMessage;
  const current = () => canPrepareQueuedMessage(record) && scopeCurrent();
  const result = await prepareTurnAttachments({
    environmentId: queuedMessage.environmentId,
    attachments: queuedMessage.attachments,
    supportsImageUploads,
    canUpload: current,
    persistUploadedReferences: async (attachments) => {
      if (!current()) return "abandon";
      const committed = await updateThreadOutboxMessage(
        { ...persistedMessage, attachments },
        record,
      );
      if (committed === null) return "abandon";
      const projection = threadOutboxManager.messageFor(committed);
      record = committed;
      // A parked/hidden committed record still owns its uploaded references.
      // Report durable handoff, then let the outer readiness check abandon.
      if (projection !== null) persistedMessage = projection;
      return "persisted";
    },
  });
  if (result.status === "abandoned" || !current()) return { status: "abandoned" };
  return { status: "ready", prepared: result, persistedMessage, record };
}
