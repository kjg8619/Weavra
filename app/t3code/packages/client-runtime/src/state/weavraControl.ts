import {
  EnvironmentId,
  ProjectId,
  WeavraComplexDraft,
  WeavraComplexExecution,
  WeavraControlMutation,
  WeavraControlTransportError,
  WS_METHODS,
  type WeavraControlObservation,
  type WeavraControlResponse,
  type WeavraControlState,
  type WeavraDerivedDraft,
  type WeavraPlannerStatus,
} from "@t3tools/contracts";
import { sha256Hex } from "@t3tools/shared/sha256";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";
import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { request, subscribeDynamicWithSession } from "../rpc/client.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createEnvironmentRpcCommand, followStreamInEnvironment } from "./runtime.ts";
import {
  makeCapabilityInventoryTracker,
  type CapabilityInventoryView,
} from "./capabilityInventory.ts";

export interface WeavraControlViewState {
  readonly support: "unknown" | "supported" | "unsupported";
  readonly observation: WeavraControlObservation;
  readonly capabilityInventory: CapabilityInventoryView;
}
interface WeavraControlCache {
  observation?: WeavraControlObservation;
  owner?: symbol;
}
const empty: WeavraControlObservation = {
  status: "DISCONNECTED",
  state: null,
  capabilities: null,
  stale: true,
  observedAt: null,
  errorCode: null,
};
const initial: WeavraControlViewState = {
  support: "unknown",
  observation: empty,
  capabilityInventory: { status: "NOT_EXPOSED", inventory: null },
};
const sameExecution = Schema.toEquivalence(WeavraComplexExecution);
/**
 * Same COMPLEX Run, state revision and contract version must carry the same canonical data; key
 * order is irrelevant. Another contract version comes only from a reconnected Runtime, whose
 * checked observation replaces the old one as on the server.
 */
function complexChanged(previous: WeavraControlState, next: WeavraControlState) {
  const before = previous.complexExecution;
  const after = next.complexExecution;
  return (
    before !== undefined &&
    after !== undefined &&
    before.runId === after.runId &&
    before.stateRevision === after.stateRevision &&
    before.schemaVersion === after.schemaVersion &&
    // Owner and project revision are observation-envelope values, not execution data.
    !sameExecution(before, {
      ...after,
      ownerId: before.ownerId,
      projectRevision: before.projectRevision,
    })
  );
}

