import { fixture, harness } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { appAtomRegistry } from "./atom-registry";
import { threadOutboxIdentity, type QueuedThreadMessage } from "./thread-outbox-model";
import {
  completeQueuedMessageDelivery,
  prepareQueuedMessageAttachments,
} from "./use-thread-outbox-drain";
import { holdEditingQueuedMessage } from "./use-thread-outbox";
import { acknowledgedThreadMessagesAtom } from "./acknowledged-thread-messages";
import { restoreRejectedQueuedMessage } from "./thread-outbox-restoration";
import * as drafts from "./use-composer-drafts";

function message(id = "message"): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make(id),
    commandId: CommandId.make(`command-${id}`),
    text: "original",
    attachments: [
      {
        id: "file",
        type: "file",
        name: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: "file:///documents/owned.txt",
      },
    ],
    createdAt: "2026-10-04T00:00:00.000Z",
  };
}
async function acknowledgment(row: QueuedThreadMessage) {
  const token = await fixture().manager.authority.claimForDelivery(
    fixture().record(row),
    {
      environmentId: row.environmentId,
      command: {
        type: "thread.turn.start",
        commandId: row.commandId,
        threadId: row.threadId,
        message: { messageId: row.messageId, role: "user", text: row.text, attachments: [] },
        runtimeMode: "full-access",
        interactionMode: "default",
        createdAt: row.createdAt,
      },
    },
    () => true,
  );
  if (token === null || fixture().manager.authority.consumeClaim(token) === null)
    throw new Error("Expected consumed claim");
  return { token, submitted: row, receipt: { sequence: 1 } };
}
function latest(row: QueuedThreadMessage) {
  const record = fixture().manager.recordAt(row.storageIdentity ?? row);
  if (record === null) throw new Error("Expected retained authority");
  return record;
}
beforeEach(async () => {
  fixture().reset();
  drafts.resetComposerDraftsLoadState();
  await drafts.waitForComposerDraftsLoaded();
  harness.prepare.mockImplementation(async (input) => ({
    status: "ready",
    attachments: [],
    draftAttachments: input.attachments,
    pendingAttachmentIds: [],
  }));
});
afterEach(async () => {
  harness.draftFile.error = null;
  await drafts.flushComposerDrafts();
  appAtomRegistry.set(drafts.composerDraftsAtom, {});
  appAtomRegistry.set(drafts.composerCloudDraftsAtom, { accountId: null, signedOut: {} });
  appAtomRegistry.set(acknowledgedThreadMessagesAtom, []);
  harness.draftFile.document = JSON.stringify({ schemaVersion: 1, drafts: {} });
  harness.prepare.mockReset();
  harness.removeFile.mockClear();
});

describe("record-backed outbox preparation", () => {
  it("abandons reused uploads when an editor saves changed text during verification", async () => {
    const row = await fixture().admit(message());
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    harness.prepare.mockImplementationOnce(async (input) => {
      entered.resolve();
      await release.promise;
      return {
        status: "ready",
        attachments: [],
        draftAttachments: input.attachments,
        pendingAttachmentIds: [],
      };
    });
    const preparation = prepareQueuedMessageAttachments(row);
    await entered.promise;
    await fixture().edit({ ...row, text: "newest" }, fixture().record(row));
    release.resolve();
    await expect(preparation).resolves.toEqual({ status: "abandoned" });
    expect(latest(row)).toMatchObject({ message: { text: "newest" } });
  });
  it("keeps unchanged reused uploads on their actual record", async () => {
    const row = await fixture().admit(message());
    const record = fixture().record(row);
    const result = await prepareQueuedMessageAttachments(row);
    expect(result).toMatchObject({ status: "ready", record, persistedMessage: row });
  });
  it("carries the actual record returned while persisting uploaded references", async () => {
    const row = await fixture().admit(message());
    const original = fixture().record(row);
    harness.prepare.mockImplementationOnce(async (input) => {
      const attachments = input.attachments.map((attachment) => ({
        ...attachment,
        uploadedAttachmentId: "upload",
        uploadEnvironmentId: input.environmentId,
      }));
      expect(await input.persistUploadedReferences?.(attachments)).toBe("persisted");
      return {
        status: "ready",
        attachments: [],
        draftAttachments: attachments,
        pendingAttachmentIds: ["upload"],
      };
    });
    const result = await prepareQueuedMessageAttachments(row);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("Expected preparation");
    expect(result.record).not.toBe(original);
    expect(result.record).toBe(latest(row));
    expect(result.persistedMessage.attachments[0]?.uploadedAttachmentId).toBe("upload");
  });
  it("does not prepare a replaced or independently held payload", async () => {
    const row = await fixture().admit(message());
    const release = holdEditingQueuedMessage(row);
    await expect(prepareQueuedMessageAttachments(row)).resolves.toEqual({ status: "abandoned" });
    release?.();
    await fixture().edit({ ...row, text: "replacement" }, fixture().record(row));
    await expect(prepareQueuedMessageAttachments(row)).resolves.toEqual({ status: "abandoned" });
    expect(harness.prepare).not.toHaveBeenCalled();
  });
});

