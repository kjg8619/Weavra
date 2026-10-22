# Report: worker "workspace" (todo 22, Korean authored-copy migration)

Worktree: /Users/kangjingoo/Workspace/tool/Weavra-worktrees/hig-22. Paths below are relative to `app/t3code/apps/web/src`. I made no commits, did not touch git state, and did not build or launch the app.

## Files changed

Source (21 of the 22 listed files):
projectScriptEditor.tsx, ProjectScriptsControl.tsx, files/FileBrowserPanel.tsx, preview/PreviewPanel.tsx, preview/PreviewChromeRow.tsx, preview/PreviewEmptyState.tsx, device/DeviceSetup.tsx, device/DevicePanel.tsx, device/DeviceToolsPanel.tsx, device/DeviceHostAvailability.tsx, device/DeviceLoadingView.tsx, settings/ProjectSettingsPanel.tsx, settings/ProjectActionsSettings.tsx, settings/ProjectActionsList.tsx, settings/WeavraControls.tsx, settings/WeavraSettings.tsx, settings/WeavraFitness.tsx, settings/CapabilityInventory.tsx, ui/wizard.tsx, ui/toast.tsx, components/weavraLabels.ts.

- `preview/PreviewPanelShell.tsx` has no authored copy, so it is unchanged.
- Catalog: `i18n/ko.workspace.ts` (`koWorkspace`).
- Tests: `projectScriptEditor.test.tsx`, `preview/PreviewEmptyState.test.tsx`, `settings/WeavraControls.test.tsx`.

## Catalog sub-namespaces added

- `common.toast`, `common.wizard`
- `devices.setup`, `devices.panel`, `devices.tools`, `devices.host`, `devices.loading`, `devices.preview`
- `projects.scriptEditor`, `projects.scriptsControl`, `projects.files`, `projects.settings`, `projects.actions`
- `runtime.controls`, `runtime.capabilities`, `runtime.labels`
  - `runtime.labels` contains `values`, the enum map moved out of weavraLabels with 132 entries, plus `yes` and `no`.
- I did not need `runtime.overview` or `runtime.fitness`. The text in WeavraSettings and WeavraFitness was already Korean, so it stays inline (see "Glossary fixes" below).

## Count

- 303 catalog keys, not counting the 132 enum labels. About 290 of them are English strings migrated to Korean. The rest are existing Korean copy that moved into the catalog: CapabilityInventory's 17 strings, and the weavraLabels map.
- I also reused these `ko.common` entries: cancel, close, back, done, saving, delete, remove, reset, refresh, loading, unknown, none, default, open, project.

## weavraLabels.ts

- The map now lives in `ko.runtime.labels.values`.
- `weavraLabel()` keeps the same export and signature, and the same behavior:
  - null or undefined returns `ko.common.unknown` (still "확인 안 됨").
  - booleans return 예 / 아니요.
  - an unknown value returns `String(value)` unchanged, so the raw value stays copyable.
- One value changed: `HOST_OBSERVATION` "Host 관찰" became "호스트 관찰", to follow the glossary (Host -> 호스트). No test asserts it.

## Runner-pinned strings shipped

- Add Action / Edit Action -> 작업 추가 / 작업 편집. This covers the editor dialog title and the "Add action" button in ProjectActionsSettings.
- Set up devices -> 기기 설정하기
- No preview yet -> 아직 미리보기가 없어요
- Dismiss notification -> 알림 닫기 (both toast variants)
- Refresh workspace files -> 작업 공간 파일 새로 고침
- `${projectName} files` -> `${projectName} 파일`
- `Run ${name}` -> `${name} 실행` (ProjectScriptsControl aria-label and tooltip)
- Cancel -> 취소
- The existing literal "작업 추가" in ProjectScriptsControl (chat-header button) and "프로젝트 작업" are untouched.

## Glossary fixes inside existing Korean copy (WeavraControls, WeavraSettings, WeavraFitness, CapabilityInventory)

- Latin words replaced with Korean:
  - checkout -> 체크아웃
  - revision -> 리비전
  - digest -> 다이제스트
  - worker -> 워커
  - bridge -> 브리지
  - endpoint -> 엔드포인트
  - backend -> 백엔드
  - Policy -> 정책
  - sandbox -> 샌드박스
  - 프로바이더 -> 공급자 (glossary)
  - bytes -> 바이트
  - "Weavra RPC를" -> "Weavra 요청을"
  - "PASS나 수용 판정" -> "통과나 수용 판정" (WeavraSettings)
- English labels translated:
  - WeavraControls dl labels: Check -> 검사, Expectation -> 예상 결과, Workflow -> 워크플로, Risk -> 위험도, Recipe -> 실행 절차, Configuration -> 설정, Origin -> 출처, Candidate -> 후보.
  - The Planner section aria-label became 계획 담당.
- Fallbacks now go through the catalog:
  - Displayed "UNKNOWN" fallbacks in WeavraControls, WeavraSettings and WeavraFitness now use `ko.common.unknown`.
  - "none" in WeavraFitness now uses `ko.common.none`.
- WeavraControls displayed the scope-kind `<option>` labels modify / create / delete raw. They now go through `weavraLabel()` (수정 / 생성 / 삭제). The option `value`s are unchanged.

## Strings intentionally left untranslated

- **Allowed proper names**:
  - Weavra, Runtime, Kernel, Git, JSON, URL.
  - The pinned exceptions "Runtime 실행 제어" and "Runtime 계획 미리보기".
