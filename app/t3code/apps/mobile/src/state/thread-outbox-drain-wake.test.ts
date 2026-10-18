import { fixture, harness } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { createThreadOutboxDrainWake } from "./thread-outbox-drain-wake";
import { createThreadOutboxRunner } from "./thread-outbox-drain-run";
import { threadOutboxRetryDelayMs, type QueuedThreadMessage } from "./thread-outbox-model";
import { appAtomRegistry } from "./atom-registry";
import {
  composerDraftsAtom,
  resetComposerDraftsLoadState,
  waitForComposerDraftsLoaded,
} from "./use-composer-drafts";

function message(id: string): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make(`thread-${id}`),
    messageId: MessageId.make(id),
    commandId: CommandId.make(`command-${id}`),
    text: id,
    attachments: [
      {
        id: `file-${id}`,
        type: "file",
        name: `${id}.txt`,
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: `file:///documents/${id}.txt`,
      },
    ],
    createdAt: "2026-10-04T00:00:00.000Z",
  };
}
beforeEach(async () => {
  fixture().reset();
  appAtomRegistry.set(composerDraftsAtom, {});
  resetComposerDraftsLoadState();
  await waitForComposerDraftsLoaded();
  harness.prepare.mockImplementation(async (input) => ({
    status: "ready",
    attachments: [],
    draftAttachments: input.attachments,
    pendingAttachmentIds: [],
  }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
  harness.prepare.mockReset();
});

describe("production inventory recovery wake", () => {
  it.each(["false", "reject"] as const)(
    "does not rearm after an operation returns %s following cancellation",
    async (outcome) => {
      const row = await fixture().admit(message("late"));
      const entered = Promise.withResolvers<void>();
      const operation = Promise.withResolvers<boolean>();
      const onReady = vi.fn();
      const wake = createThreadOutboxDrainWake(onReady);
      const load = vi.spyOn(fixture().manager, "load");
      vi.useFakeTimers();
      const pending = createThreadOutboxRunner(wake)(row, () => {
        entered.resolve();
        return operation.promise;
      });
      await entered.promise;

      wake.cancelTimers();
      if (outcome === "reject") operation.reject(new Error("late failure"));
      else operation.resolve(false);
      await pending;
      await vi.advanceTimersByTimeAsync(threadOutboxRetryDelayMs(1));

      expect(load).not.toHaveBeenCalled();
      expect(onReady).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("does not let an old successful operation clear a later generation's timer", async () => {
    const row = await fixture().admit(message("new-generation"));
    const operation = Promise.withResolvers<boolean>();
    const onReady = vi.fn();
    const wake = createThreadOutboxDrainWake(onReady);
    vi.useFakeTimers();
    const pending = createThreadOutboxRunner(wake)(row, () => operation.promise);
    wake.cancelTimers();
    wake.schedule(row);

    operation.resolve(true);
    await pending;
    await vi.advanceTimersByTimeAsync(threadOutboxRetryDelayMs(1));

    expect(onReady).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("arms one reconciliation from an editor failure without a transport retry", async () => {
    const first = await fixture().admit(message("editor"));
    const second = await fixture().admit(message("independent"));
    const resumed = Promise.withResolvers<void>();
    const wake = createThreadOutboxDrainWake(() => resumed.resolve());
    const statuses: boolean[] = [];
    vi.useFakeTimers();
    const unsubscribe = appAtomRegistry.subscribe(
      fixture().manager.inventoryReadyAtom,
      (complete) => {
        statuses.push(complete);
        if (!complete) wake.reconcile(second);
      },
      { immediate: true },
    );
    fixture().gates.push(async () => {
      throw new Error("editor write failed");
    });
    await expect(
      fixture().edit({ ...first, text: "uncommitted" }, fixture().record(first)),
    ).rejects.toThrow();
    wake.reconcile(second);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(threadOutboxRetryDelayMs(1));
    await resumed.promise;

    expect(statuses).toEqual([true, false, true]);
    const record = fixture().manager.recordAt(second.storageIdentity ?? second);
    if (record === null) throw new Error("Expected independent record");
    expect(fixture().manager.canPrepare(record)).toBe(true);
    unsubscribe();
    wake.cancelTimers();
  });

  it("retries only inventory reads after another read fails and never reopens attempted authority", async () => {
    const attempted = await fixture().admit(message("attempted"));
    const ready = await fixture().admit(message("ready"));
    const token = await fixture().manager.authority.claimForDelivery(
      fixture().record(attempted),
      {
        environmentId: attempted.environmentId,
        command: {
          type: "thread.turn.start",
          commandId: attempted.commandId,
          threadId: attempted.threadId,
          message: {
            messageId: attempted.messageId,
            role: "user",
            text: attempted.text,
            attachments: [],
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          createdAt: attempted.createdAt,
        },
      },
      () => true,
    );
    if (token === null) throw new Error("Expected claim");
    expect(fixture().manager.authority.consumeClaim(token)).not.toBeNull();
    fixture().gates.push(async () => {
      throw new Error("independent write failed");
    });
    await expect(
      fixture().edit({ ...ready, text: "uncommitted" }, fixture().record(ready)),
    ).rejects.toThrow();
    const load = fixture().storage.loadRecords;
    const read = vi
      .spyOn(fixture().storage, "loadRecords")
      .mockRejectedValueOnce(new Error("inventory still unavailable"))
      .mockImplementation(load);
    const onReady = vi.fn();
    const wake = createThreadOutboxDrainWake(onReady);
    vi.useFakeTimers();
    wake.schedule(ready);
    await vi.advanceTimersByTimeAsync(threadOutboxRetryDelayMs(1));
    expect(read).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(threadOutboxRetryDelayMs(2));

    expect(read).toHaveBeenCalledTimes(2);
    expect(onReady).toHaveBeenCalledOnce();
    const first = fixture().manager.recordAt(attempted.storageIdentity ?? attempted);
    const second = fixture().manager.recordAt(ready.storageIdentity ?? ready);
    if (first === null || second === null) throw new Error("Expected reconciled records");
    expect(first.delivery.state).toBe("attempted");
    expect(fixture().manager.canPrepare(first)).toBe(false);
    expect(fixture().manager.canPrepare(second)).toBe(true);
    expect(fixture().manager.authority.consumeClaim(token)).toBeNull();
    expect(harness.prepare).not.toHaveBeenCalled();
    wake.cancelTimers();
  });

  it("does not wake or rearm after cancellation during inventory reconciliation", async () => {
    const row = await fixture().admit(message("cancel"));
    fixture().gates.push(async () => {
      throw new Error("write failed");
    });
    await expect(
      fixture().edit({ ...row, text: "uncommitted" }, fixture().record(row)),
    ).rejects.toThrow();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const load = fixture().storage.loadRecords;
    vi.spyOn(fixture().storage, "loadRecords").mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return load();
    });
    const onReady = vi.fn();
    const wake = createThreadOutboxDrainWake(onReady);
    vi.useFakeTimers();
    wake.schedule(row);
    vi.advanceTimersByTime(threadOutboxRetryDelayMs(1));
    await entered.promise;

    wake.cancelTimers();
    release.resolve();
    await fixture().manager.flush();

    expect(onReady).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
