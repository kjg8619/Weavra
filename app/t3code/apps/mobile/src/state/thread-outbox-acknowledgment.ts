import { retainAcknowledgedThreadMessage } from "./acknowledged-thread-messages";
import type { OutboxAcknowledgment } from "./thread-outbox-delivery";
import { retireAcknowledgedMessage } from "./thread-outbox-removal";
import { removeDeliveredCloudQueuedMessage } from "./use-composer-drafts";

/** Presentation/archive cleanup cannot mint another invocation. */
export async function completeQueuedMessageDelivery(ack: OutboxAcknowledgment): Promise<boolean> {
  const retired = await retireAcknowledgedMessage(ack);
  if (retired === null) return false;
  retainAcknowledgedThreadMessage(ack.submitted);
  await removeDeliveredCloudQueuedMessage(ack.submitted);
  return true;
}
