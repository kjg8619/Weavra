import { fixture, harness } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { appAtomRegistry } from "./atom-registry";
import {
  removeThreadOutboxMessage,
  retireTransferredMessage,
  releaseTransferredMessage,
} from "./thread-outbox-removal";
import { editPendingThreadMessage } from "./edit-pending-thread-message";
import { holdEditingQueuedMessage } from "./use-thread-outbox";
import { pendingTaskDraftKey } from "./pending-task-identity";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import * as drafts from "./use-composer-drafts";

function message(creation = false): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("message"),
    commandId: CommandId.make("command"),
    text: "retained text",
    attachments: [
      {
        id: "file",
        type: "file",
        name: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: "file:///documents/source.txt",
      },
    ],
    ...(creation
      ? {
          creation: {
            projectId: ProjectId.make("project"),
            workspaceMode: "local" as const,
            branch: null,
            worktreePath: null,
          },
        }
      : {}),
    createdAt: "2026-10-04T00:00:00.000Z",
  };
}
function latest(row: QueuedThreadMessage) {
  const record = fixture().manager.recordAt(row.storageIdentity ?? row);
  if (record === null) throw new Error("Expected durable record");
  return record;
}
beforeEach(async () => {
  fixture().reset();
  drafts.resetComposerDraftsLoadState();
  await drafts.waitForComposerDraftsLoaded();
});
afterEach(async () => {
  harness.draftFile.error = null;
  await drafts.flushComposerDrafts();
  appAtomRegistry.set(drafts.composerDraftsAtom, {});
  harness.draftFile.document = JSON.stringify({ schemaVersion: 1, drafts: {} });
  harness.removeFile.mockClear();
  vi.restoreAllMocks();
});
describe("reason-specific outbox retirement", () => {
  it("releases explicit discard content while retaining the durable marker", async () => {
    const row = await fixture().admit(message());
    await expect(removeThreadOutboxMessage(row)).resolves.toBe(true);
    expect(latest(row)).toMatchObject({ kind: "retired", reason: "discarded" });
    expect(latest(row)).not.toHaveProperty("retainedMessage");
    await fixture().restart();
    await expect(fixture().admit(message())).rejects.toMatchObject({ reason: "identity-occupied" });
  });
  it("keeps an unrelated accepted edit when discard loses its captured CAS", async () => {
    const row = await fixture().admit(message());
    const entered = Promise.withResolvers<void>();
    const barrier = Promise.withResolvers<void>();
    vi.spyOn(drafts, "waitForComposerDraftsLoaded").mockImplementationOnce(async () => {
      entered.resolve();
      await barrier.promise;
    });
    const removal = removeThreadOutboxMessage(row);
    await entered.promise;
    await fixture().edit({ ...row, text: "newest" }, fixture().record(row));
    barrier.resolve();
    await expect(removal).resolves.toBe(false);
    expect(latest(row)).toMatchObject({ kind: "message", message: { text: "newest" } });
    expect(harness.removeFile).not.toHaveBeenCalled();
  });
  it.each(["scoped", "legacy"] as const)(
    "retains editor-only files and %s drafts on explicit discard",
    async (kind) => {
      const row = await fixture().admit(message(true));
      const key = kind === "scoped" ? pendingTaskDraftKey(row) : `pending-task:${row.messageId}`;
      const edited = {
        text: "editor-only",
        attachments: [
          {
            id: "editor",
            type: "file" as const,
            name: "editor.txt",
            mimeType: "text/plain",
            sizeBytes: 1,
            fileUri: "file:///documents/editor-only.txt",
          },
        ],
      };
      drafts.setComposerDraftText(key, edited.text);
      drafts.replaceComposerDraftAttachments(key, edited.attachments);
      await drafts.flushComposerDrafts();
      await expect(removeThreadOutboxMessage(row)).resolves.toBe(false);
      expect(latest(row)).toMatchObject({ kind: "retired", retainedMessage: { text: row.text } });
      expect(drafts.getComposerDraftSnapshot(key).text).toBe("editor-only");
      expect(drafts.getComposerDraftSnapshot(key).attachments).toEqual(edited.attachments);
      expect(harness.removeFile).not.toHaveBeenCalled();
    },
  );
  it("releases a creation without any editor draft after discard", async () => {
    const row = await fixture().admit(message(true));
    await expect(removeThreadOutboxMessage(row)).resolves.toBe(true);
    expect(latest(row)).not.toHaveProperty("retainedMessage");
  });
  it("does not release another editor's independent lease", async () => {
    const row = await fixture().admit(message(true));
    const one = holdEditingQueuedMessage(row);
    const two = holdEditingQueuedMessage(row);
    one?.();
    await expect(removeThreadOutboxMessage(row)).resolves.toBe(false);
    expect(latest(row)).toHaveProperty("retainedMessage");
    two?.();
  });
  it("preserves other environments and raw-ID siblings during scoped discard", async () => {
    const row = await fixture().admit(message());
    const other = await fixture().admit({
      ...message(),
      environmentId: EnvironmentId.make("other"),
    });
    await removeThreadOutboxMessage(row);
    expect(latest(other)).toMatchObject({ kind: "message", delivery: { state: "ready" } });
  });
  it("retains pending drafts even when their persistence is unavailable", async () => {
    const row = await fixture().admit(message(true));
    const key = pendingTaskDraftKey(row);
    drafts.setComposerDraftText(key, "editor work");
    harness.draftFile.error = new Error("draft unavailable");
    await expect(removeThreadOutboxMessage(row)).resolves.toBe(false);
    expect(drafts.getComposerDraftSnapshot(key).text).toBe("editor work");
    expect(latest(row)).toHaveProperty("retainedMessage");
    expect(harness.removeFile).not.toHaveBeenCalled();
  });
});
describe("durable draft transfer", () => {
  it("retains a distinct original snapshot after transferring the newest edit", async () => {
    const row = await fixture().admit(message());
    await fixture().manager.authority.claimForDelivery(
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
    const edited = await fixture().edit({ ...row, text: "newest edit" }, latest(row));
    const projection = edited === null ? null : fixture().manager.messageFor(edited);
    if (projection === null) throw new Error("Expected edited retained row");
    await expect(editPendingThreadMessage(projection)).resolves.toBe(false);
    expect(drafts.getComposerDraftSnapshot("environment:thread").text).toBe("");
    // A separately authorized durable destination still cannot release the
    // distinct original snapshot. This is the production release boundary.
    await drafts.restoreComposerDraftSnapshot("environment:thread", {
      text: projection.text,
      attachments: projection.attachments,
    });
    const retired = await retireTransferredMessage(latest(row), () => true);
    if (retired === null) throw new Error("Expected explicit transfer retirement");
    await expect(releaseTransferredMessage(retired, projection, () => true)).resolves.toBe(false);
    expect(latest(row)).toMatchObject({
      kind: "retired",
      reason: "draft-transfer",
      retainedMessage: { text: "newest edit" },
      original: { localSnapshot: { text: row.text, attachments: row.attachments } },
    });
    expect(drafts.getComposerDraftSnapshot("environment:thread").text).toBe("newest edit");
    expect(harness.removeFile).not.toHaveBeenCalled();
  });

  it("persists the destination before retiring and releasing the source", async () => {
    const row = await fixture().admit(message());
    fixture().gates.push(async (record) => {
      expect(record).toMatchObject({ kind: "retired", reason: "draft-transfer" });
      expect(JSON.parse(harness.draftFile.document).drafts["environment:thread"].text).toBe(
        row.text,
      );
    });
    await expect(editPendingThreadMessage(row)).resolves.toBe(true);
    expect(latest(row)).toMatchObject({ kind: "retired", reason: "draft-transfer" });
    expect(latest(row)).not.toHaveProperty("retainedMessage");
  });
  it("retains the source and newest draft when destination persistence fails", async () => {
    const row = await fixture().admit(message());
    harness.draftFile.error = new Error("disk full");
    await expect(editPendingThreadMessage(row)).rejects.toThrow();
    expect(latest(row)).toMatchObject({ kind: "message", message: { text: row.text } });
    expect(harness.removeFile).not.toHaveBeenCalled();
  });
  it("retains the latest source when another edit wins during destination persistence", async () => {
    const row = await fixture().admit(message());
    const entered = Promise.withResolvers<void>();
    const barrier = Promise.withResolvers<void>();
    const flush = drafts.flushComposerDrafts;
    vi.spyOn(drafts, "flushComposerDrafts").mockImplementationOnce(async () => {
      await flush();
      entered.resolve();
      await barrier.promise;
    });
    const transfer = editPendingThreadMessage(row);
    await entered.promise;
    await fixture().edit({ ...row, text: "newest" }, fixture().record(row));
    barrier.resolve();
    await expect(transfer).resolves.toBe(false);
    expect(latest(row)).toMatchObject({ kind: "message", message: { text: "newest" } });
  });
});
