import type { QueuedThreadMessage } from "./thread-outbox-model";
import {
  appendComposerDraftAttachments,
  flushComposerDrafts,
  getComposerDraftSnapshot,
  mergeComposerDraftContent,
} from "./use-composer-drafts";

/** A failed admission owns every byte until the restored destination is durable. */
export async function restoreOutboxAdmission(input: {
  readonly message: Pick<QueuedThreadMessage, "text" | "context" | "attachments">;
  readonly draftKey: string;
  readonly releaseAfterHandback: () => boolean;
}): Promise<void> {
  await mergeComposerDraftContent(input.draftKey, {
    text: input.message.text,
    context: input.message.context,
    attachments: [],
  });
  const existing = new Set(
    getComposerDraftSnapshot(input.draftKey).attachments.map((attachment) => attachment.id),
  );
  appendComposerDraftAttachments(
    input.draftKey,
    input.message.attachments.filter((attachment) => !existing.has(attachment.id)),
    { allowOverflow: true },
  );
  await flushComposerDrafts();
  input.releaseAfterHandback();
}
