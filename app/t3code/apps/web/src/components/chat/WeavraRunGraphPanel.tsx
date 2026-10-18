import { useAtomValue } from "@effect/atom-react";
import { useParams } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { EnvironmentId, ProjectId, WeavraSnapshotEnvelope } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEnvironment } from "../../state/environments";
import { observations } from "../../state/weavraObservations";
import { cn } from "../../lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { resolveThreadRouteRef } from "../../threadRoutes";
import { Badge } from "../ui/badge";
import { weavraLabel } from "../weavraLabels";
import { GRAPH_CARD, layoutWeavraRunGraph, type WeavraRunGraph } from "./weavraRunGraphLayout";

const dot: Record<GraphStatus, string> = {
  pending: "bg-muted-foreground/50",
  running: "bg-sky-400 shadow-[0_0_6px] shadow-sky-400",
  waiting_approval: "bg-amber-400 shadow-[0_0_6px] shadow-amber-400",
  passed: "bg-emerald-400",
  failed: "bg-red-400",
  blocked: "bg-red-400",
  revised: "bg-violet-400",
  cancelled: "bg-muted-foreground/50",
  skipped: "bg-muted-foreground/30",
  unknown: "bg-muted-foreground/30",
};
const text: Record<GraphStatus, string> = {
  pending: "text-muted-foreground",
  running: "text-sky-500 dark:text-sky-400",
  waiting_approval: "text-amber-600 dark:text-amber-400",
  passed: "text-emerald-600 dark:text-emerald-400",
  failed: "text-red-600 dark:text-red-400",
  blocked: "text-red-600 dark:text-red-400",
  revised: "text-violet-600 dark:text-violet-400",
  cancelled: "text-muted-foreground",
  skipped: "text-muted-foreground",
  unknown: "text-muted-foreground",
};
type GraphStatus = WeavraRunGraph["nodes"][number]["status"];
type FailureCategory = NonNullable<
  NonNullable<WeavraSnapshotEnvelope["data"]["evidence"]>["failureCategory"]
>;
const failureCategoryLabels: Record<FailureCategory, string> = {
  PREFLIGHT: "사전 점검 실패",
  POLICY: "정책 위반",
  PROVIDER: "모델 제공자 오류",
  TOOL: "도구 오류",
  BUDGET: "예산 초과",
  VERIFICATION: "검증 실패",
  REVIEW: "검토 차단",
  APPROVAL: "승인 거절",
  STORAGE: "저장 오류",
  CLEANUP: "정리 실패",
  CANCELLED: "취소됨",
  UNKNOWN: "원인 확인 안 됨",
};

/** A terminal failed Run: the Host summary carries a category at most, never the reason text. */
interface GraphFailure {
  summary: string | null;
  openResult: (() => void) | null;
}

function FailureResultLink({ openResult }: { openResult: GraphFailure["openResult"] }) {
  return openResult ? (
    <button
      type="button"
      data-weavra-action="graph-open-task-result"
      className="block max-w-full truncate text-left font-mono text-red-600 underline underline-offset-2 hover:text-red-500 dark:text-red-400"
      // The viewport captures mouse pointers for dragging, which would swallow this click.
      onPointerDown={(event) => event.stopPropagation()}
      onClick={openResult}
    >
      실패 이유는 결과 화면에서 확인
    </button>
  ) : (
    <span className="font-mono text-muted-foreground">실패 이유는 결과 화면에서 확인해요</span>
  );
}

