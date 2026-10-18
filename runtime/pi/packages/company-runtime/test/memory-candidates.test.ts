import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CheckResult, Run } from "../src/contracts.ts";
import type { HostBridgeConnection } from "../src/host-bridge.ts";
import { HostControlBridge } from "../src/host-control.ts";
import { HOST_CONTROL_MAX_RESPONSE_BYTES, type HostControlResponse } from "../src/host-control-protocol.ts";
import { deriveMemoryCandidates } from "../src/memory-candidates.ts";
import { PROJECT_FACT_LIMIT } from "../src/project-fact-types.ts";
import { FileStateStore } from "../src/state-store.ts";
import { graphRun } from "./graph-fixtures.ts";

function failedRun(runId: string, checks: Partial<CheckResult>[], status: Run["status"] = "BLOCKED"): Run {
	const run = graphRun("STANDARD", "R1");
	run.runId = runId;
	run.status = status;
	run.phase = "SELF_CHECK";
	run.currentStep = { stepId: "self-check", attempt: 1 };
	run.tasks[0].status = "blocked";
	run.completed = [];
	run.reviewHistory = [];
	delete run.review;
	run.verification = checks.map((check) => ({ ...run.verification[0]!, runId, ...check }));
	run.lastError = "Required check did not pass";
	return run;
}
const policyDenied = (id = "lint"): Partial<CheckResult> => ({
	id,
	status: "UNAVAILABLE",
	exitCode: null,
	reason: "Check blocked by execution policy",
	evidenceRefs: [`check:run:${id}`],
});

describe("deterministic memory candidates", () => {
	it("derives one policy_denied candidate naming the check from a Policy-blocked Run", () => {
		const candidates = deriveMemoryCandidates([failedRun("run-1", [policyDenied()])]);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]).toMatchObject({
			source: { runId: "run-1", kind: "policy_denied" },
			evidenceRef: "check:run:lint",
		});
		expect(candidates[0]!.statement).toContain("lint");
		expect(candidates[0]!.id).toMatch(/^sha256:[0-9a-f]{64}$/);
	});
	it("derives nothing from a COMPLETED Run, even with an earlier REVISE", () => {
		expect(deriveMemoryCandidates([graphRun("STANDARD", "R1", 1)])).toEqual([]);
	});
	it("collapses the same failure across Runs into one candidate from the newest Run", () => {
		const candidates = deriveMemoryCandidates([
			failedRun("run-1", [policyDenied()]),
			failedRun("run-2", [policyDenied()]),
		]);
		expect(candidates).toHaveLength(1);
		expect(candidates[0]!.source.runId).toBe("run-2");
	});
	it("separates check FAIL and review REVISE, drops unsafe labels, skips stored facts and caps at the fact limit", () => {
		const run = failedRun("run-1", [
			{ id: "test", status: "FAIL", exitCode: 1, reason: "Executed" },
			{ id: "bad id\nwith newline", status: "FAIL", exitCode: 1, reason: "Executed" },
		]);
		run.reviewHistory = [
			{
				...graphRun("STANDARD", "R1", 1).reviewHistory![0]!,
				runId: "run-1",
				result: "REVISE",
				issues: [
					{ severity: "blocker", file: "src/app.ts", description: "x", recommendation: "y" },
					{ severity: "warning", file: "src/app.ts", description: "x", recommendation: "y" },
				],
			},
		];
		const candidates = deriveMemoryCandidates([run]);
		expect(candidates.map((candidate) => candidate.source.kind)).toEqual(["check_failed", "review_revise"]);
		expect(candidates[1]!.statement).toContain("src/app.ts");
		expect(candidates[1]!.evidenceRef).toBe("review:run-1:0");
		expect(deriveMemoryCandidates([run], [{ statement: candidates[0]!.statement }])).toHaveLength(1);
		const many = failedRun(
			"run-many",
			Array.from({ length: PROJECT_FACT_LIMIT + 4 }, (_, index) => policyDenied(`check-${index}`)),
		);
		expect(deriveMemoryCandidates([many])).toHaveLength(PROJECT_FACT_LIMIT);
	});
});

