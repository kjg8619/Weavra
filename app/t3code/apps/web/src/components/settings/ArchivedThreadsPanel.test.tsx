import type { ArchivedSnapshotEntry } from "@t3tools/client-runtime/state/threads";
import {
  EnvironmentId,
  OrchestrationShellSnapshot,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { act, type ReactNode } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const data = vi.hoisted(() => ({
  snapshots: [] as readonly ArchivedSnapshotEntry[],
  error: null as string | null,
  isLoading: false,
  refresh: vi.fn(),
  unarchive: vi.fn(),
  remove: vi.fn(),
  listeners: new Set<() => void>(),
}));
vi.mock("../../lib/archivedThreadsState", async () => {
  const { useSyncExternalStore } = await import("react");
  return {
    useArchivedThreadSnapshots: () => ({
      snapshots: useSyncExternalStore(
        (listener) => {
          data.listeners.add(listener);
          return () => data.listeners.delete(listener);
        },
        () => data.snapshots,
        () => data.snapshots,
      ),
      error: data.error,
      isLoading: data.isLoading,
      refresh: data.refresh,
    }),
  };
});
vi.mock("../../hooks/useThreadActions", () => ({
  useThreadActions: () => ({
    unarchiveThread: data.unarchive,
    confirmAndDeleteThread: data.remove,
  }),
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({ scope: { kind: "all", environmentIds: ["remote"] } }),
}));
vi.mock("./settingsLayout", () => ({
  SettingsPageContainer: ({ children }: { children: ReactNode }) => children,
  SettingsSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  SettingsRow: ({
    title,
    description,
    control,
  }: {
    title: ReactNode;
    description?: ReactNode;
    control?: ReactNode;
  }) => (
    <article>
      <h3>{title}</h3>
      <p>{description}</p>
      {control}
    </article>
  ),
}));
vi.mock("../ProjectFavicon", () => ({ ProjectFavicon: () => null }));

import { ArchivedThreadsPanel } from "./SettingsPanels";

const environmentId = EnvironmentId.make("remote");
const projectId = ProjectId.make("project-a");
const timestamp = "2026-10-20T00:00:00.000Z";
const decodeSnapshot = Schema.decodeUnknownSync(OrchestrationShellSnapshot);
let renderer: ReactTestRenderer | undefined;

function snapshot(ids: readonly string[]): ArchivedSnapshotEntry {
  return {
    environmentId,
    snapshot: decodeSnapshot({
      snapshotSequence: 1,
      updatedAt: timestamp,
      projects: [
        {
          id: projectId,
          title: "Project A",
          workspaceRoot: "/workspace/project-a",
          defaultModelSelection: null,
          scripts: [],
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      threads: ids.map((id) => ({
        id: ThreadId.make(id),
        projectId,
        title: id,
        modelSelection: createModelSelection(ProviderInstanceId.make("codex"), "gpt-5"),
        runtimeMode: "full-access",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        archivedAt: timestamp,
        session: null,
        latestUserMessageAt: null,
        hasPendingApprovals: false,
        hasPendingUserInput: false,
        hasActionableProposedPlan: false,
      })),
    }),
  };
}

async function openArchive(initialEntry = "/remote/selected-thread") {
  const root = createRootRoute({ component: Outlet });
  const conversation = createRoute({
    getParentRoute: () => root,
    path: "$environmentId/$threadId",
    component: () => <main />,
  });
  const landing = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <main />,
  });
  const archive = createRoute({
    getParentRoute: () => root,
    path: "settings/archived",
    component: ArchivedThreadsPanel,
  });
  const router = createRouter({
    routeTree: root.addChildren([conversation, landing, archive]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
  await router.load();
  if (initialEntry !== "/settings/archived") {
    await router.navigate({ to: "/settings/archived" });
  }
  await act(() => {
    renderer = create(<RouterProvider router={router} />);
  });
  return router;
}

function archiveRoot() {
  if (!renderer) throw new Error("Archive did not mount");
  return renderer.root;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  data.snapshots = [];
  data.error = null;
  data.isLoading = false;
  data.refresh.mockReset();
  data.unarchive.mockReset().mockResolvedValue({ _tag: "Success", value: undefined });
  data.remove.mockReset();
});
afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = undefined;
  vi.unstubAllGlobals();
});

describe("archived conversation navigation", () => {
  it("returns to the selected environment and conversation in one activation", async () => {
    const router = await openArchive();
    await act(async () => {
      archiveRoot().findByType("button").props.onClick();
      await router.load();
    });
    expect(router.state.location.pathname).toBe("/remote/selected-thread");
    expect(data.unarchive).not.toHaveBeenCalled();
    expect(data.remove).not.toHaveBeenCalled();
  });

  it("opens the existing landing route when settings has no previous entry", async () => {
    const router = await openArchive("/settings/archived");
    await act(async () => {
      archiveRoot().findByType("button").props.onClick();
      await router.load();
    });
    expect(router.state.location.pathname).toBe("/");
  });

  it("replaces the empty action when archived conversations arrive", async () => {
    await openArchive();
    expect(archiveRoot().findAllByType("button")).toHaveLength(1);
    data.snapshots = [snapshot(["archived-a", "archived-b"])];
    await act(() => data.listeners.forEach((listener) => listener()));
    expect(archiveRoot().findAllByType("article")).toHaveLength(2);
    expect(archiveRoot().findAllByType("button")).toHaveLength(2);
    expect(
      archiveRoot()
        .findAllByType("article")
        .map((row) => row.findByType("h3").props.children),
    ).toEqual(["archived-b", "archived-a"]);
  });

  it("restores only the chosen conversation without changing the selected route", async () => {
    data.snapshots = [snapshot(["archived-a", "archived-b"])];
    const router = await openArchive();
    const selectedRoute = router.state.location.href;
    await act(async () => {
      archiveRoot().findAllByType("article")[0]?.findByType("button").props.onClick();
      await data.unarchive.mock.results[0]?.value;
    });
    expect(data.unarchive).toHaveBeenCalledExactlyOnceWith({
      environmentId,
      threadId: ThreadId.make("archived-b"),
    });
    expect(data.refresh).toHaveBeenCalledOnce();
    expect(router.state.location.href).toBe(selectedRoute);
  });

  it("retains the current selection when an unrelated archive update arrives", async () => {
    const router = await openArchive();
    const selectedRoute = router.state.location.href;
    data.snapshots = [snapshot(["unrelated-thread"])];
    await act(() => data.listeners.forEach((listener) => listener()));
    expect(router.state.location.href).toBe(selectedRoute);
    expect(data.unarchive).not.toHaveBeenCalled();
  });

  it.each([
    { isLoading: true, error: null },
    { isLoading: false, error: "Offline" },
  ])("does not advertise an empty archive while unavailable: %j", async ({ isLoading, error }) => {
    data.isLoading = isLoading;
    data.error = error;
    await openArchive();
    expect(archiveRoot().findAllByType("button")).toHaveLength(0);
  });
});
