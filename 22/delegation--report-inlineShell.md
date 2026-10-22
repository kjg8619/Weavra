# Report: inlineShell (round 3, HIG todo 22)

## Result
Every inline authored Korean string literal and every piece of Korean JSX text in the 14 assigned files now lives in `app/t3code/apps/web/src/i18n/ko.shell.ts`. A re-scan finds 0 non-comment lines with Hangul left in those 14 files. Values are byte-identical, except for the Latin-rule fixes listed below. Dynamic copy is now parameter functions. Strings that already exist in the shared catalog are referenced instead of duplicated: ko.common.{cancel, retry, close, back, add, search, rename, done, disabled, install, unknown, unavailable, saving, controlledTask, project, connection, approvalRequired, fullAccess}, ko.devices.{browser, terminal, files, agents, devices}, ko.chat.{send, scrollToLatest, dropToAttach}, ko.projects.{add, addPanel, openPanel, localFolder, controlSettings}, ko.onboarding.{connectComputer, continue, skipProject, chooseProject, availableAgents} and ko.runtime.executionMode.
The parent's earlier edits are unchanged: RightPanelTabs uses ko.devices.runGraph, and Sidebar's "just now" comparison uses ko.common.time.

## Replacement sites per file (count of call sites; a reused key counts each site)
| File | Sites replaced | Distinct keys referenced |
|---|---|---|
| components/ChatView.tsx | 175 | 153 |
| components/chat/ChatComposer.tsx | 102 | 87 |
| components/chat/CompactComposerControlsMenu.tsx | 9 | 5 |
| components/chat/runtimeModeConfig.ts | 8 | 6 |
| components/chat/DraftHeroHeadline.tsx | 8 | 6 |
| components/AgentsPanel.tsx | 12 | 8 |
| components/ThreadStatusIndicators.tsx | 6 | 4 |
| components/NoProjectsHero.tsx | 2 | 1 |
| components/CommandPaletteContent.tsx | 3 | 1 |
| components/CommandPalette.tsx | 94 | 62 |
| components/RightPanelTabs.tsx | 71 | 33 |
| components/onboarding/WelcomeWizard.tsx | 68 | 51 |
| components/LegacySidebar.tsx | 9 | 8 |
| components/Sidebar.tsx | 118 | 72 |
| **Total** | **685** | |

ThreadStatusIndicators includes one type-only edit: `TerminalStatusIndicator.label` changed from the literal type `"터미널 프로세스 실행 중"` to `string`, because the value is now a catalog reference. No runtime change.
The new ko.ts imports are `import { ko } from "~/i18n/ko";` in CompactComposerControlsMenu.tsx, runtimeModeConfig.ts, DraftHeroHeadline.tsx and CommandPaletteContent.tsx.

## Catalog sub-namespaces
- New in ko.shell.ts: chat.composerMenu, chat.runtimeMode, chat.draftHero.
- Extended: chat.view, chat.composer, devices.agentsPanel, projects.{sidebar, legacySidebar, commandPalette, threadStatus, rightPanel, hero}, onboarding.wizard. CommandPaletteContent uses projects.commandPalette.navigate.
- None of the names collide with the koWorkspace or koTransferC sub-namespaces that ko.ts spreads after koShell.

## Values intentionally changed (glossary and Latin rule)
1. "Enter" in prose became "엔터 키" (round-2 keycap rule):
   - projects.commandPalette.gitCloneUrlEmptyState (existing key): "Git 클론 URL을 입력하고 엔터 키를 눌러 계속하세요."
   - projects.commandPalette.repositoryPathEmptyState: "저장소 경로를 입력하고 엔터 키를 눌러 조회하세요."
   - projects.commandPalette.cloneDestinationEmptyState: "대상 경로를 선택하고 엔터 키를 눌러 복제하세요."
   - projects.commandPalette.createFolderEmptyState: "엔터 키를 눌러 이 폴더를 만들고 프로젝트로 추가하세요."
   - onboarding.wizard.confirmAndPressEnter: "명령을 확인한 다음 엔터 키를 눌러 실행해 주세요."
   No test or scripts/hig case references the old wording (checked with grep).
2. ChatView.tsx thread title seed `Review: <label>` (English, user-visible as the new thread title) became chat.view.reviewTitleSeed: `검토: ${label}`. No code parses the "Review:" prefix (checked with grep).

