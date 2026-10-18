import { describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ThreadId,
  makeWorkspaceTurnStartRefusalIdentity,
} from "@t3tools/contracts";
import { vi } from "vite-plus/test";
import { createThreadOutboxAuthority } from "./thread-outbox-authority";
import {
  decodeThreadOutboxRecord,
  encodeThreadOutboxRecord,
  ownedThreadOutboxPayloads,
  type ThreadOutboxRecord,
} from "./thread-outbox-record";
import { ThreadOutboxStorageError, type ThreadOutboxRecordStorage } from "./thread-outbox-storage";
import { threadOutboxIdentity } from "./thread-outbox-model";

const payload = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  messageId: MessageId.make("message"),
  commandId: CommandId.make("command"),
  text: "Fresh user submission",
  attachments: [],
  createdAt: "2026-10-04T00:00:00.000Z",
};
const pendingPayload = {
  ...payload,
  creation: {
    projectId: ProjectId.make("project-a"),
    workspaceMode: "local" as const,
    branch: null,
    worktreePath: null,
  },
};

function fixture(initial: ReadonlyArray<ThreadOutboxRecord> = []) {
  const stored = new Map(
    initial.map((record) => [threadOutboxIdentity(record.storageIdentity), record]),
  );
  let mutations: Promise<unknown> = Promise.resolve();
  const storage = {
    loadRecords: vi.fn<ThreadOutboxRecordStorage["loadRecords"]>(async () => ({
      records: [...stored.values()],
      errors: [],
    })),
    readRecord: async (identity: ThreadOutboxRecord["storageIdentity"]) =>
      stored.get(threadOutboxIdentity(identity)) ?? null,
    writeRecord: vi.fn(async (record: ThreadOutboxRecord) => {
      stored.set(threadOutboxIdentity(record.storageIdentity), record);
    }),
  };
  const authority = createThreadOutboxAuthority({
    storage,
    serialize: (operation) => {
      const result = mutations.then(operation, operation);
      mutations = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  });
  return { authority, storage, stored };
}

function preparedInvocation() {
  return {
    environmentId: payload.environmentId,
    command: {
      type: "thread.turn.start" as const,
      commandId: payload.commandId,
      threadId: payload.threadId,
      message: {
        messageId: payload.messageId,
        role: "user" as const,
        text: "Prepared body",
        attachments: [],
      },
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      createdAt: payload.createdAt,
    },
  };
}

function refusalEvidence(environmentId = payload.environmentId) {
  return {
    sourceScope: { environmentId, threadId: payload.threadId },
    sourceMessage: {
      id: payload.messageId,
      role: "user" as const,
      text: "Canonical persisted source",
      attachments: [],
      turnId: null,
      streaming: false,
      createdAt: payload.createdAt,
      updatedAt: payload.createdAt,
    },
    activity: {
      id: makeWorkspaceTurnStartRefusalIdentity(payload.threadId, payload.messageId).activityId,
      tone: "error",
      kind: "provider.turn.start.failed",
      summary: "Not started",
      turnId: null,
      sequence: 9,
      createdAt: payload.createdAt,
      payload: {
        version: 1,
        source: "workspace-ownership",
        requestId: payload.messageId,
        reason: "owned",
        originCommandId: payload.commandId,
        originSequence: 1,
      },
    },
  };
}

describe("outbox durable authority admission", () => {
  it("holds delivery while any editor lease remains and releases each lease only once", async () => {
    const { authority } = fixture();
    const admitted = await authority.admitNew(payload);
    const first = authority.acquireEditor(admitted, () => true);
    const second = authority.acquireEditor(admitted, () => true);
    if (first === null || second === null) throw new Error("Expected editor leases");
    first();
    first();
    await expect(
      authority.claimForDelivery(admitted, preparedInvocation(), () => true),
    ).resolves.toBeNull();
    second();
    const token = await authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    if (token === null) throw new Error("Expected claim after editors close");
    const [claimed] = authority.knownRecords();
    if (claimed === undefined) throw new Error("Expected claim record");
    const editing = authority.acquireEditor(claimed, () => true);
    if (editing === null) throw new Error("Expected retained-work editor");
    expect(authority.consumeClaim(token)).toBeNull();
    editing();
    expect(authority.consumeClaim(token)).toBeNull();
  });

  it("releases original and latest file owners only after an authorized terminal write", async () => {
    const file = {
      id: "original-file",
      type: "file" as const,
      name: "original.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      fileUri: "file:///original.txt",
    };
    const original = decodeThreadOutboxRecord({
      ...payload,
      attachments: [file],
      schemaVersion: 5,
      delivery: { state: "attempted" },
    });
    const { authority, storage, stored } = fixture([original]);
    await authority.load();
    await authority.updateContent(original, {
      ...payload,
      text: "Latest work",
      attachments: [
        { ...file, id: "latest-file", name: "latest.txt", fileUri: "file:///latest.txt" },
      ],
    });
    const terminal = await authority.retire(original.storageIdentity, "discarded");
    if (terminal === null) throw new Error("Expected terminal");
    expect(
      ownedThreadOutboxPayloads(terminal).flatMap((value) => value.attachments.map((a) => a.id)),
    ).toEqual(["latest-file", "original-file"]);
    const editing = authority.acquireEditor(terminal, () => true);
    if (editing === null) throw new Error("Expected editor");
    await expect(authority.releaseRetained(terminal, () => true)).resolves.toBeNull();
    editing();
    await expect(authority.releaseRetained(terminal, () => false)).resolves.toBeNull();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    storage.writeRecord.mockImplementationOnce(async (record) => {
      entered.resolve();
      await release.promise;
      stored.set(threadOutboxIdentity(record.storageIdentity), record);
    });
    const releasing = authority.releaseRetained(terminal, () => true);
    await entered.promise;
    expect(authority.acquireEditor(terminal, () => true)).toBeNull();
    expect(ownedThreadOutboxPayloads(terminal)).toHaveLength(2);
    release.resolve();
    const result = await releasing;
    if (result === null) throw new Error("Expected committed release");
    expect(result.released).toHaveLength(2);
    expect(ownedThreadOutboxPayloads(result.record)).toEqual([]);
    expect(result.record).toMatchObject({ kind: "retired", original: original.original });
    expect([...stored.values()]).toEqual([result.record]);
  });

  it("keeps payload ownership when release persistence fails", async () => {
    const { authority, storage } = fixture();
    const admitted = await authority.admitNew(payload);
    const terminal = await authority.retire(admitted.storageIdentity, "discarded");
    if (terminal === null) throw new Error("Expected terminal");
    storage.writeRecord.mockRejectedValueOnce(new Error("Release write unavailable"));
    await expect(authority.releaseRetained(terminal, () => true)).rejects.toMatchObject({
      reason: "write-failed",
    });
    expect(authority.knownRecords()).toEqual([terminal]);
    expect(ownedThreadOutboxPayloads(terminal)).toEqual([payload]);
    expect(authority.isReserved(terminal)).toBe(false);
  });

  it("imports an orphaned ready archive only as owned unknown work", async () => {
    const { authority } = fixture();
    const result = await authority.reconcileArchived("account-a", {
      ...payload,
      delivery: { state: "ready" },
    });
    expect(result).toMatchObject({
      status: "imported",
      record: {
        ownerAccountId: "account-a",
        archivedFor: "account-a",
        delivery: { state: "unknown" },
        original: { kind: "legacy-observed" },
        message: payload,
      },
    });
    await authority.restoreAccount("account-a", new Set([payload.environmentId]));
    const [restored] = authority.knownRecords();
    if (restored === undefined) throw new Error("Expected retained archive");
    await expect(
      authority.claimForDelivery(restored, preparedInvocation(), () => true),
    ).resolves.toBeNull();
  });

  it("does not reimport a stale acknowledged copy or overwrite newer retained work", async () => {
    const { authority, storage } = fixture();
    const admitted = await authority.admitNew(payload, "account-a");
    const token = await authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    if (token === null) throw new Error("Expected token");
    authority.consumeClaim(token);
    const [claimed] = authority.knownRecords();
    if (claimed === undefined) throw new Error("Expected claim");
    await authority.updateContent(claimed, { ...payload, text: "Newer work" });
    await authority.retireAcknowledged(token, { sequence: 7 });
    const writes = storage.writeRecord.mock.calls.length;
    await expect(
      authority.reconcileArchived("account-a", {
        ...payload,
        delivery: { state: "ready" },
      }),
    ).resolves.toMatchObject({
      status: "obsolete",
      record: { retainedMessage: { text: "Newer work" } },
    });
    expect(storage.writeRecord).toHaveBeenCalledTimes(writes);
  });

  it("preserves a context-only archive conflict and removes ready eligibility", async () => {
    const { authority } = fixture();
    await authority.admitNew(payload, "account-a");
    const context = {
      version: 1 as const,
      records: [
        {
          version: 1 as const,
          kind: "terminal" as const,
          contextId: ComposerContextId.make("terminal-output"),
          label: "Output",
          terminalId: "main",
          terminalLabel: "Terminal",
          lineStart: 1,
          lineEnd: 1,
          text: "Retain this context",
        },
      ],
    };
    const archived = { ...payload, context };
    const result = await authority.reconcileArchived("account-a", archived);
    expect(result).toMatchObject({
      status: "conflict",
      record: { delivery: { state: "unknown" }, message: payload },
    });
    expect(archived.context).toEqual(context);
  });

  it("ignores derived upload stamps but not user attachment metadata", async () => {
    const { authority } = fixture();
    const file = {
      id: "file",
      type: "file" as const,
      name: "a.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      fileUri: "file:///a.txt",
    };
    await authority.admitNew({ ...payload, attachments: [file] }, "account-a");
    await expect(
      authority.reconcileArchived("account-a", {
        ...payload,
        attachments: [
          { ...file, uploadedAttachmentId: "uploaded", uploadEnvironmentId: payload.environmentId },
        ],
      }),
    ).resolves.toMatchObject({ status: "duplicate" });
    await expect(
      authority.reconcileArchived("account-a", {
        ...payload,
        attachments: [{ ...file, name: "renamed.txt" }],
      }),
    ).resolves.toMatchObject({ status: "conflict" });
  });

  it("does not expose or overwrite another account's authority record", async () => {
    const { authority, storage } = fixture();
    const owned = await authority.admitNew(payload, "account-a");
    await expect(authority.reconcileArchived("account-b", payload)).resolves.toEqual({
      status: "conflict",
      record: null,
    });
    expect(authority.knownRecords()).toEqual([owned]);
    expect(storage.writeRecord).toHaveBeenCalledTimes(1);
  });

  it("retains orphaned refusal evidence in the archive instead of declaring it confirmed", async () => {
    const { authority } = fixture();
    const evidence = refusalEvidence();
    const source = decodeThreadOutboxRecord({
      ...payload,
      schemaVersion: 5,
      delivery: {
        state: "refused",
        sourceMessage: evidence.sourceMessage,
        refusal: evidence.activity.payload,
      },
    });
    await expect(
      authority.reconcileArchived("account-a", {
        ...payload,
        delivery: source.delivery,
      }),
    ).resolves.toMatchObject({ status: "conflict", record: { delivery: { state: "unknown" } } });
  });

  it.each(["ready", "unknown"] as const)(
    "reattaches archived work to a bare %s marker without reopening transport authority",
    async (state) => {
      const marker = decodeThreadOutboxRecord({
        schemaVersion: 6,
        kind: "retired",
        reason: "discarded",
        ownerAccountId: "account-a",
        delivery: { state },
        storageIdentity: {
          environmentId: payload.environmentId,
          threadId: payload.threadId,
          messageId: payload.messageId,
        },
        transport: {
          environmentId: payload.environmentId,
          threadId: payload.threadId,
          messageId: payload.messageId,
          commandId: payload.commandId,
        },
      });
      const { authority } = fixture([marker]);
      const result = await authority.reconcileArchived("account-a", payload);
      expect(result).toMatchObject({
        status: "imported",
        record: {
          kind: "retired",
          retainedMessage: payload,
          original: { kind: "legacy-observed" },
          delivery: { state: "unknown" },
        },
      });
      if (result.record === null) throw new Error("Expected retained record");
      await expect(
        authority.claimForDelivery(result.record, preparedInvocation(), () => true),
      ).resolves.toBeNull();
    },
  );

  it("parks and restores the owning account without losing first-delivery eligibility", async () => {
    const { authority, stored } = fixture();
    await authority.admitNew(payload, "account-a");
    const scope = new Set([payload.environmentId]);
    await authority.parkAccount("account-a", scope);
    expect(authority.knownRecords()).toMatchObject([
      {
        ownerAccountId: "account-a",
        archivedFor: "account-a",
        delivery: { state: "ready" },
      },
    ]);
    const restarted = fixture(
      [...stored.values()].map((record) =>
        decodeThreadOutboxRecord(JSON.parse(JSON.stringify(encodeThreadOutboxRecord(record)))),
      ),
    );
    await restarted.authority.restoreAccount("account-b", scope);
    expect(restarted.authority.knownRecords()[0]?.archivedFor).toBe("account-a");
    await restarted.authority.restoreAccount("account-a", scope);
    const [restored] = restarted.authority.knownRecords();
    if (restored === undefined) throw new Error("Expected owned record");
    expect(restored.ownerAccountId).toBe("account-a");
    expect(restored.archivedFor).toBeUndefined();
    await restarted.authority.parkAccount("account-b", scope);
    expect(restarted.authority.knownRecords()[0]?.ownerAccountId).toBe("account-a");
    expect(restarted.authority.knownRecords()[0]?.archivedFor).toBeUndefined();
    await restarted.authority.restoreAccount("account-a", scope);
    await expect(
      restarted.authority.claimForDelivery(restored, preparedInvocation(), () => true),
    ).resolves.not.toBeNull();
  });

  it("does not assign device-local work to a cloud account", async () => {
    const { authority, storage } = fixture();
    const local = await authority.admitNew(payload);
    await authority.parkAccount("account-a", new Set([payload.environmentId]));
    expect(authority.knownRecords()).toEqual([local]);
    expect(local.ownerAccountId).toBeNull();
    expect(storage.writeRecord).toHaveBeenCalledTimes(1);
    await expect(
      authority.claimForDelivery(local, preparedInvocation(), () => true),
    ).resolves.not.toBeNull();
  });

  it.each([
    ["park", "unassigned"],
    ["park", "local"],
    ["park", "foreign"],
    ["restore", "unassigned"],
    ["restore", "local"],
    ["restore", "foreign"],
  ] as const)("does not infer ownership during %s for %s work", async (operation, owner) => {
    const seed = await fixture().authority.admitNew(payload);
    const { ownerAccountId: _owner, ...metadata } = seed;
    const candidate = {
      ...metadata,
      ...(owner === "unassigned" ? {} : { ownerAccountId: owner === "local" ? null : "account-b" }),
      ...(operation === "restore" ? { archivedFor: "account-a" } : {}),
    };
    if (operation === "restore" && owner !== "unassigned") {
      // Inconsistent known ownership/placement is rejected before authority hydration.
      expect(() => decodeThreadOutboxRecord(candidate)).toThrow();
      return;
    }
    const original = decodeThreadOutboxRecord(candidate);
    const { authority, storage } = fixture([original]);
    const scope = new Set([payload.environmentId]);

    if (operation === "park") await authority.parkAccount("account-a", scope);
    else await authority.restoreAccount("account-a", scope);

    expect(authority.knownRecords()).toEqual([original]);
    expect(storage.writeRecord).not.toHaveBeenCalled();
  });

  it("never restores attempted or retired records as ready", async () => {
    const { authority } = fixture();
    const admitted = await authority.admitNew(payload, "account-a");
    await authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    const scope = new Set([payload.environmentId]);
    await authority.parkAccount("account-a", scope);
    await authority.restoreAccount("account-a", scope);
    const [attempted] = authority.knownRecords();
    if (attempted === undefined) throw new Error("Expected attempt");
    await expect(
      authority.claimForDelivery(attempted, preparedInvocation(), () => true),
    ).resolves.toBeNull();
    await authority.retire(attempted.storageIdentity, "discarded");
    await authority.parkAccount("account-a", scope);
    await authority.restoreAccount("account-a", scope);
    expect(authority.knownRecords()).toMatchObject([
      {
        kind: "retired",
        delivery: { state: "attempted" },
        ownerAccountId: "account-a",
        original: { kind: "claim" },
        retainedMessage: payload,
      },
    ]);
  });

  it("keeps an environment suspended after failed parking until explicit restoration", async () => {
    const { authority, storage, stored } = fixture();
    const admitted = await authority.admitNew(payload, "account-a");
    const scope = new Set([payload.environmentId]);
    storage.writeRecord.mockRejectedValueOnce(new Error("Park write failed"));
    await expect(authority.parkAccount("account-a", scope)).rejects.toMatchObject({
      reason: "write-failed",
    });
    expect([...stored.values()]).toEqual([admitted]);
    await expect(
      authority.claimForDelivery(admitted, preparedInvocation(), () => true),
    ).resolves.toBeNull();
    await expect(
      authority.admitNew(
        {
          ...payload,
          messageId: MessageId.make("new-message"),
          commandId: CommandId.make("new-command"),
        },
        "account-a",
      ),
    ).rejects.toMatchObject({ reason: "environment-parked" });
    await authority.restoreAccount("account-a", scope);
    await expect(
      authority.claimForDelivery(admitted, preparedInvocation(), () => true),
    ).resolves.not.toBeNull();
  });

  it("suspends token issuance when parking arrives during a claim write", async () => {
    const { authority, storage, stored } = fixture();
    const admitted = await authority.admitNew(payload, "account-a");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    storage.writeRecord.mockImplementationOnce(async (record) => {
      entered.resolve();
      await release.promise;
      stored.set(threadOutboxIdentity(record.storageIdentity), record);
    });
    const claiming = authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    await entered.promise;
    const parking = authority.parkAccount("account-a", new Set([payload.environmentId]));
    release.resolve();
    await expect(claiming).resolves.toBeNull();
    await parking;
    expect(authority.knownRecords()).toMatchObject([
      {
        archivedFor: "account-a",
        ownerAccountId: "account-a",
        delivery: { state: "attempted" },
      },
    ]);
  });

  it("does not let an earlier restore clear a later account suspension", async () => {
    const { authority, storage, stored } = fixture();
    await authority.admitNew(payload, "account-a");
    const scope = new Set([payload.environmentId]);
    await authority.parkAccount("account-a", scope);
    const restoringEntered = Promise.withResolvers<void>();
    const restoreRelease = Promise.withResolvers<void>();
    const parkingEntered = Promise.withResolvers<void>();
    const parkRelease = Promise.withResolvers<void>();
    storage.writeRecord
      .mockImplementationOnce(async (record) => {
        restoringEntered.resolve();
        await restoreRelease.promise;
        stored.set(threadOutboxIdentity(record.storageIdentity), record);
      })
      .mockImplementationOnce(async (record) => {
        parkingEntered.resolve();
        await parkRelease.promise;
        stored.set(threadOutboxIdentity(record.storageIdentity), record);
      });
    const restoring = authority.restoreAccount("account-a", scope);
    await restoringEntered.promise;
    const parking = authority.parkAccount("account-a", scope);
    restoreRelease.resolve();
    await restoring;
    await parkingEntered.promise;
    const [temporarilyActive] = authority.knownRecords();
    if (temporarilyActive === undefined) throw new Error("Expected retained record");
    await expect(
      authority.claimForDelivery(temporarilyActive, preparedInvocation(), () => true),
    ).resolves.toBeNull();
    parkRelease.resolve();
    await parking;
    expect(authority.knownRecords()[0]?.archivedFor).toBe("account-a");
  });

  it("retires only a consumed claim's ACK while retaining newer work and its original", async () => {
    const { authority, storage, stored } = fixture();
    const admitted = await authority.admitNew(payload);
    const token = await authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    if (token === null) throw new Error("Expected claim");
    await expect(authority.retireAcknowledged(token, { sequence: 7 })).resolves.toBeNull();
    expect(storage.writeRecord).toHaveBeenCalledTimes(2);
    expect(authority.consumeClaim(token)).not.toBeNull();
    const [attempted] = authority.knownRecords();
    if (attempted === undefined) throw new Error("Expected attempt");
    await authority.updateContent(attempted, { ...payload, text: "Newer retained work" });
    const retired = await authority.retireAcknowledged(token, { sequence: 7 });
    expect(retired).toMatchObject({
      kind: "retired",
      reason: "acknowledged",
      acknowledgedSequence: 7,
      retainedMessage: { text: "Newer retained work" },
      original: { kind: "claim", localSnapshot: payload },
    });
    const writes = storage.writeRecord.mock.calls.length;
    await expect(authority.retireAcknowledged(token, { sequence: 7 })).resolves.toBe(retired);
    expect(storage.writeRecord).toHaveBeenCalledTimes(writes);
    const restarted = fixture(
      [...stored.values()].map((record) =>
        decodeThreadOutboxRecord(JSON.parse(JSON.stringify(encodeThreadOutboxRecord(record)))),
      ),
    );
    await restarted.authority.load();
    await expect(restarted.authority.admitNew(payload)).rejects.toMatchObject({
      reason: "identity-occupied",
    });
    await expect(
      restarted.authority.retireAcknowledged(token, { sequence: 7 }),
    ).resolves.toBeNull();
  });

  it("does not label retirement as confirmed refusal without durable source evidence", async () => {
    const { authority, storage } = fixture();
    const admitted = await authority.admitNew(payload);
    await expect(
      authority.retire(admitted.storageIdentity, "confirmed-refusal"),
    ).resolves.toBeNull();
    expect(storage.writeRecord).toHaveBeenCalledTimes(1);
    await authority.recordRefusal(admitted.storageIdentity, refusalEvidence());
    await expect(
      authority.retire(admitted.storageIdentity, "confirmed-refusal"),
    ).resolves.toMatchObject({
      kind: "retired",
      reason: "confirmed-refusal",
      retainedMessage: payload,
      delivery: { state: "refused" },
      original: { kind: "legacy-observed", localSnapshot: payload },
    });
  });

  it("retries only retirement after its write fails", async () => {
    const { authority, storage, stored } = fixture();
    const admitted = await authority.admitNew(payload);
    const token = await authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    if (token === null) throw new Error("Expected claim");
    authority.consumeClaim(token);
    storage.writeRecord.mockRejectedValueOnce(new Error("Terminal write unavailable"));
    await expect(authority.retireAcknowledged(token, { sequence: 9 })).rejects.toMatchObject({
      reason: "write-failed",
    });
    expect([...stored.values()][0]?.delivery.state).toBe("attempted");
    expect(authority.consumeClaim(token)).toBeNull();
    await expect(authority.retireAcknowledged(token, { sequence: 9 })).resolves.toMatchObject({
      kind: "retired",
      retainedMessage: payload,
      acknowledgedSequence: 9,
    });
  });

  it("retirement during claim persistence prevents token issuance and preserves content", async () => {
    const { authority, storage, stored } = fixture();
    const admitted = await authority.admitNew(payload);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    storage.writeRecord.mockImplementationOnce(async (record) => {
      entered.resolve();
      await release.promise;
      stored.set(threadOutboxIdentity(record.storageIdentity), record);
    });
    const claiming = authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    await entered.promise;
    const retiring = authority.retire(admitted.storageIdentity, "discarded");
    release.resolve();
    await expect(claiming).resolves.toBeNull();
    await expect(retiring).resolves.toMatchObject({
      kind: "retired",
      reason: "discarded",
      retainedMessage: payload,
      original: { kind: "claim" },
    });
  });

  it("rejects another command's refusal without revoking a valid unused claim", async () => {
    const { authority, storage } = fixture();
    const admitted = await authority.admitNew(payload);
    const token = await authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    if (token === null) throw new Error("Expected claim");
    const writes = storage.writeRecord.mock.calls.length;
    const evidence = refusalEvidence();
    const recording = authority.recordRefusal(admitted.storageIdentity, {
      ...evidence,
      activity: {
        ...evidence.activity,
        payload: {
          ...evidence.activity.payload,
          originCommandId: CommandId.make("another-command"),
        },
      },
    });
    const consumable = authority.consumeClaim(token);

    expect(await recording).toBeNull();
    expect(consumable).toEqual(preparedInvocation());
    expect(storage.writeRecord).toHaveBeenCalledTimes(writes);
  });

  it("checks refusal command identity after cold hydration before writing", async () => {
    const seed = fixture();
    const admitted = await seed.authority.admitNew(payload);
    const { authority, storage } = fixture([...seed.stored.values()]);
    const evidence = refusalEvidence();

    expect(
      await authority.recordRefusal(admitted.storageIdentity, {
        ...evidence,
        activity: {
          ...evidence.activity,
          payload: {
            ...evidence.activity.payload,
            originCommandId: CommandId.make("another-command"),
          },
        },
      }),
    ).toBeNull();

    expect(storage.writeRecord).not.toHaveBeenCalled();
    expect(authority.knownRecords()[0]?.delivery.state).toBe("ready");
  });

  it("records exact refusal without replacing newer edits or the immutable claim", async () => {
    const { authority, storage } = fixture();
    const admitted = await authority.admitNew(payload);
    await authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    const [claimed] = authority.knownRecords();
    if (claimed === undefined) throw new Error("Expected claim");
    const edited = await authority.updateContent(claimed, { ...payload, text: "Newer local edit" });
    if (edited === null) throw new Error("Expected edit");
    const evidence = refusalEvidence();
    const refused = await authority.recordRefusal(admitted.storageIdentity, evidence);
    expect(refused).toMatchObject({
      message: { text: "Newer local edit" },
      original: claimed.original,
      delivery: {
        state: "refused",
        sourceMessage: evidence.sourceMessage,
        refusal: evidence.activity.payload,
      },
    });
    const writes = storage.writeRecord.mock.calls.length;
    await expect(authority.recordRefusal(admitted.storageIdentity, evidence)).resolves.toBe(
      refused,
    );
    expect(storage.writeRecord).toHaveBeenCalledTimes(writes);
  });

  it("rejects refusal from the original storage environment after retarget", async () => {
    const { authority, storage } = fixture();
    const admitted = await authority.admitNew(pendingPayload);
    const environmentId = EnvironmentId.make("target");
    const moved = await authority.retargetReady(admitted, { ...pendingPayload, environmentId });
    if (moved === null) throw new Error("Expected retarget");
    const token = await authority.claimForDelivery(
      moved,
      { ...preparedInvocation(), environmentId },
      () => true,
    );
    if (token === null) throw new Error("Expected token");
    const writes = storage.writeRecord.mock.calls.length;
    await expect(
      authority.recordRefusal(moved.storageIdentity, refusalEvidence()),
    ).resolves.toBeNull();
    expect(storage.writeRecord).toHaveBeenCalledTimes(writes);
    expect(authority.consumeClaim(token)).not.toBeNull();
    await expect(
      authority.recordRefusal(moved.storageIdentity, refusalEvidence(environmentId)),
    ).resolves.toMatchObject({ delivery: { state: "refused" } });
  });

  it("revokes an unused token before refusal persistence and keeps the attempt if that write fails", async () => {
    const { authority, storage, stored } = fixture();
    const admitted = await authority.admitNew(payload);
    const token = await authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    if (token === null) throw new Error("Expected token");
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    storage.writeRecord.mockImplementationOnce(async () => {
      entered.resolve();
      await release.promise;
      throw new Error("Refusal write failed");
    });
    const recording = authority.recordRefusal(admitted.storageIdentity, refusalEvidence());
    const failure = expect(recording).rejects.toMatchObject({ reason: "write-failed" });
    await entered.promise;
    expect(authority.consumeClaim(token)).toBeNull();
    release.resolve();
    await failure;
    expect([...stored.values()][0]?.delivery.state).toBe("attempted");
    const [reloaded] = await authority.load();
    if (reloaded === undefined) throw new Error("Expected retained attempt");
    await expect(
      authority.claimForDelivery(reloaded, preparedInvocation(), () => true),
    ).resolves.toBeNull();
  });

  it("does not treat a transient failure as refusal evidence", async () => {
    const { authority, storage } = fixture();
    const admitted = await authority.admitNew(payload);
    const evidence = refusalEvidence();
    await expect(
      authority.recordRefusal(admitted.storageIdentity, {
        ...evidence,
        activity: { ...evidence.activity, payload: { message: "Connection lost" } },
      }),
    ).resolves.toBeNull();
    expect(storage.writeRecord).toHaveBeenCalledTimes(1);
    await expect(
      authority.claimForDelivery(admitted, preparedInvocation(), () => true),
    ).resolves.not.toBeNull();
  });

  it("issues no token if exact refusal arrives while the claim is being written", async () => {
    const { authority, storage, stored } = fixture();
    const admitted = await authority.admitNew(payload);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    storage.writeRecord.mockImplementationOnce(async (record) => {
      entered.resolve();
      await release.promise;
      stored.set(threadOutboxIdentity(record.storageIdentity), record);
    });
    const claim = authority.claimForDelivery(admitted, preparedInvocation(), () => true);
    await entered.promise;
    const refusal = authority.recordRefusal(admitted.storageIdentity, refusalEvidence());
    release.resolve();
    await expect(claim).resolves.toBeNull();
    await expect(refusal).resolves.toMatchObject({
      delivery: { state: "refused" },
      original: { kind: "claim" },
    });
  });

  it("keeps legacy observation, latest edits and canonical refusal distinct", async () => {
    const legacy = decodeThreadOutboxRecord({ ...payload, schemaVersion: 4 });
    const { authority } = fixture([legacy]);
    await authority.load();
    await authority.updateContent(legacy, { ...payload, text: "Latest local edit" });
    const result = await authority.recordRefusal(legacy.storageIdentity, refusalEvidence());
    expect(result).toMatchObject({
      message: { text: "Latest local edit" },
      original: { kind: "legacy-observed", localSnapshot: payload },
      delivery: { state: "refused", sourceMessage: { text: "Canonical persisted source" } },
    });
  });

  it("persists a detached claim before issuing one runtime-local invocation token", async () => {
    const { authority, storage, stored } = fixture();
    const original = await authority.admitNew(payload);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    storage.writeRecord.mockImplementationOnce(async (record) => {
      entered.resolve();
      await release.promise;
      stored.set(threadOutboxIdentity(record.storageIdentity), record);
    });
    const request = preparedInvocation();
    let settled = false;
    const claiming = authority
      .claimForDelivery(original, request, () => true)
      .then((token) => {
        settled = true;
        return token;
      });
    await entered.promise;
    expect(settled).toBe(false);
    expect(authority.isReserved(original)).toBe(true);
    expect([...stored.values()][0]?.delivery.state).toBe("ready");
    await expect(authority.updateContent(original, payload)).resolves.toBeNull();
    await expect(authority.retargetReady(original, pendingPayload)).resolves.toBeNull();
    await expect(authority.admitNew(payload)).rejects.toMatchObject({
      reason: "identity-occupied",
    });
    await expect(authority.claimForDelivery(original, request, () => true)).resolves.toBeNull();
    request.command.message.text = "Mutated caller buffer";
    release.resolve();
    const token = await claiming;
    if (token === null) throw new Error("Expected committed claim token");
    expect(authority.isReserved(original)).toBe(false);
    expect([...stored.values()]).toMatchObject([
      {
        delivery: { state: "attempted" },
        original: {
          kind: "claim",
          localSnapshot: payload,
          invocation: { command: { message: { text: "Prepared body" } } },
        },
      },
    ]);
    const restarted = fixture([...stored.values()]);
    const [loaded] = await restarted.authority.load();
    if (loaded === undefined) throw new Error("Expected attempted record");
    expect(restarted.authority.consumeClaim(token)).toBeNull();
    await expect(
      restarted.authority.claimForDelivery(loaded, preparedInvocation(), () => true),
    ).resolves.toBeNull();
    expect(authority.consumeClaim(token)?.command.message.text).toBe("Prepared body");
    expect(authority.consumeClaim(token)).toBeNull();
  });

  it("does not invoke after a newer content edit commits", async () => {
    const { authority } = fixture();
    const original = await authority.admitNew(payload);
    const token = await authority.claimForDelivery(original, preparedInvocation(), () => true);
    if (token === null) throw new Error("Expected claim");
    const [claimed] = authority.knownRecords();
    if (claimed === undefined) throw new Error("Expected attempted record");
    await authority.updateContent(claimed, { ...payload, text: "New edit" });
    expect(authority.consumeClaim(token)).toBeNull();
    expect(authority.knownRecords()).toMatchObject([
      {
        message: { text: "New edit" },
        delivery: { state: "attempted" },
        original: { localSnapshot: payload },
      },
    ]);
  });

  it("rechecks ownership without ever reviving a consumed token", async () => {
    const { authority, storage } = fixture();
    const original = await authority.admitNew(payload);
    let owned = false;
    await expect(
      authority.claimForDelivery(original, preparedInvocation(), () => owned),
    ).resolves.toBeNull();
    expect(storage.writeRecord).toHaveBeenCalledTimes(1);
    owned = true;
    const token = await authority.claimForDelivery(original, preparedInvocation(), () => owned);
    if (token === null) throw new Error("Expected claim");
    owned = false;
    expect(authority.consumeClaim(token)).toBeNull();
    owned = true;
    expect(authority.consumeClaim(token)).toBeNull();
  });

  it.each(["before", "after", "unreadable", "changed-ready"] as const)(
    "issues no token after a %s commit failure",
    async (outcome) => {
      const { authority, storage, stored } = fixture();
      const original = await authority.admitNew(payload);
      storage.writeRecord.mockImplementationOnce(async (record) => {
        if (outcome === "changed-ready") {
          stored.set(
            threadOutboxIdentity(record.storageIdentity),
            decodeThreadOutboxRecord({
              ...original,
              message: { ...payload, text: "Unexpected stored replacement" },
            }),
          );
        } else if (outcome !== "before")
          stored.set(threadOutboxIdentity(record.storageIdentity), record);
        throw new Error("Injected claim write failure");
      });
      if (outcome === "unreadable") {
        vi.spyOn(storage, "readRecord").mockRejectedValueOnce(new Error("Readback unavailable"));
      }
      await expect(
        authority.claimForDelivery(original, preparedInvocation(), () => true),
      ).rejects.toMatchObject({ reason: "write-failed" });
      expect(authority.isReserved(original)).toBe(
        outcome === "unreadable" || outcome === "changed-ready",
      );
      const [recovered] = await authority.load();
      if (recovered === undefined) throw new Error("Expected recovered record");
      expect(recovered.delivery.state).toBe(
        outcome === "before" || outcome === "changed-ready" ? "ready" : "attempted",
      );
      const retry = await authority.claimForDelivery(recovered, preparedInvocation(), () => true);
      if (outcome === "before") expect(retry).not.toBeNull();
      else expect(retry).toBeNull();
    },
  );

  it("keeps the attempted fence when ownership changes during the claim write", async () => {
    const { authority, storage, stored } = fixture();
    const original = await authority.admitNew(payload);
    let owned = true;
    storage.writeRecord.mockImplementationOnce(async (record) => {
      stored.set(threadOutboxIdentity(record.storageIdentity), record);
      owned = false;
    });
    await expect(
      authority.claimForDelivery(original, preparedInvocation(), () => owned),
    ).resolves.toBeNull();
    expect([...stored.values()][0]?.delivery.state).toBe("attempted");
    owned = true;
    const [attempted] = authority.knownRecords();
    if (attempted === undefined) throw new Error("Expected retained attempt");
    await expect(
      authority.claimForDelivery(attempted, preparedInvocation(), () => owned),
    ).resolves.toBeNull();
  });

  it("retargets only the current ready task while retaining its durable slot and IDs", async () => {
    const { authority, stored, storage } = fixture();
    const original = await authority.admitNew(pendingPayload);
    const target = {
      ...pendingPayload,
      environmentId: EnvironmentId.make("target"),
      creation: { ...pendingPayload.creation, projectId: ProjectId.make("project-b") },
    };
    const moved = await authority.retargetReady(original, target);
    expect(moved).toMatchObject({
      storageIdentity: original.storageIdentity,
      transport: { ...original.transport, environmentId: target.environmentId },
      delivery: { state: "ready" },
      message: target,
    });
    expect(stored.size).toBe(1);
    expect([...stored.keys()]).toEqual([threadOutboxIdentity(original.storageIdentity)]);
    await expect(authority.retargetReady(original, pendingPayload)).resolves.toBeNull();
    expect(storage.writeRecord).toHaveBeenCalledTimes(2);
  });

  it.each(["attempted", "unknown", "parked", "retired", "existing-thread"] as const)(
    "does not retarget a %s record",
    async (state) => {
      const ready = decodeThreadOutboxRecord({
        ...pendingPayload,
        schemaVersion: 5,
        delivery: { state: "ready" },
      });
      const record = decodeThreadOutboxRecord(
        state === "attempted" || state === "unknown"
          ? { ...pendingPayload, schemaVersion: 5, delivery: { state } }
          : state === "parked"
            ? { ...ready, archivedFor: "account" }
            : state === "existing-thread"
              ? { ...ready, message: payload }
              : {
                  schemaVersion: 6,
                  kind: "retired",
                  reason: "discarded",
                  storageIdentity: ready.storageIdentity,
                  transport: ready.transport,
                  delivery: ready.delivery,
                  retainedMessage: pendingPayload,
                },
      );
      const { authority, storage, stored } = fixture([record]);
      await authority.load();
      await expect(
        authority.retargetReady(record, {
          ...pendingPayload,
          environmentId: EnvironmentId.make("target"),
        }),
      ).resolves.toBeNull();
      expect(storage.writeRecord).not.toHaveBeenCalled();
      expect([...stored.values()]).toEqual([record]);
    },
  );

  it("does not retarget into another record's original slot", async () => {
    const occupied = decodeThreadOutboxRecord({
      schemaVersion: 6,
      kind: "retired",
      reason: "discarded",
      delivery: { state: "unknown" },
      storageIdentity: {
        environmentId: "target",
        threadId: payload.threadId,
        messageId: payload.messageId,
      },
      transport: {
        environmentId: "other-current-target",
        threadId: payload.threadId,
        messageId: payload.messageId,
        commandId: payload.commandId,
      },
    });
    const { authority, storage, stored } = fixture([occupied]);
    const original = await authority.admitNew(pendingPayload);
    const before = [...stored.values()];
    await expect(
      authority.retargetReady(original, {
        ...pendingPayload,
        environmentId: EnvironmentId.make("target"),
      }),
    ).resolves.toBeNull();
    expect(storage.writeRecord).toHaveBeenCalledTimes(1);
    expect([...stored.values()]).toEqual(before);
  });

  it.each([
    { threadId: ThreadId.make("other-thread") },
    { messageId: MessageId.make("other-message") },
    { commandId: CommandId.make("other-command") },
  ])("does not mint replacement transport IDs through retarget %#", async (changed) => {
    const { authority, storage } = fixture();
    const original = await authority.admitNew(pendingPayload);
    await expect(
      authority.retargetReady(original, { ...pendingPayload, ...changed }),
    ).resolves.toBeNull();
    expect(storage.writeRecord).toHaveBeenCalledTimes(1);
    expect(authority.knownRecords()).toEqual([original]);
  });

  it.each(["message", "retired"] as const)(
    "updates retained %s content without changing authority or its observed baseline",
    async (kind) => {
      const observed = decodeThreadOutboxRecord({
        ...payload,
        schemaVersion: 5,
        delivery: { state: "attempted" },
      });
      const initial = decodeThreadOutboxRecord(
        kind === "message"
          ? observed
          : {
              schemaVersion: 6,
              kind,
              reason: "discarded",
              archivedFor: "account",
              storageIdentity: observed.storageIdentity,
              transport: observed.transport,
              delivery: observed.delivery,
              original: observed.original,
              retainedMessage: payload,
            },
      );
      const { authority, storage, stored } = fixture([initial]);
      await authority.load();
      const next = await authority.updateContent(initial, { ...payload, text: "Latest edit" });
      expect(next).toMatchObject({
        kind,
        delivery: initial.delivery,
        original: { kind: "legacy-observed", localSnapshot: payload },
      });
      if (next === null) throw new Error("Expected committed edit");
      expect(next).toMatchObject(
        kind === "message"
          ? { message: { text: "Latest edit" } }
          : { retainedMessage: { text: "Latest edit" } },
      );
      expect(next.archivedFor).toBe(initial.archivedFor);
      await expect(
        authority.updateContent(initial, { ...payload, text: "Stale edit" }),
      ).resolves.toBeNull();
      expect(storage.writeRecord).toHaveBeenCalledTimes(1);
      const restarted = fixture(
        [...stored.values()].map((record) =>
          decodeThreadOutboxRecord(JSON.parse(JSON.stringify(encodeThreadOutboxRecord(record)))),
        ),
      );
      await expect(restarted.authority.load()).resolves.toEqual([next]);
    },
  );

  it("preserves the exact immutable claim bundle through later edits", async () => {
    const claimed = decodeThreadOutboxRecord({
      schemaVersion: 6,
      kind: "message",
      storageIdentity: {
        environmentId: payload.environmentId,
        threadId: payload.threadId,
        messageId: payload.messageId,
      },
      transport: {
        environmentId: payload.environmentId,
        threadId: payload.threadId,
        messageId: payload.messageId,
        commandId: payload.commandId,
      },
      delivery: { state: "attempted" },
      message: payload,
      original: {
        kind: "claim",
        localSnapshot: payload,
        invocation: {
          environmentId: payload.environmentId,
          command: {
            type: "thread.turn.start",
            commandId: payload.commandId,
            threadId: payload.threadId,
            message: {
              messageId: payload.messageId,
              role: "user",
              text: "Exact prepared text",
              attachments: [],
            },
            runtimeMode: "full-access",
            interactionMode: "default",
            createdAt: payload.createdAt,
          },
        },
      },
    });
    const before = JSON.stringify(encodeThreadOutboxRecord(claimed));
    const { authority } = fixture([claimed]);
    await authority.load();
    const edited = await authority.updateContent(claimed, {
      ...payload,
      text: "Changed after claim",
    });
    if (edited === null) throw new Error("Expected committed edit");
    expect(edited.original).toEqual(decodeThreadOutboxRecord(JSON.parse(before)).original);
    await expect(
      authority.updateContent(edited, {
        ...payload,
        environmentId: EnvironmentId.make("foreign"),
      }),
    ).resolves.toBeNull();
  });

  it("keeps the old record when content persistence fails", async () => {
    const { authority, storage, stored } = fixture();
    const original = await authority.admitNew(payload);
    storage.writeRecord.mockRejectedValueOnce(new Error("Storage unavailable"));
    await expect(
      authority.updateContent(original, { ...payload, text: "Not committed" }),
    ).rejects.toMatchObject({ reason: "write-failed" });
    expect([...stored.values()]).toEqual([original]);
    expect(authority.knownRecords()).toEqual([original]);
  });

  it("rejects a stale editor after a content write committed but reported failure", async () => {
    const { authority, storage, stored } = fixture();
    const original = await authority.admitNew(payload);
    storage.writeRecord.mockImplementationOnce(async (record) => {
      stored.set(threadOutboxIdentity(record.storageIdentity), record);
      throw new Error("Lost write acknowledgement");
    });
    await expect(
      authority.updateContent(original, { ...payload, text: "Committed edit" }),
    ).rejects.toMatchObject({ reason: "write-failed" });
    await expect(
      authority.updateContent(original, { ...payload, text: "Stale retry" }),
    ).resolves.toBeNull();
    expect(authority.knownRecords()).toMatchObject([{ message: { text: "Committed edit" } }]);
    expect(storage.writeRecord).toHaveBeenCalledTimes(2);
  });

  it("does not attach content to a released terminal marker through ordinary editing", async () => {
    const terminal = decodeThreadOutboxRecord({
      schemaVersion: 6,
      kind: "retired",
      reason: "discarded",
      delivery: { state: "unknown" },
      storageIdentity: {
        environmentId: payload.environmentId,
        threadId: payload.threadId,
        messageId: payload.messageId,
      },
      transport: {
        environmentId: payload.environmentId,
        threadId: payload.threadId,
        messageId: payload.messageId,
        commandId: payload.commandId,
      },
    });
    const { authority, storage } = fixture([terminal]);
    await authority.load();
    await expect(authority.updateContent(terminal, payload)).resolves.toBeNull();
    expect(storage.writeRecord).not.toHaveBeenCalled();
  });

  it("waits for inventory before committing exactly one concurrent admission", async () => {
    const { authority, storage, stored } = fixture();
    const entered = Promise.withResolvers<void>();
    const released = Promise.withResolvers<void>();
    storage.loadRecords.mockImplementationOnce(async () => {
      entered.resolve();
      await released.promise;
      return { records: [], errors: [] };
    });
    const first = authority.admitNew(payload);
    const second = authority.admitNew(payload);
    const secondResult = expect(second).rejects.toMatchObject({ reason: "identity-occupied" });
    await entered.promise;
    expect(storage.writeRecord).not.toHaveBeenCalled();
    released.resolve();
    await expect(first).resolves.toMatchObject({
      kind: "message",
      delivery: { state: "ready" },
      message: payload,
    });
    await secondResult;
    expect(stored.size).toBe(1);
    expect(storage.writeRecord).toHaveBeenCalledTimes(1);
  });

  it("blocks both lineage and current transport of parked terminal records", async () => {
    const record = decodeThreadOutboxRecord({
      schemaVersion: 6,
      kind: "retired",
      reason: "discarded",
      archivedFor: "account",
      delivery: { state: "unknown" },
      storageIdentity: {
        environmentId: "origin",
        threadId: payload.threadId,
        messageId: payload.messageId,
      },
      transport: {
        environmentId: payload.environmentId,
        threadId: payload.threadId,
        messageId: payload.messageId,
        commandId: payload.commandId,
      },
    });
    const { authority, storage } = fixture([record]);
    await expect(authority.admitNew(payload)).rejects.toMatchObject({
      reason: "identity-occupied",
    });
    await expect(
      authority.admitNew({ ...payload, environmentId: EnvironmentId.make("origin") }),
    ).rejects.toMatchObject({ reason: "identity-occupied" });
    await expect(
      authority.admitNew({ ...payload, messageId: MessageId.make("new-message") }),
    ).rejects.toMatchObject({ reason: "identity-occupied" });
    expect(storage.writeRecord).not.toHaveBeenCalled();
    await expect(
      authority.admitNew({
        ...payload,
        environmentId: EnvironmentId.make("unrelated-environment"),
      }),
    ).resolves.toMatchObject({ delivery: { state: "ready" } });
    expect(storage.writeRecord).toHaveBeenCalledTimes(1);
  });

  it("does not infer an empty slot from an incomplete inventory", async () => {
    const { authority, storage } = fixture();
    const available = decodeThreadOutboxRecord({
      ...payload,
      schemaVersion: 5,
      messageId: "other-message",
      commandId: "other-command",
    });
    storage.loadRecords.mockResolvedValueOnce({
      records: [available],
      errors: [
        new ThreadOutboxStorageError({
          operation: "read-message",
          environmentId: null,
          threadId: null,
          messageId: null,
          fileName: "unknown.json",
          cause: new Error("unreadable"),
        }),
      ],
    });
    await expect(authority.admitNew(payload)).rejects.toMatchObject({
      reason: "inventory-incomplete",
    });
    expect(storage.writeRecord).not.toHaveBeenCalled();
    expect(authority.knownRecords()).toEqual([available]);
  });

  it("reconciles a committed but reported failed write before admitting again", async () => {
    const { authority, storage, stored } = fixture();
    storage.writeRecord.mockImplementationOnce(async (record) => {
      stored.set(threadOutboxIdentity(record.storageIdentity), record);
      throw new Error("Commit acknowledgement lost");
    });
    await expect(authority.admitNew(payload)).rejects.toMatchObject({ reason: "write-failed" });
    await expect(authority.admitNew(payload)).rejects.toMatchObject({
      reason: "identity-occupied",
    });
    expect(storage.loadRecords).toHaveBeenCalledTimes(2);
    expect(storage.writeRecord).toHaveBeenCalledTimes(1);
  });

  it("rejects copied authority fields in fresh submission input", async () => {
    const { authority, storage } = fixture();
    const copied = { ...payload, delivery: { state: "ready" } };
    await expect(authority.admitNew(copied)).rejects.toThrow();
    expect(storage.writeRecord).not.toHaveBeenCalled();
  });
});
