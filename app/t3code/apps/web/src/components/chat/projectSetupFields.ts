import { parseDocument } from "yaml";

export type ProjectCheckKind = "build" | "lint" | "test" | "typecheck" | "format" | "custom";

export type ProjectSetupCheck = {
  id: string;
  originalId?: string;
  kind: ProjectCheckKind;
  executable: string;
  args: string[];
  cwd?: string;
  required?: boolean;
  timeout_ms?: number;
};

export type ProjectSetupFields = {
  coding: { provider: string; model: string };
  reasoning: { provider: string; model: string };
  claudeCodeEnabled: boolean;
  allowedRoots: string[];
  checks: ProjectSetupCheck[];
  sandbox: "required" | "disabled";
  evidenceProfile: "default" | "bounded-monorepo";
};

export type ProjectSetupParseResult =
  | {
      status: "valid";
      yaml: string;
      fields: ProjectSetupFields;
      advancedChecks: readonly unknown[];
      hasModelIntents: boolean;
    }
  | { status: "invalid"; yaml: string; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== "string") {
    throw new Error(`설정의 ${key} 값은 문자열이어야 해요.`);
  }
  return value[key];
}

function parseCheck(value: unknown): ProjectSetupCheck {
  if (!isRecord(value)) throw new Error("검사 항목은 객체여야 해요.");
  if (value.kind === "browser")
    throw new Error("브라우저 검사는 고급 설정에서만 확인할 수 있어요.");
  if (
    value.kind !== "build" &&
    value.kind !== "lint" &&
    value.kind !== "test" &&
    value.kind !== "typecheck" &&
    value.kind !== "format" &&
    value.kind !== "custom"
  ) {
    throw new Error("지원하지 않는 검사 종류는 고급 설정에서 확인해 주세요.");
  }
  if (typeof value.id !== "string" || typeof value.executable !== "string") {
    throw new Error("검사 ID와 실행 파일을 입력해 주세요.");
  }
  if (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string")) {
    throw new Error("검사 인수는 문자열 목록이어야 해요.");
  }
  if (value.cwd !== undefined && typeof value.cwd !== "string") {
    throw new Error("검사 작업 경로는 문자열이어야 해요.");
  }
  if (value.required !== undefined && typeof value.required !== "boolean") {
    throw new Error("필수 검사 여부는 참 또는 거짓이어야 해요.");
  }
  if (value.timeout_ms !== undefined && typeof value.timeout_ms !== "number") {
    throw new Error("검사 제한 시간은 숫자여야 해요.");
  }
  return {
    id: value.id,
    originalId: value.id,
    kind: value.kind,
    executable: value.executable,
    args: [...value.args],
    ...(typeof value.cwd === "string" ? { cwd: value.cwd } : {}),
    required: value.required ?? true,
    ...(typeof value.timeout_ms === "number" ? { timeout_ms: value.timeout_ms } : {}),
  };
}

function toFields(value: unknown): ProjectSetupFields {
  if (!isRecord(value)) throw new Error("설정의 최상위 값은 객체여야 해요.");
  const models = value.models;
  if (!isRecord(models) || !isRecord(models.profiles)) {
    throw new Error("코딩과 추론 모델 설정이 필요해요.");
  }
  const coding = models.profiles.coding;
  const reasoning = models.profiles.reasoning;
  const claudeCode = models.claude_code;
  if (
    claudeCode !== undefined &&
    (!isRecord(claudeCode) || typeof claudeCode.enabled !== "boolean")
  ) {
    throw new Error("Claude Code 사용 허용 값은 참 또는 거짓이어야 해요.");
  }
  const files = value.files;
  const allowedRoots =
    isRecord(files) && Array.isArray(files.allowed_paths) ? files.allowed_paths : [];
  if (!allowedRoots.every((path) => typeof path === "string")) {
    throw new Error("허용 경로는 문자열 목록이어야 해요.");
  }
  const verification = value.verification;
  const checks =
    isRecord(verification) && Array.isArray(verification.checks) ? verification.checks : [];
  const basicChecks: ProjectSetupCheck[] = [];
  const advancedChecks: unknown[] = [];
  for (const check of checks) {
    if (isRecord(check) && check.kind === "browser") {
      advancedChecks.push(check);
      continue;
    }
    basicChecks.push(parseCheck(check));
  }
  const checkIds = checks.map((check) => (isRecord(check) ? check.id : undefined));
  if (new Set(checkIds).size !== checkIds.length) {
    throw new Error("검사 ID는 서로 달라야 해요.");
  }
  const sandboxMode =
    isRecord(verification) && isRecord(verification.sandbox)
      ? verification.sandbox.mode
      : undefined;
  if (sandboxMode !== undefined && sandboxMode !== "required" && sandboxMode !== "disabled") {
    throw new Error("지원하지 않는 격리 설정은 고급 설정에서 확인해 주세요.");
  }
  const workspace = value.workspace;
  const evidenceMode =
    isRecord(workspace) && isRecord(workspace.evidence) ? workspace.evidence.mode : undefined;
  if (evidenceMode !== undefined && evidenceMode !== "bounded-monorepo") {
    throw new Error("지원하지 않는 근거 범위 설정은 고급 설정에서 확인해 주세요.");
  }
  return {
    coding: { provider: stringField(coding, "provider"), model: stringField(coding, "model") },
    reasoning: {
      provider: stringField(reasoning, "provider"),
      model: stringField(reasoning, "model"),
    },
    allowedRoots: [...allowedRoots],
    claudeCodeEnabled: isRecord(claudeCode) && claudeCode.enabled === true,
    checks: basicChecks,
    sandbox: sandboxMode === "required" ? "required" : "disabled",
    evidenceProfile: evidenceMode ?? "default",
  };
}

