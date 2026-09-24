import { awaitApproval, selectR3Scope } from "./approval.ts";
import { validBrowserCheckEvidence } from "./browser-evidence.ts";
import { validateRegisteredBrowserCheck } from "./browser-types.ts";
import { BudgetController, BudgetDenied, type BudgetLimits } from "./budget.ts";
import { capabilityJson } from "./capability-catalog.ts";
import { selectWorkflow } from "./classification.ts";
import { assertComplexPlanBinding, ComplexPlanBindingError } from "./complex-binding.ts";
import {
	type ComplexOwnershipDenied,
	ComplexOwnershipLedger,
	complexOwnershipCapability,
} from "./complex-ownership.ts";
import {
	ACTIVE_TASK_STATUSES,
	complexWave,
	FINISHED_TASK_STATUSES,
	initialComplexState,
	integrationContext,
	markStaleEvidence,
	sameContext,
	settleComplexState,
	taskContext,
	taskReady,
	VERIFYING_TASK_STATUSES,
} from "./complex-state.ts";
import {
	type CheckGate,
	type ComplexEvidenceContext,
	type ComplexFailureCode,
	type ComplexPlan,
	type ComplexRunState,
	type ComplexTaskStatus,
	evidenceNamespace,
	type ReviewGate,
} from "./complex-types.ts";
import {
	type AcceptanceCriterion,
	type ApprovalDecision,
	type ApprovalProposal,
	type ApprovalRecord,
	ApprovalRequestSchema,
	type CheckRequirement,
	CheckRequirementSchema,
	type Classification,
	ClassificationSchema,
	type ComplexEvidenceRecord,
	type ComplexTaskReview,
	ComplexTaskReviewSchema,
	type ExecutorHandoff,
	ExecutorHandoffSchema,
	type Handoff,
	HandoffSchema,
	isTaskContract,
	QUICK_STEP_IDS,
	type QuickScope,
	type Review,
	type ReviewRecord,
	ReviewSchema,
	type Risk,
	type RoleSessionReference,
	RoleSessionReferenceSchema,
	type Run,
	RunSchema,
	STANDARD_STEP_IDS,
	STANDARD_STEP_PHASES,
	type StepId,
	type StepReference,
	type TaskContract,
	TaskContractSchema,
	type VerificationRepairAttempt,
	type VerificationResult,
	VerificationResultSchema,
	validateContract,
	type Workflow,
} from "./contracts.ts";
import {
	acceptanceResultsFromChecks,
	acceptanceResultsFromReview,
	assertCriterionIdentity,
	taskContractDigest,
} from "./criterion-evidence.ts";
import { createRuntimeEvent, type EventDeliveryFailure, type RuntimeEventDetail } from "./events.ts";
import { type ExecutionMode, isExecutionMode } from "./execution-contract.ts";
import { WorkerExecutionError } from "./measurement.ts";
import { type WorkerMeasurement, WorkerMeasurementSchema } from "./measurement-types.ts";
import type {
	AgentExecutionResult,
	ApprovalPort,
	ComplexIntegrationInput,
	ComplexTaskInput,
	ComplexWorkspaceImages,
	KernelPorts,
	WorkspaceFileImage,
} from "./ports.ts";
import type { ProjectInstructionMetadata } from "./project-instruction-types.ts";
import type { Provenance } from "./provenance-types.ts";
import { assertQuickWorkspace, selectQuickScope } from "./quick.ts";

export interface CreateRunRequest {
	executionMode: ExecutionMode;
	projectInstruction?: ProjectInstructionMetadata | null;
	runId: string;
	/** Host-confirmed, frozen Task Contract. Legacy runs are read-only and cannot be created here. */
	task: TaskContract;
	/** Optional bounded budget from the trusted Host config; absent means no configured budget. */
	budget?: BudgetLimits;
	/** Host-captured provenance snapshot; the Kernel only stores it. */
	provenance?: Provenance;
	classification: Classification;
	workflow?: Workflow | "adaptive";
	maxRevisionCycles?: number;
	verificationRepairMode?: "disabled" | "self-check-once";
	checks?: CheckRequirement[];
	approvalTimeoutMs?: number;
	/**
	 * Host-confirmed frozen COMPLEX plan bound to `task` (V0.7B). Present iff the workflow is COMPLEX and executes;
	 * it is revalidated here and never edited. Budget and revision limits come from it.
	 */
	complexPlan?: ComplexPlan;
}

/** Known safety/verification denial: BLOCKED, never FAILED. COMPLEX carries the closed failure code (§10.2). */
class BlockedError extends Error {
	readonly code: ComplexFailureCode | undefined;

	constructor(reason: string, code?: ComplexFailureCode) {
		super(reason);
		this.code = code;
	}
}
/** A malformed worker or verifier result (not schema-valid forged evidence): COMPLEX FAILED/INVALID_RESULT. */
class InvalidResultError extends Error {}

function requireEvidence(condition: boolean, reason: string): void {
	if (!condition) throw new BlockedError(reason);
}
function requireComplex(condition: boolean, reason: string, code: ComplexFailureCode): void {
	if (!condition) throw new BlockedError(reason, code);
}
const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);
/** Exact verifier-owned references of one verification result; worker prose is never a reference source. */
function verificationRefs(result: VerificationResult): Set<string> {
	return new Set([...result.evidenceRefs, ...result.checks.flatMap((check) => check.evidenceRefs)]);
}
/** COMPLEX budget: the frozen plan limits, both mandatory (§6). */
function complexBudgetLimits(plan: ComplexPlan): BudgetLimits {
	return { maxWorkerInvocations: plan.limits.maxWorkerInvocations, maxReportedTokens: plan.limits.maxReportedTokens };
}

function assertIdentity(value: { runId: string; revision: number }, runId: string, revision: number): void {
	requireEvidence(
		value.runId === runId && value.revision === revision,
		"Result belongs to another run or code revision",
	);
}

function assertVerification(
	result: VerificationResult,
	runId: string,
	revision: number,
	checks: CheckRequirement[],
	allowCommandFailures = false,
	evaluatedAt?: number,
): void {
	validateContract(VerificationResultSchema, result);
	assertIdentity(result, runId, revision);
	requireEvidence(result.checks.length === checks.length, "Verification omitted or added checks");
	const ids = new Set<string>();
	for (const check of result.checks) {
		assertIdentity(check, runId, revision);
		requireEvidence(
			check.step
				? check.step.stepId === result.step.stepId && check.step.attempt === result.step.attempt
				: !allowCommandFailures,
			"Check step metadata is stale",
		);
		const expected = checks.find((item) => item.id === check.id);
		requireEvidence(
			!ids.has(check.id) && expected !== undefined,
			"Verification contains duplicate or unknown checks",
		);
		ids.add(check.id);
		requireEvidence(
			expected?.kind === check.kind && expected.required === check.required,
			"Verification changed the check contract",
		);
		requireEvidence(check.diffDigest === result.diffDigest, "Verification evidence is stale");
		if (check.kind === "browser") {
			requireEvidence(
				expected?.browser !== undefined &&
					expected.browser.checkId === check.id &&
					expected.trustRequired === true &&
					!!expected.trustRegistrationDigest &&
					expected.sandboxRequired !== true &&
					!expected.sandboxPolicyDigest &&
					!expected.repairableExitCodes?.length &&
					check.exitCode === null &&
					check.failureKind === undefined &&
					check.sandbox === undefined,
				"Browser checks require frozen typed registration and cannot be command or repair evidence",
			);
		} else
			requireEvidence(
				expected?.browser === undefined && check.browser === undefined,
				"Command checks cannot contain browser evidence",
			);
		const repairFailure =
			allowCommandFailures &&
			check.kind !== "browser" &&
			check.status === "FAIL" &&
			check.failureKind === "COMMAND_NONZERO" &&
			check.exitCode !== null &&
			expected?.repairableExitCodes?.includes(check.exitCode) === true &&
			check.evidenceRefs.length > 0;
		requireEvidence(check.status !== "FAIL" || repairFailure, "A verification check failed");
		if (allowCommandFailures)
			requireEvidence(
				!!expected?.trustRegistrationDigest &&
					check.trust?.registrationDigest === expected.trustRegistrationDigest &&
					(check.trust.status === "VERIFIED" || check.trust.status === "UNVERIFIED"),
				"Repair requires the original fresh verifier registration",
			);
		// Independent Host guard: a strict verifier-trust requirement is never satisfied by exit 0 alone.
		if (expected?.trustRequired === true && (check.required || allowCommandFailures || check.kind === "browser")) {
			const trust = check.trust;
			requireEvidence(
				(check.status === "PASS" || repairFailure) && trust?.mode === "strict" && trust.status === "VERIFIED",
				"A required check is not verifier-trust verified",
			);
			// The VERIFIED flag alone is not authority: the digest must match the Host-frozen registration.
			requireEvidence(
				!!expected.trustRegistrationDigest && trust?.registrationDigest === expected.trustRegistrationDigest,
				"A required check does not match the frozen verifier registration",
			);
		}
		if (expected?.sandboxRequired === true && (check.required || allowCommandFailures)) {
			const sandbox = check.sandbox;
			requireEvidence(
				sandbox?.mode === "required" && sandbox.status === "ENFORCED",
				"A required check is not sandbox enforced",
			);
			// ENFORCED alone is not authority: the policy digest must match the Host-frozen sandbox policy.
			requireEvidence(
				!!expected.sandboxPolicyDigest && sandbox?.policyDigest === expected.sandboxPolicyDigest,
				"A required check does not match the frozen verifier sandbox policy",
			);
		}
		requireEvidence(
			!check.required || check.status === "PASS" || repairFailure,
			"A required verification check was not performed",
		);
		if (check.status === "PASS") {
			if (check.kind === "browser")
				requireEvidence(
					validBrowserCheckEvidence(check, expected?.browser, evaluatedAt),
					"Browser PASS requires fresh independently captured evidence bound to the frozen check",
				);
			else
				requireEvidence(
					check.exitCode === 0 && check.evidenceRefs.length > 0,
					"PASS requires exit code zero and evidence",
				);
		} else if (!repairFailure) {
			requireEvidence(check.exitCode === null, "Unexecuted checks cannot have an exit code");
		}
	}
}

function assertReview(review: Review, task: TaskContract, verification: VerificationResult): void {
	validateContract(ReviewSchema, review);
	assertIdentity(review, verification.runId, verification.revision);
	requireEvidence(
		review.task === task.id && review.diffDigest === verification.diffDigest,
		"Review target or diff is stale",
	);
	const evidence = new Set([
		...verification.evidenceRefs,
		...verification.checks.flatMap((check) => check.evidenceRefs),
	]);
	requireEvidence(
		review.evidenceRefs.length > 0 && review.evidenceRefs.every((ref) => evidence.has(ref)),
		"Review references unknown or missing evidence",
	);
	assertCriterionCoverage(review.criteria, task.acceptanceCriteria, "Review");
	for (const item of review.criteria) {
		requireEvidence(
			item.evidenceRefs.every((ref) => evidence.has(ref)),
			"Criterion references unknown evidence",
		);
		if (review.result === "PASS")
			requireEvidence(
				item.status === "MET" && item.evidenceRefs.length > 0,
				"PASS requires evidence for every acceptance criterion",
			);
	}
	if (review.result === "PASS")
		requireEvidence(!review.issues.some((issue) => issue.severity === "blocker"), "PASS contains a blocking issue");
}

/** Exact frozen-criteria coverage: every criterion exactly once, no unknown or duplicate IDs. */
function assertCriterionCoverage(
	items: ReadonlyArray<{ criterionId: string; status: string }>,
	criteria: readonly AcceptanceCriterion[],
	source: string,
): void {
	const expected = new Set(criteria.map((criterion) => criterion.id));
	const seen = new Set<string>();
	for (const item of items) {
		requireEvidence(expected.has(item.criterionId), `${source} reported an unknown acceptance criterion`);
		requireEvidence(!seen.has(item.criterionId), `${source} reported a duplicate acceptance criterion`);
		seen.add(item.criterionId);
	}
	requireEvidence(seen.size === criteria.length, `${source} omitted an acceptance criterion`);
}

/** Every criterion's mapped checks must have passing, current verification evidence. */
function assertCriterionChecks(
	criteria: readonly AcceptanceCriterion[],
	selfCheck: VerificationResult,
	finalCheck: VerificationResult,
): void {
	for (const criterion of criteria) {
		for (const checkId of criterion.verification.checkIds) {
			const inSelf = selfCheck.checks.find((check) => check.id === checkId);
			const inFinal = finalCheck.checks.find((check) => check.id === checkId);
			requireEvidence(
				inSelf?.status === "PASS" && inSelf.evidenceRefs.length > 0 && inFinal?.status === "PASS",
				`Acceptance criterion ${criterion.id} lacks passing check evidence`,
			);
		}
	}
}

/** Working copy of the durable COMPLEX fields; every COMPLEX save writes all of them together. */
interface ComplexWork {
	complex: ComplexRunState;
	evidence: ComplexEvidenceRecord[];
	reviews: ComplexTaskReview[];
	measurements: WorkerMeasurement[];
}

type GateTarget = "selfCheck" | "review" | "test" | "check";

/** One wave row's Developer invocation (V0.8A §4 rule 3); its failure is recorded, never thrown past the join. */
interface WaveMember {
	c: ComplexAdvance;
	/** A first attempt (ELIGIBLE → IMPLEMENTING); false for a REVISE re-implementation. */
	first: boolean;
	measurement?: WorkerMeasurement;
	handedOff?: boolean;
	error?: unknown;
	/** The wave was already aborted (a sibling failure or a cancel) when this row failed. */
	afterAbort?: boolean;
}

/** Image equality in the GitWorkspace encoding; absence equals only absence. */
function sameFileImage(left: WorkspaceFileImage | null | undefined, right: WorkspaceFileImage | null): boolean {
	if (left === undefined) return false;
	if (left === null || right === null) return left === right;
	return left.hash === right.hash && left.mode === right.mode;
}

/** Per-advance COMPLEX invocation state: callbacks close with the invocation; late use is rejected. */
interface ComplexAdvance {
	step: StepReference;
	signal?: AbortSignal;
	context: ComplexEvidenceContext;
	/** Plan index of this invocation's task (a wave row or the row in its turn); -1 during integration. */
	taskIndex: number;
	role?: "Developer" | "Reviewer";
	sessionRef?: RoleSessionReference;
	sessionOpen: boolean;
	sessionRejected: boolean;
	approvalOpen: boolean;
	approvalInFlight: boolean;
	approvalFailure?: ApprovalRecord["status"];
	reserved: boolean;
	settled: boolean;
	started: boolean;
	gateTarget?: GateTarget;
	/** Verdict of the current gate when known (FAIL, STALE, REVISE, BLOCK); otherwise RUNNING settles UNAVAILABLE. */
	gate?: CheckGate | ReviewGate;
	/** Review events to publish when a valid verdict blocks the Run, instead of failure events. */
	verdictEvents?: RuntimeEventDetail[];
	ownershipDenial?: ComplexOwnershipDenied;
	evidenceIndex?: number;
	closeOwnership?: () => void;
}

export interface CompletionEvidence {
	executionMode: ExecutionMode;
	runId: string;
	revision: number;
	task: TaskContract;
	taskContractDigest?: string;
	checks: CheckRequirement[];
	handoff?: Handoff | ExecutorHandoff;
	workflow?: Workflow;
	risk?: Risk;
	r3Scope?: Run["r3Scope"];
	approvals?: Run["approvals"];
	developerSession?: RoleSessionReference;
	reviewerSession?: RoleSessionReference;
	quickScope?: QuickScope;
	executorDigest?: string;
	workspace?: Run["workspace"];
	review?: Review;
	selfCheck?: VerificationResult;
	finalCheck?: VerificationResult;
}

