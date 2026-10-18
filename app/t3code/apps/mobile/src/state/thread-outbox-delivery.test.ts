import { config, environmentId, modelSelection } from "./testing/outbox-config";
import { fixture, harness, setServerConfig } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { appAtomRegistry } from "./atom-registry";
import { createThreadOutboxDelivery } from "./thread-outbox-delivery";
import { completeQueuedMessageDelivery, canInvokeQueuedMessage } from "./use-thread-outbox-drain";
import { firstEligibleOutboxMessage } from "./thread-outbox-preparation";
import { threadOutboxIdentity, type QueuedThreadMessage } from "./thread-outbox-model";
import { decodeThreadOutboxRecord, encodeThreadOutboxRecord } from "./thread-outbox-record";
import {
  composerDraftsAtom,
  resetComposerDraftsLoadState,
  waitForComposerDraftsLoaded,
} from "./use-composer-drafts";
import { holdEditingQueuedMessage } from "./use-thread-outbox";

function message(creation: boolean): QueuedThreadMessage {
  return {
    environmentId,
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("message"),
    commandId: CommandId.make("command"),
    text: "exact text",
    attachments: [],
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    createdAt: "2026-10-04T00:00:00.000Z",
    ...(creation
      ? {
          creation: {
            projectId: ProjectId.make("project"),
            workspaceMode: "worktree" as const,
            branch: "main",
            worktreePath: null,
            projectCwd: "/repo",
          },
        }
      : {}),
  };
}
function transport() {
  return {
    startTurn: vi.fn<Parameters<typeof createThreadOutboxDelivery>[0]["startTurn"]>(async () =>
      AsyncResult.success({ sequence: 7 }),
    ),
    updateMetadata: vi.fn<Parameters<typeof createThreadOutboxDelivery>[0]["updateMetadata"]>(
      async () => AsyncResult.success({ sequence: 1 }),
    ),
    setRuntimeMode: vi.fn<Parameters<typeof createThreadOutboxDelivery>[0]["setRuntimeMode"]>(
      async () => AsyncResult.success({ sequence: 2 }),
    ),
    setInteractionMode: vi.fn<
      Parameters<typeof createThreadOutboxDelivery>[0]["setInteractionMode"]
    >(async () => AsyncResult.success({ sequence: 3 })),
  };
}
function input(row: QueuedThreadMessage, canInvoke = () => true) {
  return {
    message: row,
    canInvoke,
    projectCwd: row.creation ? "/repo" : null,
    thread: row.creation
      ? undefined
      : {
          modelSelection,
          runtimeMode: "full-access" as const,
          interactionMode: "default" as const,
        },
  };
}
beforeEach(async () => {
  fixture().reset();
  harness.randomHex.mockClear();
  harness.scopeConnected = true;
  appAtomRegistry.set(composerDraftsAtom, {});
  resetComposerDraftsLoadState();
  await waitForComposerDraftsLoaded();
  setServerConfig(config);
  harness.prepare.mockImplementation(async (value) => ({
    status: "ready",
    attachments: [],
    draftAttachments: value.attachments,
    pendingAttachmentIds: [],
  }));
});
afterEach(() => harness.prepare.mockReset());

