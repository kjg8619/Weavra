## Verification

- Focused tests from `app/t3code/apps/web`:
  `pnpm exec vp test run --project unit src/components/settings/ThemeSelection.test.tsx src/hooks/useTheme.test.ts src/components/settings/ThemeEditorHost.test.tsx src/components/settings/ThemeImportDialog.test.ts`
  — **19/19**, four files, exit **0**.
- From `app/t3code`: targeted `pnpm exec vp fmt --check` and
  `pnpm exec vp lint` on `ThemeSettings.tsx`, `ThemePreviewCircles.tsx` and
  `ThemeSelection.test.tsx`; `pnpm --filter @t3tools/web typecheck` —
  exit **0** each. Accent-stripe and base/head whitespace checks exit **0**.
  Product-file LSP diagnostics are clean. No shared runner source changed.
- The clean head was rebuilt with
  `T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false pnpm run dist:desktop:artifact --platform mac --target zip --arch arm64 --output-dir ...`
  — exit **0**. Source-bound capture, baseline image diffs, supplemental
  image diffs and the 12 variant-regression image pairs exit **0**.
  The unchanged parent reference is the verified fb97140d package/capture.
- **Two fresh `accept_pr 19` rounds on this head**, each including case-19
  scenarios, `--verify-packet` and base/head `git diff --check`: exit
  **0 / 0 / 0** in both rounds. Both scenario receipts are retained:
  [round 1](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/fix2--qa-round-01--scenario-receipt.json?raw=true),
  [round 2](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/qa--scenario-receipt.json?raw=true).
  Selection wash/check, independent focus, native System light/dark/light
  and rendered custom-preview preservation all pass.
- [Exact provenance and command exits](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/acceptance-status.json?raw=true);
  [official packet verdict](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/acceptance-verdict.json?raw=true);
  [executed rules a-j](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/rules-a-j.md?raw=true);
  [control geometry, contrast, strict fit and five-point hit tests](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/measure-after--measurements.json?raw=true).
  The controls retain their sizes, 14px minimum text, contrast, focus
  treatment, one vertical scroll owner and zero sibling intersection.
- **New non-interactive-label regression**:
  [before, 14914ad](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/fix2--before--measurements.json?raw=true),
  [after, b4de3b5d](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/fix2--after--measurements.json?raw=true),
  [image diffs](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/fix2--pairs.json?raw=true),
  [executable measurement](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/tools--variant-label-19.mjs?raw=true).
  Both selected light/dark previews are measured in light and dark app
  themes at 840x620, 1280x800 and 1920x1080, with 100% and 150% root text:
  **24 labels / 12 contexts**. The old head fails **12/24** labels
  (all 100% contexts); the new head fails **0/24**. Maximum text-box overlap
  with the preview target falls from **660.65625px² to 0** and with the
  actual check badge from **250.484375px² to 0**. Whole label-box
  intersections are also zero after the fix, with no truncation.
  The expected baseline run exits **1**, while the same measurement on
  the new package exits **0**. Native outer/content/minimum rectangles,
  source revision, package/script hashes, counter receipts and screenshot
  hashes are retained; CSS viewport sizes are not mislabelled as native.
- [Fresh Korean and Escape/Enter regressions](https://github.com/kjg8619/Weavra/blob/hig-evidence/19/19/fix1--measurements.json?raw=true)
  rerun on this head: 12 Korean contexts, zero orphan final lines or
  mid-word breaks; 24 variant Escape/Enter contexts restore the opener,
  retain Settings/selection, disable hidden options and prevent hidden
  option activation. Exit **0**.

## Residual findings

One pre-existing `ThemeSettings.tsx:473` lint warning remains:
`warning react(set-state-in-effect): Calling setState synchronously within an effect can trigger cascading renders`.
The command exits 0; no suppression or unrelated refactor was added.
The theme editor's pre-existing Escape behavior is outside todo 19's
owned files; explicit Close works, as independent QA recorded.

The full universal Q cross-product, 200% zoom, +40% authored copy,
VoiceOver/IME and interrupted motion remain Final-wave coverage under
the approved October 19 amendment. No fresh independent QA approval is
claimed for this writer's fix.

Evidence apps use bounded one-app checks, post-launch competitor checks,
inactive native display and owned cleanup. No OS pointer movement/grab,
live-profile use, installed-app change, model execution or Runtime mutation
is involved. `/Users/kangjingoo/Applications/Weavra.app` was untouched.
No force push or PR merge occurred.

Model and harness: GPT-6.1-Sol (`chatgpt-subscription`) with Senpi;
HIG runner `fa5e1dbcfb12fd51c5ac0d9dd0ca7a6e89f91c4a`, pinned from hig-19.