/** Independent guard: a phase label, natural-language success or schema-valid PASS is not sufficient. */
export function assertCanComplete(evidence: CompletionEvidence, evaluatedAt = Date.now()): void {
	const { runId, revision, task, checks, handoff, review, selfCheck, finalCheck } = evidence;
	requireEvidence(isExecutionMode(evidence.executionMode), "Completion requires an explicit execution contract");
	if (evidence.executionMode === "READ_ONLY")
		requireEvidence(
			evidence.workspace?.safe === true &&
				evidence.workspace.changedFiles.length === 0 &&
				selfCheck?.changedFiles?.length === 0 &&
				finalCheck?.changedFiles?.length === 0 &&
				handoff?.changed_files.length === 0,
			"READ_ONLY completion requires unchanged workspace evidence and no reported mutations",
		);
	if (evidence.risk === "R3") {
		const approval = evidence.approvals?.[0];
		requireEvidence(
			evidence.workflow === "STANDARD" &&
				revision === 0 &&
				!!evidence.r3Scope &&
				evidence.r3Scope.runId === runId &&
				evidence.approvals?.length === 1 &&
				approval?.status === "CONSUMED" &&
				approval.request.runId === runId &&
				approval.request.path === evidence.r3Scope.targetPath &&
				approval.request.operation === "delete-file" &&
				approval.request.revision === revision &&
				approval.request.step.stepId === "implement" &&
				approval.request.step.attempt === revision + 1 &&
				JSON.stringify(evidence.workspace?.changedFiles) === JSON.stringify([evidence.r3Scope.targetPath]) &&
				JSON.stringify(handoff?.changed_files) === JSON.stringify([evidence.r3Scope.targetPath]),
			"R3 completion requires consumed one-file approval and actual scoped deletion evidence",
		);
	}
	if (evidence.risk === "R2" || evidence.risk === "R3") {
		requireEvidence(evidence.workflow === "STANDARD", "R2 requires STANDARD independent review");
		const developer = evidence.developerSession;
		const reviewer = evidence.reviewerSession;
		if (!developer || !reviewer)
			throw new BlockedError("R2 requires current Developer and independent Reviewer sessions");
		validateContract(RoleSessionReferenceSchema, developer);
		validateContract(RoleSessionReferenceSchema, reviewer);
		requireEvidence(
			developer.role === "Developer" &&
				reviewer.role === "Reviewer" &&
				developer.sessionId !== reviewer.sessionId &&
				developer.sessionFile !== reviewer.sessionFile,
			"R2 requires different implementation/review sessions",
		);
		requireEvidence(
			checks.some((check) => check.required) &&
				evidence.workspace?.safe === true &&
				evidence.workspace.diffDigest === finalCheck?.diffDigest,
			"R2 requires required checks and live workspace evidence",
		);
	}
	const quick = evidence.workflow === "QUICK";
	if (!handoff || (!quick && !review) || !selfCheck || !finalCheck)
		throw new BlockedError("Completion requires handoff, required review and both verification stages");
	if (quick) validateContract(ExecutorHandoffSchema, handoff);
	else validateContract(HandoffSchema, handoff);
	assertIdentity(handoff, runId, revision);
	requireEvidence(
		handoff.task === task.id && handoff.unresolved.length === 0,
		"Handoff has the wrong task or unresolved work",
	);
	assertVerification(selfCheck, runId, revision, checks);
	assertVerification(finalCheck, runId, revision, checks, false, evaluatedAt);
	for (const check of checks.filter((check) => check.kind === "browser")) {
		const first = selfCheck.checks.find((result) => result.id === check.id)?.browser;
		const final = finalCheck.checks.find((result) => result.id === check.id)?.browser;
		requireEvidence(
			first !== undefined &&
				final !== undefined &&
				first.captureId !== final.captureId &&
				final.capturedAt >= first.capturedAt,
			"Final browser verification cannot reuse SELF_CHECK capture",
		);
	}
	requireEvidence(
		selfCheck.step.stepId === "self-check" &&
			finalCheck.step.stepId === "test" &&
			selfCheck.step.attempt === revision + 1 &&
			finalCheck.step.attempt === revision + 1,
		"Completion verification belongs to another step attempt",
	);
	requireEvidence(
		evidence.taskContractDigest === taskContractDigest(task),
		"Task Contract changed after confirmation; completion refused",
	);
	if (quick) {
		requireEvidence(
			revision === 0 && checks.some((check) => check.required) && !review,
			"QUICK requires required checks and no review/revision reuse",
		);
		if (!evidence.quickScope || !evidence.workspace || handoff.role !== "Executor")
			throw new BlockedError("QUICK completion requires trusted scope and live workspace evidence");
		try {
			assertQuickWorkspace(evidence.quickScope, evidence.workspace);
		} catch (error) {
			throw new BlockedError(error instanceof Error ? error.message : "Invalid QUICK scope");
		}
		requireEvidence(
			evidence.executorDigest === selfCheck.diffDigest &&
				selfCheck.diffDigest === finalCheck.diffDigest &&
				finalCheck.diffDigest === evidence.workspace.diffDigest,
			"QUICK digest changed after SELF_CHECK; verification is stale",
		);
		const executorHandoff = validateContract(ExecutorHandoffSchema, handoff);
		requireEvidence(
			task.acceptanceCriteria.every((criterion) => !criterion.verification.reviewRequired),
			"QUICK cannot complete review-required acceptance criteria; select STANDARD",
		);
		assertCriterionCoverage(executorHandoff.criteria, task.acceptanceCriteria, "Executor");
		assertCriterionChecks(task.acceptanceCriteria, selfCheck, finalCheck);
		requireEvidence(
			// Read-only findings do not imply unfinished work; mutations still require risk resolution.
			(evidence.quickScope.risk === "R0" || handoff.known_risks.length === 0) &&
				executorHandoff.criteria.every((item) => item.status === "MET"),
			"QUICK acceptance criteria incomplete or risks unresolved; STANDARD required",
		);
		requireEvidence(
			new Set(handoff.changed_files).size === handoff.changed_files.length &&
				JSON.stringify([...handoff.changed_files].sort()) ===
					JSON.stringify([...evidence.workspace.changedFiles].sort()),
			"Executor result does not match actual changed files",
		);
		return;
	}
	if (!review) throw new BlockedError("Independent review missing");
	assertReview(review, task, selfCheck);
	requireEvidence(review.result === "PASS", "Completion requires an independent Reviewer PASS");
	requireEvidence(
		review.criteria.every((item) => item.status === "MET"),
		"Review PASS requires every acceptance criterion MET",
	);
	assertCriterionChecks(task.acceptanceCriteria, selfCheck, finalCheck);
	requireEvidence(
		review.diffDigest === finalCheck.diffDigest,
		"Final verification changed the reviewed diff; another review is required",
	);
}

export interface ComplexCompletionEvidence {
	/** Durable Run state immediately before the completion write, including the working COMPLEX fields. */
	run: Run;
	plan: ComplexPlan;
	checks: CheckRequirement[];
	integrationCheck?: VerificationResult;
	finalReview?: Review;
	finalTest?: VerificationResult;
	/** Live COMPLETING capture and the expected-image ledger's reconciled workspace digest. */
	liveDigest: string;
	liveChangedFiles: readonly string[];
	ledgerDigest: string;
	resourcesConfirmed: boolean;
}

/**
 * Independent COMPLEX completion guard (§8.2). All tasks COMPLETED is never sufficient: every task needs its bound
 * local-success history, the integration set must be fresh, complete and one combined workspace, every parent AC
 * MET with registered evidence, no Approval unresolved, known budget within caps and confirmed resource cleanup.
 */
export function assertCanCompleteComplex(evidence: ComplexCompletionEvidence, evaluatedAt = Date.now()): void {
	const { run, plan, checks, integrationCheck, finalReview, finalTest } = evidence;
	const state = run.complex;
	const parent = run.tasks[0];
	if (!state || run.workflow !== "COMPLEX" || !parent || !isTaskContract(parent) || run.tasks.length !== 1)
		throw new BlockedError("COMPLEX completion requires the COMPLEX state and its single parent", "PLAN_MISMATCH");
	requireComplex(capabilityJson(state.plan) === capabilityJson(plan), "The frozen plan changed", "PLAN_MISMATCH");
	try {
		assertComplexPlanBinding(plan, parent, { registeredCheckIds: checks.map((check) => check.id) });
	} catch (error) {
		if (error instanceof ComplexPlanBindingError) throw new BlockedError(error.message, error.code);
		throw error;
	}
	requireComplex(
		run.taskContractDigest === plan.parentTaskContractDigest && run.taskContractDigest === taskContractDigest(parent),
		"Task Contract changed after confirmation; completion refused",
		"PARENT_MISMATCH",
	);
	requireComplex(evidence.resourcesConfirmed, "Completion requires confirmed resource cleanup", "CLEANUP_UNCONFIRMED");
	const sessions = run.roleSessionRefs;
	requireComplex(
		new Set(sessions.map((ref) => ref.sessionId)).size === sessions.length &&
			new Set(sessions.map((ref) => ref.sessionFile)).size === sessions.length,
		"Every COMPLEX worker session must be independent",
		"REVIEW_MISSING",
	);
	for (const [index, task] of plan.tasks.entries()) {
		const row = state.tasks[index];
		requireComplex(
			row?.id === task.id &&
				row.status === "COMPLETED" &&
				row.selfCheck === "PASS" &&
				row.review === "PASS" &&
				row.test === "PASS" &&
				row.attempt >= 1 &&
				row.exitWorkspaceDigest !== null &&
				row.failureCode === null,
			`${task.id} lacks validated local success`,
			"DEPENDENCY_NOT_COMPLETED",
		);
		const context = taskContext(plan, task.id, row.attempt);
		const record = run.complexEvidence?.find((item) => sameContext(item.complexContext, context));
		requireComplex(
			!!record &&
				record.handoff &&
				record.review &&
				record.failureCode === null &&
				record.exitWorkspaceDigest === row.exitWorkspaceDigest &&
				record.sessionRefs.some((ref) => ref.role === "Developer") &&
				record.sessionRefs.some((ref) => ref.role === "Reviewer") &&
				record.sessionRefs.every((ref) => sameContext(ref.complexContext, context)),
			`${task.id} lacks its bound success record with independent sessions`,
			"REVIEW_MISSING",
		);
		const review = run.complexReviews?.find(
			(item) => sameContext(item.complexContext, context) && item.result === "PASS",
		);
		requireComplex(
			!!review &&
				review.diffDigest === row.exitWorkspaceDigest &&
				capabilityJson(review.criteria.map((item) => item.criterionId)) === capabilityJson(task.criterionIds) &&
				review.criteria.every((item) => item.status === "SUPPORTED" && item.evidenceRefs.length > 0),
			`${task.id} lacks its contribution review PASS`,
			"REVIEW_MISSING",
		);
		for (const stepId of ["self-check", "test"] as const)
			for (const id of task.checkIds)
				requireComplex(
					run.verification.some(
						(check) =>
							check.id === id &&
							check.status === "PASS" &&
							sameContext(check.complexContext, context) &&
							check.step?.stepId === stepId &&
							check.step.attempt === row.attempt &&
							check.diffDigest === row.exitWorkspaceDigest,
					),
					`${task.id} lacks bound ${stepId} evidence for ${id}`,
					"CHECK_FAILED",
				);
	}
	const integration = state.integration;
	requireComplex(
		integration.check === "PASS" &&
			integration.review === "PASS" &&
			integration.test === "PASS" &&
			integration.failureCode === null,
		"Integration gates are incomplete",
		"CHECK_FAILED",
	);
	if (!integrationCheck || !finalReview || !finalTest)
		throw new BlockedError(
			"Completion requires fresh integration checks, a final review and final checks",
			"REVIEW_MISSING",
		);
	const context = integrationContext(plan);
	requireComplex(
		sameContext(integrationCheck.complexContext, context) &&
			sameContext(finalTest.complexContext, context) &&
			sameContext(finalReview.complexContext, context) &&
			integrationCheck.step.stepId === "self-check" &&
			integrationCheck.step.attempt === 1 &&
			finalTest.step.stepId === "test" &&
			finalTest.step.attempt === 1,
		"Integration evidence belongs to another context or stage",
		"STALE_EVIDENCE",
	);
	requireComplex(
		integrationCheck.diffDigest === finalReview.diffDigest &&
			finalReview.diffDigest === finalTest.diffDigest &&
			finalTest.diffDigest === evidence.liveDigest &&
			evidence.liveDigest === evidence.ledgerDigest &&
			integration.workspaceDigest === integrationCheck.diffDigest &&
			integration.evidenceFreshness === "CURRENT",
		"Integration evidence is not one fresh combined workspace equal to the live capture and ledger",
		"STALE_EVIDENCE",
	);
	const integrationRecord = run.complexEvidence?.find((item) => sameContext(item.complexContext, context));
	requireComplex(
		!!integrationRecord &&
			integrationRecord.review &&
			integrationRecord.sessionRefs.some(
				(ref) => ref.role === "Reviewer" && sameContext(ref.complexContext, context),
			),
		"The final review lacks its independent Reviewer session",
		"REVIEW_MISSING",
	);
	try {
		assertVerification(integrationCheck, run.runId, run.revisionCycle, checks);
		assertVerification(finalTest, run.runId, run.revisionCycle, checks, false, evaluatedAt);
		assertCriterionChecks(parent.acceptanceCriteria, integrationCheck, finalTest);
	} catch (error) {
		throw new BlockedError(errorText(error, "Integration verification failed"), "CHECK_FAILED");
	}
	for (const check of checks.filter((item) => item.kind === "browser")) {
		const first = integrationCheck.checks.find((result) => result.id === check.id)?.browser;
		const final = finalTest.checks.find((result) => result.id === check.id)?.browser;
		requireComplex(
			first !== undefined &&
				final !== undefined &&
				first.captureId !== final.captureId &&
				final.capturedAt >= first.capturedAt,
			"Final browser verification cannot reuse the integration capture",
			"STALE_EVIDENCE",
		);
	}
	const refs = verificationRefs(integrationCheck);
	requireComplex(
		finalReview.result === "PASS" &&
			finalReview.runId === run.runId &&
			finalReview.revision === run.revisionCycle &&
			finalReview.task === parent.id &&
			!finalReview.issues.some((issue) => issue.severity === "blocker") &&
			finalReview.evidenceRefs.length > 0 &&
			finalReview.evidenceRefs.every((ref) => refs.has(ref)) &&
			capabilityJson(finalReview.criteria.map((item) => item.criterionId)) ===
				capabilityJson(parent.acceptanceCriteria.map((criterion) => criterion.id)) &&
			finalReview.criteria.every(
				(item) =>
					item.status === "MET" && item.evidenceRefs.length > 0 && item.evidenceRefs.every((ref) => refs.has(ref)),
			),
		"Every parent criterion must be MET with registered integration evidence in an independent final PASS",
		"REVIEW_BLOCKED",
	);
	const approvals = run.approvals ?? [];
	requireComplex(
		!approvals.some((record) => record.status === "PENDING" || record.status === "APPROVED"),
		"An Approval is still unresolved",
		"APPROVAL_INVALID",
	);
	if (run.risk === "R3")
		requireComplex(
			approvals.length === 1 &&
				approvals[0].status === "CONSUMED" &&
				run.revisionCycle === 0 &&
				!!run.r3Scope &&
				run.r3Scope.runId === run.runId &&
				approvals[0].request.path === run.r3Scope.targetPath &&
				approvals[0].request.complexContext?.taskId === plan.tasks[0].id &&
				capabilityJson([...evidence.liveChangedFiles]) === capabilityJson([run.r3Scope.targetPath]),
			"R3 completion requires the one consumed task deletion and exactly its actual effect",
			"APPROVAL_INVALID",
		);
	else requireComplex(approvals.length === 0, "Only an R3 Run carries an Approval", "APPROVAL_INVALID");
	if (run.executionMode === "READ_ONLY")
		requireComplex(
			evidence.liveChangedFiles.length === 0,
			"READ_ONLY completion requires an unchanged workspace",
			"EXTERNAL_MUTATION",
		);
	const budget = run.budget;
	if (!budget || budget.reportedTokens === null)
		throw new BlockedError("Provider usage is unknown; COMPLEX completion needs known accounting", "BUDGET_UNKNOWN");
	requireComplex(
		budget.reportedTokens < plan.limits.maxReportedTokens &&
			budget.workerInvocations <= plan.limits.maxWorkerInvocations &&
			!budget.exceeded,
		"Budget exhausted before completion",
		"BUDGET_EXHAUSTED",
	);
	requireComplex(
		budget.workerInvocations === state.tasks.reduce((total, row) => total + row.workerInvocations, 0) + 1,
		"Task subtotals plus the final Reviewer must equal the one global ledger",
		"BUDGET_UNKNOWN",
	);
}

/** Sequential, host-independent control logic. No filesystem, Pi SDK, provider or UI calls. */
export class CompanyKernel {
	private state: Run;
	private readonly ports: KernelPorts;
	private readonly now: () => number;
	private readonly checks: CheckRequirement[];
	private readonly maxRevisionCycles: number;
	private readonly approvalTimeoutMs: number;
	private readonly budget: BudgetController;
	private busy = false;
	private storageFailed = false;
	private saveQueue: Promise<void> = Promise.resolve();
	private handoff?: Handoff | ExecutorHandoff;
	private developerSession?: RoleSessionReference;
	private reviewerSession?: RoleSessionReference;
	private review?: Review;
	private selfCheck?: VerificationResult;
	private finalCheck?: VerificationResult;
	private readonly eventFailures: EventDeliveryFailure[] = [];
	// COMPLEX (V0.7B): frozen plan, working copy of the durable COMPLEX fields, the Kernel-owned expected-image
	// ledger and the current task/integration evidence. None of it is a permission token.
	private readonly plan?: ComplexPlan;
	private work?: ComplexWork;
	private ledger?: ComplexOwnershipLedger;
	/** Ledger snapshot at each task's first IMPLEMENTING (its task-local delta base). */
	private readonly taskEntries = new Map<string, ReturnType<ComplexOwnershipLedger["snapshot"]>>();
	/** Ledger snapshot at the start of each task's current attempt. */
	private readonly attemptEntries = new Map<string, ReturnType<ComplexOwnershipLedger["snapshot"]>>();
	/** Validated handoffs of COMPLETED tasks, for the integration aggregate. */
	private readonly taskHandoffs = new Map<string, Handoff>();
	/** Current-attempt handoff and own-claim images of every HANDED_OFF or verifying task (V0.8A §4 rules 4, 6). */
	private readonly handoffs = new Map<
		string,
		{ handoff: Handoff; images: Record<string, WorkspaceFileImage | null> }
	>();
	/** `taskId@attempt` of the live wave's rows: their session references keep plan order (§7). */
	private waveKeys = new Set<string>();
	private captureUnknown = false;
	private complexSelfCheck?: VerificationResult;
	private complexReview?: ComplexTaskReview;
	private previousContribution?: ComplexTaskReview;
	private aggregateHandoff?: Handoff;
	private integrationCheck?: VerificationResult;
	private finalReview?: Review;
	private finalTest?: VerificationResult;

	private constructor(state: Run, request: CreateRunRequest, ports: KernelPorts, now: () => number) {
		this.state = state;
		this.ports = ports;
		this.now = now;
		this.checks = structuredClone(request.checks ?? []);
		this.maxRevisionCycles = state.maxRevisionCycles ?? 0;
		this.approvalTimeoutMs = request.approvalTimeoutMs ?? 30_000;
		const plan = state.complex?.plan;
		// Only a v2 plan executes; a historical v1 plan is read-only history (Amendment A1).
		if (plan && plan.schemaVersion !== 2) throw new Error("Only a COMPLEX v2 plan executes");
		this.plan = plan ? structuredClone(plan) : undefined;
		this.budget = new BudgetController(this.plan ? complexBudgetLimits(this.plan) : (request.budget ?? {}));
		if (state.complex)
			this.work = {
				complex: structuredClone(state.complex),
				evidence: structuredClone(state.complexEvidence ?? []),
				reviews: structuredClone(state.complexReviews ?? []),
				measurements: structuredClone(state.workerMeasurements ?? []),
			};
	}

