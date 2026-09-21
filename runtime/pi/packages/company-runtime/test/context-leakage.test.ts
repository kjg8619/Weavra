import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatEvidencePack, projectEvidencePack } from "../src/evidence.ts";
import { WorkerMeasurementAccumulator } from "../src/measurement.ts";
import { formatPlanPreview } from "../src/plan-preview.ts";
import type { PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import type { AgentExecutionRequest, AgentExecutionResult, AgentExecutor } from "../src/ports.ts";
import { summarizeTaskContextPack } from "../src/task-context.ts";
import { withTaskContext } from "../src/task-context-executor.ts";
import { testContract } from "./fixture-contract.ts";
import { graphRun } from "./graph-fixtures.ts";

const SECRET = "SUPER_SECRET_VALUE";
const ORACLE = "ORACLE_SECRET_MARKER";
const INSTRUCTION = "PROJECT_PRIVATE_MARKER";

let cwd: string;
let captured: AgentExecutionRequest[];

const write = (path: string, content: string) => {
	mkdirSync(join(cwd, path, ".."), { recursive: true });
	writeFileSync(join(cwd, path), content);
};

const requestOf = (): AgentExecutionRequest =>
	({
		executionMode: "EDIT",
		runId: "run-1",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		role: "Developer",
		profile: "coding",
		task: testContract("Fix `formatLabel` in src/service.ts", {
			taskId: "task-1",
			statements: ["Keep `formatLabel` behaving"],
		}),
	}) as unknown as AgentExecutionRequest;

async function packFor() {
	const policy: PolicyContext = {
		executionMode: "EDIT",
		executionRunId: "run-1",
		tools: [],
		allowedPaths: ["src", "test"],
		protectedPaths: [".env", "AGENTS.md"],
		projectInstruction: { path: "AGENTS.md", digest: `sha256:${"a".repeat(64)}`, bytes: 42 },
		configDigest: "config",
	};
	const executor: AgentExecutor = {
		async execute(request): Promise<AgentExecutionResult> {
			captured.push(request);
			return { role: "Developer", handoff: {} as never };
		},
	};
	const wrapped = withTaskContext(executor, {
		mode: "bounded",
		cwd,
		policy,
		paths: await FilePolicyPathInspector.open(cwd),
		protectedPaths: [".env", "AGENTS.md"],
		verifierSources: ["test/oracle.mjs"],
	});
	await wrapped.execute(requestOf());
	return captured[0].taskContextPack!;
}

beforeEach(() => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-leak-")));
	write(
		"src/service.ts",
		`import { formatLabel } from "./formatter.ts";\nexport const service = () => formatLabel("x");\n`,
	);
	write("src/formatter.ts", `export const formatLabel = (value: string) => value.trim();\n`);
	write("test/service.test.ts", `import { service } from "../src/service.ts";\nservice();\n`);
	write(".env", `${SECRET}\n`);
	write("AGENTS.md", `${INSTRUCTION}\n`);
	write("test/oracle.mjs", `export const oracle = "${ORACLE}";\n`);
	captured = [];
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

describe("V0.5A context pipeline leakage regression", () => {
	it("keeps secrets, oracle and instruction bodies out of every projection", async () => {
		const pack = await packFor();
		const serializedPack = JSON.stringify(pack);
		for (const marker of [SECRET, ORACLE, INSTRUCTION]) expect(serializedPack).not.toContain(marker);
		// Protected sources never appear in the discovered relations or snippets.
		for (const path of [".env", "oracle.mjs"]) expect(serializedPack).not.toContain(path);
		expect(pack.relatedFiles.map((file) => file.path)).not.toContain("AGENTS.md");
		expect(pack.snippets.map((snippet) => snippet.path)).not.toContain("AGENTS.md");
		// The instruction file appears as metadata only.
		expect(pack.projectRules).toMatchObject({ kind: "configured-file", path: "AGENTS.md" });
		expect(pack.relatedFiles.map((file) => file.path)).toContain("src/service.ts");

		const accumulator = new WorkerMeasurementAccumulator(
			{
				role: "Developer",
				profile: "coding",
				revision: 0,
				step: { stepId: "implement", attempt: 1 },
				requestedProvider: "commandcode",
				requestedModel: "deepseek/deepseek-v4.1-flash",
			},
			Date.now,
			summarizeTaskContextPack(pack),
		);
		const measurement = accumulator.finish("SUCCEEDED");
		const serializedMeasurement = JSON.stringify(measurement);
		for (const marker of [SECRET, ORACLE, INSTRUCTION]) expect(serializedMeasurement).not.toContain(marker);
		expect(serializedMeasurement).not.toContain("src/");
		expect(measurement.contextPack?.relatedFileCount).toBe(pack.relatedFiles.length);

		const run = graphRun("STANDARD", "R1", 0);
		const evidence = projectEvidencePack({
			run: { ...run, workerMeasurements: [measurement] } as never,
			report: { changedFiles: [], partialChanges: false, changesUnknown: false } as never,
		});
		const evidenceText = formatEvidencePack(evidence);
		for (const marker of [SECRET, ORACLE, INSTRUCTION]) {
			expect(evidenceText).not.toContain(marker);
			expect(JSON.stringify(evidence)).not.toContain(marker);
		}
		expect(JSON.stringify(evidence.workers)).not.toContain("src/");
		expect(evidenceText).toContain("Developer context: bounded sha256:");

		const preview = formatPlanPreview({
			goal: "Fix `formatLabel`",
			workflow: "STANDARD",
			executionMode: "EDIT",
			risk: "R1",
			acceptanceCriteria: [],
			allowedPaths: ["src", "test"],
			checks: [],
			projectInstructionPath: "AGENTS.md",
			lspEnabled: false,
			mutationMode: "strict",
			verifierTrustMode: "strict",
			verifierTrustSources: ["test/oracle.mjs"],
			verifierSandboxMode: "required",
			contextPackMode: "bounded",
			verificationRepairMode: "disabled",
		});
		for (const marker of [SECRET, ORACLE, INSTRUCTION]) expect(preview).not.toContain(marker);
	});
});

describe("V0.5A reviewer freshness through the production decorator", () => {
	it("rebuilds the reviewer pack from post-mutation bytes without reusing the developer pack", async () => {
		const policy: PolicyContext = {
			executionMode: "EDIT",
			executionRunId: "run-1",
			tools: [],
			allowedPaths: ["src", "test"],
			protectedPaths: [".env"],
			configDigest: "config",
		};
		const executed: AgentExecutionRequest[] = [];
		const executor: AgentExecutor = {
			async execute(request): Promise<AgentExecutionResult> {
				executed.push(request);
				return { role: request.role === "Reviewer" ? "Reviewer" : "Developer", review: undefined } as never;
			},
		};
		const wrapped = withTaskContext(executor, {
			mode: "bounded",
			cwd,
			policy,
			paths: await FilePolicyPathInspector.open(cwd),
			protectedPaths: [".env"],
			verifierSources: [],
		});
		await wrapped.execute(requestOf());
		// Developer mutates the allowed source before the review step.
		write(
			"src/service.ts",
			`import { formatLabel } from "./formatter.ts";\nexport const service = () => formatLabel("x").toUpperCase();\n`,
		);
		await wrapped.execute({
			...requestOf(),
			role: "Reviewer",
			profile: "reasoning",
			step: { stepId: "review", attempt: 1 },
			handoff: { changed_files: ["src/service.ts"] } as never,
			verification: { changedFiles: ["src/service.ts"] } as never,
		} as never);
		const developerPack = executed[0].taskContextPack!;
		const reviewerPack = executed[1].taskContextPack!;
		expect(reviewerPack).not.toBe(developerPack);
		expect(reviewerPack.digest).not.toBe(developerPack.digest);
		const reviewerSnippet = reviewerPack.snippets.find((snippet) => snippet.path === "src/service.ts")!;
		expect(reviewerSnippet.text).toContain("toUpperCase");
		const developerSnippet = developerPack.snippets.find((snippet) => snippet.path === "src/service.ts")!;
		expect(developerSnippet.text).not.toContain("toUpperCase");
		expect(reviewerSnippet.fileDigest).not.toBe(developerSnippet.fileDigest);
		expect(reviewerSnippet.snippetDigest).not.toBe(developerSnippet.snippetDigest);
	});
});
