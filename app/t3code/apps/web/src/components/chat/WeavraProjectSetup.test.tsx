import { act, type ComponentProps } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { parseDocument } from "yaml";
import { WeavraProjectSetup } from "./WeavraProjectSetup";
import { preparedTask, taskScope } from "./weavraTaskTestFixture";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("../../connection/runtime", () => ({ connectionAtomRuntime: {} }));
vi.mock("../../state/use-atom-command", () => ({ useAtomCommand: () => mocks.execute }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  createEnvironmentCommand: (_runtime: unknown, options: unknown) => options,
  squashAtomCommandFailure: (failure: unknown) => failure,
}));
vi.mock("@t3tools/client-runtime/state/weavraTask", () => ({ requestWeavraTask: vi.fn() }));
vi.mock("../ui/button", () => ({
  Button: (props: ComponentProps<"button">) => <button {...props} />,
}));
vi.mock("../ui/textarea", () => ({
  Textarea: (props: ComponentProps<"textarea">) => <textarea {...props} />,
}));

let renderer: ReactTestRenderer;
let props: ComponentProps<typeof WeavraProjectSetup>;
const targetDigest = `sha256:${"a".repeat(64)}`;
const configDigest = `sha256:${"b".repeat(64)}`;
const yaml = `schemaVersion: 1
models:
  profiles:
    coding: { provider: codex, model: coding-model }
    reasoning: { provider: codex, model: reasoning-model }
files:
  allowed_paths: [src]
verification:
  sandbox: { mode: required }
  checks:
    - id: unit
      kind: test
      executable: pnpm
      args: [test]
      required: true
workspace:
  evidence: { mode: bounded-monorepo }
`;
const readiness = { schemaVersion: 1, ready: true, diagnostics: [], configuration: null };
const draft = {
  _tag: "Success",
  value: {
    targetDigest,
    result: {
      schemaVersion: 1,
      kind: "draft",
      projectTypes: ["Node"],
      workspaceProfile: {
        schemaVersion: 1,
        kind: "supported",
        profile: { mode: "default", candidate: false },
        fileCount: 1,
        totalBytes: 10,
      },
      yaml,
    },
  },
};
const read = {
  _tag: "Success",
  value: {
    targetDigest,
    result: { schemaVersion: 1, kind: "read", yaml, configDigest },
  },
};
const missing = {
  _tag: "Success",
  value: {
    targetDigest,
    result: { schemaVersion: 1, kind: "error", code: "CONFIG_MISSING", message: "Fixture missing" },
  },
};
const saved = {
  _tag: "Success",
  value: {
    targetDigest,
    result: { schemaVersion: 1, kind: "saved", yaml, configDigest, readiness },
  },
};
const button = (label: string) => {
  const found = renderer.root
    .findAllByType("button")
    .find((node) => node.children.join("") === label);
  if (!found) throw new Error(`Missing button ${label}`);
  return found;
};
const review = () => renderer.root.findByProps({ "aria-label": "프로젝트 설정 저장 동의" });
const textarea = () =>
  renderer.root.findAllByType("textarea").find((node) => node.props.rows === 14)!;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  props = { scope: taskScope(preparedTask()), available: true, enabled: true, onSaved: vi.fn() };
  mocks.execute
    .mockReset()
    .mockImplementation(async (request: { input: { action: string } }) =>
      request.input.action === "read" ? missing : draft,
    );
  await act(() => {
    renderer = create(<WeavraProjectSetup {...props} />);
  });
});
afterEach(async () => {
  await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

it("creates reviewed configuration explicitly without generating on render", async () => {
  expect(mocks.execute).not.toHaveBeenCalled();
  await act(() => button("프로젝트 설정").props.onClick());
  expect(mocks.execute).toHaveBeenLastCalledWith({
    environmentId: props.scope.environmentId,
    input: { scope: props.scope, action: "draft" },
  });
  expect(renderer.root.findByProps({ "data-weavra": "claude-code-consent" }).props.checked).toBe(
    false,
  );
  expect(textarea().props.rows).toBe(14);
  expect(button("검토 후 저장").props.disabled).toBe(true);
  await act(() => review().props.onChange({ target: { checked: true } }));
  await act(() => button("검토 후 저장").props.onClick());
  expect(mocks.execute).toHaveBeenLastCalledWith({
    environmentId: props.scope.environmentId,
    input: { scope: props.scope, action: "save", targetDigest, yaml },
  });
});

it("loads existing YAML and updates only against its separate config digest", async () => {
  props = { ...props, available: false };
  mocks.execute.mockResolvedValue(read);
  await act(() => renderer.update(<WeavraProjectSetup {...props} />));
  await act(() => button("프로젝트 설정").props.onClick());
  expect(mocks.execute).toHaveBeenLastCalledWith({
    environmentId: props.scope.environmentId,
    input: { scope: props.scope, action: "read" },
  });
  expect(button("검토 후 변경 저장").props.disabled).toBe(true);
  await act(() => review().props.onChange({ target: { checked: true } }));
  await act(() => button("검토 후 변경 저장").props.onClick());
  expect(mocks.execute).toHaveBeenLastCalledWith({
    environmentId: props.scope.environmentId,
    input: {
      scope: props.scope,
      action: "update",
      targetDigest,
      expectedConfigDigest: configDigest,
      yaml,
    },
  });
});

it("inspects existing configuration on open instead of assuming the always-visible button means create", async () => {
  mocks.execute.mockResolvedValue(read);

  await act(() => button("프로젝트 설정").props.onClick());

  expect(mocks.execute.mock.calls.at(-1)?.[0].input.action).toBe("read");
  expect(button("검토 후 변경 저장").props.disabled).toBe(true);
});

it("does not fall back to creating configuration when reading fails for another reason", async () => {
  mocks.execute.mockResolvedValue({
    ...missing,
    value: { ...missing.value, result: { ...missing.value.result, code: "INVALID_CONFIG" } },
  });

  await act(() => button("프로젝트 설정").props.onClick());

  expect(mocks.execute).toHaveBeenCalledTimes(1);
  expect(mocks.execute.mock.calls[0]?.[0].input.action).toBe("read");
  expect(renderer.root.findAllByProps({ "data-weavra-action": "save-project-setup" })).toHaveLength(
    0,
  );
});

it("keeps local edits when update is refused as stale and requires a fresh explicit read", async () => {
  props = { ...props, available: false };
  mocks.execute.mockResolvedValueOnce(read).mockResolvedValueOnce({
    _tag: "Success",
    value: {
      targetDigest,
      result: {
        schemaVersion: 1,
        kind: "error",
        code: "STALE_CONFIG",
        message: "설정이 바뀌었어요. 다시 읽어 주세요.",
      },
    },
  });
  await act(() => renderer.update(<WeavraProjectSetup {...props} />));
  await act(() => button("프로젝트 설정").props.onClick());
  await act(() => review().props.onChange({ target: { checked: true } }));
  await act(() => button("검토 후 변경 저장").props.onClick());
  expect(textarea().props.value).toBe(yaml);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  expect(mocks.execute).toHaveBeenCalledTimes(2);
  expect(mocks.execute.mock.calls[1]?.[0].input).toMatchObject({
    action: "update",
    expectedConfigDigest: configDigest,
  });
});

it("preserves invalid YAML and does not enable save", async () => {
  await act(() => button("프로젝트 설정").props.onClick());
  await act(() => review().props.onChange({ target: { checked: true } }));
  await act(() => button("검토 후 저장").props.onClick());
  const field = textarea();
  await act(() => field.props.onChange({ target: { value: "schemaVersion: [\n" } }));
  expect(textarea().props.value).toBe("schemaVersion: [\n");
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  expect(
    renderer.root
      .findAllByType("button")
      .filter((node) => node.props["data-weavra-action"]?.includes("save")),
  ).toHaveLength(0);
});

it("preserves YAML on create refusal and offers no overwrite path", async () => {
  await act(() => button("프로젝트 설정").props.onClick());
  await act(() => review().props.onChange({ target: { checked: true } }));
  mocks.execute.mockResolvedValue({
    _tag: "Success",
    value: {
      targetDigest,
      result: {
        schemaVersion: 1,
        kind: "error",
        code: "PROJECT_OPERATION_FAILED",
        message: "Already exists.",
      },
    },
  });
  await act(() => button("검토 후 저장").props.onClick());
  expect(textarea().props.value).toBe(yaml);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
  expect(mocks.execute.mock.calls.at(-1)?.[0].input.action).toBe("save");
});

it("exposes explicit initialize and doctor actions after saved state", async () => {
  mocks.execute.mockResolvedValue(saved);
  props = { ...props, available: false };
  await act(() => renderer.update(<WeavraProjectSetup {...props} />));
  await act(() => button("프로젝트 설정").props.onClick());
  expect(button("설정 다시 읽고 편집")).toBeDefined();
  await act(() => button("Runtime 홈 초기화").props.onClick());
  expect(mocks.execute.mock.calls.at(-1)?.[0].input.action).toBe("initialize");
  await act(() => button("준비 상태 다시 검사").props.onClick());
  expect(mocks.execute.mock.calls.at(-1)?.[0].input.action).toBe("doctor");
});

it("keeps unsupported workspace diagnostics actionable and permits explicit review", async () => {
  mocks.execute.mockResolvedValue({
    ...draft,
    value: {
      ...draft.value,
      result: {
        ...draft.value.result,
        workspaceProfile: {
          schemaVersion: 1,
          kind: "unsupported",
          diagnostic: { code: "WORKSPACE_EVIDENCE_CAPACITY", action: "용량을 줄여 주세요." },
        },
      },
    },
  });
  await act(() => button("프로젝트 설정").props.onClick());
  expect(
    renderer.root.findAll((node) => node.children.join("").includes("WORKSPACE_EVIDENCE_CAPACITY")),
  ).toHaveLength(1);
  expect(button("검토 후 저장").props.disabled).toBe(true);
});

const policyYaml = `${yaml.replace(
  "workspace:",
  `    - id: script
      kind: custom
      executable: bash
      args: [tools/t.sh, --ci]
      required: true
workspace:`,
)}`;
const policyRead = {
  _tag: "Success",
  value: {
    targetDigest,
    result: {
      schemaVersion: 1,
      kind: "read",
      yaml: policyYaml,
      configDigest,
      checkPolicies: [
        { id: "unit", policy: "allowed", reason: "ALLOWED" },
        {
          id: "script",
          policy: "denied",
          reason: "SHELL_COMMAND",
          suggestion: {
            executable: "tools/t.sh",
            args: ["--ci"],
            note: "chmod +x와 shebang 줄이 필요해요.",
          },
        },
      ],
    },
  },
};
const fixButtons = () =>
  renderer.root
    .findAllByType("button")
    .filter((node) => node.props["data-weavra-action"] === "fix-check-policy");
const policyRows = () => renderer.root.findAllByProps({ "data-weavra": "check-policy" });

it("shows per-check policy verdicts and rewrites a denied check only after the fix click", async () => {
  mocks.execute.mockResolvedValue(policyRead);
  await act(() => button("프로젝트 설정").props.onClick());
  expect(policyRows().map((row) => row.props["data-policy"])).toEqual(["allowed", "denied"]);
  expect(renderer.root.findAll((node) => node.children.join("") === "실행 가능")).toHaveLength(1);
  expect(
    renderer.root.findAll((node) => node.children.join("").startsWith("정책에 막힘: ")).length,
  ).toBeGreaterThan(0);
  expect(textarea().props.value).not.toContain("executable: tools/t.sh");
  await act(() => review().props.onChange({ target: { checked: true } }));
  const fix = fixButtons();
  expect(fix).toHaveLength(1);

  await act(() => fix[0]!.props.onClick());

  const config = parseDocument(textarea().props.value).toJS();
  expect(config.verification.checks[1]).toMatchObject({
    id: "script",
    executable: "tools/t.sh",
    args: ["--ci"],
  });
  expect(textarea().props.value).toContain("executable: tools/t.sh");
  expect(review().props.checked).toBe(false);
  expect(policyRows().map((row) => row.props["data-policy"])).toEqual(["allowed", "fixed"]);
  expect(fixButtons()).toHaveLength(0);
  expect(mocks.execute).toHaveBeenCalledTimes(1);
});

it("renders checks without badges when an older Runtime omits checkPolicies", async () => {
  mocks.execute.mockResolvedValue({
    ...read,
    value: { ...read.value, result: { ...read.value.result, yaml: policyYaml } },
  });
  await act(() => button("프로젝트 설정").props.onClick());
  expect(renderer.root.findAllByProps({ "data-weavra": "project-check-id" })).toHaveLength(2);
  expect(policyRows()).toHaveLength(0);
  expect(button("검토 후 변경 저장")).toBeDefined();
});

const trialRuns = () =>
  mocks.execute.mock.calls.filter(
    (call) => (call[0] as { input: { action: string } }).input.action === "trial-check",
  );
const trialResult = (overrides: Record<string, unknown>) => ({
  _tag: "Success",
  value: {
    targetDigest,
    result: {
      schemaVersion: 1,
      kind: "trial-check",
      checkId: "unit",
      exitCode: 0,
      durationMs: 12,
      outputBytes: 5,
      truncated: false,
      timedOut: false,
      stdoutTail: "ok\n",
      ...overrides,
    },
  },
});

it("runs an allowed saved check only after the one-time consent and shows its outcome", async () => {
  mocks.execute.mockResolvedValue(policyRead);
  await act(() => button("프로젝트 설정").props.onClick());
  expect(
    renderer.root
      .findAllByType("button")
      .filter((node) => node.props["data-weavra-action"] === "trial-check"),
  ).toHaveLength(1);

  await act(() => button("시험 실행").props.onClick());
  expect(
    renderer.root.findByProps({ "data-weavra": "check-trial-consent" }).children.join(""),
  ).toContain("이 명령을 지금 한 번 실행해요");
  expect(trialRuns()).toHaveLength(0);
  await act(() => button("취소").props.onClick());
  expect(trialRuns()).toHaveLength(0);

  mocks.execute.mockResolvedValue(trialResult({}));
  await act(() => button("시험 실행").props.onClick());
  await act(() => button("실행").props.onClick());
  expect(trialRuns()).toEqual([
    [
      {
        environmentId: props.scope.environmentId,
        input: {
          scope: props.scope,
          action: "trial-check",
          targetDigest,
          checkId: "unit",
          consent: true,
        },
      },
    ],
  ]);
  expect(renderer.root.findByProps({ "data-weavra": "check-trial-badge" }).children).toEqual([
    "통과",
  ]);
  expect(renderer.root.findAllByProps({ "data-weavra": "check-trial-warning" })).toHaveLength(0);
  expect(textarea().props.value).toBe(policyYaml);
});

it.each([
  [{ exitCode: 3 }, "실패", false],
  [{ exitCode: null, timedOut: true }, "시간 초과", true],
  [{ exitCode: null, truncated: true, outputBytes: 20480 }, "출력 초과", true],
])("shows the trial outcome %j as %s", async (overrides, label, warned) => {
  mocks.execute.mockResolvedValue(policyRead);
  await act(() => button("프로젝트 설정").props.onClick());
  mocks.execute.mockResolvedValue(trialResult(overrides));
  await act(() => button("시험 실행").props.onClick());
  await act(() => button("실행").props.onClick());
  expect(renderer.root.findByProps({ "data-weavra": "check-trial-badge" }).children).toEqual([
    label,
  ]);
  expect(renderer.root.findAllByProps({ "data-weavra": "check-trial-warning" })).toHaveLength(
    warned ? 1 : 0,
  );
});

it("offers no trial run for denied checks or unsaved local edits", async () => {
  mocks.execute.mockResolvedValue(policyRead);
  await act(() => button("프로젝트 설정").props.onClick());
  const rows = renderer.root.findAllByProps({ "data-weavra": "check-trial" });
  expect(rows).toHaveLength(1);
  await act(() => textarea().props.onChange({ target: { value: `${policyYaml}# edited\n` } }));
  expect(renderer.root.findAllByProps({ "data-weavra": "check-trial" })).toHaveLength(0);
  expect(trialRuns()).toHaveLength(0);
});

it("asks to fix blocked checks when doctor is not ready because of check policy", async () => {
  mocks.execute.mockResolvedValue({
    _tag: "Success",
    value: {
      targetDigest,
      result: {
        ...readiness,
        kind: "doctor",
        ready: false,
        diagnostics: [
          { code: "CHECK_POLICY_DENIED:script", severity: "ERROR", action: "검사를 고쳐 주세요." },
        ],
        checkPolicies: policyRead.value.result.checkPolicies,
      },
    },
  });
  props = { ...props, available: false };
  await act(() => renderer.update(<WeavraProjectSetup {...props} />));
  await act(() => button("프로젝트 설정").props.onClick());
  const status = renderer.root.findByProps({ "data-weavra": "check-policy-blocked" });
  expect(status.children.join("")).toContain("막힌 검사를 고친 뒤 다시 점검해 주세요");
  expect(policyRows().map((row) => row.props["data-policy"])).toEqual(["denied"]);
});

it("saves Claude Code consent only after explicit selection and renewed review", async () => {
  await act(() => button("프로젝트 설정").props.onClick());
  await act(() => review().props.onChange({ target: { checked: true } }));
  const consent = renderer.root.findByProps({ "data-weavra": "claude-code-consent" });

  await act(() => consent.props.onChange({ target: { checked: true } }));

  expect(button("검토 후 저장").props.disabled).toBe(true);
  await act(() => review().props.onChange({ target: { checked: true } }));
  await act(() => button("검토 후 저장").props.onClick());
  const request = mocks.execute.mock.calls.at(-1)?.[0].input;
  expect(request.action).toBe("save");
  expect(parseDocument(request.yaml).toJS().models.claude_code.enabled).toBe(true);
});

const presetDraft = {
  ...draft,
  value: {
    ...draft.value,
    presets: [
      {
        id: "balanced",
        selected: {
          instanceId: "codex",
          displayName: "Codex",
          provider: "codex",
          coding: "coding-model",
          reasoning: "reasoning-model",
        },
        alternatives: [],
      },
      {
        id: "quality",
        selected: {
          instanceId: "codex",
          displayName: "Codex",
          provider: "codex",
          coding: "quality-model",
          reasoning: "quality-model",
        },
        alternatives: [],
      },
      { id: "speed", selected: null, alternatives: [] },
    ],
  },
};
const presetSelect = () => renderer.root.findByProps({ "data-weavra": "project-preset" });
const prepareButton = () =>
  renderer.root.findByProps({ "data-weavra-action": "prepare-project-defaults" });

it("prepares a balanced local draft automatically without saving, initializing or granting consent", async () => {
  mocks.execute.mockImplementation(async (request: { input: { action: string } }) =>
    request.input.action === "read" ? missing : presetDraft,
  );
  props = { ...props, autoPrepare: true };

  await act(() => renderer.update(<WeavraProjectSetup {...props} />));

  expect(mocks.execute.mock.calls.map(([request]) => request.input.action)).toEqual([
    "read",
    "draft",
  ]);
  expect(presetSelect().props.value).toBe("balanced:codex");
  expect(renderer.root.findAllByProps({ "data-weavra": "project-setup-review" })).toHaveLength(0);
  expect(renderer.root.findAllByProps({ "data-weavra": "claude-code-consent" })).toHaveLength(0);
  expect(prepareButton().props.disabled).toBe(false);
});

it("saves the deliberately selected preset then initializes and checks only after the prepare action", async () => {
  mocks.execute.mockImplementation(async (request: { input: { action: string } }) => {
    switch (request.input.action) {
      case "read":
        return missing;
      case "draft":
        return presetDraft;
      case "save":
        return saved;
      case "initialize":
        return { _tag: "Success", value: { targetDigest, result: { kind: "initialized" } } };
      default:
        return {
          _tag: "Success",
          value: { targetDigest, result: { kind: "doctor", ...readiness } },
        };
    }
  });
  props = { ...props, autoPrepare: true };
  await act(() => renderer.update(<WeavraProjectSetup {...props} />));
  await act(() => presetSelect().props.onChange({ target: { value: "quality:codex" } }));
  expect(mocks.execute.mock.calls.map(([request]) => request.input.action)).toEqual([
    "read",
    "draft",
  ]);

  await act(() => prepareButton().props.onClick());

  expect(mocks.execute.mock.calls.map(([request]) => request.input.action)).toEqual([
    "read",
    "draft",
    "save",
    "initialize",
    "doctor",
  ]);
  const request = mocks.execute.mock.calls.find(([item]) => item.input.action === "save")?.[0];
  const config = parseDocument(request.input.yaml).toJS();
  expect(config.models.profiles.coding.model).toBe("quality-model");
  expect(config.models.profiles.reasoning.model).toBe("quality-model");
  expect(config.models.claude_code?.enabled ?? false).toBe(false);
  expect(config.files.allowed_paths).toEqual(["src"]);
});

it("keeps existing configuration and its CAS digest when fetching preset candidates", async () => {
  const document = parseDocument(yaml);
  document.setIn(["models", "profiles", "coding", "model"], "hand-picked-model");
  document.set("custom_setting", "preserve");
  const existingYaml = document.toString();
  mocks.execute.mockImplementation(async (request: { input: { action: string } }) =>
    request.input.action === "read"
      ? { ...read, value: { ...read.value, result: { ...read.value.result, yaml: existingYaml } } }
      : request.input.action === "draft"
        ? presetDraft
        : saved,
  );
  props = { ...props, autoPrepare: true };
  await act(() => renderer.update(<WeavraProjectSetup {...props} />));
  expect(presetSelect().props.value).toBe("manual");
  expect(mocks.execute).toHaveBeenCalledTimes(2);
  await act(() => presetSelect().props.onChange({ target: { value: "quality:codex" } }));
  await act(() => prepareButton().props.onClick());

  const update = mocks.execute.mock.calls.find(
    ([request]) => request.input.action === "update",
  )?.[0];
  expect(update.input.expectedConfigDigest).toBe(configDigest);
  expect(parseDocument(update.input.yaml).toJS().custom_setting).toBe("preserve");
  expect(parseDocument(update.input.yaml).toJS().models.profiles.coding.model).toBe(
    "quality-model",
  );
});

it("preserves explicit model intent routing instead of presenting an ineffective preset change", async () => {
  const document = parseDocument(yaml);
  document.setIn(["models", "intents", "developer"], "fast");
  const manualYaml = document.toString();
  mocks.execute.mockImplementation(async (request: { input: { action: string } }) =>
    request.input.action === "read"
      ? { ...read, value: { ...read.value, result: { ...read.value.result, yaml: manualYaml } } }
      : presetDraft,
  );
  props = { ...props, autoPrepare: true };

  await act(() => renderer.update(<WeavraProjectSetup {...props} />));

  expect(presetSelect().props.disabled).toBe(true);
  await act(() => presetSelect().props.onChange({ target: { value: "quality:codex" } }));
  expect(presetSelect().props.value).toBe("manual");
  expect(mocks.execute.mock.calls.map(([request]) => request.input.action)).toEqual([
    "read",
    "draft",
  ]);
});

it("does not enable automatic setup with an empty model selection", async () => {
  const document = parseDocument(yaml);
  document.setIn(["models", "profiles", "coding", "model"], "");
  mocks.execute.mockImplementation(async (request: { input: { action: string } }) =>
    request.input.action === "read"
      ? missing
      : {
          ...draft,
          value: {
            ...draft.value,
            result: { ...draft.value.result, yaml: document.toString() },
          },
        },
  );
  props = { ...props, autoPrepare: true };

  await act(() => renderer.update(<WeavraProjectSetup {...props} />));

  expect(prepareButton().props.disabled).toBe(true);
  expect(mocks.execute.mock.calls.map(([request]) => request.input.action)).toEqual([
    "read",
    "draft",
  ]);
});

it("does not initialize or retry after an uncertain automatic setup save", async () => {
  mocks.execute.mockImplementation(async (request: { input: { action: string } }) =>
    request.input.action === "read"
      ? missing
      : request.input.action === "draft"
        ? presetDraft
        : { _tag: "Failure", code: "INTERNAL_ERROR" },
  );
  props = { ...props, autoPrepare: true };
  await act(() => renderer.update(<WeavraProjectSetup {...props} />));

  await act(() => prepareButton().props.onClick());

  expect(mocks.execute.mock.calls.map(([request]) => request.input.action)).toEqual([
    "read",
    "draft",
    "save",
  ]);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(1);
});

it("offers first-start preparation without mutating Git from the automatic read", async () => {
  mocks.execute.mockResolvedValue({ _tag: "Failure", code: "TARGET_CHANGED" });
  props = { ...props, autoPrepare: true };

  await act(() => renderer.update(<WeavraProjectSetup {...props} />));

  expect(mocks.execute.mock.calls.map(([request]) => request.input.action)).toEqual(["read"]);
  expect(
    renderer.root.findAllByProps({ "data-weavra": "repository-preparation-needed" }),
  ).toHaveLength(1);
  expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(props.onSaved).not.toHaveBeenCalled();
});

it("keeps setup busy through the complete read and candidate inspection sequence", async () => {
  let resolveCandidates: ((value: typeof presetDraft) => void) | undefined;
  const candidates = new Promise<typeof presetDraft>((resolve) => {
    resolveCandidates = resolve;
  });
  mocks.execute.mockImplementation((request: { input: { action: string } }) =>
    request.input.action === "read" ? Promise.resolve(read) : candidates,
  );
  props = { ...props, autoPrepare: true };
  await act(() => renderer.update(<WeavraProjectSetup {...props} />));
  expect(presetSelect().props.disabled).toBe(true);
  expect(
    renderer.root.findByProps({ "data-weavra": "project-setup-status" }).props["aria-busy"],
  ).toBe(true);

  await act(async () => {
    if (!resolveCandidates) throw new Error("Missing candidate resolver");
    resolveCandidates(presetDraft);
  });

  expect(presetSelect().props.disabled).toBe(false);
  expect(
    renderer.root.findByProps({ "data-weavra": "project-setup-status" }).props["aria-busy"],
  ).toBe(false);
  expect(presetSelect().props.value).toBe("manual");
  expect(mocks.execute.mock.calls.map(([request]) => request.input.action)).toEqual([
    "read",
    "draft",
  ]);
});
