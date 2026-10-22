# Group transferA (round 2)

Read and follow /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/shared-brief.md first, then the round-2 rules below.

## Additional rules for this round (lead Amendment 2026-10-22c)

- Your files are outside the original todo-22 list and were transferred for COPY/CATALOG ONLY: no layout,
  class, behavior, command, data or wire change. Only displayed copy, aria/title/placeholder/tooltip text
  and toast/error copy change.
- "Run" is translated to 실행 everywhere (verb AND the Weavra execution entity): 공식 실행, 실행 리비전,
  실행 상태, 이전 실행. "Run 그래프" is already "실행 그래프". Runtime and Kernel stay.
- Keycap names (Ctrl, Alt, Shift, Cmd, Enter, Esc, Tab, Space, Up, Down, Left, Right) may appear ONLY
  inside keycap/kbd elements. In prose, aria-labels and option labels use Korean (엔터 키, 위쪽 화살표,
  아래쪽 화살표) or the symbols already used by the app (⌘ ⇧ ⌥ ⌃ ↑ ↓ ← →).
- Data tokens (model IDs, file names, env-var names, package names, paths, URLs, commands) must stay in
  their own element/field, never embedded inside a translated sentence, where the QA runner cannot tell
  them apart. Where existing copy embeds such a token in a sentence, keep it but wrap the token in
  <code> if the surrounding JSX already allows a child element; otherwise report it.
- Additional allowed proper names (only as names): Azure DevOps, Forgejo, Gitea, Google, Gemini, Vertex AI,
  GitHub Copilot, Claude Code, T3 Connect, MagicDNS, Tailscale Serve, Xcode, Android Studio, Face ID,
  VoiceOver, Liquid Glass, iOS, Android, Windows, Linux, macOS, theme names T3 Chat/Grove/Ocean/Ember/Iris,
  and CPU, GPU, PID, HTTP. "Electron" is translated (데스크톱).

Your catalog file: app/t3code/apps/web/src/i18n/ko.transferA.ts (export koTransferA).
Your sub-namespaces: common.{sidebarChrome, dialog, time, clipboard, serverUpdate}, settings.{inheritance, projectDefaults, restoreLabels, panelAnimations, themeColors, themeImport, localEnvironment, environmentIcons, primaryUnavailable}

Your files (paths relative to app/t3code/apps/web/src; edit nothing else except colocated tests that assert changed copy):
- components/AppSidebarLayout.tsx
- components/ui/sidebar.tsx
- components/ui/dialog.tsx
- components/ui/sheet.tsx
- timestampFormat.ts
- components/settings/SettingInheritance.tsx
- components/settings/ProjectDefaultsSettings.tsx
- components/settings/SettingsPanels.logic.ts
- hooks/useSettings.ts
- components/settings/PanelAnimationsPreview.tsx
- components/settings/ThemeColorPicker.tsx
- components/settings/ThemeImportDialog.tsx
- components/settings/LocalEnvironmentSetting.tsx
- components/settings/EnvironmentIconPicker.tsx
- components/ServerUpdateAction.tsx
- hooks/useCopyToClipboard.ts

## Group-specific instructions

timestampFormat.ts: relative time copy becomes Korean ("방금", "5분 전", "어제 HH:MM" style; keep the same structure/fields). components/Sidebar.tsx:264 compares a label against "just now"; that comparison must keep working: change ONLY that comparison to use the same catalog constant (Sidebar.tsx is otherwise not yours; this single-line change is allowed). Prefer exposing the machine value (e.g. the existing {value,suffix} shape) over string matching if the file already has it. Existing timestampFormat tests must be updated to the Korean output only where they assert copy. ui/dialog.tsx and ui/sheet.tsx: only the close-button aria-label ("Close" -> ko.common.close). ui/sidebar.tsx: only the resize rail label. SettingsPanels.logic.ts: the restore-dialog labels must equal the corresponding row titles now in ko.settings.search.items (reuse those catalog values, so the dialog lists the same Korean names). hooks/useSettings.ts: only PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE.

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-transferA.md.
