export type CredentialMetadataKind = "api_key" | "oauth" | "missing";

export type ProviderTransportDecision =
	| { kind: "api"; providerId: string }
	| { kind: "official-claude-sdk"; providerId: "anthropic" }
	| { kind: "blocked"; code: "CREDENTIAL_MISSING" | "CLAUDE_CODE_DISABLED"; message: string };

/**
 * Selects transport from non-secret account metadata and explicit project consent.
 * This is a pure decision: it does not resolve credentials or invoke a provider.
 */
export function decideProviderTransport(
	providerId: string,
	credentialKind: CredentialMetadataKind,
	claudeCodeEnabled: boolean,
): ProviderTransportDecision {
	if (providerId !== "anthropic") return { kind: "api", providerId };

	if (credentialKind === "api_key") return { kind: "api", providerId };
	if (credentialKind === "missing" && !claudeCodeEnabled) {
		return {
			kind: "blocked",
			code: "CREDENTIAL_MISSING",
			message: "Anthropic API 키 인증 또는 Claude Code 사용 허용을 확인해 주세요.",
		};
	}
	if (!claudeCodeEnabled) {
		return {
			kind: "blocked",
			code: "CLAUDE_CODE_DISABLED",
			message: "Claude 구독 계정은 Claude Code 사용을 명시적으로 켜야 해요.",
		};
	}
	// CLI authentication is owned by Claude Code, not by the legacy Runtime OAuth store.
	return { kind: "official-claude-sdk", providerId: "anthropic" };
}
