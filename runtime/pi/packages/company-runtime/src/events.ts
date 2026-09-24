import type { ComplexBinding, ComplexEvidenceContext } from "./complex-types.ts";
import type {
	ApprovalRecord,
	ComplexTaskReview,
	Review,
	RoleSessionReference,
	Run,
	StepReference,
	VerificationRepairAttempt,
} from "./contracts.ts";

interface EventIdentity {
	schemaVersion: 1;
	runId: string;
	taskId: string;
	sequence: number;
	stateRevision: number;
	timestamp: number;
}

/**
 * COMPLEX execution identity on task/step/agent/check/review/Approval events (§10.1): Kernel-assigned, absent on
 * QUICK/STANDARD. Event `taskId` stays the parent ID; only `complexContext.taskId` names a subtask.
 */
interface ExecutionContext {
	complexContext?: ComplexEvidenceContext;
}
/** Frozen-plan binding on Run lifecycle events of a COMPLEX Run only; never a task attempt. */
interface LifecycleBinding {
	complexBinding?: ComplexBinding;
}

/** Observation payloads, not commands or an event-sourced state model. No COMPLEX-only event type exists. */
export type RuntimeEventDetail =
	| ({ type: "RunCreated" | "RunStarted" | "RunCompleted" } & LifecycleBinding)
	| ({ type: "RunFailed" | "RunBlocked" | "RunCancelled" | "RunInterrupted"; reason: string } & LifecycleBinding)
	| ({ type: "StepStarted" | "StepCompleted"; step: StepReference } & ExecutionContext)
	| ({ type: "StepFailed"; step: StepReference; reason: string } & ExecutionContext)
	| ({
			type: "AgentStarted" | "AgentCompleted";
			step: StepReference;
			role: "Developer" | "Reviewer" | "Executor";
			sessionRef?: RoleSessionReference;
	  } & ExecutionContext)
	| ({
			type: "AgentFailed";
			step: StepReference;
			role: "Developer" | "Reviewer" | "Executor";
			reason: string;
			sessionRef?: RoleSessionReference;
	  } & ExecutionContext)
	| ({
			type: "AgentSessionCreated";
			step: StepReference;
			role: "Developer" | "Reviewer" | "Executor";
			profile: "coding" | "reasoning";
			revision: number;
			sessionRef: RoleSessionReference;
	  } & ExecutionContext)
	| ({ type: "ReviewRequested"; step: StepReference } & ExecutionContext)
	| ({
			type: "ReviewPassed" | "ReviewRevisionRequested" | "ReviewBlocked";
			step: StepReference;
			/** A COMPLEX task review is the contribution review (SUPPORTED/UNSUPPORTED/UNVERIFIED). */
			review: Review | ComplexTaskReview;
	  } & ExecutionContext)
	| ({ type: "VerificationStarted"; step: StepReference } & ExecutionContext)
	| ({ type: "VerificationCompleted"; step: StepReference; diffDigest: string; checkIds: string[] } & ExecutionContext)
	| ({ type: "VerificationFailed"; step: StepReference; reason: string } & ExecutionContext)
	| { type: "VerificationRepairScheduled"; parent: VerificationRepairAttempt }
	| ({ type: "ApprovalRequested"; step: StepReference; actionId: string } & ExecutionContext)
	| ({
			type: "ApprovalResolved";
			step: StepReference;
			actionId: string;
			approved: boolean;
			outcome?: ApprovalRecord["status"];
	  } & ExecutionContext)
	| ({ type: "ApprovalConsumed"; step: StepReference; actionId: string } & ExecutionContext);

export type RuntimeEvent = EventIdentity & RuntimeEventDetail;

export interface RuntimeEventSink {
	emit(event: RuntimeEvent): void | Promise<void>;
}

export interface EventDeliveryFailure {
	sequence: number;
	type: RuntimeEvent["type"];
}

type LifecycleDetail = Extract<RuntimeEventDetail, LifecycleBinding & { type: `Run${string}` }>;
function isLifecycle(detail: RuntimeEventDetail): detail is LifecycleDetail {
	return detail.type.startsWith("Run");
}

/** No global bus, replay or delivery retry. A missing sink is a no-op. */
export function createRuntimeEvent(run: Run, sequence: number, detail: RuntimeEventDetail): RuntimeEvent {
	const bound: RuntimeEventDetail =
		run.complex && isLifecycle(detail)
			? {
					...detail,
					complexBinding: {
						parentTaskContractDigest: run.complex.plan.parentTaskContractDigest,
						complexPlanDigest: run.complex.plan.complexPlanDigest,
					},
				}
			: detail;
	return {
		...structuredClone(bound),
		schemaVersion: 1,
		runId: run.runId,
		taskId: run.currentTask,
		sequence,
		stateRevision: run.revision,
		timestamp: run.updatedAt,
	};
}
