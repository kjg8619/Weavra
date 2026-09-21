import type { Role, StepReference } from "./contracts.ts";
import type { WorkerMeasurement } from "./measurement-types.ts";

export type { WorkerMeasurement, WorkerUsage } from "./measurement-types.ts";

/** Minimal shape the accumulator needs from an assistant message; keeps this module Pi-type free. */
export interface ObservedAssistantMessage {
	timestamp?: number;
	responseId?: string;
	provider?: string;
	model?: string;
	responseModel?: string;
	providerThinkingLevel?: string;
	usage?: {
		input?: number;
		output?: number;
		cacheRead?: number;
		cacheWrite?: number;
		reasoning?: number;
		totalTokens?: number;
	};
	content?: ReadonlyArray<{ type: string; name?: string }>;
}

export interface WorkerIdentity {
	role: Role;
	profile: string;
	revision: number;
	step: StepReference;
	requestedProvider: string;
	requestedModel: string;
}

/**
 * Per-invocation measurement. One accumulator observes every assistant message of exactly one worker session,
 * so parent/child spans and repeated event delivery cannot double count: messages are deduplicated by id.
 */
export class WorkerMeasurementAccumulator {
	private readonly identity: WorkerIdentity;
	private readonly startedAt: number;
	private readonly seen = new Set<string>();
	private turns = 0;
	private readonly toolCalls = new Map<string, number>();
	private input = 0;
	private output = 0;
	private cacheRead = 0;
	private cacheWrite = 0;
	private totalTokens = 0;
	private reasoning: number | undefined;
	private reasoningComplete = true;
	private usageComplete = true;
	private actual: { provider?: string; model?: string; responseModel?: string; thinking?: string } = {};

	/** Summary of the pack actually delivered to this invocation; never rebuilt or enriched here. */
	private readonly contextPack?: WorkerMeasurement["contextPack"];
	private readonly reviewerContext?: WorkerMeasurement["reviewerContext"];

	constructor(
		identity: WorkerIdentity,
		now: () => number = Date.now,
		contextPack?: WorkerMeasurement["contextPack"],
		reviewerContext?: WorkerMeasurement["reviewerContext"],
	) {
		this.contextPack = contextPack;
		this.reviewerContext = reviewerContext ? structuredClone(reviewerContext) : undefined;
		this.identity = structuredClone(identity);
		this.startedAt = now();
	}

	observeAssistant(message: ObservedAssistantMessage): void {
		const key = message.responseId ?? `${message.timestamp ?? "unknown"}:${this.turns}`;
		if (this.seen.has(key)) return;
		this.seen.add(key);
		this.turns += 1;
		this.actual.provider ??= message.provider;
		this.actual.model ??= message.model;
		this.actual.responseModel ??= message.responseModel;
		this.actual.thinking ??= message.providerThinkingLevel;
		for (const part of message.content ?? []) {
			if (part.type !== "toolCall" || !part.name) continue;
			this.toolCalls.set(part.name, (this.toolCalls.get(part.name) ?? 0) + 1);
		}
		const usage = message.usage;
		if (!usage) {
			this.usageComplete = false;
			this.reasoningComplete = false;
			return;
		}
		// SDK adapters initialize an unreported turn with zero usage. A later reported turn
		// must not turn that incomplete invocation into fully known budget accounting.
		if (
			usage.input === undefined ||
			usage.output === undefined ||
			usage.totalTokens === undefined ||
			usage.totalTokens <= 0
		)
			this.usageComplete = false;
		this.input += usage.input ?? 0;
		this.output += usage.output ?? 0;
		this.cacheRead += usage.cacheRead ?? 0;
		this.cacheWrite += usage.cacheWrite ?? 0;
		this.totalTokens += usage.totalTokens ?? 0;
		if (typeof usage.reasoning === "number") {
			this.reasoning = (this.reasoning ?? 0) + usage.reasoning;
		} else {
			this.reasoningComplete = false;
		}
	}

	finish(outcome: WorkerMeasurement["outcome"], now: () => number = Date.now): WorkerMeasurement {
		const finishedAt = now();
		return {
			...structuredClone(this.identity),
			actualProvider: this.actual.provider ?? this.identity.requestedProvider,
			actualModel: this.actual.model ?? this.identity.requestedModel,
			...(this.actual.responseModel ? { responseModel: this.actual.responseModel } : {}),
			...(this.actual.thinking ? { providerThinkingLevel: this.actual.thinking } : {}),
			startedAt: this.startedAt,
			finishedAt,
			durationMs: Math.max(0, finishedAt - this.startedAt),
			modelTurns: this.turns,
			toolCalls: [...this.toolCalls.values()].reduce((sum, count) => sum + count, 0),
			toolCallsByName: Object.fromEntries([...this.toolCalls.entries()].sort(([a], [b]) => a.localeCompare(b))),
			usage: {
				source: this.usageComplete && this.turns > 0 ? "provider" : "unavailable",
				input: this.input,
				output: this.output,
				cacheRead: this.cacheRead,
				cacheWrite: this.cacheWrite,
				totalTokens: this.totalTokens,
				...(this.reasoningComplete && this.reasoning !== undefined ? { reasoning: this.reasoning } : {}),
			},
			outcome,
			// Preserved for SUCCEEDED, FAILED and CANCELLED alike: the pack was delivered either way.
			...(this.contextPack ? { contextPack: this.contextPack } : {}),
			...(this.reviewerContext ? { reviewerContext: this.reviewerContext } : {}),
		};
	}
}

/** Execution failure that still carries the settled measurement, so accounting never loses spent tokens. */
export class WorkerExecutionError extends Error {
	readonly measurement: WorkerMeasurement | undefined;

	constructor(message: string, measurement?: WorkerMeasurement) {
		super(message);
		this.name = "WorkerExecutionError";
		this.measurement = measurement;
	}
}
