# Todo 18 final capture inspection

Source: fb97140d6781ff14b680cd56eec95e31fb23841b.
Parent: c4e04c655ec393a0641dbafbfa204d9580b992bb.
App: 9e66e7ef7014b1412ff30a6da7505884fc9e1aa49cbfff6d21392bb5e14fd69b.

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

Strict acceptance now passes twice with runner 6aa04ecc. The author opened the
fresh provider-raw-diagnostic PNG: the intended diagnostic button is focused and
expanded, the complete synthetic diagnostic is visible, and the unrelated
breadcrumb menu stays closed. Actual Electron AX trees, action logs and both
6/6 PASS receipts are published. The earlier selector failure remains historical
evidence, not a current blocker.
