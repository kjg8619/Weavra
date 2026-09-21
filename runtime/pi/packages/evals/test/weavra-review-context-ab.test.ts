import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";
import { createWorkerTools, WORKER_FILE_TOOLS } from "../../company-runtime/src/agent-tools.ts";
import { fileDigest } from "../../company-runtime/src/anchored-edit.ts";
import type { DocumentationConfig } from "../../company-runtime/src/documentation-pack-types.ts";
import { FilePolicyPathInspector } from "../../company-runtime/src/policy-paths.ts";
import type { AgentExecutionRequest, AgentExecutionResult } from "../../company-runtime/src/ports.ts";
import { runWeavraFixture, type WeavraEvalFixture } from "../src/weavra-harness.ts";

const docs = "label 1.2.3: trim boundary whitespace and preserve letter case. REVIEWED_DATA_SENTINEL";
const registry: DocumentationConfig = {
	mode: "bounded",
	manifest: "package.json",
	requested: ["label"],
	entries: [
		{
			id: "label-contract",
			source: { kind: "reviewed-local", reference: "local:label-1.2.3" },
			component: "label",
			version: "1.2.3",
			capturedAt: "2026-01-01T00:00:00.000Z",
			digest: fileDigest(docs),
			reviewStatus: "REVIEWED",
			content: docs,
		},
	],
};
const fixture: WeavraEvalFixture = {
	id: "review-impact-ab",
	workflow: "STANDARD",
	goal: "Fix the label trimming bug in src/label.ts",
	statements: ["Trim boundary whitespace while preserving case and the label(value) API."],
	allowedPaths: ["src", "test", "package.json"],
	checkIds: ["eval"],
	files: {
		"src/label.ts": "export function label(value) { return value; }\n",
		"src/caller.ts": 'import { label } from "./label.ts";\nexport const display = (value) => label(value);\n',
		"src/unrelated-a.ts": "export const unrelated = 1;\n",
		"src/unrelated-b.ts": "export const unrelated = 2;\n",
		"test/label.test.ts":
			'import assert from "node:assert/strict"; import test from "node:test"; import { display } from "../src/caller.ts"; test("preserves caller contract", () => assert.equal(display(" Ada "), "Ada"));\n',
		// Deliberately incomplete registered check; independent review/oracle must catch the case regression.
		"test/eval.test.mjs":
			'import assert from "node:assert/strict"; import test from "node:test"; import { label } from "../src/label.ts"; test("trims", () => assert.equal(label(" X "), "X"));\n',
		"package.json": '{"type":"module","dependencies":{"label":"1.2.3"}}',
		".gitignore": ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n",
	},
	oracle({ workspace }) {
		try {
			execFileSync(process.execPath, ["--test", "test/label.test.ts"], {
				cwd: workspace,
				stdio: "pipe",
				env: { PATH: process.env.PATH },
			});
			return [];
		} catch {
			return ["Independent caller/case contract failed"];
		}
	},
};

