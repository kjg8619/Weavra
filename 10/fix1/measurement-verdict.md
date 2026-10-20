# Todo 10 fix 1: five-failure measurement verdict

Measured personally on October 20, 2026, using the packaged Electron app built from clean head `da28577ba32d1476b65595301c41b1f670557b03`.

App ASAR SHA-256: `62d94b3a6bc8a4fb89caa27976eec382859be9994923b3dae21509083e2f4414`.

Scope: light and dark; 840x620, 1280x800, 1920x1080; 100% and 150% text. Both supported and synthetic unsupported server capability were exercised. The unsupported input changes only `weavraReadOnly=false` in server config; it does not replace product code or DOM.

| Failure | Change and observed result | Verdict |
|---|---|---|
| F1: Escape after Tab | Help owns a capture-phase listener while open. It closes before the sheet and restores the opener on the next animation frame, after the sheet's queued focus movement. First and repeated Enter -> Tab -> Escape: 48/48. All six unsupported theme/size cases pass at both text scales. | PASS |
| F2: diagnostic icon targets | Actual clickable/focusable details buttons are 36x36 CSS px at 100%, 54x54 at 150%. Their minimum measured group separation is 142.773px. Resource metric glyphs remain decorative: aria-hidden span/SVG, tabIndex -1, adjacent metric label, no button action. Raw DOM and five-point hit results are saved. | PASS |
| F3: required labels | Required metric labels, values and detail text wrap. The compact resource grid is one column below 1000px, avoiding the unbreakable English throughput word at 150%. No required clipping, ellipsis or Korean mid-word/isolated-final-syllable failures in any combination. Font minimum 14px/21px. | PASS |
| F4: entry-control edges | Only graph/fitness entry controls override their border with the existing muted-foreground token; shared Button primitive is untouched. Default, hover, actual pointer-pressed and focus states recorded. Minimum measured edge contrast: light 4.525:1, dark 4.433:1. Details icon focus outlines also pass >=3:1 and >=2px. | PASS |
| F5: graph action/composer | Both supported destination and unsupported help are in normal flow before the long explanatory text, without negative offsets or overflow above a scroll origin. Every measured entry control has zero composer/message/modal intersection and is reachable, unclipped and hit-testable. | PASS |

The numeric summary uses controls only for edge/intersection aggregation; paragraph rectangles in a modal sheet are retained as raw observations, not confused with entry-control edges or hit targets.

## Preserved positive checks

- 2,052 measured/assertion rows, 60 fresh screenshots; both runs have zero failures and owned app cleanup true.
- Minimum reached text contrast: light 4.705:1, dark 4.847:1. Korean `break-keep` and `text-pretty` remain.
- Model 0, Runtime mutation 0, external network 0.
- Twelve `weavra.fitness` requests, all `command:"list"` and the same selected project. Actual read failure remains honest; no empty history, rank, score or success was fabricated.
- Graph layout constants and CPU/score calculations are unchanged.

## Reproduction and artifacts

- `measure.mjs`: actual packaged-app measurement script; `--unsupported` selects the explicit synthetic capability input.
- `supported.json`, `unsupported.json`: raw DOM, rectangles, first/repeated keyboard assertions, states, computed colors/composited backgrounds, hit points, event payloads and cleanup.
- `summary.json`: all 12 theme/size/text combinations, current script hashes and screenshot hashes.
- `logs/{supported,unsupported,summary}.log`: execution output.
- `logs/{tests,format,lint,typecheck,build}.log`: final source checks/build, all exit 0. Focused tests: 15 tests / 3 files, Node 24.19.0 / pnpm 11.10.0.

Initial navigation instrumentation failures and superseded product iterations remain under `attempt-*` and sibling archived packet directories. They are not passing evidence.

The first shared-runner capture also reproduced the previously reported startup `fetch-session-state (HTTP 500)` error. Its real screenshot and failed capture receipt are preserved under `attempt-capture-startup/`. The capture guard only permits the app's actual `Try again` action after observing that exact error; it does not change the frozen runner's assertions or fabricate onboarding readiness.

This verdict covers the five requested failures. It does not newly verify populated graph/history, forced danger/amber telemetry, successful empty history, 200% renderer zoom, +40% copy or exhaustive motion states. Those Final-wave obligations are not inferred from these measurements. Existing unrelated sidebar/footer wrapping, shared range controls and the memo-dependencies warning were left outside this fix. Language-server freshness timed out; actual web typecheck passed.

Model/harness: GPT gpt-6.1-sol, Senpi; packaged Electron via Playwright; frozen shared runner export e6fbc82c. No other product branch or installed app was modified.
