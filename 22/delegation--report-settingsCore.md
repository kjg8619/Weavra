# settingsCore worker report (todo 22)

Worktree: /Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22. No git state touched, no app build or launch.

## Status

My copy migration is complete. Format and lint pass. Typecheck shows no errors in my files.

The real colocated test run is still red. That is caused by another group's in-progress `KeybindingsSettings.logic.ts`, not by my changes (details under Verification). My changed behavior passed 65/65 in an isolated run.

**Action for parent (my deviation from the brief):** I renamed my namespace from `settings.general` to `settings.generalPanel`. With the assigned name, `ko.ts` failed typecheck with TS2783 ("'general' is specified more than once"), because `ko.ts` already has `settings.general: "일반"` before the `...koSettingsCore.settings` spread. I cannot edit `ko.ts`. The other sub-namespaces are as assigned.

## Files changed (paths relative to app/t3code/apps/web/src)

- i18n/ko.settingsCore.ts: the catalog.
- components/settings/settingsSearch.ts
- components/settings/SettingsPanels.tsx
- components/settings/SettingsSidebarNav.tsx
- components/settings/SettingsBreadcrumb.tsx
- components/settings/SettingsScopeNotice.tsx
- components/settings/settingsLayout.tsx
- components/settings/NotificationSettings.tsx
- threadNotifications.ts
- routes/settings.tsx
- components/settings/settingsSearch.test.ts: copy assertions only.

These were checked and needed no change, because they have no user-visible authored copy: SettingsScopeContext.tsx, SettingsGroup.tsx, settingsScopeAxis.ts, routes/settings.general.tsx, routes/settings.archived.tsx.

## Catalog sub-namespaces added under `settings`

`breadcrumb`, `scope`, `layout`, `generalPanel` (assigned as `general`, renamed as explained above), `notifications`, `archive`, `restore`, `search`.

`search` contains:
- the UI strings;
- `sections`: the nav and breadcrumb labels, all exactly as pinned (프로젝트, 일반, 모양, 키보드 단축키, 스냅샷, 공급자, 연동, 소스 제어, 저장 공간, 연결, 보관함);
- `items`: 95 entries, one per `SETTINGS_SEARCH_ITEMS` row on every settings page, each with a Korean `title` and Korean `terms`.

## Count

- 358 catalog leaf entries (strings and functions).
- 95 search items, each with a title and Korean terms.
- About 300 authored English strings were replaced in my files. Existing Korean strings in ArchivedThreadsPanel moved into the catalog.

## How search works now (machine-consumed, no id/to/targetId/scope/flag changes)

- Each item's `title` is now Korean, from the catalog. The original English title stays in a new optional field, `englishTitle`, added to the `SettingsSearchItem` interface.
- `searchTerms` = [Korean terms, ...all existing English terms unchanged]. The Korean terms contain no Latin letters, so they cannot change English query results.
- `searchSettings` matches and ranks against both the Korean title and `englishTitle`, and takes the better rank of the two. It also matches the former English section names through a private `SETTINGS_SECTION_SEARCH_ALIASES` record.
- Result: every existing English query in the tests ranks exactly as before, including "GIT", "connections", "remote pairing" and "model". Korean queries find the same destinations.

## Pinned strings shipped

- 기기 기본값 복원 (routes/settings.tsx)
- 대화 알림, 알림만, 앱 내 알림, 링크 열기 위치, 레거시 기능, 레거시 사이드바, 색상 모드
- 오픈 소스 라이선스, 진단 보기, 라이선스 보기, 진단
- 보관 해제, 작업 (Actions)
- 취소, and the existing pinned 스레드 삭제 (confirmLabel)
- 설정 / 일반 / 모양 / 키보드 단축키 / 스냅샷 / 공급자 / 연동 / 소스 제어 / 저장 공간 / 연결 / 보관함 (nav and breadcrumb)

## Intentionally left untranslated

| file:line | text | class |
|---|---|---|
| components/settings/SettingsScopeContext.tsx:63 | `Settings scope must be read inside SettingsScopeProvider.` | not user-visible (developer invariant error) |
| threadNotifications.ts:40 | `"Segoe UI", sans-serif` | identifier (font stack) |
| SettingsPanels.tsx:1907 | `Enter` (send shortcut option) | keycap |
| SettingsPanels.tsx, behavior follow-up text | `⌘`/`Ctrl` + `Shift` + `Enter` inside Korean sentences | keycaps |
| SettingsPanels.tsx:1202, 1741, 1747 | `ms`, `px` units | unit / not a word |
| SettingsPanels.tsx:2768 | `~/` placeholder | path |
| ko.settingsCore.ts `generalPanel.legacy.planModeDescription` | `/plan`, `/default`, `Shift+Tab` | commands and keycaps |
| search item titles | `Tailscale HTTPS`, `WSL 백엔드`, `Git 가져오기 간격`, `GitHub 공유` | allowed proper names |
| search item title | `T3 Connect` (settingsSearch.ts:995) | product proper name; not on the allowlist, kept as a name. Parent to decide. |
| ko.settingsCore.ts `notifications.*`, `about.*`, `diagnostics.*`, `behavior.providerUpdateDescription` | `Weavra`, `HTTPS`, `CLI`, `Git`, `OS` | allowed proper names; `OS` is 2 letters |
| settingsSearch.ts `englishTitle` values, English `searchTerms`, `SETTINGS_SECTION_SEARCH_ALIASES` | English | machine-consumed search data, not displayed |

