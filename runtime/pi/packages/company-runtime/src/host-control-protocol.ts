import { type Static, Type } from "typebox";
import type { BrowserCandidateSummary } from "./browser-registry.ts";
import {
	BrowserRegistrationRequestSchema,
	type BrowserVerificationEvidence,
	type RegisteredBrowserCheck,
} from "./browser-types.ts";
import type { CapabilityInventory } from "./capability-types.ts";
import {
	COMPLEX_PLAN_ID_PATTERN,
	type ComplexDraft,
	ComplexDraftSchema,
	type ComplexExecution,
	type ComplexPlan,
} from "./complex-types.ts";
import type { CheckResult, StepReference } from "./contracts.ts";
import type { HostBridgeIdentity, HostSnapshotSummary } from "./host-bridge-protocol.ts";
import type { ProjectFactsProjection } from "./project-fact-types.ts";

/** Opt-in control transport. The existing read-only v1 endpoint and its capabilities are unchanged. */
export const HOST_CONTROL_PROTOCOL_VERSION = 1;
export const HOST_CONTROL_MAX_REQUEST_BYTES = 32768;
export const HOST_CONTROL_MAX_RESPONSE_BYTES = 65536;
export const HOST_CONTROL_RESULT_LIMIT = 64;
export const HOST_CONTROL_PREVIEW_TTL_MS = 300000;
export const HOST_CONTROL_COMMANDS = [
	"control.hello",
	"control.snapshot",
	"workflow.prepare",
	"workflow.confirm",
	"workflow.cancel",
	"approval.resolve",
	"browser.inspect",
	"browser.prepare",
	"browser.confirm",
	"facts.prepare",
	"facts.confirm",
] as const;
/**
 * V0.8B Planner commands (PLANNER_DRAFT.md §7.2): candidate drafts only, never prepare, confirm or execution. Accepted
 * when requested but not added to the advertised `commands` tuple, which older Apps decode strictly: the Planner is
 * advertised only through `plannerContractVersion`.
 */
export const HOST_PLANNER_COMMANDS = ["planner.start", "planner.cancel", "planner.read"] as const;
/**
 * V0.8C explicit re-run (COMPLEX_RERUN.md §6): a read-only candidate draft, never a resume, prepare or execution.
 * Accepted when requested but, like the Planner commands, not added to the strictly decoded `commands` tuple: it is
 * advertised only through `rerunContractVersion`.
 */
