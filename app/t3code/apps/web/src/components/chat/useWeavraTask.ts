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
  WeavraTaskRpcError,
  WS_METHODS,
  type WeavraTask,
  type WeavraDirtyWorkspaceDetails,
  type WeavraTaskAnalyzeInput,
  type WeavraTaskCommitDirtyBaselineInput,
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
import * as Schema from "effect/Schema";
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
  | { type: "commitDirtyBaseline"; input: WeavraTaskCommitDirtyBaselineInput }
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
      case "commitDirtyBaseline":
        return requestWeavraTask(WS_METHODS.weavraTaskCommitDirtyBaseline, action.input);
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
const isTaskRpcError = Schema.is(WeavraTaskRpcError);

function taskErrorMessage(error: unknown): string {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "REQUEST_FAILED";
  const guidance: Readonly<Record<string, string>> = {
    PROJECT_NOT_CONFIGURED:
      "이 프로젝트에는 .ai/config.yaml이 필요해요. 아래 ‘프로젝트 설정’에서 초안을 검토하고 저장해 주세요. docs/operations/LOCAL_TEAM_PILOT.md의 weavra project init --config <reviewed-config.yaml>도 사용할 수 있어요. 프로젝트 설정 > Weavra > 워크플로 제어에서 Runtime 상태를 확인할 수 있어요. 작업을 만들거나 실행을 허용하지 않았어요.",
    PROJECT_PREPARATION_BUSY:
      "같은 폴더의 다른 작업이 진행 중이라 자동 준비를 시작하지 않았어요. 진행 중인 쓰기·터미널·프로바이더 작업을 마친 뒤 다시 시작해 주세요.",
    PROJECT_PREPARATION_FAILED:
      "로컬 작업 환경의 자동 준비를 완료하지 못했어요. 기존 파일과 Git 상태를 확인해 주세요. 기존 저장소를 재초기화하거나 실행 확인을 자동으로 다시 보내지 않아요.",
    TARGET_CHANGED:
      "선택한 작업 공간을 실행할 수 없어요. 프로젝트·대화 선택과 기존 Git의 HEAD·미커밋 변경을 확인하고 새로고침해 주세요. 새 폴더의 Git은 첫 시작에서 자동 준비하지만 기존 저장소나 변경사항은 자동으로 정리하지 않아요.",
    WORKSPACE_EVIDENCE_CAPACITY:
      "프로젝트가 현재 증거 수집 한도를 넘었어요. 프로젝트 설정에서 지원되는 증거 프로필과 수정할 경로를 검토해 주세요. 파일을 삭제하거나 한도를 자동으로 풀지 않아요.",
    WORKSPACE_EVIDENCE_UNSUPPORTED:
      "증거를 수집할 수 없는 경로나 파일 형식이 있어요. 프로젝트 설정과 경로 안전성을 확인해 주세요. 파일은 변경하지 않았어요.",
    WORKSPACE_EVIDENCE_UNAVAILABLE:
      "프로젝트 증거를 읽을 수 없어요. Git과 파일 읽기 권한을 확인한 뒤 다시 점검해 주세요. 구현 확인 요청을 자동으로 다시 보내지 않아요.",
    NOT_PREPARED: "확인할 준비 결과가 없어요. 내용을 검토하고 새 스냅샷을 준비해 주세요.",
    RUNTIME_UNAVAILABLE:
      "Runtime에 연결할 수 없어요. 환경 연결과 프로젝트 설정을 확인하고 상태를 새로고침해 주세요.",
    INVALID_RECEIPT:
      "실행 응답의 일치 여부를 확인할 수 없어요. 확인 요청을 다시 보내지 말고 현재 상태를 조회해 주세요.",
    REPREPARE_REQUIRED:
      "기존 준비 결과를 사용할 수 없어요. 현재 설정과 내용을 검토하고 새로 준비해 주세요.",
    STALE_REVISION: "작업 revision이 바뀌었어요. 상태를 새로고침한 뒤 현재 내용을 검토해 주세요.",
    COMMAND_CONFLICT:
      "같은 요청 식별자가 다른 작업에 사용됐어요. 자동으로 다시 보내지 말고 현재 작업을 확인해 주세요.",
    RUN_MISMATCH: "요청한 Run과 현재 작업의 Run이 일치하지 않아요. 상태를 새로고침해 주세요.",
    APPROVAL_MISMATCH:
      "승인 요청이 현재 Run과 일치하지 않아요. 상태를 새로고침하고 현재 승인 내용을 다시 확인해 주세요.",
    ALREADY_CONFIRMED:
      "이미 확인을 요청한 작업이에요. 다시 보내지 말고 현재 실행 결과를 조회해 주세요.",
    ANALYSIS_UNAVAILABLE:
      "현재 분석을 시작할 수 없어요. 프로바이더 상태와 읽기 전용 조사 지원 여부를 확인해 주세요.",
    UNSUPPORTED_PROVIDER:
      "선택한 프로바이더는 읽기 전용 조사를 지원하지 않아요. 지원하는 프로바이더를 직접 선택해 주세요.",
    TERMINAL_ACTIVE:
      "이 checkout의 구현을 맡기기 전에 활성 터미널을 닫아 주세요. 구현은 시작하지 않았어요. 터미널 종료 후 작업 상태를 새로고침해 주세요.",
    RECOVERY_BUSY:
      "Runtime 소유 프로세스가 실행 중이라 복구하지 않았어요. 진행 상황을 새로고침해 주세요. 확인 요청을 다시 보내지 마세요.",
    RECOVERY_UNAVAILABLE:
      "이 Runtime은 작업 복구를 지원하지 않아요. 쓰기 보호는 유지돼요. Runtime을 명시적으로 업데이트하거나 소유 프로세스를 확인해 주세요.",
    RECOVERY_UNKNOWN:
      "이 확인 요청에 연결된 실행 허용 기록을 찾지 못했어요. 실행 응답을 새로 조회해 주세요. 확인을 다시 보내거나 결과를 추정하지 마세요.",
    RECOVERY_OWNER_UNPROVEN:
      "이 작업의 소유권을 확인할 수 없어요. 쓰기를 계속 차단하니 Runtime 소유 프로세스를 확인해 주세요. 복구는 잠금을 강제로 해제하지 않아요.",
    RECOVERY_STALE:
      "Runtime 소유자나 프로젝트 revision이 바뀌었어요. 다시 복구를 요청하기 전에 작업 상태를 새로고침해 주세요.",
    RECOVERY_CONFLICT:
      "현재 Runtime 상태가 복구 요청과 충돌해요. 쓰기 차단을 유지하니 대상 작업과 소유 프로세스를 확인해 주세요.",
    DIRTY_SET_CHANGED:
      "검토한 뒤 변경 파일 목록이 바뀌어서 커밋하지 않았어요. 구현 준비를 다시 눌러 현재 목록을 확인해 주세요.",
    DIRTY_BASELINE_REFUSED:
      "이 변경은 기준 커밋에 포함할 수 없어요. 동의 여부와 Runtime 쓰기 상태, .ai/ 경로를 확인해 주세요. 아무것도 커밋하지 않았어요.",
    CLEANUP_UNPROVEN:
      "정리와 쓰기 잠금 해제를 확인하지 못했어요. checkout 보호를 유지해요. 새로고침은 증거 조회이며 구현 재시작이 아니에요.",
  };
  if (guidance[code]) return `${code}: ${guidance[code]}`;
  if (
    isTaskRpcError(error) &&
    error.code === "PREPARE_REJECTED" &&
    error.prepareReason !== undefined
  ) {
    const reason = error.prepareReason;
    const prefix = `${code} (${reason.code}): 준비 요청이 거부됐으며 Run 실행을 허용하지 않았어요.`;
    switch (reason.kind) {
      case "preview":
        switch (reason.code) {
          case "INVALID_PREVIEW":
            return `${prefix} 작업을 새로고침하고 Runtime 호환성을 확인한 뒤 새 스냅샷을 준비해 주세요.`;
          case "STANDARD_REQUIRED":
            return `${prefix} 통제 작업에는 STANDARD가 필요해요. Runtime 워크플로 설정을 검토하고 다시 준비해 주세요.`;
          case "BINDING_MISMATCH":
            return `${prefix} 증상 수용 기준과 연결된 필수 등록 검사를 검토한 뒤 새 연결을 준비해 주세요.`;
        }
      case "runtime":
        switch (reason.code) {
          case "INVALID_GOAL":
            return `${prefix} 목표만으로는 읽기 전용인지 수정인지 정할 수 없어요.`;
          case "INVALID_CRITERIA":
            return `${prefix} 수용 기준과 필수 등록 검사를 검토한 뒤 다시 준비해 주세요.`;
          case "UNSUPPORTED_WORKFLOW":
            return `${prefix} 이 목표에 필요한 워크플로는 통제 작업 화면에서 지원하지 않아요. 현재 화면은 STANDARD 구현 작업용이에요. 읽기 전용 조사는 분석 입력창을 사용하고, 다른 워크플로가 필요하면 프로젝트 설정의 통제 작업 설정을 확인해 주세요.`;
          case "PROJECT_CHANGED":
            if (reason.details?.reason === "DIRTY_WORKSPACE")
              return `${prefix} 프로젝트에 커밋하지 않은 변경이 있어요. 아래 파일을 직접 정리하거나, 검토한 뒤 기준 커밋에 포함해 주세요.`;
            return `${prefix} 작업 상태를 새로고침하고 현재 프로젝트·Runtime 설정을 검토한 뒤 다시 준비해 주세요.`;
          case "CONFIG_CHANGED":
          case "STALE_PROJECT":
          case "OWNER_CHANGED":
            return `${prefix} 작업 상태를 새로고침하고 현재 프로젝트·Runtime 설정을 검토한 뒤 다시 준비해 주세요.`;
          default:
            return `${prefix} Runtime 호스트의 이 checkout에서 weavra project doctor를 실행하고 준비 상태의 차단 사유를 해결한 뒤 다시 준비해 주세요. 이 진단은 모델 인증을 검증하지 않아요.`;
        }
    }
  }
  return `${code}: 요청 결과를 확인하지 못했어요. 다른 작업 전에 상태를 새로고침하고 checkout·등록 검사·터미널 종료·프로바이더 설정·현재 revision을 확인해 주세요. 이미 실행이 허용됐을 수 있으니 확인 요청을 다시 보내지 마세요.`;
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
    dirtyWorkspace?: WeavraDirtyWorkspaceDetails;
  } | null>(null);
  const error = failure?.key === key ? failure.message : null;
  const dirtyWorkspace = (failure?.key === key ? failure.dirtyWorkspace : undefined) ?? null;
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
        const cause = squashAtomCommandFailure(result);
        const details =
          isTaskRpcError(cause) && cause.prepareReason?.kind === "runtime"
            ? cause.prepareReason.details
            : undefined;
        setFailure({
          key,
          message: taskErrorMessage(cause),
          source: "command",
          ...(details === undefined ? {} : { dirtyWorkspace: details }),
        });
        return null;
      }
      if (
        !taskMatchesScope(result.value, scope) ||
        (action.type !== "create" && action.type !== "reprepare" && result.value.id !== task?.id)
      ) {
        setError(
          "TARGET_CHANGED: 이 대화에 해당하는 응답이 아니에요. 현재 작업 상태를 다시 조회해 주세요.",
        );
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
    dirtyWorkspace,
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
