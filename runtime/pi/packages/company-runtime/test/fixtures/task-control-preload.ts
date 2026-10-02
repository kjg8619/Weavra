/** Test-only preload for the actual launcher-control.ts entry. No transport or storage implementation is replaced. */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Context, fauxAssistantMessage, fauxThinking, fauxToolCall } from "@earendil-works/pi-ai";
import { createHarness, getMessageText } from "../../../coding-agent/test/suite/harness.ts";
import type { AnalysisContext, TaskBinding } from "../../src/contracts.ts";
import { HostControlBridge } from "../../src/host-control.ts";
import type { AgentExecutionRequest } from "../../src/ports.ts";
import { FileStateStore } from "../../src/state-store.ts";
import { StandardWorkflow } from "../../src/workflow.ts";

const harness = await createHarness({ models: [{ id: "coding" }, { id: "review" }] });
const mode = process.env.WEAVRA_TASK_TEST_MODE ?? "success";
const cwd = process.cwd();
const send = (value: unknown) => {
	if (!process.send) throw new Error("This fixture requires its owned IPC channel");
	process.send(value);
};
send({ kind: "harness-root", path: harness.tempDir });
process.once("exit", () => harness.cleanup());

async function barrier(name: string) {
	if (mode !== name) return;
	await new Promise<void>((resolve, reject) => {
		if (!process.send) return reject(new Error("IPC unavailable"));
		process.send({ kind: "barrier", name }, (error) => (error ? reject(error) : resolve()));
	});
	process.kill(process.pid, "SIGSTOP");
}

type WorkerInput = AgentExecutionRequest & {
	reviewedAnalysis?: { binding: TaskBinding; packet: AnalysisContext; historical: boolean };
};
function input(context: Context): WorkerInput {
	const value: WorkerInput = JSON.parse(getMessageText(context.messages.find((message) => message.role === "user")));
	send({
		kind: "provider-use",
		role: value.role,
		taskId: value.task.id,
		tools: context.tools?.map((tool) => tool.name),
		binding: value.reviewedAnalysis?.binding,
		packet: value.reviewedAnalysis?.packet,
		historical: value.reviewedAnalysis?.historical,
		contextDigest: value.taskContextPack?.digest,
		sources: value.taskContextPack?.snippets.map(({ path, fileDigest }) => ({ path, fileDigest })),
		projectFacts: "projectFacts" in value ? value.projectFacts : undefined,
		privateReasoningPresent: JSON.stringify(context).includes("TASK2_PRIVATE_REASONING"),
	});
	return value;
}
function handoff(context: Context, changed: boolean) {
	const value = input(context);
	return fauxAssistantMessage(
		[
			fauxThinking("TASK2_PRIVATE_REASONING"),
			fauxToolCall("submit_handoff", {
				runId: value.runId,
				revision: value.revision,
				role: "Developer",
				task: value.task.id,
				changed_files: changed ? ["src/value.ts"] : [],
				summary: "Selected task handled",
				assumptions: [],
				tests_run: [],
				known_risks: [],
				unresolved: [],
			}),
		],
		{ stopReason: "toolUse" },
	);
}
harness.setResponses(
	mode === "forged-pass" || mode === "failed-before-cleanup"
		? [(context) => handoff(context, false)]
		: [
				(context) => {
					input(context);
					return fauxAssistantMessage(
						fauxToolCall("runtime_write", { path: "src/value.ts", content: "export const value = 1;\n" }),
						{ stopReason: "toolUse" },
					);
				},
				(context) => handoff(context, true),
				(context) => {
					const value = input(context);
					if (value.role !== "Reviewer") throw new Error("Expected independent Reviewer");
					return fauxAssistantMessage(
						fauxToolCall("submit_review", {
							runId: value.runId,
							revision: value.revision,
							role: "Reviewer",
							task: value.task.id,
							result: "PASS",
							issues: [],
							diffDigest: value.verification.diffDigest,
							criteria: value.task.acceptanceCriteria.map((criterion) => ({
								criterionId: criterion.id,
								status: "MET",
								evidenceRefs: value.verification.evidenceRefs,
							})),
							evidenceRefs: value.verification.evidenceRefs,
						}),
						{ stopReason: "toolUse" },
					);
				},
			],
);

