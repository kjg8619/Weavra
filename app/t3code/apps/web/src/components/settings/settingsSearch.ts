import { isElectron } from "~/env";
import { ko } from "~/i18n/ko";
import { isMacPlatform, isWindowsPlatform, normalizeSearchText } from "~/lib/utils";
import { STATIC_KEYBINDING_COMMANDS, type KeybindingCommand } from "@t3tools/contracts";
import type { EnvironmentId } from "@t3tools/contracts";
import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { DEFAULT_KEYBINDINGS } from "@t3tools/shared/keybindings";
import { commandLabel, commandSearchAlias } from "./KeybindingsSettings.logic";
import {
  validateSettingsScopeSearch,
  type ResolvedSettingsScope,
  type SettingsScopeSearch,
} from "./settingsScope";

export type SettingsPath =
  | "/settings/projects"
  | "/settings/general"
  | "/settings/appearance"
  | "/settings/keybindings"
  | "/settings/snap-shot"
  | "/settings/providers"
  | "/settings/integrations"
  | "/settings/source-control"
  | "/settings/storage"
  | "/settings/connections"
  | "/settings/archived";

/**
 * Where a setting can be edited. Device-local rows have no scope: they render
 * at every selection. `project-defaults` rows accept project overrides, so
 * they are reachable from any server-backed selection.
 */
export type SettingsSearchScope =
  | "environment"
  | "environment-defaults"
  | "project-defaults"
  | "project"
  | "checkout"
  | "connections";

export interface SettingsSearchItem {
  readonly id: string;
  readonly title: string;
  /**
   * The original English title. Machine-consumed: English queries keep
   * matching and ranking against it now that `title` is Korean.
   */
  readonly englishTitle?: string;
  readonly to: SettingsPath;
  readonly targetId?: string;
  /** Descriptions, option labels, and aliases people may remember instead of the title. */
  readonly searchTerms?: ReadonlyArray<string>;
  readonly scope?: SettingsSearchScope;
  // Its row only renders in the desktop app, so a browser result would land on
  // an anchor that isn't there.
  readonly desktopOnly?: boolean;
  readonly macOnly?: boolean;
  // Its row only renders on Windows desktop, so other desktop platforms must
  // not expose a result that points to a missing anchor.
  readonly windowsOnly?: boolean;
  readonly cloudOnly?: boolean;
  readonly environmentOnly?: boolean;
  readonly providerSettingsOnly?: boolean;
  readonly localBackendManagementOnly?: boolean;
  readonly localEnvironmentOnly?: boolean;
  readonly wslAvailableOnly?: boolean;
  /**
   * Sorts after every other match. Keybinding commands mirror rows on other
   * surfaces, so "model" must still lead with Default model, not Model Picker.
   */
  readonly secondary?: boolean;
  readonly requiresThreadAutoSettlement?: boolean;
}

export interface SettingsSearchAvailability {
  readonly localEnvironmentDisabled?: boolean;
  readonly hasCloudPublicConfig: boolean;
  readonly hasEnvironment: boolean;
  readonly hasProviderSettingsEnvironment: boolean;
  readonly canManageLocalBackend: boolean;
  readonly isWslSettingsRowVisible: boolean;
  readonly hasThreadAutoSettlement: boolean;
}

/**
 * Section labels in sidebar order. The sidebar nav and the search-result
 * subtitles both render from this record, so each label exists once.
 */
export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsPath, string>> = {
  "/settings/projects": ko.settings.search.sections.projects,
  "/settings/general": ko.settings.search.sections.general,
  "/settings/appearance": ko.settings.search.sections.appearance,
  "/settings/keybindings": ko.settings.search.sections.keybindings,
  "/settings/snap-shot": ko.settings.search.sections.snapShots,
  "/settings/providers": ko.settings.search.sections.providers,
  "/settings/integrations": ko.settings.search.sections.integrations,
  "/settings/source-control": ko.settings.search.sections.sourceControl,
  "/settings/storage": ko.settings.search.sections.storage,
  "/settings/connections": ko.settings.search.sections.connections,
  "/settings/archived": ko.settings.search.sections.archived,
};

/**
 * The former English section names. Machine-consumed search aliases so an
 * English query such as "connections" still finds every row in that section.
 */
const SETTINGS_SECTION_SEARCH_ALIASES: Readonly<Record<SettingsPath, string>> = {
  "/settings/projects": "Project",
  "/settings/general": "General",
  "/settings/appearance": "Appearance",
  "/settings/keybindings": "Keybindings",
  "/settings/snap-shot": "SnapShots",
  "/settings/providers": "Providers",
  "/settings/integrations": "Integrations",
  "/settings/source-control": "Source Control",
  "/settings/storage": "Storage",
  "/settings/connections": "Connections",
  "/settings/archived": "Archive",
};

/** Anchor id of the first row bound to `command` on the Keybindings page. */
export function keybindingSearchAnchorId<Command extends KeybindingCommand>(command: Command) {
  return `keybinding-${command}` as const;
}

