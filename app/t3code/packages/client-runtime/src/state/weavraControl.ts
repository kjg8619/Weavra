import {
  EnvironmentId,
  ProjectId,
  WeavraComplexExecution,
  WeavraControlTransportError,
  WS_METHODS,
  type WeavraControlObservation,
  type WeavraControlState,
} from "@t3tools/contracts";
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
