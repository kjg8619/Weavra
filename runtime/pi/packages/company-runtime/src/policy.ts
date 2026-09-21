import {
	type ApprovalDecision,
	type PolicyDecision,
	PolicyDecisionSchema,
	type QuickScope,
	type R3Scope,
	type Risk,
	type Role,
	validateContract,
} from "./contracts.ts";
import { type ExecutionMode, isExecutionMode } from "./execution-contract.ts";
import type { ProjectInstructionMetadata } from "./project-instruction-types.ts";

/** Trusted adapter metadata, never a worker-supplied tool registration or risk override. */
export interface RegisteredActionTool {
	id: string;
	operation: "read" | "search" | "list" | "write" | "edit" | "delete";
}
export interface PolicyContext {
	/** Frozen trusted Host contract, never a worker argument or inferred from risk. */
	executionMode: ExecutionMode;
	executionRunId: string;
	tools: readonly RegisteredActionTool[];
	allowedPaths: readonly string[];
	configDigest: string;
	/** Metadata for the one configured instruction file; content stays in the run's adapter memory. */
	projectInstruction?: ProjectInstructionMetadata | null;
	/** Additional protected literal workspace-relative paths; cannot relax built-in protection. */
	protectedPaths?: readonly string[];
	/** Trusted QUICK scope, frozen by the adapter. Never accepted from a tool argument. */
	executorScope?: QuickScope;
	/** Trusted STANDARD/R2 run binding. StateStore must also verify the durable run before execution. */
	r2RunId?: string;
	r3Scope?: R3Scope;
	/** One action-specific human decision; durable audit rejects replay. */
	r3Approval?: ApprovalDecision;
}
export interface PolicyAction {
	runId: string;
	actionId: string;
	role: Role;
	tool: string;
	/** Lower bound assessed by the trusted adapter, not by the model. */
	risk: Risk | "UNKNOWN";
	paths: readonly string[];
	/** Adapter-generated digest binds the complete input, including write contents/search parameters. */
	actionDigest: string;
}
export interface InspectedPath {
	path: string;
	safe: boolean;
	kind: "file" | "missing" | "directory";
}
export interface PolicyPathInspector {
	inspect(paths: readonly string[]): Promise<InspectedPath[]>;
}
export type ActionOutcome = "SUCCEEDED" | "FAILED" | "INTERRUPTED";

/** Immutable trusted command registration; never supplied by a worker tool call. */
export interface RegisteredCheck {
	id: string;
	executable: string;
	argv: readonly string[];
	cwd: string;
	timeoutMs: number;
	env: Readonly<Record<string, string>>;
}

export function evaluateRegisteredCheck(
	identity: { runId: string; actionId: string; actionDigest: string },
	request: RegisteredCheck,
	registered: RegisteredCheck,
	context: PolicyContext,
	cwdSafe: boolean,
): PolicyDecision {
	const shell =
		/(?:^|\/)(?:bash|sh|zsh|dash|ksh|fish|csh|cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh|env|xargs|sudo|su|nohup|setsid|eval)$/i.test(
			request.executable,
		);
	const inline = request.argv.some((arg) =>
		/^(?:-[cep].*|--(?:eval|print|command)(?:=.*)?|\/c.*|-command)$/i.test(arg),
	);
	const allow =
		cwdSafe &&
		isExecutionMode(context.executionMode) &&
		context.executionRunId === identity.runId &&
		(!context.r2RunId || context.r2RunId === identity.runId) &&
		request.executable.startsWith("/") &&
		!shell &&
		!inline &&
		(request.cwd === "." ||
			(isPolicyPath(request.cwd) && !isProtectedPath(request.cwd, context.protectedPaths ?? []))) &&
		JSON.stringify(request) === JSON.stringify(registered);
	return validateContract(PolicyDecisionSchema, {
		...identity,
		role: "Verifier",
		projectInstructionDigest: context.projectInstruction?.digest ?? null,
		risk: "R1",
		decision: allow ? "ALLOW" : "DENY",
		reason: allow ? "Exact trusted check registration" : "Unregistered or unsafe check execution",
		configDigest: context.configDigest,
		...(isExecutionMode(context.executionMode) ? { executionMode: context.executionMode } : {}),
	});
}
export interface ActionAudit {
	prepare(decision: PolicyDecision): Promise<void>;
	finish(runId: string, actionId: string, outcome: ActionOutcome): Promise<void>;
	assertWritable(): Promise<void>;
}

