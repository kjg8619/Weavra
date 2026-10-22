# settingsTools 워커 보고서 (todo 22)

## 1. 먼저 결정이 필요한 사항

1. **ko.ts 키 충돌 (lead 결정 필요)**: `ko.ts`의 `settings`에는 이미 문자열 키 `appearance / keybindings / snapshots / diagnostics / licenses`가 있습니다. 그런데 이 블록 끝에 `...koSettingsTools.settings`가 펼쳐지면서, 같은 이름으로 배정된 제 객체 네임스페이스가 그 문자열 값을 덮어씁니다. 현재 저장소에서 `ko.settings.<이 키들>`를 문자열로 쓰는 곳은 없습니다(grep으로 확인). typecheck에도 ko.ts 오류는 나오지 않습니다. 기존 값을 잃지 않도록 각 네임스페이스에 `title` 키로 같은 문자열을 넣어 두었습니다(예: `ko.settings.appearance.title = "모양"`). 다른 워커가 내비게이션 라벨로 `ko.settings.appearance`를 문자열처럼 쓰려 하면 `.title`을 써야 합니다. 이름 체계를 바꿀지는 lead가 정해 주세요.
2. **남은 테스트 실패 1건 (다른 그룹 파일)**: `settingsSearch.test.ts:225`가 `searchSettings("copy link")`로 `thread.copyReference`를 찾는데, 이 명령의 라벨이 이제 "풀 리퀘스트: 링크 또는 대화 ID 복사"라서 실패합니다. `settingsSearch.ts`와 `settingsSearch.test.ts`는 다른 워커가 수정 중이라(git diff에 변경 있음) 손대지 않았습니다. 쿼리를 `"링크"` 등으로 바꾸면 통과합니다. 같은 테스트의 `"toggle sidebar"` 쿼리는 지금은 통과하지만, 검색 메타데이터가 라벨에만 의존하게 되면 같은 문제가 생길 수 있습니다.

## 2. 변경 파일 (S = app/t3code/apps/web/src)

- 할당 파일 12개를 수정했습니다: DiagnosticsSettings.tsx, ResourceTelemetryDiagnostics.tsx, OpenSourceLicenses.tsx, KeybindingsSettings.tsx, KeybindingsSettings.logic.ts, SnapShotSettings.tsx, SnapShotSettings.logic.ts, SnapShotSetupDialog.tsx, ThemeSettings.tsx, ThemePreviewCircles.tsx, SettingsFontPreviews.tsx, ThemeEditorPanel.tsx.
- `routes/settings.open-source-licenses.tsx`는 보이는 문구가 없어서 바꾸지 않았습니다.
- 카탈로그 `S/i18n/ko.settingsTools.ts`를 작성했습니다. `settings.` 아래에 네임스페이스 8개를 두었고, 항목 수는 대략 다음과 같습니다(정규식 집계라 근사치): diagnostics ≈100, telemetry ≈123, licenses 13, keybindings ≈92(명령 라벨 맵 포함), snapshots ≈136(setup 하위 포함), appearance ≈48, themeEditor ≈59(families 24 포함), fonts 1. 합계 약 570개 항목입니다. 마이그레이션된 영어 문구는 약 520개이고, 나머지는 위의 `title` 키 5개와 키 이름 정리분입니다.
- 공통 키는 같은 의미일 때 `ko.common.*`을 재사용했습니다: cancel, save, saving, retry, remove, close, back, done, off, enabled, disabled, copied.
- 런너 고정 문자열은 그대로 반영했습니다: 테마 만들기 / 테마 편집 / 앱 색상 검사 / 앱 색상 검사 취소 / 테마 편집기 닫기 / 라이트 모드 사용 / 다크 모드 사용 / 시스템 모양 따르기 / 색상 모드 선택 / 실행 조건식 / 제3자 라이선스 고지 / 라이트 / 다크 / 시스템 / 취소.
- 린트 오탐 대응: 카탈로그 함수 이름이 `use`로 시작하면 React 훅 규칙이 훅으로 오인해 경고를 냅니다. 그래서 키 이름에 `use` 접두사를 쓰지 않았습니다(예: `lightModeChoice`, `optionForMode`).

## 3. 의도적으로 번역하지 않은 문자열

- **식별자, 기계 값**:
  - KeybindingsSettings.logic.ts:18, 162, 174: `KeybindingSource` 값 "Default"/"Custom"/"Project"는 비교와 검색에 쓰이는 값입니다. 화면 배지는 KeybindingsSettings.tsx:1051에서 "사용자 지정"/"프로젝트"로 매핑했습니다.
  - KeybindingsSettings.logic.ts:36-41: when 변수 ID입니다.
  - ThemeEditorPanel.tsx:89-231: 색상 role ID입니다.
  - ThemePreviewCircles.tsx:21-24: 색상 키입니다.
  - 그 밖에 이벤트 키 "Escape"/"Tab"(OpenSourceLicenses.tsx:163, KeybindingsSettings.tsx:163/825/827/1192/1194, ThemeSettings.tsx:180, ThemeEditorPanel.tsx:714, SnapShotSettings.tsx:541, SettingsFontPreviews.tsx:244), `_tag` 값 "Success"/"Failure", 신호 이름 "SIGKILL", "INPUT"/"TEXTAREA", SVG 속성, import 경로가 있습니다.
