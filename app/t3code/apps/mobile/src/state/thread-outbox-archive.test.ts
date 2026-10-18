import { fixture, harness } from "./testing/drain-harness";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { CommandId, EnvironmentId, MessageId, ProjectId, ThreadId } from "@t3tools/contracts";
import { appAtomRegistry } from "./atom-registry";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import * as drafts from "./use-composer-drafts";

function message(): QueuedThreadMessage {
  return {
    environmentId: EnvironmentId.make("environment"),
    threadId: ThreadId.make("thread"),
    messageId: MessageId.make("message"),
    commandId: CommandId.make("command"),
    text: "archived intent",
    attachments: [],
    createdAt: "2026-10-04T00:00:00.000Z",
    creation: {
      projectId: ProjectId.make("project"),
      workspaceMode: "local",
      branch: null,
      worktreePath: null,
    },
    delivery: { state: "ready" },
  };
}
beforeEach(async () => {
  fixture().reset();
  drafts.resetComposerDraftsLoadState();
  await drafts.waitForComposerDraftsLoaded();
});
afterEach(async () => {
  await drafts.flushComposerDrafts();
  appAtomRegistry.set(drafts.composerDraftsAtom, {});
  appAtomRegistry.set(drafts.composerCloudDraftsAtom, { accountId: null, signedOut: {} });
  harness.draftFile.document = JSON.stringify({ schemaVersion: 1, drafts: {} });
});
describe("production archive reconciliation", () => {
  it("restores parked records without a bucket while preserving historical ownership", async () => {
    const row = message();
    const { delivery: _delivery, ...content } = row;
    const record = await fixture().manager.enqueueNew(content, "account").committed;
    await fixture().manager.authority.parkAccount("account", new Set([row.environmentId]));
    await fixture().restart();
    await drafts.restoreCloudComposerDrafts("account");
    const restored = fixture().manager.recordAt(record.storageIdentity);
    expect(restored).toMatchObject({ ownerAccountId: "account", delivery: { state: "ready" } });
    expect(restored).not.toHaveProperty("archivedFor");
    expect(appAtomRegistry.get(fixture().manager.queuedMessagesByThreadKeyAtom)).toEqual({});
  });
  it("imports an orphaned ready archive as unknown without fresh admission or account activation", async () => {
    const row = message();
    appAtomRegistry.set(drafts.composerCloudDraftsAtom, {
      accountId: null,
      signedOut: { account: { drafts: {}, queuedMessages: [row] } },
    });
    await drafts.restoreCloudComposerDrafts("account");
    const records = fixture().manager.authority.knownRecords();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      ownerAccountId: "account",
      delivery: { state: "unknown" },
      original: { kind: "legacy-observed", localSnapshot: { text: row.text } },
    });
    expect(appAtomRegistry.get(fixture().manager.queuedMessagesByThreadKeyAtom)).toEqual({});
    expect(harness.prepare).not.toHaveBeenCalled();
  });
  it("leaves same-environment ambiguous legacy editor drafts unchanged during archival", async () => {
    fixture().manager.setAccountId("account");
    const row = await fixture().admit(message(), "account");
    await fixture().admit(
      { ...message(), threadId: ThreadId.make("other"), commandId: CommandId.make("other") },
      "account",
    );
    const legacy = { text: "unattributed edit", attachments: [] };
    await drafts.restoreComposerDraftSnapshot("pending-task:message", legacy);
    await drafts.archiveCloudComposerDrafts("account", new Set([row.environmentId]));
    expect(drafts.getComposerDraftSnapshot("pending-task:message")).toEqual(legacy);
    expect(
      appAtomRegistry.get(drafts.composerCloudDraftsAtom).signedOut["account"]?.drafts,
    ).toEqual({});
  });
});
