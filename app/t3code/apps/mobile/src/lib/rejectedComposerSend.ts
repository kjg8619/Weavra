import type { OrchestrationMessageContext } from "@t3tools/contracts";
import { stableStringify } from "@t3tools/shared/relaySigning";
import * as Schema from "effect/Schema";
import type { ComposerDraft } from "../state/use-composer-drafts";

export class RejectedComposerSendError extends Schema.TaggedError<RejectedComposerSendError>()(
  "RejectedComposerSendError",
  {
    reason: Schema.Literals([
      "not-recovered",
      "context-conflict",
      "attachment-missing",
      "attachment-conflict",
    ]),
  },
) {}

/** Canonical records remain ordered and unpruned; editable mirrors add no duplicate. */
export function mergeRejectedComposerContext(
  source: OrchestrationMessageContext | undefined,
  editable: OrchestrationMessageContext | undefined,
): OrchestrationMessageContext | undefined {
  if (source === undefined && editable === undefined) return undefined;
  const records = [...(source?.records ?? [])];
  const byId = new Map(records.map((record) => [record.contextId, record]));
  for (const record of records) {
    const indexed = byId.get(record.contextId);
    if (indexed !== record && stableStringify(indexed) !== stableStringify(record)) {
      throw new RejectedComposerSendError({ reason: "context-conflict" });
    }
  }
  for (const record of editable?.records ?? []) {
    const existing = byId.get(record.contextId);
    if (existing !== undefined) {
      if (existing !== record && stableStringify(existing) !== stableStringify(record)) {
        throw new RejectedComposerSendError({ reason: "context-conflict" });
      }
      continue;
    }
    byId.set(record.contextId, record);
    records.push(record);
  }
  return { version: 1, records };
}

/** Construct content only. Admission identities and transport bindings are created later. */
export function buildRejectedComposerSendContent(snapshot: ComposerDraft) {
  const source = snapshot.rejectedTurn;
  if (source === undefined) throw new RejectedComposerSendError({ reason: "not-recovered" });
  const available = new Map(snapshot.attachments.map((attachment) => [attachment.id, attachment]));
  if (available.size !== snapshot.attachments.length) {
    throw new RejectedComposerSendError({ reason: "attachment-conflict" });
  }
  const originals = source.message.attachments ?? [];
  const originalIds = new Set(originals.map((attachment) => attachment.id));
  if (originalIds.size !== originals.length) {
    throw new RejectedComposerSendError({ reason: "attachment-conflict" });
  }
  const attachments = originals.map((original) => {
    const local = available.get(original.id);
    if (local === undefined || local.fileUri === undefined) {
      throw new RejectedComposerSendError({ reason: "attachment-missing" });
    }
    if (
      local.type !== original.type ||
      local.name !== original.name ||
      local.mimeType !== original.mimeType ||
      local.sizeBytes !== original.sizeBytes ||
      stableStringify({ source: local.source }) !==
        stableStringify({ source: "source" in original ? original.source : undefined })
    ) {
      throw new RejectedComposerSendError({ reason: "attachment-conflict" });
    }
    return local;
  });
  attachments.push(...snapshot.attachments.filter((attachment) => !originalIds.has(attachment.id)));
  const context = mergeRejectedComposerContext(source.message.context, snapshot.context);
  // Delivery's remapper deliberately supports ordinary legacy references. A
  // recovered submission must not use that fallback for an unbound source file.
  for (const record of context?.records ?? []) {
    if ("attachmentId" in record) {
      const attachment = available.get(record.attachmentId);
      if (attachment?.fileUri === undefined) {
        throw new RejectedComposerSendError({ reason: "attachment-missing" });
      }
      if (
        record.name !== attachment.name ||
        record.mimeType !== attachment.mimeType ||
        record.sizeBytes !== attachment.sizeBytes
      )
        throw new RejectedComposerSendError({ reason: "attachment-conflict" });
    }
    if (
      record.kind === "preview-annotation" &&
      "screenshotContextId" in record &&
      record.screenshotContextId !== undefined &&
      !context?.records.some(
        (candidate) =>
          candidate.contextId === record.screenshotContextId && candidate.kind === "image",
      )
    )
      throw new RejectedComposerSendError({ reason: "attachment-missing" });
  }
  return {
    text: snapshot.text,
    context,
    attachments,
  };
}
