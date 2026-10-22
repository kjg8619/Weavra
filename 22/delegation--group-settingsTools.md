# Group settingsTools

Read and follow /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/shared-brief.md first.

Your catalog file: app/t3code/apps/web/src/i18n/ko.settingsTools.ts (export koSettingsTools).
Your sub-namespaces: settings.{diagnostics, telemetry, licenses, keybindings, snapshots, appearance, themeEditor, fonts}

Your files (paths relative to app/t3code/apps/web/src; edit nothing else except colocated tests that assert changed copy):
- components/settings/DiagnosticsSettings.tsx
- components/settings/ResourceTelemetryDiagnostics.tsx
- components/settings/OpenSourceLicenses.tsx
- components/settings/KeybindingsSettings.tsx
- components/settings/KeybindingsSettings.logic.ts
- components/settings/SnapShotSettings.tsx
- components/settings/SnapShotSettings.logic.ts
- components/settings/SnapShotSetupDialog.tsx
- components/settings/ThemeSettings.tsx
- components/settings/ThemePreviewCircles.tsx
- components/settings/SettingsFontPreviews.tsx
- components/settings/ThemeEditorPanel.tsx
- routes/settings.open-source-licenses.tsx

## Group-specific instructions

KeybindingsSettings.logic.ts commandLabel() supplies the visible command names on the Keybindings page AND the settings-search titles; translate those labels (e.g. "Sidebar: Toggle" -> "사이드바: 전환") while keeping command IDs, key strings and when-expression syntax exact. License bodies, package names and license identifiers stay original; only the surrounding UI (title, search, counts, buttons) is translated. ThemeEditorPanel.tsx is copy-only (lead amendment 2026-10-21b). Existing tests (KeybindingsSettings.logic.test.ts, SnapShotSettings*.test.*, themeEditorStore/ThemeSelection/ThemeEditorHost tests, ResourceTelemetryDiagnostics.logic.test.ts) must pass; update copy-equality assertions only. Unowned helpers (ThemeImportDialog.tsx, CaptureShortcutConfig.tsx, colorPickers, etc.) are NOT yours: list visible copy with file:line in your report.

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-settingsTools.md.
