import {
  CommandId,
  ComposerContextId,
  EnvironmentId,
  MessageId,
  ThreadId,
  makeWorkspaceTurnStartRefusalIdentity,
} from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/unstable/reactivity";
import { settlePromise } from "@t3tools/client-runtime/state/runtime";
import {
  finishRecoveredDraftSend,
  prepareRecoveredDraftSend,
  useComposerDraftStore,
  type RejectedTurnDraft,
} from "../composerDraftStore";
import {
  recoverRejectedTurn,
  recoveredTurnContextForSend,
  rejectedTurnMessage,
  type RecoveryAssetUrlCreator,
  type RejectedTurnSource,
} from "./recoverRejectedTurn";

const scope = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
};
const messageId = MessageId.make("message-1");
const imageId = "thread-1-00000000-0000-4000-8000-000000000001";
const fileId = "thread-1-00000000-0000-4000-8000-000000000002-pdf";
const imageContextId = ComposerContextId.make("image_original");
const refusalPayload = {
  version: 1,
  source: "workspace-ownership",
  requestId: messageId,
  reason: "owned",
  originCommandId: CommandId.make("original-command"),
  originSequence: 7,
};
function deferred<A>() {
  let complete: (value: A) => void;
  const promise = new Promise<A>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: (value: A) => complete(value) };
}
const sourceFixture = (): RejectedTurnSource => ({
  scope,
  synchronized: true,
  messages: [
    {
      id: messageId,
      role: "user",
      text: "Before [capture](t3-context://v1/image/image_original) after.",
      attachments: [
        { type: "file", id: fileId, name: "report.pdf", mimeType: "application/pdf", sizeBytes: 3 },
        { type: "image", id: imageId, name: "capture.png", mimeType: "image/png", sizeBytes: 3 },
      ],
      context: {
        version: 1,
        records: [
          {
            version: 1,
            contextId: ComposerContextId.make("preview_original"),
            kind: "preview-annotation",
            label: "Original annotation",
            annotationId: "original",
            pageUrl: "https://example.test/",
            pageTitle: "Example",
            comment: "Exact comment",
            targetSummary: "2 marked regions",
            styleChanges: [],
            regionCount: 2,
            strokeCount: 1,
            screenshotContextId: imageContextId,
          },
          {
            version: 1,
            contextId: imageContextId,
            kind: "image",
            label: "Original image label",
            attachmentId: imageId,
            name: "capture.png",
            mimeType: "image/png",
            sizeBytes: 3,
          },
          {
            version: 1,
            contextId: ComposerContextId.make("terminal_original"),
            kind: "terminal",
            label: "Exact terminal label",
            terminalId: "terminal-1",
            terminalLabel: "Terminal",
            lineStart: 1,
            lineEnd: 2,
            text: "first\nsecond",
          },
        ],
      },
      streaming: false,
      turnId: null,
      createdAt: "2026-10-03T00:00:00.000Z",
      updatedAt: "2026-10-03T00:00:00.000Z",
    },
  ],
  activities: [
    {
      id: makeWorkspaceTurnStartRefusalIdentity(scope.threadId, messageId).activityId,
      kind: "provider.turn.start.failed",
      tone: "error",
      summary: "Untrusted server summary",
      turnId: null,
      sequence: 9,
      createdAt: "2026-10-03T00:00:00.000Z",
      payload: refusalPayload,
    },
  ],
});

let source: RejectedTurnSource;
let ready: boolean;
const createAssetUrl = vi.fn<RecoveryAssetUrlCreator>();
const recover = () =>
  recoverRejectedTurn({
    scope,
    messageId,
    readSource: () => source,
    isComposerReady: () => ready,
    httpBaseUrl: "https://environment.test/",
    createAssetUrl,
  });

beforeEach(async () => {
  await useComposerDraftStore.persist.clearStorage();
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  await useComposerDraftStore.persist.rehydrate();
  source = sourceFixture();
  ready = true;
  createAssetUrl
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ relativeUrl: "/api/assets/signed", expiresAt: 100 }));
});
afterEach(async () => {
  await useComposerDraftStore.persist.clearStorage();
});

