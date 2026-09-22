import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ACTION_TOOL_SCHEMAS } from "../src/action-tool-schemas.ts";
import { boundCapabilityInventory, createCapabilityBroker } from "../src/capability-broker.ts";
import * as catalog from "../src/capability-catalog.ts";
import type { CapabilityReadResult } from "../src/capability-types.ts";
import { parseRuntimeConfig } from "../src/config.ts";

const config = parseRuntimeConfig(
	JSON.stringify({
		schemaVersion: 1,
		models: {
			profiles: {
				coding: { provider: "faux", model: "coding" },
				reasoning: { provider: "faux", model: "reasoning" },
			},
		},
		files: { allowed_paths: ["src"] },
	}),
);
function inventory(result: CapabilityReadResult) {
	if (!result.ok) throw new Error(result.code);
	return result.inventory;
}
afterEach(() => vi.restoreAllMocks());

describe("frozen Runtime capability registry", () => {
	it("serves immutable reads without consulting a source or clock, even after that source fails", () => {
		const now = vi.fn(() => 100);
		const broker = createCapabilityBroker({ ownerId: "host", projectRevision: 0, now });
		broker.prepare(config)({ projectRevision: 0 });
		const expected = inventory(broker.reader.list({ limit: 32 }));
		now.mockClear();
		const source = vi.spyOn(catalog, "buildCapabilityCatalog").mockImplementation(() => {
			throw new Error("source unavailable");
		});
		expect(inventory(broker.reader.query({ id: "weavra.worker.runtime_read" })).generation).toBe(expected.generation);
		expect(inventory(broker.reader.list({ limit: 32 }))).toEqual(expected);
		expect(now).not.toHaveBeenCalled();
		expect(source).not.toHaveBeenCalled();
		broker.prepare(config)({ projectRevision: 0 });
		expect(inventory(broker.reader.list({ limit: 32 }))).toMatchObject({
			generation: expected.generation + 1,
			reason: "INVALID_REGISTRY",
			entries: [],
		});
	});
	it("publishes atomically, keeps old reads immutable, and orders generations independently of wall time", () => {
		let clock = 100;
		const broker = createCapabilityBroker({ ownerId: "host", projectRevision: 0, now: () => clock });
		expect(inventory(broker.reader.list({ limit: 32 }))).toMatchObject({
			generation: 0,
			observedAt: null,
			total: null,
			entries: [],
			status: "UNKNOWN",
			reason: "CONFIG_UNAVAILABLE",
		});
		const publish = broker.prepare(config);
		expect(inventory(broker.reader.list({ limit: 32 })).generation).toBe(0);
		publish({ projectRevision: 2 });
		const first = inventory(broker.reader.list({ limit: 32 }));
		expect(first).toMatchObject({
			generation: 1,
			observedAt: 100,
			projectRevision: 2,
			status: "CURRENT",
			reason: "OBSERVED",
			total: 10,
			omitted: 0,
		});
		expect(first.entries.map((entry) => entry.descriptor.id)).toEqual(
			Object.keys(ACTION_TOOL_SCHEMAS)
				.map((name) => `weavra.worker.${name}`)
				.sort(),
		);
		for (const entry of first.entries) {
			expect(entry.observation).toEqual(
				entry.descriptor.name.startsWith("runtime_lsp_")
					? {
							availability: "UNAVAILABLE",
							reason: "LSP_DISABLED",
							source: "operator-config",
							observedAt: 100,
						}
					: { availability: "AVAILABLE", reason: "DEFINITION_PRESENT", source: "runtime-static", observedAt: 100 },
			);
		}
		expect(Reflect.set(first.entries[0].descriptor, "name", "forged")).toBe(false);
		clock = 50;
		broker.prepare(null)({ projectRevision: 2 });
		const failed = inventory(broker.reader.query({ id: "weavra.worker.runtime_read" }));
		expect(failed).toMatchObject({
			generation: 2,
			observedAt: 50,
			total: null,
			omitted: 0,
			entries: [],
			status: "UNKNOWN",
			reason: "CONFIG_UNAVAILABLE",
			brokerEpoch: first.brokerEpoch,
		});
		expect(first.entries[0].descriptor.name).not.toBe("forged");
		expect(first.generation).toBe(1);
		clock = 80;
		broker.prepare(config)({ projectRevision: 3, sourceChanged: true });
		expect(inventory(broker.reader.list({ limit: 1 }))).toMatchObject({
			generation: 3,
			observedAt: 80,
			status: "NEEDS_REFRESH",
			reason: "SOURCE_CHANGED",
			entries: [],
			total: null,
		});
		broker.prepare(config)({ projectRevision: 3 });
		expect(inventory(broker.reader.query({ id: "weavra.worker.runtime_read" }))).toMatchObject({
			generation: 4,
			status: "CURRENT",
			total: 1,
			omitted: 0,
		});
		expect(() => publish({ projectRevision: 0 })).toThrow("INVALID_REGISTRY");
	});
	it("derives canonical schema and fingerprint digests from the shared adapter JSON, never timestamps or config secrets", () => {
		const broker = createCapabilityBroker({ ownerId: "host", projectRevision: 0 });
		broker.prepare(config)({ projectRevision: 0 });
		const rows = inventory(broker.reader.list({ limit: 32 })).entries;
		const canonical = (value: unknown): string =>
			JSON.stringify(value, (_key, item: unknown) =>
				item && typeof item === "object" && !Array.isArray(item)
					? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
					: item,
			);
		const hash = (value: unknown) => `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
		for (const row of rows) {
			expect(row.descriptor.schemaDigest).toBe(
				hash(ACTION_TOOL_SCHEMAS[row.descriptor.name as keyof typeof ACTION_TOOL_SCHEMAS]),
			);
			const { fingerprint, ...descriptor } = row.descriptor;
			expect(fingerprint).toBe(hash({ descriptor, requirements: row.requirements }));
		}
		broker.prepare({
			...config,
			models: {
				profiles: {
					coding: { provider: "SECRET", model: "SECRET" },
					reasoning: { provider: "SECRET", model: "SECRET" },
				},
			},
			code_intelligence: {
				lsp: {
					enabled: true,
					servers: [
						{
							id: "PRIVATE_SERVER",
							executable: "/missing/private-server",
							args: ["TOKEN_SENTINEL"],
							extensions: [".ts"],
							timeout_ms: 1000,
						},
					],
				},
			},
		})({ projectRevision: 0 });
		const enabled = inventory(broker.reader.list({ limit: 32 }));
		expect(enabled.entries.map((row) => row.descriptor)).toEqual(rows.map((row) => row.descriptor));
		expect(
			enabled.entries.filter((row) => row.descriptor.name.startsWith("runtime_lsp_")).map((row) => row.observation),
		).toEqual(
			Array(4).fill({
				availability: "UNKNOWN",
				reason: "LSP_NOT_OBSERVED",
				source: "operator-config",
				observedAt: enabled.observedAt,
			}),
		);
		expect(JSON.stringify(enabled)).not.toMatch(/SECRET|PRIVATE_SERVER|private-server|TOKEN_SENTINEL/);
	});
	it("rejects non-JSON canonical values instead of coercing or dropping them", () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		for (const value of [
			undefined,
			NaN,
			Infinity,
			1n,
			() => {},
			Symbol("s"),
			{ a: undefined },
			cyclic,
			new Date(),
			[undefined],
			Array(1),
			{ [Symbol("s")]: "value" },
		])
			expect(() => catalog.capabilityJson(value)).toThrow("INVALID_REGISTRY");
		expect(catalog.capabilityJson({ z: [3, 1], A: { b: 2, a: 1 }, a: false })).toBe(
			'{"A":{"a":1,"b":2},"a":false,"z":[3,1]}',
		);
	});
	it("rejects duplicate and malformed complete replacements without last-good rows or leaked errors", () => {
		const good = catalog.buildCapabilityCatalog();
		const first = good[0];
		const invalid = [
			[...good, first],
			[...good, { ...first, descriptor: { ...first.descriptor, origin: "plugin" } }],
			[{ ...first, descriptor: { ...first.descriptor, provider: "credential-SENTINEL" } }],
			...["stdio", "shell", "remote"].map((transport) => [
				{ ...first, descriptor: { ...first.descriptor, transport } },
			]),
			[{ ...first, descriptor: { ...first.descriptor, schemaDigest: `sha256:${"0".repeat(64)}` } }],
			[{ ...first, descriptor: { ...first.descriptor, fingerprint: `sha256:${"0".repeat(64)}` } }],
			[{ ...first, schemaVersion: 0 }],
			[{ ...first, requirements: { ...first.requirements, policy: "ALLOW" } }],
			[{ ...first, descriptor: { ...first.descriptor, name: "runtime_install" } }],
			[{ ...first, descriptor: { ...first.descriptor, id: "weavra.worker.runtime_search" } }],
			[{ ...first, rawConfig: "ENV_TOKEN_TRANSCRIPT_REASONING_SENTINEL" }],
			[{ ...first, descriptor: { ...first.descriptor, name: "x".repeat(300000) } }],
			Array(33).fill(first),
		];
		const build = vi.spyOn(catalog, "buildCapabilityCatalog");
		const broker = createCapabilityBroker({ ownerId: "host", projectRevision: 0 });
		broker.prepare(config)({ projectRevision: 0 });
		let generation = 1;
		for (const candidate of invalid) {
			build.mockReturnValue(candidate as never);
			broker.prepare(config)({ projectRevision: 0 });
			const result = inventory(broker.reader.list({ limit: 32 }));
			expect(result).toMatchObject({
				status: "UNKNOWN",
				reason: "INVALID_REGISTRY",
				generation: ++generation,
				entries: [],
				total: null,
				omitted: 0,
			});
			expect(JSON.stringify(result)).not.toMatch(/SENTINEL|rawConfig|provider|plugin|stack/);
		}
		build.mockImplementation(() => {
			throw new Error("RAW_STACK_SECRET_SENTINEL");
		});
		broker.prepare(config)({ projectRevision: 0 });
		expect(inventory(broker.reader.list({ limit: 32 }))).toMatchObject({
			reason: "INVALID_REGISTRY",
			generation: ++generation,
		});
	});
	it("removes absent definitions atomically and recreates a fresh epoch for the same Host", () => {
		const broker = createCapabilityBroker({ ownerId: "host", projectRevision: 0 });
		const definitions = catalog.buildCapabilityCatalog();
		broker.prepare(config)({ projectRevision: 0 });
		const before = inventory(broker.reader.list({ limit: 32 }));
		vi.spyOn(catalog, "buildCapabilityCatalog").mockReturnValue(
			definitions.filter((row) => row.descriptor.name !== "runtime_delete"),
		);
		broker.prepare(config)({ projectRevision: 0 });
		expect(broker.reader.query({ id: "weavra.worker.runtime_delete" })).toEqual({ ok: false, code: "NOT_FOUND" });
		expect(inventory(broker.reader.list({ limit: 32 }))).toMatchObject({ total: 9, generation: 2 });
		const replacement = createCapabilityBroker({ ownerId: "host", projectRevision: 0 });
		const initial = inventory(replacement.reader.list({ limit: 32 }));
		expect(initial.brokerEpoch).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		expect(initial.brokerEpoch).not.toBe(before.brokerEpoch);
		expect(initial).toMatchObject({ generation: 0, observedAt: null, entries: [] });
	});
	it("enforces closed exact queries and complete-row count/UTF-8 budgets without changing stored knowledge", () => {
		const broker = createCapabilityBroker({ ownerId: "host", projectRevision: 0 });
		broker.prepare(config)({ projectRevision: 0 });
		for (const input of [
			{},
			null,
			[],
			{ limit: 0 },
			{ limit: 33 },
			{ limit: 1.5 },
			{ limit: "1" },
			{ limit: 1, cursor: "secret" },
			{ limit: Infinity },
		])
			expect(broker.reader.list(input as never)).toEqual({ ok: false, code: "INVALID_QUERY" });
		for (const input of [
			{},
			null,
			{ id: "RUNTIME_READ" },
			{ id: "weavra.worker.*" },
			{ id: "weavra.worker.runtime_read", limit: 1 },
			{ id: `weavra.worker.${"x".repeat(97)}` },
		])
			expect(broker.reader.query(input as never)).toEqual({ ok: false, code: "INVALID_QUERY" });
		expect(broker.reader.query({ id: "weavra.worker.runtime_absent" })).toEqual({ ok: false, code: "NOT_FOUND" });
		const all = inventory(broker.reader.list({ limit: 32 }));
		const three = inventory(broker.reader.list({ limit: 3 }));
		expect(three).toMatchObject({ total: 10, omitted: 7, generation: all.generation, brokerEpoch: all.brokerEpoch });
		expect(three.entries).toEqual(all.entries.slice(0, 3));
		const limit = Buffer.byteLength(JSON.stringify(three));
		expect(boundCapabilityInventory(all, limit)).toEqual(three);
		expect(boundCapabilityInventory(all, limit - 1)?.entries).toEqual(all.entries.slice(0, 2));
		expect(boundCapabilityInventory(all, 1)).toBeNull();
		expect(Buffer.byteLength(JSON.stringify(all))).toBeLessThanOrEqual(16384);
		expect(inventory(broker.reader.list({ limit: 32 }))).toEqual(all);
	});
});
