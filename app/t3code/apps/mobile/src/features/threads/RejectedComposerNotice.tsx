import type { MessageId } from "@t3tools/contracts";
import { ActivityIndicator, Modal, ScrollView, View } from "react-native";
import { useState } from "react";
import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { ComposerContextRecordDetails } from "../../components/ComposerContextRecordDetails";
import type { RejectedComposerDraftSource } from "../../state/use-composer-drafts";
import type {
  RejectedComposerOperationState,
  RejectedComposerOwner,
} from "../../state/rejected-composer-operations";

export interface ThreadRecoveryPresentation {
  readonly sources: ReadonlyMap<MessageId, RejectedComposerDraftSource>;
  readonly synchronized: boolean;
  readonly marker: RejectedComposerDraftSource | undefined;
  readonly state: RejectedComposerOperationState | undefined;
  readonly capture: () => RejectedComposerOwner;
  readonly canFocusSend: (id: MessageId) => boolean;
  readonly recover: (id: MessageId) => Promise<boolean>;
  readonly check: () => Promise<void>;
  readonly discard: () => Promise<void>;
}

const STATUS = {
  recovering: "Recovering original content. Nothing is being sent.",
  recovered: "Recovered draft. Send is a separate explicit action.",
  changed: "The draft or connection changed. Current work was preserved.",
  unavailable: "Recovery is unavailable. Current work was preserved.",
  preparing: "Preparing the exact recovered message.",
  saving: "Saving a new submission locally. The recovered draft is retained.",
  queued: "Snapshot queued. This is not proof of execution.",
  "queued-changed": "Earlier snapshot queued; your current edits remain in this recovered draft.",
  "admission-uncertain":
    "Local admission is unconfirmed. Check the saved submission before sending again.",
  "cleanup-uncertain": "Local cleanup is unconfirmed. Check saved state; do not resend.",
  "failed-retained": "The submission was not admitted; file ownership is still unresolved.",
  failed: "The submission was not admitted. Your draft remains.",
  "recovery-uncertain": "Saved recovery is unconfirmed. Its file ownership is retained.",
  "recovery-referenced": "Saved recovery still references the files. Live edits were not replaced.",
  discarding: "Removing the recovered draft from local storage.",
  discarded: "Recovered draft discarded.",
} as const;

export function RejectedMessageNotice(props: {
  readonly messageId: MessageId;
  readonly recovery: ThreadRecoveryPresentation;
  readonly onRecover: (id: MessageId) => void;
}) {
  const { recovery, messageId } = props;
  const source = recovery.sources.get(messageId);
  if (source === undefined) return null;
  const existing = recovery.marker?.message.id === messageId;
  const disabled = !recovery.synchronized || recovery.state?.busy || recovery.state?.needsCheck;
  return (
    <View className="mt-2 gap-1 rounded-xl bg-card-alt p-3">
      <Text className="text-xs font-t3-medium">
        {recovery.synchronized ? "Not started" : "Cached refusal - not synchronized"}
      </Text>
      <Text className="text-xs text-foreground-secondary">
        This request was refused before it started. Recovery does not send it.
      </Text>
      <MaterialButton
        tone="text"
        label={existing ? "Open recovered draft" : "Recover to draft"}
        disabled={Boolean(disabled)}
        onPress={() => props.onRecover(messageId)}
      />
    </View>
  );
}

export function RejectedComposerNotice(props: { readonly recovery: ThreadRecoveryPresentation }) {
  const { recovery } = props;
  const [reviewing, setReviewing] = useState(false);
  if (recovery.marker === undefined && !recovery.state?.needsCheck && !recovery.state?.busy)
    return null;
  const source = recovery.marker?.message;
  return (
    <View className="mx-4 mb-2 gap-2 rounded-xl bg-card-alt p-3">
      <Text className="text-xs font-t3-medium">
        {source ? "Recovered content" : "Local recovery"}
      </Text>
      {source ? (
        <>
          <Text className="text-xs text-foreground-secondary">
            Original refused message; the prompt below may contain your later edits.
          </Text>
          <Text className="text-xs text-foreground-secondary">
            {source.attachments?.length ?? 0} original attachments ·{" "}
            {source.context?.records.length ?? 0} original context items
          </Text>
          <MaterialButton
            tone="text"
            label="Review original content"
            onPress={() => setReviewing(true)}
          />
          <Modal
            visible={reviewing}
            animationType="slide"
            presentationStyle="pageSheet"
            onRequestClose={() => setReviewing(false)}
          >
            <View className="flex-1 bg-screen pt-6">
              <ScrollView contentContainerClassName="gap-2 p-4">
                <Text className="text-xs font-t3-medium">Original persisted refused message</Text>
                <Text className="text-sm" selectable>
                  {source.text}
                </Text>
                {(source.attachments ?? []).map((attachment) => (
                  <Text key={attachment.id} className="text-xs text-foreground-secondary">
                    {attachment.name} · {attachment.mimeType} · {attachment.sizeBytes} bytes
                  </Text>
                ))}
                {source.context?.records.map((record) => (
                  <ComposerContextRecordDetails key={record.contextId} record={record} />
                ))}
                <MaterialButton
                  label="Close original content"
                  onPress={() => setReviewing(false)}
                />
              </ScrollView>
            </View>
          </Modal>
        </>
      ) : null}
      <Text className="text-xs text-foreground-secondary">
        {recovery.state
          ? recovery.state.status === "cleanup-uncertain" && recovery.state.messageId
            ? "Snapshot queued; draft cleanup is unconfirmed. Check saved state; do not resend."
            : STATUS[recovery.state.status]
          : "Recovered source is retained. Send creates a new submission; it does not replay the refused identity."}
      </Text>
      {recovery.state?.problem ? (
        <Text className="text-xs text-foreground-secondary">
          Local preparation or storage could not be completed. Your work remains retained.
        </Text>
      ) : null}
      {recovery.state?.busy ? <ActivityIndicator colorClassName="accent-icon-muted" /> : null}
      {recovery.state?.needsCheck ? (
        <MaterialButton
          label="Check saved recovery"
          tone="text"
          disabled={recovery.state.busy || !recovery.synchronized}
          onPress={() => {
            void recovery.check();
          }}
        />
      ) : null}
      {source ? (
        <MaterialButton
          label="Discard recovered draft"
          tone="danger"
          disabled={Boolean(
            recovery.state?.busy || recovery.state?.needsCheck || !recovery.synchronized,
          )}
          onPress={() => {
            void recovery.discard();
          }}
        />
      ) : null}
    </View>
  );
}
