import { appAtomRegistry } from "./atom-registry";
import { threadOutboxStorageIdentity, type QueuedThreadMessage } from "./thread-outbox-model";
import type { createThreadOutboxDrainWake } from "./thread-outbox-drain-wake";
import { dispatchingQueuedMessageIdAtom } from "./use-thread-outbox";

/** Shared lifetime for delivery, retained ACK cleanup and pre-claim transfer. */
export function createThreadOutboxRunner(
  retries: Pick<
    ReturnType<typeof createThreadOutboxDrainWake>,
    "clear" | "schedule" | "captureLifetime"
  >,
) {
  return (message: QueuedThreadMessage, operation: () => Promise<boolean>): Promise<void> => {
    const currentLifetime = retries.captureLifetime();
    const key = threadOutboxStorageIdentity(message);
    appAtomRegistry.set(dispatchingQueuedMessageIdAtom, key);
    return operation()
      .then((complete) => {
        if (!currentLifetime()) return;
        if (complete) retries.clear(message);
        else retries.schedule(message);
      })
      .catch((error: unknown) => {
        console.warn("[thread-outbox] delivery or retirement failed; content retained", {
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          error,
        });
        if (currentLifetime()) retries.schedule(message);
      })
      .finally(() => {
        if (appAtomRegistry.get(dispatchingQueuedMessageIdAtom) === key) {
          appAtomRegistry.set(dispatchingQueuedMessageIdAtom, null);
        }
      });
  };
}
