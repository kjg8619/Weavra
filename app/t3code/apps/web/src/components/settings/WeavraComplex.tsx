import { weavraLabel } from "../weavraLabels";
import type {
  WeavraComplexExecution,
  WeavraComplexPlan,
  WeavraControlState,
} from "@t3tools/contracts";
import { Badge } from "../ui/badge";

type Run = NonNullable<WeavraControlState["snapshot"]["status"]["run"]>;
type Row = WeavraComplexExecution["tasks"][number];
const known = (value: number | null) => (value === null ? "확인 안 됨" : String(value));
/** Contract v1 plans have no parallel limit: they run one task at a time. */
const maxParallelOf = (plan: WeavraComplexPlan) =>
  plan.schemaVersion === 2 ? plan.limits.maxParallel : 1;
/** What a Runtime-reported status or failure means; never a transition the App makes. */
const statusNote: Partial<Record<Row["status"], string>> = {
  HANDED_OFF: "구현을 마치고 검증 차례를 기다리고 있어요. 계획 순서대로 하나씩 검증해요.",
  STOPPING: "Run과 함께 중단 중이며 실행 중인 모든 작업의 종료를 기다리고 있어요.",
};
const failureNote: Partial<Record<NonNullable<Row["failureCode"]>, string>> = {
  RUN_STOPPED: "다른 작업이 실패했거나 Run이 중단되어 멈췄어요",
  CANCELLED: "Run과 함께 취소됐어요",
  OWNER_LOST: "Runtime 소유 프로세스가 종료됐어요. 자동 재개는 없어요",
};

