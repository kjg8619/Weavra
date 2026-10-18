import { appAtomRegistry } from "./atom-registry";
import { environmentPresentations } from "./presentation";
import { environmentShell } from "./shell";
import { threadOutboxManager } from "./thread-outbox";
import { hasPendingEditorDraft } from "./thread-outbox-removal";
import { editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import { environmentThreadShells } from "./threads";
import {
  resolveThreadOutboxDeliveryAction,
  threadOutboxStorageIdentity,
  type QueuedThreadMessage,
} from "./thread-outbox-model";

/** Live scope only: attempted publication must not invalidate its own claim. */
export function queuedMessageScopeCurrent(message: QueuedThreadMessage): boolean {
  const connection = appAtomRegistry.get(
    environmentPresentations.presentationAtom(message.environmentId),
  );
  if (
    connection === null ||
    !connection.entry.enabled ||
    connection.connection.phase !== "connected"
  )
    return false;
  const thread = appAtomRegistry
    .get(environmentThreadShells.threadShellsAtom)
    .find(
      (candidate) =>
        candidate.environmentId === message.environmentId && candidate.id === message.threadId,
    );
  return (
    resolveThreadOutboxDeliveryAction({
      isCreation: message.creation !== undefined,
      threadExists: thread !== undefined,
      shellStatus: appAtomRegistry.get(environmentShell.stateValueAtom(message.environmentId))
        .status,
      environmentConnected: true,
      threadBusy: thread?.session?.status === "running",
    }) === "send"
  );
}

export function canInvokeQueuedMessage(message: QueuedThreadMessage): boolean {
  const record = threadOutboxManager.recordAt(message.storageIdentity ?? message);
  return (
    record !== null &&
    threadOutboxManager.isVisible(record) &&
    !appAtomRegistry.get(editingQueuedMessageIdsAtom)[threadOutboxStorageIdentity(message)] &&
    !hasPendingEditorDraft(message) &&
    queuedMessageScopeCurrent(message)
  );
}
