import * as Schema from "effect/Schema";
import {
  OrchestrationMessage,
  type EnvironmentId,
  type DispatchResult,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { decodeTurnStartRefusal } from "@t3tools/client-runtime/state/turnStartRefusal";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { threadOutboxIdentity, type QueuedThreadMessage } from "./thread-outbox-model";
import {
  decodeThreadOutboxRecord,
  encodeThreadOutboxRecord,
  ownedThreadOutboxPayloads,
  type ThreadOutboxRecord,
} from "./thread-outbox-record";
import type { ThreadOutboxRecordStorage } from "./thread-outbox-storage";

type Invocation = Extract<
  NonNullable<ThreadOutboxRecord["original"]>,
  { kind: "claim" }
>["invocation"];
type RetirementReason = Extract<ThreadOutboxRecord, { kind: "retired" }>["reason"];
type Content = Omit<QueuedThreadMessage, "delivery" | "storageIdentity">;
export type ThreadOutboxArchiveResult = {
  readonly status: "imported" | "duplicate" | "obsolete" | "conflict";
  readonly record: ThreadOutboxRecord | null;
};
function ownedContent(value: Content): string {
  return stableStringify({
    ...value,
    attachments: value.attachments.map(
      ({ uploadedAttachmentId: _upload, uploadEnvironmentId: _environment, ...attachment }) =>
        attachment,
    ),
  });
}
const claimBrand = Symbol("thread-outbox-claim");
const decodeSourceMessage = Schema.decodeUnknownSync(Schema.toType(OrchestrationMessage), {
  onExcessProperty: "error",
});
export interface ThreadOutboxClaim {
  readonly [claimBrand]: true;
}

export class ThreadOutboxAuthorityError extends Schema.TaggedError<ThreadOutboxAuthorityError>()(
  "ThreadOutboxAuthorityError",
  {
    reason: Schema.Literals([
      "inventory-incomplete",
      "identity-occupied",
      "write-failed",
      "environment-parked",
    ]),
    identity: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {}

/** Uses its owner's mutation queue; it does not create a second serializer. */
export function createThreadOutboxAuthority(options: {
  readonly storage: ThreadOutboxRecordStorage;
  readonly serialize: <A>(mutation: () => Promise<A>) => Promise<A>;
}) {
  const records = new Map<string, ThreadOutboxRecord>();
  const editors = new Map<string, Set<symbol>>();
  const reserved = new Set<string>();
  const uncertainClaims = new Map<string, ThreadOutboxRecord>();
  const revoked = new Set<string>();
  const suspendedEnvironments = new Map<EnvironmentId, Map<string, number>>();
  let accountTransition = 0;
  const claims = new WeakMap<
    ThreadOutboxClaim,
    {
      readonly record: ThreadOutboxRecord;
      readonly invocation: Invocation;
      readonly canInvoke: () => boolean;
    }
  >();
  const invoked = new WeakMap<ThreadOutboxClaim, ThreadOutboxRecord>();
  let complete = false;

  const suspendAccount = (accountId: string, scope: ReadonlySet<EnvironmentId>): number => {
    accountTransition += 1;
    for (const environmentId of scope) {
      const owners = suspendedEnvironments.get(environmentId) ?? new Map<string, number>();
      owners.set(accountId, accountTransition);
      suspendedEnvironments.set(environmentId, owners);
    }
    return accountTransition;
  };
  const accountSuspended = (
    environmentId: EnvironmentId,
    owner: string | null | undefined,
  ): boolean => {
    const owners = suspendedEnvironments.get(environmentId);
    if (owner === null) return false;
    return owner === undefined ? (owners?.size ?? 0) > 0 : owners?.has(owner) === true;
  };

  const observe = (record: ThreadOutboxRecord): void => {
    const key = threadOutboxIdentity(record.storageIdentity);
    const before = uncertainClaims.get(key);
    if (
      before !== undefined &&
      (record.kind === "retired" ||
        record.delivery.state !== "ready" ||
        JSON.stringify(encodeThreadOutboxRecord(record)) ===
          JSON.stringify(encodeThreadOutboxRecord(before)))
    )
      uncertainClaims.delete(key);
    records.set(key, record);
  };

  const occupied = (
    transport: ThreadOutboxRecord["transport"],
    except?: ThreadOutboxRecord,
  ): boolean => {
    const key = threadOutboxIdentity(transport);
    return [...records.values()].some(
      (existing) =>
        existing !== except &&
        (threadOutboxIdentity(existing.storageIdentity) === key ||
          threadOutboxIdentity(existing.transport) === key ||
          (existing.transport.environmentId === transport.environmentId &&
            existing.transport.commandId === transport.commandId)),
    );
  };

  const hydrate = async (): Promise<void> => {
    if (complete && uncertainClaims.size === 0) return;
    const loaded = await options.storage.loadRecords();
    for (const record of loaded.records) {
      observe(record);
    }
    if (loaded.errors.length > 0) {
      throw new ThreadOutboxAuthorityError({
        reason: "inventory-incomplete",
        identity: null,
        cause: new AggregateError(loaded.errors, "Outbox authority inventory is incomplete."),
      });
    }
    complete = true;
  };

  const persist = async (record: ThreadOutboxRecord): Promise<ThreadOutboxRecord> => {
    const key = threadOutboxIdentity(record.storageIdentity);
    try {
      await options.storage.writeRecord(record);
    } catch (cause) {
      // A write can commit before reporting failure. Reconcile before another
      // mutation; never delete or restore an older authority snapshot.
      complete = false;
      throw new ThreadOutboxAuthorityError({
        reason: "write-failed",
        identity: key,
        cause,
      });
    }
    records.set(key, record);
    return record;
  };

  const retireRecord = (
    current: ThreadOutboxRecord,
    reason: RetirementReason,
    acknowledgedSequence?: number,
  ): Promise<ThreadOutboxRecord> => {
    if (current.kind === "retired") return Promise.resolve(current);
    const { message, ...rest } = current;
    return persist(
      decodeThreadOutboxRecord({
        ...rest,
        kind: "retired",
        reason: current.delivery.state === "refused" ? "confirmed-refusal" : reason,
        retainedMessage: message,
        ...(acknowledgedSequence === undefined ? {} : { acknowledgedSequence }),
      }),
    );
  };

  return {
    acquireEditor: (expected: ThreadOutboxRecord, canEdit: () => boolean): (() => void) | null => {
      const key = threadOutboxIdentity(expected.storageIdentity);
      const current = records.get(key);
      if (
        current !== expected ||
        current.archivedFor !== undefined ||
        reserved.has(key) ||
        uncertainClaims.has(key) ||
        ownedThreadOutboxPayloads(current).length === 0 ||
        !canEdit()
      )
        return null;
      const leases = editors.get(key) ?? new Set<symbol>();
      const lease = Symbol("outbox-editor");
      leases.add(lease);
      editors.set(key, leases);
      return () => {
        leases.delete(lease);
        if (leases.size === 0 && editors.get(key) === leases) editors.delete(key);
      };
    },
    isReserved: (record: ThreadOutboxRecord): boolean =>
      reserved.has(threadOutboxIdentity(record.storageIdentity)) ||
      uncertainClaims.has(threadOutboxIdentity(record.storageIdentity)),
    canPrepare: (expected: ThreadOutboxRecord): boolean => {
      const key = threadOutboxIdentity(expected.storageIdentity);
      return (
        complete &&
        records.get(key) === expected &&
        expected.kind === "message" &&
        expected.delivery.state === "ready" &&
        expected.archivedFor === undefined &&
        !editors.has(key) &&
        !reserved.has(key) &&
        !uncertainClaims.has(key) &&
        !revoked.has(key) &&
        !accountSuspended(expected.transport.environmentId, expected.ownerAccountId)
      );
    },
    // Partial inventory is useful for preserving/displaying content, not permission.
    inventoryComplete: (): boolean => complete && uncertainClaims.size === 0,
    knownRecords: (): ReadonlyArray<ThreadOutboxRecord> => [...records.values()],
    load: () =>
      options.serialize(async () => {
        await hydrate();
        return [...records.values()];
      }),
    // Null denotes device-local work; cloud callers pass their authenticated owner.
    admitNew: (
      input: Omit<QueuedThreadMessage, "delivery" | "storageIdentity">,
      ownerAccountId: string | null = null,
    ) => {
      const incomingKey = threadOutboxIdentity(input);
      if (reserved.has(incomingKey))
        return Promise.reject(
          new ThreadOutboxAuthorityError({
            reason: "identity-occupied",
            identity: incomingKey,
            cause: undefined,
          }),
        );
      return options.serialize(async (): Promise<ThreadOutboxRecord> => {
        const identity = {
          environmentId: input.environmentId,
          threadId: input.threadId,
          messageId: input.messageId,
        };
        const key = threadOutboxIdentity(identity);
        // Strict payload decoding also rejects runtime authority/lineage fields
        // smuggled through TypeScript's structural assignment.
        const record = decodeThreadOutboxRecord({
          schemaVersion: 6,
          kind: "message",
          storageIdentity: identity,
          transport: { ...identity, commandId: input.commandId },
          delivery: { state: "ready" },
          message: input,
        });
        await hydrate();
        if (accountSuspended(input.environmentId, ownerAccountId))
          throw new ThreadOutboxAuthorityError({
            reason: "environment-parked",
            identity: key,
            cause: undefined,
          });
        if (occupied(record.transport)) {
          throw new ThreadOutboxAuthorityError({
            reason: "identity-occupied",
            identity: key,
            cause: undefined,
          });
        }
        return persist(decodeThreadOutboxRecord({ ...record, ownerAccountId }));
      });
    },
    updateContent: (
      expected: ThreadOutboxRecord,
      input: Omit<QueuedThreadMessage, "delivery" | "storageIdentity">,
    ) => {
      if (reserved.has(threadOutboxIdentity(expected.storageIdentity)))
        return Promise.resolve(null);
      return options.serialize(async (): Promise<ThreadOutboxRecord | null> => {
        await hydrate();
        const current = records.get(threadOutboxIdentity(expected.storageIdentity));
        if (
          current !== expected ||
          uncertainClaims.has(threadOutboxIdentity(expected.storageIdentity)) ||
          threadOutboxIdentity(input) !== threadOutboxIdentity(current.transport) ||
          input.commandId !== current.transport.commandId ||
          (current.kind === "retired" && current.retainedMessage === undefined)
        )
          return null;
        const next = decodeThreadOutboxRecord(
          current.kind === "message"
            ? { ...current, message: input }
            : { ...current, retainedMessage: input },
        );
        return persist(next);
      });
    },
    retargetReady: (
      expected: ThreadOutboxRecord,
      input: Omit<QueuedThreadMessage, "delivery" | "storageIdentity">,
    ) => {
      if (reserved.has(threadOutboxIdentity(expected.storageIdentity)))
        return Promise.resolve(null);
      return options.serialize(async (): Promise<ThreadOutboxRecord | null> => {
        await hydrate();
        const current = records.get(threadOutboxIdentity(expected.storageIdentity));
        if (
          current !== expected ||
          accountSuspended(current.transport.environmentId, current.ownerAccountId) ||
          accountSuspended(input.environmentId, current.ownerAccountId) ||
          revoked.has(threadOutboxIdentity(expected.storageIdentity)) ||
          uncertainClaims.has(threadOutboxIdentity(expected.storageIdentity)) ||
          current.kind !== "message" ||
          current.delivery.state !== "ready" ||
          current.archivedFor !== undefined ||
          current.message.creation === undefined ||
          input.creation === undefined ||
          input.threadId !== current.transport.threadId ||
          input.messageId !== current.transport.messageId ||
          input.commandId !== current.transport.commandId
        )
          return null;
        const transport = {
          environmentId: input.environmentId,
          threadId: input.threadId,
          messageId: input.messageId,
          commandId: input.commandId,
        };
        if (occupied(transport, current)) return null;
        return persist(decodeThreadOutboxRecord({ ...current, transport, message: input }));
      });
    },
    claimForDelivery: (
      expected: ThreadOutboxRecord,
      invocation: Invocation,
      canInvoke: () => boolean,
    ) => {
      const key = threadOutboxIdentity(expected.storageIdentity);
      if (
        reserved.has(key) ||
        editors.has(key) ||
        accountSuspended(expected.transport.environmentId, expected.ownerAccountId)
      )
        return Promise.resolve(null);
      return options.serialize(async (): Promise<ThreadOutboxClaim | null> => {
        await hydrate();
        const current = records.get(key);
        if (
          current !== expected ||
          current.kind !== "message" ||
          current.delivery.state !== "ready" ||
          current.archivedFor !== undefined ||
          accountSuspended(current.transport.environmentId, current.ownerAccountId) ||
          uncertainClaims.has(key) ||
          editors.has(key) ||
          revoked.has(key) ||
          occupied(current.transport, current) ||
          !canInvoke()
        )
          return null;
        // Detach from mutable preparation objects before the first storage await.
        const attempted = decodeThreadOutboxRecord(
          JSON.parse(
            JSON.stringify({
              ...current,
              delivery: { state: "attempted" },
              original: { kind: "claim", localSnapshot: current.message, invocation },
            }),
          ),
        );
        const original = attempted.original;
        if (original?.kind !== "claim") return null;
        const transportKey = threadOutboxIdentity(current.transport);
        reserved.add(key);
        reserved.add(transportKey);
        try {
          try {
            await persist(attempted);
          } catch (cause) {
            uncertainClaims.set(key, current);
            try {
              const observed = await options.storage.readRecord(current.storageIdentity);
              if (observed !== null) observe(observed);
            } catch (readCause) {
              throw new ThreadOutboxAuthorityError({
                reason: "write-failed",
                identity: key,
                cause: new AggregateError([cause, readCause], "Claim write outcome is unreadable."),
              });
            }
            throw cause;
          }
          if (
            revoked.has(key) ||
            accountSuspended(current.transport.environmentId, current.ownerAccountId) ||
            !canInvoke()
          )
            return null;
          const token: ThreadOutboxClaim = { [claimBrand]: true };
          claims.set(token, { record: attempted, invocation: original.invocation, canInvoke });
          return token;
        } finally {
          reserved.delete(key);
          reserved.delete(transportKey);
        }
      });
    },
    parkAccount: (accountId: string, environments: ReadonlySet<EnvironmentId>) => {
      const scope = new Set(environments);
      suspendAccount(accountId, scope);
      return options.serialize(async (): Promise<void> => {
        await hydrate();
        for (const record of records.values()) {
          if (
            !scope.has(record.transport.environmentId) ||
            record.ownerAccountId !== accountId ||
            (record.archivedFor !== undefined && record.archivedFor !== accountId)
          )
            continue;
          if (record.archivedFor === accountId && record.ownerAccountId === accountId) continue;
          await persist(
            decodeThreadOutboxRecord({
              ...record,
              archivedFor: accountId,
            }),
          );
        }
      });
    },
    restoreAccount: (accountId: string, environments: ReadonlySet<EnvironmentId>) => {
      const scope = new Set(environments);
      const transition = suspendAccount(accountId, scope);
      return options.serialize(async (): Promise<void> => {
        await hydrate();
        for (const record of records.values()) {
          if (
            !scope.has(record.transport.environmentId) ||
            record.archivedFor !== accountId ||
            record.ownerAccountId !== accountId
          )
            continue;
          const { archivedFor: _placement, ...rest } = record;
          await persist(decodeThreadOutboxRecord(rest));
        }
        for (const environmentId of scope) {
          const owners = suspendedEnvironments.get(environmentId);
          if (owners?.get(accountId) === transition) owners.delete(accountId);
          if (owners?.size === 0) suspendedEnvironments.delete(environmentId);
        }
      });
    },
    /**
     * Caller certifies explicit discard or a durable destination/completion.
     * Reservation linearizes that authorization before the release write.
     */
    releaseRetained: (expected: ThreadOutboxRecord, authorize: () => boolean) =>
      options.serialize(
        async (): Promise<{
          readonly record: ThreadOutboxRecord;
          readonly released: ReadonlyArray<Content>;
        } | null> => {
          await hydrate();
          const key = threadOutboxIdentity(expected.storageIdentity);
          const current = records.get(key);
          if (
            current !== expected ||
            current.kind !== "retired" ||
            current.retainedMessage === undefined ||
            editors.has(key) ||
            reserved.has(key) ||
            uncertainClaims.has(key) ||
            !authorize()
          )
            return null;
          const released = ownedThreadOutboxPayloads(current);
          const { retainedMessage: _content, ...marker } = current;
          const transportKey = threadOutboxIdentity(current.transport);
          reserved.add(key);
          reserved.add(transportKey);
          try {
            const committed = await persist(decodeThreadOutboxRecord(marker));
            return { record: committed, released };
          } finally {
            reserved.delete(key);
            reserved.delete(transportKey);
          }
        },
      ),
    reconcileArchived: (accountId: string, snapshot: QueuedThreadMessage) =>
      options.serialize(async (): Promise<ThreadOutboxArchiveResult> => {
        await hydrate();
        const { delivery: archivedDelivery, storageIdentity, ...content } = snapshot;
        const identity = storageIdentity ?? {
          environmentId: snapshot.environmentId,
          threadId: snapshot.threadId,
          messageId: snapshot.messageId,
        };
        const key = threadOutboxIdentity(identity);
        const current = records.get(key);
        if (current === undefined) {
          // A transport alias belongs to an existing lineage, not a fresh slot.
          if (occupied(snapshot)) return { status: "conflict", record: null };
          const imported = await persist(
            decodeThreadOutboxRecord({
              schemaVersion: 6,
              kind: "message",
              storageIdentity: identity,
              transport: {
                environmentId: snapshot.environmentId,
                threadId: snapshot.threadId,
                messageId: snapshot.messageId,
                commandId: snapshot.commandId,
              },
              ownerAccountId: accountId,
              archivedFor: accountId,
              delivery: { state: "unknown" },
              message: content,
              original: { kind: "legacy-observed", localSnapshot: content },
            }),
          );
          // The old archive is still the only owner of its unverified refusal data.
          return {
            status: archivedDelivery?.state === "refused" ? "conflict" : "imported",
            record: imported,
          };
        }
        if (
          (current.ownerAccountId ?? current.archivedFor) !== accountId ||
          threadOutboxIdentity(current.transport) !== threadOutboxIdentity(snapshot) ||
          current.transport.commandId !== snapshot.commandId
        ) {
          return { status: "conflict", record: null };
        }
        const extraEvidence =
          (archivedDelivery?.state === "refused" &&
            stableStringify(archivedDelivery) !== stableStringify(current.delivery)) ||
          (current.delivery.state === "ready" &&
            (archivedDelivery?.state === "attempted" || archivedDelivery?.state === "unknown"));
        const local = current.kind === "message" ? current.message : current.retainedMessage;
        if (
          !extraEvidence &&
          local !== undefined &&
          ownedContent(local) === ownedContent(content)
        ) {
          return { status: "duplicate", record: current };
        }
        if (
          !extraEvidence &&
          current.kind === "retired" &&
          current.reason === "acknowledged" &&
          current.original?.kind === "claim" &&
          ownedContent(current.original.localSnapshot) === ownedContent(content)
        ) {
          return { status: "obsolete", record: current };
        }
        if (!extraEvidence && current.kind === "retired" && current.retainedMessage === undefined) {
          const original = current.original ?? {
            kind: "legacy-observed" as const,
            localSnapshot: content,
          };
          const retained = await persist(
            decodeThreadOutboxRecord({
              ...current,
              retainedMessage: content,
              delivery:
                current.delivery.state === "ready" ? { state: "unknown" } : current.delivery,
              original,
            }),
          );
          return { status: "imported", record: retained };
        }
        revoked.add(key);
        // Conflicting queued content has no established ordering. Preserve both
        // and do not let the still-ready side dispatch before explicit review.
        if (current.kind === "message" && current.delivery.state === "ready") {
          const held = await persist(
            decodeThreadOutboxRecord({
              ...current,
              delivery: { state: "unknown" },
              original: { kind: "legacy-observed", localSnapshot: current.message },
            }),
          );
          return { status: "conflict", record: held };
        }
        return { status: "conflict", record: current };
      }),
    recordRefusal: (
      identity: ThreadOutboxRecord["storageIdentity"],
      evidence: {
        readonly sourceScope: ScopedThreadRef;
        readonly sourceMessage: OrchestrationMessage;
        readonly activity: unknown;
      },
    ) => {
      const sourceScope = { ...evidence.sourceScope };
      const sourceMessage = decodeSourceMessage(JSON.parse(JSON.stringify(evidence.sourceMessage)));
      const decodedRefusal = decodeTurnStartRefusal(sourceScope, sourceScope, evidence.activity);
      if (
        decodedRefusal === null ||
        sourceMessage.role !== "user" ||
        sourceMessage.id !== decodedRefusal.requestId
      ) {
        return Promise.resolve(null);
      }
      const refusal = { ...decodedRefusal };
      const key = threadOutboxIdentity(identity);
      const sourceKey = threadOutboxIdentity({ ...sourceScope, messageId: sourceMessage.id });
      const observed = records.get(key);
      if (observed !== undefined) {
        if (
          threadOutboxIdentity(observed.transport) !== sourceKey ||
          observed.transport.commandId !== refusal.originCommandId
        )
          return Promise.resolve(null);
        // Positive source evidence denies an unused token even while persistence waits.
        revoked.add(key);
      }
      return options.serialize(async (): Promise<ThreadOutboxRecord | null> => {
        await hydrate();
        const current = records.get(key);
        if (
          current === undefined ||
          threadOutboxIdentity(current.transport) !== sourceKey ||
          current.transport.commandId !== refusal.originCommandId
        )
          return null;
        revoked.add(key);
        if (current.delivery.state === "refused") return current;
        const local = current.kind === "message" ? current.message : current.retainedMessage;
        const original =
          current.original ??
          (local === undefined
            ? undefined
            : {
                kind: "legacy-observed" as const,
                localSnapshot: local,
              });
        return persist(
          decodeThreadOutboxRecord({
            ...current,
            delivery: { state: "refused", sourceMessage, refusal },
            ...(original === undefined ? {} : { original }),
            ...(current.kind === "retired" ? { reason: "confirmed-refusal" } : {}),
          }),
        );
      });
    },
    /** Retire transport authority only; content ownership is not released here. */
    retire: (
      identity: ThreadOutboxRecord["storageIdentity"],
      reason: Exclude<RetirementReason, "acknowledged">,
      canRetire: () => boolean = () => true,
    ) => {
      const key = threadOutboxIdentity(identity);
      const observed = records.get(key);
      if (
        reason === "confirmed-refusal" &&
        observed !== undefined &&
        observed.delivery.state !== "refused"
      )
        return Promise.resolve(null);
      if (!canRetire()) return Promise.resolve(null);
      if (observed !== undefined) revoked.add(key);
      return options.serialize(async (): Promise<ThreadOutboxRecord | null> => {
        await hydrate();
        const current = records.get(key);
        if (
          current === undefined ||
          !canRetire() ||
          (reason === "confirmed-refusal" && current.delivery.state !== "refused")
        )
          return null;
        revoked.add(key);
        return retireRecord(current, reason);
      });
    },
    /** Receipt comes from the RPC promise associated with this consumed claim. */
    retireAcknowledged: (token: ThreadOutboxClaim, receipt: DispatchResult) => {
      const delivered = invoked.get(token);
      if (delivered === undefined) return Promise.resolve(null);
      const key = threadOutboxIdentity(delivered.storageIdentity);
      revoked.add(key);
      return options.serialize(async (): Promise<ThreadOutboxRecord | null> => {
        await hydrate();
        const current = records.get(key);
        if (
          current === undefined ||
          threadOutboxIdentity(current.transport) !== threadOutboxIdentity(delivered.transport) ||
          current.transport.commandId !== delivered.transport.commandId
        )
          return null;
        return retireRecord(current, "acknowledged", receipt.sequence);
      });
    },
    /** Consume immediately before startTurn, with no intervening await. */
    consumeClaim: (token: ThreadOutboxClaim): Invocation | null => {
      const claimed = claims.get(token);
      claims.delete(token);
      if (claimed === undefined) return null;
      const key = threadOutboxIdentity(claimed.record.storageIdentity);
      if (
        !complete ||
        accountSuspended(claimed.record.transport.environmentId, claimed.record.ownerAccountId) ||
        uncertainClaims.has(key) ||
        revoked.has(key) ||
        reserved.has(key) ||
        editors.has(key) ||
        records.get(key) !== claimed.record ||
        !claimed.canInvoke()
      )
        return null;
      invoked.set(token, claimed.record);
      return claimed.invocation;
    },
  };
}
