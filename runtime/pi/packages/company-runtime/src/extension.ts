import {
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
	getAgentDir,
	type ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { loadRuntimeConfig } from "./config.ts";
import type { RuntimeEventSink } from "./events.ts";
import { formatEvidencePack, projectEvidencePack } from "./evidence.ts";
import { GraphProjectionError, projectRunGraph, renderGraphText } from "./graph.ts";
import { GraphViewSession } from "./graph-view-component.ts";
import {
	applyHostWorkflowRecipe,
	createHostWorkflow,
	finalizeHostWorkflowPlan,
	HostWorkflowError,
	type HostWorkflowPlan,
	prepareHostWorkflowDraft,
} from "./host-workflow.ts";
import { registerLspCommand } from "./lsp/command.ts";
import {
	displayText,
	formatConfiguration,
	formatHistory,
	formatRunView,
	ObservationInputError,
	pageNumber,
	type RunView,
} from "./observations.ts";
import { formatPlanPreview } from "./plan-preview.ts";
import { FileStateStore } from "./state-store.ts";
import { formatWeavraStatus } from "./status.ts";
import { parseAcceptanceStatements } from "./task-contract.ts";
import { parseWorkflowRunArgument } from "./task-recipe-command.ts";
import { recipeInputTemplate } from "./task-recipes.ts";
import { formatWorkflowReport, type StandardWorkflow, type WorkflowReport } from "./workflow.ts";

/** Explicit composition seam for local faux tests/Hosts, not a worker-visible provider registration mechanism. */
export interface CompanyExtensionOptions {
	agentDir?: string;
	createModels?: (signal: AbortSignal) => Promise<ModelRuntime>;
	events?: RuntimeEventSink;
	approvalTimeoutMs?: number;
}
export function registerCompanyRuntime(
	pi: Pick<ExtensionAPI, "registerCommand" | "on">,
	options: CompanyExtensionOptions = {},
): void {
	let pending: Promise<void> | undefined;
	let exporting: Promise<void> | undefined;
	let workflow: StandardWorkflow | undefined;
	let cancellation: AbortController | undefined;
	let last: WorkflowReport | undefined;
	let project: string | undefined;
	let graphViewer: GraphViewSession | undefined;
	const closeGraphViewer = () => {
		const viewer = graphViewer;
		graphViewer = undefined;
		viewer?.close();
	};
	// One namespaced footer entry, not a replacement footer or a second Run store.
	let statusUI: ExtensionContext["ui"] | undefined;
	let statusText: string | undefined;
	const clearStatus = () => {
		const ui = statusUI;
		statusUI = undefined;
		statusText = undefined;
		try {
			ui?.setStatus("weavra.runtime", undefined);
		} catch {
			// Best effort: a broken UI must not prevent cancellation/cleanup.
		}
	};
	const updateStatus = (runId?: string) => {
		try {
			if (!statusUI) return;
			const run = workflow?.snapshot;
			// Recovery events for old runs are not evidence of a locally executing worker.
			if (runId && run?.runId !== runId) return;
			const text = formatWeavraStatus(run, pending !== undefined, pending ? undefined : last?.error);
			if (text === statusText) return;
			statusUI.setStatus("weavra.runtime", text);
			statusText = text;
		} catch {
			// Also contain snapshot/formatting errors. Retry only on a later update, never on a timer.
			try {
				statusUI?.setStatus("weavra.runtime", undefined);
			} catch {
				// A failed clear is not an execution result either.
			}
			statusText = undefined;
		}
	};
	const cancel = async () => {
		cancellation?.abort();
		workflow?.cancel();
		await pending;
		await exporting;
	};
	const leaveSession = async () => {
		closeGraphViewer();
		// Detach before awaiting cleanup so late events/finally cannot repopulate the old footer.
		clearStatus();
		await cancel();
	};
	const inspect = async (ctx: ExtensionCommandContext, runId?: string): Promise<RunView> => {
		const id = runId === "latest" ? undefined : runId;
		if (pending && project === ctx.cwd && (!id || id === workflow?.snapshot?.runId))
			return {
				run: workflow?.snapshot,
				report: workflow?.report,
				state: workflow?.observationState,
				source: "live Kernel + action audit",
			};
		const snapshot = await FileStateStore.readSnapshot(ctx.cwd);
		const run = id ? snapshot.state?.runs.find((run) => run.runId === id) : snapshot.state?.runs.at(-1);
		if (id && !run) throw new ObservationInputError("Unknown run ID; use /workflow history");
		const diagnostics: string[] = [];
		if (snapshot.state && !snapshot.tasksCurrent)
			diagnostics.push("tasks.json is unavailable or out of sync; no repair was performed");
		if (snapshot.writerPresent)
			diagnostics.push("Writer lock present; this is not proof of a live worker. Query acquired no lock");
		else if (run && ["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run.status))
			diagnostics.push(
				"Stored active status without a writer; liveness is unconfirmed. No recovery/resume was performed",
			);
		const local = project === ctx.cwd ? last : undefined;
		if (local?.error && !local.run) diagnostics.push(`Last preflight failed: ${local.error}; no new run was created`);
		if (local?.error && local.run?.runId === run?.runId && local.run) {
			diagnostics.push(`Durable status: ${run?.status}; last local failure takes precedence`);
			return {
				run: local.run,
				report: local,
				state: snapshot.state,
				diagnostics,
				source: `local failure / stored project revision ${snapshot.state?.revision}`,
			};
		}
		return {
			run,
			state: snapshot.state,
			diagnostics,
			source: `stored project revision ${snapshot.state?.revision ?? "none"}`,
			report: local?.run?.runId === run?.runId || !run ? local : undefined,
		};
	};
	registerLspCommand(pi, (cwd) => (project === cwd && pending ? workflow?.lspStatus : undefined));
	const usage = {
		workflow: "/workflow [help|run <goal>|status [runId]|history [page]|config|cancel]",
		state: "/state [runId] | /state checks|decisions [runId] [page] | /state review [runId] | /state check <number> [runId] | /state evidence [runId] | /state export",
		team: "/team [runId]",
		risk: "/risk [runId]",
		graph: "/graph [latest|runId] | /graph view [latest|runId]",
	};
	for (const name of ["team", "state", "workflow", "risk", "graph"] as const) {
		pi.registerCommand(name, {
			description: `Weavra ${name} (QUICK R0/R1, STANDARD R0/R1/R2, scoped R3); /${name} help`,
			handler: async (args, ctx) => {
				if (!ctx.hasUI) throw new Error("Weavra commands require a notification-capable UI");
				if (!ctx.isProjectTrusted()) {
					ctx.ui.notify("Weavra: project is not trusted; no configuration or state was read.", "warning");
					return;
				}
				const argument = args.trim();
				let ownedViewer: GraphViewSession | undefined;
				try {
					if (argument === "help") {
						ctx.ui.notify(
							[
								name === "graph"
									? "Weavra Graph — V0.2A projection / V0.2B viewer (read-only)"
									: "Weavra v0.1 RC1 (development)",
								usage[name],
								...(name === "workflow"
									? [
											"QUICK: Executor only; R0 read-only, R1 one-file small change (up to 100 changed lines).",
											"STANDARD: Developer -> SELF_CHECK -> independent Reviewer -> TEST -> COMPLETE; R0/R1/R2 and scoped R3.",
											"R2 file changes require STANDARD and independent Reviewer PASS; no install/shell tools.",
											"Scoped R3: one tracked text-file deletion, separate one-time Human Approval (default Deny), then independent Reviewer and checks.",
											"Both workflows require trusted config, clean Git, required checks and fresh evidence. Approval is not completion.",
											"No automatic commit/rollback or resume. Cancel with /workflow cancel, not parent Esc.",
											usage.state,
											usage.team,
											usage.risk,
											usage.graph,
										]
									: [
											"Read-only snapshots: omitted runId/latest selects the latest run; stored PASS is not a live check.",
											...(name === "graph"
												? [
														"DAG projection only: attempts are unrolled; Approval/Mutation remain inside IMPLEMENT.",
														"/graph is ASCII; /graph view opens a static TUI-only overlay. Navigation/close only; no live updates.",
														"No lock, repair, resume, Provider, Agent or Git calls. Missing outcomes are UNKNOWN.",
														"No scheduler, node retry, parallel execution, Planner/Lead or COMPLEX graph.",
													]
												: []),
											...(name === "state"
												? ["Only /state export writes derived views; it does not resume a run."]
												: []),
											"Workflow, Reviewer and Human Approval requirements: /workflow help",
										]),
							].join("\n"),
							"info",
						);
						return;
					}
					if (name === "workflow" && argument === "config") {
						const loaded = await loadRuntimeConfig(ctx.cwd);
						ctx.ui.notify(
							loaded.status === "configured"
								? formatConfiguration(loaded.config)
								: "Weavra: .ai/config.yaml is missing",
							loaded.status === "configured" ? "info" : "warning",
						);
						return;
					}
					if (name === "state" && argument === "export") {
						if (pending || exporting || !ctx.isIdle()) {
							ctx.ui.notify("Export requires an idle parent and no active Weavra operation.", "warning");
							return;
						}
						exporting = (async () => {
							const snapshot = await FileStateStore.readSnapshot(ctx.cwd);
							if (
								!snapshot.state ||
								snapshot.writerPresent ||
								snapshot.state.runs.some((run) =>
									["CREATED", "RUNNING", "WAITING_APPROVAL"].includes(run.status),
								)
							)
								throw new Error(
									"Export refused: missing state or active/unconfirmed writer; no recovery performed",
								);
							const store = await FileStateStore.open(ctx.cwd, { recoverInterrupted: false });
							try {
								const result = await store.exportViews();
								ctx.ui.notify(
									`Exported operational projections from revision ${result.sourceRevision}: ${result.updated} file(s) updated\n${result.paths.join("\n")}\nNot execution/approval authority. No gitignore or commit changes.`,
									"info",
								);
							} finally {
								await store.close();
							}
						})()
							.catch((error) => {
								ctx.ui.notify(
									`Export failed: ${displayText(error instanceof Error ? error.message : "unknown export error")}`,
									"error",
								);
							})
							.finally(() => {
								exporting = undefined;
							});
						await exporting;
						return;
					}
					if (name === "workflow" && argument === "cancel") {
						await cancel();
						ctx.ui.notify(
							`${last ? formatWorkflowReport(last) : "Weavra: no active run."}\nNo rollback performed.`,
							last?.error ? "warning" : "info",
						);
						return;
					}
					if (name === "workflow" && argument.startsWith("run ")) {
						if (pending || exporting) {
							ctx.ui.notify("Weavra: a run is already active.", "warning");
							return;
						}
						if (!ctx.isIdle()) {
							ctx.ui.notify("Weavra: wait for the parent agent to become idle.", "warning");
							return;
						}
						const runArgument = parseWorkflowRunArgument(argument.slice(4));
						const goal = runArgument.goal;
						const recipeId = runArgument.recipeId;
						clearStatus();
						if (ctx.mode === "tui" && ctx.hasUI) statusUI = ctx.ui;
						workflow = undefined;
						last = undefined;
						project = ctx.cwd;
						cancellation = new AbortController();
						const signal = cancellation.signal;
						pending = (async () => {
							const loaded = await loadRuntimeConfig(ctx.cwd);
							if (loaded.status !== "configured") throw new Error(".ai/config.yaml is missing");
							let draft = prepareHostWorkflowDraft({ goal, config: loaded.config });
							if (recipeId && draft.workflow !== "STANDARD") {
								ctx.ui.notify(
									`Weavra: recipe ${recipeId} needs the STANDARD acceptance-criteria step; QUICK runs take a goal only. No run was created.`,
									"warning",
								);
								return;
							}
							if (recipeId) {
								const inputText = await ctx.ui.editor(
									`Recipe ${recipeId}: inputs as JSON (data only; not permission, approval or authority)`,
									recipeInputTemplate(recipeId),
								);
								if (inputText === undefined || !inputText.trim()) {
									ctx.ui.notify(
										"Weavra: recipe inputs cancelled; no run, worker, check or approval was created.",
										"info",
									);
									return;
								}
								try {
									draft = applyHostWorkflowRecipe(draft, {
										recipeId,
										inputs: JSON.parse(inputText) as Record<string, unknown>,
									});
								} catch (error) {
									ctx.ui.notify(
										`Weavra: ${error instanceof HostWorkflowError ? error.message : "recipe inputs must be a JSON object"}; no run, worker, check or approval was created.`,
										"warning",
									);
									return;
								}
							}
							// FEAT-01: Host-side plan preview. No Planner model call; the editor is the only AC input.
							const statements =
								draft.workflow === "STANDARD"
									? parseAcceptanceStatements(
											(await ctx.ui.editor(
												"Acceptance criteria: one line = one criterion (AC-001, AC-002, ... are assigned after confirmation)",
												draft.statements.join("\n"),
											)) ?? "",
										)
									: draft.statements;
							if (draft.workflow === "STANDARD" && !statements.length) {
								ctx.ui.notify("Weavra: plan cancelled; no run, worker, check or approval was created.", "info");
								return;
							}
							let plan: HostWorkflowPlan;
							try {
								plan = finalizeHostWorkflowPlan(draft, statements);
							} catch (error) {
								if (!(error instanceof HostWorkflowError) || error.code !== "INVALID_CRITERIA") throw error;
								ctx.ui.notify(`Weavra: acceptance criteria rejected: ${error.message}`, "warning");
								return;
							}
							const approved = await ctx.ui.confirm(
								"Weavra: confirm this plan? (not an approval or permission token)",
								`${formatPlanPreview(plan.preview)}\n${plan.executionMode === "READ_ONLY" ? "Worker mutation tools are unavailable. Registered checks/LSP servers remain trusted programs, not sandboxed." : "Worker edits remain subject to Policy, R2 independent review and separate R3 human approval."}\nR2 file changes require independent STANDARD review. Only preselected single-file R3 deletion can request separate human approval; no other destructive or install/shell tools.\nCredential environment is filtered. Trust only reviewed executables and scripts.`,
								{ signal },
							);
							if (!approved) {
								ctx.ui.notify(
									signal.aborted
										? "Weavra: Preflight cancelled; no run, worker, check or approval was created."
										: "Weavra: plan declined; no run, worker, check or approval was created.",
									signal.aborted ? "warning" : "info",
								);
								return;
							}
							signal.throwIfAborted();
							workflow = await createHostWorkflow({
								cwd: ctx.cwd,
								plan,
								agentDir: options.agentDir ?? getAgentDir(),
								createModels: options.createModels,
								signal,
								events: {
									emit: (event) => {
										updateStatus(event.runId);
										// Preserve the existing observer and its Kernel-owned delivery diagnostics.
										return options.events?.emit(event);
									},
								},
								approvalTimeoutMs: options.approvalTimeoutMs,
								approval: {
									requestApproval: async (request, signal) => {
										const selected =
											ctx.hasUI && ctx.isProjectTrusted() && !signal?.aborted
												? await ctx.ui.select(
														`R3: delete ONE file?\nProject: ${ctx.cwd}\nRun: ${request.runId}\nRole: ${request.role} | Step: ${request.step.stepId}@${request.step.attempt}\nTarget: ${request.path}\nBytes: ${request.bytes}\nFingerprint: ${request.preconditionDigest}\nAction: ${request.actionId}\nExpires: ${new Date(request.expiresAt).toISOString()}\nNo automatic rollback. Deny is the default.`,
														["Deny", "Approve once"],
														{ signal, timeout: Math.max(0, request.expiresAt - Date.now()) },
													)
												: undefined;
										return {
											runId: request.runId,
											actionId: request.actionId,
											actionDigest: request.actionDigest,
											configDigest: request.configDigest,
											expiresAt: request.expiresAt,
											approved:
												selected === "Approve once" &&
												ctx.hasUI &&
												ctx.isProjectTrusted() &&
												!signal?.aborted,
										};
									},
								},
							});
							last = await workflow.execute();
							ctx.ui.notify(
								formatWorkflowReport(last),
								last.run?.status === "COMPLETED" && !last.error ? "info" : "warning",
							);
						})()
							.catch((error) => {
								last = {
									changedFiles: [],
									partialChanges: false,
									changesUnknown: false,
									error: signal.aborted
										? "Preflight cancelled"
										: error instanceof Error
											? error.message
											: "Workflow preflight failed",
									recommendedAction: "Inspect configuration and workspace; no automatic retry",
								};
								ctx.ui.notify(formatWorkflowReport(last), "error");
							})
							.finally(() => {
								pending = undefined;
								// No event is emitted for some persistence/cleanup failures; reconcile the final snapshot/report.
								updateStatus();
							});
						ctx.ui.notify("Weavra: preflight started. Status/cancel remain available.", "info");
						return;
					}
					const parts = argument ? argument.split(/\s+/) : [];
					if (name === "workflow" && parts[0] === "history") {
						if (parts.length > 2) throw new ObservationInputError(usage.workflow);
						const view = await inspect(ctx);
						ctx.ui.notify(
							view.state ? formatHistory(view.state, pageNumber(parts[1])) : "Weavra: state missing; no history",
							view.state ? "info" : "warning",
						);
						return;
					}
					if (name === "state" && parts[0] === "evidence") {
						if (parts.length > 2) throw new ObservationInputError(usage.state);
						const view = await inspect(ctx, parts[1]);
						if (!view.run) ctx.ui.notify("Weavra: no run recorded; no evidence pack was produced", "warning");
						else
							ctx.ui.notify(
								formatEvidencePack(projectEvidencePack({ run: view.run, report: view.report })),
								"info",
							);
						return;
					}
					let detail = "summary";
					let id: string | undefined;
					let number = 1;
					if (name === "graph" && parts[0] === "view") {
						if (parts.length > 2) throw new ObservationInputError(usage.graph);
						if (ctx.mode !== "tui")
							throw new ObservationInputError(
								"Weavra Graph Viewer requires TUI mode. Use /graph for text output.",
							);
						if (graphViewer && !graphViewer.closed)
							throw new ObservationInputError(
								"Weavra Graph Viewer is already open; close it before opening another.",
							);
						ownedViewer = new GraphViewSession();
						graphViewer = ownedViewer;
						id = parts[1];
					} else if (name === "workflow") {
						if (parts.length && (parts[0] !== "status" || parts.length > 2))
							throw new ObservationInputError(usage.workflow);
						id = parts[1];
					} else if (name === "state" && parts[0] === "check") {
						if (parts.length < 2 || parts.length > 3) throw new ObservationInputError(usage.state);
						detail = "check";
						number = pageNumber(parts[1]);
						id = parts[2];
					} else if (name === "state" && ["checks", "review", "decisions"].includes(parts[0])) {
						if (parts.length > 3 || (parts[0] === "review" && parts.length > 2))
							throw new ObservationInputError(usage.state);
						detail = parts[0];
						id = parts[1];
						number = pageNumber(parts[2]);
					} else {
						if (parts.length > 1) throw new ObservationInputError(usage[name]);
						id = parts[0];
					}
					if (
						pending &&
						project === ctx.cwd &&
						!workflow?.snapshot &&
						(!id || (name === "graph" && id === "latest"))
					) {
						ctx.ui.notify("Weavra: preflight in progress; /workflow cancel is available.", "info");
						return;
					}
					const view = await inspect(ctx, id);
					if (ownedViewer?.closed) return;
					if (name === "graph") {
						const graph = view.run ? projectRunGraph(view.run) : undefined;
						if (ownedViewer && graph) {
							await ownedViewer.show(ctx, graph, {
								source: view.source,
								diagnostics: [
									...(view.diagnostics ?? []),
									...(view.report?.diagnostics ?? []),
									...(view.report?.error ? [`Local report: ${view.report.error}`] : []),
								],
							});
							return;
						}
						const output = [
							graph ? renderGraphText(graph) : "Weavra Graph: state missing or no run recorded.",
							`Source: ${displayText(view.source)}; stored active state is not proof of a live worker.`,
							...(view.diagnostics ?? []).map((message) => `Warning: ${displayText(message)}`),
							...(view.report?.diagnostics ?? []).map((message) => `Warning: ${displayText(message)}`),
							...(view.report?.error ? [`Local report: ${displayText(view.report.error)}`] : []),
						].join("\n");
						ctx.ui.notify(displayText(output, 32000, true), view.run ? "info" : "warning");
						return;
					}
					ctx.ui.notify(formatRunView(name, view, detail, number), view.run ? "info" : "warning");
				} catch (error) {
					if (ownedViewer?.closed && graphViewer !== ownedViewer) return;
					if (error instanceof ObservationInputError || error instanceof GraphProjectionError) {
						ctx.ui.notify(error.message, "warning");
						return;
					}
					ctx.ui.notify(
						"Weavra command failed; check configuration, state integrity and writer ownership.",
						"error",
					);
				} finally {
					ownedViewer?.close();
					if (graphViewer === ownedViewer) graphViewer = undefined;
				}
			},
		});
	}
	pi.on("session_start", (_event, ctx) => {
		closeGraphViewer();
		clearStatus();
		if (ctx.mode === "tui" && ctx.hasUI) {
			statusUI = ctx.ui;
			clearStatus();
			ctx.ui.notify(
				"Weavra Runtime loaded — v0.1 RC1 (development)\nQUICK / STANDARD · R0–R2 / scoped R3\n/workflow · /state · /team · /risk · /graph — /workflow help",
				"info",
			);
		}
	});
	pi.on("input", () => (pending || exporting ? { action: "handled" } : { action: "continue" }));
	pi.on("tool_call", () =>
		pending || exporting
			? { block: true, reason: "Weavra workflow owns workspace; use /workflow cancel", terminate: true }
			: undefined,
	);
	pi.on("user_bash", () =>
		pending || exporting
			? {
					result: {
						output: "Weavra workflow owns workspace; user bash blocked",
						exitCode: 1,
						cancelled: false,
						truncated: false,
					},
				}
			: undefined,
	);
	pi.on("session_before_switch", leaveSession);
	pi.on("session_before_fork", leaveSession);
	pi.on("session_before_tree", leaveSession);
	pi.on("session_shutdown", leaveSession);
}

export default function companyRuntime(pi: ExtensionAPI): void {
	registerCompanyRuntime(pi);
}
