import { ko } from "~/i18n/ko";
import { weavraLabel } from "../weavraLabels";
import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentWeavraControlCommand,
  createEnvironmentWeavraControlStateAtoms,
  deriveRequest,
  derivedDraftFitsEditor,
  derivedDraftUnchanged,
  derivedLoadedDraft,
  plannerCancelRequest,
  plannerDraftUnchanged,
  plannerElapsedMs,
  plannerLoadedDraft,
  plannerReadRequest,
  plannerRequestDigest,
  plannerStartRequest,
  plannerStatusOf,
  rerunEligible,
  rerunExposed,
  type DerivedLoadedDraft,
  type PlannerLoadedDraft,
} from "@t3tools/client-runtime/state/weavraControl";
import {
  type EnvironmentId,
  type ProjectId,
  type WeavraBrowserAssertion,
  type WeavraBrowserPreview,
  type WeavraBrowserState,
  type WeavraComplexDraft,
  type WeavraComplexOwnershipClaim,
  type WeavraControlErrorCode,
  WeavraControlMutation,
  type WeavraControlPreview,
  type WeavraFactPreview,
  type WeavraPlannerFailureCode,
  type WeavraPlannerStatus,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { requestConfirmDialog } from "../../confirmDialog";
import { useEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsSection } from "./settingsLayout";
import { CapabilityInventory } from "./CapabilityInventory";
import { ComplexExecutionView, ComplexPlanView } from "./WeavraComplex";
import { WeavraPreflightFailure } from "./WeavraPreflightFailure";

const observations = createEnvironmentWeavraControlStateAtoms(connectionAtomRuntime);
const command = createEnvironmentWeavraControlCommand(connectionAtomRuntime);
const decodeMutation = Schema.decodeUnknownSync(WeavraControlMutation, {
  onExcessProperty: "error",
});
type CommandState = {
  // Every status has a Korean label: the type is the catalog key set, so a new status needs copy.
  status: keyof typeof ko.runtime.controls.commandStatus;
  message: string;
};
const idle: CommandState = {
  status: "idle",
  message: "명령은 Runtime에 작업을 요청해요. 결과는 Runtime의 공식 스냅샷으로만 확인해요.",
};
/** Editable only before confirmation; Runtime compiles it and assigns every ID. */
type ComplexDraftRow = {
  title: string;
  goal: string;
  dependsOnIndexes: number[];
  criterionIndexes: number[];
  ownership: Array<{ path: string; operation: WeavraComplexOwnershipClaim["operation"] }>;
  checkIds: string;
};
const emptyComplexRow: ComplexDraftRow = {
  title: "",
  goal: "",
  dependsOnIndexes: [],
  criterionIndexes: [],
  ownership: [],
  checkIds: "",
};
const toggled = (values: ReadonlyArray<number>, value: number) =>
  values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value].sort((left, right) => left - right);
/** Local reference checks only; Runtime validates the rest and nothing is repaired here. */
function complexDraftProblem(rows: ReadonlyArray<ComplexDraftRow>, criteria: number) {
  if (rows.length < 2 || rows.length > 8) return "복합 작업 계획에는 작업 2~8개가 필요해요.";
  if (criteria < 1 || criteria > 16) return "상위 수용 기준을 한 줄에 하나씩 1~16개 입력해 주세요.";
  for (const [index, row] of rows.entries()) {
    if (row.criterionIndexes.length === 0) return `작업 ${index + 1}에 연결된 수용 기준이 없어요.`;
    const missing = row.criterionIndexes.find((criterion) => criterion > criteria);
    if (missing !== undefined)
      return `작업 ${index + 1}의 수용 기준 연결 ${missing}이 입력된 기준 ${criteria}개 범위를 벗어나요.`;
  }
  for (let criterion = 1; criterion <= criteria; criterion++) {
    if (!rows.some((row) => row.criterionIndexes.includes(criterion)))
      return `수용 기준 ${criterion}에 연결된 작업이 없어요.`;
  }
  return null;
}
const toComplexDraft = (rows: ReadonlyArray<ComplexDraftRow>): WeavraComplexDraft => ({
  tasks: rows.map((row) => ({
    title: row.title,
    goal: row.goal,
    dependsOnIndexes: row.dependsOnIndexes,
    criterionIndexes: row.criterionIndexes,
    ownership: row.ownership,
    checkIds: row.checkIds.split(/\s+/).filter(Boolean),
  })),
});
/** A Planner draft becomes ordinary editor rows exactly as proposed, check IDs space-separated. */
const toComplexRows = (draft: WeavraComplexDraft): ComplexDraftRow[] =>
  draft.tasks.map((task) => ({
    title: task.title,
    goal: task.goal,
    dependsOnIndexes: [...task.dependsOnIndexes],
    criterionIndexes: [...task.criterionIndexes],
    ownership: task.ownership.map(({ path, operation }) => ({ path, operation })),
    checkIds: task.checkIds.join(" "),
  }));
const lines = (text: string) =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
/** Fixed explanations of the closed Planner failure codes (PLANNER_DRAFT.md §5.5). */
const plannerFailureText: Record<WeavraPlannerFailureCode, string> = {
  MODEL_UNAVAILABLE:
    "사용할 수 있는 계획 모델·프로필·인증이 설정되지 않았어요. 다른 모델로 자동 전환하지 않아요.",
  CONTEXT_TOO_LARGE: "계획 참고 자료가 196,608바이트를 초과해요. 모델을 호출하지 않았어요.",
  TIMEOUT: "작업 제한 시간 안에 계획을 끝내지 못했어요.",
  PROVIDER_ERROR: "모델 공급자에 오류가 발생했거나 응답이 비정상적으로 끝났어요.",
  BUDGET_EXHAUSTED: "유효한 초안을 만들기 전에 모델 호출 3회 또는 토큰 한도에 도달했어요.",
  BUDGET_UNKNOWN:
    "공급자가 사용량을 보고하지 않아 토큰 한도 정책에 따라 추가 계획 호출을 멈췄어요.",
  NO_DRAFT: "한 번 다시 요청했지만 모델이 초안을 제출하지 않고 답변만 보냈어요.",
  DRAFT_INVALID: "수정한 초안도 계획 검사를 통과하지 못했어요.",
  STALE: "계획 중 프로젝트나 설정이 바뀌어 초안을 폐기했어요.",
};
const plannerRoute = (route: WeavraPlannerStatus["route"]) =>
  route === null
    ? "모델 경로 미보고"
    : `${route.alias === "plan" ? "models.intents.plan" : "역할 기본값"} → ${route.profile} → ${route.provider}/${route.model}`;
const plannerUsage = ({ invocations, reportedTokens }: WeavraPlannerStatus["usage"]) =>
  `${invocations} / 3회 모델 호출 · 보고된 토큰 ${reportedTokens ?? "확인 안 됨"}`;
const plannerSeconds = (elapsedMs: number | null) =>
  elapsedMs === null ? "확인 안 됨" : `${Math.floor(elapsedMs / 1000)} s`;
/** The COMPLEX_RERUN.md §7 banner, shown while the editor holds the derived draft unchanged. */
const derivedBanner = ({ runId, sourceStatus, completedTasks }: DerivedLoadedDraft) =>
  `초안의 원본 실행: ${runId} (${sourceStatus}): ${
    completedTasks === 1
      ? "완료한 작업 하나를 읽기 전용 검증 작업으로 바꿔"
      : `${completedTasks}개 완료 작업을 읽기 전용 검증 작업으로 바꿔`
  } 다시 검사해요. 미완료 작업은 담당 범위를 유지하며 파일이 이미 있으면 생성 대신 수정으로 바꿔요. 준비 전에 검토해 주세요.`;
/** Fixed guidance after a Runtime refusal; the refusal code itself is always shown. */
function rejectionHint(
  request: WeavraControlMutation,
  code: WeavraControlErrorCode,
  complexSupported: boolean,
) {
  switch (request.type) {
    case "workflow.prepare":
      return code === "STALE_PROJECT"
        ? " 계획 준비 전에 프로젝트 상태가 바뀌었어요. 종료된 소유자의 실행이 중단됨으로 기록된 경우도 해당해요. 준비나 재시도는 하지 않았으니 새 상태를 확인한 뒤 다시 준비해 주세요."
        : request.complexDraft
          ? code === "INVALID_REQUEST"
            ? " 작업 계획은 Runtime이 목표를 복합 작업으로 분류한 경우에만 받아들여요. 빠른 작업이나 표준 작업 목표라면 작업 계획을 비워 주세요."
            : code === "INVALID_CRITERIA"
              ? " Runtime이 작업 계획의 의존성·기준 범위·파일 담당 범위·검사 중 하나를 거부했어요."
              : ""
          : code === "UNSUPPORTED_WORKFLOW" && complexSupported
            ? " 목표가 복합 작업으로 분류됐다면 작업 2~8개의 구조화된 계획을 추가하고 다시 준비해 주세요."
            : "";
    case "workflow.confirm":
      return code === "PLANNER_BUSY"
        ? " Runtime이 아직 계획을 만들고 있어요. 먼저 계획을 취소해 주세요. 새 작업은 시작하지 않았어요."
        : "";
    case "planner.start":
      return code === "UNSUPPORTED_WORKFLOW"
        ? " 계획 담당은 Runtime이 복합 작업으로 분류한 목표만 초안으로 만들며 R3는 처리하지 않아요."
        : code === "PLANNER_BUSY"
          ? " Runtime에서 계획 또는 실행이 이미 진행 중이에요."
          : "";
    case "planner.cancel":
      return code === "PLANNER_NOT_FOUND" ? " 해당 계획 요청은 더 이상 실행 중이 아니에요." : "";
    case "planner.read":
      return code === "PLANNER_NOT_FOUND" || code === "PLANNER_NOT_READY"
        ? " 해당 제안을 더 이상 사용할 수 없어 불러오지 않았어요."
        : "";
    case "workflow.derive":
      return code === "RERUN_NOT_APPLICABLE"
        ? " 미완료 작업이 남고 차단됨·취소됨·실패·중단됨으로 끝난 최신 복합 작업 실행만 다시 계획할 수 있어요. R3는 제외해요. 초안을 만들지 않았어요."
        : code === "RUN_NOT_FOUND"
          ? " 해당 실행이 더 이상 최신 실행이 아니어서 초안을 만들지 않았어요."
          : code === "ACTIVE_RUN"
            ? " 프로젝트나 Runtime에 활성 실행이 있어 초안을 만들지 않았어요."
            : code === "STALE_PROJECT"
              ? " 초안을 만들기 전에 프로젝트가 바뀌었어요. 초안을 만들지 않았으니 새 상태가 표시되면 다시 요청해 주세요."
              : "";
    default:
      return "";
  }
}

