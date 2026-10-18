import {
  fixture,
  queuedMessage,
  draft,
  setDraft,
  queuedMessageText,
  blockNextWrite,
} from "./testing/pending-editor-writes";
import { describe, expect, it } from "vite-plus/test";
import {
  capturePendingTaskEditorWriteBaseline,
  flushPendingTaskEditorWrite,
} from "./pending-task-editor-writes";
import { getComposerDraftSnapshot } from "./use-composer-drafts";

describe("pending task editor writes", () => {
  it("chains a reopened editor that closes before the previous save finishes", async () => {
    let original = queuedMessage("message-close-before-save", "original");
    const firstEdit = queuedMessage("message-close-before-save", "first edit");
    const secondEdit = queuedMessage("message-close-before-save", "second edit");
    const draftKey = "pending-task:message-close-before-save";
    original = await fixture().admit(original);

    setDraft(draftKey, draft(firstEdit.text));
    const firstBaseline = capturePendingTaskEditorWriteBaseline(original);
    const firstWriteGate = blockNextWrite();
    const firstSave = flushPendingTaskEditorWrite({
      message: firstEdit,
      baseline: firstBaseline,
      draftKey,
    });
    await firstWriteGate.started;

    const secondBaseline = capturePendingTaskEditorWriteBaseline(original);
    setDraft(draftKey, draft(secondEdit.text));
    const secondWriteGate = blockNextWrite();
    const secondSave = flushPendingTaskEditorWrite({
      message: secondEdit,
      baseline: secondBaseline,
      draftKey,
    });

    firstWriteGate.resolve();
    await expect(firstSave).resolves.toBe(false);
    await expect(secondWriteGate.started).resolves.toMatchObject({ text: secondEdit.text });
    secondWriteGate.resolve();

    await expect(secondSave).resolves.toBe(true);
    expect(queuedMessageText(original.messageId)).toBe(secondEdit.text);
  });

  it("keeps a captured predecessor after that predecessor finishes", async () => {
    let original = queuedMessage("message-finished-predecessor", "original");
    const firstEdit = queuedMessage("message-finished-predecessor", "first edit");
    const secondEdit = queuedMessage("message-finished-predecessor", "second edit");
    const draftKey = "pending-task:message-finished-predecessor";
    original = await fixture().admit(original);

    setDraft(draftKey, draft(firstEdit.text));
    const firstWriteGate = blockNextWrite();
    const firstSave = flushPendingTaskEditorWrite({
      message: firstEdit,
      baseline: capturePendingTaskEditorWriteBaseline(original),
      draftKey,
    });
    await firstWriteGate.started;
    const secondBaseline = capturePendingTaskEditorWriteBaseline(original);

    firstWriteGate.resolve();
    await expect(firstSave).resolves.toBe(true);

    setDraft(draftKey, draft(secondEdit.text));
    const secondWriteGate = blockNextWrite();
    const secondSave = flushPendingTaskEditorWrite({
      message: secondEdit,
      baseline: secondBaseline,
      draftKey,
    });
    await secondWriteGate.started;
    secondWriteGate.resolve();

    await expect(secondSave).resolves.toBe(true);
    expect(queuedMessageText(original.messageId)).toBe(secondEdit.text);
  });

  it("chains three rapid editor saves in order", async () => {
    let original = queuedMessage("message-three-saves", "original");
    const firstEdit = queuedMessage("message-three-saves", "first edit");
    const secondEdit = queuedMessage("message-three-saves", "second edit");
    const thirdEdit = queuedMessage("message-three-saves", "third edit");
    const draftKey = "pending-task:message-three-saves";
    original = await fixture().admit(original);

    setDraft(draftKey, draft(firstEdit.text));
    const firstWriteGate = blockNextWrite();
    const firstSave = flushPendingTaskEditorWrite({
      message: firstEdit,
      baseline: capturePendingTaskEditorWriteBaseline(original),
      draftKey,
    });
    await firstWriteGate.started;

    const secondBaseline = capturePendingTaskEditorWriteBaseline(original);
    setDraft(draftKey, draft(secondEdit.text));
    const secondWriteGate = blockNextWrite();
    const secondSave = flushPendingTaskEditorWrite({
      message: secondEdit,
      baseline: secondBaseline,
      draftKey,
    });

    const thirdBaseline = capturePendingTaskEditorWriteBaseline(original);
    setDraft(draftKey, draft(thirdEdit.text));
    const thirdWriteGate = blockNextWrite();
    const thirdSave = flushPendingTaskEditorWrite({
      message: thirdEdit,
      baseline: thirdBaseline,
      draftKey,
    });

    firstWriteGate.resolve();
    await expect(firstSave).resolves.toBe(false);
    await secondWriteGate.started;
    secondWriteGate.resolve();
    await expect(secondSave).resolves.toBe(false);
    await thirdWriteGate.started;
    thirdWriteGate.resolve();

    await expect(thirdSave).resolves.toBe(true);
    expect(queuedMessageText(original.messageId)).toBe(thirdEdit.text);
  });

  it("preserves later drafts without inventing a baseline when the middle save fails", async () => {
    let original = queuedMessage("message-middle-failure", "original");
    const firstEdit = queuedMessage("message-middle-failure", "first edit");
    const failedEdit = queuedMessage("message-middle-failure", "failed edit");
    const finalEdit = queuedMessage("message-middle-failure", "final edit");
    const draftKey = "pending-task:message-middle-failure";
    original = await fixture().admit(original);

    setDraft(draftKey, draft(firstEdit.text));
    const firstWriteGate = blockNextWrite();
    const firstSave = flushPendingTaskEditorWrite({
      message: firstEdit,
      baseline: capturePendingTaskEditorWriteBaseline(original),
      draftKey,
    });
    await firstWriteGate.started;

    const failedBaseline = capturePendingTaskEditorWriteBaseline(original);
    setDraft(draftKey, draft(failedEdit.text));
    const failedWriteGate = blockNextWrite();
    const failedSave = flushPendingTaskEditorWrite({
      message: failedEdit,
      baseline: failedBaseline,
      draftKey,
    });

    const finalBaseline = capturePendingTaskEditorWriteBaseline(original);
    setDraft(draftKey, draft(finalEdit.text));
    const finalSave = flushPendingTaskEditorWrite({
      message: finalEdit,
      baseline: finalBaseline,
      draftKey,
    });

    firstWriteGate.resolve();
    await expect(firstSave).resolves.toBe(false);
    await failedWriteGate.started;
    failedWriteGate.reject(new Error("disk full"));
    await expect(failedSave).rejects.toMatchObject({ _tag: "ThreadOutboxAuthorityError" });
    await expect(finalSave).rejects.toMatchObject({ _tag: "ThreadOutboxAuthorityError" });
    expect(queuedMessageText(original.messageId)).toBe(firstEdit.text);
    expect(getComposerDraftSnapshot(draftKey).text).toBe(finalEdit.text);
  });

  it("does not overwrite an unrelated update accepted after capture", async () => {
    let original = queuedMessage("message-unrelated-update", "original");
    const editorEdit = queuedMessage("message-unrelated-update", "editor edit");
    const unrelatedEdit = queuedMessage("message-unrelated-update", "unrelated edit");
    const draftKey = "pending-task:message-unrelated-update";
    original = await fixture().admit(original);

    const editorBaseline = capturePendingTaskEditorWriteBaseline(original);
    const revision = fixture().record(original);
    expect(await fixture().edit(unrelatedEdit, revision)).not.toBeNull();
    setDraft(draftKey, draft(editorEdit.text));

    await expect(
      flushPendingTaskEditorWrite({
        message: editorEdit,
        baseline: editorBaseline,
        draftKey,
      }),
    ).resolves.toBe(false);
    expect(queuedMessageText(original.messageId)).toBe(unrelatedEdit.text);
  });

  it("rejects a captured successor when its predecessor write fails", async () => {
    let original = queuedMessage("message-write-retry", "original");
    const failedEdit = queuedMessage("message-write-retry", "failed edit");
    const retryEdit = queuedMessage("message-write-retry", "retry edit");
    const draftKey = "pending-task:message-write-retry";
    original = await fixture().admit(original);

    setDraft(draftKey, draft(failedEdit.text));
    const failedWriteGate = blockNextWrite();
    const failedSave = flushPendingTaskEditorWrite({
      message: failedEdit,
      baseline: capturePendingTaskEditorWriteBaseline(original),
      draftKey,
    });
    await failedWriteGate.started;

    const retryBaseline = capturePendingTaskEditorWriteBaseline(original);
    setDraft(draftKey, draft(retryEdit.text));
    const retrySave = flushPendingTaskEditorWrite({
      message: retryEdit,
      baseline: retryBaseline,
      draftKey,
    });

    failedWriteGate.reject(new Error("disk full"));
    await expect(failedSave).rejects.toMatchObject({ _tag: "ThreadOutboxAuthorityError" });
    await expect(retrySave).rejects.toMatchObject({ _tag: "ThreadOutboxAuthorityError" });
    expect(queuedMessageText(original.messageId)).toBe(original.text);
    expect(getComposerDraftSnapshot(draftKey).text).toBe(retryEdit.text);
  });

  it("does not permit cleanup after a newer editor makes the draft unsendable", async () => {
    let original = queuedMessage("message-unsendable-draft", "original");
    const editorEdit = queuedMessage("message-unsendable-draft", "saved edit");
    const draftKey = "pending-task:message-unsendable-draft";
    original = await fixture().admit(original);

    setDraft(draftKey, draft(editorEdit.text));
    const writeGate = blockNextWrite();
    const save = flushPendingTaskEditorWrite({
      message: editorEdit,
      baseline: capturePendingTaskEditorWriteBaseline(original),
      draftKey,
    });
    await writeGate.started;

    setDraft(draftKey, draft(""));
    writeGate.resolve();

    await expect(save).resolves.toBe(false);
    expect(getComposerDraftSnapshot(draftKey).text).toBe("");
    expect(queuedMessageText(original.messageId)).toBe(editorEdit.text);
  });
});
