import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";
import { scopedThreadKey } from "../lib/scopedEntities";
import { appAtomRegistry } from "./atom-registry";
import {
  confirmThreadOutboxMessageQueued,
  threadOutboxStorageIdentity,
  type QueuedThreadMessage,
} from "./thread-outbox";
import { retireTransferredMessage, releaseTransferredMessage } from "./thread-outbox-removal";
import {
  flushComposerDrafts,
  getComposerDraftSnapshot,
  sameComposerDraftState,
  mergeComposerDraftContent,
  undoComposerDraftMerge,
  updateComposerDraftSettings,
  waitForComposerDraftsLoaded,
} from "./use-composer-drafts";
import {
  dispatchingQueuedMessageIdAtom,
  editingQueuedMessageIdsAtom,
  holdEditingQueuedMessage,
} from "./use-thread-outbox";

/** Take delivery ownership before any await; the durable draft then takes ownership of the files. */
export async function editPendingThreadMessage(message: QueuedThreadMessage): Promise<boolean> {
  if (
    message.creation ||
    appAtomRegistry.get(dispatchingQueuedMessageIdAtom) === threadOutboxStorageIdentity(message) ||
    appAtomRegistry.get(editingQueuedMessageIdsAtom)[threadOutboxStorageIdentity(message)]
  ) {
    return false;
  }
  const release = holdEditingQueuedMessage(message);
  if (release === null) return false;
  const draftKey = scopedThreadKey(message.environmentId, message.threadId);
  let rollback: {
    snapshot: ReturnType<typeof getComposerDraftSnapshot>;
    merged: ReturnType<typeof getComposerDraftSnapshot>;
  } | null = null;
  try {
    const expected = await confirmThreadOutboxMessageQueued(message);
    // Uncertain/refused content stays in the outbox. Moving it into an ordinary
    // composer would also grant that composer's background upload worker access.
    // Explicit native recovery has its own source marker and later UI activation.
    if (expected === null || expected.kind !== "message" || expected.delivery.state !== "ready")
      return false;
    await waitForComposerDraftsLoaded();
    const snapshot = getComposerDraftSnapshot(draftKey);
    const attachmentIds = new Set(snapshot.attachments.map((attachment) => attachment.id));
    for (const attachment of message.attachments) attachmentIds.add(attachment.id);
    if (attachmentIds.size > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      throw new Error("Remove attachments from the composer before editing this message.");
    }
    try {
      await mergeComposerDraftContent(draftKey, message);
    } finally {
      rollback = { snapshot, merged: getComposerDraftSnapshot(draftKey) };
    }
    updateComposerDraftSettings(draftKey, {
      ...(message.modelSelection ? { modelSelection: message.modelSelection } : {}),
      ...(message.runtimeMode ? { runtimeMode: message.runtimeMode } : {}),
      ...(message.interactionMode ? { interactionMode: message.interactionMode } : {}),
    });
    rollback = { snapshot, merged: getComposerDraftSnapshot(draftKey) };
    await flushComposerDrafts();
    const destination = getComposerDraftSnapshot(draftKey);
    const destinationCurrent = () =>
      sameComposerDraftState(destination, getComposerDraftSnapshot(draftKey));
    const retired = await retireTransferredMessage(expected, destinationCurrent);
    if (retired === null) return false;
    rollback = null;
    release();
    await releaseTransferredMessage(retired, message, destinationCurrent);
    return true;
  } finally {
    try {
      if (rollback) await undoComposerDraftMerge(draftKey, rollback.snapshot, rollback.merged);
    } finally {
      release();
    }
  }
}
