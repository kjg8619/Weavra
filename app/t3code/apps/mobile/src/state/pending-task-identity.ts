import { threadOutboxStorageIdentity, type QueuedThreadMessage } from "./thread-outbox-model";

/** Editor identity follows the immutable storage slot, not a retargeted transport. */
export function pendingTaskDraftKey(message: QueuedThreadMessage): string {
  return `pending-task:${threadOutboxStorageIdentity(message)}`;
}

/**
 * Routes carry the scoped key. Historical raw IDs are resolvable only when one
 * exact candidate exists; neither environment alone nor queue order is authority.
 */
export function findQueuedPendingTask(
  routeIdentity: string,
  messages: ReadonlyArray<QueuedThreadMessage>,
): QueuedThreadMessage | null {
  const candidates = messages.filter(
    (message) =>
      message.creation !== undefined &&
      (pendingTaskDraftKey(message) === routeIdentity || message.messageId === routeIdentity),
  );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}
