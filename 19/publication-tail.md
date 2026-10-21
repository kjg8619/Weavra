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
