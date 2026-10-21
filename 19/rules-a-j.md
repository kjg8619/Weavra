# Todo 19 fresh self-measurement

Head 0ae0238b299714d6b07e8514de7a981afeb77aef; runner fa5e1dbcfb12fd51c5ac0d9dd0ca7a6e89f91c4a.
Parent app.asar 6a80bc979588694edbccbd75d4017d887c589f900b4b2fe488683f059f726b80; head app.asar d06fcfd595913ac826ff438b1636ee62204347a266f84c709a63bba0f7955b23.
Fresh head measurement: 2113 rows, 53 PNGs, zero failures.
Light/dark, 840x620 / 1280x800 / 1920x1080 CSS viewports, 100/150% text.
Native outer/content/minimum rectangles accompany each screenshot; display clamping is not labelled as a larger native window.

| Rule | Executed result |
|---|---|
| a | PASS: 182 targets >=36px; 182 five-point checks pass. |
| b | PASS: measured touched labels >=14px. |
| c | PASS: composited text contrast >=14.14471:1. |
| d | PASS: measured Korean orphan checks have zero failures. |
| e | PASS: selection survives focus-only navigation; System light/dark/light stays selected; opening the editor preserves rendered palette. |
| f | PASS: strict-fit, clipping and horizontal-overflow checks have zero failures; exactly one overflowing scroll owner in each measured pane. |
| g | PASS: measured keyboard focus and editor close preserve selection. Full IME/VoiceOver traversal remains Final-wave coverage. |
| h | PASS: control borders >=4.58432:1, glyph checks >=3:1; visible focus >=2px and >=3:1. |
| i | PASS: no required-text ellipsis or clipping in measured controls. Optional identity/title disclosures outside these touched controls retain their existing behavior. |
| j | PASS: measured sibling-control intersection area is zero. |

The imported synthetic theme is reached through Add theme and Theme JSON; no real profile or credential is used.
The launcher uses showInactive and suppresses native activation while preserving renderer DOM focus; it does not exercise or claim native app-focus behavior.
Two ps checks, a bounded competitor wait, a post-launch competitor check and owned app.close are recorded in logs/evidence-apps.log.
The complete universal Q cross-product, 200% zoom, +40% authored copy, VoiceOver/IME and interrupted-motion sequences remain Final-wave checks under the approved amendment.
Both fresh accept_pr 19 rounds and both --verify-packet runs exit 0; see acceptance-status.json, scenario receipts and raw command logs.
