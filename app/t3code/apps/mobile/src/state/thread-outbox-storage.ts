import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { writeFileAtomically } from "../lib/atomic-file";
import {
  decodeQueuedThreadMessage,
  encodeQueuedThreadMessage,
  threadOutboxIdentity,
  type QueuedThreadMessage,
} from "./thread-outbox-model";

import {
  decodeThreadOutboxRecord,
  encodeThreadOutboxRecord,
  type ThreadOutboxRecord,
} from "./thread-outbox-record";

const THREAD_OUTBOX_DIRECTORY = "thread-outbox";

const inFlightWrites = new Set<Promise<void>>();
let writeRevision = 0;

export function threadOutboxWriteState(): { readonly revision: number; readonly pending: boolean } {
  return { revision: writeRevision, pending: inFlightWrites.size > 0 };
}

function trackInFlightWrite(operation: Promise<void>): Promise<void> {
  inFlightWrites.add(operation);
  writeRevision += 1;
  void operation
    .catch(() => undefined)
    .finally(() => {
      inFlightWrites.delete(operation);
      writeRevision += 1;
    });
  return operation;
}

/**
 * Awaits queued-message writes so an app update restart cannot tear down the
 * runtime while one is mid-file.
 */
export async function flushThreadOutboxWrites(): Promise<void> {
  while (inFlightWrites.size > 0) {
    await Promise.allSettled(inFlightWrites);
  }
}

