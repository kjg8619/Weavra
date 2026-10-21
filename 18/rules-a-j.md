# Todo 18 self-measurement

Fresh packaged renderer measurements precede the shared capture run.
Source and app hashes are in measure-summary.json and each measurement receipt.
The app uses a task-owned HOME, workspace and app profile. No installed app was
changed or closed.

| Rule | Measured result |
|---|---|
| a | PASS: model icon targets >=36x36 CSS px, text actions >=32px high with label width +20px. 216 size checks, 192 enabled five-point hit checks and 240 pairwise overlap checks pass. Add/Cancel use the existing 8px gap. Disabled arrows remain legible and cannot activate. |
| b | PASS: touched model explanation/label text >=14px, normal/medium weight. |
| c | PASS: 372 text/input observations >=4.78318:1, including the validation state. Computed RGBA is composited through ancestor backgrounds and opacity. |
| d | PASS: 432 observed nodes have no orphan Korean final syllable; the Korean hint uses keep-all/pretty. |
| e | PASS: validation saves nothing, correction saves the intended custom model, and both add/edit cancellation preserve the selected provider route in 12 matrix contexts. The separate focused tests verify exact 256-character ID preservation. |
| f | PASS: 12 contexts show exactly one overflowing vertical ancestor, with model label/input/Add/Cancel simultaneously inside that scrollport. No horizontal primary-page overflow. No modal is introduced. |
| g | PASS: 12 keyboard Tab sequences show the Add focus treatment; Escape cancels inline add/edit without leaving the provider route. No selector or provider authentication is activated. |
| h | PASS: all observed model glyphs >=4.39184:1. Keyboard button focus has a solid 2px outline, >=14.31890:1; it is separate from favorite selection. |
| i | PASS: 12 provider-list summaries are complete, unclamped and non-ellipsized. 372 required text/input observations have no required-text ellipsis or horizontal clipping. Input content itself uses normal single-line field scrolling. |
| j | PASS: 240 visible sibling-control comparisons have intersection area 0. The in-flow form stays inside its measured pane, below the existing settings header. |

Matrix: light/dark, 840x620 / 1280x800 / 1920x1080 CSS viewports, 100%/150%
text, focus/hover/pressed/validation/success/cancel and edited-form frames.
Head measurement: 2,749 rows, 120 PNGs, zero failures. Parent: 42 PNGs.
Native bounds/minimum/content rectangles are attached to every screenshot;
840x620 is the native minimum, and display clamping at the largest native
height is recorded rather than equated with CSS viewport size.

Model, execution and external-network counters are zero. Both owned evidence
apps completed app.close. The launcher checks ps twice before launch and again
after launch, waits at most 600 seconds, and never closes a competing app.

These are the direct self-audit results, not a substitute for shared acceptance.
Both fresh strict shared acceptance rounds now pass 6/6, with acceptance and
packet verification exit 0 twice; see acceptance-status.json and the official
acceptance-verdict.json. The earlier 0.0625px native-resize boundary finding is
preserved under previous-04ea3369-form-focus; this head adds token-based scroll
margin to both the form reveal target and the actual focused input.

The full universal Q matrix, all six adapter behavior combinations, 200% zoom,
+40% authored copy, complete AX/VoiceOver/IME and interrupted motion sequences
remain Final-wave coverage under the owner's October 19 amendment. This packet
does not claim those unexecuted checks passed. Shared Settings breadcrumb/footer
crowding at minimum/150% remains outside todo 18; the model form itself fits.
