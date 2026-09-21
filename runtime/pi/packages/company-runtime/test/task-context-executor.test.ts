import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkerExecutionError } from "../src/measurement.ts";
import type { PolicyContext } from "../src/policy.ts";
import { FilePolicyPathInspector } from "../src/policy-paths.ts";
import type { AgentExecutionRequest, AgentExecutionResult, AgentExecutor } from "../src/ports.ts";
import { type TaskContextExecutorOptions, taskContextSeeds, withTaskContext } from "../src/task-context-executor.ts";
import { testContract } from "./fixture-contract.ts";

let cwd: string;
let policy: PolicyContext;
let options: TaskContextExecutorOptions;
let captured: AgentExecutionRequest[];

const write = (path: string, content: string) => {
	mkdirSync(join(cwd, path, ".."), { recursive: true });
	writeFileSync(join(cwd, path), content);
};

function requestOf(overrides: Partial<AgentExecutionRequest> = {}): AgentExecutionRequest {
	return {
		executionMode: "EDIT",
		runId: "run-1",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		role: "Developer",
		profile: "coding",
		task: testContract("Fix `formatLabel` in src/service.ts", {
			taskId: "task-1",
			statements: ["Keep `formatLabel` behaviour"],
		}),
		...overrides,
	} as AgentExecutionRequest;
}

const result: AgentExecutionResult = { role: "Developer", handoff: {} as never };

beforeEach(async () => {
	cwd = realpathSync(mkdtempSync(join(tmpdir(), "weavra-ctx-exec-")));
	write("src/service.ts", "export const formatLabel = (v: string) => v.trim();\n");
	write("src/formatter.ts", "export const formatLabel = (v: string) => v;\n");
	write("test/service.test.ts", 'import { formatLabel } from "../src/formatter.ts";\nformatLabel("x");\n');
	write(".env", "SUPER_SECRET_VALUE\n");
	policy = {
		executionMode: "EDIT",
		executionRunId: "run-1",
		tools: [],
		allowedPaths: ["src", "test"],
		protectedPaths: [".env"],
		configDigest: "config",
	};
	captured = [];
	options = {
		mode: "bounded",
		cwd,
		policy,
		paths: await FilePolicyPathInspector.open(cwd),
		protectedPaths: [".env"],
		verifierSources: [],
	};
});

afterEach(() => rmSync(cwd, { recursive: true, force: true }));

function innerExecutor(behavior?: () => Promise<AgentExecutionResult>): AgentExecutor {
	return {
		safeToRelease: true,
		async execute(request) {
			captured.push(request);
			return behavior ? await behavior() : result;
		},
	};
}

describe("V0.5A task context executor decorator", () => {
	it("passes through untouched in disabled mode", async () => {
		const executor = withTaskContext(innerExecutor(), { ...options, mode: "disabled" });
		await executor.execute(requestOf());
		expect(captured[0].taskContextPack).toBeUndefined();
		expect(executor.safeToRelease).toBe(true);
	});

	it("seeds the Developer pack from acceptance scope and reviews", () => {
		const seeds = taskContextSeeds(requestOf());
		// Acceptance scope names the allowed root; the builder expands it to concrete files.
		expect(seeds).toEqual(["src"]);
		const revised = taskContextSeeds(
			requestOf({
				revision: 1,
				step: { stepId: "implement", attempt: 2 },
				previousReview: { issues: [{ file: "src/formatter.ts" }, { file: null }] } as never,
			} as never),
		);
		expect(revised).toContain("src/formatter.ts");
	});

	it("seeds the Reviewer from verification and handoff changed files", () => {
		const seeds = taskContextSeeds(
			requestOf({
				role: "Reviewer",
				profile: "reasoning",
				step: { stepId: "review", attempt: 1 },
				handoff: { changed_files: ["src/service.ts"] } as never,
				verification: { changedFiles: ["src/formatter.ts"] } as never,
			} as never),
		);
		expect(seeds).toContain("src/formatter.ts");
		expect(seeds).toContain("src/service.ts");
	});

	it("attaches a bounded pack with the discovered relations and no protected content", async () => {
		const executor = withTaskContext(innerExecutor(), options);
		await executor.execute(requestOf());
		const pack = captured[0].taskContextPack!;
		expect(pack.mode).toBe("bounded");
		const paths = pack.relatedFiles.map((file) => file.path);
		expect(paths).toContain("src/service.ts");
		expect(paths).toContain("src/formatter.ts");
		expect(JSON.stringify(pack)).not.toContain("SUPER_SECRET_VALUE");
		expect(JSON.stringify(pack)).not.toContain(".env");
	});

	it("rebuilds the Reviewer pack from current bytes after a Developer mutation", async () => {
		const executor = withTaskContext(innerExecutor(), options);
		await executor.execute(requestOf());
		write("src/service.ts", "export const formatLabel = (v: string) => v.toUpperCase();\n");
		await executor.execute(
			requestOf({
				role: "Reviewer",
				profile: "reasoning",
				step: { stepId: "review", attempt: 1 },
				handoff: { changed_files: ["src/service.ts"] } as never,
				verification: { changedFiles: ["src/service.ts"] } as never,
			} as never),
		);
		const developer = captured[0].taskContextPack!;
		const reviewer = captured[1].taskContextPack!;
		expect(reviewer.digest).not.toBe(developer.digest);
		const reviewerSnippet = reviewer.snippets.find((snippet) => snippet.path === "src/service.ts");
		expect(reviewerSnippet?.text).toContain("toUpperCase");
		const developerSnippet = developer.snippets.find((snippet) => snippet.path === "src/service.ts");
		expect(developerSnippet?.text).not.toContain("toUpperCase");
	});

	it("preserves the inner result, errors and measurement without extra invocations", async () => {
		let calls = 0;
		const executor = withTaskContext(
			innerExecutor(async () => {
				calls += 1;
				throw new WorkerExecutionError("provider failed", undefined);
			}),
			options,
		);
		await expect(executor.execute(requestOf())).rejects.toBeInstanceOf(WorkerExecutionError);
		expect(calls).toBe(1);
		const ok = withTaskContext(innerExecutor(), options);
		await expect(ok.execute(requestOf())).resolves.toBe(result);
		expect(captured).toHaveLength(2);
	});
});
