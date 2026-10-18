import {
  CommandId,
  MessageId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { stableStringify } from "@t3tools/shared/relaySigning";
import { Atom } from "effect/unstable/reactivity";
import { appAtomRegistry } from "./atom-registry";
import {
  captureComposerRecoveryTarget,
  completeRejectedComposerSend,
  getComposerDraftSnapshot,
  isComposerRecoveryTargetCurrent,
  releaseRejectedComposerAdmission,
  sameComposerDraftState,
} from "./use-composer-drafts";
import { enqueueThreadOutboxMessage } from "./thread-outbox";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { makeQueuedMessageMetadata } from "../lib/commandMetadata";
import { composerContextSendBlockReason } from "../lib/composerContext";
import { buildRejectedComposerSendContent } from "../lib/rejectedComposerSend";
import { prepareRejectedComposerAttachments } from "../lib/rejectedComposerAttachments";
import { recoverRejectedComposerDraft } from "../lib/recoverRejectedComposerDraft";
import { selectRejectedComposerSource } from "../lib/rejectedComposerSource";
import { scopedThreadKey } from "../lib/scopedEntities";

export interface RejectedComposerOwner {
  readonly key: string;
  readonly scope: ScopedThreadRef;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly readSource: () => Parameters<typeof selectRejectedComposerSource>[0]["source"];
}

/** Invalidation consumes the old lifetime even if account/route/settings return to A. */
export function createRejectedComposerGeneration() {
  let controller = new AbortController();
  let active = true;
  const invalidate = () => {
    controller.abort();
    controller = new AbortController();
  };
  return {
    capture: () => {
      const captured = controller;
      return {
        signal: captured.signal,
        isCurrent: () => active && captured === controller && !captured.signal.aborted,
      };
    },
    invalidate,
    activate: () => {
      invalidate();
      active = true;
    },
    deactivate: () => {
      active = false;
      invalidate();
    },
  };
}

export type RejectedComposerOperationStatus =
  | "recovering"
  | "recovered"
  | "changed"
  | "unavailable"
  | "preparing"
  | "saving"
  | "queued"
  | "queued-changed"
  | "admission-uncertain"
  | "cleanup-uncertain"
  | "failed-retained"
  | "failed"
  | "recovery-uncertain"
  | "recovery-referenced"
  | "discarding"
  | "discarded";

export interface RejectedComposerOperationState {
  readonly status: RejectedComposerOperationStatus;
  readonly busy: boolean;
  readonly needsCheck: boolean;
  readonly messageId?: MessageId;
  readonly problem?: string;
}

type Operation = {
  state: RejectedComposerOperationState;
  check?: (owner: RejectedComposerOwner) => Promise<void>;
  canFocus?: () => boolean;
};
// Handles, downloaded-file leases and duplicate guards outlive every screen.
const operations = new Map<string, Operation>();
export const rejectedComposerOperationsAtom = Atom.make<
  Readonly<Record<string, RejectedComposerOperationState>>
>({}).pipe(Atom.keepAlive);

function publish(key: string, operation: Operation, state: RejectedComposerOperationState) {
  operation.state = state;
  appAtomRegistry.set(rejectedComposerOperationsAtom, {
    ...appAtomRegistry.get(rejectedComposerOperationsAtom),
    [key]: state,
  });
}

function begin(owner: RejectedComposerOwner, status: RejectedComposerOperationStatus) {
  const previous = operations.get(owner.key);
  if (
    !owner.isCurrent() ||
    owner.signal.aborted ||
    previous?.state.busy ||
    previous?.state.needsCheck
  )
    return null;
  const operation: Operation = { state: { status, busy: true, needsCheck: false } };
  operations.set(owner.key, operation);
  publish(owner.key, operation, operation.state);
  return operation;
}

function problem(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Local persistence could not be verified.";
}

export async function recoverRejectedComposer(
  owner: RejectedComposerOwner,
  messageId: MessageId,
): Promise<boolean> {
  const operation = begin(owner, "recovering");
  if (operation === null) return false;
  try {
    const result = await recoverRejectedComposerDraft({ ...owner, messageId });
    if (result.status === "uncertain") {
      operation.check = async () => {
        const status = await result.reconcile();
        publish(owner.key, operation, {
          status: status === "referenced" ? "recovery-referenced" : "recovery-uncertain",
          busy: false,
          needsCheck: status !== "released",
        });
      };
      publish(owner.key, operation, {
        status: "recovery-uncertain",
        busy: false,
        needsCheck: true,
      });
      return false;
    }
    publish(owner.key, operation, {
      status: result.status === "existing" ? "recovered" : result.status,
      busy: false,
      needsCheck: false,
    });
    return (result.status === "recovered" || result.status === "existing") && owner.isCurrent();
  } catch (cause) {
    publish(owner.key, operation, {
      status: "unavailable",
      busy: false,
      needsCheck: false,
      problem: problem(cause),
    });
    return false;
  }
}

/** Only an explicit Send enters here. Nothing subscribes, retries or enqueues on mount. */
export async function sendRejectedComposer(input: {
  readonly owner: RejectedComposerOwner;
  readonly settings: Pick<
    QueuedThreadMessage,
    "modelSelection" | "runtimeMode" | "interactionMode"
  >;
}): Promise<MessageId | null> {
  const { owner, settings } = input;
  const target = captureComposerRecoveryTarget(owner.scope);
  const expected = getComposerDraftSnapshot(
    scopedThreadKey(owner.scope.environmentId, owner.scope.threadId),
  );
  const source = expected.rejectedTurn;
  if (target === null || source === undefined) return null;
  const selected = () =>
    selectRejectedComposerSource({
      scope: owner.scope,
      messageId: source.message.id,
      source: owner.readSource(),
    });
  const sourceFingerprint = stableStringify(source);
  const current = () =>
    !owner.signal.aborted &&
    owner.isCurrent() &&
    isComposerRecoveryTargetCurrent(target) &&
    sameComposerDraftState(expected, getComposerDraftSnapshot(target.draftKey)) &&
    stableStringify(selected()) === sourceFingerprint;
  if (!current()) return null;
  const operation = begin(owner, "preparing");
  if (operation === null) return null;
  let prepared: Awaited<ReturnType<typeof prepareRejectedComposerAttachments>> | undefined;
  let admission: ReturnType<typeof enqueueThreadOutboxMessage> | undefined;
  let messageId: MessageId | undefined;
  try {
    const { File } = await import("expo-file-system");
    if (!current()) {
      publish(owner.key, operation, { status: "changed", busy: false, needsCheck: false });
      return null;
    }
    const missing = (source.message.attachments ?? []).filter((original) => {
      const attachment = expected.attachments.find((candidate) => candidate.id === original.id);
      return attachment?.fileUri === undefined || !new File(attachment.fileUri).exists;
    });
    if (missing.length > 0) {
      prepared = await prepareRejectedComposerAttachments({
        environmentId: owner.scope.environmentId,
        attachments: missing,
        signal: owner.signal,
        isCurrent: current,
      });
    }
    if (!current()) {
      await prepared?.release();
      publish(owner.key, operation, { status: "changed", busy: false, needsCheck: false });
      return null;
    }
    const replaced = new Set(prepared?.attachments.map((attachment) => attachment.id));
    const content = buildRejectedComposerSendContent({
      ...expected,
      attachments: [
        ...expected.attachments.filter((attachment) => !replaced.has(attachment.id)),
        ...(prepared?.attachments ?? []),
      ],
    });
    const block = composerContextSendBlockReason(content.context);
    if (
      block !== null ||
      content.text.length > PROVIDER_SEND_TURN_MAX_INPUT_CHARS ||
      content.attachments.length > PROVIDER_SEND_TURN_MAX_ATTACHMENTS ||
      (content.text.length === 0 && content.attachments.length === 0)
    ) {
      await prepared?.release();
      publish(owner.key, operation, {
        status: "failed",
        busy: false,
        needsCheck: false,
        problem: block ?? "The complete recovered message exceeds the send limits or is empty.",
      });
      return null;
    }
    // No await after this last generation check until one new identity is admitted.
    if (!current()) {
      await prepared?.release();
      publish(owner.key, operation, { status: "changed", busy: false, needsCheck: false });
      return null;
    }
    const metadata = makeQueuedMessageMetadata();
    messageId = MessageId.make(metadata.messageId);
    admission = enqueueThreadOutboxMessage({
      ...owner.scope,
      ...content,
      ...settings,
      messageId,
      commandId: CommandId.make(metadata.commandId),
      createdAt: metadata.createdAt,
    });
    const ownedAdmission = admission;
    const queuedId = messageId;
    let committed = false;
    let failedOwnerReleased = false;
    const finish = async (checkingOwner: RejectedComposerOwner) => {
      if (!checkingOwner.isCurrent()) return;
      if (!committed) {
        const status = await ownedAdmission.reconcile();
        if (!checkingOwner.isCurrent()) return;
        if (status === "unknown") return;
        committed = status === "committed";
        failedOwnerReleased =
          (await ownedAdmission.releaseAfterRecordOwnership()) ||
          (await releaseRejectedComposerAdmission({
            draftKey: target.draftKey,
            source,
            content,
            ownerCurrent: checkingOwner.isCurrent,
            releaseAfterHandback: ownedAdmission.releaseAfterHandback,
          })) === "released";
        if (!failedOwnerReleased) {
          publish(owner.key, operation, {
            status: committed ? "cleanup-uncertain" : "failed-retained",
            busy: false,
            needsCheck: true,
            messageId: queuedId,
          });
          return;
        }
        if (!committed) {
          await prepared?.release();
          publish(owner.key, operation, { status: "failed", busy: false, needsCheck: false });
          return;
        }
      } else if (operation.state.status === "cleanup-uncertain" && !failedOwnerReleased) {
        // A prior check proved admission but not byte ownership.
        failedOwnerReleased =
          (await ownedAdmission.releaseAfterRecordOwnership()) ||
          (await releaseRejectedComposerAdmission({
            draftKey: target.draftKey,
            source,
            content,
            ownerCurrent: checkingOwner.isCurrent,
            releaseAfterHandback: ownedAdmission.releaseAfterHandback,
          })) === "released";
        if (!failedOwnerReleased) return;
      }
      try {
        const completion = await completeRejectedComposerSend({
          target,
          expected,
          ownerCurrent: checkingOwner.isCurrent,
        });
        const completedTarget = captureComposerRecoveryTarget(owner.scope);
        operation.canFocus = () =>
          completion === "cleared" &&
          completedTarget !== null &&
          checkingOwner.isCurrent() &&
          isComposerRecoveryTargetCurrent(completedTarget);
        await prepared?.release();
        publish(owner.key, operation, {
          status: completion === "cleared" ? "queued" : "queued-changed",
          busy: false,
          needsCheck: false,
          messageId: queuedId,
        });
      } catch (cause) {
        publish(owner.key, operation, {
          status: "cleanup-uncertain",
          busy: false,
          needsCheck: true,
          messageId: queuedId,
          problem: problem(cause),
        });
      }
    };
    operation.check = finish;
    publish(owner.key, operation, { status: "saving", busy: true, needsCheck: false, messageId });
    try {
      await admission.committed;
      committed = true;
      failedOwnerReleased = true;
    } catch (cause) {
      publish(owner.key, operation, {
        status: "admission-uncertain",
        busy: false,
        needsCheck: true,
        messageId,
        problem: problem(cause),
      });
      return null;
    }
    if (owner.isCurrent()) await finish(owner);
    else
      publish(owner.key, operation, {
        status: "cleanup-uncertain",
        busy: false,
        needsCheck: true,
        messageId,
      });
    return messageId;
  } catch (cause) {
    if (admission === undefined) await prepared?.release();
    publish(owner.key, operation, {
      status: admission === undefined ? "failed" : "admission-uncertain",
      busy: false,
      needsCheck: admission !== undefined,
      ...(messageId === undefined ? {} : { messageId }),
      problem: problem(cause),
    });
    return null;
  }
}

export function canFocusRejectedComposerSend(key: string, messageId: MessageId): boolean {
  const operation = operations.get(key);
  return operation?.state.messageId === messageId && operation.canFocus?.() === true;
}

export async function checkRejectedComposerOperation(owner: RejectedComposerOwner) {
  const operation = operations.get(owner.key);
  if (
    !owner.isCurrent() ||
    operation?.check === undefined ||
    operation.state.busy ||
    !operation.state.needsCheck
  )
    return;
  publish(owner.key, operation, { ...operation.state, busy: true });
  try {
    await operation.check(owner);
  } catch (cause) {
    publish(owner.key, operation, { ...operation.state, problem: problem(cause) });
  } finally {
    publish(owner.key, operation, { ...operation.state, busy: false });
  }
}

export async function discardRejectedComposer(owner: RejectedComposerOwner) {
  const operation = begin(owner, "discarding");
  if (operation === null) return;
  const target = captureComposerRecoveryTarget(owner.scope);
  const expected = getComposerDraftSnapshot(
    scopedThreadKey(owner.scope.environmentId, owner.scope.threadId),
  );
  if (target === null) {
    publish(owner.key, operation, { status: "changed", busy: false, needsCheck: false });
    return;
  }
  operation.check = async (currentOwner) => {
    const status = await completeRejectedComposerSend({
      target,
      expected,
      ownerCurrent: currentOwner.isCurrent,
    });
    publish(owner.key, operation, {
      status: status === "cleared" ? "discarded" : "changed",
      busy: false,
      needsCheck: false,
    });
  };
  try {
    await operation.check(owner);
  } catch (cause) {
    publish(owner.key, operation, {
      status: "cleanup-uncertain",
      busy: false,
      needsCheck: true,
      problem: problem(cause),
    });
  }
}
