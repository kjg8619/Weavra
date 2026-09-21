import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { type Context, fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { PiAgentExecutor } from "../../../company-runtime/src/agent-runner.ts";
import { parseRuntimeConfig } from "../../../company-runtime/src/config.ts";
import { attachHostBridgeStreams, ReadOnlyHostBridge } from "../../../company-runtime/src/host-bridge.ts";
import type { HostBridgeEvent, HostBridgeResponse } from "../../../company-runtime/src/host-bridge-protocol.ts";
import type { AgentExecutionRequest } from "../../../company-runtime/src/ports.ts";
import { FileStateStore } from "../../../company-runtime/src/state-store.ts";
import { buildTaskContract } from "../../../company-runtime/src/task-contract.ts";
import { StandardWorkflow } from "../../../company-runtime/src/workflow.ts";
import { createHarness, getMessageText } from "./harness.ts";

function hostClient(bridge: ReadOnlyHostBridge) {
	const input = new PassThrough();
	const output = new PassThrough();
	const pending = new Map<string, (response: HostBridgeResponse) => void>();
	const events: HostBridgeEvent[] = [];
	let sequence = 0;
	let buffer = "";
	output.on("data", (chunk: Buffer) => {
		buffer += chunk.toString("utf8");
		for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
			const message = JSON.parse(buffer.slice(0, end)) as HostBridgeResponse | HostBridgeEvent;
			buffer = buffer.slice(end + 1);
			if (message.type === "runtime_event") events.push(message);
			else if (message.id) {
				pending.get(message.id)?.(message);
				pending.delete(message.id);
			}
		}
	});
	const connection = attachHostBridgeStreams(bridge, input, output);
	return {
		events,
		request(type: string) {
			const id = `request-${++sequence}`;
			const result = new Promise<HostBridgeResponse>((resolve) => {
				pending.set(id, resolve);
			});
			input.write(`${JSON.stringify({ protocolVersion: 1, id, type })}\n`);
			return result;
		},
		close() {
			connection.close();
			input.destroy();
			output.destroy();
		},
	};
}

