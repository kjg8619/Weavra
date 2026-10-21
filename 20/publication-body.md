## Problem and change

Thread deletion used a generic Confirm action. Both sidebars and Archive now pass an explicit target-specific Korean title, permanent-record consequence and `스레드 삭제` through optional typed `title` and `confirmLabel` fields. Active, queued and closing confirmations retain those fields without guessing the destructive action from translated prose. Generic callers keep their existing confirmation copy and result semantics.

Initial focus is visibly on the neutral title. Unchosen Enter does nothing; Escape and Cancel preserve the thread and draft and return focus to the opener. Explicit activation deletes only the selected disposable fixture once. Touched text is at least 14px, square button hit surfaces include all four corners, boundaries stay legible on hover, and keyboard focus has a 2px outline.

Closes: W-30 only.

Base: `hig/19-theme-selection` at `b4de3b5dbdf441925ac2c5d64b9276737af2f1b3`.
Head: `d81bc594776ea0cf5b9ea45db6865a4f24831ded`.
Implementation: `ff9b25f85b770d4778d4b49204bcbab3f7d4dcfb`.
Head app.asar: `0385a57b7203aaec8be0a94fe8257b2aa85f45468ce5060b0a08e6e60b51b5ef`.
Parent app.asar: `b8f532347d32afed00c74bd1c86082e7f006faa3fd1e1dde70bea727a73d3b65`.

Dependencies: parent [#91](https://github.com/kjg8619/Weavra/pull/91), sidebar predecessor [#78](https://github.com/kjg8619/Weavra/pull/78) and Archive predecessor [#89](https://github.com/kjg8619/Weavra/pull/89). Shared runner [`7bc326a3`](https://github.com/kjg8619/Weavra/commit/7bc326a366fe5936f850afbd414809f50e4d0841) and the corrected parent were integrated by normal merges. The shared runner worktree was not edited. Its named-action readiness fix passed eight live state-44 checks against todo 16-19 packages at both desktop sizes before todo 20 acceptance.

## Before / after

| State, size, theme, interaction | Before (parent build) | After (this build) | Measurement / diff |
|---|---|---|---|
| 44, 1280x800, light, initial focus | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/before--capture--1280x800--44_delete_thread_confirmation.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/after--capture--1280x800--44_delete_thread_confirmation.png?raw=true) | [0.0914](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/diff--1280x800--44_delete_thread_confirmation.json?raw=true) |
| 44, 1920x1080, light, initial focus | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/before--capture--1920x1080--44_delete_thread_confirmation.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/after--capture--1920x1080--44_delete_thread_confirmation.png?raw=true) | [0.0450](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/diff--1920x1080--44_delete_thread_confirmation.json?raw=true) |

[Complete image table](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/image-table.md?raw=true): all 158 matching pairs, every supplemental current/Legacy sidebar and Archive light/dark frame, minimum window, 100/150% text, neutral/keyboard focus, explicit deletion result and earlier-stack state-44 regression. [Located diff inspection](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/diff-inspection.md?raw=true).

## Verification

- Focused tests: **33/33**, five files, exit **0**.
- Owned fmt, lint, web typecheck, contracts typecheck and whitespace checks: exit **0** each. Existing 39 warnings were not suppressed.
- Shared runner `7bc326a3`: **91/91**, exit **0**.
- Clean parent/head mac/zip arm64 builds: exit **0**. Parent/head capture and all image diffs: exit **0**.
- Two fresh `accept_pr 20` rounds: five scenarios each, exit **0**. Both `--verify-packet` runs and both base/head `git diff --check` runs: exit **0**.
- [Exact provenance and exits](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/acceptance-status.json?raw=true), [official verdict](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/acceptance-verdict.json?raw=true), [round 1](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/qa-round-01--scenario-receipt.json?raw=true), [round 2](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/qa--scenario-receipt.json?raw=true).
- [Rules a-j](https://github.com/kjg8619/Weavra/blob/hig-evidence/20/20/rules-a-j.md?raw=true): **2,613 rows, 53 PNGs, zero failures**. All 158 pair images and 53 supplemental frames were inspected through 40 + 14 full contact sheets.

| Rule | Measured result |
|---|---|
| a | PASS: 152 targets >=36x36; 760 center/corner points hit the intended control. |
| b | PASS: all 304 touched text observations >=14px. |
| c | PASS: composited text contrast >=5.82597:1. |
| d | PASS: zero isolated Korean final-syllable findings. |
| e | PASS: named target/action; one persisted selected-fixture deletion; other fixture survives. |
| f | PASS: strict fit, no modal scroll or primary horizontal/subpixel overflow. |
| g | PASS: neutral focus, Enter refusal, Cancel/Escape preservation and focus return. |
| h | PASS: control boundaries >=14.24976:1; focused outlines >=2px and >=3:1. |
| i | PASS: zero required-label ellipsis or glyph clipping. |
| j | PASS: sibling action intersection area is exactly zero. |

## Residual findings

The 39 pre-existing warnings in the owned lint set remain; none was suppressed. Queued target/action retention, host unmount cancellation and generic consumers have unit coverage; no queued-dialog visual is claimed. Full universal Q, 200% zoom, +40% authored copy, actual VoiceOver/IME, interrupted motion and monorepo CI remain Final-wave checks under the approved amendment.

One bounded evidence-app gate was used for each launch, with owned cleanup and inactive native display. The app did not move or grab the OS pointer. Only isolated synthetic profiles and explicit disposable fixture lifecycle operations were used; model/Runtime-operation requests are zero. `/Users/kangjingoo/Applications/Weavra.app` and the live profile were untouched. No force push or PR merge occurred.

Model and harness: GPT-5.6-Sol resume/integration/QA over the prior GPT-6.1-Sol implementation draft, with Senpi and shared HIG runner `7bc326a366fe5936f850afbd414809f50e4d0841`.
