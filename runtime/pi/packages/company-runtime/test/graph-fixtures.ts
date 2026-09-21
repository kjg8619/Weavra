import type { ApprovalRecord, CheckResult, ReviewRecord, Run } from "../src/contracts.ts";
import { testContract } from "./fixture-contract.ts";

/** Shape-valid persisted fixtures; actual Kernel/SDK behavior is covered by the faux integration suite. */
export function graphRun(workflow: "QUICK" | "STANDARD" = "STANDARD", risk: Run["risk"] = "R1", revision = 0): Run {
	const reviews: ReviewRecord[] =
		workflow === "QUICK"
			? []
			: Array.from({ length: revision + 1 }, (_, index) => ({
					runId: "run",
					revision: index,
					role: "Reviewer",
					task: "task",
					result: index < revision ? "REVISE" : "PASS",
					issues: [],
					criteria: [{ criterionId: "AC-001", status: "MET", evidenceRefs: ["diff"] }],
					evidenceRefs: ["diff"],
					diffDigest: `digest-${index}`,
				}));
	const check = (stepId: "self-check" | "test", codeRevision: number): CheckResult => ({
		id: "check",
		runId: "run",
		revision: codeRevision,
		kind: "test",
		step: { stepId, attempt: codeRevision + 1 },
		status: "PASS",
		required: true,
		exitCode: 0,
		reason: "Executed",
		evidenceRefs: ["check-ref"],
		diffDigest: `digest-${codeRevision}`,
	});
	const handoff = {
		runId: "run",
		revision,
		task: "task",
		changed_files: risk === "R0" ? [] : [risk === "R3" ? "src/obsolete.ts" : "src/app.ts"],
		summary: "Done",
		assumptions: [],
		tests_run: [],
		known_risks: [],
		unresolved: [],
	};
	return {
		schemaVersion: 1,
		revision: 1,
		eventSequence: 1,
		runId: "run",
		goal: "Goal",
		workflow,
		risk,
		classification: { intent: "bugfix", complexity: workflow, risk, confidence: null, reason: "Fixture" },
		currentTask: "task",
		tasks: [testContract("Goal", { taskId: "task", statements: ["Goal"], workflow })],
		status: "COMPLETED",
		phase: "COMPLETE",
		currentStep: { stepId: "complete", attempt: revision + 1 },
		activeAgents: [],
		completed: ["task"],
		next: [],
		roleSessionRefs: [],
		revisionCycle: revision,
		maxRevisionCycles: workflow === "QUICK" || risk === "R3" ? 0 : 3,
		...(workflow === "QUICK"
			? {
					quickScope: { risk: risk === "R0" ? "R0" : "R1", targetPath: risk === "R0" ? null : "src/app.ts" },
					executorResult: {
						...handoff,
						role: "Executor",
						criteria: [{ criterionId: "AC-001", status: "MET", explanation: "Done" }],
					},
				}
			: { handoff: { ...handoff, role: "Developer" }, review: reviews.at(-1), reviewHistory: reviews }),
		workspace: {
			diffDigest: `digest-${revision}`,
			safe: true,
			changedFiles: handoff.changed_files,
			evidenceRefs: ["diff"],
		},
		verification: [
			...Array.from({ length: revision + 1 }, (_, index) => check("self-check", index)),
			check("test", revision),
		],
		...(risk === "R3"
			? { r3Scope: { runId: "run", targetPath: "src/obsolete.ts" }, approvals: [graphApproval("CONSUMED")] }
			: {}),
		lastError: null,
		createdAt: 1000,
		updatedAt: 2000,
	};
}
export function graphApproval(status: ApprovalRecord["status"]): ApprovalRecord {
	return {
		status,
		request: {
			runId: "run",
			actionId: "delete-once",
			actionDigest: "action",
			configDigest: "config",
			reason: "Delete one file",
			role: "Developer",
			operation: "delete-file",
			path: "src/obsolete.ts",
			preconditionDigest: "before",
			bytes: 10,
			step: { stepId: "implement", attempt: 1 },
			revision: 0,
			expiresAt: 10000,
		},
	};
}
export function implementingGraphRun(risk: Run["risk"] = "R1"): Run {
	const run = graphRun("STANDARD", risk);
	run.status = "RUNNING";
	run.phase = "IMPLEMENT";
	run.currentStep = { stepId: "implement", attempt: 1 };
	run.tasks[0].status = "inProgress";
	run.activeAgents = ["Developer"];
	run.completed = [];
	run.next = ["implement"];
	run.verification = [];
	run.reviewHistory = [];
	delete run.review;
	delete run.handoff;
	if (risk === "R3") run.approvals = [];
	return run;
}
