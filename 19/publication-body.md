## Problem and change

Appearance mode cards and theme preview circles used the same accent-ring
language for selection and keyboard focus. Selection now uses a semantic tonal
wash and a check, while a separate outline follows the actual keyboard focus.
Light/dark assignment stays independent; the sun/moon meaning, System mode,
imported palettes and existing fonts are preserved.

The touched mode cards retain their rounded paint but have a transparent square
hit surface inside the padding box. This fixes corner misses without enlarging
the layout, overlapping another control or adding internal scroll overflow.
Touched labels are at least 14px and control boundaries use the existing
semantic foreground roles.

Tests exercise the real theme preference store, independent palette halves,
saved System mode through media events, and dismissal without persistence.
The test fixture publishes its captured hook snapshot after render, removing
the new globals warning without suppressing lint.

Closes: W-26 only.

Base: `hig/18-provider-layout` at
`fb97140d6781ff14b680cd56eec95e31fb23841b`.
Head: `0ae0238b299714d6b07e8514de7a981afeb77aef`.
Head app.asar SHA-256:
`d06fcfd595913ac826ff438b1636ee62204347a266f84c709a63bba0f7955b23`.
Parent app.asar SHA-256:
`6a80bc979588694edbccbd75d4017d887c589f900b4b2fe488683f059f726b80`.

Dependencies: parent [#90](https://github.com/kjg8619/Weavra/pull/90),
foundations [#74](https://github.com/kjg8619/Weavra/pull/74) and
Appearance's shared settings predecessor [#89](https://github.com/kjg8619/Weavra/pull/89).
Shared runner
[`fa5e1dbc`](https://github.com/kjg8619/Weavra/commit/fa5e1dbcfb12fd51c5ac0d9dd0ca7a6e89f91c4a)
is integrated by a normal merge. The shared hig-01 worktree was not edited.

## Before / after

| State, size, theme, interaction | Before | After | Diff |
|---|---|---|---|
| `1280x800/18_settings_appearance_light.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/before--capture--1280x800--18_settings_appearance_light.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/after--capture--1280x800--18_settings_appearance_light.png?raw=true) | [0.1475](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/diff--1280x800--18_settings_appearance_light.json?raw=true) |
| `1280x800/19_settings_appearance_dark.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/before--capture--1280x800--19_settings_appearance_dark.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/after--capture--1280x800--19_settings_appearance_dark.png?raw=true) | [0.1439](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/diff--1280x800--19_settings_appearance_dark.json?raw=true) |
| `1920x1080/18_settings_appearance_light.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/before--capture--1920x1080--18_settings_appearance_light.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/after--capture--1920x1080--18_settings_appearance_light.png?raw=true) | [0.1185](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/diff--1920x1080--18_settings_appearance_light.json?raw=true) |
| `1920x1080/19_settings_appearance_dark.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/before--capture--1920x1080--19_settings_appearance_dark.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/after--capture--1920x1080--19_settings_appearance_dark.png?raw=true) | [0.1153](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/diff--1920x1080--19_settings_appearance_dark.json?raw=true) |

[Complete image table: all baseline states, both themes, selection/focus/grayscale, imported theme and System switching](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/image-table.md?raw=true).

## Verification

- From `app/t3code/apps/web`:
  `pnpm exec vp test run --project unit src/components/settings/ThemeSelection.test.tsx src/hooks/useTheme.test.ts src/components/settings/ThemeEditorHost.test.tsx src/components/settings/ThemeImportDialog.test.ts`
  — **17/17**, four files, exit **0**.
- From `app/t3code`: `pnpm exec vp fmt --check` and `pnpm exec vp lint` on
  `ThemeSettings.tsx`, `ThemePreviewCircles.tsx` and `ThemeSelection.test.tsx`;
  `pnpm --filter @t3tools/web typecheck` — exit **0** each.
  The accent-stripe check and base/head whitespace check also exit **0**.
- Merged runner: `bun test scripts/hig/harness.test.ts` — **87/87**, exit **0**.
  `node --check scripts/hig/cases.mjs` and
  `node --check scripts/hig/capture.mjs` also pass.
- Both clean-source packages were rebuilt with
  `T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false pnpm run dist:desktop:artifact --platform mac --target zip --arch arm64 --output-dir ...`
  — exit **0** each. Both source-bound captures and both shared/supplemental
  image comparisons exit **0**. The installed application is not a reference
  build and was not modified.
- Fresh `accept_pr 19`: **0 / 0**. Fresh `--verify-packet`, canonical `pr-19`
  packet: **0 / 0**. Each round executes all four case-19 scenarios:
  selection wash/check, focus independent of selection, native System
  light/dark/light, and custom-editor preview preservation.
- [Exact SHAs, package/script/fixture provenance and both acceptance rounds](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/acceptance-status.json?raw=true).
  [Official packet verdict](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/acceptance-verdict.json?raw=true).
- [Fresh rules a-j](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/rules-a-j.md?raw=true)
  and [computed measurements](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/measure-after--measurements.json?raw=true):
  **2,113 rows, 53 PNGs, zero failures**. Light/dark; 840x620, 1280x800 and
  1920x1080 CSS; 100/150% text. Every screenshot carries native minimum, outer
  and content rectangles rather than assuming CSS size equals native size.
  The 182 target observations and 182 five-point hit checks (910 points) pass.
  Text is at least 14px with measured contrast at least 14.14471:1; control
  boundaries are at least 4.58432:1. Focus, required-text clipping, scroll
  ownership, strict fit and sibling intersections have zero failures.
- The synthetic custom theme is imported through the actual Add theme/Theme
  JSON path. Opening the editor compares rendered sRGB RGBA, not equivalent
  CSS strings. The exact comparison retains alpha and zero pixel tolerance;
  the shared regression suite also rejects a genuinely changed color.

## Residual findings

One pre-existing `ThemeSettings.tsx` set-state-in-effect lint warning remains.
No lint suppression, weakened test or unrelated refactor was added. The full
universal Q cross-product, 200% zoom, +40% authored copy, actual VoiceOver/IME,
interrupted-motion sequences and monorepo CI remain Final-wave coverage under
the approved October 19 amendment. This PR does not claim those unexecuted
checks passed.

The earlier native-System and raw-token-comparison runner defects are resolved
by the merged runner. Their rejected local packets are not substituted for
either fresh acceptance round.

Evidence apps run with bounded one-app checks and owned cleanup. The launcher
uses inactive native window display and suppresses native activation; renderer
DOM focus remains exercised. It does not move or grab the owner's OS pointer,
and no native app-focus or VoiceOver verdict is claimed. Synthetic profiles have
zero recorded model, Runtime mutation and blocked-outbound counters.
`/Users/kangjingoo/Applications/Weavra.app` and its profile were untouched.
No force push or PR merge occurred.

Model and harness: GPT-6.1-Sol (`chatgpt-subscription`) with Senpi; shared HIG
runner `fa5e1dbcfb12fd51c5ac0d9dd0ca7a6e89f91c4a`.