/**
 * One result per built-in command, alphabetical by label. The anchor is
 * the command's first row; default keys are searchable so "mod+b" lands on
 * Sidebar: Toggle. A command with no default binding may have no row, so it
 * points at the section instead.
 */
const KEYBINDING_SEARCH_ITEMS = STATIC_KEYBINDING_COMMANDS.toSorted((left, right) =>
  commandLabel(left).localeCompare(commandLabel(right)),
).map((command) => {
  const defaultKeys = DEFAULT_KEYBINDINGS.filter((binding) => binding.command === command).map(
    (binding) => binding.key,
  );
  return {
    id: keybindingSearchAnchorId(command),
    title: commandLabel(command),
    englishTitle: commandSearchAlias(command),
    to: "/settings/keybindings" as const,
    searchTerms: [command, ...defaultKeys],
    secondary: true,
    ...(defaultKeys.length === 0 ? { targetId: "keybindings" } : {}),
  };
});

const items = ko.settings.search.items;

/**
 * Searchable settings and stable destinations, in result order. Rows with a
 * dedicated anchor render their id and title via `searchableSetting`; items
 * that may not be mounted point at their nearest stable section instead.
 */
export const SETTINGS_SEARCH_ITEMS = [
  {
    id: "storage-worktrees",
    title: items.storageWorktrees.title,
    englishTitle: "Worktree cleanup",
    to: "/settings/storage",
    scope: "project-defaults",
    searchTerms: [
      items.storageWorktrees.terms,
      "disk storage delete deleted archived threads old inactive merged unchanged worktrees retention days project inherit off custom",
    ],
  },
  {
    id: "storage-artifacts",
    title: items.storageArtifacts.title,
    englishTitle: "Artifacts and logs",
    to: "/settings/storage",
    scope: "environment-defaults",
    searchTerms: [
      items.storageArtifacts.terms,
      "disk storage browser screenshots captures rotated logs cleanup retention",
    ],
  },
  {
    id: "project-defaults",
    title: items.projectDefaults.title,
    englishTitle: "Project defaults and overrides",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      items.projectDefaults.terms,
      "model workspace environments projects inheritance checkout",
    ],
  },
  {
    id: "project-overview",
    title: items.projectOverview.title,
    englishTitle: "Project overview",
    to: "/settings/projects",
    searchTerms: [items.projectOverview.terms, "name icon emoji image checkout remove delete"],
  },
  {
    id: "default-model",
    title: items.defaultModel.title,
    englishTitle: "Default model",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [items.defaultModel.terms, "new thread project provider reasoning effort"],
  },
  {
    id: "default-permissions",
    title: items.defaultPermissions.title,
    englishTitle: "Permissions",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      items.defaultPermissions.terms,
      "new thread default runtime mode supervised approvals auto accept edits full access",
    ],
  },
  {
    id: "color-scheme",
    title: items.colorScheme.title,
    englishTitle: "Color scheme",
    to: "/settings/appearance",
    searchTerms: [items.colorScheme.terms, "appearance light dark system mode"],
    // The scheme tiles sit at the top of the Appearance section.
    targetId: "appearance",
  },
  {
    id: "theme",
    title: items.theme.title,
    englishTitle: "Themes",
    to: "/settings/appearance",
    searchTerms: [items.theme.terms, "appearance colors palette custom import"],
    // Theme cards live directly under the scheme tiles; the section is the
    // stable scroll destination for both.
    targetId: "appearance",
  },
  {
    // Prefixed because the slider control already owns the `appearance-contrast` id.
    id: "setting-appearance-contrast",
    title: items.settingAppearanceContrast.title,
    englishTitle: "Contrast",
    to: "/settings/appearance",
    searchTerms: [items.settingAppearanceContrast.terms, "colors borders interface"],
  },
  {
    // Prefixed because the slider control already owns the `glass-opacity` id.
    id: "setting-glass-opacity",
    title: items.settingGlassOpacity.title,
    englishTitle: "Glass opacity",
    to: "/settings/appearance",
    searchTerms: [
      items.settingGlassOpacity.terms,
      "transparent transparency solid menus dialogs composer",
    ],
  },
  {
    id: "diff-color-scheme",
    title: items.diffColorScheme.title,
    englishTitle: "Diff colors",
    to: "/settings/appearance",
    searchTerms: [
      items.diffColorScheme.terms,
      "red green blue orange additions deletions changes counts palette colorblind",
    ],
  },
  {
    id: "panel-animations",
    title: items.panelAnimations.title,
    englishTitle: "Panel animations",
    searchTerms: [items.panelAnimations.terms],
    to: "/settings/appearance",
  },
  {
    id: "environment-identification",
    title: items.environmentIdentification.title,
    englishTitle: "Environment identification",
    to: "/settings/appearance",
    searchTerms: [
      items.environmentIdentification.terms,
      "dev nightly artwork pill label hide none",
    ],
    // The setting is stage-dependent, so its parent section is the stable destination.
    targetId: "appearance-interface",
  },
  {
    id: "interface-font",
    title: items.interfaceFont.title,
    englishTitle: "Interface font",
    to: "/settings/appearance",
    searchTerms: [items.interfaceFont.terms, "typography family size system sans"],
  },
  {
    id: "prompt-font",
    title: items.promptFont.title,
    englishTitle: "Prompt font",
    to: "/settings/appearance",
    searchTerms: [items.promptFont.terms, "typography family size composer input"],
  },
  {
    id: "code-font",
    title: items.codeFont.title,
    englishTitle: "Code font",
    to: "/settings/appearance",
    searchTerms: [
      items.codeFont.terms,
      "typography family size monospace code blocks diffs file previews",
    ],
  },
  {
    id: "terminal-font",
    title: items.terminalFont.title,
    englishTitle: "Terminal font",
    to: "/settings/appearance",
    searchTerms: [items.terminalFont.terms, "typography family size monospace output"],
  },
  {
    id: "font-smoothing",
    title: items.fontSmoothing.title,
    englishTitle: "Font smoothing",
    to: "/settings/appearance",
    searchTerms: [items.fontSmoothing.terms, "typography text grayscale anti aliasing macos thin"],
    macOnly: true,
  },
  {
    id: "word-wrap",
    title: items.wordWrap.title,
    englishTitle: "Word wrap",
    to: "/settings/appearance",
    searchTerms: [items.wordWrap.terms, "long lines code blocks tables diffs file previews"],
  },
  {
    id: "project-grouping",
    title: items.projectGrouping.title,
    englishTitle: "Project grouping",
    to: "/settings/general",
    searchTerms: [
      items.projectGrouping.terms,
      "combine matching repositories environments sidebar",
    ],
  },
  {
    id: "auto-settle-inactive-threads",
    title: items.autoSettleInactiveThreads.title,
    englishTitle: "Auto-settle inactive threads",
    to: "/settings/general",
    searchTerms: [
      items.autoSettleInactiveThreads.terms,
      "sidebar inactivity days no activity automatically",
    ],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "auto-settle-merged-threads",
    title: items.autoSettleMergedThreads.title,
    englishTitle: "Auto-settle merged threads",
    to: "/settings/general",
    searchTerms: [
      items.autoSettleMergedThreads.terms,
      "pull request merge closed automatically sidebar",
    ],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "days-before-auto-settle",
    title: items.daysBeforeAutoSettle.title,
    englishTitle: "Days of inactivity before auto-settle",
    to: "/settings/general",
    targetId: "auto-settle-inactive-threads",
    searchTerms: [items.daysBeforeAutoSettle.terms, "thread timeout activity sidebar"],
    requiresThreadAutoSettlement: true,
    scope: "project-defaults",
  },
  {
    id: "thread-notifications",
    title: items.threadNotifications.title,
    englishTitle: "Thread notifications",
    to: "/settings/general",
    searchTerms: [
      items.threadNotifications.terms,
      "notification sound alert completion input approval desktop",
    ],
  },
  {
    id: "in-app-notifications",
    title: items.inAppNotifications.title,
    englishTitle: "In-app notifications",
    to: "/settings/general",
    searchTerms: [
      items.inAppNotifications.terms,
      "notification toast popup completion input approval failure",
    ],
  },
  {
    id: "time-format",
    title: items.timeFormat.title,
    englishTitle: "Time format",
    to: "/settings/general",
    searchTerms: [
      items.timeFormat.terms,
      "timestamp clock locale system browser os 12 hour 24 hour",
    ],
  },
  {
    id: "response-streaming",
    title: items.responseStreaming.title,
    englishTitle: "Response streaming",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      items.responseStreaming.terms,
      "output token paragraph buffered wait turn legacy",
    ],
  },
  {
    id: "hide-whitespace-changes",
    title: items.hideWhitespaceChanges.title,
    englishTitle: "Hide whitespace changes",
    to: "/settings/general",
    searchTerms: [items.hideWhitespaceChanges.terms, "diff ignore spaces edits default"],
  },
  {
    id: "default-diff-file-state",
    title: items.defaultDiffFileState.title,
    englishTitle: "Default diff file state",
    to: "/settings/general",
    searchTerms: [
      items.defaultDiffFileState.terms,
      "collapsed expanded collapse expand files pull request pr code tab",
    ],
  },
  {
    id: "diff-layout",
    title: items.diffLayout.title,
    englishTitle: "Diff layout",
    to: "/settings/general",
    searchTerms: [items.diffLayout.terms, "stacked split side by side unified inline view"],
  },
  {
    id: "proactive-panels",
    title: items.proactivePanels.title,
    englishTitle: "Proactive panels",
    to: "/settings/general",
    searchTerms: [
      items.proactivePanels.terms,
      "automatically open diff pull request pr right panel agent completion",
    ],
  },
  {
    id: "skills-in-slash-menu",
    title: items.skillsInSlashMenu.title,
    englishTitle: "Show skills in slash menu",
    to: "/settings/general",
    searchTerms: [items.skillsInSlashMenu.terms, "command menu dollar $ slash /"],
  },
  {
    id: "composer-rich-text",
    title: items.composerRichText.title,
    englishTitle: "Rich text composer",
    to: "/settings/general",
    searchTerms: [
      items.composerRichText.terms,
      "composer rich text tiptap bold italic markdown styled wysiwyg",
    ],
  },
  {
    id: "composer-collapse",
    title: items.composerCollapse.title,
    englishTitle: "Collapse composer on scroll",
    to: "/settings/general",
    searchTerms: [
      items.composerCollapse.terms,
      "composer rest resting scroll wheel conversation timeline shrink minimize",
    ],
  },
  {
    id: "send-shortcut",
    title: items.sendShortcut.title,
    englishTitle: "Send shortcut",
    to: "/settings/general",
    searchTerms: [
      items.sendShortcut.terms,
      "enter return command ctrl multiline prompt new line composer",
    ],
  },
  {
    id: "follow-up-behavior",
    title: items.followUpBehavior.title,
    englishTitle: "Follow-up behavior",
    to: "/settings/general",
    searchTerms: [
      items.followUpBehavior.terms,
      "queue steer running turn send default behavior composer",
    ],
  },
  {
    id: "provider-update-checks",
    title: items.providerUpdateChecks.title,
    englishTitle: "Provider update checks",
    to: "/settings/general",
    searchTerms: [
      items.providerUpdateChecks.terms,
      "installed cli versions newer available codex claude cursor grok opencode",
    ],
    scope: "environment-defaults",
  },
  {
    id: "continue-threads-after-server-update",
    title: items.continueThreadsAfterServerUpdate.title,
    englishTitle: "Continue threads after restarts",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      items.continueThreadsAfterServerUpdate.terms,
      "resume running active interrupted work restart reboot machine crash desktop update automatically",
    ],
  },
  {
    id: "background-activity",
    title: items.backgroundActivity.title,
    englishTitle: "Background activity",
    to: "/settings/general",
    scope: "environment-defaults",
    searchTerms: [
      items.backgroundActivity.terms,
      "balanced performance battery saver advanced git fetch provider health refresh host power monitor idle policy",
    ],
  },
  {
    id: "new-threads",
    title: items.newThreads.title,
    englishTitle: "New threads",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [items.newThreads.terms, "default workspace mode draft local worktree"],
  },
  {
    id: "start-from-origin",
    title: items.startFromOrigin.title,
    englishTitle: "Start from origin",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [items.startFromOrigin.terms, "new worktrees latest matching remote branch local"],
  },
  {
    id: "add-project-starts-in",
    title: items.addProjectStartsIn.title,
    englishTitle: "Add project starts in",
    to: "/settings/general",
    scope: "environment-defaults",
    searchTerms: [items.addProjectStartsIn.terms, "base directory folder browser path home"],
  },
  {
    id: "unpin-confirmation",
    title: items.unpinConfirmation.title,
    englishTitle: "Unpin confirmation",
    to: "/settings/general",
    searchTerms: [items.unpinConfirmation.terms, "ask before thread pinned section"],
  },
  {
    id: "archive-confirmation",
    title: items.archiveConfirmation.title,
    englishTitle: "Archive confirmation",
    to: "/settings/general",
    searchTerms: [items.archiveConfirmation.terms, "ask before thread second click inline action"],
  },
  {
    id: "delete-confirmation",
    title: items.deleteConfirmation.title,
    englishTitle: "Delete confirmation",
    to: "/settings/general",
    searchTerms: [items.deleteConfirmation.terms, "ask before thread chat history"],
  },
  {
    id: "quit-confirmation",
    title: items.quitConfirmation.title,
    englishTitle: "Quit shortcut",
    to: "/settings/general",
    searchTerms: [
      items.quitConfirmation.terms,
      "confirmation desktop app exit direct hold double click press twice",
    ],
    desktopOnly: true,
  },
  {
    id: "text-generation-model",
    title: items.textGenerationModel.title,
    englishTitle: "Text generation model",
    to: "/settings/general",
    scope: "project-defaults",
    searchTerms: [
      items.textGenerationModel.terms,
      "generated thread titles source control content default provider",
    ],
  },
  {
    id: "diagnostics",
    title: items.diagnostics.title,
    englishTitle: "Diagnostics",
    to: "/settings/general",
    searchTerms: [
      items.diagnostics.terms,
      "logs traces processes resource history failures spans cpu memory",
    ],
  },
  {
    id: "open-source-licenses",
    title: items.openSourceLicenses.title,
    englishTitle: "Open source licenses",
    searchTerms: [items.openSourceLicenses.terms],
    to: "/settings/general",
  },
  {
    id: "legacy-plan-mode",
    title: items.legacyPlanMode.title,
    englishTitle: "Plan mode (legacy)",
    to: "/settings/general",
    searchTerms: [items.legacyPlanMode.terms, "build plan composer old"],
  },
  {
    id: "legacy-context-window-indicator",
    title: items.legacyContextWindowIndicator.title,
    englishTitle: "Context window indicator (legacy)",
    to: "/settings/general",
    searchTerms: [
      items.legacyContextWindowIndicator.terms,
      "composer meter usage tokens circle old",
    ],
  },
  {
    id: "legacy-sidebar",
    title: items.legacySidebar.title,
    englishTitle: "Sidebar (legacy)",
    to: "/settings/general",
    searchTerms: [items.legacySidebar.terms, "project thread tree old flat list"],
  },
  {
    id: "keybindings",
    title: items.keybindings.title,
    englishTitle: "Keybindings",
    to: "/settings/keybindings",
    searchTerms: [items.keybindings.terms, "keyboard shortcuts hotkeys commands bindings json"],
  },
  ...KEYBINDING_SEARCH_ITEMS,
  {
    id: "snap-shot-enabled",
    title: items.snapShotEnabled.title,
    englishTitle: "SnapShots",
    searchTerms: [items.snapShotEnabled.terms, "window capture screenshot"],
    to: "/settings/snap-shot",
  },
  {
    id: "snap-shot-accessibility",
    title: items.snapShotAccessibility.title,
    englishTitle: "Include app text",
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
    searchTerms: [
      items.snapShotAccessibility.terms,
      "capture accessibility data text UI structure elements privacy omit agent context",
    ],
  },
  {
    id: "snap-shot-shortcut",
    title: items.snapShotShortcut.title,
    englishTitle: "Capture shortcut",
    searchTerms: [items.snapShotShortcut.terms],
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-sound",
    title: items.snapShotSound.title,
    englishTitle: "Capture sound",
    searchTerms: [items.snapShotSound.terms],
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-flash",
    title: items.snapShotFlash.title,
    englishTitle: "Capture flash",
    searchTerms: [items.snapShotFlash.terms],
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "snap-shot-animations",
    title: items.snapShotAnimations.title,
    englishTitle: "Capture animations",
    searchTerms: [items.snapShotAnimations.terms],
    to: "/settings/snap-shot",
    targetId: "snap-shot-enabled",
  },
  {
    id: "providers",
    title: items.providers.title,
    englishTitle: "Providers",
    to: "/settings/providers",
    searchTerms: [
      items.providers.terms,
      "agents cli codex claude cursor grok opencode antigravity google sign in sign out install subscription instances authentication api key models configuration binary path config directory endpoint arguments environment variables display name accent color custom favorite hidden auto compact",
    ],
  },
  {
    id: "usage-providers",
    title: items.usageProviders.title,
    englishTitle: "Usage providers",
    to: "/settings/providers",
    searchTerms: [
      items.usageProviders.terms,
      "usage sources CLIProxyAPI CLI proxy hub quota subscription limits management key add remove",
    ],
    providerSettingsOnly: true,
  },
  {
    id: "provider-health-check-interval",
    title: items.providerHealthCheckInterval.title,
    englishTitle: "Health check interval",
    to: "/settings/providers",
    searchTerms: [
      items.providerHealthCheckInterval.terms,
      "refresh availability versions auth state models background probes seconds off",
    ],
    providerSettingsOnly: true,
  },
  {
    id: "agent-browser-access",
    title: items.agentBrowserAccess.title,
    englishTitle: "Agent browser access",
    to: "/settings/integrations",
    scope: "project-defaults",
    searchTerms: [
      items.agentBrowserAccess.terms,
      "allow disable enable open drive preview tools sessions project override",
    ],
  },
  {
    id: "device-hosts",
    title: items.deviceHosts.title,
    englishTitle: "Device hosts",
    to: "/settings/integrations",
    searchTerms: [
      items.deviceHosts.terms,
      "ssh remote simulator emulator ios android mac mini identity key connection",
    ],
  },
  {
    id: "agent-device-access",
    title: items.agentDeviceAccess.title,
    englishTitle: "Agent device access",
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: [
      items.agentDeviceAccess.terms,
      "allow simulator emulator ios android drive tools sessions",
    ],
  },
  {
    id: "device-hub",
    title: items.deviceHub.title,
    englishTitle: "Device hub",
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: [items.deviceHub.terms, "simulator emulator ios android install start"],
  },
  {
    id: "device-platform-support",
    title: items.devicePlatformSupport.title,
    englishTitle: "Simulator support",
    to: "/settings/integrations",
    targetId: "devices",
    searchTerms: [items.devicePlatformSupport.terms, "xcode android studio sdk avd runtime"],
  },
  {
    id: "browser-profiles",
    title: items.browserProfiles.title,
    englishTitle: "Browser profiles",
    searchTerms: [items.browserProfiles.terms],
    to: "/settings/integrations",
    targetId: "browser",
  },
  {
    id: "browser-default-profile",
    title: items.browserDefaultProfile.title,
    englishTitle: "Default browser profile",
    searchTerms: [items.browserDefaultProfile.terms],
    to: "/settings/integrations",
    targetId: "browser-profiles",
  },
  {
    id: "browser-default-viewport",
    title: items.browserDefaultViewport.title,
    englishTitle: "Default browser viewport",
    to: "/settings/integrations",
    searchTerms: [
      items.browserDefaultViewport.terms,
      "preview size width height device desktop mobile rotate",
    ],
  },
  {
    id: "browser-default-zoom",
    title: items.browserDefaultZoom.title,
    englishTitle: "Default browser zoom",
    to: "/settings/integrations",
    searchTerms: [items.browserDefaultZoom.terms, "preview page scale tabs percent"],
  },
  {
    id: "browser-default-appearance",
    title: items.browserDefaultAppearance.title,
    englishTitle: "Default browser appearance",
    to: "/settings/integrations",
    searchTerms: [
      items.browserDefaultAppearance.terms,
      "preview color scheme light dark system os",
    ],
  },
  {
    id: "browser-recording-frame-rate",
    title: items.browserRecordingFrameRate.title,
    englishTitle: "Browser recording frame rate",
    searchTerms: [items.browserRecordingFrameRate.terms],
    to: "/settings/integrations",
  },
  {
    id: "browser-link-target",
    title: items.browserLinkTarget.title,
    englishTitle: "Open links in",
    to: "/settings/integrations",
    searchTerms: [
      items.browserLinkTarget.terms,
      "links default browser in-app browser external open",
    ],
  },
  {
    id: "browser-auto-show-floating-preview",
    title: items.browserAutoShowFloatingPreview.title,
    englishTitle: "Auto-show floating preview",
    to: "/settings/integrations",
    searchTerms: [
      items.browserAutoShowFloatingPreview.terms,
      "agent opens browser device simulator pop into view hide",
    ],
  },
  {
    id: "automatic-pull",
    title: items.automaticPull.title,
    englishTitle: "Automatically pull",
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [
      items.automaticPull.terms,
      "auto pull default branch current checkout fast forward upstream",
    ],
  },
  {
    id: "pull-request-merge-method",
    title: items.pullRequestMergeMethod.title,
    englishTitle: "Default merge method",
    to: "/settings/source-control",
    scope: "project-defaults",
    searchTerms: [
      items.pullRequestMergeMethod.terms,
      "pull request merge squash rebase last selected",
    ],
  },
  {
    id: "source-control",
    title: items.sourceControl.title,
    englishTitle: "Source control",
    to: "/settings/source-control",
    scope: "environment-defaults",
    searchTerms: [
      items.sourceControl.terms,
      "version control git github gitlab forgejo gitea tea codeberg bitbucket azure devops hosting integrations credentials scan server environment",
    ],
  },
  {
    id: "git-fetch-interval",
    title: items.gitFetchInterval.title,
    englishTitle: "Git fetch interval",
    to: "/settings/source-control",
    searchTerms: [
      items.gitFetchInterval.terms,
      "automatic remote branch refresh background credentials security keys seconds off",
    ],
    environmentOnly: true,
    scope: "environment-defaults",
  },
  {
    id: "source-control-writing-style",
    title: items.sourceControlWritingStyle.title,
    englishTitle: "Source control writing style",
    to: "/settings/source-control",
    searchTerms: [
      items.sourceControlWritingStyle.terms,
      "repository conventions conventional commits custom instructions change descriptions request titles",
    ],
    environmentOnly: true,
  },
  {
    id: "follow-change-request-templates",
    title: items.followChangeRequestTemplates.title,
    englishTitle: "Follow change request templates",
    to: "/settings/source-control",
    searchTerms: [
      items.followChangeRequestTemplates.terms,
      "repository pr pull request description structure",
    ],
    environmentOnly: true,
  },
  {
    id: "source-control-writer-model",
    title: items.sourceControlWriterModel.title,
    englishTitle: "Source control writer model",
    to: "/settings/source-control",
    searchTerms: [
      items.sourceControlWriterModel.terms,
      "override generated commit change request pr titles descriptions branch bookmark",
    ],
    environmentOnly: true,
    scope: "project-defaults",
  },
  {
    id: "project-actions",
    title: items.projectActions.title,
    englishTitle: "Actions",
    to: "/settings/projects",
    searchTerms: [
      items.projectActions.terms,
      "commands scripts setup run dev server checkout worktree t3.json import",
    ],
  },
  {
    id: "environment-icon",
    title: items.environmentIcon.title,
    englishTitle: "Environment icon",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: [
      items.environmentIcon.terms,
      "machine glyph sidebar mac mini studio laptop desktop server cloud vm",
    ],
    localBackendManagementOnly: true,
  },
  {
    id: "local-environment",
    title: items.localEnvironment.title,
    englishTitle: "Local environment",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: [
      items.localEnvironment.terms,
      "turn off on disable enable local server agents remote only restart",
    ],
    desktopOnly: true,
  },
  {
    id: "network-access",
    title: items.networkAccess.title,
    englishTitle: "Network access",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: [
      items.networkAccess.terms,
      "expose backend remote pairing local machine interfaces host restart",
    ],
    localBackendManagementOnly: true,
  },
  {
    id: "tailscale-https",
    title: items.tailscaleHttps.title,
    englishTitle: "Tailscale HTTPS",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: [items.tailscaleHttps.terms, "serve magicdns endpoint remote secure network"],
    desktopOnly: true,
    localBackendManagementOnly: true,
  },
  {
    id: "wsl-backend",
    title: items.wslBackend.title,
    englishTitle: "WSL backend",
    to: "/settings/connections",
    searchTerms: [
      items.wslBackend.terms,
      "windows subsystem linux distro second server projects stop windows backend restart",
    ],
    desktopOnly: true,
    windowsOnly: true,
    localBackendManagementOnly: true,
    wslAvailableOnly: true,
  },
  {
    id: "t3-connect",
    localEnvironmentOnly: true,
    title: items.t3Connect.title,
    englishTitle: "T3 Connect",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: [items.t3Connect.terms, "managed tunnel cloud other devices remote"],
    desktopOnly: true,
    cloudOnly: true,
  },
  {
    id: "publish-agent-activity",
    localEnvironmentOnly: true,
    title: items.publishAgentActivity.title,
    englishTitle: "Publish agent activity",
    to: "/settings/connections",
    targetId: "connections-environment",
    searchTerms: [
      items.publishAgentActivity.terms,
      "mobile push notifications live activities cloud tunnel",
    ],
    cloudOnly: true,
  },
  {
    id: "connections-environment",
    title: items.connectionsEnvironment.title,
    englishTitle: "This machine",
    to: "/settings/connections",
    searchTerms: [
      items.connectionsEnvironment.terms,
      "connections server backend local remote access administrative permissions scope pairing links qr code authorized clients sessions revoke endpoint",
    ],
  },
  {
    id: "remote-environments",
    title: items.remoteEnvironments.title,
    englishTitle: "Environments",
    to: "/settings/connections",
    searchTerms: [
      items.remoteEnvironments.terms,
      "add pair backend host code ssh config agent tunnel saved weavra direct",
    ],
  },
  {
    id: "load-balancing",
    title: items.loadBalancing.title,
    englishTitle: "Load balancing",
    to: "/settings/connections",
    searchTerms: [
      items.loadBalancing.terms,
      "automatic machine environment resources cpu memory capacity preference weight shared projects",
    ],
  },
  {
    id: "github-routing",
    title: items.githubRouting.title,
    englishTitle: "GitHub sharing",
    to: "/settings/connections",
    searchTerms: [
      items.githubRouting.terms,
      "pull request trusted environments shared credentials permissions read actions",
    ],
  },
  {
    id: "archive",
    title: items.archive.title,
    englishTitle: "Archived threads",
    to: "/settings/archived",
    searchTerms: [items.archive.terms, "restore reopen deleted history projects"],
  },
] as const satisfies ReadonlyArray<SettingsSearchItem>;

