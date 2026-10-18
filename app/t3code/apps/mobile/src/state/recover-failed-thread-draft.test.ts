import { fixture, harness } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { appAtomRegistry } from "./atom-registry";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { restoredNewTaskDraftKey } from "./new-task-draft-key";
import { pendingThreadCreationOutcomesAtom } from "./pending-thread-creation";
import { recoverFailedThreadDraft } from "./recover-failed-thread-draft";
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
describe("failed thread source preservation", () => {
  it.each(["text", "attachments"] as const)(
    "keeps newer source %s changed while its recovery destination persists",
    async (change) => {
      const message = queuedMessage({ messageId: "moving-source", text: "Original prompt" });
      const sourceKey = `${message.environmentId}:${message.threadId}`;
      const targetKey = restoredNewTaskDraftKey(message);
      appAtomRegistry.set(composerDrafts.composerDraftsAtom, {
        [targetKey]: { text: message.text, attachments: [] },
        [sourceKey]: { text: "Follow-up", attachments: [] },
      });
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const merge = composerDrafts.mergeComposerDraftContent;
      const intercepted = vi
        .spyOn(composerDrafts, "mergeComposerDraftContent")
        .mockImplementationOnce(async (...args) => {
          const result = await merge(...args);
          entered.resolve();
          await release.promise;
          return result;
        });
      onTestFinished(() => {
        release.resolve();
        intercepted.mockRestore();
      });
      const pending = recoverFailedThreadDraft(message);
      await entered.promise;
      if (change === "text") composerDrafts.setComposerDraftText(sourceKey, "Newer follow-up");
      else
        composerDrafts.appendComposerDraftAttachments(
          sourceKey,
          queuedMessage({
            messageId: "new-file",
            text: "",
            fileUri: "file:///new-file",
          }).attachments,
        );
      const newer = composerDrafts.getComposerDraftSnapshot(sourceKey);
      release.resolve();

      await pending;

      expect(composerDrafts.getComposerDraftSnapshot(sourceKey)).toEqual(newer);
      expect(composerDrafts.getComposerDraftSnapshot(targetKey)).toMatchObject({
        text: "Original prompt\n\nFollow-up",
        attachments: [],
      });
    },
  );
});
