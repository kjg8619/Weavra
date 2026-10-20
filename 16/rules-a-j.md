# Todo 16 packaged self-measurement

Head: `878a9162cd8ce64b39c36531d772cdbd3885b658`.
app.asar: `6d70bf40832cc8495a559e315ccab214418dfb5444aa3281457fc6c5f917b549`.
Executed before the shared before/after capture pipeline. Receipt:
`measure/qa-measure.json`; script: `tools/measure-16.mjs`; log: `logs/measure.log`.

270 rows, 84 PNGs, zero failures. Light/dark; 840x620, 1280x800 and 1920x1080 CSS;
100%/150% text. Closed, hover, keyboard focus, open, first/repeated Escape,
Tab-then-Escape and scrolled guidance. The measure uses the actual packaged renderer,
computed colors and composited PNG backgrounds, not token-name contrast assumptions.

| Rule | Result and evidence |
|---|---|
| a | PASS: measured trigger >=158.5625x36px; five-point hit misses 0; sibling intersections 0. The header's distinct action groups use gap-2 (8px); no second new action group exists. |
| b | PASS: touched explanatory text >=14px, normal weight. |
| c | PASS: text contrast >=14.0248:1 across the measured themes/states. No new danger action or permission-disabled local draft exists. |
| d | PASS: keep-all + pretty; measured orphan final syllables and mid-word splits 0. |
| e | PASS: first/repeated Escape returns to the exact opener, including enlarged text. |
| f | PASS: measured modal is inside the viewport at scroll origin 0, with no upward or horizontal overflow. Existing form content remains scrollable at enlarged minimum size. |
| g | PASS: 12 Tab-then-Escape sequences; all 36 total close/focus-return observations succeeded. |
| h | PASS: boundary >=4.0481:1, icon >=4.5454:1, painted solid 2px focus outline >=8.0920:1. |
| i | PASS: measured required trigger/help/empty-state text has no ellipsis or horizontal clipping. |
| j | PASS: unintended painted header/message/composer intersections 0. The existing pairing dialog correctly blocks/inerts background content. |

The trigger's active transition properties are opacity/transform only. Full clock-stepped
start/mid/end/reduced/interrupted motion remains Final-wave work. The original package
at `d5a00e02` failed the focus/motion checks and is retained separately; it is not reused.

The local draft is always available: opening a form is not host access management.
Missing access:write, disconnected-host and unsupported-SSH combinations are covered
by operation-model unit tests, not fabricated disabled Add screenshots or a claim of
real remote pairing. Host management has separate existing authorization boundaries.
The shared acceptance scenarios exercise actual unavailable controls when present.

Counters: model 0, execution 0, externalNetwork 0. The owned app was closed before
the final measurement receipt was written. The launch gate waited for qa-15-run;
it never closed that session's app or the installed application.

Native minimum: 840x620. macOS clamps native maximum height on this display;
1920x1080 is a CSS viewport, not a claim of equal native outer height.
The implementer directly opened minimum/enlarged guidance, light focus and dark modal
frames. The complete universal Q cross-product and every-image/hotspot inspection,
200% zoom, +40% authored copy, native VoiceOver/IME and repo-wide CI remain Final-wave
work under the amendment. No independent reviewer approval is claimed.

Model: chatgpt-subscription/gpt-6.1-sol. Shared runner: 08e5df5d, unchanged.