export function parseProjectSetupFields(yaml: string): ProjectSetupParseResult {
  const document = parseDocument(yaml, { uniqueKeys: true });
  if (document.errors.length > 0) {
    return {
      status: "invalid",
      yaml,
      error: document.errors.map((error) => error.message).join("\n"),
    };
  }
  try {
    const parsed: unknown = document.toJS();
    const models = isRecord(parsed) ? parsed.models : undefined;
    return {
      status: "valid",
      yaml,
      fields: toFields(parsed),
      hasModelIntents:
        isRecord(models) && isRecord(models.intents) && Object.keys(models.intents).length > 0,
      advancedChecks: (() => {
        const verification = isRecord(parsed) ? parsed.verification : undefined;
        const checks = isRecord(verification) ? verification.checks : undefined;
        return Array.isArray(checks)
          ? checks.filter((check) => isRecord(check) && check.kind === "browser")
          : [];
      })(),
    };
  } catch (error) {
    return {
      status: "invalid",
      yaml,
      error: error instanceof Error ? error.message : "설정을 읽을 수 없어요.",
    };
  }
}

export function patchProjectSetupFields(yaml: string, fields: ProjectSetupFields): string {
  const document = parseDocument(yaml, { uniqueKeys: true });
  if (document.errors.length > 0)
    throw new Error(document.errors.map((error) => error.message).join("\n"));

  document.setIn(["models", "profiles", "coding"], fields.coding);
  document.setIn(["models", "profiles", "reasoning"], fields.reasoning);
  document.setIn(["models", "claude_code", "enabled"], fields.claudeCodeEnabled);
  document.setIn(["files", "allowed_paths"], fields.allowedRoots);
  document.setIn(["verification", "sandbox", "mode"], fields.sandbox);
  if (fields.evidenceProfile === "bounded-monorepo") {
    document.setIn(["workspace", "evidence", "mode"], fields.evidenceProfile);
  } else {
    if (document.hasIn(["workspace", "evidence", "mode"])) {
      document.deleteIn(["workspace", "evidence", "mode"]);
    }
    const value: unknown = document.toJS();
    const workspace = isRecord(value) ? value.workspace : undefined;
    if (
      isRecord(workspace) &&
      isRecord(workspace.evidence) &&
      Object.keys(workspace.evidence).length === 0
    ) {
      document.deleteIn(["workspace", "evidence"]);
      if (Object.keys(workspace).length === 1) document.delete("workspace");
    }
  }

  const parsed: unknown = document.toJS();
  const verification = isRecord(parsed) ? parsed.verification : undefined;
  const existing = isRecord(verification) ? verification.checks : undefined;
  const checkNodes: unknown[] = Array.isArray(existing) ? existing : [];
  const byId = new Map(
    fields.checks
      .filter((check) => check.originalId !== undefined)
      .map((check) => [check.originalId, check]),
  );
  const updatedIds = new Set<string>();
  const patchedNodes: unknown[] = checkNodes.flatMap((node) => {
    const value: unknown = node;
    if (!isRecord(value) || typeof value.id !== "string") return [node];
    const edited = byId.get(value.id);
    if (!edited) {
      switch (value.kind) {
        case "build":
        case "lint":
        case "test":
        case "typecheck":
        case "format":
        case "custom":
          return [];
        default:
          return [node];
      }
    }
    updatedIds.add(value.id);
    const replacement = { ...value, ...edited };
    delete replacement.originalId;
    return [replacement];
  });
  for (const check of fields.checks) {
    if (check.originalId === undefined || !updatedIds.has(check.originalId)) {
      const added = { ...check };
      delete added.originalId;
      patchedNodes.push(added);
    }
  }
  document.setIn(["verification", "checks"], patchedNodes);
  return document.toString();
}
