import { stableStringify } from "@t3tools/shared/relaySigning";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import type { ThreadOutboxRecord } from "./thread-outbox-record";
import { threadOutboxManager } from "./thread-outbox";

export function threadOutboxPresentation(
  message: QueuedThreadMessage,
  record: ThreadOutboxRecord | null,
) {
  const latest = record?.kind === "message" ? record.message : record?.retainedMessage;
  const original = record?.original;
  const changed =
    original !== undefined && stableStringify(original.localSnapshot) !== stableStringify(latest);
  if (record === null) {
    return {
      kind: "saving" as const,
      label: "Saving locally - not yet durably queued",
      latest: message,
      original: undefined,
      changed: false,
    };
  }
  if (record.kind === "retired") {
    const labels = {
      "confirmed-refusal": "Refused identity retired; local work retained",
      acknowledged: "Transport acknowledged; local work retained",
      discarded: "Retired; retained work remains",
      "draft-transfer": "Retired; retained work remains",
    } as const;
    return { kind: "retained" as const, label: labels[record.reason], latest, original, changed };
  }
  const labels = {
    ready: "Queued - sends on reconnect",
    unknown: "Retained - delivery unknown",
    attempted: "Retained - attempt recorded, outcome unconfirmed",
    refused: "Not started - confirmed refusal; local work retained",
  } as const;
  return {
    kind: record.delivery.state === "ready" ? ("ready" as const) : ("retained" as const),
    label: labels[record.delivery.state],
    latest,
    original,
    changed,
  };
}

/** Exact projected row lookup preserves lifecycle and account visibility. */
export function currentThreadOutboxPresentation(message: QueuedThreadMessage) {
  return threadOutboxPresentation(message, threadOutboxManager.recordFor(message));
}
