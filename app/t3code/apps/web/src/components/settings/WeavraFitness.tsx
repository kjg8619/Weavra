import { weavraLabel } from "../weavraLabels";
import { createEnvironmentWeavraFitnessCommand } from "@t3tools/client-runtime/state/weavraFitness";
import type {
  EnvironmentId,
  ProjectId,
  WeavraFitnessComparison,
  WeavraFitnessHistory,
  WeavraFitnessInput,
  WeavraFitnessSummary,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useId, useRef, useState } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { useEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsSection } from "./settingsLayout";

const command = createEnvironmentWeavraFitnessCommand(connectionAtomRuntime);
const value = (number: number | null) => (number === null ? "UNKNOWN" : number.toLocaleString());
const groups = ["correctness", "contract", "tools", "reliability", "efficiency"] as const;

function Evidence({ run }: { run: WeavraFitnessSummary }) {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p>
        보정 상태: <span className="font-mono">{run.calibration ?? "확인 안 됨"}</span>
      </p>
      <p>
        평가 상태: <span className="font-mono">{run.evaluation ?? "확인 안 됨"}</span>
      </p>
      <p>
        중단 사유:{" "}
        <span className="font-mono">
          {run.stopReasons === undefined ? "UNKNOWN" : run.stopReasons.join(", ") || "none"}
        </span>
      </p>
      {run.fixtureResults === undefined ? (
        <p>검증 사례 결과 미확인(과거 기록)</p>
      ) : (
        <details>
          <summary className="cursor-pointer">검증 사례 결과</summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left text-sm" aria-label={`검증 사례 결과: ${run.id}`}>
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2 pr-4">
                    검증 사례
                  </th>
                  <th scope="col" className="pr-4">
                    종료 상태
                  </th>
                  <th scope="col" className="pr-4">
                    판정 기준
                  </th>
                  <th scope="col" className="pr-4">
                    잘못된 완료 판정
                  </th>
                  <th scope="col" className="pr-4">
                    작업 계약 준수
                  </th>
                  <th scope="col" className="pr-4">
                    사용량
                  </th>
                  <th scope="col" className="pr-4">
                    무결성 / 사유
                  </th>
                  <th scope="col">소요 시간(ms)</th>
                </tr>
              </thead>
              <tbody>
                {run.fixtureResults.map((fixture) => (
                  <tr key={fixture.fixtureId} className="border-t border-border/40 font-mono">
                    <th scope="row" className="py-2 pr-4 font-normal">
                      {fixture.fixtureId}
                    </th>
                    <td className="pr-4">{fixture.terminalStatus}</td>
                    <td className="pr-4">{fixture.oracle}</td>
                    <td className="pr-4">
                      {fixture.falseCompletion === null
                        ? "UNKNOWN"
                        : String(fixture.falseCompletion)}
                    </td>
                    <td className="pr-4">
                      {fixture.taskContractAdherence === null
                        ? "UNKNOWN"
                        : String(fixture.taskContractAdherence)}
                    </td>
                    <td className="pr-4">{fixture.usageState}</td>
                    <td className="pr-4">
                      {fixture.integrity === null
                        ? "UNKNOWN"
                        : `${fixture.integrity.state} / ${fixture.integrity.reasons.join(", ") || "none"}`}
                    </td>
                    <td>{value(fixture.latencyMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </div>
  );
}

function Target({ run }: { run: WeavraFitnessSummary }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="break-all font-mono text-sm">
        {run.target.provider} / {run.target.model}
      </p>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline">{run.kind}</Badge>
        <Badge variant="secondary">{weavraLabel(run.status)}</Badge>
      </div>
      <Evidence run={run} />
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">정확한 대상 식별 정보</summary>
        <dl className="mt-2 space-y-2">
          {Object.entries(run.target).map(([key, text]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd className="break-all font-mono">{text}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}

export function WeavraFitness({
  environmentId,
  projectId,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
}) {
  const environment = useEnvironment(environmentId);
  const connected = environment?.connection.phase === "connected";
  const invoke = useAtomCommand(command, { reportFailure: false, reportDefect: false });
  const [history, setHistory] = useState<WeavraFitnessHistory | null>(null);
  const [comparison, setComparison] = useState<WeavraFitnessComparison | null>(null);
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    "기존 기록만 읽어요. 평가나 모델 호출은 이 화면에서 시작하지 않고, 별도로 명시적인 승인을 받아 실행해야 해요.",
  );
  const [helpOpen, setHelpOpen] = useState(false);
  const helpId = useId();
  const helpOpener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!helpOpen) return;
    const dismiss = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setHelpOpen(false);
      requestAnimationFrame(() => helpOpener.current?.focus());
    };
    document.addEventListener("keydown", dismiss, { capture: true });
    return () => document.removeEventListener("keydown", dismiss, { capture: true });
  }, [helpOpen]);
  const lifecycle = useRef({ connected: false, active: false });
  const pending = useRef(false);
  useEffect(() => {
    const current = { connected, active: true };
    lifecycle.current = current;
    return () => {
      current.active = false;
    };
  }, [connected]);
  const read = async (input: WeavraFitnessInput) => {
    if (!connected || pending.current) return;
    const current = lifecycle.current;
    pending.current = true;
    setBusy(true);
    try {
      const result = await invoke({ environmentId, input });
      if (!current.active || !current.connected) return;
      if (!AsyncResult.isSuccess(result)) {
        setMessage(
          "적합성 기록을 불러올 수 없거나 호환되지 않아요. 수정·평가·자동 재시도는 하지 않았어요.",
        );
        return;
      }
      if (result.value.command === "list") {
        setHistory(result.value.data);
        setComparison(null);
        setLeft("");
        setRight("");
        setMessage(
          `과거 기록 ${result.value.data.runs.length}개를 읽었어요. Runtime 상태와 판정 기준 결과는 별도예요.`,
        );
      } else {
        setComparison(result.value.data);
        setMessage("기록된 측정값을 그대로 표시해요. 점수·순위·모델 선택을 추천하지 않아요.");
      }
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <SettingsSection id="weavra-fitness" title="프로바이더 적합성 · 읽기 전용">
      <SettingsGroup divided={false} className="space-y-5 p-4 break-keep text-pretty">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">순위가 아닌 계약 준수 증거</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              기록마다 하나의 프로바이더·모델·endpoint·검증 환경을 나타내요.
            </p>
          </div>
          <Button
            variant="outline"
            disabled={!connected || busy}
            className="h-auto min-h-8 max-w-full border-muted-foreground whitespace-normal break-keep text-pretty"
            onClick={() => {
              void read({ projectId, command: "list" });
            }}
          >
            기록 불러오기
          </Button>
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
          {!connected
            ? "연결이 끊겼어요. 표시된 기록은 과거 정보이니 다시 연결한 뒤 새로고침해 주세요."
            : message}
        </p>
        <div>
          <Button
            ref={helpOpener}
            variant="outline"
            aria-expanded={helpOpen}
            className="h-auto min-h-8 max-w-full border-muted-foreground whitespace-normal break-keep text-pretty"
            aria-controls={helpId}
            onClick={() => setHelpOpen((value) => !value)}
          >
            읽기 전용 안내
          </Button>
          {helpOpen ? (
            <div id={helpId} className="mt-2 space-y-2 text-sm text-muted-foreground">
              <p>
                기록은 이 화면 밖에서 따로 실행한 적합성 평가가 남긴 것이에요. 이 화면은 만들어진
                기록을 읽고 비교할 뿐이에요.
              </p>
              <p>
                위의 ‘기록 불러오기’가 이 프로젝트의 기록 목록을 읽어요. 읽기만 하고 아무것도
                실행하거나 바꾸지 않아요.
              </p>
              <p>
                평가를 새로 하려면 모델 호출이 들어가므로 별도로 명시적인 승인을 받은 뒤 이 앱
                밖에서 직접 실행해야 해요. 이 화면에는 평가 버튼이 없어요.
              </p>
            </div>
          ) : null}
        </div>
        {history && (
          <>
            <div className="border-l-2 border-border pl-3 text-sm">
              <p className="font-mono">
                현재 검증 사례 집합: {history.corpusRevision} · {history.fixtures.length} 개 검증
                사례
              </p>
              <p className="mt-1 break-all font-mono text-muted-foreground">
                {history.corpusDigest}
              </p>
            </div>
            {history.runs.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                이 프로젝트에는 읽을 적합성 기록이 아직 없어요. 기록은 이 화면 밖에서 별도의
                명시적인 CLI 실행으로 수집해요. 평가에는 모델 호출이 들어가므로 별도로 승인을 받아야
                하고, 실행이 끝난 뒤에 위의 ‘기록 불러오기’로 읽을 수 있어요.
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm" aria-label="프로바이더 적합성 기록">
                    <thead className="text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-2 pr-4">
                          대상 / 기록
                        </th>
                        <th scope="col" className="pr-4">
                          수집 상태
                        </th>
                        <th scope="col" className="pr-4">
                          판정 통과 / 실패 / 무효
                        </th>
                        <th scope="col">잘못된 완료 판정</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.runs.map((run) => (
                        <tr key={run.id} className="border-t border-border/40">
                          <th scope="row" className="py-3 pr-4 font-normal">
                            <p className="font-mono">
                              {run.target.provider} / {run.target.model}
                            </p>
                            <p className="mt-1 font-mono text-muted-foreground">{run.id}</p>
                            <p className="mt-1 text-muted-foreground">
                              {new Date(run.startedAt).toLocaleString()} · {run.kind} ·{" "}
                              {run.corpusRevision}
                            </p>
                          </th>
                          <td className="space-y-2 pr-4">
                            <p>{weavraLabel(run.status)}</p>
                            <Evidence run={run} />
                          </td>
                          <td className="pr-4 font-mono">
                            {run.correctness.oraclePass} / {run.correctness.oracleFail} /{" "}
                            {run.correctness.invalid}
                          </td>
                          <td className="font-mono">{run.correctness.falseCompletion}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-end gap-3 border-t border-border/50 pt-4">
                  {(["A", "B"] as const).map((side) => (
                    <label
                      key={side}
                      className="min-w-0 flex-1 space-y-1 text-sm text-muted-foreground"
                    >
                      <span>기록 {side}</span>
                      <select
                        aria-label={`적합성 기록 ${side}`}
                        className="block w-full rounded-md border border-input bg-background p-2 text-foreground"
                        value={side === "A" ? left : right}
                        onChange={(event) => {
                          (side === "A" ? setLeft : setRight)(event.target.value);
                          setComparison(null);
                        }}
                      >
                        <option value="">기록 선택</option>
                        {history.runs.map((run) => (
                          <option key={run.id} value={run.id}>
                            {run.target.provider}/{run.target.model} · {run.id.slice(0, 8)} ·{" "}
                            {run.kind}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                  <Button
                    variant="outline"
                    disabled={!connected || busy || !left || !right || left === right}
                    onClick={() => {
                      void read({ projectId, command: "compare", left, right });
                    }}
                  >
                    기록 비교
                  </Button>
                </div>
              </>
            )}
          </>
        )}
        {comparison && (
          <div className="space-y-4 border-t border-border/50 pt-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant={comparison.comparable ? "outline" : "warning"}>
                {comparison.comparable ? "조건 일치" : "비교할 수 없음"}
              </Badge>
              {Object.entries(comparison.compatibility)
                .filter(([, compatible]) => !compatible)
                .map(([key]) => (
                  <Badge key={key} variant="outline">
                    {key} 다름
                  </Badge>
                ))}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Target run={comparison.left} />
              <Target run={comparison.right} />
            </div>
            <table className="w-full text-left text-sm" aria-label="프로바이더 적합성 측정값 비교">
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-2">
                    측정 항목
                  </th>
                  <th scope="col">A</th>
                  <th scope="col">B</th>
                </tr>
              </thead>
              <tbody>
                {groups.flatMap((group) =>
                  Object.entries(comparison.left[group]).map(([key, number]) => (
                    <tr key={`${group}.${key}`} className="border-t border-border/40">
                      <th scope="row" className="py-2 font-normal">
                        <span className="text-muted-foreground">{group} / </span>
                        {key}
                      </th>
                      <td className="font-mono">{value(number)}</td>
                      <td className="font-mono">
                        {value(
                          Object.entries(comparison.right[group]).find(
                            ([name]) => name === key,
                          )?.[1] ?? null,
                        )}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          미확인은 0이 아니에요. 통제된 검토와 수정, 모의 검사는 실제 모델 오류율을 뜻하지 않아요.
          비용, HTTP 시도 횟수, 상위 backend 식별 정보는 알 수 없을 수 있어요. 프롬프트, 추론, 인증
          정보, 도구 기록은 전송하지 않아요.
        </p>
      </SettingsGroup>
    </SettingsSection>
  );
}
