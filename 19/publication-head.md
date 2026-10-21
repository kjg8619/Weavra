## Problem and change

Appearance mode cards and theme preview circles used the same accent-ring
language for selection and keyboard focus. Selection now uses a semantic tonal
wash and a check, while a separate outline follows the actual keyboard focus.
Light/dark assignment stays independent; the sun/moon meaning, System mode,
imported palettes and existing fonts are preserved.

The touched mode cards retain their rounded paint but have a transparent square
hit surface inside the padding box. This fixes corner misses without enlarging
the layout, overlapping another control or adding internal scroll overflow.
Touched labels are at least 14px and control boundaries use the existing
semantic foreground roles.

Tests exercise the real theme preference store, independent palette halves,
saved System mode through media events, and dismissal without persistence.
The test fixture publishes its captured hook snapshot after render, removing
the new globals warning without suppressing lint.

QA fix1 preserves whole Korean words in imported library theme titles using
keep-all and pretty wrapping. Escape on an open variant group restores its
actual mode opener before closing, consumes the dismissal and does not reopen
the group through that focus event. Closed options are disabled and hidden
from accessibility traversal, so Enter cannot activate the formerly focused
hidden option.

QA fix2 grows the variant preview group from 80px to 96px at normal text
scale (`h-20` to `h-24`). The 68px preview targets and 14px labels are
unchanged; the labels now sit below the circles and selected check badges.
The regression measurement includes non-interactive text: every text-node
rectangle in the variant name and `+1`, the whole label box, the preview
target box and the actual check badge. It exercises both selected halves
in all 12 viewport/text-scale/theme combinations.

Closes: W-26 only.

Base: `hig/18-provider-layout` at
`fb97140d6781ff14b680cd56eec95e31fb23841b`.
Head: `b4de3b5dbdf441925ac2c5d64b9276737af2f1b3`.
Head app.asar SHA-256:
`05a2a75650d7022953156ac03b69c139febbb7662a1bbe9ca370c506085e518f`.
Parent app.asar SHA-256:
`6a80bc979588694edbccbd75d4017d887c589f900b4b2fe488683f059f726b80`.

Dependencies: parent [#90](https://github.com/kjg8619/Weavra/pull/90),
foundations [#74](https://github.com/kjg8619/Weavra/pull/74) and
Appearance's shared settings predecessor [#89](https://github.com/kjg8619/Weavra/pull/89).
Shared runner
[`fa5e1dbc`](https://github.com/kjg8619/Weavra/commit/fa5e1dbcfb12fd51c5ac0d9dd0ca7a6e89f91c4a)
is integrated by a normal merge. This run uses those exact scripts from
the todo 19 worktree to avoid the moving shared hig-01 head. The shared
hig-01 worktree was not edited.
