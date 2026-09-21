import { type Static, Type } from "typebox";
import type { BrowserCandidateSummary } from "./browser-registry.ts";
import {
	BrowserRegistrationRequestSchema,
	type BrowserVerificationEvidence,
	type RegisteredBrowserCheck,
} from "./browser-types.ts";
import type { CheckResult, StepReference } from "./contracts.ts";
import type { HostBridgeIdentity, HostSnapshotSummary } from "./host-bridge-protocol.ts";

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
] as const;
const strict = { additionalProperties: false } as const;
const identifier = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" });
const counter = Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER });
const digest = Type.String({ pattern: "^sha256:[0-9a-f]{64}$" });
const envelope = { protocolVersion: Type.Literal(1), id: identifier };
const mutation = { ...envelope, ownerId: identifier, expectedProjectRevision: counter };
export const HostControlRequestSchema = Type.Union([
	Type.Object({ ...envelope, type: Type.Literal("control.hello") }, strict),
	Type.Object({ ...envelope, type: Type.Literal("control.snapshot") }, strict),
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
			goal: Type.String({ minLength: 1, maxLength: 2048, pattern: "\\S" }),
			recipeId: Type.Optional(Type.String({ minLength: 1, maxLength: 64, pattern: "^[a-z0-9-]+$" })),
			recipeInputs: Type.Optional(
				Type.Record(Type.String({ pattern: "^[a-z0-9_]+$" }), Type.String({ maxLength: 2048 }), {
					maxProperties: 16,
				}),
			),
			acceptanceStatements: Type.Optional(
				Type.Array(Type.String({ minLength: 1, maxLength: 500, pattern: "\\S" }), { minItems: 1, maxItems: 16 }),
			),
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
] as const;
export type HostControlErrorCode = (typeof HOST_CONTROL_ERROR_CODES)[number];

export interface HostControlPreview {
	previewId: string;
	previewDigest: string;
	ownerId: string;
	projectRevision: number;
	expiresAt: number;
	goal: string;
	workflow: "QUICK" | "STANDARD";
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
	pendingApproval: HostControlApproval | null;
	snapshot: HostSnapshotSummary;
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
}
export type HostControlData =
	| { kind: "capabilities"; capabilities: HostControlCapabilities }
	| { kind: "snapshot"; state: HostControlState }
	| { kind: "prepared"; preview: HostControlPreview }
	| { kind: "browser-state"; state: HostBrowserState }
	| { kind: "browser-prepared"; preview: HostBrowserPreview }
	| { kind: "browser-registered"; check: RegisteredBrowserCheck }
	| {
			kind: "accepted";
			requestId: string;
			command: "workflow.confirm" | "workflow.cancel" | "approval.resolve";
			runId: string | null;
	  };
export type HostControlResponse = HostBridgeIdentity & {
	type: "control_response";
	id: string | null;
	command: string | null;
	ownerId: string;
} & ({ success: true; data: HostControlData } | { success: false; error: { code: HostControlErrorCode } });
