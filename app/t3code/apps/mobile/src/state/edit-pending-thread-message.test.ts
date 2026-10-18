import { fixture, harness } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { threadOutboxStorageIdentity } from "./thread-outbox-model";
import { appAtomRegistry } from "./atom-registry";
import { dispatchingQueuedMessageIdAtom, editingQueuedMessageIdsAtom } from "./use-thread-outbox";
import { editPendingThreadMessage } from "./edit-pending-thread-message";
import * as drafts from "./use-composer-drafts";

const message: QueuedThreadMessage = {
  environmentId: EnvironmentId.make("env"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("message"),
  commandId: CommandId.make("command"),
  text: "Queued task",
  createdAt: "2026-09-06T10:00:00.000Z",
  attachments: [
    {
      id: "file",
      type: "file",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      fileUri: "file:///notes.txt",
    },
  ],
};
beforeEach(async () => {
  fixture().reset();
  drafts.resetComposerDraftsLoadState();
  await drafts.waitForComposerDraftsLoaded();
  drafts.setComposerDraftText("env:thread", "Existing draft");
  await drafts.flushComposerDrafts();
});
afterEach(async () => {
  vi.restoreAllMocks();
  await drafts.flushComposerDrafts();
  appAtomRegistry.set(drafts.composerDraftsAtom, {});
  appAtomRegistry.set(dispatchingQueuedMessageIdAtom, null);
  harness.draftFile.document = JSON.stringify({ schemaVersion: 1, drafts: {} });
});
describe("editing a pending message", () => {
  it("locks delivery and persists text and attachments before retiring the queued copy", async () => {
    const row = await fixture().admit(message);
    const confirm = fixture().manager.confirmQueued;
    vi.spyOn(fixture().manager, "confirmQueued").mockImplementationOnce(async (candidate) => {
      expect(
        appAtomRegistry.get(editingQueuedMessageIdsAtom)[threadOutboxStorageIdentity(row)],
      ).toBe(true);
      return confirm(candidate);
    });
    fixture().gates.push(async () => {
      expect(JSON.parse(harness.draftFile.document).drafts["env:thread"]).toMatchObject({
        text: "Existing draft\n\nQueued task",
        attachments: message.attachments,
      });
    });
    expect(await editPendingThreadMessage(row)).toBe(true);
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)).toEqual({});
  });
  it("does not reclaim a message already being dispatched", async () => {
    const row = await fixture().admit(message);
    appAtomRegistry.set(dispatchingQueuedMessageIdAtom, threadOutboxStorageIdentity(row));
    expect(await editPendingThreadMessage(row)).toBe(false);
    expect(drafts.getComposerDraftSnapshot("env:thread").text).toBe("Existing draft");
  });
  it("rolls back the draft if retiring the queued message fails", async () => {
    const row = await fixture().admit(message);
    fixture().gates.push(async () => {
      throw new Error("disk error");
    });
    await expect(editPendingThreadMessage(row)).rejects.toMatchObject({ reason: "write-failed" });
    expect(drafts.getComposerDraftSnapshot("env:thread")).toMatchObject({
      text: "Existing draft",
      attachments: [],
    });
    expect(appAtomRegistry.get(editingQueuedMessageIdsAtom)).toEqual({});
  });
  it("rolls back when a newer queue record wins", async () => {
    const row = await fixture().admit(message);
    const merge = drafts.mergeComposerDraftContent;
    vi.spyOn(drafts, "mergeComposerDraftContent").mockImplementationOnce(async (...args) => {
      const result = await merge(...args);
      await fixture().edit({ ...row, text: "newest" }, fixture().record(row));
      return result;
    });
    expect(await editPendingThreadMessage(row)).toBe(false);
    expect(drafts.getComposerDraftSnapshot("env:thread").text).toBe("Existing draft");
  });
});
