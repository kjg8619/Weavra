# HIG 22 rules a-j self-measurement

Packaged head `b95bacbb200e3e3925dec26766a1e5b0da7dee3a` (app.asar `2d76c80895ccef42b1961afdd61b853ceb3235ad2cc9c0cdae3be9298fe70919`) against the unchanged parent
`245a9efdfee4e949a5d312798bcdbf31ed0c1675` (app.asar `51e20917fe73274b483bb1d89766b18845706fac13e8408b454224cf78481a31`), both measured by `tools/measure-22.mjs` in
all-text mode over: every settings page in light/dark at 840, 1280 and 1920 px and 100%/150% text, scrolled through
every section; 200% zoom; +40% copy at 150% text; all right-panel surfaces, the add-action, add-provider and
custom-model dialogs, both sidebars and the thread fixtures. A head failure is *introduced* unless the parent fails the
same check on the same surface, element path and configuration with an equal or worse value; target-size rows are
compared by count per surface and configuration because their key is the control's (now Korean) name.

| Rule | Check | Head checks | Head failures | Introduced | Pre-existing (parent fails the same) | Parent failures | Gate |
|---|---|---|---|---|---|---|---|
| a | Target size: icon controls >= 36 px, text buttons >= 32 px high | 52011 | 12184 | 345 | 11839 | 12129 | recorded (copy-only geometry) |
| b | Explanatory text >= 14 px | 1698 | 1 | 0 | 1 | 609 | gated |
| c | Text contrast >= 4.5:1 (inactive controls recorded under WCAG 1.4.3) | 65139 | 2325 | 0 | 2325 | 12286 | gated |
| d | Korean keep-all: no mid-word break, no orphan syllable | 103208 | 0 | 0 | 0 | 324 | gated |
| e | Escape returns focus to the opener | 37 | 24 | 0 | 24 | 24 | gated |
| f | No page-level horizontal overflow | 2285 | 0 | 0 | 0 | 0 | gated |
| i | Not clipped, ellipsized or line-clamped (identity names with full-value tooltip excepted) | 65139 | 1496 | 0 | 1496 | 3307 | gated |
| j | Painted text boxes do not overlap text or icons on the same layer | 2325 | 50 | 0 | 50 | 50 | gated |
| ax | No unclassified English authored text in visible text, AX names, placeholders or titles | every visible text, AX name, placeholder and title (only failures are stored) | 0 | 0 | 0 | 55108 | gated |

Rule `ax` is evaluated on head only: the parent is English by design, so every parent row fails it.

## Pre-existing failures by source (not introduced by this change)

| Rule | Check | Element (innermost) | Rows |
|---|---|---|---|
| a | text-button-32 |  | 7940 |
| a | icon-control-36 |  | 3899 |
| c | text-contrast | span<span | 1215 |
| i | not-clipped-or-ellipsized | div<div | 841 |
| c | text-contrast | text<svg | 482 |
| i | not-clipped-or-ellipsized | span<div | 373 |
| c | text-contrast | span<button[sidebar-menu-button] | 327 |
| i | not-clipped-or-ellipsized | span[tooltip-trigger]<div | 236 |
| c | text-contrast | span<button | 104 |
| c | text-contrast | button[toggle]<div[toggle-group] | 77 |
| c | text-contrast | span<div | 63 |
| j | text-box-overlap | text-icon | 40 |
| c | text-contrast | span[tooltip-trigger]<div | 30 |
| e | escape-returns-focus-to-opener |  | 24 |
| i | not-clipped-or-ellipsized | span<button[tooltip-trigger] | 24 |
| c | text-contrast | span[badge]<div | 15 |
| i | not-clipped-or-ellipsized | span[tooltip-trigger]<td | 10 |
| j | text-box-overlap-total |  | 10 |
| c | text-contrast | span<button[command-dialog-trigger] | 6 |
| c | text-contrast | span<span[tooltip-trigger] | 6 |
| i | not-clipped-or-ellipsized | h2<button[tooltip-trigger] | 6 |
| i | not-clipped-or-ellipsized | span<span | 6 |
| b | explanatory-text-14px | p<div | 1 |

## Target-size rows above the parent count (recorded)

Copy-only work does not restyle controls; these are existing control heights whose rows exceed the parent's count in
the same surface and configuration because Korean labels wrap or measure differently.

