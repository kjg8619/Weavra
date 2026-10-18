import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { beforeEach, vi } from "vite-plus/test";

import type { QueuedThreadMessage } from "../thread-outbox-model";

const harness: {
  fixture: ReturnType<typeof import("./outbox").createOutboxTestFixture> | undefined;
} = vi.hoisted(() => ({ fixture: undefined }));
vi.mock("../thread-outbox", async () => {
  const { createOutboxTestFixture } = await import("./outbox");
  const { appAtomRegistry } = await import("../atom-registry");
  harness.fixture = createOutboxTestFixture(appAtomRegistry);
  return {
    get threadOutboxManager() {
      return fixture().manager;
    },
    flushThreadOutbox: () => fixture().manager.flush(),
    updateThreadOutboxMessage: (
      message: QueuedThreadMessage,
      expected: import("../thread-outbox-record").ThreadOutboxRecord,
    ) => fixture().edit(message, expected),
  };
});
export function fixture() {
  if (harness.fixture === undefined) throw new Error("Fixture not initialized");
  return harness.fixture;
}

import { appAtomRegistry } from "../atom-registry";
import { composerDraftsAtom, type ComposerDraft } from "../use-composer-drafts";

export function queuedMessage(messageId: string, text: string): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment-1"),
    threadId: ThreadId.make("thread-1"),
    messageId: MessageId.make(messageId),
    commandId: CommandId.make(`command-${messageId}`),
    text,
    attachments: [],
    createdAt: "2026-08-28T12:00:00.000Z",
  };
}

export function draft(text: string): ComposerDraft {
  return {
    text,
    attachments: [],
    runtimeMode: "full-access",
  };
}

export function setDraft(draftKey: string, value: ComposerDraft): void {
  appAtomRegistry.set(composerDraftsAtom, { [draftKey]: value });
}

export function queuedMessageText(messageId: QueuedThreadMessage["messageId"]): string | null {
  const messages = Object.values(
    appAtomRegistry.get(fixture().manager.queuedMessagesByThreadKeyAtom),
  ).flat();
  return messages.find((message) => message.messageId === messageId)?.text ?? null;
}

export function blockNextWrite() {
  const barrier = Promise.withResolvers<void>();
  const entered = Promise.withResolvers<QueuedThreadMessage>();
  fixture().gates.push(async (record) => {
    if (record.kind !== "message") throw new Error("Expected message write");
    entered.resolve(record.message);
    await barrier.promise;
  });
  return {
    started: entered.promise,
    resolve: () => barrier.resolve(),
    reject: (error: Error) => barrier.reject(error),
  };
}
beforeEach(() => {
  fixture().reset();
  appAtomRegistry.set(composerDraftsAtom, {});
});
