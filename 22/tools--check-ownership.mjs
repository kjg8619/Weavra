// Verifies that every product file changed by todo 22 is owned by the plan list or a recorded amendment,
// and that scripts/hig equals the authorized runner. Writes pr-22/ownership.json.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const root = "/Users/kangjingoo/Workspace/tool/Weavra-worktrees";
const repo = `${root}/hig-22`;
const parent = "245a9efdfee4e949a5d312798bcdbf31ed0c1675";
const runner = process.env.RUNNER;
assert.ok(runner, "RUNNER must name the authorized hig-01 commit");
const plan = await fs.readFile(`${root}/omo-user-flow-20261003/.omo/plans/weavra-hig-design-20261018.md`, "utf8");
const amendments = ["2026-10-21b", "2026-10-22", "2026-10-22b", "2026-10-22c", "2026-10-22d", "2026-10-22e", "2026-10-22f", "2026-10-22g", "2026-10-22h", "2026-10-22i"]
  .map((id) => ({ id, recorded: plan.includes(`Amendment ${id}`) }));
const S = "app/t3code/apps/web/src/";
const planOwned = [
  "i18n/ko.ts", "i18n/ko.test.ts", "components/weavraLabels.ts",
  ...["NoProjectsHero", "ChatView", "Sidebar", "LegacySidebar", "ThreadStatusIndicators", "AgentsPanel", "CommandPalette", "CommandPaletteContent", "RightPanelTabs", "ConfirmDialogHost", "projectScriptEditor", "ProviderUpdateLaunchNotification", "ProviderUpdatePrimaryNotification", "ProviderUpdateEnvironmentRows"].map((n) => `components/${n}.tsx`),
  "components/onboarding/FirstRunGate.tsx", "components/onboarding/WelcomeWizard.tsx", "onboarding/providerReadiness.logic.ts",
  ...["ChatComposer", "CompactComposerControlsMenu", "DraftHeroHeadline", "ProviderStatusBanner", "ThreadErrorBanner"].map((n) => `components/chat/${n}.tsx`), "components/chat/runtimeModeConfig.ts",
  ...["PreviewPanel", "PreviewPanelShell", "PreviewChromeRow", "PreviewEmptyState"].map((n) => `components/preview/${n}.tsx`),
  ...["DeviceSetup", "DevicePanel", "DeviceToolsPanel", "DeviceHostAvailability", "DeviceLoadingView"].map((n) => `components/device/${n}.tsx`),
  ...["SettingsPanels", "SettingsSidebarNav", "SettingsBreadcrumb", "SettingsScopeNotice", "SettingsScopeContext", "SettingsGroup", "settingsLayout", "ProviderSettingsPanel", "ProviderSettingsForm", "ProviderInstanceCard", "ProviderModelsSection", "CustomModelEditor", "ProviderSetupSection", "AddProviderInstanceDialog", "AddProviderInstanceWizardSteps", "KeybindingsSettings", "SnapShotSettings", "SnapShotSetupDialog", "IntegrationsSettings", "SourceControlSettings", "StorageSettings", "ConnectionsSettings", "EnvironmentRow", "DiagnosticsSettings", "ResourceTelemetryDiagnostics", "OpenSourceLicenses", "ThemeSettings", "ThemePreviewCircles", "SettingsFontPreviews", "ProjectSettingsPanel", "ProjectActionsSettings", "ProjectActionsList", "WeavraControls", "WeavraSettings", "WeavraFitness", "CapabilityInventory"].map((n) => `components/settings/${n}.tsx`),
  ...["settingsSearch", "settingsScopeAxis", "KeybindingsSettings.logic", "SnapShotSettings.logic", "providerStatus"].map((n) => `components/settings/${n}.ts`),
  ...["settings.general", "settings.archived", "settings.open-source-licenses", "settings.providers"].map((n) => `routes/${n}.tsx`),
  "components/ui/wizard.tsx", "components/ui/toast.tsx",
].map((f) => S + f);
const amendmentOwned = {
  "2026-10-21b": ["routes/settings.tsx", "components/settings/NotificationSettings.tsx", "threadNotifications.ts", "components/files/FileBrowserPanel.tsx", "components/settings/ThemeEditorPanel.tsx", "components/ProjectScriptsControl.tsx"],
  "2026-10-22": ["index.css"],
  "2026-10-22b": ["components/chat/WeavraRunGraphPanel.tsx"],
  "2026-10-22c": ["components/AppSidebarLayout.tsx", "components/ui/sidebar.tsx", "components/ui/dialog.tsx", "components/ui/sheet.tsx", "timestampFormat.ts", "components/settings/SettingInheritance.tsx", "components/settings/ProjectDefaultsSettings.tsx", "components/settings/SettingsPanels.logic.ts", "hooks/useSettings.ts", "components/settings/PanelAnimationsPreview.tsx", "components/settings/ThemeColorPicker.tsx", "components/settings/ThemeImportDialog.tsx", "components/settings/ProviderAccentColorPicker.tsx", "components/settings/UsageProviderSettings.tsx", "components/settings/AddUsageLimitSourceDialog.tsx", "components/settings/AddProviderInstanceDialog.logic.ts", "components/settings/customModelEditor.logic.ts", "components/ProviderUpdateLaunchNotification.logic.ts", "components/settings/DeviceHostsSettings.tsx", "components/settings/DeviceHostEditor.tsx", "components/settings/SourceControlWritingSettings.tsx", "components/settings/GitHubRoutingSettings.tsx", "components/settings/LoadBalancingSettings.tsx", "components/settings/LocalEnvironmentSetting.tsx", "components/settings/EnvironmentIconPicker.tsx", "components/settings/CaptureShortcutConfig.tsx", "components/settings/useSnapShotShortcutRecorder.tsx", "components/settings/SnapShotSetupDialog.logic.ts", "components/settings/ExpandableText.tsx", "components/settings/ProcessSignalActions.tsx", "hooks/useCopyToClipboard.ts", "components/ServerUpdateAction.tsx", "components/ThreadTerminalDrawer.tsx", "components/preview/PreviewMoreMenu.tsx", "components/chat/MessagesTimeline.logic.ts", "components/settings/WeavraComplex.tsx", "components/chat/WeavraTaskResult.tsx", "components/chat/WeavraTaskCard.tsx", "components/chat/weavraTaskLogic.ts", "components/chat/useWeavraTask.ts"],
  "2026-10-22d": ["components/ui/color-picker.tsx"],
  "2026-10-22e": ["components/BranchToolbar.logic.ts"],
  "2026-10-22f": ["components/chat/MessagesTimeline.tsx"],
  "2026-10-22g": ["components/contextChipParts.tsx", "components/chat/TerminalContextInlineChip.tsx", "components/ComposerPromptEditorTiptap.tsx", "components/ChatMarkdown.tsx", "terminal/ghostty/surface.ts"],
  "2026-10-22i": ["components/chat/ModelPickerContent.tsx", "components/settings/WeavraPreflightFailure.tsx", "components/chat/ZoomableImage.tsx", "components/chat/AssistantCitationCommentEditor.tsx", "components/chat/WeavraProjectSetup.tsx", "components/chat/WeavraFactCandidates.tsx", "components/settings/providerDriverMeta.ts"],
  "2026-10-22h": ["components/composerContextPresentation.tsx", "components/ChatView.logic.ts"],
};
const owner = new Map(planOwned.map((f) => [f, "plan todo 22"]));
for (const [id, list] of Object.entries(amendmentOwned)) for (const f of list) owner.set(S + f, `Amendment ${id}`);
owner.set("app/t3code/apps/web/index.html", "Amendment 2026-10-22");
const git = async (...args) => (await exec("git", ["-C", repo, ...args], { env: { ...process.env, GIT_MASTER: "1" }, maxBuffer: 16 << 20 })).stdout.trim();
const changed = (await git("diff", "--name-only", parent, "HEAD")).split("\n").filter(Boolean);
const product = changed.filter((f) => !f.startsWith("scripts/hig/"));
const tests = product.filter((f) => /\.test\.(ts|tsx)$/.test(f));
const source = product.filter((f) => !tests.includes(f));
const outside = source.filter((f) => !owner.has(f));
assert.deepEqual(outside, [], `Unowned product files: ${outside.join(", ")}`);
assert.equal(await git("diff", runner, "HEAD", "--", "scripts/hig"), "", "scripts/hig differs from the authorized runner");
assert.equal(await git("status", "--porcelain", "--untracked-files=no"), "");
const result = {
  head: await git("rev-parse", "HEAD"), parent, runner, amendments,
  source: source.map((file) => ({ file, owner: owner.get(file) })),
  colocatedTests: tests, runnerFiles: changed.filter((f) => f.startsWith("scripts/hig/")),
};
await fs.writeFile("/Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/ownership.json", JSON.stringify(result, null, 2));
console.log(`OWNERSHIP_PASS source=${source.length} tests=${tests.length} amendments=${amendments.filter((a) => a.recorded).length}/${amendments.length}`);
