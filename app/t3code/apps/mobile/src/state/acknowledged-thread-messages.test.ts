import { afterEach, describe, expect, it } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { appAtomRegistry } from "./atom-registry";
import {
  acknowledgedThreadMessagesAtom,
  forgetAcknowledgedThreadMessage,
  forgetAcknowledgedThreadEchoes,
  retainAcknowledgedThreadMessage,
} from "./acknowledged-thread-messages";
import type { QueuedThreadMessage } from "./thread-outbox-model";

function message(overrides: Partial<QueuedThreadMessage> = {}): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("shared"),
    commandId: CommandId.make("command"),
    text: "submitted",
    attachments: [],
    createdAt: "2026-10-04T00:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => appAtomRegistry.set(acknowledgedThreadMessagesAtom, []));

describe("acknowledged message presentation", () => {
  it("scopes the actual echo cleanup to its environment and thread", () => {
    const selected = message();
    const foreignEnvironment = message({ environmentId: EnvironmentId.make("other-environment") });
    const foreignThread = message({ threadId: ThreadId.make("other-thread") });
    const unobserved = message({ messageId: MessageId.make("not-echoed") });
    for (const entry of [selected, foreignEnvironment, foreignThread, unobserved]) {
      retainAcknowledgedThreadMessage(entry);
    }

    forgetAcknowledgedThreadEchoes({
      scope: selected,
      messageIds: new Set([selected.messageId]),
    });

    expect(appAtomRegistry.get(acknowledgedThreadMessagesAtom)).toEqual([
      foreignEnvironment,
      foreignThread,
      unobserved,
    ]);
    const retained = appAtomRegistry.get(acknowledgedThreadMessagesAtom);
    forgetAcknowledgedThreadEchoes({
      scope: selected,
      messageIds: new Set([selected.messageId]),
    });
    expect(appAtomRegistry.get(acknowledgedThreadMessagesAtom)).toBe(retained);
  });

  it("keeps same-ID acknowledgments in different environments and threads", () => {
    const messages = [
      message(),
      message({ environmentId: EnvironmentId.make("foreign") }),
      message({ threadId: ThreadId.make("other"), commandId: CommandId.make("other-command") }),
    ];

    for (const item of messages) retainAcknowledgedThreadMessage(item);

    expect(appAtomRegistry.get(acknowledgedThreadMessagesAtom)).toEqual(messages);
  });

  it("forgets only the matching transport and command acknowledgment", () => {
    const original = message();
    const otherEnvironment = message({ environmentId: EnvironmentId.make("foreign") });
    const otherCommand = message({ commandId: CommandId.make("new-command") });
    appAtomRegistry.set(acknowledgedThreadMessagesAtom, [original, otherEnvironment, otherCommand]);

    forgetAcknowledgedThreadMessage(original);

    expect(appAtomRegistry.get(acknowledgedThreadMessagesAtom)).toEqual([
      otherEnvironment,
      otherCommand,
    ]);
  });

  it("deduplicates the same acknowledgment without replacing its submitted content", () => {
    const original = message();
    retainAcknowledgedThreadMessage(original);

    retainAcknowledgedThreadMessage({ ...original, text: "later edit" });

    expect(appAtomRegistry.get(acknowledgedThreadMessagesAtom)).toEqual([original]);
  });
});
