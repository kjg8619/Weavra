import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyRequest } from "../src/classification.ts";
import { taskContractDigest } from "../src/criterion-evidence.ts";
import { bindExecutionContract, proposeExecutionMode } from "../src/execution-contract.ts";
import { assertCanComplete, CompanyKernel, type CompletionEvidence, type CreateRunRequest } from "../src/kernel.ts";
import { formatRunView } from "../src/observations.ts";
import { evaluatePolicy, evaluateRegisteredCheck, executePolicyAction, type PolicyContext } from "../src/policy.ts";
import { selectQuickScope } from "../src/quick.ts";
import { type FileRuntimeState, FileStateStore } from "../src/state-store.ts";
import { testContract } from "./fixture-contract.ts";

const reads = [
	"오류 원인을 설명해줘",
	"이 코드 분석해줘",
	"삭제하지 말고 삭제 로직을 설명해줘",
	"fix라는 단어가 이 문서에서 무슨 뜻인지 설명해줘",
	"src/a.ts를 수정하지 말고 문제점을 알려줘",
	"Explain why src/a.ts fails",
	"Analyze this bug without changing files",
	"Do not delete anything; explain the delete flow",
	"What does 'fix' mean in this document?",
	'Explain "delete" in `src/한 글.ts`',
	"Inspect src/a.ts: do not change files",
];
const edits = [
	"Fix the bug in src/a.ts",
	"src/a.ts 오타를 수정해줘",
	"Implement X in src/a.ts",
	"Update dependency in package.json",
	"Delete file src/old.ts",
	"파일 삭제 src/old.ts",
	"Fix bug in `src/한 글.ts`: preserve unrelated behavior",
];
const ambiguous = [
	"Do something",
	"Maybe fix or explain this",
	"Explain src/a.ts and fix its bug",
	"Fix src/a.ts then explain it",
	"Fix src/a.ts, explain it",
	"Explain src/a.ts, fix its bug",
	"Fix src/a.ts without changing files",
	"버그를 고쳐줘 그리고 설명해줘",
	"Fix typo in `src/a.ts",
	'"Fix src/a.ts"',
	"Fix src/a.ts\u001b",
];
const policy: PolicyContext = {
	executionMode: "READ_ONLY",
	executionRunId: "run",
	configDigest: "frozen",
	tools: [
		{ id: "read", operation: "read" },
		{ id: "write", operation: "write" },
		{ id: "edit", operation: "edit" },
		{ id: "delete", operation: "delete" },
	],
	allowedPaths: ["src", "package.json"],
};
const action = {
	runId: "run",
	actionId: "action",
	actionDigest: "digest",
	tool: "write",
	role: "Developer" as const,
	risk: "R0" as const,
	paths: ["src/a.ts"],
};
const facts = [{ path: "src/a.ts", safe: true, kind: "file" as const }];

describe("V0.3C proposal is not a permission grant", () => {
	it.each(reads)("proposes READ_ONLY: %s", (goal) =>
		expect(proposeExecutionMode(goal)).toMatchObject({ mode: "READ_ONLY", requiresConfirmation: false }),
	);
	it.each(edits)("proposes EDIT requiring trusted Host selection: %s", (goal) =>
		expect(proposeExecutionMode(goal)).toMatchObject({ mode: "EDIT", requiresConfirmation: false }),
	);
	it.each(ambiguous)("refuses ambiguous/mixed/untrusted text: %s", (goal) => {
		const proposal = proposeExecutionMode(goal);
		expect(proposal.requiresConfirmation).toBe(true);
		expect(proposal.mode).toBeUndefined();
	});
	it("does not turn quoted/negated risk words into a destructive grant or downgrade risk", () => {
		const goal = "삭제하지 말고 삭제 로직을 설명해줘";
		expect(proposeExecutionMode(goal).mode).toBe("READ_ONLY");
		expect(classifyRequest(goal).classification.risk).toBe("R3");
		const contract = bindExecutionContract("run", "READ_ONLY");
		expect(Object.isFrozen(contract)).toBe(true);
		expect(() => bindExecutionContract("run", undefined as never)).toThrow("execution contract");
	});
	it.each([
		["src/a.ts:", "src/a.ts"],
		["src/한글.ts.", "src/한글.ts"],
		['"src/a file.ts"', "src/a file.ts"],
		["`src/한 글.ts`:", "src/한 글.ts"],
		["'src/a file.ts'", "src/a file.ts"],
		["(src/a.ts),", "src/a.ts"],
		["src/a's.ts", "src/a's.ts"],
		["src/(a).ts", "src/(a).ts"],
	])("parses an explicit bounded path %s without normalizing the actual tool path", (token, path) => {
		const goal = `Fix typo in ${token}`;
		expect(selectQuickScope(goal, classifyRequest(goal).classification).targetPath).toBe(path);
	});
	it.each(["../a.ts", "/tmp/a.ts", "C:\\a.ts", "src/a.ts..", "`src/a.ts:`", "src/a[b].ts", "src/a.ts,src/b.ts"])(
		"rejects unsafe/ambiguous path %s",
		(path) => {
			const goal = `Fix typo in ${path}`;
			expect(() => selectQuickScope(goal, classifyRequest(goal).classification)).toThrow();
		},
	);
});

