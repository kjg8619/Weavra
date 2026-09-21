import * as crypto from "node:crypto";
import type { AgentSession } from "../../core/agent-session.ts";
import { exportSessionToJsonl } from "../../core/session-export.ts";

/** Local export with presentation metadata; retain the historical wire marker. */
export function exportSessionForShare(filePath: string, session: AgentSession): void {
	exportSessionToJsonl(session.sessionManager, filePath, (parentId, timestamp) => [
		{
			type: "custom",
			customType: "pi.share",
			id: crypto.randomUUID().slice(0, 8),
			parentId,
			timestamp,
			data: {
				systemPrompt: session.state.systemPrompt,
				tools: session.state.tools.map((tool) => ({
					name: tool.name,
					description: tool.description,
					parameters: tool.parameters,
				})),
			},
		},
	]);
}

/** Hosted sharing is unavailable; export stays an explicit, local operation. */
export async function shareSession(context: { showError: (message: string) => void }): Promise<void> {
	context.showError(
		"Hosted sharing is unavailable in Weavra. Use /export session.html or /export session.jsonl to save a local copy.",
	);
}
