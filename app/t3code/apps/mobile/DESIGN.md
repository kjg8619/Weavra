# Native recovery UI contract

This records existing mobile conventions for recovery/quarantine additions.
It is not a redesign, a new theme, or evidence of completed visual QA.

## 1. Atmosphere and identity

Keep the existing compact conversation interface. User content remains primary;
status explains what is known and the next explicit action. Uncertainty must
not look like successful delivery, confirmed refusal, or permission to resend.

## 2. Color

Use the active appearance palette, not literal colors. `global.css`,
`generated-uniwind-themes.css`, `mobileTheme.ts` and `mobileThemeVariables.ts`
remain authoritative, including user themes and Android Material You.

| Role               | Existing tokens                                                         |
| ------------------ | ----------------------------------------------------------------------- |
| Content            | `text-foreground`, `text-foreground-secondary`, `text-foreground-muted` |
| Status surface     | `bg-card-alt`, `border-border-subtle`                                   |
| Primary action     | `bg-primary`, `text-primary-foreground`                                 |
| Secondary action   | `bg-secondary`, `text-secondary-foreground`                             |
| Destructive action | `bg-danger`, `text-danger-foreground`                                   |
| Disabled action    | `bg-subtle-strong`, `text-foreground-muted`                             |
| Text action        | `text-primary-text`                                                     |

No new palette values or decorative status borders are required.

## 3. Typography

Use `AppText` and the existing DM Sans families from `global.css`.
Use `font-t3-medium` for compact labels, not a new font or weight family.
The existing class/role scale is:

| Class       | Role     | Default size / line height |
| ----------- | -------- | -------------------------- |
| `text-3xs`  | micro    | 11 / 14                    |
| `text-2xs`  | caption  | 12 / 16                    |
| `text-xs`   | label    | 13 / 17                    |
| `text-sm`   | footnote | 14 / 19                    |
| `text-base` | body     | 16 / 23                    |
| `text-lg`   | headline | 18 / 23                    |

Native style consumers use `useScaledTextRole`; preserve the user's base-font
preference. Source text, filenames and identifiers must wrap rather than be
silently shortened where the user is reviewing recovery content.

## 4. Spacing and layout

Reuse the status-row pattern in `WeavraTaskStatus`: `mx-4`, `mb-2`, `p-3`,
`gap-1` and `gap-2`, with `rounded-xl`. Existing MaterialButton touch targets
use a minimum height of 48. No new breakpoints or fixed screen widths.
The conversation feed owns timeline scrolling; composer keyboard/inset behavior
remains in ThreadDetailScreen. Recovery notices must not replace the composer
or introduce a competing fixed-height scroll area.

## 5. Components and states

- `AppText`: existing foreground/font defaults and native text scaling.
- `MaterialButton`: existing primary, secondary, danger and text tones.
  Default, pressed, disabled and loading behavior come from the platform
  implementation; Android uses its existing native progress indicator.
- `WeavraTaskStatus`: reference for compact read-only scoped status, not a
  new execution control or an authority source.
- `ComposerContextRecordDetails`: compact kind/label with an existing text-tone
  button; initially collapsed, explicitly expandable to selectable stored JSON
  at `text-sm`. No editing, remote fetch, truncation or new scroll owner.
  Expanded/collapsed native rendering remains subject to Device verification.
- Existing message/feed actions and sheets: reuse their placement, focus and
  dismissal conventions. New recovery controls must distinguish unavailable,
  ready, working, recovered, changed and uncertain outcomes.

Recover is explicit and does not send. A later explicit Send creates fresh
transport identities. Unassigned/unknown content stays visibly qualified and
must not appear as ordinary ready work or another account's active queue.

## 6. Motion and interaction

Reuse existing pressed opacity/native button feedback; add no decorative motion.
Disable duplicate activation while an operation owns its input. Return focus to
the composer only if the original route generation is still current.
Navigation must cancel stale publication without discarding uncertain ownership.
Loading/error labels describe observed outcomes, not guessed success.

## 7. Depth and surfaces

Reuse the existing mixed tonal/subtle-border treatment and pill action shape.
Do not add shadows, gradients, new radii or a branded illustration for this work.
Preserve iOS and Android platform implementations instead of forcing one
platform's native control geometry onto the other.

## 8. Accessibility and verification

Controls need native button roles, readable labels, disabled/busy state where
supported, and a stable focus target. Verify long text, CJK, larger text settings,
light/dark appearances, keyboard/insets and narrow-device wrapping.

The required acceptance surface is the supported Device panel and its returned
AgentDevice command. Web screenshots, synthetic image headers, unit tests and
host-filesystem tests are not native visual proof. Existing primitive states
and new composed recovery states still require current Device captures.
No new visual debt is accepted here; documented pre-existing code warnings are
not permission to waive accessibility or native verification.