describe("READ_ONLY Policy double enforcement", () => {
	it.each(["Developer", "Executor"] as const)(
		"direct registered write/edit/delete cannot mutate for %s",
		async (role) => {
			const cwd = await mkdtemp(join(tmpdir(), "contract-deny-"));
			const path = join(cwd, "a.ts");
			await writeFile(path, "original");
			try {
				for (const tool of ["write", "edit", "delete"])
					for (const risk of ["R0", "R1", "R2", "R3"] as const) {
						let effects = 0;
						const result = await executePolicyAction({ ...action, role, tool, risk }, policy, {
							paths: { inspect: async () => facts },
							audit: { prepare: async () => {}, finish: async () => {}, assertWritable: async () => {} },
							execute: async () => {
								effects++;
								await writeFile(path, "FORBIDDEN");
							},
						});
						expect(result.decision).toMatchObject({
							decision: "DENY",
							executionMode: "READ_ONLY",
							reason: expect.stringContaining("READ_ONLY"),
						});
						expect(effects).toBe(0);
						expect(await readFile(path, "utf8")).toBe("original");
					}
			} finally {
				await rm(cwd, { recursive: true, force: true });
			}
		},
	);
	it("preserves R2/R3 risk floors even when denying a read-only contract", () => {
		expect(
			evaluatePolicy({ ...action, paths: ["package.json"] }, policy, [{ ...facts[0], path: "package.json" }]),
		).toMatchObject({ decision: "DENY", risk: "R2" });
		expect(evaluatePolicy({ ...action, tool: "delete" }, policy, facts)).toMatchObject({
			decision: "DENY",
			risk: "R3",
		});
	});
	it("R3 consent cannot override a READ_ONLY execution contract", () => {
		const context = {
			...policy,
			r3Scope: { runId: "run", targetPath: "src/a.ts" },
			r3Approval: {
				runId: "run",
				actionId: "action",
				actionDigest: "digest",
				configDigest: "frozen",
				approved: true,
				expiresAt: Date.now() + 10000,
			},
		};
		expect(evaluatePolicy({ ...action, tool: "delete", risk: "R3" }, context, facts, Date.now()).decision).toBe(
			"DENY",
		);
	});
	it("requires a bound explicit mode, not a risk label or worker-supplied field", () => {
		const context = structuredClone(policy);
		Reflect.deleteProperty(context, "executionMode");
		expect(evaluatePolicy(action, context, facts).decision).toBe("DENY");
		expect(evaluatePolicy({ ...action, runId: "other" }, policy, facts).decision).toBe("DENY");
		const spoofed = { ...action, executionMode: "EDIT" };
		expect(evaluatePolicy(spoofed, policy, facts).decision).toBe("DENY");
		expect(evaluatePolicy(action, { ...policy, executionMode: "EDIT" }, facts)).toMatchObject({
			decision: "ALLOW",
			risk: "R1",
		});
		expect(evaluatePolicy({ ...action, tool: "read" }, policy, facts).decision).toBe("ALLOW");
	});
	it("keeps explicitly registered verification separate from worker mutation permission", () => {
		const check = {
			id: "test",
			executable: process.execPath,
			argv: ["check.mjs"],
			cwd: ".",
			timeoutMs: 1000,
			env: {},
		};
		expect(
			evaluateRegisteredCheck(
				{ runId: "run", actionId: "check", actionDigest: "digest" },
				check,
				check,
				policy,
				true,
			),
		).toMatchObject({ role: "Verifier", decision: "ALLOW", executionMode: "READ_ONLY" });
	});
});

