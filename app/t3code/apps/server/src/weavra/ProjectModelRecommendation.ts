import type {
  ServerProvider,
  WeavraProjectSetupOutput,
  WeavraProjectSetupResult,
} from "@t3tools/contracts";
import { parseDocument } from "yaml";

type Draft = Extract<typeof WeavraProjectSetupOutput.Type, { kind: "draft" }>;
type Recommendation = NonNullable<WeavraProjectSetupResult["recommendation"]>;

/**
 * App driver -> Runtime provider id. `claudeAgent` is deliberately absent: the App's Claude chat
 * login must never become a Runtime `anthropic` profile, which would route Runtime work through
 * Claude subscription OAuth. Anthropic stays a manual API-key setup on the Runtime side.
 */
const RUNTIME_PROVIDER_BY_DRIVER: Readonly<Record<string, string>> = { codex: "openai-codex" };
const PRESET_MODELS = {
  speed: ["gpt-5.3-codex-spark", "gpt-5.6-luna"],
  balanced: ["gpt-5.6-sol", "gpt-5.5", "gpt-5.6-terra"],
  quality: ["gpt-6-astra", "gpt-5.6-terra"],
} as const;

/**
 * Prefill from providers the App reports as installed and authenticated, restricted to the models
 * the Runtime catalog knows. Deterministic: candidates are ordered by Runtime provider id, then
 * instance id. Presets express product policy, not measured model performance.
 * A new draft defaults to Balanced, independently of the chat quality default.
 * If no named Balanced model is present, retain the provider's available default.
 * Missing Speed/Quality candidates stay unavailable rather than changing provider or consent.
 * No credential reads and no model calls.
 */
export function recommendProjectModels(draft: Draft, providers: readonly ServerProvider[]) {
  const catalog = draft.modelAvailability?.providers ?? [];
  const candidates: Record<keyof typeof PRESET_MODELS, Recommendation["alternatives"][number][]> = {
    speed: [],
    balanced: [],
    quality: [],
  };
  for (const provider of providers) {
    const runtimeProvider = RUNTIME_PROVIDER_BY_DRIVER[provider.driver];
    if (
      runtimeProvider === undefined ||
      !provider.installed ||
      !provider.enabled ||
      provider.availability === "unavailable" ||
      provider.auth.status !== "authenticated"
    )
      continue;
    const known = catalog.find((entry) => entry.provider === runtimeProvider)?.models ?? [];
    const eligible = provider.models
      .filter((model) => !model.isCustom && known.some((entry) => entry.id === model.slug))
      .sort(
        (a, b) =>
          Number(b.isDefault === true) - Number(a.isDefault === true) ||
          a.slug.localeCompare(b.slug),
      );
    for (const id of ["speed", "balanced", "quality"] as const) {
      const preferred = PRESET_MODELS[id].find((slug) =>
        eligible.some((model) => model.slug === slug),
      );
      const coding =
        eligible.find((model) => model.slug === preferred) ??
        (id === "balanced" ? eligible[0] : undefined);
      if (!coding) continue;
      const reasoning =
        id === "balanced" && preferred === undefined
          ? (eligible.find((model) =>
              known.some((entry) => entry.id === model.slug && entry.reasoning),
            ) ?? coding)
          : coding;
      candidates[id].push({
        instanceId: provider.instanceId,
        displayName: provider.displayName ?? provider.driver,
        provider: runtimeProvider,
        coding: coding.slug,
        reasoning: reasoning.slug,
      });
    }
  }
  const presets = (["speed", "balanced", "quality"] as const).map((id) => {
    candidates[id].sort(
      (a, b) => a.provider.localeCompare(b.provider) || a.instanceId.localeCompare(b.instanceId),
    );
    return { id, selected: candidates[id][0] ?? null, alternatives: candidates[id].slice(1) };
  });
  const [selected = null, ...alternatives] = candidates.balanced;
  const recommendation: Recommendation = {
    selected,
    alternatives,
    anthropicOmitted: providers.some(
      (provider) =>
        provider.driver === "claudeAgent" &&
        provider.installed &&
        provider.auth.status === "authenticated",
    ),
  };
  if (!selected) return { draft, recommendation, presets };
  const document = parseDocument(draft.yaml);
  document.setIn(["models", "profiles", "coding"], {
    provider: selected.provider,
    model: selected.coding,
  });
  document.setIn(["models", "profiles", "reasoning"], {
    provider: selected.provider,
    model: selected.reasoning,
  });
  return { draft: { ...draft, yaml: document.toString() }, recommendation, presets };
}
