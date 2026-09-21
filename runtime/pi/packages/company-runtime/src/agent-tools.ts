import { createHash, randomUUID } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	ftruncateSync,
	lstatSync,
	openSync,
	readFileSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ANCHORED_EDIT_GUIDANCE, mintReadReceipt, StaleAnchorError, StaleMutationError } from "./anchored-edit.ts";
import {
	type AnchoredFileIdentity,
	createAnchoredFile,
	editAnchoredFile,
	readAnchoredFile,
	readAnchoredSnapshot,
	replaceAnchoredFile,
} from "./anchored-files.ts";
import { parseRuntimeConfig, type RuntimeConfig } from "./config.ts";
import {
	ExecutorHandoffSchema,
	HandoffSchema,
	type Review,
	ReviewSchema,
	type VerificationResult,
	validateContract,
} from "./contracts.ts";
import { assertExecutionContract, bindExecutionContract } from "./execution-contract.ts";
import { createListFilesTool } from "./list-files-tool.ts";
import { createLspTools } from "./lsp/tools.ts";
import {
	type ActionAudit,
	evaluatePolicy,
	executePolicyAction,
	type PolicyContext,
	type PolicyPathInspector,
} from "./policy.ts";
import type { AgentExecutionRequest, AgentExecutionResult } from "./ports.ts";

const text = Type.String({ minLength: 1, maxLength: 262144 });
const pathSchema = Type.String({ minLength: 1, maxLength: 4096 });
const strict = { additionalProperties: false } as const;
const MAX_BYTES = 262144;
// Only whole-entry, well-known English obligation statements. Mixed/ambiguous problem descriptions remain unresolved.
// This is submission feedback, never evidence that an obligation was fulfilled or permission to filter a handoff.
const RUNTIME_OBLIGATION_ONLY =
	/^(?:(?:independent )?reviewer(?: pass| execution)?|self[_ -]?check|(?:final )?test|human approval) (?:(?:is )?(?:required|needed)(?: and remains pending)?|(?:is |remains )?(?:still )?pending)[.!]?$/i;
/** Model-correctable coverage error: exact frozen AC IDs, one result each, no unknown or duplicate IDs. */
function criterionCoverageError(
	items: ReadonlyArray<{ criterionId: string }>,
	criteria: ReadonlyArray<{ id: string }>,
	source: string,
): string | undefined {
	const expected = new Set(criteria.map((criterion) => criterion.id));
	const seen = new Set<string>();
	const unknown: string[] = [];
	const duplicates: string[] = [];
	for (const item of items) {
		if (!expected.has(item.criterionId)) unknown.push(item.criterionId);
		else if (seen.has(item.criterionId)) duplicates.push(item.criterionId);
		else seen.add(item.criterionId);
	}
	const missing = [...expected].filter((id) => !seen.has(id));
	if (!unknown.length && !duplicates.length && !missing.length) return undefined;
	const details = [
		unknown.length ? `unknown: ${unknown.join(", ")}` : undefined,
		duplicates.length ? `duplicate: ${duplicates.join(", ")}` : undefined,
		missing.length ? `missing: ${missing.join(", ")}` : undefined,
	]
		.filter(Boolean)
		.join("; ");
	return (
		`${source} criteria must match the frozen acceptance criteria exactly (${details}). ` +
		`Expected IDs: ${[...expected].join(", ")}. Statements are not identity and cannot replace IDs. ` +
		"Nothing was accepted. Correct the fields and resubmit alone in this same session."
	);
}

export const WORKER_FILE_TOOLS = [
	{ id: "runtime_read", operation: "read" },
	{ id: "runtime_search", operation: "search" },
	{ id: "runtime_list_files", operation: "list" },
	{ id: "runtime_write", operation: "write" },
	{ id: "runtime_edit", operation: "edit" },
] as const;

/** Stable for the frozen JSON-shaped input constructed by this adapter. Never hashes credentials. */
export function workerDigest(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Exact verifier-owned references for this attempt; handoff prose and digests are not reference sources. */
export function trustedReviewEvidenceRefs(verification: VerificationResult): string[] {
	return [...new Set([...verification.evidenceRefs, ...verification.checks.flatMap((check) => check.evidenceRefs)])];
}

function readText(path: string): string {
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_BYTES) throw new Error("Unsupported worker file");
		const content = readFileSync(fd, "utf8");
		if (content.includes("\0") || Buffer.byteLength(content) > MAX_BYTES) throw new Error("Unsupported worker text");
		return content;
	} finally {
		closeSync(fd);
	}
}

