import type { WeavraControlViewState } from "@t3tools/client-runtime/state/weavraControl";
import { WeavraCapabilityInventory } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { CapabilityInventory } from "./CapabilityInventory";

const digest = `sha256:${"a".repeat(64)}`;
const decodeInventory = Schema.decodeUnknownSync(WeavraCapabilityInventory);
const inventory: WeavraCapabilityInventory = {
  schemaVersion: 1,
  coverage: "RUNTIME_ACTION_TOOLS",
  ownerId: "owner",
  projectRevision: 7,
  brokerEpoch: "12345678-1234-1234-1234-123456789abc",
  generation: 3,
  status: "CURRENT",
  reason: "OBSERVED",
  observedAt: 123,
  total: 2,
  omitted: 1,
  entries: [
    {
      descriptor: {
        id: "weavra.worker.runtime_read",
        name: "runtime_read",
        kind: "worker-tool",
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
        observedAt: 123,
      },
    },
  ],
};
function render(view?: WeavraControlViewState["capabilityInventory"], connected = true) {
  return renderToStaticMarkup(
    <CapabilityInventory
      view={view}
      connected={connected}
      scope="environment / project / workspace"
    />,
  );
}
describe("inspection-only Runtime inventory", () => {
  it("exposes descriptive scope and rows but no action, permission or approval controls", () => {
    const html = render({ status: "CURRENT", inventory });
    for (const text of [
      "runtime_read",
      "weavra-runtime",
      "RUNTIME_ACTION_TOOLS",
      "DEFINITION_PRESENT",
      "PER_ACTION",
      "123",
      inventory.brokerEpoch,
      "2 / 1",
      "environment / project / workspace",
      "Runtime checks permission per action",
    ])
      expect(html).toContain(text);
    expect(html).not.toMatch(/<(button|input|form|select)\b/);
    expect(html).not.toMatch(/\b(enabled|safe|approved|executable)\b/);
  });
  it("never renders stale or disconnected rows as AVAILABLE", () => {
    for (const html of [
      render({ status: "NEEDS_REFRESH", inventory }),
      render({ status: "CURRENT", inventory }, false),
    ]) {
      expect(html).toContain("Historical observation");
      expect(html).toContain("NEEDS_REFRESH");
      expect(html).not.toContain(">AVAILABLE<");
      expect(html).toContain("123");
    }
  });
  it("distinguishes baseline Runtime not-exposed, failed refresh, and empty current result", () => {
    expect(render()).toContain("NOT EXPOSED / UNKNOWN");
    expect(render()).not.toContain("No rows in this Runtime result");
    expect(
      render({
        status: "UNKNOWN",
        inventory: {
          ...inventory,
          status: "UNKNOWN",
          reason: "CONFIG_UNAVAILABLE",
          entries: [],
          total: null,
          omitted: 0,
        },
      }),
    ).toContain("CONFIG_UNAVAILABLE");
    expect(
      render({ status: "CURRENT", inventory: { ...inventory, entries: [], total: 0, omitted: 0 } }),
    ).toContain("No rows in this Runtime result");
  });
  it("does not render arbitrary metadata or infer another scope's approval and MCP hints", () => {
    const forged = {
      ...inventory,
      approved: true,
      permissions: ["runtime_delete"],
      pendingApproval: { ownerId: "another-owner", secret: "PRIVATE_SECRET" },
      readOnlyHint: true,
      toolkit: { token: "PRIVATE_SECRET" },
    };
    expect(() => decodeInventory(forged)).toThrow();
    const html = render({ status: "CURRENT", inventory: forged });
    expect(html).not.toContain("PRIVATE_SECRET");
    expect(html).not.toContain("another-owner");
    expect(html).not.toContain("runtime_delete");
    expect(html).not.toContain("readOnlyHint");
    expect(html).not.toMatch(/<(button|input)\b/);
  });
});
