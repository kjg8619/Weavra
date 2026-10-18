import {
  CommandId,
  EnvironmentId,
  MessageId,
  ThreadId,
  makeWorkspaceTurnStartRefusalIdentity,
} from "@t3tools/contracts";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { AsyncResult } from "effect/unstable/reactivity";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  recoverRejectedTurn,
  type RecoveryAssetUrlCreator,
  type RejectedTurnSource,
} from "../../lib/recoverRejectedTurn";
import { RejectedTurnNotice } from "./RejectedTurnNotice";

vi.mock("../ui/button", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & {
    variant?: string;
    size?: string;
  }) => <button {...props} />,
}));

const scope = {
  environmentId: EnvironmentId.make("notice-environment"),
  threadId: ThreadId.make("notice-thread"),
};
const messageId = MessageId.make("notice-message");
const fixture = (): RejectedTurnSource => ({
  scope,
  synchronized: true,
  messages: [
    {
      id: messageId,
      role: "user",
      text: "Exact refused intent",
      attachments: [
        {
          type: "file",
          id: "notice-thread-00000000-0000-4000-8000-000000000001-pdf",
          name: "report.pdf",
          mimeType: "application/pdf",
          sizeBytes: 3,
        },
      ],
      turnId: null,
      streaming: false,
      createdAt: "2026-10-03T00:00:00.000Z",
      updatedAt: "2026-10-03T00:00:00.000Z",
    },
  ],
  activities: [
    {
      id: makeWorkspaceTurnStartRefusalIdentity(scope.threadId, messageId).activityId,
      kind: "provider.turn.start.failed",
      tone: "error",
      summary: "Untrusted summary",
      turnId: null,
      sequence: 4,
      createdAt: "2026-10-03T00:00:00.000Z",
      payload: {
        version: 1,
        source: "workspace-ownership",
        requestId: messageId,
        reason: "owned",
        originCommandId: CommandId.make("notice-original"),
        originSequence: 2,
      },
    },
  ],
});
let renderer: ReactTestRenderer | undefined;
function deferred<A>() {
  let complete: (value: A) => void;
  const promise = new Promise<A>((resolve) => {
    complete = resolve;
  });
  return { promise, resolve: (value: A) => complete(value) };
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  await useComposerDraftStore.persist.clearStorage();
  useComposerDraftStore.setState({ draftsByThreadKey: {}, draftThreadsByThreadKey: {} });
  await useComposerDraftStore.persist.rehydrate();
});
afterEach(async () => {
  if (renderer) await act(() => renderer!.unmount());
  renderer = undefined;
  await useComposerDraftStore.persist.clearStorage();
  vi.unstubAllGlobals();
});

it("commits through the real recovery path only after explicit activation and verification", async () => {
  const source = fixture();
  const verified = deferred<Awaited<ReturnType<RecoveryAssetUrlCreator>>>();
  const requested = deferred<void>();
  const createAssetUrl = vi.fn<RecoveryAssetUrlCreator>(() => {
    requested.resolve();
    return verified.promise;
  });
  const onRecover = async (id: MessageId) => {
    await recoverRejectedTurn({
      scope,
      messageId: id,
      readSource: () => source,
      isComposerReady: () => true,
      httpBaseUrl: "https://environment.test/",
      createAssetUrl,
    });
  };
  await act(() => {
    renderer = create(
      <RejectedTurnNotice scope={scope} source={source} canRecover onRecover={onRecover} />,
    );
  });
  expect(renderer!.root.findAllByProps({ role: "status" })).toHaveLength(1);
  expect(createAssetUrl).not.toHaveBeenCalled();
  expect(useComposerDraftStore.getState().getComposerDraft(scope)).toBeNull();
  let activation: Promise<void>;
  await act(() => {
    activation = renderer!.root
      .findByProps({
        "data-recover-message-id": messageId,
      })
      .props.onClick();
  });
  await requested.promise;
  expect(useComposerDraftStore.getState().getComposerDraft(scope)).toBeNull();
  await act(async () => {
    verified.resolve(AsyncResult.success({ relativeUrl: "/api/assets/signed", expiresAt: 100 }));
    await activation!;
  });
  const draft = useComposerDraftStore.getState().getComposerDraft(scope)!;
  expect(draft.prompt).toBe(source.messages[0]!.text);
  expect(draft.rejectedTurn?.attachments).toEqual(source.messages[0]!.attachments);
  await act(async () => {
    await renderer!.root
      .findByProps({
        "data-recover-message-id": messageId,
      })
      .props.onClick();
  });
  expect(useComposerDraftStore.getState().getComposerDraft(scope)).toBe(draft);
  expect(createAssetUrl).toHaveBeenCalledTimes(1);
});

it("does not show a scoped status or action for an unrelated failure", async () => {
  const source = fixture();
  const onRecover = vi.fn();
  await act(() => {
    renderer = create(
      <RejectedTurnNotice
        scope={scope}
        source={{
          ...source,
          activities: source.activities.map((activity) => ({
            ...activity,
            kind: "provider.turn.failed",
          })),
        }}
        canRecover
        onRecover={onRecover}
      />,
    );
  });
  expect(renderer!.root.findAllByType("button")).toEqual([]);
  expect(renderer!.root.findAllByProps({ role: "status" })).toEqual([]);
  expect(onRecover).not.toHaveBeenCalled();
});
