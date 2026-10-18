import { fixture, harness } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
vi.mock("./assets", () => ({ assetEnvironment: { createUrl: (query: unknown) => query } }));
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  ThreadId,
  makeWorkspaceTurnStartRefusalIdentity,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
} from "@t3tools/contracts";
import { appAtomRegistry } from "./atom-registry";
import * as drafts from "./use-composer-drafts";
import {
  canFocusRejectedComposerSend,
  checkRejectedComposerOperation,
  createRejectedComposerGeneration,
  discardRejectedComposer,
  recoverRejectedComposer,
  rejectedComposerOperationsAtom,
  sendRejectedComposer,
  type RejectedComposerOwner,
} from "./rejected-composer-operations";
import { encodeThreadOutboxRecord } from "./thread-outbox-record";
import { threadOutboxIdentity } from "./thread-outbox-model";
import { optimisticThreadOutboxOwnersAtom } from "./thread-outbox-ownership";

let sequence = 0;
const scope = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const key = "environment:thread";
const attachment = {
  id: "original-file",
  type: "file" as const,
  name: "notes.txt",
  mimeType: "text/plain",
  sizeBytes: 3,
  fileUri: "file:///documents/t3-composer-attachments/notes.txt",
};
function snapshot(text = "  /feedback bad\n"): drafts.ComposerDraft {
  const context = {
    version: 1 as const,
    records: [
      {
        version: 1 as const,
        kind: "skill" as const,
        contextId: ComposerContextId.make("unreferenced-source"),
        name: "source",
        label: "Source skill",
      },
    ],
  };
  return {
    text,
    context,
    attachments: [attachment],
    rejectedTurn: {
      version: 1,
      ...scope,
      message: {
        id: MessageId.make("original"),
        role: "user",
        text,
        context,
        attachments: [
          {
            id: attachment.id,
            type: attachment.type,
            name: attachment.name,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
          },
        ],
        turnId: null,
        streaming: false,
        createdAt: "2026-10-04T00:00:00.000Z",
        updatedAt: "2026-10-04T00:00:00.000Z",
      },
      refusal: {
        version: 1,
        source: "workspace-ownership",
        requestId: MessageId.make("original"),
        reason: "target-changed",
        originCommandId: CommandId.make("original-command"),
        originSequence: 1,
      },
    },
  };
}
function ownerFor(draft: drafts.ComposerDraft) {
  const source = draft.rejectedTurn;
  if (source === undefined) throw new Error("Expected marked fixture");
  const generation = createRejectedComposerGeneration();
  const ownerKey = JSON.stringify([scope.environmentId, scope.threadId, ++sequence]);
  const capture = (): RejectedComposerOwner => ({
    ...generation.capture(),
    scope,
    key: ownerKey,
    readSource: () => ({
      scope,
      synchronized: true,
      messages: [source.message],
      activities: [
        {
          id: makeWorkspaceTurnStartRefusalIdentity(scope.threadId, source.message.id).activityId,
          kind: "provider.turn.start.failed",
          tone: "error",
          summary: "not authority",
          turnId: null,
          sequence: 2,
          createdAt: source.message.createdAt,
          payload: source.refusal,
        },
      ],
    }),
  });
  return {
    generation,
    capture,
    state: () => appAtomRegistry.get(rejectedComposerOperationsAtom)[ownerKey],
  };
}

