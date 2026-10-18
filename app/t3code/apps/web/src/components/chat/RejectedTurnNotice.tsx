import { useState } from "react";
import type { MessageId, ScopedThreadRef } from "@t3tools/contracts";
import {
  discardRecoveredDraft,
  useComposerDraftStore,
  useComposerPersistenceStatus,
  type ComposerThreadTarget,
} from "../../composerDraftStore";
import { rejectedTurnMessage, type RejectedTurnSource } from "../../lib/recoverRejectedTurn";
import { releaseDraftAttachments } from "../../lib/attachmentUploadQueue";
import { Button } from "../ui/button";

export function RejectedTurnNotice(props: {
  scope: ScopedThreadRef;
  source: RejectedTurnSource;
  canRecover: boolean;
  onRecover: (messageId: MessageId) => Promise<void>;
}) {
  const [busy, setBusy] = useState<MessageId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const messages = props.source.messages.filter(
    (message) => rejectedTurnMessage(props.scope, props.source, message.id) !== null,
  );
  if (messages.length === 0) return null;
  return (
    <section
      aria-label="시작되지 않은 메시지"
      className="max-h-40 shrink-0 overflow-y-auto border-b px-4 py-2"
    >
      {messages.map((message) => (
        <div key={message.id} className="flex min-w-0 items-center justify-between gap-3 py-1">
          <div className="min-w-0">
            <p role="status" data-rejected-message-id={message.id} className="text-sm">
              시작되지 않음
              {!props.source.synchronized ? " (캐시됨)" : ""}
            </p>
            <p className="truncate text-xs text-muted-foreground">{message.text}</p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-recover-message-id={message.id}
            disabled={!props.canRecover || busy !== null}
            onClick={async () => {
              setBusy(message.id);
              setError(null);
              try {
                await props.onRecover(message.id);
              } catch (cause) {
                setError(cause instanceof Error ? cause.message : "이 메시지를 복구하지 못했어요.");
              } finally {
                setBusy(null);
              }
            }}
          >
            초안으로 복구
          </Button>
        </div>
      ))}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </section>
  );
}

/** The canonical wire payload remains separate from editable producer views. */
export function RecoveredComposerContent(props: { target: ComposerThreadTarget }) {
  const persistenceError = useComposerPersistenceStatus((state) => state.error);
  const retained = useComposerPersistenceStatus((state) => state.retained);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const recovered = useComposerDraftStore(
    (state) => state.getComposerDraft(props.target)?.rejectedTurn,
  );
  const problem = error ?? persistenceError;
  const storageProblem = problem ? (
    <div role="alert" className="mb-2 text-xs text-destructive">
      <p>{problem}</p>
      {retained.length > 0 ? (
        <details>
          <summary>보관된 저장 안 된 입력</summary>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(retained, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  ) : null;
  if (!recovered) {
    return storageProblem;
  }
  return (
    <section
      aria-label="복구한 메시지 내용"
      data-recovered-message-id={recovered.messageId}
      className="mb-2 rounded-lg border px-3 py-2 text-xs"
    >
      <div className="flex items-center justify-between gap-2">
        <p>
          {recovered.sendAttempt
            ? "A Send was attempted. Check the conversation before discarding this draft; it will not be sent again."
            : "초안을 복구했어요. 아무것도 보내지 않았어요."}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-discard-recovered-message-id={recovered.messageId}
          disabled={busy}
          onClick={async () => {
            const store = useComposerDraftStore.getState();
            const current = store.getComposerDraft(props.target);
            if (current?.rejectedTurn?.key !== recovered.key) return;
            setBusy(true);
            setError(null);
            try {
              await discardRecoveredDraft(props.target);
              releaseDraftAttachments([...current.images, ...current.files]);
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "이 초안을 버리지 못했어요.");
            } finally {
              setBusy(false);
            }
          }}
        >
          초안 버리기
        </Button>
      </div>
      {storageProblem}
      {recovered.attachments.length > 0 ? (
        <ol className="mt-1 space-y-1">
          {recovered.attachments.map((attachment) => (
            <li key={attachment.id} data-recovered-attachment-id={attachment.id}>
              {attachment.name} ({attachment.type}, {attachment.sizeBytes} bytes)
            </li>
          ))}
        </ol>
      ) : null}
      {recovered.context ? (
        <details className="mt-2">
          <summary>Recovered context ({recovered.context.records.length} records)</summary>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(recovered.context, null, 2)}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
