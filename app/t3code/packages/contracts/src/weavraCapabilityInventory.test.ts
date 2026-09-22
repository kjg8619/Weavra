import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  WeavraCapabilityInventory,
  WeavraControlInput,
  WeavraControlObserveInput,
  WeavraControlState,
} from "./weavraControl.ts";

const digest = `sha256:${"a".repeat(64)}`;
const entry = {
  descriptor: {
    id: "weavra.worker.runtime_read",
    kind: "worker-tool",
    name: "runtime_read",
    origin: "weavra-runtime",
    transport: "in-process",
    schemaDigest: digest,
    fingerprint: digest,
    source: "runtime-static",
  },
  requirements: {
    operation: "read",
    mode: "READ_OR_EDIT",
    policy: "PER_ACTION",
    approval: "RUNTIME_DECIDES",
  },
  observation: {
    availability: "AVAILABLE",
    reason: "DEFINITION_PRESENT",
    source: "runtime-static",
    observedAt: 10,
  },
} as const;
const inventory: WeavraCapabilityInventory = {
  schemaVersion: 1,
  coverage: "RUNTIME_ACTION_TOOLS",
  ownerId: "owner",
  projectRevision: 0,
  brokerEpoch: "12345678-1234-1234-1234-123456789abc",
  generation: 1,
  status: "CURRENT",
  reason: "OBSERVED",
  observedAt: 10,
  entries: [entry],
  total: 1,
  omitted: 0,
};
const decode = Schema.decodeUnknownSync(WeavraCapabilityInventory);
const decodeControlInput = Schema.decodeUnknownSync(WeavraControlInput);
const decodeObserveInput = Schema.decodeUnknownSync(WeavraControlObserveInput);
const state = {
  ownerId: "owner",
  nextRequestId: "owner:1",
  projectRevision: 0,
  stateRevision: null,
  ownedRunId: null,
  busy: false,
  cancelling: false,
  startFailure: null,
  preview: null,
  browserPreview: null,
  factPreview: null,
  projectFacts: { status: "available", entries: [] },
  pendingApproval: null,
  snapshot: {
    status: {
      source: "durable-canonical-state",
      ownerObserved: false,
      state: "missing",
      writerPresent: false,
      run: null,
    },
    graph: null,
    graphAvailable: false,
    evidence: null,
    configuration: { source: "project-config-not-frozen-run-config", status: "missing" },
  },
};