/** Each session must receive canonical control state before cached data becomes current. */
export const makeEnvironmentWeavraControlState = Effect.fn("EnvironmentWeavraControlState.make")(
  function* (projectId: ProjectId, cache: WeavraControlCache = {}) {
    const supervisor = yield* EnvironmentSupervisor;
    const owner = Symbol();
    cache.owner = owner;
    const inventory = makeCapabilityInventoryTracker();
    let current: WeavraControlViewState = {
      support: "unknown",
      observation: { ...(cache.observation ?? empty), status: "DISCONNECTED", stale: true },
      capabilityInventory: inventory.view(performance.now()),
    };
    let producer: RpcSession | undefined;
    // The first emission of every subscription is the server's cached value: historical only.
    let historicalFirst = false;
    const state = yield* SubscriptionRef.make(current);
    const update = (next: Omit<WeavraControlViewState, "capabilityInventory">) =>
      Effect.gen(function* () {
        if (cache.owner !== owner) return;
        if (next.observation.stale || next.observation.status !== "CONNECTED") {
          inventory.stale(next.observation.state === null);
        }
        current = { ...next, capabilityInventory: inventory.view(performance.now()) };
        cache.observation = next.observation;
        yield* SubscriptionRef.set(state, current);
      });
    const unavailable = () =>
      update({
        ...current,
        observation: {
          ...current.observation,
          status: "ERROR",
          stale: true,
          errorCode: "STATE_UNAVAILABLE",
        },
      });
    yield* SubscriptionRef.changes(supervisor.session).pipe(
      Stream.runForEach((session) => {
        if (Option.isSome(session) && producer === session.value) return Effect.void;
        producer = Option.getOrUndefined(session);
        inventory.restart();
        return update({
          support: "unknown",
          observation: {
            ...current.observation,
            status: Option.isNone(session) ? "DISCONNECTED" : "RECONNECTING",
            stale: true,
          },
        });
      }),
      Effect.forkScoped,
    );
    yield* subscribeDynamicWithSession(
      WS_METHODS.weavraControlObserve,
      (session) =>
        Effect.gen(function* () {
          const config = yield* session.initialConfig.pipe(Effect.orElseSucceed(() => null));
          const active = yield* SubscriptionRef.get(supervisor.session);
          if (Option.isNone(active) || active.value !== session || cache.owner !== owner)
            return yield* Effect.never;
          producer = session;
          inventory.restart();
          const supported = config?.environment.capabilities.weavraControl === true;
          yield* update({
            support: supported ? "supported" : "unsupported",
            observation: { ...current.observation, status: "RECONNECTING", stale: true },
          });
          // No unknown feature RPC is ever sent to an older environment.
          if (!supported) return yield* Effect.never;
          historicalFirst = true;
          return { projectId };
        }),
      { onExpectedFailure: unavailable, onDefect: unavailable },
    ).pipe(
      Stream.runForEach(([session, received]) =>
        Effect.gen(function* () {
          const active = yield* SubscriptionRef.get(supervisor.session);
          if (Option.isNone(active) || active.value !== session || cache.owner !== owner) return;
          producer = session;
          // Only a later observation, checked by the server on its bound transport, is current.
          const observation = historicalFirst ? { ...received, stale: true } : received;
          historicalFirst = false;
          const previous = current.observation;
          const oldState = previous.state;
          const nextState = observation.state;
          if (
            observation.errorCode === "PROJECT_CHANGED" ||
            observation.errorCode === "PROJECT_UNAVAILABLE"
          ) {
            inventory.stale(true);
            yield* update({
              support: "supported",
              observation: { ...observation, state: null, capabilities: null, stale: true },
            });
            return;
          }
          const ownerChanged =
            oldState !== null &&
            ((nextState !== null && nextState.ownerId !== oldState.ownerId) ||
              (observation.capabilities !== null &&
                observation.capabilities.ownerId !== oldState.ownerId));
          if (
            oldState &&
            nextState &&
            (nextState.projectRevision < oldState.projectRevision ||
              (oldState.snapshot.status.run?.runId === nextState.snapshot.status.run?.runId &&
                oldState.stateRevision !== null &&
                (nextState.stateRevision === null ||
                  nextState.stateRevision < oldState.stateRevision)) ||
              complexChanged(oldState, nextState))
          ) {
            inventory.stale(ownerChanged);
            yield* update({
              support: "supported",
              observation: {
                ...(ownerChanged ? { ...observation, state: null } : previous),
                status: "ERROR",
                stale: true,
                errorCode: "REVISION_REGRESSION",
              },
            });
            return;
          }
          // Never carry a prior owner's preview or approval into a new control epoch.
          const retained =
            nextState === null && observation.stale && oldState !== null && !ownerChanged
              ? { ...observation, state: oldState, observedAt: previous.observedAt }
              : observation;
          const before = inventory.view(performance.now());
          const after = inventory.receive(observation, performance.now());
          if (
            after.status === "CURRENT" &&
            (before.status !== "CURRENT" ||
              before.inventory?.generation !== after.inventory?.generation ||
              before.inventory?.brokerEpoch !== after.inventory?.brokerEpoch)
          ) {
            yield* Effect.sleep(5_000).pipe(
              Effect.andThen(Effect.suspend(() => update(current))),
              Effect.forkScoped,
            );
          }
          yield* update({ support: "supported", observation: retained });
        }),
      ),
      Effect.catchCause(() => unavailable()),
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (cache.owner === owner) {
          cache.observation = { ...current.observation, stale: true };
          delete cache.owner;
        }
      }),
    );
    return state;
  },
);

export function createEnvironmentWeavraControlStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const cacheFamily = Atom.family((key: string) =>
    Atom.make((): WeavraControlCache => ({})).pipe(
      Atom.setIdleTTL(5 * 60_000),
      Atom.withLabel(`weavra-control-cache:${key}`),
    ),
  );
  const family = Atom.family((key: string) => {
    const [environmentId, projectId] = JSON.parse(key) as [string, string, string];
    const cacheAtom = cacheFamily(key);
    return runtime
      .atom(
        (get) => {
          get.mount(cacheAtom);
          const cache = get.once(cacheAtom);
          return followStreamInEnvironment(
            EnvironmentId.make(environmentId),
            Stream.unwrap(
              makeEnvironmentWeavraControlState(ProjectId.make(projectId), cache).pipe(
                Effect.map(SubscriptionRef.changes),
              ),
            ),
          );
        },
        { initialValue: initial },
      )
      .pipe(Atom.setIdleTTL(0), Atom.withLabel(`weavra-control-observation:${key}`));
  });
  return {
    stateAtom: (environmentId: EnvironmentId, projectId: ProjectId, workspaceRoot: string) =>
      family(JSON.stringify([environmentId, projectId, workspaceRoot])),
  };
}

