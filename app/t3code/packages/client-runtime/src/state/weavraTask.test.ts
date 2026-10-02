import { it } from "@effect/vitest";
import { CommandId, MessageId, WS_METHODS } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Scope from "effect/Scope";
import * as SubscriptionRef from "effect/SubscriptionRef";
import { expect } from "vite-plus/test";

import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import { makeEnvironmentWeavraTaskState, requestWeavraTask } from "./weavraTask.ts";
import {
  decodeTask,
  environmentId,
  input,
  makeSession,
  projectId,
  setup,
  task,
  threadId,
  waitFor,
} from "./weavraTaskTestFixture.ts";

for (const capabilities of [{}, { weavraTasks: false }]) {
  it.effect(
    `sends zero task RPCs without explicit capability (${JSON.stringify(capabilities)})`,
    () =>
      Effect.gen(function* () {
        const remote = yield* makeSession(capabilities);
        const supervisor = yield* setup(remote.session);
        const state = yield* makeEnvironmentWeavraTaskState(input).pipe(
          Effect.provideService(EnvironmentSupervisor, supervisor),
        );
        yield* waitFor(state, (view) => view.support === "unsupported");
        expect(yield* Queue.size(remote.subscriptions)).toBe(0);
        const result = yield* requestWeavraTask(WS_METHODS.weavraTaskList, {
          environmentId,
          projectId,
          threadId,
        }).pipe(Effect.provideService(EnvironmentSupervisor, supervisor), Effect.result);
        expect(result._tag).toBe("Failure");
        if (result._tag === "Failure") {
          expect(result.failure).toMatchObject({ code: "INCOMPATIBLE_CAPABILITIES" });
        }
        expect(remote.requests).toEqual([]);
      }).pipe(Effect.scoped),
  );
}

it.effect("requires explicit controlled-analysis capability before sending analyze", () =>
  Effect.gen(function* () {
    const unsupported = yield* makeSession({ weavraTasks: true });
    const unsupportedSupervisor = yield* setup(unsupported.session);
    const denied = yield* requestWeavraTask(WS_METHODS.weavraTaskAnalyze, {
      task: input,
      commandId: CommandId.make("analysis-command"),
      messageId: MessageId.make("analysis-message"),
      text: "Analyze only.",
      expectedRevision: 1,
    }).pipe(Effect.provideService(EnvironmentSupervisor, unsupportedSupervisor), Effect.result);
    expect(denied._tag).toBe("Failure");
    expect(unsupported.requests).toEqual([]);

    const supported = yield* makeSession();
    const supportedSupervisor = yield* setup(supported.session);
    const result = yield* requestWeavraTask(WS_METHODS.weavraTaskAnalyze, {
      task: input,
      commandId: CommandId.make("analysis-command"),
      messageId: MessageId.make("analysis-message"),
      text: "Analyze only.",
      expectedRevision: 1,
    }).pipe(Effect.provideService(EnvironmentSupervisor, supportedSupervisor));
    expect(result.id).toBe(input.taskId);
    expect(supported.requests).toHaveLength(1);
  }).pipe(Effect.scoped),
);

it.effect("marks snapshot history stale until synchronized without sending mutations", () =>
  Effect.gen(function* () {
    const remote = yield* makeSession();
    const supervisor = yield* setup(remote.session);
    const state = yield* makeEnvironmentWeavraTaskState(input).pipe(
      Effect.provideService(EnvironmentSupervisor, supervisor),
    );
    const subscription = yield* Queue.take(remote.subscriptions);
    expect(subscription.input).toEqual(input);
    const current = task(2);
    yield* Queue.offer(subscription.events, { kind: "snapshot", task: current });
    const historical = yield* waitFor(state, (view) => view.task !== null);
    expect(historical).toMatchObject({ task: current, stale: true, connection: "RECONNECTING" });
    yield* Queue.offer(subscription.events, { kind: "synchronized", task: current });
    expect(yield* waitFor(state, (view) => !view.stale)).toMatchObject({
      task: current,
      connection: "CONNECTED",
    });
    expect(remote.requests).toEqual([]);
  }).pipe(Effect.scoped),
);