describe("facts.candidates Host Control command", () => {
	let cwd: string;
	let bridge: HostControlBridge;
	let responses: HostControlResponse[];
	let connection: HostBridgeConnection;
	const lines: string[] = [];
	async function send(request: object) {
		await connection.receive(JSON.stringify({ protocolVersion: 1, ...request }));
		return responses.at(-1)!;
	}
	beforeEach(async () => {
		cwd = realpathSync(mkdtempSync(join(tmpdir(), "memory-candidates-")));
		mkdirSync(join(cwd, "src"));
		mkdirSync(join(cwd, ".ai"));
		writeFileSync(
			join(cwd, ".ai/config.yaml"),
			JSON.stringify({
				schemaVersion: 1,
				models: {
					profiles: {
						coding: { provider: "unused", model: "unused" },
						reasoning: { provider: "unused", model: "unused" },
					},
				},
				files: { allowed_paths: ["src"] },
				verification: { checks: [] },
			}),
		);
		responses = [];
		lines.length = 0;
		bridge = await HostControlBridge.create({
			cwd,
			agentDir: join(cwd, "unused"),
			projectTrusted: true,
			now: () => 1000,
		});
		connection = bridge.connect((line) => {
			lines.push(line);
			responses.push(JSON.parse(line));
			return true;
		});
		await send({ id: "hello", type: "control.hello" });
	});
	afterEach(async () => {
		await bridge.shutdown();
		rmSync(cwd, { recursive: true, force: true });
	});

	it("is advertised outside the strict commands tuple and reads candidates without changing state", async () => {
		const hello = responses[0]!;
		if (!hello.success || hello.data.kind !== "capabilities") throw new Error(JSON.stringify(hello));
		expect(hello.data.capabilities.factCandidates).toBe(1);
		expect(hello.data.capabilities.commands).not.toContain("facts.candidates");

		writeFileSync(
			join(cwd, ".ai/state.json"),
			JSON.stringify({
				schemaVersion: 1,
				revision: 3,
				runs: [
					failedRun("run-1", [policyDenied()]),
					failedRun("run-2", [policyDenied()]),
					graphRun("STANDARD", "R1", 1),
				],
				actions: [],
			}),
		);
		const digest = () =>
			createHash("sha256")
				.update(readFileSync(join(cwd, ".ai/state.json")))
				.digest("hex");
		const before = digest();
		const response = await send({ id: "candidates", type: "facts.candidates" });
		expect(digest()).toBe(before);
		expect(Buffer.byteLength(lines.at(-1)!)).toBeLessThanOrEqual(HOST_CONTROL_MAX_RESPONSE_BYTES);
		if (!response.success || response.data.kind !== "fact-candidates") throw new Error(JSON.stringify(response));
		expect(response.data.projectRevision).toBe(3);
		expect(response.data.candidates).toHaveLength(1);
		expect(response.data.candidates[0]).toMatchObject({ source: { runId: "run-2", kind: "policy_denied" } });

		expect((await FileStateStore.readSnapshot(cwd)).state?.projectFacts).toBeUndefined();
		const snapshot = await send({ id: "snapshot", type: "control.snapshot" });
		if (!snapshot.success || snapshot.data.kind !== "snapshot") throw new Error(JSON.stringify(snapshot));
		expect(snapshot.data.state.projectFacts.entries).toEqual([]);
		expect(snapshot.data.state.factPreview).toBeNull();
	});
	it("answers an empty list for a project without state and rejects extra fields", async () => {
		const response = await send({ id: "empty", type: "facts.candidates" });
		expect(response).toMatchObject({ success: true, data: { kind: "fact-candidates", candidates: [] } });
		expect(await send({ id: "extra", type: "facts.candidates", ownerId: "x" })).toMatchObject({
			success: false,
			error: { code: "INVALID_REQUEST" },
		});
	});
});
