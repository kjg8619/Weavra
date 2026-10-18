# Controlled-task setup UI contract

This change extends the existing Weavra component system. It does not redesign the application.

## 1. Existing tokens and type

Use semantic utilities backed by `src/index.css`: background, foreground, muted, muted-foreground, card, input, border, primary and destructive. Use existing text-sm/text-xs/font-medium roles. Do not introduce new colors, fonts or motion.

## 2. Geometry

Reuse the setup card's space-y-3, gap-2, rounded-lg and grid primitives. Native select controls remain full-width on compact screens. No fixed overlays, absolute footer or new scroll owner.

## 3. Setup behavior

New drafts default to Balanced. Show Speed/Balanced/Quality choices with the concrete selected provider/model. A user must intentionally change a preset. Existing YAML is never converted on mount; preserve manual configuration and exact CAS digest. Expert fields stay available through details.

## 4. Authority and copy

Model suggestions are candidates from available metadata, not proof of Runtime authentication. Selecting a preset is local editing, not account consent, config save, Git initialization or model execution. Unavailable choices are disabled and explained. Unknown results never appear as successful setup.

## 5. Reused primitives and states

- Existing Button: default/outline, hover, focus-visible, busy and disabled.
- Native labelled select: current, unavailable, manual and keyboard selection.
- Existing details/summary: collapsed expert configuration, keyboard reachable.
- Existing status/alert: read-only preparation, invalid data and save conflict.

## 6. Accessibility and verification

Associate labels with controls, retain visible keyboard focus and truthful disabled states. Verify current setup/preset/consent/save states in light and dark at desktop and compact widths. Keep controls above the composer through the existing document flow.

## 7. Accepted scope

No new dev dependencies or app-wide performance tooling is introduced for this contained behavior change. Existing production build/type/test tools and real UI inspection remain the verification surfaces; no Lighthouse score is claimed.
