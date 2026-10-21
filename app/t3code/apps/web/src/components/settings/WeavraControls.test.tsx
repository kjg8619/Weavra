import type * as ControlState from "@t3tools/client-runtime/state/weavraControl";
import type * as React from "react";
import type { ComponentProps, ReactElement } from "react";
import {
  EnvironmentId,
  ProjectId,
  type WeavraBrowserCandidateSummary,
  type WeavraBrowserPreview,
  type WeavraBrowserState,
  type WeavraComplexDraft,
  type WeavraComplexExecutionV1,
  type WeavraComplexExecutionV2,
  type WeavraComplexPlanV1,
  type WeavraComplexPlanV2,
  type WeavraControlObservation,
  type WeavraControlPreview,
  type WeavraControlResponse,
  type WeavraControlState,
  type WeavraDerivedDraft,
  type WeavraFactPreview,
  type WeavraPlannerFailureCode,
  type WeavraPlannerStatus,
} from "@t3tools/contracts";
import { plannerRequestDigest } from "@t3tools/client-runtime/state/weavraControl";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";
import { ko } from "~/i18n/ko";
import { weavraLabel } from "../weavraLabels";

const data = vi.hoisted(() => ({
  observation: null as WeavraControlObservation | null,
  phase: "connected",
  support: "supported",
  invoke: vi.fn(),
  confirm: vi.fn(),
  cleanups: [] as Array<() => void>,
}));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof React>()),
  useState: hooks.useState,
  useRef: hooks.useRef,
  useMemo: hooks.useMemo,
  useCallback: hooks.useCallback,
  useLayoutEffect: (effect: () => void) => effect(),
  useEffect: (effect: () => () => void) => {
    if (data.cleanups.length === 0) data.cleanups.push(effect());
  },
}));
vi.mock("react/compiler-runtime", () => ({ c: hooks.useMemoCache }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: () => AsyncResult.success({ support: data.support, observation: data.observation }),
}));
// The pure Planner helpers stay real; only the connection-bound atoms are replaced.
vi.mock("@t3tools/client-runtime/state/weavraControl", async (importOriginal) => ({
  ...(await importOriginal<typeof ControlState>()),
  createEnvironmentWeavraControlStateAtoms: () => ({ stateAtom: () => "observation" }),
  createEnvironmentWeavraControlCommand: () => "command",
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: data.phase } }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => data.invoke }));
vi.mock("../../confirmDialog", () => ({
  requestConfirmDialog: (...args: unknown[]) => data.confirm(...args),
}));
vi.mock("../ui/badge", () => ({ Badge: "span" }));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/textarea", () => ({ Textarea: "textarea" }));
vi.mock("./SettingsGroup", () => ({ SettingsGroup: "div" }));
vi.mock("./settingsLayout", () => ({ SettingsSection: "section" }));
import { isValidElement } from "react";
import { WeavraControls } from "./WeavraControls";
import { ComplexExecutionView, ComplexPlanView } from "./WeavraComplex";
import { WeavraPreflightFailure } from "./WeavraPreflightFailure";

const environmentId = EnvironmentId.make("local-control");
const projectId = ProjectId.make("control-project");
const digest = `sha256:${"a".repeat(64)}`;
const preview: WeavraControlPreview = {
  previewId: "preview-1",
  previewDigest: digest,
  ownerId: "owner",
  projectRevision: 0,
  expiresAt: 9999999999999,
  goal: "Fix app bug",
  workflow: "STANDARD",
  executionMode: "EDIT",
  risk: "R1",
  allowedPaths: ["src"],
  checks: [{ id: "unit checks", kind: "test", required: true }],
  acceptanceCriteria: [
    {
      id: "AC-1",
      statement: "App produces the corrected result",
      checkIds: ["unit checks"],
      reviewRequired: true,
    },
  ],
  taskContractDigest: digest,
  recipe: null,
  configuration: {
    mutationMode: "strict",
    verifierTrustMode: "strict",
    verifierSandboxMode: "disabled",
    contextPackMode: "bounded",
    verificationRepairMode: "disabled",
    lspEnabled: false,
  },
};
function state(): WeavraControlState {
  return {
    ownerId: "owner",
    nextRequestId: "owner:1",
    projectRevision: 0,
    stateRevision: null,
    ownedRunId: null,
    busy: false,
    cancelling: false,
    startFailure: null,
    preview: null,
    browserPreview: null,
    factPreview: null,
    projectFacts: { status: "available", entries: [] },
    pendingApproval: null,
    snapshot: {
      status: {
        source: "durable-canonical-state",
        ownerObserved: false,
        state: "missing",
        writerPresent: false,
        run: null,
      },
      graph: null,
      graphAvailable: false,
      evidence: null,
      configuration: { source: "project-config-not-frozen-run-config", status: "missing" },
    },
  };
}
function update(patch: Partial<WeavraControlState>) {
  data.observation = { ...data.observation!, state: { ...data.observation!.state!, ...patch } };
}
function response(
  value: Extract<WeavraControlResponse, { success: true }>["data"],
): WeavraControlResponse {
  return {
    protocolVersion: 1,
    type: "control_response",
    id: "owner:1",
    command: "workflow.prepare",
    ownerId: "owner",
    runId: null,
    stateRevision: null,
    projectRevision: 0,
    eventId: null,
    timestamp: 1,
    success: true,
    data: value,
  };
}
function accepted(command: "workflow.confirm" | "workflow.cancel" | "approval.resolve") {
  data.invoke.mockResolvedValue(
    AsyncResult.success(
      response({
        kind: "accepted",
        requestId: "owner:2",
        command,
        runId: command === "workflow.confirm" ? null : "run-1",
      }),
    ),
  );
}
function render() {
  hooks.beginRender();
  return WeavraControls({
    environmentId,
    projectId,
    workspaceRoot: "/trusted/project",
  }) as ReactElement<Record<string, unknown>>;
}
function text(node: unknown): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(text).join(" ");
  if (node && typeof node === "object" && "props" in node)
    return text((node as ReactElement<Record<string, unknown>>).props.children);
  return "";
}
function control(tree: ReactElement<Record<string, unknown>>, label: string) {
  const element = visitElements(
    tree,
    (node) =>
      node.props["aria-label"] === label || (node.type === "button" && text(node) === label),
  );
  if (!element) throw new Error(`Missing control: ${label}`);
  return element;
}
function change(label: string, value: string) {
  (control(render(), label).props.onChange as (event: { target: { value: string } }) => void)({
    target: { value },
  });
}
async function flush() {
  for (let index = 0; index < 6; index++) await Promise.resolve();
}
async function click(label: string) {
  const button = control(render(), label);
  expect(button.props.disabled).not.toBe(true);
  (button.props.onClick as () => void)();
  await flush();
}
async function prepare() {
  change("워크플로 목표", preview.goal);
  const form = visitElements(render(), (node) => node.type === "form")!;
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
  await flush();
  update({ preview, nextRequestId: "owner:2" });
}
function running(waiting = false) {
  const base = state();
  update({
    busy: true,
    projectRevision: 9,
    stateRevision: 7,
    ownedRunId: "run-1",
    nextRequestId: "owner:2",
    snapshot: {
      ...base.snapshot,
      status: {
        ...base.snapshot.status,
        state: "available",
        writerPresent: true,
        run: {
          runId: "run-1",
          status: waiting ? "WAITING_APPROVAL" : "RUNNING",
          phase: "IMPLEMENT",
          workflow: "STANDARD",
          risk: waiting ? "R3" : "R1",
          executionMode: "EDIT",
          codeRevision: 0,
          currentStep: { stepId: "implement", attempt: 0 },
          activeAgentCount: 1,
          taskContractDigest: digest,
          createdAt: 1,
          updatedAt: 1,
        },
      },
    },
    pendingApproval: waiting
      ? {
          approvalId: "approval-1",
          runId: "run-1",
          stateRevision: 7,
          projectRevision: 9,
          risk: "R3",
          operation: "delete-file",
          role: "Developer",
          step: { stepId: "implement", attempt: 0 },
          path: "src/old.js",
          bytes: 4,
          preconditionDigest: "b".repeat(64),
          expiresAt: 9999999999999,
          explanation: "Delete exactly this tracked file",
        }
      : null,
  });
}

beforeEach(() => {
  hooks.reset();
  data.phase = "connected";
  data.support = "supported";
  data.cleanups = [];
  data.observation = {
    status: "CONNECTED",
    stale: false,
    state: state(),
    observedAt: 1,
    errorCode: null,
    capabilities: {
      authority: "Runtime/Kernel",
      control: "workflow-control-v1",
      ownerId: "owner",
      commands: [
        "control.hello",
        "control.snapshot",
        "workflow.prepare",
        "workflow.confirm",
        "workflow.cancel",
        "approval.resolve",
        "browser.inspect",
        "browser.prepare",
        "browser.confirm",
        "facts.prepare",
        "facts.confirm",
      ],
      maxRequestBytes: 32768,
      maxResponseBytes: 65536,
      resultLimit: 64,
      previewTtlMs: 300000,
      runtimeVersion: "0.85.1",
      readiness: "READY",
      recipes: [
        {
          id: "bug-fix",
          version: 1,
          title: "Bug fix",
          inputTemplate: '{"expected":"correct result"}',
        },
      ],
    },
  };
  data.invoke
    .mockReset()
    .mockResolvedValue(AsyncResult.success(response({ kind: "prepared", preview })));
  data.confirm.mockReset().mockResolvedValue(true);
});

const factPreview: WeavraFactPreview = {
  previewId: "fact-preview",
  previewDigest: digest,
  ownerId: "owner",
  projectRevision: 0,
  expiresAt: 9999999999999,
  sourceRef: "src/notes.txt",
  sourceDigest: digest,
  statement: "Reviewed statement",
};
async function prepareFact() {
  data.invoke.mockResolvedValue(
    AsyncResult.success(response({ kind: "fact-prepared", preview: factPreview })),
  );
  change("사실 출처", factPreview.sourceRef);
  change("사실 설명", factPreview.statement);
  const section = control(render(), "검토한 프로젝트 사실");
  const form = visitElements(section, (node) => node.type === "form")!;
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
  await flush();
  update({ factPreview, nextRequestId: "owner:2" });
}
describe("Reviewed Project Facts authority and freshness", () => {
  it("requires explicit review and waits for canonical validity rather than promoting an ACK", async () => {
    await prepareFact();
    data.confirm.mockResolvedValueOnce(false);
    await click("검토한 사실 확인");
    expect(data.invoke).toHaveBeenCalledTimes(1);
    data.invoke.mockResolvedValue(
      AsyncResult.success(response({ kind: "fact-confirmed", factId: "fact-1" })),
    );
    await click("검토한 사실 확인");
    expect(data.confirm).toHaveBeenLastCalledWith(
      expect.stringContaining(factPreview.sourceDigest),
    );
    expect(text(control(render(), "Runtime의 공식 프로젝트 사실"))).not.toContain(
      "Reviewed statement",
    );
    update({
      factPreview: null,
      projectFacts: {
        status: "available",
        entries: [
          {
            id: "fact-1",
            sourceRef: factPreview.sourceRef,
            sourceDigest: digest,
            reviewedAt: 1,
            status: "VALID",
            statement: factPreview.statement,
          },
        ],
      },
    });
    expect(text(control(render(), "Runtime의 공식 프로젝트 사실"))).toContain("Reviewed statement");
    update({
      projectFacts: {
        status: "available",
        entries: [
          {
            id: "fact-1",
            sourceRef: factPreview.sourceRef,
            sourceDigest: digest,
            reviewedAt: 1,
            status: "STALE",
            statement: null,
          },
        ],
      },
    });
    expect(text(control(render(), "Runtime의 공식 프로젝트 사실"))).not.toContain(
      "Reviewed statement",
    );
    expect(text(control(render(), "Runtime의 공식 프로젝트 사실"))).toContain("오래된 정보");
  });
  it("rejects changed drafts and disconnected observations across an outstanding confirmation modal", async () => {
    await prepareFact();
    let resolve!: (value: boolean) => void;
    data.confirm.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    await click("검토한 사실 확인");
    data.phase = "disconnected";
    render();
    resolve(true);
    await flush();
    expect(data.invoke).toHaveBeenCalledTimes(1);
    data.phase = "connected";
    change("사실 설명", "Changed after review");
    expect(
      visitElements(render(), (node) => node.props["aria-label"] === "Runtime 사실 미리보기"),
    ).toBeNull();
  });
});

