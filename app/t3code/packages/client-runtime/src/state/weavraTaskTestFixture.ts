import {
  CommandId,
  EnvironmentId,
  ProjectId,
  ThreadId,
  WeavraTask,
  WeavraTaskId,
  WS_METHODS,
  type WeavraTaskObservation,
  type WeavraTaskObserveInput,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import { EnvironmentSupervisor } from "../connection/supervisor.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import type { WeavraTaskViewState } from "./weavraTask.ts";

export const environmentId = EnvironmentId.make("task-environment");
export const projectId = ProjectId.make("task-project");
export const threadId = ThreadId.make("task-thread");
export const taskId = WeavraTaskId.make("11111111-1111-4111-8111-111111111111");
const executionId = "22222222-2222-4222-8222-222222222222";
const digest = `sha256:${"a".repeat(64)}`;
export const input: WeavraTaskObserveInput = { environmentId, projectId, threadId, taskId };
const target = new PrimaryConnectionTarget({
  environmentId,
  label: "Task fixture",
  httpBaseUrl: "http://localhost",
  wsBaseUrl: "ws://localhost",
});
export const decodeTask = Schema.decodeUnknownSync(WeavraTask);
const checkout = {
  canonicalCwd: "/tmp/task-project",
  repositoryRoot: "/tmp/task-project",
  headCommit: "a".repeat(40),
  workspaceDigest: digest,
};
const context = {
  version: 1,
  packetVersion: 1,
  authority: "ADVISORY_ONLY",
  reviewedAt: 1,
  symptom: "The task fixture fails",
  observations: [],
  candidateCause: null,
  uncertainties: [],
  sourceReferences: [],
  constraints: [],
} as const;
const binding = {
  taskId,
  environmentId,
  projectId,
  threadId,
  checkout,
  executionId,
  packetVersion: 1,
  advisoryDigest: digest,
};

export function task(revision: number, terminal = false) {
  return decodeTask({
    id: taskId,
    createCommandId: CommandId.make("task-create"),
    environmentId,
    projectId,
    threadId,
    target: { workspaceRoot: checkout.repositoryRoot, worktreePath: null },
    checkout,
    phase: terminal ? "finished" : "running",
    revision,
    context,
    execution: {
      binding,
      previewId: "preview",
      previewDigest: digest,
      configDigest: digest,
      confirmedProjectRevision: 0,
      confirmCommandId: CommandId.make("confirm"),
      receipt: {
        status: "FOUND",
        executionId,
        admission: {
          metadata: {
            binding,
            previewDigest: digest,
            configDigest: digest,
            confirmedProjectRevision: 0,
            admittedProjectRevision: 1,
          },
          outcome: { status: "STARTED", runId: "run-1" },
          acceptedAt: 1,
          updatedAt: revision,
        },
        run: {
          runId: "run-1",
          status: terminal ? "FAILED" : "RUNNING",
          revision,
        },
      },
    },
    ownership: {
      generation: revision,
      state: terminal ? "released" : "reconciling",
    },
    createdAt: "2026-09-28T00:00:00.000Z",
    updatedAt: `2026-09-28T00:00:0${revision}.000Z`,
  });
}

export interface ObservationSubscription {
  readonly input: WeavraTaskObserveInput;
  readonly events: Queue.Queue<WeavraTaskObservation>;
}

export const makeSession = Effect.fnUntraced(function* (
  capabilities: {
    readonly weavraTasks?: boolean;
    readonly weavraTaskAnalysis?: "codex-read-only-v1";
  } = { weavraTasks: true, weavraTaskAnalysis: "codex-read-only-v1" },
) {
  const subscriptions = yield* Queue.unbounded<ObservationSubscription>();
  const requests: unknown[] = [];
  const client = {
    [WS_METHODS.weavraTaskObserve]: (selected: WeavraTaskObserveInput) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const events = yield* Queue.unbounded<WeavraTaskObservation>();
          yield* Queue.offer(subscriptions, { input: selected, events });
          return Stream.fromQueue(events);
        }),
      ),
    [WS_METHODS.weavraTaskList]: (selected: unknown) =>
      Effect.sync(() => {
        requests.push(selected);
        return [];
      }),
    [WS_METHODS.weavraTaskAnalyze]: (selected: unknown) =>
      Effect.sync(() => {
        requests.push(selected);
        return task(1);
      }),
    [WS_METHODS.weavraTaskFollowup]: (selected: unknown) =>
      Effect.sync(() => {
        requests.push(selected);
        return task(1);
      }),
  } as unknown as WsRpcProtocolClient;
  const session: RpcSession = {
    client,
    initialConfig: Effect.succeed({ environment: { capabilities } } as never),
    subscribeServerConfig: () => Stream.empty,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
  return { session, subscriptions, requests };
});

export const setup = Effect.fnUntraced(function* (current: RpcSession) {
  return EnvironmentSupervisor.of({
    target,
    session: yield* SubscriptionRef.make<Option.Option<RpcSession>>(Option.some(current)),
    state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
    prepared: yield* SubscriptionRef.make<Option.Option<PreparedConnection>>(Option.none()),
    connect: Effect.void,
    disconnect: Effect.void,
    retryNow: Effect.void,
  });
});

export function waitFor(
  state: SubscriptionRef.SubscriptionRef<WeavraTaskViewState>,
  predicate: (value: WeavraTaskViewState) => boolean,
) {
  return SubscriptionRef.changes(state).pipe(
    Stream.filter(predicate),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
}
