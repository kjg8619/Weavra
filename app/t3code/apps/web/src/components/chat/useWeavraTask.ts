import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  createEnvironmentWeavraTaskStateAtoms,
  isFreshWeavraTaskObservation,
  requestWeavraTask,
  type WeavraTaskViewState,
} from "@t3tools/client-runtime/state/weavraTask";
import {
  CommandId,
  MessageId,
  WS_METHODS,
  type WeavraTask,
  type WeavraTaskAnalyzeInput,
  type WeavraTaskAbortInput,
  type WeavraTaskRecoverInput,
  type WeavraTaskConfirmInput,
  type WeavraTaskCreateInput,
  type WeavraTaskPrepareInput,
  type WeavraTaskReadInput,
  type WeavraTaskReprepareInput,
  type WeavraTaskRunInput,
  type WeavraTaskResolveApprovalInput,
  type WeavraTaskScopeInput,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironmentSessionState } from "../../state/session";
import { useAtomCommand } from "../../state/use-atom-command";
import { taskMatchesScope, taskSendRoute } from "./weavraTaskLogic";
import { randomUUID } from "../../lib/utils";

type TaskAction =
  | { type: "create"; input: WeavraTaskCreateInput }
  | { type: "analyze"; input: WeavraTaskAnalyzeInput }
  | { type: "followup"; input: WeavraTaskAnalyzeInput }
  | { type: "prepare"; input: WeavraTaskPrepareInput }
  | { type: "confirm"; input: WeavraTaskConfirmInput }
  | { type: "abort"; input: WeavraTaskAbortInput }
  | { type: "recover"; input: WeavraTaskRecoverInput }
  | { type: "reprepare"; input: WeavraTaskReprepareInput }
  | { type: "cancel"; input: WeavraTaskRunInput }
  | { type: "resolveApproval"; input: WeavraTaskResolveApprovalInput }
  | { type: "reconcile"; input: WeavraTaskReadInput };

const taskCommand = createEnvironmentCommand(connectionAtomRuntime, {
  label: "chat:weavra-task",
  execute: (action: TaskAction) => {
    switch (action.type) {
      case "create":
        return requestWeavraTask(WS_METHODS.weavraTaskCreate, action.input);
      case "analyze":
        return requestWeavraTask(WS_METHODS.weavraTaskAnalyze, action.input);
      case "followup":
        return requestWeavraTask(WS_METHODS.weavraTaskFollowup, action.input);
      case "prepare":
        return requestWeavraTask(WS_METHODS.weavraTaskPrepare, action.input);
      case "confirm":
        return requestWeavraTask(WS_METHODS.weavraTaskConfirm, action.input);
      case "recover":
        return requestWeavraTask(WS_METHODS.weavraTaskRecover, action.input);
      case "abort":
        return requestWeavraTask(WS_METHODS.weavraTaskAbort, action.input);
      case "reprepare":
        return requestWeavraTask(WS_METHODS.weavraTaskReprepare, action.input);
      case "cancel":
        return requestWeavraTask(WS_METHODS.weavraTaskCancel, action.input);
      case "resolveApproval":
        return requestWeavraTask(WS_METHODS.weavraTaskResolveApproval, action.input);
      case "reconcile":
        return requestWeavraTask(WS_METHODS.weavraTaskReconcile, action.input);
    }
  },
});
const listCommand = createEnvironmentCommand(connectionAtomRuntime, {
  label: "chat:weavra-task-list",
  execute: (input: WeavraTaskScopeInput) => requestWeavraTask(WS_METHODS.weavraTaskList, input),
});
const taskAtoms = createEnvironmentWeavraTaskStateAtoms(connectionAtomRuntime);
const emptyObservation: WeavraTaskViewState = {
  support: "unknown",
  connection: "DISCONNECTED",
  task: null,
  stale: true,
  errorCode: null,
};
const emptyAtom = Atom.make(AsyncResult.success(emptyObservation));

function taskErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "REQUEST_FAILED";
  const guidance: Readonly<Record<string, string>> = {
    TERMINAL_ACTIVE:
      "Close the active terminal before handing off this checkout. No implementation was started; refresh task state after the terminal exits.",
    RECOVERY_BUSY:
      "The Runtime owner is still running; no recovery was performed. Refresh to observe progress. Do not resend confirmation.",
    RECOVERY_UNAVAILABLE:
      "This Runtime does not support task recovery. Managed writes remain protected; update the Runtime explicitly or inspect its owner.",
    RECOVERY_UNKNOWN:
      "No known canonical admission is associated with this confirmation. Refresh to look up its receipt; never resend confirmation or infer an outcome.",
    RECOVERY_OWNER_UNPROVEN:
      "Ownership cannot be established for this task. Managed writes remain blocked; inspect the Runtime owner. Recovery does not force an unlock.",
    RECOVERY_STALE:
      "The Runtime owner or project revision changed. Refresh task state before explicitly requesting recovery again.",
    RECOVERY_CONFLICT:
      "Runtime state conflicts with this recovery request. Managed writes remain blocked; inspect the exact task and owner.",
    CLEANUP_UNPROVEN:
      "Cleanup and writer release are not verified. The checkout remains protected; refresh to observe evidence, not to restart implementation.",
  };
  if (guidance[code]) return `${code}: ${guidance[code]}`;
  return `${code}: The request result is unconfirmed. Refresh task state before another action. Check the checkout, registered checks, closed terminals, provider configuration and current revision. Execution may already have been admitted; do not resend confirmation.`;
}