	static async create(
		request: CreateRunRequest,
		ports: KernelPorts,
		now: () => number = Date.now,
	): Promise<CompanyKernel> {
		request = structuredClone(request);
		if (!isExecutionMode(request.executionMode)) throw new Error("New runs require an explicit execution contract");
		validateContract(TaskContractSchema, request.task);
		assertCriterionIdentity(request.task.acceptanceCriteria);
		validateContract(ClassificationSchema, request.classification);
		if (request.task.status !== "pending") throw new Error("New runs require a pending Host-confirmed Task Contract");
		if (
			!Number.isInteger(request.approvalTimeoutMs ?? 30_000) ||
			(request.approvalTimeoutMs ?? 30_000) < 1 ||
			(request.approvalTimeoutMs ?? 30_000) > 60_000
		)
			throw new Error("Invalid approval timeout");
		const limit = request.maxRevisionCycles ?? 1;
		if (!Number.isInteger(limit) || limit < 0 || limit > 3)
			throw new Error("Revision limit must be an integer from 0 to 3");
		const ids = new Set<string>();
		for (const check of request.checks ?? []) {
			validateContract(CheckRequirementSchema, check);
			if (check.kind === "browser") {
				if (
					!check.browser ||
					check.browser.checkId !== check.id ||
					check.trustRequired !== true ||
					!check.trustRegistrationDigest ||
					check.sandboxRequired === true ||
					check.sandboxPolicyDigest ||
					check.repairableExitCodes?.length
				)
					throw new Error("Invalid frozen browser check requirement");
				validateRegisteredBrowserCheck(check.browser);
			} else if (check.browser) throw new Error("Command requirements cannot contain browser registration");
			if (ids.has(check.id)) throw new Error("Duplicate check ID");
			ids.add(check.id);
		}
		const selection = selectWorkflow(request.classification, request.workflow);
		// COMPLEX executes only a Host-confirmed plan bound to this exact parent and frozen registration set.
		let plan: ComplexPlan | undefined;
		if (request.complexPlan) {
			if (selection.workflow !== "COMPLEX") throw new Error("A COMPLEX plan requires the COMPLEX workflow");
			plan = assertComplexPlanBinding(request.complexPlan, request.task, {
				registeredCheckIds: (request.checks ?? []).map((check) => check.id),
			});
			if (request.budget && capabilityJson(request.budget) !== capabilityJson(complexBudgetLimits(plan)))
				throw new Error("COMPLEX budget must equal the frozen plan limits");
			if (
				request.maxRevisionCycles !== undefined &&
				request.maxRevisionCycles !== plan.limits.maxTotalRevisionCycles
			)
				throw new Error("COMPLEX revision limit must equal the frozen plan limit");
		}
		const timestamp = now();
		const state = validateContract(RunSchema, {
			schemaVersion: 1,
			revision: 0,
			eventSequence: 0,
			currentStep: null,
			runId: request.runId,
			goal: request.task.goal,
			status: "CREATED",
			phase: "PREFLIGHT",
			workflow: selection.workflow,
			executionMode: request.executionMode,
			projectInstruction: request.projectInstruction ?? null,
			...(request.classification.risk === "R3"
				? { r3Scope: selectR3Scope(request.task.goal, request.runId), approvals: [] }
				: {}),
			...(selection.workflow === "QUICK"
				? { quickScope: selectQuickScope(request.task.goal, request.classification) }
				: {}),
			classification: request.classification,
			risk: request.classification.risk,
			currentTask: request.task.id,
			tasks: [request.task],
			taskContractDigest: taskContractDigest(request.task),
			activeAgents: [],
			completed: [],
			next: ["implement"],
			roleSessionRefs: [],
			revisionCycle: 0,
			maxRevisionCycles: plan
				? plan.limits.maxTotalRevisionCycles
				: selection.workflow === "QUICK" || request.classification.risk === "R3"
					? 0
					: limit,
			// COMPLEX never stacks the STANDARD self-check repair allowance on Reviewer revisions (§6).
			verificationRepair: { mode: plan ? "disabled" : (request.verificationRepairMode ?? "disabled"), attempts: [] },
			reviewHistory: [],
			workerMeasurements: [],
			...(request.provenance ? { provenance: request.provenance } : {}),
			budget: new BudgetController(plan ? complexBudgetLimits(plan) : (request.budget ?? {})).status,
			...(plan ? { complex: initialComplexState(plan), complexEvidence: [], complexReviews: [] } : {}),
			verification: [],
			lastError: null,
			createdAt: timestamp,
			updatedAt: timestamp,
		});
		if (await ports.store.load(request.runId))
			throw new Error("Run ID already exists; S1 does not resume or overwrite runs");
		const kernel = new CompanyKernel(state, request, ports, now);
		await kernel.persist({}, [{ type: "RunCreated" }]);
		return kernel;
	}

	get snapshot(): Run {
		return structuredClone(this.state);
	}

	/** Live runs always carry the Host-confirmed contract; legacy observations never reach the Kernel. */
	private taskContract(): TaskContract {
		const task = this.state.tasks[0];
		if (!isTaskContract(task)) throw new Error("Live run requires a Host-confirmed Task Contract");
		return task;
	}
	get deliveryFailures(): EventDeliveryFailure[] {
		return structuredClone(this.eventFailures);
	}

	private assertTransition(status: Run["status"]): void {
		if (this.storageFailed || this.busy || this.state.status !== status)
			throw new Error("Invalid transition for the current run state");
	}

	/**
	 * The one Kernel save queue (V0.8A §4 rule 3, §7): every durable write runs in call order, one at a time, so
	 * persisted revisions are +1 and event sequence numbers strictly increase across concurrent wave callbacks. A
	 * function patch is evaluated at this save's turn against the latest committed state; if it throws, nothing is
	 * saved and storage stays healthy.
	 */
	private persist(
		patch: Partial<Run> | (() => Partial<Run>),
		details: RuntimeEventDetail[] | (() => RuntimeEventDetail[]),
	): Promise<void> {
		const operation = this.saveQueue.then(() => {
			if (this.storageFailed) throw new Error("State persistence already failed; no further saves");
			const resolved = typeof patch === "function" ? patch() : patch;
			return this.persistNow(resolved, typeof details === "function" ? details() : details);
		});
		this.saveQueue = operation.then(
			() => undefined,
			() => undefined,
		);
		return operation;
	}

	private async persistNow(patch: Partial<Run>, details: RuntimeEventDetail[]): Promise<void> {
		const previousSequence = this.state.eventSequence;
		const next = validateContract(RunSchema, {
			...this.state,
			...structuredClone(patch),
			revision: this.state.revision + 1,
			eventSequence: previousSequence + details.length,
			updatedAt: this.now(),
		});
		try {
			await this.ports.store.save(structuredClone(next));
		} catch (error) {
			// No further actions on this instance. The durable state may be older; never emit completion.
			this.storageFailed = true;
			this.state = {
				...this.state,
				status: "FAILED",
				activeAgents: [],
				next: [],
				lastError: "State persistence failed",
				tasks: this.state.tasks.map((task) => ({ ...task, status: "blocked" })),
			};
			throw error;
		}
		this.state = next;
		for (const [index, detail] of details.entries()) {
			const event = createRuntimeEvent(next, previousSequence + index + 1, detail);
			try {
				await this.ports.events?.emit(structuredClone(event));
			} catch {
				// Observer failure is not an execution result. Keep diagnostics separate and do not retry.
				this.eventFailures.push({ sequence: event.sequence, type: event.type });
			}
		}
	}

	async start(): Promise<Run> {
		this.assertTransition("CREATED");
		if (this.plan) return this.startComplex();
		this.busy = true;
		try {
			if (
				!isExecutionMode(this.state.executionMode) ||
				(this.state.executionMode === "READ_ONLY" && (!this.ports.verifier.inspect || this.state.risk === "R3")) ||
				(this.state.workflow === "QUICK" && this.state.risk === "R0" && this.state.executionMode !== "READ_ONLY") ||
				this.state.workflow === "COMPLEX" ||
				(this.state.risk === "R3" && (!this.state.r3Scope || !this.ports.approval)) ||
				((this.state.risk === "R2" || this.state.risk === "R3") &&
					(!this.ports.verifier.inspect || !this.checks.some((check) => check.required))) ||
				(this.state.workflow === "QUICK" &&
					(this.state.risk === "R2" ||
						!this.ports.verifier.inspect ||
						!this.checks.some((check) => check.required)))
			) {
				await this.finish(
					"BLOCKED",
					"Unsupported workflow/risk or missing QUICK/R2 live verification/required checks",
					[],
				);
			} else {
				await this.persist(
					{
						status: "RUNNING",
						phase: "IMPLEMENT",
						currentStep: { stepId: "implement", attempt: 1 },
						tasks: this.state.tasks.map((task) => ({ ...task, status: "inProgress" })),
					},
					[{ type: "RunStarted" }],
				);
			}
			return this.snapshot;
		} finally {
			this.busy = false;
		}
	}

	private async finish(
		status: "BLOCKED" | "FAILED" | "CANCELLED" | "INTERRUPTED",
		reason: string,
		events: RuntimeEventDetail[],
		reviewHistory?: ReviewRecord[],
		/** Trusted measurement/budget patch only; authority fields below always override it. */
		extra?: Partial<Run>,
	): Promise<void> {
		const eventType = {
			BLOCKED: "RunBlocked",
			FAILED: "RunFailed",
			CANCELLED: "RunCancelled",
			INTERRUPTED: "RunInterrupted",
		} as const;
		await this.persist(
			{
				...(extra ?? {}),
				status,
				...(reviewHistory ? { reviewHistory } : {}),
				...(this.state.approvals
					? {
							approvals: this.state.approvals.map((record) =>
								record.status === "PENDING" || record.status === "APPROVED"
									? {
											...record,
											status: status === "CANCELLED" ? ("CANCELLED" as const) : ("INTERRUPTED" as const),
										}
									: record,
							),
						}
					: {}),
				lastError: reason,
				...(this.review ? { review: this.review } : {}),
				activeAgents: [],
				next: [],
				tasks: this.state.tasks.map((task) => ({ ...task, status: "blocked" })),
			},
			[...events, { type: eventType[status], reason }],
		);
	}

	/** Step-boundary stop only. In-flight cancellation is supplied via advance's AbortSignal. */
	async stop(status: "CANCELLED" | "INTERRUPTED", reason: string): Promise<Run> {
		this.assertTransition("RUNNING");
		if (status !== "CANCELLED" && status !== "INTERRUPTED") throw new Error("Invalid stop status");
		if (!reason.trim()) throw new Error("A stop reason is required");
		this.busy = true;
		try {
			if (this.plan)
				await this.finishComplex({
					status,
					code: status === "CANCELLED" ? "CANCELLED" : "OWNER_LOST",
					reason,
					events: [],
				});
			else await this.finish(status, reason, []);
			return this.snapshot;
		} finally {
			this.busy = false;
		}
	}

	private assertQuickScope(workspace: NonNullable<Run["workspace"]>): void {
		if (!this.state.quickScope) return;
		requireEvidence(
			!this.state.executorDigest || workspace.diffDigest === this.state.executorDigest,
			"QUICK digest changed after Executor result; verification is stale, rerun as STANDARD",
		);
		try {
			assertQuickWorkspace(this.state.quickScope, workspace);
		} catch (error) {
			throw new BlockedError(error instanceof Error ? error.message : "QUICK scope exceeded");
		}
	}

	/** Budget denial happens before any model call and keeps BLOCKED (not FAILED) semantics. */
	private reserveBudget(role: string): void {
		try {
			this.budget.reserve(role);
		} catch (error) {
			if (error instanceof BudgetDenied) throw new BlockedError(error.message);
			throw error;
		}
	}

	/** Trusted-ledger record; a missing measurement never fabricates zero usage. */
	private recordBudget(role: string, result: { measurement?: WorkerMeasurement }): Partial<Run> {
		const measurement = result.measurement
			? structuredClone(validateContract(WorkerMeasurementSchema, result.measurement))
			: undefined;
		if (measurement) this.budget.record(role, measurement);
		else this.budget.recordUnavailable();
		return {
			budget: this.budget.status,
			...(measurement ? { workerMeasurements: [...(this.state.workerMeasurements ?? []), measurement] } : {}),
		};
	}

