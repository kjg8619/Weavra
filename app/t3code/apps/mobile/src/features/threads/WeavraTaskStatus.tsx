import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import {
  createEnvironmentCommand,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  createEnvironmentWeavraTaskStateAtoms,
  isFreshWeavraTaskObservation,
  requestWeavraTask,
  type WeavraTaskViewState,
} from "@t3tools/client-runtime/state/weavraTask";
import {
  WS_METHODS,
  type EnvironmentId,
  type WeavraTask,
  type WeavraTaskScopeInput,
} from "@t3tools/contracts";
import { useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { AsyncResult } from "effect/unstable/reactivity";

import { AppText as Text } from "../../components/AppText";
import { connectionAtomRuntime } from "../../connection/runtime";
import { environmentSession } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";

const listTasks = createEnvironmentCommand(connectionAtomRuntime, {
  label: "mobile:weavra-task-list",
  execute: (input: WeavraTaskScopeInput) => requestWeavraTask(WS_METHODS.weavraTaskList, input),
});
const taskObservations = createEnvironmentWeavraTaskStateAtoms(connectionAtomRuntime);

type ListStatus = "loading" | "ready" | "disconnected" | "unsupported" | "unavailable";

export interface WeavraTaskStatusList {
  readonly status: ListStatus;
  readonly tasks: ReadonlyArray<WeavraTask>;
}

type ListLoad = (target: {
  readonly environmentId: EnvironmentId;
  readonly input: WeavraTaskScopeInput;
}) => Promise<AtomCommandResult<ReadonlyArray<WeavraTask>, unknown>>;

function initialListState(connected: boolean, supported: boolean | null): WeavraTaskStatusList {
  return {
    status: !connected ? "disconnected" : supported === false ? "unsupported" : "loading",
    tasks: [],
  };
}

function matchesScope(task: WeavraTask, scope: WeavraTaskScopeInput): boolean {
  return (
    task.environmentId === scope.environmentId &&
    task.projectId === scope.projectId &&
    task.threadId === scope.threadId
  );
}

// Cancellation fences publication, not execution: the only operation is a scoped read.
export function beginWeavraTaskStatusList(options: {
  readonly scope: WeavraTaskScopeInput;
  readonly connected: boolean;
  readonly supported: boolean | null;
  readonly load: ListLoad;
  readonly publish: (state: WeavraTaskStatusList) => void;
}) {
  let cancelled = false;
  options.publish(initialListState(options.connected, options.supported));
  const settled =
    options.connected && options.supported === true
      ? options
          .load({
            environmentId: options.scope.environmentId,
            input: options.scope,
          })
          .then((result) => {
            if (cancelled) return;
            if (
              result._tag !== "Success" ||
              result.value.some((task) => !matchesScope(task, options.scope))
            ) {
              options.publish({ status: "unavailable", tasks: [] });
              return;
            }
            options.publish({ status: "ready", tasks: result.value });
          })
      : Promise.resolve();
  return {
    settled,
    cancel: () => {
      cancelled = true;
    },
  };
}

export function projectWeavraTaskStatus(
  listed: WeavraTask,
  observation: WeavraTaskViewState,
): {
  readonly task: WeavraTask | null;
  readonly freshness: "fresh" | "stale" | "disconnected" | "unsupported" | "unavailable";
} {
  const observed = observation.task;
  if (
    observation.errorCode === "TARGET_CHANGED" ||
    (observed !== null && (!matchesScope(observed, listed) || observed.id !== listed.id))
  ) {
    return { task: null, freshness: "unavailable" };
  }
  if (observation.support === "unsupported") {
    return { task: null, freshness: "unsupported" };
  }
  const task = observed !== null && observed.revision >= listed.revision ? observed : listed;
  if (observation.connection === "DISCONNECTED") {
    return { task, freshness: "disconnected" };
  }
  if (observation.errorCode !== null || observation.connection === "ERROR") {
    return { task, freshness: "unavailable" };
  }
  return {
    task,
    freshness:
      observed !== null &&
      observed.revision >= listed.revision &&
      isFreshWeavraTaskObservation(observation)
        ? "fresh"
        : "stale",
  };
}

function TaskStatusRow(props: { readonly task: WeavraTask }) {
  const observation = useAtomValue(
    taskObservations.stateAtom(
      props.task.environmentId,
      props.task.projectId,
      props.task.threadId,
      props.task.id,
    ),
  );
  const status = projectWeavraTaskStatus(
    props.task,
    AsyncResult.isSuccess(observation)
      ? observation.value
      : {
          support: "unknown",
          connection: AsyncResult.isFailure(observation) ? "ERROR" : "RECONNECTING",
          task: null,
          stale: true,
          errorCode: null,
        },
  );
  const receipt = status.task?.execution?.receipt ?? null;
  const executionStatus =
    receipt === null
      ? "No execution receipt"
      : receipt.status === "UNKNOWN"
        ? "Unconfirmed"
        : (receipt.run?.status ?? receipt.admission.outcome.status);
  const cleanup = receipt?.status === "FOUND" ? receipt.admission.cleanup : undefined;

  return (
    <View className="gap-1">
      <Text className="font-t3-medium text-xs">
        {props.task.id} · {status.freshness}
      </Text>
      {status.task !== null ? (
        <>
          <Text className="text-xs text-foreground-secondary">
            Phase: {status.task.phase} · Ownership: {status.task.ownership.state}
          </Text>
          <Text className="text-xs text-foreground-secondary">
            Execution: {executionStatus} · Cleanup: {cleanup ?? "Not reported"}
          </Text>
        </>
      ) : null}
    </View>
  );
}

const listLabels: Record<ListStatus, string> = {
  loading: "Task status is stale while synchronizing.",
  ready: "No controlled task returned for this thread.",
  disconnected: "Disconnected; current task status is unavailable.",
  unsupported: "This environment does not support controlled-task status.",
  unavailable: "Task status is unavailable; no current state is confirmed.",
};

export function WeavraTaskStatus(props: {
  readonly scope: WeavraTaskScopeInput;
  readonly connectionState: EnvironmentConnectionPhase;
}) {
  const bootstrap = useAtomValue(
    environmentSession.initialConfigValueAtom(props.scope.environmentId),
  );
  const connected = props.connectionState === "connected";
  const supported =
    bootstrap === null ? null : bootstrap.environment.capabilities.weavraTasks === true;
  const load = useAtomCommand(listTasks, { reportFailure: false });
  const [refresh, setRefresh] = useState(0);
  // Bootstrap identity changes with the native transport session. Keep it separate
  // from the live settings projection, whose updates must not restart discovery.
  const epoch = useMemo(
    () => ({ bootstrap, connected, scope: props.scope, refresh }),
    [bootstrap, connected, props.scope, refresh],
  );
  const [snapshot, setSnapshot] = useState<{
    readonly epoch: object;
    readonly list: WeavraTaskStatusList;
  } | null>(null);

  useEffect(() => {
    const request = beginWeavraTaskStatusList({
      scope: props.scope,
      connected,
      supported,
      load,
      publish: (list) => setSnapshot({ epoch, list }),
    });
    return request.cancel;
  }, [connected, epoch, load, props.scope, supported]);

  // Clear during render as well as effect cleanup: an old scope/session response
  // cannot flash between a navigation commit and the next passive effect.
  const list = snapshot?.epoch === epoch ? snapshot.list : initialListState(connected, supported);

  return (
    <View className="mx-4 mb-2 gap-1 rounded-xl border border-border-subtle bg-card-alt p-3">
      <View className="flex-row items-center justify-between gap-2">
        <Text className="font-t3-medium text-xs">Controlled task · read-only</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh controlled-task status"
          disabled={!connected || supported !== true || list.status === "loading"}
          onPress={() => setRefresh((current) => current + 1)}
          className="px-2 py-1"
        >
          <Text className="text-xs text-foreground-secondary">Refresh</Text>
        </Pressable>
      </View>
      {list.status === "ready" && list.tasks.length > 0 ? (
        <ScrollView style={{ maxHeight: 112 }} contentContainerStyle={{ gap: 8 }}>
          {list.tasks.map((task) => (
            <TaskStatusRow key={task.id} task={task} />
          ))}
        </ScrollView>
      ) : (
        <Text className="text-xs text-foreground-secondary">{listLabels[list.status]}</Text>
      )}
      <Text className="text-xs text-foreground-secondary">
        Status, including an empty list, does not grant workspace write permission.
      </Text>
    </View>
  );
}