describe("Weavra workflow control interactions", () => {
  it("prepares goal and optional recipe as data, then presents Runtime-owned plan and editable criteria", async () => {
    change("검토한 실행 절차", "bug-fix");
    expect(control(render(), "실행 절차 입력값").props.value).toBe('{"expected":"correct result"}');
    await prepare();
    expect(data.invoke.mock.calls[0]?.[0]).toMatchObject({
      environmentId,
      input: {
        projectId,
        request: {
          type: "workflow.prepare",
          goal: preview.goal,
          recipeId: "bug-fix",
          recipeInputs: { expected: "correct result" },
        },
      },
    });
    const plan = control(render(), "Runtime 계획 미리보기");
    expect(text(plan)).toContain("STANDARD");
    expect(text(plan)).toContain("strict");
    expect(text(plan)).toContain("unit checks");
    expect(control(render(), "확인 후 시작").props.disabled).toBe(false);
    change("수용 기준", "A revised observable outcome");
    expect(control(render(), "확인 후 시작").props.disabled).toBe(true);
    const form = visitElements(render(), (node) => node.type === "form")!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
      preventDefault() {},
    });
    await flush();
    expect(data.invoke.mock.calls[1]?.[0].input.request).toMatchObject({
      acceptanceStatements: ["A revised observable outcome"],
    });
    expect(data.invoke.mock.calls[1]?.[0].input.request).not.toHaveProperty("taskContract");
  });
  it("does not carry old acceptance criteria into a changed goal", async () => {
    await prepare();
    change("워크플로 목표", "Fix a different bug");
    expect(
      visitElements(render(), (node) => node.props["aria-label"] === "Runtime 계획 미리보기"),
    ).toBeNull();
    const form = visitElements(render(), (node) => node.type === "form")!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({
      preventDefault() {},
    });
    await flush();
    expect(data.invoke.mock.calls[1]?.[0].input.request).not.toHaveProperty("acceptanceStatements");
  });
  it("requires explicit confirmation and does not invent a Run from start acknowledgement", async () => {
    await prepare();
    accepted("workflow.confirm");
    await click("확인 후 시작");
    expect(data.confirm).toHaveBeenCalledOnce();
    expect(data.confirm.mock.calls[0]?.[0]).toContain("/trusted/project");
    expect(data.invoke.mock.calls[1]?.[0].input.request).toMatchObject({
      type: "workflow.confirm",
      previewId: preview.previewId,
      previewDigest: digest,
    });
    expect(text(render())).toContain("시작 요청을 받았어요");
    expect(text(render())).not.toContain("공식 실행:");
  });
  it("invalidates preview after canonical revision, owner or Runtime preview changes", async () => {
    await prepare();
    data.observation = { ...data.observation!, observedAt: preview.expiresAt };
    expect(control(render(), "확인 후 시작").props.disabled).toBe(true);
    data.observation = { ...data.observation!, observedAt: 1 };
    update({ projectRevision: 1 });
    expect(control(render(), "확인 후 시작").props.disabled).toBe(true);
    update({ projectRevision: 0, ownerId: "replacement" });
    expect(control(render(), "확인 후 시작").props.disabled).toBe(true);
    update({ ownerId: "owner", preview: null });
    expect(control(render(), "확인 후 시작").props.disabled).toBe(true);
    expect(data.invoke).toHaveBeenCalledOnce();
  });
  it("shows cancellation warning and waits for the confirmation dialog before sending", async () => {
    running();
    accepted("workflow.cancel");
    let decide!: (value: boolean) => void;
    data.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          decide = resolve;
        }),
    );
    await click("워크플로 취소");
    expect(data.invoke).not.toHaveBeenCalled();
    expect(data.confirm.mock.calls[0]?.[0]).toContain("일부 변경은");
    expect(text(render())).toContain("submitting");
    decide(true);
    await flush();
    expect(data.invoke).toHaveBeenCalledOnce();
    expect(text(render())).toContain("취소 요청을 받았어요");
    expect(text(render())).toContain("저장된 상태:  실행 중");
    expect(text(render())).toContain("쓰기 잠금 존재:  예");
    expect(text(render())).not.toContain("저장된 상태:  취소됨");
  });
  it("cancels no Run when confirmation is declined or its revision becomes stale", async () => {
    running();
    data.confirm.mockResolvedValue(false);
    await click("워크플로 취소");
    expect(data.invoke).not.toHaveBeenCalled();
    let decide!: (value: boolean) => void;
    data.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          decide = resolve;
        }),
    );
    await click("워크플로 취소");
    update({ stateRevision: 8 });
    render();
    decide(true);
    await flush();
    expect(data.invoke).not.toHaveBeenCalled();
    expect(text(render())).toContain("Runtime 상태가 바뀌었어요");
  });
  it("renders only the pending one-file grant and rejects without optimistic authority", async () => {
    running(true);
    accepted("approval.resolve");
    const card = control(render(), "대기 중인 R3 승인");
    expect(text(card)).toContain("src/old.js");
    expect(text(card)).toContain("approval-1");
    expect(text(card)).toContain("b".repeat(64));
    await click("거부");
    expect(data.confirm).not.toHaveBeenCalled();
    expect(data.invoke.mock.calls[0]?.[0].input.request).toMatchObject({
      type: "approval.resolve",
      approvalId: "approval-1",
      runId: "run-1",
      decision: "reject",
      expectedStateRevision: 7,
    });
    expect(text(render())).toContain("저장된 상태:  승인 대기");
    expect(text(render())).not.toContain("저장된 상태:  차단됨");
    update({ pendingApproval: null });
    expect(
      visitElements(render(), (node) => node.props["aria-label"] === "대기 중인 R3 승인"),
    ).toBeNull();
  });
  it("requires explicit bounded approval and prevents duplicate submissions while pending", async () => {
    running(true);
    let finish!: (value: unknown) => void;
    data.invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const button = control(render(), "이번만 승인");
    (button.props.onClick as () => void)();
    (button.props.onClick as () => void)();
    await flush();
    expect(data.confirm).toHaveBeenCalledOnce();
    expect(data.confirm.mock.calls[0]?.[0]).toContain("이번 삭제만 승인할까요");
    expect(data.invoke).toHaveBeenCalledOnce();
    expect(text(render())).toContain("submitting");
    expect(control(render(), "거부").props.disabled).toBe(true);
    finish(
      AsyncResult.success(
        response({
          kind: "accepted",
          requestId: "owner:2",
          command: "approval.resolve",
          runId: "run-1",
        }),
      ),
    );
    await flush();
    expect(text(render())).toContain("저장된 상태:  승인 대기");
    expect(text(render())).not.toContain("저장된 상태:  완료");
  });
  it("shows transport uncertainty without converting the Run into failure or retrying", async () => {
    running();
    data.invoke.mockRejectedValue(new Error("PRIVATE_TRANSPORT_MARKER"));
    await click("워크플로 취소");
    expect(text(render())).toContain("통신 오류로 명령 결과를 확인할 수 없어요");
    expect(text(render())).toContain("저장된 상태:  실행 중");
    expect(text(render())).not.toContain("PRIVATE_TRANSPORT_MARKER");
    data.phase = "disconnected";
    render();
    data.phase = "connected";
    render();
    await flush();
    expect(data.invoke).toHaveBeenCalledOnce();
  });
  it("disables disconnected, stale and unsupported actions instead of queuing them", async () => {
    await prepare();
    data.phase = "disconnected";
    expect(control(render(), "확인 후 시작").props.disabled).toBe(true);
    data.phase = "connected";
    data.observation = { ...data.observation!, stale: true };
    expect(control(render(), "확인 후 시작").props.disabled).toBe(true);
    data.observation = { ...data.observation!, stale: false };
    data.support = "unsupported";
    expect(control(render(), "확인 후 시작").props.disabled).toBe(true);
    expect(data.invoke).toHaveBeenCalledOnce();
  });
  it.each(["unsupported", "disconnected", "stale", "missing-capability", "missing-scope", "busy"])(
    "sends no request through forced form submission or reconnect when %s",
    async (variant) => {
      change("워크플로 목표", preview.goal);
      const available = data.observation;
      if (!available?.capabilities) throw new Error("Missing control fixture");
      switch (variant) {
        case "unsupported":
          data.support = "unsupported";
          break;
        case "disconnected":
          data.phase = "disconnected";
          break;
        case "stale":
          data.observation = { ...available, stale: true };
          break;
        case "missing-capability":
          data.observation = {
            ...available,
            capabilities: null,
          };
          break;
        case "missing-scope":
          data.observation = { ...available, status: "ERROR", stale: true, state: null };
          break;
        case "busy":
          update({ busy: true });
          break;
      }
      const tree = render();
      expect(control(tree, "워크플로 준비").props.disabled).toBe(true);
      const form = visitElements(tree, (node) => node.type === "form");
      if (!form) throw new Error("Missing workflow form");
      if (typeof form.props.onSubmit !== "function") throw new Error("Missing submit handler");
      form.props.onSubmit({ preventDefault() {} });
      await flush();
      expect(data.invoke).not.toHaveBeenCalled();
      data.observation = available;
      data.phase = "connected";
      data.support = "supported";
      render();
      await flush();
      expect(data.invoke).not.toHaveBeenCalled();
    },
  );
  it("rechecks freshness after the user accepts an outstanding workflow confirmation", async () => {
    await prepare();
    data.confirm.mockImplementation(async () => {
      const observation = data.observation;
      if (!observation) throw new Error("Missing control fixture");
      data.observation = { ...observation, stale: true };
      render();
      return true;
    });
    await click("확인 후 시작");
    expect(data.invoke).toHaveBeenCalledOnce();
    expect(data.invoke.mock.calls[0]?.[0].input.request.type).toBe("workflow.prepare");
  });
  it("opens and closes diagnostics without issuing a Runtime request", async () => {
    await click("연결 진단 정보");
    expect(control(render(), "연결 진단 정보").props["aria-expanded"]).toBe(true);
    await click("연결 진단 정보");
    expect(control(render(), "연결 진단 정보").props["aria-expanded"]).toBe(false);
    expect(data.invoke).not.toHaveBeenCalled();
  });
});

const browserCandidate: WeavraBrowserCandidateSummary = {
  schemaVersion: 2,
  kind: "BROWSER_OBSERVATION_CANDIDATE",
  candidateId: "00000000-0000-4000-8000-000000000001",
  projectId: digest,
  authority: "CANDIDATE_ONLY",
  scope: "LOCAL_STATIC_DOCUMENT",
  origin: "http://127.0.0.1:3880",
  documentIdentity: "http://127.0.0.1:3880/status",
  capturedAt: 100,
  pageRevision: digest,
  source: {
    implementationRevision: digest,
    readerRevision: "a".repeat(40),
    readerDigest: digest,
    executableIdentityDigest: digest,
    browserVersion: "Chromium fixture",
  },
  freshness: { mode: "CAPTURE_ONLY", startedAt: 90, finishedAt: 100 },
  observationDigest: digest,
  observationType: "target",
  observation: { target: { selector: "#status" }, exists: true, value: "Ready" },
  candidateDigest: digest,
  cleanup: "CONFIRMED",
};
const browserPreview: WeavraBrowserPreview = {
  previewId: "browser-preview",
  previewDigest: digest,
  ownerId: "owner",
  projectRevision: 0,
  expiresAt: 9999999999999,
  candidate: browserCandidate,
  check: {
    version: 1,
    checkId: "status-ready",
    projectId: digest,
    origin: browserCandidate.origin,
    documentIdentity: browserCandidate.documentIdentity,
    target: browserCandidate.observation.target,
    assertion: { type: "text_equals", expected: "Reviewed Ready" },
    freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 15000 },
    registrationDigest: digest,
  },
  isolation: "PRIVATE_HOME_PROFILE_CDP_PIPE_NOT_OS_SANDBOX",
};
async function inspectBrowser(evidence: WeavraBrowserState["evidence"] = []) {
  data.invoke.mockResolvedValue(
    AsyncResult.success(
      response({
        kind: "browser-state",
        state: {
          projectId: digest,
          candidates: [browserCandidate],
          omittedCandidates: 0,
          checks: [],
          omittedChecks: 0,
          evidence,
          omittedEvidence: 0,
        },
      }),
    ),
  );
  await click("브라우저 증거 새로고침");
  update({ nextRequestId: "owner:2" });
}
async function prepareBrowser() {
  await inspectBrowser();
  await click("이 후보 검토");
  change("브라우저 검사 이름", "status-ready");
  change("브라우저 예상 값", "Reviewed Ready");
  data.invoke.mockResolvedValue(
    AsyncResult.success(response({ kind: "browser-prepared", preview: browserPreview })),
  );
  const form = control(render(), "브라우저 예상 결과 편집기");
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
  await flush();
  update({ browserPreview, nextRequestId: "owner:3" });
}

