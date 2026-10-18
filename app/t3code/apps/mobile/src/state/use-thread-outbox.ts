import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentShellStatus } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { appAtomRegistry } from "./atom-registry";
import { environmentShell } from "./shell";
import { threadOutboxManager } from "./thread-outbox";
import { threadOutboxStorageIdentity, type QueuedThreadMessage } from "./thread-outbox-model";
import { currentThreadOutboxPresentation } from "./thread-outbox-presentation";

const threadOutboxShellStatusesAtom = Atom.make(
  (get): ReadonlyMap<EnvironmentId, EnvironmentShellStatus> => {
    const statuses = new Map<EnvironmentId, EnvironmentShellStatus>();
    for (const queue of Object.values(get(threadOutboxManager.queuedMessagesByThreadKeyAtom))) {
      const environmentId = queue[0]?.environmentId;
      if (environmentId !== undefined && !statuses.has(environmentId)) {
        statuses.set(environmentId, get(environmentShell.stateValueAtom(environmentId)).status);
      }
    }
    return statuses;
  },
).pipe(Atom.withLabel("mobile:thread-outbox:shell-statuses"));

/**
 * Queued pending tasks the outbox drain must not deliver right now: the one
 * open in the new-task editor, plus any whose latest edits could not be saved
 * back yet (delivering those would send stale content). Editing sessions hold
 * their message id here and release it once the queued payload is current.
 */
export const editingQueuedMessageIdsAtom = Atom.make<Readonly<Record<string, true>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:thread-outbox:editing-message-ids"),
);

export const dispatchingQueuedMessageIdAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:thread-outbox:dispatching-message-id"),
);

const editorLeases = new Map<string, Set<symbol>>();

/** Each caller owns its own release handle; presentation never grants authority. */
export function holdEditingQueuedMessage(message: QueuedThreadMessage): (() => void) | null {
  const record = threadOutboxManager.recordFor(message);
  if (record === null) return null;
  const key = threadOutboxStorageIdentity(message);
  const release = threadOutboxManager.authority.acquireEditor(record, () => true);
  if (release === null) return null;
  const leases = editorLeases.get(key) ?? new Set<symbol>();
  const token = Symbol("pending-editor");
  leases.add(token);
  editorLeases.set(key, leases);
  appAtomRegistry.set(editingQueuedMessageIdsAtom, {
    ...appAtomRegistry.get(editingQueuedMessageIdsAtom),
    [key]: true,
  });
  return () => {
    if (!leases.delete(token)) return;
    release();
    if (leases.size > 0) return;
    editorLeases.delete(key);
    const next = { ...appAtomRegistry.get(editingQueuedMessageIdsAtom) };
    delete next[key];
    appAtomRegistry.set(editingQueuedMessageIdsAtom, next);
  };
}

export const unassignedRecordCountAtom = threadOutboxManager.unassignedRecordCountAtom;

export function useThreadOutboxMessages() {
  return useAtomValue(threadOutboxManager.queuedMessagesByThreadKeyAtom);
}

/**
 * Thread keys (`environmentId:threadId`) of existing threads with a message
 * waiting in the outbox. Creations are excluded: they have no thread row yet
 * and surface as pending tasks instead. Derived once so list builders and
 * reorder planners agree on which settled threads are pulled back to active.
 */
export const queuedThreadKeysAtom = Atom.make((get): ReadonlySet<string> => {
  const keys = new Set<string>();
  for (const [threadKey, queue] of Object.entries(
    get(threadOutboxManager.queuedMessagesByThreadKeyAtom),
  )) {
    if (
      queue.some(
        (message) =>
          message.creation === undefined &&
          currentThreadOutboxPresentation(message).kind === "ready",
      )
    ) {
      keys.add(threadKey);
    }
  }
  return keys;
}).pipe(Atom.withLabel("mobile:thread-outbox:queued-thread-keys"));

export function useQueuedThreadKeys(): ReadonlySet<string> {
  return useAtomValue(queuedThreadKeysAtom);
}

export function useThreadOutboxShellStatuses() {
  return useAtomValue(threadOutboxShellStatusesAtom);
}
