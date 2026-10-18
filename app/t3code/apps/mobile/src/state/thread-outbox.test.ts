import { describe, expect, it } from "@effect/vitest";
import { EnvironmentNotRegisteredError } from "@t3tools/client-runtime/connection";
import { isTransportConnectionErrorMessage } from "@t3tools/client-runtime/errors";
import { EnvironmentRpcUnavailableError } from "@t3tools/client-runtime/rpc";
import {
  CommandId,
  ComposerContextId,
  EnvironmentAuthorizationError,
  EnvironmentId,
  MessageId,
  OrchestrationDispatchCommandError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { AtomRegistry } from "effect/unstable/reactivity";
import * as RpcClientError from "effect/unstable/rpc/RpcClientError";
import * as Socket from "effect/unstable/socket/Socket";
import { onTestFinished, vi } from "vite-plus/test";

const outboxFiles = vi.hoisted(() => new Map<string, string | Error>());

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  digestStringAsync: async (_algorithm: string, text: string) => {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join(
      "",
    );
  },
}));

vi.mock("expo-file-system", () => {
  class Directory {
    create() {}

    list() {
      return Array.from(outboxFiles.keys(), (name) => new File(name));
    }
  }

  class File {
    readonly name: string;
    readonly parentDirectory = new Directory();

    constructor(...parts: [string] | [Directory, string]) {
      this.name = parts.length === 1 ? parts[0] : parts[1];
    }

    get exists() {
      return outboxFiles.has(this.name);
    }

    create() {
      outboxFiles.set(this.name, "");
    }

    write(contents: string) {
      outboxFiles.set(this.name, contents);
    }

    moveSync(file: File) {
      const contents = outboxFiles.get(this.name);
      if (contents === undefined) throw new Error("Missing file");
      outboxFiles.set(file.name, contents);
      outboxFiles.delete(this.name);
    }

    delete() {
      outboxFiles.delete(this.name);
    }

    async text(): Promise<string> {
      const contents = outboxFiles.get(this.name);
      if (contents instanceof Error) throw contents;
      if (contents === undefined) throw new Error("Missing file");
      return contents;
    }
  }

  return {
    File,
    Directory,
    Paths: { document: "/documents" },
  };
});

import {
  decodeQueuedThreadMessage,
  encodeQueuedThreadMessage,
  groupQueuedThreadMessages,
  isQueuedThreadCreationSendable,
  modelSelectionsEqual,
  resolveThreadOutboxDeliveryAction,
  resolveThreadOutboxDispatchStep,
  resolveThreadOutboxFailureAction,
  resolveQueuedThreadSettings,
  shouldRetryThreadOutboxDelivery,
  threadOutboxRetryDelayMs,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import { createThreadOutboxManager, ThreadOutboxManagerError } from "./thread-outbox-manager";
import { decodeThreadOutboxRecord, encodeThreadOutboxRecord } from "./thread-outbox-record";
import {
  expoThreadOutboxStorage,
  threadOutboxWriteState,
  ThreadOutboxStorageError,
  type ThreadOutboxLoadResult,
  type ThreadOutboxStorage,
} from "./thread-outbox-storage";

function queuedMessage(input: {
  readonly environmentId?: string;
  readonly threadId?: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly delivery?: QueuedThreadMessage["delivery"];
}): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make(input.environmentId ?? "environment-1"),
    threadId: ThreadId.make(input.threadId ?? "thread-1"),
    messageId: MessageId.make(input.messageId),
    commandId: CommandId.make(`command-${input.messageId}`),
    text: input.messageId,
    attachments: [],
    createdAt: input.createdAt,
    ...(input.delivery === undefined ? {} : { delivery: input.delivery }),
  };
}

