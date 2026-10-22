# Group inlineShell (round 3): move the remaining inline Korean copy into the catalog

Read and follow /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/shared-brief.md first,
and the round-2 rules in group-transferA.md ("Additional rules for this round" section only).

Round 1 translated the English. These files still hold authored copy as inline Korean string literals
and JSX text (from earlier todos). Plan todo 22 step 1 requires all authored copy to live in the typed
catalog. Move every inline authored Korean string in your files into `app/t3code/apps/web/src/i18n/ko.shell.ts`
(you own that file this round), under the existing sub-namespaces (chat.view, chat.composer,
chat.composerMenu, chat.draftHero, chat.runtimeMode, projects.sidebar, projects.legacySidebar,
projects.commandPalette, projects.threadStatus, projects.rightPanel, projects.hero, devices.agentsPanel,
onboarding.wizard) or new sub-namespaces you add inside ko.shell.ts.

Values stay byte-identical unless they break the glossary or the Latin rule. This is a move, not a rewrite,
so every runner-pinned string keeps exactly the same text. Dynamic copy becomes parameter functions.
Do not move: comments, test IDs, data-* values, machine values, or seeded fixture text.

Your files (relative to app/t3code/apps/web/src):
- components/ChatView.tsx
- components/chat/ChatComposer.tsx
- components/chat/CompactComposerControlsMenu.tsx
- components/chat/runtimeModeConfig.ts
- components/chat/DraftHeroHeadline.tsx
- components/AgentsPanel.tsx
- components/ThreadStatusIndicators.tsx
- components/NoProjectsHero.tsx
- components/CommandPaletteContent.tsx
- components/CommandPalette.tsx
- components/RightPanelTabs.tsx
- components/onboarding/WelcomeWizard.tsx
- components/LegacySidebar.tsx
- components/Sidebar.tsx

Verification is the same as in shared-brief.md. All colocated tests for these files must pass unchanged
in meaning (many already reference catalog values). Report the number of strings moved per file, and
list any you left inline with the reason.

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-inlineShell.md.
