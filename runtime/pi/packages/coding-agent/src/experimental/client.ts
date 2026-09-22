import { resolve } from "node:path";
import { BACKGROUND_CONTEXT, type LaneWatchEvent } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ClientCommand } from "../cli/experimental/commands/client.ts";
import { activateBuiltinClientServices, openClientRuntime } from "./client-runtime.ts";
import type { AgentOperationResponse } from "./services/agent-controller.ts";
import type { SessionAddress } from "./services/sessions.ts";

export type ClientResult =
	| {
			readonly kind: "list";
			readonly sessions: readonly SessionAddress[];
	  }
	| { readonly kind: "attached"; readonly serverId: string; readonly sessionId: string }
	| { readonly kind: "prompted"; readonly serverId: string; readonly sessionId: string; readonly text: string };

export interface RunClientOptions {
	/** Directory defaults to WEAVRA_SERVER_DIR, explicit PI_SERVER_DIR compatibility, or <WEAVRA_HOME or ~/.weavra>/server. */
	readonly directory?: string;
	/** Receives snapshot-ordered main-lane events through the prompted operation's terminal event. */
	readonly onEvent?: (event: LaneWatchEvent) => void | Promise<void>;
}

/** Discover servers, then list Sessions, attach to one, or create one for a prompt. */
export async function runClient(command: ClientCommand, options: RunClientOptions = {}): Promise<ClientResult> {
	const runtime = await openClientRuntime(command, { directory: options.directory });
	try {
		const discovered = await Promise.all(runtime.servers.map(activateBuiltinClientServices));
		let sessionId = command.sessionId;
		if (sessionId === undefined && command.prompt === undefined) {
			return {
				kind: "list",
				sessions: discovered
					.flatMap(({ route, directory }) =>
						directory.state.value!.sessions.map(({ sessionId }) => ({ serverId: route.serverId, sessionId })),
					)
					.sort(
						(left, right) =>
							left.serverId.localeCompare(right.serverId) || left.sessionId.localeCompare(right.sessionId),
					),
			};
		}

		let match: (typeof discovered)[number];
		if (sessionId === undefined) {
			if (discovered.length !== 1) {
				throw new Error("Client prompt requires exactly one discovered server to create a Session");
			}
			match = discovered[0]!;
			sessionId = (await match.management.create({}, BACKGROUND_CONTEXT)).sessionId;
		} else {
			const selectedSessionId = sessionId;
			const matches = discovered.filter((candidate) =>
				candidate.directory.state.value!.sessions.some(({ sessionId }) => sessionId === selectedSessionId),
			);
			if (matches.length > 1) {
				throw new Error(`Session ${selectedSessionId} is available from more than one server`);
			}
			const existing = matches[0];
			if (existing) {
				match = existing;
			} else {
				if (command.connect?.transport === "radius" || command.prompt === undefined || discovered.length !== 1) {
					throw new Error(`No discovered server contains session ${selectedSessionId}`);
				}
				match = discovered[0]!;
				await match.management.create({ id: selectedSessionId }, BACKGROUND_CONTEXT);
			}
		}
		await match.plugins.prepareSession(
			{
				sessionId,
				packagePaths: command.pluginPackages?.map((packagePath) => resolve(packagePath)) ?? null,
			},
			BACKGROUND_CONTEXT,
		);
		await match.management.attach(sessionId, BACKGROUND_CONTEXT);
		if (command.prompt === undefined) {
			return { kind: "attached", serverId: match.route.serverId, sessionId };
		}

		const agent = match.agent;
		const completedText = new Map<string, string>();
		const observedRunEnds = new Set<string>();
		let pendingTerminal: { runId: string; resolve(): void; reject(error: unknown): void } | undefined;
		let deliveryTail = Promise.resolve();
		const unsubscribe = match.transcript.state.subscribe((value, _context, delivery) => {
			if (delivery.kind !== "update" || value.event === null) return;
			const event = value.event;
			deliveryTail = deliveryTail.then(async () => {
				if (event.type === "message_end" && event.runId !== undefined && event.message.role === "assistant") {
					completedText.set(event.runId, messageText(event.message));
				}
				await options.onEvent?.(event);
			});
			// Handle callback failures even while the command response is still in flight.
			void deliveryTail.catch((error: unknown) => pendingTerminal?.reject(error));
			if (event.type === "run_end") {
				observedRunEnds.add(event.runId);
				if (pendingTerminal?.runId === event.runId) pendingTerminal.resolve();
			}
		});
		if (match.transcript.state.value?.snapshot === null || match.transcript.state.value?.snapshot === undefined) {
			unsubscribe();
			throw new Error("Transcript has no initialized snapshot");
		}
		let response: AgentOperationResponse;
		try {
			response = await agent.prompt({ message: command.prompt, images: null }, BACKGROUND_CONTEXT);
			// The RPC response and transcript updates have independent delivery queues.
			// Keep observing until this operation's terminal event has joined deliveryTail.
			if (response.accepted && !observedRunEnds.has(response.operationId)) {
				const runId = response.operationId;
				const terminal = new Promise<void>((resolve, reject) => {
					pendingTerminal = { runId, resolve, reject };
				});
				const stopAttachment = match.session.attachment.subscribe((attachment) => {
					if (attachment.status !== "attached" || attachment.sessionId !== sessionId) {
						pendingTerminal?.reject(new Error("Session attachment changed before terminal prompt delivery"));
					}
				});
				try {
					void deliveryTail.catch((error: unknown) => pendingTerminal?.reject(error));
					await terminal;
				} finally {
					pendingTerminal = undefined;
					stopAttachment();
				}
			}
		} finally {
			unsubscribe();
			await deliveryTail;
		}
		if (!response.accepted) throw new Error(response.error.message);
		if (response.error !== null) throw new Error(response.error.message);
		return {
			kind: "prompted",
			serverId: match.route.serverId,
			sessionId,
			text: completedText.get(response.operationId) ?? "",
		};
	} finally {
		await runtime.dispose();
	}
}

function messageText(message: AssistantMessage): string {
	return message.content
		.filter((content) => content.type === "text")
		.map((content) => content.text)
		.join("");
}
