# Todo 17 packaged self-measurement

Head: `c4e04c655ec393a0641dbafbfa204d9580b992bb`.
app.asar: `a105ea3eb3dbec59468fb7342aebc56a091943d0a4b5c7743d80c52b7cf2e26f`.
Receipt: `measure/qa-measure.json`; summary: `measure-summary.json`.
Fix1 script: `tools/measure-17-fix1.mjs`; log: `logs/measure-fix1.log`.
The original JSON is saved under `pr-17-fix1-measure/qa-measure.json`.

243 rows, 62 PNGs, failures 0. Light/dark; 840x620, 1280x800 and
1920x1080 CSS viewports; 100%/150% text. Actual packaged renderer, computed
RGBA, composited PNG background samples, five-point hit testing and native
window/content measurements. Both new-action and populated/restore states use
isolated profiles. The original installed app is not the captured build.

| Rule | Result and evidence |
|---|---|
| a | PASS: return target >=154.4609x36 CSS px, including pressed state; five-point hit misses 0; sibling overlaps 0. A single action group is added, so distinct-group separation is N/A. |
| b | PASS: touched explanatory text >=14px, normal weight. |
| c | PASS: text contrast >=4.78645:1 across the measured themes/states. No disabled, loading or danger return action exists; loading/error omit the successful-empty CTA. |
| d | PASS: keep-all/pretty; orphan final syllables and mid-word breaks 0. |
| e | PASS: 12 direct return activations preserve exact environment/conversation route and unsent draft; 24 Escape returns retain draft and restore composer focus. |
| f | PASS: all measured in-flow sections are inside the viewport; scroll origin 0; no horizontal overflow. No modal is introduced. |
| g | PASS: 12 Tab/Escape sequences close the existing topmost sidebar tooltip first, then leave Settings on the next Escape; exact context and composer focus return. The tooltip is identified by actual data-slot=tooltip-popup markup, not an absent role. |
| h | PASS fix1: button border 4.78645:1 light and 4.98894:1 dark at all three sizes and both text scales; solid 2px focus outline >=3.04339:1. The twelve-combination matrix is in measure-summary.json. The call site uses border-muted-foreground; the shared Button is unchanged. |
| i | PASS: measured required explanation/action text has no ellipsis or horizontal clipping. |
| j | PASS: unintended painted intersections with header/message/composer regions 0. |

The populated archive contains two actual archived disposable conversations.
Restoring baseline-code leaves the other archived conversation in place and
preserves its seeded greeting content. Native action-menu receipts identify the
actual archive command; no screenshot of the OS-owned menu itself is claimed.

The new button's computed transition properties are opacity/transform only.
Clock-stepped surface motion and the full universal Q cross-product remain
Final-wave coverage under the owner-approved amendment.

Counters: model 0, execution 0, externalNetwork 0. app.close completed before
the receipt was written. The launch log records each owned app and checks for
competing evidence apps; no competing app or installed app was closed.

Native minimum: 840x620. This display clamps native height to 949px for the
1920x1080 CSS viewport; no equal native-height claim is made.
The minimum/enlarged focus frame and dark empty/populated frames were directly
opened. See carry-forward.md for existing shared-sidebar and Final-wave limits.

Model: GPT-6.1-Sol. Harness: Senpi and shared HIG runner 94be65dc.