function GraphView({ graph, failure }: { graph: WeavraRunGraph; failure: GraphFailure | null }) {
  const viewport = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const { cards, columns, links, otherEdges, width, height } = layoutWeavraRunGraph(
    graph,
    Number.POSITIVE_INFINITY,
  );
  const current = cards.find(
    (card) => card.node.status === "running" || card.node.status === "waiting_approval",
  );
  const currentX = current?.x;
  const completionId = failure
    ? cards.findLast((card) => card.node.kind === "completion")?.node.id
    : undefined;
  useEffect(() => {
    const element = viewport.current;
    if (element && currentX !== undefined)
      element.scrollLeft = Math.max(0, currentX - GRAPH_CARD.columnGap);
  }, [currentX]);
  const done = cards.filter((card) => card.node.status === "passed").length;
  const active = cards.filter(
    (card) => card.node.status === "running" || card.node.status === "waiting_approval",
  ).length;
  return (
    <>
      <p className="font-mono text-[11px] text-muted-foreground">
        {done}/{cards.length} 통과 · {active} 진행 중
      </p>
      <div
        ref={viewport}
        tabIndex={0}
        aria-label="Run 단계 그래프. 드래그하거나 스크롤해서 이동해요."
        className="mt-3 max-h-[70vh] cursor-grab touch-pan-x touch-pan-y overflow-auto rounded-md border border-border/60 bg-muted/20 p-3 select-none focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing"
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse" || event.button !== 0) return;
          const element = event.currentTarget;
          drag.current = {
            x: event.clientX,
            y: event.clientY,
            left: element.scrollLeft,
            top: element.scrollTop,
          };
          element.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start) return;
          event.currentTarget.scrollLeft = start.left - (event.clientX - start.x);
          event.currentTarget.scrollTop = start.top - (event.clientY - start.y);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      >
        <div className="relative" style={{ width, height }}>
          <div className="contents">
            {columns.map((column) => (
              <div
                key={column.key}
                className={cn(
                  "absolute border-b pb-1 font-mono text-[10px] text-muted-foreground",
                  column.running > 0 ? "border-sky-500 text-foreground" : "border-transparent",
                )}
                style={{ left: column.x, top: column.y, width: GRAPH_CARD.width }}
              >
                {column.key.startsWith("wave:")
                  ? `웨이브 ${column.key.slice(5)}`
                  : weavraLabel(column.key)}{" "}
                · {column.passed}/{column.total} 통과
                {column.running > 0 ? ` · ${column.running} 진행 중` : ""}
              </div>
            ))}
          </div>
          <div className="contents">
            <svg
              aria-hidden
              className="pointer-events-none absolute inset-0 overflow-visible"
              width={width}
              height={height}
            >
              {links.map(({ edge, path, backward }) => (
                <path
                  key={`${edge.from}->${edge.to}:${edge.kind}`}
                  d={path}
                  fill="none"
                  strokeWidth={1.25}
                  strokeDasharray={backward || edge.kind === "revise" ? "4 3" : undefined}
                  className={
                    edge.kind === "revise"
                      ? "stroke-violet-500/80"
                      : "stroke-emerald-500/60 dark:stroke-emerald-400/60"
                  }
                />
              ))}
            </svg>
            <ol className="contents">
              {cards.map(({ node, children, x, y }) => (
                <li
                  key={node.id}
                  data-weavra-graph-node={node.id}
                  data-status={node.status}
                  aria-current={
                    node.status === "running" || node.status === "waiting_approval"
                      ? "step"
                      : undefined
                  }
                  className={cn(
                    "absolute overflow-hidden rounded-md border bg-card px-2.5 py-2 text-[11px] shadow-xs",
                    node.status === "running" || node.status === "waiting_approval"
                      ? "border-sky-500/70"
                      : "border-border",
                  )}
                  style={{ left: x, top: y, width: GRAPH_CARD.width, height: GRAPH_CARD.height }}
                >
                  <div className="flex items-center gap-1.5 font-medium">
                    <span className={cn("size-1.5 shrink-0 rounded-full", dot[node.status])} />
                    <span className="truncate">
                      {node.kind === "task"
                        ? node.id.replace(/^task:/, "")
                        : weavraLabel(node.stepId ?? node.id)}
                      {node.attempt !== undefined ? ` #${node.attempt}` : ""}
                    </span>
                  </div>
                  <p className={cn("mt-0.5 truncate font-mono", text[node.status])}>
                    {weavraLabel(node.status)}
                    {failure && node.id === completionId && failure.summary
                      ? ` · ${failure.summary}`
                      : ""}
                  </p>
                  {failure && node.id === completionId ? (
                    <FailureResultLink openResult={failure.openResult} />
                  ) : (
                    <p className="truncate font-mono text-muted-foreground">
                      {[
                        node.role,
                        ...children.map((c) => `${weavraLabel(c.kind)} ${weavraLabel(c.status)}`),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
      {failure && completionId === undefined ? (
        <p data-weavra="run-graph-failure" className="mt-3 text-xs">
          {failure.summary ? (
            <span className="mr-2 text-red-600 dark:text-red-400">{failure.summary}</span>
          ) : null}
          <FailureResultLink openResult={failure.openResult} />
        </p>
      ) : null}
      {otherEdges.length > 0 ? (
        <ul aria-label="그 밖의 관계" className="mt-3 space-y-1 text-xs text-muted-foreground">
          {otherEdges.map((edge) => (
            <li key={`${edge.from}->${edge.to}:${edge.kind}`} className="break-all">
              <code>{edge.from}</code> → <code>{edge.to}</code> · {weavraLabel(edge.kind)}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}

export function WeavraRunGraphPanel(props: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  workspaceRoot: string;
}) {
  const result = useAtomValue(
    observations.stateAtom(props.environmentId, props.projectId, props.workspaceRoot),
  );
  const environment = useEnvironment(props.environmentId);
  const view = Option.getOrUndefined(AsyncResult.value(result));
  const snapshot = view?.observation?.snapshot;
  const graph = snapshot?.data.graph ?? null;
  const run = snapshot?.data.status.run;
  const stale = environment?.connection.phase !== "connected" || view?.observation?.stale !== false;
  // Task results live in the thread's control surface, which exists only for server threads.
  const routeEnvironmentId = useParams({
    strict: false,
    select: (params) => params.environmentId,
  });
  const routeThreadId = useParams({ strict: false, select: (params) => params.threadId });
  const threadRef = resolveThreadRouteRef({
    environmentId: routeEnvironmentId,
    threadId: routeThreadId,
  });
  const evidence = snapshot?.data.evidence;
  const category =
    graph && evidence?.runId === graph.runId ? (evidence.failureCategory ?? null) : null;
  const failure: GraphFailure | null =
    graph && (graph.status === "BLOCKED" || graph.status === "FAILED")
      ? {
          summary: category ? failureCategoryLabels[category] : null,
          openResult: threadRef
            ? () => useRightPanelStore.getState().open(threadRef, "control")
            : null,
        }
      : null;
  return (
    <div
      role="region"
      aria-label="Weavra Run 그래프"
      data-weavra="run-graph"
      className="min-h-0 flex-1 overflow-y-auto p-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium">Run 그래프</h2>
        <Badge variant={stale ? "warning" : "secondary"}>
          {snapshot ? (stale ? "과거 스냅샷" : "공식 스냅샷") : "스냅샷 없음"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Runtime이 기록한 단계와 관계를 보여주는 보기 전용 그래프예요. 여기서 실행·승인·재시도는 하지
        않아요.
      </p>
      {run ? (
        <p className="mt-2 text-xs">
          {run.workflow} / {run.risk} · {weavraLabel(run.status)}
        </p>
      ) : null}
      <div className="mt-3">
        {view?.support === "unsupported" ? (
          <p className="text-sm text-muted-foreground">
            이 환경은 통제 작업의 읽기 전용 연결을 지원하지 않아요.
          </p>
        ) : graph ? (
          <GraphView graph={graph} failure={failure} />
        ) : (
          <p className="text-sm text-muted-foreground">
            {snapshot && !run
              ? "이 프로젝트에 아직 Weavra Run이 없어요. 통제 작업을 실행하면 단계가 여기에 그려져요."
              : "그래프를 확인할 수 없어요. 이벤트나 캐시 조각으로 그래프를 재구성하지 않아요."}
          </p>
        )}
      </div>
    </div>
  );
}
