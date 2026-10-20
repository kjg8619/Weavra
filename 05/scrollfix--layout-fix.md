# PR 79: reachable first-request suggestions

The draft hero previously centered only the composer (`flex items-center`). Its headline and first-request suggestions were absolutely positioned at `bottom-full` above the composer. Their height did not participate in layout. Once enlarged text made that group taller than the space above the composer, its top crossed the scroll origin; `scrollIntoView` could not recover the negative overflow. The prior packaged QA measured the suggestion section at y=-58.5 at 840x620 with 150% text.

`ChatView.tsx` now gives the draft overlay vertical scroll ownership (`min-h-0 overflow-y-auto`). The headline/suggestions and composer are in a three-row grid: `minmax(min-content,1fr) auto minmax(0,1fr)`. When the upper content fits, equal flexible rows keep the composer at its original center. When it does not, the first row cannot shrink below its content; the composer moves down, and the positive overflow remains reachable by scrolling. The first-request title/reason/note classes, button dimensions, colour tokens, text, and insertion logic are unchanged.

Product commit: `ea54d52aa5762ce67309d74dcb02ef220fcdb9e2`. Only `app/t3code/apps/web/src/components/ChatView.tsx` changed (8 additions, 4 deletions). Normal push to `hig/05-first-request` succeeded.

The focused suite passed all 309 tests in 3 files. Targeted format, lint, and web typecheck exited 0. Lint retains the existing `set-state-in-effect` warnings on untouched lines; typecheck retains existing Effect suggestions. LSP reported no errors in the changed file.

Pipeline 6 is copied from pipeline 5, not an edit of it. The isolated runner is copied from runner `7ecfbc1f`; its only pipeline-runner change is a bounded double process check immediately before each Electron launch, including the second capture size. Assertions are unchanged. The separate measurement runner adds `qa-ui2` without removing the six stock case-05 checks.

The measurement script is `measure-runner/scripts/hig/qa-ui2.mjs`, adapted from the QA check in `qa-05-run/tools/qa-ui2.txt`. It enumerates all 24 combinations: 840x620, 1280x800, 1920x1080; root text 100%, 150%; light, dark; empty editor, unsent draft with the three-way choice open. It records section/header/composer bounds after `scrollIntoView`, scroll endpoints, all five hit points on each card/choice, and per-character word-break analysis for every title, reason and scope note.

For fitted-layout preservation it temporarily restores the four old layout declarations in the same packaged renderer, measures the old and new geometry, then restores every inline style. Separate SHA-256 comparisons bind eight unchanged 1280/1920 screenshots to the previous packaged build of e63c4659. The old-style toggle is observation-only and is never written into the product.