describe("thread outbox", () => {
  it("invalidates attachment inventories across a tracked record write", async () => {
    onTestFinished(() => outboxFiles.clear());
    const before = threadOutboxWriteState();
    const record = decodeThreadOutboxRecord(
      encodeQueuedThreadMessage(
        queuedMessage({
          messageId: "write-epoch",
          createdAt: "2026-10-04T00:00:00.000Z",
        }),
      ),
    );
    const writing = expoThreadOutboxStorage.writeRecord(record);
    expect(threadOutboxWriteState().pending).toBe(true);
    expect(threadOutboxWriteState().revision).toBeGreaterThan(before.revision);
    await writing;
    expect(threadOutboxWriteState().pending).toBe(false);
    expect(threadOutboxWriteState().revision).toBeGreaterThan(before.revision);
  });

  it("does not write or remove an optimistic enqueue when the inventory is incomplete", async () => {
    const registry = AtomRegistry.make();
    onTestFinished(() => registry.dispose());
    const write = vi.fn(async (_message: QueuedThreadMessage) => {});
    const remove = vi.fn(async (_message: QueuedThreadMessage) => {});
    let readAvailable = false;
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () =>
          readAvailable
            ? {
                messages: [{ ...message, delivery: { state: "attempted" as const } }],
                errors: [],
              }
            : {
                messages: [],
                errors: [
                  new ThreadOutboxStorageError({
                    operation: "read-message",
                    environmentId: null,
                    threadId: null,
                    messageId: null,
                    fileName: "unreadable.json",
                    cause: new Error("Unreadable authority"),
                  }),
                ],
              },
        write,
        remove,
      },
    });
    const message = queuedMessage({
      messageId: "incomplete-admission",
      createdAt: "2026-10-04T00:00:00.000Z",
      delivery: { state: "ready" },
    });
    await expect(manager.enqueue(message)).rejects.toBeInstanceOf(ThreadOutboxManagerError);
    expect(write).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    await expect(manager.confirmQueued(message)).resolves.toBe(false);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({});
    readAvailable = true;
    await expect(manager.load()).resolves.toBe(true);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [{ ...message, delivery: { state: "attempted" } }],
    });
  });

  it("loads and replaces a terminal record in its original durable slot", async () => {
    onTestFinished(() => outboxFiles.clear());
    const original = queuedMessage({
      messageId: "record-slot",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const identity = {
      environmentId: original.environmentId,
      threadId: original.threadId,
      messageId: original.messageId,
    };
    const record = decodeThreadOutboxRecord(
      encodeQueuedThreadMessage({
        ...original,
        environmentId: EnvironmentId.make("environment-2"),
        storageIdentity: identity,
        delivery: { state: "attempted" },
      }),
    );
    await expoThreadOutboxStorage.writeRecord(record);
    await expect(expoThreadOutboxStorage.readRecord(identity)).resolves.toEqual(record);
    await expect(expoThreadOutboxStorage.readRecord(record.transport)).resolves.toBeNull();
    const terminal = decodeThreadOutboxRecord({
      schemaVersion: 6,
      kind: "retired",
      reason: "discarded",
      storageIdentity: record.storageIdentity,
      transport: record.transport,
      delivery: record.delivery,
      original: record.original,
    });
    await expoThreadOutboxStorage.writeRecord(terminal);
    expect(outboxFiles.size).toBe(1);
    await expect(expoThreadOutboxStorage.loadRecords()).resolves.toEqual({
      records: [terminal],
      errors: [],
    });
  });

  it("does not fall back to a legacy copy when the scoped authority is unreadable", async () => {
    onTestFinished(() => outboxFiles.clear());
    const message = queuedMessage({
      messageId: "unreadable-scoped",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const record = decodeThreadOutboxRecord(encodeQueuedThreadMessage(message));
    await expoThreadOutboxStorage.writeRecord(record);
    const fileName = [...outboxFiles.keys()][0];
    if (fileName === undefined) throw new Error("Expected scoped record");
    outboxFiles.set(fileName, "{");
    outboxFiles.set("unreadable-scoped.json", JSON.stringify(encodeQueuedThreadMessage(message)));
    const before = new Map(outboxFiles);
    await expect(expoThreadOutboxStorage.readRecord(record.storageIdentity)).rejects.toMatchObject({
      operation: "read-message",
      fileName,
    });
    const loaded = await expoThreadOutboxStorage.loadRecords();
    expect(loaded.errors).toHaveLength(1);
    expect(loaded.records).toEqual([]);
    expect(outboxFiles).toEqual(before);
  });

  it("preserves committed record bytes when atomic replacement fails", async () => {
    onTestFinished(() => outboxFiles.clear());
    const message = queuedMessage({
      messageId: "record-write-failure",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const record = decodeThreadOutboxRecord(encodeQueuedThreadMessage(message));
    await expoThreadOutboxStorage.writeRecord(record);
    const { File } = await import("expo-file-system");
    const rename = vi.spyOn(File.prototype, "moveSync").mockImplementationOnce(() => {
      throw new Error("Injected pre-rename failure");
    });
    onTestFinished(() => rename.mockRestore());
    await expect(
      expoThreadOutboxStorage.writeRecord({
        ...record,
        archivedFor: "account-1",
      }),
    ).rejects.toMatchObject({ operation: "write" });
    await expect(expoThreadOutboxStorage.readRecord(record.storageIdentity)).resolves.toEqual(
      record,
    );
    await expect(expoThreadOutboxStorage.loadRecords()).resolves.toEqual({
      records: [record],
      errors: [],
    });
  });

  it.each(["write", "remove"] as const)(
    "prevents legacy %s from erasing a version6 terminal marker",
    async (operation) => {
      onTestFinished(() => outboxFiles.clear());
      const message = queuedMessage({
        messageId: "terminal",
        createdAt: "2026-10-04T00:00:00.000Z",
      });
      await expoThreadOutboxStorage.write(message);
      const fileName = [...outboxFiles.keys()][0];
      if (fileName === undefined) throw new Error("Expected scoped fixture file");
      const marker = decodeThreadOutboxRecord({
        schemaVersion: 6,
        kind: "retired",
        reason: "discarded",
        delivery: { state: "unknown" },
        storageIdentity: {
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
        },
        transport: {
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          commandId: message.commandId,
        },
      });
      outboxFiles.set(fileName, JSON.stringify(encodeThreadOutboxRecord(marker)));
      outboxFiles.set("terminal.json", JSON.stringify(encodeQueuedThreadMessage(message)));
      const before = new Map(outboxFiles);
      const legacyLoad = await expoThreadOutboxStorage.load();
      expect(legacyLoad.messages).toEqual([]);
      expect(legacyLoad.errors).toHaveLength(1);
      await expect(expoThreadOutboxStorage[operation](message)).rejects.toBeInstanceOf(
        ThreadOutboxStorageError,
      );
      expect(outboxFiles).toEqual(before);
    },
  );

  it.each(["ready", "attempted", "unknown", "refused", "legacy"] as const)(
    "preserves authoritative %s delivery metadata when saving stale editor content",
    async (state) => {
      onTestFinished(() => outboxFiles.clear());
      const registry = AtomRegistry.make();
      onTestFinished(() => registry.dispose());
      const manager = createThreadOutboxManager({ registry, storage: expoThreadOutboxStorage });
      const base = queuedMessage({
        messageId: "editor-fence",
        createdAt: "2026-10-04T00:00:00.000Z",
      });
      const original = decodeQueuedThreadMessage({
        ...base,
        schemaVersion: 5,
        ...(state === "legacy"
          ? {}
          : {
              delivery:
                state === "refused"
                  ? {
                      state,
                      sourceMessage: {
                        id: base.messageId,
                        role: "user",
                        text: "Canonical source",
                        attachments: [],
                        turnId: null,
                        streaming: false,
                        createdAt: base.createdAt,
                        updatedAt: base.createdAt,
                      },
                      refusal: {
                        version: 1,
                        source: "workspace-ownership",
                        requestId: base.messageId,
                        reason: "owned",
                        originCommandId: base.commandId,
                        originSequence: 1,
                      },
                    }
                  : { state },
            }),
      });
      await manager.enqueue(original);
      const edited: QueuedThreadMessage = {
        ...original,
        text: "Preserve this newer edit",
        delivery: { state: state === "ready" ? "attempted" : "ready" },
      };
      await expect(manager.update(edited, manager.revisionOf(original))).resolves.toBe(true);
      const expected = { ...original, text: edited.text };
      expect((await expoThreadOutboxStorage.load()).messages).toEqual([expected]);
      expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
        "environment-1:thread-1": [expected],
      });
      const { delivery: _omitted, ...withoutDelivery } = expected;
      await expect(manager.update(withoutDelivery, manager.revisionOf(expected))).resolves.toBe(
        true,
      );
      expect((await expoThreadOutboxStorage.load()).messages).toEqual([expected]);
      if (state !== "ready") {
        await expect(
          manager.update(
            {
              ...expected,
              commandId: CommandId.make("replacement-command"),
            },
            manager.revisionOf(expected),
          ),
        ).resolves.toBe(false);
      }

      const retarget = {
        ...expected,
        environmentId: EnvironmentId.make("environment-2"),
        storageIdentity: {
          environmentId: original.environmentId,
          threadId: original.threadId,
          messageId: original.messageId,
        },
      };
      await expect(manager.update(retarget, manager.revisionOf(expected))).resolves.toBe(
        state === "ready",
      );
      expect((await expoThreadOutboxStorage.load()).messages).toEqual([
        state === "ready" ? retarget : expected,
      ]);
      if (state !== "ready") {
        const before = registry.get(manager.queuedMessagesByThreadKeyAtom);
        const persisted = new Map(outboxFiles);
        const revision = manager.revisionOf(expected);
        const { File } = await import("expo-file-system");
        const writes = vi.spyOn(File.prototype, "write");
        onTestFinished(() => writes.mockRestore());
        await expect(
          manager.enqueue({
            ...expected,
            text: "Unsaved replacement stays with its caller",
            delivery: { state: "ready" },
          }),
        ).rejects.toBeInstanceOf(ThreadOutboxManagerError);
        expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toBe(before);
        expect(manager.revisionOf(expected)).toBe(revision);
        expect(outboxFiles).toEqual(persisted);

        const coldRegistry = AtomRegistry.make();
        onTestFinished(() => coldRegistry.dispose());
        const cold = createThreadOutboxManager({
          registry: coldRegistry,
          storage: expoThreadOutboxStorage,
        });
        const firstCold = cold.enqueue({
          ...expected,
          delivery: { state: "ready" },
        });
        const secondCold = cold.enqueue({
          ...expected,
          text: "Concurrent unaccepted edit",
          delivery: { state: "ready" },
        });
        await Promise.all([
          expect(firstCold).rejects.toBeInstanceOf(ThreadOutboxManagerError),
          expect(secondCold).rejects.toBeInstanceOf(ThreadOutboxManagerError),
        ]);
        expect(outboxFiles).toEqual(persisted);
        expect(coldRegistry.get(cold.queuedMessagesByThreadKeyAtom)).toEqual({
          "environment-1:thread-1": [expected],
        });

        const restartedRegistry = AtomRegistry.make();
        onTestFinished(() => restartedRegistry.dispose());
        const restarted = createThreadOutboxManager({
          registry: restartedRegistry,
          storage: expoThreadOutboxStorage,
        });
        await expect(restarted.load()).resolves.toBe(true);
        await expect(
          restarted.enqueue({
            ...expected,
            delivery: { state: "ready" },
          }),
        ).rejects.toBeInstanceOf(ThreadOutboxManagerError);
        expect(restartedRegistry.get(restarted.queuedMessagesByThreadKeyAtom)).toEqual({
          "environment-1:thread-1": [expected],
        });
        expect(outboxFiles).toEqual(persisted);
        expect(writes).not.toHaveBeenCalled();
      }
    },
  );

  it("keeps manager revisions, edits and environment removal scoped for equal message IDs", async () => {
    onTestFinished(() => outboxFiles.clear());
    const registry = AtomRegistry.make();
    onTestFinished(() => registry.dispose());
    const manager = createThreadOutboxManager({ registry, storage: expoThreadOutboxStorage });
    const first = queuedMessage({ messageId: "equal-id", createdAt: "2026-10-04T00:00:00.000Z" });
    const second = {
      ...first,
      environmentId: EnvironmentId.make("environment-2"),
      text: "Keep second",
    };
    await manager.enqueue(first);
    const revision = manager.revisionOf(first);
    await manager.enqueue(second);
    expect(manager.revisionOf(first)).toBe(revision);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [first],
      "environment-2:thread-1": [second],
    });
    const edited = { ...first, text: "Edit first only" };
    await expect(manager.update(edited, revision)).resolves.toBe(true);
    expect(manager.revisionOf(second)).toBe(1);
    await expect(manager.clearEnvironment(first.environmentId)).resolves.toEqual([edited]);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-2:thread-1": [second],
    });
    expect((await expoThreadOutboxStorage.load()).messages).toEqual([second]);
  });

  it("retargets one pending record atomically without resurrecting its previous scope", async () => {
    onTestFinished(() => outboxFiles.clear());
    const registry = AtomRegistry.make();
    onTestFinished(() => registry.dispose());
    const manager = createThreadOutboxManager({ registry, storage: expoThreadOutboxStorage });
    const original = queuedMessage({
      delivery: { state: "ready" },
      messageId: "retarget",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    await manager.enqueue(original);
    const moved = {
      ...original,
      environmentId: EnvironmentId.make("environment-2"),
      storageIdentity: {
        environmentId: original.environmentId,
        threadId: original.threadId,
        messageId: original.messageId,
      },
    };
    await manager.enqueue(moved);
    expect((await expoThreadOutboxStorage.load()).messages).toEqual([moved]);
    expect(outboxFiles.size).toBe(1);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-2:thread-1": [moved],
    });
  });

  it("rejects retargeting into another record without changing either scope", async () => {
    onTestFinished(() => outboxFiles.clear());
    const registry = AtomRegistry.make();
    onTestFinished(() => registry.dispose());
    const manager = createThreadOutboxManager({ registry, storage: expoThreadOutboxStorage });
    const first = queuedMessage({
      messageId: "retarget-conflict",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const second = {
      ...first,
      environmentId: EnvironmentId.make("environment-2"),
      text: "Keep second",
    };
    await manager.enqueue(first);
    await manager.enqueue(second);
    const before = registry.get(manager.queuedMessagesByThreadKeyAtom);
    const persisted = new Map(outboxFiles);
    await expect(
      manager.enqueue({
        ...first,
        environmentId: second.environmentId,
        storageIdentity: {
          environmentId: first.environmentId,
          threadId: first.threadId,
          messageId: first.messageId,
        },
      }),
    ).rejects.toBeInstanceOf(ThreadOutboxManagerError);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toBe(before);
    expect(outboxFiles).toEqual(persisted);
  });

  it("stores and removes the same message ID independently across scopes", async () => {
    onTestFinished(() => outboxFiles.clear());
    const first = queuedMessage({
      environmentId: "environment:one",
      threadId: "thread",
      messageId: "same-message",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const second = {
      ...first,
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("one:thread"),
      text: "Other scope",
    };
    await expoThreadOutboxStorage.write(first);
    await expoThreadOutboxStorage.write(second);
    expect((await expoThreadOutboxStorage.load()).messages).toEqual(
      expect.arrayContaining([first, second]),
    );
    expect(outboxFiles.size).toBe(2);
    await expoThreadOutboxStorage.remove(first);
    expect((await expoThreadOutboxStorage.load()).messages).toEqual([second]);
  });

  it("does not delete a foreign legacy filename while migrating a scoped message", async () => {
    onTestFinished(() => outboxFiles.clear());
    const first = queuedMessage({
      messageId: "shared-legacy",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const foreign = { ...first, environmentId: EnvironmentId.make("environment-2") };
    outboxFiles.set("shared-legacy.json", JSON.stringify(encodeQueuedThreadMessage(foreign)));
    await expoThreadOutboxStorage.write(first);
    expect(outboxFiles.has("shared-legacy.json")).toBe(true);
    await expoThreadOutboxStorage.remove(first);
    expect((await expoThreadOutboxStorage.load()).messages).toEqual([foreign]);
  });

  it("prefers a committed scoped record over a redundant legacy copy", async () => {
    onTestFinished(() => outboxFiles.clear());
    const message = queuedMessage({
      messageId: "migration-copy",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const committed = {
      ...message,
      text: "Committed local work",
      delivery: { state: "attempted" as const },
    };
    await expoThreadOutboxStorage.write(committed);
    outboxFiles.set("migration-copy.json", JSON.stringify({ ...message, schemaVersion: 3 }));
    expect((await expoThreadOutboxStorage.load()).messages).toEqual([committed]);
  });

  it("keeps a committed scoped write when unreadable legacy cleanup fails", async () => {
    onTestFinished(() => outboxFiles.clear());
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warn.mockRestore());
    const message = queuedMessage({
      messageId: "unreadable-legacy",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    outboxFiles.set("unreadable-legacy.json", "{");
    await expect(expoThreadOutboxStorage.write(message)).resolves.toBeUndefined();
    expect(outboxFiles.get("unreadable-legacy.json")).toBe("{");
    const loaded = await expoThreadOutboxStorage.load();
    expect(loaded.messages).toEqual([message]);
    expect(loaded.errors).toHaveLength(1);
    expect(
      warn.mock.calls.some(
        ([, error]) =>
          error instanceof ThreadOutboxStorageError && error.operation === "legacy-cleanup",
      ),
    ).toBe(true);
  });

  it.each(["ready", "attempted", "unknown"] as const)(
    "retains the durable %s delivery state across a queue round trip",
    (state) => {
      const message = queuedMessage({
        messageId: "delivery-state",
        createdAt: "2026-10-04T00:00:00.000Z",
      });
      const decoded = decodeQueuedThreadMessage({
        ...message,
        schemaVersion: 5,
        delivery: { state },
      });
      expect(decoded.delivery).toEqual({ state });
      expect(decodeQueuedThreadMessage(encodeQueuedThreadMessage(decoded))).toEqual(decoded);
    },
  );

  it.each([1, 2, 3, 4])(
    "never trusts delivery eligibility from legacy schema %i",
    (schemaVersion) => {
      const message = queuedMessage({
        messageId: "legacy-delivery",
        createdAt: "2026-10-04T00:00:00.000Z",
      });
      const decoded = decodeQueuedThreadMessage({
        ...message,
        schemaVersion,
        delivery: { state: "ready" },
        storageIdentity: {
          environmentId: "untrusted-environment",
          threadId: "untrusted-thread",
          messageId: message.messageId,
        },
      });
      expect(decoded.delivery).toBeUndefined();
      expect(decoded.storageIdentity).toBeUndefined();
      expect(decoded.text).toBe(message.text);
    },
  );

  it("retains correlated refused source separately from edited local payload", () => {
    const message = queuedMessage({
      messageId: "refused-delivery",
      createdAt: "2026-10-04T00:00:00.000Z",
    });
    const delivery = {
      state: "refused",
      sourceMessage: {
        id: message.messageId,
        role: "user",
        text: "Original persisted intent",
        attachments: [],
        turnId: null,
        streaming: false,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
      },
      refusal: {
        version: 1,
        source: "workspace-ownership",
        requestId: message.messageId,
        reason: "owned",
        originCommandId: message.commandId,
        originSequence: 1,
      },
    };
    const stored = {
      ...message,
      schemaVersion: 5,
      text: "Newer local edits",
      delivery,
    };
    const decoded = decodeQueuedThreadMessage(stored);
    expect(decoded.text).toBe("Newer local edits");
    expect(decoded.delivery).toEqual(delivery);
    expect(() =>
      decodeQueuedThreadMessage({
        ...stored,
        delivery: { ...delivery, sourceMessage: { ...delivery.sourceMessage, id: "foreign" } },
      }),
    ).toThrow();
    expect(() =>
      decodeQueuedThreadMessage({
        ...stored,
        delivery: { ...delivery, refusal: { ...delivery.refusal, requestId: "foreign" } },
      }),
    ).toThrow();
  });

  it("retains structured context through a persisted offline queue round trip", () => {
    const message: QueuedThreadMessage = {
      ...queuedMessage({ messageId: "context-message", createdAt: "2026-09-06T12:00:00.000Z" }),
      text: "[Build](t3-context://v1/terminal/build-output)",
      context: {
        version: 1,
        records: [
          {
            version: 1,
            kind: "terminal",
            contextId: ComposerContextId.make("build-output"),
            label: "Build",
            terminalId: "main",
            terminalLabel: "Terminal",
            lineStart: 2,
            lineEnd: 2,
            text: "Build failed",
          },
        ],
      },
    };
    expect(
      decodeQueuedThreadMessage(JSON.parse(JSON.stringify(encodeQueuedThreadMessage(message)))),
    ).toEqual(message);
  });
  it.each(["read", "json", "schema"] as const)(
    "recovers usable messages without permitting cleanup after a record %s failure",
    async (failure) => {
      onTestFinished(() => outboxFiles.clear());
      const first = queuedMessage({
        messageId: "message-1",
        createdAt: "2026-06-08T10:00:01.000Z",
      });
      const second = queuedMessage({
        environmentId: "environment-2",
        messageId: "message-2",
        createdAt: "2026-06-08T10:00:02.000Z",
      });
      // Put the unreadable record first to check that later records still load.
      outboxFiles.set(
        "message-2.json",
        failure === "read"
          ? new Error("storage unavailable")
          : failure === "json"
            ? "{"
            : JSON.stringify({ ...second, schemaVersion: 999 }),
      );
      outboxFiles.set("message-1.json", JSON.stringify(encodeQueuedThreadMessage(first)));
      const unreadable = outboxFiles.get("message-2.json");

      await expect(expoThreadOutboxStorage.load()).resolves.toMatchObject({
        messages: [first],
        errors: [{ operation: "read-message", fileName: "message-2.json" }],
      });

      const registry = AtomRegistry.make();
      onTestFinished(() => registry.dispose());
      const manager = createThreadOutboxManager({
        registry,
        storage: expoThreadOutboxStorage,
        warn: () => {},
      });
      await expect(manager.load()).resolves.toBe(false);
      const recovered = registry.get(manager.queuedMessagesByThreadKeyAtom)[
        "environment-1:thread-1"
      ]![0]!;
      expect(recovered).toEqual(first);
      await expect(manager.confirmQueued(recovered)).resolves.toBe(true);
      const edited = { ...recovered, text: "Edited after recovery" };
      await expect(manager.update(edited)).resolves.toBe(true);
      expect((await expoThreadOutboxStorage.load()).messages).toEqual([edited]);
      const persistedAfterEdit = new Map(outboxFiles);
      const beforeRetry = registry.get(manager.queuedMessagesByThreadKeyAtom);
      await expect(manager.load()).resolves.toBe(false);
      expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toBe(beforeRetry);
      await expect(manager.clearEnvironment(first.environmentId)).rejects.toMatchObject({
        operation: "clear-environment-load",
      });
      expect(outboxFiles.get("message-2.json")).toBe(unreadable);
      expect(outboxFiles).toEqual(persistedAfterEdit);

      // A delivered readable message can leave the queue while the failed
      // record stays intact. Its attachment cleanup has a separate guard.
      await expect(manager.remove(edited)).resolves.toBe(edited);
      expect(outboxFiles).toEqual(new Map([["message-2.json", unreadable]]));

      outboxFiles.set("message-2.json", JSON.stringify(encodeQueuedThreadMessage(second)));
      await expect(manager.load()).resolves.toBe(true);
      expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
        "environment-2:thread-1": [second],
      });
      await expect(expoThreadOutboxStorage.load()).resolves.toEqual({
        messages: [second],
        errors: [],
      });
    },
  );

  it("preserves queued messages when environment cleanup cannot read the outbox", async () => {
    const registry = AtomRegistry.make();
    onTestFinished(() => registry.dispose());
    const message = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const stored = new Map<MessageId, QueuedThreadMessage>();
    let readUnavailable = false;
    const manager = createThreadOutboxManager({
      registry,
      warn: () => {},
      storage: {
        load: async () => {
          if (readUnavailable) throw new Error("storage unavailable");
          return { messages: [...stored.values()], errors: [] };
        },
        write: async (entry) => {
          stored.set(entry.messageId, entry);
        },
        remove: async (entry) => {
          stored.delete(entry.messageId);
        },
      },
    });
    await manager.enqueue(message);
    readUnavailable = true;

    await expect(manager.clearEnvironment(message.environmentId)).rejects.toMatchObject({
      operation: "clear-environment-load",
    });
    expect([...stored.values()]).toEqual([message]);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [message],
    });
  });

  it("keeps in-session edits and removals when an incomplete load is retried", async () => {
    const registry = AtomRegistry.make();
    onTestFinished(() => registry.dispose());
    const message = queuedMessage({
      delivery: { state: "ready" },
      messageId: "message-retried",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<ThreadOutboxLoadResult>();
    const load = vi.fn<ThreadOutboxStorage["load"]>(async () => ({
      messages: [message],
      errors: [],
    }));
    load.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });
    const manager = createThreadOutboxManager({
      registry,
      storage: { load, write: async () => {}, remove: async () => {} },
      warn: () => {},
    });
    const loading = manager.load();
    await started.promise;
    const edited = { ...message, text: "Accepted while storage was being read" };
    const writing = manager.enqueue(edited);
    response.resolve({
      messages: [message],
      errors: [
        new ThreadOutboxStorageError({
          operation: "read-message",
          environmentId: null,
          threadId: null,
          messageId: null,
          fileName: "unreadable.json",
          cause: new Error("unreadable record"),
        }),
      ],
    });
    await expect(loading).resolves.toBe(false);
    await writing;
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [edited],
    });
    await expect(manager.confirmQueued(edited)).resolves.toBe(true);

    await manager.remove(edited);
    // A later repaired record can contain a stale copy of a removed message.
    await expect(manager.load()).resolves.toBe(true);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({});
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("groups messages by scoped thread and preserves creation order", () => {
    const later = queuedMessage({
      messageId: "message-2",
      createdAt: "2026-06-08T10:00:02.000Z",
    });
    const earlier = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    expect(groupQueuedThreadMessages([later, earlier])).toEqual({
      "environment-1:thread-1": [earlier, later],
    });
  });

  it("decodes the persisted schema and rejects incomplete messages", () => {
    const message = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    expect(
      decodeQueuedThreadMessage({
        schemaVersion: 1,
        ...message,
      }),
    ).toEqual(message);
    expect(() =>
      decodeQueuedThreadMessage({
        schemaVersion: 1,
        environmentId: "environment-1",
      }),
    ).toThrow();
  });

  it("persists generic attachment paths without embedding their contents", () => {
    const message = {
      ...queuedMessage({
        messageId: "message-file",
        createdAt: "2026-06-08T10:00:01.000Z",
      }),
      attachments: [
        {
          id: "file-1",
          type: "file" as const,
          name: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 42,
          fileUri: "file:///documents/report.pdf",
          uploadedAttachmentId: "pending-report-pdf",
          uploadEnvironmentId: EnvironmentId.make("environment-1"),
        },
      ],
    } satisfies QueuedThreadMessage;

    expect(decodeQueuedThreadMessage(encodeQueuedThreadMessage(message))).toEqual(message);
  });

  it("reads file-backed images from v4 queued messages", () => {
    const message = {
      ...queuedMessage({
        messageId: "message-image",
        createdAt: "2026-06-08T10:00:01.000Z",
      }),
      attachments: [
        {
          id: "image-1",
          type: "image" as const,
          name: "photo.png",
          mimeType: "image/png",
          sizeBytes: 3,
          fileUri: "file:///documents/t3-composer-attachments/photo.png",
          previewUri: "file:///documents/t3-composer-attachments/photo.png",
          uploadedAttachmentId: "pending-photo-png",
          uploadEnvironmentId: EnvironmentId.make("environment-1"),
        },
      ],
    } satisfies QueuedThreadMessage;

    expect(decodeQueuedThreadMessage({ ...message, schemaVersion: 4 })).toEqual(message);
  });

  it("persists the exact selector snapshot while remaining compatible with v1 messages", () => {
    const legacyMessage = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const selectedMessage = {
      ...legacyMessage,
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "xhigh" }],
      },
      runtimeMode: "approval-required",
      interactionMode: "plan",
    } satisfies QueuedThreadMessage;

    expect(decodeQueuedThreadMessage(encodeQueuedThreadMessage(selectedMessage))).toEqual(
      selectedMessage,
    );
    expect(
      resolveQueuedThreadSettings(legacyMessage, {
        modelSelection: selectedMessage.modelSelection,
        runtimeMode: selectedMessage.runtimeMode,
        interactionMode: selectedMessage.interactionMode,
      }),
    ).toEqual({
      modelSelection: selectedMessage.modelSelection,
      runtimeMode: selectedMessage.runtimeMode,
      interactionMode: selectedMessage.interactionMode,
    });
  });

  it("compares model options as part of the queued settings change", () => {
    const base = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
      options: [{ id: "reasoningEffort", value: "medium" }],
    } as const;

    expect(modelSelectionsEqual(base, base)).toBe(true);
    expect(
      modelSelectionsEqual(base, {
        ...base,
        options: [{ id: "reasoningEffort", value: "xhigh" }],
      }),
    ).toBe(false);
  });

  it("normalizes queued plan mode against the queued provider, not the current thread", () => {
    const codex = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" };
    const antigravity = {
      instanceId: ProviderInstanceId.make("google-personal"),
      model: "gemini-test-thinking",
      options: [{ id: "native-option", value: "keep-this-choice" }],
    };
    const providers = [
      { instanceId: codex.instanceId, showInteractionModeToggle: true },
      { instanceId: antigravity.instanceId, showInteractionModeToggle: false },
    ];
    const message = {
      ...queuedMessage({ messageId: "queued-plan", createdAt: "2026-09-02T10:00:00.000Z" }),
      text: "/plan inspect the project",
      modelSelection: antigravity,
      interactionMode: "plan",
    } satisfies QueuedThreadMessage;

    expect(
      resolveQueuedThreadSettings(
        message,
        { modelSelection: codex, runtimeMode: "approval-required", interactionMode: "plan" },
        providers,
      ),
    ).toEqual({
      modelSelection: antigravity,
      runtimeMode: "approval-required",
      interactionMode: "default",
    });
    expect(
      resolveQueuedThreadSettings(
        { ...message, modelSelection: codex },
        {
          modelSelection: antigravity,
          runtimeMode: "approval-required",
          interactionMode: "default",
        },
        providers,
      ).interactionMode,
    ).toBe("plan");
  });

  it("normalizes a legacy queued message that inherits unsupported plan mode", () => {
    const modelSelection = {
      instanceId: ProviderInstanceId.make("google-personal"),
      model: "gemini-test-thinking",
    };
    expect(
      resolveQueuedThreadSettings(
        queuedMessage({ messageId: "legacy-plan", createdAt: "2026-09-02T10:00:00.000Z" }),
        { modelSelection, runtimeMode: "approval-required", interactionMode: "plan" },
        [{ instanceId: modelSelection.instanceId, showInteractionModeToggle: false }],
      ).interactionMode,
    ).toBe("default");
  });

  it("backs off queued delivery retries and caps them at sixteen seconds", () => {
    expect([1, 2, 3, 4, 5, 6].map(threadOutboxRetryDelayMs)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 16_000,
    ]);
  });

  it("serializes mutations even when an earlier mutation is slower", async () => {
    const registry = AtomRegistry.make();
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [], errors: [] }),
        write: async () => undefined,
        remove: async () => undefined,
      },
    });
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    const first = manager.serialize(async () => {
      order.push("first:start");
      await firstBlocked;
      order.push("first:end");
    });
    const second = manager.serialize(async () => {
      order.push("second");
    });

    await Promise.resolve();
    expect(order).toEqual(["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first:start", "first:end", "second"]);
    registry.dispose();
  });

  it("holds the mutation queue while persisted messages are loading", async () => {
    const registry = AtomRegistry.make();
    const message = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const stored = new Map([[message.messageId, message]]);
    let loadCalls = 0;
    let removeCalls = 0;
    let releaseInitialLoad!: () => void;
    const initialLoadBlocked = new Promise<void>((resolve) => {
      releaseInitialLoad = resolve;
    });
    const storage: ThreadOutboxStorage = {
      load: async () => {
        loadCalls += 1;
        if (loadCalls === 1) {
          await initialLoadBlocked;
        }
        return { messages: [...stored.values()], errors: [] };
      },
      write: async () => undefined,
      remove: async (candidate) => {
        removeCalls += 1;
        stored.delete(candidate.messageId);
      },
    };
    const manager = createThreadOutboxManager({ registry, storage });

    const loading = manager.load();
    await Promise.resolve();
    const clearing = manager.clearEnvironment(message.environmentId);
    await Promise.resolve();
    await Promise.resolve();

    expect(loadCalls).toBe(1);
    expect(removeCalls).toBe(0);

    releaseInitialLoad();
    await Promise.all([loading, clearing]);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({});
    registry.dispose();
  });

  it("reports structured load failures and permits a retry", async () => {
    const registry = AtomRegistry.make();
    const loadCause = new Error("storage unavailable");
    const warnings: Array<{ message: string; error: unknown }> = [];
    let loadCalls = 0;
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => {
          loadCalls += 1;
          if (loadCalls === 1) throw loadCause;
          return { messages: [], errors: [] };
        },
        write: async () => undefined,
        remove: async () => undefined,
      },
      warn: (message, error) => warnings.push({ message, error }),
    });

    await manager.load();
    expect(warnings).toEqual([
      {
        message: "[thread-outbox] failed to load persisted messages",
        error: new ThreadOutboxManagerError({
          operation: "load",
          environmentId: null,
          threadId: null,
          messageId: null,
          cause: loadCause,
        }),
      },
    ]);

    await manager.load();
    expect(loadCalls).toBe(2);
    registry.dispose();
  });

  it("keeps atom state aligned with durable writes and removals", async () => {
    const registry = AtomRegistry.make();
    const stored = new Map<MessageId, QueuedThreadMessage>();
    const removalCause = new Error("remove failed");
    let failRemoval = true;
    const storage: ThreadOutboxStorage = {
      load: async () => ({ messages: [...stored.values()], errors: [] }),
      write: async (message) => {
        stored.set(message.messageId, message);
      },
      remove: async (message) => {
        if (failRemoval) {
          throw removalCause;
        }
        stored.delete(message.messageId);
      },
    };
    const manager = createThreadOutboxManager({ registry, storage });
    const message = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    await manager.enqueue(message);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [message],
    });

    await expect(manager.remove(message)).rejects.toEqual(
      new ThreadOutboxManagerError({
        operation: "remove",
        environmentId: message.environmentId,
        threadId: message.threadId,
        messageId: message.messageId,
        cause: removalCause,
      }),
    );
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [message],
    });

    failRemoval = false;
    await manager.remove(message);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({});
    registry.dispose();
  });

  it("publishes an enqueued message before the durable write resolves", async () => {
    const registry = AtomRegistry.make();
    let releaseWrite!: () => void;
    const writeBlocked = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [], errors: [] }),
        write: async () => writeBlocked,
        remove: async () => undefined,
      },
    });
    const message = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    const enqueueing = manager.enqueue(message);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [message],
    });

    releaseWrite();
    await enqueueing;
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [message],
    });
    registry.dispose();
  });

  it("rolls an enqueued message back out when the durable write fails", async () => {
    const registry = AtomRegistry.make();
    const writeCause = new Error("disk full");
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [], errors: [] }),
        write: async () => {
          throw writeCause;
        },
        remove: async () => undefined,
      },
    });
    const message = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    await expect(manager.enqueue(message)).rejects.toEqual(
      new ThreadOutboxManagerError({
        operation: "enqueue",
        environmentId: message.environmentId,
        threadId: message.threadId,
        messageId: message.messageId,
        cause: writeCause,
      }),
    );
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({});
    registry.dispose();
  });

  it("drops the disk entry when a failed enqueue leaves no queued message behind", async () => {
    const registry = AtomRegistry.make();
    const removed: string[] = [];
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [], errors: [] }),
        write: async () => {
          throw new Error("disk full");
        },
        remove: async (message) => {
          removed.push(message.messageId);
        },
      },
    });
    const message = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    // A concurrent update losing its race can compensate-write this payload
    // to disk before this write fails; rollback must clear that copy or a
    // restart resurrects the message.
    await expect(manager.enqueue(message)).rejects.toBeInstanceOf(ThreadOutboxManagerError);
    expect(removed).toEqual(["message-1"]);
    registry.dispose();
  });

  it("keeps a same-id retry queued when the first attempt's write fails", async () => {
    const registry = AtomRegistry.make();
    let failNextWrite = true;
    let releaseFirstWrite!: () => void;
    const firstWriteBlocked = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [], errors: [] }),
        write: async () => {
          if (failNextWrite) {
            failNextWrite = false;
            await firstWriteBlocked;
            throw new Error("disk full");
          }
        },
        remove: async () => undefined,
      },
    });
    const message = queuedMessage({
      delivery: { state: "ready" },
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const retried = { ...message, text: "retried" };

    const first = manager.enqueue(message);
    const second = manager.enqueue(retried);
    releaseFirstWrite();
    await expect(first).rejects.toBeInstanceOf(ThreadOutboxManagerError);
    await second;

    // The failed first attempt must not roll back the retry that replaced it.
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [retried],
    });
    await expect(manager.confirmQueued(retried)).resolves.toBe(true);
    await expect(manager.confirmQueued(message)).resolves.toBe(false);
    registry.dispose();
  });

  it("replaces an existing message when an enqueue retry uses the same id", async () => {
    const registry = AtomRegistry.make();
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [], errors: [] }),
        write: async () => undefined,
        remove: async () => undefined,
      },
    });
    const message = queuedMessage({
      delivery: { state: "ready" },
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const retried = { ...message, text: "retried" };

    await manager.enqueue(message);
    await manager.enqueue(retried);

    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [retried],
    });
    registry.dispose();
  });

  it("updates a queued message in place but never resurrects a removed one", async () => {
    const registry = AtomRegistry.make();
    const stored = new Map<MessageId, QueuedThreadMessage>();
    const storage: ThreadOutboxStorage = {
      load: async () => ({ messages: [...stored.values()], errors: [] }),
      write: async (message) => {
        stored.set(message.messageId, message);
      },
      remove: async (message) => {
        stored.delete(message.messageId);
      },
    };
    const manager = createThreadOutboxManager({ registry, storage });
    const message = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    await manager.enqueue(message);
    const edited = { ...message, text: "edited" };
    await expect(manager.update(edited)).resolves.toBe(true);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [edited],
    });
    expect(stored.get(message.messageId)).toEqual(edited);

    await manager.remove(edited);
    await expect(manager.update({ ...message, text: "stale flush" })).resolves.toBe(false);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({});
    expect(stored.size).toBe(0);
    registry.dispose();
  });

  it("rejects a stale revision before its payload reaches durable storage", async () => {
    const registry = AtomRegistry.make();
    const writes: string[] = [];
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [], errors: [] }),
        write: async (message) => {
          writes.push(message.text);
        },
        remove: async () => undefined,
      },
    });
    const original = queuedMessage({
      messageId: "message-edit-race",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const edited = { ...original, text: "keep my changes" };

    await manager.enqueue(original);
    // Revision captured before slow work (an attachment upload) starts.
    const revision = manager.revisionOf(original);
    await manager.update(edited);

    await expect(manager.update({ ...original, text: "stale upload" }, revision)).resolves.toBe(
      false,
    );
    // The losing writer was rejected before persisting: no stale payload can
    // sit on disk waiting to resurrect on the next load.
    expect(writes).toEqual([original.text, "keep my changes"]);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [edited],
    });
    registry.dispose();
  });

  it("does not publish a stale attachment update after a replacement appears during its write", async () => {
    const registry = AtomRegistry.make();
    const writes: string[] = [];
    let resumeWrite: () => void = () => {};
    let signalWriteStarted: () => void = () => {};
    const writeStarted = new Promise<void>((resolve) => {
      signalWriteStarted = resolve;
    });
    const writeBarrier = new Promise<void>((resolve) => {
      resumeWrite = resolve;
    });
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [], errors: [] }),
        write: async (message) => {
          writes.push(message.text);
          if (message.text === "stale upload") {
            signalWriteStarted();
            await writeBarrier;
          }
        },
        remove: async () => undefined,
      },
    });
    const original = queuedMessage({
      delivery: { state: "ready" },
      messageId: "message-write-race",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const replacement = { ...original, text: "newer edit" };

    await manager.enqueue(original);
    const update = manager.update(
      { ...original, text: "stale upload" },
      manager.revisionOf(original),
    );
    await writeStarted;
    const enqueue = manager.enqueue(replacement);
    resumeWrite();

    await expect(update).resolves.toBe(false);
    // The losing update re-writes the winning payload inside its own
    // mutation, before the replacement's serialized write lands, so a crash
    // between the two cannot leave the stale payload on disk.
    expect(writes).toEqual([original.text, "stale upload", "newer edit", "newer edit"]);
    await enqueue;
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [replacement],
    });
    registry.dispose();
  });

  it("refuses to remove a message that was rewritten after the removal decision", async () => {
    const registry = AtomRegistry.make();
    const stored = new Map<MessageId, QueuedThreadMessage>();
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [...stored.values()], errors: [] }),
        write: async (message) => {
          stored.set(message.messageId, message);
        },
        remove: async (message) => {
          stored.delete(message.messageId);
        },
      },
    });
    const original = queuedMessage({
      messageId: "message-remove-race",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const edited = { ...original, text: "edited while restoring" };

    await manager.enqueue(original);
    // Revision captured when restore-to-composer read the payload it intends
    // to remove; the edit accepted afterwards must survive the removal.
    const revision = manager.revisionOf(original);
    await manager.update(edited);

    await expect(manager.remove(original, revision)).resolves.toBe(null);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [edited],
    });
    expect(stored.get(original.messageId)).toEqual(edited);

    await expect(manager.remove(edited, manager.revisionOf(edited))).resolves.toEqual(edited);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({});
    registry.dispose();
  });

  it("keeps a retry enqueued when its publish races a revision-checked removal", async () => {
    const registry = AtomRegistry.make();
    const stored = new Map<MessageId, QueuedThreadMessage>();
    const removeStarted = Promise.withResolvers<void>();
    const removeBarrier = Promise.withResolvers<void>();
    const replacementWriteStarted = Promise.withResolvers<void>();
    const replacementWriteBarrier = Promise.withResolvers<void>();
    const original = queuedMessage({
      delivery: { state: "ready" },
      messageId: "message-remove-enqueue-race",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const retried = { ...original, text: "retried" };
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [...stored.values()], errors: [] }),
        write: async (message) => {
          if (message === retried) {
            replacementWriteStarted.resolve();
            await replacementWriteBarrier.promise;
          }
          stored.set(message.messageId, message);
        },
        remove: async (message) => {
          removeStarted.resolve();
          await removeBarrier.promise;
          stored.delete(message.messageId);
        },
      },
    });

    await manager.enqueue(original);
    const removal = manager.remove(original, manager.revisionOf(original));
    let removalSettled = false;
    void removal.then(() => {
      removalSettled = true;
    });
    await removeStarted.promise;
    // Published synchronously while the durable remove is still in flight.
    const enqueue = manager.enqueue(retried);
    removeBarrier.resolve();
    await replacementWriteStarted.promise;

    // The canceled removal itself restores the durable winner. The queued
    // enqueue write has not had a chance to run yet.
    expect(removalSettled).toBe(false);
    replacementWriteBarrier.resolve();
    await expect(removal).resolves.toBe(null);
    expect(stored.get(original.messageId)).toEqual(retried);
    await enqueue;
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [retried],
    });
    expect(stored.get(original.messageId)).toEqual(retried);
    registry.dispose();
  });

  it("restores a message when its live removal predicate changes during storage removal", async () => {
    const registry = AtomRegistry.make();
    const stored = new Map<MessageId, QueuedThreadMessage>();
    const removeStarted = Promise.withResolvers<void>();
    const removeBarrier = Promise.withResolvers<void>();
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [...stored.values()], errors: [] }),
        write: async (message) => {
          stored.set(message.messageId, message);
        },
        remove: async (message) => {
          removeStarted.resolve();
          await removeBarrier.promise;
          stored.delete(message.messageId);
        },
      },
    });
    const message = queuedMessage({
      messageId: "message-remove-predicate-race",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    let canRemove = true;

    await manager.enqueue(message);
    const removal = manager.remove(message, manager.revisionOf(message), () => canRemove);
    await removeStarted.promise;
    canRemove = false;
    removeBarrier.resolve();

    await expect(removal).resolves.toBe(null);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-1:thread-1": [message],
    });
    expect(stored.get(message.messageId)).toEqual(message);
    registry.dispose();
  });

  it("preserves concurrent enqueues while clearing an environment", async () => {
    const registry = AtomRegistry.make();
    const stored = new Map<MessageId, QueuedThreadMessage>();
    const removeStarted = Promise.withResolvers<void>();
    const removeBarrier = Promise.withResolvers<void>();
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [...stored.values()], errors: [] }),
        write: async (message) => {
          stored.set(message.messageId, message);
        },
        remove: async (message) => {
          if (message.environmentId === EnvironmentId.make("environment-clear")) {
            removeStarted.resolve();
            await removeBarrier.promise;
          }
          stored.delete(message.messageId);
        },
      },
    });
    const replaced = queuedMessage({
      delivery: { state: "ready" },
      environmentId: "environment-clear",
      messageId: "message-replaced-during-clear",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const removed = queuedMessage({
      environmentId: "environment-clear",
      messageId: "message-removed-by-clear",
      createdAt: "2026-06-08T10:00:02.000Z",
    });
    const kept = queuedMessage({
      environmentId: "environment-keep",
      messageId: "message-other-environment",
      createdAt: "2026-06-08T10:00:03.000Z",
    });
    const replacement = { ...replaced, text: "replacement" };
    const added = queuedMessage({
      environmentId: "environment-clear",
      messageId: "message-added-during-clear",
      createdAt: "2026-06-08T10:00:04.000Z",
    });

    await Promise.all([manager.enqueue(replaced), manager.enqueue(removed), manager.enqueue(kept)]);
    const clearing = manager.clearEnvironment(replaced.environmentId);
    await removeStarted.promise;
    const replacing = manager.enqueue(replacement);
    const adding = manager.enqueue(added);
    removeBarrier.resolve();

    await expect(clearing).resolves.toEqual([removed]);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-clear:thread-1": [replacement, added],
      "environment-keep:thread-1": [kept],
    });
    expect(stored.get(replacement.messageId)).toEqual(replacement);
    expect(stored.has(removed.messageId)).toBe(false);

    await Promise.all([replacing, adding]);
    expect([...stored.values()]).toEqual(expect.arrayContaining([replacement, added, kept]));
    registry.dispose();
  });

  it("does not restore a message removed before a queued environment clear starts", async () => {
    const registry = AtomRegistry.make();
    const stored = new Map<MessageId, QueuedThreadMessage>();
    const removeStarted = Promise.withResolvers<void>();
    const removeBarrier = Promise.withResolvers<void>();
    let removeCalls = 0;
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [...stored.values()], errors: [] }),
        write: async (message) => {
          stored.set(message.messageId, message);
        },
        remove: async (message) => {
          removeCalls += 1;
          if (removeCalls === 1) {
            removeStarted.resolve();
            await removeBarrier.promise;
          }
          stored.delete(message.messageId);
        },
      },
    });
    const message = queuedMessage({
      environmentId: "environment-clear",
      messageId: "message-removed-before-clear",
      createdAt: "2026-06-08T10:00:01.000Z",
    });

    await manager.enqueue(message);
    const removal = manager.remove(message);
    await removeStarted.promise;
    const clearing = manager.clearEnvironment(message.environmentId);
    removeBarrier.resolve();

    await expect(removal).resolves.toEqual(message);
    await expect(clearing).resolves.toEqual([]);
    expect(removeCalls).toBe(1);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({});
    expect(stored.has(message.messageId)).toBe(false);
    registry.dispose();
  });

  it("keeps an enqueue published while an environment clear waits to start", async () => {
    const registry = AtomRegistry.make();
    const stored = new Map<MessageId, QueuedThreadMessage>();
    const mutationStarted = Promise.withResolvers<void>();
    const mutationBarrier = Promise.withResolvers<void>();
    let removeCalls = 0;
    const manager = createThreadOutboxManager({
      registry,
      storage: {
        load: async () => ({ messages: [...stored.values()], errors: [] }),
        write: async (message) => {
          stored.set(message.messageId, message);
        },
        remove: async () => {
          removeCalls += 1;
        },
      },
    });
    const blocker = manager.serialize(async () => {
      mutationStarted.resolve();
      await mutationBarrier.promise;
    });
    await mutationStarted.promise;
    const clearing = manager.clearEnvironment(EnvironmentId.make("environment-clear"));
    const added = queuedMessage({
      environmentId: "environment-clear",
      messageId: "message-enqueued-before-clear-start",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const enqueue = manager.enqueue(added);
    mutationBarrier.resolve();

    await blocker;
    await expect(clearing).resolves.toEqual([]);
    expect(removeCalls).toBe(0);
    expect(registry.get(manager.queuedMessagesByThreadKeyAtom)).toEqual({
      "environment-clear:thread-1": [added],
    });
    await enqueue;
    expect(stored.get(added.messageId)).toEqual(added);
    registry.dispose();
  });

  it("retains an already-created pending task without treating its shell as a receipt", () => {
    // A shell cannot prove delivery; neither missing config nor file support
    // authorizes retirement or restoration.
    const fileAttachments = [{ name: "report.pdf", sizeBytes: 42 }];
    expect(
      resolveThreadOutboxDispatchStep({
        deliveryAction: "wait",
        fileAttachments,
        serverConfig: null,
      }),
    ).toEqual({ step: "wait" });
    expect(
      resolveThreadOutboxDispatchStep({
        deliveryAction: "wait",
        fileAttachments,
        serverConfig: { maxFileUploadBytes: undefined },
      }),
    ).toEqual({ step: "wait" });
  });

  it("retries instead of parking a file message while the server config loads", () => {
    expect(
      resolveThreadOutboxDispatchStep({
        deliveryAction: "send",
        fileAttachments: [{ name: "report.pdf", sizeBytes: 42 }],
        serverConfig: null,
      }),
    ).toEqual({ step: "retry" });
  });

  it("gates a sending file message on the server's file support and limit", () => {
    expect(
      resolveThreadOutboxDispatchStep({
        deliveryAction: "send",
        fileAttachments: [{ name: "report.pdf", sizeBytes: 42 }],
        serverConfig: { maxFileUploadBytes: undefined },
      }),
    ).toEqual({ step: "restore", reason: "This server does not support file attachments." });
    expect(
      resolveThreadOutboxDispatchStep({
        deliveryAction: "send",
        fileAttachments: [{ name: "big.zip", sizeBytes: 2 * 1024 * 1024 }],
        serverConfig: { maxFileUploadBytes: 1024 * 1024 },
      }),
    ).toEqual({ step: "restore", reason: "'big.zip' exceeds the 1 MB attachment limit." });
    expect(
      resolveThreadOutboxDispatchStep({
        deliveryAction: "send",
        fileAttachments: [{ name: "report.pdf", sizeBytes: 42 }],
        serverConfig: { maxFileUploadBytes: 1024 * 1024 },
      }),
    ).toEqual({ step: "send" });
  });

  it("waits for provider capabilities before sending text-only queued messages", () => {
    expect(
      resolveThreadOutboxDispatchStep({
        deliveryAction: "send",
        fileAttachments: [],
        serverConfig: null,
      }),
    ).toEqual({ step: "retry" });
    expect(
      resolveThreadOutboxDispatchStep({
        deliveryAction: "send",
        fileAttachments: [],
        serverConfig: { maxFileUploadBytes: undefined },
      }),
    ).toEqual({ step: "send" });
  });

  it("retains missing-thread messages even after shell synchronization", () => {
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: false,
        threadExists: false,
        shellStatus: "synchronizing",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("wait");
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: false,
        threadExists: false,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("wait");
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: false,
        threadExists: true,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("send");
  });

  it("sends existing-thread messages whenever connected so queued messages can steer", () => {
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: false,
        threadExists: true,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: true,
      }),
    ).toBe("send");
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: false,
        threadExists: true,
        shellStatus: "live",
        environmentConnected: false,
        threadBusy: true,
      }),
    ).toBe("wait");
  });

  it("sends eligible creations once connected and live, retaining already-created ones", () => {
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: false,
        shellStatus: "cached",
        environmentConnected: false,
        threadBusy: false,
      }),
    ).toBe("wait");
    // Connected but not yet synchronized: a previously delivered creation may
    // simply not be visible yet — sending now could duplicate the thread.
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: false,
        shellStatus: "synchronizing",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("wait");
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: false,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: false,
      }),
    ).toBe("send");
    expect(
      resolveThreadOutboxDeliveryAction({
        isCreation: true,
        threadExists: true,
        shellStatus: "live",
        environmentConnected: true,
        threadBusy: true,
      }),
    ).toBe("wait");
  });

  it("round-trips queued creations and gates incomplete ones from sending", () => {
    const base = queuedMessage({
      messageId: "message-1",
      createdAt: "2026-06-08T10:00:01.000Z",
    });
    const creationMessage = {
      ...base,
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      creation: {
        projectId: ProjectId.make("project-1"),
        workspaceMode: "worktree",
        branch: "main",
        worktreePath: null,
        startFromOrigin: true,
      },
    } satisfies QueuedThreadMessage;

    expect(decodeQueuedThreadMessage(encodeQueuedThreadMessage(creationMessage))).toEqual(
      creationMessage,
    );
    expect(isQueuedThreadCreationSendable(creationMessage)).toBe(true);
    expect(
      isQueuedThreadCreationSendable({
        ...creationMessage,
        creation: { ...creationMessage.creation, branch: null },
      }),
    ).toBe(false);
    expect(
      isQueuedThreadCreationSendable({
        ...creationMessage,
        creation: { ...creationMessage.creation, branch: "" },
      }),
    ).toBe(false);
    expect(isQueuedThreadCreationSendable({ ...creationMessage, modelSelection: undefined })).toBe(
      false,
    );
    expect(isQueuedThreadCreationSendable(base)).toBe(false);
  });

  it("retries transport failures but drops deterministic command failures", () => {
    expect(shouldRetryThreadOutboxDelivery(new Error("Socket is not connected"))).toBe(true);
    expect(
      shouldRetryThreadOutboxDelivery({
        _tag: "ConnectionTransientError",
        message: "temporarily unavailable",
      }),
    ).toBe(true);
    expect(shouldRetryThreadOutboxDelivery(new Error("Thread no longer exists"))).toBe(false);
    expect(
      shouldRetryThreadOutboxDelivery(
        new OrchestrationDispatchCommandError({ message: "Thread no longer exists" }),
      ),
    ).toBe(false);
    expect(
      shouldRetryThreadOutboxDelivery(
        new EnvironmentAuthorizationError({
          message: "Missing scope",
          requiredScope: "orchestration:operate",
        }),
      ),
    ).toBe(false);
  });

  // A pending task created offline drains the moment the phone reconnects,
  // which is exactly when the socket is most likely to drop again. Every way a
  // request can fail in flight must retry; a restore turns the pending task
  // into a draft and it disappears from the list.
  it("retries every in-flight transport failure by tag, not by message text", () => {
    const socketReasons = [
      new Socket.SocketReadError({ cause: new Error("The network connection was lost.") }),
      new Socket.SocketWriteError({ cause: new Error("Broken pipe") }),
      new Socket.SocketCloseError({ code: 1006 }),
      new Socket.SocketOpenError({ kind: "Timeout", cause: new Error("timeout") }),
    ];
    for (const reason of socketReasons) {
      const error = new RpcClientError.RpcClientError({ reason });
      expect(isTransportConnectionErrorMessage(error.message)).toBe(
        reason._tag === "SocketCloseError" || reason._tag === "SocketOpenError",
      );
      expect(shouldRetryThreadOutboxDelivery(error)).toBe(true);
    }
    expect(
      shouldRetryThreadOutboxDelivery(
        new RpcClientError.RpcClientError({
          reason: new RpcClientError.RpcClientDefect({
            message: "Error decoding message",
            cause: new Error("Unexpected end of JSON input"),
          }),
        }),
      ),
    ).toBe(true);
    expect(
      shouldRetryThreadOutboxDelivery(
        new EnvironmentRpcUnavailableError({
          environmentId: "environment-1",
          message: "Home is not connected.",
        }),
      ),
    ).toBe(true);
    expect(
      shouldRetryThreadOutboxDelivery(
        new EnvironmentNotRegisteredError({ environmentId: EnvironmentId.make("environment-1") }),
      ),
    ).toBe(true);
  });

  it("retains queued messages when settings synchronization fails before startTurn", () => {
    const deterministicFailure = new Error("Thread no longer exists");

    expect(
      resolveThreadOutboxFailureAction({
        stage: "settings-sync",
        error: deterministicFailure,
        interrupted: false,
      }),
    ).toBe("retry");
    expect(
      resolveThreadOutboxFailureAction({
        stage: "start-turn",
        error: deterministicFailure,
        interrupted: false,
      }),
    ).toBe("restore");
  });
});