	/** One fixed sequential workflow step per call. The caller cannot skip/reorder steps or inject a target status. */
	async advance(expectedStep: StepId, signal?: AbortSignal): Promise<Run> {
		this.assertTransition("RUNNING");
		const step = this.state.currentStep;
		if (!step || step.stepId !== expectedStep || this.state.phase !== STANDARD_STEP_PHASES[expectedStep]) {
			throw new Error("Invalid transition: unexpected workflow step");
		}
		// COMPLEX is an explicit branch with its own transition table, never relabelled STANDARD.
		if (this.plan) return this.advanceComplex(expectedStep, signal);
		this.busy = true;
		let started = false;
		let sessionRef: RoleSessionReference | undefined;
		let sessionRegistrationOpen = true;
		let approvalCallbacksOpen = true;
		let approvalInFlight = false;
		let approvalFailure: string | undefined;
		// Exactly-once settlement: only an invocation whose reserve succeeded is settled, and only once.
		let budgetReserved = false;
		let budgetSettled = false;
		const measurementPatch: Partial<Run> = {};
		const settleBudget = (measurement?: WorkerMeasurement): void => {
			if (!budgetReserved || budgetSettled) return;
			budgetSettled = true;
			Object.assign(
				measurementPatch,
				this.recordBudget(role ?? "Worker", measurement ? { measurement: structuredClone(measurement) } : {}),
			);
		};
		const terminalMeasurementPatch = (): Partial<Run> => ({
			...measurementPatch,
			budget: this.budget.status,
		});
		const task = structuredClone(this.taskContract());
		const revision = this.state.revisionCycle;
		const executionMode = this.state.executionMode;
		if (!isExecutionMode(executionMode)) {
			this.busy = false;
			throw new Error("Missing live execution contract");
		}
		const request = {
			runId: this.state.runId,
			executionMode,
			projectInstruction: this.state.projectInstruction ?? null,
			revision,
			step: structuredClone(step),
			task,
		};
		const startEvents: RuntimeEventDetail[] = [{ type: "StepStarted", step }];
		const role =
			expectedStep === "implement"
				? this.state.workflow === "QUICK"
					? "Executor"
					: "Developer"
				: expectedStep === "review"
					? "Reviewer"
					: undefined;
		const onSessionCreated = async (reference: RoleSessionReference): Promise<void> => {
			if (!sessionRegistrationOpen) throw new Error("Worker session registration is closed");
			sessionRegistrationOpen = false;
			signal?.throwIfAborted();
			const ref = validateContract(RoleSessionReferenceSchema, structuredClone(reference));
			if (
				!role ||
				ref.role !== role ||
				sessionRef ||
				this.state.roleSessionRefs.some(
					(item) => item.sessionId === ref.sessionId || item.sessionFile === ref.sessionFile,
				)
			)
				throw new Error("Invalid or reused worker session reference");
			await this.persist({ roleSessionRefs: [...this.state.roleSessionRefs, ref] }, [
				{
					type: "AgentSessionCreated",
					step,
					role,
					profile: role === "Reviewer" ? "reasoning" : "coding",
					revision,
					sessionRef: ref,
				},
			]);
			sessionRef = ref;
			signal?.throwIfAborted();
		};
		const onApprovalRequested = async (
			proposal: ApprovalProposal,
			workerSignal?: AbortSignal,
		): Promise<ApprovalDecision> => {
			if (
				!approvalCallbacksOpen ||
				approvalInFlight ||
				this.state.status !== "RUNNING" ||
				this.state.risk !== "R3" ||
				this.state.executionMode !== "EDIT" ||
				!this.state.r3Scope ||
				!this.ports.approval ||
				role !== "Developer" ||
				!sessionRef ||
				expectedStep !== "implement"
			)
				throw new Error("Approval is not available for this action/role");
			const request = validateContract(ApprovalRequestSchema, {
				...structuredClone(proposal),
				expiresAt: this.now() + this.approvalTimeoutMs,
			});
			if (
				request.runId !== this.state.runId ||
				request.path !== this.state.r3Scope.targetPath ||
				request.step.stepId !== "implement" ||
				request.step.attempt !== step.attempt ||
				request.revision !== revision ||
				this.state.approvals?.some((record) => record.request.actionId === request.actionId)
			)
				throw new Error("Approval proposal identity mismatch or replay");
			approvalInFlight = true;
			try {
				await this.persist(
					{
						status: "WAITING_APPROVAL",
						approvals: [...(this.state.approvals ?? []), { request, status: "PENDING" }],
					},
					[{ type: "ApprovalRequested", step, actionId: request.actionId }],
				);
				const combined =
					workerSignal && signal ? AbortSignal.any([workerSignal, signal]) : (workerSignal ?? signal);
				const outcome = await awaitApproval(request, this.ports.approval, combined, this.now);
				await this.persist(
					{
						status: "RUNNING",
						approvals: this.state.approvals!.map((record) =>
							record.request.actionId === request.actionId ? { ...record, status: outcome.status } : record,
						),
					},
					[
						{
							type: "ApprovalResolved",
							step,
							actionId: request.actionId,
							approved: outcome.decision.approved,
							outcome: outcome.status,
						},
					],
				);
				if (!outcome.decision.approved)
					approvalFailure = `Human approval ${outcome.status.toLowerCase()}; action was not executed`;
				return outcome.decision;
			} finally {
				approvalInFlight = false;
			}
		};
		const onApprovalConsumed = async (actionId: string): Promise<void> => {
			if (
				!approvalCallbacksOpen ||
				this.state.risk !== "R3" ||
				role !== "Developer" ||
				!this.state.approvals?.some(
					(record) => record.request.actionId === actionId && record.status === "APPROVED",
				)
			)
				throw new Error("Approval consumption is invalid or late");
			await this.persist(
				{
					approvals: this.state.approvals.map((record) =>
						record.request.actionId === actionId ? { ...record, status: "CONSUMED" as const } : record,
					),
				},
				[{ type: "ApprovalConsumed", step, actionId }],
			);
		};
		if (expectedStep === "review") startEvents.push({ type: "ReviewRequested", step });
		if (role) startEvents.push({ type: "AgentStarted", step, role });
		if (expectedStep === "self-check" || expectedStep === "test")
			startEvents.push({ type: "VerificationStarted", step });
		try {
			signal?.throwIfAborted();
			await this.persist({ activeAgents: role ? [role] : [] }, startEvents);
			started = true;
			signal?.throwIfAborted();
			if ((this.state.quickScope || this.state.executionMode === "READ_ONLY") && this.ports.verifier.inspect) {
				const workspace = await this.ports.verifier.inspect(signal);
				await this.persist({ workspace }, []);
				this.assertQuickScope(workspace);
				if (this.state.executionMode === "READ_ONLY")
					requireEvidence(workspace.safe && workspace.changedFiles.length === 0, "READ_ONLY workspace changed");
				signal?.throwIfAborted();
			}
			const endEvents: RuntimeEventDetail[] = [];
			const patch: Partial<Run> = {};
			switch (expectedStep) {
				case "implement": {
					this.reserveBudget(role ?? "Worker");
					budgetReserved = true;
					const repairParent = this.state.verificationRepair?.attempts.find(
						(attempt) => attempt.toRevision === revision,
					);
					const failedChecks = repairParent
						? this.state.verification.filter(
								(check) =>
									check.revision === repairParent.fromRevision &&
									check.step?.stepId === "self-check" &&
									check.step.attempt === repairParent.fromStep.attempt &&
									repairParent.failedCheckIds.includes(check.id),
							)
						: [];
					if (repairParent)
						requireEvidence(
							failedChecks.length === repairParent.failedCheckIds.length,
							"Repair parent evidence is missing",
						);
					const result = await this.ports.agents.execute({
						...structuredClone(request),
						signal,
						profile: "coding",
						onSessionCreated,
						...(this.state.workflow === "QUICK"
							? { role: "Executor", scope: this.state.quickScope! }
							: {
									role: "Developer",
									previousReview: structuredClone(this.review),
									...(repairParent
										? {
												verificationRepair: {
													parent: structuredClone(repairParent),
													failures: failedChecks.slice(0, 8).map((check) => ({
														id: check.id,
														exitCode: check.exitCode,
														evidenceRefs: [...check.evidenceRefs],
														stdout: check.stdout?.slice(0, 512),
														stderr: check.stderr?.slice(0, 512),
													})),
													omittedChecks: Math.max(0, failedChecks.length - 8),
												},
											}
										: {}),
									...(this.state.risk === "R3" ? { onApprovalRequested, onApprovalConsumed } : {}),
								}),
					});
					// The invocation already returned: its measurement is spent evidence and is settled
					// before cancellation is re-checked. Cancellation still rejects the result itself.
					settleBudget(result.measurement);
					signal?.throwIfAborted();
					requireEvidence(this.ports.agents.safeToRelease !== false, "Worker cleanup is unconfirmed");
					approvalCallbacksOpen = false;
					if (result.role === "Reviewer" || result.role !== role)
						throw new Error("Expected matching implementation role result");
					const handoff = structuredClone(
						result.role === "Executor"
							? validateContract(ExecutorHandoffSchema, result.handoff)
							: validateContract(HandoffSchema, result.handoff),
					);
					assertIdentity(handoff, this.state.runId, revision);
					requireEvidence(handoff.task === task.id, "Handoff belongs to another task");
					if (this.state.risk === "R2" || this.state.risk === "R3")
						requireEvidence(sessionRef?.role === "Developer", "R2 Developer session reference is required");
					if (this.state.verificationRepair?.attempts.length)
						requireEvidence(sessionRef?.role === "Developer", "Repair requires a fresh Developer session");
					this.developerSession = sessionRef;
					this.reviewerSession = undefined;
					this.handoff = handoff;
					this.review = undefined;
					this.selfCheck = undefined;
					this.finalCheck = undefined;
					patch.review = undefined;
					if (handoff.role === "Executor") patch.executorResult = handoff;
					else patch.handoff = handoff;
					endEvents.push({
						type: "AgentCompleted",
						step,
						role: result.role,
						...(sessionRef ? { sessionRef } : {}),
					});
					break;
				}
				case "self-check":
				case "test": {
					if (this.state.risk === "R3")
						requireEvidence(
							this.state.approvals?.some((record) => record.status === "CONSUMED") === true,
							"R3 checks require the approved deletion to have been executed and recorded first",
						);
					if (!this.handoff) throw new Error("Missing Developer handoff");
					const result = structuredClone(
						await this.ports.verifier.verify({
							...structuredClone(request),
							signal,
							handoff: structuredClone(this.handoff),
							checks: structuredClone(this.checks),
						}),
					);
					requireEvidence(this.ports.verifier.safeToRelease !== false, "Verification cleanup is unconfirmed");
					// Persist actual outcomes even when cancellation or later diff collection fails.
					validateContract(VerificationResultSchema, result);
					assertIdentity(result, this.state.runId, revision);
					requireEvidence(
						result.step.stepId === step.stepId && result.step.attempt === step.attempt,
						"Verification belongs to another step attempt",
					);
					await this.persist({ verification: [...this.state.verification, ...result.checks] }, []);
					if (this.ports.verifier.inspect)
						await this.persist({ workspace: await this.ports.verifier.inspect() }, []);
					signal?.throwIfAborted();
					const repair = this.state.verificationRepair;
					const failed = result.checks.filter((check) => check.status !== "PASS");
					if (
						expectedStep === "self-check" &&
						this.state.workflow === "STANDARD" &&
						this.state.executionMode === "EDIT" &&
						this.state.risk === "R1" &&
						repair?.mode === "self-check-once" &&
						repair.attempts.length === 0 &&
						result.integrity === "CLEAN" &&
						failed.length > 0 &&
						failed.every(
							(check) =>
								check.status === "FAIL" &&
								check.kind !== "browser" &&
								check.failureKind === "COMMAND_NONZERO" &&
								check.exitCode !== null &&
								this.checks
									.find((expected) => expected.id === check.id)
									?.repairableExitCodes?.includes(check.exitCode),
						)
					) {
						assertVerification(result, this.state.runId, revision, this.checks, true, this.now());
						requireEvidence(
							this.ports.agents.safeToRelease !== false &&
								this.ports.verifier.safeToRelease !== false &&
								this.state.workspace?.safe === true &&
								this.state.workspace.diffDigest === result.diffDigest,
							"Repair requires fresh safe workspace evidence and confirmed cleanup",
						);
						requireEvidence(
							this.developerSession?.role === "Developer",
							"Repair requires a persisted parent Developer session",
						);
						requireEvidence(
							this.state.taskContractDigest === taskContractDigest(task),
							"Repair cannot change the Task Contract",
						);
						const parent: VerificationRepairAttempt = {
							fromRevision: revision,
							fromStep: { stepId: "self-check", attempt: step.attempt },
							toRevision: revision + 1,
							toStep: { stepId: "implement", attempt: revision + 2 },
							diffDigest: result.diffDigest,
							evidenceRefs: [
								...new Set([...result.evidenceRefs, ...failed.flatMap((check) => check.evidenceRefs)]),
							],
							failedCheckIds: failed.map((check) => check.id),
							taskContractDigest: this.state.taskContractDigest!,
						};
						this.handoff = undefined;
						this.review = undefined;
						this.selfCheck = undefined;
						this.finalCheck = undefined;
						this.developerSession = undefined;
						this.reviewerSession = undefined;
						const reason = "Deterministic SELF_CHECK failure; one bounded repair scheduled";
						await this.persist(
							{
								verificationRepair: { mode: repair.mode, attempts: [parent] },
								revisionCycle: parent.toRevision,
								phase: "IMPLEMENT",
								currentStep: parent.toStep,
								handoff: undefined,
								review: undefined,
								activeAgents: [],
								next: ["implement"],
							},
							[
								{ type: "VerificationFailed", step, reason },
								{ type: "StepFailed", step, reason },
								{ type: "VerificationRepairScheduled", parent },
							],
						);
						return this.snapshot;
					}
					assertVerification(result, this.state.runId, revision, this.checks, false, this.now());
					if (expectedStep === "self-check") this.selfCheck = result;
					else this.finalCheck = result;
					endEvents.push({
						type: "VerificationCompleted",
						step,
						diffDigest: result.diffDigest,
						checkIds: result.checks.map((check) => check.id),
					});
					break;
				}
				case "review": {
					if (!this.handoff || this.handoff.role !== "Developer" || !this.selfCheck)
						throw new Error("Review requires Developer handoff and self-check evidence");
					this.reserveBudget(role ?? "Worker");
					budgetReserved = true;
					const result = await this.ports.agents.execute({
						...structuredClone(request),
						signal,
						role: "Reviewer",
						profile: "reasoning",
						onSessionCreated,
						handoff: structuredClone(this.handoff),
						verification: structuredClone(this.selfCheck),
					});
					// The invocation already returned: its measurement is spent evidence and is settled
					// before cancellation is re-checked. Cancellation still rejects the result itself.
					settleBudget(result.measurement);
					signal?.throwIfAborted();
					requireEvidence(this.ports.agents.safeToRelease !== false, "Worker cleanup is unconfirmed");
					if (result.role !== "Reviewer" || !result.review) throw new Error("Expected Reviewer result");
					if (this.state.risk === "R2" || this.state.risk === "R3")
						requireEvidence(
							sessionRef?.role === "Reviewer",
							"R2 independent Reviewer session reference is required",
						);
					if (this.state.verificationRepair?.attempts.length)
						requireEvidence(
							sessionRef?.role === "Reviewer",
							"Repair requires a fresh independent Reviewer session",
						);
					this.reviewerSession = sessionRef;
					const review = structuredClone(result.review);
					assertReview(review, task, this.selfCheck);
					this.review = review;
					patch.review = review;
					const reviewHistory = [...(this.state.reviewHistory ?? []), review];
					patch.reviewHistory = reviewHistory;
					const type = {
						PASS: "ReviewPassed",
						REVISE: "ReviewRevisionRequested",
						BLOCK: "ReviewBlocked",
					} as const;
					endEvents.push(
						{ type: "AgentCompleted", step, role: "Reviewer", ...(sessionRef ? { sessionRef } : {}) },
						{ type: type[review.result], step, review },
						{ type: "StepCompleted", step },
					);
					const reviewCycles = revision - (this.state.verificationRepair?.attempts.length ?? 0);
					if (
						review.result === "BLOCK" ||
						(review.result === "REVISE" && reviewCycles >= this.maxRevisionCycles)
					) {
						await this.finish(
							"BLOCKED",
							review.result === "BLOCK" ? "Reviewer blocked the task" : "Revision limit reached",
							endEvents,
							reviewHistory,
							measurementPatch,
						);
						return this.snapshot;
					}
					if (review.result === "REVISE") {
						await this.persist(
							{
								review,
								reviewHistory,
								...measurementPatch,
								revisionCycle: revision + 1,
								phase: "IMPLEMENT",
								currentStep: { stepId: "implement", attempt: revision + 2 },
								activeAgents: [],
								next: ["implement"],
							},
							endEvents,
						);
						return this.snapshot;
					}
					// Common path appends StepCompleted once.
					endEvents.pop();
					break;
				}
				case "complete": {
					requireEvidence(
						this.ports.agents.safeToRelease !== false && this.ports.verifier.safeToRelease !== false,
						"Completion requires confirmed resource cleanup",
					);
					if (this.ports.verifier.inspect) {
						const workspace = await this.ports.verifier.inspect(signal);
						await this.persist({ workspace }, []);
						signal?.throwIfAborted();
						requireEvidence(
							workspace.safe && workspace.diffDigest === this.finalCheck?.diffDigest,
							"Workspace changed after final checks; review is stale",
						);
					}
					assertCanComplete(
						{
							...request,
							checks: this.checks,
							workflow: this.state.workflow,
							risk: this.state.risk,
							r3Scope: this.state.r3Scope,
							approvals: this.state.approvals,
							developerSession: this.developerSession,
							reviewerSession: this.reviewerSession,
							quickScope: this.state.quickScope,
							executorDigest: this.state.executorDigest,
							taskContractDigest: this.state.taskContractDigest,
							workspace: this.state.workspace,
							handoff: this.handoff,
							review: this.review,
							selfCheck: this.selfCheck,
							finalCheck: this.finalCheck,
						},
						this.now(),
					);
					if (!this.selfCheck) throw new BlockedError("Completion requires verification evidence");
					// Projection only: criterion results come from trusted submissions and verifier evidence.
					const acceptance =
						this.state.workflow === "QUICK"
							? acceptanceResultsFromChecks(
									task,
									validateContract(ExecutorHandoffSchema, this.handoff).criteria,
									this.selfCheck,
								)
							: acceptanceResultsFromReview(validateContract(ReviewSchema, this.review));
					await this.persist(
						{
							...measurementPatch,
							status: "COMPLETED",
							activeAgents: [],
							completed: [task.id],
							next: [],
							acceptance,
							tasks: [{ ...task, status: "completed" }],
							lastError: null,
						},
						[{ type: "StepCompleted", step }, { type: "RunCompleted" }],
					);
					return this.snapshot;
				}
			}
			const steps: readonly StepId[] = this.state.workflow === "QUICK" ? QUICK_STEP_IDS : STANDARD_STEP_IDS;
			const nextStep = steps[steps.indexOf(expectedStep) + 1];
			const workspace = this.ports.verifier.inspect ? await this.ports.verifier.inspect(signal) : undefined;
			if (workspace) {
				this.assertQuickScope(workspace);
				if (this.state.executionMode === "READ_ONLY")
					requireEvidence(workspace.safe && workspace.changedFiles.length === 0, "READ_ONLY workspace changed");
			}
			if (this.state.workflow === "QUICK" && expectedStep === "implement" && workspace)
				patch.executorDigest = workspace.diffDigest;
			await this.persist(
				{
					...patch,
					...measurementPatch,
					...(workspace ? { workspace } : {}),
					phase: STANDARD_STEP_PHASES[nextStep],
					currentStep: { stepId: nextStep, attempt: revision + 1 },
					activeAgents: [],
					next: [nextStep],
				},
				[...endEvents, { type: "StepCompleted", step }],
			);
			return this.snapshot;
		} catch (error) {
			if (this.storageFailed) throw error;
			if (
				this.ports.verifier.inspect &&
				this.ports.agents.safeToRelease !== false &&
				this.ports.verifier.safeToRelease !== false
			) {
				try {
					await this.persist({ workspace: await this.ports.verifier.inspect() }, []);
				} catch {
					if (this.storageFailed) throw error;
				}
			}
			const cancelled = signal?.aborted === true;
			settleBudget(error instanceof WorkerExecutionError ? error.measurement : undefined);
			const reason = cancelled
				? "Run cancelled"
				: (approvalFailure ?? (error instanceof Error ? error.message : "Step execution failed"));
			const failures: RuntimeEventDetail[] = [];
			if (started) {
				if (role) failures.push({ type: "AgentFailed", step, role, reason, ...(sessionRef ? { sessionRef } : {}) });
				if (expectedStep === "self-check" || expectedStep === "test")
					failures.push({ type: "VerificationFailed", step, reason });
				failures.push({ type: "StepFailed", step, reason });
			}
			await this.finish(
				cancelled ? "CANCELLED" : error instanceof BlockedError || approvalFailure ? "BLOCKED" : "FAILED",
				reason,
				failures,
				undefined,
				terminalMeasurementPatch(),
			);
			return this.snapshot;
		} finally {
			sessionRegistrationOpen = false;
			approvalCallbacksOpen = false;
			this.busy = false;
		}
	}

	// ------------------------------------------------------------------------------------------------------------
	// COMPLEX workflow (docs/architecture/COMPLEX_SEQUENTIAL_WORKFLOW.md §5–§10; V0.8A docs/architecture/
	// PARALLEL_AGENTS.md §4–§7). Implementation runs in waves of concurrent Developers (one wave method); every
	// verification stage, integration phase and completion keeps the V0.7B one-step-per-advance path on a quiescent
	// workspace. Only the Kernel writes task state, through the one save queue.
	// ------------------------------------------------------------------------------------------------------------

	/**
	 * Every COMPLEX save writes the whole working copy together with the one global budget ledger. A function `change`
	 * runs at this save's turn in the Kernel save queue, so concurrent wave callbacks each apply their own change to
	 * the latest state. `activeTaskIds` is always derived from the saved rows (v2 consumer rule 1).
	 */
	private complexSave(
		change: Partial<Run> | ((work: ComplexWork) => Partial<Run>),
		details: RuntimeEventDetail[],
	): Promise<void> {
		return this.persist(() => {
			const work = this.work;
			if (!work) throw new Error("COMPLEX state unavailable");
			const patch = typeof change === "function" ? change(work) : change;
			work.complex.activeTaskIds = work.complex.tasks
				.filter((row) => ACTIVE_TASK_STATUSES.has(row.status))
				.map((row) => row.id);
			return {
				...patch,
				complex: work.complex,
				complexEvidence: work.evidence,
				complexReviews: work.reviews,
				workerMeasurements: work.measurements,
				budget: this.budget.status,
			};
		}, details);
	}

	private complexParent(): TaskContract {
		return this.taskContract();
	}

	/** Plan indexes of the active rows, in plan order. */
	private activeIndexes(): number[] {
		return (this.work?.complex.tasks ?? []).flatMap((row, index) =>
			ACTIVE_TASK_STATUSES.has(row.status) ? [index] : [],
		);
	}

	/** The one row in its verification turn: a stage, or a revising IMPLEMENTING attempt ≥ 2; -1 when none. */
	private turnIndex(): number {
		return (
			this.work?.complex.tasks.findIndex(
				(row) => VERIFYING_TASK_STATUSES.has(row.status) || (row.status === "IMPLEMENTING" && row.attempt >= 2),
			) ?? -1
		);
	}

	/** Admission/per-stage binding guard (§4.2): the frozen plan recomputes and binds this unchanged parent. */
	private assertComplexBinding(): void {
		try {
			assertComplexPlanBinding(this.plan, this.complexParent(), {
				registeredCheckIds: this.checks.map((check) => check.id),
			});
		} catch (error) {
			if (error instanceof ComplexPlanBindingError) throw new BlockedError(error.message, error.code);
			throw error;
		}
		requireComplex(
			this.state.taskContractDigest === this.plan?.parentTaskContractDigest,
			"The Run parent digest differs from the frozen plan",
			"PARENT_MISMATCH",
		);
	}

	/**
	 * One whole-workspace capture reconciled with the expected-image ledger (§5.3). Unsafe, unclaimed, unattributed
	 * or unreadable state blocks as EXTERNAL_MUTATION; an accepted capture refreshes historical evidence freshness.
	 * Taken only while no worker is live (entry, join, verification stages, completion).
	 */
	private async captureReconciled(signal?: AbortSignal): Promise<ComplexWorkspaceImages> {
		if (!this.plan || !this.ledger || !this.ports.verifier.images)
			throw new BlockedError("COMPLEX workspace capture is unavailable", "EXTERNAL_MUTATION");
		let capture: ComplexWorkspaceImages;
		try {
			capture = await this.ports.verifier.images(ComplexOwnershipLedger.claimPaths(this.plan), signal);
		} catch (error) {
			signal?.throwIfAborted();
			this.captureUnknown = true;
			throw new BlockedError(
				`Workspace capture unavailable: ${errorText(error, "capture failed")}`,
				"EXTERNAL_MUTATION",
			);
		}
		if (!/^[0-9a-f]{64}$/.test(capture.diffDigest)) {
			this.captureUnknown = true;
			throw new BlockedError("Workspace capture returned a malformed digest", "EXTERNAL_MUTATION");
		}
		const mismatch = this.ledger.reconcile(capture);
		if (mismatch) throw new BlockedError(`External mutation: ${mismatch}`, "EXTERNAL_MUTATION");
		if (this.work) markStaleEvidence(this.work.complex, capture.diffDigest);
		return capture;
	}

