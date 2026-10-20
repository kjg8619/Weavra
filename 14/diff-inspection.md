# Todo 14 diff inspection

Final parent b4077b9d / head ea0454ba: 152 capture records each and 158 matching PNG
pairs (the extra pairs include dual-capture diagnostics). All dimensions and alpha checks pass.
Machine pair results and every hotspot are retained in `diff/pairs.json`; no masks or
global similarity threshold were used to waive a difference.

Directly opened final before/after pairs:

- `1280x800/23_settings_integrations.png`: parent visibly truncates "Your default brow...";
  head shows the full Korean destination. The description's readable text, reset-space
  reservation and larger trigger account for the local row/following-content difference.
  Diff ratio 0.0237.
- `1920x1080/23_settings_integrations.png`: the same corrected closed selector and row
  geometry at the larger CSS viewport. Diff ratio 0.0409.
- `1280x800/29_settings_diagnostics.png`: the same metric labels/structure, with different
  live CPU, I/O and memory samples. No telemetry math changed. Ratio 0.0044.
- `1280x800/06_local_folder_picker.png`: the isolated temporary workspace path differs
  between independently created profiles; controls and folder content are unchanged.
  Ratio 0.0011.

Directly opened final self-measurement frames include:

- `840x620/light/150-system-focus.png`
- `840x620/dark/150-system-open-0-escape.png`
- `1920x1080/light/150-system-closed.png`

These show a complete selected value, unbroken Korean explanation, a visible distinct
focus ring, the popup's correct checked value and fitting bounds. Earlier iteration
frames were also opened to diagnose the ring and target corrections; they are not final proof.
The final measurement packet binds the final package hash and checks the whole explicit
a-j matrix, with 624 rows, 144 screenshots and zero failures.

Other nonzero pairs are retained as numerical findings, including small sidebar-age,
streaming and appearance differences. They were not all individually opened or classified.
No all-images/all-hotspots manual-review claim is made. That exhaustive audit remains in
the Final wave under the amendment; none of the opened frames is blank or missing content.
The pre-existing enlarged Settings chrome/breadcrumb compression is outside this task.