export const HOST_RERUN_COMMANDS = ["workflow.derive"] as const;
const strict = { additionalProperties: false } as const;
const identifier = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" });
const counter = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const envelope = { protocolVersion: Type.Literal(1), id: identifier };
/** A Runtime-issued planning request id: canonical lowercase UUID, as the App sends it. */
const planId = Type.String({ pattern: COMPLEX_PLAN_ID_PATTERN });
const mutation = { ...envelope, ownerId: identifier, expectedProjectRevision: counter };
/** `workflow.prepare` goal and statement bounds; `planner.start` uses exactly the same (§7.2). */
const goal = Type.String({ minLength: 1, maxLength: 2048, pattern: "\\S" });
const acceptanceStatements = Type.Array(Type.String({ minLength: 1, maxLength: 500, pattern: "\\S" }), {
	minItems: 1,
	maxItems: 16,
});
export const HostControlRequestSchema = Type.Union([
	Type.Object({ ...envelope, type: Type.Literal("control.hello") }, strict),
	Type.Object({ ...envelope, type: Type.Literal("control.snapshot") }, strict),
	Type.Object(
		{
			...mutation,
			type: Type.Literal("facts.prepare"),
			sourceRef: Type.String({ minLength: 1, maxLength: 256 }),
			statement: Type.String({ minLength: 1, maxLength: 500 }),
		},
		strict,
	),
	Type.Object(
		{ ...mutation, type: Type.Literal("facts.confirm"), previewId: identifier, previewDigest: digest },
		strict,
	),
	Type.Object({ ...mutation, type: Type.Literal("browser.inspect") }, strict),
	Type.Object(
		{ ...mutation, type: Type.Literal("browser.prepare"), registration: BrowserRegistrationRequestSchema },
		strict,
	),
	Type.Object(
		{ ...mutation, type: Type.Literal("browser.confirm"), previewId: identifier, previewDigest: digest },
		strict,
	),
	Type.Object(
		{
			...mutation,
			type: Type.Literal("workflow.prepare"),
			goal,
			recipeId: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9-]+$" })),
			recipeInputs: Type.Optional(
				Type.Record(Type.String({ pattern: "^[a-z0-9_]+$" }), Type.String({ maxLength: 2048 }), {
					maxProperties: 16,
				}),
			),
			acceptanceStatements: Type.Optional(acceptanceStatements),
			/** Structured COMPLEX proposal (§4); required for COMPLEX, rejected otherwise and with a recipe. */
			complexDraft: Type.Optional(ComplexDraftSchema),
		},
		strict,
	),
	Type.Object(
		{
			...mutation,
			type: Type.Literal("workflow.confirm"),
			previewId: identifier,
			previewDigest: digest,
		},
		strict,
	),
	Type.Object(
		{ ...mutation, type: Type.Literal("workflow.cancel"), runId: identifier, expectedStateRevision: counter },
		strict,
	),
	Type.Object(
		{
			...mutation,
			type: Type.Literal("approval.resolve"),
			runId: identifier,
			expectedStateRevision: counter,
			approvalId: identifier,
			decision: Type.Enum(["approve", "reject"]),
		},
		strict,
	),
	Type.Object(
		{
			...mutation,
			type: Type.Literal("planner.start"),
			goal,
			acceptanceStatements: Type.Optional(acceptanceStatements),
		},
		strict,
	),
	Type.Object({ ...mutation, type: Type.Literal("planner.cancel"), planId }, strict),
	Type.Object({ ...mutation, type: Type.Literal("planner.read"), planId }, strict),
	/** V0.8C (§6): derive a candidate re-run draft from the latest terminal COMPLEX Run. */
	Type.Object({ ...mutation, type: Type.Literal("workflow.derive"), runId: identifier }, strict),
]);
export type HostControlRequest = Static<typeof HostControlRequestSchema>;
export type HostControlMutation = Extract<HostControlRequest, { ownerId: string }>;
export const HOST_CONTROL_ERROR_CODES = [
	"INVALID_REQUEST",
	"UNSUPPORTED_VERSION",
	"UNSUPPORTED_COMMAND",
	"HANDSHAKE_REQUIRED",
	"CONTROL_UNAVAILABLE",
	"OWNER_CHANGED",
	"PROJECT_CHANGED",
	"STATE_UNAVAILABLE",
	"STALE_PROJECT",
	"STALE_RUN",
	"CONFIG_CHANGED",
	"ACTIVE_RUN",
	"WRITER_PRESENT",
	"PLAN_NOT_FOUND",
	"PLAN_EXPIRED",
	"PLAN_CHANGED",
	"PLAN_CONSUMED",
	"INVALID_GOAL",
	"UNSUPPORTED_WORKFLOW",
	"INVALID_RECIPE",
	"INVALID_CRITERIA",
	"POLICY_DENIED",
	"RUN_NOT_FOUND",
	"RUN_NOT_OWNED",
	"TERMINAL_RUN",
	"APPROVAL_NOT_PENDING",
	"APPROVAL_EXPIRED",
	"REQUEST_ID_REUSED",
	"REQUEST_EXPIRED",
	"REQUEST_OUT_OF_ORDER",
	"REQUEST_TOO_LARGE",
	"RESPONSE_TOO_LARGE",
	"BUSY",
	"START_FAILED",
	"BROWSER_UNAVAILABLE",
	"CANDIDATE_CHANGED",
	"INVALID_BROWSER_CHECK",
	"CHECK_EXISTS",
	"FACT_SOURCE_UNAVAILABLE",
	"FACT_SOURCE_CHANGED",
	"INVALID_FACT",
	"FACT_LIMIT",
	// V0.8B Planner (§7.2): planning or a Run execution in progress; unknown or not RUNNING; not READY.
	"PLANNER_BUSY",
	"PLANNER_NOT_FOUND",
	"PLANNER_NOT_READY",
	// V0.8C re-run (§3): the latest Run is not a terminal, unfinished, non-R3 COMPLEX Run with a Host-confirmed plan.
	"RERUN_NOT_APPLICABLE",
] as const;
export type HostControlErrorCode = (typeof HOST_CONTROL_ERROR_CODES)[number];

