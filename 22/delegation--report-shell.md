# Report: group shell (todo 22)

Worktree: /Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22. Paths below are relative to app/t3code/apps/web/src. No commits, no git state changes, no build or app launch.

## Files changed (15)
- i18n/ko.shell.ts (catalog)
- components/ChatView.tsx, Sidebar.tsx, LegacySidebar.tsx, ThreadStatusIndicators.tsx, AgentsPanel.tsx, CommandPalette.tsx, RightPanelTabs.tsx, ConfirmDialogHost.tsx, NoProjectsHero.tsx
- components/onboarding/FirstRunGate.tsx, components/onboarding/WelcomeWizard.tsx
- components/chat/ChatComposer.tsx
- Tests: components/ThreadStatusIndicators.test.tsx, components/RightPanelTabs.test.tsx

Four assigned files had no authored English copy, so they are unchanged: CommandPaletteContent.tsx (only the Enter/Backspace/Esc keycaps), chat/CompactComposerControlsMenu.tsx, chat/DraftHeroHeadline.tsx and chat/runtimeModeConfig.ts.

## Catalog sub-namespaces added (221 entries)
onboarding.wizard 3, onboarding.firstRun 5, chat.view 40, chat.composer 23, projects.hero 1, projects.sidebar 14, projects.legacySidebar 90, projects.commandPalette 15, projects.threadStatus 5, projects.rightPanel 5, projects.confirmDialog 2, devices.agentsPanel 18.
The empty assigned namespaces chat.composerMenu, chat.draftHero and chat.runtimeMode were not created because nothing needed them.
Existing keys were reused where the meaning is the same: ko.common.loading, confirm, cancel, save, retry, search, delete; ko.projects.add ("Add project" -> 프로젝트 추가 in LegacySidebar).
Strings migrated: about 230 call sites. This includes English copy and Korean copy that broke the glossary: branch -> 브랜치, checkout -> 체크아웃, worktree -> 작업 트리, base branch -> 기준 브랜치, pull request -> 풀 리퀘스트, push -> 푸시, 프로바이더 -> 공급자, "다음 Run" -> "다음 실행", 스레드 -> 대화 outside the deletion flow, and tailnet -> Tailscale 네트워크.

## Notable decisions
- Deletion host: every runner-pinned deletion string stays byte-exact. That covers 삭제, 스레드 삭제, the `“${title}” 스레드를 삭제할까요?` pattern, plus the related "선택한 스레드 N개를 삭제할까요?" and "이 스레드(들)의 대화 기록이 영구히 지워지며…" lines that go with it. Locations: Sidebar.tsx:4004-4005 and 4265-4268; LegacySidebar.tsx:1980-1985 and 2353-2357. These lines keep 스레드 on purpose so they stay consistent with the pinned pattern.
- ConfirmDialogHost: the Cancel button now always reads 취소 (ko.common.cancel). Before, it showed "Cancel" when no confirmLabel was passed. The default confirm label is now 확인, and the fallback title and description are Korean. Destructive messages built for this host keep their title line ending in "?", because the host splits the title on "?".
- Both sidebars are covered. LegacySidebar was almost entirely English: sort and grouping labels, context menus, toasts, the remove-project confirmation (it still states what is lost and "이 작업은 되돌릴 수 없어요."), rename and grouping dialogs, the status alerts, and the sort menu.
- ChatView "Switch to <branch>?" became `<code>branch</code>(으)로 전환할까요?`. The branch name stays in its <code> element.
- Two catalog keys were renamed to globalDefault / globalDefaultWith. The original names started with `use`, and the linter's react(hooks) rule took them for hooks.

