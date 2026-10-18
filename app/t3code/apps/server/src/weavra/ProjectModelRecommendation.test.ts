import { ServerProvider, WeavraProjectSetupOutput } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { recommendProjectModels } from "./ProjectModelRecommendation.ts";

const provider = (id: string, driver = "codex") =>
  Schema.decodeUnknownSync(ServerProvider)({
    instanceId: id,
    driver,
    displayName: id,
    installed: true,
    enabled: true,
    version: "1",
    status: "ready",
    auth: { status: "authenticated", type: "oauth" },
    checkedAt: "2026-10-15T00:00:00.000Z",
    models: [
      {
        slug: "coding-model",
        name: "Coding",
        isDefault: true,
        isCustom: false,
        capabilities: null,
      },
      { slug: "reasoning-model", name: "Reasoning", isCustom: false, capabilities: null },
      { slug: "app-only-model", name: "Unknown to Runtime", isCustom: false, capabilities: null },
      { slug: "custom-model", name: "Custom", isCustom: true, capabilities: null },
    ],
  });
const decodeDraft = (input: unknown) => {
  const value = Schema.decodeUnknownSync(WeavraProjectSetupOutput)(input);
  if (value.kind !== "draft") throw new Error("Expected draft fixture");
  return value;
};
const workspaceProfile = {
  schemaVersion: 1,
  kind: "supported",
  profile: { mode: "default", candidate: false },
  fileCount: 1,
  totalBytes: 1,
} as const;
const yaml =
  "models:\n  profiles:\n    coding: {provider: '', model: ''}\n    reasoning: {provider: '', model: ''}\n";
const draft = decodeDraft({
  schemaVersion: 1,
  kind: "draft",
  projectTypes: ["Node"],
  workspaceProfile,
  yaml,
  modelAvailability: {
    providers: [
      {
        provider: "openai-codex",
        models: [
          { id: "coding-model", reasoning: false },
          { id: "reasoning-model", reasoning: true },
          { id: "custom-model", reasoning: true },
        ],
      },
    ],
  },
});

it("prefills deterministically from authenticated App providers and the Runtime catalog", () => {
  const result = recommendProjectModels(draft, [provider("z"), provider("a")]);
  expect(result.recommendation.selected).toEqual({
    instanceId: "a",
    displayName: "a",
    provider: "openai-codex",
    coding: "coding-model",
    reasoning: "reasoning-model",
  });
  expect(result.recommendation.alternatives.map((item) => item.instanceId)).toEqual(["z"]);
  expect(result.recommendation.anthropicOmitted).toBe(false);
  expect(parse(result.draft.yaml).models.profiles).toEqual({
    coding: { provider: "openai-codex", model: "coding-model" },
    reasoning: { provider: "openai-codex", model: "reasoning-model" },
  });
});

it("never translates the App Claude login into a Runtime anthropic profile", () => {
  const poisoned = {
    ...draft,
    modelAvailability: {
      providers: [{ provider: "anthropic", models: [{ id: "coding-model", reasoning: true }] }],
    },
  };
  const result = recommendProjectModels(poisoned, [
    provider("claude", "claudeAgent"),
    provider("codex"),
  ]);
  expect(result.recommendation).toEqual({
    selected: null,
    alternatives: [],
    anthropicOmitted: true,
  });
  expect(result.draft.yaml).toBe(draft.yaml);
  expect(result.draft.yaml).not.toContain("anthropic");
});

it("keeps the Codex prefill while reporting the omitted Claude login", () => {
  const result = recommendProjectModels(draft, [
    provider("claude", "claudeAgent"),
    provider("codex"),
  ]);
  expect(result.recommendation.selected?.provider).toBe("openai-codex");
  expect(result.recommendation.anthropicOmitted).toBe(true);
  expect(
    JSON.stringify([result.recommendation.selected, result.recommendation.alternatives]),
  ).not.toContain("anthropic");
  expect(result.draft.yaml).not.toContain("anthropic");
});

it("leaves the profiles empty without an eligible provider or a Runtime catalog match", () => {
  const base = provider("codex");
  for (const candidates of [
    [],
    [{ ...base, auth: { status: "unauthenticated" as const } }],
    [{ ...base, installed: false }],
    [{ ...base, enabled: false }],
    [{ ...base, availability: "unavailable" as const }],
    [provider("cursor", "cursor")],
  ]) {
    const result = recommendProjectModels(draft, candidates);
    expect(result.recommendation.selected).toBeNull();
    expect(result.draft.yaml).toBe(draft.yaml);
  }
  expect(
    recommendProjectModels({ ...draft, modelAvailability: { providers: [] } }, [base]).draft.yaml,
  ).toBe(draft.yaml);
  const bare = decodeDraft({
    schemaVersion: 1,
    kind: "draft",
    projectTypes: ["Node"],
    workspaceProfile,
    yaml,
  });
  expect(recommendProjectModels(bare, [base]).draft.yaml).toBe(yaml);
});
