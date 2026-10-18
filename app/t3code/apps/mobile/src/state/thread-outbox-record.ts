import {
  ClientOrchestrationCommand,
  CommandId,
  EnvironmentId,
  MessageId,
  NonNegativeInt,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import {
  QueuedThreadDeliverySchema,
  QueuedThreadMessageSchema,
  threadOutboxIdentity,
} from "./thread-outbox-model";

// Delivery and lineage belong to the record, never an editable snapshot.
const Payload = QueuedThreadMessageSchema.mapFields(
  Struct.omit(["schemaVersion", "delivery", "storageIdentity"]),
);
const Identity = Schema.Struct({
  environmentId: EnvironmentId,
  threadId: ThreadId,
  messageId: MessageId,
});
const Transport = Schema.Struct({ ...Identity.fields, commandId: CommandId });
const StartCommand = ClientOrchestrationCommand.pipe(
  Schema.refine(
    (
      command,
    ): command is Extract<ClientOrchestrationCommand, { readonly type: "thread.turn.start" }> =>
      command.type === "thread.turn.start",
  ),
);
const Original = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("claim"),
    localSnapshot: Payload,
    invocation: Schema.Struct({
      environmentId: EnvironmentId,
      command: StartCommand,
    }),
  }),
  Schema.Struct({
    kind: Schema.Literal("legacy-observed"),
    localSnapshot: Payload,
  }),
]);
const common = {
  schemaVersion: Schema.Literal(6),
  storageIdentity: Identity,
  transport: Transport,
  delivery: QueuedThreadDeliverySchema,
  original: Schema.optionalKey(Original),
  archivedFor: Schema.optionalKey(Schema.String),
  ownerAccountId: Schema.optionalKey(Schema.NullOr(Schema.String)),
};

const RecordSchema = Schema.Union([
  Schema.Struct({ ...common, kind: Schema.Literal("message"), message: Payload }),
  Schema.Struct({
    ...common,
    kind: Schema.Literal("retired"),
    reason: Schema.Literals(["acknowledged", "confirmed-refusal", "discarded", "draft-transfer"]),
    acknowledgedSequence: Schema.optionalKey(NonNegativeInt),
    retainedMessage: Schema.optionalKey(Payload),
  }),
]).check(
  Schema.makeFilter((record) => {
    const sameTransport = (message: typeof Payload.Type): boolean =>
      threadOutboxIdentity(message) === threadOutboxIdentity(record.transport) &&
      message.commandId === record.transport.commandId;
    if (record.storageIdentity.messageId !== record.transport.messageId) return false;
    if (
      record.archivedFor !== undefined &&
      record.ownerAccountId !== undefined &&
      record.archivedFor !== record.ownerAccountId
    )
      return false;
    const content = record.kind === "message" ? record.message : record.retainedMessage;
    if (content !== undefined && !sameTransport(content)) return false;
    if (
      content !== undefined &&
      record.delivery.state !== "ready" &&
      record.original === undefined
    ) {
      return false;
    }
    if (record.delivery.state === "ready" && record.original !== undefined) return false;
    if (
      record.delivery.state === "refused" &&
      (record.delivery.sourceMessage.role !== "user" ||
        record.delivery.sourceMessage.id !== record.transport.messageId ||
        record.delivery.refusal.requestId !== record.transport.messageId)
    )
      return false;
    if (
      record.kind === "retired" &&
      record.reason === "confirmed-refusal" &&
      record.delivery.state !== "refused"
    )
      return false;
    if (record.original !== undefined && !sameTransport(record.original.localSnapshot))
      return false;
    if (record.original?.kind === "claim") {
      const { invocation, localSnapshot } = record.original;
      return (
        (record.delivery.state === "attempted" || record.delivery.state === "refused") &&
        invocation.environmentId === record.transport.environmentId &&
        invocation.command.threadId === record.transport.threadId &&
        invocation.command.message.messageId === record.transport.messageId &&
        invocation.command.commandId === record.transport.commandId &&
        invocation.command.createdAt === localSnapshot.createdAt
      );
    }
    return true;
  }),
);

export type ThreadOutboxRecord = typeof RecordSchema.Type;

/** A bare terminal marker keeps receipts, not ownership of local files. */
export function ownedThreadOutboxPayloads(
  record: ThreadOutboxRecord,
): ReadonlyArray<Extract<ThreadOutboxRecord, { kind: "message" }>["message"]> {
  const latest = record.kind === "message" ? record.message : record.retainedMessage;
  if (latest === undefined) return [];
  return record.original === undefined ? [latest] : [latest, record.original.localSnapshot];
}

// Wire codecs trim identifiers and some strings. Local snapshots must retain
// exact values and compare scopes before any such normalization.
const StoredRecord = Schema.toType(RecordSchema);
export const encodeThreadOutboxRecord = Schema.encodeSync(StoredRecord, {
  onExcessProperty: "error",
});
const decodeRecord = Schema.decodeUnknownSync(
  Schema.Union([StoredRecord, Schema.toType(QueuedThreadMessageSchema)]),
  { onExcessProperty: "error" },
);

/** Older records preserve observations, never a fabricated invocation bundle. */
export function decodeThreadOutboxRecord(value: unknown): ThreadOutboxRecord {
  const decoded = decodeRecord(value);
  if (decoded.schemaVersion === 6) return decoded;
  const { schemaVersion, delivery, storageIdentity, ...message } = decoded;
  const identity = {
    environmentId: message.environmentId,
    threadId: message.threadId,
    messageId: message.messageId,
  };
  const transport = { ...identity, commandId: message.commandId };
  const authority =
    schemaVersion === 5
      ? (delivery ?? { state: "unknown" as const })
      : { state: "unknown" as const };
  return {
    schemaVersion: 6,
    kind: "message",
    storageIdentity:
      schemaVersion === 5 && storageIdentity !== undefined ? storageIdentity : identity,
    transport,
    delivery: authority,
    message,
    ...(authority.state === "ready"
      ? {}
      : {
          original: { kind: "legacy-observed" as const, localSnapshot: message },
        }),
  };
}
