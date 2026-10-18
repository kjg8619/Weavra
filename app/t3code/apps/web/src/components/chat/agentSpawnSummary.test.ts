import { describe, expect, it } from "vite-plus/test";
import type { RuntimeSubagent } from "@t3tools/client-runtime/state/subagentRuntime";
import { deriveAgentSpawnSummary } from "./agentSpawnSummary";

const batch = (status: RuntimeSubagent["status"]) => ({ kind: "subagent_batch" as const, status });
const agent = (status: RuntimeSubagent["status"]) => ({ kind: "subagent" as const, status });

describe("deriveAgentSpawnSummary", () => {
  it("counts a native batch without claiming the number of children", () => {
    expect(deriveAgentSpawnSummary({ agents: [batch("running")], agentCount: 1 })).toEqual({
      live: true,
      lead: "하위 에이전트 배치 1개 실행",
      status: "1개 작업 중",
      tone: "working",
    });
    expect(deriveAgentSpawnSummary({ agents: [batch("idle")], agentCount: 1 })).toEqual({
      live: false,
      lead: "하위 에이전트 배치 1개 실행",
      status: "1개 대기",
      tone: "inactive",
    });
  });

  it("keeps individual agents and batches separate in a mixed group", () => {
    expect(
      deriveAgentSpawnSummary({
        agents: [agent("running"), batch("running"), batch("idle")],
        agentCount: 3,
      }).lead,
    ).toBe("하위 에이전트 1개, 배치 2개 실행");
  });

  it.each([
    ["idle", "1개 대기", "inactive"],
    ["cancelled", "1개 중지됨", "inactive"],
    ["interrupted", "1개 중지됨", "inactive"],
    ["failed", "1개 실패", "failed"],
    ["completed", "✓ 완료", "completed"],
  ] as const)("reports %s accurately alongside a completed agent", (state, status, tone) => {
    expect(
      deriveAgentSpawnSummary({ agents: [agent("completed"), agent(state)], agentCount: 2 }),
    ).toMatchObject({ live: false, status, tone });
  });

  it("does not claim completion when the roster is missing a member", () => {
    expect(deriveAgentSpawnSummary({ agents: [agent("completed")], agentCount: 2 })).toMatchObject({
      status: "상태를 확인할 수 없어요",
      tone: "inactive",
    });
  });

  it("keeps a workflow active between child launches", () => {
    expect(
      deriveAgentSpawnSummary({
        agents: [agent("completed")],
        agentCount: 1,
        coordinatorStatus: "running",
      }),
    ).toMatchObject({ live: true, status: "작업 중", tone: "working" });
  });

  it.each([
    ["failed", "워크플로 실패", "failed"],
    ["cancelled", "워크플로 중지됨", "inactive"],
  ] as const)(
    "preserves a %s workflow outcome when its children completed",
    (coordinatorStatus, status, tone) => {
      expect(
        deriveAgentSpawnSummary({ agents: [agent("completed")], agentCount: 1, coordinatorStatus }),
      ).toMatchObject({ live: false, status, tone });
    },
  );
});
