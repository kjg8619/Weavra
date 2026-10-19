# Web design contract

This document formalizes the rules the Weavra web client already follows. It extends the existing
component system; it does not redesign the application, replace the brand, add fonts or restyle
screens. Sections 1 to 5 and 8 carry the controlled-task setup UI contract forward unchanged in
meaning. Sections 6 and 7 define the layer and motion roles that shared primitives and feature
overlays reference.

## 1. Purpose and scope

- `src/index.css` is the only runtime token definition source: `:root`, the `.dark` variant blocks
  and `@theme inline`. Components reference roles; they do not restate values.
- Controlled-task setup extends the existing component system. New drafts default to Balanced; the
  Speed/Balanced/Quality choices show the concrete selected provider/model, and a user must
  intentionally change a preset. Existing YAML is never converted on mount; manual configuration and
  the exact CAS digest are preserved. Expert fields stay available through details.
- No new dev dependencies or app-wide performance tooling are introduced for contained behavior
  changes. Existing production build/type/test tools and real UI inspection remain the verification
  surfaces; no Lighthouse score is claimed.

## 2. Typography

- Use the existing text-sm/text-xs/font-medium roles and the font tokens declared in `index.css`
  (`--font-sans`, `--font-mono`, overridable from Settings -> Appearance). Do not introduce fonts.
- Touched explanatory labels are at least 14 CSS px at normal or medium weight. Korean copy wraps;
  ellipsis is reserved for optional identities, titles and paths that expose their full value.

## 3. Color and material

- Semantic utilities backed by `index.css`: background, foreground, muted, muted-foreground, card,
  popover, input, border, primary, destructive and the status roles (error, warning, success, info,
  update). Do not introduce new colors for a feature; extend the role set here first.
- Material roles, defined once in `index.css` with their dark values beside the light ones:
  - `--overlay-shade`: the dialog/sheet backdrop wash (`dialog-backdrop`).
  - `--overlay-dim`: the opaque media backdrop behind expanded images.
  - `--shadow-modal`: the `dialog-glass` modal shadow.
  - `--shadow-popup`: the popover, menu, select and combobox popup shadow.
  - `--inspector-shade`: the theme inspector spotlight dimmer.
  - `--preview-separator`, `--shadow-preview`: theme wireframe lines and island shadow. They are
    theme-neutral on purpose: a preview describes the previewed theme and must never resolve to the
    currently selected one. The wireframe's own fills remain the previewed theme's color parameters.
  - `--shadow-preview-glow`: the preview address bar loading glow.
  - `--annotation-background`, `--annotation-foreground`: the preview annotation layer's surface and
    text. `browser/annotationTheme.ts` keeps explicit fallbacks equal to the light token defaults for
    the moment CSS cannot be read.
  - `--app-scrollbar-thumb*`, `--terminal-*`, `--tool-error-icon`: existing roles; their literal
    values are the token definitions and are not consumer bypasses.
- Legitimate literals stay literal: token definitions, mask gradients (alpha ramps, not colors),
  theme preview color parameters and dynamic preview inputs.

## 4. Spacing and layout

- Reuse the setup card's space-y-3, gap-2, rounded-lg and grid primitives. Native select controls
  remain full-width on compact screens.
- No fixed overlays, absolute footers or new scroll owners for in-flow forms. One vertical scroll
  owner per pane; a modal alert does not scroll.
- Desktop targets: touched icon controls are at least 36x36 CSS px, text buttons 32 px tall, and
  distinct control groups keep 8 px of separation.

## 5. Primitives and states

- Existing Button: default/outline, hover, focus-visible, busy and disabled.
- Native labelled select: current, unavailable, manual and keyboard selection.
- Existing details/summary: collapsed expert configuration, keyboard reachable.
- Existing status/alert: read-only preparation, invalid data and save conflict.
- Authority and copy: model suggestions are candidates from available metadata, not proof of Runtime
  authentication. Selecting a preset is local editing, not account consent, config save, Git
  initialization or model execution. Unavailable choices are disabled and explained. Unknown results
  never appear as successful setup.
- Selection is a tonal wash plus check; keyboard focus is a separate visible ring. Disabled controls
  keep legible text and an adjacent reason.

## 6. Layers

Every portal and fixed surface maps to one role. Numeric values live only in `index.css`
(`--layer-*`); components use `z-(--layer-<role>)` and never a literal.

| Role                     | Value   | Scope                                                                                                           |
| ------------------------ | ------- | --------------------------------------------------------------------------------------------------------------- |
| content / raised-content | 0 / 1   | Local non-portal content and local status decoration.                                                           |
| sticky / selection-tools | 10 / 20 | App chrome (sidebar, title-bar controls) and message tools; no full-width error overlay.                        |
| passive-notice           | 30      | Toast viewport only: otherwise-invisible, user-requested nonmodal outcomes. Routine/error policy still applies. |
| modal-backdrop / modal   | 40 / 50 | Dialog, alert, sheet, command palette, expanded-image modal. One task modal at a time.                          |
| inspector band           | 52-55   | Theme inspector shade, outline and editor panel: above the modal it inspects, below that modal's popups.        |
| modal-child / tooltip    | 60 / 70 | Select, menu, popover and combobox popups belonging to the active surface, and tooltips.                        |
| blocking-system          | 80      | The quit-hold hint only.                                                                                        |

- Portal ownership and focus trapping stay with Base UI. A select inside a dialog is above that
  dialog; a background popover may not float above the active modal because the modal makes it inert.
- The toast viewport is one stacking context; a toast's per-index order is `--toast-stack-depth`
  minus its index, never 9999. No surface "raises until visible".
- Pane-local stacking contexts reuse the content tier by meaning: content/raised-content for in-pane
  content and decoration, sticky for pane chrome (docked composer, banner region, drag rows),
  selection-tools for message-area tools (selection toolbar, scroll-to-latest), passive-notice for
  transient pane feedback (file-drop target). Decorative art behind a control's own content uses the
  negative raised-content index inside that control's isolated context.

## 7. Motion

- Duration roles, defined once: `--motion-feedback` (120 ms) answers a press or hover;
  `--motion-surface` (180 ms) moves a popup, dialog, sheet, pill or notice. Under
  `prefers-reduced-motion: reduce` both drop to 80 ms and consumers remove spatial properties with
  `motion-reduce:` variants, keeping an opacity-only cue or the immediate state.
- Transitions list their properties. `transition-all` is not used. Shared surfaces animate opacity,
  scale and translate only; width, height, padding, shadow and blur snap, preserving selection and
  scroll.
- Panel animations (`data-panel-animations`) remain a user setting with its own duration; they are
  not covered by the surface role.

## 8. Accessibility and accepted debt

- Associate labels with controls, retain visible keyboard focus and truthful disabled states. Verify
  current setup/preset/consent/save states in light and dark at desktop and compact widths. Keep
  controls above the composer through the existing document flow.
- Text, code and placeholders measure at least 4.5:1 against the composited background; icons and
  focus indicators at least 3:1. Escape closes only the topmost transient surface and returns focus
  to its opener.
- Accepted debt, kept deliberately: the toast stack animates height while it expands (Base UI
  stacking); popover and tooltip popups animate width/height while Base UI switches nested views;
  the sidebar gap and the chat header animate layout under the user's panel-animation setting; the
  provider-status and thread-error banners still overlay the timeline until their delivery policy
  changes.
