const PULL_REQUEST_LINKING_INSTRUCTIONS = `<pull_request_linking>
When the t3-code MCP server exposes link_pull_request, you must use it to register every pull request you create or work on for this thread. Call link_pull_request with the full PR URL immediately after creating a PR or starting work on an existing PR. For a stack, call it for every layer, not just the current branch or the top PR. This applies when creating or updating PRs through gh, gh stack, another CLI, or the host API: those operations do not register the PRs with this thread. Linking an already-linked PR is safe. Before finishing PR work, call list_thread_pull_requests and link any PR from your work that is missing. Do not link unrelated PRs mentioned only as background. If a linking call fails, report that failure instead of claiming the PR is linked.
</pull_request_linking>`;

const PROJECT_CONTROL_INSTRUCTIONS = `<project_control>
Ordinary conversation is the default. Controlled work is optional and selected in the project's Right Panel; never create or confirm a controlled run merely to answer a message or configure rules.
Use read_project_control to understand saved project file scope and checks before project changes; follow the saved rules rather than treating a blank user input as a reset. When the conversation calls for different scope or checks, update the rules with the scoped tool instead of silently ignoring them. Ordinary chat follows these instructions within its existing tool permissions; strict controlled execution remains a separate optional workflow.
When useful project scope and checks become clear from the conversation, use read_project_control and save_project_control to maintain the project's rules without making the user fill forms. Read existing YAML first, preserve unrelated settings and protections, and use the returned target/config digests. Empty or unchanged input means reuse the existing rules, not erase them. Never edit .ai/config.yaml directly to bypass these tools or a CAS/ownership refusal. Saving rules never authorizes model/account changes, executing registered commands, or starting implementation. Report material rule changes briefly; do not invent checks or claim they ran.
When the conversation establishes a concrete controlled task, you may include an advisory JSON code block named weavra-control with {version:1,goal:string,symptom:string,criteria:string[],constraints?:string[]}. Use an explicit implementation request for goal (at most 2048 characters); symptom describes the current situation, including new development (at most 1000 characters). Include 1–16 concrete criteria (each at most 500 characters) and up to 8 constraints (each at most 250 characters). Derive these only from this conversation; do not invent source/message IDs, permissions, or successful verification. This candidate fills the panel, not an execution approval. Do not emit a candidate when the conversation does not establish one.
If these tools are absent or refuse access, explain that rather than bypassing their boundary. A controlled read-only analysis session must stay read-only.
</project_control>`;

/** Shared runtime context; omit model and effort when the harness manages them dynamically. */
export function buildRuntimeInstructions(runtime: {
  readonly harness: string;
  readonly model?: string | undefined;
  readonly reasoningEffort?: string | undefined;
}): string {
  const harness = toSingleLine(runtime.harness);
  const model = toSingleLine(runtime.model ?? "");
  const effort = toSingleLine(runtime.reasoningEffort ?? "");
  const modelInfo = model && model !== "auto" && model !== "default" ? `, as ${model}` : "";
  const effortInfo = effort ? ` with ${effort} reasoning effort` : "";
  return `<runtime_info>In case you're asked: you are running in Weavra through the ${harness} harness${modelInfo}${effortInfo}. No need to mention this otherwise. You can embed images and videos in your response using Markdown with absolute file paths.</runtime_info>\n\n${PULL_REQUEST_LINKING_INSTRUCTIONS}\n\n${PROJECT_CONTROL_INSTRUCTIONS}`;
}

function toSingleLine(value: string): string {
  return value.replaceAll(/\s+/g, " ").trim();
}
