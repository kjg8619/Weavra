import {
  threadOutboxRetryDelayMs,
  threadOutboxStorageIdentity,
  type QueuedThreadMessage,
} from "./thread-outbox-model";

/** Local scheduling only; a retry deadline never grants delivery authority. */
export function createThreadOutboxRetryState(onReady: (message: QueuedThreadMessage) => void) {
  const attempts = new Map<string, number>();
  const notBefore = new Map<string, number>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    schedule: (message: QueuedThreadMessage): void => {
      const key = threadOutboxStorageIdentity(message);
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      const delay = threadOutboxRetryDelayMs(attempt);
      notBefore.set(key, Date.now() + delay);
      const previous = timers.get(key);
      if (previous !== undefined) clearTimeout(previous);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          onReady(message);
        }, delay),
      );
    },
    isBlocked: (message: QueuedThreadMessage): boolean =>
      (notBefore.get(threadOutboxStorageIdentity(message)) ?? 0) > Date.now(),
    clear: (message: QueuedThreadMessage): void => {
      const key = threadOutboxStorageIdentity(message);
      attempts.delete(key);
      notBefore.delete(key);
      const timer = timers.get(key);
      if (timer !== undefined) clearTimeout(timer);
      timers.delete(key);
    },
    cancelTimers: (): void => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    },
  };
}