describe("Weavra browser registration authority", () => {
  it("keeps candidate metadata read-only and sends the edited expectation only for Runtime preparation", async () => {
    await prepareBrowser();
    const tree = render();
    expect(text(tree)).toContain("CANDIDATE_ONLY");
    expect(text(tree)).toContain(browserCandidate.documentIdentity);
    expect(text(tree)).toContain(browserCandidate.candidateDigest);
    expect(control(tree, "브라우저 예상 값").props.value).toBe("Reviewed Ready");
    const registration = data.invoke.mock.calls[1]?.[0].input.request.registration;
    expect(registration).toEqual({
      candidateId: browserCandidate.candidateId,
      expectedCandidateDigest: browserCandidate.candidateDigest,
      checkId: "status-ready",
      origin: browserCandidate.origin,
      documentIdentity: browserCandidate.documentIdentity,
      target: { selector: "#status" },
      assertion: { type: "text_equals", expected: "Reviewed Ready" },
      freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 15000 },
    });
    expect(data.confirm).not.toHaveBeenCalled();
    expect(control(tree, "브라우저 검사 등록 확인").props.disabled).toBe(false);
  });
  it("invalidates the reviewed preview when the expectation changes", async () => {
    await prepareBrowser();
    change("브라우저 예상 값", "Different expectation");
    expect(control(render(), "브라우저 검사 등록 확인").props.disabled).toBe(true);
    expect(data.invoke).toHaveBeenCalledTimes(2);
  });
  it("does not register when explicit confirmation is declined", async () => {
    await prepareBrowser();
    data.confirm.mockResolvedValue(false);
    await click("브라우저 검사 등록 확인");
    expect(data.invoke).toHaveBeenCalledTimes(2);
  });
  it("sends exactly the Runtime preview once and does not turn registration acknowledgement into evidence", async () => {
    await prepareBrowser();
    let decide!: (value: boolean) => void;
    data.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          decide = resolve;
        }),
    );
    data.invoke.mockResolvedValue(
      AsyncResult.success(response({ kind: "browser-registered", check: browserPreview.check })),
    );
    const button = control(render(), "브라우저 검사 등록 확인");
    (button.props.onClick as () => void)();
    (button.props.onClick as () => void)();
    await flush();
    expect(data.confirm).toHaveBeenCalledOnce();
    expect(data.invoke).toHaveBeenCalledTimes(2);
    decide(true);
    await flush();
    expect(data.invoke).toHaveBeenCalledTimes(3);
    expect(data.invoke.mock.calls[2]?.[0].input.request).toEqual({
      protocolVersion: 1,
      id: "owner:3",
      ownerId: "owner",
      expectedProjectRevision: 0,
      type: "browser.confirm",
      previewId: browserPreview.previewId,
      previewDigest: browserPreview.previewDigest,
    });
    expect(
      visitElements(
        render(),
        (node) => node.props["aria-label"] === "Runtime 브라우저 등록 미리보기",
      ),
    ).toBeNull();
    expect(data.observation?.state?.snapshot.evidence).toBeNull();
    expect(data.observation?.state?.snapshot.status.run).toBeNull();
  });
  it("rechecks the edited expectation after the asynchronous confirmation dialog", async () => {
    await prepareBrowser();
    let decide!: (value: boolean) => void;
    data.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          decide = resolve;
        }),
    );
    await click("브라우저 검사 등록 확인");
    change("브라우저 예상 값", "Changed during review");
    render();
    decide(true);
    await flush();
    expect(data.invoke).toHaveBeenCalledTimes(2);
  });
  it("rejects replacement Runtime previews during confirmation even with unchanged request sequence", async () => {
    await prepareBrowser();
    let decide!: (value: boolean) => void;
    data.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          decide = resolve;
        }),
    );
    await click("브라우저 검사 등록 확인");
    update({ browserPreview: { ...browserPreview, previewId: "replacement-preview" } });
    render();
    decide(true);
    await flush();
    expect(data.invoke).toHaveBeenCalledTimes(2);
  });
  it("disables historical browser state after owner replacement or disconnection without replay", async () => {
    await prepareBrowser();
    update({ ownerId: "new-owner", browserPreview: null });
    expect(control(render(), "브라우저 검사 등록 확인").props.disabled).toBe(true);
    data.phase = "disconnected";
    expect(control(render(), "브라우저 증거 새로고침").props.disabled).toBe(true);
    data.phase = "connected";
    render();
    await flush();
    expect(data.invoke).toHaveBeenCalledTimes(2);
  });
  it("renders unavailable latest evidence without fabricating a capture or falling back to a passing candidate", async () => {
    await inspectBrowser([
      {
        runId: "latest-run",
        checkId: "status-ready",
        revision: 0,
        step: { stepId: "test", attempt: 1 },
        status: "UNAVAILABLE",
        diffDigest: digest,
        browser: null,
      },
    ]);
    const tree = render();
    expect(text(tree)).toContain("확인할 수 없음");
    expect(text(tree)).toContain("latest-run");
    expect(text(tree)).toContain("CANDIDATE_ONLY");
    expect(
      visitElements(tree, (node) => node.type === "strong" && text(node) === "PASS"),
    ).toBeNull();
    expect(data.invoke).toHaveBeenCalledOnce();
  });
});

const complexPlan: WeavraComplexPlanV1 = {
  schemaVersion: 1,
  planId: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a",
  complexPlanDigest: `sha256:${"7".repeat(64)}`,
  parentTaskId: "parent-1",
  parentTaskContractDigest: digest,
  tasks: [
    {
      id: "CT-001",
      title: "Extract parser",
      goal: "Move parsing into src/parse.ts",
      dependsOn: [],
      criterionIds: ["AC-001"],
      ownership: [
        { path: "src/config.ts", operation: "modify" },
        { path: "src/parse.ts", operation: "create" },
      ],
      checkIds: ["test"],
      maxRevisionCycles: 2,
    },
    {
      id: "CT-002",
      title: "Add validation",
      goal: "Reject duplicate keys",
      dependsOn: ["CT-001"],
      criterionIds: ["AC-002"],
      ownership: [],
      checkIds: ["test"],
      maxRevisionCycles: 2,
    },
  ],
  integration: {
    criterionIds: ["AC-001", "AC-002"],
    checkIds: ["lint", "test"],
    reviewRequired: true,
    finalChecksRequired: true,
  },
  limits: {
    maxTasks: 8,
    maxWorkerInvocations: 24,
    maxReportedTokens: 200000,
    maxTotalRevisionCycles: 3,
  },
};
const complexPreview: WeavraControlPreview = {
  ...preview,
  previewId: "complex-preview",
  workflow: "COMPLEX",
  checks: [
    { id: "lint", kind: "command", required: false },
    { id: "test", kind: "command", required: true },
  ],
  acceptanceCriteria: [
    { id: "AC-001", statement: "Parse input", checkIds: ["test"], reviewRequired: true },
    { id: "AC-002", statement: "Validate input", checkIds: ["test"], reviewRequired: true },
  ],
  complexPlan,
};
type ComplexRow = WeavraComplexExecutionV1["tasks"][number];
const idleRow = (id: string): ComplexRow => ({
  id,
  status: "PENDING",
  attempt: 0,
  revisionCycle: 0,
  workerInvocations: 0,
  reportedTokens: 0,
  entryWorkspaceDigest: null,
  exitWorkspaceDigest: null,
  changedFiles: [],
  changesUnknown: false,
  selfCheck: "NOT_RUN",
  review: "NOT_RUN",
  test: "NOT_RUN",
  evidenceFreshness: "NONE",
  failureCode: null,
});
const completedTask = (id: string, freshness: ComplexRow["evidenceFreshness"]): ComplexRow => ({
  ...idleRow(id),
  status: "COMPLETED",
  attempt: 1,
  workerInvocations: 2,
  reportedTokens: null,
  entryWorkspaceDigest: "1".repeat(64),
  exitWorkspaceDigest: "2".repeat(64),
  changedFiles: id === "CT-001" ? ["src/config.ts"] : [],
  selfCheck: "PASS",
  review: "PASS",
  test: "PASS",
  evidenceFreshness: freshness,
});
function complexExecution(patch: Partial<WeavraComplexExecutionV1> = {}): WeavraComplexExecutionV1 {
  return {
    schemaVersion: 1,
    ownerId: "owner",
    projectRevision: 9,
    runId: "run-1",
    stateRevision: 7,
    parent: {
      id: "parent-1",
      goal: preview.goal,
      acceptanceCriteria: complexPreview.acceptanceCriteria.map((criterion) => ({
        id: criterion.id,
        statement: criterion.statement,
        scope: { paths: ["src"] },
        verification: { checkIds: criterion.checkIds, reviewRequired: true },
      })),
      status: "inProgress",
    },
    plan: complexPlan,
    phase: "FINAL_REVIEW",
    activeTaskId: null,
    tasks: [completedTask("CT-001", "STALE"), completedTask("CT-002", "CURRENT")],
    integration: {
      check: "PASS",
      review: "RUNNING",
      test: "NOT_RUN",
      workspaceDigest: "3".repeat(64),
      evidenceFreshness: "CURRENT",
      failureCode: null,
    },
    budget: {
      workerInvocations: 5,
      reportedTokens: null,
      totalRevisionCycles: 0,
      status: "UNKNOWN",
    },
    cleanup: "NOT_REQUESTED",
    partialChanges: true,
    changesUnknown: false,
    failureCode: null,
    ...patch,
  };
}
function advertiseComplex(version: 1 | 2 = 1) {
  data.observation = {
    ...data.observation!,
    capabilities: { ...data.observation!.capabilities!, complexContractVersion: version },
  };
}
function complexRunning() {
  running();
  const current = data.observation!.state!;
  update({
    complexExecution: complexExecution(),
    snapshot: {
      ...current.snapshot,
      status: {
        ...current.snapshot.status,
        run: { ...current.snapshot.status.run!, workflow: "COMPLEX", phase: "REVIEW" },
      },
    },
  });
}
/** Rendered text with the harness's child-joining whitespace collapsed. */
const words = (node: unknown) => text(node).replace(/\s+/g, " ");
function toggle(label: string) {
  (control(render(), label).props.onChange as () => void)();
}
function submitPrepare() {
  const form = visitElements(render(), (node) => node.type === "form")!;
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
  return flush();
}
/** Renders a presentational child the harness left unexpanded; those views have no hooks. */
function child<P extends object>(
  tree: ReactElement<Record<string, unknown>>,
  component: (props: P) => React.ReactNode,
) {
  const element = visitElements(tree, (node) => node.type === component);
  if (!element) throw new Error(`Missing ${component.name}`);
  return component(element.props as P) as ReactElement<Record<string, unknown>>;
}
function elements(tree: unknown, type: string) {
  const found: Array<ReactElement<Record<string, unknown>>> = [];
  visitElements(tree, (node) => {
    if (node.type === type) found.push(node);
    return false;
  });
  return found;
}
async function draftTwoTasks(version: 1 | 2 = 1) {
  advertiseComplex(version);
  change("워크플로 목표", preview.goal);
  await click("작업 추가");
  await click("작업 추가");
  change("COMPLEX 수용 기준", "Parse input\nValidate input");
  change("작업 1 제목", "Extract parser");
  change("작업 1 목표", "Move parsing into src/parse.ts");
  toggle("작업 1의 수용 기준 연결 1");
  await click("작업 1에 파일 담당 범위 추가");
  change("작업 1 담당 범위 1 경로", "src/config.ts");
  change("작업 1의 검사 ID", "test");
  change("작업 2 제목", "Add validation");
  change("작업 2 목표", "Reject duplicate keys");
  toggle("작업 2의 선행 작업 1");
  change("작업 2의 검사 ID", "test");
}

