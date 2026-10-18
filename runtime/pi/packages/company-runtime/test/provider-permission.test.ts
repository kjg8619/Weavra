import { describe, expect, it } from "vitest";
import { decideProviderTransport } from "../src/provider-permission.ts";

describe("provider transport permission", () => {
	it("keeps Anthropic API keys on the normal API transport", () => {
		expect(decideProviderTransport("anthropic", "api_key", false)).toEqual({
			kind: "api",
			providerId: "anthropic",
		});
		expect(decideProviderTransport("anthropic", "api_key", true)).toEqual({
			kind: "api",
			providerId: "anthropic",
		});
	});

	it("blocks Anthropic OAuth until Claude Code is explicitly enabled", () => {
		expect(decideProviderTransport("anthropic", "oauth", false)).toMatchObject({
			kind: "blocked",
			code: "CLAUDE_CODE_DISABLED",
		});
	});

	it("selects only the official Claude SDK for enabled Anthropic OAuth", () => {
		expect(decideProviderTransport("anthropic", "oauth", true)).toEqual({
			kind: "official-claude-sdk",
			providerId: "anthropic",
		});
	});

	it("blocks absent Runtime authentication without explicit CLI consent", () => {
		expect(decideProviderTransport("anthropic", "missing", false)).toMatchObject({
			kind: "blocked",
			code: "CREDENTIAL_MISSING",
		});
	});

	it("delegates authentication to the CLI only when explicitly enabled", () => {
		expect(decideProviderTransport("anthropic", "missing", true)).toEqual({
			kind: "official-claude-sdk",
			providerId: "anthropic",
		});
	});

	it("preserves normal API transport for other providers without fallback", () => {
		for (const kind of ["api_key", "oauth", "missing"] as const) {
			for (const enabled of [false, true]) {
				expect(decideProviderTransport("openai", kind, enabled)).toEqual({
					kind: "api",
					providerId: "openai",
				});
			}
		}
	});
});
