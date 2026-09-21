import { awaitApproval, selectR3Scope } from "./approval.ts";
import { validBrowserCheckEvidence } from "./browser-evidence.ts";
import { validateRegisteredBrowserCheck } from "./browser-types.ts";
import { BudgetController, BudgetDenied, type BudgetLimits } from "./budget.ts";
import { selectWorkflow } from "./classification.ts";
import {
	type AcceptanceCriterion,
	type ApprovalDecision,
	type ApprovalProposal,
	ApprovalRequestSchema,
	type CheckRequirement,
	CheckRequirementSchema,
	type Classification,
	ClassificationSchema,
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
import type { KernelPorts } from "./ports.ts";
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
}

class BlockedError extends Error {}

function requireEvidence(condition: boolean, reason: string): void {
	if (!condition) throw new BlockedError(reason);
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
	private handoff?: Handoff | ExecutorHandoff;
	private developerSession?: RoleSessionReference;
	private reviewerSession?: RoleSessionReference;
	private review?: Review;
	private selfCheck?: VerificationResult;
	private finalCheck?: VerificationResult;
	private readonly eventFailures: EventDeliveryFailure[] = [];

	private constructor(state: Run, request: CreateRunRequest, ports: KernelPorts, now: () => number) {
		this.state = state;
		this.ports = ports;
		this.now = now;
		this.checks = structuredClone(request.checks ?? []);
		this.maxRevisionCycles = state.maxRevisionCycles ?? 0;
		this.approvalTimeoutMs = request.approvalTimeoutMs ?? 30_000;
		this.budget = new BudgetController(request.budget ?? {});
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
			maxRevisionCycles: selection.workflow === "QUICK" || request.classification.risk === "R3" ? 0 : limit,
			verificationRepair: { mode: request.verificationRepairMode ?? "disabled", attempts: [] },
			reviewHistory: [],
			workerMeasurements: [],
			...(request.provenance ? { provenance: request.provenance } : {}),
			budget: new BudgetController(request.budget ?? {}).status,
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

	private async persist(patch: Partial<Run>, details: RuntimeEventDetail[]): Promise<void> {
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
			await this.finish(status, reason, []);
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
					if (result.role !== "Reviewer") throw new Error("Expected Reviewer result");
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
}