## Visible copy outside my files (not edited, by instruction)

- components/settings/SettingsPanels.logic.ts:95, 99, 103, 107 ("Interface font", "Prompt font", "Code font", "Terminal font"), 149, 151, 154, 157, 160, 164 ("Browser viewport" … "Floating preview"), and 231 ("Local trace file" / "Terminal logs only").
  - The restore-defaults confirmation joins these English labels with my Korean ones in one list, so it shows mixed languages until that file migrates. Its test, SettingsPanels.logic.test.ts, still asserts the English values and passes.
- components/CommandPalette.tsx:2093 builds its search terms from `item.title` and `item.searchTerms`. English *title* words are now only in `item.englishTitle`, so they are no longer palette-searchable unless the palette adds `item.englishTitle` to its terms. English search terms still work there.
- KeybindingsSettings.logic.ts `commandLabel()` (owned by the keybindings group) supplies the keybinding search titles. If it returns Korean, the English-label test "toggle sidebar" in settingsSearch.test.ts needs an `englishTitle`-style alias from that group's side. The command-id and default-key queries are unaffected.
- hooks/useSettings `PRIMARY_SETTINGS_UNAVAILABLE_MESSAGE`, shown by settingsLayout as a tooltip, is still owned elsewhere.
- Other groups' files still pass English `label="..."` values to `SettingResetButton`. They now render as e.g. `network access 기본값으로 재설정` until each group translates its labels.

## Tests updated

components/settings/settingsSearch.test.ts:
- The `title` values in the "WSL backend" `toMatchObject`, the `searchableSetting("word-wrap")` and `("archive")` `toEqual` checks, and the time-format `getSettingsSearchTargetScope` check now reference the catalog values. The semantic checks are unchanged.
- No assertion was deleted, skipped or loosened. No new prose tests.

## Verification (run from app/t3code)

1. `pnpm exec vp fmt <11 files>` exit 0. `pnpm exec vp fmt --check <11 files>`: "All matched files use the correct format", exit 0.
2. `pnpm exec vp lint <11 files>` exit 0 with 9 warnings, none on a line I changed (checked against the `git diff -U0` hunks).
   - SettingsSidebarNav.tsx:126; SettingsPanels.tsx:344, 602, 1612, 1615, 1617, 1675, 1781 (two warnings): all pre-existing hooks, refs and memo rules.
   - My first run had 2 extra warnings that I caused: catalog keys named `useTokens`/`useParagraphs` were read as hooks. I renamed them to `chooseTokens`/`chooseParagraphs`.
3. `pnpm --filter @t3tools/web typecheck` exits 1, but no errors are in my files.
   - The only ko.ts errors are TS2783 at ko.ts:121–123 (`integrations`, `sourceControl`, `storage` specified more than once). Those come from other groups' catalogs colliding with the same pre-seeded string keys in ko.ts, the same problem I hit with `general`. The parent needs to resolve them in ko.ts.
   - The other ~690 errors are in files owned by other groups that are mid-edit.
4. `pnpm exec vp test run --project unit` on settingsSearch, SettingsPanels.logic, settingsScopeAxis, settingsLayout, ArchivedThreadsPanel, settingsScope and settingsScopeNavigation tests: 5 files pass; 2 fail with exit 1.
   - The failing files are settingsSearch.test.ts and ArchivedThreadsPanel.test.tsx. Both fail at import time with `TypeError: Cannot convert undefined or null to object` at KeybindingsSettings.logic.ts:339.
   - Cause: the keybindings group's `commandLabel` reads `ko.settings.keybindings.commands`, which their catalog does not define yet. That is another group's file.
   - Isolation check: I ran the same two test files through a throwaway wrapper that mocked `./KeybindingsSettings.logic` with its HEAD version. Result: 2 files, 65/65 tests passed, exit 0. The scratch files were deleted afterwards (verified: 0 left).
5. Re-scan for remaining English in my files: only the items listed in the "Intentionally left untranslated" table.

## Fit concerns, questions, uncertain strings

- No fixed-width fit problems. The longest labels in fixed-width controls are "알림과 소리" (`sm:w-56`), "고급 (환경 하나)" (`sm:w-40`) and the 기본 브라우저 … titles (which truncate in the sidebar results, as before).
- I translated "settle"/"auto-settle" as 정리/자동 정리. Please confirm against the sidebar group's term for settled threads.
- I titled "Start from origin" as 원격 브랜치에서 시작, avoiding the Latin `origin`.
- The archive delete dialog now says 대화 (glossary) in its title and message, while the pinned confirm button stays 스레드 삭제. Please confirm that mix is acceptable.
- I deliberately kept `T3 Connect` as a proper name. It is not on the Latin allowlist.
