import { describe, expect, it } from "vitest";
import { isTaskContract, type Run, type TaskAdmission, type TaskRunMetadata } from "../src/contracts.ts";
import { projectHostEvidenceDetails } from "../src/evidence-details.ts";
import type {
	HostEvidenceCategory,
	HostEvidenceCursor,
	HostEvidenceDetailsPage,
	HostEvidenceDetailsUnavailable,
} from "../src/host-control-protocol.ts";
import { complexHarness, complexPlanFor, driveComplex, FakeFiles, takeConsumerIssues } from "./complex-fixture.ts";
import { graphRun, implementingGraphRun } from "./graph-fixtures.ts";

const digest = (character: string) => character.repeat(64);
const taskBinding: TaskRunMetadata = {
	binding: {
		taskId: "11111111-1111-4111-8111-111111111111",
		environmentId: "environment",
		projectId: "project",
		threadId: "thread",
		checkout: {
			canonicalCwd: "/project",
			repositoryRoot: "/project",
			headCommit: "a".repeat(40),
			workspaceDigest: `sha256:${digest("a")}`,
		},
		executionId: "22222222-2222-4222-8222-222222222222",
		packetVersion: 1,
		advisoryDigest: `sha256:${digest("b")}`,
		symptomVerification: {
			criterionId: "AC-001",
			checkId: "check",
			registrationDigest: `sha256:${digest("c")}`,
		},
	},
	previewDigest: `sha256:${digest("d")}`,
	configDigest: `sha256:${digest("e")}`,
	confirmedProjectRevision: 0,
	admittedProjectRevision: 1,
};

function boundRun(base: Run = graphRun()): Run {
	return {
		...base,
		runId: "bound-run",
		taskBinding,
		taskContractDigest: `sha256:${digest("9")}`,
		workspace: {
			diffDigest: digest("f"),
			changedFiles: [],
			evidenceRefs: [],
			safe: true,
			changedLines: 0,
		},
	};
}

function project(
	run: Run,
	cursor: HostEvidenceCursor,
	limit = 65_536,
): HostEvidenceDetailsPage | HostEvidenceDetailsUnavailable {
	return projectHostEvidenceDetails({
		run,
		source: "inline",
		writerPresent: false,
		cursor,
		fits: (data) => Buffer.byteLength(JSON.stringify({ envelope: "x".repeat(256), data })) + 1 <= limit,
	});
}

function collect(run: Run, category: HostEvidenceCategory, limit = 65_536) {
	const pages: HostEvidenceDetailsPage[] = [];
	let cursor: HostEvidenceCursor | null = { category, index: 0 };
	while (cursor) {
		const page = project(run, cursor, limit);
		if (page.kind !== "evidence-details") throw new Error(`Unavailable ${page.reason}`);
		pages.push(page);
		cursor = page.nextCursor;
	}
	return pages;
}