/** Literal portable paths only. Do not normalize away traversal or alternate separators. */
export function isPolicyPath(path: string): boolean {
	return (
		path.length > 0 &&
		!/[\\:\x00-\x1f\x7f*?[\]{}]/.test(path) &&
		!path.startsWith("/") &&
		path.split("/").every((part) => part.length > 0 && part !== "." && part !== ".." && part.trim() === part)
	);
}
export function isDependencyPath(path: string): boolean {
	return /(?:^|\/)(?:package(?:-lock)?\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.(?:toml|lock)|requirements[^/]*\.txt|pyproject\.toml|go\.(?:mod|sum)|pom\.xml|(?:build|settings)\.gradle(?:\.kts)?|gradle\.properties|gradle\/libs\.versions\.toml|gradle\/wrapper\/gradle-wrapper\.properties|\.mvn\/wrapper\/maven-wrapper\.properties)$/i.test(
		path,
	);
}
function within(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}
export function isProtectedPath(path: string, additional: readonly string[] = []): boolean {
	// Comparison only, never rewrite an actual filesystem path. Protect canonical Unicode aliases too.
	const lower = path.normalize("NFC").toLowerCase();
	return (
		lower
			.split("/")
			.some(
				(part) =>
					/^(?:\.git|\.ai|\.pi|\.ssh|\.aws|\.azure|\.config|secrets?|credentials?)(?:\..*)?$/.test(part) ||
					/^\.env(?:\..*)?$/.test(part) ||
					/^(?:auth\.json|\.npmrc|\.netrc|id_rsa|id_ed25519|policy(?:-paths)?\.[^/]+|config\.[^/]+)$/.test(part) ||
					/\.(?:pem|key|p12|pfx)$/.test(part),
			) || additional.some((root) => within(lower, root.normalize("NFC").toLowerCase()))
	);
}