function deletionFingerprint(path: string): { preconditionDigest: string; bytes: number } {
	const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
	try {
		const stat = fstatSync(fd);
		const current = lstatSync(path);
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			stat.size > MAX_BYTES ||
			current.ino !== stat.ino ||
			current.dev !== stat.dev ||
			current.isSymbolicLink()
		)
			throw new Error("Unsafe deletion target");
		const bytes = readFileSync(fd);
		if (bytes.length > MAX_BYTES || bytes.includes(0) || !Buffer.from(bytes.toString("utf8")).equals(bytes))
			throw new Error("Deletion supports bounded text files only");
		return {
			bytes: bytes.length,
			preconditionDigest: workerDigest({
				dev: stat.dev,
				ino: stat.ino,
				mode: stat.mode,
				size: stat.size,
				mtime: stat.mtimeMs,
				ctime: stat.ctimeMs,
				hash: createHash("sha256").update(bytes).digest("hex"),
			}),
		};
	} finally {
		closeSync(fd);
	}
}

function writeText(path: string, content: string, signal: AbortSignal): void {
	if (Buffer.byteLength(content) > MAX_BYTES) throw new Error("Worker write exceeds size limit");
	signal.throwIfAborted();
	const fd = openSync(
		path,
		constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK,
		0o600,
	);
	try {
		const stat = fstatSync(fd);
		if (!stat.isFile() || stat.nlink !== 1) throw new Error("Unsupported worker target");
		signal.throwIfAborted();
		// Small synchronous I/O: no JS callback can start another action between this check and write.
		ftruncateSync(fd, 0);
		writeFileSync(fd, content, "utf8");
	} finally {
		closeSync(fd);
	}
}