beforeEach(async () => {
  vi.useFakeTimers();
  fixture().reset();
  harness.uuid.mockClear();
  harness.draftFile.error = null;
  harness.draftFile.afterMove = null;
  harness.draftFile.onExists = null;
  harness.draftFile.document = JSON.stringify({ schemaVersion: 1, drafts: {} });
  appAtomRegistry.set(drafts.composerDraftsAtom, {});
  appAtomRegistry.set(drafts.composerCloudDraftsAtom, { accountId: null, signedOut: {} });
  drafts.resetComposerDraftsLoadState();
  await drafts.waitForComposerDraftsLoaded();
});
afterEach(async () => {
  harness.draftFile.error = null;
  harness.draftFile.afterMove = null;
  harness.draftFile.onExists = null;
  await drafts.flushComposerDrafts();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("explicit recovered composer operations with real stores", () => {
  it("prevents a retired screen callback from capturing fresh authority", () => {
    const generation = createRejectedComposerGeneration();
    const before = generation.capture();
    generation.deactivate();
    expect(before.isCurrent()).toBe(false);
    expect(generation.capture().isCurrent()).toBe(false);
    generation.activate();
    expect(before.isCurrent()).toBe(false);
    expect(generation.capture().isCurrent()).toBe(true);
  });

  it.each(["text", "attachments"] as const)(
    "blocks complete recovered %s overflow before admission",
    async (limit) => {
      const draft = snapshot();
      await drafts.restoreComposerDraftSnapshot(key, draft);
      if (limit === "text") {
        drafts.setComposerDraftText(key, "x".repeat(PROVIDER_SEND_TURN_MAX_INPUT_CHARS + 1));
      } else {
        drafts.appendComposerDraftAttachments(
          key,
          Array.from({ length: PROVIDER_SEND_TURN_MAX_ATTACHMENTS }, (_, index) => ({
            ...attachment,
            id: `added-${index}`,
            fileUri: `file:///added-${index}.txt`,
          })),
          { allowOverflow: true },
        );
      }
      const owner = ownerFor(draft);
      const expected = drafts.getComposerDraftSnapshot(key);
      expect(await sendRejectedComposer({ owner: owner.capture(), settings: {} })).toBeNull();
      expect(drafts.getComposerDraftSnapshot(key)).toEqual(expected);
      expect(fixture().writes).toEqual([]);
      expect(harness.uuid).not.toHaveBeenCalled();
    },
  );

  it.each(["  /feedback bad\n", "  /usage-limits  ", "\n/compact\n"])(
    "admits exact command-looking text %j once and durably ends the unchanged marker",
    async (text) => {
      const draft = snapshot(text);
      await drafts.restoreComposerDraftSnapshot(key, draft);
      const owner = ownerFor(draft);
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      fixture().gates.push(async () => {
        entered.resolve();
        await release.promise;
      });
      const sending = sendRejectedComposer({ owner: owner.capture(), settings: {} });
      await entered.promise;
      expect(drafts.getComposerDraftSnapshot(key)).toEqual(draft);
      expect(await sendRejectedComposer({ owner: owner.capture(), settings: {} })).toBeNull();
      release.resolve();
      const id = await sending;
      expect(id).not.toBeNull();
      expect(fixture().writes).toHaveLength(1);
      expect(harness.uuid).toHaveBeenCalledTimes(2);
      const record = fixture().writes[0];
      if (record?.kind !== "message") throw new Error("Expected admitted record");
      expect(record.message.text).toBe(text);
      expect(record.message.context).toEqual(draft.context);
      expect(record.message.messageId).not.toBe(draft.rejectedTurn?.message.id);
      expect(record.message.commandId).not.toBe(draft.rejectedTurn?.refusal.originCommandId);
      expect(draft.rejectedTurn?.message.text).toBe(text);
      expect(drafts.getComposerDraftSnapshot(key).rejectedTurn).toBeUndefined();
      expect(JSON.parse(harness.draftFile.document).drafts[key]?.rejectedTurn).toBeUndefined();
      if (id === null) throw new Error("Expected submission id");
      expect(canFocusRejectedComposerSend(owner.capture().key, id)).toBe(true);
      drafts.setComposerDraftText(key, "ordinary next message");
      expect(drafts.getComposerDraftSnapshot(key).rejectedTurn).toBeUndefined();
      expect(canFocusRejectedComposerSend(owner.capture().key, id)).toBe(false);
    },
  );

  it("preserves typing, settings and added files during admission without stale focus", async () => {
    const draft = snapshot();
    await drafts.restoreComposerDraftSnapshot(key, draft);
    const owner = ownerFor(draft);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    fixture().gates.push(async () => {
      entered.resolve();
      await release.promise;
    });
    const sending = sendRejectedComposer({ owner: owner.capture(), settings: {} });
    await entered.promise;
    drafts.setComposerDraftText(key, "newer text");
    drafts.updateComposerDraftSettings(key, { runtimeMode: "approval-required" });
    drafts.appendComposerDraftAttachments(key, [
      { ...attachment, id: "added", fileUri: "file:///added.txt" },
    ]);
    const newer = drafts.getComposerDraftSnapshot(key);
    release.resolve();
    const id = await sending;
    expect(drafts.getComposerDraftSnapshot(key)).toEqual(newer);
    expect(owner.state()?.status).toBe("queued-changed");
    if (id === null) throw new Error("Expected submission id");
    expect(canFocusRejectedComposerSend(owner.capture().key, id)).toBe(false);
    await drafts.flushComposerDrafts();
    expect(JSON.parse(harness.draftFile.document).drafts[key].text).toBe("newer text");
  });

  it.each(["draft", "route", "account", "connection", "settings"] as const)(
    "fences %s ABA at the native preparation boundary without allocating admission",
    async (change) => {
      const draft = snapshot();
      await drafts.restoreComposerDraftSnapshot(key, draft);
      const owner = ownerFor(draft);
      harness.draftFile.onExists = () => {
        harness.draftFile.onExists = null;
        if (change === "draft") {
          drafts.setComposerDraftText(key, "intermediate");
          drafts.setComposerDraftText(key, draft.text);
        } else if (change === "settings") {
          drafts.updateComposerDraftSettings(key, { runtimeMode: "approval-required" });
          drafts.updateComposerDraftSettings(key, { runtimeMode: undefined });
        } else {
          owner.generation.invalidate();
          owner.generation.invalidate();
        }
      };
      expect(await sendRejectedComposer({ owner: owner.capture(), settings: {} })).toBeNull();
      expect(fixture().writes).toEqual([]);
      expect(harness.uuid).not.toHaveBeenCalled();
      expect(drafts.getComposerDraftSnapshot(key).rejectedTurn).toEqual(draft.rejectedTurn);
      expect(owner.state()?.status).toBe("changed");
    },
  );

  it("settles a real failed admission only after explicit durable ownership handback", async () => {
    const draft = snapshot();
    await drafts.restoreComposerDraftSnapshot(key, draft);
    const owner = ownerFor(draft);
    fixture().gates.push(async () => {
      throw new Error("before commit");
    });
    expect(await sendRejectedComposer({ owner: owner.capture(), settings: {} })).toBeNull();
    expect(owner.state()?.status).toBe("admission-uncertain");
    expect(fixture().manager.optimisticMessages()).toHaveLength(1);
    drafts.setComposerDraftText(key, "newer typing");
    await checkRejectedComposerOperation(owner.capture());
    expect(owner.state()?.status).toBe("failed");
    expect(fixture().manager.optimisticMessages()).toEqual([]);
    expect(drafts.getComposerDraftSnapshot(key).text).toBe("newer typing");
    expect(drafts.getComposerDraftSnapshot(key).context).toEqual(draft.context);
    expect(fixture().writes).toEqual([]);
  });

  it("retains a failed owner's missing bytes and another admission's exact handle", async () => {
    const draft = snapshot();
    await drafts.restoreComposerDraftSnapshot(key, draft);
    const owner = ownerFor(draft);
    fixture().gates.push(async () => {
      throw new Error("before commit");
    });
    await sendRejectedComposer({ owner: owner.capture(), settings: {} });
    fixture().gates.push(async () => {
      throw new Error("other failure");
    });
    const other = fixture().manager.enqueueNew(
      {
        ...scope,
        messageId: MessageId.make("other"),
        commandId: CommandId.make("other"),
        text: "other",
        attachments: [],
        createdAt: "2026-10-04T00:00:00.000Z",
      },
      null,
    );
    await expect(other.committed).rejects.toMatchObject({ reason: "write-failed" });
    drafts.clearComposerDraftContent(key, { deferAttachmentCleanup: true });
    await checkRejectedComposerOperation(owner.capture());
    expect(owner.state()?.status).toBe("failed-retained");
    expect(fixture().manager.optimisticMessages()).toHaveLength(2);
    expect(appAtomRegistry.get(optimisticThreadOutboxOwnersAtom)).toHaveLength(2);
    expect(drafts.getComposerDraftSnapshot(key).text).toBe("");
    expect(fixture().writes).toEqual([]);
  });

  it("reconciles commit-before-error through the same record without replacement intent", async () => {
    const draft = snapshot();
    await drafts.restoreComposerDraftSnapshot(key, draft);
    const owner = ownerFor(draft);
    fixture().gates.push(async (record) => {
      fixture().files.set(
        threadOutboxIdentity(record.storageIdentity),
        JSON.stringify(encodeThreadOutboxRecord(record)),
      );
      throw new Error("committed before error");
    });
    await sendRejectedComposer({ owner: owner.capture(), settings: {} });
    const before = new Map(fixture().files);
    expect(owner.state()?.status).toBe("admission-uncertain");
    await checkRejectedComposerOperation(owner.capture());
    expect(owner.state()?.status).toBe("queued");
    expect(fixture().files).toEqual(before);
    expect(fixture().manager.optimisticMessages()).toEqual([]);
    expect(drafts.getComposerDraftSnapshot(key).rejectedTurn).toBeUndefined();
    expect(fixture().writes).toEqual([]);
  });

  it("retains queued cleanup uncertainty through unmount and explicit route-return checks", async () => {
    const draft = snapshot();
    await drafts.restoreComposerDraftSnapshot(key, draft);
    const owner = ownerFor(draft);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    fixture().gates.push(async () => {
      entered.resolve();
      await release.promise;
    });
    const sending = sendRejectedComposer({ owner: owner.capture(), settings: {} });
    await entered.promise;
    owner.generation.invalidate();
    release.resolve();
    await sending;
    expect(owner.state()?.status).toBe("cleanup-uncertain");
    expect(drafts.getComposerDraftSnapshot(key)).toEqual(draft);
    expect(await sendRejectedComposer({ owner: owner.capture(), settings: {} })).toBeNull();
    await checkRejectedComposerOperation(owner.capture());
    expect(owner.state()?.status).toBe("queued");
    expect(fixture().writes).toHaveLength(1);
  });

  it("keeps a rename-committed cleanup exception queued and checks without resend", async () => {
    const draft = snapshot();
    await drafts.restoreComposerDraftSnapshot(key, draft);
    const owner = ownerFor(draft);
    harness.draftFile.afterMove = () => {
      harness.draftFile.afterMove = null;
      throw new Error("completion unknown after rename");
    };
    expect(await sendRejectedComposer({ owner: owner.capture(), settings: {} })).not.toBeNull();
    expect(owner.state()?.status).toBe("cleanup-uncertain");
    expect(drafts.getComposerDraftSnapshot(key).rejectedTurn).toEqual(draft.rejectedTurn);
    expect(JSON.parse(harness.draftFile.document).drafts[key]?.rejectedTurn).toBeUndefined();
    await checkRejectedComposerOperation(owner.capture());
    expect(owner.state()?.status).toBe("queued");
    expect(fixture().writes).toHaveLength(1);
  });

  it("opens the same edited recovery without a write and protects it from another source", async () => {
    const draft = snapshot();
    await drafts.restoreComposerDraftSnapshot(key, draft);
    drafts.setComposerDraftText(key, "current edits");
    await drafts.flushComposerDrafts();
    const before = harness.draftFile.document;
    const owner = ownerFor(draft);
    expect(await recoverRejectedComposer(owner.capture(), MessageId.make("original"))).toBe(true);
    const other = snapshot("other");
    const another = ownerFor(other);
    expect(await recoverRejectedComposer(another.capture(), MessageId.make("original"))).toBe(
      false,
    );
    expect(drafts.getComposerDraftSnapshot(key).text).toBe("current edits");
    expect(harness.draftFile.document).toBe(before);
    expect(fixture().writes).toEqual([]);
  });

  it("durably discards a marker rather than applying ordinary edit-clear", async () => {
    const draft = snapshot();
    await drafts.restoreComposerDraftSnapshot(key, draft);
    const owner = ownerFor(draft);
    drafts.clearComposerDraftContent(key, { deferAttachmentCleanup: true });
    expect(drafts.getComposerDraftSnapshot(key).rejectedTurn).toBeDefined();
    await discardRejectedComposer(owner.capture());
    expect(drafts.getComposerDraftSnapshot(key).rejectedTurn).toBeUndefined();
    expect(JSON.parse(harness.draftFile.document).drafts[key]?.rejectedTurn).toBeUndefined();
    expect(fixture().writes).toEqual([]);
  });
});