## Left unchanged on purpose
- "스레드" wording in the delete dialogs (Sidebar.tsx and LegacySidebar.tsx: 선택한 스레드 N개를 삭제할까요?, “title” 스레드를 삭제할까요?, 이 스레드의 대화 기록이 …, 스레드 삭제). These break the glossary (thread → 대화), but scripts/hig/cases.mjs:142 pins `“03 Code blocks” 스레드를 삭제할까요?` / `스레드 삭제` and harness.test.ts pins "스레드 삭제". They were moved byte-identical. The lead should decide on a runner-coordinated rename.
- "Ctrl/⌘ Enter로 …" in the existing chat.composer.controlledAnalysisHelp and controlledSaveHelp (prose keycaps). Korean has no equivalent for Ctrl, and the brief only allows symbols the app already uses, so this was not invented here. Lead decision.
- Existing chat.composer.unsupportedImageType lists "GIF, HEIC, HEIF, JPEG, PNG, WebP" inside the sentence. These are format tokens, and the string is a catalog value, so there is no JSX to wrap them in <code>. Reported per the round-2 data-token rule.
- Remaining Latin in the 14 files is all in allowed classes:
  - Keycaps inside <Kbd>: Enter, Backspace, Esc (CommandPaletteContent.tsx:80/86/91, CommandPalette.tsx:2928/2971).
  - Runner-pinned "(Enter)" / "(⌘ Enter)" / "(Ctrl Enter)" suffix in the add-button aria-label/tooltip (CommandPalette.tsx:2911/2947), and `submitModifierLabel = "Ctrl"` (keycap).
  - "PR" tab labels in RightPanelTabs.tsx (2 letters, below the 3-letter rule). They are still inline, because the task was to move Korean.
  - Proper names: "Weavra" aria-label (WelcomeWizard.tsx:195), "Claude Code"/"Codex" aria-labels (WelcomeWizard.tsx:1520/1524) and their installAgent argument, "T3 Connect" (WelcomeWizard.tsx), "Git URL"/"WSL" inside catalog values.
  - URL example placeholder "https://your-server:5230/pair#token=…" (WelcomeWizard.tsx:573) and the command `weavra-server pair`.
  - Search terms "this device", "theme", "appearance", "mode" in CommandPalette searchTerms. They are not displayed (machine search keywords), and their meaning did not change.
- Two copies are sentence fragments next to a JSX node, the same pattern as the existing tailscaleHint*/newThreadInProject entries: chat.draftHero.whatToBuildSuffix / startHereSuffix after {projectSelector}, and onboarding.wizard.runInTerminalStart / runInTerminalEnd around <code>{command}</code>. The <code> token stays in its own element.
- ChatView 'button[aria-label="맨 아래로 이동"]' selector now interpolates ko.chat.scrollToLatest, so it stays in sync with the label it targets.

## Tests
No colocated test needed a change. The values are byte-identical, and the existing assertions already hold. The 13 test files below pass.

## Commands (from app/t3code, Node 24.19.0, TMPDIR=/tmp)
1. `pnpm exec vp fmt <15 files>`: exit 0. `pnpm exec vp fmt --check <15 files>`: exit 0 ("All matched files use the correct format").
2. `pnpm exec vp lint <15 files>`: exit 0. Only warnings remain (react compiler / exhaustive-deps / no-unused-vars families in ChatView, ChatComposer, Sidebar, LegacySidebar, CommandPalette, WelcomeWizard, RightPanelTabs). None of them falls on a line that references ko.*, and none comes from a rule this copy move could trigger. They are pre-existing.
3. `pnpm --filter @t3tools/web typecheck`: exit 0, 0 "error TS" lines in the whole web package.
4. From apps/web: `pnpm exec vp test run --project unit` on src/i18n/ko.test.ts, components/chat/ChatComposer.test.tsx, components/chat/DraftHeroHeadline.test.tsx, components/ChatView.logic.test.ts, components/CommandPalette.logic.test.ts, components/RightPanelTabs.test.tsx, components/Sidebar.{drag,logic,motion,pointer,snooze}.test.ts, components/ThreadStatusIndicators.test.ts(x): exit 0, 13 files / 530 tests passed. ko.test.ts checks non-empty copy, freezing, and that every function parameter influences the output for all new functions.
5. Re-scan: 0 non-comment Hangul lines remain in the 14 files. The remaining Latin is listed above.

## Fit concerns
None found. Every label kept its text, so widths are unchanged, except "엔터 키" in five empty-state or help sentences (wrapping text, not fixed width).
Not done (per instructions): no commit, no git state change, no build or app launch, and no file outside the list + ko.shell.ts was touched.
