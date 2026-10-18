import {
  createEnvironmentCommand,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { requestWeavraTask } from "@t3tools/client-runtime/state/weavraTask";
import {
  WS_METHODS,
  type WeavraProjectCheckPolicy,
  type WeavraProjectSetupInput,
  type WeavraProjectSetupResult,
  type WeavraTaskScopeInput,
} from "@t3tools/contracts";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  parseProjectSetupFields,
  patchProjectSetupFields,
  type ProjectSetupCheck,
  type ProjectSetupFields,
} from "./projectSetupFields";

const setupCommand = createEnvironmentCommand(connectionAtomRuntime, {
  label: "chat:weavra-project-setup",
  execute: (input: WeavraProjectSetupInput) =>
    requestWeavraTask(WS_METHODS.weavraProjectSetup, input),
});

const inputClass = "w-full min-w-0 rounded-md border border-input bg-background px-3 py-2";

type TrialCheckResult = Extract<WeavraProjectSetupResult["result"], { kind: "trial-check" }>;
type TrialCheckRunner = {
  results: Readonly<Record<string, TrialCheckResult>>;
  run: (checkId: string) => void;
};

const policyReasons: Record<string, string> = {
  EXECUTABLE_UNAVAILABLE: "실행 파일을 찾을 수 없어요",
  SHELL_COMMAND: "셸을 거쳐 실행할 수 없어요",
  INLINE_COMMAND: "인라인 명령은 실행할 수 없어요",
  CHECK_WORKDIR_UNAVAILABLE: "검사 작업 경로를 쓸 수 없어요",
};
const policyReason = (reason: string) =>
  policyReasons[reason] ? `${policyReasons[reason]} (${reason})` : reason;
const draftNote = (note: string) =>
  note === "NO_CHECK_CANDIDATES"
    ? "자동으로 찾은 검사 후보가 없어요. 필요한 검사를 직접 추가해 주세요."
    : `제외된 검사 후보: ${note}`;

