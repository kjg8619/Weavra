## Problem and change

Status: blocked by the shared runner's disclosure selector. No PR is open and
no completed W closure is claimed. This local body is prepared for publication
after the hig-01 owner repairs the strict acceptance scenario.

Provider rows used to truncate a detailed CLI failure into the status sentence.
They now show the complete structured status headline, while a labelled,
keyboard-operable disclosure retains the exact diagnostic and recovery text.
Authentication and provider readiness are not rewritten.
The selection button contains the visible identity/status rather than an empty
absolute overlay; the optional update action remains a separate sibling control.

The provider list and editor now share normal document flow under the existing
Settings page scroll owner. Fixed card heights, nested vertical ScrollAreas and
the inner model-list scroller are removed. Wide panes use sibling columns;
compact panes stack. Opening/focusing/resizing a model form reveals its label,
input and decisions together without a fixed footer. Inline validation growth
uses a ResizeObserver and preserves the selected provider and unsaved model ID.
Model ordering, favorites, visibility and explicit save/cancel behavior remain
at their existing persistence boundaries.

Intended closure after passing acceptance: W-20, W-25 only.

Base: `hig/17-archive-next-step` at `c4e04c655ec393a0641dbafbfa204d9580b992bb`.
Head: `16955bb57c8c4611823d39e0fa3bf6960beb429e`.
app.asar SHA-256: `84de85e7bd26789da889425241e1b278183ea9b342313c09a7fdbf0a5b781f1c`.
Parent app.asar: `8aad4d93be48a7767b56d8437d48c41d26ebe6190cf2d1f2a9ef84e8ca8e4a4f`.

