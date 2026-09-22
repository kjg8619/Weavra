export type CapabilityAvailability = "UNKNOWN" | "NEEDS_REFRESH" | "AVAILABLE" | "UNAVAILABLE";
export type CapabilityOperation = "read" | "search" | "list" | "write" | "edit" | "delete";
export type CapabilityReason =
	| "DEFINITION_PRESENT"
	| "LSP_DISABLED"
	| "LSP_NOT_OBSERVED"
	| "CONFIG_UNAVAILABLE"
	| "SOURCE_CHANGED";
export type CapabilityDescriptor = Readonly<{
	id: string;
	kind: "worker-tool";
	name: string;
	origin: "weavra-runtime";
	transport: "in-process";
	schemaDigest: string;
	fingerprint: string;
	source: "runtime-static";
}>;
export type CapabilityRequirements = Readonly<{
	operation: CapabilityOperation;
	mode: "READ_OR_EDIT" | "EDIT_ONLY";
	policy: "PER_ACTION";
	approval: "RUNTIME_DECIDES" | "EXACT_R3_ACTION";
}>;
export type CapabilityObservation = Readonly<{
	availability: CapabilityAvailability;
	reason: CapabilityReason;
	source: "runtime-static" | "operator-config";
	observedAt: number | null;
}>;
export type CapabilityEntry = Readonly<{
	descriptor: CapabilityDescriptor;
	requirements: CapabilityRequirements;
	observation: CapabilityObservation;
}>;
export type CapabilityInventory = Readonly<{
	schemaVersion: 1;
	coverage: "RUNTIME_ACTION_TOOLS";
	ownerId: string;
	projectRevision: number;
	brokerEpoch: string;
	generation: number;
	status: "CURRENT" | "NEEDS_REFRESH" | "UNKNOWN";
	reason: "OBSERVED" | "SOURCE_CHANGED" | "CONFIG_UNAVAILABLE" | "INVALID_REGISTRY";
	observedAt: number | null;
	entries: readonly CapabilityEntry[];
	total: number | null;
	omitted: number;
}>;
export type CapabilityReadResult =
	| { readonly ok: true; readonly inventory: CapabilityInventory }
	| { readonly ok: false; readonly code: "INVALID_QUERY" | "NOT_FOUND" };
export interface CapabilityRegistryReader {
	list(input: Readonly<{ limit: number }>): CapabilityReadResult;
	query(input: Readonly<{ id: string }>): CapabilityReadResult;
}
