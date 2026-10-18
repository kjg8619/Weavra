import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  WeavraProjectSetupInput,
  WeavraProjectSetupOutput,
  WeavraProjectSetupResult,
} from "./weavraProjectSetup.ts";

const digest = `sha256:${"a".repeat(64)}`;
const scope = {
  environmentId: "environment",
  projectId: "project",
  threadId: "thread",
};
const decodeInput = Schema.decodeUnknownSync(WeavraProjectSetupInput, {
  onExcessProperty: "error",
});
const decodeOutput = Schema.decodeUnknownSync(WeavraProjectSetupOutput, {
  onExcessProperty: "error",
});
const decodeResult = Schema.decodeUnknownSync(WeavraProjectSetupResult, {
  onExcessProperty: "error",
});
const readiness = {
  schemaVersion: 1,
  ready: true,
  diagnostics: [
    { code: "BOUNDARIES_LOCAL_ONLY", severity: "INFO", action: "설정을 검토해 주세요." },
  ],
  configuration: {
    requiredChecks: 1,
    sandboxMode: "required",
    budgetConfigured: false,
    maxWorkerInvocations: null,
    maxReportedTokens: null,
  },
  workspaceAssessment: {
    schemaVersion: 1,
    kind: "supported",
    profile: { mode: "default", candidate: false },
    fileCount: 4,
    totalBytes: 1024,
  },
};
const yaml = "schemaVersion: 1\n";

