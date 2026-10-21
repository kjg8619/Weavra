# Todo 19 variant-label fix image inspection

Head b4de3b5dbdf441925ac2c5d64b9276737af2f1b3. Stack parent fb97140d;
defect baseline 14914ad. Runner fa5e1dbc is pinned from the writer worktree.

The product change is ThemeSettings.tsx:167, h-20 to h-24. Preview hit
targets, typography, Korean word breaking, popup behavior and selection
state are unchanged.

The new fixture compares 14914ad and the rebuilt head in 12 contexts:
840x620, 1280x800 and 1920x1080; 100/150% root text; light/dark. It imports
two variants for each appearance, selects both halves and measures every
text-node rectangle in the name and +1, the complete label box, the 68px
preview target and the actual check badge. All 12 image pairs have equal
viewport dimensions and intact alpha.

The normal-scale baseline paints the name/count under the preview and
badge; the head places them below both. The new label group is 96px at
100%, versus 80px before. The label box starts at the preview target's
bottom edge, with glyph ink lower still; both box and glyph intersection
areas are exactly zero. At 150%, the larger group preserves clearance.

The label-regression frame sheet and its before/after hotspot sheets show
the intended vertical movement, readable Beta +1 labels and retained
check/sun/moon badges. Surrounding card rows move when the browser centers
the taller target during scrollIntoViewIfNeeded. This explains changes
away from the variant card; it is not a theme, content or font change.
No new blank or black variant frame was observed.

The automated source-bound packet comparison, supplemental comparison and
12 label comparisons all exit 0. Fresh control geometry retains 182
five-point hit passes, strict fit, one scroll owner, minimum 14px text,
contrast and zero sibling overlap. Korean/focus regressions were rerun:
12 Korean and 24 Escape/Enter contexts pass with 147 checks and no failures.

review/index.json enumerates 814 frames and 4,494 hotspot crops rendered
into 84 sheets. These sheets are a navigable evidence index, not a claim
of a second independent QA or an exhaustive new visual sweep of unrelated
baseline surfaces. The targeted label frames and hotspot sheets are the
manual inspection for this one-line fix.

Full universal Q, 200% zoom, +40% authored copy, VoiceOver/IME and interrupted
motion remain Final-wave work under the approved amendment. The independent
QA's pre-existing theme-editor Escape finding remains outside this todo.
