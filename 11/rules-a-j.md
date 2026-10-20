# Final rule scope and measurement

Product source: 95efb02ebfc258c7b4c86bb1529f942a2251990a.
Packaged app.asar: 4b8a13ac1d8079aa3349c37c9f75d0b3029276c2509818dd354031cfc380bfbb.

All probes use synthetic task-owned profiles and the same final packaged app.
The a-f, cancellation, g-i and approved-j measurements complete before the final
before/after recapture. No product source changes follow this build.

## a-f

`measure/qa-measure.json`: 864 rows, 0 failures, 84 frames.
Light/dark x 840x620/1280x800/1920x1080 x 100%/150% text.
Text targets >=32px high, icon opener >=36x36px, distinct footer groups >=8px.
Five-point hit tests cover 204 control/state rows in the a-f probe and a further
24 edit-mode Delete/Save checks in the g-i probe.
Explanatory text >=14px, normal/medium weight. Minimum measured text contrast 4.6981:1.
Korean word-break/text-wrap checks pass; 36 Escape-return checks pass.
Rule f: 24 origin checks and 348 scroll-reachability checks pass.
Base UI aria-hidden/tabindex=-1 native checkbox proxies are classified nonvisual;
the visible role=switch controls are measured for reachability.

## g-i

`additional/qa-additional.json`: 300 rows, 0 failures, 24 frames.
24 Tab-then-Escape checks close the topmost popup/dialog and restore its opener.
180 edge/icon rows: minimum control perimeter 3.4541:1, minimum icon 4.7694:1.
60 required-label/cause checks have no ellipsis or horizontal text clipping.
12 edit-Cancel checks reopen the original saved command, not the discarded replacement.
The saved fixture is not executed.

The first h probe found genuine low-contrast control borders (roughly 1.17-2.08:1).
Commit 95efb02e uses existing foreground/destructive-foreground roles for neutral and
danger edges. Selection remains wash+check; a neutral border is not an accent selection
outline. Focus remains an independent ring. Product tests: 13 pass; fmt/lint/typecheck 0.

## j: explicit lead decision

The lead explicitly excluded intended overlap with an inactive page behind a proper
modal. A proper modal must have aria-modal OR role=dialog plus a backdrop, trapped focus
and inactive background. Non-modal UI added outside that owner remains subject to zero
intersection. This todo adds no standalone non-modal surface; the icon picker is a
child of the active editor modal.

`layers/qa-layers.json` retains raw geometry, role/attribute evidence, visible backdrop
bounds, background inactive-ancestor evidence and complete Tab/Shift-Tab traversal
samples. aria-modal is absent in this Base UI rendering; role=dialog is present.
The visible full-viewport backdrop, focus trap and inactive background are independently
checked rather than inferring modality from a screenshot.

`layers/verdict.json`: 24 modal/child geometry checks plus 12 full keyboard trap checks
pass. The dialog and its child popup stay completely inside the CSS viewport at all
three sizes and both text scales. Active UI intersections are exactly 0.
32 intended modal/background intersections are excluded and remain visible in raw data;
all 48 observed background header/composer targets have an inactive ancestor.
This profile is an empty project, so no message rows are rendered; a populated-message
matrix is not claimed. The approved exception is modal ownership, not a blank-image mask.

## Probe/capture limits retained

The unchanged narrow toolbar pointer opener was intercepted during the probe setup;
the supported keyboard opener was used. No toolbar-pointer PASS or unrelated fix is
claimed. Full universal Q, native VoiceOver and repo-wide CI gates belong to the Final
wave and are not claimed here.
Model, execution and external-network counters are 0 in all self-measurement probes.
