# Run disclosures

- The product commit changes two layout classes in RightPanelTabs.tsx only.
  No other product worktree or branch was edited.
- The first pipeline monitor used its default five-minute deadline while an
  evidence-app gate was waiting. The watcher timed out as the gate cleared;
  its owned Electron app remained running. A premature resume was stopped.
  Both command sessions were stopped, and the orphaned task-owned app was
  closed through the CDP endpoint belonging to its unique temporary profile.
  No other app and no installed Weavra app was closed. The final runs use an
  explicit one-hour monitor limit and a bounded gate before every launch.
- The initial 24-cell measurement passed all 228 row visibility tests and
  1,140 hit points. However, the added probe left the panel open. The following
  original locked-destination check clicks the panel toggle, so it closed the
  panel and failed. The failed receipt, images and JSON are retained under
  qa-attempt1-panel-left-open and measure-attempt1-panel-left-open. The probe
  now returns home and closes the panel before returning. No original
  assertion, scenario order, or product code was changed for this correction.
- The prior base build and before-capture packet at 0e4d2023 were reused,
  not rebuilt or re-captured by this fix. The cf50d036 packet is archived
  beside pr-09 as pr-09.prefix-cf50d036.
- The existing typography, contrast, button-size and Escape-focus fixes are
  unchanged in the product diff. The focused suite and original seven
  packaged scenarios are the regression checks for this increment; the
  older contrast and Escape measurements are labelled historical in the PR.
- An independent reviewer subagent was requested but the runtime refused it
  because this task is already at the maximum subagent nesting depth.
  The implementation and evidence are self-checked; no independent review
  is claimed.
