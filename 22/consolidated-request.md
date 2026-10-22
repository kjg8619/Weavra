# weavra-hig22 - consolidated allowlist and transfer request (one runner change)

Basis: all 6 worker reports (delegation/report-*.md) plus a diagnostic measurement of the integrated
head on a packaged build (measure-draft-01: settings 1-12 top-to-end, 5 threads, panel chooser and 5
panels, add-action / custom-model / add-provider dialogs, both sidebars; 13,896 rows). This build is a
diagnostic one with uncommitted changes, so it is not used as evidence.

## A. Latin segments that must stay as they are (add to localeAudit classes)

Each item below is visible in an audited section (settings main, sidebar, providers main) unless marked.

1. Product, brand and platform names:
   - Source control: Azure DevOps, Forgejo, Gitea.
   - Providers: Google, Gemini, Vertex AI, GitHub Copilot, Claude Code.
   - Connections and sharing: T3 Connect, MagicDNS, Tailscale Serve.
   - Devices: Xcode, Android Studio, Face ID, VoiceOver, Liquid Glass.
   - Platforms: iOS, Android, Windows, Linux, macOS.
   - Built-in theme names on Appearance: T3 Chat, Grove, Ocean, Ember, Iris.
   - Electron: I would rather translate it (데스크톱), so it is not requested.
2. Acronyms and units: CPU, GPU, PID, HTTP. OS, MB and ID are under 3 letters.
3. Keycap names inside shortcut labels and AX names, on Keybindings and the composer: Ctrl, Alt,
   Shift, Cmd, Enter, Esc, Tab, Space, Up, Down, Left, Right.
4. Data, not authored copy. Classify these like the fixture values, by pattern rather than a word list:
   - model IDs (for example gpt-5.6-luna in the General default-model select);
   - licenses page: package names, versions, SPDX license IDs and notice bodies;
   - file names: keybindings.json, t3.json;
   - environment variable names: CODEX_HOME, CLAUDE_CONFIG_DIR;
   - placeholders that are commands, paths or URLs: codex, ~/.codex, bun test, http://localhost:...;
   - process names: weavra-desktop;
   - font family names: Menlo, SF Pro;
   - seeded fixture text inside composite labels, such as sidebar rows that join the project, the
     thread title and the time.

## B. Decision needed: "Run" as the Weavra entity name

You removed "Run" from the allowlist as a generic verb, and I translate the verb everywhere. A
different use remains: "Run" as the Weavra execution entity, for example 공식 Run, Run 리비전,
Run 상태 and 이전 Run. It appears about 40 times, mostly in Project settings (states 46-48) and in the
chat controlled-task panels. Plan section 3.3 says to keep Runtime/Kernel/Run when they name the actual
technical authority.

Options:
- (1) Translate every occurrence to 실행: 공식 실행, 실행 리비전, 실행 상태. This matches the
  approved 실행 그래프.
- (2) Keep "Run" as a Weavra component name next to Runtime and Kernel.

I recommend (1) for one consistent term. It touches the transfer files in C.4.

## C. Copy-only transfers needed (reachable on the W-03 corpus; same terms as 21b)

1. Every screen:
   - components/AppSidebarLayout.tsx: "Toggle main sidebar".
   - components/ui/sidebar.tsx: "Resize Sidebar".
   - components/ui/dialog.tsx:112 and components/ui/sheet.tsx:114: the dialog/sheet close button
     aria-label "Close".
   - timestampFormat.ts: "just now", "ago", "yesterday at" (sidebar rows, provider "마지막 확인").
2. Settings pages:
   - General: SettingInheritance.tsx ("Show where this value comes from"), ProjectDefaultsSettings.tsx
     (Default model / permissions / workspace, New threads, browser access, automatic pull, merge
     method), SettingsPanels.logic.ts (restore-dialog labels), hooks/useSettings.ts
     (PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE).
   - Appearance: PanelAnimationsPreview.tsx, ThemeColorPicker.tsx (role names), ThemeImportDialog.tsx.
   - Providers: ProviderAccentColorPicker.tsx, UsageProviderSettings.tsx, AddUsageLimitSourceDialog.tsx,
     AddProviderInstanceDialog.logic.ts (wizard steps Driver/Identity/Config), customModelEditor.logic.ts
     (validateDraft), ProviderUpdateLaunchNotification.logic.ts (update toasts).
   - Integrations: DeviceHostsSettings.tsx, DeviceHostEditor.tsx.
   - Source control: SourceControlWritingSettings.tsx, GitHubRoutingSettings.tsx, LoadBalancingSettings.tsx.
   - Connections: LocalEnvironmentSetting.tsx, EnvironmentIconPicker.tsx.
   - SnapShots: CaptureShortcutConfig.tsx, useSnapShotShortcutRecorder.tsx, SnapShotSetupDialog.logic.ts.
   - Diagnostics: ExpandableText.tsx, ProcessSignalActions.tsx.
   - Shared: hooks/useCopyToClipboard.ts (error messages), ServerUpdateAction.tsx.
3. Chat and panels:
   - components/ThreadTerminalDrawer.tsx: "Terminal 1", "New Terminal", "Split Terminal ...",
     "Close Terminal" (state 16).
   - components/preview/PreviewMoreMenu.tsx: "Preview menu" (state 15).
   - components/chat/MessagesTimeline.logic.ts: "Worked for ..." (state 38).
4. Only if B(1): components/settings/WeavraComplex.tsx; components/chat/{WeavraTaskResult,WeavraTaskCard}.tsx;
   components/chat/{weavraTaskLogic,useWeavraTask}.ts.

None of these changes a runner-pinned name. The runner's only needed change is A, in localeAudit.

## D. Not requested (stays as is, reported in the PR exception table)

- QuitHoldOverlay.tsx: "again to quit". Shown only while quitting, outside the corpus.
- ZoomableImage.tsx: the "zoomable image" region. Region names are not audited, and the dialog
  name is already Korean.
- CommandPalette English search aliases: kept on purpose so that English typing still works.