- **키캡**: KeybindingsSettings.tsx:93, 99의 "Ctrl", "Alt"입니다.
- **허용된 고유명사**: ThemePreviewCircles.tsx:62의 "Weavra" 카드 라벨, "Weavra SnapShots", "GNOME"(snapshots 문구)입니다.
- **허용 목록에 없는 약어와 고유명사 (lead 판단 필요)**: CPU, GPU, PID, I/O, SIGKILL, macOS, Niri, GNOME, Hyprland(desktop 이름은 `captureSetupDesktopName`이 넘겨주는 데이터), "T3 Server"/"T3"(2글자)는 그대로 두었습니다. CPU→중앙처리장치처럼 바꾸는 것은 부자연스럽다고 판단했습니다.
- **fixture, 샘플 데이터**: SettingsFontPreviews.tsx:25-27은 프롬프트 미리보기 텍스트로, 사용자가 편집할 수 있는 샘플입니다. 59-65는 diff 샘플, 151-166은 터미널 출력 샘플입니다.
- **원문 데이터**: 서버와 브리지가 보낸 메시지(state.message, shortcutMessage, error.message, health.lastError), process command, span 이름과 원인, 로그 레벨, 라이선스 이름·버전·라이선스 ID·고지 본문, `thermalState` 값(nominal/serious 등)과 `SourceStatusBadge`의 상태 값(healthy/degraded 등)은 그대로입니다. 마지막 둘은 raw enum이고 weavraLabels.ts 소관이라 새 매핑을 만들지 않았습니다.
- **기존 한국어**: KeybindingsSettings.tsx에 이미 있던 한국어 문구(조건 원문, 고급 조건, 원문:, 닫기, 안내 문장)는 바꾸지 않았습니다.

## 4. 판단이 갈릴 수 있는 번역

- **기존 enum→영어 맵의 값만 번역**: ResourceTelemetryDiagnostics.tsx의 `categoryLabel()`과 `ioSemanticsLabel()`은 원래 이 파일에 있던 enum→영어 맵입니다. 새 맵을 만들지 않고 값만 카탈로그로 바꿨습니다. weavraLabels.ts로 옮길지는 lead가 정해 주세요.
- **Electron**: Electron main/utility/process를 "데스크톱 메인", "데스크톱 유틸리티", "데스크톱 메인 프로세스"로 옮겼습니다. Electron이 허용 목록에 없기 때문입니다.
- **명령 라벨**:
  - `commandLabel()`은 정적 명령 38개를 카탈로그 맵(`ko.settings.keybindings.commands`)으로 옮겼습니다. `thread.jump.N`/`modelPicker.jump.N`은 함수로 만들었습니다.
  - `script.<id>.run`은 "작업 실행: <Title Case id>"로 표시합니다. id에서 만든 이름은 식별자 파생값이라 그대로 둡니다.
  - 맵에 없는 미래 명령은 기존 title-case 영어로 표시됩니다.
  - "thread.settle"은 "대화: 완료로 정리", "thread.steerQueuedMessage"는 "대화: 대기 중인 메시지 바로 반영"으로 옮겼는데 의미 확인이 필요합니다.
- **키보드 단축키 검색**: 사용자가 보는 배지는 한국어인데, 검색(`buildKeybindingRows`)은 여전히 영어 source 값("custom" 등)으로만 일치합니다. 동작 변경 금지 규칙 때문에 그대로 두었습니다.
- **SnapShot 소리 이름**: Whoosh는 "휙", Click은 "찰칵"으로 옮겼습니다.
- **macOS 권한 이름**: "화면 기록", "손쉬운 사용"(macOS 한국어 표기)으로 옮겼습니다.
- **SnapShotSetupDialog의 "Take snapshot"**: 명령 팔레트 항목 이름을 ‘스냅샷 찍기’로 가정했습니다. 다른 그룹이 다르게 옮겼다면 맞춰야 합니다.
- **상대 시간 표시**: "Checked 5m ago"는 "마지막 확인 5m ago", "Updated"는 "업데이트 …"로 바꿨습니다. 뒤의 "5m ago"/"just now"는 timestampFormat.ts(미소유)가 만드는 영어입니다.
- **키보드 단축키 개수**: "N bindings"는 "단축키 N개"로 옮겼습니다.
- **테마 사본 이름**: "<label> copy" 기본 이름은 "<label> 사본"으로 옮겼습니다. 사용자 데이터의 초기값이 됩니다.
- **레이아웃**: 폭 문제는 보이지 않았습니다. `w-36`/`w-44` 검색 입력, `w-24` and/or 선택, `min-w-10` "부정" 토글, `truncate`가 걸린 "테마 편집" 제목 모두 한국어 라벨이 더 짧거나 비슷합니다.

## 5. 수정한 테스트 (문구 단언만 바꿈, 삭제·skip·완화 없음)