describe("Weavra project setup wire contract", () => {
  it("accepts only the phase-two scoped actions and their required digest fields", () => {
    for (const action of ["draft", "read", "doctor", "initialize"]) {
      expect(decodeInput({ scope, action })).toMatchObject({ scope, action });
    }
    expect(decodeInput({ scope, action: "save", targetDigest: digest, yaml })).toMatchObject({
      action: "save",
      targetDigest: digest,
      yaml,
    });
    expect(
      decodeInput({
        scope,
        action: "update",
        targetDigest: digest,
        expectedConfigDigest: `sha256:${"b".repeat(64)}`,
        yaml,
      }),
    ).toMatchObject({ action: "update", targetDigest: digest });
    expect(
      decodeInput({
        scope,
        action: "trial-check",
        targetDigest: digest,
        checkId: "unit",
        consent: true,
      }),
    ).toMatchObject({ action: "trial-check", checkId: "unit", consent: true });
  });

  it("requires literal consent: true for a trial check", () => {
    const trial = { scope, action: "trial-check", targetDigest: digest, checkId: "unit" };
    for (const value of [
      trial,
      { ...trial, consent: false },
      { ...trial, consent: "true" },
      { ...trial, consent: 1 },
    ]) {
      expect(() => decodeInput(value)).toThrow();
    }
  });

  it("rejects malformed, extra authority, environment, and credential fields", () => {
    for (const value of [
      { scope, action: "read", cwd: "/private" },
      { scope, action: "read", argv: ["--json"] },
      { scope, action: "read", env: { HOME: "/private" } },
      { scope, action: "read", apiKey: "secret" },
      { scope, action: "read", credentials: { token: "secret" } },
      { scope, action: "update", targetDigest: digest, yaml },
      { scope, action: "save", targetDigest: "sha256:bad", yaml },
      { scope, action: "read", targetDigest: digest },
      { scope, action: "save", targetDigest: digest, yaml, expectedConfigDigest: digest },
      {
        scope,
        action: "update",
        targetDigest: digest,
        expectedConfigDigest: digest,
        yaml,
        cwd: "/private",
      },
      {
        scope,
        action: "update",
        targetDigest: digest,
        expectedConfigDigest: digest,
        yaml,
        env: { API_KEY: "secret" },
      },
      { scope: { ...scope, env: {} }, action: "draft" },
    ]) {
      expect(() => decodeInput(value)).toThrow();
    }
    expect(() =>
      decodeInput({ scope, action: "save", targetDigest: digest, yaml: "é".repeat(32_769) }),
    ).toThrow();
  });

  it("mirrors bounded Runtime draft, read, doctor, initialize, and update results", () => {
    const workspaceProfile = readiness.workspaceAssessment;
    expect(
      decodeOutput({
        schemaVersion: 1,
        kind: "draft",
        projectTypes: ["Node"],
        workspaceProfile,
        yaml,
      }),
    ).toMatchObject({ kind: "draft", workspaceProfile });
    expect(
      decodeOutput({ schemaVersion: 1, kind: "read", yaml, configDigest: digest }),
    ).toMatchObject({
      kind: "read",
      configDigest: digest,
    });
    expect(decodeOutput({ ...readiness, kind: "doctor" })).toMatchObject({
      kind: "doctor",
      workspaceAssessment: readiness.workspaceAssessment,
    });
    expect(decodeOutput({ schemaVersion: 1, kind: "initialized" })).toEqual({
      schemaVersion: 1,
      kind: "initialized",
    });
    expect(
      decodeOutput({
        schemaVersion: 1,
        kind: "saved",
        yaml,
        configDigest: digest,
        readiness,
      }),
    ).toMatchObject({ kind: "saved", configDigest: digest, readiness });
    for (const code of ["TRIAL_CHECK_CONSENT_REQUIRED", "TRIAL_CHECK_WRITER_ACTIVE"]) {
      expect(decodeOutput({ schemaVersion: 1, kind: "error", code, message: "x" })).toMatchObject({
        code,
      });
    }
  });

  it("keeps target and config digests distinct and excludes credential-bearing output fields", () => {
    const result = {
      targetDigest: digest,
      result: { schemaVersion: 1, kind: "read", yaml, configDigest: `sha256:${"b".repeat(64)}` },
    };
    expect(decodeResult(result)).toEqual(result);
    for (const value of [
      { ...result, apiKey: "secret" },
      { ...result, credentials: { token: "secret" } },
      { ...result, configDigest: digest },
      { ...result, result: { ...result.result, env: {} } },
    ]) {
      expect(() => decodeResult(value)).toThrow();
    }
  });

  it("accepts optional check policy verdicts and draft notes, keeping unknown verdict keys", () => {
    const checkPolicies = [
      {
        id: "unit",
        policy: "denied",
        reason: "SHELL_COMMAND",
        suggestion: { executable: "tools/t.sh", args: ["--ci"], note: "chmod +x" },
        addedLater: 1,
      },
      { id: "lint", policy: "allowed", reason: "ALLOWED" },
    ];
    expect(decodeOutput({ ...readiness, kind: "doctor", checkPolicies })).toMatchObject({
      checkPolicies,
    });
    expect(
      decodeOutput({ schemaVersion: 1, kind: "read", yaml, configDigest: digest, checkPolicies }),
    ).toMatchObject({ checkPolicies });
    expect(
      decodeOutput({
        schemaVersion: 1,
        kind: "draft",
        projectTypes: ["Node"],
        workspaceProfile: readiness.workspaceAssessment,
        yaml,
        checkPolicies,
        notes: ["EXECUTABLE_UNAVAILABLE:node-test", "NO_CHECK_CANDIDATES"],
      }),
    ).toMatchObject({ notes: ["EXECUTABLE_UNAVAILABLE:node-test", "NO_CHECK_CANDIDATES"] });
    expect(decodeOutput({ ...readiness, kind: "doctor" })).not.toHaveProperty("checkPolicies");
    expect(() =>
      decodeOutput({
        ...readiness,
        kind: "doctor",
        checkPolicies: [{ id: "unit", policy: "maybe", reason: "x" }],
      }),
    ).toThrow();
  });

  it("accepts only bounded workspace advisory variants", () => {
    expect(
      decodeOutput({
        schemaVersion: 1,
        kind: "draft",
        projectTypes: ["Generic"],
        workspaceProfile: {
          schemaVersion: 1,
          kind: "unsupported",
          diagnostic: { code: "WORKSPACE_EVIDENCE_CAPACITY", action: "경로를 좁혀 주세요." },
        },
        yaml,
      }),
    ).toMatchObject({ workspaceProfile: { kind: "unsupported" } });
    expect(() =>
      decodeOutput({
        ...readiness,
        kind: "doctor",
        workspaceAssessment: {
          schemaVersion: 1,
          kind: "unsupported",
          diagnostic: { code: "PRIVATE_DIAGNOSTIC", action: "safe" },
        },
      }),
    ).toThrow();
  });
});