	/**
	 * Own-claim capture at a handoff (V0.8A §4 rule 4): images of exactly the task's claimed files, with no whole-
	 * workspace digest while siblings may still write, reconciled with the task's own recorded effects.
	 */
	private async captureOwnClaims(
		taskId: string,
		signal?: AbortSignal,
	): Promise<Record<string, WorkspaceFileImage | null>> {
		const ledger = this.ledger;
		if (!ledger || !this.ports.verifier.claimImages)
			throw new BlockedError("COMPLEX own-claim capture is unavailable", "EXTERNAL_MUTATION");
		let images: Record<string, WorkspaceFileImage | null>;
		try {
			images = structuredClone(await this.ports.verifier.claimImages(ledger.taskPaths(taskId), signal));
		} catch (error) {
			signal?.throwIfAborted();
			this.captureUnknown = true;
			throw new BlockedError(
				`Own-claim capture unavailable: ${errorText(error, "capture failed")}`,
				"EXTERNAL_MUTATION",
			);
		}
		const mismatch = ledger.ownClaimsError(taskId, images);
		if (mismatch) throw new BlockedError(`External mutation: ${mismatch}`, "EXTERNAL_MUTATION");
		return images;
	}

	/** V0.8A §4 rule 6: at every verification stage each own-claim image still equals its handoff image. */
	private assertOwnClaims(taskId: string, capture: ComplexWorkspaceImages): void {
		const images = this.handoffs.get(taskId)?.images;
		requireComplex(
			!!images &&
				Object.entries(images).every(
					([path, image]) => Object.hasOwn(capture.images, path) && sameFileImage(capture.images[path], image),
				),
			`${taskId} claimed files changed after its handoff`,
			"EXTERNAL_MUTATION",
		);
	}

	/** Resource flags from the Workflow settlement port; a missing flag or port is unknown, never confirmed. */
	private async settleResources(): Promise<boolean> {
		try {
			const flags = await this.ports.resources?.settle();
			return flags?.agents === true && flags.verifier === true && flags.workspace === true && flags.lsp === true;
		} catch {
			return false;
		}
	}

	/** Budget denial happens before any worker call; unknown usage and exhaustion keep their closed codes. */
	private complexReserve(c: ComplexAdvance, role: "Developer" | "Reviewer"): void {
		this.complexReserveMany([c], role);
	}

	/** All-or-nothing reservation in plan order (V0.8A §4 rule 2): on a denial nothing is counted and nothing starts. */
	private complexReserveMany(invocations: readonly ComplexAdvance[], role: "Developer" | "Reviewer"): void {
		try {
			this.budget.reserveMany(role, invocations.length);
		} catch (error) {
			if (error instanceof BudgetDenied)
				throw new BlockedError(
					error.message,
					this.budget.status.reportedTokens === null ? "BUDGET_UNKNOWN" : "BUDGET_EXHAUSTED",
				);
			throw error;
		}
		for (const c of invocations) c.reserved = true;
	}

	/** Exactly-once settlement into the global ledger, the task subtotal and the attempt's evidence record. */
	private complexSettleBudget(c: ComplexAdvance, measurement?: WorkerMeasurement): void {
		if (!c.reserved || c.settled || !this.work) return;
		c.settled = true;
		const work = this.work;
		let value: WorkerMeasurement | undefined;
		let malformed = false;
		try {
			value = measurement ? structuredClone(validateContract(WorkerMeasurementSchema, measurement)) : undefined;
		} catch {
			malformed = true;
		}
		if (value) this.budget.record(c.role ?? "Worker", value);
		else this.budget.recordUnavailable();
		if (value) {
			const index = work.measurements.push({ ...value, complexContext: structuredClone(c.context) }) - 1;
			if (c.evidenceIndex !== undefined) work.evidence[c.evidenceIndex].measurementIndexes.push(index);
		}
		if (c.taskIndex >= 0) {
			const row = work.complex.tasks[c.taskIndex];
			row.reportedTokens =
				value?.usage.source === "provider" && row.reportedTokens !== null
					? row.reportedTokens + value.usage.totalTokens
					: null;
		}
		// Spend stays recorded (as unknown usage) before the malformed adapter result fails the attempt.
		if (malformed) throw new InvalidResultError("Malformed worker measurement");
	}

	private complexRequest(c: ComplexAdvance) {
		const executionMode = this.state.executionMode;
		if (!isExecutionMode(executionMode)) throw new Error("Missing live execution contract");
		return {
			runId: this.state.runId,
			executionMode,
			projectInstruction: this.state.projectInstruction ?? null,
			revision: this.state.revisionCycle,
			step: structuredClone(c.step),
			task: structuredClone(this.complexParent()),
			complexContext: structuredClone(c.context),
		};
	}

	/** Runtime-built bounded contribution input beside the unchanged parent (§7.1). */
	private complexTaskInput(index: number, withPreviousReview: boolean): ComplexTaskInput {
		const plan = this.plan;
		if (!plan) throw new Error("COMPLEX plan unavailable");
		const task = plan.tasks[index];
		const previous = this.previousContribution;
		return {
			task: structuredClone(task),
			otherClaims: plan.tasks
				.filter((other) => other.id !== task.id)
				.flatMap((other) =>
					other.ownership.map((claim) => ({ taskId: other.id, path: claim.path, operation: claim.operation })),
				),
			...(withPreviousReview && previous?.complexContext.taskId === task.id
				? { previousReview: structuredClone(previous) }
				: {}),
		};
	}

	/** Kernel-built aggregate for the final Reviewer, only from validated task records and the ledger. */
	private complexIntegrationInput(): ComplexIntegrationInput {
		const plan = this.plan;
		const work = this.work;
		if (!plan || !work || !this.ledger) throw new Error("COMPLEX state unavailable");
		return {
			tasks: plan.tasks.map((task, index) => ({
				id: task.id,
				title: task.title,
				criterionIds: [...task.criterionIds],
				attempt: work.complex.tasks[index].attempt,
				changedFiles: [...work.complex.tasks[index].changedFiles],
				exitWorkspaceDigest: work.complex.tasks[index].exitWorkspaceDigest,
				evidenceFreshness: work.complex.tasks[index].evidenceFreshness,
			})),
			changedFiles: this.ledger.changedSince(this.ledger.baselineSnapshot()),
		};
	}

	/**
	 * Worker session registration: a fresh session distinct (id and file) from every earlier session of the Run,
	 * checked at this save's turn because a concurrent sibling may register first. A wave Developer's reference is
	 * placed before those of later wave rows, so the list keeps plan order whichever session started first (§7).
	 */
	private complexSessionCallback(c: ComplexAdvance): (reference: RoleSessionReference) => Promise<void> {
		return async (reference) => {
			if (!c.sessionOpen) throw new Error("Worker session registration is closed");
			c.sessionOpen = false;
			c.signal?.throwIfAborted();
			const ref = validateContract(RoleSessionReferenceSchema, structuredClone(reference));
			if (!c.role || ref.role !== c.role || c.sessionRef || ref.complexContext !== undefined) {
				c.sessionRejected = true;
				throw new Error("Invalid or reused worker session reference");
			}
			const attributed: RoleSessionReference = { ...ref, complexContext: structuredClone(c.context) };
			await this.complexSave(
				(work) => {
					const refs = this.state.roleSessionRefs;
					if (refs.some((item) => item.sessionId === ref.sessionId || item.sessionFile === ref.sessionFile)) {
						c.sessionRejected = true;
						throw new Error("Invalid or reused worker session reference");
					}
					if (c.evidenceIndex !== undefined) work.evidence[c.evidenceIndex].sessionRefs.push(attributed);
					return { roleSessionRefs: this.withSessionRef(refs, attributed) };
				},
				[
					{
						type: "AgentSessionCreated",
						step: c.step,
						role: c.role,
						profile: c.role === "Reviewer" ? "reasoning" : "coding",
						revision: this.state.revisionCycle,
						sessionRef: attributed,
						complexContext: c.context,
					},
				],
			);
			c.sessionRef = attributed;
			c.signal?.throwIfAborted();
		};
	}

	/** Appends a session reference; within the live wave it goes before the references of later wave rows. */
	private withSessionRef(refs: readonly RoleSessionReference[], ref: RoleSessionReference): RoleSessionReference[] {
		const key = (item: RoleSessionReference) =>
			item.complexContext?.scope === "TASK" ? `${item.complexContext.taskId}@${item.complexContext.attempt}` : "";
		const taskId = ref.complexContext?.taskId ?? "";
		let at = refs.length;
		if (this.waveKeys.has(key(ref)))
			while (at > 0) {
				const before = refs[at - 1];
				if (!this.waveKeys.has(key(before)) || (before.complexContext?.taskId ?? "") < taskId) break;
				at--;
			}
		return [...refs.slice(0, at), ref, ...refs.slice(at)];
	}

	/** Exact one-use R3 deletion Approval for the deleting task only (§7.2); context is part of the binding. */
	private complexApprovalCallbacks(c: ComplexAdvance): {
		onApprovalRequested: (proposal: ApprovalProposal, workerSignal?: AbortSignal) => Promise<ApprovalDecision>;
		onApprovalConsumed: (actionId: string) => Promise<void>;
	} {
		const onApprovalRequested = async (
			proposal: ApprovalProposal,
			workerSignal?: AbortSignal,
		): Promise<ApprovalDecision> => {
			const work = this.work;
			const task = this.plan?.tasks[c.taskIndex];
			const port: ApprovalPort | undefined = this.ports.approval;
			const claim = task?.ownership.find((item) => item.operation === "delete");
			if (
				!work ||
				!task ||
				!port ||
				!claim ||
				!c.approvalOpen ||
				c.approvalInFlight ||
				this.state.status !== "RUNNING" ||
				this.state.risk !== "R3" ||
				this.state.executionMode !== "EDIT" ||
				!this.state.r3Scope ||
				c.role !== "Developer" ||
				!c.sessionRef ||
				c.step.stepId !== "implement" ||
				work.complex.tasks[c.taskIndex].status !== "IMPLEMENTING"
			)
				throw new Error("Approval is not available for this action/role");
			const request = validateContract(ApprovalRequestSchema, {
				...structuredClone(proposal),
				expiresAt: this.now() + this.approvalTimeoutMs,
			});
			if (
				request.runId !== this.state.runId ||
				request.path !== this.state.r3Scope.targetPath ||
				request.path !== claim.path ||
				request.step.stepId !== "implement" ||
				request.step.attempt !== c.step.attempt ||
				request.revision !== this.state.revisionCycle ||
				!sameContext(request.complexContext, c.context) ||
				// One exact delete Approval per Run: no transfer to a later task, revision or retried request.
				(this.state.approvals?.length ?? 0) > 0
			)
				throw new Error("Approval proposal identity mismatch or replay");
			c.approvalInFlight = true;
			try {
				await this.complexSave(
					(current) => {
						current.complex.tasks[c.taskIndex].status = "WAITING_APPROVAL";
						return {
							status: "WAITING_APPROVAL",
							approvals: [...(this.state.approvals ?? []), { request, status: "PENDING" }],
						};
					},
					[{ type: "ApprovalRequested", step: c.step, actionId: request.actionId, complexContext: c.context }],
				);
				const combined =
					workerSignal && c.signal ? AbortSignal.any([workerSignal, c.signal]) : (workerSignal ?? c.signal);
				const outcome = await awaitApproval(request, port, combined, this.now);
				await this.complexSave(
					(current) => {
						current.complex.tasks[c.taskIndex].status = "IMPLEMENTING";
						return {
							status: "RUNNING",
							approvals: (this.state.approvals ?? []).map((record) =>
								record.request.actionId === request.actionId ? { ...record, status: outcome.status } : record,
							),
						};
					},
					[
						{
							type: "ApprovalResolved",
							step: c.step,
							actionId: request.actionId,
							approved: outcome.decision.approved,
							outcome: outcome.status,
							complexContext: c.context,
						},
					],
				);
				if (!outcome.decision.approved) c.approvalFailure = outcome.status;
				return outcome.decision;
			} finally {
				c.approvalInFlight = false;
			}
		};
		const onApprovalConsumed = async (actionId: string): Promise<void> => {
			if (
				!c.approvalOpen ||
				this.state.risk !== "R3" ||
				c.role !== "Developer" ||
				!this.state.approvals?.some(
					(record) => record.request.actionId === actionId && record.status === "APPROVED",
				)
			)
				throw new Error("Approval consumption is invalid or late");
			await this.complexSave(
				() => ({
					approvals: (this.state.approvals ?? []).map((record) =>
						record.request.actionId === actionId ? { ...record, status: "CONSUMED" as const } : record,
					),
				}),
				[{ type: "ApprovalConsumed", step: c.step, actionId, complexContext: c.context }],
			);
		};
		return { onApprovalRequested, onApprovalConsumed };
	}

	/** R3 checks require the exact approved deletion to have been executed and recorded first (§7.2). */
	private requireComplexDeletion(): void {
		if (this.state.risk !== "R3") return;
		requireComplex(
			this.state.approvals?.length === 1 && this.state.approvals[0].status === "CONSUMED",
			"R3 checks require the approved deletion to have been executed and recorded first",
			"APPROVAL_INVALID",
		);
	}

	/**
	 * COMPLEX admission: supported ports and checks, the bound plan, a clean baseline whose claimed images fit the
	 * claim semantics, then RUNNING with the first wave ELIGIBLE as a persisted scheduling decision (not permission).
	 */
	private async startComplex(): Promise<Run> {
		this.busy = true;
		try {
			const plan = this.plan;
			const work = this.work;
			if (!plan || !work) throw new Error("COMPLEX state unavailable");
			const unsupported =
				!isExecutionMode(this.state.executionMode) ||
				!this.ports.verifier.inspect ||
				!this.ports.verifier.images ||
				!this.ports.verifier.claimImages ||
				!this.ports.resources ||
				!this.checks.some((check) => check.required) ||
				(this.state.risk === "R3" &&
					(!this.state.r3Scope || !this.ports.approval || this.state.executionMode !== "EDIT"));
			try {
				requireComplex(
					!unsupported,
					"Unsupported COMPLEX start: live workspace and own-claim capture, resource settlement, a required check and (R3) scope and Approval are mandatory",
					"RUN_STOPPED",
				);
				this.assertComplexBinding();
				if (this.state.risk === "R3")
					requireComplex(
						plan.tasks[0].ownership.length === 1 &&
							plan.tasks[0].ownership[0].operation === "delete" &&
							plan.tasks[0].ownership[0].path === this.state.r3Scope?.targetPath &&
							plan.limits.maxParallel === 1,
						"The R3 deletion claim differs from the Runtime-selected target",
						"PLAN_MISMATCH",
					);
				let capture: ComplexWorkspaceImages;
				try {
					if (!this.ports.verifier.images) throw new Error("capture port missing");
					capture = await this.ports.verifier.images(ComplexOwnershipLedger.claimPaths(plan));
				} catch (error) {
					this.captureUnknown = true;
					throw new BlockedError(
						`Admission capture unavailable: ${errorText(error, "capture failed")}`,
						"EXTERNAL_MUTATION",
					);
				}
				requireComplex(
					/^[0-9a-f]{64}$/.test(capture.diffDigest),
					"Admission capture digest is malformed",
					"EXTERNAL_MUTATION",
				);
				const ledger = ComplexOwnershipLedger.admit(plan, capture, plan.limits.maxParallel);
				if (typeof ledger === "string") throw new BlockedError(ledger, "EXTERNAL_MUTATION");
				this.ledger = ledger;
			} catch (error) {
				if (this.storageFailed) throw error;
				await this.finishComplex({
					status: "BLOCKED",
					code: error instanceof BlockedError && error.code ? error.code : "RUN_STOPPED",
					reason: errorText(error, "COMPLEX admission failed"),
					events: [],
				});
				return this.snapshot;
			}
			// The first wave is decided and persisted before any worker starts (§4 rule 1).
			const wave = complexWave(plan, work.complex.tasks);
			await this.complexSave(
				(current) => {
					for (const index of wave) current.complex.tasks[index].status = "ELIGIBLE";
					return {
						status: "RUNNING",
						phase: "IMPLEMENT",
						currentStep: { stepId: "implement", attempt: 1 },
						tasks: this.state.tasks.map((task) => ({ ...task, status: "inProgress" })),
					};
				},
				[{ type: "RunStarted" }],
			);
			return this.snapshot;
		} finally {
			this.busy = false;
		}
	}

