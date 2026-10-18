import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  CommandId,
  EnvironmentId,
  MessageId,
  ThreadId,
  makeWorkspaceTurnStartRefusalIdentity,
  type OrchestrationMessage,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import type { ComposerDraft } from "../state/use-composer-drafts";

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  current: vi.fn(),
  draft: vi.fn<() => ComposerDraft>(),
  prepare: vi.fn(),
  commit: vi.fn(),
  ownership: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../state/use-composer-drafts", () => ({
  captureComposerRecoveryTarget: mocks.capture,
  isComposerRecoveryTargetCurrent: mocks.current,
  getComposerDraftSnapshot: mocks.draft,
  commitRejectedComposerDraft: mocks.commit,
  persistedComposerAttachmentOwnership: mocks.ownership,
}));
vi.mock("./rejectedComposerAttachments", () => ({
  prepareRejectedComposerAttachments: mocks.prepare,
  RejectedComposerAttachmentError: class extends Error {
    readonly reason: string;
    constructor(input: { reason: string }) {
      super(input.reason);
      this.reason = input.reason;
    }
  },
}));
import { RejectedComposerAttachmentError } from "./rejectedComposerAttachments";
import { recoverRejectedComposerDraft } from "./recoverRejectedComposerDraft";
import { selectRejectedComposerSource } from "./rejectedComposerSource";

const scope = {
  environmentId: EnvironmentId.make("environment"),
  threadId: ThreadId.make("thread"),
};
const messageId = MessageId.make("original");
const message: OrchestrationMessage = {
  id: messageId,
  role: "user",
  text: "  /original\n",
  turnId: null,
  streaming: false,
  createdAt: "2026-10-04T00:00:00.000Z",
  updatedAt: "2026-10-04T00:00:00.000Z",
};
const activity: OrchestrationThreadActivity = {
  id: makeWorkspaceTurnStartRefusalIdentity(scope.threadId, messageId).activityId,
  kind: "provider.turn.start.failed",
  tone: "error",
  summary: "denied",
  turnId: null,
  sequence: 9,
  createdAt: "2026-10-04T00:00:00.000Z",
  payload: {
    version: 1,
    source: "workspace-ownership",
    requestId: messageId,
    reason: "target-changed",
    originCommandId: CommandId.make("command"),
    originSequence: 8,
  },
};
const source = { scope, synchronized: true, messages: [message], activities: [activity] };
const input = () => ({
  scope,
  messageId,
  readSource: () => source,
  signal: new AbortController().signal,
  isCurrent: () => true,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.capture.mockReturnValue({ ...scope, draftKey: "environment:thread", epoch: 1 });
  mocks.current.mockReturnValue(true);
  mocks.draft.mockReturnValue({ text: "", attachments: [] });
  mocks.prepare.mockResolvedValue({ attachments: [], release: mocks.release });
  mocks.release.mockResolvedValue(undefined);
  mocks.commit.mockResolvedValue("recovered");
  mocks.ownership.mockResolvedValue("unreferenced");
});

describe("native rejected composer recovery coordination", () => {
  it("passes correlated source and prepared files to commit, then releases preparation ownership", async () => {
    expect(await recoverRejectedComposerDraft(input())).toEqual({ status: "recovered" });
    expect(mocks.commit).toHaveBeenCalledOnce();
    expect(mocks.commit.mock.calls[0]?.[0].source.message).toBe(message);
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.ownership).not.toHaveBeenCalled();
  });

  it("holds leases on uncertain writes until disk proves they are unreferenced", async () => {
    const failure = new Error("rename outcome unknown");
    mocks.commit.mockRejectedValue(failure);
    const result = await recoverRejectedComposerDraft(input());
    if (result.status !== "uncertain") throw new Error("Expected uncertain outcome");
    expect(result.cause).toBe(failure);
    expect(mocks.release).not.toHaveBeenCalled();
    mocks.ownership.mockResolvedValueOnce("unknown").mockResolvedValueOnce("referenced");
    expect(await result.reconcile()).toBe("unknown");
    expect(await result.reconcile()).toBe("referenced");
    expect(mocks.release).not.toHaveBeenCalled();
    expect(await result.reconcile()).toBe("released");
    expect(await result.reconcile()).toBe("released");
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(mocks.commit).toHaveBeenCalledOnce();
  });

  it("does not download again for an existing edited recovery", async () => {
    const selected = selectRejectedComposerSource({ scope, messageId, source });
    if (selected === null) throw new Error("Expected correlated source");
    mocks.draft.mockReturnValue({ text: "newer edit", attachments: [], rejectedTurn: selected });
    expect(await recoverRejectedComposerDraft(input())).toEqual({ status: "existing" });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("opens an existing recovery when another activation wins during attachment preparation", async () => {
    const selected = selectRejectedComposerSource({ scope, messageId, source });
    if (selected === null) throw new Error("Expected correlated source");
    mocks.prepare.mockImplementationOnce(async () => {
      mocks.draft.mockReturnValue({
        text: "already edited",
        attachments: [],
        rejectedTurn: selected,
      });
      throw new RejectedComposerAttachmentError({ reason: "changed" });
    });
    expect(await recoverRejectedComposerDraft(input())).toEqual({ status: "existing" });
    expect(mocks.commit).not.toHaveBeenCalled();
  });

  it("invalidates commit when synchronized source changes during preparation", async () => {
    let synchronized = true;
    const request = { ...input(), readSource: () => ({ ...source, synchronized }) };
    mocks.prepare.mockImplementationOnce(async () => {
      synchronized = false;
      return { attachments: [], release: mocks.release };
    });
    mocks.commit.mockImplementationOnce(async (commit) =>
      commit.isCurrent() ? "recovered" : "changed",
    );
    expect(await recoverRejectedComposerDraft(request)).toEqual({ status: "changed" });
    expect(mocks.release).toHaveBeenCalledOnce();
  });

  it("leaves unavailable source and occupied draft untouched", async () => {
    expect(
      await recoverRejectedComposerDraft({
        ...input(),
        readSource: () => ({ ...source, synchronized: false }),
      }),
    ).toEqual({ status: "unavailable" });
    mocks.capture.mockReturnValue(null);
    expect(await recoverRejectedComposerDraft(input())).toEqual({ status: "changed" });
    expect(mocks.prepare).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