describe("COMPLEX task plan and execution projection", () => {
  it("shows no COMPLEX surface and never sends a draft without the Runtime capability", async () => {
    expect(
      visitElements(render(), (node) => node.props["aria-label"] === "COMPLEX 작업 계획"),
    ).toBeNull();
    expect(visitElements(render(), (node) => text(node) === "작업 추가")).toBeNull();
    await prepare();
    const request = data.invoke.mock.calls[0]?.[0].input.request;
    expect(request).toMatchObject({ type: "workflow.prepare", goal: preview.goal });
    expect(request).not.toHaveProperty("complexDraft");
  });
  it("sends the exact bounded draft on workflow.prepare only after local reference checks", async () => {
    await draftTwoTasks();
    await submitPrepare();
    expect(words(render())).toContain("작업 2에 연결된 수용 기준이 없어요.");
    toggle("작업 2의 수용 기준 연결 1");
    await submitPrepare();
    expect(words(render())).toContain("수용 기준 2에 연결된 작업이 없어요.");
    toggle("작업 2의 수용 기준 연결 1");
    toggle("작업 2의 수용 기준 연결 2");
    change("검토한 실행 절차", "bug-fix");
    await submitPrepare();
    expect(words(render())).toContain("STANDARD 전용");
    expect(data.invoke).not.toHaveBeenCalled();
    change("검토한 실행 절차", "");
    data.invoke.mockResolvedValue(
      AsyncResult.success(response({ kind: "prepared", preview: complexPreview })),
    );
    await submitPrepare();
    expect(data.invoke).toHaveBeenCalledOnce();
    expect(data.invoke.mock.calls[0]?.[0].input.request).toEqual({
      protocolVersion: 1,
      id: "owner:1",
      ownerId: "owner",
      expectedProjectRevision: 0,
      type: "workflow.prepare",
      goal: preview.goal,
      acceptanceStatements: ["Parse input", "Validate input"],
      complexDraft: {
        tasks: [
          {
            title: "Extract parser",
            goal: "Move parsing into src/parse.ts",
            dependsOnIndexes: [],
            criterionIndexes: [1],
            ownership: [{ path: "src/config.ts", operation: "modify" }],
            checkIds: ["test"],
          },
          {
            title: "Add validation",
            goal: "Reject duplicate keys",
            dependsOnIndexes: [1],
            criterionIndexes: [2],
            ownership: [],
            checkIds: ["test"],
          },
        ],
      },
    });
  });
  it("rejects noncanonical claims locally instead of rewriting them", async () => {
    await draftTwoTasks();
    toggle("작업 2의 수용 기준 연결 2");
    change("작업 1 담당 범위 1 경로", "src/config.ts/");
    await submitPrepare();
    expect(data.invoke).not.toHaveBeenCalled();
    expect(words(render())).toContain("작업 계획을 확인해 주세요");
    expect(control(render(), "작업 1 담당 범위 1 경로").props.value).toBe("src/config.ts/");
  });
  it("shows the complete Runtime plan, confirms that exact preview once and drops it on draft edits", async () => {
    await draftTwoTasks();
    toggle("작업 2의 수용 기준 연결 2");
    data.invoke.mockResolvedValue(
      AsyncResult.success(response({ kind: "prepared", preview: complexPreview })),
    );
    await submitPrepare();
    update({ preview: complexPreview, nextRequestId: "owner:2" });
    const section = control(render(), "Runtime 계획 미리보기");
    expect(words(section)).toContain("COMPLEX");
    expect(words(section)).toContain("AC-002 · Validate input");
    expect(visitElements(section, (node) => node.props["aria-label"] === "수용 기준")).toBeNull();
    const plan = words(child(section, ComplexPlanView));
    for (const expected of [
      "CT-001 · Extract parser",
      "CT-002 · Add validation",
      "선행 작업: CT-001",
      "AC-002 · Validate input",
      "modify src/config.ts, create src/parse.ts",
      "없음(읽기 전용 작업)",
      "모든 등록 검사 lint, test",
      "24 회 워커 호출",
      complexPlan.complexPlanDigest,
    ]) {
      expect(plan).toContain(expected);
    }
    accepted("workflow.confirm");
    await click("확인 후 시작");
    expect(data.confirm.mock.calls[0]?.[0]).toContain(
      "CT-001 Extract parser; CT-002 Add validation",
    );
    expect(data.confirm.mock.calls[0]?.[0]).toContain(
      "모든 개별 작업이 끝나도 실행 완료 판정은 별도예요",
    );
    expect(data.invoke.mock.calls[1]?.[0].input.request).toMatchObject({
      type: "workflow.confirm",
      previewId: complexPreview.previewId,
      previewDigest: complexPreview.previewDigest,
    });
    change("작업 1 제목", "Edited after preparing");
    expect(
      visitElements(render(), (node) => node.props["aria-label"] === "Runtime 계획 미리보기"),
    ).toBeNull();
  });
  it("keeps the confirmed plan read-only and offers no task controls", async () => {
    await draftTwoTasks();
    complexRunning();
    const tree = render();
    for (const label of ["작업 추가", "작업 1 제목", "작업 1의 검사 ID", "작업 2의 선행 작업 1"]) {
      expect(control(tree, label).props.disabled).toBe(true);
    }
    const buttons = elements(tree, "button").map((button) => text(button).trim());
    expect(buttons).toContain("워크플로 취소");
    for (const label of buttons) {
      expect(label).not.toMatch(/complete|retry|skip|next|reorder|resume|pass|approve plan/i);
    }
    const projection = child(tree, ComplexExecutionView);
    for (const type of ["button", "input", "select", "textarea", "form"]) {
      expect(elements(projection, type)).toEqual([]);
    }
  });
  it("labels historical and unowned projections and never presents completed tasks as the Run outcome", () => {
    complexRunning();
    let projection = words(child(render(), ComplexExecutionView));
    expect(projection).toContain("현재 관찰");
    expect(projection).toContain("공식 실행 결과: 실행 중");
    expect(projection).toContain("완료한 개별 작업: 2 / 2");
    expect(projection).toContain("개별 작업 완료는 실행 완료가 아니에요");
    expect(projection).toContain("과거 작업 기록이며 현재 완료 증거가 아니에요");
    expect(projection).toContain("보고된 토큰 확인 안 됨");
    expect(projection).toContain("확인 안 됨 / 200000");
    expect(projection).not.toContain("보고된 토큰 0");
    data.observation = { ...data.observation!, stale: true, observedAt: 1 };
    projection = words(child(render(), ComplexExecutionView));
    expect(projection).toContain("과거 정보 · 현재 상태 아님");
    expect(projection).toContain("마지막으로 확인한 관찰");
    expect(visitElements(render(), (node) => text(node) === "워크플로 취소")).toBeNull();
    data.observation = { ...data.observation!, stale: false };
    update({ ownedRunId: "another-run" });
    expect(words(child(render(), ComplexExecutionView))).toContain("표시 전용 · 소유하지 않음");
    expect(visitElements(render(), (node) => text(node) === "워크플로 취소")).toBeNull();
  });
  it("shows terminal cleanup uncertainty and partial changes from the canonical snapshot", () => {
    complexRunning();
    const current = data.observation!.state!;
    update({
      busy: false,
      complexExecution: complexExecution({
        phase: "TERMINAL",
        tasks: [
          completedTask("CT-001", "STALE"),
          { ...idleRow("CT-002"), status: "INTERRUPTED", failureCode: "OWNER_LOST" },
        ],
        integration: {
          ...complexExecution().integration,
          check: "NOT_RUN",
          review: "NOT_RUN",
          workspaceDigest: null,
          evidenceFreshness: "NONE",
        },
        cleanup: "UNCONFIRMED",
        changesUnknown: true,
        failureCode: "CLEANUP_UNCONFIRMED",
      }),
      snapshot: {
        ...current.snapshot,
        status: {
          ...current.snapshot.status,
          writerPresent: true,
          run: { ...current.snapshot.status.run!, status: "INTERRUPTED" },
        },
      },
    });
    const projection = words(child(render(), ComplexExecutionView));
    for (const expected of [
      "공식 실행 결과: 중단됨",
      "UNCONFIRMED / 예",
      "정리가 확인되지 않아 직접 점검할 때까지 쓰기 잠금을 유지해요",
      "일부 변경 보존됨 · 변경 집합 미확인",
      "실패: OWNER_LOST",
      "CLEANUP_UNCONFIRMED",
    ]) {
      expect(projection).toContain(expected);
    }
  });
});

// Contract v2 (V0.8A): CT-001 and CT-002 are independent; CT-003 waits for both.
const parallelPlan: WeavraComplexPlanV2 = {
  ...complexPlan,
  schemaVersion: 2,
  tasks: [
    { ...complexPlan.tasks[0]!, dependsOn: [] },
    {
      ...complexPlan.tasks[1]!,
      dependsOn: [],
      ownership: [{ path: "src/validate.ts", operation: "create" }],
    },
    {
      id: "CT-003",
      title: "Add formatter",
      goal: "Render parsed pairs back to text",
      dependsOn: ["CT-001", "CT-002"],
      criterionIds: ["AC-002"],
      ownership: [{ path: "src/format.ts", operation: "create" }],
      checkIds: ["test"],
      maxRevisionCycles: 2,
    },
  ],
  limits: { ...complexPlan.limits, maxParallel: 2 },
};
const parallelPreview: WeavraControlPreview = {
  ...complexPreview,
  previewId: "parallel-preview",
  complexPlan: parallelPlan,
};
const liveRow = (id: string): ComplexRow => ({
  ...idleRow(id),
  status: "IMPLEMENTING",
  attempt: 1,
  workerInvocations: 1,
  reportedTokens: 1200,
  entryWorkspaceDigest: "1".repeat(64),
});
function parallelExecution(
  patch: Partial<WeavraComplexExecutionV2> = {},
): WeavraComplexExecutionV2 {
  const { activeTaskId: _activeTaskId, ...fields } = complexExecution();
  return {
    ...fields,
    schemaVersion: 2,
    plan: parallelPlan,
    phase: "TASK_SEQUENCE",
    activeTaskIds: ["CT-001", "CT-002"],
    tasks: [
      liveRow("CT-001"),
      {
        ...liveRow("CT-002"),
        status: "HANDED_OFF",
        reportedTokens: null,
        changedFiles: ["src/validate.ts"],
      },
      idleRow("CT-003"),
    ],
    integration: {
      check: "NOT_RUN",
      review: "NOT_RUN",
      test: "NOT_RUN",
      workspaceDigest: null,
      evidenceFreshness: "NONE",
      failureCode: null,
    },
    budget: {
      workerInvocations: 2,
      reportedTokens: null,
      totalRevisionCycles: 0,
      status: "UNKNOWN",
    },
    ...patch,
  };
}
function parallelRunning(execution = parallelExecution()) {
  complexRunning();
  advertiseComplex(2);
  update({ complexExecution: execution });
}

describe("COMPLEX contract v2 (parallel waves) projection", () => {
  it("shows the Runtime-reported wave and HANDED_OFF rows waiting their turn, with no task controls", () => {
    parallelRunning();
    const tree = render();
    const projection = child(tree, ComplexExecutionView);
    const shown = words(projection);
    for (const expected of [
      "Runtime이 보고한 현재 병렬 작업 묶음: CT-001 · Extract parser, CT-002 · Add validation",
      "최대 2 개를 동시에 구현하며 검사와 검토는 하나씩 진행해요",
      "CT-002 · Add validation 현재 병렬 묶음 검증 대기 구현을 마치고 검증 차례를 기다리고 있어요",
      "CT-003 · Add formatter 대기 중 선행 작업: CT-001, CT-002",
      "워커 호출 1 · 보고된 토큰 확인 안 됨",
    ]) {
      expect(shown).toContain(expected);
    }
    expect(shown).not.toContain("활성 작업");
    // Membership is exactly what Runtime reported, never inferred from dependencies.
    expect(
      elements(projection, "span").filter((node) => text(node) === "현재 병렬 묶음"),
    ).toHaveLength(2);
    for (const type of ["button", "input", "select", "textarea", "form"]) {
      expect(elements(projection, type)).toEqual([]);
    }
    for (const label of elements(tree, "button").map((button) => text(button).trim())) {
      expect(label).not.toMatch(/complete|retry|skip|next|reorder|resume|pass|wave|parallel/i);
    }
  });
  it("explains sibling stops and the cancel state only from the canonical snapshot", () => {
    parallelRunning(
      parallelExecution({
        phase: "STOPPING",
        cleanup: "PENDING",
        tasks: [
          { ...liveRow("CT-001"), status: "STOPPING" },
          { ...liveRow("CT-002"), status: "STOPPING" },
          idleRow("CT-003"),
        ],
      }),
    );
    update({ cancelling: true });
    expect(words(child(render(), ComplexExecutionView))).toContain(
      "취소 요청됨: Runtime이 모든 활성 작업을 멈추고 종료를 확인한 뒤 결과를 기록해요. 정리 상태: PENDING.",
    );
    const current = data.observation!.state!;
    update({
      busy: false,
      cancelling: false,
      complexExecution: parallelExecution({
        phase: "TERMINAL",
        activeTaskIds: [],
        cleanup: "CONFIRMED",
        partialChanges: true,
        failureCode: "OWNERSHIP_CONFLICT",
        tasks: [
          { ...liveRow("CT-001"), status: "BLOCKED", failureCode: "OWNERSHIP_CONFLICT" },
          { ...liveRow("CT-002"), status: "BLOCKED", failureCode: "RUN_STOPPED" },
          { ...idleRow("CT-003"), status: "BLOCKED", failureCode: "RUN_STOPPED" },
        ],
      }),
      snapshot: {
        ...current.snapshot,
        status: {
          ...current.snapshot.status,
          writerPresent: false,
          run: { ...current.snapshot.status.run!, status: "BLOCKED" },
        },
      },
    });
    const shown = words(child(render(), ComplexExecutionView));
    for (const expected of [
      "공식 실행 결과: 차단됨",
      "Runtime이 보고한 현재 병렬 작업 묶음: 없음",
      "실패: OWNERSHIP_CONFLICT",
      "실패: RUN_STOPPED — 다른 작업이 실패했거나 실행이 중단되어 멈췄어요",
    ]) {
      expect(shown).toContain(expected);
    }
    expect(shown).not.toContain("취소 요청됨");
  });
  it("keeps the draft editor unchanged for contract v2 and shows maxParallel read-only", async () => {
    await draftTwoTasks(2);
    toggle("작업 2의 수용 기준 연결 2");
    const editor = words(control(render(), "COMPLEX 작업 계획"));
    expect(editor).toContain("Runtime 계약 v2");
    expect(editor).toContain("동시에 구현할 수 있어요");
    data.invoke.mockResolvedValue(
      AsyncResult.success(response({ kind: "prepared", preview: parallelPreview })),
    );
    await submitPrepare();
    const sent = data.invoke.mock.calls[0]?.[0].input.request;
    expect(Object.keys(sent.complexDraft.tasks[0]).toSorted()).toEqual([
      "checkIds",
      "criterionIndexes",
      "dependsOnIndexes",
      "goal",
      "ownership",
      "title",
    ]);
    expect(sent).not.toHaveProperty("maxParallel");
    update({ preview: parallelPreview, nextRequestId: "owner:2" });
    const plan = words(child(control(render(), "Runtime 계획 미리보기"), ComplexPlanView));
    for (const expected of [
      "최대 2개 작업 동시 구현(Runtime 설정, 읽기 전용)",
      "CT-003 · Add formatter Render parsed pairs back to text 선행 작업: CT-001, CT-002",
      "최대 2개씩 함께 구현하고 이 순서대로 하나씩 검사·검토해요",
    ]) {
      expect(plan).toContain(expected);
    }
    expect(
      visitElements(render(), (node) =>
        /parallel|wave|concurren/i.test(String(node.props["aria-label"] ?? "")),
      ),
    ).toBeNull();
    accepted("workflow.confirm");
    await click("확인 후 시작");
    expect(data.confirm.mock.calls[0]?.[0]).toContain(
      "선행 작업이 끝난 작업을 최대 2개까지 동시에 구현한",
    );
  });
});

/** An active Run whose owner is not this connection, e.g. left behind by a killed Host. */
function orphaned(patch: Partial<WeavraControlState> = {}) {
  running();
  update({ busy: false, ownedRunId: null, ...patch });
}
function refused(code: "STALE_PROJECT" | "WRITER_PRESENT"): WeavraControlResponse {
  return {
    protocolVersion: 1,
    type: "control_response",
    id: "owner:2",
    command: "workflow.prepare",
    ownerId: "owner",
    runId: "run-1",
    stateRevision: 7,
    projectRevision: 9,
    eventId: null,
    timestamp: 1,
    success: false,
    error: { code },
  };
}
const orphanNote = (tree: ReactElement<Record<string, unknown>>) =>
  visitElements(tree, (node) => node.props["aria-label"] === "다른 소유자가 사용 중인 프로젝트");

