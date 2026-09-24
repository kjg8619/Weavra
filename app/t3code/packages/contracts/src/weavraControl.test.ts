import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  type WeavraBrowserCandidateSummary,
  type WeavraBrowserPreview,
  type WeavraBrowserRegistrationRequest,
  WeavraBrowserState,
  type WeavraBrowserVerificationEvidence,
  WEAVRA_COMPLEX_MAX_DRAFT_BYTES,
  WEAVRA_COMPLEX_MAX_EXECUTION_BYTES,
  WEAVRA_COMPLEX_MAX_PLAN_BYTES,
  WeavraComplexDraft,
  type WeavraComplexExecution,
  WeavraComplexOwnershipClaim,
  WeavraComplexPlan,
  WeavraControlCapabilities,
  WeavraControlApproval,
  WeavraControlInput,
  WeavraControlObserveInput,
  WeavraControlPreview,
  WeavraControlRequest,
  WeavraControlResponse,
  WeavraControlState,
  type WeavraRegisteredBrowserCheck,
} from "./weavraControl.ts";

const decodeRpc = Schema.decodeUnknownSync(WeavraControlInput);
const decodeObserve = Schema.decodeUnknownSync(WeavraControlObserveInput);
const decodeWire = Schema.decodeUnknownSync(WeavraControlRequest, { onExcessProperty: "error" });
const decodeApproval = Schema.decodeUnknownSync(WeavraControlApproval);
const request = {
  protocolVersion: 1,
  id: "owner:1",
  ownerId: "owner",
  expectedProjectRevision: 0,
  type: "workflow.prepare",
  goal: "Fix app bug",
};

const browserDigest = `sha256:${"a".repeat(64)}`;
const registration = {
  candidateId: "12345678-1234-1234-1234-123456789abc",
  expectedCandidateDigest: browserDigest,
  checkId: "page-ready",
  origin: "http://127.0.0.1:4173",
  documentIdentity: "http://127.0.0.1:4173/index.html",
  target: { selector: "#ready" },
  assertion: { type: "text_equals", expected: "Ready" },
  freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 15000 },
} as const satisfies WeavraBrowserRegistrationRequest;
const browserMutation = {
  protocolVersion: 1,
  id: "owner:2",
  ownerId: "owner",
  expectedProjectRevision: 0,
} as const;
const browserPrepare = { ...browserMutation, type: "browser.prepare", registration } as const;
const browserCheck = {
  version: 1,
  checkId: registration.checkId,
  projectId: browserDigest,
  origin: registration.origin,
  documentIdentity: registration.documentIdentity,
  target: registration.target,
  assertion: registration.assertion,
  freshness: registration.freshness,
  registrationDigest: browserDigest,
} as const satisfies WeavraRegisteredBrowserCheck;
const browserCandidate = {
  schemaVersion: 2,
  kind: "BROWSER_OBSERVATION_CANDIDATE",
  candidateId: registration.candidateId,
  projectId: browserDigest,
  authority: "CANDIDATE_ONLY",
  scope: "LOCAL_STATIC_DOCUMENT",
  origin: registration.origin,
  documentIdentity: registration.documentIdentity,
  capturedAt: 100,
  pageRevision: browserDigest,
  source: {
    implementationRevision: browserDigest,
    readerRevision: "b".repeat(40),
    readerDigest: browserDigest,
    executableIdentityDigest: browserDigest,
    browserVersion: "Chromium 140",
  },
  freshness: { mode: "CAPTURE_ONLY", startedAt: 90, finishedAt: 100 },
  observationDigest: browserDigest,
  observationType: "target",
  observation: { target: registration.target, exists: true, value: "Ready" },
  candidateDigest: browserDigest,
  cleanup: "CONFIRMED",
} as const satisfies WeavraBrowserCandidateSummary;
const browserPreview = {
  previewId: "preview",
  previewDigest: browserDigest,
  ownerId: "owner",
  projectRevision: 0,
  expiresAt: 300000,
  candidate: browserCandidate,
  check: browserCheck,
  isolation: "PRIVATE_HOME_PROFILE_CDP_PIPE_NOT_OS_SANDBOX",
} as const satisfies WeavraBrowserPreview;
const browserEvidence = {
  version: 1,
  registrationDigest: browserDigest,
  projectId: browserDigest,
  origin: registration.origin,
  documentIdentity: registration.documentIdentity,
  documentDigest: browserDigest,
  observationType: "target",
  target: registration.target,
  assertion: registration.assertion,
  freshness: registration.freshness,
  captureId: registration.candidateId,
  capturedAt: 200,
  implementationRevision: browserDigest,
  executableIdentityDigest: browserDigest,
  browserVersion: "Chromium 140",
  observationDigest: browserDigest,
  isolation: "PRIVATE_HOME_PROFILE_CDP_PIPE",
  cleanup: "CONFIRMED",
  result: "PASS",
  browserEvidenceDigest: browserDigest,
} as const satisfies WeavraBrowserVerificationEvidence;
const browserState = {
  projectId: browserDigest,
  candidates: [browserCandidate],
  omittedCandidates: 1,
  checks: [{ check: browserCheck, required: true }],
  omittedChecks: 0,
  evidence: [
    {
      runId: "run",
      checkId: browserCheck.checkId,
      revision: 1,
      step: { stepId: "test", attempt: 1 },
      status: "PASS",
      diffDigest: "c".repeat(64),
      browser: browserEvidence,
    },
  ],
  omittedEvidence: 0,
} as const satisfies WeavraBrowserState;

