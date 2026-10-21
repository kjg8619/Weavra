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

Closes: W-26 only.

Base: `hig/18-provider-layout` at
`fb97140d6781ff14b680cd56eec95e31fb23841b`.
Head: `0ae0238b299714d6b07e8514de7a981afeb77aef`.
Head app.asar SHA-256:
`d06fcfd595913ac826ff438b1636ee62204347a266f84c709a63bba0f7955b23`.
Parent app.asar SHA-256:
`6a80bc979588694edbccbd75d4017d887c589f900b4b2fe488683f059f726b80`.

Dependencies: parent [#90](https://github.com/kjg8619/Weavra/pull/90),
foundations [#74](https://github.com/kjg8619/Weavra/pull/74) and
Appearance's shared settings predecessor [#89](https://github.com/kjg8619/Weavra/pull/89).
Shared runner
[`fa5e1dbc`](https://github.com/kjg8619/Weavra/commit/fa5e1dbcfb12fd51c5ac0d9dd0ca7a6e89f91c4a)
is integrated by a normal merge. The shared hig-01 worktree was not edited.