describe("Prepare while another owner holds the active Run", () => {
  it("offers only workflow prepare, and explains that Runtime decides whether the owner stopped", () => {
    orphaned();
    change("워크플로 목표", preview.goal);
    const tree = render();
    expect(control(tree, "워크플로 준비").props.disabled).toBe(false);
    expect(words(orphanNote(tree))).toContain(
      "소유 프로세스가 종료됐다면 워크플로 준비 시 해당 실행을 INTERRUPTED로 기록해요. 작업은 재개하지 않고",
    );
    expect(words(orphanNote(tree))).toContain("요청을 거부해요");
    // Cancel, approval, facts and browser gates stay as they were.
    expect(visitElements(tree, (node) => text(node) === "워크플로 취소")).toBeNull();
    expect(
      visitElements(tree, (node) => node.props["aria-label"] === "대기 중인 R3 승인"),
    ).toBeNull();
    expect(control(tree, "사실 검토 준비").props.disabled).toBe(true);
    expect(control(tree, "브라우저 증거 새로고침").props.disabled).not.toBe(true);
    // A connection that owned an earlier Run does not own this one either.
    update({ ownedRunId: "earlier-run" });
    expect(control(render(), "워크플로 준비").props.disabled).toBe(false);
  });
  it("keeps prepare disabled for this connection's own Run and for busy, stale or disconnected views", () => {
    change("워크플로 목표", preview.goal);
    for (const patch of [{ ownedRunId: "run-1" }, { busy: true, ownedRunId: "earlier-run" }]) {
      orphaned(patch);
      expect(control(render(), "워크플로 준비").props.disabled).toBe(true);
      expect(orphanNote(render())).toBeNull();
    }
    orphaned();
    data.observation = { ...data.observation!, stale: true };
    expect(control(render(), "워크플로 준비").props.disabled).toBe(true);
    data.observation = { ...data.observation!, stale: false };
    data.phase = "disconnected";
    expect(control(render(), "워크플로 준비").props.disabled).toBe(true);
    data.phase = "connected";
    // A writer lock without any Run is still not preparable. After a terminal Run it is, since
    // COMPLEX_RERUN.md §7 (see "Prepare after a terminal Run left its writer lock").
    const current = data.observation!.state!;
    update({
      snapshot: { ...current.snapshot, status: { ...current.snapshot.status, run: null } },
    });
    expect(control(render(), "워크플로 준비").props.disabled).toBe(true);
    expect(data.invoke).not.toHaveBeenCalled();
  });
  it("sends one plain prepare and, after STALE_PROJECT, waits for fresh state and an explicit retry", async () => {
    orphaned();
    change("워크플로 목표", preview.goal);
    data.invoke.mockResolvedValue(AsyncResult.success(refused("STALE_PROJECT")));
    await submitPrepare();
    expect(data.invoke.mock.calls[0]?.[0].input.request).toEqual({
      protocolVersion: 1,
      id: "owner:2",
      ownerId: "owner",
      expectedProjectRevision: 9,
      type: "workflow.prepare",
      goal: preview.goal,
    });
    const shown = words(render());
    expect(shown).toContain("Runtime이 명령을 거부했어요: STALE_PROJECT.");
    expect(shown).toContain(
      "준비나 재시도는 하지 않았으니 새 상태를 확인한 뒤 다시 준비해 주세요.",
    );
    await flush();
    expect(data.invoke).toHaveBeenCalledOnce();
    // The fresh read shows the Runtime's recovery: INTERRUPTED and the writer released.
    const current = data.observation!.state!;
    update({
      projectRevision: 10,
      stateRevision: 8,
      nextRequestId: "owner:3",
      snapshot: {
        ...current.snapshot,
        status: {
          ...current.snapshot.status,
          writerPresent: false,
          run: { ...current.snapshot.status.run!, status: "INTERRUPTED" },
        },
      },
    });
    expect(orphanNote(render())).toBeNull();
    data.invoke.mockResolvedValue(AsyncResult.success(response({ kind: "prepared", preview })));
    await submitPrepare();
    expect(data.invoke).toHaveBeenCalledTimes(2);
    expect(data.invoke.mock.calls[1]?.[0].input.request).toMatchObject({
      id: "owner:3",
      expectedProjectRevision: 10,
      type: "workflow.prepare",
    });
  });
  it("reports a live or unprovable owner's refusal without retrying", async () => {
    orphaned();
    change("워크플로 목표", preview.goal);
    data.invoke.mockResolvedValue(AsyncResult.success(refused("WRITER_PRESENT")));
    await submitPrepare();
    await flush();
    expect(words(render())).toContain("Runtime이 명령을 거부했어요: WRITER_PRESENT.");
    expect(data.invoke).toHaveBeenCalledOnce();
    expect(text(render())).toContain("저장된 상태:  실행 중");
  });
});

// V0.8B Planner (docs/architecture/PLANNER_DRAFT.md §9): candidate rows for the editor only.
const plannerGoal = "Split the config parser into parse and validate modules";
const plannerStatements = [
  "parseConfig keeps its current behavior",
  "validateConfig rejects duplicate keys",
];
// sha256 of the UTF-8 JSON ["weavra-planner-request-v1", goal, statements] (§6).
const plannerDigest = "sha256:29350ea702ea51a4b633fb065b20653d2070a6e744e76f0ac605424e4179f9f6";
const planId = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";
const plannerRunning: WeavraPlannerStatus = {
  schemaVersion: 1,
  planId,
  status: "RUNNING",
  requestDigest: plannerDigest,
  projectRevision: 0,
  current: true,
  startedAt: 1_000,
  finishedAt: null,
  route: {
    alias: "plan",
    profile: "reasoning",
    provider: "commandcode",
    model: "deepseek/deepseek-v4.1-flash",
  },
  usage: { invocations: 1, reportedTokens: 1200 },
  taskCount: null,
  failureCode: null,
};
const plannerReady: WeavraPlannerStatus = {
  ...plannerRunning,
  status: "READY",
  finishedAt: 9_000,
  usage: { invocations: 2, reportedTokens: 3400 },
  taskCount: 2,
};
const plannerDraft: WeavraComplexDraft = {
  tasks: [
    {
      title: "Split parse module",
      goal: "Move parsing into src/parse.ts",
      dependsOnIndexes: [],
      criterionIndexes: [1],
      ownership: [{ path: "src/parse.ts", operation: "create" }],
      checkIds: ["test"],
    },
    {
      title: "Validate keys",
      goal: "Reject duplicate keys in src/config.ts",
      dependsOnIndexes: [1],
      criterionIndexes: [2],
      ownership: [{ path: "src/config.ts", operation: "modify" }],
      checkIds: ["test", "lint"],
    },
  ],
};
function advertisePlanner() {
  advertiseComplex(2);
  data.observation = {
    ...data.observation!,
    capabilities: { ...data.observation!.capabilities!, plannerContractVersion: 1 },
  };
}
function enterPlannerRequest() {
  change("워크플로 목표", plannerGoal);
  change("COMPLEX 수용 기준", plannerStatements.join("\n"));
}
function plannerReply(
  data: Extract<WeavraControlResponse, { success: true }>["data"],
  command: string,
) {
  return AsyncResult.success({ ...response(data), command });
}
function readReply(patch: Partial<{ planId: string; current: boolean }> = {}) {
  return plannerReply(
    {
      kind: "planner-draft",
      planId,
      requestDigest: plannerDigest,
      projectRevision: 0,
      current: true,
      draft: plannerDraft,
      ...patch,
    },
    "planner.read",
  );
}
const sentTypes = () =>
  data.invoke.mock.calls.map(
    (call) => (call[0] as { input: { request: { type: string } } }).input.request.type,
  );
const labelled = (tree: ReactElement<Record<string, unknown>>, label: string) =>
  visitElements(tree, (node) => node.props["aria-label"] === label);

