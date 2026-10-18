import { pendingTaskDraftKey } from "./pending-task-identity";
import { capturePendingTaskEditorWriteBaseline } from "./pending-task-editor-writes";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { holdEditingQueuedMessage } from "./use-thread-outbox";
import { threadOutboxManager } from "./thread-outbox";
import { threadOutboxIdentity } from "./thread-outbox-model";
import {
  clearComposerDraft,
  flushComposerDrafts,
  getComposerDraftSnapshot,
  isComposerDraftEmpty,
  restoreComposerDraftSnapshot,
  sameComposerDraftState,
  waitForComposerDraftsLoaded,
} from "./use-composer-drafts";

type Session = {
  readonly key: string;
  readonly baseline: ReturnType<typeof capturePendingTaskEditorWriteBaseline>;
  readonly release: () => void;
  readonly detach: () => void;
  readonly isAlone: () => boolean;
};

// Dismissed, unsaved work still owns a lease. A new editor takes over only
// after acquiring its own independent lease; an older save cannot release it.
const active = new Map<string, Set<symbol>>();
const retained = new Map<string, Set<() => void>>();

export function beginPendingTaskEditorSession(message: QueuedThreadMessage): Session | null {
  const releaseLease = holdEditingQueuedMessage(message);
  if (releaseLease === null) return null;
  const key = pendingTaskDraftKey(message);
  const token = Symbol("pending-task-session");
  const sessions = active.get(key) ?? new Set<symbol>();
  sessions.add(token);
  active.set(key, sessions);
  for (const release of retained.get(key) ?? []) release();
  retained.delete(key);
  const baseline = capturePendingTaskEditorWriteBaseline(message);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    sessions.delete(token);
    if (sessions.size === 0 && active.get(key) === sessions) active.delete(key);
    retained.get(key)?.delete(release);
    releaseLease();
  };
  return {
    key,
    baseline,
    release,
    detach: () => {
      if (released) return;
      sessions.delete(token);
      if (sessions.size === 0 && active.get(key) === sessions) active.delete(key);
      const holds = retained.get(key) ?? new Set<() => void>();
      holds.add(release);
      retained.set(key, holds);
    },
    isAlone: () => {
      const current = active.get(key);
      return current === undefined || (current.size === 1 && current.has(token));
    },
  };
}

/** A legacy slot is migrated only with one exact durable owner, never one environment. */
export async function initializePendingTaskEditorDraft(
  message: QueuedThreadMessage,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  await waitForComposerDraftsLoaded();
  const complete = await threadOutboxManager.load();
  const key = pendingTaskDraftKey(message);
  const before = getComposerDraftSnapshot(key);
  if (!isCurrent() || !isComposerDraftEmpty(before)) return;
  const canRestore = () =>
    isCurrent() && sameComposerDraftState(before, getComposerDraftSnapshot(key));
  const legacyKey = `pending-task:${message.messageId}`;
  const legacy = getComposerDraftSnapshot(legacyKey);
  const owners = threadOutboxManager.authority
    .knownRecords()
    .filter((record) => record.storageIdentity.messageId === message.messageId);
  const unique =
    complete &&
    owners.length === 1 &&
    threadOutboxIdentity(owners[0]?.storageIdentity ?? message) ===
      threadOutboxIdentity(message.storageIdentity ?? message);
  if (unique && !isComposerDraftEmpty(legacy)) {
    await restoreComposerDraftSnapshot(key, legacy, canRestore);
    // Keep both on a failed/uncertain destination write or any newer legacy edit.
    if (
      sameComposerDraftState(legacy, getComposerDraftSnapshot(key)) &&
      sameComposerDraftState(legacy, getComposerDraftSnapshot(legacyKey))
    ) {
      clearComposerDraft(legacyKey, { deferAttachmentCleanup: true });
      await flushComposerDrafts();
    }
    return;
  }
  const creation = message.creation;
  if (creation === undefined) return;
  await restoreComposerDraftSnapshot(
    key,
    {
      text: message.text,
      attachments: message.attachments,
      ...(message.context === undefined ? {} : { context: message.context }),
      ...(message.modelSelection === undefined ? {} : { modelSelection: message.modelSelection }),
      ...(message.runtimeMode === undefined ? {} : { runtimeMode: message.runtimeMode }),
      ...(message.interactionMode === undefined
        ? {}
        : { interactionMode: message.interactionMode }),
      workspaceSelection: {
        mode: creation.workspaceMode,
        branch: creation.branch,
        worktreePath: creation.worktreePath,
        startFromOrigin: creation.startFromOrigin ?? false,
      },
    },
    canRestore,
  );
}