it.effect(
  "keeps a failed finished task stale across disconnect and ignores the retired producer",
  () =>
    Effect.gen(function* () {
      const old = yield* makeSession();
      const supervisor = yield* setup(old.session);
      const state = yield* makeEnvironmentWeavraTaskState(input).pipe(
        Effect.provideService(EnvironmentSupervisor, supervisor),
      );
      const oldSubscription = yield* Queue.take(old.subscriptions);
      const failed = task(3, true);
      yield* Queue.offer(oldSubscription.events, { kind: "snapshot", task: failed });
      yield* Queue.offer(oldSubscription.events, { kind: "synchronized", task: failed });
      yield* waitFor(state, (view) => !view.stale);
      yield* SubscriptionRef.set(supervisor.session, Option.none());
      const disconnected = yield* waitFor(state, (view) => view.connection === "DISCONNECTED");
      expect(disconnected.stale).toBe(true);
      expect(disconnected.task?.phase).toBe("finished");
      expect(disconnected.task?.execution?.receipt).toMatchObject({
        run: { status: "FAILED" },
      });

      const fresh = yield* makeSession();
      yield* SubscriptionRef.set(supervisor.session, Option.some(fresh.session));
      const nextSubscription = yield* Queue.take(fresh.subscriptions);
      yield* Queue.offer(oldSubscription.events, { kind: "update", task: task(99) });
      yield* Queue.offer(nextSubscription.events, { kind: "snapshot", task: failed });
      const reconnecting = yield* waitFor(
        state,
        (view) => view.connection === "RECONNECTING" && view.task?.revision === failed.revision,
      );
      expect(reconnecting.stale).toBe(true);
      expect(reconnecting.task?.execution?.receipt).toMatchObject({
        run: { runId: "run-1", status: "FAILED" },
      });
      yield* Queue.offer(nextSubscription.events, { kind: "synchronized", task: failed });
      expect((yield* waitFor(state, (view) => !view.stale)).task?.revision).toBe(failed.revision);
      expect(fresh.requests).toEqual([]);
    }).pipe(Effect.scoped),
);

it.effect("old scope finalization cannot retire the replacement task cache", () =>
  Effect.gen(function* () {
    const old = yield* makeSession();
    const fresh = yield* makeSession();
    const cache = { task: task(1) };
    const oldScope = yield* Scope.make();
    const oldSupervisor = yield* setup(old.session);
    yield* makeEnvironmentWeavraTaskState(input, cache).pipe(
      Effect.provideService(EnvironmentSupervisor, oldSupervisor),
      Scope.provide(oldScope),
    );
    yield* Queue.take(old.subscriptions);
    const freshSupervisor = yield* setup(fresh.session);
    const state = yield* makeEnvironmentWeavraTaskState(input, cache).pipe(
      Effect.provideService(EnvironmentSupervisor, freshSupervisor),
    );
    const subscription = yield* Queue.take(fresh.subscriptions);
    const replacement = task(4);
    yield* Queue.offer(subscription.events, { kind: "snapshot", task: replacement });
    yield* Queue.offer(subscription.events, { kind: "synchronized", task: replacement });
    yield* waitFor(state, (view) => !view.stale);
    yield* Scope.close(oldScope, Exit.void);
    expect(cache.task).toEqual(replacement);
    expect((yield* SubscriptionRef.get(state)).task).toEqual(replacement);
  }).pipe(Effect.scoped),
);

it.effect("rejects a changed duplicate revision without replacing the cached task", () =>
  Effect.gen(function* () {
    const remote = yield* makeSession();
    const supervisor = yield* setup(remote.session);
    const current = task(2);
    const state = yield* makeEnvironmentWeavraTaskState(input, { task: current }).pipe(
      Effect.provideService(EnvironmentSupervisor, supervisor),
    );
    const subscription = yield* Queue.take(remote.subscriptions);
    const changed = decodeTask({
      ...current,
      phase: "attention-required",
    });
    yield* Queue.offer(subscription.events, { kind: "snapshot", task: changed });
    const rejected = yield* waitFor(state, (view) => view.errorCode === "REVISION_REGRESSION");
    expect(rejected.task).toEqual(current);
    expect(rejected.stale).toBe(true);
  }).pipe(Effect.scoped),
);

it.effect("requires explicit recovery capability and sends no RPC to legacy environments", () =>
  Effect.gen(function* () {
    const remote = yield* makeSession({ weavraTasks: true });
    const supervisor = yield* setup(remote.session);
    const result = yield* requestWeavraTask(WS_METHODS.weavraTaskRecover, {
      task: input,
      expectedRevision: 1,
    }).pipe(Effect.provideService(EnvironmentSupervisor, supervisor), Effect.result);
    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure")
      expect(result.failure).toMatchObject({ code: "INCOMPATIBLE_CAPABILITIES" });
    expect(remote.requests).toEqual([]);
  }).pipe(Effect.scoped),
);
