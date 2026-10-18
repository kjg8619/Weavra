import { expect, it, vi } from "vitest";
import { safeProjectModels } from "../src/project-models.ts";

it("reports only prefillable Runtime providers from the static catalog", () => {
	const getModels = vi.fn((provider?: string) =>
		provider === "openai-codex"
			? [
					{ id: "codex-reasoning", reasoning: true },
					{ id: "codex-plain", reasoning: false },
				]
			: [{ id: "claude-subscription", reasoning: true }],
	);
	expect(safeProjectModels({ getModels })).toEqual({
		providers: [
			{
				provider: "openai-codex",
				models: [
					{ id: "codex-reasoning", reasoning: true },
					{ id: "codex-plain", reasoning: false },
				],
			},
		],
	});
	expect(getModels.mock.calls).toEqual([["openai-codex"]]);
});

it("never lists anthropic, so an App Claude login cannot become a Runtime subscription OAuth profile", () => {
	const getModels = vi.fn(() => [{ id: "claude-subscription", reasoning: true }]);
	const result = safeProjectModels({ getModels });
	expect(result.providers.map((entry) => entry.provider)).not.toContain("anthropic");
	expect(getModels).not.toHaveBeenCalledWith("anthropic");
	expect(JSON.stringify(result)).not.toContain("anthropic");
});
