import {
	type AssistantMessage,
	type Context,
	contentText,
	fauxAssistantMessage,
	fauxToolCall,
} from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { BENCHMARK_CORPUS } from "./benchmark-corpus.ts";
import { BENCHMARK_FAUX_PROVIDER, type BenchmarkFauxBehavior } from "./benchmark-record.ts";
import { createFauxModelRuntime, fitnessFauxResponse } from "./fitness-faux.ts";

const WEAVRA_FIXTURES = BENCHMARK_CORPUS.map((entry) => entry.fixture);
// A false completer never edits: the scripted Weavra worker sees no mutations, inspects, and submits a handoff.
const WEAVRA_FIXTURES_WITHOUT_CHANGES = WEAVRA_FIXTURES.map((fixture) => ({ ...fixture, expectedFiles: {} }));
const DONE = "Done: the requested change is complete.";

const tool = (name: string, args: Record<string, unknown>) =>
	fauxAssistantMessage(fauxToolCall(name, args), { stopReason: "toolUse" });

/**
 * Scripted model for both arms. Weavra workers (identified by their structured submission tools) reuse the
 * Fitness faux worker on benchmark fixtures; the pi arm gets write/read calls against Pi's default tools.
 * GOOD applies each fixture's reference change; FALSE_COMPLETER reports completion without doing the work.
 */
export function benchmarkFauxResponse(behavior: BenchmarkFauxBehavior, context: Context): AssistantMessage {
	if (context.tools?.some((item) => item.name === "submit_handoff" || item.name === "submit_review"))
		return fitnessFauxResponse(
			behavior === "GOOD" ? "GOOD" : "FALSE_COMPLETER",
			context,
			behavior === "GOOD" ? WEAVRA_FIXTURES : WEAVRA_FIXTURES_WITHOUT_CHANGES,
		);
	const first = context.messages.find((message) => message.role === "user");
	const prompt = first ? contentText(first.content) : "";
	const entry = BENCHMARK_CORPUS.find((item) => prompt.includes(item.fixture.goal));
	if (!entry) throw new Error("Unknown faux benchmark task");
	if (behavior === "FALSE_COMPLETER") return fauxAssistantMessage(DONE);
	const results = context.messages.filter((message) => message.role === "toolResult");
	const written = results.filter((message) => message.toolName === "write" && !message.isError).length;
	const targets = Object.entries(entry.fixture.expectedFiles);
	if (written < targets.length) {
		const [path, content] = targets[written];
		return tool("write", { path, content });
	}
	if (!targets.length && !results.length) return tool("read", { path: Object.keys(entry.fixture.files)[0] });
	return fauxAssistantMessage(entry.answer ? JSON.stringify(entry.answer) : DONE);
}

export function createBenchmarkFauxModels(
	agentDir: string,
	behavior: BenchmarkFauxBehavior,
	responses: number,
): Promise<ModelRuntime> {
	return createFauxModelRuntime(agentDir, {
		provider: BENCHMARK_FAUX_PROVIDER,
		modelId: behavior,
		respond: (context) => benchmarkFauxResponse(behavior, context),
		responses,
	});
}