describe("V0.8B Planner draft", () => {
  it("renders nothing about the Planner and sends no planner command without the capability", async () => {
    const plannerSurface = (tree: ReactElement<Record<string, unknown>>) =>
      visitElements(
        tree,
        (node) =>
          /planner/i.test(String(node.props["aria-label"] ?? "")) ||
          (node.type === "button" && /planner|load into editor/i.test(text(node))),
      );
    // Even a snapshot that carries planner state shows nothing on a connection without it.
    update({ planner: plannerReady });
    for (const runtime of ["baseline", "COMPLEX v2 without Planner"]) {
      if (runtime !== "baseline") advertiseComplex(2);
      expect([runtime, plannerSurface(render())]).toEqual([runtime, null]);
      expect(words(render())).not.toMatch(/planner/i);
    }
    // The COMPLEX editor keeps its previous shape: criteria appear only with task rows.
    expect(labelled(render(), "COMPLEX 수용 기준")).toBeNull();
    await prepare();
    expect(sentTypes()).toEqual(["workflow.prepare"]);
  });
  it("offers Draft with Planner only for a current idle connection with a goal and criteria", async () => {
    advertisePlanner();
    const draftDisabled = () => control(render(), "계획 담당으로 초안 만들기").props.disabled;
    expect(draftDisabled()).toBe(true);
    change("워크플로 목표", plannerGoal);
    expect(draftDisabled()).toBe(true);
    change("COMPLEX 수용 기준", "  \n ");
    expect(draftDisabled()).toBe(true);
    change("COMPLEX 수용 기준", plannerStatements.join("\n"));
    expect(draftDisabled()).toBe(false);
    const base = data.observation!;
    const writer = (writerPresent: boolean, run: WeavraControlState["snapshot"]["status"]["run"]) =>
      update({
        snapshot: {
          ...base.state!.snapshot,
          status: { ...base.state!.snapshot.status, writerPresent, run },
        },
      });
    const foreignRun = {
      runId: "foreign-run",
      status: "RUNNING" as const,
      phase: "IMPLEMENT" as const,
      workflow: "STANDARD" as const,
      risk: "R1" as const,
      executionMode: "EDIT" as const,
      codeRevision: 0,
      currentStep: null,
      activeAgentCount: 1,
      taskContractDigest: digest,
      createdAt: 1,
      updatedAt: 1,
    };
    for (const [label, apply] of [
      [
        "stale observation",
        () => {
          data.observation = { ...base, stale: true };
        },
      ],
      [
        "disconnected environment",
        () => {
          data.phase = "disconnected";
        },
      ],
      [
        "control not supported",
        () => {
          data.support = "unsupported";
        },
      ],
      ["writer present", () => writer(true, null)],
      ["active Run", () => writer(false, foreignRun)],
      ["busy owner", () => update({ busy: true })],
      ["planning already running", () => update({ planner: plannerRunning })],
    ] as const) {
      data.observation = base;
      data.phase = "connected";
      data.support = "supported";
      apply();
      expect([label, draftDisabled()]).toEqual([label, true]);
    }
    data.observation = base;
    data.phase = "connected";
    data.support = "supported";
    data.invoke.mockResolvedValue(
      plannerReply(
        { kind: "accepted", requestId: "owner:1", command: "planner.start", runId: null },
        "planner.start",
      ),
    );
    await click("계획 담당으로 초안 만들기");
    const sent = data.invoke.mock.calls[0]?.[0].input.request;
    expect(sent).toEqual({
      protocolVersion: 1,
      id: "owner:1",
      ownerId: "owner",
      expectedProjectRevision: 0,
      type: "planner.start",
      goal: plannerGoal,
      acceptanceStatements: plannerStatements,
    });
    // What was sent is exactly what the Host binds as the request digest.
    expect(plannerRequestDigest(sent.goal, sent.acceptanceStatements)).toBe(plannerDigest);
    expect(data.confirm).not.toHaveBeenCalled();
    expect(words(render())).toContain("계획 생성을 시작했어요.");
    expect(words(render())).toContain("직접 불러오기 전에는 편집기에 반영하지 않아요");
  });
  it("shows elapsed time, route and usage while RUNNING, and cancels only that request", async () => {
    advertisePlanner();
    enterPlannerRequest();
    update({ planner: plannerRunning });
    data.observation = { ...data.observation!, observedAt: plannerRunning.startedAt + 12_400 };
    const shown = words(control(render(), "계획 담당 실행 중"));
    expect(shown).toContain("계획 생성 중 · 경과 12 s");
    expect(shown).toContain(
      "models.intents.plan → reasoning → commandcode/deepseek/deepseek-v4.1-flash",
    );
    expect(shown).toContain("1 / 3회 모델 호출 · 보고된 토큰 1200");
    expect(control(render(), "계획 담당으로 초안 만들기").props.disabled).toBe(true);
    expect(labelled(render(), "계획 담당 제안")).toBeNull();
    data.invoke.mockResolvedValue(
      plannerReply(
        { kind: "accepted", requestId: "owner:1", command: "planner.cancel", runId: null },
        "planner.cancel",
      ),
    );
    await click("계획 생성 취소");
    expect(data.confirm).not.toHaveBeenCalled();
    expect(data.invoke.mock.calls[0]?.[0].input.request).toEqual({
      protocolVersion: 1,
      id: "owner:1",
      ownerId: "owner",
      expectedProjectRevision: 0,
      type: "planner.cancel",
      planId,
    });
    // The acknowledgement is not the outcome: RUNNING stays until the snapshot says otherwise.
    expect(words(render())).toContain("계획 취소 요청을 받았어요");
    expect(labelled(render(), "계획 담당 실행 중")).not.toBeNull();
    update({ planner: { ...plannerRunning, status: "CANCELLED", finishedAt: 5_000 } });
    expect(words(control(render(), ko.runtime.controls.planner))).toContain(
      "계획 생성을 취소했어요. 만든 초안은 없어요.",
    );
    expect(labelled(render(), "계획 담당 실행 중")).toBeNull();
    expect(control(render(), "계획 담당으로 초안 만들기").props.disabled).toBe(false);
    // Unknown time, usage and route are shown as such, never as zero.
    update({
      planner: { ...plannerRunning, route: null, usage: { invocations: 0, reportedTokens: null } },
    });
    data.observation = { ...data.observation!, observedAt: null };
    expect(words(control(render(), "계획 담당 실행 중"))).toContain(
      "계획 생성 중 · 경과 확인 안 됨 · 모델 경로 미보고 · 0 / 3회 모델 호출 · 보고된 토큰 확인 안 됨",
    );
  });
  it("loads the unreviewed proposal into the editor exactly as proposed and prepares nothing", async () => {
    advertisePlanner();
    enterPlannerRequest();
    update({ planner: plannerReady });
    const card = words(control(render(), "계획 담당 제안"));
    expect(card).toContain("계획 담당 제안 — 검토 전");
    expect(card).toContain(
      "2 개 작업 · models.intents.plan → reasoning → commandcode/deepseek/deepseek-v4.1-flash · 2 / 3회 모델 호출 · 보고된 토큰 3400",
    );
    expect(card).not.toContain("현재 정보 아님");
    expect(card).not.toContain("다른 목표 또는 기준");
    data.invoke.mockResolvedValue(readReply());
    await click("편집기로 불러오기");
    expect(data.invoke.mock.calls[0]?.[0].input.request).toEqual({
      protocolVersion: 1,
      id: "owner:1",
      ownerId: "owner",
      expectedProjectRevision: 0,
      type: "planner.read",
      planId,
    });
    // The editor was empty, so nothing is asked, and nothing but the rows changes.
    expect(data.confirm).not.toHaveBeenCalled();
    const tree = render();
    expect(control(tree, "작업 1 제목").props.value).toBe("Split parse module");
    expect(control(tree, "작업 1 목표").props.value).toBe("Move parsing into src/parse.ts");
    expect(control(tree, "작업 1 담당 범위 1 종류").props.value).toBe("create");
    expect(control(tree, "작업 1 담당 범위 1 경로").props.value).toBe("src/parse.ts");
    expect(control(tree, "작업 1의 검사 ID").props.value).toBe("test");
    expect(control(tree, "작업 2의 검사 ID").props.value).toBe("test lint");
    expect(control(tree, "작업 2의 선행 작업 1").props.checked).toBe(true);
    expect(control(tree, "작업 2의 수용 기준 연결 1").props.checked).toBe(false);
    expect(control(tree, "작업 2의 수용 기준 연결 2").props.checked).toBe(true);
    expect(control(tree, "워크플로 목표").props.value).toBe(plannerGoal);
    expect(words(control(tree, "불러온 계획 담당 제안"))).toContain(
      "준비하기 전에 각 작업·파일 담당 범위·검사를 검토해 주세요.",
    );
    expect(words(tree)).toContain("계획 담당 제안을 편집기로 불러왔어요.");
    // No automatic prepare or confirm: only the read was sent.
    await flush();
    expect(sentTypes()).toEqual(["planner.read"]);
    expect(labelled(render(), "Runtime 계획 미리보기")).toBeNull();
    // An explicit Prepare sends exactly the loaded draft, with no hidden edits.
    data.invoke.mockResolvedValue(
      AsyncResult.success(response({ kind: "prepared", preview: complexPreview })),
    );
    await submitPrepare();
    expect(data.invoke.mock.calls[1]?.[0].input.request).toMatchObject({
      type: "workflow.prepare",
      goal: plannerGoal,
      acceptanceStatements: plannerStatements,
      complexDraft: plannerDraft,
    });
    expect(data.invoke.mock.calls[1]?.[0].input.request.complexDraft).toEqual(plannerDraft);
    // The banner stays only while the editor holds the unchanged proposal.
    change("작업 1 제목", "Split the parse module");
    expect(labelled(render(), "불러온 계획 담당 제안")).toBeNull();
    change("작업 1 제목", "Split parse module");
    expect(labelled(render(), "불러온 계획 담당 제안")).not.toBeNull();
    toggle("작업 2의 수용 기준 연결 1");
    expect(labelled(render(), "불러온 계획 담당 제안")).toBeNull();
  });
  it("labels a non-current proposal and one planned for another goal or criteria", async () => {
    advertisePlanner();
    enterPlannerRequest();
    update({ planner: { ...plannerReady, current: false } });
    const card = () => words(control(render(), "계획 담당 제안"));
    expect(card()).toContain("현재 정보 아님");
    expect(card()).toContain("계획 생성 후 프로젝트나 설정이 바뀌었어요");
    expect(card()).not.toContain("다른 목표 또는 기준");
    for (const [label, apply, differs] of [
      [
        "reordered criteria",
        () => change("COMPLEX 수용 기준", plannerStatements.toReversed().join("\n")),
        true,
      ],
      ["original criteria", () => change("COMPLEX 수용 기준", plannerStatements.join("\n")), false],
      [
        "surrounding whitespace the request trims",
        () => change("워크플로 목표", `  ${plannerGoal}\n`),
        false,
      ],
      ["another goal", () => change("워크플로 목표", `${plannerGoal}!`), true],
    ] as const) {
      apply();
      expect([label, card().includes("다른 목표 또는 기준")]).toEqual([label, differs]);
      expect([label, card().includes("다른 목표 또는 기준")]).toEqual([label, differs]);
    }
    change("워크플로 목표", plannerGoal);
    data.invoke.mockResolvedValue(readReply({ current: false }));
    await click("편집기로 불러오기");
    const banner = () => words(control(render(), "불러온 계획 담당 제안"));
    expect(banner()).toContain("현재 상태와 다를 수 있어요");
    expect(banner()).not.toContain("다른 내용으로 만든 계획이에요");
    change("COMPLEX 수용 기준", plannerStatements[0]!);
    expect(banner()).toContain("다른 내용으로 만든 계획이에요");
    // The snapshot's live value wins while the Host still reports that request.
    update({ planner: { ...plannerReady, current: true } });
    expect(banner()).not.toContain("현재 상태와 다를 수 있어요");
  });
  it("asks before replacing different rows and keeps them when declined", async () => {
    await draftTwoTasks(2);
    advertisePlanner();
    update({ planner: plannerReady });
    data.invoke.mockResolvedValue(readReply());
    data.confirm.mockResolvedValueOnce(false);
    await click("편집기로 불러오기");
    expect(data.confirm).toHaveBeenCalledOnce();
    expect(data.confirm.mock.calls[0]?.[0]).toContain(
      "편집기의 2개 작업을 계획 담당이 제안한 2개 작업으로 바꿀까요?",
    );
    expect(control(render(), "작업 1 제목").props.value).toBe("Extract parser");
    expect(words(render())).toContain(
      "편집기의 작업 목록을 유지했어요. 새 내용을 불러오지 않았어요.",
    );
    expect(labelled(render(), "불러온 계획 담당 제안")).toBeNull();
    await click("편집기로 불러오기");
    expect(data.confirm).toHaveBeenCalledTimes(2);
    expect(control(render(), "작업 1 제목").props.value).toBe("Split parse module");
    // The unchanged proposal loads again without asking.
    await click("편집기로 불러오기");
    expect(data.confirm).toHaveBeenCalledTimes(2);
    expect(sentTypes()).toEqual(["planner.read", "planner.read", "planner.read"]);
  });
  it("never loads a draft of another planning request", async () => {
    advertisePlanner();
    enterPlannerRequest();
    update({ planner: plannerReady });
    data.invoke.mockResolvedValue(readReply({ planId: "0b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e" }));
    await click("편집기로 불러오기");
    expect(words(render())).toContain(
      "Runtime이 다른 계획 요청의 초안을 반환해 불러오지 않았어요.",
    );
    expect(labelled(render(), "작업 1")).toBeNull();
    expect(labelled(render(), "불러온 계획 담당 제안")).toBeNull();
  });
  it("discards a proposal only in this App and shows a new request's proposal again", async () => {
    advertisePlanner();
    enterPlannerRequest();
    update({ planner: plannerReady });
    await click("버리기");
    expect(labelled(render(), "계획 담당 제안")).toBeNull();
    expect(words(control(render(), ko.runtime.controls.planner))).toContain(
      "앱에서 제안을 버렸어요",
    );
    // The way back is local too.
    await click("제안 보기");
    expect(labelled(render(), "계획 담당 제안")).not.toBeNull();
    await click("버리기");
    expect(data.invoke).not.toHaveBeenCalled();
    expect(data.confirm).not.toHaveBeenCalled();
    update({ planner: { ...plannerReady, planId: "0b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e" } });
    expect(labelled(render(), "계획 담당 제안")).not.toBeNull();
  });
  it("explains each failure code with fixed text and never retries on its own", async () => {
    advertisePlanner();
    enterPlannerRequest();
    const codes: ReadonlyArray<WeavraPlannerFailureCode> = [
      "MODEL_UNAVAILABLE",
      "CONTEXT_TOO_LARGE",
      "TIMEOUT",
      "PROVIDER_ERROR",
      "BUDGET_EXHAUSTED",
      "BUDGET_UNKNOWN",
      "NO_DRAFT",
      "DRAFT_INVALID",
      "STALE",
    ];
    const explanations = new Set<string>();
    for (const failureCode of codes) {
      update({ planner: { ...plannerRunning, status: "FAILED", finishedAt: 2_000, failureCode } });
      const shown = words(control(render(), "계획 담당 실패"));
      expect(shown).toMatch(
        new RegExp(
          `^계획 담당 실패: ${failureCode} — .+ 초안을 만들지 못했어요\\. 준비되면 다시 요청해 주세요\\.$`,
        ),
      );
      explanations.add(shown.replace(failureCode, ""));
      expect(labelled(render(), "계획 담당 제안")).toBeNull();
      expect(control(render(), "계획 담당으로 초안 만들기").props.disabled).toBe(false);
    }
    expect(explanations.size).toBe(codes.length);
    expect(words(control(render(), "계획 담당 실패"))).toContain("초안을 폐기했어요");
    await flush();
    expect(data.invoke).not.toHaveBeenCalled();
  });
  it("shows Runtime refusals of planning with fixed guidance and no retry", async () => {
    advertisePlanner();
    enterPlannerRequest();
    const refusal: WeavraControlResponse = {
      protocolVersion: 1,
      type: "control_response",
      id: "owner:1",
      command: "planner.start",
      ownerId: "owner",
      runId: null,
      stateRevision: null,
      projectRevision: 0,
      eventId: null,
      timestamp: 1,
      success: false,
      error: { code: "UNSUPPORTED_WORKFLOW" },
    };
    data.invoke.mockResolvedValue(AsyncResult.success(refusal));
    await click("계획 담당으로 초안 만들기");
    await flush();
    expect(words(render())).toContain(
      "Runtime이 명령을 거부했어요: UNSUPPORTED_WORKFLOW. 계획 담당은 Runtime이 COMPLEX로 분류한 목표만 초안으로 만들며 R3는 처리하지 않아요.",
    );
    expect(sentTypes()).toEqual(["planner.start"]);
    // A confirm refused while planning runs is not turned into an implicit cancel (§8).
    update({ planner: plannerRunning });
    data.invoke.mockResolvedValue(AsyncResult.success(response({ kind: "prepared", preview })));
    await prepare();
    data.invoke.mockResolvedValue(
      AsyncResult.success({
        ...refusal,
        id: "owner:2",
        command: "workflow.confirm",
        error: { code: "PLANNER_BUSY" },
      }),
    );
    await click("확인 후 시작");
    await flush();
    expect(words(render())).toContain(
      "Runtime이 명령을 거부했어요: PLANNER_BUSY. Runtime이 아직 계획을 만들고 있어요. 먼저 계획을 취소해 주세요. 새 작업은 시작하지 않았어요.",
    );
    expect(sentTypes()).toEqual(["planner.start", "workflow.prepare", "workflow.confirm"]);
    expect(labelled(render(), "계획 담당 실행 중")).not.toBeNull();
  });
});

type RunStatus = NonNullable<WeavraControlState["snapshot"]["status"]["run"]>["status"];
/** The latest Run ended, but its writer lock remains, e.g. its owner died before releasing it. */
function staleLock(status: RunStatus = "BLOCKED", patch: Partial<WeavraControlState> = {}) {
  orphaned();
  const current = data.observation!.state!;
  update({
    snapshot: {
      ...current.snapshot,
      status: {
        ...current.snapshot.status,
        writerPresent: true,
        run: { ...current.snapshot.status.run!, status },
      },
    },
    ...patch,
  });
}
const staleNote = (tree: ReactElement<Record<string, unknown>>) =>
  labelled(tree, "최근 실행 종료 후 남은 쓰기 잠금");

