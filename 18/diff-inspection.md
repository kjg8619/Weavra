# Todo 18 final capture inspection

Source: 16955bb57c8c4611823d39e0fa3bf6960beb429e.
Parent: c4e04c655ec393a0641dbafbfa204d9580b992bb.
App: 84de85e7bd26789da889425241e1b278183ea9b342313c09a7fdbf0a5b781f1c.

Both actual packaged capture runs exit 0 with 152 records each. The shared diff
has 158 matching PNG pairs and zero failures. The supplemental model-form diff
has 42 matching pairs. Every matching pair has equal dimensions and intact alpha.
No broad image masks or arbitrary similarity cutoff are used.

Expected changed areas are the provider list/editor columns, unclamped structured
status, diagnostic disclosure, natural-height model list, readable model rows,
model form/action geometry and focus scroll positions. The small minimum-window
focus overshoot is a reproduced before failure with the identical strict
case passing twice after the scroll-margin fix.

The author directly opened parent/head provider lists, minimum new/invalid/edited
forms, dark 150% form, and the final minimum-window new form. Labels and both
decisions are visible together; no blank frame was accepted as a valid form.
The complete per-pair numerical results and every hotspot are retained in the
linked JSON. Exhaustive manual review of every image/hotspot and full Q cross
product are Final-wave checks under the October 19 amendment, not claimed here.

Head-only interaction frames are explicitly after-state self-measurements, not
fabricated baseline references. The baseline has inline diagnostics rather than
the new labelled diagnostic disclosure. Original installed-audit pixels are not
claimed to be source-built c4e04c65 evidence.

Strict acceptance remains blocked: the raw-diagnostic helper opens the global
All environments breadcrumb and retargets its expanded-state locator. The final
raw-diagnostic failure screenshot, actual Electron AX tree and action log are
published alongside both actual receipts. No PR or product PASS is claimed.
