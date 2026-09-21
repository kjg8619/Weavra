import { validBrowserCheckEvidence } from "./browser-evidence.ts";
import {
	type CheckResult,
	QUICK_STEP_IDS,
	type Review,
	type ReviewRecord,
	type Role,
	type Run,
	RunSchema,
	STANDARD_STEP_IDS,
	STANDARD_STEP_PHASES,
	type StepId,
	validateContract,
} from "./contracts.ts";

export type GraphNodeStatus =
	| "pending"
	| "running"
	| "passed"
	| "failed"
	| "blocked"
	| "cancelled"
	| "skipped"
	| "waiting_approval"
	| "revised"
	| "unknown";
export interface GraphNode {
	id: string;
	kind: "preflight" | "agent" | "verification" | "review" | "completion" | "approval" | "mutation";
	label: string;
	status: GraphNodeStatus;
	/** For approval/mutation this is the owning Kernel step, not a new step. */
	stepId?: StepId;
	attempt?: number;
	role?: Role;
	parentId?: string;
	verdict?: Review["result"];
	approvalStatus?: NonNullable<Run["approvals"]>[number]["status"];
	checks?: Array<Pick<CheckResult, "id" | "kind" | "status" | "required" | "exitCode">>;
	detail?: string;
}
export interface GraphEdge {
	from: string;
	to: string;
	/** Relations/conditions, not commands or a claim that the edge was executed. */
	kind: "sequence" | "pass" | "revise" | "next_attempt" | "contains" | "approved";
}
export interface GraphProjection {
	runId: string;
	workflow: Run["workflow"];
	risk: Run["risk"];
	/** The source status is retained verbatim, not recomputed from node colors. */
	status: Run["status"];
	stateRevision: number;
	recordedAt: number;
	nodes: GraphNode[];
	edges: GraphEdge[];
	diagnostics: string[];
}
export class GraphProjectionError extends Error {}

function requireGraph(condition: boolean, reason: string): void {
	if (!condition) throw new GraphProjectionError(`Graph unavailable: ${reason}`);
}