/** V0.8C re-run contract (COMPLEX_RERUN.md §6): advertised in `control.hello`; advertisement is not permission. */
export const RERUN_CONTRACT_VERSION = 1;
/** §3: the source statuses a re-run draft is derived from (never COMPLETED, never an active Run). */
export const RERUN_SOURCE_STATUSES = ["BLOCKED", "CANCELLED", "FAILED", "INTERRUPTED"] as const;
/**
 * §4 step 5: the codes of the prepare pipeline a derived draft is dry-run through (classification, COMPLEX
 * compilation with claim facts and Policy, the preview's response bound). Refusals of `workflow.derive` itself are
 * ordinary error responses, never a check result.
 */
export const RERUN_PREPARE_CHECK_CODES = [
	"INVALID_REQUEST",
	"INVALID_GOAL",
	"UNSUPPORTED_WORKFLOW",
	"INVALID_CRITERIA",
	"RESPONSE_TOO_LARGE",
] as const satisfies readonly HostControlErrorCode[];
/** §6: bound of a whole `derived-draft` response line, newline included. */
export const HOST_RERUN_DRAFT_MAX_RESPONSE_BYTES = 49152;
/** §4 step 6: at most this many fixed-template notes, each at most `RERUN_NOTE_MAX_BYTES` UTF-8 bytes. */
export const RERUN_MAX_NOTES = 16;
export const RERUN_NOTE_MAX_BYTES = 200;
/** §5: at most this many leftover paths and UTF-8 bytes of names, in sorted order; beyond that `truncated`. */
export const RERUN_LEFTOVER_MAX_PATHS = 200;
export const RERUN_LEFTOVER_MAX_BYTES = 16384;
/**
 * §5 leftover changes that would fail the clean-start check: names only, never contents, diffs or modes. `clean` is
 * null (unknown, never clean) and `paths` empty when Git could not answer.
 */
export interface HostRerunLeftovers {
	clean: boolean | null;
	paths: string[];
	truncated: boolean;
}

/** V0.8B Planner contract (PLANNER_DRAFT.md §7): advertised in `control.hello`; advertisement is not permission. */
export const PLANNER_CONTRACT_VERSION = 1;
export const PLANNER_STATUSES = ["RUNNING", "READY", "FAILED", "CANCELLED"] as const;
/** Closed §5.5 failure codes; CANCELLED is a status, not a failure code. */
export const PLANNER_FAILURE_CODES = [
	"MODEL_UNAVAILABLE",
	"CONTEXT_TOO_LARGE",
	"TIMEOUT",
	"PROVIDER_ERROR",
	"BUDGET_EXHAUSTED",
	"BUDGET_UNKNOWN",
	"NO_DRAFT",
	"DRAFT_INVALID",
	"STALE",
] as const;
export type HostPlannerFailureCode = (typeof PLANNER_FAILURE_CODES)[number];
/** Bound of a whole `planner-draft` response line; the draft alone is at most `COMPLEX_DRAFT_MAX_BYTES` (12,288). */
export const HOST_PLANNER_DRAFT_MAX_RESPONSE_BYTES = 16384;
/**
 * §7.3 snapshot status of this Host's planning request: small and draftless (`planner.read` returns the draft).
 * Host process memory only; present only after a `planner.start` on this Host and dropped by a successful confirm.
 */