function completion(): CompletionEvidence {
	const task = testContract("Explain", {
		taskId: "task",
		statements: ["Explain"],
		workflow: "QUICK",
		checkIds: ["check"],
	});
	const verification = {
		runId: "run",
		revision: 0,
		step: { stepId: "self-check" as const, attempt: 1 },
		diffDigest: "digest",
		evidenceRefs: ["ref"],
		changedFiles: [],
		checks: [
			{
				id: "check",
				runId: "run",
				revision: 0,
				kind: "test" as const,
				required: true,
				status: "PASS" as const,
				exitCode: 0,
				reason: "Executed",
				evidenceRefs: ["ref"],
				diffDigest: "digest",
			},
		],
	};
	return {
		executionMode: "READ_ONLY",
		runId: "run",
		revision: 0,
		workflow: "STANDARD",
		risk: "R0",
		task,
		taskContractDigest: taskContractDigest(task),
		checks: [{ id: "check", kind: "test", required: true }],
		handoff: {
			runId: "run",
			revision: 0,
			role: "Developer",
			task: "task",
			summary: "Explained",
			changed_files: [],
			assumptions: [],
			tests_run: [],
			known_risks: [],
			unresolved: [],
		},
		selfCheck: verification,
		finalCheck: { ...verification, step: { stepId: "test", attempt: 1 } },
		workspace: { safe: true, changedFiles: [], diffDigest: "digest", evidenceRefs: ["ref"] },
		review: {
			runId: "run",
			revision: 0,
			role: "Reviewer",
			task: "task",
			result: "PASS",
			issues: [],
			criteria: [{ criterionId: "AC-001", status: "MET", evidenceRefs: ["ref"] }],
			evidenceRefs: ["ref"],
			diffDigest: "digest",
		},
	};
}
describe("READ_ONLY completion and durable binding", () => {
	it("requires no changes even when all other review/check evidence claims PASS", () => {
		expect(() => assertCanComplete(completion())).not.toThrow();
		for (const field of ["workspace", "selfCheck", "finalCheck"] as const) {
			const evidence = completion();
			evidence[field]!.changedFiles = ["src/external.ts"];
			expect(() => assertCanComplete(evidence)).toThrow("READ_ONLY");
		}
		const missing = completion();
		Reflect.deleteProperty(missing, "executionMode");
		expect(() => assertCanComplete(missing)).toThrow("explicit execution contract");
	});
	it.each(["mode-change", "policy-change", "legacy"])(
		"preserves immutable/legacy contract boundary: %s",
		async (kind) => {
			const cwd = await mkdtemp(join(tmpdir(), "contract-store-"));
			const store = await FileStateStore.open(cwd);
			try {
				const request: CreateRunRequest = {
					executionMode: "READ_ONLY",
					runId: "run",
					task: testContract("Explain", {
						taskId: "task",
						statements: ["Explain"],
						workflow: "QUICK",
						checkIds: ["check"],
					}),
					classification: {
						intent: "question",
						complexity: "STANDARD",
						risk: "R0",
						confidence: null,
						reason: "Fixture",
					},
				};
				const ports = {
					store,
					agents: {
						execute: async (): Promise<never> => {
							throw new Error("Unused");
						},
					},
					verifier: {
						verify: async (): Promise<never> => {
							throw new Error("Unused");
						},
						inspect: async () => completion().workspace!,
					},
				};
				const invalid = { ...request };
				Reflect.deleteProperty(invalid, "executionMode");
				await expect(CompanyKernel.create(invalid, ports)).rejects.toThrow("explicit execution contract");
				const kernel = await CompanyKernel.create(request, ports);
				await kernel.start();
				if (kind === "mode-change")
					await expect(
						store.save({ ...kernel.snapshot, revision: kernel.snapshot.revision + 1, executionMode: "EDIT" }),
					).rejects.toThrow();
				if (kind === "policy-change")
					await expect(
						store.prepare(evaluatePolicy(action, { ...policy, executionMode: "EDIT" }, facts)),
					).rejects.toThrow();
				if (kind === "legacy") {
					await store.close();
					const state = JSON.parse(await readFile(join(cwd, ".ai/state.json"), "utf8")) as FileRuntimeState;
					delete state.runs[0].executionMode;
					const bytes = JSON.stringify(state);
					await writeFile(join(cwd, ".ai/state.json"), bytes);
					const snapshot = await FileStateStore.readSnapshot(cwd);
					expect(snapshot.state?.runs[0].executionMode).toBeUndefined();
					expect(formatRunView("risk", { run: snapshot.state?.runs[0], source: "stored" })).toContain(
						"UNKNOWN (legacy",
					);
					expect(await readFile(join(cwd, ".ai/state.json"), "utf8")).toBe(bytes);
					expect(evaluatePolicy(action, { ...policy, executionMode: undefined as never }, facts).decision).toBe(
						"DENY",
					);
				}
			} finally {
				await store.close();
				await rm(cwd, { recursive: true, force: true });
			}
		},
	);
});