export function createEnvironmentWeavraControlCommand<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return createEnvironmentRpcCommand(runtime, {
    label: "environment-command:weavra:control",
    tag: WS_METHODS.weavraControl,
    execute: (input) =>
      Effect.gen(function* () {
        const supervisor = yield* EnvironmentSupervisor;
        const session = yield* SubscriptionRef.get(supervisor.session);
        if (Option.isNone(session)) {
          return yield* Effect.fail(new WeavraControlTransportError({ code: "TRANSPORT_CLOSED" }));
        }
        const config = yield* session.value.initialConfig.pipe(Effect.orElseSucceed(() => null));
        const active = yield* SubscriptionRef.get(supervisor.session);
        if (Option.isNone(active) || active.value !== session.value) {
          return yield* Effect.fail(new WeavraControlTransportError({ code: "TRANSPORT_CLOSED" }));
        }
        if (config?.environment.capabilities.weavraControl !== true) {
          return yield* Effect.fail(
            new WeavraControlTransportError({ code: "INCOMPATIBLE_CAPABILITIES" }),
          );
        }
        return yield* request(WS_METHODS.weavraControl, input);
      }),
  });
}

// V0.8B Planner (docs/architecture/PLANNER_DRAFT.md §6, §7, §9). A Planner draft is candidate data
// for the human's editor. These helpers never prepare, confirm or persist anything.

/**
 * The Host's `requestDigest` (§6), recomputed for the editor's goal and criteria: `sha256:` and the
 * lowercase hex SHA-256 of the UTF-8 JSON of the domain, the goal and the statements, exactly as
 * sent. Omitted statements are `[]`.
 */
export function plannerRequestDigest(
  goal: string,
  acceptanceStatements: ReadonlyArray<string> = [],
): string {
  return `sha256:${sha256Hex(JSON.stringify(["weavra-planner-request-v1", goal, acceptanceStatements]))}`;
}

/**
 * The planning status of a connection that advertises the Planner. Without the advertisement the
 * Planner does not exist there, whatever a snapshot carries.
 */
export function plannerStatusOf(
  observation: WeavraControlObservation | null | undefined,
): WeavraPlannerStatus | null {
  return observation?.capabilities?.plannerContractVersion === 1
    ? (observation.state?.planner ?? null)
    : null;
}

/** Planning time by the Host clock: until it finished, else until the last checked observation. */
export function plannerElapsedMs(planner: WeavraPlannerStatus, observedAt: number | null) {
  const end = planner.finishedAt ?? observedAt;
  return end === null ? null : Math.max(0, end - planner.startedAt);
}

type MutationEnvelope = Pick<
  WeavraControlMutation,
  "protocolVersion" | "id" | "ownerId" | "expectedProjectRevision"
>;
const decodeMutation = Schema.decodeUnknownSync(WeavraControlMutation, {
  onExcessProperty: "error",
});
/** Only the goal and criteria; Runtime classifies and bounds the rest. Throws on invalid input. */
export function plannerStartRequest(
  envelope: MutationEnvelope,
  goal: string,
  acceptanceStatements: ReadonlyArray<string>,
) {
  return decodeMutation({
    ...envelope,
    type: "planner.start",
    goal,
    ...(acceptanceStatements.length > 0 ? { acceptanceStatements } : {}),
  });
}
export function plannerCancelRequest(envelope: MutationEnvelope, planId: string) {
  return decodeMutation({ ...envelope, type: "planner.cancel", planId });
}
export function plannerReadRequest(envelope: MutationEnvelope, planId: string) {
  return decodeMutation({ ...envelope, type: "planner.read", planId });
}

/** The editor's record of the Planner draft it loaded (§9). Page-session memory only. */
export interface PlannerLoadedDraft {
  readonly planId: string;
  readonly requestDigest: string;
  readonly current: boolean;
  readonly draft: WeavraComplexDraft;
}
/** The draft of a `planner.read` response for exactly this planning request, else null. */
export function plannerLoadedDraft(
  response: WeavraControlResponse,
  planId: string,
): PlannerLoadedDraft | null {
  if (!response.success || response.data.kind !== "planner-draft") return null;
  const { data } = response;
  return data.planId === planId
    ? { planId, requestDigest: data.requestDigest, current: data.current, draft: data.draft }
    : null;
}
const sameDraft = Schema.toEquivalence(WeavraComplexDraft);
/** True while the editor holds exactly the loaded draft; key order is not an edit. */
export function plannerDraftUnchanged(
  loaded: PlannerLoadedDraft | null,
  editor: WeavraComplexDraft,
): boolean {
  return loaded !== null && sameDraft(loaded.draft, editor);
}

