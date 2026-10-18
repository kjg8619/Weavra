import type { DispatchResult } from "@t3tools/contracts";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { appAtomRegistry } from "./atom-registry";
import { pendingTaskDraftKey } from "./pending-task-identity";
import type { ThreadOutboxClaim } from "./thread-outbox-authority";
import { threadOutboxManager, threadOutboxContent } from "./thread-outbox";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import type { ThreadOutboxRecord } from "./thread-outbox-record";
import {
  composerDraftsAtom,
  scheduleUnusedComposerAttachmentCleanup,
  waitForComposerDraftsLoaded,
} from "./use-composer-drafts";

export function sameOutboxContent(left: QueuedThreadMessage, right: QueuedThreadMessage): boolean {
  const content = (message: QueuedThreadMessage) => ({
    ...threadOutboxContent(message),
    attachments: message.attachments.map(
      ({ uploadedAttachmentId: _upload, uploadEnvironmentId: _environment, ...attachment }) =>
        attachment,
    ),
  });
  return stableStringify(content(left)) === stableStringify(content(right));
}

/** Legacy ambiguity is a content owner, never permission to clear a draft. */
export function hasPendingEditorDraft(message: QueuedThreadMessage): boolean {
  const drafts = appAtomRegistry.get(composerDraftsAtom);
  return (
    drafts[pendingTaskDraftKey(message)] !== undefined ||
    drafts[`pending-task:${message.messageId}`] !== undefined
  );
}

async function releaseCompletedContent(record: ThreadOutboxRecord, authorize: () => boolean) {
  const released = await threadOutboxManager.authority.releaseRetained(record, authorize);
  if (released === null) return false;
  scheduleUnusedComposerAttachmentCleanup(
    released.released.flatMap((message) => message.attachments),
  );
  return true;
}

/** Explicit discard only. A newer edit or another editor retains the content. */
export async function removeThreadOutboxMessage(message: QueuedThreadMessage): Promise<boolean> {
  const expected = threadOutboxManager.recordFor(message);
  if (expected === null) return false;
  await waitForComposerDraftsLoaded();
  const retired = await threadOutboxManager.authority.retire(
    expected.storageIdentity,
    "discarded",
    () => threadOutboxManager.recordAt(expected.storageIdentity) === expected,
  );
  if (retired === null) return false;
  return releaseCompletedContent(retired, () => !hasPendingEditorDraft(message));
}

/** Destination persistence must finish before this explicit transfer is requested. */
export async function retireTransferredMessage(
  expected: ThreadOutboxRecord,
  destinationCurrent: () => boolean,
): Promise<ThreadOutboxRecord | null> {
  return threadOutboxManager.authority.retire(
    expected.storageIdentity,
    "draft-transfer",
    () =>
      threadOutboxManager.recordAt(expected.storageIdentity) === expected && destinationCurrent(),
  );
}

export async function releaseTransferredMessage(
  retired: ThreadOutboxRecord,
  transferred: QueuedThreadMessage,
  destinationCurrent: () => boolean,
): Promise<boolean> {
  // Transferring latest edits does not transfer a different original snapshot.
  if (retired.original && !sameOutboxContent(retired.original.localSnapshot, transferred))
    return false;
  return releaseCompletedContent(
    retired,
    () => destinationCurrent() && !hasPendingEditorDraft(transferred),
  );
}

/** A transport receipt retires even with newer edits; release is a separate decision. */
export async function retireAcknowledgedMessage(input: {
  readonly token: ThreadOutboxClaim;
  readonly receipt: DispatchResult;
  readonly submitted: QueuedThreadMessage;
}): Promise<ThreadOutboxRecord | null> {
  const retired = await threadOutboxManager.authority.retireAcknowledged(
    input.token,
    input.receipt,
  );
  if (retired === null) return null;
  await waitForComposerDraftsLoaded();
  if (
    retired.kind === "retired" &&
    retired.reason === "acknowledged" &&
    retired.retainedMessage !== undefined &&
    retired.original?.kind === "claim" &&
    sameOutboxContent(retired.retainedMessage, retired.original.localSnapshot)
  ) {
    await releaseCompletedContent(retired, () => !hasPendingEditorDraft(input.submitted));
  }
  return retired;
}