const openStore = FileStateStore.open;
let initialRunSave = false;
FileStateStore.open = async function (path, options = {}) {
	return openStore.call(this, path, {
		...options,
		beforeAtomicStep: (file, step) => {
			options.beforeAtomicStep?.(file, step);
			if (mode === "fail-cleanup-entry-projection" && file === "tasks.json" && step === "rename") {
				const state = JSON.parse(readFileSync(join(path, ".ai/state.json"), "utf8"));
				if (
					state.taskAdmissions?.some(
						(entry: { outcome: { status: string }; cleanup?: string }) =>
							entry.outcome.status === "ACCEPTED" && entry.cleanup === "UNCONFIRMED",
					)
				)
					throw new Error("Scripted lifecycle projection failure after canonical commit");
			}
			if (
				file === "tasks.json" &&
				step === "rename" &&
				((mode === "fail-accept-projection" && !initialRunSave) ||
					(mode === "fail-run-projection" && initialRunSave))
			)
				throw new Error("Scripted projection failure after canonical commit");
		},
	});
};
const saveAdmission = FileStateStore.prototype.saveTaskAdmission;
FileStateStore.prototype.saveTaskAdmission = async function (admission, revision) {
	if (admission.outcome.status === "ACCEPTED") await barrier("before-accept");
	const saved = await saveAdmission.call(this, admission, revision);
	if (admission.outcome.status === "ACCEPTED") await barrier("after-accept");
	return saved;
};
const saveRun = FileStateStore.prototype.save;
FileStateStore.prototype.save = async function (run) {
	if (run.taskBinding && run.revision === 1) await barrier("before-run");
	initialRunSave = run.taskBinding !== undefined && run.revision === 1;
	try {
		await saveRun.call(this, run);
	} finally {
		initialRunSave = false;
	}
	if (run.taskBinding && run.revision === 1) await barrier("after-run");
};
const closeStore = FileStateStore.prototype.close;
FileStateStore.prototype.close = async function () {
	if (this.projectPath === cwd && this.snapshot.taskAdmissions?.some((entry) => entry.cleanup === "CONFIRMED"))
		await barrier("before-cleanup-close");
	await closeStore.call(this);
	if (this.projectPath === cwd) {
		send({ kind: "writer-closed" });
		await barrier("after-cleanup");
	}
};
const execute = StandardWorkflow.prototype.execute;
StandardWorkflow.prototype.execute = async function () {
	const report = await execute.call(this);
	send({ kind: "workflow-settled", runId: report.run?.runId ?? null });
	return report;
};
const create = HostControlBridge.create;
HostControlBridge.create = async function (options) {
	const bridge = await create.call(this, {
		...options,
		createModels: async (signal) => {
			send({ kind: "model-initializing" });
			if (mode === "fail-model") throw new Error("Scripted model initialization failure");
			if (mode === "paused-model") {
				await new Promise<void>((resolve, reject) => {
					const release = (message: unknown) => {
						if (message === "release-model") {
							process.off("message", release);
							signal.removeEventListener("abort", abort);
							resolve();
						}
					};
					const abort = () => {
						process.off("message", release);
						reject(signal.reason);
					};
					process.on("message", release);
					signal.addEventListener("abort", abort, { once: true });
					if (signal.aborted) abort();
				});
			}
			return harness.session.modelRuntime;
		},
		events: {
			emit: async (event) => {
				if (mode === "failed-before-cleanup" && event.type === "RunBlocked") await barrier(mode);
				if (event.type === "RunCreated")
					send({ kind: "run-lock", lock: JSON.parse(readFileSync(join(cwd, ".ai/writer.lock"), "utf8")) });
				if (mode === "late-source" && event.type === "AgentSessionCreated" && event.role === "Developer")
					writeFileSync(join(cwd, "src/value.ts"), "export const value = 9;\n");
				send({ kind: "runtime-event", event });
			},
		},
	});
	if (mode === "checkout-config-drift") {
		const configuration = Reflect.get(bridge, "configuration");
		if (typeof configuration !== "function") throw new Error("Missing checkout configuration seam");
		let reads = 0;
		Reflect.set(bridge, "configuration", async (...args: unknown[]) => {
			if (++reads === 2) await barrier(mode);
			return Reflect.apply(configuration, bridge, args);
		});
	}
	if (mode === "checkout-state-drift") {
		const canonical = Reflect.get(bridge, "canonical");
		if (typeof canonical !== "function") throw new Error("Missing checkout state seam");
		let reads = 0;
		Reflect.set(bridge, "canonical", async (...args: unknown[]) => {
			if (++reads === 2) await barrier(mode);
			return Reflect.apply(canonical, bridge, args);
		});
	}
	return bridge;
};
