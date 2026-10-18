import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ThreadId,
  makeWorkspaceTurnStartRefusalIdentity,
} from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import { onTestFinished, vi } from "vite-plus/test";

import { threadOutboxIdentity, type QueuedThreadMessage } from "./thread-outbox-model";
import {
  decodeThreadOutboxRecord,
  encodeThreadOutboxRecord,
  type ThreadOutboxRecord,
} from "./thread-outbox-record";
import { createThreadOutboxRecordManager } from "./thread-outbox-record-manager";
import { optimisticThreadOutboxOwnersAtom } from "./thread-outbox-ownership";
import { threadOutboxPresentation } from "./thread-outbox-presentation";
import { appendPendingThreadMessages } from "../features/threads/pending-thread-feed";
import { ThreadOutboxStorageError, type ThreadOutboxRecordStorage } from "./thread-outbox-storage";

function payload(
  id = "message",
  environmentId = EnvironmentId.make("environment"),
): Omit<QueuedThreadMessage, "delivery" | "storageIdentity"> {
  return {
    environmentId,
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make(id),
    commandId: CommandId.make(`command-${id}`),
    text: id,
    attachments: [],
    createdAt: "2026-10-04T00:00:00.000Z",
  };
}

function active(
  input = payload(),
  ownerAccountId: string | null = null,
  delivery: NonNullable<QueuedThreadMessage["delivery"]> = { state: "ready" },
): ThreadOutboxRecord {
  return decodeThreadOutboxRecord({
    schemaVersion: 6,
    kind: "message",
    storageIdentity: {
      environmentId: input.environmentId,
      threadId: input.threadId,
      messageId: input.messageId,
    },
    transport: {
      environmentId: input.environmentId,
      threadId: input.threadId,
      messageId: input.messageId,
      commandId: input.commandId,
    },
    ownerAccountId,
    delivery,
    message: input,
    ...(delivery.state === "ready"
      ? {}
      : { original: { kind: "legacy-observed", localSnapshot: input } }),
  });
}

function clone(record: ThreadOutboxRecord): ThreadOutboxRecord {
  return decodeThreadOutboxRecord(JSON.parse(JSON.stringify(encodeThreadOutboxRecord(record))));
}

function fixture(initial: ReadonlyArray<ThreadOutboxRecord> = [], accountId: string | null = null) {
  const registry = AtomRegistry.make();
  onTestFinished(() => registry.dispose());
  const stored = new Map(
    initial.map((record) => [threadOutboxIdentity(record.storageIdentity), clone(record)]),
  );
  const storage = {
    loadRecords: vi.fn<ThreadOutboxRecordStorage["loadRecords"]>(async () => ({
      records: [...stored.values()].map(clone),
      errors: [],
    })),
    readRecord: vi.fn<ThreadOutboxRecordStorage["readRecord"]>(async (identity) => {
      const record = stored.get(threadOutboxIdentity(identity));
      return record === undefined ? null : clone(record);
    }),
    writeRecord: vi.fn<ThreadOutboxRecordStorage["writeRecord"]>(async (record) => {
      stored.set(threadOutboxIdentity(record.storageIdentity), clone(record));
    }),
  };
  const warn = vi.fn();
  const manager = createThreadOutboxRecordManager({ registry, storage, accountId, warn });
  const queues = () => registry.get(manager.queuedMessagesByThreadKeyAtom);
  const messages = () => Object.values(queues()).flat();
  return { manager, registry, storage, stored, warn, queues, messages };
}

function row(
  manager: ReturnType<typeof createThreadOutboxRecordManager>,
  record: ThreadOutboxRecord,
): QueuedThreadMessage {
  const message = manager.messageFor(record);
  if (message === null) throw new Error("Expected current visible record");
  return message;
}

function invocation(input = payload()) {
  return {
    environmentId: input.environmentId,
    command: {
      type: "thread.turn.start" as const,
      commandId: input.commandId,
      threadId: input.threadId,
      message: {
        messageId: input.messageId,
        role: "user" as const,
        text: input.text,
        attachments: [],
      },
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      createdAt: input.createdAt,
    },
  };
}

function refusalEvidence(
  input = payload(),
): Parameters<ReturnType<typeof createThreadOutboxRecordManager>["authority"]["recordRefusal"]>[1] {
  return {
    sourceScope: { environmentId: input.environmentId, threadId: input.threadId },
    sourceMessage: {
      id: input.messageId,
      role: "user",
      text: "canonical source",
      attachments: [],
      turnId: null,
      streaming: false,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    },
    activity: {
      id: makeWorkspaceTurnStartRefusalIdentity(input.threadId, input.messageId).activityId,
      kind: "provider.turn.start.failed",
      tone: "error",
      summary: "denied",
      turnId: null,
      sequence: 2,
      createdAt: input.createdAt,
      payload: {
        version: 1,
        source: "workspace-ownership",
        requestId: input.messageId,
        reason: "target-changed",
        originCommandId: input.commandId,
        originSequence: 1,
      },
    },
  };
}

