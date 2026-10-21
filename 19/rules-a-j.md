# Todo 19 fresh self-measurement

Head 14914ad09237ab6d89e6c21b11b0e2e008fa42d5; runner fa5e1dbcfb12fd51c5ac0d9dd0ca7a6e89f91c4a.
Parent app.asar 6a80bc979588694edbccbd75d4017d887c589f900b4b2fe488683f059f726b80; head app.asar a6600f48f09202257bdb8ff1f9aecff1dd9aa09b9e40d20a29b27330ba7dc9a1.
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
| j | PASS: measured sibling-control intersection area is zero. |

The imported synthetic theme is reached through Add theme and Theme JSON; no real profile or credential is used.
The launcher uses showInactive and suppresses native activation while preserving renderer DOM focus; it does not exercise or claim native app-focus behavior.
Two ps checks, a bounded competitor wait, a post-launch competitor check and owned app.close are recorded in logs/evidence-apps.log.
The complete universal Q cross-product, 200% zoom, +40% authored copy, VoiceOver/IME and interrupted-motion sequences remain Final-wave checks under the approved amendment.
Fix1 has one fresh accept_pr 19 and one fresh --verify-packet run, both exit 0 on this revision. The preceding revision's two rounds are historical, not acceptance for this head.
