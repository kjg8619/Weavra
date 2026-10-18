import { Atom } from "effect/unstable/reactivity";
import type { MessageId, ScopedThreadRef } from "@t3tools/contracts";
import { appAtomRegistry } from "./atom-registry";
import { threadOutboxIdentity, type QueuedThreadMessage } from "./thread-outbox-model";

// A command acknowledgment can precede its message in the subscribed timeline.
// Keep the visible row until that projection arrives, independently of outbox cleanup.
export const acknowledgedThreadMessagesAtom = Atom.make<ReadonlyArray<QueuedThreadMessage>>(
  [],
).pipe(Atom.keepAlive);

export function retainAcknowledgedThreadMessage(message: QueuedThreadMessage) {
  const current = appAtomRegistry.get(acknowledgedThreadMessagesAtom);
  const identity = threadOutboxIdentity(message);
  appAtomRegistry.set(
    acknowledgedThreadMessagesAtom,
    current.some(
      (entry) => threadOutboxIdentity(entry) === identity && entry.commandId === message.commandId,
    )
      ? current
      : [...current, message],
  );
}

export function forgetAcknowledgedThreadMessage(message: QueuedThreadMessage) {
  const current = appAtomRegistry.get(acknowledgedThreadMessagesAtom);
  const identity = threadOutboxIdentity(message);
  appAtomRegistry.set(
    acknowledgedThreadMessagesAtom,
    current.filter(
      (entry) => threadOutboxIdentity(entry) !== identity || entry.commandId !== message.commandId,
    ),
  );
}

export function forgetAcknowledgedThreadEchoes(input: {
  readonly scope: ScopedThreadRef;
  readonly messageIds: ReadonlySet<MessageId>;
}) {
  const current = appAtomRegistry.get(acknowledgedThreadMessagesAtom);
  const echoed = (message: QueuedThreadMessage) =>
    message.environmentId === input.scope.environmentId &&
    message.threadId === input.scope.threadId &&
    input.messageIds.has(message.messageId);
  if (current.some(echoed)) {
    appAtomRegistry.set(
      acknowledgedThreadMessagesAtom,
      current.filter((message) => !echoed(message)),
    );
  }
}
