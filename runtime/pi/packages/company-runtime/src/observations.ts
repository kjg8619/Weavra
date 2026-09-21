import type { RuntimeConfig } from "./config.ts";
import {
	type CheckResult,
	isCriteriaHandoff,
	isCriteriaReview,
	isTaskContract,
	type PolicyDecision,
	type ReviewRecord,
	type Run,
} from "./contracts.ts";

export interface ObservationAction {
	decision: PolicyDecision;
	status: "DENIED" | "PREPARED" | "SUCCEEDED" | "FAILED" | "INTERRUPTED";
}
export interface ObservationState {
	revision: number;
	runs: readonly Run[];
	actions: readonly ObservationAction[];
}
export interface RunView {
	run?: Run;
	state?: ObservationState;
	source: string;
	diagnostics?: readonly string[];
	report?: {
		changedFiles: string[];
		partialChanges: boolean;
		changesUnknown: boolean;
		error?: string;
		recommendedAction: string;
		diagnostics?: string[];
	};
}
export class ObservationInputError extends Error {}
export interface DecisionEntry {
	id: string;
	kind: string;
	summary: string;
	details: string[];
}

/** Display data cannot inject terminal controls, bidi controls or additional headings. Not secret detection. */
export function displayText(value: string, limit = 1600, multiline = false): string {
	const text = value.replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, (character) =>
		multiline && (character === "\n" || character === "\t")
			? character
			: `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
	return text.length > limit ? `${text.slice(0, limit)} [truncated]` : text;
}
function timestamp(value?: number): string {
	if (value === undefined) return "not recorded";
	const date = new Date(value);
	return Number.isNaN(date.getTime()) ? "out of range" : date.toISOString();
}
export function pageNumber(value = "1"): number {
	if (!/^[1-9]\d{0,5}$/.test(value)) throw new ObservationInputError("Expected a positive page/check number");
	return Number(value);
}
function page<T>(values: readonly T[], number: number, size = 10): { items: readonly T[]; label: string } {
	const count = Math.max(1, Math.ceil(values.length / size));
	if (number > count) throw new ObservationInputError(`Page out of range: 1..${count}`);
	return {
		items: values.slice((number - 1) * size, number * size),
		label: `Page ${number}/${count} (${values.length} records)`,
	};
}
export function reviewRecords(run: Run): readonly ReviewRecord[] {
	return run.reviewHistory ?? (run.review ? [run.review] : []);
}

/** Live reviews report Host-assigned criterion IDs; legacy reviews stay statement-based and are labelled. */
function reviewDetails(review: ReviewRecord): string[] {
	if (isCriteriaReview(review))
		return review.criteria.map(
			(item) => `${item.status}: ${item.criterionId}; evidence: ${item.evidenceRefs.join(", ")}`,
		);
	return [
		"(legacy review; statement-based requirements, no acceptance-criterion evidence)",
		...review.requirements.map(
			(item) => `${item.status}: ${item.requirement}; evidence: ${item.evidenceRefs.join(", ")}`,
		),
	];
}
export function decisionEntries(run: Run, actions: readonly ObservationAction[]): DecisionEntry[] {
	return [
		{
			id: `classification:${run.runId}`,
			kind: "classification",
			summary: `${run.workflow}/${run.risk}: ${run.classification.reason}`,
			details: [
				`Goal: ${run.goal}`,
				`Intent: ${run.classification.intent}; complexity: ${run.classification.complexity}`,
				`Execution contract: ${run.executionMode ?? "UNKNOWN (legacy; no permission inferred)"}`,
				`Reviewer revision limit: ${run.maxRevisionCycles ?? "not recorded"}`,
			],
		},
		...reviewRecords(run).map((review) => ({
			id: `review:${run.runId}:${review.revision}`,
			kind: "review",
			summary: `${review.result} at code revision ${review.revision}`,
			details: [
				`Diff: ${review.diffDigest}`,
				...reviewDetails(review),
				...review.issues.map(
					(issue) =>
						`${issue.severity} ${issue.file ?? "general"}: ${issue.description}; recommendation: ${issue.recommendation}`,
				),
			],
		})),
		...(run.approvals ?? []).map((record) => ({
			id: `approval:${run.runId}:${record.request.actionId}`,
			kind: "approval",
			summary: `${record.status}: ${record.request.operation} ${record.request.path}`,
			details: [
				`Expires: ${timestamp(record.request.expiresAt)}`,
				`Step: ${record.request.step.stepId}@${record.request.step.attempt}`,
				`Action digest: ${record.request.actionDigest}`,
				`Config digest: ${record.request.configDigest}`,
			],
		})),
		...actions
			.filter((action) => action.decision.runId === run.runId)
			.map((action) => ({
				id: `action:${run.runId}:${action.decision.actionId}`,
				kind: "policy",
				summary: `${action.decision.role} ${action.decision.risk}/${action.decision.decision}: ${action.status}`,
				details: [
					action.decision.reason,
					`Action digest: ${action.decision.actionDigest}`,
					`Config digest: ${action.decision.configDigest}`,
				],
			})),
		{
			id: `outcome:${run.runId}`,
			kind: "outcome",
			summary: `${run.status}/${run.phase}`,
			details: [
				`Error: ${run.lastError ?? "none recorded"}`,
				`Diff: ${run.workspace?.diffDigest ?? "not recorded"}`,
				`Changed files: ${run.workspace?.changedFiles.join(", ") || "none recorded"}`,
			],
		},
	];
}
function checkLine(check: CheckResult, index: number): string {
	return `${index + 1}. ${displayText(check.id)} | ${check.step ? `${check.step.stepId}@${check.step.attempt}` : "step not recorded"} | code revision ${check.revision} | ${check.kind}/${check.required ? "required" : "optional"} | ${check.status} | ${check.kind === "browser" ? "fresh browser assertion; no command exit status" : `exit ${check.exitCode ?? "not available"}`}`;
}
export function formatHistory(state: ObservationState, number = 1): string {
	const selected = page([...state.runs].reverse(), number);
	return [
		`Stored run history; project revision ${state.revision}. Not a live worker/diff check.`,
		selected.label,
		...selected.items.map(
			(run) =>
				`${displayText(run.runId)} | ${run.workflow}/${run.risk} | ${run.status}/${run.phase} | ${timestamp(run.updatedAt)}\n  ${displayText(run.goal, 300)}`,
		),
		"Use /state <full-run-id>; stored completion and PASS refer only to their recorded snapshot.",
	].join("\n");
}
export function formatConfiguration(config: RuntimeConfig): string {
	const output = [
		"Current config (not an active run's frozen configuration):",
		`Workflow: ${config.runtime.workflow}; COMPLEX execution unsupported`,
		`Reviewer revision limit: STANDARD ${config.agents.max_revision_cycles} (default 1, range 0..3); QUICK/R3 0`,
		`Verification repair: ${config.verification.repair.mode}; maximum one separate STANDARD/EDIT/R1 SELF_CHECK repair; cumulative budget retained`,
		`Worker timeout: ${config.agents.worker_timeout_ms}ms per role invocation (default 180000, range 10000..600000); cancel signals immediately, awaits cleanup`,
		...Object.entries(config.models.profiles).map(
			([profile, model]) =>
				`${profile}: ${displayText(model.provider)}/${displayText(model.model)}${["fast", "creative"].includes(profile) ? " (not auto-selected)" : ""}`,
		),
		`Allowed paths: ${config.files.allowed_paths.map((path) => displayText(path)).join(", ") || "none"}`,
		...config.verification.checks.map((check) =>
			check.kind === "browser"
				? `${displayText(check.id)}: browser/${check.required ? "required" : "optional"}; ${displayText(check.browser.documentIdentity)}; target=${displayText(check.browser.target.selector)}; assertion=${displayText(JSON.stringify(check.browser.assertion))}; fresh isolated capture; strict trust; no automatic repair; not an OS sandbox`
				: `${displayText(check.id)}: ${check.kind}/${check.required ? "required" : "optional"}; ${displayText(check.executable)} (${check.args.length} args); cwd=${displayText(check.cwd)}; timeout=${check.timeout_ms}ms; repairable normal exits=${check.repairable_exit_codes?.join(", ") || "none"}`,
		),
		"Required checks, project trust and clean Git remain mandatory. No resume, fallback or approval bypass.",
	].join("\n");
	return displayText(output, 32000, true);
}

/** Only renders snapshots. Never reads files, resolves auth, executes checks or changes state. */
export function formatRunView(
	command: "workflow" | "team" | "state" | "risk",
	view: RunView,
	detail = "summary",
	number = 1,
): string {
	const run = view.run;
	if (!run)
		return `Weavra: state missing or no run recorded.\nSource: ${displayText(view.source)}\n${view.report?.error ? `Error: ${displayText(view.report.error)}` : "Use /workflow config or /workflow run <goal>."}`;
	const active = ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run.status);
	const local = view.source.startsWith("live Kernel");
	const actions = view.state?.actions.filter((action) => action.decision.runId === run.runId) ?? [];
	const lines = [
		`Source: ${displayText(view.source)}; no live filesystem/check refresh`,
		`Run: ${displayText(run.runId)} | recorded ${timestamp(run.updatedAt)} | revision ${run.revision}`,
		`Workflow: ${run.workflow} | Reviewer: ${run.workflow === "QUICK" ? "not required" : (run.review?.result ?? "not performed")}`,
		`Status: ${run.status} | Phase: ${run.phase} | Risk: ${run.risk}`,
		`Execution contract: ${run.executionMode ?? "UNKNOWN (legacy; no permission inferred)"}`,
		`Project instruction file: ${run.projectInstruction === undefined ? "UNKNOWN (legacy)" : run.projectInstruction === null ? "none" : `${displayText(run.projectInstruction.path, 4096)} | ${run.projectInstruction.digest} | ${run.projectInstruction.bytes} bytes (frozen context only)`}`,
		`Agent: ${run.activeAgents.join(", ") || (run.workflow === "QUICK" ? "Executor (idle)" : "idle")}`,
		`Review: ${run.workflow === "QUICK" ? "not required" : (run.review?.result ?? "not performed")}`,
		...(run.risk === "R2" ? ["Review enforcement: REQUIRED (STANDARD/R2); no self-approval"] : []),
		...(run.risk === "R3"
			? [
					`Human approval: ${run.approvals?.at(-1)?.status ?? "not requested"} | Target: ${displayText(run.r3Scope?.targetPath ?? "unsupported")}`,
					"Independent Reviewer: REQUIRED (STANDARD/R3)",
				]
			: []),
		...(view.diagnostics ?? []).map((item) => `Warning: ${displayText(item)}`),
		...(view.report?.diagnostics ?? []).map((item) => `Warning: ${displayText(item)}`),
	];
	if (detail === "checks") {
		const selected = page(run.verification, number);
		lines.push(
			selected.label,
			...selected.items.map((check, index) => checkLine(check, (number - 1) * 10 + index)),
			`Detail: /state check <number> ${displayText(run.runId)}`,
		);
	} else if (detail === "check") {
		const check = run.verification[number - 1];
		if (!check) throw new ObservationInputError("Check number out of range");
		lines.push(
			checkLine(check, number - 1),
			`Started: ${timestamp(check.startedAt)}; finished: ${timestamp(check.finishedAt)}`,
			`Reason: ${displayText(check.reason)}`,
			`Diff: ${displayText(check.diffDigest)}`,
			`Evidence: ${check.evidenceRefs.map((ref) => displayText(ref)).join(", ")}`,
			...(check.browser
				? [
						`Browser registration: ${displayText(check.browser.registrationDigest)}`,
						`Document: ${displayText(check.browser.documentIdentity)}; digest: ${displayText(check.browser.documentDigest)}`,
						`Assertion: ${displayText(JSON.stringify(check.browser.assertion))}; target: ${displayText(JSON.stringify(check.browser.target))}`,
						`Capture: ${displayText(check.browser.captureId)} at ${timestamp(check.browser.capturedAt)}; ${check.browser.isolation}; cleanup ${check.browser.cleanup}`,
						"Recorded capture evidence only; not a live page status or an OS sandbox claim.",
					]
				: []),
			`stdout:\n${displayText(check.stdout ?? "[not recorded]", 18000, true)}`,
			`stderr:\n${displayText(check.stderr ?? "[not recorded]", 18000, true)}`,
		);
	} else if (detail === "decisions") {
		const selected = page(decisionEntries(run, actions), number);
		lines.push(
			"Operational decisions (not inferred technical ADRs):",
			selected.label,
			...selected.items.flatMap((item) => [
				`${displayText(item.id)} | ${displayText(item.summary)}`,
				...item.details.slice(0, 10).map((text) => `  ${displayText(text)}`),
				...(item.details.length > 10 ? [`  [${item.details.length - 10} more details; /state export]`] : []),
			]),
		);
	} else if (detail === "review") {
		const reviews = reviewRecords(run);
		lines.push(`Review history: ${reviews.length} recorded result(s)`);
		for (const review of reviews)
			lines.push(
				`${review.result} | code revision ${review.revision} | diff ${displayText(review.diffDigest)}`,
				...(isCriteriaReview(review)
					? [
							`${review.criteria.length} acceptance criteria (first 10 shown)`,
							...review.criteria
								.slice(0, 10)
								.map(
									(item) =>
										`  ${item.status}: ${displayText(item.criterionId)}; evidence ${item.evidenceRefs.map((ref) => displayText(ref)).join(", ")}`,
								),
						]
					: [
							"Legacy review: statement-based requirements, no acceptance-criterion evidence",
							`${review.requirements.length} requirements (first 10 shown)`,
							...review.requirements
								.slice(0, 10)
								.map(
									(item) =>
										`  ${item.status}: ${displayText(item.requirement)}; evidence ${item.evidenceRefs.map((ref) => displayText(ref)).join(", ")}`,
								),
						]),
				...review.issues
					.slice(0, 10)
					.map(
						(item) =>
							`  ${item.severity} ${displayText(item.file ?? "general")}: ${displayText(item.description)}; ${displayText(item.recommendation)}`,
					),
			);
	} else if (command === "team") {
		const roles =
			run.workflow === "QUICK"
				? ["Executor"]
				: run.workflow === "STANDARD"
					? ["Developer", "Reviewer"]
					: ["Lead", "Developer", "Reviewer"];
		for (const role of roles) {
			const sessions = run.roleSessionRefs.filter((ref) => ref.role === role);
			const last = sessions.at(-1);
			lines.push(
				`${role} (${role === "Reviewer" || role === "Lead" ? "reasoning" : "coding"}): ${run.activeAgents.includes(role as Run["activeAgents"][number]) ? (local ? "active" : "recorded active; liveness unconfirmed") : active ? (last ? "idle" : "waiting") : "inactive"}; ${sessions.length} session(s)`,
				...(last ? [`  ${displayText(last.sessionId)} → ${displayText(last.sessionFile)}`] : []),
			);
		}
		lines.push("Session references only; transcript/usage remain owned by Pi.");
	} else if (command === "risk") {
		lines.push(
			`Classification: ${displayText(run.classification.reason)}`,
			`Policy actions: ${actions.length} recorded; ${actions.filter((action) => action.decision.decision !== "ALLOW").length} denied`,
			...actions
				.filter((action) => action.decision.decision !== "ALLOW")
				.slice(-5)
				.map(
					(action) =>
						`${action.decision.risk}/${action.decision.decision}: ${displayText(action.decision.reason)}`,
				),
		);
		for (const record of run.approvals ?? [])
			lines.push(
				`Approval ${displayText(record.request.actionId)}: ${record.status}; expires ${timestamp(record.request.expiresAt)}; ${displayText(record.request.path)}`,
			);
		lines.push(
			"Initial run risk and action risk are distinct. R2 binding, human consent and Reviewer PASS do not replace each other.",
		);
	} else {
		lines.push(
			`Goal: ${displayText(run.goal)}`,
			`Step: ${run.currentStep ? `${run.currentStep.stepId}@${run.currentStep.attempt}` : "not started"}; code revision ${run.revisionCycle}; Reviewer revisions ${run.revisionCycle - (run.verificationRepair?.attempts.length ?? 0)}/${run.maxRevisionCycles ?? "limit not recorded"}`,
			`Verification repair: ${run.verificationRepair?.mode ?? "UNKNOWN (legacy)"}; used ${run.verificationRepair?.attempts.length ?? 0}/1 (separate from Reviewer revisions)`,
			`Next steps: ${run.next.join(", ") || "none"}`,
		);
		if (command === "state") {
			for (const task of run.tasks.slice(0, 10))
				if (isTaskContract(task))
					lines.push(
						`Task ${displayText(task.id)}: ${task.status}; ${task.acceptanceCriteria.length} acceptance criteria (Host-assigned IDs)`,
						...task.acceptanceCriteria.map((criterion) => {
							const result = (run.acceptance ?? []).find((entry) => entry.criterionId === criterion.id);
							return (
								`  ${criterion.id}: ${displayText(criterion.statement)} ` +
								`[checks: ${criterion.verification.checkIds.join(", ") || "none"}; review: ${criterion.verification.reviewRequired ? "required" : "not required"}]` +
								(result
									? ` -> ${result.status} (revision ${result.revision}; evidence ${result.evidenceRefs.map((ref) => displayText(ref)).join(", ") || "none recorded"})`
									: " -> no recorded result")
							);
						}),
					);
				else
					lines.push(
						`Task ${displayText(task.id)}: ${task.status}; Acceptance criteria: UNKNOWN (legacy)`,
						...task.requirements
							.slice(0, 10)
							.map((requirement) => `  Legacy requirement: ${displayText(requirement)}`),
					);
			lines.push(
				`Task Contract digest: ${run.taskContractDigest ? displayText(run.taskContractDigest) : "UNKNOWN (legacy; no contract digest)"}`,
			);
			const handoff = run.executorResult ?? run.handoff;
			if (handoff)
				lines.push(
					`${handoff.role} result (not approval): ${displayText(handoff.summary)}`,
					`Known risks: ${handoff.known_risks.map((item) => displayText(item)).join("; ") || "none reported"}`,
					`Unresolved: ${handoff.unresolved.map((item) => displayText(item)).join("; ") || "none reported"}`,
				);
			if (run.executorResult)
				lines.push(
					...(isCriteriaHandoff(run.executorResult)
						? run.executorResult.criteria.map(
								(item) =>
									`  ${item.status}: ${displayText(item.criterionId)}; ${displayText(item.explanation)}`,
							)
						: [
								"  Legacy Executor result: statement-based requirements, no acceptance-criterion evidence",
								...run.executorResult.requirements
									.slice(0, 10)
									.map((item) => `  ${item.status}: ${displayText(item.explanation)}`),
							]),
				);
		}
		lines.push(
			`Diff: ${displayText(run.workspace?.diffDigest ?? "not collected")}`,
			`Changed files: ${(view.report?.changedFiles.length ? view.report.changedFiles : (run.workspace?.changedFiles ?? [])).map((path) => displayText(path)).join(", ") || "none recorded"}`,
			`Verification: ${
				run.verification.length
					? run.verification
							.slice(-10)
							.map((check) => `${displayText(check.id)}@${check.revision}: ${check.status}`)
							.join("; ")
					: "not performed"
			}`,
		);
	}
	lines.push(
		`Partial changes exist: ${active ? "possible; active step is not a live diff snapshot" : view.report?.partialChanges || (run.status !== "COMPLETED" && !!run.workspace?.changedFiles.length) ? "yes" : "no"}${view.report?.changesUnknown ? " (collection incomplete)" : ""}`,
		`Error: ${displayText(view.report?.error ?? run.lastError ?? "none")}`,
		`Next: ${displayText(active ? (local ? "Use /workflow status or /workflow cancel; parent Esc does not cancel workers" : "Inspect the owning Pi session to cancel; this stored snapshot has no local worker and is not automatically recovered") : (view.report?.recommendedAction ?? "Inspect stored evidence and current git diff; no automatic resume"))}`,
	);
	const output = lines.join("\n");
	return output.length > 32000
		? `${output.slice(0, 32000)}\n[truncated; use a narrower view or /state export]`
		: output;
}
