import type {
  SourceControlDiscoveryResult,
  SourceControlProviderDiscoveryItem,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { query, refresh } = vi.hoisted(() => ({
  query: {
    data: null as SourceControlDiscoveryResult | null,
    error: null as string | null,
    isPending: false,
  },
  refresh: vi.fn(),
}));

vi.mock("../../state/query", () => ({
  useEnvironmentQuery: () => ({ ...query, refresh }),
}));
vi.mock("../../state/sourceControl", () => ({
  sourceControlEnvironment: { discovery: () => ({}) },
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    scope: { environmentIds: ["local"] },
    environment: { environmentId: "local", connection: { phase: "connected" } },
    connectedEnvironments: [],
  }),
}));
vi.mock("./ProjectDefaultsSettings", () => ({ ProjectDefaultsSettings: () => null }));
vi.mock("./SourceControlWritingSettings", () => ({
  SourceControlWritingSettingsSection: () => null,
}));
vi.mock("../ui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
  TooltipTrigger: ({ render }: { render: ReactNode }) => render,
  TooltipPopup: () => null,
}));
vi.mock("./settingsLayout", () => ({
  SettingsPageContainer: ({ children }: { children: ReactNode }) => children,
  SettingsSection: ({
    title,
    headerAction,
    children,
  }: {
    title: string;
    headerAction?: ReactNode;
    children: ReactNode;
  }) => (
    <section aria-label={title}>
      {headerAction}
      {children}
    </section>
  ),
  useSettingsSearchTargetId: () => null,
}));

import { SourceControlSettingsPanel } from "./SourceControlSettings";

let renderer: ReactTestRenderer | undefined;
const provider = (
  overrides: Partial<SourceControlProviderDiscoveryItem> = {},
): SourceControlProviderDiscoveryItem => ({
  kind: "bitbucket",
  label: "Bitbucket",
  status: "available",
  version: Option.none(),
  detail: Option.none(),
  installHint: "Set SYNTHETIC_BITBUCKET_TOKEN on the server",
  auth: {
    status: "unauthenticated",
    account: Option.none(),
    host: Option.none(),
    detail: Option.none(),
  },
  ...overrides,
});
async function renderDiscovery(
  item: SourceControlProviderDiscoveryItem | null,
  error: string | null = null,
) {
  query.data = item ? { versionControlSystems: [], sourceControlProviders: [item] } : null;
  query.error = error;
  await act(() => {
    if (renderer) renderer.update(<SourceControlSettingsPanel />);
    else renderer = create(<SourceControlSettingsPanel />);
  });
  if (!renderer) throw new Error("Settings did not mount");
  return renderer.root;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  refresh.mockClear();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("source-control discovery axes", () => {
  it.each([
    ["available", "unauthenticated"],
    ["missing", "unknown"],
    ["available", "authenticated"],
    ["available", "unknown"],
  ] as const)(
    "preserves independent %s installation and %s authentication",
    async (status, authStatus) => {
      const item = provider({ status, auth: { ...provider().auth, status: authStatus } });
      const root = await renderDiscovery(item);
      expect(
        root.findByProps({ "data-source-control-installation": status }).children.length,
      ).toBeGreaterThan(0);
      expect(
        root.findByProps({ "data-source-control-auth": authStatus }).children.length,
      ).toBeGreaterThan(0);
      expect(root.findAll((node) => node.props.role === "switch")).toHaveLength(0);
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  it("updates authentication without changing the installation observation", async () => {
    const item = provider();
    let root = await renderDiscovery(item);
    const installed = root.findByProps({
      "data-source-control-installation": "available",
    }).children;
    root = await renderDiscovery({ ...item, auth: { ...item.auth, status: "authenticated" } });
    expect(root.findByProps({ "data-source-control-installation": "available" }).children).toEqual(
      installed,
    );
    expect(root.findAllByProps({ "data-source-control-auth": "unauthenticated" })).toHaveLength(0);
    expect(root.findByProps({ "data-source-control-auth": "authenticated" })).toBeDefined();
  });

  it("opens copyable setup instructions without dispatching a command or discovery", async () => {
    const item = provider();
    const root = await renderDiscovery(item);
    const button = root.findAll(
      (node) => node.type === "button" && typeof node.props["aria-expanded"] === "boolean",
    )[0];
    if (!button) throw new Error("Missing setup disclosure");
    await act(() => button.props.onClick());
    expect(button.props["aria-expanded"]).toBe(true);
    expect(root.findByType("pre").children).toEqual([item.installHint]);
    expect(refresh).not.toHaveBeenCalled();
    await act(() => button.props.onClick());
    expect(button.props["aria-expanded"]).toBe(false);
  });

  it("does not reuse successful axes after failed discovery and allows an explicit rescan", async () => {
    await renderDiscovery(provider({ auth: { ...provider().auth, status: "authenticated" } }));
    const root = await renderDiscovery(null, "Synthetic discovery failed");
    expect(
      root.findAll((node) => node.props["data-source-control-auth"] !== undefined),
    ).toHaveLength(0);
    const scan = root.findAll(
      (node) => node.type === "button" && typeof node.props.onClick === "function",
    )[0];
    if (!scan) throw new Error("Missing rescan action");
    await act(() => scan.props.onClick());
    expect(refresh).toHaveBeenCalledExactlyOnceWith();
  });
});
