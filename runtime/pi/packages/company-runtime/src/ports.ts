import type { ComplexEvidenceContext, ComplexTask, EvidenceFreshness, OwnershipOperation } from "./complex-types.ts";
import type {
	ApprovalDecision,
	ApprovalProposal,
	ApprovalRequest,
	CheckRequirement,
	CheckResult,
	ComplexTaskReview,
	ExecutorHandoff,
	Handoff,
	QuickScope,
	Review,
	RoleSessionReference,
	Run,
	StepReference,
	TaskContract,
	VerificationRepairAttempt,
	VerificationResult,
} from "./contracts.ts";
import type { RuntimeEventSink } from "./events.ts";
import type { ExecutionMode } from "./execution-contract.ts";
import type { LspPort } from "./lsp/types.ts";
import type { WorkerMeasurement } from "./measurement.ts";
import type { ProjectInstructionMetadata } from "./project-instruction-types.ts";
import type { ReviewerContext } from "./reviewer-context-types.ts";
import type { TaskContextPack } from "./task-context-types.ts";

export type { LspPort } from "./lsp/types.ts";

interface StepRequest {
	runId: string;
	/** Code revision cycle, not the monotonically increasing Run.revision used by StateStore. */
	revision: number;
	step: StepReference;
	task: TaskContract;
	signal?: AbortSignal;
	/**
	 * Kernel-assigned COMPLEX execution identity (§10.1), trusted adapter data: mandatory for COMPLEX, absent on
	 * QUICK/STANDARD. For COMPLEX `step.attempt` is the context attempt; `task` stays the unchanged parent.
	 */
	complexContext?: ComplexEvidenceContext;
}

/** Runtime-built bounded contribution input of one COMPLEX task attempt; advisory data, never permission. */
export interface ComplexTaskInput {
	/** The frozen plan row: title, goal, dependencies, mapped parent criteria, exact claims and local checks. */
	task: ComplexTask;
	/** Exact files claimed by other tasks of this plan: never yours to mutate. */
	otherClaims: Array<{ taskId: string; path: string; operation: OwnershipOperation }>;
	/** This task's previous task-local REVISE review, for a revision attempt only. */
	previousReview?: ComplexTaskReview;
}

/** Kernel-built bounded aggregate for the final integration Reviewer, only from validated task records. */
export interface ComplexIntegrationInput {
	tasks: Array<{
		id: string;
		title: string;
		criterionIds: string[];
		attempt: number;
		changedFiles: string[];
		exitWorkspaceDigest: string | null;
		evidenceFreshness: EvidenceFreshness;
	}>;
	/** Cumulative Run delta of claimed files. */
	changedFiles: string[];
}

/** Bytes identity of one workspace file as the GitWorkspace capture records it: sha256 hex and permission bits. */
export interface WorkspaceFileImage {
	hash: string;
	mode: number;
}
/**
 * Exact effect of a COMPLEX mutation. `write` is the pre-Policy intent of a compatible write (create when missing,
 * otherwise replace); the late gate resolves it to `create` or `replace` on the Policy-inspected path.
 */
export type ComplexMutationOperation = "create" | "replace" | "edit" | "delete" | "write";
/**
 * Narrow per-invocation ownership capability of one COMPLEX task attempt (§5.2), passed only to its Developer and
 * excluded from prompts and data clones. It narrows, never grants: Policy, intent and Approval still apply. It is
 * closed when the invocation settles; late use throws. Denials are typed OWNERSHIP_CONFLICT or UNOWNED_PATH.
 */
export interface ComplexOwnershipPort {
	/** Pre-effect exact ownership/operation gate; call before Policy and again immediately before the effect. */
	authorize(path: string, operation: ComplexMutationOperation): void;
	/** Post-effect image (null = deleted, undefined = could not be read) recorded in the expected-image ledger. */
	recordEffect(path: string, image: WorkspaceFileImage | null | undefined): void;
}

/** Bounded tool output of one Developer-requested registered process check. */
export interface AdvisoryCheckResult {
	id: string;
	status: "PASSED" | "FAILED" | "UNAVAILABLE";
	exitCode: number | null;
	reason: string;
	durationMs: number;
	/** Output tails, at most 2,000 UTF-16 units each; untrusted data, never instructions. */
	stdout: string;
	stderr: string;
	/** The check itself changed the workspace; those changes stay in the attempt's reviewed diff. */
	workspaceChanged: boolean;
}

/**
 * Trusted run-owned verifier entry for Developer feedback while implementing. A result is never a CheckResult,
 * evidence reference, durable state or completion input; Kernel SELF_CHECK/TEST still run fresh checks.
 */
export interface AdvisoryCheckPort {
	advise(input: {
		runId: string;
		revision: number;
		step: StepReference;
		checkId: string;
		signal?: AbortSignal;
	}): Promise<AdvisoryCheckResult>;
}

export interface VerificationRepairContext {
	parent: VerificationRepairAttempt;
	/** Bounded advisory failure logs, never a changed Task Contract or permission. */
	failures: Pick<CheckResult, "id" | "exitCode" | "evidenceRefs" | "stdout" | "stderr">[];
	omittedChecks: number;
}