export function WeavraProjectSetup(props: {
  scope: WeavraTaskScopeInput;
  available: boolean;
  enabled: boolean;
  onSaved: () => void;
  autoPrepare?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const execute = useAtomCommand(setupCommand, { reportFailure: false });
  const id = useId();
  const [open, setOpen] = useState(false);
  const [response, setResponse] = useState<WeavraProjectSetupResult | null>(null);
  const [yaml, setYaml] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [requestBusy, setRequestBusy] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const busy = requestBusy || inspecting;
  const onBusyChange = props.onBusyChange;
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const [error, setError] = useState<string | null>(null);
  const [repositoryNeeded, setRepositoryNeeded] = useState(false);
  const [presets, setPresets] = useState<NonNullable<WeavraProjectSetupResult["presets"]>>([]);
  const [preset, setPreset] = useState("manual");
  const [trials, setTrials] = useState<Record<string, TrialCheckResult>>({});
  const pending = useRef(false);
  const epochKey = JSON.stringify([props.scope, props.enabled]);
  const epoch = useMemo(() => Symbol(epochKey), [epochKey]);
  const current = useRef(epoch);
  useLayoutEffect(() => {
    current.current = epoch;
    return () => {
      current.current = Symbol();
    };
  }, [epoch]);

  const request = async (input: WeavraProjectSetupInput, catalogOnly = false) => {
    if (!props.enabled || pending.current) return;
    pending.current = true;
    setRequestBusy(true);
    setError(null);
    try {
      const result = await execute({ environmentId: props.scope.environmentId, input });
      if (current.current !== epoch) return;
      if (result._tag !== "Success") {
        const failure = squashAtomCommandFailure(result);
        const code =
          typeof failure === "object" && failure !== null && "code" in failure
            ? String(failure.code)
            : "UNAVAILABLE";
        if (code === "TARGET_CHANGED" && props.autoPrepare && input.action === "read") {
          setRepositoryNeeded(true);
        } else {
          setError(
            `${code}: 결과가 불확실해요. 저장 여부를 프로젝트 설정이나 준비 상태 검사로 확인해 주세요. 편집 중인 내용은 보존했어요.`,
          );
        }
        return;
      }
      if (result.value.result.kind === "error") {
        if (result.value.result.code === "STALE_CONFIG") {
          setReviewed(false);
        }
        setError(
          `${result.value.result.code}: ${result.value.result.message} 편집 중인 내용은 보존했어요.`,
        );
        return result.value;
      }
      if (result.value.result.kind === "trial-check") {
        const trial = result.value.result;
        setTrials((current) => ({ ...current, [trial.checkId]: trial }));
        return result.value;
      }
      setRepositoryNeeded(false);
      setPresets(result.value.presets ?? []);
      if (catalogOnly) return result.value;
      setResponse(result.value);
      setTrials({});
      if (result.value.result.kind === "draft" || result.value.result.kind === "read") {
        setYaml(result.value.result.yaml);
        setReviewed(false);
        const balanced = result.value.presets?.find((item) => item.id === "balanced")?.selected;
        setPreset(
          result.value.result.kind === "draft" && balanced
            ? `balanced:${balanced.instanceId}`
            : "manual",
        );
      }
      if (
        result.value.result.kind === "saved" ||
        result.value.result.kind === "doctor" ||
        result.value.result.kind === "initialized"
      ) {
        props.onSaved();
      }
      return result.value;
    } finally {
      pending.current = false;
      setRequestBusy(false);
    }
  };

  const start = async (showEditor = true) => {
    if (pending.current || inspecting) return;
    setInspecting(true);
    try {
      setOpen(showEditor);
      setError(null);
      const inspected = await request({ scope: props.scope, action: "read" });
      if (current.current !== epoch) return;
      if (inspected?.result.kind === "error" && inspected.result.code === "CONFIG_MISSING") {
        await request({ scope: props.scope, action: "draft" });
      } else if (inspected?.result.kind === "read" && props.autoPrepare) {
        // Only obtain candidate metadata; never replace the existing YAML or CAS digest.
        await request({ scope: props.scope, action: "draft" }, true);
      }
    } finally {
      setInspecting(false);
    }
  };
  const initialRead = useRef(start);
  const initialEpoch = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    initialRead.current = start;
  });
  useEffect(() => {
    if (
      props.autoPrepare &&
      props.enabled &&
      !busy &&
      !pending.current &&
      initialEpoch.current !== epoch
    ) {
      initialEpoch.current = epoch;
      void initialRead.current(false);
    }
  }, [epoch, props.autoPrepare, props.enabled, busy]);
  const result = response?.result;
  const fieldsResult = yaml.length > 0 ? parseProjectSetupFields(yaml) : null;
  const canEdit = result?.kind === "draft" || result?.kind === "read";
  const checkPolicies = canEdit ? (result.checkPolicies ?? []) : [];
  const update = (change: (fields: ProjectSetupFields) => ProjectSetupFields) => {
    if (fieldsResult?.status !== "valid") return;
    try {
      setYaml(patchProjectSetupFields(yaml, change(fieldsResult.fields)));
      setReviewed(false);
      setPreset("manual");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "설정을 수정할 수 없어요.");
    }
  };
  const save = () => {
    if (!response || !reviewed || fieldsResult?.status !== "valid") return;
    if (response.result.kind === "draft") {
      void request({
        scope: props.scope,
        action: "save",
        targetDigest: response.targetDigest,
        yaml,
      });
    } else if (response.result.kind === "read") {
      void request({
        scope: props.scope,
        action: "update",
        targetDigest: response.targetDigest,
        expectedConfigDigest: response.result.configDigest,
        yaml,
      });
    }
  };
  const prepareDefaults = async () => {
    if (!response || fieldsResult?.status !== "valid") return;
    if (
      response.result.kind === "draft" ||
      (response.result.kind === "read" && yaml !== response.result.yaml)
    ) {
      const saved = await request(
        response.result.kind === "draft"
          ? { scope: props.scope, action: "save", targetDigest: response.targetDigest, yaml }
          : {
              scope: props.scope,
              action: "update",
              targetDigest: response.targetDigest,
              expectedConfigDigest: response.result.configDigest,
              yaml,
            },
      );
      if (saved?.result.kind !== "saved") return;
      const initialized = await request({ scope: props.scope, action: "initialize" });
      if (initialized?.result.kind !== "initialized") return;
    } else if (response.result.kind !== "read") {
      return;
    }
    await request({ scope: props.scope, action: "doctor" });
  };
  const choices = presets.flatMap((item) =>
    [item.selected, ...item.alternatives]
      .filter((candidate) => candidate !== null)
      .map((candidate) => ({
        id: item.id,
        value: `${item.id}:${candidate.instanceId}`,
        candidate,
      })),
  );

  return (
    <div
      className="space-y-3 rounded-lg bg-muted/40 p-3"
      aria-busy={busy}
      data-weavra="project-setup-status"
      data-result-kind={result?.kind}
      data-ready={
        result?.kind === "saved"
          ? result.readiness.ready
          : result?.kind === "doctor"
            ? result.ready
            : undefined
      }
    >
      <Button
        type="button"
        variant="outline"
        data-weavra-action="set-up-project"
        disabled={!props.enabled || busy}
        onClick={() => {
          if (canEdit) setOpen(!open);
          else void start();
        }}
      >
        프로젝트 설정
      </Button>
      {busy ? (
        <p role="status" className="text-xs text-muted-foreground">
          프로젝트 설정과 모델 후보를 확인하고 있어요…
        </p>
      ) : null}
      {repositoryNeeded ? (
        <p
          role="status"
          data-weavra="repository-preparation-needed"
          className="text-xs text-muted-foreground"
        >
          Git이 없는 폴더도 시작할 수 있어요. ‘통제 작업 시작’을 누르면 로컬 Git과 최초 기준 커밋을
          자동으로 준비해요. 원격 업로드나 모델 실행은 하지 않아요.
        </p>
      ) : null}
      {canEdit && fieldsResult?.status === "valid" ? (
        <div className="space-y-3" data-weavra="project-defaults">
          <label className="block space-y-1 text-sm" htmlFor={`${id}-preset`}>
            <span className="font-medium">작업 프리셋</span>
            <select
              id={`${id}-preset`}
              data-weavra="project-preset"
              className={inputClass}
              value={preset}
              disabled={!props.enabled || busy || fieldsResult.hasModelIntents}
              onChange={(event) => {
                const choice = choices.find((item) => item.value === event.target.value);
                if (!choice || fieldsResult.hasModelIntents) return;
                update((fields) => ({
                  ...fields,
                  coding: { provider: choice.candidate.provider, model: choice.candidate.coding },
                  reasoning: {
                    provider: choice.candidate.provider,
                    model: choice.candidate.reasoning,
                  },
                }));
                setPreset(choice.value);
              }}
            >
              <option value="manual">기존 설정 / 직접 설정</option>
              {(["speed", "balanced", "quality"] as const).flatMap((name) => {
                const label = { speed: "속도", balanced: "밸런스 (기본)", quality: "품질" }[name];
                const available = choices.filter((item) => item.id === name);
                return available.length
                  ? available.map((item) => (
                      <option key={item.value} value={item.value}>
                        {label} · {item.candidate.displayName} · {item.candidate.coding}
                      </option>
                    ))
                  : [
                      <option key={name} value={`${name}:unavailable`} disabled>
                        {label} · 사용 가능한 모델 없음
                      </option>,
                    ];
              })}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">
            구현: {fieldsResult.fields.coding.provider} / {fieldsResult.fields.coding.model} · 추론:{" "}
            {fieldsResult.fields.reasoning.provider} / {fieldsResult.fields.reasoning.model}
          </p>
          <p className="text-xs text-muted-foreground">
            수정 범위: {fieldsResult.fields.allowedRoots.join(", ") || "직접 지정 필요"} · 등록
            검사: {fieldsResult.fields.checks.length}개. 연결된 모델 정보로 준비하며 Runtime 인증은
            실행 전에 별도로 확인해요. 프리셋 선택만으로 계정 사용이나 모델 실행을 허용하지 않아요.
          </p>
          {fieldsResult.hasModelIntents ? (
            <p className="text-xs text-muted-foreground">
              고급 역할별 모델 지정이 있어 기존 라우팅을 유지해요. 프리셋으로 덮어쓰지 않으니
              프로젝트 설정의 고급 YAML에서 확인해 주세요.
            </p>
          ) : null}
          {!open ? (
            <Button
              type="button"
              data-weavra-action="prepare-project-defaults"
              disabled={
                !props.enabled ||
                busy ||
                !fieldsResult.fields.coding.provider.trim() ||
                !fieldsResult.fields.coding.model.trim() ||
                !fieldsResult.fields.reasoning.provider.trim() ||
                !fieldsResult.fields.reasoning.model.trim()
              }
              onClick={() => void prepareDefaults()}
            >
              {result?.kind === "draft"
                ? "이 설정으로 저장하고 준비"
                : result?.kind === "read" && yaml !== result.yaml
                  ? "선택한 설정으로 변경하고 준비"
                  : "기존 설정 준비 상태 확인"}
            </Button>
          ) : null}
        </div>
      ) : null}
      {open && canEdit && fieldsResult && result && fieldsResult.status === "valid" ? (
        <section className="space-y-3" aria-label="프로젝트 설정">
          <h4 className="font-medium">
            {result.kind === "draft" ? "새 프로젝트 설정" : "프로젝트 설정 편집"}
          </h4>
          <p className="text-sm text-muted-foreground">
            프로젝트 YAML을 Runtime에만 전달해 설정 파일을 검증하고 저장해요. 외부 AI로 보내지
            않으며, 대화 로그인과 Runtime 프로바이더 인증은 별개예요. 모델 추천 조회는 초안 생성
            때만 수행하며 자동 로그인·인증·모델 실행은 없어요. Anthropic API 키 방식은 설정할 수
            있지만 Claude 구독 로그인을 API 키처럼 사용하지 않아요.
          </p>
          {result.kind === "draft" ? (
            <p className="text-xs text-muted-foreground">
              프로젝트 유형: {result.projectTypes.join(", ") || "일반 프로젝트"} · 지원 프로필:{" "}
              {result.workspaceProfile.kind === "supported"
                ? `${result.workspaceProfile.profile.mode}, ${result.workspaceProfile.fileCount}개 파일, ${result.workspaceProfile.totalBytes}바이트`
                : `${result.workspaceProfile.diagnostic.code}: ${result.workspaceProfile.diagnostic.action}`}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              저장된 설정을 읽었어요. 저장 전까지 로컬 편집이며, 변경은 현재 설정 digest가 일치할
              때만 반영돼요.
            </p>
          )}
          {result.kind === "draft" && result.notes?.length ? (
            <ul
              data-weavra="project-draft-notes"
              className="space-y-1 text-xs text-muted-foreground"
            >
              {result.notes.map((note) => (
                <li key={note}>{draftNote(note)}</li>
              ))}
            </ul>
          ) : null}
          <BasicFields
            fields={fieldsResult.fields}
            checkPolicies={checkPolicies}
            update={update}
            disabled={!props.enabled || busy}
            trial={
              // Only the saved configuration runs, so local edits must be saved first.
              response && result.kind === "read" && yaml === result.yaml
                ? {
                    results: trials,
                    // Called only from the confirm button of CheckTrialRun.
                    run: (checkId) =>
                      void request({
                        scope: props.scope,
                        action: "trial-check",
                        targetDigest: response.targetDigest,
                        checkId,
                        consent: true,
                      }),
                  }
                : undefined
            }
          />
          <details open={advanced} onToggle={(event) => setAdvanced(event.currentTarget.open)}>
            <summary className="cursor-pointer font-medium">고급 YAML</summary>
            <label className="block pt-2 text-sm font-medium" htmlFor={`${id}-yaml`}>
              전체 설정
            </label>
            <Textarea
              id={`${id}-yaml`}
              value={yaml}
              rows={14}
              spellCheck={false}
              data-weavra="project-setup-yaml"
              className="max-h-96 font-mono text-xs"
              disabled={!props.enabled || busy}
              onChange={(event) => {
                setYaml(event.target.value);
                setReviewed(false);
                setPreset("manual");
              }}
            />
          </details>
          {fieldsResult.status === "valid" ? (
            <label className="flex items-start gap-2 text-sm">
              <input
                aria-label="프로젝트 설정 저장 동의"
                type="checkbox"
                data-weavra="project-setup-review"
                checked={reviewed}
                disabled={!props.enabled || busy}
                onChange={(event) => setReviewed(event.target.checked)}
              />
              모델·허용 경로·명령·필수 검사·격리 정책을 검토했고 이 설정을 저장해도 돼요.
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              data-weavra-action={
                result.kind === "draft" ? "save-project-setup" : "update-project-setup"
              }
              disabled={!props.enabled || busy || !reviewed || fieldsResult.status !== "valid"}
              onClick={save}
            >
              {result.kind === "draft" ? "검토 후 저장" : "검토 후 변경 저장"}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-weavra-action="cancel-project-setup"
              disabled={busy}
              onClick={() => {
                setResponse(null);
                setError(null);
                setYaml("");
                setReviewed(false);
                setOpen(false);
              }}
            >
              닫기
            </Button>
          </div>
        </section>
      ) : null}
      {open && canEdit && fieldsResult?.status === "invalid" ? (
        <section className="space-y-3" aria-label="프로젝트 설정 YAML 오류">
          <p role="alert" className="text-sm text-destructive">
            구조화된 입력을 표시할 수 없어요: {fieldsResult.error} 고급 YAML에서 수정할 수 있어요.
          </p>
          <details open>
            <summary className="cursor-pointer font-medium">고급 YAML</summary>
            <Textarea
              id={`${id}-yaml`}
              value={yaml}
              rows={14}
              spellCheck={false}
              data-weavra="project-setup-yaml"
              className="max-h-96 font-mono text-xs"
              disabled={!props.enabled || busy}
              onChange={(event) => {
                setYaml(event.target.value);
                setReviewed(false);
              }}
            />
          </details>
        </section>
      ) : null}
      {open && result && !canEdit && result.kind !== "error" && result.kind !== "trial-check" ? (
        <section className="space-y-3" aria-label="Runtime 프로젝트 상태">
          <SetupStatus result={result} />
          <p className="text-xs text-muted-foreground">
            Runtime 인증 상태를 바꾸지 않으며 로그인·모델 실행은 하지 않아요.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              data-weavra-action="edit-project-setup"
              disabled={!props.enabled || busy}
              onClick={() => void start()}
            >
              설정 다시 읽고 편집
            </Button>
            <Button
              type="button"
              variant="outline"
              data-weavra-action="recheck-project-setup"
              disabled={!props.enabled || busy}
              onClick={() => void request({ scope: props.scope, action: "doctor" })}
            >
              준비 상태 다시 검사
            </Button>
            <Button
              type="button"
              variant="outline"
              data-weavra-action="initialize-runtime-home"
              disabled={!props.enabled || busy}
              onClick={() => void request({ scope: props.scope, action: "initialize" })}
            >
              Runtime 홈 초기화
            </Button>
          </div>
        </section>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function SetupStatus({
  result,
}: {
  result: Exclude<
    WeavraProjectSetupResult["result"],
    { kind: "draft" | "read" | "error" | "trial-check" }
  >;
}) {
  if (result.kind === "initialized") {
    return <p role="status">Runtime 홈을 명시적으로 초기화했어요.</p>;
  }
  const readiness = result.kind === "saved" ? result.readiness : result;
  const denied = (readiness.checkPolicies ?? []).filter((policy) => policy.policy === "denied");
  const policyBlocked =
    !readiness.ready &&
    readiness.diagnostics.some((diagnostic) => diagnostic.code.startsWith("CHECK_POLICY_DENIED"));
  return (
    <>
      <h4 className="font-medium">
        {readiness.ready ? "프로젝트 설정 준비 완료" : "해결이 필요한 준비 상태"}
      </h4>
      {policyBlocked ? (
        <p role="status" data-weavra="check-policy-blocked" className="text-sm">
          막힌 검사를 고친 뒤 다시 점검해 주세요. ‘설정 다시 읽고 편집’에서 검사별로 허용 형태를
          확인할 수 있어요.
        </p>
      ) : null}
      {denied.length ? (
        <ul className="space-y-1 text-xs">
          {denied.map((policy) => (
            <li key={policy.id} data-weavra="check-policy" data-policy="denied">
              {policy.id}: 정책에 막힘: {policyReason(policy.reason)}
            </li>
          ))}
        </ul>
      ) : null}
      <ul className="space-y-1 text-xs text-muted-foreground">
        {readiness.diagnostics.map((diagnostic) => (
          <li key={diagnostic.code}>
            {diagnostic.code}: {diagnostic.action}
          </li>
        ))}
      </ul>
    </>
  );
}

function BasicFields(props: {
  fields: ProjectSetupFields;
  checkPolicies: readonly WeavraProjectCheckPolicy[];
  update: (change: (fields: ProjectSetupFields) => ProjectSetupFields) => void;
  disabled: boolean;
  trial: TrialCheckRunner | undefined;
}) {
  const modelField = (role: "coding" | "reasoning") => (
    <div className="grid gap-2 sm:grid-cols-2">
      <label className="space-y-1 text-sm">
        <span>{role === "coding" ? "구현 프로바이더" : "추론 프로바이더"}</span>
        <input
          className={inputClass}
          data-weavra={`model-${role}-provider`}
          value={props.fields[role].provider}
          disabled={props.disabled}
          onChange={(event) =>
            props.update((fields) => ({
              ...fields,
              [role]: { ...fields[role], provider: event.target.value },
            }))
          }
        />
      </label>
      <label className="space-y-1 text-sm">
        <span>{role === "coding" ? "구현 모델 ID" : "추론 모델 ID"}</span>
        <input
          className={inputClass}
          data-weavra={`model-${role}-id`}
          value={props.fields[role].model}
          disabled={props.disabled}
          onChange={(event) =>
            props.update((fields) => ({
              ...fields,
              [role]: { ...fields[role], model: event.target.value },
            }))
          }
        />
      </label>
    </div>
  );
  return (
    <div className="space-y-3">
      {modelField("coding")}
      {modelField("reasoning")}
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          data-weavra="claude-code-consent"
          checked={props.fields.claudeCodeEnabled}
          disabled={props.disabled}
          onChange={(event) =>
            props.update((fields) => ({ ...fields, claudeCodeEnabled: event.target.checked }))
          }
        />
        Claude 구독을 공식 Claude Code 경로로 사용하도록 허용해요.
      </label>
      <p className="text-xs text-muted-foreground">
        기본값은 사용 안 함이에요. API 키는 기존 API 경로를 유지하고, 구독은 별도 CLI 인증이
        필요해요. 이 설정만으로 계정을 바꾸거나 모델을 실행하지 않아요.
      </p>
      <label className="block space-y-1 text-sm">
        <span>Runtime이 수정할 수 있는 허용 경로 (한 줄에 하나씩)</span>
        <Textarea
          value={props.fields.allowedRoots.join("\n")}
          disabled={props.disabled}
          rows={3}
          onChange={(event) =>
            props.update((fields) => ({
              ...fields,
              allowedRoots: event.target.value.split("\n").filter((path) => path.length > 0),
            }))
          }
        />
      </label>
      <CheckFields
        fields={props.fields.checks}
        policies={props.checkPolicies}
        disabled={props.disabled}
        update={props.update}
        trial={props.trial}
      />
      <label className="block space-y-1 text-sm">
        <span>격리 정책</span>
        <select
          className={inputClass}
          value={props.fields.sandbox}
          disabled={props.disabled}
          onChange={(event) =>
            props.update((fields) => ({
              ...fields,
              sandbox: event.target.value === "disabled" ? "disabled" : "required",
            }))
          }
        >
          <option value="required">필수 (권장)</option>
          <option value="disabled">사용 안 함</option>
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>증거 수집 프로필</span>
        <select
          className={inputClass}
          value={props.fields.evidenceProfile}
          disabled={props.disabled}
          data-weavra="evidence-profile"
          onChange={(event) =>
            props.update((fields) => ({
              ...fields,
              evidenceProfile:
                event.target.value === "bounded-monorepo" ? "bounded-monorepo" : "default",
            }))
          }
        >
          <option value="default">기본 (전체 32 MiB 한도)</option>
          <option value="bounded-monorepo">대형 저장소 (전체 512 MiB 한도)</option>
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        대형 프로필도 유한한 한도를 적용하며 수정할 파일은 2 MiB 한도를 유지해요. 자격 증명이나
        로그인 정보는 입력하지 마세요.
      </p>
    </div>
  );
}

function CheckFields(props: {
  fields: ProjectSetupCheck[];
  policies: readonly WeavraProjectCheckPolicy[];
  disabled: boolean;
  update: (change: (fields: ProjectSetupFields) => ProjectSetupFields) => void;
  trial: TrialCheckRunner | undefined;
}) {
  // The editable ID is not a row key: typing must keep the same input mounted.
  const [rowKeys, setRowKeys] = useState(() => ({
    next: props.fields.length,
    values: new Map(props.fields.map((check, index) => [check.id, index])),
  }));
  if (
    rowKeys.values.size !== props.fields.length ||
    props.fields.some((check) => !rowKeys.values.has(check.id))
  ) {
    let next = rowKeys.next;
    const values = new Map(
      props.fields.map((check) => [check.id, rowKeys.values.get(check.id) ?? next++]),
    );
    setRowKeys({ next, values });
  }
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">등록 검사 (인수는 셸이 아닌 argv로 전달)</legend>
      {props.fields.map((check, index) => {
        const policy = props.policies.find((item) => item.id === (check.originalId ?? check.id));
        const trial = props.trial;
        return (
          <div
            key={rowKeys.values.get(check.id)}
            className="grid gap-2 rounded-md border border-border p-2 sm:grid-cols-2"
          >
            <CheckPolicyBadge
              check={check}
              policy={policy}
              disabled={props.disabled}
              fix={(suggestion) =>
                props.update((fields) =>
                  replaceCheck(fields, index, {
                    executable: suggestion.executable,
                    args: [...suggestion.args],
                  }),
                )
              }
            />
            {trial && policy?.policy === "allowed" && check.originalId === check.id ? (
              <CheckTrialRun
                check={check}
                result={trial.results[check.id]}
                disabled={props.disabled}
                run={() => trial.run(check.id)}
              />
            ) : null}
            <label className="space-y-1 text-xs">
              <span>검사 ID</span>
              <input
                className={inputClass}
                data-weavra="project-check-id"
                value={check.id}
                disabled={props.disabled}
                onChange={(event) => {
                  const id = event.target.value;
                  setRowKeys((current) => ({
                    ...current,
                    values: new Map(
                      [...current.values].map(([previousId, key]) => [
                        previousId === check.id ? id : previousId,
                        key,
                      ]),
                    ),
                  }));
                  props.update((fields) => replaceCheck(fields, index, { id }));
                }}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span>검사 종류</span>
              <select
                className={inputClass}
                value={check.kind}
                disabled={props.disabled}
                onChange={(event) =>
                  props.update((fields) =>
                    replaceCheck(fields, index, {
                      kind:
                        event.target.value === "build" ||
                        event.target.value === "lint" ||
                        event.target.value === "test" ||
                        event.target.value === "typecheck" ||
                        event.target.value === "format" ||
                        event.target.value === "custom"
                          ? event.target.value
                          : "custom",
                    }),
                  )
                }
              >
                {["build", "lint", "test", "typecheck", "format", "custom"].map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs">
              <span>실행 파일</span>
              <input
                className={inputClass}
                value={check.executable}
                disabled={props.disabled}
                onChange={(event) =>
                  props.update((fields) =>
                    replaceCheck(fields, index, { executable: event.target.value }),
                  )
                }
              />
            </label>
            <label className="space-y-1 text-xs">
              <span>argv (한 줄에 인수 하나씩)</span>
              <Textarea
                value={check.args.join("\n")}
                disabled={props.disabled}
                rows={2}
                onChange={(event) =>
                  props.update((fields) =>
                    replaceCheck(fields, index, { args: event.target.value.split("\n") }),
                  )
                }
              />
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input
                aria-label={`${check.id} 필수 검사`}
                type="checkbox"
                checked={check.required ?? true}
                disabled={props.disabled}
                onChange={(event) =>
                  props.update((fields) =>
                    replaceCheck(fields, index, { required: event.target.checked }),
                  )
                }
              />
              필수 검사
            </label>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={props.disabled}
              onClick={() =>
                props.update((fields) => ({
                  ...fields,
                  checks: fields.checks.filter((_, at) => at !== index),
                }))
              }
            >
              검사 제거
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={props.disabled}
        onClick={() =>
          props.update((fields) => ({
            ...fields,
            checks: [
              ...fields.checks,
              {
                id: `check-${fields.checks.length + 1}`,
                kind: "test",
                executable: "pnpm",
                args: ["test"],
                required: true,
              },
            ],
          }))
        }
      >
        필수 검사 추가
      </Button>
    </fieldset>
  );
}

/** Runtime verdicts describe the saved form; a suggestion changes YAML only on a user click. */
function CheckPolicyBadge(props: {
  check: ProjectSetupCheck;
  policy: WeavraProjectCheckPolicy | undefined;
  disabled: boolean;
  fix: (suggestion: NonNullable<WeavraProjectCheckPolicy["suggestion"]>) => void;
}) {
  const { policy, check } = props;
  if (!policy) return null;
  const suggestion = policy.suggestion;
  const fixed =
    suggestion !== undefined &&
    check.executable === suggestion.executable &&
    check.args.length === suggestion.args.length &&
    check.args.every((arg, at) => arg === suggestion.args[at]);
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-xs sm:col-span-2"
      data-weavra="check-policy"
      data-policy={fixed ? "fixed" : policy.policy}
    >
      <span
        className={
          policy.policy === "allowed"
            ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300"
            : fixed
              ? "rounded-full bg-muted px-2 py-0.5 text-muted-foreground"
              : "rounded-full bg-destructive/10 px-2 py-0.5 text-destructive"
        }
      >
        {policy.policy === "allowed"
          ? "실행 가능"
          : fixed
            ? "허용 형태로 고쳤어요 · 저장 후 다시 점검해 주세요"
            : `정책에 막힘: ${policyReason(policy.reason)}`}
      </span>
      {policy.policy === "denied" && suggestion && !fixed ? (
        <>
          <Button
            type="button"
            size="sm"
            variant="outline"
            data-weavra-action="fix-check-policy"
            disabled={props.disabled}
            onClick={() => props.fix(suggestion)}
          >
            허용 형태로 고치기
          </Button>
          <span className="text-muted-foreground">
            {[suggestion.executable, ...suggestion.args].join(" ")} · {suggestion.note}
          </span>
        </>
      ) : null}
    </div>
  );
}

/** One consented run of the saved check; the result is shown here only and is never verification evidence. */
function CheckTrialRun(props: {
  check: ProjectSetupCheck;
  result: TrialCheckResult | undefined;
  disabled: boolean;
  run: () => void;
}) {
  const [consenting, setConsenting] = useState(false);
  const { result } = props;
  const outcome = !result
    ? undefined
    : result.timedOut
      ? "timeout"
      : result.truncated
        ? "output-limit"
        : result.exitCode === 0
          ? "passed"
          : "failed";
  return (
    <div
      className="space-y-2 text-xs sm:col-span-2"
      data-weavra="check-trial"
      data-outcome={outcome}
    >
      {consenting ? (
        <div className="flex flex-wrap items-center gap-2">
          <span data-weavra="check-trial-consent">
            이 명령을 지금 한 번 실행해요: {[props.check.executable, ...props.check.args].join(" ")}
          </span>
          <Button
            type="button"
            size="sm"
            data-weavra-action="confirm-trial-check"
            disabled={props.disabled}
            onClick={() => {
              setConsenting(false);
              props.run();
            }}
          >
            실행
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            data-weavra-action="cancel-trial-check"
            onClick={() => setConsenting(false)}
          >
            취소
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-weavra-action="trial-check"
          disabled={props.disabled}
          onClick={() => setConsenting(true)}
        >
          시험 실행
        </Button>
      )}
      {result && outcome ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              data-weavra="check-trial-badge"
              className={
                outcome === "passed"
                  ? "rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300"
                  : "rounded-full bg-destructive/10 px-2 py-0.5 text-destructive"
              }
            >
              {
                {
                  passed: "통과",
                  failed: "실패",
                  timeout: "시간 초과",
                  "output-limit": "출력 초과",
                }[outcome]
              }
            </span>
            <span className="text-muted-foreground">
              종료 코드 {result.exitCode ?? "없음"} · {result.durationMs}ms · 출력{" "}
              {result.outputBytes}바이트
            </span>
          </div>
          {result.timedOut || result.truncated || result.outputBytes > 16384 ? (
            <p role="alert" data-weavra="check-trial-warning" className="text-destructive">
              실행 전에 고쳐야 해요
            </p>
          ) : null}
          {result.stdoutTail ? (
            <pre className="max-h-40 overflow-auto rounded-md bg-background p-2 font-mono whitespace-pre-wrap">
              {result.stdoutTail}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function replaceCheck(
  fields: ProjectSetupFields,
  index: number,
  change: Partial<ProjectSetupCheck>,
): ProjectSetupFields {
  return {
    ...fields,
    checks: fields.checks.map((check, at) => (at === index ? { ...check, ...change } : check)),
  };
}
