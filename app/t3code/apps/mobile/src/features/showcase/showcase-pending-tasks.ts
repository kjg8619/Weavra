import { Atom } from "effect/unstable/reactivity";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";

/** Presentation fixtures never enter the durable outbox or acquire send authority. */
export const showcasePendingTasksAtom = Atom.make<ReadonlyArray<QueuedThreadMessage>>([]).pipe(
  Atom.keepAlive,
);