## Strings intentionally left untranslated
- WelcomeWizard.tsx:457 "T3 Connect": product/service proper name, not on the allow list. Flagged for the lead.
- WelcomeWizard.tsx:765, 942, 1175, 1255, 1500 "Claude Code": provider product name ("Code" is not on the allow list). Flagged.
- WelcomeWizard.tsx:565 placeholder `https://your-server:5230/pair#token=…`: URL example.
- WelcomeWizard.tsx `weavra-server serve`, `weavra-server pair`, `--tailscale`: commands.
- CommandPalette.tsx:266 "Linux": navigator.platform machine value.
- CommandPalette.tsx:322, 328 "Forgejo / Gitea", "Azure DevOps": provider proper names.
- CommandPalette.tsx:2172, 2399 "Windows" inside Korean text: OS proper name.
- CommandPalette.tsx searchTerms arrays (e.g. 1748, 1771, and others): English search aliases. They are never displayed and are left so English typing keeps matching. Lead decision: should Korean aliases be added?
- RightPanelTabs.tsx:511 "iOS", "Android": platform proper names.
- ko.shell.ts:100 "GIF, HEIC, HEIF, JPEG, PNG, WebP": file format identifiers.
- ChatComposer.tsx:2385 and the rest of the slash-command block (/model, /plan, /default, /skill:…): commands.
- ChatComposer.tsx:2887 `HTTP ${status}`: protocol status identifier inside a thrown error.
- Sidebar.tsx:264 "just now": a comparison against timestampFormat.ts output, not a label. The displayed result "now" became 방금.
- Sidebar.tsx:2200 `target: "branch name"`: passed to useCopyToClipboard, which builds an English error message in hooks/useCopyToClipboard.ts (not my file).
- LegacySidebar.tsx:1628, 1669 and ChatView.tsx:9721: console.error / console.warn text, not shown to users.
- Fixture and user data shown as-is: thread and project titles, branch names, paths, environment labels, PR numbers.

## Tests updated
- components/ThreadStatusIndicators.test.tsx: the worktree aria-label assertion now uses `ko.projects.threadStatus.worktreeWithBranch("sidebar-indicator", "feature/sidebar-indicator")`. Same exact-match check.
- components/RightPanelTabs.test.tsx: the mute/unmute aria-label cases and their not.toContain checks now use `ko.projects.rightPanel.muteTab/unmuteTab("Local site")`. The two `reasons.pullRequest` toBe checks use `ko.projects.rightPanel.branchNoPullRequest`. No assertion was removed or loosened.

## Commands run (from app/t3code unless noted)
1. `pnpm exec vp fmt <15 files>` exit 0; `pnpm exec vp fmt --check <15 files>` exit 0 (re-checked after the last edit).
2. `pnpm exec vp lint <15 files>` exit 0. 106 warnings, all pre-existing rule types; none falls on a line added in my diff (checked against `git diff -U0`). Two react(hooks) warnings my keys had caused were fixed by the rename above.
3. `pnpm --filter @t3tools/web typecheck` exit 1, with 540 errors and none in my files. All are in other groups' in-progress files: settings/DiagnosticsSettings, SnapShot*, ThemeEditorPanel, KeybindingsSettings*, ThemeSettings, OpenSourceLicenses, ThemePreviewCircles, SettingsFontPreviews. There are also 3 TS2783 errors in i18n/ko.ts for duplicate settings keys integrations, sourceControl and storage (koSettings* spreads, not shell).
4. From apps/web: `pnpm exec vp test run --project unit` on ThreadStatusIndicators.test.ts/.tsx, RightPanelTabs.test.tsx, ConfirmDialogHost.test.tsx, chat/ChatComposer.test.tsx, chat/DraftHeroHeadline.test.tsx, ChatView.logic.test.ts, CommandPalette.logic.test.ts, Sidebar.logic/pointer/motion/snooze/drag tests and SidebarStageBackdrop.test.tsx: exit 0, 14 files, 529 tests passed.
5. Re-scan: no Korean string in my files contains a non-allowed Latin word except the remainders listed above. No English authored literal or JSX text is left outside those classes.

## Concerns and questions
- I could not find a "command-state idle wording" item in my files. The only idle-state copy was AgentsPanel's "Idle" (now 대기) and the subagent footer counts. If the plan meant a different string, tell me which one.
- Sidebar.tsx:264 relies on timestampFormat.ts returning "just now". If another group translates timestampFormat, that comparison stops matching and the label shows the full relative text.
- CommandPalette environment labels are now 로컬 / 원격 instead of Local / Remote. They feed the palette's search terms, so typing "local" no longer matches them. The fixtures in CommandPalette.logic.test.ts are input data and still pass.
- Fit: nothing was left unchanged because of width. Watch two spots: the AgentsPanel metadata line, which already truncates (e.g. "도구 3개", "2번째 실행"), and the ChatView build-mismatch banner button (`max-w-full truncate`, "클라이언트와 서버 빌드가 맞지 않아요").
- Particles for arbitrary names use the 을(를) / 이(가) / 은(는) / (으)로 forms.
