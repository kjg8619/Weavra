import { randomUUID } from "node:crypto";
import {
	buildCapabilityCatalog,
	type CapabilityDefinition,
	capabilityDefinition,
	capabilityJson,
} from "./capability-catalog.ts";
import type { CapabilityEntry, CapabilityInventory, CapabilityRegistryReader } from "./capability-types.ts";
import type { RuntimeConfig } from "./config.ts";

export const CAPABILITY_MAX_ENTRIES = 32;
export const CAPABILITY_MAX_BYTES = 16384;

export interface RuntimeCapabilityBroker {
	readonly reader: CapabilityRegistryReader;
	prepare(
		config: RuntimeConfig | null,
		failure?: "INVALID_REGISTRY",
	): (input: { projectRevision: number; sourceChanged?: boolean }) => CapabilityInventory;
}
/** Whole-row projection only. Never modifies the immutable registry or surrounding Host state. */
export function boundCapabilityInventory(
	inventory: CapabilityInventory,
	maxBytes = CAPABILITY_MAX_BYTES,
): CapabilityInventory | null {
	let result = inventory;
	while (Buffer.byteLength(JSON.stringify(result), "utf8") > maxBytes) {
		if (!result.entries.length) return null;
		result = Object.freeze({
			...result,
			entries: Object.freeze(result.entries.slice(0, -1)),
			omitted: result.omitted + 1,
		});
	}
	return result;
}
function exactInput(input: unknown, key: string): input is Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input)) return false;
	const keys = Reflect.ownKeys(input);
	return keys.length === 1 && keys[0] === key && Object.hasOwn(Object.getOwnPropertyDescriptor(input, key)!, "value");
}

