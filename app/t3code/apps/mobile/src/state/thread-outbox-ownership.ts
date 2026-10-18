import { Atom } from "effect/unstable/reactivity";
import type { QueuedThreadMessage } from "./thread-outbox-model";

/** Content ownership only, including hidden and failed admissions; never delivery permission. */
export const optimisticThreadOutboxOwnersAtom = Atom.make<ReadonlyArray<QueuedThreadMessage>>(
  [],
).pipe(Atom.keepAlive);
