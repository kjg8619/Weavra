import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { createThreadOutboxRetryState } from "./thread-outbox-retry";
import { threadOutboxRetryDelayMs, type QueuedThreadMessage } from "./thread-outbox-model";

const message: QueuedThreadMessage = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("same"),
  commandId: CommandId.make("command"),
  text: "pending",
  attachments: [],
  createdAt: "2026-10-04T00:00:00.000Z",
};
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("outbox retry scheduling", () => {
  it.each(["environment", "thread"] as const)(
    "does not block or clear another %s with the same message ID",
    (field) => {
      vi.useFakeTimers();
      vi.setSystemTime(0);
      const other =
        field === "environment"
          ? { ...message, environmentId: EnvironmentId.make("other") }
          : { ...message, threadId: ThreadId.make("other") };
      const ready = vi.fn();
      const retries = createThreadOutboxRetryState(ready);

      retries.schedule(message);
      expect(retries.isBlocked(other)).toBe(false);
      retries.schedule(other);
      retries.clear(message);
      expect(retries.isBlocked(message)).toBe(false);
      expect(retries.isBlocked(other)).toBe(true);
      vi.advanceTimersByTime(threadOutboxRetryDelayMs(1));
      expect(ready).toHaveBeenCalledOnce();
      expect(retries.isBlocked(other)).toBe(false);
    },
  );

  it("keeps backoff and timer ownership across a storage-lineage retarget", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const moved = {
      ...message,
      environmentId: EnvironmentId.make("destination"),
      storageIdentity: {
        environmentId: message.environmentId,
        threadId: message.threadId,
        messageId: message.messageId,
      },
    };
    const ready = vi.fn();
    const retries = createThreadOutboxRetryState(ready);
    retries.schedule(message);
    retries.schedule(moved);
    vi.advanceTimersByTime(threadOutboxRetryDelayMs(1));
    expect(ready).not.toHaveBeenCalled();
    expect(retries.isBlocked(message)).toBe(true);
    vi.advanceTimersByTime(threadOutboxRetryDelayMs(2) - threadOutboxRetryDelayMs(1));
    expect(ready).toHaveBeenCalledOnce();
    expect(retries.isBlocked(moved)).toBe(false);
    retries.schedule(moved);
    retries.cancelTimers();
    expect(vi.getTimerCount()).toBe(0);
  });
});
