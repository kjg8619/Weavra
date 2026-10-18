import { fixture, harness } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { appAtomRegistry } from "./atom-registry";
import {
  beginPendingTaskEditorSession,
  initializePendingTaskEditorDraft,
} from "./pending-task-editor-session";
import { findQueuedPendingTask, pendingTaskDraftKey } from "./pending-task-identity";
import { canPrepareQueuedMessage } from "./thread-outbox-preparation";
import { restoreOutboxAdmission } from "./thread-outbox-handback";
import { threadOutboxIdentity, type QueuedThreadMessage } from "./thread-outbox-model";
import { encodeThreadOutboxRecord } from "./thread-outbox-record";
import {
  capturePendingTaskEditorWriteBaseline,
  flushPendingTaskEditorWrite,
} from "./pending-task-editor-writes";
import * as drafts from "./use-composer-drafts";

const releases: Array<() => void> = [];
function message(): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("message"),
    commandId: CommandId.make("command"),
    text: "original",
    attachments: [
      {
        id: "file",
        type: "file",
        name: "source.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: "file:///documents/source.txt",
      },
    ],
    creation: {
      projectId: ProjectId.make("project"),
      workspaceMode: "local",
      branch: null,
      worktreePath: null,
    },
    createdAt: "2026-10-04T00:00:00.000Z",
  };
}
function open(row: QueuedThreadMessage) {
  const session = beginPendingTaskEditorSession(row);
  if (session === null) throw new Error("Expected editor lease");
  releases.push(session.release);
  return session;
}
beforeEach(async () => {
  fixture().reset();
  drafts.resetComposerDraftsLoadState();
  await drafts.waitForComposerDraftsLoaded();
});
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  harness.draftFile.error = null;
  await drafts.flushComposerDrafts();
  appAtomRegistry.set(drafts.composerDraftsAtom, {});
  harness.draftFile.document = JSON.stringify({ schemaVersion: 1, drafts: {} });
});
describe("scoped pending editor ownership", () => {
  it("separates same IDs across environments and threads in routes, drafts and leases", async () => {
    const first = await fixture().admit(message());
    const second = await fixture().admit({
      ...message(),
      environmentId: EnvironmentId.make("other"),
    });
    const third = await fixture().admit({
      ...message(),
      threadId: ThreadId.make("other"),
      commandId: CommandId.make("other"),
    });
    const rows = [first, second, third];
    expect(findQueuedPendingTask("message", rows)).toBeNull();
    expect(new Set(rows.map(pendingTaskDraftKey)).size).toBe(3);
    const one = open(first);
    const two = open(second);
    const three = open(third);
    one.release();
    expect(canPrepareQueuedMessage(fixture().record(first))).toBe(true);
    expect(canPrepareQueuedMessage(fixture().record(second))).toBe(false);
    expect(canPrepareQueuedMessage(fixture().record(third))).toBe(false);
    two.release();
    three.release();
  });
  it("keeps a reopened session held when its predecessor finishes", async () => {
    const row = await fixture().admit(message());
    const predecessor = open(row);
    predecessor.detach();
    const reopened = open(row);
    expect(predecessor.isAlone()).toBe(false);
    predecessor.release();
    expect(canPrepareQueuedMessage(fixture().record(row))).toBe(false);
    reopened.release();
    expect(canPrepareQueuedMessage(fixture().record(row))).toBe(true);
  });
  it("preserves ambiguous legacy drafts even when all candidates share an environment", async () => {
    const first = await fixture().admit(message());
    await fixture().admit({
      ...message(),
      threadId: ThreadId.make("other"),
      commandId: CommandId.make("other"),
    });
    const legacy = { text: "unattributed", attachments: message().attachments };
    await drafts.restoreComposerDraftSnapshot("pending-task:message", legacy);
    open(first);
    await initializePendingTaskEditorDraft(first);
    expect(drafts.getComposerDraftSnapshot("pending-task:message")).toEqual(legacy);
    expect(drafts.getComposerDraftSnapshot(pendingTaskDraftKey(first)).text).toBe(first.text);
    expect(harness.prepare).not.toHaveBeenCalled();
  });
  it("keeps a unique legacy slot until its scoped destination is durably written", async () => {
    const row = await fixture().admit(message());
    const legacy = { text: "legacy edit", attachments: row.attachments };
    await drafts.restoreComposerDraftSnapshot("pending-task:message", legacy);
    open(row);
    harness.draftFile.error = new Error("write failed");
    await expect(initializePendingTaskEditorDraft(row)).rejects.toThrow();
    expect(drafts.getComposerDraftSnapshot("pending-task:message")).toEqual(legacy);
    expect(fixture().record(row).delivery.state).toBe("ready");
  });
  it("does not initialize a draft after the editor generation changes", async () => {
    const row = await fixture().admit(message());
    open(row);
    const initializing = initializePendingTaskEditorDraft(row, () => false);
    await initializing;
    expect(drafts.getComposerDraftSnapshot(pendingTaskDraftKey(row)).text).toBe("");
  });
  it("retains the newest draft and rejects successors after a committed-but-reported failure", async () => {
    const row = await fixture().admit(message());
    const key = pendingTaskDraftKey(row);
    open(row);
    drafts.setComposerDraftText(key, "saved but uncertain");
    fixture().gates.push(async (record) => {
      fixture().files.set(
        threadOutboxIdentity(record.storageIdentity),
        JSON.stringify(encodeThreadOutboxRecord(record)),
      );
      throw new Error("commit acknowledgment lost");
    });
    const first = flushPendingTaskEditorWrite({
      message: { ...row, text: "saved but uncertain" },
      baseline: capturePendingTaskEditorWriteBaseline(row),
      draftKey: key,
    });
    const successor = capturePendingTaskEditorWriteBaseline(row);
    drafts.setComposerDraftText(key, "newest unsaved");
    const next = flushPendingTaskEditorWrite({
      message: { ...row, text: "newest unsaved" },
      baseline: successor,
      draftKey: key,
    });
    await expect(first).rejects.toMatchObject({ reason: "write-failed" });
    await expect(next).rejects.toMatchObject({ reason: "write-failed" });
    expect(drafts.getComposerDraftSnapshot(key).text).toBe("newest unsaved");
    expect(canPrepareQueuedMessage(fixture().record(row))).toBe(false);
  });
  it("keeps a rejected admission owner until exact durable handback without duplicate attachments", async () => {
    const original = message();
    await fixture().admit({ ...original, attachments: [] });
    const operation = fixture().manager.enqueueNew(original, null);
    await expect(operation.committed).rejects.toMatchObject({ reason: "identity-occupied" });
    await drafts.restoreComposerDraftSnapshot("environment:thread", {
      text: "new typing",
      attachments: original.attachments,
    });
    harness.draftFile.error = new Error("handback failed");
    await expect(
      restoreOutboxAdmission({
        message: original,
        draftKey: "environment:thread",
        releaseAfterHandback: operation.releaseAfterHandback,
      }),
    ).rejects.toThrow();
    expect(fixture().manager.optimisticMessages()).toHaveLength(1);
    harness.draftFile.error = null;
    await restoreOutboxAdmission({
      message: original,
      draftKey: "environment:thread",
      releaseAfterHandback: operation.releaseAfterHandback,
    });
    expect(fixture().manager.optimisticMessages()).toEqual([]);
    expect(drafts.getComposerDraftSnapshot("environment:thread")).toMatchObject({
      text: "new typing\n\noriginal",
      attachments: original.attachments,
    });
  });
});
