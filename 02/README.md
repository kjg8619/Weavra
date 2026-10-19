# PR 02 current evidence - full icon hit rectangles

Product head: `f49c15848e37cecf12024abcd7a65617614b42ff`.
Base/shared runner: `ef605dbd4c71c88b8229f4bce0283890cc91d9a4`.
app.asar SHA-256: `2c5d1f06efc60074f3fb5b605d7e2607faa579027822b8c2cfbd6202ea302a23`.
Fixture: `hig-offline-projection-v3`.

This supersedes the d20f77e1 packet's corner-hit failure. Rounded button paint and 36x36 bounds are retained; a transparent square pseudo-element supplies the actual rectangular hit target. Border compensation keeps the hit surface inside the measured box. Native icon buttons now anchor that surface, and artwork is clipped on its inner child rather than clipping the target.

## Executed acceptance

Build, extract, before/after capture, diff, measure-02, motion-02, accept_pr 02, independent --verify-packet and independent hit/overlap audit: exit 0. All seven case-02 checks passed (611 assertions). Harness: 44 passing tests; sidebar: 1 passing test. Targeted lint/fmt and web typecheck passed. No threshold was weakened.

All 157 enabled foreground capture/live observations hit the intended control at the center and all four corners inset 4 CSS px. Eligibility exactly follows QA: visible, enabled, and the center hits the control. Disabled and center-obscured/modal-inert controls remain excluded only from hit assertions, not size assertions. A harness regression test proves one missed corner yields a scenario FAIL.

## Previously failing states

| State | Control | x,y,w,h | Five hits |
|---|---|---|---|
| 1280x800/04_empty_projects.png | Dismiss notification | 1217,79,36,36 | true,true,true,true,true |
| 1280x800/37_chat_streaming_working.png | 생성 중지 | 1099,727,36,36 | true,true,true,true,true |
| 1920x1080/04_empty_projects.png | Dismiss notification | 1857,79,36,36 | true,true,true,true,true |
| 1920x1080/37_chat_streaming_working.png | 생성 중지 | 1419,1007,36,36 | true,true,true,true,true |

The previous stored geometry produces exactly four failures with the strengthened check; see hit-baseline.json. The 1280x800 notification screen is byte-identical to the previous packet while all four corners now hit. The Stop visual remains round at the same size and location.

## Full observed icon inventory

| Control | CSS px |
|---|---|
| Toggle main sidebar | 36x36 |
| Dismiss notification | 36x36 |
| 파일 첨부 | 36x36 |
| 메시지 보내기 | 36x36 |
| Close | 36x36 |
| Back | 36x36 |
| Forward | 36x36 |
| Refresh | 36x36 |
| Open in system browser | 36x36 |
| Annotate preview | 36x36 |
| Capture screenshot | 36x36 |
| Float preview over chat | 36x36 |
| 생성 중지 | 36x36 |
| 이전 미디어 | 36x36 |
| image 미리보기 닫기 | 36x36 |
| 다음 미디어 | 36x36 |
| Minimize the theme editor | 36x36 |
| Close the theme editor | 36x36 |

All touched-target rectangles, including disabled boxes, have zero pairwise overlap. There are no new overlaps with other hittable controls. Raw manifest and live observation records are in hit-controls.json.

## Packet contents

- before/capture-manifest.json and after/capture-manifest.json bind current revisions, package hashes and all 152 primary records per side. The retained parent package is explicitly appRevision bb7649c97402d9a853f91b3a987f9fa48aa970eb; product-source equality at the test-only parent is checked by the runner.
- diff/pairs.json contains all 158 primary pairs, with zero failures. supplemental-diff/pairs.json contains 26 supplemental pairs.
- publication-index.json indexes 417 publication images (184 paired rows and 49 after-only frames).
- qa/scenario-receipt.json binds the fresh seven-check packaged run and hashed observations.
- hit-pipeline.mjs and hit-audit.mjs reproduce the pipeline and independent strict audit.
- logs/hit-*.json records exact commands, timestamps and exit codes. Archived console logs normalize only extra EOF newlines for git whitespace hygiene; originals remain in the local packet's commands directory.

The owner-approved October 19 amendment reserves the exhaustive universal Q1-Q12 matrix for the Final verification wave. It does not waive any executed five-point check. Earlier q5-* files are historical; this README, current capture manifests, hit-* packet and current scenario receipt are authoritative for this head.
