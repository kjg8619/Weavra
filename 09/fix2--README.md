# PR 81 QA-09 fix 2

Product source: `hig/09-dock-and-files`, de4f90da2065bd78c8bd89cfdff8390eea702c20.
Only product edit: `RightPanelTabs.tsx`, `items-center` to `items-start`,
and `my-auto` on the existing width-limited wrapper.

## Measurement

`sheet-probe.mjs` derives from `qa-09-run/tools/qa-case-09.js`, `09/qa-sheet`.
It executes inside the existing packaged-app fixture, not a cloned component.
Matrix: draft and started thread, light and dark, 840x620, 1280x800,
1920x1080, 100% and 150% root text = 24 cells. For each cell it records
scroll origin, all row rectangles, five actual DOM hit points per row after
scrolling it into view (centre and four 10%-inset corners), and a scrolled-end frame. It asserts that the first
row is fully visible at scrollTop 0, every row is fully visible and passes
all five hits, and the matrix has 24 cells.

When the wrapper fits, the probe temporarily applies the original centring
to the same DOM, compares all four rectangle components, then restores it.
All saved screenshots use the actual product classes. This isolates the
layout change from fixture text, theme and session variations.

`measure/sheet.json` is saved after each cell, before its assertions.
`analyze.mjs` independently checks all cells and writes `summary.json`.
The runner captures its two original fixture windows and executes scenarios
in the second window; the probe resizes that real window through all 24 cells.

## Runner and app lifecycle

`runner/scripts` is a private copy of QA's archived e6fbc82c runner.
The seven original case-09 checks are unchanged; one `fix2-sheet` check is
added only in this measurement copy. Production acceptance uses the separate
`pr-09-fix2-runner` copy with all seven original checks unchanged.

Both copies add a bounded 30-minute ps gate immediately before every
`_electron.launch`, rechecking immediately before launch. No other app is
killed or manipulated. The runner closes its own Electron handle and waits
for the captured child's exit event after each run. The live installation
at `~/Applications/Weavra.app` is never used.

Pipeline: `../pr-09/pipeline-fix2.sh`, log `../pr-09/pipeline-fix2.log`.
Focused test, fmt, lint and typecheck logs are under `logs/`.
