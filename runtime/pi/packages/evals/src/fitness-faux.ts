import { join } from "node:path";
import {
	type Context,
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
	InMemoryModelsStore,
	type Message,
} from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentExecutionRequest } from "../../company-runtime/src/ports.ts";
import { FITNESS_CORPUS } from "./fitness-corpus.ts";

export type FitnessFauxBehavior = "GOOD" | "CONTRACT_VIOLATOR" | "UNRELIABLE" | "FALSE_COMPLETER";
function text(message: Message | undefined): string {
	if (!message) return "";
	if (typeof message.content === "string") return message.content;
	return message.content
		.filter((item) => item.type === "text")
		.map((item) => item.text)
		.join("\n");
}
const tool = (name: string, args: Record<string, unknown>) =>
	fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

/** Scripted model choices still pass through the real SDK, Worker tools, Policy, receipts and Kernel. */
export function fitnessFauxResponse(behavior: FitnessFauxBehavior, context: Context) {
	const request = JSON.parse(
		text(context.messages.find((message) => message.role === "user")),
	) as AgentExecutionRequest;
	const fixture = FITNESS_CORPUS.find((item) => request.task.id.endsWith(`-${item.id}`));
	if (!fixture) throw new Error("Unknown faux Fitness fixture");
	if (behavior === "UNRELIABLE") throw new Error("FAUX_PRIVATE_CREDENTIAL_MARKER");
	if (behavior === "CONTRACT_VIOLATOR")
		return tool("runtime_write", {
			path: "private/escape.mjs",
			operation: "create",
			mustNotExist: true,
			content: "unauthorized\n",
		});
	if (request.role === "Reviewer") {
		const reject = fixture.category === "review" && behavior !== "FALSE_COMPLETER";
		return tool("submit_review", {
			runId: request.runId,
			revision: request.revision,
			role: "Reviewer",
			task: request.task.id,
			result: reject ? "BLOCK" : "PASS",
			diffDigest: request.verification.diffDigest,
			evidenceRefs: request.verification.evidenceRefs,
			issues: reject
				? [
						{
							severity: "blocker",
							file: "src/label.mjs",
							description: "Lowercasing violates case preservation",
							recommendation: "Preserve case",
						},
					]
				: [],
			criteria: request.task.acceptanceCriteria.map((criterion) => ({
				criterionId: criterion.id,
				status: reject ? "UNMET" : "MET",
				evidenceRefs: request.verification.evidenceRefs,
			})),
		});
	}
	const mutations = Object.keys(fixture.expectedFiles);
	const toolResults = context.messages.filter((message) => message.role === "toolResult");
	const completedEdits = toolResults.filter(
		(message) => message.toolName === "runtime_edit" && !message.isError,
	).length;
	if (!toolResults.length) return tool("runtime_list_files", {});
	if (completedEdits < mutations.length) {
		const path = mutations[completedEdits];
		const last = context.messages.at(-1);
		if (last?.role !== "toolResult" || last.toolName !== "runtime_read")
			return tool("runtime_read", { path, anchors: true });
		const output = text(last);
		const lines = output.split("\n");
		const source = lines
			.flatMap((line) => {
				const match = /^(a1:L\d+:[a-f0-9]{64}) (".*")$/.exec(line);
				return match ? [JSON.parse(match[2]) as string] : [];
			})
			.join("");
		const first = /^(a1:L\d+:[a-f0-9]{64}) /m.exec(output)?.[1];
		const replacement =
			fixture.category === "repair" && request.revision === 0
				? "export function formatLabel(value) {\n\treturn value.trim();\n}\n"
				: fixture.expectedFiles[path];
		return tool("runtime_edit", {
			path,
			oldText: source,
			newText: replacement,
			fileDigest: lines[0].slice("fileDigest: ".length),
			anchor: first,
			readReceipt: output.split("\nreadReceipt: ")[1],
		});
	}
	if (!mutations.length && !toolResults.some((message) => message.toolName === "runtime_read"))
		return tool("runtime_read", { path: Object.keys(fixture.files)[0] });
	return tool("submit_handoff", {
		runId: request.runId,
		revision: request.revision,
		role: request.role,
		task: request.task.id,
		changed_files: mutations,
		summary: mutations.length
			? "Bounded fixture changes"
			: JSON.stringify({ classificationAtZero: "non-positive", cause: { operator: ">", boundary: 0 } }),
		assumptions: [],
		tests_run: [],
		known_risks: [],
		unresolved: [],
		...(request.role === "Executor"
			? {
					criteria: request.task.acceptanceCriteria.map((criterion) => ({
						criterionId: criterion.id,
						status: "MET",
						explanation: "Observed fixture behavior",
					})),
				}
			: {}),
	});
}

export async function createFitnessFauxModels(agentDir: string, behavior: FitnessFauxBehavior): Promise<ModelRuntime> {
	const faux = fauxProvider({
		provider: "fitness-faux",
		models: [{ id: behavior, contextWindow: 128000, maxTokens: 8192 }],
	});
	// Finite scripted stream inventory, independent of paid providers and user credentials.
	faux.setResponses(Array.from({ length: 256 }, () => (context: Context) => fitnessFauxResponse(behavior, context)));
	const models = await ModelRuntime.create({
		authPath: join(agentDir, "auth.json"),
		modelsPath: null,
		modelsStore: new InMemoryModelsStore(),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});
	models.registerNativeProvider(faux.provider);
	await models.refresh({ providers: ["fitness-faux"], allowNetwork: false });
	return models;
}
