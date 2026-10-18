import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import {
  flattenQueuedThreadMessages,
  groupQueuedThreadMessages,
  threadOutboxIdentity,
  threadOutboxStorageIdentity,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import type { ThreadOutboxStorage } from "./thread-outbox-storage";

export class ThreadOutboxManagerError extends Schema.TaggedError<ThreadOutboxManagerError>()(
  "ThreadOutboxManagerError",
  {
    operation: Schema.Literals([
      "load",
      "enqueue",
      "update",
      "remove",
      "clear-environment-load",
      "clear-environment-remove",
    ]),
    environmentId: Schema.NullOr(EnvironmentId),
    threadId: Schema.NullOr(ThreadId),
    messageId: Schema.NullOr(MessageId),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread outbox operation ${this.operation} failed for environment ${this.environmentId ?? "unknown"}, thread ${this.threadId ?? "unknown"}, message ${this.messageId ?? "unknown"}.`;
  }
}

export interface ThreadOutboxManagerOptions {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly storage: ThreadOutboxStorage;
  readonly warn?: (message: string, error: unknown) => void;
}

export function createThreadOutboxManager(options: ThreadOutboxManagerOptions) {
  const queuedMessagesByThreadKeyAtom = Atom.make<
    Record<string, ReadonlyArray<QueuedThreadMessage>>
  >({}).pipe(Atom.keepAlive, Atom.withLabel("mobile:thread-outbox:queued-messages"));
  const warn =
    options.warn ??
    ((message: string, error: unknown) => {
      console.warn(message, error);
    });
  let loadPromise: Promise<boolean> | null = null;
  let mutationQueue: Promise<void> = Promise.resolve();
  // Monotonic per-message write counter. Every accepted write (enqueue publish
  // or update) bumps it, so a writer that captured a revision before slow work
  // (an attachment upload) is rejected before its stale payload reaches disk.
  const revisions = new Map<string, number>();
  // Failed optimistic publications must not hide records on a later repaired
  // read. Only accepted local writes/removals override older disk snapshots.
  const committedMessages = new Map<string, QueuedThreadMessage | null>();
  const bumpRevision = (message: QueuedThreadMessage): void => {
    const identity = threadOutboxStorageIdentity(message);
    revisions.set(identity, (revisions.get(identity) ?? 0) + 1);
  };

  const serialize = <A>(mutation: () => Promise<A>): Promise<A> => {
    const result = mutationQueue.then(mutation, mutation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const currentMessages = (): ReadonlyArray<QueuedThreadMessage> =>
    flattenQueuedThreadMessages(options.registry.get(queuedMessagesByThreadKeyAtom));

  const setMessages = (messages: ReadonlyArray<QueuedThreadMessage>): void => {
    options.registry.set(queuedMessagesByThreadKeyAtom, groupQueuedThreadMessages(messages));
  };
  const targetIdentityIsOccupied = (message: QueuedThreadMessage): boolean => {
    const target = threadOutboxIdentity(message);
    const storage = threadOutboxStorageIdentity(message);
    return currentMessages().some(
      (candidate) =>
        threadOutboxIdentity(candidate) === target &&
        threadOutboxStorageIdentity(candidate) !== storage,
    );
  };

  // Readable messages can be used after a partial load. Only a complete load
  // returns true, so cleanup cannot delete files owned by unreadable records.
  // A later call retries failed reads without replacing live message objects.
  const load = (): Promise<boolean> => {
    if (loadPromise !== null) {
      return loadPromise;
    }
    loadPromise = serialize(async () => {
      const result = await options.storage.load();
      const current = currentMessages();
      const currentIds = new Set(current.map(threadOutboxStorageIdentity));
      const recovered = result.messages.filter(
        (message) =>
          !currentIds.has(threadOutboxStorageIdentity(message)) &&
          !committedMessages.has(threadOutboxStorageIdentity(message)),
      );
      for (const message of result.messages) {
        const identity = threadOutboxStorageIdentity(message);
        if (!committedMessages.has(identity)) committedMessages.set(identity, message);
      }
      // Accepted edits and removals win over a later disk read. Retaining
      // current objects also keeps retries from restarting the drain.
      if (recovered.length > 0) setMessages([...recovered, ...current]);
      if (result.errors.length > 0) {
        throw new AggregateError(result.errors, "Some queued messages could not be read.");
      }
      return true;
    }).catch((cause) => {
      loadPromise = null;
      warn(
        "[thread-outbox] failed to load persisted messages",
        new ThreadOutboxManagerError({
          operation: "load",
          environmentId: null,
          threadId: null,
          messageId: null,
          cause,
        }),
      );
      return false;
    });
    return loadPromise;
  };

  // The queued atom drives the composer's immediate "queued" feedback, so it
  // is published synchronously; the durable write happens behind it and rolls
  // the message back out if it fails (durability only matters for crash
  // recovery, not for the in-session queue).
  const enqueue = (message: QueuedThreadMessage): Promise<void> => {
    const previous = currentMessages().find(
      (candidate) =>
        threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
    );
    const cannotRequeue = previous !== undefined && previous.delivery?.state !== "ready";
    if (cannotRequeue || targetIdentityIsOccupied(message)) {
      return Promise.reject(
        new ThreadOutboxManagerError({
          operation: "enqueue",
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          cause: new Error(
            cannotRequeue
              ? "This queued identity cannot be submitted again. Preserve it for inspection."
              : "The target message identity is already queued.",
          ),
        }),
      );
    }
    bumpRevision(message);
    setMessages([
      ...currentMessages().filter(
        (candidate) =>
          threadOutboxStorageIdentity(candidate) !== threadOutboxStorageIdentity(message),
      ),
      message,
    ]);
    return serialize(async () => {
      // Optimistic presentation is not evidence that a durable slot is empty.
      // Read inside this mutation rather than awaiting load(), which would
      // enqueue behind this operation and deadlock.
      let persistedMessage: QueuedThreadMessage | undefined;
      try {
        const persisted = await options.storage.load();
        persistedMessage = persisted.messages.find(
          (candidate) =>
            threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
        );
        if (persisted.errors.length > 0) {
          throw new AggregateError(
            persisted.errors,
            "Outbox authority could not be read completely.",
          );
        }
        if (
          (persistedMessage !== undefined && persistedMessage.delivery?.state !== "ready") ||
          persisted.messages.some(
            (candidate) =>
              threadOutboxIdentity(candidate) === threadOutboxIdentity(message) &&
              threadOutboxStorageIdentity(candidate) !== threadOutboxStorageIdentity(message),
          )
        ) {
          throw new Error("Stored delivery authority does not permit this enqueue.");
        }
      } catch (cause) {
        const retained = currentMessages().filter((candidate) => candidate !== message);
        const identity = threadOutboxStorageIdentity(message);
        const authoritative =
          persistedMessage !== undefined && persistedMessage.delivery?.state !== "ready"
            ? persistedMessage
            : committedMessages.has(identity)
              ? committedMessages.get(identity)
              : persistedMessage;
        if (
          authoritative !== undefined &&
          authoritative !== null &&
          !retained.some(
            (candidate) =>
              threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
          )
        ) {
          retained.push(authoritative);
        }
        setMessages(retained);
        // Admission failure must never run failed-write removal: that would
        // delete the very fence which denied the incoming snapshot.
        throw new ThreadOutboxManagerError({
          operation: "enqueue",
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          cause,
        });
      }
      try {
        await options.storage.write(message);
        committedMessages.set(threadOutboxStorageIdentity(message), message);
      } catch (cause) {
        // Roll back by reference, not messageId: a retry enqueue with the same
        // id may have optimistically replaced this attempt while the write was
        // in flight, and its entry must survive this attempt's failure.
        setMessages(currentMessages().filter((candidate) => candidate !== message));
        // A concurrent update losing its post-write race compensates by
        // persisting this message's payload before this write settles. When
        // no same-id entry survives the rollback, drop that disk copy too, or
        // a restart resurrects a message the queue no longer holds.
        if (
          !currentMessages().some(
            (candidate) =>
              threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
          )
        ) {
          try {
            await options.storage.remove(message);
          } catch {
            // Best effort: bootstrap reconciles the queue against storage.
          }
        }
        throw new ThreadOutboxManagerError({
          operation: "enqueue",
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          cause,
        });
      }
    });
  };

  // Resolves once all pending mutations (including any in-flight enqueue
  // write) have settled, reporting whether the message is still queued. The
  // drain awaits this before dispatching so a message whose durable write
  // later fails can never have been delivered first.
  const confirmQueued = (message: QueuedThreadMessage): Promise<boolean> =>
    serialize(async () => currentMessages().some((candidate) => candidate === message));

  // Rewrites an already-queued message. A no-op when the message has been
  // removed in the meantime (e.g. deleted or delivered), so a trailing editor
  // flush can never resurrect it. Returns whether the message was updated.
  //
  // `expectedRevision` makes the update a compare-and-set: pass the revision
  // read before starting slow work, and the update is rejected before the
  // stale payload is persisted when any other write was accepted since. An
  // enqueue can still publish synchronously while the durable write below is
  // in flight, so the revision is re-checked after the write too; the stale
  // payload it just persisted is then overwritten with the winning payload
  // inside this mutation, so a crash before the winner's own serialized write
  // cannot leave stale state on disk.
  const update = (message: QueuedThreadMessage, expectedRevision?: number): Promise<boolean> =>
    serialize(async () => {
      const previous = currentMessages().find(
        (candidate) =>
          threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
      );
      if (
        previous === undefined ||
        (previous.delivery?.state !== "ready" &&
          (threadOutboxIdentity(previous) !== threadOutboxIdentity(message) ||
            previous.commandId !== message.commandId))
      ) {
        return false;
      }
      // Editor/upload snapshots own payload edits, not delivery authority.
      // Preserve even missing legacy metadata: it is not a fresh send grant.
      if (message.delivery !== previous.delivery) {
        const { delivery: _snapshotDelivery, ...edited } = message;
        message =
          previous.delivery === undefined ? edited : { ...edited, delivery: previous.delivery };
      }
      const staleOrMissing = (): boolean =>
        targetIdentityIsOccupied(message) ||
        !currentMessages().some(
          (candidate) =>
            threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
        ) ||
        (expectedRevision !== undefined &&
          (revisions.get(threadOutboxStorageIdentity(message)) ?? 0) !== expectedRevision);
      if (staleOrMissing()) {
        return false;
      }
      try {
        await options.storage.write(message);
      } catch (cause) {
        throw new ThreadOutboxManagerError({
          operation: "update",
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          cause,
        });
      }
      if (staleOrMissing()) {
        const winner = currentMessages().find(
          (candidate) =>
            threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
        );
        if (winner !== undefined) {
          try {
            await options.storage.write(winner);
          } catch {
            // The winner's own serialized write follows this mutation and
            // owns the failure handling for its payload.
          }
        }
        return false;
      }
      bumpRevision(message);
      committedMessages.set(threadOutboxStorageIdentity(message), message);
      setMessages([
        ...currentMessages().filter(
          (candidate) =>
            threadOutboxStorageIdentity(candidate) !== threadOutboxStorageIdentity(message),
        ),
        message,
      ]);
      return true;
    });

  // `expectedRevision` makes the removal a compare-and-set too: an edit
  // accepted after the caller decided to remove (restore-to-composer reads
  // the payload it is about to delete) keeps the newer message queued.
  // `canRemove` adds a live ownership check for state such as an open editor,
  // which can change without writing a new message revision.
  const remove = (
    message: QueuedThreadMessage,
    expectedRevision?: number,
    canRemove?: () => boolean,
  ): Promise<QueuedThreadMessage | null> =>
    serialize(async () => {
      const removalCanceled = (): boolean =>
        (expectedRevision !== undefined &&
          (revisions.get(threadOutboxStorageIdentity(message)) ?? 0) !== expectedRevision) ||
        canRemove?.() === false;
      if (removalCanceled()) {
        return null;
      }
      // The live payload may carry attachments an accepted update added after
      // the caller's snapshot; the caller releases files from what actually
      // leaves the queue.
      const removed =
        currentMessages().find(
          (candidate) =>
            threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
        ) ?? message;
      try {
        await options.storage.remove(message);
      } catch (cause) {
        throw new ThreadOutboxManagerError({
          operation: "remove",
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          cause,
        });
      }
      if (removalCanceled()) {
        // An enqueue or editor lock can win while storage removal is in
        // flight. Restore the live payload here, before any queued mutation
        // gets its turn, so this canceled removal is durable on its own.
        const winner = currentMessages().find(
          (candidate) =>
            threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
        );
        if (winner !== undefined) {
          try {
            await options.storage.write(winner);
          } catch (cause) {
            throw new ThreadOutboxManagerError({
              operation: "remove",
              environmentId: message.environmentId,
              threadId: message.threadId,
              messageId: message.messageId,
              cause,
            });
          }
        }
        return null;
      }
      setMessages(
        currentMessages().filter(
          (candidate) =>
            threadOutboxStorageIdentity(candidate) !== threadOutboxStorageIdentity(message),
        ),
      );
      // Tombstone, not delete: a same-id retry restarting at revision 1 would
      // otherwise match a stale writer's expectedRevision from before the
      // removal (ABA).
      bumpRevision(message);
      committedMessages.set(threadOutboxStorageIdentity(message), null);
      return removed;
    });

  const clearEnvironment = (
    environmentId: EnvironmentId,
  ): Promise<ReadonlyArray<QueuedThreadMessage>> => {
    // Enqueues publish before their serialized writes. Capture revisions now,
    // but wait for earlier mutations before reading messages: a message that
    // changes after this request must not enter the clear set.
    const revisionsAtRequest = new Map(revisions);
    return serialize(async () => {
      const persisted = await options.storage
        .load()
        .then((result) => {
          if (result.errors.length > 0) {
            throw new AggregateError(result.errors, "Some queued messages could not be read.");
          }
          return result.messages;
        })
        .catch((cause) => {
          throw new ThreadOutboxManagerError({
            operation: "clear-environment-load",
            environmentId,
            threadId: null,
            messageId: null,
            cause,
          });
        });
      const allMessages = flattenQueuedThreadMessages(
        groupQueuedThreadMessages([...persisted, ...currentMessages()]),
      );
      const candidates = allMessages.filter(
        (message) =>
          message.environmentId === environmentId &&
          (revisions.get(threadOutboxStorageIdentity(message)) ?? 0) ===
            (revisionsAtRequest.get(threadOutboxStorageIdentity(message)) ?? 0),
      );
      const candidateRevisions = new Map(
        candidates.map(
          (message) =>
            [
              threadOutboxStorageIdentity(message),
              revisions.get(threadOutboxStorageIdentity(message)) ?? 0,
            ] as const,
        ),
      );
      const removedFromStorage = new Set<string>();

      await Promise.all(
        candidates.map(async (message) => {
          try {
            await options.storage.remove(message);
            removedFromStorage.add(threadOutboxStorageIdentity(message));
          } catch (cause) {
            warn(
              "[thread-outbox] failed to clear persisted message",
              new ThreadOutboxManagerError({
                operation: "clear-environment-remove",
                environmentId: message.environmentId,
                threadId: message.threadId,
                messageId: message.messageId,
                cause,
              }),
            );
          }
        }),
      );

      // A same-id enqueue can publish while one of the removes above waits.
      // Put its payload back before the later serialized enqueue write runs.
      await Promise.all(
        candidates.map(async (message) => {
          if (
            !removedFromStorage.has(threadOutboxStorageIdentity(message)) ||
            (revisions.get(threadOutboxStorageIdentity(message)) ?? 0) ===
              candidateRevisions.get(threadOutboxStorageIdentity(message))
          ) {
            return;
          }
          const retained = currentMessages().find(
            (candidate) =>
              threadOutboxStorageIdentity(candidate) === threadOutboxStorageIdentity(message),
          );
          if (retained === undefined) {
            return;
          }
          try {
            await options.storage.write(retained);
          } catch (cause) {
            warn(
              "[thread-outbox] failed to restore message retained during environment clear",
              new ThreadOutboxManagerError({
                operation: "clear-environment-remove",
                environmentId: retained.environmentId,
                threadId: retained.threadId,
                messageId: retained.messageId,
                cause,
              }),
            );
          }
        }),
      );

      const removed = candidates.filter(
        (message) =>
          removedFromStorage.has(threadOutboxStorageIdentity(message)) &&
          (revisions.get(threadOutboxStorageIdentity(message)) ?? 0) ===
            candidateRevisions.get(threadOutboxStorageIdentity(message)),
      );
      const removedMessageIds = new Set(removed.map(threadOutboxStorageIdentity));
      const reconciledMessages = flattenQueuedThreadMessages(
        groupQueuedThreadMessages([...allMessages, ...currentMessages()]),
      ).filter((message) => !removedMessageIds.has(threadOutboxStorageIdentity(message)));
      for (const message of removed) {
        bumpRevision(message);
        committedMessages.set(threadOutboxStorageIdentity(message), null);
      }
      setMessages(reconciledMessages);
      // The caller releases these messages' attachment files; reporting what
      // was actually removed keeps the release set honest even when this
      // function's own load produced the messages.
      return removed;
    });
  };

  return {
    queuedMessagesByThreadKeyAtom,
    serialize,
    load,
    enqueue,
    confirmQueued,
    /** Current write revision for a queued message; input to update's CAS. */
    revisionOf: (message: QueuedThreadMessage): number =>
      revisions.get(threadOutboxStorageIdentity(message)) ?? 0,
    update,
    remove,
    clearEnvironment,
  };
}
