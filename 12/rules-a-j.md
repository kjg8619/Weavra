# Todo 12 packaged self-measurement

Head `d53d63196fc8a07e4c32aa42584d2f36a499bb17`.
Base `4d9a5cb579a201f278a59174d79b395d558c006c`.
app.asar `29ac0b0a8ca4bca409245dd3bdd7284dc96327bf518dc0726bdda8074fbe7959`.
Fresh synthetic profiles, light and dark, CSS viewports 840x620 / 1280x800 /
1920x1080, 100% and 150% text. The main matrix and the persisted-custom control
matrix both ran before the before/after capture pipeline.

`measure/qa-measure.json`: 5,172 rows, 288 PNGs, zero failures.
`additional/qa-additional.json`: 90 rows, 43 PNGs, zero failures.
`focus-pixels.json`: 12 direct composited focus-ring samples, zero failures.

| Rule | Result and actual evidence |
|---|---|
| a | PASS. All default shortcut and advanced-condition controls were measured, covering 61 bindings in 59 display groups. Text controls meet height >=32px and measured label width +20px. The persisted-custom menu meets >=36x36px. The Save button, including pressed and disabled states, was separately measured in all 12 combinations; its smallest pressed height is 34.92px. Five inset-point target ownership is recorded for each measured control. All 708 default group-gap observations are >=8px. |
| b | PASS. New explanatory text measures >=14px, at normal/medium weight. |
| c | PASS. Minimum measured text contrast is 6.2585:1 across default, hover, focus, pressed, disabled and invalid/danger text. Measurements use composited PNG background pixels, computed foreground RGBA and alpha composition. |
| d | PASS. Explanatory Korean uses keep-all and pretty wrapping; glyph-range line measurements show no mid-word split or isolated final syllable in the measured text across all combinations, including long custom-condition explanations. Raw code/identifiers are not translated. |
| e | PASS. 24 first/repeated Escape observations restore the exact advanced-condition opener. |
| f | PASS. 36 default/custom/invalid dialog geometry observations fit the viewport, start at scroll origin zero, keep their first content below that origin and have no horizontal content overflow. The raw editor is constrained by the dialog's content width, not a second viewport-width calculation. |
| g | PASS. All 12 Tab-then-Escape observations restore the opener. Tab/Shift-Tab handoff is awaited before inspection. |
| h | PASS. Minimum measured control-boundary contrast is 5.3046:1; icon contrast is 4.3918:1. Independent composited focus-stroke pixels measure >=4.1369:1 in all 12 combinations. |
| i | PASS. Required explanatory text has no ellipsis or horizontal clipping; advanced raw text remains selectable, exact and editable. The dialog's close action stays visible at 840x620/150%. |
| j | PASS. All 36 geometry records identify the real dialog and backdrop with inert background. All 144 sampled Tab/Shift-Tab destinations remain inside it after focus handoff. Background header intersections are retained in the raw JSON but excluded only as inactive modal background. The dialog itself fits. No new nonmodal surface overlays the composer, header or messages. |

## Semantics and actual invocation

All default bindings are retained and grouped only by command ID plus exact AST.
The unit suite round-trips every default AST and exhaustively compares resolver
results for nested not/and/or fixtures over all 256 context assignments. Builtin
identifier metadata completeness and inherited-name custom conditions are also covered. Existing
collision tests remain unchanged.

Both physical shortcuts (`Meta+N`, `Meta+Shift+O`) were consumed by the real
`chat.new` handler in the packaged app. Both resolved to the same existing empty draft,
consistent with draft reuse. The exact result IDs and consumed key events are recorded
in `additional/qa-additional.json`, not inferred from labels.
The persisted custom expression round-trips exactly:
`customModeActive && (!terminalFocus || isDesktop)`.
The literal-plus alias is observed as caps `["⌘", "+"]`, alongside the equals alias,
without changing the stored `mod++` input syntax. Structured shortcut parts are reused
for display and serialization; the UI no longer splits a literal key at its separator.

Main matrix counters: model 0, execution 0, external network 0.
The supplemental settings-only save invokes no model.

## Evidence interpretation and limits

- Focus-ring measurements use direct composited PNG pixels in `focus-pixels.json`.
  The invalid computed-color probe from the prior-base run was removed; its original
  output remains only in the archived prior-base packet. Text, boundary and icon
  measurements remain separate.
- Shared Base UI dialogs expose `role=dialog`, a real backdrop and inert background
  while `aria-modal` is null, exactly as recorded by PR 11. No attribute was invented.
- Intermediate failed builds/probes remain under descriptive local paths. The first
  parent build failed to download SPDX; the successful build reused the same pinned
  version's validated generated cache. No notices or license checks were bypassed.
- A simultaneous evidence-app launch was detected early in measurement. Only the
  task-12 app and its verified task-profile orphan server were closed; that interrupted
  run is not acceptance evidence. Subsequent launches use pre/post-launch ownership
  checks and close their own app after each run.
- The full universal Q matrix, 200% renderer zoom, +40% copy expansion, every
  consumer/state/motion sequence and native VoiceOver/IME traversal remain Final-wave
  work under the plan amendment. This packet does not claim those checks passed.
- Pre-existing Settings sidebar footer/breadcrumb compression at 840x620/150% is
  outside todo-12 ownership. Required keybinding explanations and actions are not
  shortened to disguise it.

Model: GPT gpt-6.1-sol (chatgpt-subscription). Shared runner: 08e5df5d,
unchanged by this task. No installed app or other HIG product branch was modified.
