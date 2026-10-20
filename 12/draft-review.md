# Todo 12 draft review

The abandoned draft `8b38f2e0826a8f5f77f1cc5a7b409ec033b02021` was retained.
Normal merge `aa9db8280f0af9010ce09729828c10ea20e753fe` brought in stack parent
`origin/hig/11-action-validation` at `95efb02ebfc258c7b4c86bb1529f942a2251990a`.
No reset, rebase, force push, or other HIG product branch write was used.

The lead subsequently advanced the parent to `4d9a5cb579a201f278a59174d79b395d558c006c`.
Normal merge `d664491989c76aeff1bd53a25ab3fe3f0ea563fc` preserves those updates and
all todo-12 changes without conflict. The previous base's captures and receipts are
archived under `prior-base-95efb02e`; they are not the published acceptance evidence.
The refreshed head passed 358 focused tests, formatting, lint and web typecheck before
both parent/head packages were rebuilt and the entire measurement/capture/acceptance
sequence was repeated.

The final inventory review found the builtin `previewFocus` explanation was missing.
Commit `6b3fb532f91ac691976869ab3574258df8837b77` adds complete builtin metadata,
including the actual preview focus/open flags, and a metadata-key completeness test
derived from the real default bindings. Unknown inherited object names remain custom
and renderable. Nested browser-condition evaluation is covered without pinning prose.
The same commit uses semantic foreground for shortcut glyphs after a fresh dark
measurement found 4.28:1. That 364-test suite and packaged measurements passed.
Those superseded artifacts remain under `prior-head-6b3fb532`; the published final
head is the literal-key correction described next.

Final inventory screenshots also exposed the old literal-plus display bug: `mod++`
was split into empty key caps. Commit `d53d63196fc8a07e4c32aa42584d2f36a499bb17`
keeps the shortcut structured for display, reusing the same token builder for unchanged
serialization. Two machine-token regression cases preserve `mod++` and `+`; the final
366-test suite passes. A fresh packaged DOM assertion and screenshot show the real
plus cap. The final package, complete measurements, captures and both acceptance rounds
were regenerated after this last source edit.

## Retained

- Rendering the explanation recursively from the existing `KeybindingWhenNode`.
- Keeping display concerns in the three todo-12 owner files.
- All existing resolver, default bindings, collision checks and persistence boundaries.

## Corrected

- The draft dropped grouping when combining negation, conjunction and disjunction.
  Each explanatory subtree now retains parentheses and negation wraps its entire operand.
- The default `modelPickerOpen` identifier now has an explicit explanation. Unknown variables
  are labelled as custom conditions rather than assigned an invented meaning.
- Raw predicates no longer appear beside ordinary condition prose. An adjacent advanced
  disclosure exposes the selectable expression and the existing parser-backed editing boundary.
- Same-command, same-AST aliases share one display group, retaining every independently
  editable shortcut. Distinct command IDs and distinct applicability remain separate.
- The draft's 12px, opacity-reduced explanation is replaced by semantic foreground,
  at least 14px text, Korean keep-all and pretty wrapping.
- Added default inventory/group preservation, custom-condition editability and exhaustive
  resolver-equivalence checks for nested AST fixtures. Existing collision tests are unchanged.
- Packaged measurement found that Tab could leave the old nonmodal disclosure before Escape,
  and long conditions clipped the close action at 840x620 with 150% text. Advanced conditions
  now use the existing bounded dialog primitive, with a labelled close action, background
  inertness and one scroll origin. No shared primitive was edited.
- The actual unsaved Save button and persisted-custom action menu measured 28px. They now
  opt into the task's required text/icon target geometry without changing their callbacks.
- A 2px content-width overflow seen in the modal was corrected at its raw-editor child.

## Measurement corrections, not product assertions

Earlier local probes sampled the rounded border's antialias pixels as a text background and,
on a focused button, sampled its blue ring as the surrounding material. Final probes sample
clear interior padding and material beyond the ring, and separately measure the focus ring.
They also await Base UI's focus handoff after each Tab, as PR 11's tool does. The original
probe reports are retained under their descriptive directories; their failures were not edited.
The refreshed run removes the non-inheriting computed-ring probe altogether and measures
focus strokes directly from its fresh PNGs.
PR 11's packaged modal evidence records `role=dialog`, `aria-modal=null`, a real backdrop and
inert background. The final task-12 classifier uses that same observed contract rather than
inventing a requirement for an attribute the shared primitive does not emit.

The abandoned commit's message claimed acceptance; those historical claims are not reused.
Fresh package hashes, measurements and acceptance receipts in this packet are the only current
validation evidence. Only the three plan-owned product files differ from the stack parent.
