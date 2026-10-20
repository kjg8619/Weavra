# Todo 13 packaged self-measurement

Revision: b4077b9d4c13004fb891b15dc5388022209c1c8a.
app.asar: e5e0eed9a75b0caf9a4fb0716a4cd56f5316c12f81f29faf69774fe112a9f892.
Tool: tools/measure-13.mjs, run before the capture pipeline.
Receipt: measure/qa-measure.json. 1,484 rows, 156 PNGs, zero failures.

The full measurement matrix is light/dark x 840x620, 1280x800, 1920x1080 CSS viewport x
100%/150% root text. Each combination covers OFF, unavailable, synthetic ON, top/end,
all settings rows, sound-menu first/repeated opens, hover/focus, and first-use setup.
The actual native bounds, content bounds and minimum are recorded separately; macOS clamps
the 1920x1080 outer window to the available display while the renderer viewport is 1920x1080.
The 840x620 native minimum is retained.

| Rule | Verdict | Fresh evidence |
|---|---|---|
| a | PASS | Text controls >=32px and measured label+20px, icon/switch targets >=36x36px; five-point target ownership; zero sibling-control overlaps; successive setting control groups >=50.296875px apart. Sound-choice/preview groups use the measured 8px gap. |
| b | PASS | All measured explanatory headings, descriptions and statuses >=14px; normal/medium weight. |
| c | PASS | Lowest measured text contrast 12.380747:1 against composited padding backgrounds, including hover, focus and unavailable states. There is no new danger control/state in this copy change. |
| d | PASS | New Korean text is keep-all + pretty; no measured mid-word split or isolated final syllable across the matrix. |
| e | PASS | 36 first/repeated Escape observations return focus to the exact sound-menu or setup opener. |
| f | PASS | 132 geometry observations; all transient surfaces fit their viewport, start at scroll origin zero and do not overflow above it; no horizontal overflow. In-flow settings retain their existing scroll owner. |
| g | PASS | 24 Tab-then-Escape observations return focus to the opener. Sound-menu Tab/Shift-Tab now moves among its choices and preview actions without dismissing Settings. |
| h | PASS | Lowest measured switch/icon boundary 4.560858:1; icon 3.831864:1; focus indicator 14.024825:1. Focus strokes are >=2px (sound trigger uses 3px); menu items use a separate inset focus outline. |
| i | PASS | No measured required explanation/action/selected sound label ellipsizes or overflows. |
| j | PASS | Painted non-modal settings/menu rectangles have zero intersection with the header/messages/composer. First-use setup has the existing real dialog/backdrop/inert ownership; its dialog fits. Inert background intersections are recorded and excluded only under the modal exception. |

Synthetic IPC intercepts supply presentation-only ready/unavailable/first-use capture states and
keep preference writes in memory. Opening Settings and the first-use dialog invokes zero
permission/setup/config-write IPC operations. No OS capture permission was granted or requested.
Model, execution and external network counters are all zero. Every launched app was closed by
its own finally block; the installed app and other runs' apps were not touched.

Early measurements are retained under measure-639b7b4f and measure-716b662b. The latter
also exposed measurement-tool errors: padding samples hit rounded corners/focus strokes, the
2px-only ring parser rejected a valid 3px stroke, and unclipped scroll-content rectangles were
mistaken for painted overlap. These were corrected in this task-owned tool without changing
thresholds or the shared runner. Enlarged rounded targets also received a full rectangular hit
surface after the actual 150% hit-test failure.

Limits: ON/permission states are explicitly synthetic, not proof of OS capture or permission
granting. Full universal Q, 200% zoom, +40% copy, all adapters/clients, native VoiceOver/IME,
all-state motion and repository-wide CI remain Final-wave checks under the plan amendment.
No claim is made that every untouched settings/sidebar label meets the final contract.
The pre-existing Settings sidebar/footer/breadcrumb compression at 840x620/150% remains outside
the two owner files. Pure prose has no new prose-pinning test; the 73 existing focused behavior
tests and the fresh packaged measurements are the regression evidence.