describe("Prepare after a terminal Run left its writer lock (COMPLEX_RERUN.md §7)", () => {
  it("offers only workflow prepare after every terminal status, and says the Runtime decides", () => {
    advertisePlanner();
    enterPlannerRequest();
    for (const status of ["BLOCKED", "CANCELLED", "FAILED", "INTERRUPTED", "COMPLETED"] as const) {
      staleLock(status);
      const tree = render();
      expect([status, control(tree, "워크플로 준비").props.disabled]).toEqual([status, false]);
      expect(words(staleNote(tree))).toContain(
        `최근 실행이 종료됐지만 쓰기 잠금이 남아 있어요: ${weavraLabel(status)}`,
      );
      expect(orphanNote(tree)).toBeNull();
    }
    const tree = render();
    expect(words(staleNote(tree))).toContain("STALE_PROJECT가 반환되면");
    expect(words(staleNote(tree))).toContain("WRITER_PRESENT로 거부해요");
    // Every other gate that a writer blocks stays as it was.
    expect(control(tree, "사실 검토 준비").props.disabled).toBe(true);
    expect(control(tree, "계획 담당으로 초안 만들기").props.disabled).toBe(true);
    expect(visitElements(tree, (node) => text(node) === "워크플로 취소")).toBeNull();
    expect(data.invoke).not.toHaveBeenCalled();
  });
  it("keeps prepare disabled for this connection's own Run, busy, stale or disconnected views, and a lock without a Run", () => {
    change("워크플로 목표", preview.goal);
    staleLock();
    const base = data.observation!;
    const withoutRun = () =>
      update({
        snapshot: {
          ...base.state!.snapshot,
          status: { ...base.state!.snapshot.status, run: null },
        },
      });
    for (const [label, apply] of [
      ["this connection's own Run", () => update({ ownedRunId: "run-1" })],
      ["busy owner", () => update({ busy: true })],
      [
        "stale observation",
        () => {
          data.observation = { ...base, stale: true };
        },
      ],
      [
        "disconnected environment",
        () => {
          data.phase = "disconnected";
        },
      ],
      ["writer lock without any Run", withoutRun],
    ] as const) {
      data.observation = base;
      data.phase = "connected";
      apply();
      const tree = render();
      expect([label, control(tree, "워크플로 준비").props.disabled]).toEqual([label, true]);
      expect([label, staleNote(tree)]).toEqual([label, null]);
    }
    expect(data.invoke).not.toHaveBeenCalled();
  });
  it("sends one plain prepare and, after STALE_PROJECT, waits for fresh state and an explicit retry", async () => {
    staleLock("INTERRUPTED");
    change("워크플로 목표", preview.goal);
    data.invoke.mockResolvedValue(AsyncResult.success(refused("STALE_PROJECT")));
    await submitPrepare();
    expect(data.invoke.mock.calls[0]?.[0].input.request).toEqual({
      protocolVersion: 1,
      id: "owner:2",
      ownerId: "owner",
      expectedProjectRevision: 9,
      type: "workflow.prepare",
      goal: preview.goal,
    });
    expect(words(render())).toContain(
      "Runtime이 명령을 거부했어요: STALE_PROJECT. 계획 준비 전에 프로젝트 상태가 바뀌었어요",
    );
    expect(words(render())).toContain(
      "준비나 재시도는 하지 않았으니 새 상태를 확인한 뒤 다시 준비해 주세요.",
    );
    await flush();
    expect(data.invoke).toHaveBeenCalledOnce();
    // The fresh read shows the lock released; prepare is the ordinary one again.
    const current = data.observation!.state!;
    update({
      projectRevision: 10,
      nextRequestId: "owner:3",
      snapshot: {
        ...current.snapshot,
        status: { ...current.snapshot.status, writerPresent: false },
      },
    });
    expect(staleNote(render())).toBeNull();
    data.invoke.mockResolvedValue(AsyncResult.success(response({ kind: "prepared", preview })));
    await submitPrepare();
    expect(data.invoke.mock.calls[1]?.[0].input.request).toMatchObject({
      id: "owner:3",
      expectedProjectRevision: 10,
      type: "workflow.prepare",
    });
  });
  it("reports a live owner's WRITER_PRESENT once and keeps the lock in view", async () => {
    staleLock();
    change("워크플로 목표", preview.goal);
    data.invoke.mockResolvedValue(AsyncResult.success(refused("WRITER_PRESENT")));
    await submitPrepare();
    await flush();
    expect(words(render())).toContain("Runtime이 명령을 거부했어요: WRITER_PRESENT.");
    expect(data.invoke).toHaveBeenCalledOnce();
    expect(staleNote(render())).not.toBeNull();
  });
});

// V0.8C re-run (docs/architecture/COMPLEX_RERUN.md §7): a candidate draft for the editor only.
const blockedRow: ComplexRow = {
  ...idleRow("CT-002"),
  status: "BLOCKED",
  attempt: 1,
  workerInvocations: 2,
  entryWorkspaceDigest: "2".repeat(64),
  changedFiles: ["src/validate.ts"],
  selfCheck: "FAIL",
  failureCode: "CHECK_FAILED",
};
const derivedData: WeavraDerivedDraft = {
  kind: "derived-draft",
  runId: "run-1",
  sourcePlanDigest: complexPlan.complexPlanDigest,
  sourceStatus: "BLOCKED",
  goal: preview.goal,
  acceptanceStatements: ["Parse input", "Validate input"],
  draft: {
    tasks: [
      {
        title: "Verify: Extract parser",
        goal: "Re-verify without changes: Move parsing into src/parse.ts",
        dependsOnIndexes: [],
        criterionIndexes: [1],
        ownership: [],
        checkIds: ["test"],
      },
      {
        title: "Add validation",
        goal: "Reject duplicate keys",
        dependsOnIndexes: [1],
        criterionIndexes: [2],
        ownership: [{ path: "src/validate.ts", operation: "modify" }],
        checkIds: ["test", "lint"],
      },
    ],
  },
  prepareCheck: { ok: true, code: null },
  leftovers: {
    clean: false,
    paths: ["src/config.ts", "src/parse.ts", "src/validate.ts"],
    truncated: false,
  },
  notes: ["CT-002 claim src/validate.ts: create became modify (file exists)"],
};
const derivedReply = (patch: Partial<WeavraDerivedDraft> = {}) =>
  AsyncResult.success({
    ...response({ ...derivedData, ...patch }),
    command: "workflow.derive",
  });
function advertiseRerun() {
  if (data.observation!.capabilities!.complexContractVersion === undefined) advertiseComplex(2);
  data.observation = {
    ...data.observation!,
    capabilities: { ...data.observation!.capabilities!, rerunContractVersion: 1 },
  };
}
/** The latest COMPLEX Run ended: CT-001 COMPLETED, CT-002 unfinished, the writer released. */
function endedComplex(
  status: RunStatus = "BLOCKED",
  patch: { risk?: "R1" | "R3"; tasks?: ComplexRow[] } = {},
) {
  complexRunning();
  const current = data.observation!.state!;
  update({
    busy: false,
    complexExecution: complexExecution({
      phase: "TERMINAL",
      tasks: patch.tasks ?? [completedTask("CT-001", "STALE"), blockedRow],
      integration: {
        check: "NOT_RUN",
        review: "NOT_RUN",
        test: "NOT_RUN",
        workspaceDigest: null,
        evidenceFreshness: "NONE",
        failureCode: null,
      },
      failureCode: "CHECK_FAILED",
    }),
    snapshot: {
      ...current.snapshot,
      status: {
        ...current.snapshot.status,
        writerPresent: false,
        run: { ...current.snapshot.status.run!, status, risk: patch.risk ?? "R1" },
      },
    },
  });
}
const derivedPanel = () => words(control(render(), "다시 실행할 작업 초안"));
async function loadDerived(patch: Partial<WeavraDerivedDraft> = {}) {
  data.invoke.mockResolvedValue(derivedReply(patch));
  await click(
    labelled(render(), "다시 실행할 작업 초안") ? "초안 다시 만들기" : "미완료 작업 다시 계획",
  );
}

