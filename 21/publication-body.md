## Problem and change

A remembered code conversation could keep its DOM but remain unpainted after theme navigation because an indexed initial-end/footer bootstrap waited for an offset beyond the browser scroll range. Restore the saved actual DOM offset instead; retain unchanged provider-notice dismissal so the same conversation anchor does not shift. Message data and list identity are unchanged.

The toolbar now keeps the panel target at least 36 x 36 CSS px and moves secondary Git actions into labelled overflow when the header cannot fit them. Focus survives the breakpoint and Escape. Commands, destinations and panel labels/behavior are retained; Git is never initialized automatically. Disabled actions remain legible and distinct, without duplicate publish/PR entries.

Closes: W-33, W-34.
Base: `hig/20-delete-confirmation` at `d81bc594776ea0cf5b9ea45db6865a4f24831ded`.
Head: `245a9efdfee4e949a5d312798bcdbf31ed0c1675`.
Parent app.asar: `ac879d51d6317a0d1d4bf34dbe0b905bf2ca1f86e485dab25992d3629f8d9c90`.
Head app.asar: `81debd18a2c3d7332ed2588c824b59db8f273e122efc2e6402b8400c2af92f65`.
Dependencies: [parent PR #92](https://github.com/kjg8619/Weavra/pull/92), [approved runner 82834bcf](https://github.com/kjg8619/Weavra/commit/82834bcf1be52aed98eef525696550077bf83df2).

**W-33 cause: [product].** The corrected unchanged-parent cycle retained DOM/order in all 15 samples but lost paint in 9 (840, 1280 and 390). Both final fresh rounds retain DOM/order, paint and the same code anchor in all 15. The same-state four-channel comparison also shows the fresh parent blank in both renderer/Electron captures at 390 while DOM/AX retain the transcript. [Bound diagnosis and source artifacts](https://github.com/kjg8619/Weavra/blob/hig-evidence/21/21/W33-DIAGNOSIS.md).

### Actual native versus renderer sizes

| Official capture | Native outer | Native content | Renderer CSS viewport |
|---|---|---|---|
| Actual minimum | 840x620 | 840x620 | 840x620 |
| 1280 | 1280x800 | 1280x800 | 1280x800 |
| 1920, display-clamped height | 1920x949 | 1920x949 | 1920x1080 |
| 2560, display-clamped height | 2560x949 | 2560x949 | 2560x1440 |
| Forced 390 stress | 1280x800 | 1280x800 | 390x844 |

The native 840x620 outer minimum is preserved and rejects below-minimum resize. 390 is an intentionally forced renderer stress probe, **not native phone support**. Separate channel-comparison runs also retain their own actual bounds; the table above describes the official paired corpus.

## Before / after

[Complete 158-pair image table, all supplemental measurements and both official rounds](https://github.com/kjg8619/Weavra/blob/hig-evidence/21/21/image-table.md).

| State, size, theme, interaction | Parent | Head | Measurement / diff |
|---|---|---|---|
| `1280x800/36_chat_code_blocks.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/before--capture--1280x800--36_chat_code_blocks.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/after--capture--1280x800--36_chat_code_blocks.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diff--1280x800--36_chat_code_blocks.json) |
| `1280x800/41_chat_code_blocks_dark.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/before--capture--1280x800--41_chat_code_blocks_dark.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/after--capture--1280x800--41_chat_code_blocks_dark.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diff--1280x800--41_chat_code_blocks_dark.json) |
| `1920x1080/36_chat_code_blocks.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/before--capture--1920x1080--36_chat_code_blocks.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/after--capture--1920x1080--36_chat_code_blocks.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diff--1920x1080--36_chat_code_blocks.json) |
| `1920x1080/41_chat_code_blocks_dark.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/before--capture--1920x1080--41_chat_code_blocks_dark.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/after--capture--1920x1080--41_chat_code_blocks_dark.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diff--1920x1080--41_chat_code_blocks_dark.json) |
| `390x844/42_narrow_chat_dark.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/before--capture--390x844--42_narrow_chat_dark.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/after--capture--390x844--42_narrow_chat_dark.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diff--390x844--42_narrow_chat_dark.json) |
| `390x844/43_narrow_chat_light.png` | ![before](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/before--capture--390x844--43_narrow_chat_light.png) | ![after](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/after--capture--390x844--43_narrow_chat_light.png) | [diff JSON](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diff--390x844--43_narrow_chat_light.json) |
| Actual minimum cycle `code-840-light-1.png` | ![parent cycle](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diagnosis-parent--lead--run-a1ef8eb7-1966-443e-a8d2-898ac216e64a--scenarios--21--theme-content-parity--code-840-light-1.png) | ![head cycle](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa--run-467729e7-2507-4847-bfe7-dec57479efb6--scenarios--21--theme-content-parity--code-840-light-1.png) | [cycle observations](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa--run-467729e7-2507-4847-bfe7-dec57479efb6--scenarios--21--theme-content-parity--observations.json) |
| Actual minimum cycle `code-840-dark-2.png` | ![parent cycle](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diagnosis-parent--lead--run-a1ef8eb7-1966-443e-a8d2-898ac216e64a--scenarios--21--theme-content-parity--code-840-dark-2.png) | ![head cycle](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa--run-467729e7-2507-4847-bfe7-dec57479efb6--scenarios--21--theme-content-parity--code-840-dark-2.png) | [cycle observations](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa--run-467729e7-2507-4847-bfe7-dec57479efb6--scenarios--21--theme-content-parity--observations.json) |
| Actual minimum cycle `code-840-light-3.png` | ![parent cycle](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diagnosis-parent--lead--run-a1ef8eb7-1966-443e-a8d2-898ac216e64a--scenarios--21--theme-content-parity--code-840-light-3.png) | ![head cycle](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa--run-467729e7-2507-4847-bfe7-dec57479efb6--scenarios--21--theme-content-parity--code-840-light-3.png) | [cycle observations](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/qa--run-467729e7-2507-4847-bfe7-dec57479efb6--scenarios--21--theme-content-parity--observations.json) |
| Minimum toolbar: parent direct action / head opened overflow | ![parent toolbar](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/diagnosis-parent--lead--run-a1ef8eb7-1966-443e-a8d2-898ac216e64a--scenarios--21--git-overflow--toolbar-840.png) | ![overflow](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/measure-after--current-light-100-840-overflow.png) | [a-j measurements](https://github.com/kjg8619/Weavra/blob/hig-evidence/21/21/rules-a-j.md) |
| Panel: parent default / head keyboard focus | ![parent default](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/before--capture--1280x800--36_chat_code_blocks.png) | ![panel focus](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/measure-after--panel-keyboard.png) | [raw geometry](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/measure-after--observations.json) |

The cycle parent images use the unchanged-parent diagnostic bundle `0385a57b...`, source d81bc594. The ordinary paired corpus uses the fresh parent package hash above; these are distinct actual builds, not claimed byte-identical. Before states without overflow show that absence rather than a fabricated menu.

## Evidence-only QA recovery

Independent QA passed fresh product checks but found that writer cleanup had deleted the fixture directories required by packet verification. The packet has been regenerated at unchanged head `245a9efd`, using the same recorded parent/head packages and unchanged runner `82834bcf`. Both new acceptance rounds pass 7 checks / 265 assertions. After all owned applications exited, every referenced fixture directory and bundle was retained (4 manifests, 42 unique directories), and `--verify-packet pr-21` exited 0 again. No empty replacement directories or rewritten provenance were used. [Recovery report](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/packet-recovery.md) | [Retained paths](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/fixture-retention.json) | [Post-cleanup verifier output](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/logs--verify-packet-retained.log). Lead QA rerun remains pending; no lane completion is claimed.

## Verification

| Invoked gate | Exit / result |
|---|---|
| Owned-file check, including October 21 amendment; runner source identity | 0; five product files, exact merged runner |
| Scoped `vp fmt --check` and `vp lint` | 0 / 0; no new lint warnings |
| `pnpm --filter @t3tools/web typecheck` | 0 |
| `pnpm --filter @t3tools/desktop typecheck` | 0 |
| Focused web tests (four files) | 0; 262 passed |
| `vp test run src/window/DesktopWindow.test.ts` | 0; 34 passed, fresh/persisted minimum propagation |
| Fresh parent/head arm64 zip builds, signing/build-skip disabled | 0 / 0 |
| Final clean-head a-j measurement | 0; 1,821 rows, 46 PNGs, zero required failures |
| `capture_pr 21`: before / after / full image diff | 0 / 0 / 0; 152 records per side, 158 pairs |
| `accept_pr 21` round 01; `--verify-packet pr-21`; diff check | 0 / 0 / 0 |
| `accept_pr 21` round 02; `--verify-packet pr-21`; diff check | 0 / 0 / 0 |

Each acceptance round runs all 7 checks / 265 assertions on fresh isolated profiles with model requests 0, Runtime mutations 0 and blocked outbound 0. Self-measurement additionally proves zero automatic initialization and one explicitly selected `vcs.init` at the disposable fixture path. Both sidebar variants, light/dark, 100/150% text, minimum/1024/1280/1920/2560 and both sides of the measured 1076/1486 viewport breakpoints are covered. Label text-box/icon intersections are 0. Minimum visible label size is 14 px; computed text/icon/border/focus contrast minima are 4.859/3.267/4.705/4.261:1.

Exact focused web command, from `app/t3code/apps/web`:

```sh
pnpm exec vp test run --project unit src/components/chat/MessagesTimeline.test.tsx src/components/chat/MessagesTimeline.logic.test.ts src/components/GitActionsControl.logic.test.ts src/components/chat/ProviderStatusBanner.test.tsx
```

[Exact scoped commands](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/tools--checks.sh) | [Build command](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/tools--build-app.sh) | [Capture/accept commands](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/tools--capture-accept.sh) | [Gate exits](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/gate-results.json) | [Round 1 verdict](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/acceptance-verdict-01.json) | [Round 2 verdict](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/acceptance-verdict-02.json) | [Head provenance, fixture/capture hashes and actual dimensions](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/after--capture--capture-manifest.json) | [Every pair/hotspot inspection](https://github.com/kjg8619/Weavra/blob/hig-evidence/21/21/diff-inspection.md).

This is a synthetic projection on the real packaged Electron renderer, not real-model quality or company acceptance. The static `baselineFindings` list is retained harness history; current `product`, `closes` and executed checks are authoritative. The installed application and OS pointer were untouched; the existing single-evidence-app gate was used throughout.

## Residual findings

- Unsupported 390 + 150% text has 12 raw geometry/hit diagnostic findings across four contexts. They are preserved, not called passing; required native geometry and W-33 paint parity at 390 pass. No phone-support claim is made.
- Untouched sidebar footer wrapping at 150% is visible outside these controls; this PR claims no W-03/W-09 closure.
- 44 inherited scoped lint warnings remain versus 45 on the unchanged parent; none is new or suppressed. [Comparison](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/lint-comparison.json). Fresh large-file LSP requests timed out at 3 seconds; actual web/desktop typechecks passed.
- Per the approved October 19 amendment, the full universal-Q cross-product, 200% zoom, +40% copy, custom-theme, VoiceOver/IME and interrupted-motion matrix remains the Final wave. Full-repository CI/F1 is not claimed by these focused gates.

Model and harness: implementation/QA execution `chatgpt-subscription/gpt-6.1-sol`, high, in Senpi; one read-only exploration used `gpt-6-luna`. Shared HIG runner `82834bcf1be52aed98eef525696550077bf83df2`, Node 24.19.0, pnpm 11.10.0, Bun 1.4.0. Independent QA remains with the lead.