describe("recoverRejectedTurn", () => {
  it("retains the attempt fence when acceptance is followed by a lost response", async () => {
    await recover();
    const draft = useComposerDraftStore.getState().getComposerDraft(scope);
    if (!draft) throw new Error("Recovery did not produce a draft.");
    const sentId = MessageId.make("accepted-response-lost");
    const accepted: MessageId[] = [];
    const dispatch = vi.fn(async () => {
      accepted.push(sentId);
      throw new Error("Connection lost before acknowledgement");
    });
    const prepared = await prepareRecoveredDraftSend(scope, draft, sentId);
    const result = await settlePromise(dispatch);
    await finishRecoveredDraftSend(scope, prepared, result);
    await useComposerDraftStore.persist.rehydrate();
    const restored = useComposerDraftStore.getState().getComposerDraft(scope);
    if (!restored) throw new Error("Uncertain input was lost.");
    expect(restored.rejectedTurn?.sendAttempt).toBe(sentId);
    await expect(
      prepareRecoveredDraftSend(scope, restored, MessageId.make("must-not-dispatch")),
    ).rejects.toThrow();
    expect(accepted).toEqual([sentId]);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("does not dispatch again when accepted Send cleanup fails, including after hydration", async () => {
    await recover();
    const draft = useComposerDraftStore.getState().getComposerDraft(scope);
    if (!draft) throw new Error("Recovery did not produce a draft.");
    const dispatch = vi.fn(async () => "accepted");
    const sentId = MessageId.make("fresh-explicit-message");
    const prepared = await prepareRecoveredDraftSend(scope, draft, sentId);
    expect(prepared.rejectedTurn?.sendAttempt).toBe(sentId);
    expect(prepared.rejectedTurn?.messageId).toBe(messageId);
    await dispatch();
    const storage = useComposerDraftStore.persist.getOptions().storage;
    if (!storage) throw new Error("Missing composer storage.");
    const write = vi
      .spyOn(storage, "setItem")
      .mockRejectedValueOnce(new DOMException("quota", "QuotaExceededError"));
    await expect(
      finishRecoveredDraftSend(scope, prepared, AsyncResult.success(undefined)),
    ).rejects.toThrow("quota");
    write.mockRestore();
    await useComposerDraftStore.persist.rehydrate();
    const restored = useComposerDraftStore.getState().getComposerDraft(scope);
    if (!restored) throw new Error("The accepted attempt fence was lost.");
    await expect(
      prepareRecoveredDraftSend(scope, restored, MessageId.make("another-id")),
    ).rejects.toThrow("already has a Send attempt");
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("consumes the recovered marker durably after one accepted explicit Send", async () => {
    await recover();
    const draft = useComposerDraftStore.getState().getComposerDraft(scope);
    if (!draft) throw new Error("Recovery did not produce a draft.");
    const prepared = await prepareRecoveredDraftSend(scope, draft, MessageId.make("fresh-success"));
    await finishRecoveredDraftSend(scope, prepared, AsyncResult.success(undefined));
    await useComposerDraftStore.persist.rehydrate();
    expect(useComposerDraftStore.getState().getComposerDraft(scope)?.rejectedTurn).toBeUndefined();
    expect(useComposerDraftStore.getState().getComposerDraft(scope)?.prompt ?? "").toBe("");
  });

  it("publishes committed recovery without scheduling another write", async () => {
    vi.useFakeTimers();
    const storage = useComposerDraftStore.persist.getOptions().storage;
    if (!storage) throw new Error("Missing composer storage.");
    const write = vi.spyOn(storage, "setItem");
    try {
      await recover();
      expect(write).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      write.mockRestore();
      vi.useRealTimers();
    }
  });
  it("retains exact source order, records, links and provenance through reload", async () => {
    const message = source.messages[0]!;
    expect(await recover()).toBe("recovered");
    const draft = useComposerDraftStore.getState().getComposerDraft(scope)!;
    expect(draft.prompt).toBe(message.text);
    expect(draft.rejectedTurn).toMatchObject({
      ...scope,
      messageId,
      text: message.text,
      attachments: message.attachments,
      context: message.context,
    });
    expect(createAssetUrl.mock.calls.map(([input]) => input)).toEqual(
      message.attachments!.map((attachment) => ({
        environmentId: scope.environmentId,
        input: {
          resource: {
            _tag: "attachment",
            attachmentId: attachment.id,
            fileName: attachment.name,
            mimeType: attachment.mimeType,
          },
        },
      })),
    );
    await useComposerDraftStore.persist.rehydrate();
    const hydrated = useComposerDraftStore.getState().getComposerDraft(scope)!;
    expect(hydrated.prompt).toBe(message.text);
    expect(hydrated.rejectedTurn).toEqual(draft.rejectedTurn);
    expect(await recover()).toBe("existing");
    expect(useComposerDraftStore.getState().getComposerDraft(scope)).toBe(hydrated);
  });

  it("leaves the refusal and draft intact when an asset is missing", async () => {
    createAssetUrl.mockRejectedValueOnce({ _tag: "AssetAttachmentNotFoundError" });
    const refusal = source.activities[0];
    await expect(recover()).rejects.toBeDefined();
    expect(useComposerDraftStore.getState().getComposerDraft(scope)).toBeNull();
    expect(source.activities[0]).toBe(refusal);
  });

  it("does not begin verification for an occupied draft", async () => {
    useComposerDraftStore.getState().setPrompt(scope, "newer intent");
    const draft = useComposerDraftStore.getState().getComposerDraft(scope);
    await expect(recover()).rejects.toThrow();
    expect(createAssetUrl).not.toHaveBeenCalled();
    expect(useComposerDraftStore.getState().getComposerDraft(scope)).toBe(draft);
  });

  it.each(["edit", "edit-and-clear", "scope", "hydration", "pending-attachment"] as const)(
    "does not commit after concurrent %s",
    async (change) => {
      const verified = deferred<Awaited<ReturnType<RecoveryAssetUrlCreator>>>();
      const requested = deferred<void>();
      createAssetUrl.mockImplementation(() => {
        requested.resolve();
        return verified.promise;
      });
      const pending = recover();
      const rejection = expect(pending).rejects.toThrow();
      await requested.promise;
      if (change === "edit" || change === "edit-and-clear") {
        useComposerDraftStore.getState().setPrompt(scope, "concurrent intent");
        if (change === "edit-and-clear") {
          useComposerDraftStore.getState().clearComposerContent(scope);
        }
      } else if (change === "scope") {
        source = {
          ...source,
          scope: { ...scope, environmentId: EnvironmentId.make("environment-2") },
          synchronized: false,
        };
      } else if (change === "hydration") {
        await useComposerDraftStore.persist.rehydrate();
      } else {
        ready = false;
      }
      const draft = useComposerDraftStore.getState().getComposerDraft(scope);
      verified.resolve(AsyncResult.success({ relativeUrl: "/api/assets/signed", expiresAt: 100 }));
      await rejection;
      expect(useComposerDraftStore.getState().getComposerDraft(scope)).toBe(draft);
      expect(draft?.rejectedTurn).toBeUndefined();
    },
  );

  it("reconciles duplicate activation into one unchanged recovered draft", async () => {
    const verified = deferred<Awaited<ReturnType<RecoveryAssetUrlCreator>>>();
    createAssetUrl.mockImplementation(() => verified.promise);
    const first = recover();
    const second = recover();
    verified.resolve(AsyncResult.success({ relativeUrl: "/api/assets/signed", expiresAt: 100 }));
    expect(await first).toBe("recovered");
    const draft = useComposerDraftStore.getState().getComposerDraft(scope);
    expect(await second).toBe("existing");
    expect(useComposerDraftStore.getState().getComposerDraft(scope)).toBe(draft);
  });

  it("recognizes only bounded scoped persisted refusals", () => {
    expect(rejectedTurnMessage(scope, source, messageId)).toBe(source.messages[0]);
    expect(rejectedTurnMessage(scope, { ...source, activities: [] }, messageId)).toBeNull();
    expect(
      rejectedTurnMessage(
        scope,
        { ...source, scope: { ...scope, threadId: ThreadId.make("foreign") } },
        messageId,
      ),
    ).toBeNull();
    expect(
      rejectedTurnMessage(
        scope,
        {
          ...source,
          activities: source.activities.map((activity) => ({
            ...activity,
            payload: { ...refusalPayload, reason: "arbitrary-reason" },
          })),
        },
        messageId,
      ),
    ).toBeNull();
  });

  it("remaps only source attachment bindings for explicit Send", async () => {
    await recover();
    const original = useComposerDraftStore.getState().getComposerDraft(scope)!.rejectedTurn!;
    const context = recoveredTurnContextForSend(original, ["pending-file", "pending-image"]);
    expect(context?.records[0]).toEqual(original.context!.records[0]);
    expect(context?.records[1]).toEqual({
      ...original.context!.records[1],
      attachmentId: "pending-image",
    });
    expect(context?.records[2]).toEqual(original.context!.records[2]);
    expect(original.context).toEqual(source.messages[0]!.context);
    expect(original.attachments.map((attachment) => attachment.id)).toEqual([fileId, imageId]);
    expect(() => recoveredTurnContextForSend(original, [])).toThrow();
    const additional = {
      version: 1 as const,
      records: [
        {
          version: 1 as const,
          kind: "skill" as const,
          contextId: ComposerContextId.make("new_skill"),
          label: "New skill",
          name: "review",
        },
      ],
    };
    expect(
      recoveredTurnContextForSend(
        original,
        ["pending-file", "pending-image"],
        additional,
      )?.records.at(-1),
    ).toEqual(additional.records[0]);
    const cloned: RejectedTurnDraft = structuredClone(original);
    expect(recoveredTurnContextForSend(cloned, ["next-file", "next-image"])?.records[0]).toEqual(
      original.context!.records[0],
    );
  });
});
