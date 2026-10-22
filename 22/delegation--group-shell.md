# Group shell

Read and follow /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/shared-brief.md first.

Your catalog file: app/t3code/apps/web/src/i18n/ko.shell.ts (export koShell).
Your sub-namespaces: onboarding.{wizard, firstRun}, chat.{view, composer, composerMenu, draftHero, runtimeMode}, projects.{hero, sidebar, legacySidebar, commandPalette, threadStatus, rightPanel, confirmDialog}, devices.{agentsPanel}

Your files (paths relative to app/t3code/apps/web/src; edit nothing else except colocated tests that assert changed copy):
- components/ChatView.tsx
- components/Sidebar.tsx
- components/LegacySidebar.tsx
- components/ThreadStatusIndicators.tsx
- components/AgentsPanel.tsx
- components/CommandPalette.tsx
- components/CommandPaletteContent.tsx
- components/RightPanelTabs.tsx
- components/ConfirmDialogHost.tsx
- components/NoProjectsHero.tsx
- components/onboarding/FirstRunGate.tsx
- components/onboarding/WelcomeWizard.tsx
- components/chat/ChatComposer.tsx
- components/chat/CompactComposerControlsMenu.tsx
- components/chat/DraftHeroHeadline.tsx
- components/chat/runtimeModeConfig.ts

## Group-specific instructions

ChatView.tsx and ChatComposer.tsx are very large; search them for authored copy rather than reading them whole. Plan step 2 items in your scope: command-state idle wording, deletion host (the delete-thread confirmation, whose runner-pinned strings 삭제 / 스레드 삭제 / “03 Code blocks” 스레드를 삭제할까요? pattern must stay), both Sidebar implementations (Sidebar.tsx and LegacySidebar.tsx). Existing tests for these components must pass; update copy-equality assertions only.

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-shell.md.