/** Read-only frozen COMPLEX plan. Display only: nothing here schedules, edits or verifies work. */
export function ComplexPlanView({
  plan,
  criteria,
}: {
  plan: WeavraComplexPlan;
  criteria: ReadonlyArray<{ id: string; statement: string }>;
}) {
  const statements = new Map(criteria.map((criterion) => [criterion.id, criterion.statement]));
  const maxParallel = maxParallelOf(plan);
  return (
    <div className="space-y-3 text-xs">
      <dl className="grid gap-2 sm:grid-cols-2">
        {[
          ["Plan", plan.planId],
          ["계획 digest", plan.complexPlanDigest],
          ["상위 작업 계약", plan.parentTaskId],
          ["상위 digest", plan.parentTaskContractDigest],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      <ol aria-label="순서가 정해진 COMPLEX 작업" className="space-y-2">
        {plan.tasks.map((task) => (
          <li key={task.id} className="space-y-1 rounded-md border border-border p-3">
            <p className="font-medium">
              {task.id} · {task.title}
            </p>
            <p className="whitespace-pre-wrap break-words">{task.goal}</p>
            <p>선행 작업: {task.dependsOn.join(", ") || "없음"}</p>
            <ul className="space-y-0.5">
              {task.criterionIds.map((id) => (
                <li key={id} className="break-words">
                  {id} · {statements.get(id) ?? "설명 확인 불가"}
                </li>
              ))}
            </ul>
            <p className="break-all">
              정확한 파일 담당 범위:{" "}
              {task.ownership.length === 0
                ? "없음(읽기 전용 작업)"
                : task.ownership.map((claim) => `${claim.operation} ${claim.path}`).join(", ")}
            </p>
            <p>
              작업 검사: {task.checkIds.join(", ")} · 작업별 수정 횟수 ≤ {task.maxRevisionCycles}
            </p>
          </li>
        ))}
      </ol>
      <p>
        통합 검증: 수용 기준 {plan.integration.criterionIds.join(", ")} · 모든 등록 검사{" "}
        {plan.integration.checkIds.join(", ")} · 독립적인 최종 검토와 새 최종 검사가 필요해요.
      </p>
      <p>
        한도: {plan.limits.maxTasks} 개 작업 · {plan.limits.maxWorkerInvocations} 회 worker 호출 ·{" "}
        {plan.limits.maxReportedTokens} 개 프로바이더 보고 토큰 ·{" "}
        {plan.limits.maxTotalRevisionCycles} 회 전체 수정
        {plan.schemaVersion === 2
          ? ` · 최대 ${maxParallel}개 작업 동시 구현(Runtime 설정, 읽기 전용)`
          : ""}
        .
      </p>
      <p className="text-muted-foreground">
        {maxParallel > 1
          ? `선행 작업이 COMPLETED인 작업을 최대 ${maxParallel}개씩 함께 구현하고 이 순서대로 하나씩 검사·검토해요. 모두 하나의 Runtime 소유 Run에서 진행해요.`
          : "하나의 Runtime 소유 Run에서 이 순서대로 하나씩 진행해요."}{" "}
        파일 담당 범위는 책임을 제한해요. 파일 접근 권한·Policy ALLOW·승인은 아니에요.
      </p>
    </div>
  );
}

/** Read-only COMPLEX execution projection; the snapshot Run status stays the only outcome. */
export function ComplexExecutionView({
  execution,
  run,
  current,
  owned,
  observedAt,
  writerPresent,
  cancelling,
}: {
  execution: WeavraComplexExecution;
  run: Run;
  current: boolean;
  owned: boolean;
  observedAt: number | null;
  writerPresent: boolean | null;
  cancelling: boolean;
}) {
  const tasks = new Map(execution.plan.tasks.map((task) => [task.id, task]));
  const completed = execution.tasks.filter((task) => task.status === "COMPLETED").length;
  const allTasksCompleted = completed === execution.tasks.length;
  const { integration, budget, plan } = execution;
  // Wave membership is only what the Runtime reports; nothing is inferred from dependencies.
  const wave = execution.schemaVersion === 2 ? execution.activeTaskIds : null;
  const label = (id: string) => `${id} · ${tasks.get(id)?.title ?? "작업 미확인"}`;
  return (
    <section
      aria-label="COMPLEX 실행"
      className="space-y-3 rounded-md border border-border p-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-medium">COMPLEX 실행 · Runtime 제공 상태</h4>
        <div className="flex flex-wrap gap-2">
          <Badge variant={current ? "info" : "warning"}>
            {current ? "현재 관찰" : "과거 정보 · 현재 상태 아님"}
          </Badge>
          {!owned && <Badge variant="outline">표시 전용 · 소유하지 않음</Badge>}
        </div>
      </div>
      {!current && (
        <p>
          마지막으로 확인한 관찰:{" "}
          {observedAt === null ? "시각 미확인" : new Date(observedAt).toLocaleString()}. 과거
          데이터는 현재 실행 상태가 아니며 동작을 허용하지 않아요.
        </p>
      )}
      <p>
        공식 Run 결과: <strong>{weavraLabel(run.status)}</strong> · 단계{" "}
        {weavraLabel(execution.phase)}
        {execution.schemaVersion === 1 ? ` · 활성 작업 ${execution.activeTaskId ?? "없음"}` : ""}
      </p>
      {wave !== null && (
        <p>
          Runtime이 보고한 현재 병렬 작업 묶음:{" "}
          {wave.length === 0 ? "없음" : wave.map(label).join(", ")} · 최대 {maxParallelOf(plan)}{" "}
          개를 동시에 구현하며 검사와 검토는 하나씩 진행해요.
        </p>
      )}
      {(cancelling || execution.phase === "STOPPING") && (
        <p>
          {`${cancelling ? "취소 요청됨" : "중단 중"}: Runtime이 모든 활성 작업을 멈추고 종료를 확인한 뒤 결과를 기록해요. 정리 상태: ${execution.cleanup}.`}
        </p>
      )}
      <p>
        완료한 개별 작업: {completed} / {execution.tasks.length}.{" "}
        {allTasksCompleted && run.status !== "COMPLETED"
          ? "개별 작업 완료는 Run 완료가 아니에요. 새 통합 검사·독립적인 최종 검토·새 최종 검사와 Kernel 판정이 필요해요."
          : "개별 작업 완료는 Run 완료가 아니에요. 위의 공식 Run 상태만 결과로 판단해요."}
      </p>
      <ol aria-label="COMPLEX 작업 상태" className="space-y-2">
        {execution.tasks.map((task) => (
          <li key={task.id} className="space-y-1 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">{label(task.id)}</span>
              <div className="flex flex-wrap gap-2">
                {wave?.includes(task.id) && <Badge variant="outline">현재 병렬 묶음</Badge>}
                <Badge variant="outline">{weavraLabel(task.status)}</Badge>
              </div>
            </div>
            {statusNote[task.status] && <p>{statusNote[task.status]}</p>}
            <p>선행 작업: {tasks.get(task.id)?.dependsOn.join(", ") || "없음"}</p>
            <p>
              시도 {task.attempt} · 작업별 수정 횟수 {task.revisionCycle} · worker 호출{" "}
              {task.workerInvocations} · 보고된 토큰 {known(task.reportedTokens)}
            </p>
            <p>
              자체 검사 {task.selfCheck} · 검토 {task.review} · 테스트 {task.test} · 증거{" "}
              {task.evidenceFreshness}
              {task.status === "COMPLETED" && task.evidenceFreshness !== "CURRENT"
                ? " (과거 작업 기록이며 현재 완료 증거가 아니에요)"
                : ""}
            </p>
            <p className="break-all">
              변경 파일: {task.changedFiles.join(", ") || "기록 없음"}
              {task.changesUnknown ? " · 추가 변경 미확인" : ""}
            </p>
            {task.failureCode && (
              <p>
                실패: {task.failureCode}
                {failureNote[task.failureCode] ? ` — ${failureNote[task.failureCode]}` : ""}
              </p>
            )}
          </li>
        ))}
      </ol>
      <dl className="grid gap-2 sm:grid-cols-2">
        {[
          [
            "Integration",
            `검사 ${integration.check} · 최종 검토 ${integration.review} · 최종 테스트 ${integration.test} · 증거 ${integration.evidenceFreshness}`,
          ],
          ["통합 작업 공간", integration.workspaceDigest ?? "수집되지 않음"],
          ["통합 실패", integration.failureCode ?? "없음"],
          ["worker 호출", `${budget.workerInvocations} / ${plan.limits.maxWorkerInvocations}`],
          [
            "프로바이더가 보고한 토큰",
            `${known(budget.reportedTokens)} / ${plan.limits.maxReportedTokens}`,
          ],
          [
            "전체 작업 횟수(revision)",
            `${budget.totalRevisionCycles} / ${plan.limits.maxTotalRevisionCycles}`,
          ],
          ["Budget", budget.status],
          [
            "정리 상태 / 쓰기 잠금 존재",
            `${execution.cleanup} / ${writerPresent === null ? "UNKNOWN" : String(writerPresent)}`,
          ],
          [
            "작업 공간 변경",
            `${execution.partialChanges ? "일부 변경 보존됨" : "일부 변경 보고 없음"}${execution.changesUnknown ? " · 변경 집합 미확인" : ""}`,
          ],
          ["Run 실패", execution.failureCode ?? "없음"],
          ["상위 작업 계약", `${execution.parent.id} · ${execution.parent.status}`],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="mt-1 break-all">{value}</dd>
          </div>
        ))}
      </dl>
      {execution.cleanup === "UNCONFIRMED" && (
        <p>
          정리가 확인되지 않아 직접 점검할 때까지 쓰기 잠금을 유지해요. 자동 재개·정리
          재시도·되돌리기는 없어요.
        </p>
      )}
      <p className="text-muted-foreground">
        완료한 작업을 포함해 일부 변경을 자동으로 되돌리지 않아요. 계획이 확정돼 있어 이 화면에서
        작업을 재시도·건너뛰기·순서 변경·완료 처리할 수 없어요.
      </p>
      <ComplexPlanView plan={plan} criteria={execution.parent.acceptanceCriteria} />
    </section>
  );
}
