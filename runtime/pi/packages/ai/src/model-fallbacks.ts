import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Reviewed fallback for provider data whose live upstream source has disappeared.
 * It is a verbatim copy of the published `@earendil-works/pi-ai` provider data of the version in this
 * repository (see scripts/model-fallbacks/README.md) and is used *only* when the live source is absent.
 */
export const KIMI_CODING_FALLBACK_PROVIDER = "kimi-coding";
export const KIMI_CODING_FALLBACK_API = "anthropic-messages";
export const KIMI_CODING_FALLBACK_BASE_URL = "https://api.kimi.com/coding";
export const KIMI_CODING_FALLBACK_PATH = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"scripts",
	"model-fallbacks",
	"kimi-coding.json",
);

export interface KimiCodingFallbackModel {
	id: string;
	name: string;
	api: string;
	provider: string;
	baseUrl: string;
	reasoning: boolean;
	input: string[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	[k: string]: unknown;
}

export type KimiCodingFallbackResult = { ok: true; models: KimiCodingFallbackModel[] } | { ok: false; reason: string };

function isFiniteNumber(value: unknown): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

/**
 * Validates the reviewed snapshot with the same field expectations the generator applies to live data.
 * Any malformed entry fails closed: a broken fallback never silently produces a partial provider.
 */
export function validateKimiCodingFallback(value: unknown): KimiCodingFallbackResult {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return { ok: false, reason: "fallback must be an api-keyed object" };
	const models: KimiCodingFallbackModel[] = [];
	for (const [api, entries] of Object.entries(value as Record<string, unknown>)) {
		if (api !== KIMI_CODING_FALLBACK_API)
			return { ok: false, reason: `fallback api group ${api} is not ${KIMI_CODING_FALLBACK_API}` };
		if (!entries || typeof entries !== "object" || Array.isArray(entries))
			return { ok: false, reason: `fallback api ${api} must map model ids to models` };
		for (const [modelId, raw] of Object.entries(entries as Record<string, unknown>)) {
			if (!raw || typeof raw !== "object" || Array.isArray(raw))
				return { ok: false, reason: `fallback model ${modelId} is not an object` };
			const model = raw as Record<string, unknown>;
			if (!modelId) return { ok: false, reason: "fallback model id is empty" };
			if (model.id !== modelId) return { ok: false, reason: `fallback model ${modelId} id mismatch` };
			if (model.provider !== KIMI_CODING_FALLBACK_PROVIDER)
				return { ok: false, reason: `fallback model ${modelId} provider mismatch` };
			if (model.api !== api)
				return { ok: false, reason: `fallback model ${modelId} api does not match its api group` };
			if (model.baseUrl !== KIMI_CODING_FALLBACK_BASE_URL)
				return { ok: false, reason: `fallback model ${modelId} baseUrl is not the Kimi coding endpoint` };
			if (typeof model.name !== "string" || !model.name.trim())
				return { ok: false, reason: `fallback model ${modelId} name is empty` };
			if (typeof model.reasoning !== "boolean")
				return { ok: false, reason: `fallback model ${modelId} reasoning is invalid` };
			if (
				!Array.isArray(model.input) ||
				model.input.length === 0 ||
				model.input.some((entry) => entry !== "text" && entry !== "image")
			)
				return { ok: false, reason: `fallback model ${modelId} input modalities are invalid` };
			const cost = model.cost as Record<string, unknown> | undefined;
			if (
				!cost ||
				!isFiniteNumber(cost.input) ||
				!isFiniteNumber(cost.output) ||
				!isFiniteNumber(cost.cacheRead) ||
				!isFiniteNumber(cost.cacheWrite) ||
				cost.input < 0 ||
				cost.output < 0 ||
				cost.cacheRead < 0 ||
				cost.cacheWrite < 0
			)
				return { ok: false, reason: `fallback model ${modelId} cost is invalid` };
			if (!isFiniteNumber(model.contextWindow) || model.contextWindow <= 0)
				return { ok: false, reason: `fallback model ${modelId} contextWindow is invalid` };
			if (!isFiniteNumber(model.maxTokens) || model.maxTokens <= 0)
				return { ok: false, reason: `fallback model ${modelId} maxTokens is invalid` };
			models.push(model as unknown as KimiCodingFallbackModel);
		}
	}
	if (!models.length) return { ok: false, reason: "fallback contains no models" };
	return { ok: true, models };
}

/** Parses and validates fallback text; malformed snapshots fail closed. */
export function parseKimiCodingFallback(source: string): KimiCodingFallbackResult {
	let value: unknown;
	try {
		value = JSON.parse(source);
	} catch {
		return { ok: false, reason: "fallback is not valid JSON" };
	}
	return validateKimiCodingFallback(value);
}

/** Loads the tracked snapshot from disk; a missing or malformed file is reported, never guessed. */
export function loadKimiCodingFallback(path: string = KIMI_CODING_FALLBACK_PATH): KimiCodingFallbackResult {
	try {
		return parseKimiCodingFallback(readFileSync(path, "utf8"));
	} catch (error) {
		return {
			ok: false,
			reason: error instanceof Error ? error.message : "fallback could not be read",
		};
	}
}

/**
 * Missing-provider decision used by the generator: a required provider is missing only when it produced
 * no models at all. Reviewed fallbacks satisfy their own provider; every other provider stays strict.
 */
export function missingHydratedProviders(
	requiredProviderIds: readonly string[],
	availableProviderIds: readonly string[],
): string[] {
	const available = new Set(availableProviderIds);
	return requiredProviderIds.filter((providerId) => !available.has(providerId)).sort();
}

/**
 * Live data always wins. The fallback is consulted only when the live provider source produced no
 * model for `kimi-coding`; no other provider gains tolerance from this exception.
 */
export function shouldUseKimiCodingFallback(liveKimiCodingModelCount: number): boolean {
	return liveKimiCodingModelCount === 0;
}
