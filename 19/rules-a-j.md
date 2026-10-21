# Todo 19 fresh self-measurement

Head b4de3b5dbdf441925ac2c5d64b9276737af2f1b3; runner fa5e1dbcfb12fd51c5ac0d9dd0ca7a6e89f91c4a.
Parent app.asar 6a80bc979588694edbccbd75d4017d887c589f900b4b2fe488683f059f726b80; head app.asar 05a2a75650d7022953156ac03b69c139febbb7662a1bbe9ca370c506085e518f.
Fresh head measurement: 2113 rows, 53 PNGs, zero failures.
Light/dark, 840x620 / 1280x800 / 1920x1080 CSS viewports, 100/150% text.
Native outer/content/minimum rectangles accompany each screenshot; display clamping is not labelled as a larger native window.

| Rule | Executed result |
|---|---|
| a | PASS: 182 targets >=36px; 182 five-point checks pass. |
| b | PASS: measured touched labels >=14px. |
| c | PASS: composited text contrast >=14.14471:1. |
| d | PASS: actual imported Korean title, 12 contexts; 0 orphans and 0 mid-word breaks. Character rectangles and per-word line membership are retained. |
| e | PASS: selection survives focus-only navigation; System light/dark/light stays selected; opening the editor preserves rendered palette. |
| f | PASS: strict-fit, clipping and horizontal-overflow checks have zero failures; exactly one overflowing scroll owner in each measured pane. |
| g | PASS: 24 Escape/Enter contexts restore the correct opener, keep the route and selection, disable hidden options and activate only the opener on Enter. Full IME/VoiceOver traversal remains Final-wave coverage. |
| h | PASS: control borders >=4.58432:1, glyph checks >=3:1; visible focus >=2px and >=3:1. |
| i | PASS: no required-text ellipsis or clipping in measured controls. Optional identity/title disclosures outside these touched controls retain their existing behavior. |
| j | PASS: sibling controls and every variant label text box vs preview/check badge have zero intersection area. New label fixture: 24 labels / 12 contexts; baseline 12 failures, head 0. |

The imported synthetic theme is reached through Add theme and Theme JSON; no real profile or credential is used.
The launcher uses showInactive and suppresses native activation while preserving renderer DOM focus; it does not exercise or claim native app-focus behavior.
Two ps checks, a bounded competitor wait, a post-launch competitor check and owned app.close are recorded in logs/evidence-apps.log.
The complete universal Q cross-product, 200% zoom, +40% authored copy, VoiceOver/IME and interrupted-motion sequences remain Final-wave checks under the approved amendment.
Fix2 has two fresh accept_pr 19 and two fresh --verify-packet runs, all exit 0 on this revision. Both receipts are retained. The runner is pinned to the fa5e1dbc scripts already merged into hig-19, not the moving shared hig-01 worktree.
