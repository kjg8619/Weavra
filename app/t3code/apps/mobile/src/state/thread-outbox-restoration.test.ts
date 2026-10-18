import { fixture, harness } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { appAtomRegistry } from "./atom-registry";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { restoredNewTaskDraftKey } from "./new-task-draft-key";
import {
  clearPendingThreadCreationOutcome,
  pendingThreadCreationOutcomesAtom,
} from "./pending-thread-creation";
import { recoverFailedThreadDraft } from "./recover-failed-thread-draft";
import { restoreRejectedQueuedMessage } from "./thread-outbox-restoration";
import * as composerDrafts from "./use-composer-drafts";
function queuedMessage(input: {
  readonly messageId: string;
  readonly text: string;
  readonly fileUri?: string;
}): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    messageId: MessageId.make(input.messageId),
    commandId: CommandId.make("command-" + input.messageId),
    text: input.text,
    attachments: input.fileUri
      ? [
          {
            id: "file-" + input.messageId,
            type: "file",
            name: "report.pdf",
            mimeType: "application/pdf",
            sizeBytes: 42,
            fileUri: input.fileUri,
          },
        ]
      : [],
    createdAt: "2026-08-24T12:00:00.000Z",
  };
}
function remainingMessages() {
  return Object.values(appAtomRegistry.get(fixture().manager.queuedMessagesByThreadKeyAtom)).flat();
}
beforeEach(async () => {
  fixture().reset();
  composerDrafts.resetComposerDraftsLoadState();
  await composerDrafts.waitForComposerDraftsLoaded();
});
afterEach(async () => {
  harness.draftFile.error = null;
  await composerDrafts.flushComposerDrafts();
  appAtomRegistry.set(composerDrafts.composerDraftsAtom, {});
  appAtomRegistry.set(composerDrafts.composerCloudDraftsAtom, { accountId: null, signedOut: {} });
  appAtomRegistry.set(pendingThreadCreationOutcomesAtom, {});
  harness.draftFile.document = JSON.stringify({ schemaVersion: 1, drafts: {} });
  harness.connectionError.mockClear();
});
describe("thread outbox recovery rollback", () => {
  it("preserves inline context from setup edits when reopening a failed task", async () => {
    let message = queuedMessage({ messageId: "failed-context", text: "Original prompt" });
    const sourceKey = `${message.environmentId}:${message.threadId}`;
    const targetKey = restoredNewTaskDraftKey(message);
    const record = {
      version: 1 as const,
      kind: "mention" as const,
      contextId: ComposerContextId.make("setup-file"),
      label: "Checkout.tsx",
      path: "src/Checkout.tsx",
    };
    const context = { version: 1 as const, records: [record] };
    const text = "[Checkout.tsx](t3-context://v1/mention/setup-file)";
    appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
      [targetKey]: { text: message.text, attachments: [] },
      [sourceKey]: { text, context, attachments: [] },
    });
    await recoverFailedThreadDraft(message);
    expect(composerDrafts.getComposerDraftSnapshot(targetKey)).toMatchObject({
      text: `Original prompt\n\n${text}`,
      context,
    });
    expect(composerDrafts.getComposerDraftSnapshot(sourceKey).context).toBeUndefined();
  });

  it("reopens a rejected task with setup edits and every attachment, even above the send cap", async () => {
    let message = queuedMessage({ messageId: "failed-setup", text: "Original prompt" });
    const sourceKey = `${message.environmentId}:${message.threadId}`;
    const targetKey = restoredNewTaskDraftKey(message);
    const files = Array.from(
      { length: 10 },
      (_, index) =>
        queuedMessage({
          messageId: `attachment-${index}`,
          text: "",
          fileUri: `file:///file-${index}`,
        }).attachments,
    ).flat();
    appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
      [targetKey]: { text: message.text, attachments: files.slice(0, 8) },
      [sourceKey]: { text: "Please include tests", attachments: files.slice(8) },
    });
    await recoverFailedThreadDraft(message);
    expect(composerDrafts.getComposerDraftSnapshot(targetKey)).toMatchObject({
      text: "Original prompt\n\nPlease include tests",
      attachments: files,
    });
    expect(composerDrafts.getComposerDraftSnapshot(sourceKey)).toMatchObject({
      text: "",
      attachments: [],
    });
    await recoverFailedThreadDraft(message);
    expect(composerDrafts.getComposerDraftSnapshot(targetKey).text).toBe(
      "Original prompt\n\nPlease include tests",
    );
  });

  it("keeps setup edits recoverable when saving their recovery draft fails", async () => {
    let message = queuedMessage({ messageId: "failed-save", text: "Original prompt" });
    const sourceKey = `${message.environmentId}:${message.threadId}`;
    appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
      [restoredNewTaskDraftKey(message)]: { text: message.text, attachments: [] },
      [sourceKey]: { text: "Follow-up", attachments: [] },
    });
    harness.draftFile.error = new Error("disk full");
    await expect(recoverFailedThreadDraft(message)).rejects.toThrow("Composer draft persistence");
    expect(composerDrafts.getComposerDraftSnapshot(sourceKey).text).toBe("Follow-up");
    harness.draftFile.error = null;
    await recoverFailedThreadDraft(message);
    expect(composerDrafts.getComposerDraftSnapshot(restoredNewTaskDraftKey(message)).text).toBe(
      "Original prompt\n\nFollow-up",
    );
  });

  it("restores a rejected new task as its own draft for the project", async () => {
    let message: QueuedThreadMessage = {
      ...queuedMessage({ messageId: "message-creation-restore", text: "new task text" }),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "local",
        branch: null,
        worktreePath: null,
      },
    };
    message = await fixture().admit(message);

    await expect(restoreRejectedQueuedMessage(message, "rejected by server")).resolves.toBe(
      "restored",
    );

    // The draft is keyed by the message so a retry lands on the same one, and
    // stamped with the project so it shows up as a Draft row for that project.
    expect(composerDrafts.getComposerDraftSnapshot(restoredNewTaskDraftKey(message))).toMatchObject(
      {
        text: message.text,
        attachments: message.attachments,
        modelSelection: message.modelSelection,
        project: {
          environmentId: message.environmentId,
          projectId: ProjectId.make("project-1"),
          createdAt: message.createdAt,
        },
      },
    );
    expect(remainingMessages()).toEqual([]);
    expect(harness.connectionError).toHaveBeenCalledWith("rejected by server");
    // The thread screen opened for this creation reads the failure from here.
    expect(
      appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[
        `${message.environmentId}:${message.threadId}`
      ],
    ).toEqual({ kind: "failed", message, reason: "rejected by server" });
  });

  it("keeps a failed outcome until its thread screen consumes it", async () => {
    let message: QueuedThreadMessage = {
      ...queuedMessage({ messageId: "message-creation-kept", text: "new task text" }),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "local",
        branch: null,
        worktreePath: null,
      },
    };
    message = await fixture().admit(message);
    await restoreRejectedQueuedMessage(message, "rejected by server");

    const key = `${message.environmentId}:${message.threadId}`;
    expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[key]?.kind).toBe("failed");

    clearPendingThreadCreationOutcome(key);
    expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)[key]).toBeUndefined();
  });

  it("does not record a creation outcome for a rejected follow-up message", async () => {
    let message = queuedMessage({ messageId: "message-followup-restore", text: "follow up" });
    message = await fixture().admit(message);

    await expect(restoreRejectedQueuedMessage(message, "rejected")).resolves.toBe("restored");

    expect(appAtomRegistry.get(pendingThreadCreationOutcomesAtom)).toEqual({});
  });

  it("rolls a failed recovery merge back so the retry cannot duplicate the text", async () => {
    let message = queuedMessage({ messageId: "message-restore", text: "queued text" });
    const draftKey = `${message.environmentId}:${message.threadId}`;
    appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
      [draftKey]: { text: "typed offline", attachments: [] },
    });
    message = await fixture().admit(message);

    harness.draftFile.error = new Error("disk full");
    await expect(restoreRejectedQueuedMessage(message, "too large")).resolves.toBe("retry");

    // The merge was rolled back and the message stayed queued for the retry.
    expect(composerDrafts.getComposerDraftSnapshot(draftKey).text).toBe("typed offline");
    expect(remainingMessages()).toEqual([message]);

    harness.draftFile.error = null;
    await expect(restoreRejectedQueuedMessage(message, "too large")).resolves.toBe("restored");

    // The recovered text landed exactly once and the message left the queue.
    expect(composerDrafts.getComposerDraftSnapshot(draftKey).text).toBe(
      "typed offline\n\nqueued text",
    );
    expect(remainingMessages()).toEqual([]);
    expect(harness.connectionError).toHaveBeenCalledWith("too large");
  });
});