	/**
	 * STOPPING → terminal (§9; V0.8A §6): fence scheduling, persist every active row STOPPING in one save with cleanup
	 * PENDING, stop/join every resource, capture partial state only when safe, then persist the honest terminal
	 * outcome. Rows that failed on their own keep their codes and stopped siblings end RUN_STOPPED (CANCELLED on a
	 * cancel). Unconfirmed cleanup is INTERRUPTED with cleanup UNCONFIRMED (writer retained); COMPLETED rows stay
	 * historical.
	 */
	private async finishComplex(input: {
		status: "BLOCKED" | "FAILED" | "CANCELLED" | "INTERRUPTED";
		code: ComplexFailureCode;
		reason: string;
		events: RuntimeEventDetail[];
		gateTarget?: GateTarget;
		gate?: CheckGate | ReviewGate;
		evidenceIndex?: number;
		/** Rows whose own failure stopped the Run, with the evidence record of their current attempt when one exists. */
		failures?: Record<
			string,
			{ status: "BLOCKED" | "FAILED"; failureCode: ComplexFailureCode; evidenceIndex?: number }
		>;
	}): Promise<void> {
		const work = this.work;
		const plan = this.plan;
		if (!work || !plan) throw new Error("COMPLEX state unavailable");
		const index = this.turnIndex();
		if (input.gateTarget && input.gate) {
			if (input.gateTarget === "check") {
				if (work.complex.integration.check === "RUNNING") work.complex.integration.check = input.gate as CheckGate;
			} else if (index >= 0) {
				const row = work.complex.tasks[index];
				if (input.gateTarget === "review") {
					if (row.review === "RUNNING") row.review = input.gate as ReviewGate;
				} else if (row[input.gateTarget] === "RUNNING") row[input.gateTarget] = input.gate as CheckGate;
			} else if (input.gateTarget === "review") {
				if (work.complex.integration.review === "RUNNING")
					work.complex.integration.review = input.gate as ReviewGate;
			} else if (work.complex.integration.test === "RUNNING")
				work.complex.integration.test = input.gate as CheckGate;
		}
		work.complex.phase = "STOPPING";
		// One save moves every active row (working, ELIGIBLE or HANDED_OFF) to STOPPING (Amendment A1 atomic saves).
		for (const row of work.complex.tasks) if (ACTIVE_TASK_STATUSES.has(row.status)) row.status = "STOPPING";
		work.complex.cleanup = "PENDING";
		await this.complexSave({ activeAgents: [], next: [] }, input.events);
		let confirmed = await this.settleResources();
		let capture: ComplexWorkspaceImages | undefined;
		let unattributed = false;
		if (confirmed && this.ports.verifier.images) {
			try {
				capture = await this.ports.verifier.images(ComplexOwnershipLedger.claimPaths(plan));
				if (!/^[0-9a-f]{64}$/.test(capture.diffDigest)) capture = undefined;
			} catch {
				capture = undefined;
			}
			if (capture && this.ledger) unattributed = this.ledger.reconcile(capture) !== undefined;
			// The capture itself ran a workspace process: confirm again before a clean terminal outcome.
			confirmed = await this.settleResources();
		}
		const status = confirmed ? input.status : "INTERRUPTED";
		const code: ComplexFailureCode = confirmed ? input.code : "CLEANUP_UNCONFIRMED";
		if (input.evidenceIndex !== undefined && work.evidence[input.evidenceIndex])
			work.evidence[input.evidenceIndex].failureCode = code;
		for (const failure of Object.values(input.failures ?? {}))
			if (failure.evidenceIndex !== undefined && work.evidence[failure.evidenceIndex])
				work.evidence[failure.evidenceIndex].failureCode = confirmed ? failure.failureCode : code;
		const changesUnknown = !capture || this.captureUnknown;
		const ledger = this.ledger;
		const rows: Record<string, { changedFiles: string[]; changesUnknown: boolean }> = {};
		if (ledger)
			for (const [position, row] of work.complex.tasks.entries()) {
				if (FINISHED_TASK_STATUSES.has(row.status) || row.status === "PENDING" || row.attempt === 0) continue;
				const task = plan.tasks[position];
				const entry = this.taskEntries.get(task.id);
				rows[task.id] = {
					changedFiles: entry ? ledger.changedSince(entry, task.id) : [],
					changesUnknown: unattributed || changesUnknown || ledger.unknownIn(task.id),
				};
			}
		work.complex = settleComplexState(work.complex, {
			taskStatus: status,
			failureCode: code,
			// Unconfirmed cleanup interrupts every started row alike; otherwise each failing row keeps its own code.
			...(confirmed && input.failures
				? {
						failures: Object.fromEntries(
							Object.entries(input.failures).map(([taskId, failure]) => [
								taskId,
								{ status: failure.status, failureCode: failure.failureCode },
							]),
						),
					}
				: {}),
			cancelled: input.status === "CANCELLED",
			ownerLost: false,
			cleanup: confirmed ? "CONFIRMED" : "UNCONFIRMED",
			partialChanges: capture ? capture.changedFiles.length > 0 : true,
			changesUnknown,
			rows,
		});
		// Unconfirmed cleanup keeps every lease quarantined with the writer for manual inspection (§5.2).
		if (confirmed) this.ledger?.release();
		const eventType = {
			BLOCKED: "RunBlocked",
			FAILED: "RunFailed",
			CANCELLED: "RunCancelled",
			INTERRUPTED: "RunInterrupted",
		} as const;
		const reason = confirmed
			? input.reason
			: `${input.reason}; resource cleanup unconfirmed, project lock retained for manual inspection`;
		await this.complexSave(
			{
				status,
				...(this.state.approvals
					? {
							approvals: this.state.approvals.map((record) =>
								record.status === "PENDING" || record.status === "APPROVED"
									? {
											...record,
											status: status === "CANCELLED" ? ("CANCELLED" as const) : ("INTERRUPTED" as const),
										}
									: record,
							),
						}
					: {}),
				...(capture
					? {
							workspace: {
								diffDigest: capture.diffDigest,
								changedFiles: [...capture.changedFiles],
								evidenceRefs: [`diff:${capture.diffDigest}`],
								safe: capture.safe,
							},
						}
					: {}),
				lastError: reason,
				activeAgents: [],
				next: [],
				tasks: this.state.tasks.map((item) => ({ ...item, status: "blocked" })),
			},
			[{ type: eventType[status], reason }],
		);
	}

	/**
	 * One COMPLEX step per call: the (phase, row statuses, step) table decides; the caller cannot skip a stage. An
	 * all-ELIGIBLE active set is a formed wave (implement); otherwise the one row in its verification turn decides.
	 */
	private async advanceComplex(expectedStep: StepId, signal?: AbortSignal): Promise<Run> {
		const plan = this.plan;
		const work = this.work;
		const current = this.state.currentStep;
		if (!plan || !work || !current) throw new Error("COMPLEX state unavailable");
		const phase = work.complex.phase;
		const rows = work.complex.tasks;
		const active = this.activeIndexes();
		const turn = this.turnIndex();
		const wave = phase === "TASK_SEQUENCE" && active.length > 0 && active.every((i) => rows[i].status === "ELIGIBLE");
		const row = turn >= 0 ? rows[turn] : undefined;
		const taskSteps: Partial<Record<ComplexTaskStatus, StepId>> = {
			IMPLEMENTING: "implement",
			SELF_CHECK: "self-check",
			REVIEW: "review",
			TEST: "test",
		};
		const integrationSteps: Partial<Record<ComplexRunState["phase"], StepId>> = {
			INTEGRATION_CHECK: "self-check",
			FINAL_REVIEW: "review",
			FINAL_TEST: "test",
			COMPLETING: "complete",
		};
		const expected =
			phase === "TASK_SEQUENCE" ? (wave ? "implement" : row && taskSteps[row.status]) : integrationSteps[phase];
		const attempt = phase === "TASK_SEQUENCE" ? (wave ? 1 : (row?.attempt ?? 0)) : 1;
		if (
			expected !== expectedStep ||
			current.attempt !== attempt ||
			(phase === "TASK_SEQUENCE") !== active.length > 0 ||
			capabilityJson(work.complex.activeTaskIds ?? null) !== capabilityJson(active.map((i) => rows[i].id))
		)
			throw new Error("Invalid transition: unexpected COMPLEX workflow step");
		if (expectedStep === "implement") {
			this.busy = true;
			try {
				await this.complexWave(wave ? active : [turn], structuredClone(current), signal);
				return this.snapshot;
			} finally {
				this.busy = false;
			}
		}
		const context = row ? taskContext(plan, row.id, attempt) : integrationContext(plan);
		const evidenceIndex = work.evidence.findIndex((record) => sameContext(record.complexContext, context));
		const c: ComplexAdvance = {
			step: structuredClone(current),
			signal,
			context,
			taskIndex: row ? turn : -1,
			role: expectedStep === "review" ? "Reviewer" : undefined,
			sessionOpen: true,
			sessionRejected: false,
			approvalOpen: true,
			approvalInFlight: false,
			reserved: false,
			settled: false,
			started: false,
			...(evidenceIndex >= 0 ? { evidenceIndex } : {}),
		};
		this.busy = true;
		try {
			signal?.throwIfAborted();
			if (expectedStep === "review")
				await (phase === "TASK_SEQUENCE" ? this.complexTaskReview(c) : this.complexFinalReview(c));
			else if (expectedStep === "complete") await this.complexComplete(c);
			else await (phase === "TASK_SEQUENCE" ? this.complexTaskCheck(c) : this.complexIntegrationCheck(c));
			return this.snapshot;
		} catch (error) {
			if (this.storageFailed) throw error;
			// Fence every callback of this invocation before STOPPING: late sessions, Approvals and effects are rejected.
			c.sessionOpen = false;
			c.approvalOpen = false;
			c.closeOwnership?.();
			await this.complexFailure(c, error);
			return this.snapshot;
		} finally {
			c.sessionOpen = false;
			c.approvalOpen = false;
			c.closeOwnership?.();
			this.busy = false;
		}
	}

	/** decision 9: known denials BLOCKED with a closed code, faults FAILED (never a cancel; see callers). */
	private complexOutcome(
		c: ComplexAdvance,
		error: unknown,
	): { status: "BLOCKED" | "FAILED"; code: ComplexFailureCode; reason: string } {
		const approvalCodes: Partial<Record<ApprovalRecord["status"], ComplexFailureCode>> = {
			DENIED: "APPROVAL_DENIED",
			EXPIRED: "APPROVAL_EXPIRED",
		};
		let status: "BLOCKED" | "FAILED" = "BLOCKED";
		let code: ComplexFailureCode;
		let reason = errorText(error, "Step execution failed");
		if (c.approvalFailure) {
			code = approvalCodes[c.approvalFailure] ?? "APPROVAL_INVALID";
			reason = `Human approval ${c.approvalFailure.toLowerCase()}; action was not executed`;
		} else if (c.ownershipDenial) {
			code = c.ownershipDenial.code;
			reason = c.ownershipDenial.message;
		} else if (c.sessionRejected) code = c.role === "Reviewer" ? "REVIEW_MISSING" : "INVALID_RESULT";
		else if (error instanceof WorkerExecutionError && error.denial) code = error.denial;
		else if (error instanceof BlockedError) code = error.code ?? "INVALID_RESULT";
		else if (error instanceof InvalidResultError) {
			status = "FAILED";
			code = "INVALID_RESULT";
		} else {
			status = "FAILED";
			code = "WORKER_FAILED";
		}
		return { status, code, reason };
	}

	/** Failure/cancel events of one started invocation, in its own causal order. */
	private complexStepFailureEvents(c: ComplexAdvance, reason: string): RuntimeEventDetail[] {
		if (!c.started) return [];
		return [
			...(c.role
				? [
						{
							type: "AgentFailed" as const,
							step: c.step,
							role: c.role,
							reason,
							...(c.sessionRef ? { sessionRef: c.sessionRef } : {}),
							complexContext: c.context,
						},
					]
				: []),
			...(c.step.stepId === "self-check" || c.step.stepId === "test"
				? [{ type: "VerificationFailed" as const, step: c.step, reason, complexContext: c.context }]
				: []),
			{ type: "StepFailed" as const, step: c.step, reason, complexContext: c.context },
		];
	}

	/**
	 * decision 9 for one verification/integration step: known denials BLOCKED with a closed code, faults FAILED,
	 * cancel CANCELLED after cleanup. HANDED_OFF rows waiting for their turn end as stopped siblings.
	 */
	private async complexFailure(c: ComplexAdvance, error: unknown): Promise<void> {
		const cancelled = c.signal?.aborted === true;
		try {
			this.complexSettleBudget(c, error instanceof WorkerExecutionError ? error.measurement : undefined);
		} catch {
			// A malformed measurement was already recorded as unknown usage; the original failure decides.
		}
		const outcome = cancelled
			? { status: "CANCELLED" as const, code: "CANCELLED" as const, reason: "Run cancelled" }
			: this.complexOutcome(c, error);
		const task = c.taskIndex >= 0 ? this.plan?.tasks[c.taskIndex] : undefined;
		await this.finishComplex({
			status: outcome.status,
			code: outcome.code,
			reason: outcome.reason,
			events: c.verdictEvents ?? this.complexStepFailureEvents(c, outcome.reason),
			...(c.gateTarget ? { gateTarget: c.gateTarget } : {}),
			...(c.gate ? { gate: c.gate } : {}),
			...(c.evidenceIndex !== undefined ? { evidenceIndex: c.evidenceIndex } : {}),
			...(task && outcome.status !== "CANCELLED"
				? { failures: { [task.id]: { status: outcome.status, failureCode: outcome.code } } }
				: {}),
		});
	}

	/**
	 * V0.8A wave (§4 rules 1–5, §5, §6). Scheduling guard, one entry capture and an all-or-nothing reservation happen
	 * before one save moves every wave row to IMPLEMENTING. Then each row's Developer runs concurrently with its own
	 * session, (taskId, attempt) capability and context under one wave-scoped abort, and a valid handoff moves it to
	 * HANDED_OFF. The join barrier waits for every invocation; measurements settle in plan order; one reconciling
	 * capture precedes the first verification turn. A REVISE re-implementation is a wave of its one row. Any failure
	 * or cancel aborts every sibling and joins them before STOPPING and the terminal save; no worker outlives it.
	 */
	private async complexWave(indexes: readonly number[], step: StepReference, signal?: AbortSignal): Promise<void> {
		const plan = this.plan;
		const work = this.work;
		const ledger = this.ledger;
		if (!plan || !work || !ledger) throw new Error("COMPLEX state unavailable");
		const abort = new AbortController();
		const waveSignal = signal ? AbortSignal.any([signal, abort.signal]) : abort.signal;
		const members: WaveMember[] = indexes.map((index) => {
			const row = work.complex.tasks[index];
			const first = row.status === "ELIGIBLE";
			return {
				first,
				c: {
					step: structuredClone(step),
					signal: waveSignal,
					context: taskContext(plan, row.id, first ? 1 : row.attempt),
					taskIndex: index,
					role: "Developer",
					sessionOpen: true,
					sessionRejected: false,
					approvalOpen: true,
					approvalInFlight: false,
					reserved: false,
					settled: false,
					started: false,
				},
			};
		});
		this.waveKeys = new Set(members.map(({ c }) => `${c.context.taskId}@${c.context.attempt}`));
		const workers: Array<Promise<void>> = [];
		try {
			try {
				signal?.throwIfAborted();
				this.assertComplexBinding();
				for (const { c, first } of members)
					if (first)
						requireComplex(
							taskReady(plan, work.complex.tasks, c.taskIndex),
							`${plan.tasks[c.taskIndex].id} cannot start: a scheduling dependency is not COMPLETED`,
							"DEPENDENCY_NOT_COMPLETED",
						);
				const entry = await this.captureReconciled(signal);
				this.complexReserveMany(
					members.map(({ c }) => c),
					"Developer",
				);
				await this.complexSave(
					(current) => {
						for (const { c, first } of members) {
							const task = plan.tasks[c.taskIndex];
							const row = current.complex.tasks[c.taskIndex];
							row.status = "IMPLEMENTING";
							row.attempt = c.context.attempt;
							row.entryWorkspaceDigest = entry.diffDigest;
							row.exitWorkspaceDigest = null;
							row.workerInvocations += 1;
							if (first) this.taskEntries.set(task.id, ledger.snapshot());
							this.attemptEntries.set(task.id, ledger.snapshot());
							c.evidenceIndex =
								current.evidence.push({
									complexContext: structuredClone(c.context),
									revision: this.state.revisionCycle,
									entryWorkspaceDigest: entry.diffDigest,
									exitWorkspaceDigest: null,
									changedFiles: [],
									changeDigest: null,
									checkRefs: [],
									handoff: false,
									review: false,
									sessionRefs: [],
									measurementIndexes: [],
									failureCode: null,
								}) - 1;
							ledger.activate({ taskId: task.id, attempt: c.context.attempt });
						}
						return { activeAgents: ["Developer"] };
					},
					members.flatMap(({ c }) => [
						{ type: "StepStarted" as const, step: c.step, complexContext: c.context },
						{
							type: "AgentStarted" as const,
							step: c.step,
							role: "Developer" as const,
							complexContext: c.context,
						},
					]),
				);
				for (const { c } of members) c.started = true;
				signal?.throwIfAborted();
			} catch (error) {
				if (this.storageFailed) throw error;
				// A wave-level cause before any worker started is every wave row's own failure.
				await this.complexWaveFailure(members, signal, error);
				return;
			}
			let stopping = false;
			const stop = () => {
				if (stopping) return;
				stopping = true;
				abort.abort();
				// Late tool calls of aborted siblings are rejected at once, before their invocations settle.
				for (const { c } of members) c.closeOwnership?.();
			};
			for (const member of members) workers.push(this.complexWaveWorker(member, waveSignal, stop));
			// JOIN (§4 rule 5): verification never starts while any wave invocation is live.
			await Promise.all(workers);
			if (this.storageFailed)
				throw members.find((member) => member.error !== undefined)?.error ?? new Error("State persistence failed");
			// Spent evidence settles in plan order, never in completion order (§7).
			for (const { c, measurement } of members)
				try {
					this.complexSettleBudget(c, measurement);
				} catch {
					// A malformed measurement already failed its row; its spend stays recorded as unknown usage.
				}
			if (signal?.aborted || members.some((member) => member.error !== undefined)) {
				await this.complexWaveFailure(members, signal);
				return;
			}
			try {
				requireComplex(
					this.ports.agents.safeToRelease !== false,
					"Worker cleanup is unconfirmed",
					"CLEANUP_UNCONFIRMED",
				);
				// One full capture reconciles every wave effect before any verification (else EXTERNAL_MUTATION).
				const capture = await this.captureReconciled(signal);
				signal?.throwIfAborted();
				const next = work.complex.tasks.findIndex((row) => row.status === "HANDED_OFF");
				await this.complexSave((current) => this.startTurn(current, next, capture.diffDigest), []);
			} catch (error) {
				if (this.storageFailed) throw error;
				await this.complexWaveFailure(members, signal, error);
			}
		} finally {
			abort.abort();
			await Promise.allSettled(workers);
			for (const { c } of members) {
				c.sessionOpen = false;
				c.approvalOpen = false;
				c.closeOwnership?.();
			}
			this.waveKeys = new Set();
		}
	}