export type SettingsSearchItemId = (typeof SETTINGS_SEARCH_ITEMS)[number]["id"];

const SEARCH_ITEMS_BY_ID = new Map(SETTINGS_SEARCH_ITEMS.map((item) => [item.id, item] as const));

const SETTINGS_CATEGORY_SCOPES: Readonly<Record<SettingsPath, SettingsSearchScope | null>> = {
  "/settings/projects": "project",
  "/settings/general": null,
  "/settings/appearance": null,
  "/settings/snap-shot": null,
  // Keybindings fan out to the selection; Providers shows the representative
  // environment at any selection. Neither needs a particular scope to render.
  "/settings/keybindings": null,
  "/settings/providers": null,
  "/settings/integrations": null,
  "/settings/source-control": "environment-defaults",
  "/settings/storage": "project-defaults",
  "/settings/connections": "connections",
  "/settings/archived": "project-defaults",
};

/** Search keeps the selected target. A missing row can explain its owning scope instead. */
export function getSettingsSearchTargetScope(targetId: string) {
  const items: readonly SettingsSearchItem[] = SETTINGS_SEARCH_ITEMS;
  const item =
    items.find((candidate) => candidate.id === targetId) ??
    items.find((candidate) => candidate.targetId === targetId);
  return item
    ? {
        title: item.title,
        scope: item.scope ?? SETTINGS_CATEGORY_SCOPES[item.to],
        ...(item.requiresThreadAutoSettlement ? { requiresThreadAutoSettlement: true } : {}),
      }
    : null;
}