describe("record-backed outbox presentation", () => {
  it("retains failed admission ownership until rejected input has been handed back", async () => {
    const h = fixture();
    h.storage.writeRecord.mockRejectedValueOnce(new Error("admission failed"));
    const input = {
      ...payload(),
      attachments: [
        {
          id: "owned-file",
          type: "file" as const,
          name: "owned.txt",
          mimeType: "text/plain",
          sizeBytes: 1,
          fileUri: "file:///owned.txt",
          uploadedAttachmentId: "pending-upload",
          uploadEnvironmentId: payload().environmentId,
        },
      ],
    };
    const pending = h.manager.enqueueNew(input, null);
    const owner = h.manager.optimisticMessages()[0];
    expect(pending.releaseAfterHandback()).toBe(false);

    await expect(pending.committed).rejects.toMatchObject({ reason: "write-failed" });

    expect(h.manager.optimisticMessages()).toEqual([owner]);
    expect(h.registry.get(optimisticThreadOutboxOwnersAtom)).toEqual([owner]);
    expect(h.messages()).toEqual([]);
    expect(pending.releaseAfterHandback()).toBe(true);
    expect(pending.releaseAfterHandback()).toBe(false);
    expect(h.manager.optimisticMessages()).toEqual([]);
    expect(h.registry.get(optimisticThreadOutboxOwnersAtom)).toEqual([]);
  });

  it("retires a confirmed refusal without losing an intervening editor save or lease", async () => {
    const input = payload();
    const h = fixture([active(input, null, { state: "unknown" })]);
    await h.manager.load();
    const original = h.manager.recordAt(input);
    if (original === null) throw new Error("Expected observed record");
    const release = h.manager.authority.acquireEditor(original, () => true);
    if (release === null) throw new Error("Expected editor ownership");
    onTestFinished(release);
    let edit: Promise<ThreadOutboxRecord | null> | undefined;
    const unsubscribe = h.registry.subscribe(h.manager.queuedMessagesByThreadKeyAtom, () => {
      const current = h.manager.recordAt(input);
      if (
        edit === undefined &&
        current?.kind === "message" &&
        current.delivery.state === "refused"
      ) {
        edit = h.manager.authority.updateContent(current, { ...input, text: "newest edit" });
      }
    });
    onTestFinished(unsubscribe);

    const retired = await h.manager.retireRefused(row(h.manager, original), refusalEvidence(input));

    if (retired === null) throw new Error("Expected retirement");
    expect(edit).toBeDefined();
    expect(await edit).not.toBeNull();
    expect(retired).toMatchObject({
      kind: "retired",
      reason: "confirmed-refusal",
      retainedMessage: { text: "newest edit" },
      delivery: { state: "refused", sourceMessage: { text: "canonical source" } },
    });
    expect(retired.original).toEqual(original.original);
    expect(row(h.manager, retired).text).toBe("newest edit");
    expect(await h.manager.authority.releaseRetained(retired, () => true)).toBeNull();
    expect(h.stored.get(threadOutboxIdentity(retired.storageIdentity))).toEqual(clone(retired));
    release();
  });

  it("does not retire copied projections or a foreign refusal", async () => {
    const input = payload();
    const h = fixture([active(input)]);
    await h.manager.load();
    const record = h.manager.recordAt(input);
    if (record === null) throw new Error("Expected record");
    const message = row(h.manager, record);

    expect(await h.manager.retireRefused({ ...message }, refusalEvidence(input))).toBeNull();
    expect(
      await h.manager.retireRefused(message, {
        ...refusalEvidence(input),
        sourceScope: { environmentId: EnvironmentId.make("foreign"), threadId: input.threadId },
      }),
    ).toBeNull();

    expect(h.storage.writeRecord).not.toHaveBeenCalled();
    expect(h.manager.recordAt(input)).toBe(record);
  });

  it("keeps durable refusal and payload when terminal marker persistence fails", async () => {
    const input = payload();
    const h = fixture([active(input)]);
    await h.manager.load();
    const record = h.manager.recordAt(input);
    if (record === null) throw new Error("Expected record");
    h.storage.writeRecord.mockImplementation(async (next) => {
      if (next.kind === "retired") throw new Error("retirement write failed");
      h.stored.set(threadOutboxIdentity(next.storageIdentity), clone(next));
    });

    await expect(
      h.manager.retireRefused(row(h.manager, record), refusalEvidence(input)),
    ).rejects.toMatchObject({ reason: "write-failed" });

    const persisted = h.stored.get(threadOutboxIdentity(record.storageIdentity));
    expect(persisted).toMatchObject({
      kind: "message",
      delivery: { state: "refused" },
      message: input,
    });
    expect(h.messages()[0]).toMatchObject({ text: input.text, delivery: { state: "refused" } });
  });

  it("owns fresh content synchronously while hydration and admission remain pending", async () => {
    const h = fixture();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    h.storage.loadRecords.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return { records: [], errors: [] };
    });
    const input = {
      ...payload(),
      attachments: [
        {
          id: "local-file",
          type: "file" as const,
          name: "local.txt",
          mimeType: "text/plain",
          sizeBytes: 1,
          fileUri: "file:///local.txt",
        },
      ],
    };
    const pending = h.manager.enqueueNew(input, null);
    const optimistic = h.messages()[0];
    if (optimistic === undefined) throw new Error("Expected synchronous feedback");
    expect(optimistic.attachments).toBe(input.attachments);
    expect(optimistic.delivery).toEqual({ state: "unknown" });
    expect(h.manager.optimisticMessages()).toEqual([optimistic]);
    expect(h.manager.recordFor(optimistic)).toBeNull();
    expect(h.manager.recordAt(input)).toBeNull();
    await entered.promise;
    expect(h.storage.writeRecord).not.toHaveBeenCalled();
    release.resolve();
    const committed = await pending.committed;
    expect(committed.delivery).toEqual({ state: "ready" });
    expect(h.manager.recordAt(input)).toBe(committed);
    expect(h.manager.recordFor(row(h.manager, committed))).toBe(committed);
    expect(h.manager.optimisticMessages()).toEqual([]);
    await expect(h.manager.confirmQueued(optimistic)).resolves.toBeNull();
    await expect(h.manager.confirmQueued(row(h.manager, committed))).resolves.toBe(committed);
  }, 5_000);

  it("lets delayed durable authority defeat overlays without rejecting unrelated work", async () => {
    const fence = active(payload(), null, { state: "attempted" });
    const h = fixture([fence]);
    const before = [...h.stored.values()].map((record) => encodeThreadOutboxRecord(record));
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    h.storage.loadRecords.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return { records: [clone(fence)], errors: [] };
    });
    const loading = h.manager.load();
    await entered.promise;
    const first = h.manager.enqueueNew({ ...payload(), text: "first overlay" }, null);
    const firstRejected = expect(first.committed).rejects.toMatchObject({
      reason: "identity-occupied",
    });
    const newer = h.manager.enqueueNew({ ...payload(), text: "newer overlay" }, null);
    const newerRejected = expect(newer.committed).rejects.toMatchObject({
      reason: "identity-occupied",
    });
    const unrelated = h.manager.enqueueNew(payload("other"), null);
    expect(h.messages().map((message) => message.text)).toEqual(["newer overlay", "other"]);
    expect(h.manager.optimisticMessages()).toHaveLength(3);
    release.resolve();
    expect(await loading).toBe(true);
    await firstRejected;
    await newerRejected;
    const other = await unrelated.committed;
    expect(h.manager.optimisticMessages()).toHaveLength(2);
    first.releaseAfterHandback();
    newer.releaseAfterHandback();
    const retained = h.manager.recordAt(fence.storageIdentity);
    if (retained === null) throw new Error("Expected retained durable fence");
    expect(row(h.manager, retained).text).toBe(payload().text);
    expect(retained.original).toEqual(fence.original);
    expect(h.messages()).toEqual([row(h.manager, retained), row(h.manager, other)]);
    expect(h.storage.writeRecord).toHaveBeenCalledTimes(1);
    const storedFence = h.stored.get(threadOutboxIdentity(fence.storageIdentity));
    if (storedFence === undefined) throw new Error("Expected unchanged stored fence");
    expect(encodeThreadOutboxRecord(storedFence)).toEqual(before[0]);
  }, 5_000);

  it("releases only the failed owner's handback while a newer write is blocked", async () => {
    const h = fixture();
    await h.manager.load();
    const firstEntered = Promise.withResolvers<void>();
    const failFirst = Promise.withResolvers<void>();
    const secondEntered = Promise.withResolvers<void>();
    const finishSecond = Promise.withResolvers<void>();
    h.storage.writeRecord
      .mockImplementationOnce(async () => {
        firstEntered.resolve();
        await failFirst.promise;
        throw new Error("pre-commit failure");
      })
      .mockImplementationOnce(async (record) => {
        secondEntered.resolve();
        await finishSecond.promise;
        h.stored.set(threadOutboxIdentity(record.storageIdentity), clone(record));
      });
    const first = h.manager.enqueueNew({ ...payload(), text: "older" }, null);
    const firstRejected = expect(first.committed).rejects.toMatchObject({ reason: "write-failed" });
    await firstEntered.promise;
    const second = h.manager.enqueueNew({ ...payload(), text: "newer" }, null);
    const newerOverlay = h.messages()[0];
    expect(h.manager.optimisticMessages()).toHaveLength(2);
    failFirst.resolve();
    await firstRejected;
    await secondEntered.promise;
    expect(h.messages()).toEqual([newerOverlay]);
    expect(h.manager.optimisticMessages()).toHaveLength(2);
    expect(first.releaseAfterHandback()).toBe(true);
    expect(h.manager.optimisticMessages()).toEqual([newerOverlay]);
    expect(h.stored.size).toBe(0);
    finishSecond.resolve();
    const committed = await second.committed;
    expect(row(h.manager, committed).text).toBe("newer");
    expect(h.manager.optimisticMessages()).toEqual([]);
  }, 5_000);

  it("reconciles a committed-but-reported failure without deleting or overwriting it", async () => {
    const h = fixture();
    h.storage.writeRecord.mockImplementationOnce(async (record) => {
      h.stored.set(threadOutboxIdentity(record.storageIdentity), clone(record));
      throw new Error("committed before reporting failure");
    });
    const originalInput = { ...payload() };
    const failed = h.manager.enqueueNew(originalInput, null);
    await expect(failed.committed).rejects.toMatchObject({
      reason: "write-failed",
    });
    expect(h.messages()).toEqual([]);
    expect(h.manager.optimisticMessages()).toHaveLength(1);
    const committedBytes = [...h.stored.values()].map((record) => encodeThreadOutboxRecord(record));
    originalInput.text = "caller changed after submission";
    expect(await failed.reconcile()).toBe("committed");
    expect(h.messages()).toHaveLength(1);
    failed.releaseAfterHandback();
    expect(h.manager.optimisticMessages()).toEqual([]);
    await expect(h.manager.enqueueNew(payload(), null).committed).rejects.toMatchObject({
      reason: "identity-occupied",
    });
    expect([...h.stored.values()].map((record) => encodeThreadOutboxRecord(record))).toEqual(
      committedBytes,
    );
    expect(h.storage.writeRecord).toHaveBeenCalledTimes(1);
  });

  it.each(["absent", "unreadable", "content", "command", "foreign"] as const)(
    "reconciles failed admission conservatively for %s storage",
    async (condition) => {
      const h = fixture();
      h.storage.writeRecord.mockRejectedValueOnce(new Error("write failed"));
      const failed = h.manager.enqueueNew(payload(), null);
      await expect(failed.committed).rejects.toMatchObject({ reason: "write-failed" });
      if (condition === "unreadable") {
        h.storage.loadRecords.mockRejectedValueOnce(new Error("cannot read inventory"));
      } else if (condition !== "absent") {
        const content = {
          ...payload(),
          ...(condition === "content" ? { text: "different work" } : {}),
          ...(condition === "command" ? { commandId: CommandId.make("different-command") } : {}),
        };
        const stored = active(content, condition === "foreign" ? "another-account" : null);
        h.stored.set(threadOutboxIdentity(stored.storageIdentity), stored);
      }

      expect(await failed.reconcile()).toBe(condition === "absent" ? "absent" : "unknown");

      expect(h.manager.optimisticMessages()).toHaveLength(1);
      expect(h.storage.writeRecord).toHaveBeenCalledTimes(1);
    },
  );

  it("recognizes upload bookkeeping without releasing the failed file owner", async () => {
    const h = fixture();
    const input = {
      ...payload(),
      attachments: [
        {
          id: "file",
          type: "file" as const,
          name: "file.txt",
          mimeType: "text/plain",
          sizeBytes: 3,
          fileUri: "file:///documents/file.txt",
        },
      ],
    };
    h.storage.writeRecord.mockRejectedValueOnce(new Error("write failed"));
    const failed = h.manager.enqueueNew(input, null);
    await expect(failed.committed).rejects.toMatchObject({ reason: "write-failed" });
    const recorded = active({
      ...input,
      attachments: input.attachments.map((attachment) => ({
        ...attachment,
        uploadedAttachmentId: "pending-file",
        uploadEnvironmentId: input.environmentId,
      })),
    });
    h.stored.set(threadOutboxIdentity(recorded.storageIdentity), recorded);

    expect(await failed.reconcile()).toBe("committed");

    expect(h.manager.optimisticMessages()).toHaveLength(1);
    expect(h.storage.writeRecord).toHaveBeenCalledTimes(1);
  });

  it.each(["same", "id", "environment", "removed"] as const)(
    "keeps failed pending-upload ownership when the record reference is %s",
    async (change) => {
      const h = fixture();
      const input = {
        ...payload(),
        attachments: [
          {
            id: "file",
            type: "file" as const,
            name: "file.txt",
            mimeType: "text/plain",
            sizeBytes: 3,
            fileUri: "file:///documents/file.txt",
            uploadedAttachmentId: "original-pending",
            uploadEnvironmentId: EnvironmentId.make("environment"),
          },
        ],
      };
      h.storage.writeRecord.mockRejectedValueOnce(new Error("write failed"));
      const failed = h.manager.enqueueNew(input, null);
      await expect(failed.committed).rejects.toMatchObject({ reason: "write-failed" });
      const recorded = active({
        ...input,
        attachments: input.attachments.map((attachment) => ({
          ...attachment,
          uploadedAttachmentId:
            change === "removed"
              ? undefined
              : change === "id"
                ? "replacement-pending"
                : attachment.uploadedAttachmentId,
          uploadEnvironmentId:
            change === "removed"
              ? undefined
              : change === "environment"
                ? EnvironmentId.make("another-environment")
                : attachment.uploadEnvironmentId,
        })),
      });
      h.stored.set(threadOutboxIdentity(recorded.storageIdentity), recorded);

      expect(await failed.reconcile()).toBe("committed");
      expect(await failed.releaseAfterRecordOwnership()).toBe(change === "same");
      expect(h.manager.optimisticMessages()).toHaveLength(change === "same" ? 0 : 1);
    },
  );

  it.each(["retained", "bare", "incomplete"] as const)(
    "releases failed ownership only from actual %s record byte authority",
    async (condition) => {
      const h = fixture();
      const input = {
        ...payload(),
        attachments: [
          {
            id: "source",
            type: "file" as const,
            name: "source.txt",
            mimeType: "text/plain",
            sizeBytes: 3,
            fileUri: "file:///source.txt",
          },
        ],
      };
      h.storage.writeRecord.mockImplementationOnce(async (record) => {
        h.stored.set(threadOutboxIdentity(record.storageIdentity), clone(record));
        throw new Error("after commit");
      });
      const failed = h.manager.enqueueNew(input, null);
      await expect(failed.committed).rejects.toMatchObject({ reason: "write-failed" });
      if (condition === "incomplete") {
        expect(await failed.releaseAfterRecordOwnership()).toBe(false);
        expect(h.manager.optimisticMessages()).toHaveLength(1);
        return;
      }
      expect(await failed.reconcile()).toBe("committed");
      if (condition === "bare") {
        const recorded = h.manager.recordAt(input);
        if (recorded === null) throw new Error("Expected committed record");
        await h.manager.authority.claimForDelivery(recorded, invocation(input), () => true);
      }
      const retired = await h.manager.authority.retire(input, "discarded");
      if (retired === null) throw new Error("Expected retained record");
      if (condition === "bare") {
        await h.manager.authority.releaseRetained(retired, () => true);
        // The receipt still establishes the original admission, not ownership
        // after its retained payload was explicitly released.
        expect(await failed.reconcile()).toBe("committed");
      }
      expect(await failed.releaseAfterRecordOwnership()).toBe(condition === "retained");
      expect(h.manager.optimisticMessages()).toHaveLength(condition === "retained" ? 0 : 1);
      expect(await failed.releaseAfterRecordOwnership()).toBe(false);
    },
  );

  it.each([
    "ready",
    "unknown",
    "attempted",
    "refused",
    "confirmed-refusal",
    "acknowledged",
    "discarded",
    "draft-transfer",
  ] as const)(
    "qualifies %s records and keeps retained edits beside a server echo",
    async (state) => {
      const input = payload(state);
      const h = fixture();
      const evidence = refusalEvidence(input);
      const delivery =
        state === "refused" || state === "confirmed-refusal"
          ? {
              state: "refused" as const,
              sourceMessage: evidence.sourceMessage,
              refusal: {
                version: 1 as const,
                source: "workspace-ownership" as const,
                requestId: input.messageId,
                reason: "owned" as const,
                originCommandId: input.commandId,
                originSequence: 1,
              },
            }
          : {
              state:
                state === "ready"
                  ? ("ready" as const)
                  : state === "attempted"
                    ? ("attempted" as const)
                    : ("unknown" as const),
            };
      const original = active(input, null, delivery);
      if (original.kind !== "message") throw new Error("Expected fixture");
      const { message, ...metadata } = original;
      const terminal =
        state === "confirmed-refusal" ||
        state === "acknowledged" ||
        state === "discarded" ||
        state === "draft-transfer";
      const saved = terminal
        ? decodeThreadOutboxRecord({
            ...metadata,
            kind: "retired",
            reason: state,
            retainedMessage: message,
          })
        : original;
      h.stored.set(threadOutboxIdentity(saved.storageIdentity), saved);
      await h.manager.load();
      const loaded = h.manager.recordAt(saved.storageIdentity);
      if (loaded === null) throw new Error("Expected loaded authority");
      const edited = await h.manager.authority.updateContent(loaded, {
        ...input,
        text: "newer local edit",
      });
      if (edited === null) throw new Error("Expected retained edit");
      const projected = row(h.manager, edited);
      const presentation = threadOutboxPresentation(projected, edited);
      expect(presentation.kind).toBe(state === "ready" ? "ready" : "retained");
      expect(presentation.latest?.text).toBe("newer local edit");
      expect(presentation.changed).toBe(state !== "ready");
      const echo = {
        type: "message" as const,
        id: input.messageId,
        createdAt: input.createdAt,
        message: { ...evidence.sourceMessage, text: input.text },
      };
      const feed = appendPendingThreadMessages(
        [echo],
        [echo],
        [projected],
        (entry) => threadOutboxPresentation(entry, h.manager.recordFor(entry)).kind === "retained",
      );
      expect(feed).toHaveLength(state === "ready" ? 1 : 2);
      if (state !== "ready") {
        expect(feed[1]?.id).not.toBe(echo.id);
        expect(feed[1]?.pendingMessage?.text).toBe("newer local edit");
        expect(h.manager.canPrepare(edited)).toBe(false);
      }
      const independent = await h.manager.enqueueNew(payload("independent"), null).committed;
      const token = await h.manager.authority.claimForDelivery(
        independent,
        invocation(payload("independent")),
        () => true,
      );
      expect(token).not.toBeNull();
      if (token === null) throw new Error("Expected independent claim");
      expect(h.manager.authority.consumeClaim(token)?.command.message.text).toBe("independent");
      expect(h.manager.authority.consumeClaim(token)).toBeNull();
    },
  );

  it("does not infer absence from an incomplete inventory", async () => {
    const h = fixture();
    h.storage.writeRecord.mockRejectedValueOnce(new Error("write failed"));
    const failed = h.manager.enqueueNew(payload(), null);
    await expect(failed.committed).rejects.toMatchObject({ reason: "write-failed" });
    h.storage.loadRecords.mockResolvedValueOnce({
      records: [],
      errors: [
        new ThreadOutboxStorageError({
          operation: "load",
          environmentId: null,
          threadId: null,
          messageId: null,
          fileName: "unreadable.json",
          cause: new Error("unreadable"),
        }),
      ],
    });

    expect(await failed.reconcile()).toBe("unknown");

    expect(h.manager.optimisticMessages()).toHaveLength(1);
    expect(h.storage.writeRecord).toHaveBeenCalledTimes(1);
  });

  it("displays partial retained inventory but refuses admission and preserves repaired row references", async () => {
    const source = active(payload(), null, { state: "unknown" });
    if (source.kind !== "message") throw new Error("Expected active source");
    const { message, ...metadata } = source;
    const retained = decodeThreadOutboxRecord({
      ...metadata,
      kind: "retired",
      reason: "discarded",
      retainedMessage: message,
    });
    const h = fixture([retained]);
    let readable = false;
    h.storage.loadRecords.mockImplementation(async () => ({
      records: [...h.stored.values()].map(clone),
      errors: readable
        ? []
        : [
            new ThreadOutboxStorageError({
              operation: "load",
              environmentId: null,
              threadId: null,
              messageId: null,
              fileName: "unreadable.json",
              cause: new Error("unreadable inventory"),
            }),
          ],
    }));
    expect(await h.manager.load()).toBe(false);
    const oldRecord = h.manager.recordAt(retained.storageIdentity);
    if (oldRecord === null) throw new Error("Expected partial record");
    const originalRow = row(h.manager, oldRecord);
    await expect(h.manager.enqueueNew(payload("new"), null).committed).rejects.toMatchObject({
      reason: "inventory-incomplete",
    });
    expect(h.storage.writeRecord).not.toHaveBeenCalled();
    expect(h.messages()).toEqual([originalRow]);
    expect(h.messages()[0]).toBe(originalRow);
    const recoveredQueues = h.queues();
    readable = true;
    expect(await h.manager.load()).toBe(true);
    const current = h.manager.recordAt(retained.storageIdentity);
    if (current === null) throw new Error("Expected reconciled record");
    expect(current).not.toBe(oldRecord);
    expect(row(h.manager, current)).toBe(originalRow);
    expect(h.manager.recordFor(originalRow)).toBe(current);
    expect(h.manager.messageFor(oldRecord)).toBeNull();
    await expect(
      h.manager.authority.updateContent(oldRecord, { ...payload(), text: "stale" }),
    ).resolves.toBeNull();
    expect(h.queues()).toBe(recoveredQueues);
  });

  it("projects exact scope and owner while retaining hidden lifecycle metadata", async () => {
    const a = active(payload(), "a");
    const b = active(payload("message", EnvironmentId.make("other-environment")), "b");
    const local = active(payload("local"));
    const parked = decodeThreadOutboxRecord({
      ...active(payload("parked"), "a"),
      archivedFor: "a",
    });
    const legacy = decodeThreadOutboxRecord({ schemaVersion: 5, ...payload("legacy") });
    const source = active(payload("retained"), "a");
    if (source.kind !== "message") throw new Error("Expected source");
    const { message, ...metadata } = source;
    const retired = decodeThreadOutboxRecord({
      ...metadata,
      kind: "retired",
      reason: "discarded",
      retainedMessage: message,
    });
    const bare = decodeThreadOutboxRecord({
      ...metadata,
      storageIdentity: { ...metadata.storageIdentity, messageId: MessageId.make("bare") },
      transport: {
        ...metadata.transport,
        messageId: MessageId.make("bare"),
        commandId: CommandId.make("command-bare"),
      },
      kind: "retired",
      reason: "discarded",
    });
    const h = fixture([a, b, local, parked, legacy, retired, bare], "a");
    await h.manager.load();
    expect(h.registry.get(h.manager.unassignedRecordCountAtom)).toBe(1);
    expect(h.messages().map((entry) => entry.messageId)).toEqual([
      a.transport.messageId,
      local.transport.messageId,
      retired.transport.messageId,
    ]);
    const terminal = h.manager.recordAt(retired.storageIdentity);
    if (terminal === null) throw new Error("Expected terminal metadata");
    expect(terminal).toMatchObject({
      kind: "retired",
      reason: "discarded",
      delivery: { state: "ready" },
    });
    expect(row(h.manager, terminal).delivery).toEqual({ state: "unknown" });
    await expect(
      h.manager.authority.claimForDelivery(terminal, invocation(payload("retained")), () => true),
    ).resolves.toBeNull();
    expect(h.manager.recordAt(b.storageIdentity)).toEqual(b);
    expect(h.manager.recordAt(parked.storageIdentity)).toEqual(parked);
    expect(h.manager.recordAt(legacy.storageIdentity)).toEqual(legacy);
    expect(h.manager.recordAt(bare.storageIdentity)).toEqual(bare);
    h.manager.setAccountId("b");
    expect(h.messages().map((entry) => entry.environmentId)).toEqual([
      b.transport.environmentId,
      local.transport.environmentId,
    ]);
    h.manager.setAccountId(null);
    expect(h.messages().map((entry) => entry.messageId)).toEqual([local.transport.messageId]);
    expect(h.registry.get(h.manager.unassignedRecordCountAtom)).toBe(1);
    h.manager.setAccountId("a");
    expect(h.messages().some((entry) => entry.messageId === parked.transport.messageId)).toBe(
      false,
    );
    for (const hidden of [b, parked, bare]) {
      const duplicate = h.manager.enqueueNew(
        payload(hidden.transport.messageId, hidden.transport.environmentId),
        "a",
      );
      expect(
        h
          .messages()
          .some((entry) => threadOutboxIdentity(entry) === threadOutboxIdentity(hidden.transport)),
      ).toBe(false);
      await expect(duplicate.committed).rejects.toMatchObject({ reason: "identity-occupied" });
      duplicate.releaseAfterHandback();
    }
  });

  it("returns actual mutation records and leaves unrelated row and queue references stable", async () => {
    const h = fixture();
    const first = await h.manager.enqueueNew(payload(), null).committed;
    const other = await h.manager.enqueueNew(payload("other", EnvironmentId.make("other")), null)
      .committed;
    const firstRow = row(h.manager, first);
    const otherRow = row(h.manager, other);
    const otherQueue = Object.values(h.queues()).find((queue) => queue.includes(otherRow));
    const unchanged = h.queues();
    await h.manager.load();
    await h.manager.flush();
    expect(h.queues()).toBe(unchanged);
    expect(h.manager.recordFor({ ...firstRow })).toBeNull();
    const input = { ...payload(), text: "edited" };
    const edited = await h.manager.authority.updateContent(first, input);
    if (edited === null) throw new Error("Expected committed edit");
    expect(h.manager.recordAt(first.storageIdentity)).toBe(edited);
    expect(h.manager.recordFor(firstRow)).toBeNull();
    expect(row(h.manager, edited)).not.toBe(input);
    expect(row(h.manager, other)).toBe(otherRow);
    expect(Object.values(h.queues()).find((queue) => queue.includes(otherRow))).toBe(otherQueue);
    const afterEdit = h.queues();
    await expect(h.manager.authority.updateContent(first, payload())).resolves.toBeNull();
    expect(h.queues()).toBe(afterEdit);
    h.storage.writeRecord.mockRejectedValueOnce(new Error("edit failed"));
    await expect(h.manager.authority.updateContent(edited, payload())).rejects.toMatchObject({
      reason: "write-failed",
    });
    expect(h.queues()).toBe(afterEdit);
    expect(row(h.manager, edited).text).toBe("edited");
  });

  it("publishes retarget, claim, ACK retirement and release without flattening their results", async () => {
    const h = fixture();
    const input = {
      ...payload(),
      creation: {
        projectId: ProjectId.make("project"),
        workspaceMode: "local" as const,
        branch: null,
        worktreePath: null,
      },
    };
    const first = await h.manager.enqueueNew(input, null).committed;
    const movedInput = { ...input, environmentId: EnvironmentId.make("destination") };
    const moved = await h.manager.authority.retargetReady(first, movedInput);
    if (moved === null) throw new Error("Expected retarget");
    expect(row(h.manager, moved).storageIdentity).toEqual(first.storageIdentity);
    expect(row(h.manager, moved).environmentId).toBe(movedInput.environmentId);
    expect(h.manager.recordAt(first.storageIdentity)).toBe(moved);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    h.storage.writeRecord.mockImplementationOnce(async (record) => {
      entered.resolve();
      await release.promise;
      h.stored.set(threadOutboxIdentity(record.storageIdentity), clone(record));
    });
    const claiming = h.manager.authority.claimForDelivery(
      moved,
      invocation(movedInput),
      () => true,
    );
    await entered.promise;
    expect(h.manager.authority.isReserved(moved)).toBe(true);
    const fresh = h.manager.enqueueNew(payload("independent"), null);
    expect(h.messages().some((entry) => entry.messageId === MessageId.make("independent"))).toBe(
      true,
    );
    expect(h.storage.writeRecord).toHaveBeenCalledTimes(3);
    release.resolve();
    const token = await claiming;
    if (token === null) throw new Error("Expected one-use claim");
    expect(h.manager.authority.consumeClaim(token)).toEqual(invocation(movedInput));
    expect(h.manager.authority.consumeClaim(token)).toBeNull();
    await fresh.committed;
    const claimed = h.manager.recordAt(first.storageIdentity);
    if (claimed === null) throw new Error("Expected attempted record");
    expect(row(h.manager, claimed).delivery).toEqual({ state: "attempted" });
    expect(claimed.original).toMatchObject({ kind: "claim", localSnapshot: movedInput });
    const edited = await h.manager.authority.updateContent(claimed, {
      ...movedInput,
      text: "newer",
    });
    if (edited === null) throw new Error("Expected retained edit");
    const retired = await h.manager.authority.retireAcknowledged(token, { sequence: 7 });
    if (retired === null) throw new Error("Expected retirement");
    expect(retired).toMatchObject({
      kind: "retired",
      reason: "acknowledged",
      acknowledgedSequence: 7,
    });
    expect(retired.original).toEqual(claimed.original);
    expect(row(h.manager, retired).text).toBe("newer");
    const endEditor = h.manager.authority.acquireEditor(retired, () => true);
    if (endEditor === null) throw new Error("Expected editor lease");
    await expect(h.manager.authority.releaseRetained(retired, () => true)).resolves.toBeNull();
    endEditor();
    const released = await h.manager.authority.releaseRetained(retired, () => true);
    if (released === null) throw new Error("Expected release");
    expect(released.released.map((content) => content.text)).toEqual(["newer", movedInput.text]);
    expect(h.manager.recordAt(first.storageIdentity)).toBe(released.record);
    expect(h.manager.messageFor(released.record)).toBeNull();
    expect(released.record.original).toEqual(claimed.original);
    await expect(h.manager.enqueueNew(input, null).committed).rejects.toMatchObject({
      reason: "identity-occupied",
    });
    await expect(h.manager.enqueueNew(movedInput, null).committed).rejects.toMatchObject({
      reason: "identity-occupied",
    });
  }, 5_000);

  it("publishes exact refusal and parked restoration while preserving original and latest content", async () => {
    const input = payload();
    const h = fixture([active(input, "a", { state: "unknown" })], "a");
    await h.manager.load();
    const observed = h.manager.recordAt(input);
    if (observed === null) throw new Error("Expected observed record");
    await h.manager.authority.updateContent(observed, { ...input, text: "latest" });
    const refused = await h.manager.authority.recordRefusal(observed.storageIdentity, {
      sourceScope: { environmentId: input.environmentId, threadId: input.threadId },
      sourceMessage: {
        id: input.messageId,
        role: "user",
        text: "canonical",
        attachments: [],
        turnId: null,
        streaming: false,
        createdAt: input.createdAt,
        updatedAt: input.createdAt,
      },
      activity: {
        id: makeWorkspaceTurnStartRefusalIdentity(input.threadId, input.messageId).activityId,
        tone: "error",
        kind: "provider.turn.start.failed",
        summary: "Not started",
        turnId: null,
        sequence: 9,
        createdAt: input.createdAt,
        payload: {
          version: 1,
          source: "workspace-ownership",
          requestId: input.messageId,
          reason: "owned",
          originCommandId: input.commandId,
          originSequence: 1,
        },
      },
    });
    if (refused === null) throw new Error("Expected exact refusal");
    expect(row(h.manager, refused)).toMatchObject({
      text: "latest",
      delivery: { state: "refused" },
    });
    expect(refused.original).toEqual(observed.original);
    const retired = await h.manager.authority.retire(refused.storageIdentity, "confirmed-refusal");
    if (retired === null) throw new Error("Expected refusal retirement");
    const scope = new Set([input.environmentId]);
    await h.manager.authority.parkAccount("a", scope);
    expect(h.messages()).toEqual([]);
    expect(h.manager.recordAt(input)).toMatchObject({ archivedFor: "a", ownerAccountId: "a" });
    await h.manager.authority.restoreAccount("b", scope);
    expect(h.messages()).toEqual([]);
    await h.manager.authority.restoreAccount("a", scope);
    const restored = h.manager.recordAt(input);
    if (restored === null) throw new Error("Expected restored record");
    expect(restored).toMatchObject({
      kind: "retired",
      reason: "confirmed-refusal",
      ownerAccountId: "a",
    });
    expect(restored.original).toEqual(observed.original);
    expect(row(h.manager, restored)).toMatchObject({
      text: "latest",
      delivery: { state: "refused" },
    });
    const archived = { ...input, delivery: { state: "ready" as const } };
    const outcome = await h.manager.authority.reconcileArchived("a", archived);
    expect(outcome).toEqual({ status: "conflict", record: restored });
    expect(h.manager.recordAt(input)).toBe(restored);
  });

  it("publishes the successful prefix of a failed account operation and keeps hidden overlay owners", async () => {
    const h = fixture([active(payload("first"), "a"), active(payload("second"), "a")], "a");
    await h.manager.load();
    h.storage.writeRecord
      .mockImplementationOnce(async (record) => {
        h.stored.set(threadOutboxIdentity(record.storageIdentity), clone(record));
      })
      .mockRejectedValueOnce(new Error("second park failed"));
    await expect(
      h.manager.authority.parkAccount("a", new Set([payload().environmentId])),
    ).rejects.toMatchObject({ reason: "write-failed" });
    expect(h.messages().map((message) => message.messageId)).toEqual([MessageId.make("second")]);
    expect(h.manager.recordAt(payload("first"))).toMatchObject({ archivedFor: "a" });
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    h.storage.loadRecords.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      return { records: [...h.stored.values()].map(clone), errors: [] };
    });
    const pending = h.manager.enqueueNew(payload("pending"), "a");
    const rejected = expect(pending.committed).rejects.toMatchObject({
      reason: "environment-parked",
    });
    expect(h.manager.optimisticMessages()).toHaveLength(1);
    h.manager.setAccountId("b");
    expect(h.messages()).toEqual([]);
    expect(h.manager.optimisticMessages()).toHaveLength(1);
    await entered.promise;
    release.resolve();
    await rejected;
    expect(h.manager.optimisticMessages()).toHaveLength(1);
    pending.releaseAfterHandback();
    expect(h.manager.optimisticMessages()).toEqual([]);
    expect(h.messages()).toEqual([]);
  }, 5_000);
});
