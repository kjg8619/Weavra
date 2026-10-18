import {
  ChatFileAttachment,
  ChatImageAttachment,
  type ChatAttachment,
  type EnvironmentId,
} from "@t3tools/contracts";
import { executeAtomQuery, squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { appAtomRegistry } from "../state/atom-registry";
import { assetEnvironment } from "../state/assets";
import { environmentSession } from "../state/session";
import { releaseUnusedComposerAttachmentFiles } from "../state/use-composer-drafts";
import { downloadAttachmentForPreview } from "./attachmentDownload";
import { retainComposerAttachmentFile } from "./composerAttachmentFiles";
import { persistComposerAttachmentFile, type DraftComposerAttachment } from "./composerImages";

export class RejectedComposerAttachmentError extends Schema.TaggedError<RejectedComposerAttachmentError>()(
  "RejectedComposerAttachmentError",
  { reason: Schema.Literals(["changed", "disconnected", "url", "size", "duplicate"]) },
) {}

const decodeAttachments = Schema.decodeUnknownSync(
  Schema.toType(Schema.Array(Schema.Union([ChatImageAttachment, ChatFileAttachment]))),
  { onExcessProperty: "error" },
);

/**
 * Authorizes and copies original bytes without changing source identities.
 * The caller authenticates the persisted refusal and captures scope before calling.
 * Keep this lease on an uncertain draft commit; release only after ownership is known.
 */
export async function prepareRejectedComposerAttachments(input: {
  readonly environmentId: EnvironmentId;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
}): Promise<{
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly release: () => Promise<void>;
}> {
  const { environmentId, signal, isCurrent } = input;
  const originals = decodeAttachments(JSON.parse(JSON.stringify(input.attachments)));
  if (new Set(originals.map((attachment) => attachment.id)).size !== originals.length) {
    throw new RejectedComposerAttachmentError({ reason: "duplicate" });
  }
  const attachments: DraftComposerAttachment[] = [];
  const leases: Array<() => void> = [];
  const released: DraftComposerAttachment[] = [];
  const release = async () => {
    for (const releaseFile of leases.splice(0)) releaseFile();
    if (released.length > 0) await releaseUnusedComposerAttachmentFiles(released.splice(0));
  };
  const checkScope = () => {
    if (signal.aborted || !isCurrent()) {
      throw new RejectedComposerAttachmentError({ reason: "changed" });
    }
  };
  checkScope();
  if (originals.length === 0) return { attachments, release };
  const connectionAtom = environmentSession.preparedConnectionValueAtom(environmentId);
  const connection = appAtomRegistry.get(connectionAtom);
  if (Option.isNone(connection)) {
    throw new RejectedComposerAttachmentError({ reason: "disconnected" });
  }
  const checkCurrent = () => {
    checkScope();
    const latest = appAtomRegistry.get(connectionAtom);
    if (Option.isNone(latest) || latest.value !== connection.value) {
      throw new RejectedComposerAttachmentError({ reason: "changed" });
    }
  };
  try {
    const { File } = await import("expo-file-system");
    checkCurrent();
    for (const original of originals) {
      checkCurrent();
      const result = await executeAtomQuery(
        appAtomRegistry,
        assetEnvironment.createUrl({
          environmentId,
          input: {
            resource: { _tag: "attachment", attachmentId: original.id, fileName: original.name },
          },
        }),
        { refresh: true, reportFailure: false, signal },
      );
      checkCurrent();
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const url = resolveAssetUrl(connection.value.httpBaseUrl, result.value.relativeUrl);
      if (url === null || new URL(url).origin !== new URL(connection.value.httpBaseUrl).origin) {
        throw new RejectedComposerAttachmentError({ reason: "url" });
      }
      const temporary = await downloadAttachmentForPreview({
        url,
        attachment: original,
        signal,
      });
      if (temporary === null) throw new RejectedComposerAttachmentError({ reason: "changed" });
      try {
        checkCurrent();
        const fileUri = await persistComposerAttachmentFile(
          temporary.uri,
          original.name,
          original.sizeBytes,
        );
        const attachment: DraftComposerAttachment =
          original.type === "image"
            ? { ...original, fileUri, previewUri: fileUri }
            : { ...original, fileUri };
        attachments.push(attachment);
        leases.push(
          retainComposerAttachmentFile(fileUri, () => {
            released.push(attachment);
          }),
        );
        checkCurrent();
        if (new File(fileUri).size !== original.sizeBytes) {
          throw new RejectedComposerAttachmentError({ reason: "size" });
        }
      } finally {
        temporary.dispose();
      }
    }
    return { attachments, release };
  } catch (cause) {
    // No draft has received these new copies yet. Release only this operation's leases.
    await release();
    throw cause;
  }
}