interface AutoSettlementSearchEnvironment {
  readonly environmentId: EnvironmentId;
  readonly connection: { readonly phase: EnvironmentConnectionPhase };
  readonly serverConfig: {
    readonly environment: {
      readonly capabilities: { readonly threadAutoSettlement?: boolean };
    };
  } | null;
}

/** Discovery needs one capable environment; the selected page needs every connected target to support it. */
export function getThreadAutoSettlementSearchAvailability(
  environments: readonly AutoSettlementSearchEnvironment[],
  scope?: Pick<ResolvedSettingsScope, "kind" | "environmentIds">,
) {
  const connected = environments.filter(
    (environment) =>
      environment.connection.phase === "connected" && environment.serverConfig !== null,
  );
  const eligibleEnvironmentIds = connected
    .filter(
      (environment) =>
        environment.serverConfig?.environment.capabilities.threadAutoSettlement === true,
    )
    .map((environment) => environment.environmentId);
  const selected = connected.filter((environment) =>
    scope?.environmentIds.includes(environment.environmentId),
  );
  return {
    eligibleEnvironmentIds,
    isTargetAvailable:
      scope !== undefined &&
      scope.kind !== "unavailable" &&
      selected.length > 0 &&
      selected.every((environment) => eligibleEnvironmentIds.includes(environment.environmentId)),
  };
}