/** Pure, on-demand view of one authoritative Run. No events, clocks, I/O, caches or execution ports. */
export function projectRunGraph(value: unknown): GraphProjection {
	let run: Run;
	try {
		run = validateContract(RunSchema, value);
	} catch {
		throw new GraphProjectionError("Graph unavailable: invalid or incomplete Run snapshot");
	}
	const repairs = run.verificationRepair?.attempts ?? [];
	requireGraph(
		run.revisionCycle <= (run.maxRevisionCycles ?? 3) + repairs.length &&
			run.verification.length <= 1000 &&
			(run.reviewHistory?.length ?? 0) <= 4 &&
			(run.approvals?.length ?? 0) <= 1,
		"snapshot exceeds V0.2A projection limits",
	);
	requireGraph(
		run.tasks.some((task) => task.id === run.currentTask) && run.classification.risk === run.risk,
		"inconsistent run identity/risk",
	);
	const attempt = run.revisionCycle + 1;
	const steps: readonly StepId[] = run.workflow === "QUICK" ? QUICK_STEP_IDS : STANDARD_STEP_IDS;
	const current = run.currentStep;
	requireGraph(
		current
			? current.attempt === attempt &&
					steps.includes(current.stepId) &&
					STANDARD_STEP_PHASES[current.stepId] === run.phase
			: run.phase === "PREFLIGHT" && attempt === 1,
		"inconsistent step/phase/attempt",
	);
	requireGraph(run.status !== "CREATED" || !current, "CREATED snapshot has an execution step");
	requireGraph(
		run.status !== "COMPLETED" || current?.stepId === "complete",
		"COMPLETED snapshot has no completion step",
	);
	requireGraph(
		run.workflow !== "QUICK" || (attempt === 1 && ["R0", "R1"].includes(run.risk)),
		"unsupported QUICK revision/risk",
	);
	requireGraph(run.workflow === "QUICK" ? !run.handoff : !run.executorResult, "implementation role/workflow mismatch");
	requireGraph(
		!run.quickScope || (run.workflow === "QUICK" && run.quickScope.risk === run.risk),
		"QUICK scope/workflow mismatch",
	);
	requireGraph(run.risk === "R3" || (!run.r3Scope && !run.approvals?.length), "approval metadata outside R3");
	const terminal = !["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run.status);
	const stopped: GraphNodeStatus =
		run.status === "CANCELLED"
			? "cancelled"
			: run.status === "FAILED"
				? "failed"
				: run.status === "BLOCKED"
					? "blocked"
					: "unknown";
	const graph: GraphProjection = {
		runId: run.runId,
		workflow: run.workflow,
		risk: run.risk,
		status: run.status,
		stateRevision: run.revision,
		recordedAt: run.updatedAt,
		nodes: [],
		edges: [],
		diagnostics: [],
	};
	if (run.workflow === "COMPLEX") {
		graph.nodes.push({
			id: "preflight",
			kind: "preflight",
			label: "Unsupported COMPLEX",
			status: terminal ? stopped : "unknown",
		});
		graph.diagnostics.push("COMPLEX has no supported execution graph; no Planner/Lead/scheduler is inferred.");
		return graph;
	}
	const reviews = new Map<number, ReviewRecord>();
	for (const review of run.reviewHistory ?? []) {
		requireGraph(!reviews.has(review.revision), "duplicate review attempt");
		reviews.set(review.revision, review);
	}
	if (run.review) {
		const prior = reviews.get(run.review.revision);
		requireGraph(
			!prior || (prior.result === run.review.result && prior.diffDigest === run.review.diffDigest),
			"conflicting review records",
		);
		reviews.set(run.review.revision, run.review);
	}
	for (const review of reviews.values()) {
		requireGraph(
			run.workflow === "STANDARD" &&
				review.runId === run.runId &&
				review.task === run.currentTask &&
				review.revision <= run.revisionCycle,
			"review identity/attempt mismatch",
		);
		requireGraph(
			review.revision < run.revisionCycle
				? review.result === "REVISE"
				: !!current && steps.indexOf(current.stepId) >= steps.indexOf("review"),
			"review conflicts with recorded progression",
		);
	}
	for (const result of [run.handoff, run.executorResult])
		if (result) {
			requireGraph(
				result.runId === run.runId && result.task === run.currentTask && result.revision <= run.revisionCycle,
				"implementation result identity/attempt mismatch",
			);
		}
	const checks = new Map<string, CheckResult[]>();
	for (const check of run.verification) {
		requireGraph(
			check.runId === run.runId && check.revision <= run.revisionCycle,
			"check identity/revision mismatch",
		);
		if (!check.step) continue;
		requireGraph(
			["self-check", "test"].includes(check.step.stepId) && check.step.attempt === check.revision + 1,
			"check step/attempt mismatch",
		);
		requireGraph(
			!!current &&
				(check.revision < run.revisionCycle || steps.indexOf(check.step.stepId) <= steps.indexOf(current.stepId)),
			"check belongs to an unvisited step",
		);
		requireGraph(
			check.revision === run.revisionCycle || check.step.stepId === "self-check",
			"final TEST recorded before another attempt",
		);
		requireGraph(
			check.kind === "browser"
				? check.exitCode === null &&
						check.failureKind === undefined &&
						check.sandbox === undefined &&
						(check.browser === undefined || validBrowserCheckEvidence(check))
				: check.browser === undefined,
			"mixed browser and command evidence",
		);
		requireGraph(
			check.status !== "PASS" ||
				(check.kind === "browser"
					? validBrowserCheckEvidence(check)
					: check.exitCode === 0 && check.evidenceRefs.length > 0),
			"PASS check lacks typed verifier evidence",
		);
		const key = `${check.step.stepId}:${check.step.attempt}`;
		const group = checks.get(key) ?? [];
		requireGraph(!group.some((item) => item.id === check.id), "duplicate check in step attempt");
		group.push(check);
		checks.set(key, group);
	}
	for (const repair of repairs) {
		const parentChecks = checks.get(`self-check:${repair.fromStep.attempt}`) ?? [];
		const failed = parentChecks.filter((check) => check.status !== "PASS");
		requireGraph(
			run.verificationRepair?.mode === "self-check-once" &&
				run.workflow === "STANDARD" &&
				run.executionMode === "EDIT" &&
				run.risk === "R1" &&
				repair.toRevision === repair.fromRevision + 1 &&
				repair.toRevision <= run.revisionCycle &&
				repair.fromStep.attempt === repair.fromRevision + 1 &&
				repair.toStep.attempt === repair.toRevision + 1 &&
				repair.taskContractDigest === run.taskContractDigest &&
				!reviews.has(repair.fromRevision) &&
				failed.length === repair.failedCheckIds.length &&
				failed.every(
					(check) =>
						repair.failedCheckIds.includes(check.id) &&
						check.status === "FAIL" &&
						check.kind !== "browser" &&
						check.failureKind === "COMMAND_NONZERO" &&
						check.diffDigest === repair.diffDigest &&
						check.evidenceRefs.length > 0 &&
						check.evidenceRefs.every((ref) => repair.evidenceRefs.includes(ref)),
				),
			"inconsistent verification repair parent",
		);
	}
	if (run.verification.some((check) => !check.step))
		graph.diagnostics.push("Checks without step metadata are not assigned to SELF_CHECK or TEST.");
	if (!current)
		graph.nodes.push({
			id: "preflight",
			kind: "preflight",
			label: "Preflight",
			status: terminal ? stopped : "pending",
			...(run.lastError ? { detail: run.lastError } : {}),
		});
	let previous: GraphNode | undefined = graph.nodes[0];
	for (let number = 1; number <= attempt; number++) {
		// A repair parent stops at failed SELF_CHECK; only actual Reviewer REVISE paths contain a review.
		const repairParent = repairs.some((repair) => repair.fromStep.attempt === number);
		const selected = number < attempt ? STANDARD_STEP_IDS.slice(0, repairParent ? 2 : 3) : steps;
		for (const step of selected) {
			const id = `${step}:${number}`;
			const review = reviews.get(number - 1);
			const results = [...(checks.get(id) ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
			const visited = !!current && (number < attempt || steps.indexOf(step) <= steps.indexOf(current.stepId));
			let status: GraphNodeStatus = terminal ? "skipped" : "pending";
			if (visited) {
				status = "unknown";
				if (
					step === "implement" &&
					((run.handoff ?? run.executorResult)?.revision === number - 1 ||
						review ||
						checks.has(`self-check:${number}`))
				)
					status = "passed";
				if (step === "review" && review)
					status = review.result === "PASS" ? "passed" : review.result === "REVISE" ? "revised" : "blocked";
				if (results.length) {
					status = results.some((check) => check.status === "FAIL")
						? "failed"
						: results.some((check) => check.required && check.status !== "PASS")
							? "blocked"
							: results.some((check) => check.status === "PASS")
								? "passed"
								: "skipped";
				}
				if (step === "complete" && run.status === "COMPLETED") status = "passed";
			}
			const isCurrent = number === attempt && current?.stepId === step;
			if (isCurrent && run.status !== "COMPLETED") {
				status = terminal
					? status === "failed" && run.status === "BLOCKED"
						? "failed"
						: stopped
					: run.status === "WAITING_APPROVAL"
						? "waiting_approval"
						: "running";
			}
			const role =
				step === "implement"
					? run.workflow === "QUICK"
						? "Executor"
						: "Developer"
					: step === "review"
						? "Reviewer"
						: undefined;
			const label =
				step === "implement"
					? run.workflow === "QUICK"
						? "Implement"
						: "Developer"
					: step === "self-check"
						? "Self Check"
						: step === "review"
							? "Reviewer"
							: step === "test"
								? "Test"
								: "Complete";
			const node: GraphNode = {
				id,
				kind:
					step === "implement"
						? "agent"
						: step === "review"
							? "review"
							: step === "complete"
								? "completion"
								: "verification",
				label: `${label} #${number}`,
				status,
				stepId: step,
				attempt: number,
				...(role ? { role } : {}),
				...(step === "review" && review ? { verdict: review.result } : {}),
				...(results.length
					? {
							checks: results.map(({ id, kind, status, required, exitCode }) => ({
								id,
								kind,
								status,
								required,
								exitCode,
							})),
						}
					: {}),
				...(isCurrent && run.lastError ? { detail: run.lastError } : {}),
			};
			graph.nodes.push(node);
			if (status === "unknown")
				graph.diagnostics.push(`${id}: outcome not retained or execution unconfirmed; no PASS inferred.`);
			if (previous)
				graph.edges.push({
					from: previous.id,
					to: id,
					kind:
						previous.stepId === "review"
							? step === "implement"
								? previous.verdict === "REVISE"
									? "revise"
									: "next_attempt"
								: "pass"
							: previous.stepId === "self-check" && step === "implement"
								? "next_attempt"
								: "sequence",
				});
			previous = node;
			if (step === "implement" && run.risk === "R3") {
				requireGraph(attempt === 1 && run.r3Scope?.runId === run.runId, "missing/unsupported R3 scope");
				requireGraph(
					run.status !== "WAITING_APPROVAL" || run.approvals?.[0]?.status === "PENDING",
					"WAITING_APPROVAL has no pending approval",
				);
				const record = run.approvals?.[0];
				if (record)
					requireGraph(
						record.request.runId === run.runId &&
							record.request.path === run.r3Scope?.targetPath &&
							record.request.step.stepId === "implement" &&
							record.request.step.attempt === number &&
							record.request.revision === number - 1,
						"approval identity/step mismatch",
					);
				const approvalStatus: GraphNodeStatus = !record
					? terminal
						? "skipped"
						: "pending"
					: record.status === "PENDING"
						? "waiting_approval"
						: ["APPROVED", "CONSUMED"].includes(record.status)
							? "passed"
							: ["DENIED", "EXPIRED"].includes(record.status)
								? "blocked"
								: record.status === "CANCELLED"
									? "cancelled"
									: "unknown";
				const mutationStatus: GraphNodeStatus =
					record?.status === "CONSUMED"
						? "passed"
						: record && ["DENIED", "EXPIRED"].includes(record.status)
							? "skipped"
							: record && ["CANCELLED", "INTERRUPTED"].includes(record.status)
								? "unknown"
								: record?.status === "APPROVED" && terminal
									? "unknown"
									: terminal
										? "skipped"
										: "pending";
				graph.nodes.push(
					{
						id: `approval:${number}`,
						kind: "approval",
						label: `Human Approval #${number}`,
						status: approvalStatus,
						stepId: "implement",
						attempt: number,
						parentId: id,
						...(record ? { approvalStatus: record.status } : {}),
					},
					{
						id: `mutation:${number}`,
						kind: "mutation",
						label: `Mutation #${number}`,
						status: mutationStatus,
						stepId: "implement",
						attempt: number,
						parentId: id,
						detail:
							mutationStatus === "passed"
								? "CONSUMED records the scoped deletion; later failure does not roll it back."
								: mutationStatus === "unknown"
									? "No consumption record; effect is unconfirmed. Inspect /state decisions; no rollback is inferred."
									: "Approval is not proof of mutation; only CONSUMED confirms it here.",
					},
				);
				graph.edges.push(
					{ from: id, to: `approval:${number}`, kind: "contains" },
					{ from: `approval:${number}`, to: `mutation:${number}`, kind: "approved" },
				);
				graph.diagnostics.push(
					"Approval/Mutation are projection details inside IMPLEMENT, not independent Kernel steps.",
				);
			}
		}
	}
	if (run.status === "WAITING_APPROVAL")
		requireGraph(run.risk === "R3" && current?.stepId === "implement", "unsupported approval phase");
	const completion = graph.nodes.find((node) => node.id === `complete:${attempt}`);
	if (
		run.status === "COMPLETED" &&
		graph.nodes.some((node) => node.attempt === attempt && node !== completion && node.status !== "passed")
	) {
		if (completion) completion.status = "unknown";
		graph.diagnostics.push(
			"Stored COMPLETED is retained, but incomplete/conflicting step evidence prevents a confirmed completion node.",
		);
	}
	return graph;
}

function text(value: string, limit = 1600): string {
	const escaped = value.replace(
		/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g,
		(char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
	);
	return escaped.length > limit ? `${escaped.slice(0, limit)} [truncated]` : escaped;
}

/** ASCII adjacency view. Edges describe relations/conditions, never executable controls. */
export function renderGraphText(graph: GraphProjection): string {
	const labels: Record<GraphNodeStatus, string> = {
		pending: "PENDING",
		running: "RUNNING",
		passed: "PASS",
		failed: "FAIL",
		blocked: "BLOCKED",
		cancelled: "CANCELLED",
		skipped: "SKIPPED",
		waiting_approval: "WAITING_APPROVAL",
		revised: "REVISE",
		unknown: "UNKNOWN",
	};
	const lines = [
		"Weavra Graph",
		`Run: ${text(graph.runId)}`,
		`${graph.workflow} / ${graph.risk} / ${graph.status}`,
		`Snapshot revision: ${graph.stateRevision}; recorded timestamp: ${graph.recordedAt}`,
		"Read-only snapshot, not live Git/check verification. Edges are relations/conditions, not commands.",
	];
	for (const node of graph.nodes) {
		lines.push(
			`[${text(node.label)}] ${labels[node.status]}${node.verdict ? ` (review ${node.verdict})` : ""}${node.approvalStatus ? ` (${node.approvalStatus})` : ""}${node.parentId ? ` [inside ${text(node.parentId)}]` : ""}`,
		);
		if (node.detail) lines.push(`  ${text(node.detail)}`);
		for (const check of node.checks ?? [])
			lines.push(
				`  Check ${text(check.id, 200)}: ${check.status}, ${check.required ? "required" : "optional"}, ${check.kind === "browser" ? "browser assertion" : `exit ${check.exitCode ?? "none"}`}`,
			);
		for (const edge of graph.edges.filter((edge) => edge.from === node.id))
			lines.push(
				`  -- ${edge.kind === "revise" ? "REVISE" : edge.kind === "pass" ? "PASS required" : edge.kind === "approved" ? "approval required" : edge.kind} --> [${text(graph.nodes.find((target) => target.id === edge.to)?.label ?? edge.to)}]`,
			);
	}
	lines.push(...graph.diagnostics.map((message) => `Warning: ${text(message)}`));
	const output = lines.join("\n");
	return output.length > 32000 ? `${output.slice(0, 32000)}\n[truncated; inspect narrower /state views]` : output;
}
