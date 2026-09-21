import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	KIMI_CODING_FALLBACK_PATH,
	loadKimiCodingFallback,
	missingHydratedProviders,
	parseKimiCodingFallback,
	shouldUseKimiCodingFallback,
	validateKimiCodingFallback,
} from "../src/model-fallbacks.ts";

const valid = {
	"anthropic-messages": {
		k3: {
			id: "k3",
			name: "Kimi K3",
			api: "anthropic-messages",
			provider: "kimi-coding",
			baseUrl: "https://api.kimi.com/coding",
			reasoning: true,
			input: ["text", "image"],
			cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 0 },
			contextWindow: 1048576,
			maxTokens: 131072,
		},
	},
};

describe("Kimi coding reviewed fallback", () => {
	it("keeps the tracked snapshot valid and complete", () => {
		const loaded = loadKimiCodingFallback();
		expect(loaded.ok).toBe(true);
		if (!loaded.ok) return;
		expect(loaded.models.map((model) => model.id).sort()).toEqual([
			"k3",
			"k3-256k",
			"kimi-for-coding",
			"kimi-for-coding-highspeed",
		]);
		for (const model of loaded.models) expect(model.provider).toBe("kimi-coding");
		expect(readFileSync(KIMI_CODING_FALLBACK_PATH, "utf8")).not.toMatch(/(?:api[-_]?key|secret|"token")\s*:/i);
	});

	it("uses live data whenever the live source produced a model", () => {
		expect(shouldUseKimiCodingFallback(1)).toBe(false);
		expect(shouldUseKimiCodingFallback(0)).toBe(true);
	});

	it("validates a well-formed snapshot", () => {
		const result = validateKimiCodingFallback(valid);
		expect(result.ok).toBe(true);
	});

	it("fails closed on malformed snapshots", () => {
		const brokenCost = structuredClone(valid);
		brokenCost["anthropic-messages"].k3.cost.input = Number.NaN;
		expect(validateKimiCodingFallback(brokenCost)).toMatchObject({ ok: false });
		const brokenWindow = structuredClone(valid);
		brokenWindow["anthropic-messages"].k3.contextWindow = 0;
		expect(validateKimiCodingFallback(brokenWindow)).toMatchObject({ ok: false });
		const brokenProvider = structuredClone(valid);
		brokenProvider["anthropic-messages"].k3.provider = "someone-else";
		expect(validateKimiCodingFallback(brokenProvider)).toMatchObject({ ok: false });
		expect(validateKimiCodingFallback({})).toMatchObject({ ok: false, reason: "fallback contains no models" });
		expect(parseKimiCodingFallback("not json")).toMatchObject({ ok: false, reason: "fallback is not valid JSON" });
	});

	it("fails closed on every malformed fallback shape", () => {
		const mutations: Array<[string, (value: typeof valid) => void]> = [
			["wrong api group", (value) => Object.assign(value, { "openai-completions": value["anthropic-messages"] })],
			[
				"api group mismatch",
				(value) => {
					value["anthropic-messages"].k3.api = "openai-completions";
				},
			],
			[
				"invalid baseUrl",
				(value) => {
					value["anthropic-messages"].k3.baseUrl = "https://evil.example.com";
				},
			],
			[
				"unknown input modality",
				(value) => {
					value["anthropic-messages"].k3.input = ["text", "audio"];
				},
			],
			[
				"negative cost",
				(value) => {
					value["anthropic-messages"].k3.cost.input = -1;
				},
			],
			[
				"empty name",
				(value) => {
					value["anthropic-messages"].k3.name = "   ";
				},
			],
		];
		for (const [, mutate] of mutations) {
			const candidate = structuredClone(valid);
			mutate(candidate as typeof valid);
			expect(validateKimiCodingFallback(candidate)).toMatchObject({ ok: false });
		}
	});

	it("keeps strict missing-provider failure for providers without a reviewed fallback", () => {
		expect(missingHydratedProviders(["kimi-coding", "other-provider"], ["kimi-coding"])).toEqual(["other-provider"]);
		expect(missingHydratedProviders(["kimi-coding"], ["kimi-coding"])).toEqual([]);
		const missing = missingHydratedProviders(["kimi-coding", "other-provider"], ["kimi-coding"]);
		expect(`Cannot hydrate missing providers: ${missing.join(", ")}`).toBe(
			"Cannot hydrate missing providers: other-provider",
		);
	});

	it("pins the reviewed snapshot hash", () => {
		const digest = createHash("sha256").update(readFileSync(KIMI_CODING_FALLBACK_PATH)).digest("hex");
		expect(readFileSync(`${KIMI_CODING_FALLBACK_PATH.replace("kimi-coding.json", "README.md")}`, "utf8")).toContain(
			digest,
		);
	});
});