	/**
	 * One wave row's Developer (§4 rules 3–4): a fresh session, its own closed-on-settle (taskId, attempt) capability
	 * and context; a valid handoff whose changed_files equal the attempt's ledger effects and whose own claimed files
	 * reconcile moves the row to HANDED_OFF. Never throws: a failure is recorded and stops the whole wave.
	 */
	private async complexWaveWorker(member: WaveMember, signal: AbortSignal, stop: () => void): Promise<void> {
		const plan = this.plan;
		const ledger = this.ledger;
		const { c } = member;
		try {
			if (!plan || !ledger) throw new Error("COMPLEX state unavailable");
			const task = plan.tasks[c.taskIndex];
			signal.throwIfAborted();
			const capability = complexOwnershipCapability(
				ledger,
				{ taskId: task.id, attempt: c.context.attempt },
				(denial) => {
					c.ownershipDenial ??= denial;
				},
			);
			c.closeOwnership = capability.close;
			let result: AgentExecutionResult;
			try {
				result = await this.ports.agents.execute({
					...this.complexRequest(c),
					signal,
					role: "Developer",
					profile: "coding",
					onSessionCreated: this.complexSessionCallback(c),
					complexTask: this.complexTaskInput(c.taskIndex, true),
					ownership: capability.port,
					...(this.state.risk === "R3" ? this.complexApprovalCallbacks(c) : {}),
				});
			} finally {
				capability.close();
			}
			// The invocation returned: its measurement is spent evidence, settled at the join.
			member.measurement = result.measurement;
			if (result.measurement !== undefined)
				try {
					validateContract(WorkerMeasurementSchema, result.measurement);
				} catch {
					throw new InvalidResultError("Malformed worker measurement");
				}
			signal.throwIfAborted();
			c.approvalOpen = false;
			if (c.ownershipDenial) throw new BlockedError(c.ownershipDenial.message, c.ownershipDenial.code);
			if (result.role !== "Developer") throw new InvalidResultError("Expected the task Developer handoff");
			let handoff: Handoff;
			try {
				handoff = structuredClone(validateContract(HandoffSchema, result.handoff));
			} catch {
				throw new InvalidResultError("Malformed Developer handoff");
			}
			requireComplex(
				sameContext(handoff.complexContext, c.context) &&
					handoff.runId === this.state.runId &&
					handoff.revision === this.state.revisionCycle &&
					handoff.task === this.complexParent().id,
				"Handoff belongs to another run, work cycle, parent or task attempt",
				"INVALID_RESULT",
			);
			requireComplex(handoff.unresolved.length === 0, "Developer handoff reports unresolved work", "INVALID_RESULT");
			requireComplex(
				c.sessionRef?.role === "Developer",
				"COMPLEX requires a persisted Developer session",
				"INVALID_RESULT",
			);
			// changed_files must equal the ledger's effects of this attempt (the task's own claims only).
			const attemptEntry = this.attemptEntries.get(task.id);
			const attemptDelta = attemptEntry ? ledger.changedSince(attemptEntry, task.id) : [];
			requireComplex(
				handoff.changed_files.length === attemptDelta.length &&
					capabilityJson([...handoff.changed_files].sort()) === capabilityJson(attemptDelta),
				"Handoff changed_files differ from the actual task-local delta",
				"INVALID_RESULT",
			);
			if (this.state.risk === "R3" && task.ownership.some((claim) => claim.operation === "delete"))
				requireComplex(
					this.state.approvals?.[0]?.status === "CONSUMED" &&
						capabilityJson(attemptDelta) === capabilityJson([this.state.r3Scope?.targetPath]),
					"R3 task requires the one consumed deletion of its exact target",
					"APPROVAL_INVALID",
				);
			// The task's own claimed files, which no sibling may touch, are captured at handoff.
			const images = await this.captureOwnClaims(task.id, signal);
			signal.throwIfAborted();
			await this.complexSave(
				(current) => {
					const row = current.complex.tasks[c.taskIndex];
					const taskEntry = this.taskEntries.get(task.id);
					row.status = "HANDED_OFF";
					row.changedFiles = taskEntry ? ledger.changedSince(taskEntry, task.id) : attemptDelta;
					if (c.evidenceIndex !== undefined) {
						const record = current.evidence[c.evidenceIndex];
						record.changedFiles = attemptDelta;
						record.changeDigest = attemptEntry ? ledger.changeDigest(attemptEntry, attemptDelta) : null;
						record.handoff = true;
					}
					this.handoffs.set(task.id, { handoff, images });
					return {};
				},
				[
					{
						type: "AgentCompleted",
						step: c.step,
						role: "Developer",
						...(c.sessionRef ? { sessionRef: c.sessionRef } : {}),
						complexContext: c.context,
					},
					{ type: "StepCompleted", step: c.step, complexContext: c.context },
				],
			);
			member.handedOff = true;
		} catch (error) {
			if (member.measurement === undefined && error instanceof WorkerExecutionError)
				member.measurement = error.measurement;
			member.error = error;
			member.afterAbort = signal.aborted;
			stop();
		} finally {
			c.sessionOpen = false;
			c.approvalOpen = false;
			c.closeOwnership?.();
		}
	}

	/** A HANDED_OFF row's verification turn begins at the quiescent workspace digest (§4 rule 6). */
	private startTurn(work: ComplexWork, index: number, digest: string): Partial<Run> {
		const plan = this.plan;
		const row = work.complex.tasks[index];
		const turn = row ? this.handoffs.get(row.id) : undefined;
		if (!plan || !row || row.status !== "HANDED_OFF" || !turn)
			throw new Error("A verification turn needs a HANDED_OFF row with its handoff");
		row.status = "SELF_CHECK";
		row.exitWorkspaceDigest = digest;
		const context = taskContext(plan, row.id, row.attempt);
		const record = work.evidence.find((item) => sameContext(item.complexContext, context));
		if (record) record.exitWorkspaceDigest = digest;
		return {
			handoff: turn.handoff,
			phase: "SELF_CHECK",
			currentStep: { stepId: "self-check", attempt: row.attempt },
			activeAgents: [],
			next: ["self-check"],
		};
	}

	/**
	 * Wave settlement (§4 rule 8, §6), after the wave is aborted and joined. A user cancel ends every started row
	 * CANCELLED. Otherwise each row that failed on its own keeps its own status and code (a wave-level cause is every
	 * wave row's own), stopped siblings end BLOCKED/RUN_STOPPED, and the Run takes the first failure in plan order.
	 */
	private async complexWaveFailure(
		members: readonly WaveMember[],
		signal: AbortSignal | undefined,
		waveError?: unknown,
	): Promise<void> {
		const plan = this.plan;
		if (!plan) throw new Error("COMPLEX plan unavailable");
		// Every reserved invocation is settled exactly once, as unknown usage when it never reported one.
		for (const { c, measurement } of members)
			try {
				this.complexSettleBudget(c, measurement);
			} catch {
				// A malformed measurement already failed its row; its spend stays recorded as unknown usage.
			}
		const unfinished = (member: WaveMember) => !member.handedOff;
		if (signal?.aborted) {
			await this.finishComplex({
				status: "CANCELLED",
				code: "CANCELLED",
				reason: "Run cancelled",
				events: members.filter(unfinished).flatMap(({ c }) => this.complexStepFailureEvents(c, "Run cancelled")),
			});
			return;
		}
		const own = members.flatMap((member) => {
			const error = waveError ?? member.error;
			if (error === undefined) return [];
			const typed =
				!!member.c.ownershipDenial ||
				!!member.c.approvalFailure ||
				member.c.sessionRejected ||
				(member.error instanceof WorkerExecutionError && !!member.error.denial);
			// A row that failed only because the wave was aborted is a stopped sibling, not a hidden failure.
			if (waveError === undefined && member.afterAbort && !typed) return [];
			return [{ member, ...this.complexOutcome(member.c, error) }];
		});
		const first = own[0];
		const stoppedBy = first ? plan.tasks[first.member.c.taskIndex].id : "a sibling";
		const events = members.flatMap((member) => {
			if (!unfinished(member)) return [];
			const failure = own.find((item) => item.member === member);
			return this.complexStepFailureEvents(member.c, failure ? failure.reason : `Run stopped: ${stoppedBy} failed`);
		});
		await this.finishComplex({
			status: first?.status ?? "BLOCKED",
			code: first?.code ?? "RUN_STOPPED",
			reason: first?.reason ?? "Wave stopped",
			events,
			failures: Object.fromEntries(
				own.map(({ member, status, code }) => [
					plan.tasks[member.c.taskIndex].id,
					{
						status,
						failureCode: code,
						...(member.c.evidenceIndex !== undefined ? { evidenceIndex: member.c.evidenceIndex } : {}),
					},
				]),
			),
		});
	}

	/**
	 * Registered verification bound to this context: TASK runs exactly the frozen task subset, INTEGRATION the
	 * complete list. Context/namespace/identity mismatch is STALE_EVIDENCE; actual bound outcomes persist first.
	 */
	private async complexVerify(
		c: ComplexAdvance,
		handoff: Handoff,
		checks: CheckRequirement[],
	): Promise<VerificationResult> {
		let result: VerificationResult;
		try {
			result = structuredClone(
				await this.ports.verifier.verify({
					...this.complexRequest(c),
					signal: c.signal,
					handoff: structuredClone(handoff),
					checks: structuredClone(checks),
				}),
			);
		} catch (error) {
			c.signal?.throwIfAborted();
			throw new BlockedError(
				`Registered verification unavailable: ${errorText(error, "verifier failed")}`,
				"CHECK_UNAVAILABLE",
			);
		}
		requireComplex(
			this.ports.verifier.safeToRelease !== false,
			"Verification cleanup is unconfirmed",
			"CLEANUP_UNCONFIRMED",
		);
		try {
			validateContract(VerificationResultSchema, result);
		} catch {
			throw new InvalidResultError("Malformed verification result");
		}
		const namespace = evidenceNamespace({ runId: this.state.runId, step: c.step, complexContext: c.context });
		const bound =
			result.runId === this.state.runId &&
			result.revision === this.state.revisionCycle &&
			result.step.stepId === c.step.stepId &&
			result.step.attempt === c.step.attempt &&
			sameContext(result.complexContext, c.context) &&
			result.checks.length === checks.length &&
			result.checks.every(
				(check, position) =>
					check.id === checks[position].id &&
					check.runId === this.state.runId &&
					check.revision === this.state.revisionCycle &&
					check.step?.stepId === c.step.stepId &&
					check.step.attempt === c.step.attempt &&
					sameContext(check.complexContext, c.context) &&
					capabilityJson(check.evidenceRefs) === capabilityJson([`check:${namespace}:${check.id}`]),
			);
		if (!bound) {
			c.gate = "STALE";
			throw new BlockedError(
				"Verification evidence belongs to another context, attempt or check set",
				"STALE_EVIDENCE",
			);
		}
		const record = c.evidenceIndex !== undefined ? this.work?.evidence[c.evidenceIndex] : undefined;
		if (record)
			record.checkRefs = [
				...new Set([...record.checkRefs, ...result.checks.flatMap((check) => check.evidenceRefs)]),
			];
		await this.complexSave({ verification: [...this.state.verification, ...result.checks] }, []);
		c.signal?.throwIfAborted();
		return result;
	}

	/** Check statuses: every selected task check is mandatory; integration keeps frozen required/optional semantics. */
	private assertComplexChecks(
		c: ComplexAdvance,
		result: VerificationResult,
		checks: CheckRequirement[],
		allMandatory: boolean,
	): void {
		if (allMandatory) {
			const failed = result.checks.find((check) => check.status === "FAIL");
			if (failed) {
				c.gate = "FAIL";
				throw new BlockedError(`Task check ${failed.id} failed`, "CHECK_FAILED");
			}
			const missing = result.checks.find((check) => check.status !== "PASS");
			if (missing) {
				c.gate = "UNAVAILABLE";
				throw new BlockedError(
					`Task check ${missing.id} is ${missing.status}; every task check is mandatory`,
					"CHECK_UNAVAILABLE",
				);
			}
		}
		try {
			assertVerification(result, this.state.runId, this.state.revisionCycle, checks, false, this.now());
		} catch (error) {
			const unavailable = result.checks.some(
				(check) => check.required && check.status !== "PASS" && check.status !== "FAIL",
			);
			c.gate = unavailable ? "UNAVAILABLE" : "FAIL";
			throw new BlockedError(
				errorText(error, "Verification failed"),
				unavailable ? "CHECK_UNAVAILABLE" : "CHECK_FAILED",
			);
		}
	}

	/** Distinct fresh browser captures between the first and final batch of one scope (§8.2). */
	private assertDistinctCaptures(c: ComplexAdvance, first: VerificationResult, final: VerificationResult): void {
		for (const check of final.checks.filter((item) => item.kind === "browser")) {
			const before = first.checks.find((item) => item.id === check.id)?.browser;
			if (
				!before ||
				!check.browser ||
				before.captureId === check.browser.captureId ||
				check.browser.capturedAt < before.capturedAt
			) {
				c.gate = "STALE";
				throw new BlockedError("Final browser verification cannot reuse the first capture", "STALE_EVIDENCE");
			}
		}
	}

	/**
	 * Task SELF_CHECK / TEST in the row's verification turn: the frozen task check subset, fresh, at the turn (and
	 * reviewed) digest, with the row's own claimed files unchanged since its handoff (V0.8A §4 rule 6).
	 */
	private async complexTaskCheck(c: ComplexAdvance): Promise<void> {
		const plan = this.plan;
		const work = this.work;
		const ledger = this.ledger;
		if (!plan || !work || !ledger) throw new Error("COMPLEX state unavailable");
		const index = c.taskIndex;
		const task = plan.tasks[index];
		const row = work.complex.tasks[index];
		const test = c.step.stepId === "test";
		const handoff = this.handoffs.get(task.id)?.handoff;
		const selfCheck = this.complexSelfCheck;
		const review = this.complexReview;
		if (!handoff || !row.exitWorkspaceDigest || (test && (!selfCheck || !review)))
			throw new Error("COMPLEX task check lacks its earlier stage evidence");
		this.requireComplexDeletion();
		const expectedDigest = test && review ? review.diffDigest : row.exitWorkspaceDigest;
		const pre = await this.captureReconciled(c.signal);
		requireComplex(
			pre.diffDigest === expectedDigest,
			"Workspace changed after the task handoff",
			"EXTERNAL_MUTATION",
		);
		this.assertOwnClaims(task.id, pre);
		const checks = this.checks.filter((check) => task.checkIds.includes(check.id));
		c.gateTarget = test ? "test" : "selfCheck";
		row[c.gateTarget] = "RUNNING";
		await this.complexSave({ activeAgents: [] }, [
			{ type: "StepStarted", step: c.step, complexContext: c.context },
			{ type: "VerificationStarted", step: c.step, complexContext: c.context },
		]);
		c.started = true;
		c.signal?.throwIfAborted();
		const result = await this.complexVerify(c, handoff, checks);
		if (result.diffDigest !== expectedDigest) {
			c.gate = "STALE";
			throw new BlockedError(
				"Task verification evidence is not bound to the current task workspace",
				"STALE_EVIDENCE",
			);
		}
		const post = await this.captureReconciled();
		requireComplex(
			post.diffDigest === result.diffDigest,
			"Workspace changed after task verification",
			"EXTERNAL_MUTATION",
		);
		this.assertOwnClaims(task.id, post);
		this.assertComplexChecks(c, result, checks, true);
		if (test && selfCheck) this.assertDistinctCaptures(c, selfCheck, result);
		// Cancellation fence: a cancel that arrived with the last check wins before any success commit.
		c.signal?.throwIfAborted();
		const events: RuntimeEventDetail[] = [
			{
				type: "VerificationCompleted",
				step: c.step,
				diffDigest: result.diffDigest,
				checkIds: result.checks.map((check) => check.id),
				complexContext: c.context,
			},
			{ type: "StepCompleted", step: c.step, complexContext: c.context },
		];
		if (!test) {
			row.selfCheck = "PASS";
			row.evidenceFreshness = "CURRENT";
			row.status = "REVIEW";
			this.complexSelfCheck = result;
			await this.complexSave(
				{ phase: "REVIEW", currentStep: { stepId: "review", attempt: c.context.attempt }, next: ["review"] },
				events,
			);
			return;
		}
		row.test = "PASS";
		row.status = "COMPLETED";
		row.evidenceFreshness = "CURRENT";
		row.failureCode = null;
		this.taskHandoffs.set(task.id, handoff);
		ledger.release(task.id);
		this.handoffs.delete(task.id);
		this.complexSelfCheck = undefined;
		this.complexReview = undefined;
		this.previousContribution = undefined;
		// The next HANDED_OFF row of this wave takes its turn in plan order, at this same quiescent digest.
		const turn = work.complex.tasks.findIndex((item) => item.status === "HANDED_OFF");
		if (turn >= 0) {
			await this.complexSave((current) => this.startTurn(current, turn, post.diffDigest), events);
			return;
		}
		if (work.complex.tasks.every((item) => item.status === "COMPLETED")) {
			work.complex.phase = "INTEGRATION_CHECK";
			await this.complexSave(
				{ phase: "SELF_CHECK", currentStep: { stepId: "self-check", attempt: 1 }, next: ["self-check"] },
				events,
			);
			return;
		}
		// The next wave forms only after this one COMPLETED (§4 rule 1): plan order, scheduling dependencies
		// COMPLETED, at most maxParallel rows; with maxParallel = 1 exactly the next row after every earlier one.
		const wave = complexWave(plan, work.complex.tasks);
		requireComplex(
			wave.length > 0 && work.complex.tasks.every((item) => !ACTIVE_TASK_STATUSES.has(item.status)),
			"The next wave cannot form: a scheduling dependency is not COMPLETED",
			"DEPENDENCY_NOT_COMPLETED",
		);
		for (const position of wave) work.complex.tasks[position].status = "ELIGIBLE";
		await this.complexSave(
			{ phase: "IMPLEMENT", currentStep: { stepId: "implement", attempt: 1 }, next: ["implement"] },
			events,
		);
	}

