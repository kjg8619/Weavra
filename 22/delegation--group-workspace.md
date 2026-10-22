# Group workspace

Read and follow /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/shared-brief.md first.

Your catalog file: app/t3code/apps/web/src/i18n/ko.workspace.ts (export koWorkspace).
Your sub-namespaces: common.{toast, wizard}, devices.{setup, panel, tools, host, loading, preview}, projects.{scriptEditor, scriptsControl, files, settings, actions}, runtime.{controls, overview, fitness, capabilities, labels}

Your files (paths relative to app/t3code/apps/web/src; edit nothing else except colocated tests that assert changed copy):
- components/projectScriptEditor.tsx
- components/ProjectScriptsControl.tsx
- components/files/FileBrowserPanel.tsx
- components/preview/PreviewPanel.tsx
- components/preview/PreviewPanelShell.tsx
- components/preview/PreviewChromeRow.tsx
- components/preview/PreviewEmptyState.tsx
- components/device/DeviceSetup.tsx
- components/device/DevicePanel.tsx
- components/device/DeviceToolsPanel.tsx
- components/device/DeviceHostAvailability.tsx
- components/device/DeviceLoadingView.tsx
- components/settings/ProjectSettingsPanel.tsx
- components/settings/ProjectActionsSettings.tsx
- components/settings/ProjectActionsList.tsx
- components/settings/WeavraControls.tsx
- components/settings/WeavraSettings.tsx
- components/settings/WeavraFitness.tsx
- components/settings/CapabilityInventory.tsx
- components/ui/wizard.tsx
- components/ui/toast.tsx
- components/weavraLabels.ts

## Group-specific instructions

weavraLabels.ts: move its Korean presentation maps for raw Weavra enums into ko.runtime.labels (catalog), and make weavraLabels.ts delegate to them with the SAME exported functions/signatures and the same unknown-value fallback behavior (raw value stays available/copyable). Plan step 2 items in your scope: project Name/icon/Actions (ProjectSettingsPanel, ProjectActions*), ProjectScriptsControl.tsx and FileBrowserPanel.tsx are copy-only (lead amendment 2026-10-21b). The chat-header button aria-label "작업 추가" is runner-pinned. toast.tsx: only aria-labels/visible copy (Dismiss notification -> 알림 닫기); no behavior change. Existing tests (WeavraControls.test.tsx, CapabilityInventory.test.tsx, ProjectSettingsPanel.logic.test.ts, weavraLabels tests, toast tests, device/preview tests) must pass; update copy-equality assertions only.

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-workspace.md.
