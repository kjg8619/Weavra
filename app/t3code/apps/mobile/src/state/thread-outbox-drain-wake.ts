import { createThreadOutboxRetryState } from "./thread-outbox-retry";
import { threadOutboxManager } from "./thread-outbox";
import type { QueuedThreadMessage } from "./thread-outbox-model";

/** Production retry wake; scheduling never grants delivery permission. */
export function createThreadOutboxDrainWake(onReady: () => void) {
  let generation = 0;
  let reading: Promise<boolean> | null = null;
  const readInventory = async (message: QueuedThreadMessage): Promise<void> => {
    const captured = generation;
    // One shared inventory read per wake wave, including writes which failed
    // before a claim existed. This cannot consume a token or invoke transport.
    const pending = reading ?? threadOutboxManager.load();
    reading = pending;
    const complete = await pending;
    if (reading === pending) reading = null;
    if (captured !== generation) return;
    if (complete) onReady();
    else retries.schedule(message);
  };
  const retries = createThreadOutboxRetryState((message) => void readInventory(message));
  return {
    ...retries,
    /** Bind an outstanding operation to this cancellation generation. */
    captureLifetime: () => {
      const captured = generation;
      return () => captured === generation;
    },
    // A failed editor/archive mutation can invalidate inventory without going
    // through the drain's transport catch. Arm once, without resetting backoff.
    reconcile: (message: QueuedThreadMessage) => {
      if (reading === null && !retries.isBlocked(message)) retries.schedule(message);
    },
    cancelTimers: () => {
      generation += 1;
      retries.cancelTimers();
    },
  };
}