| Surface | Control | Configuration | Height x width |
|---|---|---|---|
| settings-integrations | 호스트 추가 | light/100/840 | 28 x 100 |
| settings-diagnostics | 로그 폴더 열기 | light/100/840 | 24 x 24 |
| settings-diagnostics | 트레이스 진단 새로 고침 | light/100/840 | 24 x 24 |
| settings-general | 기본 제공 값. 이 값의 출처 보기 | light/100/1280 | 20 x 20 |
| settings-general | 라이선스 보기 | light/100/1280 | 28 x 96 |
| settings-providers | 환경 범위 | light/100/1280 | 20 x 52 |
| settings-providers | 프로젝트 범위 | light/100/1280 | 20 x 76 |
| settings-providers | 변수 추가 | light/100/1280 | 28 x 86 |
| settings-providers | 허브 추가 | light/100/1280 | 24 x 73 |
| settings-providers | 백그라운드 정책 자세히 | light/100/1280 | 20 x 20 |
| settings-providers | 공급자 상태 확인 간격 줄이기 | light/100/1280 | 26 x 34 |
| settings-providers | 공급자 상태 확인 간격 늘리기 | light/100/1280 | 26 x 34 |
| settings-diagnostics | 대화 목록으로 이동 | light/100/1280 | 28 x 67 |
| settings-diagnostics | 환경 범위 | light/100/1280 | 20 x 52 |
| settings-diagnostics | 프로젝트 범위 | light/100/1280 | 20 x 76 |
| settings-diagnostics | 트레이스 ID 복사 | light/100/1280 | 20 x 20 |
| dialog-add-provider | 환경 범위 | light/100/1280 | 20 x 52 |
| dialog-add-provider | 프로젝트 범위 | light/100/1280 | 20 x 76 |
| dialog-add-provider | 변수 추가 | light/100/1280 | 28 x 86 |
| dialog-add-provider | 허브 추가 | light/100/1280 | 24 x 73 |
| dialog-add-provider | 백그라운드 정책 자세히 | light/100/1280 | 20 x 20 |
| dialog-add-provider | 공급자 상태 확인 간격 줄이기 | light/100/1280 | 26 x 34 |
| dialog-add-provider | 공급자 상태 확인 간격 늘리기 | light/100/1280 | 26 x 34 |
| settings-general | 라이선스 보기 | light/100/1920 | 28 x 96 |
| settings-diagnostics | 대화 목록으로 이동 | light/100/1920 | 28 x 67 |
| settings-diagnostics | 환경 범위 | light/100/1920 | 20 x 52 |
| settings-diagnostics | 프로젝트 범위 | light/100/1920 | 20 x 76 |
| settings-diagnostics | 트레이스 ID 복사 | light/100/1920 | 20 x 20 |
| panel-에이전트 | 탭 오른쪽으로 스크롤 | light/100/1920 | 24 x 24 |
| settings-general | 환경 범위 | light/150/840 | 30 x 59 |
| settings-general | 프로젝트 범위 | light/150/840 | 30 x 86 |
| thread-06 Empty thread | 터미널 닫기 (⌘W) | light/150/840 | 32 x 32 |
| panel-파일 | 터미널 2 닫기 | light/150/840 | 24 x 24 |
| panel-실행 그래프 | 터미널 3 | light/150/840 | 24 x 62 |
| panel-브라우저 | 브라우저 | light/150/840 | 24 x 62 |
| panel-menu | 터미널 3 | light/150/840 | 24 x 62 |
| panel-menu | 브라우저 | light/150/840 | 24 x 62 |
| panel-터미널 | 터미널 4 | light/150/840 | 24 x 62 |
| dialog-add-action | 브라우저 | light/150/840 | 24 x 62 |
| dialog-add-action | 터미널 4 | light/150/840 | 24 x 62 |
| settings-general | 환경 범위 | light/150/1280 | 30 x 77 |
| settings-general | 프로젝트 범위 | light/150/1280 | 30 x 114 |
| settings-providers | 환경 범위 | light/150/1280 | 30 x 77 |
| settings-providers | 프로젝트 범위 | light/150/1280 | 30 x 114 |
| settings-integrations | 환경 범위 | light/150/1280 | 30 x 77 |
| settings-integrations | 프로젝트 범위 | light/150/1280 | 30 x 114 |
| settings-integrations | 기본 제공 값. 이 값의 출처 보기 | light/150/1280 | 30 x 30 |
| panel-에이전트 | 터미널 3 닫기 | light/150/1280 | 24 x 24 |
| panel-실행 그래프 | 터미널 4 닫기 | light/150/1280 | 24 x 24 |
| panel-브라우저 | 브라우저 | light/150/1280 | 24 x 62 |
| panel-menu | 브라우저 | light/150/1280 | 24 x 62 |
| panel-터미널 | 터미널 5 | light/150/1280 | 24 x 62 |
| dialog-add-provider | 환경 범위 | light/150/1280 | 30 x 77 |
| dialog-add-provider | 프로젝트 범위 | light/150/1280 | 30 x 114 |
| settings-general | 환경 범위 | light/150/1920 | 30 x 77 |
| settings-general | 프로젝트 범위 | light/150/1920 | 30 x 114 |
| settings-diagnostics | 트레이스 ID 복사 | light/150/1920 | 30 x 30 |
| settings-diagnostics | 환경 범위 | light/150/1920 | 30 x 77 |
| settings-diagnostics | 프로젝트 범위 | light/150/1920 | 30 x 114 |
| panel-에이전트 | 터미널 3 닫기 | light/150/1920 | 24 x 24 |
| ... | 345 rows in measure-after/comparison.json | | |
