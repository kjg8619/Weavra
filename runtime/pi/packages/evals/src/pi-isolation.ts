/**
 * Every evaluated Pi bash command sees the isolated HOME and none of the harness's Pi selection variables.
 * Shared by the vitest-evals Pi harness and the Weavra-vs-Pi benchmark; free of vitest imports.
 */
export function isolatedShellCommandPrefix(home: string): string {
	return `export HOME=${JSON.stringify(home)}; unset PI_CODING_AGENT_DIR PI_EVAL_ARTIFACT_DIR PI_MODEL PI_PROVIDER PI_REASONING_LEVEL PI_SESSION_FILE PI_SESSION_ID;`;
}