describe("receipt retirement and retained recovery", () => {
  it("retries only local retirement after an acknowledged terminal write fails", async () => {
    const row = await fixture().admit(message());
    const ack = await acknowledgment(row);
    fixture().gates.push(async () => {
      throw new Error("disk unavailable");
    });
    await expect(completeQueuedMessageDelivery(ack)).rejects.toMatchObject({
      _tag: "ThreadOutboxAuthorityError",
    });
    expect(latest(row)).toMatchObject({ kind: "message", delivery: { state: "attempted" } });
    await expect(completeQueuedMessageDelivery(ack)).resolves.toBe(true);
    expect(latest(row)).toMatchObject({ kind: "retired", reason: "acknowledged" });
    expect(fixture().manager.authority.consumeClaim(ack.token)).toBeNull();
  });
  it("preserves a newer edit and original files while retiring an acknowledged transport", async () => {
    const row = await fixture().admit(message());
    const ack = await acknowledgment(row);
    await fixture().edit({ ...row, text: "newest edit" }, latest(row));
    await expect(completeQueuedMessageDelivery(ack)).resolves.toBe(true);
    expect(latest(row)).toMatchObject({
      kind: "retired",
      retainedMessage: { text: "newest edit" },
      original: { localSnapshot: { text: "original" } },
    });
    expect(harness.removeFile).not.toHaveBeenCalled();
  });
  it("releases unchanged acknowledged content but retains its durable marker", async () => {
    const row = await fixture().admit(message());
    await completeQueuedMessageDelivery(await acknowledgment(row));
    expect(latest(row)).toMatchObject({
      kind: "retired",
      reason: "acknowledged",
      acknowledgedSequence: 1,
    });
    expect(latest(row)).not.toHaveProperty("retainedMessage");
    expect(appAtomRegistry.get(acknowledgedThreadMessagesAtom)).toEqual([row]);
    await fixture().restart();
    expect(fixture().manager.authority.knownRecords()).toHaveLength(1);
    expect(fixture().manager.canPrepare(latest(row))).toBe(false);
  });
  it("retains editor content when its lease opens during terminal persistence", async () => {
    const row = await fixture().admit(message());
    const ack = await acknowledgment(row);
    const entered = Promise.withResolvers<void>();
    const barrier = Promise.withResolvers<void>();
    fixture().gates.push(async () => {
      entered.resolve();
      await barrier.promise;
    });
    const cleanup = completeQueuedMessageDelivery(ack);
    await entered.promise;
    const release = fixture().manager.authority.acquireEditor(latest(row), () => true);
    barrier.resolve();
    await cleanup;
    expect(latest(row)).toHaveProperty("retainedMessage");
    expect(harness.removeFile).not.toHaveBeenCalled();
    release?.();
  });
  it("retains terminal authority when the sign-out archive write fails", async () => {
    const row = await fixture().admit(message());
    const ack = await acknowledgment(row);
    appAtomRegistry.set(drafts.composerCloudDraftsAtom, {
      accountId: null,
      signedOut: { account: { drafts: {}, queuedMessages: [row] } },
    });
    harness.draftFile.error = new Error("archive unavailable");
    await expect(completeQueuedMessageDelivery(ack)).rejects.toThrow();
    expect(latest(row)).toMatchObject({ kind: "retired", reason: "acknowledged" });
    harness.draftFile.error = null;
    await completeQueuedMessageDelivery(ack);
    await fixture().restart();
    expect(fixture().manager.canPrepare(latest(row))).toBe(false);
  });
  it.each(["environment", "thread"] as const)(
    "retirement separates same IDs across %s",
    async (scope) => {
      const row = await fixture().admit(message());
      const other = await fixture().admit({
        ...message(),
        ...(scope === "environment"
          ? { environmentId: EnvironmentId.make("other") }
          : { threadId: ThreadId.make("other"), commandId: CommandId.make("other-command") }),
      });
      await completeQueuedMessageDelivery(await acknowledgment(row));
      expect(latest(other)).toMatchObject({ kind: "message", delivery: { state: "ready" } });
      expect(fixture().manager.canPrepare(latest(other))).toBe(true);
    },
  );
  it.each(["attempted", "retired"] as const)(
    "never automatically restores %s content or later edits",
    async (state) => {
      const row = await fixture().admit(message());
      const ack = await acknowledgment(row);
      await fixture().edit({ ...row, text: "newest" }, latest(row));
      if (state === "retired") await completeQueuedMessageDelivery(ack);
      const current = fixture().manager.messageFor(latest(row));
      if (current === null) throw new Error("Expected retained row");
      const before = fixture().files.get(threadOutboxIdentity(latest(row).storageIdentity));
      await expect(restoreRejectedQueuedMessage(current, "uncertain")).resolves.toBe("deferred");
      expect(fixture().files.get(threadOutboxIdentity(latest(row).storageIdentity))).toBe(before);
      expect(appAtomRegistry.get(drafts.composerDraftsAtom)).toEqual({});
      expect(harness.prepare).not.toHaveBeenCalled();
    },
  );
});
