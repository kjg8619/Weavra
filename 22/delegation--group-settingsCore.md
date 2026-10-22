# Group settingsCore

Read and follow /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/shared-brief.md first.

Your catalog file: app/t3code/apps/web/src/i18n/ko.settingsCore.ts (export koSettingsCore).
Your sub-namespaces: settings.{breadcrumb, scope, layout, general, notifications, archive, restore, search}

Your files (paths relative to app/t3code/apps/web/src; edit nothing else except colocated tests that assert changed copy):
- components/settings/SettingsPanels.tsx
- components/settings/SettingsSidebarNav.tsx
- components/settings/SettingsBreadcrumb.tsx
- components/settings/SettingsScopeNotice.tsx
- components/settings/SettingsScopeContext.tsx
- components/settings/SettingsGroup.tsx
- components/settings/settingsLayout.tsx
- components/settings/settingsScopeAxis.ts
- components/settings/settingsSearch.ts
- components/settings/NotificationSettings.tsx
- threadNotifications.ts
- routes/settings.tsx
- routes/settings.general.tsx
- routes/settings.archived.tsx

## Group-specific instructions

settingsSearch.ts is the source of the visible row titles: rows render their title via searchableSetting(id), so translate every SETTINGS_SEARCH_ITEMS title (and SETTINGS_SECTION_LABELS: these are the settings nav and breadcrumb labels) for ALL settings pages, not only yours. For searchTerms: write Korean terms people would type AND keep the existing English terms in the same array, so both Korean and English queries still find each destination (machine-consumed; do not drop any English term). The keybinding search items take their titles from commandLabel() in KeybindingsSettings.logic.ts, which another group owns; do not edit that file. Ids, to, targetId, scope and flags never change. Existing tests settingsSearch.test.ts, SettingsPanels.logic.test.ts, settingsScopeAxis.test.ts etc. must pass; update only copy-equality assertions. SettingsPanels.logic.ts is NOT yours (not in the plan list): if it holds visible copy (e.g. restore-dialog labels at :160), list it with file:line in your report instead of editing.

Write your final report also to /Users/kangjingoo/.omo/evidence/hig-ulw-20261018/waves/exec-weavra/pr-22/delegation/report-settingsCore.md.
