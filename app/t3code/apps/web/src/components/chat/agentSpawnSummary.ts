import {
  isActiveSubagentStatus,
  isTerminalSubagentStatus,
  type RuntimeSubagent,
} from "@t3tools/client-runtime/state/subagentRuntime";

/** Summarize observed states without treating idle or missing agents as completed. */
export function deriveAgentSpawnSummary({
  agents,
  agentCount,
  coordinatorStatus,
}: {
  agents: ReadonlyArray<Pick<RuntimeSubagent, "kind" | "status">>;
  agentCount: number;
  coordinatorStatus?: RuntimeSubagent["status"] | undefined;
}) {
  const working = agents.filter((agent) => isActiveSubagentStatus(agent.status)).length;
  const failed = agents.filter((agent) => agent.status === "failed").length;
  const idle = agents.filter((agent) => agent.status === "idle").length;
  const stopped = agents.filter(
    (agent) => agent.status === "cancelled" || agent.status === "interrupted",
  ).length;
  const batches = agents.filter((agent) => agent.kind === "subagent_batch").length;
  const individuals = agentCount - batches;
  // Workflow coordinators can keep running between dynamic member launches.
  const live =
    coordinatorStatus !== undefined ? !isTerminalSubagentStatus(coordinatorStatus) : working > 0;
  const subjects = [
    individuals > 0 ? `하위 에이전트 ${individuals}개` : null,
    batches > 0 ? `${individuals > 0 ? "" : "하위 에이전트 "}배치 ${batches}개` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const lead = `${subjects || "하위 에이전트"} ${batches > 0 ? "실행" : live ? "시작" : "실행 완료"}`;

  const status = live
    ? working > 0
      ? `${working}개 작업 중`
      : "작업 중"
    : coordinatorStatus === "failed"
      ? "워크플로 실패"
      : coordinatorStatus === "cancelled" || coordinatorStatus === "interrupted"
        ? "워크플로 중지됨"
        : failed > 0
          ? `${failed}개 실패`
          : stopped > 0
            ? `${stopped}개 중지됨`
            : idle > 0
              ? `${idle}개 대기`
              : coordinatorStatus !== "completed" &&
                  (agents.length === 0 || agents.length < agentCount)
                ? "상태를 확인할 수 없어요"
                : "✓ 완료";
  const tone = live
    ? "working"
    : failed > 0 || coordinatorStatus === "failed"
      ? "failed"
      : status === "✓ 완료"
        ? "completed"
        : "inactive";
  return { live, lead, status, tone };
}