export function WeavraControls({
  environmentId,
  projectId,
  workspaceRoot,
  projectName,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  workspaceRoot: string;
  projectName?: string;
}) {
  const observationResult = useAtomValue(
    observations.stateAtom(environmentId, projectId, workspaceRoot),
  );
  const view = Option.getOrUndefined(AsyncResult.value(observationResult));
  const environment = useEnvironment(environmentId);
  const invoke = useAtomCommand(command, { reportFailure: false, reportDefect: false });
  const [goal, setGoal] = useState("");
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [recipeInputs, setRecipeInputs] = useState("{}");
  const [criteria, setCriteria] = useState("");
  const [complexCriteria, setComplexCriteria] = useState("");
  const [complexRows, setComplexRows] = useState<ComplexDraftRow[]>([]);
  // Planner proposals stay page-session memory: the loaded one and one dismissed locally.
  const [loadedDraft, setLoadedDraft] = useState<PlannerLoadedDraft | null>(null);
  const [dismissedPlanId, setDismissedPlanId] = useState<string | null>(null);
  // The loaded re-run draft (COMPLEX_RERUN.md §7) is page-session memory too, never persisted.
  const [derivedDraft, setDerivedDraft] = useState<DerivedLoadedDraft | null>(null);
  const [preview, setPreview] = useState<WeavraControlPreview | null>(null);
  const [preparedDraft, setPreparedDraft] = useState<string | null>(null);
  const [commandState, setCommandState] = useState<CommandState>(idle);
  const pending = useRef(false);
  const mounted = useRef(true);
  const [browserInspection, setBrowserInspection] = useState<{
    ownerId: string;
    projectRevision: number;
    stateRevision: number | null;
    runId: string | null;
    data: WeavraBrowserState;
  } | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [browserCheckId, setBrowserCheckId] = useState("");
  const [assertionType, setAssertionType] = useState<WeavraBrowserAssertion["type"]>("text_equals");
  const [expectedValue, setExpectedValue] = useState("");
  const [browserPreview, setBrowserPreview] = useState<WeavraBrowserPreview | null>(null);
  const [preparedBrowserDraft, setPreparedBrowserDraft] = useState<string | null>(null);
  const [factSource, setFactSource] = useState("");
  const [factStatement, setFactStatement] = useState("");
  const [factPreview, setFactPreview] = useState<WeavraFactPreview | null>(null);
  const [preparedFactDraft, setPreparedFactDraft] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const observation = view?.observation;
  const observedAt = observation?.observedAt ?? Number.POSITIVE_INFINITY;
  const state = observation?.state;
  const fresh =
    environment?.connection.phase === "connected" &&
    view?.support === "supported" &&
    observation?.status === "CONNECTED" &&
    !observation.stale &&
    !!state;
  const candidate = browserInspection?.data.candidates.find(
    (item) => item.candidateId === candidateId,
  );
  const browserDraftIdentity = JSON.stringify([
    candidate?.candidateId,
    candidate?.candidateDigest,
    browserCheckId,
    assertionType,
    expectedValue,
  ]);
  const browserInspectionCurrent =
    fresh &&
    browserInspection !== null &&
    browserInspection.ownerId === state?.ownerId &&
    browserInspection.projectRevision === state.projectRevision &&
    browserInspection.stateRevision === state.stateRevision &&
    browserInspection.runId === (state.snapshot.status.run?.runId ?? null);
  const browserPreviewCurrent =
    browserInspectionCurrent &&
    browserPreview !== null &&
    state?.browserPreview?.previewId === browserPreview.previewId &&
    state.browserPreview.previewDigest === browserPreview.previewDigest &&
    state.ownerId === browserPreview.ownerId &&
    state.projectRevision === browserPreview.projectRevision &&
    browserPreview.expiresAt > observedAt &&
    browserPreview.candidate.candidateId === candidate?.candidateId &&
    browserPreview.candidate.candidateDigest === candidate?.candidateDigest &&
    preparedBrowserDraft === browserDraftIdentity;
  const factDraftIdentity = JSON.stringify([factSource, factStatement]);
  const factPreviewCurrent =
    fresh &&
    factPreview !== null &&
    state?.factPreview?.previewId === factPreview.previewId &&
    state.factPreview.previewDigest === factPreview.previewDigest &&
    state.ownerId === factPreview.ownerId &&
    state.projectRevision === factPreview.projectRevision &&
    factPreview.expiresAt > observedAt &&
    preparedFactDraft === factDraftIdentity;
  // Contract v1 runs tasks one at a time; v2 may implement independent tasks together. The draft
  // is the same for both: dependencies express order, and maxParallel is Runtime configuration.
  const complexVersion = observation?.capabilities?.complexContractVersion;
  const complexSupported = complexVersion !== undefined;
  const draftIdentity = JSON.stringify([
    goal,
    recipeId,
    recipeInputs,
    complexCriteria,
    complexRows,
  ]);
  const previewCurrent =
    fresh &&
    preview !== null &&
    state?.preview?.previewId === preview.previewId &&
    state.preview.previewDigest === preview.previewDigest &&
    state.ownerId === preview.ownerId &&
    state.projectRevision === preview.projectRevision &&
    preview.expiresAt > observedAt &&
    preparedDraft === draftIdentity &&
    // COMPLEX parent criteria are edited in the task plan, so only the draft identity binds them.
    (preview.workflow === "COMPLEX" ||
      criteria === preview.acceptanceCriteria.map((criterion) => criterion.statement).join("\n"));
  const latest = useRef({
    fresh,
    state,
    previewCurrent,
    browserPreviewCurrent,
    browserDraftIdentity,
    factPreviewCurrent,
    factDraftIdentity,
    goal,
    complexCriteria,
    complexRows,
  });
  useLayoutEffect(() => {
    latest.current = {
      fresh,
      state,
      previewCurrent,
      browserPreviewCurrent,
      browserDraftIdentity,
      factPreviewCurrent,
      factDraftIdentity,
      goal,
      complexCriteria,
      complexRows,
    };
  }, [
    fresh,
    state,
    previewCurrent,
    browserPreviewCurrent,
    browserDraftIdentity,
    factPreviewCurrent,
    factDraftIdentity,
    goal,
    complexCriteria,
    complexRows,
    latest,
  ]);
  const run = state?.snapshot.status.run;
  const submitting = commandState.status === "submitting";
  const canEditDraft = fresh && !state?.busy && !submitting;
  const runActive = ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run?.status ?? "");
  const canPrepare =
    fresh &&
    !state?.busy &&
    state?.snapshot.status.writerPresent === false &&
    !runActive &&
    !submitting;
  // Another Runtime owner, such as a killed Host, holds this project's active Run. Prepare lets the
  // Runtime decide: it marks the Run INTERRUPTED only when that owner provably stopped.
  const foreignActiveRun = fresh && !state?.busy && runActive && state?.ownedRunId !== run?.runId;
  // A writer lock outlived the latest Run, e.g. its owner died after the Run ended
  // (COMPLEX_RERUN.md §7). Prepare lets the Runtime decide as well: it releases the lock only when
  // that owner provably stopped. A lock without any Run, or this connection's own Run, still blocks.
  const staleWriter =
    fresh &&
    !state?.busy &&
    !!run &&
    !runActive &&
    state?.snapshot.status.writerPresent === true &&
    state.ownedRunId !== run.runId;
  const prepareSupported =
    observation?.capabilities?.commands.includes("workflow.prepare") === true;
  const canPrepareWorkflow =
    prepareSupported && (canPrepare || ((foreignActiveRun || staleWriter) && !submitting));
  const prepareReason =
    view?.support === "unsupported"
      ? "이 연결은 Runtime 워크플로 제어를 지원하지 않아요. 읽기 전용 관찰을 이용해 주세요."
      : environment?.connection.phase !== "connected"
        ? "환경 연결이 끊겼어요. 다시 연결하고 최신 공식 스냅샷을 확인해 주세요."
        : !fresh
          ? "최신 제어 정보를 확인할 수 없어요. 연결·제어 권한을 확인하고 새 공식 스냅샷을 기다려 주세요."
          : !prepareSupported
            ? "이 Runtime은 워크플로 준비 기능을 제공하지 않아요. 지원되는 Runtime 연결을 확인해 주세요."
            : submitting
              ? "현재 요청의 결과를 기다리고 있어요. 중복 요청을 보내지 않아요."
              : !canPrepareWorkflow
                ? "현재 실행이나 쓰기 잠금이 있어 준비할 수 없어요. 공식 상태를 확인해 주세요."
                : !goal.trim()
                  ? "워크플로 목표를 입력해 주세요."
                  : "Runtime에 계획 미리보기를 요청해요. 준비는 로컬 저장·승인·실행이 아니며, 확인 후 시작하기 전에는 실행하지 않아요.";
  const diagnostics = [
    ["연결 주소", environment?.displayUrl ?? "확인 안 됨"],
    ["환경 ID", environmentId],
    ["프로젝트 ID", projectId],
    ["작업 공간 전체 경로", workspaceRoot],
    ["제어 관찰 상태", observation?.status ?? "확인 안 됨"],
    ["연결 오류", observation?.errorCode ?? "확인 안 됨"],
    ["Runtime 소유 프로세스", "확인 안 됨"],
  ];
  // V0.8B Planner: it exists only when the Runtime advertises it beside the COMPLEX editor it fills.
  const plannerExposed =
    complexSupported && observation?.capabilities?.plannerContractVersion === 1;
  const planner = plannerExposed ? plannerStatusOf(observation) : null;
  const editorStatements = lines(complexCriteria);
  const canStartPlanner =
    plannerExposed &&
    canPrepare &&
    goal.trim() !== "" &&
    editorStatements.length > 0 &&
    planner?.status !== "RUNNING";
  const canCancelPlanner = plannerExposed && fresh && planner?.status === "RUNNING" && !submitting;
  const canLoadPlanner = plannerExposed && canEditDraft && planner?.status === "READY";
  const plannerProposal =
    planner?.status === "READY" && planner.planId !== dismissedPlanId ? planner : null;
  // The Host's request binding, recomputed for what the editor holds now (§6).
  const editorDigest =
    plannerProposal || loadedDraft ? plannerRequestDigest(goal.trim(), editorStatements) : null;
  const editorDraft = toComplexDraft(complexRows);
  const loadedUnchanged = plannerDraftUnchanged(loadedDraft, editorDraft);
  const loadedCurrent =
    planner && planner.planId === loadedDraft?.planId ? planner.current : loadedDraft?.current;
  // V0.8C re-run: it exists only when the Runtime advertises it beside the COMPLEX editor it fills,
  // and is offered on the latest Run's execution view (COMPLEX_RERUN.md §7).
  const rerunAdvertised = complexSupported && rerunExposed(observation);
  const rerunOffered = rerunAdvertised && fresh && rerunEligible(state);
  const canDerive = rerunOffered && canEditDraft;
  const derivedShown =
    rerunAdvertised && derivedDraft !== null && run?.runId === derivedDraft.runId;
  const derivedUnchanged = derivedDraftUnchanged(derivedDraft, {
    goal: goal.trim(),
    acceptanceStatements: editorStatements,
    draft: editorDraft,
  });
  const canCancel =
    fresh &&
    state?.busy &&
    !state.cancelling &&
    state.ownedRunId === run?.runId &&
    ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run?.status ?? "") &&
    state.stateRevision !== null &&
    !submitting;
  const approval =
    fresh && state?.busy && state.ownedRunId === run?.runId && run?.status === "WAITING_APPROVAL"
      ? state.pendingApproval
      : null;
  const common = () => {
    const current = latest.current;
    if (!current.fresh || !current.state || pending.current) return null;
    return {
      protocolVersion: 1 as const,
      id: current.state.nextRequestId,
      ownerId: current.state.ownerId,
      expectedProjectRevision: current.state.projectRevision,
    };
  };
  const submit = async (request: WeavraControlMutation, confirmation?: string) => {
    if (pending.current || !latest.current.fresh || !mounted.current) return;
    pending.current = true;
    setCommandState({
      status: "submitting",
      message: confirmation
        ? "명시적인 확인을 기다리고 있어요."
        : "Runtime에 명령을 보내고 있어요.",
    });
    try {
      if (confirmation && !(await requestConfirmDialog(confirmation))) {
        if (mounted.current) setCommandState(idle);
        return;
      }
      const current = latest.current;
      if (!mounted.current) return;
      if (
        !current.fresh ||
        current.state?.ownerId !== request.ownerId ||
        current.state.nextRequestId !== request.id ||
        current.state.projectRevision !== request.expectedProjectRevision ||
        ("expectedStateRevision" in request &&
          current.state.stateRevision !== request.expectedStateRevision) ||
        (request.type === "workflow.confirm" &&
          (!current.previewCurrent ||
            current.state.preview?.previewId !== request.previewId ||
            current.state.preview.previewDigest !== request.previewDigest)) ||
        (request.type === "browser.confirm" &&
          (!current.browserPreviewCurrent ||
            current.browserDraftIdentity !== browserDraftIdentity ||
            current.state.browserPreview?.previewId !== request.previewId ||
            current.state.browserPreview.previewDigest !== request.previewDigest)) ||
        (request.type === "facts.confirm" &&
          (!current.factPreviewCurrent ||
            current.factDraftIdentity !== factDraftIdentity ||
            current.state.factPreview?.previewId !== request.previewId ||
            current.state.factPreview.previewDigest !== request.previewDigest))
      ) {
        setCommandState({
          status: "rejected",
          message: "Runtime 상태가 바뀌었어요. 새 상태를 검토한 뒤 다시 요청해 주세요.",
        });
        return;
      }
      const result = await invoke({ environmentId, input: { projectId, request } });
      if (!mounted.current) return;
      if (!AsyncResult.isSuccess(result)) {
        setCommandState({
          status: "transport-error",
          message:
            "통신 오류로 명령 결과를 확인할 수 없어요. 새로운 Runtime 상태를 기다려 주세요. 자동 재시도는 보내지 않았어요.",
        });
        return;
      }
      const response = result.value;
      if (!response.success) {
        const code = response.error.code;
        setCommandState({
          status: "rejected",
          message: `Runtime이 명령을 거부했어요: ${code}.${rejectionHint(request, code, complexSupported)} 새 상태를 검토한 뒤 다시 시도해 주세요.`,
        });
        return;
      }
      if (response.data.kind === "planner-draft") {
        // Candidate data for the editor only: nothing is prepared, confirmed or stored.
        const loaded =
          request.type === "planner.read" ? plannerLoadedDraft(response, request.planId) : null;
        if (!loaded) {
          setCommandState({
            status: "rejected",
            message: "Runtime이 다른 계획 요청의 초안을 반환해 불러오지 않았어요.",
          });
          return;
        }
        const rows = latest.current.complexRows;
        if (rows.length > 0 && !plannerDraftUnchanged(loaded, toComplexDraft(rows))) {
          setCommandState({ status: "submitting", message: "명시적인 확인을 기다리고 있어요." });
          const replace = await requestConfirmDialog(
            `편집기의 ${rows.length}개 작업을 계획 담당이 제안한 ${loaded.draft.tasks.length}개 작업으로 바꿀까요?\n현재 목록은 보존하지 않아요. 아직 검토하지 않은 제안이니 각 작업·담당 범위·검사를 확인한 뒤 준비해 주세요.`,
          );
          if (!mounted.current) return;
          if (!replace) {
            setCommandState({
              status: "idle",
              message: "편집기의 작업 목록을 유지했어요. 새 내용을 불러오지 않았어요.",
            });
            return;
          }
        }
        editComplexRows(() => toComplexRows(loaded.draft));
        setLoadedDraft(loaded);
        setDerivedDraft(null);
        setCommandState({
          status: "accepted",
          message:
            "계획 담당 제안을 편집기로 불러왔어요. 각 작업·파일 담당 범위·검사를 검토한 뒤 준비해 주세요. 아직 준비하거나 실행하지 않았어요.",
        });
      } else if (response.data.kind === "derived-draft") {
        // Candidate data for the editor only: nothing is prepared, confirmed, stored or run.
        const current = latest.current;
        const derived =
          request.type === "workflow.derive"
            ? derivedLoadedDraft(response, request.runId, current.state?.complexExecution)
            : null;
        if (!derived) {
          setCommandState({
            status: "rejected",
            message: "Runtime이 요청한 실행과 다른 초안을 반환해 불러오지 않았어요.",
          });
          return;
        }
        if (!derivedDraftFitsEditor(derived)) {
          setCommandState({
            status: "rejected",
            message:
              "생성된 목표나 수용 기준을 한 줄에 하나씩 편집하면 원문이 달라져요. 불러오지 않았으니 작업 계획을 직접 작성해 주세요.",
          });
          return;
        }
        const editor = {
          goal: current.goal.trim(),
          acceptanceStatements: lines(current.complexCriteria),
          draft: toComplexDraft(current.complexRows),
        };
        const empty =
          editor.goal === "" &&
          editor.acceptanceStatements.length === 0 &&
          current.complexRows.length === 0;
        if (!empty && !derivedDraftUnchanged(derived, editor)) {
          setCommandState({ status: "submitting", message: "명시적인 확인을 기다리고 있어요." });
          const replace = await requestConfirmDialog(
            `편집기의 목표·수용 기준·작업을 다음 실행에서 만든 초안으로 바꿀까요? 실행 ${derived.runId} (${derived.sourceStatus})\n현재 편집 내용은 보존하지 않아요. 각 작업·담당 범위·검사를 확인한 뒤 준비해 주세요.`,
          );
          if (!mounted.current) return;
          if (!replace) {
            setCommandState({
              status: "idle",
              message:
                "편집기의 목표·수용 기준·작업 목록을 유지했어요. 새 내용을 불러오지 않았어요.",
            });
            return;
          }
        }
        invalidateDraft();
        setGoal(derived.goal);
        setComplexCriteria(derived.acceptanceStatements.join("\n"));
        setComplexRows(toComplexRows(derived.draft));
        setDerivedDraft(derived);
        setLoadedDraft(null);
        setCommandState({
          status: "accepted",
          message: `다음 실행의 초안을 편집기로 불러왔어요: ${derived.runId}. 남은 변경을 정리하고 각 작업·담당 범위·검사를 검토한 뒤 준비해 주세요. 아직 준비하거나 실행하지 않았어요.`,
        });
      } else if (response.data.kind === "prepared") {
        setFactPreview(null);
        setPreparedFactDraft(null);
        setPreview(response.data.preview);
        setPreparedDraft(draftIdentity);
        setBrowserPreview(null);
        setPreparedBrowserDraft(null);
        setCriteria(
          response.data.preview.acceptanceCriteria
            .map((criterion) => criterion.statement)
            .join("\n"),
        );
        setCommandState({
          status: "accepted",
          message:
            "Runtime이 계획을 준비했어요. 워크플로는 시작하지 않았으니 미리보기를 검토하고 직접 확인해 주세요.",
        });
      } else if (response.data.kind === "browser-state") {
        setBrowserInspection({
          ownerId: response.ownerId,
          projectRevision: response.projectRevision ?? 0,
          stateRevision: response.stateRevision,
          runId: response.runId,
          data: response.data.state,
        });
        setBrowserPreview(null);
        setPreparedBrowserDraft(null);
        setCommandState({
          status: "accepted",
          message:
            "Runtime에서 브라우저 관찰 후보와 증거를 불러왔어요. 과거 캡처는 현재 페이지의 검사 결과가 아니에요.",
        });
      } else if (response.data.kind === "browser-prepared") {
        setFactPreview(null);
        setPreparedFactDraft(null);
        setBrowserPreview(response.data.preview);
        setPreparedBrowserDraft(browserDraftIdentity);
        setPreview(null);
        setPreparedDraft(null);
        setCommandState({
          status: "accepted",
          message:
            "Runtime이 브라우저 검사 등록 미리보기를 준비했어요. 예상 결과를 검토하고 직접 확인해 주세요. 아직 등록하지 않았어요.",
        });
      } else if (response.data.kind === "browser-registered") {
        setBrowserPreview(null);
        setPreparedBrowserDraft(null);
        setBrowserInspection(null);
        setCommandState({
          status: "accepted",
          message:
            "Runtime이 등록 요청을 확인했어요. 브라우저 증거를 새로고침해 등록 내용을 확인해 주세요. 등록은 통과나 완료 판정이 아니며 검증마다 새 격리 캡처가 필요해요.",
        });
      } else if (response.data.kind === "fact-prepared") {
        setFactPreview(response.data.preview);
        setPreparedFactDraft(factDraftIdentity);
        setPreview(null);
        setPreparedDraft(null);
        setBrowserPreview(null);
        setPreparedBrowserDraft(null);
        setCommandState({
          status: "accepted",
          message:
            "Runtime이 사실 후보를 준비했어요. 출처와 내용을 검토해 주세요. 확인 전에는 저장하지 않아요.",
        });
      } else if (response.data.kind === "fact-confirmed") {
        setFactPreview(null);
        setPreparedFactDraft(null);
        setCommandState({
          status: "accepted",
          message:
            "검토를 기록했어요. Runtime의 공식 사실 상태를 기다리고 있으며 이 응답은 유효·통과·완료 판정이 아니에요.",
        });
      } else {
        setCommandState({
          status: "accepted",
          message:
            request.type === "workflow.cancel"
              ? "취소 요청을 받았어요. 공식 종료 상태와 쓰기 잠금 해제를 기다려 주세요. 일부 변경은 남아 있어요."
              : request.type === "approval.resolve"
                ? "대기 중인 요청에 대한 결정을 받았어요. 승인 검증·사용·완료 판단은 계속 Runtime이 담당해요."
                : request.type === "planner.start"
                  ? "계획 생성을 시작했어요. Runtime이 백그라운드에서 후보를 만들며 작업을 실행하지 않아요. 직접 불러오기 전에는 편집기에 반영하지 않아요."
                  : request.type === "planner.cancel"
                    ? "계획 취소 요청을 받았어요. Runtime의 취소됨 보고를 기다려 주세요."
                    : "시작 요청을 받았어요. 공식 실행 상태를 기다리고 있으며 이 응답만으로 성공을 판단하지 않아요.",
        });
      }
    } catch {
      if (mounted.current)
        setCommandState({
          status: "transport-error",
          message:
            "통신 오류로 명령 결과를 확인할 수 없어요. 새로운 Runtime 상태를 확인해 주세요. 작업이 실패했다고 단정하지 마세요.",
        });
    } finally {
      pending.current = false;
    }
  };
  const invalidateDraft = () => {
    setPreview(null);
    setPreparedDraft(null);
    setCriteria("");
    setCommandState(idle);
  };
  const prepare = () => {
    const fields = common();
    if (!fields || !canPrepareWorkflow || !goal.trim()) return;
    const complex = complexRows.length > 0;
    const complexStatements = lines(complexCriteria);
    const problem = !complex
      ? null
      : !complexSupported
        ? "이 Runtime은 복합 작업 계획을 제공하지 않아요. 빠른 작업 또는 표준 작업을 준비하려면 작업 계획을 비워 주세요."
        : recipeId
          ? "검토한 실행 절차는 표준 작업 전용이며 복합 작업 계획과 함께 보낼 수 없어요. 실행 절차나 작업 계획 중 하나를 비워 주세요."
          : complexDraftProblem(complexRows, complexStatements.length);
    if (problem) {
      setCommandState({ status: "rejected", message: problem });
      return;
    }
    try {
      const request = decodeMutation({
        ...fields,
        type: "workflow.prepare",
        goal: goal.trim(),
        ...(recipeId ? { recipeId, recipeInputs: JSON.parse(recipeInputs) as unknown } : {}),
        ...(complex
          ? {
              acceptanceStatements: complexStatements,
              complexDraft: toComplexDraft(complexRows),
            }
          : preview
            ? { acceptanceStatements: lines(criteria) }
            : {}),
      });
      void submit(request);
    } catch {
      setCommandState({
        status: "rejected",
        message: complex
          ? "작업 계획을 확인해 주세요. 작업마다 제목(최대 80자)·목표(최대 300자)·중복 없는 검사 ID 1~16개가 필요해요. 검사 ID에는 영문자·숫자·점·밑줄·콜론·하이픈만 쓸 수 있어요. 파일 담당 범위는 정확한 프로젝트 상대 경로 최대 16개이며 와일드카드 패턴·점 경로·역슬래시·앞뒤 슬래시는 허용하지 않아요. 전체 계획은 12,288바이트 이내여야 해요."
          : "목표·실행 절차 JSON·수용 기준을 확인해 주세요. 비어 있지 않은 기준을 각 500자 이내로 최대 16개 입력할 수 있어요.",
      });
    }
  };
  const editComplexRows = (update: (rows: ComplexDraftRow[]) => ComplexDraftRow[]) => {
    invalidateDraft();
    setComplexRows(update);
  };
  const editComplexRow = (index: number, update: (row: ComplexDraftRow) => ComplexDraftRow) =>
    editComplexRows((rows) =>
      rows.map((row, position) => (position === index ? update(row) : row)),
    );
  const confirm = () => {
    const fields = common();
    if (!fields || !previewCurrent || !preview || state?.busy) return;
    const plan = preview.complexPlan;
    void submit(
      {
        ...fields,
        type: "workflow.confirm",
        previewId: preview.previewId,
        previewDigest: preview.previewDigest,
      },
      `이 ${weavraLabel(preview.workflow)} / ${preview.risk} / ${weavraLabel(preview.executionMode)} 계획을 다음 체크아웃에서 시작할까요: ${workspaceRoot}?\n목표: ${preview.goal}${
        plan
          ? `\n${
              plan.schemaVersion === 2 && plan.limits.maxParallel > 1
                ? `하나의 실행에서 계획 순서대로 작업해요. 선행 작업이 끝난 작업을 최대 ${plan.limits.maxParallel}개까지 동시에 구현한 뒤 하나씩 검사하고 검토해요`
                : "하나의 실행에서 이 순서로 진행할 작업"
            }: ${plan.tasks.map((task) => `${task.id} ${task.title}`).join("; ")}\n계획 다이제스트: ${plan.complexPlanDigest}\n확인 후에는 계획을 편집할 수 없어요. 모든 개별 작업이 끝나도 실행 완료 판정은 별도예요.`
          : ""
      }\n계획 확인은 R3 승인이 아니에요. 자동 커밋·되돌리기·정리는 없어요.`,
    );
  };
  const cancel = () => {
    const fields = common();
    if (!fields || !canCancel || !run || state?.stateRevision == null) return;
    void submit(
      {
        ...fields,
        type: "workflow.cancel",
        runId: run.runId,
        expectedStateRevision: state.stateRevision,
      },
      `다음 실행을 취소할까요: ${run.runId}?\nRuntime이 활성 워커와 검사를 멈춘 뒤 쓰기 잠금을 해제해요. 일부 변경은 남으며 자동 되돌리기·정리는 없어요.`,
    );
  };
  const resolveApproval = (decision: "approve" | "reject") => {
    const fields = common();
    if (!fields || !approval || approval.expiresAt <= observedAt || submitting) return;
    void submit(
      {
        ...fields,
        type: "approval.resolve",
        runId: approval.runId,
        expectedStateRevision: approval.stateRevision,
        approvalId: approval.approvalId,
        decision,
      },
      decision === "approve"
        ? `이 파일의 이번 삭제만 승인할까요: ${approval.path}?\n실행: ${approval.runId}\n승인: ${approval.approvalId}\n파일 지문: ${approval.preconditionDigest}\n자동 되돌리기는 없어요. 다른 동작을 승인하거나 완료로 판정하지 않아요.`
        : undefined,
    );
  };
  const startPlanner = () => {
    const fields = common();
    if (!fields || !canStartPlanner) return;
    try {
      void submit(plannerStartRequest(fields, goal.trim(), editorStatements));
    } catch {
      setCommandState({
        status: "rejected",
        message:
          "계획 담당에 보낼 목표나 수용 기준을 확인해 주세요. 목표는 최대 2,048자, 기준은 각 500자 이내로 1~16개예요.",
      });
    }
  };
  const cancelPlanner = () => {
    const fields = common();
    if (fields && canCancelPlanner && planner)
      void submit(plannerCancelRequest(fields, planner.planId));
  };
  const loadPlannerProposal = () => {
    const fields = common();
    if (fields && canLoadPlanner && planner)
      void submit(plannerReadRequest(fields, planner.planId));
  };
  const derive = () => {
    const fields = common();
    if (fields && canDerive && run) void submit(deriveRequest(fields, run.runId));
  };
  const inspectBrowser = () => {
    const fields = common();
    if (fields) void submit({ ...fields, type: "browser.inspect" });
  };
  const prepareBrowser = () => {
    const fields = common();
    if (!fields || !canPrepare || !browserInspectionCurrent || !candidate) return;
    try {
      void submit(
        decodeMutation({
          ...fields,
          type: "browser.prepare",
          registration: {
            candidateId: candidate.candidateId,
            expectedCandidateDigest: candidate.candidateDigest,
            checkId: browserCheckId,
            origin: candidate.origin,
            documentIdentity: candidate.documentIdentity,
            target: candidate.observation.target,
            assertion:
              assertionType === "element_exists" || assertionType === "element_not_exists"
                ? { type: assertionType }
                : { type: assertionType, expected: expectedValue },
            freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 15000 },
          },
        }),
      );
    } catch {
      setCommandState({
        status: "rejected",
        message:
          "검사 이름은 영문자나 숫자로 시작하는 1~64자로 입력해 주세요. 영문자·숫자·점·하이픈·밑줄만 사용할 수 있고, 지원하는 범위의 예상 결과가 필요해요.",
      });
    }
  };
  const confirmBrowser = () => {
    const fields = common();
    if (!fields || !canPrepare || !browserPreviewCurrent || !browserPreview) return;
    void submit(
      {
        ...fields,
        type: "browser.confirm",
        previewId: browserPreview.previewId,
        previewDigest: browserPreview.previewDigest,
      },
      `다음 대상에 이 브라우저 검사를 등록할까요: ${workspaceRoot}?\n검사: ${browserPreview.check.checkId}\n문서: ${browserPreview.check.documentIdentity}\n대상: ${browserPreview.check.target.selector}\n검사 조건: ${JSON.stringify(browserPreview.check.assertion)}\n등록 다이제스트: ${browserPreview.check.registrationDigest}\n예상 결과를 등록할 뿐 통과 판정이 아니에요. Runtime은 자체 검사와 테스트마다 새 격리 브라우저 캡처를 만들어야 해요. 브라우저 검사 실패 시 자동 수정하지 않아요.`,
    );
  };
  const prepareFact = () => {
    const fields = common();
    if (!fields || !canPrepare) return;
    try {
      void submit(
        decodeMutation({
          ...fields,
          type: "facts.prepare",
          sourceRef: factSource.trim(),
          statement: factStatement.trim(),
        }),
      );
    } catch {
      setCommandState({
        status: "rejected",
        message: "프로젝트 상대 출처 경로(최대 256자)와 짧은 설명(최대 500자)을 입력해 주세요.",
      });
    }
  };
  const confirmFact = () => {
    const fields = common();
    if (!fields || !canPrepare || !factPreviewCurrent || !factPreview) return;
    void submit(
      {
        ...fields,
        type: "facts.confirm",
        previewId: factPreview.previewId,
        previewDigest: factPreview.previewDigest,
      },
      `다음 대상에 검토한 참고용 사실을 기록할까요: ${workspaceRoot}?\n출처: ${factPreview.sourceRef}\n다이제스트: ${factPreview.sourceDigest}\n설명: ${factPreview.statement}\n설명이 출처로 뒷받침되며 비밀값·추론 원문·대화 기록·도구 출력을 포함하지 않는지 확인해 주세요. 정책·승인·검증·완료 판정이 아니에요.`,
    );
  };
  return (
    <SettingsSection id="weavra-controls" title={ko.runtime.controls.sectionTitle}>
      <SettingsGroup divided={false} className="space-y-5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Runtime 실행 제어</h3>
          <Badge variant={fresh ? "info" : "outline"}>
            {fresh ? "제어 연결됨" : "제어할 수 없음"}
          </Badge>
        </div>
        <div className="space-y-2 text-sm">
          <p className="break-words font-medium">
            {environment?.label ?? "연결 이름 확인 안 됨"} ·{" "}
            {projectName ?? workspaceRoot.split(/[\\/]/).findLast(Boolean) ?? "프로젝트"}
          </p>
          <p className="text-muted-foreground">
            Runtime은 작업을 준비하고 Kernel은 검증·완료를 판단해요. 연결이 끊겨도 작업을 자동으로
            재개하거나 요청을 대기열에 넣지 않아요.
          </p>
          <Button
            size="default"
            variant="outline"
            aria-expanded={diagnosticsOpen}
            onClick={() => setDiagnosticsOpen(!diagnosticsOpen)}
          >
            연결 진단 정보
          </Button>
          {diagnosticsOpen && (
            <div className="space-y-3 rounded-md border border-border p-3">
              <dl className="grid gap-3 sm:grid-cols-2">
                {diagnostics.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="mt-1 select-text break-all font-mono">{value}</dd>
                  </div>
                ))}
              </dl>
              <Button
                size="default"
                variant="outline"
                onClick={async () => {
                  try {
                    await writeTextToClipboard(
                      diagnostics.map(([label, value]) => `${label}: ${value}`).join("\n"),
                      "Runtime 진단",
                    );
                    setCopyStatus("진단 정보를 복사했어요.");
                  } catch (error) {
                    if (!(error instanceof Error)) throw error;
                    setCopyStatus("복사하지 못했어요. 진단 정보를 선택해 복사해 주세요.");
                  }
                }}
              >
                진단 정보 복사
              </Button>
              <p role="status">{copyStatus}</p>
            </div>
          )}
        </div>
        <CapabilityInventory
          view={view?.capabilityInventory}
          connected={fresh}
          scope={`${environmentId} / ${projectId} / ${workspaceRoot}`}
        />
        <div role="status" aria-live="polite" className="space-y-2 text-sm">
          <Badge
            variant={
              commandState.status === "rejected" || commandState.status === "transport-error"
                ? "warning"
                : "secondary"
            }
          >
            {ko.runtime.controls.commandStatus[commandState.status]}
          </Badge>
          <p>{commandState.message}</p>
        </div>
        {state?.startFailure && (
          <WeavraPreflightFailure configuration={fresh ? state.snapshot.configuration : null} />
        )}
        {run && (
          <div className="space-y-2 rounded-md border border-border p-3 text-xs">
            <p>
              공식 실행: <code className="break-all">{run.runId}</code>
            </p>
            <p>
              저장된 상태: <strong>{weavraLabel(run.status)}</strong> · 실행 리비전:{" "}
              {state?.stateRevision ?? ko.common.unknown} · 프로젝트 리비전:{" "}
              {state?.projectRevision ?? ko.common.unknown}
            </p>
            <p>
              소유 프로세스 작업:{" "}
              {state?.busy ? (state.cancelling ? "취소 요청됨; 정리 대기" : "진행 중") : "대기"} ·
              쓰기 잠금 존재: {weavraLabel(state?.snapshot.status.writerPresent)}
            </p>
            <p>작업 공간의 일부 변경을 자동으로 되돌리지 않아요.</p>
            <a
              href="#weavra-evidence"
              className="inline-flex rounded-sm underline underline-offset-4 hover:text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              수용 기준과 검증 증거 확인
            </a>
            {canCancel && (
              <Button size="sm" variant="outline" onClick={cancel}>
                워크플로 취소
              </Button>
            )}
          </div>
        )}
        {run && state?.complexExecution ? (
          <ComplexExecutionView
            execution={state.complexExecution}
            run={run}
            current={fresh}
            owned={state.ownedRunId === run.runId}
            observedAt={observation?.observedAt ?? null}
            writerPresent={state.snapshot.status.writerPresent}
            cancelling={state.cancelling}
          />
        ) : (
          run?.workflow === "COMPLEX" && (
            <p className="text-xs text-muted-foreground">
              이 Runtime은 복합 작업 상세를 제공하지 않아요. 위의 공식 실행 상태만 실행 결과로
              판단해요.
            </p>
          )
        )}
        {rerunOffered && run && state?.complexExecution && (
          <section
            aria-label="미완료 복합 작업"
            className="space-y-2 rounded-md border border-border p-3 text-xs"
          >
            <p>
              실행 {run.runId} 종료 상태: {weavraLabel(run.status)} 미완료:{" "}
              {state.complexExecution.tasks.filter((task) => task.status !== "COMPLETED").length} /{" "}
              {state.complexExecution.tasks.length} 개 작업이 미완료 상태예요. 다시 계획하면
              Runtime이 새 실행의 초안을 만들어요. 완료한 작업은 읽기 전용으로 다시 검증하고 미완료
              작업은 담당 범위를 유지해요. 이전 작업·증거를 재사용하지 않으며 직접 준비·확인하기
              전에는 시작하지 않아요.
            </p>
            <Button size="sm" variant="outline" disabled={!canDerive} onClick={derive}>
              미완료 작업 다시 계획
            </Button>
          </section>
        )}
        {foreignActiveRun && (
          <p
            aria-label="다른 소유자가 사용 중인 프로젝트"
            className="text-xs text-muted-foreground"
          >
            다른 Runtime 소유자가 이 프로젝트의 활성 실행을 관리하고 있어요. 소유 프로세스가
            종료됐다면 워크플로 준비 시 해당 실행을 중단됨으로 기록해요. 작업은 재개하지 않고 일부
            변경을 보존해요. 소유자가 실행 중이거나 종료를 확인할 수 없으면 요청을 거부해요.
          </p>
        )}
        {staleWriter && (
          <p
            aria-label="최근 실행 종료 후 남은 쓰기 잠금"
            className="text-xs text-muted-foreground"
          >
            최근 실행이 종료됐지만 쓰기 잠금이 남아 있어요: {weavraLabel(run?.status)}. 소유
            프로세스가 종료됐다면 워크플로 준비 시 Runtime이 잠금을 해제해요. 프로젝트 상태가 바뀌어
            STALE_PROJECT가 반환되면 새 상태를 확인한 뒤 다시 준비해 주세요. 실행 중이거나 종료를
            확인할 수 없으면 WRITER_PRESENT로 거부해요. 작업을 재개하지 않으며 일부 변경은 보존해요.
          </p>
        )}
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            prepare();
          }}
        >
          <label className="block space-y-1 text-sm">
            <span>워크플로 목표</span>
            <Textarea
              aria-label="워크플로 목표"
              maxLength={2048}
              value={goal}
              onChange={(event) => {
                invalidateDraft();
                setGoal(event.target.value);
              }}
              disabled={submitting || !fresh || !!state?.busy}
              placeholder="이 체크아웃에서 수행할 작업을 입력해 주세요"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>검토한 실행 절차(선택 사항)</span>
            <select
              aria-label="검토한 실행 절차"
              value={recipeId}
              disabled={submitting || !fresh || !!state?.busy}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              onChange={(event) => {
                invalidateDraft();
                setRecipeId(event.target.value);
                setRecipeInputs(
                  observation?.capabilities?.recipes.find(
                    (recipe) => recipe.id === event.target.value,
                  )?.inputTemplate ?? "{}",
                );
              }}
            >
              <option value="">실행 절차 없음</option>
              {observation?.capabilities?.recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.title} · v{recipe.version}
                </option>
              ))}
            </select>
          </label>
          {recipeId && (
            <label className="block space-y-1 text-sm">
              <span>실행 절차 입력값(JSON 데이터만)</span>
              <Textarea
                aria-label="실행 절차 입력값"
                value={recipeInputs}
                maxLength={16384}
                onChange={(event) => {
                  invalidateDraft();
                  setRecipeInputs(event.target.value);
                }}
                disabled={submitting || !fresh || !!state?.busy}
                className="font-mono text-xs"
              />
            </label>
          )}
          {(complexSupported || complexRows.length > 0) && (
            <section
              aria-label="복합 작업 계획"
              className="space-y-3 rounded-md border border-border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-medium">구조화된 작업 계획 · 복합 작업(선택 사항)</h4>
                <Badge variant={complexSupported ? "outline" : "warning"}>
                  {complexSupported ? `Runtime 계약 v${complexVersion}` : "제공되지 않음"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Runtime이 복합 작업으로 분류한 목표에만 적용해요.{" "}
                {complexVersion === 2
                  ? "선행 작업이 끝난 작업은 Runtime에 설정된 한도까지 동시에 구현할 수 있어요. 검사와 검토는 계획 순서대로 하나씩 진행해요. 순서를 정하려면 의존성을 추가해 주세요."
                  : "하나의 Runtime 소유 실행에서 순서대로 하나씩 진행해요."}{" "}
                Runtime이 작업 ID를 부여하고 의존성·수용 기준 범위·정확한 파일 담당 범위·등록 검사를
                검증해요. 확인 후에는 계획을 편집할 수 없어요.
              </p>
              {(complexRows.length > 0 || plannerExposed) && (
                <label className="block space-y-1 text-sm">
                  <span>상위 수용 기준 · 한 줄에 하나씩(1~16개)</span>
                  <Textarea
                    aria-label="복합 작업 수용 기준"
                    value={complexCriteria}
                    maxLength={16384}
                    disabled={!canEditDraft || !complexSupported}
                    onChange={(event) => {
                      invalidateDraft();
                      setComplexCriteria(event.target.value);
                    }}
                  />
                </label>
              )}
              {loadedDraft && loadedUnchanged && (
                <div
                  role="note"
                  aria-label="불러온 계획 담당 제안"
                  className="space-y-1 rounded-md border border-warning/50 p-3 text-xs"
                >
                  <p className="font-medium">
                    준비하기 전에 각 작업·파일 담당 범위·검사를 검토해 주세요.
                  </p>
                  <p className="text-muted-foreground">
                    아직 편집하지 않은 계획 담당 제안이에요. 준비 시 다시 검증하며 Runtime
                    미리보기를 확인하기 전에는 실행하지 않아요.
                  </p>
                  {loadedCurrent === false && (
                    <p>계획 생성 후 프로젝트나 설정이 바뀌어 현재 상태와 다를 수 있어요.</p>
                  )}
                  {editorDigest !== loadedDraft.requestDigest && (
                    <p>편집기의 현재 목표·수용 기준과 다른 내용으로 만든 계획이에요.</p>
                  )}
                </div>
              )}
              {derivedShown && derivedDraft && (
                <section
                  aria-label="다시 실행할 작업 초안"
                  className="space-y-2 rounded-md border border-warning/50 p-3 text-xs"
                >
                  {derivedUnchanged ? (
                    <p className="font-medium">{derivedBanner(derivedDraft)}</p>
                  ) : (
                    <p>
                      편집기의 내용이 생성된 초안에서 바뀌었어요. 아래 준비 검사와 메모는 최초
                      초안에 관한 것이며, 준비 시 편집기 내용을 다시 검사해요.
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    파일 담당 범위는 초안 생성 시점의 파일을 기준으로 해요. 남은 변경을 직접
                    커밋하거나 정리한 뒤 초안을 다시 만들어 생성·수정 구분을 체크아웃과 맞춰 주세요.
                    일반적인 새 실행이며 이전 작업이나 증거를 재사용하지 않아요.
                  </p>
                  <div aria-label="남은 변경사항" className="space-y-1">
                    {derivedDraft.leftovers.clean === false ? (
                      <>
                        <p>
                          이 변경을 직접 커밋하거나 정리하기 전에는 새 실행을 시작할 수 없어요.
                          Runtime은 둘 다 자동으로 하지 않아요.
                        </p>
                        <ul className="space-y-0.5 font-mono">
                          {derivedDraft.leftovers.paths.map((path) => (
                            <li key={path} className="break-all">
                              {path}
                            </li>
                          ))}
                        </ul>
                        {derivedDraft.leftovers.truncated && (
                          <p>
                            표시하지 못한 변경이 더 있어요. 목록은 경로 200개 또는 16,384바이트까지
                            표시해요.
                          </p>
                        )}
                      </>
                    ) : derivedDraft.leftovers.clean === null ? (
                      <p>
                        작업 공간 상태를 확인할 수 없어요. 초안 생성 시 Git 변경 조회가 실패해 새
                        실행을 막는 변경이 남아 있을 수 있어요.
                      </p>
                    ) : (
                      <p>초안 생성 시 남은 변경사항이 없었어요.</p>
                    )}
                  </div>
                  <p aria-label="준비 검사">
                    {derivedDraft.prepareCheck.ok
                      ? "초안 생성 시 준비 검사를 통과했어요. 미리보기가 아니며 준비 시 편집기 내용을 다시 검사해요."
                      : `초안 생성 시 준비 검사에서 거부됨: ${derivedDraft.prepareCheck.code}. 메모에서 사유를 확인하고 작업 계획을 수정한 뒤 준비해 주세요.`}
                  </p>
                  {derivedDraft.notes.length > 0 && (
                    <ul aria-label="초안 생성 메모" className="space-y-0.5">
                      {derivedDraft.notes.map((note, position) => (
                        // Fixed-template notes may repeat; their position is their identity.
                        // oxlint-disable-next-line react/no-array-index-key
                        <li key={position} className="break-words">
                          {note}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Button size="sm" variant="outline" disabled={!canDerive} onClick={derive}>
                    초안 다시 만들기
                  </Button>
                </section>
              )}
              {complexRows.map((row, index) => {
                const task = index + 1;
                const editable = canEditDraft && complexSupported;
                return (
                  <fieldset
                    key={task}
                    aria-label={`작업 ${task}`}
                    className="space-y-2 rounded-md border border-border p-3 text-sm"
                  >
                    <legend className="px-1 text-xs font-medium">작업 {task}</legend>
                    <input
                      aria-label={`작업 ${task} 제목`}
                      value={row.title}
                      maxLength={80}
                      disabled={!editable}
                      placeholder="짧은 제목"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      onChange={(event) => {
                        const title = event.target.value;
                        editComplexRow(index, (current) => ({ ...current, title }));
                      }}
                    />
                    <Textarea
                      aria-label={`작업 ${task} 목표`}
                      value={row.goal}
                      maxLength={300}
                      disabled={!editable}
                      placeholder="상위 목표에서 이 작업이 맡을 범위"
                      onChange={(event) => {
                        const taskGoal = event.target.value;
                        editComplexRow(index, (current) => ({ ...current, goal: taskGoal }));
                      }}
                    />
                    {index > 0 && (
                      <div className="flex flex-wrap gap-3 text-xs">
                        <span className="text-muted-foreground">선행 작업</span>
                        {Array.from({ length: index }, (_, earlier) => earlier + 1).map(
                          (dependency) => (
                            <label key={dependency} className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                aria-label={`작업 ${task}의 선행 작업 ${dependency}`}
                                checked={row.dependsOnIndexes.includes(dependency)}
                                disabled={!editable}
                                onChange={() =>
                                  editComplexRow(index, (current) => ({
                                    ...current,
                                    dependsOnIndexes: toggled(current.dependsOnIndexes, dependency),
                                  }))
                                }
                              />
                              작업 {dependency}
                            </label>
                          ),
                        )}
                      </div>
                    )}
                    <div className="space-y-1 text-xs">
                      <span className="text-muted-foreground">이 작업이 충족할 수용 기준</span>
                      {lines(complexCriteria).map((statement, position) => (
                        // A criterion's number is its position; the draft sends 1-based indexes.
                        // oxlint-disable-next-line react/no-array-index-key
                        <label key={position} className="flex items-start gap-1 break-words">
                          <input
                            type="checkbox"
                            aria-label={`작업 ${task}의 수용 기준 연결 ${position + 1}`}
                            checked={row.criterionIndexes.includes(position + 1)}
                            disabled={!editable}
                            onChange={() =>
                              editComplexRow(index, (current) => ({
                                ...current,
                                criterionIndexes: toggled(current.criterionIndexes, position + 1),
                              }))
                            }
                          />
                          {position + 1}. {statement}
                        </label>
                      ))}
                    </div>
                    <div className="space-y-1 text-xs">
                      <span className="text-muted-foreground">
                        정확한 파일 담당 범위 · 권한 부여가 아니에요
                      </span>
                      {row.ownership.map((claim, position) => (
                        // Claims are positional rows of controlled inputs and are never reordered.
                        // oxlint-disable-next-line react/no-array-index-key
                        <div key={position} className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`작업 ${task} 담당 범위 ${position + 1} 종류`}
                            value={claim.operation}
                            disabled={!editable}
                            className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                            onChange={(event) => {
                              const operation = event.target.value;
                              if (
                                operation === "modify" ||
                                operation === "create" ||
                                operation === "delete"
                              )
                                editComplexRow(index, (current) => ({
                                  ...current,
                                  ownership: current.ownership.map((item, at) =>
                                    at === position ? { ...item, operation } : item,
                                  ),
                                }));
                            }}
                          >
                            <option value="modify">{weavraLabel("modify")}</option>
                            <option value="create">{weavraLabel("create")}</option>
                            <option value="delete">{weavraLabel("delete")}</option>
                          </select>
                          <input
                            aria-label={`작업 ${task} 담당 범위 ${position + 1} 경로`}
                            value={claim.path}
                            maxLength={256}
                            disabled={!editable}
                            placeholder="src/exact-file.ts"
                            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs"
                            onChange={(event) => {
                              const path = event.target.value;
                              editComplexRow(index, (current) => ({
                                ...current,
                                ownership: current.ownership.map((item, at) =>
                                  at === position ? { ...item, path } : item,
                                ),
                              }));
                            }}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`작업 ${task} 담당 범위 ${position + 1} 제거`}
                            disabled={!editable}
                            onClick={() =>
                              editComplexRow(index, (current) => ({
                                ...current,
                                ownership: current.ownership.filter((_, at) => at !== position),
                              }))
                            }
                          >
                            제거
                          </Button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`작업 ${task}에 파일 담당 범위 추가`}
                        disabled={!editable || row.ownership.length >= 16}
                        onClick={() =>
                          editComplexRow(index, (current) => ({
                            ...current,
                            ownership: [...current.ownership, { path: "", operation: "modify" }],
                          }))
                        }
                      >
                        파일 담당 범위 추가
                      </Button>
                    </div>
                    <input
                      aria-label={`작업 ${task}의 검사 ID`}
                      value={row.checkIds}
                      maxLength={2200}
                      disabled={!editable}
                      placeholder="등록 검사 ID를 공백으로 구분해 주세요"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 font-mono text-xs"
                      onChange={(event) => {
                        const checkIds = event.target.value;
                        editComplexRow(index, (current) => ({ ...current, checkIds }));
                      }}
                    />
                  </fieldset>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!canEditDraft || !complexSupported || complexRows.length >= 8}
                  onClick={() => editComplexRows((rows) => [...rows, emptyComplexRow])}
                >
                  작업 추가
                </Button>
                {complexRows.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canEditDraft || !complexSupported}
                      onClick={() => editComplexRows((rows) => rows.slice(0, -1))}
                    >
                      마지막 작업 제거
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canEditDraft}
                      onClick={() => {
                        editComplexRows(() => []);
                        setComplexCriteria("");
                        setDerivedDraft(null);
                      }}
                    >
                      작업 계획 비우기
                    </Button>
                  </>
                )}
              </div>
              {plannerExposed && (
                <section
                  aria-label={ko.runtime.controls.planner}
                  className="space-y-3 border-t border-border pt-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="text-sm font-medium">계획 담당 · 작업 목록 제안</h5>
                    <Badge variant="outline">검토 전 후보</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Runtime이 설정된 계획 모델을 최대 3회 호출해 목표와 수용 기준에 맞는 작업 목록을
                    제안받아요. 파일명·프로젝트 지침·검토한 사실만 제한된 범위로 전달해요. 제안을
                    자동으로 불러오거나 준비·실행하지 않아요.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canStartPlanner}
                    onClick={startPlanner}
                  >
                    계획 담당으로 초안 만들기
                  </Button>
                  {planner?.status === "RUNNING" && (
                    <div
                      aria-label="계획 담당 실행 중"
                      className="space-y-2 rounded-md border border-border p-3 text-xs"
                    >
                      <p>
                        계획 생성 중 · 경과{" "}
                        {plannerSeconds(plannerElapsedMs(planner, observation?.observedAt ?? null))}{" "}
                        · {plannerRoute(planner.route)} · {plannerUsage(planner.usage)}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canCancelPlanner}
                        onClick={cancelPlanner}
                      >
                        계획 생성 취소
                      </Button>
                    </div>
                  )}
                  {plannerProposal && (
                    <section
                      aria-label="계획 담당 제안"
                      className="space-y-2 rounded-md border border-warning/50 p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h5 className="text-sm font-medium">계획 담당 제안 — 검토 전</h5>
                        <div className="flex flex-wrap gap-2">
                          {!plannerProposal.current && (
                            <Badge variant="warning">현재 정보 아님</Badge>
                          )}
                          {editorDigest !== plannerProposal.requestDigest && (
                            <Badge variant="warning">다른 목표 또는 기준</Badge>
                          )}
                        </div>
                      </div>
                      <p>
                        {plannerProposal.taskCount} 개 작업 · {plannerRoute(plannerProposal.route)}{" "}
                        · {plannerUsage(plannerProposal.usage)}
                      </p>
                      {!plannerProposal.current && (
                        <p>
                          계획 생성 후 프로젝트나 설정이 바뀌었어요. 초안으로만 참고해 주세요. 준비
                          시 전체를 다시 검증해요.
                        </p>
                      )}
                      {editorDigest !== plannerProposal.requestDigest && (
                        <p>이 제안은 편집기의 목표나 수용 기준과 다른 내용으로 만들었어요.</p>
                      )}
                      <p className="text-muted-foreground">
                        불러오면 편집기의 작업 목록만 바뀌어요. 직접 준비·확인하기 전에는 실행하지
                        않아요. 초안을 다시 만들면 이 제안이 교체돼요.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={!canLoadPlanner} onClick={loadPlannerProposal}>
                          편집기로 불러오기
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDismissedPlanId(plannerProposal.planId)}
                        >
                          버리기
                        </Button>
                      </div>
                    </section>
                  )}
                  {planner?.status === "READY" && planner.planId === dismissedPlanId && (
                    <p className="text-xs text-muted-foreground">
                      앱에서 제안을 버렸어요. Runtime은 계획을 다시 만들거나 실행을 확인할 때까지
                      보관해요.{" "}
                      <Button size="sm" variant="outline" onClick={() => setDismissedPlanId(null)}>
                        제안 보기
                      </Button>
                    </p>
                  )}
                  {planner?.status === "FAILED" && planner.failureCode && (
                    <p aria-label="계획 담당 실패" className="text-xs">
                      계획 담당 실패: <strong>{planner.failureCode}</strong> —{" "}
                      {plannerFailureText[planner.failureCode]} 초안을 만들지 못했어요. 준비되면
                      다시 요청해 주세요.
                    </p>
                  )}
                  {planner?.status === "CANCELLED" && (
                    <p className="text-xs">계획 생성을 취소했어요. 만든 초안은 없어요.</p>
                  )}
                </section>
              )}
            </section>
          )}
          <p id="weavra-prepare-reason" className="text-sm text-muted-foreground">
            {prepareReason}
          </p>
          <Button
            size="default"
            type="submit"
            variant={canPrepareWorkflow && goal.trim() ? "default" : "outline"}
            className="disabled:bg-muted disabled:text-foreground disabled:opacity-100"
            aria-describedby="weavra-prepare-reason"
            disabled={!canPrepareWorkflow || !goal.trim()}
          >
            {preview ? "계획 미리보기 새로고침" : "워크플로 준비"}
          </Button>
        </form>
        {preview && (
          <section
            aria-label="Runtime 계획 미리보기"
            className="space-y-4 rounded-md border border-border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium">Runtime 계획 미리보기</h4>
              <Badge variant={previewCurrent ? "info" : "warning"}>
                {previewCurrent ? "현재 미리보기" : "검토·새로고침 필요"}
              </Badge>
            </div>
            <p className="text-sm">{preview.goal}</p>
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              {[
                [ko.runtime.controls.workflow, weavraLabel(preview.workflow)],
                [ko.runtime.controls.risk, preview.risk],
                ["실행 방식", weavraLabel(preview.executionMode)],
                ["허용 범위", preview.allowedPaths.join(", ") || "없음"],
                [
                  ko.runtime.controls.recipe,
                  preview.recipe ? `${preview.recipe.id}@${preview.recipe.version}` : "없음",
                ],
                ["만료", new Date(preview.expiresAt).toLocaleString()],
                [
                  ko.runtime.controls.configuration,
                  Object.entries(preview.configuration)
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(" · "),
                ],
                ["작업 계약 다이제스트", preview.taskContractDigest],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="text-xs">
              <h5 className="font-medium">Runtime에 등록된 검사</h5>
              <ul className="mt-1 space-y-1">
                {preview.checks.map((check) => (
                  <li key={check.id}>
                    {check.id} · {weavraLabel(check.kind)} ·{" "}
                    {check.required ? "required" : "optional"}
                  </li>
                ))}
              </ul>
            </div>
            {preview.complexPlan ? (
              <p className="text-xs text-muted-foreground">
                상위 수용 기준은 작업 계획에서 가져와요. 바꾸려면 작업 계획을 편집하고 다시 준비해
                주세요.
              </p>
            ) : (
              <label className="block space-y-1 text-sm">
                <span>수용 기준 · 한 줄에 하나씩</span>
                <Textarea
                  aria-label="수용 기준"
                  value={criteria}
                  maxLength={16384}
                  disabled={!fresh || submitting || !!state?.busy}
                  onChange={(event) => setCriteria(event.target.value)}
                />
              </label>
            )}
            <ul className="space-y-1 text-xs text-muted-foreground">
              {preview.acceptanceCriteria.map((criterion) => (
                <li key={criterion.id} className="break-words">
                  {criterion.id}
                  {preview.complexPlan ? ` · ${criterion.statement}` : ""} · 검사:{" "}
                  {criterion.checkIds.join(", ") || "없음"} · 독립 검토:{" "}
                  {criterion.reviewRequired ? "필수" : "필수 아님"}
                </li>
              ))}
            </ul>
            {preview.complexPlan && (
              <ComplexPlanView plan={preview.complexPlan} criteria={preview.acceptanceCriteria} />
            )}
            <p className="text-xs text-muted-foreground">
              기준을 편집하면 새 Runtime 미리보기가 필요해요. 앱은 기준 ID·검증 연결·확정 계약을
              부여하지 않아요. 확인은 승인 토큰이 아니에요.
            </p>
            <Button
              size="sm"
              disabled={!previewCurrent || submitting || !!state?.busy}
              onClick={confirm}
            >
              확인 후 시작
            </Button>
          </section>
        )}
        <section
          aria-label="검토한 프로젝트 사실"
          className="space-y-4 border-t border-border pt-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">검토한 프로젝트 사실</h3>
            <Badge variant="outline">참고 자료 전용</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            허용된 로컬 소스 하나와 짧은 설명을 대조해 검토해 주세요. 자동 추출이나 공급자 호출은
            없어요. 비밀값·추론 원문·대화 기록·도구 출력은 넣지 마세요. 사실 정보는 권한을
            부여하거나 검사·검토를 대신하거나 실행을 완료할 수 없어요. 완료 판정은 Kernel이
            담당해요.
          </p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              prepareFact();
            }}
          >
            <label className="block space-y-1 text-sm">
              <span>사실 출처 · 프로젝트 상대 파일 경로</span>
              <Textarea
                aria-label="사실 출처"
                rows={1}
                maxLength={256}
                value={factSource}
                disabled={!canPrepare}
                onChange={(event) => {
                  setFactSource(event.target.value);
                  setFactPreview(null);
                  setPreparedFactDraft(null);
                }}
                placeholder="src/project-notes.txt"
              />
            </label>
            <label className="block space-y-1 text-sm">
              <span>사실 설명</span>
              <Textarea
                aria-label="사실 설명"
                maxLength={500}
                value={factStatement}
                disabled={!canPrepare}
                onChange={(event) => {
                  setFactStatement(event.target.value);
                  setFactPreview(null);
                  setPreparedFactDraft(null);
                }}
                placeholder="출처로 확인할 수 있는 짧은 설명 하나"
              />
            </label>
            <Button
              size="sm"
              type="submit"
              disabled={!canPrepare || !factSource.trim() || !factStatement.trim()}
            >
              사실 검토 준비
            </Button>
          </form>
          {factPreview && (
            <section
              aria-label="Runtime 사실 미리보기"
              className="space-y-3 rounded-md border border-border p-3"
            >
              <Badge variant={factPreviewCurrent ? "info" : "warning"}>
                {factPreviewCurrent ? "검토 필요 · 저장 전" : "미리보기 변경됨 · 다시 준비"}
              </Badge>
              <p className="text-sm">{factPreview.statement}</p>
              <p className="break-all text-xs">출처: {factPreview.sourceRef}</p>
              <p className="break-all font-mono text-xs">다이제스트: {factPreview.sourceDigest}</p>
              <Button size="sm" disabled={!canPrepare || !factPreviewCurrent} onClick={confirmFact}>
                검토한 사실 확인
              </Button>
            </section>
          )}
          <div aria-label="Runtime의 공식 프로젝트 사실" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Runtime은 관찰하거나 워커에 전달할 때마다 출처 식별 정보와 다이제스트를 확인해요. 같은
              출처를 다시 검토하면 사실 ID는 유지하고 검토 내용을 바꿔요. 출처는 최대 16개예요.
            </p>
            {!fresh || state?.projectFacts.status !== "available" ? (
              <p className="text-xs text-muted-foreground">
                사실 정보를 불러올 수 없거나 관찰이 오래됐어요. 현재 유효한 사실로 판단하지 않아요.
              </p>
            ) : state.projectFacts.entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">이 체크아웃에는 검토한 사실이 없어요.</p>
            ) : (
              state.projectFacts.entries.map((fact) => (
                <article
                  key={fact.id}
                  className="space-y-2 rounded-md border border-border bg-muted/20 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all text-xs">{fact.sourceRef}</code>
                    <Badge variant={fact.status === "VALID" ? "info" : "warning"}>
                      {weavraLabel(fact.status)}
                    </Badge>
                  </div>
                  <p className="text-sm">
                    {fact.status === "VALID"
                      ? fact.statement
                      : "출처가 바뀌었거나 검증할 수 없어요. 설명을 표시하거나 현재 참고 자료로 전달하지 않아요. 직접 다시 검토해 주세요."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    검토 시각: {new Date(fact.reviewedAt).toLocaleString()} · 마지막 Runtime 관찰
                    시점의 상태
                  </p>
                  <p className="break-all font-mono text-xs">ID: {fact.id}</p>
                  <p className="break-all font-mono text-xs">다이제스트: {fact.sourceDigest}</p>
                </article>
              ))
            )}
          </div>
        </section>
        <section
          aria-label="브라우저 증거와 검사 등록"
          className="space-y-4 border-t border-border pt-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">브라우저 검사</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                관찰 → 예상 결과 검토 → 등록 → 독립 검증
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!fresh || submitting}
              onClick={inspectBrowser}
            >
              브라우저 증거 새로고침
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            로컬 정적 문서만 지원해요. 후보는 기록된 관찰일 뿐 검사나 현재 페이지 상태의 증거가
            아니에요. Runtime이 등록과 새 격리 홈 디렉터리·프로필·CDP 파이프 캡처를 수행하고
            Kernel이 완료를 판정해요. 브라우저 격리는 OS 샌드박스가 아니에요. 개인 브라우저
            세션·스크립트·상호작용은 허용하지 않아요.
          </p>
          {browserInspection && (
            <>
              <Badge variant={browserInspectionCurrent ? "outline" : "warning"}>
                {browserInspectionCurrent ? "기록된 Runtime 관찰" : "오래된 관찰 · 새로고침 필요"}
              </Badge>
              {browserInspection.data.candidates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  저장된 대상 후보가 없어요. Runtime 브라우저 관찰 명령에서 후보 저장을 명시해
                  주세요.
                </p>
              )}
              <div className="space-y-3">
                {browserInspection.data.candidates.map((item) => (
                  <article
                    key={item.candidateId}
                    className="space-y-3 rounded-md border border-border bg-muted/20 p-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <code className="text-xs">
                        {item.observation.target.selector}
                        {item.observation.target.attribute
                          ? ` · ${item.observation.target.attribute}`
                          : ""}
                      </code>
                      <Badge variant="warning">후보 전용(CANDIDATE_ONLY)</Badge>
                    </div>
                    <dl className="grid gap-2 text-xs sm:grid-cols-2">
                      {[
                        [ko.runtime.controls.origin, item.origin],
                        ["문서", item.documentIdentity],
                        ["캡처 시각", new Date(item.capturedAt).toLocaleString()],
                        [
                          "관찰한 값",
                          item.observation.exists
                            ? (item.observation.value ?? "(속성 없음)")
                            : "(요소 없음)",
                        ],
                        [ko.runtime.controls.candidate, item.candidateId],
                        ["후보 다이제스트", item.candidateDigest],
                        ["문서 리비전", item.pageRevision],
                        ["관찰기 리비전", item.source.readerRevision],
                      ].map(([label, value]) => (
                        <div key={label}>
                          <dt className="text-muted-foreground">{label}</dt>
                          <dd className="mt-1 whitespace-pre-wrap break-all">{value}</dd>
                        </div>
                      ))}
                    </dl>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canPrepare || !browserInspectionCurrent}
                      onClick={() => {
                        setCandidateId(item.candidateId);
                        setAssertionType(
                          item.observation.target.attribute ? "attribute_equals" : "text_equals",
                        );
                        setExpectedValue(item.observation.value ?? "");
                        setBrowserPreview(null);
                        setPreparedBrowserDraft(null);
                      }}
                    >
                      {candidateId === item.candidateId ? "검토 대상으로 선택됨" : "이 후보 검토"}
                    </Button>
                  </article>
                ))}
              </div>
              {browserInspection.data.omittedCandidates > 0 && (
                <p className="text-xs text-muted-foreground">
                  {browserInspection.data.omittedCandidates} 개 후보를 표시 한도 때문에 생략했어요.
                </p>
              )}
              {candidate && (
                <form
                  aria-label="브라우저 예상 결과 편집기"
                  className="space-y-3 rounded-md border border-border p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    prepareBrowser();
                  }}
                >
                  <p className="text-xs text-muted-foreground">
                    관찰한 값은 초안일 뿐이에요. Runtime 미리보기를 요청하기 전에 예상 동작을
                    검토하고 편집해 주세요.
                  </p>
                  <label className="block space-y-1 text-sm">
                    <span>브라우저 검사 이름</span>
                    <input
                      aria-label="브라우저 검사 이름"
                      value={browserCheckId}
                      maxLength={64}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      disabled={!canPrepare || !browserInspectionCurrent}
                      onChange={(event) => setBrowserCheckId(event.target.value)}
                      placeholder="status-ready"
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>브라우저 검사 조건</span>
                    <select
                      aria-label="브라우저 검사 조건"
                      value={assertionType}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      disabled={!canPrepare || !browserInspectionCurrent}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (
                          value === "text_equals" ||
                          value === "text_contains" ||
                          value === "element_exists" ||
                          value === "element_not_exists" ||
                          value === "attribute_equals"
                        )
                          setAssertionType(value);
                      }}
                    >
                      {(candidate.observation.target.attribute
                        ? ["attribute_equals"]
                        : ["text_equals", "text_contains", "element_exists", "element_not_exists"]
                      ).map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </label>
                  {assertionType !== "element_exists" && assertionType !== "element_not_exists" && (
                    <label className="block space-y-1 text-sm">
                      <span>예상 값 · 검토하고 편집해 주세요</span>
                      <Textarea
                        aria-label="브라우저 예상 값"
                        value={expectedValue}
                        maxLength={1024}
                        disabled={!canPrepare || !browserInspectionCurrent}
                        onChange={(event) => setExpectedValue(event.target.value)}
                      />
                    </label>
                  )}
                  <p className="text-xs text-muted-foreground">
                    고정된 대상: {candidate.observation.target.selector} · 검증마다 새 캡처 · 증거
                    유효 시간 최대 15초
                  </p>
                  <Button
                    type="submit"
                    size="sm"
                    disabled={
                      !canPrepare ||
                      !browserInspectionCurrent ||
                      !browserCheckId ||
                      (assertionType === "text_contains" && !expectedValue)
                    }
                  >
                    브라우저 검사 등록 준비
                  </Button>
                </form>
              )}
              {browserPreview && (
                <section
                  aria-label="Runtime 브라우저 등록 미리보기"
                  className="space-y-3 rounded-md border border-border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-medium">Runtime 브라우저 등록 미리보기</h4>
                    <Badge variant={browserPreviewCurrent ? "info" : "warning"}>
                      {browserPreviewCurrent ? "등록 전에 검토해 주세요" : "미리보기 새로고침 필요"}
                    </Badge>
                  </div>
                  <dl className="grid gap-2 text-xs sm:grid-cols-2">
                    {[
                      [ko.runtime.controls.check, browserPreview.check.checkId],
                      ["문서", browserPreview.check.documentIdentity],
                      ["대상", JSON.stringify(browserPreview.check.target)],
                      [
                        ko.runtime.controls.expectation,
                        JSON.stringify(browserPreview.check.assertion),
                      ],
                      ["등록 다이제스트", browserPreview.check.registrationDigest],
                      ["미리보기 다이제스트", browserPreview.previewDigest],
                      ["만료", new Date(browserPreview.expiresAt).toLocaleString()],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="mt-1 whitespace-pre-wrap break-all">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    확인하면 이 예상 결과만 등록해요. 페이지 캡처·통과 판정·워크플로 시작·자동 수정
                    허용은 하지 않아요.
                  </p>
                  <Button
                    size="sm"
                    disabled={!canPrepare || !browserPreviewCurrent}
                    onClick={confirmBrowser}
                  >
                    브라우저 검사 등록 확인
                  </Button>
                </section>
              )}
              <div className="space-y-2 text-xs">
                <h4 className="font-medium">Runtime 등록 목록 · 기록된 상태</h4>
                {browserInspection.data.checks.length === 0 && (
                  <p className="text-muted-foreground">표시할 등록된 브라우저 검사가 없어요.</p>
                )}
                {browserInspection.data.checks.map(({ check, required }) => (
                  <div
                    key={check.checkId}
                    className="space-y-1 rounded-md border border-border p-3"
                  >
                    <p>
                      {check.checkId} · {required ? "required" : "optional"} ·{" "}
                      <strong>등록됨, 아직 미검증</strong>
                    </p>
                    <p className="break-all">
                      {check.documentIdentity} · {check.target.selector}
                    </p>
                    <p className="whitespace-pre-wrap break-all">
                      {JSON.stringify(check.assertion)}
                    </p>
                    <p className="break-all text-muted-foreground">{check.registrationDigest}</p>
                  </div>
                ))}
                {browserInspection.data.omittedChecks > 0 && (
                  <p className="text-muted-foreground">
                    {browserInspection.data.omittedChecks} 개 검사를 생략했어요.
                  </p>
                )}
              </div>
              <div className="space-y-2 text-xs">
                <h4 className="font-medium">최근 저장된 실행 · 기록된 브라우저 증거</h4>
                <p className="text-muted-foreground">
                  기록된 통과 결과는 해당 캡처·실행·단계·리비전에만 적용돼요. 현재 페이지 상태가
                  아니에요. 증거가 없거나 불러올 수 없을 때 과거에 통과한 실행으로 대체하지 않아요.
                </p>
                {browserInspection.data.evidence.length === 0 && (
                  <p className="text-muted-foreground">최근 실행에 브라우저 검증 증거가 없어요.</p>
                )}
                {browserInspection.data.evidence.map((entry) => (
                  <div
                    key={`${entry.runId}:${entry.checkId}:${entry.revision}:${entry.step?.stepId}:${entry.step?.attempt ?? "unknown"}`}
                    className="space-y-1 rounded-md border border-border p-3"
                  >
                    <p>
                      {entry.checkId} · {entry.step?.stepId ?? "단계 미확인"} ·{" "}
                      <strong>{weavraLabel(entry.status)}</strong>
                    </p>
                    <p className="break-all">
                      실행 {entry.runId} · 리비전 {entry.revision}
                    </p>
                    {entry.browser ? (
                      <>
                        <p>
                          캡처 시각 {new Date(entry.browser.capturedAt).toLocaleString()} · 정리
                          상태 {entry.browser.cleanup}
                        </p>
                        <p className="break-all">{entry.browser.documentIdentity}</p>
                        <p className="break-all text-muted-foreground">
                          등록 정보 {entry.browser.registrationDigest}
                        </p>
                        <p className="break-all text-muted-foreground">
                          문서 {entry.browser.documentDigest}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">
                        이 결과에 사용할 수 있는 브라우저 캡처 정보가 없어요.
                      </p>
                    )}
                  </div>
                ))}
                {browserInspection.data.omittedEvidence > 0 && (
                  <p className="text-muted-foreground">
                    {browserInspection.data.omittedEvidence} 개 브라우저 결과를 생략했어요.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
        {approval && (
          <section
            aria-label="대기 중인 R3 승인"
            className="space-y-3 rounded-md border border-warning/50 p-4 text-sm"
          >
            <h4 className="font-medium">대기 중인 R3 승인 · 파일 하나 삭제</h4>
            <p>{approval.explanation}</p>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              {[
                ["대상", approval.path],
                ["실행", approval.runId],
                ["승인", approval.approvalId],
                ["작업 / 역할", `${approval.operation} / ${approval.role}`],
                ["단계", `${approval.step.stepId}@${approval.step.attempt}`],
                [
                  "실행 / 프로젝트 리비전",
                  `${approval.stateRevision} / ${approval.projectRevision}`,
                ],
                ["바이트", String(approval.bytes)],
                ["파일 지문", approval.preconditionDigest],
                ["만료", new Date(approval.expiresAt).toLocaleString()],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              기본 선택은 거부예요. 세션 전체 권한·범위 확대·자동 되돌리기는 없어요. 승인만으로
              통과나 완료가 되지는 않아요.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={submitting || approval.expiresAt <= observedAt}
                onClick={() => resolveApproval("reject")}
              >
                거부
              </Button>
              <Button
                size="sm"
                disabled={submitting || approval.expiresAt <= observedAt}
                onClick={() => resolveApproval("approve")}
              >
                이번만 승인
              </Button>
            </div>
          </section>
        )}
      </SettingsGroup>
    </SettingsSection>
  );
}