/** Host-private owner; only `reader` may escape. No registration or execution API. */
export function createCapabilityBroker(options: {
	ownerId: string;
	projectRevision: number;
	now?: () => number;
}): RuntimeCapabilityBroker {
	if (
		!/^[A-Za-z0-9._:-]{1,128}$/.test(options.ownerId) ||
		!Number.isSafeInteger(options.projectRevision) ||
		options.projectRevision < 0
	)
		throw new Error("INVALID_REGISTRY");
	const ownerId = options.ownerId;
	const now = options.now ?? Date.now;
	let published: CapabilityInventory = Object.freeze({
		schemaVersion: 1,
		coverage: "RUNTIME_ACTION_TOOLS",
		ownerId,
		projectRevision: options.projectRevision,
		brokerEpoch: randomUUID(),
		generation: 0,
		status: "UNKNOWN",
		reason: "CONFIG_UNAVAILABLE",
		observedAt: null,
		entries: Object.freeze([]),
		total: null,
		omitted: 0,
	});
	const reader = Object.freeze<CapabilityRegistryReader>({
		list(input) {
			if (
				!exactInput(input, "limit") ||
				!Number.isInteger(input.limit) ||
				(input.limit as number) < 1 ||
				(input.limit as number) > CAPABILITY_MAX_ENTRIES
			)
				return { ok: false, code: "INVALID_QUERY" };
			const current = published;
			if (current.status !== "CURRENT") return { ok: true, inventory: current };
			const entries = Object.freeze(current.entries.slice(0, input.limit as number));
			const inventory = boundCapabilityInventory(
				Object.freeze({ ...current, entries, omitted: current.total! - entries.length }),
			);
			return inventory ? { ok: true, inventory } : { ok: false, code: "INVALID_QUERY" };
		},
		query(input) {
			if (
				!exactInput(input, "id") ||
				typeof input.id !== "string" ||
				input.id.length > 96 ||
				!/^weavra\.worker\.[a-z0-9_]{1,64}$/.test(input.id)
			)
				return { ok: false, code: "INVALID_QUERY" };
			const current = published;
			if (current.status !== "CURRENT") return { ok: true, inventory: current };
			const entry = current.entries.find((row) => row.descriptor.id === input.id);
			if (!entry) return { ok: false, code: "NOT_FOUND" };
			return {
				ok: true,
				inventory: Object.freeze({ ...current, entries: Object.freeze([entry]), total: 1, omitted: 0 }),
			};
		},
	});
	return Object.freeze({
		reader,
		/** Prepare from validated config, then publish only after Host's existing coherence fence. */
		prepare(config: RuntimeConfig | null, failure?: "INVALID_REGISTRY") {
			let reason: CapabilityInventory["reason"] = failure ?? (config ? "OBSERVED" : "CONFIG_UNAVAILABLE");
			let definitions: CapabilityDefinition[] = [];
			const lspEnabled = config?.code_intelligence?.lsp.enabled === true;
			if (config && !failure) {
				try {
					const candidate = buildCapabilityCatalog();
					if (!Array.isArray(candidate) || candidate.length > CAPABILITY_MAX_ENTRIES)
						throw new Error("INVALID_REGISTRY");
					const ids = new Set<string>();
					definitions = candidate
						.map((definition) => {
							// Compare every field against this build's actual adapter schema and fixed metadata.
							const encoded = capabilityJson(definition);
							const expected = capabilityDefinition(definition.descriptor.name);
							if (encoded !== capabilityJson(expected) || ids.has(expected.descriptor.id))
								throw new Error("INVALID_REGISTRY");
							ids.add(expected.descriptor.id);
							return Object.freeze({
								descriptor: Object.freeze(expected.descriptor),
								requirements: Object.freeze(expected.requirements),
							});
						})
						.sort((left, right) =>
							left.descriptor.id < right.descriptor.id ? -1 : left.descriptor.id > right.descriptor.id ? 1 : 0,
						);
				} catch {
					reason = "INVALID_REGISTRY";
					definitions = [];
				}
			}
			let completed = false;
			return (input: { projectRevision: number; sourceChanged?: boolean }) => {
				if (completed) throw new Error("INVALID_REGISTRY");
				completed = true;
				if (!Number.isSafeInteger(input.projectRevision) || input.projectRevision < 0)
					throw new Error("INVALID_REGISTRY");
				const observedAt = now();
				if (!Number.isSafeInteger(observedAt) || observedAt < 0) throw new Error("INVALID_REGISTRY");
				const publicationReason = input.sourceChanged ? "SOURCE_CHANGED" : reason;
				const entries: readonly CapabilityEntry[] = Object.freeze(
					publicationReason !== "OBSERVED"
						? []
						: definitions.map((definition) => {
								const lsp = definition.descriptor.name.startsWith("runtime_lsp_");
								return Object.freeze({
									...definition,
									observation: Object.freeze({
										availability: lsp
											? lspEnabled
												? ("UNKNOWN" as const)
												: ("UNAVAILABLE" as const)
											: ("AVAILABLE" as const),
										reason: lsp
											? lspEnabled
												? ("LSP_NOT_OBSERVED" as const)
												: ("LSP_DISABLED" as const)
											: ("DEFINITION_PRESENT" as const),
										source: lsp ? ("operator-config" as const) : ("runtime-static" as const),
										observedAt,
									}),
								});
							}),
				);
				const exhausted = published.generation === Number.MAX_SAFE_INTEGER;
				published = Object.freeze({
					...published,
					projectRevision: input.projectRevision,
					brokerEpoch: exhausted ? randomUUID() : published.brokerEpoch,
					generation: exhausted ? 1 : published.generation + 1,
					status:
						publicationReason === "OBSERVED"
							? "CURRENT"
							: publicationReason === "SOURCE_CHANGED"
								? "NEEDS_REFRESH"
								: "UNKNOWN",
					reason: publicationReason,
					observedAt,
					entries,
					total: publicationReason === "OBSERVED" ? entries.length : null,
					omitted: 0,
				});
				return published;
			};
		},
	});
}
