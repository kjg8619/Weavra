import { PROVIDER_SEND_TURN_MAX_ATTACHMENTS } from "@t3tools/contracts";
import { scopedThreadKey } from "../lib/scopedEntities";
import { restoredNewTaskDraftKey } from "./new-task-draft-key";
import { recordPendingThreadCreationOutcome } from "./pending-thread-creation";
import { threadOutboxManager } from "./thread-outbox";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { canPrepareQueuedMessage } from "./thread-outbox-preparation";
import { retireTransferredMessage, releaseTransferredMessage } from "./thread-outbox-removal";
import { holdEditingQueuedMessage } from "./use-thread-outbox";
import {
  flushComposerDrafts,
  getComposerDraftSnapshot,
  mergeComposerDraftContent,
  sameComposerDraftState,
  undoComposerDraftMerge,
  updateComposerDraftSettings,
  waitForComposerDraftsLoaded,
} from "./use-composer-drafts";
import { setPendingConnectionError } from "./use-remote-environment-registry";

/** Only provably unattempted content may be restored automatically. */
export async function restoreRejectedQueuedMessage(
  message: QueuedThreadMessage,
  reason: string,
  scopeCurrent: () => boolean = () => true,
): Promise<"restored" | "deferred" | "blocked" | "retry"> {
  const expected = threadOutboxManager.recordFor(message);
  if (expected === null || !canPrepareQueuedMessage(expected) || !scopeCurrent()) return "deferred";
  const release = holdEditingQueuedMessage(message);
  if (release === null) return "deferred";
  const key = message.creation
    ? restoredNewTaskDraftKey(message)
    : scopedThreadKey(message.environmentId, message.threadId);
  let rollback: {
    readonly before: ReturnType<typeof getComposerDraftSnapshot>;
    readonly after: ReturnType<typeof getComposerDraftSnapshot>;
  } | null = null;
  try {
    await waitForComposerDraftsLoaded();
    if (!scopeCurrent() || threadOutboxManager.recordFor(message) !== expected) return "deferred";
    const before = getComposerDraftSnapshot(key);
    const ids = new Set(
      [...before.attachments, ...message.attachments].map((attachment) => attachment.id),
    );
    if (ids.size > PROVIDER_SEND_TURN_MAX_ATTACHMENTS) return "blocked";
    try {
      await mergeComposerDraftContent(key, message);
    } finally {
      rollback = { before, after: getComposerDraftSnapshot(key) };
    }
    updateComposerDraftSettings(key, {
      ...(message.modelSelection ? { modelSelection: message.modelSelection } : {}),
      ...(message.runtimeMode ? { runtimeMode: message.runtimeMode } : {}),
      ...(message.interactionMode ? { interactionMode: message.interactionMode } : {}),
      ...(message.creation
        ? {
            project: {
              environmentId: message.environmentId,
              projectId: message.creation.projectId,
              createdAt: message.createdAt,
            },
            workspaceSelection: {
              mode: message.creation.workspaceMode,
              branch: message.creation.branch,
              worktreePath: message.creation.worktreePath,
              startFromOrigin: message.creation.startFromOrigin ?? false,
            },
          }
        : {}),
    });
    const destination = getComposerDraftSnapshot(key);
    rollback = { before, after: destination };
    await flushComposerDrafts();
    const current = () =>
      scopeCurrent() && sameComposerDraftState(destination, getComposerDraftSnapshot(key));
    const retired = await retireTransferredMessage(expected, current);
    if (retired === null) return "deferred";
    rollback = null;
    release();
    await releaseTransferredMessage(retired, message, current);
    if (message.creation) recordPendingThreadCreationOutcome({ kind: "failed", message, reason });
    setPendingConnectionError(reason);
    return "restored";
  } catch (error) {
    console.warn("[thread-outbox] draft transfer failed; source retained", error);
    return "retry";
  } finally {
    try {
      if (rollback !== null) {
        await undoComposerDraftMerge(key, rollback.before, rollback.after).catch(
          (error: unknown) => {
            // The source still owns every byte. Report a failed rollback write;
            // the in-memory rollback has already preserved subsequent typing.
            console.warn("[thread-outbox] could not persist draft transfer rollback", error);
          },
        );
      }
    } finally {
      release();
    }
  }
}
