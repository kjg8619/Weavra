import { useEffect } from "react";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { appAtomRegistry } from "./atom-registry";
import { threadOutboxManager } from "./thread-outbox";
import { environmentThreads } from "./threads";
import type { QueuedThreadMessage } from "./thread-outbox-model";

export function useThreadOutboxRefusals(
  queues: Readonly<Record<string, ReadonlyArray<QueuedThreadMessage>>>,
): void {
  // Only synchronized, exact source evidence can retire a residual attempt.
  // No history search, shell inference or draft restoration is involved.
  useEffect(() => {
    const subscriptions = Object.values(queues)
      .flat()
      .map((message) => {
        const record = threadOutboxManager.recordFor(message);
        if (record === null || record.kind === "retired") return () => {};
        const atom = environmentThreads.stateAtom(message.environmentId, message.threadId);
        let pending = false;
        return appAtomRegistry.subscribe(
          atom,
          (result) => {
            if (pending) return;
            const state = Option.getOrNull(AsyncResult.value(result));
            if (state?.status !== "live" || Option.isNone(state.data)) return;
            const sourceThread = state.data.value;
            if (sourceThread.id !== message.threadId) return;
            const sourceMessage = sourceThread.messages.find(
              (source) => source.id === message.messageId && source.role === "user",
            );
            if (sourceMessage === undefined) return;
            pending = true;
            void (async () => {
              for (const activity of sourceThread.activities) {
                const current = threadOutboxManager.recordAt(record.storageIdentity);
                const projection =
                  current === null ? null : threadOutboxManager.messageFor(current);
                if (projection === null) return;
                const retired = await threadOutboxManager.retireRefused(projection, {
                  sourceScope: { environmentId: message.environmentId, threadId: message.threadId },
                  sourceMessage,
                  activity,
                });
                if (retired !== null) return;
              }
            })()
              .catch((error: unknown) =>
                console.warn("[thread-outbox] refusal retirement failed", error),
              )
              .finally(() => {
                pending = false;
              });
          },
          { immediate: true },
        );
      });
    return () => subscriptions.forEach((unsubscribe) => unsubscribe());
  }, [queues]);
}
