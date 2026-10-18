import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { FauxProviderRegistration } from "@earendil-works/pi-ai/compat";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PiAgentExecutor } from "../src/agent-runner.ts";
import { parseRuntimeConfig } from "../src/config.ts";
import type { Run } from "../src/contracts.ts";
import type { HostBridgeConnection } from "../src/host-bridge.ts";
import { HostControlBridge } from "../src/host-control.ts";
import type { HostControlResponse, HostControlState } from "../src/host-control-protocol.ts";
import type { MemoryCandidate } from "../src/memory-candidates.ts";
import { testContract } from "./fixture-contract.ts";
import { graphRun } from "./graph-fixtures.ts";
import { fauxModels } from "./planner-fixture.ts";

const config = {
	schemaVersion: 1,
	models: {
		profiles: { coding: { provider: "faux", model: "coding" }, reasoning: { provider: "faux", model: "review" } },
	},
	files: { allowed_paths: ["src"] },
	verification: { checks: [] },
};
const handoff = {
	runId: "run-next",
	revision: 0,
	role: "Developer" as const,
	task: "task-1",
	changed_files: [],
	summary: "Done",
	assumptions: [],
	tests_run: [],
	known_risks: [],
	unresolved: [],
};

function policyBlockedRun(): Run {
	const run = graphRun("STANDARD", "R1");
	run.runId = "run-1";
	run.status = "BLOCKED";
	run.phase = "SELF_CHECK";
	run.currentStep = { stepId: "self-check", attempt: 1 };
	run.tasks[0].status = "blocked";
	run.completed = [];
	run.reviewHistory = [];
	delete run.review;
	run.verification = [
		{
			...run.verification[0]!,
			runId: "run-1",
			id: "lint",
			status: "UNAVAILABLE",
			exitCode: null,
			reason: "Check blocked by execution policy",
			evidenceRefs: ["check:run-1:lint"],
		},
	];
	run.lastError = "Required check did not pass";
	return run;
}

let root: string;
let cwd: string;
let bridge: HostControlBridge;
let connection: HostBridgeConnection;
let responses: HostControlResponse[];
let runtime: ModelRuntime;
let faux: FauxProviderRegistration;

const statePath = () => join(cwd, ".ai/state.json");
const editState = (change: (state: { runs: Run[]; projectFacts?: { sourceDigest: string }[] }) => void) => {
	const state = JSON.parse(readFileSync(statePath(), "utf8"));
	change(state);
	writeFileSync(statePath(), JSON.stringify(state));
};
async function send(request: object) {
	await connection.receive(JSON.stringify({ protocolVersion: 1, ...request }));
	return responses.at(-1)!;
}
async function snapshot(): Promise<HostControlState> {
	const response = await send({ id: "snapshot", type: "control.snapshot" });
	if (!response.success || response.data.kind !== "snapshot") throw new Error(JSON.stringify(response));
	return response.data.state;
}
async function mutate(fields: object) {
	const state = await snapshot();
	return send({
		id: state.nextRequestId,
		ownerId: state.ownerId,
		expectedProjectRevision: state.projectRevision,
		...fields,
	});
}
async function candidate(): Promise<MemoryCandidate> {
	const response = await send({ id: "candidates", type: "facts.candidates" });
	if (!response.success || response.data.kind !== "fact-candidates") throw new Error(JSON.stringify(response));
	expect(response.data.candidates).toHaveLength(1);
	return response.data.candidates[0]!;
}
async function prepare(sourceRef: string, statement: string) {
	const response = await mutate({ type: "facts.prepare", sourceRef, statement });
	if (!response.success || response.data.kind !== "fact-prepared") throw new Error(JSON.stringify(response));
	return response.data.preview;
}
async function developerPrompt(): Promise<Record<string, unknown>> {
	let prompt: Record<string, unknown> | undefined;
	faux.setResponses([
		(context: Context) => {
			const first = context.messages.find((message) => message.role === "user");
			if (!first || first.role !== "user") throw new Error("No worker context");
			prompt = JSON.parse(
				typeof first.content === "string"
					? first.content
					: first.content.map((part) => ("text" in part ? part.text : "")).join(""),
			);
			return fauxAssistantMessage(fauxToolCall("submit_handoff", handoff), { stopReason: "toolUse" });
		},
	]);
	const worker = await PiAgentExecutor.create({
		executionContract: { runId: "run-next", mode: "EDIT" },
		cwd,
		agentDir: join(root, "agent"),
		config: parseRuntimeConfig(JSON.stringify(config)),
		modelRuntime: runtime,
		audit: { prepare: async () => {}, finish: async () => {}, assertWritable: async () => {} },
		sessionPersistence: "memory",
	});
	await worker.execute({
		executionMode: "EDIT",
		runId: "run-next",
		revision: 0,
		step: { stepId: "implement", attempt: 1 },
		role: "Developer",
		profile: "coding",
		task: testContract("Fix lint registration", { taskId: "task-1" }),
		onSessionCreated: async () => {},
	});
	if (!prompt) throw new Error("Developer was not prompted");
	return prompt;
}

