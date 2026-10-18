import type {
  MessageId,
  OrchestrationMessage,
  OrchestrationThreadActivity,
  ScopedThreadRef,
} from "@t3tools/contracts";
import { decodeTurnStartRefusal } from "@t3tools/client-runtime/state/turnStartRefusal";
import type { RejectedComposerDraftSource } from "../state/use-composer-drafts";

/** Select only positive evidence from the synchronized, already-loaded conversation. */
export function selectRejectedComposerSource(input: {
  readonly scope: ScopedThreadRef;
  readonly messageId: MessageId;
  readonly source: {
    readonly scope: ScopedThreadRef;
    readonly synchronized: boolean;
    readonly messages: ReadonlyArray<OrchestrationMessage>;
    readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
  };
}): RejectedComposerDraftSource | null {
  if (!input.source.synchronized) return null;
  const message = input.source.messages.find(
    (candidate) => candidate.id === input.messageId && candidate.role === "user",
  );
  if (message === undefined) return null;
  for (const activity of input.source.activities) {
    const refusal = decodeTurnStartRefusal(input.scope, input.source.scope, activity);
    if (refusal?.requestId !== message.id) continue;
    return {
      version: 1,
      environmentId: input.scope.environmentId,
      threadId: input.scope.threadId,
      message,
      refusal,
    };
  }
  return null;
}
