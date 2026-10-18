import { fixture, harness, setServerConfig } from "./testing/drain-harness";
import { config, modelSelection } from "./testing/outbox-config";
import { AsyncResult } from "effect/unstable/reactivity";
import { createThreadOutboxDelivery } from "./thread-outbox-delivery";
import { createThreadOutboxRunner } from "./thread-outbox-drain-run";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { createThreadOutboxDrainWake } from "./thread-outbox-drain-wake";
import {
  prepareQueuedMessageAttachments,
  firstEligibleOutboxMessage,
} from "./thread-outbox-preparation";
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
  setServerConfig(config);
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

describe("preparation inventory recovery", () => {
  it("reconciles a failed preparation write before either existing ready record can progress", async () => {
    const first = await fixture().admit(message("a"));
    const second = await fixture().admit({ ...message("b"), attachments: [] });
    const ready = Promise.withResolvers<void>();
    const onReady = vi.fn(() => ready.resolve());
    const wake = createThreadOutboxDrainWake(onReady);
    const run = createThreadOutboxRunner(wake);
    vi.useFakeTimers();
    const writeEntered = Promise.withResolvers<void>();
    const writeRelease = Promise.withResolvers<void>();
    fixture().gates.push(async () => {
      writeEntered.resolve();
      await writeRelease.promise;
      throw new Error("preparation write failed");
    });
    harness.prepare.mockImplementationOnce(async (input) => {
      const attachments = input.attachments.map((attachment) => ({
        ...attachment,
        uploadedAttachmentId: "upload-a",
        uploadEnvironmentId: input.environmentId,
      }));
      await input.persistUploadedReferences?.(attachments);
      return {
        status: "ready",
        attachments: [],
        draftAttachments: attachments,
        pendingAttachmentIds: ["upload-a"],
      };
    });
    const preparing = run(first, () =>
      prepareQueuedMessageAttachments(first, true).then((result) => result.status === "ready"),
    );
    await writeEntered.promise;
    writeRelease.resolve();
    await preparing;
    expect(firstEligibleOutboxMessage([first])).toBeUndefined();
    expect(firstEligibleOutboxMessage([second])).toBeUndefined();

    const readEntered = Promise.withResolvers<void>();
    const readRelease = Promise.withResolvers<void>();
    const load = fixture().storage.loadRecords;
    const read = vi.spyOn(fixture().storage, "loadRecords").mockImplementationOnce(async () => {
      readEntered.resolve();
      await readRelease.promise;
      return load();
    });
    vi.advanceTimersByTime(threadOutboxRetryDelayMs(1));
    try {
      // Old production wakes immediately without reconciling. The fixed path
      // reaches the entered read instead; neither branch relies on a timeout.
      await Promise.race([readEntered.promise, ready.promise]);
      expect(read).toHaveBeenCalledOnce();
      expect(onReady).not.toHaveBeenCalled();
      expect(firstEligibleOutboxMessage([second])).toBeUndefined();
      readRelease.resolve();
      await ready.promise;
      const secondRecord = fixture().manager.recordAt(second.storageIdentity ?? second);
      const secondRow = secondRecord === null ? null : fixture().manager.messageFor(secondRecord);
      if (secondRow === null) throw new Error("Expected reconciled independent record");
      expect(firstEligibleOutboxMessage([secondRow])).toBe(secondRow);
      expect(harness.prepare).toHaveBeenCalledOnce();
      expect(
        [...fixture().files.values()].map((value) => JSON.parse(value).delivery.state),
      ).toEqual(["ready", "ready"]);
      const startTurn = vi.fn<Parameters<typeof createThreadOutboxDelivery>[0]["startTurn"]>(
        async (wire) => {
          expect(wire.input.message.messageId).toBe(second.messageId);
          const stored = await fixture().storage.readRecord(second.storageIdentity ?? second);
          expect(stored).toMatchObject({
            delivery: { state: "attempted" },
            original: { invocation: { command: { type: "thread.turn.start", ...wire.input } } },
          });
          return AsyncResult.success({ sequence: 8 });
        },
      );
      const deliver = createThreadOutboxDelivery({
        startTurn,
        updateMetadata: async () => AsyncResult.success({ sequence: 1 }),
        setRuntimeMode: async () => AsyncResult.success({ sequence: 2 }),
        setInteractionMode: async () => AsyncResult.success({ sequence: 3 }),
      });
      await expect(
        deliver({
          message: secondRow,
          canInvoke: () => true,
          projectCwd: null,
          thread: { modelSelection, runtimeMode: "full-access", interactionMode: "default" },
        }),
      ).resolves.toMatchObject({ status: "acknowledged" });
      expect(startTurn).toHaveBeenCalledOnce();
    } finally {
      readRelease.resolve();
      wake.cancelTimers();
    }
  });
});
