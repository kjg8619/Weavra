import { stableStringify } from "@t3tools/shared/relaySigning";
import { Atom, type AtomRegistry } from "effect/unstable/reactivity";

import { createThreadOutboxAuthority } from "./thread-outbox-authority";
import {
  groupQueuedThreadMessages,
  threadOutboxIdentity,
  threadOutboxStorageIdentity,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import { ownedThreadOutboxPayloads, type ThreadOutboxRecord } from "./thread-outbox-record";
import type { ThreadOutboxRecordStorage } from "./thread-outbox-storage";
import { optimisticThreadOutboxOwnersAtom } from "./thread-outbox-ownership";

type Content = Omit<QueuedThreadMessage, "delivery" | "storageIdentity">;

export function createThreadOutboxRecordManager(options: {
  readonly registry: AtomRegistry.AtomRegistry;
  readonly storage: ThreadOutboxRecordStorage;
  readonly accountId: string | null;
  readonly warn?: (message: string, cause: unknown) => void;
}) {
  const queuedMessagesByThreadKeyAtom = Atom.make<
    Record<string, ReadonlyArray<QueuedThreadMessage>>
  >({}).pipe(Atom.keepAlive, Atom.withLabel("mobile:thread-outbox:queued-messages"));
  const unassignedRecordCountAtom = Atom.make(0).pipe(
    Atom.keepAlive,
    Atom.withLabel("mobile:thread-outbox:unassigned-record-count"),
  );
  const inventoryReadyAtom = Atom.make(false).pipe(
    Atom.keepAlive,
    Atom.withLabel("mobile:thread-outbox:inventory-ready"),
  );
  let accountId = options.accountId;
  let mutationQueue: Promise<void> = Promise.resolve();
  // Disposable presentation cache, never a source of mutation or delivery authority.
  const projections = new Map<
    string,
    { readonly record: ThreadOutboxRecord; readonly message: QueuedThreadMessage }
  >();
  // Keep every pending owner's files, including superseded or hidden overlays.
  const overlays = new Map<
    symbol,
    {
      readonly message: QueuedThreadMessage;
      readonly ownerAccountId: string | null;
      failed: boolean;
    }
  >();

  // Unassigned legacy ownership is not inferred from the current account.
  const ownerVisible = (owner: string | null | undefined): boolean =>
    owner === null || (owner !== undefined && owner === accountId);

  // Authority operations already enter this queue. Never enqueue an operation
  // which awaits another authority operation: that would wait on itself.
  const serialize = <A>(mutation: () => Promise<A>): Promise<A> => {
    const result = mutationQueue.then(async () => {
      try {
        return await mutation();
      } finally {
        // Partial hydration and partial account transitions also change what
        // is known. Publication does not certify inventory completeness.
        publish();
      }
    });
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  const authority = createThreadOutboxAuthority({ storage: options.storage, serialize });

  /** Storage lineage lookup, including hidden records; not a UI/account authorization check. */
  const recordAt = (identity: ThreadOutboxRecord["storageIdentity"]): ThreadOutboxRecord | null => {
    const key = threadOutboxIdentity(identity);
    return (
      authority
        .knownRecords()
        .find((record) => threadOutboxIdentity(record.storageIdentity) === key) ?? null
    );
  };

  function publish(): void {
    options.registry.set(inventoryReadyAtom, authority.inventoryComplete());
    options.registry.set(
      optimisticThreadOutboxOwnersAtom,
      [...overlays.values()].map((overlay) => overlay.message),
    );
    const records = authority.knownRecords();
    const occupiedIdentities = new Set<string>();
    const occupiedCommands = new Set<string>();
    const visibleKeys = new Set<string>();
    const messages: QueuedThreadMessage[] = [];
    let unassigned = 0;
    for (const record of records) {
      occupiedIdentities.add(threadOutboxIdentity(record.storageIdentity));
      occupiedIdentities.add(threadOutboxIdentity(record.transport));
      occupiedCommands.add(
        JSON.stringify([record.transport.environmentId, record.transport.commandId]),
      );
      const content = record.kind === "message" ? record.message : record.retainedMessage;
      if (
        content !== undefined &&
        record.archivedFor === undefined &&
        record.ownerAccountId === undefined
      ) {
        unassigned += 1;
      }
      if (
        content === undefined ||
        record.archivedFor !== undefined ||
        !ownerVisible(record.ownerAccountId)
      ) {
        continue;
      }
      const key = threadOutboxIdentity(record.storageIdentity);
      visibleKeys.add(key);
      const previous = projections.get(key);
      // A repaired inventory may decode equal bytes into a new CAS object.
      // Preserve the row reference, but always expose the actual new record.
      const message =
        previous !== undefined &&
        (previous.record === record || stableStringify(previous.record) === stableStringify(record))
          ? previous.message
          : {
              ...content,
              storageIdentity: record.storageIdentity,
              delivery:
                record.kind === "retired" && record.delivery.state === "ready"
                  ? { state: "unknown" as const }
                  : record.delivery,
            };
      projections.set(key, { record, message });
      messages.push(message);
    }
    for (const key of projections.keys()) {
      if (!visibleKeys.has(key)) projections.delete(key);
    }
    // Known authority wins even when it is parked, foreign, or a bare marker.
    // An overlay can own content, but cannot hide a discovered durable fence.
    for (const overlay of overlays.values()) {
      const message = overlay.message;
      if (
        !overlay.failed &&
        ownerVisible(overlay.ownerAccountId) &&
        !occupiedIdentities.has(threadOutboxStorageIdentity(message)) &&
        !occupiedIdentities.has(threadOutboxIdentity(message)) &&
        !occupiedCommands.has(JSON.stringify([message.environmentId, message.commandId]))
      ) {
        messages.push(message);
      }
    }
    const next = groupQueuedThreadMessages(messages);
    const previous = options.registry.get(queuedMessagesByThreadKeyAtom);
    let changed = Object.keys(previous).length !== Object.keys(next).length;
    for (const [key, queue] of Object.entries(next)) {
      const before = previous[key];
      if (
        before !== undefined &&
        before.length === queue.length &&
        before.every((message, index) => message === queue[index])
      ) {
        next[key] = before;
      } else {
        changed = true;
      }
    }
    if (changed) options.registry.set(queuedMessagesByThreadKeyAtom, next);
    if (options.registry.get(unassignedRecordCountAtom) !== unassigned) {
      options.registry.set(unassignedRecordCountAtom, unassigned);
    }
  }

  /** Exact current UI object only; an overlay or copied payload has no CAS authority. */
  const recordFor = (message: QueuedThreadMessage): ThreadOutboxRecord | null => {
    const projection = projections.get(threadOutboxStorageIdentity(message));
    return projection?.message === message ? projection.record : null;
  };

  /** The returned row belongs to this committed record, not the caller's edit object. */
  const messageFor = (record: ThreadOutboxRecord): QueuedThreadMessage | null => {
    const projection = projections.get(threadOutboxIdentity(record.storageIdentity));
    return projection?.record === record ? projection.message : null;
  };

  const enqueueNew = (input: Content, ownerAccountId: string | null) => {
    const fingerprint = (content: Content) =>
      stableStringify({
        ...content,
        attachments: content.attachments.map((attachment) => {
          const {
            uploadedAttachmentId: _uploaded,
            uploadEnvironmentId: _environment,
            ...local
          } = attachment;
          return local;
        }),
      });
    const expected = fingerprint(input);
    const pendingUploads = input.attachments.flatMap((attachment) =>
      attachment.uploadedAttachmentId === undefined
        ? []
        : [
            [
              attachment.id,
              attachment.uploadedAttachmentId,
              attachment.uploadEnvironmentId,
            ] as const,
          ],
    );
    const token = Symbol("outbox-enqueue");
    const overlay = {
      ownerAccountId,
      failed: false,
      message: {
        ...input,
        storageIdentity: {
          environmentId: input.environmentId,
          threadId: input.threadId,
          messageId: input.messageId,
        },
        delivery: { state: "unknown" as const },
      },
    };
    overlays.set(token, overlay);
    // The composer clears its draft in this same stack. Publish ownership now,
    // not after hydration, and never publish speculative delivery permission.
    publish();
    const committed = authority.admitNew(input, ownerAccountId).then(
      (record) => {
        overlays.delete(token);
        publish();
        return record;
      },
      (cause: unknown) => {
        overlay.failed = true;
        publish();
        throw cause;
      },
    );
    const releaseAfterHandback = (): boolean => {
      if (!overlay.failed || !overlays.delete(token)) return false;
      publish();
      return true;
    };
    return {
      committed,
      /** Admission receipts alone do not own bytes, especially after content release. */
      releaseAfterRecordOwnership: (): Promise<boolean> =>
        serialize(async () => {
          if (!authority.inventoryComplete() || !ownerVisible(ownerAccountId)) return false;
          const record = recordAt(overlay.message.storageIdentity);
          if (
            record === null ||
            record.ownerAccountId !== ownerAccountId ||
            record.archivedFor !== undefined ||
            record.transport.commandId !== overlay.message.commandId ||
            threadOutboxIdentity(record.transport) !== threadOutboxIdentity(overlay.message) ||
            !ownedThreadOutboxPayloads(record).some(
              (content) =>
                fingerprint(content) === expected &&
                pendingUploads.every(([id, uploadedId, environmentId]) =>
                  content.attachments.some(
                    (attachment) =>
                      attachment.id === id &&
                      attachment.uploadedAttachmentId === uploadedId &&
                      attachment.uploadEnvironmentId === environmentId,
                  ),
                ),
            )
          )
            return false;
          // No await between authoritative ownership and releasing this operation's overlay.
          return releaseAfterHandback();
        }),
      /** Read-only admission status, not file ownership; never releases or replaces intent. */
      reconcile: async (): Promise<"committed" | "absent" | "unknown"> => {
        try {
          await authority.load();
        } catch {
          return "unknown";
        }
        return serialize(async () => {
          if (!ownerVisible(ownerAccountId) || !authority.inventoryComplete()) return "unknown";
          const record = recordAt(overlay.message.storageIdentity);
          if (record === null) {
            const occupied = authority
              .knownRecords()
              .some(
                (candidate) =>
                  (candidate.transport.environmentId === overlay.message.environmentId &&
                    candidate.transport.commandId === overlay.message.commandId) ||
                  threadOutboxIdentity(candidate.transport) ===
                    threadOutboxIdentity(overlay.message),
              );
            return occupied ? "unknown" : "absent";
          }
          if (
            record.archivedFor !== undefined ||
            record.ownerAccountId !== ownerAccountId ||
            record.transport.commandId !== overlay.message.commandId ||
            threadOutboxIdentity(record.transport) !== threadOutboxIdentity(overlay.message)
          )
            return "unknown";
          const latest = record.kind === "message" ? record.message : record.retainedMessage;
          return [latest, record.original?.localSnapshot].some(
            (content) => content !== undefined && fingerprint(content) === expected,
          )
            ? "committed"
            : "unknown";
        });
      },
      /** Call only after rejected content is restored or explicitly retained elsewhere. */
      releaseAfterHandback,
    };
  };

  return {
    queuedMessagesByThreadKeyAtom,
    unassignedRecordCountAtom,
    inventoryReadyAtom,
    // Full records and original operation results stay intact. Every async
    // authority operation publishes through the one owner serializer above.
    authority,
    recordAt,
    recordFor,
    messageFor,
    // Claim persistence replaces authority before the serializer publishes its
    // row. Visibility must not depend on that presentation lag.
    isVisible: (record: ThreadOutboxRecord): boolean =>
      record.archivedFor === undefined &&
      ownerVisible(record.ownerAccountId) &&
      (record.kind === "message" || record.retainedMessage !== undefined),
    canPrepare: (record: ThreadOutboxRecord): boolean =>
      ownerVisible(record.ownerAccountId) && authority.canPrepare(record),
    enqueueNew,
    /** Positive refusal retires transport only; original/latest/editor content stays owned. */
    retireRefused: async (
      message: QueuedThreadMessage,
      evidence: Parameters<typeof authority.recordRefusal>[1],
    ): Promise<ThreadOutboxRecord | null> => {
      const expected = recordFor(message);
      if (expected === null) return null;
      const refused = await authority.recordRefusal(expected.storageIdentity, evidence);
      if (refused === null) return null;
      // Use the lineage, not the pre-await payload: an editor may have committed
      // newer content between recording refusal and terminal retirement.
      return authority.retire(refused.storageIdentity, "confirmed-refusal");
    },
    load: (): Promise<boolean> =>
      authority.load().then(
        () => true,
        (cause: unknown) => {
          (options.warn ?? console.warn)("[thread-outbox] inventory load failed", cause);
          return false;
        },
      ),
    flush: (): Promise<void> => serialize(async () => {}),
    // Confirmation is content/CAS ownership, not readiness or permission to send.
    confirmQueued: (message: QueuedThreadMessage): Promise<ThreadOutboxRecord | null> =>
      serialize(async () => recordFor(message)),
    // Attachment sweeps must include these even when an overlay is not visible.
    optimisticMessages: (): ReadonlyArray<QueuedThreadMessage> =>
      [...overlays.values()].map((overlay) => overlay.message),
    setAccountId: (next: string | null): void => {
      accountId = next;
      publish();
    },
  };
}