describe("bounded canonical evidence detail projection", () => {
	it.each(["inline", "archive"] as const)("projects durable exact task cleanup in %s evidence", (source) => {
		const run = boundRun();
		run.status = "COMPLETED";
		run.activeAgents = [];
		const admission: TaskAdmission = {
			metadata: taskBinding,
			outcome: { status: "STARTED", runId: run.runId },
			cleanup: "CONFIRMED",
			acceptedAt: 1,
			updatedAt: 2,
		};
		const input = {
			run,
			admission,
			source,
			writerPresent: false,
			cursor: { category: "checks", index: 0 } as const,
			fits: () => true,
		};
		expect(projectHostEvidenceDetails(input).ownership).toEqual({ writerPresent: false, cleanup: "confirmed" });
		for (const writerPresent of [true, null])
			expect(projectHostEvidenceDetails({ ...input, writerPresent }).ownership.cleanup).not.toBe("confirmed");
		for (const cleanup of [undefined, "NOT_STARTED", "UNCONFIRMED"] as const)
			expect(
				projectHostEvidenceDetails({ ...input, admission: { ...admission, cleanup } }).ownership.cleanup,
			).not.toBe("confirmed");
		for (const changed of [
			{ ...run, status: "RUNNING" as const },
			{ ...run, activeAgents: ["Developer" as const] },
		])
			expect(projectHostEvidenceDetails({ ...input, run: changed }).ownership.cleanup).not.toBe("confirmed");
		for (const foreign of [
			{ ...admission, outcome: { status: "STARTED" as const, runId: "foreign-run" } },
			{ ...admission, metadata: { ...taskBinding, configDigest: `sha256:${digest("0")}` } },
		])
			expect(() => projectHostEvidenceDetails({ ...input, admission: foreign })).toThrow();
	});

	it("preserves explicit COMPLEX cleanup uncertainty despite an exact confirmed admission", async () => {
		const files = new FakeFiles({ "src/app.ts": "app\n" });
		const { plan, parent } = await complexPlanFor(
			[
				{ claims: [{ path: "src/app.ts", operation: "modify" }] },
				{ claims: [{ path: "src/new.ts", operation: "create" }] },
			],
			{ files },
		);
		const harness = complexHarness({ plan, parent, files });
		harness.settlement.lsp = false;
		const run = await driveComplex(await harness.create());
		run.taskBinding = taskBinding;
		run.workspace = await harness.ports.verifier.inspect();
		expect(harness.invariantErrors).toEqual([]);
		expect(takeConsumerIssues()).toEqual([]);
		expect(run.status).toBe("INTERRUPTED");
		expect(run.activeAgents).toEqual([]);
		expect(run.complex?.cleanup).toBe("UNCONFIRMED");
		const cursor = { category: "checks", index: 0 } as const;
		expect(project(run, cursor).ownership.cleanup).toBe("uncertain");
		const admission: TaskAdmission = {
			metadata: taskBinding,
			outcome: { status: "STARTED", runId: run.runId },
			cleanup: "CONFIRMED",
			acceptedAt: 1,
			updatedAt: 2,
		};
		expect(
			projectHostEvidenceDetails({
				run,
				admission,
				source: "inline",
				writerPresent: false,
				cursor,
				fits: () => true,
			}).ownership,
		).toEqual({ writerPresent: false, cleanup: "uncertain" });
	});

	it("reports zero active evidence as available without inventing terminal cleanup", () => {
		const run = boundRun(implementingGraphRun());
		run.verification = [];
		delete run.review;
		const page = project(run, { category: "checks", index: 0 });
		expect(page).toMatchObject({
			kind: "evidence-details",
			records: [],
			nextCursor: null,
			outcome: { status: "RUNNING", terminal: false },
			ownership: { writerPresent: false, cleanup: "UNKNOWN" },
			completeness: {
				checks: { availability: "available", total: 0, required: 0 },
				changedFiles: { availability: "available", total: 0 },
				review: { availability: "unavailable" },
			},
		});
	});

	it("pages thousands of multibyte changed files under both record and byte limits", () => {
		const run = boundRun();
		const workspace = run.workspace;
		if (!workspace) throw new Error("Missing workspace fixture");
		workspace.changedFiles = Array.from(
			{ length: 2_103 },
			(_, index) => `src/한글-${String(index).padStart(4, "0")}-${"가".repeat(40)}.ts`,
		);
		const pages = collect(run, "changed-files", 8_192);
		expect(pages.flatMap((page) => page.records)).toHaveLength(2_103);
		expect(pages.every((page) => page.records.length <= 50)).toBe(true);
		expect(
			pages.every(
				(page) => Buffer.byteLength(JSON.stringify({ envelope: "x".repeat(256), data: page })) + 1 <= 8_192,
			),
		).toBe(true);
		expect(new Set(pages.map((page) => JSON.stringify(page.snapshot))).size).toBe(1);
		expect(new Set(pages.map((page) => JSON.stringify(page.completeness))).size).toBe(1);
	});

	it("keeps 64 trust sources out of the check row and pages them separately", () => {
		const run = boundRun();
		const workspace = run.workspace;
		const firstCheck = run.verification[0];
		if (!workspace || !firstCheck) throw new Error("Missing evidence fixture");
		run.verification = [
			{
				...firstCheck,
				runId: run.runId,
				diffDigest: workspace.diffDigest,
				trust: {
					mode: "strict",
					status: "VERIFIED",
					registrationDigest: `sha256:${digest("1")}`,
					executableDigest: `sha256:${digest("2")}`,
					sources: Array.from({ length: 64 }, (_, index) => ({
						path: `checks/source-${String(index).padStart(2, "0")}.mjs`,
						digest: `sha256:${digest((index % 10).toString())}`,
					})),
				},
			},
		];
		const checks = collect(run, "checks");
		expect(checks[0]?.records[0]).toMatchObject({ trust: { sourceCount: 64 } });
		expect(JSON.stringify(checks)).not.toContain("checks/source-00.mjs");
		const sources = collect(run, "trust-sources");
		expect(sources).toHaveLength(2);
		expect(sources.map((page) => page.records.length)).toEqual([50, 14]);
	});

	it("returns explicit unavailable records instead of truncating one oversized row", () => {
		const run = boundRun();
		const task = run.tasks[0];
		const criterion = task && isTaskContract(task) ? task.acceptanceCriteria[0] : undefined;
		if (!criterion) throw new Error("Missing criterion fixture");
		criterion.statement = "한".repeat(30_000);
		const page = project(run, { category: "criteria", index: 0 }, 8_192);
		expect(page).toMatchObject({
			kind: "evidence-detail-unavailable",
			reason: "RECORD_TOO_LARGE",
			recordIndex: 0,
		});
	});

	it("marks absent historical trust metadata unavailable instead of reporting zero", () => {
		const run = boundRun();
		for (const check of run.verification) delete check.trust;
		const page = project(run, { category: "trust-sources", index: 0 });
		expect(page).toMatchObject({
			kind: "evidence-detail-unavailable",
			reason: "CATEGORY_UNAVAILABLE",
			completeness: {
				trustSources: {
					availability: "unavailable",
					total: null,
					checksWithoutTrust: run.verification.length,
				},
			},
		});
	});

	it("preserves each check workspace digest rather than borrowing the current snapshot", () => {
		const run = boundRun();
		const first = run.verification[0];
		if (!first) throw new Error("Missing check fixture");
		run.verification = [
			{ ...first, diffDigest: digest("a") },
			{ ...first, diffDigest: digest("b") },
		];
		expect(collect(run, "checks")[0]?.records).toMatchObject([
			{ diffDigest: digest("a") },
			{ diffDigest: digest("b") },
		]);
	});

	it.each(["inline", "archive"] as const)(
		"keeps partial empty trust distinct from unavailable history in %s",
		(source) => {
			const run = boundRun();
			const first = run.verification[0];
			if (!first) throw new Error("Missing check fixture");
			const missing = { ...first };
			delete missing.trust;
			run.verification = [
				{
					...first,
					trust: {
						mode: "strict",
						status: "VERIFIED",
						registrationDigest: `sha256:${digest("1")}`,
						executableDigest: `sha256:${digest("2")}`,
						sources: [],
					},
				},
				missing,
			];
			const input = {
				run,
				source,
				writerPresent: false,
				cursor: { category: "trust-sources", index: 0 } as const,
				fits: () => true,
			};
			expect(projectHostEvidenceDetails(input)).toMatchObject({
				kind: "evidence-details",
				records: [],
				nextCursor: null,
				completeness: { trustSources: { availability: "partial", total: 0, checksWithoutTrust: 1 } },
			});
			delete run.taskContractDigest;
			run.verification = [];
			expect(projectHostEvidenceDetails(input)).toMatchObject({
				kind: "evidence-detail-unavailable",
				reason: "CATEGORY_UNAVAILABLE",
				completeness: {
					checks: { availability: "unavailable", total: null },
					trustSources: { availability: "unavailable", total: null },
				},
			});
		},
	);

	it("excludes raw output, sessions, prompts, reasons and hidden worker material", () => {
		const secret = "SECRET_SENTINEL_DO_NOT_PROJECT";
		const run = boundRun();
		const workspace = run.workspace;
		if (!workspace) throw new Error("Missing workspace fixture");
		run.goal = secret;
		run.roleSessionRefs = [{ role: "Developer", sessionId: secret, sessionFile: `/private/${secret}` }];
		run.verification = run.verification.map((check) => ({
			...check,
			runId: run.runId,
			diffDigest: workspace.diffDigest,
			reason: secret,
			stdout: secret,
			stderr: secret,
		}));
		for (const category of ["criteria", "checks", "changed-files", "trust-sources"] as const) {
			const page = project(run, { category, index: 0 });
			expect(JSON.stringify(page)).not.toContain(secret);
		}
	});
});
