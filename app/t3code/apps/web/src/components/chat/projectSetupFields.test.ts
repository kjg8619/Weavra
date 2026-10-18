import { expect, it } from "vite-plus/test";
import { parseDocument } from "yaml";
import {
  parseProjectSetupFields,
  patchProjectSetupFields,
  type ProjectSetupFields,
} from "./projectSetupFields";

const source = `schemaVersion: 1
unknownRoot:
  keep: true
models:
  profiles:
    coding: { provider: old-provider, model: old-coding }
    reasoning: { provider: old-provider, model: old-reasoning }
files:
  allowed_paths: [src]
verification:
  sandbox: { mode: required }
  checks:
    - id: unit
      kind: test
      executable: node
      args: [scripts/test.mjs, "--runInBand"]
      required: true
      timeout_ms: 5000
      trust: { files: [package.json, pnpm-lock.yaml] }
      repairable_exit_codes: [1]
    - id: browser-smoke
      kind: browser
      executable: browser-runner
      browser: { url: http://localhost }
workspace:
  evidence: { mode: bounded-monorepo }
`;

const updatedFields: ProjectSetupFields = {
  claudeCodeEnabled: false,
  coding: { provider: "openai-codex", model: "gpt-coding" },
  reasoning: { provider: "openai-codex", model: "gpt-reasoning" },
  allowedRoots: ["src", "test"],
  checks: [
    {
      id: "unit",
      originalId: "unit",
      kind: "test",
      executable: "node",
      args: ["scripts/test.mjs", "--runInBand", "$(touch nope)"],
      required: false,
      timeout_ms: 9000,
    },
  ],
  sandbox: "required",
  evidenceProfile: "bounded-monorepo",
};

it("reads the real basic fields and reports browser checks as advanced", () => {
  const result = parseProjectSetupFields(source);
  expect(result.status).toBe("valid");
  if (result.status !== "valid") return;
  expect(result.fields).toEqual({
    claudeCodeEnabled: false,
    coding: { provider: "old-provider", model: "old-coding" },
    reasoning: { provider: "old-provider", model: "old-reasoning" },
    allowedRoots: ["src"],
    checks: [
      {
        id: "unit",
        originalId: "unit",
        kind: "test",
        executable: "node",
        args: ["scripts/test.mjs", "--runInBand"],
        required: true,
        timeout_ms: 5000,
      },
    ],
    sandbox: "required",
    evidenceProfile: "bounded-monorepo",
  });
  expect(result.advancedChecks).toHaveLength(1);
});

it("patches fields while retaining unknown YAML and matching check trust", () => {
  const patched = patchProjectSetupFields(source, updatedFields);
  const roundTrip = parseDocument(patched, { uniqueKeys: true }).toJS();
  expect(roundTrip.unknownRoot).toEqual({ keep: true });
  expect(roundTrip.models.profiles.coding).toEqual(updatedFields.coding);
  expect(roundTrip.files.allowed_paths).toEqual(["src", "test"]);
  expect(roundTrip.verification.checks[0]).toEqual({
    id: "unit",
    kind: "test",
    executable: "node",
    args: updatedFields.checks[0]?.args,
    required: false,
    timeout_ms: 9000,
    trust: { files: ["package.json", "pnpm-lock.yaml"] },
    repairable_exit_codes: [1],
  });
  expect(roundTrip.verification.checks[0].args).toEqual([
    "scripts/test.mjs",
    "--runInBand",
    "$(touch nope)",
  ]);
  expect(roundTrip.verification.checks[1].kind).toBe("browser");
});

it("returns invalid YAML without replacing the editable draft", () => {
  const invalid = "schemaVersion: [";
  expect(parseProjectSetupFields(invalid)).toMatchObject({
    status: "invalid",
    yaml: invalid,
  });
  expect(() => patchProjectSetupFields(invalid, updatedFields)).toThrow();
});

