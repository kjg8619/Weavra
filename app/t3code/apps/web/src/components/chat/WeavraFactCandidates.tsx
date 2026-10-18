import { useAtomValue } from "@effect/atom-react";
import {
  createEnvironmentWeavraControlCommand,
  createEnvironmentWeavraControlStateAtoms,
} from "@t3tools/client-runtime/state/weavraControl";
import {
  type EnvironmentId,
  type ProjectId,
  type WeavraFactCandidate,
  WeavraControlMutation,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { connectionAtomRuntime } from "../../connection/runtime";
import { requestConfirmDialog } from "../../confirmDialog";
import { randomUUID } from "../../lib/utils";
import { useEnvironment } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";

const observations = createEnvironmentWeavraControlStateAtoms(connectionAtomRuntime);
const command = createEnvironmentWeavraControlCommand(connectionAtomRuntime);
const decodeMutation = Schema.decodeUnknownSync(WeavraControlMutation, {
  onExcessProperty: "error",
});
const DISMISSED_LIMIT = 64;

export function dismissedCandidatesKey(environmentId: EnvironmentId, projectId: ProjectId) {
  return `weavra:fact-candidates:dismissed:v1:${JSON.stringify([environmentId, projectId])}`;
}
function readDismissed(key: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(key) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}
function writeDismissed(key: string, ids: readonly string[]) {
  try {
    if (ids.length === 0) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, JSON.stringify(ids));
  } catch {
    // Storage blocked: hiding still applies until the next reload.
  }
}

type Status = { candidateId: string | null; message: string } | null;

/**
 * Rule suggestions the Runtime derived from failed Runs ("facts.candidates"). Nothing is written
 * here: "확인" runs the reviewed-fact consent flow (facts.prepare, explicit dialog, facts.confirm)
 * and "무시" only hides the row in this browser. Absent the `factCandidates` advertisement the
 * section does not exist.
 */