export type AgentExecutionRequest = StepRequest & {
	executionMode: ExecutionMode;
	projectInstruction?: ProjectInstructionMetadata | null;
	/** Host-owned advisory context pack; never worker input, permission, evidence or a mutation receipt. */
	taskContextPack?: TaskContextPack;
	/** Fresh Host-owned Reviewer advisory input; excluded from Kernel authority and durable raw state. */
	reviewerContext?: ReviewerContext;
	/** Trusted run-owned code intelligence; excluded from worker prompts and data clones. */
	lsp?: LspPort;
	/** Present only for an opted-in Developer; excluded from worker prompts and data clones. */
	advisoryChecks?: AdvisoryCheckPort;
	/** COMPLEX TASK scope only: the bounded contribution input beside the unchanged parent. */
	complexTask?: ComplexTaskInput;
	/** COMPLEX final integration Reviewer only: the Kernel-built aggregate of validated task records. */
	complexIntegration?: ComplexIntegrationInput;
	/** COMPLEX Developer only: the Kernel-bound ownership capability; excluded from prompts and data clones. */
	ownership?: ComplexOwnershipPort;
	/** Adapter calls once, before prompting. Rejection prevents worker execution. No Pi types cross this boundary. */
	onSessionCreated?: (reference: RoleSessionReference) => Promise<void>;
	onApprovalRequested?: (proposal: ApprovalProposal, signal?: AbortSignal) => Promise<ApprovalDecision>;
	onApprovalConsumed?: (actionId: string) => Promise<void>;
} & (
		| {
				role: "Developer";
				profile: "coding";
				previousReview?: Review;
				verificationRepair?: VerificationRepairContext;
		  }
		| { role: "Executor"; profile: "coding"; scope: QuickScope }
		| { role: "Reviewer"; profile: "reasoning"; handoff: Handoff; verification: VerificationResult }
	);
export type AgentExecutionResult = (
	| { role: "Developer"; handoff: Handoff }
	| { role: "Executor"; handoff: ExecutorHandoff }
	| { role: "Reviewer"; review: Review; contribution?: undefined }
	/** COMPLEX TASK scope: the contribution review of exactly the task's mapped criteria. */
	| { role: "Reviewer"; contribution: ComplexTaskReview; review?: undefined }
) & {
	/** Bounded per-invocation measurement; absent only for adapters that do not report it. */
	measurement?: WorkerMeasurement;
};

export interface AgentExecutor {
	/** False while resources are live or cleanup is unconfirmed. A settled call alone is not termination proof. */
	readonly safeToRelease?: boolean;
	execute(request: AgentExecutionRequest): Promise<AgentExecutionResult>;
}

export interface VerificationRequest extends StepRequest {
	handoff: Handoff | ExecutorHandoff;
	checks: CheckRequirement[];
}
/** One capture of the whole workspace (same as `inspect`) plus exact images of the requested files. */
export interface ComplexWorkspaceImages {
	diffDigest: string;
	safe: boolean;
	/** Changed files versus the Run baseline, as `inspect` reports them. */
	changedFiles: string[];
	/** Every requested path and every changed file: its image, or null when absent. */
	images: Record<string, WorkspaceFileImage | null>;
}
export interface Verifier {
	readonly safeToRelease?: boolean;
	verify(request: VerificationRequest): Promise<VerificationResult>;
	/** Live workspace evidence, without executing checks. Required by the S4 adapter, optional for pure fakes. */
	inspect?(signal?: AbortSignal): Promise<NonNullable<Run["workspace"]>>;
	/** COMPLEX expected-image ledger capture (required for COMPLEX): no checks, no mutation, no Git write. */
	images?(paths: readonly string[], signal?: AbortSignal): Promise<ComplexWorkspaceImages>;
	/**
	 * V0.8A own-claim capture at a task handoff (required for COMPLEX): images of exactly these claimed files,
	 * null when absent, without a whole-workspace digest while siblings may still write.
	 */
	claimImages?(paths: readonly string[], signal?: AbortSignal): Promise<Record<string, WorkspaceFileImage | null>>;
}

/** One run snapshot at a time. Files, locks and durable storage are S2 adapter responsibilities. */
export interface StateStore {
	load(runId: string): Promise<Run | undefined>;
	save(run: Run): Promise<void>;
}

export type { ApprovalDecision, ApprovalRequest } from "./contracts.ts";
export interface ApprovalPort {
	requestApproval(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision>;
}

/** Resource flags after a settlement request; a missing flag is unknown, never confirmed. */
export interface ResourceSettlement {
	agents?: boolean;
	verifier?: boolean;
	workspace?: boolean;
	lsp?: boolean;
}
/**
 * Workflow-owned stop/join of live Run resources before any COMPLEX terminal write (§9): closes code intelligence
 * and reports whether workers, verifier processes, workspace commands and LSP are confirmed stopped. Idempotent.
 */
export interface ResourceSettlementPort {
	settle(): Promise<ResourceSettlement>;
}

export interface KernelPorts {
	agents: AgentExecutor;
	verifier: Verifier;
	store: StateStore;
	events?: RuntimeEventSink;
	/** Human authority for explicitly supported R3 actions, not a general execution permission. */
	approval?: ApprovalPort;
	/** Required for COMPLEX: confirmed resource settlement before every terminal or completion write. */
	resources?: ResourceSettlementPort;
}