	/**
	 * Task REVIEW: a new read-only Reviewer session distinct from every earlier session judges the contribution to
	 * exactly the mapped criteria. REVISE allocates a fresh attempt within both revision budgets; otherwise BLOCKED.
	 */
	private async complexTaskReview(c: ComplexAdvance): Promise<void> {
		const plan = this.plan;
		const work = this.work;
		const ledger = this.ledger;
		if (!plan || !work || !ledger) throw new Error("COMPLEX state unavailable");
		const index = c.taskIndex;
		const task = plan.tasks[index];
		const row = work.complex.tasks[index];
		const handoff = this.handoffs.get(task.id)?.handoff;
		const selfCheck = this.complexSelfCheck;
		if (!handoff || !selfCheck) throw new Error("Task review requires the task handoff and SELF_CHECK evidence");
		const pre = await this.captureReconciled(c.signal);
		requireComplex(
			pre.diffDigest === selfCheck.diffDigest,
			"Workspace changed before task review",
			"EXTERNAL_MUTATION",
		);
		this.assertOwnClaims(task.id, pre);
		this.complexReserve(c, "Reviewer");
		row.review = "RUNNING";
		row.workerInvocations += 1;
		c.gateTarget = "review";
		await this.complexSave({ activeAgents: ["Reviewer"] }, [
			{ type: "StepStarted", step: c.step, complexContext: c.context },
			{ type: "ReviewRequested", step: c.step, complexContext: c.context },
			{ type: "AgentStarted", step: c.step, role: "Reviewer", complexContext: c.context },
		]);
		c.started = true;
		c.signal?.throwIfAborted();
		const result = await this.ports.agents.execute({
			...this.complexRequest(c),
			signal: c.signal,
			role: "Reviewer",
			profile: "reasoning",
			onSessionCreated: this.complexSessionCallback(c),
			handoff: structuredClone(handoff),
			verification: structuredClone(selfCheck),
			complexTask: this.complexTaskInput(index, false),
		});
		this.complexSettleBudget(c, result.measurement);
		c.signal?.throwIfAborted();
		requireComplex(this.ports.agents.safeToRelease !== false, "Worker cleanup is unconfirmed", "CLEANUP_UNCONFIRMED");
		requireComplex(c.sessionRef?.role === "Reviewer", "Independent Reviewer session missing", "REVIEW_MISSING");
		if (result.role !== "Reviewer" || !result.contribution)
			throw new InvalidResultError("Expected a COMPLEX task contribution review");
		let review: ComplexTaskReview;
		try {
			review = structuredClone(validateContract(ComplexTaskReviewSchema, result.contribution));
		} catch {
			throw new InvalidResultError("Malformed task contribution review");
		}
		const refs = verificationRefs(selfCheck);
		if (
			!sameContext(review.complexContext, c.context) ||
			review.runId !== this.state.runId ||
			review.revision !== this.state.revisionCycle ||
			review.task !== this.complexParent().id ||
			review.diffDigest !== selfCheck.diffDigest ||
			review.evidenceRefs.some((ref) => !refs.has(ref)) ||
			review.criteria.some((item) => item.evidenceRefs.some((ref) => !refs.has(ref)))
		) {
			c.gate = "STALE";
			throw new BlockedError("Task review belongs to another attempt, digest or evidence set", "STALE_EVIDENCE");
		}
		requireComplex(
			review.evidenceRefs.length > 0 &&
				capabilityJson(review.criteria.map((item) => item.criterionId)) === capabilityJson(task.criterionIds),
			"Task review must judge exactly the task's mapped criteria once, with evidence",
			"INVALID_RESULT",
		);
		if (review.result === "PASS")
			requireComplex(
				review.criteria.every((item) => item.status === "SUPPORTED" && item.evidenceRefs.length > 0) &&
					!review.issues.some((issue) => issue.severity === "blocker"),
				"Task review PASS requires every mapped criterion SUPPORTED with evidence and no blocker",
				"INVALID_RESULT",
			);
		const post = await this.captureReconciled();
		requireComplex(
			post.diffDigest === review.diffDigest,
			"Workspace changed during task review",
			"EXTERNAL_MUTATION",
		);
		this.assertOwnClaims(task.id, post);
		work.reviews.push(review);
		if (c.evidenceIndex !== undefined) work.evidence[c.evidenceIndex].review = true;
		const type = { PASS: "ReviewPassed", REVISE: "ReviewRevisionRequested", BLOCK: "ReviewBlocked" } as const;
		const events: RuntimeEventDetail[] = [
			{
				type: "AgentCompleted",
				step: c.step,
				role: "Reviewer",
				...(c.sessionRef ? { sessionRef: c.sessionRef } : {}),
				complexContext: c.context,
			},
			{ type: type[review.result], step: c.step, review, complexContext: c.context },
			{ type: "StepCompleted", step: c.step, complexContext: c.context },
		];
		if (review.result === "PASS") {
			row.review = "PASS";
			row.status = "TEST";
			this.complexReview = review;
			await this.complexSave(
				{
					phase: "TEST",
					currentStep: { stepId: "test", attempt: c.context.attempt },
					activeAgents: [],
					next: ["test"],
				},
				events,
			);
			return;
		}
		if (
			review.result === "REVISE" &&
			row.revisionCycle < task.maxRevisionCycles &&
			this.state.revisionCycle < plan.limits.maxTotalRevisionCycles
		) {
			// REVISE is the only local code loop: consume both revision budgets, keep the claim and failure history,
			// clear current evidence and allocate a fresh attempt/session with NOT_RUN gates. The row re-implements
			// alone (a wave of one) while later rows of its wave wait HANDED_OFF, then resumes its turn.
			const attempt = row.attempt + 1;
			row.revisionCycle += 1;
			row.attempt = attempt;
			row.status = "IMPLEMENTING";
			row.selfCheck = "NOT_RUN";
			row.review = "NOT_RUN";
			row.test = "NOT_RUN";
			row.evidenceFreshness = "NONE";
			row.entryWorkspaceDigest = post.diffDigest;
			row.exitWorkspaceDigest = null;
			ledger.activate({ taskId: task.id, attempt });
			this.previousContribution = review;
			this.handoffs.delete(task.id);
			this.complexSelfCheck = undefined;
			this.complexReview = undefined;
			await this.complexSave(
				{
					revisionCycle: this.state.revisionCycle + 1,
					handoff: undefined,
					phase: "IMPLEMENT",
					currentStep: { stepId: "implement", attempt },
					activeAgents: [],
					next: ["implement"],
				},
				events,
			);
			return;
		}
		c.gate = review.result;
		c.verdictEvents = events;
		throw new BlockedError(
			review.result === "BLOCK" ? "Reviewer blocked the task" : "Revision limit reached",
			review.result === "BLOCK" ? "REVIEW_BLOCKED" : "REVISION_LIMIT",
		);
	}

	/** INTEGRATION_CHECK / FINAL_TEST: the complete frozen registration list over the combined Run diff (§8.2). */
	private async complexIntegrationCheck(c: ComplexAdvance): Promise<void> {
		const plan = this.plan;
		const work = this.work;
		const ledger = this.ledger;
		if (!plan || !work || !ledger) throw new Error("COMPLEX state unavailable");
		const final = c.step.stepId === "test";
		requireComplex(
			work.complex.tasks.every((row) => row.status === "COMPLETED"),
			"Integration requires every task COMPLETED",
			"DEPENDENCY_NOT_COMPLETED",
		);
		if (final && (!this.integrationCheck || !this.finalReview || !this.aggregateHandoff))
			throw new Error("Final checks require the integration check and final review");
		this.assertComplexBinding();
		this.requireComplexDeletion();
		const pre = await this.captureReconciled(c.signal);
		const expectedDigest = final && this.finalReview ? this.finalReview.diffDigest : pre.diffDigest;
		requireComplex(
			pre.diffDigest === expectedDigest,
			"Workspace changed after the final review",
			"EXTERNAL_MUTATION",
		);
		if (!final) {
			const changed = ledger.changedSince(ledger.baselineSnapshot());
			const summaries = plan.tasks.map(
				(task) =>
					`${task.id} ${task.title}: ${this.taskHandoffs.get(task.id)?.summary.slice(0, 400) ?? "no handoff"}`,
			);
			// Runtime-built aggregate of validated task handoffs; no model creates a goal, criterion or check.
			this.aggregateHandoff = validateContract(HandoffSchema, {
				runId: this.state.runId,
				revision: this.state.revisionCycle,
				role: "Developer",
				task: this.complexParent().id,
				changed_files: changed,
				summary: `Runtime-built aggregate of ${plan.tasks.length} validated COMPLEX task handoffs. ${summaries.join(" | ")}`,
				assumptions: [],
				tests_run: [],
				known_risks: [],
				unresolved: [],
				complexContext: c.context,
			});
			c.evidenceIndex =
				work.evidence.push({
					complexContext: structuredClone(c.context),
					revision: this.state.revisionCycle,
					entryWorkspaceDigest: pre.diffDigest,
					exitWorkspaceDigest: null,
					changedFiles: changed,
					changeDigest: ledger.changeDigest(ledger.baselineSnapshot(), changed),
					checkRefs: [],
					handoff: true,
					review: false,
					sessionRefs: [],
					measurementIndexes: [],
					failureCode: null,
				}) - 1;
		}
		const handoff = this.aggregateHandoff;
		if (!handoff) throw new Error("Integration aggregate handoff unavailable");
		c.gateTarget = final ? "test" : "check";
		if (final) work.complex.integration.test = "RUNNING";
		else work.complex.integration.check = "RUNNING";
		await this.complexSave({ activeAgents: [], ...(final ? {} : { handoff }) }, [
			{ type: "StepStarted", step: c.step, complexContext: c.context },
			{ type: "VerificationStarted", step: c.step, complexContext: c.context },
		]);
		c.started = true;
		c.signal?.throwIfAborted();
		const result = await this.complexVerify(c, handoff, this.checks);
		if (result.diffDigest !== expectedDigest) {
			c.gate = "STALE";
			throw new BlockedError(
				"Integration evidence is not bound to the reviewed combined workspace",
				"STALE_EVIDENCE",
			);
		}
		const post = await this.captureReconciled();
		requireComplex(
			post.diffDigest === result.diffDigest,
			"Workspace changed during integration checks",
			"EXTERNAL_MUTATION",
		);
		this.assertComplexChecks(c, result, this.checks, false);
		for (const criterion of this.complexParent().acceptanceCriteria)
			for (const id of criterion.verification.checkIds)
				if (result.checks.find((check) => check.id === id)?.status !== "PASS") {
					c.gate = "FAIL";
					throw new BlockedError(
						`Acceptance criterion ${criterion.id} lacks passing integration evidence`,
						"CHECK_FAILED",
					);
				}
		if (final && this.integrationCheck) this.assertDistinctCaptures(c, this.integrationCheck, result);
		c.signal?.throwIfAborted();
		const events: RuntimeEventDetail[] = [
			{
				type: "VerificationCompleted",
				step: c.step,
				diffDigest: result.diffDigest,
				checkIds: result.checks.map((check) => check.id),
				complexContext: c.context,
			},
			{ type: "StepCompleted", step: c.step, complexContext: c.context },
		];
		if (!final) {
			work.complex.integration.check = "PASS";
			work.complex.integration.workspaceDigest = result.diffDigest;
			work.complex.integration.evidenceFreshness = "CURRENT";
			work.complex.phase = "FINAL_REVIEW";
			this.integrationCheck = result;
			await this.complexSave(
				{ phase: "REVIEW", currentStep: { stepId: "review", attempt: 1 }, next: ["review"] },
				events,
			);
			return;
		}
		work.complex.integration.test = "PASS";
		work.complex.phase = "COMPLETING";
		if (c.evidenceIndex !== undefined) work.evidence[c.evidenceIndex].exitWorkspaceDigest = result.diffDigest;
		this.finalTest = result;
		await this.complexSave(
			{ phase: "COMPLETE", currentStep: { stepId: "complete", attempt: 1 }, next: ["complete"] },
			events,
		);
	}

	/**
	 * FINAL_REVIEW: a new independent Reviewer (distinct from every earlier session) judges every parent criterion
	 * over the combined diff and fresh integration evidence. Any REVISE/BLOCK/non-MET outcome blocks (no repair loop).
	 */
	private async complexFinalReview(c: ComplexAdvance): Promise<void> {
		const work = this.work;
		const check = this.integrationCheck;
		const handoff = this.aggregateHandoff;
		if (!work || !check || !handoff) throw new Error("Final review requires integration evidence");
		const pre = await this.captureReconciled(c.signal);
		requireComplex(
			pre.diffDigest === check.diffDigest,
			"Workspace changed before the final review",
			"EXTERNAL_MUTATION",
		);
		this.complexReserve(c, "Reviewer");
		work.complex.integration.review = "RUNNING";
		c.gateTarget = "review";
		await this.complexSave({ activeAgents: ["Reviewer"] }, [
			{ type: "StepStarted", step: c.step, complexContext: c.context },
			{ type: "ReviewRequested", step: c.step, complexContext: c.context },
			{ type: "AgentStarted", step: c.step, role: "Reviewer", complexContext: c.context },
		]);
		c.started = true;
		c.signal?.throwIfAborted();
		const result = await this.ports.agents.execute({
			...this.complexRequest(c),
			signal: c.signal,
			role: "Reviewer",
			profile: "reasoning",
			onSessionCreated: this.complexSessionCallback(c),
			handoff: structuredClone(handoff),
			verification: structuredClone(check),
			complexIntegration: this.complexIntegrationInput(),
		});
		this.complexSettleBudget(c, result.measurement);
		c.signal?.throwIfAborted();
		requireComplex(this.ports.agents.safeToRelease !== false, "Worker cleanup is unconfirmed", "CLEANUP_UNCONFIRMED");
		requireComplex(c.sessionRef?.role === "Reviewer", "Independent final Reviewer session missing", "REVIEW_MISSING");
		if (result.role !== "Reviewer" || !result.review)
			throw new InvalidResultError("Expected the final parent review");
		let review: Review;
		try {
			review = structuredClone(validateContract(ReviewSchema, result.review));
		} catch {
			throw new InvalidResultError("Malformed final review");
		}
		const parent = this.complexParent();
		const refs = verificationRefs(check);
		if (
			!sameContext(review.complexContext, c.context) ||
			review.runId !== this.state.runId ||
			review.revision !== this.state.revisionCycle ||
			review.task !== parent.id ||
			review.diffDigest !== check.diffDigest ||
			review.evidenceRefs.some((ref) => !refs.has(ref)) ||
			review.criteria.some((item) => item.evidenceRefs.some((ref) => !refs.has(ref)))
		) {
			c.gate = "STALE";
			throw new BlockedError("Final review belongs to another digest, context or evidence set", "STALE_EVIDENCE");
		}
		requireComplex(
			review.evidenceRefs.length > 0 &&
				capabilityJson(review.criteria.map((item) => item.criterionId)) ===
					capabilityJson(parent.acceptanceCriteria.map((criterion) => criterion.id)),
			"Final review must judge every parent criterion exactly once, with evidence",
			"INVALID_RESULT",
		);
		const post = await this.captureReconciled();
		requireComplex(
			post.diffDigest === review.diffDigest,
			"Workspace changed during the final review",
			"EXTERNAL_MUTATION",
		);
		if (c.evidenceIndex !== undefined) work.evidence[c.evidenceIndex].review = true;
		const type = { PASS: "ReviewPassed", REVISE: "ReviewRevisionRequested", BLOCK: "ReviewBlocked" } as const;
		const events: RuntimeEventDetail[] = [
			{
				type: "AgentCompleted",
				step: c.step,
				role: "Reviewer",
				...(c.sessionRef ? { sessionRef: c.sessionRef } : {}),
				complexContext: c.context,
			},
			{ type: type[review.result], step: c.step, review, complexContext: c.context },
			{ type: "StepCompleted", step: c.step, complexContext: c.context },
		];
		const reviewHistory = [...(this.state.reviewHistory ?? []), review];
		if (
			review.result !== "PASS" ||
			!review.criteria.every((item) => item.status === "MET" && item.evidenceRefs.length > 0) ||
			review.issues.some((issue) => issue.severity === "blocker")
		) {
			// Persist the actual verdict record, then block: no hidden integration repair or mutation task.
			await this.complexSave({ review, reviewHistory }, []);
			c.gate = review.result === "PASS" ? "UNAVAILABLE" : review.result;
			c.verdictEvents = events;
			throw new BlockedError(
				review.result === "PASS"
					? "Final review PASS without every parent criterion MET with evidence"
					: `Final review ${review.result}; no integration repair loop`,
				"REVIEW_BLOCKED",
			);
		}
		work.complex.integration.review = "PASS";
		work.complex.phase = "FINAL_TEST";
		this.finalReview = review;
		await this.complexSave(
			{
				review,
				reviewHistory,
				phase: "TEST",
				currentStep: { stepId: "test", attempt: 1 },
				activeAgents: [],
				next: ["test"],
			},
			events,
		);
	}

	/**
	 * COMPLETING: confirmed resource settlement, a live capture equal to the final checked digest and the ledger,
	 * known budget below its caps, then the independent COMPLEX guard; COMPLETED is persisted before RunCompleted.
	 */
	private async complexComplete(c: ComplexAdvance): Promise<void> {
		const plan = this.plan;
		const work = this.work;
		const ledger = this.ledger;
		if (!plan || !work || !ledger) throw new Error("COMPLEX state unavailable");
		requireComplex(
			await this.settleResources(),
			"Resources are not confirmed stopped before completion",
			"CLEANUP_UNCONFIRMED",
		);
		const live = await this.captureReconciled(c.signal);
		requireComplex(
			live.diffDigest === this.finalTest?.diffDigest,
			"Workspace changed after the final checks; the final review is stale",
			"STALE_EVIDENCE",
		);
		requireComplex(
			await this.settleResources(),
			"Resources are not confirmed stopped before completion",
			"CLEANUP_UNCONFIRMED",
		);
		const budget = this.budget.status;
		requireComplex(
			budget.reportedTokens !== null,
			"Provider usage is unknown; completion needs known accounting",
			"BUDGET_UNKNOWN",
		);
		requireComplex(
			budget.reportedTokens !== null &&
				budget.reportedTokens < plan.limits.maxReportedTokens &&
				budget.workerInvocations <= plan.limits.maxWorkerInvocations &&
				!budget.exceeded,
			"Budget exhausted before completion",
			"BUDGET_EXHAUSTED",
		);
		assertCanCompleteComplex(
			{
				run: {
					...this.snapshot,
					budget,
					complex: structuredClone(work.complex),
					complexEvidence: structuredClone(work.evidence),
					complexReviews: structuredClone(work.reviews),
				},
				plan,
				checks: this.checks,
				integrationCheck: this.integrationCheck,
				finalReview: this.finalReview,
				finalTest: this.finalTest,
				liveDigest: live.diffDigest,
				liveChangedFiles: live.changedFiles,
				ledgerDigest: ledger.expectedWorkspaceDigest,
				resourcesConfirmed: true,
			},
			this.now(),
		);
		c.signal?.throwIfAborted();
		const review = this.finalReview;
		if (!review) throw new BlockedError("Completion requires the final review", "REVIEW_MISSING");
		const parent = this.complexParent();
		work.complex.phase = "TERMINAL";
		work.complex.cleanup = "CONFIRMED";
		work.complex.partialChanges = false;
		work.complex.changesUnknown = false;
		await this.complexSave(
			{
				status: "COMPLETED",
				activeAgents: [],
				completed: [parent.id],
				next: [],
				acceptance: acceptanceResultsFromReview(review),
				tasks: [{ ...parent, status: "completed" }],
				workspace: {
					diffDigest: live.diffDigest,
					changedFiles: [...live.changedFiles],
					evidenceRefs: [`diff:${live.diffDigest}`],
					safe: live.safe,
				},
				lastError: null,
			},
			[{ type: "StepCompleted", step: c.step, complexContext: c.context }, { type: "RunCompleted" }],
		);
	}
}
