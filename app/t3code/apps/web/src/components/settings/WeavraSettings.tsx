import { weavraLabel } from "../weavraLabels";
import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ProjectId, WeavraObservation } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEnvironment } from "../../state/environments";
import { useProject } from "../../state/entities";
import { observations } from "../../state/weavraObservations";
import { Badge } from "../ui/badge";
import { SettingsGroup } from "./SettingsGroup";
import { SettingsSection } from "./settingsLayout";
import { WeavraControls } from "./WeavraControls";
import { WeavraFitness } from "./WeavraFitness";

const explanations: Record<WeavraObservation["status"], string> = {
  NOT_INSTALLED:
    "이 환경에 Weavra 실행 파일이 설정되지 않았거나 사용할 수 없어요. 서버에서 T3_WEAVRA_EXECUTABLE을 설정한 뒤 앱 서버를 다시 시작해 주세요.",
  NOT_SETUP:
    "Weavra는 설치됐지만 전용 홈이 준비되지 않았어요. 해당 환경에서 weavra setup을 실행한 뒤 이 화면을 다시 열어 주세요.",
  CONFIG_INVALID:
    "로컬 Weavra 시작 검사를 통과하지 못했어요. 해당 환경에서 weavra doctor를 실행해 주세요. 이 화면은 설정을 자동으로 고치지 않아요.",
  READY:
    "로컬 시작 검사를 통과했어요. 프로바이더 인증과 네트워크는 아직 검증하지 않았으며 공식 스냅샷을 기다리고 있어요.",
  CONNECTING: "읽기 전용 관찰기에 연결하고 있어요. 워크플로를 시작하지 않아요.",
  CONNECTED:
    "로컬 bridge로 공식 스냅샷을 조회해요. bridge 연결만으로 Runtime 소유 프로세스가 실행 중이라고 판단할 수는 없어요.",
  DISCONNECTED:
    "bridge나 환경 연결이 끊겼어요. 마지막 스냅샷은 과거 정보이며 저장된 Run 상태는 바뀌지 않았어요.",
  RECONNECTING:
    "다시 연결하고 최신 공식 스냅샷을 요청하고 있어요. 조회에 성공하기 전까지 캐시는 과거 정보로 표시해요.",
  PROTOCOL_MISMATCH:
    "이 Weavra bridge는 지원하는 읽기 전용 프로토콜과 호환되지 않아요. 연결 협의 외의 명령은 보내지 않아요.",
  ERROR:
    "유효한 공식 스냅샷을 읽지 못했어요. 캐시는 과거 정보이며 Runtime 복구나 수정을 시도하지 않았어요.",
};
const unknown = (value: string | number | boolean | null | undefined) => weavraLabel(value);