it("connects real Runtime/SDK events to JSONL, reconnects during active ownership, and never gains a control port", async () => {
	const harness = await createHarness({ models: [{ id: "coding" }] });
	const cwd = join(harness.tempDir, "project");
	const agentDir = join(harness.tempDir, "workers");
	mkdirSync(agentDir);
	const config = parseRuntimeConfig(
		JSON.stringify({
			schemaVersion: 1,
			models: {
				profiles: {
					coding: { provider: "faux", model: "coding" },
					reasoning: { provider: "faux", model: "coding" },
				},
			},
			runtime: { workflow: "QUICK" },
			files: { allowed_paths: ["src"] },
			verification: {
				trust: { mode: "strict" },
				checks: [
					{
						id: "regression",
						kind: "test",
						executable: process.execPath,
						args: ["oracle/check.mjs"],
						trust: { files: ["oracle/check.mjs"] },
					},
				],
			},
		}),
	);
	const source = "export const app = 1;\n";
	const files = {
		"src/app.ts": source,
		"oracle/check.mjs":
			'import assert from "node:assert/strict"; import { readFileSync } from "node:fs"; assert.equal(readFileSync("src/app.ts", "utf8"), "export const app = 1;\\n");\n',
		".ai/config.yaml": JSON.stringify(config),
		".gitignore": ".ai/state.json\n.ai/tasks.json\n.ai/writer.lock\n",
	};
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(dirname(join(cwd, path)), { recursive: true });
		writeFileSync(join(cwd, path), content);
	}
	const git = (...args: string[]) =>
		execFileSync(
			"git",
			[
				"-c",
				"core.hooksPath=/dev/null",
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@invalid",
				"-c",
				"commit.gpgsign=false",
				...args,
			],
			{
				cwd,
				stdio: "pipe",
				env: {
					PATH: process.env.PATH,
					HOME: harness.tempDir,
					GIT_CONFIG_NOSYSTEM: "1",
					GIT_CONFIG_GLOBAL: "/dev/null",
				},
			},
		);
	git("init", "-q");
	git("add", "--", ...Object.keys(files));
	git("commit", "-qm", "Read-only Host fixture");
	const bridge = new ReadOnlyHostBridge({ cwd, projectTrusted: true });
	let client = hostClient(bridge);
	let queriedCreation = false;
	let reconnected = false;
	const eventChecks: Promise<void>[] = [];
	harness.setResponses([
		fauxAssistantMessage(fauxToolCall("runtime_read", { path: "src/app.ts" }), { stopReason: "toolUse" }),
		(context: Context) => {
			const request = JSON.parse(
				getMessageText(context.messages.find((message) => message.role === "user")),
			) as AgentExecutionRequest;
			return fauxAssistantMessage(
				fauxToolCall("submit_handoff", {
					runId: request.runId,
					revision: request.revision,
					role: "Executor",
					task: request.task.id,
					changed_files: [],
					summary: "The module exports app = 1",
					assumptions: [],
					tests_run: [],
					known_risks: [],
					unresolved: [],
					criteria: request.task.acceptanceCriteria.map((criterion) => ({
						criterionId: criterion.id,
						status: "MET",
						explanation: "Read the named source without changes",
					})),
				}),
				{ stopReason: "toolUse" },
			);
		},
	]);
	const goal = "Explain src/app.ts";
	const workflow = new StandardWorkflow({
		cwd,
		goal,
		executionMode: "READ_ONLY",
		config,
		taskContract: buildTaskContract({
			goal,
			statements: ["Explain src/app.ts without changes"],
			workflow: "QUICK",
			config,
		}),
		createAgents: async (store, quickScope, _r2RunId, _r3Scope, executionContract) => {
			const executor = await PiAgentExecutor.create({
				cwd,
				agentDir,
				config,
				executionContract,
				quickScope,
				modelRuntime: harness.session.modelRuntime,
				audit: store,
				timeoutMs: 10000,
			});
			return { executor, policy: executor.policyContext };
		},
		events: {
			emit: async (event) => {
				bridge.emit(event);
				const inspect = async () => {
					if (event.type === "RunCreated") {
						// The owner has not assigned workflow.snapshot yet; the committed canonical source already exists.
						expect(await client.request("snapshot")).toMatchObject({
							success: true,
							runId: event.runId,
							stateRevision: event.stateRevision,
							data: { status: { run: { status: "CREATED" } } },
						});
						queriedCreation = true;
					}
					if (event.type === "AgentStarted") {
						const before = readFileSync(join(cwd, ".ai/state.json"), "utf8");
						const calls = harness.faux.state.callCount;
						client.close();
						client = hostClient(bridge);
						await client.request("hello");
						expect(client.events).toEqual([]);
						expect(await client.request("cancel")).toMatchObject({
							success: false,
							error: { code: "UNSUPPORTED_COMMAND" },
						});
						expect(await client.request("snapshot")).toMatchObject({
							success: true,
							runId: event.runId,
							stateRevision: event.stateRevision,
							data: { status: { writerPresent: true, run: { status: "RUNNING" } } },
						});
						expect(readFileSync(join(cwd, ".ai/state.json"), "utf8")).toBe(before);
						expect(harness.faux.state.callCount).toBe(calls);
						reconnected = true;
					}
				};
				// Runtime deliberately contains observer errors; retain rejection for the test owner too.
				const check = inspect();
				eventChecks.push(check);
				await check;
			},
		},
	});
	try {
		await client.request("hello");
		const report = await workflow.execute();
		await Promise.all(eventChecks);
		expect(report.run?.status, report.error).toBe("COMPLETED");
		expect(report.run?.verification.map((check) => [check.status, check.trust?.status])).toEqual([
			["PASS", "VERIFIED"],
			["PASS", "VERIFIED"],
		]);
		expect(queriedCreation && reconnected).toBe(true);
		const final = await client.request("snapshot");
		expect(final).toMatchObject({
			success: true,
			stateRevision: report.run!.revision,
			eventId: `${report.run!.runId}:${report.run!.eventSequence}`,
			data: {
				status: { writerPresent: false, run: { status: "COMPLETED", executionMode: "READ_ONLY" } },
				graphAvailable: true,
				evidence: { currentChecks: { passed: 2 }, workers: { count: 1 } },
			},
		});
		expect(client.events.at(-1)?.event.type).toBe("RunCompleted");
		expect((await FileStateStore.readSnapshot(cwd)).writerPresent).toBe(false);
		expect(readFileSync(join(cwd, "src/app.ts"), "utf8")).toBe(source);
		expect(harness.faux.state.callCount).toBe(2);
	} finally {
		client.close();
		bridge.close();
		harness.cleanup();
	}
});