/** Listing-specific read boundary. Generated dirs are not excluded when explicitly allowed. */
export function isListablePath(path: string, context: Pick<PolicyContext, "allowedPaths" | "protectedPaths">): boolean {
	return (
		isPolicyPath(path) &&
		path.length <= 4096 &&
		!/[\x00-\x1f\x7f-\x9f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/.test(path) &&
		!isProtectedPath(path, context.protectedPaths) &&
		!path.split("/").some((part) => part.toLowerCase() === "node_modules") &&
		context.allowedPaths.some((root) => within(path, root))
	);
}

/** Pure decision function. Inspection facts and registrations must come from trusted adapters. */
export function evaluatePolicy(
	action: PolicyAction,
	context: PolicyContext,
	inspected: readonly InspectedPath[],
	now?: number,
): PolicyDecision {
	let risk = action.risk;
	let decision: PolicyDecision["decision"] = "DENY";
	let reason = "Action is not authorized";
	const tool = context.tools.find((item) => item.id === action.tool);
	const deletion = tool?.operation === "delete";
	const listing = tool?.operation === "list";
	const mutation = tool?.operation === "write" || tool?.operation === "edit" || deletion;
	if (deletion && ["R0", "R1", "R2"].includes(risk)) risk = "R3";
	if (mutation && risk === "R0") risk = "R1";
	if (mutation && context.r2RunId && risk === "R1") risk = "R2";
	// Assess minimum risk even when a narrower execution contract will deny the operation.
	if (mutation && (risk === "R0" || risk === "R1") && action.paths.some(isDependencyPath)) risk = "R2";
	const invalidConfig =
		!context.configDigest.trim() ||
		(context.r3Scope !== undefined &&
			(!context.r3Scope.runId.trim() ||
				!isPolicyPath(context.r3Scope.targetPath) ||
				context.executorScope !== undefined ||
				context.r2RunId !== undefined)) ||
		(context.r2RunId !== undefined && (!context.r2RunId.trim() || context.executorScope !== undefined)) ||
		new Set(context.tools.map((item) => item.id)).size !== context.tools.length ||
		context.allowedPaths.some((path) => !isPolicyPath(path)) ||
		(context.protectedPaths ?? []).some((path) => !isPolicyPath(path));
	if (!isExecutionMode(context.executionMode) || context.executionRunId !== action.runId)
		reason = "Missing or mismatched execution contract";
	else if (mutation && context.executionMode === "READ_ONLY") reason = "READ_ONLY execution contract forbids mutation";
	else if (invalidConfig) reason = "Invalid policy configuration";
	else if (
		!tool ||
		!["read", "search", "list", "write", "edit", "delete"].includes(tool.operation) ||
		/^(?:bash|sh|shell|exec)$/i.test(tool.id)
	)
		reason = "Unregistered tool or arbitrary execution is unsupported";
	else if (!["Developer", "Reviewer", "Executor", "Lead"].includes(action.role)) reason = "Unknown role";
	else if (context.r2RunId && (action.runId !== context.r2RunId || !["Developer", "Reviewer"].includes(action.role)))
		reason = "R2 run/role binding mismatch";
	else if (
		context.r3Scope &&
		(action.runId !== context.r3Scope.runId || !["Developer", "Reviewer"].includes(action.role))
	)
		reason = "R3 run/role binding mismatch";
	else if (
		context.r3Scope &&
		mutation &&
		(!deletion || action.paths.length !== 1 || action.paths[0] !== context.r3Scope.targetPath)
	)
		reason = "R3 permits only its single-file deletion";
	else if (
		deletion &&
		(!context.r3Scope ||
			action.role !== "Developer" ||
			action.paths.some((path) => isDependencyPath(path) || path.split("/").includes("node_modules")))
	)
		reason = "Unsupported deletion target or scope";
	else if (mutation && action.role !== "Developer" && action.role !== "Executor") reason = "Role cannot mutate files";
	else if (
		mutation &&
		context.executorScope &&
		(context.executorScope.risk === "R0" || action.paths.some((path) => path !== context.executorScope?.targetPath))
	)
		reason = "QUICK mutation outside its fixed scope; STANDARD required";
	else if (
		action.paths.length === 0 ||
		new Set(action.paths).size !== action.paths.length ||
		action.paths.some((path) => !isPolicyPath(path))
	)
		reason = "Invalid or missing literal target paths";
	else if (action.paths.some((path) => isProtectedPath(path, context.protectedPaths ?? [])))
		reason = "Protected target";
	else if (listing && action.paths.some((path) => !isListablePath(path, context)))
		reason = "Target outside listing boundary";
	else if (action.paths.some((path) => !context.allowedPaths.some((root) => within(path, root))))
		reason = "Target outside allowed paths";
	else if (
		inspected.length !== action.paths.length ||
		inspected.some(
			(item, index) =>
				item.path !== action.paths[index] ||
				!item.safe ||
				(!listing && item.kind === "directory") ||
				(!listing && (!mutation || deletion) && item.kind !== "file"),
		)
	)
		reason = "Unsafe, unresolved or non-file target";
	else {
		if (risk === "R0" || risk === "R1") {
			decision = "ALLOW";
			reason = mutation
				? "Registered ordinary file mutation"
				: listing
					? "Registered bounded file listing"
					: "Registered file read/search";
		} else if (risk === "R2") {
			const bound = mutation && action.role === "Developer" && context.r2RunId === action.runId;
			decision = bound ? "ALLOW" : "REVIEW_REQUIRED";
			reason = bound
				? "R2 file mutation bound to mandatory independent STANDARD review"
				: "R2 requires a new STANDARD/R2 run; no execution-time promotion";
		} else if (risk === "R3") {
			const grant = context.r3Approval;
			const approved =
				deletion &&
				context.r3Scope &&
				grant?.approved === true &&
				now !== undefined &&
				now < grant.expiresAt &&
				grant.runId === action.runId &&
				grant.actionId === action.actionId &&
				grant.actionDigest === action.actionDigest &&
				grant.configDigest === context.configDigest;
			decision = approved ? "ALLOW" : "APPROVAL_REQUIRED";
			reason = approved
				? "Exact unexpired human approval for one file deletion"
				: "R3 requires action-specific human approval; unsupported operations remain disabled";
		} else reason = "Unknown action risk";
	}
	return validateContract(PolicyDecisionSchema, {
		runId: action.runId,
		actionId: action.actionId,
		role: action.role,
		projectInstructionDigest: context.projectInstruction?.digest ?? null,
		risk,
		decision,
		reason,
		actionDigest: action.actionDigest,
		configDigest: context.configDigest,
		...(isExecutionMode(context.executionMode) ? { executionMode: context.executionMode } : {}),
	});
}

/** No production tools installed here. S3 adapters must bind the executor to the exact frozen input. */
export async function executePolicyAction<T>(
	action: PolicyAction,
	context: PolicyContext,
	ports: { paths: PolicyPathInspector; audit: ActionAudit; execute: (action: PolicyAction) => Promise<T> },
	signal?: AbortSignal,
): Promise<{ decision: PolicyDecision; value?: T }> {
	action = structuredClone(action);
	context = structuredClone(context);
	signal?.throwIfAborted();
	const decision = evaluatePolicy(action, context, await ports.paths.inspect(action.paths), Date.now());
	await ports.audit.prepare(structuredClone(decision));
	if (decision.decision !== "ALLOW") return { decision };
	let value: T;
	try {
		// Persistence can yield to other code. Reinspect after the intent is durable, immediately before execution.
		const fresh = evaluatePolicy(action, context, await ports.paths.inspect(action.paths), Date.now());
		if (fresh.decision !== "ALLOW") throw new Error("Target changed after policy evaluation");
		await ports.audit.assertWritable();
		signal?.throwIfAborted();
		value = await ports.execute(structuredClone(action));
		signal?.throwIfAborted();
	} catch (error) {
		await ports.audit.finish(action.runId, action.actionId, signal?.aborted ? "INTERRUPTED" : "FAILED");
		throw error;
	}
	// A result-save failure is not an executor failure; never try to overwrite a partial commit.
	await ports.audit.finish(action.runId, action.actionId, "SUCCEEDED");
	return { decision, value };
}
