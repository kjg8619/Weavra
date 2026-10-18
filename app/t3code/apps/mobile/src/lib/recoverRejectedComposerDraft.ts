import type { MessageId, ScopedThreadRef } from "@t3tools/contracts";
import { stableStringify } from "@t3tools/shared/relaySigning";
import {
  captureComposerRecoveryTarget,
  commitRejectedComposerDraft,
  getComposerDraftSnapshot,
  isComposerRecoveryTargetCurrent,
  persistedComposerAttachmentOwnership,
} from "../state/use-composer-drafts";
import {
  prepareRejectedComposerAttachments,
  RejectedComposerAttachmentError,
} from "./rejectedComposerAttachments";
import { selectRejectedComposerSource } from "./rejectedComposerSource";

export type RejectedComposerRecoveryResult =
  | { readonly status: "recovered" | "existing" | "changed" | "unavailable" }
  | {
      readonly status: "uncertain";
      readonly cause: unknown;
      /** Explicit reconciliation only; never automatically replay the recovery. */
      readonly reconcile: () => Promise<"released" | "referenced" | "unknown">;
    };

/** Caller supplies synchronized client state and generation-based route/account cancellation. */
export async function recoverRejectedComposerDraft(input: {
  readonly scope: ScopedThreadRef;
  readonly messageId: MessageId;
  readonly readSource: () => Parameters<typeof selectRejectedComposerSource>[0]["source"];
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
}): Promise<RejectedComposerRecoveryResult> {
  const scope = { ...input.scope };
  const { messageId, readSource, signal, isCurrent } = input;
  if (signal.aborted || !isCurrent()) return { status: "changed" };
  const source = selectRejectedComposerSource({ scope, messageId, source: readSource() });
  if (source === null) return { status: "unavailable" };
  const fingerprint = stableStringify(source);
  const target = captureComposerRecoveryTarget(scope);
  if (target === null) return { status: "changed" };
  const existing = getComposerDraftSnapshot(target.draftKey).rejectedTurn;
  if (existing !== undefined) {
    return { status: stableStringify(existing) === fingerprint ? "existing" : "changed" };
  }
  const sourceCurrent = () => {
    if (signal.aborted || !isCurrent()) return false;
    const latest = selectRejectedComposerSource({ scope, messageId, source: readSource() });
    return latest !== null && stableStringify(latest) === fingerprint;
  };
  let prepared: Awaited<ReturnType<typeof prepareRejectedComposerAttachments>>;
  try {
    prepared = await prepareRejectedComposerAttachments({
      environmentId: scope.environmentId,
      attachments: source.message.attachments ?? [],
      signal,
      isCurrent: () => sourceCurrent() && isComposerRecoveryTargetCurrent(target),
    });
  } catch (cause) {
    const current = getComposerDraftSnapshot(target.draftKey);
    if (
      cause instanceof RejectedComposerAttachmentError &&
      cause.reason === "changed" &&
      sourceCurrent() &&
      current.project === undefined &&
      current.rejectedTurn !== undefined &&
      stableStringify(current.rejectedTurn) === fingerprint
    )
      return { status: "existing" };
    throw cause;
  }
  let status: "recovered" | "existing" | "changed";
  try {
    status = await commitRejectedComposerDraft({
      target,
      source,
      attachments: prepared.attachments,
      isCurrent: sourceCurrent,
    });
  } catch (cause) {
    // A thrown synchronous rename can still have changed disk. Do not release
    // its files based only on the live atom, or restore old content to compensate.
    let released = false;
    return {
      status: "uncertain",
      cause,
      reconcile: async () => {
        if (released) return "released";
        const ownership = await persistedComposerAttachmentOwnership(prepared.attachments);
        if (ownership !== "unreferenced") return ownership;
        await prepared.release();
        released = true;
        return "released";
      },
    };
  }
  await prepared.release();
  return { status };
}