- **Platform and Apple/Google product names (not on the allowlist; the parent should decide)**:
  - iOS and Android: DeviceSetup.tsx:15 and :224; DeviceHostAvailability.tsx:20 and :25; inside devices.setup / panel strings.
  - Xcode, "Android SDK", "Android Studio", and the menu paths "Xcode Settings → Components" and "Device Manager" inside devices.setup / panel. These menu paths are the tools' literal English UI. Also, IntegrationsSettings.test.tsx (another group's test) asserts "Xcode Settings" and "Device Manager".
  - "Face ID" (DeviceToolsPanel.tsx:77), "Liquid Glass" (DeviceToolsPanel.tsx:267 and :269), "VoiceOver" (DeviceToolsPanel.tsx:334).
- **Identifiers, commands, paths, URLs and placeholders that are code**:
  - Placeholders: `bun test` and `http://localhost:5173` (projectScriptEditor.tsx:416 and :447); `src/exact-file.ts`, `src/project-notes.txt` and `status-ready` (WeavraControls.tsx:1414, :1756 and :1957).
  - The `Backspace` keycap (projectScriptEditor.tsx:398) and Esc / Shift in the preview tooltips.
  - t3.json, `myapp://`, localhost.
  - weavra setup / weavra doctor and T3_WEAVRA_EXECUTABLE (WeavraSettings).
  - glob and CDP-pipe (WeavraControls).
  - "LSP" (CapabilityInventory), "Unix ms" (unit), and "HTTP" (WeavraFitness:420).
- **Wire enum names cited in prose**: COMPLEX, STANDARD, QUICK, PASS, COMPLETE, VALID, CANDIDATE_ONLY, SELF_CHECK, TEST (WeavraControls).
- **Data**: user script names and commands, fixture and target IDs, raw `failureCode` / `errorCode`, and the metric group and key names rendered raw in the WeavraFitness comparison table (`{group} / {key}`, around line 400). I made no local enum map for those.
- **Not changed, open question**: "Run" (about 28 times, for example "공식 Run:", "Run 완료", "Weavra Run") and "Planner" (about 9 times, for example "Planner 제안", "Planner 실행 중") are already in Korean copy in WeavraControls and WeavraSettings. I treated them as Weavra domain nouns, not the generic verb "Run". Many WeavraControls.test.tsx assertions pin them, and WeavraComplex.tsx (not my file) uses the same wording, for example "worker 호출". If the parent wants them as 실행 / 계획 담당, the change has to be coordinated across WeavraComplex.tsx and the tests.

## Tests updated

- `projectScriptEditor.test.tsx`: the 3 lookups for a "Cancel" button now use `ko.common.cancel`. The import of `ko` was added.
- `preview/PreviewEmptyState.test.tsx`: "Recently used", "Local servers" and "No preview yet" now use `ko.devices.preview.recentlyUsed`, `.localServers` and `.emptyTitle`. Each assertion keeps the same toContain / not.toContain meaning.
- `settings/WeavraControls.test.tsx`: the 2 calls `control(render(), "Planner")` now pass `ko.runtime.controls.planner`.

## Commands run (from app/t3code, with Node 24 on PATH)

1. `pnpm exec vp fmt <25 files>` exited 0, and `pnpm exec vp fmt --check <25 files>` exited 0 ("All matched files use the correct format").
2. `pnpm exec vp lint <25 files>` exited 0 with 5 warnings. All 5 are on lines I did not change:
   - projectScriptEditor.tsx:196 set-state-in-effect
   - ProjectSettingsPanel.tsx:292 memo-dependencies
   - DeviceToolsPanel.tsx:164 memo-dependencies
   - FileBrowserPanel.tsx:294 and :296 preserve-manual-memoization / refs
   I checked them against the `git diff -U0` hunks.
3. `pnpm --filter @t3tools/web typecheck` exited 0 with 0 `error TS` lines, both overall and in my files.
4. From apps/web: `pnpm exec vp test run --project unit` on 13 files passed 13/13 files and 133/133 tests. The files:
   - projectScriptEditor, PreviewEmptyState, PreviewPanelShell, FileBrowserPanel
   - CapabilityInventory, WeavraControls, WeavraFitness, WeavraSettings
   - ProjectSettingsPanel.logic, toast.logic, toastHelpers
   - IntegrationsSettings (it imports `platformSetupStatus`), DeviceStreamView

   The first run failed 2 WeavraControls tests ("Missing control: Planner"), caused by my aria-label change. After the test update, everything passes.
5. I re-scanned all my files for English copy. The remainders are only the classes listed above.

## Fit, behavior and other notes

- No layout, class, behavior, value or wire changes.
  - The wizard step aria-label is now built by `ko.common.wizard.stepLabel(step, n, summary)`, which keeps the same parts: step name, step number and summary.
  - LOCATION_PRESETS city labels are now Korean. The component also uses the label as the internal Select value; it is used consistently inside DeviceToolsPanel and is not stored or sent.
- `deviceHubDescription` and `agentDeviceDescription` are still exported from DeviceSetup and now come from the catalog. IntegrationsSettings (another group) consumes them unchanged.
- I saw no fixed-width truncation risk. The DeviceToolsPanel SelectTriggers are `w-40` / `w-32`, and the Korean labels are shorter than the English ones.