export function useWeavraTask(input: {
  scope: WeavraTaskScopeInput | null;
  environmentId: WeavraTaskScopeInput["environmentId"];
  supported: boolean;
  analysisSupported: boolean;
  recoverySupported?: boolean;
  connected: boolean;
}) {
  const { supported, connected } = input;
  const recoverySupported = input.recoverySupported === true;
  const scopedEnvironmentId = input.scope?.environmentId;
  const projectId = input.scope?.projectId;
  const threadId = input.scope?.threadId;
  const scope = useMemo(
    () =>
      scopedEnvironmentId && projectId && threadId
        ? { environmentId: scopedEnvironmentId, projectId, threadId }
        : null,
    [scopedEnvironmentId, projectId, threadId],
  );
  const key = scope ? JSON.stringify(scope) : null;
  const latestKey = useRef(key);
  useLayoutEffect(() => {
    latestKey.current = key;
  }, [key]);
  const [selection, setSelection] = useState<{
    key: string;
    task: WeavraTask | null;
    tasks: readonly WeavraTask[];
    epoch: symbol;
  } | null>(null);
  const [freeCodingTaskId, setFreeCodingTaskId] = useState<WeavraTask["id"] | null>(null);
  const [uncertainScopes, setUncertainScopes] = useState<ReadonlySet<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const epoch = useMemo(
    () => Symbol(`${key}:${connected}:${supported}:${recoverySupported}:${refreshVersion}`),
    [key, connected, supported, recoverySupported, refreshVersion],
  );
  const latestEpoch = useRef(epoch);
  useLayoutEffect(() => {
    latestEpoch.current = epoch;
  }, [epoch]);
  const pending = useRef<TaskAction["type"] | null>(null);
  const [failure, setFailure] = useState<{
    key: string | null;
    message: string;
    source: "command" | "discovery";
  } | null>(null);
  const error = failure?.key === key ? failure.message : null;
  const setError = (message: string | null) =>
    setFailure(message === null ? null : { key, message, source: "command" });
  const execute = useAtomCommand(taskCommand, { reportFailure: false });
  const list = useAtomCommand(listCommand, { reportFailure: false });
  const session = useEnvironmentSessionState(input.environmentId);
  const canOperate =
    session.data?.authenticated === true &&
    session.data.scopes?.includes("orchestration:operate") === true;
  const selected = selection?.key === key ? selection : null;
  const associationUncertain = key !== null && uncertainScopes.has(key);
  const discovered = selected?.epoch === epoch && !associationUncertain;
  const observed = useAtomValue(
    scope && selected?.task
      ? taskAtoms.stateAtom(scope.environmentId, scope.projectId, scope.threadId, selected.task.id)
      : emptyAtom,
  );
  const observation = Option.getOrElse(AsyncResult.value(observed), () => emptyObservation);
  const matchingObservation =
    scope &&
    observation.task &&
    observation.task.id === selected?.task?.id &&
    taskMatchesScope(observation.task, scope)
      ? observation.task
      : null;
  const task =
    matchingObservation && matchingObservation.revision >= (selected?.task?.revision ?? 0)
      ? matchingObservation
      : (selected?.task ?? null);
  const fresh =
    connected &&
    supported &&
    discovered &&
    matchingObservation !== null &&
    isFreshWeavraTaskObservation(observation) &&
    matchingObservation.revision >= (selected?.task?.revision ?? 0);

  useEffect(() => {
    if (!scope || !key || !supported || !connected) return;
    let retired = false;
    void list({ environmentId: scope.environmentId, input: scope }).then((result) => {
      if (
        retired ||
        latestKey.current !== key ||
        latestEpoch.current !== epoch ||
        pending.current === "create" ||
        pending.current === "reprepare"
      )
        return;
      if (result._tag === "Success") {
        const tasks = result.value.filter((item) => taskMatchesScope(item, scope));
        const active = tasks.find((item) => item.ownership.state !== "released");
        const newest = tasks.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        setSelection({ key, task: active ?? newest ?? null, tasks, epoch });
        setUncertainScopes((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
        setFailure((current) =>
          current?.key === key && current.source === "discovery" ? null : current,
        );
      } else {
        setFailure({
          key,
          message: taskErrorMessage(squashAtomCommandFailure(result)),
          source: "discovery",
        });
      }
    });
    return () => {
      retired = true;
    };
  }, [key, scope, supported, connected, list, epoch]);

  const act = async (action: TaskAction): Promise<WeavraTask | null> => {
    if (
      !scope ||
      !key ||
      !connected ||
      !supported ||
      !canOperate ||
      pending.current !== null ||
      (action.type !== "create" && action.type !== "reconcile" && !fresh)
    )
      return null;
    if (action.type === "create" && (!discovered || (task && task.ownership.state !== "released")))
      return null;
    if (
      action.type === "create" &&
      (action.input.environmentId !== scope.environmentId ||
        action.input.projectId !== scope.projectId ||
        action.input.threadId !== scope.threadId)
    )
      return null;
    if (action.type !== "create") {
      const target = action.type === "reconcile" ? action.input : action.input.task;
      if (!task || target.taskId !== task.id || !taskMatchesScope(task, target)) return null;
      if (action.type === "cancel" || action.type === "resolveApproval") {
        const receipt = task.execution?.receipt;
        if (
          receipt?.status !== "FOUND" ||
          receipt.run === null ||
          action.input.expectedRunId !== receipt.run.runId ||
          action.input.expectedStateRevision !== receipt.run.revision
        )
          return null;
      } else if (action.type !== "reconcile" && action.input.expectedRevision !== task.revision) {
        return null;
      }
    }
    if (
      action.type === "recover" &&
      (!recoverySupported ||
        task?.execution?.confirmCommandId == null ||
        task.ownership.state === "released")
    )
      return null;
    const changesIdentity = action.type === "create" || action.type === "reprepare";
    pending.current = action.type;
    if (changesIdentity) setUncertainScopes((current) => new Set([...current, key]));
    setBusy(true);
    setError(null);
    try {
      const result = await execute({ environmentId: scope.environmentId, input: action });
      if (latestKey.current !== key || latestEpoch.current !== epoch) return null;
      if (result._tag !== "Success") {
        setError(taskErrorMessage(squashAtomCommandFailure(result)));
        return null;
      }
      if (
        !taskMatchesScope(result.value, scope) ||
        (action.type !== "create" && action.type !== "reprepare" && result.value.id !== task?.id)
      ) {
        setError("TARGET_CHANGED: The response does not belong to this conversation.");
        return null;
      }
      setSelection((current) => ({
        key,
        task: result.value,
        tasks: [
          ...(current?.key === key
            ? current.tasks.filter((item) => item.id !== result.value.id)
            : []),
          result.value,
        ],
        epoch,
      }));
      return result.value;
    } finally {
      if (changesIdentity) {
        // An old release is not proof that the replacement request left no owner.
        // Retire in-flight discovery before reading the association again.
        latestEpoch.current = Symbol("identity-transition");
        setRefreshVersion((version) => version + 1);
      }
      pending.current = null;
      setBusy(false);
    }
  };

  const ref: WeavraTaskReadInput | null = task && scope ? { ...scope, taskId: task.id } : null;
  // Local draft threads have no durable task scope; their free send/queue path stays intact.
  const route =
    scope === null
      ? "free"
      : associationUncertain
        ? "blocked"
        : taskSendRoute({
            supported,
            discovered,
            fresh,
            canOperate,
            task,
            allowFreeCoding: task?.id === freeCodingTaskId,
          });
  const analyze = async (text: string) => {
    if (!ref || !task || route !== "analysis" || !input.analysisSupported) return false;
    return (
      (await act({
        type: "analyze",
        input: {
          task: ref,
          commandId: CommandId.make(randomUUID()),
          messageId: MessageId.make(randomUUID()),
          text,
          expectedRevision: task.revision,
        },
      })) !== null
    );
  };
  const followup = async (text: string) => {
    if (!ref || !task || route !== "followup" || !input.analysisSupported) return false;
    return (
      (await act({
        type: "followup",
        input: {
          task: ref,
          commandId: CommandId.make(randomUUID()),
          messageId: MessageId.make(randomUUID()),
          text,
          expectedRevision: task.revision,
        },
      })) !== null
    );
  };
  const refresh = () => {
    setError(null);
    setRefreshVersion((version) => version + 1);
  };
  const chooseFreeCoding = () => {
    if (
      task?.ownership.state === "released" &&
      fresh &&
      canOperate &&
      !busy &&
      !associationUncertain
    )
      setFreeCodingTaskId(task.id);
  };
  const tasks = selected?.tasks.map((item) => (task && item.id === task.id ? task : item)) ?? [];
  return {
    task,
    tasks,
    ref,
    fresh,
    canOperate,
    recoverySupported,
    busy,
    error,
    setError,
    route,
    act,
    analyze,
    followup,
    refresh,
    discovered,
    chooseFreeCoding,
  };
}

export type WeavraTaskController = ReturnType<typeof useWeavraTask>;
