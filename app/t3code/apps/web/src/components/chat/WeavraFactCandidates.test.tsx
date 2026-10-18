import {
  EnvironmentId,
  ProjectId,
  type WeavraControlInput,
  type WeavraControlObservation,
  type WeavraFactCandidate,
  type WeavraFactPreview,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { dismissedCandidatesKey, WeavraFactCandidates } from "./WeavraFactCandidates";

const mocks = vi.hoisted(() => ({
  view: null as unknown,
  invoke: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => AsyncResult.success(mocks.view) }));
vi.mock("@t3tools/client-runtime/state/weavraControl", () => ({
  createEnvironmentWeavraControlStateAtoms: () => ({ stateAtom: () => "observation" }),
  createEnvironmentWeavraControlCommand: () => "command",
}));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../state/environments", () => ({
  useEnvironment: () => ({ connection: { phase: "connected" } }),
}));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.invoke }));
vi.mock("../../confirmDialog", () => ({
  requestConfirmDialog: (...args: unknown[]) => mocks.confirm(...args),
}));
vi.mock("../ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
}));

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const digest = `sha256:${"a".repeat(64)}`;
const candidates: WeavraFactCandidate[] = [
  {
    id: `sha256:${"b".repeat(64)}`,
    source: { runId: "run-1", kind: "policy_denied" },
    statement:
      "검사 lint는 실행 정책에 막혀 실행되지 않았으므로 정책이 허용하는 명령 형태로 등록해야 한다.",
    evidenceRef: "docs/checks.md",
    sourceRef: `run:run-1#sha256:${"b".repeat(64)}`,
  },
  {
    id: `sha256:${"c".repeat(64)}`,
    source: { runId: "run-1", kind: "check_failed" },
    statement: "검사 unit가 실패로 기록되었으므로 작업을 마치기 전에 이 검사를 통과시켜야 한다.",
    evidenceRef: "docs/unit.md",
    sourceRef: `run:run-1#sha256:${"c".repeat(64)}`,
  },
];
const preview: WeavraFactPreview = {
  previewId: "fact-preview",
  previewDigest: digest,
  ownerId: "owner",
  projectRevision: 3,
  expiresAt: 9_999_999_999_999,
  sourceRef: candidates[0]!.sourceRef,
  sourceDigest: digest,
  statement: candidates[0]!.statement,
};
function observe(capabilities: { factCandidates?: 1 }) {
  // Only the fields this section reads; the full snapshot is covered by the contract tests.
  const observation = {
    status: "CONNECTED",
    stale: false,
    observedAt: 1,
    errorCode: null,
    capabilities: { ownerId: "owner", ...capabilities },
    state: {
      ownerId: "owner",
      nextRequestId: "owner:4",
      projectRevision: 3,
      stateRevision: 2,
      busy: false,
      factPreview: preview,
      snapshot: {
        status: { writerPresent: false, run: { runId: "run-1", status: "BLOCKED" } },
      },
    },
  } as unknown as WeavraControlObservation;
  mocks.view = { support: "supported", observation };
}
function response(request: WeavraControlInput["request"], data: unknown) {
  return AsyncResult.success({
    protocolVersion: 1,
    type: "control_response",
    id: request.id,
    command: request.type,
    ownerId: "owner",
    runId: null,
    stateRevision: 2,
    projectRevision: 3,
    eventId: null,
    timestamp: 1,
    success: true,
    data,
  });
}
const sent = () =>
  mocks.invoke.mock.calls.map(
    ([call]) => (call as { input: WeavraControlInput }).input.request.type,
  );

let renderer: ReactTestRenderer;
const store = new Map<string, string>();
const rows = () =>
  renderer.root.findAll(
    (node) => node.props["data-weavra"] === "fact-candidate" && node.type === "li",
  );
const buttons = (label: string) =>
  renderer.root.findAllByType("button").filter((node) => node.children.join("") === label);
async function mount() {
  await act(async () => {
    renderer = create(
      <WeavraFactCandidates
        environmentId={environmentId}
        projectId={projectId}
        workspaceRoot="/project"
      />,
    );
  });
  await act(async () => {});
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
    removeItem: (key: string) => store.delete(key),
  });
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.invoke.mockReset().mockImplementation(async ({ input }: { input: WeavraControlInput }) => {
    const request = input.request;
    if (request.type === "facts.candidates")
      return response(request, { kind: "fact-candidates", projectRevision: 3, candidates });
    if (request.type === "facts.prepare")
      return response(request, { kind: "fact-prepared", preview });
    if (request.type === "facts.confirm")
      return response(request, { kind: "fact-confirmed", factId: "fact-1" });
    throw new Error(`unexpected ${request.type}`);
  });
  observe({ factCandidates: 1 });
});
afterEach(() => {
  act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("WeavraFactCandidates", () => {
  it("lists one row per Runtime candidate and writes nothing while listing", async () => {
    await mount();
    expect(rows()).toHaveLength(2);
    expect(sent()).toEqual(["facts.candidates"]);
  });

  it("records a candidate only through prepare, an explicit dialog and one facts.confirm", async () => {
    await mount();
    await act(async () => {
      buttons("확인")[0]!.props.onClick();
    });
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.confirm).toHaveBeenLastCalledWith(expect.stringContaining(preview.sourceDigest));
    expect(sent()).toEqual(["facts.candidates", "facts.prepare", "facts.confirm"]);
    const confirm = mocks.invoke.mock.calls[2]![0] as { input: WeavraControlInput };
    expect(confirm.input.request).toMatchObject({
      previewId: preview.previewId,
      previewDigest: preview.previewDigest,
    });
  });

  it("does not confirm when the user declines the dialog", async () => {
    mocks.confirm.mockResolvedValue(false);
    await mount();
    await act(async () => {
      buttons("확인")[0]!.props.onClick();
    });
    expect(sent()).toEqual(["facts.candidates", "facts.prepare"]);
  });

  it("hides a dismissed candidate per project in local storage and can show it again", async () => {
    await mount();
    await act(async () => {
      buttons("무시")[0]!.props.onClick();
    });
    expect(rows()).toHaveLength(1);
    expect(JSON.parse(store.get(dismissedCandidatesKey(environmentId, projectId))!)).toEqual([
      candidates[0]!.id,
    ]);
    expect(store.has(dismissedCandidatesKey(environmentId, ProjectId.make("other")))).toBe(false);
    await act(async () => {
      buttons("숨긴 후보 1개 다시 보기")[0]!.props.onClick();
    });
    expect(rows()).toHaveLength(2);
    expect(sent()).toEqual(["facts.candidates"]);
  });

  it("is absent when the Runtime does not advertise facts.candidates", async () => {
    observe({});
    await mount();
    expect(renderer.toJSON()).toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