// V0.8C re-run (docs/architecture/COMPLEX_RERUN.md §6, §7). A derived draft is candidate data for
// the human's editor: a filled-in planning form for an ordinary new Run. These helpers never
// prepare, confirm, run Git or persist anything, and nothing resumes or reuses evidence.

/** Advertisement only: without `rerunContractVersion: 1` re-run derivation does not exist. */
export function rerunExposed(observation: WeavraControlObservation | null | undefined): boolean {
  return observation?.capabilities?.rerunContractVersion === 1;
}

const rerunSourceStatuses: ReadonlySet<string> = new Set([
  "BLOCKED",
  "CANCELLED",
  "FAILED",
  "INTERRUPTED",
]);
/**
 * The §7 snapshot conditions for offering a re-plan: the latest Run is a COMPLEX Run that ended
 * BLOCKED, CANCELLED, FAILED or INTERRUPTED, is not R3, and its projection has an unfinished row.
 * Runtime checks eligibility again (§3); this only decides what the App offers.
 */
export function rerunEligible(state: WeavraControlState | null | undefined): boolean {
  const run = state?.snapshot.status.run;
  const execution = state?.complexExecution;
  return (
    run !== null &&
    run !== undefined &&
    execution !== undefined &&
    execution.runId === run.runId &&
    run.workflow === "COMPLEX" &&
    rerunSourceStatuses.has(run.status) &&
    run.risk !== "R3" &&
    execution.tasks.some((task) => task.status !== "COMPLETED")
  );
}

/** The mutation envelope and the Run to derive from; Runtime derives everything else. */
export function deriveRequest(envelope: MutationEnvelope, runId: string) {
  return decodeMutation({ ...envelope, type: "workflow.derive", runId });
}

/** The editor's record of the derived draft it loaded (§7). Page-session memory only. */
export interface DerivedLoadedDraft extends Omit<WeavraDerivedDraft, "kind"> {
  /** COMPLETED rows of the source Run: they became read-only verification tasks. */
  readonly completedTasks: number;
}
/**
 * The derived draft of a `workflow.derive` response for exactly this Run, read beside the
 * projection of that Run, else null. The draft keeps the source plan's task count (§4 step 2).
 */
export function derivedLoadedDraft(
  response: WeavraControlResponse,
  runId: string,
  execution: WeavraControlState["complexExecution"],
): DerivedLoadedDraft | null {
  if (!response.success || response.data.kind !== "derived-draft") return null;
  const { kind: _kind, ...derived } = response.data;
  if (
    derived.runId !== runId ||
    execution?.runId !== runId ||
    execution.tasks.length !== derived.draft.tasks.length
  )
    return null;
  return {
    ...derived,
    completedTasks: execution.tasks.filter((task) => task.status === "COMPLETED").length,
  };
}
/**
 * True when the editor can hold the draft's goal and criteria exactly: a trimmed goal and trimmed
 * single-line statements, with no carriage return a text field would turn into a line break.
 * Otherwise loading would edit them silently, because prepare trims the goal and sends one
 * criterion per nonblank line.
 */
export function derivedDraftFitsEditor(
  derived: Pick<WeavraDerivedDraft, "goal" | "acceptanceStatements">,
) {
  return (
    !derived.goal.includes("\r") &&
    derived.goal.trim() === derived.goal &&
    derived.acceptanceStatements.every(
      (statement) => !/[\r\n]/.test(statement) && statement.trim() === statement,
    )
  );
}
/** What the editor would prepare: the trimmed goal, the criterion lines and the task rows. */
export interface DerivedEditorContent {
  readonly goal: string;
  readonly acceptanceStatements: ReadonlyArray<string>;
  readonly draft: WeavraComplexDraft;
}
/** True while the editor would prepare exactly the loaded derived draft; key order is not an edit. */
export function derivedDraftUnchanged(
  loaded: Pick<DerivedLoadedDraft, "goal" | "acceptanceStatements" | "draft"> | null,
  editor: DerivedEditorContent,
): boolean {
  return (
    loaded !== null &&
    editor.goal === loaded.goal &&
    editor.acceptanceStatements.length === loaded.acceptanceStatements.length &&
    editor.acceptanceStatements.every(
      (statement, index) => statement === loaded.acceptanceStatements[index],
    ) &&
    sameDraft(loaded.draft, editor.draft)
  );
}