export interface HostPlannerStatus {
	schemaVersion: 1;
	planId: string;
	status: (typeof PLANNER_STATUSES)[number];
	requestDigest: string;
	/** The project revision recorded at `planner.start`. */
	projectRevision: number;
	/** True only while the project revision and configuration fingerprint equal the recorded values. */
	current: boolean;
	startedAt: number;
	finishedAt: number | null;
	/** The requested route (alias -> profile -> provider/model); null when no route could be resolved. */
	route: { alias: "plan" | null; profile: string; provider: string; model: string } | null;
	usage: { invocations: number; reportedTokens: number | null };
	/** READY only. */
	taskCount: number | null;
	/** FAILED only. */
	failureCode: HostPlannerFailureCode | null;
}

export interface HostControlPreview {
	previewId: string;
	previewDigest: string;
	ownerId: string;
	projectRevision: number;
	expiresAt: number;
	goal: string;
	workflow: "QUICK" | "STANDARD" | "COMPLEX";
	executionMode: "EDIT" | "READ_ONLY";
	risk: "R0" | "R1" | "R2" | "R3";
	allowedPaths: string[];
	checks: { id: string; kind: string; required: boolean }[];
	acceptanceCriteria: { id: string; statement: string; checkIds: string[]; reviewRequired: boolean }[];
	taskContractDigest: string;
	recipe: { id: string; version: number; digest: string } | null;
	configuration: {
		mutationMode: "compatible" | "strict";
		verifierTrustMode: "compatible" | "strict";
		verifierSandboxMode: "disabled" | "required";
		contextPackMode: "disabled" | "bounded";
		verificationRepairMode: "disabled" | "self-check-once";
		lspEnabled: boolean;
	};
	/**
	 * Present iff workflow is COMPLEX, absent otherwise: the complete immutable plan, bound to
	 * `taskContractDigest` and covered by `previewDigest`. Confirmation is still not an approval.
	 */
	complexPlan?: ComplexPlan;
}
export interface HostControlApproval {
	approvalId: string;
	runId: string;
	stateRevision: number;
	projectRevision: number;
	risk: "R3";
	operation: "delete-file";
	role: "Developer";
	step: { stepId: "implement"; attempt: number };
	path: string;
	bytes: number;
	preconditionDigest: string;
	expiresAt: number;
	/** Fixed Host explanation, never worker text or raw Policy diagnostics. */
	explanation: string;
}
export interface HostBrowserPreview {
	previewId: string;
	previewDigest: string;
	ownerId: string;
	projectRevision: number;
	expiresAt: number;
	candidate: BrowserCandidateSummary;
	check: RegisteredBrowserCheck;
	isolation: "PRIVATE_HOME_PROFILE_CDP_PIPE_NOT_OS_SANDBOX";
}
export interface HostBrowserState {
	projectId: string;
	candidates: BrowserCandidateSummary[];
	omittedCandidates: number;
	checks: Array<{ check: RegisteredBrowserCheck; required: boolean }>;
	omittedChecks: number;
	/** Only the latest durable Run; absent evidence never falls back to an older passing Run. */
	evidence: Array<{
		runId: string;
		checkId: string;
		revision: number;
		step: StepReference | null;
		status: CheckResult["status"];
		diffDigest: string;
		browser: BrowserVerificationEvidence | null;
	}>;
	omittedEvidence: number;
}
export interface HostFactPreview {
	previewId: string;
	previewDigest: string;
	ownerId: string;
	projectRevision: number;
	expiresAt: number;
	sourceRef: string;
	sourceDigest: string;
	statement: string;
}
export interface HostControlState {
	ownerId: string;
	/** Host-issued monotonic command ID; old IDs never execute again after cache eviction. */
	nextRequestId: string;
	projectRevision: number;
	stateRevision: number | null;
	ownedRunId: string | null;
	busy: boolean;
	cancelling: boolean;
	startFailure: "START_FAILED" | null;
	preview: HostControlPreview | null;
	browserPreview: HostBrowserPreview | null;
	factPreview: HostFactPreview | null;
	projectFacts: ProjectFactsProjection;
	pendingApproval: HostControlApproval | null;
	snapshot: HostSnapshotSummary;
	capabilityInventory?: CapabilityInventory;
	/**
	 * Present iff the latest canonical Run is COMPLEX (§10.3), owned or historical; absent (never null) otherwise and
	 * never projected from an older Run. Its ownerId/projectRevision/stateRevision/runId equal this snapshot's.
	 */
	complexExecution?: ComplexExecution;
	/** V0.8B (§7.3): present only after a `planner.start` on this Host; absent (never null) otherwise. */
	planner?: HostPlannerStatus;
}
export interface HostControlCapabilities {
	authority: "Runtime/Kernel";
	control: "workflow-control-v1";
	ownerId: string;
	commands: typeof HOST_CONTROL_COMMANDS;
	maxRequestBytes: number;
	maxResponseBytes: number;
	resultLimit: number;
	previewTtlMs: number;
	runtimeVersion: string;
	readiness: "READY" | "NOT_SETUP" | "CONFIG_INVALID";
	recipes: { id: string; version: number; title: string; inputTemplate: string }[];
	/**
	 * COMPLEX contract feature version (§10.3; V0.8A §8): this Runtime always emits 2 (implementation waves). A V0.7B
	 * Runtime emitted 1; absent (older Runtime) means not exposed. Never mixed on one connection.
	 */
	complexContractVersion?: 2;
	/** V0.8B Planner contract (§7.1); absent (older Runtime) means the Planner does not exist on this connection. */
	plannerContractVersion?: typeof PLANNER_CONTRACT_VERSION;
	/** V0.8C re-run contract (§6); absent (older Runtime) means `workflow.derive` does not exist on this connection. */
	rerunContractVersion?: typeof RERUN_CONTRACT_VERSION;
}
export type HostControlData =
	| { kind: "capabilities"; capabilities: HostControlCapabilities }
	| { kind: "snapshot"; state: HostControlState }
	| { kind: "prepared"; preview: HostControlPreview }
	| { kind: "browser-state"; state: HostBrowserState }
	| { kind: "browser-prepared"; preview: HostBrowserPreview }
	| { kind: "browser-registered"; check: RegisteredBrowserCheck }
	| { kind: "fact-prepared"; preview: HostFactPreview }
	| { kind: "fact-confirmed"; factId: string }
	| {
			kind: "accepted";
			requestId: string;
			command: "workflow.confirm" | "workflow.cancel" | "approval.resolve" | "planner.start" | "planner.cancel";
			runId: string | null;
	  }
	| {
			kind: "planner-draft";
			planId: string;
			requestDigest: string;
			projectRevision: number;
			current: boolean;
			/** Exactly as the Planner submitted it: candidate data that `workflow.prepare` recompiles. */
			draft: ComplexDraft;
	  }
	| {
			/** V0.8C (§6): a candidate re-run draft of the latest terminal COMPLEX Run. Nothing is resumed or reused. */
			kind: "derived-draft";
			/** The source Run, which stays history. */
			runId: string;
			sourcePlanDigest: string;
			sourceStatus: (typeof RERUN_SOURCE_STATUSES)[number];
			/** The source parent's goal and acceptance statements in AC order: AC-001 is statement 1. */
			goal: string;
			acceptanceStatements: string[];
			/** Planning-form data only: `workflow.prepare` recompiles whatever the editor holds. */
			draft: ComplexDraft;
			/** The prepare pipeline's dry run of this draft: that pipeline's error code, or null when it would prepare. */
			prepareCheck: { ok: true; code: null } | { ok: false; code: (typeof RERUN_PREPARE_CHECK_CODES)[number] };
			leftovers: HostRerunLeftovers;
			/** At most 16 fixed-template notes of at most 200 UTF-8 bytes each; never file contents. */
			notes: string[];
	  };
export type HostControlResponse = HostBridgeIdentity & {
	type: "control_response";
	id: string | null;
	command: string | null;
	ownerId: string;
} & ({ success: true; data: HostControlData } | { success: false; error: { code: HostControlErrorCode } });
