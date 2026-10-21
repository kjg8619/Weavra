import { EnvironmentId, type ThreadPullRequestLink } from "@t3tools/contracts";
import type { DesktopPreviewFavicon, PreviewSessionSnapshot } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ko } from "~/i18n/ko";

import {
  RightPanelTabs,
  resolveDockDestinationReasons,
  resolvePullRequestTabLink,
  shouldOpenDefaultBrowserProfileFromMenuClick,
  surfaceShortcutActionForKey,
  surfaceShortcutTargetsTypingContext,
  tabMuteMenuItem,
} from "./RightPanelTabs";

describe("browser profile submenu", () => {
  it("reserves touch clicks for opening the choices while mouse clicks use the default", () => {
    expect(shouldOpenDefaultBrowserProfileFromMenuClick("touch")).toBe(false);
    expect(shouldOpenDefaultBrowserProfileFromMenuClick("mouse")).toBe(true);
    expect(shouldOpenDefaultBrowserProfileFromMenuClick(undefined)).toBe(true);
  });
});

function shortcutEvent(
  key: string,
  overrides: Partial<Parameters<typeof surfaceShortcutActionForKey>[1]> = {},
): Parameters<typeof surfaceShortcutActionForKey>[1] {
  return {
    key,
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    isComposing: false,
    metaKey: false,
    ...overrides,
  };
}

const previewSurface = {
  id: "browser:tab-1" as const,
  kind: "preview" as const,
  resourceId: "tab-1",
};
const secondSurface = {
  id: "browser:tab-2" as const,
  kind: "preview" as const,
  resourceId: "tab-2",
};
const sessions: Readonly<Record<string, PreviewSessionSnapshot>> = {
  "tab-1": {
    threadId: "thread-1",
    tabId: "tab-1",
    navStatus: { _tag: "Success", url: "http://24x.xf.local/", title: "Local site" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-08-09T00:00:00.000Z",
  },
  "tab-2": {
    threadId: "thread-1",
    tabId: "tab-2",
    navStatus: { _tag: "Success", url: "http://24x.xf.local/admin", title: "Admin" },
    canGoBack: false,
    canGoForward: false,
    updatedAt: "2026-08-09T00:00:00.000Z",
  },
};

const favicon = (dataUrl: string, pageUrl: string): DesktopPreviewFavicon => ({
  dataUrl,
  pageUrl,
  capturedAt: 1,
});

function overlay(
  icon: DesktopPreviewFavicon | null,
  audio?: { audible?: boolean; audioMuted?: boolean },
) {
  return {
    hasWebContents: true,
    canGoBack: false,
    canGoForward: false,
    loading: false,
    zoomFactor: 1,
    pictureInPicture: false,
    colorScheme: "system" as const,
    audioMuted: audio?.audioMuted ?? false,
    audible: audio?.audible ?? false,
    controller: "none" as const,
    favicon: icon,
  };
}

function renderTabs(
  first: DesktopPreviewFavicon | null,
  second?: DesktopPreviewFavicon,
  audio?: { audible?: boolean; audioMuted?: boolean },
  previewRuntimeTabId: ((tabId: string) => string) | null = (tabId) => `runtime:${tabId}`,
) {
  return renderToStaticMarkup(
    <RightPanelTabs
      mode="inline"
      surfaces={second ? [previewSurface, secondSurface] : [previewSurface]}
      environmentId={null}
      activeSurfaceId={previewSurface.id}
      pendingSurfaceIds={new Set()}
      previewSessions={sessions}
      desktopByTabId={{
        "tab-1": overlay(first, audio),
        ...(second ? { "tab-2": overlay(second) } : {}),
      }}
      {...(previewRuntimeTabId ? { previewRuntimeTabId } : {})}
      terminalLabelsById={new Map()}
      onActivate={() => undefined}
      onCloseSurface={() => undefined}
      onCloseOtherSurfaces={() => undefined}
      onCloseSurfacesToRight={() => undefined}
      onCloseAllSurfaces={() => undefined}
      onCopyFilePath={() => undefined}
      onAddBrowser={() => undefined}
      onAddBrowserInProfile={() => undefined}
      onAddTerminal={() => undefined}
      onAddPullRequest={() => undefined}
      onAddPullRequests={() => undefined}
      onAddDiff={() => undefined}
      onAddFiles={() => undefined}
      onAddAgents={() => undefined}
      onAddDevice={() => undefined}
      liveAgentCount={0}
      browserAvailable
      terminalAvailable={false}
      diffAvailable={false}
      filesAvailable={false}
      pullRequestAvailable={false}
      pullRequestsAvailable={false}
      agentsAvailable={false}
      deviceAvailable={false}
    >
      <div>content</div>
    </RightPanelTabs>,
  );
}

describe("RightPanelTabs preview favicon", () => {
  it("prefers a live capture and never asks Google about a private hostname", () => {
    const captured = renderTabs(favicon("data:image/png;base64,AAAA", "http://24x.xf.local/"));
    expect(captured).toContain("data:image/png;base64,AAAA");
    expect(captured).not.toContain("s2/favicons");
    expect(renderTabs(null)).not.toContain("s2/favicons");
  });

  it("keeps route-specific captures isolated between live tabs on one origin", () => {
    const html = renderTabs(
      favicon("data:image/png;base64,AAAA", "http://24x.xf.local/"),
      favicon("data:image/png;base64,BBBB", "http://24x.xf.local/admin"),
    );
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).toContain("data:image/png;base64,BBBB");
  });

  it("hides a capture while the server session still describes another origin", () => {
    const html = renderTabs(favicon("data:image/png;base64,AAAA", "https://example.com/"));
    expect(html).not.toContain("data:image/png;base64,AAAA");
  });
});

