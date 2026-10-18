import { fixture, harness } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  ThreadId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { appAtomRegistry } from "./atom-registry";
import * as drafts from "./use-composer-drafts";
import { consumeComposerUsageLimits } from "./composer-command-consumption";
import { applyComposerCommandSelection } from "../features/threads/use-composer-command-menu";
vi.mock("./queries", () => ({
  useComposerPathSearch: () => ({ entries: [], isPending: false }),
  useComposerPullRequestSearch: () => ({ entries: [], isPending: false, error: null }),
}));

const key = "environment:thread";
function recovered(): drafts.ComposerDraft {
  const file = {
    id: "source-file",
    type: "file" as const,
    name: "source.txt",
    mimeType: "text/plain",
    sizeBytes: 3,
  };
  const fileRecord = {
    version: 1 as const,
    kind: "file" as const,
    contextId: ComposerContextId.make("source-file-context"),
    label: file.name,
    attachmentId: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
  };
  const context = {
    version: 1 as const,
    records: [
      fileRecord,
      {
        version: 1 as const,
        kind: "skill" as const,
        contextId: ComposerContextId.make("unreferenced"),
        label: "Source",
        name: "source-skill",
      },
    ],
  };
  const text = formatComposerContextReference(fileRecord);
  return {
    text,
    context,
    attachments: [{ ...file, fileUri: "file:///documents/t3-composer-attachments/source.txt" }],
    rejectedTurn: {
      version: 1,
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("thread"),
      message: {
        id: MessageId.make("source-message"),
        role: "user",
        text,
        context,
        attachments: [file],
        turnId: null,
        streaming: false,
        createdAt: "2026-10-04T00:00:00.000Z",
        updatedAt: "2026-10-04T00:00:00.000Z",
      },
      refusal: {
        version: 1,
        source: "workspace-ownership",
        requestId: MessageId.make("source-message"),
        reason: "target-changed",
        originCommandId: CommandId.make("command"),
        originSequence: 1,
      },
    },
  };
}
beforeEach(async () => {
  vi.useFakeTimers();
  fixture().reset();
  appAtomRegistry.set(drafts.composerDraftsAtom, {});
  drafts.resetComposerDraftsLoadState();
  await drafts.waitForComposerDraftsLoaded();
});
afterEach(async () => {
  await drafts.flushComposerDrafts();
  appAtomRegistry.set(drafts.composerDraftsAtom, {});
  appAtomRegistry.set(drafts.composerCloudDraftsAtom, { accountId: null, signedOut: {} });
  harness.draftFile.document = JSON.stringify({ schemaVersion: 1, drafts: {} });
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("recovered composer editing boundaries", () => {
  it.each([true, false])(
    "uses the live marker for typed limits consumption (marked=%s)",
    async (marked) => {
      const source = recovered();
      const { rejectedTurn, ...ordinary } = source;
      const draft = {
        ...ordinary,
        text: "/usage-limits",
        attachments: [],
        ...(marked ? { rejectedTurn } : {}),
      };
      await drafts.restoreComposerDraftSnapshot(key, draft);
      const consumed = consumeComposerUsageLimits({
        draftKey: key,
        offered: true,
        open: () => true,
        changeText: (text) => drafts.setComposerDraftText(key, text),
      });
      expect(consumed).toBe(!marked);
      expect(drafts.getComposerDraftSnapshot(key).text).toBe(marked ? "/usage-limits" : "");
      await drafts.flushComposerDrafts();
      expect(
        drafts.decodePersistedComposerState(JSON.parse(harness.draftFile.document)).drafts[key]
          ?.rejectedTurn,
      ).toEqual(marked ? rejectedTurn : undefined);
    },
  );

  it.each([true, false])(
    "fences an already-open menu using the live draft (marked=%s)",
    async (marked) => {
      const source = recovered();
      const { rejectedTurn, ...ordinary } = source;
      // The menu was opened against ordinary /plan, before a recovery committed.
      const selections: { start: number; end: number }[] = [];
      const selection = {
        ownerKey: key,
        trigger: { kind: "slash-command" as const, query: "plan", rangeStart: 0, rangeEnd: 5 },
        item: {
          id: "cmd:plan",
          type: "slash-command" as const,
          command: "plan",
          label: "/plan",
          description: "",
        },
        items: [],
        draftMessage: "/plan",
        allowInteractionMode: true,
        onChangeDraftMessage: (text: string) => drafts.setComposerDraftText(key, text),
        onUpdateInteractionMode: (interactionMode: "default" | "plan") =>
          drafts.updateComposerDraftSettings(key, { interactionMode }),
        setSelection: (value: { start: number; end: number }) => {
          selections.push(value);
        },
      };
      await drafts.restoreComposerDraftSnapshot(key, {
        ...ordinary,
        text: "/plan",
        ...(marked ? { rejectedTurn } : {}),
      });
      applyComposerCommandSelection(selection);
      expect(drafts.getComposerDraftSnapshot(key).text).toBe(marked ? "/plan" : "");
      expect(drafts.getComposerDraftSnapshot(key).interactionMode).toBe(
        marked ? undefined : "plan",
      );
      expect(selections).toHaveLength(marked ? 0 : 1);
      if (marked) expect(drafts.getComposerDraftSnapshot(key).context).toEqual(source.context);
      await drafts.flushComposerDrafts();
      expect(
        drafts.decodePersistedComposerState(JSON.parse(harness.draftFile.document)).drafts[key]
          ?.rejectedTurn,
      ).toEqual(marked ? rejectedTurn : undefined);
    },
  );

  it.each(["text", "context", "history", "selection", "insertion", "remove", "replace"] as const)(
    "preserves source context and files through %s edits and reload",
    async (edit) => {
      const snapshot = recovered();
      await drafts.restoreComposerDraftSnapshot(key, snapshot);
      const history = drafts.createComposerDraftContextHistory();
      try {
        switch (edit) {
          case "text":
            drafts.setComposerDraftText(key, "edited prompt");
            break;
          case "context":
            drafts.setComposerDraftContext(key, undefined);
            break;
          case "history": {
            const restored = history.restore("edited prompt", drafts.getComposerDraftSnapshot(key));
            drafts.setComposerDraftText(key, "edited prompt");
            drafts.setComposerDraftContext(key, restored.context);
            drafts.appendComposerDraftAttachments(key, restored.attachments, {
              allowOverflow: true,
            });
            break;
          }
          case "selection": {
            const selected = drafts.getComposerDraftAfterSelection(key, {
              text: snapshot.text,
              start: 0,
              end: snapshot.text.length,
            });
            expect(selected.context).toEqual(snapshot.context);
            expect(selected.attachments).toEqual(snapshot.attachments);
            break;
          }
          case "insertion": {
            const record = {
              version: 1 as const,
              kind: "skill" as const,
              contextId: ComposerContextId.make("extra"),
              label: "Extra",
              name: "extra",
            };
            drafts.insertComposerDraftContext(
              key,
              {
                text: formatComposerContextReference(record),
                context: { version: 1, records: [record] },
              },
              { text: snapshot.text, start: 0, end: snapshot.text.length },
            );
            break;
          }
          case "remove":
            drafts.removeComposerDraftAttachment(key, "source-file");
            break;
          case "replace":
            drafts.replaceComposerDraftAttachments(key, []);
            break;
        }
        const current = drafts.getComposerDraftSnapshot(key);
        expect(current.context?.records.slice(0, 2)).toEqual(snapshot.context?.records);
        expect(current.attachments).toEqual(snapshot.attachments);
        expect(current.rejectedTurn).toEqual(snapshot.rejectedTurn);
        await drafts.flushComposerDrafts();
        expect(
          drafts.decodePersistedComposerState(JSON.parse(harness.draftFile.document)).drafts[key],
        ).toEqual(current);
      } finally {
        history.dispose();
        await drafts.releaseUnusedComposerAttachmentFiles(snapshot.attachments);
      }
    },
  );

  it("does not truncate already-retained files when merging into an oversized marked draft", () => {
    const snapshot = recovered();
    const attachments = Array.from(
      { length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS + 1 },
      (_, index) => ({
        id: `retained-${index}`,
        type: "file" as const,
        name: "retained.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: `file:///retained-${index}`,
      }),
    );
    const current = { [key]: { ...snapshot, attachments } };

    const merged = drafts.mergeComposerDraftContentState(current, key, {
      text: "additional",
      attachments: [],
    });

    expect(merged[key]?.attachments).toEqual(attachments);
    expect(merged[key]?.context).toEqual(snapshot.context);
  });
});
