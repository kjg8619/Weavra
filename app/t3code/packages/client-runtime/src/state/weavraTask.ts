import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  WeavraTask,
  WeavraTaskId,
  WS_METHODS,
  type WeavraTaskObservation,
  type WeavraTaskReadInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { Atom } from "effect/unstable/reactivity";

import { EnvironmentRegistry } from "../connection/registry.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { subscribeDynamicWithSession } from "../rpc/client.ts";
import type { RpcSession } from "../rpc/session.ts";
import { followStreamInEnvironment } from "./runtime.ts";

export * from "./weavraTaskRpc.ts";

export interface WeavraTaskViewState {
  readonly support: "unknown" | "supported" | "unsupported";
  readonly connection: "DISCONNECTED" | "RECONNECTING" | "CONNECTED" | "ERROR";
  readonly task: WeavraTask | null;
  readonly stale: boolean;
  readonly errorCode: "STATE_UNAVAILABLE" | "REVISION_REGRESSION" | "TARGET_CHANGED" | null;
}

interface WeavraTaskCache {
  task?: WeavraTask;
  owner?: symbol;
}

const initial: WeavraTaskViewState = {
  support: "unknown",
  connection: "DISCONNECTED",
  task: null,
  stale: true,
  errorCode: null,
};
const sameTask = Schema.toEquivalence(WeavraTask);

export const makeEnvironmentWeavraTaskState = Effect.fn("EnvironmentWeavraTaskState.make")(
  function* (input: WeavraTaskReadInput, cache: WeavraTaskCache = {}) {
    const supervisor = yield* EnvironmentSupervisor;
    const owner = Symbol();
    cache.owner = owner;
    let current: WeavraTaskViewState = {
      ...initial,
      task: cache.task ?? null,
    };
    let producer: RpcSession | undefined;
    let synchronized = false;
    const state = yield* SubscriptionRef.make(current);
    const update = (next: WeavraTaskViewState) =>
      Effect.gen(function* () {
        if (cache.owner !== owner) return;
        current = next;
        if (next.task !== null) cache.task = next.task;
        yield* SubscriptionRef.set(state, next);
      });
    const unavailable = () =>
      update({
        ...current,
        connection: "ERROR",
        stale: true,
        errorCode: "STATE_UNAVAILABLE",
      });
    yield* SubscriptionRef.changes(supervisor.session).pipe(
      Stream.runForEach((session) => {
        if (Option.isSome(session) && producer === session.value) return Effect.void;
        producer = Option.getOrUndefined(session);
        synchronized = false;
        return update({
          ...current,
          support: "unknown",
          connection: Option.isNone(session) ? "DISCONNECTED" : "RECONNECTING",
          stale: true,
          errorCode: null,
        });
      }),
      Effect.forkScoped,
    );
    yield* subscribeDynamicWithSession(
      WS_METHODS.weavraTaskObserve,
      (session) =>
        Effect.gen(function* () {
          const config = yield* session.initialConfig.pipe(Effect.orElseSucceed(() => null));
          const active = yield* SubscriptionRef.get(supervisor.session);
          if (Option.isNone(active) || active.value !== session || cache.owner !== owner) {
            return yield* Effect.never;
          }
          producer = session;
          synchronized = false;
          const supported = config?.environment.capabilities.weavraTasks === true;
          yield* update({
            ...current,
            support: supported ? "supported" : "unsupported",
            connection: "RECONNECTING",
            stale: true,
            errorCode: null,
          });
          if (!supported) return yield* Effect.never;
          return input;
        }),
      { onExpectedFailure: unavailable, onDefect: unavailable },
    ).pipe(
      Stream.runForEach(([session, observation]) =>
        Effect.gen(function* () {
          const active = yield* SubscriptionRef.get(supervisor.session);
          if (Option.isNone(active) || active.value !== session || cache.owner !== owner) return;
          producer = session;
          const task = observation.task;
          if (
            task.environmentId !== input.environmentId ||
            task.projectId !== input.projectId ||
            task.threadId !== input.threadId ||
            task.id !== input.taskId
          ) {
            synchronized = false;
            yield* update({
              ...current,
              connection: "ERROR",
              task: null,
              stale: true,
              errorCode: "TARGET_CHANGED",
            });
            return;
          }
          if (
            current.task !== null &&
            (task.revision < current.task.revision ||
              (task.revision === current.task.revision && !sameTask(task, current.task)))
          ) {
            yield* update({
              ...current,
              connection: "ERROR",
              stale: true,
              errorCode: "REVISION_REGRESSION",
            });
            return;
          }
          if (observation.kind === "snapshot") {
            yield* update({
              support: "supported",
              connection: "RECONNECTING",
              task,
              stale: true,
              errorCode: null,
            });
            return;
          }
          if (observation.kind === "synchronized") synchronized = true;
          yield* update({
            support: "supported",
            connection: synchronized ? "CONNECTED" : "RECONNECTING",
            task,
            stale: !synchronized,
            errorCode: null,
          });
        }),
      ),
      Effect.catchCause(() => unavailable()),
      Effect.forkScoped,
    );
    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        if (cache.owner === owner) {
          if (current.task !== null) cache.task = current.task;
          delete cache.owner;
        }
      }),
    );
    return state;
  },
);

export function createEnvironmentWeavraTaskStateAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  const cacheFamily = Atom.family((key: string) =>
    Atom.make((): WeavraTaskCache => ({})).pipe(
      Atom.setIdleTTL(5 * 60_000),
      Atom.withLabel(`weavra-task-cache:${key}`),
    ),
  );
  const family = Atom.family((key: string) => {
    const [environmentId, projectId, threadId, taskId] = JSON.parse(key) as [
      string,
      string,
      string,
      string,
    ];
    const input: WeavraTaskReadInput = {
      environmentId: EnvironmentId.make(environmentId),
      projectId: ProjectId.make(projectId),
      threadId: ThreadId.make(threadId),
      taskId: WeavraTaskId.make(taskId),
    };
    const cacheAtom = cacheFamily(key);
    return runtime
      .atom(
        (get) => {
          get.mount(cacheAtom);
          const cache = get.once(cacheAtom);
          return followStreamInEnvironment(
            input.environmentId,
            Stream.unwrap(
              makeEnvironmentWeavraTaskState(input, cache).pipe(
                Effect.map(SubscriptionRef.changes),
              ),
            ),
          );
        },
        { initialValue: initial },
      )
      .pipe(Atom.setIdleTTL(0), Atom.withLabel(`weavra-task-observation:${key}`));
  });
  return {
    stateAtom: (
      environmentId: EnvironmentId,
      projectId: ProjectId,
      threadId: ThreadId,
      taskId: WeavraTaskId,
    ) => family(JSON.stringify([environmentId, projectId, threadId, taskId])),
  };
}

export function isFreshWeavraTaskObservation(
  state: WeavraTaskViewState,
): state is WeavraTaskViewState & { readonly task: WeavraTask; readonly stale: false } {
  return state.support === "supported" && state.connection === "CONNECTED" && !state.stale;
}

export function taskFromObservation(observation: WeavraTaskObservation): WeavraTask {
  return observation.task;
}