describe("Weavra control has a closed Runtime authority boundary", () => {
  it("accepts only reviewed fact inputs and rejects client-supplied validity or review metadata", () => {
    const fact = {
      ...browserMutation,
      type: "facts.prepare",
      sourceRef: "src/notes.txt",
      statement: "Reviewed statement",
    };
    expect(decodeRpc({ projectId: "project", request: fact }).request).toEqual(fact);
    for (const extra of [
      { status: "VALID" },
      { reviewedAt: 1 },
      { sourceDigest: browserDigest },
      { sourceGeneration: browserDigest },
      { id: "forged-id", factId: "forged" },
    ]) {
      expect(() => decodeRpc({ projectId: "project", request: { ...fact, ...extra } })).toThrow();
    }
    expect(() =>
      decodeWire({
        ...browserMutation,
        type: "facts.confirm",
        previewId: "preview",
        previewDigest: browserDigest,
        statement: "Changed after preview",
      }),
    ).toThrow();
  });
  it("accepts only the bounded typed preparation input", () => {
    expect(decodeRpc({ projectId: "project", request })).toEqual({ projectId: "project", request });
    expect(decodeWire({ protocolVersion: 1, id: "hello", type: "control.hello" })).toEqual({
      protocolVersion: 1,
      id: "hello",
      type: "control.hello",
    });
  });
  it("rejects authority injection at the default RPC decoder, before fields can be stripped", () => {
    for (const field of [
      "risk",
      "allowedPaths",
      "checks",
      "taskContract",
      "policy",
      "pass",
      "complete",
    ]) {
      expect(() =>
        decodeRpc({ projectId: "project", request: { ...request, [field]: "injected" } }),
      ).toThrow();
    }
    expect(() =>
      decodeRpc({ projectId: "project", request, cwd: "/different-checkout" }),
    ).toThrow();
    expect(() =>
      decodeObserve({
        projectId: "project",
        executable: "/evil",
      }),
    ).toThrow();
  });
  it("has no write, edit, tool, shell, PASS or COMPLETE command", () => {
    for (const type of [
      "write",
      "edit",
      "tool",
      "shell",
      "pass",
      "complete",
      "set-policy",
      "task-contract",
    ]) {
      expect(() => decodeRpc({ projectId: "project", request: { ...request, type } })).toThrow();
    }
  });
  it("requires owner and expected revisions for every mutation", () => {
    const { ownerId: _owner, ...missingOwner } = request;
    const { expectedProjectRevision: _revision, ...missingRevision } = request;
    expect(() => decodeWire(missingOwner)).toThrow();
    expect(() => decodeWire(missingRevision)).toThrow();
    expect(() => decodeWire({ ...request, expectedProjectRevision: -1 })).toThrow();
    expect(() =>
      decodeWire({ ...request, expectedProjectRevision: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
    expect(() =>
      decodeWire({
        protocolVersion: 1,
        id: "owner:2",
        ownerId: "owner",
        expectedProjectRevision: 0,
        type: "workflow.cancel",
        runId: "run",
      }),
    ).toThrow();
  });
  it("rejects malformed recipe and criterion input without granting preferences", () => {
    expect(() => decodeWire({ ...request, recipeInputs: [] })).toThrow();
    expect(() => decodeWire({ ...request, recipeInputs: { field: 1 } })).toThrow();
    expect(() => decodeWire({ ...request, acceptanceStatements: [] })).toThrow();
    expect(() => decodeWire({ ...request, acceptanceStatements: [" "] })).toThrow();
    expect(() => decodeWire({ ...request, workflow: "QUICK", executionMode: "EDIT" })).toThrow();
  });
  it("bounds goals, criteria and recipe strings and validates protocol version", () => {
    expect(() => decodeWire({ ...request, goal: "x".repeat(2049) })).toThrow();
    expect(() => decodeWire({ ...request, acceptanceStatements: ["x".repeat(501)] })).toThrow();
    expect(() =>
      decodeWire({ ...request, acceptanceStatements: Array(17).fill("criterion") }),
    ).toThrow();
    expect(() =>
      decodeWire({ ...request, recipeInputs: { expected: "x".repeat(2049) } }),
    ).toThrow();
    expect(() => decodeWire({ ...request, protocolVersion: 2 })).toThrow();
  });
  it("approves or rejects only a Runtime issued pending identity", () => {
    const approval = {
      protocolVersion: 1,
      id: "owner:2",
      ownerId: "owner",
      expectedProjectRevision: 9,
      type: "approval.resolve",
      runId: "run",
      expectedStateRevision: 7,
      approvalId: "action",
      decision: "reject",
    };
    expect(decodeWire(approval)).toEqual(approval);
    expect(() => decodeWire({ ...approval, decision: "approve-session" })).toThrow();
    expect(() => decodeWire({ ...approval, path: "other-file", approved: true })).toThrow();
  });
  it("bounds the complete UTF-8 request, not just each field or JavaScript string length", () => {
    const oversized = {
      ...request,
      recipeInputs: Object.fromEntries(
        Array.from({ length: 6 }, (_, index) => [`field_${index}`, "한".repeat(2048)]),
      ),
    };
    expect(JSON.stringify(oversized).length).toBeLessThan(32768);
    expect(() => decodeRpc({ projectId: "project", request: oversized })).toThrow();
  });
  it("accepts the native Runtime deletion fingerprint without a contract-digest prefix", () => {
    const approval = {
      approvalId: "approval",
      runId: "run",
      stateRevision: 7,
      projectRevision: 9,
      risk: "R3",
      operation: "delete-file",
      role: "Developer",
      step: { stepId: "implement", attempt: 1 },
      path: "src/app.js",
      bytes: 9,
      preconditionDigest: "b".repeat(64),
      expiresAt: 10000,
      explanation: "Delete one tracked text file.",
    };
    expect(decodeApproval(approval).preconditionDigest).toBe(approval.preconditionDigest);
    expect(() =>
      decodeApproval({ ...approval, preconditionDigest: `sha256:${approval.preconditionDigest}` }),
    ).toThrow();
  });
  it("does not allow raw private diagnostics in a typed control rejection", () => {
    const response = {
      protocolVersion: 1,
      type: "control_response",
      id: "owner:2",
      command: "workflow.confirm",
      ownerId: "owner",
      runId: null,
      stateRevision: null,
      projectRevision: null,
      eventId: null,
      timestamp: 1,
      success: false,
      error: { code: "STALE_PROJECT" },
    };
    const decode = Schema.decodeUnknownSync(WeavraControlResponse, { onExcessProperty: "error" });
    expect(decode(response)).toEqual(response);
    expect(() =>
      decode({ ...response, error: { ...response.error, reason: "PRIVATE_CREDENTIAL_MARKER" } }),
    ).toThrow();
  });
  it("accepts browser inspection, registration preparation and Runtime preview confirmation", () => {
    for (const browserRequest of [
      { ...browserMutation, type: "browser.inspect" },
      browserPrepare,
      {
        ...browserMutation,
        type: "browser.confirm",
        previewId: browserPreview.previewId,
        previewDigest: browserPreview.previewDigest,
      },
    ]) {
      expect(decodeRpc({ projectId: "project", request: browserRequest })).toEqual({
        projectId: "project",
        request: browserRequest,
      });
      const { ownerId: _owner, ...missingOwner } = browserRequest;
      const { expectedProjectRevision: _revision, ...missingRevision } = browserRequest;
      expect(() => decodeWire(missingOwner)).toThrow();
      expect(() => decodeWire(missingRevision)).toThrow();
    }
  });
  it("rejects injected browser authority, executable paths and evaluation at every input level", () => {
    for (const field of ["authority", "executable", "eval", "registrationDigest", "result"]) {
      for (const injected of [
        { ...browserPrepare, [field]: "injected" },
        { ...browserPrepare, registration: { ...registration, [field]: "injected" } },
        {
          ...browserPrepare,
          registration: {
            ...registration,
            target: { ...registration.target, [field]: "injected" },
          },
        },
        {
          ...browserPrepare,
          registration: {
            ...registration,
            assertion: { ...registration.assertion, [field]: "injected" },
          },
        },
        {
          ...browserPrepare,
          registration: {
            ...registration,
            freshness: { ...registration.freshness, [field]: "injected" },
          },
        },
      ]) {
        expect(() => decodeRpc({ projectId: "project", request: injected })).toThrow();
      }
    }
    expect(() =>
      decodeRpc({
        projectId: "project",
        request: {
          ...browserMutation,
          type: "browser.confirm",
          previewId: browserPreview.previewId,
          previewDigest: browserPreview.previewDigest,
          registration,
        },
      }),
    ).toThrow();
  });
  it("bounds typed browser selectors, attributes, expected values and freshness", () => {
    const attributeRegistration = {
      ...registration,
      target: { selector: "#ready", attribute: "aria-label" },
      assertion: { type: "attribute_equals", expected: "x".repeat(1024) },
      freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 1 },
    };
    expect(
      decodeRpc({
        projectId: "project",
        request: { ...browserPrepare, registration: attributeRegistration },
      }).request,
    ).toEqual({
      ...browserPrepare,
      registration: attributeRegistration,
    });
    for (const invalid of [
      { ...registration, target: { selector: "body" } },
      { ...registration, target: { selector: `#${"x".repeat(65)}` } },
      { ...registration, target: { selector: "#ready", attribute: "onclick" } },
      { ...registration, assertion: { type: "text_equals", expected: "x".repeat(1025) } },
      { ...registration, assertion: { type: "element_exists", expected: "Ready" } },
      { ...registration, freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 0 } },
      { ...registration, freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 15001 } },
      { ...registration, freshness: { mode: "NEW_ISOLATED_CAPTURE", maxAgeMs: 1.5 } },
    ]) {
      expect(() =>
        decodeRpc({
          projectId: "project",
          request: { ...browserPrepare, registration: invalid },
        }),
      ).toThrow();
    }
  });
  it("decodes bounded browser results without exposing document text or private executable data", () => {
    const decode = Schema.decodeUnknownSync(WeavraControlResponse, { onExcessProperty: "error" });
    const response = {
      protocolVersion: 1,
      type: "control_response",
      id: "owner:2",
      command: "browser.inspect",
      ownerId: "owner",
      runId: null,
      stateRevision: null,
      projectRevision: 0,
      eventId: null,
      timestamp: 200,
      success: true,
    };
    for (const data of [
      { kind: "browser-state", state: browserState },
      { kind: "browser-prepared", preview: browserPreview },
      { kind: "browser-registered", check: browserCheck },
    ]) {
      expect(decode({ ...response, data })).toEqual({ ...response, data });
    }
    const decodeState = Schema.decodeUnknownSync(WeavraBrowserState, {
      onExcessProperty: "error",
    });
    expect(
      decodeState({
        ...browserState,
        evidence: [
          { ...browserState.evidence[0], step: null, status: "UNAVAILABLE", browser: null },
        ],
      }).evidence[0]?.browser,
    ).toBeNull();
    for (const field of ["candidates", "checks", "evidence"] as const) {
      expect(() =>
        decodeState({
          ...browserState,
          [field]: Array(3).fill(browserState[field][0]),
        }),
      ).toThrow();
    }
    for (const candidate of [
      { ...browserCandidate, authority: "Runtime/Kernel" },
      {
        ...browserCandidate,
        source: { ...browserCandidate.source, executable: "/private/chrome" },
      },
      {
        ...browserCandidate,
        observation: { ...browserCandidate.observation, text: "private document" },
      },
      {
        ...browserCandidate,
        observation: { ...browserCandidate.observation, value: "x".repeat(1025) },
      },
    ]) {
      expect(() => decodeState({ ...browserState, candidates: [candidate] })).toThrow();
    }
  });
  it("requires the browser preview slot and the coordinated nine-command capability tuple", () => {
    const decodeState = Schema.decodeUnknownSync(WeavraControlState);
    const state = {
      ownerId: "owner",
      nextRequestId: "owner:3",
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
    expect(decodeState(state)).toEqual(state);
    expect(decodeState({ ...state, browserPreview }).browserPreview).toEqual(browserPreview);
    const { browserPreview: _preview, ...legacyState } = state;
    expect(() => decodeState(legacyState)).toThrow();
    const capabilities = {
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
      runtimeVersion: "1.0.0",
      readiness: "READY",
      recipes: [],
    };
    const decodeCapabilities = Schema.decodeUnknownSync(WeavraControlCapabilities);
    expect(decodeCapabilities(capabilities)).toEqual(capabilities);
    expect(() =>
      decodeCapabilities({
        ...capabilities,
        commands: capabilities.commands.slice(0, 6),
      }),
    ).toThrow();
  });
});

const strict = { onExcessProperty: "error" } as const;
const decodeDraft = Schema.decodeUnknownSync(WeavraComplexDraft, strict);
const decodePlan = Schema.decodeUnknownSync(WeavraComplexPlan, strict);
const decodePreview = Schema.decodeUnknownSync(WeavraControlPreview, strict);
const decodeState = Schema.decodeUnknownSync(WeavraControlState, strict);
const decodeCapabilities = Schema.decodeUnknownSync(WeavraControlCapabilities, strict);
const decodeClaim = Schema.decodeUnknownSync(WeavraComplexOwnershipClaim, strict);
const draftTask = {
  title: "Extract parser",
  goal: "Move parsing into src/parse.ts and keep parseConfig behavior",
  dependsOnIndexes: [],
  criterionIndexes: [1],
  ownership: [{ path: "src/parse.ts", operation: "create" }],
  checkIds: ["test"],
} as const;
const draft = {
  tasks: [draftTask, { ...draftTask, title: "Add validation", dependsOnIndexes: [1] }],
} as const satisfies WeavraComplexDraft;
const complexPrepare = { ...request, acceptanceStatements: ["One", "Two"], complexDraft: draft };
const complexPlan = {
  schemaVersion: 1,
  planId: "9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a",
  complexPlanDigest: `sha256:${"7".repeat(64)}`,
  parentTaskId: "3f2a8c1e-6b4d-4e7a-9c0f-1a2b3c4d5e6f",
  parentTaskContractDigest: `sha256:${"f".repeat(64)}`,
  tasks: [
    {
      id: "CT-001",
      title: "Extract parser",
      goal: "Move parsing into src/parse.ts and keep parseConfig behavior",
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
      goal: "Add validateConfig in src/validate.ts rejecting duplicate keys",
      dependsOn: ["CT-001"],
      criterionIds: ["AC-002"],
      ownership: [{ path: "src/validate.ts", operation: "create" }],
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
} as const satisfies WeavraComplexPlan;
const complexPreview = {
  previewId: "preview",
  previewDigest: browserDigest,
  ownerId: "owner",
  projectRevision: 9,
  expiresAt: 300000,
  goal: "Split the config parser into parse and validate modules",
  workflow: "COMPLEX",
  executionMode: "EDIT",
  risk: "R1",
  allowedPaths: ["src", "test"],
  checks: [
    { id: "lint", kind: "command", required: false },
    { id: "test", kind: "command", required: true },
  ],
  acceptanceCriteria: [
    { id: "AC-001", statement: "One", checkIds: ["test"], reviewRequired: true },
    { id: "AC-002", statement: "Two", checkIds: ["test"], reviewRequired: true },
  ],
  taskContractDigest: complexPlan.parentTaskContractDigest,
  recipe: null,
  configuration: {
    mutationMode: "strict",
    verifierTrustMode: "strict",
    verifierSandboxMode: "disabled",
    contextPackMode: "bounded",
    verificationRepairMode: "disabled",
    lspEnabled: false,
  },
  complexPlan,
} as const satisfies WeavraControlPreview;
const pendingRow = {
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
} as const;
const complexExecution = {
  schemaVersion: 1,
  ownerId: "owner",
  projectRevision: 9,
  runId: "run",
  stateRevision: 7,
  parent: {
    id: complexPlan.parentTaskId,
    goal: complexPreview.goal,
    acceptanceCriteria: complexPreview.acceptanceCriteria.map((criterion) => ({
      id: criterion.id,
      statement: criterion.statement,
      scope: { paths: complexPreview.allowedPaths },
      verification: { checkIds: criterion.checkIds, reviewRequired: true },
    })),
    status: "inProgress",
  },
  plan: complexPlan,
  phase: "TASK_SEQUENCE",
  activeTaskId: "CT-001",
  tasks: [
    {
      ...pendingRow,
      id: "CT-001",
      status: "IMPLEMENTING",
      attempt: 1,
      workerInvocations: 1,
      reportedTokens: null,
      entryWorkspaceDigest: "c".repeat(64),
    },
    { ...pendingRow, id: "CT-002" },
  ],
  integration: {
    check: "NOT_RUN",
    review: "NOT_RUN",
    test: "NOT_RUN",
    workspaceDigest: null,
    evidenceFreshness: "NONE",
    failureCode: null,
  },
  budget: { workerInvocations: 1, reportedTokens: null, totalRevisionCycles: 0, status: "UNKNOWN" },
  cleanup: "NOT_REQUESTED",
  partialChanges: false,
  changesUnknown: false,
  failureCode: null,
} as const satisfies WeavraComplexExecution;
function complexState(execution: unknown = complexExecution) {
  return {
    ownerId: "owner",
    nextRequestId: "owner:3",
    projectRevision: 9,
    stateRevision: 7,
    ownedRunId: "run",
    busy: true,
    cancelling: false,
    startFailure: null,
    preview: null,
    browserPreview: null,
    factPreview: null,
    projectFacts: { status: "available", entries: [] },
    pendingApproval: null,
    complexExecution: execution,
    snapshot: {
      status: {
        source: "durable-canonical-state",
        ownerObserved: false,
        state: "available",
        writerPresent: true,
        run: {
          runId: "run",
          status: "RUNNING",
          phase: "IMPLEMENT",
          workflow: "COMPLEX",
          risk: "R1",
          executionMode: "EDIT",
          codeRevision: 0,
          currentStep: { stepId: "implement", attempt: 1 },
          activeAgentCount: 1,
          taskContractDigest: complexPlan.parentTaskContractDigest,
          createdAt: 1,
          updatedAt: 2,
        },
      },
      graph: null,
      graphAvailable: false,
      evidence: null,
      configuration: { source: "project-config-not-frozen-run-config", status: "configured" },
    },
  };
}
const complexCapabilities = {
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
  runtimeVersion: "1.0.0",
  readiness: "READY",
  complexContractVersion: 1,
  recipes: [],
};
const replaceTask = (index: number, patch: Record<string, unknown>) => ({
  ...complexPlan,
  tasks: complexPlan.tasks.map((task, position) =>
    position === index ? { ...task, ...patch } : task,
  ),
});

describe("COMPLEX contract v1 wire shapes", () => {
  it("accepts the bounded draft only as data on the existing workflow.prepare command", () => {
    expect(decodeRpc({ projectId: "project", request: complexPrepare }).request).toEqual(
      complexPrepare,
    );
    expect(decodeWire(complexPrepare)).toEqual(complexPrepare);
    expect(decodeDraft(draft)).toEqual(draft);
  });
  it("rejects forged identity, status, verdict, permission and task-control input (C22/C23)", () => {
    for (const forged of [
      { id: "CT-001" },
      { status: "COMPLETED" },
      { pass: true },
      { complete: true },
      { permission: "runtime_write" },
      { risk: "R0" },
      { maxRevisionCycles: 2 },
      { approved: true },
    ]) {
      const tasks = [{ ...draftTask, ...forged }, draft.tasks[1]];
      expect(() =>
        decodeRpc({
          projectId: "project",
          request: { ...complexPrepare, complexDraft: { tasks } },
        }),
      ).toThrow();
    }
    for (const forged of [{ planId: complexPlan.planId }, { limits: complexPlan.limits }]) {
      expect(() =>
        decodeRpc({
          projectId: "project",
          request: { ...complexPrepare, complexDraft: { ...draft, ...forged } },
        }),
      ).toThrow();
    }
    for (const field of ["complexPlan", "complexExecution", "taskId", "tasks"]) {
      expect(() =>
        decodeRpc({ projectId: "project", request: { ...complexPrepare, [field]: draft } }),
      ).toThrow();
    }
    for (const type of ["task.complete", "task.retry", "task.skip", "task.start", "plan.edit"]) {
      expect(() =>
        decodeRpc({ projectId: "project", request: { ...complexPrepare, type } }),
      ).toThrow();
    }
    expect(() => decodeWire({ ...complexPrepare, complexDraft: null })).toThrow();
  });
  it("never sends a reviewed recipe together with a COMPLEX draft", () => {
    expect(() => decodeWire({ ...complexPrepare, recipeId: "bug-fix" })).toThrow();
    expect(() => decodeWire({ ...complexPrepare, recipeInputs: {} })).toThrow();
    const { complexDraft: _draft, ...standard } = complexPrepare;
    expect(decodeWire({ ...standard, recipeId: "bug-fix" })).toMatchObject({ recipeId: "bug-fix" });
  });
  it("bounds draft rows, text, references, claims and checks without repairing them", () => {
    const row = (patch: Record<string, unknown>) => ({
      tasks: [draftTask, { ...draftTask, ...patch }],
    });
    for (const invalid of [
      { tasks: [draftTask] },
      { tasks: Array.from({ length: 9 }, () => draftTask) },
      row({ title: "x".repeat(81) }),
      row({ title: "   " }),
      row({ goal: "x".repeat(301) }),
      row({ goal: "" }),
      row({ dependsOnIndexes: [2] }),
      row({ dependsOnIndexes: [3] }),
      row({ dependsOnIndexes: [0] }),
      row({ dependsOnIndexes: [1, 1] }),
      row({ dependsOnIndexes: [1.5] }),
      { tasks: [{ ...draftTask, dependsOnIndexes: [1] }, draftTask] },
      row({ criterionIndexes: [] }),
      row({ criterionIndexes: [0] }),
      row({ criterionIndexes: [2, 2] }),
      row({ criterionIndexes: Array.from({ length: 17 }, (_, index) => index + 1) }),
      row({
        ownership: Array.from({ length: 17 }, (_, index) => ({
          path: `f${index}`,
          operation: "create",
        })),
      }),
      row({ checkIds: [] }),
      row({ checkIds: ["test", "test"] }),
      row({ checkIds: ["unit tests"] }),
      row({ checkIds: Array.from({ length: 17 }, (_, index) => `c${index}`) }),
    ]) {
      expect(() => decodeDraft(invalid)).toThrow();
    }
    const eightTasks = { tasks: Array.from({ length: 8 }, () => draftTask) };
    expect(decodeDraft(eightTasks).tasks).toHaveLength(8);
  });
  it("bounds the complete draft by UTF-8 JSON bytes, not by counts alone", () => {
    const claims = Array.from({ length: 16 }, (_, index) => ({
      path: `${"한".repeat(60)}/${index}.ts`,
      operation: "create" as const,
    }));
    const heavy = { tasks: Array.from({ length: 4 }, () => ({ ...draftTask, ownership: claims })) };
    expect(new TextEncoder().encode(JSON.stringify(heavy)).byteLength).toBeGreaterThan(
      WEAVRA_COMPLEX_MAX_DRAFT_BYTES,
    );
    expect(JSON.stringify(heavy).length).toBeLessThan(WEAVRA_COMPLEX_MAX_DRAFT_BYTES);
    expect(() => decodeDraft(heavy)).toThrow();
    const ascii = JSON.parse(JSON.stringify(heavy).replaceAll("한", "x")) as unknown;
    expect(decodeDraft(ascii).tasks).toHaveLength(4);
  });
  it("accepts only exact canonical project-relative file claims", () => {
    for (const path of [
      "src/a.ts",
      "a",
      "dir/sub/file.test.ts",
      "한글/파일.ts",
      "a b/c.ts",
      `${"한".repeat(85)}a`,
    ]) {
      expect(decodeClaim({ path, operation: "modify" }).path).toBe(path);
    }
    for (const path of [
      "",
      "/abs/file.ts",
      "dir/",
      "a//b",
      ".",
      "..",
      "./a",
      "a/./b",
      "../a",
      "a/..",
      "a\\b",
      "C:file.ts",
      "c:/file.ts",
      "a\u0000b",
      "a\u001fb",
      "a\u007fb",
      "a\u200eb",
      "a\u200fb",
      "a\u202ab",
      "a\u202eb",
      "a\u2066b",
      "a\u2069b",
      "src/*.ts",
      "src/?.ts",
      "src/[ab].ts",
      "src/{a,b}.ts",
      "src/a]",
      "src/a}",
      `${"한".repeat(86)}`,
      "x".repeat(257),
    ]) {
      expect(() => decodeClaim({ path, operation: "modify" })).toThrow();
    }
    for (const operation of ["rename", "move", "write", "MODIFY"]) {
      expect(() => decodeClaim({ path: "src/a.ts", operation })).toThrow();
    }
  });
  it("advertises only the exact feature version and never null", () => {
    expect(decodeCapabilities(complexCapabilities).complexContractVersion).toBe(1);
    const { complexContractVersion: _version, ...baseline } = complexCapabilities;
    expect(decodeCapabilities(baseline)).not.toHaveProperty("complexContractVersion");
    for (const version of [2, 0, null, "1", true]) {
      expect(() =>
        decodeCapabilities({ ...complexCapabilities, complexContractVersion: version }),
      ).toThrow();
    }
  });
  it("requires the plan exactly for a COMPLEX preview and forbids it otherwise", () => {
    expect(decodePreview(complexPreview)).toEqual(complexPreview);
    const { complexPlan: _plan, ...withoutPlan } = complexPreview;
    expect(() => decodePreview(withoutPlan)).toThrow();
    expect(() => decodePreview({ ...complexPreview, workflow: "STANDARD" })).toThrow();
    expect(() => decodePreview({ ...complexPreview, complexPlan: null })).toThrow();
    expect(() => decodePreview({ ...complexPreview, workflow: "PARALLEL" })).toThrow();
    expect(decodePreview({ ...withoutPlan, workflow: "STANDARD" }).workflow).toBe("STANDARD");
  });
  it("enforces plan identity, order, edges, sorting, exclusivity and limits", () => {
    expect(decodePlan(complexPlan)).toEqual(complexPlan);
    for (const invalid of [
      { ...complexPlan, tasks: complexPlan.tasks.slice(0, 1) },
      { ...complexPlan, tasks: [complexPlan.tasks[1], complexPlan.tasks[0]] },
      replaceTask(0, { id: "CT-002" }),
      replaceTask(1, { id: "CT-003" }),
      replaceTask(0, { dependsOn: ["CT-001"] }),
      replaceTask(0, { dependsOn: ["CT-002"] }),
      replaceTask(1, { dependsOn: ["CT-001", "CT-001"] }),
      replaceTask(1, { dependsOn: ["CT-009"] }),
      replaceTask(0, { criterionIds: [] }),
      replaceTask(0, { criterionIds: ["AC-002", "AC-001"] }),
      replaceTask(0, { criterionIds: ["AC-1"] }),
      replaceTask(0, { checkIds: ["test", "lint"] }),
      replaceTask(0, { checkIds: ["test", "test"] }),
      replaceTask(0, { ownership: complexPlan.tasks[0].ownership.toReversed() }),
      replaceTask(1, { ownership: [{ path: "src/config.ts", operation: "delete" }] }),
      replaceTask(0, { maxRevisionCycles: 3 }),
      replaceTask(0, { status: "COMPLETED" }),
      { ...complexPlan, limits: { ...complexPlan.limits, maxTotalRevisionCycles: 1 } },
      { ...complexPlan, limits: { ...complexPlan.limits, maxTasks: 7 } },
      { ...complexPlan, limits: { ...complexPlan.limits, maxWorkerInvocations: 25 } },
      { ...complexPlan, limits: { ...complexPlan.limits, maxWorkerInvocations: 0 } },
      { ...complexPlan, limits: { ...complexPlan.limits, maxReportedTokens: 200001 } },
      { ...complexPlan, integration: { ...complexPlan.integration, reviewRequired: false } },
      { ...complexPlan, integration: { ...complexPlan.integration, checkIds: ["test", "lint"] } },
      { ...complexPlan, planId: complexPlan.planId.toUpperCase() },
      { ...complexPlan, schemaVersion: 2 },
      { ...complexPlan, planRevision: 1 },
    ]) {
      expect(() => decodePlan(invalid)).toThrow();
    }
    const claimsPerTask = (offset: number) =>
      Array.from({ length: 16 }, (_, index) => ({
        path: `t${offset}/${String(index).padStart(2, "0")}.ts`,
        operation: "create" as const,
      }));
    const task = complexPlan.tasks[0];
    const tasks = (count: number) =>
      Array.from({ length: count }, (_, index) => ({
        ...task,
        id: `CT-00${index + 1}`,
        dependsOn: [],
        ownership: claimsPerTask(index),
      }));
    expect(decodePlan({ ...complexPlan, tasks: tasks(4) }).tasks).toHaveLength(4);
    expect(() => decodePlan({ ...complexPlan, tasks: tasks(5) })).toThrow();
  });
  it("bounds the complete plan by UTF-8 JSON bytes", () => {
    const tasks = Array.from({ length: 8 }, (_, index) => ({
      ...complexPlan.tasks[0],
      id: `CT-00${index + 1}`,
      title: "한".repeat(80),
      goal: "한".repeat(300),
      dependsOn: [],
      ownership: [0, 1, 2].map((claim) => ({
        path: `${"한".repeat(40)}/${index}-${claim}.ts`,
        operation: "create",
      })),
    }));
    const heavy = { ...complexPlan, tasks };
    expect(new TextEncoder().encode(JSON.stringify(heavy)).byteLength).toBeGreaterThan(
      WEAVRA_COMPLEX_MAX_PLAN_BYTES,
    );
    expect(JSON.stringify(heavy).length).toBeLessThan(WEAVRA_COMPLEX_MAX_PLAN_BYTES);
    expect(() => decodePlan(heavy)).toThrow();
    const ascii = JSON.parse(JSON.stringify(heavy).replaceAll("한", "x")) as unknown;
    expect(decodePlan(ascii).tasks).toHaveLength(8);
  });
  it("accepts the execution projection only for the enclosing latest COMPLEX Run", () => {
    expect(decodeState(complexState()).complexExecution).toEqual(complexExecution);
    const { complexExecution: _execution, ...absent } = complexState();
    expect(decodeState(absent)).not.toHaveProperty("complexExecution");
    expect(() => decodeState(complexState(null))).toThrow();
    for (const mismatch of [
      { ownerId: "other-owner" },
      { projectRevision: 10 },
      { stateRevision: 6 },
      { runId: "older-run" },
    ]) {
      expect(() => decodeState(complexState({ ...complexExecution, ...mismatch }))).toThrow();
    }
    const standard = complexState();
    standard.snapshot.status.run.workflow = "STANDARD";
    expect(() => decodeState(standard)).toThrow();
  });
  it("rejects unknown fields, unknown enums and out-of-bound counters in the projection", () => {
    const row = (patch: Record<string, unknown>) =>
      complexState({
        ...complexExecution,
        tasks: [{ ...complexExecution.tasks[0], ...patch }, complexExecution.tasks[1]],
      });
    for (const invalid of [
      complexState({ ...complexExecution, schemaVersion: 2 }),
      complexState({ ...complexExecution, runOutcome: "COMPLETED" }),
      complexState({ ...complexExecution, phase: "PARALLEL" }),
      complexState({ ...complexExecution, cleanup: "SKIPPED" }),
      complexState({ ...complexExecution, failureCode: "UNKNOWN_FAILURE" }),
      complexState({ ...complexExecution, activeTaskId: "CT-009" }),
      complexState({ ...complexExecution, tasks: [complexExecution.tasks[0]] }),
      complexState({
        ...complexExecution,
        integration: { ...complexExecution.integration, check: "SKIPPED" },
      }),
      complexState({
        ...complexExecution,
        budget: { ...complexExecution.budget, workerInvocations: 25 },
      }),
      complexState({
        ...complexExecution,
        budget: { ...complexExecution.budget, totalRevisionCycles: 4 },
      }),
      complexState({ ...complexExecution, budget: { ...complexExecution.budget, status: "OK" } }),
      complexState({ ...complexExecution, parent: { ...complexExecution.parent, status: "done" } }),
      row({ status: "SKIPPED" }),
      row({ attempt: 4 }),
      row({ revisionCycle: 3 }),
      row({ workerInvocations: 7 }),
      row({ reportedTokens: -1 }),
      row({ review: "APPROVED" }),
      row({ evidenceFreshness: "FRESH" }),
      row({ entryWorkspaceDigest: `sha256:${"c".repeat(64)}` }),
      row({ changedFiles: ["src/b.ts", "src/a.ts"] }),
      row({ changedFiles: ["src/a.ts", "src/a.ts"] }),
      row({ changedFiles: ["../escape.ts"] }),
      row({ taskComplete: true }),
    ]) {
      expect(() => decodeState(invalid)).toThrow();
    }
  });
  it("bounds the complete execution projection by UTF-8 JSON bytes", () => {
    const statement = "한".repeat(500);
    const acceptanceCriteria = Array.from({ length: 16 }, (_, index) => ({
      id: `AC-${String(index + 1).padStart(3, "0")}`,
      statement,
      scope: { paths: ["src"] },
      verification: { checkIds: ["test"], reviewRequired: true },
    }));
    const heavy = {
      ...complexExecution,
      parent: { ...complexExecution.parent, goal: "한".repeat(2048), acceptanceCriteria },
    };
    expect(new TextEncoder().encode(JSON.stringify(heavy)).byteLength).toBeGreaterThan(
      WEAVRA_COMPLEX_MAX_EXECUTION_BYTES,
    );
    expect(JSON.stringify(heavy).length).toBeLessThan(WEAVRA_COMPLEX_MAX_EXECUTION_BYTES);
    expect(() => decodeState(complexState(heavy))).toThrow();
    const ascii = JSON.parse(JSON.stringify(heavy).replaceAll("한", "x")) as unknown;
    expect(decodeState(complexState(ascii)).complexExecution?.parent.goal).toHaveLength(2048);
  });
});