export function isSettingsSearchScopeAvailable(
  requiredScope: SettingsSearchScope | null,
  scopeKind: ResolvedSettingsScope["kind"],
): boolean {
  switch (requiredScope) {
    case null:
    case "connections":
      return true;
    case "environment":
    case "checkout":
      return requiredScope === scopeKind;
    case "project":
      return scopeKind === "project" || scopeKind === "checkout";
    case "environment-defaults":
      return scopeKind === "environment" || scopeKind === "all";
    case "project-defaults":
      return (
        scopeKind === "environment" ||
        scopeKind === "all" ||
        scopeKind === "project" ||
        scopeKind === "checkout"
      );
  }
}

function settingsScopeKindFromSearch(search: SettingsScopeSearch): ResolvedSettingsScope["kind"] {
  const target = validateSettingsScopeSearch({ ...search });
  if (target.checkout && !target.project) return "unavailable";
  if (target.project) return target.checkout ? "checkout" : "project";
  return target.machine ? "environment" : "all";
}

export function isSettingsOverviewVisible(search: SettingsScopeSearch): boolean {
  const kind = settingsScopeKindFromSearch(search);
  return kind === "project" || kind === "checkout";
}

/**
 * `id` and `title` props for the element a search item anchors to. Panels
 * spread (or pick from) this instead of restating the strings, so the catalog
 * and the rendered settings cannot drift apart.
 */
