import { createHash } from "node:crypto";
import { ACTION_TOOL_SCHEMAS } from "./action-tool-schemas.ts";
import type { CapabilityDescriptor, CapabilityOperation, CapabilityRequirements } from "./capability-types.ts";

/** Canonical JSON, not an attestation. Non-JSON data is rejected, never silently stripped. */
export function capabilityJson(value: unknown): string {
	const ancestors = new Set<object>();
	let remaining = 262144;
	const visit = (item: unknown, depth: number): string => {
		if (--remaining < 0 || depth > 64) throw new Error("INVALID_REGISTRY");
		if (item === null || typeof item === "boolean") return JSON.stringify(item);
		if (typeof item === "number" && Number.isFinite(item)) return JSON.stringify(item);
		if (typeof item === "string") {
			remaining -= item.length;
			if (remaining < 0) throw new Error("INVALID_REGISTRY");
			return JSON.stringify(item);
		}
		if (typeof item !== "object" || !item || ancestors.has(item)) throw new Error("INVALID_REGISTRY");
		if (
			!Array.isArray(item) &&
			Object.getPrototypeOf(item) !== Object.prototype &&
			Object.getPrototypeOf(item) !== null
		)
			throw new Error("INVALID_REGISTRY");
		if (Object.getOwnPropertySymbols(item).length) throw new Error("INVALID_REGISTRY");
		ancestors.add(item);
		let result: string;
		if (Array.isArray(item)) {
			if (item.length > remaining || Object.keys(item).length !== item.length) throw new Error("INVALID_REGISTRY");
			result = `[${Array.from({ length: item.length }, (_, index) => {
				const property = Object.getOwnPropertyDescriptor(item, String(index));
				if (!property || !("value" in property)) throw new Error("INVALID_REGISTRY");
				return visit(property.value, depth + 1);
			}).join(",")}]`;
		} else {
			result = `{${Object.keys(item)
				.sort()
				.map((key) => {
					const property = Object.getOwnPropertyDescriptor(item, key)!;
					if (!("value" in property)) throw new Error("INVALID_REGISTRY");
					remaining -= key.length;
					return `${JSON.stringify(key)}:${visit(property.value, depth + 1)}`;
				})
				.join(",")}}`;
		}
		ancestors.delete(item);
		return result;
	};
	return visit(value, 0);
}
export function capabilityDigest(value: unknown): string {
	return `sha256:${createHash("sha256").update(capabilityJson(value), "utf8").digest("hex")}`;
}
export type CapabilityDefinition = Readonly<{
	descriptor: CapabilityDescriptor;
	requirements: CapabilityRequirements;
}>;

function operation(name: string): CapabilityOperation {
	switch (name) {
		case "runtime_read":
		case "runtime_lsp_diagnostics":
		case "runtime_lsp_definition":
		case "runtime_lsp_references":
		case "runtime_lsp_symbols":
			return "read";
		case "runtime_search":
			return "search";
		case "runtime_list_files":
			return "list";
		case "runtime_write":
			return "write";
		case "runtime_edit":
			return "edit";
		case "runtime_delete":
			return "delete";
		default:
			throw new Error("INVALID_REGISTRY");
	}
}

/** Runtime-private metadata adapter; never supplied by workers, plugins, App or MCP. */
export function capabilityDefinition(name: string): CapabilityDefinition {
	const op = operation(name);
	const requirements: CapabilityRequirements = {
		operation: op,
		mode: op === "write" || op === "edit" || op === "delete" ? "EDIT_ONLY" : "READ_OR_EDIT",
		policy: "PER_ACTION",
		approval: op === "delete" ? "EXACT_R3_ACTION" : "RUNTIME_DECIDES",
	};
	const descriptor = {
		id: `weavra.worker.${name}`,
		kind: "worker-tool" as const,
		name,
		origin: "weavra-runtime" as const,
		transport: "in-process" as const,
		schemaDigest: capabilityDigest(ACTION_TOOL_SCHEMAS[name as keyof typeof ACTION_TOOL_SCHEMAS]),
		source: "runtime-static" as const,
	};
	return { descriptor: { ...descriptor, fingerprint: capabilityDigest({ descriptor, requirements }) }, requirements };
}
export function buildCapabilityCatalog(): readonly CapabilityDefinition[] {
	return Object.keys(ACTION_TOOL_SCHEMAS).map(capabilityDefinition);
}
