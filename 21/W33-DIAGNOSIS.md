# W-33 classification: [product]

Parent: d81bc594776ea0cf5b9ea45db6865a4f24831ded.
Head: 245a9efdfee4e949a5d312798bcdbf31ed0c1675. Runner: 82834bcf1be52aed98eef525696550077bf83df2.

The unchanged parent retains the Example heading, greeting/console code, shell and table in the same DOM order, yet loses painting after the theme/settings cycle. This is a product rendering failure, not evidence-only loss. The earlier offscreen-greeting readiness problem was corrected by the runner owner before implementation; the original initial screenshots alone did not establish closure.

| CSS viewport | Parent DOM/order | Parent painted | Head DOM/order and painted |
|---|---|---|---|
| 840x620 actual minimum | 3/3 | 0/3 | 3/3 |
| 1280x800 | 3/3 | 0/3 | 3/3 |
| 1920x1080 | 3/3 | 3/3 | 3/3 |
| 2560x1440 | 3/3 | 3/3 | 3/3 |
| 390x844 forced renderer stress | 3/3 | 0/3 | 3/3 |

Both final acceptance rounds pass all 7 checks and 265 assertions at this head. Each cycle is light -> dark -> light at one established anchor; content outside the viewport is not confused with missing DOM content. The code anchor must still intersect the transcript viewport.

## Captured mechanism

The read-only parent bootstrap probe records measured row sizes 91 and 465, didContainersLayout=true, an unfinished initial bootstrap target 338 and the browser's actual maximum/scrollTop 322. The initial target carries preserveForFooterLayout and viewOffset=-16. Legend's paint-ready condition never completes and its container remains opacity:0 while DOM rectangles and AX content remain present.

MessagesTimeline.tsx:1390 now initializes an already remembered thread from its saved actual DOM scrollOffset rather than replaying the initial end-index/footer bootstrap. Fresh threads retain the initial-end path. No message data, row identity or theme-dependent remount key changes. It does not force Legend's paint style.

The independent 82px drift came from reinserting a previously dismissed, unchanged provider notice on returning from Settings. ChatView.tsx:3913/10457 retains the dismissal per environment/provider and clears it on observed recovery; a different error key is not dismissed. Final anchor assertions pass without selecting another thread or scrolling to another message.

## Bound artifacts

- [Unchanged-parent runner repair/results](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diagnosis-parent--lead--RUNNER-FIX-RESULTS.md)
- [Unchanged-parent failing scenario receipt](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diagnosis-parent--lead--scenario-receipt.json)
- [Read-only parent bootstrap observations](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diagnosis-parent--probe--observations.json)
- [Final round 1 receipt](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa-round-01--scenario-receipt.json)
- [Final round 2 receipt](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa--scenario-receipt.json)
- [All 15 final cycle observations](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa--run-467729e7-2507-4847-bfe7-dec57479efb6--scenarios--21--theme-content-parity--observations.json)

The diagnosis parent bundle has app.asar 0385a57b7203aaec8be0a94fe8257b2aa85f45468ce5060b0a08e6e60b51b5ef. The fresh paired parent build has ac879d51d6317a0d1d4bf34dbe0b905bf2ca1f86e485dab25992d3629f8d9c90; both record source d81bc594, but they are distinct actual packages, not claimed byte-identical. Final head app.asar is 81debd18a2c3d7332ed2588c824b59db8f273e122efc2e6402b8400c2af92f65.

Renderer PNG, Electron webContents.capturePage PNG, DOM/rectangles and full AX are retained in the paired corpus and diagnosis run. Native minimum is 840x620 outer; 390 is unsupported-native stress, not phone support.

## Supplemental same-state four-channel comparison

A separate read-only comparison uses the fresh paired parent and final packages. At 390, light -> dark -> light, the parent is blank in both renderer PNG (390x844) and Electron WebContents PNG (780x1688); DOM/AX retain the code and table, and painting remains false after both captures. The head paints in both methods and its post-capture DOM remains painted. This is not a capture-only repair.

This supplemental 840 sequence remains painted in both packages with its different established scroll state; it is not substituted for the standardized 15-sample experiment above. All raw outcomes are retained rather than forced to match.

| Method, 390 light first cycle | Parent | Head |
|---|---|---|
| Renderer | ![parent renderer](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/channel-comparison--parent--390-light-1.png) | ![head renderer](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/channel-comparison--head--390-light-1.png) |
| Electron WebContents | ![parent Electron](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/channel-comparison--parent--390-light-1.electron.png) | ![head Electron](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/channel-comparison--head--390-light-1.electron.png) |

[Parent DOM/geometry and capture hashes](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/channel-comparison--parent--observations.json) | [Parent AX](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/channel-comparison--parent--390-light-1.ax.json) | [Head DOM/geometry and capture hashes](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/channel-comparison--head--observations.json) | [Head AX](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/channel-comparison--head--390-light-1.ax.json)
