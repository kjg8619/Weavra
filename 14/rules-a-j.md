# Todo 14 packaged self-measurement

Source: ea0454badeeadcbda6b210ca22b1402acdd49ed1, clean tracked diff.
app.asar: a0666e14491077a2f8eca990bd2da2ba37ac9d8db33781c557d35c4cb4ad9f7c.
Executed before before/after capture, using `tools/measure-14.mjs` through the
single-app prelaunch gate. Receipt: `measure/qa-measure.json`; log: `logs/measure.log`.
624 measurement rows, 144 frames, zero failures. Both supported destinations, light/dark,
840x620, 1280x800, 1920x1080 CSS viewports, 100% and 150% root text size.

| Rule | Result |
|---|---|
| a | PASS: text targets >=36px high, label padding >=105.5529px; reset icon >=36x36px; distinct control group separation >=56.59375px; five-point hit failures 0, sibling intersections 0. |
| b | PASS: touched explanatory text >=14px, normal weight. |
| c | PASS: measured text contrast >=14.059789:1, including hover/focus and popup choices. No danger action is added. |
| d | PASS: touched Korean explanation uses keep-all + pretty; no measured mid-word split or orphan final syllable. |
| e | PASS: 60 first/repeated Escape observations return focus to the exact opener. |
| f | PASS: 144 geometry rows; popup fits at scroll origin zero and does not overflow above it; no measured horizontal overflow. |
| g | PASS: 24 Tab-then-Escape observations return focus to the opener. |
| h | PASS: measured control boundary >=4.082896:1, icon >=3.934676:1, focus >=14.024825:1 with >=2px indicators. |
| i | PASS: required explanations, trigger destination and options are complete; no measured ellipsis or label clipping. An icon button's unused computed text-overflow property is not painted label truncation. |
| j | PASS: measured non-modal painted header/message/composer intersections 0. There is no new modal in this change. |

The UI contract supports exactly `system` and `app`, not custom destination IDs.
The longest supported destination is exercised without navigating away or changing it merely
to read it. Packaged acceptance additionally checks focus/open/Escape selection preservation
and persistence across reload. The existing update-only unit regression is retained.

Applicable states: both selected destinations, closed, hover, keyboard focus, popup checked item,
first/repeated Escape and Tab/Escape. The packaged selector has no loading/error/success/danger
variant or unavailable destination. Desktop-local preferences are unavailable on the web client;
this change does not alter that boundary or assert a new disabled-web-client contrast result.

The native minimum was measured at 840x620. macOS clamps the largest native window to
1920x949 on this display; 1920x1080 is the recorded CSS viewport, not an assertion that
an outer native window of that height was displayed.

Earlier SHA-suffixed packets are failed/superseded evidence, retained rather than overwritten.
Only the unsuffixed final packet is used for publication and acceptance.
No real profile, installed app, OS permission, external model, execution or external-network
operation was used. The three recorded counters are zero.

Limits: full universal Q, +40% authored-copy expansion, 200% renderer zoom, all-consumer/provider
coverage, native VoiceOver/IME, every-image/every-hotspot manual inspection and repo-wide CI
are not claimed here; the plan amendment reserves those for the Final wave.
Final representative screenshots were opened directly by the parent. A separate gate-review
spawn was refused by the runtime's subagent nesting limit; no independent approval is claimed.
