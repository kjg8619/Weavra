# Todo 21 final rules a-j

Head 245a9efdfee4e949a5d312798bcdbf31ed0c1675; runner 82834bcf. Actual clean packaged head; measurement is diagnostic:false and its app.asar equals the official capture. 1,821 rows, 46 PNGs, zero required failures.

Coverage: current and Legacy sidebars, light/dark, 100/150% text, 840x620, 1024, 1280, 1920 and 2560 CSS widths, plus breakpoint minus 1 / exact / plus 1. Observed breakpoint viewport widths are 1076 at 100% and 1486 at 150%; each side was measured. Native bounds and CSS viewport are recorded separately.

| Rule | Executed required result |
|---|---|
| a | PASS: 164 touched target observations, all >= 36 x 36 CSS px; 163 five-point checks / 815 points pass. The one disabled observation is not falsely hit-tested as interactive. |
| b | PASS: 48 visible label observations, minimum 14 px. Deliberately clipped 1px accessibility-only spans are recorded separately, not treated as painted labels. |
| c | PASS: minimum computed/composited text contrast 4.85907:1, including ancestor opacity. |
| d | PASS: no isolated final Korean syllable in touched label lines. This is not a whole-app locale closure. |
| e | PASS: draft/context retained, no automatic vcs.init, exactly one explicitly activated init targets the disposable fixture directory. Disabled ink is distinct while legible; the existing publish entry appears once. Both official receipts have model 0, Runtime mutations 0, blocked outbound 0. |
| f | PASS: required controls inside viewport, zero primary-page horizontal overflow, at most one overflowing vertical transcript owner. Code regions may retain independent horizontal scrolling. |
| g | PASS: focus survives both breakpoint directions; an open overflow closes on wide resize and returns focus to the direct action; Escape returns to the opener. Panel activation restores its own state without initializing Git. |
| h | PASS: computed icon contrast >= 3.26674:1, visible border >= 4.70527:1, focused ring >= 4.26062:1; settled ring spread 3 px with a 1 px offset gives a 2 px ring. 65 required focus observations pass. Ghost controls have no fabricated border requirement. |
| i | PASS: no required visible label clipping or ellipsis in the measured controls. |
| j | PASS: required sibling hit-area intersections and each touched label text box versus its icon shape are exactly 0. Adjacent terminal geometry is included in overlap checks without claiming it as a newly changed target. |

## Explicit stress findings and limits

390x844 is below the native minimum. At 390 + 150% there are 4 failed Git-target hit checks and 8 sibling overlaps across the two themes/two sidebars: 12 raw diagnostic findings retained in stressFindings and raw rows. They are not deleted or called passing. W-34 closes only on supported native dimensions/enforcement; W-33 content/paint parity at 390 remains mandatory and passes. No phone-support claim is made. At 390 + 100% the toolbar also reflows without overlap.

Untouched sidebar footer wrapping at 150% is visible outside these controls; no W-03/W-09 closure is claimed. The full universal-Q cross-product, 200% zoom, +40% copy, custom themes, VoiceOver/IME and interrupted motion remain Final-wave work under the approved October 19 amendment. No new animation mechanism was added; layout changes snap.

[Raw observations](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/measure-after--observations.json) | [Summary](https://raw.githubusercontent.com/kjg8619/Weavra/refs/heads/hig-evidence/21/21/measure-after--summary.json)
