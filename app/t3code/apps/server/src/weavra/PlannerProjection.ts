import type {
  WeavraComplexDraft,
  WeavraControlCapabilities,
  WeavraControlState,
} from "@t3tools/contracts";

// Consumer checks for the V0.8B Planner (docs/architecture/PLANNER_DRAFT.md §2, §3, §7.3). Runtime
// stays the authority: these predicates only reject inconsistent observations before publication.
// Planner state is display data, and its draft never travels in a snapshot.

type Planner = NonNullable<WeavraControlState["planner"]>;
const TERMINAL = new Set<Planner["status"]>(["READY", "FAILED", "CANCELLED"]);

/** One planning request keeps its identity, never leaves a terminal status and never un-spends. */
function transitionConsistent(before: Planner, after: Planner) {
  const tokens = before.usage.reportedTokens;
  const next = after.usage.reportedTokens;
  return (
    after.requestDigest === before.requestDigest &&
    after.projectRevision === before.projectRevision &&
    after.startedAt === before.startedAt &&
    after.usage.invocations >= before.usage.invocations &&
    // Unknown usage stays unknown for the rest of the request.
    (tokens === null ? next === null : next === null || next >= tokens) &&
    (!TERMINAL.has(before.status) ||
      (after.status === before.status &&
        after.finishedAt === before.finishedAt &&
        after.taskCount === before.taskCount &&
        after.failureCode === before.failureCode))
  );
}

/**
 * §7.3 presence and §3 transitions for one checked snapshot. The key exists only on a connection
 * that advertised the Planner and forwarded a `planner.start` to this Host. Within one Host a
 * request never leaves a terminal status, and a RUNNING one never vanishes: only a confirmed Run
 * clears a terminal one, and each reconnect is a new Host with a new owner and no planner state.
 */
export function plannerStateConsistent(
  state: WeavraControlState,
  capabilities: WeavraControlCapabilities,
  previous: WeavraControlState | null,
  started: boolean,
): boolean {
  const planner = state.planner;
  const before = previous?.ownerId === state.ownerId ? previous.planner : undefined;
  if (!planner) return before?.status !== "RUNNING";
  return (
    capabilities.plannerContractVersion === 1 &&
    started &&
    (before === undefined ||
      before.planId !== planner.planId ||
      transitionConsistent(before, planner))
  );
}

/** §2: the Planner proposes only `create` and `modify` claims; a deletion is never Planner data. */
export function plannerDraftConsistent(draft: WeavraComplexDraft): boolean {
  return draft.tasks.every((task) => task.ownership.every((claim) => claim.operation !== "delete"));
}
