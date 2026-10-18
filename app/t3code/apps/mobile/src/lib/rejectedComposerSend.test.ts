import { describe, expect, it } from "vite-plus/test";
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  ThreadId,
} from "@t3tools/contracts";
import type { ComposerDraft } from "../state/use-composer-drafts";
import {
  buildRejectedComposerSendContent,
  mergeRejectedComposerContext,
  RejectedComposerSendError,
} from "./rejectedComposerSend";

function draft(): ComposerDraft {
  const attachment = {
    id: "original",
    type: "file" as const,
    name: "original.txt",
    mimeType: "text/plain",
    sizeBytes: 3,
  };
  const image = {
    id: "original-image",
    type: "image" as const,
    name: "capture.png",
    mimeType: "image/png",
    sizeBytes: 3,
  };
  const screenshotContextId = ComposerContextId.make("screenshot");
  const record = {
    version: 1 as const,
    contextId: ComposerContextId.make("original-context"),
    kind: "skill" as const,
    label: "Original",
    name: "original-skill",
  };
  return {
    text: "  /feedback keep whitespace\n",
    context: { version: 1, records: [] },
    attachments: [
      { ...attachment, fileUri: "file:///original" },
      { ...image, fileUri: "file:///image", previewUri: "file:///image" },
    ],
    rejectedTurn: {
      version: 1,
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("thread"),
      message: {
        id: MessageId.make("message"),
        role: "user",
        text: "canonical text",
        attachments: [attachment, image],
        context: {
          version: 1,
          records: [
            record,
            {
              version: 1,
              kind: "image",
              contextId: screenshotContextId,
              label: "Screenshot",
              attachmentId: image.id,
              name: image.name,
              mimeType: image.mimeType,
              sizeBytes: image.sizeBytes,
            },
            {
              version: 1,
              kind: "preview-annotation",
              contextId: ComposerContextId.make("annotation"),
              label: "Annotation",
              annotationId: "annotation",
              pageUrl: "https://example.test",
              pageTitle: "Example",
              comment: "Original comment",
              targetSummary: "Target",
              styleChanges: [],
              regionCount: 1,
              strokeCount: 0,
              screenshotContextId,
            },
          ],
        },
        turnId: null,
        streaming: false,
        createdAt: "2026-10-04T00:00:00.000Z",
        updatedAt: "2026-10-04T00:00:00.000Z",
      },
      refusal: {
        version: 1,
        source: "workspace-ownership",
        requestId: MessageId.make("message"),
        reason: "target-changed",
        originCommandId: CommandId.make("command"),
        originSequence: 1,
      },
    },
  };
}

describe("recovered composer Send content", () => {
  it("keeps current text exact and restores unreferenced source context without mutating provenance", () => {
    const snapshot = draft();
    const before = JSON.stringify(snapshot);

    const result = buildRejectedComposerSendContent(snapshot);

    expect(result.text).toBe(snapshot.text);
    expect(result.context).toEqual(snapshot.rejectedTurn?.message.context);
    expect(result.attachments).toEqual(snapshot.attachments);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("orders source files first and appends additional context without duplicate mirrors", () => {
    const snapshot = draft();
    const extra = {
      version: 1 as const,
      contextId: ComposerContextId.make("extra"),
      kind: "skill" as const,
      label: "Extra",
      name: "extra-skill",
    };
    const additional = {
      id: "extra",
      type: "file" as const,
      name: "extra.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      fileUri: "file:///extra",
    };
    const sourceContext = snapshot.rejectedTurn?.message.context;
    const result = buildRejectedComposerSendContent({
      ...snapshot,
      attachments: [additional, ...snapshot.attachments.toReversed()],
      context: { version: 1, records: [extra, ...(sourceContext?.records.toReversed() ?? [])] },
    });
    expect(result.attachments.map((attachment) => attachment.id)).toEqual([
      "original",
      "original-image",
      "extra",
    ]);
    expect(result.context?.records).toEqual([...(sourceContext?.records ?? []), extra]);
  });

  it("rejects a conflicting context identity instead of overwriting source metadata", () => {
    const source = draft().rejectedTurn?.message.context;
    const changed = {
      version: 1 as const,
      records: (source?.records ?? []).map((record) => ({ ...record, label: "changed" })),
    };
    expect(() => mergeRejectedComposerContext(source, changed)).toThrow(RejectedComposerSendError);
  });

  it("rejects an unbound canonical attachment instead of relying on delivery's legacy fallback", () => {
    const snapshot = draft();
    const source = snapshot.rejectedTurn;
    if (source === undefined) throw new Error("Expected source");
    const changed = {
      ...snapshot,
      rejectedTurn: {
        ...source,
        message: {
          ...source.message,
          context: {
            version: 1 as const,
            records: (source.message.context?.records ?? []).map((record) =>
              "attachmentId" in record ? { ...record, attachmentId: "unbound" } : record,
            ),
          },
        },
      },
    };
    expect(() => buildRejectedComposerSendContent(changed)).toThrow(RejectedComposerSendError);
  });

  it.each(["missing", "metadata", "duplicate", "unmarked"] as const)(
    "rejects %s recovery input before admission",
    (invalid) => {
      const snapshot = draft();
      const changed = {
        ...snapshot,
        ...(invalid === "unmarked" ? { rejectedTurn: undefined } : {}),
        attachments:
          invalid === "missing"
            ? []
            : invalid === "metadata"
              ? snapshot.attachments.map((attachment) => ({ ...attachment, name: "changed.txt" }))
              : invalid === "duplicate"
                ? [...snapshot.attachments, ...snapshot.attachments]
                : snapshot.attachments,
      };
      expect(() => buildRejectedComposerSendContent(changed)).toThrow(RejectedComposerSendError);
    },
  );
});