export class ThreadOutboxStorageError extends Schema.TaggedError<ThreadOutboxStorageError>()(
  "ThreadOutboxStorageError",
  {
    operation: Schema.Literals(["load", "read-message", "write", "remove", "legacy-cleanup"]),
    environmentId: Schema.NullOr(EnvironmentId),
    threadId: Schema.NullOr(ThreadId),
    messageId: Schema.NullOr(MessageId),
    fileName: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Thread outbox storage operation ${this.operation} failed for environment ${this.environmentId ?? "unknown"}, thread ${this.threadId ?? "unknown"}, message ${this.messageId ?? "unknown"}, file ${this.fileName ?? "unknown"}.`;
  }
}

export interface ThreadOutboxLoadResult {
  readonly messages: ReadonlyArray<QueuedThreadMessage>;
  readonly errors: ReadonlyArray<ThreadOutboxStorageError>;
}

export interface ThreadOutboxStorage {
  readonly load: () => Promise<ThreadOutboxLoadResult>;
  readonly write: (message: QueuedThreadMessage) => Promise<void>;
  readonly remove: (message: QueuedThreadMessage) => Promise<void>;
}

export interface ThreadOutboxRecordStorage {
  readonly loadRecords: () => Promise<{
    readonly records: ReadonlyArray<ThreadOutboxRecord>;
    readonly errors: ReadonlyArray<ThreadOutboxStorageError>;
  }>;
  readonly readRecord: (
    identity: ThreadOutboxRecord["storageIdentity"],
  ) => Promise<ThreadOutboxRecord | null>;
  readonly writeRecord: (record: ThreadOutboxRecord) => Promise<void>;
}

function legacyMessageFileName(messageId: MessageId): string {
  return `${encodeURIComponent(messageId)}.json`;
}

async function messageFileName(message: StorageTarget): Promise<string> {
  const { CryptoDigestAlgorithm, digestStringAsync } = await import("expo-crypto");
  const digest = await digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    threadOutboxIdentity(message.storageIdentity ?? message),
  );
  return `scoped-${digest}.json`;
}

async function getOutboxDirectory() {
  const { Directory, Paths } = await import("expo-file-system");
  const directory = new Directory(Paths.document, THREAD_OUTBOX_DIRECTORY);
  directory.create({ idempotent: true, intermediates: true });
  return directory;
}

async function getMessageFile(fileName: string) {
  const { File } = await import("expo-file-system");
  return new File(await getOutboxDirectory(), fileName);
}

async function removeMatchingLegacyMessage(message: StorageTarget): Promise<void> {
  const legacy = await getMessageFile(legacyMessageFileName(message.messageId));
  if (!legacy.exists) return;
  const stored = decodeThreadOutboxRecord(JSON.parse(await legacy.text()) as unknown);
  if (
    threadOutboxIdentity(stored.storageIdentity) ===
    threadOutboxIdentity(message.storageIdentity ?? message)
  )
    legacy.delete();
}

type StorageTarget = Pick<
  QueuedThreadMessage,
  "environmentId" | "threadId" | "messageId" | "storageIdentity"
>;

async function loadStored<T>(
  decode: (value: unknown) => T,
  identityOf: (value: T) => StorageTarget,
) {
  const messages = new Map<string, T>();
  const errors: ThreadOutboxStorageError[] = [];
  try {
    const { File } = await import("expo-file-system");
    const directory = await getOutboxDirectory();
    const entries = directory.list();
    const fileNames = new Set(
      entries.filter((entry) => entry instanceof File).map((entry) => entry.name),
    );
    for (const entry of entries) {
      if (!(entry instanceof File) || !entry.name.endsWith(".json")) {
        continue;
      }
      try {
        const message = decode(JSON.parse(await entry.text()) as unknown);
        const scope = identityOf(message);
        const identity = threadOutboxIdentity(scope);
        const scopedName = await messageFileName(scope);
        const isScoped = entry.name === scopedName;
        if (!isScoped && entry.name !== legacyMessageFileName(scope.messageId)) {
          throw new Error("Outbox filename does not match its stored identity.");
        }
        // Even an unreadable newer record must not revive a stale legacy copy.
        if (!isScoped && fileNames.has(scopedName)) continue;
        messages.set(identity, message);
      } catch (cause) {
        // Recover readable messages without treating their attachment
        // owners as the complete inventory needed for cleanup.
        errors.push(
          new ThreadOutboxStorageError({
            operation: "read-message",
            environmentId: null,
            threadId: null,
            messageId: null,
            fileName: entry.name,
            cause,
          }),
        );
      }
    }
  } catch (cause) {
    throw new ThreadOutboxStorageError({
      operation: "load",
      environmentId: null,
      threadId: null,
      messageId: null,
      fileName: null,
      cause,
    });
  }
  return { items: [...messages.values()], errors };
}

async function writeStored(
  message: StorageTarget,
  encode: () => unknown,
  legacyOnly: boolean,
): Promise<void> {
  let fileName: string | null = null;
  try {
    await trackInFlightWrite(
      (async () => {
        fileName = await messageFileName(message);
        const file = await getMessageFile(fileName);
        if (legacyOnly && file.exists) {
          decodeQueuedThreadMessage(JSON.parse(await file.text()) as unknown);
        }
        await writeFileAtomically(file, JSON.stringify(encode()));
        try {
          await removeMatchingLegacyMessage(message);
        } catch (cause) {
          // The new record is committed. Keep it authoritative if legacy cleanup fails.
          console.warn(
            "[thread-outbox] scoped write retained a legacy copy",
            new ThreadOutboxStorageError({
              operation: "legacy-cleanup",
              environmentId: message.environmentId,
              threadId: message.threadId,
              messageId: message.messageId,
              fileName: legacyMessageFileName(message.messageId),
              cause,
            }),
          );
        }
      })(),
    );
  } catch (cause) {
    throw new ThreadOutboxStorageError({
      operation: "write",
      environmentId: message.environmentId,
      threadId: message.threadId,
      messageId: message.messageId,
      fileName,
      cause,
    });
  }
}

export const expoThreadOutboxStorage: ThreadOutboxStorage & ThreadOutboxRecordStorage = {
  loadRecords: async () => {
    const loaded = await loadStored(decodeThreadOutboxRecord, (record) => record.storageIdentity);
    return { records: loaded.items, errors: loaded.errors };
  },
  writeRecord: (record) =>
    writeStored(
      { ...record.transport, storageIdentity: record.storageIdentity },
      () => encodeThreadOutboxRecord(record),
      false,
    ),
  readRecord: async (identity) => {
    let fileName: string | null = null;
    try {
      fileName = await messageFileName(identity);
      let file = await getMessageFile(fileName);
      const scoped = file.exists;
      if (!scoped) {
        fileName = legacyMessageFileName(identity.messageId);
        file = await getMessageFile(fileName);
      }
      if (!file.exists) return null;
      const record = decodeThreadOutboxRecord(JSON.parse(await file.text()) as unknown);
      if (threadOutboxIdentity(record.storageIdentity) !== threadOutboxIdentity(identity)) {
        if (!scoped) return null;
        throw new Error("Outbox filename does not match its stored identity.");
      }
      return record;
    } catch (cause) {
      throw new ThreadOutboxStorageError({
        operation: "read-message",
        environmentId: identity.environmentId,
        threadId: identity.threadId,
        messageId: identity.messageId,
        fileName,
        cause,
      });
    }
  },

  load: async () => {
    const loaded = await loadStored(
      decodeQueuedThreadMessage,
      (message) => message.storageIdentity ?? message,
    );
    return { messages: loaded.items, errors: loaded.errors };
  },
  write: (message) => writeStored(message, () => encodeQueuedThreadMessage(message), true),
  remove: async (message) => {
    let fileName: string | null = null;
    try {
      fileName = await messageFileName(message);
      const file = await getMessageFile(fileName);
      if (file.exists) decodeQueuedThreadMessage(JSON.parse(await file.text()) as unknown);
      // If legacy cleanup fails, preserve the committed scoped copy.
      await removeMatchingLegacyMessage(message);
      if (file.exists) {
        file.delete();
      }
    } catch (cause) {
      throw new ThreadOutboxStorageError({
        operation: "remove",
        environmentId: message.environmentId,
        threadId: message.threadId,
        messageId: message.messageId,
        fileName,
        cause,
      });
    }
  },
};
