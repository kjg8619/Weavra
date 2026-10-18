import { afterEach, describe, expect, it } from "@effect/vitest";
import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  makeWorkspaceTurnStartRefusalIdentity,
} from "@t3tools/contracts";
import { onTestFinished, vi } from "vite-plus/test";

const outboxHarness: {
  fixture: ReturnType<typeof import("./testing/outbox").createOutboxTestFixture> | undefined;
} = vi.hoisted(() => ({ fixture: undefined }));
vi.mock("./thread-outbox", async () => {
  const { createOutboxTestFixture } = await import("./testing/outbox");
  const { appAtomRegistry } = await import("./atom-registry");
  outboxHarness.fixture = createOutboxTestFixture(appAtomRegistry);
  return {
    get threadOutboxManager() {
      return outboxFixture().manager;
    },
    flushThreadOutbox: () => outboxFixture().manager.flush(),
  };
});
function outboxFixture() {
  if (outboxHarness.fixture === undefined) throw new Error("Outbox fixture not initialized");
  return outboxHarness.fixture;
}

const composerDraftFileMocks = vi.hoisted(() => {
  let document = JSON.stringify({ schemaVersion: 1, drafts: {} });
  let readError: Error | null = null;
  let writeError: Error | null = null;
  let releaseRead: (() => void) | null = null;
  let readBarrier = Promise.resolve();
  let nextWriteBarrier: Promise<void> | null = null;
  let onWrite: (() => void) | null = null;
  let onOpen: (() => void) | null = null;
  let onStage: (() => void) | null = null;
  const writes: string[] = [];
  const readImage = vi.fn(async () => "YWJj");

  return {
    readImage,
    blockRead() {
      readBarrier = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
    },
    releaseRead() {
      releaseRead?.();
      releaseRead = null;
    },
    getDocument() {
      return document;
    },
    setDocument(value: unknown) {
      document = JSON.stringify(value);
    },
    setReadError(error: Error | null) {
      readError = error;
    },
    setWriteError(error: Error | null) {
      writeError = error;
    },
    setNextWriteBarrier(barrier: Promise<void> | null) {
      nextWriteBarrier = barrier;
    },
    setOnWrite(callback: (() => void) | null) {
      onWrite = callback;
    },
    setOnOpen(callback: (() => void) | null) {
      onOpen = callback;
    },
    setOnStage(callback: (() => void) | null) {
      onStage = callback;
    },
    async prepare() {
      const barrier = nextWriteBarrier;
      nextWriteBarrier = null;
      if (barrier) await barrier;
    },
    getWrites(): ReadonlyArray<string> {
      return writes;
    },
    resetWrites() {
      writes.length = 0;
    },
    Directory: class {
      create() {}

      list() {
        return [];
      }
    },
    File: class {
      exists = true;
      parentDirectory = null;
      staged: string | null = null;

      constructor() {
        onOpen?.();
      }

      create() {}

      moveSync() {
        if (this.staged === null) throw new Error("No staged document");
        document = this.staged;
        writes.push(document);
        this.staged = null;
        onWrite?.();
      }

      delete() {
        this.staged = null;
      }

      async text() {
        await readBarrier;
        if (readError) throw readError;
        return document;
      }

      async base64() {
        return readImage();
      }

      write(value: string) {
        if (writeError) {
          throw writeError;
        }
        this.staged = value;
        onStage?.();
      }
    },
  };
});

const composerAttachmentCleanupMocks = vi.hoisted(() => ({
  remove: vi.fn(async () => undefined),
  releaseUploads: vi.fn(async () => undefined),
}));

const incomingShareStorageMocks = vi.hoisted(() => ({
  load: vi.fn<typeof import("../features/sharing/incoming-share-storage").loadIncomingShareDrafts>(
    async () => [],
  ),
}));

vi.mock("expo-file-system", () => ({
  Directory: composerDraftFileMocks.Directory,
  File: composerDraftFileMocks.File,
  Paths: { document: { uri: "file:///documents" } },
}));

vi.mock("../lib/atomic-file", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/atomic-file")>();
  return {
    ...actual,
    prepareAtomicFileWriter: async (...args: Parameters<typeof actual.prepareAtomicFileWriter>) => {
      const write = await actual.prepareAtomicFileWriter(...args);
      await composerDraftFileMocks.prepare();
      return write;
    },
  };
});

vi.mock("../lib/composerImages", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/composerImages")>()),
  removePersistedComposerAttachmentFile: composerAttachmentCleanupMocks.remove,
}));

vi.mock("../lib/uuid", () => ({ uuidv4: () => "uuid", randomHex: () => "0000" }));
vi.mock("./assets", () => ({ assetEnvironment: {} }));
vi.mock("./attachments", () => ({ attachmentEnvironment: {} }));
vi.mock("./session", () => ({ environmentSession: {} }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  createEnvironmentRpcCommand: () => Symbol("rpc-command"),
  executeAtomQuery: () => {
    throw new Error("Unexpected network query in the inline read test");
  },
  runAtomCommand: () => {
    throw new Error("Unexpected network command in the inline read test");
  },
  squashAtomCommandFailure: (result: { readonly error: unknown }) => result.error,
}));

vi.mock("../lib/attachmentUpload", () => ({
  releasePendingAttachmentUploads: composerAttachmentCleanupMocks.releaseUploads,
}));

vi.mock("../features/sharing/incoming-share-storage", () => ({
  loadIncomingShareDrafts: incomingShareStorageMocks.load,
}));