export function createWorkerTools(options: {
	cwd: string;
	request: AgentExecutionRequest;
	config: RuntimeConfig;
	policy: PolicyContext;
	paths: PolicyPathInspector;
	audit: ActionAudit;
	signal: AbortSignal;
	assertActive: () => void;
}): {
	tools: ToolDefinition[];
	result: () => AgentExecutionResult | undefined;
	policyDenial: () => string | undefined;
	consumeSubmissionValidationError: (toolName: string, toolCallId: string) => boolean;
	consumeStaleAnchorError: (toolName: string, toolCallId: string) => boolean;
} {
	const { request, signal } = options;
	const executionContract = bindExecutionContract(request.runId, request.executionMode);
	assertExecutionContract(executionContract, options.policy.executionRunId, options.policy.executionMode);
	const evidenceRefs = request.role === "Reviewer" ? trustedReviewEvidenceRefs(request.verification) : [];
	const trustedEvidence = new Set(evidenceRefs);
	// Adapter-owned classification, never a model-supplied error label. Consumed once by the SDK event handler.
	const submissionValidationErrors = new Map<string, "submit_handoff" | "submit_review">();
	const staleAnchorErrors = new Set<string>();
	// Strict mutation (FIX-07): invocation-scoped latest-read receipts. Freshness only, never permission.
	const strictMutation = options.config.mutation.mode === "strict";
	const readReceipts = new Map<string, { receipt: string; fileDigest: string; identity: AnchoredFileIdentity }>();
	const requireLatestReceipt = (
		path: string,
		token: string | undefined,
		digest: string | undefined,
	): AnchoredFileIdentity => {
		const registered = readReceipts.get(path);
		if (!registered || !token || registered.receipt !== token)
			throw new StaleMutationError(`${path} has no current read receipt; re-read the file with anchors:true`);
		if (!digest || registered.fileDigest !== digest)
			throw new StaleMutationError(`${path} read receipt does not match the supplied fileDigest`);
		return registered.identity;
	};
	let submitted: AgentExecutionResult | undefined;
	let policyDenial: string | undefined;
	const assertActive = () => {
		options.assertActive();
		assertExecutionContract(executionContract, request.runId, request.executionMode);
		assertExecutionContract(executionContract, options.policy.executionRunId, options.policy.executionMode);
		signal.throwIfAborted();
		if (submitted) throw new Error("Worker already submitted its result");
	};
	const fileAction = async (
		tool: string,
		paths: string[],
		input: unknown,
		execute: () => string | Promise<string>,
	) => {
		assertActive();
		const frozenPaths = [...paths];
		const action = {
			runId: request.runId,
			actionId: randomUUID(),
			role: request.role,
			tool,
			risk:
				tool === "runtime_write" || tool === "runtime_edit"
					? options.policy.r2RunId
						? ("R2" as const)
						: ("R1" as const)
					: ("R0" as const),
			paths: frozenPaths,
			actionDigest: workerDigest({
				executionContract,
				projectInstructionDigest: options.policy.projectInstruction?.digest ?? null,
				tool,
				paths: frozenPaths,
				input,
				step: request.step,
				revision: request.revision,
			}),
		};
		const result = await executePolicyAction(
			action,
			options.policy,
			{
				paths: options.paths,
				audit: options.audit,
				execute: async () => {
					assertActive();
					return execute();
				},
			},
			signal,
		);
		if (result.decision.decision !== "ALLOW") {
			policyDenial = `Policy ${result.decision.risk}/${result.decision.decision}: ${result.decision.reason}`;
			throw new Error(policyDenial);
		}
		return { content: [{ type: "text" as const, text: result.value ?? "" }], details: { actionId: action.actionId } };
	};
	const tools: ToolDefinition[] = [
		defineTool({
			name: "runtime_read",
			label: "Runtime read",
			description:
				"Read one allowed workspace text file (maximum 256 KiB). anchors:true returns a fileDigest and opaque line anchors with JSON-escaped text; copy tokens unchanged into runtime_edit. Long previews/output may be explicitly truncated.",
			executionMode: "sequential",
			parameters: Type.Object({ path: pathSchema, anchors: Type.Optional(Type.Boolean()) }, strict),
			execute: async (_id, input) => {
				const params = structuredClone(input);
				return fileAction("runtime_read", [params.path], params, () => {
					if (!params.anchors) return readText(join(options.cwd, params.path));
					if (!strictMutation) return readAnchoredFile(options.cwd, params.path);
					// One bounded snapshot: content digest and filesystem identity are captured together.
					const read = readAnchoredSnapshot(options.cwd, params.path);
					// The latest successful strict anchored read wins; any earlier receipt for this path is invalidated.
					const receipt = mintReadReceipt();
					readReceipts.set(params.path, {
						receipt,
						fileDigest: read.fileDigest,
						identity: read.identity,
					});
					return `${read.snapshot}\nreadReceipt: ${receipt}`;
				});
			},
		}),
		defineTool({
			name: "runtime_search",
			label: "Runtime search",
			description: "Literal text search in explicit allowed files. No recursive directory traversal or shell.",
			executionMode: "sequential",
			parameters: Type.Object(
				{ paths: Type.Array(pathSchema, { minItems: 1, maxItems: 32, uniqueItems: true }), query: text },
				strict,
			),
			execute: async (_id, params) =>
				fileAction("runtime_search", params.paths, params, () => {
					const matches: string[] = [];
					for (const path of params.paths) {
						assertActive();
						for (const [index, line] of readText(join(options.cwd, path)).split("\n").entries()) {
							if (line.includes(params.query)) matches.push(`${path}:${index + 1}:${line.slice(0, 512)}`);
							if (matches.length >= 100) return `${matches.join("\n")}\n[truncated at 100 matches]`;
						}
					}
					return matches.join("\n") || "No matches";
				}),
		}),
	];
	tools.push(createListFilesTool(options.cwd, options.policy, options.paths, signal, fileAction));
	if (request.lsp) tools.push(...createLspTools(request.lsp, fileAction, signal));
	if (request.role !== "Reviewer") {
		tools.push(
			...(executionContract.mode === "EDIT"
				? [
						defineTool({
							name: "runtime_write",
							label: "Runtime write",
							description:
								"Write an allowed workspace text file. Parent directory must exist." +
								(strictMutation
									? " Strict mutation mode: a new file requires operation=create with mustNotExist:true; an existing file requires operation=replace with readReceipt+fileDigest from runtime_read anchors:true. " +
										"create never overwrites and replace never creates. Stale preconditions never write."
									: ""),
							executionMode: "sequential",
							parameters: Type.Object(
								{
									path: pathSchema,
									content: Type.String({ maxLength: MAX_BYTES }),
									operation: Type.Optional(Type.Union([Type.Literal("create"), Type.Literal("replace")])),
									mustNotExist: Type.Optional(Type.Boolean()),
									readReceipt: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
									fileDigest: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
								},
								strict,
							),
							execute: async (id, input) => {
								const params = structuredClone(input);
								try {
									return await fileAction("runtime_write", [params.path], params, () => {
										if (!strictMutation) {
											if (
												params.operation !== undefined ||
												params.mustNotExist !== undefined ||
												params.readReceipt !== undefined ||
												params.fileDigest !== undefined
											)
												throw new Error(
													"operation, mustNotExist, readReceipt and fileDigest require mutation.mode: strict",
												);
											writeText(join(options.cwd, params.path), params.content, signal);
											return "File written";
										}
										if (params.operation === "create") {
											if (params.mustNotExist !== true)
												throw new Error("strict create requires mustNotExist: true");
											if (params.readReceipt !== undefined || params.fileDigest !== undefined)
												throw new Error("strict create must not carry readReceipt or fileDigest");
											createAnchoredFile(options.cwd, params.path, params.content, signal);
											readReceipts.delete(params.path);
											return "File created";
										}
										if (params.operation === "replace") {
											if (params.mustNotExist !== undefined)
												throw new Error("strict replace must not carry mustNotExist");
											const expected = requireLatestReceipt(
												params.path,
												params.readReceipt,
												params.fileDigest,
											);
											replaceAnchoredFile(
												options.cwd,
												params.path,
												params.content,
												params.fileDigest as string,
												signal,
												expected,
											);
											readReceipts.delete(params.path);
											return "File replaced";
										}
										throw new Error("strict mutation requires operation create or replace");
									});
								} catch (error) {
									if (error instanceof StaleAnchorError) staleAnchorErrors.add(id);
									throw error;
								}
							},
						}),
						defineTool({
							name: "runtime_edit",
							label: "Runtime edit",
							description:
								"Replace one unique exact text occurrence in an allowed workspace file. Optionally supply BOTH anchor and fileDigest from runtime_read anchors:true. " +
								"The exact oldText must start in the anchored line (may span later lines); duplicates elsewhere are allowed, multiple starts in that line are rejected. Stale preconditions never write. " +
								(strictMutation
									? "Strict mutation mode requires anchor, fileDigest and readReceipt from runtime_read anchors:true; there is no unanchored fallback. "
									: "") +
								(request.role === "Executor" && request.scope.risk === "R1" ? ANCHORED_EDIT_GUIDANCE : ""),
							executionMode: "sequential",
							parameters: Type.Object(
								{
									path: pathSchema,
									oldText: text,
									newText: Type.String({ maxLength: MAX_BYTES }),
									anchor: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
									fileDigest: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
									readReceipt: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
								},
								strict,
							),
							execute: async (id, input) => {
								const params = structuredClone(input);
								if (strictMutation) {
									// Malformed input is fatal: never silently downgrade to the legacy unanchored path.
									if (
										params.anchor === undefined ||
										params.fileDigest === undefined ||
										params.readReceipt === undefined
									)
										throw new Error(
											"strict mutation requires anchor, fileDigest and readReceipt from runtime_read anchors:true",
										);
								} else if ((params.anchor === undefined) !== (params.fileDigest === undefined))
									throw new Error("anchor and fileDigest must be supplied together");
								else if (params.readReceipt !== undefined)
									throw new Error("readReceipt requires mutation.mode: strict");
								try {
									return await fileAction("runtime_edit", [params.path], params, () => {
										if (strictMutation) {
											const expected = requireLatestReceipt(
												params.path,
												params.readReceipt,
												params.fileDigest,
											);
											editAnchoredFile(
												options.cwd,
												params.path,
												{
													...params,
													anchor: params.anchor as string,
													fileDigest: params.fileDigest as string,
												},
												signal,
												expected,
											);
											readReceipts.delete(params.path);
											return "File edited";
										}
										if (params.anchor !== undefined && params.fileDigest !== undefined) {
											editAnchoredFile(
												options.cwd,
												params.path,
												{ ...params, anchor: params.anchor, fileDigest: params.fileDigest },
												signal,
											);
											return "File edited";
										}
										const path = join(options.cwd, params.path);
										const content = readText(path);
										const index = content.indexOf(params.oldText);
										if (index < 0 || content.indexOf(params.oldText, index + 1) !== -1)
											throw new Error("Edit requires a unique exact match");
										writeText(
											path,
											content.slice(0, index) +
												params.newText +
												content.slice(index + params.oldText.length),
											signal,
										);
										return "File edited";
									});
								} catch (error) {
									if (error instanceof StaleAnchorError) staleAnchorErrors.add(id);
									throw error;
								}
							},
						}),
					]
				: []),
			defineTool({
				name: "runtime_request_check",
				label: "Request check",
				description:
					"Record a request for a registered check. Only Kernel verification stages execute checks; this tool produces no PASS evidence.",
				executionMode: "sequential",
				parameters: Type.Object({ id: pathSchema }, strict),
				execute: async (_id, params) => {
					assertActive();
					if (!options.config.verification.checks.some((check) => check.id === params.id))
						throw new Error("Unknown check ID");
					return {
						content: [
							{
								type: "text",
								text: "UNAVAILABLE: request recorded in Pi session; checks run only in Kernel verification stages. Do not claim PASS.",
							},
						],
						details: { id: params.id, status: "UNAVAILABLE" },
					};
				},
			}),
			defineTool({
				name: "submit_handoff",
				label: "Submit handoff",
				description:
					`Submit the sole structured ${request.role} result. Call alone, with no other tool calls in the same turn. ` +
					"runId, revision and task must be copied exactly from the current task context; task is the task id, not the goal text." +
					(request.role === "Developer"
						? " unresolved must contain only remaining implementation/requirement problems, not Runtime-owned pending review, SELF_CHECK, TEST or Human Approval. Preserve real blockers; correct submission errors in this session."
						: " criteria[] must report every frozen acceptance criterion exactly once by its exact Host-assigned ID and status; never restate, rename or invent criteria. unresolved must contain only unfinished criteria or concrete blockers, not general caveats, low confidence or Runtime-owned pending checks/review. Preserve real blockers; correct submission errors in this session."),
				executionMode: "sequential",
				parameters: request.role === "Executor" ? ExecutorHandoffSchema : HandoffSchema,
				execute: async (id, params) => {
					assertActive();
					const handoff = structuredClone(
						request.role === "Executor"
							? validateContract(ExecutorHandoffSchema, params)
							: validateContract(HandoffSchema, params),
					);
					const identityMismatch = [
						handoff.runId === request.runId ? null : "runId",
						handoff.revision === request.revision ? null : "revision",
						handoff.task === request.task.id ? null : "task",
					].filter((field): field is string => field !== null);
					if (identityMismatch.length) {
						// Adapter-owned classification: rejected and never accepted, but correctable in this same session.
						submissionValidationErrors.set(id, "submit_handoff");
						throw new Error(
							`Handoff identity validation failed: ${identityMismatch.join(", ")} must match the trusted task context exactly; nothing was accepted. ` +
								`Expected runId: ${request.runId}; revision: ${request.revision}; task: ${request.task.id} (the task id, not the goal text). ` +
								"Correct those fields and resubmit submit_handoff alone in this same session.",
						);
					}
					if (request.role === "Executor") {
						const coverage = criterionCoverageError(
							validateContract(ExecutorHandoffSchema, handoff).criteria,
							request.task.acceptanceCriteria,
							"Executor",
						);
						if (coverage) {
							submissionValidationErrors.set(id, "submit_handoff");
							throw new Error(coverage);
						}
					}
					if (request.role === "Developer") {
						const invalidFields = handoff.unresolved.flatMap((item, index) =>
							RUNTIME_OBLIGATION_ONLY.test(item.trim().replace(/\s+/g, " ")) ? [`unresolved[${index}]`] : [],
						);
						if (invalidFields.length) {
							submissionValidationErrors.set(id, "submit_handoff");
							throw new Error(
								`Handoff unresolved validation failed: ${invalidFields.join(", ")} describes a Runtime-owned obligation, not unfinished implementation. ` +
									"Kernel/Workflow owns Reviewer PASS, SELF_CHECK, TEST and Human Approval enforcement. Do not claim these succeeded or decide they are unnecessary. " +
									"Keep every real implementation/requirement problem or blocker in unresolved; use [] only if none remain. " +
									"If an entry means unfinished work, describe the concrete missing change instead of a pending stage. " +
									"Nothing was accepted or filtered. Correct and resubmit submit_handoff alone in this same session.",
							);
						}
					}
					submitted = handoff.role === "Executor" ? { role: "Executor", handoff } : { role: "Developer", handoff };
					return {
						content: [
							{ type: "text", text: "Handoff submitted for Kernel validation; not a completion approval." },
						],
						details: {},
						terminate: true,
					};
				},
			}),
		);
	} else {
		tools.push(
			defineTool({
				name: "submit_review",
				label: "Submit review",
				description:
					"Submit an independent PASS/REVISE/BLOCK review. Judge every frozen acceptance criterion exactly once by its exact Host-assigned ID; criteria and statements cannot be added, removed or restated. Use only exact trustedEvidenceRefs strings in all evidenceRefs arrays; PASS also requires evidence for every criterion. Correct coverage or evidence errors and resubmit in this session. Call alone.",
				executionMode: "sequential",
				parameters: ReviewSchema,
				execute: async (id, params) => {
					assertActive();
					const review: Review = structuredClone(validateContract(ReviewSchema, params));
					const identityMismatch = [
						review.runId === request.runId ? null : "runId",
						review.revision === request.revision ? null : "revision",
						review.task === request.task.id ? null : "task",
						review.diffDigest === request.verification.diffDigest ? null : "diffDigest",
					].filter((field): field is string => field !== null);
					if (identityMismatch.length) {
						// Same adapter-owned classification as evidence errors: reject, then allow one correction.
						submissionValidationErrors.set(id, "submit_review");
						throw new Error(
							`Review identity validation failed: ${identityMismatch.join(", ")} must match the frozen trusted input exactly; nothing was accepted. ` +
								`Expected runId: ${request.runId}; revision: ${request.revision}; task: ${request.task.id}; diffDigest: ${request.verification.diffDigest}. ` +
								"Correct those fields and resubmit submit_review alone in this same session.",
						);
					}
					const coverage = criterionCoverageError(review.criteria, request.task.acceptanceCriteria, "Review");
					if (coverage) {
						submissionValidationErrors.set(id, "submit_review");
						throw new Error(coverage);
					}
					const invalidFields: string[] = [];
					if (!review.evidenceRefs.length || review.evidenceRefs.some((ref) => !trustedEvidence.has(ref)))
						invalidFields.push("evidenceRefs");
					for (const [index, item] of review.criteria.entries()) {
						if (
							item.evidenceRefs.some((ref) => !trustedEvidence.has(ref)) ||
							(review.result === "PASS" && !item.evidenceRefs.length)
						)
							invalidFields.push(`criteria[${index}].evidenceRefs`);
					}
					if (invalidFields.length) {
						submissionValidationErrors.set(id, "submit_review");
						throw new Error(
							`Review evidence validation failed: ${invalidFields.join(", ")}. ` +
								"Copy exact strings from trustedEvidenceRefs; filenames, diffDigest and descriptions are not references. " +
								"All verdicts require nonempty top-level evidenceRefs; PASS also requires evidence for every requirement. " +
								`Correct and resubmit submit_review alone in this session. trustedEvidenceRefs: ${JSON.stringify(evidenceRefs)}`,
						);
					}
					submitted = { role: "Reviewer", review };
					return {
						content: [{ type: "text", text: "Review submitted for Kernel validation." }],
						details: {},
						terminate: true,
					};
				},
			}),
		);
	}
	if (options.policy.r3Scope && request.role === "Developer" && executionContract.mode === "EDIT") {
		const assertConfig = () => {
			if (
				workerDigest(parseRuntimeConfig(readText(join(options.cwd, ".ai/config.yaml")))) !==
				workerDigest(options.config)
			) {
				policyDenial = "Runtime configuration changed; approval is stale";
				throw new Error(policyDenial);
			}
		};
		tools.push(
			defineTool({
				name: "runtime_delete",
				label: "Request file deletion",
				description:
					"Calling this tool requests explicit human approval through the Runtime for the exact preselected tracked text file. " +
					"No separate approval tool or prior grant is needed to call it. The tool waits for the user's Deny/Approve once decision and deletes only after valid one-use consent. " +
					"Denial or approval timeout does not delete. You cannot approve or bypass approval; do not claim consent before the tool confirms it. No other paths, directories, globs or mutations.",
				executionMode: "sequential",
				parameters: Type.Object({ path: pathSchema }, strict),
				execute: async (_id, params) => {
					assertActive();
					const action = {
						runId: request.runId,
						actionId: randomUUID(),
						role: "Developer" as const,
						tool: "runtime_delete",
						risk: "R3" as const,
						paths: [params.path],
						actionDigest: workerDigest({
							executionContract,
							projectInstructionDigest: options.policy.projectInstruction?.digest ?? null,
							path: params.path,
							step: request.step,
						}),
					};
					const initial = evaluatePolicy(action, options.policy, await options.paths.inspect(action.paths));
					if (initial.decision !== "APPROVAL_REQUIRED") {
						await options.audit.prepare(initial);
						policyDenial = `Policy ${initial.risk}/${initial.decision}: ${initial.reason}`;
						throw new Error(policyDenial);
					}
					await options.audit.assertWritable();
					assertConfig();
					const path = join(options.cwd, params.path);
					const fingerprint = deletionFingerprint(path);
					action.actionDigest = workerDigest({
						executionContract,
						projectInstructionDigest: options.policy.projectInstruction?.digest ?? null,
						operation: "delete-file",
						path: params.path,
						...fingerprint,
						step: request.step,
						revision: request.revision,
					});
					if (!request.onApprovalRequested || !request.onApprovalConsumed)
						throw new Error("Human approval callbacks unavailable");
					const grant = await request.onApprovalRequested(
						{
							runId: request.runId,
							actionId: action.actionId,
							actionDigest: action.actionDigest,
							configDigest: options.policy.configDigest,
							role: "Developer",
							operation: "delete-file",
							path: params.path,
							...fingerprint,
							step: request.step,
							revision: request.revision,
							reason: "Delete one preselected Git-tracked workspace text file; no automatic rollback",
						},
						signal,
					);
					assertActive();
					if (!grant.approved) {
						policyDenial = "Human approval refused; deletion was not executed";
						throw new Error(policyDenial);
					}
					const result = await executePolicyAction(
						action,
						{ ...options.policy, r3Approval: grant },
						{
							paths: options.paths,
							audit: options.audit,
							execute: async () => {
								assertActive();
								assertConfig();
								if (
									deletionFingerprint(path).preconditionDigest !== fingerprint.preconditionDigest ||
									Date.now() >= grant.expiresAt
								) {
									policyDenial = "Deletion target changed or approval expired; action was not executed";
									throw new Error(policyDenial);
								}
								// No JS yield between the final fingerprint/expiry check and unlink. External TOCTOU is not sandboxed.
								unlinkSync(path);
								return "Approved file deleted";
							},
						},
						signal,
					);
					if (result.decision.decision !== "ALLOW") {
						policyDenial = "Approval expired or mismatched before execution";
						throw new Error(policyDenial);
					}
					await request.onApprovalConsumed(action.actionId);
					return {
						content: [
							{ type: "text", text: "Approved file deleted; independent review and checks are still required." },
						],
						details: { actionId: action.actionId },
					};
				},
			}),
		);
	}
	return {
		tools:
			options.policy.r3Scope || (request.role === "Executor" && request.scope.risk === "R0")
				? tools.filter((tool) => !["runtime_write", "runtime_edit"].includes(tool.name))
				: tools,
		result: () => structuredClone(submitted),
		policyDenial: () => policyDenial,
		consumeStaleAnchorError: (toolName, toolCallId) =>
			(toolName === "runtime_edit" || toolName === "runtime_write") && staleAnchorErrors.delete(toolCallId),
		consumeSubmissionValidationError: (toolName, toolCallId) =>
			submissionValidationErrors.get(toolCallId) === toolName && submissionValidationErrors.delete(toolCallId),
	};
}