describe("frozen capability inventory consumer boundary", () => {
  it("preserves absent baseline Runtime inventory and binds exposed inventory to canonical scope", () => {
    const decodeState = Schema.decodeUnknownSync(WeavraControlState, { onExcessProperty: "error" });
    expect(decodeState(state)).not.toHaveProperty("capabilityInventory");
    expect(decodeState({ ...state, capabilityInventory: inventory }).capabilityInventory).toEqual(
      inventory,
    );
    for (const patch of [{ ownerId: "other" }, { projectRevision: 1 }]) {
      expect(() =>
        decodeState({ ...state, capabilityInventory: { ...inventory, ...patch } }),
      ).toThrow();
    }
    expect(() => decodeState({ ...state, capabilityInventory: null })).toThrow();
    expect(() => decodeState({ ...state, future: true })).toThrow();
  });
  it.each([
    { schemaVersion: 0 },
    { schemaVersion: 2 },
    { coverage: "ALL_TOOLS" },
    { ownerId: "private/path" },
    { ownerId: "a".repeat(129) },
    { projectRevision: -1 },
    { brokerEpoch: "12345678-1234-1234-1234-123456789ABC" },
    { brokerEpoch: "epoch" },
    { generation: -1 },
    { generation: Number.MAX_SAFE_INTEGER + 1 },
    { generation: 0 },
    { observedAt: null },
    { observedAt: Infinity },
    { observedAt: -1 },
    { status: "APPROVED" },
    { reason: "SOURCE_CHANGED" },
    { total: null },
    { total: 0 },
    { total: 33 },
    { omitted: 1 },
    { entries: Array.from({ length: 33 }, () => structuredClone(entry)), total: 33 },
    { entries: [entry, entry], total: 2 },
    { enabled: true },
    { approved: true },
    { permissions: { write: true } },
    { config: "PRIVATE_SECRET" },
    { error: "PRIVATE_SECRET" },
  ])("rejects unsupported inventory semantics %j", (patch) => {
    expect(() => decode({ ...inventory, ...patch })).toThrow();
  });
  it.each([
    { id: "weavra.worker.runtime_write" },
    { name: "runtime_future" },
    { kind: "provider" },
    { origin: "app-mcp" },
    { provider: "remote" },
    { transport: "stdio" },
    { transport: "shell" },
    { transport: "remote" },
    { protocolVersion: "1" },
    { schemaDigest: "sha256:bad" },
    { fingerprint: "sha256:bad" },
    { source: "operator-config" },
    { rawSchema: {} },
    { env: { TOKEN: "PRIVATE_SECRET" } },
    { readOnlyHint: true },
    { destructiveHint: false },
    { idempotentHint: true },
    { openWorldHint: false },
    { enabled: true },
    { approved: true },
    { permissions: ["write"] },
  ])("rejects descriptor rebinding and untrusted metadata %j", (patch) => {
    expect(() =>
      decode({
        ...inventory,
        entries: [{ ...entry, descriptor: { ...entry.descriptor, ...patch } }],
      }),
    ).toThrow();
  });
  it("rejects same ID with another origin, unsorted IDs, and mismatched row observation time", () => {
    const list = {
      ...entry,
      descriptor: {
        ...entry.descriptor,
        name: "runtime_list_files",
        id: "weavra.worker.runtime_list_files",
      },
      requirements: { ...entry.requirements, operation: "list" },
    };
    expect(() =>
      decode({
        ...inventory,
        entries: [entry, { ...entry, descriptor: { ...entry.descriptor, origin: "other" } }],
        total: 2,
      }),
    ).toThrow();
    expect(() => decode({ ...inventory, entries: [entry, list], total: 2 })).toThrow();
    expect(decode({ ...inventory, entries: [list, entry], total: 3, omitted: 1 }).omitted).toBe(1);
    expect(() =>
      decode({
        ...inventory,
        entries: [{ ...entry, observation: { ...entry.observation, observedAt: 11 } }],
      }),
    ).toThrow();
  });
  it("enforces operation, mode, approval and observation provenance combinations", () => {
    for (const patch of [
      { operation: "write" },
      { mode: "EDIT_ONLY" },
      { approval: "EXACT_R3_ACTION" },
      { policy: "ELIGIBLE" },
    ]) {
      expect(() =>
        decode({
          ...inventory,
          entries: [{ ...entry, requirements: { ...entry.requirements, ...patch } }],
        }),
      ).toThrow();
    }
    for (const patch of [
      { availability: "UNKNOWN" },
      { reason: "LSP_DISABLED" },
      { source: "operator-config" },
    ]) {
      expect(() =>
        decode({
          ...inventory,
          entries: [{ ...entry, observation: { ...entry.observation, ...patch } }],
        }),
      ).toThrow();
    }
    const lsp = {
      ...entry,
      descriptor: {
        ...entry.descriptor,
        name: "runtime_lsp_definition",
        id: "weavra.worker.runtime_lsp_definition",
      },
    };
    expect(() => decode({ ...inventory, entries: [lsp] })).toThrow();
    for (const [availability, reason] of [
      ["UNKNOWN", "LSP_NOT_OBSERVED"],
      ["UNAVAILABLE", "LSP_DISABLED"],
    ]) {
      expect(
        decode({
          ...inventory,
          entries: [
            {
              ...lsp,
              observation: {
                ...entry.observation,
                availability,
                reason,
                source: "operator-config",
              },
            },
          ],
        }).entries[0]?.observation.availability,
      ).toBe(availability);
    }
    const deletion = {
      ...entry,
      descriptor: {
        ...entry.descriptor,
        name: "runtime_delete",
        id: "weavra.worker.runtime_delete",
      },
      requirements: {
        ...entry.requirements,
        operation: "delete",
        mode: "EDIT_ONLY",
        approval: "EXACT_R3_ACTION",
      },
    };
    expect(decode({ ...inventory, entries: [deletion] }).entries[0]?.requirements.approval).toBe(
      "EXACT_R3_ACTION",
    );
    expect(() =>
      decode({
        ...inventory,
        entries: [
          { ...deletion, requirements: { ...deletion.requirements, approval: "RUNTIME_DECIDES" } },
        ],
      }),
    ).toThrow();
  });
  it("distinguishes initial, failed publication and empty successful inventory", () => {
    for (const [status, reason] of [
      ["UNKNOWN", "CONFIG_UNAVAILABLE"],
      ["UNKNOWN", "INVALID_REGISTRY"],
      ["NEEDS_REFRESH", "SOURCE_CHANGED"],
    ]) {
      const failed = { ...inventory, status, reason, entries: [], total: null, omitted: 0 };
      expect(decode(failed).status).toBe(status);
      expect(() => decode({ ...failed, observedAt: null })).toThrow();
      expect(() => decode({ ...failed, entries: [entry] })).toThrow();
      expect(() => decode({ ...failed, reason: "OBSERVED" })).toThrow();
    }
    const initial = {
      ...inventory,
      generation: 0,
      status: "UNKNOWN",
      reason: "CONFIG_UNAVAILABLE",
      observedAt: null,
      entries: [],
      total: null,
    };
    expect(decode(initial).generation).toBe(0);
    expect(() => decode({ ...initial, reason: "INVALID_REGISTRY" })).toThrow();
    expect(() => decode({ ...initial, observedAt: 10 })).toThrow();
    expect(decode({ ...inventory, entries: [], total: 0 }).status).toBe("CURRENT");
  });
  it("cannot turn MCP hints or inventory into commands, permissions, approval, PASS or COMPLETE", () => {
    const command = {
      protocolVersion: 1,
      id: "owner:1",
      ownerId: "owner",
      expectedProjectRevision: 0,
      type: "workflow.prepare",
      goal: "ordinary request",
    };
    for (const metadata of [
      { capabilityInventory: inventory },
      { enabled: true },
      { approved: true },
      { permissions: ["runtime_write"] },
      { policyEligible: true },
      { readOnlyHint: true },
      { toolkit: "Preview" },
    ]) {
      expect(() =>
        decodeControlInput({
          projectId: "project",
          request: { ...command, ...metadata },
        }),
      ).toThrow();
      expect(() => decodeObserveInput({ projectId: "project", ...metadata })).toThrow();
    }
    for (const type of [
      "capability.execute",
      "capability.install",
      "capability.register",
      "PASS",
      "COMPLETE",
    ]) {
      expect(() =>
        decodeControlInput({
          projectId: "project",
          request: { ...command, type },
        }),
      ).toThrow();
    }
    expect(() =>
      decode({
        ...inventory,
        entries: [
          { ...entry, descriptor: { ...entry.descriptor, name: "PRIVATE_SECRET".repeat(2000) } },
        ],
      }),
    ).toThrow();
  });
});
