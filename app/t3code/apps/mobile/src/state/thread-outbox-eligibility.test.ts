import { fixture, harness, setServerConfig } from "./testing/drain-harness";
import { config, environmentId, modelSelection } from "./testing/outbox-config";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { CommandId, MessageId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { absurd as assertNever } from "effect/Function";
import { createThreadOutboxDelivery } from "./thread-outbox-delivery";
import { decodeThreadOutboxRecord, encodeThreadOutboxRecord } from "./thread-outbox-record";
import { threadOutboxIdentity } from "./thread-outbox-model";
import { appAtomRegistry } from "./atom-registry";
import {
  composerDraftsAtom,
  resetComposerDraftsLoadState,
  waitForComposerDraftsLoaded,
} from "./use-composer-drafts";

beforeEach(async () => {
  fixture().reset();
  harness.prepare.mockReset();
  appAtomRegistry.set(composerDraftsAtom, {});
  resetComposerDraftsLoadState();
  await waitForComposerDraftsLoaded();
  setServerConfig(config);
});
describe("delivery eligibility fences", () => {
  it.each([
    "unknown",
    "attempted",
    "refused",
    "retired",
    "parked",
    "foreign",
    "unassigned",
  ] as const)("makes zero outgoing effects for %s authority", async (state) => {
    const content = {
      environmentId,
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("message"),
      commandId: CommandId.make("command"),
      text: "retained",
      attachments: [],
      modelSelection,
      runtimeMode: "full-access" as const,
      interactionMode: "default" as const,
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const admitted = await fixture().manager.enqueueNew(content, null).committed;
    const { ownerAccountId: _owner, ...unassigned } = admitted;
    const original = { kind: "legacy-observed", localSnapshot: content };
    const record = decodeThreadOutboxRecord(
      (() => {
        switch (state) {
          case "unknown":
          case "attempted":
            return { ...admitted, delivery: { state }, original };
          case "refused":
            return {
              ...admitted,
              original,
              delivery: {
                state: "refused",
                sourceMessage: {
                  id: content.messageId,
                  role: "user",
                  text: content.text,
                  attachments: [],
                  turnId: null,
                  streaming: false,
                  createdAt: content.createdAt,
                  updatedAt: content.createdAt,
                },
                refusal: {
                  version: 1,
                  source: "workspace-ownership",
                  requestId: content.messageId,
                  reason: "target-changed",
                  originCommandId: content.commandId,
                  originSequence: 1,
                },
              },
            };
          case "retired":
            return {
              schemaVersion: 6,
              kind: "retired",
              reason: "discarded",
              storageIdentity: admitted.storageIdentity,
              transport: admitted.transport,
              ownerAccountId: null,
              delivery: { state: "ready" },
              retainedMessage: content,
            };
          case "parked":
            return { ...admitted, ownerAccountId: "account", archivedFor: "account" };
          case "foreign":
            return { ...admitted, ownerAccountId: "foreign" };
          case "unassigned":
            return unassigned;
          default:
            return assertNever(state);
        }
      })(),
    );
    fixture().files.set(
      threadOutboxIdentity(record.storageIdentity),
      JSON.stringify(encodeThreadOutboxRecord(record)),
    );
    await fixture().restart();
    const current = fixture().manager.recordAt(record.storageIdentity);
    if (current === null) throw new Error("Expected durable fence");
    const row = fixture().manager.messageFor(current) ?? content;
    const transport = {
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
    const before = [...fixture().files];

    const result = await createThreadOutboxDelivery(transport)({
      message: row,
      canInvoke: () => true,
      projectCwd: null,
      thread: { modelSelection, runtimeMode: "approval-required", interactionMode: "plan" },
    });

    expect(result).toEqual({ status: "retained" });
    expect(transport.startTurn).not.toHaveBeenCalled();
    expect(transport.updateMetadata).not.toHaveBeenCalled();
    expect(transport.setRuntimeMode).not.toHaveBeenCalled();
    expect(transport.setInteractionMode).not.toHaveBeenCalled();
    expect(harness.prepare).not.toHaveBeenCalled();
    expect([...fixture().files]).toEqual(before);
    expect(appAtomRegistry.get(composerDraftsAtom)).toEqual({});
  });
});
