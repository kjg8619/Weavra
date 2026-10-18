import { ProviderDriverKind, ServerProvider, WeavraProjectSetupOutput } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { expect, it } from "vite-plus/test";
import { parse } from "yaml";
import { recommendProjectModels } from "./ProjectModelRecommendation.ts";

const inventory = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.3-codex-spark"];
const decodeProvider = Schema.decodeUnknownSync(ServerProvider);
const decodeSetup = Schema.decodeUnknownSync(WeavraProjectSetupOutput);
const provider = (models = inventory) =>
  decodeProvider({
    instanceId: "codex",
    driver: "codex",
    installed: true,
    enabled: true,
    version: "1",
    status: "ready",
    auth: { status: "authenticated", type: "oauth" },
    checkedAt: "2026-10-16T00:00:00.000Z",
    models: models.map((slug) => ({
      slug,
      name: slug,
      isDefault: slug === "gpt-6-astra" || models.length === 1,
      isCustom: false,
      capabilities: null,
    })),
  });
const draft = (models = inventory) => {
  const value = decodeSetup({
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
    yaml: "models:\n  profiles:\n    coding: {provider: '', model: ''}\n    reasoning: {provider: '', model: ''}\n",
    modelAvailability: {
      providers: [
        { provider: "openai-codex", models: models.map((id) => ({ id, reasoning: true })) },
      ],
    },
  });
  if (value.kind !== "draft") throw new Error("Invalid draft fixture");
  return value;
};

it("defaults to balanced independently of the chat default and exposes explicit presets", () => {
  const result = recommendProjectModels(draft(), [provider()]);
  expect(result.recommendation.selected?.coding).toBe("gpt-5.6-sol");
  expect(result.presets.map((preset) => [preset.id, preset.selected?.coding])).toEqual([
    ["speed", "gpt-5.3-codex-spark"],
    ["balanced", "gpt-5.6-sol"],
    ["quality", "gpt-6-astra"],
  ]);
  expect(parse(result.draft.yaml).models.profiles).toEqual({
    coding: { provider: "openai-codex", model: "gpt-5.6-sol" },
    reasoning: { provider: "openai-codex", model: "gpt-5.6-sol" },
  });
});

it("leaves unavailable speed and quality presets empty instead of substituting models", () => {
  const result = recommendProjectModels(draft(["coding-model"]), [provider(["coding-model"])]);
  expect(result.presets.map((preset) => [preset.id, preset.selected?.coding ?? null])).toEqual([
    ["speed", null],
    ["balanced", "coding-model"],
    ["quality", null],
  ]);
});

it("keeps presets unavailable without eligible provider authentication", () => {
  const available = provider();
  const result = recommendProjectModels(draft(), [
    { ...available, auth: { status: "unauthenticated" } },
  ]);
  expect(result.presets.every((preset) => preset.selected === null)).toBe(true);
  expect(result.draft.yaml).toBe(draft().yaml);
});

it("does not offer chat-only, custom or Claude subscription models", () => {
  const available = provider();
  const result = recommendProjectModels(draft(), [
    { ...available, driver: ProviderDriverKind.make("claudeAgent") },
    { ...available, models: available.models.map((model) => ({ ...model, isCustom: true })) },
    provider(["chat-only"]),
  ]);
  expect(result.presets.every((preset) => preset.selected === null)).toBe(true);
  expect(result.recommendation.anthropicOmitted).toBe(true);
});