async function compare(mode: "disabled" | "bounded", defect: boolean) {
	const root = mkdtempSync(join(tmpdir(), "weavra-review-ab-"));
	try {
		const agentDir = join(root, "agent");
		mkdirSync(agentDir);
		const inspected: string[] = [];
		let reviewer: AgentExecutionRequest | undefined,
			issueDetected = false,
			calls = 0;
		const result = await runWeavraFixture(fixture, {
			agentDir,
			provider: "faux",
			model: "scripted-review",
			mutation: "strict",
			verifierTrust: "strict",
			contextPack: "bounded",
			reviewerContext: { impact: mode, documentation: { ...registry, mode } },
			lsp: {
				enabled: true,
				servers: [
					{
						id: "impact-fixture",
						executable: process.execPath,
						args: [
							fileURLToPath(new URL("../../company-runtime/test/fixtures/lsp-server.mjs", import.meta.url)),
							"impact",
							join(root, "lsp.jsonl"),
						],
						extensions: [".ts"],
						timeout_ms: 2000,
					},
				],
			},
			createAgents: async ({ cwd, config, args }) => {
				const policy = {
					executionMode: args[4].mode,
					executionRunId: args[4].runId,
					tools: WORKER_FILE_TOOLS,
					allowedPaths: [...config.files.allowed_paths],
					protectedPaths: ["test/eval.test.mjs"],
					configDigest: "fixed-eval-policy",
				};
				const paths = await FilePolicyPathInspector.open(cwd);
				return {
					policy,
					executor: {
						async execute(request): Promise<AgentExecutionResult> {
							const signal = request.signal ?? new AbortController().signal;
							const worker = createWorkerTools({
								cwd: paths.projectPath,
								request,
								config,
								policy,
								paths,
								audit: args[0],
								signal,
								assertActive: () => signal.throwIfAborted(),
							});
							const call = async (name: string, parameters: Record<string, unknown>) => {
								const tool = worker.tools.find((item) => item.name === name);
								if (!tool) throw new Error("Fixture tool unavailable");
								const output = await tool.execute(
									`call-${++calls}`,
									parameters,
									signal,
									undefined,
									{} as ExtensionContext,
								);
								return output.content
									.filter((part) => part.type === "text")
									.map((part) => part.text)
									.join("\n");
							};
							if (request.role === "Developer") {
								const read = await call("runtime_read", { path: "src/label.ts", anchors: true });
								await call("runtime_edit", {
									path: "src/label.ts",
									oldText: "return value;",
									newText: defect ? "return value.trim().toUpperCase();" : "return value.trim();",
									fileDigest: read.split("\n")[0].slice("fileDigest: ".length),
									anchor: read.split("\n")[1].split(" ")[0],
									readReceipt: read.split("\nreadReceipt: ")[1],
								});
								await call("submit_handoff", {
									runId: request.runId,
									revision: request.revision,
									role: "Developer",
									task: request.task.id,
									changed_files: ["src/label.ts"],
									summary: "Applied fixture implementation",
									assumptions: [],
									tests_run: [],
									known_risks: [],
									unresolved: [],
								});
							} else if (request.role === "Reviewer") {
								reviewer = request;
								const impact = request.reviewerContext?.impact;
								const paths = impact
									? [
											...new Set([
												...impact.changedSymbols.map((item) => item.path),
												...impact.callers.map((item) => item.path),
												...impact.relatedTests.map((item) => item.path),
											]),
										]
									: [
											"src/label.ts",
											"src/caller.ts",
											"test/label.test.ts",
											"src/unrelated-a.ts",
											"src/unrelated-b.ts",
											"package.json",
										];
								for (const path of paths) {
									const text = await call("runtime_read", { path });
									inspected.push(path);
									if (path === "src/label.ts") issueDetected = text.includes(".toUpperCase()");
								}
								await call("submit_review", {
									runId: request.runId,
									revision: request.revision,
									role: "Reviewer",
									task: request.task.id,
									result: issueDetected ? "BLOCK" : "PASS",
									issues: issueDetected
										? [
												{
													severity: "blocker",
													file: "src/label.ts",
													description: "Case preservation contract violated",
													recommendation: "Preserve case",
												},
											]
										: [],
									criteria: request.task.acceptanceCriteria.map((criterion) => ({
										criterionId: criterion.id,
										status: issueDetected ? "UNMET" : "MET",
										evidenceRefs: request.verification.evidenceRefs,
									})),
									evidenceRefs: request.verification.evidenceRefs,
									diffDigest: request.verification.diffDigest,
								});
							} else throw new Error("Unexpected fixture role");
							const submission = worker.result();
							if (!submission) throw new Error("Fixture submission rejected");
							return submission;
						},
					},
				};
			},
		});
		if (!reviewer || reviewer.role !== "Reviewer") throw new Error(result.runtimeError ?? "Reviewer missing");
		return {
			result,
			reviewer,
			inspected,
			issueDetected,
			calls,
			contextBytes: reviewer.reviewerContext ? Buffer.byteLength(JSON.stringify(reviewer.reviewerContext)) : 0,
			payloadBytes: Buffer.byteLength(
				JSON.stringify({
					task: reviewer.task,
					verification: reviewer.verification,
					taskContextPack: reviewer.taskContextPack,
					reviewerContext: reviewer.reviewerContext,
				}),
			),
		};
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

it("compares the same frozen authority with and without Reviewer context using real tools/checks and no Provider", async () => {
	for (const defect of [false, true]) {
		const baseline = await compare("disabled", defect),
			bounded = await compare("bounded", defect);
		expect(baseline.result.taskContractDigest).toBe(bounded.result.taskContractDigest);
		for (const run of [baseline, bounded]) {
			expect(run.issueDetected).toBe(defect);
			expect(run.result.runtimeStatus, run.result.runtimeError ?? undefined).toBe(defect ? "BLOCKED" : "COMPLETED");
			expect(run.result.oraclePass).toBe(!defect);
			expect(run.result.falseCompletion).toBe(false);
			expect(run.result.reportedTokens).toBeNull();
			expect(
				run.reviewer.verification.checks.every(
					(check) => check.status === "PASS" && check.trust?.status === "VERIFIED",
				),
			).toBe(true);
			expect(run.inspected).not.toContain("test/eval.test.mjs");
		}
		expect(bounded.reviewer.reviewerContext?.impact?.changedSymbols.map((symbol) => symbol.name)).toEqual(["label"]);
		expect(bounded.reviewer.reviewerContext?.documentation?.entries[0].status).toBe("MATCHED");
		expect(bounded.inspected).toEqual(["src/label.ts", "src/caller.ts", "test/label.test.ts"]);
		expect(bounded.calls).toBeLessThan(baseline.calls);
		expect(bounded.contextBytes).toBeLessThanOrEqual(49152);
		console.log(
			JSON.stringify({
				experiment: "scripted-review-not-model-quality",
				defect,
				baseline: {
					payloadBytes: baseline.payloadBytes,
					contextBytes: baseline.contextBytes,
					fileInspections: baseline.inspected.length,
					toolCalls: baseline.calls,
				},
				bounded: {
					payloadBytes: bounded.payloadBytes,
					contextBytes: bounded.contextBytes,
					fileInspections: bounded.inspected.length,
					toolCalls: bounded.calls,
				},
				issueDetected: bounded.issueDetected,
				falsePositive: !defect && bounded.issueDetected,
				falseCompletion: bounded.result.falseCompletion,
				providerTokens: "UNKNOWN",
			}),
		);
	}
}, 30_000);
