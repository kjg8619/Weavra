import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentWeavraControlCommand,
  createEnvironmentWeavraControlStateAtoms,
  plannerCancelRequest,
  plannerDraftUnchanged,
  plannerElapsedMs,
  plannerLoadedDraft,
  plannerReadRequest,
  plannerRequestDigest,
  plannerStartRequest,
  plannerStatusOf,
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

const observations = createEnvironmentWeavraControlStateAtoms(connectionAtomRuntime);
const command = createEnvironmentWeavraControlCommand(connectionAtomRuntime);
const decodeMutation = Schema.decodeUnknownSync(WeavraControlMutation, {
  onExcessProperty: "error",
});
type CommandState = {
  status: "idle" | "submitting" | "accepted" | "rejected" | "transport-error";
  message: string;
};
const idle: CommandState = {
  status: "idle",
  message: "Commands request Runtime actions. Only canonical snapshots establish outcomes.",
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
  if (rows.length < 2 || rows.length > 8) return "A COMPLEX task plan needs 2–8 tasks.";
  if (criteria < 1 || criteria > 16)
    return "Enter 1–16 parent acceptance criteria for the task plan, one per line.";
  for (const [index, row] of rows.entries()) {
    if (row.criterionIndexes.length === 0)
      return `Task ${index + 1} does not map any acceptance criterion.`;
    const missing = row.criterionIndexes.find((criterion) => criterion > criteria);
    if (missing !== undefined)
      return `Task ${index + 1} maps acceptance criterion ${missing}, but only ${criteria} are entered.`;
  }
  for (let criterion = 1; criterion <= criteria; criterion++) {
    if (!rows.some((row) => row.criterionIndexes.includes(criterion)))
      return `Acceptance criterion ${criterion} is not mapped to any task.`;
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
    "No usable planning model, profile or credential is configured. There is no fallback model.",
  CONTEXT_TOO_LARGE: "The planning context would exceed 196,608 bytes. No model was called.",
  TIMEOUT: "Planning did not finish within the worker timeout.",
  PROVIDER_ERROR: "The model provider failed or its response ended abnormally.",
  BUDGET_EXHAUSTED:
    "The planning budget of 3 model calls or its token cap ran out before a valid draft.",
  BUDGET_UNKNOWN:
    "The provider reported no usage, so the token cap stopped further planning calls.",
  NO_DRAFT: "The model answered without submitting a draft, even after one reminder.",
  DRAFT_INVALID: "The corrected draft still failed the plan checks.",
  STALE: "The project or its configuration changed while planning, so the draft was discarded.",
};
const plannerRoute = (route: WeavraPlannerStatus["route"]) =>
  route === null
    ? "route not reported"
    : `${route.alias === "plan" ? "models.intents.plan" : "role default"} → ${route.profile} → ${route.provider}/${route.model}`;
const plannerUsage = ({ invocations, reportedTokens }: WeavraPlannerStatus["usage"]) =>
  `${invocations} of 3 model calls · ${reportedTokens ?? "unknown"} reported tokens`;
const plannerSeconds = (elapsedMs: number | null) =>
  elapsedMs === null ? "unknown" : `${Math.floor(elapsedMs / 1000)} s`;
/** Fixed guidance after a Runtime refusal; the refusal code itself is always shown. */
function rejectionHint(
  request: WeavraControlMutation,
  code: WeavraControlErrorCode,
  complexSupported: boolean,
) {
  switch (request.type) {
    case "workflow.prepare":
      return code === "STALE_PROJECT"
        ? " The project changed before a plan was prepared, for example because a stopped owner's Run was just marked INTERRUPTED. Nothing was prepared or retried; prepare again once the refreshed state appears."
        : request.complexDraft
          ? code === "INVALID_REQUEST"
            ? " A task plan is accepted only when Runtime classifies the goal as COMPLEX; discard it for QUICK or STANDARD goals."
            : code === "INVALID_CRITERIA"
              ? " Runtime rejected the task plan's dependencies, criteria coverage, file claims or checks."
              : ""
          : code === "UNSUPPORTED_WORKFLOW" && complexSupported
            ? " If Runtime classified this goal as COMPLEX, add a structured task plan of 2–8 tasks and prepare again."
            : "";
    case "workflow.confirm":
      return code === "PLANNER_BUSY"
        ? " Planning is still running on this Runtime. Cancel planning first; nothing was started."
        : "";
    case "planner.start":
      return code === "UNSUPPORTED_WORKFLOW"
        ? " The Planner drafts only goals that Runtime classifies as COMPLEX, never R3."
        : code === "PLANNER_BUSY"
          ? " Planning or a Run is already in progress on this Runtime."
          : "";
    case "planner.cancel":
      return code === "PLANNER_NOT_FOUND" ? " That planning request is no longer running." : "";
    case "planner.read":
      return code === "PLANNER_NOT_FOUND" || code === "PLANNER_NOT_READY"
        ? " That proposal is no longer available; nothing was loaded."
        : "";
    default:
      return "";
  }
}

export function WeavraControls({
  environmentId,
  projectId,
  workspaceRoot,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  workspaceRoot: string;
}) {
  const observationResult = useAtomValue(
    observations.stateAtom(environmentId, projectId, workspaceRoot),
  );
  const view = Option.getOrUndefined(AsyncResult.value(observationResult));
  const environment = useEnvironment(environmentId);
  const invoke = useAtomCommand(command, { reportFailure: false, reportDefect: false });
  const [goal, setGoal] = useState("");
  const [recipeId, setRecipeId] = useState("");
  const [recipeInputs, setRecipeInputs] = useState("{}");
  const [criteria, setCriteria] = useState("");
  const [complexCriteria, setComplexCriteria] = useState("");
  const [complexRows, setComplexRows] = useState<ComplexDraftRow[]>([]);
  // Planner proposals stay page-session memory: the loaded one and one dismissed locally.
  const [loadedDraft, setLoadedDraft] = useState<PlannerLoadedDraft | null>(null);
  const [dismissedPlanId, setDismissedPlanId] = useState<string | null>(null);
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
  const canPrepareWorkflow = canPrepare || ((foreignActiveRun || staleWriter) && !submitting);
  // V0.8B Planner: it exists only when the Runtime advertises it beside the COMPLEX editor it fills.
  const plannerExposed =
    complexSupported && observation?.capabilities?.plannerContractVersion === 1;
  const planner = plannerExposed ? plannerStatusOf(observation) : null;
  const plannerStatements = lines(complexCriteria);
  const canStartPlanner =
    plannerExposed &&
    canPrepare &&
    goal.trim() !== "" &&
    plannerStatements.length > 0 &&
    planner?.status !== "RUNNING";
  const canCancelPlanner = plannerExposed && fresh && planner?.status === "RUNNING" && !submitting;
  const canLoadPlanner = plannerExposed && canEditDraft && planner?.status === "READY";
  const plannerProposal =
    planner?.status === "READY" && planner.planId !== dismissedPlanId ? planner : null;
  // The Host's request binding, recomputed for what the editor holds now (§6).
  const editorDigest =
    plannerProposal || loadedDraft ? plannerRequestDigest(goal.trim(), plannerStatements) : null;
  const loadedUnchanged = plannerDraftUnchanged(loadedDraft, toComplexDraft(complexRows));
  const loadedCurrent =
    planner && planner.planId === loadedDraft?.planId ? planner.current : loadedDraft?.current;
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
        ? "Waiting for explicit confirmation."
        : "Submitting command to Runtime.",
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
          message: "The Runtime view changed. Review fresh state before submitting again.",
        });
        return;
      }
      const result = await invoke({ environmentId, input: { projectId, request } });
      if (!mounted.current) return;
      if (!AsyncResult.isSuccess(result)) {
        setCommandState({
          status: "transport-error",
          message:
            "Transport error: command outcome is unknown. Wait for fresh Runtime state. No automatic retry was sent.",
        });
        return;
      }
      const response = result.value;
      if (!response.success) {
        const code = response.error.code;
        setCommandState({
          status: "rejected",
          message: `Runtime rejected the command: ${code}.${rejectionHint(request, code, complexSupported)} Review fresh state before trying again.`,
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
            message: "Runtime returned a draft of another planning request. Nothing was loaded.",
          });
          return;
        }
        const rows = latest.current.complexRows;
        if (rows.length > 0 && !plannerDraftUnchanged(loaded, toComplexDraft(rows))) {
          setCommandState({ status: "submitting", message: "Waiting for explicit confirmation." });
          const replace = await requestConfirmDialog(
            `Replace the ${rows.length} task rows in the editor with the Planner proposal of ${loaded.draft.tasks.length} tasks?\nThe current rows are not kept. The proposal is unreviewed: review every task, claim and check before Prepare.`,
          );
          if (!mounted.current) return;
          if (!replace) {
            setCommandState({
              status: "idle",
              message: "Kept the editor's task rows. Nothing was loaded.",
            });
            return;
          }
        }
        editComplexRows(() => toComplexRows(loaded.draft));
        setLoadedDraft(loaded);
        setCommandState({
          status: "accepted",
          message:
            "Planner proposal loaded into the editor. Review every task, claim and check, then Prepare. Nothing was prepared or started.",
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
            "Plan prepared by Runtime. No workflow has started; review and explicitly confirm this preview.",
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
            "Recorded browser candidates and evidence loaded from Runtime. Historical captures are not a live page check.",
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
            "Browser registration preview prepared by Runtime. Review the expectation and explicitly confirm; nothing is registered yet.",
        });
      } else if (response.data.kind === "browser-registered") {
        setBrowserPreview(null);
        setPreparedBrowserDraft(null);
        setBrowserInspection(null);
        setCommandState({
          status: "accepted",
          message:
            "Runtime acknowledged registration. Refresh browser evidence to read the registry. Registration is not PASS or COMPLETE; each verification requires a new isolated capture.",
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
            "Fact candidate prepared by Runtime. Review source and statement; nothing is durable until you confirm.",
        });
      } else if (response.data.kind === "fact-confirmed") {
        setFactPreview(null);
        setPreparedFactDraft(null);
        setCommandState({
          status: "accepted",
          message:
            "Review recorded. Waiting for canonical fact state; this acknowledgement is not VALID, PASS or COMPLETE.",
        });
      } else {
        setCommandState({
          status: "accepted",
          message:
            request.type === "workflow.cancel"
              ? "Cancellation accepted. Wait for canonical terminal state and writer release. Partial changes remain."
              : request.type === "approval.resolve"
                ? "Decision accepted for the pending request. Runtime still owns approval validation, consumption and completion."
                : request.type === "planner.start"
                  ? "Planning started. Runtime drafts a candidate task plan in the background; nothing runs, and nothing enters the editor until you load it."
                  : request.type === "planner.cancel"
                    ? "Planning cancellation accepted. Wait for Runtime to report CANCELLED."
                    : "Start accepted. Waiting for canonical Run state; this acknowledgement does not establish success.",
        });
      }
    } catch {
      if (mounted.current)
        setCommandState({
          status: "transport-error",
          message:
            "Transport error: command outcome is unknown. Observe fresh Runtime state; do not assume the action failed.",
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
        ? "This Runtime does not advertise COMPLEX task plans (NOT EXPOSED). Discard the task plan to prepare a QUICK or STANDARD workflow."
        : recipeId
          ? "Reviewed recipes are STANDARD-only and are never sent with a COMPLEX task plan. Clear the recipe or discard the task plan."
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
          ? "Invalid task plan. Each task needs a nonblank title (up to 80 characters) and goal (up to 300), 1–16 unique check IDs (letters, digits, '.', '_', ':' or '-') and at most 16 exact project-relative file claims without globs, '.', '..', backslashes or a leading or trailing '/'. The whole plan must stay within 12,288 bytes."
          : "Invalid goal, recipe JSON or acceptance criteria. Use at most 16 nonempty criteria of 500 characters each.",
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
      `Start this exact ${preview.workflow} / ${preview.risk} / ${preview.executionMode} plan for ${workspaceRoot}?\nGoal: ${preview.goal}${
        plan
          ? `\n${
              plan.schemaVersion === 2 && plan.limits.maxParallel > 1
                ? `Tasks under one Run, in plan order; up to ${plan.limits.maxParallel} whose dependencies are complete are implemented at once, then checked and reviewed one at a time`
                : "Tasks, in this order under one Run"
            }: ${plan.tasks.map((task) => `${task.id} ${task.title}`).join("; ")}\nPlan digest: ${plan.complexPlanDigest}\nThe plan cannot be edited after confirmation. Completing every task does not complete the Run.`
          : ""
      }\nPlan confirmation is not R3 approval. No automatic commit, rollback or cleanup.`,
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
      `Cancel Run ${run.runId}?\nRuntime must stop active workers and checks before releasing its writer. Partial workspace changes remain. No automatic rollback or cleanup.`,
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
        ? `Approve ONE deletion of ${approval.path}?\nRun: ${approval.runId}\nApproval: ${approval.approvalId}\nFingerprint: ${approval.preconditionDigest}\nNo automatic rollback. This does not approve any other action or establish completion.`
        : undefined,
    );
  };
  const startPlanner = () => {
    const fields = common();
    if (!fields || !canStartPlanner) return;
    try {
      void submit(plannerStartRequest(fields, goal.trim(), plannerStatements));
    } catch {
      setCommandState({
        status: "rejected",
        message:
          "Invalid goal or acceptance criteria for the Planner. Use a goal of up to 2,048 characters and 1–16 criteria of up to 500 characters each.",
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
          "Use a check name of 1–64 letters, digits, dots, hyphens or underscores, starting with a letter or digit, and a bounded supported expectation.",
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
      `Register this exact browser check for ${workspaceRoot}?\nCheck: ${browserPreview.check.checkId}\nDocument: ${browserPreview.check.documentIdentity}\nTarget: ${browserPreview.check.target.selector}\nAssertion: ${JSON.stringify(browserPreview.check.assertion)}\nRegistration digest: ${browserPreview.check.registrationDigest}\nThis records an expectation, not PASS. Runtime must capture a new isolated browser document for every SELF_CHECK and TEST. Browser failures never trigger automatic repair.`,
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
        message:
          "Use a project-relative source (up to 256 characters) and a short statement (up to 500 characters).",
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
      `Record this reviewed advisory fact for ${workspaceRoot}?\nSource: ${factPreview.sourceRef}\nDigest: ${factPreview.sourceDigest}\nStatement: ${factPreview.statement}\nConfirm that this statement is supported by the source and contains no secrets, raw reasoning, transcript or tool output. This is not Policy, Approval, verification or completion.`,
    );
  };
  return (
    <SettingsSection id="weavra-controls" title="Weavra · Workflow control">
      <SettingsGroup divided={false} className="space-y-5 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Runtime-owned actions</h3>
          <Badge variant={fresh ? "info" : "outline"}>
            {fresh ? "CONTROL CONNECTED" : "CONTROL UNAVAILABLE"}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {view?.support === "unsupported"
            ? "This environment does not advertise workflow control. Enable T3_WEAVRA_CONTROL=1 on the trusted server to opt in. Read-only observation remains available."
            : "Control requires orchestration:operate access and a fresh canonical snapshot. Risk, scope, checks, Task Contract, Policy, approval consumption and completion remain Runtime/Kernel-owned."}
        </p>
        {!fresh && (
          <p className="text-xs text-muted-foreground">
            Controls are disabled while disconnected, unsupported or stale. No action is queued for
            reconnect.{observation?.errorCode ? ` Connection error: ${observation.errorCode}.` : ""}
          </p>
        )}
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
            {commandState.status}
          </Badge>
          <p>{commandState.message}</p>
        </div>
        {state?.startFailure && (
          <p className="text-sm text-destructive">
            Runtime preflight did not create a Run. Inspect the trusted configuration and workspace;
            no automatic retry was performed.
          </p>
        )}
        {run && (
          <div className="space-y-2 rounded-md border border-border p-3 text-xs">
            <p>
              Canonical Run: <code className="break-all">{run.runId}</code>
            </p>
            <p>
              Durable status: <strong>{run.status}</strong> · Run revision:{" "}
              {state?.stateRevision ?? "UNKNOWN"} · Project revision:{" "}
              {state?.projectRevision ?? "UNKNOWN"}
            </p>
            <p>
              Owner operation:{" "}
              {state?.busy
                ? state.cancelling
                  ? "cancellation requested; cleanup pending"
                  : "active"
                : "idle"}{" "}
              · Writer present: {String(state?.snapshot.status.writerPresent ?? "UNKNOWN")}
            </p>
            <p>Partial workspace changes are never rolled back automatically.</p>
            {canCancel && (
              <Button size="sm" variant="outline" onClick={cancel}>
                Cancel workflow
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
              COMPLEX task detail is not exposed by this Runtime. The canonical Run status above
              remains the only outcome.
            </p>
          )
        )}
        {foreignActiveRun && (
          <p
            aria-label="Another owner holds this project"
            className="text-xs text-muted-foreground"
          >
            Another Runtime owner holds this project's active Run. If that owner has stopped,
            preparing a workflow marks its Run INTERRUPTED; nothing resumes and partial workspace
            changes remain. If the owner is still running or cannot be proven stopped, the Runtime
            refuses.
          </p>
        )}
        {staleWriter && (
          <p
            aria-label="Writer lock after the latest Run"
            className="text-xs text-muted-foreground"
          >
            A writer lock is still present although the latest Run ended {run?.status}. If its owner
            has stopped, preparing a workflow lets the Runtime release the lock; when that changes
            the project, prepare returns STALE_PROJECT, so prepare again once the refreshed state
            appears. If the owner is still running or cannot be proven stopped, the Runtime refuses
            with WRITER_PRESENT. Nothing resumes, and partial workspace changes remain.
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
            <span>Workflow goal</span>
            <Textarea
              aria-label="Workflow goal"
              maxLength={2048}
              value={goal}
              onChange={(event) => {
                invalidateDraft();
                setGoal(event.target.value);
              }}
              disabled={submitting || !fresh || !!state?.busy}
              placeholder="Describe a supported task for this checkout"
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>Reviewed recipe (optional)</span>
            <select
              aria-label="Reviewed recipe"
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
              <option value="">No recipe</option>
              {observation?.capabilities?.recipes.map((recipe) => (
                <option key={recipe.id} value={recipe.id}>
                  {recipe.title} · v{recipe.version}
                </option>
              ))}
            </select>
          </label>
          {recipeId && (
            <label className="block space-y-1 text-sm">
              <span>Recipe inputs (JSON data only)</span>
              <Textarea
                aria-label="Recipe inputs"
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
              aria-label="COMPLEX task plan"
              className="space-y-3 rounded-md border border-border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="text-sm font-medium">Structured task plan · COMPLEX (optional)</h4>
                <Badge variant={complexSupported ? "outline" : "warning"}>
                  {complexSupported ? `RUNTIME CONTRACT v${complexVersion}` : "NOT EXPOSED"}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">
                Only for goals Runtime classifies as COMPLEX.{" "}
                {complexVersion === 2
                  ? "Tasks whose dependencies are complete may be implemented at the same time, up to the Runtime's configured limit; checks and reviews still run one task at a time in plan order. Add a dependency to force an order."
                  : "Tasks run one at a time, in order, under one Runtime-owned Run."}{" "}
                Runtime assigns task IDs and validates dependencies, criteria coverage, exact file
                claims and registered checks. The plan cannot be edited after confirmation.
              </p>
              {(complexRows.length > 0 || plannerExposed) && (
                <label className="block space-y-1 text-sm">
                  <span>Parent acceptance criteria · one per line (1–16)</span>
                  <Textarea
                    aria-label="COMPLEX acceptance criteria"
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
                  aria-label="Loaded Planner proposal"
                  className="space-y-1 rounded-md border border-warning/50 p-3 text-xs"
                >
                  <p className="font-medium">Review every task, claim and check before Prepare.</p>
                  <p className="text-muted-foreground">
                    These rows are the unedited Planner proposal. Prepare re-validates them, and
                    nothing runs until you confirm the Runtime preview.
                  </p>
                  {loadedCurrent === false && (
                    <p>Not current: the project or its configuration changed after planning.</p>
                  )}
                  {editorDigest !== loadedDraft.requestDigest && (
                    <p>Planned for a different goal or criteria than the editor now holds.</p>
                  )}
                </div>
              )}
              {complexRows.map((row, index) => {
                const task = index + 1;
                const editable = canEditDraft && complexSupported;
                return (
                  <fieldset
                    key={task}
                    aria-label={`Task ${task}`}
                    className="space-y-2 rounded-md border border-border p-3 text-sm"
                  >
                    <legend className="px-1 text-xs font-medium">Task {task}</legend>
                    <input
                      aria-label={`Task ${task} title`}
                      value={row.title}
                      maxLength={80}
                      disabled={!editable}
                      placeholder="Short title"
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      onChange={(event) => {
                        const title = event.target.value;
                        editComplexRow(index, (current) => ({ ...current, title }));
                      }}
                    />
                    <Textarea
                      aria-label={`Task ${task} goal`}
                      value={row.goal}
                      maxLength={300}
                      disabled={!editable}
                      placeholder="Bounded contribution to the parent goal"
                      onChange={(event) => {
                        const taskGoal = event.target.value;
                        editComplexRow(index, (current) => ({ ...current, goal: taskGoal }));
                      }}
                    />
                    {index > 0 && (
                      <div className="flex flex-wrap gap-3 text-xs">
                        <span className="text-muted-foreground">Depends on</span>
                        {Array.from({ length: index }, (_, earlier) => earlier + 1).map(
                          (dependency) => (
                            <label key={dependency} className="flex items-center gap-1">
                              <input
                                type="checkbox"
                                aria-label={`Task ${task} depends on task ${dependency}`}
                                checked={row.dependsOnIndexes.includes(dependency)}
                                disabled={!editable}
                                onChange={() =>
                                  editComplexRow(index, (current) => ({
                                    ...current,
                                    dependsOnIndexes: toggled(current.dependsOnIndexes, dependency),
                                  }))
                                }
                              />
                              Task {dependency}
                            </label>
                          ),
                        )}
                      </div>
                    )}
                    <div className="space-y-1 text-xs">
                      <span className="text-muted-foreground">
                        Acceptance criteria it contributes to
                      </span>
                      {lines(complexCriteria).map((statement, position) => (
                        // A criterion's number is its position; the draft sends 1-based indexes.
                        // oxlint-disable-next-line react/no-array-index-key
                        <label key={position} className="flex items-start gap-1 break-words">
                          <input
                            type="checkbox"
                            aria-label={`Task ${task} maps criterion ${position + 1}`}
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
                        Exact file claims · responsibility, not permission
                      </span>
                      {row.ownership.map((claim, position) => (
                        // Claims are positional rows of controlled inputs and are never reordered.
                        // oxlint-disable-next-line react/no-array-index-key
                        <div key={position} className="flex flex-wrap items-center gap-2">
                          <select
                            aria-label={`Task ${task} claim ${position + 1} operation`}
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
                            <option value="modify">modify</option>
                            <option value="create">create</option>
                            <option value="delete">delete</option>
                          </select>
                          <input
                            aria-label={`Task ${task} claim ${position + 1} path`}
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
                            aria-label={`Remove task ${task} claim ${position + 1}`}
                            disabled={!editable}
                            onClick={() =>
                              editComplexRow(index, (current) => ({
                                ...current,
                                ownership: current.ownership.filter((_, at) => at !== position),
                              }))
                            }
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                      <Button
                        size="sm"
                        variant="outline"
                        aria-label={`Add task ${task} file claim`}
                        disabled={!editable || row.ownership.length >= 16}
                        onClick={() =>
                          editComplexRow(index, (current) => ({
                            ...current,
                            ownership: [...current.ownership, { path: "", operation: "modify" }],
                          }))
                        }
                      >
                        Add file claim
                      </Button>
                    </div>
                    <input
                      aria-label={`Task ${task} check IDs`}
                      value={row.checkIds}
                      maxLength={2200}
                      disabled={!editable}
                      placeholder="Registered check IDs, separated by spaces"
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
                  Add task
                </Button>
                {complexRows.length > 0 && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canEditDraft || !complexSupported}
                      onClick={() => editComplexRows((rows) => rows.slice(0, -1))}
                    >
                      Remove last task
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!canEditDraft}
                      onClick={() => {
                        editComplexRows(() => []);
                        setComplexCriteria("");
                      }}
                    >
                      Discard task plan
                    </Button>
                  </>
                )}
              </div>
              {plannerExposed && (
                <section aria-label="Planner" className="space-y-3 border-t border-border pt-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="text-sm font-medium">Planner · proposed task rows</h5>
                    <Badge variant="outline">CANDIDATE ONLY</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Runtime asks the configured planning model, with at most 3 calls, to propose
                    task rows for this goal and these criteria from a bounded context of file names,
                    project instructions and reviewed facts. A proposal is never loaded, prepared or
                    started automatically.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canStartPlanner}
                    onClick={startPlanner}
                  >
                    Draft with Planner
                  </Button>
                  {planner?.status === "RUNNING" && (
                    <div
                      aria-label="Planner running"
                      className="space-y-2 rounded-md border border-border p-3 text-xs"
                    >
                      <p>
                        Planning · elapsed{" "}
                        {plannerSeconds(plannerElapsedMs(planner, observation?.observedAt ?? null))}{" "}
                        · {plannerRoute(planner.route)} · {plannerUsage(planner.usage)}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canCancelPlanner}
                        onClick={cancelPlanner}
                      >
                        Cancel planning
                      </Button>
                    </div>
                  )}
                  {plannerProposal && (
                    <section
                      aria-label="Planner proposal"
                      className="space-y-2 rounded-md border border-warning/50 p-3 text-xs"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h5 className="text-sm font-medium">Planner proposal — unreviewed</h5>
                        <div className="flex flex-wrap gap-2">
                          {!plannerProposal.current && <Badge variant="warning">NOT CURRENT</Badge>}
                          {editorDigest !== plannerProposal.requestDigest && (
                            <Badge variant="warning">OTHER GOAL OR CRITERIA</Badge>
                          )}
                        </div>
                      </div>
                      <p>
                        {plannerProposal.taskCount} tasks · {plannerRoute(plannerProposal.route)} ·{" "}
                        {plannerUsage(plannerProposal.usage)}
                      </p>
                      {!plannerProposal.current && (
                        <p>
                          The project or its configuration changed after planning. Use it only as a
                          starting point; Prepare re-validates everything.
                        </p>
                      )}
                      {editorDigest !== plannerProposal.requestDigest && (
                        <p>
                          This proposal is for a different goal or criteria than the editor holds.
                        </p>
                      )}
                      <p className="text-muted-foreground">
                        Loading replaces only the editor's task rows. Nothing is prepared, confirmed
                        or run until you do it yourself. Drafting again replaces this proposal.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" disabled={!canLoadPlanner} onClick={loadPlannerProposal}>
                          Load into editor
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setDismissedPlanId(plannerProposal.planId)}
                        >
                          Discard
                        </Button>
                      </div>
                    </section>
                  )}
                  {planner?.status === "READY" && planner.planId === dismissedPlanId && (
                    <p className="text-xs text-muted-foreground">
                      Proposal discarded in this App; Runtime keeps it until planning starts again
                      or a Run is confirmed.{" "}
                      <Button size="sm" variant="outline" onClick={() => setDismissedPlanId(null)}>
                        Show proposal
                      </Button>
                    </p>
                  )}
                  {planner?.status === "FAILED" && planner.failureCode && (
                    <p aria-label="Planner failed" className="text-xs">
                      Planner failed: <strong>{planner.failureCode}</strong> —{" "}
                      {plannerFailureText[planner.failureCode]} Nothing was drafted; draft again
                      when ready.
                    </p>
                  )}
                  {planner?.status === "CANCELLED" && (
                    <p className="text-xs">Planning cancelled. Nothing was drafted.</p>
                  )}
                </section>
              )}
            </section>
          )}
          <Button size="sm" type="submit" disabled={!canPrepareWorkflow || !goal.trim()}>
            {preview ? "Refresh Plan Preview" : "Prepare workflow"}
          </Button>
        </form>
        {preview && (
          <section
            aria-label="Runtime Plan Preview"
            className="space-y-4 rounded-md border border-border p-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-medium">Runtime Plan Preview</h4>
              <Badge variant={previewCurrent ? "info" : "warning"}>
                {previewCurrent ? "CURRENT PREVIEW" : "REVIEW / REFRESH REQUIRED"}
              </Badge>
            </div>
            <p className="text-sm">{preview.goal}</p>
            <dl className="grid gap-3 text-xs sm:grid-cols-2">
              {[
                ["Workflow", preview.workflow],
                ["Risk", preview.risk],
                ["Execution mode", preview.executionMode],
                ["Allowed scope", preview.allowedPaths.join(", ") || "None"],
                [
                  "Recipe",
                  preview.recipe ? `${preview.recipe.id}@${preview.recipe.version}` : "None",
                ],
                ["Expires", new Date(preview.expiresAt).toLocaleString()],
                [
                  "Configuration",
                  Object.entries(preview.configuration)
                    .map(([key, value]) => `${key}: ${String(value)}`)
                    .join(" · "),
                ],
                ["Task Contract digest", preview.taskContractDigest],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="mt-1 break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="text-xs">
              <h5 className="font-medium">Runtime-registered checks</h5>
              <ul className="mt-1 space-y-1">
                {preview.checks.map((check) => (
                  <li key={check.id}>
                    {check.id} · {check.kind} · {check.required ? "required" : "optional"}
                  </li>
                ))}
              </ul>
            </div>
            {preview.complexPlan ? (
              <p className="text-xs text-muted-foreground">
                Parent acceptance criteria come from the task plan. Edit the task plan and prepare
                again to change them.
              </p>
            ) : (
              <label className="block space-y-1 text-sm">
                <span>Acceptance criteria · one line per criterion</span>
                <Textarea
                  aria-label="Acceptance criteria"
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
                  {preview.complexPlan ? ` · ${criterion.statement}` : ""} · checks:{" "}
                  {criterion.checkIds.join(", ") || "none"} · independent review:{" "}
                  {criterion.reviewRequired ? "required" : "not required"}
                </li>
              ))}
            </ul>
            {preview.complexPlan && (
              <ComplexPlanView plan={preview.complexPlan} criteria={preview.acceptanceCriteria} />
            )}
            <p className="text-xs text-muted-foreground">
              Editing criteria requires a fresh Runtime preview. T3 never assigns criterion IDs,
              verification mappings or the frozen contract. Confirmation is not an approval token.
            </p>
            <Button
              size="sm"
              disabled={!previewCurrent || submitting || !!state?.busy}
              onClick={confirm}
            >
              Confirm and start
            </Button>
          </section>
        )}
        <section
          aria-label="Reviewed Project Facts"
          className="space-y-4 border-t border-border pt-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Reviewed Project Facts</h3>
            <Badge variant="outline">ADVISORY ONLY</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Review a short statement against one allowed local source. No automatic extraction or
            provider calls. Never include secrets, raw reasoning, transcripts or tool output. Facts
            cannot grant permissions, replace checks or review, or complete a Run. Kernel remains
            the completion authority.
          </p>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              prepareFact();
            }}
          >
            <label className="block space-y-1 text-sm">
              <span>Fact source · project-relative file</span>
              <Textarea
                aria-label="Fact source"
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
              <span>Fact statement</span>
              <Textarea
                aria-label="Fact statement"
                maxLength={500}
                value={factStatement}
                disabled={!canPrepare}
                onChange={(event) => {
                  setFactStatement(event.target.value);
                  setFactPreview(null);
                  setPreparedFactDraft(null);
                }}
                placeholder="One concise, source-supported statement"
              />
            </label>
            <Button
              size="sm"
              type="submit"
              disabled={!canPrepare || !factSource.trim() || !factStatement.trim()}
            >
              Prepare fact
            </Button>
          </form>
          {factPreview && (
            <section
              aria-label="Runtime Fact Preview"
              className="space-y-3 rounded-md border border-border p-3"
            >
              <Badge variant={factPreviewCurrent ? "info" : "warning"}>
                {factPreviewCurrent
                  ? "REVIEW REQUIRED · NOT SAVED"
                  : "PREVIEW CHANGED · PREPARE AGAIN"}
              </Badge>
              <p className="text-sm">{factPreview.statement}</p>
              <p className="break-all text-xs">Source: {factPreview.sourceRef}</p>
              <p className="break-all font-mono text-xs">Digest: {factPreview.sourceDigest}</p>
              <Button size="sm" disabled={!canPrepare || !factPreviewCurrent} onClick={confirmFact}>
                Confirm reviewed fact
              </Button>
            </section>
          )}
          <div aria-label="Canonical Project Facts" className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Runtime checks source identity and digest at each observation and worker use.
              Re-reviewing the same source replaces its review, preserving the fact ID. Up to 16
              sources.
            </p>
            {!fresh || state?.projectFacts.status !== "available" ? (
              <p className="text-xs text-muted-foreground">
                Facts unavailable or observation stale. No current VALID fact is established.
              </p>
            ) : state.projectFacts.entries.length === 0 ? (
              <p className="text-xs text-muted-foreground">No reviewed facts for this checkout.</p>
            ) : (
              state.projectFacts.entries.map((fact) => (
                <article
                  key={fact.id}
                  className="space-y-2 rounded-md border border-border bg-muted/20 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all text-xs">{fact.sourceRef}</code>
                    <Badge variant={fact.status === "VALID" ? "info" : "warning"}>
                      {fact.status}
                    </Badge>
                  </div>
                  <p className="text-sm">
                    {fact.status === "VALID"
                      ? fact.statement
                      : "Source changed or cannot be verified. Statement withheld; not injected as current context. Review again explicitly."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Reviewed: {new Date(fact.reviewedAt).toLocaleString()} · Status at last Runtime
                    observation
                  </p>
                  <p className="break-all font-mono text-xs">ID: {fact.id}</p>
                  <p className="break-all font-mono text-xs">Digest: {fact.sourceDigest}</p>
                </article>
              ))
            )}
          </div>
        </section>
        <section
          aria-label="Browser evidence and registration"
          className="space-y-4 border-t border-border pt-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-medium">Browser checks</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Observe → review expectation → register → independently verify
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!fresh || submitting}
              onClick={inspectBrowser}
            >
              Refresh browser evidence
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Local static documents only. Candidates are recorded observations, not checks or proof
            of current page state. Runtime owns registration, fresh private HOME/profile/CDP-pipe
            captures and Kernel completion. Browser isolation is not an OS sandbox. No personal
            browser session, scripts or interactive actions are accepted.
          </p>
          {browserInspection && (
            <>
              <Badge variant={browserInspectionCurrent ? "outline" : "warning"}>
                {browserInspectionCurrent
                  ? "RECORDED RUNTIME INSPECTION"
                  : "STALE INSPECTION · REFRESH REQUIRED"}
              </Badge>
              {browserInspection.data.candidates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No saved target candidates. Use the Runtime browser observation command with
                  explicit candidate saving.
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
                      <Badge variant="warning">CANDIDATE_ONLY</Badge>
                    </div>
                    <dl className="grid gap-2 text-xs sm:grid-cols-2">
                      {[
                        ["Origin", item.origin],
                        ["Document", item.documentIdentity],
                        ["Captured", new Date(item.capturedAt).toLocaleString()],
                        [
                          "Observed value",
                          item.observation.exists
                            ? (item.observation.value ?? "(attribute absent)")
                            : "(element absent)",
                        ],
                        ["Candidate", item.candidateId],
                        ["Candidate digest", item.candidateDigest],
                        ["Document revision", item.pageRevision],
                        ["Reader revision", item.source.readerRevision],
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
                      {candidateId === item.candidateId
                        ? "Selected for review"
                        : "Review this candidate"}
                    </Button>
                  </article>
                ))}
              </div>
              {browserInspection.data.omittedCandidates > 0 && (
                <p className="text-xs text-muted-foreground">
                  {browserInspection.data.omittedCandidates} additional candidates omitted from this
                  bounded view.
                </p>
              )}
              {candidate && (
                <form
                  aria-label="Browser expectation editor"
                  className="space-y-3 rounded-md border border-border p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    prepareBrowser();
                  }}
                >
                  <p className="text-xs text-muted-foreground">
                    The observed value is only a starting point. Review and edit the expected
                    behavior before requesting a Runtime preview.
                  </p>
                  <label className="block space-y-1 text-sm">
                    <span>Browser check name</span>
                    <input
                      aria-label="Browser check name"
                      value={browserCheckId}
                      maxLength={64}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      disabled={!canPrepare || !browserInspectionCurrent}
                      onChange={(event) => setBrowserCheckId(event.target.value)}
                      placeholder="status-ready"
                    />
                  </label>
                  <label className="block space-y-1 text-sm">
                    <span>Browser assertion</span>
                    <select
                      aria-label="Browser assertion"
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
                      <span>Expected value · review and edit</span>
                      <Textarea
                        aria-label="Browser expected value"
                        value={expectedValue}
                        maxLength={1024}
                        disabled={!canPrepare || !browserInspectionCurrent}
                        onChange={(event) => setExpectedValue(event.target.value)}
                      />
                    </label>
                  )}
                  <p className="text-xs text-muted-foreground">
                    Fixed target: {candidate.observation.target.selector} · fresh capture every
                    verification · maximum evidence age 15 seconds.
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
                    Prepare browser registration
                  </Button>
                </form>
              )}
              {browserPreview && (
                <section
                  aria-label="Runtime browser registration preview"
                  className="space-y-3 rounded-md border border-border p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h4 className="text-sm font-medium">Runtime browser registration preview</h4>
                    <Badge variant={browserPreviewCurrent ? "info" : "warning"}>
                      {browserPreviewCurrent
                        ? "REVIEW BEFORE REGISTERING"
                        : "REFRESH PREVIEW REQUIRED"}
                    </Badge>
                  </div>
                  <dl className="grid gap-2 text-xs sm:grid-cols-2">
                    {[
                      ["Check", browserPreview.check.checkId],
                      ["Document", browserPreview.check.documentIdentity],
                      ["Target", JSON.stringify(browserPreview.check.target)],
                      ["Expectation", JSON.stringify(browserPreview.check.assertion)],
                      ["Registration digest", browserPreview.check.registrationDigest],
                      ["Preview digest", browserPreview.previewDigest],
                      ["Expires", new Date(browserPreview.expiresAt).toLocaleString()],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd className="mt-1 whitespace-pre-wrap break-all">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    Confirming registers only this expectation. It does not capture the page,
                    produce PASS, start a workflow or authorize automatic repair.
                  </p>
                  <Button
                    size="sm"
                    disabled={!canPrepare || !browserPreviewCurrent}
                    onClick={confirmBrowser}
                  >
                    Confirm browser registration
                  </Button>
                </section>
              )}
              <div className="space-y-2 text-xs">
                <h4 className="font-medium">Runtime registry · recorded view</h4>
                {browserInspection.data.checks.length === 0 && (
                  <p className="text-muted-foreground">
                    No registered browser checks in this view.
                  </p>
                )}
                {browserInspection.data.checks.map(({ check, required }) => (
                  <div
                    key={check.checkId}
                    className="space-y-1 rounded-md border border-border p-3"
                  >
                    <p>
                      {check.checkId} · {required ? "required" : "optional"} ·{" "}
                      <strong>REGISTERED, NOT VERIFIED</strong>
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
                    {browserInspection.data.omittedChecks} additional checks omitted.
                  </p>
                )}
              </div>
              <div className="space-y-2 text-xs">
                <h4 className="font-medium">Latest durable Run · recorded browser evidence</h4>
                <p className="text-muted-foreground">
                  A recorded PASS applies only to its capture, Run, step and revision. It is not a
                  live page status. Missing or unavailable evidence never falls back to an older
                  passing Run.
                </p>
                {browserInspection.data.evidence.length === 0 && (
                  <p className="text-muted-foreground">
                    No browser verification evidence in the latest Run.
                  </p>
                )}
                {browserInspection.data.evidence.map((entry) => (
                  <div
                    key={`${entry.runId}:${entry.checkId}:${entry.revision}:${entry.step?.stepId}:${entry.step?.attempt ?? "unknown"}`}
                    className="space-y-1 rounded-md border border-border p-3"
                  >
                    <p>
                      {entry.checkId} · {entry.step?.stepId ?? "unknown step"} ·{" "}
                      <strong>{entry.status}</strong>
                    </p>
                    <p className="break-all">
                      Run {entry.runId} · revision {entry.revision}
                    </p>
                    {entry.browser ? (
                      <>
                        <p>
                          Captured {new Date(entry.browser.capturedAt).toLocaleString()} · cleanup{" "}
                          {entry.browser.cleanup}
                        </p>
                        <p className="break-all">{entry.browser.documentIdentity}</p>
                        <p className="break-all text-muted-foreground">
                          Registration {entry.browser.registrationDigest}
                        </p>
                        <p className="break-all text-muted-foreground">
                          Document {entry.browser.documentDigest}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground">
                        No accepted browser capture metadata for this result.
                      </p>
                    )}
                  </div>
                ))}
                {browserInspection.data.omittedEvidence > 0 && (
                  <p className="text-muted-foreground">
                    {browserInspection.data.omittedEvidence} additional browser results omitted.
                  </p>
                )}
              </div>
            </>
          )}
        </section>
        {approval && (
          <section
            aria-label="Pending R3 approval"
            className="space-y-3 rounded-md border border-warning/50 p-4 text-sm"
          >
            <h4 className="font-medium">Pending R3 approval · one file deletion</h4>
            <p>{approval.explanation}</p>
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              {[
                ["Target", approval.path],
                ["Run", approval.runId],
                ["Approval", approval.approvalId],
                ["Operation / role", `${approval.operation} / ${approval.role}`],
                ["Step", `${approval.step.stepId}@${approval.step.attempt}`],
                [
                  "Run / project revision",
                  `${approval.stateRevision} / ${approval.projectRevision}`,
                ],
                ["Bytes", String(approval.bytes)],
                ["Fingerprint", approval.preconditionDigest],
                ["Expires", new Date(approval.expiresAt).toLocaleString()],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="break-all">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-muted-foreground">
              Deny is the default. No session-wide grant, scope expansion or automatic rollback.
              Approval alone never means PASS or COMPLETE.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={submitting || approval.expiresAt <= observedAt}
                onClick={() => resolveApproval("reject")}
              >
                Reject
              </Button>
              <Button
                size="sm"
                disabled={submitting || approval.expiresAt <= observedAt}
                onClick={() => resolveApproval("approve")}
              >
                Approve once
              </Button>
            </div>
          </section>
        )}
      </SettingsGroup>
    </SettingsSection>
  );
}
