import { type Static, Type } from "typebox";
import runtimePackage from "../package.json" with { type: "json" };
import type { Run, StepReference } from "./contracts.ts";
import type { RuntimeEvent } from "./events.ts";
import type { GraphEdge, GraphNode } from "./graph.ts";

export const HOST_BRIDGE_PROTOCOL_VERSION = 1;
export const HOST_BRIDGE_MAX_REQUEST_BYTES = 4096;
export const HOST_BRIDGE_MAX_RESPONSE_BYTES = 65536;
export const HOST_BRIDGE_COMMANDS = Object.freeze([
	"hello",
	"capabilities",
	"status",
	"current-run",
	"graph",
	"evidence-summary",
	"config-summary",
	"snapshot",
] as const);
const identifier = Type.String({ minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9._:-]+$" });
export const HostBridgeRequestSchema = Type.Object(
	{
		protocolVersion: Type.Literal(HOST_BRIDGE_PROTOCOL_VERSION),
		id: identifier,
		type: Type.Enum(HOST_BRIDGE_COMMANDS),
		runId: Type.Optional(identifier),
		clientName: Type.Optional(identifier),
		capabilities: Type.Optional(Type.Array(Type.Literal("snapshots-only"), { maxItems: 1, uniqueItems: true })),
	},
	{ additionalProperties: false },
);
export type HostBridgeRequest = Static<typeof HostBridgeRequestSchema>;
export type HostBridgeCommand = HostBridgeRequest["type"];
export interface HostBridgeIdentity {
	protocolVersion: 1;
	runId: string | null;
	/** Per-Run persisted revision, matching RuntimeEvent.stateRevision; not code revision. */
	stateRevision: number | null;
	/** Project state revision also advances for action audit changes. */
	projectRevision: number | null;
	eventId: string | null;
	timestamp: number;
}
export interface HostRunSummary {
	runId: string;
	status: Run["status"];
	phase: Run["phase"];
	workflow: Run["workflow"];
	risk: Run["risk"];
	executionMode: Run["executionMode"] | null;
	codeRevision: number;
	currentStep: StepReference | null;
	activeAgentCount: number;
	taskContractDigest: string | null;
	createdAt: number;
	updatedAt: number;
}
export interface HostGraphSummary {
	runId: string;
	stateRevision: number;
	status: Run["status"];
	nodes: Array<Pick<GraphNode, "id" | "kind" | "status" | "stepId" | "attempt" | "role" | "parentId">>;
	edges: GraphEdge[];
}
export interface HostEvidenceSummary {
	runId: string;
	status: Run["status"];
	codeRevision: number;
	legacyAcceptanceUnknown: boolean;
	criteria: { total: number; met: number; notMet: number; unknown: number };
	currentChecks: { total: number; passed: number; failed: number; unavailable: number; skipped: number };
	review: { result: string; independent: boolean } | null;
	workers: { count: number; reportedTokens: number | null; toolCalls: number };
	reviewerContexts: { count: number; bytes: number };
	failureCategory: string | null;
}
export interface HostConfigSummary {
	source: "project-config-not-frozen-run-config";
	status: "configured" | "missing" | "unavailable";
	modes?: {
		workflow: string;
		mutation: string;
		verifierTrust: string;
		verifierSandbox: string;
		verificationRepair: string;
		taskContext: string;
		impact: string;
		documentation: string;
	};
	allowedRootCount?: number;
	registeredCheckCount?: number;
	requiredCheckCount?: number;
	documentationEntryCount?: number;
	budgetConfigured?: boolean;
}
export interface HostStatusSummary {
	source: "durable-canonical-state";
	ownerObserved: false;
	state: "available" | "missing" | "unavailable";
	writerPresent: boolean | null;
	/** Lock presence is not proof of a live worker; this bridge never recovers a run. */
	run: HostRunSummary | null;
}
export interface HostSnapshotSummary {
	status: HostStatusSummary;
	graph: HostGraphSummary | null;
	graphAvailable: boolean;
	evidence: HostEvidenceSummary | null;
	configuration: HostConfigSummary;
}
export interface HostBridgeCapabilities {
	readOnly: true;
	commands: typeof HOST_BRIDGE_COMMANDS;
	events: "observations-only";
	reconnect: "fresh-canonical-snapshot-no-replay";
	authority: "Runtime/Kernel";
	maxRequestBytes: number;
	maxResponseBytes: number;
	runtimeVersion: string;
	transport: "in-process" | "stdio";
	observationMode: "runtime-events" | "snapshots-only";
	/** Local doctor checks only; never a claim of Provider authentication or readiness. */
	readiness: "READY" | "NOT_SETUP" | "CONFIG_INVALID";
}
export const HOST_BRIDGE_CAPABILITIES = Object.freeze({
	readOnly: true,
	commands: HOST_BRIDGE_COMMANDS,
	events: "observations-only",
	reconnect: "fresh-canonical-snapshot-no-replay",
	authority: "Runtime/Kernel",
	maxRequestBytes: HOST_BRIDGE_MAX_REQUEST_BYTES,
	maxResponseBytes: HOST_BRIDGE_MAX_RESPONSE_BYTES,
	runtimeVersion: runtimePackage.version,
	transport: "in-process",
	observationMode: "runtime-events",
	readiness: "READY",
} as const satisfies HostBridgeCapabilities);
export type HostBridgeData =
	| HostBridgeCapabilities
	| HostRunSummary
	| HostGraphSummary
	| HostEvidenceSummary
	| HostConfigSummary
	| HostStatusSummary
	| HostSnapshotSummary
	| null;
export type HostBridgeErrorCode =
	| "INVALID_REQUEST"
	| "UNSUPPORTED_VERSION"
	| "UNSUPPORTED_COMMAND"
	| "HANDSHAKE_REQUIRED"
	| "RUN_NOT_FOUND"
	| "STATE_UNAVAILABLE"
	| "GRAPH_UNAVAILABLE"
	| "RESPONSE_TOO_LARGE"
	| "BUSY";
export type HostBridgeResponse = HostBridgeIdentity & {
	type: "response";
	id: string | null;
	command: string | null;
} & ({ success: true; data: HostBridgeData } | { success: false; error: { code: HostBridgeErrorCode } });
export type HostBridgeEvent = HostBridgeIdentity & {
	type: "runtime_event";
	eventId: string;
	runId: string;
	stateRevision: number;
	event: {
		type: RuntimeEvent["type"];
		sequence: number;
		step?: StepReference;
		role?: "Developer" | "Reviewer" | "Executor";
	};
};
