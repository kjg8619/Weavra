import { useAtomValue } from "@effect/atom-react";
import { Modal, ScrollView, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { ComposerContextRecordDetails } from "../../components/ComposerContextRecordDetails";
import { threadOutboxManager } from "../../state/thread-outbox";
import { threadOutboxIdentity, type QueuedThreadMessage } from "../../state/thread-outbox-model";
import { currentThreadOutboxPresentation } from "../../state/thread-outbox-presentation";
import type { ChatAttachment } from "@t3tools/contracts";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { scopedThreadKey } from "../../lib/scopedEntities";

const retainedThreadLabelAtom = Atom.family((key: string) =>
  Atom.make((get) => {
    const held = (get(threadOutboxManager.queuedMessagesByThreadKeyAtom)[key] ?? [])
      .map(currentThreadOutboxPresentation)
      .filter((presentation) => presentation.kind === "retained");
    return held.length === 0
      ? null
      : held.length === 1
        ? held[0]?.label
        : `${held.length} local records retained - open the thread to review`;
  }),
);

export function RetainedThreadLabel(props: ScopedThreadRef) {
  const label = useAtomValue(
    retainedThreadLabelAtom(scopedThreadKey(props.environmentId, props.threadId)),
  );
  return label ? <Text className="text-xs text-foreground-secondary">{label}</Text> : null;
}

export function RetainedInventoryNotice() {
  const count = useAtomValue(threadOutboxManager.unassignedRecordCountAtom);
  const complete = useAtomValue(threadOutboxManager.inventoryReadyAtom);
  if (count === 0 && complete) return null;
  return (
    <View className="mx-4 mb-2 gap-1 rounded-xl bg-card-alt p-3">
      {count > 0 ? (
        <Text className="text-xs text-foreground-secondary">
          {count} retained local records have unknown ownership and cannot be opened or sent here.
        </Text>
      ) : null}
      {!complete ? (
        <Text className="text-xs text-foreground-secondary">
          Local inventory is incomplete. Visible rows do not account for all retained work.
        </Text>
      ) : null}
    </View>
  );
}

function RetainedPayload(props: {
  readonly label: string;
  readonly payload: Pick<QueuedThreadMessage, "text" | "context"> & {
    readonly attachments: ReadonlyArray<
      Pick<ChatAttachment, "id" | "name" | "mimeType" | "sizeBytes">
    >;
  };
}) {
  return (
    <View className="gap-1">
      <Text className="text-xs font-t3-medium">{props.label}</Text>
      <Text selectable className="text-sm">
        {props.payload.text}
      </Text>
      {props.payload.attachments.map((attachment) => (
        <Text key={attachment.id} className="text-xs text-foreground-secondary">
          {attachment.name} · {attachment.mimeType} · {attachment.sizeBytes} bytes
        </Text>
      ))}
      {props.payload.context?.records.map((record) => (
        <ComposerContextRecordDetails key={record.contextId} record={record} />
      ))}
    </View>
  );
}

export function RetainedWorkNotice(props: { readonly message: QueuedThreadMessage }) {
  const presentation = currentThreadOutboxPresentation(props.message);
  const record = threadOutboxManager.recordFor(props.message);
  return (
    <View className="mb-2 gap-2 rounded-xl bg-card-alt p-3">
      <Text className="text-xs font-t3-medium">{presentation.label}</Text>
      <Text className="text-xs text-foreground-secondary">
        Retained content is not permission to send or proof of provider execution.
      </Text>
      {presentation.original && presentation.changed ? (
        <RetainedPayload
          label={
            presentation.original.kind === "claim"
              ? "Original submission snapshot"
              : "Original saved observation (not an invocation)"
          }
          payload={presentation.original.localSnapshot}
        />
      ) : null}
      {presentation.latest ? (
        <RetainedPayload label="Latest retained local content" payload={presentation.latest} />
      ) : null}
      {record?.delivery.state === "refused" ? (
        <RetainedPayload
          label="Canonical persisted refused message"
          payload={{
            text: record.delivery.sourceMessage.text,
            context: record.delivery.sourceMessage.context,
            attachments: record.delivery.sourceMessage.attachments ?? [],
          }}
        />
      ) : null}
    </View>
  );
}

export function RetainedWorkSheet(props: {
  readonly message: QueuedThreadMessage | null;
  readonly onClose: () => void;
}) {
  // Re-resolve the immutable slot on every record/account publication. Never
  // keep a foreign account's preview alive through an already-open modal.
  const queues = useAtomValue(threadOutboxManager.queuedMessagesByThreadKeyAtom);
  const record =
    props.message === null
      ? null
      : threadOutboxManager.recordAt(props.message.storageIdentity ?? props.message);
  const current =
    record === null
      ? null
      : Object.values(queues)
          .flat()
          .find(
            (message) =>
              threadOutboxIdentity(message.storageIdentity ?? message) ===
              threadOutboxIdentity(record.storageIdentity),
          );
  if (props.message === null) return null;
  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={props.onClose}
    >
      <View className="flex-1 bg-screen pt-6">
        <ScrollView contentContainerClassName="gap-2 p-4">
          {current ? (
            <RetainedWorkNotice message={current} />
          ) : (
            <Text className="text-sm text-foreground-secondary">
              This retained record is not available in the current account.
            </Text>
          )}
          <MaterialButton label="Close retained work" onPress={props.onClose} />
        </ScrollView>
      </View>
    </Modal>
  );
}
