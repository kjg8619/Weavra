import { WeavraCapabilityInventory, type WeavraControlObservation } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const sameInventory = Schema.toEquivalence(WeavraCapabilityInventory);

export interface CapabilityInventoryView {
  readonly status: "NOT_EXPOSED" | "CURRENT" | "UNKNOWN" | "NEEDS_REFRESH";
  readonly inventory: WeavraCapabilityInventory | null;
}

/** Display-only observation clock. No workflow or permission state enters this tracker. */
export function makeCapabilityInventoryTracker() {
  let first = true;
  let cursor: WeavraCapabilityInventory | undefined;
  let receivedAt: number | undefined;
  let visible: WeavraCapabilityInventory | null = null;
  const retired = new Set<string>();
  let status: CapabilityInventoryView["status"] = "NOT_EXPOSED";
  const key = (value: WeavraCapabilityInventory) => `${value.ownerId}/${value.brokerEpoch}`;
  const view = (now: number): CapabilityInventoryView => ({
    status:
      status === "CURRENT" && (receivedAt === undefined || now - receivedAt >= 5_000)
        ? "NEEDS_REFRESH"
        : status,
    inventory: visible,
  });
  return {
    view,
    restart() {
      first = true;
      receivedAt = undefined;
      visible = null;
      status = "NOT_EXPOSED";
    },
    stale(discard = false) {
      receivedAt = undefined;
      if (discard) visible = null;
      status = visible ? "NEEDS_REFRESH" : "NOT_EXPOSED";
    },
    receive(observation: WeavraControlObservation, now: number) {
      const baseline = first;
      first = false;
      const next = observation.state?.capabilityInventory;
      if (!next) {
        visible = null;
        receivedAt = undefined;
        status = "NOT_EXPOSED";
        return view(now);
      }
      const checked = observation.status === "CONNECTED" && !observation.stale;
      if (
        (!checked && !baseline) ||
        next.ownerId !== observation.state?.ownerId ||
        next.ownerId !== observation.capabilities?.ownerId ||
        next.projectRevision !== observation.state?.projectRevision
      ) {
        receivedAt = undefined;
        visible = null;
        status = "NEEDS_REFRESH";
        return view(now);
      }
      const sameEpoch = cursor !== undefined && key(cursor) === key(next);
      if (
        retired.has(key(next)) ||
        (sameEpoch &&
          cursor &&
          (next.generation < cursor.generation ||
            (next.generation === cursor.generation && !sameInventory(next, cursor))))
      ) {
        receivedAt = undefined;
        visible = null;
        status = "NEEDS_REFRESH";
        return view(now);
      }
      const advanced = !sameEpoch || (cursor !== undefined && next.generation > cursor.generation);
      if (cursor && !sameEpoch) retired.add(key(cursor));
      cursor = next;
      visible = next;
      if (next.status !== "CURRENT") {
        receivedAt = undefined;
        status = next.status;
      } else if (baseline || !checked) {
        receivedAt = undefined;
        status = "NEEDS_REFRESH";
      } else if (advanced) {
        receivedAt = now;
        status = "CURRENT";
      } else if (receivedAt === undefined) {
        status = "NEEDS_REFRESH";
      }
      return view(now);
    },
  };
}