Dependencies: stack parent [#89](https://github.com/kjg8619/Weavra/pull/89);
foundations [#74](https://github.com/kjg8619/Weavra/pull/74),
contextual provider feedback [#76](https://github.com/kjg8619/Weavra/pull/76),
persistent input labels [#80](https://github.com/kjg8619/Weavra/pull/80).
The parent's later boundary fix was merged normally, not rebased. Earlier
builds/captures invalidated by that movement are retained locally, outside this
final published packet. The shared hig-01 runner was not edited.

The concise status option is explicit on provider cards. Onboarding keeps the
existing default summary contract, and the selected provider editor retains
account metadata even when no account email is reported.

## Before / after

| State, size, theme | Before | After | Diff / hotspots |
|---|---|---|---|
| `1280x800/22_settings_providers.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--1280x800--22_settings_providers.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--1280x800--22_settings_providers.png?raw=true) | 0.1712 / 45 |
| `1280x800/28_add_custom_model_form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--1280x800--28_add_custom_model_form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--1280x800--28_add_custom_model_form.png?raw=true) | 0.3393 / 56 |
| `1920x1080/22_settings_providers.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--1920x1080--22_settings_providers.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--1920x1080--22_settings_providers.png?raw=true) | 0.1571 / 36 |
| `1920x1080/28_add_custom_model_form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--1920x1080--28_add_custom_model_form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--1920x1080--28_add_custom_model_form.png?raw=true) | 0.215 / 44 |
| `forms/840x620/light/100-provider-list.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--840x620--light--100-provider-list.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--840x620--light--100-provider-list.png?raw=true) | 0.1264 / 36 |
| `forms/840x620/light/100-new-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--840x620--light--100-new-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--840x620--light--100-new-form.png?raw=true) | 0.1405 / 42 |
| `forms/840x620/light/100-edited-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--840x620--light--100-edited-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--840x620--light--100-edited-form.png?raw=true) | 0.1475 / 48 |
| `forms/1280x800/light/100-provider-list.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1280x800--light--100-provider-list.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1280x800--light--100-provider-list.png?raw=true) | 0.1893 / 45 |
| `forms/1280x800/light/100-new-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1280x800--light--100-new-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1280x800--light--100-new-form.png?raw=true) | 0.3395 / 56 |
| `forms/1280x800/light/100-edited-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1280x800--light--100-edited-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1280x800--light--100-edited-form.png?raw=true) | 0.3008 / 54 |
| `forms/1920x1080/light/100-provider-list.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1920x1080--light--100-provider-list.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1920x1080--light--100-provider-list.png?raw=true) | 0.1546 / 36 |
| `forms/1920x1080/light/100-new-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1920x1080--light--100-new-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1920x1080--light--100-new-form.png?raw=true) | 0.215 / 44 |
| `forms/1920x1080/light/100-edited-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1920x1080--light--100-edited-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1920x1080--light--100-edited-form.png?raw=true) | 0.1975 / 43 |
| `forms/840x620/dark/100-provider-list.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--840x620--dark--100-provider-list.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--840x620--dark--100-provider-list.png?raw=true) | 0.0736 / 36 |
| `forms/840x620/dark/100-new-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--840x620--dark--100-new-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--840x620--dark--100-new-form.png?raw=true) | 0.1684 / 39 |
| `forms/840x620/dark/100-edited-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--840x620--dark--100-edited-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--840x620--dark--100-edited-form.png?raw=true) | 0.2193 / 46 |
| `forms/1280x800/dark/100-provider-list.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1280x800--dark--100-provider-list.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1280x800--dark--100-provider-list.png?raw=true) | 0.2375 / 45 |
| `forms/1280x800/dark/100-new-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1280x800--dark--100-new-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1280x800--dark--100-new-form.png?raw=true) | 0.5168 / 56 |
| `forms/1280x800/dark/100-edited-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1280x800--dark--100-edited-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1280x800--dark--100-edited-form.png?raw=true) | 0.416 / 54 |
| `forms/1920x1080/dark/100-provider-list.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1920x1080--dark--100-provider-list.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1920x1080--dark--100-provider-list.png?raw=true) | 0.2384 / 36 |
| `forms/1920x1080/dark/100-new-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1920x1080--dark--100-new-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1920x1080--dark--100-new-form.png?raw=true) | 0.2755 / 44 |
| `forms/1920x1080/dark/100-edited-form.png` | ![before](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/before--forms--1920x1080--dark--100-edited-form.png?raw=true) | ![after](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/after--forms--1920x1080--dark--100-edited-form.png?raw=true) | 0.2787 / 43 |

[Complete image table: all baseline, themed supplemental, form and acceptance states](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/image-table.md).

## Verification

- From `app/t3code/apps/web`: `pnpm exec vp test run --project unit src/components/settings/providerStatus.test.ts src/components/settings/ProviderModelsSection.test.ts src/components/settings/ProviderSettingsPanel.environment.test.tsx`: 27/27, three files, exit 0.
- From `app/t3code`: targeted `pnpm exec vp fmt --check` and `pnpm exec vp lint` on the seven changed owner files: exit 0; `pnpm --filter @t3tools/web typecheck`: exit 0.
- Both source-built packages use `T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false pnpm run dist:desktop:artifact --platform mac --target zip --arch arm64 --output-dir ...`: exit 0. Version 0.0.42, Node 24.19.0, project-selected pnpm 11.10.0, Bun 1.4.0. No live installation was used as the after build.
- Actual final source, app/script/fixture hashes, native bounds, all capture-pair results and both strict acceptance/verifier outcomes are in the [machine-readable status](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/blocked-status.json?raw=true).
- The fresh [a-j measurements](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/rules-a-j.md?raw=true) cover both themes, three CSS sizes, 100/150% text and focus/hover/pressed/invalid/corrected/edit/cancel states. [Computed measurements](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/measure-after--qa-measure.json?raw=true) retain actual rectangles, RGBA/background compositing, five-point hits, contrast, focus, scroll-owner and overlap observations.
- No fabricated acceptance-verdict.json is supplied: the shared verifier exits on the failed scenario before it writes that file. Both actual scenario receipts, AX/action artifacts and raw command logs are preserved.
- The original installed audit build is not the parent comparison. These are fresh c4e04c65 and 16955bb5 source-built packages with explicit provenance.

## Residual findings

**This PR body is prepared locally, not submitted.** The shared runner selects the
All environments breadcrumb instead of the provider diagnostic and reuses an
`aria-expanded=false` live locator after activation. See the [exact blocker and
owner repair](https://github.com/kjg8619/Weavra/blob/hig-evidence/18/18/BLOCKER.md?raw=true).
Required acceptance failures prevent opening a non-draft PR. Assertions have not
been weakened and hig-01 has not been edited.

Two pre-existing lint warnings remain: the models-list effect dependency and the
provider settings search effect. Parent lint receipts establish both. The shared
Settings breadcrumb/footer crowding at minimum/150% is outside this owner scope.
The full universal Q/200%/+40%/VoiceOver/IME/motion cross-product and monorepo CI
remain Final-wave checks under the October 19 amendment; no full-Q PASS is claimed.
An independent child reviewer could not launch because the nesting limit is one;
no independent review approval is claimed.

Model and harness: GPT-6.1-Sol (`chatgpt-subscription`) with Senpi; unchanged shared
HIG runner `94be65dcf88700e6e73a728fb42437ababa75fdb`. Model/execution/external-network
counters are zero in the isolated self-measurement profile. Only owned evidence
apps are closed; `/Users/kangjingoo/Applications/Weavra.app` remains untouched.