describe("surface shortcuts", () => {
  const actions = [
    { shortcut: "B", available: true, label: "브라우저" },
    { shortcut: "D", available: false, label: "변경 사항" },
  ] as const;

  it("matches available surface shortcuts case-insensitively", () => {
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("b"))).toBe(actions[0]);
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("B"))).toBe(actions[0]);
  });

  it("does not activate unavailable surfaces", () => {
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("d"))).toBeNull();
  });

  it("leaves modified, composing, and already-handled key events alone", () => {
    expect(surfaceShortcutActionForKey(actions, shortcutEvent("b", { metaKey: true }))).toBeNull();
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("b", { isComposing: true })),
    ).toBeNull();
    expect(
      surfaceShortcutActionForKey(actions, shortcutEvent("b", { defaultPrevented: true })),
    ).toBeNull();
  });
});

describe("surface shortcut typing contexts", () => {
  // Selector-aware stub: closest() answers only tokens the combined selector
  // would actually match, mirroring how the browser resolves it.
  const makeTarget = (matches: string | null) => ({
    closest(selectors: string) {
      if (matches === null || !selectors.includes(matches)) return null;
      return {};
    },
  });

  it("treats form fields and every editable region as typing contexts", () => {
    expect(surfaceShortcutTargetsTypingContext(makeTarget("input"))).toBe(true);
    expect(surfaceShortcutTargetsTypingContext(makeTarget("textarea"))).toBe(true);
    expect(surfaceShortcutTargetsTypingContext(makeTarget("select"))).toBe(true);
    // The chat composer is a contenteditable that sits empty until a draft
    // exists; launcher letters claimed from it redirected prompts into shells.
    // The :not clause sees past contenteditable="false" islands to an editable
    // host around them, so nested editors stay protected too.
    expect(surfaceShortcutTargetsTypingContext(makeTarget("[contenteditable]"))).toBe(true);
  });

  it("claims letters when focus sits outside any editable region", () => {
    expect(surfaceShortcutTargetsTypingContext(null)).toBe(false);
    expect(surfaceShortcutTargetsTypingContext(makeTarget(null))).toBe(false);
  });
});

describe("RightPanelTabs audio indicator", () => {
  // A muted tab only shows the indicator while it is actually making sound:
  // arming mute on a quiet tab is deliberate and stays invisible until there
  // is something to suppress.
  const cases = [
    { audible: false, audioMuted: false, label: null },
    { audible: false, audioMuted: true, label: null },
    { audible: true, audioMuted: false, label: ko.projects.rightPanel.muteTab("Local site") },
    { audible: true, audioMuted: true, label: ko.projects.rightPanel.unmuteTab("Local site") },
  ] as const;

  it.each(cases)("audible=$audible muted=$audioMuted", ({ audible, audioMuted, label }) => {
    const html = renderTabs(null, undefined, { audible, audioMuted });
    if (label === null) {
      expect(html).not.toContain(ko.projects.rightPanel.muteTab("Local site"));
      expect(html).not.toContain(ko.projects.rightPanel.unmuteTab("Local site"));
    } else {
      expect(html).toContain(`aria-label="${label}"`);
    }
  });

  it("addresses the desktop by runtime tab id, never the server session id", () => {
    // Session ids are only unique per server process; sending one to the
    // Electron manager raises PreviewTabNotFoundError and silently no-ops.
    const seen: string[] = [];
    renderTabs(null, undefined, { audible: true }, (tabId) => {
      seen.push(tabId);
      return `runtime:${tabId}`;
    });
    expect(seen).toContain("tab-1");
  });

  it("hides the toggle when no runtime tab id can be resolved", () => {
    const html = renderTabs(null, undefined, { audible: true }, null);
    expect(html).not.toContain(ko.projects.rightPanel.muteTab("Local site"));
  });
});