export function WeavraSettings({
  environmentId,
  projectId,
  workspaceRoot,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  workspaceRoot: string;
}) {
  const result = useAtomValue(observations.stateAtom(environmentId, projectId, workspaceRoot));
  const environment = useEnvironment(environmentId);
  const project = useProject(scopeProjectRef(environmentId, projectId));
  const view = Option.getOrUndefined(AsyncResult.value(result));
  const connected = environment?.connection.phase === "connected";
  const observation = view?.observation;
  const snapshot = observation?.snapshot;
  const run = snapshot?.data.status.run;
  const graph = snapshot?.data.graph;
  const evidence = snapshot?.data.evidence;
  const stale = !connected || observation?.stale !== false;
  const status = !connected ? "DISCONNECTED" : (observation?.status ?? "CONNECTING");
  return (
    <>
      <WeavraControls
        key={JSON.stringify([environmentId, projectId, workspaceRoot])}
        environmentId={environmentId}
        projectId={projectId}
        workspaceRoot={workspaceRoot}
        {...(project ? { projectName: project.title } : {})}
      />
      <SettingsSection id="weavra-overview" title="Weavra · 읽기 전용">
        <SettingsGroup divided={false} className="space-y-5 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Runtime 개요</h3>
            <div className="flex flex-wrap gap-2">
              <Badge variant={status === "CONNECTED" ? "info" : "outline"}>
                {weavraLabel(status)}
              </Badge>
              <Badge variant={stale ? "warning" : "secondary"}>
                {snapshot ? (stale ? "과거 스냅샷" : "공식 스냅샷") : "스냅샷 없음"}
              </Badge>
            </div>
          </div>
          <div role="status" aria-live="polite" className="space-y-1 text-sm text-muted-foreground">
            <p>
              {view?.support === "unsupported"
                ? "이 환경은 Weavra 읽기 전용 연결을 지원하지 않아요. Weavra RPC를 보내지 않았어요."
                : explanations[status]}
            </p>
            <p>
              Runtime 소유자: 미확인. 연결이 끊겨도 Run을 취소·실패·완료 처리하거나 재개하지 않아요.
            </p>
            {observation?.errorCode && (
              <p>
                관찰 오류: <code>{observation.errorCode}</code>
              </p>
            )}
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer rounded-sm py-2 focus-visible:outline-2 focus-visible:outline-ring">
              공식 관찰 상세
            </summary>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ["환경", environment?.label],
                [
                  "마지막 공식 관찰",
                  observation?.observedAt
                    ? new Date(observation.observedAt).toLocaleString()
                    : null,
                ],
                ["Runtime 버전", observation?.runtimeVersion],
                ["bridge 프로토콜", snapshot?.protocolVersion],
                ["Run", run?.runId],
                ["저장된 상태", run?.status],
                ["단계", run?.phase],
                ["워크플로 / 위험도", run ? `${run.workflow} / ${run.risk}` : null],
                ["실행 방식", run?.executionMode],
                [
                  "현재 단계",
                  run?.currentStep ? `${run.currentStep.stepId} #${run.currentStep.attempt}` : null,
                ],
                ["활성 에이전트(저장된 값)", run?.activeAgentCount],
                [
                  "Run / 프로젝트 revision",
                  snapshot
                    ? `${unknown(snapshot.stateRevision)} / ${unknown(snapshot.projectRevision)}`
                    : null,
                ],
                ["코드 revision", run?.codeRevision],
                ["마지막 이벤트 번호", snapshot?.eventId],
                ["작업 계약 digest", run?.taskContractDigest],
                ["쓰기 잠금 존재(실행 중임을 뜻하지 않음)", snapshot?.data.status.writerPresent],
              ].map(([label, value]) => (
                <div key={String(label)} className="min-w-0">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 select-text break-all font-mono text-sm">{unknown(value)}</dd>
                </div>
              ))}
            </dl>
          </details>
          {snapshot && !run && (
            <p className="text-sm text-muted-foreground">이 checkout에 현재 Weavra Run이 없어요.</p>
          )}
          {run?.workflow === "COMPLEX" && (
            <p className="text-sm text-muted-foreground">
              COMPLEX Run의 이 요약은 상위 Run만 보여줘요. 개별 작업 상태·시도·증거는 워크플로
              제어에서 확인해 주세요.
            </p>
          )}
          <div className="space-y-3 border-t border-border/50 pt-4">
            <h3 className="text-sm font-medium">Runtime 그래프</h3>
            <p className="text-xs text-muted-foreground">
              Runtime이 제공한 노드와 관계예요. 연결선은 실행 제어가 아니며 노드 색상으로 완료를
              판단하지 않아요.
            </p>
            {graph ? (
              <>
                <div className="overflow-x-auto">
                  <table
                    className="w-full text-left text-xs"
                    aria-label="Weavra Runtime 그래프 노드"
                  >
                    <thead className="text-muted-foreground">
                      <tr>
                        <th scope="col" className="py-2 pr-3">
                          노드
                        </th>
                        <th scope="col" className="py-2 pr-3">
                          종류 / 역할
                        </th>
                        <th scope="col" className="py-2">
                          저장된 상태
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {graph.nodes.map((node) => (
                        <tr key={node.id} className="border-t border-border/40">
                          <th scope="row" className="py-2 pr-3 font-mono font-normal">
                            {node.id}
                          </th>
                          <td className="py-2 pr-3">
                            {weavraLabel(node.kind)}
                            {node.role ? ` / ${node.role}` : ""}
                          </td>
                          <td className="py-2">
                            <Badge variant="outline">{weavraLabel(node.status)}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <ul
                  aria-label="Weavra Runtime 그래프 관계"
                  className="space-y-1 text-xs text-muted-foreground"
                >
                  {graph.edges.map((edge) => (
                    <li key={`${edge.from}->${edge.to}:${edge.kind}`} className="break-all">
                      <code>{edge.from}</code> → <code>{edge.to}</code> · {weavraLabel(edge.kind)}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                그래프를 확인할 수 없어요. 이벤트나 캐시 조각으로 그래프를 재구성하지 않아요.
              </p>
            )}
          </div>
          <section
            id="weavra-evidence"
            aria-labelledby="weavra-evidence-heading"
            tabIndex={-1}
            className="space-y-3 border-t border-border/50 pt-4 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <h3 id="weavra-evidence-heading" className="text-sm font-medium">
              증거 요약
            </h3>
            {evidence ? (
              <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  [
                    "수용 기준",
                    `${evidence.criteria.met}개 충족 · ${evidence.criteria.notMet}개 미충족 · ${evidence.criteria.unknown}개 미확인 / ${evidence.criteria.total}`,
                  ],
                  [
                    "현재 revision의 검사",
                    `${evidence.currentChecks.passed}개 통과 · ${evidence.currentChecks.failed}개 실패 · ${evidence.currentChecks.unavailable}개 확인 불가 · ${evidence.currentChecks.skipped}개 건너뜀 / ${evidence.currentChecks.total}`,
                  ],
                  [
                    "검토",
                    evidence.review
                      ? `${evidence.review.result} · 독립 검토: ${evidence.review.independent}`
                      : "UNKNOWN",
                  ],
                  [
                    "기록된 worker / 도구 호출",
                    `${evidence.workers.count} / ${evidence.workers.toolCalls}`,
                  ],
                  ["보고된 토큰", unknown(evidence.workers.reportedTokens)],
                  [
                    "검토 담당 참고 자료",
                    `${evidence.reviewerContexts.count} / ${evidence.reviewerContexts.bytes} bytes`,
                  ],
                  ["실패 분류", unknown(evidence.failureCategory)],
                  [
                    "이전 계약의 수용 상태",
                    evidence.legacyAcceptanceUnknown ? "확인 안 됨" : "현재 계약",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted-foreground">{label}</dt>
                    <dd className="mt-1 text-xs">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">
                증거를 확인할 수 없어요. PASS나 수용 판정을 추정하지 않아요.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              요약만 표시해요. 프롬프트·추론·인증 정보·대화 기록·소스·문서 본문·도구 원문은 전송하지
              않아요.
            </p>
          </section>
          <div className="space-y-2 border-t border-border/50 pt-4 text-xs">
            <h3 className="text-sm font-medium">프로젝트 설정 요약</h3>
            {stale ? (
              <p className="text-muted-foreground">
                현재 설정을 확인할 수 없어요. 다시 연결하고 새 스냅샷을 기다려 주세요.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground">
                  현재 프로젝트 설정이며 이 Run에서 확정한 설정은 아니에요.
                </p>
                <p>
                  상태: {unknown(snapshot?.data.configuration.status)} · 등록된 검사:{" "}
                  {unknown(snapshot?.data.configuration.registeredCheckCount)} · 필수 검사:{" "}
                  {unknown(snapshot?.data.configuration.requiredCheckCount)}
                </p>
                {snapshot?.data.configuration.modes && (
                  <dl className="grid grid-cols-2 gap-2">
                    {Object.entries(snapshot.data.configuration.modes).map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-muted-foreground">{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </>
            )}
          </div>
        </SettingsGroup>
      </SettingsSection>
      <WeavraFitness
        key={`fitness:${environmentId}:${projectId}:${workspaceRoot}`}
        environmentId={environmentId}
        projectId={projectId}
      />
    </>
  );
}
