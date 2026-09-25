import type { WorkerMeasurement, WorkerUsage } from "./measurement.ts";

const invocationLimit = 1_000;
const tokenLimit = 10_000_000;

/** Config keys are snake_case (repo style); internal limits are camelCase. */
export function budgetLimitsFromConfig(
	budget: { max_worker_invocations?: number; max_reported_tokens?: number } | undefined,
): BudgetLimits | undefined {
	if (!budget) return undefined;
	const limits: BudgetLimits = {
		...(budget.max_worker_invocations !== undefined ? { maxWorkerInvocations: budget.max_worker_invocations } : {}),
		...(budget.max_reported_tokens !== undefined ? { maxReportedTokens: budget.max_reported_tokens } : {}),
	};
	return Object.keys(limits).length ? limits : undefined;
}

export interface BudgetLimits {
	/** Exact pre-invocation limit: a worker session is counted before it starts. */
	maxWorkerInvocations?: number;
	/** Provider-reported-token limit checked before each invocation; not an exact billing cap. */
	maxReportedTokens?: number;
}

export interface BudgetStatus {
	configured: boolean;
	maxWorkerInvocations?: number;
	maxReportedTokens?: number;
	workerInvocations: number;
	/** Provider-reported tokens so far, or null when any recorded usage was unavailable. */
	reportedTokens: number | null;
	exceeded: boolean;
	reason: string | null;
}

/** Trusted Kernel-owned accounting decision; never carries execution authority beyond denying a new invocation. */
export class BudgetDenied extends Error {}

function validateLimit(name: string, value: number | undefined, maximum: number): void {
	if (value === undefined) return;
	if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
		throw new Error(`Invalid budget ${name}: expected an integer from 1 to ${maximum}`);
}

/**
 * Kernel/Workflow-owned budget ledger, deliberately independent of any telemetry exporter:
 * a broken exporter cannot lift the budget, and a denied budget never mutates the workspace.
 */
export class BudgetController {
	private readonly limits: BudgetLimits;
	private invocations = 0;
	private tokens = 0;
	private usageUnknown = false;
	private denial: string | null = null;

	constructor(limits: BudgetLimits) {
		validateLimit("max_worker_invocations", limits.maxWorkerInvocations, invocationLimit);
		validateLimit("max_reported_tokens", limits.maxReportedTokens, tokenLimit);
		this.limits = { ...limits };
	}

	/** Invocations counted at reservation and not yet settled; settling one never counts it twice. */
	private outstanding = 0;

	get configured(): boolean {
		return this.limits.maxWorkerInvocations !== undefined || this.limits.maxReportedTokens !== undefined;
	}

	/** Pre-invocation check. Throws before any model call, workspace mutation or approval request. */
	reserve(role: string): void {
		this.reserveMany(role, 1);
	}

	/**
	 * All-or-nothing pre-invocation check for `count` concurrent invocations of one role (a V0.8A wave, in plan
	 * order): either every invocation is counted or none is, and nothing starts on a denial.
	 */
	reserveMany(role: string, count: number): void {
		if (!Number.isSafeInteger(count) || count < 1) throw new Error("Invalid budget reservation");
		if (this.denial) throw new BudgetDenied(this.denial);
		const maxInvocations = this.limits.maxWorkerInvocations;
		if (maxInvocations !== undefined && this.invocations + count > maxInvocations) {
			this.denial =
				count === 1
					? `Budget exhausted: worker invocation limit ${maxInvocations} reached before ${role}`
					: `Budget exhausted: worker invocation limit ${maxInvocations} cannot cover ${count} concurrent ${role} invocations (${this.invocations} used)`;
			throw new BudgetDenied(this.denial);
		}
		const maxTokens = this.limits.maxReportedTokens;
		if (maxTokens !== undefined) {
			if (this.usageUnknown) {
				this.denial =
					"Budget accounting unavailable: a configured token budget cannot be enforced because previous worker usage was not reported";
				throw new BudgetDenied(this.denial);
			}
			if (this.tokens >= maxTokens) {
				this.denial = `Budget token limit reached: ${this.tokens} provider-reported tokens >= ${maxTokens} before ${role}`;
				throw new BudgetDenied(this.denial);
			}
		}
		// Exact pre-invocation counting: the session is consumed even if the provider never reports usage.
		this.invocations += count;
		this.outstanding += count;
	}

	/** The adapter reported no measurement; token accounting stays honest instead of assuming zero. */
	recordUnavailable(): void {
		this.usageUnknown = true;
		if (this.outstanding > 0) this.outstanding -= 1;
	}

	/** Records the settled invocation. Unavailable usage keeps the ledger honest instead of assuming zero. */
	record(role: string, measurement: WorkerMeasurement): void {
		this.recordUsage(role, measurement.usage);
	}

	/**
	 * Settles one invocation from its provider-reported usage alone, with the same rules as `record`. The V0.8B Host
	 * Planner uses it: planning belongs to no Run, so it has no worker measurement.
	 */
	recordUsage(role: string, usage: Pick<WorkerUsage, "source" | "totalTokens">): void {
		if (this.outstanding > 0) this.outstanding -= 1;
		else this.invocations += 1;
		if (usage.source !== "provider") this.usageUnknown = true;
		this.tokens += usage.totalTokens;
		// Overages after an in-flight call are recorded; the next invocation is denied. Never a billing hard cap.
		const maxTokens = this.limits.maxReportedTokens;
		if (maxTokens !== undefined && this.tokens >= maxTokens && !this.denial)
			this.denial = `Budget token limit reached after ${role}: ${this.tokens} provider-reported tokens >= ${maxTokens}`;
	}

	get status(): BudgetStatus {
		return {
			configured: this.configured,
			...(this.limits.maxWorkerInvocations !== undefined
				? { maxWorkerInvocations: this.limits.maxWorkerInvocations }
				: {}),
			...(this.limits.maxReportedTokens !== undefined ? { maxReportedTokens: this.limits.maxReportedTokens } : {}),
			workerInvocations: this.invocations,
			reportedTokens: this.usageUnknown ? null : this.tokens,
			exceeded: this.denial !== null,
			reason: this.denial,
		};
	}
}