it("does not widen a default evidence profile when unrelated model fields change", () => {
  const document = parseDocument(source);
  document.delete("workspace");
  const parsed = parseProjectSetupFields(document.toString());
  expect(parsed.status).toBe("valid");
  if (parsed.status !== "valid") throw new Error("Invalid fixture");
  expect(parsed.fields.evidenceProfile).toBe("default");

  const patched = patchProjectSetupFields(parsed.yaml, {
    ...parsed.fields,
    coding: { ...parsed.fields.coding, model: "edited-model" },
  });

  expect(parseDocument(patched).toJS().workspace).toBeUndefined();
});

it("removes reviewed process checks while preserving advanced browser checks", () => {
  const parsed = parseProjectSetupFields(source);
  expect(parsed.status).toBe("valid");
  if (parsed.status !== "valid") throw new Error("Invalid fixture");

  const patched = patchProjectSetupFields(source, { ...parsed.fields, checks: [] });

  expect(
    parseDocument(patched)
      .toJS()
      .verification.checks.map((check: { id: string }) => check.id),
  ).toEqual(["browser-smoke"]);
});

it("round trips explicit Claude Code consent without enabling it by default", () => {
  const parsed = parseProjectSetupFields(source);
  expect(parsed.status).toBe("valid");
  if (parsed.status !== "valid") throw new Error("Invalid fixture");
  expect(parsed.fields.claudeCodeEnabled).toBe(false);
  const document = parseDocument(source);
  document.setIn(["models", "claude_code", "enabled"], true);

  const consented = parseProjectSetupFields(document.toString());

  expect(consented.status).toBe("valid");
  if (consented.status !== "valid") throw new Error("Invalid fixture");
  expect(consented.fields.claudeCodeEnabled).toBe(true);
  const revoked = patchProjectSetupFields(consented.yaml, {
    ...consented.fields,
    claudeCodeEnabled: false,
  });
  expect(parseDocument(revoked).toJS().models.claude_code.enabled).toBe(false);
});

it("keeps the Runtime disabled sandbox default on an unrelated model edit", () => {
  const document = parseDocument(source);
  document.deleteIn(["verification", "sandbox"]);
  const parsed = parseProjectSetupFields(document.toString());
  if (parsed.status !== "valid") throw new Error("Invalid fixture");
  expect(parsed.fields.sandbox).toBe("disabled");
  const changed = patchProjectSetupFields(parsed.yaml, {
    ...parsed.fields,
    coding: { ...parsed.fields.coding, model: "edited" },
  });
  expect(parseDocument(changed).toJS().verification.sandbox.mode).toBe("disabled");
});

it("represents an omitted required flag using the Runtime true default", () => {
  const document = parseDocument(source);
  document.deleteIn(["verification", "checks", 0, "required"]);
  const parsed = parseProjectSetupFields(document.toString());
  if (parsed.status !== "valid") throw new Error("Invalid fixture");
  expect(parsed.fields.checks[0]?.required).toBe(true);
});

it("preserves advanced registration fields when a process check is renamed", () => {
  const parsed = parseProjectSetupFields(source);
  if (parsed.status !== "valid") throw new Error("Invalid fixture");
  const changed = patchProjectSetupFields(source, {
    ...parsed.fields,
    checks: parsed.fields.checks.map((check) => ({ ...check, id: "renamed" })),
  });
  expect(parseDocument(changed).toJS().verification.checks[0]).toMatchObject({
    id: "renamed",
    timeout_ms: 5000,
    trust: { files: ["package.json", "pnpm-lock.yaml"] },
    repairable_exit_codes: [1],
  });
});

it.each([true, false])("retains the explicit required flag %s", (required) => {
  const document = parseDocument(source);
  document.setIn(["verification", "checks", 0, "required"], required);
  const parsed = parseProjectSetupFields(document.toString());
  if (parsed.status !== "valid") throw new Error("Invalid fixture");
  expect(parsed.fields.checks[0]?.required).toBe(required);
});

it("keeps duplicate check IDs in an invalid draft without editing them", () => {
  const document = parseDocument(source);
  document.setIn(["verification", "checks", 1, "id"], "unit");
  const yaml = document.toString();
  expect(parseProjectSetupFields(yaml)).toMatchObject({ status: "invalid", yaml });
});