describe("production delivery transport boundary", () => {
  it.each([false, true])(
    "persists attempted and the exact command before transport (creation: %s)",
    async (creation) => {
      const row = await fixture().admit(message(creation));
      const ports = transport();
      ports.startTurn.mockImplementationOnce(async (wire) => {
        const stored = await fixture().storage.readRecord(row.storageIdentity ?? row);
        expect(stored).toMatchObject({
          delivery: { state: "attempted" },
          original: {
            kind: "claim",
            localSnapshot: { text: row.text },
            invocation: { environmentId, command: { type: "thread.turn.start", ...wire.input } },
          },
        });
        return AsyncResult.success({ sequence: 7 });
      });
      // The callback checks live ownership only, not the old ready CAS snapshot.
      const result = await createThreadOutboxDelivery(ports)(
        input(row, creation ? () => canInvokeQueuedMessage(row) : () => true),
      );
      expect(result.status).toBe("acknowledged");
      if (result.status !== "acknowledged") throw new Error("Expected DispatchResult");
      expect(result.acknowledgment.receipt.sequence).toBe(7);
      await completeQueuedMessageDelivery(result.acknowledgment);
      expect(ports.startTurn).toHaveBeenCalledOnce();
      expect(harness.randomHex).toHaveBeenCalledTimes(creation ? 1 : 0);
      expect(fixture().manager.authority.knownRecords()[0]).toMatchObject({
        kind: "retired",
        acknowledgedSequence: 7,
      });
    },
  );
  it.each([false, true])(
    "never reuploads, restores or invokes after a lost ACK and restart (creation: %s)",
    async (creation) => {
      const row = await fixture().admit(message(creation));
      const ports = transport();
      ports.startTurn.mockRejectedValueOnce(new Error("lost ACK"));
      await expect(createThreadOutboxDelivery(ports)(input(row))).rejects.toThrow("lost ACK");
      await fixture().restart();
      const record = fixture().manager.authority.knownRecords()[0];
      if (record === undefined) throw new Error("Expected attempted record");
      const retained = fixture().manager.messageFor(record);
      if (retained === null) throw new Error("Expected retained content");
      await expect(createThreadOutboxDelivery(ports)(input(retained))).resolves.toEqual({
        status: "retained",
      });
      expect(ports.startTurn).toHaveBeenCalledOnce();
      expect(harness.prepare).toHaveBeenCalledOnce();
      expect(appAtomRegistry.get(composerDraftsAtom)).toEqual({});
    },
  );
  it.each(["editor", "scope"] as const)(
    "prevents invocation when %s changes during claim persistence",
    async (change) => {
      const row = await fixture().admit(message(true));
      const ports = transport();
      const entered = Promise.withResolvers<void>();
      const barrier = Promise.withResolvers<void>();
      fixture().gates.push(async (record) => {
        expect(record.delivery.state).toBe("attempted");
        entered.resolve();
        await barrier.promise;
      });
      const delivery = createThreadOutboxDelivery(ports)(
        input(row, () => canInvokeQueuedMessage(row)),
      );
      await entered.promise;
      if (change === "scope") harness.scopeConnected = false;
      else
        appAtomRegistry.set(composerDraftsAtom, {
          [`pending-task:${threadOutboxIdentity(row)}`]: { text: "editor", attachments: [] },
        });
      barrier.resolve();
      await expect(delivery).resolves.toEqual({ status: "retained" });
      expect(ports.startTurn).not.toHaveBeenCalled();
      expect(fixture().manager.authority.knownRecords()[0]?.delivery.state).toBe("attempted");
    },
  );
  it("prevents settings and upload effects for held or non-ready records", async () => {
    const row = await fixture().admit(message(false));
    const ports = transport();
    const release = holdEditingQueuedMessage(row);
    await createThreadOutboxDelivery(ports)(input(row));
    release?.();
    const ready = fixture().record(row);
    const unknown = decodeThreadOutboxRecord({
      ...ready,
      delivery: { state: "unknown" },
      original: { kind: "legacy-observed", localSnapshot: message(false) },
    });
    fixture().files.set(
      threadOutboxIdentity(ready.storageIdentity),
      JSON.stringify(encodeThreadOutboxRecord(unknown)),
    );
    await fixture().restart();
    const loaded = fixture().manager.authority.knownRecords()[0];
    if (loaded === undefined) throw new Error("Expected unknown record");
    const retained = fixture().manager.messageFor(loaded);
    if (retained === null) throw new Error("Expected visible record");
    await createThreadOutboxDelivery(ports)(input(retained));
    expect(ports.startTurn).not.toHaveBeenCalled();
    expect(ports.updateMetadata).not.toHaveBeenCalled();
    expect(ports.setRuntimeMode).not.toHaveBeenCalled();
    expect(ports.setInteractionMode).not.toHaveBeenCalled();
    expect(harness.prepare).not.toHaveBeenCalled();
  });
  it("makes independent eligible work progress past quarantined work", async () => {
    const first = await fixture().admit(message(false));
    const ports = transport();
    ports.startTurn.mockRejectedValueOnce(new Error("uncertain"));
    await expect(createThreadOutboxDelivery(ports)(input(first))).rejects.toThrow();
    const next = await fixture().admit({
      ...message(false),
      messageId: MessageId.make("next"),
      commandId: CommandId.make("next"),
    });
    const candidates = Object.values(
      appAtomRegistry.get(fixture().manager.queuedMessagesByThreadKeyAtom),
    ).flat();
    const eligible = firstEligibleOutboxMessage(candidates);
    expect(eligible).toBe(next);
    await expect(createThreadOutboxDelivery(ports)(input(next))).resolves.toMatchObject({
      status: "acknowledged",
    });
    expect(ports.startTurn).toHaveBeenCalledTimes(2);
  });
});
