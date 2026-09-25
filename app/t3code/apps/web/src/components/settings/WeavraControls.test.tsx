import type * as ControlState from "@t3tools/client-runtime/state/weavraControl";
import type * as React from "react";
import type { ReactElement } from "react";
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
  type WeavraFactPreview,
  type WeavraPlannerFailureCode,
  type WeavraPlannerStatus,
} from "@t3tools/contracts";
import { plannerRequestDigest } from "@t3tools/client-runtime/state/weavraControl";
import { AsyncResult } from "effect/unstable/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { reactHookHarness as hooks } from "../../test/reactHookHarness";
import { visitElements } from "../../test/reactElementTree";

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
import { WeavraControls } from "./WeavraControls";
import { ComplexExecutionView, ComplexPlanView } from "./WeavraComplex";

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
  change("Workflow goal", preview.goal);
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
  change("Fact source", factPreview.sourceRef);
  change("Fact statement", factPreview.statement);
  const section = control(render(), "Reviewed Project Facts");
  const form = visitElements(section, (node) => node.type === "form")!;
  (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault() {} });
  await flush();
  update({ factPreview, nextRequestId: "owner:2" });
}
describe("Reviewed Project Facts authority and freshness", () => {
  it("requires explicit review and waits for canonical validity rather than promoting an ACK", async () => {
    await prepareFact();
    data.confirm.mockResolvedValueOnce(false);
    await click("Confirm reviewed fact");
    expect(data.invoke).toHaveBeenCalledTimes(1);
    data.invoke.mockResolvedValue(
      AsyncResult.success(response({ kind: "fact-confirmed", factId: "fact-1" })),
    );
    await click("Confirm reviewed fact");
    expect(data.confirm).toHaveBeenLastCalledWith(
      expect.stringContaining(factPreview.sourceDigest),
    );
    expect(text(control(render(), "Canonical Project Facts"))).not.toContain("Reviewed statement");
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
    expect(text(control(render(), "Canonical Project Facts"))).toContain("Reviewed statement");
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
    expect(text(control(render(), "Canonical Project Facts"))).not.toContain("Reviewed statement");
    expect(text(control(render(), "Canonical Project Facts"))).toContain("STALE");
  });
  it("rejects changed drafts and disconnected observations across an outstanding confirmation modal", async () => {
    await prepareFact();
    let resolve!: (value: boolean) => void;
    data.confirm.mockReturnValue(
      new Promise<boolean>((done) => {
        resolve = done;
      }),
    );
    await click("Confirm reviewed fact");
    data.phase = "disconnected";
    render();
    resolve(true);
    await flush();
    expect(data.invoke).toHaveBeenCalledTimes(1);
    data.phase = "connected";
    change("Fact statement", "Changed after review");
    expect(
      visitElements(render(), (node) => node.props["aria-label"] === "Runtime Fact Preview"),
    ).toBeNull();
  });
});