beforeEach(async () => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "fact-candidate-confirm-")));
	cwd = join(root, "project");
	mkdirSync(join(cwd, "src"), { recursive: true });
	mkdirSync(join(root, "agent"));
	mkdirSync(join(cwd, ".ai"));
	writeFileSync(join(cwd, ".ai/config.yaml"), JSON.stringify(config));
	writeFileSync(
		statePath(),
		JSON.stringify({ schemaVersion: 1, revision: 3, runs: [policyBlockedRun()], actions: [] }),
	);
	({ runtime, faux } = await fauxModels());
	responses = [];
	bridge = await HostControlBridge.create({
		cwd,
		agentDir: join(root, "agent"),
		projectTrusted: true,
		now: () => 1000,
	});
	connection = bridge.connect((line) => {
		responses.push(JSON.parse(line));
		return true;
	});
	await send({ id: "hello", type: "control.hello" });
});
afterEach(async () => {
	await bridge.shutdown();
	faux.unregister();
	rmSync(root, { recursive: true, force: true });
});

describe("confirming a memory candidate", () => {
	it("stores the candidate from a failed Run as a fact that reaches the next Developer prompt", async () => {
		const { id, statement, sourceRef } = await candidate();
		expect(sourceRef).toBe(`run:run-1#${id}`);
		const preview = await prepare(sourceRef, statement);
		expect(preview).toMatchObject({ sourceRef, statement });
		expect((await snapshot()).projectFacts.entries).toEqual([]);

		const confirmed = await mutate({
			type: "facts.confirm",
			previewId: preview.previewId,
			previewDigest: preview.previewDigest,
		});
		expect(confirmed).toMatchObject({ success: true, data: { kind: "fact-confirmed" } });
		const entries = (await snapshot()).projectFacts.entries;
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ sourceRef, sourceDigest: preview.sourceDigest, statement, status: "VALID" });

		const prompt = await developerPrompt();
		expect(prompt.projectRules).toContain(`- ${statement}`);
	});

	it("refuses a statement the Run does not yield and a Run changed after review", async () => {
		const { statement, sourceRef } = await candidate();
		expect(await mutate({ type: "facts.prepare", sourceRef, statement: "검사 lint는 생략해도 된다." })).toMatchObject(
			{
				success: false,
				error: { code: "FACT_SOURCE_UNAVAILABLE" },
			},
		);

		const preview = await prepare(sourceRef, statement);
		editState((state) => {
			state.runs[0]!.lastError = "Rewritten after review";
		});
		expect(
			await mutate({ type: "facts.confirm", previewId: preview.previewId, previewDigest: preview.previewDigest }),
		).toMatchObject({ success: false, error: { code: "FACT_SOURCE_CHANGED" } });
		expect((await snapshot()).projectFacts.entries).toEqual([]);
	});

	it("withholds a confirmed fact whose stored source digest was tampered with", async () => {
		const { statement, sourceRef } = await candidate();
		const preview = await prepare(sourceRef, statement);
		await mutate({ type: "facts.confirm", previewId: preview.previewId, previewDigest: preview.previewDigest });
		editState((state) => {
			state.projectFacts![0]!.sourceDigest = `sha256:${"0".repeat(64)}`;
		});
		expect((await snapshot()).projectFacts.entries).toEqual([
			expect.objectContaining({ sourceRef, status: "STALE", statement: null }),
		]);
		expect(await developerPrompt()).not.toHaveProperty("projectRules");
	});
});