- **KeybindingsSettings.logic.test.ts**:
  - whenSyntaxError, removeLabel 3종: 카탈로그 값을 참조하도록 바꿨습니다.
  - commandLabel 단언: "명령 팔레트: 전환" / "테마 편집기: 전환" / "작업 실행: Setup Db"로 바꿨습니다.
  - 충돌 라벨: "대화: 새 로컬 대화"로 바꿨습니다.
  - copy-link 검색 쿼리: ["풀", "풀 리퀘스트", "링크", "대화 id"]로 바꿨습니다.
- **SnapShotSettings.logic.test.ts**: 상태 문구 단언을 모두 카탈로그 참조로 바꿨습니다. 기존 `toContain`(부분 문구)은 해당 카탈로그 값과 `toBe`로 비교하도록 바꿨습니다. 같은 문구를 확인하되 더 엄격합니다. 원문 데이터 단언("Wayland is required.", "Permission wasn't granted")은 그대로입니다.
- **SnapShotSettings.test.tsx**: 버튼과 aria 라벨(저장, 스냅샷 사용, 캡처 관리, 단축키 권한, 단축키 변경, 캡처한 창 깜박이기)과 토스트 제목 2개를 카탈로그 참조로 바꿨습니다.
- **ThemeSelection.test.tsx**: 모드 버튼, 변형 버튼, 그룹 aria 라벨을 카탈로그 참조로 바꿨습니다. `modeLabel` 헬퍼를 추가했습니다.

## 6. 실행한 명령과 결과 (app/t3code에서)

- `pnpm exec vp fmt <변경 파일 17개>` → exit 0. 이어서 `vp fmt --check` → "All matched files use the correct format", exit 0.
- `pnpm exec vp lint <변경 파일 17개>` → exit 0, 경고 13개. `git diff -U0`의 변경 줄과 대조해 보니 **변경한 줄에 걸린 경고는 0개**입니다. 남은 경고(set-state-in-effect, exhaustive deps 등)는 손대지 않은 줄에 원래 있던 것입니다.
- `pnpm --filter @t3tools/web typecheck` → exit 1. 전체 오류 306개는 모두 다른 그룹 파일(FileBrowserPanel, projectScriptEditor, ProjectScriptsControl, Preview*, device/* 등)에 있습니다. 제 파일, 카탈로그, ko.ts의 오류는 0개입니다(grep 확인).
- `apps/web`에서 `pnpm exec vp test run --project unit`을 다음 11개 파일에 실행했습니다: KeybindingsSettings.logic, SnapShotSettings.logic, SnapShotSettings, SnapShotSetupDialog.logic, themeEditorStore, ThemeSelection, ThemeEditorHost, ResourceTelemetryDiagnostics.logic, useSnapShotShortcutRecorder, CaptureShortcutConfig, settingsSearch.
  - 결과: 208개 중 207개 통과, 1개 실패, exit 1.
  - 실패 1건은 `settingsSearch.test.ts`의 "finds keybinding commands by label…"입니다(1.2절 참조). 다른 그룹 파일이라 제가 고치지 않았습니다.

## 7. 다른 그룹 소유 헬퍼의 영어 문구 (수정하지 않음)

- S/components/settings/ThemeImportDialog.tsx: 47, 125, 144, 201, 343, 409, 414, 428, 474, 494, 501, 504, 526, 528, 545
- S/components/settings/CaptureShortcutConfig.tsx: 33, 34, 125, 126, 145, 151, 157, 159, 160, 167, 168, 171, 176, 190, 207, 208, 228, 245, 246, 250, 254, 259, 265, 277, 285, 294, 302, 305, 308, 309, 310, 323
- S/components/settings/useSnapShotShortcutRecorder.tsx: 74, 99, 128, 129, 139, 141, 143. "Record snapshot shortcut, currently …", "Press shortcut…"가 여기 있고 SnapShotSettings.test.tsx가 이 문구를 단언합니다.
- S/components/settings/SnapShotSetupDialog.logic.ts: 61, 62, 64, 66, 67. `captureSetupCheckMessage`가 SnapShot 설정 대화 상자에 표시됩니다.
- S/components/settings/ProcessSignalActions.tsx: 21, 29, 36, 44. Diagnostics와 Telemetry의 종료 버튼입니다.
- S/components/settings/ExpandableText.tsx: 14, 43
- S/components/settings/ThemeColorPicker.tsx: `getThemeRoleLabel`이 테마 편집기의 역할 이름과 사용 횟수 줄에 영어로 표시됩니다.
- S/timestampFormat.ts: "just now", "ago", "yesterday at"이 Diagnostics와 Telemetry의 상대 시간에 표시됩니다.
- 그룹 지시에 적힌 colorPickers는 `colorPickers.test.tsx`만 있고 같은 이름의 소스 파일은 없습니다.

## 8. 손대지 않은 것

git commit, stash, checkout, reset은 하지 않았습니다. 앱 빌드와 실행도 하지 않았습니다. 다른 워커 파일, ko.ts, settingsSearch.*는 수정하지 않았습니다.