export function searchableSetting(id: SettingsSearchItemId): {
  readonly id: string;
  readonly title: string;
} {
  const { id: anchorId, title } = SEARCH_ITEMS_BY_ID.get(id)!;
  return { id: anchorId, title };
}

export function filterAvailableSettingsSearchItems(
  availability: SettingsSearchAvailability,
): ReadonlyArray<SettingsSearchItem> {
  const items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS;
  return items.filter(
    (item) =>
      (!item.cloudOnly || availability.hasCloudPublicConfig) &&
      (!item.environmentOnly || availability.hasEnvironment) &&
      (!item.providerSettingsOnly || availability.hasProviderSettingsEnvironment) &&
      (!item.localBackendManagementOnly || availability.canManageLocalBackend) &&
      (!item.localEnvironmentOnly || !availability.localEnvironmentDisabled) &&
      (!item.wslAvailableOnly || availability.isWslSettingsRowVisible) &&
      (!item.requiresThreadAutoSettlement || availability.hasThreadAutoSettlement),
  );
}

export function searchSettings(
  query: string,
  items: ReadonlyArray<SettingsSearchItem> = SETTINGS_SEARCH_ITEMS,
): ReadonlyArray<SettingsSearchItem> {
  const normalizedQuery = normalizeSearchText(query);
  if (normalizedQuery.length === 0) return [];
  const queryTokens = normalizedQuery.split(" ");
  const platform = typeof navigator === "undefined" ? "" : navigator.platform;

  return items
    .flatMap((item, index) => {
      if (!isElectron && item.desktopOnly === true) return [];
      if (item.macOnly && !isMacPlatform(platform)) return [];
      if (item.windowsOnly && !isWindowsPlatform(platform)) return [];

      const titles = [item.title, ...(item.englishTitle ? [item.englishTitle] : [])].map(
        normalizeSearchText,
      );
      const fields = [
        ...titles,
        normalizeSearchText(SETTINGS_SECTION_LABELS[item.to]),
        normalizeSearchText(SETTINGS_SECTION_SEARCH_ALIASES[item.to]),
        ...(item.searchTerms ?? []).map(normalizeSearchText),
      ];
      if (!queryTokens.every((token) => fields.some((field) => field.includes(token)))) return [];

      const exactPhraseField = fields.findIndex((field) => field.includes(normalizedQuery));
      const titleRank = Math.max(
        ...titles.map((title) =>
          title === normalizedQuery
            ? 5
            : title.startsWith(normalizedQuery)
              ? 4
              : title.includes(normalizedQuery)
                ? 3
                : queryTokens.every((token) => title.includes(token))
                  ? 2
                  : 0,
        ),
      );
      const rank = titleRank > 0 ? titleRank : exactPhraseField >= 0 ? 1 : 0;
      return [{ item, index, rank }];
    })
    .toSorted(
      (left, right) =>
        Number(left.item.secondary ?? false) - Number(right.item.secondary ?? false) ||
        right.rank - left.rank ||
        left.index - right.index,
    )
    .map(({ item }) => item);
}