export function WeavraFactCandidates({
  environmentId,
  projectId,
  workspaceRoot,
}: {
  environmentId: EnvironmentId;
  projectId: ProjectId;
  workspaceRoot: string;
}) {
  const view = Option.getOrUndefined(
    AsyncResult.value(
      useAtomValue(observations.stateAtom(environmentId, projectId, workspaceRoot)),
    ),
  );
  const environment = useEnvironment(environmentId);
  const invoke = useAtomCommand(command, { reportFailure: false, reportDefect: false });
  const observation = view?.observation;
  const state = observation?.state ?? null;
  const exposed = observation?.capabilities?.factCandidates === 1;
  const fresh =
    environment?.connection.phase === "connected" &&
    view?.support === "supported" &&
    observation?.status === "CONNECTED" &&
    !observation.stale &&
    state !== null;
  const run = state?.snapshot.status.run ?? null;
  const runActive = ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run?.status ?? "");
  const readKey =
    exposed && fresh && state
      ? JSON.stringify([
          state.ownerId,
          state.projectRevision,
          state.stateRevision,
          run?.runId ?? null,
          run?.status ?? null,
        ])
      : null;
  const [loaded, setLoaded] = useState<{
    key: string;
    candidates: readonly WeavraFactCandidate[];
    error: string | null;
  } | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [submitting, setSubmitting] = useState(false);
  const storageKey = dismissedCandidatesKey(environmentId, projectId);
  const [dismissedState, setDismissedState] = useState(() => ({
    key: storageKey,
    ids: readDismissed(storageKey),
  }));
  const dismissed = new Set(
    dismissedState.key === storageKey ? dismissedState.ids : readDismissed(storageKey),
  );
  const saveDismissed = (ids: readonly string[]) => {
    writeDismissed(storageKey, ids);
    setDismissedState({ key: storageKey, ids });
  };
  const pending = useRef(false);
  const mounted = useRef(true);
  const latest = useRef({ fresh, state, observedAt: observation?.observedAt ?? null });
  useLayoutEffect(() => {
    latest.current = { fresh, state, observedAt: observation?.observedAt ?? null };
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (readKey === null || !state || loaded?.key === readKey || pending.current) return;
    pending.current = true;
    const request = decodeMutation({
      protocolVersion: 1,
      id: `facts-candidates:${randomUUID()}`,
      ownerId: state.ownerId,
      expectedProjectRevision: state.projectRevision,
      type: "facts.candidates",
    });
    void invoke({ environmentId, input: { projectId, request } })
      .then((result) => {
        if (!mounted.current) return;
        const response = AsyncResult.isSuccess(result) ? result.value : null;
        if (
          response?.success &&
          response.data.kind === "fact-candidates" &&
          response.data.projectRevision === request.expectedProjectRevision
        )
          setLoaded({ key: readKey, candidates: response.data.candidates, error: null });
        else
          setLoaded({
            key: readKey,
            candidates: [],
            error: response
              ? `규칙 후보를 불러오지 못했어요${response.success ? "" : `: ${response.error.code}`}.`
              : "통신 오류로 규칙 후보를 불러오지 못했어요.",
          });
      })
      .finally(() => {
        pending.current = false;
      });
  }, [readKey, state, loaded?.key, invoke, environmentId, projectId]);

  if (!exposed) return null;
  const current = loaded !== null && loaded.key === readKey ? loaded : null;
  const candidates = current?.candidates ?? [];
  const visible = candidates.filter((candidate) => !dismissed.has(candidate.id));
  const hiddenCount = candidates.length - visible.length;
  const canWrite =
    fresh &&
    !state?.busy &&
    state?.snapshot.status.writerPresent === false &&
    !runActive &&
    !submitting;

  const dismiss = (candidate: WeavraFactCandidate) => {
    saveDismissed([...dismissed, candidate.id].slice(-DISMISSED_LIMIT));
  };
  const restore = () => {
    saveDismissed(
      [...dismissed].filter((id) => !candidates.some((candidate) => candidate.id === id)),
    );
  };
  const confirm = async (candidate: WeavraFactCandidate) => {
    const before = latest.current;
    if (pending.current || !before.fresh || !before.state) return;
    pending.current = true;
    setSubmitting(true);
    const done = (message: string) => {
      if (mounted.current) setStatus({ candidateId: candidate.id, message });
    };
    try {
      let prepare: WeavraControlMutation;
      try {
        prepare = decodeMutation({
          protocolVersion: 1,
          id: before.state.nextRequestId,
          ownerId: before.state.ownerId,
          expectedProjectRevision: before.state.projectRevision,
          type: "facts.prepare",
          sourceRef: candidate.sourceRef,
          statement: candidate.statement,
        });
      } catch {
        return done(
          "이 후보의 근거는 사실 출처로 쓸 수 없어요. 프로젝트 설정에서 직접 기록해 주세요.",
        );
      }
      done("Runtime에 사실 검토를 요청하고 있어요.");
      const prepared = await invoke({ environmentId, input: { projectId, request: prepare } });
      if (!mounted.current) return;
      if (!AsyncResult.isSuccess(prepared))
        return done("통신 오류로 검토 결과를 확인할 수 없어요. 자동 재시도는 보내지 않았어요.");
      const response = prepared.value;
      if (!response.success)
        return done(`Runtime이 사실 검토를 거부했어요: ${response.error.code}.`);
      if (
        response.data.kind !== "fact-prepared" ||
        response.data.preview.statement !== candidate.statement
      )
        return done("Runtime이 다른 검토 결과를 반환해 기록하지 않았어요.");
      const preview = response.data.preview;
      done("명시적인 확인을 기다리고 있어요.");
      const approved = await requestConfirmDialog(
        `다음 대상에 검토한 참고용 사실을 기록할까요: ${workspaceRoot}?\n출처: ${preview.sourceRef}\ndigest: ${preview.sourceDigest}\n설명: ${preview.statement}\n설명이 출처로 뒷받침되며 비밀값·추론 원문·대화 기록·도구 출력을 포함하지 않는지 확인해 주세요. Policy·승인·검증·완료 판정이 아니에요.`,
      );
      if (!mounted.current) return;
      if (!approved) return done("기록하지 않았어요. 후보는 그대로 남아 있어요.");
      const after = latest.current;
      if (
        !after.fresh ||
        !after.state ||
        after.state.ownerId !== preview.ownerId ||
        after.state.projectRevision !== preview.projectRevision ||
        after.state.factPreview?.previewId !== preview.previewId ||
        after.state.factPreview.previewDigest !== preview.previewDigest ||
        (after.observedAt !== null && preview.expiresAt <= after.observedAt)
      )
        return done("Runtime 상태가 바뀌었어요. 새 상태를 검토한 뒤 다시 확인해 주세요.");
      const confirmed = await invoke({
        environmentId,
        input: {
          projectId,
          request: {
            protocolVersion: 1,
            id: after.state.nextRequestId,
            ownerId: after.state.ownerId,
            expectedProjectRevision: after.state.projectRevision,
            type: "facts.confirm",
            previewId: preview.previewId,
            previewDigest: preview.previewDigest,
          },
        },
      });
      if (!mounted.current) return;
      if (!AsyncResult.isSuccess(confirmed))
        return done("통신 오류로 기록 결과를 확인할 수 없어요. 새 Runtime 상태를 기다려 주세요.");
      if (!confirmed.value.success)
        return done(`Runtime이 기록을 거부했어요: ${confirmed.value.error.code}.`);
      done("검토한 사실로 기록했어요. Runtime의 공식 프로젝트 사실에서 확인할 수 있어요.");
    } finally {
      pending.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  if (!current?.error && visible.length === 0 && hiddenCount === 0) return null;
  return (
    <section
      aria-label="이번 실행에서 배운 규칙 후보"
      data-weavra="fact-candidates"
      className="my-4 min-w-0 space-y-3 rounded-[24px] border border-border/80 bg-card/70 p-4 sm:p-5"
    >
      <h3 className="text-sm font-medium">이번 실행에서 배운 규칙 후보</h3>
      <p className="text-xs text-muted-foreground">
        실패한 실행에서 Runtime이 뽑은 제안이에요. 확인하기 전에는 어디에도 기록되거나 작업에 쓰이지
        않아요.
      </p>
      {current?.error ? <p className="text-xs text-destructive">{current.error}</p> : null}
      <ul className="space-y-2">
        {visible.map((candidate) => (
          <li
            key={candidate.id}
            data-weavra="fact-candidate"
            className="min-w-0 space-y-2 rounded-lg border border-border bg-background p-3"
          >
            <p className="break-words text-sm">{candidate.statement}</p>
            <p className="break-all text-xs text-muted-foreground">근거: {candidate.evidenceRef}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                data-weavra-action="confirm-fact-candidate"
                disabled={!canWrite}
                onClick={() => void confirm(candidate)}
              >
                확인
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                data-weavra-action="dismiss-fact-candidate"
                disabled={submitting}
                onClick={() => dismiss(candidate)}
              >
                무시
              </Button>
            </div>
            {status?.candidateId === candidate.id ? (
              <p role="status" className="text-xs text-muted-foreground">
                {status.message}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {hiddenCount > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          data-weavra-action="restore-fact-candidates"
          onClick={restore}
        >
          {`숨긴 후보 ${hiddenCount}개 다시 보기`}
        </Button>
      ) : null}
    </section>
  );
}
