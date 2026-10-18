import { EnvironmentId, MessageId, ThreadId } from "@t3tools/contracts";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  commitRejectedTurnDraft,
  rejectedTurnRecoveryKey,
  useComposerDraftStore,
} from "../../composerDraftStore";
import { RecoveredComposerContent } from "./RejectedTurnNotice";

const uploads = vi.hoisted(() => ({ release: vi.fn() }));
vi.mock("../../lib/attachmentUploadQueue", () => ({
  releaseDraftAttachments: uploads.release,
}));
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
  environmentId: EnvironmentId.make("composer-environment"),
  threadId: ThreadId.make("composer-thread"),
};
const messageId = MessageId.make("composer-message");
let renderer: ReactTestRenderer | undefined;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  uploads.release.mockReset();
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

it("renders ordered recovered refs through hydration without starting attachment work", async () => {
  const recovered = {
    key: rejectedTurnRecoveryKey(scope, messageId),
    ...scope,
    messageId,
    text: "Exact source",
    attachments: [
      {
        type: "file" as const,
        id: "composer-thread-00000000-0000-4000-8000-000000000001-pdf",
        name: "first.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
      },
      {
        type: "image" as const,
        id: "composer-thread-00000000-0000-4000-8000-000000000002",
        name: "second.png",
        mimeType: "image/png",
        sizeBytes: 3,
      },
    ],
  };
  await commitRejectedTurnDraft(scope, null, recovered);
  await act(() => {
    renderer = create(<RecoveredComposerContent target={scope} />);
  });
  const renderedIds = () =>
    renderer!.root.findAllByType("li").map((node) => node.props["data-recovered-attachment-id"]);
  expect(renderedIds()).toEqual(recovered.attachments.map((attachment) => attachment.id));
  await act(async () => {
    await useComposerDraftStore.persist.rehydrate();
  });
  expect(renderedIds()).toEqual(recovered.attachments.map((attachment) => attachment.id));
  expect(useComposerDraftStore.getState().getComposerDraft(scope)?.rejectedTurn).toEqual(recovered);
  expect(uploads.release).not.toHaveBeenCalled();
  await act(async () => {
    await renderer!.root
      .findByProps({
        "data-discard-recovered-message-id": messageId,
      })
      .props.onClick();
  });
  expect(useComposerDraftStore.getState().getComposerDraft(scope)?.rejectedTurn).toBeUndefined();
  expect(renderer!.root.findAllByType("li")).toEqual([]);
  expect(uploads.release).toHaveBeenCalledWith([]);
});