describe("Weavra workflow control interactions", () => {
  it("prepares goal and optional recipe as data, then presents Runtime-owned plan and editable criteria", async () => {
    change("Reviewed recipe", "bug-fix");
    expect(control(render(), "Recipe inputs").props.value).toBe('{"expected":"correct result"}');
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
    const plan = control(render(), "Runtime Plan Preview");
    expect(text(plan)).toContain("STANDARD");
    expect(text(plan)).toContain("strict");
    expect(text(plan)).toContain("unit checks");
    expect(control(render(), "Confirm and start").props.disabled).toBe(false);
    change("Acceptance criteria", "A revised observable outcome");
    expect(control(render(), "Confirm and start").props.disabled).toBe(true);
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
    change("Workflow goal", "Fix a different bug");
    expect(
      visitElements(render(), (node) => node.props["aria-label"] === "Runtime Plan Preview"),
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
    await click("Confirm and start");
    expect(data.confirm).toHaveBeenCalledOnce();
    expect(data.confirm.mock.calls[0]?.[0]).toContain("/trusted/project");
    expect(data.invoke.mock.calls[1]?.[0].input.request).toMatchObject({
      type: "workflow.confirm",
      previewId: preview.previewId,
      previewDigest: digest,
    });
    expect(text(render())).toContain("Start accepted");
    expect(text(render())).not.toContain("Canonical Run:");
  });
  it("invalidates preview after canonical revision, owner or Runtime preview changes", async () => {
    await prepare();
    data.observation = { ...data.observation!, observedAt: preview.expiresAt };
    expect(control(render(), "Confirm and start").props.disabled).toBe(true);
    data.observation = { ...data.observation!, observedAt: 1 };
    update({ projectRevision: 1 });
    expect(control(render(), "Confirm and start").props.disabled).toBe(true);
    update({ projectRevision: 0, ownerId: "replacement" });
    expect(control(render(), "Confirm and start").props.disabled).toBe(true);
    update({ ownerId: "owner", preview: null });
    expect(control(render(), "Confirm and start").props.disabled).toBe(true);
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
    await click("Cancel workflow");
    expect(data.invoke).not.toHaveBeenCalled();
    expect(data.confirm.mock.calls[0]?.[0]).toContain("Partial workspace changes remain");
    expect(text(render())).toContain("submitting");
    decide(true);
    await flush();
    expect(data.invoke).toHaveBeenCalledOnce();
    expect(text(render())).toContain("Cancellation accepted");
    expect(text(render())).toContain("RUNNING");
    expect(text(render())).toContain("Writer present:  true");
    expect(text(render())).not.toContain("CANCELLED");
  });
  it("cancels no Run when confirmation is declined or its revision becomes stale", async () => {
    running();
    data.confirm.mockResolvedValue(false);
    await click("Cancel workflow");
    expect(data.invoke).not.toHaveBeenCalled();
    let decide!: (value: boolean) => void;
    data.confirm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          decide = resolve;
        }),
    );
    await click("Cancel workflow");
    update({ stateRevision: 8 });
    render();
    decide(true);
    await flush();
    expect(data.invoke).not.toHaveBeenCalled();
    expect(text(render())).toContain("Runtime view changed");
  });
  it("renders only the pending one-file grant and rejects without optimistic authority", async () => {
    running(true);
    accepted("approval.resolve");
    const card = control(render(), "Pending R3 approval");
    expect(text(card)).toContain("src/old.js");
    expect(text(card)).toContain("approval-1");
    expect(text(card)).toContain("b".repeat(64));
    await click("Reject");
    expect(data.confirm).not.toHaveBeenCalled();
    expect(data.invoke.mock.calls[0]?.[0].input.request).toMatchObject({
      type: "approval.resolve",
      approvalId: "approval-1",
      runId: "run-1",
      decision: "reject",
      expectedStateRevision: 7,
    });
    expect(text(render())).toContain("WAITING_APPROVAL");
    expect(text(render())).not.toContain("BLOCKED");
    update({ pendingApproval: null });
    expect(
      visitElements(render(), (node) => node.props["aria-label"] === "Pending R3 approval"),
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
    const button = control(render(), "Approve once");
    (button.props.onClick as () => void)();
    (button.props.onClick as () => void)();
    await flush();
    expect(data.confirm).toHaveBeenCalledOnce();
    expect(data.confirm.mock.calls[0]?.[0]).toContain("ONE deletion");
    expect(data.invoke).toHaveBeenCalledOnce();
    expect(text(render())).toContain("submitting");
    expect(control(render(), "Reject").props.disabled).toBe(true);
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
    expect(text(render())).toContain("WAITING_APPROVAL");
    expect(text(render())).not.toContain("COMPLETED");
  });
  it("shows transport uncertainty without converting the Run into failure or retrying", async () => {
    running();
    data.invoke.mockRejectedValue(new Error("PRIVATE_TRANSPORT_MARKER"));
    await click("Cancel workflow");
    expect(text(render())).toContain("Transport error");
    expect(text(render())).toContain("RUNNING");
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
    expect(control(render(), "Confirm and start").props.disabled).toBe(true);
    data.phase = "connected";
    data.observation = { ...data.observation!, stale: true };
    expect(control(render(), "Confirm and start").props.disabled).toBe(true);
    data.observation = { ...data.observation!, stale: false };
    data.support = "unsupported";
    expect(control(render(), "Confirm and start").props.disabled).toBe(true);
    expect(data.invoke).toHaveBeenCalledOnce();
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
  await click("Refresh browser evidence");
  update({ nextRequestId: "owner:2" });
}
async function prepareBrowser() {
  await inspectBrowser();
  await click("Review this candidate");
  change("Browser check name", "status-ready");
  change("Browser expected value", "Reviewed Ready");
  data.invoke.mockResolvedValue(
    AsyncResult.success(response({ kind: "browser-prepared", preview: browserPreview })),
  );
  const form = control(render(), "Browser expectation editor");
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
    expect(control(tree, "Browser expected value").props.value).toBe("Reviewed Ready");
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
    expect(control(tree, "Confirm browser registration").props.disabled).toBe(false);
  });
  it("invalidates the reviewed preview when the expectation changes", async () => {
    await prepareBrowser();
    change("Browser expected value", "Different expectation");
    expect(control(render(), "Confirm browser registration").props.disabled).toBe(true);
    expect(data.invoke).toHaveBeenCalledTimes(2);
  });
  it("does not register when explicit confirmation is declined", async () => {
    await prepareBrowser();
    data.confirm.mockResolvedValue(false);
    await click("Confirm browser registration");
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
    const button = control(render(), "Confirm browser registration");
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
        (node) => node.props["aria-label"] === "Runtime browser registration preview",
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
    await click("Confirm browser registration");
    change("Browser expected value", "Changed during review");
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
    await click("Confirm browser registration");
    update({ browserPreview: { ...browserPreview, previewId: "replacement-preview" } });
    render();
    decide(true);
    await flush();
    expect(data.invoke).toHaveBeenCalledTimes(2);
  });
  it("disables historical browser state after owner replacement or disconnection without replay", async () => {
    await prepareBrowser();
    update({ ownerId: "new-owner", browserPreview: null });
    expect(control(render(), "Confirm browser registration").props.disabled).toBe(true);
    data.phase = "disconnected";
    expect(control(render(), "Refresh browser evidence").props.disabled).toBe(true);
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
    expect(text(tree)).toContain("UNAVAILABLE");
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
  change("Workflow goal", preview.goal);
  await click("Add task");
  await click("Add task");
  change("COMPLEX acceptance criteria", "Parse input\nValidate input");
  change("Task 1 title", "Extract parser");
  change("Task 1 goal", "Move parsing into src/parse.ts");
  toggle("Task 1 maps criterion 1");
  await click("Add task 1 file claim");
  change("Task 1 claim 1 path", "src/config.ts");
  change("Task 1 check IDs", "test");
  change("Task 2 title", "Add validation");
  change("Task 2 goal", "Reject duplicate keys");
  toggle("Task 2 depends on task 1");
  change("Task 2 check IDs", "test");
}

describe("COMPLEX task plan and execution projection", () => {
  it("shows no COMPLEX surface and never sends a draft without the Runtime capability", async () => {
    expect(
      visitElements(render(), (node) => node.props["aria-label"] === "COMPLEX task plan"),
    ).toBeNull();
    expect(visitElements(render(), (node) => text(node) === "Add task")).toBeNull();
    await prepare();
    const request = data.invoke.mock.calls[0]?.[0].input.request;
    expect(request).toMatchObject({ type: "workflow.prepare", goal: preview.goal });
    expect(request).not.toHaveProperty("complexDraft");
  });
  it("sends the exact bounded draft on workflow.prepare only after local reference checks", async () => {
    await draftTwoTasks();
    await submitPrepare();
    expect(words(render())).toContain("Task 2 does not map any acceptance criterion.");
    toggle("Task 2 maps criterion 1");
    await submitPrepare();
    expect(words(render())).toContain("Acceptance criterion 2 is not mapped to any task.");
    toggle("Task 2 maps criterion 1");
    toggle("Task 2 maps criterion 2");
    change("Reviewed recipe", "bug-fix");
    await submitPrepare();
    expect(words(render())).toContain("STANDARD-only");
    expect(data.invoke).not.toHaveBeenCalled();
    change("Reviewed recipe", "");
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
    toggle("Task 2 maps criterion 2");
    change("Task 1 claim 1 path", "src/config.ts/");
    await submitPrepare();
    expect(data.invoke).not.toHaveBeenCalled();
    expect(words(render())).toContain("Invalid task plan");
    expect(control(render(), "Task 1 claim 1 path").props.value).toBe("src/config.ts/");
  });
  it("shows the complete Runtime plan, confirms that exact preview once and drops it on draft edits", async () => {
    await draftTwoTasks();
    toggle("Task 2 maps criterion 2");
    data.invoke.mockResolvedValue(
      AsyncResult.success(response({ kind: "prepared", preview: complexPreview })),
    );
    await submitPrepare();
    update({ preview: complexPreview, nextRequestId: "owner:2" });
    const section = control(render(), "Runtime Plan Preview");
    expect(words(section)).toContain("COMPLEX");
    expect(words(section)).toContain("AC-002 · Validate input");
    expect(
      visitElements(section, (node) => node.props["aria-label"] === "Acceptance criteria"),
    ).toBeNull();
    const plan = words(child(section, ComplexPlanView));
    for (const expected of [
      "CT-001 · Extract parser",
      "CT-002 · Add validation",
      "Depends on: CT-001",
      "AC-002 · Validate input",
      "modify src/config.ts, create src/parse.ts",
      "none (read-only contribution)",
      "all registered checks lint, test",
      "24 worker invocations",
      complexPlan.complexPlanDigest,
    ]) {
      expect(plan).toContain(expected);
    }
    accepted("workflow.confirm");
    await click("Confirm and start");
    expect(data.confirm.mock.calls[0]?.[0]).toContain(
      "CT-001 Extract parser; CT-002 Add validation",
    );
    expect(data.confirm.mock.calls[0]?.[0]).toContain(
      "Completing every task does not complete the Run",
    );
    expect(data.invoke.mock.calls[1]?.[0].input.request).toMatchObject({
      type: "workflow.confirm",
      previewId: complexPreview.previewId,
      previewDigest: complexPreview.previewDigest,
    });
    change("Task 1 title", "Edited after preparing");
    expect(
      visitElements(render(), (node) => node.props["aria-label"] === "Runtime Plan Preview"),
    ).toBeNull();
  });
  it("keeps the confirmed plan read-only and offers no task controls", async () => {
    await draftTwoTasks();
    complexRunning();
    const tree = render();
    for (const label of [
      "Add task",
      "Task 1 title",
      "Task 1 check IDs",
      "Task 2 depends on task 1",
    ]) {
      expect(control(tree, label).props.disabled).toBe(true);
    }
    const buttons = elements(tree, "button").map((button) => text(button).trim());
    expect(buttons).toContain("Cancel workflow");
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
    expect(projection).toContain("CURRENT OBSERVATION");
    expect(projection).toContain("Canonical Run outcome: RUNNING");
    expect(projection).toContain("Task contributions completed: 2 / 2");
    expect(projection).toContain("Completed tasks do not complete the Run");
    expect(projection).toContain("historical contribution, not current completion evidence");
    expect(projection).toContain("reported tokens unknown");
    expect(projection).toContain("unknown / 200000");
    expect(projection).not.toContain("reported tokens 0");
    data.observation = { ...data.observation!, stale: true, observedAt: 1 };
    projection = words(child(render(), ComplexExecutionView));
    expect(projection).toContain("HISTORICAL · NOT CURRENT");
    expect(projection).toContain("Last checked observation");
    expect(visitElements(render(), (node) => text(node) === "Cancel workflow")).toBeNull();
    data.observation = { ...data.observation!, stale: false };
    update({ ownedRunId: "another-run" });
    expect(words(child(render(), ComplexExecutionView))).toContain("DISPLAY ONLY · NOT OWNED");
    expect(visitElements(render(), (node) => text(node) === "Cancel workflow")).toBeNull();
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
      "Canonical Run outcome: INTERRUPTED",
      "UNCONFIRMED / true",
      "Cleanup is unconfirmed",
      "partial changes retained · change set UNKNOWN",
      "Failure: OWNER_LOST",
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
      "Current wave, as reported by Runtime: CT-001 · Extract parser, CT-002 · Add validation",
      "at most 2 implemented at once; checks and reviews run one task at a time",
      "CT-002 · Add validation CURRENT WAVE HANDED_OFF Implemented; waiting for its verification turn",
      "CT-003 · Add formatter PENDING Depends on: CT-001, CT-002",
      "worker invocations 1 · reported tokens unknown",
    ]) {
      expect(shown).toContain(expected);
    }
    expect(shown).not.toContain("active task");
    // Membership is exactly what Runtime reported, never inferred from dependencies.
    expect(
      elements(projection, "span").filter((node) => text(node) === "CURRENT WAVE"),
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
      "Cancel requested: Runtime stops every live task and waits for all of them to settle before it records the outcome. Cleanup: PENDING.",
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
      "Canonical Run outcome: BLOCKED",
      "Current wave, as reported by Runtime: none",
      "Failure: OWNERSHIP_CONFLICT",
      "Failure: RUN_STOPPED — stopped because a sibling task failed or the Run stopped",
    ]) {
      expect(shown).toContain(expected);
    }
    expect(shown).not.toContain("Cancel requested");
  });
  it("keeps the draft editor unchanged for contract v2 and shows maxParallel read-only", async () => {
    await draftTwoTasks(2);
    toggle("Task 2 maps criterion 2");
    const editor = words(control(render(), "COMPLEX task plan"));
    expect(editor).toContain("RUNTIME CONTRACT v2");
    expect(editor).toContain("may be implemented at the same time");
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
    const plan = words(child(control(render(), "Runtime Plan Preview"), ComplexPlanView));
    for (const expected of [
      "at most 2 tasks implemented at once (Runtime configuration, read-only)",
      "CT-003 · Add formatter Render parsed pairs back to text Depends on: CT-001, CT-002",
      "implemented together, up to 2 at once; checks and reviews then run one task at a time",
    ]) {
      expect(plan).toContain(expected);
    }
    expect(
      visitElements(render(), (node) =>
        /parallel|wave|concurren/i.test(String(node.props["aria-label"] ?? "")),
      ),
    ).toBeNull();
    accepted("workflow.confirm");
    await click("Confirm and start");
    expect(data.confirm.mock.calls[0]?.[0]).toContain(
      "up to 2 whose dependencies are complete are implemented at once",
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
  visitElements(tree, (node) => node.props["aria-label"] === "Another owner holds this project");

describe("Prepare while another owner holds the active Run", () => {
  it("offers only workflow prepare, and explains that Runtime decides whether the owner stopped", () => {
    orphaned();
    change("Workflow goal", preview.goal);
    const tree = render();
    expect(control(tree, "Prepare workflow").props.disabled).toBe(false);
    expect(words(orphanNote(tree))).toContain(
      "If that owner has stopped, preparing a workflow marks its Run INTERRUPTED; nothing resumes",
    );
    expect(words(orphanNote(tree))).toContain("the Runtime refuses");
    // Cancel, approval, facts and browser gates stay as they were.
    expect(visitElements(tree, (node) => text(node) === "Cancel workflow")).toBeNull();
    expect(
      visitElements(tree, (node) => node.props["aria-label"] === "Pending R3 approval"),
    ).toBeNull();
    expect(control(tree, "Prepare fact").props.disabled).toBe(true);
    expect(control(tree, "Refresh browser evidence").props.disabled).not.toBe(true);
    // A connection that owned an earlier Run does not own this one either.
    update({ ownedRunId: "earlier-run" });
    expect(control(render(), "Prepare workflow").props.disabled).toBe(false);
  });
  it("keeps prepare disabled for this connection's own Run and for busy, stale or disconnected views", () => {
    change("Workflow goal", preview.goal);
    for (const patch of [{ ownedRunId: "run-1" }, { busy: true, ownedRunId: "earlier-run" }]) {
      orphaned(patch);
      expect(control(render(), "Prepare workflow").props.disabled).toBe(true);
      expect(orphanNote(render())).toBeNull();
    }
    orphaned();
    data.observation = { ...data.observation!, stale: true };
    expect(control(render(), "Prepare workflow").props.disabled).toBe(true);
    data.observation = { ...data.observation!, stale: false };
    data.phase = "disconnected";
    expect(control(render(), "Prepare workflow").props.disabled).toBe(true);
    data.phase = "connected";
    // A writer retained without an active Run is still not preparable.
    const current = data.observation!.state!;
    update({
      snapshot: {
        ...current.snapshot,
        status: {
          ...current.snapshot.status,
          run: { ...current.snapshot.status.run!, status: "INTERRUPTED" },
        },
      },
    });
    expect(control(render(), "Prepare workflow").props.disabled).toBe(true);
    expect(data.invoke).not.toHaveBeenCalled();
  });
  it("sends one plain prepare and, after STALE_PROJECT, waits for fresh state and an explicit retry", async () => {
    orphaned();
    change("Workflow goal", preview.goal);
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
    expect(shown).toContain("Runtime rejected the command: STALE_PROJECT.");
    expect(shown).toContain(
      "Nothing was prepared or retried; prepare again once the refreshed state appears.",
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
    change("Workflow goal", preview.goal);
    data.invoke.mockResolvedValue(AsyncResult.success(refused("WRITER_PRESENT")));
    await submitPrepare();
    await flush();
    expect(words(render())).toContain("Runtime rejected the command: WRITER_PRESENT.");
    expect(data.invoke).toHaveBeenCalledOnce();
    expect(text(render())).toContain("RUNNING");
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
  change("Workflow goal", plannerGoal);
  change("COMPLEX acceptance criteria", plannerStatements.join("\n"));
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
    expect(labelled(render(), "COMPLEX acceptance criteria")).toBeNull();
    await prepare();
    expect(sentTypes()).toEqual(["workflow.prepare"]);
  });
  it("offers Draft with Planner only for a current idle connection with a goal and criteria", async () => {
    advertisePlanner();
    const draftDisabled = () => control(render(), "Draft with Planner").props.disabled;
    expect(draftDisabled()).toBe(true);
    change("Workflow goal", plannerGoal);
    expect(draftDisabled()).toBe(true);
    change("COMPLEX acceptance criteria", "  \n ");
    expect(draftDisabled()).toBe(true);
    change("COMPLEX acceptance criteria", plannerStatements.join("\n"));
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
    await click("Draft with Planner");
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
    expect(words(render())).toContain("Planning started.");
    expect(words(render())).toContain("nothing enters the editor until you load it");
  });
  it("shows elapsed time, route and usage while RUNNING, and cancels only that request", async () => {
    advertisePlanner();
    enterPlannerRequest();
    update({ planner: plannerRunning });
    data.observation = { ...data.observation!, observedAt: plannerRunning.startedAt + 12_400 };
    const shown = words(control(render(), "Planner running"));
    expect(shown).toContain("Planning · elapsed 12 s");
    expect(shown).toContain(
      "models.intents.plan → reasoning → commandcode/deepseek/deepseek-v4.1-flash",
    );
    expect(shown).toContain("1 of 3 model calls · 1200 reported tokens");
    expect(control(render(), "Draft with Planner").props.disabled).toBe(true);
    expect(labelled(render(), "Planner proposal")).toBeNull();
    data.invoke.mockResolvedValue(
      plannerReply(
        { kind: "accepted", requestId: "owner:1", command: "planner.cancel", runId: null },
        "planner.cancel",
      ),
    );
    await click("Cancel planning");
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
    expect(words(render())).toContain("Planning cancellation accepted");
    expect(labelled(render(), "Planner running")).not.toBeNull();
    update({ planner: { ...plannerRunning, status: "CANCELLED", finishedAt: 5_000 } });
    expect(words(control(render(), "Planner"))).toContain(
      "Planning cancelled. Nothing was drafted.",
    );
    expect(labelled(render(), "Planner running")).toBeNull();
    expect(control(render(), "Draft with Planner").props.disabled).toBe(false);
    // Unknown time, usage and route are shown as such, never as zero.
    update({
      planner: { ...plannerRunning, route: null, usage: { invocations: 0, reportedTokens: null } },
    });
    data.observation = { ...data.observation!, observedAt: null };
    expect(words(control(render(), "Planner running"))).toContain(
      "Planning · elapsed unknown · route not reported · 0 of 3 model calls · unknown reported tokens",
    );
  });
  it("loads the unreviewed proposal into the editor exactly as proposed and prepares nothing", async () => {
    advertisePlanner();
    enterPlannerRequest();
    update({ planner: plannerReady });
    const card = words(control(render(), "Planner proposal"));
    expect(card).toContain("Planner proposal — unreviewed");
    expect(card).toContain(
      "2 tasks · models.intents.plan → reasoning → commandcode/deepseek/deepseek-v4.1-flash · 2 of 3 model calls · 3400 reported tokens",
    );
    expect(card).not.toContain("NOT CURRENT");
    expect(card).not.toContain("OTHER GOAL OR CRITERIA");
    data.invoke.mockResolvedValue(readReply());
    await click("Load into editor");
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
    expect(control(tree, "Task 1 title").props.value).toBe("Split parse module");
    expect(control(tree, "Task 1 goal").props.value).toBe("Move parsing into src/parse.ts");
    expect(control(tree, "Task 1 claim 1 operation").props.value).toBe("create");
    expect(control(tree, "Task 1 claim 1 path").props.value).toBe("src/parse.ts");
    expect(control(tree, "Task 1 check IDs").props.value).toBe("test");
    expect(control(tree, "Task 2 check IDs").props.value).toBe("test lint");
    expect(control(tree, "Task 2 depends on task 1").props.checked).toBe(true);
    expect(control(tree, "Task 2 maps criterion 1").props.checked).toBe(false);
    expect(control(tree, "Task 2 maps criterion 2").props.checked).toBe(true);
    expect(control(tree, "Workflow goal").props.value).toBe(plannerGoal);
    expect(words(control(tree, "Loaded Planner proposal"))).toContain(
      "Review every task, claim and check before Prepare.",
    );
    expect(words(tree)).toContain("Planner proposal loaded into the editor.");
    // No automatic prepare or confirm: only the read was sent.
    await flush();
    expect(sentTypes()).toEqual(["planner.read"]);
    expect(labelled(render(), "Runtime Plan Preview")).toBeNull();
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
    change("Task 1 title", "Split the parse module");
    expect(labelled(render(), "Loaded Planner proposal")).toBeNull();
    change("Task 1 title", "Split parse module");
    expect(labelled(render(), "Loaded Planner proposal")).not.toBeNull();
    toggle("Task 2 maps criterion 1");
    expect(labelled(render(), "Loaded Planner proposal")).toBeNull();
  });
  it("labels a non-current proposal and one planned for another goal or criteria", async () => {
    advertisePlanner();
    enterPlannerRequest();
    update({ planner: { ...plannerReady, current: false } });
    const card = () => words(control(render(), "Planner proposal"));
    expect(card()).toContain("NOT CURRENT");
    expect(card()).toContain("changed after planning");
    expect(card()).not.toContain("OTHER GOAL OR CRITERIA");
    for (const [label, apply, differs] of [
      [
        "reordered criteria",
        () => change("COMPLEX acceptance criteria", plannerStatements.toReversed().join("\n")),
        true,
      ],
      [
        "original criteria",
        () => change("COMPLEX acceptance criteria", plannerStatements.join("\n")),
        false,
      ],
      [
        "surrounding whitespace the request trims",
        () => change("Workflow goal", `  ${plannerGoal}\n`),
        false,
      ],
      ["another goal", () => change("Workflow goal", `${plannerGoal}!`), true],
    ] as const) {
      apply();
      expect([label, card().includes("OTHER GOAL OR CRITERIA")]).toEqual([label, differs]);
      expect([label, card().includes("different goal or criteria")]).toEqual([label, differs]);
    }
    change("Workflow goal", plannerGoal);
    data.invoke.mockResolvedValue(readReply({ current: false }));
    await click("Load into editor");
    const banner = () => words(control(render(), "Loaded Planner proposal"));
    expect(banner()).toContain("Not current");
    expect(banner()).not.toContain("different goal or criteria");
    change("COMPLEX acceptance criteria", plannerStatements[0]!);
    expect(banner()).toContain("Planned for a different goal or criteria");
    // The snapshot's live value wins while the Host still reports that request.
    update({ planner: { ...plannerReady, current: true } });
    expect(banner()).not.toContain("Not current");
  });
  it("asks before replacing different rows and keeps them when declined", async () => {
    await draftTwoTasks(2);
    advertisePlanner();
    update({ planner: plannerReady });
    data.invoke.mockResolvedValue(readReply());
    data.confirm.mockResolvedValueOnce(false);
    await click("Load into editor");
    expect(data.confirm).toHaveBeenCalledOnce();
    expect(data.confirm.mock.calls[0]?.[0]).toContain(
      "Replace the 2 task rows in the editor with the Planner proposal of 2 tasks?",
    );
    expect(control(render(), "Task 1 title").props.value).toBe("Extract parser");
    expect(words(render())).toContain("Kept the editor's task rows. Nothing was loaded.");
    expect(labelled(render(), "Loaded Planner proposal")).toBeNull();
    await click("Load into editor");
    expect(data.confirm).toHaveBeenCalledTimes(2);
    expect(control(render(), "Task 1 title").props.value).toBe("Split parse module");
    // The unchanged proposal loads again without asking.
    await click("Load into editor");
    expect(data.confirm).toHaveBeenCalledTimes(2);
    expect(sentTypes()).toEqual(["planner.read", "planner.read", "planner.read"]);
  });
  it("never loads a draft of another planning request", async () => {
    advertisePlanner();
    enterPlannerRequest();
    update({ planner: plannerReady });
    data.invoke.mockResolvedValue(readReply({ planId: "0b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e" }));
    await click("Load into editor");
    expect(words(render())).toContain("Runtime returned a draft of another planning request.");
    expect(labelled(render(), "Task 1")).toBeNull();
    expect(labelled(render(), "Loaded Planner proposal")).toBeNull();
  });
  it("discards a proposal only in this App and shows a new request's proposal again", async () => {
    advertisePlanner();
    enterPlannerRequest();
    update({ planner: plannerReady });
    await click("Discard");
    expect(labelled(render(), "Planner proposal")).toBeNull();
    expect(words(control(render(), "Planner"))).toContain("Proposal discarded in this App");
    // The way back is local too.
    await click("Show proposal");
    expect(labelled(render(), "Planner proposal")).not.toBeNull();
    await click("Discard");
    expect(data.invoke).not.toHaveBeenCalled();
    expect(data.confirm).not.toHaveBeenCalled();
    update({ planner: { ...plannerReady, planId: "0b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e" } });
    expect(labelled(render(), "Planner proposal")).not.toBeNull();
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
      const shown = words(control(render(), "Planner failed"));
      expect(shown).toMatch(
        new RegExp(
          `^Planner failed: ${failureCode} — .+ Nothing was drafted; draft again when ready\\.$`,
        ),
      );
      explanations.add(shown.replace(failureCode, ""));
      expect(labelled(render(), "Planner proposal")).toBeNull();
      expect(control(render(), "Draft with Planner").props.disabled).toBe(false);
    }
    expect(explanations.size).toBe(codes.length);
    expect(words(control(render(), "Planner failed"))).toContain("the draft was discarded");
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
    await click("Draft with Planner");
    await flush();
    expect(words(render())).toContain(
      "Runtime rejected the command: UNSUPPORTED_WORKFLOW. The Planner drafts only goals that Runtime classifies as COMPLEX, never R3.",
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
    await click("Confirm and start");
    await flush();
    expect(words(render())).toContain(
      "Runtime rejected the command: PLANNER_BUSY. Planning is still running on this Runtime. Cancel planning first; nothing was started.",
    );
    expect(sentTypes()).toEqual(["planner.start", "workflow.prepare", "workflow.confirm"]);
    expect(labelled(render(), "Planner running")).not.toBeNull();
  });
});