import type { DraftComposerAttachment } from "../lib/composerImages";
import { recoverRejectedComposerDraft } from "../lib/recoverRejectedComposerDraft";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { appAtomRegistry } from "./atom-registry";
import { threadOutboxManager } from "./thread-outbox";
import { optimisticThreadOutboxOwnersAtom } from "./thread-outbox-ownership";
import * as outboxStorage from "./thread-outbox-storage";
import { decodeThreadOutboxRecord, encodeThreadOutboxRecord } from "./thread-outbox-record";
import {
  groupQueuedThreadMessages,
  threadOutboxIdentity,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import {
  appendComposerDraftAttachments,
  captureComposerDraftInsertion,
  captureComposerRecoveryTarget,
  commitRejectedComposerDraft,
  completeRejectedComposerSend,
  releaseRejectedComposerAdmission,
  persistedComposerAttachmentOwnership,
  ComposerDraftRecoveryError,
  isComposerRecoveryTargetCurrent,
  setComposerContextImporting,
  updateComposerDraftSettings,
  countComposerDraftAttachmentsAfterSelection,
  getComposerDraftAfterSelection,
  archiveCloudComposerDrafts,
  clearComposerDraftContent,
  clearComposerDraft,
  clearComposerDraftContentState,
  clearComposerDraftsEnvironment,
  ComposerDraftPersistenceError,
  composerDraftsAtom,
  composerCloudDraftsAtom,
  createNewTaskDraft,
  createComposerDraftContextHistory,
  setComposerDraftContext,
  decodePersistedComposerState,
  ensureComposerDraftsLoaded,
  type ComposerDraft,
  type RejectedComposerDraftSource,
  findNewTaskDraftKeys,
  findLocalComposerClipboardAttachment,
  flushComposerDrafts,
  getComposerDraftSnapshot,
  mergeComposerDraftContentState,
  migrateLegacyNewTaskDraft,
  releaseUnusedComposerAttachmentFiles,
  removeComposerDraftsForEnvironment,
  replaceComposerDraftAttachments,
  resetComposerDraftsLoadState,
  retainComposerAttachmentFileForPreview,
  restoreComposerDraftSnapshotState,
  restoreComposerDraftSnapshot,
  sameComposerDraftState,
  isComposerDraftEmpty,
  restoreCloudComposerDrafts,
  removeDeliveredCloudQueuedMessage,
  retargetNewTaskDraft,
  setComposerDraftText,
  insertComposerDraftContext,
  insertComposerDraftText,
  rememberComposerDraftSelection,
  setComposerDraftAttachmentUpload,
  waitForComposerDraftsLoaded,
  setStickyComposerModelSelection,
  stickyComposerModelSelectionAtom,
  undoComposerDraftMerge,
  undoComposerDraftMergeState,
} from "./use-composer-drafts";

const DRAFT: ComposerDraft = {
  text: "hello",
  attachments: [],
};

const REFUSED_SOURCE: RejectedComposerDraftSource = {
  version: 1,
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
  message: {
    id: MessageId.make("source-message"),
    role: "user",
    text: "  /original\n",
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
    originCommandId: CommandId.make("origin-command"),
    originSequence: 1,
  },
};

async function recoveryInput() {
  await waitForComposerDraftsLoaded();
  const target = captureComposerRecoveryTarget(REFUSED_SOURCE);
  if (target === null) throw new Error("Expected empty recovery target");
  return { target, source: REFUSED_SOURCE, attachments: [], isCurrent: () => true };
}

async function completionInput() {
  await restoreComposerDraftSnapshot("environment:thread", {
    ...DRAFT,
    runtimeMode: "full-access",
    rejectedTurn: REFUSED_SOURCE,
  });
  const target = captureComposerRecoveryTarget(REFUSED_SOURCE);
  if (target === null) throw new Error("Expected marked target");
  return { target, expected: getComposerDraftSnapshot(target.draftKey), ownerCurrent: () => true };
}

afterEach(() => {
  outboxFixture().reset();
  vi.useRealTimers();
  resetComposerDraftsLoadState();
  composerDraftFileMocks.setDocument({ schemaVersion: 1, drafts: {} });
  composerDraftFileMocks.setReadError(null);
  composerDraftFileMocks.setWriteError(null);
  composerDraftFileMocks.setNextWriteBarrier(null);
  composerDraftFileMocks.setOnWrite(null);
  composerDraftFileMocks.setOnOpen(null);
  composerDraftFileMocks.setOnStage(null);
  composerDraftFileMocks.resetWrites();
  composerDraftFileMocks.readImage.mockReset();
  composerDraftFileMocks.readImage.mockResolvedValue("YWJj");
  appAtomRegistry.set(composerDraftsAtom, {});
  appAtomRegistry.set(composerCloudDraftsAtom, { accountId: null, signedOut: {} });
  appAtomRegistry.set(stickyComposerModelSelectionAtom, null);
  appAtomRegistry.set(threadOutboxManager.queuedMessagesByThreadKeyAtom, {});
  appAtomRegistry.set(optimisticThreadOutboxOwnersAtom, []);
  composerAttachmentCleanupMocks.remove.mockClear();
  composerAttachmentCleanupMocks.releaseUploads.mockReset();
  composerAttachmentCleanupMocks.releaseUploads.mockResolvedValue(undefined);
  incomingShareStorageMocks.load.mockReset();
  incomingShareStorageMocks.load.mockResolvedValue([]);
});

function contextDraft(start: number, count: number): ComposerDraft {
  const records = Array.from({ length: count }, (_, index) => ({
    version: 1 as const,
    contextId: ComposerContextId.make(`skill-${start + index}`),
    kind: "skill" as const,
    label: "Skill",
    name: "skill",
  }));
  return {
    text: records.map((record) => `[Skill](t3-context://v1/skill/${record.contextId})`).join(" "),
    context: { version: 1, records },
    attachments: [],
  };
}

describe("mobile composer drafts", () => {
  it("hands every file back without releasing another failed admission", async () => {
    vi.useFakeTimers();
    const input = await completionInput();
    const context = {
      version: 1 as const,
      records: [
        {
          version: 1 as const,
          kind: "skill" as const,
          contextId: ComposerContextId.make("canonical"),
          label: "Canonical",
          name: "canonical",
        },
      ],
    };
    const source = { ...REFUSED_SOURCE, message: { ...REFUSED_SOURCE.message, context } };
    const attachments = ["one", "two"].map((id) => ({
      id,
      type: "file" as const,
      name: `${id}.txt`,
      mimeType: "text/plain",
      sizeBytes: 1,
      fileUri: `file:///documents/${id}.txt`,
    }));
    const snapshot = { ...input.expected, context, attachments, rejectedTurn: source };
    await restoreComposerDraftSnapshot(input.target.draftKey, snapshot);
    const fixture = outboxFixture();
    const failed = async (id: string) => {
      fixture.gates.push(async () => {
        throw new Error("outbox write failed");
      });
      const admission = fixture.manager.enqueueNew(
        {
          environmentId: source.environmentId,
          threadId: source.threadId,
          messageId: MessageId.make(id),
          commandId: CommandId.make(`command-${id}`),
          text: snapshot.text,
          context,
          attachments,
          createdAt: source.message.createdAt,
        },
        null,
      );
      await expect(admission.committed).rejects.toMatchObject({
        _tag: "ThreadOutboxAuthorityError",
        reason: "write-failed",
      });
      return admission;
    };
    const first = await failed("first");
    const second = await failed("second");
    setComposerDraftText(input.target.draftKey, "newer text");

    expect(
      await releaseRejectedComposerAdmission({
        draftKey: input.target.draftKey,
        source,
        content: snapshot,
        ownerCurrent: () => true,
        releaseAfterHandback: first.releaseAfterHandback,
      }),
    ).toBe("released");

    expect(
      appAtomRegistry.get(optimisticThreadOutboxOwnersAtom).map((row) => row.messageId),
    ).toEqual(["second"]);
    expect(getComposerDraftSnapshot(input.target.draftKey).attachments).toEqual(attachments);
    expect(getComposerDraftSnapshot(input.target.draftKey).context).toEqual(context);
    expect(getComposerDraftSnapshot(input.target.draftKey).text).toBe("newer text");
    expect(second.releaseAfterHandback()).toBe(true);
  });

  it("releases failed ownership only after the newer marked draft is durably read back", async () => {
    vi.useFakeTimers();
    const input = await completionInput();
    setComposerDraftText(input.target.draftKey, "newer user input");
    const release = vi.fn(() => {
      expect(
        JSON.parse(composerDraftFileMocks.getDocument()).drafts[input.target.draftKey].text,
      ).toBe("newer user input");
      return true;
    });
    expect(
      await releaseRejectedComposerAdmission({
        draftKey: input.target.draftKey,
        source: REFUSED_SOURCE,
        content: input.expected,
        ownerCurrent: () => true,
        releaseAfterHandback: release,
      }),
    ).toBe("released");
    expect(release).toHaveBeenCalledTimes(1);
    expect(getComposerDraftSnapshot(input.target.draftKey).text).toBe("newer user input");
  });

  it.each([
    "missing-file",
    "changed-file",
    "missing-context",
    "read-error",
    "invalid-disk",
    "stale-disk",
    "owner",
  ] as const)(
    "retains failed ownership when %s prevents a complete durable proof",
    async (failure) => {
      const input = await completionInput();
      const attachments = ["one", "two"].map((id) => ({
        id,
        type: "file" as const,
        name: `${id}.txt`,
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: `file:///documents/${id}.txt`,
      }));
      const context = {
        version: 1 as const,
        records: [
          {
            version: 1 as const,
            kind: "skill" as const,
            contextId: ComposerContextId.make("extra"),
            label: "Extra",
            name: "extra",
          },
        ],
      };
      const snapshot = { ...input.expected, attachments, context };
      await restoreComposerDraftSnapshot(input.target.draftKey, snapshot);
      if (failure === "missing-file")
        await restoreComposerDraftSnapshot(input.target.draftKey, {
          ...snapshot,
          attachments: attachments.slice(0, 1),
        });
      if (failure === "changed-file")
        await restoreComposerDraftSnapshot(input.target.draftKey, {
          ...snapshot,
          attachments: attachments.map((entry) => ({
            ...entry,
            fileUri: entry.fileUri + ".changed",
          })),
        });
      if (failure === "missing-context")
        await restoreComposerDraftSnapshot(input.target.draftKey, {
          ...snapshot,
          context: undefined,
        });
      if (failure === "read-error") composerDraftFileMocks.setReadError(new Error("unreadable"));
      if (failure === "invalid-disk") composerDraftFileMocks.setDocument({ schemaVersion: 999 });
      if (failure === "stale-disk")
        composerDraftFileMocks.setDocument({ schemaVersion: 1, drafts: {} });
      const release = vi.fn(() => true);
      expect(
        await releaseRejectedComposerAdmission({
          draftKey: input.target.draftKey,
          source: REFUSED_SOURCE,
          content: snapshot,
          ownerCurrent: () => failure !== "owner",
          releaseAfterHandback: release,
        }),
      ).toBe("retained");
      expect(release).not.toHaveBeenCalled();
    },
  );

  it("retains ownership when a new edit arrives during the read-back", async () => {
    vi.useFakeTimers();
    const input = await completionInput();
    composerDraftFileMocks.setOnOpen(() => {
      composerDraftFileMocks.setOnOpen(null);
      queueMicrotask(() => setComposerDraftText(input.target.draftKey, "late edit"));
    });
    const release = vi.fn(() => true);
    expect(
      await releaseRejectedComposerAdmission({
        draftKey: input.target.draftKey,
        source: REFUSED_SOURCE,
        content: input.expected,
        ownerCurrent: () => true,
        releaseAfterHandback: release,
      }),
    ).toBe("retained");
    expect(release).not.toHaveBeenCalled();
    await flushComposerDrafts();
    expect(getComposerDraftSnapshot(input.target.draftKey).text).toBe("late edit");
  });

  it("durably ends an unchanged recovery while preserving ordinary retained settings", async () => {
    const input = await completionInput();

    expect(await completeRejectedComposerSend(input)).toBe("cleared");

    expect(getComposerDraftSnapshot(input.target.draftKey)).toEqual({
      text: "",
      attachments: [],
      runtimeMode: "full-access",
    });
    expect(
      decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument())).drafts[
        input.target.draftKey
      ],
    ).toEqual(getComposerDraftSnapshot(input.target.draftKey));
  });

  it("captures terminal expectations before waiting on persistence", async () => {
    const input = await completionInput();
    const expected = { ...input.expected };
    const pending = completeRejectedComposerSend({ ...input, expected });
    expected.text = "changed by caller";

    expect(await pending).toBe("cleared");

    expect(getComposerDraftSnapshot(input.target.draftKey).rejectedTurn).toBeUndefined();
  });

  it.each(["prepare", "stage", "owner", "ABA"] as const)(
    "does not clear recovered content after %s changes",
    async (change) => {
      vi.useFakeTimers();
      const input = await completionInput();
      const original = composerDraftFileMocks.getDocument();
      if (change === "prepare") {
        composerDraftFileMocks.setOnOpen(() => {
          composerDraftFileMocks.setOnOpen(null);
          queueMicrotask(() => setComposerDraftText(input.target.draftKey, "newer"));
        });
      } else if (change === "stage") {
        composerDraftFileMocks.setOnStage(() => {
          composerDraftFileMocks.setOnStage(null);
          setComposerDraftText(input.target.draftKey, "newer");
        });
      } else if (change === "ABA") {
        updateComposerDraftSettings(input.target.draftKey, { runtimeMode: "approval-required" });
        updateComposerDraftSettings(input.target.draftKey, { runtimeMode: "full-access" });
        expect(
          sameComposerDraftState(input.expected, getComposerDraftSnapshot(input.target.draftKey)),
        ).toBe(true);
      }

      expect(
        await completeRejectedComposerSend({
          ...input,
          ownerCurrent: () => change !== "owner",
        }),
      ).toBe("changed");

      expect(composerDraftFileMocks.getDocument()).toBe(original);
      expect(getComposerDraftSnapshot(input.target.draftKey).rejectedTurn).toEqual(REFUSED_SOURCE);
      await flushComposerDrafts();
    },
  );

  it.each(["write", "after-rename"] as const)(
    "does not publish or release after uncertain terminal %s failure",
    async (boundary) => {
      const input = await completionInput();
      const original = composerDraftFileMocks.getDocument();
      if (boundary === "write") composerDraftFileMocks.setWriteError(new Error("disk full"));
      else
        composerDraftFileMocks.setOnWrite(() => {
          composerDraftFileMocks.setOnWrite(null);
          throw new Error("uncertain completion");
        });

      await expect(completeRejectedComposerSend(input)).rejects.toBeInstanceOf(
        ComposerDraftPersistenceError,
      );

      expect(getComposerDraftSnapshot(input.target.draftKey)).toEqual(input.expected);
      expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
      if (boundary === "write") expect(composerDraftFileMocks.getDocument()).toBe(original);
      else
        expect(
          JSON.parse(composerDraftFileMocks.getDocument()).drafts[input.target.draftKey]
            .rejectedTurn,
        ).toBeUndefined();
    },
  );

  it("publishes marker removal before a new edit queued at rename", async () => {
    vi.useFakeTimers();
    const input = await completionInput();
    composerDraftFileMocks.setOnWrite(() => {
      composerDraftFileMocks.setOnWrite(null);
      queueMicrotask(() => setComposerDraftText(input.target.draftKey, "next ordinary draft"));
    });

    expect(await completeRejectedComposerSend(input)).toBe("cleared");
    await flushComposerDrafts();

    expect(getComposerDraftSnapshot(input.target.draftKey)).toMatchObject({
      text: "next ordinary draft",
      runtimeMode: "full-access",
    });
    expect(getComposerDraftSnapshot(input.target.draftKey).rejectedTurn).toBeUndefined();
  });

  it("preserves hidden admission files and uploads until a restored draft owns them", async () => {
    const environmentId = EnvironmentId.make("environment");
    const attachment = {
      id: "held-file",
      type: "file" as const,
      name: "held.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      fileUri: "file:///documents/t3-composer-attachments/held.txt",
      uploadedAttachmentId: "held-upload",
      uploadEnvironmentId: environmentId,
    };
    const owner: QueuedThreadMessage = {
      environmentId,
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("message"),
      commandId: CommandId.make("command"),
      text: "rejected input",
      attachments: [attachment],
      createdAt: "2026-10-04T00:00:00.000Z",
      delivery: { state: "unknown" },
    };
    await outboxFixture().admit({ ...owner, attachments: [] });
    const { delivery: _delivery, ...fresh } = owner;
    const admission = threadOutboxManager.enqueueNew(fresh, null);
    await expect(admission.committed).rejects.toMatchObject({ reason: "identity-occupied" });

    await releaseUnusedComposerAttachmentFiles([attachment]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
    expect(composerAttachmentCleanupMocks.releaseUploads).not.toHaveBeenCalled();
    await restoreComposerDraftSnapshot("environment:thread", {
      text: owner.text,
      attachments: owner.attachments,
    });
    admission.releaseAfterHandback();
    await releaseUnusedComposerAttachmentFiles([attachment]);

    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
    expect(composerAttachmentCleanupMocks.releaseUploads).not.toHaveBeenCalled();
    expect(getComposerDraftSnapshot("environment:thread").attachments).toEqual([attachment]);
  });

  it("does not expose ambiguous legacy editor files through either environment clipboard", () => {
    const attachment = {
      id: "editor-file",
      type: "file" as const,
      name: "private.txt",
      mimeType: "text/plain",
      sizeBytes: 3,
      fileUri: "file:///editor-file",
    };
    const queued: QueuedThreadMessage = {
      environmentId: EnvironmentId.make("one"),
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("shared"),
      commandId: CommandId.make("command"),
      text: "queued",
      attachments: [],
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const foreign = { ...queued, environmentId: EnvironmentId.make("two") };
    const draft = { text: "unsaved editor work", attachments: [attachment] };
    appAtomRegistry.set(composerDraftsAtom, { "pending-task:shared": draft });
    appAtomRegistry.set(threadOutboxManager.queuedMessagesByThreadKeyAtom, {
      one: [queued],
      two: [foreign],
    });

    expect(
      findLocalComposerClipboardAttachment(queued.environmentId, attachment.id),
    ).toBeUndefined();
    expect(
      findLocalComposerClipboardAttachment(foreign.environmentId, attachment.id),
    ).toBeUndefined();
    expect(getComposerDraftSnapshot("pending-task:shared")).toEqual(draft);

    appAtomRegistry.set(threadOutboxManager.queuedMessagesByThreadKeyAtom, { one: [queued] });
    expect(findLocalComposerClipboardAttachment(queued.environmentId, attachment.id)).toBe(
      attachment,
    );
  });

  it("runs the real recovery coordinator through source selection and durable commit", async () => {
    await waitForComposerDraftsLoaded();
    const scope = {
      environmentId: REFUSED_SOURCE.environmentId,
      threadId: REFUSED_SOURCE.threadId,
    };
    const source = {
      scope,
      synchronized: true,
      messages: [REFUSED_SOURCE.message],
      activities: [
        {
          id: makeWorkspaceTurnStartRefusalIdentity(scope.threadId, REFUSED_SOURCE.message.id)
            .activityId,
          kind: "provider.turn.start.failed",
          tone: "error" as const,
          summary: "denied",
          turnId: null,
          sequence: 2,
          createdAt: REFUSED_SOURCE.message.createdAt,
          payload: REFUSED_SOURCE.refusal,
        },
      ],
    };

    const result = await recoverRejectedComposerDraft({
      scope,
      messageId: REFUSED_SOURCE.message.id,
      readSource: () => source,
      signal: new AbortController().signal,
      isCurrent: () => true,
    });

    expect(result).toEqual({ status: "recovered" });
    expect(
      decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument())).drafts[
        "environment:thread"
      ],
    ).toEqual({
      text: REFUSED_SOURCE.message.text,
      attachments: [],
      rejectedTurn: REFUSED_SOURCE,
    });
  });

  it("detects disk ownership after rename succeeds but the write reports failure", async () => {
    const input = await recoveryInput();
    const original = {
      id: "file",
      type: "file" as const,
      name: "a.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
    };
    const attachments = [{ ...original, fileUri: "file:///owned/a.txt" }];
    composerDraftFileMocks.setOnWrite(() => {
      throw new Error("uncertain completion");
    });

    await expect(
      commitRejectedComposerDraft({
        ...input,
        source: {
          ...REFUSED_SOURCE,
          message: { ...REFUSED_SOURCE.message, attachments: [original] },
        },
        attachments,
      }),
    ).rejects.toBeInstanceOf(ComposerDraftPersistenceError);

    expect(getComposerDraftSnapshot(input.target.draftKey).rejectedTurn).toBeUndefined();
    expect(await persistedComposerAttachmentOwnership(attachments)).toBe("referenced");
    expect(getComposerDraftSnapshot(input.target.draftKey).rejectedTurn).toBeUndefined();
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "reads durable attachment ownership without restoring live drafts (archived: %s)",
    async (archived) => {
      await waitForComposerDraftsLoaded();
      const attachment = {
        id: "owned",
        type: "file" as const,
        name: "owned.txt",
        mimeType: "text/plain",
        sizeBytes: 3,
        fileUri: "file:///owned/file",
      };
      const drafts = { "environment:thread": { text: "disk-only", attachments: [attachment] } };
      composerDraftFileMocks.setDocument({
        schemaVersion: 2,
        drafts: archived ? {} : drafts,
        ...(archived ? { signedOutDrafts: { owner: { drafts, queuedMessages: [] } } } : {}),
      });

      expect(await persistedComposerAttachmentOwnership([attachment])).toBe("referenced");
      expect(getComposerDraftSnapshot("environment:thread").text).toBe("");
      composerDraftFileMocks.setReadError(new Error("unreadable"));
      expect(await persistedComposerAttachmentOwnership([attachment])).toBe("unknown");
      composerDraftFileMocks.setReadError(null);
      composerDraftFileMocks.setDocument({ schemaVersion: 2, drafts: {} });
      expect(await persistedComposerAttachmentOwnership([attachment])).toBe("unreferenced");
    },
  );

  it("commits source and exact editable content before publishing and preserves duplicate edits", async () => {
    vi.useFakeTimers();
    const input = await recoveryInput();
    const seen: string[] = [];
    const unsubscribe = appAtomRegistry.subscribe(composerDraftsAtom, (drafts) => {
      const draft = drafts[input.target.draftKey];
      if (!draft?.rejectedTurn) return;
      const saved = decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument()));
      expect(saved.drafts[input.target.draftKey]).toEqual(draft);
      seen.push(draft.text);
    });
    onTestFinished(unsubscribe);
    const result = await commitRejectedComposerDraft(input);
    unsubscribe();
    expect(result).toBe("recovered");
    expect(seen).toEqual([REFUSED_SOURCE.message.text]);
    setComposerDraftText(input.target.draftKey, "edited");
    expect(await commitRejectedComposerDraft(input)).toBe("existing");
    expect(getComposerDraftSnapshot(input.target.draftKey).text).toBe("edited");
    await flushComposerDrafts();
  });

  it.each(["prepare", "stage"] as const)(
    "cancels recovery after edit-clear at %s",
    async (boundary) => {
      vi.useFakeTimers();
      const input = await recoveryInput();
      const original = composerDraftFileMocks.getDocument();
      const change = () => {
        setComposerDraftText(input.target.draftKey, "temporary");
        clearComposerDraft(input.target.draftKey, { deferAttachmentCleanup: true });
      };
      if (boundary === "prepare") {
        composerDraftFileMocks.setOnOpen(() => {
          composerDraftFileMocks.setOnOpen(null);
          queueMicrotask(change);
        });
      } else {
        composerDraftFileMocks.setOnStage(() => {
          composerDraftFileMocks.setOnStage(null);
          change();
        });
      }

      expect(await commitRejectedComposerDraft(input)).toBe("changed");

      expect(composerDraftFileMocks.getDocument()).toBe(original);
      expect(getComposerDraftSnapshot(input.target.draftKey).rejectedTurn).toBeUndefined();
      await flushComposerDrafts();
    },
  );

  it("publishes before a clear queued by rename and never restores the cleared content", async () => {
    vi.useFakeTimers();
    const input = await recoveryInput();
    const seen: string[] = [];
    composerDraftFileMocks.setOnWrite(() => {
      composerDraftFileMocks.setOnWrite(null);
      queueMicrotask(() => {
        seen.push(getComposerDraftSnapshot(input.target.draftKey).text);
        clearComposerDraftContent(input.target.draftKey, { deferAttachmentCleanup: true });
      });
    });

    expect(await commitRejectedComposerDraft(input)).toBe("recovered");
    await flushComposerDrafts();

    expect(seen).toEqual([REFUSED_SOURCE.message.text]);
    expect(
      decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument())).drafts[
        input.target.draftKey
      ],
    ).toEqual({ text: "", attachments: [], rejectedTurn: REFUSED_SOURCE });
  });

  it("does not publish or replace the document after a recovery staging failure", async () => {
    const input = await recoveryInput();
    const original = composerDraftFileMocks.getDocument();
    composerDraftFileMocks.setWriteError(new Error("disk full"));

    await expect(commitRejectedComposerDraft(input)).rejects.toBeInstanceOf(
      ComposerDraftPersistenceError,
    );

    expect(composerDraftFileMocks.getDocument()).toBe(original);
    expect(getComposerDraftSnapshot(input.target.draftKey).rejectedTurn).toBeUndefined();
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
  });

  it("rejects foreign source scope and unmatched local attachments before writing", async () => {
    const input = await recoveryInput();
    await expect(
      commitRejectedComposerDraft({
        ...input,
        source: { ...REFUSED_SOURCE, threadId: ThreadId.make("foreign") },
      }),
    ).rejects.toBeInstanceOf(ComposerDraftRecoveryError);
    await expect(
      commitRejectedComposerDraft({
        ...input,
        attachments: [
          {
            id: "foreign",
            type: "file",
            name: "file",
            mimeType: "text/plain",
            sizeBytes: 1,
            fileUri: "file:///foreign",
          },
        ],
      }),
    ).rejects.toBeInstanceOf(ComposerDraftRecoveryError);
    expect(composerDraftFileMocks.getWrites()).toEqual([]);
  });

  it("detaches inputs and serializes duplicate recovery commits", async () => {
    const input = await recoveryInput();
    const source = { ...REFUSED_SOURCE, message: { ...REFUSED_SOURCE.message } };
    const first = commitRejectedComposerDraft({ ...input, source });
    source.message.text = "changed by caller";
    const results = await Promise.all([first, commitRejectedComposerDraft(input)]);
    expect(results).toEqual(["recovered", "existing"]);
    expect(composerDraftFileMocks.getWrites()).toHaveLength(1);
    expect(getComposerDraftSnapshot(input.target.draftKey).rejectedTurn).toEqual(REFUSED_SOURCE);
  });

  it("preserves source attachment IDs, metadata and unreferenced context in recovery", async () => {
    const input = await recoveryInput();
    const original = {
      id: "original-file",
      type: "file" as const,
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 3,
      source: { _tag: "pasted-text" as const },
    };
    const source = {
      ...REFUSED_SOURCE,
      message: {
        ...REFUSED_SOURCE.message,
        attachments: [original],
        context: contextDraft(0, 2).context,
      },
    };
    const attachments = [{ ...original, fileUri: "file:///owned-original" }];

    expect(await commitRejectedComposerDraft({ ...input, source, attachments })).toBe("recovered");

    expect(getComposerDraftSnapshot(input.target.draftKey)).toEqual({
      text: source.message.text,
      context: source.message.context,
      attachments,
      rejectedTurn: source,
    });
    expect(
      decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument())).drafts[
        input.target.draftKey
      ],
    ).toEqual(getComposerDraftSnapshot(input.target.draftKey));
  });

  it("cancels at the final guard when caller scope changes during staging", async () => {
    const input = await recoveryInput();
    const original = composerDraftFileMocks.getDocument();
    let current = true;
    composerDraftFileMocks.setOnStage(() => {
      current = false;
    });

    expect(await commitRejectedComposerDraft({ ...input, isCurrent: () => current })).toBe(
      "changed",
    );

    expect(composerDraftFileMocks.getDocument()).toBe(original);
    expect(getComposerDraftSnapshot(input.target.draftKey).rejectedTurn).toBeUndefined();
  });

  it("persists explicit discard of a draft not yet loaded into memory", async () => {
    vi.useFakeTimers();
    const key = "environment:thread";
    composerDraftFileMocks.setDocument({ schemaVersion: 2, drafts: { [key]: DRAFT } });
    composerDraftFileMocks.blockRead();
    onTestFinished(() => composerDraftFileMocks.releaseRead());
    ensureComposerDraftsLoaded();

    clearComposerDraft(key, { deferAttachmentCleanup: true });
    composerDraftFileMocks.releaseRead();
    await flushComposerDrafts();

    expect(getComposerDraftSnapshot(key).text).toBe("");
    expect(JSON.parse(composerDraftFileMocks.getDocument()).drafts).toEqual({});
  });

  it.each([
    "edit",
    "context",
    "import",
    "settings",
    "sticky",
    "project",
    "restore",
    "discard",
  ] as const)(
    "invalidates captured recovery after %s even when the target ends empty",
    async (change) => {
      vi.useFakeTimers();
      const scope = {
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make("thread"),
      };
      expect(captureComposerRecoveryTarget(scope)).toBeNull();
      await waitForComposerDraftsLoaded();
      const target = captureComposerRecoveryTarget(scope);
      if (target === null) throw new Error("Expected empty hydrated target");
      expect(isComposerRecoveryTargetCurrent(target)).toBe(true);
      switch (change) {
        case "edit":
          setComposerDraftText(target.draftKey, "temporary");
          clearComposerDraft(target.draftKey, { deferAttachmentCleanup: true });
          break;
        case "context":
          setComposerDraftContext(target.draftKey, contextDraft(0, 1).context);
          clearComposerDraft(target.draftKey, { deferAttachmentCleanup: true });
          break;
        case "import":
          setComposerContextImporting(target.draftKey, true);
          expect(captureComposerRecoveryTarget(scope)).toBeNull();
          setComposerContextImporting(target.draftKey, false);
          break;
        case "settings":
          updateComposerDraftSettings(target.draftKey, { runtimeMode: "full-access" });
          clearComposerDraft(target.draftKey, { deferAttachmentCleanup: true });
          break;
        case "sticky":
          setStickyComposerModelSelection({
            instanceId: ProviderInstanceId.make("codex"),
            model: "model",
          });
          break;
        case "project":
          createNewTaskDraft({
            environmentId: scope.environmentId,
            projectId: ProjectId.make("project"),
          });
          break;
        case "restore":
          await restoreComposerDraftSnapshot(target.draftKey, { text: "", attachments: [] });
          break;
        case "discard":
          clearComposerDraft(target.draftKey, { deferAttachmentCleanup: true });
          break;
      }
      expect(getComposerDraftSnapshot(target.draftKey).text).toBe("");
      expect(captureComposerRecoveryTarget(scope)).not.toBeNull();
      expect(isComposerRecoveryTargetCurrent(target)).toBe(false);
      await flushComposerDrafts();
    },
  );

  it("publishes the new mutation epoch before notifying draft subscribers", async () => {
    vi.useFakeTimers();
    await waitForComposerDraftsLoaded();
    const scope = {
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("thread"),
    };
    const target = captureComposerRecoveryTarget(scope);
    if (target === null) throw new Error("Expected empty hydrated target");
    const observations: boolean[] = [];
    const unsubscribe = appAtomRegistry.subscribe(composerDraftsAtom, () => {
      observations.push(isComposerRecoveryTargetCurrent(target));
    });
    onTestFinished(unsubscribe);

    setComposerDraftText("environment:other", "other draft");
    await flushComposerDrafts();

    expect(observations.length).toBeGreaterThan(0);
    expect(observations).not.toContain(true);
  });

  it("retains immutable recovery provenance when edited content is cleared and reloaded", async () => {
    vi.useFakeTimers();
    const key = "environment:thread";
    await restoreComposerDraftSnapshot(key, {
      ...DRAFT,
      rejectedTurn: REFUSED_SOURCE,
    });
    setComposerDraftText(key, "edited");
    clearComposerDraftContent(key, { deferAttachmentCleanup: true });
    await flushComposerDrafts();
    appAtomRegistry.set(composerDraftsAtom, {});
    resetComposerDraftsLoadState();

    await waitForComposerDraftsLoaded();

    expect(getComposerDraftSnapshot(key)).toEqual({
      text: "",
      attachments: [],
      rejectedTurn: REFUSED_SOURCE,
    });
    expect(isComposerDraftEmpty(getComposerDraftSnapshot(key))).toBe(false);
    clearComposerDraft(key, { deferAttachmentCleanup: true });
    await flushComposerDrafts();
    expect(
      decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument())).drafts[key],
    ).toBeUndefined();
  });

  it.each(["role", "request", "scope", "legacy"] as const)(
    "rejects a recovery marker with invalid %s binding",
    (invalid) => {
      const source = {
        ...REFUSED_SOURCE,
        message: {
          ...REFUSED_SOURCE.message,
          role: invalid === "role" ? "assistant" : "user",
        },
        refusal: {
          ...REFUSED_SOURCE.refusal,
          requestId: invalid === "request" ? "foreign-message" : REFUSED_SOURCE.message.id,
        },
      };
      expect(() =>
        decodePersistedComposerState({
          schemaVersion: invalid === "legacy" ? 1 : 2,
          drafts: {
            [invalid === "scope" ? "foreign:thread" : "environment:thread"]: {
              ...DRAFT,
              rejectedTurn: source,
            },
          },
        }),
      ).toThrow();
    },
  );

  it("round trips version-2 content without legacy chip insertion or selector stripping", () => {
    const key = "new-task:exact";
    const draft: ComposerDraft = {
      text: "",
      attachments: [],
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "model" },
    };
    const fileDraft: ComposerDraft = {
      text: "  /command\n",
      context: contextDraft(0, 2).context,
      attachments: [
        {
          id: "source-file",
          type: "file",
          name: "report.txt",
          mimeType: "text/plain",
          sizeBytes: 3,
          fileUri: "file:///report.txt",
        },
      ],
    };

    const decoded = decodePersistedComposerState({
      schemaVersion: 2,
      drafts: { [key]: draft, "environment:thread": fileDraft },
      signedOutDrafts: {
        owner: { drafts: { "environment:thread": fileDraft }, queuedMessages: [] },
      },
    });

    expect(decoded.drafts).toEqual({ [key]: draft, "environment:thread": fileDraft });
    expect(decoded.cloudDrafts.signedOut.owner?.drafts["environment:thread"]).toEqual(fileDraft);
  });

  it("preserves image source metadata through durable write and reload", async () => {
    await waitForComposerDraftsLoaded();
    const draft: ComposerDraft = {
      text: "image",
      attachments: [
        {
          id: "source-image",
          type: "image",
          name: "source.png",
          mimeType: "image/png",
          sizeBytes: 3,
          fileUri: "file:///source.png",
          previewUri: "file:///source.png",
          source: {
            kind: "snap-shot",
            capturedAt: "2026-10-04T00:00:00.000Z",
            appName: "Editor",
            windowTitle: "  Exact window  ",
          },
        },
      ],
    };

    await restoreComposerDraftSnapshot("environment:thread", draft);
    const decoded = decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument()));

    expect(decoded.drafts["environment:thread"]).toEqual(draft);
  });

  it("rejects unknown version-2 context instead of silently dropping it", () => {
    expect(() =>
      decodePersistedComposerState({
        schemaVersion: 2,
        drafts: {
          "environment:thread": {
            text: "exact",
            attachments: [],
            context: { version: 1, records: [{ kind: "future", contextId: "keep-me" }] },
          },
        },
      }),
    ).toThrow();
  });

  it("does not overwrite an unsupported version-2 document on flush", async () => {
    vi.useFakeTimers();
    composerDraftFileMocks.setDocument({
      schemaVersion: 2,
      drafts: {
        "environment:saved": { text: "preserve", attachments: [], futureRecovery: true },
      },
    });
    const original = composerDraftFileMocks.getDocument();
    setComposerDraftText("environment:new", "new edit");

    await expect(flushComposerDrafts()).rejects.toBeInstanceOf(ComposerDraftPersistenceError);

    expect(composerDraftFileMocks.getDocument()).toBe(original);
    expect(composerDraftFileMocks.getWrites()).toEqual([]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
  });

  it.each(["edit", "clear", "other"] as const)(
    "persists the latest %s made while preparing a snapshot write",
    async (change) => {
      vi.useFakeTimers();
      await waitForComposerDraftsLoaded();
      const key = "environment:thread";
      const otherKey = "environment:other";
      composerDraftFileMocks.setOnOpen(() => {
        composerDraftFileMocks.setOnOpen(null);
        queueMicrotask(() => {
          if (change === "clear") {
            clearComposerDraftContent(key, { deferAttachmentCleanup: true });
          } else {
            setComposerDraftText(change === "other" ? otherKey : key, "newer");
          }
        });
      });

      await restoreComposerDraftSnapshot(key, DRAFT);

      const saved = decodePersistedComposerState(
        JSON.parse(composerDraftFileMocks.getDocument()),
      ).drafts;
      if (change === "clear") {
        expect(saved[key]).toBeUndefined();
      } else {
        expect(saved[change === "other" ? otherKey : key]?.text).toBe("newer");
      }
      if (change === "other") expect(saved[key]).toEqual(DRAFT);
    },
  );

  it.each(["context", "receipt"] as const)(
    "persists a %s-only draft through actual write and reload",
    async (content) => {
      await waitForComposerDraftsLoaded();
      const draft: ComposerDraft =
        content === "context"
          ? { ...contextDraft(0, 1), text: "" }
          : { text: "", attachments: [], importedShareIds: ["share-receipt"] };
      expect(isComposerDraftEmpty(draft)).toBe(false);
      const key = "environment:thread";
      await restoreComposerDraftSnapshot(key, draft);
      expect(
        decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument())).drafts[key],
      ).toEqual(draft);
      appAtomRegistry.set(composerDraftsAtom, {});
      resetComposerDraftsLoadState();
      await waitForComposerDraftsLoaded();
      expect(getComposerDraftSnapshot(key)).toEqual(draft);
    },
  );

  it("treats project retarget as a draft-state change", async () => {
    await waitForComposerDraftsLoaded();
    const key = createNewTaskDraft({
      environmentId: EnvironmentId.make("environment"),
      projectId: ProjectId.make("project-a"),
    });
    const captured = getComposerDraftSnapshot(key);
    retargetNewTaskDraft(key, {
      environmentId: EnvironmentId.make("environment"),
      projectId: ProjectId.make("project-b"),
    });
    const retargeted = getComposerDraftSnapshot(key);
    expect(sameComposerDraftState(captured, { ...captured, project: retargeted.project })).toBe(
      false,
    );
    await flushComposerDrafts();
  });

  it("preserves deliberate context-only model selection during hydration", () => {
    const draft: ComposerDraft = {
      ...contextDraft(0, 1),
      text: "",
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "selected-model" },
    };
    const parsed = decodePersistedComposerState({
      schemaVersion: 1,
      drafts: { "new-task:environment:project": draft },
    });
    expect(Object.values(parsed.drafts)[0]?.modelSelection).toEqual(draft.modelSelection);
  });

  it.each(["text", "context", "delivery"] as const)(
    "keeps a same-slot archive with different %s instead of silently dropping it",
    async (difference) => {
      const load = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
      const enqueue = vi.spyOn(threadOutboxManager.authority, "reconcileArchived");
      onTestFinished(() => {
        load.mockRestore();
        enqueue.mockRestore();
      });
      await waitForComposerDraftsLoaded();
      const live: QueuedThreadMessage = {
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make("thread"),
        messageId: MessageId.make("message"),
        commandId: CommandId.make("command"),
        text: "Current work",
        attachments: [],
        createdAt: "2026-10-04T00:00:00.000Z",
      };
      const archived: QueuedThreadMessage =
        difference === "text"
          ? { ...live, text: "Other retained work" }
          : difference === "context"
            ? { ...live, context: contextDraft(1, 1).context }
            : { ...live, delivery: { state: "attempted" } };
      threadOutboxManager.setAccountId("account");
      const liveRow = await outboxFixture().admit(live, "account");
      const saved = { drafts: {}, queuedMessages: [archived] };
      appAtomRegistry.set(
        threadOutboxManager.queuedMessagesByThreadKeyAtom,
        groupQueuedThreadMessages([liveRow]),
      );
      appAtomRegistry.set(composerCloudDraftsAtom, {
        accountId: null,
        signedOut: { account: saved },
      });
      await restoreCloudComposerDrafts("account");
      expect(enqueue).toHaveBeenCalledExactlyOnceWith("account", archived);
      expect(appAtomRegistry.get(composerCloudDraftsAtom).signedOut["account"]).toEqual(saved);
      expect(
        decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument())).cloudDrafts
          .signedOut["account"],
      ).toEqual(saved);
      expect(appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom)).toEqual(
        groupQueuedThreadMessages([{ ...liveRow, delivery: { state: "unknown" } }]),
      );
    },
  );

  it("preserves archive updates that arrive while a restore awaits enqueue", async () => {
    const load = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => load.mockRestore());
    await waitForComposerDraftsLoaded();
    const message: QueuedThreadMessage = {
      environmentId: EnvironmentId.make("environment"),
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("message"),
      commandId: CommandId.make("command"),
      text: "Restoring",
      attachments: [],
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const newer = {
      drafts: { "environment:new": { text: "Newer archive", attachments: [] } },
      queuedMessages: [message],
    };
    const other = {
      drafts: { "other:thread": { text: "Other account work", attachments: [] } },
      queuedMessages: [],
    };
    appAtomRegistry.set(composerCloudDraftsAtom, {
      accountId: null,
      signedOut: { account: { drafts: {}, queuedMessages: [message] } },
    });
    const enqueue = vi
      .spyOn(threadOutboxManager.authority, "reconcileArchived")
      .mockImplementationOnce(async () => {
        appAtomRegistry.set(composerCloudDraftsAtom, {
          accountId: null,
          signedOut: { account: newer, other },
        });
        return { status: "imported", record: null };
      });
    onTestFinished(() => enqueue.mockRestore());
    await restoreCloudComposerDrafts("account");
    expect(appAtomRegistry.get(composerCloudDraftsAtom).signedOut).toEqual({
      account: newer,
      other,
    });
  });

  it.each(["queued-context", "editor-context", "attachment-name", "upload-only"] as const)(
    "preserves archived user changes while cleaning up ACK with %s differences",
    async (change) => {
      await waitForComposerDraftsLoaded();
      const environmentId = EnvironmentId.make("environment");
      const attachment = {
        id: "file",
        type: "file" as const,
        name: "original.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: "file:///documents/original.txt",
      };
      const message: QueuedThreadMessage = {
        environmentId,
        threadId: ThreadId.make("thread"),
        messageId: MessageId.make("message"),
        commandId: CommandId.make("command"),
        text: "Same text",
        attachments: [attachment],
        createdAt: "2026-10-04T00:00:00.000Z",
      };
      const archived =
        change === "queued-context"
          ? { ...message, context: contextDraft(0, 1).context }
          : change === "attachment-name"
            ? { ...message, attachments: [{ ...attachment, name: "renamed.txt" }] }
            : {
                ...message,
                attachments: [
                  {
                    ...attachment,
                    uploadedAttachmentId: "uploaded",
                    uploadEnvironmentId: environmentId,
                  },
                ],
              };
      const editor: Record<string, ComposerDraft> =
        change === "editor-context"
          ? {
              "pending-task:message": {
                text: message.text,
                attachments: [attachment],
                context: contextDraft(1, 1).context,
              },
            }
          : {};
      appAtomRegistry.set(composerCloudDraftsAtom, {
        accountId: "account",
        signedOut: { account: { drafts: editor, queuedMessages: [archived] } },
      });
      await removeDeliveredCloudQueuedMessage(message);
      const saved = appAtomRegistry.get(composerCloudDraftsAtom).signedOut["account"];
      expect(saved?.queuedMessages).toEqual(change === "upload-only" ? [] : [archived]);
      if (change === "editor-context") expect(saved?.drafts).toEqual(editor);
    },
  );

  it("archives equal raw IDs in different scopes without overwriting either", async () => {
    const load = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => load.mockRestore());
    await waitForComposerDraftsLoaded();
    const first: QueuedThreadMessage = {
      environmentId: EnvironmentId.make("environment-a"),
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("shared"),
      commandId: CommandId.make("command"),
      text: "First scope",
      attachments: [],
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const second = {
      ...first,
      environmentId: EnvironmentId.make("environment-b"),
      text: "Second scope",
    };
    threadOutboxManager.setAccountId("account");
    const firstRow = await outboxFixture().admit(first, "account");
    const secondRow = await outboxFixture().admit(second, "account");
    await archiveCloudComposerDrafts(
      "account",
      new Set([first.environmentId, second.environmentId]),
    );
    const saved = decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument()));
    expect(saved.cloudDrafts.signedOut["account"]?.queuedMessages).toEqual([firstRow, secondRow]);
  });

  it("restores another scoped identity even when its raw ID is already queued", async () => {
    const load = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    const enqueue = vi.spyOn(threadOutboxManager.authority, "reconcileArchived");
    onTestFinished(() => {
      load.mockRestore();
      enqueue.mockRestore();
    });
    await waitForComposerDraftsLoaded();
    const first: QueuedThreadMessage = {
      environmentId: EnvironmentId.make("environment-a"),
      threadId: ThreadId.make("thread"),
      messageId: MessageId.make("shared"),
      commandId: CommandId.make("command"),
      text: "First scope",
      attachments: [],
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const second = {
      ...first,
      environmentId: EnvironmentId.make("environment-b"),
      text: "Second scope",
    };
    appAtomRegistry.set(
      threadOutboxManager.queuedMessagesByThreadKeyAtom,
      groupQueuedThreadMessages([first]),
    );
    appAtomRegistry.set(composerCloudDraftsAtom, {
      accountId: null,
      signedOut: { account: { drafts: {}, queuedMessages: [first, second] } },
    });
    await restoreCloudComposerDrafts("account");
    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenNthCalledWith(1, "account", first);
    expect(enqueue).toHaveBeenNthCalledWith(2, "account", second);
    expect(
      threadOutboxManager.authority.knownRecords().map((record) => record.delivery.state),
    ).toEqual(["unknown", "unknown"]);
  });

  it("removes only the exact archived identity and preserves an ambiguous legacy editor", async () => {
    await waitForComposerDraftsLoaded();
    const first: QueuedThreadMessage = {
      environmentId: EnvironmentId.make("environment-a"),
      threadId: ThreadId.make("thread-a"),
      messageId: MessageId.make("shared"),
      commandId: CommandId.make("command"),
      text: "Same text",
      attachments: [],
      createdAt: "2026-10-04T00:00:00.000Z",
    };
    const second = { ...first, threadId: ThreadId.make("thread-b") };
    appAtomRegistry.set(composerCloudDraftsAtom, {
      accountId: null,
      signedOut: {
        account: {
          drafts: { "pending-task:shared": { text: "Same text", attachments: [] } },
          queuedMessages: [first, second],
        },
      },
    });
    await removeDeliveredCloudQueuedMessage(second);
    expect(
      appAtomRegistry.get(composerCloudDraftsAtom).signedOut["account"]?.queuedMessages,
    ).toEqual([first, second]);
    appAtomRegistry.set(composerCloudDraftsAtom, {
      accountId: null,
      signedOut: { account: { drafts: {}, queuedMessages: [first, second] } },
    });
    await removeDeliveredCloudQueuedMessage(second);
    expect(
      appAtomRegistry.get(composerCloudDraftsAtom).signedOut["account"]?.queuedMessages,
    ).toEqual([first]);
  });

  it.each(["active", "parked", "retained", "released"] as const)(
    "respects %s durable original-file ownership in the real cleanup path",
    async (state) => {
      const legacyLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
      onTestFinished(() => legacyLoad.mockRestore());
      const environmentId = EnvironmentId.make("environment-1");
      const attachment = {
        id: "durable-file",
        type: "file" as const,
        name: "original.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: "file:///documents/t3-composer-attachments/original.txt",
        uploadedAttachmentId: "pending-original",
        uploadEnvironmentId: environmentId,
      };
      const observed = decodeThreadOutboxRecord({
        schemaVersion: 5,
        environmentId,
        threadId: ThreadId.make("thread-1"),
        messageId: MessageId.make("message-1"),
        commandId: CommandId.make("command-1"),
        text: "Original",
        attachments: [attachment],
        createdAt: "2026-10-04T00:00:00.000Z",
        delivery: { state: "attempted" },
      });
      if (observed.kind !== "message") throw new Error("Expected message fixture");
      const { message, ...rest } = observed;
      const record = decodeThreadOutboxRecord(
        state === "active" || state === "parked"
          ? {
              ...observed,
              message: { ...message, attachments: [] },
              ...(state === "parked" ? { archivedFor: "account-a" } : {}),
            }
          : {
              ...rest,
              kind: "retired",
              reason: "discarded",
              ...(state === "retained" ? { retainedMessage: { ...message, attachments: [] } } : {}),
            },
      );
      const records = vi
        .spyOn(outboxStorage.expoThreadOutboxStorage, "loadRecords")
        .mockResolvedValue({ records: [record], errors: [] });
      onTestFinished(() => records.mockRestore());
      await releaseUnusedComposerAttachmentFiles([attachment]);
      expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledTimes(
        state === "released" ? 1 : 0,
      );
      expect(composerAttachmentCleanupMocks.releaseUploads).toHaveBeenCalledTimes(
        state === "released" ? 1 : 0,
      );
    },
  );

  it("retains candidates when durable record ownership cannot be read", async () => {
    const legacyLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => legacyLoad.mockRestore());
    const records = vi
      .spyOn(outboxStorage.expoThreadOutboxStorage, "loadRecords")
      .mockResolvedValue({
        records: [],
        errors: [
          new outboxStorage.ThreadOutboxStorageError({
            operation: "read-message",
            environmentId: null,
            threadId: null,
            messageId: null,
            fileName: "unknown.json",
            cause: new Error("Unreadable owner"),
          }),
        ],
      });
    onTestFinished(() => records.mockRestore());
    await releaseUnusedComposerAttachmentFiles([
      {
        id: "file",
        type: "file",
        name: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: "file:///documents/t3-composer-attachments/file.txt",
      },
    ]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
  });

  it("aborts cleanup if an outbox write happens during an awaited ownership check", async () => {
    const legacyLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => legacyLoad.mockRestore());
    const state = vi
      .spyOn(outboxStorage, "threadOutboxWriteState")
      .mockReturnValue({ revision: 0, pending: false });
    onTestFinished(() => state.mockRestore());
    incomingShareStorageMocks.load.mockImplementationOnce(async () => {
      state.mockReturnValue({ revision: 1, pending: false });
      return [];
    });
    await releaseUnusedComposerAttachmentFiles([
      {
        id: "file",
        type: "file",
        name: "file.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: "file:///documents/t3-composer-attachments/file.txt",
      },
    ]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
    expect(composerAttachmentCleanupMocks.releaseUploads).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "restores visible file chips from legacy drafts (archived: %s)",
    async (archived) => {
      const file = {
        type: "file" as const,
        id: "legacy-file",
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 10,
        fileUri: "file:///notes.txt",
      };
      const image = { ...file, id: "photo", name: "photo.png", mimeType: "image/png" };
      const video = { ...file, id: "video", name: "clip.mp4", mimeType: "video/mp4" };
      const legacy = { text: "Review these", attachments: [file, image, video] };
      const document = {
        schemaVersion: 1,
        drafts: archived ? {} : { thread: legacy },
        ...(archived
          ? { signedOutDrafts: { account: { drafts: { thread: legacy }, queuedMessages: [] } } }
          : {}),
      };
      const decoded = decodePersistedComposerState(document);
      const restored = archived
        ? decoded.cloudDrafts.signedOut.account?.drafts.thread
        : decoded.drafts.thread;
      expect(restored?.text).toBe("Review these [notes.txt](t3-context://v1/file/legacy-file) ");
      expect(restored?.attachments).toEqual(legacy.attachments);
      expect(restored?.context?.records).toEqual([
        expect.objectContaining({ kind: "file", attachmentId: file.id }),
      ]);
      expect(
        decodePersistedComposerState({ schemaVersion: 1, drafts: { thread: restored } }).drafts
          .thread,
      ).toEqual(restored);
      appAtomRegistry.set(composerDraftsAtom, { thread: restored! });
      setComposerDraftText("thread", "Review these");
      expect(getComposerDraftSnapshot("thread").attachments).toEqual([image, video]);
      await releaseUnusedComposerAttachmentFiles([file]);
    },
  );

  it("restores a missing file reference without duplicating its record or replacing another record's id", () => {
    const file = {
      type: "file" as const,
      id: "file",
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 10,
      fileUri: "file:///notes.txt",
    };
    const existing = {
      version: 1,
      contextId: "original",
      kind: "file",
      label: file.name,
      attachmentId: file.id,
      name: file.name,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
    const skill = { version: 1, contextId: "file", kind: "skill", label: "Skill", name: "skill" };
    for (const records of [[existing, skill], [skill]]) {
      const restored = decodePersistedComposerState({
        schemaVersion: 1,
        drafts: {
          thread: { text: "", attachments: [file], context: { version: 1, records } },
        },
      }).drafts.thread;
      expect(restored?.context?.records).toHaveLength(2);
      expect(restored?.context?.records).toContainEqual(skill);
      expect(restored?.text).toBe(
        `[notes.txt](t3-context://v1/file/${records.length === 2 ? "original" : "file_2"}) `,
      );
    }
  });
  it.each([false, true])(
    "restores deleted file chips and releases undo history (uploaded: %s)",
    async (uploaded) => {
      const key = "environment:undo-file";
      const file = {
        type: "file" as const,
        id: "undo-file",
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 1,
        fileUri: "file:///documents/t3-composer-attachments/undo-file.txt",
        ...(uploaded
          ? {
              uploadedAttachmentId: "pending-upload",
              uploadEnvironmentId: EnvironmentId.make("environment"),
            }
          : {}),
      };
      appendComposerDraftAttachments(key, [file], { appendReference: true });
      const original = getComposerDraftSnapshot(key);
      const history = createComposerDraftContextHistory();
      const changeText = (text: string) => {
        const restored = history.restore(text, getComposerDraftSnapshot(key));
        setComposerDraftText(key, text);
        setComposerDraftContext(key, restored.context);
        appendComposerDraftAttachments(key, restored.attachments, { allowOverflow: true });
      };
      try {
        changeText("");
        expect(getComposerDraftSnapshot(key).attachments).toEqual([]);
        await releaseUnusedComposerAttachmentFiles([file]);
        expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalledWith(file.fileUri);
        changeText(original.text);
        expect(getComposerDraftSnapshot(key).context).toEqual(original.context);
        expect(getComposerDraftSnapshot(key).attachments).toEqual([
          { ...file, uploadedAttachmentId: undefined, uploadEnvironmentId: undefined },
        ]);
        changeText("");
      } finally {
        history.dispose();
      }
      await releaseUnusedComposerAttachmentFiles([file]);
      expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledWith(file.fileUri);
    },
  );

  it("keeps a long attachment filename and a bounded chip label through reload", () => {
    const key = "environment:long-file";
    const file = {
      type: "file" as const,
      id: "long-file",
      name: `${"a".repeat(210)}.txt`,
      mimeType: "text/plain",
      sizeBytes: 1,
      fileUri: "file:///long-file.txt",
    };
    appendComposerDraftAttachments(key, [file], { appendReference: true });
    const draft = getComposerDraftSnapshot(key);
    const reloaded = decodePersistedComposerState(
      JSON.parse(
        JSON.stringify({
          schemaVersion: 1,
          drafts: { [key]: draft },
        }),
      ),
    ).drafts[key];
    expect(reloaded?.context?.records[0]).toMatchObject({ name: file.name, attachmentId: file.id });
    expect(reloaded?.context?.records[0]?.label.length).toBeLessThanOrEqual(200);
  });

  it("gives a folded paste a chip that survives the send", () => {
    const key = "environment-1:thread-1";
    // What `createPastedTextComposerAttachment` produces for a long paste.
    const pasted = {
      type: "file" as const,
      id: "pasted-1",
      name: "pasted-text.txt",
      mimeType: "text/plain",
      sizeBytes: 40_000,
      fileUri: "file:///pasted-text.txt",
    };
    appendComposerDraftAttachments(key, [pasted], { appendReference: true });

    const draft = getComposerDraftSnapshot(key);
    // Visible in the composer before sending, not only once the message lands.
    expect(draft.text).toContain("pasted-text.txt");
    expect(draft.context?.records).toMatchObject([
      { kind: "file", attachmentId: pasted.id, name: pasted.name },
    ]);
    // The reference points at the record, so the chip stays a chip in the sent message.
    const [record] = draft.context?.records ?? [];
    expect(draft.text).toContain(String(record?.contextId));
  });

  it("drops chips and records for attachments a replace no longer keeps", () => {
    const key = "new-task:draft-1";
    const kept = {
      type: "file" as const,
      id: "kept-file",
      name: "kept.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      fileUri: "file:///kept.txt",
    };
    const dropped = {
      type: "file" as const,
      id: "dropped-file",
      name: "dropped.txt",
      mimeType: "text/plain",
      sizeBytes: 1,
      fileUri: "file:///dropped.txt",
    };
    appendComposerDraftAttachments(key, [kept, dropped], { appendReference: true });

    const before = getComposerDraftSnapshot(key);
    expect(before.text).toContain("dropped.txt");
    expect(before.context?.records).toHaveLength(2);

    replaceComposerDraftAttachments(key, [kept]);

    const after = getComposerDraftSnapshot(key);
    expect(after.attachments.map((attachment) => attachment.id)).toEqual([kept.id]);
    expect(after.text).not.toContain("dropped.txt");
    expect(after.context?.records.map((record) => record.contextId)).toEqual([
      before.context?.records[0]?.contextId,
    ]);
  });

  it.each(["new-task:draft-1", "pending-task:queued-1"])(
    "finds draft-only local clipboard files in %s",
    (key) => {
      const environmentId = EnvironmentId.make("environment-1");
      const file = {
        type: "file" as const,
        id: "local-file",
        name: "notes.txt",
        mimeType: "text/plain",
        sizeBytes: 4,
        fileUri: "file:///notes.txt",
      };
      appAtomRegistry.set(composerDraftsAtom, {
        [key]: {
          text: "",
          attachments: [file],
          project: {
            environmentId,
            projectId: ProjectId.make("project-1"),
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        },
      });
      appAtomRegistry.set(threadOutboxManager.queuedMessagesByThreadKeyAtom, {
        queued: [
          {
            environmentId,
            threadId: ThreadId.make("thread-1"),
            messageId: MessageId.make("queued-1"),
            commandId: CommandId.make("command-1"),
            text: "Queued",
            attachments: [],
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });
      expect(findLocalComposerClipboardAttachment(environmentId, file.id)).toEqual(file);
      expect(
        findLocalComposerClipboardAttachment(EnvironmentId.make("different-environment"), file.id),
      ).toBeUndefined();
    },
  );

  it("keeps over-limit recovery context reloadable without losing other drafts", () => {
    const key = "environment-1:recovery";
    const merged = mergeComposerDraftContentState(
      { [key]: contextDraft(0, 200), other: DRAFT },
      key,
      contextDraft(200, 200),
    );
    expect(merged[key]?.context?.records).toHaveLength(400);
    const reloaded = decodePersistedComposerState(
      JSON.parse(JSON.stringify({ schemaVersion: 1, drafts: merged })),
    ).drafts;
    expect(reloaded[key]).toEqual(merged[key]);
    expect(reloaded.other).toEqual(DRAFT);
  });

  it("prunes unreferenced context during a content merge", () => {
    const existing = contextDraft(0, 2);
    const incoming = contextDraft(2, 2);
    const merged = mergeComposerDraftContentState(
      { key: { ...existing, text: "[Skill](t3-context://v1/skill/skill-0)" } },
      "key",
      { ...incoming, text: "[Skill](t3-context://v1/skill/skill-2)" },
    );
    expect(merged.key?.context?.records.map((record) => record.contextId)).toEqual([
      "skill-0",
      "skill-2",
    ]);
  });

  it("restores and persists both full cloud and live context drafts", async () => {
    const load = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => load.mockRestore());
    await waitForComposerDraftsLoaded();
    const key = "environment-1:restored";
    appAtomRegistry.set(composerDraftsAtom, { [key]: contextDraft(0, 200) });
    appAtomRegistry.set(composerCloudDraftsAtom, {
      accountId: null,
      signedOut: { account: { drafts: { [key]: contextDraft(200, 200) }, queuedMessages: [] } },
    });
    await restoreCloudComposerDrafts("account");
    expect(getComposerDraftSnapshot(key).context?.records).toHaveLength(400);
    const reloaded = decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument()));
    expect(reloaded.drafts[key]?.context?.records).toHaveLength(400);
    expect(reloaded.cloudDrafts.signedOut).toEqual({});
  });

  it.each([
    { name: "notes.txt", mimeType: "text/plain" },
    { name: "document-photo.png", mimeType: "image/png" },
    { name: "recording.mp4", mimeType: "video/mp4" },
  ])(
    "removes $name after its last reference is deleted, while retaining native images",
    async ({ name, mimeType }) => {
      const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
      onTestFinished(() => outboxLoad.mockRestore());
      const cleanup = Promise.withResolvers<void>();
      composerAttachmentCleanupMocks.remove.mockImplementationOnce(async () => {
        cleanup.resolve();
      });
      const key = "environment-1:remove-context-files";
      const file = {
        id: "file-1",
        type: "file" as const,
        name,
        mimeType,
        sizeBytes: 4,
        fileUri: `file:///${name}`,
      };
      const image = {
        ...file,
        id: "image-1",
        type: "image" as const,
        name: "image.png",
        mimeType: "image/png",
        fileUri: "file:///image.png",
        previewUri: "file:///image.png",
      };
      appendComposerDraftAttachments(key, [file, image], { appendReference: true });
      const fileLink = formatComposerContextReference(
        getComposerDraftSnapshot(key).context!.records[0]!,
      );
      setComposerDraftText(key, `${fileLink} ${fileLink}`);
      expect(getComposerDraftSnapshot(key).attachments).toEqual([file, image]);
      setComposerDraftText(key, fileLink);
      expect(getComposerDraftSnapshot(key).attachments).toEqual([file, image]);
      expect(
        countComposerDraftAttachmentsAfterSelection(key, {
          text: fileLink,
          start: 0,
          end: fileLink.length,
        }),
      ).toBe(1);
      setComposerDraftText(key, "plain text");
      expect(getComposerDraftSnapshot(key).attachments).toEqual([image]);
      await cleanup.promise;
    },
  );

  it("rejects attachments atomically when no context slots remain", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const cleanup = Promise.withResolvers<void>();
    composerAttachmentCleanupMocks.remove.mockImplementationOnce(async () => {
      cleanup.resolve();
    });
    const key = "environment-1:full-context";
    const records = Array.from({ length: 200 }, (_, index) => ({
      version: 1 as const,
      contextId: `ctx-${index}` as never,
      kind: "skill" as const,
      label: "Skill",
      name: "skill",
    }));
    appAtomRegistry.set(composerDraftsAtom, {
      [key]: {
        text: records
          .map((record) => `[Skill](t3-context://v1/skill/${record.contextId})`)
          .join(" "),
        context: { version: 1, records },
        attachments: [],
      },
    });
    const before = getComposerDraftSnapshot(key);
    expect(
      appendComposerDraftAttachments(
        key,
        [
          {
            id: "overflow",
            type: "file",
            name: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 4,
            fileUri: "file:///overflow.txt",
          },
        ],
        { appendReference: true },
      ),
    ).toBe(1);
    expect(getComposerDraftSnapshot(key)).toEqual(before);
    await cleanup.promise;
  });
  it.each(["environment-1:thread", "environment-1:new-task:draft"])(
    "preserves the captured paste selection across async writes in %s",
    async (key) => {
      const file = {
        id: "paste",
        type: "file" as const,
        name: "pasted-text.txt",
        mimeType: "text/plain",
        sizeBytes: 40_000,
        fileUri: "file:///paste.txt",
      };
      setComposerDraftText(key, "before selected after");
      const insertion = captureComposerDraftInsertion(key, { start: 7, end: 15 });
      const write = Promise.withResolvers<typeof file>();
      const pending = write.promise.then((attachment) =>
        appendComposerDraftAttachments(key, [attachment], { appendReference: true, insertion }),
      );
      rememberComposerDraftSelection(key, insertion.text, { start: 0, end: 6 });
      rememberComposerDraftSelection("another-draft", "unrelated", { start: 0, end: 9 });
      write.resolve(file);
      expect(await pending).toBe(0);
      const draft = getComposerDraftSnapshot(key);
      expect(draft.text).toBe("before [pasted-text.txt](t3-context://v1/file/paste) after");
      expect(draft.attachments).toEqual([file]);
    },
  );

  it("preserves edits made while a paste is pending instead of deleting stale offsets", async () => {
    const key = "environment-1:typing-during-paste";
    setComposerDraftText(key, "old selection");
    const insertion = captureComposerDraftInsertion(key, { start: 0, end: 13 });
    const write = Promise.withResolvers<void>();
    const pending = write.promise.then(() => insertComposerDraftText(key, " pasted", insertion));
    setComposerDraftText(key, "keep newly typed text");
    write.resolve();
    await pending;
    expect(getComposerDraftSnapshot(key).text).toBe("keep newly typed text pasted");
  });

  it.each(["attachment", "context", "imported context"])(
    "releases a selected file when replaced by %s",
    async (kind) => {
      const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
      onTestFinished(() => outboxLoad.mockRestore());
      const cleanup = Promise.withResolvers<void>();
      composerAttachmentCleanupMocks.remove.mockImplementationOnce(async () => {
        cleanup.resolve();
        return undefined;
      });
      const key = "environment-1:replace-file";
      const files = Array.from({ length: 8 }, (_, index) => ({
        id: `file-${index}`,
        type: "file" as const,
        name: `notes-${index}.txt`,
        mimeType: "text/plain",
        sizeBytes: 4,
        fileUri: `file:///notes-${index}.txt`,
      }));
      appendComposerDraftAttachments(key, files, { appendReference: true });
      const firstLink = "[notes-0.txt](t3-context://v1/file/file-0)";
      const insertion = captureComposerDraftInsertion(key, { start: 0, end: firstLink.length });
      expect(countComposerDraftAttachmentsAfterSelection(key, insertion)).toBe(7);
      expect(getComposerDraftAfterSelection(key, insertion).context?.records).toHaveLength(7);
      const replacement = { ...files[0]!, id: "replacement", fileUri: "file:///replacement.txt" };
      if (kind === "attachment") {
        expect(
          appendComposerDraftAttachments(key, [replacement], { appendReference: true, insertion }),
        ).toBe(0);
      } else if (kind === "imported context") {
        const record = {
          version: 1 as const,
          kind: "file" as const,
          contextId: ComposerContextId.make("replacement"),
          attachmentId: replacement.id,
          label: replacement.name,
          name: replacement.name,
          mimeType: replacement.mimeType,
          sizeBytes: replacement.sizeBytes,
        };
        expect(
          insertComposerDraftContext(
            key,
            {
              text: formatComposerContextReference(record),
              context: { version: 1, records: [record] },
              attachments: [replacement],
            },
            insertion,
          ),
        ).toBe(true);
        expect(getComposerDraftSnapshot(key).attachments).toHaveLength(8);
        expect(getComposerDraftSnapshot(key).context?.records).toContainEqual(record);
        expect(getComposerDraftSnapshot(key).text).toBe(
          `${formatComposerContextReference(record)}${insertion.text.slice(firstLink.length)}`,
        );
      } else {
        insertComposerDraftContext(
          key,
          { text: "replacement", context: { version: 1, records: [] } },
          insertion,
        );
      }
      const draft = getComposerDraftSnapshot(key);
      expect(draft.attachments.map((file) => file.id)).not.toContain("file-0");
      expect(draft.attachments.slice(0, 7)).toEqual(files.slice(1));
      expect(draft.context?.records.some((record) => record.contextId === "file-0")).toBe(false);
      await cleanup.promise;
      expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledWith(files[0]!.fileUri);
    },
  );

  it("rejects an imported file atomically when edits during import use up its replacement slot", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const cleanup = Promise.withResolvers<void>();
    composerAttachmentCleanupMocks.remove.mockImplementationOnce(async () => {
      cleanup.resolve();
      return undefined;
    });
    const key = "environment-1:concurrent-import";
    const files = Array.from({ length: 8 }, (_, index) => ({
      id: `existing-${index}`,
      type: "file" as const,
      name: `notes-${index}.txt`,
      mimeType: "text/plain",
      sizeBytes: 4,
      fileUri: `file:///notes-${index}.txt`,
    }));
    appendComposerDraftAttachments(key, files, { appendReference: true });
    const firstLink = "[notes-0.txt](t3-context://v1/file/existing-0)";
    const insertion = captureComposerDraftInsertion(key, { start: 0, end: firstLink.length });
    setComposerDraftText(key, `New edit ${insertion.text}`);
    const edited = getComposerDraftSnapshot(key);
    const imported = { ...files[0]!, id: "imported", fileUri: "file:///imported.txt" };
    const record = {
      version: 1 as const,
      kind: "file" as const,
      contextId: ComposerContextId.make("imported"),
      attachmentId: imported.id,
      label: imported.name,
      name: imported.name,
      mimeType: imported.mimeType,
      sizeBytes: imported.sizeBytes,
    };
    expect(
      insertComposerDraftContext(
        key,
        {
          text: formatComposerContextReference(record),
          context: { version: 1, records: [record] },
          attachments: [imported],
        },
        insertion,
      ),
    ).toBe(false);
    expect(getComposerDraftSnapshot(key)).toEqual(edited);
    await cleanup.promise;
    expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledWith(imported.fileUri);
  });

  it("retains a file when replacing only one of its repeated references", () => {
    const key = "environment-1:repeat-reference";
    const file = {
      id: "repeat",
      type: "file" as const,
      name: "notes.txt",
      mimeType: "text/plain",
      sizeBytes: 4,
      fileUri: "file:///repeat.txt",
    };
    appendComposerDraftAttachments(key, [file], { appendReference: true });
    const link = getComposerDraftSnapshot(key).text;
    setComposerDraftText(key, `${link} ${link}`);
    const insertion = captureComposerDraftInsertion(key, { start: 0, end: link.length });
    expect(countComposerDraftAttachmentsAfterSelection(key, insertion)).toBe(1);
    insertComposerDraftContext(
      key,
      { text: "replaced", context: { version: 1, records: [] } },
      insertion,
    );
    expect(getComposerDraftSnapshot(key).attachments).toEqual([file]);
    expect(getComposerDraftSnapshot(key).text).toBe(`replaced ${link}`);
  });

  it("inserts context at the saved caret and retains its payload through persistence and restore", () => {
    const draftKey = "context-environment:context-thread";
    const record = {
      version: 1 as const,
      kind: "terminal" as const,
      contextId: ComposerContextId.make("context-terminal"),
      label: "Build output",
      terminalId: "main",
      terminalLabel: "Terminal",
      lineStart: 1,
      lineEnd: 1,
      text: "Build failed",
    };
    const reference = "[Build output](t3-context://v1/terminal/context-terminal)";
    setComposerDraftText(draftKey, "Fix this next");
    rememberComposerDraftSelection(draftKey, "Fix this next", { start: 4, end: 8 });
    insertComposerDraftContext(draftKey, {
      text: reference,
      context: { version: 1, records: [record] },
    });
    const draft = getComposerDraftSnapshot(draftKey);
    expect(draft.text).toBe(`Fix ${reference} next`);
    const decoded = decodePersistedComposerState(
      JSON.parse(JSON.stringify({ schemaVersion: 1, drafts: { [draftKey]: draft } })),
    ).drafts[draftKey];
    expect(decoded?.context?.records).toEqual([record]);
    const restored = mergeComposerDraftContentState(
      { [draftKey]: { text: "Additional work", attachments: [] } },
      draftKey,
      decoded!,
    );
    expect(restored[draftKey]?.text).toContain(reference);
    expect(restored[draftKey]?.context?.records).toEqual([record]);
    expect(clearComposerDraftContentState(restored, draftKey)[draftKey]?.context).toBeUndefined();
    setComposerDraftText(draftKey, "Fix next");
    expect(getComposerDraftSnapshot(draftKey).context).toBeUndefined();
  });

  // Hydration is one-shot per module instance and the attachment sweep now
  // triggers it too, so this test must observe it before any sweep test runs.
  it("hydrates generic file attachments from their saved local paths", () => {
    const file = {
      id: "file-1",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/report.pdf",
    };

    expect(
      decodePersistedComposerState({
        schemaVersion: 1,
        drafts: {
          "environment-1:thread-1": { text: "Review this file", attachments: [file] },
        },
      }).drafts,
    ).toEqual({
      "environment-1:thread-1": {
        text: "Review this file [report.pdf](t3-context://v1/file/file-1) ",
        attachments: [file],
        context: {
          version: 1,
          records: [
            {
              version: 1,
              contextId: file.id,
              kind: "file",
              label: file.name,
              attachmentId: file.id,
              name: file.name,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
            },
          ],
        },
      },
    });
  });

  it("releases videos rejected by the live draft limit and keeps accepted files", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const cleanup = Promise.withResolvers<void>();
    composerAttachmentCleanupMocks.remove.mockImplementationOnce(async () => {
      cleanup.resolve();
    });
    const makeAttachment = (id: string) => ({
      id,
      type: "file" as const,
      name: `${id}.mov`,
      mimeType: "video/quicktime",
      sizeBytes: 42,
      fileUri: `file:///documents/t3-composer-attachments/${id}.mov`,
    });
    const draftKey = "new-task:environment-1:project-cap";
    const existing = Array.from({ length: 7 }, (_, index) => makeAttachment(`held-${index}`));
    appAtomRegistry.set(composerDraftsAtom, {
      [draftKey]: { text: "send this", attachments: existing },
    });

    const rejected = appendComposerDraftAttachments(draftKey, [
      makeAttachment("incoming-1"),
      makeAttachment("incoming-2"),
    ]);

    expect(rejected).toBe(1);
    const draft = appAtomRegistry.get(composerDraftsAtom)[draftKey];
    expect(draft?.attachments).toHaveLength(8);
    expect(draft?.attachments.at(-1)?.id).toBe("incoming-1");
    await cleanup.promise;
    expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledExactlyOnceWith(
      makeAttachment("incoming-2").fileUri,
    );

    // Restore paths bypass the cap so a failed send never drops its files.
    const overflowRejected = appendComposerDraftAttachments(
      draftKey,
      [makeAttachment("restored-1")],
      { allowOverflow: true },
    );
    expect(overflowRejected).toBe(0);
    expect(appAtomRegistry.get(composerDraftsAtom)[draftKey]?.attachments).toHaveLength(9);
  });

  it("keeps shared attachment files until every draft releases them", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const file = {
      id: "file-1",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/report.pdf",
    };
    appAtomRegistry.set(composerDraftsAtom, {
      source: { text: "First draft", attachments: [file] },
      copied: { text: "Second draft", attachments: [file] },
    });

    await releaseUnusedComposerAttachmentFiles([file]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();

    appAtomRegistry.set(composerDraftsAtom, {
      copied: { text: "Second draft", attachments: [file] },
    });
    await releaseUnusedComposerAttachmentFiles([file]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();

    appAtomRegistry.set(composerDraftsAtom, {});
    await releaseUnusedComposerAttachmentFiles([file]);
    expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledWith(file.fileUri);
  });

  it("retains a referenced file-backed image and releases it once unreferenced", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const image = {
      id: "image-1",
      type: "image" as const,
      name: "photo.png",
      mimeType: "image/png",
      sizeBytes: 3,
      fileUri: "file:///documents/t3-composer-attachments/photo.png",
      previewUri: "file:///documents/t3-composer-attachments/photo.png",
    };
    appAtomRegistry.set(composerDraftsAtom, {
      "environment-1:thread-1": { text: "look at this", attachments: [image] },
    });

    await releaseUnusedComposerAttachmentFiles([image]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();

    // A queued outbox message must keep the bytes alive after the draft clears.
    appAtomRegistry.set(composerDraftsAtom, {});
    await outboxFixture().admit({
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make("queued-image"),
      commandId: CommandId.make("command-image"),
      text: "look at this",
      attachments: [image],
      createdAt: "2026-08-31T12:00:00.000Z",
    });
    await releaseUnusedComposerAttachmentFiles([image]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();

    const record = threadOutboxManager.authority.knownRecords()[0];
    if (record === undefined) throw new Error("Expected outbox owner");
    const retired = await threadOutboxManager.authority.retire(record.storageIdentity, "discarded");
    if (retired === null) throw new Error("Expected retirement");
    await threadOutboxManager.authority.releaseRetained(retired, () => true);
    await releaseUnusedComposerAttachmentFiles([image]);
    expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledExactlyOnceWith(image.fileUri);
  });

  it("keeps an image through an inline read after its draft is removed", async () => {
    const { prepareTurnAttachments } =
      await vi.importActual<typeof import("../lib/attachmentUpload")>("../lib/attachmentUpload");
    const image = {
      id: "image-reading",
      type: "image" as const,
      name: "photo.png",
      mimeType: "image/png",
      sizeBytes: 3,
      fileUri: "file:///documents/t3-composer-attachments/photo.png",
      previewUri: "file:///documents/t3-composer-attachments/photo.png",
    };
    const readStarted = Promise.withResolvers<void>();
    const read = Promise.withResolvers<void>();
    const removed = Promise.withResolvers<void>();
    let imageExists = true;
    composerDraftFileMocks.readImage.mockImplementation(async () => {
      readStarted.resolve();
      await read.promise;
      if (!imageExists) throw new Error("The image was deleted during its read");
      return "YWJj";
    });
    composerAttachmentCleanupMocks.remove.mockImplementationOnce(async () => {
      imageExists = false;
      removed.resolve();
    });
    appendComposerDraftAttachments("environment-1:thread-1", [image]);
    await flushComposerDrafts();
    const preparing = prepareTurnAttachments({
      environmentId: EnvironmentId.make("environment-1"),
      attachments: [image],
    });
    onTestFinished(async () => {
      read.resolve();
      await preparing.catch(() => undefined);
    });
    await readStarted.promise;
    clearComposerDraftContent("environment-1:thread-1", { deferAttachmentCleanup: true });
    await releaseUnusedComposerAttachmentFiles([image]);
    expect(imageExists).toBe(true);

    read.resolve();
    const prepared = await preparing;
    expect(prepared.status).toBe("ready");
    if (prepared.status !== "ready") return;
    expect(prepared.attachments).toEqual([
      {
        type: "image",
        name: "photo.png",
        mimeType: "image/png",
        sizeBytes: 3,
        dataUrl: "data:image/png;base64,YWJj",
      },
    ]);
    await removed.promise;
    expect(imageExists).toBe(false);
  });

  it("keeps a failed-send draft's pending upload for retry", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const file = {
      id: "file-failed-send",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/failed-send.pdf",
      uploadedAttachmentId: "pending-failed-send",
      uploadEnvironmentId: EnvironmentId.make("environment-1"),
    };
    appAtomRegistry.set(composerDraftsAtom, {
      "environment-1:thread-1": { text: "Retry this send", attachments: [file] },
    });

    await releaseUnusedComposerAttachmentFiles([file]);

    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
    expect(composerAttachmentCleanupMocks.releaseUploads).not.toHaveBeenCalled();
  });

  it("retains offline image bytes and newer edits when an early upload finishes", async () => {
    const key = "environment-1:thread-1";
    const image = {
      id: "photo",
      type: "image" as const,
      name: "photo.png",
      mimeType: "image/png",
      sizeBytes: 3,
      dataUrl: "data:image/png;base64,YWJj",
      previewUri: "file:///photo.png",
    };
    const second = { ...image, id: "second", name: "second.png" };
    const uploaded = {
      ...image,
      uploadedAttachmentId: "pending-photo",
      uploadEnvironmentId: EnvironmentId.make("environment-1"),
    };
    composerDraftFileMocks.setDocument({ schemaVersion: 1, drafts: {} });
    appendComposerDraftAttachments(key, [image]);
    setComposerDraftText(key, "Edited while uploading");
    appendComposerDraftAttachments(key, [second]);
    expect(setComposerDraftAttachmentUpload(key, uploaded)).toBe(true);
    await flushComposerDrafts();

    appAtomRegistry.set(composerDraftsAtom, {});
    resetComposerDraftsLoadState();
    await waitForComposerDraftsLoaded();
    expect(getComposerDraftSnapshot(key)).toMatchObject({
      text: "Edited while uploading",
      attachments: [uploaded, second],
    });
    expect(setComposerDraftAttachmentUpload(key, { ...uploaded, id: "removed-photo" })).toBe(false);
    expect(getComposerDraftSnapshot(key).attachments).toHaveLength(2);
  });

  it("cleans up an unreferenced image upload even when there is no local file URI", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const environmentId = EnvironmentId.make("environment-1");
    await releaseUnusedComposerAttachmentFiles([
      {
        id: "photo",
        type: "image",
        name: "photo.png",
        mimeType: "image/png",
        sizeBytes: 3,
        dataUrl: "data:image/png;base64,YWJj",
        previewUri: "file:///photo.png",
        uploadedAttachmentId: "pending-photo",
        uploadEnvironmentId: environmentId,
      },
    ]);
    expect(composerAttachmentCleanupMocks.releaseUploads).toHaveBeenCalledWith(environmentId, [
      "pending-photo",
    ]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
  });

  it.each(["file", "image"] as const)(
    "keeps signed-out %s attachments through cleanup and restart, and restores only the owning account",
    async (type) => {
      const load = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
      onTestFinished(() => load.mockRestore());
      await waitForComposerDraftsLoaded();
      const environmentId = EnvironmentId.make("cloud-environment");
      const key = `${environmentId}:thread-1`;
      const name = type === "image" ? "notes.png" : "notes.pdf";
      const metadata = {
        id: "local-notes",
        name,
        mimeType: type === "image" ? "image/png" : "application/pdf",
        sizeBytes: 42,
        fileUri: `file:///documents/t3-composer-attachments/${name}`,
        uploadEnvironmentId: environmentId,
        uploadedAttachmentId: "pending-notes",
      };
      const file =
        type === "image"
          ? { ...metadata, type, previewUri: metadata.fileUri }
          : { ...metadata, type };
      const queued = {
        environmentId,
        threadId: ThreadId.make("thread-2"),
        messageId: MessageId.make("queued-1"),
        commandId: CommandId.make("command-1"),
        text: "Send later",
        attachments: [file],
        createdAt: "2026-08-31T12:00:00.000Z",
      };
      appAtomRegistry.set(composerDraftsAtom, {
        [key]: { text: "Unsent notes", attachments: [file] },
        "direct-environment:thread-1": DRAFT,
        "pending-task:queued-1": { text: "Edited queued task", attachments: [file] },
      });
      threadOutboxManager.setAccountId("account-a");
      const queuedRow = await outboxFixture().admit(queued, "account-a");
      await archiveCloudComposerDrafts("account-a", new Set([environmentId]));
      expect(appAtomRegistry.get(composerDraftsAtom)).toEqual({
        "direct-environment:thread-1": DRAFT,
      });
      // The registry can remove the active outbox and drafts after the backup lands.
      appAtomRegistry.set(threadOutboxManager.queuedMessagesByThreadKeyAtom, {});
      await clearComposerDraftsEnvironment(environmentId);
      await releaseUnusedComposerAttachmentFiles([file]);
      expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
      expect(composerAttachmentCleanupMocks.releaseUploads).not.toHaveBeenCalled();

      appAtomRegistry.set(composerDraftsAtom, {});
      appAtomRegistry.set(composerCloudDraftsAtom, { accountId: null, signedOut: {} });
      resetComposerDraftsLoadState();
      await waitForComposerDraftsLoaded();
      await restoreCloudComposerDrafts("account-b");
      expect(getComposerDraftSnapshot(key).attachments).toEqual([]);
      expect(appAtomRegistry.get(threadOutboxManager.queuedMessagesByThreadKeyAtom)).toEqual({});
      const enqueue = vi.spyOn(threadOutboxManager.authority, "reconcileArchived");
      onTestFinished(() => enqueue.mockRestore());
      await restoreCloudComposerDrafts("account-a");
      expect(getComposerDraftSnapshot(key)).toEqual({
        text: "Unsent notes",
        attachments: [file],
      });
      expect(getComposerDraftSnapshot("pending-task:queued-1").text).toBe("Edited queued task");
      expect(enqueue).toHaveBeenCalledExactlyOnceWith("account-a", queuedRow);
      expect(appAtomRegistry.get(composerCloudDraftsAtom).signedOut).toEqual({});
      const persisted = decodePersistedComposerState(
        JSON.parse(composerDraftFileMocks.getDocument()),
      );
      expect(persisted.drafts[key]?.attachments).toEqual([file]);
      expect(persisted.cloudDrafts.accountId).toBe("account-a");
    },
  );

  it("fails sign-out preservation before cleanup if a durable backup cannot be written", async () => {
    const load = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => load.mockRestore());
    await waitForComposerDraftsLoaded();
    appAtomRegistry.set(composerDraftsAtom, { "environment-1:thread-1": DRAFT });
    composerDraftFileMocks.setWriteError(new Error("Storage is full"));
    await expect(
      archiveCloudComposerDrafts("account-a", new Set([EnvironmentId.make("environment-1")])),
    ).rejects.toThrow();
    expect(
      appAtomRegistry.get(composerCloudDraftsAtom).signedOut["account-a"]?.drafts[
        "environment-1:thread-1"
      ],
    ).toEqual(DRAFT);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
    composerDraftFileMocks.setWriteError(null);
    await archiveCloudComposerDrafts(null, new Set([EnvironmentId.make("environment-1")]));
    expect(
      decodePersistedComposerState(JSON.parse(composerDraftFileMocks.getDocument())).cloudDrafts
        .signedOut["account-a"]?.drafts["environment-1:thread-1"],
    ).toEqual(DRAFT);
  });

  it.each(["file", "image"] as const)(
    "keeps a removed %s until both preview and a share copy finish",
    async (type) => {
      const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
      onTestFinished(() => outboxLoad.mockRestore());
      const name = type === "image" ? "photo.png" : "recording.mp4";
      const fileName = `33333333-3333-4333-8333-333333333333-${name}`;
      const metadata = {
        id: "file-preview",
        name,
        mimeType: type === "image" ? "image/png" : "video/mp4",
        sizeBytes: 42,
        fileUri: `file:///private/var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Documents/t3-composer-attachments/${fileName}`,
      };
      const file =
        type === "image"
          ? { ...metadata, type, previewUri: metadata.fileUri }
          : { ...metadata, type };
      const currentFile = {
        ...file,
        fileUri: `file:///var/mobile/Containers/Data/Application/22222222-2222-4222-8222-222222222222/Documents/t3-composer-attachments/${fileName}`,
      };
      const releasePlayback = retainComposerAttachmentFileForPreview(file);
      const releaseShareCopy = retainComposerAttachmentFileForPreview(currentFile);
      onTestFinished(releasePlayback);
      onTestFinished(releaseShareCopy);

      await releaseUnusedComposerAttachmentFiles([currentFile]);
      expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();

      releasePlayback();
      releasePlayback();
      await releaseUnusedComposerAttachmentFiles([file]);
      expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();

      const deleted = Promise.withResolvers<void>();
      composerAttachmentCleanupMocks.remove.mockImplementationOnce(async () => {
        deleted.resolve();
        return undefined;
      });
      releaseShareCopy();
      await deleted.promise;

      expect(composerAttachmentCleanupMocks.remove.mock.calls).toEqual([[currentFile.fileUri]]);
    },
  );

  it("preserves a preview opened while cleanup is checking the incoming inbox", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const file = {
      id: "file-opening-preview",
      type: "file" as const,
      name: "recording.mp4",
      mimeType: "video/mp4",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/recording.mp4",
    };
    const ownershipReadStarted = Promise.withResolvers<void>();
    const ownershipRead = Promise.withResolvers<[]>();
    incomingShareStorageMocks.load.mockImplementationOnce(() => {
      ownershipReadStarted.resolve();
      return ownershipRead.promise;
    });

    const cleanup = releaseUnusedComposerAttachmentFiles([file]);
    await ownershipReadStarted.promise;
    const release = retainComposerAttachmentFileForPreview(file);
    onTestFinished(release);
    ownershipRead.resolve([]);
    await cleanup;
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();

    const deleted = Promise.withResolvers<void>();
    composerAttachmentCleanupMocks.remove.mockImplementationOnce(async () => {
      deleted.resolve();
      return undefined;
    });
    release();
    await deleted.promise;
    expect(composerAttachmentCleanupMocks.remove.mock.calls).toEqual([[file.fileUri]]);
  });

  it("removes an unreferenced local file and its pending upload", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const environmentId = EnvironmentId.make("environment-1");
    const file = {
      id: "file-discarded",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/discarded.pdf",
      uploadedAttachmentId: "pending-discarded",
      uploadEnvironmentId: environmentId,
    };

    await releaseUnusedComposerAttachmentFiles([file]);

    expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledWith(file.fileUri);
    expect(composerAttachmentCleanupMocks.releaseUploads).toHaveBeenCalledWith(environmentId, [
      "pending-discarded",
    ]);
  });

  it("keeps a pending upload referenced through another local file", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const environmentId = EnvironmentId.make("environment-1");
    const discarded = {
      id: "file-discarded-copy",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/discarded-copy.pdf",
      uploadedAttachmentId: "pending-shared",
      uploadEnvironmentId: environmentId,
    };
    const retained = {
      ...discarded,
      id: "file-retained-copy",
      fileUri: "file:///documents/t3-composer-attachments/retained-copy.pdf",
    };
    appAtomRegistry.set(composerDraftsAtom, {
      "environment-1:thread-1": { text: "Keep this copy", attachments: [retained] },
    });

    await releaseUnusedComposerAttachmentFiles([discarded]);

    expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledWith(discarded.fileUri);
    expect(composerAttachmentCleanupMocks.releaseUploads).not.toHaveBeenCalled();
  });

  it("completes local cleanup when pending upload deletion fails", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    onTestFinished(() => warning.mockRestore());
    composerAttachmentCleanupMocks.releaseUploads.mockRejectedValueOnce(
      new Error("environment disconnected"),
    );
    const file = {
      id: "file-delete-failed",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/delete-failed.pdf",
      uploadedAttachmentId: "pending-delete-failed",
      uploadEnvironmentId: EnvironmentId.make("environment-1"),
    };

    await expect(releaseUnusedComposerAttachmentFiles([file])).resolves.toBeUndefined();

    expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledWith(file.fileUri);
    expect(warning).toHaveBeenCalledWith(
      "[composer-attachments] could not remove pending upload",
      expect.objectContaining({ attachmentId: "pending-delete-failed" }),
    );
  });

  it("keeps local attachment files while an outbox message still needs them", async () => {
    const file = {
      id: "file-queued",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/report.pdf",
    };
    await outboxFixture().admit({
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make("message-1"),
      commandId: CommandId.make("command-1"),
      text: "Review the report",
      attachments: [file],
      createdAt: "2026-08-24T12:00:00.000Z",
    });

    await releaseUnusedComposerAttachmentFiles([file]);

    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
  });

  it("loads persisted outbox messages before deciding an attachment file is unused", async () => {
    const file = {
      id: "file-persisted",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/report.pdf",
    };
    const load = vi.spyOn(threadOutboxManager, "load").mockImplementation(async () => {
      await outboxFixture().admit({
        environmentId: EnvironmentId.make("environment-1"),
        threadId: ThreadId.make("thread-1"),
        messageId: MessageId.make("message-persisted"),
        commandId: CommandId.make("command-persisted"),
        text: "Review the report",
        attachments: [file],
        createdAt: "2026-08-24T12:00:00.000Z",
      });
      return true;
    });

    try {
      await releaseUnusedComposerAttachmentFiles([file]);

      expect(load).toHaveBeenCalledOnce();
      expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
    } finally {
      load.mockRestore();
    }
  });

  it("keeps a file until its incoming share is consumed", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const file = {
      id: "file-incoming",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/incoming.pdf",
    };
    incomingShareStorageMocks.load
      .mockResolvedValueOnce([
        {
          schemaVersion: 1,
          id: "share-1",
          createdAt: "2026-08-28T12:00:00.000Z",
          text: "Review this file",
          attachments: [file],
          warnings: [],
        },
      ])
      .mockResolvedValueOnce([]);

    await releaseUnusedComposerAttachmentFiles([file]);

    expect(incomingShareStorageMocks.load).toHaveBeenLastCalledWith({ strict: true });
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();

    await releaseUnusedComposerAttachmentFiles([file]);

    expect(incomingShareStorageMocks.load).toHaveBeenCalledTimes(2);
    expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledWith(file.fileUri);
  });

  it("does not delete files when incoming share ownership cannot be loaded", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const file = {
      id: "file-incoming-unknown",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/incoming-unknown.pdf",
    };
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    incomingShareStorageMocks.load.mockRejectedValueOnce(new Error("inbox unavailable"));
    onTestFinished(() => warning.mockRestore());

    await releaseUnusedComposerAttachmentFiles([file]);

    expect(incomingShareStorageMocks.load).toHaveBeenCalledWith({ strict: true });
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
  });

  it.each(["draft", "outbox", "inbox"] as const)(
    "preserves relocated files still referenced by a persisted %s",
    async (owner) => {
      const fileName = "33333333-3333-4333-8333-333333333333-report.pdf";
      const oldFile = {
        id: "file-relocated",
        type: "file" as const,
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 42,
        fileUri: `file:///private/var/mobile/Containers/Data/Application/11111111-1111-4111-8111-111111111111/Documents/t3-composer-attachments/${fileName}`,
      };
      const currentFile = {
        ...oldFile,
        fileUri: `file:///var/mobile/Containers/Data/Application/22222222-2222-4222-8222-222222222222/Documents/t3-composer-attachments/${fileName}`,
      };
      const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
      onTestFinished(() => outboxLoad.mockRestore());
      if (owner === "draft") {
        composerDraftFileMocks.setDocument({
          schemaVersion: 1,
          drafts: { "environment-1:thread-1": { text: "Saved draft", attachments: [oldFile] } },
        });
        resetComposerDraftsLoadState();
      } else if (owner === "outbox") {
        outboxLoad.mockImplementation(async () => {
          await outboxFixture().admit({
            environmentId: EnvironmentId.make("environment-1"),
            threadId: ThreadId.make("thread-1"),
            messageId: MessageId.make("message-relocated"),
            commandId: CommandId.make("command-relocated"),
            text: "Queued draft",
            attachments: [oldFile],
            createdAt: "2026-08-28T12:00:00.000Z",
          });
          return true;
        });
      } else {
        incomingShareStorageMocks.load.mockResolvedValue([
          {
            schemaVersion: 1,
            id: "share-relocated",
            createdAt: "2026-08-28T12:00:00.000Z",
            text: "Incoming file",
            attachments: [oldFile],
            warnings: [],
          },
        ]);
      }

      await releaseUnusedComposerAttachmentFiles([currentFile]);

      expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();

      appAtomRegistry.set(composerDraftsAtom, {});
      appAtomRegistry.set(threadOutboxManager.queuedMessagesByThreadKeyAtom, {});
      outboxLoad.mockResolvedValue(true);
      for (const record of threadOutboxManager.authority.knownRecords()) {
        const retired = await threadOutboxManager.authority.retire(
          record.storageIdentity,
          "discarded",
        );
        if (retired) await threadOutboxManager.authority.releaseRetained(retired, () => true);
      }
      incomingShareStorageMocks.load.mockResolvedValue([]);
      await releaseUnusedComposerAttachmentFiles([currentFile]);

      expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledWith(currentFile.fileUri);
    },
  );

  it("does not delete attachment files when the draft removal cannot be saved", async () => {
    const file = {
      id: "file-unsaved",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/report.pdf",
    };
    setComposerDraftText("environment-1:thread-1", "Unsaved draft");
    composerDraftFileMocks.setWriteError(new Error("storage unavailable"));

    try {
      await expect(releaseUnusedComposerAttachmentFiles([file])).rejects.toBeInstanceOf(
        ComposerDraftPersistenceError,
      );
      expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
    } finally {
      composerDraftFileMocks.setWriteError(null);
    }
  });

  it("rejects persisted images without image bytes or a file URI", () => {
    expect(() =>
      decodePersistedComposerState({
        schemaVersion: 1,
        drafts: {
          "environment-1:thread-1": {
            text: "Saved image",
            attachments: [
              {
                id: "image-1",
                type: "image",
                name: "photo.png",
                mimeType: "image/png",
                sizeBytes: 3,
                previewUri: "file:///photo.png",
              },
            ],
          },
        },
      }),
    ).toThrow();
  });

  it("hydrates selector state even when the message content is empty", () => {
    const hydrated = Object.entries(
      decodePersistedComposerState({
        schemaVersion: 1,
        drafts: {
          "new-task:environment-1:project-1": {
            text: "",
            attachments: [],
            modelSelection: {
              instanceId: "codex",
              model: "gpt-5.4",
              options: [{ id: "reasoningEffort", value: "xhigh" }],
            },
            runtimeMode: "approval-required",
            interactionMode: "plan",
            workspaceSelection: {
              mode: "worktree",
              branch: "main",
              worktreePath: null,
            },
          },
        },
      }).drafts,
    );
    expect(hydrated).toHaveLength(1);
    const [key, draft] = hydrated[0]!;
    // Legacy project keys are rewritten to id keys on load.
    expect(key).toMatch(/^new-task:[0-9a-z-]+$/);
    expect(draft).toEqual({
      text: "",
      attachments: [],
      modelSelection: {
        instanceId: "codex",
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "xhigh" }],
      },
      runtimeMode: "approval-required",
      interactionMode: "plan",
      workspaceSelection: {
        mode: "worktree",
        branch: "main",
        worktreePath: null,
      },
      project: {
        environmentId: "environment-1",
        projectId: "project-1",
        createdAt: expect.any(String),
      },
    });
  });
  it("keeps legacy content-only drafts and rejects invalid selector state", () => {
    expect(
      decodePersistedComposerState({
        schemaVersion: 1,
        drafts: {
          "environment-1:thread-1": DRAFT,
        },
      }).drafts,
    ).toEqual({
      "environment-1:thread-1": DRAFT,
    });

    expect(() =>
      decodePersistedComposerState({
        schemaVersion: 1,
        drafts: {
          "environment-1:thread-1": {
            ...DRAFT,
            runtimeMode: "sometimes-safe",
          },
        },
      }),
    ).toThrow();
  });

  it("keeps share-import receipts on otherwise contentless new-task drafts", () => {
    const receiptDraft: ComposerDraft = {
      text: "",
      attachments: [],
      importedShareIds: ["share-1"],
    };
    // The stale-model strip must not touch receipt-bearing drafts, and the
    // empty filter must keep them — or the same share would re-import after
    // restart.
    const stripped = Object.values(
      decodePersistedComposerState({
        schemaVersion: 1,
        drafts: {
          "new-task:environment-1:project-1": {
            ...receiptDraft,
            modelSelection: {
              instanceId: "codex",
              model: "gpt-5.4",
            },
          },
        },
      }).drafts,
    );
    expect(stripped).toHaveLength(1);
    expect(stripped[0]).toMatchObject({
      text: "",
      attachments: [],
      importedShareIds: ["share-1"],
      project: { environmentId: "environment-1", projectId: "project-1" },
    });
    expect(stripped[0]?.modelSelection).toBeUndefined();

    const kept = Object.values(
      decodePersistedComposerState({
        schemaVersion: 1,
        drafts: { "new-task:environment-1:project-1": receiptDraft },
      }).drafts,
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject(receiptDraft);
  });

  it("migrates archived signed-out new-task drafts the same way as live ones", () => {
    const decoded = decodePersistedComposerState({
      schemaVersion: 1,
      drafts: {},
      cloudAccountId: "account-1",
      signedOutDrafts: {
        "account-1": {
          drafts: { "new-task:environment-1:project-1": { text: "archived", attachments: [] } },
          queuedMessages: [],
        },
      },
    });
    const archived = Object.entries(decoded.cloudDrafts.signedOut["account-1"]?.drafts ?? {});
    expect(archived).toHaveLength(1);
    expect(archived[0]?.[0]).toMatch(/^new-task:[0-9a-z]+-[0-9a-z]+$/);
    expect(archived[0]?.[1]).toMatchObject({
      text: "archived",
      project: { environmentId: "environment-1", projectId: "project-1" },
    });
  });

  it("migrates project-keyed new-task drafts to id keys with the project stamped in", () => {
    const now = "2026-09-05T12:00:00.000Z";
    const [key, draft] = migrateLegacyNewTaskDraft(
      "new-task:environment-1:project-1",
      { text: "keep me", attachments: [] },
      now,
    );
    // The new key has no colon after the prefix, so it can never be
    // mistaken for the legacy shape on the next load.
    expect(key).toMatch(/^new-task:[0-9a-z-]+$/);
    expect(draft).toEqual({
      text: "keep me",
      attachments: [],
      project: {
        environmentId: EnvironmentId.make("environment-1"),
        projectId: ProjectId.make("project-1"),
        createdAt: now,
      },
    });

    // Already-migrated, thread, and pending-task keys pass through untouched.
    const stamped: ComposerDraft = {
      text: "x",
      attachments: [],
      project: {
        environmentId: EnvironmentId.make("environment-1"),
        projectId: ProjectId.make("project-1"),
        createdAt: now,
      },
    };
    expect(migrateLegacyNewTaskDraft("new-task:some-id", stamped, now)).toEqual([
      "new-task:some-id",
      stamped,
    ]);
    expect(migrateLegacyNewTaskDraft("environment-1:thread-1", DRAFT, now)).toEqual([
      "environment-1:thread-1",
      DRAFT,
    ]);
    expect(migrateLegacyNewTaskDraft("pending-task:message-1", DRAFT, now)).toEqual([
      "pending-task:message-1",
      DRAFT,
    ]);
  });

  it("keeps a freshly minted new-task draft bound until content arrives, then lists it per project", () => {
    const project = {
      environmentId: EnvironmentId.make("environment-1"),
      projectId: ProjectId.make("project-1"),
    };
    const first = createNewTaskDraft(project);
    const second = createNewTaskDraft(project);
    expect(first).not.toBe(second);
    // Empty stamped drafts stay in memory so the composer has a key to write
    // to, but the persisted document leaves them out.
    expect(appAtomRegistry.get(composerDraftsAtom)[first]?.project).toMatchObject(project);

    setComposerDraftText(first, "first idea");
    setComposerDraftText(second, "second idea");
    expect(findNewTaskDraftKeys(appAtomRegistry.get(composerDraftsAtom), project)).toEqual(
      expect.arrayContaining([first, second]),
    );

    // Clearing content on the way out drops the stamp with it.
    clearComposerDraftContent(first, { clearModelSelection: true, clearWorkspaceSelection: true });
    expect(appAtomRegistry.get(composerDraftsAtom)[first]).toBeUndefined();
    expect(getComposerDraftSnapshot(second).text).toBe("second idea");
  });

  it("retargets a new-task draft to another project without losing its text", () => {
    const from = {
      environmentId: EnvironmentId.make("environment-1"),
      projectId: ProjectId.make("project-1"),
    };
    const to = {
      environmentId: EnvironmentId.make("environment-2"),
      projectId: ProjectId.make("project-2"),
    };
    const key = createNewTaskDraft(from);
    setComposerDraftText(key, "moving house");
    appAtomRegistry.set(composerDraftsAtom, {
      ...appAtomRegistry.get(composerDraftsAtom),
      [key]: {
        ...getComposerDraftSnapshot(key),
        runtimeMode: "approval-required",
        workspaceSelection: { mode: "worktree", branch: "feature/a", worktreePath: null },
      },
    });
    const createdAt = getComposerDraftSnapshot(key).project?.createdAt;

    retargetNewTaskDraft(key, to);

    const moved = getComposerDraftSnapshot(key);
    expect(moved.text).toBe("moving house");
    expect(moved.runtimeMode).toBe("approval-required");
    // Branch and worktree belong to the old repo.
    expect(moved.workspaceSelection).toBeUndefined();
    expect(moved.project).toEqual({ ...to, createdAt });
    expect(findNewTaskDraftKeys(appAtomRegistry.get(composerDraftsAtom), from)).toEqual([]);
    expect(findNewTaskDraftKeys(appAtomRegistry.get(composerDraftsAtom), to)).toEqual([key]);
  });

  it("hydrates the global sticky model selection", () => {
    expect(
      decodePersistedComposerState({
        schemaVersion: 1,
        drafts: {},
        stickyModelSelection: {
          instanceId: "codex",
          model: "gpt-5.6-sol",
        },
      }).stickyModelSelection,
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.6-sol",
    });
  });

  it("waits for hydration before persisting the latest composer state", async () => {
    vi.useFakeTimers();
    composerDraftFileMocks.setDocument({
      schemaVersion: 1,
      drafts: {
        "environment-1:thread-1": DRAFT,
      },
      stickyModelSelection: {
        instanceId: "codex",
        model: "gpt-5.6-sol",
      },
    });
    composerDraftFileMocks.blockRead();
    composerDraftFileMocks.resetWrites();

    ensureComposerDraftsLoaded();
    await Promise.resolve();
    // The read is blocked, hydration is pending.
    setComposerDraftText("new-task:environment-1:project-1", "New prompt");
    await vi.advanceTimersByTimeAsync(200);

    // Write should still be deferred — hydration has not resolved.
    expect(composerDraftFileMocks.getWrites()).toHaveLength(0);

    composerDraftFileMocks.releaseRead();
    // Let the loadPromise settle and chain into the deferred persist.
    await vi.runAllTimersAsync();

    expect(JSON.parse(composerDraftFileMocks.getWrites()[0]!)).toEqual({
      schemaVersion: 2,
      drafts: {
        "environment-1:thread-1": DRAFT,
        "new-task:environment-1:project-1": {
          text: "New prompt",
          attachments: [],
        },
      },
      stickyModelSelection: {
        instanceId: "codex",
        model: "gpt-5.6-sol",
      },
    });
  });

  it.each([false, true])(
    "does not resurrect a cleared draft after hydration (retry: %s)",
    async (retry) => {
      vi.useFakeTimers();
      const key = "environment-1:thread-1";
      const otherKey = "environment-1:thread-2";
      composerDraftFileMocks.setDocument({
        schemaVersion: 1,
        drafts: { [key]: DRAFT, [otherKey]: DRAFT },
      });
      composerDraftFileMocks.blockRead();
      onTestFinished(() => composerDraftFileMocks.releaseRead());
      ensureComposerDraftsLoaded();
      setComposerDraftText(key, "Temporary edit");
      clearComposerDraftContent(key, { deferAttachmentCleanup: true });

      composerDraftFileMocks.releaseRead();
      if (retry) {
        composerDraftFileMocks.setReadError(new Error("read failed"));
        await expect(waitForComposerDraftsLoaded()).rejects.toBeInstanceOf(
          ComposerDraftPersistenceError,
        );
        composerDraftFileMocks.setReadError(null);
      }
      await flushComposerDrafts();

      expect(getComposerDraftSnapshot(key).text).toBe("");
      expect(getComposerDraftSnapshot(otherKey)).toEqual(DRAFT);
      expect(JSON.parse(composerDraftFileMocks.getDocument()).drafts).toEqual({
        [otherKey]: DRAFT,
      });
    },
  );

  it("flush waits for pending hydration instead of clobbering disk", async () => {
    vi.useFakeTimers();
    composerDraftFileMocks.setDocument({
      schemaVersion: 1,
      drafts: {
        "environment-1:thread-1": DRAFT,
      },
      stickyModelSelection: {
        instanceId: "codex",
        model: "gpt-5.6-sol",
      },
    });
    composerDraftFileMocks.blockRead();
    composerDraftFileMocks.resetWrites();

    ensureComposerDraftsLoaded();
    await Promise.resolve();
    // An edit lands before hydration finishes; its debounced write is gated
    // behind the blocked read.
    setComposerDraftText("new-task:environment-1:project-1", "New prompt");

    const flush = flushComposerDrafts();
    await vi.advanceTimersByTimeAsync(200);
    // The flush must not have written the pre-hydration snapshot over disk.
    expect(composerDraftFileMocks.getWrites()).toHaveLength(0);

    composerDraftFileMocks.releaseRead();
    await flush;

    const written = JSON.parse(composerDraftFileMocks.getDocument());
    expect(written.drafts["environment-1:thread-1"]).toEqual(DRAFT);
    expect(written.drafts["new-task:environment-1:project-1"]).toEqual({
      text: "New prompt",
      attachments: [],
    });
    expect(written.stickyModelSelection).toEqual({
      instanceId: "codex",
      model: "gpt-5.6-sol",
    });
  });

  it.each(["read", "decode"] as const)(
    "preserves saved drafts and attachment files when the draft %s fails",
    async (failure) => {
      vi.useFakeTimers();
      const file = {
        id: "saved-file",
        type: "file" as const,
        name: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 42,
        fileUri: "file:///documents/t3-composer-attachments/report.pdf",
      };
      composerDraftFileMocks.setDocument({
        schemaVersion: failure === "decode" ? 999 : 1,
        drafts: { "environment-1:saved": { text: "Saved draft", attachments: [file] } },
      });
      const original = composerDraftFileMocks.getDocument();
      if (failure === "read") {
        composerDraftFileMocks.setReadError(new Error("storage unavailable"));
      }

      await expect(releaseUnusedComposerAttachmentFiles([file])).rejects.toMatchObject({
        operation: failure,
      });
      setComposerDraftText("environment-1:new", "Keep my new edits too");
      await expect(flushComposerDrafts()).rejects.toMatchObject({ operation: failure });

      expect(composerDraftFileMocks.getDocument()).toBe(original);
      expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
    },
  );

  it("retries a failed debounced read on final flush without dropping saved drafts or new edits", async () => {
    vi.useFakeTimers();
    composerDraftFileMocks.setDocument({
      schemaVersion: 1,
      drafts: { "environment-1:saved": DRAFT },
    });
    const original = composerDraftFileMocks.getDocument();
    composerDraftFileMocks.setReadError(new Error("storage unavailable"));
    setComposerDraftText("environment-1:new", "New edits");
    await vi.advanceTimersByTimeAsync(200);
    expect(composerDraftFileMocks.getDocument()).toBe(original);

    composerDraftFileMocks.setReadError(null);
    await flushComposerDrafts();

    expect(JSON.parse(composerDraftFileMocks.getDocument()).drafts).toEqual({
      "environment-1:saved": DRAFT,
      "environment-1:new": { text: "New edits", attachments: [] },
    });
  });

  it("serializes environment cleanup after an older queued write", async () => {
    vi.useFakeTimers();
    composerDraftFileMocks.setDocument({ schemaVersion: 1, drafts: {} });
    composerDraftFileMocks.resetWrites();
    let releaseFirstWrite!: () => void;
    const firstWriteBarrier = new Promise<void>((resolve) => {
      releaseFirstWrite = resolve;
    });
    composerDraftFileMocks.setNextWriteBarrier(firstWriteBarrier);
    let writeCount = 0;
    const bothWritesCommitted = new Promise<void>((resolve) => {
      composerDraftFileMocks.setOnWrite(() => {
        writeCount += 1;
        if (writeCount === 2) {
          resolve();
        }
      });
    });

    appAtomRegistry.set(composerDraftsAtom, {
      "environment-1:thread-1": DRAFT,
      "environment-2:thread-2": { text: "keep", attachments: [] },
    });
    setStickyComposerModelSelection({
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
    });
    await vi.advanceTimersByTimeAsync(200);

    const clear = clearComposerDraftsEnvironment(EnvironmentId.make("environment-1"));
    await Promise.resolve();
    // Cleanup write is queued behind the still-blocked debounced write.
    expect(composerDraftFileMocks.getWrites()).toHaveLength(0);

    releaseFirstWrite();
    await clear;
    await bothWritesCommitted;

    expect(JSON.parse(composerDraftFileMocks.getDocument())).toEqual({
      schemaVersion: 2,
      drafts: {
        "environment-2:thread-2": { text: "keep", attachments: [] },
      },
      stickyModelSelection: {
        instanceId: "codex",
        model: "gpt-5.6-sol",
      },
    });
  });

  it("clears sent content without clearing the selected model or workspace", () => {
    const draftKey = "environment-1:thread-1";
    const draft: ComposerDraft = {
      text: "send this",
      attachments: [],
      importedShareIds: ["share-1"],
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "xhigh" }],
      },
      workspaceSelection: {
        mode: "worktree",
        branch: "main",
        worktreePath: null,
      },
    };

    expect(clearComposerDraftContentState({ [draftKey]: draft }, draftKey)).toEqual({
      [draftKey]: {
        modelSelection: draft.modelSelection,
        workspaceSelection: draft.workspaceSelection,
        text: "",
        attachments: [],
      },
    });
  });

  it("drops draft-local model and workspace selections after sending a new task", () => {
    const draftKey = "new-task:environment-1:project-1";
    const draft: ComposerDraft = {
      text: "send this",
      attachments: [],
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
      },
      workspaceSelection: {
        mode: "worktree",
        branch: "main",
        worktreePath: null,
        startFromOrigin: false,
      },
    };

    expect(
      clearComposerDraftContentState({ [draftKey]: draft }, draftKey, {
        clearModelSelection: true,
        clearWorkspaceSelection: true,
      }),
    ).toEqual({});
  });

  it("reads the latest selector state synchronously for send", () => {
    const draftKey = "environment-1:thread-1";
    const selectedDraft: ComposerDraft = {
      text: "send this",
      attachments: [],
      modelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "gpt-5.4",
        options: [{ id: "reasoningEffort", value: "xhigh" }],
      },
    };
    appAtomRegistry.set(composerDraftsAtom, { [draftKey]: selectedDraft });

    expect(getComposerDraftSnapshot(draftKey)).toEqual(selectedDraft);
  });

  it("drops another environment's upload stamp when a draft moves across machines", () => {
    const uploadedElsewhere: DraftComposerAttachment = {
      id: "image-1",
      type: "image",
      name: "screen.png",
      mimeType: "image/png",
      sizeBytes: 1,
      previewUri: "file:///drafts/screen.png",
      fileUri: "file:///drafts/screen.png",
      uploadedAttachmentId: "upload-1",
      uploadEnvironmentId: EnvironmentId.make("environment-1"),
    };
    const uploadedOnTarget: DraftComposerAttachment = {
      ...uploadedElsewhere,
      id: "image-2",
      uploadedAttachmentId: "upload-2",
      uploadEnvironmentId: EnvironmentId.make("environment-2"),
    };
    const key = createNewTaskDraft({
      environmentId: EnvironmentId.make("environment-1"),
      projectId: ProjectId.make("project-1"),
    });
    appAtomRegistry.set(composerDraftsAtom, {
      ...appAtomRegistry.get(composerDraftsAtom),
      [key]: {
        ...getComposerDraftSnapshot(key),
        text: "Ship it",
        attachments: [uploadedElsewhere, uploadedOnTarget],
      },
    });

    retargetNewTaskDraft(key, {
      environmentId: EnvironmentId.make("environment-2"),
      projectId: ProjectId.make("project-2"),
    });

    expect(getComposerDraftSnapshot(key).attachments).toEqual([
      {
        id: "image-1",
        type: "image",
        name: "screen.png",
        mimeType: "image/png",
        sizeBytes: 1,
        previewUri: "file:///drafts/screen.png",
        fileUri: "file:///drafts/screen.png",
      },
      uploadedOnTarget,
    ]);
  });

  it("merges shared content into a project draft without duplicating retries", () => {
    const draftKey = "new-task:environment-1:project-1";
    const sharedAttachment = {
      id: "share-1:image:0",
      type: "image" as const,
      name: "Screenshot.png",
      mimeType: "image/png",
      sizeBytes: 3,
      dataUrl: "data:image/png;base64,YWJj",
      previewUri: "data:image/png;base64,YWJj",
    };
    const existing: Record<string, ComposerDraft> = {
      [draftKey]: { text: "Existing context", attachments: [] },
    };
    const content = {
      text: "Shared note",
      attachments: [sharedAttachment],
      sourceShareId: "share-1",
    };

    const merged = mergeComposerDraftContentState(existing, draftKey, content);
    expect(merged[draftKey]).toMatchObject({
      text: "Existing context\n\nShared note",
      attachments: [sharedAttachment],
      importedShareIds: ["share-1"],
    });
    expect(mergeComposerDraftContentState(merged, draftKey, content)).toBe(merged);

    const edited = {
      ...merged,
      [draftKey]: { ...merged[draftKey]!, text: "User edited the imported context" },
    };
    expect(mergeComposerDraftContentState(edited, draftKey, content)).toBe(edited);
  });

  it("preserves existing images when shared content exceeds the draft attachment limit", () => {
    const draftKey = "new-task:environment-1:project-1";
    const image = (id: string) => ({
      id,
      type: "image" as const,
      name: `${id}.png`,
      mimeType: "image/png",
      sizeBytes: 3,
      dataUrl: "data:image/png;base64,YWJj",
      previewUri: "data:image/png;base64,YWJj",
    });
    const existingImage = image("existing");
    const sharedImages = Array.from({ length: 8 }, (_, index) => image(`shared-${index}`));

    const merged = mergeComposerDraftContentState(
      { [draftKey]: { text: "", attachments: [existingImage] } },
      draftKey,
      { text: "", attachments: sharedImages },
    );

    expect(merged[draftKey]?.attachments).toHaveLength(8);
    expect(merged[draftKey]?.attachments[0]).toEqual(existingImage);
    expect(merged[draftKey]?.attachments.at(-1)?.id).toBe("shared-6");
  });

  it("restores the exact draft captured before an interrupted share import", () => {
    const draftKey = "new-task:environment-1:project-1";
    const beforeImport: ComposerDraft = {
      text: "Existing context",
      attachments: [],
      runtimeMode: "approval-required",
    };
    const imported: ComposerDraft = {
      ...beforeImport,
      text: "Existing context\n\nShared note",
      importedShareIds: ["share-1"],
    };

    expect(
      restoreComposerDraftSnapshotState({ [draftKey]: imported }, draftKey, beforeImport),
    ).toEqual({ [draftKey]: beforeImport });
    expect(
      restoreComposerDraftSnapshotState({ [draftKey]: imported }, draftKey, {
        text: "",
        attachments: [],
      }),
    ).toEqual({});
  });

  it("removes only drafts owned by the selected environment", () => {
    const environmentId = EnvironmentId.make("environment-cloud");
    const retainedEnvironmentId = EnvironmentId.make("environment-local");

    const cloudDraft: ComposerDraft = {
      ...DRAFT,
      project: {
        environmentId,
        projectId: ProjectId.make("project-cloud"),
        createdAt: "2026-09-05T00:00:00.000Z",
      },
    };
    const localDraft: ComposerDraft = {
      ...DRAFT,
      project: {
        environmentId: retainedEnvironmentId,
        projectId: ProjectId.make("project-local"),
        createdAt: "2026-09-05T00:00:00.000Z",
      },
    };

    expect(
      removeComposerDraftsForEnvironment(
        {
          [`${environmentId}:thread-cloud`]: DRAFT,
          "new-task:cloud-draft": cloudDraft,
          [`${retainedEnvironmentId}:thread-local`]: DRAFT,
          "new-task:local-draft": localDraft,
        },
        environmentId,
      ),
    ).toEqual({
      [`${retainedEnvironmentId}:thread-local`]: DRAFT,
      "new-task:local-draft": localDraft,
    });
  });

  it("lands a still-debounced draft write when flushed", async () => {
    const draftKey = "environment-1:thread-1";
    setComposerDraftText(draftKey, "typed right before the restart");

    await flushComposerDrafts();

    expect(JSON.parse(composerDraftFileMocks.getDocument())).toMatchObject({
      drafts: { [draftKey]: { text: "typed right before the restart" } },
    });
  });

  it("propagates a flush write failure instead of resolving as saved", async () => {
    const draftKey = "environment-1:thread-1";
    setComposerDraftText(draftKey, "unsaved");
    composerDraftFileMocks.setWriteError(new Error("storage unavailable"));

    try {
      await expect(flushComposerDrafts()).rejects.toBeInstanceOf(ComposerDraftPersistenceError);
    } finally {
      composerDraftFileMocks.setWriteError(null);
    }
  });

  it("restores the pre-merge snapshot when the draft is untouched since the merge", () => {
    const draftKey = "environment-1:thread-1";
    const snapshot: ComposerDraft = { text: "typed before", attachments: [] };
    const merged: ComposerDraft = {
      text: "typed before\n\nqueued text",
      attachments: [],
      runtimeMode: "approval-required",
    };

    expect(undoComposerDraftMergeState({ [draftKey]: merged }, draftKey, snapshot, merged)).toEqual(
      { [draftKey]: snapshot },
    );
    expect(
      undoComposerDraftMergeState(
        { [draftKey]: merged },
        draftKey,
        { text: "", attachments: [] },
        merged,
      ),
    ).toEqual({});
  });

  it("persists an async merge rollback with the sticky model selection", async () => {
    const draftKey = "environment-1:thread-1";
    const snapshot: ComposerDraft = { text: "typed before", attachments: [] };
    const merged: ComposerDraft = {
      text: "typed before\n\nqueued text",
      attachments: [],
    };
    composerDraftFileMocks.setDocument({
      schemaVersion: 1,
      drafts: { [draftKey]: merged },
      stickyModelSelection: {
        instanceId: "codex",
        model: "gpt-5.6-sol",
      },
    });

    await undoComposerDraftMerge(draftKey, snapshot, merged);

    expect(JSON.parse(composerDraftFileMocks.getDocument())).toEqual({
      schemaVersion: 2,
      drafts: { [draftKey]: snapshot },
      stickyModelSelection: {
        instanceId: "codex",
        model: "gpt-5.6-sol",
      },
    });
  });

  it("returns merge-written settings to the snapshot but keeps user-edited ones", () => {
    const draftKey = "environment-1:thread-1";
    const snapshot: ComposerDraft = {
      text: "typed before",
      attachments: [],
      runtimeMode: "approval-required",
      interactionMode: "default",
    };
    const merged: ComposerDraft = {
      text: "typed before\n\nqueued text",
      attachments: [],
      runtimeMode: "full-access",
      interactionMode: "default",
    };
    // The user edited the text (forcing the partial undo) and also switched
    // interaction mode, but never touched the merge-written runtime mode.
    const edited: ComposerDraft = {
      text: "typed EDITED before\n\nqueued text",
      attachments: [],
      runtimeMode: "full-access",
      interactionMode: "plan",
    };

    expect(undoComposerDraftMergeState({ [draftKey]: edited }, draftKey, snapshot, merged)).toEqual(
      {
        [draftKey]: {
          text: "typed EDITED before",
          attachments: [],
          runtimeMode: "approval-required",
          interactionMode: "plan",
        },
      },
    );
  });

  it("takes out only what the merge inserted when the user edited during it", () => {
    const draftKey = "environment-1:thread-1";
    const keptAttachment = {
      id: "kept",
      type: "file" as const,
      name: "kept.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      fileUri: "file:///documents/t3-composer-attachments/kept.pdf",
    };
    const insertedAttachment = {
      id: "inserted",
      type: "file" as const,
      name: "inserted.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      fileUri: "file:///documents/t3-composer-attachments/inserted.pdf",
    };
    const userAttachment = { ...keptAttachment, id: "user-added" };
    const snapshot: ComposerDraft = { text: "typed before", attachments: [keptAttachment] };
    const merged: ComposerDraft = {
      text: "typed before\n\nqueued text",
      attachments: [keptAttachment, insertedAttachment],
    };
    // The user rewrote the leading text and attached a file mid-recovery.
    const edited: ComposerDraft = {
      text: "typed EDITED before\n\nqueued text",
      attachments: [keptAttachment, insertedAttachment, userAttachment],
    };

    expect(undoComposerDraftMergeState({ [draftKey]: edited }, draftKey, snapshot, merged)).toEqual(
      {
        [draftKey]: {
          text: "typed EDITED before",
          attachments: [keptAttachment, userAttachment],
        },
      },
    );

    // Edits that broke the merged suffix keep their text untouched; only the
    // inserted attachments still come out.
    const rewritten: ComposerDraft = {
      text: "totally rewritten",
      attachments: [insertedAttachment],
    };
    expect(
      undoComposerDraftMergeState({ [draftKey]: rewritten }, draftKey, snapshot, merged),
    ).toEqual({
      [draftKey]: { text: "totally rewritten", attachments: [] },
    });
  });

  it("keeps text appended after a merge when rolling it back", () => {
    const draftKey = "environment-1:thread-1";
    const snapshot: ComposerDraft = { text: "typed before", attachments: [] };
    const content = { text: "queued text", attachments: [] };
    const merged = mergeComposerDraftContentState({ [draftKey]: snapshot }, draftKey, content)[
      draftKey
    ]!;
    const edited: ComposerDraft = {
      ...merged,
      text: `${merged.text}\n\nuser follow-up`,
    };

    const rolledBack = undoComposerDraftMergeState(
      { [draftKey]: edited },
      draftKey,
      snapshot,
      merged,
    );

    expect(rolledBack[draftKey]?.text).toBe("typed before\n\nuser follow-up");
    const retried = mergeComposerDraftContentState(rolledBack, draftKey, content);
    expect(retried[draftKey]?.text.match(/queued text/g)).toHaveLength(1);
  });

  it("spares a file re-owned between the sweep's scan and its deletion", async () => {
    const outboxLoad = vi.spyOn(threadOutboxManager, "load").mockResolvedValue(true);
    onTestFinished(() => outboxLoad.mockRestore());
    const fileFor = (id: string) => ({
      id,
      type: "file" as const,
      name: `${id}.pdf`,
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: `file:///documents/t3-composer-attachments/${id}.pdf`,
    });
    const first = fileFor("file-first");
    const reowned = fileFor("file-reowned");
    // A restore re-owns the second file while the first deletion is in
    // flight, after the sweep already decided both were unused.
    composerAttachmentCleanupMocks.remove.mockImplementationOnce(async () => {
      appAtomRegistry.set(composerDraftsAtom, {
        "environment-1:thread-1": { text: "restored", attachments: [reowned] },
      });
    });

    await releaseUnusedComposerAttachmentFiles([first, reowned]);

    expect(composerAttachmentCleanupMocks.remove.mock.calls).toEqual([[first.fileUri]]);
  });

  // These final tests use fresh module instances for independent hydration.
  it("keeps attachment files and uploads after a recovered message leaves an incomplete outbox", async () => {
    vi.resetModules();
    const drafts = await import("./use-composer-drafts");
    const { threadOutboxManager: manager } = await import("./thread-outbox");
    const { expoThreadOutboxStorage, ThreadOutboxStorageError } =
      await import("./thread-outbox-storage");
    const { removeThreadOutboxMessage } = await import("./thread-outbox-removal");
    const { appAtomRegistry: registry } = await import("./atom-registry");
    onTestFinished(() => registry.dispose());
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    onTestFinished(() => warning.mockRestore());
    const file = {
      id: "file-partial-outbox",
      type: "file" as const,
      name: "shared.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/shared.pdf",
      uploadEnvironmentId: EnvironmentId.make("environment-1"),
      uploadedAttachmentId: "pending-partial-outbox",
    };
    const readable = {
      environmentId: EnvironmentId.make("environment-1"),
      threadId: ThreadId.make("thread-1"),
      messageId: MessageId.make("message-readable"),
      commandId: CommandId.make("command-readable"),
      text: "Send the readable message",
      attachments: [file],
      createdAt: "2026-09-04T00:00:00.000Z",
    };
    const storage = outboxFixture().storage;
    const saved = outboxFixture().files;
    const recordOf = (message: QueuedThreadMessage) =>
      decodeThreadOutboxRecord({
        schemaVersion: 6,
        kind: "message",
        storageIdentity: {
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
        },
        transport: {
          environmentId: message.environmentId,
          threadId: message.threadId,
          messageId: message.messageId,
          commandId: message.commandId,
        },
        ownerAccountId: null,
        message,
        delivery: { state: "unknown" },
        original: { kind: "legacy-observed", localSnapshot: message },
      });
    const initial = recordOf(readable);
    saved.set(
      threadOutboxIdentity(initial.storageIdentity),
      JSON.stringify(encodeThreadOutboxRecord(initial)),
    );
    let unreadable = true;
    const baseLoad = storage.loadRecords;
    const load = vi.spyOn(storage, "loadRecords").mockImplementation(async () => ({
      ...(await baseLoad()),
      errors: unreadable
        ? [
            new ThreadOutboxStorageError({
              operation: "read-message",
              environmentId: null,
              threadId: null,
              messageId: null,
              fileName: "unreadable.json",
              cause: new Error("unreadable record"),
            }),
          ]
        : [],
    }));
    const scan = vi
      .spyOn(expoThreadOutboxStorage, "loadRecords")
      .mockImplementation(() => storage.loadRecords());
    onTestFinished(() => {
      load.mockRestore();
      scan.mockRestore();
    });
    await expect(manager.load()).resolves.toBe(false);
    const initialRecord = manager.recordAt(initial.storageIdentity);
    const initialRow = initialRecord === null ? null : manager.messageFor(initialRecord);
    if (initialRow === null) throw new Error("Expected readable retained content");
    expect(await manager.confirmQueued(initialRow)).toBe(initialRecord);
    await expect(removeThreadOutboxMessage(initialRow)).rejects.toMatchObject({
      reason: "inventory-incomplete",
    });
    await drafts.releaseUnusedComposerAttachmentFiles([file]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
    expect(composerAttachmentCleanupMocks.releaseUploads).not.toHaveBeenCalled();

    const recovered = {
      ...readable,
      environmentId: EnvironmentId.make("environment-2"),
      messageId: MessageId.make("message-recovered"),
      commandId: CommandId.make("command-recovered"),
    };
    const recoveredRecord = recordOf(recovered);
    saved.set(
      threadOutboxIdentity(recoveredRecord.storageIdentity),
      JSON.stringify(encodeThreadOutboxRecord(recoveredRecord)),
    );
    unreadable = false;
    await expect(manager.load()).resolves.toBe(true);
    await drafts.releaseUnusedComposerAttachmentFiles([file]);
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
    expect(composerAttachmentCleanupMocks.releaseUploads).not.toHaveBeenCalled();

    for (const record of manager.authority.knownRecords()) {
      const row = manager.messageFor(record);
      if (row === null) throw new Error("Expected current content");
      await removeThreadOutboxMessage(row);
    }
    await drafts.releaseUnusedComposerAttachmentFiles([file]);
    expect(composerAttachmentCleanupMocks.remove).toHaveBeenCalledWith(file.fileUri);
    expect(composerAttachmentCleanupMocks.releaseUploads).toHaveBeenCalledWith(
      file.uploadEnvironmentId,
      [file.uploadedAttachmentId],
    );
  });

  it("hydrates persisted drafts before a cold-start sweep deletes their files", async () => {
    const file = {
      id: "file-cold-start",
      type: "file" as const,
      name: "report.pdf",
      mimeType: "application/pdf",
      sizeBytes: 42,
      fileUri: "file:///documents/t3-composer-attachments/report.pdf",
    };
    composerDraftFileMocks.setDocument({
      schemaVersion: 1,
      drafts: {
        "environment-1:thread-1": { text: "Persisted draft", attachments: [file] },
      },
    });
    vi.resetModules();
    const fresh = await import("./use-composer-drafts");
    const freshRegistry = (await import("./atom-registry")).appAtomRegistry;

    await fresh.releaseUnusedComposerAttachmentFiles([file]);

    expect(freshRegistry.get(fresh.composerDraftsAtom)).toEqual({
      "environment-1:thread-1": {
        text: "Persisted draft [report.pdf](t3-context://v1/file/file-cold-start) ",
        attachments: [file],
        context: {
          version: 1,
          records: [
            {
              version: 1,
              contextId: file.id,
              kind: "file",
              label: file.name,
              attachmentId: file.id,
              name: file.name,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
            },
          ],
        },
      },
    });
    expect(composerAttachmentCleanupMocks.remove).not.toHaveBeenCalled();
  });
});