describe("V0.8C re-run of unfinished COMPLEX work", () => {
  it("renders nothing about re-run and sends no derive without the capability", async () => {
    const rerunSurface = (tree: ReactElement<Record<string, unknown>>) =>
      visitElements(
        tree,
        (node) =>
          /re-plan|deriv|unfinished/i.test(String(node.props["aria-label"] ?? "")) ||
          (node.type === "button" && /re-plan|deriv/i.test(text(node))),
      );
    for (const runtime of ["baseline", "COMPLEX v1", "COMPLEX v2 with Planner"]) {
      if (runtime === "COMPLEX v1") advertiseComplex(1);
      if (runtime === "COMPLEX v2 with Planner") advertisePlanner();
      endedComplex();
      expect([runtime, rerunSurface(render())]).toEqual([runtime, null]);
      expect([runtime, /re-plan|deriv/i.test(words(render()))]).toEqual([runtime, false]);
    }
    // The COMPLEX projection and every other control stay as they were.
    expect(visitElements(render(), (node) => node.type === ComplexExecutionView)).not.toBeNull();
    await prepare();
    expect(sentTypes()).toEqual(["workflow.prepare"]);
  });
  it("offers Re-plan unfinished work only for the latest terminal non-R3 COMPLEX Run with unfinished tasks on a current connection", () => {
    advertiseRerun();
    const offered = () => labelled(render(), "미완료 COMPLEX 작업");
    for (const status of ["BLOCKED", "CANCELLED", "FAILED", "INTERRUPTED"] as const) {
      endedComplex(status);
      expect([status, offered() !== null]).toEqual([status, true]);
      expect(control(render(), "미완료 작업 다시 계획").props.disabled).toBe(false);
    }
    expect(words(offered())).toContain("실행 run-1 종료 상태: 중단됨");
    expect(words(offered())).toContain(
      "이전 작업·증거를 재사용하지 않으며 직접 준비·확인하기 전에는 시작하지 않아요.",
    );
    const base = data.observation!;
    const allCompleted = [completedTask("CT-001", "STALE"), completedTask("CT-002", "CURRENT")];
    for (const [label, apply] of [
      ["COMPLETED Run", () => endedComplex("COMPLETED", { tasks: allCompleted })],
      ["running Run", () => complexRunning()],
      ["every task COMPLETED", () => endedComplex("BLOCKED", { tasks: allCompleted })],
      ["R3 Run", () => endedComplex("BLOCKED", { risk: "R3" })],
      [
        "no COMPLEX projection",
        () => {
          const { complexExecution: _execution, ...withoutProjection } = base.state!;
          data.observation = { ...base, state: withoutProjection };
        },
      ],
      [
        "stale observation",
        () => {
          data.observation = { ...base, stale: true };
        },
      ],
      [
        "disconnected environment",
        () => {
          data.phase = "disconnected";
        },
      ],
      [
        "control not supported",
        () => {
          data.support = "unsupported";
        },
      ],
    ] as const) {
      data.observation = base;
      data.phase = "connected";
      data.support = "supported";
      apply();
      expect([label, offered()]).toEqual([label, null]);
    }
    data.observation = base;
    data.phase = "connected";
    data.support = "supported";
    // A busy owner shows it disabled. A writer lock does not hide it: deriving is read-only (§3).
    update({ busy: true });
    expect(control(render(), "미완료 작업 다시 계획").props.disabled).toBe(true);
    update({
      busy: false,
      snapshot: {
        ...base.state!.snapshot,
        status: { ...base.state!.snapshot.status, writerPresent: true },
      },
    });
    expect(control(render(), "미완료 작업 다시 계획").props.disabled).toBe(false);
    expect(data.invoke).not.toHaveBeenCalled();
  });
  it("derives on click, then fills the goal, criteria and rows exactly and prepares nothing", async () => {
    advertiseRerun();
    endedComplex();
    await loadDerived();
    expect(data.invoke.mock.calls[0]?.[0].input.request).toEqual({
      protocolVersion: 1,
      id: "owner:2",
      ownerId: "owner",
      expectedProjectRevision: 9,
      type: "workflow.derive",
      runId: "run-1",
    });
    // The editor was empty, so nothing was asked.
    expect(data.confirm).not.toHaveBeenCalled();
    const tree = render();
    expect(control(tree, "워크플로 목표").props.value).toBe(preview.goal);
    expect(control(tree, "COMPLEX 수용 기준").props.value).toBe("Parse input\nValidate input");
    expect(control(tree, "작업 1 제목").props.value).toBe("Verify: Extract parser");
    expect(control(tree, "작업 1 목표").props.value).toBe(
      "Re-verify without changes: Move parsing into src/parse.ts",
    );
    expect(labelled(tree, "작업 1 담당 범위 1 경로")).toBeNull();
    expect(control(tree, "작업 1의 검사 ID").props.value).toBe("test");
    expect(control(tree, "작업 2 담당 범위 1 종류").props.value).toBe("modify");
    expect(control(tree, "작업 2 담당 범위 1 경로").props.value).toBe("src/validate.ts");
    expect(control(tree, "작업 2의 검사 ID").props.value).toBe("test lint");
    expect(control(tree, "작업 2의 선행 작업 1").props.checked).toBe(true);
    expect(control(tree, "작업 2의 수용 기준 연결 1").props.checked).toBe(false);
    expect(control(tree, "작업 2의 수용 기준 연결 2").props.checked).toBe(true);
    expect(derivedPanel()).toContain(
      "초안의 원본 실행: run-1 (BLOCKED): 완료한 작업 하나를 읽기 전용 검증 작업으로 바꿔 다시 검사해요. 미완료 작업은 담당 범위를 유지하며 파일이 이미 있으면 생성 대신 수정으로 바꿔요. 준비 전에 검토해 주세요.",
    );
    expect(derivedPanel()).toContain(
      "파일 담당 범위는 초안 생성 시점의 파일을 기준으로 해요. 남은 변경을 직접 커밋하거나 정리한 뒤 초안을 다시 만들어",
    );
    expect(words(tree)).toContain("다음 실행의 초안을 편집기로 불러왔어요: run-1.");
    // No automatic prepare or confirm: only the derive was sent.
    await flush();
    expect(sentTypes()).toEqual(["workflow.derive"]);
    expect(labelled(render(), "Runtime 계획 미리보기")).toBeNull();
    // An explicit Prepare sends exactly the derived goal, criteria and draft.
    data.invoke.mockResolvedValue(
      AsyncResult.success(response({ kind: "prepared", preview: complexPreview })),
    );
    await submitPrepare();
    expect(data.invoke.mock.calls[1]?.[0].input.request).toMatchObject({
      type: "workflow.prepare",
      goal: preview.goal,
      acceptanceStatements: ["Parse input", "Validate input"],
    });
    expect(data.invoke.mock.calls[1]?.[0].input.request.complexDraft).toEqual(derivedData.draft);
    expect(sentTypes()).toEqual(["workflow.derive", "workflow.prepare"]);
  });
  it("counts the completed tasks that become verification tasks from the source Run", async () => {
    advertiseRerun();
    endedComplex("INTERRUPTED", {
      tasks: [{ ...blockedRow, id: "CT-001", status: "INTERRUPTED" }, blockedRow],
    });
    await loadDerived({ sourceStatus: "INTERRUPTED" });
    expect(derivedPanel()).toContain(
      "초안의 원본 실행: run-1 (INTERRUPTED): 0개 완료 작업을 읽기 전용 검증 작업으로 바꿔 다시 검사해요.",
    );
  });
  it("keeps the banner only while the editor would prepare exactly the derived draft", async () => {
    advertiseRerun();
    endedComplex();
    await loadDerived();
    expect(derivedPanel()).toContain("초안의 원본 실행: run-1 (BLOCKED)");
    for (const [label, apply, revert] of [
      [
        "task title",
        () => change("작업 1 제목", "Verify parser"),
        () => change("작업 1 제목", "Verify: Extract parser"),
      ],
      [
        "claim operation",
        () => change("작업 2 담당 범위 1 종류", "create"),
        () => change("작업 2 담당 범위 1 종류", "modify"),
      ],
      [
        "criteria",
        () => change("COMPLEX 수용 기준", "Parse input"),
        () => change("COMPLEX 수용 기준", "Parse input\nValidate input"),
      ],
      [
        "goal",
        () => change("워크플로 목표", "Fix another bug"),
        () => change("워크플로 목표", preview.goal),
      ],
    ] as const) {
      apply();
      expect([label, derivedPanel().includes("초안의 원본 실행")]).toEqual([label, false]);
      expect(derivedPanel()).toContain("편집기의 내용이 생성된 초안에서 바뀌었어요.");
      // The leftovers and the dry-run stay in view; they describe the draft as derived.
      expect(derivedPanel()).toContain(
        "이 변경을 직접 커밋하거나 정리하기 전에는 새 실행을 시작할 수 없어요",
      );
      revert();
      expect([label, derivedPanel().includes("초안의 원본 실행: run-1 (BLOCKED)")]).toEqual([
        label,
        true,
      ]);
    }
    // Whitespace that Prepare trims is not an edit.
    change("워크플로 목표", `  ${preview.goal}\n`);
    expect(derivedPanel()).toContain("초안의 원본 실행: run-1 (BLOCKED)");
    // Discarding the task plan is the way out.
    await click("작업 계획 비우기");
    expect(labelled(render(), "다시 실행할 작업 초안")).toBeNull();
    expect(sentTypes()).toEqual(["workflow.derive"]);
  });
  it("asks before replacing a non-empty editor that differs, and keeps it when declined", async () => {
    advertiseRerun();
    endedComplex();
    change("워크플로 목표", "My own goal");
    data.confirm.mockResolvedValueOnce(false);
    await loadDerived();
    expect(data.confirm).toHaveBeenCalledOnce();
    expect(data.confirm.mock.calls[0]?.[0]).toContain(
      "편집기의 목표·수용 기준·작업을 다음 실행에서 만든 초안으로 바꿀까요? 실행 run-1 (BLOCKED)",
    );
    expect(control(render(), "워크플로 목표").props.value).toBe("My own goal");
    expect(labelled(render(), "작업 1")).toBeNull();
    expect(labelled(render(), "다시 실행할 작업 초안")).toBeNull();
    expect(words(render())).toContain(
      "편집기의 목표·수용 기준·작업 목록을 유지했어요. 새 내용을 불러오지 않았어요.",
    );
    await loadDerived();
    expect(data.confirm).toHaveBeenCalledTimes(2);
    expect(control(render(), "워크플로 목표").props.value).toBe(preview.goal);
    // The editor holds exactly this draft, so the same derivation loads again without asking.
    await loadDerived();
    expect(data.confirm).toHaveBeenCalledTimes(2);
    expect(sentTypes()).toEqual(["workflow.derive", "workflow.derive", "workflow.derive"]);
  });
  it("derives again after leftovers are resolved, asking before it replaces the earlier draft", async () => {
    advertiseRerun();
    endedComplex();
    await loadDerived();
    const [verify, unfinished] = derivedData.draft.tasks;
    await loadDerived({
      draft: {
        tasks: [
          verify!,
          { ...unfinished!, ownership: [{ path: "src/validate.ts", operation: "create" }] },
        ],
      },
      leftovers: { clean: true, paths: [], truncated: false },
      notes: [],
    });
    expect(data.invoke.mock.calls[1]?.[0].input.request).toMatchObject({
      type: "workflow.derive",
      runId: "run-1",
    });
    // The editor held the earlier derived rows; they differ from the new ones.
    expect(data.confirm).toHaveBeenCalledOnce();
    expect(control(render(), "작업 2 담당 범위 1 종류").props.value).toBe("create");
    expect(words(control(render(), "남은 변경사항"))).toBe(
      "초안 생성 시 남은 변경사항이 없었어요.",
    );
    expect(derivedPanel()).toContain("초안의 원본 실행: run-1 (BLOCKED)");
    expect(labelled(render(), "초안 생성 메모")).toBeNull();
    expect(sentTypes()).toEqual(["workflow.derive", "workflow.derive"]);
  });
  it("lists leftovers and never claims a clean checkout unless the Runtime reports it", async () => {
    advertiseRerun();
    endedComplex();
    const leftovers = () => words(control(render(), "남은 변경사항"));
    await loadDerived({
      leftovers: { clean: false, paths: ["src/[id].tsx", "src/config.ts"], truncated: false },
    });
    expect(leftovers()).toContain(
      "이 변경을 직접 커밋하거나 정리하기 전에는 새 실행을 시작할 수 없어요. Runtime은 둘 다 자동으로 하지 않아요.",
    );
    expect(leftovers()).toContain("src/[id].tsx");
    expect(leftovers()).toContain("src/config.ts");
    expect(leftovers()).not.toContain("표시하지 못한 변경이 더 있어요");
    expect(leftovers()).not.toContain("초안 생성 시 남은 변경사항이 없었어요");
    await loadDerived({ leftovers: { clean: false, paths: ["src/config.ts"], truncated: true } });
    expect(leftovers()).toContain(
      "표시하지 못한 변경이 더 있어요. 목록은 경로 200개 또는 16,384바이트까지 표시해요.",
    );
    await loadDerived({ leftovers: { clean: null, paths: [], truncated: false } });
    expect(leftovers()).toContain("작업 공간 상태를 확인할 수 없어요");
    expect(leftovers()).not.toContain("초안 생성 시 남은 변경사항이 없었어요");
    expect(leftovers()).not.toContain("이 변경을 직접 커밋하거나 정리하기 전에는");
    await loadDerived({ leftovers: { clean: true, paths: [], truncated: false } });
    expect(leftovers()).toBe("초안 생성 시 남은 변경사항이 없었어요.");
    // Only the leftovers differed between these derivations, so nothing was asked.
    expect(data.confirm).not.toHaveBeenCalled();
  });
  it("shows the prepare dry-run result and every note", async () => {
    advertiseRerun();
    endedComplex();
    await loadDerived();
    expect(words(control(render(), "준비 검사"))).toBe(
      "초안 생성 시 준비 검사를 통과했어요. 미리보기가 아니며 준비 시 편집기 내용을 다시 검사해요.",
    );
    const notes = [
      "CT-001 completed files missing: src/parse.ts; a verification task cannot recreate them",
      "CT-002 claim src/validate.ts: modify target is missing",
    ];
    await loadDerived({ prepareCheck: { ok: false, code: "INVALID_CRITERIA" }, notes });
    expect(words(control(render(), "준비 검사"))).toBe(
      "초안 생성 시 준비 검사에서 거부됨: INVALID_CRITERIA. 메모에서 사유를 확인하고 작업 계획을 수정한 뒤 준비해 주세요.",
    );
    const listed = elements(control(render(), "초안 생성 메모"), "li").map((item) => text(item));
    expect(listed).toEqual(notes);
  });
  it("never loads a draft of another Run, or criteria the editor cannot hold exactly", async () => {
    advertiseRerun();
    endedComplex();
    await loadDerived({ runId: "other-run" });
    expect(words(render())).toContain(
      "Runtime이 요청한 실행과 다른 초안을 반환해 불러오지 않았어요.",
    );
    expect(labelled(render(), "작업 1")).toBeNull();
    await loadDerived({ acceptanceStatements: ["Parse input\nand keep it", "Validate input"] });
    expect(words(render())).toContain("한 줄에 하나씩 편집하면 원문이 달라져요. 불러오지 않았으니");
    expect(labelled(render(), "작업 1")).toBeNull();
    expect(labelled(render(), "다시 실행할 작업 초안")).toBeNull();
    expect(control(render(), "워크플로 목표").props.value).toBe("");
    expect(data.confirm).not.toHaveBeenCalled();
  });
  it("shows Runtime refusals of derive with fixed guidance and no retry", async () => {
    advertiseRerun();
    endedComplex();
    const refusal = (
      code: "RERUN_NOT_APPLICABLE" | "RUN_NOT_FOUND" | "ACTIVE_RUN" | "STALE_PROJECT",
    ) =>
      AsyncResult.success({
        ...refused("STALE_PROJECT"),
        command: "workflow.derive",
        error: { code },
      });
    for (const [code, hint] of [
      ["RERUN_NOT_APPLICABLE", "R3는 제외해요. 초안을 만들지 않았어요."],
      ["RUN_NOT_FOUND", "해당 실행이 더 이상 최신 실행이 아니어서 초안을 만들지 않았어요."],
      ["ACTIVE_RUN", "프로젝트나 Runtime에 활성 실행이 있어 초안을 만들지 않았어요."],
      ["STALE_PROJECT", "초안을 만들지 않았으니 새 상태가 표시되면 다시 요청해 주세요."],
    ] as const) {
      data.invoke.mockResolvedValue(refusal(code));
      await click("미완료 작업 다시 계획");
      await flush();
      expect(words(render())).toContain(`Runtime이 명령을 거부했어요: ${code}.${" "}`);
      expect(words(render())).toContain(hint);
    }
    expect(sentTypes()).toEqual(Array(4).fill("workflow.derive"));
    expect(labelled(render(), "다시 실행할 작업 초안")).toBeNull();
  });
  it("gives the editor one origin: a Planner load and a derived load replace each other's banner", async () => {
    advertisePlanner();
    advertiseRerun();
    endedComplex();
    await loadDerived();
    update({ planner: plannerReady });
    data.invoke.mockResolvedValue(readReply());
    await click("편집기로 불러오기");
    expect(labelled(render(), "다시 실행할 작업 초안")).toBeNull();
    expect(labelled(render(), "불러온 계획 담당 제안")).not.toBeNull();
    await loadDerived();
    expect(labelled(render(), "불러온 계획 담당 제안")).toBeNull();
    expect(labelled(render(), "다시 실행할 작업 초안")).not.toBeNull();
    expect(sentTypes()).toEqual(["workflow.derive", "planner.read", "workflow.derive"]);
  });
});

describe("project context after preflight failure", () => {
  function details() {
    const panel = visitElements(render(), (node) => node.type === WeavraPreflightFailure);
    if (!isValidElement<ComponentProps<typeof WeavraPreflightFailure>>(panel)) {
      throw new Error("Missing preflight failure panel");
    }
    return WeavraPreflightFailure(panel.props);
  }

  it("shows current machine configuration values without starting another command", () => {
    const base = state();
    update({
      startFailure: "START_FAILED",
      snapshot: {
        ...base.snapshot,
        configuration: {
          source: "project-config-not-frozen-run-config",
          status: "configured",
          registeredCheckCount: 7,
          requiredCheckCount: 3,
          modes: {
            workflow: "adaptive",
            mutation: "strict",
            verifierTrust: "strict",
            verifierSandbox: "required",
            verificationRepair: "disabled",
            taskContext: "bounded",
            impact: "bounded",
            documentation: "disabled",
          },
        },
      },
    });
    expect(elements(details(), "dd").map((item) => text(item))).toEqual([
      "configured",
      "7",
      "3",
      "adaptive",
      "strict",
      "strict",
      "required",
      "disabled",
      "bounded",
      "bounded",
      "disabled",
    ]);
    expect(data.invoke).not.toHaveBeenCalled();
  });

  it("keeps missing configuration distinct from zero registered checks", () => {
    update({ startFailure: "START_FAILED" });
    expect(elements(details(), "dd").map((item) => text(item))).toEqual([
      "missing",
      "확인 안 됨",
      "확인 안 됨",
    ]);
  });

  it("withholds cached configuration after the observation becomes stale", () => {
    update({ startFailure: "START_FAILED" });
    expect(elements(details(), "dd")).toHaveLength(3);
    const current = data.observation;
    if (!current) throw new Error("Missing observation fixture");
    data.observation = { ...current, stale: true };
    expect(elements(details(), "dd")).toHaveLength(0);
    expect(data.invoke).not.toHaveBeenCalled();
  });

  it("does not show a failure panel when no start failed", () => {
    expect(visitElements(render(), (node) => node.type === WeavraPreflightFailure)).toBeNull();
  });
});
