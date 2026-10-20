# HIG 11 draft review

The lead authorized retaining local draft 0801baacb8d4630c657a7eb4870da7f918468b83
and normally merging origin/hig/10-evidence-entry e3f9546d257ae62a1f835e9a643086eb41fb7e1b.
Merge commit: 22b466154351c0095f789f99ae6f511cc23bb80b.
No reset, force push or other HIG branch edit was used.

Kept from the abandoned draft, after review:
- Trimmed command validation at the actual form submit boundary before onSubmit.
- Separate command error state, described-by/invalid/required semantics, invalid field focus.
- Correction clears only the command error; initial request resets that field error.
- Icon selection uses a wash and check instead of an accent selection outline.
- Five command validation/cancel regression cases alongside seven save lifecycle tests.

Changed after review:
- Korean required hint and inline corrective error, with keep-all and pretty wrapping.
- Explanatory text on the touched form is at least text-sm, with semantic foreground.
- Error uses destructive-foreground, not the lower-contrast destructive surface token.
- Icon choices use 14px text, padded targets and a separate keyboard focus outline.
- Icon popup finalFocus explicitly names its opener, including first open.
- Text actions retain at least 32px height and 12px horizontal padding; press does not shrink targets.
- Disabled explanatory labels retain full foreground opacity.
- Valid-command regression now proves surrounding whitespace is removed at persistence.

Owned product diff is limited to projectScriptEditor.tsx and projectScriptEditor.test.tsx.
Caller inspection: ProjectScriptsControl.submitScript routes only to add/update persistence;
ProjectActionsSettings uses useProjectScriptSettings.submit. Execution is a distinct onRunScript path.
The dialog has no execution callback. Packaged acceptance also checks invalid-submit persistence
and zero model calls; this does not claim that arbitrary saved shell commands were executed safely.

Existing lint finding: react(set-state-in-effect) in the pre-existing request hydration effect.
It was not suppressed or refactored. Targeted lint exit 0.

Lead amendment: runner case 11's saved-action accessible name was a pre-existing
harness defect, not a product regression. Authorized narrowly scoped runner correction
08e5df5d is pushed on hig/01; its 79 tests pass. Normal merge 341c68fc is pushed on hig/02.
The actual saved-action visibility assertion and the zero-model-call assertion remain.
The local self-measurement probe uses the actual Korean action opener and now includes
rule f: first item visible at scroll origin, all items scroll-reachable, with origin/end
captures at every size/theme/100%-150% text combination.

An additional draft gap was reproduced with a failing test: submitting the untouched
new form showed only Name's form-level error, leaving Command aria-invalid=false.
The corrected submit computes both errors independently before returning and focuses
Command when empty. It preserves the separate Name/form error and never reaches
onSubmit on either invalid field. The added test raises the focused set to 13 tests.

First packaged a-f pass found genuine press target shrink and translucent Save hover
contrast failures. The owned text buttons now override the shared active scale with
an important 100% scale; Save's hover/pressed background retains the opaque existing
primary role. Probe corrections: sample button background on its flat top centre
instead of the antialiased rounded corner; retry only transient UnknownVizError
captures with bounded settled-frame retries; classify Base UI's aria-hidden,
tabindex=-1 native checkbox proxies as nonvisual, while measuring the visible
role=switch separately for scroll reachability. Origin screenshots showed the first
real item fully visible at 840x620/150%; no speculative shared dialog change was made.

The bounded Electron subrect retry still rejected 1920 viewport pixels, while the
full renderer PNG was intact. Final contrast reads use a 1-CSS-pixel clip from that
same composited renderer PNG, decoded with the existing zero-dependency visual-QA
PNG decoder. No product edit was made for this probe repair. The final pre-capture
self-measurement passed 864 rows, 24 origins and 348 reachable items, with zero failures.
Explicit post-Cancel screenshots supplement the same unchanged packaged build.

Runner editor diagnostics cannot resolve the existing bun:test/bun:sqlite imports
at the repository root. No type package was added under this narrow authorization;
the actual Bun runner test execution passes all 79 tests. The web package typecheck
and product-file LSP diagnostics pass.

Later lead rules g-j were added before the final recapture. g/i passed; the first
h probe failed 120 perimeter checks. Commit 95efb02e strengthens only the owned
control boundaries using existing semantic roles. The final g-i probe passes 300
rows, including edit-mode Delete/Save and original-command preservation after Cancel.
The lead resolved j explicitly: intended overlap with the inactive page behind a
proper modal is excluded. The final probe records role=dialog, visible backdrop,
full Tab/Shift-Tab trapping, inactive background and fully in-viewport dialog bounds.
See rules-a-j.md for exact scoped results and the unclaimed checks.