describe("tabMuteMenuItem", () => {
  const overlay = (audioMuted: boolean) =>
    ({ audioMuted, audible: false }) as Parameters<typeof tabMuteMenuItem>[0]["overlay"];

  it("stays disabled until the desktop tab exists", () => {
    // The server session id resolves before the preview manager finishes
    // createTab. Muting in that window fails with an error nobody surfaces.
    expect(tabMuteMenuItem({ overlay: null, canResolveRuntimeTabId: true })).toEqual({
      label: "탭 소리 끄기",
      disabled: true,
    });
  });

  it("stays disabled when no runtime tab id can be resolved", () => {
    expect(tabMuteMenuItem({ overlay: overlay(false), canResolveRuntimeTabId: false })).toEqual({
      label: "탭 소리 끄기",
      disabled: true,
    });
  });

  it("offers mute and unmute once the tab is addressable", () => {
    expect(tabMuteMenuItem({ overlay: overlay(false), canResolveRuntimeTabId: true })).toEqual({
      label: "탭 소리 끄기",
      disabled: false,
    });
    expect(tabMuteMenuItem({ overlay: overlay(true), canResolveRuntimeTabId: true })).toEqual({
      label: "탭 소리 켜기",
      disabled: false,
    });
  });
});

describe("pull request tab snapshots", () => {
  const environmentId = EnvironmentId.make("local");
  const link: ThreadPullRequestLink = {
    host: "github.com",
    repository: "acme/api",
    number: 7,
    url: "https://github.com/acme/api/pull/7",
    source: "manual",
    linkedAt: "2026-01-01T00:00:00Z",
    stack: null,
    snapshot: null,
  };
  it("keeps unknown linked state authoritative and scopes matches to environment and host", () => {
    const threads = [{ environmentId, pullRequests: [link] }];
    expect(resolvePullRequestTabLink(threads, environmentId, "github.com", link)).toBe(link);
    expect(
      resolvePullRequestTabLink(threads, EnvironmentId.make("remote"), "github.com", link),
    ).toBeUndefined();
    expect(
      resolvePullRequestTabLink(threads, environmentId, "github.enterprise.test", link),
    ).toBeUndefined();
  });
  it("uses the newest snapshot when several threads link the same PR", () => {
    const snapshot = {
      state: "merged" as const,
      title: "API",
      headBranch: "api",
      baseBranch: "main",
      isDraft: false,
      updatedAt: null,
      syncedAt: "2026-02-01T00:00:00Z",
    };
    const newer = { ...link, snapshot };
    expect(
      resolvePullRequestTabLink(
        [{ environmentId, pullRequests: [link, newer] }],
        environmentId,
        "github.com",
        link,
      ),
    ).toBe(newer);
  });
});

describe("dock destination reasons", () => {
  const base = {
    isServerThread: true,
    isGitRepository: true,
    hasUpstream: true,
    supportsPullRequests: true,
    hasBranchPullRequest: false,
    supportsThreadPullRequests: true,
    linkedPullRequestCount: 0,
  } as const;

  it("names a non-Git folder as the reason for every Git destination", () => {
    const reasons = resolveDockDestinationReasons({ ...base, isGitRepository: false });
    expect(reasons.diff).toContain("Git 저장소가 아니에요");
    expect(reasons.pullRequest).toContain("Git 저장소가 아니라서");
  });

  it("names the missing remote when a Git branch has no upstream and no PR", () => {
    const reasons = resolveDockDestinationReasons({ ...base, hasUpstream: false });
    expect(reasons.diff).toBeUndefined();
    expect(reasons.pullRequest).toContain("원격에 올라가 있지 않아요");
  });

  it("with a remote but no PR, only the PR destinations explain themselves", () => {
    const reasons = resolveDockDestinationReasons(base);
    expect(reasons.diff).toBeUndefined();
    expect(reasons.pullRequest).toBe(ko.projects.rightPanel.branchNoPullRequest);
    expect(reasons.pullRequests).toBe("이 대화에 연결된 PR이 없어요.");
  });

  it("satisfying a prerequisite removes only its destination's reason", () => {
    const branchPr = resolveDockDestinationReasons({ ...base, hasBranchPullRequest: true });
    expect(branchPr.pullRequest).toBeUndefined();
    expect(branchPr.pullRequests).toBeDefined();
    const linked = resolveDockDestinationReasons({ ...base, linkedPullRequestCount: 1 });
    expect(linked.pullRequests).toBeUndefined();
    expect(linked.pullRequest).toBeDefined();
  });

  it("does not report an unknown Git state as missing", () => {
    const reasons = resolveDockDestinationReasons({
      ...base,
      isGitRepository: undefined,
      hasUpstream: undefined,
    });
    expect(reasons.diff).toBeUndefined();
    expect(reasons.pullRequest).toBe(ko.projects.rightPanel.branchNoPullRequest);
  });

  it("explains a draft before it becomes a server thread", () => {
    const reasons = resolveDockDestinationReasons({ ...base, isServerThread: false });
    expect(reasons.diff).toContain("대화를 시작하면");
    expect(reasons.pullRequests).toContain("대화를 시작하면");
  });

  it("explains an environment without PR support", () => {
    const reasons = resolveDockDestinationReasons({
      ...base,
      supportsPullRequests: false,
      supportsThreadPullRequests: false,
    });
    expect(reasons.pullRequest).toContain("지원하지 않아요");
    expect(reasons.pullRequests).toContain("연결하지 않아요");
  });
});
