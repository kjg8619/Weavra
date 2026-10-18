import {
  type AssetCreateUrlInput,
  type AssetCreateUrlResult,
  type MessageId,
  type OrchestrationMessage,
  type OrchestrationMessageContext,
  type OrchestrationThreadActivity,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { decodeTurnStartRefusal } from "@t3tools/client-runtime/state/turnStartRefusal";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import {
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  commitRejectedTurnDraft,
  composerDraftHasUserContent,
  rejectedTurnRecoveryKey,
  useComposerDraftStore,
  type RejectedTurnDraft,
} from "../composerDraftStore";

export interface RejectedTurnSource {
  readonly scope: ScopedThreadRef;
  readonly synchronized: boolean;
  readonly messages: ReadonlyArray<OrchestrationMessage>;
  readonly activities: ReadonlyArray<OrchestrationThreadActivity>;
}

export type RecoveryAssetUrlCreator = (input: {
  environmentId: ScopedThreadRef["environmentId"];
  input: AssetCreateUrlInput;
}) => Promise<AtomCommandResult<AssetCreateUrlResult, unknown>>;

export function rejectedTurnMessage(
  scope: ScopedThreadRef,
  source: RejectedTurnSource,
  messageId: MessageId,
): OrchestrationMessage | null {
  const message = source.messages.find(
    (candidate) => candidate.id === messageId && candidate.role === "user",
  );
  if (!message) return null;
  return source.activities.some(
    (activity) => decodeTurnStartRefusal(scope, source.scope, activity)?.requestId === message.id,
  )
    ? message
    : null;
}

export async function recoverRejectedTurn(input: {
  scope: ScopedThreadRef;
  messageId: MessageId;
  readSource: () => RejectedTurnSource;
  isComposerReady: () => boolean;
  httpBaseUrl: string;
  createAssetUrl: RecoveryAssetUrlCreator;
}): Promise<"recovered" | "existing"> {
  const source = input.readSource();
  const message = rejectedTurnMessage(input.scope, source, input.messageId);
  if (
    !source.synchronized ||
    !message ||
    !input.isComposerReady() ||
    !useComposerDraftStore.persist.hasHydrated()
  ) {
    throw new Error("Reconnect and finish synchronizing this conversation before recovering.");
  }
  const key = rejectedTurnRecoveryKey(input.scope, message.id);
  const expectedDraft = useComposerDraftStore.getState().getComposerDraft(input.scope);
  if (expectedDraft?.rejectedTurn?.key === key) return "existing";
  if (
    expectedDraft &&
    (expectedDraft.prompt.length !== 0 || composerDraftHasUserContent(expectedDraft))
  ) {
    throw new Error("Send or clear the current draft before recovering this message.");
  }

  const attachments = message.attachments ?? [];
  if (attachments.some((attachment) => attachment.type !== "image" && attachment.type !== "file")) {
    throw new Error("This message contains an unsupported attachment.");
  }
  const recovered: RejectedTurnDraft = {
    key,
    environmentId: input.scope.environmentId,
    threadId: input.scope.threadId,
    messageId: message.id,
    text: message.text,
    attachments: attachments.flatMap((attachment) =>
      attachment.type === "image" || attachment.type === "file" ? [attachment] : [],
    ) as RejectedTurnDraft["attachments"],
    ...(message.context !== undefined ? { context: message.context } : {}),
  };

  let draftChanged = false;
  let hydrationChanged = false;
  const unsubscribeDraft = useComposerDraftStore.subscribe((state) => {
    if (state.getComposerDraft(input.scope) !== expectedDraft) draftChanged = true;
  });
  const unsubscribeHydration = useComposerDraftStore.persist.onHydrate(() => {
    hydrationChanged = true;
  });
  try {
    await Promise.all(
      recovered.attachments.map(async (attachment) => {
        // This authenticated query checks the original asset's existence and
        // issues its signed URL. Recovery never downloads bytes or uploads.
        const result = await input.createAssetUrl({
          environmentId: input.scope.environmentId,
          input: {
            resource: {
              _tag: "attachment",
              attachmentId: attachment.id,
              fileName: attachment.name,
              mimeType: attachment.mimeType,
            },
          },
        });
        if (result._tag === "Failure") throw squashAtomCommandFailure(result);
        if (resolveAssetUrl(input.httpBaseUrl, result.value.relativeUrl) === null) {
          throw new Error("The environment returned an invalid attachment URL.");
        }
      }),
    );
    if (
      input.readSource() !== source ||
      !source.synchronized ||
      hydrationChanged ||
      !useComposerDraftStore.persist.hasHydrated() ||
      !input.isComposerReady()
    ) {
      throw new Error("The conversation changed while its attachments were checked.");
    }
    const current = useComposerDraftStore.getState().getComposerDraft(input.scope);
    if (current?.rejectedTurn?.key === key) return "existing";
    if (draftChanged) throw new Error("The draft changed while its attachments were checked.");
    const result = await commitRejectedTurnDraft(input.scope, expectedDraft, recovered);
    if (result === "changed") throw new Error("The draft is no longer empty and unchanged.");
    return result;
  } finally {
    unsubscribeDraft();
    unsubscribeHydration();
  }
}

export function recoveredTurnContextForSend(
  recovered: RejectedTurnDraft,
  attachmentIds: ReadonlyArray<string>,
  additional?: OrchestrationMessageContext,
): OrchestrationMessageContext | undefined {
  if (attachmentIds.length !== recovered.attachments.length) {
    throw new Error("Recovered attachment bindings are incomplete.");
  }
  const ids = new Map(
    recovered.attachments.map((attachment, index) => [attachment.id, attachmentIds[index]!]),
  );
  const records = (recovered.context?.records ?? []).map((record) => {
    if (!("attachmentId" in record)) return record;
    const attachmentId = ids.get(record.attachmentId);
    return attachmentId === undefined ? record : { ...record, attachmentId };
  });
  const contextIds = new Set(records.map((record) => record.contextId));
  for (const record of additional?.records ?? []) {
    if (contextIds.has(record.contextId)) {
      throw new Error("A new context record conflicts with recovered context.");
    }
    contextIds.add(record.contextId);
    records.push(record);
  }
  return records.length > 0 ? { version: 1, records } : undefined;
}
